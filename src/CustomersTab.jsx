// =============================================================================
// Stonebooks — Customers tab (CRM-RESKIN-PASS)
// =============================================================================
// Family/stone-first operational control surface. The customer record is
// secondary to the family identifier (monument shops think "the Walsh
// upright," not "John Walsh CRM record").
//
// Visual language matches TodayTab: canvas #F7F6F3, white cards with soft
// shadow, bronze accent on light. Shared primitives live in lib/crmTheme.jsx.
// CustomerDetail + AddCustomerForm at the bottom of the file are preserved
// from the previous design — only the list view is rebuilt.
// =============================================================================

import { useState, useEffect, useMemo } from 'react'
import {
  listAllCustomers, listArchivedCustomers, listOrdersForCustomer,
  createCustomer, archiveCustomer, unarchiveCustomer, deleteCustomer,
  getJobs,
  rowGrandTotal, rowTotalPaid, statusInfo,
  customerName, customerInitials, fmtUSD, fmtDate, fmtPhone, fmtRelative,
  computeOrderPressure,
  ACTIVE_STATUSES, SOLD_STATUSES,
} from './lib/stonebooksData'
import { CRM, paymentTone, paymentLabel } from './lib/crmTheme'
import { Pill, FilterChip, ProgressMicroBar } from './lib/crmComponents.jsx'
import { supabase } from './lib/supabase'

// ── Filter chip option shapes ────────────────────────────────────────────────

const STATUS_FILTERS = [
  { code: 'active',   label: 'Active' },
  { code: 'archived', label: 'Archived' },
]
const JOB_TYPE_FILTERS = [
  { code: 'new_stone',       label: 'New stone' },
  { code: 'mausoleum_door',  label: 'Crypt door' },
  { code: 'cleaning_repair', label: 'Cleaning-repair' },
  { code: 'inscription',     label: 'Inscription' },
]
const PAYMENT_FILTERS = [
  { code: 'paid_in_full', label: 'Paid in full' },
  { code: 'partial',      label: 'Partial' },
  { code: 'unpaid',       label: 'Unpaid' },
  { code: 'overdue',      label: 'Overdue' },
]
const BLOCKER_FILTERS = [
  { code: 'cemetery',     label: 'Cemetery',     match: k => k === 'cemetery_hold' },
  { code: 'family',       label: 'Family',       match: k => k === 'waiting_on_family' || k === 'proof_waiting_customer' },
  { code: 'production',   label: 'Production',   match: k => k === 'production_blocked' },
  { code: 'install_ready',label: 'Install ready',match: k => k === 'stone_ready_schedule_trip' || k === 'install_scheduled' || k === 'needs_install_date' },
]
const SORT_OPTIONS = [
  { code: 'actionPriority', label: 'Sort: Action priority' },
  { code: 'lastActivity',   label: 'Sort: Recent activity' },
  { code: 'familyName',     label: 'Sort: Family name A→Z' },
  { code: 'balanceDesc',    label: 'Sort: Balance high→low' },
  { code: 'ageDesc',        label: 'Sort: Age oldest first' },
  { code: 'signedNewest',   label: 'Sort: Signed newest' },
]

// (Q4) Recency band for action-priority sort: cluster rows into freshness
// windows so the eye still sees recent activity at the top, but within each
// band severity bubbles up. days = days since lastActivity.
const SEVERITY_RANK = { red: 0, amber: 1, blue: 2 }
function recencyBand(lastActivity) {
  if (!lastActivity) return 4
  const days = Math.floor((Date.now() - lastActivity) / 86400000)
  if (days <= 7)  return 0
  if (days <= 30) return 1
  if (days <= 90) return 2
  return 3
}
function severityRank(blocker) {
  if (!blocker) return 3
  return SEVERITY_RANK[blocker.severity] ?? 3
}

// Grid template: FAMILY | ORDER# | CONTACT | PAYMENT | AGE | BLOCKER | UPDATED
const ROW_GRID = '1.4fr 0.9fr 1.1fr 1.1fr 0.7fr 1.2fr 0.7fr'

// ── Component ────────────────────────────────────────────────────────────────

export default function CustomersTab({ selectedId, setSelectedId, onOpenOrder }) {
  const [customers, setCustomers] = useState([])
  const [allOrders, setAllOrders]   = useState([])
  const [allJobs, setAllJobs]       = useState([])
  const [loading, setLoading]       = useState(true)
  const [loadErr, setLoadErr]       = useState(null)
  const [search, setSearch]         = useState('')
  const [sortKey, setSortKey]       = useState('actionPriority')
  const [statusFilter, setStatusFilter] = useState('active')   // active | archived
  const [needsCallOnly, setNeedsCallOnly] = useState(false)
  const [jobTypeFilters, setJobTypeFilters] = useState(new Set())
  const [paymentFilters, setPaymentFilters] = useState(new Set())
  const [blockerFilters, setBlockerFilters] = useState(new Set())
  const [showAddForm, setShowAddForm] = useState(false)

  // ── Load ────────────────────────────────────────────────────────────────
  const reload = async () => {
    setLoading(true)
    setLoadErr(null)
    try {
      const [cs, ordersRes, jobs] = await Promise.all([
        statusFilter === 'archived' ? listArchivedCustomers() : listAllCustomers(),
        supabase.from('orders').select(
          'id, customer_id, status, order_number, updated_at, created_at, signed_at, pricing_locked_at, ' +
          'deposit_amount, balance_amount, payments, pricing, add_ons, ' +
          'target_completion_date, primary_lastname, deceased, service_types, cemetery_id, ' +
          'cemetery:cemeteries(id, name)'
        ),
        getJobs({ includeClosed: true, limit: 1000 }),
      ])
      setCustomers(cs || [])
      setAllOrders(ordersRes.data || [])
      setAllJobs(jobs || [])
    } catch (e) {
      setLoadErr(e?.message || 'Failed to load customers')
    }
    setLoading(false)
  }
  useEffect(() => { reload() /* eslint-disable-next-line */ }, [statusFilter])

  // ── Derive per-customer rollup ──────────────────────────────────────────
  const enriched = useMemo(() => {
    const jobByOrderId = new Map()
    for (const j of allJobs) {
      if (j.order_id) {
        // Keep the most-relevant job per order (highest sort_order proxy: first
        // is fine for now — multi-job orders are rare in current data).
        if (!jobByOrderId.has(j.order_id)) jobByOrderId.set(j.order_id, j)
      }
    }

    return customers.map(c => {
      const myOrders = allOrders.filter(o => o.customer_id === c.id)

      // (Q2 bug fix) Primary picker re-ranked to surface the squeakiest
      // wheel. Before: most-recently-updated SOLD won — which meant a
      // recently-paid_in_full hid an older active overdue. After:
      //   1) most recent SOLD with a non-null blocker (real action)
      //   2) most recent ACTIVE (in-flight regardless of blocker)
      //   3) most recent SOLD (paid_in_full / closed)
      //   4) most recent ANY (fallback for unsigned drafts)
      const byRecent = (a, b) => new Date(b.updated_at) - new Date(a.updated_at)
      const ordersWithPressure = myOrders.map(o => {
        const job = jobByOrderId.get(o.id) || null
        return { o, job, p: computeOrderPressure(o, job, job?.milestones) }
      })
      const tier1 = ordersWithPressure
        .filter(r => SOLD_STATUSES.includes(r.o.status) && r.p.blocker)
        .sort((a, b) => byRecent(a.o, b.o))
      const tier2 = ordersWithPressure
        .filter(r => ACTIVE_STATUSES.includes(r.o.status))
        .sort((a, b) => byRecent(a.o, b.o))
      const tier3 = ordersWithPressure
        .filter(r => SOLD_STATUSES.includes(r.o.status))
        .sort((a, b) => byRecent(a.o, b.o))
      const tier4 = ordersWithPressure
        .slice()
        .sort((a, b) => byRecent(a.o, b.o))
      const winner = tier1[0] || tier2[0] || tier3[0] || tier4[0] || null
      const primary = winner?.o || null
      const primaryJob = winner?.job || null
      const pressure = winner?.p || { blocker: null, needsCall: false, callReasons: [], paymentState: 'none', ageDays: 0 }

      const total   = primary ? rowGrandTotal(primary) : 0
      const paid    = primary ? rowTotalPaid(primary)  : 0
      const balance = Math.max(0, total - paid)
      const fillRatio = total > 0 ? paid / total : 0

      // Lifetime sums for sorts that span all orders
      let lifetimeBalance = 0
      let lastActivity = null
      const jobTypes = new Set()
      const serviceTypes = new Set()
      for (const o of myOrders) {
        const t = rowGrandTotal(o); const p = rowTotalPaid(o)
        if (SOLD_STATUSES.includes(o.status)) lifetimeBalance += Math.max(0, t - p)
        const upd = new Date(o.updated_at).getTime()
        if (!lastActivity || upd > lastActivity) lastActivity = upd
        const j = jobByOrderId.get(o.id)
        if (j?.job_type) jobTypes.add(j.job_type)
        for (const st of (o.service_types || [])) serviceTypes.add(String(st).toUpperCase())
      }

      // Deceased name for the primary order's sub-line
      let deceasedLabel = null
      const dec = primary?.deceased
      if (Array.isArray(dec) && dec.length > 0) {
        if (dec.length === 1) {
          const d = dec[0]
          const first = d.firstName || d.first_name || ''
          const last  = d.lastName  || d.last_name  || ''
          deceasedLabel = [first, last].filter(Boolean).join(' ').trim() || null
        } else {
          deceasedLabel = 'Companion stone'
        }
      }

      // Family name = primary order's primary_lastname (the stone's name),
      // falling back to the customer's last name.
      const familyName =
        (primary?.primary_lastname && String(primary.primary_lastname).trim()) ||
        (c.last_name && String(c.last_name).trim().toUpperCase()) ||
        customerName(c) ||
        '—'

      return {
        ...c,
        _primary:        primary || null,
        _primaryJob:     primaryJob,
        _pressure:       pressure,
        _primaryTotal:   total,
        _primaryPaid:    paid,
        _primaryBalance: balance,
        _fillRatio:      fillRatio,
        _lifetimeBalance: lifetimeBalance,
        _lastActivity:   lastActivity,
        _familyName:     familyName,
        _deceasedLabel:  deceasedLabel,
        _jobTypes:       jobTypes,
        _serviceTypes:   serviceTypes,
        _ordersCount:    myOrders.length,
      }
    })
  }, [customers, allOrders, allJobs])

  // ── Filter + sort ───────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    let list = enriched

    // Needs-call toggle
    if (needsCallOnly) list = list.filter(c => c._pressure.needsCall)

    // Job-type filter — match if ANY of the customer's orders has the type.
    // "inscription" matches by service_types since no job_type='inscription'
    // exists in current prod data.
    if (jobTypeFilters.size > 0) {
      list = list.filter(c => {
        for (const f of jobTypeFilters) {
          if (f === 'inscription') {
            if (c._serviceTypes.has('INSCRIPTION') || c._serviceTypes.has('INSCRIPTIONS')) return true
          } else {
            if (c._jobTypes.has(f)) return true
          }
        }
        return false
      })
    }

    // Payment filter — applies to PRIMARY order's paymentState
    if (paymentFilters.size > 0) {
      list = list.filter(c => paymentFilters.has(c._pressure.paymentState))
    }

    // Blocker filter — applies to PRIMARY order's blocker kind
    if (blockerFilters.size > 0) {
      list = list.filter(c => {
        const k = c._pressure.blocker?.kind
        if (!k) return false
        for (const f of blockerFilters) {
          const cfg = BLOCKER_FILTERS.find(x => x.code === f)
          if (cfg?.match(k)) return true
        }
        return false
      })
    }

    // Search across name, deceased, contact, order#
    const needle = search.trim().toLowerCase()
    if (needle) {
      list = list.filter(c => {
        const hay = [
          c._familyName, c._deceasedLabel,
          c.first_name, c.last_name, c.email,
          c.phone_primary, c.phone_secondary,
          c._primary?.order_number,
        ].filter(Boolean).join(' ').toLowerCase()
        return hay.includes(needle)
      })
    }

    const sorters = {
      // (Q4) Action priority — recency band first (so recent activity still
      // bubbles), then severity inside the band. Each band is sorted by
      // (severity asc, recency desc) so reds-in-band 0 land at the very top.
      actionPriority: (a, b) => {
        const bandDiff = recencyBand(a._lastActivity) - recencyBand(b._lastActivity)
        if (bandDiff !== 0) return bandDiff
        const sevDiff = severityRank(a._pressure.blocker) - severityRank(b._pressure.blocker)
        if (sevDiff !== 0) return sevDiff
        return (b._lastActivity || 0) - (a._lastActivity || 0)
      },
      lastActivity: (a, b) => (b._lastActivity || 0) - (a._lastActivity || 0),
      familyName:   (a, b) => (a._familyName || '').localeCompare(b._familyName || ''),
      balanceDesc:  (a, b) => b._lifetimeBalance - a._lifetimeBalance,
      ageDesc:      (a, b) => (b._pressure.ageDays || 0) - (a._pressure.ageDays || 0),
      signedNewest: (a, b) => new Date(b._primary?.signed_at || 0) - new Date(a._primary?.signed_at || 0),
    }
    return [...list].sort(sorters[sortKey] || sorters.actionPriority)
  }, [enriched, needsCallOnly, jobTypeFilters, paymentFilters, blockerFilters, search, sortKey])

  const needsCallCount = useMemo(
    () => enriched.filter(c => c._pressure.needsCall).length,
    [enriched]
  )

  // (Q8) Echo active filter chip labels in the head-count line so the
  // AND-between-groups logic is visible without a docs page.
  const activeFilterLabels = useMemo(() => {
    const labels = []
    if (statusFilter !== 'active') {
      const cfg = STATUS_FILTERS.find(f => f.code === statusFilter)
      if (cfg) labels.push(cfg.label)
    }
    if (needsCallOnly) labels.push('Needs call')
    for (const f of jobTypeFilters)  labels.push(JOB_TYPE_FILTERS.find(x => x.code === f)?.label || f)
    for (const f of paymentFilters)  labels.push(PAYMENT_FILTERS.find(x => x.code === f)?.label || f)
    for (const f of blockerFilters)  labels.push(BLOCKER_FILTERS.find(x => x.code === f)?.label || f)
    if (search.trim()) labels.push(`"${search.trim()}"`)
    return labels
  }, [statusFilter, needsCallOnly, jobTypeFilters, paymentFilters, blockerFilters, search])

  // ── Detail view delegated to existing component ─────────────────────────
  if (selectedId) {
    const customer = customers.find(c => c.id === selectedId)
    return (
      <CustomerDetail
        customer={customer}
        onBack={() => { setSelectedId(null); reload() }}
        onArchived={() => { setSelectedId(null); reload() }}
        onDeleted={() => { setSelectedId(null); reload() }}
        onOpenOrder={onOpenOrder}
      />
    )
  }

  // ── Filter chip helpers ─────────────────────────────────────────────────
  const toggle = (set, setter) => (code) => {
    const next = new Set(set)
    if (next.has(code)) next.delete(code); else next.add(code)
    setter(next)
  }
  const resetAll = () => {
    setSearch('')
    setNeedsCallOnly(false)
    setJobTypeFilters(new Set())
    setPaymentFilters(new Set())
    setBlockerFilters(new Set())
    setStatusFilter('active')
  }

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <div className="sb-crm-page">
      <div className="sb-crm-container">

        <header className="sb-crm-head">
          <div>
            <h1 className="sb-crm-head-title">Customers</h1>
            <div className="sb-crm-head-count">
              <strong>{loading ? '—' : filtered.length}</strong>{' '}
              {filtered.length === 1 ? 'customer' : 'customers'}
              {!loading && needsCallCount > 0 && (
                <> · <strong>{needsCallCount}</strong> need a call</>
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
              placeholder="Search name, deceased, phone, order #…"
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
            <button
              type="button"
              className="sb-crm-btn-primary"
              onClick={() => setShowAddForm(true)}
            >
              + Add customer
            </button>
          </div>
        </header>

        {loadErr && <div className="sb-crm-error">{loadErr}</div>}

        {/* (Q7) Narrow-width advisory — table is dense; mobile gets a stack
            but the operator is told this view is desktop-first until a
            proper mobile card-list lands. */}
        <div className="sb-crm-min-width-banner">
          Best viewed on desktop — this list uses a dense table layout. Phone view falls back to a single-column stack.
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
              active={needsCallOnly}
              onClick={() => setNeedsCallOnly(v => !v)}
            >
              Needs call
            </FilterChip>
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
            <span className="sb-crm-chip-group-label">Blocker</span>
            {BLOCKER_FILTERS.map(f => (
              <FilterChip
                key={f.code}
                active={blockerFilters.has(f.code)}
                onClick={() => toggle(blockerFilters, setBlockerFilters)(f.code)}
              >
                {f.label}
              </FilterChip>
            ))}
          </div>
        </div>

        {showAddForm && (
          <AddCustomerForm
            onCancel={() => setShowAddForm(false)}
            onCreated={() => { setShowAddForm(false); reload() }}
          />
        )}

        {/* Table card */}
        <div className="sb-crm-card sb-crm-table">
          <div className="sb-crm-row sb-crm-row-head" style={{ gridTemplateColumns: ROW_GRID }}>
            <div>Family / Stone</div>
            <div>Order</div>
            <div>Contact</div>
            <div>Payment</div>
            <div className="num">Age</div>
            <div>Blocker</div>
            <div className="num">Updated</div>
          </div>

          {loading ? (
            <div className="sb-crm-empty">Loading customers…</div>
          ) : filtered.length === 0 ? (
            <div className="sb-crm-empty">
              {/* (Q8) Specific copy for the most-frequent zero-result cases:
                  Needs-call alone = a "you're caught up" moment, not a bug.
                  Active + nothing = "no customers yet" greeting. Anything
                  else = generic filter-failure with reset. */}
              {needsCallOnly && !jobTypeFilters.size && !paymentFilters.size && !blockerFilters.size && !search.trim()
                ? 'No customers need a call right now.'
                : statusFilter === 'active' && !needsCallOnly && !jobTypeFilters.size && !paymentFilters.size && !blockerFilters.size && !search.trim()
                  ? 'No customers yet. Click "+ Add customer" to add your first.'
                  : 'No customers match these filters.'}
              {!needsCallOnly && (
                <div>
                  <button type="button" onClick={resetAll}>Reset filters</button>
                </div>
              )}
            </div>
          ) : (
            filtered.map(c => <CustomerRow key={c.id} customer={c} onOpen={setSelectedId} />)
          )}
        </div>

        {/* TODO: last_contact_at column — wire when a communications table lands.
            TODO: lifetime revenue — sum payments across all of c's orders; surface
                  behind an Owner settings toggle (column too noisy as default).
            TODO: family-repeat indicator — small "repeat" pill near family name
                  when c._ordersCount > 1 (deferred to next pass; data is here). */}

      </div>
    </div>
  )
}

// =============================================================================
// CustomerRow — the operational row
// =============================================================================

function CustomerRow({ customer: c, onOpen }) {
  const p = c._pressure
  const pTone = paymentTone(p.paymentState)
  const pLabel = paymentLabel(p.paymentState)
  const balance = c._primaryBalance
  const blocker = p.blocker
  const blockerSev = blocker?.severity || 'green'
  const updatedAt = c._lastActivity ? new Date(c._lastActivity).toISOString() : null

  return (
    <button
      type="button"
      className="sb-crm-row"
      style={{ gridTemplateColumns: ROW_GRID }}
      onClick={() => onOpen?.(c.id)}
    >
      {/* FAMILY / STONE */}
      <div>
        <div className="sb-crm-primary">{c._familyName}</div>
        <div className="sb-crm-secondary">
          {c._deceasedLabel
            ? c._deceasedLabel
            : c._primary
              ? 'Stone TBD'                       /* Q10: primary exists but deceased not filled */
              : c._ordersCount > 1 ? `${c._ordersCount} orders on file` : 'No order yet'}
        </div>
      </div>

      {/* ORDER + job type pill */}
      <div>
        <div className="sb-crm-mono">{c._primary?.order_number || '—'}</div>
        {c._primary && (
          <div style={{ marginTop: 4 }}>
            <Pill severity="bronze">{jobTypeLabel(c._primaryJob?.job_type, c._primary?.service_types)}</Pill>
          </div>
        )}
      </div>

      {/* CONTACT — actual person you call */}
      <div onClick={e => e.stopPropagation()}>
        <div style={{ fontSize: 13, color: CRM.ink }}>
          {[c.first_name, c.last_name].filter(Boolean).join(' ').trim() || '—'}
        </div>
        {c.phone_primary && (
          <a className="sb-crm-tel" href={`tel:${c.phone_primary}`}>
            {fmtPhone(c.phone_primary)}
          </a>
        )}
      </div>

      {/* PAYMENT — pill + micro-bar */}
      <div>
        {pLabel ? (
          <>
            <Pill severity={pTone}>{pLabel}</Pill>
            {c._primaryTotal > 0 && (
              <ProgressMicroBar fillRatio={c._fillRatio} tone={pTone === 'red' ? 'red' : pTone === 'amber' ? 'amber' : 'green'} />
            )}
            {balance > 0 && (
              <div className="sb-crm-secondary sb-crm-tabular">{fmtUSD(balance)} due</div>
            )}
          </>
        ) : (
          <span className="sb-crm-muted">—</span>
        )}
      </div>

      {/* AGE — days since signed */}
      <div className="num">
        <span className="sb-crm-num">{p.ageDays || 0}d</span>
        <div className="sb-crm-secondary" style={{ textAlign: 'right' }}>
          {c._primary?.signed_at ? 'since signed' : 'unsigned'}
        </div>
      </div>

      {/* BLOCKER — Q1: no "On track" pill; absence of a blocker is the signal */}
      <div>
        {blocker && (
          <Pill severity={blockerSev}>
            {p.needsCall && <span className="sb-crm-call-dot" />}
            {blocker.label}
          </Pill>
        )}
      </div>

      {/* UPDATED */}
      <div className="num">
        <span className="sb-crm-muted sb-crm-tabular">{updatedAt ? fmtRelative(updatedAt) : '—'}</span>
      </div>
    </button>
  )
}

function jobTypeLabel(jobType, serviceTypes) {
  if (jobType === 'new_stone')       return 'New stone'
  if (jobType === 'mausoleum_door')  return 'Crypt door'
  if (jobType === 'cleaning_repair') return 'Cleaning/Repair'
  const st = (serviceTypes || []).map(s => String(s).toUpperCase())
  if (st.includes('INSCRIPTION') || st.includes('INSCRIPTIONS')) return 'Inscription'
  if (st.includes('ACID_WASH')) return 'Acid wash'
  return 'Order'
}

// =============================================================================
// CustomerDetail — preserved from prior design (existing flow per sprint spec)
// =============================================================================

function CustomerDetail({ customer, onBack, onArchived, onDeleted, onOpenOrder }) {
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(null)
  const [err, setErr] = useState(null)

  useEffect(() => {
    if (!customer?.id) return
    listOrdersForCustomer(customer.id).then(o => {
      setOrders(o)
      setLoading(false)
    })
  }, [customer?.id])

  if (!customer) return (
    <div className="sb-page sb-page-wide">
      <div className="sb-empty">Customer not found.</div>
      <button type="button" className="sb-link" onClick={onBack}>← All customers</button>
    </div>
  )

  const isArchived = !!customer.archived
  const lifetimeValue = orders
    .filter(o => SOLD_STATUSES.includes(o.status))
    .reduce((s, o) => s + rowGrandTotal(o), 0)
  const totalCollected = orders.reduce((s, o) => s + rowTotalPaid(o), 0)
  const balanceDue = orders
    .filter(o => SOLD_STATUSES.includes(o.status))
    .reduce((s, o) => s + Math.max(0, rowGrandTotal(o) - rowTotalPaid(o)), 0)

  const doArchive = async () => {
    if (!confirm(`Archive ${customerName(customer)}? Their order history is preserved. They'll be hidden from the active customer list but accessible via the Archived filter.`)) return
    setBusy('archive'); setErr(null)
    const r = await archiveCustomer(customer.id)
    setBusy(null)
    if (!r.ok) setErr(r.error)
    else onArchived()
  }

  const doRestore = async () => {
    if (!confirm(`Restore ${customerName(customer)} to the active list?`)) return
    setBusy('restore'); setErr(null)
    const r = await unarchiveCustomer(customer.id)
    setBusy(null)
    if (!r.ok) setErr(r.error)
    else onArchived()
  }

  const doDelete = async () => {
    if (orders.length > 0) {
      alert(`Can't permanently delete — ${customerName(customer)} has ${orders.length} order${orders.length === 1 ? '' : 's'} attached. Archive instead to preserve the history.`)
      return
    }
    const ack = prompt(`PERMANENTLY DELETE ${customerName(customer)}? This cannot be undone. Type DELETE to confirm.`)
    if (ack !== 'DELETE') return
    setBusy('delete'); setErr(null)
    const r = await deleteCustomer(customer.id)
    setBusy(null)
    if (!r.ok) setErr(r.error)
    else onDeleted()
  }

  return (
    <div className="sb-page sb-page-wide">
      <button type="button" className="sb-link" onClick={onBack} style={{ marginBottom: 12 }}>← All customers</button>

      <div className="sb-cust-detail-head">
        <div className="sb-cust-avatar sb-cust-avatar-lg">{customerInitials(customer)}</div>
        <div style={{ flex: 1 }}>
          <h1 className="sb-page-title">
            {customerName(customer)}
            {isArchived && <span className="sb-archived-tag">Archived</span>}
          </h1>
          <div className="sb-cust-detail-meta">
            {customer.phone_primary && <span>{fmtPhone(customer.phone_primary)}</span>}
            {customer.email && <span>{customer.email}</span>}
            {(customer.city || customer.state) && <span>{[customer.city, customer.state].filter(Boolean).join(', ')}</span>}
          </div>
        </div>
        <div className="sb-cust-detail-actions">
          {!isArchived && (
            <button type="button" className="sb-btn-secondary" onClick={doArchive} disabled={busy !== null}>
              {busy === 'archive' ? 'Archiving…' : 'Archive'}
            </button>
          )}
          {isArchived && (
            <button type="button" className="sb-btn-secondary" onClick={doRestore} disabled={busy !== null}>
              {busy === 'restore' ? 'Restoring…' : 'Restore'}
            </button>
          )}
          <button
            type="button"
            className="sb-link sb-link-danger"
            onClick={doDelete}
            disabled={busy !== null}
            title={orders.length > 0 ? 'Customers with orders can only be archived.' : 'Permanently delete this customer'}
          >
            {busy === 'delete' ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      </div>

      {err && <div className="sb-msg sb-msg-err" style={{ marginTop: 8 }}>{err}</div>}

      <div className="sb-metric-grid" style={{ marginTop: 24 }}>
        <Metric label="Orders" value={orders.length} />
        <Metric label="Active" value={orders.filter(o => ACTIVE_STATUSES.includes(o.status)).length} />
        <Metric label="Lifetime value" value={fmtUSD(lifetimeValue)} />
        <Metric label="Collected" value={fmtUSD(totalCollected)} />
        <Metric label="Balance due" value={fmtUSD(balanceDue)} accent={balanceDue > 0 ? 'amber' : null} />
      </div>

      <div className="sb-section-label">Address</div>
      <div className="sb-card">
        {customer.address_line1 ? (
          <>
            <div>{customer.address_line1}</div>
            {customer.address_line2 && <div>{customer.address_line2}</div>}
            <div>{[customer.city, customer.state, customer.zip].filter(Boolean).join(', ')}</div>
          </>
        ) : (
          <div className="sb-muted">No address on file</div>
        )}
      </div>

      {customer.notes && (
        <>
          <div className="sb-section-label">Notes</div>
          <div className="sb-card sb-prewrap">{customer.notes}</div>
        </>
      )}

      <div className="sb-section-label">Order history</div>
      {loading ? (
        <div className="sb-empty">Loading orders…</div>
      ) : orders.length === 0 ? (
        <div className="sb-empty">No orders yet.</div>
      ) : (
        <div className="sb-order-list">
          {orders.map(o => {
            const status = statusInfo(o.status)
            const total = rowGrandTotal(o)
            const paid = rowTotalPaid(o)
            return (
              <button
                key={o.id}
                type="button"
                className="sb-order-card sb-order-card-clickable"
                onClick={() => onOpenOrder?.(o.id)}
              >
                <div className="sb-order-card-head">
                  <div>
                    <div className="sb-order-num">#{o.order_number || 'DRAFT'}</div>
                    <div className="sb-order-meta">
                      {o.cemetery?.name && <span>{o.cemetery.name}</span>}
                      <span className="sb-muted">created {fmtDate(o.created_at)}</span>
                    </div>
                  </div>
                  <span className="sb-status-pill" style={{ '--pill-color': status.color }}>
                    {status.label}
                  </span>
                </div>
                <div className="sb-order-card-body">
                  <div>
                    <div className="sb-meta-label">Total</div>
                    <div className="sb-mono">{total > 0 ? fmtUSD(total) : '—'}</div>
                  </div>
                  <div>
                    <div className="sb-meta-label">Collected</div>
                    <div className="sb-mono">{paid > 0 ? fmtUSD(paid) : '—'}</div>
                  </div>
                  <div>
                    <div className="sb-meta-label">Balance</div>
                    <div className="sb-mono">{(total - paid > 0) ? fmtUSD(total - paid) : '—'}</div>
                  </div>
                  <div>
                    <div className="sb-meta-label">Target</div>
                    <div className="sb-mono">{o.target_completion_date ? fmtDate(o.target_completion_date) : '—'}</div>
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

function Metric({ label, value, accent }) {
  return (
    <div className={`sb-metric ${accent ? `sb-metric-${accent}` : ''}`}>
      <div className="sb-metric-label">{label}</div>
      <div className="sb-metric-value">{value}</div>
    </div>
  )
}

function AddCustomerForm({ onCancel, onCreated }) {
  const [form, setForm] = useState({
    firstName: '', lastName: '',
    phonePrimary: '', email: '',
    addressLine1: '', city: '', state: 'NJ', zip: '',
    notes: '',
  })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const submit = async (e) => {
    e.preventDefault()
    if (!form.firstName && !form.lastName) { setErr('First or last name required'); return }
    setBusy(true); setErr(null)
    const r = await createCustomer(form)
    setBusy(false)
    if (!r.ok) setErr(r.error)
    else onCreated()
  }

  return (
    <form className="sb-card sb-add-form" onSubmit={submit}>
      <div className="sb-section-label" style={{ marginTop: 0 }}>Add customer</div>
      <div className="sb-form-grid">
        <Field label="First name"><input className="sb-input" value={form.firstName} onChange={e => set('firstName', e.target.value)} autoFocus /></Field>
        <Field label="Last name"><input className="sb-input" value={form.lastName} onChange={e => set('lastName', e.target.value)} /></Field>
        <Field label="Phone"><input className="sb-input" value={form.phonePrimary} onChange={e => set('phonePrimary', e.target.value)} placeholder="(732) 555-0123" /></Field>
        <Field label="Email"><input type="email" className="sb-input" value={form.email} onChange={e => set('email', e.target.value)} /></Field>
        <Field label="Address" wide><input className="sb-input" value={form.addressLine1} onChange={e => set('addressLine1', e.target.value)} /></Field>
        <Field label="City"><input className="sb-input" value={form.city} onChange={e => set('city', e.target.value)} /></Field>
        <Field label="State"><input className="sb-input" value={form.state} onChange={e => set('state', e.target.value)} /></Field>
        <Field label="ZIP"><input className="sb-input" value={form.zip} onChange={e => set('zip', e.target.value)} /></Field>
        <Field label="Notes" wide><textarea className="sb-input" rows={2} value={form.notes} onChange={e => set('notes', e.target.value)} /></Field>
      </div>
      {err && <div className="sb-msg sb-msg-err">{err}</div>}
      <div className="sb-form-actions">
        <button type="submit" className="sb-btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Create customer'}</button>
        <button type="button" className="sb-btn-secondary" onClick={onCancel} disabled={busy}>Cancel</button>
      </div>
    </form>
  )
}

function Field({ label, wide, children }) {
  return (
    <div className={`sb-field ${wide ? 'sb-field-wide' : ''}`}>
      <label className="sb-label">{label}</label>
      {children}
    </div>
  )
}
