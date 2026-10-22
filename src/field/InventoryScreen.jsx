// =============================================================================
// InventoryScreen — the yard from the phone: ADD STONE (one card), the walk
// =============================================================================
// RESET-TAG-1 (2026-10-19). Paul re-founds the inventory zone by zone: every
// stone gets a painted running number (001, 002, …) on a sawn face, tape by
// status — BLUE free / GREEN sold (family name + order number) / RED problem —
// and a row here. Stonebooks Field is the main input surface.
//
// ONE "Add stone" card with one search box ("Search order (family) or type
// the stone") that branches:
//   • a FAMILY name → the open stone orders (listOpenOrdersLight + allocated
//     rows). An order shows its DIE and BASE as two rows with the dimensions
//     and color FROM THE ORDER PROFILE (the contract line — standard size or
//     custom W x D x T in trade format, the base config). Paul taps the piece
//     he is holding → VERIFY: "Die 2-0 x 0-8 x 2-4 Barre Grey. Matches?" with
//     Yes / Fix (size, color, the per-type spec chips). IMPORTANT (Paul): the
//     family names on crates are NOT reliable — the shop sometimes fulfils an
//     order with a different stone than the one that arrived for that family,
//     so the ORDER'S dimensions are the truth, not the crate name. A material
//     size change on Fix (different dim count, or any dim off by > 1 inch)
//     shows a soft warning: "This does not match the Jesse order. Save as
//     stock instead?" — Save as stock (no link) / Link anyway. Never blocks.
//     Yes/Link anyway → mint the next yard_tag, create the row (type die/base,
//     status allocated, allocated_order_id + assigned_to = family, verified),
//     flip the order's die_stone_status / base_stone_status the way
//     OrderDetail's quick-edit does → CONDITION step → STORAGE step (zone +
//     crate + spot + photo) → "Paint 041 · Green tape: JESSE E-26-0412 · Zone
//     B crate C-7 stack 3".
//   • DIMENSIONS or a TYPE word ("die", "2-0 x 0-8 x 2-4") → straight to the
//     free-stock form, pre-filled. "No order, it's stock" is always visible.
//   • no order found → the free-stock form.
// The free-stock form: type chips Die / Base / Slant / Hickey / Grass /
// Backer / Other, per-type spec chips that REUSE the catalog constants the
// wizard / OrderForm use (TOP_SHAPES, POLISH_LEVELS, BASE_FINISHES, POL/FROST
// top, the 2" polished margin — lib/yardStone.js), color datalist, size in
// trade format, specs, photo; Save mints, then the same CONDITION + STORAGE
// steps, "Paint 042 · Blue tape · Zone A crate C-1", and keeps type / color /
// zone / crate for the next stone.
// CONDITION on every save: Good (default, no tap) / Chip / Crack / Scratch /
// Wrong size / Other + a note + an optional damage photo. A condition other
// than Good is a pill on the row, NOT a problem; "Unusable, red tape" is the
// explicit flip to status problem (→ Reconcile). Notes editable later from
// the row (Add note).
// On any stone: Move (zone / crate / spot), Link to order / Unlink (says the
// tape change), Problem, Not here (the count's missing flow), Add note.
// COUNT THE YARD (2026-08-03) survives: FOUND / NOT HERE / Fix per stone.
// The DIE / BASE verdict chips come from lib/stonePosition — the exact logic
// the desktop Stone Position list uses. Archived (pre-reset) rows never show.
// =============================================================================
import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import {
  getInventoryStock, updateInventoryItem,
  verifyYardStock, restoreYardVerification, flagYardStockMissing, restoreYardStockStatus,
  getActiveStaffUser, properName, customerName,
  fmtYardTag, getNextYardTag, tagYardStone, markPieceHere,
  moveYardStone, flagYardStoneProblem, linkYardStoneToOrder, unlinkYardStone, uploadYardStonePhoto,
  setYardStoneCondition, getOrderSpecRow, INVENTORY_STATUS_LABEL, tagYardStonesBulk,
} from '../lib/stonebooksData'
import { loadStonePositionData, stoneVerdict, verdictChipText, isStoneOrder } from '../lib/stonePosition'
import { contractDieLabel, contractBaseLabel, tradeDimsFromLabel } from '../lib/jobComponents'
import { displayColorLabel, GRANITE_COLORS, orderHasBase, SHAPES } from '../lib/monumentCatalog'
import {
  yardTypeLabel, isBaseType, hasTopShape, isDieFamily, YARD_CATEGORIES, categoryToType, yardCategoryLabel,
  TOP_SHAPE_CHIPS, POLISH_CHIPS, BASE_FINISH_CHIPS, BASE_TOP_CHIPS, CONDITIONS, conditionLabel,
  yardStoneSpecLine, yardStoneWhere, specFromOrder, sizeMateriallyDifferent, looksLikeStone, stoneFromSearch, parseSizeInput, sizeTokens, tokenToInches, inchesToTrade,
} from '../lib/yardStone'

const DAY_MS = 86400000
// A verification older than 90 days counts as unconfirmed on the walk.
const FRESH_MS = 90 * DAY_MS

const familyOf = (o) => String(o?.primary_lastname || o?.customer?.last_name || o?.customer?.first_name || '').trim().toUpperCase()
const orderLabel = (o) => [familyOf(o) || '—', o?.order_number].filter(Boolean).join(' ')
const stoneTitle = (it) => [yardCategoryLabel(it) || yardTypeLabel(it.item_type) || 'Stone', it.color].filter(Boolean).join(' · ')
const me = () => getActiveStaffUser() || null

// The tape a stone should wear, from its row.
function tapeFor(it, orderById) {
  if (it.status === 'problem') return { cls: 'fl-yd-tape-red', text: 'RED TAPE' }
  if (it.status === 'missing') return { cls: 'fl-c-bad', text: 'MISSING' }
  if (it.status === 'allocated') {
    const o = it.allocated_order_id ? orderById.get(it.allocated_order_id) : null
    const who = o ? orderLabel(o) : (it.assigned_to ? String(it.assigned_to).toUpperCase() : '')
    return { cls: 'fl-yd-tape-green', text: `GREEN TAPE${who ? `: ${who}` : ''}` }
  }
  return { cls: 'fl-yd-tape-blue', text: 'BLUE TAPE' }
}

const activeColorNames = () => {
  const seen = new Set(); const out = []
  for (const c of GRANITE_COLORS) {
    if (c.isActive === false) continue
    const label = displayColorLabel(c.label) || c.label
    if (!label || seen.has(label)) continue
    seen.add(label); out.push(label)
  }
  return out
}

// The order's two pieces as the contract reads them (pre-fill for VERIFY).
function piecesFromSpec(spec) {
  if (!spec) return null
  const dieLabel = contractDieLabel(spec)
  const die = specFromOrder(spec, 'die', tradeDimsFromLabel(dieLabel))
  const hasBase = orderHasBase(spec.base_config, SHAPES.find(sh => sh.code === spec.shape)) || !!spec.pricing?.lineItemLabels?.['base-block']
  const baseLabel = hasBase ? contractBaseLabel(spec) : null
  const base = hasBase ? specFromOrder(spec, 'base', tradeDimsFromLabel(baseLabel)) : null
  return { die, base, dieLabel, baseLabel }
}

export default function InventoryScreen({ undo }) {
  const [data, setData] = useState(null)      // loadStonePositionData result
  const [err, setErr] = useState(null)
  const [q, setQ] = useState('')
  const [stockOpen, setStockOpen] = useState(false)   // "No order, it's stock"
  const [stockPrefill, setStockPrefill] = useState(null)
  const [bulkOpen, setBulkOpen] = useState(false)     // "Add bulk to stock" (BULK-STOCK 2026-10-22)
  const [bulkDone, setBulkDone] = useState(null)      // { tags, rows, tape, where, whereLine, label }
  const [counting, setCounting] = useState(false)
  const [countBusy, setCountBusy] = useState(null)
  const [nowMs, setNowMs] = useState(0)
  const [receiving, setReceiving] = useState(null)
  const [specById, setSpecById] = useState({})     // orderId → spec row (null = loading)
  const [verify, setVerify] = useState(null)       // { order, piece, spec, pieces }
  const [afterMint, setAfterMint] = useState(null) // { row, tag, tape }
  const [action, setAction] = useState(null)       // { kind, stone }
  const [confirmLine, setConfirmLine] = useState(null)
  const [lastWhere, setLastWhere] = useState({ zone: '', crate: '', spot: '' })

  const loadAll = useCallback(() => {
    loadStonePositionData()
      .then(d => { setData(d); setErr(null) })
      .catch(e => setErr(e?.message || 'Could not load the yard.'))
  }, [])
  useEffect(() => { loadAll() }, [loadAll])

  // After a yard write only the stock needs re-reading; the verdicts follow.
  const refreshStock = useCallback(async () => {
    const r = await getInventoryStock()
    const rows = Array.isArray(r) ? r : (r?.rows || [])
    setData(d => (d ? { ...d, stock: rows } : d))
  }, [])

  const items = data?.stock || null
  const orderById = useMemo(() => new Map((data?.orders || []).map(o => [o.id, o])), [data])
  const stoneOrders = useMemo(() => (data?.orders || []).filter(isStoneOrder), [data])
  const zones = useMemo(() => {
    const s = new Set()
    for (const it of (items || [])) if (it.zone && String(it.zone).trim()) s.add(String(it.zone).trim())
    return [...s].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
  }, [items])
  const takenTags = useMemo(() => new Set((items || []).map(it => it.yard_tag).filter(n => n != null)), [items])

  const isFresh = useCallback((it) => {
    if (!it.verified_at || !nowMs) return false
    const t = Date.parse(it.verified_at)
    return Number.isFinite(t) && nowMs - t < FRESH_MS
  }, [nowMs])

  const needle = q.trim().toLowerCase()
  // A short all-digit search is a PAINTED NUMBER: "41" finds 041 and nothing
  // else. Dims / a type word read as a STONE → the free-stock form.
  const needleNum = /^\d{1,4}$/.test(needle) ? Number(needle) : null
  const tagOnly = needleNum != null && needle.length < 4
  const stoneTyped = !tagOnly && looksLikeStone(needle)

  const stoneHits = useMemo(() => {
    if (!items) return []
    let l = items
    if (needle) {
      l = l.filter(it => {
        if (needleNum != null && Number(it.yard_tag) === needleNum) return true
        if (tagOnly) return false
        const o = it.allocated_order_id ? orderById.get(it.allocated_order_id) : null
        return [fmtYardTag(it.yard_tag), it.item_type, yardTypeLabel(it.item_type), it.color, it.size, it.specs, it.zone, it.crate, it.spot,
          it.location, it.notes, it.status, it.assigned_to, it.condition_note, o?.order_number, o && familyOf(o)]
          .filter(Boolean).join(' ').toLowerCase().includes(needle)
      })
    }
    if (counting) {
      l = [...l].sort((a, b) =>
        ((isFresh(a) ? 1 : 0) - (isFresh(b) ? 1 : 0))
        || String(a.zone || a.location || '~').localeCompare(String(b.zone || b.location || '~'), undefined, { numeric: true })
        || (Number(a.yard_tag) || 0) - (Number(b.yard_tag) || 0))
    } else {
      // Last painted on top; the untagged old-style rows after.
      l = [...l].sort((a, b) => {
        const ta = a.yard_tag == null ? -1 : Number(a.yard_tag)
        const tb = b.yard_tag == null ? -1 : Number(b.yard_tag)
        return tb - ta
      })
    }
    return l
  }, [items, needle, needleNum, tagOnly, counting, isFresh, orderById])

  const orderHits = useMemo(() => {
    if (!needle || !data || tagOnly || stoneTyped) return []
    const l = stoneOrders.filter(o => [familyOf(o), customerName(o.customer), o.order_number, o.cemetery?.name]
      .filter(Boolean).join(' ').toLowerCase().includes(needle))
    l.sort((a, b) => familyOf(a).localeCompare(familyOf(b)))
    return l.slice(0, 12).map(o => ({ order: o, die: stoneVerdict(o, 'die', data), base: stoneVerdict(o, 'base', data) }))
  }, [needle, data, stoneOrders, tagOnly, stoneTyped])

  // The order profile (spec columns) for each visible hit — fetched once each
  // (in-flight ids tracked in a ref so the effect never sets state itself).
  const specInFlight = useRef(new Set())
  useEffect(() => {
    for (const h of orderHits) {
      const id = h.order.id
      if (id in specById || specInFlight.current.has(id)) continue
      specInFlight.current.add(id)
      getOrderSpecRow(id)
        .then(spec => setSpecById(m => ({ ...m, [id]: spec || false })))
        .catch(() => setSpecById(m => ({ ...m, [id]: false })))
        .finally(() => specInFlight.current.delete(id))
    }
  }, [orderHits, specById])

  // When does the free-stock form show?
  const showStock = !counting && !bulkOpen && (stockOpen || stoneTyped || (!!needle && !tagOnly && orderHits.length === 0 && data))
  const showBulk = !counting && bulkOpen && !needle
  const stockSeed = useMemo(() => {
    if (stockPrefill) return stockPrefill
    if (stoneTyped) { const s = stoneFromSearch(q); return { item_type: s.item_type || 'die', size: s.size ? parseSizeInput(s.size).trade : '' } }
    return null
  }, [stockPrefill, stoneTyped, q])

  // ── the walk (unchanged semantics) ──────────────────────────────────────
  const markFound = async (it) => {
    if (countBusy) return
    setCountBusy(it.id)
    const prev = { verified_at: it.verified_at || null, verified_by: it.verified_by || null }
    const r = await verifyYardStock(it.id, { by: me() })
    setCountBusy(null)
    if (!r.ok) { undo.showError(r.error || 'Could not confirm.'); return }
    refreshStock()
    undo.show(`${fmtYardTag(it.yard_tag) || stoneTitle(it)} confirmed`, async () => {
      await restoreYardVerification(it.id, prev).catch(() => {})
      refreshStock()
    })
  }
  const markMissing = async (it) => {
    if (countBusy) return
    setCountBusy(it.id)
    const prevStatus = it.status
    const r = await flagYardStockMissing(it.id, { by: me() })
    setCountBusy(null)
    if (!r.ok) { undo.showError(r.error || 'Could not flag it.'); return }
    refreshStock()
    undo.show(`${fmtYardTag(it.yard_tag) || stoneTitle(it)} flagged missing`, async () => {
      await restoreYardStockStatus(it.id, prevStatus).catch(() => {})
      refreshStock()
    })
  }

  // ── the order path: tap a piece → VERIFY ─────────────────────────────────
  const openVerify = (o, piece) => {
    const spec = specById[o.id]
    const pieces = piecesFromSpec(spec || null)
    setVerify({ order: o, piece, spec, pieces })
  }
  // VERIFY said yes / link anyway → mint + link + flip, then condition + storage.
  const linkPiece = async (o, piece, fields) => {
    const r = await markPieceHere({ orderId: o.id, orderNumber: o.order_number || null, family: familyOf(o) || null, piece, spec: fields, by: me() })
    if (!r.ok) { undo.showError(r.error || 'Could not record the stone.'); return false }
    if (!r.statusOk) undo.showError(`Stone ${fmtYardTag(r.tag)} saved, but the order status did not flip: ${r.statusError}`)
    await refreshStock()
    setVerify(null)
    setAfterMint({ row: r.row, tag: r.tag, tape: `Green tape: ${orderLabel(o)}` })
    return true
  }
  // VERIFY said "save as stock" → the free-stock form, pre-filled, no link.
  const toStock = (fields) => {
    setVerify(null)
    setStockPrefill({ ...fields })
    setStockOpen(true)
    setQ('')
  }

  if (err) return <div className="fl-empty">{err}</div>
  if (items === null) return <div className="fl-empty">Loading the yard…</div>

  const countable = items.filter(it => it.status !== 'missing')
  const confirmed = countable.filter(isFresh).length

  return (
    <div className="fl-yd">
      <style>{YD_CSS}</style>

      {confirmLine && (
        <div className="fl-yd-confirm">
          <div className="fl-yd-confirm-text">{confirmLine}</div>
          <button type="button" className="fl-yd-confirm-ok" onClick={() => setConfirmLine(null)}>OK</button>
        </div>
      )}

      {/* ADD STONE — one card, one search, branches below. */}
      {!counting && (
        <div className="fl-card fl-yd-add">
          <div className="fl-eyebrow">Add stone</div>
          <input className="fl-search" style={{ marginBottom: 8 }} type="search" inputMode="search"
            placeholder="Search order (family) or type the stone"
            value={q} onChange={e => { setQ(e.target.value); if (stockPrefill) setStockPrefill(null); if (stockOpen && e.target.value.trim()) setStockOpen(false); if (bulkOpen && e.target.value.trim()) setBulkOpen(false) }} />
          <div className="fl-yd-addrow">
            <button type="button" className={`fl-chip-btn${showStock ? ' on' : ''}`}
              onClick={() => { setStockOpen(v => !v); if (!stockOpen) { setQ(''); setStockPrefill(null); setBulkOpen(false) } }}>
              ADD TO STOCK
            </button>
            <span className="fl-yd-hint">{needle ? (stoneTyped ? 'Reads as a stone — the form is below.' : orderHits.length ? 'Tap the piece you are holding.' : 'No open order with that name — tag it as stock, or check the spelling.') : 'A family name finds the order. Dimensions or a type go straight to stock.'}</span>
          </div>
          {/* BULK-STOCK (Paul 2026-10-22): the same stone × many, one run of numbers. */}
          {!needle && (
            <div className="fl-yd-addrow2">
              <button type="button" className={`fl-chip-btn${showBulk ? ' on' : ''}`}
                onClick={() => { setBulkOpen(v => !v); if (!bulkOpen) { setStockOpen(false); setStockPrefill(null) } }}>
                Add bulk to stock
              </button>
            </div>
          )}
        </div>
      )}

      {/* ORDER RESULTS — family search → die / base rows from the order profile */}
      {orderHits.map(({ order: o, die, base }) => {
        const spec = specById[o.id]
        const pieces = spec ? piecesFromSpec(spec) : null
        return (
          <div key={o.id} className="fl-row" style={{ cursor: 'default' }}>
            <div className="fl-fam fl-yd-ellip">{properName(familyOf(o) || customerName(o.customer) || '—')}</div>
            <div className="fl-spec fl-yd-ellip">{[o.order_number || 'DRAFT', o.cemetery?.name].filter(Boolean).join(' · ')}</div>
            {spec === null && <div className="fl-spec" style={{ fontFamily: 'inherit', marginTop: 6 }}>Reading the order profile…</div>}
            <PieceRow label="Die" v={die} fields={pieces?.die} line={pieces?.dieLabel} onPick={die.code !== 'yard' ? () => openVerify(o, 'die') : null} />
            {(pieces ? pieces.base : spec === false) && (
              <PieceRow label="Base" v={base} fields={pieces?.base} line={pieces?.baseLabel} onPick={base.code !== 'yard' ? () => openVerify(o, 'base') : null} />
            )}
            {spec === false && !pieces && <div className="fl-yd-note">Could not read the order profile — the pieces can still be verified by hand.</div>}
          </div>
        )
      })}

      {/* FREE STOCK — the form (also the landing for "save as stock") */}
      {showStock && (
        <TagStoneForm key={stockSeed ? JSON.stringify(stockSeed) : 'blank'} undo={undo} takenTags={takenTags} seed={stockSeed}
          onClose={() => { setStockOpen(false); setStockPrefill(null); if (stoneTyped) setQ('') }}
          onMinted={async (row) => { await refreshStock(); setAfterMint({ row, tag: row.yard_tag, tape: 'Blue tape' }) }} />
      )}

      {/* BULK STOCK — the same stone × many */}
      {showBulk && (
        <BulkStockForm undo={undo} takenTags={takenTags} zones={zones} lastWhere={lastWhere}
          onClose={() => setBulkOpen(false)}
          onDone={async (res) => { await refreshStock(); setLastWhere(w => ({ ...w, zone: res.where.zone, crate: res.where.crate })); setBulkOpen(false); setBulkDone(res) }} />
      )}

      {/* COUNT THE YARD */}
      {!needle && !showStock && !showBulk && (
        <button type="button" className={counting ? 'fl-btn fl-btn-green' : 'fl-btn fl-btn-ghost'}
          onClick={() => { setCounting(v => !v); setNowMs(Date.now()) }}>
          {counting ? `Counting — ${confirmed}/${countable.length} confirmed · tap to stop` : 'Count the yard'}
        </button>
      )}
      {counting && (
        <div className="fl-spec" style={{ margin: '-4px 2px 10px', fontFamily: 'inherit' }}>
          Walk the zones. FOUND stamps your name on the stone; NOT HERE sends it to Reconcile. Unconfirmed stones list first.
        </div>
      )}

      {/* STONES */}
      {(needle || orderHits.length > 0) && stoneHits.length > 0 && <div className="fl-daylabel">Stones</div>}
      {!needle && !showStock && !counting && <div className="fl-daylabel"><b>{items.length}</b> stones in the yard</div>}
      {items.length === 0 && !showStock && <div className="fl-empty">The yard list is empty — tag the first stone.</div>}
      {stoneHits.map(it => {
        const fresh = isFresh(it)
        const tape = tapeFor(it, orderById)
        const cond = it.condition && it.condition !== 'good'
        return (
          <div key={it.id} className="fl-row" style={{ cursor: 'default', ...(counting && fresh ? { opacity: 0.62 } : null) }}>
            <div className="fl-row-flex">
              <div className={`fl-yd-tag${it.yard_tag == null ? ' fl-yd-tag-none' : ''}`}>{fmtYardTag(it.yard_tag) || '—'}</div>
              <div className="fl-row-main">
                <div className="fl-fam fl-yd-ellip" style={{ fontSize: 15 }}>{yardTypeLabel(it.item_type) || 'Stone'}</div>
                <div className="fl-spec fl-yd-wrap">{yardStoneSpecLine(it) || 'no spec'}</div>
                <div className="fl-spec fl-yd-wrap" style={{ fontFamily: 'inherit' }}>{yardStoneWhere(it) || 'no zone'}</div>
                {it.assigned_to && (
                  <div className="fl-spec fl-yd-ellip" style={{ fontFamily: 'inherit', fontWeight: 700 }}>for {properName(it.assigned_to)}</div>
                )}
                {cond && it.condition_note && <div className="fl-spec fl-yd-wrap" style={{ fontFamily: 'inherit', color: '#8A5A12' }}>{it.condition_note}</div>}
              </div>
              {Number(it.quantity) > 1 && <div className="fl-inv-qty"><small>QTY</small>{Number(it.quantity)}</div>}
            </div>
            <div className="fl-chips">
              <span className={`fl-chip ${tape.cls} fl-yd-chipwrap`}>{tape.text}</span>
              {cond && <span className="fl-chip fl-c-warn fl-yd-chipwrap">{conditionLabel(it.condition).toUpperCase()}</span>}
              {it.status !== 'available' && it.status !== 'allocated' && it.status !== 'problem' && it.status !== 'missing' && (
                <span className="fl-chip fl-c-neutral">{(INVENTORY_STATUS_LABEL[it.status] || it.status || '').toUpperCase()}</span>
              )}
              {it.verified_at && (
                <span className={`fl-chip ${fresh ? 'fl-c-good' : 'fl-c-neutral'}`}>
                  SEEN {String(it.verified_at).slice(5, 10).replace('-', '/')}{it.verified_by ? ` · ${String(it.verified_by).toUpperCase()}` : ''}
                </span>
              )}
            </div>
            <div className="fl-yd-verbs">
              {counting && it.status !== 'missing' ? (
                <>
                  <button type="button" className="fl-verb" style={{ borderColor: '#1d7a55', color: '#1d7a55' }}
                    disabled={countBusy === it.id} onClick={() => markFound(it)}>
                    {countBusy === it.id ? '…' : 'FOUND'}
                  </button>
                  <button type="button" className="fl-verb" style={{ borderColor: '#B3261E', color: '#B3261E' }}
                    disabled={countBusy === it.id} onClick={() => markMissing(it)}>
                    NOT HERE
                  </button>
                  <button type="button" className="fl-event-undo" onClick={() => setReceiving(it)}>Fix</button>
                </>
              ) : (
                <>
                  <button type="button" className="fl-event-undo" onClick={() => setAction({ kind: 'move', stone: it })}>Move</button>
                  {it.status === 'allocated'
                    ? <button type="button" className="fl-event-undo" onClick={() => setAction({ kind: 'unlink', stone: it })}>Unlink</button>
                    : <button type="button" className="fl-event-undo" onClick={() => setAction({ kind: 'link', stone: it })}>Link to order</button>}
                  <button type="button" className="fl-event-undo" onClick={() => setAction({ kind: 'note', stone: it })}>{cond || it.condition_note ? 'Condition' : 'Add note'}</button>
                  {it.status !== 'problem' && <button type="button" className="fl-event-undo" style={{ color: '#B3261E' }} onClick={() => setAction({ kind: 'problem', stone: it })}>Problem</button>}
                  {it.status !== 'missing' && <button type="button" className="fl-event-undo" disabled={countBusy === it.id} onClick={() => markMissing(it)}>Not here</button>}
                </>
              )}
            </div>
            {receiving?.id === it.id && (
              <ReceiveForm item={it} undo={undo}
                onDone={() => { setReceiving(null); refreshStock() }}
                onCancel={() => setReceiving(null)} />
            )}
          </div>
        )
      })}

      {verify && (
        <VerifySheet v={verify} onClose={() => setVerify(null)}
          onLink={(fields) => linkPiece(verify.order, verify.piece, fields)}
          onStock={(fields) => toStock(fields)} />
      )}
      {afterMint && (
        <AfterMintSheet mint={afterMint} zones={zones} undo={undo} lastWhere={lastWhere}
          onDone={async (line, where) => { setAfterMint(null); if (where) setLastWhere(where); await refreshStock(); setConfirmLine(line) }} />
      )}
      {bulkDone && <BulkDoneSheet res={bulkDone} onDone={() => setBulkDone(null)} />}
      {action && (
        <StoneActionSheet action={action} zones={zones} orders={stoneOrders} undo={undo}
          onClose={() => setAction(null)}
          onDone={async (line) => { setAction(null); await refreshStock(); if (line) setConfirmLine(line) }} />
      )}
    </div>
  )
}

// One piece of an order: the contract's line + the verdict chip + the tap.
function PieceRow({ label, v, fields, line, onPick }) {
  const preview = fields ? yardStoneSpecLine({ ...fields, item_type: fields.item_type }) : (line || '')
  const inner = (
    <>
      <div className="fl-yd-piece-main">
        <div className="fl-yd-piece-label">{label}</div>
        <div className="fl-spec fl-yd-wrap">{preview || 'no size on the contract'}</div>
        <VerdictChip label={label.toUpperCase()} v={v} />
      </div>
      {onPick && <span className="fl-yd-piece-go">This is it</span>}
    </>
  )
  return onPick
    ? <button type="button" className="fl-yd-piece fl-yd-piece-btn" onClick={onPick}>{inner}</button>
    : <div className="fl-yd-piece">{inner}</div>
}

function VerdictChip({ label, v }) {
  const cls = v.code === 'yard' ? 'fl-c-good' : v.code === 'received' ? 'fl-c-good' : v.code === 'ordered' ? 'fl-c-info' : 'fl-c-lead'
  return <span className={`fl-chip ${cls} fl-yd-chipwrap`} style={{ marginTop: 6, display: 'inline-block' }}>{label}: {verdictChipText(v)}{v.sub ? ` · ${v.sub}` : ''}</span>
}

// Chip row helper.
function Chips({ options, value, onChange, allowNone = true }) {
  return (
    <div className="fl-yd-chiprow">
      {options.map(c => (
        <button key={c.code} type="button" className={`fl-chip-btn${value === c.code ? ' on' : ''}`}
          onClick={() => onChange(value === c.code && allowNone ? null : c.code)}>{c.label}</button>
      ))}
    </div>
  )
}

// The per-type spec chips — the catalog's own words (lib/yardStone.js).
function SpecChips({ type, fields, onChange }) {
  const set = (k) => (v) => onChange({ ...fields, [k]: v })
  if (isBaseType(type)) {
    return (
      <>
        <div className="fl-lab">Finish</div>
        <Chips options={BASE_FINISH_CHIPS} value={fields.finish || null} onChange={set('finish')} />
        <div className="fl-lab">Top</div>
        <div className="fl-yd-chiprow">
          {BASE_TOP_CHIPS.map(c => (
            <button key={c.code} type="button" className={`fl-chip-btn${fields.top_finish === c.code ? ' on' : ''}`}
              onClick={() => onChange({ ...fields, top_finish: fields.top_finish === c.code ? null : c.code })}>{c.label}</button>
          ))}
          <button type="button" className={`fl-chip-btn${fields.polish_margin ? ' on' : ''}`}
            onClick={() => onChange({ ...fields, polish_margin: !fields.polish_margin })}>2&quot; polished margin</button>
        </div>
      </>
    )
  }
  if (isDieFamily(type)) {
    return (
      <>
        {hasTopShape(type) && (<>
          <div className="fl-lab">Top shape</div>
          <Chips options={TOP_SHAPE_CHIPS} value={fields.top || null} onChange={set('top')} />
        </>)}
        <div className="fl-lab">Polish</div>
        <Chips options={POLISH_CHIPS} value={fields.polish_level || null} onChange={set('polish_level')} />
      </>
    )
  }
  return null
}

// Size + color + the per-type chips + specs — shared by VERIFY (Fix) and the
// free-stock form.
function SpecFields({ type, fields, onChange, colors }) {
  const set = (k) => (e) => onChange({ ...fields, [k]: e.target.value })
  return (
    <>
      <div className="fl-lab">Size</div>
      <SizeBoxes value={fields.size || ''} onChange={(size) => onChange({ ...fields, size })} />
      {/* Paul's order on the walk: size → shape · polish (base: finish · top) → color */}
      <SpecChips type={type} fields={fields} onChange={onChange} />
      <div className="fl-lab">Color</div>
      <input className="fl-input" list="fl-yd-colors" placeholder="e.g. Barre Gray" value={fields.color || ''} onChange={set('color')} />
      <datalist id="fl-yd-colors">{colors.map(c => <option key={c} value={c} />)}</datalist>
      <div className="fl-lab">Specs</div>
      <input className="fl-input" placeholder="Anything else about the cut" value={fields.specs || ''} onChange={set('specs')} />
    </>
  )
}

// THREE boxes, L W H (Paul 2026-10-22: "i want 3 boxes for l w h"). Each box
// takes inches ("12") or feet-inches ("1-0"); leaving a box settles it to the
// trade form, and the yard stores the composed "1-0 x 0-8 x 2-0". The readout
// under the boxes shows both readings so a typo shows before Save.
const SIZE_SLOTS = ['L', 'W', 'H']
const tradeOf = (t) => { const n = tokenToInches(String(t || '').trim()); return n == null ? String(t || '').trim() : inchesToTrade(n) }
const composeSize = (parts) => parts.map(tradeOf).filter(Boolean).join(' x ')
function SizeBoxes({ value, onChange }) {
  const [parts, setParts] = useState(() => { const t = sizeTokens(value); return [t[0] || '', t[1] || '', t[2] || ''] })
  // A prefill from outside (the search box, Fix on an order) lands in the boxes
  // — the "adjust state when a prop changes" pattern, no effect needed.
  const [seen, setSeen] = useState(value)
  if (value !== seen) {
    setSeen(value)
    if (composeSize(parts) !== String(value || '').trim()) { const t = sizeTokens(value); setParts([t[0] || '', t[1] || '', t[2] || '']) }
  }
  const update = (i, text) => { const next = parts.slice(); next[i] = text; setParts(next); onChange(composeSize(next)) }
  const settle = (i) => { const t = tradeOf(parts[i]); if (t !== parts[i]) { const next = parts.slice(); next[i] = t; setParts(next) } }
  const filled = parts.filter(p => p.trim()).length
  const p = parseSizeInput(composeSize(parts))
  return (
    <>
      <div className="fl-yd-sizerow">
        {SIZE_SLOTS.map((lab, i) => (
          <div key={lab} className="fl-yd-sizecell">
            <div className="fl-yd-sizelab">{lab}</div>
            <input className="fl-input fl-yd-sizebox" placeholder={i === 0 ? '12 or 1-0' : i === 1 ? '8 or 0-8' : '24 or 2-0'} value={parts[i]}
              onChange={(e) => update(i, e.target.value)} onBlur={() => settle(i)} />
          </div>
        ))}
      </div>
      {filled === 0 ? <div className="fl-yd-sizeread fl-yd-sizeread-muted">Inches (12) or feet-inches (1-0) in each box. Either way.</div>
        : filled < 3 ? <div className="fl-yd-sizeread fl-yd-sizeread-muted">Fill all three: L, W, H.</div>
        : !p.ok ? <div className="fl-yd-sizeread fl-yd-sizeread-muted">A box did not read. Numbers only, like 12 or 1-0.</div>
        : <div className="fl-yd-sizeread">= {p.trade} <span className="fl-yd-sizeread-in">({p.inches} in)</span></div>}
    </>
  )
}

// Zone chips + "new zone" box, shared by every sheet.
function ZonePicker({ zones, value, onChange }) {
  const [fresh, setFresh] = useState(false)
  const known = zones.includes(value)
  return (
    <>
      <div className="fl-yd-chiprow">
        {zones.map(z => (
          <button key={z} type="button" className={`fl-chip-btn${value === z ? ' on' : ''}`}
            onClick={() => { setFresh(false); onChange(value === z ? '' : z) }}>{z}</button>
        ))}
        <button type="button" className={`fl-chip-btn${fresh || (value && !known) ? ' on' : ''}`}
          onClick={() => { setFresh(true); if (known) onChange('') }}>New zone</button>
      </div>
      {(fresh || (value && !known)) && (
        <input className="fl-input" placeholder="Zone name, e.g. B" value={value} onChange={e => onChange(e.target.value)} style={{ marginTop: 8 }} />
      )}
    </>
  )
}

function PhotoPick({ file, onFile, label = 'Take a photo' }) {
  const ref = useRef(null)
  const url = useMemo(() => (file ? URL.createObjectURL(file) : null), [file])
  useEffect(() => () => { if (url) URL.revokeObjectURL(url) }, [url])
  return (
    <div className="fl-yd-photo">
      <input ref={ref} type="file" accept="image/*" capture="environment" style={{ display: 'none' }}
        onChange={e => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = '' }} />
      {url && <img className="fl-yd-thumb" src={url} alt="stone" />}
      <button type="button" className="fl-btn fl-btn-ghost" style={{ marginBottom: 0, flex: 1 }} onClick={() => ref.current?.click()}>
        {file ? 'Retake' : label}
      </button>
      {file && <button type="button" className="fl-event-undo" onClick={() => onFile(null)}>Remove</button>}
    </div>
  )
}

// CONDITION — on every save and from "Add note". Good is the default and
// costs no tap. "Unusable, red tape" is the explicit problem flip.
function ConditionStep({ value, onChange, showUnusable = true }) {
  return (
    <>
      <div className="fl-lab">Condition</div>
      <Chips options={CONDITIONS} value={value.condition || 'good'} onChange={(c) => onChange({ ...value, condition: c || 'good' })} allowNone={false} />
      <input className="fl-input" style={{ marginTop: 8 }} placeholder="Note, e.g. small chip back lower left"
        value={value.note || ''} onChange={e => onChange({ ...value, note: e.target.value })} />
      {(value.condition && value.condition !== 'good') && (
        <div style={{ marginTop: 8 }}><PhotoPick file={value.damage || null} onFile={(f) => onChange({ ...value, damage: f })} label="Photo of the damage" /></div>
      )}
      {showUnusable && (
        <button type="button" className={`fl-chip-btn${value.unusable ? ' on' : ''}`} style={{ marginTop: 10, ...(value.unusable ? { background: '#B3261E', borderColor: '#B3261E' } : { color: '#B3261E', borderColor: '#B3261E' }) }}
          onClick={() => onChange({ ...value, unusable: !value.unusable })}>
          {value.unusable ? 'Unusable — RED TAPE (tap to undo)' : 'Unusable, red tape'}
        </button>
      )}
    </>
  )
}

// VERIFY — the order's piece as the contract reads it. "Matches?" Yes / Fix.
// A material size change on Fix → the soft warning (Save as stock / Link anyway).
function VerifySheet({ v, onClose, onLink, onStock }) {
  const { order, piece, pieces } = v
  const contract = pieces ? (piece === 'base' ? pieces.base : pieces.die) : null
  const [fields, setFields] = useState(() => ({ ...(contract || { item_type: piece === 'base' ? 'base' : 'die' }) }))
  const [fixing, setFixing] = useState(!contract?.size)
  const [warn, setWarn] = useState(false)
  const [busy, setBusy] = useState(false)
  const colors = useMemo(() => activeColorNames(), [])
  const family = properName(familyOf(order) || '—')
  const line = yardStoneSpecLine({ ...fields, item_type: piece === 'base' ? 'base' : 'die' })

  const go = async (force) => {
    if (busy) return
    if (!force && contract?.size && sizeMateriallyDifferent(contract.size, fields.size)) { setWarn(true); return }
    setBusy(true)
    const ok = await onLink(fields)
    if (!ok) setBusy(false)
  }

  return (
    <>
      <div className="fl-sheet-scrim" onClick={onClose} />
      <div className="fl-sheet">
        <div className="fl-sheet-grab" />
        <div className="fl-sheet-title fl-yd-ellip">{family} · {order.order_number || 'DRAFT'}</div>
        <div className="fl-yd-paint" style={{ fontSize: 22 }}>{piece === 'base' ? 'Base' : 'Die'} {line || '— no size on the contract'}</div>
        {!fixing ? (
          <>
            <div className="fl-yd-ask">Matches the stone in front of you?</div>
            <div className="fl-yd-btnrow">
              <button type="button" className="fl-yd-here" disabled={busy} onClick={() => go(false)}>{busy ? 'Saving…' : 'Yes, matches'}</button>
              <button type="button" className="fl-btn fl-btn-ghost" style={{ marginBottom: 0, flex: 1 }} disabled={busy} onClick={() => setFixing(true)}>Fix</button>
            </div>
            <div className="fl-spec fl-yd-wrap" style={{ fontFamily: 'inherit', marginTop: 10 }}>
              The order profile is the truth — crate names are not always right. Yes mints the number, links the stone to this order and marks the {piece} In stock.
            </div>
          </>
        ) : (
          <>
            <SpecFields type={piece === 'base' ? 'base' : 'die'} fields={fields} onChange={(f) => { setFields(f); setWarn(false) }} colors={colors} />
            {warn && (
              <div className="fl-yd-warnbox">
                <div className="fl-yd-warn" style={{ margin: 0 }}>This does not match the {family} order{contract?.size ? ` (${contract.size})` : ''}. Save as stock instead?</div>
                <div className="fl-yd-btnrow" style={{ marginTop: 8 }}>
                  <button type="button" className="fl-btn" style={{ marginBottom: 0, flex: 1 }} disabled={busy} onClick={() => onStock(fields)}>Save as stock</button>
                  <button type="button" className="fl-btn fl-btn-ghost" style={{ marginBottom: 0, flex: 1 }} disabled={busy} onClick={() => go(true)}>{busy ? 'Saving…' : 'Link anyway'}</button>
                </div>
              </div>
            )}
            {!warn && (
              <button type="button" className="fl-btn fl-btn-green" style={{ marginTop: 14 }} disabled={busy} onClick={() => go(false)}>
                {busy ? 'Saving…' : `Save and link to ${family}`}
              </button>
            )}
          </>
        )}
        <button type="button" className="fl-btn fl-btn-ghost" style={{ marginBottom: 0, marginTop: 10 }} disabled={busy} onClick={onClose}>Cancel</button>
      </div>
    </>
  )
}

// After the mint (both paths): CONDITION → STORAGE → the label line.
function AfterMintSheet({ mint, zones, undo, lastWhere, onDone }) {
  const [step, setStep] = useState('condition')
  const [cond, setCond] = useState({ condition: 'good', note: '', damage: null, unusable: false })
  const [zone, setZone] = useState(mint.row?.zone || lastWhere.zone || '')
  const [crate, setCrate] = useState(mint.row?.crate || lastWhere.crate || '')
  const [spot, setSpot] = useState('')
  const [photo, setPhoto] = useState(null)
  const [busy, setBusy] = useState(false)
  const paint = `Paint ${fmtYardTag(mint.tag)}`
  const tape = cond.unusable ? 'Red tape' : mint.tape

  const finish = async () => {
    if (busy) return
    setBusy(true)
    const c = await setYardStoneCondition(mint.row.id, { condition: cond.condition, note: cond.note, unusable: cond.unusable, by: me() })
    if (!c.ok) { setBusy(false); undo.showError(c.error || 'Could not save the condition.'); return }
    if (cond.damage) { const d = await uploadYardStonePhoto(mint.row.id, cond.damage, { kind: 'damage' }); if (!d.ok) undo.showError(`Saved, but the damage photo did not upload: ${d.error}`) }
    const m = await moveYardStone(mint.row.id, { zone: zone.trim() || null, crate: crate.trim() || null, spot: spot.trim() || null })
    if (!m.ok) { setBusy(false); undo.showError(m.error || 'Could not save where it sits.'); return }
    if (photo) { const p = await uploadYardStonePhoto(mint.row.id, photo); if (!p.ok) undo.showError(`Saved, but the photo did not upload: ${p.error}`) }
    setBusy(false)
    const where = [zone.trim() && `Zone ${zone.trim()}`, crate.trim() && `crate ${crate.trim()}`, spot.trim() || null].filter(Boolean).join(' ')
    onDone([paint, tape, where || null].filter(Boolean).join(' · '), { zone: zone.trim(), crate: crate.trim(), spot: '' })
  }

  return (
    <>
      <div className="fl-sheet-scrim" />
      <div className="fl-sheet">
        <div className="fl-sheet-grab" />
        <div className="fl-yd-paint">{paint}</div>
        <div className={`fl-yd-tapeline${cond.unusable ? ' fl-yd-tapeline-red' : ''}`}>{tape}</div>
        <div className="fl-spec fl-yd-wrap" style={{ fontFamily: 'inherit', marginBottom: 4 }}>{yardStoneSpecLine(mint.row)}</div>
        {step === 'condition' ? (
          <>
            <ConditionStep value={cond} onChange={setCond} />
            <button type="button" className="fl-btn" style={{ marginTop: 16, marginBottom: 0 }} onClick={() => setStep('storage')}>
              {cond.condition === 'good' && !cond.unusable ? 'Good — where does it sit?' : 'Next — where does it sit?'}
            </button>
          </>
        ) : (
          <>
            <div className="fl-label">Zone</div>
            <ZonePicker zones={zones} value={zone} onChange={setZone} />
            <div className="fl-label">Crate</div>
            <input className="fl-input" placeholder="e.g. C-7" value={crate} onChange={e => setCrate(e.target.value)} />
            <div className="fl-label">Spot</div>
            <input className="fl-input" placeholder="stack 3, row 2, by the gate" value={spot} onChange={e => setSpot(e.target.value)} />
            <div className="fl-label">Photo</div>
            <PhotoPick file={photo} onFile={setPhoto} />
            <button type="button" className="fl-btn fl-btn-green" style={{ marginTop: 16 }} disabled={busy} onClick={finish}>
              {busy ? 'Saving…' : 'Done — tell me what to paint'}
            </button>
            <button type="button" className="fl-btn fl-btn-ghost" style={{ marginBottom: 0 }} disabled={busy} onClick={() => setStep('condition')}>Back</button>
          </>
        )}
      </div>
    </>
  )
}

// Move / Link to order / Unlink / Problem / Add note on one stone.
function StoneActionSheet({ action, zones, orders, undo, onClose, onDone }) {
  const { kind, stone } = action
  const [zone, setZone] = useState(stone.zone || '')
  const [crate, setCrate] = useState(stone.crate || '')
  const [spot, setSpot] = useState(stone.spot || '')
  const [note, setNote] = useState('')
  const [cond, setCond] = useState({ condition: stone.condition || 'good', note: stone.condition_note || '', damage: null, unusable: false })
  const [oq, setOq] = useState('')
  const [busy, setBusy] = useState(false)
  const tagText = fmtYardTag(stone.yard_tag) || stoneTitle(stone)

  const hits = useMemo(() => {
    const n = oq.trim().toLowerCase()
    if (!n) return []
    return orders.filter(o => [familyOf(o), customerName(o.customer), o.order_number].filter(Boolean).join(' ').toLowerCase().includes(n)).slice(0, 12)
  }, [oq, orders])

  const run = async (fn, line, undoFn, undoLabel) => {
    if (busy) return
    setBusy(true)
    const r = await fn()
    setBusy(false)
    if (!r.ok) { undo.showError(r.error || 'Could not save.'); return }
    if (undoFn) undo.show(undoLabel, async () => { await undoFn().catch(() => {}) })
    onDone(line)
  }

  return (
    <>
      <div className="fl-sheet-scrim" onClick={onClose} />
      <div className="fl-sheet">
        <div className="fl-sheet-grab" />
        <div className="fl-sheet-title fl-yd-ellip">{tagText} · {stoneTitle(stone)}</div>

        {kind === 'move' && (<>
          <div className="fl-label">Zone</div>
          <ZonePicker zones={zones} value={zone} onChange={setZone} />
          <div className="fl-label">Crate</div>
          <input className="fl-input" placeholder="e.g. C-7" value={crate} onChange={e => setCrate(e.target.value)} />
          <div className="fl-label">Spot</div>
          <input className="fl-input" placeholder="stack 3, row 2, by the gate" value={spot} onChange={e => setSpot(e.target.value)} />
          <button type="button" className="fl-btn" style={{ marginTop: 16 }} disabled={busy}
            onClick={() => run(
              () => moveYardStone(stone.id, { zone: zone.trim() || null, crate: crate.trim() || null, spot: spot.trim() || null }),
              null,
              () => moveYardStone(stone.id, { zone: stone.zone || null, crate: stone.crate || null, spot: stone.spot || null }),
              `${tagText} moved`)}>
            {busy ? 'Saving…' : 'Save the move'}
          </button>
        </>)}

        {kind === 'note' && (<>
          <ConditionStep value={cond} onChange={setCond} showUnusable={stone.status !== 'problem'} />
          <button type="button" className="fl-btn" style={{ marginTop: 16 }} disabled={busy}
            onClick={() => run(
              async () => {
                const r = await setYardStoneCondition(stone.id, { condition: cond.condition, note: cond.note, unusable: cond.unusable, by: me() })
                if (r.ok && cond.damage) { const d = await uploadYardStonePhoto(stone.id, cond.damage, { kind: 'damage' }); if (!d.ok) undo.showError(`Saved, but the damage photo did not upload: ${d.error}`) }
                return r
              },
              cond.unusable ? `${tagText} · Red tape` : null,
              () => setYardStoneCondition(stone.id, { condition: stone.condition || 'good', note: stone.condition_note || null }).then(() => (cond.unusable ? restoreYardStockStatus(stone.id, stone.status || 'available') : null)),
              `${tagText} condition saved`)}>
            {busy ? 'Saving…' : 'Save the condition'}
          </button>
        </>)}

        {kind === 'link' && (<>
          <div className="fl-spec" style={{ fontFamily: 'inherit', marginBottom: 8 }}>Pick the order this stone is for. Then swap the tape: <b>take the blue off, put GREEN on with the family and order number.</b></div>
          <input className="fl-input" type="search" placeholder="Family or order number" value={oq} onChange={e => setOq(e.target.value)} autoFocus />
          <div style={{ marginTop: 8 }}>
            {hits.map(o => (
              <button key={o.id} type="button" className="fl-row" disabled={busy}
                onClick={() => run(
                  () => linkYardStoneToOrder(stone.id, { orderId: o.id, family: familyOf(o) || null }),
                  `${tagText} · Green tape: ${orderLabel(o)}`,
                  () => unlinkYardStone(stone.id),
                  `${tagText} linked to ${orderLabel(o)}`)}>
                <div className="fl-fam fl-yd-ellip" style={{ fontSize: 15 }}>{properName(familyOf(o) || '—')}</div>
                <div className="fl-spec fl-yd-ellip">{[o.order_number || 'DRAFT', o.cemetery?.name].filter(Boolean).join(' · ')}</div>
              </button>
            ))}
            {oq.trim() && hits.length === 0 && <div className="fl-empty">No open stone order matches.</div>}
          </div>
        </>)}

        {kind === 'unlink' && (<>
          <div className="fl-spec fl-yd-wrap" style={{ fontFamily: 'inherit', marginBottom: 8 }}>
            This stone is marked for <b>{stone.assigned_to ? properName(stone.assigned_to) : 'an order'}</b>. Unlinking makes it free stock again — <b>take the green tape off, put BLUE on.</b>
          </div>
          <button type="button" className="fl-btn" disabled={busy}
            onClick={() => run(
              () => unlinkYardStone(stone.id),
              `${tagText} · Blue tape`,
              () => linkYardStoneToOrder(stone.id, { orderId: stone.allocated_order_id, family: stone.assigned_to || null }),
              `${tagText} unlinked`)}>
            {busy ? 'Saving…' : 'Unlink — it is free stock'}
          </button>
        </>)}

        {kind === 'problem' && (<>
          <div className="fl-spec fl-yd-wrap" style={{ fontFamily: 'inherit', marginBottom: 8 }}>
            Cracked, wrong size, nobody knows whose? Mark it and <b>put RED tape on</b>. It lands in Reconcile for Paul to decide. The family link stays.
          </div>
          <input className="fl-input" placeholder="What is wrong (optional)" value={note} onChange={e => setNote(e.target.value)} />
          <button type="button" className="fl-btn" style={{ marginTop: 12, background: '#B3261E' }} disabled={busy}
            onClick={() => run(
              () => flagYardStoneProblem(stone.id, { by: me(), note: note.trim() || null }),
              `${tagText} · Red tape`,
              () => restoreYardStockStatus(stone.id, stone.status || 'available'),
              `${tagText} flagged problem`)}>
            {busy ? 'Saving…' : 'Mark problem — red tape'}
          </button>
        </>)}

        <button type="button" className="fl-btn fl-btn-ghost" style={{ marginBottom: 0, marginTop: 10 }} disabled={busy} onClick={onClose}>Cancel</button>
      </div>
    </>
  )
}

// FREE STOCK — type chips, the per-type spec chips, size / color / specs, photo.
// Save mints the next number (editable, warns when taken) and hands the row to
// the CONDITION + STORAGE steps; the form stays open with the number advanced
// and type / color / chips kept so a stack of identical flats goes fast.
function TagStoneForm({ undo, takenTags, seed, onClose, onMinted }) {
  const [tag, setTag] = useState('')
  const [nextHint, setNextHint] = useState(null)
  // CATEGORY first (Paul 2026-10-21) — item_type follows from it.
  const [category, setCategory] = useState(seed?.category || (seed?.item_type === 'die' || !seed?.item_type ? 'single_upright' : (YARD_CATEGORIES.some(c => c.code === seed.item_type) ? seed.item_type : 'other')))
  const type = categoryToType(category)
  const [fields, setFields] = useState({ size: seed?.size || '', color: seed?.color || '', specs: seed?.specs || '', top: seed?.top || null, polish_level: seed?.polish_level || null, finish: seed?.finish || null, top_finish: seed?.top_finish || null, polish_margin: !!seed?.polish_margin })
  const [photo, setPhoto] = useState(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  const colors = useMemo(() => activeColorNames(), [])

  useEffect(() => {
    let on = true
    getNextYardTag().then(r => { if (!on) return; setNextHint(r.next); setTag(String(r.next)) })
    return () => { on = false }
  }, [])

  const tagNum = Number(tag)
  const tagOk = Number.isInteger(tagNum) && tagNum > 0
  const taken = tagOk && takenTags.has(tagNum)

  const save = async () => {
    if (busy || !tagOk || taken) return
    setBusy(true); setMsg(null)
    const r = await tagYardStone({ ...fields, item_type: type, category, status: 'available' }, { tag: tagNum, by: me() })
    if (!r.ok) { setBusy(false); setMsg(r.error || 'Could not save the stone.'); return }
    if (photo) { const p = await uploadYardStonePhoto(r.row.id, photo); if (!p.ok) undo.showError(`Saved, but the photo did not upload: ${p.error}`) }
    setBusy(false)
    setPhoto(null)
    setFields(f => ({ ...f, specs: '' }))
    // Advance: the painted number + 1, and re-check the server's next in case
    // another phone minted in between.
    setTag(String(tagNum + 1)); setNextHint(tagNum + 1)
    getNextYardTag().then(n => { if (n.ok && n.next > tagNum + 1) { setTag(String(n.next)); setNextHint(n.next) } })
    onMinted(r.row)
  }

  return (
    <div className="fl-card">
      <div className="fl-rowtop">
        <div className="fl-eyebrow" style={{ marginBottom: 0 }}>Free stock — blue tape</div>
        <button type="button" className="fl-event-undo" onClick={onClose}>Close</button>
      </div>
      <div className="fl-lab" style={{ marginTop: 10 }}>Number to paint</div>
      <input className="fl-input fl-yd-bignum" type="text" inputMode="numeric" pattern="[0-9]*" value={tag}
        onChange={e => setTag(e.target.value.replace(/\D/g, ''))} />
      {taken && <div className="fl-yd-warn">{fmtYardTag(tagNum)} is already painted on another stone. Next free is {fmtYardTag(nextHint)}.</div>}
      {!taken && tagOk && nextHint != null && tagNum !== nextHint && <div className="fl-yd-note">Next free number is {fmtYardTag(nextHint)} — you typed {fmtYardTag(tagNum)}.</div>}

      <div className="fl-lab">Category</div>
      <Chips options={YARD_CATEGORIES} value={category} onChange={(c) => { if (c) setCategory(c) }} allowNone={false} />

      <SpecFields type={type} fields={fields} onChange={setFields} colors={colors} />

      <div className="fl-lab">Photo</div>
      <PhotoPick file={photo} onFile={setPhoto} />

      {msg && <div className="fl-yd-warn">{msg}</div>}
      <button type="button" className="fl-btn fl-btn-gold" style={{ marginTop: 14, marginBottom: 0 }} disabled={busy || !tagOk || taken} onClick={save}>
        {busy ? 'Saving…' : `Save — paint ${tagOk ? fmtYardTag(tagNum) : '…'}`}
      </button>
    </div>
  )
}

// ADD BULK TO STOCK (Paul 2026-10-22): "it could be backers, slants, or
// whatever flat markers the same exact thing... i would give you the quantity
// then you would add all and give me a label for each... 5 slants → 001, 002,
// 003". Category + the same spec fields as one stone, how many, the first
// number (defaults to the next free), where the pile sits (once, for all).
// Save inserts the whole run in ONE call (all-or-nothing); the sheet after
// lists every number to paint. Condition = good; a chipped one gets marked
// from its row afterwards.
function BulkStockForm({ undo, takenTags, zones, lastWhere, onClose, onDone }) {
  const [category, setCategory] = useState('slant')
  const type = categoryToType(category)
  const [fields, setFields] = useState({ size: '', color: '', specs: '', top: null, polish_level: null, finish: null, top_finish: null, polish_margin: false })
  const [qty, setQty] = useState('')
  const [start, setStart] = useState('')
  const [nextHint, setNextHint] = useState(null)
  const [zone, setZone] = useState(lastWhere.zone || '')
  const [crate, setCrate] = useState(lastWhere.crate || '')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  const colors = useMemo(() => activeColorNames(), [])

  useEffect(() => {
    let on = true
    getNextYardTag().then(r => { if (!on) return; setNextHint(r.next); setStart(String(r.next)) })
    return () => { on = false }
  }, [])

  const n = Number(qty), startNum = Number(start)
  const qtyOk = Number.isInteger(n) && n >= 1 && n <= 500
  const startOk = Number.isInteger(startNum) && startNum > 0
  const endNum = startOk && qtyOk ? startNum + n - 1 : null
  const clash = useMemo(() => {
    if (!startOk || !qtyOk) return []
    const out = []
    for (let t = startNum; t <= endNum; t++) if (takenTags.has(t)) out.push(t)
    return out
  }, [startOk, qtyOk, startNum, endNum, takenTags])
  const bump = (d) => setQty(String(Math.max(1, Math.min(500, (Number(qty) || 0) + d))))

  const save = async () => {
    if (busy || !qtyOk || !startOk || clash.length) return
    setBusy(true); setMsg(null)
    const r = await tagYardStonesBulk(
      { ...fields, item_type: type, category, status: 'available', zone: zone.trim() || null, crate: crate.trim() || null },
      { count: n, startTag: startNum, by: me() })
    setBusy(false)
    if (!r.ok) {
      setMsg(r.error || 'Could not save the stones.')
      if (r.next) { setNextHint(r.next); setStart(String(r.next)) }
      undo.showError(r.error || 'Could not save the stones.')
      return
    }
    const whereLine = [zone.trim() && `Zone ${zone.trim()}`, crate.trim() && `crate ${crate.trim()}`].filter(Boolean).join(' ')
    onDone({ tags: r.tags, rows: r.rows, tape: 'Blue tape', where: { zone: zone.trim(), crate: crate.trim() }, whereLine, label: `${n} × ${yardCategoryLabel(category)}` })
  }

  return (
    <div className="fl-card">
      <div className="fl-rowtop">
        <div className="fl-eyebrow" style={{ marginBottom: 0 }}>Bulk stock — the same stone, many of them</div>
        <button type="button" className="fl-event-undo" onClick={onClose}>Close</button>
      </div>
      <div className="fl-lab" style={{ marginTop: 10 }}>Category</div>
      <Chips options={YARD_CATEGORIES} value={category} onChange={(c) => { if (c) setCategory(c) }} allowNone={false} />

      <SpecFields type={type} fields={fields} onChange={setFields} colors={colors} />

      <div className="fl-lab">How many</div>
      <div className="fl-yd-qty">
        <button type="button" className="fl-yd-qty-btn" onClick={() => bump(-1)} aria-label="One fewer">−</button>
        <input className="fl-input fl-yd-bignum fl-yd-qty-in" type="text" inputMode="numeric" pattern="[0-9]*" placeholder="5"
          value={qty} onChange={e => setQty(e.target.value.replace(/\D/g, '').slice(0, 3))} />
        <button type="button" className="fl-yd-qty-btn" onClick={() => bump(1)} aria-label="One more">+</button>
      </div>

      <div className="fl-lab">First number to paint</div>
      <input className="fl-input fl-yd-bignum" type="text" inputMode="numeric" pattern="[0-9]*" value={start}
        onChange={e => setStart(e.target.value.replace(/\D/g, ''))} />
      {clash.length > 0 && <div className="fl-yd-warn">{clash.slice(0, 6).map(fmtYardTag).join(', ')}{clash.length > 6 ? '…' : ''} already painted on another stone. Next free is {fmtYardTag(nextHint)}.</div>}
      {!clash.length && startOk && nextHint != null && startNum !== nextHint && <div className="fl-yd-note">Next free number is {fmtYardTag(nextHint)} — you typed {fmtYardTag(startNum)}.</div>}
      {qtyOk && startOk && !clash.length && <div className="fl-yd-sizeread">= {fmtYardTag(startNum)} to {fmtYardTag(endNum)}, {n} {n === 1 ? 'stone' : 'stones'}</div>}

      <div className="fl-lab">Where the pile sits (all of them)</div>
      <ZonePicker zones={zones} value={zone} onChange={setZone} />
      <input className="fl-input" style={{ marginTop: 8 }} placeholder="Crate, e.g. C-7" value={crate} onChange={e => setCrate(e.target.value)} />

      {msg && <div className="fl-yd-warn">{msg}</div>}
      <button type="button" className="fl-btn fl-btn-gold" style={{ marginTop: 14, marginBottom: 0 }} disabled={busy || !qtyOk || !startOk || clash.length > 0} onClick={save}>
        {busy ? 'Saving…' : qtyOk && startOk ? `Save ${n} — paint ${fmtYardTag(startNum)} to ${fmtYardTag(endNum)}` : 'Save — how many?'}
      </button>
    </div>
  )
}

// After a bulk save: the run of numbers to paint, big, one per stone.
function BulkDoneSheet({ res, onDone }) {
  const first = res.tags[0], last = res.tags[res.tags.length - 1]
  return (
    <>
      <div className="fl-sheet-scrim" />
      <div className="fl-sheet">
        <div className="fl-sheet-grab" />
        <div className="fl-yd-paint">Paint {fmtYardTag(first)}{res.tags.length > 1 ? ` to ${fmtYardTag(last)}` : ''}</div>
        <div className="fl-yd-tapeline">{res.tape}{res.whereLine ? ` · ${res.whereLine}` : ''}</div>
        <div className="fl-spec fl-yd-wrap" style={{ fontFamily: 'inherit', marginBottom: 10 }}>{res.label}{res.rows[0] ? ` · ${yardStoneSpecLine(res.rows[0])}` : ''}</div>
        <div className="fl-yd-tagrun">{res.tags.map(t => <span key={t} className="fl-yd-tagrun-n">{fmtYardTag(t)}</span>)}</div>
        <button type="button" className="fl-btn fl-btn-green" style={{ marginTop: 16, marginBottom: 0 }} onClick={onDone}>Done — all labeled</button>
      </div>
    </>
  )
}

// Fix a count on an old-style multi-quantity row (the walk's Fix verb).
function ReceiveForm({ item, undo, onDone, onCancel }) {
  const [delta, setDelta] = useState(1)
  const [busy, setBusy] = useState(false)

  const confirm = async () => {
    if (!delta || busy) return
    setBusy(true)
    const prev = { quantity: Number(item.quantity) || 0, status: item.status }
    const nextQty = Math.max(0, prev.quantity + delta)
    const patch = { quantity: nextQty }
    if (delta > 0 && item.status !== 'allocated') patch.status = 'available'
    const res = await updateInventoryItem(item.id, patch).then(() => ({ ok: true })).catch(e => ({ ok: false, error: e?.message }))
    setBusy(false)
    if (!res.ok) { undo.showError(res.error || 'Could not update stock.'); return }
    undo.show(
      `${stoneTitle(item)} qty ${prev.quantity} → ${nextQty}`,
      async () => { await updateInventoryItem(item.id, prev).catch(() => {}) }
    )
    onDone()
  }

  return (
    <div style={{ marginTop: 10, borderTop: '1px solid #F0ECE2', paddingTop: 10 }}>
      <div className="fl-lab">{delta >= 0 ? 'Receiving' : 'Removing'} — confirm the count</div>
      <div className="fl-qtyrow" style={{ marginBottom: 8 }}>
        <button type="button" className="fl-qtybtn" onClick={() => setDelta(d => d - 1)}>−</button>
        <div className="fl-qtyval">{delta > 0 ? `+${delta}` : delta}</div>
        <button type="button" className="fl-qtybtn" onClick={() => setDelta(d => d + 1)}>+</button>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" className="fl-btn fl-btn-ghost" style={{ marginBottom: 0 }} onClick={onCancel} disabled={busy}>Cancel</button>
        <button type="button" className="fl-btn fl-btn-green" style={{ marginBottom: 0 }} onClick={confirm} disabled={busy || delta === 0}>
          {busy ? 'Saving…' : `Confirm ${delta > 0 ? '+' : ''}${delta}`}
        </button>
      </div>
    </div>
  )
}

// Overflow doctrine: every text child wraps or ellipsizes inside its box.
const YD_CSS = `
  .fl-yd { min-width: 0; }
  .fl-yd-add { padding-bottom: 10px; }
  .fl-yd-addrow { display: flex; align-items: center; gap: 10px; min-width: 0; flex-wrap: wrap; }
  .fl-yd-hint { flex: 1 1 160px; min-width: 0; font-size: 12px; color: #7C7562; line-height: 1.35; overflow-wrap: anywhere; }
  .fl-yd-confirm { background: #0F1419; color: #E8E2D4; border-radius: 14px; padding: 14px 16px; margin-bottom: 12px; display: flex; align-items: center; gap: 12px; min-width: 0; }
  .fl-yd-confirm-text { flex: 1; min-width: 0; font-size: 17px; font-weight: 800; line-height: 1.3; color: #F0C96A; overflow-wrap: anywhere; word-break: break-word; }
  .fl-yd-confirm-ok { flex-shrink: 0; background: #9A7209; color: #fff; border: none; border-radius: 10px; font: inherit; font-size: 13px; font-weight: 800; padding: 10px 16px; cursor: pointer; }
  .fl-yd-tag { flex-shrink: 0; min-width: 56px; text-align: center; font-family: "JetBrains Mono", Consolas, monospace; font-size: 24px; font-weight: 800; color: #16150F; background: #F5F3EE; border: 1px solid #E2DCCE; border-radius: 10px; padding: 8px 6px; letter-spacing: 0.02em; }
  .fl-yd-tag-none { color: #B9B29E; font-size: 18px; }
  .fl-yd-ellip { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .fl-yd-wrap { min-width: 0; overflow-wrap: anywhere; word-break: break-word; white-space: normal; }
  .fl-yd-chipwrap { white-space: normal; overflow-wrap: anywhere; max-width: 100%; }
  .fl-yd-tape-blue { background: rgba(29,111,168,0.14); color: #185F8F; }
  .fl-yd-tape-green { background: rgba(29,158,117,0.16); color: #14775A; }
  .fl-yd-tape-red { background: #B3261E; color: #fff; }
  .fl-yd-verbs { display: flex; gap: 6px; margin-top: 8px; flex-wrap: wrap; align-items: center; }
  .fl-yd-btnrow { display: flex; gap: 8px; margin-top: 10px; min-width: 0; }
  .fl-yd-here { flex: 1; min-width: 0; min-height: 46px; background: #1D9E75; color: #fff; border: none; border-radius: 12px; font-family: inherit; font-size: 14px; font-weight: 800; cursor: pointer; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding: 0 10px; }
  .fl-yd-here:disabled { opacity: 0.5; }
  .fl-yd-piece { display: flex; align-items: center; gap: 10px; width: 100%; min-width: 0; text-align: left; font-family: inherit; background: #FBFAF6; border: 1px solid #E2DCCE; border-radius: 12px; padding: 10px 12px; margin-top: 8px; }
  .fl-yd-piece-btn { cursor: pointer; border-color: #9A7209; }
  .fl-yd-piece-main { flex: 1; min-width: 0; }
  .fl-yd-piece-label { font-size: 13px; font-weight: 800; color: #16150F; }
  .fl-yd-piece-go { flex-shrink: 0; font-size: 12px; font-weight: 800; color: #fff; background: #1D9E75; border-radius: 999px; padding: 8px 12px; white-space: nowrap; }
  .fl-yd-ask { font-size: 15px; font-weight: 700; color: #16150F; margin: 10px 0 2px; }
  .fl-yd-chiprow { display: flex; gap: 6px; flex-wrap: wrap; }
  .fl-yd-bignum { font-family: "JetBrains Mono", Consolas, monospace; font-size: 34px; font-weight: 800; text-align: center; letter-spacing: 0.06em; padding: 10px 14px; }
  .fl-yd-addrow2 { margin-top: 8px; min-width: 0; }
  .fl-yd-qty { display: flex; align-items: center; gap: 8px; min-width: 0; }
  .fl-yd-qty-btn { flex-shrink: 0; width: 52px; height: 52px; border-radius: 12px; border: 1px solid #DAD3C2; background: #FBFAF6; color: #16150F; font-family: inherit; font-size: 26px; font-weight: 800; cursor: pointer; }
  .fl-yd-qty-in { flex: 1; min-width: 0; }
  .fl-yd-tagrun { display: flex; flex-wrap: wrap; gap: 8px; min-width: 0; max-height: 40dvh; overflow-y: auto; }
  .fl-yd-tagrun-n { font-family: "JetBrains Mono", Consolas, monospace; font-size: 22px; font-weight: 800; color: #16150F; background: #F5F3EE; border: 1px solid #E2DCCE; border-radius: 10px; padding: 8px 12px; letter-spacing: 0.04em; }
  .fl-yd-sizerow { display: flex; gap: 8px; min-width: 0; }
  .fl-yd-sizecell { flex: 1 1 0; min-width: 0; }
  .fl-yd-sizelab { font-size: 12px; font-weight: 800; color: #7C7562; margin: 0 0 3px 2px; letter-spacing: 0.04em; }
  .fl-yd-sizebox { width: 100%; min-width: 0; box-sizing: border-box; text-align: center; font-variant-numeric: tabular-nums; }
  .fl-yd-sizeread { font-size: 13px; font-weight: 800; color: #14775A; margin: 5px 2px 0; min-width: 0; overflow-wrap: anywhere; font-variant-numeric: tabular-nums; }
  .fl-yd-sizeread-in { font-weight: 600; color: #5B7F72; }
  .fl-yd-sizeread-muted { color: #7C7562; font-weight: 600; }
  .fl-yd-warn { font-size: 12.5px; color: #B3261E; font-weight: 700; margin: 6px 2px 0; overflow-wrap: anywhere; }
  .fl-yd-warnbox { margin-top: 12px; border: 1px solid rgba(179,38,30,0.4); background: rgba(179,38,30,0.06); border-radius: 12px; padding: 10px 12px; min-width: 0; }
  .fl-yd-note { font-size: 12px; color: #8A5A12; margin: 6px 2px 0; overflow-wrap: anywhere; }
  .fl-yd-photo { display: flex; align-items: center; gap: 10px; min-width: 0; }
  .fl-yd-thumb { width: 64px; height: 64px; object-fit: cover; border-radius: 10px; border: 1px solid #E2DCCE; flex-shrink: 0; }
  .fl-yd-paint { font-size: 30px; font-weight: 800; color: #16150F; margin-top: 8px; overflow-wrap: anywhere; }
  .fl-yd-tapeline { font-size: 15px; font-weight: 800; color: #14775A; margin: 2px 0 8px; overflow-wrap: anywhere; }
  .fl-yd-tapeline-red { color: #B3261E; }
`


