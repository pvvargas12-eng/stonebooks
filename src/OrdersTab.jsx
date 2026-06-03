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
  fmtUSD, fmtRelative,
  computeOrderPressure,
  ORDER_STATUSES, ACTIVE_STATUSES,
  bulkArchiveOrders, bulkRestoreOrders, bulkSetOrderStatus,
  bulkSetOrderCemetery, bulkSetJobType, bulkSetStage,
  classifyOrderQueues, queueLabel, permitBuckets,
} from './lib/stonebooksData'
import { paymentLabel } from './lib/crmTheme'
import { FilterChip, ProgressMicroBar } from './lib/crmComponents.jsx'
import { toCSV, downloadCSV } from './lib/exportCsv'
import UndoToast from './components/calendar/UndoToast.jsx'
import OrderDetail from './OrderDetail.jsx'

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
const STAGE_ORDER_INDEX = Object.fromEntries(NEW_STONE_STAGES.map((k, i) => [k, i]))
const SORT_OPTIONS = [
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

// checkbox | customer | status | job type | stage | deposit | balance | cemetery | updated
const ROW_GRID = '34px 1.5fr 1.15fr 1fr 1.2fr 0.8fr 1.05fr 1.05fr 0.6fr'

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
export default function OrdersTab({ onOpenSales, onNewOrder, onEditOrder, onOpenCustomer, onOpenJob, initialQueue = null, onConsumeInitialQueue }) {
  const [selectedOrderId, setSelectedOrderId] = useState(null)
  const [orders, setOrders] = useState([])
  const [allJobs, setAllJobs] = useState([])
  const [loading, setLoading] = useState(true)
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
  const [sortKey, setSortKey] = useState('actionPriority')
  const [search, setSearch] = useState('')

  // Selection + pagination
  const [selectedIds, setSelectedIds] = useState(() => new Set())
  const lastIndexRef = useRef(null)
  const toastSeqRef = useRef(0)
  const [page, setPage] = useState(0)

  // Bulk action confirm + toast + busy
  const [confirm, setConfirm] = useState(null)  // { title, body, run }
  const [toast, setToast] = useState(null)       // { id, text, error, canUndo, onUndo }
  const [busy, setBusy] = useState(false)

  // ── Load (by archive view) ────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    setLoading(true); setLoadErr(null)
    const archived = archiveView === 'all' ? undefined : (archiveView === 'archived')
    Promise.all([
      listAllOrders({ archived, limit: 2000 }),
      getJobs({ includeClosed: true, limit: 2000 }),
    ])
      .then(([rows, jobs]) => {
        if (cancelled) return
        setOrders(rows || []); setAllJobs(jobs || []); setLoading(false)
      })
      .catch(e => { if (!cancelled) { setLoadErr(e?.message || 'Failed to load orders'); setLoading(false) } })
    return () => { cancelled = true }
  }, [archiveView, reloadNonce])

  const reload = useCallback(() => setReloadNonce(n => n + 1), [])

  // Consume an incoming queue selection from the Queues dashboard: clear other
  // filters, force the active view, apply the queue, and tell the parent it's
  // consumed (so re-entering Orders normally doesn't re-apply it).
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
      return {
        ...o, _job: job, _pressure: pressure, _total: total, _paid: paid, _balance: balance,
        _fillRatio: total > 0 ? paid / total : 0,
        _familyName: familyName,
        _jobType: job?.job_type || null,
        _stageKey: stage?.key || null, _stageLabel: stage?.label || null,
        _missingInfo: missingInfo,
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
    }
    return [...list].sort(sorters[sortKey] || sorters.actionPriority)
  }, [enriched, queueFilter, quickView, pipelineFilters, paymentFilters, jobTypeFilters, serviceTypeFilters,
      cemeteryFilter, hasDeposit, owesBalance, needsAttentionOnly, search, sortKey])

  // Reset page + clear stale selection when the filtered set changes shape.
  useEffect(() => { setPage(0) }, [archiveView, queueFilter, quickView, pipelineFilters, paymentFilters, jobTypeFilters,
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

  // ── Toast helper ──────────────────────────────────────────────────────────
  const showToast = (text, { error = false, onUndo = null } = {}) =>
    setToast({ id: String(toastSeqRef.current++), text, error, canUndo: !!onUndo, onUndo })
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 8000)
    return () => clearTimeout(t)
  }, [toast])

  // ── Bulk runner — confirm → batched write → toast(+undo) → reload ─────────
  const runBulk = async (fn, { successText, undoFn }) => {
    setBusy(true)
    const res = await fn()
    setBusy(false); setConfirm(null)
    if (!res?.ok) { showToast(res?.error || 'Bulk action failed.', { error: true }); return }
    clearSelection()
    showToast(successText(res), undoFn ? {
      onUndo: async () => {
        setToast(null); setBusy(true)
        const u = await undoFn()
        setBusy(false)
        showToast(u?.ok ? 'Undone.' : (u?.error || 'Undo failed.'), { error: !u?.ok })
        reload()
      },
    } : {})
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

  // ── Inline single-order quick-edit ────────────────────────────────────────
  const inlineStatus = async (o, status) => {
    setBusy(true); const r = await bulkSetOrderStatus([o.id], status); setBusy(false)
    showToast(r.ok ? `${o._familyName}: status → ${statusInfo(status).label}` : (r.error || 'Failed'), { error: !r.ok }); reload()
  }
  const inlineJobType = async (o, jobType) => {
    setBusy(true); const r = await bulkSetJobType([o.id], jobType); setBusy(false)
    showToast(r.ok ? `${o._familyName}: job type → ${JOB_TYPES.find(j => j.code === jobType)?.label || jobType}` : (r.error || 'Failed'), { error: !r.ok }); reload()
  }
  const inlineStage = async (o, key) => {
    setBusy(true); const r = await bulkSetStage([o.id], key); setBusy(false)
    showToast(r.ok ? `${o._familyName}: advanced to ${humanizeKey(key)}` : (r.error || 'Failed'), { error: !r.ok }); reload()
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
        onEditInSales={(id) => onEditOrder?.(id)} onOpenJob={onOpenJob} onOpenCustomer={onOpenCustomer} />
    )
  }

  const canArchive = archiveView !== 'archived'
  const canRestore = archiveView !== 'active'

  return (
    <div className="sb-crm-page">
      <style>{TW_CSS}</style>
      <div className="sb-crm-container">

        <header className="sb-crm-head">
          <div>
            <h1 className="sb-crm-head-title">Orders</h1>
            <div className="sb-crm-head-count">
              <strong>{loading ? '—' : filtered.length}</strong> {filtered.length === 1 ? 'order' : 'orders'}
              {archiveView !== 'active' && <> · {ARCHIVE_VIEWS.find(v => v.code === archiveView)?.label}</>}
            </div>
          </div>
          <div className="sb-crm-head-actions">
            <input type="search" className="sb-crm-search" placeholder="Search name, order #, cemetery, rep…"
              value={search} onChange={e => setSearch(e.target.value)} />
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
          <div className="sb-crm-row sb-crm-row-head sb-tw-row" style={{ gridTemplateColumns: ROW_GRID }}>
            <div><input type="checkbox" checked={pageAllSelected} onChange={togglePage} aria-label="Select page" /></div>
            <div>Customer</div>
            <div>Status</div>
            <div>Job type</div>
            <div>Stage</div>
            <div className="num">Deposit</div>
            <div className="num">Balance</div>
            <div>Cemetery</div>
            <div className="num">Updated</div>
          </div>

          {loading ? (
            <div className="sb-crm-empty">Loading orders…</div>
          ) : filtered.length === 0 ? (
            <div className="sb-crm-empty">No orders match these filters.<div><button type="button" onClick={resetAll}>Reset filters</button></div></div>
          ) : (
            pageRows.map((o) => (
              <OrderRow key={o.id} order={o} indexInFiltered={filteredIds.indexOf(o.id)}
                selected={selectedIds.has(o.id)} onToggle={toggleOne} onOpen={setSelectedOrderId}
                onInlineStatus={inlineStatus} onInlineJobType={inlineJobType} onInlineStage={inlineStage} busy={busy} />
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

      {toast && (
        <UndoToast key={toast.id} text={toast.text} error={toast.error} canUndo={toast.canUndo}
          durationMs={8000} onUndo={toast.onUndo} onClose={() => setToast(null)} />
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
function OrderRow({ order: o, indexInFiltered, selected, onToggle, onOpen, onInlineStatus, onInlineJobType, onInlineStage, busy }) {
  const p = o._pressure
  const pLabel = paymentLabel(p.paymentState)
  const balanceTone = o._balance <= 0 ? 'green' : (p.paymentState === 'overdue' ? 'red' : 'amber')
  const isNewStone = o._jobType === 'new_stone'

  return (
    <div className={`sb-crm-row sb-tw-row${selected ? ' sb-tw-row-sel' : ''}`} style={{ gridTemplateColumns: ROW_GRID }}>
      <div onClick={e => e.stopPropagation()}>
        <input type="checkbox" checked={selected}
          onClick={e => { e.stopPropagation(); onToggle(o.id, indexInFiltered, e.shiftKey) }}
          onChange={() => {}} aria-label="Select order" />
      </div>

      {/* Customer (click → detail) + missing-info badge */}
      <button type="button" className="sb-tw-cust" onClick={() => onOpen(o.id)}>
        <div className="sb-crm-primary">
          {o._familyName}
          {o._missingInfo && <span className="sb-tw-badge" title="Missing shape / size / color">Needs info</span>}
        </div>
        <div className="sb-crm-secondary sb-crm-mono">{o.order_number || 'DRAFT'}</div>
      </button>

      {/* Status (inline) */}
      <div onClick={e => e.stopPropagation()}>
        <select className="sb-tw-inline" value={o.status} disabled={busy} onChange={e => onInlineStatus(o, e.target.value)}>
          {ORDER_STATUSES.filter(s => s.code !== 'archived').map(s => <option key={s.code} value={s.code}>{s.label}</option>)}
        </select>
      </div>

      {/* Job type (inline) */}
      <div onClick={e => e.stopPropagation()}>
        {o._jobType ? (
          <select className="sb-tw-inline" value={o._jobType} disabled={busy} onChange={e => onInlineJobType(o, e.target.value)}>
            {JOB_TYPES.map(j => <option key={j.code} value={j.code}>{j.label}</option>)}
          </select>
        ) : <span className="sb-crm-muted">{jobTypeLabel(null, o.service_types)}</span>}
      </div>

      {/* Stage (inline for new_stone; else read-only label) */}
      <div onClick={e => e.stopPropagation()}>
        {isNewStone ? (
          <select className="sb-tw-inline" value={o._stageKey && STAGE_ORDER_INDEX[o._stageKey] != null ? o._stageKey : ''} disabled={busy} onChange={e => e.target.value && onInlineStage(o, e.target.value)}>
            <option value="">{o._stageLabel || '— not started —'}</option>
            {NEW_STONE_STAGES.map(k => <option key={k} value={k}>{humanizeKey(k)}</option>)}
          </select>
        ) : (
          <span className="sb-crm-secondary">{o._stageLabel || <span className="sb-crm-muted">—</span>}</span>
        )}
      </div>

      {/* Deposit */}
      <div className="num"><span className="sb-crm-num">{o._paid > 0 ? fmtUSD(o._paid) : '—'}</span></div>

      {/* Balance + bar */}
      <div className="num" style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
        {pLabel ? (
          <>
            <span className="sb-crm-num" style={{ color: balanceTone === 'red' ? '#B54040' : balanceTone === 'amber' ? '#B8842A' : '#1D9E75' }}>
              {o._balance > 0 ? fmtUSD(o._balance) : '$0'}
            </span>
            {o._total > 0 && <ProgressMicroBar fillRatio={o._fillRatio} tone={balanceTone} />}
          </>
        ) : <span className="sb-crm-muted">—</span>}
      </div>

      {/* Cemetery */}
      <div><span style={{ fontSize: 13 }}>{o.cemetery?.name || <span className="sb-crm-muted">—</span>}</span></div>

      {/* Updated */}
      <div className="num"><span className="sb-crm-muted sb-crm-tabular">{fmtRelative(o.updated_at)}</span></div>
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

const TW_CSS = `
  .sb-tw-queuebar { display: flex; align-items: center; justify-content: space-between; gap: 12px; background: #fdf8ec; border: 0.5px solid #e8d9a8; border-radius: 10px; padding: 9px 14px; margin-bottom: 12px; font-size: 13.5px; color: #6b5d2f; }
  .sb-tw-queuebar strong { color: #1e2d3d; }
  .sb-tw-queuebar .sb-tw-link { border-color: #c9b27a; color: #9A7209; }
  .sb-tw-row input[type=checkbox] { width: 15px; height: 15px; cursor: pointer; accent-color: #9A7209; }
  .sb-tw-row-sel { background: #fdf8ec !important; }
  .sb-tw-cust { text-align: left; background: none; border: none; font: inherit; cursor: pointer; padding: 0; min-width: 0; }
  .sb-tw-cust:hover .sb-crm-primary { color: #9A7209; }
  .sb-tw-badge { margin-left: 8px; font-size: 10px; font-weight: 600; color: #B8842A; background: #fbf1da; border-radius: 4px; padding: 1px 6px; vertical-align: middle; }
  .sb-tw-inline { font: inherit; font-size: 12.5px; padding: 4px 6px; border: 0.5px solid #d8d6d1; border-radius: 6px; background: #fff; color: #222; max-width: 100%; cursor: pointer; }
  .sb-tw-inline:hover { border-color: #9A7209; }
  .sb-tw-inline:disabled { opacity: 0.5; }

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
