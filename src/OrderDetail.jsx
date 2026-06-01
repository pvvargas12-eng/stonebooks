// =============================================================================
// Stonebooks — Order Detail View (NEW screen, Commit 1: routing + read-only)
// =============================================================================
// Clicking an order in the Orders list opens THIS view — never the sales
// wizard. The wizard opens only from the explicit "Edit in Sales Portal"
// quick-action. This commit is the backbone: read-only data from existing
// records (orders + joined customer/cemetery + the related job/milestones).
// Fields not yet in the schema render "—" and are reported, not invented.
//
// Quick actions wired this commit: Edit in Sales Portal (wizard), Open contract
// (existing contract PDF), Open related job (Job view). Stubbed (later commits):
// Open approval packet, Add note, Upload attachment, Record payment.
// =============================================================================

import { useState, useEffect } from 'react'
import {
  getOrderById, getJobByOrderId,
  rowGrandTotal, rowTotalPaid, rowBalanceDue,
  fmtUSD, fmtDate, statusInfo, jobStatusInfo, customerName,
  computeOrderPressure, getNextRequiredAction,
} from './lib/stonebooksData'
import { paymentTone, paymentLabel } from './lib/crmTheme'
import { Pill } from './lib/crmComponents.jsx'
import { generateContractPDF, rowToOrder } from './SalesMode'

// ── Small helpers ────────────────────────────────────────────────────────────
const humanize = (s) =>
  s == null || s === '' ? null : String(s).replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase())

const stageTone = (status) => {
  switch (status) {
    case 'draft': case 'scoping': case 'contracted': case 'in_production': return 'bronze'
    case 'quoted': return 'amber'
    case 'installed': case 'paid_in_full': case 'closed': return 'green'
    case 'cancelled': case 'archived': return 'red'
    default: return 'bronze'
  }
}

const jobTypeLabel = (jobType, serviceTypes) => {
  if (jobType === 'new_stone') return 'New stone'
  if (jobType === 'mausoleum_door') return 'Crypt door'
  if (jobType === 'cleaning_repair') return 'Cleaning / repair'
  const st = (serviceTypes || []).map(s => String(s).toUpperCase())
  if (st.includes('INSCRIPTION') || st.includes('INSCRIPTIONS')) return 'Inscription'
  if (st.includes('ACID_WASH')) return 'Acid wash'
  return jobType ? humanize(jobType) : 'Order'
}

// Derive a status string from a job's milestones for a key set (read-only).
const milestoneStatus = (job, keys) => {
  if (!job || !Array.isArray(job.milestones)) return null
  const byKey = new Map(job.milestones.map(m => [m.milestone_key, m]))
  // Last (most-advanced) key in `keys` that's done wins.
  let label = null
  for (const k of keys) {
    const m = byKey.get(k)
    if (m && m.status === 'done') label = k
  }
  return label
}

const deceasedName = (d) => {
  if (!d) return null
  return [d.firstName || d.first_name, d.middleName || d.middle_name, d.lastName || d.last_name]
    .map(s => (s || '').trim()).filter(Boolean).join(' ') || (d.inscriptionName || null)
}

// ── Field + Section primitives ───────────────────────────────────────────────
function Field({ label, value, hint }) {
  const empty = value == null || value === '' || (Array.isArray(value) && value.length === 0)
  return (
    <div className="sb-od-field">
      <div className="sb-od-field-label">{label}</div>
      <div className={`sb-od-field-value${empty ? ' sb-od-missing' : ''}`}>
        {empty ? '—' : value}
        {hint && <span className="sb-od-hint"> · {hint}</span>}
      </div>
    </div>
  )
}

function Section({ title, span = 1, children }) {
  return (
    <section className={`sb-od-card sb-od-span-${span}`}>
      <div className="sb-od-card-eyebrow">{title}</div>
      <div className="sb-od-card-body">{children}</div>
    </section>
  )
}

// =============================================================================
// MAIN
// =============================================================================
export default function OrderDetail({ orderId, onBack, onEditInSales, onOpenJob, onOpenCustomer }) {
  const [order, setOrder] = useState(null)
  const [job, setJob] = useState(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState(null)
  const [actionNote, setActionNote] = useState(null)

  // loading inits true; OrderDetail mounts fresh per selected order (OrdersTab
  // conditionally renders it), so the effect fires once — no synchronous
  // setState in the body (avoids the React 19 set-state-in-effect lint).
  useEffect(() => {
    let cancelled = false
    getOrderById(orderId).then(async (o) => {
      if (cancelled) return
      if (!o) { setErr('Order not found.'); setLoading(false); return }
      const j = await getJobByOrderId(orderId)
      if (cancelled) return
      setOrder(o); setJob(j); setLoading(false)
    }).catch(e => { if (!cancelled) { setErr(e?.message || 'Failed to load order'); setLoading(false) } })
    return () => { cancelled = true }
  }, [orderId])

  if (loading) {
    return (
      <div className="sb-od-page"><style>{OD_CSS}</style>
        <div className="sb-od-container"><BackBar onBack={onBack} /><div className="sb-od-empty">Loading order…</div></div>
      </div>
    )
  }
  if (err || !order) {
    return (
      <div className="sb-od-page"><style>{OD_CSS}</style>
        <div className="sb-od-container"><BackBar onBack={onBack} /><div className="sb-od-empty">{err || 'Order not found.'}</div></div>
      </div>
    )
  }

  const cust = order.customer || {}
  const cem = order.cemetery || {}
  const deceased = Array.isArray(order.deceased) ? order.deceased : []
  const insc = order.inscription || {}
  const baseConfig = order.base_config || {}
  const addOns = Array.isArray(order.add_ons) ? order.add_ons.filter(a => a && (a.code || a.label)) : []

  const pressure = computeOrderPressure(order, job, job?.milestones)
  const total = rowGrandTotal(order)
  const paid = rowTotalPaid(order)
  const balance = rowBalanceDue(order)
  const stage = statusInfo(order.status)

  const familyName =
    (order.primary_lastname && String(order.primary_lastname).trim()) ||
    (cust.last_name && String(cust.last_name).trim().toUpperCase()) ||
    customerName(cust) || '—'
  const primaryDeceased = deceasedName(deceased[0])

  // Payments (read-only) — non-voided, sorted by createdAt; fall back to legacy
  // deposit/balance columns when the payments[] array is empty.
  const payments = (() => {
    const arr = Array.isArray(order.payments) ? order.payments.filter(p => p && !p.voided) : []
    if (arr.length) {
      return [...arr].sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0))
        .map(p => ({ amount: p.amount, method: p.method, at: p.receivedAt || p.createdAt, locked: p.locked ?? true }))
    }
    const out = []
    if (order.deposit_amount != null) out.push({ amount: order.deposit_amount, method: order.deposit_method, at: order.deposit_received_at, locked: true })
    if (order.balance_amount != null) out.push({ amount: order.balance_amount, method: order.balance_method, at: order.balance_received_at, locked: true })
    return out
  })()

  // Address blocks
  const custAddr = [cust.address_line1, cust.address_line2, [cust.city, cust.state, cust.zip].filter(Boolean).join(', ')].filter(Boolean)
  const cemAddr = [cem.address, [cem.city, cem.state, cem.zip].filter(Boolean).join(', ')].filter(Boolean)
  const referral = [humanize(cust.referral_source), cust.referral_source_detail].filter(Boolean).join(' — ')

  // Monument
  const dims = [order.width_inches, order.depth_inches, order.thickness_inches, order.height_inches]
    .filter(v => v != null && v !== '').map(v => `${v}"`).join(' × ')
  const baseSummary = !baseConfig.include ? 'Not included'
    : [humanize(baseConfig.sizeCode), baseConfig.heightCode ? `${baseConfig.heightCode}" tall` : null].filter(Boolean).join(' · ') || 'Included'
  const finish = [order.polish_level, humanize(order.sides)].filter(Boolean).join(' · ')

  // Derived statuses from the related job's milestones (read-only)
  const proofMs = milestoneStatus(job, ['proof_created', 'bronze_proof_created', 'proof_sent', 'bronze_proof_sent', 'proof_approved', 'bronze_proof_approved'])
  const proofLabel = proofMs ? humanize(proofMs.replace('bronze_', '')) : null
  const permitMs = milestoneStatus(job, ['permit_filed', 'permit_approved', 'cemetery_confirmed'])
  const foundationMs = milestoneStatus(job, ['foundation_poured', 'foundation_cured'])
  const nra = job ? getNextRequiredAction(job) : null
  const jobStage = job ? jobStatusInfo(job.overall_status) : null

  // ── Quick actions ──────────────────────────────────────────────────────────
  const handleOpenContract = async () => {
    setActionNote(null)
    try {
      const camel = rowToOrder(order, order.customer, order.cemetery)
      await generateContractPDF(camel)
    } catch (e) {
      setActionNote(`Could not open contract — ${e?.message || 'error'}.`)
    }
  }
  const stub = (what) => () => setActionNote(`${what} is wired in a later commit.`)

  return (
    <div className="sb-od-page">
      <style>{OD_CSS}</style>
      <div className="sb-od-container">
        <BackBar onBack={onBack} />

        {/* ── HEADER (always visible) ─────────────────────────────────────── */}
        <header className="sb-od-header">
          <div className="sb-od-header-main">
            <div className="sb-od-header-top">
              <span className="sb-od-ordernum sb-crm-mono">{order.order_number || 'DRAFT'}</span>
              <Pill severity={stageTone(order.status)}>{stage.label}</Pill>
              {paymentLabel(pressure.paymentState) && (
                <Pill severity={paymentTone(pressure.paymentState)}>{paymentLabel(pressure.paymentState)}</Pill>
              )}
            </div>
            <h1 className="sb-od-title">{familyName}</h1>
            <div className="sb-od-subtitle">
              {primaryDeceased ? <>In memory of {primaryDeceased}{deceased.length > 1 ? ` +${deceased.length - 1}` : ''}</> : <span className="sb-od-missing">No deceased recorded</span>}
            </div>
          </div>
          <div className="sb-od-header-balance">
            <div className="sb-od-balance-label">Balance due</div>
            <div className={`sb-od-balance-value${balance > 0 ? '' : ' sb-od-balance-clear'}`}>{fmtUSD(balance)}</div>
          </div>
        </header>

        {/* ── QUICK ACTIONS ───────────────────────────────────────────────── */}
        <div className="sb-od-actions">
          <button type="button" className="sb-od-btn sb-od-btn-primary" onClick={() => onEditInSales?.(order.id)}>
            Edit in Sales Portal
          </button>
          <button type="button" className="sb-od-btn" onClick={handleOpenContract}>Open contract</button>
          <button type="button" className="sb-od-btn" onClick={stub('Approval packet')}>Open approval packet</button>
          <button type="button" className="sb-od-btn" onClick={() => job ? onOpenJob?.(job.id) : null} disabled={!job}
            title={job ? '' : 'No production job yet'}>
            Open related job
          </button>
          <span className="sb-od-actions-spacer" />
          <button type="button" className="sb-od-btn sb-od-btn-stub" onClick={stub('Add note')}>Add note</button>
          <button type="button" className="sb-od-btn sb-od-btn-stub" onClick={stub('Upload attachment')}>Upload attachment</button>
          <button type="button" className="sb-od-btn sb-od-btn-stub" onClick={stub('Record payment')}>Record payment</button>
        </div>
        {actionNote && <div className="sb-od-actionnote">{actionNote}</div>}

        {/* ── SECTIONS ────────────────────────────────────────────────────── */}
        <div className="sb-od-grid">
          {/* 1 — Customer / contact */}
          <Section title="Customer & contact">
            <Field label="Name" value={
              customerName(cust) !== '—'
                ? <button type="button" className="sb-od-link" onClick={() => cust.id && onOpenCustomer?.(cust.id)}>{customerName(cust)}</button>
                : null
            } />
            <Field label="Phone" value={cust.phone_primary} />
            <Field label="Email" value={cust.email} />
            <Field label="Address" value={custAddr.length ? custAddr.map((l, i) => <div key={i}>{l}</div>) : null} />
            <Field label="Secondary contact" value={[cust.phone_alt, cust.email_alt].filter(Boolean).join(' · ')} />
            <Field label="Funeral home / referral" value={referral || null} />
          </Section>

          {/* 2 — Cemetery / grave */}
          <Section title="Cemetery & grave">
            <Field label="Cemetery" value={cem.name} />
            <Field label="Address" value={cemAddr.length ? cemAddr.map((l, i) => <div key={i}>{l}</div>) : null} />
            <Field label="Section / Block / Lot" value={[order.plot_section, order.plot_block, order.plot_lot].some(Boolean)
              ? [order.plot_section && `Sec ${order.plot_section}`, order.plot_block && `Blk ${order.plot_block}`, order.plot_lot && `Lot ${order.plot_lot}`].filter(Boolean).join(' · ') : null} />
            <Field label="Grave number" value={order.plot_grave} />
            <Field label="Grave type" value={humanize(order.plot_type)} hint={order.plot_type ? null : 'from plot_type'} />
            <Field label="Plot / location notes" value={[order.plot_pin_notes, order.plot_other].filter(Boolean).join(' · ')} />
            <Field label="Cemetery requirements" value={cem.notes} />
            <Field label="Permit status" value={permitMs ? humanize(permitMs) : null} hint="no order field — from job milestones" />
            <Field label="Foundation status" value={foundationMs ? humanize(foundationMs) : null} hint="no order field — from job milestones" />
          </Section>

          {/* 3 — Monument */}
          <Section title="Monument">
            <Field label="Type" value={jobTypeLabel(job?.job_type, order.service_types)} />
            <Field label="Shape" value={humanize(order.shape)} />
            <Field label="Die size" value={dims} />
            <Field label="Base size" value={baseSummary} />
            <Field label="Stone color" value={humanize(order.granite_color)} />
            <Field label="Finish / polish" value={finish} />
            <Field label="Inscription" value={[insc.epitaph, insc.customNotes].filter(Boolean).join(' · ')} />
            <Field label="Deceased" value={deceased.length
              ? deceased.map((d, i) => <div key={i}>{deceasedName(d) || '—'}</div>) : null} />
            <Field label="Add-ons" value={addOns.length
              ? addOns.map((a, i) => <div key={a.code || i}>{a.label || humanize(a.code)}{a.qty > 1 ? ` × ${a.qty}` : ''}</div>) : null} />
            <Field label="Proof / approval" value={proofLabel} hint={job ? null : 'no production job yet'} />
          </Section>

          {/* 4 — Financial */}
          <Section title="Financial">
            <Field label="Contract total" value={total > 0 ? fmtUSD(total) : null} />
            <Field label="Collected" value={fmtUSD(paid)} />
            <Field label="Payments made" value={payments.length
              ? payments.map((p, i) => (
                <div key={i}>{fmtUSD(p.amount)} · {humanize(p.method) || '—'}{p.at ? ` · ${fmtDate(p.at)}` : ''}{p.locked ? '' : ' (draft)'}</div>
              )) : null} />
            <Field label="Balance due" value={fmtUSD(balance)} />
            <div className="sb-od-inline-actions">
              <button type="button" className="sb-od-link" onClick={handleOpenContract}>Open contract PDF</button>
            </div>
          </Section>

          {/* 5 — Related job */}
          <Section title="Related job">
            {job ? (
              <>
                <Field label="Stage" value={jobStage?.label} />
                <Field label="Next task" value={nra?.label} />
                <Field label="Blocker" value={pressure.blocker?.label} />
                <Field label="Target completion" value={order.target_completion_date
                  ? fmtDate(order.target_completion_date) + (order.target_completion_end_date ? ` – ${fmtDate(order.target_completion_end_date)}` : '') : null} />
                <Field label="Foundation / install / delivery dates" value={null} hint="scheduler batch data — not loaded this commit" />
                <div className="sb-od-inline-actions">
                  <button type="button" className="sb-od-link" onClick={() => onOpenJob?.(job.id)}>Open full Job view →</button>
                </div>
              </>
            ) : (
              <div className="sb-od-empty-inline">No production job yet — created when the order is signed.</div>
            )}
          </Section>

          {/* 6 — Email traffic */}
          <Section title="Email traffic">
            <div className="sb-od-empty-inline">Email integration coming soon.</div>
          </Section>
        </div>
      </div>
    </div>
  )
}

function BackBar({ onBack }) {
  return (
    <button type="button" className="sb-od-back" onClick={onBack}>← Orders</button>
  )
}

// =============================================================================
// Scoped styles — calm premium operational (Inter, near-black, bronze accent).
// =============================================================================
const OD_CSS = `
  .sb-od-page { background: var(--sb-canvas, #faf9f7); min-height: 100%; padding: 24px 0 64px; }
  .sb-od-container { max-width: 1080px; margin: 0 auto; padding: 0 24px; }
  .sb-od-back {
    background: none; border: none; color: #6b6b66; font: inherit; font-size: 13px;
    cursor: pointer; padding: 0; margin-bottom: 16px;
  }
  .sb-od-back:hover { color: #111; }
  .sb-od-empty, .sb-od-empty-inline { color: #8a8a85; font-size: 14px; padding: 8px 0; }
  .sb-od-empty { padding: 48px 0; text-align: center; }

  .sb-od-header {
    display: flex; justify-content: space-between; align-items: flex-start; gap: 24px;
    padding-bottom: 18px; border-bottom: 0.5px solid var(--sb-border, #e4e2dd); margin-bottom: 18px;
  }
  .sb-od-header-top { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
  .sb-od-ordernum { font-size: 12px; color: #8a8a85; letter-spacing: 0.04em; }
  .sb-od-title { font-size: 30px; font-weight: 600; color: #111; margin: 0; line-height: 1.1; }
  .sb-od-subtitle { font-size: 14px; color: #6b6b66; margin-top: 5px; }
  .sb-od-header-balance { text-align: right; flex-shrink: 0; }
  .sb-od-balance-label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: #8a8a85; }
  .sb-od-balance-value { font-size: 26px; font-weight: 600; color: #B54040; margin-top: 2px; }
  .sb-od-balance-value.sb-od-balance-clear { color: #1D9E75; }

  .sb-od-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-bottom: 4px; }
  .sb-od-actions-spacer { flex: 1 1 24px; }
  .sb-od-btn {
    font-size: 13px; font-weight: 500; padding: 8px 14px; border-radius: 8px;
    border: 0.5px solid var(--sb-border, #d8d6d1); background: #fff; color: #222;
    cursor: pointer; transition: background 0.12s, border-color 0.12s;
  }
  .sb-od-btn:hover:not(:disabled) { background: #f4f2ee; }
  .sb-od-btn:disabled { opacity: 0.45; cursor: default; }
  .sb-od-btn-primary { background: #9A7209; border-color: #9A7209; color: #fff; font-weight: 600; }
  .sb-od-btn-primary:hover:not(:disabled) { background: #876307; }
  .sb-od-btn-stub { color: #8a8a85; border-style: dashed; }
  .sb-od-actionnote { font-size: 12.5px; color: #876307; background: rgba(154,114,9,0.07);
    border: 0.5px solid rgba(154,114,9,0.25); border-radius: 8px; padding: 7px 12px; margin: 10px 0 0; }

  .sb-od-grid {
    display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-top: 20px;
  }
  .sb-od-span-2 { grid-column: 1 / -1; }
  @media (max-width: 820px) { .sb-od-grid { grid-template-columns: 1fr; } }

  .sb-od-card {
    background: #fff; border: 0.5px solid var(--sb-border, #e4e2dd); border-radius: 12px; padding: 18px 20px;
  }
  .sb-od-card-eyebrow {
    font-size: 11px; text-transform: uppercase; letter-spacing: 0.1em; color: #9A7209;
    font-weight: 600; margin-bottom: 12px;
  }
  .sb-od-field { display: grid; grid-template-columns: 150px 1fr; gap: 12px; padding: 6px 0; align-items: baseline; }
  .sb-od-field + .sb-od-field { border-top: 0.5px solid #f1efeb; }
  .sb-od-field-label { font-size: 12.5px; color: #8a8a85; }
  .sb-od-field-value { font-size: 13.5px; color: #222; word-break: break-word; }
  .sb-od-field-value.sb-od-missing { color: #b8b6b1; }
  .sb-od-hint { font-size: 11px; color: #b08a2e; font-style: italic; }
  .sb-od-link { background: none; border: none; color: #9A7209; font: inherit; font-size: 13.5px; cursor: pointer; padding: 0; text-decoration: underline; }
  .sb-od-link:hover { color: #876307; }
  .sb-od-inline-actions { margin-top: 12px; padding-top: 10px; border-top: 0.5px solid #f1efeb; }
`
