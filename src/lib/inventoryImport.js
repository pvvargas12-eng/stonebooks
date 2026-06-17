// =============================================================================
// inventoryImport.js — parse Leo's Inventory workbook (6 sheets, 2 families).
// =============================================================================
// PREVIEW-FIRST: parses + structures only. Nothing writes — the UI shows a preview
// and the operator confirms before any insert.
//
// TWO STRUCTURAL FAMILIES, detected DETERMINISTICALLY from the header row:
//   • FAMILY B — header contains "Assigned to"  → location is a PER-ROW column,
//     each row also carries its family; status = allocated. (Customer, Base Customer)
//     "Base Customer" has a junk col-0 ("ƒtan") that shifts columns right by one;
//     handled automatically because columns are mapped by matching header text.
//   • FAMILY A — header has NO "Assigned to"     → location is a HEADER ROW (value
//     only in the Location column, rest empty) carried DOWN to every stone beneath;
//     status = available. (Base Stones, Stones slant, Bronze Stone, Courtyard)
//
// The header row is found by SCORING (exact header-word matches) across the first 30
// rows — so a header at row 2 (Family A) or row 4 (Family B, under title rows) is
// found the same way, and column indices come from the header (junk columns ignored).
// All text preserved VERBATIM. Identical stones at one location collapse + sum qty.
// SheetJS (xlsx) CDN-lazy-loaded (no npm dep), same pattern as jsPDF.
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

// Type cell → our item_type, with a sheet-based fallback (DIE→die, SLANTS→slant, etc.).
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
  return sheetHint || null
}

// Sheet-name → type hint (used when the Type cell is blank).
function sheetTypeHint(name) {
  const n = String(name || '').toLowerCase()
  if (n.includes('bronze')) return 'bronze'
  if (n.includes('slant'))  return 'slant'
  if (n.includes('base'))   return 'base'
  return null
}

// ── Header detection (exact word match; junk/title rows score ~0) ─────────────
const HEADER_MAP = [
  { key: 'assigned', syn: ['assigned to', 'assigned', 'family', 'sold to'] },
  { key: 'loc',      syn: ['location', 'loc', 'yard'] },
  { key: 'type',     syn: ['type', 'item'] },
  { key: 'color',    syn: ['color', 'colour', 'granite', 'clr'] },
  { key: 'size',     syn: ['size', 'dimension', 'dimensions', 'dim', 'dims', 'sz'] },
  { key: 'top',      syn: ['top'] },
  { key: 'sides',    syn: ['sides', 'side'] },
  { key: 'back',     syn: ['back'] },
  { key: 'quantity', syn: ['amount', 'amt', 'qty', 'quantity', 'count', 'number'] },
]
function matchHeaderCell(v) {
  let s = String(v ?? '').trim().toLowerCase()
  if (!s || s.length > 24) return null
  s = s.replace(/[\s:.\-#]+$/, '').trim()
  for (const h of HEADER_MAP) if (h.syn.includes(s)) return h.key
  return null
}
function findHeaderRow(rows) {
  let best = null
  for (let i = 0; i < Math.min(rows.length, 30); i++) {
    const row = rows[i] || []
    const cols = {}
    let hits = 0
    for (let c = 0; c < row.length; c++) {
      const key = matchHeaderCell(row[c])
      if (key && cols[key] == null) { cols[key] = c; hits++ }
    }
    const strong = ['size', 'color', 'type', 'top', 'sides', 'back'].some(k => cols[k] != null)
    if (hits >= 2 && strong && (!best || hits > best.hits)) best = { rowIdx: i, cols, hits }
  }
  return best
}

const cellAt = (row, idx) => (idx == null ? '' : String((row && row[idx]) ?? '').trim())
const nonEmptyCount = (row) => (row || []).reduce((n, c) => n + (String(c ?? '').trim() ? 1 : 0), 0)

// Build one stock item (shared by both families).
function buildItem({ location, typeV, colorV, sizeV, topV, sidesV, backV, amtV, typeHint, allocated, assigned }) {
  const flags = []
  if (!location) flags.push('no-location')
  if (!sizeV) flags.push('no-size')
  const it = inferItemType(typeV, typeHint)
  if (!it) flags.push('unknown-type')
  let qty = parseInt(String(amtV).replace(/[^\d-]/g, ''), 10)
  if (!Number.isFinite(qty) || qty < 1) qty = 1
  const fam = allocated ? (assigned || null) : null
  if (allocated && !fam) flags.push('no-assignee')
  return {
    location: location || null,
    item_type: it || 'custom',
    color: colorV || null, size: sizeV || null, top: topV || null, sides: sidesV || null, back: backV || null,
    quantity: qty,
    status: allocated ? 'allocated' : 'available',
    assigned_to: fam,
    notes: null,
    _flags: flags,
    _rawType: typeV || null,
  }
}

// ── Per-sheet parse (branches on family) ─────────────────────────────────────
function parseSheet(name, rows) {
  const typeHint = sheetTypeHint(name)
  const header = findHeaderRow(rows)
  if (!header) {
    return { sheetName: name, kind: 'stock', family: '?', ok: false, items: [],
      reason: 'No recognizable column headers found (scanned first 30 rows).',
      diag: { headerRow: null, cols: [], rowsYielded: 0 } }
  }
  const { cols } = header
  const family = cols.assigned != null ? 'B' : 'A'

  // Family B (Customer / Base Customer) = historical fulfilled ORDERS, not current
  // yard stock — they carry an "Assigned to" column. Skip them entirely; only the
  // 4 Family-A stock sheets import.
  if (family === 'B') {
    return { sheetName: name, kind: 'customer', family: 'B', ok: false, items: [],
      reason: 'customer / historical orders — not yard stock',
      diag: { headerRow: header.rowIdx, cols: Object.keys(cols), rowsYielded: 0 } }
  }

  // Family A — location is a header row (value only in the Location column) → carry down.
  const items = []
  const C = (row, key) => cellAt(row, cols[key])
  let curLocation = null
  for (let i = header.rowIdx + 1; i < rows.length; i++) {
    const row = rows[i] || []
    if (nonEmptyCount(row) === 0) continue
    const locVal = C(row, 'loc')
    const typeV = C(row, 'type'), colorV = C(row, 'color'), sizeV = C(row, 'size')
    const topV = C(row, 'top'), sidesV = C(row, 'sides'), backV = C(row, 'back'), amtV = C(row, 'quantity')
    // LOCATION row — value ONLY in the Location column.
    if (locVal && !typeV && !colorV && !sizeV && !topV && !sidesV && !backV && !amtV) {
      curLocation = locVal
      continue
    }
    // STONE row — must carry some stone data; location comes from carry-down.
    if (!(typeV || colorV || sizeV || topV || sidesV || amtV)) continue
    items.push(buildItem({ location: curLocation, typeV, colorV, sizeV, topV, sidesV, backV, amtV, typeHint, allocated: false }))
  }
  return { sheetName: name, kind: 'stock', family: 'A', ok: true, items,
    diag: { headerRow: header.rowIdx, cols: Object.keys(cols), rowsYielded: items.length } }
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
    } else map.set(key, { ...it, _flags: [...it._flags] })
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
    try {
      console.log(`%c[Inventory Import] RAW — "${name}" (first 20 of ${rows.length} rows)`, 'font-weight:bold;color:#2563eb;font-size:12px')
      for (let i = 0; i < Math.min(rows.length, 20); i++) console.log(`  [${i}]`, JSON.stringify(rows[i]))
    } catch { /* */ }
    const parsed = parseSheet(name, rows)
    if (parsed.ok) {
      const collapsed = collapse(parsed.items)
      sheets.push({ sheetName: name, kind: parsed.kind, family: parsed.family, items: collapsed, skipped: false,
        diag: { ...parsed.diag, rowsAfterCollapse: collapsed.length, rawRowCount: rows.length } })
      allItems = allItems.concat(collapsed)
    } else {
      sheets.push({ sheetName: name, kind: parsed.kind, family: parsed.family, items: [], skipped: true, reason: parsed.reason,
        diag: { ...parsed.diag, rawRowCount: rows.length } })
    }
  }

  try {
    const diagRows = sheets.map(s => ({
      sheet: s.sheetName, family: s.family, kind: s.kind,
      headerRow: s.diag?.headerRow != null ? (s.diag.headerRow + 1) : 'NONE',
      columns: (s.diag?.cols || []).join(','),
      rawRows: s.diag?.rawRowCount ?? 0, parsed: s.diag?.rowsYielded ?? 0, collapsed: s.items?.length ?? 0,
      skipReason: s.skipped ? (s.reason || 'skipped') : '',
    }))
    console.log('%c[Inventory Import] per-sheet breakdown', 'font-weight:bold;color:#9A7209;font-size:13px')
    if (console.table) console.table(diagRows); else console.log(JSON.stringify(diagRows, null, 2))
  } catch { /* */ }

  const locations = new Set(allItems.map(i => i.location || '(no location)'))
  return {
    sheets, allItems,
    summary: {
      sheetCount: wb.SheetNames.length,
      skippedSheets: sheets.filter(s => s.skipped).length,
      rowCount: allItems.length,
      totalStones: allItems.reduce((s, i) => s + (Number(i.quantity) || 0), 0),
      locationCount: locations.size,
      flaggedCount: allItems.filter(i => i._flags.length).length,
    },
  }
}

export const FLAG_LABELS = {
  'no-location': 'No location',
  'no-size': 'No size',
  'unknown-type': 'Type unclear',
  'no-assignee': 'No family name',
}
