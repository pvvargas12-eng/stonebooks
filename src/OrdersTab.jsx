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
  ORDER_STATUSES,
  bulkArchiveOrders, bulkRestoreOrders, bulkSetOrderStatus, bulkHardDeleteOrders,
  bulkSetOrderCemetery, bulkSetJobType, bulkSetStage, bulkUpdateOrders,
  classifyOrderQueues, queueLabel, permitBuckets,
  // Orders-redesign status dimensions (one source of truth)
  PAYMENT_STATUS, DESIGN_STATUS, STONE_STATUS, FDN_STATUS, stoneStatusOptions, manualBlockerKindLabel, manualBlockerChipText,
  designStatusOptions, statusDimApplies, createJobFromOrder, combineOrders, orderTypeLabels,
  derivePaymentStatus, deriveDesignStatus, deriveStoneStatus, deriveFdnStatus,
  setOrderDesignStatus, setOrderStoneStatus, setOrderFdnStatus, orderStatusWritePlan,
  setBlockReason, milestoneDone, orderContractTotal,
  orderTypeLabel, orderCategory, ORDER_CATEGORIES,
  // Permit (orders.permit_status — single source of truth, shared with Permit Hub)
  PERMIT_STATUS_OPTIONS, PERMIT_SELECTABLE, permitStatusLabel, permitStatusTone, setOrderPermit,
  paymentStatusTone, designStatusTone, stoneStatusTone, fdnStatusTone, contractSignedTone,
  logOrderActivity, getCurrentStaffName,
  properName, todayISO,
} from './lib/stonebooksData'
import { FilterChip } from './lib/crmComponents.jsx'
import { toCSV, downloadCSV } from './lib/exportCsv'
import { cachedFetch, peekCache, invalidateCache } from './lib/dataCache'
import { ORDER_PRICING_COLUMNS } from './lib/pricingCore'

// Trimmed column set for the Orders board — the list/status fields PLUS the
// full ORDER_PRICING_COLUMNS contract (lib/pricingCore). The 2026-07-07
// Illuzzi bug: this select once hand-listed a SUBSET of the pricing columns
// (no base_config/height/depth), so the engine priced the die only and the
// rowGrandTotal cache spread the wrong total to OrderDetail. Never hand-list
// pricing columns here again — the shared constant is the contract. Heavy
// non-pricing jsonb (deceased, designs, …) stays excluded.
const ORDERS_BOARD_SELECT =
  'id, status, archived, order_number, created_at, updated_at, signed_at, pricing_locked_at, ' +
  'target_completion_date, primary_lastname, sales_rep, payments, deposit_amount, ' +
  'balance_amount, payment_status, permit_required, permit_status, customer_id, cemetery_id, ' +
  'next_follow_up, waiting_on, lost_reason, lost_at, ' +
  ORDER_PRICING_COLUMNS + ', ' +
  'customer:customers(id, first_name, last_name, email, phone_primary), cemetery:cemeteries(id, name)'
const ORDERS_KEY = (archiveView) => `orders:board:${archiveView}`
const JOBS_KEY = 'jobs:all'   // getJobs(includeClosed) — shared with CustomersTab
import OrderDetail from './OrderDetail.jsx'
import LeadsView from './components/LeadsView.jsx'
import NewLeadModal from './components/NewLeadModal.jsx'
import CheckJobModal from './components/CheckJobModal.jsx'
import { isOrderRow, CONTRACTED_STATUSES } from './lib/leads'

// ── Constants ────────────────────────────────────────────────────────────────
const PAGE_SIZE = 50

// Primary axis: Active | Closed | Archived. Archived = orders.archived=true (its own
// fetch). Active vs Closed both fetch archived=false and split client-side by terminal
// status (closed/cancelled = Closed; everything else = Active) — so no order is ever
// invisible or in two tabs.
const PRIMARY_VIEWS = [
  { code: 'active',   label: 'Active' },
  { code: 'closed',   label: 'Closed' },
  { code: 'archived', label: 'Archived' },
]
const TERMINAL_STATUSES = new Set(['closed', 'cancelled'])
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
// ── Kanban board (opens from the pipeline strip) ────────────────────────────
// Same stage partition as the strip: a row that fails Paul's order rule
// (signed/contracted AND deposit paid) is a Lead; otherwise its status picks
// the column, with unknown statuses folding into Contracted — identical to
// stripData, so the board and the tiles always agree.
const BOARD_STAGES = [
  { code: 'leads',         label: 'Leads' },
  { code: 'contracted',    label: 'Contracted' },
  { code: 'in_production', label: 'In production' },
  { code: 'installed',     label: 'Installed' },
  { code: 'paid_in_full',  label: 'Paid in full' },
]
// Drop targets. Leads is NOT one (demoting a signed order is a deliberate
// OrderDetail act, not a mouse slip) and Paid in full is derived from the
// payment ledger — dragging can't make an order paid.
const BOARD_DROP_TARGETS = new Set(['contracted', 'in_production', 'installed'])
const BOARD_COL_CAP = 40          // cards rendered per column before the "+N more" note
const BOARD_OPEN_KEY = 'sb_orders_board_open'

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
// checkbox | family | order# | customer name | job type | payment | design | stone | fdn | cemetery | contract | due
// Family / Order# / Customer-name are explicit first columns. Total column was
// removed; the freed width goes to Family + Customer (1.7fr each) so full names
// show without truncation. Widths are draggable — a header handle pins that
// column to px; the rest stay fractional.
// minmax(floor, fr) — same fr proportions as before, plus a px floor per column so
// columns can't crush below readability on 1180–1440px laptops. When the 12 floors
// exceed the available width the .sb-crm-table wrapper scrolls horizontally (it has
// overflow-x:auto) instead of clipping; ≤1180px the Wave-1 collapse stacks the row.
// Command-center order: [✓] Family · Order# · Job Type · Cemetery · Customer ·
// Payment · Design · Stone · Permit · Foundation · Contract · Due (13 cols).
const DEFAULT_COLS = [
  '32px',                  // 0  checkbox
  'minmax(96px, 1.7fr)',   // 1  Family
  'minmax(70px, 0.8fr)',   // 2  Order #
  'minmax(80px, 0.9fr)',   // 3  Job Type
  'minmax(96px, 1.3fr)',   // 4  Cemetery
  'minmax(96px, 1.7fr)',   // 5  Customer
  'minmax(84px, 1fr)',     // 6  Payment
  'minmax(92px, 1.2fr)',   // 7  Design
  'minmax(92px, 1.3fr)',   // 8  Stone
  'minmax(88px, 1.1fr)',   // 9  Permit
  'minmax(70px, 1fr)',     // 10 Foundation
  'minmax(82px, 1fr)',     // 11 Contract
  'minmax(80px, 1fr)',     // 12 Due
]
const COL_RESIZE = { position: 'absolute', top: 0, right: 0, width: 7, height: '100%', cursor: 'col-resize', userSelect: 'none', zIndex: 2 }

// Display-only name casing now routes through the canonical properName helper
// (lib/stonebooksData) — title-cases ALL-CAPS / all-lowercase input, preserves
// deliberate mixed case (McDonald, O'Brien). Never alters stored data.

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
  'customer', 'jobType', 'payment', 'design', 'stone', 'fdn', 'permit',
  'total', 'cemeteryName', 'paymentStatus', 'dueDate',
])
// Permit sort — needs-attention first (needed → submitted → unknown → approved → N/A).
const _PERMIT_SORT_RANK = { shev_permit_needed: 0, cemetery_permit_needed: 0, required: 0, submitted: 1, unknown: 2, approved: 3, not_required: 4 }
const permitSortRank = (st) => _PERMIT_SORT_RANK[st || 'unknown'] ?? 2
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
const _DESIGN_DIM_RANK = { not_created: 0, layout_created: 1, needs_adjustments: 2, layout_approved: 3, cut: 4 }
const _STONE_DIM_RANK  = { not_ordered: 0, ordered: 1, in_stock: 2, needs_pickup: 3, needs_stencil_cut: 4, needs_blasting: 5, blasted: 6, received: 6 }
const _FDN_DIM_RANK    = { na: 0, not_in: 1, need_map: 2, drop_off: 2, dug: 3, poured: 4, in: 5 }
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

// Row sorters — shared by the table (filtered) and the board columns so the
// board honors the same sort dropdown / header clicks. Pure functions of the
// enriched row; hoisted out of the filtered memo unchanged.
const ROW_SORTERS = {
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
  jobType:       (a, b) => orderTypeLabel(a).localeCompare(orderTypeLabel(b)) || (a._familyName || '').localeCompare(b._familyName || ''),
  payment:       (a, b) => dimRank(_PAY_DIM_RANK, a._payment) - dimRank(_PAY_DIM_RANK, b._payment) || (a._familyName || '').localeCompare(b._familyName || ''),
  design:        (a, b) => dimRank(_DESIGN_DIM_RANK, a._design) - dimRank(_DESIGN_DIM_RANK, b._design) || (a._familyName || '').localeCompare(b._familyName || ''),
  stone:         (a, b) => dimRank(_STONE_DIM_RANK, a._stone) - dimRank(_STONE_DIM_RANK, b._stone) || (a._familyName || '').localeCompare(b._familyName || ''),
  fdn:           (a, b) => dimRank(_FDN_DIM_RANK, a._fdn) - dimRank(_FDN_DIM_RANK, b._fdn) || (a._familyName || '').localeCompare(b._familyName || ''),
  permit:        (a, b) => permitSortRank(a.permit_status) - permitSortRank(b.permit_status) || (a._familyName || '').localeCompare(b._familyName || ''),
  total:         (a, b) => (a._total || 0) - (b._total || 0) || (a._familyName || '').localeCompare(b._familyName || ''),
  dueDate:       (a, b) => cmpMaybeDate(a.target_completion_date, b.target_completion_date),
  cemeteryName:  (a, b) => (a.cemetery?.name || '').localeCompare(b.cemetery?.name || ''),
  paymentStatus: (a, b) => payRank(a) - payRank(b) || (a._familyName || '').localeCompare(b._familyName || ''),
}

// ── Component ────────────────────────────────────────────────────────────────
export default function OrdersTab({ onOpenSales, onOpenOrder, onNewOrder, onEditOrder, onOpenCustomer, onOpenJob, onOpenHub, initialQueue = null, onConsumeInitialQueue, initialSelectedId = null, onConsumeInitialSelected, initialAction = null, onConsumeInitialAction }) {
  const [selectedOrderId, setSelectedOrderId] = useState(null)
  const [view, setView] = useState('all')   // 'all' | 'orders' | 'leads' — All is the landing (Paul, 2026-07-20)
  // Seed from the cross-mount cache so re-opening Orders renders instantly
  // (default archiveView is 'active'). loading starts false only when both
  // datasets are already cached.
  const [orders, setOrders] = useState(() => peekCache(ORDERS_KEY('live')) ?? [])
  const [allJobs, setAllJobs] = useState(() => peekCache(JOBS_KEY) ?? [])
  const [loading, setLoading] = useState(() => peekCache(ORDERS_KEY('live')) === undefined || peekCache(JOBS_KEY) === undefined)
  const [loadErr, setLoadErr] = useState(null)
  const [reloadNonce, setReloadNonce] = useState(0)

  // Filters — 2-tier: PRIMARY axis (Active/Closed/Archived) + a single-select
  // category chip; everything else lives in the "More filters" dropdown.
  const [primaryView, setPrimaryView] = useState('active')   // active | closed | archived
  const [categoryFilter, setCategoryFilter] = useState(null) // ORDER_CATEGORIES code | null (= All)
  const [moreOpen, setMoreOpen] = useState(false)            // More-filters dropdown
  const [pipelineFilters, setPipelineFilters] = useState(new Set())
  const [paymentFilters, setPaymentFilters] = useState(new Set())
  const [hasDeposit, setHasDeposit] = useState(false)
  const [owesBalance, setOwesBalance] = useState(false)
  const [needsAttentionOnly, setNeedsAttentionOnly] = useState(false)
  const [needsCallOnly, setNeedsCallOnly] = useState(false)     // hot chip — pressure.needsCall
  const [unsignedOnly, setUnsignedOnly] = useState(false)       // hot chip — contracted, no signature on file
  const [cemeteryFilter, setCemeteryFilter] = useState('')
  const [repFilter, setRepFilter] = useState('')          // "Created by" — orders.sales_rep (Dad keeps forgetting which orders he started)
  const [quickView, setQuickView] = useState(null)           // 'needs_info' | 'deposit_only' | null (More filters)
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
  const [checkJobFor, setCheckJobFor] = useState(null)    // { id, label, cemeteryId, cemeteryName } | null — check-job modal context

  // ── Kanban board (opens from the pipeline strip, remembers last choice) ────
  const [boardOpen, setBoardOpen] = useState(() => { try { return localStorage.getItem(BOARD_OPEN_KEY) === '1' } catch { return false } })
  const toggleBoard = () => setBoardOpen(v => { const n = !v; try { localStorage.setItem(BOARD_OPEN_KEY, n ? '1' : '0') } catch { /* ignore */ } return n })
  // Drop toast — 8s with Undo (the CAL-DRAG pattern); only the latest shows.
  const [boardToast, setBoardToast] = useState(null)   // { text, undo?, error? }
  const boardToastTimer = useRef(null)
  useEffect(() => () => clearTimeout(boardToastTimer.current), [])
  const showBoardToast = useCallback((t) => {
    clearTimeout(boardToastTimer.current)
    setBoardToast(t)
    boardToastTimer.current = setTimeout(() => setBoardToast(null), 8000)
  }, [])

  // Selection + pagination
  const [selectedIds, setSelectedIds] = useState(() => new Set())
  const lastIndexRef = useRef(null)
  const [page, setPage] = useState(0)

  // Bulk action confirm + busy (no toast)
  const [confirm, setConfirm] = useState(null)  // { title, body, run }
  const [busy, setBusy] = useState(false)       // bulk ops + confirm modal only

  // ── Load (by primary axis) ────────────────────────────────────────────────
  // Active + Closed share ONE fetch (archived=false) and split client-side; only
  // Archived fetches archived=true. So the fetch axis is just live-vs-archived.
  useEffect(() => {
    let cancelled = false
    // The All tab means literally everything (Paul, 2026-07-14): live AND
    // archived merged in one list. Otherwise the fetch axis stays live-vs-
    // archived by the primary chip.
    const wantEverything = view === 'all'
    const fetchAxis = primaryView === 'archived' ? 'archived' : 'live'
    const oKey = ORDERS_KEY(fetchAxis)
    const archived = primaryView === 'archived'
    // Only show the spinner when a dataset isn't already cached — a cached
    // re-entry stays instant. cachedFetch returns cached data within the TTL and
    // refetches in the background otherwise.
    const ordersCached = wantEverything
      ? peekCache(ORDERS_KEY('live')) !== undefined && peekCache(ORDERS_KEY('archived')) !== undefined
      : peekCache(oKey) !== undefined
    if (!ordersCached || peekCache(JOBS_KEY) === undefined) setLoading(true)
    setLoadErr(null)
    const ordersPromise = wantEverything
      ? Promise.all([
          cachedFetch(ORDERS_KEY('live'), () => listAllOrders({ archived: false, limit: 2000, select: ORDERS_BOARD_SELECT })),
          cachedFetch(ORDERS_KEY('archived'), () => listAllOrders({ archived: true, limit: 2000, select: ORDERS_BOARD_SELECT })),
        ]).then(([live, arch]) => [...(live || []), ...(arch || [])])
      : cachedFetch(oKey, () => listAllOrders({ archived, limit: 2000, select: ORDERS_BOARD_SELECT }))
    Promise.all([
      ordersPromise,
      cachedFetch(JOBS_KEY, () => getJobs({ includeClosed: true, limit: 2000 })),
    ])
      .then(([rows, jobs]) => {
        if (cancelled) return
        setOrders(rows || []); setAllJobs(jobs || []); setLoading(false)
      })
      .catch(e => { if (!cancelled) { setLoadErr(e?.message || 'Failed to load orders'); setLoading(false) } })
    return () => { cancelled = true }
  }, [primaryView, view, reloadNonce])

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
    setPrimaryView('active'); setCategoryFilter(null); setQuickView(null)
    setPipelineFilters(new Set()); setPaymentFilters(new Set())
    setCemeteryFilter(''); setHasDeposit(false); setOwesBalance(false)
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
        // Null where the dimension doesn't exist for this job type (audit F8) —
        // sorting then groups the em-dash rows together instead of interleaving
        // them by a hidden derived value. Cells already gate on statusDimApplies.
        _design: (job && statusDimApplies('design', job, o)) ? deriveDesignStatus(job) : null,
        _stone: (job && statusDimApplies('stone', job, o)) ? deriveStoneStatus(job) : null,
        _fdn: (job && statusDimApplies('fdn', job, o)) ? deriveFdnStatus(job) : null,
        _contractTotal: orderContractTotal(o),
        _setBlock: setBlock,
        _serviceTypesUp: new Set((o.service_types || []).map(s => String(s).toUpperCase())),
        _category: orderCategory(o, job),   // one canonical category for the chip row
      }
    })
  }, [orders, allJobs])

  const cemeteryOptions = useMemo(() => {
    const map = new Map()
    for (const o of enriched) if (o.cemetery?.id && !map.has(o.cemetery.id)) map.set(o.cemetery.id, o.cemetery.name)
    return [...map.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name))
  }, [enriched])

  // ── Filter + sort ───────────────────────────────────────────────────────
  // preCategory = every filter EXCEPT the category axis (and sort). It drives BOTH
  // the category counts AND the rows, so the selected category's count always
  // equals the rows shown.
  // preView = every filter EXCEPT the Orders·Leads·All partition (and category/sort).
  // The table applies the partition on top (preCategory below); the kanban board
  // reads preView directly so its Leads column stays populated in Orders view.
  const preView = useMemo(() => {
    let list = enriched
    // PRIMARY axis (archived handled at fetch): Active = non-terminal status, Closed
    // = terminal (closed/cancelled). Archived fetch returns archived rows (any status).
    // The All tab skips the partition entirely — active + closed + archived together.
    if (view !== 'all') {
      if (primaryView === 'active') list = list.filter(o => !TERMINAL_STATUSES.has(o.status))
      else if (primaryView === 'closed') list = list.filter(o => TERMINAL_STATUSES.has(o.status))
    }
    // Workflow / permit queue deep-link (from a hub dashboard) — shared classifiers.
    if (queueFilter) list = list.filter(o => {
      if (queueFilter.startsWith('permit_')) return permitBuckets(o, o._job).includes(queueFilter)
      const c = classifyOrderQueues(o, o._job, o._pressure)
      return c.productionQueue === queueFilter || c.overlays.includes(queueFilter)
    })
    // More-filters (single-select needs-info / deposit-only).
    if (quickView === 'needs_info')        list = list.filter(o => o._missingInfo)
    else if (quickView === 'deposit_only') list = list.filter(o => o._paid > 0 && o._total <= 0)
    // More-filters (multi-select) + the always-visible Owes-balance toggle.
    if (pipelineFilters.size) list = list.filter(o => pipelineFilters.has(o.status))
    if (paymentFilters.size)  list = list.filter(o => paymentFilters.has(o._pressure.paymentState))
    if (cemeteryFilter) list = list.filter(o => o.cemetery?.id === cemeteryFilter)
    if (repFilter) list = list.filter(o => (o.sales_rep || '') === repFilter)
    if (hasDeposit) list = list.filter(o => o._paid > 0)
    if (owesBalance) list = list.filter(o => o._balance > 0)
    if (needsAttentionOnly) list = list.filter(o => {
      const sev = o._pressure.blocker?.severity; return sev === 'red' || sev === 'amber'
    })
    if (needsCallOnly) list = list.filter(o => o._pressure.needsCall)
    if (unsignedOnly) list = list.filter(o => !o.signed_at && CONTRACTED_STATUSES.includes(o.status))
    const needle = search.trim().toLowerCase()
    if (needle) list = list.filter(o => [
      o.order_number, o._familyName, o.customer?.first_name, o.customer?.last_name,
      o.customer?.phone_primary, o.customer?.email, o.cemetery?.name, o.cemetery?.city, o.sales_rep,
    ].filter(Boolean).join(' ').toLowerCase().includes(needle))
    return list
  }, [enriched, primaryView, view, queueFilter, quickView, pipelineFilters, paymentFilters,
      cemeteryFilter, repFilter, hasDeposit, owesBalance, needsAttentionOnly, needsCallOnly, unsignedOnly, search])

  // Distinct "Created by" values actually on orders (covers legacy rep names
  // that are no longer on the roster).
  const repOptions = useMemo(() => {
    const s = new Set()
    for (const o of orders) if (o.sales_rep) s.add(o.sales_rep)
    return [...s].sort((a, b) => a.localeCompare(b))
  }, [orders])

  // Orders · Leads · All partition — Paul's rule: an ORDER is contracted/signed
  // AND deposit paid; everything else (incl. contracted-but-no-deposit) is a lead.
  // Search respects the highlighted tab (Paul, 2026-07-14): Orders searches
  // orders only, Leads searches leads only, All searches everything.
  const preCategory = useMemo(() => {
    if (view === 'all') return preView
    if (view === 'leads') return preView.filter(o => !isOrderRow(o, o._paid))
    return preView.filter(o => isOrderRow(o, o._paid))
  }, [preView, view])

  // ── Pipeline strip + hot-chip counts — computed on the BASE scope (view
  // partition + primary axis + search only), so tiles/chips behave like the
  // category chips: clicking one never changes its own count.
  const stripData = useMemo(() => {
    const needle = search.trim().toLowerCase()
    const base = enriched.filter(o => {
      if (primaryView === 'active' && TERMINAL_STATUSES.has(o.status)) return false
      if (primaryView === 'closed' && !TERMINAL_STATUSES.has(o.status)) return false
      if (needle && ![o.order_number, o._familyName, o.customer?.first_name, o.customer?.last_name,
        o.customer?.phone_primary, o.customer?.email, o.cemetery?.name, o.sales_rep,
      ].filter(Boolean).join(' ').toLowerCase().includes(needle)) return false
      return true
    })
    const stages = { leads: { n: 0, usd: 0 }, contracted: { n: 0, usd: 0 }, in_production: { n: 0, usd: 0 }, installed: { n: 0, usd: 0 }, paid_in_full: { n: 0, usd: 0 } }
    let needsCall = 0, unsigned = 0
    for (const o of base) {
      if (o._pressure.needsCall) needsCall++
      if (!o.signed_at && CONTRACTED_STATUSES.includes(o.status)) unsigned++
      if (!isOrderRow(o, o._paid)) { stages.leads.n++; stages.leads.usd += o._total || 0; continue }
      const k = stages[o.status] ? o.status : 'contracted'
      stages[k].n++; stages[k].usd += o._total || 0
    }
    return { stages, needsCall, unsigned }
  }, [enriched, primaryView, search])

  // ── Kanban board columns — preView (leads included) + category filter, same
  // stage partition as stripData, sorted with the table's current sort.
  const boardActive = boardOpen && primaryView === 'active'
  const boardColumns = useMemo(() => {
    if (!boardActive) return null
    const list = categoryFilter ? preView.filter(o => o._category === categoryFilter) : preView
    const cols = {}
    for (const s of BOARD_STAGES) cols[s.code] = { rows: [], usd: 0 }
    for (const o of list) {
      const k = !isOrderRow(o, o._paid) ? 'leads' : (cols[o.status] ? o.status : 'contracted')
      cols[k].rows.push(o); cols[k].usd += o._total || 0
    }
    const sorter = ROW_SORTERS[sortKey] || ROW_SORTERS.actionPriority
    const flip = CLICK_SORT_KEYS.has(sortKey) && sortDir === 'desc'
    for (const s of BOARD_STAGES) { cols[s.code].rows.sort(sorter); if (flip) cols[s.code].rows.reverse() }
    return cols
  }, [boardActive, preView, categoryFilter, sortKey, sortDir])

  // Live category counts — computed on the set with all OTHER active filters applied
  // (category axis excluded), so each chip shows exactly how many rows it would yield
  // and the SELECTED category's count equals the rows shown.
  const categoryCounts = useMemo(() => {
    const counts = { all: preCategory.length }
    for (const c of ORDER_CATEGORIES) counts[c.code] = 0
    for (const o of preCategory) counts[o._category] = (counts[o._category] || 0) + 1
    return counts
  }, [preCategory])

  const filtered = useMemo(() => {
    const list = categoryFilter ? preCategory.filter(o => o._category === categoryFilter) : preCategory
    const sorted = [...list].sort(ROW_SORTERS[sortKey] || ROW_SORTERS.actionPriority)
    // Direction toggle only applies to the click-sortable columns; the dropdown
    // sorters carry their own fixed direction.
    if (CLICK_SORT_KEYS.has(sortKey) && sortDir === 'desc') sorted.reverse()
    return sorted
  }, [preCategory, categoryFilter, sortKey, sortDir])

  // Reset page + clear stale selection when the filtered set changes shape.
  useEffect(() => { setPage(0) }, [view, primaryView, categoryFilter, queueFilter, quickView, pipelineFilters,
    paymentFilters, cemeteryFilter, repFilter, hasDeposit, owesBalance, needsAttentionOnly, needsCallOnly, unsignedOnly, search])

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

  // Combine gate (Paul, 2026-07-14): 2+ selected, all the SAME customer and
  // family name, none archived — mirrors combineOrders' server-side re-check.
  const combinable = useMemo(() => {
    if (selectedOrders.length < 2) return null
    const first = selectedOrders[0]
    const fam = (o) => String(o.primary_lastname || '').trim().toUpperCase()
    const ok = selectedOrders.every(o => !o.archived
      && (o.customer_id || null) === (first.customer_id || null)
      && fam(o) === fam(first))
    return ok ? selectedOrders : null
  }, [selectedOrders])

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
  // Combine into one order — the signed (or oldest) order absorbs the rest.
  const askCombine = () => {
    const list = combinable
    if (!list) return
    const signed = list.filter(o => o.signed_at).sort((a, b) => String(a.signed_at).localeCompare(String(b.signed_at)))
    const primary = signed[0] || [...list].sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')))[0]
    const others = list.filter(o => o.id !== primary.id)
    setConfirm({
      title: `Combine ${list.length} orders into ${primary.order_number || 'this order'}?`,
      body: `${others.map(o => `${o.order_number} (${orderTypeLabel(o)})`).join(', ')} will be absorbed into ${primary.order_number}: service types, payments, and totals merge onto the one order, and its pipeline gains every workflow. The absorbed orders are archived with a pointer note. This cannot be undone in one click.`,
      run: () => runBulk(async () => {
        const r = await combineOrders(primary.id, others.map(o => o.id))
        if (!r.ok) window.alert(`Could not combine — ${r.error}`)
        return r
      }),
    })
  }
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
  // Permanent delete (Paul 2026-07-22: "not only close/archive — delete").
  // Typed confirmation, no soft modal — this one really erases.
  const askDelete = () => {
    const n = selectedIds.size
    if (!n) return
    const ack = window.prompt(
      `PERMANENTLY DELETE ${n} order${n === 1 ? '' : 's'}?\n\n` +
      'This erases the selected order(s) plus their jobs, tasks, activity, permits, and attachments. ' +
      'Money already recorded in Payments (outgoing) is kept but unlinked. This cannot be undone.\n\n' +
      'Type DELETE to confirm.'
    )
    if (ack !== 'DELETE') return
    runBulk(() => bulkHardDeleteOrders(ids()), {
      successText: r => `Deleted ${r.count} order${r.count === 1 ? '' : 's'}${r.failed?.length ? ` · ${r.failed.length} failed` : ''}.`,
    })
  }
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
    const today = todayISO()
    setAllJobs(prev => prev.map(j => {
      if (j.order_id !== orderId) return j
      const milestones = (j.milestones || []).map(m =>
        statusByKey[m.milestone_key]
          ? { ...m, status: statusByKey[m.milestone_key], status_date: statusByKey[m.milestone_key] === 'done' ? today : null }
          : m)
      return { ...j, milestones }
    }))
  }, [])

  // ── Board drag-drop — a drop sets the order's status (the same mutation as
  // the bulk "Set status" action): optimistic patch, activity log, 8s Undo
  // toast. Leads → Contracted may leave the card in Leads (no deposit yet —
  // Paul's rule); the toast says so explicitly so it doesn't look broken.
  const boardMove = useCallback(async (o, target) => {
    if (!BOARD_DROP_TARGETS.has(target) || o.status === target) return
    const prev = o.status
    patchOrderLocal(o.id, { status: target })
    const r = await bulkSetOrderStatus([o.id], target)
    if (!r?.ok) {
      patchOrderLocal(o.id, { status: prev })
      showBoardToast({ error: true, text: `Couldn't move ${properName(o._familyName)} — nothing was changed.` })
      return
    }
    logOrderActivity(o.id, {
      type: 'change', field: 'Status', oldValue: statusInfo(prev).label, newValue: statusInfo(target).label,
      note: 'Moved on the pipeline board', actor: await getCurrentStaffName(),
    }).catch(() => {})
    // No deposit yet → the row still fails isOrderRow and stays in the Leads
    // column no matter which stage was dropped on. Say so, or it looks broken.
    const stillLead = !((o._paid ?? 0) > 0)
    showBoardToast({
      text: stillLead
        ? `${properName(o._familyName)} is now ${statusInfo(target).label} — stays under Leads until a deposit is recorded.`
        : `${properName(o._familyName)} moved to ${statusInfo(target).label}.`,
      undo: async () => {
        clearTimeout(boardToastTimer.current); setBoardToast(null)
        patchOrderLocal(o.id, { status: prev })
        const u = await bulkSetOrderStatus([o.id], prev)
        if (!u?.ok) reload()
      },
    })
  }, [patchOrderLocal, showBoardToast, reload])

  // OPTIMISTIC-FIRST inline edits — patch local state BEFORE the await so the
  // UI updates instantly with ZERO flicker (no busy/disable opacity change, no
  // toast, no refetch). On the rare write failure, reload() resyncs the true
  // state. Payment is a manual override on orders.payment_status.
  const inlinePayment = async (o, code) => {
    patchOrderLocal(o.id, { payment_status: code })
    const r = await bulkUpdateOrders([o.id], { payment_status: code })
    if (!r.ok) reload()
  }
  // No job yet is NOT a blocker — statuses stay adjustable while the order is
  // still being worked up (Paul, 2026-07-14). Setting one on a jobless order
  // quietly creates the job (allowUnsigned, same as the New Order form) and
  // applies the status to it.
  const ensureJobForStatus = async (o) => {
    if (o._job) return o._job
    // LEADS never auto-create jobs (audit A3) — an unsigned, no-deposit order
    // becoming a live job would surface as phantom shop work in Jobs, the
    // hubs, the field app, and the scheduler. Signed or deposit-bearing
    // orders create the job quietly, as before.
    if (!o.signed_at && !isOrderRow(o, o._paid)) {
      window.alert('Still a lead — statuses activate once there’s a signed contract or a deposit. Nothing was saved.')
      reload()
      return null
    }
    const jr = await createJobFromOrder(o.id, { source: 'inline_status', allowUnsigned: true })
    if (!jr.ok) { reload(); return null }
    return jr.job
  }
  const inlineDesign = async (o, code) => {
    const j = await ensureJobForStatus(o)
    if (!j) return
    // Pass the job so the optimistic plan uses ITS design vocabulary (bronze/
    // inscription templates carry different keys than the proof_* trio).
    if (o._job) patchJobMilestonesLocal(o.id, orderStatusWritePlan('design', code, o._job))
    const r = await setOrderDesignStatus(j.id, code)
    // seeded = the write had to create the design milestones (template had
    // none); !o._job = the job itself is brand new — resync either way.
    if (!r.ok || r.seeded || !o._job) reload()
  }
  const inlineStone = async (o, code) => {
    const j = await ensureJobForStatus(o)
    if (!j) return
    // Pass the job so the optimistic plan matches the server write's
    // vocabulary (bronze jobs flip bronze_* keys, not stone_*).
    if (o._job) patchJobMilestonesLocal(o.id, orderStatusWritePlan('stone', code, o._job))
    const r = await setOrderStoneStatus(j.id, code)
    if (!r.ok || !o._job) reload()
  }
  const inlineFdn = async (o, code) => {
    const j = await ensureJobForStatus(o)
    if (!j) return
    if (o._job) patchJobMilestonesLocal(o.id, orderStatusWritePlan('fdn', code, o._job))
    const r = await setOrderFdnStatus(j.id, code)
    if (!r.ok || !o._job) reload()
  }
  // Permit — writes orders.permit_status (single source of truth; Permit Hub +
  // Cemetery & Grave card read the same field). Auto-stamps the submitted/approved
  // date when first reached. Logged to order_activity in Phase 7.
  const inlinePermit = async (o, code) => {
    const today = todayISO()
    const patch = { permit_status: code }
    if (code === 'submitted' && !o.permit_filed_at) patch.permit_filed_at = today
    if (code === 'approved' && !o.permit_approved_at) patch.permit_approved_at = today
    patchOrderLocal(o.id, patch)
    const prev = o.permit_status || 'unknown'
    const r = await setOrderPermit(o.id, patch)
    if (!r.ok) { reload(); return }
    logOrderActivity(o.id, { type: 'change', field: 'Permit status', oldValue: permitStatusLabel(prev), newValue: permitStatusLabel(code), note: 'Permit status changed', actor: await getCurrentStaffName() }).catch(() => {})
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
    if (!r.ok) { reload(); return }
    // Signing guarantees the job exists (Paul, 2026-07-14 — the inline toggle
    // used to stamp signed_at with no job, leaving dead status cells).
    if (signed && !o._job) { await createJobFromOrder(o.id, { source: 'inline_signed' }); reload() }
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
      { label: 'Job type', get: o => orderTypeLabel(o) },
      { label: 'Stage', get: o => o._stageLabel || statusInfo(o.status).label },  // furthest-done milestone, fallback status
      { label: 'Deposit', get: o => o._paid },
      { label: 'Balance', get: o => o._balance },
      { label: 'Cemetery', get: o => o.cemetery?.name || '' },
    ]
    downloadCSV(`orders-${todayISO()}.csv`, toCSV(rows, cols))
    showToast(`Exported ${rows.length} order${rows.length === 1 ? '' : 's'} to CSV.`)
  }

  const resetAll = () => {
    setPrimaryView('active'); setCategoryFilter(null)
    setPipelineFilters(new Set()); setPaymentFilters(new Set())
    setCemeteryFilter(''); setHasDeposit(false); setOwesBalance(false)
    setNeedsAttentionOnly(false); setNeedsCallOnly(false); setUnsignedOnly(false)
    setQuickView(null); setSearch('')
  }
  // Pipeline strip tile click — single-select status filter (click again to clear).
  const onStripStage = (code) => {
    setPipelineFilters(prev => (prev.size === 1 && prev.has(code)) ? new Set() : new Set([code]))
  }
  const toggleSet = (set, setter) => (code) => {
    const next = new Set(set); next.has(code) ? next.delete(code) : next.add(code); setter(next)
  }
  // More-filters single-select toggles (needs_info / deposit_only).
  const onQuickView = (code) => setQuickView(v => v === code ? null : code)
  // Pick a primary axis (Active/Closed/Archived). Archived refetches; Active↔Closed
  // is client-side. Clears stale selection on change.
  const onPrimaryView = (code) => { setPrimaryView(code); clearSelection() }
  // Single-select category chip ('all' or null clears it).
  const onCategory = (code) => { setCategoryFilter(code === 'all' ? null : code); clearSelection() }

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

  const canArchive = primaryView !== 'archived'
  const canRestore = primaryView === 'archived'

  // "More filters" badge + clear — everything that lives in the dropdown.
  const moreActiveCount = pipelineFilters.size + paymentFilters.size
    + (hasDeposit ? 1 : 0) + (needsAttentionOnly ? 1 : 0) + (quickView ? 1 : 0)
  const clearMoreFilters = () => {
    setPipelineFilters(new Set()); setPaymentFilters(new Set())
    setHasDeposit(false); setNeedsAttentionOnly(false); setQuickView(null)
  }

  // Large, prominent All · Orders · Leads toggle (shown in every view).
  // Paul's order (2026-07-20), matching the /field SalesScreen. The default
  // view is unchanged — only the chip order.
  const viewTabs = (
    <div className="sb-leads-viewtabs">
      {[['all', 'All'], ['orders', 'Orders'], ['leads', 'Leads']].map(([code, label]) => (
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
          <LeadsView orders={orders} onOpenDetail={(id) => setSelectedOrderId(id)} onOpenOrder={onOpenOrder} onConvert={convertLead} onChanged={reload}
            onAddCheckJob={(lead) => setCheckJobFor({
              id: lead.id,
              label: `${lead.primary_lastname || lead.customer?.last_name || 'Lead'}${lead.order_number ? ` · ${lead.order_number}` : ''}`,
              cemeteryId: lead.cemetery_id || lead.cemetery?.id || null,
              cemeteryName: lead.cemetery?.name || null,
            })} />
        </div>
        {newLeadOpen && (
          <NewLeadModal onClose={() => setNewLeadOpen(false)}
            onSaved={(orderId, opts) => {
              setNewLeadOpen(false); reload()
              // "Save + check job" hands the fresh lead straight to the check-job modal.
              if (opts?.checkJob && orderId) {
                setCheckJobFor({
                  id: orderId,
                  label: opts.label || 'New lead',
                  cemeteryId: opts.cemeteryId || null,
                  cemeteryName: opts.cemeteryName || null,
                })
              }
            }} />
        )}
        {checkJobFor && (
          <CheckJobModal order={checkJobFor}
            onClose={() => setCheckJobFor(null)}
            onSaved={() => { setCheckJobFor(null); reload() }} />
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
              {searching && <> · matching “{search.trim()}” ({view === 'all' ? 'everything — active, closed + archived' : view})</>}
              {!searching && primaryView !== 'active' && <> · {PRIMARY_VIEWS.find(v => v.code === primaryView)?.label}</>}
              {!searching && categoryFilter && <> · {ORDER_CATEGORIES.find(c => c.code === categoryFilter)?.label}</>}
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

        {/* Pipeline strip — the sales pipeline as the header. Counts + $ per
            stage on the base scope; Leads tile jumps to the Leads view; stage
            tiles single-select the status filter. Active view only. */}
        {!loading && primaryView === 'active' && (
          <div className="sb-pipe">
            <button type="button" className="sb-pipe-seg sb-pipe-leads" onClick={() => setView('leads')} title="Open the Leads view">
              <span className="sb-pipe-n">{stripData.stages.leads.n}</span>
              <span className="sb-pipe-l">Leads</span>
              <span className="sb-pipe-v">{stripData.stages.leads.usd > 0 ? `${fmtUSD(stripData.stages.leads.usd)} potential` : '—'}</span>
            </button>
            {[['contracted', 'Contracted'], ['in_production', 'In production'], ['installed', 'Installed'], ['paid_in_full', 'Paid in full']].map(([code, label]) => (
              <button key={code} type="button"
                className={`sb-pipe-seg${pipelineFilters.size === 1 && pipelineFilters.has(code) ? ' on' : ''}`}
                onClick={() => onStripStage(code)} title={`Filter to ${label}`}>
                <span className="sb-pipe-n">{stripData.stages[code].n}</span>
                <span className="sb-pipe-l">{label}</span>
                <span className="sb-pipe-v">{stripData.stages[code].usd > 0 ? fmtUSD(stripData.stages[code].usd) : '—'}</span>
              </button>
            ))}
            <button type="button" className={`sb-pipe-boardbtn${boardOpen ? ' on' : ''}`} onClick={toggleBoard}
              title={boardOpen ? 'Close the board and return to the table' : 'Open the pipeline as a drag-and-drop board'}>
              {boardOpen ? '✕ Close board' : '⊞ Board'}
            </button>
          </div>
        )}

        {queueFilter && (
          <div className="sb-tw-queuebar">
            <span>Queue: <strong>{queueLabel(queueFilter)}</strong> · {filtered.length} order{filtered.length === 1 ? '' : 's'}</span>
            <button type="button" className="sb-tw-link" onClick={() => setQueueFilter(null)}>Clear queue</button>
          </div>
        )}

        {/* TIER 1 — primary axis (the main toggle) + always-visible Owes balance +
            More filters + cemetery. */}
        <div className="sb-crm-chip-row sb-ord-tier1">
          {view === 'all' ? (
            /* The All tab overrides the state axis — everything shows, and each
               row carries its own Active/Closed/Archived scope pill instead. */
            <span className="sb-ord-allnote">Everything — active, closed + archived</span>
          ) : (
            <div className="sb-ord-segmented" role="tablist" aria-label="Order state">
              {PRIMARY_VIEWS.map(v => (
                <button key={v.code} type="button" role="tab" aria-selected={primaryView === v.code}
                  className={`sb-ord-seg${primaryView === v.code ? ' on' : ''}`} onClick={() => onPrimaryView(v.code)}>{v.label}</button>
              ))}
            </div>
          )}
          <FilterChip active={owesBalance} onClick={() => setOwesBalance(v => !v)}>Owes balance</FilterChip>
          {stripData.needsCall > 0 && (
            <button type="button" className={`sb-ord-hotchip${needsCallOnly ? ' on' : ''}`} onClick={() => setNeedsCallOnly(v => !v)}>
              Needs call · {stripData.needsCall}
            </button>
          )}
          {stripData.unsigned > 0 && (
            <button type="button" className={`sb-ord-hotchip${unsignedOnly ? ' on' : ''}`} onClick={() => setUnsignedOnly(v => !v)}>
              Unsigned · {stripData.unsigned}
            </button>
          )}
          <button type="button" className={`sb-ord-morebtn${moreOpen ? ' on' : ''}${moreActiveCount ? ' has' : ''}`}
            onClick={() => setMoreOpen(v => !v)}>More filters{moreActiveCount ? ` · ${moreActiveCount}` : ''} {moreOpen ? '▴' : '▾'}</button>
          {moreActiveCount > 0 && <button type="button" className="sb-tw-link" onClick={clearMoreFilters}>Clear</button>}
          {cemeteryOptions.length > 0 && (
            <select className="sb-crm-sort sb-ord-cemsel" value={cemeteryFilter} onChange={e => setCemeteryFilter(e.target.value)}>
              <option value="">All cemeteries</option>
              {cemeteryOptions.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          )}
          {repOptions.length > 0 && (
            <select className="sb-crm-sort sb-ord-cemsel" value={repFilter} onChange={e => setRepFilter(e.target.value)} title="Filter by who started the order">
              <option value="">Created by: anyone</option>
              {repOptions.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          )}
        </div>

        {/* TIER 2 — category chips with live counts (single-select). The selected
            category's count equals the rows shown. */}
        <div className="sb-crm-chip-row sb-ord-tier2">
          <FilterChip active={!categoryFilter} onClick={() => onCategory('all')}>All <span className="sb-ord-cat-n">{categoryCounts.all}</span></FilterChip>
          {ORDER_CATEGORIES.map(c => (
            <FilterChip key={c.code} active={categoryFilter === c.code} onClick={() => onCategory(c.code)}>
              {c.label} <span className="sb-ord-cat-n">{categoryCounts[c.code] || 0}</span>
            </FilterChip>
          ))}
        </div>

        {/* MORE FILTERS — collapsible. Nothing deleted; everything stays reachable. */}
        {moreOpen && (
          <div className="sb-crm-chip-row sb-ord-more">
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
            </div>
            <div className="sb-crm-chip-group">
              <span className="sb-crm-chip-group-label">Other</span>
              <FilterChip active={quickView === 'needs_info'} onClick={() => onQuickView('needs_info')}>Needs info</FilterChip>
              <FilterChip active={quickView === 'deposit_only'} onClick={() => onQuickView('deposit_only')}>Deposit-only</FilterChip>
              <FilterChip active={needsAttentionOnly} onClick={() => setNeedsAttentionOnly(v => !v)}>Needs attention</FilterChip>
            </div>
          </div>
        )}

        {/* Board mode swaps ONLY the table area (bulk bar + table + pager);
            the strip, toggles, chips, and filters above stay live for both. */}
        {boardActive ? (
          <OrdersBoard columns={boardColumns} loading={loading} onOpen={setSelectedOrderId}
            onMove={boardMove} toast={boardToast} onDismissToast={() => setBoardToast(null)}
            onResetFilters={resetAll} />
        ) : (<>

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
              {combinable && <button type="button" className="sb-tw-bbtn" disabled={busy} onClick={askCombine} title="Merge these orders (same family + customer) into one — types, payments, totals, and pipeline">Combine into one order</button>}
              {canArchive && <button type="button" className="sb-tw-bbtn" disabled={busy} onClick={askArchive}>Archive</button>}
              <button type="button" className="sb-tw-bbtn" style={{ color: '#ff8d80', borderColor: 'rgba(255,141,128,.45)' }} disabled={busy} onClick={askDelete}>Delete</button>
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
              <button type="button" className={`sb-ord-sort-th ${sortKey === 'jobType' ? 'on' : ''}`} onClick={() => handleHeaderSort('jobType')} title="Sort by job type">Job Type{sortCaret('jobType')}</button>
              <span onMouseDown={startColResize(3)} style={COL_RESIZE} />
            </div>
            <div style={{ position: 'relative', minWidth: 0 }}>
              <button type="button" className={`sb-ord-sort-th ${sortKey === 'cemeteryName' ? 'on' : ''}`} onClick={() => handleHeaderSort('cemeteryName')} title="Sort by cemetery">Cemetery{sortCaret('cemeteryName')}</button>
              <span onMouseDown={startColResize(4)} style={COL_RESIZE} />
            </div>
            <div style={{ position: 'relative', minWidth: 0 }}>
              <span className="sb-ord-sort-th" style={{ cursor: 'default' }}>Customer</span>
              <span onMouseDown={startColResize(5)} style={COL_RESIZE} />
            </div>
            <div style={{ position: 'relative', minWidth: 0 }}>
              <button type="button" className={`sb-ord-sort-th ${sortKey === 'payment' ? 'on' : ''}`} onClick={() => handleHeaderSort('payment')} title="Sort by payment status">Payment{sortCaret('payment')}</button>
              <span onMouseDown={startColResize(6)} style={COL_RESIZE} />
            </div>
            <div style={{ position: 'relative', minWidth: 0 }}>
              <button type="button" className={`sb-ord-sort-th ${sortKey === 'design' ? 'on' : ''}`} onClick={() => handleHeaderSort('design')} title="Sort by design stage">Design{sortCaret('design')}</button>
              <span onMouseDown={startColResize(7)} style={COL_RESIZE} />
            </div>
            <div style={{ position: 'relative', minWidth: 0 }}>
              <button type="button" className={`sb-ord-sort-th ${sortKey === 'stone' ? 'on' : ''}`} onClick={() => handleHeaderSort('stone')} title="Sort by stone / bronze stage">Stone / Bronze{sortCaret('stone')}</button>
              <span onMouseDown={startColResize(8)} style={COL_RESIZE} />
            </div>
            <div style={{ position: 'relative', minWidth: 0 }}>
              <button type="button" className={`sb-ord-sort-th ${sortKey === 'permit' ? 'on' : ''}`} onClick={() => handleHeaderSort('permit')} title="Sort by permit status">Permit{sortCaret('permit')}</button>
              <span onMouseDown={startColResize(9)} style={COL_RESIZE} />
            </div>
            <div style={{ position: 'relative', minWidth: 0 }}>
              <button type="button" className={`sb-ord-sort-th ${sortKey === 'fdn' ? 'on' : ''}`} onClick={() => handleHeaderSort('fdn')} title="Sort by foundation stage">Foundation{sortCaret('fdn')}</button>
              <span onMouseDown={startColResize(10)} style={COL_RESIZE} />
            </div>
            <div style={{ position: 'relative', minWidth: 0 }}>
              <button type="button" className={`sb-ord-sort-th ${sortKey === 'paymentStatus' ? 'on' : ''}`} onClick={() => handleHeaderSort('paymentStatus')} title="Group by payment status (Paid → Deposit → Not paid)">Contract{sortCaret('paymentStatus')}</button>
              <span onMouseDown={startColResize(11)} style={COL_RESIZE} />
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
                showScope={view === 'all'}
                onInlinePayment={inlinePayment}
                onInlineDesign={inlineDesign} onInlineStone={inlineStone} onInlineFdn={inlineFdn} onInlinePermit={inlinePermit}
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

        </>)}
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

function OrderRow({ order: o, grid, indexInFiltered, selected, onToggle, onOpen, onInlinePayment, onInlineDesign, onInlineStone, onInlineFdn, onInlinePermit, onInlineDate, onInlineSigned, onInlineTotal, busy, showScope = false }) {
  const hasJob = !!o._job
  const custName = [o.customer?.first_name, o.customer?.last_name].map(properName).filter(Boolean).join(' ')

  const blocker = o._pressure?.blocker || null
  return (
    <div className={`sb-crm-row sb-tw-row${selected ? ' sb-tw-row-sel' : ''}${blocker ? ` sb-tw-sev-${blocker.severity}` : ''}`} style={{ gridTemplateColumns: grid }}>
      <div onClick={e => e.stopPropagation()}>
        <input type="checkbox" checked={selected}
          onClick={e => { e.stopPropagation(); onToggle(o.id, indexInFiltered, e.shiftKey) }}
          onChange={() => {}} aria-label="Select order" />
      </div>

      {/* Family (click → detail) — carries the blocker pill + call flag */}
      <button type="button" className="sb-tw-cust" onClick={() => onOpen(o.id)} style={{ minWidth: 0 }}>
        <div className="sb-ord-cust-line">
          <span className="sb-crm-primary sb-ord-cust-name">{properName(o._familyName)}</span>
          {o._missingInfo && <span className="sb-tw-badge" title="Missing shape / size / color">info</span>}
        </div>
        {/* Pills live UNDER the name, never beside it — the wide LEAD banner
            was flex-crushing the name span to zero width (Paul, 2026-07-14:
            banners below the family name are fine; hiding the name never is). */}
        {(isLeadRow(o) || showScope) && (
          <div className="sb-ord-scopeline">
            {isLeadRow(o) && <span className="sb-ord-leadpill" title="No deposit received — still a lead">LEAD · NO DEPOSIT</span>}
            {showScope && (() => {
              const state = o.archived ? 'archived' : TERMINAL_STATUSES.has(o.status) ? 'closed' : 'active'
              const kind = isOrderRow(o, o._paid) ? 'Order' : 'Lead'
              const label = { archived: 'Archived', closed: 'Closed', active: 'Active' }[state]
              return <span className={`sb-ord-scopepill sb-ord-scopepill-${state}`}>{kind} · {label}</span>
            })()}
          </div>
        )}
        {(blocker || o.manual_blocker) && (
          <div className="sb-ord-blockline">
            {/* Manual blocker first — a human set it on purpose. Its kind chip
                replaces the derived Call chip (no double red pills). */}
            {o.manual_blocker && (
              <span className="sb-ord-callpill" title={`Set by ${o.manual_blocker.setBy || 'staff'}${o.manual_blocker.setAt ? ' · ' + String(o.manual_blocker.setAt).slice(0, 10) : ''}`}>
                {manualBlockerChipText(o.manual_blocker)}
              </span>
            )}
            {o.manual_blocker?.note && <span className="sb-ord-bpill sb-ord-bpill-amber">{o.manual_blocker.note}</span>}
            {blocker && <span className={`sb-ord-bpill sb-ord-bpill-${blocker.severity}`}>{blocker.label}</span>}
            {!o.manual_blocker && o._pressure.needsCall && <span className="sb-ord-callpill" title={(o._pressure.callReasons || []).join(' · ') || 'Needs a phone call'}>Call</span>}
          </div>
        )}
        {!blocker && !o.manual_blocker && o._setBlock && <div className="sb-ord-block" title="Ready to set, blocked">⚠ {o._setBlock}</div>}
      </button>

      {/* Order # */}
      <div style={{ minWidth: 0 }}><span className="sb-crm-secondary sb-crm-mono" style={{ fontSize: 12 }}>{o.order_number || 'DRAFT'}</span></div>

      {/* Job Type — combined orders stack each service type on its own line */}
      <div>
        {orderTypeLabels(o).map(l => (
          <div key={l}><span className="sb-crm-secondary">{l}</span></div>
        ))}
      </div>

      {/* Cemetery */}
      <div><span style={{ fontSize: 13 }}>{o.cemetery?.name || <span className="sb-crm-muted">—</span>}</span></div>

      {/* Customer name (full first + last, title-cased, shown in full — no truncation) */}
      <div style={{ minWidth: 0 }}>
        <span className="sb-crm-secondary" style={{ fontSize: 13, display: 'block', whiteSpace: 'normal', overflowWrap: 'anywhere' }}>
          {custName || <span className="sb-crm-muted">—</span>}
        </span>
      </div>

      {/* Payment — editable manual override (orders.payment_status) */}
      <div onClick={e => e.stopPropagation()}>
        <select className={`sb-tw-inline sb-tw-perm sb-tw-perm-${paymentStatusTone(o._payment || 'quoted')}`} value={o._payment || 'quoted'} disabled={busy} onChange={e => onInlinePayment(o, e.target.value)}>
          {PAYMENT_STATUS.map(s => <option key={s.code} value={s.code}>{s.label}</option>)}
        </select>
      </div>

      {/* Design (inline → milestone; jobless orders create the job on first
          set). Hidden entirely where the dimension doesn't exist (acid wash /
          repair have no design work). */}
      <div onClick={e => e.stopPropagation()}>
        {statusDimApplies('design', o._job, o) ? (
          <select className={`sb-tw-inline sb-tw-perm sb-tw-perm-${designStatusTone(o._design || 'not_created')}`} value={o._design || 'not_created'} disabled={busy} onChange={e => onInlineDesign(o, e.target.value)}>
            {designStatusOptions(o._job, o).map(s => <option key={s.code} value={s.code}>{s.label}</option>)}
          </select>
        ) : <span className="sb-crm-muted">—</span>}
      </div>

      {/* Stone (inline → milestone) — inscriptions carve an existing stone,
          acid wash / repair order nothing: no stone dimension. */}
      <div onClick={e => e.stopPropagation()}>
        {statusDimApplies('stone', o._job, o) ? (
          <select className={`sb-tw-inline sb-tw-perm sb-tw-perm-${stoneStatusTone(o._stone || 'not_ordered')}`} value={o._stone || 'not_ordered'} disabled={busy} onChange={e => onInlineStone(o, e.target.value)}>
            {stoneStatusOptions(o._job).map(s => <option key={s.code} value={s.code}>{s.label}</option>)}
          </select>
        ) : <span className="sb-crm-muted">—</span>}
      </div>

      {/* Permit (inline → orders.permit_status — single source of truth). Applies to
          EVERY order; legacy 'required'/'unknown' show as a disabled display-only
          option ("Permit Needed" / "—") while the 5 selectable codes are the choices. */}
      <div onClick={e => e.stopPropagation()}>
        <select className={`sb-tw-inline sb-tw-perm sb-tw-perm-${permitStatusTone(o.permit_status)}`}
          value={o.permit_status || 'unknown'} disabled={busy} onChange={e => onInlinePermit(o, e.target.value)}>
          {!PERMIT_SELECTABLE.has(o.permit_status) && (
            <option value={o.permit_status || 'unknown'} disabled>{permitStatusLabel(o.permit_status || 'unknown')}</option>
          )}
          {PERMIT_STATUS_OPTIONS.map(s => <option key={s.code} value={s.code}>{s.label}</option>)}
        </select>
      </div>

      {/* Foundation (inline → milestone) — inscriptions / acid wash / repair
          never pour one. */}
      <div onClick={e => e.stopPropagation()}>
        {statusDimApplies('fdn', o._job, o) ? (
          <select className={`sb-tw-inline sb-tw-perm sb-tw-perm-${fdnStatusTone(o._fdn || 'na')}`} value={o._fdn || 'na'} disabled={busy} onChange={e => onInlineFdn(o, e.target.value)}>
            {FDN_STATUS.map(s => <option key={s.code} value={s.code}>{s.label}</option>)}
          </select>
        ) : <span className="sb-crm-muted">—</span>}
      </div>

      {/* Contract (signed_at) — an explicit signed/not-signed status (settable on
          EVERY order) + the exact date. Commits on blur/Enter only. */}
      <div onClick={e => e.stopPropagation()} style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
        <select className={`sb-tw-inline sb-tw-perm sb-tw-perm-${contractSignedTone(!!o.signed_at)}`} value={o.signed_at ? 'signed' : 'unsigned'} disabled={busy}
          onChange={e => onInlineSigned(o, e.target.value === 'signed')}>
          <option value="unsigned">Unsigned</option>
          <option value="signed">Signed ✓</option>
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

// ── OrdersBoard — the kanban view of the pipeline ─────────────────────────────
// One column per BOARD_STAGES entry, cards sorted by the table's current sort.
// Native HTML5 drag (the CAL-DRAG approach — no dependency): drag state lives
// locally, the drop delegates to onMove which owns the mutation + toast.
function OrdersBoard({ columns, loading, onOpen, onMove, toast, onDismissToast, onResetFilters }) {
  const [drag, setDrag] = useState(null)       // { order } while a card is mid-drag
  const [overCol, setOverCol] = useState(null) // column code under the pointer

  if (loading) return <div className="sb-crm-card"><div className="sb-crm-empty">Loading orders…</div></div>
  const total = BOARD_STAGES.reduce((n, s) => n + columns[s.code].rows.length, 0)

  return (
    <>
      {total === 0 ? (
        <div className="sb-crm-card">
          <div className="sb-crm-empty">No orders match these filters.<div><button type="button" onClick={onResetFilters}>Reset filters</button></div></div>
        </div>
      ) : (
        <div className="sb-kb">
          {BOARD_STAGES.map(s => {
            const col = columns[s.code]
            const canDrop = !!drag && BOARD_DROP_TARGETS.has(s.code) && drag.order.status !== s.code
            return (
              <div key={s.code}
                className={`sb-kb-col${canDrop ? ' sb-kb-can' : ''}${canDrop && overCol === s.code ? ' sb-kb-over' : ''}`}
                onDragOver={canDrop ? (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move' } : undefined}
                onDragEnter={canDrop ? () => setOverCol(s.code) : undefined}
                onDragLeave={canDrop ? (e) => { if (!e.currentTarget.contains(e.relatedTarget)) setOverCol(null) } : undefined}
                onDrop={canDrop ? (e) => { e.preventDefault(); const o = drag?.order; setDrag(null); setOverCol(null); if (o) onMove(o, s.code) } : undefined}>
                <div className="sb-kb-head">
                  <span className="sb-kb-head-n">{col.rows.length}</span>
                  <span className="sb-kb-head-l">{s.label}</span>
                  <span className="sb-kb-head-v">{col.usd > 0 ? fmtUSD(col.usd) : '—'}</span>
                </div>
                {s.code === 'paid_in_full' && <div className="sb-kb-hint">Set by payments — not a drop target</div>}
                {col.rows.slice(0, BOARD_COL_CAP).map(o => (
                  <BoardCard key={o.id} order={o}
                    draggable={s.code !== 'paid_in_full'}
                    dragging={drag?.order.id === o.id}
                    onDragStart={(e) => { e.dataTransfer.setData('text/plain', o.id); e.dataTransfer.effectAllowed = 'move'; setDrag({ order: o }) }}
                    onDragEnd={() => { setDrag(null); setOverCol(null) }}
                    onOpen={onOpen} />
                ))}
                {col.rows.length > BOARD_COL_CAP && (
                  <div className="sb-kb-more">+{col.rows.length - BOARD_COL_CAP} more — narrow with search or filters</div>
                )}
                {col.rows.length === 0 && <div className="sb-kb-empty">{canDrop ? 'Drop here' : 'No orders'}</div>}
              </div>
            )
          })}
        </div>
      )}
      {toast && (
        <div className={`sb-kb-toast${toast.error ? ' err' : ''}`} role="status">
          <span>{toast.text}</span>
          {toast.undo && <button type="button" className="sb-kb-undo" onClick={toast.undo}>Undo</button>}
          <button type="button" className="sb-kb-x" onClick={onDismissToast} aria-label="Dismiss">✕</button>
        </div>
      )}
    </>
  )
}

// LEAD = no real money down (the money half of leads.js isOrderRow) and not a
// terminal status. Rendered LOUD on rows/cards — a stone might get ordered
// with $0 collected. Deposit-but-unsigned is NOT flagged here (the Unsigned
// badge owns that case).
const isLeadRow = (o) => (o._paid ?? 0) <= 0 && !['closed', 'cancelled', 'archived'].includes(o.status)

// One board card — same signals as the table row: severity stripe, blocker
// pill, Call flag, Unsigned badge. Click (or Enter) opens OrderDetail.
function BoardCard({ order: o, draggable, dragging, onDragStart, onDragEnd, onOpen }) {
  const blocker = o._pressure?.blocker || null
  const unsigned = !o.signed_at && CONTRACTED_STATUSES.includes(o.status)
  const lead = isLeadRow(o)
  return (
    <div className={`sb-kb-card${blocker ? ` sb-tw-sev-${blocker.severity}` : ''}${dragging ? ' sb-kb-dragging' : ''}`}
      draggable={draggable} onDragStart={onDragStart} onDragEnd={onDragEnd}
      role="button" tabIndex={0}
      onClick={() => onOpen(o.id)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(o.id) } }}>
      <div className="sb-kb-card-top">
        <span className="sb-kb-card-name">{properName(o._familyName)}</span>
        <span className="sb-kb-card-num">{o.order_number || 'DRAFT'}</span>
      </div>
      {o.cemetery?.name && <div className="sb-kb-card-cem">{o.cemetery.name}</div>}
      <div className="sb-kb-card-money">
        {o._total > 0 ? fmtUSD(o._total) : '—'}
        {o._balance > 0 && <span className="sb-kb-card-owes"> · owes {fmtUSD(o._balance)}</span>}
      </div>
      {(blocker || unsigned || lead || o.manual_blocker || o._pressure?.needsCall) && (
        <div className="sb-ord-blockline">
          {lead && <span className="sb-ord-leadpill" title="No deposit received — still a lead">LEAD · NO DEPOSIT</span>}
          {o.manual_blocker && (
            <span className="sb-ord-callpill" title={`Set by ${o.manual_blocker.setBy || 'staff'}${o.manual_blocker.setAt ? ' · ' + String(o.manual_blocker.setAt).slice(0, 10) : ''}`}>
              {manualBlockerChipText(o.manual_blocker)}
            </span>
          )}
          {o.manual_blocker?.note && <span className="sb-ord-bpill sb-ord-bpill-amber">{o.manual_blocker.note}</span>}
          {blocker && <span className={`sb-ord-bpill sb-ord-bpill-${blocker.severity}`}>{blocker.label}</span>}
          {unsigned && <span className="sb-ord-bpill sb-ord-bpill-red">Unsigned</span>}
          {!o.manual_blocker && o._pressure?.needsCall && <span className="sb-ord-callpill" title={(o._pressure.callReasons || []).join(' · ') || 'Needs a phone call'}>Call</span>}
        </div>
      )}
    </div>
  )
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
  /* ── Pipeline strip — the sales pipeline as the header ─────────────────── */
  .sb-pipe { display: flex; gap: 5px; margin-bottom: 12px; }
  .sb-pipe-seg { flex: 1; border: 0.5px solid #E2D8C6; background: #FBFAF7; border-radius: 10px; padding: 9px 13px 8px;
    text-align: left; cursor: pointer; font: inherit; transition: border-color 0.12s, background 0.12s; }
  .sb-pipe-seg:hover { border-color: #9A7209; }
  .sb-pipe-seg.on { border-color: #9A7209; background: rgba(154,114,9,0.09); box-shadow: inset 0 -3px 0 #9A7209; }
  .sb-pipe-n { display: block; font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 19px; font-weight: 700; line-height: 1.15; color: #1e2d3d; }
  .sb-pipe-l { display: block; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.07em; color: #8a8a85; margin-top: 1px; }
  .sb-pipe-seg.on .sb-pipe-l { color: #876307; }
  .sb-pipe-v { display: block; font-size: 11px; color: #8a8a85; font-variant-numeric: tabular-nums; margin-top: 2px; }
  .sb-pipe-leads { background: #f4f1e9; }

  /* ── Hot chips + row blocker layer ─────────────────────────────────────── */
  .sb-ord-hotchip { border: 0.5px solid rgba(179,38,30,0.4); background: rgba(179,38,30,0.06); color: #b3261e;
    cursor: pointer; border-radius: 999px; padding: 6px 13px; font-size: 12.5px; font-weight: 700; }
  .sb-ord-hotchip:hover { background: rgba(179,38,30,0.12); }
  .sb-ord-hotchip.on { background: #b3261e; border-color: #b3261e; color: #fff; }
  .sb-tw-sev-red   { box-shadow: inset 3px 0 0 #B3261E; }
  .sb-tw-sev-amber { box-shadow: inset 3px 0 0 #B7791F; }
  .sb-tw-sev-blue  { box-shadow: inset 3px 0 0 #1D6FA8; }
  .sb-tw-row-sel.sb-tw-sev-red, .sb-tw-row-sel.sb-tw-sev-amber, .sb-tw-row-sel.sb-tw-sev-blue { box-shadow: none; }
  .sb-ord-blockline { display: flex; align-items: center; gap: 6px; margin-top: 4px; flex-wrap: wrap; }
  .sb-ord-bpill { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em;
    border-radius: 5px; padding: 2px 7px; white-space: nowrap; }
  .sb-ord-bpill-red   { color: #B3261E; background: rgba(179,38,30,0.08); }
  .sb-ord-bpill-amber { color: #8a5a12; background: rgba(183,121,31,0.1); }
  .sb-ord-allnote { font-size: 12.5px; font-weight: 600; color: #6a6a66; padding: 6px 2px; white-space: nowrap; }
  .sb-ord-scopeline { margin-top: 3px; display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
  .sb-ord-scopepill { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em;
    border-radius: 5px; padding: 2px 7px; white-space: nowrap; }
  .sb-ord-scopepill-active   { color: #15724a; background: rgba(29,158,117,0.11); }
  .sb-ord-scopepill-closed   { color: #B3261E; background: rgba(179,38,30,0.10); }
  .sb-ord-scopepill-archived { color: #6a6a66; background: #f0eee9; }
  .sb-ord-bpill-blue  { color: #1D6FA8; background: rgba(29,111,168,0.09); }
  .sb-ord-callpill { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em;
    color: #B3261E; border: 0.5px solid rgba(179,38,30,0.4); border-radius: 999px; padding: 1px 8px; }
  /* LEAD pill — solid red, the loudest badge on any row/card. */
  .sb-ord-leadpill { font-size: 10px; font-weight: 800; letter-spacing: 0.07em;
    color: #fff; background: #B3261E; border-radius: 999px; padding: 2px 9px; white-space: nowrap; }

  /* ── 2-tier filter header ─────────────────────────────────────────────── */
  .sb-ord-tier1 { align-items: center; gap: 10px; }
  .sb-ord-tier2 { margin-top: -4px; }
  .sb-ord-segmented { display: inline-flex; background: #ece6d8; border-radius: 10px; padding: 3px; gap: 2px; }
  .sb-ord-seg { border: none; cursor: pointer; border-radius: 8px; padding: 7px 18px; font-size: 13.5px; font-weight: 700;
    background: transparent; color: #7a756a; transition: background 0.12s, color 0.12s; }
  .sb-ord-seg.on { background: #fff; color: #0f1419; box-shadow: 0 1px 3px rgba(0,0,0,0.12); }
  .sb-ord-morebtn { border: 1px solid #d8d6d1; background: #fff; color: #4a4a45; cursor: pointer; border-radius: 999px;
    padding: 6px 14px; font-size: 13px; font-weight: 600; }
  .sb-ord-morebtn:hover { border-color: #9A7209; }
  .sb-ord-morebtn.on, .sb-ord-morebtn.has { border-color: #9A7209; color: #6a4d0c; background: #fdf6e7; }
  .sb-ord-cemsel { min-width: 150px; margin-left: auto; }
  .sb-ord-cat-n { display: inline-block; margin-left: 5px; padding: 0 6px; border-radius: 999px; font-size: 11px;
    font-weight: 700; background: rgba(15,20,25,0.08); color: inherit; }
  .sb-ord-more { background: #faf8f3; border: 1px solid #ece8df; border-radius: 12px; padding: 12px 14px; margin-top: 2px; }

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
  /* Permit status badge tones — glance-and-know. warn=needs action, info=submitted,
     good=approved, neutral=not required / unset. */
  .sb-tw-perm { font-weight: 600; }
  .sb-tw-perm-warn    { background: #fdf3e2; border-color: #e6b667; color: #8a5a12; }
  .sb-tw-perm-info    { background: #eaf1fb; border-color: #9bb8e6; color: #234c8a; }
  .sb-tw-perm-good    { background: #e7f6ee; border-color: #8fceb0; color: #15724a; }
  .sb-tw-perm-neutral { background: #f3f1ec; border-color: #d8d6d1; color: #6a6a66; }
  .sb-tw-perm-bad     { background: #fbedec; border-color: #e39b95; color: #b3261e; }

  /* Orders-redesign cells */
  .sb-ord-cust-line { display: flex; align-items: baseline; gap: 8px; min-width: 0; }
  .sb-ord-cust-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
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

  /* ── Kanban board ──────────────────────────────────────────────────────── */
  .sb-pipe-boardbtn { flex: 0 0 auto; border: 0.5px solid #E2D8C6; background: #FBFAF7; border-radius: 10px;
    padding: 9px 14px; cursor: pointer; font: inherit; font-size: 12px; font-weight: 700; color: #6a6a66;
    white-space: nowrap; transition: border-color 0.12s, background 0.12s, color 0.12s; }
  .sb-pipe-boardbtn:hover { border-color: #9A7209; color: #9A7209; }
  .sb-pipe-boardbtn.on { border-color: #9A7209; background: rgba(154,114,9,0.09); color: #876307; }
  .sb-kb { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 10px; align-items: start; margin-bottom: 14px; }
  @media (max-width: 1100px) { .sb-kb { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
  .sb-kb-col { background: #f4f1e9; border: 0.5px solid #E2D8C6; border-radius: 12px; padding: 8px;
    display: flex; flex-direction: column; gap: 8px; min-height: 240px; max-height: 74vh; overflow-y: auto; }
  .sb-kb-col.sb-kb-can { outline: 1.5px dashed rgba(154,114,9,0.45); outline-offset: -3px; }
  .sb-kb-col.sb-kb-over { outline: 2px dashed #9A7209; outline-offset: -3px; background: #fdf6e7; }
  .sb-kb-head { display: flex; align-items: baseline; gap: 7px; padding: 2px 4px 0; }
  .sb-kb-head-n { font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 14px; font-weight: 700; color: #1e2d3d; }
  .sb-kb-head-l { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.07em; color: #8a8a85; }
  .sb-kb-head-v { margin-left: auto; font-size: 11px; color: #8a8a85; font-variant-numeric: tabular-nums; }
  .sb-kb-hint { font-size: 10.5px; color: #a09a8c; padding: 0 4px 2px; }
  .sb-kb-card { background: #fff; border: 0.5px solid #e4e0d5; border-radius: 10px; padding: 9px 11px; cursor: grab; }
  .sb-kb-card:hover { border-color: #9A7209; }
  .sb-kb-card:active { cursor: grabbing; }
  .sb-kb-dragging { opacity: 0.4; }
  .sb-kb-card-top { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; min-width: 0; }
  .sb-kb-card-name { font-size: 13.5px; font-weight: 700; color: #1e2d3d; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .sb-kb-card-num { font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 10.5px; color: #8a8a85; flex-shrink: 0; }
  .sb-kb-card-cem { font-size: 11.5px; color: #6a6a66; margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .sb-kb-card-money { font-size: 12px; color: #1e2d3d; font-variant-numeric: tabular-nums; margin-top: 3px; }
  .sb-kb-card-owes { color: #8a5a12; font-weight: 600; }
  .sb-kb-more { font-size: 11.5px; color: #8a8a85; padding: 4px; text-align: center; }
  .sb-kb-empty { font-size: 11.5px; color: #a09a8c; padding: 14px 4px; text-align: center; border: 1px dashed #ddd6c6; border-radius: 8px; }
  .sb-kb-toast { position: fixed; left: 50%; transform: translateX(-50%); bottom: 26px; z-index: 1100;
    display: flex; align-items: center; gap: 12px; background: #1e2d3d; color: #fff; border-radius: 10px;
    padding: 11px 16px; font-size: 13.5px; box-shadow: 0 10px 30px rgba(15,20,25,0.3); max-width: 560px; }
  .sb-kb-toast.err { background: #7a1f1a; }
  .sb-kb-toast button { font: inherit; font-size: 12.5px; font-weight: 700; border-radius: 6px; padding: 4px 12px; cursor: pointer; }
  .sb-kb-toast .sb-kb-undo { background: #d6a85a; border: none; color: #1e2d3d; }
  .sb-kb-toast .sb-kb-x { background: transparent; border: 0.5px solid rgba(255,255,255,0.4); color: #fff; }
`
