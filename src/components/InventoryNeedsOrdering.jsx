// =============================================================================
// InventoryNeedsOrdering — the "what do I need to order?" command surface.
// =============================================================================
// Resolves every active order's physical needs (stone/base via the matcher,
// photo-*/laser-* from addOns), subtracts what's covered (exact yard match, already
// allocated, or already on an open PR), and shows the REMAINING must-order queue
// grouped by type — each with a Build PR / Allocate / Open-order action.
// Read + orchestration: it triggers the existing Build-PR + allocate flows; the only
// writes are the ones those flows already do.
// =============================================================================

import { useState, useEffect, useCallback, useMemo } from 'react'
import { rowToOrder } from '../SalesMode'
import { getActiveStoneOrders, getInventoryStock, listOpenPRCoverage, getStoneProgressByOrder, reconcileMarkStoneStatus } from '../lib/stonebooksData'
import { resolveStoneNeeds, matchNeedsToStock } from '../lib/inventoryMatch'
import { prLineFromNeed } from '../lib/prKinds'
import StonePRBuilder from './StonePRBuilder'

const titleCase = (s) => String(s || '').replace(/\b\w/g, c => c.toUpperCase())
const normTxt = (v) => String(v ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')
const fmtDate = (d) => { if (!d) return null; const dt = new Date(String(d).slice(0, 10) + 'T00:00:00'); return isNaN(dt) ? String(d) : dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) }

function familyOf(row) {
  if (row.primary_lastname && String(row.primary_lastname).trim()) return String(row.primary_lastname).trim()
  if (Array.isArray(row.deceased)) {
    const d = row.deceased.find(x => x && !x.isReserved && (x.lastName || x.firstName))
    if (d) return [d.lastName, d.firstName].filter(Boolean).join(', ')
  }
  return row.order_number || 'Order'
}

// ── Tolerant PR coverage (Paul 2026-07-28: "IF A FAMILY NAME IS ON THE
// PROCUREMENT LIST REMOVE IT FROM NEEDS ORDERING, VERIFY THE FAMILY NAME AND
// THE DIE AND BASE MATCH — JUST THE NUMBERS MAY NOT ALWAYS BE WRITTEN
// PERFECT"). Sizes compare in inches with trade notation parsed ("2-6" = 30)
// and a 2″ per-dim tolerance on the first two dims; the line's Type column
// tells die-ish from base when the size can't be parsed.
const dimsIn = (s) => String(s ?? '').toLowerCase().replace(/×/g, 'x').split('x').map(d => {
  const m = String(d).match(/(\d+)\s*-\s*(\d+)/)
  if (m) return parseInt(m[1], 10) * 12 + parseInt(m[2], 10)
  const n = parseInt(String(d).replace(/[^\d]/g, ''), 10)
  return Number.isFinite(n) ? n : null
}).filter(v => v != null)
const sizesClose = (a, b) => {
  const A = dimsIn(a), B = dimsIn(b)
  if (!A.length || !B.length) return false
  const n = Math.min(A.length, B.length, 2)
  for (let i = 0; i < n; i++) { if (Math.abs(A[i] - B[i]) > 2) return false }
  return true
}
const lineClass = (it) => {
  const t = normTxt(it.item_type)
  if (!t) return null
  if (t.includes('base')) return 'base'
  if (t.includes('backer')) return 'backer'
  if (/(die|slant|upright|marker|grass|hickey|bevel|ledger|stone|monument)/.test(t)) return 'stone'
  return null
}
const colorLoose = (a, b) => {
  const na = normTxt(a).replace(/grey/g, 'gray'), nb = normTxt(b).replace(/grey/g, 'gray')
  if (!na || !nb) return true            // blank on either side = don't block on color
  return na === nb || na.includes(nb) || nb.includes(na)
}
function coveredByPR(need, prItems) {
  // Order-linked line = that order is being handled.
  let m = prItems.find(it => it.order_id && need.orderId && it.order_id === need.orderId)
  if (m) return m.po_number || 'a PR'
  // Family-name match, numbers tolerant: same family AND the line looks like
  // the same PIECE (type matches the need, or the size is close).
  m = prItems.find(it => {
    if (it.is_stock) return false
    if (!normTxt(it.family_name) || normTxt(it.family_name) !== normTxt(need.family)) return false
    if (!colorLoose(it.color, need.color)) return false
    const cls = lineClass(it)
    if (cls === need.kind) return !dimsIn(it.size).length || sizesClose(it.size, need.size)
    if (cls === null) return sizesClose(it.size, need.size)
    return false
  })
  return m ? (m.po_number || 'a PR') : null
}
// spec_text is left unset on creation — the print view resolves the die/base spec
// LIVE from the linked order (so it always matches the contract). spec_text is
// reserved for manual wording overrides made later in the PR editor. need_key keeps
// die + base of the same order as distinct addable lines.
const lineFromNeed = (n) => ({ family_name: n.family, order_id: n.orderId, color: n.color, size: n.size, top: n.top, sides: n.sides, need_key: n.key, quantity: 1 })
const sortNeeds = (arr) => arr.slice().sort((a, b) =>
  (b.rush ? 1 : 0) - (a.rush ? 1 : 0) ||
  String(a.neededBy || '9999-99-99').localeCompare(String(b.neededBy || '9999-99-99')) ||
  String(a.family).localeCompare(String(b.family)))

export default function InventoryNeedsOrdering({ onOpenMatches, onOpenOrder }) {
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState(null)
  const [data, setData] = useState(null)
  const [builderLines, setBuilderLines] = useState(null)
  const [builderKind, setBuilderKind] = useState('stone')
  const openBuilder = (kind, lines) => { setBuilderKind(kind); setBuilderLines(lines) }

  const load = useCallback(async () => {
    try {
      const [ordRes, stockRes, covRes] = await Promise.all([getActiveStoneOrders(), getInventoryStock(), listOpenPRCoverage()])
      const prItems = covRes.items || []
      const nowMs = Date.now()
      const orderMeta = {}
      const orders = (ordRes.rows || []).map(r => {
        const o = rowToOrder(r, null, null); o.family = familyOf(r)
        // Age of the order — signed date first (created as fallback), the
        // same green/amber/red bands as the production age circles.
        const anchor = r.signed_at || r.created_at
        const ageDays = anchor ? Math.max(0, Math.floor((nowMs - new Date(anchor).getTime()) / 86400000)) : null
        orderMeta[r.id] = {
          neededBy: r.target_completion_date || null, rush: !!r.rush_order,
          ageDays, ageTone: ageDays == null ? null : ageDays < 60 ? 'green' : ageDays < 150 ? 'amber' : 'red',
        }
        return o
      })
      const stock = stockRes.rows || []
      // Orders whose stone is already marked ordered / received / in stock on
      // the ORDER — those needs are OFF this list (Paul's #1 complaint).
      const progress = await getStoneProgressByOrder(orders.map(o => o.id))
      const matched = matchNeedsToStock(resolveStoneNeeds(orders), stock)

      const stones = [], bronze = []
      let coveredYard = 0, coveredAlloc = 0, coveredPR = 0, coveredMarked = 0
      for (const m of matched) {
        const need = m.need
        const meta = orderMeta[need.orderId] || {}
        const row = { ...need, neededBy: meta.neededBy, rush: meta.rush, ageDays: meta.ageDays, ageTone: meta.ageTone, near: m.best?.strength === 'near' ? m.best : null }
        if (progress.has(need.orderId)) { coveredMarked++; continue }
        if (m.fulfilled) { coveredAlloc++; continue }
        const po = coveredByPR(need, prItems)
        if (po) { coveredPR++; continue }
        if (m.best?.strength === 'exact') { coveredYard++; continue }
        ;(need.itemType === 'bronze' ? bronze : stones).push(row)
      }

      // A photo/etching need is covered when an OPEN PR of THAT kind already carries
      // a line for the same order + size (+ photo type). Drops it off the list after
      // a PR is built, the same way stone needs fall off when on a PR.
      const onKindPR = (need, kind, withType) => prItems.some(it =>
        it.pr_kind === kind && it.order_id && need.orderId && it.order_id === need.orderId
        && normTxt(it.size) === normTxt(need.size)
        && (!withType || normTxt(it.top) === normTxt(need.type)))

      const photos = [], etchings = []
      for (const o of orders) {
        const meta = orderMeta[o.id] || {}
        for (const a of (Array.isArray(o.addOns) ? o.addOns : [])) {
          const code = String(a.code || '')
          if (code.startsWith('photo-')) {
            const p = code.split('-')
            const need = { key: `${o.id}:${code}`, orderId: o.id, orderNumber: o.orderNumber, family: o.family, neededBy: meta.neededBy, rush: meta.rush, spec: a.label || code, type: a.type || p[1] || 'photo', size: a.size || p[2] || '', qty: Math.max(1, Number(a.qty) || 1), hasImage: !!(a.customerPhotoUrl || a.customerPhotoPath) }
            if (onKindPR(need, 'photo', true)) coveredPR++; else photos.push(need)
          } else if (code.startsWith('laser-')) {
            const p = code.split('-')
            const need = { key: `${o.id}:${code}`, orderId: o.id, orderNumber: o.orderNumber, family: o.family, neededBy: meta.neededBy, rush: meta.rush, spec: a.label || code, size: a.size || p[1] || '', qty: Math.max(1, Number(a.qty) || 1) }
            if (onKindPR(need, 'etching', false)) coveredPR++; else etchings.push(need)
          }
        }
      }

      setData({
        stones: sortNeeds(stones), bronze: sortNeeds(bronze), photos: sortNeeds(photos), etchings: sortNeeds(etchings),
        covered: { yard: coveredYard, alloc: coveredAlloc, pr: coveredPR, marked: coveredMarked },
        scanned: orders.length,
      })
      setErr((!ordRes.ok && !stockRes.ok) ? (ordRes.error || stockRes.error) : null)
    } catch (e) { setErr(String(e?.message || e)); setData(null) }
    setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  // Search (Paul 2026-07-28: "i cant even search in needs ordering").
  const [q, setQ] = useState('')
  const matchQ = useCallback((r) => {
    const needle = q.trim().toLowerCase()
    if (!needle) return true
    return [r.family, r.orderNumber, r.spec, r.color, r.size].filter(Boolean).join(' ').toLowerCase().includes(needle)
  }, [q])

  // Multi-select → one status change for every picked family (stones + bronze).
  const [sel, setSel] = useState(() => new Set())
  const [bulkBusy, setBulkBusy] = useState(false)
  const [bulkErr, setBulkErr] = useState(null)
  const toggleSel = (key) => setSel(prev => {
    const n = new Set(prev)
    if (n.has(key)) n.delete(key); else n.add(key)
    return n
  })
  const selRows = useMemo(() => data ? [...data.stones, ...data.bronze].filter(r => sel.has(r.key)) : [], [data, sel])
  const bulkStatus = async (code, label) => {
    if (!selRows.length || bulkBusy) return
    setBulkBusy(true); setBulkErr(null)
    const orderIds = [...new Set(selRows.map(r => r.orderId).filter(Boolean))]
    const failed = []
    for (const oid of orderIds) {
      const r = await reconcileMarkStoneStatus(oid, code)
      if (!r?.ok) failed.push(r?.error || 'failed')
    }
    setBulkBusy(false)
    setSel(new Set())
    if (failed.length) setBulkErr(`${failed.length} of ${orderIds.length} could not be marked ${label} — ${failed[0]}`)
    load()
  }

  const mustOrderCount = useMemo(() => data ? data.stones.length + data.bronze.length + data.photos.length + data.etchings.length : 0, [data])

  if (loading) return <div className="sb-empty">Working out what needs ordering…</div>
  if (err) return <div className="sb-empty">Couldn’t build the queue.<br /><span className="ino-muted">{err}</span></div>

  const c = data.covered
  const fStones = data.stones.filter(matchQ)
  const fBronze = data.bronze.filter(matchQ)
  const fPhotos = data.photos.filter(matchQ)
  const fEtchings = data.etchings.filter(matchQ)
  return (
    <div className="ino">
      <style>{INO_CSS}</style>

      <div className="ino-summary">
        <span className="ino-sum-big">{mustOrderCount}</span><span className="ino-sum-lab">need ordering</span>
        <span className="ino-sum-sep" />
        <span className="ino-covered">Covered: {c.marked} marked on the order · {c.pr} on a PR · {c.yard} in yard · {c.alloc} allocated</span>
        <span className="ino-summary-meta">{data.scanned} active orders</span>
      </div>

      <div className="ino-toolbar">
        <input className="ino-search" value={q} onChange={e => setQ(e.target.value)}
          placeholder="Search by family, order number, size, color…" />
        <span className="ino-agekey">
          Age of order: <i className="ino-dot ino-dot-green" /> under 60d <i className="ino-dot ino-dot-amber" /> 60–150d <i className="ino-dot ino-dot-red" /> 150d+
        </span>
      </div>

      {sel.size > 0 && (
        <div className="ino-bulkbar">
          <b>{sel.size} selected</b>
          <span className="ino-bulk-hint">— sets the stone status on each family's order, then they drop off this list</span>
          <button type="button" className="ino-bulk-act" disabled={bulkBusy} onClick={() => bulkStatus('ordered', 'ordered')}>Mark ordered</button>
          <button type="button" className="ino-bulk-act" disabled={bulkBusy} onClick={() => bulkStatus('in_stock', 'in stock')}>Mark in stock</button>
          <button type="button" className="ino-bulk-act" disabled={bulkBusy} onClick={() => bulkStatus('needs_stencil_cut', 'received')}>Mark received</button>
          <button type="button" className="ino-bulk-clear" disabled={bulkBusy} onClick={() => setSel(new Set())}>Clear</button>
          {bulkBusy && <span className="ino-muted">Working…</span>}
        </div>
      )}
      {bulkErr && <div className="ino-bulkerr">{bulkErr}</div>}

      {mustOrderCount === 0 ? (
        <div className="sb-empty">✓ Nothing needs ordering — every open order’s needs are marked on the order, on a PR, in the yard, or allocated.</div>
      ) : (
        <>
          <Group title="Stones" tone="stone" rows={fStones}
            onBuildAll={fStones.length ? () => openBuilder('stone', fStones.map(lineFromNeed)) : null}
            onBuildRow={(r) => openBuilder('stone', [lineFromNeed(r)])}
            onAllocate={onOpenMatches} onOpenOrder={onOpenOrder}
            sel={sel} onToggleSel={toggleSel} />

          <Group title="Bronze" tone="bronze" rows={fBronze}
            buildDisabledLabel="Bronze PR — coming soon" onAllocate={onOpenMatches} onOpenOrder={onOpenOrder}
            sel={sel} onToggleSel={toggleSel} />

          <PhotoGroup rows={fPhotos} onOpenOrder={onOpenOrder}
            onBuildAll={fPhotos.length ? () => openBuilder('photo', fPhotos.map(n => prLineFromNeed('photo', n))) : null}
            onBuildRow={(r) => openBuilder('photo', [prLineFromNeed('photo', r)])} />

          <SimpleGroup title="Etchings" tone="etch" rows={fEtchings} specOf={(r) => `${r.spec}${r.size ? ` · ${String(r.size).toUpperCase()}` : ''}`}
            onOpenOrder={onOpenOrder}
            onBuildAll={fEtchings.length ? () => openBuilder('etching', fEtchings.map(n => prLineFromNeed('etching', n))) : null}
            onBuildRow={(r) => openBuilder('etching', [prLineFromNeed('etching', r)])} />

          {q.trim() && fStones.length + fBronze.length + fPhotos.length + fEtchings.length === 0 && (
            <div className="sb-empty">Nothing matches “{q.trim()}”.</div>
          )}
        </>
      )}

      {builderLines && (
        <StonePRBuilder kind={builderKind} prefillLines={builderLines} onClose={() => setBuilderLines(null)} onSaved={() => { setBuilderLines(null); load() }} />
      )}
    </div>
  )
}

function RowMeta({ r }) {
  return (
    <span className="ino-meta">
      {r.ageDays != null && (
        <span className={`ino-age ino-age-${r.ageTone}`} title={`Order is ${r.ageDays} days old`}>
          <i className={`ino-dot ino-dot-${r.ageTone}`} />{r.ageDays}d
        </span>
      )}
      {r.orderNumber && <span className="ino-ord">{r.orderNumber}</span>}
      {r.rush && <span className="ino-tag ino-tag-rush">RUSH</span>}
      {r.neededBy && <span className="ino-need-by">by {fmtDate(r.neededBy)}</span>}
    </span>
  )
}

function Group({ title, tone, rows, onBuildAll, onBuildRow, onAllocate, onOpenOrder, buildDisabledLabel, sel, onToggleSel }) {
  if (!rows.length) return null
  return (
    <section className="ino-group">
      <div className={`ino-group-head ino-head-${tone}`}>
        <span className="ino-group-title">{title}</span>
        <span className="ino-group-count">{rows.length}</span>
        {onBuildAll && <button type="button" className="ino-build-all" onClick={onBuildAll}>Build PR for all {rows.length} →</button>}
        {buildDisabledLabel && <span className="ino-soon">{buildDisabledLabel}</span>}
      </div>
      <div className="ino-rows">
        {rows.map(r => (
          <div key={r.key} className={`ino-row ${r.rush ? 'ino-row-rush' : ''}${sel?.has(r.key) ? ' ino-row-sel' : ''}`}>
            <div className="ino-row-main">
              {onToggleSel && (
                <input type="checkbox" className="ino-check" checked={!!sel?.has(r.key)} onChange={() => onToggleSel(r.key)}
                  title="Select — then mark the whole batch ordered / in stock / received" />
              )}
              <span className="ino-fam">{r.family}</span>
              <RowMeta r={r} />
              <span className="ino-spec">{r.spec}</span>
              {r.near && <span className="ino-near">near match in yard{r.near.why?.length ? ` (${r.near.why[0]})` : ''}</span>}
            </div>
            <div className="ino-row-actions">
              {onBuildRow && <button type="button" className="ino-act ino-act-go" onClick={() => onBuildRow(r)}>Build PR</button>}
              {r.near && onAllocate && <button type="button" className="ino-act" onClick={onAllocate}>Allocate from yard</button>}
              {onOpenOrder && r.orderId && <button type="button" className="ino-act ino-act-link" onClick={() => onOpenOrder(r.orderId)}>Open order</button>}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

function PhotoGroup({ rows, onOpenOrder, onBuildAll, onBuildRow }) {
  if (!rows.length) return null
  return (
    <section className="ino-group">
      <div className="ino-group-head ino-head-photo">
        <span className="ino-group-title">Photos</span>
        <span className="ino-group-count">{rows.length}</span>
        {onBuildAll && <button type="button" className="ino-build-all" onClick={onBuildAll}>Build PR for all {rows.length} →</button>}
      </div>
      <div className="ino-rows">
        {rows.map(r => (
          <div key={r.key} className={`ino-row ${r.rush ? 'ino-row-rush' : ''}`}>
            <div className="ino-row-main">
              <span className="ino-fam">{r.family}</span>
              <RowMeta r={r} />
              <span className="ino-spec">{titleCase(r.type)}{r.size ? ` · ${String(r.size).toUpperCase()}` : ''}{r.qty > 1 ? ` · qty ${r.qty}` : ''}</span>
              {r.hasImage
                ? <span className="ino-ok">image on file</span>
                : <span className="ino-warn">missing photo — needed before ordering</span>}
            </div>
            <div className="ino-row-actions">
              {onBuildRow && <button type="button" className="ino-act ino-act-go" onClick={() => onBuildRow(r)}>Build PR</button>}
              {onOpenOrder && r.orderId && <button type="button" className="ino-act ino-act-link" onClick={() => onOpenOrder(r.orderId)}>Open order</button>}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

function SimpleGroup({ title, tone, rows, specOf, buildDisabledLabel, onOpenOrder, onBuildAll, onBuildRow }) {
  if (!rows.length) return null
  return (
    <section className="ino-group">
      <div className={`ino-group-head ino-head-${tone}`}>
        <span className="ino-group-title">{title}</span>
        <span className="ino-group-count">{rows.length}</span>
        {onBuildAll && <button type="button" className="ino-build-all" onClick={onBuildAll}>Build PR for all {rows.length} →</button>}
        {buildDisabledLabel && <span className="ino-soon">{buildDisabledLabel}</span>}
      </div>
      <div className="ino-rows">
        {rows.map(r => (
          <div key={r.key} className={`ino-row ${r.rush ? 'ino-row-rush' : ''}`}>
            <div className="ino-row-main">
              <span className="ino-fam">{r.family}</span>
              <RowMeta r={r} />
              <span className="ino-spec">{specOf(r)}</span>
            </div>
            <div className="ino-row-actions">
              {onBuildRow && <button type="button" className="ino-act ino-act-go" onClick={() => onBuildRow(r)}>Build PR</button>}
              {onOpenOrder && r.orderId && <button type="button" className="ino-act ino-act-link" onClick={() => onOpenOrder(r.orderId)}>Open order</button>}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

const INO_CSS = `
  .ino-muted { color: var(--sb-text-muted, #8a7f6c); font-size: 13px; }
  .ino-summary { display: flex; align-items: center; gap: 10px; margin-bottom: 20px; flex-wrap: wrap; }
  .ino-sum-big { font-size: 26px; font-weight: 800; color: var(--sb-text, #2a2a2a); font-variant-numeric: tabular-nums; }
  .ino-sum-lab { font-size: 13px; font-weight: 600; color: #b3261e; text-transform: uppercase; letter-spacing: 0.04em; }
  .ino-sum-sep { width: 1px; height: 22px; background: var(--sb-border, #e4e0d4); margin: 0 6px; }
  .ino-covered { font-size: 13px; color: var(--sb-text-muted, #6b6256); }
  .ino-summary-meta { margin-left: auto; font-size: 12px; color: var(--sb-text-muted, #8a7f6c); }

  .ino-toolbar { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; margin: -6px 0 14px; }
  .ino-search { flex: 1 1 280px; max-width: 420px; border: 1px solid var(--sb-border, #d8d2c4); border-radius: 9px; padding: 8px 12px; font: inherit; font-size: 13.5px; }
  .ino-search:focus { outline: none; border-color: #9A7209; }
  .ino-agekey { font-size: 11.5px; color: var(--sb-text-muted, #8a7f6c); display: inline-flex; align-items: center; gap: 5px; }
  .ino-dot { display: inline-block; width: 9px; height: 9px; border-radius: 50%; }
  .ino-dot-green { background: #1f7a3d; }
  .ino-dot-amber { background: #c9962a; }
  .ino-dot-red { background: #b3261e; }
  .ino-age { display: inline-flex; align-items: center; gap: 4px; font-size: 11.5px; font-weight: 700; font-variant-numeric: tabular-nums; }
  .ino-age-green { color: #1f7a3d; }
  .ino-age-amber { color: #a4770f; }
  .ino-age-red { color: #b3261e; }
  .ino-check { width: 16px; height: 16px; flex-shrink: 0; align-self: center; cursor: pointer; }
  .ino-row-sel { border-color: #9A7209; background: rgba(154,114,9,0.05); }
  .ino-bulkbar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; background: #16150F; color: #F4EBD4; border-radius: 10px; padding: 9px 14px; margin-bottom: 14px; font-size: 13px; }
  .ino-bulk-hint { color: #b3a890; font-size: 12px; }
  .ino-bulk-act { background: #C9A468; border: none; color: #16150F; font: 700 12.5px/1 inherit; padding: 7px 12px; border-radius: 7px; cursor: pointer; }
  .ino-bulk-act:disabled { opacity: 0.5; cursor: default; }
  .ino-bulk-clear { background: none; border: 1px solid #6B6456; color: #d8d2c4; font: 600 12px/1 inherit; padding: 6px 11px; border-radius: 7px; cursor: pointer; }
  .ino-bulkerr { background: rgba(179,38,30,0.08); color: #B3261E; font-size: 12.5px; border-radius: 8px; padding: 8px 10px; margin-bottom: 12px; }

  .ino-group { margin-bottom: 22px; }
  .ino-group-head { display: flex; align-items: center; gap: 10px; padding: 8px 13px; border-radius: 9px; margin-bottom: 10px; border-left: 4px solid; }
  .ino-head-stone { background: #f1ede4; border-left-color: #8a7340; }
  .ino-head-bronze { background: #f3ece2; border-left-color: #a6701f; }
  .ino-head-photo { background: #f3eef7; border-left-color: #8a5cc4; }
  .ino-head-etch { background: #eef2f6; border-left-color: #3f6ea5; }
  .ino-group-title { font-size: 14px; font-weight: 700; color: var(--sb-text, #2a2a2a); }
  .ino-group-count { font-size: 12px; font-weight: 700; background: rgba(0,0,0,0.08); border-radius: 999px; padding: 1px 9px; }
  .ino-build-all { margin-left: auto; background: #1f7a3d; border: none; color: #fff; font: inherit; font-size: 12.5px; font-weight: 600; padding: 5px 12px; border-radius: 7px; cursor: pointer; }
  .ino-build-all:hover { background: #1a6a35; }
  .ino-soon { margin-left: auto; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: #b3a890; }

  .ino-rows { display: flex; flex-direction: column; gap: 8px; }
  .ino-row { display: flex; align-items: center; justify-content: space-between; gap: 14px; background: var(--sb-surface, #fff); border: 1px solid var(--sb-border, #e4e0d4); border-radius: 10px; padding: 10px 14px; }
  .ino-row-rush { border-color: #e7b9b3; background: #fdf7f6; }
  .ino-row-main { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; min-width: 0; }
  .ino-fam { font-size: 14px; font-weight: 700; color: var(--sb-text, #2a2a2a); }
  .ino-meta { display: inline-flex; align-items: center; gap: 7px; }
  .ino-ord { font-size: 11.5px; color: var(--sb-text-muted, #8a7f6c); font-variant-numeric: tabular-nums; }
  .ino-tag-rush { font-size: 9.5px; font-weight: 700; background: #fae3e0; color: #b3261e; padding: 1px 7px; border-radius: 999px; }
  .ino-need-by { font-size: 11.5px; color: #9A7209; font-weight: 600; }
  .ino-spec { font-family: var(--font-m, 'JetBrains Mono'), monospace; font-size: 12px; color: #6b6256; }
  .ino-near { font-size: 11.5px; color: #c9962a; }
  .ino-warn { font-size: 11.5px; font-weight: 600; color: #b3261e; }
  .ino-ok { font-size: 11.5px; font-weight: 600; color: #1f7a3d; }
  .ino-row-actions { display: flex; gap: 8px; flex-shrink: 0; }
  .ino-act { font: inherit; font-size: 12.5px; font-weight: 600; padding: 5px 11px; border-radius: 7px; border: 1px solid var(--sb-border, #d8d2c4); background: var(--sb-surface, #fff); color: #6b5d3a; cursor: pointer; white-space: nowrap; }
  .ino-act-go { background: #1f7a3d; border-color: #1f7a3d; color: #fff; }
  .ino-act-go:hover { background: #1a6a35; }
  .ino-act-link { color: #9A7209; }
`
