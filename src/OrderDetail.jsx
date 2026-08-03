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

import { useState, useEffect, useMemo, useRef } from 'react'
import {
  getOrderById, getJobByOrderId, createJobFromOrder, designStatusOptions, statusDimApplies,
  rowGrandTotal, rowTotalPaid, rowBalanceDue,
  fmtUSD, fmtDate, fmtPhone, statusInfo, jobStatusInfo, customerName, properName,
  computeOrderPressure, getNextRequiredAction,
  getOrderNotes, addOrderNote, getCurrentStaffName,
  getOrderActivity, addOrderActivityNote, addOrderTask, setOrderTaskStatus, logOrderActivity,
  listShopTasksForOrder, deleteShopTask, getChangeRequestThread,
  updateOrderLeadFields, TASK_KINDS,
  uploadOrderAttachment, listOrderAttachments, deleteOrderAttachment, listCompletionPhotos, recordOrderPayment,
  closeOrder, photoAttachment, setJobOverallStatus, setOrderFamilyName,
  updateOrderPayment, voidOrderPayment,
  getSignedContract, signedContractFileUrl, markContractSigned, removeSignedContract,
  getApprovalSigned, approvalSignedFileUrl, removeApprovalSigned,
  createApprovalLink, getApprovalLinksForOrder, revokeApprovalLink,
  ensureDerivedMilestones, updateMilestone, updateMilestoneWithOverride, deleteOrderActivity, ensurePermitBuildTask,
  getProofVersions, getProofVersionsByOrder, getProofSignatureSignedUrl, updateProofVersion,
  uploadProofLayout, createProofVersion,
  getMessageThread, sendShopEmail, aiDraftEmail,
  listEmailDrafts, saveEmailDraft, deleteEmailDraft,
  hydrateEmailAttachment, renameEmailAttachment, copyEmailAttachmentToOrder, classifyAttachment, ATTACH_KIND_LABELS,
  setOrderPermit, needsSignedContract, hardDeleteOrder, setJobReferralSource,
  setOrderQuoteStatus, appendQuoteEvent,
  orderTypeLabel, orderTypeLabels,
  updateCustomer, bulkUpdateOrders,
  PERMIT_STATUS_OPTIONS, PERMIT_SELECTABLE, permitStatusLabel as sharedPermitStatusLabel,
  createPermitOutgoingPayment, listOutgoingPayments, addJobEvent,
  deleteOutgoingPayment, permitOutgoingKey,
  deriveStoneStatus, setOrderStoneStatus, listOrderingVendors, addOrderingVendor,
  PAYMENT_STATUS, DESIGN_STATUS, STONE_STATUS, FDN_STATUS, stoneStatusOptions,
  MANUAL_BLOCKER_KINDS, manualBlockerKindLabel, manualBlockerChipText, setOrderManualBlocker, missingCheckRef, dueDateTone,
  installGates, STAFF_NAMES, getJobComponents, dueRelativeText, getActiveStaffUser, createBatch,
  markApprovalLinkEmailed,
  derivePaymentStatus, deriveDesignStatus, deriveFdnStatus,
  setOrderDesignStatus, setOrderFdnStatus,
  addToFoundationList, removeFromFoundationList,
  paymentStatusTone, designStatusTone, stoneStatusTone, fdnStatusTone, contractSignedTone,
  permitStatusTone,
} from './lib/stonebooksData'
import CardQuickEdit, { CqeText, CqeArea, CqeSelect, CqeDate, CqeRow, CqeNote } from './components/CardQuickEdit'
import { orderHasBase, buildBaseSpec, buildDieSpec, composeGraveLocation, SHAPES } from './lib/monumentCatalog'
import { MonumentCard, OF_CSS } from './OrderForm'
import QuoteStatusBlock from './components/QuoteStatusBlock'
import { paymentTone, paymentLabel } from './lib/crmTheme'
import { Pill } from './lib/crmComponents.jsx'
import CustomerProfileSheet from './components/CustomerProfileSheet'
import AttachmentPreviewModal from './components/AttachmentPreviewModal'
import OrderPipelineRail from './components/OrderPipelineRail'
import { CONTRACTED_STATUSES } from './lib/leads'
import { buildPipeline } from './lib/orderPipeline'
import { phaseLabel } from './lib/jobComponents'
import { OrderProductionStatus } from './components/ProductionFloor'
import { TEAM_ROSTER } from './lib/team'
import CheckJobModal from './components/CheckJobModal.jsx'
import SalesEmailModal from './components/SalesEmailModal.jsx'

// A shop_tasks row wearing the legacy order_activity task shape, so the
// pipeline rail + activity timeline render tasks unchanged (tasks moved to
// shop_tasks — the ONE task store — on 20260715).
const taskViewRow = (t) => ({
  ...t,
  type: 'task',
  note: t.title,
  task_status: t.status === 'pending' ? 'in_progress' : t.status,
  kind: t.task_type,
  actor: t.tasked_by || t.created_by || null,
  field: t.details?.phase || null,
})
import { generateContractPDF, generateEstimatePDF, generateApprovalSheetPDF, rowToOrder, ReceiptActions, SALES_REPS, salesModeStyles, buildContractDefaults } from './SalesMode'
import ReceiptPreviewModal from './components/ReceiptPreviewModal'
import ContractEditor from './components/ContractEditor'

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
// Monument-card Stone Status — a simple ordering-stage control that REUSES the
// existing milestone-backed STONE_STATUS codes (no new status field, no collision
// with the schedule import / job milestones). 'ordered' carries a vendor.
const STONE_SIMPLE = [
  { code: 'not_ordered', label: 'Not ordered' },
  { code: 'ordered',     label: 'Ordered' },
  { code: 'in_stock',    label: 'In stock' },
]
// Paul's color contract (2026-07-10): red = not ordered, blue = ordered, green = in stock.
const STONE_SIMPLE_TONE = { not_ordered: 'red', ordered: 'blue', in_stock: 'green' }
// Piece readiness rank — the combined (job-level) status is the LEAST-ready piece.
const STONE_SIMPLE_RANK = { not_ordered: 0, ordered: 1, in_stock: 2 }
const stoneSimpleLabel = (s) => (STONE_SIMPLE.find(x => x.code === s) || {}).label || '—'
const NEW_VENDOR = '__new__'
// Does a camelCase order draft include a base? (single-source orderHasBase)
const draftHasBase = (o) => !!o && orderHasBase(o.baseConfig, SHAPES.find(s => s.code === o.shape))
// Collapse the 7-state derive into the 3 ordering choices (anything past "ordered"
// still reads as Ordered here; full production stages live on the Jobs tab).
// Bronze 'received' = physically here → In stock, so re-saving this panel can
// never silently knock a received bronze back to merely ordered (audit F3).
const stoneToSimple = (s) => s === 'not_ordered' ? 'not_ordered' : (s === 'in_stock' || s === 'received') ? 'in_stock' : 'ordered'
// Contract date → +5 months due-date autofill for new stones (same rule as the
// Orders table's inline signed handler).
const plusFiveMonthsISO = (isoDate) => {
  const [y, m, d] = String(isoDate || '').split('-').map(Number)
  if (!y || !m || !d) return null
  const dt = new Date(y, m - 1 + 5, d)
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
}
// Permit label = the shared 5-code vocabulary (legacy 'required' → "Permit Needed").
const permitStatusLabel = (s) => sharedPermitStatusLabel(s || 'unknown')
// Pill tone for the permit status (maps onto OrderDetail's Pill tones).
const permitTone = (s) => ({
  approved: 'green', submitted: 'blue', denied: 'red',
  cemetery_permit_needed: 'amber', shev_permit_needed: 'amber', required: 'amber',
  not_required: 'bronze', unknown: 'bronze',
}[s || 'unknown'] || 'bronze')

// Design status as the 6 operator-facing labels, derived from the SAME signals as
// the Design Hub four-state machine (proof_versions.sent_at/approved_at + the
// proof_approved / proof_changes_requested milestones) — a richer deriver, NOT a
// parallel enum. Reconciliation: Hub 'Approved'→approved, 'Need Revision'→revision,
// 'Need Approval'→sent, 'Due'→not_created; 'needs_sending'/'drafted' split the
// pre-send window (proof exists but not yet sent).
const DESIGN_6 = {
  not_created: 'Not created', drafted: 'Drafted', needs_sending: 'Needs sending to customer',
  sent: 'Sent to customer', approved: 'Approved', revision: 'Revision needed',
}
function deriveDesign6(job, proofVers) {
  const proof = (proofVers || []).find(p => p.is_current) || (proofVers || [])[0]
  const msDone = (k) => (job?.milestones || []).some(m => m.milestone_key === k && m.status === 'done')
  const msInProg = (k) => (job?.milestones || []).some(m => m.milestone_key === k && m.status === 'in_progress')
  if (!proof) return 'not_created'
  if (proof.approved_at || msDone('proof_approved')) return 'approved'
  if (msInProg('proof_changes_requested')) return 'revision'
  if (proof.sent_at) return 'sent'
  return proof.layout_image_url ? 'needs_sending' : 'drafted'
}

// Commit-on-blur date input (same discipline as the Orders table's InlineDateField):
// a native date input fires onChange per segment, so hold the typed value locally
// and only commit on blur / Enter with a complete, plausible year.
// Manual blocker control (status card) — Needs call / Needs email + a brief
// note, written to orders.manual_blocker. Chips echo on Orders rows + board
// cards; here it's click-to-edit with an explicit Clear.
function ManualBlockerControl({ order, onSaved }) {
  const [editing, setEditing] = useState(false)
  const [kind, setKind] = useState('needs_call')
  const [flagLabel, setFlagLabel] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const mb = order.manual_blocker || null

  const openEdit = () => {
    setKind(mb?.kind || 'needs_call')
    setFlagLabel(mb?.label || '')
    setNote(mb?.note || '')
    setErr(null)
    setEditing(true)
  }
  const save = async () => {
    if (kind === 'hold' && !note.trim()) { setErr('Type the hold reason — a hold always says why.'); return }
    setBusy(true); setErr(null)
    const r = await setOrderManualBlocker(order.id, { kind, label: flagLabel, note })
    setBusy(false)
    if (r.ok) { setEditing(false); onSaved?.() }
    else setErr(r.error || 'Could not save the blocker.')
  }
  const clear = async () => {
    setBusy(true)
    const r = await setOrderManualBlocker(order.id, null)
    setBusy(false)
    if (r.ok) { setEditing(false); onSaved?.() }
  }

  if (editing) {
    return (
      <span className="sb-od-mb-edit">
        <select value={kind} onChange={e => setKind(e.target.value)} disabled={busy} aria-label="Blocker kind"
          style={kind === 'hold' ? { color: '#B3261E', borderColor: '#B3261E', fontWeight: 700 } : undefined}>
          {MANUAL_BLOCKER_KINDS.map(k => <option key={k.code} value={k.code}>{k.label}</option>)}
        </select>
        {kind === 'custom' && (
          <input type="text" value={flagLabel} maxLength={24} disabled={busy}
            placeholder="Flag name — e.g. WAITING ON VA"
            onChange={e => setFlagLabel(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') save() }} />
        )}
        <input type="text" value={note} maxLength={80} disabled={busy}
          placeholder={kind === 'hold' ? 'Hold reason — required' : 'Brief blocker — e.g. confirm plot with sexton'}
          style={kind === 'hold' && !note.trim() ? { borderColor: '#B3261E' } : undefined}
          onChange={e => setNote(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') save() }} />
        {err && <span style={{ fontSize: 11.5, fontWeight: 600, color: '#b3261e' }}>{err}</span>}
        <span className="sb-od-mb-edit-actions">
          <button type="button" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
          <button type="button" onClick={() => setEditing(false)} disabled={busy}>Cancel</button>
          {mb && <button type="button" className="sb-od-mb-clear" onClick={clear} disabled={busy}>Clear</button>}
        </span>
      </span>
    )
  }
  if (mb) {
    return (
      <button type="button" className={`sb-od-mb-chip${mb.kind === 'hold' ? ' sb-od-mb-chip-hold' : ''}`} onClick={openEdit}
        title={`Set by ${mb.setBy || 'staff'}${mb.setAt ? ' · ' + String(mb.setAt).slice(0, 10) : ''} — click to edit`}>
        {manualBlockerChipText(mb)}{mb.note ? ` — ${mb.note}` : ''}
      </button>
    )
  }
  return <button type="button" className="sb-od-mb-add" onClick={openEdit}>+ Add blocker</button>
}

// A WAITING ON chip that tasks somebody in two clicks (Paul 2026-08-03:
// "FDN Not in → Task Paul to do foundation... SUPER EASY"). Click the red
// chip → person picker + prefilled title + optional due → Task it. Writes the
// same shop_tasks every task surface reads (addOrderTask).
function GateTaskChip({ label, taskTitle, orderId, onTasked }) {
  const [open, setOpen] = useState(false)
  const [who, setWho] = useState('')
  const [title, setTitle] = useState('')
  const [due, setDue] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const openIt = () => {
    setWho(getActiveStaffUser() || STAFF_NAMES[0] || '')
    setTitle(taskTitle)
    setDue('')
    setErr(null)
    setOpen(true)
  }
  const taskIt = async () => {
    if (!title.trim()) { setErr('Type the task.'); return }
    if (!who) { setErr('Pick who.'); return }
    setBusy(true); setErr(null)
    const actor = await getCurrentStaffName()
    const r = await addOrderTask(orderId, { note: title.trim(), assignee: who, dueDate: due || null, actor })
    setBusy(false)
    if (!r?.ok) { setErr(r?.error || 'Could not create the task.'); return }
    setOpen(false)
    onTasked?.(who)
  }
  return (
    <span className="sb-od-gate-wrap">
      <button type="button" className="sb-od-lanechip sb-od-lanechip-wait" onClick={() => (open ? setOpen(false) : openIt())}
        title="Click to task somebody about this">
        {label}
      </button>
      {open && (
        <span className="sb-od-gatepop">
          <span className="sb-od-gatepop-h">Task somebody</span>
          <select value={who} onChange={e => setWho(e.target.value)} disabled={busy} aria-label="Who">
            {STAFF_NAMES.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
          <input type="text" value={title} maxLength={140} disabled={busy}
            onChange={e => setTitle(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') taskIt() }} aria-label="Task" />
          <span className="sb-od-gatepop-row">
            <input type="date" value={due} disabled={busy} onChange={e => setDue(e.target.value)} aria-label="Due date" />
            <button type="button" className="sb-od-gatepop-go" disabled={busy} onClick={taskIt}>{busy ? 'Tasking…' : 'Task it'}</button>
            <button type="button" className="sb-od-gatepop-x" disabled={busy} onClick={() => setOpen(false)}>Cancel</button>
          </span>
          {err && <span className="sb-od-gatepop-err">{err}</span>}
        </span>
      )}
    </span>
  )
}

function ODDateField({ value, onCommit, ariaLabel, disabled, tone = null }) {
  const [local, setLocal] = useState(value || '')
  const focusedRef = useRef(false)
  useEffect(() => { if (!focusedRef.current) setLocal(value || '') }, [value])
  const commit = () => {
    focusedRef.current = false
    const v = local
    if (v === '') { if (value) onCommit(''); return }
    const [y, m, d] = v.split('-').map(Number)
    if (!y || !m || !d || y < 1900 || y > 2200) { setLocal(value || ''); return }
    if (v !== (value || '')) onCommit(v)
  }
  return (
    <input type="date" className={`sb-od-sc-date${tone ? ` sb-od-due-${tone}` : ''}`} value={local} disabled={disabled}
      onFocus={() => { focusedRef.current = true }}
      onChange={e => setLocal(e.target.value)}
      onBlur={commit}
      onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }}
      aria-label={ariaLabel} />
  )
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

function Section({ title, span = 1, id, children, headerAction }) {
  return (
    <section id={id} className={`sb-od-card sb-od-span-${span}`}>
      <div className="sb-od-card-eyebrow-row">
        <div className="sb-od-card-eyebrow">{title}</div>
        {headerAction && <div className="sb-od-card-action">{headerAction}</div>}
      </div>
      <div className="sb-od-card-body">{children}</div>
    </section>
  )
}

// Left-rail section nav. Smooth-scrolls to a section by id; no URL hash change.
function SectionRail({ items }) {
  const jump = (id) => {
    const el = typeof document !== 'undefined' && document.getElementById(id)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
  return (
    <nav className="sb-od-rail" aria-label="Order sections">
      {items.map(it => (
        <button key={it.id} type="button" className="sb-od-rail-item" onClick={() => jump(it.id)}>
          <span>{it.label}</span>
        </button>
      ))}
    </nav>
  )
}

// =============================================================================
// MAIN
// =============================================================================
export default function OrderDetail({ orderId, onBack, backLabel = 'Orders', onEditInSales, onEditInSalesPortal, onOpenJob, onOpenCustomer, onOpenHub, initialAction = null, onConsumeInitialAction }) {
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
  // Add appointment (Paul 2026-08-03) — writes a calendar 'appointment'
  // work_batch linked to this order; Today's log + the Calendar read the same row.
  const [apptModal, setApptModal] = useState(null)    // { who, date, time, what, busy, err } | null
  const [lastReceiptPayment, setLastReceiptPayment] = useState(null)  // just-saved payment → post-save receipt offer
  const [receiptPreview, setReceiptPreview] = useState(null)          // { payment } → click-to-preview modal
  const [editPay, setEditPay] = useState(null)        // { id, amount, method, receivedAt, ref } inline editor
  const [payRowBusy, setPayRowBusy] = useState(null)  // payment id mid edit/void
  const [payRowErr, setPayRowErr] = useState(null)
  // Customer Profile sheet
  const [profileOpen, setProfileOpen] = useState(false)
  // D2 — permanent delete (archived only)
  const [deleteModal, setDeleteModal] = useState(false)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteErr, setDeleteErr] = useState(null)
  // Approval packet preview
  const [approvalSheet, setApprovalSheet] = useState(null)  // { url, doc, filename, version } | null
  const [contractEd, setContractEd] = useState(null)        // ContractEditor props bundle | null
  // In-app attachment preview (#3) — { url, name, mime, isBlob } | null
  const [preview, setPreview] = useState(null)
  // Attachment delete confirm (#A) — { path, name } | null
  const [delAttach, setDelAttach] = useState(null)
  const [delAttachBusy, setDelAttachBusy] = useState(false)
  // Pipeline rail task-remove confirm (× with confirm)
  const [delTask, setDelTask] = useState(null)   // shop_tasks task row (legacy view) | null
  const [checkJobOpen, setCheckJobOpen] = useState(false)   // check-job modal (site inspection task)
  // SalesEmailModal door: null | { mode: 'contract'|'sales', draft?: row }
  const [salesEmailMode, setSalesEmailMode] = useState(null)
  // Parked emails on this order (email_drafts) — view / edit / send / delete.
  const [emailDrafts, setEmailDrafts] = useState([])
  const refreshDrafts = () => { listEmailDrafts(orderId).then(setEmailDrafts).catch(() => {}) }
  useEffect(() => { refreshDrafts() }, [orderId])   // eslint-disable-line react-hooks/exhaustive-deps
  // The design change-request loop: what the family (or staff) asked to change
  // + staff replies, chronological. Refetched whenever approvalLinks refreshes.
  const [designThread, setDesignThread] = useState([])
  // Signed contract (#C)
  const [signedContract, setSignedContract] = useState(null)   // { path, signedAt } | null
  const [signedApproval, setSignedApproval] = useState(null)   // { path, signedAt } | null (Phase 3)
  const [approvalOverride, setApprovalOverride] = useState(null)  // { reason, busy, error } | null
  // Remote approval links (Phase 4)
  const [approvalLinks, setApprovalLinks] = useState([])
  const [sendBusy, setSendBusy] = useState(false)
  const [sentLink, setSentLink] = useState(null)
  const [signModal, setSignModal] = useState(null)             // { file, busy, error } | null
  const [overrideModal, setOverrideModal] = useState(null)     // { reason, busy, error } | null
  // Permit editor
  // Card quick-edit drafts (three-dot popovers). Seeded on open, written on save.
  const [custDraft, setCustDraft] = useState(null)
  const [cgDraft, setCgDraft] = useState(null)          // Cemetery & Grave (grave fields only)
  const [permitDraft, setPermitDraft] = useState(null)  // Permit card (the ONE permit editor)
  const [feeDraft, setFeeDraft] = useState({ amount: '', payee: '', ck: '', date: todayISO(), method: 'check' })
  const [permitExpenses, setPermitExpenses] = useState([])  // outgoing_payments (Permits) for this order
  const [feeBusy, setFeeBusy] = useState(false)
  const [feeMsg, setFeeMsg] = useState(null)
  const [monDraft, setMonDraft] = useState(null)        // camel order copy for the reused MonumentCard
  const [stoneDraft, setStoneDraft] = useState(null)    // { status, vendor } — reuses milestone STONE_STATUS
  const [vendorList, setVendorList] = useState([])      // ordering_vendors (persistent stone suppliers)
  const [designNotesDraft, setDesignNotesDraft] = useState('')   // internal design notes (current proof)
  const [emailLinkMsg, setEmailLinkMsg] = useState(null)
  const [payDraft, setPayDraft] = useState(null)        // quick add-payment (Financial card ⋯)
  // Activity log (#4)
  const [activity, setActivity] = useState([])
  // shop_tasks rows for this order, wearing the legacy order_activity task
  // shape (note / task_status / kind / field) so the rail + timeline render
  // unchanged. Tasks live in shop_tasks since 20260715 — the ONE task store.
  const [orderTasks, setOrderTasks] = useState([])
  const [actNote, setActNote] = useState('')
  const [taskForm, setTaskForm] = useState({ note: '', assignee: '', dueDate: '', kind: 'general' })
  const [actBusy, setActBusy] = useState(false)
  const [actOpen, setActOpen] = useState(null)   // 'activity' | 'task' | null

  // loading inits true; OrderDetail mounts fresh per selected order (OrdersTab
  // conditionally renders it), so the effect fires once — no synchronous
  // setState in the body (avoids the React 19 set-state-in-effect lint).
  useEffect(() => {
    let cancelled = false
    getOrderById(orderId).then(async (o) => {
      if (cancelled) return
      if (!o) { setErr('Order not found.'); setLoading(false); return }
      let j = await getJobByOrderId(orderId)
      if (cancelled) return
      // Self-heal (Paul, 2026-07-14 — Yager E-26-0316): a SIGNED order must
      // have a job. Inline signing used to stamp signed_at without creating
      // one; opening the order now fixes it on the spot (idempotent).
      if (o?.signed_at && !j) {
        const jr = await createJobFromOrder(orderId, { source: 'auto_heal_signed' })
        if (jr.ok) j = jr.job
        if (cancelled) return
      }
      setOrder(o); setJob(j); setLoading(false)
      // Secondary loads (notes + attachment sources + emails + outgoing permit
      // expenses) — non-blocking. Email is the CUSTOMER's full thread (same shown in
      // every order of theirs), keyed by the order's customer_id.
      const [nts, ups, pvs, ems, cps, acts, tks, sc, sa, al, outp] = await Promise.all([
        getOrderNotes(orderId),
        listOrderAttachments(orderId),
        // Layouts live in TWO scopes: job-scoped proof versions AND
        // order-scoped ones (Design Hub estimate uploads — which happen even
        // on orders that already carry a job, e.g. Garcia 2026-07-20). Load
        // BOTH; job-scoped first so is_current resolution prefers the job's
        // stack.
        j?.id
          ? Promise.all([getProofVersions(j.id), getProofVersionsByOrder(orderId)])
              .then(([a, b]) => [...(a || []), ...(b || [])])
          : getProofVersionsByOrder(orderId),
        (o.customer_id || o.id) ? getMessageThread({ customerId: o.customer_id, orderId: o.id }).then(r => r.messages || []) : Promise.resolve([]),
        listCompletionPhotos(orderId),
        getOrderActivity(orderId),
        listShopTasksForOrder(orderId),
        getSignedContract(orderId),
        getApprovalSigned(orderId),
        getApprovalLinksForOrder(orderId),
        listOutgoingPayments(),
      ])
      if (cancelled) return
      setNotes(nts); setUploads(ups); setProofVers(pvs); setEmails(ems); setCompletionPhotos(cps); setActivity(acts); setOrderTasks((tks || []).map(taskViewRow)); setSignedContract(sc); setSignedApproval(sa); setApprovalLinks(al)
      setPermitExpenses((outp || []).filter(p => p.order_id === orderId && (p.category || '').toLowerCase() === 'permits'))
      // Inject order-content-derived milestones on load (idempotent). If the set
      // changed, re-fetch the job so the rail shows the live milestones.
      if (j?.id) {
        const dr = await ensureDerivedMilestones(orderId, { order: o, job: j })
        if (!cancelled && dr?.ok && (dr.inserted || dr.removed)) {
          const j2 = await getJobByOrderId(orderId)
          if (!cancelled) setJob(j2)
        }
      }
    }).catch(e => { if (!cancelled) { setErr(e?.message || 'Failed to load order'); setLoading(false) } })
    return () => { cancelled = true }
  }, [orderId])

  // Deep-link action — e.g. the Payments tab's "Contact" opens the email
  // composer once the order has loaded (fires once, then consumes the flag).
  const initialActionRef = useRef(false)
  useEffect(() => {
    if (initialAction === 'email' && order && !initialActionRef.current) {
      initialActionRef.current = true
      setEmailModal({ to: order?.customer?.email || '', subject: '', body: '', busy: false, error: null, sent: false })
      onConsumeInitialAction?.()
    }
    // Design Hub deep-link — land ON the Design/proof card, not the page top.
    if (initialAction === 'design' && order && !initialActionRef.current) {
      initialActionRef.current = true
      requestAnimationFrame(() => document.getElementById('od-design')?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
      onConsumeInitialAction?.()
    }
  }, [initialAction, order, onConsumeInitialAction])

  // Change-request thread (customer notes from approval links + internal
  // revision events + staff replies). approvalLinks in the deps so a fresh
  // rejection surfaces as soon as the links refresh.
  useEffect(() => {
    let alive = true
    getChangeRequestThread({ orderId, jobId: job?.id || null })
      .then(t => { if (alive) setDesignThread(t || []) })
      .catch(() => { /* thread is additive — the card still works without it */ })
    return () => { alive = false }
  }, [orderId, job?.id, approvalLinks])

  const refreshNotes = async () => setNotes(await getOrderNotes(orderId))
  const refreshUploads = async () => setUploads(await listOrderAttachments(orderId))

  // ── Email attachment history (Email traffic → Attachments tab) ────────────
  const [emailView, setEmailView] = useState('emails')   // 'emails' | 'attachments'
  const [emailViewer, setEmailViewer] = useState(null)    // full-message popup viewer
  const [attBusyKey, setAttBusyKey] = useState(null)      // `${messageId}:${idx}` while fetching/copying
  const [attRename, setAttRename] = useState(null)        // { key, value } inline rename
  const [attNote, setAttNote] = useState(null)            // { key, text, ok } per-card status
  const hydrateTried = useRef(new Set())

  // Every attachment across the customer's thread, newest first.
  const emailAttachments = useMemo(() => {
    const out = []
    for (const em of emails) {
      (em.attachments || []).forEach((a, i) => out.push({
        key: `${em.id}:${i}`, messageId: em.id, idx: i,
        direction: em.direction, date: em.date, subject: em.subject, ...a,
      }))
    }
    out.sort((a, b) => (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0))
    return out
  }, [emails])

  // Write a hydration/rename patch back into the loaded thread state.
  const patchEmailAtt = (a, patch) => setEmails(ems => ems.map(m => (m.id === a.messageId
    ? { ...m, attachments: (m.attachments || []).map((x, j) => (j === a.idx ? { ...x, ...patch } : x)) }
    : m)))

  // Opening the Attachments tab hydrates any not-yet-cached files from Gmail in
  // the background (sequential, capped per visit; failures aren't retried in a loop).
  useEffect(() => {
    if (emailView !== 'attachments') return
    const pending = emailAttachments.filter(a => !a.url && !hydrateTried.current.has(a.key)).slice(0, 8)
    if (!pending.length) return undefined
    let cancelled = false
    ;(async () => {
      for (const a of pending) {
        if (cancelled) return
        hydrateTried.current.add(a.key)
        const r = await hydrateEmailAttachment({ messageId: a.messageId, idx: a.idx })
        if (cancelled) return
        if (r.ok) patchEmailAtt(a, { path: r.path, url: r.url })
      }
    })()
    return () => { cancelled = true }
  }, [emailView, emailAttachments])   // eslint-disable-line react-hooks/exhaustive-deps

  const previewEmailAttachment = async (a) => {
    const name = a.displayName || a.filename || 'Attachment'
    if (a.url) { openPreview(name, a.url, a.contentType || '', false); return }
    setAttBusyKey(a.key)
    const r = await hydrateEmailAttachment({ messageId: a.messageId, idx: a.idx })
    setAttBusyKey(null)
    if (!r.ok) { setAttNote({ key: a.key, text: r.error || 'Could not fetch', ok: false }); return }
    patchEmailAtt(a, { path: r.path, url: r.url })
    openPreview(name, r.url, a.contentType || '', false)
  }
  const saveAttRename = async () => {
    if (!attRename) return
    const a = emailAttachments.find(x => x.key === attRename.key)
    setAttRename(null)
    if (!a) return
    const r = await renameEmailAttachment({ messageId: a.messageId, idx: a.idx, displayName: attRename.value })
    if (r.ok) patchEmailAtt(a, { displayName: (attRename.value || '').trim() || null })
    else setAttNote({ key: a.key, text: r.error || 'Rename failed', ok: false })
  }
  const copyAttToOrder = async (a) => {
    setAttBusyKey(a.key)
    const r = await copyEmailAttachmentToOrder({ messageId: a.messageId, idx: a.idx, orderId })
    setAttBusyKey(null)
    setAttNote({ key: a.key, text: r.ok ? 'Added to order files' : (r.error || 'Copy failed'), ok: r.ok })
    if (r.ok) refreshUploads()
  }
  const refreshOrder = async () => { const o = await getOrderById(orderId); if (o) setOrder(o) }
  const refreshActivity = async () => {
    const [acts, tks] = await Promise.all([getOrderActivity(orderId), listShopTasksForOrder(orderId)])
    setActivity(acts)
    setOrderTasks((tks || []).map(taskViewRow))
  }
  const refreshJob = async () => { const j = await getJobByOrderId(orderId); setJob(j) }

  // ── Inline status setters (status overview card + Design/Proof card) ────────
  // SAME write paths as the Orders table dropdowns — Payment/Permit/Contract are
  // order columns, Design/Stone/FDN flip the job milestone ladder — so the two
  // surfaces can never disagree.
  const inlinePayment = async (code) => {
    const r = await bulkUpdateOrders([orderId], { payment_status: code })
    if (r.ok) await refreshOrder()
  }
  // No job yet doesn't block a status edit — the first set quietly creates the
  // job (allowUnsigned) and applies to it (Paul, 2026-07-14).
  const ensureJobId = async () => {
    if (job?.id) return job.id
    // LEADS never auto-create jobs (audit A3) — see OrdersTab.ensureJobForStatus.
    const isLead = !order?.signed_at && !(CONTRACTED_STATUSES.includes(order?.status) && rowTotalPaid(order) > 0)
    if (isLead) {
      setActionNote('Still a lead — statuses activate once there’s a signed contract or a deposit.')
      return null
    }
    const jr = await createJobFromOrder(orderId, { source: 'order_detail_status', allowUnsigned: true })
    if (!jr.ok) { setActionNote(`Could not create the job — ${jr.error}.`); return null }
    return jr.job?.id || null
  }
  const inlineDesign = async (code) => {
    const jid = await ensureJobId()
    if (!jid) return
    const r = await setOrderDesignStatus(jid, code)
    if (r.ok) await refreshJob()
  }
  const inlineStone = async (code) => {
    const jid = await ensureJobId()
    if (!jid) return
    const r = await setOrderStoneStatus(jid, code)
    if (r.ok) await refreshJob()
  }
  const inlineFdn = async (code) => {
    const jid = await ensureJobId()
    if (!jid) return
    const r = await setOrderFdnStatus(jid, code)
    if (r.ok) await refreshJob()
  }
  // Who pours the foundation (Paul 2026-07-21) — most permits ARE for a
  // cemetery foundation. 'Our Foundation'/'Strip' = Shevco pours it → the job
  // goes ONTO the shevco foundation work list (foundation_list) and stays in
  // the Foundations board pool; 'Cemetery Foundation' takes it off both.
  const _permitTaskLabel = () => `${order?.primary_lastname || customerName(order?.customer) || 'order'}${order?.order_number ? ` (${order.order_number})` : ''}`
  // Permit form — which blank this order's permit uses. Picking the Shevco
  // form auto-tasks Admin to build it in Permit Builder (Paul 2026-07-22).
  const savePermitForm = async (v) => {
    const val = v || null
    const r = await setOrderPermit(orderId, { permit_form: val })
    if (!r.ok) return
    await refreshOrder()
    const staff = await getCurrentStaffName()
    logOrderActivity(orderId, {
      type: 'change', field: 'Permit form',
      newValue: val === 'shevco' ? 'Shevco permit (our form)' : (val === 'cemetery' ? "Cemetery's own form" : '—'),
      note: val === 'shevco' ? 'Shevco form — Admin tasked to build it in Permit Builder' : null,
      actor: staff,
    }).then(() => refreshActivity()).catch(() => {})
    if (val === 'shevco') {
      ensurePermitBuildTask(orderId, 'Shevco permit', _permitTaskLabel())
        .then(rr => { if (rr?.ok && !rr.skipped) refreshActivity() }).catch(() => {})
    }
  }
  const saveFoundationBy = async (v) => {
    const val = v || null
    const r = await setOrderPermit(orderId, { foundation_type: val })
    if (!r.ok) return
    const jid = job?.id || null
    if (jid) {
      if (val === 'Our Foundation' || val === 'Strip') await addToFoundationList(jid)
      else if (val === 'Cemetery Foundation') await removeFromFoundationList(jid)
    }
    // Shevco foundation selected → auto-task Admin to build the Shevco
    // foundation permit in Permit Builder (Paul 2026-07-22).
    if (val === 'Our Foundation' || val === 'Strip') {
      ensurePermitBuildTask(orderId, 'Shevco foundation permit', _permitTaskLabel())
        .then(r => { if (r?.ok && !r.skipped) refreshActivity() }).catch(() => {})
    }
    await refreshOrder()
    const staff = await getCurrentStaffName()
    logOrderActivity(orderId, {
      type: 'change', field: 'Foundation by', newValue: val || '—',
      note: val === 'Cemetery Foundation' ? 'Cemetery pours the foundation'
        : (val ? 'Shevco foundation — routed to the foundation list' : null),
      actor: staff,
    }).then(() => refreshActivity()).catch(() => {})
  }
  const inlinePermit = async (code) => {
    const today = todayISO()
    const patch = { permit_status: code }
    if (code === 'submitted' && !order.permit_filed_at) patch.permit_filed_at = today
    if (code === 'approved' && !order.permit_approved_at) patch.permit_approved_at = today
    const prev = order.permit_status || 'unknown'
    const r = await setOrderPermit(orderId, patch)
    if (!r.ok) return
    await refreshOrder()
    logOrderActivity(orderId, { type: 'change', field: 'Permit status', oldValue: permitStatusLabel(prev), newValue: permitStatusLabel(code), note: 'Permit status changed', actor: await getCurrentStaffName() }).then(() => refreshActivity()).catch(() => {})
  }
  const isNewStoneOrder = (order?.service_types || []).includes('NEW_STONE')
  const inlineSigned = async (signed) => {
    const patch = {}
    if (signed) {
      const d = order.signed_at ? String(order.signed_at).slice(0, 10) : todayISO()
      patch.signed_at = `${d}T00:00:00`
      if (['draft', 'scoping', 'quoted'].includes(order.status)) patch.status = 'contracted'
      if (isNewStoneOrder && !order.target_completion_date) { const due = plusFiveMonthsISO(d); if (due) patch.target_completion_date = due }
    } else {
      patch.signed_at = null
    }
    const r = await bulkUpdateOrders([orderId], patch)
    if (r.ok) {
      await refreshOrder()
      // Signing guarantees the job exists (idempotent — the wizard's rule,
      // now enforced on the inline toggle too).
      if (signed && !job?.id) { await createJobFromOrder(orderId, { source: 'inline_signed' }); await refreshJob() }
    }
  }
  const inlineDateField = async (field, value) => {
    const patch = {}
    if (field === 'signed_at') {
      patch.signed_at = value ? `${value}T00:00:00` : null
      if (value && isNewStoneOrder && !order.target_completion_date) {
        const due = plusFiveMonthsISO(value)
        if (due) patch.target_completion_date = due
      }
    } else {
      patch.target_completion_date = value || null
    }
    const r = await bulkUpdateOrders([orderId], patch)
    if (r.ok) {
      await refreshOrder()
      if (field === 'signed_at' && value && !job?.id) { await createJobFromOrder(orderId, { source: 'inline_signed' }); await refreshJob() }
    }
  }

  // ── Status Overview v2 (Paul 2026-08-03) — the floor position chip reads the
  // order's own job_components (same rows the boards move). Light fetch, and
  // the Production status card below has its own refresh for deep work.
  const [floorComps, setFloorComps] = useState(null)
  useEffect(() => {
    let cancelled = false
    getJobComponents({ orderId }).then(r => { if (!cancelled) setFloorComps(r || []) }).catch(() => { if (!cancelled) setFloorComps([]) })
    return () => { cancelled = true }
  }, [orderId])
  // Which phase pill is peeked open (click SALES/ADMIN/… → that group's steps).
  const [phasePeek, setPhasePeek] = useState(null)

  // ── Pipeline rail handlers ──────────────────────────────────────────────────
  const milestoneStatusLabel = (s) => s === 'done' ? 'Done' : s === 'in_progress' ? 'In progress' : s === 'blocked' ? 'Blocked' : s === 'not_needed' ? 'Removed (not needed)' : 'Not started'

  // Tap a rail milestone → real updateMilestone path (auto-overrides readiness
  // gating frictionlessly) + order_activity log so the order timeline reflects it.
  const handleRailMilestone = async (key, status) => {
    if (!job?.id) return
    const prev = (job.milestones || []).find(m => m.milestone_key === key)
    const label = prev?.label || key
    let res = await updateMilestone(job.id, key, { status })
    if (!res.ok && res.requiresOverride) {
      res = await updateMilestoneWithOverride(job.id, key, { status }, 'Set from order pipeline rail')
    }
    if (!res.ok) { setActionNote(`Could not update ${label} — ${res.error || 'blocked'}.`); return }
    // CASCADE (Paul 2026-08-03): marking a later step done backfills every
    // earlier not-done step in the SAME group — "layout approved by customer
    // automatically means layout created." Forward only; unchecking never
    // cascades. Best-effort per step so one hiccup doesn't strand the rest.
    let autoCount = 0
    if (status === 'done' && prev) {
      const earlier = (job.milestones || []).filter(m =>
        m.group === prev.group && m.milestone_key !== key
        && (m.sort_order ?? 0) < (prev.sort_order ?? 0)
        && m.status !== 'done' && m.status !== 'not_needed')
      for (const m of earlier) {
        let r = await updateMilestone(job.id, m.milestone_key, { status: 'done' })
        if (!r.ok && r.requiresOverride) {
          r = await updateMilestoneWithOverride(job.id, m.milestone_key, { status: 'done' }, `Auto — implied by ${label}`)
        }
        if (r.ok) autoCount++
      }
    }
    await logOrderActivity(orderId, {
      type: 'change', field: 'Milestone',
      oldValue: milestoneStatusLabel(prev?.status), newValue: milestoneStatusLabel(status),
      note: `${label}: ${milestoneStatusLabel(prev?.status)} → ${milestoneStatusLabel(status)}${autoCount ? ` (+${autoCount} earlier step${autoCount === 1 ? '' : 's'} auto-completed)` : ''}`,
      actor: await getCurrentStaffName(),
    })
    await refreshJob(); refreshActivity()
  }

  const handleOpenPhase = (phaseCode) => {
    if (phaseCode === 'sales') { onEditInSalesPortal?.(orderId); return }
    if (onOpenHub) { onOpenHub(phaseCode, job?.id || null); return }
    if (job?.id) onOpenJob?.(job.id)
    else setActionNote('No production job yet for this order — it’s created when the order is signed.')
  }

  const handleAddRailTask = async (phase, text) => {
    const actor = await getCurrentStaffName()
    await addOrderTask(orderId, { note: text, actor, phase })
    refreshActivity()
  }

  const confirmRemoveTask = async () => {
    if (!delTask) return
    await deleteShopTask(delTask.id, await getCurrentStaffName())
    setDelTask(null)
    refreshActivity()
  }

  // Rail task status (done / in_progress / open). Mirrors toggleTask's layout-
  // signal sync so a Layout task behaves the same from either surface.
  const handleRailTaskStatus = async (tk, status) => {
    await setOrderTaskStatus(tk.id, status)
    if (tk.kind === 'layout') {
      if (status === 'done') {
        const otherOpenLayout = orderTasks.some(t => t.id !== tk.id && t.kind === 'layout' && t.task_status !== 'done')
        if (!otherOpenLayout && order?.waiting_on === 'reviewing_layout') await updateOrderLeadFields(orderId, { waiting_on: null })
      } else {
        await updateOrderLeadFields(orderId, { waiting_on: 'reviewing_layout' })
      }
    }
    refreshActivity()
  }

  const pipelineTasks = orderTasks

  // Complete & close (Paul, 2026-07-08) — the override door under the pipeline.
  // No matter what's still unchecked: the job leaves every work queue and the
  // order goes terminal. Job status is 'closed' — the ONLY terminal code the
  // jobs_overall_status_check DB constraint accepts ('completed' was never a
  // valid code; the button silently failed on it since it shipped — found
  // 2026-07-15, every job in prod was still 'active').
  const [closeArm, setCloseArm] = useState(false)
  const [closeBusy, setCloseBusy] = useState(false)
  const [closeErr, setCloseErr] = useState(null)   // rendered INLINE at the button, not just the top-of-page note
  // Quick family-name edit on the header (Paul, 2026-07-08) — state lives up
  // here with the other hooks (the loading/error returns come later).
  const [famEdit, setFamEdit] = useState(null)   // null closed | string draft
  const [famBusy, setFamBusy] = useState(false)
  const completeAndClose = async () => {
    if (closeBusy) return
    setCloseBusy(true); setActionNote(null); setCloseErr(null)
    const actor = await getCurrentStaffName()
    if (job?.id) {
      const jr = await setJobOverallStatus(job.id, 'closed', 'Completed & closed from the order pipeline (remaining milestones overridden)')
      if (!jr.ok) { setCloseBusy(false); setCloseArm(false); setCloseErr(`Could not complete the job — ${jr.error}.`); return }
    }
    const r = await closeOrder(orderId)
    if (!r.ok) { setCloseBusy(false); setCloseArm(false); setCloseErr(`Could not close the order — ${r.error}.`); return }
    await logOrderActivity(orderId, {
      type: 'change', field: 'Status', newValue: 'Closed',
      note: 'Order completed & closed — job removed from work queues (unfinished items overridden)',
      actor,
    })
    setOrder(o => (o ? { ...o, status: 'closed' } : o))
    await refreshJob(); refreshActivity()
    setCloseBusy(false); setCloseArm(false)
    setActionNote('Order completed & closed — off the work queues. ✓')
  }

  // ── Activity log (#4) handlers ──────────────────────────────────────────────
  const handleAddActivity = async () => {
    const note = actNote.trim()
    if (!note || actBusy) return
    setActBusy(true)
    const actor = await getCurrentStaffName()
    await addOrderActivityNote(orderId, note, actor)
    setActBusy(false); setActNote(''); setActOpen(null)
    refreshActivity()
  }
  const handleAddTask = async () => {
    const note = taskForm.note.trim()
    if (!note || actBusy) return
    setActBusy(true)
    const actor = await getCurrentStaffName()
    const layout = taskForm.kind === 'layout'
    await addOrderTask(orderId, { note, assignee: taskForm.assignee || null, dueDate: taskForm.dueDate || null, actor, kind: layout ? 'layout' : null })
    // A Layout task sets the structured Design signal (reuses the lead-fields path).
    if (layout) await updateOrderLeadFields(orderId, { waiting_on: 'reviewing_layout' })
    setActBusy(false); setTaskForm({ note: '', assignee: '', dueDate: '', kind: 'general' }); setActOpen(null)
    refreshActivity()
  }
  const toggleTask = async (a) => {
    const becomingDone = a.task_status !== 'done'
    await setOrderTaskStatus(a.id, becomingDone ? 'done' : 'open')
    // Keep the structured layout signal in sync: completing the last open Layout
    // task clears waiting_on (only if it was 'reviewing_layout' — never stomp a
    // manual value); re-opening a Layout task restores it. Reuses the lead-fields path.
    if (a.kind === 'layout') {
      if (becomingDone) {
        const otherOpenLayout = orderTasks.some(t => t.id !== a.id && t.kind === 'layout' && t.task_status !== 'done')
        if (!otherOpenLayout && order?.waiting_on === 'reviewing_layout') await updateOrderLeadFields(orderId, { waiting_on: null })
      } else {
        await updateOrderLeadFields(orderId, { waiting_on: 'reviewing_layout' })
      }
    }
    refreshActivity()
  }

  // ── Attachment delete (#A) ──────────────────────────────────────────────────
  const confirmDeleteAttachment = async () => {
    if (!delAttach || delAttachBusy) return
    setDelAttachBusy(true)
    const res = await deleteOrderAttachment(delAttach.path)
    setDelAttachBusy(false)
    if (!res.ok) { setActionNote(`Could not delete attachment — ${res.error}.`); return }
    const name = delAttach.name
    setDelAttach(null)
    await refreshUploads()
    await logOrderActivity(orderId, { type: 'activity', note: `Attachment deleted: ${name}`, actor: await getCurrentStaffName() })
    refreshActivity()
  }

  // ── Signed approval packet (Phase 3) — pinned, preview via signed URL, override-only.
  const refreshApprovalSigned = async () => setSignedApproval(await getApprovalSigned(orderId))
  const previewSignedApproval = async () => {
    const r = await approvalSignedFileUrl(orderId)
    if (!r.ok) { setActionNote(`Could not open signed approval — ${r.error}.`); return }
    openPreview('Approval (signed).pdf', r.url, 'application/pdf', false)
  }
  const refreshApprovalLinks = async () => setApprovalLinks(await getApprovalLinksForOrder(orderId))

  // Upload a proof image (bronze plaque layout, monument layout, anything the
  // customer signs off on) RIGHT HERE on the order — no Design Hub detour
  // (Paul, 2026-07-08, bronze approval). Becomes the next proof version.
  const proofFileRef = useRef(null)
  const [proofUpBusy, setProofUpBusy] = useState(false)
  const [proofDragOver, setProofDragOver] = useState(false)
  const uploadProofImageFile = async (file) => {
    if (!file) return
    if (!job?.id) { setActionNote('No production job yet — sign the order first (proof versions live on the job).'); return }
    setProofUpBusy(true); setActionNote(null)
    const who = await getCurrentStaffName()
    const up = await uploadProofLayout(job.id, file)
    if (!up.ok) { setProofUpBusy(false); setActionNote(`Upload failed — ${up.error}.`); return }
    const { error } = await createProofVersion({ jobId: job.id, layoutImageUrl: up.url, uploadedBy: who })
    if (error) { setProofUpBusy(false); setActionNote(`Could not create the proof version — ${error.message}.`); return }
    // A layout now exists → the design status must not read "Not created"
    // (Paul, 2026-07-20). Only ever stamps UP from not_created — an order
    // already sent/approved is never dragged backwards by a re-upload.
    if (deriveDesignStatus(job) === 'not_created') {
      await setOrderDesignStatus(job.id, 'layout_created').catch(() => {})
      await refreshJob?.()
    }
    await refreshProofs()
    setProofUpBusy(false)
    setActionNote('Proof uploaded. Send it for approval, or Mark approved if the family already signed off.')
    logOrderActivity(orderId, { type: 'change', field: 'Proof', newValue: 'uploaded', note: 'Proof image uploaded from the order (bronze/layout)', actor: who }).then(() => refreshActivity()).catch(() => {})
  }
  const onPickProofImage = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    await uploadProofImageFile(file)
  }
  const onDropProofImage = async (e) => {
    e.preventDefault(); setProofDragOver(false)
    const file = [...(e.dataTransfer?.files || [])].find(f => /^image\//.test(f.type))
    if (!file) { setActionNote('Drop an image file (JPG / PNG / WebP).'); return }
    await uploadProofImageFile(file)
  }
  // Mark the current proof approved WITHOUT the customer-link round-trip — for
  // layouts the family already approved on paper / in person (Paul, 2026-07-10).
  const markProofApproved = async () => {
    const v = proofVers.find(p => p.is_current) || proofVers[0]
    if (!v) { setActionNote('No proof to approve — upload a layout first.'); return }
    const staff = await getCurrentStaffName()
    const r = await updateProofVersion(v.id, { approved_at: new Date().toISOString(), approved_by_name: staff })
    if (!r.ok) { setActionNote(`Could not mark approved — ${r.error}.`); return }
    if (job?.id) await setOrderDesignStatus(job.id, 'layout_approved')
    await refreshProofs(); await refreshJob()
    setActionNote(`Proof v${v.version_number} marked approved.`)
    logOrderActivity(orderId, { type: 'change', field: 'Design status', newValue: 'Layout approved', note: `Proof v${v.version_number} marked approved from the order (no customer link)`, actor: staff }).then(() => refreshActivity()).catch(() => {})
  }

  // Generate the UNSIGNED packet client-side + create a token link (server-side).
  const handleSendForApproval = async () => {
    const v = proofVers.find(p => p.is_current) || proofVers[0]
    if (!v) { setActionNote('No proof to send — add a layout in the Design Hub first.'); return }
    setSendBusy(true); setActionNote(null); setSentLink(null)
    try {
      const isImg = (s) => /\.(jpe?g|png|webp|gif|avif|bmp|svg)(\?|#|$)/i.test(String(s || ''))
      const fallbackImageUrl = proofVers.find(p => p.layout_image_url)?.layout_image_url
        || uploads.find(u => isImg(u.url) || isImg(u.name) || isImg(u.path))?.url
        || completionPhotos[0]?.url || null
      const { doc, sigRect } = await generateApprovalSheetPDF(v, { order, balance: rowBalanceDue(order), fallbackImageUrl, returnDoc: true })
      const pdfBase64 = doc.output('datauristring').split(',')[1]
      const res = await createApprovalLink({ orderId, proofVersionId: v.id, pdfBase64, sigFieldRects: sigRect })
      setSendBusy(false)
      if (!res.ok) { setActionNote(`Could not create approval link — ${res.error}`); return }
      setSentLink(res.url)
      const _staff = await getCurrentStaffName()
      // HONEST log: creating the link emails NOBODY (the old 'sent' wording
      // made it look like a silent send — Paul, 2026-07-14). The composer
      // below is where the actual email happens, previewed and editable.
      await logOrderActivity(orderId, { type: 'change', field: 'Approval link', newValue: 'created', note: 'Approval link created — email composer opened (nothing sent yet)', actor: _staff })
      refreshApprovalLinks(); refreshActivity()
      const _cust = order.customer || {}
      const surname = order.primary_lastname || _cust.last_name || 'your'
      setEmailModal({
        to: _cust.email || '',
        subject: `Layout approval — ${surname}`,
        body: `Hello,\n\nYour design is ready for your review and approval. Please open the link below, review it, and approve it (or request changes):\n\n${res.url}\n\nThank you,\nShevchenko Monuments\n732-442-1286`,
        approvalLinkId: res.linkId || null,
        busy: false, error: null, sent: false,
      })
    } catch (e) {
      setSendBusy(false); setActionNote(`Could not create approval link — ${e?.message || 'error'}`)
    }
  }
  const handleRevokeLink = async (linkId) => {
    const res = await revokeApprovalLink(linkId)
    if (!res.ok) { setActionNote(`Could not revoke — ${res.error}`); return }
    if (sentLink) setSentLink(null)
    await logOrderActivity(orderId, { type: 'change', field: 'Approval link', newValue: 'revoked', note: 'Approval link revoked', actor: await getCurrentStaffName() })
    refreshApprovalLinks(); refreshActivity()
  }
  const handleOverrideApproval = async () => {
    if (!approvalOverride || approvalOverride.busy) return
    const reason = (approvalOverride.reason || '').trim()
    if (!reason) { setApprovalOverride(m => ({ ...m, error: 'A reason is required.' })); return }
    setApprovalOverride(m => ({ ...m, busy: true, error: null }))
    const res = await removeApprovalSigned(orderId)
    if (!res.ok) { setApprovalOverride(m => ({ ...m, busy: false, error: res.error })); return }
    setApprovalOverride(null)
    await refreshApprovalSigned()
    await logOrderActivity(orderId, {
      type: 'change', field: 'Signed approval', oldValue: 'signed', newValue: 'overridden',
      note: `Signed approval overridden: ${reason}`,
      actor: await getCurrentStaffName(),
    })
    refreshActivity()
    setActionNote('Signed approval overridden.')
  }

  // ── Signed contract (#C) ────────────────────────────────────────────────────
  const refreshSignedContract = async () => setSignedContract(await getSignedContract(orderId))

  const previewSignedContract = async () => {
    const r = await signedContractFileUrl(orderId)
    if (!r.ok) { setActionNote(`Could not open signed contract — ${r.error}.`); return }
    openPreview('Contract (signed).pdf', r.url, 'application/pdf', false)
  }

  const handleMarkSigned = async () => {
    if (!signModal || signModal.busy) return
    setSignModal(m => ({ ...m, busy: true, error: null }))
    let payload
    try {
      if (signModal.file) {
        payload = { file: signModal.file }
      } else {
        const camel = rowToOrder(order, order.customer, order.cemetery)
        const { doc } = await generateContractPDF(camel, { returnDoc: true })
        payload = { blob: doc.output('blob') }
      }
    } catch (e) {
      setSignModal(m => ({ ...m, busy: false, error: e?.message || 'Could not prepare the contract.' })); return
    }
    const usedScan = !!signModal.file
    const res = await markContractSigned(orderId, payload)
    if (!res.ok) { setSignModal(m => ({ ...m, busy: false, error: res.error })); return }
    setSignModal(null)
    await refreshSignedContract()
    await logOrderActivity(orderId, {
      type: 'change', field: 'Contract', oldValue: 'draft', newValue: 'signed',
      note: `Contract marked signed${usedScan ? ' (scanned copy uploaded)' : ' (current contract designated)'}`,
      actor: await getCurrentStaffName(),
    })
    refreshActivity()
    setActionNote('Contract marked as signed.')
  }

  const handleOverrideSigned = async () => {
    if (!overrideModal || overrideModal.busy) return
    const reason = (overrideModal.reason || '').trim()
    if (!reason) { setOverrideModal(m => ({ ...m, error: 'A reason is required.' })); return }
    setOverrideModal(m => ({ ...m, busy: true, error: null }))
    const res = await removeSignedContract(orderId)
    if (!res.ok) { setOverrideModal(m => ({ ...m, busy: false, error: res.error })); return }
    setOverrideModal(null)
    await refreshSignedContract()
    await logOrderActivity(orderId, {
      type: 'change', field: 'Signed contract', oldValue: 'signed', newValue: 'overridden',
      note: `Signed contract overridden: ${reason}`,
      actor: await getCurrentStaffName(),
    })
    refreshActivity()
    setActionNote('Signed contract overridden — you can mark a new contract signed.')
  }

  // ── Customer & Contact quick-edit (writes the customers row) ─────────────────
  // Funeral home / referral is a JOB column (jobs.referral_source) — sending it
  // to customers is the "schema cache" crash that blocked every rename
  // (2026-07-22, the Abigail Gonzalez save). It seeds from and writes to the
  // job; the rest of the draft goes to the customers row.
  const seedCustDraft = () => setCustDraft({
    first_name: cust.first_name || '', last_name: cust.last_name || '',
    phone_primary: cust.phone_primary || '', email: cust.email || '',
    address_line1: cust.address_line1 || '', address_line2: cust.address_line2 || '',
    city: cust.city || '', state: cust.state || '', zip: cust.zip || '',
    phone_alt: cust.phone_alt || '', email_alt: cust.email_alt || '',
    referral_source: job?.referral_source || '',
  })
  const saveCustomer = async () => {
    if (!custDraft) return { ok: false, error: 'Nothing to edit.' }
    if (!cust?.id) return { ok: false, error: 'No customer is linked to this order.' }
    const { referral_source, ...custPatch } = custDraft
    const r = await updateCustomer(cust.id, custPatch)
    if (!r.ok) return r
    if (job?.id && (referral_source || '') !== (job.referral_source || '')) {
      const jr = await setJobReferralSource(job.id, referral_source)
      if (jr.ok) await refreshJob()
    }
    await refreshOrder()
    logOrderActivity(orderId, {
      type: 'change', field: 'Customer & contact', newValue: 'updated',
      note: 'Customer & contact edited', actor: await getCurrentStaffName(),
    }).then(() => refreshActivity()).catch(() => {})
    return { ok: true }
  }

  // Design summary quick-edit (Paul 2026-08-03: "must be able to edit what
  // they want") — verse + design notes, the two free-text facts the card
  // shows. Names stay edited on the order form (deceased is its own surface).
  const [makeDraft, setMakeDraft] = useState(null)
  const seedMakeDraft = () => setMakeDraft({
    epitaph: order.inscription?.epitaph || '',
    notes: order.design_preferences || '',
  })
  const saveMake = async () => {
    if (!makeDraft) return { ok: false, error: 'Nothing to edit.' }
    const r = await bulkUpdateOrders([orderId], {
      inscription: { ...(order.inscription || {}), epitaph: makeDraft.epitaph.trim() },
      design_preferences: makeDraft.notes.trim() || null,
    })
    if (!r.ok) return r
    await refreshOrder()
    logOrderActivity(orderId, {
      type: 'change', field: 'Design summary', newValue: 'updated',
      note: 'Verse / design notes edited', actor: await getCurrentStaffName(),
    }).then(() => refreshActivity()).catch(() => {})
    return { ok: true }
  }

  // ── Cemetery & Grave + permit quick-edit (the canonical permit editor) ───────
  // Permit STATUS/dates/meta live on the orders row (single source of truth — the
  // Orders table + Permit Hub read the same fields). The permit FEE is an OUTGOING
  // shop expense recorded to outgoing_payments — NEVER payments[], NEVER balance.
  const loadPermitExpenses = async () => {
    const all = await listOutgoingPayments()
    setPermitExpenses((all || []).filter(p => p.order_id === orderId && (p.category || '').toLowerCase() === 'permits'))
  }
  // ── Cemetery & grave quick-edit (GRAVE fields only — permit lives on the Permit card) ──
  const seedCgDraft = () => {
    setCgDraft({
      grave_location: order.grave_location || '', plot_type: order.plot_type || '',
      plot_notes: [order.plot_pin_notes, order.plot_other].filter(Boolean).join(' · '),
    })
  }
  const saveCemeteryGrave = async () => {
    if (!cgDraft) return { ok: false, error: 'Nothing to edit.' }
    const r = await bulkUpdateOrders([orderId], {
      grave_location: cgDraft.grave_location || null,
      plot_type: cgDraft.plot_type || null,
      plot_other: cgDraft.plot_notes || null,
    })
    if (!r.ok) return r
    await refreshOrder()
    logOrderActivity(orderId, { type: 'change', field: 'Cemetery & grave', newValue: 'updated', note: 'Cemetery & grave details edited', actor: await getCurrentStaffName() }).then(() => refreshActivity()).catch(() => {})
    return { ok: true }
  }

  // ── Permit card quick-edit — the ONE permit editor (status + dates + fee) ─────
  const seedPermitDraft = () => {
    setPermitDraft({
      permit_status: order.permit_status || 'unknown',
      permit_filed_at: order.permit_filed_at || '',
      permit_approved_at: order.permit_approved_at || '',
      permit_denied_at: order.permit_denied_at || '',
      permit_form: order.permit_form || '',
    })
    setFeeDraft({ amount: '', payee: cem.name || '', ck: '', date: todayISO(), method: 'check' })
    setFeeMsg(null)
    loadPermitExpenses()
  }
  const savePermit = async () => {
    if (!permitDraft) return { ok: false, error: 'Nothing to edit.' }
    const today = todayISO()
    const status = permitDraft.permit_status
    const patch = {
      permit_status: status,
      permit_filed_at: permitDraft.permit_filed_at || null,
      permit_approved_at: permitDraft.permit_approved_at || null,
      permit_denied_at: permitDraft.permit_denied_at || null,
      permit_form: permitDraft.permit_form || null,
    }
    if (status === 'submitted' && !patch.permit_filed_at) patch.permit_filed_at = today
    if (status === 'approved') {
      if (!patch.permit_filed_at) patch.permit_filed_at = today
      if (!patch.permit_approved_at) patch.permit_approved_at = today
    }
    if (status === 'denied') {
      if (!patch.permit_filed_at) patch.permit_filed_at = today
      if (!patch.permit_denied_at) patch.permit_denied_at = today
      patch.permit_approved_at = null   // a denial supersedes any stale approval
    }
    const prev = order.permit_status || 'unknown'
    const r = await setOrderPermit(orderId, patch)
    if (!r.ok) return r
    // Switched onto the Shevco form here too → same auto-task as the card select.
    if ((permitDraft.permit_form || null) === 'shevco' && (order.permit_form || null) !== 'shevco') {
      ensurePermitBuildTask(orderId, 'Shevco permit', _permitTaskLabel())
        .then(rr => { if (rr?.ok && !rr.skipped) refreshActivity() }).catch(() => {})
    }
    await refreshOrder()
    const staff = await getCurrentStaffName()
    if (status && status !== prev) {
      logOrderActivity(orderId, { type: 'change', field: 'Permit status', oldValue: permitStatusLabel(prev), newValue: permitStatusLabel(status), note: 'Permit status changed', actor: staff }).then(() => refreshActivity()).catch(() => {})
      if (job?.id) addJobEvent(job.id, { eventType: 'permit_status_changed', note: `Permit ${permitStatusLabel(prev)} → ${permitStatusLabel(status)}`, payload: { from: prev, to: status }, createdBy: staff }).catch(() => {})
    }
    return { ok: true }
  }
  // Record the permit FEE as an OUTGOING expense (outgoing_payments). Deduped at the
  // DB layer via source_permit_key. Explicit, deliberate money action — separate from
  // the panel Save. Does NOT touch payments[] and does NOT change balance due.
  const recordPermitFee = async () => {
    if (feeBusy) return
    const amt = Number(feeDraft.amount)
    if (!Number.isFinite(amt) || amt <= 0) { setFeeMsg({ type: 'err', text: 'Enter an amount greater than zero.' }); return }
    if (!feeDraft.date) { setFeeMsg({ type: 'err', text: 'Enter the paid date.' }); return }
    setFeeBusy(true); setFeeMsg(null)
    const payee = (feeDraft.payee || '').trim() || cem.name || null
    const filing = {
      type: 'permit',
      amount: amt, method: feeDraft.method,
      ck: feeDraft.ck ? String(feeDraft.ck).trim() : null,
      date_filed: feeDraft.date, name: payee,
    }
    const staff = await getCurrentStaffName()
    const exp = await createPermitOutgoingPayment(order, filing, { cemeteryName: payee, createdBy: staff })
    if (exp.status === 'skipped') { setFeeBusy(false); setFeeMsg({ type: 'err', text: `Not recorded — ${exp.reason}` }); return }
    if (exp.status === 'duplicate') { setFeeBusy(false); setFeeMsg({ type: 'err', text: 'This permit fee is already recorded.' }); await loadPermitExpenses(); return }
    // Record the per-order filing too (Permit Hub "filed" bucket reads orders.permit[]).
    const nextArr = [...(Array.isArray(order.permit) ? order.permit : []), filing]
    await setOrderPermit(orderId, { permit: nextArr })
    setFeeBusy(false)
    setFeeDraft({ amount: '', payee: payee || '', ck: '', date: todayISO(), method: 'check' })
    await refreshOrder(); await loadPermitExpenses()
    logOrderActivity(orderId, {
      type: 'change', field: 'Permit expense',
      newValue: `${fmtUSD(amt)}${filing.ck ? ` ck #${filing.ck}` : ''} (outgoing)`,
      note: `Permit fee paid to ${payee || 'cemetery'} — outgoing expense (does not affect customer balance)`,
      actor: staff,
    }).then(() => refreshActivity()).catch(() => {})
    if (job?.id) addJobEvent(job.id, { eventType: 'permit_expense_recorded', note: `Permit fee ${fmtUSD(amt)}${filing.ck ? ` ck #${filing.ck}` : ''} → ${payee || 'cemetery'} (outgoing)`, payload: { amount: amt, check: filing.ck, payee }, createdBy: staff }).catch(() => {})
  }

  // Remove a recorded permit fee — deletes the outgoing_payments row (so it
  // leaves Payments › Outgoing too) AND drops the matching filing from
  // orders.permit[] so the Permit Hub's filed bucket agrees. One truth, no
  // orphans (Paul, 2026-07-14: a wrong permit fee must be removable).
  const removePermitFee = async (p) => {
    if (feeBusy) return
    const label = `${fmtUSD(p.amount)}${p.reference ? ` ck #${p.reference}` : ''}`
    if (!window.confirm(`Remove this permit fee — ${label}? It also comes off Payments › Outgoing.`)) return
    setFeeBusy(true); setFeeMsg(null)
    // Find the matching orders.permit[] filing BEFORE deleting the ledger row,
    // so a match problem is visible up front instead of orphaning the filing
    // (audit B5). Key match first; if the stored key doesn't line up (jsonb
    // amount serialization can differ), fall back to check# + amount facts.
    const arr = Array.isArray(order.permit) ? order.permit : []
    const key = p.source_permit_key || null
    const factsMatch = (f) => {
      const sameCk = (f.ck != null && String(f.ck).trim() !== '' ? String(f.ck).trim() : null) === (p.reference || null)
      const sameAmt = Number(f.amount) === Number(p.amount)
      return sameCk && sameAmt
    }
    let nextArr = key ? arr.filter(f => permitOutgoingKey(orderId, f) !== key) : arr.filter(f => !factsMatch(f))
    if (key && nextArr.length === arr.length) nextArr = arr.filter(f => !factsMatch(f))
    const r = await deleteOutgoingPayment(p.id)
    if (!r.ok) { setFeeBusy(false); setFeeMsg({ type: 'err', text: r.error || 'Could not remove the fee.' }); return }
    if (nextArr.length !== arr.length) {
      const pr = await setOrderPermit(orderId, { permit: nextArr })
      if (!pr.ok) { setFeeBusy(false); setFeeMsg({ type: 'err', text: `Expense deleted, but the permit log entry could not be updated — ${pr.error || 'unknown error'}. Fix it via the permit log.` }); await loadPermitExpenses(); return }
    }
    setFeeBusy(false)
    await refreshOrder(); await loadPermitExpenses()
    const staff = await getCurrentStaffName()
    logOrderActivity(orderId, {
      type: 'change', field: 'Permit expense', newValue: 'removed',
      note: `Permit fee ${label} removed — outgoing expense deleted`,
      actor: staff,
    }).then(() => refreshActivity()).catch(() => {})
    if (job?.id) addJobEvent(job.id, { eventType: 'permit_expense_removed', note: `Permit fee ${label} removed (outgoing expense deleted)`, payload: { amount: Number(p.amount), check: p.reference || null }, createdBy: staff }).catch(() => {})
  }

  // ── Monument quick-edit (reuses the New Order MonumentCard verbatim) ─────────
  // The same editor the sales wizard uses (shape/size/color/polish/top + BaseSection
  // + Die/Base description overrides) edits a camelCase draft; Save maps the monument
  // fields back to the order columns. Display-only overrides (dieTextOverride /
  // baseTextOverride) ride on baseConfig and never change pricing.
  const seedMonDraft = () => {
    setMonDraft(rowToOrder(order, order.customer, order.cemetery))
    // Die + Base each carry their own ordering status (Paul, 2026-07-10 — sometimes
    // the die is here and the base isn't, and vice versa). Stored on the order
    // (die_stone_status / base_stone_status); legacy orders without them seed from
    // the milestone-derived combined status.
    const cur = job ? stoneToSimple(deriveStoneStatus(job)) : 'not_ordered'
    setStoneDraft({
      die: order.die_stone_status || cur,
      base: order.base_stone_status || cur,
      vendor: order.stone_vendor || '', newVendor: '',
      // Purchase record (Paul, 2026-07-07): the date the stone was ordered
      // (backdatable) + the supplier's acknowledgement (# / note + optional file).
      orderedDate: order.stone_ordered_date || '',
      ack: order.stone_purchase_ack || '',
      ackUrl: order.stone_purchase_ack_url || '',
    })
    listOrderingVendors().then(vs => setVendorList(vs || []))
  }
  const monUpdate = (patch) => setMonDraft(d => ({ ...d, ...patch }))
  const monUpdatePricing = (patch) => setMonDraft(d => ({ ...d, pricing: { ...(d.pricing || {}), ...patch } }))
  const saveMonument = async () => {
    if (!monDraft) return { ok: false, error: 'Nothing to edit.' }
    const d = monDraft
    const patch = {
      shape: d.shape || null,
      standard_size_code: d.standardSizeCode || null,
      width_inches: d.width ?? null, depth_inches: d.depth ?? null,
      thickness_inches: d.thickness ?? null, height_inches: d.height ?? null,
      top_shape: d.topShape || null, sides: d.sides || null,
      polish_level: d.polishLevel || null, granite_color: d.graniteColor || null,
      custom_shape: d.customShape || null, custom_shape_desc: d.customShapeDescription || null,
      base_config: d.baseConfig || {},
      pricing: d.pricing || {},
    }
    // Die/Base statuses — entering an ordered DATE advances any piece still at
    // "not ordered" to Ordered automatically (you dated the order you placed).
    const hasBase = draftHasBase(d)
    const advance = (s) => (stoneDraft?.orderedDate && s === 'not_ordered') ? 'ordered' : (s || 'not_ordered')
    const dieS = advance(stoneDraft?.die)
    const baseS = hasBase ? advance(stoneDraft?.base) : null
    patch.die_stone_status = dieS
    patch.base_stone_status = baseS
    // Vendor — resolve a brand-new vendor first (persists for reuse), then store
    // the chosen supplier on the order (meaningful while either piece is "ordered").
    const anyOrdered = dieS === 'ordered' || baseS === 'ordered'
    let vendor = (stoneDraft?.vendor || '').trim()
    if (anyOrdered && stoneDraft?.vendor === NEW_VENDOR) {
      const nv = (stoneDraft.newVendor || '').trim()
      if (!nv) return { ok: false, error: 'Enter the new vendor name.' }
      const vr = await addOrderingVendor(nv)
      if (!vr.ok) return vr
      vendor = vr.vendor.name
    }
    patch.stone_vendor = anyOrdered ? (vendor || null) : null
    // Purchase record persists regardless of later status moves — the fact the
    // stone was ordered on a date, with an acknowledgement, is history.
    patch.stone_ordered_date = stoneDraft?.orderedDate || null
    patch.stone_purchase_ack = stoneDraft?.ack?.trim() || null
    patch.stone_purchase_ack_url = stoneDraft?.ackUrl || null
    const r = await bulkUpdateOrders([orderId], patch)
    if (!r.ok) return r
    // Combined job-level stone status = the LEAST-ready piece; reuses the
    // milestone-backed setter (same source as the Orders table + schedule).
    // Needs a job; no-op when the order has none yet.
    if (job?.id && stoneDraft) {
      const pieces = [dieS, baseS].filter(Boolean)
      const combined = pieces.reduce((a, b) => (STONE_SIMPLE_RANK[b] < STONE_SIMPLE_RANK[a] ? b : a))
      const cur = stoneToSimple(deriveStoneStatus(job))
      if (combined !== cur) await setOrderStoneStatus(job.id, combined)
    }
    await refreshOrder(); await refreshJob?.()
    const staff = await getCurrentStaffName()
    logOrderActivity(orderId, { type: 'change', field: 'Monument spec', newValue: 'updated', note: 'Monument spec / overrides edited', actor: staff }).then(() => refreshActivity()).catch(() => {})
    if (job?.id) addJobEvent(job.id, { eventType: 'monument_spec_overridden', note: 'Monument spec / overrides edited', createdBy: staff }).catch(() => {})
    return { ok: true }
  }

  // ── Design / proof quick-edit (internal notes + email the approval link) ─────
  // Same two-scope union as the initial load — order-scoped estimate layouts
  // must survive a refresh too.
  const refreshProofs = async () => {
    const [a, b] = await Promise.all([
      job?.id ? getProofVersions(job.id) : Promise.resolve([]),
      getProofVersionsByOrder(orderId),
    ])
    setProofVers([...(a || []), ...(b || [])])
  }
  const seedDesignDraft = () => {
    const proof = proofVers.find(p => p.is_current) || proofVers[0]
    setDesignNotesDraft(proof?.notes || '')
    setEmailLinkMsg(null)
  }
  const saveDesignNotes = async () => {
    const proof = proofVers.find(p => p.is_current) || proofVers[0]
    if (!proof) return { ok: false, error: 'No proof yet — add a layout in the Design hub first.' }
    const r = await updateProofVersion(proof.id, { notes: designNotesDraft })
    if (!r.ok) return r
    await refreshProofs()
    logOrderActivity(orderId, { type: 'change', field: 'Design notes', newValue: 'updated', note: 'Internal design notes edited', actor: await getCurrentStaffName() }).then(() => refreshActivity()).catch(() => {})
    return { ok: true }
  }
  // Email the active approval link — opens the COMPOSER prefilled so Paul can
  // preview/edit before sending (2026-07-08: "i want to preview the email then
  // hit send"). The composer's Send does the real send + logging.
  const emailApprovalLink = () => {
    const active = approvalLinks.find(l => (l.displayStatus === 'pending' || l.displayStatus === 'viewed') && l.share_url)
    const url = active?.share_url || sentLink
    if (!url) { setEmailLinkMsg({ type: 'err', text: 'No active approval link — use “Send for approval” first.' }); return }
    setEmailLinkMsg(null)
    const surname = order.primary_lastname || cust.last_name || 'your'
    setEmailModal({
      to: cust?.email || '',
      subject: `Layout approval — ${surname}`,
      body: `Hello,\n\nYour design is ready for your review and approval. Please open the link below, review it, and approve it (or request changes):\n\n${url}\n\nThank you,\nShevchenko Monuments\n732-442-1286`,
      approvalLinkId: active?.id || null,
      busy: false, error: null, sent: false,
    })
  }

  // ESTIMATE SHEET (Paul, 2026-07-20): the uploaded layout ON a one-page
  // estimate — the estimate PDF already em-dashes per-item rates and shows
  // the final price; the layout image renders above the line items.
  const [sheetBusy, setSheetBusy] = useState(false)
  const downloadEstimateSheet = async (layoutImageUrl) => {
    if (sheetBusy) return
    setSheetBusy(true)
    try {
      const camel = rowToOrder(order, order.customer, order.cemetery)
      const { doc } = await generateEstimatePDF(camel, { returnDoc: true, layoutImageUrl })
      const base = String(order.primary_lastname || order.order_number || 'estimate').replace(/[^\w-]+/g, '_')
      doc.save(`${base}-estimate-layout.pdf`)
    } catch (e) {
      setActionNote(`Estimate sheet failed — ${e?.message || e}.`)
    } finally { setSheetBusy(false) }
  }

  // ── Financial quick add-payment (Financial card ⋯) ──────────────────────────
  // A CUSTOMER payment — written to orders.payments[] via recordOrderPayment (the
  // SAME source the Payments tab uses), so it two-way-syncs automatically and DOES
  // reduce the balance. Completely separate from the permit OUTGOING expense.
  const seedPayDraft = async () => {
    const me = await getCurrentStaffName()
    setPayDraft({
      amount: balance > 0 ? String(balance) : '',
      method: 'check', type: rawPayments.length === 0 ? 'deposit' : 'final',
      receivedAt: todayISO(), ref: '', collectedBy: me || '',
    })
  }
  const savePaymentQuick = async () => {
    if (!payDraft) return { ok: false, error: 'Nothing to record.' }
    const amount = Number(payDraft.amount)
    if (!Number.isFinite(amount) || amount <= 0) return { ok: false, error: 'Enter an amount greater than zero.' }
    if (missingCheckRef(payDraft.method, payDraft.ref)) return { ok: false, error: 'Check number is required for check payments.' }
    const createdBy = payDraft.collectedBy || await getCurrentStaffName()
    const res = await recordOrderPayment(orderId, {
      amount, method: payDraft.method, type: payDraft.type,
      receivedAt: payDraft.receivedAt, ref: (payDraft.ref || '').trim() || null, createdBy,
    })
    if (!res.ok) return { ok: false, error: res.error || 'Could not record the payment.' }
    if (res.payment) setLastReceiptPayment(res.payment)   // post-save receipt offer
    await refreshOrder()
    logOrderActivity(orderId, { type: 'activity', note: `Payment recorded: ${fmtUSD(amount)}${payDraft.method ? ` (${payDraft.method})` : ''}`, actor: createdBy }).then(() => refreshActivity()).catch(() => {})
    if (job?.id) addJobEvent(job.id, { eventType: 'customer_payment_recorded', note: `Customer payment ${fmtUSD(amount)} (${payDraft.method})`, payload: { amount, method: payDraft.method }, createdBy }).catch(() => {})
    return { ok: true }
  }

  // (Permit editing consolidated into the Cemetery & grave ⋯ quick-edit — see
  //  seedCgDraft / saveCemeteryGrave / recordPermitFee above. The permit fee is an
  //  outgoing expense, never an order column, never a customer payment.)

  // Send this order to the Quote Hub for the owner's final approval. Works the
  // same regardless of how the order was created (it lives on the shared detail).
  const sendToQuoteHub = async () => {
    const r = await setOrderQuoteStatus(orderId, 'pending_review')
    if (r.ok) {
      await appendQuoteEvent('orders', orderId, { type: 'sent', by: await getCurrentStaffName() })
      await refreshOrder()
    }
    return r
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
    if (url) openPreview('Signature.png', url, 'image/png', false)
    else setActionNote('Could not open signature (signed URL expired or blocked).')
  }

  // In-app attachment preview (#3). isBlob → revoke the object URL on close.
  const openPreview = (name, url, mime, isBlob = false) => setPreview({ name, url, mime, isBlob })
  const closePreview = () => setPreview(p => { if (p?.isBlob && p.url) URL.revokeObjectURL(p.url); return null })

  // ── Email (Gmail Phase 2) ──────────────────────────────────────────────────
  const openEmailComposer = () => {
    setActionNote(null)
    setEmailModal({ to: order?.customer?.email || '', subject: '', body: '', attach: [], busy: false, error: null, sent: false })
  }
  const closeEmailComposer = () => setEmailModal(m => (m && m.busy ? m : null))

  // ── Quick task (Paul 2026-07-28: "+add Task at the top") ───────────────────
  const [quickTask, setQuickTask] = useState('')
  const [quickTaskBusy, setQuickTaskBusy] = useState(false)
  const addQuickTask = async () => {
    const t = quickTask.trim()
    if (!t || quickTaskBusy) return
    setQuickTaskBusy(true)
    const me = await getCurrentStaffName()
    const r = await addOrderTask(orderId, { note: t, assignee: me, actor: me })
    setQuickTaskBusy(false)
    if (!r?.ok) { setActionNote(r?.error || 'Could not add the task.'); return }
    setQuickTask('')
    refreshActivity()
    setActionNote(`Task added, assigned to ${me} — reassign it on the Today tab if it's for someone else.`)
  }

  // ── Email drafts (Paul 2026-07-28: "i gotta keep restarting") ──────────────
  // Park the composer as a draft; the drafts strip under the quick actions
  // reopens it exactly where it stopped. Sending deletes the draft.
  const saveComposerDraft = async () => {
    if (!emailModal || emailModal.busy) return
    setEmailModal(m => ({ ...m, busy: true, error: null }))
    const me = await getCurrentStaffName().catch(() => null)
    const r = await saveEmailDraft({
      id: emailModal.draftId || null,
      orderId, customerId: order?.customer_id || null, kind: 'general',
      payload: { to: emailModal.to, subject: emailModal.subject, body: emailModal.body, attach: emailModal.attach || [] },
      by: me,
    })
    if (!r.ok) { setEmailModal(m => ({ ...m, busy: false, error: r.error || 'Could not save the draft.' })); return }
    setEmailModal(null)
    refreshDrafts()
    setActionNote('Draft saved — pick it back up from Email drafts below.')
  }
  const openDraft = (d) => {
    setActionNote(null)
    if (d.kind === 'general') {
      const p = d.payload || {}
      setEmailModal({
        to: p.to || order?.customer?.email || '', subject: p.subject || '', body: p.body || '',
        attach: Array.isArray(p.attach) ? p.attach : [],
        draftId: d.id, busy: false, error: null, sent: false,
      })
    } else {
      setSalesEmailMode({ mode: d.kind === 'contract' ? 'contract' : 'sales', draft: d })
    }
  }
  const removeDraft = async (d) => {
    const r = await deleteEmailDraft(d.id)
    if (!r.ok) { setActionNote(`Could not delete the draft — ${r.error}`); return }
    refreshDrafts()
  }

  // Composer attachments (Paul 2026-07-15): pick from the order's files or
  // upload new — a new upload goes through uploadOrderAttachment, so it lands
  // in the order's attachment list too (same rule as task attachments).
  const emailFileRef = useRef(null)
  const toggleEmailAttach = (f) => setEmailModal(m => {
    if (!m) return m
    const list = m.attach || []
    const on = list.some(a => a.path === f.path)
    return { ...m, attach: on ? list.filter(a => a.path !== f.path) : [...list, { name: f.name, url: f.url, path: f.path }] }
  })
  const onEmailFilesChosen = async (e) => {
    const files = Array.from(e.target.files || [])
    e.target.value = ''
    if (!files.length) return
    setEmailModal(m => (m ? { ...m, uploading: true, error: null } : m))
    for (const file of files) {
      const r = await uploadOrderAttachment(orderId, file)
      if (!r.ok) { setEmailModal(m => (m ? { ...m, uploading: false, error: `Upload failed — ${r.error}` } : m)); return }
      setEmailModal(m => (m ? { ...m, attach: [...(m.attach || []), { name: r.name, url: r.url, path: r.path }] } : m))
    }
    refreshUploads()
    setEmailModal(m => (m ? { ...m, uploading: false } : m))
  }
  const handleSendEmail = async () => {
    if (!emailModal) return
    const to = (emailModal.to || '').trim()
    const subject = (emailModal.subject || '').trim()
    if (!to || !subject || emailModal.busy) return
    setEmailModal(m => ({ ...m, busy: true, error: null }))
    // Closeout email — embed + attach the completion photo(s) so the family sees
    // the finished monument, then close the order on success IF it's paid in full.
    const isCloseout = emailModal.mode === 'closeout'
    const photos = isCloseout ? (emailModal.photos || []) : []
    let html, attachments
    if (photos.length) {
      const bodyHtml = String(emailModal.body || '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>')
      const imgs = photos.map(p => `<img src="${p.url}" alt="Completed monument" style="max-width:100%;border-radius:8px;margin-top:14px" />`).join('')
      html = `<div style="font-size:14px;line-height:1.6;color:#222">${bodyHtml}${imgs}</div>`
      // URL refs — the server fetches from OUR storage, so photos never ride
      // the ~4.5MB request body (the old cap Paul kept hitting). Full size.
      attachments = photos.map(p => ({ filename: p.name, url: p.url }))
    }
    // Picked/uploaded composer attachments ride along with any closeout photos.
    const picked = emailModal.attach || []
    if (picked.length) {
      attachments = attachments || []
      for (const f of picked) attachments.push({ filename: f.name, url: f.url })
    }
    // Only base64 payloads count against the request-body cap now — URL refs
    // are fetched server-side and capped near Gmail's real 25MB limit there.
    const totalB64 = (attachments || []).reduce((s, a) => s + (a.contentBase64?.length || 0), 0)
    if (totalB64 > 4_800_000) {
      setEmailModal(m => ({ ...m, busy: false, error: 'Generated attachments are too large for one email — remove some and send the rest separately.' }))
      return
    }
    const res = await sendShopEmail({ orderId, customerId: order?.customer_id || null, to, subject, text: emailModal.body, html, attachments })
    if (!res.ok) { setEmailModal(m => ({ ...m, busy: false, error: res.error || 'Send failed' })); return }
    // Approval emails stamp the link the moment they ACTUALLY send — the
    // Today tab's Approvals panel reads this as hard proof (Paul, 2026-07-14).
    if (emailModal.approvalLinkId) markApprovalLinkEmailed(emailModal.approvalLinkId, to).catch(() => {})
    // A sent draft is no longer a draft.
    if (emailModal.draftId) { deleteEmailDraft(emailModal.draftId).catch(() => {}); refreshDrafts() }
    setEmailModal(m => ({ ...m, busy: false, sent: true }))
    if (order?.customer_id || orderId) setEmails((await getMessageThread({ customerId: order?.customer_id, orderId })).messages || [])
    // Auto-close only when paid in full — never close an order that still owes.
    if (isCloseout) {
      if (balance <= 0) {
        const cr = await closeOrder(orderId)
        if (cr.ok) { setOrder(o => (o ? { ...o, status: 'closed' } : o)); setActionNote('Order closed out — thank-you sent. ✓') }
        else setActionNote('Thank-you sent, but closing the order failed — set it to Closed manually.')
      } else {
        setActionNote(`Thank-you sent. Order left open — $${balance.toFixed(2)} balance still due.`)
      }
    }
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
      mode,
      photos: mode === 'closeout' ? completionPhotos.slice(0, 3) : null,
      busy: false, error: null, sent: false,
    })
  }

  // ── D2 — permanent delete (archived only) ──────────────────────────────────
  const handleHardDelete = async () => {
    if (deleteBusy) return
    setDeleteBusy(true); setDeleteErr(null)
    const res = await hardDeleteOrder(order.id)
    setDeleteBusy(false)
    if (!res.ok) { setDeleteErr(res.error || 'Could not delete the order.'); return }
    setDeleteModal(false)
    onBack?.()   // OrderDetail's onBack clears selection + reloads the list
  }

  // ── Record payment ─────────────────────────────────────────────────────────
  const openPayment = async () => {
    setActionNote(null)
    const me = await getCurrentStaffName().catch(() => '')
    setPayModal({ amount: '', method: 'check', type: 'deposit', receivedAt: todayISO(), ref: '', note: '', collectedBy: me || '', busy: false, error: null, confirm: false })
  }
  const closePayment = () => setPayModal(m => (m && m.busy ? m : null))
  const handleRecordPayment = async () => {
    if (!payModal || payModal.busy) return
    const amount = Number(payModal.amount)
    if (!Number.isFinite(amount) || amount <= 0) { setPayModal(m => ({ ...m, error: 'Enter an amount greater than zero.' })); return }
    if (missingCheckRef(payModal.method, payModal.ref)) { setPayModal(m => ({ ...m, confirm: false, error: 'Check number is required for check payments.' })); return }
    // Money safety — explicit confirm step before the record is written.
    if (!payModal.confirm) { setPayModal(m => ({ ...m, confirm: true, error: null })); return }
    setPayModal(m => ({ ...m, busy: true, error: null }))
    const createdBy = payModal.collectedBy || await getCurrentStaffName()
    const res = await recordOrderPayment(orderId, {
      amount, method: payModal.method, type: payModal.type,
      receivedAt: payModal.receivedAt, ref: payModal.ref.trim() || null,
      note: payModal.note.trim() || null, createdBy,
    })
    if (!res.ok) { setPayModal(m => ({ ...m, busy: false, confirm: false, error: res.error || 'Could not record the payment.' })); return }
    const method = payModal.method
    setPayModal(null)
    if (res.payment) setLastReceiptPayment(res.payment)   // ⭐ offer Print + Email right after save
    await refreshOrder()
    await logOrderActivity(orderId, {
      type: 'activity',
      note: `Payment recorded: ${fmtUSD(amount)}${method ? ` (${method})` : ''}`,
      actor: createdBy,
    })
    refreshActivity()
    setActionNote(`Payment of ${fmtUSD(amount)} recorded.`)
  }

  // ── Edit / void an existing payment (incl. locked amount — NO edit-trail) ───
  const startEditPay = (p) => {
    setPayRowErr(null)
    setEditPay({ id: p.id, amount: String(p.amount ?? ''), method: p.method || 'check', receivedAt: (p.receivedAt || p.createdAt || '').slice(0, 10), ref: p.ref || '' })
  }
  const saveEditPay = async () => {
    if (!editPay) return
    if (missingCheckRef(editPay.method, editPay.ref)) { setPayRowErr('Check number is required for check payments.'); return }
    setPayRowBusy(editPay.id); setPayRowErr(null)
    const res = await updateOrderPayment(orderId, editPay.id, {
      amount: Number(editPay.amount), method: editPay.method,
      receivedAt: editPay.receivedAt || null, ref: editPay.ref.trim() || null,
    })
    setPayRowBusy(null)
    if (!res.ok) { setPayRowErr(res.error || 'Could not save the edit.'); return }
    setEditPay(null)
    await refreshOrder()
  }
  // Void — proper reason dialog (audit-aware), not a browser prompt.
  const [voidModal, setVoidModal] = useState(null)   // { payment, reason }
  const voidPay = (p) => { setPayRowErr(null); setVoidModal({ payment: p, reason: '' }) }
  const confirmVoid = async () => {
    if (!voidModal || !voidModal.reason.trim()) return
    const p = voidModal.payment
    setPayRowBusy(p.id); setPayRowErr(null)
    const actor = await getCurrentStaffName().catch(() => null)
    const res = await voidOrderPayment(orderId, p.id, { reason: voidModal.reason.trim(), actor })
    setPayRowBusy(null)
    if (!res.ok) { setPayRowErr(res.error || 'Could not void the payment.'); setVoidModal(null); return }
    setVoidModal(null)
    await refreshOrder()
  }

  // Mark as contracted — the prominent pipeline action. Two-step arm/confirm
  // button (no modal). Stamps signed_at today (keeps an existing date) and
  // advances a pre-contract status to 'contracted'.
  const [contractArm, setContractArm] = useState(false)
  const markContracted = async () => {
    if (!contractArm) { setContractArm(true); setTimeout(() => setContractArm(false), 4000); return }
    setContractArm(false)
    const d = order.signed_at ? String(order.signed_at).slice(0, 10) : todayISO()
    const patch = { signed_at: `${d}T00:00:00` }
    if (['draft', 'scoping', 'quoted'].includes(order.status)) patch.status = 'contracted'
    const res = await bulkUpdateOrders([orderId], patch)
    if (!res.ok) { setActionNote(res.error || 'Could not mark contracted.'); return }
    setOrder(o => ({ ...o, ...patch }))
    // Signing guarantees the job exists — same rule as the wizard + inline toggle.
    if (!job?.id) { await createJobFromOrder(orderId, { source: 'mark_contracted' }); await refreshJob() }
    logOrderActivity(orderId, { type: 'change', field: 'Contract', oldValue: 'unsigned', newValue: `signed ${d}`, note: 'Marked as contracted', actor: await getCurrentStaffName().catch(() => null) }).catch(() => {})
    setActionNote('Marked as contracted.')
    // Auto deposit-invoice draft (pipeline quick strike): signing should
    // immediately ask for the 50% deposit. Prefill the composer — staff review
    // + one click to send; meaningful emails never auto-send.
    const t = rowGrandTotal(order)
    const pd = rowTotalPaid(order)
    const depositDue = Math.max(0, Math.round((t / 2 - pd) * 100) / 100)
    if (t > 0 && depositDue > 0) {
      const first = (order.customer?.first_name || '').trim()
      const lines = [
        `Hi${first ? ` ${first}` : ''},`,
        '',
        'Thank you for signing your monument contract with Shevchenko Monuments.',
        '',
        `Contract total: ${fmtUSD(t)}`,
        ...(pd > 0 ? [`Received to date: ${fmtUSD(pd)}`] : []),
        `Deposit due (50%): ${fmtUSD(depositDue)}`,
        '',
        `You can pay by Zelle to shevcoteam@gmail.com — please put order ${order.order_number || ''} in the memo — or by cash, check, or card at the office.`,
        '',
        'Work on your monument is scheduled once the deposit is received. If you have any questions, just reply to this email or give us a call.',
        '',
        'Shevchenko Monuments',
      ]
      setEmailModal({
        to: order.customer?.email || '',
        subject: `Deposit invoice — order ${order.order_number || ''} — Shevchenko Monuments`,
        body: lines.join('\n'),
        busy: false, error: null, sent: false,
      })
    }
  }

  if (loading) {
    return (
      <div className="sb-od-page"><style>{OD_CSS}</style>
        <div className="sb-od-container"><BackBar onBack={onBack} label={backLabel} /><div className="sb-od-empty">Loading order…</div></div>
      </div>
    )
  }
  if (err || !order) {
    return (
      <div className="sb-od-page"><style>{OD_CSS}</style>
        <div className="sb-od-container"><BackBar onBack={onBack} label={backLabel} /><div className="sb-od-empty">{err || 'Order not found.'}</div></div>
      </div>
    )
  }

  const cust = order.customer || {}
  const cem = order.cemetery || {}
  const deceased = Array.isArray(order.deceased) ? order.deceased : []
  const baseConfig = order.base_config || {}

  const pressure = computeOrderPressure(order, job, job?.milestones)
  // Permit derived values
  const readyBlocked = (job?.milestones || []).some(m => m.milestone_key === 'ready_to_install' && m.status === 'done')
    && order.permit_status !== 'approved' && order.permit_status !== 'not_required'
  const total = rowGrandTotal(order)
  const paid = rowTotalPaid(order)
  const balance = rowBalanceDue(order)
  const stage = statusInfo(order.status)
  // Paul's rule (leads.js isOrderRow): an ORDER is signed/contracted WITH money
  // down. The LOUD marker keys on the money half — no real (locked, non-voided)
  // payment = STILL A LEAD, no matter the status, because stones sometimes get
  // ordered before any money lands. Signed-but-unpaid still reads LEAD on
  // purpose. Terminal states excluded.
  const isLead = paid <= 0 && !['closed', 'cancelled', 'archived'].includes(order.status)

  const familyName =
    (order.primary_lastname && String(order.primary_lastname).trim()) ||
    (cust.last_name && String(cust.last_name).trim().toUpperCase()) ||
    customerName(cust) || '—'

  // Quick family-name save — writes deceased[0].lastName via
  // setOrderFamilyName; the generated primary_lastname recomputes, so every
  // board picks it up.
  const saveFamilyName = async () => {
    const name = (famEdit || '').trim()
    if (!name || famBusy) return
    setFamBusy(true)
    const r = await setOrderFamilyName(orderId, name)
    if (!r.ok) { setFamBusy(false); setActionNote(`Could not save the family name — ${r.error}.`); return }
    await logOrderActivity(orderId, {
      type: 'change', field: 'Family name', oldValue: familyName, newValue: name,
      note: `Family name: ${familyName} → ${name}`, actor: await getCurrentStaffName(),
    })
    await refreshOrder(); refreshActivity()
    setFamBusy(false); setFamEdit(null)
  }
  const primaryDeceased = deceasedName(deceased[0])


  // Receipt needs the camelCase wizard shape — adapt the raw row via the canonical
  // rowToOrder (real fields only; no faked mapping). Raw non-voided payments power
  // the editable history + per-row receipts.
  const receiptOrder = rowToOrder(order, order.customer, order.cemetery)
  const rawPayments = (Array.isArray(order.payments) ? order.payments.filter(p => p && !p.voided) : [])
    .slice().sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0))

  // Address blocks
  const custAddr = [cust.address_line1, cust.address_line2, [cust.city, cust.state, cust.zip].filter(Boolean).join(', ')].filter(Boolean)
  const cemAddr = [cem.address, [cem.city, cem.state, cem.zip].filter(Boolean).join(', ')].filter(Boolean)
  // Referral lives on the JOB — customers has no referral_source column.
  const referral = [humanize(job?.referral_source), job?.referral_source_detail].filter(Boolean).join(' — ')

  // Quick-glance values (the three things to read the instant the order opens).
  const plotShort = composeGraveLocation(order)
  const orderType = orderTypeLabels(order, job).join(' / ')
  // #4 — service orders shouldn't render an empty Monument card; label + scope it.
  const svcTypes = order.service_types || []
  const isStoneOrder = svcTypes.some(c => ['NEW_STONE', 'BRONZE', 'CIVIC_MEMORIAL', 'MAUSOLEUM'].includes(c))
  const isServiceOrder = !isStoneOrder && (svcTypes.includes('ACID_WASH') || svcTypes.includes('REPAIR'))
  const isInscriptionOrder = !isStoneOrder && !isServiceOrder && svcTypes.includes('INSCRIPTION')
  const monumentCardTitle = isStoneOrder ? 'Monument' : isInscriptionOrder ? 'Inscription' : isServiceOrder ? 'Service' : 'Service / job'
  // Re-approval warning (Phase 3): a signed approval is pinned but the current
  // proof has advanced past the approved version.
  const approvedProof = proofVers.find(p => p.approved_at)
  const currentProof = proofVers.find(p => p.is_current) || proofVers[0]
  const reapprovalText = (signedApproval && approvedProof && currentProof && approvedProof.version_number !== currentProof.version_number)
    ? `Approved: v${approvedProof.version_number} — current proof is v${currentProof.version_number}, re-approval needed.`
    : null

  // Left-rail section nav (Completion photos only when present).
  // Design summary shows for the making trades (Paul 2026-08-03: "new stones
  // orders, inscriptions orders, and bronze services") or whenever a catalog
  // design was actually picked.
  const _svcUp = new Set((order.service_types || []).map(s => String(s).toUpperCase()))
  const showMake = _svcUp.has('NEW_STONE') || _svcUp.has('INSCRIPTION') || _svcUp.has('BRONZE')
    || (Array.isArray(order.designs) && order.designs.length > 0)
  const railItems = [
    { id: 'od-customer', label: 'Customer & contact' },
    { id: 'od-cemetery', label: 'Cemetery & grave' },
    { id: 'od-monument', label: 'Monument' },
    ...(showMake ? [{ id: 'od-make', label: 'Design summary' }] : []),
    { id: 'od-financial', label: 'Financial' },
    { id: 'od-permit', label: 'Permit' },
    { id: 'od-job', label: 'Related job' },
    { id: 'od-attachments', label: 'Attachments' },
    ...(completionPhotos.length > 0 ? [{ id: 'od-photos', label: 'Completion photos' }] : []),
    { id: 'od-notes', label: 'Notes' },
    { id: 'od-email', label: 'Email traffic' },
  ]

  // Base presence via single-source orderHasBase (not the include-only check that
  // dropped a configured base). Render the real spec via buildBaseSpec when present.
  const _baseShape = SHAPES.find(s => s.code === order.shape)
  const baseSummary = !orderHasBase(baseConfig, _baseShape) ? 'Not included'
    : (buildBaseSpec({ baseConfig })
        || [humanize(baseConfig.sizeCode), baseConfig.heightCode ? `${baseConfig.heightCode}" tall` : null].filter(Boolean).join(' · ')
        || 'Included')
  // ONE clean composed spec line (override-aware). dieTextOverride replaces the die
  // line verbatim; buildBaseSpec already returns baseTextOverride verbatim when set.
  const _dieOverride = (order.base_config?.dieTextOverride || '').trim()
  const _dieLine = _dieOverride || buildDieSpec(receiptOrder)
  const _baseLine = orderHasBase(baseConfig, _baseShape) ? buildBaseSpec(receiptOrder) : ''
  const monumentLine = [_dieLine, _baseLine && `on ${_baseLine}`].filter(Boolean).join(' · ')

  // Derived statuses from the related job's milestones (read-only)
  const design6 = deriveDesign6(job, proofVers)          // 6-label design status
  const _currentProof = proofVers.find(p => p.is_current) || proofVers[0] || null
  const foundationMs = milestoneStatus(job, ['foundation_poured', 'foundation_cured'])
  const nra = job ? getNextRequiredAction(job) : null
  const jobStage = job ? jobStatusInfo(job.overall_status) : null
  // Status Overview card — same engine as the rail (they can never disagree).
  const overviewPipe = buildPipeline(order, job)
  const overviewPressure = computeOrderPressure(order, job, job?.milestones)

  // ── Status Overview v2 derives (Paul 2026-08-03) ───────────────────────────
  // Current floor position — the die leads (it's the piece being worked).
  const _floorPiece = (floorComps || []).find(c => c.on_floor && c.component_type === 'die')
    || (floorComps || []).find(c => c.on_floor) || null
  const floorPhaseCode = _floorPiece?.current_phase || null
  // The install milestone: in_progress + due_date = scheduled.
  const _installMsRow = (job?.milestones || []).find(m => ['installed', 'door_installed', 'work_completed'].includes(m.milestone_key)) || null
  const installScheduledDate = _installMsRow?.status === 'in_progress' ? (_installMsRow.due_date || null) : null
  const ovInstalledDone = _installMsRow?.status === 'done'
  const ovGates = job ? installGates(order, job) : null
  // Waiting on / Already good — every waiting chip is one click from a task.
  const fam2 = properName(order.primary_lastname || customerName(order.customer) || '')
  const ordTag = `${fam2}${order.order_number ? ` (${order.order_number})` : ''}`
  const waitingOn = []
  if (!order.signed_at) waitingOn.push({ key: 'contract', label: 'CONTRACT UNSIGNED', short: 'the contract', task: `Get the contract signed — ${ordTag}` })
  if (order.signed_at && balance > 0) waitingOn.push({ key: 'payment', label: `FINAL PAYMENT ${fmtUSD(balance)}`, short: 'final payment', task: `Call about the final payment — ${fmtUSD(balance)} due — ${ordTag}` })
  if (ovGates?.fdn === false) waitingOn.push({ key: 'fdn', label: 'FDN NOT IN', short: 'the foundation', task: `Do the foundation — ${ordTag}${order.cemetery?.name ? ` at ${order.cemetery.name}` : ''}` })
  if (ovGates?.permit === false) waitingOn.push({ key: 'permit', label: 'PERMIT NOT APPROVED', short: 'the permit', task: `Get the permit approved — ${ordTag}` })
  if (ovGates && !ovGates.blasted && !ovInstalledDone) waitingOn.push({ key: 'blast', label: 'NOT BLASTED', short: 'blasting', task: `Blast the stone — ${ordTag}` })
  if (job && !installScheduledDate && !ovInstalledDone && ovGates?.blasted) waitingOn.push({ key: 'sched', label: 'INSTALL NOT SCHEDULED', short: 'the install date', task: `Schedule the install — ${ordTag}` })
  const alreadyGood = []
  if (paid > 0) alreadyGood.push(order.signed_at && balance <= 0 ? 'PAID IN FULL' : 'DEPOSIT COLLECTED')
  if (job && ['layout_approved', 'cut'].includes(deriveDesignStatus(job))) alreadyGood.push('LAYOUT APPROVED')
  if (ovGates?.permit === true) alreadyGood.push('PERMIT APPROVED')
  if (ovGates?.fdn === true) alreadyGood.push('FDN IN')
  if (ovGates?.blasted) alreadyGood.push('BLASTED')
  // The plain-words headline.
  const _joinAnd = (a) => a.length <= 1 ? (a[0] || '') : `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`
  const ovHeadline = ovInstalledDone
    ? 'Installed — closeout is what remains.'
    : (floorPhaseCode
        ? `On the floor: ${phaseLabel(floorPhaseCode)}${waitingOn.length ? ` — waiting on ${_joinAnd(waitingOn.map(w => w.short))}` : ''}.`
        : (waitingOn.length ? `Waiting on ${_joinAnd(waitingOn.map(w => w.short))}.` : 'Moving — nothing waiting.'))
  // Due proximity, in words (library call — render stays pure).
  const dueText = dueRelativeText(order.target_completion_date)
  const dueTone2 = dueDateTone(order.target_completion_date)

  // ── Quick actions ──────────────────────────────────────────────────────────
  const handleOpenContract = async () => {
    setActionNote(null)
    try {
      const camel = rowToOrder(order, order.customer, order.cemetery)
      const { doc, filename } = await generateContractPDF(camel, { returnDoc: true })
      const url = URL.createObjectURL(doc.output('blob'))
      openPreview(filename || 'Contract.pdf', url, 'application/pdf', true)
    } catch (e) {
      setActionNote(`Could not open contract — ${e?.message || 'error'}.`)
    }
  }
  // ── Contract editor — per-order wording overrides (pricing.contractOverrides).
  // The opener prepares EVERYTHING (camel order, generated defaults, priced
  // lines) so ContractEditor stays render-pure (buildContractDefaults calls
  // new Date() — handler context only).
  const openContractEditor = () => {
    setActionNote(null)
    try {
      const camel = rowToOrder(order, order.customer, order.cemetery)
      setContractEd({
        camel,
        defaults: buildContractDefaults(camel, { isContract: true }),
        existing: order.pricing?.contractOverrides || null,
        locked: !!order.signed_at,
      })
    } catch (e) {
      setActionNote(`Could not open the contract editor — ${e?.message || 'error'}.`)
    }
  }
  // Saves wording overrides (pricing.contractOverrides) + any line-item edits
  // (pricingPatch = the same lineItemLabels/Overrides/… keys the Pricing step
  // writes; addOns when qty steppers were used). One write, one activity entry.
  const saveContractEdits = async ({ overrides, pricingPatch, addOns }) => {
    const pricing = { ...(order.pricing || {}), ...(pricingPatch || {}) }
    if (overrides) pricing.contractOverrides = overrides
    else delete pricing.contractOverrides
    const patch = { pricing }
    if (addOns) patch.add_ons = addOns
    const r = await bulkUpdateOrders([orderId], patch)
    if (!r.ok) return r
    await refreshOrder()
    const what = [
      overrides ? 'custom wording' : 'wording reset to auto',
      pricingPatch || addOns ? 'line items edited' : null,
    ].filter(Boolean).join(' · ')
    logOrderActivity(orderId, {
      type: 'change', field: 'Contract', newValue: what,
      note: 'Edited in the contract editor', actor: await getCurrentStaffName(),
    }).then(() => refreshActivity()).catch(() => {})
    return { ok: true }
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
      // Phase 1 — pass the LIVE order (so empty snapshot fields fall back to live
      // data) + a layout-image fallback (most recent proof image, else an uploaded
      // image) when the current proof's image is missing/broken.
      const isImg = (s) => /\.(jpe?g|png|webp|gif|avif|bmp|svg)(\?|#|$)/i.test(String(s || ''))
      const fallbackImageUrl = proofVers.find(p => p.layout_image_url)?.layout_image_url
        || uploads.find(u => isImg(u.url) || isImg(u.name) || isImg(u.path))?.url
        || completionPhotos[0]?.url
        || null
      const { doc, filename } = await generateApprovalSheetPDF(v, { order, balance: rowBalanceDue(order), signatureImageUrl, fallbackImageUrl, returnDoc: true })
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
    // Pinned signed contract (#C) — private bucket, signed-URL preview, override-only.
    ...(signedContract ? [{
      key: 'signed-contract', kind: 'Contract', label: 'Contract (signed)',
      sub: signedContract.signedAt ? `signed ${fmtDate(signedContract.signedAt)}` : 'signed',
      onOpen: previewSignedContract, signed: true,
    }] : []),
    // Pinned signed approval packet (Phase 3) — same private-bucket, override-only model.
    ...(signedApproval ? [{
      key: 'signed-approval', kind: 'Approval', label: 'Approval (signed)',
      sub: signedApproval.signedAt ? `signed ${fmtDate(signedApproval.signedAt)}` : 'signed',
      onOpen: previewSignedApproval, signedApproval: true,
    }] : []),
    ...proofVers.filter(v => v.layout_image_url).map(v => ({
      key: `proof-${v.id}`, kind: 'Layout proof',
      label: `${v.order_id ? 'Estimate layout' : 'Layout'} v${v.version_number}`,
      sub: v.uploaded_at ? fmtDate(v.uploaded_at) : null, href: v.layout_image_url,
      estimateSheet: v.layout_image_url,
    })),
    ...proofVers.filter(v => v.signature_url).map(v => ({
      key: `sig-${v.id}`, kind: 'Signature', label: `Signature v${v.version_number}`,
      sub: v.approved_by_name ? `by ${v.approved_by_name}` : null, onOpen: () => openSignature(v.signature_url),
    })),
    {
      key: 'contract', kind: 'Document',
      label: signedContract ? 'Contract (draft)' : 'Contract PDF',
      sub: signedContract ? 'draft — superseded by signed' : 'generated on open',
      onOpen: handleOpenContract, draft: !!signedContract,
    },
    ...uploads.map((u, i) => {
      const isCurrentContract = u.name === 'Contract (current).pdf'
      return {
        key: `up-${i}`, kind: 'Upload',
        label: (isCurrentContract && signedContract) ? 'Contract (draft)' : u.name,
        sub: u.createdAt ? fmtDate(u.createdAt) : null, href: u.url,
        path: u.path, deletable: true,
        draft: isCurrentContract && !!signedContract,
      }
    }),
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
        <BackBar onBack={onBack} label={backLabel} />

        {/* ── HEADER (always visible) ─────────────────────────────────────── */}
        <header className="sb-od-header">
          <div className="sb-od-header-main">
            <div className="sb-od-header-top">
              <span className="sb-od-ordernum sb-crm-mono">{order.order_number || 'DRAFT'}</span>
              {isLead && <span className="sb-od-lead-pill">LEAD — NO DEPOSIT</span>}
              <Pill severity={stageTone(order.status)}>{stage.label}</Pill>
              {paymentLabel(pressure.paymentState) && (
                <Pill severity={paymentTone(pressure.paymentState)}>{paymentLabel(pressure.paymentState)}</Pill>
              )}
            </div>
            {famEdit === null ? (
              <h1 className="sb-od-title">
                {familyName}
                <button type="button" title="Edit the family name"
                  onClick={() => setFamEdit(order.primary_lastname || cust.last_name || '')}
                  style={{ font: 'inherit', fontSize: 15, background: 'none', border: 'none', cursor: 'pointer', color: '#9a7209', marginLeft: 10, verticalAlign: 'middle' }}>
                  ✎
                </button>
              </h1>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '4px 0' }}>
                <input autoFocus value={famEdit} onChange={e => setFamEdit(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') saveFamilyName(); if (e.key === 'Escape') setFamEdit(null) }}
                  placeholder="Family name"
                  style={{ font: 'inherit', fontSize: 22, fontWeight: 700, padding: '4px 10px', border: '1.5px solid #9a7209', borderRadius: 8, width: 280 }} />
                <button type="button" disabled={famBusy || !(famEdit || '').trim()} onClick={saveFamilyName}
                  style={{ font: 'inherit', fontSize: 13, fontWeight: 700, background: '#2d7a4f', color: '#fff', border: 'none', borderRadius: 7, padding: '8px 16px', cursor: 'pointer' }}>
                  {famBusy ? 'Saving…' : 'Save'}
                </button>
                <button type="button" disabled={famBusy} onClick={() => setFamEdit(null)}
                  style={{ font: 'inherit', fontSize: 13, background: 'none', border: '1px solid #d8d2c6', borderRadius: 7, padding: '8px 14px', cursor: 'pointer', color: '#6b6256' }}>
                  Cancel
                </button>
              </div>
            )}
            <div className="sb-od-subtitle">
              {primaryDeceased ? <>In memory of {primaryDeceased}{deceased.length > 1 ? ` +${deceased.length - 1}` : ''}</> : <span className="sb-od-missing">No deceased recorded</span>}
            </div>
          </div>
          <div className="sb-od-header-balance">
            <div className="sb-od-balance-label">Balance due</div>
            <div className={`sb-od-balance-value${balance > 0 ? '' : ' sb-od-balance-clear'}`}>{fmtUSD(balance)}</div>
          </div>
        </header>

        {/* ── LEAD BANNER — loud, above everything: no money down yet ────────── */}
        {isLead && (
          <div className="sb-od-lead-banner">
            <span className="sb-od-lead-banner-title">STILL A LEAD — NO DEPOSIT RECEIVED</span>
            <span className="sb-od-lead-banner-sub">
              {order.signed_at
                ? 'Contract is signed but $0 has been collected. Not an active customer yet.'
                : 'Nothing signed, nothing collected. Anything ordered for this job is at our risk.'}
            </span>
          </div>
        )}

        {/* ── QUICK-GLANCE STRIP — read the instant the order opens ──────────── */}
        <div className="sb-od-glance">
          <div className="sb-od-glance-item">
            <div className="sb-od-glance-text">
              <div className="sb-od-glance-label">Cemetery</div>
              <div className="sb-od-glance-value">
                {cem.name || <span className="sb-od-missing">—</span>}
                {plotShort && <span className="sb-od-glance-sub"> · {plotShort}</span>}
              </div>
            </div>
          </div>
          <div className="sb-od-glance-item">
            <div className="sb-od-glance-text">
              <div className="sb-od-glance-label">Contact</div>
              <div className="sb-od-glance-value">
                {customerName(cust) !== '—' ? customerName(cust) : <span className="sb-od-missing">—</span>}
                {cust.phone_primary && <span className="sb-od-glance-sub"> · {fmtPhone(cust.phone_primary)}</span>}
              </div>
            </div>
          </div>
          <div className="sb-od-glance-item">
            <div className="sb-od-glance-text">
              <div className="sb-od-glance-label">Type of order</div>
              <div className="sb-od-glance-value">{orderType || <span className="sb-od-missing">—</span>}</div>
            </div>
          </div>
        </div>

        {/* A6 — "signed contract still needed": a deposit auto-completed the
            contract step, but no real signature is on file yet. Persists until
            the order is signed. */}
        {needsSignedContract(order) && (
          <div className="sb-od-need-signature">
            <span aria-hidden="true">⚠</span>
            <span><strong>Signed contract still needed.</strong> A deposit is logged (contract &amp; deposit steps are checked off), but the customer hasn't signed yet — collect the signature to clear this.</span>
          </div>
        )}

        {/* ── QUICK TASK — type it, hit Add, it's on this order + the Task CC
            (Paul 2026-07-28: "+add Task at the top — auto create a task to
            that order when you type the task in"). */}
        <div className="sb-od-quicktask">
          <input className="sb-od-quicktask-in" value={quickTask} placeholder="+ Add a task for this order — type it and hit Add…"
            onChange={e => setQuickTask(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') addQuickTask() }} />
          <button type="button" className="sb-od-quicktask-go" onClick={addQuickTask} disabled={quickTaskBusy || !quickTask.trim()}>
            {quickTaskBusy ? 'Adding…' : 'Add task'}
          </button>
        </div>

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
          <button type="button" className="sb-od-btn sb-od-btn-strong" onClick={handleOpenContract}>Open contract</button>
          <button type="button" className="sb-od-btn" onClick={openContractEditor}>
            Edit contract{order.pricing?.contractOverrides ? ' ●' : ''}
          </button>
          <button type="button" className="sb-od-btn" onClick={() => setProfileOpen(true)}>View / print customer profile</button>
          <button type="button" className="sb-od-btn sb-od-btn-strong" onClick={openEmailComposer}>Send email</button>
          <button type="button" className="sb-od-btn sb-od-btn-sales" onClick={() => setSalesEmailMode({ mode: 'sales' })}
            title="One email: contract e-sign link + estimate + layout + permit (view only) + any order files">
            Sales email
          </button>
          <span className="sb-od-actions-spacer" />
          <button type="button" className="sb-od-btn" onClick={focusNote}>Add note</button>
          <button type="button" className="sb-od-btn" onClick={() => setCheckJobOpen(true)}
            title="Somebody drives out and inspects before we quote the repair">
            Add check job
          </button>
          <button type="button" className="sb-od-btn" onClick={() => fileRef.current?.click()} disabled={uploadBusy}>
            {uploadBusy ? 'Uploading…' : 'Upload attachment'}
          </button>
          <button type="button" className="sb-od-btn sb-od-btn-appt"
            title="Book an appointment — shows on Today and the Calendar"
            onClick={() => setApptModal({ who: getActiveStaffUser() || STAFF_NAMES[0] || '', date: todayISO(), time: '', what: '', busy: false, err: null })}>
            Add appointment
          </button>
          <button type="button" className="sb-od-btn sb-od-btn-pay" onClick={openPayment}>Record payment</button>
          <button type="button" className="sb-od-btn" style={{ color: '#b3261e', borderColor: '#dda9a4' }}
            title="Permanently delete this order — confirmation required"
            onClick={() => { setDeleteErr(null); setDeleteModal(true) }}>
            Delete
          </button>
          <input ref={fileRef} type="file" style={{ display: 'none' }} onChange={onPickAttachment} />
        </div>
        {actionNote && <div className="sb-od-actionnote">{actionNote}</div>}

        {/* ── EMAIL DRAFTS — parked composers on this order (Paul 2026-07-28:
            "leave as draft… view edit and send… i gotta keep restarting"). */}
        {emailDrafts.length > 0 && (
          <div className="sb-od-drafts">
            <span className="sb-od-drafts-label">Email drafts</span>
            {emailDrafts.map(d => (
              <span key={d.id} className="sb-od-draft">
                <button type="button" className="sb-od-draft-open" onClick={() => openDraft(d)}
                  title="Open this draft — edit and send">
                  {d.kind === 'contract' ? 'Contract to sign' : d.kind === 'sales' ? 'Sales email' : (d.payload?.subject || 'Email')}
                  {d.payload?.to ? ` → ${d.payload.to}` : ''}
                </button>
                <button type="button" className="sb-od-draft-x" title="Delete draft" onClick={() => removeDraft(d)}>×</button>
              </span>
            ))}
          </div>
        )}

        {/* ── STATUS OVERVIEW — where it stands, what's next, what's blocking.
            Reads the SAME engine as the rail (buildPipeline + pressure), so the
            two surfaces can never disagree. The rail stays for tap-to-advance. */}
        <div className="sb-od-status">
          <div className="sb-od-status-top">
            <span className="sb-od-status-label">Status overview</span>
            {order.signed_at ? (
              <span className="sb-od-status-signed">Contract signed {fmtDate(order.signed_at)}</span>
            ) : (
              <button type="button" className={`sb-od-mark-contracted${contractArm ? ' arm' : ''}`} onClick={markContracted}>
                {contractArm ? 'Confirm — mark as contracted' : 'Mark as contracted'}
              </button>
            )}
            <span className="sb-od-status-pct">{overviewPipe.overallPct}% complete</span>
          </div>
          <div className="sb-od-status-bar"><i style={{ width: `${overviewPipe.overallPct}%` }} /></div>
          {/* The plain-words headline (v2, Paul 2026-08-03): where the stone is
              and what it's waiting on, in one sentence. */}
          <div className="sb-od-status-headline">{ovHeadline}</div>
          <div className="sb-od-status-phases">
            {(() => {
              const activeIdx = overviewPipe.phases.findIndex(ph => ph.total > 0 && ph.done < ph.total)
              return overviewPipe.phases.map((ph, i) => (
                <button key={ph.code} type="button"
                  className={`sb-od-ph${ph.total > 0 && ph.done >= ph.total ? ' done' : i === activeIdx ? ' now' : ''}${phasePeek === ph.code ? ' peek' : ''}`}
                  title="Click to see this group's steps"
                  onClick={() => setPhasePeek(p => (p === ph.code ? null : ph.code))}>
                  {ph.label}{ph.total > 0 ? ` ${ph.done}/${ph.total}` : ''}
                </button>
              ))
            })()}
          </div>
          {/* Click a phase → its steps right here. Ticking a later step
              auto-completes the earlier ones in its group (the cascade). */}
          {phasePeek && (() => {
            const ph = overviewPipe.phases.find(p => p.code === phasePeek)
            if (!ph) return null
            return (
              <div className="sb-od-phasepeek">
                {ph.items.length === 0 && <span className="sb-od-phasepeek-empty">No steps in {ph.label} for this order.</span>}
                {ph.items.map(it => (
                  <button key={it.key} type="button" className={`sb-od-peekstep${it.status === 'done' ? ' done' : ''}`}
                    disabled={it.readOnly || !job}
                    title={it.readOnly ? undefined : (it.status === 'done' ? 'Click to un-tick' : 'Click to mark done — earlier steps in this group follow')}
                    onClick={() => handleRailMilestone(it.key, it.status === 'done' ? 'not_started' : 'done')}>
                    <i>{it.status === 'done' ? '✓' : ''}</i>{it.label}
                  </button>
                ))}
              </div>
            )
          })()}
          <div className="sb-od-status-foot">
            <div className="sb-od-status-kv"><b>Next action</b><span>{nra?.label || '—'}</span></div>
            {floorPhaseCode && (
              <div className="sb-od-status-kv"><b>Production</b>
                <span className="sb-od-ovpill sb-od-ovpill-floor">{phaseLabel(floorPhaseCode).toUpperCase()}</span>
              </div>
            )}
            <div className="sb-od-status-kv"><b>Install</b>
              {ovInstalledDone ? <span>Installed</span>
                : installScheduledDate ? <span className="sb-od-install-sched">Scheduled {fmtDate(installScheduledDate)}</span>
                : <span className="sb-od-status-muted">Not scheduled</span>}
            </div>
            <div className="sb-od-status-kv"><b>Due</b>
              {dueText
                ? <span className={`sb-od-ovpill${dueTone2 ? ` sb-od-ovpill-due-${dueTone2}` : ' sb-od-ovpill-quiet'}`}>{dueText}</span>
                : <span>—</span>}
            </div>
            <div className="sb-od-status-kv"><b>Balance</b><span className={balance > 0 ? 'sb-od-status-due' : ''}>{balance > 0 ? `${fmtUSD(balance)} due` : 'Paid in full'}</span></div>
            <div className="sb-od-status-kv"><b>Blocker</b>{overviewPressure.blocker
              ? <span className={`sb-od-ovpill sb-od-ovpill-${overviewPressure.blocker.severity}`}>{overviewPressure.blocker.label}</span>
              : <span>None</span>}</div>
          </div>
          {/* WAITING ON (click a chip → task somebody, prefilled) / ALREADY GOOD */}
          {(waitingOn.length > 0 || alreadyGood.length > 0) && (
            <div className="sb-od-status-lanes">
              <div className="sb-od-lane">
                <b className="sb-od-lane-h sb-od-lane-h-wait">Waiting on</b>
                <span className="sb-od-lane-chips">
                  {waitingOn.length === 0 && <span className="sb-od-status-muted">Nothing</span>}
                  {waitingOn.map(w => (
                    <GateTaskChip key={w.key} label={w.label} taskTitle={w.task} orderId={orderId}
                      onTasked={(who) => { setActionNote(`Tasked ${who}. ✓`); refreshActivity() }} />
                  ))}
                </span>
              </div>
              <div className="sb-od-lane">
                <b className="sb-od-lane-h sb-od-lane-h-good">Already good</b>
                <span className="sb-od-lane-chips">
                  {alreadyGood.length === 0 && <span className="sb-od-status-muted">Nothing yet</span>}
                  {alreadyGood.map(g => <span key={g} className="sb-od-lanechip sb-od-lanechip-good">{g}</span>)}
                </span>
              </div>
            </div>
          )}
          {/* Inline status controls (Paul, 2026-07-10) — the SAME dropdowns as the
              Orders table columns, adjustable right here. Same write paths too. */}
          <div className="sb-od-status-edit">
            <label className="sb-od-sc"><b>Payment</b>
              <select className={`sb-od-tone-${paymentStatusTone(derivePaymentStatus(order))}`} value={derivePaymentStatus(order)} onChange={e => inlinePayment(e.target.value)}>
                {PAYMENT_STATUS.map(s => <option key={s.code} value={s.code}>{s.label}</option>)}
              </select>
            </label>
            {/* Dimensions render only where they exist for this job type
                (inscriptions: no stone/foundation; acid wash & repair: none of
                the three). No job yet doesn't block — the first set creates it. */}
            {statusDimApplies('design', job, order) && (
              <label className="sb-od-sc"><b>Design</b>
                <select className={`sb-od-tone-${designStatusTone(job ? deriveDesignStatus(job) : 'not_created')}`} value={job ? deriveDesignStatus(job) : 'not_created'} onChange={e => inlineDesign(e.target.value)}>
                  {designStatusOptions(job, order).map(s => <option key={s.code} value={s.code}>{s.label}</option>)}
                </select>
              </label>
            )}
            {statusDimApplies('stone', job, order) && (
              <label className="sb-od-sc"><b>Stone / Bronze</b>
                <select className={`sb-od-tone-${stoneStatusTone(job ? deriveStoneStatus(job) : 'not_ordered')}`} value={job ? deriveStoneStatus(job) : 'not_ordered'} onChange={e => inlineStone(e.target.value)}>
                  {stoneStatusOptions(job).map(s => <option key={s.code} value={s.code}>{s.label}</option>)}
                </select>
              </label>
            )}
            <label className="sb-od-sc"><b>Permit</b>
              <select className={`sb-od-tone-${permitStatusTone(order.permit_status || 'unknown')}`} value={order.permit_status || 'unknown'} onChange={e => inlinePermit(e.target.value)}>
                {!PERMIT_SELECTABLE.has(order.permit_status) && (
                  <option value={order.permit_status || 'unknown'} disabled>{permitStatusLabel(order.permit_status || 'unknown')}</option>
                )}
                {PERMIT_STATUS_OPTIONS.map(s => <option key={s.code} value={s.code}>{s.label}</option>)}
              </select>
            </label>
            {statusDimApplies('fdn', job, order) && (
              <label className="sb-od-sc"><b>Foundation</b>
                <select className={`sb-od-tone-${fdnStatusTone(job ? deriveFdnStatus(job) : 'not_in')}`} value={job ? deriveFdnStatus(job) : 'not_in'} onChange={e => inlineFdn(e.target.value)}>
                  {FDN_STATUS.map(s => <option key={s.code} value={s.code}>{s.label}</option>)}
                </select>
              </label>
            )}
            <label className="sb-od-sc"><b>Contract</b>
              <span className="sb-od-sc-pair">
                <select className={`sb-od-tone-${contractSignedTone(!!order.signed_at)}`} value={order.signed_at ? 'signed' : 'unsigned'} onChange={e => inlineSigned(e.target.value === 'signed')}>
                  <option value="unsigned">Unsigned</option>
                  <option value="signed">Signed ✓</option>
                </select>
                <ODDateField value={order.signed_at ? String(order.signed_at).slice(0, 10) : ''}
                  onCommit={v => inlineDateField('signed_at', v)} ariaLabel="Contract date" />
              </span>
            </label>
            <label className="sb-od-sc"><b>Due date</b>
              <ODDateField value={order.target_completion_date ? String(order.target_completion_date).slice(0, 10) : ''}
                tone={dueDateTone(order.target_completion_date)}
                onCommit={v => inlineDateField('target', v)} ariaLabel="Due date" />
            </label>
            <label className="sb-od-sc"><b>Blocker</b>
              <ManualBlockerControl order={order} onSaved={refreshOrder} />
            </label>
          </div>
        </div>

        {/* ── SECTIONS with left-rail nav ───────────────────────────────────── */}
        <div className="sb-od-layout">
          <SectionRail items={railItems} />
          <div className="sb-od-grid">
          {/* 1 — Customer / contact */}
          <Section id="od-customer" title="Customer & contact" headerAction={
            <CardQuickEdit title="Customer & Contact" onOpen={seedCustDraft} onSave={saveCustomer} width={360}>
              {custDraft && (
                <>
                  <CqeRow cols={2}>
                    <CqeText label="First name" value={custDraft.first_name} onChange={v => setCustDraft(d => ({ ...d, first_name: v }))} />
                    <CqeText label="Last name" value={custDraft.last_name} onChange={v => setCustDraft(d => ({ ...d, last_name: v }))} />
                  </CqeRow>
                  <CqeRow cols={2}>
                    <CqeText label="Phone" value={custDraft.phone_primary} onChange={v => setCustDraft(d => ({ ...d, phone_primary: v }))} />
                    <CqeText label="Email" value={custDraft.email} onChange={v => setCustDraft(d => ({ ...d, email: v }))} />
                  </CqeRow>
                  <CqeText label="Address line 1" value={custDraft.address_line1} onChange={v => setCustDraft(d => ({ ...d, address_line1: v }))} />
                  <CqeText label="Address line 2" value={custDraft.address_line2} onChange={v => setCustDraft(d => ({ ...d, address_line2: v }))} />
                  <CqeRow cols={3}>
                    <CqeText label="City" value={custDraft.city} onChange={v => setCustDraft(d => ({ ...d, city: v }))} />
                    <CqeText label="State" value={custDraft.state} onChange={v => setCustDraft(d => ({ ...d, state: v }))} />
                    <CqeText label="ZIP" value={custDraft.zip} onChange={v => setCustDraft(d => ({ ...d, zip: v }))} />
                  </CqeRow>
                  <CqeRow cols={2}>
                    <CqeText label="Secondary phone" value={custDraft.phone_alt} onChange={v => setCustDraft(d => ({ ...d, phone_alt: v }))} />
                    <CqeText label="Secondary email" value={custDraft.email_alt} onChange={v => setCustDraft(d => ({ ...d, email_alt: v }))} />
                  </CqeRow>
                  <CqeText label="Funeral home / referral" value={custDraft.referral_source} onChange={v => setCustDraft(d => ({ ...d, referral_source: v }))} />
                </>
              )}
            </CardQuickEdit>
          }>
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
          <Section id="od-cemetery" title="Cemetery & grave" headerAction={
            <CardQuickEdit title="Cemetery & Grave" onOpen={seedCgDraft} onSave={saveCemeteryGrave} width={360}>
              {cgDraft && (
                <>
                  {/* ONE free-text location line. A legacy order shows its composed
                      old parts as the placeholder; typing saves to grave_location. */}
                  <CqeText label="Grave location" value={cgDraft.grave_location} onChange={v => setCgDraft(d => ({ ...d, grave_location: v }))}
                    placeholder={composeGraveLocation(order) || 'e.g. Sec … · Blk … · Lot …'} />
                  <CqeText label="Grave type" value={cgDraft.plot_type} onChange={v => setCgDraft(d => ({ ...d, plot_type: v }))} />
                  <CqeArea label="Plot / location notes" value={cgDraft.plot_notes} onChange={v => setCgDraft(d => ({ ...d, plot_notes: v }))} />
                </>
              )}
            </CardQuickEdit>
          }>
            <Field label="Cemetery" value={cem.name} />
            <Field label="Address" value={cemAddr.length ? cemAddr.map((l, i) => <div key={i}>{l}</div>) : null} />
            <Field label="Grave location" value={composeGraveLocation(order) || null} />
            <Field label="Grave type" value={humanize(order.plot_type)} hint={order.plot_type ? null : 'from plot_type'} />
            <Field label="Plot / location notes" value={[order.plot_pin_notes, order.plot_other].filter(Boolean).join(' · ')} />
            <Field label="Cemetery requirements" value={cem.notes} />
            {/* Permit + foundation live on their own cards (single source of truth). */}
            <Field label="Foundation status" value={foundationMs ? humanize(foundationMs) : null} hint="from job milestones" />
          </Section>

          {/* 3 — Monument */}
          <Section id="od-monument" title={monumentCardTitle} headerAction={isStoneOrder ? (
            <CardQuickEdit title="Monument Spec & Overrides" onOpen={seedMonDraft} onSave={saveMonument} width={580} saveLabel="Save monument">
              {/* Stone Status — reuses the milestone-backed STONE_STATUS; "Ordered from"
                  carries a vendor from the persistent ordering_vendors list. */}
              {stoneDraft && (
                <>
                  {/* Die + Base each have their own ordering status — sometimes the
                      die is here and the base isn't, and vice versa. Red = not
                      ordered, blue = ordered, green = in stock. */}
                  <CqeRow cols={draftHasBase(monDraft) ? 2 : 1}>
                    <CqeSelect label="Die status" value={stoneDraft.die}
                      className={`sb-od-stone-sel sb-od-stone-${STONE_SIMPLE_TONE[stoneDraft.die] || 'red'}`}
                      options={STONE_SIMPLE.map(s => ({ code: s.code, label: s.label }))}
                      onChange={v => setStoneDraft(d => ({ ...d, die: v }))} />
                    {draftHasBase(monDraft) && (
                      <CqeSelect label="Base status" value={stoneDraft.base}
                        className={`sb-od-stone-sel sb-od-stone-${STONE_SIMPLE_TONE[stoneDraft.base] || 'red'}`}
                        options={STONE_SIMPLE.map(s => ({ code: s.code, label: s.label }))}
                        onChange={v => setStoneDraft(d => ({ ...d, base: v }))} />
                    )}
                  </CqeRow>
                  {!job && <CqeNote>Die/base statuses save on the order now; the pipeline picks them up once the production job exists (created when the order is signed).</CqeNote>}
                  {(stoneDraft.die === 'ordered' || (draftHasBase(monDraft) && stoneDraft.base === 'ordered')) && (
                    <>
                      <CqeSelect label="Ordered from" value={stoneDraft.vendor || ''}
                        options={[
                          { code: '', label: '— pick a vendor —', disabled: true },
                          ...((order.stone_vendor && !vendorList.some(v => v.name === order.stone_vendor)) ? [{ code: order.stone_vendor, label: order.stone_vendor }] : []),
                          ...vendorList.map(v => ({ code: v.name, label: v.name })),
                          { code: NEW_VENDOR, label: '+ New Vendor…' },
                        ]}
                        onChange={v => setStoneDraft(d => ({ ...d, vendor: v }))} />
                      {stoneDraft.vendor === NEW_VENDOR && (
                        <CqeText label="New vendor name" value={stoneDraft.newVendor} onChange={v => setStoneDraft(d => ({ ...d, newVendor: v }))} placeholder="Saved for reuse on future orders" />
                      )}
                    </>
                  )}
                  {/* Purchase record — always editable once past not-ordered (and
                      entering a date on a not-ordered stone advances it). */}
                  <CqeRow cols={2}>
                    <CqeDate label="Date stone ordered" value={stoneDraft.orderedDate} onChange={v => setStoneDraft(d => ({ ...d, orderedDate: v }))} />
                    <CqeText label="Purchase acknowledgement #" value={stoneDraft.ack} onChange={v => setStoneDraft(d => ({ ...d, ack: v }))} placeholder="e.g. Rock of Ages ack #4512" />
                  </CqeRow>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                    {stoneDraft.ackUrl
                      ? <a href={stoneDraft.ackUrl} target="_blank" rel="noreferrer" className="sb-od-link">View acknowledgement file</a>
                      : <span style={{ fontSize: 12, color: '#8a8a85' }}>No acknowledgement file attached.</span>}
                    <label className="sb-od-link" style={{ cursor: 'pointer' }}>
                      {stoneDraft.ackUrl ? 'Replace file…' : 'Upload file…'}
                      <input type="file" style={{ display: 'none' }} onChange={async (e) => {
                        const f = e.target.files?.[0]; e.target.value = ''
                        if (!f) return
                        const up = await uploadOrderAttachment(orderId, f)
                        if (up.ok) setStoneDraft(d => ({ ...d, ackUrl: up.url }))
                      }} />
                    </label>
                  </div>
                  <div className="sb-od-cqe-divider">Monument spec & overrides</div>
                </>
              )}
              {/* Reuse the EXACT New Order monument editor (shape/size/color/polish/top
                  + shared BaseSection + Die/Base description overrides). Its of- and
                  sm- prefixed CSS is class-scoped, so mounting it here does not bleed
                  onto the sb- detail page behind the popover. */}
              <style>{salesModeStyles}</style>
              <style>{OF_CSS}</style>
              {monDraft && <MonumentCard order={monDraft} update={monUpdate} updatePricing={monUpdatePricing} />}
            </CardQuickEdit>
          ) : null}>
            <Field label="Type" value={orderTypeLabels(order, job).join(' / ')} />
            {isStoneOrder && (
              <>
                {/* ONE clean composed spec line (size · top · polish · color · on base),
                    override-aware. Inscription removed from this card per spec. */}
                <Field label="Spec" value={monumentLine || null} />
                <Field label="Base" value={baseSummary} />
                {/* Die + Base ordering statuses — red not ordered / blue ordered /
                    green in stock (Paul, 2026-07-10). */}
                {(() => {
                  const fallback = job ? stoneToSimple(deriveStoneStatus(job)) : null
                  const dieS = order.die_stone_status || fallback
                  const baseS = order.base_stone_status || fallback
                  // Paul 2026-07-22: a checkmark rides next to the status —
                  // blue once the stone is ordered, green once it's arrived.
                  const CHECK_TINT = { ordered: '#2f6fd6', in_stock: '#2d7a4f' }
                  const pill = (s) => s ? (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
                      <Pill severity={STONE_SIMPLE_TONE[s] || 'bronze'}>{stoneSimpleLabel(s)}</Pill>
                      {CHECK_TINT[s] && <span style={{ color: CHECK_TINT[s], fontWeight: 800, fontSize: 15, lineHeight: 1 }}>✓</span>}
                    </span>
                  ) : null
                  return (
                    <>
                      <Field label="Die status" value={pill(dieS)} hint={dieS ? null : 'set via ⋯'} />
                      {orderHasBase(baseConfig, _baseShape) && (
                        <Field label="Base status" value={pill(baseS)} hint={baseS ? null : 'set via ⋯'} />
                      )}
                      <Field label="Vendor" value={order.stone_vendor || null} />
                    </>
                  )
                })()}
                <Field label="Stone ordered" value={order.stone_ordered_date ? fmtDate(order.stone_ordered_date) : null}
                  hint={order.stone_ordered_date ? null : 'date not recorded — add it via ⋯'} />
                <Field label="Purchase ack" value={(order.stone_purchase_ack || order.stone_purchase_ack_url) ? (
                  <span>
                    {order.stone_purchase_ack || ''}
                    {order.stone_purchase_ack_url && (
                      <>{order.stone_purchase_ack ? ' · ' : ''}<a href={order.stone_purchase_ack_url} target="_blank" rel="noreferrer" className="sb-od-link">view file</a></>
                    )}
                  </span>
                ) : null} />
              </>
            )}
            {/* Deceased / Add-ons / Proof removed from this box (Paul, 2026-07-10) —
                deceased & add-ons live on the contract/line items, proof lives on
                the Design/Proof card. */}
          </Section>

          {/* 3a2 — Production status — reads/writes the SAME job_components the Jobs
              board uses (two-way, source:'order'). One source of truth per piece. */}
          <Section id="od-production" title="Production status">
            <OrderProductionStatus orderId={orderId} />
          </Section>

          {/* 1b — DESIGN SUMMARY (Paul 2026-08-03): what we're making, at a
              glance — the catalog pick, the verse, every name (with space for
              the next), and the design description. New stone / inscription /
              bronze orders. Reads what the order already holds — designs[],
              deceased[], inscription.epitaph, design_preferences. */}
          {showMake && (() => {
            const designsArr = Array.isArray(order.designs) ? order.designs : []
            const primaryDesign = designsArr[0] || null
            const altCount = Math.max(0, designsArr.length - 1)
            const primaryImg = primaryDesign?.snapshot?.img || null
            const primaryName = primaryDesign?.snapshot?.name || primaryDesign?.snapshot?.title || ''
            const verse = (order.inscription?.epitaph || '').trim()
            const makeNotes = (order.design_preferences || '').trim() || (order.inscription?.customNotes || '').trim()
            const people = Array.isArray(order.deceased) ? order.deceased : []
            const nameOf = (d) => [d.firstName, d.middleName, d.lastName].filter(Boolean).join(' ').toUpperCase()
            const yearsOf = (d) => {
              const b = String(d.dateOfBirth || '').slice(0, 4), e = String(d.dateOfDeath || '').slice(0, 4)
              return b && e ? `${b} – ${e}` : b ? `b. ${b}` : e ? `d. ${e}` : ''
            }
            const realPeople = people.filter(d => !d.isReserved && (d.firstName || d.lastName))
            const reservedCount = people.filter(d => d.isReserved).length
            return (
              <Section id="od-make" title="Design — what we're making" headerAction={
                <CardQuickEdit title="Design summary" onOpen={seedMakeDraft} onSave={saveMake} width={380}>
                  {makeDraft && (
                    <>
                      <CqeArea label="Verse / epitaph" value={makeDraft.epitaph} onChange={v => setMakeDraft(d => ({ ...d, epitaph: v }))} rows={2} />
                      <CqeArea label="Design notes" value={makeDraft.notes} onChange={v => setMakeDraft(d => ({ ...d, notes: v }))} rows={4}
                        hint="What the design should be — names edit on the order form" />
                    </>
                  )}
                </CardQuickEdit>
              }>
                <div className="sb-od-make">
                  <div className="sb-od-make-img">
                    {primaryImg
                      ? <img src={primaryImg} alt="Catalog design" loading="lazy" />
                      : <div className="sb-od-make-noimg">No catalog design picked</div>}
                    <div className="sb-od-make-imgcap">
                      {primaryImg ? `Catalog${primaryName ? ` · ${primaryName}` : ''} · primary${altCount ? ` + ${altCount} alternate${altCount === 1 ? '' : 's'}` : ''}` : 'Pick one in the Design step of the wizard'}
                    </div>
                  </div>
                  <div className="sb-od-make-rows">
                    {verse && <div className="sb-od-make-row"><b>Verse</b><span className="sb-od-make-verse">“{verse}”</span></div>}
                    {realPeople.map((d, i) => (
                      <div key={i} className="sb-od-make-row"><b>Name {i + 1}</b>
                        <span className="sb-od-make-name">{nameOf(d)}{yearsOf(d) ? <em> · {yearsOf(d)}</em> : null}</span>
                      </div>
                    ))}
                    {realPeople.length === 0 && <div className="sb-od-make-row"><b>Names</b><span className="sb-od-status-muted">None entered yet</span></div>}
                    {Array.from({ length: reservedCount }, (_, i) => (
                      <div key={`r${i}`} className="sb-od-make-row"><b>Name {realPeople.length + i + 1}</b>
                        <span className="sb-od-make-reserved">Space reserved</span>
                      </div>
                    ))}
                    {reservedCount === 0 && realPeople.length > 0 && realPeople.length < 3 && (
                      <div className="sb-od-make-row"><b>Name {realPeople.length + 1}</b>
                        <span className="sb-od-make-reserved">Space for another name</span>
                      </div>
                    )}
                    {makeNotes && <div className="sb-od-make-row sb-od-make-notes"><b>Notes</b><span>{makeNotes}</span></div>}
                  </div>
                </div>
              </Section>
            )
          })()}

          {/* 3b — Design / proof quick-view (item B) */}
          <Section id="od-design" title="Design / proof" headerAction={
            <CardQuickEdit title="Design / Proof" onOpen={seedDesignDraft} onSave={saveDesignNotes} width={340} saveLabel="Save notes">
              <CqeNote>Design status <strong>{DESIGN_6[design6]}</strong>{_currentProof?.approved_at ? ` · approved ${fmtDate(_currentProof.approved_at)}${_currentProof.approved_by_name ? ` by ${_currentProof.approved_by_name}` : ''}` : ''}{_currentProof?.signature_method ? ` · ${humanize(_currentProof.signature_method)}` : ''}</CqeNote>
              <CqeArea label="Internal design notes" value={designNotesDraft} onChange={setDesignNotesDraft} rows={4} hint="(on the current proof)" />
              <div className="sb-od-cqe-divider">Customer approval</div>
              <CqeNote>Generate / copy / revoke the approval link on the card. Email it directly here:</CqeNote>
              {emailLinkMsg && <div className={emailLinkMsg.type === 'ok' ? 'sb-od-cqe-okmsg' : 'sb-cqe-err'}>{emailLinkMsg.text}</div>}
              <button type="button" className="sb-cqe-btn" onClick={emailApprovalLink}>
                {'Email approval link (preview first)'}
              </button>
              {signedApproval && (
                <button type="button" className="sb-cqe-btn" onClick={previewSignedApproval}>View signed approval</button>
              )}
            </CardQuickEdit>
          }>
            {reapprovalText && (
              <div className="sb-od-reapproval">{reapprovalText}</div>
            )}
            {/* THE CHANGE LOOP — what the family (or staff) asked to change,
                loud and first. This text was stored all along
                (approval_links.change_notes / job_events) but never rendered
                (Paul, 2026-07-15: "i cant see the changes requested"). */}
            {designThread.length > 0 && (
              <div className="sb-od-changes-panel">
                <div className="sb-od-changes-head">Changes requested</div>
                {designThread.slice(0, 6).map(e => (
                  <div key={e.id} className={`sb-od-change-entry${e.kind === 'reply' ? ' reply' : ''}`}>
                    <span className="sb-od-change-by">
                      {e.kind === 'reply' ? `${e.by} replied` : `${e.by} requested changes`}
                      {e.versionNumber ? ` (v${e.versionNumber})` : ''}
                      {e.at ? ` · ${fmtDate(e.at)}` : ''}
                    </span>
                    <span className="sb-od-change-note">“{e.note}”</span>
                  </div>
                ))}
              </div>
            )}
            {/* ONE adjustable status box (Paul, 2026-07-10) — same dropdown + write
                path as the Orders table Design column; the chip color follows the
                selected status. Stone spec / inscription rows removed — they were
                duplicates of the Monument card. */}
            <Field label="Design status" value={
              job ? (
                <select className={`sb-od-sc-select sb-od-tone-${designStatusTone(deriveDesignStatus(job))}`}
                  value={deriveDesignStatus(job)} onChange={e => inlineDesign(e.target.value)} aria-label="Set design status">
                  {DESIGN_STATUS.map(s => <option key={s.code} value={s.code}>{s.label}</option>)}
                </select>
              ) : <Pill severity="bronze">No job yet</Pill>
            } />
            {_currentProof?.notes && <Field label="Internal design notes" value={_currentProof.notes} />}
            {(() => {
              const proof = proofVers.find(p => p.is_current) || proofVers[0]
              if (!proof) {
                return (
                  <div className="sb-od-empty-inline">
                    No proof yet — <button type="button" className="sb-od-link" onClick={() => handleOpenPhase('design')}>open the Design hub →</button>
                  </div>
                )
              }
              const viewProof = () => proof.layout_image_url && openPreview(`Layout v${proof.version_number}`, proof.layout_image_url, '', false)
              const statusText = proof.approved_at ? `Approved ${fmtDate(proof.approved_at)}` : (proof.sent_at ? 'Awaiting customer approval' : 'Draft')
              return (
                <div className="sb-od-design-proof">
                  <button type="button" className="sb-od-design-thumb" onClick={viewProof} title="View proof">
                    {proof.layout_image_url
                      ? <img src={proof.layout_image_url} alt={`Layout v${proof.version_number}`} loading="lazy" />
                      : <span className="sb-od-design-noimg">No image</span>}
                  </button>
                  <div className="sb-od-design-meta">
                    <div><strong>Proof v{proof.version_number}</strong>{proof.is_current ? ' · current' : ''}</div>
                    <div>{statusText}</div>
                    {proof.layout_image_url && <button type="button" className="sb-od-link" onClick={viewProof}>View proof</button>}
                    {!proof.approved_at && (
                      <button type="button" className="sb-od-link sb-od-mark-approved" onClick={markProofApproved}
                        title="Already approved by the family (paper / in person)? Mark it approved — no customer link needed.">
                        Mark approved
                      </button>
                    )}
                  </div>
                </div>
              )
            })()}

            {/* Send for approval (Phase 4) — token link for the customer.
                Bronze flow (Paul, 2026-07-08): upload the bronze proof image
                right here → Send for approval → Email (preview) → notified
                by email when they sign or request changes. */}
            {/* Drop zone works at ANY status — drop an already-approved layout,
                then hit "Mark approved" on it (Paul, 2026-07-10). */}
            <div
              className={`sb-od-proof-drop${proofDragOver ? ' over' : ''}`}
              onDragOver={e => { e.preventDefault(); setProofDragOver(true) }}
              onDragLeave={() => setProofDragOver(false)}
              onDrop={onDropProofImage}
              onClick={() => proofFileRef.current?.click()}
              role="button" tabIndex={0}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') proofFileRef.current?.click() }}
            >
              <input ref={proofFileRef} type="file" accept="image/jpeg,image/png,image/webp" style={{ display: 'none' }} onChange={onPickProofImage} />
              {proofUpBusy
                ? 'Uploading…'
                : 'Drop a layout image here (or click to browse) — becomes the next proof version'}
            </div>
            <div className="sb-od-approval-send">
              <button type="button" className="sb-od-btn sb-od-btn-primary" disabled={sendBusy} onClick={handleSendForApproval}>
                {sendBusy ? 'Generating…' : 'Send for approval'}
              </button>
              <button type="button" className="sb-od-btn" onClick={emailApprovalLink}
                title="Opens the email composer prefilled with the approval link — preview, then hit Send">
                Email link…
              </button>
              <button type="button" className="sb-od-btn" onClick={() => handleOpenPhase('design')}
                title="The Design hub — layout queue, proof versions, design tasks">
                Open Design hub
              </button>
              {sentLink && (
                <div className="sb-od-approval-link">
                  <input className="sb-od-note-input" readOnly value={sentLink} onFocus={e => e.target.select()} />
                  <button type="button" className="sb-od-link" onClick={() => navigator.clipboard?.writeText(sentLink)}>Copy link</button>
                  <button type="button" className="sb-od-link" onClick={() => navigator.clipboard?.writeText(`Your monument layout is ready for approval: ${sentLink}`)}>Copy message</button>
                </div>
              )}
              {approvalLinks.length > 0 && (
                <div className="sb-od-approval-status">
                  {approvalLinks.map(l => {
                    const lab = { pending: 'Sent', viewed: 'Viewed', signed: 'Signed', changes_requested: 'Changes requested', expired: 'Expired', revoked: 'Revoked' }[l.displayStatus] || l.displayStatus
                    const when = l.changes_requested_at || l.signed_at || l.viewed_at || l.created_at
                    // Copy/re-send the SAME link anytime it's still active (Sent /
                    // Viewed) — no re-upload. Signed → no re-send (locked); rejected /
                    // expired / revoked → read-only status only.
                    const canCopy = (l.displayStatus === 'pending' || l.displayStatus === 'viewed') && !!l.share_url
                    return (
                      <div key={l.id} className="sb-od-approval-row">
                        <span className={`sb-od-approval-badge sb-od-approval-${l.displayStatus}`}>{lab}</span>
                        <span className="sb-od-approval-when">{when ? fmtDate(when) : ''}</span>
                        {l.viewed_at && l.displayStatus !== 'viewed' && (
                          <span className="sb-od-approval-when" title="When the family opened the link">viewed {fmtDate(l.viewed_at)}</span>
                        )}
                        {canCopy && (
                          <>
                            <button type="button" className="sb-od-link" onClick={() => navigator.clipboard?.writeText(l.share_url)}>Copy link</button>
                            <button type="button" className="sb-od-link" onClick={() => navigator.clipboard?.writeText(`Your monument layout is ready for approval: ${l.share_url}`)}>Copy message</button>
                          </>
                        )}
                        {(l.displayStatus === 'pending' || l.displayStatus === 'viewed') && (
                          <button type="button" className="sb-od-link sb-od-attach-del" onClick={() => handleRevokeLink(l.id)}>Revoke</button>
                        )}
                        {l.displayStatus === 'changes_requested' && l.change_notes && (
                          <span className="sb-od-approval-note">“{String(l.change_notes).trim()}”</span>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </Section>

          {/* 4 — Financial */}
          <Section id="od-financial" title="Financial" headerAction={
            <CardQuickEdit title="Add a Customer Payment" onOpen={seedPayDraft} onSave={savePaymentQuick} width={320} saveLabel="Record payment">
              {payDraft && (
                <>
                  <CqeNote>A <strong>customer</strong> payment — reduces the balance and syncs with the Payments tab. (Permit fees are recorded separately as an outgoing expense and never appear here.)</CqeNote>
                  <CqeRow cols={2}>
                    <CqeText label="Amount" type="number" value={payDraft.amount} onChange={v => setPayDraft(d => ({ ...d, amount: v }))} placeholder="0.00" />
                    <CqeSelect label="Method" value={payDraft.method} options={PAY_METHODS} onChange={v => setPayDraft(d => ({ ...d, method: v }))} />
                  </CqeRow>
                  <CqeRow cols={2}>
                    <CqeSelect label="Type" value={payDraft.type} options={PAY_TYPES} onChange={v => setPayDraft(d => ({ ...d, type: v }))} />
                    <CqeDate label="Received" value={payDraft.receivedAt} onChange={v => setPayDraft(d => ({ ...d, receivedAt: v }))} />
                  </CqeRow>
                  <CqeText label="Check # / reference" value={payDraft.ref} onChange={v => setPayDraft(d => ({ ...d, ref: v }))} />
                  <CqeNote>Balance after: <strong>{fmtUSD(Math.max(0, balance - (Number(payDraft.amount) || 0)))}</strong></CqeNote>
                </>
              )}
            </CardQuickEdit>
          }>
            <Field label="Contract total" value={total > 0 ? fmtUSD(total) : null} />
            <Field label="Collected" value={fmtUSD(paid)} />
            <Field label="Balance due" value={fmtUSD(balance)} />

            {/* ⭐ Just-saved payment — Print + Email + Download right after save. */}
            {lastReceiptPayment && (
              <div style={{ margin: '8px 0', padding: '10px 12px', background: '#f1f7f2', border: '1px solid #cfe6d4', borderRadius: 8 }}>
                <div className="sb-od-field-label" style={{ color: '#2d7a4f' }}>Payment recorded — receipt</div>
                <ReceiptActions order={receiptOrder} payment={lastReceiptPayment} />
                <button type="button" className="sb-od-link" onClick={() => setLastReceiptPayment(null)}>Dismiss</button>
              </div>
            )}

            {/* Editable payment history — edit ANY field incl. locked amount (no trail); void; per-row receipt. */}
            <div style={{ marginTop: 6 }}>
              <div className="sb-od-field-label">Payments made</div>
              {rawPayments.length === 0 && <div className="sb-od-empty-inline">No payments yet.</div>}
              {(() => { let _run = 0; return rawPayments.map(p => {
                if (p.locked ?? true) _run += Number(p.amount) || 0
                const _after = total > 0 ? Math.max(0, total - _run) : null
                return (editPay?.id === p.id ? (
                <div key={p.id} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, padding: '8px 0', borderTop: '1px solid #f0ece1' }}>
                  <input type="number" className="sb-od-note-input" value={editPay.amount} onChange={e => setEditPay(s => ({ ...s, amount: e.target.value }))} placeholder="Amount" />
                  <select className="sb-od-note-input" value={editPay.method} onChange={e => setEditPay(s => ({ ...s, method: e.target.value }))}>
                    {PAY_METHODS.map(o => <option key={o.code} value={o.code}>{o.label}</option>)}
                  </select>
                  <input type="date" className="sb-od-note-input" value={editPay.receivedAt} onChange={e => setEditPay(s => ({ ...s, receivedAt: e.target.value }))} />
                  <input type="text" className="sb-od-note-input" value={editPay.ref} onChange={e => setEditPay(s => ({ ...s, ref: e.target.value }))} placeholder={editPay.method === 'zelle' ? 'Zelle confirmation #' : 'Reference / check #'} />
                  <div className="sb-od-inline-actions" style={{ gridColumn: '1 / -1' }}>
                    <button type="button" className="sb-od-btn sb-od-btn-primary" disabled={payRowBusy === p.id} onClick={saveEditPay}>{payRowBusy === p.id ? 'Saving…' : 'Save'}</button>
                    <button type="button" className="sb-od-link" onClick={() => setEditPay(null)}>Cancel</button>
                  </div>
                </div>
              ) : (
                <div key={p.id} style={{ padding: '8px 0', borderTop: '1px solid #f0ece1', cursor: 'pointer' }}
                  onClick={() => setReceiptPreview({ payment: p })} title="View receipt">
                  <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                    <span>{fmtUSD(p.amount)} · {humanize(p.method) || '—'}{p.receivedAt ? ` · ${fmtDate(p.receivedAt)}` : ''}{p.ref ? ` · #${p.ref}` : ''}{p.locked ? '' : ' (draft)'}</span>
                    <span className="sb-od-inline-actions">
                      {_after != null && (p.locked ?? true) && <span className="sb-od-pay-run">bal after: {fmtUSD(_after)}</span>}
                      <button type="button" className="sb-od-link" onClick={e => { e.stopPropagation(); startEditPay(p) }}>Edit</button>
                      <button type="button" className="sb-od-link" onClick={e => { e.stopPropagation(); voidPay(p) }}>Void</button>
                    </span>
                  </div>
                  <div onClick={e => e.stopPropagation()}>
                    <ReceiptActions order={receiptOrder} payment={p} />
                  </div>
                </div>
              )) }) })()}
              {payRowErr && <div className="sb-msg sb-msg-err" style={{ marginTop: 6 }}>{payRowErr}</div>}
            </div>

            <div className="sb-od-inline-actions" style={{ marginTop: 8 }}>
              <button type="button" className="sb-od-link" onClick={handleOpenContract}>Open contract PDF</button>
            </div>

            {/* Quote Hub — send for the owner's final approval. Appears on every
                order regardless of how it was created. */}
            <div className="sb-od-quote">
              <QuoteStatusBlock status={order.quote_status} onSend={sendToQuoteHub} />
            </div>
          </Section>

          {/* 4b — Permit */}
          <Section id="od-permit" title="Permit & Foundation" headerAction={
            <CardQuickEdit title="Permit & Foundation" onOpen={seedPermitDraft} onSave={savePermit} width={360}>
              {permitDraft && (() => {
                const permitOpts = PERMIT_SELECTABLE.has(permitDraft.permit_status)
                  ? PERMIT_STATUS_OPTIONS
                  : [{ code: permitDraft.permit_status || 'unknown', label: permitStatusLabel(permitDraft.permit_status || 'unknown'), disabled: true }, ...PERMIT_STATUS_OPTIONS]
                return (
                  <>
                    <CqeSelect label="Permit status" value={permitDraft.permit_status} options={permitOpts} onChange={v => setPermitDraft(d => ({ ...d, permit_status: v }))} />
                    <CqeSelect label="Permit form" value={permitDraft.permit_form || ''} options={[{ code: '', label: '—' }, { code: 'cemetery', label: "Cemetery's own form" }, { code: 'shevco', label: 'Shevco permit (our form)' }]} onChange={v => setPermitDraft(d => ({ ...d, permit_form: v }))} />
                    <CqeRow cols={2}>
                      <CqeDate label="Submitted date" value={permitDraft.permit_filed_at} onChange={v => setPermitDraft(d => ({ ...d, permit_filed_at: v }))} />
                      <CqeDate label="Approved date" value={permitDraft.permit_approved_at} onChange={v => setPermitDraft(d => ({ ...d, permit_approved_at: v }))} />
                    </CqeRow>
                    {permitDraft.permit_status === 'denied' && (
                      <CqeDate label="Denied date" value={permitDraft.permit_denied_at} onChange={v => setPermitDraft(d => ({ ...d, permit_denied_at: v }))} />
                    )}

                    <div className="sb-od-cqe-divider">Permit fee (outgoing expense)</div>
                    <CqeNote>The permit fee is money the shop pays OUT (to the township / cemetery). Recording it logs an <strong>outgoing expense</strong> — it does <strong>NOT</strong> affect the customer’s balance and is never a customer payment.</CqeNote>
                    {permitExpenses.length > 0 && (
                      <div className="sb-od-cqe-paid">
                        {permitExpenses.map(p => (
                          <div key={p.id} className="sb-od-cqe-paid-row">
                            <span>✓ {fmtUSD(p.amount)}{p.reference ? ` · ck #${p.reference}` : ''} · {fmtDate(p.paid_date)} → {p.payee}</span>
                            <button type="button" className="sb-od-cqe-paid-x" disabled={feeBusy}
                              title="Remove this permit fee (also deletes it from Payments › Outgoing)"
                              onClick={() => removePermitFee(p)}>×</button>
                          </div>
                        ))}
                      </div>
                    )}
                    <CqeText label="Paid to (payee)" value={feeDraft.payee} onChange={v => setFeeDraft(f => ({ ...f, payee: v }))} placeholder={cem.name || 'Township / cemetery'} />
                    <CqeRow cols={2}>
                      <CqeText label="Amount" type="number" value={feeDraft.amount} onChange={v => setFeeDraft(f => ({ ...f, amount: v }))} placeholder="0.00" />
                      <CqeText label="Check # / notes" value={feeDraft.ck} onChange={v => setFeeDraft(f => ({ ...f, ck: v }))} />
                    </CqeRow>
                    <CqeRow cols={2}>
                      <CqeDate label="Paid date" value={feeDraft.date} onChange={v => setFeeDraft(f => ({ ...f, date: v }))} />
                      <CqeSelect label="Method" value={feeDraft.method} options={PAY_METHODS} onChange={v => setFeeDraft(f => ({ ...f, method: v }))} />
                    </CqeRow>
                    {feeMsg && <div className="sb-cqe-err">{feeMsg.text}</div>}
                    <button type="button" className="sb-cqe-btn sb-od-cqe-fee-btn" onClick={recordPermitFee} disabled={feeBusy}>
                      {feeBusy ? 'Recording…' : 'Record permit payment (outgoing)'}
                    </button>
                  </>
                )
              })()}
            </CardQuickEdit>
          }>
            <Field label="Permit status" value={<Pill severity={permitTone(order.permit_status)}>{permitStatusLabel(order.permit_status)}</Pill>} />
            {readyBlocked && <Field label="⚠ Blocking install" value="Stone is ready to set but the permit isn't approved." />}
            {/* Everything in front of you (Paul, 2026-07-07): submitted = date +
                what was paid (amount · check # · date); approved = date; denied =
                date + fix-it flag. */}
            <Field label="Submitted" value={order.permit_filed_at ? fmtDate(order.permit_filed_at) : null}
              hint={order.permit_filed_at ? null : 'not submitted yet'} />
            {order.permit_status === 'denied' ? (
              <Field label="Denied" value={
                <span style={{ color: '#B3261E', fontWeight: 600 }}>
                  {order.permit_denied_at ? fmtDate(order.permit_denied_at) : 'date not set'} — needs a fix / refile
                </span>
              } />
            ) : (
              <Field label="Approved" value={order.permit_approved_at ? fmtDate(order.permit_approved_at) : null}
                hint={order.permit_approved_at ? null : 'not approved yet'} />
            )}
            {/* Permit FEE = OUTGOING shop expense (outgoing_payments) — NOT a customer
                payment and does NOT reduce balance. Recorded in the ⋯ above. */}
            <Field label="Paid (outgoing)" value={permitExpenses.length
              ? permitExpenses.map(p => <div key={p.id}>{fmtUSD(p.amount)}{p.reference ? ` · ck #${p.reference}` : ''} · {fmtDate(p.paid_date)}{p.payee ? ` → ${p.payee}` : ''}</div>)
              : null} hint={permitExpenses.length ? 'paid out — not a customer payment' : 'none recorded — add it via ⋯'} />
            {/* Foundation lives with the permit (Paul 2026-07-21) — most permits
                ARE for a cemetery foundation. Shevco/Strip routes the job onto
                the foundation work list; both selects commit instantly. */}
            <Field label="Permit form" value={
              <select className="sb-od-fdn-select" value={order.permit_form || ''}
                onChange={e => savePermitForm(e.target.value)}>
                <option value="">—</option>
                <option value="cemetery">Cemetery's own form</option>
                <option value="shevco">Shevco permit (our form)</option>
              </select>
            } hint={order.permit_form === 'shevco' ? 'Shevco form — Admin is tasked to build it in Permit Builder' : null} />
            <Field label="Foundation by" value={
              <select className="sb-od-fdn-select" value={order.foundation_type || ''}
                onChange={e => saveFoundationBy(e.target.value)}>
                <option value="">—</option>
                <option value="Cemetery Foundation">Cemetery Foundation</option>
                <option value="Our Foundation">Shevco Foundation</option>
                <option value="Strip">Strip (Shevco)</option>
              </select>
            } hint={(order.foundation_type === 'Our Foundation' || order.foundation_type === 'Strip') ? 'on the Shevco foundation list' : null} />
            <Field label="Foundation status" value={
              <select className="sb-od-fdn-select" value={deriveFdnStatus(job)}
                onChange={e => inlineFdn(e.target.value)}>
                {FDN_STATUS.map(s => <option key={s.code} value={s.code}>{s.label}</option>)}
              </select>
            } />
          </Section>

          {/* 5 — Related job */}
          <Section id="od-job" title="Related job">
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
          <Section id="od-attachments" title="Attachments" span={2}>
            {attachmentRows.length === 0 ? (
              <div className="sb-od-empty-inline">No attachments yet.</div>
            ) : (
              <div className="sb-od-attach-list">
                {attachmentRows.map(a => (
                  <div key={a.key} className={`sb-od-attach-row${(a.signed || a.signedApproval) ? ' sb-od-attach-row-signed' : ''}${a.draft ? ' sb-od-attach-row-draft' : ''}`}>
                    <span className="sb-od-attach-kind">{a.kind}</span>
                    <span className="sb-od-attach-label">
                      {a.label}
                      {(a.signed || a.signedApproval) && <span className="sb-od-attach-badge-signed">SIGNED</span>}
                      {a.draft && <span className="sb-od-attach-badge-draft">DRAFT</span>}
                    </span>
                    {a.sub && <span className="sb-od-attach-sub">{a.sub}</span>}
                    {a.href ? (
                      <button type="button" className="sb-od-link sb-od-attach-open" onClick={() => openPreview(a.label, a.href, '', false)}>Preview</button>
                    ) : (
                      <button type="button" className="sb-od-link sb-od-attach-open" onClick={a.onOpen}>Preview</button>
                    )}
                    {a.href && (
                      /* Supabase public URLs honor ?download=<name> with a
                         Content-Disposition: attachment response. */
                      <a className="sb-od-link sb-od-attach-open"
                        href={`${a.href}${a.href.includes('?') ? '&' : '?'}download=${encodeURIComponent((a.label || 'file').replace(/[^\w.() -]+/g, '_'))}`}>
                        Download
                      </a>
                    )}
                    {a.estimateSheet && (
                      <button type="button" className="sb-od-link sb-od-attach-open" disabled={sheetBusy}
                        title="The layout on a one-page estimate — line items with per-item prices hidden, final price shown"
                        onClick={() => downloadEstimateSheet(a.estimateSheet)}>
                        {sheetBusy ? 'Building…' : 'Estimate sheet'}
                      </button>
                    )}
                    {a.signed && (
                      <button type="button" className="sb-od-link sb-od-attach-del" onClick={() => setOverrideModal({ reason: '', busy: false, error: null })}>Override</button>
                    )}
                    {a.signedApproval && (
                      <button type="button" className="sb-od-link sb-od-attach-del" onClick={() => setApprovalOverride({ reason: '', busy: false, error: null })}>Override</button>
                    )}
                    {a.deletable && a.path && (
                      <button type="button" className="sb-od-link sb-od-attach-del" onClick={() => setDelAttach({ path: a.path, name: a.label })}>Delete</button>
                    )}
                  </div>
                ))}
              </div>
            )}
            <div className="sb-od-inline-actions">
              <button type="button" className="sb-od-link" onClick={() => fileRef.current?.click()} disabled={uploadBusy}>
                {uploadBusy ? 'Uploading…' : '+ Upload attachment'}
              </button>
              {!signedContract && (
                <button type="button" className="sb-od-link" onClick={() => setSignModal({ file: null, busy: false, error: null })}>
                  ✓ Mark contract signed
                </button>
              )}
            </div>
          </Section>

          {/* 7b — Completion photos (ITEM 4): job-site photos captured at task
              completion in the Scheduler/Calendar. Read-only here. */}
          {completionPhotos.length > 0 && (
            <Section id="od-photos" title="Completion photos" span={2}>
              <div className="sb-od-completion-grid">
                {completionPhotos.map(p => (
                  <button type="button" key={p.path} className="sb-od-completion-thumb" onClick={() => openPreview(p.name, p.url, '', false)} title={p.name}>
                    <img src={p.url} alt={p.name} loading="lazy" />
                  </button>
                ))}
              </div>
            </Section>
          )}

          {/* 8 — Activity log (#4): changes / notes / tasks, newest first */}
          <Section id="od-activity" title="Activity" span={2}>
            <div className="sb-od-act-actions">
              <button type="button" className="sb-od-link" onClick={() => setActOpen(actOpen === 'activity' ? null : 'activity')}>+ Add activity</button>
              <button type="button" className="sb-od-link" onClick={() => setActOpen(actOpen === 'task' ? null : 'task')}>+ Add task</button>
            </div>

            {actOpen === 'activity' && (
              <div className="sb-od-act-form">
                <textarea className="sb-od-act-input" rows={2} placeholder="What happened?" value={actNote} onChange={e => setActNote(e.target.value)} />
                <div className="sb-od-act-form-actions">
                  <button type="button" className="sb-od-btn" disabled={actBusy || !actNote.trim()} onClick={handleAddActivity}>{actBusy ? 'Saving…' : 'Add'}</button>
                  <button type="button" className="sb-od-link" onClick={() => { setActOpen(null); setActNote('') }}>Cancel</button>
                </div>
              </div>
            )}

            {actOpen === 'task' && (
              <div className="sb-od-act-form">
                <textarea className="sb-od-act-input" rows={2} placeholder="Task description" value={taskForm.note} onChange={e => setTaskForm(f => ({ ...f, note: e.target.value }))} />
                <div className="sb-od-act-form-row">
                  <select className="sb-od-act-select" value={taskForm.kind} onChange={e => setTaskForm(f => ({ ...f, kind: e.target.value }))} title="Type">
                    {TASK_KINDS.map(t => <option key={t.code} value={t.code}>{t.label}</option>)}
                  </select>
                  <select className="sb-od-act-select" value={taskForm.assignee} onChange={e => setTaskForm(f => ({ ...f, assignee: e.target.value }))}>
                    <option value="">Assign to…</option>
                    {TEAM_ROSTER.map(n => <option key={n} value={n}>{n}</option>)}
                  </select>
                  <input type="date" className="sb-od-act-select" value={taskForm.dueDate} onChange={e => setTaskForm(f => ({ ...f, dueDate: e.target.value }))} />
                </div>
                <div className="sb-od-act-form-actions">
                  <button type="button" className="sb-od-btn" disabled={actBusy || !taskForm.note.trim()} onClick={handleAddTask}>{actBusy ? 'Saving…' : 'Add task'}</button>
                  <button type="button" className="sb-od-link" onClick={() => { setActOpen(null); setTaskForm({ note: '', assignee: '', dueDate: '', kind: 'general' }) }}>Cancel</button>
                </div>
              </div>
            )}

            {activity.length === 0 && orderTasks.length === 0 ? (
              <div className="sb-od-empty-inline">No activity yet.</div>
            ) : (
              <div className="sb-od-act-list">
                {[...activity, ...orderTasks]
                  .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
                  .map(a => (
                  <div key={a.id} className={`sb-od-act-row sb-od-act-${a.type}`}>
                    <div className="sb-od-act-main">
                      {a.type === 'change' && <span className="sb-od-act-text"><strong>{a.field}</strong>: {a.old_value} → {a.new_value}</span>}
                      {a.type === 'activity' && <span className="sb-od-act-text">{a.note}</span>}
                      {a.type === 'task' && (
                        <span className="sb-od-act-text">
                          <span className={`sb-od-act-badge ${a.task_status === 'done' ? 'done' : 'open'}`}>{a.task_status === 'done' ? '✓ Done' : 'Task'}</span>
                          {a.note}
                          {a.assignee && <span className="sb-od-act-assignee"> · {a.assignee}</span>}
                          {a.due_date && <span className="sb-od-act-due"> · due {fmtDate(a.due_date)}</span>}
                        </span>
                      )}
                      <span className="sb-od-act-meta">{fmtDate(a.created_at)}{a.actor ? ` · ${a.actor}` : ''}</span>
                    </div>
                    {a.type === 'task' && (
                      <button type="button" className="sb-od-link" onClick={() => toggleTask(a)}>{a.task_status === 'done' ? 'Reopen' : 'Mark done'}</button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Section>

          {/* 8 — Notes */}
          <Section id="od-notes" title="Notes" span={2}>
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
          <Section id="od-email" title="Email traffic" span={2}>
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
            <div className="sb-od-email-tabs">
              <button type="button" className={`sb-od-email-tab${emailView === 'emails' ? ' on' : ''}`} onClick={() => setEmailView('emails')}>Emails {emails.length > 0 && <span className="sb-od-email-tab-n">{emails.length}</span>}</button>
              <button type="button" className={`sb-od-email-tab${emailView === 'attachments' ? ' on' : ''}`} onClick={() => setEmailView('attachments')}>Attachments {emailAttachments.length > 0 && <span className="sb-od-email-tab-n">{emailAttachments.length}</span>}</button>
            </div>
            {emailView === 'emails' ? (
              emails.length === 0 ? (
                <div className="sb-od-empty-inline">No email with this customer yet — Send email to start a thread.</div>
              ) : (
                <div className="sb-od-email-list">
                  {emails.map(em => (
                    <button key={em.id} type="button" className="sb-od-email-row" onClick={() => setEmailViewer(em)} title="Open this email">
                      <span className={`sb-od-email-dir sb-od-email-dir-${em.direction || 'outbound'}`}>
                        {em.direction === 'inbound' ? 'In' : 'Out'}
                      </span>
                      <div className="sb-od-email-main">
                        <div className="sb-od-email-subject">{em.subject || '(no subject)'}</div>
                        <div className="sb-od-email-sub">
                          {em.direction === 'inbound' ? `from ${em.from || '—'}` : `to ${em.to || '—'}`}
                          {em.date ? ` · ${fmtDate(em.date)}` : ''}
                          {(em.attachments || []).length > 0 && ` · ${em.attachments.length} attachment${em.attachments.length === 1 ? '' : 's'}`}
                        </div>
                        {em.body && <div className="sb-od-email-snippet">{em.body.slice(0, 160)}</div>}
                      </div>
                    </button>
                  ))}
                </div>
              )
            ) : (
              emailAttachments.length === 0 ? (
                <div className="sb-od-empty-inline">No attachments in this customer’s emails yet.</div>
              ) : (
                <div className="sb-od-att-grid">
                  {emailAttachments.map(a => {
                    const kind = classifyAttachment(a)
                    const name = a.displayName || a.filename || 'attachment'
                    const isImg = /^image\//i.test(a.contentType || '')
                    return (
                      <div key={a.key} className="sb-od-att-card">
                        <button type="button" className={`sb-od-att-thumb${a.url ? '' : ' loading'}`} onClick={() => previewEmailAttachment(a)} title="Preview" disabled={attBusyKey === a.key}>
                          {isImg && a.url
                            ? <img src={a.url} alt={name} loading="lazy" />
                            : <span className="sb-od-att-kind">{ATTACH_KIND_LABELS[kind]}{!a.url && '…'}</span>}
                        </button>
                        {attRename?.key === a.key ? (
                          <div className="sb-od-att-rename">
                            <input
                              autoFocus
                              className="sb-od-att-rename-input"
                              value={attRename.value}
                              onChange={e => setAttRename(r => ({ ...r, value: e.target.value }))}
                              onKeyDown={e => { if (e.key === 'Enter') saveAttRename(); if (e.key === 'Escape') setAttRename(null) }}
                            />
                            <button type="button" className="sb-od-link" onClick={saveAttRename}>Save</button>
                          </div>
                        ) : (
                          <div className="sb-od-att-name" title={a.filename || ''}>{name}</div>
                        )}
                        <div className="sb-od-att-sub">{a.direction === 'inbound' ? 'From customer' : 'Sent'}{a.date ? ` · ${fmtDate(a.date)}` : ''}</div>
                        <div className="sb-od-att-actions">
                          <button type="button" className="sb-od-link" onClick={() => previewEmailAttachment(a)} disabled={attBusyKey === a.key}>{attBusyKey === a.key ? 'Working…' : 'Preview'}</button>
                          <button type="button" className="sb-od-link" onClick={() => setAttRename({ key: a.key, value: a.displayName || a.filename || '' })}>Rename</button>
                          <button type="button" className="sb-od-link" onClick={() => copyAttToOrder(a)} disabled={attBusyKey === a.key}>+ Order files</button>
                        </div>
                        {attNote?.key === a.key && <div className={`sb-od-att-note${attNote.ok ? '' : ' err'}`}>{attNote.text}</div>}
                      </div>
                    )
                  })}
                </div>
              )
            )}
          </Section>

          {/* D2 — Danger zone: permanent delete, archived orders only. */}
          {order.archived && (
            <Section title="Danger zone" span={2}>
              <div className="sb-od-danger">
                <div className="sb-od-danger-text">
                  <strong>Permanently delete this order.</strong> This erases the order and
                  everything attached to it — payments, balance, jobs, milestones, history,
                  and photos. It cannot be undone.
                </div>
                <button type="button" className="sb-od-danger-btn" onClick={() => { setDeleteErr(null); setDeleteModal(true) }}>
                  Delete permanently
                </button>
              </div>
            </Section>
          )}
          </div>
          <div className="sb-od-rail-right">
            <OrderPipelineRail
              order={order}
              job={job}
              tasks={pipelineTasks}
              onUpdateMilestone={handleRailMilestone}
              onOpenPhase={handleOpenPhase}
              onAddTask={handleAddRailTask}
              onRemoveTask={(tk) => setDelTask(tk)}
              onSetTaskStatus={handleRailTaskStatus}
            />

            {/* Complete & close — works even with items unchecked. */}
            {order.status !== 'closed' && order.status !== 'cancelled' && (
              <div style={{ marginTop: 14, background: '#fff', border: '1px solid #e3ddcf', borderRadius: 10, padding: '12px 14px' }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#1a1a1a', marginBottom: 4 }}>Complete &amp; close the order</div>
                <div style={{ fontSize: 12, color: '#8a8472', lineHeight: 1.45, marginBottom: 10 }}>
                  Marks the whole job complete and closes the order — even if items above aren't checked off.
                  It comes off the Jobs tab and every work queue.
                </div>
                {closeArm ? (
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button type="button" disabled={closeBusy} onClick={completeAndClose}
                      style={{ font: 'inherit', fontSize: 12.5, fontWeight: 700, border: 'none', background: '#2d7a4f', color: '#fff', borderRadius: 7, padding: '7px 14px', cursor: 'pointer' }}>
                      {closeBusy ? 'Closing…' : 'Yes — complete & close'}
                    </button>
                    <button type="button" disabled={closeBusy} onClick={() => setCloseArm(false)}
                      style={{ font: 'inherit', fontSize: 12.5, fontWeight: 600, border: '1px solid #d8d2c4', background: '#fff', color: '#6a6a62', borderRadius: 7, padding: '7px 14px', cursor: 'pointer' }}>
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button type="button" onClick={() => { setCloseErr(null); setCloseArm(true) }}
                    style={{ font: 'inherit', fontSize: 12.5, fontWeight: 700, border: '1px solid #2d7a4f', background: '#fff', color: '#2d7a4f', borderRadius: 7, padding: '7px 14px', cursor: 'pointer', width: '100%' }}>
                    ✓ Complete &amp; close order
                  </button>
                )}
                {closeErr && (
                  <div style={{ marginTop: 8, fontSize: 12.5, fontWeight: 600, color: '#b3261e', background: '#fbeaea', border: '1px solid #e7b3ad', borderRadius: 7, padding: '7px 10px' }}>
                    {closeErr}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Void payment — reason required, kept for the record */}
      {voidModal && (
        <div className="sb-od-modal-overlay" onClick={() => setVoidModal(null)}>
          <div className="sb-od-modal" role="dialog" aria-modal="true" aria-label="Void payment" onClick={e => e.stopPropagation()}>
            <div className="sb-od-modal-title">Void this payment?</div>
            <p style={{ fontSize: 13.5, color: '#555', marginTop: 0 }}>
              {fmtUSD(voidModal.payment.amount)} · {humanize(voidModal.payment.method) || '—'}
              {voidModal.payment.receivedAt ? ` · ${fmtDate(voidModal.payment.receivedAt)}` : ''} — the payment stays on the record
              as voided and stops counting toward the balance.
            </p>
            <textarea
              className="sb-od-note-input" rows={3} autoFocus
              placeholder="Reason (required — kept for the record)"
              value={voidModal.reason}
              onChange={e => setVoidModal(v => ({ ...v, reason: e.target.value }))}
            />
            <div className="sb-od-modal-actions">
              <button type="button" className="sb-od-btn" onClick={() => setVoidModal(null)}>Cancel</button>
              <button type="button" className="sb-od-danger-btn" disabled={!voidModal.reason.trim() || payRowBusy === voidModal.payment.id} onClick={confirmVoid}>
                {payRowBusy === voidModal.payment.id ? 'Voiding…' : 'Void payment'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Email popup viewer — full message + openable attachments */}
      {emailViewer && (
        <div className="sb-od-modal-overlay" onClick={() => setEmailViewer(null)}>
          <div className="sb-od-modal sb-od-email-modal" role="dialog" aria-modal="true" aria-label="Email" onClick={e => e.stopPropagation()}>
            <div className="sb-od-email-modal-head">
              <span className={`sb-od-email-dir sb-od-email-dir-${emailViewer.direction || 'outbound'}`}>{emailViewer.direction === 'inbound' ? 'In' : 'Out'}</span>
              <div>
                <div className="sb-od-modal-title" style={{ marginBottom: 2 }}>{emailViewer.subject || '(no subject)'}</div>
                <div className="sb-od-email-sub">
                  {emailViewer.direction === 'inbound' ? `From ${emailViewer.from || '—'}` : `To ${emailViewer.to || '—'}`}
                  {emailViewer.date ? ` · ${fmtDate(emailViewer.date)}` : ''}
                </div>
              </div>
            </div>
            <div className="sb-od-email-modal-body">{emailViewer.body || '(no text body)'}</div>
            {(emailViewer.attachments || []).length > 0 && (
              <div className="sb-od-att-chips">
                {emailViewer.attachments.map((x, i) => {
                  const a = { key: `${emailViewer.id}:${i}`, messageId: emailViewer.id, idx: i, ...x }
                  return (
                    <button key={i} type="button" className="sb-od-att-chip" disabled={attBusyKey === a.key} onClick={() => previewEmailAttachment(a)}>
                      {attBusyKey === a.key ? 'Opening…' : (x.displayName || x.filename || 'attachment')}
                    </button>
                  )
                })}
              </div>
            )}
            <div className="sb-od-modal-actions">
              <button type="button" className="sb-od-btn" onClick={() => setEmailViewer(null)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {delTask && (
        <div className="sb-od-modal-overlay" onClick={() => setDelTask(null)}>
          <div className="sb-od-modal sb-od-modal-danger" role="dialog" aria-modal="true" aria-label="Remove task" onClick={e => e.stopPropagation()}>
            <div className="sb-od-modal-title">Remove this task?</div>
            <p className="sb-od-danger-summary"><strong>{delTask.note}</strong> will be removed from the pipeline and the task command center (a "deleted by" trail is kept).</p>
            <div className="sb-od-modal-actions">
              <button type="button" className="sb-od-btn" onClick={() => setDelTask(null)}>Cancel</button>
              <button type="button" className="sb-od-danger-btn" onClick={confirmRemoveTask}>Remove</button>
            </div>
          </div>
        </div>
      )}

      {profileOpen && <CustomerProfileSheet order={order} onClose={() => setProfileOpen(false)} />}
      {contractEd && (
        <ContractEditor {...contractEd}
          onClose={() => setContractEd(null)}
          onSave={saveContractEdits} />
      )}

      {/* ADD APPOINTMENT (Paul 2026-08-03): who · when · what they're looking
          for → one calendar 'appointment' batch linked to this order. Today's
          shared log and the Calendar both read that row. */}
      {apptModal && (
        <div className="sb-od-modal-backdrop" onClick={() => { if (!apptModal.busy) setApptModal(null) }}>
          <div className="sb-od-modal" role="dialog" aria-modal="true" aria-label="Add appointment" onClick={e => e.stopPropagation()}>
            <div className="sb-od-modal-title">Add appointment — {properName(order.primary_lastname || customerName(order.customer) || 'this lead')}</div>
            <div className="sb-od-appt-grid">
              <label className="sb-od-appt-f"><b>With</b>
                <select value={apptModal.who} disabled={apptModal.busy}
                  onChange={e => setApptModal(m => ({ ...m, who: e.target.value }))}>
                  {STAFF_NAMES.map(n => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>
              <label className="sb-od-appt-f"><b>Day</b>
                <input type="date" value={apptModal.date} disabled={apptModal.busy}
                  onChange={e => setApptModal(m => ({ ...m, date: e.target.value }))} />
              </label>
              <label className="sb-od-appt-f"><b>Time</b>
                <input type="time" value={apptModal.time} disabled={apptModal.busy}
                  onChange={e => setApptModal(m => ({ ...m, time: e.target.value }))} />
              </label>
            </div>
            <label className="sb-od-appt-f"><b>What are they looking for?</b>
              <textarea rows={3} value={apptModal.what} disabled={apptModal.busy}
                placeholder="e.g. upright for two, gray, budget around $6k — bringing photos of the plot"
                onChange={e => setApptModal(m => ({ ...m, what: e.target.value }))} />
            </label>
            {apptModal.err && <div className="sb-msg sb-msg-err" style={{ marginBottom: 10 }}>{apptModal.err}</div>}
            <div className="sb-od-modal-actions">
              <button type="button" className="sb-od-btn" disabled={apptModal.busy} onClick={() => setApptModal(null)}>Cancel</button>
              <button type="button" className="sb-od-btn sb-od-btn-appt" disabled={apptModal.busy} onClick={async () => {
                const m = apptModal
                if (!m.date) { setApptModal({ ...m, err: 'Pick the day.' }); return }
                setApptModal({ ...m, busy: true, err: null })
                const fam = properName(order.primary_lastname || customerName(order.customer) || '')
                const r = await createBatch({
                  kind: 'appointment',
                  title: `Appointment — ${fam || 'walk-in'}`,
                  scheduled_date: m.date,
                  start_time: m.time || null,
                  attendees: m.who ? [m.who] : [],
                  owner_name: m.who || null,
                  order_id: orderId,
                  notes: (m.what || '').trim() || null,
                  calendar_scope: 'all',
                })
                if (!r?.ok) { setApptModal({ ...m, busy: false, err: r?.error || 'Could not save the appointment.' }); return }
                logOrderActivity(orderId, {
                  type: 'change', field: 'Appointment', newValue: `${m.date}${m.time ? ` ${m.time}` : ''}`,
                  note: `Appointment with ${m.who}${m.what ? ` — ${m.what.trim()}` : ''}`,
                  actor: await getCurrentStaffName(),
                }).then(() => refreshActivity()).catch(() => {})
                setApptModal(null)
                setActionNote(`Appointment saved — it's on Today and the Calendar. ✓`)
              }}>
                {apptModal.busy ? 'Saving…' : 'Save appointment'}
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteModal && (
        <div className="sb-od-modal-backdrop" onClick={() => { if (!deleteBusy) setDeleteModal(false) }}>
          <div className="sb-od-modal sb-od-modal-danger" role="dialog" aria-modal="true" aria-label="Confirm permanent delete" onClick={e => e.stopPropagation()}>
            <div className="sb-od-modal-title">Permanently delete this order?</div>
            <p className="sb-od-danger-summary">
              Permanently delete order <strong>{order.order_number || 'this order'}</strong> and its{' '}
              <strong>{(order.payments || []).filter(p => p && (p.locked ?? true) && !p.voided).length} payment(s)</strong>,
              {' '}balance <strong>{fmtUSD(balance)}</strong>, <strong>{job ? '1 job' : 'no jobs'}</strong> and its
              milestones, history, and photos? <strong>This cannot be undone.</strong>
            </p>
            {deleteErr && <div className="sb-msg sb-msg-err" style={{ marginBottom: 12 }}>{deleteErr}</div>}
            <div className="sb-od-modal-actions">
              <button type="button" className="sb-od-btn" onClick={() => setDeleteModal(false)} disabled={deleteBusy}>Cancel</button>
              <button type="button" className="sb-od-danger-btn" onClick={handleHardDelete} disabled={deleteBusy}>
                {deleteBusy ? 'Deleting…' : 'Yes, permanently delete'}
              </button>
            </div>
          </div>
        </div>
      )}

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
                <div className="sb-od-modal-field">
                  <span>Attachments</span>
                  <div className="sb-od-email-attachrow">
                    {(emailModal.attach || []).map((a, i) => (
                      <span key={a.path || i} className="sb-od-email-fchip">
                        {a.name}
                        <button type="button" title="Remove from this email (stays on the order)"
                          onClick={() => setEmailModal(m => ({ ...m, attach: (m.attach || []).filter((_, j) => j !== i) }))}>×</button>
                      </span>
                    ))}
                    <button type="button" className="sb-od-link"
                      onClick={() => setEmailModal(m => ({ ...m, attachPick: !m.attachPick }))}>
                      {emailModal.attachPick ? 'Hide order files' : '+ From order files'}
                    </button>
                    <button type="button" className="sb-od-link" disabled={emailModal.uploading}
                      onClick={() => emailFileRef.current?.click()}>
                      {emailModal.uploading ? 'Uploading…' : '+ Upload new'}
                    </button>
                    <input ref={emailFileRef} type="file" multiple style={{ display: 'none' }} onChange={onEmailFilesChosen} />
                  </div>
                  {emailModal.attachPick && (
                    <div className="sb-od-email-picklist">
                      {uploads.length === 0 && <span className="sb-od-empty-inline">No files on this order yet — use Upload new.</span>}
                      {uploads.map(f => {
                        const on = (emailModal.attach || []).some(a => a.path === f.path)
                        return (
                          <button key={f.path} type="button" className={`sb-od-email-fpick${on ? ' on' : ''}`}
                            onClick={() => toggleEmailAttach(f)}>{f.name}</button>
                        )
                      })}
                    </div>
                  )}
                  <span className="sb-od-email-attachhint">New uploads also land in the order's attachments.</span>
                </div>
                {emailModal.error && (
                  <div className="sb-msg sb-msg-err" style={{ marginBottom: 4 }}>{emailModal.error}</div>
                )}
                <div className="sb-od-modal-actions">
                  <button type="button" className="sb-od-btn" onClick={closeEmailComposer} disabled={emailModal.busy || emailModal.polishing}>Cancel</button>
                  <button type="button" className="sb-od-btn" onClick={saveComposerDraft}
                    disabled={emailModal.busy || emailModal.polishing || emailModal.uploading}
                    title="Park this email — edit and send it later from Email drafts on this order">
                    {emailModal.draftId ? 'Update draft' : 'Save as draft'}
                  </button>
                  {/* Polish rewrites what's typed (distinct from the generate-from-scratch buttons). */}
                  <button type="button" className="sb-od-btn" onClick={polishDraft}
                    disabled={emailModal.busy || emailModal.polishing || !emailModal.body.trim()}>
                    {emailModal.polishing ? 'Polishing…' : 'Polish with AI'}
                  </button>
                  <button type="button" className="sb-od-btn sb-od-btn-primary" onClick={handleSendEmail}
                    disabled={emailModal.busy || emailModal.polishing || emailModal.uploading || !emailModal.to.trim() || !emailModal.subject.trim()}>
                    {emailModal.busy ? 'Sending…' : (emailModal.attach || []).length ? `Send with ${emailModal.attach.length} file${emailModal.attach.length === 1 ? '' : 's'}` : 'Send'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Add check job — a site-inspection task linked to this order. */}
      {checkJobOpen && (
        <CheckJobModal
          order={{
            id: order.id,
            label: `${order.primary_lastname || order.customer?.last_name || 'Order'}${order.order_number ? ` · ${order.order_number}` : ''}`,
            cemeteryId: order.cemetery_id || order.cemetery?.id || null,
            cemeteryName: order.cemetery?.name || null,
          }}
          onClose={() => setCheckJobOpen(false)}
          onSaved={() => { setCheckJobOpen(false); refreshActivity(); setActionNote('Check job added — it’s on the task command center. ✓') }}
        />
      )}

      {/* Sales email / Email contract to sign — the customer-facing bundle. */}
      {salesEmailMode && (
        <SalesEmailModal
          order={order}
          mode={salesEmailMode.mode}
          draft={salesEmailMode.draft || null}
          onClose={() => setSalesEmailMode(null)}
          onSent={(msg) => { refreshActivity(); refreshDrafts(); setActionNote(msg) }}
          onSaved={(msg) => { refreshDrafts(); setActionNote(msg) }}
        />
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
              <span>Payment collected by</span>
              <select className="sb-od-note-input" value={payModal.collectedBy} disabled={payModal.confirm}
                onChange={e => setPayModal(m => ({ ...m, collectedBy: e.target.value }))}>
                {(payModal.collectedBy && !SALES_REPS.includes(payModal.collectedBy)) && <option value={payModal.collectedBy}>{payModal.collectedBy}</option>}
                <option value="">— select —</option>
                {SALES_REPS.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </label>
            <label className="sb-od-modal-field">
              <span>
                {payModal.method === 'zelle' ? 'Zelle confirmation #' : payModal.method === 'check' ? 'Check number' : 'Reference #'}
                {payModal.method !== 'check' && <> <em className="sb-od-opt">optional</em></>}
              </span>
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
      {receiptPreview && (
        <ReceiptPreviewModal order={receiptOrder} payment={receiptPreview.payment} onClose={() => setReceiptPreview(null)} />
      )}

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

      {delAttach && (
        <div className="sb-od-modal-overlay" onClick={() => { if (!delAttachBusy) setDelAttach(null) }}>
          <div className="sb-od-modal sb-od-modal-danger" role="dialog" aria-modal="true" aria-label="Confirm delete attachment" onClick={e => e.stopPropagation()}>
            <div className="sb-od-modal-title">Delete this attachment?</div>
            <p className="sb-od-danger-summary"><strong>{delAttach.name}</strong> will be permanently removed from this order. This cannot be undone.</p>
            <div className="sb-od-modal-actions">
              <button type="button" className="sb-od-btn" onClick={() => setDelAttach(null)} disabled={delAttachBusy}>Cancel</button>
              <button type="button" className="sb-od-danger-btn" onClick={confirmDeleteAttachment} disabled={delAttachBusy}>
                {delAttachBusy ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {signModal && (
        <div className="sb-od-modal-overlay" onClick={() => { if (!signModal.busy) setSignModal(null) }}>
          <div className="sb-od-modal" role="dialog" aria-modal="true" aria-label="Mark contract signed" onClick={e => e.stopPropagation()}>
            <div className="sb-od-modal-title">Mark contract as signed</div>
            <p className="sb-od-danger-summary" style={{ background: 'none', border: 'none', padding: 0 }}>
              Upload the scanned signed contract, or leave it empty to designate the <strong>current generated contract</strong> as signed. The signed copy is stored privately and pins as <strong>Contract (signed)</strong>; later regenerations become drafts.
            </p>
            <label className="sb-od-modal-field"><span>Scanned signed copy <em className="sb-od-opt">optional — PDF/image</em></span>
              <input type="file" accept="application/pdf,image/*" className="sb-od-note-input"
                onChange={e => { const f = e.target.files?.[0] || null; setSignModal(m => ({ ...m, file: f })) }} />
            </label>
            {signModal.error && <div className="sb-msg sb-msg-err" style={{ marginBottom: 8 }}>{signModal.error}</div>}
            <div className="sb-od-modal-actions">
              <button type="button" className="sb-od-btn" onClick={() => setSignModal(null)} disabled={signModal.busy}>Cancel</button>
              <button type="button" className="sb-od-btn sb-od-btn-primary" onClick={handleMarkSigned} disabled={signModal.busy}>
                {signModal.busy ? 'Saving…' : (signModal.file ? 'Upload & mark signed' : 'Mark current as signed')}
              </button>
            </div>
          </div>
        </div>
      )}

      {overrideModal && (
        <div className="sb-od-modal-overlay" onClick={() => { if (!overrideModal.busy) setOverrideModal(null) }}>
          <div className="sb-od-modal sb-od-modal-danger" role="dialog" aria-modal="true" aria-label="Override signed contract" onClick={e => e.stopPropagation()}>
            <div className="sb-od-modal-title">Override the signed contract?</div>
            <p className="sb-od-danger-summary">
              This removes the pinned <strong>Contract (signed)</strong> from this order. The current draft becomes the working contract again. A reason is required and recorded in the activity log. <strong>This cannot be undone.</strong>
            </p>
            <label className="sb-od-modal-field"><span>Reason <em className="sb-od-opt">required</em></span>
              <textarea className="sb-od-note-input" rows={2} value={overrideModal.reason}
                onChange={e => setOverrideModal(m => ({ ...m, reason: e.target.value }))}
                placeholder="e.g. customer requested a pricing change; re-signing required" />
            </label>
            {overrideModal.error && <div className="sb-msg sb-msg-err" style={{ marginBottom: 8 }}>{overrideModal.error}</div>}
            <div className="sb-od-modal-actions">
              <button type="button" className="sb-od-btn" onClick={() => setOverrideModal(null)} disabled={overrideModal.busy}>Cancel</button>
              <button type="button" className="sb-od-danger-btn" onClick={handleOverrideSigned} disabled={overrideModal.busy || !overrideModal.reason.trim()}>
                {overrideModal.busy ? 'Overriding…' : 'Override signed contract'}
              </button>
            </div>
          </div>
        </div>
      )}

      {approvalOverride && (
        <div className="sb-od-modal-overlay" onClick={() => { if (!approvalOverride.busy) setApprovalOverride(null) }}>
          <div className="sb-od-modal sb-od-modal-danger" role="dialog" aria-modal="true" aria-label="Override signed approval" onClick={e => e.stopPropagation()}>
            <div className="sb-od-modal-title">Override the signed approval?</div>
            <p className="sb-od-danger-summary">
              This removes the pinned <strong>Approval (signed)</strong> from this order so the proof can be re-approved. A reason is required and recorded in the activity log. <strong>This cannot be undone.</strong>
            </p>
            <label className="sb-od-modal-field"><span>Reason <em className="sb-od-opt">required</em></span>
              <textarea className="sb-od-note-input" rows={2} value={approvalOverride.reason}
                onChange={e => setApprovalOverride(m => ({ ...m, reason: e.target.value }))}
                placeholder="e.g. design changed after approval; re-approval required" />
            </label>
            {approvalOverride.error && <div className="sb-msg sb-msg-err" style={{ marginBottom: 8 }}>{approvalOverride.error}</div>}
            <div className="sb-od-modal-actions">
              <button type="button" className="sb-od-btn" onClick={() => setApprovalOverride(null)} disabled={approvalOverride.busy}>Cancel</button>
              <button type="button" className="sb-od-danger-btn" onClick={handleOverrideApproval} disabled={approvalOverride.busy || !approvalOverride.reason.trim()}>
                {approvalOverride.busy ? 'Overriding…' : 'Override signed approval'}
              </button>
            </div>
          </div>
        </div>
      )}

      <AttachmentPreviewModal attachment={preview} onClose={closePreview} />
    </div>
  )
}

function BackBar({ onBack, label = 'Orders' }) {
  return (
    <button type="button" className="sb-od-back" onClick={onBack}>← {label}</button>
  )
}

// =============================================================================
// Scoped styles — calm premium operational (Inter, near-black, bronze accent).
// =============================================================================
const OD_CSS = `
  .sb-od-page { background: var(--sb-canvas, #faf9f7); min-height: 100%; padding: 24px 0 64px; }
  /* Wider than the legacy 1080 to reclaim dead horizontal margin for the
     left nav | cards | pipeline rail three-column layout. */
  .sb-od-container { max-width: 1480px; margin: 0 auto; padding: 0 24px; }
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

  /* LEAD (no deposit) — deliberately the loudest thing on the page. */
  .sb-od-lead-pill {
    font-size: 11px; font-weight: 800; letter-spacing: 0.08em; color: #fff;
    background: #B3261E; border-radius: 999px; padding: 4px 12px; white-space: nowrap;
  }
  .sb-od-lead-banner {
    display: flex; flex-direction: column; gap: 3px;
    background: #fdecea; border: 1.5px solid #B3261E; border-left-width: 6px;
    border-radius: 10px; padding: 12px 16px; margin: 0 0 16px;
  }
  .sb-od-lead-banner-title { font-size: 15px; font-weight: 800; letter-spacing: 0.05em; color: #B3261E; }
  .sb-od-lead-banner-sub { font-size: 13px; color: #7a2a25; }

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

  /* Quick task — type + Add, lands on this order and the Task CC. */
  .sb-od-quicktask { display: flex; gap: 8px; margin: 0 0 10px; }
  .sb-od-quicktask-in { flex: 1; border: 1px dashed #C9A468; border-radius: 9px; padding: 9px 13px; font: inherit; font-size: 13.5px; background: rgba(201,164,104,0.05); }
  .sb-od-quicktask-in:focus { outline: none; border-style: solid; border-color: #9A7209; background: #fff; }
  .sb-od-quicktask-go { border: none; border-radius: 9px; background: #16150F; color: #C9A468; font: 700 13px/1 inherit; padding: 9px 16px; cursor: pointer; }
  .sb-od-quicktask-go:disabled { opacity: 0.5; cursor: default; }

  /* Emphasis tiers (Paul 2026-07-28: "bold some of the important ones"). */
  .sb-od-btn-strong { font-weight: 700; border-color: #b3a880; }
  .sb-od-btn-pay { background: #1f7a3d; border-color: #1f7a3d; color: #fff; font-weight: 700; }
  .sb-od-btn-pay:hover:not(:disabled) { background: #1a6a35; }
  .sb-od-btn-sales { background: #F4EBD4; border-color: #9A7209; color: #6d5106; font-weight: 700; }
  .sb-od-btn-sales:hover:not(:disabled) { background: #eddfba; }
  /* Add appointment — the big purple door (Paul 2026-08-03). */
  .sb-od-btn-appt { background: #6D28D9; border-color: #6D28D9; color: #fff; font-weight: 700; font-size: 14px; padding: 9px 16px; }
  .sb-od-btn-appt:hover:not(:disabled) { background: #5a1fb8; }
  .sb-od-appt-grid { display: grid; grid-template-columns: 1.2fr 1fr 0.8fr; gap: 10px; margin-bottom: 10px; }
  .sb-od-appt-f { display: flex; flex-direction: column; gap: 4px; font-size: 13px; margin-bottom: 10px; }
  .sb-od-appt-f > b { font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: #8a8472; }
  .sb-od-appt-f select, .sb-od-appt-f input, .sb-od-appt-f textarea { font: inherit; font-size: 13.5px; padding: 8px 10px; border: 0.5px solid #D9D2C0; border-radius: 8px; background: #fff; }
  .sb-od-appt-f textarea { resize: vertical; }

  /* Email drafts strip — parked composers, one chip each. */
  .sb-od-drafts { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin: 10px 0 0; }
  .sb-od-drafts-label { font-size: 11px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: #8A7F6C; }
  .sb-od-draft { display: inline-flex; align-items: center; border: 1px dashed #C9A468; border-radius: 999px; background: rgba(201,164,104,0.08); overflow: hidden; }
  .sb-od-draft-open { background: none; border: none; padding: 5px 4px 5px 12px; font: 600 12.5px/1 inherit; color: #6d5106; cursor: pointer; max-width: 340px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .sb-od-draft-open:hover { text-decoration: underline; }
  .sb-od-draft-x { background: none; border: none; color: #B3261E; font: 700 14px/1 inherit; padding: 5px 10px 5px 4px; cursor: pointer; }

  /* Quick-glance strip — the three things to read the instant the order opens. */
  .sb-od-glance { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; margin: 16px 0 4px; }
  @media (max-width: 720px) { .sb-od-glance { grid-template-columns: 1fr; } }
  .sb-od-glance-item {
    display: flex; align-items: center; gap: 12px;
    background: #fff; border: 0.5px solid var(--sb-border, #e4e2dd); border-radius: 12px; padding: 12px 16px;
  }
  .sb-od-glance-text { min-width: 0; }
  .sb-od-glance-label { font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.09em; color: #9a8a5e; font-weight: 700; }
  .sb-od-glance-value { font-size: 16px; font-weight: 700; color: #1a1a17; margin-top: 2px; line-height: 1.25; overflow-wrap: break-word; word-break: normal; min-width: 0; }
  .sb-od-glance-sub { font-size: 14px; font-weight: 500; color: #6b6b66; }

  /* Section layout: sticky left rail + the card grid. */
  .sb-od-layout { display: flex; align-items: flex-start; gap: 22px; margin-top: 20px; }
  .sb-od-layout .sb-od-grid { flex: 1; min-width: 0; margin-top: 0; }
  .sb-od-rail {
    position: sticky; top: 16px; flex: 0 0 196px; width: 196px;
    display: flex; flex-direction: column; gap: 2px; align-self: flex-start;
  }
  .sb-od-rail-item {
    display: flex; align-items: center; gap: 9px; width: 100%; text-align: left;
    background: none; border: none; border-radius: 8px; padding: 8px 10px;
    font: inherit; font-size: 13.5px; font-weight: 500; color: #4a4a45; cursor: pointer;
    transition: background 0.12s, color 0.12s;
  }
  .sb-od-rail-item:hover { background: #f1ede2; color: #111; }
  /* Right-hand pipeline rail column (additive third column). */
  .sb-od-rail-right {
    position: sticky; top: 16px; flex: 0 0 264px; width: 264px; align-self: flex-start;
    background: #fff; border: 1px solid #ece6d8; border-radius: 10px; padding: 14px;
    max-height: calc(100vh - 32px); overflow-y: auto;
  }
  @media (max-width: 1080px) {
    .sb-od-rail-right { position: static; flex: 1 1 auto; width: 100%; max-height: none; margin-top: 16px; }
  }
  @media (max-width: 920px) {
    .sb-od-layout { flex-direction: column; }
    .sb-od-rail { position: static; flex-direction: row; flex-wrap: wrap; width: 100%; flex-basis: auto; gap: 6px; }
    .sb-od-rail-item { width: auto; border: 0.5px solid var(--sb-border, #e4e2dd); }
  }

  .sb-od-grid {
    display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-top: 20px;
  }
  .sb-od-span-2 { grid-column: 1 / -1; }
  @media (max-width: 820px) { .sb-od-grid { grid-template-columns: 1fr; } }

  .sb-od-card {
    background: #fff; border: 0.5px solid var(--sb-border, #e4e2dd); border-radius: 12px; padding: 18px 20px;
  }
  .sb-od-card-eyebrow {
    font-size: 16px; text-transform: uppercase; letter-spacing: 0.04em; color: #6e5206;
    font-weight: 800; margin-bottom: 14px;
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

  /* Quote Hub send */
  .sb-od-quote { margin-top: 12px; padding-top: 12px; border-top: 0.5px solid #f1efeb; display: flex; flex-direction: column; gap: 8px; align-items: flex-start; }
  .sb-od-quote-chip { font-size: 11px; font-weight: 700; border: 1px solid; border-radius: 999px; padding: 2px 10px; text-transform: uppercase; letter-spacing: 0.04em; }
  .sb-od-quote-btn { font: inherit; font-size: 13px; font-weight: 700; color: #1a1206; background: #9A7209; border: 1px solid #9A7209; border-radius: 8px; padding: 9px 16px; cursor: pointer; transition: background 0.15s; }
  .sb-od-quote-btn:hover:not(:disabled) { background: #b3870c; }
  .sb-od-quote-btn:disabled { opacity: 0.6; cursor: default; }
  .sb-od-quote-err { font-size: 12px; color: #b3261e; }

  /* Attachments */
  .sb-od-need-signature {
    display: flex; align-items: flex-start; gap: 10px;
    background: #fbe5b8; border: 1px solid #b8842a; border-left: 4px solid #b8842a;
    border-radius: 8px; padding: 12px 14px; margin: 0 0 18px;
    font-size: 13.5px; line-height: 1.45; color: #5e3a0e;
  }
  /* D2 — danger zone */
  .sb-od-danger {
    display: flex; align-items: center; justify-content: space-between; gap: 16px;
    background: #fbe5e5; border: 1px solid #e3b3b3; border-radius: 8px; padding: 14px 16px; flex-wrap: wrap;
  }
  .sb-od-danger-text { font-size: 13px; line-height: 1.5; color: #6b2020; flex: 1; min-width: 220px; }
  .sb-od-danger-btn {
    font: inherit; font-size: 13px; font-weight: 600; padding: 9px 16px; border-radius: 8px;
    border: 0.5px solid transparent; background: #b3261e; color: #fff; cursor: pointer; white-space: nowrap;
  }
  .sb-od-danger-btn:hover:not(:disabled) { background: #8f1d17; }
  .sb-od-danger-btn:disabled { opacity: 0.6; cursor: not-allowed; }
  .sb-od-modal-danger { border-top: 4px solid #b3261e; }
  .sb-od-danger-summary { font-size: 14px; line-height: 1.55; color: #2a2a28; margin: 0 0 16px; }
  .sb-od-completion-grid {
    display: grid; grid-template-columns: repeat(auto-fill, minmax(100px, 1fr)); gap: 8px;
  }
  .sb-od-completion-thumb {
    display: block; aspect-ratio: 1 / 1; border-radius: 6px; overflow: hidden;
    border: 0.5px solid #e6e3dd; background: #f4f2ee; padding: 0; cursor: pointer; width: 100%;
  }
  .sb-od-completion-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .sb-od-attach-del { color: #b3261e; }
  .sb-od-attach-row-signed { background: #f1f8f2; border-radius: 6px; padding-left: 6px; padding-right: 6px; }
  .sb-od-attach-row-draft { opacity: 0.66; }
  .sb-od-attach-badge-signed, .sb-od-attach-badge-draft {
    display: inline-block; font-size: 9.5px; font-weight: 700; letter-spacing: 0.05em;
    border-radius: 4px; padding: 1px 5px; margin-left: 7px; vertical-align: middle;
  }
  .sb-od-attach-badge-signed { background: #2e7d3a; color: #fff; }
  .sb-od-attach-badge-draft { background: #e7e2d6; color: #7a756a; }
  .sb-od-permit-tasks { margin-top: 6px; }
  .sb-od-fdn-select {
    font: inherit; font-size: 13px; padding: 4px 9px; cursor: pointer;
    border: 0.5px solid var(--sb-border); border-radius: 6px;
    background: var(--sb-surface); color: var(--sb-text); max-width: 220px;
  }
  .sb-od-fdn-select:focus { outline: none; border-color: var(--sb-accent, #b8842a); }
  .sb-od-permit-task { display: flex; align-items: center; gap: 8px; padding: 3px 0; font-size: 13px; }
  .sb-od-permit-task span { flex: 1 1 auto; word-break: break-word; }
  .sb-od-permit-task-toggle { border: none; background: none; cursor: pointer; font-size: 14px; color: #2d7a4f; flex: 0 0 auto; }
  .sb-od-permit-task-done { text-decoration: line-through; color: #9a958c; }
  .sb-od-permit-add { display: flex; gap: 6px; margin-top: 6px; }
  .sb-od-permit-add .sb-od-note-input { flex: 1 1 auto; }
  .sb-od-design-proof { display: flex; gap: 12px; align-items: flex-start; margin-top: 8px; }
  .sb-od-design-thumb { flex: 0 0 96px; width: 96px; height: 96px; border: 1px solid #e6e3dd; border-radius: 8px; overflow: hidden; background: #f4f2ee; padding: 0; cursor: pointer; display: flex; align-items: center; justify-content: center; }
  .sb-od-design-thumb img { width: 100%; height: 100%; object-fit: cover; }
  .sb-od-design-noimg { font-size: 11px; color: #9a958c; }
  .sb-od-design-meta { flex: 1 1 auto; font-size: 13px; display: flex; flex-direction: column; gap: 3px; }
  .sb-od-reapproval { font-size: 12.5px; font-weight: 600; color: #7a4a12; background: #fdf2e9; border: 1px solid #e0a85f; border-radius: 7px; padding: 7px 10px; margin-bottom: 10px; }
  .sb-od-email-attachrow { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .sb-od-email-fchip { font-size: 12px; background: #f6f3ec; border: 1px solid rgba(26,30,36,0.1); border-radius: 8px; padding: 5px 9px; display: inline-flex; align-items: center; gap: 7px; }
  .sb-od-email-fchip button { font: 700 13px/1 inherit; font-family: inherit; background: none; border: none; cursor: pointer; color: #b3261e; padding: 0; }
  .sb-od-email-picklist { display: flex; gap: 7px; flex-wrap: wrap; margin-top: 8px; padding: 9px; background: #fbfaf6; border: 1px dashed rgba(26,30,36,0.16); border-radius: 8px; }
  .sb-od-email-fpick { font: 600 12px/1 inherit; font-family: inherit; background: #fff; border: 1px solid #dad4c2; border-radius: 8px; padding: 7px 11px; cursor: pointer; color: #79735f; }
  .sb-od-email-fpick.on { border-color: #9A7209; color: #9A7209; background: #f4ebd4; }
  .sb-od-email-attachhint { display: block; font-size: 11px; color: #a39c87; margin-top: 6px; }
  .sb-od-changes-panel { background: #fbeaea; border: 1px solid #e7b3ad; border-left: 4px solid #b3261e; border-radius: 8px; padding: 10px 13px; margin-bottom: 12px; display: flex; flex-direction: column; gap: 8px; }
  .sb-od-changes-head { font-size: 11px; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase; color: #b3261e; }
  .sb-od-change-entry { display: flex; flex-direction: column; gap: 2px; }
  .sb-od-change-entry.reply { padding-left: 14px; border-left: 2px solid rgba(179,38,30,0.25); }
  .sb-od-change-by { font-size: 11.5px; font-weight: 700; color: #7a2a25; }
  .sb-od-change-note { font-size: 13.5px; color: #2a2a2a; line-height: 1.45; }
  .sb-od-approval-note { flex-basis: 100%; font-size: 12.5px; color: #7a2a25; background: #fbeaea; border-radius: 6px; padding: 5px 9px; }
  .sb-od-approval-send { margin-top: 14px; padding-top: 12px; border-top: 1px solid #ece8df; }
  .sb-od-approval-link { display: flex; align-items: center; gap: 8px; margin-top: 10px; flex-wrap: wrap; }
  .sb-od-approval-link .sb-od-note-input { flex: 1 1 220px; min-width: 0; font-size: 12.5px; }
  .sb-od-approval-status { display: flex; flex-direction: column; gap: 6px; margin-top: 12px; }
  .sb-od-approval-row { display: flex; align-items: center; gap: 10px; font-size: 13px; flex-wrap: wrap; }
  .sb-od-approval-when { color: #9a958c; font-size: 12px; flex: 1 1 auto; }
  .sb-od-approval-badge { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.03em; padding: 2px 8px; border-radius: 999px; }
  .sb-od-approval-pending { background: #fef6e7; color: #8a6308; }
  .sb-od-approval-viewed { background: #eaf2fb; color: #2a5d9a; }
  .sb-od-approval-signed { background: #e8f5ea; color: #2d7a4f; }
  .sb-od-approval-expired { background: #f1efe9; color: #8a857a; }
  .sb-od-approval-revoked { background: #fcecea; color: #b3261e; }
  .sb-od-act-actions { display: flex; gap: 16px; margin-bottom: 10px; }
  .sb-od-act-form { background: #faf8f3; border: 1px solid #e7e2d6; border-radius: 8px; padding: 10px; margin-bottom: 12px; }
  .sb-od-act-input { width: 100%; box-sizing: border-box; border: 1px solid #d8d2c4; border-radius: 6px; padding: 7px 9px; font: inherit; font-size: 13.5px; resize: vertical; }
  .sb-od-act-form-row { display: flex; gap: 8px; margin-top: 8px; flex-wrap: wrap; }
  .sb-od-act-select { border: 1px solid #d8d2c4; border-radius: 6px; padding: 6px 9px; font: inherit; font-size: 13px; }
  .sb-od-act-form-actions { display: flex; align-items: center; gap: 12px; margin-top: 8px; }
  .sb-od-act-list { display: flex; flex-direction: column; }
  .sb-od-act-row { display: flex; align-items: flex-start; gap: 10px; padding: 9px 0; font-size: 13.5px; }
  .sb-od-act-row + .sb-od-act-row { border-top: 0.5px solid #f1efeb; }
  .sb-od-act-main { flex: 1 1 auto; display: flex; flex-direction: column; gap: 2px; }
  .sb-od-act-text { color: #222; word-break: break-word; }
  .sb-od-act-meta { font-size: 11.5px; color: #9a958c; }
  .sb-od-act-change .sb-od-act-text { color: #555; }
  .sb-od-act-assignee, .sb-od-act-due { color: #8a8a85; }
  .sb-od-act-badge {
    display: inline-block; font-size: 10px; font-weight: 700; text-transform: uppercase;
    letter-spacing: 0.04em; border-radius: 4px; padding: 1px 6px; margin-right: 6px; vertical-align: middle;
  }
  .sb-od-act-badge.open { background: #fdf2e9; color: #b06a12; border: 0.5px solid #e0a85f; }
  .sb-od-act-badge.done { background: #e8f5ea; color: #2e7d3a; border: 0.5px solid #9bd0a6; }
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
  .sb-od-email-row { width: 100%; text-align: left; background: none; border: none; font: inherit; cursor: pointer; border-radius: 8px; }
  .sb-od-email-row:hover { background: #faf8f4; }
  .sb-od-email-tabs { display: flex; gap: 6px; margin-bottom: 12px; }
  .sb-od-email-tab { font: inherit; font-size: 12.5px; font-weight: 600; padding: 6px 12px; border-radius: 999px; border: 0.5px solid #E2D8C6; background: #fff; color: #7a7468; cursor: pointer; }
  .sb-od-email-tab.on { background: #9A7209; border-color: #9A7209; color: #fff; }
  .sb-od-email-tab-n { opacity: 0.75; font-weight: 500; margin-left: 3px; }
  .sb-od-att-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 14px; }
  .sb-od-att-card { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
  .sb-od-att-thumb { width: 100%; aspect-ratio: 4/3; border-radius: 10px; border: 0.5px solid #E2D8C6; background: #f6f4ef; overflow: hidden; cursor: pointer; display: flex; align-items: center; justify-content: center; padding: 0; }
  .sb-od-att-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .sb-od-att-thumb:hover { border-color: #9A7209; }
  .sb-od-att-thumb.loading { background: linear-gradient(90deg, #f1eee8 25%, #f8f6f2 50%, #f1eee8 75%); background-size: 200% 100%; animation: sb-od-att-shimmer 1.4s ease infinite; }
  @keyframes sb-od-att-shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
  .sb-od-att-kind { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.07em; color: #8a8a85; }
  .sb-od-att-name { font-size: 12.5px; font-weight: 600; color: #222; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .sb-od-att-sub { font-size: 11px; color: #8a8a85; }
  .sb-od-att-actions { display: flex; gap: 10px; flex-wrap: wrap; }
  .sb-od-att-rename { display: flex; gap: 6px; align-items: center; }
  .sb-od-att-rename-input { flex: 1; min-width: 0; font: inherit; font-size: 12.5px; padding: 3px 7px; border: 0.5px solid #9A7209; border-radius: 6px; outline: none; }
  .sb-od-att-note { font-size: 11.5px; color: #1f7a3d; }
  .sb-od-att-note.err { color: #b3261e; }
  .sb-od-att-chips { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 12px; }
  .sb-od-att-chip { font: inherit; font-size: 12px; color: #876307; background: rgba(154,114,9,0.08); border: 0.5px solid rgba(154,114,9,0.3); border-radius: 8px; padding: 5px 10px; cursor: pointer; }
  .sb-od-att-chip:hover:not(:disabled) { background: rgba(154,114,9,0.16); }
  .sb-od-att-chip:disabled { opacity: 0.6; cursor: default; }
  .sb-od-email-modal { width: min(640px, 94vw); }

  /* ── Status overview card ── */
  .sb-od-status { border: 0.5px solid #E2D8C6; border-radius: 12px; background: #FBFAF7; padding: 14px 18px; margin-top: 14px; }
  .sb-od-status-top { display: flex; align-items: center; gap: 14px; }
  .sb-od-status-label { font-size: 11px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: #876307; }
  .sb-od-status-signed { font-size: 12.5px; font-weight: 600; color: #2d7a4f; background: #e8f5ea; border-radius: 999px; padding: 4px 12px; }
  .sb-od-mark-contracted { font: inherit; font-size: 12.5px; font-weight: 700; color: #fff; background: #9A7209; border: none; border-radius: 999px; padding: 6px 15px; cursor: pointer; }
  .sb-od-mark-contracted:hover { background: #876307; }
  .sb-od-mark-contracted.arm { background: #B3261E; }
  .sb-od-status-pct { margin-left: auto; font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 13px; font-weight: 700; }
  .sb-od-status-bar { height: 7px; border-radius: 4px; background: #E9E4D8; margin: 9px 0 11px; overflow: hidden; }
  .sb-od-status-bar i { display: block; height: 100%; background: linear-gradient(90deg, #9A7209, #B8933A); border-radius: 4px; transition: width 0.3s; }
  .sb-od-status-phases { display: flex; gap: 6px; flex-wrap: wrap; }
  .sb-od-ph { flex: 1; min-width: 90px; text-align: center; font: inherit; cursor: pointer; font-size: 10.5px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; padding: 6px 4px; border-radius: 7px; border: 0.5px solid #E2D8C6; background: #fff; color: #8a8a85; }
  .sb-od-ph:hover { border-color: #9A7209; }
  .sb-od-ph.done { color: #2d7a4f; border-color: rgba(45,122,79,0.35); background: #e8f5ea; }
  .sb-od-ph.now { color: #876307; border-color: #9A7209; background: rgba(154,114,9,0.09); box-shadow: inset 0 -2px 0 #9A7209; }
  .sb-od-ph.peek { outline: 2px solid #9A7209; outline-offset: 1px; }
  /* v2 (2026-08-03): plain-words headline + phase peek + lanes + gate popover */
  .sb-od-status-headline { font-size: 15px; font-weight: 700; color: #1a1a17; margin: 8px 0 10px; }
  .sb-od-phasepeek { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 8px; padding: 8px 10px; border: 0.5px solid #F0ECE2; border-radius: 8px; background: #FCFBF7; }
  .sb-od-phasepeek-empty { font-size: 12px; color: #8a8a85; }
  .sb-od-peekstep { font: inherit; cursor: pointer; font-size: 12px; font-weight: 600; color: #6b6456; background: #fff; border: 0.5px solid #E2D8C6; border-radius: 999px; padding: 4px 11px; display: inline-flex; align-items: center; gap: 5px; }
  .sb-od-peekstep i { font-style: normal; width: 12px; text-align: center; color: #2d7a4f; }
  .sb-od-peekstep.done { color: #2d7a4f; border-color: rgba(45,122,79,0.4); background: #e8f5ea; }
  .sb-od-peekstep:hover:not(:disabled) { border-color: #9A7209; }
  .sb-od-peekstep:disabled { opacity: 0.55; cursor: default; }
  .sb-od-ovpill-floor { color: #8a5a12; background: rgba(216,144,31,0.15); }
  .sb-od-ovpill-due-amber { color: #8a5a12; background: rgba(216,144,31,0.15); }
  .sb-od-ovpill-due-red { color: #B3261E; background: rgba(179,38,30,0.10); }
  .sb-od-ovpill-quiet { color: #55503F; background: #F1EFE8; }
  .sb-od-install-sched { color: #185F8F; }
  .sb-od-status-muted { color: #8a8a85; font-weight: 500; }
  .sb-od-status-lanes { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 14px; margin-top: 12px; padding-top: 12px; border-top: 0.5px solid #F0ECE2; }
  .sb-od-lane-h { display: block; font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 6px; }
  .sb-od-lane-h-wait { color: #B3261E; }
  .sb-od-lane-h-good { color: #14775A; }
  .sb-od-lane-chips { display: flex; gap: 5px; flex-wrap: wrap; align-items: center; }
  .sb-od-lanechip { font-size: 10.5px; font-weight: 700; letter-spacing: 0.03em; border-radius: 999px; padding: 3px 10px; }
  .sb-od-lanechip-good { color: #14775A; background: rgba(29,158,117,0.13); }
  .sb-od-lanechip-wait { font: inherit; font-size: 10.5px; font-weight: 700; letter-spacing: 0.03em; cursor: pointer; color: #B3261E; background: rgba(179,38,30,0.10); border: 0.5px solid rgba(179,38,30,0.35); border-radius: 999px; padding: 3px 10px; }
  .sb-od-lanechip-wait:hover { background: rgba(179,38,30,0.18); }
  .sb-od-gate-wrap { position: relative; display: inline-block; }
  .sb-od-gatepop { position: absolute; z-index: 40; top: calc(100% + 6px); left: 0; width: 300px; background: #fff; border: 0.5px solid #D9D2C0; border-radius: 10px; padding: 10px 12px; box-shadow: 0 8px 24px rgba(15,20,25,0.12); display: flex; flex-direction: column; gap: 7px; }
  .sb-od-gatepop-h { font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: #8a8472; }
  .sb-od-gatepop select, .sb-od-gatepop input { font: inherit; font-size: 13px; padding: 6px 9px; border: 0.5px solid #D9D2C0; border-radius: 7px; width: 100%; box-sizing: border-box; }
  .sb-od-gatepop-row { display: flex; gap: 6px; align-items: center; }
  .sb-od-gatepop-row input[type="date"] { flex: 1; min-width: 0; }
  .sb-od-gatepop-go { font: inherit; font-size: 12.5px; font-weight: 700; cursor: pointer; background: #9A7209; color: #fff; border: none; border-radius: 7px; padding: 7px 12px; white-space: nowrap; }
  .sb-od-gatepop-go:disabled { opacity: 0.6; }
  .sb-od-gatepop-x { font: inherit; font-size: 12.5px; cursor: pointer; background: none; border: 0.5px solid #D9D2C0; border-radius: 7px; padding: 6px 10px; color: #6b6456; }
  .sb-od-gatepop-err { font-size: 11.5px; font-weight: 600; color: #B3261E; }
  /* Design summary (what we're making) */
  .sb-od-make { display: grid; grid-template-columns: 190px minmax(0, 1fr); gap: 18px; align-items: start; }
  .sb-od-make-img img { width: 100%; border: 0.5px solid #E6E1D4; border-radius: 10px; display: block; background: #fff; }
  .sb-od-make-noimg { border: 1px dashed #D9D2C0; border-radius: 10px; height: 120px; display: flex; align-items: center; justify-content: center; color: #8a8472; font-size: 12px; text-align: center; padding: 0 10px; }
  .sb-od-make-imgcap { font-size: 11.5px; color: #8a8472; margin-top: 5px; text-align: center; }
  .sb-od-make-rows { display: flex; flex-direction: column; gap: 8px; }
  .sb-od-make-row { display: flex; gap: 10px; align-items: baseline; }
  .sb-od-make-row > b { flex-shrink: 0; min-width: 62px; font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: #8a8472; }
  .sb-od-make-row > span { font-size: 13.5px; }
  .sb-od-make-verse { font-style: italic; color: #444441; }
  .sb-od-make-name { font-weight: 700; }
  .sb-od-make-name em { font-style: normal; font-weight: 500; color: #5F5E5A; }
  .sb-od-make-reserved { border: 1px dashed #D9D2C0; border-radius: 6px; color: #8a8472; font-size: 12px; padding: 2px 10px; }
  .sb-od-make-notes { border-top: 0.5px solid #F0ECE2; padding-top: 8px; }
  .sb-od-make-notes > span { color: #444441; }
  @media (max-width: 760px) { .sb-od-make { grid-template-columns: 1fr; } }
  .sb-od-status-foot { display: flex; gap: 24px; margin-top: 12px; flex-wrap: wrap; align-items: center; }
  .sb-od-status-kv b { display: block; font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: #8a8a85; }
  .sb-od-status-kv span { font-size: 13.5px; font-weight: 600; }
  .sb-od-status-due { color: #B3261E; }
  .sb-od-ovpill { display: inline-block; font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; border-radius: 5px; padding: 2px 8px; }
  .sb-od-ovpill-red { color: #B3261E; background: rgba(179,38,30,0.08); }
  .sb-od-ovpill-amber { color: #8a5a12; background: rgba(183,121,31,0.1); }
  .sb-od-ovpill-blue { color: #1D6FA8; background: rgba(29,111,168,0.09); }

  /* Inline status controls on the overview card (same dropdowns as the table) */
  .sb-od-status-edit { display: flex; gap: 14px; margin-top: 12px; padding-top: 12px; border-top: 0.5px solid #E9E4D8; flex-wrap: wrap; align-items: flex-end; }
  .sb-od-sc { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
  .sb-od-sc > b { font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: #8a8a85; }
  .sb-od-sc select, .sb-od-sc-select { font: inherit; font-size: 12.5px; font-weight: 600; padding: 5px 8px; border: 0.5px solid #d8d6d1; border-radius: 8px; background: #fff; color: #1a1a17; max-width: 180px; cursor: pointer; }
  .sb-od-sc select:focus, .sb-od-sc-select:focus { outline: none; border-color: #9A7209; }
  /* Chip tones — SAME vocabulary as the Orders table (sb-tw-perm-*): good=green,
     warn=amber, info=blue, bad=red, neutral=quiet. */
  .sb-od-tone-good    { background: #e7f6ee; border-color: #8fceb0; color: #15724a; }
  .sb-od-tone-warn    { background: #fdf3e2; border-color: #e6b667; color: #8a5a12; }
  .sb-od-tone-info    { background: #eaf1fb; border-color: #9bb8e6; color: #234c8a; }
  .sb-od-tone-bad     { background: #fbedec; border-color: #e39b95; color: #b3261e; }
  .sb-od-tone-neutral { background: #fff; border-color: #d8d6d1; color: #4a4a45; }
  .sb-od-sc-date { font: inherit; font-size: 12px; padding: 4px 6px; border: 0.5px solid #d8d6d1; border-radius: 7px; background: #fff; color: #1a1a17; }
  /* Due-date proximity: amber inside 14 days, red due/overdue (2026-08-03). */
  .sb-od-due-amber { border-color: #b8842a; background: rgba(216,144,31,0.12); color: #8a5a12; font-weight: 700; }
  .sb-od-due-red { border-color: #B3261E; background: rgba(179,38,30,0.10); color: #B3261E; font-weight: 800; }
  .sb-od-sc-date:focus { outline: none; border-color: #9A7209; }
  .sb-od-sc-pair { display: flex; flex-direction: column; gap: 4px; }
  .sb-od-sc-na { font-size: 12px; color: #a09a8c; font-style: italic; padding: 6px 0; }

  /* Manual blocker (status card) — red kind chip like the Orders CALL pill */
  .sb-od-mb-chip { font: inherit; font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.03em; color: #B3261E; background: rgba(179,38,30,0.12); border: 1px solid rgba(179,38,30,0.65); border-radius: 999px; padding: 4px 10px; cursor: pointer; text-align: left; }
  .sb-od-mb-chip:hover { background: rgba(179,38,30,0.2); }
  /* HOLD — solid red, the loudest blocker there is. */
  .sb-od-mb-chip-hold { background: #B3261E; color: #fff; border-color: #B3261E; }
  .sb-od-mb-chip-hold:hover { background: #96201a; }
  .sb-od-mb-add { font: inherit; font-size: 12px; font-weight: 600; color: #8a8a85; background: none; border: 1px dashed #cfc7b4; border-radius: 999px; padding: 4px 10px; cursor: pointer; }
  .sb-od-mb-add:hover { color: #6a4d0c; border-color: #9A7209; }
  .sb-od-mb-edit { display: flex; flex-direction: column; gap: 6px; }
  .sb-od-mb-edit select, .sb-od-mb-edit input { font: inherit; font-size: 12.5px; padding: 5px 8px; border: 0.5px solid #d8d6d1; border-radius: 7px; background: #fff; }
  .sb-od-mb-edit-actions { display: flex; gap: 6px; }
  .sb-od-mb-edit-actions button { font: inherit; font-size: 12px; font-weight: 600; padding: 4px 10px; border-radius: 7px; border: 0.5px solid #d8d6d1; background: #fff; cursor: pointer; }
  .sb-od-mb-edit-actions button:hover { background: #f6f4ef; }
  .sb-od-mb-clear { color: #B3261E; }

  /* Die/Base stone-status color contract: red not ordered / blue ordered / green in stock */
  .sb-od-stone-sel { font-weight: 600; }
  .sb-od-stone-red   { color: #B3261E; background: rgba(179,38,30,0.07); border-color: rgba(179,38,30,0.4); }
  .sb-od-stone-blue  { color: #1D6FA8; background: rgba(29,111,168,0.07); border-color: rgba(29,111,168,0.4); }
  .sb-od-stone-green { color: #2d7a4f; background: rgba(45,122,79,0.08); border-color: rgba(45,122,79,0.4); }

  /* Design/Proof card — inline status select + proof drop zone */
  .sb-od-proof-drop { margin-top: 12px; border: 1.5px dashed #cfc7b4; border-radius: 10px; background: #FBFAF7; padding: 16px 14px; text-align: center; font-size: 12.5px; color: #8a8a85; cursor: pointer; transition: border-color 0.15s, background 0.15s; }
  .sb-od-proof-drop:hover { border-color: #9A7209; color: #6a4d0c; }
  .sb-od-proof-drop.over { border-color: #9A7209; background: rgba(154,114,9,0.07); color: #6a4d0c; }
  .sb-od-mark-approved { color: #2d7a4f; font-weight: 600; }
  .sb-od-pay-run { font-size: 11.5px; color: #8a8a85; font-variant-numeric: tabular-nums; }
  .sb-od-email-modal-head { display: flex; gap: 10px; align-items: flex-start; margin-bottom: 12px; }
  .sb-od-email-modal-body { font-size: 13.5px; color: #333; white-space: pre-wrap; word-break: break-word; max-height: 48vh; overflow-y: auto; border: 0.5px solid #f1efeb; border-radius: 10px; padding: 14px; background: #fcfbf9; }

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
