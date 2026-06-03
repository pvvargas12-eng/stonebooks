// =============================================================================
// 📚 Stonebooks — Jobs tab (JOBS-OPERATIONAL-HUBS Phase 1A shell)
// =============================================================================
// Two view modes share this tab; the operator picks via a small toggle next
// to the page header. Choice persists per-user via workspaceState.jobsView.
//
//   • Hubs (default) — 4 operational hubs (Admin · Design · Production ·
//     Installation), each rendered as an actionable family-first list
//     scoped to work that hub owns. Lives in JobsDepartmentView. Sales +
//     Owner are Phase 1B follow-up.
//   • Jobs — All — the flat JOBS-RESKIN-PASS family-first list (every active
//     job in one table). Preserved verbatim for the days an operator wants
//     to scan everything at once or doesn't fit a hub. Lives in the
//     JobsListView below.
//
// JobDetail (per-job drill-down) is unchanged — clicking any row routes here
// as before, regardless of which view mode produced the click.
// =============================================================================

import { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from './lib/supabase'
import JobPnLPanel from './JobPnLPanel'
import JobDimensionsPanel from './JobDimensionsPanel'
import {
  // JobDetail dependencies (preserved)
  getJob, getJobEvents,
  createJobFromOrder, // eslint-disable-line no-unused-vars
  updateMilestone, updateMilestoneWithOverride,
  setJobOverallStatus, addJobNote,
  inferWaitingStatusFromMilestone,
  JOB_OVERALL_STATUSES, JOB_MILESTONE_STATUSES,
  jobStatusInfo, milestoneStatusInfo, teamInfo,
  isMilestoneOverdue, daysPastDue, hasUnsatisfiedRequires,
  customerName, fmtDate, fmtRelative, fmtUSD,
  rowGrandTotal, rowTotalPaid, rowBalanceDue,
  getNextRequiredAction,
  SOLD_STATUSES, // eslint-disable-line no-unused-vars
  BLOCK_REASON_CODES,
  listAllBulkOrders,
  projectJobDates,
  compareMilestoneDates,
  formatMilestoneDateDisplay,
  getActivePromisesForJob,
  // JobsListView dependencies (computeOrderPressure consumed inside
  // enrichJob in ./lib/jobsRow, no longer imported here directly).
  getJobs,
} from './lib/stonebooksData'
import { paymentTone, paymentLabel } from './lib/crmTheme'
import { Pill, FilterChip, ProgressMicroBar } from './lib/crmComponents.jsx'
import PromiseBadge from './components/scheduler/PromiseBadge'
import AddPromiseModal from './components/AddPromiseModal'
// JOBS-OPERATIONAL-HUBS Phase 1A — JobRow + helpers moved to ./lib/jobsRow*
// so the new 4-hub view (JobsDepartmentView) renders the same family-first
// row vocabulary without duplicating logic. JobRow stays in jobsRow.jsx
// (component-only, Fast Refresh clean); constants + enrichment helpers live
// in jobsRowHelpers.js. JobDetail still uses GROUP_ORDER + GROUP_LABEL; the
// flat list also pulls STAGE_BUCKETS + recencyBand/severityRank for sort.
import { JobRow } from './lib/jobsRow'
import {
  enrichJob,
  ROW_GRID,
  GROUP_ORDER, GROUP_LABEL,
  STAGE_BUCKETS,
  recencyBand, severityRank,
} from './lib/jobsRowHelpers'
// JOBS-OPERATIONAL-HUBS Phase 2A — consolidated stone-design read-only
// view rendered as a tab inside JobDetail. Pure read-arrange of the joined
// order row; no new data fetch.
import DesignPacket from './DesignPacket'

// =============================================================================
// MAIN
// =============================================================================
// Thin shell. Three states in priority order:
//   1. A job is selected → JobDetail (drill-down, view mode irrelevant)
//   2. View mode is 'hubs' → JobsDepartmentView (4-hub operational surface)
//   3. View mode is 'all'  → JobsListView (flat family-first list)
//
// View mode persists via workspaceState.jobsView. Default 'hubs' — the
// emotional transformation Phase 1A is aiming for. Operators can flip back
// to the flat list (which itself was a JOBS-RESKIN-PASS-era transformation
// from the legacy queues view) whenever they want a single sortable table.

export default function JobsTab({
  selectedJobId = null,
  setSelectedJobId,
  initialQueue = null,
  onConsumeInitialQueue,
  onOpenOrder,
  onOpenCustomer,
}) {
  // JOBS-OPERATIONAL-HUBS Phase 2A.2 — captured here so the "Open packet →"
  // affordance in DesignHubHome can open JobDetail with the Design Packet
  // tab pre-selected. Defaults to 'job'; callers that route from other
  // surfaces leave the default in place.
  const [defaultDetailTab, setDefaultDetailTab] = useState('job')
  const handleOpenJob = (jobId, tab = 'job') => {
    setDefaultDetailTab(tab)
    setSelectedJobId(jobId)
  }

  // The Command Surface used to set `initialQueue` (e.g. "stones", "layouts")
  // to deep-link into the old QueuesView. JOBS-RESKIN-PASS retired QueuesView;
  // accept + discard so the Command Surface doesn't re-open a now-deleted
  // surface on every prop reflow. Phase 1B will route deep-links into the
  // appropriate hub instead.
  useEffect(() => {
    if (!initialQueue) return
    setSelectedJobId(null)
    onConsumeInitialQueue?.()
  }, [initialQueue, onConsumeInitialQueue, setSelectedJobId])

  if (selectedJobId) {
    return (
      // key={selectedJobId} forces JobDetail to remount on job switch so
      // (a) the `defaultTab` prop takes effect on each open, and (b) per-job
      // session state (dismissedKinds set, waitingHint) doesn't leak
      // between jobs.
      <JobDetail
        key={selectedJobId}
        jobId={selectedJobId}
        onBack={() => setSelectedJobId(null)}
        onOpenOrder={onOpenOrder}
        onOpenCustomer={onOpenCustomer}
        defaultTab={defaultDetailTab}
      />
    )
  }

  // Jobs is jobs only — the flat family-first operational table. The
  // operational-department hubs that used to live here moved into the
  // dedicated Operations tab (Workflow section), so there's one home for
  // queue/hub work instead of a duplicate inside Jobs.
  return <JobsListView onOpenJob={handleOpenJob} />
}

// =============================================================================
// JOBS LIST VIEW — family-first operational table
// =============================================================================
// Matches Customers + Orders visual identity: warm off-white canvas, white
// table card, semantic Pills, FilterChips, ProgressMicroBar, action-priority
// sort, filter echo in the head-count line. Single blocker chip from
// computeOrderPressure; no "On track" pill when null (absence is the signal).

// Filter chip shapes
const STATUS_FILTERS = [
  { code: 'active', label: 'Active' },
  { code: 'closed', label: 'Closed' },
]
const JOB_TYPE_FILTERS = [
  { code: 'new_stone',       label: 'New stone' },
  { code: 'mausoleum_door',  label: 'Crypt door' },
  { code: 'cleaning_repair', label: 'Cleaning-repair' },
  { code: 'inscription',     label: 'Inscription' },
]
// Coarse stage buckets — operator-vocabulary 4 stages that fold the
// fine-grained milestone groups into something a shop owner reads at a glance.
// STAGE_BUCKETS / STAGE_BUCKET_LABEL / bucketForGroup live in ./lib/jobsRow.
const STAGE_FILTERS = [
  { code: 'intake',     label: 'Intake' },
  { code: 'production', label: 'Production' },
  { code: 'install',    label: 'Install' },
  { code: 'closeout',   label: 'Closeout' },
]
const PAYMENT_FILTERS = [
  { code: 'paid_in_full', label: 'Paid in full' },
  { code: 'partial',      label: 'Partial' },
  { code: 'unpaid',       label: 'Unpaid' },
  { code: 'overdue',      label: 'Overdue' },
]
const BLOCKER_FILTERS = [
  { code: 'cemetery',     label: 'Cemetery hold', match: k => k === 'cemetery_hold' },
  { code: 'family',       label: 'Family',        match: k => k === 'waiting_on_family' || k === 'proof_waiting_customer' },
  { code: 'production',   label: 'Production',    match: k => k === 'production_blocked' },
  { code: 'install_ready',label: 'Install ready', match: k => k === 'stone_ready_schedule_trip' || k === 'install_scheduled' || k === 'needs_install_date' },
]
const SORT_OPTIONS = [
  { code: 'actionPriority', label: 'Sort: Action priority' },
  { code: 'lastActivity',   label: 'Sort: Recent activity' },
  { code: 'ageDesc',        label: 'Sort: Age oldest first' },
  { code: 'familyName',     label: 'Sort: Family name A→Z' },
]

// ROW_GRID + action-priority helpers (recencyBand / severityRank /
// SEVERITY_RANK) live in ./lib/jobsRow.

function JobsListView({ onOpenJob }) {
  const [jobs, setJobs]         = useState([])
  const [loading, setLoading]   = useState(true)
  const [loadErr, setLoadErr]   = useState(null)
  const [search, setSearch]     = useState('')
  const [sortKey, setSortKey]   = useState('actionPriority')
  const [statusFilter, setStatusFilter] = useState('active')
  const [needsAttentionOnly, setNeedsAttentionOnly] = useState(false)
  const [jobTypeFilters, setJobTypeFilters] = useState(new Set())
  const [stageFilters, setStageFilters]     = useState(new Set())
  const [paymentFilters, setPaymentFilters] = useState(new Set())
  const [blockerFilters, setBlockerFilters] = useState(new Set())

  // Load — getJobs returns jobs with order/customer/cemetery joined and
  // milestones embedded. One round-trip for the whole list. includeClosed
  // toggles based on the Status chip.
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setLoadErr(null)
    getJobs({ includeClosed: statusFilter === 'closed', limit: 1000 })
      .then(rows => {
        if (cancelled) return
        // Workflow #3 fix: 'cancelled' jobs were leaking into Active because
        // getJobs({includeClosed:false}) only excludes overall_status='closed'.
        // For 'closed' chip explicitly narrow to {closed, cancelled} together
        // — cancelled is operationally a dead state, not an active one.
        const filtered = statusFilter === 'closed'
          ? (rows || []).filter(j => j.overall_status === 'closed' || j.overall_status === 'cancelled')
          : (rows || []).filter(j => j.overall_status !== 'cancelled')
        setJobs(filtered)
        setLoading(false)
      })
      .catch(e => {
        if (cancelled) return
        setLoadErr(e?.message || 'Failed to load jobs')
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [statusFilter])

  // Enrich each job with derived display fields + computeOrderPressure via
  // the shared enrichJob helper (extracted to ./lib/jobsRow in Phase 1A).
  const enriched = useMemo(() => jobs.map(enrichJob), [jobs])

  // Filter + sort
  const filtered = useMemo(() => {
    let list = enriched

    if (needsAttentionOnly) {
      list = list.filter(j => {
        const sev = j._pressure.blocker?.severity
        return sev === 'red' || sev === 'amber'
      })
    }

    if (jobTypeFilters.size > 0) {
      list = list.filter(j => {
        for (const f of jobTypeFilters) {
          if (f === 'inscription') {
            if (j._serviceTypesUp.has('INSCRIPTION') || j._serviceTypesUp.has('INSCRIPTIONS')) return true
          } else {
            if (j.job_type === f) return true
          }
        }
        return false
      })
    }

    if (stageFilters.size > 0) {
      list = list.filter(j => {
        for (const f of stageFilters) {
          if (STAGE_BUCKETS[f]?.has(j._stage.group)) return true
        }
        return false
      })
    }

    if (paymentFilters.size > 0) {
      list = list.filter(j => paymentFilters.has(j._pressure.paymentState))
    }

    if (blockerFilters.size > 0) {
      list = list.filter(j => {
        const k = j._pressure.blocker?.kind
        if (!k) return false
        for (const f of blockerFilters) {
          const cfg = BLOCKER_FILTERS.find(x => x.code === f)
          if (cfg?.match(k)) return true
        }
        return false
      })
    }

    const needle = search.trim().toLowerCase()
    if (needle) {
      list = list.filter(j => {
        const hay = [
          j._familyName, j._deceasedLabel,
          j.id?.slice(0, 8),
          j._order?.order_number,
          j._order?.primary_lastname,
          j._order?.customer?.first_name, j._order?.customer?.last_name,
          j._order?.cemetery?.name,
          j._order?.sales_rep,
        ].filter(Boolean).join(' ').toLowerCase()
        return hay.includes(needle)
      })
    }

    const sorters = {
      actionPriority: (a, b) => {
        const bandDiff = recencyBand(a._lastActivity) - recencyBand(b._lastActivity)
        if (bandDiff !== 0) return bandDiff
        const sevDiff = severityRank(a._pressure.blocker) - severityRank(b._pressure.blocker)
        if (sevDiff !== 0) return sevDiff
        return (b._lastActivity || 0) - (a._lastActivity || 0)
      },
      lastActivity: (a, b) => (b._lastActivity || 0) - (a._lastActivity || 0),
      ageDesc:      (a, b) => (b._pressure.ageDays || 0) - (a._pressure.ageDays || 0),
      familyName:   (a, b) => (a._familyName || '').localeCompare(b._familyName || ''),
    }
    return [...list].sort(sorters[sortKey] || sorters.actionPriority)
  }, [enriched, needsAttentionOnly, jobTypeFilters, stageFilters, paymentFilters, blockerFilters, search, sortKey])

  const needsAttentionCount = useMemo(
    () => enriched.filter(j => {
      const sev = j._pressure.blocker?.severity
      return sev === 'red' || sev === 'amber'
    }).length,
    [enriched]
  )

  // Filter echo for the count line — same pattern as Customers + Orders.
  const activeFilterLabels = useMemo(() => {
    const labels = []
    if (statusFilter !== 'active') {
      const cfg = STATUS_FILTERS.find(f => f.code === statusFilter)
      if (cfg) labels.push(cfg.label)
    }
    if (needsAttentionOnly) labels.push('Needs attention')
    for (const f of jobTypeFilters) labels.push(JOB_TYPE_FILTERS.find(x => x.code === f)?.label || f)
    for (const f of stageFilters)   labels.push(STAGE_FILTERS.find(x => x.code === f)?.label || f)
    for (const f of paymentFilters) labels.push(PAYMENT_FILTERS.find(x => x.code === f)?.label || f)
    for (const f of blockerFilters) labels.push(BLOCKER_FILTERS.find(x => x.code === f)?.label || f)
    if (search.trim()) labels.push(`"${search.trim()}"`)
    return labels
  }, [statusFilter, needsAttentionOnly, jobTypeFilters, stageFilters, paymentFilters, blockerFilters, search])

  const toggle = (set, setter) => (code) => {
    const next = new Set(set)
    if (next.has(code)) next.delete(code); else next.add(code)
    setter(next)
  }
  const resetAll = () => {
    setStatusFilter('active')
    setNeedsAttentionOnly(false)
    setJobTypeFilters(new Set())
    setStageFilters(new Set())
    setPaymentFilters(new Set())
    setBlockerFilters(new Set())
    setSearch('')
  }

  return (
    <div className="sb-crm-page">
      <div className="sb-crm-container">
        <header className="sb-crm-head">
          <div>
            <h1 className="sb-crm-head-title">Jobs</h1>
            <div className="sb-crm-head-count">
              <strong>{loading ? '—' : filtered.length}</strong>{' '}
              {filtered.length === 1 ? 'job' : 'jobs'}
              {!loading && needsAttentionCount > 0 && (
                <> · <strong>{needsAttentionCount}</strong> need attention</>
              )}
              {!loading && activeFilterLabels.length > 0 && (
                <> · {activeFilterLabels.join(' · ')}</>
              )}
            </div>
          </div>
          <div className="sb-crm-head-actions">
            <input
              type="search"
              className="sb-crm-search"
              placeholder="Search family, deceased, job id, order #, cemetery…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            <select
              className="sb-crm-sort"
              value={sortKey}
              onChange={e => setSortKey(e.target.value)}
            >
              {SORT_OPTIONS.map(o => (
                <option key={o.code} value={o.code}>{o.label}</option>
              ))}
            </select>
          </div>
        </header>

        {loadErr && <div className="sb-crm-error">{loadErr}</div>}

        <div className="sb-crm-min-width-banner">
          Best viewed on desktop — this list uses a dense table layout. Phone view falls back to a single-column stack.
        </div>

        {/* Filter chips */}
        <div className="sb-crm-chip-row">
          <div className="sb-crm-chip-group">
            <span className="sb-crm-chip-group-label">Status</span>
            {STATUS_FILTERS.map(f => (
              <FilterChip
                key={f.code}
                active={statusFilter === f.code}
                onClick={() => setStatusFilter(f.code)}
              >
                {f.label}
              </FilterChip>
            ))}
          </div>
          <div className="sb-crm-chip-group">
            <FilterChip
              active={needsAttentionOnly}
              onClick={() => setNeedsAttentionOnly(v => !v)}
            >
              Needs attention
            </FilterChip>
          </div>
          <div className="sb-crm-chip-group">
            <span className="sb-crm-chip-group-label">Job type</span>
            {JOB_TYPE_FILTERS.map(f => (
              <FilterChip
                key={f.code}
                active={jobTypeFilters.has(f.code)}
                onClick={() => toggle(jobTypeFilters, setJobTypeFilters)(f.code)}
              >
                {f.label}
              </FilterChip>
            ))}
          </div>
          <div className="sb-crm-chip-group">
            <span className="sb-crm-chip-group-label">Stage</span>
            {STAGE_FILTERS.map(f => (
              <FilterChip
                key={f.code}
                active={stageFilters.has(f.code)}
                onClick={() => toggle(stageFilters, setStageFilters)(f.code)}
              >
                {f.label}
              </FilterChip>
            ))}
          </div>
          <div className="sb-crm-chip-group">
            <span className="sb-crm-chip-group-label">Payment</span>
            {PAYMENT_FILTERS.map(f => (
              <FilterChip
                key={f.code}
                active={paymentFilters.has(f.code)}
                onClick={() => toggle(paymentFilters, setPaymentFilters)(f.code)}
              >
                {f.label}
              </FilterChip>
            ))}
          </div>
          <div className="sb-crm-chip-group">
            <span className="sb-crm-chip-group-label">Blocker</span>
            {BLOCKER_FILTERS.map(f => (
              <FilterChip
                key={f.code}
                active={blockerFilters.has(f.code)}
                onClick={() => toggle(blockerFilters, setBlockerFilters)(f.code)}
              >
                {f.label}
              </FilterChip>
            ))}
          </div>
        </div>

        {/* Table card */}
        <div className="sb-crm-card sb-crm-table">
          <div className="sb-crm-row sb-crm-row-head" style={{ gridTemplateColumns: ROW_GRID }}>
            <div>Family / Stone</div>
            <div>Order</div>
            <div>Cemetery</div>
            <div>Stage</div>
            <div>Payment</div>
            <div>Blocker</div>
            <div className="num">Age</div>
            <div className="num">Updated</div>
          </div>

          {loading ? (
            <div className="sb-crm-empty">Loading jobs…</div>
          ) : filtered.length === 0 ? (
            <div className="sb-crm-empty">
              {needsAttentionOnly && !jobTypeFilters.size && !stageFilters.size && !paymentFilters.size && !blockerFilters.size && !search.trim()
                ? 'No jobs need attention right now.'
                : 'No jobs match these filters.'}
              {!needsAttentionOnly && (
                <div>
                  <button type="button" onClick={resetAll}>Reset filters</button>
                </div>
              )}
            </div>
          ) : (
            filtered.map(j => <JobRow key={j.id} job={j} onOpen={onOpenJob} />)
          )}
        </div>

        {/* TODO: assigned crew column once crew table populated.
            TODO: scheduled install date column once scheduler usage produces real dated batches.
            TODO: production readiness micro-indicator — bolts onto scheduler accountability sprint.
            TODO: per-job margin column (from actual_realized_margin_pct), behind a settings toggle.
            TODO: photo thumbnail column — bolts onto photo-evidence sprint. */}

      </div>
    </div>
  )
}

// JobRow + stage/label helpers (currentStage, mapStageToTone,
// familyNameForJob, deceasedLabelForJob, jobTypeLabel) live in ./lib/jobsRow.

// =============================================================================
// DETAIL — read-only in this commit
// =============================================================================

function JobDetail({ jobId, onBack, onOpenOrder, onOpenCustomer, defaultTab = 'job' }) {
  const [job, setJob] = useState(null)
  const [events, setEvents] = useState(null)
  // JOBS-OPERATIONAL-HUBS Phase 2A — view-mode toggle between the operational
  // job view (milestones / events / PnL / dimensions) and the consolidated
  // design packet. defaultTab is a hook for future Design-Hub→JobDetail
  // routing (Phase 2B will pass 'design' when the click came from Design Hub);
  // Phase 2A always defaults to 'job' so the existing operational read is
  // preserved for every other entry point.
  const [detailTab, setDetailTab] = useState(defaultTab)
  // Bulk orders feed projectJobDates so stone milestones linked to a PO
  // project against the supplier's quoted ETA instead of the default 30d.
  // One fetch on mount; refreshes whenever the job reloads (post-cascade).
  const [bulkOrders, setBulkOrders] = useState([])
  // Override-readiness modal state — set when the data layer rejects a status
  // change with requiresOverride. Confirm calls updateMilestoneWithOverride.
  const [overrideReq, setOverrideReq] = useState(null)

  // Waiting-state transition hint (operational continuation #3, J1-P1).
  // Transient component-local state — cleared on unmount, on manual
  // overall_status change, and on the dismissed-kinds cooldown.
  const [waitingHint, setWaitingHint] = useState(null)
  // Session cooldown — once the user dismisses a hint for a given waiting
  // kind, don't re-surface that same kind until JobDetail unmounts. Stays
  // a plain Set in component state. No persistence, no DB.
  const [dismissedKinds, setDismissedKinds] = useState(() => new Set())

  // Open promises for this job — drives the loud header badge + powers
  // the per-job kept-rate context. Refreshed alongside the job whenever
  // anything that could affect promise state changes.
  const [promises, setPromises] = useState([])
  const [promiseModalOpen, setPromiseModalOpen] = useState(false)

  const loadJob = useCallback(async () => {
    const [j, e, bo, ps] = await Promise.all([
      getJob(jobId),
      getJobEvents(jobId),
      listAllBulkOrders(),
      getActivePromisesForJob(jobId),
    ])
    setJob(j)
    setEvents(e)
    setBulkOrders(bo || [])
    setPromises(ps || [])
  }, [jobId])

  useEffect(() => {
    let cancelled = false
    Promise.all([
      getJob(jobId),
      getJobEvents(jobId),
      listAllBulkOrders(),
      getActivePromisesForJob(jobId),
    ]).then(([j, e, bo, ps]) => {
      if (cancelled) return
      setJob(j)
      setEvents(e)
      setBulkOrders(bo || [])
      setPromises(ps || [])
    })
    return () => { cancelled = true }
  }, [jobId])

  // Project once per (job, bulkOrders) change. Each MilestoneRow reads its
  // milestone's projected date out of this map rather than re-running the
  // O(N) projection. Pure derivation — no side effects.
  const projectionMap = useMemo(
    () => job ? projectJobDates(job, { bulkOrders }) : new Map(),
    [job, bulkOrders],
  )

  // Auto-clear the waiting hint whenever overall_status changes. Covers manual
  // JobControls saves, hint acceptance, and any other path that updates the
  // job-level status — the underlying question has been addressed.
  useEffect(() => {
    setWaitingHint(null)
  }, [job?.overall_status])

  // Sprint J1-P1 follow-up — hooks must be called in the same order on
  // every render. useMemoGroupMilestones contains a useMemo internally; if
  // it sits after the !job early-return, render 1 (job null) calls 5 hooks
  // and render 2 (job loaded) calls 6, crashing JobDetail in production.
  // Keep it here, above the early return; the empty-milestones path is a
  // no-op so the loading render is fine.
  const byGroup = useMemoGroupMilestones(job?.milestones || [])

  if (!job) return (
    <div className="sb-page">
      <BackBar onBack={onBack} />
      <div className="sb-empty">Loading job…</div>
    </div>
  )

  const statusInfo = jobStatusInfo(job.overall_status)
  const order = job.order
  const customer = job.customer
  const cemetery = job.cemetery

  const orderedGroups = GROUP_ORDER.filter(g => byGroup.has(g))

  const total = order ? rowGrandTotal(order) : 0
  const paid = order ? rowTotalPaid(order) : 0
  const balance = order ? rowBalanceDue(order) : 0
  const nra = getNextRequiredAction(job)

  // Waiting-hint logic — consult the heuristic when a milestone transitions
  // to in_progress, gated on:
  //   1. job is not already in a waiting_* state (future-proof for new
  //      waiting kinds without revisiting this branch)
  //   2. the kind hasn't been dismissed during this JobDetail session
  // Same callback fires for both the direct path (MilestoneRow) and the
  // override path (OverrideModal onConfirmed).
  const considerWaitingHint = (milestone, newStatus) => {
    if (newStatus !== 'in_progress') return
    if (!milestone) return
    if ((job.overall_status || '').startsWith('waiting_')) return
    const kind = inferWaitingStatusFromMilestone(milestone)
    if (!kind) return
    if (dismissedKinds.has(kind)) return
    setWaitingHint({
      milestoneKey: milestone.milestone_key,
      suggestedKind: kind,
      sourceLabel: milestone.label,
    })
  }

  const handleAcceptHint = async () => {
    if (!waitingHint) return null
    const note = `Set via waiting-hint from milestone: ${waitingHint.sourceLabel}`
    const res = await setJobOverallStatus(
      job.id,
      waitingHint.suggestedKind,
      note,
      { source: 'waiting_hint' },
    )
    if (res.ok) {
      setWaitingHint(null)
      loadJob()
    }
    return res
  }

  const handleDismissHint = () => {
    if (!waitingHint) return
    setDismissedKinds(prev => {
      const next = new Set(prev)
      next.add(waitingHint.suggestedKind)
      return next
    })
    setWaitingHint(null)
  }

  // JOBS-OPERATIONAL-HUBS Phase 2A.2 — when the Design Packet tab is
  // active, the page-level chrome (BackBar / PromiseStrip / JobDetailHero /
  // JobDetailTabs) is hidden and DesignPacket renders its own self-
  // contained top bar + hero card. This lets the design surface own its
  // full visual identity (cream canvas, premium cards, bronze accents)
  // without the operational chrome competing for attention.
  if (detailTab === 'design') {
    return (
      <div className="sb-page">
        <DesignPacket
          job={job}
          onBack={onBack}
          tab={detailTab}
          onChangeTab={setDetailTab}
          onReload={loadJob}
        />
        {/* Modals stay mounted across tabs so an in-flight override/promise
            flow doesn't disappear if the operator flips tabs mid-action. */}
        {overrideReq && (
          <OverrideModal
            jobId={jobId}
            request={overrideReq}
            onClose={() => setOverrideReq(null)}
            onConfirmed={() => {
              if (overrideReq.patch?.status === 'in_progress') {
                const ms = (job.milestones || []).find(
                  m => m.milestone_key === overrideReq.milestoneKey,
                )
                if (ms) considerWaitingHint(ms, 'in_progress')
              }
              setOverrideReq(null)
              loadJob()
            }}
          />
        )}
        <AddPromiseModal
          open={promiseModalOpen}
          jobId={jobId}
          jobLabel={
            (job?.order?.primary_lastname || customerName(job?.order?.customer) || 'this job')
          }
          onClose={() => setPromiseModalOpen(false)}
          onSaved={() => { setPromiseModalOpen(false); loadJob() }}
        />
      </div>
    )
  }

  return (
    <div className="sb-page sb-page-hero">
      <BackBar onBack={onBack} />

      <PromiseStrip
        promises={promises}
        onAddClick={() => setPromiseModalOpen(true)}
      />

      <JobDetailHero
        job={job}
        order={order}
        customer={customer}
        cemetery={cemetery}
        statusInfo={statusInfo}
        nra={nra}
        total={total}
        paid={paid}
        balance={balance}
        onOpenOrder={onOpenOrder}
        onOpenCustomer={onOpenCustomer}
        onRefresh={loadJob}
      />

      {/* JOBS-OPERATIONAL-HUBS Phase 2A — tab switcher between the operational
          job view (milestones / events / P&L) and the consolidated design
          packet. The tab pair sits between the Hero and the body so both
          views inherit the Hero as their identity anchor. (When the design
          tab is active, this entire JobDetail render is bypassed in favor
          of the DesignPacket's self-contained chrome — see the early
          return above.) */}
      <JobDetailTabs active={detailTab} onChange={setDetailTab} />

      {/* Waiting-state transition hint — soft suggestion only, never automation */}
      {waitingHint && (
        <WaitingHintBanner
          hint={waitingHint}
          onAccept={handleAcceptHint}
          onDismiss={handleDismissHint}
        />
      )}

      {/* Milestones by group */}
      <div className="sb-section-label">Milestones</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {orderedGroups.map(g => (
          <MilestoneGroupCard
            key={g}
            group={g}
            milestones={byGroup.get(g)}
            allMilestones={job.milestones}
            jobId={jobId}
            projectionMap={projectionMap}
            onRefresh={loadJob}
            onOverrideRequest={setOverrideReq}
            onTransition={considerWaitingHint}
          />
        ))}
      </div>

      {/* Event log */}
      <div className="sb-section-label" style={{ marginTop: 24 }}>Recent events</div>
      {events === null ? (
        <div className="sb-empty">Loading…</div>
      ) : events.length === 0 ? (
        <div className="sb-empty">No events recorded for this job yet.</div>
      ) : (
        <EventLog events={events} milestones={job.milestones} />
      )}

      {/* Per-job P&L: estimates, actuals, margin, variance signals */}
      <JobPnLPanel
        target={{ jobId }}
        label={job?.order?.primary_lastname || customerName(job?.order?.customer) || (job?.door_index != null ? `door ${job.door_index + 1}` : 'this job')}
      />

      {/* Dimensional tags for future rollups (collapsed by default) */}
      <JobDimensionsPanel
        target={{ jobId }}
        initial={{ sales_rep_id: job.sales_rep_id, referral_source: job.referral_source, quoted_total: job.quoted_total }}
        contractTotal={job?.order?.contract_total ?? job?.order?.grand_total ?? null}
        onSaved={loadJob}
      />

      {overrideReq && (
        <OverrideModal
          jobId={jobId}
          request={overrideReq}
          onClose={() => setOverrideReq(null)}
          onConfirmed={() => {
            // Mirror the direct-path heuristic for override-driven advances.
            // Read the milestone from the pre-refetch job; only label/key feed
            // the heuristic, and those don't change on a status update.
            if (overrideReq.patch?.status === 'in_progress') {
              const ms = (job.milestones || []).find(
                m => m.milestone_key === overrideReq.milestoneKey,
              )
              if (ms) considerWaitingHint(ms, 'in_progress')
            }
            setOverrideReq(null)
            loadJob()
          }}
        />
      )}

      <AddPromiseModal
        open={promiseModalOpen}
        jobId={jobId}
        jobLabel={
          (job?.order?.primary_lastname || customerName(job?.order?.customer) || 'this job')
        }
        onClose={() => setPromiseModalOpen(false)}
        onSaved={() => { setPromiseModalOpen(false); loadJob() }}
      />
    </div>
  )
}

// Promise strip — sits between the back affordance and the hero. Shows
// every active promise loud, plus the "+ Mark as promised" action so a
// new promise is one click away. When no promises exist the strip is just
// the action button on its own (no loud red treatment).
function PromiseStrip({ promises, onAddClick }) {
  const hasPromises = promises && promises.length > 0
  return (
    <div className={`sb-job-promise-strip ${hasPromises ? 'sb-job-promise-strip-active' : ''}`}>
      <div className="sb-job-promise-strip-body">
        <span className="sb-job-promise-strip-eyebrow">Promise tracker</span>
        {hasPromises ? (
          <div className="sb-job-promise-strip-active-body">
            <span className="sb-job-promise-strip-icon" aria-hidden="true">🤡</span>
            <span className="sb-job-promise-strip-label">
              {promises.length === 1 ? 'Active promise' : `${promises.length} active promises`}
            </span>
            <div className="sb-job-promise-strip-badges">
              {promises.map(p => (
                <PromiseBadge key={p.id} promise={p} size="md" />
              ))}
            </div>
          </div>
        ) : (
          <span className="sb-job-promise-strip-empty">No active promises on this job.</span>
        )}
      </div>
      <button
        type="button"
        className="sb-job-promise-strip-add"
        onClick={onAddClick}
      >
        <span aria-hidden="true">🤡</span> Mark as promised
      </button>
    </div>
  )
}

// ── Job / Design packet tab switcher ────────────────────────────────────────
// Pill-pair segmented control, same vocabulary as the Hubs/All toggle at
// the top of the Jobs tab (sb-jobs-view-toggle styles). Sits inside
// JobDetail between the Hero and the body content. JOBS-OPERATIONAL-HUBS
// Phase 2A.

function JobDetailTabs({ active, onChange }) {
  const OPTIONS = [
    { code: 'job',    label: 'Job view',     desc: 'Milestones, events, P&L' },
    { code: 'design', label: 'Design packet', desc: 'Consolidated stone-design facts' },
  ]
  return (
    <div className="sb-jobs-view-toggle sb-job-detail-tabs" role="tablist" aria-label="Job detail view mode">
      {OPTIONS.map(opt => {
        const isActive = opt.code === active
        return (
          <button
            key={opt.code}
            type="button"
            role="tab"
            aria-selected={isActive}
            title={opt.desc}
            className={`sb-jobs-view-chip ${isActive ? 'sb-jobs-view-chip-active' : ''}`}
            onClick={() => onChange(opt.code)}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}

function BackBar({ onBack }) {
  return (
    <button
      type="button"
      onClick={onBack}
      className="sb-print-hide"
      style={{
        background: 'transparent',
        border: 'none',
        color: 'var(--sb-text-muted)',
        font: 'inherit',
        fontSize: 13,
        cursor: 'pointer',
        padding: '4px 0',
        marginBottom: 32,
      }}
    >
      ← Back
    </button>
  )
}

// =============================================================================
// JOB DETAIL — HERO ZONE
// =============================================================================
// The hero is the upper portion of JobDetail. It carries:
//   • who this is for (customer surname, the deceased's name + dates)
//   • what it is (service descriptor + cemetery)
//   • what it needs (NRA sentence — the operational center of gravity)
//   • the financial fact (one-line balance summary)
//   • a small status indicator
//   • a quiet right-aligned meta strip with quick links and a Job Actions
//     disclosure (status changer, free-form note)
//
// Composed for continuity — no bordered cards, single column reading width,
// generous vertical rhythm. The eye flows top-to-bottom through restrained
// typography. Reference posture: Linear issue page, Notion document.

function JobDetailHero({
  job, order, customer, cemetery, statusInfo, nra,
  total, paid, balance,
  onOpenOrder, onOpenCustomer, onRefresh,
}) {
  const customerLabel = order?.primary_lastname
    || customerName(customer)
    || '—'
  const orderNum = order?.order_number || job.id.slice(0, 8)
  const salesRep = order?.sales_rep || null

  // Deceased — primary entry from order.deceased[]. May be empty for legacy
  // orders or for non-stone job types where deceased wasn't captured.
  const deceasedArr = Array.isArray(order?.deceased) ? order.deceased : []
  const primaryDeceased = deceasedArr.find(d => d && !d.isReserved) || deceasedArr[0] || null
  const deceasedDisplay = primaryDeceased ? formatDeceasedForHero(primaryDeceased) : null
  const otherDeceasedCount = deceasedArr.filter(d => d && d !== primaryDeceased && !d.isReserved).length

  // Service descriptor — "New stone · Hillside Cemetery"
  // (no labels — the words themselves are the data)
  const serviceParts = []
  const serviceTypes = order?.service_types || []
  if (serviceTypes.length > 0) {
    serviceParts.push(formatServiceTypes(serviceTypes))
  }
  if (cemetery?.name) serviceParts.push(cemetery.name)

  // NRA sentence — the operational center of gravity
  const nraText = job.next_action || nra?.label || null
  const nraIsManual = !!job.next_action  // manual override wins
  const nraPriority = nra?.priority || 'soft'

  return (
    <div className="sb-job-hero">
      <div className="sb-job-hero-content">
        <div className="sb-page-eyebrow" style={{ marginBottom: 24 }}>
          Job · {orderNum}
        </div>

        <h1 className="sb-job-hero-name">{customerLabel}</h1>

        {deceasedDisplay && (
          <div className="sb-job-hero-deceased">
            {deceasedDisplay}
            {otherDeceasedCount > 0 && (
              <span className="sb-job-hero-deceased-other"> + {otherDeceasedCount} other</span>
            )}
          </div>
        )}

        {serviceParts.length > 0 && (
          <div className="sb-job-hero-service">
            {serviceParts.join('  ·  ')}
          </div>
        )}

        {nraText && (
          <div
            className={
              'sb-job-hero-nra' +
              (nraPriority === 'urgent' ? ' sb-job-hero-nra-urgent' : '') +
              (nraIsManual ? ' sb-job-hero-nra-manual' : '')
            }
          >
            {nraText}
          </div>
        )}

        <div className="sb-job-hero-fact-row">
          <span
            className="sb-status-pill"
            style={{ '--pill-color': statusInfo.color }}
          >
            {statusInfo.label}
          </span>

          {total > 0 && (
            <span className="sb-job-hero-balance">
              {balance <= 0
                ? <>Paid in full · <span className="sb-job-hero-balance-num">{fmtUSD(total)}</span></>
                : <>
                    <span className="sb-job-hero-balance-num">{fmtUSD(total)}</span>
                    <span className="sb-job-hero-balance-sep">grand</span>
                    <span className="sb-job-hero-balance-num">{fmtUSD(paid)}</span>
                    <span className="sb-job-hero-balance-sep">paid</span>
                    <span
                      className="sb-job-hero-balance-num"
                      style={{ color: 'var(--sb-text)' }}
                    >
                      {fmtUSD(balance)}
                    </span>
                    <span className="sb-job-hero-balance-sep">balance</span>
                  </>
              }
            </span>
          )}
        </div>
      </div>

      <JobDetailHeroMeta
        job={job}
        order={order}
        customer={customer}
        salesRep={salesRep}
        onOpenOrder={onOpenOrder}
        onOpenCustomer={onOpenCustomer}
        onRefresh={onRefresh}
      />
    </div>
  )
}

// Formats a deceased person for the hero line.
// "Margaret Eleanor Vargas · 1935–2025"
// Pre-need (no death date): "Margaret Vargas · b. 1935"
// All-blank: "Reserved" or skipped at caller.
function formatDeceasedForHero(d) {
  const first = (d.firstName || '').trim()
  const middle = (d.middleName || '').trim()
  const last = (d.lastName || '').trim()
  const nameParts = [first, middle, last].filter(Boolean)
  const name = nameParts.join(' ') || 'Reserved'

  const birthY = (d.dateOfBirth || '').slice(0, 4)
  const deathY = (d.dateOfDeath || '').slice(0, 4)
  let dates = null
  if (birthY && deathY) dates = `${birthY}–${deathY}`
  else if (birthY)      dates = `b. ${birthY}`
  else if (deathY)      dates = `d. ${deathY}`

  return dates ? <>{name}<span className="sb-job-hero-dates"> · {dates}</span></> : name
}

function formatServiceTypes(arr) {
  const human = {
    NEW_STONE: 'New stone',
    INSCRIPTION: 'Inscription',
    BRONZE: 'Bronze memorial',
    ACID_WASH: 'Acid wash',
    REPAIR: 'Repair',
    CIVIC_MEMORIAL: 'Civic memorial',
    MAUSOLEUM: 'Mausoleum',
    ADD_PHOTO: 'Add photo',
    OTHER: 'Other',
  }
  return arr.map(s => human[s] || s).join(' + ')
}

// =============================================================================
// JOB DETAIL — HERO META STRIP
// =============================================================================
// Right-aligned strip containing the sales rep, quick links to related
// surfaces, and a Job Actions disclosure (status changer + add-note).
// Quiet typography. No card chrome. Discoverable but not loud.

function JobDetailHeroMeta({
  job, order, customer, salesRep,
  onOpenOrder, onOpenCustomer, onRefresh,
}) {
  const [actionsOpen, setActionsOpen] = useState(false)

  return (
    <div className="sb-job-hero-meta">
      {salesRep && (
        <div className="sb-job-hero-meta-line">
          Sales · {salesRep}
        </div>
      )}
      {order && (
        <button
          type="button"
          className="sb-job-hero-meta-link"
          onClick={() => onOpenOrder?.(order.id)}
        >
          Open order →
        </button>
      )}
      {customer && (
        <button
          type="button"
          className="sb-job-hero-meta-link"
          onClick={() => onOpenCustomer?.(customer.id)}
        >
          View customer →
        </button>
      )}

      <button
        type="button"
        className="sb-job-hero-meta-link"
        onClick={() => setActionsOpen(o => !o)}
      >
        Job actions {actionsOpen ? '▴' : '▾'}
      </button>

      {actionsOpen && (
        <JobActionsDisclosure
          job={job}
          onRefresh={onRefresh}
          onClose={() => setActionsOpen(false)}
        />
      )}
    </div>
  )
}

// =============================================================================
// JOB DETAIL — JOB ACTIONS DISCLOSURE
// =============================================================================
// Inline disclosure inside the hero meta strip. Houses the status changer
// (formerly the JobControls overall_status panel) and the add-note affordance
// (formerly the JobControls free-form note panel). Quiet, contained, and
// dismissible — staff opens it when they need to change status or log a note;
// most of the time it stays collapsed.

function JobActionsDisclosure({ job, onRefresh, onClose }) {
  const [statusDraft, setStatusDraft] = useState(job.overall_status || 'active')
  const [statusNote, setStatusNote] = useState('')
  const [busyStatus, setBusyStatus] = useState(false)
  const [statusErr, setStatusErr] = useState(null)

  const [noteDraft, setNoteDraft] = useState('')
  const [busyNote, setBusyNote] = useState(false)
  const [noteErr, setNoteErr] = useState(null)

  const saveStatus = async () => {
    if (statusDraft === job.overall_status && !statusNote.trim()) {
      onClose?.()
      return
    }
    setBusyStatus(true); setStatusErr(null)
    const res = await setJobOverallStatus(job.id, statusDraft, statusNote.trim() || null)
    setBusyStatus(false)
    if (res.ok) {
      setStatusNote('')
      onRefresh?.()
      onClose?.()
    } else {
      setStatusErr(res.error || 'Update failed')
    }
  }

  const saveNote = async () => {
    const text = noteDraft.trim()
    if (!text) return
    setBusyNote(true); setNoteErr(null)
    const res = await addJobNote(job.id, text)
    setBusyNote(false)
    if (res.ok) {
      setNoteDraft('')
      onRefresh?.()
      onClose?.()
    } else {
      setNoteErr(res.error || 'Failed to save note')
    }
  }

  return (
    <div className="sb-job-hero-actions">
      <div className="sb-job-hero-action-section">
        <div className="sb-job-hero-action-label">Status</div>
        <select
          value={statusDraft}
          onChange={e => setStatusDraft(e.target.value)}
          className="sb-status-select"
          disabled={busyStatus}
          style={{ '--pill-color': jobStatusInfo(statusDraft).color, minWidth: 160 }}
        >
          {JOB_OVERALL_STATUSES.map(s => (
            <option key={s.code} value={s.code}>{s.label}</option>
          ))}
        </select>
        <input
          type="text"
          className="sb-text-input"
          value={statusNote}
          onChange={e => setStatusNote(e.target.value)}
          placeholder="Optional note for this change"
          disabled={busyStatus}
          style={{ marginTop: 8, width: '100%' }}
        />
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <button
            type="button"
            className="sb-btn-primary"
            style={{ marginTop: 0 }}
            onClick={saveStatus}
            disabled={busyStatus}
          >Save status</button>
          <button
            type="button"
            className="sb-btn-secondary"
            onClick={onClose}
            disabled={busyStatus}
          >Cancel</button>
        </div>
        {statusErr && <div style={{ fontSize: 12, color: 'var(--sb-red)', marginTop: 6 }}>{statusErr}</div>}
      </div>

      <div className="sb-job-hero-action-section">
        <div className="sb-job-hero-action-label">Add note</div>
        <textarea
          className="sb-textarea"
          value={noteDraft}
          onChange={e => setNoteDraft(e.target.value)}
          placeholder="Free-form note (logged as a job event)"
          rows={3}
          disabled={busyNote}
          style={{ width: '100%' }}
        />
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <button
            type="button"
            className="sb-btn-primary"
            style={{ marginTop: 0 }}
            onClick={saveNote}
            disabled={busyNote || !noteDraft.trim()}
          >Log note</button>
        </div>
        {noteErr && <div style={{ fontSize: 12, color: 'var(--sb-red)', marginTop: 6 }}>{noteErr}</div>}
      </div>
    </div>
  )
}

// MetricMini removed 2026-05-21 in the JobDetail Phase 1 redesign — the
// metric grid (Next action / Balance / Milestones done / Events logged)
// no longer appears on JobDetail. The hero conveys the same operational
// state through sentence form (NRA + balance line). No other consumers.

// ── Stabilization (post-J1-P1): overdue derivation + actionable-first sort ───
// The pure helpers (isMilestoneOverdue, daysPastDue, hasUnsatisfiedRequires,
// todayLocalISO) now live in stonebooksData.js so queue components can share
// them. The file-local helpers below compose them for the within-group sort.

// Status sort key for the actionable-first comparator. Split per Paul's
// 2026-05-18 rule: ready not_started outranks locked not_started.
function _statusSortKey(m, byKey) {
  if (m.status === 'blocked')     return 1
  if (m.status === 'in_progress') return 2
  if (m.status === 'not_started') return hasUnsatisfiedRequires(m, byKey) ? 4 : 3
  if (m.status === 'done')        return 5
  if (m.status === 'not_needed')  return 6
  return 99
}

function _isOverdueActionable(m) {
  if (!isMilestoneOverdue(m)) return false
  return m.status === 'blocked' || m.status === 'in_progress' || m.status === 'not_started'
}

function useMemoGroupMilestones(milestones) {
  return useMemo(() => {
    const byKey = new Map((milestones || []).map(m => [m.milestone_key, m]))
    const map = new Map()
    for (const m of (milestones || [])) {
      const g = m.group || 'other'
      if (!map.has(g)) map.set(g, [])
      map.get(g).push(m)
    }
    // Actionable-first sort within each group:
    //   key 1: overdue-actionable rises above everything (overdue + done/
    //          not_needed is impossible — those statuses can't be overdue)
    //   key 2: status priority (blocked > in_progress > ready ns > locked ns
    //          > done > not_needed)
    //   key 3: original template sort_order, preserves canonical flow as
    //          tiebreaker
    for (const arr of map.values()) {
      arr.sort((a, b) => {
        const aOver = _isOverdueActionable(a) ? 0 : 1
        const bOver = _isOverdueActionable(b) ? 0 : 1
        if (aOver !== bOver) return aOver - bOver
        const aPri = _statusSortKey(a, byKey)
        const bPri = _statusSortKey(b, byKey)
        if (aPri !== bPri) return aPri - bPri
        return (a.sort_order || 0) - (b.sort_order || 0)
      })
    }
    return map
  }, [milestones])
}

// countDone / countEffective removed 2026-05-21 alongside MetricMini —
// these were only used to render the "Milestones done" metric. Milestone
// progress is now communicated through the timeline itself (Phase 2).

// =============================================================================
// MILESTONE GROUP CARD
// =============================================================================

function MilestoneGroupCard({ group, milestones, allMilestones, jobId, projectionMap, onRefresh, onOverrideRequest, onTransition }) {
  const [open, setOpen] = useState(true)
  const summary = useMemo(() => {
    const total = milestones.length
    const done = milestones.filter(m => m.status === 'done').length
    const notNeeded = milestones.filter(m => m.status === 'not_needed').length
    const inProgress = milestones.filter(m => m.status === 'in_progress').length
    const blocked = milestones.filter(m => m.status === 'blocked').length
    return { total, done, notNeeded, inProgress, blocked, effective: total - notNeeded }
  }, [milestones])

  return (
    <div className="sb-card" style={{ padding: 0, marginBottom: 0 }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%',
          textAlign: 'left',
          background: 'transparent',
          border: 'none',
          padding: '12px 18px',
          cursor: 'pointer',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          font: 'inherit',
          color: 'inherit',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 11, fontFamily: 'var(--sb-font-mono)', color: 'var(--sb-text-muted)' }}>
            {open ? '▾' : '▸'}
          </span>
          <span style={{ fontSize: 13, fontWeight: 500 }}>
            {GROUP_LABEL[group] || group}
          </span>
          <span style={{ fontSize: 11, color: 'var(--sb-text-muted)', fontFamily: 'var(--sb-font-mono)' }}>
            {summary.effective === 0
              ? 'not needed'
              : `${summary.done} / ${summary.effective} done${summary.inProgress ? ` · ${summary.inProgress} in progress` : ''}${summary.blocked ? ` · ${summary.blocked} blocked` : ''}`
            }
          </span>
        </div>
      </button>
      {open && (
        <div style={{ borderTop: '0.5px solid var(--sb-border)', padding: '8px 0' }}>
          {milestones.map(m => (
            <MilestoneRow
              key={m.id}
              milestone={m}
              allMilestones={allMilestones}
              jobId={jobId}
              projectionMap={projectionMap}
              onRefresh={onRefresh}
              onOverrideRequest={onOverrideRequest}
              onTransition={onTransition}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function MilestoneRow({ milestone, allMilestones, jobId, projectionMap, onRefresh, onOverrideRequest, onTransition }) {
  const team = milestone.team ? teamInfo(milestone.team) : null
  const [noteOpen, setNoteOpen] = useState(false)
  const [noteDraft, setNoteDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  // Operational Truth Substrate write surface — small inline form for
  // capturing the supplier/cemetery party name, the external party's
  // quoted-back date, and (when blocked) the structured block reason.
  // Once filled in, the Today engine produces honest signals like
  // "Coldspring is 3 days past their quoted date" automatically.
  const [trackOpen, setTrackOpen] = useState(false)
  const [trackParty,  setTrackParty]  = useState(milestone.external_party_ref     || '')
  const [trackDate,   setTrackDate]   = useState(milestone.expected_resolution_at || '')
  const [trackReason, setTrackReason] = useState(milestone.block_reason_code      || '')
  const hasTracking = !!(
    milestone.external_party_ref ||
    milestone.expected_resolution_at ||
    milestone.block_reason_code
  )

  // Readiness check: are any required milestones not yet done?
  // Returns an array of { key, label } for each unmet dependency. The label
  // is the dependency milestone's human-readable label (e.g. "Stone received")
  // — never the snake_case schema key — so the "Waiting on:" line in the row
  // reads as plain English instead of database identifiers.
  const blocking = useMemo(() => {
    if (!milestone.requires || milestone.requires.length === 0) return []
    const byKey = new Map(allMilestones.map(m => [m.milestone_key, m]))
    return milestone.requires
      .map(k => {
        const dep = byKey.get(k)
        if (!dep) return null
        if (dep.status === 'done' || dep.status === 'not_needed') return null
        return { key: k, label: dep.label || k }
      })
      .filter(Boolean)
  }, [milestone, allMilestones])

  const isLocked = blocking.length > 0 && milestone.status !== 'done' && milestone.status !== 'not_needed'

  // Stabilization (post-J1-P1): derive overdue cue from due_date. "Due today"
  // is NOT overdue — only strictly past. Done / not_needed never overdue.
  const overdue = isMilestoneOverdue(milestone)
  const daysOver = overdue ? daysPastDue(milestone) : 0

  // Status change — advancing statuses go through the readiness gate; the
  // data layer rejects with requiresOverride:true if the milestone isn't ready,
  // and the UI opens the override modal in response.
  const handleStatusChange = async (newStatus) => {
    if (newStatus === milestone.status) return
    setBusy(true); setError(null)
    const res = await updateMilestone(jobId, milestone.milestone_key, { status: newStatus })
    setBusy(false)
    if (res.ok) {
      // Surface waiting-state hints; JobDetail gates on overall_status + cooldown.
      onTransition?.(milestone, newStatus)
      onRefresh?.()
      return
    }
    if (res.requiresOverride) {
      const keys = res.blockingKeys || []
      const labels = keys.map(k => {
        const dep = allMilestones.find(m => m.milestone_key === k)
        return dep?.label || k
      })
      onOverrideRequest?.({
        milestoneKey: milestone.milestone_key,
        milestoneLabel: milestone.label,
        patch: { status: newStatus },
        blockingKeys: keys,
        blockingLabels: labels,
      })
      return
    }
    setError(res.error || 'Update failed')
  }

  const handleDueDateChange = async (e) => {
    const v = e.target.value || null
    if (v === (milestone.due_date || null)) return
    setBusy(true); setError(null)
    const res = await updateMilestone(jobId, milestone.milestone_key, { due_date: v })
    setBusy(false)
    if (res.ok) onRefresh?.()
    else setError(res.error || 'Update failed')
  }

  // Project-date editing — setting a value flips the user-set flag true so
  // future recomputes preserve the operator's judgment. Clearing the input
  // (empty value) resets user_set to false so live projection takes over.
  const handleProjectedChange = async (e) => {
    const v = e.target.value || null
    setBusy(true); setError(null)
    const res = await updateMilestone(jobId, milestone.milestone_key, {
      projected_completion_at: v,
      projected_completion_at_user_set: !!v,
    })
    setBusy(false)
    if (res.ok) onRefresh?.()
    else setError(res.error || 'Update failed')
  }

  const handleProjectedReset = async () => {
    setBusy(true); setError(null)
    const res = await updateMilestone(jobId, milestone.milestone_key, {
      projected_completion_at: null,
      projected_completion_at_user_set: false,
    })
    setBusy(false)
    if (res.ok) onRefresh?.()
    else setError(res.error || 'Update failed')
  }

  // Live projection for this milestone — whatever the engine derives, given
  // the user-set value (when set) or the upstream chain.
  const projectedDates = compareMilestoneDates(milestone, projectionMap)
  const dateDisplay = formatMilestoneDateDisplay(projectedDates)
  const projectedInputValue = projectedDates.userSet
    ? (milestone.projected_completion_at ? String(milestone.projected_completion_at).slice(0, 10) : '')
    : (projectedDates.projected || '')

  // Save the three operational-truth fields in one patch. Empty inputs
  // are normalized to null in the data layer (clears prior values).
  const handleTrackSave = async () => {
    setBusy(true); setError(null)
    const res = await updateMilestone(jobId, milestone.milestone_key, {
      external_party_ref:     trackParty,
      expected_resolution_at: trackDate,
      block_reason_code:      trackReason,
    })
    setBusy(false)
    if (res.ok) {
      setTrackOpen(false)
      onRefresh?.()
    } else {
      setError(res.error || 'Update failed')
    }
  }

  const handleNoteSave = async () => {
    const text = (noteDraft || '').trim()
    if (!text) { setNoteOpen(false); return }
    setBusy(true); setError(null)
    const res = await updateMilestone(jobId, milestone.milestone_key, { note: text })
    setBusy(false)
    if (res.ok) {
      setNoteDraft('')
      setNoteOpen(false)
      onRefresh?.()
    } else {
      setError(res.error || 'Update failed')
    }
  }

  return (
    <div className="sb-milestone-row" style={{ opacity: isLocked ? 0.7 : 1 }}>
      <div className="sb-milestone-row-main">
        <div>
          <select
            className="sb-status-select"
            value={milestone.status}
            onChange={e => handleStatusChange(e.target.value)}
            disabled={busy}
            style={{ '--pill-color': milestoneStatusInfo(milestone.status).color }}
          >
            {JOB_MILESTONE_STATUSES.map(s => (
              <option key={s.code} value={s.code}>{s.label}</option>
            ))}
          </select>
        </div>

        <div>
          <div style={{ color: 'var(--sb-text)', fontWeight: 500 }}>
            {milestone.label}
            {milestone.is_decision && (
              <span style={{ marginLeft: 8, fontSize: 10, fontFamily: 'var(--sb-font-mono)', color: 'var(--sb-text-muted)' }}>
                DECISION
              </span>
            )}
          </div>
          {isLocked && (
            <div style={{ fontSize: 12, color: 'var(--sb-text-muted)', marginTop: 4 }}>
              Waiting on: {blocking.map(b => b.label).join(', ')}
            </div>
          )}
          {overdue && (
            <div className="sb-milestone-overdue-caption">
              {daysOver} day{daysOver === 1 ? '' : 's'} overdue
            </div>
          )}
          {milestone.note && (
            <div style={{ fontSize: 11, color: 'var(--sb-text-secondary)', marginTop: 4, fontStyle: 'italic' }}>
              {milestone.note}
            </div>
          )}
          {hasTracking && (
            <div style={{ fontSize: 12, color: 'var(--sb-text-secondary)', marginTop: 6 }}>
              {[
                milestone.external_party_ref,
                milestone.expected_resolution_at
                  ? `expected ${fmtDate(milestone.expected_resolution_at)}`
                  : null,
                milestone.block_reason_code
                  ? (BLOCK_REASON_CODES.find(r => r.code === milestone.block_reason_code)?.label
                     || milestone.block_reason_code)
                  : null,
              ].filter(Boolean).join(' · ')}
            </div>
          )}
          <div style={{ marginTop: 6, display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
            <button
              type="button"
              className="sb-link"
              style={{ fontSize: 12, padding: 0 }}
              onClick={() => { setNoteDraft(milestone.note || ''); setNoteOpen(o => !o) }}
            >
              {milestone.note ? 'Edit note' : '+ Add note'}
            </button>
            <button
              type="button"
              className="sb-link"
              style={{ fontSize: 12, padding: 0 }}
              onClick={() => setTrackOpen(o => !o)}
            >
              {hasTracking ? 'Edit ETA & supplier' : '+ Track ETA & supplier'}
            </button>
            {error && (
              <span style={{ fontSize: 12, color: 'var(--sb-red)' }}>{error}</span>
            )}
          </div>
        </div>

        <div>
          {team && (
            <span className="sb-status-pill" style={{ '--pill-color': team.color }}>
              {team.label}
            </span>
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div>
            <div style={{ fontSize: 10, color: 'var(--sb-text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 2 }}>
              Due
            </div>
            <input
              type="date"
              className={`sb-date-input ${overdue ? 'is-overdue' : ''}`}
              value={milestone.due_date || ''}
              onChange={handleDueDateChange}
              disabled={busy}
            />
          </div>
          <div>
            <div style={{ fontSize: 10, color: 'var(--sb-text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 6 }}>
              <span>Projected{projectedDates.userSet ? ' · manual' : ''}</span>
              {projectedDates.userSet && (
                <button
                  type="button"
                  className="sb-link"
                  style={{ fontSize: 10, padding: 0, textTransform: 'none', letterSpacing: 0 }}
                  onClick={handleProjectedReset}
                  disabled={busy}
                >
                  reset
                </button>
              )}
            </div>
            <input
              type="date"
              className="sb-date-input"
              value={projectedInputValue}
              onChange={handleProjectedChange}
              disabled={busy}
            />
            {dateDisplay && dateDisplay.tone && dateDisplay.tone !== 'calm' && dateDisplay.tone !== 'done' && dateDisplay.promised && dateDisplay.projected && (
              <div
                style={{
                  fontSize: 11,
                  marginTop: 4,
                  color: dateDisplay.tone === 'red'
                    ? 'var(--sb-red, #b54040)'
                    : 'var(--sb-amber, #b8842a)',
                  fontWeight: 500,
                }}
              >
                Promised {dateDisplay.promised} · diverges by {projectedDates.divergenceDays}d
              </div>
            )}
            {dateDisplay && dateDisplay.tone === 'done' && (
              <div style={{ fontSize: 11, marginTop: 4, color: 'var(--sb-text-muted)', fontStyle: 'italic' }}>
                {dateDisplay.single}
              </div>
            )}
          </div>
        </div>

        <div style={{ fontSize: 11, color: 'var(--sb-text-muted)', fontFamily: 'var(--sb-font-mono)' }}>
          {milestone.status_date ? fmtDate(milestone.status_date) : '—'}
        </div>
      </div>

      {noteOpen && (
        <div className="sb-milestone-edit-row">
          <textarea
            className="sb-textarea"
            value={noteDraft}
            onChange={e => setNoteDraft(e.target.value)}
            placeholder="Note for this milestone (logged as an event)"
            rows={2}
            disabled={busy}
          />
          <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
            <button type="button" className="sb-btn-primary" onClick={handleNoteSave} disabled={busy}>
              Save note
            </button>
            <button type="button" className="sb-btn-secondary" onClick={() => { setNoteOpen(false); setNoteDraft('') }} disabled={busy}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {trackOpen && (
        <div className="sb-milestone-edit-row">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: 12, color: 'var(--sb-text-muted)' }}>Supplier / cemetery / party</span>
              <input
                type="text"
                className="sb-input"
                value={trackParty}
                onChange={e => setTrackParty(e.target.value)}
                placeholder="e.g. Coldspring, Holy Cross — Maria, PO #4427"
                disabled={busy}
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: 12, color: 'var(--sb-text-muted)' }}>Expected back</span>
              <input
                type="date"
                className="sb-input"
                value={trackDate}
                onChange={e => setTrackDate(e.target.value)}
                disabled={busy}
              />
            </label>
          </div>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 10 }}>
            <span style={{ fontSize: 12, color: 'var(--sb-text-muted)' }}>Block reason (only if this milestone is stuck)</span>
            <select
              className="sb-input"
              value={trackReason}
              onChange={e => setTrackReason(e.target.value)}
              disabled={busy}
            >
              <option value="">— No block reason —</option>
              {BLOCK_REASON_CODES.map(r => (
                <option key={r.code} value={r.code}>{r.label}</option>
              ))}
            </select>
          </label>
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button type="button" className="sb-btn-primary" onClick={handleTrackSave} disabled={busy}>
              Save
            </button>
            <button
              type="button"
              className="sb-btn-secondary"
              onClick={() => {
                setTrackOpen(false)
                setTrackParty(milestone.external_party_ref     || '')
                setTrackDate(milestone.expected_resolution_at  || '')
                setTrackReason(milestone.block_reason_code     || '')
              }}
              disabled={busy}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// =============================================================================
// EVENT LOG
// =============================================================================

function EventLog({ events, milestones }) {
  const milestoneByKey = useMemo(() => {
    const m = new Map()
    for (const ms of (milestones || [])) m.set(ms.milestone_key, ms)
    return m
  }, [milestones])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {events.map(e => (
        <div key={e.id} className="sb-card" style={{ padding: '10px 14px', marginBottom: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{
                fontSize: 10,
                fontFamily: 'var(--sb-font-mono)',
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
                padding: '2px 6px',
                borderRadius: 'var(--sb-r-sm)',
                background: e.is_override ? 'var(--sb-red-bg)' : 'var(--sb-surface-muted)',
                color: e.is_override ? 'var(--sb-red)' : 'var(--sb-text-muted)',
                fontWeight: 500,
              }}>
                {e.is_override ? 'OVERRIDE' : eventTypeLabel(e.event_type)}
              </span>
              {e.milestone_key && (
                <span style={{ fontSize: 12, color: 'var(--sb-text)' }}>
                  {milestoneByKey.get(e.milestone_key)?.label || e.milestone_key}
                </span>
              )}
            </div>
            <span style={{ fontSize: 11, color: 'var(--sb-text-muted)', fontFamily: 'var(--sb-font-mono)' }}>
              {fmtRelative(e.created_at)}
            </span>
          </div>
          {renderEventBody(e)}
        </div>
      ))}
    </div>
  )
}

function eventTypeLabel(t) {
  const map = {
    job_created:              'Job created',
    job_closed:               'Job closed',
    job_status_changed:       'Status',
    milestone_status_changed: 'Status',
    milestone_note_added:     'Note',
    milestone_assigned:       'Assigned',
    milestone_due_date_set:   'Due date',
    next_action_set:          'Next action',
    cascade_applied:          'Cascade',
    override:                 'Override',
    note_added:               'Note',
  }
  return map[t] || t
}

function renderEventBody(e) {
  const payload = e.payload || {}
  const parts = []
  if (payload.from !== undefined && payload.to !== undefined) {
    parts.push(`${formatVal(payload.from)} → ${formatVal(payload.to)}`)
  }
  if (payload.affected_keys && Array.isArray(payload.affected_keys)) {
    parts.push(`${payload.affected_keys.length} dependent milestone${payload.affected_keys.length === 1 ? '' : 's'} marked not needed`)
  }
  if (payload.staff_review_required) {
    parts.push('Staff review required: OTHER service type used')
  }
  if (payload.milestone_count !== undefined) {
    parts.push(`${payload.milestone_count} milestone${payload.milestone_count === 1 ? '' : 's'} initialized`)
  }
  if (payload.creation_source) {
    const sourceLabel = payload.creation_source === 'wizard'   ? 'Auto-created on signing'
                      : payload.creation_source === 'backfill' ? 'Backfilled from legacy order'
                      : 'Manual'
    parts.push(sourceLabel)
  }
  if (payload.triggered_by) {
    const triggerLabel = payload.triggered_by === 'waiting_hint'
                       ? 'Set via waiting-hint'
                       : `Triggered by: ${payload.triggered_by}`
    parts.push(triggerLabel)
  }
  return (
    <div style={{ fontSize: 12, color: 'var(--sb-text-secondary)', lineHeight: 1.5 }}>
      {parts.length > 0 && <div className="sb-mono" style={{ fontSize: 11 }}>{parts.join(' · ')}</div>}
      {e.note && <div style={{ marginTop: 4 }}>{e.note}</div>}
      {e.override_reason && (
        <div style={{ marginTop: 4, color: 'var(--sb-red)', fontStyle: 'italic' }}>
          Override reason: {e.override_reason}
        </div>
      )}
    </div>
  )
}

function formatVal(v) {
  if (v === null || v === undefined) return '—'
  if (typeof v === 'string') return v
  return JSON.stringify(v)
}

// =============================================================================
// JOB-LEVEL CONTROLS — DELETED 2026-05-21
// =============================================================================
// JobControls (the 3-up status / next-action / note panel) was removed in
// the JobDetail Phase 1 redesign. Its operational functions live elsewhere now:
//   • overall_status changes → JobActionsDisclosure inside the hero meta strip
//   • next_action manual override → derived NRA in the hero (manual edit UI
//     to land in a later phase if operationally needed; deferred)
//   • free-form note → JobActionsDisclosure "Add note" section (Phase 1).
//                       In Phase 3, this becomes the "+ Add note" affordance
//                       at the bottom of the activity stream.
//
// All existing writes (setJobOverallStatus, setNextAction, addJobNote) are
// preserved; only the UI surface changed.

// =============================================================================
// WAITING-STATE TRANSITION HINT BANNER
// =============================================================================
// Soft suggestion surface for operational continuation #3. Renders when the
// milestone-to-waiting heuristic fires AND the gates in JobDetail pass.
// Hint-only — no automation. Accept calls setJobOverallStatus with a
// `waiting_hint` audit source; dismiss is a pure UI clear (no DB write).
// JobDetail owns the cooldown (dismissedKinds Set) and auto-clear-on-manual.

function WaitingHintBanner({ hint, onAccept, onDismiss }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const kindLabel = jobStatusInfo(hint.suggestedKind).label
  const partyLabel =
    hint.suggestedKind === 'waiting_on_customer' ? 'customer' :
    hint.suggestedKind === 'waiting_on_cemetery' ? 'cemetery' :
    hint.suggestedKind === 'waiting_on_supplier' ? 'supplier' :
    kindLabel.toLowerCase()

  const handleAccept = async () => {
    setBusy(true); setError(null)
    const res = await onAccept()
    if (!res || !res.ok) {
      setBusy(false)
      setError(res?.error || 'Update failed')
    }
    // On success the parent clears the hint and this component unmounts.
  }

  return (
    <div
      className="sb-existing-banner"
      style={{
        background: 'var(--sb-gold-pale, #f5ede0)',
        border: '0.5px solid var(--sb-gold-light, #b8935a)',
        borderRadius: 'var(--sb-r-sm)',
        padding: '12px 16px',
        marginBottom: 16,
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        justifyContent: 'space-between',
        flexWrap: 'wrap',
      }}
    >
      <div style={{ fontSize: 13, flex: '1 1 auto', minWidth: 240 }}>
        <strong>“{hint.sourceLabel}”</strong> usually means the job is now waiting on the {partyLabel}.{' '}
        Update overall status to <strong>{kindLabel}</strong>?
        {error && (
          <div style={{ marginTop: 4, fontSize: 12, color: 'var(--sb-red, #b54040)' }}>
            {error}
          </div>
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button
          type="button"
          className="sb-btn-primary"
          onClick={handleAccept}
          disabled={busy}
        >
          {busy ? 'Updating…' : `Yes, set ${kindLabel}`}
        </button>
        <button
          type="button"
          className="sb-link"
          onClick={onDismiss}
          disabled={busy}
        >
          Dismiss
        </button>
      </div>
    </div>
  )
}

// =============================================================================
// OVERRIDE MODAL
// =============================================================================
// Opens when a milestone status change is gated by unsatisfied requires[].
// Captures a free-text reason (required by data layer) and calls
// updateMilestoneWithOverride, which writes the override event.

function OverrideModal({ jobId, request, onClose, onConfirmed }) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const confirm = async () => {
    const r = reason.trim()
    if (!r) { setError('Reason is required'); return }
    setBusy(true); setError(null)
    const res = await updateMilestoneWithOverride(
      jobId,
      request.milestoneKey,
      request.patch,
      r,
    )
    setBusy(false)
    if (res.ok) onConfirmed?.()
    else setError(res.error || 'Override failed')
  }

  return (
    <div className="sb-modal-backdrop" onClick={onClose}>
      <div className="sb-modal-dialog" onClick={e => e.stopPropagation()}>
        <div className="sb-modal-title">Override readiness gate</div>
        <div className="sb-modal-body">
          <div style={{ marginBottom: 8 }}>
            <strong>{request.milestoneLabel}</strong> isn't ready yet.
          </div>
          <div style={{ fontSize: 13, color: 'var(--sb-text-muted)', marginBottom: 12 }}>
            Waiting on: {(request.blockingLabels || request.blockingKeys || []).join(', ')}
          </div>
          <div style={{ fontSize: 13, marginBottom: 6 }}>
            Why are you bypassing? (required — will be logged as an override event)
          </div>
          <textarea
            className="sb-textarea"
            value={reason}
            onChange={e => setReason(e.target.value)}
            rows={3}
            placeholder="e.g. Customer urgency · supplier shipped early · scheduling pressure"
            disabled={busy}
            autoFocus
            style={{ width: '100%' }}
          />
          {error && <div style={{ fontSize: 12, color: 'var(--sb-red)', marginTop: 6 }}>{error}</div>}
        </div>
        <div className="sb-modal-actions">
          <button type="button" className="sb-btn-secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="sb-btn-primary" onClick={confirm} disabled={busy || !reason.trim()}>
            {busy ? 'Saving…' : 'Override and continue'}
          </button>
        </div>
      </div>
    </div>
  )
}

// =============================================================================
// STYLES — appended via a single <style> tag at component mount
// =============================================================================

const localStyles = `
  /* ── Hubs / Jobs — All view toggle ─────────────────────────────────────
     A small pill-pair segmented control that lives at the top of the Jobs
     tab. Same vocabulary as the role chip + owner view toggle — surface-muted
     track, surface-white active chip, subtle box-shadow on active. */
  .sb-jobs-view-toggle {
    display: inline-flex;
    gap: 4px;
    padding: 4px;
    background: var(--sb-surface-muted);
    border-radius: 999px;
  }
  .sb-jobs-view-chip {
    background: transparent;
    border: none;
    color: var(--sb-text-muted);
    font: inherit;
    font-size: 13px;
    padding: 6px 14px;
    border-radius: 999px;
    cursor: pointer;
    transition: background 0.12s, color 0.12s;
  }
  .sb-jobs-view-chip:hover {
    color: var(--sb-text);
  }
  .sb-jobs-view-chip-active {
    background: var(--sb-surface);
    color: var(--sb-text);
    font-weight: 500;
    box-shadow: 0 1px 2px rgba(15, 20, 25, 0.06);
  }
  .sb-jobs-view-chip:focus-visible {
    outline: 0.5px solid var(--sb-accent);
    outline-offset: 1px;
  }
  /* When the toggle renders above the JobsListView (flat mode), give it a
     touch of breathing room so it doesn't crowd the page header. */
  .sb-crm-page > .sb-jobs-view-toggle {
    margin: 16px 0 0 32px;
  }
  /* JOBS-OPERATIONAL-HUBS Phase 2A — the JobDetail in-page tab pair (Job view
     / Design packet) lives between the Hero and the body. Same pill-pair
     vocabulary as the Hubs/All toggle; just needs spacing tuned for the
     in-detail context. */
  .sb-job-detail-tabs {
    margin: 8px 0 28px 0;
  }
  /* Print: hide the in-detail tab pair — printed packets don't carry
     interactive chrome. */
  @media print {
    .sb-job-detail-tabs { display: none; }
  }

  /* ── JOB DETAIL — HERO ZONE ──────────────────────────────────────────── */
  /* JobDetail Phase 1 redesign (2026-05-21). Replaces the previous
     page-head + metric grid + JobControls panel block. Crafted-document
     posture: single column, generous vertical rhythm, no card chrome,
     restrained typography. */

  /* JobDetail hero — refinement pass 2026-05-21.
     Spacing rhythm follows a deliberate geometric climb then settle:
       eyebrow:24 → surname:16 → deceased:32 → service:48 → NRA:40 → fact row:64
     The largest gap (48) lands above the NRA so the eye registers it as a
     distinct moment, not a paragraph. */

  .sb-job-hero {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 56px;
    margin-bottom: 64px;
    align-items: start;
  }
  /* Constrain the content column to an intimate reading measure (~680px).
     The hero is composed, not panoramic. Meta strip floats outside this width. */
  .sb-job-hero-content {
    min-width: 0;
    max-width: 680px;
  }

  /* Customer surname — declarative, near-black. Slightly smaller than the
     first pass (32 vs 36) for operational density; letter-spacing relaxed
     by a hair so the type doesn't read as compressed. Primary read. */
  .sb-job-hero-name {
    font-size: 32px;
    font-weight: 500;
    letter-spacing: -0.018em;
    color: var(--sb-text);
    margin: 0 0 16px;
    line-height: 1.1;
  }

  /* Deceased's name + dates — the most human element. Generous line-height
     so the name + dates read as a quiet unit, not crowded. Full contrast
     color (not muted) — the deceased deserves typographic gravity. */
  .sb-job-hero-deceased {
    font-size: 22px;
    font-weight: 400;
    letter-spacing: -0.003em;
    color: var(--sb-text);
    margin-bottom: 32px;
    line-height: 1.45;
  }
  .sb-job-hero-dates {
    color: var(--sb-text-muted);
    font-family: var(--sb-font-mono);
    font-size: 17px;
    font-variant-numeric: tabular-nums;
    letter-spacing: 0;
  }
  .sb-job-hero-deceased-other {
    color: var(--sb-text-muted);
    font-size: 15px;
    margin-left: 8px;
  }

  /* Service descriptor — one quiet line. Service type + cemetery, middle-
     dot separated by the JSX. The 48px below sets up the NRA's moment. */
  .sb-job-hero-service {
    font-size: 17px;
    font-weight: 400;
    color: var(--sb-text-secondary);
    margin-bottom: 48px;
    line-height: 1.5;
  }

  /* NRA sentence — the operational center of gravity. Weight 500 (slight
     emphasis lifts it from the surrounding paragraph rhythm). Full-contrast
     color so the eye lands. Max-width 52ch keeps it composed. */
  .sb-job-hero-nra {
    font-size: 22px;
    font-weight: 500;
    color: var(--sb-text);
    line-height: 1.4;
    letter-spacing: -0.008em;
    margin-bottom: 40px;
    max-width: 48ch;
  }
  .sb-job-hero-nra-urgent {
    color: var(--sb-accent);
  }
  /* Manual override: same visual prominence as derived NRA. Removed the
     italic signal — manual vs derived doesn't need typographic distinction;
     the NRA is the NRA. */
  .sb-job-hero-nra-manual {}

  /* Fact row — status pill on left, balance summary aligned to the right
     edge of the reading column. Aligned baseline so they read as one line. */
  .sb-job-hero-fact-row {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 24px;
    flex-wrap: wrap;
  }
  .sb-job-hero-balance {
    display: inline-flex;
    align-items: baseline;
    gap: 4px 12px;
    flex-wrap: wrap;
    font-size: 15px;
    color: var(--sb-text-secondary);
    font-variant-numeric: tabular-nums;
  }
  /* Each (number, label) pair sits tight; the gap between pairs is wider.
     Achieved via flex gap on the parent + 4px column gap, 12px row gap. */
  .sb-job-hero-balance-num {
    font-family: var(--sb-font-mono);
    color: var(--sb-text);
    font-size: 17px;
    margin-right: 4px;
  }
  .sb-job-hero-balance-sep {
    color: var(--sb-text-muted);
    font-size: 13px;
    margin-right: 8px;
  }

  /* Meta strip — right-aligned, quiet. Generous gap so each line reads as
     its own element. No borders, no chrome. */
  .sb-job-hero-meta {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 12px;
    min-width: 180px;
    text-align: right;
    font-size: 14px;
  }
  .sb-job-hero-meta-line {
    color: var(--sb-text-muted);
  }
  .sb-job-hero-meta-link {
    background: transparent;
    border: none;
    padding: 4px 0;
    color: var(--sb-text-secondary);
    font: inherit;
    font-size: 14px;
    cursor: pointer;
    transition: color 0.15s;
  }
  .sb-job-hero-meta-link:hover {
    color: var(--sb-text);
  }

  /* Job actions disclosure — quieter, less form-chrome. Lighter separator
     above (background-tinted instead of full border). Inputs lose visible
     borders and gain a subtle background; buttons slimmer. */
  .sb-job-hero-actions {
    margin-top: 16px;
    text-align: left;
    width: 280px;
    display: flex;
    flex-direction: column;
    gap: 28px;
    padding: 20px 0 8px;
    border-top: 0.5px solid var(--sb-border);
  }
  .sb-job-hero-action-section {
    display: flex;
    flex-direction: column;
  }
  .sb-job-hero-action-label {
    font-size: 12px;
    font-weight: 500;
    color: var(--sb-text-muted);
    margin-bottom: 10px;
    letter-spacing: 0.01em;
  }
  /* Quieter form controls inside the disclosure. */
  .sb-job-hero-actions .sb-text-input,
  .sb-job-hero-actions .sb-textarea {
    background: var(--sb-surface-muted);
    border: none;
    border-radius: var(--sb-r-sm);
    font-size: 14px;
    padding: 9px 11px;
  }
  .sb-job-hero-actions .sb-text-input:focus,
  .sb-job-hero-actions .sb-textarea:focus {
    background: var(--sb-surface);
    outline: 0.5px solid var(--sb-border);
  }
  .sb-job-hero-actions .sb-status-select {
    font-size: 14px;
    padding: 7px 9px;
  }
  .sb-job-hero-actions .sb-btn-primary {
    font-size: 14px;
    padding: 9px 15px;
  }
  .sb-job-hero-actions .sb-btn-secondary {
    font-size: 14px;
    padding: 9px 13px;
  }

  /* Responsive — three tiers: tablet (under 900) collapses meta below
     content; phone (under 600) tightens hero typography slightly so
     wrapping stays elegant. */
  @media (max-width: 900px) {
    .sb-job-hero {
      grid-template-columns: 1fr;
      gap: 40px;
    }
    .sb-job-hero-meta {
      align-items: flex-start;
      text-align: left;
    }
    .sb-job-hero-actions {
      width: 100%;
      max-width: 360px;
    }
  }
  @media (max-width: 600px) {
    .sb-job-hero-name {
      font-size: 28px;
    }
    .sb-job-hero-deceased {
      font-size: 19px;
    }
    .sb-job-hero-nra {
      font-size: 18px;
    }
    .sb-job-hero-service {
      margin-bottom: 32px;
    }
  }

  /* ── Wide page variant — the department dashboard ──────────────────────────
     The default sb-page is constrained to a reading measure. The Jobs tab now
     hosts a department-aware grid that wants full-width breathing room. The
     .sb-page-wide modifier removes the inner max-width while preserving the
     standard page padding. JobDetail keeps the calm reading-measure layout
     because that route renders without sb-page-wide. */
  .sb-page-wide {
    max-width: none;
  }

  /* ── Commit 4 additions ────────────────────────────────────────────────── */

  .sb-milestone-row {
    padding: 8px 18px;
    border-bottom: 0.5px solid var(--sb-border);
  }
  .sb-milestone-row:last-child { border-bottom: none; }
  .sb-milestone-row-main {
    display: grid;
    grid-template-columns: 150px 1fr 110px 140px 90px;
    gap: 12px;
    align-items: start;
    font-size: 12px;
  }

  .sb-status-select {
    font: inherit;
    font-size: 11px;
    font-family: var(--sb-font-mono);
    letter-spacing: 0.04em;
    text-transform: uppercase;
    padding: 4px 8px;
    border-radius: 999px;
    border: 0.5px solid var(--pill-color, var(--sb-border));
    color: var(--pill-color, var(--sb-text));
    background: transparent;
    cursor: pointer;
    max-width: 100%;
  }
  .sb-status-select:focus {
    outline: none;
    box-shadow: 0 0 0 2px var(--sb-surface-muted);
  }
  .sb-status-select:disabled { opacity: 0.6; cursor: wait; }

  .sb-date-input {
    font: inherit;
    font-size: 11px;
    font-family: var(--sb-font-mono);
    padding: 4px 6px;
    border-radius: var(--sb-r-sm);
    border: 0.5px solid var(--sb-border);
    background: var(--sb-surface);
    color: var(--sb-text);
    width: 130px;
  }
  .sb-date-input:disabled { opacity: 0.6; cursor: wait; }
  /* Post-J1-P1 stabilization — overdue cue on the milestone date input */
  .sb-date-input.is-overdue {
    border-color: var(--sb-red, #b54040);
    color: var(--sb-red, #b54040);
    font-weight: 600;
  }
  .sb-milestone-overdue-caption {
    font-size: 11px;
    color: var(--sb-red, #b54040);
    font-style: italic;
    margin-top: 2px;
    font-family: var(--sb-font-mono);
    letter-spacing: 0.02em;
  }

  .sb-text-input {
    font: inherit;
    font-size: 13px;
    padding: 6px 8px;
    border-radius: var(--sb-r-sm);
    border: 0.5px solid var(--sb-border);
    background: var(--sb-surface);
    color: var(--sb-text);
  }
  .sb-text-input:focus { outline: none; border-color: var(--sb-accent, var(--sb-text)); }
  .sb-text-input:disabled { opacity: 0.6; cursor: wait; }

  .sb-textarea {
    font: inherit;
    font-size: 13px;
    line-height: 1.4;
    padding: 6px 8px;
    border-radius: var(--sb-r-sm);
    border: 0.5px solid var(--sb-border);
    background: var(--sb-surface);
    color: var(--sb-text);
    resize: vertical;
  }
  .sb-textarea:focus { outline: none; border-color: var(--sb-accent, var(--sb-text)); }
  .sb-textarea:disabled { opacity: 0.6; cursor: wait; }

  .sb-milestone-edit-row {
    margin-top: 8px;
    padding: 8px 18px 4px 18px;
    background: var(--sb-surface-muted);
    border-radius: var(--sb-r-sm);
  }

  .sb-job-controls {
    padding: 16px 18px;
  }
  .sb-job-controls-grid {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    gap: 18px;
  }
  @media (max-width: 1000px) {
    .sb-job-controls-grid { grid-template-columns: 1fr; }
    .sb-milestone-row-main { grid-template-columns: 1fr; gap: 6px; }
  }

  .sb-modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(15, 20, 25, 0.45);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    padding: 20px;
  }
  .sb-modal-dialog {
    background: var(--sb-surface);
    border: 0.5px solid var(--sb-border);
    border-radius: var(--sb-r-md);
    max-width: 520px;
    width: 100%;
    box-shadow: 0 8px 32px rgba(0,0,0,0.18);
  }
  .sb-modal-title {
    padding: 14px 18px;
    border-bottom: 0.5px solid var(--sb-border);
    font-size: 14px;
    font-weight: 500;
    color: var(--sb-text);
  }
  .sb-modal-body { padding: 14px 18px; }
  .sb-modal-actions {
    padding: 12px 18px;
    border-top: 0.5px solid var(--sb-border);
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }

  /* ── Search row (top of Jobs page) ────────────────────────────────────── */
  .sb-jobs-search-row {
    margin-bottom: 20px;
  }

  /* ── Promise strip (top of JobDetail) ─────────────────────────────────── */
  /* Eyebrow makes the role of this surface unmistakable ("Promise tracker");
     the add button is the high-contrast accent so it doesn't read as a
     ghost link. */
  .sb-job-promise-strip {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 12px 16px;
    margin-bottom: 16px;
    background: var(--sb-surface);
    border: 0.5px solid var(--sb-border);
    border-radius: var(--sb-r-sm, 6px);
    flex-wrap: wrap;
  }
  .sb-job-promise-strip-active {
    background: var(--sb-red-bg, #fbe5e5);
    border-color: var(--sb-red, #b54040);
  }
  .sb-job-promise-strip-body {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
    flex: 1;
  }
  .sb-job-promise-strip-eyebrow {
    font-size: 11px;
    font-weight: 500;
    color: var(--sb-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  .sb-job-promise-strip-active .sb-job-promise-strip-eyebrow {
    color: var(--sb-red, #b54040);
  }
  .sb-job-promise-strip-active-body {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
  }
  .sb-job-promise-strip-icon {
    font-size: 18px;
    line-height: 1;
  }
  .sb-job-promise-strip-label {
    font-size: 13px;
    font-weight: 600;
    color: var(--sb-red, #b54040);
  }
  .sb-job-promise-strip-badges {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }
  .sb-job-promise-strip-empty {
    font-size: 13px;
    color: var(--sb-text-muted);
    font-style: italic;
  }
  .sb-job-promise-strip-add {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    background: var(--sb-accent, #b8842a);
    border: 0.5px solid transparent;
    color: white;
    font: inherit;
    font-size: 13px;
    font-weight: 500;
    padding: 8px 16px;
    border-radius: var(--sb-r-sm, 6px);
    cursor: pointer;
    white-space: nowrap;
  }
  .sb-job-promise-strip-add:hover {
    filter: brightness(0.95);
  }
  .sb-job-promise-strip-active .sb-job-promise-strip-add {
    background: var(--sb-red, #b54040);
  }
  .sb-job-promise-strip-active .sb-job-promise-strip-add:hover {
    filter: brightness(0.92);
  }

  /* ── Promise modal ────────────────────────────────────────────────────── */
  .sb-promise-modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(15, 20, 25, 0.42);
    z-index: 1000;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
  }
  .sb-promise-modal {
    background: var(--sb-surface);
    border-radius: var(--sb-r-md, 10px);
    box-shadow: 0 16px 48px rgba(15, 20, 25, 0.24);
    max-width: 480px;
    padding: 28px 32px 24px;
    width: 100%;
  }
  .sb-promise-modal-title {
    font-size: 18px;
    font-weight: 500;
    color: var(--sb-text);
    margin: 0 0 8px;
  }
  .sb-promise-modal-body {
    font-size: 13px;
    color: var(--sb-text-secondary);
    line-height: 1.55;
    margin: 0 0 16px;
  }
  .sb-promise-modal-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
    margin-bottom: 12px;
  }
  .sb-promise-modal-field {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-bottom: 12px;
  }
  .sb-promise-modal-label {
    font-size: 12px;
    color: var(--sb-text-muted);
    font-weight: 500;
  }
  .sb-promise-modal-input {
    font: inherit;
    font-size: 14px;
    padding: 8px 10px;
    border: 0.5px solid var(--sb-border);
    border-radius: var(--sb-r-sm, 6px);
    background: var(--sb-surface);
    color: var(--sb-text);
  }
  .sb-promise-modal-textarea {
    resize: vertical;
    min-height: 64px;
  }
  .sb-promise-modal-error {
    color: var(--sb-red, #b54040);
    font-size: 13px;
    padding: 8px 10px;
    background: var(--sb-red-bg, #fbe5e5);
    border-radius: var(--sb-r-sm, 6px);
    margin-bottom: 12px;
  }
  .sb-promise-modal-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }
  .sb-promise-modal-cancel,
  .sb-promise-modal-save {
    font: inherit;
    font-size: 14px;
    padding: 8px 18px;
    border-radius: var(--sb-r-sm, 6px);
    cursor: pointer;
    font-weight: 500;
    border: 0.5px solid transparent;
  }
  .sb-promise-modal-cancel {
    background: transparent;
    color: var(--sb-text-muted);
    border-color: var(--sb-border);
  }
  .sb-promise-modal-cancel:hover {
    color: var(--sb-text);
    background: var(--sb-surface-muted);
  }
  .sb-promise-modal-save {
    background: var(--sb-accent, #b8842a);
    color: white;
  }
  .sb-promise-modal-save:hover:not(:disabled) {
    filter: brightness(0.95);
  }
  .sb-promise-modal-cancel:disabled,
  .sb-promise-modal-save:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
`

// Inject styles once when the module loads (similar to how Stonebooks.jsx
// injects shellStyles). Idempotent: only adds the <style> tag if missing.
if (typeof document !== 'undefined' && !document.getElementById('sb-jobs-tab-styles')) {
  const tag = document.createElement('style')
  tag.id = 'sb-jobs-tab-styles'
  tag.textContent = localStyles
  document.head.appendChild(tag)
}
