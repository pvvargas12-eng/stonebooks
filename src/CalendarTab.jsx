// =============================================================================
// CalendarTab — the shop calendar (CAL-3, 2026-07-27)
// =============================================================================
// Paul's upgrade list, all of it:
//   • CLICK ANY EVENT TO EDIT IT (his #1) — same card as creation, plus Delete.
//   • Typed events with a permanent KEY: Run/Install · Pickup · Appointment ·
//     Meeting · Check job · Task (lands in the task list) · Order due ·
//     Reminder. Errand and Call are OUT of the vocabulary.
//   • Times (start/end), multi-day banners (date → through date), simple
//     recurrence (daily / weekdays / weekly / monthly + until), multi-person
//     WHO, attach an order or lead, per-event banner color over the type color.
//   • CALENDARS: All / Admin·Sales / Production / Personal (personal = mine:
//     my tasks, my events, events I'm on).
//   • PRODUCTION DAY PRIORITY — declare the day (Inscriptions / Foundations /
//     Blasting / Setting); the band on the day opens the matching WORK LIST
//     (install_list / foundation_list / stencil_cut_list) with add/remove.
// Events stay work_batches rows — Scheduler + field Today read the same truth.
// CAL-2's drag-to-move, reminders board, and layer toggles all survive.
// =============================================================================
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  getCalendarBatches, expandBatchOccurrences, updateBatch, createBatch, deleteBatch,
  listShopTasks, updateShopTask, addShopTask,
  listOrderDueDates, setOrderTargetDate,
  listCalendarReminders, addCalendarReminders, acknowledgeCalendarReminder,
  updateCalendarReminder, deleteCalendarReminder,
  getDayFocusRange, setDayFocus,
  getInstallList, addToInstallList, removeFromInstallList,
  getFoundationList, addToFoundationList, removeFromFoundationList,
  getStencilCutList, addToStencilCutList, removeFromStencilCutList,
  getJobs, searchOrdersLight,
  getActiveStaffUser, todayISO, properName,
} from './lib/stonebooksData'
import { getActiveEmployees, loadEmployees } from './lib/employees'

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

// '13:30' → '1:30p' — chips carry the start time in four characters.
const fmtTime = (t) => {
  if (!t) return ''
  const [h, m] = String(t).split(':').map(Number)
  if (!Number.isFinite(h)) return ''
  const ap = h >= 12 ? 'p' : 'a'
  const hr = h % 12 === 0 ? 12 : h % 12
  return `${hr}${m ? ':' + pad2(m) : ''}${ap}`
}
const TIME_OPTS = (() => {
  const out = []
  for (let h = 6; h <= 19; h++) for (const m of [0, 30]) out.push(`${pad2(h)}:${pad2(m)}`)
  return out
})()

// ── The type vocabulary (Paul 2026-07-27) — colors are the KEY ──────────────
// Every run-family Scheduler kind wears the RUN tone; legacy site_visit rows
// read as appointments, legacy errand rows as pickups — the old vocabulary
// folds into the new one instead of breaking it.
const toneOfBatch = (b) => {
  const k = b.kind
  if (k === 'pickup' || k === 'errand') return 'pickup'
  if (k === 'appointment' || k === 'site_visit') return 'appt'
  if (k === 'meeting') return 'meet'
  return 'run'
}
const KIND_LABEL = {
  inscription: 'Inscription', blasting: 'Blasting', setting: 'Install', delivery: 'Delivery',
  acid_wash: 'Acid wash', repair: 'Repair', rub_grab: 'Rub & grab', foundation_trip: 'Foundation',
  door_trip: 'Door trip', site_visit: 'Appointment', errand: 'Pickup',
  pickup: 'Pickup', appointment: 'Appointment', meeting: 'Meeting',
}
const famOf = (o) => properName(o?.primary_lastname
  || [o?.customer?.first_name, o?.customer?.last_name].filter(Boolean).join(' ')
  || o?.order_number || '—')

// Focus-day shading (Paul 2026-07-27): the WHOLE day wears the priority's
// color — a readable tint, with the full-strength band on top.
const hexTint = (hex, a) => {
  const h = String(hex || '').replace('#', '')
  if (h.length !== 6) return undefined
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16)
  return `rgba(${r},${g},${b},${a})`
}

const SCOPES = [
  { key: 'all', label: 'All' },
  { key: 'admin_sales', label: 'Admin / Sales' },
  { key: 'production', label: 'Production' },
  { key: 'personal', label: 'Personal' },
]
const LAYERS = [
  { key: 'runs', label: 'Events' },
  { key: 'tasks', label: 'Tasks' },
  { key: 'orders', label: 'Order due' },
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

// Production day focus — the four days Paul runs.
const FOCUS = [
  { key: 'inscriptions', label: 'Inscriptions', color: '#534AB7' },
  { key: 'foundations', label: 'Foundations', color: '#A05A12' },
  { key: 'blasting', label: 'Blasting', color: '#5F5E5A' },
  { key: 'setting', label: 'Setting', color: '#1D7A55' },
]
const FOCUS_BY_KEY = new Map(FOCUS.map(f => [f.key, f]))

export default function CalendarTab({ onOpenOrder }) {
  const [today] = useState(() => todayISO())
  const [view, setView] = useState(() => { try { return localStorage.getItem('sb_cal_view') === 'week' ? 'week' : 'month' } catch { return 'month' } })
  const [anchor, setAnchor] = useState(() => todayISO())
  const [scope, setScope] = useState(() => { try { return localStorage.getItem('sb_cal_scope') || 'all' } catch { return 'all' } })
  const [layers, setLayers] = useState(() => {
    try { const v = JSON.parse(localStorage.getItem('sb_cal_layers') || 'null'); if (v && typeof v === 'object') return { runs: true, tasks: true, orders: true, rems: true, ...v } } catch { /* defaults */ }
    return { runs: true, tasks: true, orders: true, rems: true }
  })
  const me = useMemo(() => getActiveStaffUser() || null, [])
  const [staff, setStaff] = useState([])
  const [deptOf, setDeptOf] = useState({})
  useEffect(() => {
    let alive = true
    loadEmployees().catch(() => {}).then(() => {
      if (!alive) return
      const rows = getActiveEmployees()
      setStaff(rows.map(r => r.name))
      const m = {}
      for (const r of rows) m[r.name] = r.department || null
      setDeptOf(m)
    })
    return () => { alive = false }
  }, [])

  const setViewPersist = (v) => { setView(v); try { localStorage.setItem('sb_cal_view', v) } catch { /* ok */ } }
  const setScopePersist = (s) => { setScope(s); try { localStorage.setItem('sb_cal_scope', s) } catch { /* ok */ } }
  const toggleLayer = (k) => setLayers(prev => {
    const next = { ...prev, [k]: !prev[k] }
    try { localStorage.setItem('sb_cal_layers', JSON.stringify(next)) } catch { /* ok */ }
    return next
  })

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
  const [rems, setRems] = useState([])
  const [focusMap, setFocusMap] = useState({})
  const [loading, setLoading] = useState(true)
  const [nonce, setNonce] = useState(0)
  const reload = () => setNonce(n => n + 1)

  useEffect(() => {
    let alive = true
    setLoading(true)
    Promise.all([
      getCalendarBatches({ from: range.start, to: range.end }).catch(() => []),
      listShopTasks().catch(() => []),
      listOrderDueDates({ from: range.start, to: range.end }).catch(() => []),
      listCalendarReminders().catch(() => []),
      getDayFocusRange(range.start, range.end).catch(() => ({})),
    ]).then(([b, t, d, r, f]) => {
      if (!alive) return
      setBatches((b || []).filter(x => x.status !== 'cancelled'))
      setTasks((t || []).filter(x => x.status !== 'done' && x.due_date))
      setDues(d || [])
      setRems(r || [])
      setFocusMap(f || {})
      setLoading(false)
    })
    return () => { alive = false }
  }, [range.start, range.end, nonce])

  // ── Scope filters ─────────────────────────────────────────────────────────
  const batchInScope = (b) => {
    const s = b.calendar_scope || 'all'
    const mine = (me && (b.owner_name === me || (Array.isArray(b.attendees) && b.attendees.includes(me))))
    if (s === 'personal') return scope === 'personal' && b.owner_name === me
    if (scope === 'all') return true
    if (scope === 'personal') return !!mine
    return s === 'all' || s === scope
  }
  const taskInScope = (t) => {
    if (scope === 'all') return true
    if (scope === 'personal') return !!me && (t.assignee === me || (t.assignee_kind === 'department' && deptOf[me] === t.assignee))
    const dept = t.assignee_kind === 'department' ? t.assignee : (deptOf[t.assignee] || null)
    if (scope === 'production') return dept === 'Production' || dept === 'Installation'
    return dept !== 'Production' && dept !== 'Installation'
  }
  const orderInScope = () => scope !== 'personal'
  const remInScope = (r) => scope !== 'personal' || (!!me && r.created_by === me)

  // ── Chips per day ─────────────────────────────────────────────────────────
  const chipsByDay = useMemo(() => {
    const m = new Map()
    const push = (day, chip) => { if (!m.has(day)) m.set(day, []); m.get(day).push(chip) }
    if (layers.runs) for (const b of batches) {
      if (!b.scheduled_date || !batchInScope(b)) continue
      const tone = toneOfBatch(b)
      const kind = KIND_LABEL[b.kind] || b.kind
      const label = b.title || `${kind}${b.cemetery?.name ? ' — ' + b.cemetery.name : ''}`
      const spanEnd = b.end_date ? String(b.end_date).slice(0, 10) : null
      const days = expandBatchOccurrences(b, range.start, range.end)
      for (const day of days) {
        if (spanEnd && !b.recur_rule) {
          // multi-day banner: one chip on every covered day
          let d = day
          while (d <= spanEnd && d <= range.end) {
            push(d, { t: 'batch', id: b.id, day: d, label, tag: kind, tone, raw: b, banner: true })
            d = addDays(d, 1)
          }
        } else {
          push(day, { t: 'batch', id: b.id, day, label, tag: kind, tone, raw: b, time: fmtTime(b.start_time), recurs: !!b.recur_rule })
        }
      }
    }
    if (layers.tasks) for (const t of tasks) {
      if (!taskInScope(t)) continue
      const day = String(t.due_date).slice(0, 10)
      const check = t.task_type === 'check_job'
      push(day, { t: 'task', id: t.id, day, label: t.title, tag: t.assignee || 'Task', raw: t, check })
    }
    if (layers.orders && orderInScope()) for (const o of dues) {
      const day = String(o.target_completion_date).slice(0, 10)
      push(day, { t: 'order', id: o.id, day, label: `DUE — ${famOf(o)}`, tag: o.order_number || 'Order', raw: o })
    }
    if (layers.rems) for (const r of rems) {
      if (!remInScope(r)) continue
      const day = String(r.remind_on).slice(0, 10)
      push(day, { t: 'rem', id: r.id, day, label: r.title, tag: 'Reminder', raw: r })
    }
    for (const list of m.values()) {
      const rank = { batch: 0, order: 1, task: 2, rem: 3 }
      list.sort((a, b) => (rank[a.t] - rank[b.t]) || String(a.time || '').localeCompare(String(b.time || '')) || String(a.label).localeCompare(String(b.label)))
    }
    return m
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batches, tasks, dues, rems, layers, scope, me, deptOf, range.start, range.end])

  // ── Toast with UNDO ───────────────────────────────────────────────────────
  const [toast, setToast] = useState(null)
  const toastTimer = useRef(null)
  const showToast = (text, undoFn = null) => {
    if (toastTimer.current) clearTimeout(toastTimer.current)
    setToast({ text, undoFn })
    toastTimer.current = setTimeout(() => setToast(null), 8000)
  }

  // ── Drag any chip → any day ───────────────────────────────────────────────
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

  // ── Panels ────────────────────────────────────────────────────────────────
  const [editor, setEditor] = useState(null)     // { date } new | { batch } edit
  const [peekDay, setPeekDay] = useState(null)
  const [remFor, setRemFor] = useState(null)
  const [focusPanel, setFocusPanel] = useState(null)   // { day, focusKey }

  const dueNow = useMemo(() => rems.filter(r => String(r.remind_on).slice(0, 10) <= today), [rems, today])
  const upcoming = useMemo(() => rems.filter(r => String(r.remind_on).slice(0, 10) > today), [rems, today])

  const ack = async (r) => {
    const res = await acknowledgeCalendarReminder(r.id, me)
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
  const cycleFocus = async (day) => {
    const cur = focusMap[day] || null
    const order = [null, ...FOCUS.map(f => f.key)]
    const next = order[(order.indexOf(cur) + 1) % order.length]
    setFocusMap(prev => { const n = { ...prev }; if (next) n[day] = next; else delete n[day]; return n })
    const res = await setDayFocus(day, next, me)
    if (!res.ok) { showToast(res.error || 'Could not set the day priority.'); reload() }
  }

  const go = (n) => setAnchor(a => view === 'week' ? addDays(a, 7 * n) : addMonths(monthStart(a), n))
  const showFocusBand = scope === 'all' || scope === 'production'

  const dayCell = (day) => {
    const chips = chipsByDay.get(day) || []
    const inMonth = view === 'week' || sameMonth(day, monthStart(anchor))
    const isToday = day === today
    const focusKey = showFocusBand ? focusMap[day] : null
    const focus = focusKey ? FOCUS_BY_KEY.get(focusKey) : null
    const cap = view === 'week' ? 14 : (focus ? 2 : 3)
    const shown = chips.slice(0, cap)
    const more = chips.length - shown.length
    const cellStyle = focus ? { background: hexTint(focus.color, inMonth ? 0.15 : 0.07) } : undefined
    return (
      <div key={day}
        className={`cal2-cell${inMonth ? '' : ' dim'}${isToday ? ' today' : ''}${dragOverDay === day ? ' drop' : ''}${view === 'week' ? ' wk' : ''}`}
        style={cellStyle}
        onDragOver={e => { e.preventDefault(); setDragOverDay(day) }}
        onDragLeave={() => setDragOverDay(d => (d === day ? null : d))}
        onDrop={e => onDayDrop(e, day)}
        onClick={() => { if (!draggingRef.current) setPeekDay(day) }}
      >
        <div className="cal2-cell-head">
          <span className="cal2-daynum">{dayNum(day)}</span>
          <button type="button" className="cal2-cell-add" title="Add on this day"
            onClick={e => { e.stopPropagation(); setEditor({ date: day }) }}>+</button>
        </div>
        {focus && (
          <button type="button" className="cal2-focusband" style={{ background: focus.color }}
            title={`${focus.label} day — click to open the list`}
            onClick={e => { e.stopPropagation(); setFocusPanel({ day, focusKey }) }}>
            {focus.label.toUpperCase()}
          </button>
        )}
        <div className="cal2-chips">
          {shown.map((c, i) => {
            const style = {}
            if (c.t === 'batch') {
              const tone = TONE_STYLE[c.tone] || TONE_STYLE.run
              style.background = c.raw.color || tone.bg
              style.color = tone.fg
              style.borderLeftColor = tone.edge
              if (c.banner) { style.backgroundImage = c.raw.color ? 'none' : undefined }
            }
            return (
              <div key={`${c.t}-${c.id}-${i}`}
                className={`cal2-chip cal2-${c.t}${c.check ? ' cal2-check' : ''}${c.banner ? ' cal2-banner' : ''}`}
                style={style}
                draggable={!c.banner && !c.recurs}
                onDragStart={e => onChipDragStart(e, c)}
                onDragEnd={onChipDragEnd}
                onClick={e => {
                  e.stopPropagation()
                  if (c.t === 'batch') setEditor({ batch: c.raw })
                  else setPeekDay(day)
                }}
                title={`${c.label}${c.banner || c.recurs ? '' : ' — drag to move'}`}>
                <span className="cal2-chip-txt">
                  {c.time && <b className="cal2-chip-time">{c.time}</b>}
                  {c.label}
                  {c.recurs && <span className="cal2-chip-rpt">&#10227;</span>}
                </span>
              </div>
            )
          })}
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
          <div className="cal2-sub">{loading ? 'Loading…' : 'Click any event to edit it. Drag anything to any day.'}</div>
        </div>
        <div className="cal2-nav">
          <button type="button" className="cal2-navbtn" onClick={() => go(-1)} aria-label="Back">&#8249;</button>
          <button type="button" className="cal2-todaybtn" onClick={() => setAnchor(today)}>Today</button>
          <button type="button" className="cal2-navbtn" onClick={() => go(1)} aria-label="Forward">&#8250;</button>
          <div className="cal2-viewtog">
            <button type="button" className={view === 'month' ? 'on' : ''} onClick={() => setViewPersist('month')}>Month</button>
            <button type="button" className={view === 'week' ? 'on' : ''} onClick={() => setViewPersist('week')}>Week</button>
          </div>
          <button type="button" className="cal2-addbtn" onClick={() => setEditor({ date: today })}>+ New event</button>
        </div>
      </div>

      {/* ── Calendars + layers ───────────────────────────────────────────── */}
      <div className="cal2-layers">
        <span className="cal2-layers-lab">Calendar</span>
        <div className="cal2-viewtog">
          {SCOPES.map(s => (
            <button key={s.key} type="button" className={scope === s.key ? 'on' : ''}
              onClick={() => setScopePersist(s.key)}>
              {s.key === 'personal' && me ? `Personal — ${me}` : s.label}
            </button>
          ))}
        </div>
        <span className="cal2-layers-lab" style={{ marginLeft: 10 }}>Show</span>
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

      {/* ── THE KEY — always visible ─────────────────────────────────────── */}
      <div className="cal2-key">
        <span className="cal2-key-lab">KEY</span>
        <span className="cal2-key-chip"><i style={{ background: '#1A1E24', boxShadow: 'inset 2px 0 0 #C7B575' }} />Run / Install</span>
        <span className="cal2-key-chip"><i style={{ background: '#A05A12' }} />Pickup</span>
        <span className="cal2-key-chip"><i style={{ background: '#2E5FA3' }} />Appointment</span>
        <span className="cal2-key-chip"><i style={{ background: '#6B4FA0' }} />Meeting</span>
        <span className="cal2-key-chip"><i style={{ background: '#fff', border: '2px solid #1D7A55' }} />Check job</span>
        <span className="cal2-key-chip"><i style={{ background: '#fff', border: '2px solid #234C8A' }} />Task</span>
        <span className="cal2-key-chip"><i style={{ background: '#FDECEB', borderLeft: '3px solid #B3261E', borderRadius: 2 }} />Order due</span>
        <span className="cal2-key-chip"><i style={{ background: '#fff', border: '2px solid #9A7209' }} />Reminder</span>
        {showFocusBand && FOCUS.map(f => (
          <span key={f.key} className="cal2-key-chip"><i style={{ background: f.color }} />{f.label} day</span>
        ))}
        <span className="cal2-key-chip"><span className="cal2-chip-rpt" style={{ color: '#6b6256', fontSize: 13 }}>&#10227;</span>Repeats</span>
      </div>

      {/* ── The grid ─────────────────────────────────────────────────────── */}
      <div className="cal2-card">
        <div className="cal2-dow">{DOW.map(d => <span key={d}>{d}</span>)}</div>
        <div className={`cal2-grid${view === 'week' ? ' wk' : ''}`}>
          {range.days.map(dayCell)}
        </div>
      </div>

      {/* ── REMINDERS ────────────────────────────────────────────────────── */}
      <section id="cal2-reminders" className="cal2-rems">
        <div className="cal2-rems-head">
          <h2 className="cal2-rems-title">Reminders</h2>
          {dueNow.length > 0 && <span className="cal2-rems-count">{dueNow.length} waiting</span>}
          <span className="cal2-rems-spacer" />
          <button type="button" className="cal2-addbtn" onClick={() => setRemFor({ type: 'custom' })}>+ Reminder</button>
        </div>
        {dueNow.length === 0 && upcoming.length === 0 && (
          <div className="cal2-rems-empty">Nothing on the board. Open any day and hit REMIND ME on an item. Each reminder stays here until somebody acknowledges it.</div>
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
            {showFocusBand && (
              <div className="cal2-focusrow">
                <span className="cal2-form-lab" style={{ margin: 0 }}>Production day priority</span>
                <div className="cal2-kindrow wrap" style={{ marginTop: 6 }}>
                  <button type="button" className={`cal2-kindchip${!focusMap[peekDay] ? ' on' : ''}`}
                    onClick={() => { setFocusMap(prev => { const n = { ...prev }; delete n[peekDay]; return n }); setDayFocus(peekDay, null, me) }}>None</button>
                  {FOCUS.map(f => (
                    <button key={f.key} type="button" className={`cal2-kindchip${focusMap[peekDay] === f.key ? ' on' : ''}`}
                      onClick={() => { setFocusMap(prev => ({ ...prev, [peekDay]: f.key })); setDayFocus(peekDay, f.key, me) }}>
                      {f.label}
                    </button>
                  ))}
                  {focusMap[peekDay] && (
                    <button type="button" className="cal2-remindbtn"
                      onClick={() => { setFocusPanel({ day: peekDay, focusKey: focusMap[peekDay] }); setPeekDay(null) }}>
                      OPEN THE LIST
                    </button>
                  )}
                </div>
              </div>
            )}
            <div className="cal2-panel-body">
              {(chipsByDay.get(peekDay) || []).length === 0 && <div className="cal2-rems-empty">Nothing on this day yet.</div>}
              {(chipsByDay.get(peekDay) || []).map((c, i) => (
                <div key={`${c.t}-${c.id}-${i}`} className="cal2-prow">
                  <span className={`cal2-ptag cal2-${c.t}`}>{c.t === 'batch' ? c.tag : c.t === 'order' ? 'Order due' : c.t === 'task' ? (c.check ? 'Check job' : 'Task') : 'Reminder'}</span>
                  <div className="cal2-prow-main">
                    <div className="cal2-prow-title">{c.time ? `${c.time} · ` : ''}{c.label}</div>
                    {c.t === 'task' && c.raw.assignee && <div className="cal2-prow-sub">{c.raw.assignee}</div>}
                    {c.t === 'batch' && (Array.isArray(c.raw.attendees) && c.raw.attendees.length > 0
                      ? <div className="cal2-prow-sub">{c.raw.attendees.join(', ')}</div>
                      : c.raw.assigned_to ? <div className="cal2-prow-sub">{c.raw.assigned_to}</div> : null)}
                  </div>
                  {c.t === 'batch' && (
                    <button type="button" className="cal2-rem-open" onClick={() => { setEditor({ batch: c.raw }); setPeekDay(null) }}>Edit</button>
                  )}
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
              <button type="button" className="cal2-addbtn" onClick={() => { setEditor({ date: peekDay }); setPeekDay(null) }}>+ Event this day</button>
              <button type="button" className="cal2-remindbtn" onClick={() => { setRemFor({ type: 'custom', eventDate: peekDay }); setPeekDay(null) }}>+ Reminder</button>
            </div>
          </div>
        </div>
      )}

      {editor && (
        <EventEditor seed={editor} me={me} staff={staff} onClose={() => setEditor(null)}
          onSaved={(msg) => { setEditor(null); reload(); showToast(msg || 'Saved.') }} />
      )}

      {remFor && (
        <ReminderComposer source={remFor} today={today} me={me} onClose={() => setRemFor(null)}
          onSaved={(n) => { setRemFor(null); reload(); showToast(`${n} reminder${n === 1 ? '' : 's'} set.`) }} />
      )}

      {focusPanel && (
        <FocusListPanel day={focusPanel.day} focusKey={focusPanel.focusKey}
          onClose={() => setFocusPanel(null)} onOpenOrder={onOpenOrder} />
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

const TONE_STYLE = {
  run:    { bg: '#1A1E24', fg: '#F3EBD8', edge: '#C7B575' },
  pickup: { bg: '#A05A12', fg: '#FFFFFF', edge: '#7c4610' },
  appt:   { bg: '#2E5FA3', fg: '#FFFFFF', edge: '#204175' },
  meet:   { bg: '#6B4FA0', fg: '#FFFFFF', edge: '#503a7a' },
}

// ── Event editor — create AND edit, one card (Paul: click to edit) ──────────
const EDITOR_TYPES = [
  { key: 'run', label: 'Run / Install', kind: 'setting' },
  { key: 'pickup', label: 'Pickup', kind: 'pickup' },
  { key: 'appt', label: 'Appointment', kind: 'appointment' },
  { key: 'meet', label: 'Meeting', kind: 'meeting' },
  { key: 'check', label: 'Check job', kind: null },
  { key: 'task', label: 'Task', kind: null },
]
const SWATCHES = ['#1D7A55', '#4C6B3C', '#2E5FA3', '#6B4FA0', '#A03D5E', '#A05A12', '#1A1E24']

function EventEditor({ seed, me, staff, onClose, onSaved }) {
  const editing = seed.batch || null
  const typeOfBatch = (b) => {
    if (!b) return 'appt'
    if (b.kind === 'pickup' || b.kind === 'errand') return 'pickup'
    if (b.kind === 'appointment' || b.kind === 'site_visit') return 'appt'
    if (b.kind === 'meeting') return 'meet'
    return 'run'
  }
  const [type, setType] = useState(() => typeOfBatch(editing))
  const [title, setTitle] = useState(editing?.title || '')
  const [day, setDay] = useState(editing ? String(editing.scheduled_date).slice(0, 10) : seed.date)
  const [endDay, setEndDay] = useState(editing?.end_date ? String(editing.end_date).slice(0, 10) : '')
  const [start, setStart] = useState(editing?.start_time || '')
  const [end, setEnd] = useState(editing?.end_time || '')
  const [who, setWho] = useState(() => new Set(
    editing ? (Array.isArray(editing.attendees) && editing.attendees.length ? editing.attendees : (editing.assigned_to ? [editing.assigned_to] : []))
      : (me ? [me] : [])))
  const [scope, setScope] = useState(editing?.calendar_scope || 'all')
  const [color, setColor] = useState(editing?.color || '')
  const [recur, setRecur] = useState(editing?.recur_rule || '')
  const [recurUntil, setRecurUntil] = useState(editing?.recur_until ? String(editing.recur_until).slice(0, 10) : '')
  const [notes, setNotes] = useState(editing?.notes || '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  // order attach — null: untouched, false: explicitly removed, object: new link
  const [linked, setLinked] = useState(null)
  const [linkQ, setLinkQ] = useState('')
  const [linkHits, setLinkHits] = useState([])
  useEffect(() => {
    const needle = linkQ.trim()
    if (needle.length < 2) { setLinkHits([]); return undefined }
    let cancelled = false
    const t = setTimeout(async () => {
      const rows = await searchOrdersLight(needle, 10).catch(() => [])
      if (!cancelled) setLinkHits(rows)
    }, 300)
    return () => { cancelled = true; clearTimeout(t) }
  }, [linkQ])

  const isTaskType = type === 'task' || type === 'check'
  const toggleWho = (n) => setWho(prev => { const s = new Set(prev); if (s.has(n)) s.delete(n); else s.add(n); return s })

  const save = async () => {
    const t = title.trim()
    if (!t || !day || busy) return
    setBusy(true); setErr(null)
    if (isTaskType) {
      const assignee = [...who][0] || me
      if (!assignee) { setErr('Pick who the task goes to.'); setBusy(false); return }
      const res = await addShopTask({
        title: t, assignee, assigneeKind: 'person',
        orderId: linked?.id || editing?.order_id || null,
        dueDate: day, createdBy: me, taskedBy: me,
        taskType: type === 'check' ? 'check_job' : 'general',
        details: start ? { time: start } : null,
      })
      setBusy(false)
      if (!res.ok) { setErr(res.error || 'Could not create the task.'); return }
      onSaved('Task created — it is on the task list too.')
      return
    }
    const kind = EDITOR_TYPES.find(x => x.key === type)?.kind || 'appointment'
    const fields = {
      title: t, scheduled_date: day,
      start_time: start || null, end_time: end || null,
      end_date: endDay || null,
      attendees: [...who],
      assigned_to: [...who][0] || null,
      calendar_scope: scope === 'personal' ? 'personal' : scope,
      owner_name: scope === 'personal' ? me : (editing?.owner_name || me),
      color: color || null,
      order_id: linked ? linked.id : (linked === false ? null : (editing?.order_id ?? null)),
      recur_rule: recur || null,
      recur_until: recur ? (recurUntil || null) : null,
      notes: notes.trim() || null,
    }
    let res
    if (editing) {
      res = await updateBatch(editing.id, { ...fields, kind })
    } else {
      res = await createBatch({ kind, ...fields, destination_cemetery_id: null, job_ids: [] })
    }
    setBusy(false)
    if (!res.ok) { setErr(res.error || 'Could not save.'); return }
    onSaved(editing ? 'Updated.' : 'On the calendar.')
  }

  const remove = async () => {
    if (!editing || busy) return
    setBusy(true)
    const res = await deleteBatch(editing.id)
    setBusy(false)
    if (!res.ok) { setErr(res.error || 'Could not delete.'); return }
    onSaved('Deleted.')
  }

  return (
    <div className="cal2-scrim" onClick={busy ? undefined : onClose}>
      <div className="cal2-panel" onClick={e => e.stopPropagation()}>
        <div className="cal2-panel-head">
          <div className="cal2-panel-title">{editing ? 'Edit event' : `New event — ${fmtLong(day)}`}</div>
          <button type="button" className="cal2-navbtn" onClick={onClose}>&#215;</button>
        </div>
        <div className="cal2-form" style={{ overflowY: 'auto' }}>
          <label><span>What</span>
            <input className="cal2-input" autoFocus placeholder="e.g. Meet the Kowalskis at the grave"
              value={title} onChange={e => setTitle(e.target.value)} />
          </label>

          <div>
            <div className="cal2-form-lab">Type</div>
            <div className="cal2-kindrow wrap">
              {EDITOR_TYPES.map(x => (
                <button key={x.key} type="button" disabled={!!editing && (x.key === 'task' || x.key === 'check')}
                  className={`cal2-kindchip${type === x.key ? ' on' : ''}`}
                  onClick={() => setType(x.key)}>{x.label}</button>
              ))}
            </div>
            {isTaskType && (
              <div className="cal2-firings" style={{ marginTop: 8 }}>
                {type === 'check' ? 'A check job lands in the Task Command Center as a check-job task — attach the order below.' : 'A task lands in the Task Command Center too, assigned to the first person picked, due this date.'}
              </div>
            )}
          </div>

          <div>
            <div className="cal2-form-lab">Attach an order or lead</div>
            {linked || (editing?.order_id && linked === null) ? (
              <div className="cal2-kindrow">
                <span className="cal2-kindchip on">
                  {linked
                    ? (properName(linked.primary_lastname || [linked.customer?.first_name, linked.customer?.last_name].filter(Boolean).join(' ') || '') || linked.order_number)
                    : 'Linked order'}
                </span>
                <button type="button" className="cal2-kindchip" onClick={() => setLinked(false)}>Remove</button>
              </div>
            ) : (
              <>
                <input className="cal2-input" placeholder="Family or order number…"
                  value={linkQ} onChange={e => setLinkQ(e.target.value)} />
                {linkHits.length > 0 && (
                  <div className="cal2-linkhits">
                    {linkHits.map(o => (
                      <button key={o.id} type="button" className="cal2-linkhit"
                        onClick={() => { setLinked(o); setLinkHits([]); setLinkQ('') }}>
                        <b>{properName(o.primary_lastname || '') || o.order_number}</b>
                        <span>{[o.order_number, o.cemetery?.name].filter(Boolean).join(' · ')}</span>
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>

          <div className="cal2-form3">
            <label><span>Date</span>
              <input type="date" className="cal2-input" value={day} onChange={e => setDay(e.target.value)} />
            </label>
            <label><span>Start</span>
              <select className="cal2-input" value={start} onChange={e => setStart(e.target.value)}>
                <option value="">All day</option>
                {TIME_OPTS.map(t => <option key={t} value={t}>{fmtTime(t)}</option>)}
              </select>
            </label>
            <label><span>End</span>
              <select className="cal2-input" value={end} onChange={e => setEnd(e.target.value)}>
                <option value="">—</option>
                {TIME_OPTS.map(t => <option key={t} value={t}>{fmtTime(t)}</option>)}
              </select>
            </label>
          </div>

          {!isTaskType && (
            <div className="cal2-form2">
              <label><span>Through (multi-day banner)</span>
                <input type="date" className="cal2-input" value={endDay} min={day} onChange={e => setEndDay(e.target.value)} />
              </label>
              <label><span>Repeats</span>
                <select className="cal2-input" value={recur} onChange={e => setRecur(e.target.value)}>
                  <option value="">Does not repeat</option>
                  <option value="daily">Every day</option>
                  <option value="weekdays">Every weekday</option>
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                </select>
              </label>
            </div>
          )}
          {recur && !isTaskType && (
            <label><span>Repeats until (optional)</span>
              <input type="date" className="cal2-input" value={recurUntil} min={day} onChange={e => setRecurUntil(e.target.value)} />
            </label>
          )}

          <div>
            <div className="cal2-form-lab">Who — pick as many as apply</div>
            <div className="cal2-kindrow wrap">
              {staff.map(n => (
                <button key={n} type="button" className={`cal2-kindchip${who.has(n) ? ' on' : ''}`}
                  onClick={() => toggleWho(n)}>{n}</button>
              ))}
            </div>
          </div>

          {!isTaskType && (
            <div className="cal2-form2">
              <label><span>Calendar</span>
                <select className="cal2-input" value={scope} onChange={e => setScope(e.target.value)}>
                  <option value="all">All</option>
                  <option value="admin_sales">Admin / Sales</option>
                  <option value="production">Production</option>
                  <option value="personal">Personal — just me</option>
                </select>
              </label>
              <div>
                <div className="cal2-form-lab">Banner color</div>
                <div className="cal2-swatches">
                  <button type="button" className={`cal2-sw-auto${!color ? ' on' : ''}`} onClick={() => setColor('')}>Auto</button>
                  {SWATCHES.map(c => (
                    <button key={c} type="button" className={`cal2-sw${color === c ? ' on' : ''}`}
                      style={{ background: c }} aria-label={c} onClick={() => setColor(c)} />
                  ))}
                </div>
              </div>
            </div>
          )}

          <label><span>Notes (optional)</span>
            <input className="cal2-input" placeholder="Address, gate code, what to bring…" value={notes} onChange={e => setNotes(e.target.value)} />
          </label>

          {err && <div className="cal2-err">{err}</div>}
          <button type="button" className="cal2-savebtn" onClick={save} disabled={busy || !title.trim() || !day}>
            {busy ? 'Saving…' : editing ? 'Save changes' : 'Put it on the calendar'}
          </button>
          {editing && (
            <button type="button" className="cal2-delbtn" onClick={remove} disabled={busy}>Delete this event</button>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Production day focus → the REAL work list, add/remove included ──────────
const FOCUS_LIST = {
  setting: { title: 'The set list', get: getInstallList, add: addToInstallList, remove: removeFromInstallList, msKey: ['installed', 'door_installed', 'work_completed'] },
  foundations: { title: 'The dig list', get: getFoundationList, add: addToFoundationList, remove: removeFromFoundationList, msKey: null },
  blasting: { title: 'The stencil & blast list', get: getStencilCutList, add: addToStencilCutList, remove: removeFromStencilCutList, msKey: null },
  inscriptions: { title: 'Active inscription work', get: null, add: null, remove: null, msKey: null },
}
const DEAD_ORDER = new Set(['closed', 'cancelled'])

function FocusListPanel({ day, focusKey, onClose, onOpenOrder }) {
  const cfg = FOCUS_LIST[focusKey]
  const focus = FOCUS_BY_KEY.get(focusKey)
  const [list, setList] = useState(null)
  const [jobs, setJobs] = useState(null)
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)

  const reload = async () => {
    const [l, j] = await Promise.all([
      cfg.get ? cfg.get().catch(() => []) : Promise.resolve(null),
      getJobs({}).catch(() => []),
    ])
    setList(l)
    setJobs(j || [])
  }
  useEffect(() => { reload() }, [focusKey])  // eslint-disable-line react-hooks/exhaustive-deps

  const memberIds = useMemo(() => new Set((list || []).map(r => r.job_id)), [list])
  const contracted = (j) => j.order && !j.order.archived && !DEAD_ORDER.has(j.order.status) && !!j.order.signed_at

  const rows = useMemo(() => {
    if (!jobs) return []
    if (focusKey === 'inscriptions') {
      return jobs.filter(j => j.job_type === 'inscription' && contracted(j))
    }
    return jobs.filter(j => memberIds.has(j.id) && j.order)
  }, [jobs, memberIds, focusKey])

  const candidates = useMemo(() => {
    if (!jobs || !cfg.add) return []
    const needle = q.trim().toLowerCase()
    if (needle.length < 2) return []
    return jobs.filter(j => {
      if (!contracted(j) || memberIds.has(j.id)) return false
      const hay = [famOf(j.order), j.order.order_number, j.order.cemetery?.name].filter(Boolean).join(' ').toLowerCase()
      return hay.includes(needle)
    }).slice(0, 12)
  }, [jobs, memberIds, q, cfg.add])

  const add = async (jobId) => {
    setBusy(true)
    await cfg.add(jobId)
    setBusy(false); setQ('')
    reload()
  }
  const remove = async (jobId) => {
    setBusy(true)
    await cfg.remove(jobId)
    setBusy(false)
    reload()
  }

  return (
    <div className="cal2-scrim" onClick={onClose}>
      <div className="cal2-panel" onClick={e => e.stopPropagation()}>
        <div className="cal2-panel-head">
          <div>
            <div className="cal2-panel-title">
              <span className="cal2-focusdot" style={{ background: focus?.color }} />
              {focus?.label} day — {fmtLong(day)}
            </div>
            <div className="cal2-panel-sub">{cfg.title}{cfg.add ? ' — add and remove orders right here' : ''}</div>
          </div>
          <button type="button" className="cal2-navbtn" onClick={onClose}>&#215;</button>
        </div>
        <div className="cal2-panel-body">
          {cfg.add && (
            <>
              <input className="cal2-input" placeholder="Add to the list — family, order number, cemetery…"
                value={q} onChange={e => setQ(e.target.value)} />
              {candidates.map(j => (
                <div key={j.id} className="cal2-prow">
                  <div className="cal2-prow-main">
                    <div className="cal2-prow-title">{famOf(j.order)}</div>
                    <div className="cal2-prow-sub">{[j.order.order_number, j.order.cemetery?.name].filter(Boolean).join(' · ')}</div>
                  </div>
                  <button type="button" className="cal2-remindbtn" disabled={busy} onClick={() => add(j.id)}>ADD</button>
                </div>
              ))}
              <div className="cal2-rems-uphead">On the list · {rows.length}</div>
            </>
          )}
          {(list === null && jobs === null) && <div className="cal2-rems-empty">Loading the list…</div>}
          {jobs !== null && rows.length === 0 && <div className="cal2-rems-empty">Nothing on this list yet.</div>}
          {rows.map(j => (
            <div key={j.id} className="cal2-prow">
              <div className="cal2-prow-main">
                <div className="cal2-prow-title">{famOf(j.order)}</div>
                <div className="cal2-prow-sub">{[j.order.order_number, j.order.cemetery?.name].filter(Boolean).join(' · ')}</div>
              </div>
              {onOpenOrder && (j.order_id || j.order?.id) && (
                <button type="button" className="cal2-rem-open" onClick={() => onOpenOrder(j.order_id || j.order.id)}>Open</button>
              )}
              {cfg.remove && (
                <button type="button" className="cal2-rem-x" disabled={busy} onClick={() => remove(j.id)}>Remove</button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Reminder composer (CAL-2, unchanged behavior) ───────────────────────────
function ReminderComposer({ source, today, me, onClose, onSaved }) {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picked, extraDates, eventDate])

  const save = async () => {
    const t = title.trim()
    if (!t) { setErr('Name the reminder.'); return }
    if (!firings.length) { setErr('Pick when to be reminded — an offset or an exact date.'); return }
    setBusy(true); setErr(null)
    const res = await addCalendarReminders(firings.map(d => ({
      title: t, remind_on: d, event_date: eventDate || null,
      source_type: isCustom ? 'custom' : source.type, source_id: source.id || null,
      note: note.trim() || null, created_by: me,
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
  .cal2-viewtog button { font: inherit; font-size: 12.5px; font-weight: 700; border: none; background: transparent; color: #7a756a; padding: 6px 14px; border-radius: 8px; cursor: pointer; white-space: nowrap; }
  .cal2-viewtog button.on { background: #fff; color: #0F1419; box-shadow: 0 1px 3px rgba(0,0,0,0.12); }
  .cal2-addbtn { font: inherit; font-size: 12.5px; font-weight: 700; padding: 8px 16px; border-radius: 10px; border: 1px solid #9A7209; background: #9A7209; color: #fff; cursor: pointer; }
  .cal2-addbtn:hover { background: #7d5d07; }

  .cal2-layers { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 10px; }
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

  .cal2-key { display: flex; align-items: center; gap: 11px; flex-wrap: wrap; background: #EFEBE1; border: 1px solid #E3DECE; border-radius: 12px; padding: 8px 14px; margin-bottom: 12px; }
  .cal2-key-lab { font-size: 10px; font-weight: 800; letter-spacing: 0.16em; color: #8a8472; }
  .cal2-key-chip { display: inline-flex; align-items: center; gap: 6px; font-size: 11px; font-weight: 700; color: #3a382f; }
  .cal2-key-chip i { width: 11px; height: 11px; border-radius: 3px; display: inline-block; box-sizing: border-box; }

  .cal2-card { background: #fff; border: 1px solid #E6E1D4; border-radius: 18px; overflow: hidden; box-shadow: 0 10px 34px rgba(15,20,25,0.06); }
  .cal2-dow { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); background: #0F1419; }
  .cal2-dow span { font-size: 10.5px; font-weight: 800; letter-spacing: 0.14em; text-transform: uppercase; color: #C7B575; padding: 10px 12px; min-width: 0; }
  .cal2-grid { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 1px; background: #E3DECE; border-top: 1px solid #E3DECE; }
  .cal2-cell { background: #fff; min-width: 0; overflow: hidden; min-height: 122px; padding: 7px 8px 9px; cursor: pointer; transition: background 0.12s; position: relative; }
  .cal2-cell:hover { background: #FBF9F3; }
  .cal2-cell.dim { background: #FAF8F2; }
  .cal2-cell.dim .cal2-daynum { color: #C6C0B0; }
  .cal2-cell.today { background: #FBF6E8; }
  .cal2-cell.today .cal2-daynum { background: #9A7209; color: #fff; }
  .cal2-cell.drop { background: #F3ECD8; box-shadow: inset 0 0 0 2px #9A7209; }
  .cal2-cell.wk { min-height: 300px; }
  .cal2-cell-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px; }
  .cal2-daynum { font-size: 12.5px; font-weight: 800; color: #4a463f; width: 24px; height: 24px; display: inline-flex; align-items: center; justify-content: center; border-radius: 8px; font-variant-numeric: tabular-nums; }
  .cal2-cell-add { font: inherit; width: 22px; height: 22px; border-radius: 7px; border: none; background: transparent; color: #C6C0B0; font-size: 15px; line-height: 1; cursor: pointer; opacity: 0; transition: opacity 0.12s; }
  .cal2-cell:hover .cal2-cell-add { opacity: 1; }
  .cal2-cell-add:hover { background: #9A7209; color: #fff; }
  .cal2-focusband { display: block; width: 100%; border: none; color: #fff; font: 800 9.5px/1 inherit; letter-spacing: 0.09em; border-radius: 6px; padding: 4px 6px; margin-bottom: 4px; cursor: pointer; text-align: left; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .cal2-focusband:hover { filter: brightness(1.12); }
  .cal2-chips { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
  .cal2-chip { font-size: 11px; font-weight: 700; border-radius: 6px; padding: 3px 7px; cursor: pointer; overflow: hidden; border-left: 3px solid transparent; max-width: 100%; min-width: 0; }
  .cal2-chip[draggable="true"] { cursor: grab; }
  .cal2-chip[draggable="true"]:active { cursor: grabbing; }
  .cal2-chip-txt { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .cal2-chip-time { font-weight: 800; opacity: 0.8; margin-right: 5px; font-variant-numeric: tabular-nums; }
  .cal2-chip-rpt { float: right; font-weight: 800; opacity: 0.75; margin-left: 4px; }
  .cal2-banner { border-radius: 4px; letter-spacing: 0.04em; }
  .cal2-task { background: #fff; color: #234C8A; border: 1.5px solid #234C8A; border-left-width: 3px; }
  .cal2-task.cal2-check { color: #1D7A55; border-color: #1D7A55; }
  .cal2-order { background: #FDECEB; color: #8f1d17; border-left-color: #B3261E; }
  .cal2-chip.cal2-rem { background: #fff; color: #6d5106; border: 1.5px solid #9A7209; border-left-width: 3px; }
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
  .cal2-panel { background: #fff; border-radius: 16px; width: min(600px, 96vw); max-height: 90vh; display: flex; flex-direction: column; box-shadow: 0 30px 80px rgba(0,0,0,0.35); overflow: hidden; }
  .cal2-panel-sm { width: min(480px, 96vw); }
  .cal2-panel-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 16px 18px 12px; }
  .cal2-panel-title { font-family: 'Fraunces', Georgia, serif; font-size: 19px; font-weight: 600; color: #0F1419; display: flex; align-items: center; gap: 9px; }
  .cal2-panel-sub { font-size: 12px; color: #8a8472; margin-top: 2px; }
  .cal2-panel-body { padding: 0 18px 12px; overflow-y: auto; }
  .cal2-panel-foot { display: flex; gap: 8px; padding: 12px 18px 16px; border-top: 1px solid #EFEBE0; }
  .cal2-focusrow { padding: 0 18px 10px; border-bottom: 1px solid #EFEBE0; margin-bottom: 4px; }
  .cal2-focusdot { width: 12px; height: 12px; border-radius: 4px; display: inline-block; }
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
  .cal2-form3 { display: grid; grid-template-columns: 1.2fr 0.9fr 0.9fr; gap: 10px; }
  .cal2-input { font: inherit; font-size: 14px; padding: 9px 12px; border: 1px solid #DCD6C8; border-radius: 10px; background: #fff; color: #16150F; width: 100%; }
  .cal2-input:focus { outline: none; border-color: #9A7209; box-shadow: 0 0 0 3px rgba(154,114,9,0.14); }
  .cal2-kindrow { display: flex; gap: 7px; }
  .cal2-kindrow.wrap { flex-wrap: wrap; }
  .cal2-kindchip { font: inherit; font-size: 12.5px; font-weight: 700; padding: 8px 14px; border-radius: 999px; border: 1px solid #DCD6C8; background: #fff; color: #6b6256; cursor: pointer; }
  .cal2-kindchip.on { background: #0F1419; border-color: #0F1419; color: #F3EBD8; }
  .cal2-kindchip.past { border-style: dashed; }
  .cal2-kindchip:disabled { opacity: 0.4; cursor: default; }
  .cal2-swatches { display: flex; gap: 7px; align-items: center; flex-wrap: wrap; }
  .cal2-sw { width: 26px; height: 26px; border-radius: 8px; border: 2px solid transparent; cursor: pointer; padding: 0; }
  .cal2-sw.on { border-color: #0F1419; box-shadow: 0 0 0 2px #fff inset; }
  .cal2-sw-auto { font: inherit; font-size: 11px; font-weight: 700; color: #6b6256; background: #fff; border: 1.5px dashed #DCD6C8; border-radius: 8px; padding: 5px 10px; cursor: pointer; }
  .cal2-sw-auto.on { border-color: #0F1419; color: #0F1419; }
  .cal2-linkhits { border: 1px solid #E6E1D4; border-radius: 10px; overflow: hidden; margin-top: 6px; }
  .cal2-linkhit { display: flex; flex-direction: column; gap: 1px; width: 100%; text-align: left; background: #fff; border: none; border-bottom: 1px solid #F3F0E8; padding: 9px 12px; font: inherit; cursor: pointer; }
  .cal2-linkhit:last-child { border-bottom: none; }
  .cal2-linkhit:hover { background: #FBF7EC; }
  .cal2-linkhit b { font-size: 13.5px; }
  .cal2-linkhit span { font-size: 11.5px; color: #8a8472; }
  .cal2-firings { font-size: 12.5px; font-weight: 700; color: #6d5106; background: #F7ECD4; border-radius: 10px; padding: 9px 12px; }
  .cal2-err { font-size: 12.5px; color: #B3261E; background: rgba(179,38,30,0.07); border-radius: 9px; padding: 8px 12px; }
  .cal2-savebtn { font: inherit; font-size: 14px; font-weight: 800; padding: 12px; border-radius: 11px; border: none; background: #9A7209; color: #fff; cursor: pointer; }
  .cal2-savebtn:hover:not(:disabled) { background: #7d5d07; }
  .cal2-savebtn:disabled { opacity: 0.5; cursor: default; }
  .cal2-delbtn { font: inherit; font-size: 12.5px; font-weight: 700; padding: 9px; border-radius: 10px; border: none; background: none; color: #B3261E; cursor: pointer; }

  .cal2-toast { position: fixed; bottom: 26px; left: 50%; transform: translateX(-50%); z-index: 1400; background: #0F1419; color: #F3EBD8; font-size: 13.5px; font-weight: 600; border-radius: 12px; padding: 12px 18px; display: flex; align-items: center; gap: 16px; box-shadow: 0 12px 34px rgba(0,0,0,0.4); }
  .cal2-toast button { font: inherit; font-size: 12px; font-weight: 800; letter-spacing: 0.06em; border: none; background: none; color: #E4C465; cursor: pointer; }

  @media (max-width: 860px) {
    .cal2 { padding: 16px 12px 60px; }
    .cal2-cell { min-height: 84px; padding: 5px 5px 7px; }
    .cal2-title { font-size: 26px; }
    .cal2-form3 { grid-template-columns: 1fr; }
  }
`
