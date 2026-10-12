// =============================================================================
// WeekScheduleScreen — the SCHEDULE bottom tab (FIELD-SCHEDULE, 2026-10-12)
// =============================================================================
// Paul: "add calendar / schedule to the bottom tab options — a 5 day layout
// for installation / inscriptions / other stuff — and the inscription
// scheduler and installation scheduler buildable in the app. Same truth as
// desktop as always. When I click on Minsal I open the order and upload the
// photo for completion." Mockup approved 2026-10-12 (artifact
// TmeyseYw4PcZ3HHdjXy9gn): WEEK = five day tiles (green all-ready / red
// blocked) + the picked day's runs grouped by kind, every stop a tap into the
// job drill (JobDetail → Finish → photos → Mark installed). BUILD (owner +
// Admin) = the Install Planner / Inscription Scheduler in phone form: week
// list by cemetery, M T W T F under every stone, + Add sheet — the SAME
// writes as the desktop planner (lib/weekPlanning.js).
// =============================================================================
import { useState, useEffect, useCallback, useMemo } from 'react'
import { getBatches, getJobs, getInstallList, getHotListItems, getJob, rowBalanceDue, fmtUSD } from '../lib/stonebooksData'
import { composeGraveLocation } from '../lib/monumentCatalog'
import { isoOf, mondayOf, addDays, listWeekPlans, kindFromPlans, getWeekPlanWithItems, addPlanItem, removePlanItem } from '../lib/meetingData'
import { listInstallReminders, remindersFor } from '../lib/installReminders'
import { stopFacts, kindLabel } from '../lib/weekPrintSheet'
import { TRACKS, placeJobOnDay, unplaceJob, jobDoneForTrack, trackReady, trackGates, familyOf, cemNameOf } from '../lib/weekPlanning'
import { todayISO, directionsUrl } from './fieldShared'

const DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI']
const REAL_STATUSES = new Set(['contracted', 'in_production', 'paid_in_full'])
const KIND_GROUPS = [
  { code: 'installs', label: 'Installs', kinds: new Set(['setting', 'delivery']) },
  { code: 'inscriptions', label: 'Inscriptions', kinds: new Set(['inscription']) },
  { code: 'shop', label: 'Shop', kinds: new Set(['blasting', 'acid_wash', 'repair']) },
  { code: 'other', label: 'Other', kinds: null },   // everything else: foundations, pickups, doors…
]
const groupOfKind = (kind) => KIND_GROUPS.find(g => g.kinds && g.kinds.has(kind))?.code || 'other'
const KIND_TONE = { setting: '#1D9E75', delivery: '#1D9E75', inscription: '#534AB7', blasting: '#5F5E5A', acid_wash: '#5F5E5A', repair: '#D85A30', foundation_trip: '#D85A30', rub_grab: '#5F5E5A', door_trip: '#5F5E5A', pickup: '#B8842A', site_visit: '#B8842A', errand: '#B8842A', appointment: '#1D6FA8', meeting: '#6D28D9' }
const TAG_CLS = { new_stone: ['NS', 'fl-c-info'], bronze: ['BR', 'fl-c-photo'], inscription: ['INSC', 'fl-c-warn'], mausoleum_door: ['DOOR', 'fl-c-neutral'], cleaning_repair: ['REPAIR', 'fl-c-neutral'] }
const fmtShort = (iso) => new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
const dayNum = (iso) => String(Number(iso.slice(8, 10)))

export default function WeekScheduleScreen({ who, onOpenJob, onBack }) {
  const canBuild = !!who?.isOwner || who?.department === 'Admin'
  const [mode, setMode] = useState('week')          // 'week' | 'build'
  const [track, setTrack] = useState('set')         // build: 'set' | 'inscription'
  const [week, setWeek] = useState(() => isoOf(mondayOf()))
  const [todayIso] = useState(() => todayISO())
  const [pickedDay, setDay] = useState(() => todayISO())
  const [group, setGroup] = useState('all')
  const [jobs, setJobs] = useState(null)
  const [extra, setExtra] = useState({})
  const [batches, setBatches] = useState([])
  const [pastBatches, setPastBatches] = useState([])
  const [plans, setPlans] = useState([])
  const [plan, setPlan] = useState(null)
  const [setList, setSetList] = useState([])
  const [hot, setHot] = useState(new Set())
  const [rems, setRems] = useState({ byJob: new Map(), byCemetery: new Map() })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [addOpen, setAddOpen] = useState(false)
  const [addQ, setAddQ] = useState('')
  const [folded, setFolded] = useState(() => new Set())

  const cfg = TRACKS[track]
  const dayIsos = useMemo(() => [0, 1, 2, 3, 4].map(i => addDays(week, i)), [week])
  const satIso = addDays(week, 5)

  // The picked day always lives inside the viewed week (derived, no effect):
  // today when this is today's week, else Monday.
  const day = (pickedDay >= week && pickedDay <= satIso) ? pickedDay : (todayIso >= week && todayIso <= satIso ? todayIso : week)

  const load = useCallback(async () => {
    const [js, bs, old, ps, pl, sl, hotRows] = await Promise.all([
      getJobs({ limit: 2000 }).catch(() => []),
      getBatches({ from: week, to: addDays(week, 6) }).catch(() => []),
      getBatches({ from: addDays(week, -28), to: addDays(week, -1), kind: cfg.batchKind }).catch(() => []),
      listWeekPlans().catch(() => []),
      canBuild ? getWeekPlanWithItems(week).catch(() => null) : Promise.resolve(null),
      getInstallList().catch(() => []),
      getHotListItems().catch(() => []),
    ])
    const live = (bs || []).filter(b => b.status !== 'cancelled')
    // Stops whose job the open-jobs load doesn't carry (closed after the
    // install) — fetch so they read as done, never as a blank row.
    const have = new Set((js || []).map(j => j.id))
    const missing = [...new Set(live.flatMap(b => (b.batch_jobs || []).map(l => l.job_id)).filter(id => id && !have.has(id)))].slice(0, 40)
    const fetched = missing.length ? await Promise.all(missing.map(id => getJob(id).catch(() => null))) : []
    const ex = Object.fromEntries(fetched.filter(Boolean).map(j => [j.id, j]))
    setJobs(js || []); setExtra(ex)
    setBatches(live); setPastBatches(old || [])
    setPlans(ps || []); setPlan(pl?.ok ? pl : null)
    setSetList(sl || [])
    setHot(new Set((hotRows || []).flatMap(h => [h.job_id, h.order_id]).filter(Boolean)))
    const ids = [...new Set([...live.flatMap(b => (b.batch_jobs || []).map(l => l.job_id)), ...((pl?.items || []).map(it => it.job_id))].filter(Boolean))]
    const all = [...(js || []), ...Object.values(ex)]
    const cems = [...new Set(ids.map(id => { const j = all.find(x => x.id === id); return j?.cemetery?.id || j?.order?.cemetery?.id || j?.order?.cemetery_id }).filter(Boolean))]
    setRems(await listInstallReminders({ jobIds: ids, cemeteryIds: cems }).catch(() => ({ byJob: new Map(), byCemetery: new Map() })))
  }, [week, cfg.batchKind, canBuild])
  useEffect(() => { load() }, [load])  // eslint-disable-line react-hooks/set-state-in-effect
  // Live refresh when an install is marked done from the job drill.
  useEffect(() => {
    const h = () => load()
    window.addEventListener('sb-field-install-done', h)
    return () => window.removeEventListener('sb-field-install-done', h)
  }, [load])

  const jobById = useMemo(() => new Map([...Object.values(extra), ...(jobs || [])].map(j => [j.id, j])), [jobs, extra])
  const isHot = (job) => !!job && (hot.has(job.id) || (job.order?.id ? hot.has(job.order.id) : false))
  const remsOf = (job) => remindersFor(job, rems)
  const isDoneAny = (job) => {
    if (!job) return false
    if (['closed', 'cancelled'].includes(job.overall_status)) return true
    return job.job_type === 'inscription' ? jobDoneForTrack(job, TRACKS.inscription) : jobDoneForTrack(job, TRACKS.set)
  }
  const weekKind = week ? kindFromPlans(week, plans) : 'install'

  const run = async (fn) => {
    if (busy) return
    setBusy(true); setErr(null)
    const r = await fn()
    setBusy(false)
    if (r && r.ok === false) { setErr(r.error || 'That did not save.'); return }
    load()
  }

  // ── WEEK: stops per day, by run kind, read-only blockers ───────────────────
  // Plain per-render computation (a few hundred stops at most) — a memo over
  // mutated Maps is what the React Compiler refuses to preserve.
  const stopsByDay = new Map()
  for (const iso of [...dayIsos, satIso]) stopsByDay.set(iso, [])
  for (const b of batches) {
    if (!stopsByDay.has(b.scheduled_date)) continue
    const stops = (b.batch_jobs || []).slice().sort((x, y) => (x.stop_order || 0) - (y.stop_order || 0))
      .map(l => jobById.get(l.job_id)).filter(Boolean).filter(j => !isDoneAny(j))
      .map(j => ({ job: j, facts: stopFacts(j, b.kind, remsOf(j)) }))
    stopsByDay.get(b.scheduled_date).push({ batch: b, stops })
  }
  const dayTone = (iso) => {
    const trips = stopsByDay.get(iso) || []
    const stops = trips.flatMap(t => t.stops)
    if (!stops.length) return { n: 0, cls: '' }
    return { n: stops.length, cls: stops.some(s => !s.facts.ready) ? 'r' : 'g' }
  }
  const groupCounts = { all: 0 }
  for (const t of (stopsByDay.get(day) || [])) { const g = groupOfKind(t.batch.kind); groupCounts[g] = (groupCounts[g] || 0) + t.stops.length; groupCounts.all += t.stops.length }

  const renderWeek = () => {
    const trips = (stopsByDay.get(day) || []).filter(t => group === 'all' || groupOfKind(t.batch.kind) === group)
    const byKind = new Map()
    for (const t of trips) { const k = t.batch.kind; if (!byKind.has(k)) byKind.set(k, []); byKind.get(k).push(t) }
    const stopsToday = trips.flatMap(t => t.stops)
    const owes = stopsToday.filter(s => s.facts.blockers.some(b => b.startsWith('OWES'))).length
    const blocked = stopsToday.filter(s => !s.facts.ready).length
    return (
      <>
        <div className="fs-days">
          {[...dayIsos, ...(dayTone(satIso).n ? [satIso] : [])].map((iso, i) => {
            const t = dayTone(iso)
            return (
              <button type="button" key={iso} className={`fs-day${day === iso ? ' on' : ''}${iso === todayIso ? ' today' : ''}`} onClick={() => setDay(iso)}>
                <b>{i < 5 ? DAYS[i] : 'SAT'}</b><i>{dayNum(iso)}</i><span className={`fs-n ${t.cls}`}>{t.n}</span>
              </button>
            )
          })}
        </div>
        <div className="fl-filters">
          <button type="button" className={`fl-fchip${group === 'all' ? ' on' : ''}`} onClick={() => setGroup('all')}>All {groupCounts.all || 0}</button>
          {KIND_GROUPS.map(g => (groupCounts[g.code] || 0) > 0 && (
            <button type="button" key={g.code} className={`fl-fchip${group === g.code ? ' on' : ''}`} onClick={() => setGroup(g.code)}>{g.label} {groupCounts[g.code]}</button>
          ))}
        </div>
        {blocked > 0 && <div className="fs-strip amber">{blocked} of {stopsToday.length} blocked{owes ? ` · ${owes} still owe money` : ''}</div>}
        {jobs === null && <div className="fl-loading">Loading…</div>}
        {jobs !== null && trips.length === 0 && <div className="fl-empty-serif">Nothing scheduled {day === todayIso ? 'today' : `for ${fmtShort(day)}`}.</div>}
        {[...byKind.entries()].map(([kind, list]) => (
          <div key={kind}>
            <div className="fs-kind-h"><i style={{ background: KIND_TONE[kind] || '#8A8267' }} />{kindLabel(kind).toUpperCase()}<span className="fl-sect-pill">{list.reduce((s, t) => s + t.stops.length, 0)}</span></div>
            {list.map(({ batch, stops }) => {
              const dir = directionsUrl(batch.cemetery)
              return (
                <div key={batch.id} className="fs-trip">
                  <div className="fs-trip-h">
                    <b>{batch.cemetery?.name || batch.title || kindLabel(batch.kind)}</b>
                    <span>{[batch.am_pm ? batch.am_pm.toUpperCase() : null, batch.assigned_to, `${stops.length} stop${stops.length === 1 ? '' : 's'}`].filter(Boolean).join(' · ')}</span>
                  </div>
                  {stops.length === 0 && <div className="fs-stop-empty">{batch.notes || 'No stops left on this run.'}</div>}
                  {stops.map(({ job, facts }, i) => (
                    <button type="button" key={job.id} className="fs-stop" onClick={() => onOpenJob({ jobId: job.id, orderId: job.order?.id || null })}>
                      <span className="fs-no">{i + 1}</span>
                      <span className="fs-fam">{facts.family}{isHot(job) && <span className="fl-chip fl-c-lead" style={{ marginLeft: 6 }}>HOT</span>}
                        <small>{[facts.orderNo, facts.location, ...facts.notes].filter(Boolean).join(' · ') || ' '}</small>
                        {(facts.blockers.length > 0 || facts.reminders.length > 0) && (
                          <span className="fl-chips" style={{ marginTop: 4 }}>
                            {facts.blockers.map((b, k) => <span key={k} className="fl-chip fl-c-bad">{b}</span>)}
                            {facts.reminders.map((r, k) => <span key={'r' + k} className="fl-chip fl-c-warn">{r}</span>)}
                          </span>
                        )}
                      </span>
                      {TAG_CLS[job.job_type] && <span className={`fl-chip ${TAG_CLS[job.job_type][1]}`}>{TAG_CLS[job.job_type][0]}</span>}
                      {facts.ready && <span className="fl-chip fl-c-good">READY</span>}
                    </button>
                  ))}
                  {dir && <div className="fl-chips"><a className="fl-dirlink" href={dir} target="_blank" rel="noreferrer">Directions</a></div>}
                </div>
              )
            })}
          </div>
        ))}
      </>
    )
  }

  // ── BUILD: the planner on the phone (owner + Admin) ────────────────────────
  const weekItems = (plan?.items || []).filter(it => it.lane === cfg.lane && it.job_id && !jobDoneForTrack(jobById.get(it.job_id), cfg))
  const onWeek = new Set(weekItems.map(it => it.job_id))
  const trackBatches = batches.filter(b => b.kind === cfg.batchKind)
  const dayOfJob = new Map()
  for (const b of trackBatches) for (const l of (b.batch_jobs || [])) dayOfJob.set(l.job_id, b.scheduled_date)
  const doneNames = (plan?.items || []).filter(it => it.lane === cfg.lane && it.job_id && jobDoneForTrack(jobById.get(it.job_id), cfg)).map(it => familyOf(jobById.get(it.job_id))).filter(n => n && n !== '—')
  const pool = track === 'set'
    ? setList.map(m => jobById.get(m.job_id)).filter(Boolean)
    : (jobs || []).filter(j => j.job_type === 'inscription' && j.order && !j.order.archived && REAL_STATUSES.has(j.order.status) && !['closed', 'cancelled'].includes(j.overall_status))
  const ready = (job) => trackReady(job, cfg)
  const candidates = pool.filter(j => !onWeek.has(j.id) && !jobDoneForTrack(j, cfg))
    .filter(j => { const t = addQ.trim().toLowerCase(); return !t || [familyOf(j), cemNameOf(j), j.order?.order_number].filter(Boolean).join(' ').toLowerCase().includes(t) })
    .sort((a, b) => (ready(b) ? 1 : 0) - (ready(a) ? 1 : 0) || (isHot(b) ? 1 : 0) - (isHot(a) ? 1 : 0) || cemNameOf(a).localeCompare(cemNameOf(b)))
  const readyCount = candidates.filter(ready).length

  const addToWeek = (job) => run(() => addPlanItem({ planId: plan.plan.id, lane: cfg.lane, jobId: job.id, orderId: job.order?.id || null, title: familyOf(job) }))
  const addAllReady = () => run(async () => {
    for (const j of candidates.filter(ready)) { const r = await addPlanItem({ planId: plan.plan.id, lane: cfg.lane, jobId: j.id, orderId: j.order?.id || null, title: familyOf(j) }); if (!r.ok) return r }
    return { ok: true }
  })
  const removeFromWeek = (it) => run(async () => {
    const job = jobById.get(it.job_id)
    if (job && dayOfJob.has(job.id)) await unplaceJob({ track: cfg, job, batches: trackBatches, source: 'the phone' })
    return removePlanItem(it.id)
  })
  const place = (job, iso) => run(() => placeJobOnDay({ track: cfg, job, iso, batches: trackBatches, pastBatches, todayIso, source: `${cfg.title} (phone)` }))
  const unplace = (job) => run(() => unplaceJob({ track: cfg, job, batches: trackBatches, source: `${cfg.title} (phone)` }))

  const gateChips = (job) => {
    const g = trackGates(job, cfg)
    const bal = rowBalanceDue(job?.order || {})
    const out = []
    out.push([g.paid ? 'PAID' : bal > 0 ? `OWES ${fmtUSD(bal)}` : 'NOT PAID', g.paid ? 'fl-c-good' : 'fl-c-bad'])
    if (track === 'set') out.push(g.fdn === null ? ['NO FDN', 'fl-c-neutral'] : [g.fdnCode === 'drop_off' ? 'DROP OFF' : g.fdn ? 'FDN IN' : 'FDN NOT IN', g.fdn ? 'fl-c-good' : 'fl-c-bad'])
    out.push(g.permit === null ? ['NO PERMIT', 'fl-c-neutral'] : [g.permit ? 'PERMIT OK' : 'PERMIT', g.permit ? 'fl-c-good' : 'fl-c-bad'])
    if (track === 'set') out.push([job.job_type === 'bronze' ? (g.blasted ? 'ARRIVED' : 'NOT ARRIVED') : (g.blasted ? 'BLASTED' : 'NOT BLASTED'), g.blasted ? 'fl-c-good' : 'fl-c-bad'])
    if (track === 'inscription') out.push([g.cut ? 'CUT' : 'NOT CUT', g.cut ? 'fl-c-good' : 'fl-c-bad'])
    return out.map(([t, c], i) => <span key={i} className={`fl-chip ${c}`}>{t}</span>)
  }

  const renderBuildRow = (it) => {
    const job = jobById.get(it.job_id)
    if (!job) return null
    const d = dayOfJob.get(job.id)
    const rdy = ready(job)
    return (
      <div key={it.id} className={`fs-row${d ? ' sched' : ''}`}>
        <div className="fs-row-top">
          <button type="button" className="fs-fam-btn" onClick={() => onOpenJob({ jobId: job.id, orderId: job.order?.id || null })}>{familyOf(job)}</button>
          {isHot(job) && <span className="fl-chip fl-c-lead">HOT</span>}
          {TAG_CLS[job.job_type] && <span className={`fl-chip ${TAG_CLS[job.job_type][1]}`}>{TAG_CLS[job.job_type][0]}</span>}
          {rdy && <span className="fl-chip fl-c-good">READY</span>}
          <button type="button" className="fs-x" disabled={busy} title="Take off this week" onClick={() => removeFromWeek(it)}>×</button>
        </div>
        <div className="fl-spec">{[job.order?.order_number, composeGraveLocation(job.order || {})].filter(Boolean).join(' · ')}</div>
        {!rdy && <div className="fl-chips" style={{ marginTop: 4 }}>{gateChips(job)}</div>}
        <div className="fs-dbtns">
          {dayIsos.map((iso, i) => {
            const past = iso < todayIso && d !== iso
            return (
              <button type="button" key={iso} className={`fs-dbtn${d === iso ? ' on' : ''}${past ? ' past' : ''}`} disabled={busy || past}
                onClick={() => (d === iso ? unplace(job) : place(job, iso))}>{DAYS[i][0]}</button>
            )
          })}
        </div>
      </div>
    )
  }

  const renderBuild = () => {
    const groups = new Map()
    for (const it of weekItems) { const job = jobById.get(it.job_id); if (!job) continue; const k = cemNameOf(job) || 'No cemetery on file'; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(it) }
    const weekFinished = addDays(week, 4) < todayIso
    return (
      <>
        <div className="fs-seg"><button type="button" className={track === 'set' ? 'on set' : ''} onClick={() => setTrack('set')}>Installs</button><button type="button" className={track === 'inscription' ? 'on insc' : ''} onClick={() => setTrack('inscription')}>Inscriptions</button></div>
        {doneNames.length > 0 && <div className="fs-strip green">{track === 'set' ? 'Installed' : 'Completed'}, off the list: {doneNames.slice(0, 8).join(', ')}{doneNames.length > 8 ? ` +${doneNames.length - 8}` : ''}</div>}
        {weekFinished && <div className="fs-strip amber">This week is over — not-done {cfg.things} roll onto the next week when the desktop planner opens it.</div>}
        {!plan && jobs !== null && <div className="fl-empty-serif">Could not load this week's plan.</div>}
        {plan && weekItems.length === 0 && <div className="fl-empty-serif">Nothing on this week yet. Tap + Add.</div>}
        {[...groups.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([cem, items]) => {
          const n = items.filter(it => dayOfJob.has(it.job_id)).length
          const fold = folded.has(cem)
          return (
            <div key={cem}>
              <button type="button" className="fs-cem-h" onClick={() => setFolded(s => { const x = new Set(s); if (x.has(cem)) x.delete(cem); else x.add(cem); return x })}>
                <span>{cem}</span><span className={`fs-n ${n === items.length ? 'g' : n ? 'a' : ''}`}>{n}/{items.length}{n === items.length ? ' ✓' : ''}</span>
              </button>
              {!fold && items.map(renderBuildRow)}
            </div>
          )
        })}
        <div className="fs-verbs">
          <button type="button" className="fs-verb gold" disabled={!plan} onClick={() => { setAddOpen(true); setAddQ('') }}>{cfg.key === 'set' ? '+ ADD FROM SET LIST' : '+ ADD AN INSCRIPTION'}</button>
        </div>
        {addOpen && (
          <>
            <div className="fl-sheet-scrim" onClick={() => setAddOpen(false)} />
            <div className="fl-sheet">
              <div className="fl-sheet-grab" />
              <div className="fl-sheet-title">Add to the week of {fmtShort(week)}</div>
              <input className="fs-search" type="search" autoFocus placeholder="Search family, cemetery, order #" value={addQ} onChange={e => setAddQ(e.target.value)} />
              <div className="fl-sub" style={{ margin: '6px 0' }}>{candidates.length} {cfg.key === 'set' ? 'on the set list not on this week' : 'open inscriptions not on this week'} · {readyCount} ready</div>
              {readyCount > 0 && <button type="button" className="fs-verb go" disabled={busy} onClick={async () => { await addAllReady(); setAddOpen(false) }}>ADD ALL {readyCount} READY</button>}
              <div className="fs-sheet-list">
                {candidates.slice(0, 80).map(j => (
                  <div key={j.id} className="fs-row">
                    <div className="fs-row-top">
                      <span className="fs-fam-btn" style={{ cursor: 'default' }}>{familyOf(j)}</span>
                      {isHot(j) && <span className="fl-chip fl-c-lead">HOT</span>}
                      {TAG_CLS[j.job_type] && <span className={`fl-chip ${TAG_CLS[j.job_type][1]}`}>{TAG_CLS[j.job_type][0]}</span>}
                      <button type="button" className="fs-add" disabled={busy} onClick={() => addToWeek(j)}>+ ADD</button>
                    </div>
                    <div className="fl-spec">{[cemNameOf(j), j.order?.order_number].filter(Boolean).join(' · ')}</div>
                    <div className="fl-chips" style={{ marginTop: 4 }}>{ready(j) ? <span className="fl-chip fl-c-good">READY</span> : gateChips(j)}</div>
                  </div>
                ))}
                {candidates.length === 0 && <div className="fl-empty">{cfg.key === 'set' ? 'Everything on the set list is already on this week.' : 'Every open inscription is already on this week.'}</div>}
              </div>
            </div>
          </>
        )}
      </>
    )
  }

  return (
    <div className="fs">
      <style>{FS_CSS}</style>
      {onBack && <button type="button" className="fl-rowline" onClick={onBack} style={{ color: '#9A7209', fontWeight: 700, fontSize: 15, minHeight: 44 }}>&#8249; More</button>}
      <div className="fs-head">
        <div className="fl-greet">{mode === 'build' ? 'Build' : 'Schedule'}</div>
        <div className="fs-weeknav">
          <button type="button" className="fs-wbtn" onClick={() => setWeek(addDays(week, -7))} aria-label="Previous week">‹</button>
          <span className="fs-weekpill">WEEK OF {fmtShort(week).toUpperCase()} · {weekKind === 'install' ? 'A' : 'B'}</span>
          <button type="button" className="fs-wbtn" onClick={() => setWeek(addDays(week, 7))} aria-label="Next week">›</button>
        </div>
      </div>
      {canBuild && (
        <div className="fs-seg dark"><button type="button" className={mode === 'week' ? 'on' : ''} onClick={() => setMode('week')}>Week</button><button type="button" className={mode === 'build' ? 'on' : ''} onClick={() => setMode('build')}>Build</button></div>
      )}
      {err && <div className="fs-strip red">{err}</div>}
      {mode === 'build' && canBuild ? renderBuild() : renderWeek()}
    </div>
  )
}

const FS_CSS = `
  .fs-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; margin-bottom: 8px; }
  .fs-weeknav { display: flex; align-items: center; gap: 6px; }
  .fs-wbtn { background: #fff; border: 1px solid #DAD3C2; border-radius: 8px; font: 700 16px Inter, sans-serif; color: #16150F; width: 32px; height: 30px; cursor: pointer; }
  .fs-weekpill { font-family: "JetBrains Mono", Consolas, monospace; font-size: 10px; font-weight: 700; letter-spacing: .08em; color: #9A7209; border: 1px solid #C9A468; border-radius: 999px; padding: 3px 9px; white-space: nowrap; }
  .fs-seg { display: flex; background: #fff; border: 1px solid #DAD3C2; border-radius: 10px; padding: 3px; margin-bottom: 8px; }
  .fs-seg.dark { background: #EEEAE0; border: 0; }
  .fs-seg button { flex: 1; text-align: center; font: 700 11.5px Inter, sans-serif; color: #6B6456; padding: 7px; border-radius: 8px; background: none; border: 0; cursor: pointer; }
  .fs-seg button.on { background: #0F1419; color: #E8E2D4; }
  .fs-seg button.on.set { background: #1D9E75; color: #fff; } .fs-seg button.on.insc { background: #534AB7; color: #fff; }
  .fs-days { display: grid; grid-template-columns: repeat(auto-fit, minmax(52px, 1fr)); gap: 5px; margin-bottom: 8px; }
  .fs-day { background: #fff; border: 1px solid #E2DCCE; border-radius: 12px; padding: 7px 2px 6px; text-align: center; min-width: 0; font-family: inherit; cursor: pointer; }
  .fs-day b { display: block; font-size: 10px; letter-spacing: .08em; color: #6B6456; }
  .fs-day i { display: block; font: 400 10.5px "JetBrains Mono", Consolas, monospace; color: #8A8267; margin-top: 1px; }
  .fs-day.today b::after { content: " ·"; color: #9A7209; }
  .fs-n { display: inline-block; margin-top: 5px; font: 700 12px "JetBrains Mono", Consolas, monospace; border-radius: 999px; padding: 1px 8px; background: #EEEAE0; color: #6B6456; }
  .fs-n.g { background: rgba(29,158,117,0.16); color: #14775A; } .fs-n.r { background: rgba(179,38,30,0.12); color: #B3261E; } .fs-n.a { background: rgba(184,132,42,0.16); color: #8A5A12; }
  .fs-day.on { border-color: #0F1419; background: #0F1419; } .fs-day.on b, .fs-day.on i { color: #B9AE94; } .fs-day.on .fs-n { background: #C9A468; color: #0F1419; }
  .fs-strip { font-size: 11.5px; font-weight: 700; border-radius: 10px; padding: 8px 10px; margin-bottom: 8px; overflow-wrap: anywhere; }
  .fs-strip.amber { background: #FBF1D6; color: #8A5A12; } .fs-strip.green { background: #E3F4EC; color: #14775A; } .fs-strip.red { background: rgba(179,38,30,0.10); color: #B3261E; }
  .fs-kind-h { display: flex; align-items: center; gap: 7px; font-size: 10px; font-weight: 800; letter-spacing: .09em; color: #6B6456; margin: 10px 0 6px; }
  .fs-kind-h i { width: 8px; height: 8px; border-radius: 2px; display: inline-block; }
  .fs-trip { background: #fff; border: 1px solid #E2DCCE; border-radius: 14px; padding: 10px 12px; margin-bottom: 8px; }
  .fs-trip-h { display: flex; justify-content: space-between; align-items: baseline; gap: 6px; min-width: 0; }
  .fs-trip-h b { font-size: 13.5px; font-weight: 800; overflow-wrap: anywhere; }
  .fs-trip-h span { font: 400 10.5px "JetBrains Mono", Consolas, monospace; color: #7C7562; white-space: nowrap; }
  .fs-stop { display: flex; align-items: flex-start; gap: 8px; width: 100%; text-align: left; padding: 8px 0; border: 0; border-top: 1px solid #F0ECE3; background: none; font-family: inherit; cursor: pointer; min-width: 0; }
  .fs-stop-empty { font-size: 12px; color: #8A8267; padding: 6px 0; font-style: italic; }
  .fs-no { font: 700 10px "JetBrains Mono", Consolas, monospace; color: #8A8267; width: 12px; padding-top: 3px; flex: none; }
  .fs-fam { flex: 1; min-width: 0; font-size: 14.5px; font-weight: 800; color: #16150F; overflow-wrap: anywhere; }
  .fs-fam small { display: block; font: 400 10px "JetBrains Mono", Consolas, monospace; color: #7C7562; overflow-wrap: anywhere; }
  .fs-cem-h { display: flex; justify-content: space-between; align-items: center; width: 100%; font-size: 10px; font-weight: 800; letter-spacing: .09em; color: #16150F; border: 0; border-bottom: 1px solid #E2DCCE; background: none; padding: 6px 2px; margin-top: 4px; font-family: inherit; cursor: pointer; text-transform: uppercase; }
  .fs-row { background: #fff; border: 1px solid #E2DCCE; border-radius: 12px; padding: 8px 10px; margin: 6px 0; }
  .fs-row.sched { opacity: .66; background: #F3F8F5; }
  .fs-row-top { display: flex; align-items: center; gap: 6px; min-width: 0; flex-wrap: wrap; }
  .fs-fam-btn { flex: 1; min-width: 0; font-size: 13.5px; font-weight: 800; color: #16150F; background: none; border: 0; padding: 0; text-align: left; font-family: inherit; cursor: pointer; overflow-wrap: anywhere; }
  .fs-x { background: none; border: 0; font-size: 18px; color: #B9B29E; cursor: pointer; padding: 0 4px; line-height: 1; }
  .fs-dbtns { display: flex; gap: 4px; margin-top: 7px; }
  .fs-dbtn { flex: 1; text-align: center; font: 700 12px "JetBrains Mono", Consolas, monospace; border: 1px solid #DAD3C2; border-radius: 8px; padding: 9px 0; color: #6B6456; background: #fff; cursor: pointer; min-height: 38px; }
  .fs-dbtn.on { background: #0F1419; color: #C9A468; border-color: #0F1419; } .fs-dbtn.past { color: #C5BFAE; text-decoration: line-through; }
  .fs-verbs { display: flex; gap: 6px; margin-top: 10px; }
  .fs-verb { flex: 1; text-align: center; font: 800 11.5px Inter, sans-serif; letter-spacing: .04em; border-radius: 10px; padding: 11px 6px; border: 1px solid #DAD3C2; background: #fff; color: #16150F; cursor: pointer; min-height: 44px; }
  .fs-verb.go { background: #1D9E75; color: #fff; border-color: #1D9E75; } .fs-verb.gold { background: #9A7209; color: #fff; border-color: #9A7209; }
  .fs-verb:disabled { opacity: .5; }
  .fs-add { font: 800 10px Inter, sans-serif; letter-spacing: .06em; border-radius: 999px; padding: 5px 10px; background: #EEEAE0; color: #16150F; border: 0; cursor: pointer; }
  .fs-search { width: 100%; box-sizing: border-box; background: #fff; border: 1px solid #DAD3C2; border-radius: 10px; padding: 9px 10px; font: 400 14px Inter, sans-serif; margin-top: 6px; }
  .fs-sheet-list { overflow-y: auto; max-height: 52vh; margin-top: 4px; }
`
