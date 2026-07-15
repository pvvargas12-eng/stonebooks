// =============================================================================
// 📚 Stonebooks — TODAY = TASK COMMAND CENTER (Paul 2026-07-15)
// =============================================================================
// The Today tab IS the task command center now — nothing else. (Self-check,
// needs-you, approvals-out, open-loops, yesterday, shop pulse all removed per
// Paul: "this today tab is really the task command center".) Money lives in
// Reports; approvals live on the order; schedule lives in the Scheduler.
//
// Doctrine: every task in the shop — created here, on a lead, on an order, in
// Design Hub, or as a check job — lives in shop_tasks and shows up HERE.
// Nothing falls through the cracks.
//
//  • "I am" picker: pick yourself → the view highlights your work and every
//    task you create is stamped "tasked by you" (hover the stamp to override).
//  • Views: List (day strip + filters) · Week board (Planner-style buckets,
//    drag a card to another day to reschedule) · By person · Dashboard
//    (what you assigned, per-person status bars).
//  • Statuses: open → pending (worked on / waiting on something) → done.
//  • Anyone can edit or delete any task (delete is soft — deleted_by trail).
//  • Replies = the comment loop; a reply is an inbox item for the other side
//    until marked handled ("seen").
//  • Attachments: upload straight to the task; order-linked uploads land in
//    the order's attachment list too, and you can pick existing order
//    attachments onto the task.
// =============================================================================

import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import {
  listAllOrders,
  listShopTasks, addShopTask, updateShopTask, setShopTaskStatus, deleteShopTask, snoozeShopTask,
  listTaskReplies, addTaskReply, markReplyHandled,
  uploadTaskAttachment, listOrderAttachments,
  TASK_TYPES, taskTypeLabel,
  STAFF_NAMES, getActiveStaffUser, setActiveStaffUser,
  fmtDate, customerName,
} from './lib/stonebooksData'
import { DEPARTMENTS, loadEmployees, getActiveEmployees } from './lib/employees'

const pad = (n) => String(n).padStart(2, '0')
const isoOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)
const dayLabel = (d) => d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
const shortDay = (iso) => {
  const d = new Date(String(iso).slice(0, 10) + 'T00:00:00')
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'numeric', day: 'numeric' })
}
const famOf = (o) => {
  const raw = (o?.primary_lastname && String(o.primary_lastname).trim())
    || (o?.customer?.last_name && String(o.customer.last_name).trim())
    || customerName(o?.customer) || '—'
  return String(raw).toLowerCase().replace(/(^|[\s'’-])([a-z])/g, (_, s, c) => s + c.toUpperCase())
}
const daysBetween = (fromIso, toIso) => {
  const a = Date.parse(String(fromIso).slice(0, 10) + 'T00:00:00')
  const b = Date.parse(String(toIso).slice(0, 10) + 'T00:00:00')
  if (Number.isNaN(a) || Number.isNaN(b)) return null
  return Math.max(0, Math.floor((b - a) / 86400000))
}
// A lead is an unsigned order still in an uncontracted pipeline status
// (same test as ensureLeadCadence / the task-type backfill).
const isLeadOrder = (o) => !!o && !o.signed_at && ['draft', 'scoping', 'quoted'].includes(o.status)

// Manual-create task types (lead/order are auto-set by the link; check jobs
// are created from inside the lead/order itself).
const FORM_TYPES = ['general', 'design', 'production']

const TYPE_CLS = {
  lead: 'lead', order: 'order', design: 'design', layout: 'design',
  production: 'prod', check_job: 'check', general: 'gen',
}

export default function TodayTab({ user, profile, onOpenSales, onOpenOrder, onOpenOrderDetail, onOpenJob, onOpenCustomer }) { // eslint-disable-line no-unused-vars
  const [now] = useState(() => new Date())
  const todayISO = isoOf(now)
  const tmrwISO = isoOf(addDays(now, 1))
  const weekISOs = useMemo(() => [0, 1, 2, 3, 4].map(n => isoOf(addDays(now, n))), [now])

  const openOrder = onOpenOrderDetail || onOpenOrder

  const [me, setMe] = useState(() => getActiveStaffUser())
  const pickMe = (name) => { setActiveStaffUser(name); setMe(name) }

  const [staff, setStaff] = useState(() => [...STAFF_NAMES])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState(null)
  const [orders, setOrders] = useState([])
  const [tasks, setTasks] = useState([])
  const [replies, setReplies] = useState([])
  const [busyId, setBusyId] = useState(null)

  const [view, setView] = useState('list')          // list | board | people | dash
  const [dayFilter, setDayFilter] = useState('all') // all | overdue | nodate | <iso>
  const [whoFilter, setWhoFilter] = useState('all') // all | <name> | dept:<name>
  const [typeFilter, setTypeFilter] = useState('all')
  const [showDone, setShowDone] = useState(false)
  const [openTaskId, setOpenTaskId] = useState(null) // expanded row (thread/edit)

  const reloadTasks = useCallback(async () => {
    const ts = await listShopTasks()
    setTasks(ts)
    setReplies(await listTaskReplies(ts.map(t => t.id)))
  }, [])

  const loadAll = useCallback(async () => {
    setLoading(true); setErr(null)
    try {
      const [os, ts] = await Promise.all([
        listAllOrders({ archived: false, limit: 2000 }),
        listShopTasks(),
      ])
      setOrders(os || [])
      setTasks(ts || [])
      setReplies(await listTaskReplies((ts || []).map(t => t.id)))
      const emp = await loadEmployees()
      if (emp) setStaff(getActiveEmployees().map(e => e.name))
    } catch (e) { setErr(e?.message || 'Failed to load the command center') }
    setLoading(false)
  }, [])
  useEffect(() => { loadAll() }, [loadAll])

  // ── Task partitions ─────────────────────────────────────────────────────────
  const live = useMemo(() =>
    tasks.filter(t => t.status !== 'done' && (!t.snoozed_until || t.snoozed_until <= todayISO)),
  [tasks, todayISO])
  const snoozedCount = useMemo(() =>
    tasks.filter(t => t.status !== 'done' && t.snoozed_until && t.snoozed_until > todayISO).length,
  [tasks, todayISO])
  const doneRecent = useMemo(() => tasks.filter(t => t.status === 'done'), [tasks])
  const isOverdue = useCallback((t) => t.status !== 'done' && t.due_date && t.due_date < todayISO, [todayISO])

  const stats = useMemo(() => ({
    open: live.filter(t => t.status === 'open').length,
    pending: live.filter(t => t.status === 'pending').length,
    overdue: live.filter(isOverdue).length,
    doneToday: doneRecent.filter(t => String(t.done_at || '').slice(0, 10) === todayISO).length,
  }), [live, doneRecent, isOverdue, todayISO])

  // ── Filters (shared by List view; board/people/dash use who+type only) ─────
  const matchesWho = useCallback((t) => {
    if (whoFilter === 'all') return true
    if (whoFilter.startsWith('dept:')) return t.assignee_kind === 'department' && t.assignee === whoFilter.slice(5)
    return t.assignee === whoFilter
  }, [whoFilter])
  const matchesType = useCallback((t) => typeFilter === 'all' || (t.task_type || 'general') === typeFilter, [typeFilter])

  const filteredLive = useMemo(() => live.filter(t => matchesWho(t) && matchesType(t)), [live, matchesWho, matchesType])
  const filteredDone = useMemo(() => doneRecent.filter(t => matchesWho(t) && matchesType(t)), [doneRecent, matchesWho, matchesType])

  const dayCounts = useMemo(() => {
    const m = { overdue: 0, nodate: 0 }
    for (const iso of weekISOs) m[iso] = 0
    for (const t of filteredLive) {
      if (isOverdue(t)) { m.overdue++; continue }
      if (!t.due_date) { m.nodate++; continue }
      if (m[t.due_date] != null) m[t.due_date]++
    }
    return m
  }, [filteredLive, weekISOs, isOverdue])

  const listTasks = useMemo(() => {
    let rows = filteredLive
    if (dayFilter === 'overdue') rows = rows.filter(isOverdue)
    else if (dayFilter === 'nodate') rows = rows.filter(t => !t.due_date && !isOverdue(t))
    else if (dayFilter !== 'all') rows = rows.filter(t => t.due_date === dayFilter && !isOverdue(t))
    const sorted = rows.slice().sort((a, b) => {
      const ao = isOverdue(a) ? 0 : 1, bo = isOverdue(b) ? 0 : 1
      if (ao !== bo) return ao - bo
      return String(a.due_date || '9999').localeCompare(String(b.due_date || '9999'))
        || String(a.created_at).localeCompare(String(b.created_at))
    })
    if (showDone && dayFilter === 'all') return [...sorted, ...filteredDone.slice(0, 20)]
    return sorted
  }, [filteredLive, filteredDone, dayFilter, isOverdue, showDone])

  // ── Replies / inbox ─────────────────────────────────────────────────────────
  const taskById = useMemo(() => new Map(tasks.map(t => [t.id, t])), [tasks])
  const repliesByTask = useMemo(() => {
    const m = new Map()
    for (const r of replies) { if (!m.has(r.task_id)) m.set(r.task_id, []); m.get(r.task_id).push(r) }
    return m
  }, [replies])
  const inbox = useMemo(() => {
    if (!me) return []
    return replies.filter(r => {
      if (r.handled_at) return false
      const t = taskById.get(r.task_id)
      if (!t) return false
      const creator = t.tasked_by || t.created_by || t.assignee
      const recipient = r.author === t.assignee ? creator : t.assignee
      return recipient === me && r.author !== me
    })
  }, [replies, taskById, me])

  // ── Actions ─────────────────────────────────────────────────────────────────
  const cycleStatus = async (t, status) => {
    setBusyId(t.id)
    await setShopTaskStatus(t.id, status, me || null)
    setBusyId(null); reloadTasks()
  }
  const removeTask = async (t) => {
    if (!window.confirm(`Delete "${t.title}"? It keeps a "deleted by ${me || 'staff'}" trail.`)) return
    await deleteShopTask(t.id, me || null); reloadTasks()
  }
  const snoozeTask = async (t) => { await snoozeShopTask(t.id, tmrwISO); reloadTasks() }
  const handleInbox = async (r) => { await markReplyHandled(r.id, me || null); reloadTasks() }
  const rescheduleTask = async (id, iso) => {
    const t = taskById.get(id)
    if (!t || t.due_date === iso) return
    await updateShopTask(id, { dueDate: iso })
    reloadTasks()
  }

  // ── Board drag state ────────────────────────────────────────────────────────
  const dragIdRef = useRef(null)

  if (loading) return <div className="sb-tcc"><style>{CSS}</style><div className="sb-tcc-empty">Loading the command center…</div></div>

  const whoOptions = (
    <>
      <option value="all">Everyone</option>
      {me && <option value={me}>Me ({me})</option>}
      <optgroup label="People">
        {staff.filter(n => n !== me).map(n => <option key={n} value={n}>{n}</option>)}
      </optgroup>
      <optgroup label="Departments">
        {DEPARTMENTS.map(d => <option key={d} value={`dept:${d}`}>{d}</option>)}
      </optgroup>
    </>
  )

  return (
    <div className="sb-tcc">
      <style>{CSS}</style>
      {err && <div className="sb-tcc-err">{err}</div>}

      <header className="sb-tcc-day">
        <h1>Task command center</h1>
        <span className="date">{dayLabel(now)}</span>
        <span className="spacer" />
        {stats.overdue > 0 && <span className="chip needs">{stats.overdue} overdue</span>}
      </header>

      <div className="sb-tcc-users">
        <span className="lab">I am</span>
        {staff.map(n => (
          <button key={n} type="button" className={`ubtn${me === n ? ' on' : ''}`} onClick={() => pickMe(n)}>{n}</button>
        ))}
        {!me && <span className="hint">— pick yourself so tasks carry your name</span>}
      </div>

      <div className="sb-tcc-bar">
        <div className="views">
          {[['list', 'List'], ['board', 'Week board'], ['people', 'By person'], ['dash', 'Dashboard']].map(([k, l]) => (
            <button key={k} type="button" className={`vtab${view === k ? ' on' : ''}`} onClick={() => setView(k)}>{l}</button>
          ))}
        </div>
        <span className="spacer" />
        <span className="stat blue">{stats.open} open</span>
        <span className="stat amber">{stats.pending} pending</span>
        <span className={`stat${stats.overdue ? ' red' : ''}`}>{stats.overdue} overdue</span>
        <span className="stat green">{stats.doneToday} done today</span>
        {snoozedCount > 0 && <span className="stat">{snoozedCount} snoozed</span>}
      </div>

      <NewTaskForm
        me={me} staff={staff} orders={orders} todayISO={todayISO}
        onCreated={reloadTasks}
      />

      {inbox.length > 0 && (
        <div className="sb-tcc-inbox">
          <span className="lab">Replies to you · {inbox.length}</span>
          {inbox.slice(0, 3).map(r => {
            const t = taskById.get(r.task_id)
            return (
              <span key={r.id} className="msg">
                <b>{r.author}</b> on "{t?.title || 'task'}": <i>"{r.body}"</i>
                <button type="button" className="act" onClick={() => handleInbox(r)}>Seen</button>
              </span>
            )
          })}
        </div>
      )}

      <div className="sb-tcc-filters">
        <select value={whoFilter} onChange={e => setWhoFilter(e.target.value)}>{whoOptions}</select>
        <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)}>
          <option value="all">All types</option>
          {TASK_TYPES.map(t => <option key={t.code} value={t.code}>{t.label}</option>)}
        </select>
        {view === 'list' && (
          <label className="donechk">
            <input type="checkbox" checked={showDone} onChange={e => setShowDone(e.target.checked)} /> show recently done
          </label>
        )}
      </div>

      {view === 'list' && (
        <>
          <div className="sb-tcc-days">
            <button type="button" className={`dchip${dayFilter === 'all' ? ' on' : ''}`} onClick={() => setDayFilter('all')}>
              <span className="dl">All</span><b>{filteredLive.length}</b>
            </button>
            <button type="button" className={`dchip red${dayFilter === 'overdue' ? ' on' : ''}`} onClick={() => setDayFilter('overdue')}>
              <span className="dl">Overdue</span><b>{dayCounts.overdue}</b>
            </button>
            {weekISOs.map((iso, i) => (
              <button key={iso} type="button" className={`dchip${dayFilter === iso ? ' on' : ''}`} onClick={() => setDayFilter(iso)}>
                <span className="dl">{i === 0 ? 'Today' : i === 1 ? 'Tmrw' : shortDay(iso)}</span><b>{dayCounts[iso]}</b>
              </button>
            ))}
            <button type="button" className={`dchip${dayFilter === 'nodate' ? ' on' : ''}`} onClick={() => setDayFilter('nodate')}>
              <span className="dl">No date</span><b>{dayCounts.nodate}</b>
            </button>
          </div>

          <div className="sb-tcc-card">
            {listTasks.length === 0 && <div className="sb-tcc-empty">Nothing here — task somebody.</div>}
            {listTasks.map(t => (
              <TaskRow key={t.id} t={t} me={me} staff={staff} todayISO={todayISO}
                busy={busyId === t.id}
                replies={repliesByTask.get(t.id) || []}
                expanded={openTaskId === t.id}
                onToggleExpand={() => setOpenTaskId(openTaskId === t.id ? null : t.id)}
                onStatus={cycleStatus} onSnooze={snoozeTask} onDelete={removeTask}
                onOpenOrder={openOrder} onChanged={reloadTasks} isOverdue={isOverdue}
              />
            ))}
          </div>
        </>
      )}

      {view === 'board' && (
        <div className="sb-tcc-board">
          <div className="bcol">
            <div className="bhead red"><span>Overdue</span><b>{filteredLive.filter(isOverdue).length}</b></div>
            {filteredLive.filter(isOverdue).map(t => (
              <BoardCard key={t.id} t={t} me={me} todayISO={todayISO} dragIdRef={dragIdRef}
                onClick={() => { setView('list'); setDayFilter('overdue'); setOpenTaskId(t.id) }} overdue />
            ))}
          </div>
          {weekISOs.map((iso, i) => (
            <div key={iso} className="bcol"
              onDragOver={e => e.preventDefault()}
              onDrop={e => { e.preventDefault(); if (dragIdRef.current) { rescheduleTask(dragIdRef.current, iso); dragIdRef.current = null } }}
            >
              <div className={`bhead${iso === todayISO ? ' today' : ''}`}>
                <span>{i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : ''} {shortDay(iso)}</span>
                <b>{filteredLive.filter(t => t.due_date === iso && !isOverdue(t)).length}</b>
              </div>
              {filteredLive.filter(t => t.due_date === iso && !isOverdue(t)).map(t => (
                <BoardCard key={t.id} t={t} me={me} todayISO={todayISO} dragIdRef={dragIdRef}
                  onClick={() => { setView('list'); setDayFilter(iso); setOpenTaskId(t.id) }} />
              ))}
            </div>
          ))}
          <div className="bcol"
            onDragOver={e => e.preventDefault()}
            onDrop={e => { e.preventDefault(); if (dragIdRef.current) { rescheduleTask(dragIdRef.current, null); dragIdRef.current = null } }}
          >
            <div className="bhead"><span>No date</span><b>{filteredLive.filter(t => !t.due_date).length}</b></div>
            {filteredLive.filter(t => !t.due_date).map(t => (
              <BoardCard key={t.id} t={t} me={me} todayISO={todayISO} dragIdRef={dragIdRef}
                onClick={() => { setView('list'); setDayFilter('nodate'); setOpenTaskId(t.id) }} />
            ))}
          </div>
        </div>
      )}

      {view === 'people' && (
        <div className="sb-tcc-people">
          {[...staff.map(n => ['person', n]), ...DEPARTMENTS.map(d => ['department', d])].map(([kind, name]) => {
            const rows = filteredLive.filter(t =>
              kind === 'department' ? (t.assignee_kind === 'department' && t.assignee === name)
                : (t.assignee_kind !== 'department' && t.assignee === name))
            if (kind === 'department' && rows.length === 0) return null
            return (
              <div key={`${kind}:${name}`} className="pcol">
                <h3>
                  {name}{kind === 'department' && <span className="depttag">dept</span>}
                  <span className="n">{rows.length}</span>
                  {rows.some(isOverdue) && <span className="overtag">{rows.filter(isOverdue).length} late</span>}
                </h3>
                {rows.slice().sort((a, b) => String(a.due_date || '9999').localeCompare(String(b.due_date || '9999'))).map(t => (
                  <BoardCard key={t.id} t={t} me={me} todayISO={todayISO} dragIdRef={dragIdRef} compact
                    onClick={() => { setView('list'); setDayFilter('all'); setOpenTaskId(t.id) }}
                    overdue={isOverdue(t)} />
                ))}
                {rows.length === 0 && <div className="pempty">clear</div>}
              </div>
            )
          })}
        </div>
      )}

      {view === 'dash' && (
        <Dashboard me={me} staff={staff} tasks={tasks} live={live} todayISO={todayISO} isOverdue={isOverdue} />
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// New task form — assignee (person or department), tasked-by auto-stamped
// from the "I am" picker (hover to override), due date, searchable order/lead
// link, attachments (upload now, or pick from the linked order's files).
// ═══════════════════════════════════════════════════════════════════════════
function NewTaskForm({ me, staff, orders, todayISO, onCreated }) {
  const [title, setTitle] = useState('')
  const [assignee, setAssignee] = useState('')
  const [due, setDue] = useState(todayISO)
  const [type, setType] = useState('general')
  const [taskedBy, setTaskedBy] = useState('')       // '' = auto (me)
  const [editingTaskedBy, setEditingTaskedBy] = useState(false)
  const [linked, setLinked] = useState(null)         // { id, label, isLead }
  const [query, setQuery] = useState('')
  const [attach, setAttach] = useState([])           // [{name,url,path}]
  const [orderFiles, setOrderFiles] = useState(null) // null = not loaded
  const [showPick, setShowPick] = useState(false)
  const [busy, setBusy] = useState(false)
  const [errMsg, setErrMsg] = useState(null)
  const fileRef = useRef(null)

  useEffect(() => { setAssignee(a => a || me || staff[0] || '') }, [me, staff])

  const effTaskedBy = taskedBy || me || ''

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (q.length < 2) return []
    return orders
      .filter(o => famOf(o).toLowerCase().includes(q) || String(o.order_number || '').toLowerCase().includes(q))
      .slice(0, 8)
      .map(o => ({ id: o.id, label: `${famOf(o)}${o.order_number ? ` · ${o.order_number}` : ''}`, isLead: isLeadOrder(o) }))
  }, [query, orders])

  const pickLink = async (r) => {
    setLinked(r); setQuery(''); setShowPick(false); setOrderFiles(null)
  }
  const loadOrderFiles = async () => {
    if (!linked) return
    setShowPick(v => !v)
    if (orderFiles === null) setOrderFiles(await listOrderAttachments(linked.id))
  }
  const onFileChosen = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setBusy(true); setErrMsg(null)
    const r = await uploadTaskAttachment({ orderId: linked?.id || null }, file)
    setBusy(false)
    if (!r.ok) { setErrMsg(r.error); return }
    setAttach(a => [...a, { name: r.name, url: r.url, path: r.path }])
    if (fileRef.current) fileRef.current.value = ''
  }

  const submit = async () => {
    setErrMsg(null)
    if (!title.trim()) { setErrMsg('Type the task.'); return }
    if (!assignee) { setErrMsg('Pick who it goes to.'); return }
    const isDept = DEPARTMENTS.includes(assignee)
    let taskType = type
    if (taskType === 'general' && linked) taskType = linked.isLead ? 'lead' : 'order'
    setBusy(true)
    const r = await addShopTask({
      title, assignee, assigneeKind: isDept ? 'department' : 'person',
      orderId: linked?.id || null, dueDate: due || null,
      createdBy: me || null, taskedBy: effTaskedBy || null,
      taskType, attachments: attach,
    })
    setBusy(false)
    if (!r.ok) { setErrMsg(r.error); return }
    setTitle(''); setLinked(null); setAttach([]); setType('general'); setOrderFiles(null); setShowPick(false)
    onCreated?.()
  }

  return (
    <div className="sb-tcc-new">
      <div className="row">
        <input type="text" className="big" placeholder="Task them — e.g. order the Perez photo, 8×10 porcelain"
          value={title} onChange={e => setTitle(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') submit() }} />
        <select value={assignee} onChange={e => setAssignee(e.target.value)} title="Assign to">
          <optgroup label="People">
            {staff.map(n => <option key={n} value={n}>{n === me ? `Me (${n})` : n}</option>)}
          </optgroup>
          <optgroup label="Departments">
            {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
          </optgroup>
        </select>
        <select value={type} onChange={e => setType(e.target.value)} title="Task type">
          {FORM_TYPES.map(c => <option key={c} value={c}>{taskTypeLabel(c)}</option>)}
        </select>
        <input type="date" value={due} onChange={e => setDue(e.target.value)} title="Due date" />
        <button type="button" className="act solid" disabled={busy} onClick={submit}>Task it</button>
      </div>
      <div className="row sub">
        <span className="tby" title="Who is assigning this task">
          Tasked by:{' '}
          {editingTaskedBy ? (
            <select autoFocus value={effTaskedBy} onChange={e => { setTaskedBy(e.target.value); setEditingTaskedBy(false) }} onBlur={() => setEditingTaskedBy(false)}>
              {staff.map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          ) : (
            <>
              <b>{effTaskedBy || 'pick yourself above'}</b>
              {!taskedBy && effTaskedBy && <span className="auto">auto</span>}
              <button type="button" className="tbedit" onClick={() => setEditingTaskedBy(true)}>change</button>
            </>
          )}
        </span>

        <span className="linkbox">
          {linked ? (
            <span className={`linkchip ${linked.isLead ? 'lead' : 'order'}`}>
              {linked.isLead ? 'Lead' : 'Order'} · {linked.label}
              <button type="button" onClick={() => { setLinked(null); setOrderFiles(null); setShowPick(false) }}>×</button>
            </span>
          ) : (
            <span className="linksearch">
              <input type="text" placeholder="Link order or lead — type to search" value={query} onChange={e => setQuery(e.target.value)} />
              {results.length > 0 && (
                <span className="linkresults">
                  {results.map(r => (
                    <button key={r.id} type="button" onClick={() => pickLink(r)}>
                      <span>{r.label}</span>
                      <em className={r.isLead ? 'lead' : 'order'}>{r.isLead ? 'Lead' : 'Order'}</em>
                    </button>
                  ))}
                </span>
              )}
            </span>
          )}
        </span>

        <span className="attachbox">
          <input ref={fileRef} type="file" style={{ display: 'none' }} onChange={onFileChosen} />
          <button type="button" className="act" disabled={busy} onClick={() => fileRef.current?.click()}>
            {busy ? 'Uploading…' : 'Attach file'}
          </button>
          {linked && <button type="button" className="act" onClick={loadOrderFiles}>From order files</button>}
          {attach.map((a, i) => (
            <span key={a.path || i} className="fchip">{a.name}
              <button type="button" onClick={() => setAttach(list => list.filter((_, j) => j !== i))}>×</button>
            </span>
          ))}
        </span>
        {errMsg && <span className="terr">{errMsg}</span>}
      </div>
      {showPick && (
        <div className="row pickrow">
          {orderFiles === null && <span className="pempty">Loading order files…</span>}
          {orderFiles && orderFiles.length === 0 && <span className="pempty">The order has no attachments yet.</span>}
          {(orderFiles || []).map(f => {
            const on = attach.some(a => a.path === f.path)
            return (
              <button key={f.path} type="button" className={`fpick${on ? ' on' : ''}`}
                onClick={() => setAttach(list => on ? list.filter(a => a.path !== f.path) : [...list, { name: f.name, url: f.url, path: f.path }])}>
                {f.name}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// One task row (list view) + expandable panel: thread, attachments, edit.
// ═══════════════════════════════════════════════════════════════════════════
function TaskRow({ t, me, staff, todayISO, busy, replies, expanded, onToggleExpand, onStatus, onSnooze, onDelete, onOpenOrder, onChanged, isOverdue }) {
  const over = isOverdue(t)
  const dueText = t.status === 'done'
    ? `done${t.done_at ? ' ' + fmtDate(t.done_at) : ''}${t.done_by ? ' · ' + t.done_by : ''}`
    : !t.due_date ? 'no date'
      : over ? `${daysBetween(t.due_date, todayISO)}d late`
        : t.due_date === todayISO ? 'today' : fmtDate(t.due_date)
  const attachments = Array.isArray(t.attachments) ? t.attachments : []
  const typeCode = t.task_type || 'general'

  return (
    <div className={`sb-tcc-trow${t.status === 'done' ? ' done' : ''}${over ? ' over' : ''}`}>
      <div className="main">
        <input type="checkbox" checked={t.status === 'done'} disabled={busy}
          onChange={() => onStatus(t, t.status === 'done' ? 'open' : 'done')} aria-label="Done" />
        <button type="button" className="txt" onClick={onToggleExpand} title="Open thread & details">
          {t.title}
          {attachments.length > 0 && <span className="meta"> · {attachments.length} file{attachments.length === 1 ? '' : 's'}</span>}
          {replies.length > 0 && <span className="meta"> · {replies.length} repl{replies.length === 1 ? 'y' : 'ies'}</span>}
        </button>
        <span className={`tbadge ${TYPE_CLS[typeCode] || 'gen'}`}>{taskTypeLabel(typeCode)}</span>
        {t.order && (
          <button type="button" className="oc" onClick={() => onOpenOrder?.(t.order.id)}>
            {t.order.order_number || famOf(t.order)}
          </button>
        )}
        <span className="chain">
          <em>{t.tasked_by || t.created_by || '—'}</em> → <b>{t.assignee}{t.assignee_kind === 'department' ? ' (dept)' : ''}</b>
        </span>
        <span className={`due${over ? ' over' : t.due_date === todayISO && t.status !== 'done' ? ' today' : ''}`}>{dueText}</span>
        {t.status !== 'done' && (
          <button type="button" className={`pendbtn${t.status === 'pending' ? ' on' : ''}`} disabled={busy}
            title="Pending = worked on / waiting on something"
            onClick={() => onStatus(t, t.status === 'pending' ? 'open' : 'pending')}>
            {t.status === 'pending' ? 'Pending' : 'Mark pending'}
          </button>
        )}
        {t.status !== 'done' && <button type="button" className="rbtn" title="Push to tomorrow — it comes back" onClick={() => onSnooze(t)}>→ tmrw</button>}
        <button type="button" className="xbtn" title="Delete task" onClick={() => onDelete(t)}>×</button>
      </div>
      {expanded && (
        <TaskDetail t={t} me={me} staff={staff} replies={replies} onChanged={onChanged} />
      )}
    </div>
  )
}

function TaskDetail({ t, me, staff, replies, onChanged }) {
  const [title, setTitle] = useState(t.title)
  const [assignee, setAssignee] = useState(t.assignee)
  const [due, setDue] = useState(t.due_date || '')
  const [taskedBy, setTaskedBy] = useState(t.tasked_by || t.created_by || '')
  const [replyText, setReplyText] = useState('')
  const [busy, setBusy] = useState(false)
  const [errMsg, setErrMsg] = useState(null)
  const [orderFiles, setOrderFiles] = useState(null)
  const [showPick, setShowPick] = useState(false)
  const fileRef = useRef(null)
  const attachments = Array.isArray(t.attachments) ? t.attachments : []
  const details = t.details || {}

  const dirty = title !== t.title || assignee !== t.assignee || (due || null) !== (t.due_date || null) || taskedBy !== (t.tasked_by || t.created_by || '')

  const save = async () => {
    setBusy(true); setErrMsg(null)
    const isDept = DEPARTMENTS.includes(assignee)
    const r = await updateShopTask(t.id, {
      title, assignee, assigneeKind: isDept ? 'department' : 'person',
      dueDate: due || null, taskedBy: taskedBy || null,
    })
    setBusy(false)
    if (!r.ok) { setErrMsg(r.error); return }
    onChanged?.()
  }
  const sendReply = async () => {
    if (!replyText.trim()) return
    setBusy(true)
    const r = await addTaskReply(t.id, replyText, me || 'Staff')
    setBusy(false)
    if (r.ok) { setReplyText(''); onChanged?.() }
  }
  const markSeen = async (r) => { await markReplyHandled(r.id, me || null); onChanged?.() }
  const onFileChosen = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setBusy(true); setErrMsg(null)
    const up = await uploadTaskAttachment({ orderId: t.order_id || null, taskId: t.id }, file)
    if (up.ok) {
      const r = await updateShopTask(t.id, { attachments: [...attachments, { name: up.name, url: up.url, path: up.path }] })
      if (!r.ok) setErrMsg(r.error)
      else onChanged?.()
    } else setErrMsg(up.error)
    setBusy(false)
    if (fileRef.current) fileRef.current.value = ''
  }
  const loadOrderFiles = async () => {
    setShowPick(v => !v)
    if (orderFiles === null && t.order_id) setOrderFiles(await listOrderAttachments(t.order_id))
  }
  const toggleOrderFile = async (f) => {
    const on = attachments.some(a => a.path === f.path)
    const next = on ? attachments.filter(a => a.path !== f.path) : [...attachments, { name: f.name, url: f.url, path: f.path }]
    const r = await updateShopTask(t.id, { attachments: next })
    if (r.ok) onChanged?.()
  }
  const removeAttachment = async (a) => {
    const r = await updateShopTask(t.id, { attachments: attachments.filter(x => x.path !== a.path) })
    if (r.ok) onChanged?.()
  }

  return (
    <div className="sb-tcc-detail">
      {(details.cemeteryName || details.cemetery) && (
        <div className="cemline">Cemetery: <b>{details.cemeteryName || details.cemetery}</b>{details.notes ? ` — ${details.notes}` : ''}</div>
      )}

      <div className="editrow">
        <input type="text" value={title} onChange={e => setTitle(e.target.value)} />
        <select value={assignee} onChange={e => setAssignee(e.target.value)}>
          <optgroup label="People">{staff.map(n => <option key={n} value={n}>{n}</option>)}</optgroup>
          <optgroup label="Departments">{DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}</optgroup>
        </select>
        <select value={taskedBy} onChange={e => setTaskedBy(e.target.value)} title="Tasked by">
          <option value="">Tasked by…</option>
          {staff.map(n => <option key={n} value={n}>{n}</option>)}
        </select>
        <input type="date" value={due} onChange={e => setDue(e.target.value)} />
        {dirty && <button type="button" className="act solid" disabled={busy} onClick={save}>Save</button>}
        {errMsg && <span className="terr">{errMsg}</span>}
      </div>

      <div className="attachrow">
        {attachments.map(a => (
          <span key={a.path} className="fchip">
            <a href={a.url} target="_blank" rel="noreferrer">{a.name}</a>
            <button type="button" onClick={() => removeAttachment(a)}>×</button>
          </span>
        ))}
        <input ref={fileRef} type="file" style={{ display: 'none' }} onChange={onFileChosen} />
        <button type="button" className="act" disabled={busy} onClick={() => fileRef.current?.click()}>
          {busy ? 'Working…' : '+ Attach file'}
        </button>
        {t.order_id && <button type="button" className="act" onClick={loadOrderFiles}>From order files</button>}
      </div>
      {showPick && (
        <div className="pickrow">
          {orderFiles === null && <span className="pempty">Loading order files…</span>}
          {orderFiles && orderFiles.length === 0 && <span className="pempty">The order has no attachments yet.</span>}
          {(orderFiles || []).map(f => {
            const on = attachments.some(a => a.path === f.path)
            return (
              <button key={f.path} type="button" className={`fpick${on ? ' on' : ''}`} onClick={() => toggleOrderFile(f)}>{f.name}</button>
            )
          })}
        </div>
      )}

      <div className="thread">
        {replies.map(r => (
          <div key={r.id} className="reply">
            <b>{r.author}</b>
            <span className="body">{r.body}</span>
            <span className="when">{fmtDate(r.created_at)}</span>
            {r.handled_at
              ? <span className="seen">seen{r.handled_by ? ` by ${r.handled_by}` : ''}</span>
              : (r.author !== me && <button type="button" className="rbtn" onClick={() => markSeen(r)}>Seen</button>)}
          </div>
        ))}
        <div className="replybox">
          <input type="text" value={replyText} placeholder={`Comment as ${me || 'Staff'}…`}
            onChange={e => setReplyText(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') sendReply() }} />
          <button type="button" className="rbtn" disabled={busy} onClick={sendReply}>Send</button>
        </div>
      </div>

      <div className="metaline">
        Created {fmtDate(t.created_at)}{t.created_by ? ` by ${t.created_by}` : ''}
        {t.legacy_activity_id ? ' · migrated from the old lead/order task list' : ''}
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// Board / person-column card
// ═══════════════════════════════════════════════════════════════════════════
function BoardCard({ t, todayISO, dragIdRef, onClick, overdue = false, compact = false }) {
  const attachments = Array.isArray(t.attachments) ? t.attachments : []
  const typeCode = t.task_type || 'general'
  return (
    <div className={`sb-tcc-bcard${overdue ? ' over' : ''}${t.status === 'pending' ? ' pend' : ''}`}
      draggable onDragStart={() => { dragIdRef.current = t.id }}
      onClick={onClick} role="button" tabIndex={0}
      onKeyDown={e => { if (e.key === 'Enter') onClick?.() }}
    >
      <div className="top">
        <span className={`tbadge ${TYPE_CLS[typeCode] || 'gen'}`}>{taskTypeLabel(typeCode)}</span>
        {t.status === 'pending' && <span className="pendtag">pending</span>}
        {overdue && t.due_date && <span className="latetag">{daysBetween(t.due_date, todayISO)}d late</span>}
      </div>
      <div className="title">{t.title}</div>
      <div className="foot">
        <span className="who">{t.assignee}{t.assignee_kind === 'department' ? ' (dept)' : ''}</span>
        {!compact && t.order && <span className="ord">{t.order.order_number || famOf(t.order)}</span>}
        {attachments.length > 0 && <span className="mch">{attachments.length}f</span>}
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// Dashboard — what YOU assigned, and where every person stands.
// ═══════════════════════════════════════════════════════════════════════════
function Dashboard({ me, staff, tasks, live, todayISO, isOverdue }) {
  const weekAgoISO = useMemo(() => {
    const d = new Date(todayISO + 'T00:00:00'); d.setDate(d.getDate() - 7); return isoOf(d)
  }, [todayISO])

  const mine = useMemo(() => me ? tasks.filter(t => (t.tasked_by || t.created_by) === me) : [], [tasks, me])
  const mineLive = mine.filter(t => t.status !== 'done')
  const mineDoneWeek = mine.filter(t => t.status === 'done' && String(t.done_at || '').slice(0, 10) >= weekAgoISO)

  const perPerson = useMemo(() => {
    const names = [...staff, ...DEPARTMENTS]
    return names.map(name => {
      const rows = mine.filter(t => t.assignee === name)
      if (!rows.length) return null
      const c = {
        open: rows.filter(t => t.status === 'open' && !isOverdue(t)).length,
        pending: rows.filter(t => t.status === 'pending' && !isOverdue(t)).length,
        overdue: rows.filter(isOverdue).length,
        done: rows.filter(t => t.status === 'done' && String(t.done_at || '').slice(0, 10) >= weekAgoISO).length,
      }
      const total = c.open + c.pending + c.overdue + c.done
      if (!total) return null
      return { name, dept: DEPARTMENTS.includes(name), c, total }
    }).filter(Boolean)
  }, [mine, staff, isOverdue, weekAgoISO])

  if (!me) return <div className="sb-tcc-card"><div className="sb-tcc-empty">Pick yourself in the "I am" row to see your dashboard.</div></div>

  const myWork = live.filter(t => t.assignee === me)

  return (
    <>
      <div className="sb-tcc-dash">
        <div className="mcard"><span>You assigned (live)</span><b>{mineLive.length}</b></div>
        <div className="mcard"><span>Still open</span><b className="blue">{mineLive.filter(t => t.status === 'open').length}</b></div>
        <div className="mcard"><span>Pending reply</span><b className="amber">{mineLive.filter(t => t.status === 'pending').length}</b></div>
        <div className="mcard"><span>Overdue</span><b className="red">{mineLive.filter(isOverdue).length}</b></div>
        <div className="mcard"><span>Done this week</span><b className="green">{mineDoneWeek.length}</b></div>
        <div className="mcard"><span>On your plate</span><b>{myWork.length}</b></div>
      </div>

      <div className="sb-tcc-card sb-tcc-bars">
        <h2>Tasks you assigned, by person <span className="why-note">live + done this week</span></h2>
        {perPerson.length === 0 && <div className="sb-tcc-empty">You haven't assigned any tasks yet.</div>}
        {perPerson.map(({ name, dept, c, total }) => (
          <div key={name} className="prow">
            <span className="pname">{name}{dept ? ' (dept)' : ''}</span>
            <span className="pbar">
              {c.overdue > 0 && <span className="seg red" style={{ width: `${(c.overdue / total) * 100}%` }} />}
              {c.open > 0 && <span className="seg blue" style={{ width: `${(c.open / total) * 100}%` }} />}
              {c.pending > 0 && <span className="seg amber" style={{ width: `${(c.pending / total) * 100}%` }} />}
              {c.done > 0 && <span className="seg green" style={{ width: `${(c.done / total) * 100}%` }} />}
            </span>
            <span className="pnums">
              {c.overdue ? `${c.overdue} late · ` : ''}{c.open} open · {c.pending} pending · {c.done} done
            </span>
          </div>
        ))}
        <div className="legend">
          <span><i className="sw red" />Overdue</span>
          <span><i className="sw blue" />Open</span>
          <span><i className="sw amber" />Pending</span>
          <span><i className="sw green" />Done</span>
        </div>
      </div>
    </>
  )
}

const CSS = `
  .sb-tcc{max-width:1180px;margin:0 auto;padding:8px 28px 80px;color:#1A1E24;font-size:14px}
  .sb-tcc *{box-sizing:border-box}
  .sb-tcc-err{background:#FBEDEA;border:1px solid rgba(179,38,30,.35);color:#B3261E;border-radius:10px;padding:10px 14px;margin-bottom:14px}
  .sb-tcc-empty{color:#A39C87;font-size:13px;padding:16px 18px;font-style:italic}

  .sb-tcc-day{display:flex;align-items:flex-end;gap:16px;flex-wrap:wrap;padding:18px 0 4px}
  .sb-tcc-day h1{font-size:32px;letter-spacing:-.02em;line-height:1;margin:0}
  .sb-tcc-day .date{font-size:14px;color:#79735F;padding-bottom:3px}
  .sb-tcc-day .spacer{flex:1}
  .sb-tcc .chip.needs{background:#B3261E;color:#fff;font-size:12.5px;font-weight:700;border-radius:999px;padding:6px 13px}

  .sb-tcc-users{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin:8px 0 14px}
  .sb-tcc-users .lab{font:700 10.5px/1 var(--sb-font-mono,monospace);letter-spacing:.14em;text-transform:uppercase;color:#A39C87;margin-right:4px}
  .sb-tcc-users .hint{font-size:12px;color:#B3261E;font-weight:600}
  .sb-tcc .ubtn{font:600 12.5px/1 inherit;font-family:inherit;border:1px solid rgba(26,30,36,.12);background:#fff;color:#79735F;border-radius:999px;padding:7px 14px;cursor:pointer}
  .sb-tcc .ubtn:hover{color:#1A1E24}
  .sb-tcc .ubtn.on{background:#0F1419;color:#fff;border-color:#0F1419;font-weight:700}

  .sb-tcc-bar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:14px}
  .sb-tcc-bar .spacer{flex:1}
  .sb-tcc .views{display:inline-flex;background:#ECE6D8;border-radius:10px;padding:3px}
  .sb-tcc .vtab{font:700 13px/1 inherit;font-family:inherit;border:none;background:none;color:#7a756a;border-radius:8px;padding:8px 16px;cursor:pointer}
  .sb-tcc .vtab.on{background:#fff;color:#9A7209;box-shadow:0 1px 2px rgba(0,0,0,.08)}
  .sb-tcc .stat{font-size:12.5px;font-weight:700;border-radius:999px;padding:6px 12px;border:1px solid rgba(26,30,36,.12);background:#fff;color:#79735F}
  .sb-tcc .stat.red{color:#B3261E;border-color:rgba(179,38,30,.35);background:#FBEDEA}
  .sb-tcc .stat.amber{color:#8A5A12;border-color:rgba(184,132,42,.35);background:#FBF2DE}
  .sb-tcc .stat.blue{color:#1D6FA8;border-color:rgba(29,111,168,.3);background:#EAF2FA}
  .sb-tcc .stat.green{color:#1D7A55;border-color:rgba(29,122,85,.3);background:#E7F4EC}

  .sb-tcc .act{font:600 12.5px/1 inherit;font-family:inherit;color:#9A7209;background:#fff;border:1px solid #9A7209;border-radius:8px;padding:7px 13px;cursor:pointer;white-space:nowrap}
  .sb-tcc .act:hover{background:#F4EBD4}
  .sb-tcc .act.solid{background:#9A7209;color:#fff}
  .sb-tcc .act:disabled{opacity:.6;cursor:default}
  .sb-tcc .terr{font-size:12px;font-weight:700;color:#B3261E}

  .sb-tcc-new{background:#fff;border:1px solid rgba(26,30,36,.09);border-left:4px solid #9A7209;border-radius:14px;padding:13px 16px;margin-bottom:12px}
  .sb-tcc-new .row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
  .sb-tcc-new .row.sub{margin-top:9px}
  .sb-tcc-new input[type=text],.sb-tcc-new select,.sb-tcc-new input[type=date]{font:inherit;font-size:13px;padding:9px 12px;border:1px solid #DAD4C2;border-radius:9px;background:#FDFCF9;max-width:100%}
  .sb-tcc-new .big{flex:1;min-width:220px}
  .sb-tcc .tby{font-size:12.5px;color:#79735F;display:inline-flex;align-items:center;gap:6px}
  .sb-tcc .tby b{color:#1A1E24}
  .sb-tcc .tby .auto{font-size:10px;font-weight:800;letter-spacing:.05em;text-transform:uppercase;color:#1D7A55;background:#E7F4EC;border-radius:6px;padding:2px 6px}
  .sb-tcc .tbedit{font:600 11px/1 inherit;font-family:inherit;color:#A39C87;background:none;border:none;cursor:pointer;opacity:0;transition:opacity .12s;text-decoration:underline}
  .sb-tcc .tby:hover .tbedit{opacity:1}
  .sb-tcc .tby select{padding:4px 8px}

  .sb-tcc .linkbox{position:relative;display:inline-flex}
  .sb-tcc .linksearch{position:relative}
  .sb-tcc .linksearch input{font:inherit;font-size:13px;padding:8px 12px;border:1px solid #DAD4C2;border-radius:9px;background:#FDFCF9;min-width:250px}
  .sb-tcc .linkresults{position:absolute;top:calc(100% + 4px);left:0;z-index:30;background:#fff;border:1px solid rgba(26,30,36,.14);border-radius:10px;box-shadow:0 8px 22px rgba(15,20,25,.14);min-width:300px;overflow:hidden;display:block}
  .sb-tcc .linkresults button{display:flex;justify-content:space-between;align-items:center;gap:12px;width:100%;font:inherit;font-size:13px;text-align:left;background:none;border:none;border-top:1px solid rgba(26,30,36,.06);padding:9px 12px;cursor:pointer}
  .sb-tcc .linkresults button:first-child{border-top:none}
  .sb-tcc .linkresults button:hover{background:#F8F5EE}
  .sb-tcc .linkresults em{font-style:normal;font-size:10px;font-weight:800;letter-spacing:.05em;text-transform:uppercase;border-radius:6px;padding:2px 7px}
  .sb-tcc .linkresults em.lead,.sb-tcc .linkchip.lead{color:#5B3E96;background:#EFEAFA}
  .sb-tcc .linkresults em.order,.sb-tcc .linkchip.order{color:#1D6FA8;background:#EAF2FA}
  .sb-tcc .linkchip{font-size:12px;font-weight:700;border-radius:8px;padding:6px 10px;display:inline-flex;align-items:center;gap:8px}
  .sb-tcc .linkchip button{font:700 13px/1 inherit;font-family:inherit;background:none;border:none;cursor:pointer;color:inherit;opacity:.7}

  .sb-tcc .attachbox{display:inline-flex;align-items:center;gap:8px;flex-wrap:wrap}
  .sb-tcc .fchip{font-size:12px;background:#F6F3EC;border:1px solid rgba(26,30,36,.1);border-radius:8px;padding:5px 9px;display:inline-flex;align-items:center;gap:7px}
  .sb-tcc .fchip a{color:#1D6FA8;text-decoration:none}
  .sb-tcc .fchip button{font:700 12px/1 inherit;font-family:inherit;background:none;border:none;cursor:pointer;color:#B3261E}
  .sb-tcc .pickrow{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;padding-top:10px;border-top:1px dashed rgba(26,30,36,.14)}
  .sb-tcc .fpick{font:600 12px/1 inherit;font-family:inherit;background:#fff;border:1px solid #DAD4C2;border-radius:8px;padding:7px 11px;cursor:pointer;color:#79735F}
  .sb-tcc .fpick.on{border-color:#9A7209;color:#9A7209;background:#F4EBD4}
  .sb-tcc .pempty{font-size:12.5px;color:#A39C87;font-style:italic}

  .sb-tcc-inbox{margin-bottom:12px;background:#EAF2FA;border:1px solid rgba(29,111,168,.25);border-radius:12px;padding:10px 14px;display:flex;align-items:center;gap:12px;flex-wrap:wrap}
  .sb-tcc-inbox .lab{font:700 10.5px/1 var(--sb-font-mono,monospace);letter-spacing:.12em;text-transform:uppercase;color:#1D6FA8}
  .sb-tcc-inbox .msg{flex:1;min-width:220px;font-size:13px;display:inline-flex;align-items:center;gap:8px;flex-wrap:wrap}

  .sb-tcc-filters{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:10px}
  .sb-tcc-filters select{font:inherit;font-size:13px;padding:8px 11px;border:1px solid #DAD4C2;border-radius:9px;background:#FDFCF9}
  .sb-tcc .donechk{font-size:12.5px;color:#79735F;display:inline-flex;align-items:center;gap:6px;cursor:pointer}

  .sb-tcc-days{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px}
  .sb-tcc .dchip{font-family:inherit;display:flex;flex-direction:column;align-items:center;gap:3px;min-width:74px;background:#fff;border:1px solid rgba(26,30,36,.12);border-radius:11px;padding:8px 12px;cursor:pointer}
  .sb-tcc .dchip .dl{font-size:11px;font-weight:700;color:#79735F}
  .sb-tcc .dchip b{font:700 15px/1 var(--sb-font-mono,monospace);color:#1A1E24}
  .sb-tcc .dchip.on{border-color:#9A7209;background:#F4EBD4}
  .sb-tcc .dchip.on .dl{color:#9A7209}
  .sb-tcc .dchip.red .dl,.sb-tcc .dchip.red b{color:#B3261E}
  .sb-tcc .dchip.red.on{border-color:#B3261E;background:#FBEDEA}

  .sb-tcc-card{background:#fff;border:1px solid rgba(26,30,36,.09);border-radius:14px}
  .sb-tcc-card h2{font-size:11.5px;font-weight:800;letter-spacing:.13em;text-transform:uppercase;color:#79735F;padding:14px 18px 4px;margin:0}
  .sb-tcc .why-note{font-size:10.5px;font-weight:600;letter-spacing:0;text-transform:none;color:#A39C87;margin-left:8px}

  .sb-tcc-trow{border-top:1px solid rgba(26,30,36,.07)}
  .sb-tcc-trow:first-child{border-top:none}
  .sb-tcc-trow .main{display:flex;align-items:center;gap:10px;padding:11px 18px;flex-wrap:wrap}
  .sb-tcc-trow.over .main{box-shadow:inset 4px 0 0 #B3261E}
  .sb-tcc-trow input[type=checkbox]{width:16px;height:16px;accent-color:#9A7209;cursor:pointer;flex:0 0 auto}
  .sb-tcc-trow .txt{flex:1;min-width:160px;font:inherit;font-size:14px;text-align:left;background:none;border:none;padding:0;cursor:pointer;color:#1A1E24}
  .sb-tcc-trow .txt:hover{color:#9A7209}
  .sb-tcc-trow .meta{font-size:11.5px;color:#79735F}
  .sb-tcc-trow.done .txt{color:#A39C87;text-decoration:line-through}
  .sb-tcc .tbadge{font-size:10px;font-weight:800;letter-spacing:.05em;text-transform:uppercase;border-radius:999px;padding:3px 9px;white-space:nowrap}
  .sb-tcc .tbadge.lead{color:#5B3E96;background:#EFEAFA}
  .sb-tcc .tbadge.order{color:#1D6FA8;background:#EAF2FA}
  .sb-tcc .tbadge.design{color:#A8386E;background:#FAEAF2}
  .sb-tcc .tbadge.prod{color:#9C4A1D;background:#FAEDE4}
  .sb-tcc .tbadge.check{color:#1D7A55;background:#E7F4EC}
  .sb-tcc .tbadge.gen{color:#79735F;background:#F6F3EC}
  .sb-tcc-trow .oc{font:600 11px var(--sb-font-mono,monospace);color:#1D6FA8;background:#EAF2FA;border:none;border-radius:6px;padding:3px 8px;white-space:nowrap;cursor:pointer}
  .sb-tcc-trow .chain{font-size:12px;color:#79735F;white-space:nowrap}
  .sb-tcc-trow .chain em{font-style:normal}
  .sb-tcc-trow .chain b{color:#1A1E24}
  .sb-tcc-trow .due{font:600 11.5px var(--sb-font-mono,monospace);color:#79735F;white-space:nowrap}
  .sb-tcc-trow .due.today{color:#8A5A12}.sb-tcc-trow .due.over{color:#B3261E}
  .sb-tcc .pendbtn{font:600 11.5px/1 inherit;font-family:inherit;color:#8A5A12;background:none;border:1px solid rgba(184,132,42,.4);border-radius:7px;padding:5px 10px;cursor:pointer;white-space:nowrap}
  .sb-tcc .pendbtn.on{background:#FBF2DE;font-weight:800}
  .sb-tcc .rbtn{font:600 11.5px/1 inherit;font-family:inherit;color:#1D6FA8;background:none;border:1px solid rgba(29,111,168,.35);border-radius:7px;padding:5px 10px;cursor:pointer;white-space:nowrap}
  .sb-tcc .xbtn{font:700 15px/1 inherit;font-family:inherit;color:#B3261E;background:none;border:none;cursor:pointer;padding:2px 4px}

  .sb-tcc-detail{background:#FBFAF6;border-top:1px dashed rgba(26,30,36,.12);padding:12px 18px 14px;display:flex;flex-direction:column;gap:10px}
  .sb-tcc-detail .cemline{font-size:13px;color:#1D7A55;background:#E7F4EC;border-radius:8px;padding:8px 12px}
  .sb-tcc-detail .editrow{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
  .sb-tcc-detail .editrow input[type=text]{flex:1;min-width:200px}
  .sb-tcc-detail input,.sb-tcc-detail select{font:inherit;font-size:13px;padding:8px 11px;border:1px solid #DAD4C2;border-radius:8px;background:#fff}
  .sb-tcc-detail .attachrow{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
  .sb-tcc-detail .thread{display:flex;flex-direction:column;gap:6px}
  .sb-tcc-detail .reply{display:flex;align-items:baseline;gap:9px;font-size:13px;flex-wrap:wrap}
  .sb-tcc-detail .reply .body{flex:1;min-width:160px}
  .sb-tcc-detail .reply .when{font:600 11px var(--sb-font-mono,monospace);color:#A39C87}
  .sb-tcc-detail .reply .seen{font-size:11px;font-weight:700;color:#1D7A55}
  .sb-tcc-detail .replybox{display:flex;gap:8px}
  .sb-tcc-detail .replybox input{flex:1}
  .sb-tcc-detail .metaline{font-size:11px;color:#A39C87}

  .sb-tcc-board{display:grid;grid-template-columns:repeat(7,minmax(150px,1fr));gap:10px;align-items:start}
  @media(max-width:1100px){.sb-tcc-board{grid-template-columns:repeat(4,1fr)}}
  @media(max-width:760px){.sb-tcc-board{grid-template-columns:repeat(2,1fr)}}
  .sb-tcc .bcol{display:flex;flex-direction:column;gap:8px;min-height:120px}
  .sb-tcc .bhead{display:flex;justify-content:space-between;align-items:center;background:#fff;border:1px solid rgba(26,30,36,.1);border-radius:10px;padding:8px 11px;font-size:12px;font-weight:700;color:#79735F}
  .sb-tcc .bhead b{font:700 13px var(--sb-font-mono,monospace);color:#1A1E24}
  .sb-tcc .bhead.today{border-color:#9A7209;background:#F4EBD4;color:#9A7209}
  .sb-tcc .bhead.red{border-color:rgba(179,38,30,.4);background:#FBEDEA;color:#B3261E}
  .sb-tcc .bhead.red b{color:#B3261E}

  .sb-tcc-bcard{background:#fff;border:1px solid rgba(26,30,36,.1);border-radius:11px;padding:10px 11px;cursor:pointer}
  .sb-tcc-bcard:hover{border-color:#9A7209}
  .sb-tcc-bcard.over{border-color:rgba(179,38,30,.45)}
  .sb-tcc-bcard .top{display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:6px}
  .sb-tcc-bcard .title{font-size:12.5px;font-weight:600;line-height:1.35}
  .sb-tcc-bcard.pend .title{color:#8A5A12}
  .sb-tcc-bcard .foot{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:7px}
  .sb-tcc-bcard .who{font-size:10.5px;font-weight:800;letter-spacing:.04em;border-radius:999px;padding:3px 8px;background:#F6F3EC;color:#79735F}
  .sb-tcc-bcard .ord{font:600 10.5px var(--sb-font-mono,monospace);color:#1D6FA8}
  .sb-tcc-bcard .mch{font:600 10.5px var(--sb-font-mono,monospace);color:#A39C87}
  .sb-tcc-bcard .pendtag{font-size:9.5px;font-weight:800;letter-spacing:.05em;text-transform:uppercase;color:#8A5A12;background:#FBF2DE;border-radius:6px;padding:2px 6px}
  .sb-tcc-bcard .latetag{font-size:9.5px;font-weight:800;letter-spacing:.05em;text-transform:uppercase;color:#B3261E;background:#FBEDEA;border-radius:6px;padding:2px 6px}

  .sb-tcc-people{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:14px;align-items:start}
  .sb-tcc .pcol{background:#F6F3EC;border-radius:12px;padding:4px 10px 10px}
  .sb-tcc .pcol h3{display:flex;align-items:center;gap:8px;font-size:13px;padding:10px 4px 8px;margin:0;flex-wrap:wrap}
  .sb-tcc .pcol h3 .n{font:700 11px var(--sb-font-mono,monospace);background:#fff;border:1px solid rgba(26,30,36,.09);border-radius:999px;padding:1px 8px;color:#79735F}
  .sb-tcc .pcol .depttag{font-size:9px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:#5B3E96;background:#EFEAFA;border-radius:6px;padding:2px 6px}
  .sb-tcc .pcol .overtag{font-size:10px;font-weight:800;color:#B3261E;background:#FBEDEA;border-radius:6px;padding:2px 7px}
  .sb-tcc .pcol .sb-tcc-bcard{margin-bottom:8px}
  .sb-tcc .pcol .pempty{font-size:12px;color:#A39C87;font-style:italic;padding:2px 4px 6px}

  .sb-tcc-dash{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-bottom:14px}
  .sb-tcc .mcard{background:#fff;border:1px solid rgba(26,30,36,.09);border-radius:12px;padding:12px 15px}
  .sb-tcc .mcard span{display:block;font-size:11.5px;color:#79735F;margin-bottom:4px}
  .sb-tcc .mcard b{font:700 24px/1 var(--sb-font-mono,monospace)}
  .sb-tcc .mcard b.red{color:#B3261E}.sb-tcc .mcard b.amber{color:#8A5A12}
  .sb-tcc .mcard b.blue{color:#1D6FA8}.sb-tcc .mcard b.green{color:#1D7A55}

  .sb-tcc-bars{padding-bottom:14px}
  .sb-tcc .prow{display:flex;align-items:center;gap:12px;padding:9px 18px;border-top:1px solid rgba(26,30,36,.06)}
  .sb-tcc .prow .pname{font-weight:700;min-width:120px;font-size:13px}
  .sb-tcc .prow .pbar{flex:1;display:flex;height:9px;border-radius:5px;overflow:hidden;background:#F1EEE5}
  .sb-tcc .seg.red{background:#D4574E}.sb-tcc .seg.blue{background:#4C90C4}
  .sb-tcc .seg.amber{background:#D9A03F}.sb-tcc .seg.green{background:#57A87A}
  .sb-tcc .prow .pnums{font-size:11.5px;color:#79735F;white-space:nowrap}
  .sb-tcc .legend{display:flex;gap:16px;padding:12px 18px 2px;font-size:11.5px;color:#79735F}
  .sb-tcc .legend span{display:inline-flex;align-items:center;gap:6px}
  .sb-tcc .sw{width:9px;height:9px;border-radius:3px;display:inline-block}
  .sb-tcc .sw.red{background:#D4574E}.sb-tcc .sw.blue{background:#4C90C4}
  .sb-tcc .sw.amber{background:#D9A03F}.sb-tcc .sw.green{background:#57A87A}
`
