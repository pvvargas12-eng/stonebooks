// =============================================================================
// orderPipeline.js — declarative pipeline config for the Order Detail rail.
// =============================================================================
// Rides the existing milestone substrate (job_milestones + milestone status
// taxonomy; done-value is the string 'done'). This module is PURE config + pure
// derivation — it imports nothing from stonebooksData (so ensureDerivedMilestones
// there can import deriveMilestones here without a cycle).
//
// Structured so the per-order-type config + derivation rules can later become
// per-tenant DB rows for SaaS — they're data-shaped, not code branches.
// =============================================================================

export const PIPELINE_PHASES = [
  { code: 'sales',        label: 'Sales' },
  { code: 'admin',        label: 'Admin' },
  { code: 'design',       label: 'Design' },
  { code: 'production',   label: 'Production' },
  { code: 'installation', label: 'Installation' },
]

// milestone.group → phase (mirrors ROLE_GROUP_MAP, expressed against phases).
const GROUP_TO_PHASE = {
  intake: 'admin', permit: 'admin', closeout: 'admin',
  design: 'design', photo: 'design', etching: 'design',
  stone: 'production', production: 'production', foundation: 'production',
  acid_wash: 'production', repair: 'production',
  install: 'installation', field: 'installation',
}
// milestone.team is the authoritative owner when present (overrides group).
const TEAM_TO_PHASE = { admin: 'admin', design: 'design', production: 'production', installation: 'installation', sales: 'sales' }

// Phase for a milestone: team wins, else group, else null (unowned → not shown).
export function phaseForMilestone(m) {
  if (m?.team && TEAM_TO_PHASE[m.team]) return TEAM_TO_PHASE[m.team]
  if (m?.group && GROUP_TO_PHASE[m.group]) return GROUP_TO_PHASE[m.group]
  return null
}

// contract_signed + deposit_received are represented by the synthetic Sales
// steps, so they're not double-shown as Admin/Sales job milestones.
const SALES_REPRESENTED_KEYS = new Set(['contract_signed', 'deposit_received'])

// ── Derived-milestone marker ────────────────────────────────────────────────
export const DERIVED_KEY_PREFIX = 'derived_'
export function isDerivedKey(key) { return String(key || '').startsWith(DERIVED_KEY_PREFIX) }

// ── Order-content predicates (used by derivation rules) ─────────────────────
function addons(order) { return order?.add_ons || order?.addOns || [] }
function addonMatches(order, re) {
  const a = addons(order)
  return Array.isArray(a) && a.some(x => re.test(`${x?.code || ''} ${x?.label || ''}`.toLowerCase()))
}
function hasInscriptionContent(order) {
  const ins = order?.inscription || {}
  if (ins.epitaph || ins.carveText) return true
  const dec = Array.isArray(order?.deceased) ? order.deceased : []
  return dec.some(d => d && (d.firstName || d.lastName || d.inscriptionName))
}
function hasFoundationWork(order) {
  return !!(order?.pricing?.foundationCalc)
}
function serviceTypes(order) { return order?.service_types || order?.serviceTypes || [] }
function isStoneType(order) {
  const s = serviceTypes(order)
  return s.includes('NEW_STONE') || s.includes('CIVIC_MEMORIAL') || s.includes('MAUSOLEUM')
}

// ── DERIVATION RULES — predicate(order) → milestone injections. ─────────────
// Each milestone declares group + team (which decide its phase). Future triggers
// (bronze, vases, on-site lettering) are new entries here, not code changes.
export const DERIVATION_RULES = [
  {
    id: 'etching',
    label: 'Etching add-on',
    predicate: (o) => addonMatches(o, /etch|laser/),
    milestones: [
      { key: 'derived_etching_photo', label: 'Get photo for etching', group: 'photo',   team: 'design' },      // → Design
      { key: 'derived_etching_order', label: 'Order etching',         group: 'etching', team: 'production' },  // → Production
    ],
  },
  {
    id: 'photo',
    label: 'Photo / porcelain item',
    predicate: (o) => addonMatches(o, /porcelain|cameo|\bphoto\b/),
    milestones: [
      { key: 'derived_order_photo', label: 'Order photo', group: 'photo', team: 'design' },
    ],
  },
  {
    id: 'inscription_proof',
    label: 'Inscription content',
    predicate: (o) => hasInscriptionContent(o),
    milestones: [
      { key: 'derived_layout_proof', label: 'Layout proof', group: 'design', team: 'design' },
    ],
  },
  {
    id: 'foundation',
    label: 'Foundation work',
    // Stone templates already carry foundation milestones; only inject the
    // install-side reminder for non-stone types (inscription/repair/cleaning).
    predicate: (o) => hasFoundationWork(o) && !isStoneType(o),
    milestones: [
      { key: 'derived_set_foundation', label: 'Set foundation', group: 'foundation', team: 'installation' },
    ],
  },
]

// All derived milestone defs an order's CURRENT contents trigger.
export function deriveMilestones(order) {
  const out = []
  for (const rule of DERIVATION_RULES) {
    try {
      if (rule.predicate(order)) for (const m of rule.milestones) out.push({ ...m, ruleId: rule.id })
    } catch { /* a bad predicate never breaks derivation */ }
  }
  return out
}

// ── Per-order-type base milestones (declarative; pre-signing PREVIEW + the
// canonical phase contract). Post-signing the rail shows the live job_milestones;
// this is the "what this order will look like" preview before a job exists.
export const ORDER_TYPE_CONFIG = {
  new_stone: { base: [
    { key: 'design_needed',        label: 'Design needed',        phase: 'design' },
    { key: 'proof_approved',       label: 'Proof approved',       phase: 'design' },
    { key: 'stone_ordered',        label: 'Stone ordered',        phase: 'production' },
    { key: 'stone_received',       label: 'Stone received',       phase: 'production' },
    { key: 'production_started',   label: 'Production started',   phase: 'production' },
    { key: 'production_completed', label: 'Production completed', phase: 'production' },
    { key: 'foundation_poured',    label: 'Foundation poured',    phase: 'installation' },
    { key: 'ready_to_install',     label: 'Ready to install',     phase: 'production' },
    { key: 'installed',            label: 'Installed',            phase: 'installation' },
  ] },
  inscription: { base: [
    { key: 'proof_approved',       label: 'Proof approved',       phase: 'design' },
    { key: 'stencil_cut',          label: 'Stencil cut',          phase: 'production' },
    { key: 'production_started',   label: 'Inscription started',  phase: 'production' },
    { key: 'production_completed', label: 'Inscription completed', phase: 'production' },
    { key: 'installed',            label: 'Set / installed',      phase: 'installation' },
  ] },
  cleaning_repair: { base: [
    { key: 'production_started',   label: 'Work started',   phase: 'production' },
    { key: 'production_completed', label: 'Work completed', phase: 'production' },
    { key: 'installed',            label: 'On-site complete', phase: 'installation' },
  ] },
  bronze: { base: [
    { key: 'proof_approved',       label: 'Proof approved',  phase: 'design' },
    { key: 'production_started',   label: 'Bronze ordered',  phase: 'production' },
    { key: 'production_completed', label: 'Bronze received', phase: 'production' },
    { key: 'installed',            label: 'Installed',       phase: 'installation' },
  ] },
}

const SERVICE_TO_TYPE = {
  NEW_STONE: 'new_stone', CIVIC_MEMORIAL: 'new_stone', MAUSOLEUM: 'new_stone',
  INSCRIPTION: 'inscription', ADD_PHOTO: 'inscription',
  ACID_WASH: 'cleaning_repair', REPAIR: 'cleaning_repair',
  BRONZE: 'bronze', OTHER: 'new_stone',
}
export function orderJobType(order) {
  const s = serviceTypes(order)
  for (const code of s) if (SERVICE_TO_TYPE[code]) return SERVICE_TO_TYPE[code]
  return 'new_stone'
}

// ── buildPipeline — the rail's data model ───────────────────────────────────
// Returns { phases:[{ code,label,items:[{key,label,status,derived,readOnly,...}],
// done,total,pct }], overallPct, overallDone, overallTotal, hasJob }.
export function buildPipeline(order, job) {
  const milestones = job?.milestones || []
  const hasJob = !!job
  const byPhase = { sales: [], admin: [], design: [], production: [], installation: [] }

  // Sales = synthetic, order-derived, always active.
  byPhase.sales = salesPhaseSteps(order)

  if (hasJob) {
    // Live job milestones grouped by phase (real, tappable). Hide not_needed.
    for (const m of milestones) {
      if (SALES_REPRESENTED_KEYS.has(m.milestone_key)) continue
      if (m.status === 'not_needed') continue
      const phase = phaseForMilestone(m)
      if (!phase || phase === 'sales') continue
      byPhase[phase].push({
        key: m.milestone_key, label: m.label, status: m.status || 'not_started',
        derived: isDerivedKey(m.milestone_key), readOnly: false,
        group: m.group, team: m.team,
      })
    }
  } else {
    // Pre-signing PREVIEW: config base + derived, read-only, not tappable.
    const base = (ORDER_TYPE_CONFIG[orderJobType(order)] || ORDER_TYPE_CONFIG.new_stone).base
    for (const b of base) {
      if (SALES_REPRESENTED_KEYS.has(b.key) || b.phase === 'sales') continue
      byPhase[b.phase]?.push({ key: b.key, label: b.label, status: 'not_started', derived: false, readOnly: true, preview: true })
    }
    for (const d of deriveMilestones(order)) {
      const phase = phaseForMilestone(d)
      if (!phase || phase === 'sales') continue
      byPhase[phase]?.push({ key: d.key, label: d.label, status: 'not_started', derived: true, readOnly: true, preview: true })
    }
  }

  const phases = PIPELINE_PHASES.map(p => {
    const items = byPhase[p.code] || []
    const done = items.filter(i => i.status === 'done').length
    const total = items.length
    return { code: p.code, label: p.label, items, done, total, pct: total ? Math.round((done / total) * 100) : 0 }
  })
  const allItems = phases.flatMap(p => p.items)
  const overallDone = allItems.filter(i => i.status === 'done').length
  const overallTotal = allItems.length
  return { phases, overallDone, overallTotal, overallPct: overallTotal ? Math.round((overallDone / overallTotal) * 100) : 0, hasJob }
}

// Synthetic Sales steps from order-level facts (quote sent / signed / deposit).
export function salesPhaseSteps(order) {
  const qEvents = Array.isArray(order?.quote_events) ? order.quote_events : []
  const quoteSent = (order?.quote_status && order.quote_status !== 'draft') || qEvents.some(e => e?.type === 'sent')
  const signed = !!order?.signed_at
  const payments = Array.isArray(order?.payments) ? order.payments : []
  const deposit = payments.some(p => p && (p.locked ?? true) && !p.voided && Number(p.amount) > 0)
  return [
    { key: 'sales_quote_sent',      label: 'Quote sent',        status: quoteSent ? 'done' : 'not_started', readOnly: true, derived: false },
    { key: 'sales_contract_signed', label: 'Contract signed',   status: signed ? 'done' : 'not_started',    readOnly: true, derived: false },
    { key: 'sales_deposit',         label: 'Deposit collected', status: deposit ? 'done' : 'not_started',   readOnly: true, derived: false },
  ]
}
