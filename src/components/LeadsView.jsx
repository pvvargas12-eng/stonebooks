// =============================================================================
// LeadsView — tasks table (top) + a real leads data table (below).
// =============================================================================
// A lead is any uncontracted order (draft/scoping/quoted) — derived live. The
// TOP surface is the OPEN/COMPLETED task table (one row per order_activity task).
// BELOW it is the full leads roster as a proper columned table:
//   Family · Customer · Job type · Status · Design · Quote $ · Cemetery · Started
//   · Last contact · Assignee · ⋯
//
// Column backing (all real): Family = primary_lastname; Customer = customer join;
// Job type = service_types; Status = order.status; Design = an OPEN order_activity
// task whose note matches a layout/design keyword (heuristic — no task tag exists
// yet); Quote $ = rowGrandTotal; Cemetery = cemetery join; Started = created_at;
// Last contact = most recent order_activity (type='activity'); Assignee = open
// task assignee, else sales_rep. Reuses existing task/cemetery/open-detail paths.
// Notes never touch inscription.
// =============================================================================

import { useState, useEffect, useMemo } from 'react'
import {
  rowGrandTotal, fmtUSD, fmtDate, fmtPhone, statusInfo,
  getOpenTasksList, getCompletedTasksList, getRecentFollowupsForOrders,
  addOrderTask, setOrderTaskStatus, updateOrderLeadFields, getCurrentStaffName,
  bulkArchiveOrders, hardDeleteOrder,
} from '../lib/stonebooksData'
import { SALES_REPS } from '../SalesMode'
import { LEAD_STATUSES, followUpUrgency } from '../lib/leads'

const pad = (n) => String(n).padStart(2, '0')
// today as YYYY-MM-DD — call only in event handlers / effects (never in render).
const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` }

// ── Name normalization — one consistent "Last, First" in Title Case ──────────
const titleCase = (s) => String(s || '').toLowerCase().replace(/(^|[\s,'’/-])([a-z])/g, (_, sep, c) => sep + c.toUpperCase())
const leadPlaceholder = (o) => `Unnamed lead · ${o.order_number || 'EST'}`
// Customer (the caller) — "Last, First", placeholder when truly nameless.
const customerDisplay = (o) => {
  const c = o.customer
  const last = (c?.last_name || '').trim(), first = (c?.first_name || '').trim()
  if (last || first) return titleCase([last, first].filter(Boolean).join(', '))
  return leadPlaceholder(o)
}
// Family name carved on the stone — primary_lastname; blank for early leads → '—'.
const familyDisplay = (o) => {
  const fam = (o.primary_lastname || '').trim()
  return fam ? titleCase(fam) : '—'
}
const leadName = customerDisplay   // the lead's identity in the task table + menus

// Job type from service_types (leads have no job yet).
const SERVICE_LABELS = {
  NEW_STONE: 'New stone', INSCRIPTION: 'Inscription', REPAIR: 'Repair',
  ACID_WASH: 'Acid wash', BRONZE: 'Bronze', MAUSOLEUM: 'Mausoleum',
}
const jobTypeLabel = (o) => {
  const st = o.service_types || []
  if (!st.length) return '—'
  return st.map(c => SERVICE_LABELS[c] || titleCase(c)).join(' · ')
}

// Design = waiting on layout. Heuristic: an OPEN task whose note mentions layout/
// design/proof (freeform notes — no task tag exists; flagged in the report).
const LAYOUT_RE = /\b(layout|design|proof)\b/i

const SORT_OPTIONS = [
  { code: 'due',    label: 'Due date (overdue first)' },
  { code: 'newest', label: 'Newest lead' },
  { code: 'oldest', label: 'Oldest lead' },
  { code: 'value',  label: 'Highest $ first' },
]
const urgRank = (u) => (u === 'overdue' ? 0 : u === 'today' ? 1 : u === 'future' ? 2 : 3)

// Leads-table columns (sortable). The ⋯ action column is appended separately.
const LEAD_COLS = [
  { key: 'family',   label: 'Family name' },
  { key: 'customer', label: 'Customer' },
  { key: 'jobType',  label: 'Job type' },
  { key: 'status',   label: 'Status' },
  { key: 'design',   label: 'Design', cls: 'sb-lt-c-center' },
  { key: 'quote',    label: 'Quote $', cls: 'sb-lt-c-num' },
  { key: 'cemetery', label: 'Cemetery' },
  { key: 'started',  label: 'Started', cls: 'sb-lt-c-date' },
  { key: 'contact',  label: 'Last contact', cls: 'sb-lt-c-date' },
  { key: 'assignee', label: 'Assignee' },
]
const leadSortVal = (r, key) => {
  switch (key) {
    case 'family':   return r.family.toLowerCase()
    case 'customer': return r.customer.toLowerCase()
    case 'jobType':  return r.jobType.toLowerCase()
    case 'status':   return (r.status?.label || '').toLowerCase()
    case 'design':   return r.design ? 0 : 1
    case 'quote':    return r.value || 0
    case 'cemetery': return (r.cemetery === '—' ? '￿' : r.cemetery).toLowerCase()
    case 'started':  return r.started || ''
    case 'contact':  return r.lastContact || '￿'   // no-contact sorts last asc
    case 'assignee': return (r.assignee || '￿').toLowerCase()
    default:         return ''
  }
}

export default function LeadsView({ orders = [], onOpenDetail, onConvert, onChanged }) {
  const [todayISO, setTodayISO] = useState('')
  const [tasks, setTasks] = useState([])              // open tasks across leads
  const [completedTasks, setCompletedTasks] = useState([])
  const [lastTouch, setLastTouch] = useState({})      // most-recent activity per lead
  const [taskTab, setTaskTab] = useState('open')      // 'open' | 'completed'
  const [sortKey, setSortKey] = useState('due')       // tasks-table sort
  const [leadSort, setLeadSort] = useState({ key: 'started', dir: 'desc' })   // leads-table sort
  const [allLeadsOpen, setAllLeadsOpen] = useState(true)
  const [refreshNonce, setRefreshNonce] = useState(0)
  const [menuKey, setMenuKey] = useState(null)
  const [reminderFor, setReminderFor] = useState(null)
  const [reminderDue, setReminderDue] = useState('')
  const [busyId, setBusyId] = useState(null)

  useEffect(() => { setTodayISO(todayStr()) }, [])

  const leads = useMemo(
    () => (orders || []).filter(o => LEAD_STATUSES.includes(o.status) && !o.archived && !o.lost_at),
    [orders])
  const leadById = useMemo(() => { const m = {}; for (const l of leads) m[l.id] = l; return m }, [leads])
  const leadIdsKey = leads.map(o => o.id).join(',')

  useEffect(() => {
    let alive = true
    const ids = leadIdsKey ? leadIdsKey.split(',') : []
    if (!ids.length) { setTasks([]); setCompletedTasks([]); setLastTouch({}); return }
    getOpenTasksList(ids).then(l => { if (alive) setTasks(l) })
    getRecentFollowupsForOrders(ids).then(m => { if (alive) setLastTouch(m) })
    if (taskTab === 'completed') getCompletedTasksList(ids).then(l => { if (alive) setCompletedTasks(l) })
    return () => { alive = false }
  }, [leadIdsKey, refreshNonce, taskTab])

  const refresh = () => setRefreshNonce(n => n + 1)

  // Per-lead signals derived from the open tasks.
  const layoutByLead = useMemo(() => {
    const s = new Set()
    for (const t of tasks) if (LAYOUT_RE.test(t.note || '')) s.add(t.order_id)
    return s
  }, [tasks])
  const assigneeByLead = useMemo(() => {
    const m = new Map()
    for (const t of tasks) if (t.assignee && !m.has(t.order_id)) m.set(t.order_id, t.assignee)
    return m
  }, [tasks])

  // ── Tasks table rows ───────────────────────────────────────────────────────
  const buildRows = (list) => list
    .map(t => { const lead = leadById[t.order_id]; return lead ? { task: t, lead } : null })
    .filter(Boolean)
    .map(r => ({ ...r, urgency: followUpUrgency(r.task.due_date, todayISO), value: rowGrandTotal(r.lead) }))

  const taskRows = useMemo(() => {
    const rows = buildRows(tasks)
    const byDue = (a, b) => {
      const ur = urgRank(a.urgency) - urgRank(b.urgency); if (ur) return ur
      const da = a.task.due_date || '9999-12-31', db = b.task.due_date || '9999-12-31'
      return da < db ? -1 : da > db ? 1 : 0
    }
    const cmp =
      sortKey === 'newest' ? (a, b) => (b.lead.created_at || '').localeCompare(a.lead.created_at || '')
        : sortKey === 'oldest' ? (a, b) => (a.lead.created_at || '').localeCompare(b.lead.created_at || '')
          : sortKey === 'value' ? (a, b) => (b.value || 0) - (a.value || 0)
            : byDue
    return [...rows].sort(cmp)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks, leadById, todayISO, sortKey])

  const completedRows = useMemo(() => buildRows(completedTasks)
    .sort((a, b) => (b.task.created_at || '').localeCompare(a.task.created_at || '')),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [completedTasks, leadById, todayISO])

  // ── Leads-table rows (full roster) ─────────────────────────────────────────
  const leadRows = useMemo(() => {
    const rows = leads.map(o => ({
      o,
      family: familyDisplay(o),
      customer: customerDisplay(o),
      jobType: jobTypeLabel(o),
      status: statusInfo(o.status),
      design: layoutByLead.has(o.id),
      value: rowGrandTotal(o),
      cemetery: o.cemetery?.name || '—',
      started: o.created_at || null,
      lastContact: lastTouch[o.id]?.created_at || null,
      assignee: assigneeByLead.get(o.id) || o.sales_rep || null,
    }))
    const { key, dir } = leadSort
    const mult = dir === 'desc' ? -1 : 1
    return rows.sort((a, b) => {
      const va = leadSortVal(a, key), vb = leadSortVal(b, key)
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * mult
      return String(va).localeCompare(String(vb)) * mult
    })
  }, [leads, layoutByLead, assigneeByLead, lastTouch, leadSort])

  const toggleLeadSort = (key) => setLeadSort(s =>
    s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'quote' || key === 'started' || key === 'contact' ? 'desc' : 'asc' })
  const leadCaret = (key) => (leadSort.key !== key ? '' : leadSort.dir === 'asc' ? ' ↑' : ' ↓')

  const summary = useMemo(() => ({
    total: leads.reduce((s, l) => s + rowGrandTotal(l), 0),
    overdue: taskRows.filter(r => r.urgency === 'overdue' || r.urgency === 'today').length,
    count: leads.length,
  }), [leads, taskRows])

  // ── Actions ───────────────────────────────────────────────────────────────
  const openReminder = (leadId) => { setMenuKey(null); setReminderDue(todayStr()); setReminderFor(leadId) }

  const markDone = async (task) => {
    setBusyId(task.id); setMenuKey(null)
    const res = await setOrderTaskStatus(task.id, 'done')
    if (res?.ok !== false) { setTasks(prev => prev.filter(t => t.id !== task.id)); refresh() }
    setBusyId(null)
  }
  const reopenTask = async (task) => {
    setBusyId(task.id); setMenuKey(null)
    const res = await setOrderTaskStatus(task.id, 'open')
    if (res?.ok !== false) { setCompletedTasks(prev => prev.filter(t => t.id !== task.id)); refresh() }
    setBusyId(null)
  }
  const saveReminder = async (leadId, label, due, assignee) => {
    const text = (label || '').trim()
    if (!text) return
    const dueDate = due || todayStr()
    const actor = await getCurrentStaffName().catch(() => null)
    await addOrderTask(leadId, { note: text, dueDate, assignee: assignee || null, actor })
    await updateOrderLeadFields(leadId, { next_follow_up: dueDate })
    setReminderFor(null)
    refresh()
  }
  const archiveLead = async (leadId) => {
    setBusyId(leadId); setMenuKey(null)
    const res = await bulkArchiveOrders([leadId])
    setBusyId(null)
    if (res?.ok === false) { window.alert('Could not archive the lead.'); return }
    onChanged?.()
  }
  const deleteLead = async (leadId, name) => {
    setMenuKey(null)
    if (!window.confirm(`Permanently delete this lead${name ? ` — ${name}` : ''}? This cannot be undone.`)) return
    setBusyId(leadId)
    await bulkArchiveOrders([leadId])              // hardDeleteOrder is archive-gated
    const res = await hardDeleteOrder(leadId)
    setBusyId(null)
    if (!res?.ok) window.alert(res?.error || 'Could not delete the lead.')
    onChanged?.()
  }

  const menuItems = (lead, task, completed) => {
    const name = leadName(lead)
    const items = [
      { label: 'Open lead', onClick: () => { setMenuKey(null); onOpenDetail?.(lead.id) } },
      { label: task && !completed ? 'Add another reminder' : 'Set reminder', onClick: () => openReminder(lead.id) },
    ]
    if (task && !completed) items.push({ label: 'Mark done', onClick: () => markDone(task) })
    if (task && completed) items.push({ label: 'Re-open task', onClick: () => reopenTask(task) })
    items.push({ label: 'Convert to order →', onClick: () => { setMenuKey(null); onConvert?.(lead.id) } })
    items.push({ label: 'Archive lead', onClick: () => archiveLead(lead.id) })
    items.push({ label: 'Delete lead', danger: true, onClick: () => deleteLead(lead.id, name) })
    return items
  }

  const activeRows = taskTab === 'open' ? taskRows : completedRows

  return (
    <div className="sb-leads">
      <style>{CSS}</style>

      <div className="sb-leads-summary">
        <div className="sb-leads-stat"><span className="sb-leads-stat-num">{fmtUSD(summary.total)}</span><span className="sb-leads-stat-lab">open estimates</span></div>
        <div className="sb-leads-stat"><span className={`sb-leads-stat-num${summary.overdue > 0 ? ' sb-leads-red' : ''}`}>{summary.overdue}</span><span className="sb-leads-stat-lab">due / overdue</span></div>
        <div className="sb-leads-stat"><span className="sb-leads-stat-num">{summary.count}</span><span className="sb-leads-stat-lab">{summary.count === 1 ? 'lead' : 'leads'}</span></div>
      </div>

      <div className="sb-leads-bar">
        <div className="sb-lt-tabs">
          <button type="button" className={`sb-lt-tab${taskTab === 'open' ? ' on' : ''}`} onClick={() => setTaskTab('open')}>Open ({taskRows.length})</button>
          <button type="button" className={`sb-lt-tab${taskTab === 'completed' ? ' on' : ''}`} onClick={() => setTaskTab('completed')}>Completed</button>
        </div>
        {taskTab === 'open' && (
          <div className="sb-leads-sortbar">
            <span className="sb-leads-sortlab">Sort</span>
            <select className="sb-leads-sortsel" value={sortKey} onChange={e => setSortKey(e.target.value)}>
              {SORT_OPTIONS.map(o => <option key={o.code} value={o.code}>{o.label}</option>)}
            </select>
          </div>
        )}
      </div>

      {reminderFor && (
        <ReminderEditor key={reminderFor} lead={leadById[reminderFor]} defaultDue={reminderDue}
          onSave={(label, due, assignee) => saveReminder(reminderFor, label, due, assignee)}
          onCancel={() => setReminderFor(null)} />
      )}

      {/* Tasks table (primary surface) */}
      {activeRows.length === 0 ? (
        <div className="sb-lt-empty">{taskTab === 'open'
          ? 'No open reminders. Add one from a lead below, or in “+ New Lead”.'
          : 'No completed tasks yet.'}</div>
      ) : (
        <table className="sb-lt">
          <thead>
            <tr>
              <th className="sb-lt-c-check" />
              <th>Reminder / task</th>
              <th>Lead</th>
              <th>Due</th>
              <th>Contact</th>
              <th className="sb-lt-c-act" />
            </tr>
          </thead>
          <tbody>
            {activeRows.map(({ task, lead, urgency }) => {
              const completed = taskTab === 'completed'
              const key = `t:${task.id}`
              return (
                <tr key={task.id} className={`sb-lt-row${completed ? ' sb-lt-row-done' : ''}`}>
                  <td className="sb-lt-c-check">
                    <input type="checkbox" checked={completed} disabled={busyId === task.id}
                      onChange={() => (completed ? reopenTask(task) : markDone(task))}
                      title={completed ? 'Re-open' : 'Mark done'} />
                  </td>
                  <td className="sb-lt-c-rem">
                    <button type="button" className="sb-lt-link sb-lt-rem" onClick={() => onOpenDetail?.(lead.id)}>{task.note}</button>
                    {task.assignee && <span className="sb-lt-assignee"> · {task.assignee}</span>}
                    {completed && <span className="sb-lt-donetag">Completed ✓</span>}
                  </td>
                  <td className="sb-lt-c-lead">
                    <button type="button" className="sb-lt-link sb-lt-leadname" onClick={() => onOpenDetail?.(lead.id)}>{leadName(lead)}</button>
                  </td>
                  <td className="sb-lt-c-due">
                    {task.due_date
                      ? <span className={`sb-lt-due${completed ? '' : ` sb-lt-due-${urgency}`}`}>{fmtDate(task.due_date)}</span>
                      : <span className="sb-lt-due-none">—</span>}
                  </td>
                  <td className="sb-lt-c-contact">{lead.customer?.phone_primary ? fmtPhone(lead.customer.phone_primary) : '—'}</td>
                  <td className="sb-lt-c-act">
                    <RowMenu open={menuKey === key} onToggle={() => setMenuKey(menuKey === key ? null : key)} items={menuItems(lead, task, completed)} />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}

      {/* Leads roster — the real columned table */}
      {leads.length > 0 && (
        <div className="sb-lt-allleads">
          <button type="button" className="sb-lt-allleads-head" onClick={() => setAllLeadsOpen(v => !v)}>
            <span className="sb-lt-caret">{allLeadsOpen ? '▾' : '▸'}</span>
            All leads ({leads.length})
          </button>
          {allLeadsOpen && (
            <div className="sb-lt-scroll">
              <table className="sb-lt sb-leadtbl">
                <thead>
                  <tr>
                    {LEAD_COLS.map(c => (
                      <th key={c.key} className={`sb-lt-sortable ${c.cls || ''}`} onClick={() => toggleLeadSort(c.key)} title="Sort">
                        {c.label}{leadCaret(c.key)}
                      </th>
                    ))}
                    <th className="sb-lt-c-act" />
                  </tr>
                </thead>
                <tbody>
                  {leadRows.map(r => {
                    const key = `l:${r.o.id}`
                    return (
                      <tr key={r.o.id} className="sb-lt-row sb-lt-rowclick" onClick={() => onOpenDetail?.(r.o.id)}>
                        <td className="sb-lt-fam">{r.family}</td>
                        <td className="sb-lt-cust">{r.customer}</td>
                        <td>{r.jobType}</td>
                        <td><span className="sb-lt-statuschip" style={{ color: r.status.color }}><span className="sb-lt-statusdot" style={{ background: r.status.color }} />{r.status.label}</span></td>
                        <td className="sb-lt-c-center">{r.design ? <span className="sb-lt-yes">Yes</span> : <span className="sb-lt-dash">—</span>}</td>
                        <td className="sb-lt-c-num">{r.value > 0 ? fmtUSD(r.value) : '—'}</td>
                        <td>{r.cemetery}</td>
                        <td className="sb-lt-c-date">{r.started ? fmtDate(r.started) : '—'}</td>
                        <td className="sb-lt-c-date">{r.lastContact ? fmtDate(r.lastContact) : <span className="sb-lt-nocontact">No contact</span>}</td>
                        <td>{r.assignee || '—'}</td>
                        <td className="sb-lt-c-act" onClick={e => e.stopPropagation()}>
                          <RowMenu open={menuKey === key} onToggle={() => setMenuKey(menuKey === key ? null : key)} items={menuItems(r.o, null, false)} />
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Inline reminder editor ──────────────────────────────────────────────────
function ReminderEditor({ lead, defaultDue, onSave, onCancel }) {
  const [label, setLabel] = useState('')
  const [due, setDue] = useState(defaultDue || '')
  const [assignee, setAssignee] = useState('')
  const name = lead ? leadName(lead) : 'this lead'
  return (
    <div className="sb-lt-remedit">
      <span className="sb-lt-remedit-lab">Reminder for {name}</span>
      <input className="sb-lt-input" type="text" autoFocus value={label}
        placeholder="What to do — Call back · Coming in Tue noon · Send layout"
        onChange={e => setLabel(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' && label.trim()) onSave(label, due, assignee) }} />
      <input className="sb-lt-input sb-lt-input-date" type="date" value={due} onChange={e => setDue(e.target.value)} />
      <select className="sb-lt-input sb-lt-input-sel" value={assignee} onChange={e => setAssignee(e.target.value)} title="Assign to">
        <option value="">Unassigned</option>
        {SALES_REPS.map(r => <option key={r} value={r}>{r}</option>)}
      </select>
      <button type="button" className="sb-lt-savebtn" disabled={!label.trim()} onClick={() => onSave(label, due, assignee)}>Add</button>
      <button type="button" className="sb-lt-cancelbtn" onClick={onCancel}>Cancel</button>
    </div>
  )
}

// ── ⋯ row action menu — position:fixed off the button rect so the table's
// overflow never clips it; flips upward near the viewport bottom. ──────────────
function RowMenu({ open, onToggle, items }) {
  const [pos, setPos] = useState(null)
  const handle = (e) => {
    e.stopPropagation()
    const r = e.currentTarget.getBoundingClientRect()
    const flipUp = r.bottom > window.innerHeight - 260
    setPos({
      right: Math.max(8, window.innerWidth - r.right),
      top: flipUp ? undefined : r.bottom + 4,
      bottom: flipUp ? (window.innerHeight - r.top + 4) : undefined,
    })
    onToggle()
  }
  return (
    <div className="sb-lt-menuwrap">
      <button type="button" className="sb-lt-menubtn" title="Actions" onClick={handle}>⋯</button>
      {open && pos && (
        <>
          <div className="sb-lt-menuback" onClick={onToggle} />
          <div className="sb-lt-menu" style={{ position: 'fixed', right: pos.right, top: pos.top, bottom: pos.bottom }}>
            {items.map((it, i) => (
              <button key={i} type="button" className={`sb-lt-menuitem${it.danger ? ' danger' : ''}`}
                disabled={it.disabled} onClick={it.onClick}>{it.label}</button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

const CSS = `
.sb-leads { padding: 4px 0 24px; }
.sb-leads-summary { display: flex; gap: 26px; padding: 12px 16px; background: #fff; border: 1px solid #ece6d8; border-radius: 10px; margin-bottom: 12px; }
.sb-leads-stat { display: flex; flex-direction: column; }
.sb-leads-stat-num { font-size: 20px; font-weight: 700; color: #1a1a1a; line-height: 1.15; }
.sb-leads-stat-lab { font-size: 11.5px; color: #8a8472; }
.sb-leads-red { color: #b3261e; }
.sb-leads-bar { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 10px; flex-wrap: wrap; }
.sb-lt-tabs { display: inline-flex; background: #efece3; border-radius: 8px; padding: 3px; gap: 2px; }
.sb-lt-tab { border: none; background: none; font: inherit; font-size: 13px; font-weight: 600; color: #7a756a; padding: 6px 14px; border-radius: 6px; cursor: pointer; }
.sb-lt-tab.on { background: #fff; color: #0f1419; box-shadow: 0 1px 2px rgba(0,0,0,0.1); }
.sb-leads-sortbar { display: flex; align-items: center; gap: 8px; }
.sb-leads-sortlab { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: #8a8472; }
.sb-leads-sortsel { font: inherit; font-size: 13px; padding: 5px 9px; border: 1px solid #d8d2c4; border-radius: 8px; background: #fff; color: #1a1a1a; cursor: pointer; }
.sb-leads-sortsel:focus { outline: none; border-color: #9A7209; }

/* Reminder editor */
.sb-lt-remedit { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; background: #fdf8ec; border: 1px solid #e8d9a8; border-radius: 9px; padding: 9px 12px; margin-bottom: 10px; }
.sb-lt-remedit-lab { font-size: 12px; font-weight: 700; color: #7a5d12; }
.sb-lt-input { flex: 1 1 220px; min-width: 150px; font: inherit; font-size: 13px; padding: 6px 9px; border: 1px solid #d8d2c4; border-radius: 6px; background: #fff; }
.sb-lt-input-date, .sb-lt-input-sel { flex: 0 0 auto; }
.sb-lt-input-sel { -webkit-appearance: menulist; appearance: auto; cursor: pointer; }
.sb-lt-input:focus { outline: none; border-color: #9A7209; }
.sb-lt-savebtn { border: 1px solid #9a7209; background: #9a7209; color: #fff; border-radius: 6px; padding: 6px 14px; font-weight: 600; cursor: pointer; }
.sb-lt-savebtn:disabled { opacity: 0.5; cursor: default; }
.sb-lt-cancelbtn { border: none; background: none; color: #8a8472; font-weight: 600; cursor: pointer; }

/* Tables — tight + aligned */
.sb-lt-empty { padding: 26px; text-align: center; color: #8a8472; background: #fff; border: 1px solid #ece6d8; border-radius: 10px; }
.sb-lt { width: 100%; border-collapse: collapse; background: #fff; border: 1px solid #ece6d8; border-radius: 10px; overflow: hidden; }
.sb-lt thead th { text-align: left; font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; color: #9a9486; font-weight: 700; padding: 7px 12px; background: #faf8f3; border-bottom: 1px solid #ece6d8; white-space: nowrap; }
.sb-lt tbody td { padding: 7px 12px; border-bottom: 1px solid #f3f0e8; font-size: 13.5px; color: #2a2a2a; vertical-align: middle; }
.sb-lt tbody tr:last-child td { border-bottom: none; }
.sb-lt-row:hover td { background: #faf8f3; }
.sb-lt-row-done td { background: #fbfaf7; }
.sb-lt-rowclick { cursor: pointer; }
.sb-lt-c-check { width: 32px; text-align: center; }
.sb-lt-c-check input { width: 16px; height: 16px; accent-color: #2d7a4f; cursor: pointer; }
.sb-lt-c-due { width: 112px; white-space: nowrap; }
.sb-lt-c-contact { width: 132px; white-space: nowrap; color: #555; font-variant-numeric: tabular-nums; }
.sb-lt-c-act { width: 40px; text-align: right; }
.sb-lt-link { background: none; border: none; padding: 0; font: inherit; text-align: left; cursor: pointer; color: #2a2a2a; }
.sb-lt-rem { font-weight: 600; color: #1a1a1a; }
.sb-lt-link:hover { color: #9A7209; text-decoration: underline; }
.sb-lt-leadname { color: #1d4ed8; font-weight: 600; }
.sb-lt-assignee { font-size: 12.5px; color: #8a8472; font-weight: 600; }
.sb-lt-donetag { margin-left: 8px; font-size: 11px; font-weight: 700; color: #2d7a4f; }
.sb-lt-due { font-size: 12.5px; font-weight: 600; border-radius: 6px; padding: 2px 8px; white-space: nowrap; }
.sb-lt-due-overdue { color: #b3261e; background: #fbeaea; }
.sb-lt-due-today { color: #7a4a12; background: #fdf2e9; }
.sb-lt-due-future { color: #555; }
.sb-lt-due-none { color: #c2bdb2; }

/* Leads roster table */
.sb-lt-allleads { margin-top: 14px; }
.sb-lt-allleads-head { display: flex; align-items: center; gap: 8px; width: 100%; text-align: left; background: #f4f2ec; border: 1px solid #ece6d8; border-radius: 9px; padding: 9px 12px; font: inherit; font-size: 13px; font-weight: 700; color: #5d5d5a; cursor: pointer; margin-bottom: 7px; }
.sb-lt-allleads-head:hover { background: #efece3; }
.sb-lt-caret { font-size: 11px; color: #8a8472; }
.sb-lt-scroll { overflow-x: auto; border-radius: 10px; }
.sb-leadtbl { min-width: 1020px; }
.sb-lt-sortable { cursor: pointer; user-select: none; }
.sb-lt-sortable:hover { color: #5d5d5a; }
.sb-lt-c-num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
.sb-lt-c-date { width: 110px; white-space: nowrap; color: #555; font-variant-numeric: tabular-nums; }
.sb-lt-c-center { text-align: center; }
.sb-lt-fam { font-weight: 700; color: #1a1a1a; white-space: nowrap; }
.sb-lt-cust { color: #1d4ed8; font-weight: 600; white-space: nowrap; }
.sb-lt-statuschip { display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; font-weight: 600; white-space: nowrap; }
.sb-lt-statusdot { width: 7px; height: 7px; border-radius: 50%; flex: 0 0 auto; }
.sb-lt-yes { font-size: 11.5px; font-weight: 700; color: #1d4ed8; background: #e7edfd; border-radius: 6px; padding: 2px 8px; }
.sb-lt-dash { color: #c2bdb2; }
.sb-lt-nocontact { font-size: 12px; font-weight: 600; color: #b3261e; }

/* ⋯ menu — fixed positioning (never clipped) */
.sb-lt-menuwrap { position: relative; display: inline-block; }
.sb-lt-menubtn { border: none; background: none; font-size: 18px; line-height: 1; color: #8a8472; cursor: pointer; padding: 2px 6px; border-radius: 6px; }
.sb-lt-menubtn:hover { background: #f1ede3; color: #5d5d5a; }
.sb-lt-menuback { position: fixed; inset: 0; z-index: 1200; }
.sb-lt-menu { z-index: 1201; background: #fff; border: 1px solid #e0dccf; border-radius: 9px; box-shadow: 0 10px 30px rgba(0,0,0,0.18); padding: 5px; min-width: 184px; display: flex; flex-direction: column; }
.sb-lt-menuitem { text-align: left; background: none; border: none; font: inherit; font-size: 13.5px; color: #2a2a2a; padding: 8px 11px; border-radius: 6px; cursor: pointer; white-space: nowrap; }
.sb-lt-menuitem:hover:not(:disabled) { background: #f4f2ec; }
.sb-lt-menuitem:disabled { opacity: 0.45; cursor: default; }
.sb-lt-menuitem.danger { color: #b3261e; }
.sb-lt-menuitem.danger:hover { background: #fbeaea; }

@media (max-width: 760px) {
  .sb-lt-c-contact { display: none; }
}
`
