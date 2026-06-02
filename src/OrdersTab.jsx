// =============================================================================
// Stonebooks — Orders tab (CRM-RESKIN-PASS)
// =============================================================================
// Operational order control surface. 4 KPI cards on top (real, useful) +
// filter chips + sort/search + operational table. Same visual language as
// TodayTab + Customers. Each row carries a blocker chip from the shared
// computeOrderPressure substrate.
// =============================================================================

import { useState, useEffect, useMemo } from 'react'
import {
  listAllOrders, getJobs,
  statusInfo, customerName,
  rowGrandTotal, rowTotalPaid, rowBalanceDue,
  fmtUSD, fmtRelative,
  computeOrderPressure,
  ORDER_STATUSES, ACTIVE_STATUSES, SOLD_STATUSES,
} from './lib/stonebooksData'
import { paymentTone, paymentLabel } from './lib/crmTheme'
import { Pill, FilterChip, ProgressMicroBar } from './lib/crmComponents.jsx'
import OrderDetail from './OrderDetail.jsx'

// ── Filter shapes ────────────────────────────────────────────────────────────

const STATUS_FILTERS = [
  { code: 'active',   label: 'Active' },
  { code: 'all',      label: 'All' },
  { code: 'draft',    label: 'Draft' },
  { code: 'archived', label: 'Archived' },
]
const PIPELINE_STAGE_FILTERS = [
  { code: 'scoping',       label: 'Scoping' },
  { code: 'quoted',        label: 'Quoted' },
  { code: 'contracted',    label: 'Contracted' },
  { code: 'in_production', label: 'In Production' },
  { code: 'installed',     label: 'Installed' },
  { code: 'paid_in_full',  label: 'Paid in full' },
  { code: 'closed',        label: 'Closed' },
]
const PAYMENT_FILTERS = [
  { code: 'paid_in_full', label: 'Paid in full' },
  { code: 'partial',      label: 'Partial' },
  { code: 'unpaid',       label: 'Unpaid' },
  { code: 'overdue',      label: 'Overdue' },
]
const JOB_TYPE_FILTERS = [
  { code: 'new_stone',       label: 'New stone' },
  { code: 'mausoleum_door',  label: 'Crypt door' },
  { code: 'cleaning_repair', label: 'Cleaning-repair' },
  { code: 'inscription',     label: 'Inscription' },
]
const SORT_OPTIONS = [
  { code: 'actionPriority', label: 'Sort: Action priority' },
  { code: 'lastActivity',   label: 'Sort: Recent activity' },
  { code: 'ageDesc',        label: 'Sort: Age oldest first' },
  { code: 'balanceDesc',    label: 'Sort: Balance high→low' },
  { code: 'totalDesc',      label: 'Sort: Total high→low' },
  { code: 'familyName',     label: 'Sort: Family name A→Z' },
]

// (Q9) Family/stone leads — order number is the cross-reference, not the
// identity. Operator thinks "the Kowalski job" not "SO-2026-042".
// (Q6) Grid widths rebalanced: Balance 0.9→1.1, Stage 0.7→0.85, Age 0.5→0.4,
// Updated 0.7→0.6 so the BALANCE bar+value and "In Production" pill fit.
// Grid: FAMILY/STONE | ORDER# | CEMETERY+rep | TOTAL | BALANCE | STAGE | BLOCKER | AGE | UPDATED
const ROW_GRID = '1.4fr 0.7fr 1.05fr 0.7fr 1.1fr 0.85fr 1.2fr 0.4fr 0.6fr'

// (Q4) Action-priority sort helpers
const SEVERITY_RANK = { red: 0, amber: 1, blue: 2 }
function recencyBand(updatedAt) {
  if (!updatedAt) return 4
  const days = Math.floor((Date.now() - new Date(updatedAt).getTime()) / 86400000)
  if (days <= 7)  return 0
  if (days <= 30) return 1
  if (days <= 90) return 2
  return 3
}
function severityRank(blocker) {
  if (!blocker) return 3
  return SEVERITY_RANK[blocker.severity] ?? 3
}

// ── Component ────────────────────────────────────────────────────────────────

export default function OrdersTab({ onOpenSales, onNewOrder, onEditOrder, onOpenCustomer, onOpenJob }) {
  // CORE FIX: clicking an order opens the read-only Order Detail View (internal
  // state) — NOT the sales wizard. The wizard opens only from OrderDetail's
  // "Edit in Sales Portal" action, which calls onOpenOrder(id) → openSales(id).
  const [selectedOrderId, setSelectedOrderId] = useState(null)
  const [orders, setOrders] = useState([])
  const [allJobs, setAllJobs] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadErr, setLoadErr] = useState(null)
  const [statusFilter, setStatusFilter] = useState('active')
  const [pipelineFilters, setPipelineFilters] = useState(new Set())
  const [paymentFilters, setPaymentFilters]   = useState(new Set())
  const [jobTypeFilters, setJobTypeFilters]   = useState(new Set())
  const [needsAttentionOnly, setNeedsAttentionOnly] = useState(false)
  const [cemeteryFilter, setCemeteryFilter] = useState('')   // cemetery_id or ''
  const [sortKey, setSortKey] = useState('actionPriority')
  const [search, setSearch] = useState('')

  // ── Load ────────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setLoadErr(null)
    let statuses
    if (statusFilter === 'active')        statuses = ACTIVE_STATUSES
    else if (statusFilter === 'all')      statuses = ORDER_STATUSES.filter(s => s.code !== 'archived').map(s => s.code)
    else if (statusFilter === 'archived') statuses = ['archived']
    else                                  statuses = [statusFilter]
    Promise.all([
      listAllOrders({ statuses, limit: 500 }),
      getJobs({ includeClosed: true, limit: 1000 }),
    ])
      .then(([rows, jobs]) => {
        if (cancelled) return
        setOrders(rows || [])
        setAllJobs(jobs || [])
        setLoading(false)
      })
      .catch(e => {
        if (cancelled) return
        setLoadErr(e?.message || 'Failed to load orders')
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [statusFilter])

  // ── Enrich each order with pressure + job + flags ───────────────────────
  const enriched = useMemo(() => {
    const jobByOrderId = new Map()
    for (const j of allJobs) {
      if (j.order_id && !jobByOrderId.has(j.order_id)) jobByOrderId.set(j.order_id, j)
    }
    return orders.map(o => {
      const job = jobByOrderId.get(o.id) || null
      const pressure = computeOrderPressure(o, job, job?.milestones)
      const total   = rowGrandTotal(o)
      const paid    = rowTotalPaid(o)
      const balance = rowBalanceDue(o)
      const fillRatio = total > 0 ? paid / total : 0
      const familyName =
        (o.primary_lastname && String(o.primary_lastname).trim()) ||
        (o.customer?.last_name && String(o.customer.last_name).trim().toUpperCase()) ||
        customerName(o.customer) ||
        '—'
      return {
        ...o,
        _job: job,
        _pressure: pressure,
        _total: total,
        _paid: paid,
        _balance: balance,
        _fillRatio: fillRatio,
        _familyName: familyName,
        _jobType: job?.job_type || null,
        _serviceTypesUp: new Set((o.service_types || []).map(s => String(s).toUpperCase())),
      }
    })
  }, [orders, allJobs])

  // ── Cemetery options (from data) ────────────────────────────────────────
  const cemeteryOptions = useMemo(() => {
    const map = new Map()
    for (const o of enriched) {
      if (o.cemetery?.id && !map.has(o.cemetery.id)) map.set(o.cemetery.id, o.cemetery.name)
    }
    return [...map.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name))
  }, [enriched])

  // ── Filter + sort ───────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    let list = enriched

    if (pipelineFilters.size > 0) list = list.filter(o => pipelineFilters.has(o.status))
    if (paymentFilters.size  > 0) list = list.filter(o => paymentFilters.has(o._pressure.paymentState))
    if (jobTypeFilters.size  > 0) {
      list = list.filter(o => {
        for (const f of jobTypeFilters) {
          if (f === 'inscription') {
            if (o._serviceTypesUp.has('INSCRIPTION') || o._serviceTypesUp.has('INSCRIPTIONS')) return true
          } else {
            if (o._jobType === f) return true
          }
        }
        return false
      })
    }
    if (cemeteryFilter) list = list.filter(o => o.cemetery?.id === cemeteryFilter)
    if (needsAttentionOnly) {
      list = list.filter(o => {
        const sev = o._pressure.blocker?.severity
        return sev === 'red' || sev === 'amber'
      })
    }

    const needle = search.trim().toLowerCase()
    if (needle) {
      list = list.filter(o => {
        const hay = [
          o.order_number, o._familyName,
          o.customer?.first_name, o.customer?.last_name,
          o.customer?.phone_primary, o.customer?.email,
          o.cemetery?.name, o.cemetery?.city,
          o.sales_rep,
        ].filter(Boolean).join(' ').toLowerCase()
        return hay.includes(needle)
      })
    }

    const sorters = {
      // (Q4) Action priority — recency band first, then severity inside band.
      actionPriority: (a, b) => {
        const bandDiff = recencyBand(a.updated_at) - recencyBand(b.updated_at)
        if (bandDiff !== 0) return bandDiff
        const sevDiff = severityRank(a._pressure.blocker) - severityRank(b._pressure.blocker)
        if (sevDiff !== 0) return sevDiff
        return new Date(b.updated_at) - new Date(a.updated_at)
      },
      lastActivity: (a, b) => new Date(b.updated_at) - new Date(a.updated_at),
      ageDesc:      (a, b) => (b._pressure.ageDays || 0) - (a._pressure.ageDays || 0),
      balanceDesc:  (a, b) => b._balance - a._balance,
      totalDesc:    (a, b) => b._total - a._total,
      familyName:   (a, b) => (a._familyName || '').localeCompare(b._familyName || ''),
    }
    return [...list].sort(sorters[sortKey] || sorters.actionPriority)
  }, [enriched, pipelineFilters, paymentFilters, jobTypeFilters, cemeteryFilter, needsAttentionOnly, search, sortKey])

  const needsAttentionCount = useMemo(
    () => enriched.filter(o => {
      const sev = o._pressure.blocker?.severity
      return sev === 'red' || sev === 'amber'
    }).length,
    [enriched]
  )

  // (Q8) Active filter chip labels for the head-count echo line.
  const activeFilterLabels = useMemo(() => {
    const labels = []
    if (statusFilter !== 'active') {
      const cfg = STATUS_FILTERS.find(f => f.code === statusFilter)
      if (cfg) labels.push(cfg.label)
    }
    if (needsAttentionOnly) labels.push('Needs attention')
    for (const f of pipelineFilters) labels.push(PIPELINE_STAGE_FILTERS.find(x => x.code === f)?.label || f)
    for (const f of paymentFilters)  labels.push(PAYMENT_FILTERS.find(x => x.code === f)?.label || f)
    for (const f of jobTypeFilters)  labels.push(JOB_TYPE_FILTERS.find(x => x.code === f)?.label || f)
    if (cemeteryFilter) {
      const cem = cemeteryOptions.find(c => c.id === cemeteryFilter)
      if (cem) labels.push(cem.name)
    }
    if (search.trim()) labels.push(`"${search.trim()}"`)
    return labels
  }, [statusFilter, needsAttentionOnly, pipelineFilters, paymentFilters, jobTypeFilters, cemeteryFilter, cemeteryOptions, search])

  // ── KPIs — pipeline / overdue / collected / balance ─────────────────────
  // (Q5) "Sold in flight" replaced with "Overdue" — the more directly
  // actionable Tuesday-morning question is "how much of what I'm owed is
  // past due," not "how much have I sold but not yet shipped."
  const kpis = useMemo(() => {
    let pipeline = 0, overdue = 0, paid = 0, balance = 0
    for (const o of filtered) {
      if (ACTIVE_STATUSES.includes(o.status)) pipeline += o._total
      if (o._pressure.paymentState === 'overdue') overdue += o._balance
      paid    += o._paid
      balance += o._balance
    }
    return { pipeline, overdue, paid, balance }
  }, [filtered])

  // ── Filter helpers ──────────────────────────────────────────────────────
  const toggle = (set, setter) => (code) => {
    const next = new Set(set)
    if (next.has(code)) next.delete(code); else next.add(code)
    setter(next)
  }
  const resetAll = () => {
    setStatusFilter('active')
    setPipelineFilters(new Set())
    setPaymentFilters(new Set())
    setJobTypeFilters(new Set())
    setCemeteryFilter('')
    setNeedsAttentionOnly(false)
    setSearch('')
  }

  // ── Render ──────────────────────────────────────────────────────────────
  // Order Detail View takes over the surface when a row is selected.
  if (selectedOrderId) {
    return (
      <OrderDetail
        orderId={selectedOrderId}
        onBack={() => setSelectedOrderId(null)}
        onEditInSales={(id) => onEditOrder?.(id)}
        onOpenJob={onOpenJob}
        onOpenCustomer={onOpenCustomer}
      />
    )
  }

  return (
    <div className="sb-crm-page">
      <div className="sb-crm-container">

        <header className="sb-crm-head">
          <div>
            <h1 className="sb-crm-head-title">Orders</h1>
            <div className="sb-crm-head-count">
              <strong>{loading ? '—' : filtered.length}</strong>{' '}
              {filtered.length === 1 ? 'order' : 'orders'}
              {!loading && needsAttentionCount > 0 && (
                <> · <strong>{needsAttentionCount}</strong> need attention</>
              )}
              {!loading && activeFilterLabels.length > 0 && (
                <> · {activeFilterLabels.join(' · ')}</>
              )}
            </div>
          </div>
          <div className="sb-crm-head-actions">
            <input
              type="search"
              className="sb-crm-search"
              placeholder="Search name, order #, cemetery, rep…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            <select
              className="sb-crm-sort"
              value={sortKey}
              onChange={e => setSortKey(e.target.value)}
            >
              {SORT_OPTIONS.map(o => (
                <option key={o.code} value={o.code}>{o.label}</option>
              ))}
            </select>
            <button type="button" className="sb-crm-btn-primary" onClick={onNewOrder}>
              + New Order
            </button>
            <button type="button" className="sb-crm-btn-secondary" onClick={onOpenSales}>
              Sales wizard
            </button>
          </div>
        </header>

        {loadErr && <div className="sb-crm-error">{loadErr}</div>}

        {/* (Q7) Narrow-width advisory */}
        <div className="sb-crm-min-width-banner">
          Best viewed on desktop — this list uses a dense table layout. Phone view falls back to a single-column stack.
        </div>

        {/* 4 KPIs — (Q6) gated on `loading` so the operator doesn't see a
            false-zero flash of "$0 / $0 / $0 (green!) / $0" before the
            real numbers arrive. (Q5) "Sold in flight" replaced by "Overdue". */}
        <div className="sb-crm-metric-grid">
          <KpiCard label={statusFilter === 'active' ? 'Pipeline (active)' : 'Pipeline value'} value={loading ? '—' : fmtUSD(kpis.pipeline)} />
          <KpiCard label="Overdue" value={loading ? '—' : fmtUSD(kpis.overdue)} tone={!loading && kpis.overdue > 0 ? 'red' : null} />
          <KpiCard label="Collected" value={loading ? '—' : fmtUSD(kpis.paid)} />
          <KpiCard label="Balance due" value={loading ? '—' : fmtUSD(kpis.balance)} tone={!loading && kpis.balance > 0 ? 'red' : (loading ? null : 'green')} />
        </div>

        {/* Filter chips */}
        <div className="sb-crm-chip-row">
          <div className="sb-crm-chip-group">
            <span className="sb-crm-chip-group-label">Status</span>
            {STATUS_FILTERS.map(f => (
              <FilterChip
                key={f.code}
                active={statusFilter === f.code}
                onClick={() => setStatusFilter(f.code)}
              >
                {f.label}
              </FilterChip>
            ))}
          </div>
          <div className="sb-crm-chip-group">
            <FilterChip
              active={needsAttentionOnly}
              onClick={() => setNeedsAttentionOnly(v => !v)}
            >
              Needs attention
            </FilterChip>
          </div>
          <div className="sb-crm-chip-group">
            <span className="sb-crm-chip-group-label">Stage</span>
            {PIPELINE_STAGE_FILTERS.map(f => (
              <FilterChip
                key={f.code}
                active={pipelineFilters.has(f.code)}
                onClick={() => toggle(pipelineFilters, setPipelineFilters)(f.code)}
              >
                {f.label}
              </FilterChip>
            ))}
          </div>
          <div className="sb-crm-chip-group">
            <span className="sb-crm-chip-group-label">Payment</span>
            {PAYMENT_FILTERS.map(f => (
              <FilterChip
                key={f.code}
                active={paymentFilters.has(f.code)}
                onClick={() => toggle(paymentFilters, setPaymentFilters)(f.code)}
              >
                {f.label}
              </FilterChip>
            ))}
          </div>
          <div className="sb-crm-chip-group">
            <span className="sb-crm-chip-group-label">Job type</span>
            {JOB_TYPE_FILTERS.map(f => (
              <FilterChip
                key={f.code}
                active={jobTypeFilters.has(f.code)}
                onClick={() => toggle(jobTypeFilters, setJobTypeFilters)(f.code)}
              >
                {f.label}
              </FilterChip>
            ))}
          </div>
          {cemeteryOptions.length > 0 && (
            <div className="sb-crm-chip-group">
              <span className="sb-crm-chip-group-label">Cemetery</span>
              <select
                className="sb-crm-sort"
                value={cemeteryFilter}
                onChange={e => setCemeteryFilter(e.target.value)}
                style={{ minWidth: 160 }}
              >
                <option value="">All cemeteries</option>
                {cemeteryOptions.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* Table card — (Q9) Family leads, order# is the cross-reference */}
        <div className="sb-crm-card sb-crm-table">
          <div className="sb-crm-row sb-crm-row-head" style={{ gridTemplateColumns: ROW_GRID }}>
            <div>Family / Stone</div>
            <div>Order</div>
            <div>Cemetery</div>
            <div className="num">Total</div>
            <div className="num">Balance</div>
            <div>Stage</div>
            <div>Blocker</div>
            <div className="num">Age</div>
            <div className="num">Updated</div>
          </div>

          {loading ? (
            <div className="sb-crm-empty">Loading orders…</div>
          ) : filtered.length === 0 ? (
            <div className="sb-crm-empty">
              {/* (Q8) Specific copy for the "needs attention" zero case so it
                  reads as a positive ("caught up") not as a filter failure. */}
              {needsAttentionOnly && !pipelineFilters.size && !paymentFilters.size && !jobTypeFilters.size && !cemeteryFilter && !search.trim()
                ? 'No orders need attention right now.'
                : 'No orders match these filters.'}
              {!needsAttentionOnly && (
                <div>
                  <button type="button" onClick={resetAll}>Reset filters</button>
                </div>
              )}
            </div>
          ) : (
            filtered.map(o => <OrderRow key={o.id} order={o} onOpen={setSelectedOrderId} />)
          )}
        </div>

        {/* TODO: margin column behind Owner settings toggle —
            read job.actual_realized_margin_pct or projected_margin_pct.
            TODO: assigned rep column — surface when orders.sales_rep_id is populated.
            TODO: assigned crew column — depends on Phase 4 per-crew lane work.
            TODO: promised install/delivery date column — needs scheduler accountability.
            TODO: install/production readiness micro-indicator —
            chain of milestone statuses (production_completed → ready_to_install → installed). */}

      </div>
    </div>
  )
}

// =============================================================================
// OrderRow
// =============================================================================

function OrderRow({ order: o, onOpen }) {
  const stage = statusInfo(o.status)
  const p = o._pressure
  const pTone = paymentTone(p.paymentState)
  const pLabel = paymentLabel(p.paymentState)
  const balanceTone = o._balance <= 0 ? 'green' : (p.paymentState === 'overdue' ? 'red' : 'amber')
  const blocker = p.blocker
  const blockerSev = blocker?.severity || 'green'

  return (
    <button
      type="button"
      className="sb-crm-row"
      style={{ gridTemplateColumns: ROW_GRID }}
      onClick={() => onOpen?.(o.id)}
    >
      {/* (Q9) FAMILY / STONE — leads. The order# is a cross-reference column */}
      <div>
        <div className="sb-crm-primary">{o._familyName}</div>
        <div className="sb-crm-secondary">{jobTypeLabel(o._jobType, o.service_types)}</div>
      </div>

      {/* ORDER # */}
      <div>
        <div className="sb-crm-mono">{o.order_number || 'DRAFT'}</div>
      </div>

      {/* CEMETERY + rep */}
      <div>
        <div style={{ fontSize: 13, color: 'inherit' }}>{o.cemetery?.name || <span className="sb-crm-muted">—</span>}</div>
        {o.sales_rep && <div className="sb-crm-secondary">{o.sales_rep}</div>}
      </div>

      {/* TOTAL */}
      <div className="num">
        <span className="sb-crm-num">{o._total > 0 ? fmtUSD(o._total) : '—'}</span>
      </div>

      {/* BALANCE + micro-bar — (Q6) flex column with bar BELOW value so the
          64px bar doesn't collide with the dollar amount in a narrow cell */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
        {pLabel ? (
          <>
            <span className="sb-crm-num" style={{ color: balanceTone === 'red' ? '#B54040' : balanceTone === 'amber' ? '#B8842A' : '#1D9E75' }}>
              {o._balance > 0 ? fmtUSD(o._balance) : '$0'}
            </span>
            {o._total > 0 && <ProgressMicroBar fillRatio={o._fillRatio} tone={balanceTone} />}
          </>
        ) : (
          <span className="sb-crm-muted">—</span>
        )}
      </div>

      {/* STAGE pill */}
      <div>
        <Pill severity={mapStageToTone(o.status)}>{stage.label}</Pill>
      </div>

      {/* BLOCKER — (Q1) no "On track" pill; absence is the signal */}
      <div>
        {blocker && (
          <Pill severity={blockerSev}>
            {p.needsCall && <span className="sb-crm-call-dot" />}
            {blocker.label}
          </Pill>
        )}
      </div>

      {/* AGE — (Q10) "since signed / unsigned" eyebrow matching Customers */}
      <div className="num">
        <span className="sb-crm-num">{p.ageDays || 0}d</span>
        <div className="sb-crm-secondary" style={{ textAlign: 'right' }}>
          {o.signed_at ? 'since signed' : 'unsigned'}
        </div>
      </div>

      {/* UPDATED */}
      <div className="num">
        <span className="sb-crm-muted sb-crm-tabular">{fmtRelative(o.updated_at)}</span>
      </div>
    </button>
  )
}

function KpiCard({ label, value, tone }) {
  const fg = tone === 'red' ? '#B54040' : tone === 'green' ? '#1D9E75' : null
  return (
    <div className="sb-crm-card sb-crm-metric">
      <div className="sb-crm-metric-label">{label}</div>
      <div className="sb-crm-metric-value" style={fg ? { color: fg } : null}>{value}</div>
    </div>
  )
}

function jobTypeLabel(jobType, serviceTypes) {
  if (jobType === 'new_stone')       return 'New stone'
  if (jobType === 'mausoleum_door')  return 'Crypt door'
  if (jobType === 'cleaning_repair') return 'Cleaning / repair'
  const st = (serviceTypes || []).map(s => String(s).toUpperCase())
  if (st.includes('INSCRIPTION') || st.includes('INSCRIPTIONS')) return 'Inscription'
  if (st.includes('ACID_WASH')) return 'Acid wash'
  return 'Order'
}

// Map order status → semantic tone for the stage Pill. Bronze for in-flight,
// amber for waiting, green for closed-out, red for cancelled.
function mapStageToTone(status) {
  switch (status) {
    case 'draft':
    case 'scoping':       return 'bronze'
    case 'quoted':        return 'amber'
    case 'contracted':
    case 'in_production': return 'bronze'
    case 'installed':
    case 'paid_in_full':
    case 'closed':        return 'green'
    case 'cancelled':
    case 'archived':      return 'red'
    default:              return 'bronze'
  }
}
