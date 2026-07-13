// =============================================================================
// salesOptions.js — Settings-managed sales option lists (Directive Part 1)
// =============================================================================
// ONE table (public.sales_options) holds owner-editable option lists per
// category. category='stone_color' ships first; more categories drop in later
// without schema changes.
//
// HOW STONE COLORS FLOW (the important part):
//   • sales_options is the SOURCE OF TRUTH for which colors are offered, their
//     labels, premiums, swatches, and order.
//   • The pricing engine, PDFs, and dozens of render paths do synchronous
//     GRANITE_COLORS.find(code) lookups. Rather than rewrite all of them,
//     applyStoneColorsToCatalog() merges the fetched rows INTO the shared
//     GRANITE_COLORS table in place at load time (the exact pattern
//     applyPricingConfig uses for every other rate table):
//        - row.value matches an existing code → label/premium/imageUrl updated
//        - new value → a new catalog entry is pushed (family inferred from the
//          label so the picker can group it)
//     DEACTIVATED rows are merged too (flagged isActive:false) — legacy orders
//     that saved a now-deactivated color must keep rendering and pricing.
//   • Pickers list ACTIVE colors only, via getActiveStoneColors().
//   • Order totals are protected from later premium edits by the order-level
//     premium snapshot (effectiveColorPremium in monumentCatalog.js).
//
// LOAD ORDER: loadSalesOptions() runs at app boot right after
// loadPricingConfig(). savePricingConfig() re-applies the stored pricing
// config (which resets GRANITE_COLORS premiums to hardcoded defaults), so it
// calls reapplyStoneColors() afterwards — sales_options premium always wins.
// =============================================================================

import { supabase } from './supabase'
import { GRANITE_COLORS } from './monumentCatalog'

export const SALES_OPTIONS_TENANT_ID = 'a1b2c3d4-e5f6-7890-abcd-ef0123456789'

// Session cache: category → rows (all rows, active + inactive, sort_order asc)
const _cache = new Map()
let _stoneColorsPromise = null

// Best-effort family inference for NEW colors (sales_options carries no family
// column; family only drives picker grouping + the optional design-match
// filter, so a rough keyword match is fine).
function inferFamily(label) {
  const l = (label || '').toLowerCase()
  if (l.includes('gray') || l.includes('grey')) return 'gray'
  if (l.includes('black')) return 'black'
  if (l.includes('blue')) return 'blue'
  if (l.includes('pink') || l.includes('rose')) return 'pink'
  if (l.includes('red')) return 'red'
  if (l.includes('mahogany')) return 'mahogany'
  if (l.includes('green')) return 'green'
  return 'multi'
}

export async function fetchSalesOptions(category, { force = false } = {}) {
  if (!force && _cache.has(category)) return _cache.get(category)
  const { data, error } = await supabase
    .from('sales_options')
    .select('*')
    .eq('tenant_id', SALES_OPTIONS_TENANT_ID)
    .eq('category', category)
    .order('sort_order', { ascending: true })
  if (error) throw error
  // Never cache an empty result. A pre-auth fetch against the RLS-locked table
  // returns 0 rows with NO error; caching that would pin the failure for the
  // session (reapplyStoneColors re-applies from this cache). A truly empty
  // category just re-fetches — cheap and safe.
  if (data && data.length > 0) _cache.set(category, data)
  return data || []
}

// Merge fetched stone_color rows into the shared GRANITE_COLORS table in
// place. Never removes entries — a color absent from sales_options (or
// deactivated) stays available for legacy-order lookups.
export function applyStoneColorsToCatalog(rows) {
  // Zero rows means the fetch didn't really see the table (pre-auth RLS, bad
  // filter, wiped seed) — NEVER interpret it as "deactivate every color".
  // Leave the catalog as-is; getActiveStoneColors treats isActive:undefined
  // as active, so the hardcoded colors keep the picker working.
  if (!rows || rows.length === 0) return
  const bySortOrder = new Map()
  for (const r of rows) {
    bySortOrder.set(r.value, r.sort_order ?? 0)
    const existing = GRANITE_COLORS.find(c => c.code === r.value)
    if (existing) {
      existing.label = r.label || existing.label
      existing.premium = Number(r.premium) || 0
      existing.imageUrl = r.image_url || null
      existing.isActive = r.is_active !== false
    } else {
      GRANITE_COLORS.push({
        code: r.value,
        label: r.label,
        origin: null,
        file: null,
        imageUrl: r.image_url || null,
        family: inferFamily(r.label),
        popular: false,
        premium: Number(r.premium) || 0,
        isActive: r.is_active !== false,
      })
    }
  }
  // Hardcoded colors not present in sales_options stay usable for legacy
  // orders but are NOT offered on new ones.
  for (const c of GRANITE_COLORS) {
    if (!bySortOrder.has(c.code)) c.isActive = false
    c.sortOrder = bySortOrder.has(c.code) ? bySortOrder.get(c.code) : 9999
  }
  GRANITE_COLORS.sort((a, z) => (a.sortOrder ?? 9999) - (z.sortOrder ?? 9999))
}

// Fetch + apply, once per session (concurrent callers share the promise).
// Network failure falls back to the hardcoded catalog (all entries active) so
// the wizard never renders an empty picker.
export function loadSalesOptions({ force = false } = {}) {
  if (_stoneColorsPromise && !force) return _stoneColorsPromise
  _stoneColorsPromise = fetchSalesOptions('stone_color', { force })
    .then(rows => {
      if (!rows || rows.length === 0) {
        // Silent-empty result (pre-auth RLS or missing seed): fall back to the
        // hardcoded catalog and allow a retry — don't memoize the miss.
        console.warn('loadSalesOptions: 0 stone_color rows — keeping hardcoded catalog')
        for (const c of GRANITE_COLORS) { if (c.isActive == null) c.isActive = true }
        _stoneColorsPromise = null
        return null
      }
      applyStoneColorsToCatalog(rows)
      return rows
    })
    .catch(err => {
      console.error('loadSalesOptions:', err?.message || err)
      for (const c of GRANITE_COLORS) { if (c.isActive == null) c.isActive = true }
      _stoneColorsPromise = null
      return null
    })
  return _stoneColorsPromise
}

// Re-apply the cached rows onto GRANITE_COLORS (used after savePricingConfig
// resets the catalog premiums to hardcoded defaults).
export function reapplyStoneColors() {
  const rows = _cache.get('stone_color')
  if (rows) applyStoneColorsToCatalog(rows)
}

// The picker list: active colors in settings order. Synchronous — reads the
// already-merged catalog. Before loadSalesOptions resolves (or if it failed),
// entries with isActive undefined are treated as active so the picker works.
export function getActiveStoneColors() {
  return GRANITE_COLORS.filter(c => c.isActive !== false)
}

// Swatch URL for a catalog color — uploaded image wins, then the bundled
// /granite asset; null means "no swatch" (dropdown-only color).
export function colorSwatchUrl(c) {
  if (!c) return null
  if (c.imageUrl) return c.imageUrl
  if (c.file) return `/granite/${c.file}`
  return null
}

// ── Settings-tab CRUD ────────────────────────────────────────────────────────

export async function listSalesOptions(category) {
  return fetchSalesOptions(category, { force: true })
}

export async function createSalesOption({ category, label, value, premium = 0, imageUrl = null, sortOrder = 0 }) {
  const { data, error } = await supabase
    .from('sales_options')
    .insert({
      tenant_id: SALES_OPTIONS_TENANT_ID,
      category, label, value,
      premium, image_url: imageUrl, sort_order: sortOrder,
    })
    .select()
    .single()
  if (error) throw error
  _cache.delete(category)
  return data
}

export async function updateSalesOption(id, patch) {
  const allowed = {}
  if ('label' in patch) allowed.label = patch.label
  if ('premium' in patch) allowed.premium = patch.premium
  if ('imageUrl' in patch) allowed.image_url = patch.imageUrl
  if ('sortOrder' in patch) allowed.sort_order = patch.sortOrder
  if ('isActive' in patch) allowed.is_active = patch.isActive
  const { data, error } = await supabase
    .from('sales_options')
    .update(allowed)
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  _cache.delete(data.category)
  return data
}

// Persist a full reorder: ids in display order → sort_order 10, 20, 30…
export async function reorderSalesOptions(category, orderedIds) {
  for (let i = 0; i < orderedIds.length; i++) {
    const { error } = await supabase
      .from('sales_options')
      .update({ sort_order: (i + 1) * 10 })
      .eq('id', orderedIds[i])
    if (error) throw error
  }
  _cache.delete(category)
}

// Upload a swatch image to the public sales-options bucket; returns public URL.
export async function uploadSalesOptionImage(file, value) {
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase()
  const path = `stone_color/${value}-${Date.now()}.${ext}`
  const { error } = await supabase.storage.from('sales-options').upload(path, file, { upsert: true })
  if (error) throw error
  const { data } = supabase.storage.from('sales-options').getPublicUrl(path)
  return data?.publicUrl || null
}

// Refresh the picker/pricing catalog after any settings change.
export async function refreshStoneColorCatalog() {
  const rows = await fetchSalesOptions('stone_color', { force: true })
  applyStoneColorsToCatalog(rows)
  return rows
}
