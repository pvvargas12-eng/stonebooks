// =============================================================================
// InventoryDashboard — the dark "war-room" command center (default Inventory view).
// =============================================================================
// READ/derivation only. Real data where a source exists (yard counts from
// inventory_stock, matches from the matcher, pipeline from bulk_orders); clean
// empty/"—" states where a source isn't built yet (low-stock rules, photo alerts).
// Dark styling is SCOPED to `.invd` — it does not touch the app shell or the other
// Inventory sub-views. Opens cleanly with sparse data (no bulk_orders, etc.).
// =============================================================================

import { useState, useEffect, useCallback, useMemo } from 'react'
import { rowToOrder } from '../SalesMode'
import { getActiveStoneOrders, getInventoryStock, listAllBulkOrders } from '../lib/stonebooksData'
import { resolveStoneNeeds, matchNeedsToStock } from '../lib/inventoryMatch'

const titleCase = (s) => String(s || '').replace(/\b\w/g, c => c.toUpperCase())
const DAY = 86400000

function familyOf(row) {
  if (row.primary_lastname && String(row.primary_lastname).trim()) return String(row.primary_lastname).trim()
  if (Array.isArray(row.deceased)) {
    const d = row.deceased.find(x => x && !x.isReserved && (x.lastName || x.firstName))
    if (d) return [d.lastName, d.firstName].filter(Boolean).join(', ')
  }
  return row.order_number || 'Order'
}

export default function InventoryDashboard({ onImport, onAddStone, onOpenMatches }) {
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState(null)
  const [syncedAt, setSyncedAt] = useState('')

  const load = useCallback(async () => {
    try {
      const [ordRes, stockRes, bulk] = await Promise.all([
        getActiveStoneOrders(), getInventoryStock(), listAllBulkOrders(),
      ])
      const stock = stockRes.rows || []
      const rushByOrder = {}
      const orders = (ordRes.rows || []).map(r => {
        const o = rowToOrder(r, null, null)
        o.family = familyOf(r)
        rushByOrder[r.id] = !!r.rush_order
        return o
      })
      const needs = resolveStoneNeeds(orders)
      const matched = matchNeedsToStock(needs, stock)
      // Capture "now" HERE (in the effect/callback, not render) — react-hooks/purity
      // forbids Date.now() during render. The KPI memo reads data.nowMs.
      setData({ stock, matched, bulk: bulk || [], rushByOrder, orderCount: orders.length, nowMs: Date.now() })
      setSyncedAt(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))
    } catch (e) {
      setData({ stock: [], matched: [], bulk: [], rushByOrder: {}, orderCount: 0, error: String(e?.message || e) })
    }
    setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  const kpis = useMemo(() => {
    if (!data) return null
    const { stock, matched, bulk } = data
    const avail = stock.filter(s => (s.status || 'available') === 'available')
    const alloc = stock.filter(s => s.status === 'allocated')
    const qty = (arr) => arr.reduce((n, s) => n + (Number(s.quantity) || 0), 0)
    const exact = matched.filter(m => m.best?.strength === 'exact').length
    const near = matched.filter(m => m.best?.strength === 'near').length
    const noMatch = matched.filter(m => !m.best).length
    const locs = new Set(avail.map(s => s.location || '—')).size
    const now = data.nowMs || 0
    const inTransit = bulk.filter(b => !b.received_at).length
    const recvRecent = bulk.filter(b => b.received_at && (now - new Date(b.received_at).getTime()) <= 14 * DAY).length
    return { availQty: qty(avail), availRows: avail.length, allocQty: qty(alloc), allocRows: alloc.length, locs, exact, near, noMatch, matchesFound: exact + near, inTransit, recvRecent }
  }, [data])

  const alerts = useMemo(() => {
    if (!data) return []
    // Live alert source: stone needs with NO available yard match → must order.
    // (Missing-photo + received-unallocated alert types are omitted until those
    // sources exist — no fake cards.)
    return data.matched
      .filter(m => !m.best)
      .map(m => ({ ...m.need, rush: !!data.rushByOrder[m.need.orderId] }))
      .sort((a, b) => (b.rush ? 1 : 0) - (a.rush ? 1 : 0))
  }, [data])

  const topMatches = useMemo(() => {
    if (!data) return []
    const ranked = data.matched.filter(m => m.best)
    ranked.sort((a, b) => (a.best.strength === 'exact' ? 0 : 1) - (b.best.strength === 'exact' ? 0 : 1))
    return ranked.slice(0, 6)
  }, [data])

  if (loading) return <div className="invd"><style>{INVD_CSS}</style><div className="invd-loading">Booting command center…</div></div>

  return (
    <div className="invd">
      <style>{INVD_CSS}</style>

      {/* 1 · COMMAND HEADER */}
      <header className="invd-cmd">
        <div className="invd-cmd-left">
          <h1 className="invd-title">Inventory Command Center</h1>
          <div className="invd-purpose">Live yard state, order needs, and smart matches — so you never re-order stone you already have.</div>
        </div>
        <div className="invd-cmd-right">
          <span className="invd-live"><span className="invd-live-dot" /> LIVE · synced {syncedAt || '—'}</span>
          <div className="invd-actions">
            <button type="button" className="invd-btn" onClick={onImport}>Import</button>
            <button type="button" className="invd-btn" onClick={onAddStone}>Add stone</button>
            <button type="button" className="invd-btn invd-btn-ghost" disabled title="Purchase requests — coming in the procurement phase">Build PR</button>
          </div>
        </div>
      </header>

      {/* 2 · KPI CARDS */}
      <div className="invd-kpis">
        <Kpi tone="green"  label="Available stone" value={kpis.availQty} sub={`${kpis.availRows} rows · ${kpis.locs} locations`} />
        <Kpi tone="purple" label="Allocated"       value={kpis.allocQty} sub={`${kpis.allocRows} reserved to families`} />
        <Kpi tone="red"    label="Needs ordering"  value={kpis.noMatch}  sub="open orders with no yard match" />
        <Kpi tone="green"  label="Matches found"   value={kpis.matchesFound} sub={`${kpis.exact} exact · ${kpis.near} near`} />
        <Kpi tone="amber"  label="Low stock"       value="—" sub="min-stock rules — later phase" pending />
        <Kpi tone="red"    label="Missing photo"   value="—" sub="photo tracking — later phase" pending />
        <Kpi tone="purple" label="In transit / ordered" value={kpis.inTransit} sub="open purchase orders" />
        <Kpi tone="green"  label="Recently received"    value={kpis.recvRecent} sub="last 14 days" />
      </div>

      <div className="invd-grid">
        {/* 3 · CRITICAL ALERTS */}
        <section className="invd-panel">
          <div className="invd-panel-head"><span className="invd-panel-title">Critical Alerts</span><span className="invd-panel-count invd-c-red">{alerts.length}</span></div>
          {alerts.length === 0 ? (
            <div className="invd-empty invd-empty-ok">✓ No critical shortages — every open order’s stone is matched or on hand.</div>
          ) : (
            <div className="invd-alerts">
              {alerts.slice(0, 8).map(a => (
                <div key={a.key} className={`invd-alert ${a.rush ? 'invd-alert-rush' : ''}`}>
                  <div className="invd-alert-top">
                    <span className="invd-alert-fam">{a.family}</span>
                    {a.rush && <span className="invd-tag invd-tag-red">RUSH</span>}
                    <span className="invd-alert-kind">{a.kind === 'base' ? 'Base' : titleCase(a.itemType)}</span>
                  </div>
                  <div className="invd-alert-spec">{a.spec}</div>
                  <div className="invd-alert-why">Not in the yard — needs ordering{a.orderNumber ? ` · ${a.orderNumber}` : ''}</div>
                </div>
              ))}
              {alerts.length > 8 && <div className="invd-more">+{alerts.length - 8} more need ordering</div>}
            </div>
          )}
        </section>

        {/* 4 · SMART MATCHES */}
        <section className="invd-panel">
          <div className="invd-panel-head">
            <span className="invd-panel-title">Smart Matches</span>
            <span className="invd-panel-count invd-c-green">{kpis.matchesFound}</span>
            <button type="button" className="invd-link" onClick={onOpenMatches}>View all →</button>
          </div>
          {topMatches.length === 0 ? (
            <div className="invd-empty">No open-order needs match the yard yet.</div>
          ) : (
            <div className="invd-matches">
              {topMatches.map(m => (
                <div key={m.need.key} className={`invd-match invd-match-${m.best.strength}`}>
                  <div className="invd-match-top">
                    <span className="invd-match-fam">{m.need.family}</span>
                    <span className={`invd-tag ${m.best.strength === 'exact' ? 'invd-tag-green' : 'invd-tag-amber'}`}>{m.best.strength}</span>
                  </div>
                  <div className="invd-match-need">{m.need.spec}</div>
                  <div className="invd-match-found">📍 {m.best.stock.location || 'location not set'} · {[m.best.stock.color, m.best.stock.size].filter(Boolean).join(' · ')}</div>
                  {m.best.why?.length > 0 && <div className="invd-match-why">{m.best.why.join(' · ')}</div>}
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* 5 · VENDOR PIPELINE */}
      <section className="invd-panel">
        <div className="invd-panel-head"><span className="invd-panel-title">Vendor Pipeline</span></div>
        {data.bulk.length === 0 ? (
          <div className="invd-empty">No purchase requests yet — procurement comes in a later phase.</div>
        ) : (
          <div className="invd-pipeline">
            {[
              { code: 'draft',    label: 'Draft',       tone: 'muted',  n: 0 },
              { code: 'ordered',  label: 'Ordered',     tone: 'purple', n: data.bulk.filter(b => !b.received_at).length },
              { code: 'shipped',  label: 'Shipped',     tone: 'purple', n: 0 },
              { code: 'received', label: 'Received',    tone: 'green',  n: data.bulk.filter(b => b.received_at).length },
              { code: 'backorder',label: 'Backordered', tone: 'red',    n: 0 },
            ].map((st, i, arr) => (
              <div key={st.code} className="invd-stage-wrap">
                <div className={`invd-stage invd-stage-${st.tone}`}>
                  <div className="invd-stage-n">{st.n}</div>
                  <div className="invd-stage-l">{st.label}</div>
                </div>
                {i < arr.length - 1 && <span className="invd-stage-arrow">›</span>}
              </div>
            ))}
          </div>
        )}
        <div className="invd-pipeline-note">Draft / Shipped / Backordered stages activate with the procurement phase.</div>
      </section>
    </div>
  )
}

function Kpi({ tone, label, value, sub, pending }) {
  return (
    <div className={`invd-kpi invd-kpi-${tone} ${pending ? 'invd-kpi-pending' : ''}`}>
      <div className="invd-kpi-label">{label}</div>
      <div className="invd-kpi-value">{value}</div>
      <div className="invd-kpi-sub">{sub}</div>
    </div>
  )
}

const INVD_CSS = `
  .invd { background: #0E1116; border-radius: 16px; padding: 22px 24px 26px; color: #e6e9ef;
    font-family: var(--font-b, 'Lato'), 'Helvetica Neue', sans-serif; }
  .invd-loading { padding: 60px; text-align: center; color: #8b95a5; font-family: var(--font-m, 'JetBrains Mono'), monospace; }
  .invd * { box-sizing: border-box; }

  .invd-cmd { display: flex; align-items: flex-start; justify-content: space-between; gap: 20px; flex-wrap: wrap; margin-bottom: 22px; }
  .invd-title { font-size: 22px; font-weight: 700; color: #f4f6fa; margin: 0; letter-spacing: -0.01em; }
  .invd-purpose { font-size: 13px; color: #8b95a5; margin-top: 4px; max-width: 540px; }
  .invd-cmd-right { display: flex; flex-direction: column; align-items: flex-end; gap: 10px; }
  .invd-live { font-family: var(--font-m, 'JetBrains Mono'), monospace; font-size: 11.5px; letter-spacing: 0.06em; color: #34d399; display: inline-flex; align-items: center; gap: 7px; }
  .invd-live-dot { width: 7px; height: 7px; border-radius: 50%; background: #34d399; box-shadow: 0 0 8px #34d399; }
  .invd-actions { display: flex; gap: 8px; }
  .invd-btn { font: inherit; font-size: 13px; font-weight: 600; padding: 7px 14px; border-radius: 8px; border: 1px solid #2a313c; background: #1a212b; color: #e6e9ef; cursor: pointer; }
  .invd-btn:hover:not(:disabled) { background: #232c38; border-color: #3a4452; }
  .invd-btn-ghost { color: #6b7686; cursor: not-allowed; }

  .invd-kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin-bottom: 18px; }
  .invd-kpi { background: #11151c; border: 1px solid #20262f; border-left-width: 3px; border-radius: 11px; padding: 13px 15px; }
  .invd-kpi-label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: #8b95a5; }
  .invd-kpi-value { font-family: var(--font-m, 'JetBrains Mono'), monospace; font-size: 30px; font-weight: 700; line-height: 1.1; margin: 4px 0 3px; color: #f4f6fa; }
  .invd-kpi-sub { font-size: 11.5px; color: #6f7a8a; }
  .invd-kpi-pending .invd-kpi-value { color: #4b5563; }
  .invd-kpi-green  { border-left-color: #34d399; }
  .invd-kpi-amber  { border-left-color: #fbbf24; }
  .invd-kpi-red    { border-left-color: #f87171; }
  .invd-kpi-purple { border-left-color: #a78bfa; }

  .invd-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 16px; }
  @media (max-width: 1000px) { .invd-grid { grid-template-columns: 1fr; } }
  .invd-panel { background: #11151c; border: 1px solid #20262f; border-radius: 12px; padding: 15px 17px; }
  .invd-panel-head { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; }
  .invd-panel-title { font-size: 13px; font-weight: 700; color: #f4f6fa; text-transform: uppercase; letter-spacing: 0.04em; }
  .invd-panel-count { font-family: var(--font-m, 'JetBrains Mono'), monospace; font-size: 12px; font-weight: 700; padding: 1px 8px; border-radius: 999px; background: #1a212b; }
  .invd-c-red { color: #f87171; } .invd-c-green { color: #34d399; }
  .invd-link { margin-left: auto; background: none; border: none; color: #7da6ff; font: inherit; font-size: 12.5px; cursor: pointer; }
  .invd-link:hover { text-decoration: underline; }

  .invd-empty { font-size: 13px; color: #6f7a8a; padding: 14px 4px; }
  .invd-empty-ok { color: #34d399; }

  .invd-alerts, .invd-matches { display: flex; flex-direction: column; gap: 9px; }
  .invd-alert, .invd-match { background: #151a22; border: 1px solid #232a35; border-radius: 9px; padding: 10px 12px; }
  .invd-alert-rush { border-color: #5c2a2a; background: #1c1416; }
  .invd-alert-top, .invd-match-top { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
  .invd-alert-fam, .invd-match-fam { font-size: 14px; font-weight: 700; color: #f4f6fa; }
  .invd-alert-kind { margin-left: auto; font-size: 10px; text-transform: uppercase; letter-spacing: 0.04em; color: #8b95a5; }
  .invd-alert-spec, .invd-match-need { font-family: var(--font-m, 'JetBrains Mono'), monospace; font-size: 12px; color: #c7cedb; }
  .invd-alert-why { font-size: 11.5px; color: #f87171; margin-top: 3px; }
  .invd-match-found { font-size: 12px; color: #34d399; margin-top: 3px; }
  .invd-match-why { font-size: 11.5px; color: #fbbf24; margin-top: 3px; }
  .invd-tag { font-size: 9.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; padding: 1px 7px; border-radius: 999px; }
  .invd-tag-red { background: #3a1d1d; color: #f87171; } .invd-tag-green { background: #15301f; color: #34d399; } .invd-tag-amber { background: #322712; color: #fbbf24; }
  .invd-more { font-size: 12px; color: #8b95a5; padding: 4px 2px; }

  .invd-pipeline { display: flex; align-items: stretch; gap: 4px; flex-wrap: wrap; }
  .invd-stage-wrap { display: flex; align-items: center; gap: 4px; }
  .invd-stage { background: #151a22; border: 1px solid #232a35; border-radius: 9px; padding: 12px 18px; text-align: center; min-width: 92px; border-top-width: 3px; }
  .invd-stage-n { font-family: var(--font-m, 'JetBrains Mono'), monospace; font-size: 22px; font-weight: 700; color: #f4f6fa; }
  .invd-stage-l { font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; color: #8b95a5; margin-top: 2px; }
  .invd-stage-muted  { border-top-color: #3a4452; }
  .invd-stage-purple { border-top-color: #a78bfa; }
  .invd-stage-green  { border-top-color: #34d399; }
  .invd-stage-red    { border-top-color: #f87171; }
  .invd-stage-arrow { color: #4b5563; font-size: 20px; }
  .invd-pipeline-note { font-size: 11px; color: #5b6573; margin-top: 10px; }
`
