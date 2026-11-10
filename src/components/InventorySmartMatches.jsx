// =============================================================================
// InventorySmartMatches — open orders' stone needs matched against the yard.
// =============================================================================
// Allocate reserves a yard stone to the order's family (release lives in Yard).
// SMART-WALK (Paul 2026-11-09): every match shows the PAINTED NUMBER of the
// stone to look for; cards go onto a YARD WALK LIST that prints (order name +
// stock number + where); "Already here" marks the order's piece in stock when
// the stone is already matched or arrived; "Dismiss" hides a card; and a need
// whose stone is BLASTED (or marked in stock / received) drops off by itself.
// =============================================================================

import { useState, useEffect, useCallback, useMemo } from 'react'
import { rowToOrder } from '../SalesMode'
import {
  getActiveStoneOrders, getInventoryStock, allocateInventoryItem,
  getStoneHereByOrder, listSmartMatchDismissals, dismissSmartMatch, undismissSmartMatch,
  setOrderPieceInStock, getCurrentStaffName, fmtYardTag,
} from '../lib/stonebooksData'
import { resolveStoneNeeds, matchNeedsToStock } from '../lib/inventoryMatch'
import { yardStoneSpecLine, yardStoneWhere } from '../lib/yardStone'
import { buildSmartWalkHtml } from '../lib/smartWalkSheet'
import { openPrintSheet } from '../lib/weekPrintSheet'

const titleCase = (s) => String(s || '').replace(/\b\w/g, c => c.toUpperCase())
const WALK_KEY = 'sb_smart_walk_v1'
const readWalk = () => { try { const v = JSON.parse(localStorage.getItem(WALK_KEY) || '[]'); return new Set(Array.isArray(v) ? v : []) } catch { return new Set() } }
const writeWalk = (set) => { try { localStorage.setItem(WALK_KEY, JSON.stringify([...set])) } catch { /* per-browser convenience only */ } }

function familyOf(row) {
  if (row.primary_lastname && String(row.primary_lastname).trim()) return String(row.primary_lastname).trim()
  if (Array.isArray(row.deceased)) {
    const d = row.deceased.find(x => x && !x.isReserved && (x.lastName || x.firstName))
    if (d) return [d.lastName, d.firstName].filter(Boolean).join(', ')
  }
  return row.order_number || 'Order'
}
const tagOf = (stock) => (stock?.yard_tag != null ? fmtYardTag(stock.yard_tag) : null)
const pieceOf = (need) => (need.kind === 'base' ? 'base' : 'die')
const kindLabel = (need) => (need.kind === 'base' ? 'Base' : need.kind === 'backer' ? 'Backer' : titleCase(need.itemType))

export default function InventorySmartMatches() {
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState(null)
  const [results, setResults] = useState([])
  const [here, setHere] = useState(new Map())
  const [dismissed, setDismissed] = useState(new Map())   // need_key → row
  const [dismissErr, setDismissErr] = useState(null)
  const [counts, setCounts] = useState({ orders: 0, stock: 0 })
  const [busyKey, setBusyKey] = useState(null)
  const [banner, setBanner] = useState(null)
  const [walk, setWalk] = useState(() => readWalk())
  const [openHere, setOpenHere] = useState(false)
  const [openDismissed, setOpenDismissed] = useState(false)

  const load = useCallback(async () => {
    try {
      const [ordRes, stockRes, dis] = await Promise.all([getActiveStoneOrders(), getInventoryStock(), listSmartMatchDismissals()])
      const stock = stockRes.rows || []
      const rows = ordRes.rows || []
      const orders = rows.map(r => { const o = rowToOrder(r, null, null); o.family = familyOf(r); return o })
      const needs = resolveStoneNeeds(orders)
      const hereMap = await getStoneHereByOrder(rows)
      setResults(matchNeedsToStock(needs, stock))
      setHere(hereMap)
      setDismissed(new Map((dis.rows || []).map(d => [d.need_key, d])))
      setDismissErr(dis.ok ? null : dis.error)
      setCounts({ orders: orders.length, stock: stock.length })
      setErr((!ordRes.ok && !stockRes.ok) ? (ordRes.error || stockRes.error) : null)
    } catch (e) {
      setErr(String(e?.message || e)); setResults([])
    }
    setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  // ── actions ───────────────────────────────────────────────────────────────
  const allocate = useCallback(async (need, best) => {
    if (!best || !need) return
    const tag = tagOf(best.stock)
    const ok = window.confirm(`Allocate ${tag ? `stone #${tag}` : `this ${need.spec}`} (${yardStoneWhere(best.stock) || 'the yard'}) to ${need.family}?`)
    if (!ok) return
    setBusyKey(need.key); setBanner(null)
    const res = await allocateInventoryItem(best.stock, { orderId: need.orderId, family: need.family })
    setBusyKey(null)
    if (!res.ok) { setBanner({ kind: 'err', text: `Could not allocate: ${res.error}` }); return }
    setWalk(w => { const n = new Set(w); n.delete(need.key); writeWalk(n); return n })
    setBanner({ kind: 'ok', text: `Allocated ${tag ? `#${tag}` : need.spec} to ${need.family}.` })
    load()
  }, [load])

  const markHere = useCallback(async (need) => {
    const piece = pieceOf(need)
    const ok = window.confirm(`Mark the ${need.kind === 'base' ? 'base' : 'stone'} for ${need.family} as already here (${piece} status → in stock)? It leaves this list.`)
    if (!ok) return
    setBusyKey(need.key); setBanner(null)
    let res
    if (need.kind === 'backer') {
      const by = await getCurrentStaffName().catch(() => null)
      res = await dismissSmartMatch({ needKey: need.key, orderId: need.orderId, kind: need.kind, reason: 'already here', by })
    } else {
      res = await setOrderPieceInStock(need.orderId, piece)
    }
    setBusyKey(null)
    if (!res.ok) { setBanner({ kind: 'err', text: `Could not mark it: ${res.error}` }); return }
    setWalk(w => { const n = new Set(w); n.delete(need.key); writeWalk(n); return n })
    setBanner({ kind: 'ok', text: `${need.family}: ${need.kind === 'base' ? 'base' : 'stone'} marked as here.` })
    load()
  }, [load])

  const dismiss = useCallback(async (need) => {
    setBusyKey(need.key); setBanner(null)
    const by = await getCurrentStaffName().catch(() => null)
    const res = await dismissSmartMatch({ needKey: need.key, orderId: need.orderId, kind: need.kind, by })
    setBusyKey(null)
    if (!res.ok) { setBanner({ kind: 'err', text: `Could not dismiss: ${res.error}${/smart_match_dismissals/.test(res.error || '') ? ' — run migration 20261109_smart_match_dismissals.sql' : ''}` }); return }
    setWalk(w => { const n = new Set(w); n.delete(need.key); writeWalk(n); return n })
    load()
  }, [load])

  const restore = useCallback(async (need) => {
    setBusyKey(need.key); setBanner(null)
    const res = await undismissSmartMatch(need.key)
    setBusyKey(null)
    if (!res.ok) { setBanner({ kind: 'err', text: `Could not restore: ${res.error}` }); return }
    load()
  }, [load])

  const toggleWalk = useCallback((need) => {
    setWalk(w => { const n = new Set(w); if (n.has(need.key)) n.delete(need.key); else n.add(need.key); writeWalk(n); return n })
  }, [])

  // ── grouping ──────────────────────────────────────────────────────────────
  const groups = useMemo(() => {
    const exact = [], near = [], none = [], fulfilled = [], already = [], gone = []
    for (const r of results) {
      const h = here.get(r.need.orderId)
      const isHere = !!h && (r.need.kind === 'base' ? h.base : h.die)
      if (r.fulfilled) fulfilled.push(r)
      else if (dismissed.has(r.need.key)) gone.push({ ...r, dismissal: dismissed.get(r.need.key) })
      else if (isHere) already.push({ ...r, why: h.blasted ? 'blasted — the stone is here' : (h.why || 'marked in stock') })
      else if (r.best?.strength === 'exact') exact.push(r)
      else if (r.best?.strength === 'near') near.push(r)
      else none.push(r)
    }
    return { exact, near, none, fulfilled, already, gone }
  }, [results, here, dismissed])

  const walkItems = useMemo(() => {
    const byKey = new Map(results.map(r => [r.need.key, r]))
    return [...walk].map(k => byKey.get(k)).filter(r => r && r.best && !r.fulfilled && !dismissed.has(r.need.key))
  }, [walk, results, dismissed])

  const printWalk = useCallback(async () => {
    const by = await getCurrentStaffName().catch(() => null)
    const items = walkItems.map(r => ({
      family: r.need.family, orderNumber: r.need.orderNumber, kind: kindLabel(r.need), needSpec: r.need.spec,
      tag: tagOf(r.best.stock), where: yardStoneWhere(r.best.stock), yardSpec: yardStoneSpecLine(r.best.stock),
      strength: r.best.strength,
      otherTags: (r.candidates || []).filter(c => c.stock.id !== r.best.stock.id).map(c => tagOf(c.stock)).filter(Boolean).slice(0, 4),
    }))
    if (!openPrintSheet(buildSmartWalkHtml(items, { printedBy: by }))) setBanner({ kind: 'err', text: 'The browser blocked the print window — allow pop-ups for Stonebooks and try again.' })
  }, [walkItems])
  const clearWalk = () => { if (!walkItems.length || window.confirm('Clear the yard walk list?')) { setWalk(new Set()); writeWalk(new Set()) } }
  const addAllExact = () => setWalk(w => { const n = new Set(w); for (const r of groups.exact) n.add(r.need.key); writeWalk(n); return n })

  if (loading) return <div className="sb-empty">Matching open orders against the yard…</div>
  if (err) return <div className="sb-empty">Could not run Smart Matches.<br /><span className="ism-muted">{err}</span></div>
  if (results.length === 0) return (
    <div className="sb-empty">
      No open orders need a stone right now.<br />
      <span className="ism-muted">Scanned {counts.orders} active order(s) against {counts.stock} yard item(s).</span>
    </div>
  )

  const cardProps = { onAllocate: allocate, onHere: markHere, onDismiss: dismiss, onRestore: restore, onWalk: toggleWalk, walk, busyKey }

  return (
    <div className="ism">
      <style>{ISM_CSS}</style>

      {banner && <div className={`ism-banner ism-banner-${banner.kind}`}>{banner.text}</div>}
      {dismissErr && <div className="ism-banner ism-banner-warn">Dismissals are not saved yet — {dismissErr}. Run migration 20261109_smart_match_dismissals.sql.</div>}

      <div className="ism-summary">
        <span><strong>{groups.exact.length}</strong> exact</span>
        <span><strong>{groups.near.length}</strong> near</span>
        <span><strong>{groups.none.length}</strong> no match</span>
        <span><strong>{groups.fulfilled.length}</strong> allocated</span>
        <span className="ism-summary-dim"><strong>{groups.already.length}</strong> already here</span>
        {groups.gone.length > 0 && <span className="ism-summary-dim"><strong>{groups.gone.length}</strong> dismissed</span>}
        <span className="ism-summary-meta">{counts.orders} open orders · {counts.stock} yard items</span>
      </div>

      {/* YARD WALK LIST — sticky strip */}
      <div className={`ism-walk ${walkItems.length ? 'ism-walk-on' : ''}`}>
        <div className="ism-walk-main">
          <span className="ism-walk-title">Yard walk list</span>
          <span className="ism-walk-count">{walkItems.length}</span>
          <span className="ism-walk-hint">
            {walkItems.length
              ? walkItems.slice(0, 8).map(r => `${r.need.family}${tagOf(r.best.stock) ? ` #${tagOf(r.best.stock)}` : ''}`).join(' · ') + (walkItems.length > 8 ? ` · +${walkItems.length - 8} more` : '')
              : 'Add matches below, print the list, walk the yard and confirm each stone is real and free.'}
          </span>
        </div>
        <div className="ism-walk-actions">
          {groups.exact.length > 0 && <button type="button" className="ism-btn ism-btn-quiet" onClick={addAllExact}>Add all exact</button>}
          <button type="button" className="ism-btn ism-btn-go" disabled={!walkItems.length} onClick={printWalk}>Print walk list</button>
          <button type="button" className="ism-btn ism-btn-quiet" disabled={!walkItems.length} onClick={clearWalk}>Clear</button>
        </div>
      </div>

      <Group title="Exact matches" tone="exact" rows={groups.exact} hint="In the yard by number — put it on the walk list, confirm it, then allocate." {...cardProps} />
      <Group title="Near matches" tone="near" rows={groups.near} hint="One dimension off — check the difference on the walk." {...cardProps} />
      <Group title="No match in the yard" tone="none" rows={groups.none} hint="Nothing comparable on hand — order it, or mark it already here." {...cardProps} />
      <Group title="Allocated" tone="fulfilled" rows={groups.fulfilled} hint="Reserved from the yard — release in the Yard view." {...cardProps} />

      {groups.already.length > 0 && (
        <Folded title="Already here" count={groups.already.length} open={openHere} onToggle={() => setOpenHere(o => !o)}
          hint="Blasted, received or marked in stock — the stone is here, so these stay off the list.">
          <Group tone="already" rows={groups.already} {...cardProps} bare />
        </Folded>
      )}
      {groups.gone.length > 0 && (
        <Folded title="Dismissed" count={groups.gone.length} open={openDismissed} onToggle={() => setOpenDismissed(o => !o)}
          hint="Hidden by hand. Restore puts the card back.">
          <Group tone="gone" rows={groups.gone} {...cardProps} bare />
        </Folded>
      )}
    </div>
  )
}

function Folded({ title, count, hint, open, onToggle, children }) {
  return (
    <div className="ism-group">
      <button type="button" className="ism-group-head ism-group-folded" onClick={onToggle}>
        <span className="ism-group-title">{title}</span>
        <span className="ism-group-count">{count}</span>
        <span className="ism-group-hint">{hint}</span>
        <span className="ism-fold-caret">{open ? 'Hide' : 'Show'}</span>
      </button>
      {open && children}
    </div>
  )
}

function Group({ title, tone, rows, hint, bare = false, ...cardProps }) {
  if (!rows.length) return null
  return (
    <div className="ism-group">
      {!bare && (
        <div className={`ism-group-head ism-group-${tone}`}>
          <span className="ism-group-title">{title}</span>
          <span className="ism-group-count">{rows.length}</span>
          <span className="ism-group-hint">{hint}</span>
        </div>
      )}
      <div className="ism-cards">
        {rows.map(r => <MatchCard key={r.need.key} r={r} tone={tone} {...cardProps} />)}
      </div>
    </div>
  )
}

function MatchCard({ r, tone, onAllocate, onHere, onDismiss, onRestore, onWalk, walk, busyKey }) {
  const { need, best, candidates = [] } = r
  const busy = busyKey === need.key
  const live = tone === 'exact' || tone === 'near' || tone === 'none'
  const canAllocate = !!best && (tone === 'exact' || tone === 'near')
  const onWalkList = walk.has(need.key)
  const tag = best ? tagOf(best.stock) : null
  const others = candidates.filter(c => best && c.stock.id !== best.stock.id)
  return (
    <div className={`ism-card ism-card-${tone}`}>
      <div className="ism-card-top">
        <span className="ism-family">{need.family}</span>
        {need.orderNumber && <span className="ism-ordnum">{need.orderNumber}</span>}
        <span className="ism-kind">{kindLabel(need)}</span>
      </div>

      <div className="ism-need">
        <span className="ism-label">Needs</span>
        <span className="ism-spec">{need.spec || '—'}</span>
      </div>

      {best ? (
        <div className="ism-found">
          <span className="ism-label">{tone === 'fulfilled' ? 'Got' : 'Found'}</span>
          <span className="ism-found-body">
            <span className="ism-found-line">
              <span className={`ism-tag ${tag ? '' : 'ism-tag-none'}`}>{tag ? `#${tag}` : 'no number'}</span>
              <span className="ism-found-spec">{[titleCase(best.stock.item_type), yardStoneSpecLine(best.stock)].filter(Boolean).join(' · ')}</span>
            </span>
            <span className="ism-found-loc">{yardStoneWhere(best.stock) || 'location not set'}{(best.stock.quantity || 1) > 1 ? ` · qty ${best.stock.quantity}` : ''}</span>
            {others.length > 0 && tone !== 'fulfilled' && (
              <span className="ism-more">
                also in the yard: {others.slice(0, 5).map(c => tagOf(c.stock) ? `#${tagOf(c.stock)}` : (c.stock.size || 'untagged')).join(' · ')}{others.length > 5 ? ` · +${others.length - 5} more` : ''}
              </span>
            )}
          </span>
        </div>
      ) : (
        <div className="ism-found ism-found-none">Nothing comparable in the yard.</div>
      )}

      {best && best.why?.length > 0 && <div className="ism-why">{best.why.join(' · ')}</div>}
      {tone === 'already' && <div className="ism-note">{r.why}</div>}
      {tone === 'gone' && <div className="ism-note">Dismissed{r.dismissal?.dismissed_by ? ` by ${r.dismissal.dismissed_by}` : ''}{r.dismissal?.reason ? ` — ${r.dismissal.reason}` : ''}</div>}

      <div className="ism-actions">
        {tone === 'fulfilled' && <span className="ism-allocated-tag">Allocated to {need.family}</span>}
        {tone === 'gone' && <button type="button" className="ism-btn ism-btn-quiet" disabled={busy} onClick={() => onRestore(need)}>{busy ? 'Restoring…' : 'Restore'}</button>}
        {live && (
          <>
            {canAllocate
              ? <button type="button" className="ism-btn ism-btn-go" disabled={busy} onClick={() => onAllocate(need, best)}>{busy ? 'Allocating…' : 'Allocate'}</button>
              : <button type="button" className="ism-btn" disabled title="Nothing in the yard to allocate">Allocate</button>}
            {canAllocate && (
              <button type="button" className={`ism-btn ism-btn-walk ${onWalkList ? 'on' : ''}`} onClick={() => onWalk(need)}>
                {onWalkList ? 'On walk list' : '+ Walk list'}
              </button>
            )}
            <span className="ism-actions-spacer" />
            <button type="button" className="ism-btn ism-btn-quiet" disabled={busy} title="The stone is already matched or has arrived — mark it in stock and drop it from this list" onClick={() => onHere(need)}>Already here</button>
            <button type="button" className="ism-btn ism-btn-quiet" disabled={busy} title="Hide this card (restore under Dismissed)" onClick={() => onDismiss(need)}>Dismiss</button>
          </>
        )}
      </div>
    </div>
  )
}

const ISM_CSS = `
  .ism-muted { color: var(--sb-text-muted, #8a7f6c); font-size: 13px; }
  .ism-banner { padding: 10px 14px; border-radius: 9px; font-size: 13.5px; font-weight: 600; margin-bottom: 14px; overflow-wrap: anywhere; }
  .ism-banner-ok { background: #e7f3ea; color: #1f7a3d; }
  .ism-banner-err { background: #fdeced; color: #b3261e; }
  .ism-banner-warn { background: #fbf1df; color: #7a5e16; font-weight: 500; }
  .ism-summary { display: flex; gap: 18px; align-items: center; font-size: 14px; color: var(--sb-text, #2a2a2a); margin-bottom: 14px; flex-wrap: wrap; }
  .ism-summary strong { font-size: 18px; font-variant-numeric: tabular-nums; }
  .ism-summary-dim { color: var(--sb-text-muted, #8a7f6c); }
  .ism-summary-dim strong { font-size: 15px; }
  .ism-summary-meta { margin-left: auto; font-size: 12px; color: var(--sb-text-muted, #8a7f6c); }

  .ism-walk { position: sticky; top: 0; z-index: 5; display: flex; align-items: center; gap: 14px; flex-wrap: wrap; background: var(--sb-surface, #fff); border: 1px solid var(--sb-border, #e4e0d4); border-left: 4px solid #b8b2a4; border-radius: 10px; padding: 10px 14px; margin-bottom: 18px; box-shadow: 0 6px 18px rgba(15,20,25,.06); }
  .ism-walk-on { border-left-color: #9A7209; }
  .ism-walk-main { display: flex; align-items: center; gap: 10px; flex: 1 1 320px; min-width: 0; }
  .ism-walk-title { font-size: 13px; font-weight: 700; white-space: nowrap; }
  .ism-walk-count { font-size: 12px; font-weight: 700; background: #9A7209; color: #fff; border-radius: 999px; padding: 1px 9px; }
  .ism-walk-hint { font-size: 12.5px; color: var(--sb-text-muted, #6b6256); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ism-walk-actions { display: flex; gap: 8px; flex-wrap: wrap; }

  .ism-group { margin-bottom: 22px; }
  .ism-group-head { display: flex; align-items: center; gap: 10px; padding: 7px 12px; border-radius: 8px; margin-bottom: 12px; min-width: 0; }
  .ism-group-folded { width: 100%; border: 1px solid var(--sb-border, #e4e0d4); background: var(--sb-surface-muted, #faf8f3); font: inherit; text-align: left; cursor: pointer; }
  .ism-group-folded:hover { border-color: #9A7209; }
  .ism-fold-caret { margin-left: auto; font-size: 12px; color: #9A7209; font-weight: 600; }
  .ism-group-exact { background: #e7f3ea; }
  .ism-group-near  { background: #fbf1df; }
  .ism-group-none  { background: #f2efe9; }
  .ism-group-fulfilled { background: #e8eef6; }
  .ism-group-title { font-size: 13px; font-weight: 700; color: var(--sb-text, #2a2a2a); white-space: nowrap; }
  .ism-group-count { font-size: 12px; font-weight: 700; background: rgba(0,0,0,0.08); border-radius: 999px; padding: 1px 9px; }
  .ism-group-hint { font-size: 12px; color: var(--sb-text-muted, #6b6256); margin-left: 4px; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  .ism-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); gap: 14px; }
  .ism-card { background: var(--sb-surface, #fff); border: 1px solid var(--sb-border, #e4e0d4); border-radius: 12px; padding: 14px 16px; border-left-width: 4px; min-width: 0; }
  .ism-card-exact { border-left-color: #1f7a3d; }
  .ism-card-near  { border-left-color: #c9962a; }
  .ism-card-none  { border-left-color: #b8b2a4; }
  .ism-card-fulfilled { border-left-color: #4a6fa5; }
  .ism-card-already, .ism-card-gone { border-left-color: #cfc9bd; opacity: .8; }
  .ism-card-top { display: flex; align-items: baseline; gap: 8px; margin-bottom: 9px; min-width: 0; }
  .ism-family { font-size: 15px; font-weight: 700; color: var(--sb-text, #2a2a2a); min-width: 0; overflow-wrap: anywhere; }
  .ism-ordnum { font-size: 12px; color: var(--sb-text-muted, #8a7f6c); font-variant-numeric: tabular-nums; white-space: nowrap; }
  .ism-kind { margin-left: auto; font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: #6b5d3a; background: #f4efe4; padding: 2px 8px; border-radius: 999px; white-space: nowrap; }

  .ism-need, .ism-found { display: flex; gap: 8px; align-items: baseline; margin-bottom: 7px; min-width: 0; }
  .ism-label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--sb-text-muted, #9a8f78); flex: 0 0 42px; }
  .ism-spec { font-size: 13px; color: var(--sb-text, #2a2a2a); overflow-wrap: anywhere; }
  .ism-found-body { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
  .ism-found-line { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; min-width: 0; }
  .ism-tag { font-family: 'JetBrains Mono', ui-monospace, Menlo, monospace; font-size: 17px; font-weight: 700; color: var(--sb-text, #111); letter-spacing: .02em; white-space: nowrap; }
  .ism-tag-none { font-size: 12px; font-weight: 500; color: var(--sb-text-muted, #8a7f6c); font-style: italic; font-family: inherit; }
  .ism-found-spec { font-size: 13px; font-weight: 600; color: var(--sb-text, #2a2a2a); overflow-wrap: anywhere; }
  .ism-found-loc { font-size: 12px; color: #6b5d3a; overflow-wrap: anywhere; }
  .ism-more { font-size: 11.5px; color: var(--sb-text-muted, #8a7f6c); overflow-wrap: anywhere; }
  .ism-found-none { font-size: 12.5px; color: var(--sb-text-muted, #8a7f6c); font-style: italic; }
  .ism-why { font-size: 12px; color: #9A7209; background: #fbf1df; border-radius: 6px; padding: 4px 9px; margin: 2px 0 8px; overflow-wrap: anywhere; }
  .ism-note { font-size: 12px; color: var(--sb-text-muted, #8a7f6c); margin: 2px 0 8px; overflow-wrap: anywhere; }

  .ism-actions { display: flex; align-items: center; gap: 6px; margin-top: 6px; flex-wrap: wrap; }
  .ism-actions-spacer { flex: 1; }
  .ism-btn { font: inherit; font-size: 12.5px; font-weight: 600; padding: 6px 11px; border-radius: 8px; border: 1px solid var(--sb-border, #d8d2c4); background: var(--sb-surface-muted, #faf8f3); color: #8a8276; cursor: not-allowed; white-space: nowrap; }
  .ism-btn-go { background: #1f7a3d; border-color: #1f7a3d; color: #fff; cursor: pointer; }
  .ism-btn-go:hover:not(:disabled) { background: #1a6a35; }
  .ism-btn-go:disabled { opacity: 0.6; cursor: default; }
  .ism-btn-walk { background: var(--sb-surface, #fff); color: #9A7209; border-color: #9A7209; cursor: pointer; }
  .ism-btn-walk:hover { background: #fbf1df; }
  .ism-btn-walk.on { background: #9A7209; color: #fff; }
  .ism-btn-quiet { background: var(--sb-surface, #fff); color: var(--sb-text-muted, #6b6256); cursor: pointer; font-weight: 500; }
  .ism-btn-quiet:hover:not(:disabled) { color: var(--sb-text, #2a2a2a); border-color: #9A7209; }
  .ism-btn-quiet:disabled { opacity: .5; cursor: default; }
  .ism-allocated-tag { font-size: 12.5px; font-weight: 700; color: #4a6fa5; }
`
