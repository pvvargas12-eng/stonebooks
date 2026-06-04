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

import { useState, useEffect, useRef } from 'react'
import {
  getOrderById, getJobByOrderId,
  rowGrandTotal, rowTotalPaid, rowBalanceDue,
  fmtUSD, fmtDate, fmtPhone, statusInfo, jobStatusInfo, customerName,
  computeOrderPressure, getNextRequiredAction,
  getOrderNotes, addOrderNote, getCurrentStaffName,
  uploadOrderAttachment, listOrderAttachments, listCompletionPhotos, recordOrderPayment,
  getProofVersions, getProofSignatureSignedUrl,
  getOrderEmails, sendOrderEmail, aiDraftEmail,
  setOrderPermit, PERMIT_STATUSES, needsSignedContract,
} from './lib/stonebooksData'
import { paymentTone, paymentLabel } from './lib/crmTheme'
import { Pill } from './lib/crmComponents.jsx'
import { generateContractPDF, generateApprovalSheetPDF, rowToOrder } from './SalesMode'

// ── Small helpers ────────────────────────────────────────────────────────────
const humanize = (s) =>
  s == null || s === '' ? null : String(s).replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase())

const todayISO = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const PAY_METHODS = [
  { code: 'cash', label: 'Cash' }, { code: 'check', label: 'Check' },
  { code: 'card', label: 'Card' }, { code: 'zelle', label: 'Zelle' }, { code: 'other', label: 'Other' },
]
const PAY_TYPES = [
  { code: 'deposit', label: 'Deposit' }, { code: 'progress', label: 'Progress payment' }, { code: 'final', label: 'Final payment' },
]
const permitStatusLabel = (s) => (PERMIT_STATUSES.find(x => x.code === (s || 'unknown'))?.label || s)
const permitTone = (s) => ({ approved: 'green', submitted: 'blue', required: 'amber', not_required: 'green', unknown: 'bronze' }[s || 'unknown'] || 'bronze')
const odFeeRange = (lo, hi) => {
  if (lo == null && hi == null) return null
  if (lo != null && hi != null) return `$${Number(lo).toLocaleString()}–$${Number(hi).toLocaleString()}`
  return `$${Number(lo != null ? lo : hi).toLocaleString()}`
}

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
export default function OrderDetail({ orderId, onBack, onEditInSales, onEditInSalesPortal, onOpenJob, onOpenCustomer }) {
  const [order, setOrder] = useState(null)
  const [job, setJob] = useState(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState(null)
  const [actionNote, setActionNote] = useState(null)
  // Notes
  const [notes, setNotes] = useState([])
  const [noteBody, setNoteBody] = useState('')
  const [noteBusy, setNoteBusy] = useState(false)
  const noteRef = useRef(null)
  // Attachments
  const [proofVers, setProofVers] = useState([])
  const [uploads, setUploads] = useState([])
  const [completionPhotos, setCompletionPhotos] = useState([])
  const [uploadBusy, setUploadBusy] = useState(false)
  const fileRef = useRef(null)
  // Email
  const [emails, setEmails] = useState([])
  const [emailModal, setEmailModal] = useState(null) // { to, subject, body, busy, error, sent } | null
  const [drafting, setDrafting] = useState(null)      // the mode currently being AI-drafted | null
  // Record payment
  const [payModal, setPayModal] = useState(null)      // open payment modal state | null
  // Approval packet preview
  const [approvalSheet, setApprovalSheet] = useState(null)  // { url, doc, filename, version } | null
  // Permit editor
  const [permitDraft, setPermitDraft] = useState(null)
  const [permitBusy, setPermitBusy] = useState(false)
  const [permitMsg, setPermitMsg] = useState(null)

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
      // Secondary loads (notes + attachment sources + emails) — non-blocking.
      const [nts, ups, pvs, ems, cps] = await Promise.all([
        getOrderNotes(orderId),
        listOrderAttachments(orderId),
        j?.id ? getProofVersions(j.id) : Promise.resolve([]),
        getOrderEmails(orderId),
        listCompletionPhotos(orderId),
      ])
      if (cancelled) return
      setNotes(nts); setUploads(ups); setProofVers(pvs); setEmails(ems); setCompletionPhotos(cps)
    }).catch(e => { if (!cancelled) { setErr(e?.message || 'Failed to load order'); setLoading(false) } })
    return () => { cancelled = true }
  }, [orderId])

  const refreshNotes = async () => setNotes(await getOrderNotes(orderId))
  const refreshUploads = async () => setUploads(await listOrderAttachments(orderId))
  const refreshOrder = async () => { const o = await getOrderById(orderId); if (o) setOrder(o) }

  // ── Permit status editor ───────────────────────────────────────────────────
  const openPermitEdit = () => {
    setPermitMsg(null)
    setPermitDraft({
      permit_status: order.permit_status || 'unknown',
      permit_filed_at: order.permit_filed_at || '',
      permit_approved_at: order.permit_approved_at || '',
      permit_fee_paid: order.permit_fee_paid ?? '',
    })
  }
  const savePermit = async () => {
    if (!permitDraft || permitBusy) return
    setPermitBusy(true); setPermitMsg(null)
    const d = permitDraft
    const patch = {
      permit_status: d.permit_status,
      permit_filed_at: d.permit_filed_at || null,
      permit_approved_at: d.permit_approved_at || null,
      permit_fee_paid: d.permit_fee_paid === '' ? null : Number(d.permit_fee_paid),
    }
    const today = todayISO()
    if (patch.permit_status === 'submitted' && !patch.permit_filed_at) patch.permit_filed_at = today
    if (patch.permit_status === 'approved') {
      if (!patch.permit_filed_at) patch.permit_filed_at = today
      if (!patch.permit_approved_at) patch.permit_approved_at = today
    }
    const r = await setOrderPermit(orderId, patch)
    setPermitBusy(false)
    if (!r.ok) { setPermitMsg({ type: 'err', text: r.error }); return }
    setPermitDraft(null); await refreshOrder()
  }

  const handleAddNote = async () => {
    const body = noteBody.trim()
    if (!body || noteBusy) return
    setNoteBusy(true)
    const author = await getCurrentStaffName()
    const res = await addOrderNote({ orderId, body, author })
    setNoteBusy(false)
    if (!res.ok) { setActionNote(`Could not add note — ${res.error}.`); return }
    setNoteBody('')
    refreshNotes()
  }
  const focusNote = () => { setActionNote(null); noteRef.current?.focus() }

  const onPickAttachment = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setUploadBusy(true); setActionNote(null)
    const res = await uploadOrderAttachment(orderId, file)
    setUploadBusy(false)
    if (!res.ok) { setActionNote(`Upload failed — ${res.error}.`); return }
    refreshUploads()
  }
  const openSignature = async (path) => {
    const url = await getProofSignatureSignedUrl(path)
    if (url) window.open(url, '_blank', 'noopener')
    else setActionNote('Could not open signature (signed URL expired or blocked).')
  }

  // ── Email (Gmail Phase 2) ──────────────────────────────────────────────────
  const openEmailComposer = () => {
    setActionNote(null)
    setEmailModal({ to: order?.customer?.email || '', subject: '', body: '', busy: false, error: null, sent: false })
  }
  const closeEmailComposer = () => setEmailModal(m => (m && m.busy ? m : null))
  const handleSendEmail = async () => {
    if (!emailModal) return
    const to = (emailModal.to || '').trim()
    const subject = (emailModal.subject || '').trim()
    if (!to || !subject || emailModal.busy) return
    setEmailModal(m => ({ ...m, busy: true, error: null }))
    const res = await sendOrderEmail({ orderId, to, subject, body: emailModal.body })
    if (!res.ok) { setEmailModal(m => ({ ...m, busy: false, error: res.error || 'Send failed' })); return }
    setEmailModal(m => ({ ...m, busy: false, sent: true }))
    setEmails(await getOrderEmails(orderId))
  }

  // Polish — rewrite the user's CURRENT composer body via ai-draft (mode
  // 'polish'); preserves their meaning/facts, just cleans it up. Replaces the
  // body in place; never touches the subject. Distinct from the generate-from-
  // scratch draft buttons.
  const polishDraft = async () => {
    if (!emailModal || emailModal.polishing) return
    const text = (emailModal.body || '').trim()
    if (!text) return
    setEmailModal(m => ({ ...m, polishing: true, error: null }))
    const res = await aiDraftEmail({ orderId, mode: 'polish', draftText: text })
    if (!res.ok) { setEmailModal(m => ({ ...m, polishing: false, error: res.error || 'Polish failed' })); return }
    setEmailModal(m => ({ ...m, polishing: false, body: res.body || m.body }))
  }

  // AI draft — generates via ai-draft, then opens the existing composer
  // prefilled. Nothing auto-sends; staff edits and sends via gmail-send.
  const draft = async (mode) => {
    if (drafting) return
    setDrafting(mode); setActionNote(null)
    const res = await aiDraftEmail({ orderId, mode, balance, total, photoCount: completionPhotos.length })
    setDrafting(null)
    if (!res.ok) { setActionNote(`Could not draft — ${res.error || 'error'}.`); return }
    setEmailModal({
      to: order?.customer?.email || '',
      subject: res.subject || '',
      body: res.body || '',
      busy: false, error: null, sent: false,
    })
  }

  // ── Record payment ─────────────────────────────────────────────────────────
  const openPayment = () => {
    setActionNote(null)
    setPayModal({ amount: '', method: 'check', type: 'deposit', receivedAt: todayISO(), ref: '', note: '', busy: false, error: null, confirm: false })
  }
  const closePayment = () => setPayModal(m => (m && m.busy ? m : null))
  const handleRecordPayment = async () => {
    if (!payModal || payModal.busy) return
    const amount = Number(payModal.amount)
    if (!Number.isFinite(amount) || amount <= 0) { setPayModal(m => ({ ...m, error: 'Enter an amount greater than zero.' })); return }
    // Money safety — explicit confirm step before the record is written.
    if (!payModal.confirm) { setPayModal(m => ({ ...m, confirm: true, error: null })); return }
    setPayModal(m => ({ ...m, busy: true, error: null }))
    const createdBy = await getCurrentStaffName()
    const res = await recordOrderPayment(orderId, {
      amount, method: payModal.method, type: payModal.type,
      receivedAt: payModal.receivedAt, ref: payModal.ref.trim() || null,
      note: payModal.note.trim() || null, createdBy,
    })
    if (!res.ok) { setPayModal(m => ({ ...m, busy: false, confirm: false, error: res.error || 'Could not record the payment.' })); return }
    setPayModal(null)
    await refreshOrder()
    setActionNote(`Payment of ${fmtUSD(amount)} recorded.`)
  }

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
  // Permit derived values
  const permitFeeRange = odFeeRange(order.permit_fee_low ?? order.cemetery?.permit_fee_low, order.permit_fee_high ?? order.cemetery?.permit_fee_high)
  const readyBlocked = (job?.milestones || []).some(m => m.milestone_key === 'ready_to_install' && m.status === 'done')
    && order.permit_status !== 'approved' && order.permit_status !== 'not_required'
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
  // ── Approval packet — the customer-facing approval sheet for the current
  // proof version. Reuses generateApprovalSheetPDF (frozen snapshot + live
  // balance + signature when approved). Read-only here; send/approve/request-
  // changes live in the Design Hub for the related job.
  const openApprovalPacket = async () => {
    setActionNote(null)
    const v = proofVers.find(p => p.is_current) || proofVers[0]
    if (!v) { setActionNote(job ? 'No proof yet — add a layout in the Design Hub for this job.' : 'No production job yet, so there is no proof to approve.'); return }
    try {
      const signatureImageUrl = (v.approved_at && v.signature_url) ? await getProofSignatureSignedUrl(v.signature_url) : null
      const { doc, filename } = await generateApprovalSheetPDF(v, { balance: rowBalanceDue(order), signatureImageUrl, returnDoc: true })
      const url = URL.createObjectURL(doc.output('blob'))
      setApprovalSheet({ url, doc, filename, version: v })
    } catch (e) {
      setActionNote(`Could not open approval packet — ${e?.message || 'error'}.`)
    }
  }
  const closeApprovalSheet = () => setApprovalSheet(s => { if (s?.url) URL.revokeObjectURL(s.url); return null })

  // ── Aggregated attachments (existing buckets, no new bucket) ───────────────
  // Layout proofs (orders-attachments-public) + signatures (proof-signatures,
  // signed URL on open) + the generated contract PDF + general uploads.
  const attachmentRows = [
    ...proofVers.filter(v => v.layout_image_url).map(v => ({
      key: `proof-${v.id}`, kind: 'Layout proof', label: `Layout v${v.version_number}`,
      sub: v.uploaded_at ? fmtDate(v.uploaded_at) : null, href: v.layout_image_url,
    })),
    ...proofVers.filter(v => v.signature_url).map(v => ({
      key: `sig-${v.id}`, kind: 'Signature', label: `Signature v${v.version_number}`,
      sub: v.approved_by_name ? `by ${v.approved_by_name}` : null, onOpen: () => openSignature(v.signature_url),
    })),
    { key: 'contract', kind: 'Document', label: 'Contract PDF', sub: 'generated on open', onOpen: handleOpenContract },
    ...uploads.map((u, i) => ({
      key: `up-${i}`, kind: 'Upload', label: u.name,
      sub: u.createdAt ? fmtDate(u.createdAt) : null, href: u.url,
    })),
  ]

  // ── AI draft modes — state-aware (only what the order warrants) ────────────
  const hasInbound = emails.some(e => e.direction === 'inbound')
  const hasProof = proofVers.length > 0
  const proofApproved = proofVers.some(v => v.approved_at)
  const installedDone = (job?.milestones || []).some(m => m.milestone_key === 'installed' && m.status === 'done')
    || job?.overall_status === 'installed'
  // Closeout draft (ITEM 5) — the "close out with customer" email. Surfaces
  // once the work is done AND completion photos exist (the photos are the cue
  // that the job is ready to wrap with the family). Made primary so it's the
  // obvious next move on a completed order.
  const hasCompletionPhotos = completionPhotos.length > 0
  const closeoutReady = installedDone && hasCompletionPhotos
  const draftModes = [
    hasInbound && { mode: 'reply', label: 'Draft reply (AI)', primary: true },
    closeoutReady && { mode: 'closeout', label: 'Close out with customer (AI)', primary: !hasInbound },
    hasProof && !proofApproved && { mode: 'request_approval', label: 'Request approval' },
    balance > 0 && { mode: 'balance_reminder', label: 'Balance reminder' },
    installedDone && !closeoutReady && { mode: 'install_complete', label: 'Install complete' },
    !installedDone && { mode: 'request_photo', label: 'Request photo' },
  ].filter(Boolean)

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

        {/* A6 — "signed contract still needed": a deposit auto-completed the
            contract step, but no real signature is on file yet. Persists until
            the order is signed. */}
        {needsSignedContract(order) && (
          <div className="sb-od-need-signature">
            <span aria-hidden="true">⚠</span>
            <span><strong>Signed contract still needed.</strong> A deposit is logged (contract &amp; deposit steps are checked off), but the customer hasn't signed yet — collect the signature to clear this.</span>
          </div>
        )}

        {/* ── QUICK ACTIONS ───────────────────────────────────────────────── */}
        <div className="sb-od-actions">
          <button type="button" className="sb-od-btn sb-od-btn-primary" onClick={() => onEditInSales?.(order.id)}>
            Edit order
          </button>
          {onEditInSalesPortal && (
            <button type="button" className="sb-od-btn" onClick={() => onEditInSalesPortal(order.id)}>
              Edit in Sales Portal
            </button>
          )}
          <button type="button" className="sb-od-btn" onClick={handleOpenContract}>Open contract</button>
          <button type="button" className="sb-od-btn" onClick={openApprovalPacket}>Open approval packet</button>
          <button type="button" className="sb-od-btn" onClick={() => job ? onOpenJob?.(job.id) : null} disabled={!job}
            title={job ? '' : 'No production job yet'}>
            Open related job
          </button>
          <button type="button" className="sb-od-btn" onClick={openEmailComposer}>Send email</button>
          <span className="sb-od-actions-spacer" />
          <button type="button" className="sb-od-btn" onClick={focusNote}>Add note</button>
          <button type="button" className="sb-od-btn" onClick={() => fileRef.current?.click()} disabled={uploadBusy}>
            {uploadBusy ? 'Uploading…' : 'Upload attachment'}
          </button>
          <button type="button" className="sb-od-btn" onClick={openPayment}>Record payment</button>
          <input ref={fileRef} type="file" style={{ display: 'none' }} onChange={onPickAttachment} />
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
            <Field label="Phone" value={fmtPhone(cust.phone_primary)} />
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

          {/* 4b — Permit */}
          <Section title="Permit">
            {permitDraft ? (
              <div className="sb-od-permit-edit">
                <label className="sb-od-modal-field"><span>Permit status</span>
                  <select className="sb-od-note-input" value={permitDraft.permit_status} onChange={e => setPermitDraft(d => ({ ...d, permit_status: e.target.value }))}>
                    {PERMIT_STATUSES.map(s => <option key={s.code} value={s.code}>{s.label}</option>)}
                  </select>
                </label>
                <div className="sb-od-modal-row">
                  <label className="sb-od-modal-field"><span>Filed date</span>
                    <input type="date" className="sb-od-note-input" value={permitDraft.permit_filed_at || ''} onChange={e => setPermitDraft(d => ({ ...d, permit_filed_at: e.target.value }))} /></label>
                  <label className="sb-od-modal-field"><span>Approved date</span>
                    <input type="date" className="sb-od-note-input" value={permitDraft.permit_approved_at || ''} onChange={e => setPermitDraft(d => ({ ...d, permit_approved_at: e.target.value }))} /></label>
                </div>
                <label className="sb-od-modal-field"><span>Fee paid <em className="sb-od-opt">optional</em></span>
                  <input type="number" className="sb-od-note-input" value={permitDraft.permit_fee_paid} onChange={e => setPermitDraft(d => ({ ...d, permit_fee_paid: e.target.value }))} placeholder="0.00" /></label>
                {permitMsg && <div className="sb-msg sb-msg-err" style={{ marginBottom: 4 }}>{permitMsg.text}</div>}
                <div className="sb-od-modal-actions">
                  <button type="button" className="sb-od-btn" onClick={() => setPermitDraft(null)} disabled={permitBusy}>Cancel</button>
                  <button type="button" className="sb-od-btn sb-od-btn-primary" onClick={savePermit} disabled={permitBusy}>{permitBusy ? 'Saving…' : 'Save permit'}</button>
                </div>
              </div>
            ) : (
              <>
                <Field label="Cemetery requires permit" value={cem.permit_required == null ? null : (cem.permit_required ? 'Yes' : 'No')} hint={cem.permit_required == null ? (cem.id ? null : 'cemetery not linked') : null} />
                <Field label="Expected fee" value={permitFeeRange} />
                <Field label="Permit status" value={<Pill severity={permitTone(order.permit_status)}>{permitStatusLabel(order.permit_status)}</Pill>} />
                {readyBlocked && <Field label="⚠ Blocking install" value="Stone is ready to set but the permit isn't approved." />}
                <Field label="Filed / Approved" value={[order.permit_filed_at && `filed ${fmtDate(order.permit_filed_at)}`, order.permit_approved_at && `approved ${fmtDate(order.permit_approved_at)}`].filter(Boolean).join(' · ') || null} />
                <Field label="Fee paid" value={order.permit_fee_paid != null ? fmtUSD(order.permit_fee_paid) : null} />
                <Field label="Cemetery notes" value={cem.permit_notes} />
                <Field label="Document requirements" value={cem.permit_document_requirements} />
                <Field label="Cemetery instructions" value={cem.permit_instructions} />
                <Field label="Permit contact" value={[cem.permit_contact_name, cem.permit_contact_phone, cem.permit_contact_email].filter(Boolean).join(' · ') || null} />
                <div className="sb-od-inline-actions">
                  <button type="button" className="sb-od-link" onClick={openPermitEdit}>Update permit status</button>
                </div>
              </>
            )}
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

          {/* 7 — Attachments (aggregated from existing buckets) */}
          <Section title="Attachments" span={2}>
            {attachmentRows.length === 0 ? (
              <div className="sb-od-empty-inline">No attachments yet.</div>
            ) : (
              <div className="sb-od-attach-list">
                {attachmentRows.map(a => (
                  <div key={a.key} className="sb-od-attach-row">
                    <span className="sb-od-attach-kind">{a.kind}</span>
                    <span className="sb-od-attach-label">{a.label}</span>
                    {a.sub && <span className="sb-od-attach-sub">{a.sub}</span>}
                    {a.href ? (
                      <a className="sb-od-link sb-od-attach-open" href={a.href} target="_blank" rel="noreferrer">Open ↗</a>
                    ) : (
                      <button type="button" className="sb-od-link sb-od-attach-open" onClick={a.onOpen}>Open ↗</button>
                    )}
                  </div>
                ))}
              </div>
            )}
            <div className="sb-od-inline-actions">
              <button type="button" className="sb-od-link" onClick={() => fileRef.current?.click()} disabled={uploadBusy}>
                {uploadBusy ? 'Uploading…' : '+ Upload attachment'}
              </button>
            </div>
          </Section>

          {/* 7b — Completion photos (ITEM 4): job-site photos captured at task
              completion in the Scheduler/Calendar. Read-only here. */}
          {completionPhotos.length > 0 && (
            <Section title="Completion photos" span={2}>
              <div className="sb-od-completion-grid">
                {completionPhotos.map(p => (
                  <a key={p.path} className="sb-od-completion-thumb" href={p.url} target="_blank" rel="noreferrer" title={p.name}>
                    <img src={p.url} alt={p.name} loading="lazy" />
                  </a>
                ))}
              </div>
            </Section>
          )}

          {/* 8 — Notes */}
          <Section title="Notes" span={2}>
            <div className="sb-od-note-composer">
              <textarea
                ref={noteRef}
                className="sb-od-note-input"
                placeholder="Add a note about this order…"
                value={noteBody}
                onChange={e => setNoteBody(e.target.value)}
                rows={2}
              />
              <button
                type="button"
                className="sb-od-btn sb-od-btn-primary sb-od-note-add"
                onClick={handleAddNote}
                disabled={noteBusy || !noteBody.trim()}
              >
                {noteBusy ? 'Saving…' : 'Add note'}
              </button>
            </div>
            {notes.length === 0 ? (
              <div className="sb-od-empty-inline">No notes yet.</div>
            ) : (
              <div className="sb-od-note-list">
                {notes.map(n => (
                  <div key={n.id} className="sb-od-note">
                    <div className="sb-od-note-body">{n.body}</div>
                    <div className="sb-od-note-meta">{n.author || 'Staff'} · {fmtDate(n.created_at)}</div>
                  </div>
                ))}
              </div>
            )}
          </Section>

          {/* 6 — Email traffic */}
          <Section title="Email traffic" span={2}>
            {/* AI drafts — state-aware. Each generates via Claude Haiku then
                opens the composer prefilled; the human always sends. */}
            <div className="sb-od-draft-row">
              {draftModes.map(d => (
                <button
                  key={d.mode}
                  type="button"
                  className={`sb-od-btn${d.primary ? ' sb-od-btn-primary' : ''}`}
                  onClick={() => draft(d.mode)}
                  disabled={!!drafting}
                >
                  {drafting === d.mode ? 'Drafting…' : d.label}
                </button>
              ))}
              <span className="sb-od-actions-spacer" />
              <button type="button" className="sb-od-link" onClick={openEmailComposer}>+ Send email</button>
            </div>
            {emails.length === 0 ? (
              <div className="sb-od-empty-inline">No emails on this order yet.</div>
            ) : (
              <div className="sb-od-email-list">
                {emails.map(em => (
                  <div key={em.id} className="sb-od-email-row">
                    <span className={`sb-od-email-dir sb-od-email-dir-${em.direction || 'outbound'}`}>
                      {em.direction === 'inbound' ? 'In' : 'Out'}
                    </span>
                    <div className="sb-od-email-main">
                      <div className="sb-od-email-subject">{em.subject || '(no subject)'}</div>
                      <div className="sb-od-email-sub">
                        {em.direction === 'inbound' ? `from ${em.from_email || '—'}` : `to ${em.to_email || '—'}`}
                        {em.sent_at ? ` · ${fmtDate(em.sent_at)}` : ''}
                      </div>
                      {em.snippet && <div className="sb-od-email-snippet">{em.snippet}</div>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Section>
        </div>
      </div>

      {/* Send-email composer (Gmail Phase 2 — minimal). To prefilled from the
          customer; calls gmail-send and confirms on success. Rich composer +
          approval-sheet attachment come next commit. */}
      {emailModal && (
        <div className="sb-od-modal-overlay" onClick={closeEmailComposer}>
          <div className="sb-od-modal" onClick={e => e.stopPropagation()}>
            <div className="sb-od-modal-title">Send email · {order.order_number || 'order'}</div>
            {emailModal.sent ? (
              <>
                <div className="sb-msg sb-msg-ok" style={{ marginBottom: 14 }}>✓ Sent to {emailModal.to}</div>
                <div className="sb-od-modal-actions">
                  <button type="button" className="sb-od-btn sb-od-btn-primary" onClick={() => setEmailModal(null)}>Done</button>
                </div>
              </>
            ) : (
              <>
                <label className="sb-od-modal-field">
                  <span>To</span>
                  <input type="email" className="sb-od-note-input" value={emailModal.to}
                    onChange={e => setEmailModal(m => ({ ...m, to: e.target.value }))} placeholder="customer@example.com" />
                </label>
                <label className="sb-od-modal-field">
                  <span>Subject</span>
                  <input type="text" className="sb-od-note-input" value={emailModal.subject}
                    onChange={e => setEmailModal(m => ({ ...m, subject: e.target.value }))} placeholder="Subject" />
                </label>
                <label className="sb-od-modal-field">
                  <span>Message</span>
                  <textarea className="sb-od-note-input" rows={6} value={emailModal.body}
                    onChange={e => setEmailModal(m => ({ ...m, body: e.target.value }))} placeholder="Write your message…" />
                </label>
                {emailModal.error && (
                  <div className="sb-msg sb-msg-err" style={{ marginBottom: 4 }}>{emailModal.error}</div>
                )}
                <div className="sb-od-modal-actions">
                  <button type="button" className="sb-od-btn" onClick={closeEmailComposer} disabled={emailModal.busy || emailModal.polishing}>Cancel</button>
                  {/* Polish rewrites what's typed (distinct from the generate-from-scratch buttons). */}
                  <button type="button" className="sb-od-btn" onClick={polishDraft}
                    disabled={emailModal.busy || emailModal.polishing || !emailModal.body.trim()}>
                    {emailModal.polishing ? 'Polishing…' : 'Polish with AI'}
                  </button>
                  <button type="button" className="sb-od-btn sb-od-btn-primary" onClick={handleSendEmail}
                    disabled={emailModal.busy || emailModal.polishing || !emailModal.to.trim() || !emailModal.subject.trim()}>
                    {emailModal.busy ? 'Sending…' : 'Send'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Record payment — append-only money record with a confirm step. */}
      {payModal && (
        <div className="sb-od-modal-overlay" onClick={closePayment}>
          <div className="sb-od-modal" onClick={e => e.stopPropagation()}>
            <div className="sb-od-modal-title">Record payment · {order.order_number || 'order'}</div>
            <div className="sb-od-pay-summary">
              <span>Balance due</span>
              <strong>{fmtUSD(balance)}</strong>
            </div>
            <div className="sb-od-modal-row">
              <label className="sb-od-modal-field">
                <span>Amount</span>
                <span className="sb-od-pay-amt">
                  <span className="sb-od-pay-amt-pre">$</span>
                  <input type="number" className="sb-od-note-input" value={payModal.amount} disabled={payModal.confirm}
                    onChange={e => setPayModal(m => ({ ...m, amount: e.target.value }))} placeholder="0.00" />
                </span>
              </label>
              <label className="sb-od-modal-field">
                <span>Date received</span>
                <input type="date" className="sb-od-note-input" value={payModal.receivedAt} disabled={payModal.confirm}
                  onChange={e => setPayModal(m => ({ ...m, receivedAt: e.target.value }))} />
              </label>
            </div>
            <div className="sb-od-modal-row">
              <label className="sb-od-modal-field">
                <span>Method</span>
                <select className="sb-od-note-input" value={payModal.method} disabled={payModal.confirm}
                  onChange={e => setPayModal(m => ({ ...m, method: e.target.value }))}>
                  {PAY_METHODS.map(o => <option key={o.code} value={o.code}>{o.label}</option>)}
                </select>
              </label>
              <label className="sb-od-modal-field">
                <span>Type</span>
                <select className="sb-od-note-input" value={payModal.type} disabled={payModal.confirm}
                  onChange={e => setPayModal(m => ({ ...m, type: e.target.value }))}>
                  {PAY_TYPES.map(o => <option key={o.code} value={o.code}>{o.label}</option>)}
                </select>
              </label>
            </div>
            <label className="sb-od-modal-field">
              <span>{payModal.method === 'zelle' ? 'Zelle confirmation #' : 'Reference / check #'} <em className="sb-od-opt">optional</em></span>
              <input type="text" className="sb-od-note-input" value={payModal.ref} disabled={payModal.confirm}
                onChange={e => setPayModal(m => ({ ...m, ref: e.target.value }))} placeholder="e.g. 1042" />
            </label>
            <label className="sb-od-modal-field">
              <span>Note <em className="sb-od-opt">optional</em></span>
              <input type="text" className="sb-od-note-input" value={payModal.note} disabled={payModal.confirm}
                onChange={e => setPayModal(m => ({ ...m, note: e.target.value }))} placeholder="Anything to remember" />
            </label>
            {payModal.confirm && (
              <div className="sb-od-pay-confirm">
                Record <strong>{fmtUSD(Number(payModal.amount) || 0)}</strong> by {PAY_METHODS.find(x => x.code === payModal.method)?.label} as a {PAY_TYPES.find(x => x.code === payModal.type)?.label.toLowerCase()}? Payments are append-only — they can't be edited or deleted here.
              </div>
            )}
            {payModal.error && <div className="sb-msg sb-msg-err" style={{ marginBottom: 4 }}>{payModal.error}</div>}
            <div className="sb-od-modal-actions">
              <button type="button" className="sb-od-btn" onClick={payModal.confirm ? () => setPayModal(m => ({ ...m, confirm: false })) : closePayment} disabled={payModal.busy}>
                {payModal.confirm ? 'Back' : 'Cancel'}
              </button>
              <button type="button" className="sb-od-btn sb-od-btn-primary" onClick={handleRecordPayment} disabled={payModal.busy}>
                {payModal.busy ? 'Recording…' : payModal.confirm ? 'Confirm & record' : 'Review'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Approval packet — customer-facing approval sheet for the current proof. */}
      {approvalSheet && (
        <div className="sb-od-modal-overlay" onClick={closeApprovalSheet}>
          <div className="sb-od-modal sb-od-sheet-modal" onClick={e => e.stopPropagation()}>
            <div className="sb-od-modal-title">
              Approval sheet · v{approvalSheet.version?.version_number}
              {approvalSheet.version?.approved_at
                ? <span className="sb-od-sheet-tag sb-od-sheet-tag-ok">Approved {fmtDate(approvalSheet.version.approved_at)}{approvalSheet.version.approved_by_name ? ` · ${approvalSheet.version.approved_by_name}` : ''}</span>
                : <span className="sb-od-sheet-tag">{approvalSheet.version?.sent_at ? 'Awaiting customer approval' : 'Not yet sent'}</span>}
            </div>
            <iframe className="sb-od-sheet-frame" title="Approval sheet" src={approvalSheet.url} />
            <div className="sb-od-modal-actions">
              <button type="button" className="sb-od-btn" onClick={closeApprovalSheet}>Close</button>
              <button type="button" className="sb-od-btn" onClick={() => window.open(approvalSheet.url, '_blank', 'noopener')}>Print / new tab</button>
              <button type="button" className="sb-od-btn" onClick={() => approvalSheet.doc.save(approvalSheet.filename)}>Download PDF</button>
              {job && <button type="button" className="sb-od-btn sb-od-btn-primary" onClick={() => onOpenJob?.(job.id)}>Manage in Design Hub →</button>}
            </div>
          </div>
        </div>
      )}
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
  .sb-od-link:disabled { opacity: 0.5; cursor: default; }
  .sb-od-inline-actions { margin-top: 12px; padding-top: 10px; border-top: 0.5px solid #f1efeb; }

  /* Attachments */
  .sb-od-need-signature {
    display: flex; align-items: flex-start; gap: 10px;
    background: #fbe5b8; border: 1px solid #b8842a; border-left: 4px solid #b8842a;
    border-radius: 8px; padding: 12px 14px; margin: 0 0 18px;
    font-size: 13.5px; line-height: 1.45; color: #5e3a0e;
  }
  .sb-od-completion-grid {
    display: grid; grid-template-columns: repeat(auto-fill, minmax(100px, 1fr)); gap: 8px;
  }
  .sb-od-completion-thumb {
    display: block; aspect-ratio: 1 / 1; border-radius: 6px; overflow: hidden;
    border: 0.5px solid #e6e3dd; background: #f4f2ee;
  }
  .sb-od-completion-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .sb-od-attach-list { display: flex; flex-direction: column; }
  .sb-od-attach-row { display: flex; align-items: center; gap: 10px; padding: 8px 0; font-size: 13.5px; }
  .sb-od-attach-row + .sb-od-attach-row { border-top: 0.5px solid #f1efeb; }
  .sb-od-attach-kind {
    font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; font-weight: 600;
    color: #8a8a85; background: #f4f2ee; border-radius: 4px; padding: 2px 7px; flex-shrink: 0; min-width: 92px; text-align: center;
  }
  .sb-od-attach-label { color: #222; flex: 1 1 auto; word-break: break-word; }
  .sb-od-attach-sub { color: #8a8a85; font-size: 12px; flex-shrink: 0; }
  .sb-od-attach-open { flex-shrink: 0; }

  /* Notes */
  .sb-od-note-composer { display: flex; gap: 10px; align-items: flex-end; margin-bottom: 14px; }
  .sb-od-note-input {
    flex: 1 1 auto; font: inherit; font-size: 13.5px; padding: 9px 12px; border-radius: 8px;
    border: 0.5px solid var(--sb-border, #d8d6d1); resize: vertical; min-height: 38px;
  }
  .sb-od-note-input:focus-visible { outline: 2px solid #9A7209; outline-offset: 1px; }
  .sb-od-note-add { flex-shrink: 0; }
  .sb-od-note-list { display: flex; flex-direction: column; }
  .sb-od-note { padding: 10px 0; }
  .sb-od-note + .sb-od-note { border-top: 0.5px solid #f1efeb; }
  .sb-od-note-body { font-size: 13.5px; color: #222; white-space: pre-wrap; word-break: break-word; }
  .sb-od-note-meta { font-size: 11.5px; color: #8a8a85; margin-top: 4px; }

  /* Email traffic */
  .sb-od-draft-row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-bottom: 14px; }
  .sb-od-email-list { display: flex; flex-direction: column; }
  .sb-od-email-row { display: flex; gap: 12px; padding: 10px 0; align-items: flex-start; }
  .sb-od-email-row + .sb-od-email-row { border-top: 0.5px solid #f1efeb; }
  .sb-od-email-dir {
    font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; font-weight: 600;
    border-radius: 4px; padding: 2px 7px; flex-shrink: 0; margin-top: 1px;
  }
  .sb-od-email-dir-outbound { color: #876307; background: rgba(154,114,9,0.1); }
  .sb-od-email-dir-inbound { color: #1f7a3d; background: rgba(31,122,61,0.1); }
  .sb-od-email-main { flex: 1 1 auto; min-width: 0; }
  .sb-od-email-subject { font-size: 13.5px; font-weight: 600; color: #222; }
  .sb-od-email-sub { font-size: 12px; color: #8a8a85; margin-top: 2px; }
  .sb-od-email-snippet { font-size: 12.5px; color: #555; margin-top: 4px; word-break: break-word; }

  /* Send-email composer modal */
  .sb-od-modal-overlay {
    position: fixed; inset: 0; background: rgba(15,20,25,0.5);
    display: flex; align-items: center; justify-content: center; z-index: 1000;
  }
  .sb-od-modal {
    background: #fff; border-radius: 12px; padding: 22px; width: min(520px, 94vw);
    box-shadow: 0 12px 48px rgba(0,0,0,0.2);
  }
  .sb-od-modal-title { font-size: 16px; font-weight: 600; color: #111; margin-bottom: 14px; }
  .sb-od-sheet-modal { width: min(840px, 96vw); }
  .sb-od-sheet-frame { width: 100%; height: min(72vh, 760px); border: 0.5px solid #e4e2dd; border-radius: 8px; background: #f4f3f0; margin-bottom: 14px; }
  .sb-od-sheet-tag { font-size: 11px; font-weight: 600; color: #8a8a85; background: #f0eee9; border-radius: 4px; padding: 2px 8px; margin-left: 10px; vertical-align: middle; }
  .sb-od-sheet-tag-ok { color: #1D9E75; background: #e3f4ec; }
  .sb-od-modal-field { display: flex; flex-direction: column; gap: 4px; margin-bottom: 12px; }
  .sb-od-modal-field > span {
    font-size: 13px; color: #8a8a85; font-weight: 500;
  }
  .sb-od-modal-field .sb-od-note-input { margin-bottom: 0; width: 100%; box-sizing: border-box; }
  .sb-od-modal-field .sb-od-opt { text-transform: none; letter-spacing: normal; font-weight: 400; color: #b0b0a8; font-style: italic; }
  .sb-od-modal-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 6px; }
  .sb-od-modal-row { display: flex; gap: 12px; }
  .sb-od-modal-row .sb-od-modal-field { flex: 1 1 0; min-width: 0; }
  .sb-od-pay-summary { display: flex; justify-content: space-between; align-items: baseline; padding: 10px 12px; background: #faf9f7; border: 0.5px solid #e4e2dd; border-radius: 8px; margin-bottom: 14px; }
  .sb-od-pay-summary span { font-size: 12px; color: #8a8a85; }
  .sb-od-pay-summary strong { font-size: 17px; color: #1e2d3d; font-variant-numeric: tabular-nums; }
  .sb-od-pay-confirm { background: #fdf8ec; border: 0.5px solid #e8d9a8; border-radius: 8px; padding: 10px 12px; font-size: 13px; color: #6b5d2f; margin-bottom: 10px; line-height: 1.45; }
  .sb-od-pay-amt { position: relative; display: block; }
  .sb-od-pay-amt-pre { position: absolute; left: 10px; top: 50%; transform: translateY(-50%); font-size: 13px; color: #a0a09a; pointer-events: none; }
  .sb-od-pay-amt .sb-od-note-input { padding-left: 22px; }
`
