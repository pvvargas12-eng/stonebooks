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
import { getActiveStoneOrders, getInventoryStock, listOpenPRCoverage } from '../lib/stonebooksData'
import { resolveStoneNeeds, matchNeedsToStock } from '../lib/inventoryMatch'
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
function coveredByPR(need, prItems) {
  let m = prItems.find(it => it.order_id && need.orderId && it.order_id === need.orderId)
  if (m) return m.po_number || 'a PR'
  m = prItems.find(it => normTxt(it.family_name) && normTxt(it.family_name) === normTxt(need.family) && normTxt(it.color) === normTxt(need.color) && normTxt(it.size) === normTxt(need.size))
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

  const load = useCallback(async () => {
    try {
      const [ordRes, stockRes, covRes] = await Promise.all([getActiveStoneOrders(), getInventoryStock(), listOpenPRCoverage()])
      const prItems = covRes.items || []
      const orderMeta = {}
      const orders = (ordRes.rows || []).map(r => {
        const o = rowToOrder(r, null, null); o.family = familyOf(r)
        orderMeta[r.id] = { neededBy: r.target_completion_date || null, rush: !!r.rush_order }
        return o
      })
      const stock = stockRes.rows || []
      const matched = matchNeedsToStock(resolveStoneNeeds(orders), stock)

      const stones = [], bronze = []
      let coveredYard = 0, coveredAlloc = 0, coveredPR = 0
      for (const m of matched) {
        const need = m.need
        const meta = orderMeta[need.orderId] || {}
        const row = { ...need, neededBy: meta.neededBy, rush: meta.rush, near: m.best?.strength === 'near' ? m.best : null }
        if (m.fulfilled) { coveredAlloc++; continue }
        const po = coveredByPR(need, prItems)
        if (po) { coveredPR++; continue }
        if (m.best?.strength === 'exact') { coveredYard++; continue }
        ;(need.itemType === 'bronze' ? bronze : stones).push(row)
      }

      const photos = [], etchings = []
      for (const o of orders) {
        const meta = orderMeta[o.id] || {}
        for (const a of (Array.isArray(o.addOns) ? o.addOns : [])) {
          const code = String(a.code || '')
          if (code.startsWith('photo-')) {
            const p = code.split('-')
            photos.push({ key: `${o.id}:${code}`, orderId: o.id, orderNumber: o.orderNumber, family: o.family, neededBy: meta.neededBy, rush: meta.rush, spec: a.label || code, type: a.type || p[1] || 'photo', size: a.size || p[2] || '', qty: Math.max(1, Number(a.qty) || 1), hasImage: !!(a.customerPhotoUrl || a.customerPhotoPath) })
          } else if (code.startsWith('laser-')) {
            const p = code.split('-')
            etchings.push({ key: `${o.id}:${code}`, orderId: o.id, orderNumber: o.orderNumber, family: o.family, neededBy: meta.neededBy, rush: meta.rush, spec: a.label || code, size: a.size || p[1] || '', qty: Math.max(1, Number(a.qty) || 1) })
          }
        }
      }

      setData({
        stones: sortNeeds(stones), bronze: sortNeeds(bronze), photos: sortNeeds(photos), etchings: sortNeeds(etchings),
        covered: { yard: coveredYard, alloc: coveredAlloc, pr: coveredPR },
        scanned: orders.length,
      })
      setErr((!ordRes.ok && !stockRes.ok) ? (ordRes.error || stockRes.error) : null)
    } catch (e) { setErr(String(e?.message || e)); setData(null) }
    setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  const mustOrderCount = useMemo(() => data ? data.stones.length + data.bronze.length + data.photos.length + data.etchings.length : 0, [data])

  if (loading) return <div className="sb-empty">Working out what needs ordering…</div>
  if (err) return <div className="sb-empty">Couldn’t build the queue.<br /><span className="ino-muted">{err}</span></div>

  const c = data.covered
  return (
    <div className="ino">
      <style>{INO_CSS}</style>

      <div className="ino-summary">
        <span className="ino-sum-big">{mustOrderCount}</span><span className="ino-sum-lab">need ordering</span>
        <span className="ino-sum-sep" />
        <span className="ino-covered">Covered: {c.yard} in yard · {c.alloc} allocated · {c.pr} on a PR</span>
        <span className="ino-summary-meta">{data.scanned} active orders</span>
      </div>

      {mustOrderCount === 0 ? (
        <div className="sb-empty">✓ Nothing needs ordering — every open order’s needs are in the yard, allocated, or already on a PR.</div>
      ) : (
        <>
          <Group title="Stones" tone="stone" rows={data.stones}
            onBuildAll={data.stones.length ? () => setBuilderLines(data.stones.map(lineFromNeed)) : null}
            onBuildRow={(r) => setBuilderLines([lineFromNeed(r)])}
            onAllocate={onOpenMatches} onOpenOrder={onOpenOrder} />

          <Group title="Bronze" tone="bronze" rows={data.bronze}
            buildDisabledLabel="Bronze PR — coming soon" onAllocate={onOpenMatches} onOpenOrder={onOpenOrder} />

          <PhotoGroup rows={data.photos} onOpenOrder={onOpenOrder} />

          <SimpleGroup title="Etchings" tone="etch" rows={data.etchings} specOf={(r) => `${r.spec}${r.size ? ` · ${String(r.size).toUpperCase()}` : ''}`}
            buildDisabledLabel="Etching PR — coming soon" onOpenOrder={onOpenOrder} />
        </>
      )}

      {builderLines && (
        <StonePRBuilder prefillLines={builderLines} onClose={() => setBuilderLines(null)} onSaved={() => { setBuilderLines(null); load() }} />
      )}
    </div>
  )
}

function RowMeta({ r }) {
  return (
    <span className="ino-meta">
      {r.orderNumber && <span className="ino-ord">{r.orderNumber}</span>}
      {r.rush && <span className="ino-tag ino-tag-rush">RUSH</span>}
      {r.neededBy && <span className="ino-need-by">by {fmtDate(r.neededBy)}</span>}
    </span>
  )
}

function Group({ title, tone, rows, onBuildAll, onBuildRow, onAllocate, onOpenOrder, buildDisabledLabel }) {
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

function PhotoGroup({ rows, onOpenOrder }) {
  if (!rows.length) return null
  return (
    <section className="ino-group">
      <div className="ino-group-head ino-head-photo">
        <span className="ino-group-title">Photos</span>
        <span className="ino-group-count">{rows.length}</span>
        <span className="ino-soon">Photo PR — coming soon</span>
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
              {onOpenOrder && r.orderId && <button type="button" className="ino-act ino-act-link" onClick={() => onOpenOrder(r.orderId)}>Open order</button>}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

function SimpleGroup({ title, tone, rows, specOf, buildDisabledLabel, onOpenOrder }) {
  if (!rows.length) return null
  return (
    <section className="ino-group">
      <div className={`ino-group-head ino-head-${tone}`}>
        <span className="ino-group-title">{title}</span>
        <span className="ino-group-count">{rows.length}</span>
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
