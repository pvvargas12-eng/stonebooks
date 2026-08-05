// =============================================================================
// InstallBoard — Installation hub: readiness-gated install board (Phase 1, read-only)
// =============================================================================
// Five gates decide "Ready to set". A card is ready only when ALL applicable gates
// are green. Scoped to stone-DONE jobs (the stone is physically finished and ready
// to leave the shop) — a stone still in production stays on the Production floor,
// not here. Dark .jobcc-* command-center style.
//
//   1. Stone done   — job_components: all at the track's STRICT terminal phase, none
//                     held at QC. new_stone→ready_to_set · bronze→mounted_on_base(+) ·
//                     inscription→inscription_complete · door→drop_off_doors.
//   2. Foundation   — deriveFdnStatus(job)==='in'. N/A (dash) for inscription + door.
//   3. Paid in full — rowBalanceDue(order)===0 (read-only).
//   4. Cemetery set — order.cemetery_id present.
//   5. Permit ok    — order.permit_status ∈ {approved, not_required} (or not needed).
// =============================================================================
import { useState, useEffect, useMemo, useCallback } from 'react'
import { getProductionComponents, deriveFdnStatus, rowBalanceDue, permitNeeded,
  updateMilestoneWithOverride, ensureCloseoutTask, logOrderActivity, getCurrentStaffName, todayISO,
  getInstallList, addToInstallList, removeFromInstallList, fmtUSD, installGates,
  addOrderTask, STAFF_NAMES, getActiveStaffUser } from '../lib/stonebooksData'
import { DEPARTMENTS } from '../lib/employees'
import { composeGraveLocation } from '../lib/monumentCatalog'
import { TRACK_LABEL, phaseIndex } from '../lib/jobComponents'
import { JOBCC_BASE_CSS } from './jobccBase'
import CompletionPhotoUploader from './CompletionPhotoUploader'

// Track's STRICT terminal phase for "stone done" (decision-locked).
const TERMINAL = { new_stone: 'ready_to_set', bronze: 'mounted_on_base', inscription: 'inscription_complete', door: 'drop_off_doors' }
const FDN_TRACKS = new Set(['new_stone', 'bronze'])   // inscription + door need no foundation
// new_stone reads BLUE (Paul 2026-08-04: "new stone instead of green make
// that blue") — green is reserved for the READY TO INSTALL label.
const TRACK_TONE = { new_stone: 'blue', inscription: 'amber', bronze: 'purple', door: 'blue' }
const GATE_DEFS = [
  { key: 'stone', label: 'Stone' }, { key: 'fdn', label: 'Fdn' }, { key: 'paid', label: 'Paid' },
  { key: 'cem', label: 'Cemetery' }, { key: 'permit', label: 'Permit' },
]
const installMilestone = (job) => {
  const by = new Map((job.milestones || []).map(m => [m.milestone_key, m]))
  return by.get('installed') || by.get('door_installed') || by.get('work_completed') || null
}

export default function InstallBoard({ jobs, onOpenJob, onOpenOrderDetail }) {
  const [components, setComponents] = useState(null)
  const [monthKey, setMonthKey] = useState('')
  // Paul 2026-07-27: "i must be able to add to installation list from my orders
  // / leads… if i add to this list then that means its blasted so dont worry
  // even if it says stone not ordered yet." The hand-picked SET LIST is the
  // default view — gates inform, they never keep a stone off his list.
  const [activeKpi, setActiveKpi] = useState('setlist')
  const [setList, setSetList] = useState(null)     // install_list rows
  const [addOpen, setAddOpen] = useState(false)
  const [addQ, setAddQ] = useState('')
  const [listBusy, setListBusy] = useState(null)   // job id mid-write
  const [todayMs, setTodayMs] = useState(0)        // stamped at load — order-age chips
  // Set-list sort (Paul 2026-08-04): cemetery | ready | foundation | balance | oldest
  const [listSort, setListSort] = useState('cemetery')
  // Action state — schedule date modal + the confirm→photo→finalize install chain.
  const [scheduleRow, setScheduleRow] = useState(null)
  const [scheduleDate, setScheduleDate] = useState('')
  const [busy, setBusy] = useState(false)
  const [installRow, setInstallRow] = useState(null)
  const [installStep, setInstallStep] = useState(null)   // 'confirm' | 'photo'

  const load = useCallback(async () => {
    const [d, l] = await Promise.all([
      getProductionComponents(),
      getInstallList().catch(() => []),
    ])
    setComponents(d || [])
    setSetList(l || [])
    const now = new Date(); setMonthKey(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`)
    setTodayMs(now.getTime())
  }, [])
  useEffect(() => { load() }, [load])  // eslint-disable-line react-hooks/set-state-in-effect

  // Index components by job_id → track + phases + cemetery/order context.
  const byJob = useMemo(() => {
    const m = new Map()
    for (const c of (components || [])) {
      if (!c.job_id) continue
      if (!m.has(c.job_id)) m.set(c.job_id, {
        track: c.track, comps: [],
        cemetery: c.order?.cemetery?.name || c.cemetery_order?.cemetery_name || '',
        orderNumber: c.order?.order_number || c.cemetery_order?.order_number || '',
      })
      m.get(c.job_id).comps.push(c)
    }
    return m
  }, [components])

  // Per-job gate evaluation. Only stone-DONE jobs surface (the rest are production).
  const buckets = useMemo(() => {
    const out = { ready: [], scheduled: [], blocked: [], foundationNeeded: [], doneThisMonth: [] }
    if (components == null) return out
    for (const job of (jobs || [])) {
      const ci = byJob.get(job.id)
      if (!ci) continue
      const track = ci.track
      const order = job.order || {}
      // Gate 1 — strict terminal, no QC hold.
      const termIdx = phaseIndex(track, TERMINAL[track])
      const stoneDone = ci.comps.length > 0 && ci.comps.every(c => !c.qc_issue && phaseIndex(track, c.current_phase) >= termIdx && termIdx >= 0)
      const ms = installMilestone(job)
      const installKey = ms?.milestone_key || null
      const installed = ms?.status === 'done'
      if (installed) {
        if (ms?.status_date && String(ms.status_date).slice(0, 7) === monthKey) {
          out.doneThisMonth.push(makeRow(job, ci, order, { installed: true, installKey }))
        }
        continue
      }
      if (!stoneDone) continue   // still in production — not an install concern
      // Gates 2–5.
      const needsFdn = FDN_TRACKS.has(track)
      const fdn = needsFdn ? (deriveFdnStatus(job) === 'in') : null   // null = N/A
      const paid = rowBalanceDue(order) === 0
      const cem = !!order.cemetery_id
      const permit = order.permit_status === 'approved' || order.permit_status === 'not_required' || !permitNeeded(order)
      const gates = { stone: true, fdn, paid, cem, permit }
      const unmet = []
      if (fdn === false) unmet.push('foundation')
      if (!paid) unmet.push('balance')
      if (!cem) unmet.push('cemetery')
      if (!permit) unmet.push('permit')
      const scheduled = ms?.status === 'in_progress'
      const row = makeRow(job, ci, order, { gates, unmet, scheduled, installKey, scheduledDate: scheduled ? (ms?.due_date || null) : null })
      if (needsFdn && fdn === false) out.foundationNeeded.push(row)
      if (scheduled) out.scheduled.push(row)
      else if (unmet.length === 0) out.ready.push(row)
      else out.blocked.push(row)
    }
    return out
  }, [components, jobs, byJob, monthKey])

  // ── The hand-picked SET LIST ───────────────────────────────────────────────
  // Membership only (install_list). NO readiness gate — adding a stone IS Paul
  // saying it's blasted and ready to schedule. Blockers are shown, never
  // enforced; foundation is the one he actually acts on.
  const memberIds = useMemo(() => new Set((setList || []).map(r => r.job_id)), [setList])
  const blockersFor = useCallback((job) => {
    const order = job.order || {}
    const ci = byJob.get(job.id)
    const track = ci?.track || null
    const needsFdn = track ? FDN_TRACKS.has(track) : true
    const fdnCode = deriveFdnStatus(job)
    const fdn = needsFdn && fdnCode !== 'na' ? (fdnCode === 'in') : null
    const bal = rowBalanceDue(order)
    const permit = order.permit_status === 'approved' || order.permit_status === 'not_required' || !permitNeeded(order)
    return { fdn, fdnCode, balance: bal, cem: !!order.cemetery_id, permit }
  }, [byJob])

  const setListRows = useMemo(() => {
    if (!setList || !jobs) return []
    const byId = new Map((jobs || []).map(j => [j.id, j]))
    const out = []
    for (const m of setList) {
      const job = byId.get(m.job_id)
      if (!job) continue
      const ms = installMilestone(job)
      if (ms?.status === 'done') continue            // installed — it's off the list
      const ci = byJob.get(job.id) || { track: null, cemetery: job.order?.cemetery?.name || '', orderNumber: job.order?.order_number || '' }
      out.push(makeRow(job, ci, job.order || {}, {
        blockers: blockersFor(job),
        gates4: installGates(job.order || {}, job),
        installKey: ms?.milestone_key || null,
        scheduled: ms?.status === 'in_progress',
        scheduledDate: ms?.status === 'in_progress' ? (ms?.due_date || null) : null,
        onList: true,
      }))
    }
    return out
  }, [setList, jobs, byJob, blockersFor])

  // Add picker: EVERY open job — contracted, lead, draft, stone not ordered.
  // Paul overrides; the picker only reports what's missing.
  const addCandidates = useMemo(() => {
    if (!jobs) return []
    const t = addQ.trim().toLowerCase()
    const pool = jobs.filter(j => {
      if (memberIds.has(j.id)) return false
      const ms = installMilestone(j)
      if (ms?.status === 'done') return false
      const o = j.order || {}
      if (o.archived || o.status === 'closed' || o.status === 'cancelled') return false
      return true
    })
    // Search EVERYTHING the rows can display — deceased family AND the
    // customer's name (the visible fallback when no deceased is entered):
    // a name you can SEE is a name you can TYPE (Paul 2026-08-04).
    const hit = t
      ? pool.filter(j => [j.order?.primary_lastname, j.customer?.first_name, j.customer?.last_name,
        j.order?.order_number, j.order?.cemetery?.name]
        .filter(Boolean).join(' ').toLowerCase().includes(t))
      : pool
    return hit.slice(0, t ? 40 : 25)
  }, [jobs, memberIds, addQ])

  const addToList = async (jobId) => {
    if (listBusy) return
    setListBusy(jobId)
    await addToInstallList(jobId).catch(() => {})
    setListBusy(null)
    setAddQ('')
    load()
  }
  const removeFromList = async (jobId) => {
    if (listBusy) return
    setListBusy(jobId)
    await removeFromInstallList(jobId).catch(() => {})
    setListBusy(null)
    load()
  }

  // ── Actions (reuse existing milestone + task + photo systems) ───────────────
  const openSchedule = (row) => { setScheduleDate(todayISO()); setScheduleRow(row) }
  const doSchedule = async () => {
    if (!scheduleRow || !scheduleDate || busy) return
    if (!scheduleRow.installKey) { window.alert('This job has no install milestone to schedule — open the job and check its checklist.'); return }
    setBusy(true)
    const actor = await getCurrentStaffName()
    // OVERRIDE, not the plain write: the readiness gate blocks advancing a
    // milestone whose upstream steps are open — which is EVERY set-list stone
    // (Paul's list IS the override). The plain call returned blocked and the
    // result was ignored — the "nothing happens" bug (2026-08-04).
    const r = await updateMilestoneWithOverride(scheduleRow.jobId, scheduleRow.installKey,
      { status: 'in_progress', dueDate: scheduleDate }, 'Scheduled from the set list')
    if (r?.ok === false) { window.alert(r.error || 'Could not schedule the install.'); setBusy(false); return }
    await logOrderActivity(scheduleRow.orderId, { type: 'change', field: 'Install', newValue: 'Scheduled', note: `Install scheduled for ${scheduleDate}`, actor })
    setBusy(false); setScheduleRow(null); setScheduleDate('')
    load()
  }
  const openInstall = (row) => { setInstallRow(row); setInstallStep('confirm') }
  // Commit on the EXPLICIT confirm (the gate), then collect the photo. The uploader
  // closes on a backdrop tap too, so committing here — not on its close — avoids a
  // stray-tap install.
  const confirmInstall = async () => {
    if (!installRow || busy) return
    setBusy(true)
    const r = installRow
    const actor = await getCurrentStaffName()
    // Same override rule as doSchedule — the readiness gate must never block
    // Paul's explicit "it's in the ground" click.
    if (r.installKey) {
      const res = await updateMilestoneWithOverride(r.jobId, r.installKey, { status: 'done' }, 'Marked installed from the set list')
      if (res?.ok === false) { window.alert(res.error || 'Could not mark it installed.'); setBusy(false); return }
    }
    // Shared closeout auto-task (dedup-checked, dept Admin, task_type 'closeout'
    // → unlocks the one-button completion email in the task row).
    await ensureCloseoutTask(r.orderId, r.family, r.orderNumber)
    await logOrderActivity(r.orderId, { type: 'change', field: 'Install', newValue: 'Installed', note: 'Marked installed; closeout task created', actor })
    setBusy(false)
    setInstallStep('photo')   // installed — now add the photo (uploads to the order)
  }
  const onPhotoUploaded = async () => {
    if (!installRow) return
    const actor = await getCurrentStaffName()
    logOrderActivity(installRow.orderId, { type: 'change', field: 'Install photo', newValue: 'uploaded', note: 'Install photo uploaded', actor }).catch(() => {})
  }
  const closePhoto = () => { setInstallRow(null); setInstallStep(null); load() }

  const loading = components == null
  // EVERY tile reads the SET LIST through the four-gate engine (Paul
  // 2026-08-04: "paid dropoff fdn in blasted its ready to set!!!") — the old
  // derived five-gate buckets are out of the tiles; one engine, no disagreement.
  const rowReady = (r) => !r.installed && !!r.gates4
    && r.gates4.paid !== false && r.gates4.fdn !== false
    && r.gates4.permit !== false && r.gates4.blasted !== false
  const rowAge = (r) => (r.signedAt && todayMs ? Math.floor((todayMs - Date.parse(r.signedAt)) / 86400000) : null)
  const slReady = setListRows.filter(rowReady)
  const slScheduled = setListRows.filter(r => r.scheduled)
  const slBlocked = setListRows.filter(r => !r.installed && r.gates4 && !rowReady(r))
  const slFdn = setListRows.filter(r => r.gates4?.fdn === false)
  const kpis = [
    { key: 'setlist', label: 'My set list', tone: 'gold', value: setListRows.length, sub: slFdn.length > 0 ? `${slFdn.length} waiting on foundation` : 'hand-picked to schedule' },
    { key: 'ready', label: 'Ready to set', tone: 'green', value: slReady.length, sub: 'paid · foundation · permit · blasted' },
    { key: 'scheduled', label: 'Scheduled', tone: 'purple', value: slScheduled.length, sub: 'install date set' },
    { key: 'blocked', label: 'Blocked', tone: 'red', value: slBlocked.length, sub: 'a gate reads red' },
    { key: 'foundation', label: 'Foundation needed', tone: 'amber', value: slFdn.length, sub: 'pour not in' },
    { key: 'done', label: 'Done this month', tone: 'green', value: buckets.doneThisMonth.length, sub: 'installed' },
  ]
  // The chips FILTER, not just reorder (Paul 2026-08-04: "when i select
  // [balance owed] i only want to see things with a balance owed so i can
  // action those and have someone call"). By cemetery / Oldest show the
  // whole list; the other three show ONLY their rows.
  const byAgeDesc = (a, b) => (rowAge(b) ?? 0) - (rowAge(a) ?? 0)
  const listSorted = (() => {
    let flat = [...setListRows]
    if (listSort === 'ready') flat = flat.filter(rowReady).sort(byAgeDesc)
    else if (listSort === 'foundation') flat = flat.filter(r => r.gates4?.fdn === false).sort(byAgeDesc)
    else if (listSort === 'balance') flat = flat.filter(r => (r.blockers?.balance || 0) > 0).sort((a, b) => (b.blockers?.balance || 0) - (a.blockers?.balance || 0))
    else if (listSort === 'oldest') flat.sort(byAgeDesc)
    return flat
  })()
  const sectionRows = {
    setlist: listSorted,
    ready: [...slReady].sort(byAgeDesc), scheduled: slScheduled,
    blocked: [...slBlocked].sort(byAgeDesc), foundation: [...slFdn].sort(byAgeDesc),
    done: buckets.doneThisMonth,
  }[activeKpi] || setListRows
  const sectionLabel = kpis.find(k => k.key === activeKpi)?.label || ''
  const onSetList = activeKpi === 'setlist'
  const groupByCem = activeKpi === 'done' ? false : onSetList ? listSort === 'cemetery' : false
  const canAct = activeKpi !== 'done'
  const cardProps = {
    onOpenJob, onOpenOrderDetail, canAct, onSchedule: openSchedule, onMarkInstalled: openInstall,
    onRemove: activeKpi !== 'done' ? removeFromList : null, listBusy, todayMs,
  }

  return (
    <div className="jobcc ib">
      <style>{JOBCC_BASE_CSS}{IB_CSS}</style>
      <header className="jobcc-cmd">
        <div className="jobcc-cmd-left">
          <h1 className="jobcc-title">Installation</h1>
          <div className="jobcc-purpose">Your set list, four gates on every card — paid · foundation · permit · blasted. READY TO INSTALL means nothing would strand the truck. Every tile is a slice of the same list.</div>
        </div>
        <div className="jobcc-cmd-right"><div className="jobcc-actions"><button type="button" className="jobcc-btn" onClick={load}>Refresh</button></div></div>
      </header>

      <div className="jobcc-kpis">
        {kpis.map(k => (
          <button type="button" key={k.key} className={`jobcc-kpi jobcc-kpi-${k.tone} ${activeKpi === k.key ? 'jobcc-kpi-on' : ''}`} onClick={() => setActiveKpi(k.key)}>
            <div className="jobcc-kpi-label">{k.label}</div>
            <div className="jobcc-kpi-value">{loading ? '—' : k.value}</div>
            <div className="jobcc-kpi-sub">{k.sub}</div>
          </button>
        ))}
      </div>

      <section className="jobcc-panel">
        <div className="jobcc-panel-head">
          <span className="jobcc-panel-title">{sectionLabel}</span>
          <span className="jobcc-panel-count">{loading ? '—' : sectionRows.length}</span>
          {onSetList && (
            <button type="button" className="jobcc-btn ib-btn-go" style={{ marginLeft: 'auto' }}
              onClick={() => { setAddOpen(true); setAddQ('') }}>+ Add to list</button>
          )}
        </div>
        {onSetList && (
          <div className="ib-listhint">
            Your list, your call — anything you add is treated as ready to schedule regardless of what the stone status says.
            Blockers below are information only; <strong>foundation</strong> is the one worth chasing.
          </div>
        )}
        {onSetList && (
          <div className="ib-sortrow">
            <span className="ib-sortlab">Sort</span>
            {[['cemetery', 'By cemetery'], ['ready', 'Ready first'], ['foundation', 'Waiting on foundation'], ['balance', 'Balance owed'], ['oldest', 'Oldest first']].map(([c, lab]) => (
              <button key={c} type="button" className={`ib-sortchip${listSort === c ? ' on' : ''}`} onClick={() => setListSort(c)}>{lab}</button>
            ))}
          </div>
        )}
        {loading ? <div className="jobcc-empty">Loading…</div>
          : sectionRows.length === 0 ? (
            onSetList
              ? <div className="jobcc-empty">Nothing on the set list yet — <strong>+ Add to list</strong> pulls from any order or lead.</div>
              : <div className="jobcc-empty jobcc-empty-ok">✓ Nothing here.</div>
          )
          : groupByCem ? groupByCemetery(sectionRows).map(([cem, rows]) => (
            <div key={cem} className="ib-group">
              <div className="ib-group-head">{cem || 'Cemetery not set'} <span className="ib-group-n">{rows.length}</span></div>
              <div className="ib-cards">{rows.map(r => <InstallCard key={r.jobId} row={r} {...cardProps} />)}</div>
            </div>
          ))
          : <div className="ib-cards">{sectionRows.map(r => <InstallCard key={r.jobId} row={r} {...cardProps} />)}</div>}
      </section>

      {/* + Add to list — EVERY open order/lead, no readiness filter. Paul picks;
          the rows just report what's missing so nothing surprises him later. */}
      {addOpen && (
        <div className="ib-modal-overlay" onClick={() => setAddOpen(false)}>
          <div className="ib-modal ib-modal-wide" onClick={e => e.stopPropagation()}>
            <div className="ib-modal-title">Add to the set list</div>
            <div className="ib-modal-body">
              Any order or lead — stone status is ignored on purpose. What shows on each row is
              what's still open, foundation first.
            </div>
            <input className="ib-modal-input" type="search" autoFocus placeholder="Search family, order #, cemetery…"
              value={addQ} onChange={e => setAddQ(e.target.value)} />
            <div className="ib-addlist">
              {addCandidates.map(j => {
                const bl = blockersFor(j)
                const o = j.order || {}
                return (
                  <div key={j.id} className="ib-addrow">
                    <div className="ib-addmain">
                      <span className="ib-addfam">{o.primary_lastname || j.customer?.last_name
                        || [j.customer?.first_name, j.customer?.last_name].filter(Boolean).join(' ') || '—'}</span>
                      <span className="ib-addmeta">{[o.order_number, o.cemetery?.name, o.status].filter(Boolean).join(' · ')}</span>
                    </div>
                    <span className="ib-addflags">
                      {bl.fdn === false && <span className="ib-flag ib-flag-red">FDN NOT IN</span>}
                      {bl.fdn === true && <span className="ib-flag ib-flag-ok">FDN IN</span>}
                      {bl.balance > 0 && <span className="ib-flag ib-flag-amber">BAL {fmtUSD(bl.balance)}</span>}
                    </span>
                    <button type="button" className="ib-act ib-act-go" disabled={listBusy === j.id}
                      onClick={() => addToList(j.id)}>{listBusy === j.id ? '…' : 'Add'}</button>
                  </div>
                )
              })}
              {addCandidates.length === 0 && <div className="jobcc-empty">Nothing matches — everything else is already on the list.</div>}
            </div>
            <div className="ib-modal-actions">
              <button type="button" className="jobcc-btn" onClick={() => setAddOpen(false)}>Done</button>
            </div>
          </div>
        </div>
      )}

      {/* Schedule-install date modal */}
      {scheduleRow && (
        <div className="ib-modal-overlay" onClick={() => !busy && setScheduleRow(null)}>
          <div className="ib-modal" onClick={e => e.stopPropagation()}>
            <div className="ib-modal-title">Schedule install — {scheduleRow.family}</div>
            <div className="ib-modal-body">Pick the planned install date. This sets the install milestone to in&#8209;progress and feeds the Scheduled count.</div>
            <input type="date" className="ib-modal-input" value={scheduleDate} onChange={e => setScheduleDate(e.target.value)} />
            <div className="ib-modal-actions">
              <button type="button" className="jobcc-btn" onClick={() => setScheduleRow(null)} disabled={busy}>Cancel</button>
              <button type="button" className="jobcc-btn ib-btn-go" onClick={doSchedule} disabled={busy || !scheduleDate}>{busy ? 'Saving…' : 'Schedule'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Mark-installed confirm (the gate — confirming flips the milestone) */}
      {installRow && installStep === 'confirm' && (
        <div className="ib-modal-overlay" onClick={() => !busy && (setInstallRow(null), setInstallStep(null))}>
          <div className="ib-modal" onClick={e => e.stopPropagation()}>
            <div className="ib-modal-title">Mark {installRow.family}'s monument installed?</div>
            <div className="ib-modal-body">This flips the job to <strong>installed</strong> and creates the admin closeout task — a stone in the ground is hard to undo. You'll add the install photo from your phone right after.</div>
            <div className="ib-modal-actions">
              <button type="button" className="jobcc-btn" onClick={() => { setInstallRow(null); setInstallStep(null) }} disabled={busy}>Cancel</button>
              <button type="button" className="jobcc-btn ib-btn-go" onClick={confirmInstall} disabled={busy}>{busy ? 'Installing…' : 'Confirm & mark installed'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Mark-installed step 2 — REUSE CompletionPhotoUploader verbatim (mobile camera).
          Already committed on confirm; closing just finishes the photo step. */}
      {installRow && installStep === 'photo' && (
        <CompletionPhotoUploader
          orderId={installRow.orderId}
          label={`Install photo — ${installRow.family}`}
          onUploaded={onPhotoUploaded}
          onClose={closePhoto}
        />
      )}
    </div>
  )
}

function makeRow(job, ci, order, extra) {
  return {
    jobId: job.id, orderId: order.id || null,
    // Deceased name first; orders with no deceased entered fall back to the
    // CUSTOMER's name so the card never reads "—" (the Fiechter case,
    // 2026-08-04 — findable by the name Paul actually calls the job).
    family: order.primary_lastname || job.customer?.last_name
      || [job.customer?.first_name, job.customer?.last_name].filter(Boolean).join(' ') || '—',
    signedAt: order.signed_at || order.created_at || null,
    orderNumber: ci.orderNumber || order.order_number || '',
    track: ci.track, cemetery: ci.cemetery || '',
    grave: composeGraveLocation(order) || '',
    ...extra,
  }
}
function groupByCemetery(rows) {
  const m = new Map()
  for (const r of rows) { const k = r.cemetery || ''; if (!m.has(k)) m.set(k, []); m.get(k).push(r) }
  return [...m.entries()].sort((a, b) => (a[0] || '~').localeCompare(b[0] || '~'))
}

function InstallCard({ row, onOpenJob, onOpenOrderDetail, canAct, onSchedule, onMarkInstalled, onRemove = null, listBusy = null, todayMs = 0 }) {
  const tone = TRACK_TONE[row.track] || 'neutral'
  const b = row.blockers
  // Task-a-call popover (Paul 2026-08-04: "a button next to remove to add
  // task... it would task someone to call customer for balance").
  const [taskOpen, setTaskOpen] = useState(false)
  const [taskWho, setTaskWho] = useState('')
  const [taskNote, setTaskNote] = useState('')
  const [taskDue, setTaskDue] = useState('')
  const [taskBusy, setTaskBusy] = useState(false)
  const [taskDone, setTaskDone] = useState(false)
  const openTasker = () => {
    const bal = b?.balance || 0
    setTaskWho(getActiveStaffUser() || 'Admin')
    setTaskNote(`Call ${row.family} — ${bal > 0 ? `balance ${fmtUSD(bal)}` : 'installation'}${row.orderNumber ? ` (${row.orderNumber})` : ''}`)
    setTaskDue(''); setTaskDone(false); setTaskOpen(true)
  }
  const sendTask = async () => {
    if (!row.orderId || !taskNote.trim() || taskBusy) return
    setTaskBusy(true)
    const actor = await getCurrentStaffName().catch(() => null)
    const r = await addOrderTask(row.orderId, {
      note: taskNote.trim(), assignee: taskWho,
      assigneeKind: DEPARTMENTS.includes(taskWho) ? 'department' : 'person',
      dueDate: taskDue || todayISO(), actor,
    })
    setTaskBusy(false)
    if (r?.ok === false) return
    setTaskDone(true)
    setTimeout(() => { setTaskOpen(false); setTaskDone(false) }, 2200)
  }
  // Order age from signing (Paul 2026-08-04): red at 6+ months, amber 3-5.
  const ageD = row.signedAt && todayMs ? Math.floor((todayMs - Date.parse(row.signedAt)) / 86400000) : null
  const ageCls = ageD == null ? '' : ageD >= 180 ? 'ib-age-red' : ageD >= 90 ? 'ib-age-amber' : 'ib-age-quiet'
  const signedDt = row.signedAt ? new Date(row.signedAt) : null
  const ageText = signedDt && ageD != null
    ? `${signedDt.getMonth() + 1}/${signedDt.getDate()}/${String(signedDt.getFullYear()).slice(2)} · ${ageD >= 60 ? `${Math.floor(ageD / 30)}mo` : `${ageD}d`}`
    : null
  // ALL FOUR GATES GREEN (n/a counts as good) = the truck can roll (Paul
  // 2026-08-04: "a label on these READY TO INSTALL for once that are paid in
  // full permit not required or approved foundation in and blasted").
  const readyNow = !row.installed && row.gates4
    && row.gates4.paid !== false && row.gates4.fdn !== false
    && row.gates4.permit !== false && row.gates4.blasted !== false
  return (
    <div className={`ib-card${row.onList ? ' ib-card-list' : ''}`}>
      <div className="ib-card-top">
        <button type="button" className="ib-card-fam" onClick={() => onOpenJob?.(row.jobId)}>{row.family}</button>
        {readyNow && <span className="ib-ready">READY TO INSTALL</span>}
        <span className={`ib-track ib-track-${tone}`}>{TRACK_LABEL[row.track] || row.track}</span>
      </div>
      <div className="ib-card-meta">
        {row.orderNumber && <button type="button" className="ib-card-ord" onClick={() => row.orderId && onOpenOrderDetail?.(row.orderId)}>{row.orderNumber}</button>}
        <span className="ib-card-cem">{[row.cemetery, row.grave].filter(Boolean).join(' · ') || '—'}</span>
        {ageText && <span className={`ib-age ${ageCls}`} title="Order date and age since signing — red 6+ months, amber 3-5">{ageText}</span>}
      </div>
      {/* SET-LIST rows: blockers inform, they never gate. Foundation is the
          headline — Paul: "i do however want to see blockers like is the
          foundation done or not thats important." */}
      {/* THE FOUR GATES (Paul 2026-07-31): Paid · Foundation in · Permit
          approved · Blasted — green when good, red when it would strand the
          truck, neutral when the gate doesn't apply. Inform, never gate. */}
      {b && (
        <div className="ib-gates">
          {row.gates4 && (
            <>
              <button type="button" className={`ib-flag ib-flag-btn ${row.gates4.paid ? 'ib-flag-ok' : 'ib-flag-red'}`}
                title="Open the order — payments and status live there"
                onClick={() => row.orderId && onOpenOrderDetail?.(row.orderId)}>
                {row.gates4.paid ? 'PAID' : (b.balance > 0 ? `BALANCE ${fmtUSD(b.balance)}` : 'NOT PAID')}
              </button>
              {row.gates4.fdn === null
                ? <span className="ib-flag ib-flag-na">NO FOUNDATION NEEDED</span>
                : row.gates4.fdnCode === 'drop_off'
                  ? <span className="ib-flag ib-flag-ok">DROP OFF</span>
                  : <span className={`ib-flag ${row.gates4.fdn ? 'ib-flag-ok' : 'ib-flag-red'}`}>{row.gates4.fdn ? 'FOUNDATION IN' : 'FOUNDATION NOT IN'}</span>}
              {row.gates4.permit === null
                ? <span className="ib-flag ib-flag-na">NO PERMIT NEEDED</span>
                : <span className={`ib-flag ${row.gates4.permit ? 'ib-flag-ok' : 'ib-flag-red'}`}>{row.gates4.permit ? 'PERMIT APPROVED' : 'PERMIT NOT APPROVED'}</span>}
              <span className={`ib-flag ${row.gates4.blasted ? 'ib-flag-ok' : 'ib-flag-red'}`}>{row.gates4.blasted ? 'BLASTED' : 'NOT BLASTED'}</span>
            </>
          )}
        </div>
      )}
      {!row.installed && !b && (
        <div className="ib-gates">
          {GATE_DEFS.map(g => {
            const v = row.gates ? row.gates[g.key] : (g.key === 'stone' ? true : null)
            const cls = v === true ? 'ok' : v === false ? 'no' : 'na'
            const mark = v === true ? '✓' : v === false ? '✗' : '–'
            return <span key={g.key} className={`ib-gate ib-gate-${cls}`}><span className="ib-gate-m">{mark}</span>{g.label}</span>
          })}
        </div>
      )}
      {row.installed && <div className="ib-installed">✓ Installed</div>}
      {row.scheduled && row.scheduledDate && <div className="ib-sched">📅 Scheduled {row.scheduledDate}</div>}
      {row.unmet && row.unmet.length > 0 && <div className="ib-blocked">Blocked: {row.unmet.join(' + ')}</div>}
      {canAct && (
        <div className="ib-card-actions">
          {!row.scheduled && <button type="button" className="ib-act" onClick={() => onSchedule?.(row)}>Schedule install</button>}
          <button type="button" className="ib-act ib-act-go" onClick={() => onMarkInstalled?.(row)}>Mark installed</button>
          {onRemove && (
            <button type="button" className="ib-act ib-act-x" disabled={listBusy === row.jobId}
              onClick={() => onRemove(row.jobId)}>Remove</button>
          )}
          {row.orderId && (
            <button type="button" className="ib-act" title="Task somebody to call this customer — lands in the Task Command Center linked to the order"
              onClick={() => (taskOpen ? setTaskOpen(false) : openTasker())}>Task call</button>
          )}
        </div>
      )}
      {taskOpen && (
        <div className="ib-tasker">
          {taskDone ? (
            <span className="ib-tasker-ok">Task created — {taskWho} has it.</span>
          ) : (
            <>
              <select value={taskWho} onChange={e => setTaskWho(e.target.value)} aria-label="Who gets the call">
                <optgroup label="People">{STAFF_NAMES.map(n => <option key={n} value={n}>{n}</option>)}</optgroup>
                <optgroup label="Departments">{DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}</optgroup>
              </select>
              <input value={taskNote} onChange={e => setTaskNote(e.target.value)} placeholder="What needs doing…" />
              <input type="date" value={taskDue} onChange={e => setTaskDue(e.target.value)} title="Due — blank means today" />
              <button type="button" className="ib-act ib-act-go" disabled={taskBusy || !taskNote.trim()} onClick={sendTask}>
                {taskBusy ? '…' : 'Task it'}
              </button>
              <button type="button" className="ib-act" onClick={() => setTaskOpen(false)}>×</button>
            </>
          )}
        </div>
      )}
    </div>
  )
}

const IB_CSS = `
  .ib-group { margin-bottom: 14px; }
  .ib-group-head { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: #c7cedb; margin: 6px 0 8px; display: flex; align-items: center; gap: 8px; }
  .ib-group-n { font-family: var(--font-m, 'JetBrains Mono'), monospace; font-size: 11px; color: #6f7a8a; background: #1a212b; border-radius: 999px; padding: 1px 8px; }
  .ib-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 10px; }
  .ib-card { background: #151a22; border: 1px solid #232a35; border-radius: 10px; padding: 11px 13px; }
  .ib-card-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .ib-card-fam { font: inherit; font-size: 14.5px; font-weight: 700; color: #f4f6fa; background: none; border: none; cursor: pointer; padding: 0; text-align: left; }
  .ib-card-fam:hover { color: #fff; text-decoration: underline; }
  .ib-track { font-size: 9.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; border-radius: 999px; padding: 2px 8px; }
  .ib-track-green { background: #15301f; color: #34d399; } .ib-track-amber { background: #322712; color: #fbbf24; }
  .ib-track-purple { background: #261f3a; color: #a78bfa; } .ib-track-blue { background: #16263a; color: #6fb3f0; }
  .ib-track-neutral { background: #1a212b; color: #8b95a5; }
  .ib-ready { background: #123524; color: #34d399; border: 1px solid #1d7a55; font-size: 9.5px; font-weight: 800; letter-spacing: 0.05em; border-radius: 6px; padding: 3px 8px; white-space: nowrap; }
  .ib-flag-btn { border: none; cursor: pointer; font-family: inherit; }
  .ib-flag-btn:hover { filter: brightness(1.25); }
  .ib-age { font-family: var(--font-m, 'JetBrains Mono'), monospace; font-size: 10.5px; font-weight: 700; border-radius: 6px; padding: 2px 7px; white-space: nowrap; }
  .ib-age-red { background: #3a1d1d; color: #f87171; }
  .ib-age-amber { background: #322712; color: #fbbf24; }
  .ib-age-quiet { background: #1a212b; color: #8b95a5; }
  .ib-sortrow { display: flex; align-items: center; gap: 7px; flex-wrap: wrap; margin: 2px 0 12px; }
  .ib-sortlab { font-size: 10.5px; font-weight: 800; letter-spacing: 0.06em; text-transform: uppercase; color: #6f7a8a; }
  .ib-sortchip { font: 600 12px/1 inherit; font-family: inherit; border: 1px solid #2a313c; background: #1a212b; color: #c7cedb; border-radius: 999px; padding: 6px 12px; cursor: pointer; }
  .ib-sortchip:hover { border-color: #3a4452; }
  .ib-sortchip.on { background: #9A7209; border-color: #9A7209; color: #fff; font-weight: 700; }
  .ib-tasker { display: flex; align-items: center; gap: 7px; flex-wrap: wrap; margin-top: 9px; padding: 8px 9px; background: #151a22; border: 1px solid #2a313c; border-radius: 8px; }
  .ib-tasker select, .ib-tasker input { font: inherit; font-size: 12px; padding: 5px 7px; border: 1px solid #2a313c; border-radius: 7px; background: #0E1116; color: #e6e9ef; }
  .ib-tasker input:not([type=date]) { flex: 1; min-width: 160px; }
  .ib-tasker-ok { font-size: 12.5px; font-weight: 700; color: #34d399; }
  .ib-card-meta { display: flex; align-items: center; gap: 8px; margin-top: 4px; flex-wrap: wrap; }
  .ib-card-ord { font: inherit; font-family: var(--font-m, 'JetBrains Mono'), monospace; font-size: 11px; color: #6fb3f0; background: none; border: none; cursor: pointer; padding: 0; }
  .ib-card-cem { font-size: 11.5px; color: #8b95a5; }
  .ib-gates { display: flex; gap: 5px; margin-top: 9px; flex-wrap: wrap; }
  .ib-gate { font-size: 10px; font-weight: 600; color: #8b95a5; display: inline-flex; align-items: center; gap: 3px; background: #11151c; border: 1px solid #20262f; border-radius: 6px; padding: 2px 7px; }
  .ib-gate-m { font-weight: 800; }
  .ib-gate-ok { color: #34d399; border-color: #1f3a2a; } .ib-gate-ok .ib-gate-m { color: #34d399; }
  .ib-gate-no { color: #f87171; border-color: #3a2020; } .ib-gate-no .ib-gate-m { color: #f87171; }
  .ib-gate-na { color: #5a6470; }
  .ib-blocked { font-size: 11px; color: #f87171; margin-top: 8px; font-weight: 600; }
  .ib-installed { font-size: 11.5px; color: #34d399; margin-top: 8px; font-weight: 600; }
  .ib-sched { font-size: 11px; color: #a78bfa; margin-top: 8px; }
  .ib-card-actions { display: flex; gap: 6px; margin-top: 10px; flex-wrap: wrap; }
  /* Set list (Paul's hand-picked scheduling list) */
  .ib-listhint { font-size: 12.5px; color: #8b93a1; line-height: 1.55; padding: 2px 2px 12px; max-width: 820px; }
  .ib-card-list { border-color: #3a4454; }
  .ib-flag { font-size: 9.5px; font-weight: 800; letter-spacing: 0.05em; border-radius: 6px; padding: 3px 8px; white-space: nowrap; }
  .ib-flag-red { background: rgba(179,38,30,0.18); color: #ff8a80; border: 1px solid rgba(179,38,30,0.5); }
  .ib-flag-ok { background: rgba(52,211,153,0.14); color: #34d399; border: 1px solid rgba(52,211,153,0.35); }
  .ib-flag-amber { background: rgba(216,160,63,0.15); color: #d8a03f; border: 1px solid rgba(216,160,63,0.35); }
  .ib-flag-na { background: #1a212b; color: #6f7a8a; border: 1px solid #2a313c; }
  .ib-modal-wide { max-width: 720px; }
  .ib-addlist { max-height: 52vh; overflow-y: auto; margin-top: 10px; }
  .ib-addrow { display: flex; align-items: center; gap: 12px; padding: 9px 4px; border-top: 1px solid #1f2732; }
  .ib-addrow:first-child { border-top: none; }
  .ib-addmain { flex: 1; min-width: 0; }
  .ib-addfam { display: block; font-size: 13.5px; font-weight: 700; color: #f4f6fa; }
  .ib-addmeta { display: block; font-size: 11.5px; color: #6f7a8a; margin-top: 1px; }
  .ib-addflags { display: flex; gap: 6px; flex-wrap: wrap; flex-shrink: 0; }
  .ib-act-x { border-color: #3a2a2a; background: #1e1618; color: #ff8a80; }
  .ib-act { font: inherit; font-size: 12px; font-weight: 600; padding: 6px 12px; border-radius: 8px; border: 1px solid #2a313c; background: #1a212b; color: #e6e9ef; cursor: pointer; }
  .ib-act:hover { background: #232c38; }
  .ib-act-go { border-color: #2d5a44; background: #15301f; color: #34d399; }
  .ib-modal-overlay { position: fixed; inset: 0; z-index: 9500; background: rgba(8,10,14,0.66); display: flex; align-items: center; justify-content: center; padding: 20px; }
  .ib-modal { background: #11151c; border: 1px solid #2a313c; border-radius: 14px; padding: 20px 22px; max-width: 420px; width: 100%; color: #e6e9ef; font-family: var(--font-b, 'Lato'), 'Helvetica Neue', sans-serif; }
  .ib-modal-title { font-size: 16px; font-weight: 700; color: #f4f6fa; margin-bottom: 8px; }
  .ib-modal-body { font-size: 13px; color: #b8c0cc; line-height: 1.5; margin-bottom: 14px; }
  .ib-modal-input { font: inherit; font-size: 14px; width: 100%; background: #0E1116; border: 1px solid #2a313c; border-radius: 8px; color: #e6e9ef; padding: 8px 10px; margin-bottom: 14px; }
  .ib-modal-actions { display: flex; gap: 8px; justify-content: flex-end; }
  .ib-btn-go { border-color: #2d5a44; background: #15301f; color: #34d399; }
`
