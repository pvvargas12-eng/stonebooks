// =============================================================================
// 📚 Stonebooks — Today (operational attention layer)
// =============================================================================
// The "open Stonebooks and know what matters" screen. Three sections of
// attention signals, ordered by operational priority:
//   1. Operations          — job/milestone state (overdue, waiting, stalled)
//   2. Money & deadlines   — overdue balances, cemetery permits, target dates
//   3. Sales funnel        — stale quotes, abandoned drafts
//
// Each item carries a `route` field that drives drill-in:
//   - route: 'order' → opens SalesMode for that order
//   - route: 'job'   → opens JobsTab pre-selected to that job
//
// Architecture extension points (NOT implemented now):
//   - Communication-aware signals (overdue customer photo request, unanswered
//     layout approval, etc.) slot in by adding new `kind` values to
//     getActionItems and one row in KIND_TO_SECTION below.
//   - Future `route` values (e.g. 'thread', 'message') get one branch in
//     handleClickItem. No structural change required.
// =============================================================================

import { useState, useEffect, useMemo } from 'react'
import { fmtUSD } from './lib/stonebooksData'

// Map every action-item kind to its display section. New kinds slot in here.
// Unknown kinds fall through to 'operations' as a defensive default — they'll
// surface in the Operations section so they're never silently lost.
const KIND_TO_SECTION = {
  // Operations — post-sign job/milestone state
  overdue_milestone:     'operations',
  waiting_aged:          'operations',
  stalled_job:           'operations',
  next_actionable_idle:  'operations',
  // Money & deadlines — financial/deadline urgency on orders
  overdue_balance:   'money',
  cemetery_deadline: 'money',
  target_soon:       'money',
  // Sales funnel — pre-sign pipeline staleness
  stale_quote:       'sales',
  abandoned_draft:   'sales',
}

// Operations is rendered with a subtly stronger header (primary:true) to
// anchor the page; Money & Sales use the standard section-label treatment.
const SECTIONS = [
  { key: 'operations', label: 'Operations',        primary: true  },
  { key: 'money',      label: 'Money & deadlines', primary: false },
  { key: 'sales',      label: 'Sales funnel',      primary: false },
]

// Default visible items per section. Anything beyond is hidden behind a
// per-section inline "Show all N →" expand. Hard caps at the data layer
// (Commit A) keep the worst case bounded — 20 overdue, 10 waiting, 10 stalled.
const PER_SECTION_CAP = 5

export default function TodayTab({ user, profile, onOpenSales, onOpenOrder, onOpenJob, onOpenCustomer }) {
  const [stats, setStats] = useState(null)
  const [actionItems, setActionItems] = useState(null)
  const today = useMemo(() => {
    const d = new Date()
    const day = d.toLocaleDateString('en-US', { weekday: 'long' })
    const date = d.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })
    return { day, date }
  }, [])

  // Load summary stats + action items. Commit B flips includeOperational on.
  // Dynamic import preserves the pre-existing pattern of avoiding TodayTab
  // becoming a top-level static importer of stonebooksData (defensive against
  // the static/dynamic-import warning that already exists in this project).
  useEffect(() => {
    let cancelled = false
    import('./lib/stonebooksData').then(async (m) => {
      const [orders, items] = await Promise.all([
        m.listAllOrders({ limit: 500 }),
        m.getActionItems({ includeOperational: true }),
      ])
      if (cancelled) return
      const ACTIVE = ['draft','scoping','quoted','contracted','in_production','installed']
      const SOLD   = ['contracted','in_production','installed','paid_in_full','closed']
      const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0,0,0,0)

      let active = 0, pipeline = 0, mtd = 0, mtdCount = 0
      let sold = 0, cancelled_count = 0
      for (const o of orders) {
        const total = computeTotal(o)
        if (ACTIVE.includes(o.status)) { active++; pipeline += total }
        if (SOLD.includes(o.status)) {
          sold++
          if (new Date(o.created_at) >= monthStart) { mtd += total; mtdCount++ }
        }
        if (o.status === 'cancelled') cancelled_count++
      }
      const attempted = sold + cancelled_count
      const winRate = attempted > 0 ? Math.round((sold / attempted) * 100) : null

      setStats({ active, pipeline, mtd, mtdCount, winRate })
      setActionItems(items)
    })
    return () => { cancelled = true }
  }, [])

  // Bucket items by section in one pass; preserves the existing severity sort
  // from getActionItems (red → amber → muted, recent-first within).
  const itemsBySection = useMemo(() => {
    if (!actionItems) return null
    const out = { operations: [], money: [], sales: [] }
    for (const item of actionItems) {
      const s = KIND_TO_SECTION[item.kind] || 'operations'
      if (out[s]) out[s].push(item)
    }
    return out
  }, [actionItems])

  // Route-aware click dispatch. Falls back to onOpenOrder if the item has an
  // order ref but no recognized route — defensive against future shape drift.
  const handleClickItem = (item) => {
    if (item.route === 'job' && onOpenJob) return onOpenJob(item.routeId)
    if (item.route === 'order')            return onOpenOrder(item.routeId)
    if (item.order?.id)                    return onOpenOrder(item.order.id)
  }

  const totalItemCount = actionItems ? actionItems.length : 0
  const urgentCount = actionItems ? actionItems.filter(i => i.severity === 'red').length : 0

  return (
    <div className="sb-page sb-page-wide">
      <div className="sb-page-head">
        <div className="sb-page-eyebrow">{today.day} · {today.date}</div>
        <h1 className="sb-page-title">Today</h1>
      </div>

      {/* Stats grid — byte-identical to pre-Commit-B Today */}
      <div className="sb-metric-grid">
        <MetricCard label="Active orders" value={stats ? stats.active : '—'} sub={stats ? `${fmtUSD(stats.pipeline)} in pipeline` : ''} />
        <MetricCard label="Month-to-date" value={stats ? fmtUSD(stats.mtd) : '—'} sub={stats ? `${stats.mtdCount} sold` : ''} />
        <MetricCard label="Win rate" value={stats?.winRate != null ? `${stats.winRate}%` : '—'} sub="cancelled vs sold" />
        <MetricCard label="Action items" value={actionItems ? totalItemCount : '—'} sub={actionItems && totalItemCount > 0 ? `${urgentCount} urgent` : 'all caught up'} />
      </div>

      {/* Quick actions — byte-identical to pre-Commit-B Today */}
      <div className="sb-section-label">Quick actions</div>
      <div className="sb-quick-actions">
        <button type="button" className="sb-quick-action" onClick={onOpenSales}>
          <div className="sb-quick-action-title">+ New sale</div>
          <div className="sb-quick-action-sub">Walk a customer through the wizard</div>
        </button>
        <button type="button" className="sb-quick-action" onClick={() => window.dispatchEvent(new CustomEvent('sb:nav', { detail: 'customers' }))}>
          <div className="sb-quick-action-title">Customers</div>
          <div className="sb-quick-action-sub">Search by name, phone, email</div>
        </button>
        <button type="button" className="sb-quick-action" onClick={() => window.dispatchEvent(new CustomEvent('sb:nav', { detail: 'reports' }))}>
          <div className="sb-quick-action-title">Reports</div>
          <div className="sb-quick-action-sub">Sales analytics, win rate, by rep</div>
        </button>
      </div>

      {/* Attention sections — Commit B. Empty sections hide entirely; if all
          three are empty, fall back to the unified "Nothing needs attention"
          empty state. */}
      {actionItems === null ? (
        <div className="sb-empty">Loading…</div>
      ) : totalItemCount === 0 ? (
        <div className="sb-empty">Nothing needs attention right now. As orders age past target dates or quotes go stale, items will surface here.</div>
      ) : (
        SECTIONS.map(sec => {
          const sectionItems = itemsBySection?.[sec.key] || []
          if (sectionItems.length === 0) return null
          return (
            <ActionSection
              key={sec.key}
              label={sec.label}
              primary={sec.primary}
              items={sectionItems}
              onClickItem={handleClickItem}
            />
          )
        })
      )}
    </div>
  )
}

// ─── Section component ───────────────────────────────────────────────────────
// One sectioned action list. Operations gets primary={true} which switches
// the header style to the slightly stronger 'primary' variant — larger font,
// darker color, more vertical breathing room. Restrained: no icons, no
// borders, just typography and spacing.

function ActionSection({ label, primary, items, onClickItem }) {
  const [expanded, setExpanded] = useState(false)
  const visible = expanded ? items : items.slice(0, PER_SECTION_CAP)
  const overflow = items.length - PER_SECTION_CAP

  const sectionCls = primary
    ? 'sb-action-section sb-action-section-primary'
    : 'sb-action-section'
  const labelCls = primary
    ? 'sb-action-section-label sb-action-section-label-primary'
    : 'sb-action-section-label'

  return (
    <div className={sectionCls}>
      <div className={labelCls}>{label}</div>
      <div className="sb-action-list">
        {visible.map((item, idx) => (
          <button
            key={`${item.kind}-${item.routeId || item.order?.id || idx}`}
            type="button"
            className={`sb-action-item sb-action-${item.severity}`}
            onClick={() => onClickItem(item)}
          >
            <span className="sb-action-icon">{item.icon}</span>
            <div className="sb-action-body">
              <div className="sb-action-label">{item.label}</div>
              <div className="sb-action-meta">{item.meta}</div>
            </div>
            <span className="sb-action-arrow">→</span>
          </button>
        ))}
      </div>
      {overflow > 0 && (
        <button
          type="button"
          className="sb-link sb-action-show-more"
          onClick={() => setExpanded(e => !e)}
        >
          {expanded ? 'Show fewer ↑' : `Show all ${items.length} →`}
        </button>
      )}
    </div>
  )
}

// ─── Local helpers (moved from Stonebooks.jsx with the TodayTab extraction)──

function MetricCard({ label, value, sub }) {
  return (
    <div className="sb-metric">
      <div className="sb-metric-label">{label}</div>
      <div className="sb-metric-value">{value}</div>
      {sub && <div className="sb-metric-sub">{sub}</div>}
    </div>
  )
}

// Inline total computation — duplicated tiny version of stonebooksData
// rowGrandTotal to avoid import cycles in TodayTab.
function computeTotal(o) {
  if (!o) return 0
  const pricing = o.pricing || {}
  const overrides = pricing.overrides || {}
  const addOns = o.add_ons || []
  let subtotalDisc = 0, subtotalPermit = 0
  if (overrides['base-stone'] != null) subtotalDisc += Number(overrides['base-stone']) || 0
  for (const [code, val] of Object.entries(overrides)) {
    if (code === 'base-stone' || typeof val !== 'number') continue
    if (code === 'addon-permit') subtotalPermit += val
    else                          subtotalDisc += val
  }
  for (const a of addOns) {
    if (a.freeWithStone) continue
    const amt = (Number(a.price) || 0) * (Number(a.qty) || 1)
    if (a.code === 'permit') subtotalPermit += amt
    else                     subtotalDisc += amt
  }
  for (const c of (pricing.customLineItems || [])) subtotalDisc += Number(c.amount) || 0
  const discountPct = Number(pricing.discountPct) || 0
  const discountAmt = subtotalDisc * (discountPct / 100)
  const taxBase = (subtotalDisc - discountAmt) + subtotalPermit
  const tax = pricing.applyTax ? taxBase * 0.06625 : 0
  const cc = pricing.applyCCSurcharge ? (taxBase + tax) * 0.03 : 0
  return Math.round(taxBase + tax + cc)
}

// ─── Component-local styles (Commit B additions) ─────────────────────────────
// Section wrappers + the slightly stronger 'primary' label variant for
// Operations. Other tabs already inject styles via <style> tag on first
// module load (see JobsTab.jsx); same pattern.

const localStyles = `
  .sb-action-section {
    margin-top: 20px;
  }
  .sb-action-section-primary {
    margin-top: 28px;
  }
  .sb-action-section-label {
    font-size: 11px;
    font-family: var(--sb-font-mono);
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--sb-text-muted);
    margin-bottom: 8px;
  }
  .sb-action-section-label-primary {
    font-size: 13px;
    color: var(--sb-text);
    font-weight: 600;
    margin-bottom: 12px;
  }
  .sb-action-show-more {
    font-size: 12px;
    margin-top: 8px;
    padding: 4px 0;
    cursor: pointer;
  }
`

if (typeof document !== 'undefined' && !document.getElementById('sb-today-tab-styles')) {
  const tag = document.createElement('style')
  tag.id = 'sb-today-tab-styles'
  tag.textContent = localStyles
  document.head.appendChild(tag)
}
