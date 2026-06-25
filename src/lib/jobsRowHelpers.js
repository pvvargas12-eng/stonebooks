// =============================================================================
// 📚 Stonebooks — JobRow helpers (constants + enrichment + stage derivation)
// =============================================================================
// Pure-JS helpers split out from jobsRow.jsx so Fast Refresh stays clean —
// react-refresh/only-export-components requires component files to export
// nothing but components. Everything imported by the JobRow render (and by
// JobsListView / JobsDepartmentView enrichment) lives here.
//
// JOBS-OPERATIONAL-HUBS Phase 1A extraction. Pre-Phase-1A these helpers were
// inline in JobsTab.jsx — moved here so the new 4-hub view in
// JobsDepartmentView can render the same family-first row without
// duplicating logic.
// =============================================================================

import {
  computeOrderPressure,
  rowGrandTotal, rowTotalPaid,
  hasUnsatisfiedRequires,
  deriveDesignStatus, deriveStoneStatus, deriveFdnStatus,
  setBlockReason, milestoneDone,
} from './stonebooksData'

// ── Constants ────────────────────────────────────────────────────────────────

// FAMILY/STONE | JOB ID + ORDER# | CEMETERY+rep | STAGE | PAYMENT | BLOCKER | AGE | UPDATED
// UX rebalance from JOBS-RESKIN-PASS: CEMETERY 1.0→1.1 (real names like
// "Mountainview Cemetery" were tight); BLOCKER 1.2→1.1 (longest current
// label "Awaiting proof approval" still fits ~150px in 1.1fr).
// minmax(floor, fr) — same proportions, px floors so columns stay readable on
// 1180–1440px laptops (no crush). Family cell truncates via .sb-crm-primary (Wave 1).
export const ROW_GRID = 'minmax(120px, 1.4fr) minmax(72px, 0.75fr) minmax(96px, 1.1fr) minmax(78px, 0.85fr) minmax(92px, 1.05fr) minmax(96px, 1.1fr) minmax(48px, 0.45fr) minmax(56px, 0.6fr)'

// Milestone group display label + canonical render order. JobDetail's
// per-group milestone cards iterate GROUP_ORDER to land the design / permit /
// stone / etching cards in a stable sequence.
export const GROUP_ORDER = [
  'intake', 'design', 'permit', 'stone', 'photo',
  'etching', 'production', 'foundation', 'install', 'closeout',
]
export const GROUP_LABEL = {
  intake:     'Intake',
  design:     'Design',
  permit:     'Permit',
  stone:      'Stone',
  photo:      'Photo',
  etching:    'Etching',
  production: 'Production',
  foundation: 'Foundation',
  install:    'Install',
  closeout:   'Closeout',
}

// Coarse stage buckets folded into 4 operator-vocabulary headers. The
// 'install' bucket includes 'field' so mausoleum_door door-trip work
// surfaces under Install on the stage pill — same visual treatment as
// a stone install.
export const STAGE_BUCKETS = {
  intake:     new Set(['intake', 'design', 'permit']),
  production: new Set(['stone', 'photo', 'etching', 'production', 'foundation']),
  install:    new Set(['install', 'field']),
  closeout:   new Set(['closeout']),
}
export const STAGE_BUCKET_LABEL = {
  intake:     'Intake',
  production: 'Production',
  install:    'Install',
  closeout:   'Closeout',
}

export function bucketForGroup(group) {
  for (const code of ['intake', 'production', 'install', 'closeout']) {
    if (STAGE_BUCKETS[code]?.has(group)) return code
  }
  return 'intake'
}

// Severity / recency helpers used by the action-priority sort. Both the
// hub list and the flat list sort the same way via these.
export const SEVERITY_RANK = { red: 0, amber: 1, blue: 2 }

export function recencyBand(lastActivity) {
  if (!lastActivity) return 4
  const days = Math.floor((Date.now() - lastActivity) / 86400000)
  if (days <= 7)  return 0
  if (days <= 30) return 1
  if (days <= 90) return 2
  return 3
}

export function severityRank(blocker) {
  if (!blocker) return 3
  return SEVERITY_RANK[blocker.severity] ?? 3
}

// ── Stage detection ─────────────────────────────────────────────────────────
// Returns { group, fineLabel, bucketLabel }. The "current stage" is the
// milestone group of the first actionable (not_done, not_not_needed,
// requires-satisfied) milestone in sort_order. Fully-done jobs go to closeout.
// fineLabel = the specific milestone group ('Permit', 'Stone'). bucketLabel =
// the coarse bucket Paul reads at glance ('Intake', 'Production', 'Install',
// 'Closeout', or 'Done' for fully-finished jobs).

export function currentStage(job) {
  const milestones = job?.milestones || []
  if (milestones.length === 0) {
    return { group: 'intake', fineLabel: GROUP_LABEL.intake, bucketLabel: 'Intake' }
  }
  const byKey = new Map(milestones.map(m => [m.milestone_key, m]))
  const ordered = milestones.slice().sort((a, b) => (a.sort_order ?? 999) - (b.sort_order ?? 999))
  const actionable = ordered.find(m =>
    m.status !== 'done' && m.status !== 'not_needed' && !hasUnsatisfiedRequires(m, byKey)
  )
  if (actionable) {
    const group = actionable.group
    return {
      group,
      fineLabel: GROUP_LABEL[group] || group,
      bucketLabel: STAGE_BUCKET_LABEL[bucketForGroup(group)] || 'Intake',
    }
  }
  const allDone = ordered.every(m => m.status === 'done' || m.status === 'not_needed')
  if (allDone) return { group: 'closeout', fineLabel: 'Done', bucketLabel: 'Done' }
  // Fallback for override-driven in_progress milestones with unsatisfied
  // requires that aren't 'not_started' (preserves Workflow #2 fix from
  // JOBS-RESKIN-PASS).
  const firstNotDone = ordered.find(m => m.status !== 'done' && m.status !== 'not_needed')
  if (firstNotDone) {
    const group = firstNotDone.group
    return {
      group,
      fineLabel: GROUP_LABEL[group] || group,
      bucketLabel: STAGE_BUCKET_LABEL[bucketForGroup(group)] || 'Intake',
    }
  }
  return { group: 'intake', fineLabel: GROUP_LABEL.intake, bucketLabel: 'Intake' }
}

// Semantic tone ladder (gray-ish → in-flight → urgent → done):
//   intake bucket (intake / design / permit) → bronze (paperwork, inert)
//   production bucket → blue (in-flight)
//   install / field   → amber (truck out, scheduled trip)
//   closeout          → green (closing out)
export function mapStageToTone(group) {
  if (group === 'install' || group === 'field') return 'amber'
  if (group === 'closeout') return 'green'
  if (STAGE_BUCKETS.production.has(group)) return 'blue'
  return 'bronze'
}

// ── Display helpers ─────────────────────────────────────────────────────────

export function familyNameForJob(j) {
  const order = j.order || j._order
  const fromOrder = order?.primary_lastname && String(order.primary_lastname).trim()
  if (fromOrder) return fromOrder
  const fromCustomer = order?.customer?.last_name && String(order.customer.last_name).trim().toUpperCase()
  if (fromCustomer) return fromCustomer
  // No order — typically cemetery_order-linked crypt door job
  if (j.job_type === 'mausoleum_door') return 'Crypt door — TBD'
  return '—'
}

export function deceasedLabelForJob(j) {
  const dec = (j.order || j._order)?.deceased
  if (Array.isArray(dec) && dec.length > 0) {
    if (dec.length === 1) {
      const d = dec[0]
      const name = [d.firstName || d.first_name, d.lastName || d.last_name].filter(Boolean).join(' ').trim()
      return name || null
    }
    return 'Companion stone'
  }
  return null
}

export function jobTypeLabel(jobType, serviceTypes) {
  if (jobType === 'new_stone')       return 'New stone'
  if (jobType === 'mausoleum_door')  return 'Crypt door'
  if (jobType === 'cleaning_repair') return 'Cleaning/Repair'
  const st = (serviceTypes || []).map(s => String(s).toUpperCase())
  if (st.includes('INSCRIPTION') || st.includes('INSCRIPTIONS')) return 'Inscription'
  if (st.includes('ACID_WASH')) return 'Acid wash'
  return 'Order'
}

// ── enrichJob ───────────────────────────────────────────────────────────────
// Returns a shallow-cloned job with derived display fields attached as
// `_pressure`, `_stage`, `_familyName`, `_deceasedLabel`, `_total`, `_paid`,
// `_balance`, `_fillRatio`, `_lastActivity`, `_serviceTypesUp`, `_hasOrder`.
// Pure — no fetches, no side effects. Suitable for use inside React useMemo.
//
// last_update_at falls back to created_at so jobs born from migrations or
// orphan rows don't sink to band-4 in action-priority sort (Workflow #4 fix
// preserved from JOBS-RESKIN-PASS). No Date.now() fallback — React 19's
// purity rule rejects it inside render; truly malformed rows belong at the
// bottom.

export function enrichJob(j) {
  const order = j.order || null
  const pressure = order
    ? computeOrderPressure(order, j, j.milestones)
    : { blocker: null, needsCall: false, callReasons: [], paymentState: 'none', ageDays: 0 }
  const stage = currentStage(j)
  const familyName = familyNameForJob(j)
  const deceasedLabel = deceasedLabelForJob(j)
  const total = order ? rowGrandTotal(order) : 0
  const paid  = order ? rowTotalPaid(order)  : 0
  const balance = Math.max(0, total - paid)
  const fillRatio = total > 0 ? paid / total : 0
  const lastActivity = j.last_update_at
    ? new Date(j.last_update_at).getTime()
    : (j.created_at ? new Date(j.created_at).getTime() : 0)
  const serviceTypesUp = new Set((order?.service_types || []).map(s => String(s).toUpperCase()))
  // Shared status dimensions + set-gate — same source as the Orders table and
  // the Scheduler blocked panel, so the three surfaces can't disagree.
  const design = order ? deriveDesignStatus(j) : null
  const stone  = order ? deriveStoneStatus(j) : null
  const fdn    = order ? deriveFdnStatus(j) : null
  const setBlock = (j.job_type === 'new_stone' && milestoneDone(j, 'production_completed') && !milestoneDone(j, 'installed'))
    ? setBlockReason(order, j)
    : null
  return {
    ...j,
    _order:           order,
    _pressure:        pressure,
    _stage:           stage,
    _familyName:      familyName,
    _deceasedLabel:   deceasedLabel,
    _total:           total,
    _paid:            paid,
    _balance:         balance,
    _fillRatio:       fillRatio,
    _lastActivity:    lastActivity,
    _serviceTypesUp:  serviceTypesUp,
    _hasOrder:        !!order,
    _design:          design,
    _stone:           stone,
    _fdn:             fdn,
    _setBlock:        setBlock,
  }
}
