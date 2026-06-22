// =============================================================================
// LeadsView — the leads work as a compact TASK TABLE.
// =============================================================================
// A lead is any uncontracted order (draft/scoping/quoted) — derived live, never
// a separate record. This view is a dense table of open reminders/to-dos, one row
// per task (a lead can carry several). Tasks are real order_activity rows
// (type 'task'); "done" persists via setOrderTaskStatus. Leads with no open task
// drop to a lighter "No reminder set" list with a quick inline reminder add.
//
// The ⋯ row menu reuses the EXISTING order paths: open (onOpenDetail), convert
// (onConvert), archive (bulkArchiveOrders), delete (archive-gated hardDeleteOrder
// with confirm). No parallel systems, no faked done-state. Notes never touch
// inscription — the New Lead form routes them to order_notes.
// =============================================================================

import { useState, useEffect, useMemo } from 'react'
import {
  rowGrandTotal, fmtUSD, fmtDate, fmtPhone,
  getOpenTasksList, addOrderTask, setOrderTaskStatus,
  updateOrderLeadFields, getCurrentStaffName,
  bulkArchiveOrders, hardDeleteOrder,
} from '../lib/stonebooksData'
import { LEAD_STATUSES, followUpUrgency } from '../lib/leads'

const pad = (n) => String(n).padStart(2, '0')
// today as YYYY-MM-DD — call only in event handlers / effects (never in render).
const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` }
const leadName = (o) => {
  const c = o.customer
  if (c && (c.last_name || c.first_name)) return `${c.last_name || ''}${c.first_name ? `, ${c.first_name}` : ''}`.trim()
  return o.primary_lastname || '(no name)'
}

const SORT_OPTIONS = [
  { code: 'due',    label: 'Due date (overdue first)' },
  { code: 'newest', label: 'Newest lead' },
  { code: 'oldest', label: 'Oldest lead' },
  { code: 'value',  label: 'Highest $ first' },
]
// Due-date sort rank: overdue → today → upcoming → no-due.
const urgRank = (u) => (u === 'overdue' ? 0 : u === 'today' ? 1 : u === 'future' ? 2 : 3)

export default function LeadsView({ orders = [], onOpenDetail, onConvert, onChanged }) {
  const [todayISO, setTodayISO] = useState('')
  const [tasks, setTasks] = useState([])              // all open tasks across leads
  const [sortKey, setSortKey] = useState('due')
  const [refreshNonce, setRefreshNonce] = useState(0)
  const [menuKey, setMenuKey] = useState(null)        // open ⋯ menu key
  const [reminderFor, setReminderFor] = useState(null)// leadId for the inline reminder editor
  const [reminderDue, setReminderDue] = useState('')  // default due, computed when opening (off-render)
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
    if (!ids.length) { setTasks([]); return }
    getOpenTasksList(ids).then(list => { if (alive) setTasks(list) })
    return () => { alive = false }
  }, [leadIdsKey, refreshNonce])

  const refresh = () => setRefreshNonce(n => n + 1)

  // Open task rows, joined to their lead and sorted.
  const taskRows = useMemo(() => {
    const rows = tasks
      .map(t => { const lead = leadById[t.order_id]; return lead ? { task: t, lead } : null })
      .filter(Boolean)
      .map(r => ({ ...r, urgency: followUpUrgency(r.task.due_date, todayISO), value: rowGrandTotal(r.lead) }))
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
  }, [tasks, leadById, todayISO, sortKey])

  // Leads with no open task → the lighter "No reminder set" list.
  const taskedLeadIds = useMemo(() => new Set(tasks.map(t => t.order_id)), [tasks])
  const noTaskLeads = useMemo(() => {
    const list = leads.filter(l => !taskedLeadIds.has(l.id))
    return list.sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''))   // oldest-neglected first
  }, [leads, taskedLeadIds])

  const summary = useMemo(() => ({
    total: leads.reduce((s, l) => s + rowGrandTotal(l), 0),
    overdue: taskRows.filter(r => r.urgency === 'overdue').length,
    count: leads.length,
  }), [leads, taskRows])

  // ── Actions ───────────────────────────────────────────────────────────────
  const openReminder = (leadId) => { setMenuKey(null); setReminderDue(todayStr()); setReminderFor(leadId) }

  const markDone = async (task) => {
    setBusyId(task.id); setMenuKey(null)
    const res = await setOrderTaskStatus(task.id, 'done')
    if (res?.ok !== false) setTasks(prev => prev.filter(t => t.id !== task.id))   // optimistic; leaves open list
    setBusyId(null)
  }

  const saveReminder = async (leadId, label, due) => {
    const text = (label || '').trim()
    if (!text) return
    const dueDate = due || todayStr()
    const actor = await getCurrentStaffName().catch(() => null)
    await addOrderTask(leadId, { note: text, dueDate, actor })
    await updateOrderLeadFields(leadId, { next_follow_up: dueDate })   // mirror for the rest of the app
    setReminderFor(null)
    refresh()
  }

  const archiveLead = async (leadId) => {
    setBusyId(leadId); setMenuKey(null)
    const res = await bulkArchiveOrders([leadId])
    setBusyId(null)
    if (res?.ok === false) { window.alert('Could not archive the lead.'); return }
    onChanged?.()   // reload drops it from the active board
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

  // Shared ⋯ menu item set for a lead (task optional).
  const menuItems = (lead, task) => {
    const name = leadName(lead)
    const items = [
      { label: 'Open lead', onClick: () => { setMenuKey(null); onOpenDetail?.(lead.id) } },
      { label: task ? 'Add another reminder' : 'Set reminder', onClick: () => openReminder(lead.id) },
    ]
    if (task) items.push({ label: 'Mark done', onClick: () => markDone(task) })
    items.push({ label: 'Convert to order →', onClick: () => { setMenuKey(null); onConvert?.(lead.id) } })
    items.push({ label: 'Archive lead', onClick: () => archiveLead(lead.id) })
    items.push({ label: 'Delete lead', danger: true, onClick: () => deleteLead(lead.id, name) })
    return items
  }

  return (
    <div className="sb-leads">
      <style>{CSS}</style>

      <div className="sb-leads-summary">
        <div className="sb-leads-stat"><span className="sb-leads-stat-num">{fmtUSD(summary.total)}</span><span className="sb-leads-stat-lab">open estimates</span></div>
        <div className="sb-leads-stat"><span className={`sb-leads-stat-num${summary.overdue > 0 ? ' sb-leads-red' : ''}`}>{summary.overdue}</span><span className="sb-leads-stat-lab">overdue reminders</span></div>
        <div className="sb-leads-stat"><span className="sb-leads-stat-num">{summary.count}</span><span className="sb-leads-stat-lab">{summary.count === 1 ? 'lead' : 'leads'}</span></div>
      </div>

      <div className="sb-leads-sortbar">
        <span className="sb-leads-sortlab">Sort</span>
        <select className="sb-leads-sortsel" value={sortKey} onChange={e => setSortKey(e.target.value)}>
          {SORT_OPTIONS.map(o => <option key={o.code} value={o.code}>{o.label}</option>)}
        </select>
      </div>

      {reminderFor && (
        <ReminderEditor key={reminderFor} lead={leadById[reminderFor]} defaultDue={reminderDue}
          onSave={(label, due) => saveReminder(reminderFor, label, due)}
          onCancel={() => setReminderFor(null)} />
      )}

      {/* Task table */}
      {taskRows.length === 0 ? (
        <div className="sb-lt-empty">No open reminders. Add one from a lead below, or in “+ New Lead”.</div>
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
            {taskRows.map(({ task, lead, urgency }) => {
              const key = `t:${task.id}`
              return (
                <tr key={task.id} className="sb-lt-row">
                  <td className="sb-lt-c-check">
                    <input type="checkbox" disabled={busyId === task.id} onChange={() => markDone(task)} title="Mark done" />
                  </td>
                  <td className="sb-lt-c-rem">
                    <button type="button" className="sb-lt-link sb-lt-rem" onClick={() => onOpenDetail?.(lead.id)}>{task.note}</button>
                  </td>
                  <td className="sb-lt-c-lead">
                    <button type="button" className="sb-lt-link sb-lt-leadname" onClick={() => onOpenDetail?.(lead.id)}>{leadName(lead)}</button>
                  </td>
                  <td className="sb-lt-c-due">
                    {task.due_date
                      ? <span className={`sb-lt-due sb-lt-due-${urgency}`}>{fmtDate(task.due_date)}</span>
                      : <span className="sb-lt-due-none">—</span>}
                  </td>
                  <td className="sb-lt-c-contact">{lead.customer?.phone_primary ? fmtPhone(lead.customer.phone_primary) : '—'}</td>
                  <td className="sb-lt-c-act">
                    <RowMenu open={menuKey === key} onToggle={() => setMenuKey(menuKey === key ? null : key)} items={menuItems(lead, task)} />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}

      {/* Leads with no reminder yet — don't let them vanish. */}
      {noTaskLeads.length > 0 && (
        <div className="sb-lt-noset">
          <div className="sb-lt-noset-head">No reminder set ({noTaskLeads.length})</div>
          <table className="sb-lt sb-lt-light">
            <tbody>
              {noTaskLeads.map(lead => {
                const key = `l:${lead.id}`
                return (
                  <tr key={lead.id} className="sb-lt-row">
                    <td className="sb-lt-c-lead">
                      <button type="button" className="sb-lt-link sb-lt-leadname" onClick={() => onOpenDetail?.(lead.id)}>{leadName(lead)}</button>
                      <span className="sb-lt-sub">{lead.order_number || 'EST'}{lead.sales_rep ? ` · ${lead.sales_rep}` : ''}</span>
                    </td>
                    <td className="sb-lt-c-contact">{lead.customer?.phone_primary ? fmtPhone(lead.customer.phone_primary) : '—'}</td>
                    <td className="sb-lt-c-setrem">
                      <button type="button" className="sb-lt-setbtn" onClick={() => openReminder(lead.id)}>+ Set reminder</button>
                    </td>
                    <td className="sb-lt-c-act">
                      <RowMenu open={menuKey === key} onToggle={() => setMenuKey(menuKey === key ? null : key)} items={menuItems(lead, null)} />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ── Inline reminder editor ──────────────────────────────────────────────────
function ReminderEditor({ lead, defaultDue, onSave, onCancel }) {
  const [label, setLabel] = useState('')
  const [due, setDue] = useState(defaultDue || '')
  const name = lead ? leadName(lead) : 'this lead'
  return (
    <div className="sb-lt-remedit">
      <span className="sb-lt-remedit-lab">Reminder for {name}</span>
      <input className="sb-lt-input" type="text" autoFocus value={label}
        placeholder="What to do — Call back · Coming in Tue noon · Send quote"
        onChange={e => setLabel(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' && label.trim()) onSave(label, due) }} />
      <input className="sb-lt-input sb-lt-input-date" type="date" value={due} onChange={e => setDue(e.target.value)} />
      <button type="button" className="sb-lt-savebtn" disabled={!label.trim()} onClick={() => onSave(label, due)}>Add</button>
      <button type="button" className="sb-lt-cancelbtn" onClick={onCancel}>Cancel</button>
    </div>
  )
}

// ── ⋯ row action menu ───────────────────────────────────────────────────────
function RowMenu({ open, onToggle, items }) {
  return (
    <div className="sb-lt-menuwrap">
      <button type="button" className="sb-lt-menubtn" title="Actions" onClick={onToggle}>⋯</button>
      {open && (
        <>
          <div className="sb-lt-menuback" onClick={onToggle} />
          <div className="sb-lt-menu">
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
.sb-leads-summary { display: flex; gap: 28px; padding: 14px 18px; background: #fff; border: 1px solid #ece6d8; border-radius: 10px; margin-bottom: 14px; }
.sb-leads-stat { display: flex; flex-direction: column; }
.sb-leads-stat-num { font-size: 22px; font-weight: 700; color: #1a1a1a; }
.sb-leads-stat-lab { font-size: 12px; color: #8a8472; }
.sb-leads-red { color: #b3261e; }
.sb-leads-sortbar { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; }
.sb-leads-sortlab { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: #8a8472; }
.sb-leads-sortsel { font: inherit; font-size: 13px; padding: 6px 10px; border: 1px solid #d8d2c4; border-radius: 8px; background: #fff; color: #1a1a1a; cursor: pointer; }
.sb-leads-sortsel:focus { outline: none; border-color: #9A7209; }

/* Reminder editor */
.sb-lt-remedit { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; background: #fdf8ec; border: 1px solid #e8d9a8; border-radius: 9px; padding: 9px 12px; margin-bottom: 12px; }
.sb-lt-remedit-lab { font-size: 12px; font-weight: 700; color: #7a5d12; }
.sb-lt-input { flex: 1 1 240px; min-width: 160px; font: inherit; font-size: 13px; padding: 6px 9px; border: 1px solid #d8d2c4; border-radius: 6px; background: #fff; }
.sb-lt-input-date { flex: 0 0 auto; }
.sb-lt-input:focus { outline: none; border-color: #9A7209; }
.sb-lt-savebtn { border: 1px solid #9a7209; background: #9a7209; color: #fff; border-radius: 6px; padding: 6px 14px; font-weight: 600; cursor: pointer; }
.sb-lt-savebtn:disabled { opacity: 0.5; cursor: default; }
.sb-lt-cancelbtn { border: none; background: none; color: #8a8472; font-weight: 600; cursor: pointer; }

/* Task table */
.sb-lt-empty { padding: 30px; text-align: center; color: #8a8472; background: #fff; border: 1px solid #ece6d8; border-radius: 10px; }
.sb-lt { width: 100%; border-collapse: collapse; background: #fff; border: 1px solid #ece6d8; border-radius: 10px; overflow: hidden; }
.sb-lt thead th { text-align: left; font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.06em; color: #9a9486; font-weight: 700; padding: 9px 12px; background: #faf8f3; border-bottom: 1px solid #ece6d8; }
.sb-lt tbody td { padding: 9px 12px; border-bottom: 1px solid #f3f0e8; font-size: 13.5px; color: #2a2a2a; vertical-align: middle; }
.sb-lt tbody tr:last-child td { border-bottom: none; }
.sb-lt-row:hover td { background: #faf8f3; }
.sb-lt-c-check { width: 34px; text-align: center; }
.sb-lt-c-check input { width: 16px; height: 16px; accent-color: #2d7a4f; cursor: pointer; }
.sb-lt-c-due { width: 116px; white-space: nowrap; }
.sb-lt-c-contact { width: 140px; white-space: nowrap; color: #555; font-variant-numeric: tabular-nums; }
.sb-lt-c-act { width: 44px; text-align: right; }
.sb-lt-link { background: none; border: none; padding: 0; font: inherit; text-align: left; cursor: pointer; color: #2a2a2a; }
.sb-lt-rem { font-weight: 600; color: #1a1a1a; }
.sb-lt-link:hover { color: #9A7209; text-decoration: underline; }
.sb-lt-leadname { color: #1d4ed8; font-weight: 600; }
.sb-lt-sub { display: block; font-size: 11.5px; color: #8a8472; }
.sb-lt-due { font-size: 12.5px; font-weight: 600; border-radius: 6px; padding: 2px 8px; white-space: nowrap; }
.sb-lt-due-overdue { color: #b3261e; background: #fbeaea; }
.sb-lt-due-today { color: #7a4a12; background: #fdf2e9; }
.sb-lt-due-future { color: #555; }
.sb-lt-due-none { color: #c2bdb2; }

/* No-reminder list (lighter) */
.sb-lt-noset { margin-top: 18px; }
.sb-lt-noset-head { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: #9a9486; margin-bottom: 7px; }
.sb-lt-light { background: #fcfbf8; }
.sb-lt-light tbody td { color: #5d5d5a; }
.sb-lt-c-setrem { width: 130px; }
.sb-lt-setbtn { border: 1px solid #d8c89a; background: #fdf8ec; color: #7a5d12; border-radius: 6px; padding: 4px 10px; font-size: 12.5px; font-weight: 600; cursor: pointer; }
.sb-lt-setbtn:hover { background: #f7eccb; }

/* ⋯ menu */
.sb-lt-menuwrap { position: relative; display: inline-block; }
.sb-lt-menubtn { border: none; background: none; font-size: 18px; line-height: 1; color: #8a8472; cursor: pointer; padding: 2px 6px; border-radius: 6px; }
.sb-lt-menubtn:hover { background: #f1ede3; color: #5d5d5a; }
.sb-lt-menuback { position: fixed; inset: 0; z-index: 40; }
.sb-lt-menu { position: absolute; right: 0; top: 100%; z-index: 41; background: #fff; border: 1px solid #e0dccf; border-radius: 9px; box-shadow: 0 10px 30px rgba(0,0,0,0.16); padding: 5px; min-width: 178px; display: flex; flex-direction: column; }
.sb-lt-menuitem { text-align: left; background: none; border: none; font: inherit; font-size: 13.5px; color: #2a2a2a; padding: 8px 11px; border-radius: 6px; cursor: pointer; white-space: nowrap; }
.sb-lt-menuitem:hover:not(:disabled) { background: #f4f2ec; }
.sb-lt-menuitem:disabled { opacity: 0.45; cursor: default; }
.sb-lt-menuitem.danger { color: #b3261e; }
.sb-lt-menuitem.danger:hover { background: #fbeaea; }

@media (max-width: 760px) {
  .sb-lt-c-contact { display: none; }
}
`
