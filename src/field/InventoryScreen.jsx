// =============================================================================
// InventoryScreen — the yard from the phone: FIND, IS-HERE, TAG A STONE, the walk
// =============================================================================
// RESET-TAG-1 (2026-10-19). Paul re-founds the inventory zone by zone: every
// stone gets a painted running number (001, 002, ...) on a sawn face, tape by
// status — BLUE free / GREEN sold (family name + order number) / RED problem —
// and a row here. Two entry paths:
//   • a SOLD stone found in the yard: search the family, tap "Die is here" /
//     "Base is here" on the order — the app mints the number, links the row to
//     the order, flips the order's die/base status to In stock, asks zone +
//     crate + photo, then tells him what to paint and tape.
//   • FREE stock: "Tag a stone" — number (pre-filled, editable), type chips,
//     color, size, specs, zone, crate, photo. Save stamps verified and advances
//     the number keeping type / color / size / zone so a stack of identical
//     flats goes fast.
// On any stone: Move (zone/crate), Link to order / Unlink (says the tape
// change), Problem (red tape → Reconcile), Not here (the count's missing flow).
//
// Rides the SAME inventory_stock table + helpers as the desktop Inventory tab;
// the DIE / BASE verdict chips on order results come from lib/stonePosition —
// the exact logic the desktop Stone Position list uses. Archived (pre-reset)
// rows never show here (getInventoryStock excludes them).
//
// COUNT THE YARD (2026-08-03) survives: FOUND / NOT HERE / Fix per stone.
// =============================================================================
import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import {
  getInventoryStock, updateInventoryItem,
  verifyYardStock, restoreYardVerification, flagYardStockMissing, restoreYardStockStatus,
  getActiveStaffUser, properName, customerName,
  YARD_TYPES, fmtYardTag, yardTypeLabel, getNextYardTag, tagYardStone, markPieceHere,
  moveYardStone, flagYardStoneProblem, linkYardStoneToOrder, unlinkYardStone, uploadYardStonePhoto,
  getOrderSpecRow, formatTradeSize, INVENTORY_STATUS_LABEL,
} from '../lib/stonebooksData'
import { loadStonePositionData, stoneVerdict, verdictChipText, isStoneOrder } from '../lib/stonePosition'
import { contractDieLabel, contractBaseLabel, tradeDimsFromLabel } from '../lib/jobComponents'
import { displayGraniteColor, displayColorLabel, GRANITE_COLORS } from '../lib/monumentCatalog'

const DAY_MS = 86400000
// A verification older than 90 days counts as unconfirmed on the walk.
const FRESH_MS = 90 * DAY_MS

const familyOf = (o) => String(o?.primary_lastname || o?.customer?.last_name || o?.customer?.first_name || '').trim().toUpperCase()
const orderLabel = (o) => [familyOf(o) || '—', o?.order_number].filter(Boolean).join(' ')
const stoneTitle = (it) => [yardTypeLabel(it.item_type) || 'Stone', it.color].filter(Boolean).join(' · ')
const whereOf = (it) => [it.zone && `Zone ${it.zone}`, it.crate && `crate ${it.crate}`, !it.zone && !it.crate && it.location && `@ ${it.location}`].filter(Boolean).join(' ')

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

export default function InventoryScreen({ undo }) {
  const [data, setData] = useState(null)      // loadStonePositionData result
  const [err, setErr] = useState(null)
  const [q, setQ] = useState('')
  const [tagging, setTagging] = useState(false)
  const [counting, setCounting] = useState(false)
  const [countBusy, setCountBusy] = useState(null)
  const [nowMs, setNowMs] = useState(0)
  const [receiving, setReceiving] = useState(null)
  const [hereFlow, setHereFlow] = useState(null)   // { order, piece, row, tag }
  const [hereBusy, setHereBusy] = useState(null)   // `${orderId}:${piece}`
  const [action, setAction] = useState(null)       // { kind, stone }
  const [confirmLine, setConfirmLine] = useState(null)

  const me = () => getActiveStaffUser() || null

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
  // else (no size / order-number substring noise). Four digits can also be an
  // order number, so those fall through to the text match.
  const needleNum = /^\d{1,4}$/.test(needle) ? Number(needle) : null
  const tagOnly = needleNum != null && needle.length < 4

  const stoneHits = useMemo(() => {
    if (!items) return []
    let l = items
    if (needle) {
      l = l.filter(it => {
        if (needleNum != null && Number(it.yard_tag) === needleNum) return true
        if (tagOnly) return false
        const o = it.allocated_order_id ? orderById.get(it.allocated_order_id) : null
        return [fmtYardTag(it.yard_tag), it.item_type, yardTypeLabel(it.item_type), it.color, it.size, it.specs, it.zone, it.crate,
          it.location, it.notes, it.status, it.assigned_to, o?.order_number, o && familyOf(o)]
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
    if (!needle || !data || tagOnly) return []
    const l = stoneOrders.filter(o => [familyOf(o), customerName(o.customer), o.order_number, o.cemetery?.name]
      .filter(Boolean).join(' ').toLowerCase().includes(needle))
    l.sort((a, b) => familyOf(a).localeCompare(familyOf(b)))
    return l.slice(0, 20).map(o => ({ order: o, die: stoneVerdict(o, 'die', data), base: stoneVerdict(o, 'base', data) }))
  }, [needle, data, stoneOrders, tagOnly])

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

  // ── IS HERE: mint the row + link + flip the order, then ask where ────────
  const pieceHere = async (o, piece) => {
    const key = `${o.id}:${piece}`
    if (hereBusy) return
    setHereBusy(key)
    const spec = await getOrderSpecRow(o.id)
    let color = null, size = null, specs = null
    if (spec) {
      const label = piece === 'base' ? contractBaseLabel(spec) : contractDieLabel(spec)
      const dims = tradeDimsFromLabel(label)
      size = dims?.dims || null
      specs = dims ? (dims.rest || null) : (label || null)
      color = displayGraniteColor(spec) || null
    }
    const r = await markPieceHere({
      orderId: o.id, orderNumber: o.order_number || null, family: familyOf(o) || null, piece, color, size, specs, by: me(),
    })
    setHereBusy(null)
    if (!r.ok) { undo.showError(r.error || 'Could not record the stone.'); return }
    if (!r.statusOk) undo.showError(`Stone ${fmtYardTag(r.tag)} saved, but the order status did not flip: ${r.statusError}`)
    await refreshStock()
    setHereFlow({ order: o, piece, row: r.row, tag: r.tag })
  }

  if (err) return <div className="fl-empty">{err}</div>
  if (items === null) return <div className="fl-empty">Loading the yard…</div>

  const countable = items.filter(it => it.status !== 'missing')
  const confirmed = countable.filter(isFresh).length

  return (
    <div className="fl-yd">
      <style>{YD_CSS}</style>
      <input className="fl-search" type="search" inputMode="search" placeholder="Find a number, family, type, color, size, zone, crate"
        value={q} onChange={e => setQ(e.target.value)} />

      {confirmLine && (
        <div className="fl-yd-confirm">
          <div className="fl-yd-confirm-text">{confirmLine}</div>
          <button type="button" className="fl-yd-confirm-ok" onClick={() => setConfirmLine(null)}>OK</button>
        </div>
      )}

      {!needle && (
        <div className="fl-yd-cards">
          <button type="button" className={`fl-btn${tagging ? ' fl-btn-ghost' : ' fl-btn-gold'}`}
            onClick={() => { setTagging(v => !v); setCounting(false) }}>
            {tagging ? 'Close Tag a stone' : 'Tag a stone (free stock)'}
          </button>
          <button type="button" className={counting ? 'fl-btn fl-btn-green' : 'fl-btn fl-btn-ghost'}
            onClick={() => { setCounting(v => !v); setNowMs(Date.now()); setTagging(false) }}>
            {counting ? `Counting — ${confirmed}/${countable.length} confirmed · tap to stop` : 'Count the yard'}
          </button>
        </div>
      )}
      {!needle && counting && (
        <div className="fl-spec" style={{ margin: '-4px 2px 10px', fontFamily: 'inherit' }}>
          Walk the zones. FOUND stamps your name on the stone; NOT HERE sends it to Reconcile.
          Unconfirmed stones list first. A stone with no number yet — tag it.
        </div>
      )}
      {!needle && tagging && (
        <TagStoneForm undo={undo} zones={zones} takenTags={takenTags}
          onSaved={async (row) => {
            await refreshStock()
            setConfirmLine(`Paint ${fmtYardTag(row.yard_tag)} · Blue tape`)
          }} />
      )}

      {needle && (
        <div className="fl-yd-hint">
          Sold stone? Tap the order below and say which piece is here. Free stone? Clear the search and Tag a stone.
        </div>
      )}

      {/* ORDER RESULTS — family search → die/base verdict → is-here */}
      {orderHits.length > 0 && <div className="fl-daylabel">Orders</div>}
      {orderHits.map(({ order: o, die, base }) => (
        <div key={o.id} className="fl-row" style={{ cursor: 'default' }}>
          <div className="fl-fam fl-yd-ellip">{properName(familyOf(o) || customerName(o.customer) || '—')}</div>
          <div className="fl-spec fl-yd-ellip">{[o.order_number || 'DRAFT', o.cemetery?.name].filter(Boolean).join(' · ')}</div>
          <div className="fl-chips">
            <VerdictChip label="DIE" v={die} />
            <VerdictChip label="BASE" v={base} />
          </div>
          {(die.code !== 'yard' || base.code !== 'yard') && (
            <div className="fl-yd-btnrow">
              {die.code !== 'yard' && (
                <button type="button" className="fl-yd-here" disabled={!!hereBusy} onClick={() => pieceHere(o, 'die')}>
                  {hereBusy === `${o.id}:die` ? 'Saving…' : 'Die is here'}
                </button>
              )}
              {base.code !== 'yard' && (
                <button type="button" className="fl-yd-here" disabled={!!hereBusy} onClick={() => pieceHere(o, 'base')}>
                  {hereBusy === `${o.id}:base` ? 'Saving…' : 'Base is here'}
                </button>
              )}
            </div>
          )}
        </div>
      ))}

      {/* STONES */}
      {(needle || orderHits.length > 0) && stoneHits.length > 0 && <div className="fl-daylabel">Stones</div>}
      {!needle && !tagging && !counting && <div className="fl-daylabel"><b>{items.length}</b> stones in the yard</div>}
      {stoneHits.length === 0 && items.length > 0 && needle && orderHits.length === 0 && <div className="fl-empty">Nothing in the yard or the open orders matches.</div>}
      {items.length === 0 && !tagging && <div className="fl-empty">The yard list is empty — tag the first stone.</div>}
      {stoneHits.map(it => {
        const fresh = isFresh(it)
        const tape = tapeFor(it, orderById)
        return (
          <div key={it.id} className="fl-row" style={{ cursor: 'default', ...(counting && fresh ? { opacity: 0.62 } : null) }}>
            <div className="fl-row-flex">
              <div className={`fl-yd-tag${it.yard_tag == null ? ' fl-yd-tag-none' : ''}`}>{fmtYardTag(it.yard_tag) || '—'}</div>
              <div className="fl-row-main">
                <div className="fl-fam fl-yd-ellip" style={{ fontSize: 15 }}>{stoneTitle(it)}</div>
                <div className="fl-spec fl-yd-wrap">{[it.size, whereOf(it)].filter(Boolean).join(' · ') || 'no size · no zone'}</div>
                {it.specs && <div className="fl-spec fl-yd-wrap" style={{ fontFamily: 'inherit' }}>{it.specs}</div>}
                {it.assigned_to && (
                  <div className="fl-spec fl-yd-ellip" style={{ fontFamily: 'inherit', fontWeight: 700 }}>for {properName(it.assigned_to)}</div>
                )}
              </div>
              {Number(it.quantity) > 1 && <div className="fl-inv-qty"><small>QTY</small>{Number(it.quantity)}</div>}
            </div>
            <div className="fl-chips">
              <span className={`fl-chip ${tape.cls} fl-yd-chipwrap`}>{tape.text}</span>
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

      {hereFlow && (
        <HereSheet flow={hereFlow} zones={zones} undo={undo}
          onClose={() => setHereFlow(null)}
          onDone={async (line) => { setHereFlow(null); await refreshStock(); setConfirmLine(line) }} />
      )}
      {action && (
        <StoneActionSheet action={action} zones={zones} orders={stoneOrders} undo={undo}
          onClose={() => setAction(null)}
          onDone={async (line) => { setAction(null); await refreshStock(); if (line) setConfirmLine(line) }} />
      )}
    </div>
  )
}

function VerdictChip({ label, v }) {
  const cls = v.code === 'yard' ? 'fl-c-good' : v.code === 'received' ? 'fl-c-good' : v.code === 'ordered' ? 'fl-c-info' : 'fl-c-lead'
  return <span className={`fl-chip ${cls} fl-yd-chipwrap`}>{label}: {verdictChipText(v)}{v.sub ? ` · ${v.sub}` : ''}</span>
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

function PhotoPick({ file, onFile }) {
  const ref = useRef(null)
  const url = useMemo(() => (file ? URL.createObjectURL(file) : null), [file])
  useEffect(() => () => { if (url) URL.revokeObjectURL(url) }, [url])
  return (
    <div className="fl-yd-photo">
      <input ref={ref} type="file" accept="image/*" capture="environment" style={{ display: 'none' }}
        onChange={e => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = '' }} />
      {url && <img className="fl-yd-thumb" src={url} alt="stone" />}
      <button type="button" className="fl-btn fl-btn-ghost" style={{ marginBottom: 0, flex: 1 }} onClick={() => ref.current?.click()}>
        {file ? 'Retake photo' : 'Take a photo'}
      </button>
      {file && <button type="button" className="fl-event-undo" onClick={() => onFile(null)}>Remove</button>}
    </div>
  )
}

// After "Die is here": the number is minted and the order flipped — now where
// does it sit, and a photo. Done writes zone/crate (+ photo) and hands back
// the confirmation line.
function HereSheet({ flow, zones, undo, onClose, onDone }) {
  const [zone, setZone] = useState(flow.row?.zone || '')
  const [crate, setCrate] = useState(flow.row?.crate || '')
  const [photo, setPhoto] = useState(null)
  const [busy, setBusy] = useState(false)
  const tape = `Green tape: ${orderLabel(flow.order)}`
  const finish = async () => {
    if (busy) return
    setBusy(true)
    const r = await moveYardStone(flow.row.id, { zone: zone.trim() || null, crate: crate.trim() || null })
    if (!r.ok) { setBusy(false); undo.showError(r.error || 'Could not save where it sits.'); return }
    if (photo) {
      const p = await uploadYardStonePhoto(flow.row.id, photo)
      if (!p.ok) undo.showError(`Saved, but the photo did not upload: ${p.error}`)
    }
    setBusy(false)
    const where = [zone.trim() && `Zone ${zone.trim()}`, crate.trim() && `crate ${crate.trim()}`].filter(Boolean).join(' ')
    onDone([`Paint ${fmtYardTag(flow.tag)}`, tape, where || null].filter(Boolean).join(' · '))
  }
  return (
    <>
      <div className="fl-sheet-scrim" onClick={onClose} />
      <div className="fl-sheet">
        <div className="fl-sheet-grab" />
        <div className="fl-yd-paint">Paint {fmtYardTag(flow.tag)}</div>
        <div className="fl-yd-tapeline">{tape}</div>
        <div className="fl-spec fl-yd-wrap" style={{ fontFamily: 'inherit', marginBottom: 6 }}>
          {flow.piece === 'base' ? 'Base' : 'Die'}{flow.row?.size ? ` · ${flow.row.size}` : ''}{flow.row?.color ? ` · ${flow.row.color}` : ''} — linked to the order, status flipped to In stock.
        </div>
        <div className="fl-label">Zone</div>
        <ZonePicker zones={zones} value={zone} onChange={setZone} />
        <div className="fl-label">Crate</div>
        <input className="fl-input" placeholder="e.g. C-7" value={crate} onChange={e => setCrate(e.target.value)} />
        <div className="fl-label">Photo</div>
        <PhotoPick file={photo} onFile={setPhoto} />
        <button type="button" className="fl-btn fl-btn-green" style={{ marginTop: 16 }} disabled={busy} onClick={finish}>
          {busy ? 'Saving…' : 'Done — tell me what to paint'}
        </button>
        <button type="button" className="fl-btn fl-btn-ghost" style={{ marginBottom: 0 }} disabled={busy} onClick={onClose}>Skip for now</button>
      </div>
    </>
  )
}

// Move / Link to order / Unlink / Problem on one stone.
function StoneActionSheet({ action, zones, orders, undo, onClose, onDone }) {
  const { kind, stone } = action
  const [zone, setZone] = useState(stone.zone || '')
  const [crate, setCrate] = useState(stone.crate || '')
  const [note, setNote] = useState('')
  const [oq, setOq] = useState('')
  const [busy, setBusy] = useState(false)
  const tagText = fmtYardTag(stone.yard_tag) || stoneTitle(stone)
  const by = getActiveStaffUser() || null

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
          <button type="button" className="fl-btn" style={{ marginTop: 16 }} disabled={busy}
            onClick={() => run(
              () => moveYardStone(stone.id, { zone: zone.trim() || null, crate: crate.trim() || null }),
              null,
              () => moveYardStone(stone.id, { zone: stone.zone || null, crate: stone.crate || null }),
              `${tagText} moved`)}>
            {busy ? 'Saving…' : 'Save the move'}
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
              () => flagYardStoneProblem(stone.id, { by, note: note.trim() || null }),
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

// TAG A STONE — free stock. Number pre-filled with the next free one
// (editable; warns when taken), type chips, color datalist, size with the
// trade-format tidy, specs, zone chips, crate, photo. Save stamps verified and
// advances the number keeping type / color / size / zone / crate.
function TagStoneForm({ undo, zones, takenTags, onSaved }) {
  const [tag, setTag] = useState('')
  const [nextHint, setNextHint] = useState(null)
  const [form, setForm] = useState({ item_type: 'die', color: '', size: '', specs: '', zone: '', crate: '' })
  const [photo, setPhoto] = useState(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  const colors = useMemo(() => activeColorNames(), [])
  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }))

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
    const r = await tagYardStone({ ...form, status: 'available' }, { tag: tagNum, by: getActiveStaffUser() || null })
    if (!r.ok) { setBusy(false); setMsg(r.error || 'Could not save the stone.'); return }
    if (photo) {
      const p = await uploadYardStonePhoto(r.row.id, photo)
      if (!p.ok) undo.showError(`Saved, but the photo did not upload: ${p.error}`)
    }
    setBusy(false)
    setPhoto(null)
    setForm(f => ({ ...f, specs: '' }))
    // Advance: the painted number + 1, and re-check the server's next in case
    // another phone minted in between.
    setTag(String(tagNum + 1)); setNextHint(tagNum + 1)
    getNextYardTag().then(n => { if (n.ok && n.next > tagNum + 1) { setTag(String(n.next)); setNextHint(n.next) } })
    onSaved(r.row)
  }

  return (
    <div className="fl-card">
      <div className="fl-eyebrow">Tag a stone — free stock, blue tape</div>
      <div className="fl-lab">Number to paint</div>
      <input className="fl-input fl-yd-bignum" type="text" inputMode="numeric" pattern="[0-9]*" value={tag}
        onChange={e => setTag(e.target.value.replace(/\D/g, ''))} />
      {taken && <div className="fl-yd-warn">{fmtYardTag(tagNum)} is already painted on another stone. Next free is {fmtYardTag(nextHint)}.</div>}
      {!taken && tagOk && nextHint != null && tagNum !== nextHint && <div className="fl-yd-note">Next free number is {fmtYardTag(nextHint)} — you typed {fmtYardTag(tagNum)}.</div>}

      <div className="fl-lab">Type</div>
      <div className="fl-yd-chiprow">
        {YARD_TYPES.map(t => (
          <button key={t.code} type="button" className={`fl-chip-btn${form.item_type === t.code ? ' on' : ''}`}
            onClick={() => setForm(f => ({ ...f, item_type: t.code }))}>{t.label}</button>
        ))}
      </div>

      <div className="fl-lab">Color</div>
      <input className="fl-input" list="fl-yd-colors" placeholder="e.g. Barre Gray" value={form.color} onChange={set('color')} />
      <datalist id="fl-yd-colors">{colors.map(c => <option key={c} value={c} />)}</datalist>

      <div className="fl-lab">Size (trade format)</div>
      <input className="fl-input" placeholder="1-10 x 0-8 x 2-0" value={form.size} onChange={set('size')}
        onBlur={() => setForm(f => ({ ...f, size: formatTradeSize(f.size) }))} />

      <div className="fl-lab">Specs</div>
      <input className="fl-input" placeholder="Polish, finish, anything about the cut" value={form.specs} onChange={set('specs')} />

      <div className="fl-lab">Zone</div>
      <ZonePicker zones={zones} value={form.zone} onChange={(z) => setForm(f => ({ ...f, zone: z }))} />

      <div className="fl-lab" style={{ marginTop: 10 }}>Crate</div>
      <input className="fl-input" placeholder="e.g. C-7" value={form.crate} onChange={set('crate')} />

      <div className="fl-lab">Photo</div>
      <PhotoPick file={photo} onFile={setPhoto} />

      {msg && <div className="fl-yd-warn">{msg}</div>}
      <button type="button" className="fl-btn fl-btn-gold" style={{ marginTop: 14, marginBottom: 0 }} disabled={busy || !tagOk || taken} onClick={save}>
        {busy ? 'Saving…' : `Save — paint ${tagOk ? fmtYardTag(tagNum) : '…'}`}
      </button>
    </div>
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
  .fl-yd-cards { display: flex; flex-direction: column; gap: 0; }
  .fl-yd-hint { font-size: 12px; color: #7C7562; margin: -4px 2px 10px; line-height: 1.4; }
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
  .fl-yd-btnrow { display: flex; gap: 8px; margin-top: 10px; }
  .fl-yd-here { flex: 1; min-width: 0; min-height: 46px; background: #1D9E75; color: #fff; border: none; border-radius: 12px; font-family: inherit; font-size: 14px; font-weight: 800; cursor: pointer; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding: 0 10px; }
  .fl-yd-here:disabled { opacity: 0.5; }
  .fl-yd-chiprow { display: flex; gap: 6px; flex-wrap: wrap; }
  .fl-yd-bignum { font-family: "JetBrains Mono", Consolas, monospace; font-size: 34px; font-weight: 800; text-align: center; letter-spacing: 0.06em; padding: 10px 14px; }
  .fl-yd-warn { font-size: 12.5px; color: #B3261E; font-weight: 700; margin: 6px 2px 0; overflow-wrap: anywhere; }
  .fl-yd-note { font-size: 12px; color: #8A5A12; margin: 6px 2px 0; overflow-wrap: anywhere; }
  .fl-yd-photo { display: flex; align-items: center; gap: 10px; min-width: 0; }
  .fl-yd-thumb { width: 64px; height: 64px; object-fit: cover; border-radius: 10px; border: 1px solid #E2DCCE; flex-shrink: 0; }
  .fl-yd-paint { font-size: 30px; font-weight: 800; color: #16150F; margin-top: 8px; overflow-wrap: anywhere; }
  .fl-yd-tapeline { font-size: 15px; font-weight: 800; color: #14775A; margin: 2px 0 8px; overflow-wrap: anywhere; }
`
