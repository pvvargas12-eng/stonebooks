// =============================================================================
// InstallPlanner — build the week, sort it Mon–Fri, work the blockers
// (INSTALL-PLANNER-1/2/3, 2026-10-08) — now ONE planner for two tracks:
//   track="set"         the Install Planner (Installation page)
//   track="inscription" the Inscription Scheduler (Production floor)
// =============================================================================
// Paul: "like the line planner i need a pretty official and good way to build
// my installation schedule — add them all to an install list and then plan
// out which day." Round 2: "the 5-day week at the top; a Scheduled Installs
// view for my admin team to see what's happening AND ACTION THE BLOCKERS,
// ESPECIALLY BALANCES; click the cemetery name to hide the list, the number
// green when all scheduled; custom reminders (Need Base Insc, all St Gertrude
// bases need an insc) that don't block; a scheduled stone fades." Round 3:
// move the week forward, past days locked, not-done stones roll over.
// Inscriptions (same day): "we need an inscription scheduler just like the
// install scheduler, the blockers will be not paid, permit not approved, not
// cut — I want to see what's on the hot list in red."
//
// No new tables except install_reminders. The WEEK LIST is the Team Meeting's
// committed plan for that week (week_plan_items, lane 'set' / 'inscription').
// The DAYS are the Scheduler's batches of the track's kind ('setting' /
// 'inscription' — what the Scheduler, Calendar, field Today and the meeting's
// 5-day board show), one batch per cemetery per day (a trip). Putting a job on
// a day also stamps its completion milestone in_progress with that date. Gate
// edits write the same functions the Sales row writes. Dark .jobcc aesthetic.
// =============================================================================
import { useState, useEffect, useCallback } from 'react'
import {
  getInstallList, getBatches, createBatch, addJobsToBatch, removeJobFromBatch, updateBatch, getJobs,
  updateMilestoneWithOverride, installGates, rowBalanceDue, fmtUSD, logOrderActivity, getCurrentStaffName,
  setOrderFdnStatus, setOrderPermit, setOrderStoneStatus, setOrderDesignStatus, getJob, getHotListItems,
  deriveStoneStatus, stoneStatusOptions, FDN_STATUS, PERMIT_STATUS_OPTIONS, permitStatusLabel,
  addOrderTask, STAFF_NAMES, getActiveStaffUser, todayISO, manualBlockerChipText, listShopTasksForOrder,
} from '../lib/stonebooksData'
import { DEPARTMENTS } from '../lib/employees'
import { composeGraveLocation } from '../lib/monumentCatalog'
import {
  isoOf, mondayOf, addDays, listWeekPlans, kindFromPlans, nextInstallMonday,
  getWeekPlanWithItems, addPlanItem, removePlanItem, peekWeekPlan,
} from '../lib/meetingData'
import { listInstallReminders, remindersFor, addInstallReminder, doneInstallReminder } from '../lib/installReminders'

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']
const EMPTY_JOBS = []
const msBy = (job) => new Map((job?.milestones || []).map(m => [m.milestone_key, m]))
const installMilestone = (job) => { const by = msBy(job); return by.get('installed') || by.get('door_installed') || by.get('work_completed') || null }
// The inscription template's completion key is `inscription_completed`
// (`inscription_complete` is the FLOOR phase — a different vocabulary).
const inscriptionMilestone = (job) => { const by = msBy(job); return by.get('inscription_completed') || by.get('work_completed') || null }
const stencilCutDone = (job) => { const m = msBy(job).get('stencil_cut'); return !!m && (m.status === 'done' || m.status === 'not_needed') }
const famOf = (job) => job?.order?.primary_lastname || job?.customer?.last_name
  || [job?.customer?.first_name, job?.customer?.last_name].filter(Boolean).join(' ') || '—'
const cemOf = (job) => job?.order?.cemetery?.name || job?.cemetery?.name || ''
const cemIdOf = (job) => job?.cemetery?.id || job?.order?.cemetery?.id || job?.order?.cemetery_id || null
const fmtDay = (iso) => { const d = new Date(iso + 'T00:00:00'); return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) }
const readyNow = (g) => g && g.paid !== false && g.fdn !== false && g.permit !== false && g.blasted !== false
const readyInsc = (g) => g && g.paid !== false && g.permit !== false && g.cut !== false
// Track tag per job — same tones as the Installation cards.
const TRACK_OF = { new_stone: 'new_stone', bronze: 'bronze', inscription: 'inscription', mausoleum_door: 'door' }
const TRACK_TAG = { new_stone: ['NEW STONE', 'blue'], bronze: ['BRONZE SERVICES', 'purple'], inscription: ['INSCRIPTION', 'amber'], door: ['MAUSOLEUM DOOR', 'blue'] }
const trackOf = (job) => TRACK_OF[job?.job_type] || null
const trackTag = (job, sm = false) => { const t = TRACK_TAG[trackOf(job)]; return t ? <span className={`ip-track ip-track-${t[1]}${sm ? ' ip-track-sm' : ''}`}>{sm ? t[0].split(' ')[0] : t[0]}</span> : null }
// A bronze is never blasted — it ARRIVES.
const blastWord = (job, ok) => (trackOf(job) === 'bronze' ? (ok ? 'ARRIVED' : 'NOT ARRIVED') : (ok ? 'BLASTED' : 'NOT BLASTED'))
// Orders an inscription job can be planned from — contracted and open.
const REAL_STATUSES = new Set(['contracted', 'in_production', 'paid_in_full'])

// ── The two tracks ───────────────────────────────────────────────────────────
const TRACKS = {
  set: {
    key: 'set', lane: 'set', batchKind: 'setting',
    title: 'Install Planner', back: '← Installation', openAction: 'installation', activityField: 'Install',
    modeBuild: 'Build the week', modeSched: 'Scheduled installs', schedTitle: 'Scheduled installs',
    purposeBuild: 'Build the week\'s list from the set list, then put each stone on a day. Days become Scheduler trips (one per cemetery per day) and the Team Meeting\'s set lane reads the same list.',
    purposeSched: 'Everything on a day this week with its blockers — clear them here: record the balance, task a call, flip foundation / permit / arrival, tick reminders.',
    thing: 'stone', things: 'stones', notDone: 'not installed', verb: 'install', readyLabel: 'READY TO INSTALL',
    addBtn: '+ Add from set list', poolHint: 'on the set list not on this week', emptyAdd: 'Add stones from the set list — ready ones first — then give each a day above.', emptyPool: 'Everything on the set list is already on this week.',
    foot: 'Days are Scheduler trips — reorder stops, assign a crew or set AM/PM in the Scheduler. The Team Meeting\'s set lane and Friday score read this week list.',
    milestone: installMilestone, scheduledKey: null,
    gates: (job) => installGates(job?.order || {}, job),
    ready: readyNow,
    tripClass: '',
  },
  inscription: {
    key: 'inscription', lane: 'inscription', batchKind: 'inscription',
    title: 'Inscription Scheduler', back: '← Production floor', openAction: 'production', activityField: 'Inscription',
    modeBuild: 'Build the week', modeSched: 'Scheduled inscriptions', schedTitle: 'Scheduled inscriptions',
    purposeBuild: 'Pick the inscriptions for the week, then put each on a day. Days become Scheduler inscription trips (one per cemetery per day) and the Team Meeting\'s inscription lane reads the same list. HOT = on the hot list.',
    purposeSched: 'Every inscription on a day this week with its blockers — record the balance, task a call, flip the permit, mark the stencil cut, tick reminders.',
    thing: 'inscription', things: 'inscriptions', notDone: 'not completed', verb: 'inscription', readyLabel: 'READY TO INSCRIBE',
    addBtn: '+ Add an inscription', poolHint: 'open inscriptions not on this week', emptyAdd: 'Add inscriptions — ready ones first, hot ones in red — then give each a day above.', emptyPool: 'Every open inscription is already on this week.',
    foot: 'Days are Scheduler inscription trips — reorder stops, assign a crew or set AM/PM in the Scheduler. The Team Meeting\'s inscription lane and Friday score read this week list.',
    milestone: inscriptionMilestone, scheduledKey: 'field_work_scheduled',
    gates: (job) => { const g = installGates(job?.order || {}, job); return { paid: g.paid, permit: g.permit, cut: stencilCutDone(job) } },
    ready: readyInsc,
    tripClass: ' ip-trip-insc',
  },
}

function gateChips(job, cfg) {
  const g = cfg.gates(job)
  const bal = rowBalanceDue(job?.order || {})
  return (
    <span className="ip-gates">
      <span className={`ip-g ${g.paid ? 'ok' : 'red'}`}>{g.paid ? 'PAID' : bal > 0 ? `BAL ${fmtUSD(bal)}` : 'NOT PAID'}</span>
      {cfg.key === 'set' && (g.fdn === null ? <span className="ip-g na">NO FDN</span> : <span className={`ip-g ${g.fdn ? 'ok' : 'red'}`}>{g.fdnCode === 'drop_off' ? 'DROP OFF' : g.fdn ? 'FDN IN' : 'FDN NOT IN'}</span>)}
      {g.permit === null ? <span className="ip-g na">NO PERMIT</span> : <span className={`ip-g ${g.permit ? 'ok' : 'red'}`}>{g.permit ? 'PERMIT OK' : 'PERMIT'}</span>}
      {cfg.key === 'set' && <span className={`ip-g ${g.blasted ? 'ok' : 'red'}`}>{blastWord(job, g.blasted)}</span>}
      {cfg.key === 'inscription' && <span className={`ip-g ${g.cut ? 'ok' : 'red'}`}>{g.cut ? 'CUT' : 'NOT CUT'}</span>}
    </span>
  )
}

// A gate pill that IS a dropdown (the Installation card pattern).
function GateSelect({ tone, label, value, options, onChange, disabled, title }) {
  return (
    <label className={`ip-g ip-gsel ${tone}`} title={title || 'Change the status'}>
      <span>{label} <span className="ip-caret" aria-hidden="true">▾</span></span>
      <select value={value || ''} disabled={disabled} onChange={e => onChange(e.target.value)} aria-label={title || label}>
        {!options.some(o => o.code === value) && <option value="">—</option>}
        {options.map(o => <option key={o.code} value={o.code}>{o.label}</option>)}
      </select>
    </label>
  )
}

// Reminder chips (amber, never gating) with a tick to close them.
function ReminderChips({ list, busy, onDone }) {
  if (!list.length) return null
  return (
    <span className="ip-rems">
      {list.map(r => (
        <span key={r.id} className={`ip-rem${r.cemetery_id ? ' ip-rem-cem' : ''}`} title={r.cemetery_id ? 'Cemetery reminder — every job there' : `Reminder · ${r.created_by || ''}`}>
          {r.text}
          <button type="button" disabled={busy} title="Done — clear this reminder" onClick={() => onDone(r)}>✓</button>
        </span>
      ))}
    </span>
  )
}

// The hot-list tag (Paul: "what's on the hot list in red so we know it's hot").
const HotTag = ({ on }) => (on ? <span className="ip-hot" title="On the hot list">HOT</span> : null)

export default function InstallPlanner({ jobs: jobsProp = null, track = 'set', onBack, onOpenOrderDetail, initialMode = 'build' }) {
  const cfg = TRACKS[track] || TRACKS.set
  const [week, setWeek] = useState(null)        // Monday ISO
  const [plans, setPlans] = useState([])
  const [plan, setPlan] = useState(null)        // { plan, items }
  const [batches, setBatches] = useState([])
  const [setList, setSetList] = useState(null)
  const [ownJobs, setOwnJobs] = useState(null)  // loaded here when the parent passes none (the floor)
  const [hot, setHot] = useState(() => new Set())   // job ids + order ids on the open hot list
  const [rems, setRems] = useState({ byJob: new Map(), byCemetery: new Map() })
  const [overrides, setOverrides] = useState(() => new Map())   // job id → re-read job after a gate pick
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [mode, setMode] = useState(initialMode)  // 'build' | 'scheduled'
  // Scheduled blocker tabs (Paul: "a tab that says balance required then I
  // can task and have my office personnel get those balances").
  const [blockerTab, setBlockerTab] = useState('all')
  const [bulkWho, setBulkWho] = useState('')
  const [bulkMsg, setBulkMsg] = useState(null)
  const [addOpen, setAddOpen] = useState(false)
  const [addQ, setAddQ] = useState('')
  const [collapsed, setCollapsed] = useState(() => new Set())   // cemetery names folded
  const [remFor, setRemFor] = useState(null)    // { jobId } | { cemeteryId, name } — the inline reminder input
  const [remText, setRemText] = useState('')
  const [taskFor, setTaskFor] = useState(null)  // job id with the task-a-call strip open
  const [taskWho, setTaskWho] = useState('')
  const [taskNote, setTaskNote] = useState('')
  const [taskDone, setTaskDone] = useState(false)
  // Carryover (Paul 2026-10-08: "stones that DO NOT GET MARKED AS INSTALLED
  // MUST GET ROLLED BACK INTO THE QUEUE FOR THE NEXT WEEK"): once a week has
  // ended, its not-done items roll into the next week's list on load.
  // `rolled` = what this load rolled in, shown as a strip.
  const [rolled, setRolled] = useState([])
  const [pastBatches, setPastBatches] = useState([])   // older batches of this kind (for cleanup on place)
  const [todayIso] = useState(() => todayISO())

  const jobs = jobsProp || ownJobs || EMPTY_JOBS   // stable while loading — `load` depends on it
  const jobById = new Map(jobs.map(j => [j.id, overrides.get(j.id) || j]))
  const isHot = (job) => !!job && (hot.has(job.id) || (job.order?.id ? hot.has(job.order.id) : false))
  const isDone = (job) => cfg.milestone(job)?.status === 'done'

  // Default week = the next install week (this week if it is one).
  useEffect(() => {
    let alive = true
    nextInstallMonday().then(w => { if (alive) setWeek(w) }).catch(() => { if (alive) setWeek(isoOf(mondayOf())) })
    return () => { alive = false }
  }, [])
  // The floor mounts this without a jobs prop — load the shop's open jobs once.
  useEffect(() => {
    if (jobsProp) return undefined
    let alive = true
    getJobs({ limit: 2000 }).then(rows => { if (alive) setOwnJobs(rows || []) }).catch(() => { if (alive) setOwnJobs([]) })
    return () => { alive = false }
  }, [jobsProp])

  const load = useCallback(async () => {
    if (!week) return
    const [ps, p0, bs, old, sl, hotRows] = await Promise.all([
      listWeekPlans(),
      getWeekPlanWithItems(week),
      getBatches({ from: week, to: addDays(week, 6), kind: cfg.batchKind }).catch(() => []),
      getBatches({ from: addDays(week, -28), to: addDays(week, -1), kind: cfg.batchKind }).catch(() => []),
      cfg.key === 'set' ? getInstallList().catch(() => []) : Promise.resolve([]),
      getHotListItems().catch(() => []),
    ])
    let p = p0
    // ── Auto-roll: finished weeks' not-done jobs → this week's list ──
    // A week is finished once its Friday is behind today. Jobs from those
    // weeks still not done, and not already on this week, are added to this
    // week's plan (the old item stays for Friday scoring).
    const rolledNow = []
    const weekFinished = addDays(week, 4) < todayIso   // its Friday is behind us
    if (p.ok && !weekFinished) {   // nothing rolls INTO a finished week
      const already = new Set((p.items || []).filter(it => it.lane === cfg.lane && it.job_id).map(it => it.job_id))
      const pastWeeks = (ps || []).filter(w => w.week_start < week && addDays(w.week_start, 4) < todayIso).slice(-4)
      const jobsById = new Map(jobs.map(j => [j.id, j]))
      for (const w of pastWeeks) {
        const r = await peekWeekPlan(w.week_start).catch(() => null)
        for (const it of (r?.items || [])) {
          if (it.lane !== cfg.lane || !it.job_id || already.has(it.job_id) || it.outcome === 'dropped') continue
          const job = jobsById.get(it.job_id)
          if (!job || cfg.milestone(job)?.status === 'done') continue
          const a = await addPlanItem({ planId: p.plan.id, lane: cfg.lane, jobId: it.job_id, orderId: it.order_id || null, title: it.title || famOf(job) })
          if (a.ok) { already.add(it.job_id); rolledNow.push({ jobId: it.job_id, from: w.week_start }) }
        }
      }
      if (rolledNow.length) { const again = await getWeekPlanWithItems(week); if (again.ok) p = again }
    }
    setRolled(rolledNow)
    setPlans(ps)
    if (p.ok) { setPlan(p); setErr(null) } else setErr(p.error)
    setBatches(bs || [])
    setPastBatches(old || [])
    setSetList(sl || [])
    setHot(new Set((hotRows || []).flatMap(h => [h.job_id, h.order_id]).filter(Boolean)))
    // Reminders for every job that can appear here + their cemeteries.
    const poolIds = cfg.key === 'set' ? (sl || []).map(r => r.job_id) : jobs.filter(j => j.job_type === 'inscription').map(j => j.id)
    const ids = new Set([...poolIds, ...((p.items || []).map(it => it.job_id)), ...(bs || []).flatMap(b => (b.batch_jobs || []).map(l => l.job_id))].filter(Boolean))
    const cems = new Set([...ids].map(id => cemIdOf(jobs.find(j => j.id === id))).filter(Boolean))
    setRems(await listInstallReminders({ jobIds: [...ids], cemeteryIds: [...cems] }).catch(() => ({ byJob: new Map(), byCemetery: new Map() })))
  }, [week, jobs, todayIso, cfg])
  useEffect(() => { load() }, [load])  // eslint-disable-line react-hooks/set-state-in-effect

  const run = async (fn) => {
    if (busy) return
    setBusy(true); setErr(null)
    const r = await fn()
    setBusy(false)
    if (r && r.ok === false) { setErr(r.error || 'Action failed'); return }
    load()
  }

  const kind = week ? kindFromPlans(week, plans) : 'install'
  const weekItems = (plan?.items || []).filter(it => it.lane === cfg.lane && it.job_id)
  const onWeek = new Set(weekItems.map(it => it.job_id))
  const dayOfJob = new Map()
  const batchOfJob = new Map()
  for (const b of batches) for (const l of (b.batch_jobs || [])) { dayOfJob.set(l.job_id, b.scheduled_date); batchOfJob.set(l.job_id, b) }
  const days = DAYS.map((label, i) => {
    const iso = addDays(week || isoOf(mondayOf()), i)
    const dayBatches = batches.filter(b => b.scheduled_date === iso)
    return { label, iso, batches: dayBatches, count: dayBatches.reduce((s, b) => s + (b.batch_jobs || []).length, 0) }
  })
  const unplaced = weekItems.filter(it => !dayOfJob.has(it.job_id))
  const remsOf = (job) => remindersFor(job, rems)
  const gatesOf = (job) => cfg.gates(job)
  const ready = (job) => cfg.ready(gatesOf(job))

  // ── Week list ───────────────────────────────────────────────────────────
  const addToWeek = (job) => run(() => addPlanItem({ planId: plan.plan.id, lane: cfg.lane, jobId: job.id, orderId: job.order?.id || null, title: famOf(job) }))
  const addAllReady = () => run(async () => {
    for (const j of addCandidates.filter(ready)) {
      const r = await addPlanItem({ planId: plan.plan.id, lane: cfg.lane, jobId: j.id, orderId: j.order?.id || null, title: famOf(j) })
      if (!r.ok) return r
    }
    return { ok: true }
  })
  const removeFromWeek = (it) => run(async () => {
    const b = batchOfJob.get(it.job_id)
    if (b) await removeJobFromBatch(b.id, it.job_id)
    return removePlanItem(it.id)
  })

  // ── Days — one trip per cemetery per day; milestone stamped with the day ──
  const placeOnDay = (jobId, iso) => run(async () => {
    if (iso < todayIso) return { ok: false, error: `${fmtDay(iso)} has already passed — pick today or later.` }
    const job = jobById.get(jobId)
    if (!job) return { ok: false, error: 'Job not loaded' }
    const cemId = cemIdOf(job)
    if (!cemId) return { ok: false, error: `${famOf(job)} has no cemetery linked — link one on the order first.` }
    const prev = batchOfJob.get(jobId)
    if (prev) { const r = await removeJobFromBatch(prev.id, jobId); if (!r.ok) return r }
    // A rolled-over job may still sit on an OLD week's trip (the Scheduler
    // shows it as overdue) — placing it on a real day clears that too.
    for (const b of pastBatches) {
      if ((b.batch_jobs || []).some(l => l.job_id === jobId && !l.completed_at)) await removeJobFromBatch(b.id, jobId).catch(() => {})
    }
    const existing = batches.find(b => b.scheduled_date === iso && b.destination_cemetery_id === cemId && b.id !== prev?.id)
    let r
    if (existing) r = await addJobsToBatch(existing.id, [{ job_id: jobId }])
    else r = await createBatch({ kind: cfg.batchKind, scheduled_date: iso, title: cemOf(job) || famOf(job), destination_cemetery_id: cemId, job_ids: [jobId] })
    if (!r.ok) return r
    const ms = cfg.milestone(job)
    if (ms) await updateMilestoneWithOverride(jobId, ms.milestone_key, { status: 'in_progress', dueDate: iso }, `Scheduled from the ${cfg.title}`).catch(() => {})
    if (cfg.scheduledKey && msBy(job).has(cfg.scheduledKey)) await updateMilestoneWithOverride(jobId, cfg.scheduledKey, { status: 'done', dueDate: iso }, `Scheduled from the ${cfg.title}`).catch(() => {})
    const actor = await getCurrentStaffName().catch(() => null)
    if (job.order?.id) logOrderActivity(job.order.id, { type: 'change', field: cfg.activityField, newValue: 'Scheduled', note: `${cfg.activityField} planned for ${iso} (${cfg.title})`, actor }).catch(() => {})
    return { ok: true }
  })
  const unplace = (jobId) => run(async () => {
    const b = batchOfJob.get(jobId)
    if (b) { const r = await removeJobFromBatch(b.id, jobId); if (!r.ok) return r }
    const job = jobById.get(jobId)
    const ms = cfg.milestone(job)
    if (ms && ms.status === 'in_progress') await updateMilestoneWithOverride(jobId, ms.milestone_key, { status: 'not_started', dueDate: null }, `Unscheduled from the ${cfg.title}`).catch(() => {})
    if (cfg.scheduledKey && msBy(job).get(cfg.scheduledKey)?.status === 'done') await updateMilestoneWithOverride(jobId, cfg.scheduledKey, { status: 'not_started', dueDate: null }, `Unscheduled from the ${cfg.title}`).catch(() => {})
    return { ok: true }
  })

  // ── Move the whole week forward (Paul 2026-10-08: "this week I built is
  // not for this week but for next week") — plan items go to next week's
  // plan, every trip slides +7 days (same weekday), dates follow. Then the
  // planner lands on next week.
  const moveWeekForward = () => run(async () => {
    const next = addDays(week, 7)
    const n = weekItems.length, t = batches.length
    if (!n && !t) return { ok: false, error: 'Nothing on this week to move.' }
    if (!window.confirm(`Move this week's ${n} ${n === 1 ? cfg.thing : cfg.things} and ${t} trip${t === 1 ? '' : 's'} to the week of ${fmtDay(next)}? Days keep their weekday (Mon → Mon).`)) return { ok: true }
    const np = await getWeekPlanWithItems(next)
    if (!np.ok) return np
    const onNext = new Set((np.items || []).filter(it => it.lane === cfg.lane).map(it => it.job_id))
    for (const it of weekItems) {
      if (!onNext.has(it.job_id)) {
        const a = await addPlanItem({ planId: np.plan.id, lane: cfg.lane, jobId: it.job_id, orderId: it.order_id || null, title: it.title || null })
        if (!a.ok) return a
      }
      await removePlanItem(it.id)
    }
    for (const b of batches) {
      const to = addDays(b.scheduled_date, 7)
      const u = await updateBatch(b.id, { scheduled_date: to })
      if (!u.ok) return u
      for (const l of (b.batch_jobs || [])) {
        const job = jobById.get(l.job_id)
        const ms = cfg.milestone(job)
        if (ms && ms.status === 'in_progress') await updateMilestoneWithOverride(l.job_id, ms.milestone_key, { status: 'in_progress', dueDate: to }, `Week moved forward in the ${cfg.title}`).catch(() => {})
      }
    }
    setWeek(next)
    return { ok: true }
  })

  // ── Blockers — the same writes as the Sales row, then re-read the job ────
  const changeGate = (job, dim, code) => run(async () => {
    if (!code) return { ok: true }
    let r = { ok: true }
    if (dim === 'fdn') r = await setOrderFdnStatus(job.id, code)
    else if (dim === 'stone') r = await setOrderStoneStatus(job.id, code)
    else if (dim === 'cut') r = await setOrderDesignStatus(job.id, 'cut')   // flips stencil_created + stencil_cut done, lands the floor piece at Stencil Cut
    else if (dim === 'permit' && job.order?.id) {
      const today = todayISO()
      const patch = { permit_status: code }
      if (code === 'submitted') patch.permit_filed_at = today
      if (code === 'approved') patch.permit_approved_at = today
      r = await setOrderPermit(job.order.id, patch)
      if (r?.ok) logOrderActivity(job.order.id, { type: 'change', field: 'Permit status', oldValue: permitStatusLabel(job.order.permit_status || 'unknown'), newValue: permitStatusLabel(code), note: `Permit status changed from the ${cfg.title}`, actor: await getCurrentStaffName().catch(() => null) }).catch(() => {})
    }
    if (r?.ok === false) return r
    const fresh = await getJob(job.id).catch(() => null)
    if (fresh) setOverrides(m => new Map(m).set(job.id, fresh))
    return { ok: true }
  })
  const openTasker = (job) => {
    const bal = rowBalanceDue(job.order || {})
    setTaskWho(getActiveStaffUser() || 'Admin')
    setTaskNote(`Call ${famOf(job)} — ${bal > 0 ? `balance ${fmtUSD(bal)}` : cfg.verb}${job.order?.order_number ? ` (${job.order.order_number})` : ''}`)
    setTaskDone(false); setTaskFor(job.id)
  }
  const sendTask = (job) => run(async () => {
    if (!job.order?.id || !taskNote.trim()) return { ok: false, error: 'Type the task.' }
    const actor = await getCurrentStaffName().catch(() => null)
    const r = await addOrderTask(job.order.id, { note: taskNote.trim(), assignee: taskWho, assigneeKind: DEPARTMENTS.includes(taskWho) ? 'department' : 'person', dueDate: todayISO(), actor })
    if (r?.ok === false) return r
    setTaskDone(true)
    setTimeout(() => { setTaskFor(null); setTaskDone(false) }, 1800)
    return { ok: true }
  })

  // ── Reminders ───────────────────────────────────────────────────────────
  const saveReminder = () => run(async () => {
    if (!remFor) return { ok: true }
    const r = await addInstallReminder({ jobId: remFor.jobId || null, cemeteryId: remFor.cemeteryId || null, text: remText })
    if (r.ok) { setRemFor(null); setRemText('') }
    return r
  })
  const remDone = (r) => run(() => doneInstallReminder(r.id, true))

  // ── Add picker: the track's pool, ready first, hot first within ready ────
  const pool = cfg.key === 'set'
    ? (setList || []).map(m => jobById.get(m.job_id)).filter(Boolean)
    : jobs.filter(j => j.job_type === 'inscription' && j.order && !j.order.archived && REAL_STATUSES.has(j.order.status) && !['closed', 'cancelled'].includes(j.overall_status))
  const addCandidates = pool
    .filter(j => !onWeek.has(j.id) && !isDone(j))
    .filter(j => { const t = addQ.trim().toLowerCase(); return !t || [famOf(j), cemOf(j), j.order?.order_number].filter(Boolean).join(' ').toLowerCase().includes(t) })
    .sort((a, b) => (ready(b) ? 1 : 0) - (ready(a) ? 1 : 0) || (isHot(b) ? 1 : 0) - (isHot(a) ? 1 : 0) || cemOf(a).localeCompare(cemOf(b)))
  const readyCount = addCandidates.filter(ready).length

  const groupByCem = (items) => {
    const m = new Map()
    for (const it of items) { const job = jobById.get(it.job_id); const k = cemOf(job) || '—'; if (!m.has(k)) m.set(k, { id: cemIdOf(job), items: [] }); m.get(k).items.push(it) }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }
  const toggleCem = (name) => setCollapsed(s => { const n = new Set(s); if (n.has(name)) n.delete(name); else n.add(name); return n })

  const reminderInput = (target) => (
    <span className="ip-reminput">
      <input autoFocus placeholder={target.cemeteryId ? `Reminder for every job at ${target.name}` : 'Reminder — e.g. Need base insc'} value={remText}
        onChange={e => setRemText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') saveReminder(); if (e.key === 'Escape') setRemFor(null) }} />
      <button type="button" className="ib-act ib-act-go" disabled={busy || !remText.trim()} onClick={saveReminder}>Save</button>
      <button type="button" className="ib-act" onClick={() => { setRemFor(null); setRemText('') }}>×</button>
    </span>
  )

  const renderJobRow = (jobId, { onWeekRow = null } = {}) => {
    const job = jobById.get(jobId)
    if (!job) return <div key={jobId} className="ip-row"><span className="ip-fam">(job not loaded)</span></div>
    const day = dayOfJob.get(jobId)
    const list = remsOf(job)
    return (
      <div key={jobId} className={`ip-row${ready(job) ? ' ip-row-ready' : ''}${day ? ' ip-row-sched' : ''}${isHot(job) ? ' ip-row-hot' : ''}`}>
        <button type="button" className="ip-fam ip-fam-btn" onClick={() => job.order?.id && onOpenOrderDetail?.(job.order.id, cfg.openAction)}>{famOf(job)}</button>
        <HotTag on={isHot(job)} />
        {trackTag(job)}
        <span className="ip-meta">{[job.order?.order_number, composeGraveLocation(job.order || {})].filter(Boolean).join(' · ')}</span>
        {gateChips(job, cfg)}
        <ReminderChips list={list} busy={busy} onDone={remDone} />
        {remFor?.jobId === jobId ? reminderInput(remFor) : (
          <button type="button" className="ip-remadd" title={`Add a reminder for this ${cfg.thing}`} onClick={() => { setRemFor({ jobId }); setRemText('') }}>+ reminder</button>
        )}
        <span className="ip-days">
          {days.map(d => {
            const past = d.iso < todayIso && day !== d.iso
            return (
              <button type="button" key={d.iso} className={`ip-day${day === d.iso ? ' on' : ''}${past ? ' past' : ''}`} disabled={busy || past}
                title={past ? `${d.label} ${fmtDay(d.iso)} has passed` : `${d.label} ${fmtDay(d.iso)}`}
                onClick={() => (day === d.iso ? unplace(jobId) : placeOnDay(jobId, d.iso))}>{d.label[0]}</button>
            )
          })}
        </span>
        {onWeekRow && <button type="button" className="ib-act ib-act-x" disabled={busy} title="Take off this week's list" onClick={() => removeFromWeek(onWeekRow)}>×</button>}
      </div>
    )
  }

  // The 5-day week — at the TOP (Paul round 2).
  const renderWeek = () => (
    <section className="ip-week">
      {days.map(d => (
        <div key={d.iso} className={`ip-daycol${d.count ? ' has' : ''}`}>
          <div className="ip-daycol-h"><span>{d.label}</span><span className="ip-daycol-date">{fmtDay(d.iso)}</span><span className="ip-n">{d.count}</span></div>
          {d.batches.length === 0 && <div className="ip-daycol-empty">—</div>}
          {d.batches.map(b => (
            <div key={b.id} className={`ip-trip${cfg.tripClass}`}>
              <div className="ip-trip-h">{b.cemetery?.name || b.title || 'Trip'}{b.am_pm ? ` · ${b.am_pm}` : ''}</div>
              {(b.batch_jobs || []).slice().sort((x, y) => (x.stop_order || 0) - (y.stop_order || 0)).map(l => {
                const job = jobById.get(l.job_id)
                const ok = job && ready(job)
                return (
                  <div key={l.job_id} className="ip-stop">
                    <span className="ip-stop-n">{l.stop_order || ''}</span>
                    <button type="button" className="ip-fam ip-fam-btn" onClick={() => job?.order?.id && onOpenOrderDetail?.(job.order.id, cfg.openAction)}>{job ? famOf(job) : '(job)'}</button>
                    <HotTag on={isHot(job)} />
                    {trackTag(job, true)}
                    {job && <span className={`ip-g ${ok ? 'ok' : 'red'}`}>{ok ? 'READY' : 'GATE'}</span>}
                    {job && remsOf(job).length > 0 && <span className="ip-g rem" title={remsOf(job).map(r => r.text).join(' · ')}>{remsOf(job).length} REM</span>}
                    <button type="button" className="ip-x" disabled={busy} title="Take off this day" onClick={() => unplace(l.job_id)}>×</button>
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      ))}
    </section>
  )

  // SCHEDULED — the admin view: every job on a day this week, its blockers,
  // and the actions that clear them (balance first).
  const renderScheduled = () => {
    const rows = days.flatMap(d => d.batches.flatMap(b => (b.batch_jobs || []).slice().sort((x, y) => (x.stop_order || 0) - (y.stop_order || 0)).map(l => ({ day: d, batch: b, job: jobById.get(l.job_id), stop: l }))))
    const owed = rows.reduce((s, r) => s + (r.job ? Math.max(0, rowBalanceDue(r.job.order || {})) : 0), 0)
    // Per-job blocker flags — the tabs slice on these.
    const flagged = rows.map(r => {
      if (!r.job) return { ...r, flags: {} }
      const g = gatesOf(r.job)
      const bal = rowBalanceDue(r.job.order || {})
      return { ...r, flags: {
        balance: g.paid === false && bal > 0, fdn: g.fdn === false, permit: g.permit === false, arrival: g.blasted === false, cut: g.cut === false,
        hot: isHot(r.job), reminders: remsOf(r.job).length > 0, ready: cfg.ready(g),
      } }
    })
    const blocked = flagged.filter(r => r.job && !r.flags.ready).length
    const TABS = [
      ['all', 'All', flagged.length],
      ['balance', 'Balance required', flagged.filter(r => r.flags.balance).length],
      ...(cfg.key === 'set' ? [['fdn', 'Foundation', flagged.filter(r => r.flags.fdn).length]] : []),
      ['permit', 'Permit', flagged.filter(r => r.flags.permit).length],
      ...(cfg.key === 'set'
        ? [['arrival', 'Not arrived / blasted', flagged.filter(r => r.flags.arrival).length]]
        : [['cut', 'Not cut', flagged.filter(r => r.flags.cut).length], ['hot', 'Hot list', flagged.filter(r => r.flags.hot).length]]),
      ['reminders', 'Reminders', flagged.filter(r => r.flags.reminders).length],
      ['ready', 'Ready', flagged.filter(r => r.flags.ready).length],
    ]
    const shownRows = blockerTab === 'all' ? flagged : flagged.filter(r => r.flags[blockerTab])
    const balanceTargets = flagged.filter(r => r.flags.balance && r.job?.order?.id)
    // One click: a call task per unpaid job to the chosen person. Jobs that
    // already carry an open "Call …" task are skipped, so a second click
    // can't double-task the office.
    const taskAllBalances = () => run(async () => {
      const who = bulkWho || getActiveStaffUser() || 'Admin'
      if (!balanceTargets.length) return { ok: true }
      if (!window.confirm(`Task ${who} to call ${balanceTargets.length} famil${balanceTargets.length === 1 ? 'y' : 'ies'} about this week's balances? ${cfg.things[0].toUpperCase() + cfg.things.slice(1)} that already have an open call task are skipped.`)) return { ok: true }
      const actor = await getCurrentStaffName().catch(() => null)
      let made = 0, skipped = 0
      for (const r of balanceTargets) {
        const existing = await listShopTasksForOrder(r.job.order.id).catch(() => [])
        if (existing.some(t => ['open', 'pending'].includes(t.status) && /^call\b/i.test(t.title || ''))) { skipped++; continue }
        const bal = rowBalanceDue(r.job.order)
        const res = await addOrderTask(r.job.order.id, {
          note: `Call ${famOf(r.job)} — balance ${fmtUSD(bal)} due before the ${cfg.verb} ${r.day.label} ${fmtDay(r.day.iso)}${r.job.order.order_number ? ` (${r.job.order.order_number})` : ''}`,
          assignee: who, assigneeKind: DEPARTMENTS.includes(who) ? 'department' : 'person', dueDate: todayISO(), actor,
        })
        if (res?.ok !== false) made++
      }
      setBulkMsg(`${made} call task${made === 1 ? '' : 's'} created for ${who}${skipped ? ` · ${skipped} already had one` : ''}.`)
      return { ok: true }
    })
    return (
      <section className="ip-panel ip-panel-admin">
        <div className="ip-panel-head">
          <span className="ip-panel-title">{cfg.schedTitle} · week of {week ? fmtDay(week) : ''}</span>
          <span className="ip-n">{rows.length}</span>
          <span className="ip-hint"><b className={blocked ? 't-red' : 't-ok'}>{blocked} with a blocker</b> · <b className={owed ? 't-red' : 't-ok'}>{fmtUSD(owed)} still owed</b> on this week's {cfg.things}</span>
        </div>
        <div className="ip-btabs">
          {TABS.map(([code, label, n]) => (
            <button type="button" key={code} className={`ip-btab${blockerTab === code ? ' on' : ''}${(code === 'balance' || code === 'hot') && n ? ' hot' : ''}`} onClick={() => setBlockerTab(code)}>{label} <b>{n}</b></button>
          ))}
          {blockerTab === 'balance' && balanceTargets.length > 0 && (
            <span className="ip-bulk">
              <span className="ip-hint">Task the calls to</span>
              <select value={bulkWho || getActiveStaffUser() || 'Admin'} onChange={e => setBulkWho(e.target.value)} aria-label="Who gets the balance calls">
                <optgroup label="People">{STAFF_NAMES.map(n => <option key={n} value={n}>{n}</option>)}</optgroup>
                <optgroup label="Departments">{DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}</optgroup>
              </select>
              <button type="button" className="ib-act ib-act-go" disabled={busy} onClick={taskAllBalances}>Task all {balanceTargets.length} balance call{balanceTargets.length === 1 ? '' : 's'}</button>
            </span>
          )}
        </div>
        {bulkMsg && <div className="ip-bulkmsg">{bulkMsg} <button type="button" className="ip-remadd" onClick={() => setBulkMsg(null)}>ok</button></div>}
        {rows.length === 0 && <div className="ip-empty">Nothing on a day yet — build the week first.</div>}
        {rows.length > 0 && shownRows.length === 0 && <div className="ip-empty">Nothing under that tab this week.</div>}
        {days.map(d => {
          const dayRows = shownRows.filter(r => r.day.iso === d.iso)
          if (!dayRows.length) return null
          return (
            <div key={d.iso} className="ip-adm-day">
              <div className="ip-cem-h">{d.label} {fmtDay(d.iso)} <span className="ip-n">{dayRows.length}</span></div>
              {dayRows.map(({ batch, job, stop }) => {
                if (!job) return <div key={stop.job_id} className="ip-row"><span className="ip-fam">(job not loaded)</span></div>
                const g = gatesOf(job)
                const bal = rowBalanceDue(job.order || {})
                const mb = job.order?.manual_blocker
                const list = remsOf(job)
                const ok = cfg.ready(g)
                return (
                  <div key={stop.job_id} className={`ip-adm${ok ? ' ip-row-ready' : ' ip-adm-blocked'}${isHot(job) ? ' ip-row-hot' : ''}`}>
                    <div className="ip-adm-top">
                      <button type="button" className="ip-fam ip-fam-btn" onClick={() => job.order?.id && onOpenOrderDetail?.(job.order.id, cfg.openAction)}>{famOf(job)}</button>
                      <HotTag on={isHot(job)} />
                      {trackTag(job)}
                      <span className="ip-meta">{[batch.cemetery?.name || cemOf(job), job.order?.order_number, composeGraveLocation(job.order || {})].filter(Boolean).join(' · ')}</span>
                      {ok ? <span className="ip-g ok">{cfg.readyLabel}</span> : <span className="ip-g red">BLOCKED</span>}
                      {mb?.kind && <span className={`ip-g ${mb.kind === 'hold' ? 'red' : 'rem'}`} title={mb.reason || ''}>{String(manualBlockerChipText(mb)).toUpperCase()}</span>}
                    </div>
                    <div className="ip-adm-gates">
                      {/* BALANCE FIRST (Paul: "ESPECIALLY BALANCES") */}
                      <span className={`ip-g ${g.paid ? 'ok' : 'red'} ip-g-big`}>{g.paid ? 'PAID IN FULL' : bal > 0 ? `OWES ${fmtUSD(bal)}` : 'NOT PAID'}</span>
                      {!g.paid && (
                        <>
                          <button type="button" className="ib-act ib-act-go" onClick={() => job.order?.id && onOpenOrderDetail?.(job.order.id, cfg.openAction)} title="Open the order — record the payment there">Record payment</button>
                          <button type="button" className="ib-act" onClick={() => (taskFor === job.id ? setTaskFor(null) : openTasker(job))}>Task call</button>
                        </>
                      )}
                      {cfg.key === 'set' && (
                        <GateSelect tone={g.fdn === null ? 'na' : g.fdn ? 'ok' : 'red'} label={g.fdn === null ? 'NO FDN' : g.fdnCode === 'drop_off' ? 'DROP OFF' : g.fdn ? 'FDN IN' : 'FDN NOT IN'}
                          value={g.fdnCode} options={FDN_STATUS} disabled={busy} title="Foundation status" onChange={(c) => changeGate(job, 'fdn', c)} />
                      )}
                      <GateSelect tone={g.permit === null ? 'na' : g.permit ? 'ok' : 'red'} label={g.permit === null ? 'NO PERMIT' : g.permit ? 'PERMIT OK' : 'PERMIT NOT APPROVED'}
                        value={job.order?.permit_status || 'unknown'} options={PERMIT_STATUS_OPTIONS} disabled={busy || !job.order?.id} title="Permit status" onChange={(c) => changeGate(job, 'permit', c)} />
                      {cfg.key === 'set' && (
                        <GateSelect tone={g.blasted ? 'ok' : 'red'} label={blastWord(job, g.blasted)}
                          value={deriveStoneStatus(job)} options={stoneStatusOptions(job)} disabled={busy} title="Stone / bronze status" onChange={(c) => changeGate(job, 'stone', c)} />
                      )}
                      {cfg.key === 'inscription' && (
                        g.cut ? <span className="ip-g ok ip-g-big">STENCIL CUT</span> : (
                          <>
                            <span className="ip-g red ip-g-big">STENCIL NOT CUT</span>
                            <button type="button" className="ib-act ib-act-go" disabled={busy} title="Mark the stencil cut — the same write as Design status → Cut" onClick={() => { if (window.confirm(`Mark ${famOf(job)}'s stencil cut?`)) changeGate(job, 'cut', 'cut') }}>Mark cut</button>
                          </>
                        )
                      )}
                      <ReminderChips list={list} busy={busy} onDone={remDone} />
                      {remFor?.jobId === job.id ? reminderInput(remFor) : (
                        <button type="button" className="ip-remadd" onClick={() => { setRemFor({ jobId: job.id }); setRemText('') }}>+ reminder</button>
                      )}
                    </div>
                    {taskFor === job.id && (
                      <div className="ip-tasker">
                        {taskDone ? <span className="t-ok">Task created — {taskWho} has it.</span> : (
                          <>
                            <select value={taskWho} onChange={e => setTaskWho(e.target.value)} aria-label="Who">
                              <optgroup label="People">{STAFF_NAMES.map(n => <option key={n} value={n}>{n}</option>)}</optgroup>
                              <optgroup label="Departments">{DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}</optgroup>
                            </select>
                            <input value={taskNote} onChange={e => setTaskNote(e.target.value)} placeholder="What needs doing…" />
                            <button type="button" className="ib-act ib-act-go" disabled={busy || !taskNote.trim()} onClick={() => sendTask(job)}>Task it</button>
                            <button type="button" className="ib-act" onClick={() => setTaskFor(null)}>×</button>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )
        })}
      </section>
    )
  }

  const loadingJobs = !jobsProp && ownJobs == null
  return (
    <div className="ip">
      <style>{IP_CSS}</style>
      <header className="jobcc-cmd">
        <div className="jobcc-cmd-left">
          <div className="ip-titlerow">
            <button type="button" className="jobcc-btn" onClick={onBack}>{cfg.back}</button>
            <h1 className="jobcc-title">{cfg.title}</h1>
            <div className="ip-modes">
              <button type="button" className={`ip-mode${mode === 'build' ? ' on' : ''}`} onClick={() => setMode('build')}>{cfg.modeBuild}</button>
              <button type="button" className={`ip-mode${mode === 'scheduled' ? ' on' : ''}`} onClick={() => setMode('scheduled')}>{cfg.modeSched}</button>
            </div>
          </div>
          <div className="jobcc-purpose">{mode === 'build' ? cfg.purposeBuild : cfg.purposeSched}</div>
        </div>
        <div className="jobcc-cmd-right">
          <div className="jobcc-actions">
            <button type="button" className="jobcc-btn" disabled={!week} onClick={() => setWeek(addDays(week, -7))}>‹ week</button>
            <span className="ip-weekpill">{week ? `Week of ${fmtDay(week)}` : '…'}<b className={kind === 'install' ? 'a' : 'b'}>{kind === 'install' ? 'A · INSTALL' : 'B · PRODUCTION'}</b></span>
            <button type="button" className="jobcc-btn" disabled={!week} onClick={() => setWeek(addDays(week, 7))}>week ›</button>
            {mode === 'build' && (weekItems.length > 0 || batches.length > 0) && (
              <button type="button" className="jobcc-btn ip-movebtn" disabled={busy} title="Everything on this week — list, trips and dates — slides to the same weekdays next week" onClick={moveWeekForward}>Move this week → next week</button>
            )}
          </div>
        </div>
      </header>
      {rolled.length > 0 && (
        <div className="ip-rolled">
          <b>Rolled over:</b> {rolled.length} {rolled.length === 1 ? cfg.thing : cfg.things} {cfg.notDone} last week moved onto this week's list — {rolled.map(r => famOf(jobById.get(r.jobId))).filter(Boolean).slice(0, 8).join(', ')}{rolled.length > 8 ? '…' : ''}. Give them a day.
        </div>
      )}

      {kind !== 'install' && week && <div className="ip-note">This is a B (production) week. You can still plan here — or flip the week to A in the Team Meeting.</div>}
      {err && <div className="jobcc-err">{err}</div>}

      {!plan || setList == null || loadingJobs ? <div className="jobcc-empty">Loading…</div> : mode === 'scheduled' ? renderScheduled() : (
        <>
          {renderWeek()}

          <section className="ip-panel">
            <div className="ip-panel-head">
              <span className="ip-panel-title">Week list</span>
              <span className="ip-n">{weekItems.length}</span>
              <span className="ip-hint">{unplaced.length ? `${unplaced.length} still need a day` : weekItems.length ? `Every ${cfg.thing} has a day` : 'Nothing on the list yet'}</span>
              <button type="button" className="ib-act ib-act-go" style={{ marginLeft: 'auto' }} onClick={() => { setAddOpen(o => !o); setAddQ('') }}>{addOpen ? 'Close' : cfg.addBtn}</button>
            </div>
            {addOpen && (
              <div className="ip-add">
                <div className="ip-add-head">
                  <input className="ip-search" type="search" placeholder="Search family, cemetery, order #" value={addQ} onChange={e => setAddQ(e.target.value)} autoFocus />
                  <span className="ip-hint">{addCandidates.length} {cfg.poolHint} · {readyCount} ready{cfg.key === 'inscription' ? ` · ${addCandidates.filter(isHot).length} hot` : ''}</span>
                  {readyCount > 0 && <button type="button" className="ib-act ib-act-go" disabled={busy} onClick={addAllReady}>Add all {readyCount} ready</button>}
                </div>
                <div className="ip-add-list">
                  {addCandidates.slice(0, 80).map(j => (
                    <div key={j.id} className={`ip-row${ready(j) ? ' ip-row-ready' : ''}${isHot(j) ? ' ip-row-hot' : ''}`}>
                      <span className="ip-fam">{famOf(j)}</span>
                      <HotTag on={isHot(j)} />
                      {trackTag(j)}
                      <span className="ip-meta">{[cemOf(j), j.order?.order_number].filter(Boolean).join(' · ')}</span>
                      {gateChips(j, cfg)}
                      <ReminderChips list={remsOf(j)} busy={busy} onDone={remDone} />
                      <button type="button" className="ib-act ib-act-go" disabled={busy} onClick={() => addToWeek(j)}>Add →</button>
                    </div>
                  ))}
                  {addCandidates.length === 0 && <div className="ip-empty">{cfg.emptyPool}</div>}
                </div>
              </div>
            )}
            {weekItems.length === 0 && !addOpen && <div className="ip-empty">{cfg.emptyAdd}</div>}
            {groupByCem(weekItems).map(([cem, { id: cemId, items }]) => {
              const allSet = items.length > 0 && items.every(it => dayOfJob.has(it.job_id))
              const nSet = items.filter(it => dayOfJob.has(it.job_id)).length
              const folded = collapsed.has(cem)
              const cemRems = cemId ? (rems.byCemetery.get(cemId) || []) : []
              return (
                <div key={cem} className="ip-cem">
                  <div className="ip-cem-h">
                    <button type="button" className="ip-cem-btn" onClick={() => toggleCem(cem)} title={folded ? `Show the ${cfg.things}` : `Hide the ${cfg.things}`}>
                      <span className="ip-caret">{folded ? '▸' : '▾'}</span> {cem}
                    </button>
                    <span className={`ip-n${allSet ? ' ip-n-ok' : nSet ? ' ip-n-part' : ''}`} title={allSet ? `Every ${cfg.thing} here has a day` : `${nSet} of ${items.length} have a day`}>{allSet ? `${items.length} ✓` : nSet ? `${nSet}/${items.length}` : items.length}</span>
                    {cemRems.length > 0 && <ReminderChips list={cemRems} busy={busy} onDone={remDone} />}
                    {cemId && (remFor?.cemeteryId === cemId ? reminderInput(remFor) : (
                      <button type="button" className="ip-remadd" title={`A reminder for every job at ${cem}`} onClick={() => { setRemFor({ cemeteryId: cemId, name: cem }); setRemText('') }}>+ cemetery reminder</button>
                    ))}
                  </div>
                  {!folded && items.map(it => renderJobRow(it.job_id, { onWeekRow: it }))}
                </div>
              )
            })}
          </section>
          <div className="ip-foot">{cfg.foot}</div>
        </>
      )}
    </div>
  )
}

const IP_CSS = `
  .ip-titlerow { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
  .ip-modes { display: inline-flex; background: #0e1116; border: 1px solid #2a313c; border-radius: 999px; padding: 3px; gap: 2px; }
  .ip-mode { font: inherit; font-size: 12px; font-weight: 700; color: #8b95a5; background: none; border: none; border-radius: 999px; padding: 6px 14px; cursor: pointer; }
  .ip-mode.on { background: #1a2230; color: #fbbf24; }
  .ip-weekpill { display: inline-flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 800; color: #f4f6fa; padding: 7px 12px; border: 1px solid #2a313c; border-radius: 8px; background: #11151c; white-space: nowrap; }
  .ip-weekpill b { font-family: var(--font-m, 'JetBrains Mono'), monospace; font-size: 10px; letter-spacing: .08em; border-radius: 999px; padding: 2px 8px; }
  .ip-weekpill b.a { color: #C9A468; border: 1px solid #C9A468; } .ip-weekpill b.b { color: #8b95a5; border: 1px solid #3a4452; }
  .ip-note { font-size: 12px; color: #fbbf24; background: #2a2210; border: 1px solid #5a4a1e; border-radius: 8px; padding: 8px 12px; margin-bottom: 12px; }
  .ip-panel { background: #11151c; border: 1px solid #C9A468; border-radius: 10px; padding: 12px 14px; margin-top: 14px; display: flex; flex-direction: column; gap: 10px; }
  .ip-panel-admin { border-color: #2d5a44; margin-top: 0; }
  .ip-panel-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .ip-panel-title { font-size: 14px; font-weight: 800; color: #f4f6fa; }
  .ip-n { font-family: var(--font-m, 'JetBrains Mono'), monospace; font-size: 11px; color: #6f7a8a; background: #1a212b; border-radius: 999px; padding: 1px 8px; white-space: nowrap; }
  .ip-n-ok { color: #eafff4; background: #1d7a55; } .ip-n-part { color: #fbbf24; background: #2a2210; }
  .ip-hint { font-size: 11.5px; color: #8b95a5; }
  .t-ok { color: #34d399; } .t-red { color: #f87171; }
  .ip-add { background: #0e1116; border: 1px dashed #3a4452; border-radius: 9px; padding: 10px; display: flex; flex-direction: column; gap: 8px; }
  .ip-add-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .ip-search { font: inherit; font-size: 12px; flex: 1 1 200px; max-width: 320px; background: #0E1116; border: 1px solid #2a313c; border-radius: 6px; color: #e6e9ef; padding: 6px 8px; }
  .ip-add-list { display: flex; flex-direction: column; gap: 4px; max-height: 46vh; overflow-y: auto; }
  .ip-cem { display: flex; flex-direction: column; gap: 4px; }
  .ip-cem-h { font-size: 11px; font-weight: 800; letter-spacing: .05em; text-transform: uppercase; color: #c7cedb; margin: 4px 0 2px; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .ip-cem-btn { font: inherit; font-size: 11px; font-weight: 800; letter-spacing: .05em; text-transform: uppercase; color: #c7cedb; background: none; border: none; padding: 0; cursor: pointer; }
  .ip-cem-btn:hover { color: #fbbf24; }
  .ip-caret { font-size: 10px; opacity: .8; }
  .ip-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; background: #151a22; border: 1px solid #232a35; border-radius: 8px; padding: 6px 10px; min-width: 0; }
  .ip-row-ready { border-color: #1f3a2a; }
  /* A job with a day fades — it's on the calendar (Paul round 2). */
  .ip-row-sched { opacity: .55; background: #12201a; border-color: #1f3a2a; }
  .ip-row-sched:hover { opacity: 1; }
  /* Hot list = red (Paul: "so we know it's hot"). */
  .ip-row-hot { border-left: 3px solid #ef4444; }
  .ip-hot { font-size: 9px; font-weight: 900; letter-spacing: .08em; color: #fff; background: #dc2626; border-radius: 999px; padding: 2px 8px; white-space: nowrap; box-shadow: 0 0 0 1px rgba(220,38,38,.35), 0 0 10px rgba(220,38,38,.35); }
  .ip-fam { font-size: 13px; font-weight: 700; color: #f4f6fa; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 200px; }
  .ip-fam-btn { font: inherit; font-weight: 700; background: none; border: none; padding: 0; cursor: pointer; text-align: left; text-decoration: underline dotted rgba(139,149,165,0.6); text-underline-offset: 3px; }
  .ip-fam-btn:hover { color: #fbbf24; }
  .ip-track { font-size: 9px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.05em; border-radius: 999px; padding: 2px 8px; white-space: nowrap; }
  .ip-track-sm { padding: 1px 6px; font-size: 8px; }
  .ip-track-purple { background: #261f3a; color: #a78bfa; } .ip-track-blue { background: #16263a; color: #6fb3f0; } .ip-track-amber { background: #322712; color: #fbbf24; }
  .ip-meta { font-size: 11px; color: #8b95a5; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; flex: 1 1 140px; }
  .ip-gates { display: inline-flex; gap: 4px; flex-wrap: wrap; }
  .ip-g { font-size: 8.5px; font-weight: 800; letter-spacing: .05em; border-radius: 999px; padding: 2px 7px; white-space: nowrap; }
  .ip-g.ok { color: #34d399; background: rgba(52,211,153,.12); } .ip-g.red { color: #f87171; background: rgba(248,113,113,.14); } .ip-g.na { color: #6f7a8a; background: #1a212b; } .ip-g.rem { color: #fbbf24; background: rgba(251,191,36,.12); }
  .ip-g-big { font-size: 10.5px; padding: 4px 10px; }
  .ip-gsel { position: relative; cursor: pointer; display: inline-flex; align-items: center; font-size: 9.5px; padding: 3px 8px; }
  .ip-gsel select { position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0; cursor: pointer; font: inherit; }
  .ip-gsel:hover { filter: brightness(1.25); }
  .ip-gsel .ip-caret { font-size: 8px; }
  .ip-rems { display: inline-flex; gap: 4px; flex-wrap: wrap; }
  .ip-rem { display: inline-flex; align-items: center; gap: 5px; font-size: 9.5px; font-weight: 700; color: #fbbf24; background: rgba(251,191,36,.12); border: 1px solid rgba(251,191,36,.35); border-radius: 999px; padding: 2px 4px 2px 8px; white-space: nowrap; max-width: 260px; overflow: hidden; text-overflow: ellipsis; }
  .ip-rem-cem { border-style: dashed; }
  .ip-rem button { font: inherit; font-size: 10px; line-height: 1; color: #fbbf24; background: #2a2210; border: 1px solid #5a4a1e; border-radius: 999px; width: 16px; height: 16px; cursor: pointer; padding: 0; }
  .ip-rem button:hover { background: #1d7a55; color: #eafff4; border-color: #34d399; }
  .ip-remadd { font: inherit; font-size: 10px; font-weight: 700; color: #8b95a5; background: none; border: 1px dashed #3a4452; border-radius: 999px; padding: 2px 8px; cursor: pointer; white-space: nowrap; }
  .ip-remadd:hover { color: #fbbf24; border-color: #5a4a1e; }
  .ip-reminput { display: inline-flex; align-items: center; gap: 5px; flex: 1 1 260px; min-width: 0; }
  .ip-reminput input { font: inherit; font-size: 12px; flex: 1; min-width: 120px; background: #0E1116; border: 1px solid #5a4a1e; border-radius: 6px; color: #e6e9ef; padding: 4px 8px; }
  .ip-days { display: inline-flex; gap: 3px; margin-left: auto; }
  .ip-day { width: 30px; height: 28px; font: 800 11px/1 inherit; border-radius: 6px; border: 1px solid #2a313c; background: #1a212b; color: #c7cedb; cursor: pointer; }
  .ip-day:hover:not(:disabled) { border-color: #C9A468; color: #fbbf24; }
  .ip-day.on { background: #1d7a55; border-color: #34d399; color: #eafff4; }
  .ip-day:disabled { opacity: .5; cursor: default; }
  .ip-day.past { opacity: .22; text-decoration: line-through; }
  .ip-movebtn { border-color: #C9A468; color: #fbbf24; }
  .ip-rolled { font-size: 12px; color: #fbbf24; background: #2a2210; border: 1px solid #5a4a1e; border-radius: 8px; padding: 8px 12px; margin-bottom: 12px; }
  .ip-empty { font-size: 12px; color: #6f7a8a; padding: 6px 2px; }
  .ip-week { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 10px; }
  @media (max-width: 1100px) { .ip-week { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
  .ip-daycol { background: #11151c; border: 1px solid #20262f; border-radius: 10px; padding: 9px; display: flex; flex-direction: column; gap: 8px; min-width: 0; min-height: 120px; }
  .ip-daycol.has { border-color: #2d5a44; }
  .ip-daycol-h { display: flex; align-items: baseline; gap: 8px; font-size: 12px; font-weight: 800; text-transform: uppercase; letter-spacing: .04em; color: #f4f6fa; }
  .ip-daycol-date { font-family: var(--font-m, 'JetBrains Mono'), monospace; font-size: 10.5px; color: #8b95a5; font-weight: 600; text-transform: none; letter-spacing: 0; }
  .ip-daycol-empty { font-size: 11px; color: #3a4452; text-align: center; padding: 10px 0; }
  .ip-trip { background: #151a22; border: 1px solid #232a35; border-left: 3px solid #1D9E75; border-radius: 8px; padding: 6px 8px; display: flex; flex-direction: column; gap: 4px; min-width: 0; }
  .ip-trip-insc { border-left-color: #a78bfa; }
  .ip-trip-h { font-size: 10.5px; font-weight: 800; letter-spacing: .04em; text-transform: uppercase; color: #8b95a5; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .ip-stop { display: flex; align-items: center; gap: 6px; min-width: 0; flex-wrap: wrap; }
  .ip-stop .ip-fam { font-size: 12px; flex: 1; }
  .ip-stop-n { font-family: var(--font-m, 'JetBrains Mono'), monospace; font-size: 10px; color: #6f7a8a; width: 14px; }
  .ip-x { font: inherit; font-size: 13px; background: none; border: 1px solid #2a313c; border-radius: 5px; color: #8b95a5; cursor: pointer; padding: 0 6px; line-height: 20px; }
  .ip-x:hover { color: #f87171; border-color: #5c2a2a; }
  .ip-foot { font-size: 11.5px; color: #6f7a8a; margin-top: 12px; }
  .ip-btabs { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
  .ip-btab { font: inherit; font-size: 12px; font-weight: 700; color: #8b95a5; background: #0e1116; border: 1px solid #2a313c; border-radius: 999px; padding: 6px 12px; cursor: pointer; display: inline-flex; gap: 6px; align-items: center; white-space: nowrap; }
  .ip-btab b { font-family: var(--font-m, 'JetBrains Mono'), monospace; font-size: 10.5px; color: #6f7a8a; }
  .ip-btab.hot { border-color: #5c2a2a; color: #f87171; } .ip-btab.hot b { color: #f87171; }
  .ip-btab.on { background: #1a2230; border-color: #C9A468; color: #fbbf24; } .ip-btab.on b { color: #C9A468; }
  .ip-bulk { display: inline-flex; align-items: center; gap: 8px; margin-left: auto; flex-wrap: wrap; }
  .ip-bulk select { font: inherit; font-size: 12px; background: #11151c; border: 1px solid #2a313c; border-radius: 6px; color: #e6e9ef; padding: 5px 7px; }
  .ip-bulkmsg { font-size: 12px; color: #34d399; background: #0f2a1d; border: 1px solid #2d5a44; border-radius: 7px; padding: 6px 10px; display: flex; gap: 10px; align-items: center; }
  .ip-adm-day { display: flex; flex-direction: column; gap: 6px; }
  .ip-adm { background: #151a22; border: 1px solid #232a35; border-radius: 9px; padding: 8px 10px; display: flex; flex-direction: column; gap: 7px; min-width: 0; }
  .ip-adm-blocked { border-left: 3px solid #f87171; }
  .ip-adm.ip-row-ready { border-left: 3px solid #34d399; }
  .ip-adm.ip-row-hot { border-left-color: #ef4444; box-shadow: inset 0 0 0 1px rgba(220,38,38,.25); }
  .ip-adm-top { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; min-width: 0; }
  .ip-adm-gates { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
  .ip-tasker { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; background: #0e1116; border: 1px solid #2a313c; border-radius: 7px; padding: 6px 8px; }
  .ip-tasker select, .ip-tasker input { font: inherit; font-size: 12px; background: #11151c; border: 1px solid #2a313c; border-radius: 6px; color: #e6e9ef; padding: 5px 7px; }
  .ip-tasker input { flex: 1 1 200px; min-width: 0; }
`
