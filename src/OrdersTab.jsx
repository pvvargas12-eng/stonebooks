// =============================================================================
// Stonebooks — Orders Triage Workbench
// =============================================================================
// The order control surface + bulk operations. Massive selection (per-row,
// page, select-all-N-matching, shift-range), an Active/Archived/All archive
// toggle, a sticky bulk-action bar (archive/restore · set status · set job type
// · set stage · set cemetery · export CSV) where every mutation is ONE batched
// .update().in(...) with a confirm-count + undo toast, rich filters + quick
// views, inline quick-edit of status/stage/job-type, a missing-info badge, a
// totals footer, and client-side pagination (50/page) that keeps 230+ rows fast.
// Money never recomputes/mutates unless that IS the action; no hard deletes.
// =============================================================================

import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import {
  listAllOrders, getJobs,
  statusInfo, customerName,
  rowGrandTotal, rowTotalPaid, rowBalanceDue,
  fmtUSD,
  computeOrderPressure,
  ORDER_STATUSES, ACTIVE_STATUSES,
  bulkArchiveOrders, bulkRestoreOrders, bulkSetOrderStatus,
  bulkSetOrderCemetery, bulkSetJobType, bulkSetStage, bulkUpdateOrders,
  classifyOrderQueues, queueLabel, permitBuckets,
  // Orders-redesign status dimensions (one source of truth)
  PAYMENT_STATUS, DESIGN_STATUS, STONE_STATUS, FDN_STATUS,
  derivePaymentStatus, deriveDesignStatus, deriveStoneStatus, deriveFdnStatus,
  setOrderDesignStatus, setOrderStoneStatus, setOrderFdnStatus, orderStatusWritePlan,
  setBlockReason, milestoneDone, orderContractTotal,
} from './lib/stonebooksData'
import { FilterChip } from './lib/crmComponents.jsx'
import { toCSV, downloadCSV } from './lib/exportCsv'
import { cachedFetch, peekCache, invalidateCache } from './lib/dataCache'

// Trimmed column set for the Orders board — ONLY what the list + status/payment
// derivations read (verified against every helper). Heavy jsonb (deceased,
// designs, design_snapshot, mausoleum_intake, element_filters, …) is NOT here —
// the detail view fetches the full row. Keeps the board fetch ~0.4MB vs ~1.0MB.
const ORDERS_BOARD_SELECT =
  'id, status, archived, order_number, created_at, updated_at, signed_at, pricing_locked_at, ' +
  'target_completion_date, primary_lastname, sales_rep, service_types, shape, granite_color, ' +
  'width_inches, standard_size_code, pricing, add_ons, contract_total, payments, deposit_amount, ' +
  'balance_amount, payment_status, permit_required, permit_status, customer_id, cemetery_id, ' +
  'next_follow_up, waiting_on, lost_reason, lost_at, ' +
  'customer:customers(id, first_name, last_name, email, phone_primary), cemetery:cemeteries(id, name)'
const ORDERS_KEY = (archiveView) => `orders:board:${archiveView}`
const JOBS_KEY = 'jobs:all'   // getJobs(includeClosed) — shared with CustomersTab
import OrderDetail from './OrderDetail.jsx'
import LeadsView from './components/LeadsView.jsx'
import NewLeadModal from './components/NewLeadModal.jsx'
import { LEAD_STATUSES } from './lib/leads'

// ── Constants ────────────────────────────────────────────────────────────────
const PAGE_SIZE = 50

const ARCHIVE_VIEWS = [
  { code: 'active',   label: 'Active' },
  { code: 'archived', label: 'Archived' },
  { code: 'all',      label: 'All' },
]
const PIPELINE_STAGE_FILTERS = [
  { code: 'draft',         label: 'Draft' },
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
const SERVICE_TYPE_FILTERS = [
  { code: 'NEW_STONE',   label: 'New stone' },
  { code: 'INSCRIPTION', label: 'Inscription' },
  { code: 'REPAIR',      label: 'Repair' },
  { code: 'ACID_WASH',   label: 'Acid wash' },
  { code: 'BRONZE',      label: 'Bronze' },
  { code: 'MAUSOLEUM',   label: 'Mausoleum' },
]
// Job types settable in the bulk/inline editor (job_type lives on jobs).
const JOB_TYPES = [
  { code: 'new_stone',       label: 'New stone' },
  { code: 'inscription',     label: 'Inscription' },
  { code: 'bronze',          label: 'Bronze' },
  { code: 'cleaning_repair', label: 'Cleaning / repair' },
  { code: 'mausoleum_door',  label: 'Crypt door' },
]
// new_stone milestone vocabulary for the stage dropdown (advance-only).
const NEW_STONE_STAGES = [
  'contract_signed', 'deposit_received', 'design_needed', 'proof_created', 'proof_sent',
  'proof_approved', 'stone_ordered', 'stone_received', 'stencil_created', 'stencil_cut',
  'production_started', 'production_completed', 'foundation_poured', 'ready_to_install', 'installed',
]
const SORT_OPTIONS = [
  { code: 'createdDesc',    label: 'Sort: Newest first' },
  { code: 'actionPriority', label: 'Sort: Action priority' },
  { code: 'lastActivity',   label: 'Sort: Recent activity' },
  { code: 'ageDesc',        label: 'Sort: Age oldest first' },
  { code: 'balanceDesc',    label: 'Sort: Balance high→low' },
  { code: 'totalDesc',      label: 'Sort: Total high→low' },
  { code: 'depositDesc',    label: 'Sort: Deposit high→low' },
  { code: 'familyName',     label: 'Sort: Family name A→Z' },
]
const QUICK_VIEWS = [
  { code: 'active_pipeline', label: 'Active pipeline' },
  { code: 'owes_balance',    label: 'Owes balance' },
  { code: 'needs_info',      label: 'Needs info' },
  { code: 'deposit_only',    label: 'Deposit-only' },
  { code: 'archived',        label: 'Archived' },
]

// checkbox | family | order# | customer name | job type | payment | design | stone | fdn | cemetery | contract | due
// Family / Order# / Customer-name are explicit first columns. Total column was
// removed; the freed width goes to Family + Customer (1.7fr each) so full names
// show without truncation. Widths are draggable — a header handle pins that
// column to px; the rest stay fractional.
const DEFAULT_COLS = ['32px', '1.7fr', '0.8fr', '1.7fr', '0.9fr', '1fr', '1.2fr', '1.3fr', '1fr', '1.3fr', '1fr', '1fr']
const COL_RESIZE = { position: 'absolute', top: 0, right: 0, width: 7, height: '100%', cursor: 'col-resize', userSelect: 'none', zIndex: 2 }

// Display-only title-casing (never alters stored data). Caps the first letter of
// each word/part — handles spaces, hyphens, apostrophes. "BARRY LEDERMAN" →
// "Barry Lederman"; "IVANCHENKO" → "Ivanchenko"; "SMITH-JONES" → "Smith-Jones".
const titleCaseName = (s) => String(s || '').toLowerCase().replace(/(^|[\s'’-])([a-z])/g, (_, sep, c) => sep + c.toUpperCase())

// +5 months for a new_stone due-date default (the contract+5mo rule). Pure
// local date math (no UTC drift): returns 'YYYY-MM-DD' or null.
function plusFiveMonthsISO(contractISO) {
  if (!contractISO) return null
  const s = String(contractISO).slice(0, 10)
  const [y, m, d] = s.split('-').map(Number)
  if (!y || !m || !d) return null
  const mi = (m - 1) + 5
  const yy = y + Math.floor(mi / 12)
  const mm = (mi % 12) + 1
  return `${yy}-${String(mm).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}
// Timestamp/date column → 'YYYY-MM-DD' for the inline date input.
function toDateInput(v) { return v ? String(v).slice(0, 10) : '' }
// Today as YYYY-MM-DD. Call only in handlers (never during render — purity).
function _todayInput() { const d = new Date(); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` }

const humanizeKey = (s) => s == null ? '' : String(s).replace(/[_-]/g, ' ').replace(/\b\w/g, c => c.toUpperCase())

const SEVERITY_RANK = { red: 0, amber: 1, blue: 2 }
function recencyBand(updatedAt) {
  if (!updatedAt) return 4
  const days = Math.floor((Date.now() - new Date(updatedAt).getTime()) / 86400000)
  if (days <= 7) return 0
  if (days <= 30) return 1
  if (days <= 90) return 2
  return 3
}
function severityRank(blocker) { return blocker ? (SEVERITY_RANK[blocker.severity] ?? 3) : 3 }

// ── Clickable column sort helpers ───────────────────────────────────────────
// Every meaningful Orders column is click-sortable (asc base; sortDir flips it).
const CLICK_SORT_KEYS = new Set([
  'customer', 'jobType', 'payment', 'design', 'stone', 'fdn',
  'total', 'cemeteryName', 'paymentStatus', 'dueDate',
])
// Date compare with nulls sorting last (ascending base).
function cmpMaybeDate(a, b) {
  const ta = a ? new Date(a).getTime() : Infinity
  const tb = b ? new Date(b).getTime() : Infinity
  return ta - tb
}
// Payment grouping rank: Paid (0) → Deposit (1) → Not paid (2).
function payRank(o) {
  if ((o._total || 0) > 0 && (o._balance || 0) <= 0) return 0   // paid in full
  if ((o._paid || 0) > 0) return 1                              // deposit / partial
  return 2                                                      // nothing paid
}
// Status-dimension progress ranks (workflow order). Null/absent → -1 so
// not-started/no-job rows group together at the top of an ascending sort.
const _PAY_DIM_RANK    = { quoted: 0, deposit: 1, paid_in_full: 2 }
const _DESIGN_DIM_RANK = { not_created: 0, layout_created: 1, needs_adjustments: 2, layout_approved: 3 }
const _STONE_DIM_RANK  = { not_ordered: 0, ordered: 1, in_stock: 2, needs_pickup: 3, needs_stencil_cut: 4, needs_blasting: 5, blasted: 6 }
const _FDN_DIM_RANK    = { na: 0, not_in: 1, need_map: 2, dug: 3, poured: 4, in: 5 }
const dimRank = (map, v) => (v != null && map[v] != null ? map[v] : -1)

// Furthest-done milestone on a job → { key, label }.
function furthestStage(job) {
  const ms = job?.milestones || []
  let best = null
  for (const m of ms) {
    if (m.status === 'done' && (!best || (m.sort_order ?? 0) > (best.sort_order ?? 0))) best = m
  }
  return best ? { key: best.milestone_key, label: best.label || humanizeKey(best.milestone_key) } : null
}

// ── Component ────────────────────────────────────────────────────────────────
export default function OrdersTab({ onOpenSales, onOpenOrder, onNewOrder, onEditOrder, onOpenCustomer, onOpenJob, onOpenHub, initialQueue = null, onConsumeInitialQueue, initialSelectedId = null, onConsumeInitialSelected, initialAction = null, onConsumeInitialAction }) {
  const [selectedOrderId, setSelectedOrderId] = useState(null)
  const [view, setView] = useState('orders')   // 'orders' | 'leads' — additive Leads pipeline
  // Seed from the cross-mount cache so re-opening Orders renders instantly
  // (default archiveView is 'active'). loading starts false only when both
  // datasets are already cached.
  const [orders, setOrders] = useState(() => peekCache(ORDERS_KEY('active')) ?? [])
  const [allJobs, setAllJobs] = useState(() => peekCache(JOBS_KEY) ?? [])
  const [loading, setLoading] = useState(() => peekCache(ORDERS_KEY('active')) === undefined || peekCache(JOBS_KEY) === undefined)
  const [loadErr, setLoadErr] = useState(null)
  const [reloadNonce, setReloadNonce] = useState(0)

  // Filters
  const [archiveView, setArchiveView] = useState('active')
  const [pipelineFilters, setPipelineFilters] = useState(new Set())
  const [paymentFilters, setPaymentFilters] = useState(new Set())
  const [jobTypeFilters, setJobTypeFilters] = useState(new Set())
  const [serviceTypeFilters, setServiceTypeFilters] = useState(new Set())
  const [hasDeposit, setHasDeposit] = useState(false)
  const [owesBalance, setOwesBalance] = useState(false)
  const [needsAttentionOnly, setNeedsAttentionOnly] = useState(false)
  const [cemeteryFilter, setCemeteryFilter] = useState('')
  const [quickView, setQuickView] = useState(null)
  const [queueFilter, setQueueFilter] = useState(null)   // workflow-queue code from the Queues dashboard
  const [sortKey, setSortKey] = useState('createdDesc')   // default: newest by creation date
  const [sortDir, setSortDir] = useState('asc')   // C1 — direction for click-sortable columns
  // Item 6 — draggable column widths. Each cols[] entry is a grid track; dragging
  // a header handle pins that column to a px width, others keep their fr ratio.
  const [cols, setCols] = useState(DEFAULT_COLS)
  const grid = cols.join(' ')
  const startColResize = (i) => (e) => {
    e.preventDefault(); e.stopPropagation()
    const startX = e.clientX
    const cell = e.currentTarget.parentElement
    const startW = cell ? cell.getBoundingClientRect().width : 120
    const onMove = (ev) => {
      const w = Math.max(48, Math.round(startW + (ev.clientX - startX)))
      setCols(prev => prev.map((c, idx) => (idx === i ? `${w}px` : c)))
    }
    const onUp = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }
  // C1 — click a column header: same column toggles asc/desc, a new column
  // starts ascending.
  const handleHeaderSort = (key) => {
    if (sortKey === key) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortKey(key); setSortDir('asc') }
  }
  const sortCaret = (key) => (sortKey !== key ? '' : sortDir === 'asc' ? ' ↑' : ' ↓')
  const [search, setSearch] = useState('')
  const [newLeadOpen, setNewLeadOpen] = useState(false)   // first-call lead intake modal

  // Selection + pagination
  const [selectedIds, setSelectedIds] = useState(() => new Set())
  const lastIndexRef = useRef(null)
  const [page, setPage] = useState(0)

  // Bulk action confirm + busy (no toast)
  const [confirm, setConfirm] = useState(null)  // { title, body, run }
  const [busy, setBusy] = useState(false)       // bulk ops + confirm modal only

  // ── Load (by archive view) ────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    const oKey = ORDERS_KEY(archiveView)
    const archived = archiveView === 'all' ? undefined : (archiveView === 'archived')
    // Only show the spinner when a dataset isn't already cached — a cached
    // re-entry stays instant. cachedFetch returns cached data within the TTL and
    // refetches in the background otherwise.
    if (peekCache(oKey) === undefined || peekCache(JOBS_KEY) === undefined) setLoading(true)
    setLoadErr(null)
    Promise.all([
      cachedFetch(oKey, () => listAllOrders({ archived, limit: 2000, select: ORDERS_BOARD_SELECT })),
      cachedFetch(JOBS_KEY, () => getJobs({ includeClosed: true, limit: 2000 })),
    ])
      .then(([rows, jobs]) => {
        if (cancelled) return
        setOrders(rows || []); setAllJobs(jobs || []); setLoading(false)
      })
      .catch(e => { if (!cancelled) { setLoadErr(e?.message || 'Failed to load orders'); setLoading(false) } })
    return () => { cancelled = true }
  }, [archiveView, reloadNonce])

  const reload = useCallback(() => { invalidateCache('orders:board'); invalidateCache(JOBS_KEY); setReloadNonce(n => n + 1) }, [])

  // Convert a lead → real order on the SAME row: promote out of the lead-status
  // range (draft/scoping/quoted) to 'contracted' so it leaves Leads and lands in
  // Orders, then open the full OrderForm pre-filled on that row. deriveStatus in
  // OrderForm never downgrades, so saving keeps it ≥ contracted. No new record.
  const convertLead = useCallback(async (id) => {
    await bulkSetOrderStatus([id], 'contracted')
    invalidateCache('orders:board')
    onEditOrder?.(id)
  }, [onEditOrder])

  // Consume an incoming queue selection from the Queues dashboard: clear other
  // filters, force the active view, apply the queue, and tell the parent it's
  // consumed (so re-entering Orders normally doesn't re-apply it).
  // Deep-link to a specific order's detail (ITEM 5 — closeout task from the
  // Jobs Admin Hub lands directly on OrderDetail). Mirrors the cemetery
  // initialSelectedId pattern (guarded setState).
  useEffect(() => {
    if (initialSelectedId && initialSelectedId !== selectedOrderId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSelectedOrderId(initialSelectedId)
      onConsumeInitialSelected?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSelectedId])

  useEffect(() => {
    if (!initialQueue) return
    setQueueFilter(initialQueue)
    setArchiveView('active'); setQuickView(null)
    setPipelineFilters(new Set()); setPaymentFilters(new Set()); setJobTypeFilters(new Set())
    setServiceTypeFilters(new Set()); setCemeteryFilter(''); setHasDeposit(false); setOwesBalance(false)
    setNeedsAttentionOnly(false); setSearch('')
    onConsumeInitialQueue?.()
  }, [initialQueue, onConsumeInitialQueue])

  // ── Enrich ──────────────────────────────────────────────────────────────
  const enriched = useMemo(() => {
    const jobByOrderId = new Map()
    for (const j of allJobs) if (j.order_id && !jobByOrderId.has(j.order_id)) jobByOrderId.set(j.order_id, j)
    return orders.map(o => {
      const job = jobByOrderId.get(o.id) || null
      const pressure = computeOrderPressure(o, job, job?.milestones)
      const total = rowGrandTotal(o)
      const paid = rowTotalPaid(o)          // excludes voided + drafts (corrections A)
      const balance = rowBalanceDue(o)      // 0 when no total (correction B)
      const stage = furthestStage(job)
      const familyName =
        (o.primary_lastname && String(o.primary_lastname).trim()) ||
        (o.customer?.last_name && String(o.customer.last_name).trim().toUpperCase()) ||
        customerName(o.customer) || '—'
      const missingInfo = !o.shape || !o.granite_color || (!o.width_inches && !o.standard_size_code)
      const isNewStone = job?.job_type === 'new_stone'
      // Set-gate chip surfaces only once the stone is blasted (physical work
      // done) but not yet installed — i.e. "ready to set, blocked by X". Shares
      // setBlockReason with the Jobs hubs + Scheduler blocked panel.
      const setBlock = (isNewStone && milestoneDone(job, 'production_completed') && !milestoneDone(job, 'installed'))
        ? setBlockReason(o, job)
        : null
      return {
        ...o, _job: job, _pressure: pressure, _total: total, _paid: paid, _balance: balance,
        _fillRatio: total > 0 ? paid / total : 0,
        _familyName: familyName,
        _jobType: job?.job_type || null,
        _stageKey: stage?.key || null, _stageLabel: stage?.label || null,
        _missingInfo: missingInfo,
        _isNewStone: isNewStone,
        _payment: derivePaymentStatus(o),
        _design: job ? deriveDesignStatus(job) : null,
        _stone: job ? deriveStoneStatus(job) : null,
        _fdn: job ? deriveFdnStatus(job) : null,
        _contractTotal: orderContractTotal(o),
        _setBlock: setBlock,
        _serviceTypesUp: new Set((o.service_types || []).map(s => String(s).toUpperCase())),
      }
    })
  }, [orders, allJobs])

  const cemeteryOptions = useMemo(() => {
    const map = new Map()
    for (const o of enriched) if (o.cemetery?.id && !map.has(o.cemetery.id)) map.set(o.cemetery.id, o.cemetery.name)
    return [...map.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name))
  }, [enriched])

  // ── Filter + sort ───────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    let list = enriched
    // Sub-tab partition (Orders · Leads · All). Leads are not a separate table —
    // they're the draft/scoping/quoted statuses of the same orders set. The table
    // surface renders the Orders tab (actual orders only) and the All tab
    // (everything). A non-empty search ALWAYS shows the combined set so a name
    // match surfaces whether it's a lead or an order, in every sub-tab.
    const showAll = search.trim().length > 0 || view === 'all'
    if (!showAll) list = list.filter(o => !LEAD_STATUSES.includes(o.status))
    // Workflow / permit queue (from a hub dashboard) — uses the shared classifiers.
    if (queueFilter) list = list.filter(o => {
      if (queueFilter.startsWith('permit_')) return permitBuckets(o, o._job).includes(queueFilter)
      const c = classifyOrderQueues(o, o._job, o._pressure)
      return c.productionQueue === queueFilter || c.overlays.includes(queueFilter)
    })
    // Quick views layer over the granular filters.
    if (quickView === 'active_pipeline') list = list.filter(o => ACTIVE_STATUSES.includes(o.status))
    else if (quickView === 'owes_balance') list = list.filter(o => o._balance > 0)
    else if (quickView === 'needs_info')   list = list.filter(o => o._missingInfo)
    else if (quickView === 'deposit_only') list = list.filter(o => o._paid > 0 && o._total <= 0)

    if (pipelineFilters.size) list = list.filter(o => pipelineFilters.has(o.status))
    if (paymentFilters.size)  list = list.filter(o => paymentFilters.has(o._pressure.paymentState))
    if (jobTypeFilters.size) list = list.filter(o => {
      for (const f of jobTypeFilters) {
        if (f === 'inscription') { if (o._serviceTypesUp.has('INSCRIPTION')) return true }
        else if (o._jobType === f) return true
      }
      return false
    })
    if (serviceTypeFilters.size) list = list.filter(o => {
      for (const f of serviceTypeFilters) if (o._serviceTypesUp.has(f)) return true
      return false
    })
    if (cemeteryFilter) list = list.filter(o => o.cemetery?.id === cemeteryFilter)
    if (hasDeposit) list = list.filter(o => o._paid > 0)
    if (owesBalance) list = list.filter(o => o._balance > 0)
    if (needsAttentionOnly) list = list.filter(o => {
      const sev = o._pressure.blocker?.severity; return sev === 'red' || sev === 'amber'
    })

    const needle = search.trim().toLowerCase()
    if (needle) list = list.filter(o => [
      o.order_number, o._familyName, o.customer?.first_name, o.customer?.last_name,
      o.customer?.phone_primary, o.customer?.email, o.cemetery?.name, o.cemetery?.city, o.sales_rep,
    ].filter(Boolean).join(' ').toLowerCase().includes(needle))

    const sorters = {
      createdDesc: (a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0),
      actionPriority: (a, b) => {
        const bd = recencyBand(a.updated_at) - recencyBand(b.updated_at); if (bd) return bd
        const sd = severityRank(a._pressure.blocker) - severityRank(b._pressure.blocker); if (sd) return sd
        return new Date(b.updated_at) - new Date(a.updated_at)
      },
      lastActivity: (a, b) => new Date(b.updated_at) - new Date(a.updated_at),
      ageDesc:     (a, b) => (b._pressure.ageDays || 0) - (a._pressure.ageDays || 0),
      balanceDesc: (a, b) => b._balance - a._balance,
      totalDesc:   (a, b) => b._total - a._total,
      depositDesc: (a, b) => b._paid - a._paid,
      familyName:  (a, b) => (a._familyName || '').localeCompare(b._familyName || ''),
      // Clickable column sorts (ascending base; sortDir flips them). Each falls
      // back to family name so ties have a stable, readable secondary order.
      customer:      (a, b) => (a._familyName || '').localeCompare(b._familyName || ''),
      jobType:       (a, b) => jobTypeLabel(a._jobType, a.service_types).localeCompare(jobTypeLabel(b._jobType, b.service_types)) || (a._familyName || '').localeCompare(b._familyName || ''),
      payment:       (a, b) => dimRank(_PAY_DIM_RANK, a._payment) - dimRank(_PAY_DIM_RANK, b._payment) || (a._familyName || '').localeCompare(b._familyName || ''),
      design:        (a, b) => dimRank(_DESIGN_DIM_RANK, a._design) - dimRank(_DESIGN_DIM_RANK, b._design) || (a._familyName || '').localeCompare(b._familyName || ''),
      stone:         (a, b) => dimRank(_STONE_DIM_RANK, a._stone) - dimRank(_STONE_DIM_RANK, b._stone) || (a._familyName || '').localeCompare(b._familyName || ''),
      fdn:           (a, b) => dimRank(_FDN_DIM_RANK, a._fdn) - dimRank(_FDN_DIM_RANK, b._fdn) || (a._familyName || '').localeCompare(b._familyName || ''),
      total:         (a, b) => (a._total || 0) - (b._total || 0) || (a._familyName || '').localeCompare(b._familyName || ''),
      dueDate:       (a, b) => cmpMaybeDate(a.target_completion_date, b.target_completion_date),
      cemeteryName:  (a, b) => (a.cemetery?.name || '').localeCompare(b.cemetery?.name || ''),
      paymentStatus: (a, b) => payRank(a) - payRank(b) || (a._familyName || '').localeCompare(b._familyName || ''),
    }
    const sorted = [...list].sort(sorters[sortKey] || sorters.actionPriority)
    // Direction toggle only applies to the click-sortable columns; the dropdown
    // sorters carry their own fixed direction.
    if (CLICK_SORT_KEYS.has(sortKey) && sortDir === 'desc') sorted.reverse()
    return sorted
  }, [enriched, view, queueFilter, quickView, pipelineFilters, paymentFilters, jobTypeFilters, serviceTypeFilters,
      cemeteryFilter, hasDeposit, owesBalance, needsAttentionOnly, search, sortKey, sortDir])

  // Reset page + clear stale selection when the filtered set changes shape.
  useEffect(() => { setPage(0) }, [view, archiveView, queueFilter, quickView, pipelineFilters, paymentFilters, jobTypeFilters,
    serviceTypeFilters, cemeteryFilter, hasDeposit, owesBalance, needsAttentionOnly, search])

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const pageRows = useMemo(() => filtered.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE), [filtered, page])

  // ── Totals footer (block 6) — from the filtered set, voided excluded ──────
  const totals = useMemo(() => {
    let deposits = 0, owed = 0
    for (const o of filtered) { deposits += o._paid; if (o._balance > 0) owed += o._balance }
    return { deposits, owed }
  }, [filtered])

  // ── Selection ─────────────────────────────────────────────────────────────
  const filteredIds = useMemo(() => filtered.map(o => o.id), [filtered])
  const allMatchingSelected = filtered.length > 0 && selectedIds.size >= filtered.length && filtered.every(o => selectedIds.has(o.id))
  const pageAllSelected = pageRows.length > 0 && pageRows.every(o => selectedIds.has(o.id))

  const toggleOne = (id, indexInFiltered, shiftKey) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (shiftKey && lastIndexRef.current != null) {
        const [lo, hi] = [lastIndexRef.current, indexInFiltered].sort((a, b) => a - b)
        const shouldSelect = !next.has(id)
        for (let i = lo; i <= hi; i++) { const oid = filteredIds[i]; if (oid) (shouldSelect ? next.add(oid) : next.delete(oid)) }
      } else {
        next.has(id) ? next.delete(id) : next.add(id)
      }
      return next
    })
    lastIndexRef.current = indexInFiltered
  }
  const togglePage = () => setSelectedIds(prev => {
    const next = new Set(prev)
    if (pageAllSelected) pageRows.forEach(o => next.delete(o.id))
    else pageRows.forEach(o => next.add(o.id))
    return next
  })
  const selectAllMatching = () => setSelectedIds(new Set(filteredIds))
  const clearSelection = () => { setSelectedIds(new Set()); lastIndexRef.current = null }

  const selectedOrders = useMemo(() => enriched.filter(o => selectedIds.has(o.id)), [enriched, selectedIds])

  // Toasts removed entirely (no undo toast on any action, single or bulk).
  // Inline edits are optimistic and resync on failure; bulk ops reload. Kept as
  // a no-op so the many call sites don't each need touching.
  const showToast = () => {}

  // ── Bulk runner — confirm → batched write → reload (no undo toast) ─────────
  const runBulk = async (fn) => {
    setBusy(true)
    const res = await fn()
    setBusy(false); setConfirm(null)
    if (res?.ok) clearSelection()
    reload()
  }

  const ids = () => [...selectedIds]
  const askArchive = () => setConfirm({
    title: `Archive ${selectedIds.size} order${selectedIds.size === 1 ? '' : 's'}?`,
    body: 'Archiving hides them from the active list. Payments, pricing, status, and milestones are untouched.',
    run: () => runBulk(() => bulkArchiveOrders(ids()), {
      successText: r => `Archived ${r.count} order${r.count === 1 ? '' : 's'}.`,
      undoFn: () => bulkRestoreOrders(ids()),
    }),
  })
  const askRestore = () => setConfirm({
    title: `Restore ${selectedIds.size} order${selectedIds.size === 1 ? '' : 's'}?`,
    body: 'Restored orders return to the active list.',
    run: () => runBulk(() => bulkRestoreOrders(ids()), {
      successText: r => `Restored ${r.count} order${r.count === 1 ? '' : 's'}.`,
      undoFn: () => bulkArchiveOrders(ids()),
    }),
  })
  const askSetStatus = (status) => {
    const label = ORDER_STATUSES.find(s => s.code === status)?.label || status
    const snapshot = new Map(selectedOrders.map(o => [o.id, o.status]))
    setConfirm({
      title: `Set ${selectedIds.size} order${selectedIds.size === 1 ? '' : 's'} to "${label}"?`,
      body: 'Changes lifecycle status only — does not touch payments or milestones.',
      run: () => runBulk(() => bulkSetOrderStatus(ids(), status), {
        successText: r => `Set ${r.count} order${r.count === 1 ? '' : 's'} to ${label}.`,
        undoFn: () => undoByPriorValue(snapshot, (gids, v) => bulkSetOrderStatus(gids, v)),
      }),
    })
  }
  const askSetCemetery = (cemeteryId) => {
    const label = cemeteryOptions.find(c => c.id === cemeteryId)?.name || '—'
    const snapshot = new Map(selectedOrders.map(o => [o.id, o.cemetery?.id || null]))
    setConfirm({
      title: `Move ${selectedIds.size} order${selectedIds.size === 1 ? '' : 's'} to ${label}?`,
      body: 'Reassigns the cemetery on the selected orders.',
      run: () => runBulk(() => bulkSetOrderCemetery(ids(), cemeteryId), {
        successText: r => `Moved ${r.count} order${r.count === 1 ? '' : 's'} to ${label}.`,
        undoFn: () => undoByPriorValue(snapshot, (gids, v) => bulkSetOrderCemetery(gids, v)),
      }),
    })
  }
  const askSetJobType = (jobType) => {
    const label = JOB_TYPES.find(j => j.code === jobType)?.label || jobType
    const snapshot = new Map(selectedOrders.map(o => [o.id, o._jobType || null]))
    setConfirm({
      title: `Set job type to "${label}" on ${selectedIds.size} order${selectedIds.size === 1 ? '' : 's'}?`,
      body: 'Updates the production job type / queue for the selected orders.',
      run: () => runBulk(() => bulkSetJobType(ids(), jobType), {
        successText: r => `Set job type on ${r.count} job${r.count === 1 ? '' : 's'}.`,
        undoFn: () => undoByPriorValue(snapshot, (gids, v) => v ? bulkSetJobType(gids, v) : { ok: true }),
      }),
    })
  }
  const askSetStage = (throughKey) => {
    const label = humanizeKey(throughKey)
    const total = selectedIds.size
    setConfirm({
      title: `Advance ${total} order${total === 1 ? '' : 's'} to "${label}"?`,
      body: 'Marks milestones DONE through this stage (advance-only — milestones are never pulled back in bulk). Job types without this milestone are skipped.',
      run: () => runBulk(() => bulkSetStage(ids(), throughKey), {
        // advance-only → no undo (per spec: backward corrections stay per-order)
        successText: r => `Advanced ${r.applicable ?? r.jobs ?? 0} job${(r.applicable ?? r.jobs) === 1 ? '' : 's'} to ${label} (${r.count} milestone${r.count === 1 ? '' : 's'} marked done)${r.skipped ? ` · ${r.skipped} skipped (no ${label} stage)` : ''}.`,
      }),
    })
  }
  // Undo for uniform-set ops: group selected ids by their prior value and issue
  // one batched restore per distinct prior value (never a per-row loop).
  const undoByPriorValue = async (snapshot, setter) => {
    const groups = new Map()
    for (const [id, prior] of snapshot) {
      const k = prior == null ? '__null__' : prior
      if (!groups.has(k)) groups.set(k, { value: prior, ids: [] })
      groups.get(k).ids.push(id)
    }
    for (const { value, ids: gids } of groups.values()) {
      const r = await setter(gids, value)
      if (r && r.ok === false) return r
    }
    return { ok: true }
  }

  // ── Inline status dropdowns (flip milestones — one source of truth) ────────
  // OPTIMISTIC local patches — a single inline edit updates state in place
  // instead of a full refetch (reload() flips loading=true → the table unmounts
  // and flashes blank mid-edit). enriched recomputes from orders + allJobs.
  const patchOrderLocal = useCallback((orderId, fields) => {
    setOrders(prev => prev.map(o => o.id === orderId ? { ...o, ...fields } : o))
    // The DB changed — drop the cache so a re-entry refetches fresh (the current
    // view already shows the optimistic patch).
    invalidateCache('orders:board')
  }, [])
  const patchJobMilestonesLocal = useCallback((orderId, plan) => {
    if (!plan) return
    invalidateCache(JOBS_KEY)
    const statusByKey = {}
    for (const k of (plan.done || []))       statusByKey[k] = 'done'
    for (const k of (plan.notStarted || [])) statusByKey[k] = 'not_started'
    for (const k of (plan.notNeeded || []))  statusByKey[k] = 'not_needed'
    const today = new Date().toISOString().slice(0, 10)
    setAllJobs(prev => prev.map(j => {
      if (j.order_id !== orderId) return j
      const milestones = (j.milestones || []).map(m =>
        statusByKey[m.milestone_key]
          ? { ...m, status: statusByKey[m.milestone_key], status_date: statusByKey[m.milestone_key] === 'done' ? today : null }
          : m)
      return { ...j, milestones }
    }))
  }, [])

  // OPTIMISTIC-FIRST inline edits — patch local state BEFORE the await so the
  // UI updates instantly with ZERO flicker (no busy/disable opacity change, no
  // toast, no refetch). On the rare write failure, reload() resyncs the true
  // state. Payment is a manual override on orders.payment_status.
  const inlinePayment = async (o, code) => {
    patchOrderLocal(o.id, { payment_status: code })
    const r = await bulkUpdateOrders([o.id], { payment_status: code })
    if (!r.ok) reload()
  }
  const inlineDesign = async (o, code) => {
    if (!o._job) return
    patchJobMilestonesLocal(o.id, orderStatusWritePlan('design', code))
    const r = await setOrderDesignStatus(o._job.id, code)
    if (!r.ok) reload()
  }
  const inlineStone = async (o, code) => {
    if (!o._job) return
    patchJobMilestonesLocal(o.id, orderStatusWritePlan('stone', code))
    const r = await setOrderStoneStatus(o._job.id, code)
    if (!r.ok) reload()
  }
  const inlineFdn = async (o, code) => {
    if (!o._job) return
    patchJobMilestonesLocal(o.id, orderStatusWritePlan('fdn', code))
    const r = await setOrderFdnStatus(o._job.id, code)
    if (!r.ok) reload()
  }
  // Inline date edits — contract = signed_at, due = target_completion_date.
  // Changing the contract date auto-fills an empty due date for new_stone (+5mo).
  const inlineDate = async (o, field, value) => {
    const patch = {}
    if (field === 'signed_at') {
      patch.signed_at = value ? `${value}T00:00:00` : null
      if (value && o._isNewStone && !o.target_completion_date) {
        const due = plusFiveMonthsISO(value)
        if (due) patch.target_completion_date = due
      }
    } else {
      patch.target_completion_date = value || null
    }
    patchOrderLocal(o.id, patch)
    const r = await bulkUpdateOrders([o.id], patch)
    if (!r.ok) reload()
  }
  // Contract-signed status — settable on EVERY order (order-level, not job-gated).
  // Marking signed writes signed_at (today if no date yet, keeping an existing one)
  // and advances a pre-contract pipeline status to 'contracted' (a real status
  // change). Unsigning just clears signed_at; the status is left as-is.
  const inlineSigned = async (o, signed) => {
    const patch = {}
    if (signed) {
      const d = o.signed_at ? toDateInput(o.signed_at) : _todayInput()
      patch.signed_at = `${d}T00:00:00`
      if (['draft', 'scoping', 'quoted'].includes(o.status)) patch.status = 'contracted'
      if (o._isNewStone && !o.target_completion_date) { const due = plusFiveMonthsISO(d); if (due) patch.target_completion_date = due }
    } else {
      patch.signed_at = null
    }
    patchOrderLocal(o.id, patch)
    const r = await bulkUpdateOrders([o.id], patch)
    if (!r.ok) reload()
  }
  const inlineTotal = async (o, raw) => {
    const trimmed = String(raw ?? '').trim()
    const val = trimmed === '' ? null : Number(trimmed)
    if (val != null && !Number.isFinite(val)) return
    patchOrderLocal(o.id, { contract_total: val })
    const r = await bulkUpdateOrders([o.id], { contract_total: val })
    if (!r.ok) reload()
  }

  // ── CSV export (selected, or whole filtered set if none selected) ─────────
  const exportCSV = () => {
    const rows = selectedIds.size ? selectedOrders : filtered
    const cols = [
      { label: 'Customer', get: o => o._familyName },
      { label: 'Order #', get: o => o.order_number || '' },
      { label: 'Status', get: o => statusInfo(o.status).label },
      { label: 'Job type', get: o => jobTypeLabel(o._jobType, o.service_types) },
      { label: 'Stage', get: o => o._stageLabel || statusInfo(o.status).label },  // furthest-done milestone, fallback status
      { label: 'Deposit', get: o => o._paid },
      { label: 'Balance', get: o => o._balance },
      { label: 'Cemetery', get: o => o.cemetery?.name || '' },
    ]
    downloadCSV(`orders-${new Date().toISOString().slice(0, 10)}.csv`, toCSV(rows, cols))
    showToast(`Exported ${rows.length} order${rows.length === 1 ? '' : 's'} to CSV.`)
  }

  const resetAll = () => {
    setPipelineFilters(new Set()); setPaymentFilters(new Set()); setJobTypeFilters(new Set())
    setServiceTypeFilters(new Set()); setCemeteryFilter(''); setHasDeposit(false); setOwesBalance(false)
    setNeedsAttentionOnly(false); setQuickView(null); setSearch('')
  }
  const toggleSet = (set, setter) => (code) => {
    const next = new Set(set); next.has(code) ? next.delete(code) : next.add(code); setter(next)
  }
  const onQuickView = (code) => {
    if (code === 'archived') { setArchiveView(v => v === 'archived' ? 'active' : 'archived'); setQuickView(null); clearSelection(); return }
    setQuickView(v => v === code ? null : code)
  }

  // ── Order detail drill-in ─────────────────────────────────────────────────
  if (selectedOrderId) {
    return (
      <OrderDetail orderId={selectedOrderId} onBack={() => { setSelectedOrderId(null); reload() }}
        onEditInSales={(id) => onEditOrder?.(id)}
        onEditInSalesPortal={(id) => onOpenOrder?.(id)}
        onOpenJob={onOpenJob} onOpenCustomer={onOpenCustomer} onOpenHub={onOpenHub}
        initialAction={initialAction} onConsumeInitialAction={onConsumeInitialAction} />
    )
  }

  const canArchive = archiveView !== 'archived'
  const canRestore = archiveView !== 'active'

  // Large, prominent Orders · Leads · All toggle (shown in every view).
  const viewTabs = (
    <div className="sb-leads-viewtabs">
      {[['orders', 'Orders'], ['leads', 'Leads'], ['all', 'All']].map(([code, label]) => (
        <button key={code} type="button" className={`sb-leads-viewtab${view === code ? ' on' : ''}`} onClick={() => setView(code)}>{label}</button>
      ))}
    </div>
  )
  // One search input, reused on the table surface and the Leads surface so the
  // search scope is identical everywhere. A non-empty term forces the combined
  // table (see `searching` below) so a match surfaces whether lead or order.
  const searchInput = (
    <input type="search" className="sb-crm-search" placeholder="Search name, order #, cemetery, rep…"
      value={search} onChange={e => setSearch(e.target.value)} />
  )
  const searching = search.trim().length > 0

  // Leads view — additive; the Orders UI below is untouched. While searching, the
  // combined table takes over (handled below) so search spans leads + orders.
  if (view === 'leads' && !searching) {
    return (
      <div className="sb-crm-page">
        <style>{TW_CSS}</style>
        <style>{VIEWTABS_CSS}</style>
        <div className="sb-crm-container">
          <div className="sb-sales-toolbar">
            {viewTabs}
            <div className="sb-sales-toolbar-right">
              {searchInput}
              <button type="button" className="sb-crm-btn-primary" onClick={() => setNewLeadOpen(true)}>+ New Lead</button>
            </div>
          </div>
          <LeadsView orders={orders} onOpenDetail={(id) => setSelectedOrderId(id)} onOpenOrder={onOpenOrder} onConvert={convertLead} onChanged={reload} />
        </div>
        {newLeadOpen && (
          <NewLeadModal onClose={() => setNewLeadOpen(false)}
            onSaved={() => { setNewLeadOpen(false); reload() }} />
        )}
      </div>
    )
  }

  return (
    <div className="sb-crm-page">
      <style>{TW_CSS}</style>
      <style>{VIEWTABS_CSS}</style>
      <div className="sb-crm-container">
        {viewTabs}

        <header className="sb-crm-head">
          <div>
            <h1 className="sb-crm-head-title">Sales</h1>
            <div className="sb-crm-head-count">
              <strong>{loading ? '—' : filtered.length}</strong> {filtered.length === 1 ? 'order' : 'orders'}
              {searching && <> · matching “{search.trim()}” (leads + orders)</>}
              {!searching && archiveView !== 'active' && <> · {ARCHIVE_VIEWS.find(v => v.code === archiveView)?.label}</>}
            </div>
          </div>
          <div className="sb-crm-head-actions">
            {searchInput}
            <select className="sb-crm-sort" value={sortKey} onChange={e => setSortKey(e.target.value)}>
              {SORT_OPTIONS.map(o => <option key={o.code} value={o.code}>{o.label}</option>)}
            </select>
            <button type="button" className="sb-crm-btn-primary" onClick={onNewOrder}>+ New Order</button>
            <button type="button" className="sb-crm-btn-secondary" onClick={onOpenSales}>Sales wizard</button>
          </div>
        </header>

        {loadErr && <div className="sb-crm-error">{loadErr}</div>}

        {queueFilter && (
          <div className="sb-tw-queuebar">
            <span>Queue: <strong>{queueLabel(queueFilter)}</strong> · {filtered.length} order{filtered.length === 1 ? '' : 's'}</span>
            <button type="button" className="sb-tw-link" onClick={() => setQueueFilter(null)}>Clear queue</button>
          </div>
        )}

        {/* Quick views */}
        <div className="sb-crm-chip-row">
          <div className="sb-crm-chip-group">
            <span className="sb-crm-chip-group-label">Quick views</span>
            {QUICK_VIEWS.map(q => (
              <FilterChip key={q.code} active={q.code === 'archived' ? archiveView === 'archived' : quickView === q.code} onClick={() => onQuickView(q.code)}>{q.label}</FilterChip>
            ))}
          </div>
          <div className="sb-crm-chip-group">
            <span className="sb-crm-chip-group-label">Show</span>
            {ARCHIVE_VIEWS.map(v => (
              <FilterChip key={v.code} active={archiveView === v.code} onClick={() => { setArchiveView(v.code); clearSelection() }}>{v.label}</FilterChip>
            ))}
          </div>
        </div>

        {/* Granular filters */}
        <div className="sb-crm-chip-row">
          <div className="sb-crm-chip-group">
            <span className="sb-crm-chip-group-label">Status</span>
            {PIPELINE_STAGE_FILTERS.map(f => (
              <FilterChip key={f.code} active={pipelineFilters.has(f.code)} onClick={() => toggleSet(pipelineFilters, setPipelineFilters)(f.code)}>{f.label}</FilterChip>
            ))}
          </div>
          <div className="sb-crm-chip-group">
            <span className="sb-crm-chip-group-label">Payment</span>
            {PAYMENT_FILTERS.map(f => (
              <FilterChip key={f.code} active={paymentFilters.has(f.code)} onClick={() => toggleSet(paymentFilters, setPaymentFilters)(f.code)}>{f.label}</FilterChip>
            ))}
            <FilterChip active={hasDeposit} onClick={() => setHasDeposit(v => !v)}>Has deposit</FilterChip>
            <FilterChip active={owesBalance} onClick={() => setOwesBalance(v => !v)}>Owes balance</FilterChip>
          </div>
          <div className="sb-crm-chip-group">
            <span className="sb-crm-chip-group-label">Job type</span>
            {JOB_TYPE_FILTERS.map(f => (
              <FilterChip key={f.code} active={jobTypeFilters.has(f.code)} onClick={() => toggleSet(jobTypeFilters, setJobTypeFilters)(f.code)}>{f.label}</FilterChip>
            ))}
          </div>
          <div className="sb-crm-chip-group">
            <span className="sb-crm-chip-group-label">Service</span>
            {SERVICE_TYPE_FILTERS.map(f => (
              <FilterChip key={f.code} active={serviceTypeFilters.has(f.code)} onClick={() => toggleSet(serviceTypeFilters, setServiceTypeFilters)(f.code)}>{f.label}</FilterChip>
            ))}
          </div>
          <div className="sb-crm-chip-group">
            <FilterChip active={needsAttentionOnly} onClick={() => setNeedsAttentionOnly(v => !v)}>Needs attention</FilterChip>
          </div>
          {cemeteryOptions.length > 0 && (
            <div className="sb-crm-chip-group">
              <span className="sb-crm-chip-group-label">Cemetery</span>
              <select className="sb-crm-sort" value={cemeteryFilter} onChange={e => setCemeteryFilter(e.target.value)} style={{ minWidth: 160 }}>
                <option value="">All cemeteries</option>
                {cemeteryOptions.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
          )}
        </div>

        {/* Bulk action bar — sticky, shown when ≥1 selected */}
        {selectedIds.size > 0 && (
          <div className="sb-tw-bulkbar">
            <div className="sb-tw-bulk-count">
              <strong>{selectedIds.size}</strong> selected
              {!allMatchingSelected && filtered.length > pageRows.length && (
                <button type="button" className="sb-tw-link" onClick={selectAllMatching}>Select all {filtered.length} matching</button>
              )}
              {allMatchingSelected && <span className="sb-tw-allnote">all matching</span>}
            </div>
            <div className="sb-tw-bulk-actions">
              {canArchive && <button type="button" className="sb-tw-bbtn" disabled={busy} onClick={askArchive}>Archive</button>}
              {canRestore && <button type="button" className="sb-tw-bbtn" disabled={busy} onClick={askRestore}>Restore</button>}
              <BulkSelect label="Set status" disabled={busy} options={ORDER_STATUSES.filter(s => s.code !== 'archived').map(s => ({ value: s.code, label: s.label }))} onPick={askSetStatus} />
              <BulkSelect label="Set job type" disabled={busy} options={JOB_TYPES.map(j => ({ value: j.code, label: j.label }))} onPick={askSetJobType} />
              <BulkSelect label="Set stage" disabled={busy} options={NEW_STONE_STAGES.map(k => ({ value: k, label: humanizeKey(k) }))} onPick={askSetStage} />
              <BulkSelect label="Set cemetery" disabled={busy || cemeteryOptions.length === 0} options={cemeteryOptions.map(c => ({ value: c.id, label: c.name }))} onPick={askSetCemetery} />
              <button type="button" className="sb-tw-bbtn" disabled={busy} onClick={exportCSV}>Export CSV</button>
              <button type="button" className="sb-tw-bbtn sb-tw-bbtn-ghost" onClick={clearSelection}>Clear</button>
            </div>
          </div>
        )}

        {/* Table */}
        <div className="sb-crm-card sb-crm-table">
          <div className="sb-crm-row sb-crm-row-head sb-tw-row" style={{ gridTemplateColumns: grid }}>
            <div><input type="checkbox" checked={pageAllSelected} onChange={togglePage} aria-label="Select page" /></div>
            <div style={{ position: 'relative', minWidth: 0 }}>
              <button type="button" className={`sb-ord-sort-th ${sortKey === 'customer' ? 'on' : ''}`} onClick={() => handleHeaderSort('customer')} title="Sort by family (last name)">Family{sortCaret('customer')}</button>
              <span onMouseDown={startColResize(1)} style={COL_RESIZE} />
            </div>
            <div style={{ position: 'relative', minWidth: 0 }}>
              <span className="sb-ord-sort-th" style={{ cursor: 'default' }}>Order #</span>
              <span onMouseDown={startColResize(2)} style={COL_RESIZE} />
            </div>
            <div style={{ position: 'relative', minWidth: 0 }}>
              <span className="sb-ord-sort-th" style={{ cursor: 'default' }}>Customer</span>
              <span onMouseDown={startColResize(3)} style={COL_RESIZE} />
            </div>
            <div style={{ position: 'relative', minWidth: 0 }}>
              <button type="button" className={`sb-ord-sort-th ${sortKey === 'jobType' ? 'on' : ''}`} onClick={() => handleHeaderSort('jobType')} title="Sort by job type">Job Type{sortCaret('jobType')}</button>
              <span onMouseDown={startColResize(4)} style={COL_RESIZE} />
            </div>
            <div style={{ position: 'relative', minWidth: 0 }}>
              <button type="button" className={`sb-ord-sort-th ${sortKey === 'payment' ? 'on' : ''}`} onClick={() => handleHeaderSort('payment')} title="Sort by payment status">Payment{sortCaret('payment')}</button>
              <span onMouseDown={startColResize(5)} style={COL_RESIZE} />
            </div>
            <div style={{ position: 'relative', minWidth: 0 }}>
              <button type="button" className={`sb-ord-sort-th ${sortKey === 'design' ? 'on' : ''}`} onClick={() => handleHeaderSort('design')} title="Sort by design stage">Design{sortCaret('design')}</button>
              <span onMouseDown={startColResize(6)} style={COL_RESIZE} />
            </div>
            <div style={{ position: 'relative', minWidth: 0 }}>
              <button type="button" className={`sb-ord-sort-th ${sortKey === 'stone' ? 'on' : ''}`} onClick={() => handleHeaderSort('stone')} title="Sort by stone stage">Stone{sortCaret('stone')}</button>
              <span onMouseDown={startColResize(7)} style={COL_RESIZE} />
            </div>
            <div style={{ position: 'relative', minWidth: 0 }}>
              <button type="button" className={`sb-ord-sort-th ${sortKey === 'fdn' ? 'on' : ''}`} onClick={() => handleHeaderSort('fdn')} title="Sort by foundation stage">FDN{sortCaret('fdn')}</button>
              <span onMouseDown={startColResize(8)} style={COL_RESIZE} />
            </div>
            <div style={{ position: 'relative', minWidth: 0 }}>
              <button type="button" className={`sb-ord-sort-th ${sortKey === 'cemeteryName' ? 'on' : ''}`} onClick={() => handleHeaderSort('cemeteryName')} title="Sort by cemetery">Cemetery{sortCaret('cemeteryName')}</button>
              <span onMouseDown={startColResize(9)} style={COL_RESIZE} />
            </div>
            <div style={{ position: 'relative', minWidth: 0 }}>
              <button type="button" className={`sb-ord-sort-th ${sortKey === 'paymentStatus' ? 'on' : ''}`} onClick={() => handleHeaderSort('paymentStatus')} title="Group by payment status (Paid → Deposit → Not paid)">Contract{sortCaret('paymentStatus')}</button>
              <span onMouseDown={startColResize(10)} style={COL_RESIZE} />
            </div>
            <div style={{ position: 'relative', minWidth: 0 }}>
              <button type="button" className={`sb-ord-sort-th ${sortKey === 'dueDate' ? 'on' : ''}`} onClick={() => handleHeaderSort('dueDate')} title="Sort by due date">Due date{sortCaret('dueDate')}</button>
            </div>
          </div>

          {loading ? (
            <div className="sb-crm-empty">Loading orders…</div>
          ) : filtered.length === 0 ? (
            <div className="sb-crm-empty">No orders match these filters.<div><button type="button" onClick={resetAll}>Reset filters</button></div></div>
          ) : (
            pageRows.map((o) => (
              <OrderRow key={o.id} order={o} grid={grid} indexInFiltered={filteredIds.indexOf(o.id)}
                selected={selectedIds.has(o.id)} onToggle={toggleOne} onOpen={setSelectedOrderId}
                onInlinePayment={inlinePayment}
                onInlineDesign={inlineDesign} onInlineStone={inlineStone} onInlineFdn={inlineFdn}
                onInlineDate={inlineDate} onInlineSigned={inlineSigned} onInlineTotal={inlineTotal} busy={false} />
            ))
          )}

          {/* Totals footer (block 6) */}
          {!loading && (
            <div className="sb-tw-footer">
              Showing <strong>{filtered.length}</strong> · Selected <strong>{selectedIds.size}</strong>
              {' '}· <strong>{fmtUSD(totals.deposits)}</strong> deposits · <strong>{fmtUSD(totals.owed)}</strong> owed
            </div>
          )}
        </div>

        {/* Pagination */}
        {!loading && pageCount > 1 && (
          <div className="sb-tw-pager">
            <button type="button" disabled={page === 0} onClick={() => setPage(p => Math.max(0, p - 1))}>← Prev</button>
            <span>Page {page + 1} of {pageCount} · {filtered.length} orders</span>
            <button type="button" disabled={page >= pageCount - 1} onClick={() => setPage(p => Math.min(pageCount - 1, p + 1))}>Next →</button>
          </div>
        )}
      </div>

      {/* Confirm modal */}
      {confirm && (
        <div className="sb-tw-modal-overlay" onClick={() => !busy && setConfirm(null)}>
          <div className="sb-tw-modal" onClick={e => e.stopPropagation()}>
            <div className="sb-tw-modal-title">{confirm.title}</div>
            <div className="sb-tw-modal-body">{confirm.body}</div>
            <div className="sb-tw-modal-actions">
              <button type="button" className="sb-tw-bbtn sb-tw-bbtn-ghost" onClick={() => setConfirm(null)} disabled={busy}>Cancel</button>
              <button type="button" className="sb-tw-bbtn sb-tw-bbtn-primary" onClick={confirm.run} disabled={busy}>{busy ? 'Working…' : 'Confirm'}</button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}

// ── BulkSelect — a "label" select that fires onPick(value) and resets ─────────
function BulkSelect({ label, options, onPick, disabled }) {
  return (
    <select className="sb-tw-bbtn sb-tw-bselect" disabled={disabled} value=""
      onChange={e => { const v = e.target.value; e.target.value = ''; if (v) onPick(v) }}>
      <option value="">{label}…</option>
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  )
}

// ── OrderRow ──────────────────────────────────────────────────────────────────
// Payment is a derived read-only chip (money truth). Design / Stone / FDN are
// inline dropdowns that flip milestones (one source of truth). Total =
// editable contract_total. Contract = signed_at, Due = target_completion_date.
// Inline date field that DOES NOT persist on each keystroke. A native date
// input fires onChange per segment (so typing a year emits 0002 → 0020 → …);
// we hold the typed value in local state and only commit on blur / Enter, and
// only when the date is complete with a plausible 4-digit year. While the field
// is focused the prop never resets the value (no mid-type re-render / refocus).
function InlineDateField({ value, disabled, onCommit, ariaLabel }) {
  const [local, setLocal] = useState(value || '')
  const focusedRef = useRef(false)
  // Resync from the saved value only when NOT actively editing.
  useEffect(() => { if (!focusedRef.current) setLocal(value || '') }, [value])

  const commit = () => {
    focusedRef.current = false
    const v = local
    if (v === '') { if (value) onCommit(''); return }   // cleared
    // Native date value is 'YYYY-MM-DD'. Require a complete, plausible date —
    // a partial year (e.g. 0002) reverts instead of saving.
    const [y, m, d] = v.split('-').map(Number)
    if (!y || !m || !d || y < 1900 || y > 2200) { setLocal(value || ''); return }
    if (v !== (value || '')) onCommit(v)
  }

  return (
    <input
      type="date"
      className="sb-ord-date-input"
      value={local}
      disabled={disabled}
      onFocus={() => { focusedRef.current = true }}
      onChange={e => setLocal(e.target.value)}
      onBlur={commit}
      onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }}
      aria-label={ariaLabel}
    />
  )
}

function OrderRow({ order: o, grid, indexInFiltered, selected, onToggle, onOpen, onInlinePayment, onInlineDesign, onInlineStone, onInlineFdn, onInlineDate, onInlineSigned, onInlineTotal, busy }) {
  const hasJob = !!o._job
  const custName = [o.customer?.first_name, o.customer?.last_name].filter(Boolean).join(' ')

  return (
    <div className={`sb-crm-row sb-tw-row${selected ? ' sb-tw-row-sel' : ''}`} style={{ gridTemplateColumns: grid }}>
      <div onClick={e => e.stopPropagation()}>
        <input type="checkbox" checked={selected}
          onClick={e => { e.stopPropagation(); onToggle(o.id, indexInFiltered, e.shiftKey) }}
          onChange={() => {}} aria-label="Select order" />
      </div>

      {/* Family (click → detail) */}
      <button type="button" className="sb-tw-cust" onClick={() => onOpen(o.id)} style={{ minWidth: 0 }}>
        <div className="sb-ord-cust-line">
          <span className="sb-crm-primary sb-ord-cust-name">{titleCaseName(o._familyName)}</span>
          {o._missingInfo && <span className="sb-tw-badge" title="Missing shape / size / color">info</span>}
        </div>
        {o._setBlock && <div className="sb-ord-block" title="Ready to set, blocked">⚠ {o._setBlock}</div>}
      </button>

      {/* Order # */}
      <div style={{ minWidth: 0 }}><span className="sb-crm-secondary sb-crm-mono" style={{ fontSize: 12 }}>{o.order_number || 'DRAFT'}</span></div>

      {/* Customer name (full first + last, title-cased, shown in full — no truncation) */}
      <div style={{ minWidth: 0 }}>
        <span className="sb-crm-secondary" style={{ fontSize: 13, display: 'block', whiteSpace: 'normal', overflowWrap: 'anywhere' }}>
          {custName ? titleCaseName(custName) : <span className="sb-crm-muted">—</span>}
        </span>
      </div>

      {/* Job Type */}
      <div><span className="sb-crm-secondary">{jobTypeLabel(o._jobType, o.service_types)}</span></div>

      {/* Payment — editable manual override (orders.payment_status) */}
      <div onClick={e => e.stopPropagation()}>
        <select className="sb-tw-inline" value={o._payment || 'quoted'} disabled={busy} onChange={e => onInlinePayment(o, e.target.value)}>
          {PAYMENT_STATUS.map(s => <option key={s.code} value={s.code}>{s.label}</option>)}
        </select>
      </div>

      {/* Design (inline → milestone) */}
      <div onClick={e => e.stopPropagation()}>
        {hasJob ? (
          <select className="sb-tw-inline" value={o._design || 'not_created'} disabled={busy} onChange={e => onInlineDesign(o, e.target.value)}>
            {DESIGN_STATUS.map(s => <option key={s.code} value={s.code}>{s.label}</option>)}
          </select>
        ) : <span className="sb-crm-muted">—</span>}
      </div>

      {/* Stone (inline → milestone) */}
      <div onClick={e => e.stopPropagation()}>
        {hasJob ? (
          <select className="sb-tw-inline" value={o._stone || 'not_ordered'} disabled={busy} onChange={e => onInlineStone(o, e.target.value)}>
            {STONE_STATUS.map(s => <option key={s.code} value={s.code}>{s.label}</option>)}
          </select>
        ) : <span className="sb-crm-muted">—</span>}
      </div>

      {/* FDN (inline → milestone) */}
      <div onClick={e => e.stopPropagation()}>
        {hasJob ? (
          <select className="sb-tw-inline" value={o._fdn || 'na'} disabled={busy} onChange={e => onInlineFdn(o, e.target.value)}>
            {FDN_STATUS.map(s => <option key={s.code} value={s.code}>{s.label}</option>)}
          </select>
        ) : <span className="sb-crm-muted">—</span>}
      </div>


      {/* Cemetery */}
      <div><span style={{ fontSize: 13 }}>{o.cemetery?.name || <span className="sb-crm-muted">—</span>}</span></div>

      {/* Contract (signed_at) — an explicit signed/not-signed status (settable on
          EVERY order) + the exact date. Commits on blur/Enter only. */}
      <div onClick={e => e.stopPropagation()} style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
        <select className="sb-tw-inline" value={o.signed_at ? 'signed' : 'unsigned'} disabled={busy}
          onChange={e => onInlineSigned(o, e.target.value === 'signed')}>
          <option value="unsigned">Not signed</option>
          <option value="signed">Contract signed</option>
        </select>
        <InlineDateField value={toDateInput(o.signed_at)} disabled={busy}
          onCommit={v => onInlineDate(o, 'signed_at', v)} ariaLabel="Contract date" />
      </div>

      {/* Due date (target_completion_date) — commits on blur/Enter only */}
      <div onClick={e => e.stopPropagation()}>
        <InlineDateField value={toDateInput(o.target_completion_date)} disabled={busy}
          onCommit={v => onInlineDate(o, 'target', v)} ariaLabel="Due date" />
      </div>
    </div>
  )
}

function jobTypeLabel(jobType, serviceTypes) {
  if (jobType === 'new_stone') return 'New stone'
  if (jobType === 'mausoleum_door') return 'Crypt door'
  if (jobType === 'cleaning_repair') return 'Cleaning / repair'
  if (jobType === 'inscription') return 'Inscription'
  if (jobType === 'bronze') return 'Bronze'
  const st = (serviceTypes || []).map(s => String(s).toUpperCase())
  if (st.includes('INSCRIPTION')) return 'Inscription'
  if (st.includes('ACID_WASH')) return 'Acid wash'
  return 'Order'
}

const VIEWTABS_CSS = `
  .sb-leads-viewtabs { display: flex; gap: 4px; background: #ece6d8; border-radius: 11px; padding: 4px; width: fit-content; margin-bottom: 18px; }
  .sb-leads-viewtab { border: none; cursor: pointer; border-radius: 8px; padding: 10px 26px; font-size: 15px; font-weight: 700; background: transparent; color: #7a756a; transition: background 0.12s, color 0.12s; }
  .sb-leads-viewtab.on { background: #fff; color: #0f1419; box-shadow: 0 1px 3px rgba(0,0,0,0.12); }
  .sb-leads-viewtab:hover:not(.on) { color: #4a463f; }
  .sb-sales-toolbar { display: flex; align-items: center; gap: 16px; justify-content: space-between; flex-wrap: wrap; margin-bottom: 18px; }
  .sb-sales-toolbar .sb-leads-viewtabs { margin-bottom: 0; }
  .sb-sales-toolbar .sb-crm-search { min-width: 240px; }
  .sb-sales-toolbar-right { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
`

const TW_CSS = `
  /* C1 — clickable sortable column headers. Match the .sb-crm-row-head > div
     typography (those text styles don't reach a <button>), add hover + active. */
  .sb-ord-sort-th {
    font: inherit; font-size: 10px; text-transform: uppercase; letter-spacing: 0.12em;
    font-weight: 600; color: #8a8a85;
    background: none; border: none; padding: 0; margin: 0; text-align: left;
    cursor: pointer; white-space: nowrap;
  }
  .sb-ord-sort-th:hover { color: #1e2d3d; }
  .sb-ord-sort-th.on { color: #9A7209; }
  .sb-ord-sort-th.num { text-align: right; }
  .sb-tw-queuebar { display: flex; align-items: center; justify-content: space-between; gap: 12px; background: #fdf8ec; border: 0.5px solid #e8d9a8; border-radius: 10px; padding: 9px 14px; margin-bottom: 12px; font-size: 13.5px; color: #6b5d2f; }
  .sb-tw-queuebar strong { color: #1e2d3d; }
  .sb-tw-queuebar .sb-tw-link { border-color: #c9b27a; color: #9A7209; }
  .sb-tw-row input[type=checkbox] { width: 15px; height: 15px; cursor: pointer; accent-color: #9A7209; }
  .sb-tw-row-sel { background: #fdf8ec !important; }
  .sb-tw-cust { text-align: left; background: none; border: none; font: inherit; cursor: pointer; padding: 0; min-width: 0; }
  .sb-tw-cust:hover .sb-crm-primary { color: #9A7209; }
  .sb-tw-badge { margin-left: 8px; font-size: 10px; font-weight: 600; color: #B8842A; background: #fbf1da; border-radius: 4px; padding: 1px 6px; vertical-align: middle; }
  /* Status dropdowns fill their column so every column aligns edge-to-edge. */
  .sb-tw-inline { font: inherit; font-size: 12.5px; padding: 5px 6px; border: 0.5px solid #d8d6d1; border-radius: 6px; background: #fff; color: #222; width: 100%; box-sizing: border-box; cursor: pointer; }
  .sb-tw-inline:hover:not(:disabled) { border-color: #9A7209; }
  .sb-tw-inline:disabled { opacity: 0.5; }

  /* Orders-redesign cells */
  .sb-ord-cust-line { display: flex; align-items: baseline; gap: 8px; min-width: 0; }
  .sb-ord-cust-name { white-space: normal; overflow-wrap: anywhere; }
  .sb-ord-cust-num { font-size: 11px; white-space: nowrap; flex-shrink: 0; }
  .sb-ord-block { margin-top: 2px; font-size: 11px; font-weight: 600; color: #B54040; }
  .sb-ord-total-input { font: inherit; font-size: 13px; width: 100%; box-sizing: border-box; text-align: right; padding: 5px 6px; border: 0.5px solid transparent; border-radius: 6px; background: transparent; color: #222; font-variant-numeric: tabular-nums; }
  .sb-ord-total-input:hover:not(:disabled) { border-color: #d8d6d1; }
  .sb-ord-total-input:focus { outline: none; border-color: #9A7209; background: #fff; }
  .sb-ord-date-input { font: inherit; font-size: 12px; padding: 5px 6px; border: 0.5px solid #d8d6d1; border-radius: 6px; background: #fff; color: #222; width: 100%; box-sizing: border-box; cursor: pointer; }
  .sb-ord-date-input:hover:not(:disabled) { border-color: #9A7209; }
  .sb-ord-date-input:disabled { opacity: 0.5; }

  .sb-tw-bulkbar { position: sticky; top: 0; z-index: 30; display: flex; align-items: center; justify-content: space-between; gap: 16px;
    background: #1e2d3d; color: #fff; border-radius: 10px; padding: 10px 16px; margin-bottom: 12px; box-shadow: 0 6px 20px rgba(15,20,25,0.18); flex-wrap: wrap; }
  .sb-tw-bulk-count { font-size: 13.5px; display: flex; align-items: center; gap: 10px; }
  .sb-tw-bulk-count strong { font-size: 15px; }
  .sb-tw-allnote { color: #d6a85a; font-size: 12px; }
  .sb-tw-bulk-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .sb-tw-link { background: none; border: 0.5px solid rgba(255,255,255,0.4); color: #d6a85a; font: inherit; font-size: 12px; font-weight: 600; padding: 3px 10px; border-radius: 6px; cursor: pointer; }
  .sb-tw-link:hover { background: rgba(255,255,255,0.08); }
  .sb-tw-bbtn { font: inherit; font-size: 12.5px; font-weight: 600; padding: 7px 12px; border-radius: 8px; border: 0.5px solid #d8d6d1; background: #fff; color: #222; cursor: pointer; }
  .sb-tw-bbtn:hover:not(:disabled) { border-color: #9A7209; color: #9A7209; }
  .sb-tw-bbtn:disabled { opacity: 0.5; cursor: default; }
  .sb-tw-bbtn-ghost { background: transparent; color: #fff; border-color: rgba(255,255,255,0.4); }
  .sb-tw-bbtn-ghost:hover { background: rgba(255,255,255,0.1); color: #fff; }
  .sb-tw-bbtn-primary { background: #9A7209; border-color: #9A7209; color: #fff; }
  .sb-tw-bbtn-primary:hover:not(:disabled) { background: #876307; color: #fff; }
  .sb-tw-bselect { -webkit-appearance: menulist; appearance: auto; }

  .sb-tw-footer { display: flex; justify-content: flex-end; gap: 4px; padding: 12px 16px; border-top: 0.5px solid #e4e2dd; font-size: 13px; color: #555; font-variant-numeric: tabular-nums; }
  .sb-tw-footer strong { color: #1e2d3d; }
  .sb-tw-pager { display: flex; align-items: center; justify-content: center; gap: 16px; margin-top: 14px; font-size: 13px; color: #6b6b66; }
  .sb-tw-pager button { font: inherit; font-size: 13px; padding: 6px 14px; border-radius: 8px; border: 0.5px solid #d8d6d1; background: #fff; color: #222; cursor: pointer; }
  .sb-tw-pager button:disabled { opacity: 0.4; cursor: default; }

  .sb-tw-modal-overlay { position: fixed; inset: 0; z-index: 1050; background: rgba(15,20,25,0.4); display: flex; align-items: center; justify-content: center; padding: 20px; }
  .sb-tw-modal { background: #fff; border-radius: 14px; padding: 22px 24px; max-width: 440px; width: 100%; box-shadow: 0 20px 50px rgba(0,0,0,0.25); }
  .sb-tw-modal-title { font-size: 16px; font-weight: 700; color: #111; margin-bottom: 8px; }
  .sb-tw-modal-body { font-size: 13.5px; color: #555; line-height: 1.5; margin-bottom: 18px; }
  .sb-tw-modal-actions { display: flex; justify-content: flex-end; gap: 10px; }
`
