// =============================================================================
// CalendarTab — the shop calendar, rebuilt (CAL-2, 2026-07-22)
// =============================================================================
// Paul's spec, verbatim intent:
//   • FILTERS — see runs, task due dates, order due dates, reminders as
//     toggleable layers (persisted per browser).
//   • Adding an event NEVER yanks the view — quick-add opens on the clicked
//     day (or today) and you stay in Month/Week.
//   • DRAG anything to any day — the drop overrides that item's date: a run's
//     scheduled_date, a task's due_date, an order's target_completion_date,
//     a reminder's remind_on. Every move offers UNDO.
//   • REMINDERS live below the calendar and cannot be missed: multiple
//     firings per event (day before / 3 days / week / 2 weeks / month /
//     2 months / on the day / any exact date), each one stays until a human
//     hits ACKNOWLEDGE (stamped who + when).
// Events are still zero-job work_batches (site_visit / errand) — the
// Scheduler sees everything this calendar creates and vice versa. The
// Scheduler tab keeps its own dispatch surface; this tab is the OWNER'S month.
// =============================================================================
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  getBatches, updateBatch, createBatch,
  listShopTasks, updateShopTask,
  listOrderDueDates, setOrderTargetDate,
  listCalendarReminders, addCalendarReminders, acknowledgeCalendarReminder,
  updateCalendarReminder, deleteCalendarReminder,
  getActiveStaffUser, todayISO, STAFF_NAMES,
} from './lib/stonebooksData'

// ── Pure date math on ISO strings (argful Date only — render-safe) ──────────
const pad2 = (n) => String(n).padStart(2, '0')
const mk = (y, m, d) => { const t = new Date(y, m, d); return `${t.getFullYear()}-${pad2(t.getMonth() + 1)}-${pad2(t.getDate())}` }
const parts = (s) => { const [y, m, d] = String(s).slice(0, 10).split('-').map(Number); return { y, m: m - 1, d } }
const addDays = (s, n) => { const { y, m, d } = parts(s); return mk(y, m, d + n) }
const addMonths = (s, n) => { const { y, m, d } = parts(s); return mk(y, m + n, d) }
const monthStart = (s) => { const { y, m } = parts(s); return mk(y, m, 1) }
const dowOf = (s) => { const { y, m, d } = parts(s); return new Date(y, m, d).getDay() }
const sameMonth = (a, b) => a.slice(0, 7) === b.slice(0, 7)
const dayNum = (s) => Number(s.slice(8, 10))
const fmtLong = (s) => { const { y, m, d } = parts(s); return new Date(y, m, d).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }) }
const fmtShort = (s) => { const { y, m, d } = parts(s); return new Date(y, m, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) }
const monthTitle = (s) => { const { y, m } = parts(s); return new Date(y, m, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) }

const KIND_LABEL = {
  inscription: 'Inscription', blasting: 'Blasting', setting: 'Install', delivery: 'Delivery',
  acid_wash: 'Acid wash', repair: 'Repair', rub_grab: 'Rub & grab', foundation_trip: 'Foundation',
  door_trip: 'Door trip', site_visit: 'Site visit', errand: 'Errand',
}
const famOf = (o) => o?.primary_lastname
  || [o?.customer?.first_name, o?.customer?.last_name].filter(Boolean).join(' ')
  || o?.order_number || '—'

const LAYERS = [
  { key: 'runs', label: 'Runs & events' },
  { key: 'tasks', label: 'Task due dates' },
  { key: 'orders', label: 'Order due dates' },
  { key: 'rems', label: 'Reminders' },
]
const OFFSETS = [
  { key: 'on', label: 'On the day', days: 0 },
  { key: '1d', label: 'Day before', days: 1 },
  { key: '3d', label: '3 days before', days: 3 },
  { key: '1w', label: 'Week before', days: 7 },
  { key: '2w', label: '2 weeks before', days: 14 },
  { key: '1m', label: 'Month before', months: 1 },
  { key: '2m', label: '2 months before', months: 2 },
]
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export default function CalendarTab({ onOpenOrder }) {
  const [today] = useState(() => todayISO())
  const [view, setView] = useState(() => { try { return localStorage.getItem('sb_cal_view') === 'week' ? 'week' : 'month' } catch { return 'month' } })
  const [anchor, setAnchor] = useState(() => todayISO())   // any day in the shown month / week
  const [layers, setLayers] = useState(() => {
    try { const v = JSON.parse(localStorage.getItem('sb_cal_layers') || 'null'); if (v && typeof v === 'object') return { runs: true, tasks: true, orders: true, rems: true, ...v } } catch { /* defaults */ }
    return { runs: true, tasks: true, orders: true, rems: true }
  })
  const setViewPersist = (v) => { setView(v); try { localStorage.setItem('sb_cal_view', v) } catch { /* ok */ } }
  const toggleLayer = (k) => setLayers(prev => {
    const next = { ...prev, [k]: !prev[k] }
    try { localStorage.setItem('sb_cal_layers', JSON.stringify(next)) } catch { /* ok */ }
    return next
  })

  // Visible range — month view shows a full 6-week grid; week view 7 days.
  const range = useMemo(() => {
    if (view === 'week') {
      const start = addDays(anchor, -dowOf(anchor))
      return { start, end: addDays(start, 6), days: Array.from({ length: 7 }, (_, i) => addDays(start, i)) }
    }
    const ms = monthStart(anchor)
    const start = addDays(ms, -dowOf(ms))
    return { start, end: addDays(start, 41), days: Array.from({ length: 42 }, (_, i) => addDays(start, i)) }
  }, [view, anchor])

  // ── Data — one load per visible range ─────────────────────────────────────
  const [batches, setBatches] = useState([])
  const [tasks, setTasks] = useState([])
  const [dues, setDues] = useState([])
  const [rems, setRems] = useState([])       // ALL unacknowledged (the board needs every one)
  const [loading, setLoading] = useState(true)
  const [nonce, setNonce] = useState(0)
  const reload = () => setNonce(n => n + 1)

  useEffect(() => {
    let alive = true
    setLoading(true)
    Promise.all([
      getBatches({ from: range.start, to: range.end }).catch(() => []),
      listShopTasks().catch(() => []),
      listOrderDueDates({ from: range.start, to: range.end }).catch(() => []),
      listCalendarReminders().catch(() => []),
    ]).then(([b, t, d, r]) => {
      if (!alive) return
      setBatches((b || []).filter(x => x.status !== 'cancelled'))
      setTasks((t || []).filter(x => x.status !== 'done' && x.due_date))
      setDues(d || [])
      setRems(r || [])
      setLoading(false)
    })
    return () => { alive = false }
  }, [range.start, range.end, nonce])

  // ── Chips per day ─────────────────────────────────────────────────────────
  const chipsByDay = useMemo(() => {
    const m = new Map()
    const push = (day, chip) => { if (!m.has(day)) m.set(day, []); m.get(day).push(chip) }
    if (layers.runs) for (const b of batches) {
      if (!b.scheduled_date) continue
      const day = String(b.scheduled_date).slice(0, 10)
      const kind = KIND_LABEL[b.kind] || b.kind
      push(day, { t: 'batch', id: b.id, day, label: b.title || `${kind}${b.cemetery?.name ? ' — ' + b.cemetery.name : ''}`, tag: kind, raw: b })
    }
    if (layers.tasks) for (const t of tasks) {
      const day = String(t.due_date).slice(0, 10)
      push(day, { t: 'task', id: t.id, day, label: t.title, tag: t.assignee || 'Task', raw: t })
    }
    if (layers.orders) for (const o of dues) {
      const day = String(o.target_completion_date).slice(0, 10)
      push(day, { t: 'order', id: o.id, day, label: `DUE — ${famOf(o)}`, tag: o.order_number || 'Order', raw: o })
    }
    if (layers.rems) for (const r of rems) {
      const day = String(r.remind_on).slice(0, 10)
      push(day, { t: 'rem', id: r.id, day, label: r.title, tag: 'Reminder', raw: r })
    }
    for (const list of m.values()) {
      const rank = { batch: 0, order: 1, task: 2, rem: 3 }
      list.sort((a, b) => (rank[a.t] - rank[b.t]) || String(a.label).localeCompare(String(b.label)))
    }
    return m
  }, [batches, tasks, dues, rems, layers])

  // ── Toast with UNDO (one at a time, 8s) ───────────────────────────────────
  const [toast, setToast] = useState(null)   // { text, undoFn }
  const toastTimer = useRef(null)
  const showToast = (text, undoFn = null) => {
    if (toastTimer.current) clearTimeout(toastTimer.current)
    setToast({ text, undoFn })
    toastTimer.current = setTimeout(() => setToast(null), 8000)
  }

  // ── Drag any chip → any day = the date is overridden ─────────────────────
  const [dragOverDay, setDragOverDay] = useState(null)
  const draggingRef = useRef(false)
  const onChipDragStart = (e, chip) => {
    draggingRef.current = true
    e.dataTransfer.setData('text/plain', JSON.stringify({ t: chip.t, id: chip.id, from: chip.day }))
    e.dataTransfer.effectAllowed = 'move'
  }
  const onChipDragEnd = () => { draggingRef.current = false; setDragOverDay(null) }
  const applyMove = async (t, id, day) => {
    if (t === 'batch') return updateBatch(id, { scheduled_date: day })
    if (t === 'task') return updateShopTask(id, { dueDate: day })
    if (t === 'order') return setOrderTargetDate(id, day)
    if (t === 'rem') return updateCalendarReminder(id, { remind_on: day })
    return { ok: false, error: 'Unknown item' }
  }
  const onDayDrop = async (e, day) => {
    e.preventDefault()
    setDragOverDay(null)
    let payload = null
    try { payload = JSON.parse(e.dataTransfer.getData('text/plain')) } catch { /* not ours */ }
    if (!payload?.t || !payload?.id || payload.from === day) return
    const { t, id, from } = payload
    // Optimistic local move so the chip lands instantly.
    const bump = (setter, dateKey) => setter(prev => prev.map(x => x.id === id ? { ...x, [dateKey]: day } : x))
    if (t === 'batch') bump(setBatches, 'scheduled_date')
    if (t === 'task') bump(setTasks, 'due_date')
    if (t === 'order') bump(setDues, 'target_completion_date')
    if (t === 'rem') bump(setRems, 'remind_on')
    const res = await applyMove(t, id, day)
    if (!res.ok) { showToast(res.error || 'Could not move it.'); reload(); return }
    showToast(`Moved to ${fmtShort(day)}`, async () => {
      await applyMove(t, id, from).catch(() => {})
      reload()
    })
  }

  // ── Quick add + day peek + reminder composer ─────────────────────────────
  const [quickAdd, setQuickAdd] = useState(null)   // { date } — view NEVER changes
  const [peekDay, setPeekDay] = useState(null)     // ISO day
  const [remFor, setRemFor] = useState(null)       // { type, id, title, eventDate } | { type:'custom' }

  const dueNow = useMemo(() => rems.filter(r => String(r.remind_on).slice(0, 10) <= today), [rems, today])
  const upcoming = useMemo(() => rems.filter(r => String(r.remind_on).slice(0, 10) > today), [rems, today])

  const ack = async (r) => {
    const staff = getActiveStaffUser()
    const res = await acknowledgeCalendarReminder(r.id, staff)
    if (!res.ok) { showToast(res.error || 'Could not acknowledge.'); return }
    setRems(prev => prev.filter(x => x.id !== r.id))
    showToast(`Acknowledged — ${r.title}`)
  }
  const removeReminder = async (r) => {
    const res = await deleteCalendarReminder(r.id)
    if (!res.ok) { showToast(res.error || 'Could not remove it.'); return }
    setRems(prev => prev.filter(x => x.id !== r.id))
    showToast('Reminder removed', async () => {
      await addCalendarReminders([{ ...r }]).catch(() => {})
      reload()
    })
  }

  const go = (n) => setAnchor(a => view === 'week' ? addDays(a, 7 * n) : addMonths(monthStart(a), n))

  const dayCell = (day) => {
    const chips = chipsByDay.get(day) || []
    const inMonth = view === 'week' || sameMonth(day, monthStart(anchor))
    const isToday = day === today
    const cap = view === 'week' ? 14 : 3
    const shown = chips.slice(0, cap)
    const more = chips.length - shown.length
    return (
      <div key={day}
        className={`cal2-cell${inMonth ? '' : ' dim'}${isToday ? ' today' : ''}${dragOverDay === day ? ' drop' : ''}${view === 'week' ? ' wk' : ''}`}
        onDragOver={e => { e.preventDefault(); setDragOverDay(day) }}
        onDragLeave={() => setDragOverDay(d => (d === day ? null : d))}
        onDrop={e => onDayDrop(e, day)}
        onClick={() => { if (!draggingRef.current) setPeekDay(day) }}
      >
        <div className="cal2-cell-head">
          <span className="cal2-daynum">{dayNum(day)}</span>
          <button type="button" className="cal2-cell-add" title="Add on this day"
            onClick={e => { e.stopPropagation(); setQuickAdd({ date: day }) }}>+</button>
        </div>
        <div className="cal2-chips">
          {shown.map(c => (
            <div key={`${c.t}-${c.id}`} className={`cal2-chip cal2-${c.t}`}
              draggable
              onDragStart={e => onChipDragStart(e, c)}
              onDragEnd={onChipDragEnd}
              onClick={e => { e.stopPropagation(); setPeekDay(day) }}
              title={`${c.label} — drag to move`}>
              <span className="cal2-chip-txt">{c.label}</span>
            </div>
          ))}
          {more > 0 && <div className="cal2-more">+{more} more</div>}
        </div>
      </div>
    )
  }

  return (
    <div className="cal2">
      <style>{CSS}</style>

      {/* ── Masthead ─────────────────────────────────────────────────────── */}
      <div className="cal2-head">
        <div className="cal2-title-wrap">
          <h1 className="cal2-title">{view === 'week' ? `Week of ${fmtShort(addDays(anchor, -dowOf(anchor)))}` : monthTitle(anchor)}</h1>
          <div className="cal2-sub">{loading ? 'Loading the month…' : 'Drag anything to any day — the date follows.'}</div>
        </div>
        <div className="cal2-nav">
          <button type="button" className="cal2-navbtn" onClick={() => go(-1)} aria-label="Back">&#8249;</button>
          <button type="button" className="cal2-todaybtn" onClick={() => setAnchor(today)}>Today</button>
          <button type="button" className="cal2-navbtn" onClick={() => go(1)} aria-label="Forward">&#8250;</button>
          <div className="cal2-viewtog">
            <button type="button" className={view === 'month' ? 'on' : ''} onClick={() => setViewPersist('month')}>Month</button>
            <button type="button" className={view === 'week' ? 'on' : ''} onClick={() => setViewPersist('week')}>Week</button>
          </div>
          <button type="button" className="cal2-addbtn" onClick={() => setQuickAdd({ date: today })}>+ Event</button>
        </div>
      </div>

      {/* ── Layer filters ────────────────────────────────────────────────── */}
      <div className="cal2-layers">
        <span className="cal2-layers-lab">Show</span>
        {LAYERS.map(l => (
          <button key={l.key} type="button" className={`cal2-layer cal2-layer-${l.key}${layers[l.key] ? ' on' : ''}`}
            onClick={() => toggleLayer(l.key)}>
            <span className="dot" />{l.label}
          </button>
        ))}
        {dueNow.length > 0 && (
          <button type="button" className="cal2-duejump"
            onClick={() => document.getElementById('cal2-reminders')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>
            {dueNow.length} reminder{dueNow.length === 1 ? '' : 's'} need{dueNow.length === 1 ? 's' : ''} acknowledging
          </button>
        )}
      </div>

      {/* ── The grid ─────────────────────────────────────────────────────── */}
      <div className="cal2-card">
        <div className="cal2-dow">{DOW.map(d => <span key={d}>{d}</span>)}</div>
        <div className={`cal2-grid${view === 'week' ? ' wk' : ''}`}>
          {range.days.map(dayCell)}
        </div>
      </div>

      {/* ── REMINDERS — the board you cannot miss ────────────────────────── */}
      <section id="cal2-reminders" className="cal2-rems">
        <div className="cal2-rems-head">
          <h2 className="cal2-rems-title">Reminders</h2>
          {dueNow.length > 0 && <span className="cal2-rems-count">{dueNow.length} waiting</span>}
          <span className="cal2-rems-spacer" />
          <button type="button" className="cal2-addbtn" onClick={() => setRemFor({ type: 'custom' })}>+ Reminder</button>
        </div>
        {dueNow.length === 0 && upcoming.length === 0 && (
          <div className="cal2-rems-empty">Nothing on the board. Open any day and hit REMIND ME on an item — day before, week before, two months before, your call. Each one stays here until somebody acknowledges it.</div>
        )}
        {dueNow.map(r => (
          <div key={r.id} className="cal2-rem cal2-rem-due">
            <div className="cal2-rem-main">
              <div className="cal2-rem-title">{r.title}</div>
              <div className="cal2-rem-sub">
                {r.event_date ? `For ${fmtLong(String(r.event_date).slice(0, 10))} · ` : ''}
                reminder set for {fmtShort(String(r.remind_on).slice(0, 10))}
                {r.created_by ? ` by ${r.created_by}` : ''}
                {r.note ? ` — ${r.note}` : ''}
              </div>
            </div>
            {r.source_type === 'order' && r.source_id && onOpenOrder && (
              <button type="button" className="cal2-rem-open" onClick={() => onOpenOrder(r.source_id)}>Open order</button>
            )}
            <button type="button" className="cal2-ackbtn" onClick={() => ack(r)}>ACKNOWLEDGE</button>
          </div>
        ))}
        {upcoming.length > 0 && (
          <>
            <div className="cal2-rems-uphead">Coming up</div>
            {upcoming.map(r => (
              <div key={r.id} className="cal2-rem">
                <span className="cal2-rem-date">{fmtShort(String(r.remind_on).slice(0, 10))}</span>
                <div className="cal2-rem-main">
                  <div className="cal2-rem-title sm">{r.title}</div>
                  {(r.event_date || r.note) && (
                    <div className="cal2-rem-sub">{r.event_date ? `For ${fmtShort(String(r.event_date).slice(0, 10))}` : ''}{r.note ? `${r.event_date ? ' — ' : ''}${r.note}` : ''}</div>
                  )}
                </div>
                <button type="button" className="cal2-rem-x" title="Remove this reminder" onClick={() => removeReminder(r)}>Remove</button>
              </div>
            ))}
          </>
        )}
      </section>

      {/* ── Day peek ─────────────────────────────────────────────────────── */}
      {peekDay && (
        <div className="cal2-scrim" onClick={() => setPeekDay(null)}>
          <div className="cal2-panel" onClick={e => e.stopPropagation()}>
            <div className="cal2-panel-head">
              <div>
                <div className="cal2-panel-title">{fmtLong(peekDay)}</div>
                <div className="cal2-panel-sub">{(chipsByDay.get(peekDay) || []).length} item{(chipsByDay.get(peekDay) || []).length === 1 ? '' : 's'}</div>
              </div>
              <button type="button" className="cal2-navbtn" onClick={() => setPeekDay(null)}>&#215;</button>
            </div>
            <div className="cal2-panel-body">
              {(chipsByDay.get(peekDay) || []).length === 0 && <div className="cal2-rems-empty">Nothing on this day yet.</div>}
              {(chipsByDay.get(peekDay) || []).map(c => (
                <div key={`${c.t}-${c.id}`} className="cal2-prow">
                  <span className={`cal2-ptag cal2-${c.t}`}>{c.t === 'batch' ? c.tag : c.t === 'order' ? 'Order due' : c.t === 'task' ? 'Task' : 'Reminder'}</span>
                  <div className="cal2-prow-main">
                    <div className="cal2-prow-title">{c.label}</div>
                    {c.t === 'task' && c.raw.assignee && <div className="cal2-prow-sub">{c.raw.assignee}</div>}
                    {c.t === 'batch' && c.raw.assigned_to && <div className="cal2-prow-sub">{c.raw.assigned_to}</div>}
                  </div>
                  {c.t === 'order' && onOpenOrder && (
                    <button type="button" className="cal2-rem-open" onClick={() => onOpenOrder(c.id)}>Open</button>
                  )}
                  {c.t === 'task' && c.raw.order_id && onOpenOrder && (
                    <button type="button" className="cal2-rem-open" onClick={() => onOpenOrder(c.raw.order_id)}>Order</button>
                  )}
                  {c.t !== 'rem' && (
                    <button type="button" className="cal2-remindbtn"
                      onClick={() => setRemFor({
                        type: c.t === 'batch' ? 'batch' : c.t, id: c.id,
                        title: c.t === 'order' ? `${famOf(c.raw)} — order due` : c.label,
                        eventDate: c.day,
                      })}>
                      REMIND ME
                    </button>
                  )}
                </div>
              ))}
            </div>
            <div className="cal2-panel-foot">
              <button type="button" className="cal2-addbtn" onClick={() => { setQuickAdd({ date: peekDay }); setPeekDay(null) }}>+ Event this day</button>
              <button type="button" className="cal2-remindbtn" onClick={() => { setRemFor({ type: 'custom', eventDate: peekDay }); setPeekDay(null) }}>+ Reminder</button>
            </div>
          </div>
        </div>
      )}

      {quickAdd && (
        <QuickAddEvent date={quickAdd.date} onClose={() => setQuickAdd(null)}
          onCreated={() => { setQuickAdd(null); reload(); showToast('On the calendar.') }} />
      )}

      {remFor && (
        <ReminderComposer source={remFor} today={today} onClose={() => setRemFor(null)}
          onSaved={(n) => { setRemFor(null); reload(); showToast(`${n} reminder${n === 1 ? '' : 's'} set.`) }} />
      )}

      {toast && (
        <div className="cal2-toast">
          <span>{toast.text}</span>
          {toast.undoFn && (
            <button type="button" onClick={async () => { const fn = toast.undoFn; setToast(null); await fn() }}>UNDO</button>
          )}
        </div>
      )}
    </div>
  )
}

// ── Quick add — an event on THIS date; the calendar view never changes ──────
function QuickAddEvent({ date, onClose, onCreated }) {
  const [title, setTitle] = useState('')
  const [kind, setKind] = useState('site_visit')
  const [day, setDay] = useState(date)
  const [who, setWho] = useState('')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  const save = async () => {
    if (!title.trim() || !day || busy) return
    setBusy(true); setErr(null)
    const res = await createBatch({
      kind, title: title.trim(), scheduled_date: day,
      destination_cemetery_id: null, assigned_to: who || null,
      notes: notes.trim() || null, job_ids: [],
    })
    setBusy(false)
    if (!res.ok) { setErr(res.error || 'Could not save the event.'); return }
    onCreated()
  }

  return (
    <div className="cal2-scrim" onClick={busy ? undefined : onClose}>
      <div className="cal2-panel cal2-panel-sm" onClick={e => e.stopPropagation()}>
        <div className="cal2-panel-head">
          <div className="cal2-panel-title">New event — {fmtLong(day)}</div>
          <button type="button" className="cal2-navbtn" onClick={onClose}>&#215;</button>
        </div>
        <div className="cal2-form">
          <label><span>What</span>
            <input className="cal2-input" autoFocus placeholder="e.g. Meet the Kowalskis at the grave"
              value={title} onChange={e => setTitle(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') save() }} />
          </label>
          <div className="cal2-kindrow">
            <button type="button" className={`cal2-kindchip${kind === 'site_visit' ? ' on' : ''}`} onClick={() => setKind('site_visit')}>Site visit</button>
            <button type="button" className={`cal2-kindchip${kind === 'errand' ? ' on' : ''}`} onClick={() => setKind('errand')}>Errand</button>
          </div>
          <div className="cal2-form2">
            <label><span>Date</span>
              <input type="date" className="cal2-input" value={day} onChange={e => setDay(e.target.value)} />
            </label>
            <label><span>Who (optional)</span>
              <select className="cal2-input" value={who} onChange={e => setWho(e.target.value)}>
                <option value="">—</option>
                {STAFF_NAMES.map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
          </div>
          <label><span>Notes (optional)</span>
            <input className="cal2-input" placeholder="Address, gate code, what to bring…" value={notes} onChange={e => setNotes(e.target.value)} />
          </label>
          {err && <div className="cal2-err">{err}</div>}
          <button type="button" className="cal2-savebtn" onClick={save} disabled={busy || !title.trim() || !day}>
            {busy ? 'Saving…' : 'Put it on the calendar'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Reminder composer — several firings for one thing ───────────────────────
function ReminderComposer({ source, today, onClose, onSaved }) {
  const isCustom = source.type === 'custom'
  const [title, setTitle] = useState(source.title || '')
  const [eventDate, setEventDate] = useState(source.eventDate || '')
  const [picked, setPicked] = useState(() => new Set(['1d']))
  const [extraDates, setExtraDates] = useState([])
  const [extraDraft, setExtraDraft] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  const toggle = (k) => setPicked(prev => { const n = new Set(prev); if (n.has(k)) n.delete(k); else n.add(k); return n })
  const offsetDate = (o) => {
    if (!eventDate) return null
    return o.months ? addMonths(eventDate, -o.months) : addDays(eventDate, -o.days)
  }

  const firings = useMemo(() => {
    const out = []
    if (eventDate) for (const o of OFFSETS) if (picked.has(o.key)) { const d = offsetDate(o); if (d) out.push(d) }
    for (const d of extraDates) out.push(d)
    return [...new Set(out)].sort()
  }, [picked, extraDates, eventDate])

  const save = async () => {
    const t = title.trim()
    if (!t) { setErr('Name the reminder.'); return }
    if (!firings.length) { setErr('Pick when to be reminded — an offset or an exact date.'); return }
    setBusy(true); setErr(null)
    const staff = getActiveStaffUser()
    const res = await addCalendarReminders(firings.map(d => ({
      title: t, remind_on: d, event_date: eventDate || null,
      source_type: isCustom ? 'custom' : source.type, source_id: source.id || null,
      note: note.trim() || null, created_by: staff,
    })))
    setBusy(false)
    if (!res.ok) { setErr(res.error || 'Could not save.'); return }
    onSaved(firings.length)
  }

  return (
    <div className="cal2-scrim" onClick={busy ? undefined : onClose}>
      <div className="cal2-panel cal2-panel-sm" onClick={e => e.stopPropagation()}>
        <div className="cal2-panel-head">
          <div className="cal2-panel-title">Remind me</div>
          <button type="button" className="cal2-navbtn" onClick={onClose}>&#215;</button>
        </div>
        <div className="cal2-form">
          <label><span>About</span>
            <input className="cal2-input" value={title} placeholder="e.g. Order the Kowalski bronze"
              onChange={e => setTitle(e.target.value)} />
          </label>
          <label><span>The date it's for {isCustom ? '(optional)' : ''}</span>
            <input type="date" className="cal2-input" value={eventDate} onChange={e => setEventDate(e.target.value)} />
          </label>
          {eventDate && (
            <div>
              <div className="cal2-form-lab">Remind me…</div>
              <div className="cal2-kindrow wrap">
                {OFFSETS.map(o => {
                  const d = offsetDate(o)
                  const past = d && d < today
                  return (
                    <button key={o.key} type="button"
                      className={`cal2-kindchip${picked.has(o.key) ? ' on' : ''}${past ? ' past' : ''}`}
                      title={d ? (past ? `${fmtShort(d)} — already passed, fires immediately` : fmtShort(d)) : ''}
                      onClick={() => toggle(o.key)}>
                      {o.label}
                    </button>
                  )
                })}
              </div>
            </div>
          )}
          <div>
            <div className="cal2-form-lab">…or on an exact date</div>
            <div className="cal2-form2" style={{ alignItems: 'end' }}>
              <label><span>Date</span>
                <input type="date" className="cal2-input" value={extraDraft} onChange={e => setExtraDraft(e.target.value)} />
              </label>
              <button type="button" className="cal2-kindchip" style={{ height: 38 }}
                onClick={() => { if (extraDraft) { setExtraDates(prev => [...new Set([...prev, extraDraft])]); setExtraDraft('') } }}>
                + Add date
              </button>
            </div>
            {extraDates.length > 0 && (
              <div className="cal2-kindrow wrap" style={{ marginTop: 6 }}>
                {extraDates.map(d => (
                  <button key={d} type="button" className="cal2-kindchip on" title="Remove"
                    onClick={() => setExtraDates(prev => prev.filter(x => x !== d))}>
                    {fmtShort(d)} &#215;
                  </button>
                ))}
              </div>
            )}
          </div>
          <label><span>Note (optional)</span>
            <input className="cal2-input" placeholder="What future-you needs to know" value={note} onChange={e => setNote(e.target.value)} />
          </label>
          {firings.length > 0 && (
            <div className="cal2-firings">Will fire {firings.length} time{firings.length === 1 ? '' : 's'}: {firings.map(fmtShort).join(' · ')}</div>
          )}
          {err && <div className="cal2-err">{err}</div>}
          <button type="button" className="cal2-savebtn" onClick={save} disabled={busy}>
            {busy ? 'Saving…' : 'Set the reminder'}
          </button>
        </div>
      </div>
    </div>
  )
}

const CSS = `
  .cal2 { max-width: 1280px; margin: 0 auto; padding: 26px 28px 80px; }

  .cal2-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; flex-wrap: wrap; margin-bottom: 14px; }
  .cal2-title { font-family: 'Fraunces', Georgia, 'Times New Roman', serif; font-size: 34px; font-weight: 600; letter-spacing: -0.01em; color: #0F1419; margin: 0; }
  .cal2-sub { font-size: 12.5px; color: #8a8472; margin-top: 3px; }
  .cal2-nav { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .cal2-navbtn { font: inherit; width: 34px; height: 34px; border-radius: 10px; border: 1px solid #DCD6C8; background: #fff; color: #2a2a27; font-size: 17px; cursor: pointer; line-height: 1; }
  .cal2-navbtn:hover { border-color: #9A7209; color: #9A7209; }
  .cal2-todaybtn { font: inherit; font-size: 12.5px; font-weight: 700; padding: 8px 14px; border-radius: 10px; border: 1px solid #DCD6C8; background: #fff; color: #2a2a27; cursor: pointer; }
  .cal2-todaybtn:hover { border-color: #9A7209; color: #9A7209; }
  .cal2-viewtog { display: inline-flex; background: #ECE6D8; border-radius: 10px; padding: 3px; }
  .cal2-viewtog button { font: inherit; font-size: 12.5px; font-weight: 700; border: none; background: transparent; color: #7a756a; padding: 6px 14px; border-radius: 8px; cursor: pointer; }
  .cal2-viewtog button.on { background: #fff; color: #0F1419; box-shadow: 0 1px 3px rgba(0,0,0,0.12); }
  .cal2-addbtn { font: inherit; font-size: 12.5px; font-weight: 700; padding: 8px 16px; border-radius: 10px; border: 1px solid #9A7209; background: #9A7209; color: #fff; cursor: pointer; }
  .cal2-addbtn:hover { background: #7d5d07; }

  .cal2-layers { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 14px; }
  .cal2-layers-lab { font-size: 10.5px; font-weight: 800; letter-spacing: 0.12em; text-transform: uppercase; color: #9a9486; }
  .cal2-layer { font: inherit; font-size: 12.5px; font-weight: 600; display: inline-flex; align-items: center; gap: 7px; padding: 6px 13px; border-radius: 999px; border: 1px solid #DCD6C8; background: #fff; color: #8a8472; cursor: pointer; }
  .cal2-layer .dot { width: 8px; height: 8px; border-radius: 50%; background: #C9C3B4; }
  .cal2-layer.on { color: #0F1419; border-color: #0F1419; }
  .cal2-layer-runs.on .dot { background: #0F1419; }
  .cal2-layer-tasks.on .dot { background: #234C8A; }
  .cal2-layer-orders.on .dot { background: #B3261E; }
  .cal2-layer-rems.on .dot { background: #9A7209; }
  .cal2-duejump { font: inherit; font-size: 12.5px; font-weight: 800; margin-left: auto; padding: 7px 14px; border-radius: 999px; border: 1px solid #B3261E; background: #B3261E; color: #fff; cursor: pointer; animation: cal2pulse 2.2s ease-in-out infinite; }
  @keyframes cal2pulse { 0%,100% { box-shadow: 0 0 0 0 rgba(179,38,30,0.35); } 50% { box-shadow: 0 0 0 7px rgba(179,38,30,0); } }

  .cal2-card { background: #fff; border: 1px solid #E6E1D4; border-radius: 18px; overflow: hidden; box-shadow: 0 10px 34px rgba(15,20,25,0.06); }
  /* Days are TILES separated by real gridlines (1px gap over a line-color
     background) and every cell CLIPS its content — chips truncate with an
     ellipsis and can never widen a column or bleed into the next day (the
     July-2026 screenshot: days with due dates visually merged into their
     empty neighbors). minmax(0,1fr) keeps all seven columns dead equal. */
  .cal2-dow { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); background: #0F1419; }
  .cal2-dow span { font-size: 10.5px; font-weight: 800; letter-spacing: 0.14em; text-transform: uppercase; color: #C7B575; padding: 10px 12px; min-width: 0; }
  .cal2-grid { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 1px; background: #E3DECE; border-top: 1px solid #E3DECE; }
  .cal2-cell { background: #fff; min-width: 0; overflow: hidden; min-height: 118px; padding: 7px 8px 9px; cursor: pointer; transition: background 0.12s; position: relative; }
  .cal2-cell:hover { background: #FBF9F3; }
  .cal2-cell.dim { background: #FAF8F2; }
  .cal2-cell.dim .cal2-daynum { color: #C6C0B0; }
  .cal2-cell.today { background: #FBF6E8; }
  .cal2-cell.today .cal2-daynum { background: #9A7209; color: #fff; }
  .cal2-cell.drop { background: #F3ECD8; box-shadow: inset 0 0 0 2px #9A7209; }
  .cal2-cell.wk { min-height: 300px; }
  .cal2-cell-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 5px; }
  .cal2-daynum { font-size: 12.5px; font-weight: 800; color: #4a463f; width: 24px; height: 24px; display: inline-flex; align-items: center; justify-content: center; border-radius: 8px; font-variant-numeric: tabular-nums; }
  .cal2-cell-add { font: inherit; width: 22px; height: 22px; border-radius: 7px; border: none; background: transparent; color: #C6C0B0; font-size: 15px; line-height: 1; cursor: pointer; opacity: 0; transition: opacity 0.12s; }
  .cal2-cell:hover .cal2-cell-add { opacity: 1; }
  .cal2-cell-add:hover { background: #9A7209; color: #fff; }
  .cal2-chips { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
  .cal2-chip { font-size: 11px; font-weight: 700; border-radius: 6px; padding: 3px 7px; cursor: grab; overflow: hidden; border-left: 3px solid transparent; max-width: 100%; min-width: 0; }
  .cal2-chip:active { cursor: grabbing; }
  .cal2-chip-txt { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .cal2-batch { background: #0F1419; color: #F3EBD8; border-left-color: #C7B575; }
  .cal2-task { background: #EAF1FB; color: #234C8A; border-left-color: #234C8A; }
  .cal2-order { background: #FDECEB; color: #8f1d17; border-left-color: #B3261E; }
  .cal2-rem { }
  .cal2-chip.cal2-rem { background: #F7ECD4; color: #6d5106; border-left-color: #9A7209; }
  .cal2-more { font-size: 10.5px; font-weight: 700; color: #9a9486; padding: 1px 2px; }

  .cal2-rems { margin-top: 26px; background: #fff; border: 1px solid #E6E1D4; border-radius: 18px; padding: 18px 20px; box-shadow: 0 10px 34px rgba(15,20,25,0.06); }
  .cal2-rems-head { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
  .cal2-rems-title { font-family: 'Fraunces', Georgia, 'Times New Roman', serif; font-size: 22px; font-weight: 600; color: #0F1419; margin: 0; }
  .cal2-rems-count { font-size: 12px; font-weight: 800; background: #B3261E; color: #fff; border-radius: 999px; padding: 3px 12px; }
  .cal2-rems-spacer { flex: 1; }
  .cal2-rems-empty { font-size: 13px; color: #9a9486; padding: 10px 2px 6px; line-height: 1.55; }
  .cal2-rem { display: flex; align-items: center; gap: 14px; padding: 12px 14px; border-radius: 12px; margin-bottom: 8px; }
  .cal2-rem-due { background: #FFF7F6; border: 1px solid #EFC5C1; border-left: 5px solid #B3261E; }
  .cal2-rem:not(.cal2-rem-due) { border: 1px solid #EFEBE0; }
  .cal2-rem-main { flex: 1; min-width: 0; }
  .cal2-rem-title { font-size: 15.5px; font-weight: 800; color: #0F1419; }
  .cal2-rem-title.sm { font-size: 13.5px; font-weight: 700; }
  .cal2-rem-sub { font-size: 12px; color: #8a8472; margin-top: 2px; }
  .cal2-rem-date { font-size: 12px; font-weight: 800; color: #6d5106; background: #F7ECD4; border-radius: 8px; padding: 4px 10px; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .cal2-ackbtn { font: inherit; font-size: 12.5px; font-weight: 800; letter-spacing: 0.06em; padding: 10px 20px; border-radius: 10px; border: none; background: #9A7209; color: #fff; cursor: pointer; box-shadow: 0 3px 10px rgba(154,114,9,0.35); }
  .cal2-ackbtn:hover { background: #7d5d07; }
  .cal2-rem-open { font: inherit; font-size: 12px; font-weight: 700; padding: 7px 12px; border-radius: 9px; border: 1px solid #DCD6C8; background: #fff; color: #2a2a27; cursor: pointer; white-space: nowrap; }
  .cal2-rem-open:hover { border-color: #9A7209; color: #9A7209; }
  .cal2-rem-x { font: inherit; font-size: 11.5px; font-weight: 700; border: none; background: none; color: #b3aea2; cursor: pointer; }
  .cal2-rem-x:hover { color: #B3261E; }
  .cal2-rems-uphead { font-size: 10.5px; font-weight: 800; letter-spacing: 0.12em; text-transform: uppercase; color: #9a9486; margin: 14px 0 8px; }

  .cal2-scrim { position: fixed; inset: 0; z-index: 1300; background: rgba(15,20,25,0.48); display: flex; align-items: center; justify-content: center; padding: 24px; }
  .cal2-panel { background: #fff; border-radius: 16px; width: min(560px, 96vw); max-height: 88vh; display: flex; flex-direction: column; box-shadow: 0 30px 80px rgba(0,0,0,0.35); overflow: hidden; }
  .cal2-panel-sm { width: min(480px, 96vw); }
  .cal2-panel-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 16px 18px 12px; }
  .cal2-panel-title { font-family: 'Fraunces', Georgia, serif; font-size: 19px; font-weight: 600; color: #0F1419; }
  .cal2-panel-sub { font-size: 12px; color: #8a8472; margin-top: 2px; }
  .cal2-panel-body { padding: 0 18px 12px; overflow-y: auto; }
  .cal2-panel-foot { display: flex; gap: 8px; padding: 12px 18px 16px; border-top: 1px solid #EFEBE0; }
  .cal2-prow { display: flex; align-items: center; gap: 10px; padding: 9px 0; border-top: 1px solid #F3F0E8; }
  .cal2-prow:first-child { border-top: none; }
  .cal2-ptag { font-size: 10px; font-weight: 800; letter-spacing: 0.05em; text-transform: uppercase; border-radius: 6px; padding: 3px 8px; white-space: nowrap; }
  .cal2-ptag.cal2-batch { background: #0F1419; color: #F3EBD8; }
  .cal2-ptag.cal2-task { background: #EAF1FB; color: #234C8A; }
  .cal2-ptag.cal2-order { background: #FDECEB; color: #8f1d17; }
  .cal2-ptag.cal2-rem { background: #F7ECD4; color: #6d5106; }
  .cal2-prow-main { flex: 1; min-width: 0; }
  .cal2-prow-title { font-size: 13.5px; font-weight: 700; color: #16150F; }
  .cal2-prow-sub { font-size: 11.5px; color: #8a8472; }
  .cal2-remindbtn { font: inherit; font-size: 11px; font-weight: 800; letter-spacing: 0.05em; padding: 7px 12px; border-radius: 9px; border: 1px solid #9A7209; background: #fff; color: #9A7209; cursor: pointer; white-space: nowrap; }
  .cal2-remindbtn:hover { background: #9A7209; color: #fff; }

  .cal2-form { display: flex; flex-direction: column; gap: 12px; padding: 0 18px 18px; }
  .cal2-form label { display: flex; flex-direction: column; gap: 5px; }
  .cal2-form label > span, .cal2-form-lab { font-size: 10.5px; font-weight: 800; letter-spacing: 0.1em; text-transform: uppercase; color: #8a8472; }
  .cal2-form-lab { display: block; margin-bottom: 6px; }
  .cal2-form2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .cal2-input { font: inherit; font-size: 14px; padding: 9px 12px; border: 1px solid #DCD6C8; border-radius: 10px; background: #fff; color: #16150F; width: 100%; }
  .cal2-input:focus { outline: none; border-color: #9A7209; box-shadow: 0 0 0 3px rgba(154,114,9,0.14); }
  .cal2-kindrow { display: flex; gap: 7px; }
  .cal2-kindrow.wrap { flex-wrap: wrap; }
  .cal2-kindchip { font: inherit; font-size: 12.5px; font-weight: 700; padding: 8px 14px; border-radius: 999px; border: 1px solid #DCD6C8; background: #fff; color: #6b6256; cursor: pointer; }
  .cal2-kindchip.on { background: #0F1419; border-color: #0F1419; color: #F3EBD8; }
  .cal2-kindchip.past { border-style: dashed; }
  .cal2-firings { font-size: 12.5px; font-weight: 700; color: #6d5106; background: #F7ECD4; border-radius: 10px; padding: 9px 12px; }
  .cal2-err { font-size: 12.5px; color: #B3261E; background: rgba(179,38,30,0.07); border-radius: 9px; padding: 8px 12px; }
  .cal2-savebtn { font: inherit; font-size: 14px; font-weight: 800; padding: 12px; border-radius: 11px; border: none; background: #9A7209; color: #fff; cursor: pointer; }
  .cal2-savebtn:hover:not(:disabled) { background: #7d5d07; }
  .cal2-savebtn:disabled { opacity: 0.5; cursor: default; }

  .cal2-toast { position: fixed; bottom: 26px; left: 50%; transform: translateX(-50%); z-index: 1400; background: #0F1419; color: #F3EBD8; font-size: 13.5px; font-weight: 600; border-radius: 12px; padding: 12px 18px; display: flex; align-items: center; gap: 16px; box-shadow: 0 12px 34px rgba(0,0,0,0.4); }
  .cal2-toast button { font: inherit; font-size: 12px; font-weight: 800; letter-spacing: 0.06em; border: none; background: none; color: #E4C465; cursor: pointer; }

  @media (max-width: 860px) {
    .cal2 { padding: 16px 12px 60px; }
    .cal2-cell { min-height: 84px; padding: 5px 5px 7px; }
    .cal2-title { font-size: 26px; }
  }
`
