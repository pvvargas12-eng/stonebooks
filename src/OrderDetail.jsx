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
  getOrderActivity, addOrderActivityNote, addOrderTask, setOrderTaskStatus, logOrderActivity,
  updateOrderLeadFields, TASK_KINDS,
  uploadOrderAttachment, listOrderAttachments, deleteOrderAttachment, listCompletionPhotos, recordOrderPayment,
  updateOrderPayment, voidOrderPayment,
  getSignedContract, signedContractFileUrl, markContractSigned, removeSignedContract,
  getApprovalSigned, approvalSignedFileUrl, removeApprovalSigned,
  createApprovalLink, getApprovalLinksForOrder, revokeApprovalLink,
  ensureDerivedMilestones, updateMilestone, updateMilestoneWithOverride, deleteOrderActivity,
  getProofVersions, getProofSignatureSignedUrl,
  getMessageThread, sendShopEmail, aiDraftEmail,
  setOrderPermit, PERMIT_STATUSES, needsSignedContract, hardDeleteOrder,
  setOrderQuoteStatus, appendQuoteEvent,
  orderTypeLabel,
} from './lib/stonebooksData'
import { dimsFromWDT, dieDisplayInches, orderHasBase, buildBaseSpec, displayGraniteColor, SHAPES } from './lib/monumentCatalog'
import QuoteStatusBlock from './components/QuoteStatusBlock'
import { paymentTone, paymentLabel } from './lib/crmTheme'
import { Pill } from './lib/crmComponents.jsx'
import CustomerProfileSheet from './components/CustomerProfileSheet'
import AttachmentPreviewModal from './components/AttachmentPreviewModal'
import OrderPipelineRail from './components/OrderPipelineRail'
import { TEAM_ROSTER } from './lib/team'
import { generateContractPDF, generateApprovalSheetPDF, rowToOrder, ReceiptActions, SALES_REPS } from './SalesMode'
import ReceiptPreviewModal from './components/ReceiptPreviewModal'

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

function Section({ title, span = 1, id, children }) {
  return (
    <section id={id} className={`sb-od-card sb-od-span-${span}`}>
      <div className="sb-od-card-eyebrow">{title}</div>
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
export default function OrderDetail({ orderId, onBack, onEditInSales, onEditInSalesPortal, onOpenJob, onOpenCustomer, onOpenHub, initialAction = null, onConsumeInitialAction }) {
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
  // In-app attachment preview (#3) — { url, name, mime, isBlob } | null
  const [preview, setPreview] = useState(null)
  // Attachment delete confirm (#A) — { path, name } | null
  const [delAttach, setDelAttach] = useState(null)
  const [delAttachBusy, setDelAttachBusy] = useState(false)
  // Pipeline rail task-remove confirm (× with confirm)
  const [delTask, setDelTask] = useState(null)   // order_activity task row | null
  const [permitTaskText, setPermitTaskText] = useState('')
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
  const [permitDraft, setPermitDraft] = useState(null)
  const [permitBusy, setPermitBusy] = useState(false)
  const [permitMsg, setPermitMsg] = useState(null)
  // Activity log (#4)
  const [activity, setActivity] = useState([])
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
      const j = await getJobByOrderId(orderId)
      if (cancelled) return
      setOrder(o); setJob(j); setLoading(false)
      // Secondary loads (notes + attachment sources + emails) — non-blocking.
      // Email is the CUSTOMER's full thread (same shown in every order of theirs),
      // not order-segregated — keyed by the order's customer_id.
      const [nts, ups, pvs, ems, cps, acts, sc, sa, al] = await Promise.all([
        getOrderNotes(orderId),
        listOrderAttachments(orderId),
        j?.id ? getProofVersions(j.id) : Promise.resolve([]),
        o.customer_id ? getMessageThread({ customerId: o.customer_id }).then(r => r.messages || []) : Promise.resolve([]),
        listCompletionPhotos(orderId),
        getOrderActivity(orderId),
        getSignedContract(orderId),
        getApprovalSigned(orderId),
        getApprovalLinksForOrder(orderId),
      ])
      if (cancelled) return
      setNotes(nts); setUploads(ups); setProofVers(pvs); setEmails(ems); setCompletionPhotos(cps); setActivity(acts); setSignedContract(sc); setSignedApproval(sa); setApprovalLinks(al)
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
  }, [initialAction, order, onConsumeInitialAction])

  const refreshNotes = async () => setNotes(await getOrderNotes(orderId))
  const refreshUploads = async () => setUploads(await listOrderAttachments(orderId))
  const refreshOrder = async () => { const o = await getOrderById(orderId); if (o) setOrder(o) }
  const refreshActivity = async () => setActivity(await getOrderActivity(orderId))
  const refreshJob = async () => { const j = await getJobByOrderId(orderId); setJob(j) }

  // ── Pipeline rail handlers ──────────────────────────────────────────────────
  const milestoneStatusLabel = (s) => s === 'done' ? 'Done' : s === 'in_progress' ? 'In progress' : s === 'blocked' ? 'Blocked' : 'Not started'

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
    await logOrderActivity(orderId, {
      type: 'change', field: 'Milestone',
      oldValue: milestoneStatusLabel(prev?.status), newValue: milestoneStatusLabel(status),
      note: `${label}: ${milestoneStatusLabel(prev?.status)} → ${milestoneStatusLabel(status)}`,
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
    await logOrderActivity(orderId, { type: 'task', note: text, field: phase, taskStatus: 'open', actor })
    refreshActivity()
  }

  const confirmRemoveTask = async () => {
    if (!delTask) return
    await deleteOrderActivity(delTask.id)
    setDelTask(null)
    refreshActivity()
  }

  const pipelineTasks = activity.filter(a => a.type === 'task')
  const permitTasks = activity.filter(a => a.type === 'task' && a.field === 'permit')
  const addPermitTask = async () => {
    const text = permitTaskText.trim()
    if (!text) return
    const actor = await getCurrentStaffName()
    await logOrderActivity(orderId, { type: 'task', field: 'permit', note: text, taskStatus: 'open', actor })
    setPermitTaskText('')
    refreshActivity()
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
        const otherOpenLayout = activity.some(t => t.type === 'task' && t.id !== a.id && t.kind === 'layout' && t.task_status === 'open')
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
      await logOrderActivity(orderId, { type: 'change', field: 'Approval link', newValue: 'sent', note: 'Approval link sent', actor: await getCurrentStaffName() })
      refreshApprovalLinks(); refreshActivity()
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
    const prevPermit = order.permit_status
    const r = await setOrderPermit(orderId, patch)
    setPermitBusy(false)
    if (!r.ok) { setPermitMsg({ type: 'err', text: r.error }); return }
    setPermitDraft(null); await refreshOrder()
    if (patch.permit_status && patch.permit_status !== prevPermit) {
      await logOrderActivity(orderId, {
        type: 'change', field: 'Permit status',
        oldValue: humanize(prevPermit) || '(none)', newValue: humanize(patch.permit_status),
        actor: await getCurrentStaffName(),
      })
      refreshActivity()
    }
  }

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
    setEmailModal({ to: order?.customer?.email || '', subject: '', body: '', busy: false, error: null, sent: false })
  }
  const closeEmailComposer = () => setEmailModal(m => (m && m.busy ? m : null))
  const handleSendEmail = async () => {
    if (!emailModal) return
    const to = (emailModal.to || '').trim()
    const subject = (emailModal.subject || '').trim()
    if (!to || !subject || emailModal.busy) return
    setEmailModal(m => ({ ...m, busy: true, error: null }))
    const res = await sendShopEmail({ orderId, customerId: order?.customer_id || null, to, subject, text: emailModal.body })
    if (!res.ok) { setEmailModal(m => ({ ...m, busy: false, error: res.error || 'Send failed' })); return }
    setEmailModal(m => ({ ...m, busy: false, sent: true }))
    if (order?.customer_id) setEmails((await getMessageThread({ customerId: order.customer_id })).messages || [])
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
  const voidPay = async (p) => {
    const reason = window.prompt('Void this payment? Enter a reason (kept for the record):')
    if (reason == null) return
    if (!reason.trim()) { setPayRowErr('A reason is required to void a payment.'); return }
    setPayRowBusy(p.id); setPayRowErr(null)
    const actor = await getCurrentStaffName().catch(() => null)
    const res = await voidOrderPayment(orderId, p.id, { reason: reason.trim(), actor })
    setPayRowBusy(null)
    if (!res.ok) { setPayRowErr(res.error || 'Could not void the payment.'); return }
    await refreshOrder()
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


  // Receipt needs the camelCase wizard shape — adapt the raw row via the canonical
  // rowToOrder (real fields only; no faked mapping). Raw non-voided payments power
  // the editable history + per-row receipts.
  const receiptOrder = rowToOrder(order, order.customer, order.cemetery)
  const rawPayments = (Array.isArray(order.payments) ? order.payments.filter(p => p && !p.voided) : [])
    .slice().sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0))

  // Address blocks
  const custAddr = [cust.address_line1, cust.address_line2, [cust.city, cust.state, cust.zip].filter(Boolean).join(', ')].filter(Boolean)
  const cemAddr = [cem.address, [cem.city, cem.state, cem.zip].filter(Boolean).join(', ')].filter(Boolean)
  const referral = [humanize(cust.referral_source), cust.referral_source_detail].filter(Boolean).join(' — ')

  // Quick-glance values (the three things to read the instant the order opens).
  const plotShort = [
    order.plot_section && `Sec ${order.plot_section}`,
    order.plot_block && `Blk ${order.plot_block}`,
    order.plot_lot && `Lot ${order.plot_lot}`,
    order.plot_grave && `Grave ${order.plot_grave}`,
  ].filter(Boolean).join(' · ')
  const orderType = orderTypeLabel(order, job)
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
  const railItems = [
    { id: 'od-customer', label: 'Customer & contact' },
    { id: 'od-cemetery', label: 'Cemetery & grave' },
    { id: 'od-monument', label: 'Monument' },
    { id: 'od-financial', label: 'Financial' },
    { id: 'od-permit', label: 'Permit' },
    { id: 'od-job', label: 'Related job' },
    { id: 'od-attachments', label: 'Attachments' },
    ...(completionPhotos.length > 0 ? [{ id: 'od-photos', label: 'Completion photos' }] : []),
    { id: 'od-notes', label: 'Notes' },
    { id: 'od-email', label: 'Email traffic' },
  ]

  // Monument die size — ALWAYS three values, L × W × H (feet-inches). Single-source
  // column-pick via dieDisplayInches so this can never drift from the other surfaces.
  const _die = dieDisplayInches(order)
  const dims = dimsFromWDT({ w: _die[0], d: _die[1], t: _die[2] })
  // Base presence via single-source orderHasBase (not the include-only check that
  // dropped a configured base). Render the real spec via buildBaseSpec when present.
  const _baseShape = SHAPES.find(s => s.code === order.shape)
  const baseSummary = !orderHasBase(baseConfig, _baseShape) ? 'Not included'
    : (buildBaseSpec({ baseConfig })
        || [humanize(baseConfig.sizeCode), baseConfig.heightCode ? `${baseConfig.heightCode}" tall` : null].filter(Boolean).join(' · ')
        || 'Included')
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
      const { doc, filename } = await generateContractPDF(camel, { returnDoc: true })
      const url = URL.createObjectURL(doc.output('blob'))
      openPreview(filename || 'Contract.pdf', url, 'application/pdf', true)
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
      key: `proof-${v.id}`, kind: 'Layout proof', label: `Layout v${v.version_number}`,
      sub: v.uploaded_at ? fmtDate(v.uploaded_at) : null, href: v.layout_image_url,
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
          <button type="button" className="sb-od-btn" onClick={() => setProfileOpen(true)}>View / print customer profile</button>
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

        {/* ── SECTIONS with left-rail nav ───────────────────────────────────── */}
        <div className="sb-od-layout">
          <SectionRail items={railItems} />
          <div className="sb-od-grid">
          {/* 1 — Customer / contact */}
          <Section id="od-customer" title="Customer & contact">
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
          <Section id="od-cemetery" title="Cemetery & grave">
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
          <Section id="od-monument" title={monumentCardTitle}>
            <Field label="Type" value={orderTypeLabel(order, job)} />
            {isStoneOrder && (
              <>
                <Field label="Shape" value={humanize(order.shape)} />
                <Field label="Die size" value={dims} />
                <Field label="Base size" value={baseSummary} />
                <Field label="Stone color" value={displayGraniteColor(order) || humanize(order.granite_color)} />
                <Field label="Finish / polish" value={finish} />
              </>
            )}
            <Field label="Inscription" value={[insc.epitaph, insc.customNotes].filter(Boolean).join(' · ')} />
            <Field label="Deceased" value={deceased.length
              ? deceased.map((d, i) => <div key={i}>{deceasedName(d) || '—'}</div>) : null} />
            <Field label="Add-ons" value={addOns.length
              ? addOns.map((a, i) => <div key={a.code || i}>{a.label || humanize(a.code)}{a.qty > 1 ? ` × ${a.qty}` : ''}</div>) : null} />
            <Field label="Proof / approval" value={proofLabel} hint={job ? null : 'no production job yet'} />
          </Section>

          {/* 3b — Design / proof quick-view (item B) */}
          <Section id="od-design" title="Design / proof">
            {reapprovalText && (
              <div className="sb-od-reapproval">⚠ {reapprovalText}</div>
            )}
            <Field label="Shape" value={humanize(order.shape)} />
            <Field label="Stone color" value={displayGraniteColor(order) || humanize(order.granite_color)} />
            <Field label="Die size" value={dims} />
            <Field label="Inscription" value={[insc.epitaph, insc.customNotes].filter(Boolean).join(' · ')} />
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
                  </div>
                </div>
              )
            })()}

            {/* Send for approval (Phase 4) — token link for the customer. */}
            <div className="sb-od-approval-send">
              <button type="button" className="sb-od-btn sb-od-btn-primary" disabled={sendBusy} onClick={handleSendForApproval}>
                {sendBusy ? 'Generating…' : 'Send for approval'}
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
                        {canCopy && (
                          <>
                            <button type="button" className="sb-od-link" onClick={() => navigator.clipboard?.writeText(l.share_url)}>Copy link</button>
                            <button type="button" className="sb-od-link" onClick={() => navigator.clipboard?.writeText(`Your monument layout is ready for approval: ${l.share_url}`)}>Copy message</button>
                          </>
                        )}
                        {(l.displayStatus === 'pending' || l.displayStatus === 'viewed') && (
                          <button type="button" className="sb-od-link sb-od-attach-del" onClick={() => handleRevokeLink(l.id)}>Revoke</button>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </Section>

          {/* 4 — Financial */}
          <Section id="od-financial" title="Financial">
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
              {rawPayments.map(p => (editPay?.id === p.id ? (
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
                      <button type="button" className="sb-od-link" onClick={e => { e.stopPropagation(); startEditPay(p) }}>Edit</button>
                      <button type="button" className="sb-od-link" onClick={e => { e.stopPropagation(); voidPay(p) }}>Void</button>
                    </span>
                  </div>
                  <div onClick={e => e.stopPropagation()}>
                    <ReceiptActions order={receiptOrder} payment={p} />
                  </div>
                </div>
              )))}
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
          <Section id="od-permit" title="Permit">
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
                <Field label="Permit status" value={<Pill severity={permitTone(order.permit_status)}>{permitStatusLabel(order.permit_status)}</Pill>} />
                {readyBlocked && <Field label="⚠ Blocking install" value="Stone is ready to set but the permit isn't approved." />}
                <Field label="Filed / Approved" value={[order.permit_filed_at && `filed ${fmtDate(order.permit_filed_at)}`, order.permit_approved_at && `approved ${fmtDate(order.permit_approved_at)}`].filter(Boolean).join(' · ') || null} />
                <Field label="Fee paid" value={order.permit_fee_paid != null ? fmtUSD(order.permit_fee_paid) : null} />
                <Field label="Cemetery notes" value={cem.permit_notes} />
                <Field label="Document requirements" value={cem.permit_document_requirements} />
                <Field label="Cemetery instructions" value={cem.permit_instructions} />
                <Field label="Permit contact" value={[cem.permit_contact_name, cem.permit_contact_phone, cem.permit_contact_email].filter(Boolean).join(' · ') || null} />

                {/* Permit tasks — order_activity (type 'task', field 'permit'). */}
                <div className="sb-od-permit-tasks">
                  <div className="sb-od-field-label">Permit tasks</div>
                  {permitTasks.length === 0 && <div className="sb-od-empty-inline">No permit tasks yet.</div>}
                  {permitTasks.map(t => (
                    <div key={t.id} className="sb-od-permit-task">
                      <button type="button" className="sb-od-permit-task-toggle" onClick={() => toggleTask(t)} title="Toggle done">{t.task_status === 'done' ? '✓' : '○'}</button>
                      <span className={t.task_status === 'done' ? 'sb-od-permit-task-done' : ''}>{t.note}{t.assignee ? ` · ${t.assignee}` : ''}</span>
                      <button type="button" className="sb-od-link sb-od-attach-del" onClick={() => setDelTask(t)}>×</button>
                    </div>
                  ))}
                  <div className="sb-od-permit-add">
                    <input className="sb-od-note-input" type="text" value={permitTaskText} placeholder="Add a permit task…"
                      onChange={e => setPermitTaskText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') addPermitTask() }} />
                    <button type="button" className="sb-od-btn" disabled={!permitTaskText.trim()} onClick={addPermitTask}>Add</button>
                  </div>
                </div>

                <div className="sb-od-inline-actions">
                  <button type="button" className="sb-od-link" onClick={openPermitEdit}>Update permit status</button>
                </div>
              </>
            )}
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

            {activity.length === 0 ? (
              <div className="sb-od-empty-inline">No activity yet.</div>
            ) : (
              <div className="sb-od-act-list">
                {activity.map(a => (
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
            {emails.length === 0 ? (
              <div className="sb-od-empty-inline">No email with this customer yet — Send email to start a thread.</div>
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
                        {em.direction === 'inbound' ? `from ${em.from || '—'}` : `to ${em.to || '—'}`}
                        {em.date ? ` · ${fmtDate(em.date)}` : ''}
                      </div>
                      {em.body && <div className="sb-od-email-snippet">{em.body.slice(0, 160)}</div>}
                    </div>
                  </div>
                ))}
              </div>
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
            />
          </div>
        </div>
      </div>

      {delTask && (
        <div className="sb-od-modal-overlay" onClick={() => setDelTask(null)}>
          <div className="sb-od-modal sb-od-modal-danger" role="dialog" aria-modal="true" aria-label="Remove task" onClick={e => e.stopPropagation()}>
            <div className="sb-od-modal-title">Remove this task?</div>
            <p className="sb-od-danger-summary"><strong>{delTask.note}</strong> will be removed from the pipeline and the activity log. This can’t be undone.</p>
            <div className="sb-od-modal-actions">
              <button type="button" className="sb-od-btn" onClick={() => setDelTask(null)}>Cancel</button>
              <button type="button" className="sb-od-danger-btn" onClick={confirmRemoveTask}>Remove</button>
            </div>
          </div>
        </div>
      )}

      {profileOpen && <CustomerProfileSheet order={order} onClose={() => setProfileOpen(false)} />}

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
              <span>Payment collected by</span>
              <select className="sb-od-note-input" value={payModal.collectedBy} disabled={payModal.confirm}
                onChange={e => setPayModal(m => ({ ...m, collectedBy: e.target.value }))}>
                {(payModal.collectedBy && !SALES_REPS.includes(payModal.collectedBy)) && <option value={payModal.collectedBy}>{payModal.collectedBy}</option>}
                <option value="">— select —</option>
                {SALES_REPS.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </label>
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
  .sb-od-approval-send { margin-top: 14px; padding-top: 12px; border-top: 1px solid #ece8df; }
  .sb-od-approval-link { display: flex; align-items: center; gap: 8px; margin-top: 10px; flex-wrap: wrap; }
  .sb-od-approval-link .sb-od-note-input { flex: 1 1 220px; min-width: 0; font-size: 12.5px; }
  .sb-od-approval-status { display: flex; flex-direction: column; gap: 6px; margin-top: 12px; }
  .sb-od-approval-row { display: flex; align-items: center; gap: 10px; font-size: 13px; }
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
