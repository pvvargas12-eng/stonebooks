// =============================================================================
// InventoryReconcile — PRs vs orders, differences surfaced, Paul decides.
// =============================================================================
// Paul's rule (2026-07-23): recorded/imported PRs must NEVER change order data
// by themselves. This tab shows every disagreement and he clicks:
//   1. PR says ordered, order says not      → Mark stone ordered / Disregard
//   2. PR line received, order not received → Mark stone received / Disregard
//   3. PR line with no matching order       → Link to an order / Disregard
//   4. Stock match — an order needs a stone that isn't here, but a STOCK stone
//      of that size is on an ordered PR     → informational / Disregard
// Fixes ride the SAME master-override stone ladder as every other surface
// (reconcileMarkStoneStatus); dismissals persist in pr_reconcile_dismissals.
// =============================================================================
import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  getPRReconcile, dismissPRReconcile, reconcileMarkStoneStatus,
  updateBulkOrderItem, getActiveStoneOrders, getCurrentStaffName,
  listStoneDeadlines, applyStoneDeadline, dismissStoneDeadline, listOpenOrdersLight,
} from '../lib/stonebooksData'
import { rowToOrder } from '../SalesMode'
import { resolveStoneNeeds, matchNeedsToStock } from '../lib/inventoryMatch'

const famOfRow = (r) => (r.primary_lastname && String(r.primary_lastname).trim()) || r.order_number || 'Order'
const lineLabel = (it) => [it.item_type, it.size, it.color].filter(Boolean).join(' · ') || it.spec_text || '—'

export default function InventoryReconcile({ onOpenOrder = null }) {
  const [data, setData] = useState(null)
  const [orders, setOrders] = useState(null)
  const [banner, setBanner] = useState(null)
  const [busyKey, setBusyKey] = useState(null)
  const [linkFor, setLinkFor] = useState(null)   // item id with the link picker open
  const [linkQ, setLinkQ] = useState('')

  const load = useCallback(async () => {
    const [r, o] = await Promise.all([
      getPRReconcile(),
      getActiveStoneOrders().catch(() => ({ rows: [] })),
    ])
    setData(r)
    setOrders(o.rows || [])
  }, [])
  useEffect(() => { load() }, [load])

  // Stock matches: open-order stone needs vs STOCK lines on ordered PRs, matched
  // with the SAME size/color/type comparators Smart Matches uses.
  const stockMatches = useMemo(() => {
    if (!data || !orders || !data.stockLines?.length) return []
    try {
      const mapped = orders.map(r => { const o = rowToOrder(r, null, null); o.family = famOfRow(r); return o })
      const needs = resolveStoneNeeds(mapped)
      const pseudoStock = data.stockLines.map(({ item, pr }) => ({
        id: item.id, item_type: item.item_type || 'custom', color: item.color, size: item.size,
        status: 'available', _pr: pr, _item: item,
      }))
      const dismissed = data.dismissedKeys || new Set()
      const out = []
      for (const m of matchNeedsToStock(needs, pseudoStock)) {
        if (!m.best || m.fulfilled) continue
        const s = m.best.stock
        const key = `stock:${m.need.orderId}:${m.need.kind}`
        if (dismissed.has(`${s.id}|${key}`)) continue
        out.push({ need: m.need, stockItem: s._item, pr: s._pr, strength: m.best.strength, dismissKey: key })
      }
      return out
    } catch { return [] }
  }, [data, orders])

  const linkResults = useMemo(() => {
    if (!orders || !linkQ.trim()) return []
    const t = linkQ.trim().toLowerCase()
    return orders.filter(o => `${o.primary_lastname || ''} ${o.order_number || ''}`.toLowerCase().includes(t)).slice(0, 10)
  }, [orders, linkQ])

  // Auto-suggested candidates per unmatched family (client-side, name contains).
  const candidatesFor = useCallback((fam) => {
    if (!orders) return []
    const t = String(fam || '').trim().toLowerCase()
    if (!t) return []
    return orders.filter(o => String(o.primary_lastname || '').toLowerCase().includes(t.split(',')[0].split(' ')[0])).slice(0, 4)
  }, [orders])

  const run = async (key, fn, okText) => {
    if (busyKey) return
    setBusyKey(key); setBanner(null)
    const r = await fn()
    setBusyKey(null)
    if (!r.ok) { setBanner({ kind: 'err', text: r.error || 'That change failed.' }); return }
    setBanner({ kind: 'ok', text: okText })
    load()
  }
  const disregard = async (itemId, checkKind, key) =>
    run(key, async () => dismissPRReconcile(itemId, checkKind, await getCurrentStaffName().catch(() => null)), 'Disregarded — it will not come back.')
  const markOrdered = (row) =>
    run(`o:${row.item.id}`, () => reconcileMarkStoneStatus(row.order.id, 'ordered'), `${famOfRow(row.order)} marked stone ordered.`)
  const markReceived = (row) =>
    run(`r:${row.item.id}`, () => reconcileMarkStoneStatus(row.order.id, 'needs_stencil_cut'), `${famOfRow(row.order)} marked stone received (needs stencil).`)
  const linkItem = (item, order) =>
    run(`l:${item.id}`, () => updateBulkOrderItem(item.id, { order_id: order.id, family_name: item.family_name || famOfRow(order) }),
      `Line linked to ${famOfRow(order)} (${order.order_number}).`).then(() => { setLinkFor(null); setLinkQ('') })

  if (data == null) return <div className="sb-empty">Comparing PRs against orders…</div>
  if (data.error) return <div className="sb-empty">Reconcile isn’t available.<br /><span className="irx-muted">{data.error}</span></div>

  const total = data.orderedMismatch.length + data.receivedMismatch.length + data.unmatched.length + stockMatches.length

  return (
    <div className="irx">
      <style>{IRX_CSS}</style>
      <div className="irx-sub">
        Nothing here changes an order by itself — every row is your call. Fixes use the same stone ladder as the Orders tab; Disregard is remembered.
      </div>
      {banner && <div className={`irx-banner irx-banner-${banner.kind}`}>{banner.text}<button type="button" className="irx-x" onClick={() => setBanner(null)}>×</button></div>}

      <StoneDeadlinesSection onOpenOrder={onOpenOrder} setBanner={setBanner} />

      {total === 0 && <div className="sb-empty">No PR/order differences to reconcile.</div>}

      {data.orderedMismatch.length > 0 && (
        <Section title="PR says ordered — order says not" tone="red" count={data.orderedMismatch.length}
          hint="The stone is on a submitted/ordered/recorded PR, but the order's stone status is still not-ordered.">
          {data.orderedMismatch.map(row => (
            <div key={row.item.id} className="irx-row">
              <button type="button" className="irx-fam" onClick={() => onOpenOrder?.(row.order.id)}>{famOfRow(row.order)}</button>
              <span className="irx-meta">{row.order.order_number} · {lineLabel(row.item)} · on {row.pr?.po_number || 'PR'}{row.pr?.recorded ? ' (recorded)' : ''}</span>
              <span className="irx-actions">
                <button type="button" className="irx-btn irx-btn-go" disabled={!!busyKey} onClick={() => markOrdered(row)}>Mark stone ordered</button>
                <button type="button" className="irx-btn" disabled={!!busyKey} onClick={() => disregard(row.item.id, 'ordered', `d:${row.item.id}`)}>Disregard</button>
              </span>
            </div>
          ))}
        </Section>
      )}

      {data.receivedMismatch.length > 0 && (
        <Section title="PR line received — order says stone not here" tone="amber" count={data.receivedMismatch.length}
          hint="The PR line was received into the yard, but the order still reads stone-not-received.">
          {data.receivedMismatch.map(row => (
            <div key={row.item.id} className="irx-row">
              <button type="button" className="irx-fam" onClick={() => onOpenOrder?.(row.order.id)}>{famOfRow(row.order)}</button>
              <span className="irx-meta">{row.order.order_number} · {lineLabel(row.item)} · {row.pr?.po_number || 'PR'}</span>
              <span className="irx-actions">
                <button type="button" className="irx-btn irx-btn-go" disabled={!!busyKey} onClick={() => markReceived(row)}>Mark stone received</button>
                <button type="button" className="irx-btn" disabled={!!busyKey} onClick={() => disregard(row.item.id, 'received', `d:${row.item.id}`)}>Disregard</button>
              </span>
            </div>
          ))}
        </Section>
      )}

      {data.unmatched.length > 0 && (
        <Section title="PR lines with no matching order" tone="blue" count={data.unmatched.length}
          hint="These families are on a PR but not linked to any order. Link them so receiving lands the stone on the right job — or disregard.">
          {data.unmatched.map(({ item, pr }) => {
            const cands = candidatesFor(item.family_name)
            return (
              <div key={item.id} className="irx-row irx-row-tall">
                <span className="irx-fam-plain">{item.family_name}</span>
                <span className="irx-meta">{lineLabel(item)} · on {pr?.po_number || 'PR'}</span>
                <span className="irx-actions">
                  {cands.map(c => (
                    <button key={c.id} type="button" className="irx-btn irx-btn-cand" disabled={!!busyKey}
                      title={`Link this line to ${famOfRow(c)} (${c.order_number})`}
                      onClick={() => linkItem(item, c)}>
                      → {famOfRow(c)} · {c.order_number}
                    </button>
                  ))}
                  <button type="button" className="irx-btn" disabled={!!busyKey} onClick={() => { setLinkFor(linkFor === item.id ? null : item.id); setLinkQ('') }}>
                    {linkFor === item.id ? 'Close search' : 'Search orders…'}
                  </button>
                  <button type="button" className="irx-btn" disabled={!!busyKey} onClick={() => disregard(item.id, 'unmatched', `d:${item.id}`)}>Disregard</button>
                </span>
                {linkFor === item.id && (
                  <div className="irx-linkbox">
                    <input className="sb-input" autoFocus placeholder="Search family or order #…" value={linkQ} onChange={e => setLinkQ(e.target.value)} />
                    {linkResults.map(c => (
                      <button key={c.id} type="button" className="irx-linkrow" onClick={() => linkItem(item, c)}>
                        {famOfRow(c)} <span className="irx-meta">{c.order_number} · {c.status}</span>
                      </button>
                    ))}
                    {linkQ.trim() && linkResults.length === 0 && <div className="irx-muted" style={{ padding: '6px 2px' }}>No open orders match.</div>}
                  </div>
                )}
              </div>
            )
          })}
        </Section>
      )}

      {stockMatches.length > 0 && (
        <Section title="Stock stone on order matches a job that needs one" tone="green" count={stockMatches.length}
          hint="The stone is not here, but a STOCK stone of that size is already on an ordered PR — you may not need to order another.">
          {stockMatches.map(m => (
            <div key={`${m.stockItem.id}:${m.dismissKey}`} className="irx-row">
              <button type="button" className="irx-fam" onClick={() => onOpenOrder?.(m.need.orderId)}>{m.need.family}</button>
              <span className="irx-meta">
                needs {m.need.kind === 'base' ? 'base' : 'stone'} {m.need.size}{m.need.color ? ` · ${m.need.color}` : ''} — stock {m.stockItem.size}
                {m.stockItem.color ? ` · ${m.stockItem.color}` : ''} on {m.pr?.po_number || 'PR'} ({m.strength === 'exact' ? 'exact size' : 'near size'})
              </span>
              <span className="irx-actions">
                <button type="button" className="irx-btn" disabled={!!busyKey} onClick={() => disregard(m.stockItem.id, m.dismissKey, `d:${m.stockItem.id}:${m.dismissKey}`)}>Disregard</button>
              </span>
            </div>
          ))}
        </Section>
      )}
    </div>
  )
}

// ── STONE DEADLINES (RECON-2) — Sabina's chart vs orders, Paul clicks ───────
const sdNorm = (s) => String(s || '').toUpperCase().replace(/[^A-Z ]/g, ' ').replace(/\s+/g, ' ').trim()
const sdKeys = (raw) => {
  const n = sdNorm(String(raw || '').split(/[-–]/)[0])
  const words = n.split(' ').filter(Boolean)
  return { full: n, longest: words.slice().sort((a, z) => z.length - a.length)[0] || '' }
}
const sdFmt = (iso) => {
  if (!iso) return '—'
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number)
  return `${m}/${d}/${y}`
}
const sdFamOf = (o) => (o.primary_lastname && String(o.primary_lastname).trim())
  || [o.customer?.first_name, o.customer?.last_name].filter(Boolean).join(' ')
  || o.order_number || 'Order'

function StoneDeadlinesSection({ onOpenOrder, setBanner }) {
  const [rows, setRows] = useState(null)
  const [orders, setOrders] = useState(null)
  const [busyId, setBusyId] = useState(null)
  const [pick, setPick] = useState({})     // rowId -> chosen order (for ambiguous/missing)
  const [searchFor, setSearchFor] = useState(null)
  const [q, setQ] = useState('')

  const load = useCallback(async () => {
    const [r, o] = await Promise.all([listStoneDeadlines(), listOpenOrdersLight()])
    setRows(r); setOrders(o)
  }, [])
  useEffect(() => { load() }, [load])

  const index = useMemo(() => {
    const m = new Map()
    const push = (k, o) => { if (!k) return; if (!m.has(k)) m.set(k, []); m.get(k).push(o) }
    for (const o of (orders || [])) {
      push(sdNorm(o.primary_lastname), o)
      const ln = sdNorm(o.customer?.last_name)
      if (ln && ln !== sdNorm(o.primary_lastname)) push(ln, o)
    }
    return m
  }, [orders])

  const buckets = useMemo(() => {
    if (!rows || !orders) return null
    const uniq = (arr) => { const s = new Set(); return arr.filter(o => !s.has(o.id) && s.add(o.id)) }
    const missing = [], ambiguous = [], proposals = []
    let aligned = 0
    for (const r of rows) {
      const { full, longest } = sdKeys(r.family)
      let hits = uniq([...(index.get(full) || []), ...(index.get(longest) || [])])
      if (hits.length === 0 && longest.length >= 4) {
        hits = uniq((orders || []).filter(o => {
          const pn = sdNorm(o.primary_lastname), ln = sdNorm(o.customer?.last_name)
          return (pn && pn.includes(longest)) || (ln && ln.includes(longest))
        }))
        if (hits.length > 3) hits = []
      }
      const chosen = pick[r.id]
      if (chosen) { proposals.push({ r, order: chosen }); continue }
      if (hits.length === 0) missing.push({ r })
      else if (hits.length > 1) ambiguous.push({ r, hits })
      else {
        const cur = hits[0].target_completion_date ? String(hits[0].target_completion_date).slice(0, 10) : null
        if (cur === r.proposed_date) aligned++
        else proposals.push({ r, order: hits[0] })
      }
    }
    return { missing, ambiguous, proposals, aligned }
  }, [rows, orders, index, pick])

  const searchHits = useMemo(() => {
    if (!orders || q.trim().length < 2) return []
    const t = q.trim().toLowerCase()
    return orders.filter(o => `${o.primary_lastname || ''} ${o.customer?.last_name || ''} ${o.order_number || ''}`.toLowerCase().includes(t)).slice(0, 8)
  }, [orders, q])

  const apply = async (row, order) => {
    if (busyId) return
    setBusyId(row.id)
    const who = await getCurrentStaffName().catch(() => null)
    const res = await applyStoneDeadline(row.id, order.id, row.proposed_date, who)
    setBusyId(null)
    if (!res.ok) { setBanner({ kind: 'err', text: res.error || 'Could not set the due date.' }); return }
    setBanner({ kind: 'ok', text: `${sdFamOf(order)} due date set to ${sdFmt(row.proposed_date)}.` })
    load()
  }
  const dismiss = async (row) => {
    if (busyId) return
    setBusyId(row.id)
    const who = await getCurrentStaffName().catch(() => null)
    const res = await dismissStoneDeadline(row.id, who)
    setBusyId(null)
    if (!res.ok) { setBanner({ kind: 'err', text: res.error || 'Could not disregard.' }); return }
    load()
  }

  if (rows === null || orders === null) return <div className="sb-empty">Reading the deadline chart…</div>
  if (!rows.length) return null
  if (!buckets) return null

  const colorChip = (r) => (
    r.sheet_color === 'blue' ? <span className="irx-sd-chip irx-sd-blue">STENCIL CUT</span>
      : r.sheet_color === 'orange' ? <span className="irx-sd-chip irx-sd-orange">HAS PHOTO</span>
        : <span className="irx-sd-chip">NOT CUT</span>
  )

  return (
    <>
      <style>{SD_CSS}</style>
      {buckets.missing.length > 0 && (
        <Section title="On the deadline chart — not found in Stonebooks" tone="red" count={buckets.missing.length}
          hint="These stones are on Sabina's chart but no open order matches the name. Link one, or disregard if it lives under a different family.">
          {buckets.missing.map(({ r }) => (
            <div key={r.id} className="irx-row irx-row-tall">
              <span className="irx-fam-plain">{r.family}</span>
              <span className="irx-meta">{r.detail || r.family_raw} · due {sdFmt(r.proposed_date)}</span>
              {colorChip(r)}
              <span className="irx-actions">
                <button type="button" className="irx-btn" disabled={!!busyId} onClick={() => { setSearchFor(searchFor === r.id ? null : r.id); setQ('') }}>
                  {searchFor === r.id ? 'Close search' : 'Search orders…'}
                </button>
                <button type="button" className="irx-btn" disabled={!!busyId} onClick={() => dismiss(r)}>Disregard</button>
              </span>
              {searchFor === r.id && (
                <div className="irx-linkbox">
                  <input className="sb-input" autoFocus placeholder="Search family, customer, or order #…" value={q} onChange={e => setQ(e.target.value)} />
                  {searchHits.map(o => (
                    <button key={o.id} type="button" className="irx-linkrow"
                      onClick={() => { setPick(p => ({ ...p, [r.id]: o })); setSearchFor(null); setQ('') }}>
                      {sdFamOf(o)} <span className="irx-meta">{o.order_number} · {o.status}{o.target_completion_date ? ` · due ${sdFmt(o.target_completion_date)}` : ''}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </Section>
      )}

      {buckets.ambiguous.length > 0 && (
        <Section title="Deadline chart — more than one order matches" tone="amber" count={buckets.ambiguous.length}
          hint="Pick which order the chart row means; then it becomes a one-click due-date update below.">
          {buckets.ambiguous.map(({ r, hits }) => (
            <div key={r.id} className="irx-row irx-row-tall">
              <span className="irx-fam-plain">{r.family}</span>
              <span className="irx-meta">due {sdFmt(r.proposed_date)}</span>
              {colorChip(r)}
              <span className="irx-actions">
                {hits.slice(0, 4).map(o => (
                  <button key={o.id} type="button" className="irx-btn irx-btn-cand" disabled={!!busyId}
                    onClick={() => setPick(p => ({ ...p, [r.id]: o }))}>
                    → {sdFamOf(o)} · {o.order_number}{o.target_completion_date ? ` (due ${sdFmt(o.target_completion_date)})` : ''}
                  </button>
                ))}
                <button type="button" className="irx-btn" disabled={!!busyId} onClick={() => dismiss(r)}>Disregard</button>
              </span>
            </div>
          ))}
        </Section>
      )}

      {buckets.proposals.length > 0 && (
        <Section title="Deadline chart — due-date updates for your click" tone="blue" count={buckets.proposals.length}
          hint="The chart's month (or its written date) vs the order's current due date. Nothing changes until you press Set.">
          {buckets.proposals.map(({ r, order }) => (
            <div key={r.id} className="irx-row">
              <button type="button" className="irx-fam" onClick={() => onOpenOrder?.(order.id)}>{sdFamOf(order)}</button>
              <span className="irx-meta">
                {order.order_number} · {order.status} · now {order.target_completion_date ? sdFmt(order.target_completion_date) : 'NO DUE DATE'} → chart says {sdFmt(r.proposed_date)}
              </span>
              {colorChip(r)}
              <span className="irx-actions">
                <button type="button" className="irx-btn irx-btn-go" disabled={!!busyId} onClick={() => apply(r, order)}>
                  Set due {sdFmt(r.proposed_date)}
                </button>
                <button type="button" className="irx-btn" disabled={!!busyId} onClick={() => dismiss(r)}>Disregard</button>
              </span>
            </div>
          ))}
        </Section>
      )}

      {buckets.aligned > 0 && (
        <div className="irx-muted" style={{ margin: '-6px 0 16px 4px' }}>
          {buckets.aligned} chart row{buckets.aligned === 1 ? ' already agrees' : 's already agree'} with the order due dates — nothing to do there.
        </div>
      )}
    </>
  )
}

const SD_CSS = `
  .irx-sd-chip { font-size: 10px; font-weight: 800; letter-spacing: 0.05em; border-radius: 6px; padding: 3px 8px; background: #f0ece2; color: #6b6256; white-space: nowrap; }
  .irx-sd-blue { background: #EAF1FB; color: #234C8A; }
  .irx-sd-orange { background: #FCEFD9; color: #A05A12; }
`

function Section({ title, tone, count, hint, children }) {
  return (
    <div className={`irx-sec irx-sec-${tone}`}>
      <div className="irx-sec-head">{title} <span className="irx-count">{count}</span></div>
      {hint && <div className="irx-hint">{hint}</div>}
      <div className="irx-rows">{children}</div>
    </div>
  )
}

const IRX_CSS = `
  .irx-sub { font-size: 13px; color: var(--sb-text-muted, #6b6256); margin-bottom: 16px; max-width: 760px; line-height: 1.5; }
  .irx-muted { color: var(--sb-text-muted, #8a7f6c); font-size: 13px; }
  .irx-banner { display: flex; align-items: center; gap: 10px; padding: 10px 14px; border-radius: 9px; font-size: 13.5px; font-weight: 600; margin-bottom: 14px; }
  .irx-banner-ok { background: #e7f3ea; color: #1f7a3d; }
  .irx-banner-err { background: #fdeced; color: #b3261e; }
  .irx-x { margin-left: auto; background: none; border: none; font-size: 17px; color: inherit; opacity: 0.6; cursor: pointer; }
  .irx-sec { background: var(--sb-surface, #fff); border: 1px solid var(--sb-border, #e4e0d4); border-left-width: 5px; border-radius: 12px; padding: 14px 16px; margin-bottom: 16px; }
  .irx-sec-red { border-left-color: #B3261E; }
  .irx-sec-amber { border-left-color: #b8842a; }
  .irx-sec-blue { border-left-color: #2563a8; }
  .irx-sec-green { border-left-color: #1d7a55; }
  .irx-sec-head { font-size: 13px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.04em; color: var(--sb-text, #2a2a2a); }
  .irx-count { background: rgba(0,0,0,0.08); border-radius: 999px; padding: 0 9px; font-size: 12px; }
  .irx-hint { font-size: 12px; color: var(--sb-text-muted, #8a7f6c); margin: 3px 0 8px; }
  .irx-rows { display: flex; flex-direction: column; }
  .irx-row { display: flex; align-items: center; gap: 12px; padding: 8px 2px; border-top: 1px solid var(--sb-border-soft, #f0ece2); flex-wrap: wrap; }
  .irx-row-tall { align-items: flex-start; }
  .irx-row:first-child { border-top: 0; }
  .irx-fam { font: inherit; font-size: 14px; font-weight: 700; color: #1e2d3d; background: none; border: none; padding: 0; cursor: pointer; }
  .irx-fam:hover { color: #9A7209; }
  .irx-fam-plain { font-size: 14px; font-weight: 700; color: #1e2d3d; }
  .irx-meta { font-size: 12.5px; color: var(--sb-text-muted, #8a7f6c); flex: 1; min-width: 200px; }
  .irx-actions { display: flex; gap: 8px; flex-wrap: wrap; }
  .irx-btn { font: inherit; font-size: 12px; font-weight: 700; padding: 5px 12px; border-radius: 8px; border: 1px solid var(--sb-border, #d8d2c4); background: #fff; color: #2a2a27; cursor: pointer; }
  .irx-btn:hover:not(:disabled) { border-color: #9A7209; color: #9A7209; }
  .irx-btn:disabled { opacity: 0.5; cursor: default; }
  .irx-btn-go { border-color: #1f7a3d; background: #1f7a3d; color: #fff; }
  .irx-btn-go:hover:not(:disabled) { background: #16612f; border-color: #16612f; color: #fff; }
  .irx-btn-cand { border-color: #2563a8; color: #2563a8; }
  .irx-linkbox { flex-basis: 100%; margin-top: 6px; border: 1px solid var(--sb-border, #e4e0d4); border-radius: 9px; padding: 8px; }
  .irx-linkrow { display: block; width: 100%; text-align: left; font: inherit; font-size: 13px; font-weight: 600; background: none; border: none; border-top: 1px solid var(--sb-border-soft, #f0ece2); padding: 7px 4px; cursor: pointer; }
  .irx-linkrow:hover { background: #faf8f3; }
`
