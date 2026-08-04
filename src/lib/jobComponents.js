// =============================================================================
// jobComponents.js — three-track production phase vocabulary + seed logic (PURE)
// =============================================================================
// The shop's per-component production tracks. Each track has its OWN ordered phase
// enum — these are SHOP phases, never milestone keys (shop "cut" ≠ stencil_cut).
// Pure module: imports only monumentCatalog (the seed snapshot helpers). The
// supabase writers + the existing track classifier (orderCategory) live in
// stonebooksData.js, which calls componentsForOrder with the category it computes —
// so we reuse the one classifier and avoid an import cycle.
// =============================================================================
import { SHAPES, buildDieSpec, buildBaseSpec, orderHasBase } from './monumentCatalog'

// Ordered phases per track (the funnel order). current_phase is validated against
// the matching list both here and by the DB CHECK in 20260630_job_components.sql.
export const TRACK_PHASES = {
  // NEW STONE (Paul 2026-08-03, from the field): QC and the Blasted parking
  // column are GONE — tapping BLASTED in the Blasting Queue lands the stone
  // at Ready to Install and auto-joins the installations list. 'blast' +
  // 'quality_check' stay DB-legal (history; doors keep both) but the app
  // never writes them for new_stone again (prod rows moved forward by
  // 20260803_stone_qc_removed.sql).
  new_stone:   ['ready_to_bring_up', 'brought_to_line', 'cut', 'stencil_cut', 'stencil_stuck', 'ready_to_set'],
  inscription: ['needs_rubbing', 'stencil_cut', 'inscription_complete'],
  door:        ['pickup_doors', 'cut_stencil', 'stick_stencil', 'blast', 'quality_check', 'drop_off_doors'],
  bronze:      ['bronze_on_order', 'bronze_received', 'mounted_on_base', 'delivered'],
}

export const PHASE_LABEL = {
  ready_to_bring_up: 'Ready to Bring Up', brought_to_line: 'Brought to Line', cut: 'Cut',
  // Paul's sandblast vocabulary (2026-07-31): a stone with the stencil STUCK
  // is opened + stuck + ready to blast — that column IS the blasting queue.
  // Advancing out of it means "I blasted it" — the next column says so.
  // (Codes unchanged — display only; 'blast' is shared with the door track,
  // where "Blasted" reads the same way.)
  stencil_cut: 'Stencil Cut', stencil_stuck: 'Blasting Queue', blast: 'Blasted',
  quality_check: 'Quality Check', ready_to_set: 'Ready to Install',
  needs_rubbing: 'Needs Rubbing from Cemetery', inscription_complete: 'Inscription Complete',
  pickup_doors: 'Pickup Doors', cut_stencil: 'Cut Stencil', stick_stencil: 'Stick Stencil',
  drop_off_doors: 'Drop Off Doors',
  bronze_on_order: 'Bronze on Order', bronze_received: 'Bronze Received',
  mounted_on_base: 'Mounted on Base', delivered: 'Delivered',
}
export const TRACK_LABEL = { new_stone: 'New Stone', inscription: 'Inscription', door: 'Mausoleum Door', bronze: 'Bronze Services' }
export const INITIAL_PHASE = { new_stone: 'ready_to_bring_up', inscription: 'needs_rubbing', door: 'pickup_doors', bronze: 'bronze_on_order' }
// Quality Check is a hold-gate on DOORS only now (Paul 2026-08-03 removed it
// from stones; inscriptions never had one).
export const QC_PHASE = 'quality_check'
export const TRACKS_WITH_QC = new Set(['door'])

// The ADVANCE button says what you're DOING, never "Advance" (Paul, from the
// field: "still hate how it says advance not blasted"). new_stone gets the
// shop's own verbs; every other track reads the next phase's name. Blasting
// out of the queue HANDS OFF to the installation list (Paul 2026-08-04) —
// the verb says so.
const NEW_STONE_VERB = {
  ready_to_bring_up: 'Brought to Line',
  brought_to_line: 'Cut',
  cut: 'Stencil Cut',
  stencil_cut: 'Stencil Stuck',
  stencil_stuck: 'Blasted → Install list',
}
export function advanceVerb(track, code) {
  if (track === 'new_stone' && NEW_STONE_VERB[code]) return NEW_STONE_VERB[code]
  const next = nextPhase(track, code)
  return next ? phaseLabel(next) : null
}

export const phaseLabel = (code) => PHASE_LABEL[code] || code
export const trackPhases = (track) => TRACK_PHASES[track] || []
// The COLUMNS a floor board renders. new_stone's ready_to_set is a real phase
// (history, the stone-status rollup's 'blasted', the install auto-add) but
// NOT a column (Paul 2026-08-04: "remove ready to install and then just rely
// on the installation list") — blasting out of the queue moves the piece off
// the board and its job onto install_list.
export const boardPhases = (track) =>
  track === 'new_stone' ? trackPhases(track).filter(p => p !== 'ready_to_set') : trackPhases(track)
export const trackLabel = (track) => TRACK_LABEL[track] || track
export const phaseIndex = (track, code) => trackPhases(track).indexOf(code)
export const isValidPhase = (track, code) => phaseIndex(track, code) >= 0
export const nextPhase = (track, code) => { const p = trackPhases(track); const i = p.indexOf(code); return i >= 0 && i < p.length - 1 ? p[i + 1] : null }
export const prevPhase = (track, code) => { const p = trackPhases(track); const i = p.indexOf(code); return i > 0 ? p[i - 1] : null }

// orderCategory() (the ONE existing classifier) → a production track, or null if
// the order isn't on a production floor track (bronze / cleaning_repair / other).
export function trackForCategory(category) {
  if (category === 'new_stone') return 'new_stone'
  if (category === 'inscription') return 'inscription'
  if (category === 'mausoleum') return 'door'   // MAUSOLEUM_DOOR / crypt door
  if (category === 'bronze') return 'bronze'
  return null
}

// Build the component rows for an ORDER. `order` is a camelCase adapter (the caller
// builds it from the row) so buildDieSpec/buildBaseSpec read the right fields.
// `category` comes from orderCategory(order, job) — passed in, not recomputed.
// Returns [] for orders not on a production track. No DB access.
export function componentsForOrder(order, category) {
  const track = trackForCategory(category)
  if (!track) return []
  const color = order.graniteColor || null

  if (track === 'inscription') {
    return [{ track, component_type: 'inscription', label: 'Inscription', size: null, color, current_phase: INITIAL_PHASE.inscription, sort_order: 0 }]
  }
  if (track === 'door') {
    return [{ track, component_type: 'door', label: 'Door', size: null, color: null, current_phase: INITIAL_PHASE.door, sort_order: 0 }]
  }
  if (track === 'bronze') {
    // Bronze design lives in the Design Hub; production is just mount + deliver.
    return [{ track, component_type: 'bronze', label: 'Bronze', size: null, color, current_phase: INITIAL_PHASE.bronze, sort_order: 0 }]
  }

  // new_stone: 1 die (2 for double-die/double-slant) + a base when the order has one.
  const comps = []
  const shape = SHAPES.find(s => s.code === order.shape)
  const isDouble = order.shape === 'double-die' || order.shape === 'double-slant'
  const dieCount = isDouble ? 2 : 1
  const dieSize = (() => { try { return buildDieSpec(order) || null } catch { return null } })()
  for (let i = 0; i < dieCount; i++) {
    comps.push({ track, component_type: 'die', label: dieCount > 1 ? `Die ${i + 1}` : 'Die', size: dieSize, color, current_phase: INITIAL_PHASE.new_stone, sort_order: i })
  }
  if (orderHasBase(order.baseConfig, shape)) {
    const baseSize = (() => { try { return buildBaseSpec(order) || null } catch { return null } })()
    comps.push({ track, component_type: 'base', label: 'Base', size: baseSize, color, current_phase: INITIAL_PHASE.new_stone, sort_order: dieCount })
  }
  return comps
}

// Build the door component rows for a CEMETERY ORDER — one door per door entry.
export function componentsForCemeteryOrder(co) {
  const doors = Array.isArray(co?.doors) ? co.doors : []
  const n = doors.length || 0
  return Array.from({ length: n }, (_, i) => ({
    track: 'door', component_type: 'door',
    label: doors[i]?.label || `Door ${i + 1}`,
    size: doors[i]?.size || null, color: null,
    current_phase: INITIAL_PHASE.door, sort_order: i,
  }))
}

// camelCase adapter for buildDieSpec/buildBaseSpec from a snake_case order row.
export function camelOrderForSpec(row) {
  return {
    shape: row.shape, polishLevel: row.polish_level, graniteColor: row.granite_color,
    customGraniteColor: row.custom_granite_color, topShape: row.top_shape, sides: row.sides,
    standardSizeCode: row.standard_size_code, width: row.width_inches, depth: row.depth_inches,
    thickness: row.thickness_inches, height: row.height_inches, baseConfig: row.base_config || {},
  }
}
