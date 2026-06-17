// =============================================================================
// inventoryImport.js — parse Leo's Inventory workbook (6 sheets) for Phase 2.
// =============================================================================
// PREVIEW-FIRST: this module ONLY parses + structures. Nothing writes to the DB
// here — the UI shows a preview and the operator clicks confirm before any insert.
//
// The hard parts, handled here:
//  • Location is a HEADER ROW, not a column — carried DOWN to every stone beneath
//    it until the next header. Location strings preserved VERBATIM (no normalize).
//  • Stock sheets → available / no assignee. Customer sheets → allocated + the
//    "Assigned to" family name (preserved as written).
//  • item_type inferred from the Type cell, falling back to a sheet-based hint.
//  • Identical stones at one location collapse to a single row + summed quantity.
//  • Anything uncertain is FLAGGED (not dropped) so it surfaces in the preview.
//
// SheetJS (xlsx) is CDN-lazy-loaded (no npm dep), same pattern as jsPDF.
// =============================================================================

let _xlsxPromise = null
export function loadXLSX() {
  if (typeof window !== 'undefined' && window.XLSX) return Promise.resolve(window.XLSX)
  if (_xlsxPromise) return _xlsxPromise
  _xlsxPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'
    s.async = true
    s.onload = () => { window.XLSX ? resolve(window.XLSX) : reject(new Error('xlsx loaded but global missing')) }
    s.onerror = () => { _xlsxPromise = null; reject(new Error('Could not load the spreadsheet library (xlsx) from CDN — check the connection')) }
    document.body.appendChild(s)
  })
  return _xlsxPromise
}

// ── Type inference ───────────────────────────────────────────────────────────
// Order matters: more specific words first (a "Slant Die" reads as die only if
// 'die' wins — but for monuments a slant is its own type, so 'slant' is checked
// before 'die' is NOT — we check 'die' last among the shape words to avoid
// swallowing "Double Die" vs "Slant". Tuned for the shop's vocabulary.
function inferItemType(rawType, sheetHint) {
  const t = String(rawType || '').toLowerCase()
  const has = (k) => t.includes(k)
  if (has('bench'))  return 'bench'
  if (has('bevel'))  return 'bevel'
  if (has('hickey')) return 'hickey'
  if (has('grass'))  return 'grass'
  if (has('ledger')) return 'ledger'
  if (has('vase'))   return 'vase'
  if (has('bronze')) return 'bronze'
  if (has('slant'))  return 'slant'
  if (has('marker')) return 'marker'
  if (has('die'))    return 'die'
  if (has('base'))   return 'base'
  return sheetHint || null   // null → caller flags 'unknown-type' + stores 'custom'
}

// Classify a sheet by name → { kind: 'stock'|'customer', typeHint }
function classifySheet(name) {
  const n = String(name || '').toLowerCase()
  const kind = n.includes('customer') ? 'customer' : 'stock'
  let typeHint = null
  if (n.includes('bronze')) typeHint = 'bronze'
  else if (n.includes('slant')) typeHint = 'slant'
  else if (n.includes('base')) typeHint = 'base'
  return { kind, typeHint }
}

// ── Column-header detection ──────────────────────────────────────────────────
const HEADER_MAP = [
  { key: 'type',     syn: ['type'] },
  { key: 'color',    syn: ['color', 'colour'] },
  { key: 'size',     syn: ['size', 'dimension', 'dimensions', 'dim', 'dims'] },
  { key: 'top',      syn: ['top'] },
  { key: 'sides',    syn: ['sides', 'side'] },
  { key: 'back',     syn: ['back'] },
  { key: 'quantity', syn: ['amount', 'qty', 'quantity', 'count', 'number', '#'] },
  { key: 'assigned', syn: ['assigned to', 'assigned', 'customer', 'family', 'name'] },
]
function matchHeaderCell(v) {
  const s = String(v ?? '').trim().toLowerCase()
  if (!s) return null
  for (const h of HEADER_MAP) {
    if (h.syn.some(syn => s === syn || s.includes(syn))) return h.key
  }
  return null
}
// First row (within the first 15) carrying >=2 recognizable headers incl a stone
// indicator (size/color/type). Returns { rowIdx, cols } or null.
function findHeaderRow(rows) {
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const row = rows[i] || []
    const cols = {}
    let hits = 0
    for (let c = 0; c < row.length; c++) {
      const key = matchHeaderCell(row[c])
      if (key && cols[key] == null) { cols[key] = c; hits++ }
    }
    if (hits >= 2 && (cols.size != null || cols.color != null || cols.type != null)) {
      return { rowIdx: i, cols }
    }
  }
  return null
}

const cellAt = (row, idx) => (idx == null ? '' : String((row && row[idx]) ?? '').trim())
const nonEmptyCount = (row) => (row || []).reduce((n, c) => n + (String(c ?? '').trim() ? 1 : 0), 0)
const firstNonEmpty = (row) => { const c = (row || []).find(x => String(x ?? '').trim()); return c == null ? '' : String(c).trim() }

// ── Per-sheet parse ──────────────────────────────────────────────────────────
function parseSheet(name, rows) {
  const { kind, typeHint } = classifySheet(name)
  const header = findHeaderRow(rows)
  if (!header) {
    return { sheetName: name, kind, ok: false, reason: 'No recognizable column headers (Type / Color / Size …) — sheet skipped.', items: [] }
  }
  const { cols } = header
  const items = []
  let curLocation = null

  for (let i = header.rowIdx + 1; i < rows.length; i++) {
    const row = rows[i] || []
    const ne = nonEmptyCount(row)
    if (ne === 0) continue

    const sizeV = cellAt(row, cols.size)
    const colorV = cellAt(row, cols.color)
    const typeV = cellAt(row, cols.type)

    // LOCATION HEADER: a label row — no size, no color, and just 1–2 cells.
    // Carried down to every stone beneath, verbatim.
    if (!sizeV && !colorV && ne <= 2) {
      curLocation = firstNonEmpty(row)
      continue
    }

    // STONE ROW.
    const flags = []
    if (!curLocation) flags.push('no-location')
    if (!sizeV) flags.push('no-size')
    const it = inferItemType(typeV, typeHint)
    if (!it) flags.push('unknown-type')

    let qty = parseInt(String(cellAt(row, cols.quantity)).replace(/[^\d-]/g, ''), 10)
    if (!Number.isFinite(qty) || qty < 1) qty = 1

    const assigned = kind === 'customer' ? (cellAt(row, cols.assigned) || null) : null
    if (kind === 'customer' && !assigned) flags.push('no-assignee')

    items.push({
      location:    curLocation || null,
      item_type:   it || 'custom',
      color:       colorV || null,
      size:        sizeV || null,
      top:         cellAt(row, cols.top) || null,
      sides:       cellAt(row, cols.sides) || null,
      back:        cellAt(row, cols.back) || null,
      quantity:    qty,
      status:      kind === 'customer' ? 'allocated' : 'available',
      assigned_to: assigned,
      notes:       null,
      _flags:      flags,
      _rawType:    typeV || null,
    })
  }
  return { sheetName: name, kind, ok: true, items }
}

// Collapse identical stones at the same location → one row, summed quantity.
function collapse(items) {
  const map = new Map()
  for (const it of items) {
    const key = [it.location, it.item_type, it.color, it.size, it.top, it.sides, it.back, it.status, it.assigned_to]
      .map(x => String(x ?? '')).join('||')
    const ex = map.get(key)
    if (ex) {
      ex.quantity += it.quantity
      for (const f of it._flags) if (!ex._flags.includes(f)) ex._flags.push(f)
    } else {
      map.set(key, { ...it, _flags: [...it._flags] })
    }
  }
  return [...map.values()]
}

// ── Public: parse a whole workbook (ArrayBuffer) → structured preview ─────────
export async function parseInventoryWorkbook(arrayBuffer) {
  const XLSX = await loadXLSX()
  const wb = XLSX.read(new Uint8Array(arrayBuffer), { type: 'array' })
  const sheets = []
  let allItems = []
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name]
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' })
    const parsed = parseSheet(name, rows)
    if (parsed.ok) {
      const collapsed = collapse(parsed.items)
      sheets.push({ sheetName: name, kind: parsed.kind, items: collapsed, skipped: false })
      allItems = allItems.concat(collapsed)
    } else {
      sheets.push({ sheetName: name, kind: parsed.kind, items: [], skipped: true, reason: parsed.reason })
    }
  }
  const locations = new Set(allItems.map(i => i.location || '(no location)'))
  const flaggedCount = allItems.filter(i => i._flags.length).length
  const totalStones = allItems.reduce((s, i) => s + (Number(i.quantity) || 0), 0)
  return {
    sheets,
    allItems,
    summary: {
      sheetCount: wb.SheetNames.length,
      skippedSheets: sheets.filter(s => s.skipped).length,
      rowCount: allItems.length,
      totalStones,
      locationCount: locations.size,
      flaggedCount,
    },
  }
}

export const FLAG_LABELS = {
  'no-location': 'No location',
  'no-size': 'No size',
  'unknown-type': 'Type unclear',
  'no-assignee': 'No family name',
}
