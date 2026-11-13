// =============================================================================
// StonePRWorkspace — the full-screen Stone PR editor (Paul, 2026-07-23)
// =============================================================================
// Replaces the cramped modals for STONE PRs. Permit-Builder-style split:
//   LEFT  — the PR itself: every line fully visible in his vendor-sheet columns
//           (Family · Color · Type · Size · Specs · Qty) + a per-line STOCK
//           toggle ("ordered to have" — no family, lands as available stock).
//   RIGHT — the order rail: search any order, see its die/base specs and color
//           resolved from the SAME resolver the contract uses, open its files
//           (contracts included), then Insert Die / Insert Base or Link a line —
//           so he's confirming sizes against the signed record while typing.
// Three modes:
//   'new'    — build a PR to send (draft; Submit later marks orders stone-ordered)
//   'record' — document a PR that already happened OUTSIDE Stonebooks: lands as
//              Ordered, NEVER writes to orders (data-layer guards), receivable.
//   'edit'   — full-width editing of an existing PR's header + lines.
// =============================================================================
import { Fragment, useState, useEffect, useCallback, useMemo } from 'react'
import {
  listSuppliers, createSupplier, createPR, getBulkOrderWithItems,
  addBulkOrderItem, updateBulkOrderItem, deleteBulkOrderItem, updatePRHeader,
  getActiveStoneOrders, listOrderAttachments, getCurrentStaffName,
  getInventoryStock, allocateInventoryItem, releaseInventoryItem, setOrderPieceInStock, setOrderPieceStatus, logOrderActivity, fmtYardTag, fmtUSD,
} from '../lib/stonebooksData'
import { addStockMatch, removeStockMatch, attachStockMatchesToPR, listStockMatches } from '../lib/stockMatches'
import { rowToOrder } from '../SalesMode'
import { resolveStoneNeeds, matchLineToStock } from '../lib/inventoryMatch'
import { yardStoneSpecLine, yardStoneWhere } from '../lib/yardStone'
import { bookKeyForSupplier, bookName, bookEdition, prBookCost } from '../lib/prCost'

const TYPE_SUGGESTIONS = ['Die', 'Base', 'Backer', 'Grass', 'Hickey', 'Slant', 'Upright', 'Marker', 'Bench', 'Vase', 'Other']
let _tmp = 0
const tmpId = () => `new-${++_tmp}`
const todayISO = () => { const d = new Date(); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` }
const famOfRow = (r) => (r.primary_lastname && String(r.primary_lastname).trim()) || r.order_number || 'Order'

const BLANK = { family_name: '', color: '', item_type: '', size: '', specs: '', quantity: 1, is_stock: false, order_id: null, order_number: null, spec_text: '', notes: '' }

const VENDOR_CHIP = { display: 'inline-block', marginTop: 3, padding: '1px 7px', borderRadius: 999, background: '#16150F', color: '#E9C46A', fontSize: 10.5, fontWeight: 800, letterSpacing: '.04em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%' }

export default function StonePRWorkspace({ mode = 'new', bulkOrderId = null, onClose, onSaved, preload = null }) {
  const isEdit = mode === 'edit'
  const isRecord = mode === 'record'

  // ── Header state ──
  const [suppliers, setSuppliers] = useState([])
  const [supplierId, setSupplierId] = useState('')
  const [supplierName, setSupplierName] = useState('')   // edit-mode display when id missing
  const [showNewSup, setShowNewSup] = useState(false)
  const [newSupName, setNewSupName] = useState('')
  const [placedAt, setPlacedAt] = useState('')
  const [eta, setEta] = useState('')
  const [notes, setNotes] = useState('')
  const [createdBy, setCreatedBy] = useState('')
  const [poNumber, setPoNumber] = useState('')
  const [headerOrig, setHeaderOrig] = useState(null)

  // ── Lines ──
  const [rows, setRows] = useState(() => [{ ...BLANK, id: tmpId(), isNew: true }])
  const [orig, setOrig] = useState({})
  const [loading, setLoading] = useState(isEdit)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState(null)

  // ── Yard matches (PR-MATCH, Paul 2026-11-10: "see if there is a match
  // available before ordering") — the live yard, read once and again after
  // every confirmed match. Matching is OFF when recording a PR that already
  // happened and on a PR that was already received.
  const [stock, setStock] = useState(null)
  const [prStatus, setPrStatus] = useState(null)
  const [matchBusy, setMatchBusy] = useState(null)   // row id being matched
  const [moreFor, setMoreFor] = useState(null)       // row id showing every candidate
  const [note, setNote] = useState(null)
  // PR-MATCH-2 (Paul 2026-11-13): a confirmed match STAYS on the list with its
  // stock number until the PR is saved; Review shows everything, Final PR
  // shows only what the vendor gets. The match record (and the money saved)
  // lives in stock_match_log.
  const [view, setView] = useState('review')            // 'review' | 'final'
  const [hideMatches, setHideMatches] = useState(false) // fold every yard-match strip
  const [folded, setFolded] = useState(() => new Set()) // row ids folded one by one
  const [matchLog, setMatchLog] = useState([])          // this PR's live match records
  const loadStock = useCallback(() => getInventoryStock().then(r => setStock(r.rows || [])).catch(() => setStock([])), [])

  // ── Rail ──
  const [orders, setOrders] = useState(null)     // active-order roster (raw rows)
  const [railQ, setRailQ] = useState('')
  const [railSel, setRailSel] = useState(null)   // selected raw order row
  // QUOTE-GEN (2026-10-16): the order carries the vendor it was priced from
  // (orders.stone_vendor, e.g. KANI INTERNATIONAL) — picking it on the rail
  // preselects that supplier when none is picked yet, so a Kani-priced stone
  // never lands on a Peerless PR by habit.
  const preselectVendor = (o) => {
    if (supplierId || !o?.stone_vendor) return
    const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z]/g, '')
    const want = norm(o.stone_vendor)
    const hit = suppliers.find(s => s.active !== false && (norm(s.name) === want || norm(s.name).startsWith(want.slice(0, 5))))
    if (hit) setSupplierId(hit.id)
  }
  const [railFiles, setRailFiles] = useState(null)

  useEffect(() => {
    // `preload` = smoke mounts only: sample suppliers / lines / yard, no reads.
    if (preload) {
      setSuppliers(preload.suppliers || []); setSupplierId(preload.supplierId || ''); setPoNumber(preload.poNumber || '')
      setRows(preload.rows || []); setStock(preload.stock || []); setOrders([]); setLoading(false); setMatchLog(preload.matchLog || [])
      return
    }
    let alive = true
    listSuppliers().then(r => { if (alive) setSuppliers(r.rows || []) }).catch(() => {})
    getCurrentStaffName().then(n => { if (alive && n) setCreatedBy(n) }).catch(() => {})
    getActiveStoneOrders().then(r => { if (alive) setOrders(r.rows || []) }).catch(() => { if (alive) setOrders([]) })
    if (!isEdit) setPlacedAt(todayISO())
    if (!isRecord) getInventoryStock().then(r => { if (alive) setStock(r.rows || []) }).catch(() => { if (alive) setStock([]) })
    if (isEdit && bulkOrderId) listStockMatches({ bulkOrderId }).then(l => { if (alive) setMatchLog(l) }).catch(() => {})
    return () => { alive = false }
  }, [isEdit, isRecord, preload, bulkOrderId])

  // Edit mode: load the PR + its lines into the grid.
  useEffect(() => {
    if (!isEdit || !bulkOrderId || preload) return
    let alive = true
    ;(async () => {
      const r = await getBulkOrderWithItems(bulkOrderId)
      if (!alive) return
      if (!r.ok) { setErr(r.error); setLoading(false); return }
      const o = r.order || {}
      setPoNumber(o.po_number || '')
      setPrStatus(o.received_at ? 'received' : (o.status || null))
      setSupplierId(o.supplier_id || '')
      setSupplierName(o.supplier_name || '')
      setPlacedAt(o.placed_at ? String(o.placed_at).slice(0, 10) : '')
      setEta(o.supplier_eta ? String(o.supplier_eta).slice(0, 10) : '')
      setNotes((o.notes || '').replace(/\s*·?\s*Created by .+$/, ''))
      setHeaderOrig({ supplier_id: o.supplier_id || '', supplier_name: o.supplier_name || '', placed_at: o.placed_at ? String(o.placed_at).slice(0, 10) : '', supplier_eta: o.supplier_eta ? String(o.supplier_eta).slice(0, 10) : '', notes: (o.notes || '').replace(/\s*·?\s*Created by .+$/, '') })
      const mapped = (r.items || []).map(it => ({
        id: it.id, isNew: false,
        family_name: it.family_name || '', color: it.color || '',
        item_type: it.item_type || '', size: it.size || '', specs: it.specs || [it.top, it.sides].filter(Boolean).join('; '),
        quantity: it.quantity ?? 1, is_stock: !!it.is_stock,
        order_id: it.order_id || null, order_number: null,
        spec_text: it.spec_text || '', notes: it.notes || '',
      }))
      setRows(mapped.length ? mapped : [{ ...BLANK, id: tmpId(), isNew: true }])
      setOrig(Object.fromEntries(mapped.map(m => [m.id, { ...m }])))
      setLoading(false)
    })().catch(e => { if (alive) { setErr(String(e?.message || e)); setLoading(false) } })
    return () => { alive = false }
  }, [isEdit, bulkOrderId, preload])

  // Order numbers for linked lines (display) once the roster is in.
  const orderNoById = useMemo(() => new Map((orders || []).map(o => [o.id, o.order_number])), [orders])

  const setRow = (id, patch) => setRows(rs => rs.map(r => r.id === id ? { ...r, ...patch } : r))
  const removeRow = (id) => setRows(rs => rs.filter(r => r.id !== id))
  const addRow = (patch = {}) => setRows(rs => [...rs, { ...BLANK, id: tmpId(), isNew: true, ...patch }])
  // Stock on / off. Turning it on used to wipe the family and the order link
  // for good (Paul 2026-11-13: "it removes the family name and makes it
  // stock, not helpful"); the line now remembers both and gets them back when
  // Stock is turned off again.
  const toggleStock = (r) => setRow(r.id, r.is_stock
    ? { is_stock: false, family_name: r._prev ? r._prev.family_name : (r.family_name === 'Stock' ? '' : r.family_name), order_id: r._prev?.order_id || null, order_number: r._prev?.order_number || null, _prev: null }
    : { is_stock: true, family_name: 'Stock', order_id: null, order_number: null, _prev: { family_name: r.family_name, order_id: r.order_id, order_number: r.order_number } })
  const toggleFold = (id) => setFolded(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })

  // ── Yard match + book cost per line (both derived, nothing stored) ──
  const matchOn = !isRecord && prStatus !== 'received' && prStatus !== 'cancelled'
  const matchById = useMemo(() => {
    const m = new Map()
    if (!matchOn || !stock) return m
    const used = new Set()   // a reserved stone answers ONE line (double dies: two lines, two stones)
    for (const r of rows) {
      if (r.is_stock) continue
      const res = matchLineToStock(r, stock.filter(st => !used.has(st.id)))
      if (res.reserved) used.add(res.reserved.id)
      if (res.reserved || res.candidates.length) m.set(r.id, res)
    }
    return m
  }, [rows, stock, matchOn])
  const isMatched = (r) => !!matchById.get(r.id)?.reserved
  const matchedRows = rows.filter(isMatched)
  const matchCount = [...matchById.values()].filter(x => !x.reserved).length
  const finalRows = rows.filter(r => !isMatched(r))

  const supplierLabel = (suppliers.find(s => s.id === supplierId)?.name) || supplierName || ''
  const bookKey = bookKeyForSupplier(supplierLabel)
  // Per-line cost is shown on every line; the PR total counts only the lines
  // that are still being ORDERED (a line matched to a yard stone is not).
  const costAll = useMemo(() => (bookKey ? prBookCost(rows.filter(r => r.size.trim() || r.item_type.trim()), bookKey) : null), [rows, bookKey])
  const cost = useMemo(() => {
    if (!bookKey) return null
    const c = prBookCost(rows.filter(r => !matchById.get(r.id)?.reserved && (r.size.trim() || r.item_type.trim())), bookKey)
    return { ...c, byId: costAll ? costAll.byId : c.byId }
  }, [rows, bookKey, matchById, costAll])
  // Money saved by using stock: what the matched lines would have cost in the
  // book, from the match record (so it survives the line leaving the PR).
  const savedTotal = matchLog.reduce((sum, l) => sum + (Number(l.saved_amount) || 0), 0)
  const savedUnpriced = matchLog.filter(l => l.saved_amount == null).length

  const tagOf = (st) => (st?.yard_tag != null ? `#${fmtYardTag(st.yard_tag)}` : 'the unnumbered stone')
  const pieceWord = (fam) => (fam === 'base' ? 'base' : fam === 'backer' ? 'backer' : 'die')

  // Take a line off the PR for good: an existing line is deleted NOW (the
  // yard stone was reserved a second ago; a Cancel must not leave the stone
  // both reserved and still on order), a new line just leaves the grid. A
  // line for several stones gives up one.
  const dropLineFromPR = async (r) => {
    const qty = Math.max(1, Number(r.quantity) || 1)
    if (qty > 1) {
      if (!r.isNew) { const u = await updateBulkOrderItem(r.id, { quantity: qty - 1 }); if (!u.ok) return u }
      setRow(r.id, { quantity: qty - 1 })
      setOrig(o => (o[r.id] ? { ...o, [r.id]: { ...o[r.id], quantity: qty - 1 } } : o))
      return { ok: true, left: qty - 1 }
    }
    if (!r.isNew) { const d = await deleteBulkOrderItem(r.id); if (!d.ok) return d }
    setOrig(o => { if (!o[r.id]) return o; const n = { ...o }; delete n[r.id]; return n })
    removeRow(r.id)
    return { ok: true, left: 0 }
  }

  // CONFIRM MATCH: the yard stone becomes this order's die / base — reserved
  // to the order (allocated + linked), the order's piece flips to In stock
  // (the Monument card's own write, so the Sales dropdown and the job stone
  // status follow), and the line comes off the PR.
  const confirmMatch = async (r, cand, fam) => {
    if (matchBusy) return
    setErr(null); setNote(null)
    if (!r.order_id) { setErr('Link this line to its order first (search the order on the right, then Link), so the stone lands on the right order.'); return }
    const piece = pieceWord(fam)
    const who = r.family_name || r.order_number || orderNoById.get(r.order_id) || 'this order'
    const where = yardStoneWhere(cand.stock)
const ok = window.confirm(`Use yard stone ${tagOf(cand.stock)}${where ? ` (${where})` : ''} as the ${piece.toUpperCase()} for ${who}?\n\nIt is reserved to the order and the order's ${piece} reads In stock. The line stays on this screen marked MATCHED, and is left off the final PR that goes to the vendor. Remove match puts the stone back in stock.`)
    if (!ok) return
    setMatchBusy(r.id)
    try {
      const a = await allocateInventoryItem(cand.stock, { orderId: r.order_id, family: r.family_name || null })
      if (!a.ok) throw new Error(`Could not reserve the stone: ${a.error}`)
      let warn = ''
      if (piece !== 'backer') {
        const p = await setOrderPieceInStock(r.order_id, piece)
        if (!p.ok) warn = ` The order's ${piece} status did not update (${p.error}); set it to In stock on the order.`
      }
      // A line for several stones gives one up now; a single-stone line STAYS
      // on the list, marked MATCHED with the stock number, until the PR is
      // saved (Final PR leaves it off the vendor sheet).
      const qty = Math.max(1, Number(r.quantity) || 1)
      if (qty > 1) {
        const d = await dropLineFromPR(r)
        if (!d.ok) warn += ` The line's quantity could not be lowered (${d.error}); lower it by hand.`
      }
      const c = costAll ? costAll.byId.get(r.id) : null
      const rec = await addStockMatch({
        orderId: r.order_id, bulkOrderId: bulkOrderId || null, poNumber: poNumber || null,
        stockId: cand.stock.id, yardTag: cand.stock.yard_tag ?? null, piece, family: r.family_name || null,
        lineSpec: JSON.stringify({ item_type: r.item_type, size: r.size, color: r.color, specs: r.specs }),
        stoneSpec: yardStoneSpecLine(cand.stock) || null, supplier: supplierLabel || null,
        savedAmount: c && c.ok ? c.unit : null, savedBasis: c && c.ok ? (c.tier === 'exact' && !c.assumedColor ? 'printed row' : 'book rate') : null,
        by: createdBy || null,
      })
      if (rec.ok) setMatchLog(l => [rec.row, ...l])
      else warn += ` The match was made but its record did not save (${rec.error}).`
      Promise.resolve(logOrderActivity(r.order_id, {
        type: 'change', field: 'Stone', newValue: `${piece} from the yard`,
        note: `Yard stone ${tagOf(cand.stock)} matched on ${poNumber || 'a new PR'}: reserved as the ${piece}, not ordered`, actor: createdBy || null,
      })).catch(() => {})
      setNote(`${tagOf(cand.stock)} is now the ${piece} for ${who}. ${qty > 1 ? `The line still orders ${qty - 1}.` : 'The line stays here marked MATCHED and is left off the final PR.'}${warn}`)
      await loadStock()
    } catch (e) { setErr(String(e?.message || e)) }
    setMatchBusy(null)
  }
  // REMOVE MATCH: the yard stone goes back to available stock, the order's
  // piece goes back to what a line on this PR means (Ordered once the PR is
  // out, Not ordered while it is a draft), and the record is closed. With
  // `log` (a match whose line already left the PR) the line is put back.
  const removeMatch = async ({ stockId, yardTag, orderId, piece, who, rowId = null, log = null }) => {
    if (matchBusy || !stockId) return
    setErr(null); setNote(null)
    const tag = yardTag != null ? `#${fmtYardTag(yardTag)}` : 'the unnumbered stone'
    const back = ['submitted', 'ordered', 'partially_received'].includes(prStatus) ? 'ordered' : 'not_ordered'
    const ok = window.confirm(`Remove the match between yard stone ${tag} and ${who}?\n\nThe stone goes back into available stock, and the order's ${piece} reads ${back === 'ordered' ? 'Ordered' : 'Not ordered'} again${log ? ', and its line is put back on this PR' : ''}.\n\nOnly do this if the stone is NOT being used for this order.`)
    if (!ok) return
    setMatchBusy(rowId || stockId)
    try {
      const rel = await releaseInventoryItem({ id: stockId })
      if (!rel.ok) throw new Error(`Could not put the stone back in stock: ${rel.error}`)
      let warn = ''
      if (orderId && piece !== 'backer') {
        const p = await setOrderPieceStatus(orderId, piece, back)
        if (!p.ok) warn = ` The order's ${piece} status did not update (${p.error}); set it on the order.`
      }
      const rm = await removeStockMatch({ stockId, orderId, by: createdBy || null })
      if (!rm.ok) warn += ` The match record did not close (${rm.error}).`
      setMatchLog(l => l.filter(x => x.stock_id !== stockId))
      if (log) {
        let spec = {}
        try { spec = JSON.parse(log.line_spec || '{}') || {} } catch { spec = {} }
        addRow({ family_name: log.family || '', order_id: orderId || null, item_type: spec.item_type || (piece === 'base' ? 'Base' : 'Die'), size: spec.size || '', color: spec.color || '', specs: spec.specs || '' })
      }
      if (orderId) Promise.resolve(logOrderActivity(orderId, {
        type: 'change', field: 'Stone', newValue: `${piece} match removed`,
        note: `Yard stone ${tag} match removed on ${poNumber || 'a new PR'}: the stone is back in stock`, actor: createdBy || null,
      })).catch(() => {})
      setNote(`${tag} is back in available stock. ${who} is on the PR to be ordered${log ? ' (line put back, check it)' : ''}.${warn}`)
      await loadStock()
    } catch (e) { setErr(String(e?.message || e)) }
    setMatchBusy(null)
  }

  // Leaving without saving: lines already matched to a yard stone must not
  // stay on a saved PR where they could be ordered a second time.
  const handleClose = async () => {
    const stuck = matchedRows.filter(r => !r.isNew)
    if (stuck.length) {
      const ok = window.confirm(`${stuck.length} line${stuck.length === 1 ? ' is' : 's are'} matched to yard stones but still on this PR (${stuck.map(r => r.family_name || 'line').join(', ')}).\n\nOK = take ${stuck.length === 1 ? 'it' : 'them'} off the PR now so nothing is ordered twice.\nCancel = stay here.`)
      if (!ok) return
      for (const r of stuck) { const d = await deleteBulkOrderItem(r.id); if (!d.ok) { setErr(d.error); return } }
    }
    onClose?.()
  }

  // ── Rail derivations ──
  const railResults = useMemo(() => {
    if (orders == null) return []
    const t = railQ.trim().toLowerCase()
    if (!t) return []
    // Family OR customer OR order # — Augustus / Cruikshank (2026-10-08) had no
    // deceased name entered, so the family was blank and nothing matched; the
    // customer's name is the only handle on those orders.
    return orders.filter(o => `${o.primary_lastname || ''} ${o._customer_name || ''} ${o.order_number || ''}`.toLowerCase().includes(t)).slice(0, 12)
  }, [orders, railQ])

  const railOrder = useMemo(() => {
    if (!railSel) return null
    try {
      const o = rowToOrder(railSel, null, null)
      o.family = famOfRow(railSel)
      const needs = resolveStoneNeeds([o])
      return { row: railSel, ord: o, needs }
    } catch { return { row: railSel, ord: null, needs: [] } }
  }, [railSel])

  useEffect(() => {
    if (!railSel) { setRailFiles(null); return }
    let alive = true
    setRailFiles(null)
    listOrderAttachments(railSel.id).then(r => { if (alive) setRailFiles(r?.rows || r || []) }).catch(() => { if (alive) setRailFiles([]) })
    return () => { alive = false }
  }, [railSel])

  // A pulled need fills the line with the CONTRACT's die line (SIZE-TRUTH-2):
  // an override / renamed die line goes in verbatim as the size, specs left
  // for the operator; otherwise the dims + top/sides as before. Editable
  // after — "then in the PR I can edit the list" (Paul).
  const insertNeed = (n) => addRow({
    family_name: n.family || '', order_id: n.orderId || null, order_number: n.orderNumber || null,
    color: n.color || '', item_type: n.kind === 'base' ? 'Base' : (n.itemType ? n.itemType.charAt(0).toUpperCase() + n.itemType.slice(1) : 'Die'),
    // A renamed/overridden contract line: SIZE = its dims, SPECS = the rest of
    // the line (minus the color/type the other columns carry). Otherwise the
    // computed dims + top/sides as before.
    size: n.size || '', specs: n.override ? (n.specsText || '') : [n.top, n.sides].filter(Boolean).join('; '),
  })
  const linkRowToRail = (r) => {
    if (!railSel) return
    setRow(r.id, { order_id: railSel.id, order_number: railSel.order_number || null, family_name: r.family_name || famOfRow(railSel), is_stock: false })
  }

  const saveNewSupplier = async () => {
    if (!newSupName.trim()) { setErr('Supplier name is required.'); return }
    const r = await createSupplier({ name: newSupName.trim(), kinds: ['stone'] })
    if (!r.ok) { setErr(r.error); return }
    setSuppliers(s => [...s, r.row])
    setSupplierId(r.row.id)
    setShowNewSup(false); setNewSupName('')
  }

  const realRows = () => rows.filter(r => r.family_name.trim() || r.size.trim() || r.specs.trim() || r.color.trim() || r.order_id)

  const save = async () => {
    if (saving) return
    setErr(null)
    const supplier = suppliers.find(s => s.id === supplierId) || (isEdit && supplierName ? { id: supplierId || null, name: supplierName } : null)
    if (!supplier) { setErr('Pick or create a supplier.'); return }
    const lines = realRows().filter(r => !isMatched(r))
    if (!lines.length && !matchedRows.length) { setErr('Add at least one line item.'); return }
    if (!lines.length && !isEdit) { setErr('Every line is matched to a yard stone, so there is nothing to order. Cancel to leave; the stones stay reserved.'); return }
    if (matchedRows.length && view !== 'final') {
      const ok = window.confirm(`${matchedRows.length} line${matchedRows.length === 1 ? ' is' : 's are'} matched to yard stones (${matchedRows.map(r => `${r.family_name || 'line'} ${tagOf(matchById.get(r.id).reserved)}`).join(', ')}).\n\nSaving takes ${matchedRows.length === 1 ? 'it' : 'them'} off the PR so ${matchedRows.length === 1 ? 'it is' : 'they are'} not ordered. The stones stay reserved and the match record is kept.\n\nOK = save the final PR.  Cancel = keep reviewing (Final PR shows the sheet first).`)
      if (!ok) return
    }
    setSaving(true)
    try {
      if (!isEdit) {
        const r = await createPR({
          kind: 'stone', supplier: { id: supplier.id, name: supplier.name },
          placedAt: placedAt || null, requestedDelivery: eta || null,
          notes: notes || null, createdBy: createdBy || null,
          recorded: isRecord, status: isRecord ? 'ordered' : 'draft',
          lines: lines.map(l => ({ ...l, spec_text: l.spec_text || null })),
        })
        if (!r.ok) throw new Error(r.error)
        await attachStockMatchesToPR(matchLog.filter(l => !l.bulk_order_id).map(l => l.id), r.bulkOrderId).catch(() => {})
        setSaving(false); onSaved?.(r.bulkOrderId); return
      }
      // Edit: header patch + incremental line ops.
      if (headerOrig) {
        const hp = {}
        if ((supplierId || '') !== headerOrig.supplier_id) { hp.supplier_id = supplierId || null; hp.supplier_name = supplier.name }
        if (placedAt !== headerOrig.placed_at) hp.placed_at = placedAt || null
        if (eta !== headerOrig.supplier_eta) hp.supplier_eta = eta || null
        if (notes !== headerOrig.notes) hp.notes = [notes?.trim() || null, createdBy ? `Created by ${createdBy}` : null].filter(Boolean).join(' · ')
        if (Object.keys(hp).length) { const u = await updatePRHeader(bulkOrderId, hp); if (!u.ok) throw new Error(u.error) }
      }
      const keep = rows.filter(r => !isMatched(r))
      const liveIds = new Set(keep.map(r => r.id))
      for (const id of Object.keys(orig)) {
        if (!liveIds.has(id)) { const d = await deleteBulkOrderItem(id); if (!d.ok) throw new Error(d.error) }
      }
      for (const r of keep) {
        if (r.isNew) {
          if (!(r.family_name.trim() || r.size.trim() || r.specs.trim() || r.color.trim() || r.order_id)) continue
          const a = await addBulkOrderItem(bulkOrderId, r, 'stone')
          if (!a.ok) throw new Error(a.error)
        } else {
          const o = orig[r.id]
          if (!o) continue
          const changed = ['family_name', 'color', 'item_type', 'size', 'specs', 'is_stock', 'order_id'].some(k => (o[k] ?? '') !== (r[k] ?? '')) || Number(o.quantity) !== Number(r.quantity)
          if (changed) {
            const u = await updateBulkOrderItem(r.id, {
              family_name: r.family_name, color: r.color, item_type: r.item_type,
              size: r.size, specs: r.specs, quantity: r.quantity,
              is_stock: r.is_stock, order_id: r.order_id,
            })
            if (!u.ok) throw new Error(u.error)
          }
        }
      }
      setSaving(false); onSaved?.(bulkOrderId)
    } catch (e) { setSaving(false); setErr(String(e?.message || e)) }
  }

  const title = isEdit ? (poNumber || 'Edit PR') : isRecord ? 'Record an existing Stone PR' : 'New Stone PR'

  return (
    <div className="prw-overlay">
      <style>{PRW_CSS}</style>
      <div className="prw-top">
        <div className="prw-top-l">
          <div className="prw-eyebrow">{isEdit ? 'Edit Stone PR' : isRecord ? 'Record existing — never touches orders' : 'Build and send'}</div>
          <h2 className="prw-title">{title}
            {cost && cost.priced > 0 && (
              <span className="prw-cost-head" title={`${bookName(bookKey)} book, ${bookEdition(bookKey) || ''}. The listed price for each size and color. Shaped tops, extra polish and freight are not in it.`}>
                {fmtUSD(cost.total)} <small>book cost · {cost.priced} line{cost.priced === 1 ? '' : 's'}{cost.unpriced ? ` · ${cost.unpriced} not priced` : ''}</small>
              </span>
            )}
          </h2>
        </div>
        <div className="prw-top-r">
          {err && <span className="prw-err">{err}</span>}
          <button type="button" className="sb-btn-secondary" onClick={handleClose} disabled={saving}>Cancel</button>
          <button type="button" className="sb-btn-primary" onClick={save} disabled={saving || loading}>
            {saving ? 'Saving…' : isRecord ? 'Record PR' : 'Save PR'}
          </button>
        </div>
      </div>

      <div className="prw-meta">
        <div className="prw-meta-item prw-meta-sup">
          <label className="prw-l">Supplier</label>
          <div className="prw-sup-row">
            <select className="sb-input" value={supplierId} onChange={e => setSupplierId(e.target.value)}>
              <option value="">{isEdit && supplierName ? supplierName : '— pick a supplier —'}</option>
              {suppliers.filter(s => s.active !== false).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <button type="button" className="prw-mini" onClick={() => setShowNewSup(v => !v)}>{showNewSup ? '×' : '+ New'}</button>
          </div>
          {showNewSup && (
            <div className="prw-sup-row" style={{ marginTop: 6 }}>
              <input className="sb-input" placeholder="Supplier name" value={newSupName} onChange={e => setNewSupName(e.target.value)} />
              <button type="button" className="prw-mini" onClick={saveNewSupplier}>Save</button>
            </div>
          )}
        </div>
        <div className="prw-meta-item"><label className="prw-l">{isRecord ? 'Date ordered' : 'Date'}</label>
          <input type="date" className="sb-input" value={placedAt} onChange={e => setPlacedAt(e.target.value)} /></div>
        <div className="prw-meta-item"><label className="prw-l">Requested delivery</label>
          <input type="date" className="sb-input" value={eta} onChange={e => setEta(e.target.value)} /></div>
        <div className="prw-meta-item prw-meta-notes"><label className="prw-l">Notes</label>
          <input className="sb-input" placeholder="PR notes (prints on the sheet)" value={notes} onChange={e => setNotes(e.target.value)} /></div>
      </div>

      {matchOn && (
        <div className="prw-matchbar">
          <div className="prw-views" role="tablist">
            <button type="button" className={`prw-view${view === 'review' ? ' on' : ''}`} onClick={() => setView('review')}>Review · all {rows.length} lines</button>
            <button type="button" className={`prw-view${view === 'final' ? ' on' : ''}`} onClick={() => setView('final')}>Final PR · {finalRows.length} to order</button>
          </div>
          {view === 'review' && matchCount > 0 && <span><b>{matchCount}</b> line{matchCount === 1 ? '' : 's'} may already be in the yard.</span>}
          {matchedRows.length > 0 && <span className="prw-matchbar-done"><b>{matchedRows.length}</b> matched: {matchedRows.map(r => `${r.family_name || 'line'} ${tagOf(matchById.get(r.id).reserved)}`).join(' · ')}</span>}
          {matchLog.length > 0 && <span className="prw-saved" title="What the matched lines would have cost in the supplier's price book">Saved by using stock <b>{fmtUSD(savedTotal)}</b>{savedUnpriced ? ` · ${savedUnpriced} not priced` : ''}</span>}
          {view === 'review' && (matchCount > 0 || matchedRows.length > 0) && (
            <button type="button" className="prw-mini prw-hide" onClick={() => { setHideMatches(v => !v); setFolded(new Set()) }}>{hideMatches ? 'Show yard matches' : 'Hide yard matches'}</button>
          )}
          {note && <span className="prw-matchbar-note">{note}</span>}
        </div>
      )}
      {!matchOn && note && <div className="prw-matchbar"><span className="prw-matchbar-note">{note}</span></div>}

      <div className="prw-body">
        {/* ── LEFT: the PR lines ── */}
        <div className="prw-left">
          {loading ? <div className="sb-empty">Loading the PR…</div> : (
            <>
              <table className="prw-table">
                <thead><tr>
                  <th className="prw-c-fam">Family</th><th className="prw-c-color">Color</th>
                  <th className="prw-c-type">Type</th><th className="prw-c-size">Size</th>
                  <th>Specs</th><th className="prw-c-qty">Qty</th>
                  <th className="prw-c-stock">Stock</th><th className="prw-c-link">Order</th>
                  {bookKey && <th className="prw-c-cost">Cost</th>}<th />
                </tr></thead>
                <tbody>
                  {(view === 'final' ? finalRows : rows).map(r => {
                    const m = view === 'final' ? null : (matchById.get(r.id) || null)
                    const tone = m ? (m.reserved ? 'res' : m.best.strength === 'exact' ? 'exact' : 'near') : null
                    const c = cost ? cost.byId.get(r.id) : null
                    const shown = m ? (moreFor === r.id ? m.candidates : m.candidates.slice(0, 2)) : []
                    // Folded = the yard strip under the line is hidden (all at once, or this line).
                    const open = !!m && (hideMatches ? folded.has(r.id) : !folded.has(r.id))
                    return (
                    <Fragment key={r.id}>
                    <tr className={`${r.is_stock ? 'prw-row-stock' : ''}${tone ? ` prw-row-m prw-row-m-${tone}` : ''}`}>
                      <td><input className="sb-input" value={r.family_name} disabled={r.is_stock}
                        placeholder={r.is_stock ? 'Stock' : 'Family'} onChange={e => setRow(r.id, { family_name: e.target.value })} /></td>
                      <td><input className="sb-input" value={r.color} placeholder="Md Barre" onChange={e => setRow(r.id, { color: e.target.value })} /></td>
                      <td><input className="sb-input" list="prw-types" value={r.item_type} placeholder="Die" onChange={e => setRow(r.id, { item_type: e.target.value })} /></td>
                      <td><input className="sb-input prw-mono" value={r.size} placeholder="2-0 x 1-0 x 0-8" onChange={e => setRow(r.id, { size: e.target.value })} /></td>
                      <td><input className="sb-input prw-mono" value={r.specs} placeholder="Pol Top; Saw Back; BRP" onChange={e => setRow(r.id, { specs: e.target.value })} /></td>
                      <td><input className="sb-input prw-qty" type="number" min="1" value={r.quantity} onChange={e => setRow(r.id, { quantity: e.target.value })} /></td>
                      <td className="prw-c-stock">
                        {m && (
                          <button type="button" className={`prw-mpill prw-mpill-${tone}`} onClick={() => toggleFold(r.id)}
                            title={`${m.reserved ? 'Matched: this yard stone is reserved to the order' : `${m.candidates.length} yard stone${m.candidates.length === 1 ? '' : 's'} could fill this line`}. Click to ${open ? 'hide' : 'show'} the yard strip.`}>
                            {m.reserved
                              ? `MATCHED${m.reserved.yard_tag != null ? ` #${fmtYardTag(m.reserved.yard_tag)}` : ''}`
                              : `${m.best.stock.yard_tag != null ? `#${fmtYardTag(m.best.stock.yard_tag)}` : 'MATCH'}${m.candidates.length > 1 ? ` +${m.candidates.length - 1}` : ''}`}
                            {open ? ' ▾' : ' ▸'}
                          </button>
                        )}
                        {!(m && m.reserved) && (
                          <button type="button" className={`prw-stock${r.is_stock ? ' on' : ''}`}
                            title={r.is_stock ? 'This line is ordered for stock. Click to make it an order line again (the family comes back).' : 'Order this line for STOCK instead of a family: it lands as available yard stock on receive. This does not hide anything.'}
                            onClick={() => toggleStock(r)}>{r.is_stock ? 'STOCK ×' : 'for stock?'}</button>
                        )}
                      </td>
                      <td className="prw-c-link">
                        {r.order_id
                          ? <span className="prw-linked" title="Linked to this order">{r.order_number || orderNoById.get(r.order_id) || 'linked'}
                              <button type="button" className="prw-unlink" title="Unlink" onClick={() => setRow(r.id, { order_id: null, order_number: null })}>×</button></span>
                          : railSel && !r.is_stock
                            ? <button type="button" className="prw-mini" title={`Link to ${famOfRow(railSel)}`} onClick={() => linkRowToRail(r)}>Link</button>
                            : <span className="prw-nolink">—</span>}
                      </td>
                      {bookKey && (
                        <td className="prw-c-cost">
                          {c && c.ok
                            ? <span className="prw-cost" title={`${c.tier === 'exact' ? 'Printed row' : 'No printed row: face area x the book rate'} · ${c.sizeLabel} · ${c.columnLabel}${c.assumedColor ? ' (color on the line not recognized, priced at the lowest column)' : ''}${c.qty > 1 ? ` · ${fmtUSD(c.unit)} each x ${c.qty}` : ''}`}>
                                {c.tier === 'estimate' || c.assumedColor ? '~' : ''}{fmtUSD(c.total)}
                              </span>
                            : <span className="prw-nolink" title={c ? c.why : ''}>—</span>}
                        </td>
                      )}
                      <td><button type="button" className="prw-rm" title="Remove line" onClick={() => removeRow(r.id)}>×</button></td>
                    </tr>
                    {m && open && (
                      <tr className={`prw-mrow prw-mrow-${tone}`}>
                        <td colSpan={bookKey ? 10 : 9}>
                          <div className="prw-mbox">
                            {m.reserved && (
                              <div className="prw-mline">
                                <span className="prw-mtag prw-mtag-res">MATCHED · NOT ORDERED</span>
                                <span className="prw-mnum">{m.reserved.yard_tag != null ? `#${fmtYardTag(m.reserved.yard_tag)}` : 'no number'}</span>
                                <span className="prw-mspec">{yardStoneSpecLine(m.reserved) || '—'}</span>
                                <span className="prw-mwhere">{yardStoneWhere(m.reserved) || 'location not set'}</span>
                                <button type="button" className="prw-mbtn prw-mbtn-undo" disabled={!!matchBusy}
                                  title="The stone goes back into available stock and this line is ordered again"
                                  onClick={() => removeMatch({ stockId: m.reserved.id, yardTag: m.reserved.yard_tag, orderId: r.order_id, piece: pieceWord(m.family), who: r.family_name || r.order_number || orderNoById.get(r.order_id) || 'this order', rowId: r.id })}>{matchBusy === r.id ? 'Working…' : 'Remove match'}</button>
                              </div>
                            )}
                            {!m.reserved && shown.map(cd => (
                              <div key={cd.stock.id} className="prw-mline">
                                <span className={`prw-mtag prw-mtag-${cd.strength}`}>{cd.strength === 'exact' ? 'EXACT' : cd.strength === 'near' ? 'NEAR' : 'CHECK COLOR'}</span>
                                <span className="prw-mnum">{cd.stock.yard_tag != null ? `#${fmtYardTag(cd.stock.yard_tag)}` : 'no number'}</span>
                                <span className="prw-mspec">{yardStoneSpecLine(cd.stock) || '—'}{cd.why.length ? <em> · {cd.why.join(' · ')}</em> : null}</span>
                                <span className="prw-mwhere">{yardStoneWhere(cd.stock) || 'location not set'}{(Number(cd.stock.quantity) || 1) > 1 ? ` · ${cd.stock.quantity} in the pile` : ''}</span>
                                <button type="button" className="prw-mbtn prw-mbtn-go" disabled={!!matchBusy}
                                  title={r.order_id ? 'Reserve this stone to the order and take the line off the PR' : 'Link the line to its order first'}
                                  onClick={() => confirmMatch(r, cd, m.family)}>{matchBusy === r.id ? 'Working…' : 'Confirm match'}</button>
                              </div>
                            ))}
                            {!m.reserved && m.candidates.length > 2 && (
                              <button type="button" className="prw-mmore" onClick={() => setMoreFor(moreFor === r.id ? null : r.id)}>{moreFor === r.id ? 'Show fewer' : `Show all ${m.candidates.length} yard stones`}</button>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                    </Fragment>
                    )
                  })}
                </tbody>
              </table>
              <datalist id="prw-types">{TYPE_SUGGESTIONS.map(t => <option key={t} value={t} />)}</datalist>
              <div className="prw-addrow">
                <button type="button" className="prw-add" onClick={() => addRow()}>+ Add line</button>
                <button type="button" className="prw-add" onClick={() => addRow({ is_stock: true, family_name: 'Stock' })}>+ Add stock line</button>
              </div>
              {view === 'final' && (
                <div className="prw-finalnote">
                  This is the sheet the vendor gets: {finalRows.length} line{finalRows.length === 1 ? '' : 's'}.
                  {matchedRows.length > 0 ? ` ${matchedRows.length} matched line${matchedRows.length === 1 ? ' is' : 's are'} left off; Save PR takes ${matchedRows.length === 1 ? 'it' : 'them'} off the PR for good.` : ' No matched lines are waiting.'}
                </div>
              )}
              {matchLog.length > 0 && (
                <div className="prw-used">
                  <div className="prw-used-h">Yard stones used on this PR · {matchLog.length} <span>saved {fmtUSD(savedTotal)} against the {bookKey ? bookName(bookKey) : 'supplier'} book{savedUnpriced ? ` (${savedUnpriced} not priced)` : ''}</span></div>
                  {matchLog.map(l => {
                    let spec = {}
                    try { spec = JSON.parse(l.line_spec || '{}') || {} } catch { spec = {} }
                    const onList = rows.some(r => matchById.get(r.id)?.reserved?.id === l.stock_id)
                    return (
                      <div key={l.id} className="prw-used-row">
                        <span className="prw-mnum">{l.yard_tag != null ? `#${fmtYardTag(l.yard_tag)}` : 'no number'}</span>
                        <span className="prw-used-fam">{l.family || 'Order'}<small>{(l.piece || 'stone').toUpperCase()} · {[spec.size, spec.color, spec.specs].filter(Boolean).join(' · ') || 'line not recorded'}</small></span>
                        <span className="prw-used-stone">{l.stone_spec || ''}<small>matched {String(l.matched_at || '').slice(0, 10)}{l.matched_by ? ` · ${l.matched_by}` : ''}</small></span>
                        <span className="prw-used-amt">{l.saved_amount != null ? fmtUSD(Number(l.saved_amount)) : '—'}</span>
                        {!onList && matchOn
                          ? <button type="button" className="prw-mbtn prw-mbtn-undo" disabled={!!matchBusy}
                              onClick={() => removeMatch({ stockId: l.stock_id, yardTag: l.yard_tag, orderId: l.order_id, piece: l.piece || 'die', who: l.family || 'this order', log: l })}>{matchBusy === l.stock_id ? 'Working…' : 'Remove match'}</button>
                          : <span className="prw-nolink" />}
                      </div>
                    )
                  })}
                </div>
              )}
              {cost && (cost.priced > 0 || cost.unpriced > 0) && (
                <div className="prw-costfoot">
                  <span className="prw-costfoot-l">{bookName(bookKey)} book cost{bookEdition(bookKey) ? ` · ${bookEdition(bookKey)}` : ''}</span>
                  <span className="prw-costfoot-v">{fmtUSD(cost.total)}</span>
                  <span className="prw-costfoot-n">
                    {cost.priced} line{cost.priced === 1 ? '' : 's'} priced
                    {cost.estimated ? ` · ${cost.estimated} by the book rate (~)` : ''}
                    {cost.assumed ? ` · ${cost.assumed} with no readable color (~, lowest column)` : ''}
                    {cost.unpriced ? ` · ${cost.unpriced} not priced (hover the dash)` : ''}
                    {matchedRows.length ? ` · ${matchedRows.length} matched line${matchedRows.length === 1 ? '' : 's'} not counted` : ''}
                    . Listed price for the size and color; shaped tops, extra polish and freight are not in it.
                  </span>
                </div>
              )}
              {!bookKey && supplierLabel && rows.some(r => r.size.trim()) && (
                <div className="prw-costfoot"><span className="prw-costfoot-n">No price book is loaded for {supplierLabel}, so no cost is shown. Peerless and Kani are loaded.</span></div>
              )}
              {isRecord && <div className="prw-recnote">Recording only — this PR lands as Ordered for receiving, and never changes any order's data or status. Mismatches surface in the Reconcile tab for your call.</div>}
            </>
          )}
        </div>

        {/* ── RIGHT: the order rail ── */}
        <div className="prw-rail">
          <div className="prw-rail-head">Orders — confirm sizes against the record</div>
          <input className="sb-input" type="search" placeholder="Search family or order #…" value={railQ} onChange={e => setRailQ(e.target.value)} />
          {railQ.trim() && !railSel && (
            <div className="prw-rail-results">
              {orders == null ? <div className="prw-rail-muted">Loading orders…</div>
                : railResults.length === 0 ? <div className="prw-rail-muted">No open orders match.</div>
                : railResults.map(o => (
                  <button key={o.id} type="button" className="prw-rail-row" onClick={() => { setRailSel(o); preselectVendor(o) }}>
                    <span className="prw-rail-fam">{famOfRow(o)}</span>
                    <span className="prw-rail-meta">{o.order_number}{o.status ? ` · ${o.status}` : ''}{o._customer_name && o._customer_name !== famOfRow(o) ? ` · customer ${o._customer_name}` : ''}</span>
                    {o.stone_vendor && <span style={VENDOR_CHIP}>ORDER FROM {o.stone_vendor}</span>}
                  </button>
                ))}
            </div>
          )}
          {railSel && (
            <div className="prw-rail-order">
              <div className="prw-rail-order-head">
                <div>
                  <div className="prw-rail-fam" style={{ fontSize: 15 }}>{famOfRow(railSel)}</div>
                  <div className="prw-rail-meta">{railSel.order_number} · {railSel.status}{railSel.signed_at ? ` · signed ${String(railSel.signed_at).slice(0, 10)}` : ''}</div>
                  {railSel.stone_vendor && <div style={{ marginTop: 4 }}><span style={VENDOR_CHIP}>ORDER FROM {railSel.stone_vendor}</span></div>}
                </div>
                <button type="button" className="prw-mini" onClick={() => { setRailSel(null); setRailQ('') }}>× Close</button>
              </div>

              <div className="prw-rail-sec">Stone on the contract</div>
              {(railOrder?.needs || []).length === 0 && <div className="prw-rail-muted">No die/base spec on this order (service-only or no shape).</div>}
              {(railOrder?.needs || []).map(n => (
                <div key={n.key} className="prw-need">
                  <div className="prw-need-main">
                    <span className="prw-need-kind">{n.kind === 'base' ? 'BASE' : 'DIE'}</span>
                    <span className="prw-mono prw-need-size">{n.size || '—'}</span>
                    {n.color && <span className="prw-rail-meta">{n.color}</span>}
                  </div>
                  {(n.top || n.sides) && <div className="prw-rail-meta">{[n.top, n.sides].filter(Boolean).join(' · ')}</div>}
                  <div className="prw-rail-meta prw-need-spec">{n.spec}</div>
                  <button type="button" className="prw-mini prw-need-add" onClick={() => insertNeed(n)}>Insert as line →</button>
                </div>
              ))}

              <div className="prw-rail-sec">Files on the order</div>
              {railFiles == null ? <div className="prw-rail-muted">Loading files…</div>
                : railFiles.length === 0 ? <div className="prw-rail-muted">No files on this order.</div>
                : railFiles.slice(0, 12).map(f => (
                  <a key={f.id || f.file_url} className="prw-file" href={f.file_url} target="_blank" rel="noreferrer">
                    {f.category ? `[${f.category}] ` : ''}{f.filename || f.file_url}
                  </a>
                ))}
              <div className="prw-rail-hint">Tip: with an order open here, each unlinked PR line shows a Link button.</div>
            </div>
          )}
          {!railSel && !railQ.trim() && (
            <div className="prw-rail-muted" style={{ marginTop: 10 }}>
              Search an order to see its die and base sizes, color, and files — confirm what you're ordering against the signed record, then Insert or Link.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

const PRW_CSS = `
  .prw-overlay { position: fixed; inset: 0; z-index: 1290; background: var(--sb-bg, #F7F4EC); display: flex; flex-direction: column; overflow: hidden; }
  .prw-top { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 14px 22px 10px; border-bottom: 1px solid var(--sb-border, #e4e0d4); background: var(--sb-surface, #fff); flex-wrap: wrap; }
  .prw-eyebrow { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: var(--sb-text-muted, #8a7f6c); }
  .prw-title { margin: 2px 0 0; font-size: 20px; font-weight: 700; color: var(--sb-text, #2a2a2a); }
  .prw-top-r { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .prw-err { color: #b3261e; font-size: 13px; font-weight: 600; max-width: 480px; }
  .prw-meta { display: flex; gap: 14px; padding: 10px 22px; background: var(--sb-surface, #fff); border-bottom: 1px solid var(--sb-border, #e4e0d4); flex-wrap: wrap; align-items: flex-end; }
  .prw-meta-item { min-width: 150px; }
  .prw-meta-sup { min-width: 260px; }
  .prw-meta-notes { flex: 1; min-width: 220px; }
  .prw-l { display: block; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--sb-text-muted, #8a7f6c); margin-bottom: 3px; }
  .prw-sup-row { display: flex; gap: 6px; }
  .prw-mini { font: inherit; font-size: 12px; font-weight: 700; padding: 4px 10px; border-radius: 7px; border: 1px solid var(--sb-border, #d8d2c4); background: #fff; color: #6b5d3a; cursor: pointer; white-space: nowrap; }
  .prw-mini:hover { border-color: #9A7209; color: #9A7209; }

  .prw-body { flex: 1; display: flex; gap: 0; overflow: hidden; }
  .prw-left { flex: 1.6; overflow-y: auto; padding: 16px 18px 40px 22px; }
  .prw-rail { flex: 1; max-width: 420px; min-width: 320px; border-left: 1px solid var(--sb-border, #e4e0d4); background: var(--sb-surface, #fff); overflow-y: auto; padding: 14px 18px 40px; }

  .prw-table { width: 100%; border-collapse: collapse; }
  .prw-table th { text-align: left; font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--sb-text-muted, #8a7f6c); padding: 4px 6px; }
  .prw-table td { padding: 4px 6px; vertical-align: middle; }
  .prw-table .sb-input { font-size: 13px; width: 100%; }
  .prw-mono { font-family: var(--font-m, 'JetBrains Mono'), monospace; font-size: 12.5px; }
  .prw-c-fam { width: 15%; } .prw-c-color { width: 11%; } .prw-c-type { width: 9%; } .prw-c-size { width: 17%; }
  .prw-c-qty { width: 58px; } .prw-qty { text-align: center; }
  .prw-c-stock { width: 118px; text-align: center; } .prw-c-link { width: 96px; }
  .prw-c-cost { width: 78px; text-align: right; white-space: nowrap; }
  .prw-cost { font-family: var(--font-m, 'JetBrains Mono'), monospace; font-size: 12.5px; font-weight: 700; color: #2a2a2a; }
  .prw-cost-head { margin-left: 14px; font-family: var(--font-m, 'JetBrains Mono'), monospace; font-size: 17px; font-weight: 700; color: #9A7209; white-space: nowrap; }
  .prw-cost-head small { font-family: var(--font-b, inherit); font-size: 11.5px; font-weight: 600; color: var(--sb-text-muted, #8a7f6c); }
  .prw-costfoot { margin-top: 14px; display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; border-top: 1.5px solid #2a2a2a; padding-top: 10px; }
  .prw-costfoot-l { font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.05em; color: #6b5d3a; }
  .prw-costfoot-v { font-family: var(--font-m, 'JetBrains Mono'), monospace; font-size: 20px; font-weight: 700; color: #2a2a2a; }
  .prw-costfoot-n { font-size: 12px; color: var(--sb-text-muted, #8a7f6c); flex: 1; min-width: 240px; overflow-wrap: anywhere; }
  .prw-matchbar { display: flex; gap: 16px; flex-wrap: wrap; align-items: center; padding: 8px 22px; background: #eef6ef; border-bottom: 1px solid #cfe3d3; font-size: 13px; color: #1f5c33; }
  .prw-matchbar-note { font-weight: 700; overflow-wrap: anywhere; min-width: 0; }
  .prw-row-m td { background: #f1f8f2; }
  .prw-row-m-near td { background: #fbf6e6; }
  .prw-row-m-res td { background: #edf2f9; }
  .prw-row-m td:first-child, .prw-mrow td { box-shadow: inset 4px 0 0 #1f7a3d; }
  .prw-row-m-near td:first-child, .prw-mrow-near td { box-shadow: inset 4px 0 0 #c9962a; }
  .prw-row-m-res td:first-child, .prw-mrow-res td { box-shadow: inset 4px 0 0 #4a6fa5; }
  .prw-mpill { display: block; margin: 0 auto 3px; max-width: 100%; font-family: var(--font-m, 'JetBrains Mono'), monospace; font-size: 11px; font-weight: 800; border-radius: 999px; padding: 2px 7px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .prw-mpill-exact { background: #1f7a3d; color: #fff; } .prw-mpill-near { background: #c9962a; color: #fff; } .prw-mpill-res { background: #4a6fa5; color: #fff; }
  .prw-table .prw-mrow td { padding: 0 6px 8px; background: #f1f8f2; }
  .prw-table .prw-mrow-near td { background: #fbf6e6; } .prw-table .prw-mrow-res td { background: #edf2f9; }
  .prw-mbox { display: flex; flex-direction: column; gap: 5px; padding: 2px 4px 2px 10px; }
  .prw-mline { display: grid; grid-template-columns: auto auto minmax(0, 1.6fr) minmax(0, 1fr) auto; gap: 10px; align-items: center; font-size: 12.5px; min-width: 0; }
  .prw-mtag { font-size: 9.5px; font-weight: 800; letter-spacing: 0.05em; border-radius: 4px; padding: 2px 6px; white-space: nowrap; }
  .prw-mtag-exact { background: #dff0e3; color: #1f7a3d; } .prw-mtag-near, .prw-mtag-check { background: #f6e9c6; color: #8a6410; } .prw-mtag-res { background: #dbe6f5; color: #34558a; }
  .prw-mnum { font-family: var(--font-m, 'JetBrains Mono'), monospace; font-size: 15px; font-weight: 800; color: #16150F; white-space: nowrap; }
  .prw-mspec { font-family: var(--font-m, 'JetBrains Mono'), monospace; font-size: 12px; color: #2a2a2a; min-width: 0; overflow-wrap: anywhere; }
  .prw-mspec em { font-style: normal; color: #8a6410; }
  .prw-mwhere { color: var(--sb-text-muted, #6f685c); min-width: 0; overflow-wrap: anywhere; }
  .prw-mbtn { font: inherit; font-size: 12px; font-weight: 700; padding: 5px 12px; border-radius: 7px; border: 1px solid var(--sb-border, #d8d2c4); background: #fff; color: #34558a; cursor: pointer; white-space: nowrap; }
  .prw-mbtn-go { background: #1f7a3d; border-color: #1f7a3d; color: #fff; }
  .prw-mbtn:disabled { opacity: 0.55; cursor: default; }
  .prw-mmore { align-self: flex-start; background: none; border: none; padding: 0; font: inherit; font-size: 12px; font-weight: 700; color: #6b5d3a; cursor: pointer; text-decoration: underline; }
  @media (max-width: 1100px) { .prw-mline { grid-template-columns: auto auto minmax(0, 1fr); } .prw-mwhere { grid-column: 1 / -1; } }
  .prw-views { display: inline-flex; gap: 3px; padding: 3px; background: #dcebdf; border-radius: 999px; }
  .prw-view { font: inherit; font-size: 12.5px; font-weight: 600; padding: 5px 13px; border: none; border-radius: 999px; background: transparent; color: #1f5c33; cursor: pointer; white-space: nowrap; }
  .prw-view.on { background: #fff; color: #16150F; font-weight: 700; box-shadow: 0 1px 2px rgba(15,20,25,0.1); }
  .prw-matchbar-done { min-width: 0; overflow-wrap: anywhere; }
  .prw-saved { background: #1f7a3d; color: #fff; border-radius: 999px; padding: 3px 12px; font-size: 12.5px; white-space: nowrap; }
  .prw-saved b { font-family: var(--font-m, 'JetBrains Mono'), monospace; }
  .prw-hide { margin-left: auto; }
  button.prw-mpill { border: none; cursor: pointer; font-family: var(--font-m, 'JetBrains Mono'), monospace; }
  .prw-mbtn-undo { color: #b3261e; border-color: #e3b5b1; }
  .prw-finalnote { margin-top: 12px; font-size: 13px; color: #1f5c33; background: #eef6ef; border: 1px solid #cfe3d3; border-radius: 9px; padding: 9px 12px; overflow-wrap: anywhere; }
  .prw-used { margin-top: 14px; border: 1px solid #cfe3d3; border-radius: 10px; padding: 10px 12px; background: #f7fbf8; }
  .prw-used-h { font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.05em; color: #1f5c33; margin-bottom: 6px; display: flex; gap: 10px; flex-wrap: wrap; align-items: baseline; }
  .prw-used-h span { font-weight: 600; text-transform: none; letter-spacing: 0; color: var(--sb-text-muted, #6f685c); }
  .prw-used-row { display: grid; grid-template-columns: 64px minmax(0, 1.2fr) minmax(0, 1.4fr) 84px auto; gap: 10px; align-items: center; padding: 6px 0; border-top: 1px solid #e3eee6; font-size: 12.5px; min-width: 0; }
  .prw-used-fam, .prw-used-stone { min-width: 0; overflow-wrap: anywhere; font-weight: 700; }
  .prw-used-stone { font-weight: 400; font-family: var(--font-m, 'JetBrains Mono'), monospace; font-size: 12px; }
  .prw-used-row small { display: block; font-weight: 400; font-size: 11.5px; color: var(--sb-text-muted, #6f685c); font-family: var(--font-b, inherit); }
  .prw-used-amt { text-align: right; font-family: var(--font-m, 'JetBrains Mono'), monospace; font-weight: 700; color: #1f7a3d; white-space: nowrap; }
  .prw-row-stock td { background: #f6f3ea; }
  .prw-stock { font: inherit; font-size: 10px; font-weight: 700; letter-spacing: 0.03em; white-space: nowrap; border-radius: 999px; border: 1px solid var(--sb-border, #d8d2c4); background: #fff; color: #9a948a; padding: 3px 9px; cursor: pointer; }
  .prw-stock.on { background: #6b5d3a; border-color: #6b5d3a; color: #fff; }
  .prw-linked { display: inline-flex; align-items: center; gap: 4px; font-family: var(--font-m, 'JetBrains Mono'), monospace; font-size: 11px; font-weight: 700; color: #1f7a3d; background: #e7f3ea; border-radius: 999px; padding: 2px 8px; white-space: nowrap; }
  .prw-unlink { background: none; border: none; color: #1f7a3d; font-size: 13px; cursor: pointer; line-height: 1; padding: 0; }
  .prw-nolink { color: #c9c3b4; }
  .prw-rm { background: none; border: none; color: #b3261e; font-size: 17px; cursor: pointer; line-height: 1; }
  .prw-addrow { display: flex; gap: 10px; margin-top: 12px; }
  .prw-add { background: none; border: 1px dashed var(--sb-border, #d8d2c4); border-radius: 8px; font: inherit; font-size: 13px; font-weight: 600; color: #6b5d3a; padding: 8px 14px; cursor: pointer; }
  .prw-add:hover { background: var(--sb-surface, #fff); }
  .prw-recnote { margin-top: 14px; font-size: 12.5px; color: #6d49b8; background: #ede8f7; border-radius: 9px; padding: 9px 12px; }

  .prw-rail-head { font-size: 12px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.05em; color: var(--sb-text-muted, #8a7f6c); margin-bottom: 8px; }
  .prw-rail-results { margin-top: 8px; border: 1px solid var(--sb-border, #e4e0d4); border-radius: 9px; overflow: hidden; }
  .prw-rail-row { display: flex; flex-direction: column; align-items: flex-start; gap: 1px; width: 100%; text-align: left; font: inherit; background: none; border: none; border-bottom: 1px solid var(--sb-border-soft, #f0ece2); padding: 8px 11px; cursor: pointer; }
  .prw-rail-row:hover { background: #faf8f3; }
  .prw-rail-row:last-child { border-bottom: 0; }
  .prw-rail-fam { font-size: 13.5px; font-weight: 700; color: var(--sb-text, #2a2a2a); }
  .prw-rail-meta { font-size: 11.5px; color: var(--sb-text-muted, #8a7f6c); }
  .prw-rail-muted { font-size: 12.5px; color: var(--sb-text-muted, #9a948a); padding: 8px 2px; }
  .prw-rail-order { margin-top: 10px; }
  .prw-rail-order-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; }
  .prw-rail-sec { font-size: 10.5px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.06em; color: #6b5d3a; margin: 14px 0 6px; border-bottom: 1px solid var(--sb-border-soft, #f0ece2); padding-bottom: 3px; }
  .prw-need { border: 1px solid var(--sb-border, #e4e0d4); border-radius: 9px; padding: 8px 10px; margin-bottom: 8px; }
  .prw-need-main { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
  .prw-need-kind { font-size: 9.5px; font-weight: 800; letter-spacing: 0.05em; color: #6b5d3a; background: #f4efe4; border-radius: 4px; padding: 1px 6px; }
  .prw-need-size { font-size: 13px; font-weight: 700; }
  .prw-need-spec { margin-top: 2px; font-family: var(--font-m, 'JetBrains Mono'), monospace; font-size: 11px; }
  .prw-need-add { margin-top: 6px; }
  .prw-file { display: block; font-size: 12.5px; color: #2563a8; padding: 3px 0; text-decoration: none; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .prw-file:hover { text-decoration: underline; }
  .prw-rail-hint { margin-top: 12px; font-size: 11.5px; color: var(--sb-text-muted, #9a948a); }

  @media (max-width: 900px) { .prw-body { flex-direction: column; } .prw-rail { max-width: none; border-left: none; border-top: 1px solid var(--sb-border, #e4e0d4); } }
`
