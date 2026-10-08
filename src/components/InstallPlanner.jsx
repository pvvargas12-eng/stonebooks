// =============================================================================
// InstallPlanner — build the installation week, then sort it Mon–Fri
// =============================================================================
// Paul 2026-10-08: "like the line planner i need a pretty official and good
// way to build my installation schedule — add them all to an install list and
// then plan out which day: first add to my week list, then M-F sort it."
//
// No new tables. The WEEK LIST is the Team Meeting's committed plan for that
// week (week_plan_items, lane 'set' — the same rows the Monday sheet, the
// carryover strip and Friday scoring read). The DAYS are the Scheduler's
// 'setting' batches (work_batches + work_batch_jobs — what the Scheduler,
// Calendar, field Today and the meeting's 5-day board already show), one
// batch per cemetery per day (a trip). Putting a stone on a day also stamps
// its install milestone in_progress with that date — exactly what the set
// list's "Schedule install" button does — so the card reads Scheduled and the
// SCHEDULED tile counts it. Dark .jobcc / .ib-* aesthetic.
// =============================================================================
import { useState, useEffect, useCallback } from 'react'
import {
  getInstallList, getBatches, createBatch, addJobsToBatch, removeJobFromBatch,
  updateMilestoneWithOverride, installGates, rowBalanceDue, fmtUSD, logOrderActivity, getCurrentStaffName,
} from '../lib/stonebooksData'
import { composeGraveLocation } from '../lib/monumentCatalog'
import {
  isoOf, mondayOf, addDays, listWeekPlans, kindFromPlans, nextInstallMonday, weekKindLabel,
  getWeekPlanWithItems, addPlanItem, removePlanItem,
} from '../lib/meetingData'

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']
const installMilestone = (job) => {
  const by = new Map((job?.milestones || []).map(m => [m.milestone_key, m]))
  return by.get('installed') || by.get('door_installed') || by.get('work_completed') || null
}
const famOf = (job) => job?.order?.primary_lastname || job?.customer?.last_name
  || [job?.customer?.first_name, job?.customer?.last_name].filter(Boolean).join(' ') || '—'
const cemOf = (job) => job?.order?.cemetery?.name || job?.cemetery?.name || ''
const cemIdOf = (job) => job?.cemetery?.id || job?.order?.cemetery?.id || job?.order?.cemetery_id || null
const fmtDay = (iso) => { const d = new Date(iso + 'T00:00:00'); return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) }
const readyNow = (g) => g && g.paid !== false && g.fdn !== false && g.permit !== false && g.blasted !== false

function gateChips(job) {
  const g = installGates(job?.order || {}, job)
  const bal = rowBalanceDue(job?.order || {})
  return (
    <span className="ip-gates">
      <span className={`ip-g ${g.paid ? 'ok' : 'red'}`}>{g.paid ? 'PAID' : bal > 0 ? `BAL ${fmtUSD(bal)}` : 'NOT PAID'}</span>
      {g.fdn === null ? <span className="ip-g na">NO FDN</span> : <span className={`ip-g ${g.fdn ? 'ok' : 'red'}`}>{g.fdnCode === 'drop_off' ? 'DROP OFF' : g.fdn ? 'FDN IN' : 'FDN NOT IN'}</span>}
      {g.permit === null ? <span className="ip-g na">NO PERMIT</span> : <span className={`ip-g ${g.permit ? 'ok' : 'red'}`}>{g.permit ? 'PERMIT OK' : 'PERMIT'}</span>}
      <span className={`ip-g ${g.blasted ? 'ok' : 'red'}`}>{g.blasted ? 'BLASTED' : 'NOT BLASTED'}</span>
    </span>
  )
}

export default function InstallPlanner({ jobs = [], onBack, onOpenOrderDetail }) {
  const [week, setWeek] = useState(null)        // Monday ISO
  const [plans, setPlans] = useState([])
  const [plan, setPlan] = useState(null)        // { plan, items }
  const [batches, setBatches] = useState([])
  const [setList, setSetList] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [addOpen, setAddOpen] = useState(false)
  const [addQ, setAddQ] = useState('')

  const jobById = new Map((jobs || []).map(j => [j.id, j]))

  // Default week = the next install week (this week if it is one).
  useEffect(() => {
    let alive = true
    nextInstallMonday().then(w => { if (alive) setWeek(w) }).catch(() => { if (alive) setWeek(isoOf(mondayOf())) })
    return () => { alive = false }
  }, [])

  const load = useCallback(async () => {
    if (!week) return
    const [ps, p, bs, sl] = await Promise.all([
      listWeekPlans(),
      getWeekPlanWithItems(week),
      getBatches({ from: week, to: addDays(week, 6), kind: 'setting' }).catch(() => []),
      getInstallList().catch(() => []),
    ])
    setPlans(ps)
    if (p.ok) { setPlan(p); setErr(null) } else setErr(p.error)
    setBatches(bs || [])
    setSetList(sl || [])
  }, [week])
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
  const weekItems = (plan?.items || []).filter(it => it.lane === 'set' && it.job_id)
  const onWeek = new Set(weekItems.map(it => it.job_id))
  // Which day each job sits on (via the setting batches this week).
  const dayOfJob = new Map()
  const batchOfJob = new Map()
  for (const b of batches) for (const l of (b.batch_jobs || [])) { dayOfJob.set(l.job_id, b.scheduled_date); batchOfJob.set(l.job_id, b) }
  const days = DAYS.map((label, i) => {
    const iso = addDays(week || isoOf(mondayOf()), i)
    const dayBatches = batches.filter(b => b.scheduled_date === iso)
    return { label, iso, batches: dayBatches, count: dayBatches.reduce((s, b) => s + (b.batch_jobs || []).length, 0) }
  })
  const unplaced = weekItems.filter(it => !dayOfJob.has(it.job_id))

  // ── Week list ───────────────────────────────────────────────────────────
  const addToWeek = (job) => run(() => addPlanItem({ planId: plan.plan.id, lane: 'set', jobId: job.id, orderId: job.order?.id || null, title: famOf(job) }))
  const addAllReady = () => run(async () => {
    for (const j of addCandidates.filter(j => readyNow(installGates(j.order || {}, j)))) {
      const r = await addPlanItem({ planId: plan.plan.id, lane: 'set', jobId: j.id, orderId: j.order?.id || null, title: famOf(j) })
      if (!r.ok) return r
    }
    return { ok: true }
  })
  const removeFromWeek = (it) => run(async () => {
    const b = batchOfJob.get(it.job_id)
    if (b) await removeJobFromBatch(b.id, it.job_id)
    return removePlanItem(it.id)
  })

  // ── Days ────────────────────────────────────────────────────────────────
  // One trip per cemetery per day: join the day's batch for that cemetery
  // or create it. Then stamp the install milestone with the day.
  const placeOnDay = (jobId, iso) => run(async () => {
    const job = jobById.get(jobId)
    if (!job) return { ok: false, error: 'Job not loaded' }
    const cemId = cemIdOf(job)
    if (!cemId) return { ok: false, error: `${famOf(job)} has no cemetery linked — link one on the order first.` }
    const prev = batchOfJob.get(jobId)
    if (prev) { const r = await removeJobFromBatch(prev.id, jobId); if (!r.ok) return r }
    const existing = batches.find(b => b.scheduled_date === iso && b.destination_cemetery_id === cemId && b.id !== prev?.id)
    let r
    if (existing) r = await addJobsToBatch(existing.id, [{ job_id: jobId }])
    else r = await createBatch({ kind: 'setting', scheduled_date: iso, title: cemOf(job) || famOf(job), destination_cemetery_id: cemId, job_ids: [jobId] })
    if (!r.ok) return r
    const ms = installMilestone(job)
    if (ms) await updateMilestoneWithOverride(jobId, ms.milestone_key, { status: 'in_progress', dueDate: iso }, 'Scheduled from the Install Planner').catch(() => {})
    const actor = await getCurrentStaffName().catch(() => null)
    if (job.order?.id) logOrderActivity(job.order.id, { type: 'change', field: 'Install', newValue: 'Scheduled', note: `Install planned for ${iso} (Install Planner)`, actor }).catch(() => {})
    return { ok: true }
  })
  const unplace = (jobId) => run(async () => {
    const b = batchOfJob.get(jobId)
    if (b) { const r = await removeJobFromBatch(b.id, jobId); if (!r.ok) return r }
    const job = jobById.get(jobId)
    const ms = installMilestone(job)
    if (ms && ms.status === 'in_progress') await updateMilestoneWithOverride(jobId, ms.milestone_key, { status: 'not_started', dueDate: null }, 'Unscheduled from the Install Planner').catch(() => {})
    return { ok: true }
  })

  // ── Add picker: the set list, ready first, grouped by cemetery ──────────
  const addCandidates = (setList || [])
    .map(m => jobById.get(m.job_id)).filter(Boolean)
    .filter(j => !onWeek.has(j.id) && installMilestone(j)?.status !== 'done')
    .filter(j => { const t = addQ.trim().toLowerCase(); return !t || [famOf(j), cemOf(j), j.order?.order_number].filter(Boolean).join(' ').toLowerCase().includes(t) })
    .sort((a, b) => (readyNow(installGates(b.order || {}, b)) ? 1 : 0) - (readyNow(installGates(a.order || {}, a)) ? 1 : 0) || cemOf(a).localeCompare(cemOf(b)))
  const readyCount = addCandidates.filter(j => readyNow(installGates(j.order || {}, j))).length

  const groupByCem = (items) => {
    const m = new Map()
    for (const it of items) { const k = cemOf(jobById.get(it.job_id)) || '—'; if (!m.has(k)) m.set(k, []); m.get(k).push(it) }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }

  const renderJobRow = (jobId, { onWeekRow = null, showDays = true } = {}) => {
    const job = jobById.get(jobId)
    if (!job) return <div key={jobId} className="ip-row"><span className="ip-fam">(job not loaded)</span></div>
    const day = dayOfJob.get(jobId)
    return (
      <div key={jobId} className={`ip-row${readyNow(installGates(job.order || {}, job)) ? ' ip-row-ready' : ''}`}>
        <button type="button" className="ip-fam ip-fam-btn" onClick={() => job.order?.id && onOpenOrderDetail?.(job.order.id, 'installation')}>{famOf(job)}</button>
        <span className="ip-meta">{[job.order?.order_number, composeGraveLocation(job.order || {})].filter(Boolean).join(' · ')}</span>
        {gateChips(job)}
        {showDays && (
          <span className="ip-days">
            {days.map(d => (
              <button type="button" key={d.iso} className={`ip-day${day === d.iso ? ' on' : ''}`} disabled={busy} title={`${d.label} ${fmtDay(d.iso)}`}
                onClick={() => (day === d.iso ? unplace(jobId) : placeOnDay(jobId, d.iso))}>{d.label[0]}</button>
            ))}
          </span>
        )}
        {onWeekRow && <button type="button" className="ib-act ib-act-x" disabled={busy} title="Take off this week's list" onClick={() => removeFromWeek(onWeekRow)}>×</button>}
      </div>
    )
  }

  return (
    <div className="ip">
      <style>{IP_CSS}</style>
      <header className="jobcc-cmd">
        <div className="jobcc-cmd-left">
          <div className="ip-titlerow">
            <button type="button" className="jobcc-btn" onClick={onBack}>← Installation</button>
            <h1 className="jobcc-title">Install Planner</h1>
          </div>
          <div className="jobcc-purpose">Build the week's list from the set list, then put each stone on a day. Days become Scheduler trips (one per cemetery per day) and the Team Meeting's set lane reads the same list.</div>
        </div>
        <div className="jobcc-cmd-right">
          <div className="jobcc-actions">
            <button type="button" className="jobcc-btn" disabled={!week} onClick={() => setWeek(addDays(week, -7))}>‹ week</button>
            <span className="ip-weekpill">{week ? `Week of ${fmtDay(week)}` : '…'}<b className={kind === 'install' ? 'a' : 'b'}>{kind === 'install' ? 'A · INSTALL' : 'B · PRODUCTION'}</b></span>
            <button type="button" className="jobcc-btn" disabled={!week} onClick={() => setWeek(addDays(week, 7))}>week ›</button>
          </div>
        </div>
      </header>

      {kind !== 'install' && week && <div className="ip-note">This is a B (production) week. You can still plan installs here — or flip the week to A in the Team Meeting.</div>}
      {err && <div className="jobcc-err">{err}</div>}

      {!plan || setList == null ? <div className="jobcc-empty">Loading…</div> : (
        <>
          {/* THE WEEK LIST */}
          <section className="ip-panel">
            <div className="ip-panel-head">
              <span className="ip-panel-title">Week list</span>
              <span className="ip-n">{weekItems.length}</span>
              <span className="ip-hint">{unplaced.length ? `${unplaced.length} still need a day` : weekItems.length ? 'Every stone has a day' : 'Nothing on the list yet'}</span>
              <button type="button" className="ib-act ib-act-go" style={{ marginLeft: 'auto' }} onClick={() => { setAddOpen(o => !o); setAddQ('') }}>{addOpen ? 'Close' : '+ Add from set list'}</button>
            </div>
            {addOpen && (
              <div className="ip-add">
                <div className="ip-add-head">
                  <input className="ip-search" type="search" placeholder="Search family, cemetery, order #" value={addQ} onChange={e => setAddQ(e.target.value)} autoFocus />
                  <span className="ip-hint">{addCandidates.length} on the set list not on this week · {readyCount} ready</span>
                  {readyCount > 0 && <button type="button" className="ib-act ib-act-go" disabled={busy} onClick={addAllReady}>Add all {readyCount} ready</button>}
                </div>
                <div className="ip-add-list">
                  {addCandidates.slice(0, 80).map(j => (
                    <div key={j.id} className={`ip-row${readyNow(installGates(j.order || {}, j)) ? ' ip-row-ready' : ''}`}>
                      <span className="ip-fam">{famOf(j)}</span>
                      <span className="ip-meta">{[cemOf(j), j.order?.order_number].filter(Boolean).join(' · ')}</span>
                      {gateChips(j)}
                      <button type="button" className="ib-act ib-act-go" disabled={busy} onClick={() => addToWeek(j)}>Add →</button>
                    </div>
                  ))}
                  {addCandidates.length === 0 && <div className="ip-empty">Everything on the set list is already on this week.</div>}
                </div>
              </div>
            )}
            {weekItems.length === 0 && !addOpen && <div className="ip-empty">Add stones from the set list — ready ones first — then give each a day below.</div>}
            {groupByCem(weekItems).map(([cem, items]) => (
              <div key={cem} className="ip-cem">
                <div className="ip-cem-h">{cem} <span className="ip-n">{items.length}</span></div>
                {items.map(it => renderJobRow(it.job_id, { onWeekRow: it }))}
              </div>
            ))}
          </section>

          {/* MON–FRI */}
          <section className="ip-week">
            {days.map(d => (
              <div key={d.iso} className={`ip-daycol${d.count ? ' has' : ''}`}>
                <div className="ip-daycol-h"><span>{d.label}</span><span className="ip-daycol-date">{fmtDay(d.iso)}</span><span className="ip-n">{d.count}</span></div>
                {d.batches.length === 0 && <div className="ip-daycol-empty">—</div>}
                {d.batches.map(b => (
                  <div key={b.id} className="ip-trip">
                    <div className="ip-trip-h">{b.cemetery?.name || b.title || 'Trip'}{b.am_pm ? ` · ${b.am_pm}` : ''}</div>
                    {(b.batch_jobs || []).slice().sort((x, y) => (x.stop_order || 0) - (y.stop_order || 0)).map(l => {
                      const job = jobById.get(l.job_id)
                      return (
                        <div key={l.job_id} className="ip-stop">
                          <span className="ip-stop-n">{l.stop_order || ''}</span>
                          <button type="button" className="ip-fam ip-fam-btn" onClick={() => job?.order?.id && onOpenOrderDetail?.(job.order.id, 'installation')}>{job ? famOf(job) : '(job)'}</button>
                          {job && readyNow(installGates(job.order || {}, job)) ? <span className="ip-g ok">READY</span> : job ? <span className="ip-g red">GATE</span> : null}
                          <button type="button" className="ip-x" disabled={busy} title="Take off this day" onClick={() => unplace(l.job_id)}>×</button>
                        </div>
                      )
                    })}
                  </div>
                ))}
              </div>
            ))}
          </section>
          <div className="ip-foot">Days are Scheduler trips — reorder stops, assign a crew or set AM/PM in the Scheduler. The Team Meeting's set lane and Friday score read this week list.</div>
        </>
      )}
    </div>
  )
}

const IP_CSS = `
  .ip-titlerow { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
  .ip-weekpill { display: inline-flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 800; color: #f4f6fa; padding: 7px 12px; border: 1px solid #2a313c; border-radius: 8px; background: #11151c; white-space: nowrap; }
  .ip-weekpill b { font-family: var(--font-m, 'JetBrains Mono'), monospace; font-size: 10px; letter-spacing: .08em; border-radius: 999px; padding: 2px 8px; }
  .ip-weekpill b.a { color: #C9A468; border: 1px solid #C9A468; } .ip-weekpill b.b { color: #8b95a5; border: 1px solid #3a4452; }
  .ip-note { font-size: 12px; color: #fbbf24; background: #2a2210; border: 1px solid #5a4a1e; border-radius: 8px; padding: 8px 12px; margin-bottom: 12px; }
  .ip-panel { background: #11151c; border: 1px solid #C9A468; border-radius: 10px; padding: 12px 14px; margin-bottom: 14px; display: flex; flex-direction: column; gap: 10px; }
  .ip-panel-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .ip-panel-title { font-size: 14px; font-weight: 800; color: #f4f6fa; }
  .ip-n { font-family: var(--font-m, 'JetBrains Mono'), monospace; font-size: 11px; color: #6f7a8a; background: #1a212b; border-radius: 999px; padding: 1px 8px; }
  .ip-hint { font-size: 11.5px; color: #8b95a5; }
  .ip-add { background: #0e1116; border: 1px dashed #3a4452; border-radius: 9px; padding: 10px; display: flex; flex-direction: column; gap: 8px; }
  .ip-add-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .ip-search { font: inherit; font-size: 12px; flex: 1 1 200px; max-width: 320px; background: #0E1116; border: 1px solid #2a313c; border-radius: 6px; color: #e6e9ef; padding: 6px 8px; }
  .ip-add-list { display: flex; flex-direction: column; gap: 4px; max-height: 46vh; overflow-y: auto; }
  .ip-cem { display: flex; flex-direction: column; gap: 4px; }
  .ip-cem-h { font-size: 11px; font-weight: 800; letter-spacing: .05em; text-transform: uppercase; color: #c7cedb; margin: 4px 0 2px; display: flex; align-items: center; gap: 8px; }
  .ip-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; background: #151a22; border: 1px solid #232a35; border-radius: 8px; padding: 6px 10px; min-width: 0; }
  .ip-row-ready { border-color: #1f3a2a; }
  .ip-fam { font-size: 13px; font-weight: 700; color: #f4f6fa; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 200px; }
  .ip-fam-btn { font: inherit; font-weight: 700; background: none; border: none; padding: 0; cursor: pointer; text-align: left; text-decoration: underline dotted rgba(139,149,165,0.6); text-underline-offset: 3px; }
  .ip-fam-btn:hover { color: #fbbf24; }
  .ip-meta { font-size: 11px; color: #8b95a5; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; flex: 1 1 140px; }
  .ip-gates { display: inline-flex; gap: 4px; flex-wrap: wrap; }
  .ip-g { font-size: 8.5px; font-weight: 800; letter-spacing: .05em; border-radius: 999px; padding: 2px 7px; white-space: nowrap; }
  .ip-g.ok { color: #34d399; background: rgba(52,211,153,.12); } .ip-g.red { color: #f87171; background: rgba(248,113,113,.14); } .ip-g.na { color: #6f7a8a; background: #1a212b; }
  .ip-days { display: inline-flex; gap: 3px; margin-left: auto; }
  .ip-day { width: 30px; height: 28px; font: 800 11px/1 inherit; border-radius: 6px; border: 1px solid #2a313c; background: #1a212b; color: #c7cedb; cursor: pointer; }
  .ip-day:hover:not(:disabled) { border-color: #C9A468; color: #fbbf24; }
  .ip-day.on { background: #1d7a55; border-color: #34d399; color: #eafff4; }
  .ip-day:disabled { opacity: .5; cursor: default; }
  .ip-empty { font-size: 12px; color: #6f7a8a; padding: 6px 2px; }
  .ip-week { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 10px; }
  @media (max-width: 1100px) { .ip-week { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
  .ip-daycol { background: #11151c; border: 1px solid #20262f; border-radius: 10px; padding: 9px; display: flex; flex-direction: column; gap: 8px; min-width: 0; min-height: 120px; }
  .ip-daycol.has { border-color: #2d5a44; }
  .ip-daycol-h { display: flex; align-items: baseline; gap: 8px; font-size: 12px; font-weight: 800; text-transform: uppercase; letter-spacing: .04em; color: #f4f6fa; }
  .ip-daycol-date { font-family: var(--font-m, 'JetBrains Mono'), monospace; font-size: 10.5px; color: #8b95a5; font-weight: 600; text-transform: none; letter-spacing: 0; }
  .ip-daycol-empty { font-size: 11px; color: #3a4452; text-align: center; padding: 10px 0; }
  .ip-trip { background: #151a22; border: 1px solid #232a35; border-left: 3px solid #1D9E75; border-radius: 8px; padding: 6px 8px; display: flex; flex-direction: column; gap: 4px; min-width: 0; }
  .ip-trip-h { font-size: 10.5px; font-weight: 800; letter-spacing: .04em; text-transform: uppercase; color: #8b95a5; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .ip-stop { display: flex; align-items: center; gap: 6px; min-width: 0; }
  .ip-stop .ip-fam { font-size: 12px; flex: 1; }
  .ip-stop-n { font-family: var(--font-m, 'JetBrains Mono'), monospace; font-size: 10px; color: #6f7a8a; width: 14px; }
  .ip-x { font: inherit; font-size: 13px; background: none; border: 1px solid #2a313c; border-radius: 5px; color: #8b95a5; cursor: pointer; padding: 0 6px; line-height: 20px; }
  .ip-x:hover { color: #f87171; border-color: #5c2a2a; }
  .ip-foot { font-size: 11.5px; color: #6f7a8a; margin-top: 12px; }
`
