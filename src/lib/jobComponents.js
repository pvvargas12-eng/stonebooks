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
  new_stone:   ['ready_to_bring_up', 'brought_to_line', 'cut', 'stencil_cut', 'stencil_stuck', 'blast', 'quality_check', 'ready_to_set'],
  inscription: ['needs_rubbing', 'stencil_cut', 'inscription_complete'],
  door:        ['pickup_doors', 'cut_stencil', 'stick_stencil', 'blast', 'quality_check', 'drop_off_doors'],
}

export const PHASE_LABEL = {
  ready_to_bring_up: 'Ready to Bring Up', brought_to_line: 'Brought to Line', cut: 'Cut',
  stencil_cut: 'Stencil Cut', stencil_stuck: 'Stencil Stuck', blast: 'Blast',
  quality_check: 'Quality Check', ready_to_set: 'Ready to Set',
  needs_rubbing: 'Needs Rubbing from Cemetery', inscription_complete: 'Inscription Complete',
  pickup_doors: 'Pickup Doors', cut_stencil: 'Cut Stencil', stick_stencil: 'Stick Stencil',
  drop_off_doors: 'Drop Off Doors',
}
export const TRACK_LABEL = { new_stone: 'New Stone', inscription: 'Inscription', door: 'Mausoleum Door' }
export const INITIAL_PHASE = { new_stone: 'ready_to_bring_up', inscription: 'needs_rubbing', door: 'pickup_doors' }
// Quality Check is a hold-gate on new_stone + doors only (inscriptions have none).
export const QC_PHASE = 'quality_check'
export const TRACKS_WITH_QC = new Set(['new_stone', 'door'])

export const phaseLabel = (code) => PHASE_LABEL[code] || code
export const trackPhases = (track) => TRACK_PHASES[track] || []
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
