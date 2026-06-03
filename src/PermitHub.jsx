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

import { useState, useEffect, useMemo } from 'react'
import {
  listAllOrders, getJobs, fmtUSD, fmtRelative, customerName,
  permitBuckets, PERMIT_QUEUES, PERMIT_STATUSES,
  listCemeteriesWithPermit, updateCemeteryPermit,
} from './lib/stonebooksData'
import OrderDetail from './OrderDetail.jsx'

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

// One line per filed permit on an order: type · amount · method+ck# · date · name.
function PermitLines({ order }) {
  const recs = permitRecords(order)
  if (!recs.length) return <span className="sb-crm-muted">No permits filed</span>
  return (
    <div className="sb-ph-permits">
      {recs.map((pm, i) => {
        const meta = methodCk(pm)
        const date = fmtFiledDate(pm.date_filed)
        return (
          <div key={pm.id || i} className="sb-ph-permit-line">
            {pm.type && <span className="sb-ph-permit-type">{pm.type}</span>}
            {pm.amount != null && <span className="sb-ph-permit-amt">{fmtUSD(pm.amount)}</span>}
            {meta && <span className="sb-ph-permit-meta">{meta}</span>}
            {date && <span className="sb-ph-permit-meta">{date}</span>}
            {pm.name && <span className="sb-ph-permit-meta">{pm.name}</span>}
          </div>
        )
      })}
    </div>
  )
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
      return {
        ...o, _job: job, _buckets: buckets,
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
    return [...list].sort((a, b) => a._priority - b._priority || (a._familyName || '').localeCompare(b._familyName || ''))
  }, [enriched, tableFilter])

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
              </div>
            </div>

            {/* Worklist table */}
            <div className="sb-crm-card sb-crm-table">
              <div className="sb-crm-row sb-crm-row-head sb-ph-row">
                <div>Order</div><div>Customer</div><div>Deceased</div><div>Cemetery</div>
                <div>Permit</div><div>Filed permits</div><div>Notes</div>
                <div>Foundation</div><div>Install</div><div>Assigned</div><div className="num">Updated</div>
              </div>
              {loading ? (
                <div className="sb-crm-empty">Loading permits…</div>
              ) : worklist.length === 0 ? (
                <div className="sb-crm-empty">Nothing here.</div>
              ) : (
                worklist.map(o => (
                  <button key={o.id} type="button" className="sb-crm-row sb-ph-row sb-ph-rowbtn" onClick={() => setSelectedOrderId(o.id)}>
                    <div className="sb-crm-mono">{o.order_number || 'DRAFT'}</div>
                    <div className="sb-crm-primary">{o._familyName}</div>
                    <div className="sb-crm-secondary">{o._deceased || '—'}</div>
                    <div>{o.cemetery?.name || <span className="sb-crm-muted">— (unlinked)</span>}</div>
                    <div><span className={`sb-ph-pill sb-ph-${o.permit_status || 'unknown'}${o._buckets.includes('permit_blocking') ? ' sb-ph-blockmark' : ''}`}>{permitStatusLabel(o.permit_status)}{o._buckets.includes('permit_blocking') ? ' · BLOCKING' : ''}</span></div>
                    <div><PermitLines order={o} /></div>
                    <div className="sb-crm-secondary sb-ph-notes">{o.cemetery?.permit_notes || o.permit?.note || '—'}</div>
                    <div className="sb-crm-secondary">{o._foundation}</div>
                    <div className="sb-crm-secondary">{o._install}</div>
                    <div className="sb-crm-secondary">{o.sales_rep || '—'}</div>
                    <div className="num"><span className="sb-crm-muted sb-crm-tabular">{fmtRelative(o.updated_at)}</span></div>
                  </button>
                ))
              )}
            </div>
            <p className="sb-ph-note">
              Cards open the Orders list filtered to that permit set (with bulk tools). Rows open the order's permit detail.
              Active orders only. “Blocking install” = ready-to-set stone whose permit isn’t approved — fix before scheduling a crew.
            </p>
          </>
        )}
      </div>
    </div>
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

  .sb-ph-row { grid-template-columns: 0.7fr 1.0fr 0.9fr 1.0fr 1.1fr 2.4fr 1.0fr 0.7fr 0.7fr 0.7fr 0.6fr; }
  .sb-ph-rowbtn { text-align: left; background: none; border: none; font: inherit; width: 100%; cursor: pointer; }
  .sb-ph-rowbtn:hover { background: #faf9f7; }
  .sb-ph-notes { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  /* Filed-permit lines — one line per permit on an order. Fields are dot-
     separated; lines stack so multiple permits read as a short ledger. */
  .sb-ph-permits { display: flex; flex-direction: column; gap: 4px; }
  .sb-ph-permit-line { display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px; font-size: 12px; line-height: 1.3; }
  .sb-ph-permit-type { font-weight: 600; color: #1e2d3d; }
  .sb-ph-permit-amt { font-weight: 600; color: #1D9E75; font-variant-numeric: tabular-nums; }
  .sb-ph-permit-meta { color: #6b6b66; }
  .sb-ph-permit-line > span + span::before { content: '·'; margin-right: 6px; color: #c4c2bc; }
  .sb-ph-pill { font-size: 11px; font-weight: 600; border-radius: 4px; padding: 2px 8px; background: #eee; color: #555; }
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
