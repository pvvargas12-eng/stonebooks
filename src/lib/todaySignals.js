// =============================================================================
// 📚 Stonebooks — Today signal engine (T-2 refinement pass)
// =============================================================================
// Pure derivation. No persistence, no notifications, no read/unread state.
// Today is a projection of live operational truth — every render recomputes.
//
// Public surface (unchanged from the first T-2 pass):
//   fetchTodayData()                              → { jobs, orders }
//   deriveTodaySignals({ jobs, orders, now })     → { l2, l3, l4, l5 }
//
// Refinement-pass changes (versus first T-2 implementation):
//
//   • Per-subject uniqueness — each unique job (and each unsigned-order)
//     surfaces at most once across all four sections. The strongest framing
//     wins. Stronger ranks higher on STRENGTH (defined below).
//
//   • Tighter caps — L2 ≤ 5, L3 ≤ 6, L4 ≤ 5, L5 ≤ 5. A briefing, not a feed.
//
//   • Bare-overdue suppressed unless ≥14d AND no other signal exists for the
//     job (the latter is enforced automatically by the per-subject dedupe).
//
//   • Waiting-on-customer ≥14d moved from L2 to L4. If it isn't urgent,
//     it isn't L2.
//
//   • Promise-risk urgent only when ≤3 days. 4–7d is calm.
//
//   • Consultant phrasing removed ("needs a touchpoint", "needs resolution
//     before work can advance"). Replaced with operator vocabulary.
//
//   • Service-word noun phrasing replaced. The engine no longer says "Patel
//     new stone" — it picks the operationally appropriate noun (install,
//     job, stone, layout, quote, draft) per signal type.
//
//   • Sentence variation — event-fronted forms ("Friday: Patel install"),
//     possessive forms ("Chen's stone — 16 days late"), and short
//     stewardship forms ("Smith job — quiet 17 days") all coexist. Each
//     signal type has a consistent template; variety across types.
//
//   • "This customer" fallback removed — signals with no resolvable surname
//     are suppressed rather than rendered with placeholder text.
//
//   • L4 consolidation — when a single drift sub-type exceeds 3 rows, the
//     top two render fully and the remainder collapse into one static
//     summary row ("3 more jobs quiet 14+ days — Wilson, Lopez, Garcia.").
//
// =============================================================================

import {
  listAllOrders, getJobs,
  rowBalanceDue, fmtUSD,
  SOLD_STATUSES,
  getMilestoneBlockReason,
  isLateAgainstExpectedResolution,
} from './stonebooksData.js'

const DAY = 86400000

// Per-bucket caps. Today is a triage surface, not a registry.
const L2_CAP = 5
const L3_CAP = 6
const L4_CAP = 5
const L5_CAP = 5

// Strength rankings — higher value means stronger framing for the same
// subject. Each candidate signal carries its STRENGTH; the per-subject
// dedupe picks the maximum.
const STRENGTH = {
  promise_risk_urgent:   1000,   // install in ≤3d w/ missing prerequisite
  job_blocked:            990,
  balance_past_severe:    980,   // ≥14d past install w/ unpaid balance
  balance_upcoming_3:     970,   // install in ≤3d w/ unpaid balance
  promise_risk_calm:      900,   // install in 4–7d w/ missing prerequisite
  balance_past:           890,   // <14d past install w/ unpaid balance
  balance_upcoming:       880,   // install in 4–14d w/ unpaid balance
  bare_overdue_severe:    870,   // ≥14d overdue, no other signal for this job
  permit_today:           720,
  mausoleum_close:        715,
  scheduled_today:        710,
  scheduled_tomorrow:     610,
  scheduled_week:         600,
  permit_week:            590,
  wait_severe:            500,   // waiting ≥14d (relocated from L2 to L4)
  stalled:                450,
  wait_moderate:          400,   // waiting 7–13d
  stale_quote:            350,
  abandoned_draft:        300,
}

// =============================================================================
// FETCH
// =============================================================================

export async function fetchTodayData() {
  const [jobs, orders] = await Promise.all([
    getJobs({ includeClosed: false, limit: 500 }),
    listAllOrders({ limit: 500 }),
  ])
  return { jobs, orders }
}

// =============================================================================
// DERIVE
// =============================================================================

export function deriveTodaySignals({ jobs = [], orders = [], now = new Date() } = {}) {
  const today    = startOfDay(now)
  const tomorrow = addDays(today, 1)
  const in7      = addDays(today, 7)
  const in14     = addDays(today, 14)

  // Build the job-by-order map so order-anchored signals can coalesce under
  // the same "subject" as their corresponding job (one customer = one row).
  const jobIdByOrderId = new Map()
  for (const j of jobs) {
    if (j.order?.id) jobIdByOrderId.set(j.order.id, j.id)
  }
  const signedOrderIds = new Set(jobIdByOrderId.keys())

  // ── Phase 1: candidate emission ──
  const candidates = []
  for (const job of jobs) {
    emitJobCandidates({ job, today, tomorrow, in7, in14, out: candidates })
  }
  for (const order of orders) {
    if (signedOrderIds.has(order.id)) continue
    emitPreSignOrderCandidates({ order, today, out: candidates })
  }
  for (const order of orders) {
    emitPermitCandidates({ order, today, in7, out: candidates })
  }

  // ── Phase 2: per-subject dedupe (strongest framing wins) ──
  const strongest = pickStrongestPerSubject(candidates, jobIdByOrderId)

  // ── Phase 3: bucket ──
  const l2 = strongest.filter(s => s.section === 'l2')
  const l3 = strongest.filter(s => s.section === 'l3')
  let   l4 = strongest.filter(s => s.section === 'l4')
  const l5 = strongest.filter(s => s.section === 'l5')

  // ── Phase 4: L4 drift consolidation ──
  l4 = consolidateL4(l4)

  // ── Phase 5: sort + cap ──
  sortL2(l2); sortL3(l3); sortL4(l4); sortL5(l5)

  return {
    l2: l2.slice(0, L2_CAP),
    l3: l3.slice(0, L3_CAP),
    l4: l4.slice(0, L4_CAP),
    l5: l5.slice(0, L5_CAP),
  }
}

// =============================================================================
// CANDIDATE EMITTERS
// =============================================================================

function emitJobCandidates({ job, today, tomorrow, in7, in14, out }) {
  const order = job.order
  if (!order || order.status === 'cancelled') return
  const surname = resolveSurname(job)
  if (!surname) return   // suppress signals with no real subject

  const cemeteryName = job.cemetery?.name || null
  const balance      = rowBalanceDue(order)

  // ── Promise risk ── install ≤7d with an unfinished prerequisite
  if (order.target_completion_date && SOLD_STATUSES.includes(order.status)) {
    const target = parseDateLocal(order.target_completion_date)
    if (target >= today && target <= in7) {
      const blocker = findOperationalBlocker(job, today)
      if (blocker) {
        const days   = daysBetween(today, target)
        const urgent = days <= 3
        out.push({
          id: `promise-${job.id}`,
          sentence: sentencePromiseRisk({ surname, target, days, blockerClause: blocker.clause }),
          note: cemeteryName,
          severity: urgent ? 'urgent' : 'calm',
          route: 'job',
          routeId: job.id,
          subjectName: surname,
          section: 'l2',
          subType: 'promise_risk',
          _strength: urgent ? STRENGTH.promise_risk_urgent : STRENGTH.promise_risk_calm,
          _sortKey: 9000 - days,
        })
      }
    }
  }

  // ── Job blocked ──
  // Reads the structured `block_reason_code` on the first blocked milestone
  // (by sort_order) when available, falling back to the generic phrasing
  // when no structured reason has been captured yet.
  if (job.overall_status === 'blocked') {
    out.push({
      id: `blocked-${job.id}`,
      sentence: sentenceJobBlocked(surname, job),
      note: cemeteryName,
      severity: 'urgent',
      route: 'job',
      routeId: job.id,
      subjectName: surname,
      section: 'l2',
      subType: 'blocked',
      _strength: STRENGTH.job_blocked,
      _sortKey: 9500,
    })
  }

  // ── Balance — past install ──
  if (balance > 0 && order.target_completion_date && SOLD_STATUSES.includes(order.status)) {
    const target = parseDateLocal(order.target_completion_date)
    if (target < today) {
      const daysPast = daysBetween(target, today)
      const severe   = daysPast >= 14
      out.push({
        id: `balance-past-${order.id}`,
        sentence: sentenceBalancePast({ surname, daysPast, balance }),
        note: cemeteryName,
        severity: severe ? 'urgent' : 'calm',
        route: 'order',
        routeId: order.id,
        subjectName: surname,
        section: 'l2',
        subType: 'balance_past',
        _strength: severe ? STRENGTH.balance_past_severe : STRENGTH.balance_past,
        _sortKey: 4000 + daysPast,
      })
    } else if (target <= in14) {
      const daysUntil = daysBetween(today, target)
      const urgent    = daysUntil <= 3
      out.push({
        id: `balance-upcoming-${order.id}`,
        sentence: sentenceBalanceUpcoming({ surname, target, daysUntil, balance }),
        note: cemeteryName,
        severity: urgent ? 'urgent' : 'calm',
        route: 'order',
        routeId: order.id,
        subjectName: surname,
        section: 'l2',
        subType: 'balance_upcoming',
        _strength: urgent ? STRENGTH.balance_upcoming_3 : STRENGTH.balance_upcoming,
        _sortKey: 3500 - daysUntil,
      })
    }
  }

  // ── Bare overdue milestone — ≥14d, no other signal (dedupe enforces) ──
  const worst = worstOverdueMilestone(job, today)
  if (worst && worst.daysOverdue >= 14) {
    out.push({
      id: `overdue-${job.id}`,
      sentence: sentenceBareOverdue(surname, worst.milestone, worst.daysOverdue),
      note: cemeteryName,
      severity: 'urgent',
      route: 'job',
      routeId: job.id,
      subjectName: surname,
      section: 'l2',
      subType: 'bare_overdue',
      _strength: STRENGTH.bare_overdue_severe,
      _sortKey: 5000 + worst.daysOverdue,
    })
  }

  // ── Wait — severe (≥14d) — now L4 (calm), no longer L2 ──
  if (job.overall_status === 'waiting_on_customer' && job.last_update_at) {
    const days = daysBetween(new Date(job.last_update_at), today)
    if (days >= 14) {
      out.push({
        id: `wait-severe-${job.id}`,
        sentence: `${surname} family — ${days} days without a response.`,
        note: cemeteryName,
        severity: 'calm',
        route: 'job',
        routeId: job.id,
        subjectName: surname,
        section: 'l4',
        subType: 'wait_severe',
        _strength: STRENGTH.wait_severe,
        _sortKey: days + 1000,
      })
    }
  }

  // ── L3 / L5: time-anchored arrivals ──
  if (order.target_completion_date) {
    const target = parseDateLocal(order.target_completion_date)
    if (sameDay(target, today)) {
      out.push({
        id: `today-${job.id}`,
        sentence: `${surname} install today.`,
        note: cemeteryName,
        route: 'job',
        routeId: job.id,
        subjectName: surname,
        section: 'l3',
        subType: 'scheduled_today',
        _strength: STRENGTH.scheduled_today,
        _sortKey: 0,
      })
    } else if (sameDay(target, tomorrow)) {
      out.push({
        id: `tomorrow-${job.id}`,
        sentence: `${surname} install tomorrow.`,
        note: cemeteryName,
        route: 'job',
        routeId: job.id,
        subjectName: surname,
        section: 'l5',
        subType: 'scheduled_tomorrow',
        _strength: STRENGTH.scheduled_tomorrow,
        _sortKey: 1,
      })
    } else if (target > tomorrow && target <= in7) {
      const day = target.toLocaleDateString('en-US', { weekday: 'long' })
      out.push({
        id: `week-${job.id}`,
        sentence: `${day}: ${surname} install.`,
        note: cemeteryName,
        route: 'job',
        routeId: job.id,
        subjectName: surname,
        section: 'l5',
        subType: 'scheduled_week',
        _strength: STRENGTH.scheduled_week,
        _sortKey: daysBetween(today, target),
      })
    }
  }

  // ── L3: mausoleum window closes today ──
  if (order.target_completion_end_date) {
    const end = parseDateLocal(order.target_completion_end_date)
    if (sameDay(end, today)) {
      out.push({
        id: `mausoleum-close-${job.id}`,
        sentence: `${surname} mausoleum window closes today.`,
        note: cemeteryName,
        route: 'job',
        routeId: job.id,
        subjectName: surname,
        section: 'l3',
        subType: 'mausoleum_close',
        _strength: STRENGTH.mausoleum_close,
        _sortKey: 1,
      })
    }
  }

  // ── L4: stalled active job (no movement in 14+ days) ──
  if (job.overall_status === 'active' && job.last_update_at) {
    const days = daysBetween(new Date(job.last_update_at), today)
    if (days >= 14) {
      out.push({
        id: `stalled-${job.id}`,
        sentence: `${surname} job — quiet ${days} days.`,
        note: cemeteryName,
        route: 'job',
        routeId: job.id,
        subjectName: surname,
        section: 'l4',
        subType: 'stalled',
        _strength: STRENGTH.stalled,
        _sortKey: days,
      })
    }
  }

  // ── L4: waiting moderate (7–13d) ──
  if (job.overall_status?.startsWith('waiting_') && job.last_update_at) {
    const days = daysBetween(new Date(job.last_update_at), today)
    if (days >= 7 && days < 14) {
      out.push({
        id: `wait-mod-${job.id}`,
        sentence: `${surname} — ${days} days waiting on ${waitingPartyWord(job.overall_status)}.`,
        note: cemeteryName,
        route: 'job',
        routeId: job.id,
        subjectName: surname,
        section: 'l4',
        subType: 'wait_moderate',
        _strength: STRENGTH.wait_moderate,
        _sortKey: days - 50,
      })
    }
  }
}

function emitPreSignOrderCandidates({ order, today, out }) {
  if (!order || order.status === 'cancelled') return
  const surname = resolveSurname({ customer: order.customer, order })
  if (!surname) return
  if (!order.updated_at) return
  const daysOld = daysBetween(new Date(order.updated_at), today)

  if (order.status === 'quoted' && daysOld >= 14) {
    out.push({
      id: `quote-stale-${order.id}`,
      sentence: `${surname} quote — ${daysOld} days without follow-up.`,
      note: null,
      route: 'order',
      routeId: order.id,
      subjectName: surname,
      section: 'l4',
      subType: 'stale_quote',
      _strength: STRENGTH.stale_quote,
      _sortKey: daysOld,
    })
  } else if ((order.status === 'draft' || order.status === 'scoping') && daysOld >= 30) {
    const word = order.status === 'draft' ? 'draft' : 'scoping'
    out.push({
      id: `draft-stale-${order.id}`,
      sentence: `${surname} ${word} — quiet ${daysOld} days.`,
      note: null,
      route: 'order',
      routeId: order.id,
      subjectName: surname,
      section: 'l4',
      subType: 'abandoned_draft',
      _strength: STRENGTH.abandoned_draft,
      _sortKey: daysOld - 30,
    })
  }
}

function emitPermitCandidates({ order, today, in7, out }) {
  if (!order || !order.cemetery_deadline || order.status === 'cancelled') return
  const surname = resolveSurname({ customer: order.customer, order })
  if (!surname) return
  const cemeteryName = order.cemetery?.name || null
  const dl   = parseDateLocal(order.cemetery_deadline)
  const days = daysBetween(today, dl)

  if (days === 0) {
    out.push({
      id: `permit-today-${order.id}`,
      sentence: `${surname} cemetery permit deadline today.`,
      note: cemeteryName,
      route: 'order',
      routeId: order.id,
      subjectName: surname,
      section: 'l3',
      subType: 'permit_today',
      _strength: STRENGTH.permit_today,
      _sortKey: 2,
    })
  } else if (days > 0 && days <= 7) {
    const day = dl.toLocaleDateString('en-US', { weekday: 'long' })
    out.push({
      id: `permit-week-${order.id}`,
      sentence: `${day}: ${surname} cemetery permit deadline.`,
      note: cemeteryName,
      route: 'order',
      routeId: order.id,
      subjectName: surname,
      section: 'l5',
      subType: 'permit_week',
      _strength: STRENGTH.permit_week,
      _sortKey: days + 100,
    })
  }
}

// =============================================================================
// SENTENCE BUILDERS — one template per signal type, each with consistent
// internal cadence. Variety lives across types, not inside one type.
// =============================================================================

// Composes the "{surname} job is stuck — {reason}" sentence using the
// structured `block_reason_code` when set. Falls back to the generic
// "needs a decision" when no reason has been captured. Optionally
// appends the external party reference for additional context.
function sentenceJobBlocked(surname, job) {
  const blocked = (job.milestones || [])
    .filter(m => m.status === 'blocked')
    .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))[0] || null
  const reason   = blocked ? getMilestoneBlockReason(blocked) : null
  const partyRef = blocked?.external_party_ref?.trim() || null

  if (reason) {
    if (partyRef && (reason.code === 'vendor_silent' || reason.code === 'customer_silent')) {
      return `${surname} job is stuck — ${partyRef} hasn't responded.`
    }
    return `${surname} job is stuck — ${reason.short}.`
  }

  return `${surname} job is stuck — needs a decision.`
}

function sentencePromiseRisk({ surname, target, days, blockerClause }) {
  if (days === 0) return `${surname} install today — ${blockerClause}.`
  if (days === 1) return `${surname} install tomorrow — ${blockerClause}.`
  if (days <= 3) {
    const day = target.toLocaleDateString('en-US', { weekday: 'long' })
    return `${day}: ${surname} install — ${blockerClause}.`
  }
  return `${surname} install in ${days} days — ${blockerClause}.`
}

function sentenceBalancePast({ surname, daysPast, balance }) {
  const word = daysPast === 1 ? 'day' : 'days'
  return `${surname} install was due ${daysPast} ${word} ago — ${fmtUSD(balance)} still owed.`
}

function sentenceBalanceUpcoming({ surname, target, daysUntil, balance }) {
  if (daysUntil === 0) return `${surname} install today — ${fmtUSD(balance)} still owed.`
  if (daysUntil === 1) return `${surname} install tomorrow — ${fmtUSD(balance)} still owed.`
  if (daysUntil <= 7) {
    const day = target.toLocaleDateString('en-US', { weekday: 'long' })
    return `${day}: ${surname} install — ${fmtUSD(balance)} still owed.`
  }
  return `${surname} install in ${daysUntil} days — ${fmtUSD(balance)} still owed.`
}

// Possessive form, per-milestone phrasing. Stage-appropriate noun.
// When the milestone carries an `external_party_ref`, the sentence appends
// "from {party}" for the supplier-shaped milestones and "at {party}" for the
// cemetery-shaped ones — adds operational specificity without breaking the
// terse possessive cadence.
function sentenceBareOverdue(surname, milestone, days) {
  const key  = milestone.milestone_key
  const M = {
    'stone_received':       `${surname}'s stone — ${days} days late`,
    'stone_ordered':        `${surname}'s stone order — ${days} days late`,
    'layout_approved':      `${surname}'s layout — ${days} days waiting on approval`,
    'layout_drawn':         `${surname}'s layout — ${days} days behind on drawing`,
    'deposit_paid':         `${surname} — deposit not collected, ${days} days late`,
    'permit_submitted':     `${surname}'s cemetery permit — ${days} days past submission date`,
    'permit_approved':      `${surname}'s cemetery permit — ${days} days waiting on approval`,
    'production_completed': `${surname}'s job — ${days} days behind on production`,
    'foundation_set':       `${surname}'s foundation — ${days} days behind`,
    'photo_received':       `${surname}'s customer photo — ${days} days late`,
    'stencil_made':         `${surname}'s stencil — ${days} days behind`,
    'ready_to_install':     `${surname} install — ${days} days behind on scheduling`,
  }
  const base = M[key] || `${surname}'s ${(milestone.label || 'step').toLowerCase()} — ${days} days behind`

  // Append the external party with the right preposition. "from" for
  // supplier/customer-shaped milestones (the thing is en route FROM them);
  // "at" for cemetery-shaped milestones (the permit is sitting AT them).
  const partyRef = milestone.external_party_ref?.trim()
  if (!partyRef) return `${base}.`
  const atParty = (key === 'permit_submitted' || key === 'permit_approved')
  return `${base} ${atParty ? 'at' : 'from'} ${partyRef}.`
}

// =============================================================================
// BLOCKER HUMANIZER — promise-risk clause vocabulary
// =============================================================================

// Earlier-stage prerequisites win — deposit gates everything downstream of it,
// so a missing deposit is the more honest framing than a missing foundation.
const OPERATIONAL_PREREQUISITES = [
  'deposit_paid',
  'permit_submitted',
  'permit_approved',
  'layout_drawn',
  'layout_approved',
  'photo_received',
  'stone_ordered',
  'stone_received',
  'stencil_made',
  'production_completed',
  'foundation_set',
]

// Returns either null (no blocker) or { milestone, clause, lateInfo }
// where `clause` is the humanized sentence fragment and `lateInfo` is the
// `isLateAgainstExpectedResolution` result (null | false | {daysLate}).
// Today consumers care about the clause; queue consumers could later use
// lateInfo to escalate visual sort.
function findOperationalBlocker(job, today) {
  const byKey = new Map((job.milestones || []).map(m => [m.milestone_key, m]))
  for (const key of OPERATIONAL_PREREQUISITES) {
    const m = byKey.get(key)
    if (!m) continue
    if (m.status === 'done' || m.status === 'not_needed' || m.status === 'skipped') continue
    const lateInfo = isLateAgainstExpectedResolution(m, today)
    return { milestone: m, clause: blockerPhraseFor(m, today, lateInfo), lateInfo }
  }
  return null
}

// Composes a sentence fragment naming WHY the milestone isn't done yet.
// Reads the new operational-truth-substrate columns (external_party_ref,
// expected_resolution_at) when set, falling back to the generic phrasing
// when they're null. Per-milestone phrasing lives in MILESTONE_BLOCKER_VOCAB
// below; unknown keys fall back to the milestone label.
function blockerPhraseFor(milestone, today = new Date(), lateInfoArg = undefined) {
  const vocab = MILESTONE_BLOCKER_VOCAB[milestone.milestone_key]
  const partyRef = milestone.external_party_ref?.trim() || null
  const expected = milestone.expected_resolution_at || null
  const lateInfo = lateInfoArg === undefined
    ? isLateAgainstExpectedResolution(milestone, today)
    : lateInfoArg

  // No structured vocabulary — bare fallback using the label.
  if (!vocab) {
    return `${(milestone.label || 'a prerequisite').toLowerCase()} isn't done yet`
  }

  // Both fields set — richest variant.
  if (partyRef && expected) {
    if (lateInfo && lateInfo.daysLate > 0) {
      return vocab.partyLate(partyRef, lateInfo.daysLate)
    }
    return vocab.partyOnTrack(partyRef, formatExpected(expected, today))
  }

  if (partyRef) {
    return vocab.partyOnly(partyRef)
  }

  if (expected) {
    if (lateInfo && lateInfo.daysLate > 0) {
      return vocab.dateLate(lateInfo.daysLate)
    }
    return vocab.dateOnly(formatExpected(expected, today))
  }

  return vocab.bare
}

// Per-milestone vocabulary. Each entry supplies six sentence fragments
// covering the structured-field permutations. Only milestones with a true
// external-party shape (supplier / cemetery / customer) get full variants;
// internal-only milestones (deposit, stencil, production, foundation,
// layout-drawn, stone-ordered) keep their bare phrase and treat any
// structured-field combination as "use the bare phrase."
function _bareOnly(bare) {
  const fn = () => bare
  return { bare, partyOnly: fn, partyOnTrack: fn, partyLate: fn, dateOnly: fn, dateLate: fn }
}

const MILESTONE_BLOCKER_VOCAB = {
  // Internal-only — bare phrase used regardless of structured fields.
  'deposit_paid':         _bareOnly("deposit hasn't been collected yet"),
  'layout_drawn':         _bareOnly("the layout hasn't been drawn yet"),
  'stencil_made':         _bareOnly("the stencil isn't made yet"),
  'production_completed': _bareOnly("production isn't finished yet"),
  'foundation_set':       _bareOnly("the foundation isn't set yet"),

  // Stone-ordering — semi-internal (we're placing the order) but the
  // captured supplier / planned-order-date are operationally meaningful
  // when present. Variants acknowledge "ordering with Coldspring" rather
  // than collapsing to a bare "hasn't been ordered yet" contradiction.
  'stone_ordered': {
    bare:         "the stone hasn't been ordered yet",
    partyOnly:    (party) => `the stone hasn't been ordered from ${party} yet`,
    partyOnTrack: (party, when) => `the stone order to ${party} is going out ${when}`,
    partyLate:    (party, days) => `the stone order to ${party} is ${days} ${days === 1 ? 'day' : 'days'} late`,
    dateOnly:     (when)  => `the stone order is going out ${when}`,
    dateLate:     (days)  => `the stone order is ${days} ${days === 1 ? 'day' : 'days'} late`,
  },

  // Supplier-facing.
  'stone_received': {
    bare:         "the stone hasn't arrived yet",
    partyOnly:    (party) => `${party} hasn't sent the stone yet`,
    partyOnTrack: (party, when) => `the stone is expected from ${party} ${when}`,
    partyLate:    (party, days) => `${party} is ${days} ${days === 1 ? 'day' : 'days'} past their quoted date`,
    dateOnly:     (when)  => `the stone is expected back ${when}`,
    dateLate:     (days)  => `the stone is ${days} ${days === 1 ? 'day' : 'days'} past expected arrival`,
  },

  // Cemetery-facing.
  'permit_submitted': {
    bare:         "the cemetery permit hasn't been submitted yet",
    partyOnly:    (party) => `the cemetery permit hasn't been filed with ${party} yet`,
    partyOnTrack: (party, when) => `the cemetery permit is due to ${party} by ${when}`,
    partyLate:    (party, days) => `the cemetery permit to ${party} is ${days} ${days === 1 ? 'day' : 'days'} past submission date`,
    dateOnly:     (when)  => `the cemetery permit is due to be filed by ${when}`,
    dateLate:     (days)  => `the cemetery permit is ${days} ${days === 1 ? 'day' : 'days'} past submission date`,
  },
  'permit_approved': {
    bare:         "the cemetery permit hasn't come back yet",
    partyOnly:    (party) => `${party} hasn't returned the permit yet`,
    partyOnTrack: (party, when) => `${party} is expected to return the permit ${when}`,
    partyLate:    (party, days) => `${party} is ${days} ${days === 1 ? 'day' : 'days'} past their permit-return date`,
    dateOnly:     (when)  => `the cemetery permit is expected back ${when}`,
    dateLate:     (days)  => `the cemetery permit is ${days} ${days === 1 ? 'day' : 'days'} past expected return`,
  },

  // Customer-facing.
  'photo_received': {
    bare:         "the customer photo hasn't arrived yet",
    partyOnly:    (party) => `${party} hasn't sent the photo yet`,
    partyOnTrack: (party, when) => `${party} is sending the photo by ${when}`,
    partyLate:    (party, days) => `${party} is ${days} ${days === 1 ? 'day' : 'days'} past their photo-send date`,
    dateOnly:     (when)  => `the customer photo is expected ${when}`,
    dateLate:     (days)  => `the customer photo is ${days} ${days === 1 ? 'day' : 'days'} past expected arrival`,
  },
  'layout_approved': {
    bare:         "the layout hasn't been approved yet",
    partyOnly:    (party) => `${party} hasn't approved the layout yet`,
    partyOnTrack: (party, when) => `${party} is reviewing the layout — expected back ${when}`,
    partyLate:    (party, days) => `${party} is ${days} ${days === 1 ? 'day' : 'days'} past their layout-review date`,
    dateOnly:     (when)  => `the layout is expected back ${when}`,
    dateLate:     (days)  => `the layout is ${days} ${days === 1 ? 'day' : 'days'} past expected approval`,
  },
}

// Renders an ISO date as a calm, sentence-friendly time anchor.
// Within the next 7 days → "today" / "tomorrow" / weekday name.
// Beyond 7 days → "Jun 14" form. Past dates → "Jun 4" (caller decides
// whether to use this — late-variant phrases handle past explicitly).
function formatExpected(iso, today) {
  if (!iso) return ''
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`)
  const t = startOfDay(today)
  const delta = Math.floor((d - t) / DAY)
  if (delta === 0) return 'today'
  if (delta === 1) return 'tomorrow'
  if (delta >= 2 && delta <= 7) {
    return `on ${d.toLocaleDateString('en-US', { weekday: 'long' })}`
  }
  return `on ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
}

// =============================================================================
// LOOKUPS
// =============================================================================

function worstOverdueMilestone(job, today) {
  const milestones = job.milestones || []
  let worst = null
  let worstDays = -1
  for (const m of milestones) {
    if (!m.due_date) continue
    if (m.status === 'done' || m.status === 'not_needed' || m.status === 'skipped') continue
    const due = parseDateLocal(m.due_date)
    if (due >= today) continue
    const days = Math.floor((today - due) / DAY)
    if (days > worstDays) { worstDays = days; worst = m }
  }
  if (!worst) return null
  return { milestone: worst, daysOverdue: worstDays }
}

// =============================================================================
// SUBJECT DEDUPE — one row per unique job (or unsigned order)
// =============================================================================

function pickStrongestPerSubject(candidates, jobIdByOrderId) {
  const bySubject = new Map()
  for (const c of candidates) {
    const key = subjectKey(c, jobIdByOrderId)
    const existing = bySubject.get(key)
    if (!existing || (c._strength || 0) > (existing._strength || 0)) {
      bySubject.set(key, c)
    }
  }
  return Array.from(bySubject.values())
}

function subjectKey(signal, jobIdByOrderId) {
  if (signal.route === 'order') {
    // Coalesce order-anchored signals under their job key when the order is
    // signed. Pre-sign orders have no job — keep their own subject key.
    const jobId = jobIdByOrderId.get(signal.routeId)
    return jobId ? `job:${jobId}` : `order:${signal.routeId}`
  }
  return `job:${signal.routeId}`
}

// =============================================================================
// L4 CONSOLIDATION — if one drift sub-type exceeds 3 rows, summarize the rest
// =============================================================================

function consolidateL4(signals) {
  const groups = new Map()
  for (const s of signals) {
    if (!groups.has(s.subType)) groups.set(s.subType, [])
    groups.get(s.subType).push(s)
  }

  const out = []
  for (const [subType, arr] of groups) {
    arr.sort((a, b) => (b._sortKey || 0) - (a._sortKey || 0))
    if (arr.length <= 3) {
      out.push(...arr)
      continue
    }
    // Keep the top two as full rows; consolidate the rest into a static
    // summary row. The summary names up to three rolled-up subjects plus
    // an "and N more" suffix.
    out.push(arr[0], arr[1])
    const rest = arr.slice(2)
    const namedCount = Math.min(rest.length, 3)
    const names = rest.slice(0, namedCount).map(s => s.subjectName).filter(Boolean)
    const more  = rest.length - namedCount
    const tail  = more > 0 ? `, and ${more} more` : ''
    const nameList = names.join(', ') + tail
    const summarySentence = summarizeDriftSubtype(subType, rest.length, nameList)
    if (summarySentence) {
      out.push({
        id: `l4-summary-${subType}`,
        sentence: summarySentence,
        note: null,
        severity: 'calm',
        route: null,
        routeId: null,
        subjectName: null,
        section: 'l4',
        subType: `${subType}__summary`,
        _strength: 0,
        _sortKey: -1,        // sort to the bottom of L4
      })
    }
  }
  return out
}

function summarizeDriftSubtype(subType, count, nameList) {
  switch (subType) {
    case 'stalled':         return `${count} more jobs quiet 14+ days — ${nameList}.`
    case 'wait_moderate':   return `${count} more jobs waiting a week+ — ${nameList}.`
    case 'wait_severe':     return `${count} more families without a response — ${nameList}.`
    case 'stale_quote':     return `${count} more quotes idle 14+ days — ${nameList}.`
    case 'abandoned_draft': return `${count} more drafts quiet 30+ days — ${nameList}.`
    default:                return null
  }
}

// =============================================================================
// SMALL HELPERS
// =============================================================================

function startOfDay(d) {
  const x = new Date(d); x.setHours(0, 0, 0, 0); return x
}

function addDays(d, n) {
  return new Date(d.getTime() + n * DAY)
}

function sameDay(a, b) {
  return startOfDay(a).getTime() === startOfDay(b).getTime()
}

function daysBetween(a, b) {
  return Math.floor((startOfDay(b) - startOfDay(a)) / DAY)
}

function parseDateLocal(iso) {
  if (!iso) return null
  return new Date(iso.slice(0, 10) + 'T00:00:00')
}

// Resolve the customer surname, with order-level fallback. Returns null if
// no real name can be found — signals with null surnames are suppressed
// upstream rather than rendered with placeholder text.
function resolveSurname(jobOrCtx) {
  const c = jobOrCtx?.customer || jobOrCtx?.order?.customer
  const last = c?.last_name?.trim()
  if (last) return last
  const primary = jobOrCtx?.order?.primary_lastname?.trim()
  if (primary) return primary
  return null
}

function waitingPartyWord(overallStatus) {
  if (!overallStatus) return 'someone'
  if (overallStatus === 'waiting_on_customer') return 'the customer'
  if (overallStatus === 'waiting_on_cemetery') return 'the cemetery'
  if (overallStatus === 'waiting_on_supplier') return 'the supplier'
  return overallStatus.replace('waiting_on_', '').replace(/_/g, ' ')
}

// =============================================================================
// SORTS
// =============================================================================

function sortL2(arr) {
  arr.sort((a, b) => {
    // Urgent first, then by strength desc, then by sortKey desc
    if (a.severity === 'urgent' && b.severity !== 'urgent') return -1
    if (a.severity !== 'urgent' && b.severity === 'urgent') return 1
    const ds = (b._strength || 0) - (a._strength || 0)
    if (ds !== 0) return ds
    return (b._sortKey || 0) - (a._sortKey || 0)
  })
}

function sortL3(arr) {
  arr.sort((a, b) => (a._sortKey || 0) - (b._sortKey || 0))
}

function sortL4(arr) {
  // Full rows first (by aging desc); summary rows sink to the bottom.
  arr.sort((a, b) => (b._sortKey || 0) - (a._sortKey || 0))
}

function sortL5(arr) {
  arr.sort((a, b) => (a._sortKey || 0) - (b._sortKey || 0))
}
