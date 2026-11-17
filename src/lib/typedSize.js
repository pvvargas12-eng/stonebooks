// =============================================================================
// typedSize — a die or a base is TYPED (three boxes), never picked from a list
// (TYPED-SIZE, Paul 2026-11-17: "remove the die size, always start with custom
// die size L, thickness, height ... remove pick base size and type out the base
// size like you do the die").
// =============================================================================
// The price does not move: a typed size that IS a size printed on the price
// sheet resolves to that printed size (standardSizeCode / baseConfig.sizeCode),
// so it carries the printed price exactly as the old dropdown did. Any other
// size goes the custom path the dropdown's "Custom size" already used.
// Leaf module: the catalog only (no orderRates / SalesMode import, no cycle).
// =============================================================================
import { SHAPES, BASE_SIZES, snapHeightToTier } from './monumentCatalog'
import { tokenToInches } from './yardStone'

const pos = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null }

// Flat stones: the third box is the stone's thickness, not a height.
const FLAT = new Set(['grass', 'hickey', 'bronze'])
export const isFlatShape = (code) => FLAT.has(code)
export const dieBoxLabels = (code) => (isFlatShape(code) ? ['Length (L)', 'Width (W)', 'Thickness'] : ['Length (L)', 'Thickness', 'Height (H)'])

// The printed size these three numbers are, or null.
export function dieSizeCodeFor(shapeCode, L, W, H) {
  const sh = SHAPES.find(s => s.code === shapeCode)
  if (!sh || !L || !W || !H) return null
  return (sh.standardSizes || []).find(s => s.w === L && s.d === W && s.t === H)?.code || null
}

// [L, W, H] in inches as the order holds them today, whichever screen wrote it
// (printed size, the order form's custom fields, the wizard's, the quote's).
export function dieDimsOf(order) {
  const sh = SHAPES.find(s => s.code === order?.shape)
  const std = order?.standardSizeCode ? sh?.standardSizes?.find(s => s.code === order.standardSizeCode) : null
  if (std) return [std.w, std.d, std.t]
  const L = pos(order?.width), W = pos(order?.depth)
  if (isFlatShape(order?.shape)) return [L, W, pos(order?.thickness) ?? pos(order?.height)]
  // Uprights and slants: height lives in `height`; the wizard's old custom
  // inputs kept it in `thickness` (the quote keeps the front-to-back there).
  const th = pos(order?.thickness)
  return [L, W ?? th, pos(order?.height) ?? (th != null && th !== W ? th : null)]
}

// The order patch for three typed numbers (any may be null while typing).
export function dieSizePatch(shapeCode, [L, W, H]) {
  const flat = isFlatShape(shapeCode)
  return {
    standardSizeCode: dieSizeCodeFor(shapeCode, L, W, H),
    width: L ?? null,
    depth: W ?? null,
    height: flat ? null : (H ?? null),
    thickness: flat ? (H ?? null) : (W ?? null),
  }
}

// ── Base ────────────────────────────────────────────────────────────────────
// A printed base's height is the last feet-inches token of its label
// ("2-0 × 1-0 × 0-8 polished top" → 8).
export function baseStdHeight(b) {
  const toks = String(b?.label || '').match(/\d+-\d+(?:\.\d+)?/g) || []
  return toks.length >= 3 ? tokenToInches(toks[2]) : null
}
export function baseSizeCodeFor(L, W, H) {
  if (!L || !W) return null
  return BASE_SIZES.find(b => b.w === L && b.d === W && (!H || baseStdHeight(b) === H))?.code || null
}
export function baseDimsOf(bc) {
  const std = bc?.sizeCode && bc.sizeCode !== 'custom' ? BASE_SIZES.find(b => b.code === bc.sizeCode) : null
  if (std) return [std.w, std.d, baseStdHeight(std)]
  return [pos(bc?.width), pos(bc?.depth), pos(bc?.heightInches)]
}
// { patch, custom }: a printed size keeps its printed price (height included,
// so no height tier rides along); anything else is a custom base.
export function baseSizePatch([L, W, H]) {
  const code = baseSizeCodeFor(L, W, H)
  if (code) return { custom: false, patch: { sizeCode: code, width: L, depth: W, heightInches: null, heightCode: null } }
  if (!L && !W && !H) return { custom: false, patch: { sizeCode: null, width: null, depth: null, heightInches: null, heightCode: null } }
  return { custom: true, patch: { sizeCode: 'custom', width: L ?? null, depth: W ?? null, heightInches: H ?? null, heightCode: snapHeightToTier(H) } }
}
// The smallest printed base that is larger than the die on both sides.
export function suggestedBaseFor(dieL, dieW) {
  if (!dieL || !dieW) return null
  return BASE_SIZES
    .filter(b => b.w > dieL && b.d > dieW)
    .sort((a, z) => ((a.w - dieL) + (a.d - dieW)) - ((z.w - dieL) + (z.d - dieW)))[0] || null
}
