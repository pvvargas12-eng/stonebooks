// =============================================================================
// Stonebooks — Permit Hub (launch-critical permit command center)
// =============================================================================
// One surface answers "what permits do I need to file today?" + "what's blocking
// an install?". Dashboard cards (Required / Submitted / Approved / Missing /
// Blocking-install — Blocking is prominent) over ACTIVE orders, a permit-focused
// worklist table (permit columns, not a generic order clone), and a Cemetery-
// requirements editor. Cards → OrdersTab pre-filtered (bulk tools); table rows →
// OrderDetail's permit section. Buckets come from the shared permitBuckets
// classifier, so the hub and the list can't disagree. Read-only except the
// cemetery editor.
// =============================================================================

import { useState, useEffect, useMemo, useRef } from 'react'
import {
  listAllOrders, getJobs, fmtUSD, customerName,
  permitBuckets, PERMIT_QUEUES, PERMIT_STATUSES,
  listCemeteriesWithPermit, updateCemeteryPermit,
  bulkUpdateOrders,
} from './lib/stonebooksData'
import OrderDetail from './OrderDetail.jsx'
// Reused from the Orders Triage Workbench — same undo toast, same 8s window.
import UndoToast from './components/calendar/UndoToast.jsx'

// feeRange — cemetery-driven estimate. Used ONLY by the Cemetery requirements
// editor (the config surface that feeds order-build). It is intentionally NOT
// shown per-order in the worklist: the hub shows EXACT filed amounts from
// orders.permit, not estimate ranges.
const feeRange = (lo, hi) => {
  if (lo == null && hi == null) return null
  if (lo != null && hi != null) return `${fmtUSD(lo)}–${fmtUSD(hi)}`
  return fmtUSD(lo != null ? lo : hi)
}
const permitStatusLabel = (s) => PERMIT_STATUSES.find(x => x.code === (s || 'unknown'))?.label || s

// orders.permit holds an array of filed-permit records:
//   [{ type, amount, method, ck, date_filed, name }, …]
// (Legacy rows may carry a bare object; only the array shape carries filings.)
function permitRecords(order) {
  return Array.isArray(order?.permit) ? order.permit : []
}
// Purity-safe absolute date (no new Date() in render): "Jun 1, 2026".
const MONTHS_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
function fmtFiledDate(iso) {
  if (!iso) return null
  const s = String(iso).slice(0, 10)
  const [y, m, d] = s.split('-')
  const mi = parseInt(m, 10) - 1
  if (!y || isNaN(mi) || mi < 0 || mi > 11) return s
  return `${MONTHS_ABBR[mi]} ${parseInt(d, 10)}, ${y}`
}
// Method + check number — "Check · ck# 2334" / "ck# 2334" / "Cash".
function methodCk(pm) {
  const method = pm.method ? String(pm.method).trim() : null
  const ck = pm.ck != null && String(pm.ck).trim() !== '' ? String(pm.ck).trim() : null
  if (method && ck) return `${method} · ck# ${ck}`
  if (ck) return `ck# ${ck}`
  return method
}

// Flatten the worklist into permit-log rows — ONE ROW PER PERMIT, grouped
// under its order. An order with no filed permits still gets a single row
// (blank permit fields) so it stays selectable for a bulk status-set. The
// checkbox / order identity / status pill render only on the first row of
// each order group (isFirstOfOrder); continuation rows leave them blank.
// orderIndex is the order's position in the worklist — the unit shift-range
// select operates on (selection is per-order, not per-permit).
function buildPermitLogRows(worklist) {
  const rows = []
  worklist.forEach((order, orderIndex) => {
    const recs = permitRecords(order)
    if (recs.length === 0) {
      rows.push({ order, orderIndex, permit: null, isFirstOfOrder: true })
    } else {
      recs.forEach((pm, i) => {
        rows.push({ order, orderIndex, permit: pm, isFirstOfOrder: i === 0 })
      })
    }
  })
  return rows
}
function deceasedLabel(order) {
  const d = Array.isArray(order.deceased) ? order.deceased : []
  if (!d.length) return null
  if (d.length > 1) return 'Companion'
  const p = d[0]
  return [p.firstName || p.first_name, p.lastName || p.last_name].filter(Boolean).join(' ').trim() || null
}
function jobStageLabels(job) {
  const ms = job?.milestones || []
  const done = k => ms.some(m => m.milestone_key === k && m.status === 'done')
  const foundation = done('foundation_poured') ? 'Poured' : done('foundation_scheduled') ? 'Scheduled' : '—'
  const install = done('installed') ? 'Installed' : done('ready_to_install') ? 'Ready' : '—'
  return { foundation, install }
}
// Worklist sort priority — most urgent first.
const BUCKET_PRIORITY = { permit_blocking: 0, permit_required: 1, permit_missing: 2, permit_submitted: 3, permit_approved: 4 }

export default function PermitHub({ onOpenQueue, onEditOrder, onOpenJob, onOpenCustomer }) {
  const [orders, setOrders] = useState([])
  const [jobs, setJobs] = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState(null)
  const [view, setView] = useState('worklist')      // 'worklist' | 'cemeteries'
  const [tableFilter, setTableFilter] = useState(null)
  const [paidOnly, setPaidOnly] = useState(false)        // show only orders with a paid (amount>0) filing
  const [groupByCemetery, setGroupByCemetery] = useState(false)
  const [selectedOrderId, setSelectedOrderId] = useState(null)
  const [reloadNonce, setReloadNonce] = useState(0)

  useEffect(() => {
    let cancelled = false
    setLoading(true); setErr(null)
    Promise.all([
      listAllOrders({ archived: false, limit: 2000 }),
      getJobs({ includeClosed: true, limit: 2000 }),
    ])
      .then(([os, js]) => { if (!cancelled) { setOrders(os || []); setJobs(js || []); setLoading(false) } })
      .catch(e => { if (!cancelled) { setErr(e?.message || 'Failed to load permits'); setLoading(false) } })
    return () => { cancelled = true }
  }, [reloadNonce])

  const enriched = useMemo(() => {
    const jobByOrderId = new Map()
    for (const j of jobs) if (j.order_id && !jobByOrderId.has(j.order_id)) jobByOrderId.set(j.order_id, j)
    return orders.map(o => {
      const job = jobByOrderId.get(o.id) || null
      const buckets = permitBuckets(o, job)
      const { foundation, install } = jobStageLabels(job)
      const recs = permitRecords(o)
      const terminal = o.status === 'closed' || o.status === 'cancelled' || o.archived === true
      // MISSING fix — permitBuckets only flags permit_missing when status is
      // 'unknown', so a determined-'required' order with no filed permit (the
      // "No permits filed" rows) never counted and the card read 0. Augment
      // locally: a permit is needed (cemetery requires it OR status='required')
      // and nothing has actually been filed yet. Not for submitted/approved/
      // not_required (those aren't "missing"), not for terminal orders.
      const st = o.permit_status || 'unknown'
      const needsPermit = (o.permit_required === true || st === 'required') &&
        st !== 'submitted' && st !== 'approved' && st !== 'not_required'
      if (!terminal && needsPermit && recs.length === 0 && !buckets.includes('permit_missing')) {
        buckets.push('permit_missing')
      }
      const paid = recs.some(pm => Number(pm.amount) > 0)
      return {
        ...o, _job: job, _buckets: buckets, _paid: paid,
        _familyName: (o.primary_lastname && String(o.primary_lastname).trim()) ||
          (o.customer?.last_name && String(o.customer.last_name).trim().toUpperCase()) || customerName(o.customer) || '—',
        _deceased: deceasedLabel(o), _foundation: foundation, _install: install,
        _priority: Math.min(...(buckets.length ? buckets.map(b => BUCKET_PRIORITY[b] ?? 9) : [9])),
      }
    })
  }, [orders, jobs])

  const counts = useMemo(() => {
    const c = Object.fromEntries(PERMIT_QUEUES.map(q => [q.code, 0]))
    let undetermined = 0
    for (const o of enriched) {
      for (const b of o._buckets) c[b] += 1
      if ((o.permit_status || 'unknown') === 'unknown' && o.permit_required == null && o.status !== 'closed' && o.status !== 'cancelled') undetermined += 1
    }
    return { ...c, undetermined }
  }, [enriched])

  const worklist = useMemo(() => {
    let list = enriched.filter(o => o._buckets.length > 0)
    if (tableFilter) list = list.filter(o => o._buckets.includes(tableFilter))
    if (paidOnly) list = list.filter(o => o._paid)
    return [...list].sort((a, b) => a._priority - b._priority || (a._familyName || '').localeCompare(b._familyName || ''))
  }, [enriched, tableFilter, paidOnly])

  const logRows = useMemo(() => buildPermitLogRows(worklist), [worklist])

  // Group-by-cemetery — cluster the worklist by cemetery, preserving the
  // worklist sort within each group. Each group carries its order ids (the
  // selectable unit) + a filed-permit count. null when the toggle is off.
  const cemeteryGroups = useMemo(() => {
    if (!groupByCemetery) return null
    const map = new Map()
    for (const o of worklist) {
      const key = o.cemetery?.id || '__none__'
      if (!map.has(key)) map.set(key, { key, name: o.cemetery?.name || 'No cemetery linked', orders: [] })
      map.get(key).orders.push(o)
    }
    return [...map.values()].map(g => ({
      ...g,
      rows: buildPermitLogRows(g.orders),
      orderIds: g.orders.map(o => o.id),
      filedCount: g.orders.reduce((n, o) => n + permitRecords(o).length, 0),
    }))
  }, [groupByCemetery, worklist])

  // ── Bulk select (mirrors OrdersTab) — selection is per-ORDER ──────────────
  const [selectedIds, setSelectedIds] = useState(() => new Set())
  const [confirm, setConfirm] = useState(null)   // { title, body, run }
  const [toast, setToast] = useState(null)        // { id, text, error, canUndo, onUndo }
  const [busy, setBusy] = useState(false)
  const lastIndexRef = useRef(null)
  const toastSeqRef = useRef(0)

  const filteredOrderIds = useMemo(() => worklist.map(o => o.id), [worklist])
  const allMatchingSelected = worklist.length > 0 && worklist.every(o => selectedIds.has(o.id))
  const selectedOrders = useMemo(() => worklist.filter(o => selectedIds.has(o.id)), [worklist, selectedIds])

  // Shift-range over the per-order index (filteredOrderIds), exactly as the
  // Orders workbench does — clicking with shift fills the range to the anchor.
  const toggleOne = (id, orderIndex, shiftKey) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (shiftKey && lastIndexRef.current != null) {
        const [lo, hi] = [lastIndexRef.current, orderIndex].sort((a, b) => a - b)
        const shouldSelect = !next.has(id)
        for (let i = lo; i <= hi; i++) { const oid = filteredOrderIds[i]; if (oid) (shouldSelect ? next.add(oid) : next.delete(oid)) }
      } else {
        next.has(id) ? next.delete(id) : next.add(id)
      }
      return next
    })
    lastIndexRef.current = orderIndex
  }
  const toggleAll = () => setSelectedIds(allMatchingSelected ? new Set() : new Set(filteredOrderIds))
  const selectAllMatching = () => setSelectedIds(new Set(filteredOrderIds))
  const clearSelection = () => { setSelectedIds(new Set()); lastIndexRef.current = null }
  const reload = () => setReloadNonce(n => n + 1)

  // Select-all-in-this-cemetery — grab a whole cemetery's orders in one click
  // (so a cemetery's permits can be bulk-filed together). Toggles off if the
  // whole group is already selected.
  const cemAllSelected = (orderIds) => orderIds.length > 0 && orderIds.every(id => selectedIds.has(id))
  const toggleCemetery = (orderIds) => setSelectedIds(prev => {
    const next = new Set(prev)
    const all = orderIds.every(id => next.has(id))
    orderIds.forEach(id => all ? next.delete(id) : next.add(id))
    return next
  })

  const showToast = (text, { error = false, onUndo = null } = {}) =>
    setToast({ id: String(toastSeqRef.current++), text, error, canUndo: !!onUndo, onUndo })
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 8000)
    return () => clearTimeout(t)
  }, [toast])

  // Confirm → batched write (bulkUpdateOrders) → toast(+undo) → reload.
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
  // Undo a uniform set: group selected orders by their prior permit_status and
  // issue one batched restore per distinct prior value (no per-row loop).
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
  const ids = () => [...selectedIds]
  const askSetPermitStatus = (status) => {
    const label = permitStatusLabel(status)
    const n = selectedIds.size
    const snapshot = new Map(selectedOrders.map(o => [o.id, o.permit_status || 'unknown']))
    setConfirm({
      title: `Set permit status to "${label}" on ${n} order${n === 1 ? '' : 's'}?`,
      body: 'Updates orders.permit_status only — does not touch filed permit records, payments, or milestones.',
      run: () => runBulk(() => bulkUpdateOrders(ids(), { permit_status: status }), {
        successText: r => `Set permit status on ${r.count} order${r.count === 1 ? '' : 's'} to ${label}.`,
        undoFn: () => undoByPriorValue(snapshot, (gids, v) => bulkUpdateOrders(gids, { permit_status: v })),
      }),
    })
  }

  // One permit-log row. Column order: ☐ · Order · Name · Job Type · Amount ·
  // Method/CK# · Date Filed · Permit status. Checkbox / Order / status pill
  // render on the order's first row only; continuation rows show just the
  // permit fields. Cemetery shows under the order so it's visible either way.
  const renderLogRow = (row, i) => {
    const o = row.order
    const pm = row.permit
    const selected = selectedIds.has(o.id)
    const blocking = o._buckets.includes('permit_blocking')
    return (
      <div
        key={pm?.id ? `${o.id}:${pm.id}` : `${o.id}:${i}`}
        className={`sb-crm-row sb-ph-logrow${selected ? ' sb-ph-rowsel' : ''}${row.isFirstOfOrder ? '' : ' sb-ph-logrow-cont'}`}
      >
        <div onClick={e => e.stopPropagation()}>
          {row.isFirstOfOrder && (
            <input type="checkbox" checked={selected}
              onClick={e => { e.stopPropagation(); toggleOne(o.id, row.orderIndex, e.shiftKey) }}
              onChange={() => {}} aria-label={`Select ${o._familyName}`} />
          )}
        </div>
        <div>
          {row.isFirstOfOrder && (
            <button type="button" className="sb-ph-log-order" onClick={() => setSelectedOrderId(o.id)}>
              <span className="sb-crm-primary">{o._familyName}</span>
              <span className="sb-crm-secondary sb-crm-mono">{o.order_number || 'DRAFT'}</span>
              <span className="sb-ph-log-cem">{o.cemetery?.name || 'No cemetery linked'}</span>
            </button>
          )}
        </div>
        <div className="sb-crm-primary">{pm?.name || (pm ? <span className="sb-crm-muted">—</span> : (row.isFirstOfOrder ? <span className="sb-crm-muted">No permits filed</span> : null))}</div>
        <div className="sb-crm-secondary">{pm?.type || <span className="sb-crm-muted">—</span>}</div>
        <div className="num">{pm && pm.amount != null ? <span className="sb-ph-log-amt">{fmtUSD(pm.amount)}</span> : <span className="sb-crm-muted">—</span>}</div>
        <div className="sb-crm-secondary">{(pm && methodCk(pm)) || <span className="sb-crm-muted">—</span>}</div>
        <div className="sb-crm-secondary sb-crm-tabular">{(pm && fmtFiledDate(pm.date_filed)) || <span className="sb-crm-muted">—</span>}</div>
        <div>
          {row.isFirstOfOrder && (
            <span className={`sb-ph-pill sb-ph-${o.permit_status || 'unknown'}${blocking ? ' sb-ph-blockmark' : ''}`}>
              {permitStatusLabel(o.permit_status)}{blocking ? ' · BLOCKING' : ''}
            </span>
          )}
        </div>
      </div>
    )
  }

  // Row drill-in → OrderDetail (with the permit section).
  if (selectedOrderId) {
    return (
      <OrderDetail orderId={selectedOrderId} onBack={() => { setSelectedOrderId(null); setReloadNonce(n => n + 1) }}
        onEditInSales={(id) => onEditOrder?.(id)} onOpenJob={onOpenJob} onOpenCustomer={onOpenCustomer} />
    )
  }

  return (
    <div className="sb-crm-page">
      <style>{PH_CSS}</style>
      <div className="sb-crm-container">
        <header className="sb-crm-head">
          <div>
            <h1 className="sb-crm-head-title">Permit Hub</h1>
            <div className="sb-crm-head-count">
              {loading ? '—' : <>What needs filing today · <strong>{counts.undetermined}</strong> orders undetermined (no cemetery linked yet)</>}
            </div>
          </div>
          <div className="sb-crm-head-actions">
            <button type="button" className={`sb-crm-btn-secondary${view === 'worklist' ? ' sb-ph-on' : ''}`} onClick={() => setView('worklist')}>Worklist</button>
            <button type="button" className={`sb-crm-btn-secondary${view === 'cemeteries' ? ' sb-ph-on' : ''}`} onClick={() => setView('cemeteries')}>Cemetery requirements</button>
          </div>
        </header>

        {err && <div className="sb-crm-error">{err}</div>}

        {view === 'cemeteries' ? (
          <CemeteryRequirements onChanged={() => setReloadNonce(n => n + 1)} />
        ) : (
          <>
            {/* Cards — Blocking is prominent */}
            <div className="sb-ph-blocking-row">
              <button type="button" className="sb-ph-card sb-ph-card-blocking" onClick={() => onOpenQueue?.('permit_blocking')}>
                <span className="sb-ph-card-label">⚠ Permits blocking install</span>
                <span className="sb-ph-card-count">{loading ? '—' : counts.permit_blocking}</span>
                <span className="sb-ph-card-sub">ready to set, permit not approved</span>
              </button>
            </div>
            <div className="sb-ph-board">
              <PermitCard label="Permits required"  count={counts.permit_required}  loading={loading} onClick={() => onOpenQueue?.('permit_required')} />
              <PermitCard label="Permits submitted" count={counts.permit_submitted} loading={loading} onClick={() => onOpenQueue?.('permit_submitted')} />
              <PermitCard label="Permits approved"  count={counts.permit_approved}  loading={loading} onClick={() => onOpenQueue?.('permit_approved')} />
              <PermitCard label="Permits missing"   count={counts.permit_missing}   loading={loading} onClick={() => onOpenQueue?.('permit_missing')} />
            </div>

            {/* In-hub bucket filter for the worklist table */}
            <div className="sb-crm-chip-row" style={{ marginTop: 18 }}>
              <div className="sb-crm-chip-group">
                <span className="sb-crm-chip-group-label">Show</span>
                <button type="button" className={`sb-crm-chip${!tableFilter ? ' sb-crm-chip-active' : ''}`} onClick={() => setTableFilter(null)}><span>All permit work</span></button>
                {PERMIT_QUEUES.map(q => (
                  <button key={q.code} type="button" className={`sb-crm-chip${tableFilter === q.code ? ' sb-crm-chip-active' : ''}`} onClick={() => setTableFilter(q.code)}><span>{q.label}</span></button>
                ))}
                {/* Paid — independent overlay toggle: only orders with a filed permit amount > 0 */}
                <button type="button" className={`sb-crm-chip${paidOnly ? ' sb-crm-chip-active' : ''}`} onClick={() => setPaidOnly(v => !v)}><span>Paid</span></button>
              </div>
              <div className="sb-crm-chip-group">
                <span className="sb-crm-chip-group-label">View</span>
                <button type="button" className={`sb-crm-chip${groupByCemetery ? ' sb-crm-chip-active' : ''}`} onClick={() => setGroupByCemetery(v => !v)}><span>Group by cemetery</span></button>
              </div>
            </div>

            {/* Bulk action bar — sticky, shown when ≥1 order selected. Same
                handlers + bulkUpdateOrders as the Orders Triage Workbench;
                CRM-clean styling (bronze-accented white bar). */}
            {selectedIds.size > 0 && (
              <div className="sb-ph-bulkbar">
                <div className="sb-ph-bulk-count">
                  <strong>{selectedIds.size}</strong> selected
                  {' · '}
                  {allMatchingSelected
                    ? <span className="sb-ph-bulk-note">all matching</span>
                    : <button type="button" className="sb-ph-bulk-link" onClick={selectAllMatching}>Select all {worklist.length} matching</button>}
                </div>
                <div className="sb-ph-bulk-actions">
                  <BulkSelect label="Set permit status" disabled={busy}
                    options={PERMIT_STATUSES.map(s => ({ value: s.code, label: s.label }))}
                    onPick={askSetPermitStatus} />
                  <button type="button" className="sb-ph-bulk-clear" onClick={clearSelection}>Clear</button>
                </div>
              </div>
            )}

            {/* Permit-log table — ONE ROW PER PERMIT, grouped under its order.
                Columns: ☐ · Order · Name · Job Type · Amount · Method/CK# ·
                Date Filed · Permit status. */}
            <div className="sb-crm-card sb-crm-table">
              <div className="sb-crm-row sb-crm-row-head sb-ph-logrow">
                <div><input type="checkbox" checked={allMatchingSelected} onChange={toggleAll} aria-label="Select all matching" /></div>
                <div>Order</div>
                <div>Name</div>
                <div>Job Type</div>
                <div className="num">Amount</div>
                <div>Method / CK#</div>
                <div>Date Filed</div>
                <div>Permit status</div>
              </div>
              {loading ? (
                <div className="sb-crm-empty">Loading permits…</div>
              ) : worklist.length === 0 ? (
                <div className="sb-crm-empty">Nothing here.</div>
              ) : cemeteryGroups ? (
                cemeteryGroups.map(g => {
                  const allSel = cemAllSelected(g.orderIds)
                  return (
                    <div key={g.key}>
                      <div className="sb-ph-cemhdr">
                        <input type="checkbox" checked={allSel}
                          onChange={() => toggleCemetery(g.orderIds)}
                          aria-label={`Select all permits in ${g.name}`} />
                        <span className="sb-ph-cemhdr-name">{g.name}</span>
                        <span className="sb-ph-cemhdr-count">{g.orders.length} order{g.orders.length === 1 ? '' : 's'} · {g.filedCount} permit{g.filedCount === 1 ? '' : 's'} filed</span>
                      </div>
                      {g.rows.map((row, i) => renderLogRow(row, i))}
                    </div>
                  )
                })
              ) : (
                logRows.map((row, i) => renderLogRow(row, i))
              )}
            </div>
            <p className="sb-ph-note">
              One row per filed permit, grouped by order. Tick orders to bulk-set permit status (one batched update, with undo).
              Click a family name to open the order's permit detail. Group by cemetery to grab a whole cemetery's permits in one click.
              Active orders only. “Blocking install” = ready-to-set stone whose permit isn’t approved — fix before scheduling a crew.
            </p>

            {/* Confirm modal — same shell as Orders */}
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
          </>
        )}
      </div>
    </div>
  )
}

// ── BulkSelect — a "label" select that fires onPick(value) and resets ─────────
// Mirrors the Orders Triage Workbench control.
function BulkSelect({ label, options, onPick, disabled }) {
  return (
    <select className="sb-ph-bulk-select" disabled={disabled} value=""
      onChange={e => { const v = e.target.value; e.target.value = ''; if (v) onPick(v) }}>
      <option value="">{label}…</option>
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  )
}

function PermitCard({ label, count, loading, onClick }) {
  const zero = !loading && count === 0
  return (
    <button type="button" className={`sb-ph-card${zero ? ' sb-ph-card-zero' : ''}`} onClick={onClick}>
      <span className="sb-ph-card-label">{label}</span>
      <span className="sb-ph-card-count">{loading ? '—' : count}</span>
      {zero && <span className="sb-ph-card-empty">nothing here</span>}
    </button>
  )
}

// ── Cemetery requirements editor ──────────────────────────────────────────────
function CemeteryRequirements({ onChanged }) {
  const [cems, setCems] = useState([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(null)   // cemetery id
  const [draft, setDraft] = useState({})
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)

  const load = () => { setLoading(true); listCemeteriesWithPermit().then(c => { setCems(c); setLoading(false) }) }
  useEffect(() => { load() }, [])

  const startEdit = (c) => {
    setEditing(c.id); setMsg(null)
    setDraft({
      permit_required: c.permit_required ?? null, permit_fee_required: c.permit_fee_required ?? null,
      permit_fee_low: c.permit_fee_low ?? '', permit_fee_high: c.permit_fee_high ?? '',
      permit_notes: c.permit_notes ?? '', permit_document_requirements: c.permit_document_requirements ?? '',
      permit_instructions: c.permit_instructions ?? '',
      permit_contact_name: c.permit_contact_name ?? '', permit_contact_phone: c.permit_contact_phone ?? '', permit_contact_email: c.permit_contact_email ?? '',
    })
  }
  const save = async () => {
    setBusy(true); setMsg(null)
    const patch = {
      ...draft,
      permit_fee_low: draft.permit_fee_low === '' ? null : Number(draft.permit_fee_low),
      permit_fee_high: draft.permit_fee_high === '' ? null : Number(draft.permit_fee_high),
    }
    const r = await updateCemeteryPermit(editing, patch)
    setBusy(false)
    if (!r.ok) { setMsg({ type: 'err', text: r.error }); return }
    setEditing(null); load(); onChanged?.()
  }

  if (loading) return <div className="sb-crm-empty">Loading cemeteries…</div>
  return (
    <div className="sb-crm-card" style={{ padding: 0 }}>
      <div className="sb-crm-row sb-crm-row-head sb-ph-cemrow">
        <div>Cemetery</div><div>Permit required</div><div>Fee</div><div className="num">Fee range</div><div>Notes</div><div></div>
      </div>
      {cems.length === 0 && <div className="sb-crm-empty">No cemeteries.</div>}
      {cems.map(c => editing === c.id ? (
        <div key={c.id} className="sb-ph-editrow">
          <div className="sb-ph-edit-title">{c.name}</div>
          <div className="sb-ph-edit-grid">
            <label className="sb-ph-field"><span>Permit required</span>
              <select value={draft.permit_required == null ? '' : String(draft.permit_required)} onChange={e => setDraft(d => ({ ...d, permit_required: e.target.value === '' ? null : e.target.value === 'true' }))}>
                <option value="">Unknown</option><option value="true">Yes</option><option value="false">No</option>
              </select>
            </label>
            <label className="sb-ph-field"><span>Fee required</span>
              <select value={draft.permit_fee_required == null ? '' : String(draft.permit_fee_required)} onChange={e => setDraft(d => ({ ...d, permit_fee_required: e.target.value === '' ? null : e.target.value === 'true' }))}>
                <option value="">Unknown</option><option value="true">Yes</option><option value="false">No</option>
              </select>
            </label>
            <label className="sb-ph-field"><span>Fee low</span><input type="number" value={draft.permit_fee_low} onChange={e => setDraft(d => ({ ...d, permit_fee_low: e.target.value }))} /></label>
            <label className="sb-ph-field"><span>Fee high</span><input type="number" value={draft.permit_fee_high} onChange={e => setDraft(d => ({ ...d, permit_fee_high: e.target.value }))} /></label>
            <label className="sb-ph-field sb-ph-field-wide"><span>Permit notes</span><input type="text" value={draft.permit_notes} onChange={e => setDraft(d => ({ ...d, permit_notes: e.target.value }))} /></label>
            <label className="sb-ph-field sb-ph-field-wide"><span>Document requirements</span><input type="text" value={draft.permit_document_requirements} onChange={e => setDraft(d => ({ ...d, permit_document_requirements: e.target.value }))} /></label>
            <label className="sb-ph-field sb-ph-field-wide"><span>Cemetery instructions</span><input type="text" value={draft.permit_instructions} onChange={e => setDraft(d => ({ ...d, permit_instructions: e.target.value }))} /></label>
            <label className="sb-ph-field"><span>Contact name</span><input type="text" value={draft.permit_contact_name} onChange={e => setDraft(d => ({ ...d, permit_contact_name: e.target.value }))} /></label>
            <label className="sb-ph-field"><span>Contact phone</span><input type="text" value={draft.permit_contact_phone} onChange={e => setDraft(d => ({ ...d, permit_contact_phone: e.target.value }))} /></label>
            <label className="sb-ph-field"><span>Contact email</span><input type="text" value={draft.permit_contact_email} onChange={e => setDraft(d => ({ ...d, permit_contact_email: e.target.value }))} /></label>
          </div>
          {msg && <div className={`sb-msg sb-msg-${msg.type}`}>{msg.text}</div>}
          <div className="sb-ph-edit-actions">
            <button type="button" className="sb-crm-btn-secondary" onClick={() => setEditing(null)} disabled={busy}>Cancel</button>
            <button type="button" className="sb-crm-btn-primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
          </div>
        </div>
      ) : (
        <div key={c.id} className="sb-crm-row sb-ph-cemrow">
          <div className="sb-crm-primary">{c.name}</div>
          <div>{c.permit_required == null ? <span className="sb-crm-muted">Unknown</span> : c.permit_required ? 'Yes' : 'No'}</div>
          <div>{c.permit_fee_required == null ? <span className="sb-crm-muted">—</span> : c.permit_fee_required ? 'Yes' : 'No'}</div>
          <div className="num">{feeRange(c.permit_fee_low, c.permit_fee_high) || <span className="sb-crm-muted">—</span>}</div>
          <div className="sb-crm-secondary sb-ph-notes">{c.permit_notes || '—'}</div>
          <div><button type="button" className="sb-crm-chip" onClick={() => startEdit(c)}><span>Edit</span></button></div>
        </div>
      ))}
    </div>
  )
}

const PH_CSS = `
  .sb-ph-on { border-color: #9A7209 !important; color: #9A7209 !important; }
  .sb-ph-blocking-row { margin-bottom: 12px; }
  .sb-ph-board { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 12px; }
  .sb-ph-card { display: flex; flex-direction: column; gap: 4px; align-items: flex-start; text-align: left; background: #fff; border: 0.5px solid #e4e2dd; border-radius: 12px; padding: 16px 18px; cursor: pointer; min-height: 92px; transition: border-color 0.12s, box-shadow 0.12s; }
  .sb-ph-card:hover { border-color: #9A7209; box-shadow: 0 2px 10px rgba(0,0,0,0.06); }
  .sb-ph-card-label { font-size: 13px; color: #555; font-weight: 600; }
  .sb-ph-card-count { font-size: 30px; font-weight: 700; color: #1e2d3d; line-height: 1.1; font-variant-numeric: tabular-nums; margin-top: auto; }
  .sb-ph-card-sub { font-size: 11.5px; color: #8a8a85; }
  .sb-ph-card-empty { font-size: 11px; color: #b0b0a8; }
  .sb-ph-card-zero { opacity: 0.55; } .sb-ph-card-zero:hover { opacity: 1; }
  .sb-ph-card-blocking { width: 100%; flex-direction: row; align-items: center; gap: 18px; min-height: 0; background: #fdecec; border: 1px solid #e6b3b3; }
  .sb-ph-card-blocking:hover { border-color: #B54040; box-shadow: 0 2px 12px rgba(181,64,64,0.18); }
  .sb-ph-card-blocking .sb-ph-card-label { font-size: 15px; color: #B54040; font-weight: 700; }
  .sb-ph-card-blocking .sb-ph-card-count { font-size: 34px; color: #B54040; margin: 0; }
  .sb-ph-card-blocking .sb-ph-card-sub { margin-left: auto; color: #8a5a5a; }

  /* Permit-log table — one row per permit, grouped by order. Order is the
     anchor (far left after the checkbox).
     ☐ · Order · Name · Job Type · Amount · Method/CK# · Date Filed · Status */
  .sb-ph-logrow { grid-template-columns: 0.4fr 1.7fr 1.2fr 1.0fr 0.8fr 1.2fr 1.0fr 1.0fr; align-items: center; }
  /* Bronze checkboxes — not the raw browser default. */
  .sb-ph-logrow input[type="checkbox"],
  .sb-ph-cemhdr input[type="checkbox"] { width: 15px; height: 15px; accent-color: #9A7209; cursor: pointer; margin: 0; }
  /* Selected order group — subtle bronze-tint wash (not a harsh block), with a
     thin bronze anchor rule on the order's first row. Whole group tints. */
  .sb-ph-rowsel { background: rgba(154, 114, 9, 0.06); }
  .sb-ph-rowsel:not(.sb-ph-logrow-cont) { box-shadow: inset 3px 0 0 0 #9A7209; }
  /* Continuation rows (same order, extra permits) — hairline-only top border +
     faint inset on the Name cell so the permits read as grouped under the order. */
  .sb-ph-logrow-cont { border-top-color: #f3f1ec; }
  .sb-ph-logrow-cont > div:nth-child(3) { padding-left: 12px; border-left: 2px solid #efe7d4; }
  .sb-ph-log-amt { font-weight: 600; color: #1D9E75; font-variant-numeric: tabular-nums; }
  .sb-ph-log-order { display: flex; flex-direction: column; gap: 1px; align-items: flex-start; text-align: left; background: none; border: none; font: inherit; padding: 0; cursor: pointer; }
  .sb-ph-log-order:hover .sb-crm-primary { color: #9A7209; text-decoration: underline; }
  .sb-ph-log-cem { font-size: 11px; color: #8a8a85; }
  .sb-ph-pill { font-size: 11px; font-weight: 600; border-radius: 4px; padding: 2px 8px; background: #eee; color: #555; }

  /* Cemetery group header (Group-by-cemetery on). */
  .sb-ph-cemhdr { display: flex; align-items: center; gap: 12px; padding: 10px 16px; background: #faf7f0; border-top: 0.5px solid #e4e2dd; border-bottom: 0.5px solid #e4e2dd; }
  .sb-ph-cemhdr-name { font-family: var(--font-d, 'Playfair Display'), Georgia, serif; font-size: 14px; font-weight: 600; color: #1e2d3d; }
  .sb-ph-cemhdr-count { font-size: 12px; color: #8a8a85; font-variant-numeric: tabular-nums; }

  /* Bulk action bar — sticky, CRM-clean (white card + bronze left accent). */
  .sb-ph-bulkbar { position: sticky; top: 8px; z-index: 5; display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap; margin: 14px 0 8px; padding: 10px 16px; background: #fff; border: 0.5px solid #e4e2dd; border-left: 3px solid #9A7209; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.06); }
  .sb-ph-bulk-count { font-size: 13px; color: #1e2d3d; }
  .sb-ph-bulk-count strong { font-variant-numeric: tabular-nums; }
  .sb-ph-bulk-note { color: #8a8a85; }
  .sb-ph-bulk-link { background: none; border: none; padding: 0; font: inherit; color: #9A7209; cursor: pointer; text-decoration: underline; }
  .sb-ph-bulk-actions { display: flex; align-items: center; gap: 8px; }
  .sb-ph-bulk-select { font: inherit; font-size: 13px; padding: 7px 12px; border-radius: 8px; border: 0.5px solid #d8d6d1; background: #fff; color: #1e2d3d; cursor: pointer; }
  .sb-ph-bulk-select:hover:not(:disabled) { border-color: #9A7209; }
  .sb-ph-bulk-clear { font: inherit; font-size: 13px; padding: 7px 12px; border-radius: 8px; border: 0.5px solid #e4e2dd; background: transparent; color: #8a8a85; cursor: pointer; }
  .sb-ph-bulk-clear:hover { color: #1e2d3d; border-color: #d8d6d1; }
  .sb-ph-required  { background: #fbf1da; color: #9A7209; }
  .sb-ph-submitted { background: #e7eefb; color: #1d4ed8; }
  .sb-ph-approved  { background: #e3f4ec; color: #1D9E75; }
  .sb-ph-unknown   { background: #f0eee9; color: #8a8a85; }
  .sb-ph-not_required { background: #f0eee9; color: #8a8a85; }
  .sb-ph-blockmark { background: #fdecec; color: #B54040; }

  .sb-ph-cemrow { grid-template-columns: 1.4fr 0.9fr 0.6fr 0.9fr 2fr 0.6fr; }
  .sb-ph-editrow { padding: 16px 20px; border-bottom: 0.5px solid #e4e2dd; background: #fbfaf8; }
  .sb-ph-edit-title { font-weight: 700; color: #111; margin-bottom: 12px; }
  .sb-ph-edit-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px 14px; }
  .sb-ph-field { display: flex; flex-direction: column; gap: 4px; }
  .sb-ph-field-wide { grid-column: 1 / -1; }
  .sb-ph-field > span { font-size: 12px; color: #555; font-weight: 600; }
  .sb-ph-field input, .sb-ph-field select { font: inherit; font-size: 14px; padding: 8px 10px; border: 0.5px solid #d8d6d1; border-radius: 8px; background: #fff; }
  .sb-ph-edit-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 14px; }
  .sb-ph-note { font-size: 12.5px; color: #8a8a85; line-height: 1.5; max-width: 760px; margin-top: 18px; }
`
