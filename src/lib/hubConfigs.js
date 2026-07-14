// =============================================================================
// 📚 Stonebooks — Hub Home configs (Production + Installation)
// =============================================================================
// Per-hub content for the generic HubHome studio surface. Kept in a non-
// component module (react-refresh/only-export-components forbids exporting
// these from HubHome.jsx). Each config: title, chips[], statusFor(item)→
// {label,tone,prose}, blockingFor(item)→[{key,label}]. All status reads route
// through the SHARED derive*/set-gate helpers so Production + Installation stay
// consistent with the Orders table + Scheduler blocked panel.
// =============================================================================

import {
  deriveStoneStatus, deriveFdnStatus, stoneStatusLabel, fdnStatusLabel,
  derivePaymentStatus, isReadyToSet, setBlockReason, milestoneDone, permitNeeded,
  deriveDesignStatus, statusDimApplies,
} from './stonebooksData'

const _job = (item) => item?.job || null
const _order = (item) => item?.order || item?.job?.order || null

// ── PRODUCTION — stencil, cutting, sandblasting, washing, foundation pours,
//    repairs: the stone's production stage + what's blocking it. ──────────────
const PRODUCTION_HUB = {
  key: 'production',
  title: 'PRODUCTION HUB',
  openTab: 'job',
  emptyText: 'Production hub is clear. No stones in the shop right now.',
  chips: [
    { code: 'attention',  label: 'Needs attention', match: (it) => it.urgent === true },
    // Stone chips only fire where the job HAS a stone dimension (audit B1 —
    // inscriptions/repairs were polluting "To order"). Bronze 'received' is
    // the bronze terminal state, grouped with Blasted.
    { code: 'to_order',   label: 'To order',        match: (it) => statusDimApplies('stone', _job(it)) && deriveStoneStatus(_job(it)) === 'not_ordered' },
    { code: 'in_prod',    label: 'In production',   match: (it) => statusDimApplies('stone', _job(it)) && ['ordered', 'in_stock', 'needs_pickup', 'needs_stencil_cut', 'needs_blasting'].includes(deriveStoneStatus(_job(it))) },
    { code: 'blasted',    label: 'Blasted / Received', match: (it) => statusDimApplies('stone', _job(it)) && ['blasted', 'received'].includes(deriveStoneStatus(_job(it))) },
    { code: 'foundation', label: 'Foundation',      match: (it) => ['need_map', 'not_in', 'drop_off', 'dug', 'poured'].includes(deriveFdnStatus(_job(it))) },
    { code: 'stuck',      label: 'Stuck',           match: (it) => it.pressure?.blocker?.kind === 'production_blocked' },
  ],
  statusFor: (it) => {
    const job = _job(it)
    const stoneApplies = statusDimApplies('stone', job)
    const stone = stoneApplies ? deriveStoneStatus(job) : null
    const fdn = deriveFdnStatus(job)
    const fdnPart = fdn !== 'na' ? ` · FDN: ${fdnStatusLabel(fdn)}` : ''
    if (!stoneApplies) return { label: 'In progress', tone: 'bronze', prose: `In progress${fdnPart}` }
    const tone = (stone === 'blasted' || stone === 'received') ? 'green' : stone === 'not_ordered' ? 'amber' : 'bronze'
    return { label: stoneStatusLabel(stone), tone, prose: `Stone: ${stoneStatusLabel(stone)}${fdnPart}` }
  },
  blockingFor: (it) => {
    const job = _job(it); const out = []
    // Vocabulary-aware layout gate (audit B1 — hardcoded proof_approved never
    // cleared on bronze). 'cut' is inscription's past-approved terminal stage.
    if (statusDimApplies('design', job)) {
      const design = deriveDesignStatus(job)
      if (design !== 'layout_approved' && design !== 'cut') out.push({ key: 'approval', label: 'Layout not approved — stencil/cut blocked' })
    }
    if (statusDimApplies('stone', job)) {
      const stone = deriveStoneStatus(job)
      if (stone === 'not_ordered') out.push({ key: 'order', label: job?.job_type === 'bronze' ? 'Bronze not ordered' : 'Stone not ordered' })
      else if (['ordered', 'in_stock', 'needs_pickup'].includes(stone)) out.push({ key: 'stone', label: job?.job_type === 'bronze' ? 'Bronze not yet received' : 'Stone not yet received' })
    }
    if (it.pressure?.blocker?.kind === 'production_blocked') out.push({ key: 'stuck', label: it.pressure.blocker.label || 'Production stalled' })
    const fdn = deriveFdnStatus(job)
    if (['need_map', 'not_in', 'drop_off', 'dug'].includes(fdn)) out.push({ key: 'fdn', label: `Foundation: ${fdnStatusLabel(fdn)}` })
    return out
  },
}

// ── INSTALLATION — foundations to set, stones ready to set, cemetery trips,
//    doors, pickups: install readiness + the shared set-gate blocker. ──────────
const INSTALLATION_HUB = {
  key: 'installation',
  title: 'INSTALLATION HUB',
  openTab: 'job',
  emptyText: 'Installation hub is clear. Nothing waiting to set or deliver.',
  chips: [
    { code: 'attention',  label: 'Needs attention', match: (it) => it.urgent === true },
    { code: 'ready',      label: 'Ready to set',    match: (it) => isReadyToSet(_order(it), _job(it)) },
    { code: 'blocked',    label: 'Blocked',         match: (it) => !!setBlockReason(_order(it), _job(it)) && milestoneDone(_job(it), 'production_completed') },
    { code: 'foundation', label: 'Foundation',      match: (it) => ['need_map', 'not_in', 'drop_off', 'dug', 'poured'].includes(deriveFdnStatus(_job(it))) },
    { code: 'doors',      label: 'Doors',           match: (it) => _job(it)?.job_type === 'mausoleum_door' },
  ],
  statusFor: (it) => {
    const job = _job(it); const order = _order(it)
    const ready = isReadyToSet(order, job)
    const fdn = deriveFdnStatus(job)
    const fdnPart = fdn !== 'na' ? ` · FDN: ${fdnStatusLabel(fdn)}` : ''
    if (ready) return { label: 'Ready to set', tone: 'green', prose: `Ready to set${fdnPart}` }
    const reason = setBlockReason(order, job)
    return { label: reason || 'In progress', tone: reason ? 'amber' : 'bronze', prose: `${reason || 'In progress'}${fdnPart}` }
  },
  blockingFor: (it) => {
    const job = _job(it); const order = _order(it); const out = []
    if (derivePaymentStatus(order) !== 'paid_in_full') out.push({ key: 'paid', label: 'Not paid in full' })
    // Type-aware production gate (audit B1): bronze completes at received;
    // types with no stone dimension skip the stone blocker entirely.
    if (statusDimApplies('stone', job)) {
      const stoneDone = milestoneDone(job, 'production_completed') || deriveStoneStatus(job) === 'received'
      if (!stoneDone) out.push({ key: 'blasted', label: job?.job_type === 'bronze' ? 'Bronze not received' : 'Stone not blasted' })
    } else if (statusDimApplies('design', job)) {
      // Inscription-style work: the gate is the cut stencil, not a stone.
      const design = deriveDesignStatus(job)
      if (design !== 'cut' && design !== 'layout_approved') out.push({ key: 'blasted', label: 'Layout not approved / cut' })
    }
    const fdn = deriveFdnStatus(job)
    if (!(fdn === 'in' || fdn === 'na')) out.push({ key: 'fdn', label: `Foundation not in (${fdnStatusLabel(fdn)})` })
    const permitRequired = permitNeeded(order)
    if (permitRequired && order?.permit_status !== 'approved') out.push({ key: 'permit', label: 'Permit not approved' })
    return out
  },
}

export const HUB_HOME_CONFIGS = { production: PRODUCTION_HUB, installation: INSTALLATION_HUB }
