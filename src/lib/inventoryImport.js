// =============================================================================
// inventoryImport.js — parse Leo's Inventory workbook (6 sheets) for Phase 2.
// =============================================================================
// PREVIEW-FIRST: this module ONLY parses + structures. Nothing writes to the DB
// here — the UI shows a preview and the operator clicks confirm before any insert.
//
// The hard parts, handled here:
//  • Location is a HEADER ROW, not a column — carried DOWN to every stone beneath
//    it until the next header. (If a sheet DOES use a per-row Location column, that
//    value wins for the row.) Location strings preserved VERBATIM (no normalize).
//  • Header row is found by SCORING the first 30 rows (skips title rows like
//    "SHEVCHENKO MONUMENTS" and junk columns) — the best-matching row wins.
//  • Location-vs-stone detection is CELL-COUNT based (mapping-robust): a label row
//    has <=2 filled cells; a stone row has several. So a mis-mapped size/color
//    column can NOT silently swallow stone rows.
//  • Type blank per-row (the slant sheet) → item_type inferred from the SHEET
//    (slant→slant, bronze→bronze, base→base) instead of dropping the row.
//  • Identical stones at one location collapse to a single row + summed quantity.
//  • Nothing is dropped: uncertain rows are FLAGGED so they surface in the preview.
//  • Per-sheet DIAGNOSTICS (header row index, mapped columns, rows yielded) ride
//    on every sheet so the preview shows exactly what each sheet detected.
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

// ── Type inference (Type cell → our enum, with a sheet-based fallback) ─────────
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
  else if (n.includes('slant')) typeHint = 'slant'   // slant sheet: dies/slants/hickeys, type implied
  else if (n.includes('base')) typeHint = 'base'
  return { kind, typeHint }
}

// ── Column-header detection ──────────────────────────────────────────────────
const HEADER_MAP = [
  { key: 'type',     syn: ['type', 'item'] },
  { key: 'color',    syn: ['color', 'colour', 'granite', 'clr'] },
  { key: 'size',     syn: ['size', 'dimension', 'dimensions', 'dim', 'dims', 'sz'] },
  { key: 'top',      syn: ['top'] },
  { key: 'sides',    syn: ['sides', 'side'] },
  { key: 'back',     syn: ['back'] },
  { key: 'quantity', syn: ['amount', 'amt', 'qty', 'quantity', 'count', 'number'] },
  { key: 'assigned', syn: ['assigned to', 'assigned', 'family', 'sold to'] },
  { key: 'loc',      syn: ['location', 'loc', 'yard'] },
]
function matchHeaderCell(v) {
  const s = String(v ?? '').trim().toLowerCase()
  if (!s || s.length > 24) return null   // header labels are short; skip long prose
  for (const h of HEADER_MAP) {
    if (h.syn.some(syn => s === syn || s.includes(syn))) return h.key
  }
  return null
}
// Score the first 30 rows; the row with the MOST distinct header matches (>=2, and
// at least one stone-ish column) wins. Naturally skips title rows / junk above it.
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
const firstNonEmpty = (row) => { const c = (row || []).find(x => String(x ?? '').trim()); return c == null ? '' : String(c).trim() }

// ── Per-sheet parse ──────────────────────────────────────────────────────────
function parseSheet(name, rows) {
  const { kind, typeHint } = classifySheet(name)
  const header = findHeaderRow(rows)
  if (!header) {
    return {
      sheetName: name, kind, ok: false, items: [],
      reason: 'No recognizable column headers found (scanned first 30 rows).',
      diag: { headerRow: null, cols: [], rowsYielded: 0 },
    }
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
    const locV = cellAt(row, cols.loc)   // per-row location column, if the sheet has one

    // LOCATION HEADER — a label row: no stone data AND <=2 filled cells. Count-based
    // so a mis-mapped size/color column can't eat a real stone row (which has >=3).
    if (!sizeV && !colorV && !typeV && !locV && ne <= 2) {
      curLocation = firstNonEmpty(row)
      continue
    }

    // STONE ROW.
    const flags = []
    const loc = locV || curLocation || null   // a per-row Location column wins, else carried
    if (!loc) flags.push('no-location')
    if (!sizeV) flags.push('no-size')
    const it = inferItemType(typeV, typeHint)
    if (!it) flags.push('unknown-type')

    let qty = parseInt(String(cellAt(row, cols.quantity)).replace(/[^\d-]/g, ''), 10)
    if (!Number.isFinite(qty) || qty < 1) qty = 1

    const assigned = kind === 'customer' ? (cellAt(row, cols.assigned) || null) : null
    if (kind === 'customer' && !assigned) flags.push('no-assignee')

    items.push({
      location:    loc,
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
  return {
    sheetName: name, kind, ok: true, items,
    diag: { headerRow: header.rowIdx, cols: Object.keys(cols), rowsYielded: items.length },
  }
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
      sheets.push({
        sheetName: name, kind: parsed.kind, items: collapsed, skipped: false,
        diag: { ...parsed.diag, rowsAfterCollapse: collapsed.length, rawRowCount: rows.length },
      })
      allItems = allItems.concat(collapsed)
    } else {
      sheets.push({
        sheetName: name, kind: parsed.kind, items: [], skipped: true, reason: parsed.reason,
        diag: { ...parsed.diag, rawRowCount: rows.length },
      })
    }
  }
  const locations = new Set(allItems.map(i => i.location || '(no location)'))
  const flaggedCount = allItems.filter(i => i._flags.length).length
  const totalStones = allItems.reduce((s, i) => s + (Number(i.quantity) || 0), 0)

  // DIAGNOSTIC DUMP — per-sheet breakdown to the browser console (F12). Lets Paul
  // paste back exactly which sheets parse and which drop to 0. Never throws.
  try {
    const diagRows = sheets.map(s => ({
      sheet:      s.sheetName,
      kind:       s.kind,
      headerRow:  s.diag?.headerRow != null ? (s.diag.headerRow + 1) : 'NONE',
      columns:    (s.diag?.cols || []).join(',') || '—',
      rawRows:    s.diag?.rawRowCount ?? 0,
      parsed:     s.diag?.rowsYielded ?? 0,
      collapsed:  s.items?.length ?? 0,
      skipReason: s.skipped ? (s.reason || 'skipped') : '',
    }))
    console.log('%c[Inventory Import] per-sheet breakdown', 'font-weight:bold;color:#9A7209;font-size:13px')
    if (console.table) console.table(diagRows); else console.log(JSON.stringify(diagRows, null, 2))
    console.log('[Inventory Import] totals →', { sheets: sheets.length, rows: allItems.length, stones: totalStones, locations: locations.size, flagged: flaggedCount })
  } catch { /* diagnostics must never break the parse */ }

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
