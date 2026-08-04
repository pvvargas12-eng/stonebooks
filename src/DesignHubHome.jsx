// =============================================================================
// 📚 Stonebooks — Design Hub Home (DESIGN-HUB-REDESIGN)
// =============================================================================
// A calm, scannable design surface. EVERY count/tile/list/task derives from ONE
// state machine — designStateFor(order, job, currentProofsByJob) — which reads
// the REAL layout source of truth (proof_versions.is_current) plus the existing
// approved/revision indicators. There is NO items.length count anywhere.
//
//   • Two sub-tabs: "Layouts needed" (CONTRACTED, 4-state) · "Estimate layouts"
//     (pre-contract leads of the same 3 types).
//   • 3 clickable summary tiles: Layouts due · Need revision · Need approval.
//   • A task panel (auto-derived from the 4 states + manual tasks persisted via
//     the SAME order_activity store the Sales-Leads task list uses).
//   • Search + sort over a MINIMAL row list: family · age/Adjustment pill · a
//     one-tap status box that WRITES the real design state (setOrderDesignStatus).
//   • Row click opens the existing design packet (onOpenJob) — packet untouched.
//
// Reused, not duplicated: designStateFor / getCurrentProofsByJob (proof truth),
// setOrderDesignStatus (the milestone-ladder writer the Orders/Jobs dropdowns
// use), addOrderTask / setOrderTaskStatus / getOpenTasksList (the Leads task
// store), getLatestChangeRequestNotes (revision notes). No pricing, no packet
// rebuild, no new tables.
// =============================================================================

import { useState, useMemo, useEffect, useCallback } from 'react'
import {
  getLatestChangeRequestNotes, listAllApprovalLinks, properName,
  designStateFor, orderIsEstimateLayout, listFloorDesignDoneJobIds,
  setOrderDesignStatus, addOrderTask, setOrderTaskStatus, getOpenTasksList,
  getCurrentStaffName, STAFF_NAMES, getActiveStaffUser,
  getProofVersionsByOrder, getProofVersions, uploadProofLayout, createProofVersion,
  sendShopEmail, markApprovalLinkEmailed, addShopTask,
  getJobByOrderId, deriveDesignStatus, listCurrentProofRefs,
} from './lib/stonebooksData'
import { DEPARTMENTS } from './lib/employees'
import { generateEstimatePDF, rowToOrder } from './SalesMode'

// ── small helpers (no Date in render — todayISO comes from an effect) ────────
const pad = (n) => String(n).padStart(2, '0')
const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` }
const customerOf = (o) => [o?.customer?.first_name, o?.customer?.last_name].filter(Boolean).join(' ')
// Family name for a row — early leads have no carved (deceased) lastname and
// sometimes only a first-name customer ("Chelsea"), so fall through to the
// customer's full name, then the order #, before giving up. properName gives
// uniform First-letter casing (KYRIAKATOS → Kyriakatos) without mangling
// McDonald / O'Brien.
const familyOf = (o) => properName(o?.primary_lastname || o?.customer?.last_name || customerOf(o) || o?.order_number || '—')
const msFrom = (iso) => { if (!iso) return null; const t = Date.parse(String(iso).slice(0, 10) + 'T00:00:00'); return Number.isNaN(t) ? null : t }

// Order age (days) from signed_at, falling back to the contract/created date.
function ageDaysOf(order, nowMs) {
  const t = msFrom(order?.signed_at || order?.contract_date || order?.created_at)
  if (t == null || !nowMs) return null
  return Math.max(0, Math.floor((nowMs - t) / 86400000))
}
// 2-week SLA urgency. DUE: >14d red, 7–14d amber, else neutral. REVISION: amber.
// NEED_APPROVAL / APPROVED: neutral.
function urgencyFor(state, ageDays) {
  if (state === 'due') {
    if (ageDays != null && ageDays > 14) return 'urgent'
    if (ageDays != null && ageDays >= 7) return 'soon'
    return 'none'
  }
  if (state === 'revision') return 'soon'
  return 'none'
}

// The one-tap status box. Each option WRITES the real design state via the SAME
// milestone-ladder writer the Orders/Jobs design dropdowns use.
const STATUS_BOX = [
  { code: 'due',           label: 'Needs design',     write: 'not_created' },
  { code: 'need_approval', label: 'Sent to customer', write: 'layout_created' },
  { code: 'revision',      label: 'Revision',         write: 'needs_adjustments' },
  { code: 'approved',      label: 'Approved',         write: 'layout_approved' },
]
const STATE_ORDER = { due: 0, revision: 1, need_approval: 2, approved: 3 }
const URG_RANK = { urgent: 0, soon: 1, none: 2 }

const TILES = [
  { code: 'due',           label: 'Layouts due',  tone: 'red' },
  { code: 'revision',      label: 'Need revision', tone: 'amber' },
  { code: 'need_approval', label: 'Need approval', tone: 'neutral' },
  { code: 'approved',      label: 'Layouts approved', tone: 'green' },
]
// Job-type slice — New stone / Bronze / Inscription are separate work streams
// (Paul, 2026-07-22). Matched on the ORDER's service types so the same chips
// drive the layouts queue, the estimates tab, and the library.
const TYPE_CHIPS = [
  { code: 'all',         label: 'All' },
  { code: 'new_stone',   label: 'New stone',   svc: ['NEW_STONE'] },
  { code: 'bronze',      label: 'Bronze Services', svc: ['BRONZE', 'BRONZE_MARKER'] },
  { code: 'inscription', label: 'Inscription', svc: ['INSCRIPTION'] },
]
const SORTS = [
  { code: 'urgency', label: 'Urgency' },
  { code: 'oldest',  label: 'Oldest first' },
  { code: 'newest',  label: 'Newest first' },
  { code: 'status',  label: 'By status' },
]
// Which design stream a row belongs to, readable ON the row (Paul 2026-08-04:
// "distinguish new stone that needs layout and bronze marker that needs layout").
const svcTag = (o) => {
  const svc = o?.service_types || []
  if (svc.includes('NEW_STONE')) return { label: 'NEW STONE', cls: 'stone' }
  if (svc.includes('BRONZE') || svc.includes('BRONZE_MARKER')) return { label: 'BRONZE', cls: 'bronze' }
  if (svc.includes('INSCRIPTION')) return { label: 'INSCRIPTION', cls: 'insc' }
  return null
}
const TASK_CAP = 10   // visible manual-task cap; overflow shows "+N more"

export default function DesignHubHome({ jobs = [], orders = [], currentProofsByJob, currentProofOrderIds, onOpenJob, onOpenOrder, onReload }) {
  const [todayISO, setTodayISO] = useState('')
  useEffect(() => { setTodayISO(todayStr()) }, [])
  const nowMs = todayISO ? msFrom(todayISO) : null

  const [tab, setTab] = useState('layouts')        // 'layouts' | 'estimates' | 'library'
  const [activeTile, setActiveTile] = useState(null)
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState('urgency')
  const [busyId, setBusyId] = useState(null)
  const [typeFilter, setTypeFilter] = useState('all')   // TYPE_CHIPS code
  const typeMatch = useCallback((order) => {
    if (typeFilter === 'all') return true
    const chip = TYPE_CHIPS.find(c => c.code === typeFilter)
    return (order?.service_types || []).some(t => chip?.svc?.includes(t))
  }, [typeFilter])

  // A stone physically past Ready to Bring Up = its design was approved (Paul
  // 2026-08-04: "we only bring up stones with approved designs") — those jobs
  // resolve to 'approved' instead of clogging Layouts due.
  const [floorDone, setFloorDone] = useState(() => new Set())
  useEffect(() => {
    let alive = true
    listFloorDesignDoneJobIds().then(s => { if (alive) setFloorDone(s) }).catch(() => {})
    return () => { alive = false }
  }, [])

  // ── ONE state machine → rows (contracted, 4 states) ────────────────────────
  const layoutRows = useMemo(() => {
    const rows = []
    for (const job of (jobs || [])) {
      if (!job) continue
      // getJobs flattens the customer join to job.customer (NOT order.customer)
      // — merge it in so familyOf's customer fallback works. Without this,
      // orders with no deceased on file (primary_lastname null) showed "—"
      // even though the customer's name was sitting right on the job.
      const raw = job.order || null
      const order = raw ? (raw.customer ? raw : { ...raw, customer: job.customer || null }) : null
      let state = designStateFor(order, job, currentProofsByJob)
      if (!state) continue
      if (state === 'due' && floorDone.has(job.id)) state = 'approved'
      const ageDays = ageDaysOf(order, nowMs)
      rows.push({ job, order, state, ageDays, urgency: urgencyFor(state, ageDays) })
    }
    return rows
  }, [jobs, currentProofsByJob, nowMs, floorDone])

  // ── Scroll memory — coming back from a job/order lands where you left off,
  // not at the top. Saved on row click, consumed once on the next mount.
  useEffect(() => {
    let saved = null
    try { saved = sessionStorage.getItem('dh2_scroll'); sessionStorage.removeItem('dh2_scroll') } catch { /* ignore */ }
    const y = Number(saved)
    if (saved != null && y > 0) requestAnimationFrame(() => window.scrollTo(0, y))
  }, [])
  const rememberScroll = () => {
    try { sessionStorage.setItem('dh2_scroll', String(Math.round(window.scrollY || 0))) } catch { /* ignore */ }
  }

  // Tile counts — derived from the SAME rows (never items.length).
  const counts = useMemo(() => {
    const c = { due: 0, revision: 0, need_approval: 0, approved: 0 }
    for (const r of layoutRows) c[r.state]++
    return c
  }, [layoutRows])

  // Approval-link pulse per order (sent / viewed / approved / changes
  // requested) — the loop status Paul couldn't see from the hub. Latest link
  // per order wins (listAllApprovalLinks is newest-first).
  const [approvalByOrder, setApprovalByOrder] = useState({})
  useEffect(() => {
    let alive = true
    listAllApprovalLinks().then(links => {
      if (!alive) return
      const m = {}
      for (const l of (links || [])) if (l.order_id && !m[l.order_id]) m[l.order_id] = l
      setApprovalByOrder(m)
    }).catch(() => { /* badges are additive */ })
    return () => { alive = false }
  }, [])
  const APPROVAL_LAB = { pending: 'Sent', viewed: 'Viewed by family', signed: 'Approved', changes_requested: 'Changes requested', expired: 'Link expired', revoked: 'Revoked' }
  // Tile-row numbers: latest link per order, bucketed by its display status.
  const approvalCounts = useMemo(() => {
    const c = {}
    for (const l of Object.values(approvalByOrder)) {
      const s = l.displayStatus || l.status
      c[s] = (c[s] || 0) + 1
    }
    return c
  }, [approvalByOrder])
  // Clicking a pulse stat filters the list to orders in that approval state.
  const [approvalFilter, setApprovalFilter] = useState(null)
  const togglePulse = (code) => { setApprovalFilter(f => (f === code ? null : code)); setActiveTile(null) }

  // REACH OUT — an approval sitting in Sent/Viewed for 3+ days with no answer
  // and no status change is a family waiting on silence (Paul, 2026-07-15).
  const staleApprovals = useMemo(() => {
    if (!todayISO) return []
    const nowMs = Date.parse(todayISO + 'T00:00:00')
    const out = []
    for (const l of Object.values(approvalByOrder)) {
      const s = l.displayStatus || l.status
      if (s !== 'pending' && s !== 'viewed') continue
      const last = l.viewed_at || l.emailed_at || l.created_at
      const ms = Date.parse(last || '')
      if (Number.isNaN(ms)) continue
      const days = Math.floor((nowMs - ms) / 86400000)
      if (days >= 3) out.push({ link: l, days, status: s })
    }
    return out.sort((a, b) => b.days - a.days)
  }, [approvalByOrder, todayISO])

  // FOLLOW-UP on a silent approval (Paul, 2026-07-20): a per-row nudge email —
  // PREVIEW first (nothing auto-sends), rides the normal shop pipeline, then
  // stamps the link's email evidence (emailed_at/emailed_to) so the Today
  // "email verified" read stays honest. At 7+ days the row also offers a
  // one-tap task to Admin to call the family instead.
  const [followup, setFollowup] = useState(null)   // { link, days, status, to, subject, body, busy, error }
  const [taskedLinkIds, setTaskedLinkIds] = useState(() => new Set())
  const openFollowup = useCallback((link, days, status) => {
    const fam = properName(link.order?.primary_lastname || '') || 'your family'
    const num = link.order?.order_number || ''
    const url = link.share_url || ''
    const body = status === 'viewed'
      ? `Hello,\n\nWe saw you had a chance to open the layout for ${fam}'s memorial — thank you. When you're ready, you can approve it or ask for any changes here:\n\n${url}\n\nNothing goes to production until you approve it, so please take the time you need. If it's easier, just reply to this email and we'll walk through it together.\n\nThank you.`
      : `Hello,\n\nA few days ago we sent over the layout for ${fam}'s memorial, and we want to make sure it reached you. You can view it, approve it, or ask for changes here:\n\n${url}\n\nNothing goes to production until you approve it. If anything in the layout should be different, reply to this email and we'll take care of it.\n\nThank you.`
    setFollowup({
      link, days, status,
      to: link.order?.customer?.email || '',
      subject: `The layout for ${fam}'s memorial${num ? ` — ${num}` : ''}`,
      body, busy: false, error: null,
    })
  }, [])
  const sendFollowup = useCallback(async () => {
    if (!followup || followup.busy) return
    const { link, to, subject, body } = followup
    if (!to.trim()) { setFollowup(f => ({ ...f, error: 'Add the family email address.' })); return }
    setFollowup(f => ({ ...f, busy: true, error: null }))
    const res = await sendShopEmail({ to: to.trim(), subject, text: body, orderId: link.order_id })
    if (!res?.ok) { setFollowup(f => ({ ...f, busy: false, error: res?.error || 'Could not send.' })); return }
    await markApprovalLinkEmailed(link.id, to.trim()).catch(() => {})
    setFollowup(null)
    await onReload?.()
  }, [followup, onReload])
  const taskAdminCall = useCallback(async (link, days) => {
    if (taskedLinkIds.has(link.id)) return
    const fam = properName(link.order?.primary_lastname || '') || (link.order?.order_number || 'the family')
    const actor = await getCurrentStaffName().catch(() => null)
    const res = await addShopTask({
      title: `Call ${fam} — layout approval waiting ${days} days`,
      assignee: 'Admin', assigneeKind: 'department',
      orderId: link.order_id, dueDate: todayStr(), taskType: 'design',
      createdBy: actor, taskedBy: actor,
    })
    if (res?.ok) setTaskedLinkIds(prev => new Set(prev).add(link.id))
  }, [taskedLinkIds])
  const approvalBadge = (orderId) => {
    const l = approvalByOrder[orderId]
    if (!l) return null
    const s = l.displayStatus || l.status
    const when = l.changes_requested_at || l.signed_at || l.viewed_at || l.emailed_at || l.created_at
    return (
      <span className={`sb-dh2-linkbadge sb-dh2-link-${s}`} title={when ? new Date(when).toLocaleDateString() : ''}>
        {APPROVAL_LAB[s] || s}
      </span>
    )
  }

  // Approval email from the hub (Paul 2026-08-04: "when i upload the design
  // there i want the option to preview the approval email like in the orders
  // page"). Re-sends the order's ACTIVE link through the same preview-first
  // composer; the FIRST send needs the approval packet, which only the order
  // page builds — so that path routes there instead of half-working here.
  const openApprovalEmail = useCallback((order) => {
    const l = order?.id ? approvalByOrder[order.id] : null
    const s = l ? (l.displayStatus || l.status) : null
    if (!l || !['pending', 'viewed'].includes(s)) {
      if (window.confirm('Layout saved. Send it for approval now? The first send builds the approval packet from the order page — open the Design card?')) {
        rememberScroll(); onOpenOrder?.(order.id, 'design')
      }
      return
    }
    const fam = properName(order?.primary_lastname || '') || 'your family'
    const num = order?.order_number || ''
    const url = l.share_url || ''
    setFollowup({
      kind: 'approval', link: { ...l, order }, days: null, status: s,
      to: order?.customer?.email || l.order?.customer?.email || '',
      subject: `The layout for ${fam}'s memorial${num ? ` — ${num}` : ''}`,
      body: `Hello,\n\nThe layout for ${fam}'s memorial is ready for your review. You can view it, approve it, or ask for changes here:\n\n${url}\n\nNothing goes to production until you approve it. If anything in the layout should be different, reply to this email and we'll take care of it.\n\nThank you.`,
      busy: false, error: null,
    })
  }, [approvalByOrder, onOpenOrder])

  // Revision notes (the customer's words) for revision rows + tasks.
  const [changeNotes, setChangeNotes] = useState({})
  const revisionKey = layoutRows.filter(r => r.state === 'revision').map(r => r.job.id).join(',')
  useEffect(() => {
    const revs = layoutRows.filter(r => r.state === 'revision')
      .map(r => ({ id: r.job.id, order_id: r.order?.id })).filter(j => j.id)
    if (!revs.length) { setChangeNotes({}); return }
    let alive = true
    getLatestChangeRequestNotes(revs).then(m => { if (alive) setChangeNotes(m || {}) }).catch(() => { if (alive) setChangeNotes({}) })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revisionKey])

  // ── MANUAL tasks ONLY (persisted via the SAME order_activity store as Leads) ──
  // Auto-generated tasks were dropped — the work is already visible in the rows,
  // so the panel shows only user-added tasks. Capped at 10 in the render (TASK_CAP).
  const scopeIds = useMemo(() => layoutRows.map(r => r.order?.id).filter(Boolean), [layoutRows])
  const scopeKey = scopeIds.join(',')
  const [manualTasks, setManualTasks] = useState([])
  const [taskNonce, setTaskNonce] = useState(0)
  useEffect(() => {
    if (!scopeKey) { setManualTasks([]); return }
    let alive = true
    getOpenTasksList(scopeKey.split(',')).then(l => {
      if (alive) setManualTasks((l || []).filter(t => t.kind === 'design'))
    }).catch(() => { if (alive) setManualTasks([]) })
    return () => { alive = false }
  }, [scopeKey, taskNonce])

  // Soonest-due first (NULLS LAST), then newest-created; cap the visible list.
  const sortedTasks = useMemo(() => {
    return [...manualTasks].sort((a, b) => {
      const da = a.due_date || '9999-12-31', db = b.due_date || '9999-12-31'
      if (da !== db) return da < db ? -1 : 1
      return (b.created_at || '').localeCompare(a.created_at || '')
    })
  }, [manualTasks])
  const visibleTasks = sortedTasks.slice(0, TASK_CAP)
  const moreTasks = Math.max(0, sortedTasks.length - TASK_CAP)

  const familyById = useMemo(() => {
    const m = {}; for (const r of layoutRows) if (r.order?.id) m[r.order.id] = familyOf(r.order); return m
  }, [layoutRows])

  // ── Visible row list (approval filter → tile filter → search → sort) ───────
  const visibleRows = useMemo(() => {
    let list
    if (approvalFilter) {
      // Pulse-stat filter: rows whose LATEST approval link is in that state
      // (includes approved rows — clicking "Approved" must show them).
      list = layoutRows.filter(r => {
        const l = approvalByOrder[r.order?.id]
        return l && (l.displayStatus || l.status) === approvalFilter
      })
    } else {
      list = activeTile ? layoutRows.filter(r => r.state === activeTile) : layoutRows.filter(r => r.state !== 'approved')
    }
    list = list.filter(r => typeMatch(r.order))
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      list = list.filter(r => [familyOf(r.order), customerOf(r.order), r.order?.order_number].filter(Boolean).join(' ').toLowerCase().includes(q))
    }
    const byUrg = (a, b) => (URG_RANK[a.urgency] - URG_RANK[b.urgency]) || ((b.ageDays || 0) - (a.ageDays || 0))
    const dt = (r) => (r.order?.signed_at || r.order?.created_at || '')
    const cmp =
      sortKey === 'oldest' ? (a, b) => dt(a).localeCompare(dt(b))
        : sortKey === 'newest' ? (a, b) => dt(b).localeCompare(dt(a))
          : sortKey === 'status' ? (a, b) => (STATE_ORDER[a.state] - STATE_ORDER[b.state]) || byUrg(a, b)
            : byUrg
    return [...list].sort(cmp)
  }, [layoutRows, activeTile, approvalFilter, approvalByOrder, search, sortKey, typeMatch])

  // Pulse-filter safety net (Paul, 2026-07-20: "changes requested doesn't
  // work"): the pulse COUNTS every order's latest link, but the row list only
  // covers contracted design-queue jobs — an order outside that queue (lead,
  // design already approved, non-layout type) matched the count and then
  // "Nothing matches." These render as order rows below the queue rows.
  const pulseExtraRows = useMemo(() => {
    if (!approvalFilter) return []
    const seen = new Set(layoutRows.map(r => r.order?.id).filter(Boolean))
    return Object.values(approvalByOrder)
      .filter(l => (l.displayStatus || l.status) === approvalFilter && l.order_id && !seen.has(l.order_id))
      .map(l => (orders || []).find(o => o.id === l.order_id) || { id: l.order_id, ...(l.order || {}) })
  }, [approvalFilter, approvalByOrder, layoutRows, orders])

  // ── Estimate-layout (lead) rows ────────────────────────────────────────────
  const estimateRows = useMemo(() => {
    let list = (orders || []).filter(o => orderIsEstimateLayout(o) && !o.archived && !o.lost_at)
    list = list.filter(typeMatch)
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      list = list.filter(o => [familyOf(o), customerOf(o), o.order_number].filter(Boolean).join(' ').toLowerCase().includes(q))
    }
    return list.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))
  }, [orders, search, typeMatch])

  // ── Layout library — the LATEST layout per order, one card each ────────────
  // (Paul, 2026-07-22: "just the photo library of all the previous layouts…
  // not 15 versions, just the latest of each order.") is_current rows ARE the
  // latest per scope; when an order has both scopes the job-scoped one wins.
  const [libRefs, setLibRefs] = useState(null)
  useEffect(() => {
    if (tab !== 'library' || libRefs) return
    let alive = true
    listCurrentProofRefs().then(r => { if (alive) setLibRefs(r || []) }).catch(() => { if (alive) setLibRefs([]) })
    return () => { alive = false }
  }, [tab, libRefs])
  const libraryCards = useMemo(() => {
    if (!libRefs) return null
    const jobToOrderId = new Map(); const jobById = new Map()
    for (const j of (jobs || [])) { jobById.set(j.id, j); if (j.order?.id) jobToOrderId.set(j.id, j.order.id) }
    const orderById = new Map((orders || []).map(o => [o.id, o]))
    for (const j of (jobs || [])) if (j.order?.id && !orderById.has(j.order.id)) orderById.set(j.order.id, j.order)
    const byOrder = new Map()
    for (const ref of libRefs) {
      if (!ref.layout_image_url) continue
      const oid = ref.order_id || jobToOrderId.get(ref.job_id)
      const key = oid || `job:${ref.job_id || ref.id}`
      const existing = byOrder.get(key)
      if (existing && existing.ref.job_id && !ref.job_id) continue   // job scope wins
      byOrder.set(key, {
        ref,
        order: oid ? (orderById.get(oid) || null) : null,
        job: ref.job_id ? (jobById.get(ref.job_id) || { id: ref.job_id }) : null,
      })
    }
    let cards = [...byOrder.values()].filter(c => !c.order || typeMatch(c.order))
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      cards = cards.filter(c => [familyOf(c.order), c.order?.order_number].filter(Boolean).join(' ').toLowerCase().includes(q))
    }
    return cards.sort((a, b) => familyOf(a.order).localeCompare(familyOf(b.order)))
  }, [libRefs, jobs, orders, search, typeMatch])

  // ── Actions ────────────────────────────────────────────────────────────────
  // Failures SAY SO (Paul 2026-08-04: "the page refreshes and doesnt change
  // anything") — and a pick this list can't display (no layout image on file)
  // explains itself instead of silently snapping back.
  const changeStatus = useCallback(async (row, code) => {
    const target = STATUS_BOX.find(s => s.code === code)
    if (!target || code === row.state) return
    if (!row.job?.id) { window.alert('No job on this order yet — the design status lives on the job. Open the order first.'); return }
    setBusyId(row.job.id)
    try {
      const r = await setOrderDesignStatus(row.job.id, target.write)
      if (r && r.ok === false) { window.alert(r.error || 'Could not update the design status.'); return }
      if ((code === 'need_approval' || code === 'revision') && !currentProofsByJob?.get(row.job.id)) {
        window.alert('Saved on the job — but there is no layout image on file, so the row stays under "Needs design" until one is uploaded (Upload layout) or it is marked Approved.')
      }
      await onReload?.()
    } finally { setBusyId(null) }
  }, [onReload, currentProofsByJob])

  // Per-row "Task…" — task a person or department with THIS order's layout
  // (Paul 2026-08-04: "from here i need a button to task people with specific
  // orders.. that way it gets done"). Lands in the Task CC linked to the order.
  const [taskFor, setTaskFor] = useState(null)   // { orderId, fam } | null
  const [taskWho, setTaskWho] = useState('')
  const [taskNote, setTaskNote] = useState('')
  const [taskDue, setTaskDue] = useState('')
  const [taskBusy, setTaskBusy] = useState(false)
  const openTaskFor = useCallback((r) => {
    const fam = familyOf(r.order)
    setTaskFor({ orderId: r.order?.id || null, fam })
    setTaskWho(getActiveStaffUser() || STAFF_NAMES[0] || '')
    setTaskNote(`Layout for ${fam}${r.order?.order_number ? ` (${r.order.order_number})` : ''}`)
    setTaskDue('')
  }, [])
  const sendRowTask = useCallback(async () => {
    if (!taskFor?.orderId || !taskNote.trim() || taskBusy) return
    setTaskBusy(true)
    const actor = await getCurrentStaffName().catch(() => null)
    const r = await addOrderTask(taskFor.orderId, {
      note: taskNote.trim(), kind: 'design', actor,
      assignee: taskWho, assigneeKind: DEPARTMENTS.includes(taskWho) ? 'department' : 'person',
      dueDate: taskDue || todayStr(),
    })
    setTaskBusy(false)
    if (r?.ok === false) { window.alert('Could not create the task.'); return }
    setTaskFor(null); setTaskNonce(n => n + 1)
  }, [taskFor, taskNote, taskWho, taskDue, taskBusy])

  const completeTask = useCallback(async (id) => {
    await setOrderTaskStatus(id, 'done'); setTaskNonce(n => n + 1)
  }, [])

  const [adding, setAdding] = useState(false)
  const [addOrderId, setAddOrderId] = useState('')
  const [addNote, setAddNote] = useState('')
  const saveTask = useCallback(async () => {
    const note = addNote.trim()
    if (!note || !addOrderId) return
    const actor = await getCurrentStaffName().catch(() => null)
    await addOrderTask(addOrderId, { note, kind: 'design', actor, dueDate: todayStr() })
    setAddNote(''); setAddOrderId(''); setAdding(false); setTaskNonce(n => n + 1)
  }, [addNote, addOrderId])

  const toggleTile = (code) => { setActiveTile(t => (t === code ? null : code)); setApprovalFilter(null) }

  // ── Layout uploader (Paul, 2026-07-14: upload from the hub, any row) ─────────
  // Job rows upload a JOB-scoped proof version (same plumbing as the packet);
  // order-only rows (estimates, or signed orders whose job hasn't been created
  // yet) upload ORDER-scoped — createJobFromOrder carries it onto the job.
  const [uploadFor, setUploadFor] = useState(null)   // { order, job|null } | null
  const [uploadBusy, setUploadBusy] = useState(false)
  const [uploadErr, setUploadErr] = useState(null)
  const [orderProof, setOrderProof] = useState(null) // current proof for the target
  const openUploader = useCallback(async (order, job = null) => {
    setUploadFor({ order, job }); setUploadErr(null); setOrderProof(null)
    // An "estimate" row can still carry a job (Garcia, 2026-07-20: check-job
    // era leads). Look one up so the upload lands JOB-scoped where one exists
    // — order-scoped uploads on jobful orders were invisible on the order.
    if (!job) {
      job = await getJobByOrderId(order.id).catch(() => null)
      if (job) setUploadFor({ order, job })
    }
    // BOTH scopes — the modal doubles as the viewer (Paul, 2026-07-20:
    // uploaded a layout and couldn't see or download it).
    const [a, b] = await Promise.all([
      job ? getProofVersions(job.id).catch(() => []) : Promise.resolve([]),
      getProofVersionsByOrder(order.id).catch(() => []),
    ])
    setOrderProof([...(a || []), ...(b || [])])
  }, [])
  const closeUploader = () => { if (!uploadBusy) { setUploadFor(null); setUploadErr(null); setOrderProof(null) } }
  const onPickLayout = useCallback(async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || !uploadFor) return
    setUploadBusy(true); setUploadErr(null)
    const { order, job } = uploadFor
    const up = job
      ? await uploadProofLayout(job.id, file, { scope: 'job' })
      : await uploadProofLayout(order.id, file, { scope: 'order' })
    if (!up.ok) { setUploadErr(up.error || 'Upload failed.'); setUploadBusy(false); return }
    const me = await getCurrentStaffName().catch(() => null)
    const { error } = await createProofVersion(job
      ? { jobId: job.id, layoutImageUrl: up.url, uploadedBy: me }
      : { orderId: order.id, layoutImageUrl: up.url, uploadedBy: me })
    setUploadBusy(false)
    if (error) { setUploadErr(error.message || 'Could not save the layout.'); return }
    // A layout now exists → design status reads "Layout created" (Paul,
    // 2026-07-20). Stamps UP from not_created only — never drags a
    // sent/approved order backwards.
    if (job && deriveDesignStatus(job) === 'not_created') {
      await setOrderDesignStatus(job.id, 'layout_created').catch(() => {})
    }
    setUploadFor(null); setOrderProof(null)
    setLibRefs(null)   // library refetches with the new version
    await onReload?.()
    // The option Paul asked for (2026-08-04): straight from the upload to the
    // approval-email preview. Contracted rows only — estimates have nobody to
    // approve yet. Cancel on the composer declines; nothing sends itself.
    if (job && order?.id) openApprovalEmail(order)
  }, [uploadFor, onReload, openApprovalEmail])
  const hasLayout = (orderId) => !!(currentProofOrderIds && currentProofOrderIds.has(orderId))

  // ESTIMATE SHEET (Paul, 2026-07-20): the layout ON a one-page estimate —
  // the estimate PDF already hides per-item rates and shows the final price;
  // the layout image renders above the line items.
  const [sheetBusyId, setSheetBusyId] = useState(null)
  const downloadEstimateSheet = useCallback(async (v) => {
    if (!uploadFor?.order || sheetBusyId) return
    setSheetBusyId(v.id); setUploadErr(null)
    try {
      const o = uploadFor.order
      const camel = rowToOrder(o, o.customer, o.cemetery)
      const { doc } = await generateEstimatePDF(camel, { returnDoc: true, layoutImageUrl: v.layout_image_url })
      const base = String(o.primary_lastname || o.order_number || 'estimate').replace(/[^\w-]+/g, '_')
      doc.save(`${base}-estimate-layout.pdf`)
    } catch (e) {
      setUploadErr(`Estimate sheet failed — ${e?.message || e}.`)
    } finally { setSheetBusyId(null) }
  }, [uploadFor, sheetBusyId])

  // ── Search safety net (Paul, 2026-07-14: "yager won't come up ANYWHERE") ────
  // A search that misses the job rows falls back to matching ORDERS — signed
  // orders whose job doesn't exist yet, leads, anything — so a family name
  // typed here always finds its record.
  const fallbackRows = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (tab !== 'layouts' || !q) return []
    const seen = new Set(layoutRows.map(r => r.order?.id).filter(Boolean))
    return (orders || [])
      .filter(o => o && !o.archived && !seen.has(o.id))
      .filter(o => [familyOf(o), customerOf(o), o.order_number].filter(Boolean).join(' ').toLowerCase().includes(q))
      .slice(0, 20)
  }, [tab, search, orders, layoutRows])

  return (
    <div className="sb-dh2">
      <style>{CSS}</style>

      {/* SUB-TABS */}
      <div className="sb-dh2-tabs">
        <button type="button" className={`sb-dh2-tab${tab === 'layouts' ? ' on' : ''}`} onClick={() => setTab('layouts')}>Layouts needed</button>
        <button type="button" className={`sb-dh2-tab${tab === 'estimates' ? ' on' : ''}`} onClick={() => setTab('estimates')}>Estimate layouts</button>
        <button type="button" className={`sb-dh2-tab${tab === 'library' ? ' on' : ''}`} onClick={() => setTab('library')}>Layout library</button>
      </div>

      {/* TYPE SLICE — the three design streams are separate work */}
      <div className="sb-dh2-typechips">
        {TYPE_CHIPS.map(c => (
          <button key={c.code} type="button" className={`sb-dh2-typechip${typeFilter === c.code ? ' on' : ''}`}
            onClick={() => setTypeFilter(c.code)}>
            {c.label}
          </button>
        ))}
      </div>

      {tab === 'layouts' ? (
        <>
          {/* TILES */}
          <div className="sb-dh2-tiles">
            {TILES.map(t => (
              <button
                key={t.code}
                type="button"
                className={`sb-dh2-tile sb-dh2-tile-${t.tone}${activeTile === t.code ? ' on' : ''}`}
                onClick={() => toggleTile(t.code)}
              >
                <span className="sb-dh2-tile-num">{counts[t.code]}</span>
                <span className="sb-dh2-tile-lab">{t.label}</span>
              </button>
            ))}
          </div>

          {/* APPROVAL PULSE — the customer-loop numbers (latest link per
              order). CLICK a stat to filter the list to those orders. */}
          <div className="sb-dh2-pulse">
            <span className="sb-dh2-pulse-lab">Approvals</span>
            {[['pending', 'Sent, waiting'], ['viewed', 'Viewed by family'], ['changes_requested', 'Changes requested'], ['signed', 'Approved']].map(([code, lab]) => (
              <button key={code} type="button"
                className={`sb-dh2-pulse-stat sb-dh2-link-${code}${approvalFilter === code ? ' on' : ''}`}
                onClick={() => togglePulse(code)}
                title={approvalFilter === code ? 'Clear this filter' : `Show only orders whose approval is ${lab.toLowerCase()}`}>
                <b>{approvalCounts[code] || 0}</b> {lab}
              </button>
            ))}
            {approvalFilter && <button type="button" className="sb-dh2-pulse-clear" onClick={() => setApprovalFilter(null)}>Clear</button>}
          </div>

          {/* REACH OUT — approvals sitting 3+ days in Sent/Viewed with no
              answer. The family is waiting on silence; call them. */}
          {staleApprovals.length > 0 && (
            <div className="sb-dh2-stale">
              <div className="sb-dh2-stale-head">
                Reach out — {staleApprovals.length} approval{staleApprovals.length === 1 ? '' : 's'} waiting 3+ days with no answer
              </div>
              {staleApprovals.map(({ link, days, status }) => (
                <div key={link.id} className="sb-dh2-stale-row">
                  <span className="sb-dh2-stale-fam">{properName(link.order?.primary_lastname || link.order?.order_number || 'Order')}</span>
                  <span className="sb-dh2-stale-what">
                    {status === 'viewed'
                      ? `family OPENED it ${days}d ago and hasn't answered`
                      : `sent ${days}d ago, never opened`}
                  </span>
                  <button type="button" className="sb-dh2-createbtn"
                    title="Preview a nudge email before anything sends"
                    onClick={() => openFollowup(link, days, status)}>
                    Follow-up email
                  </button>
                  {days >= 7 && (
                    taskedLinkIds.has(link.id) ? (
                      <span className="sb-dh2-stale-tasked">Task created</span>
                    ) : (
                      <button type="button" className="sb-dh2-jobbtn"
                        title="One tap: a task to the Admin department to call the family today"
                        onClick={() => taskAdminCall(link, days)}>
                        Task admin to call
                      </button>
                    )
                  )}
                  <button type="button" className="sb-dh2-jobbtn"
                    onClick={() => { rememberScroll(); onOpenOrder?.(link.order_id, 'design') }}>
                    Open order
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* TASK PANEL */}
          <div className="sb-dh2-tasks">
            <div className="sb-dh2-tasks-head">
              <span className="sb-dh2-tasks-title">Tasks</span>
              <button type="button" className="sb-dh2-addbtn" onClick={() => setAdding(a => !a)}>{adding ? 'Cancel' : '+ Add task'}</button>
            </div>
            {adding && (
              <div className="sb-dh2-addrow">
                <select className="sb-dh2-sel" value={addOrderId} onChange={e => setAddOrderId(e.target.value)}>
                  <option value="">— pick a family —</option>
                  {layoutRows.map(r => <option key={r.job.id} value={r.order?.id}>{familyOf(r.order)}{r.order?.order_number ? ` · ${r.order.order_number}` : ''}</option>)}
                </select>
                <input className="sb-dh2-inp" value={addNote} onChange={e => setAddNote(e.target.value)} placeholder="Task — e.g. confirm photo with family" />
                <button type="button" className="sb-dh2-savebtn" onClick={saveTask} disabled={!addNote.trim() || !addOrderId}>Save</button>
              </div>
            )}
            {manualTasks.length === 0 ? (
              <div className="sb-dh2-tasks-empty">No tasks yet. Use “+ Add task”.</div>
            ) : (
              <>
                <ul className="sb-dh2-tasklist">
                  {visibleTasks.map(t => (
                    <li key={t.id} className="sb-dh2-taskitem sb-dh2-taskitem-manual">
                      <input type="checkbox" className="sb-dh2-taskcheck" onChange={() => completeTask(t.id)} aria-label="Complete task" />
                      <span className="sb-dh2-tasktext">{t.note} <span className="sb-dh2-taskfam">· {familyById[t.order_id] || ''}</span></span>
                      <span className="sb-dh2-taskkind sb-dh2-kind-neutral">Manual</span>
                    </li>
                  ))}
                </ul>
                {moreTasks > 0 && <div className="sb-dh2-taskmore">+{moreTasks} more</div>}
              </>
            )}
          </div>

          {/* SEARCH + SORT */}
          <div className="sb-dh2-toolbar">
            <input className="sb-dh2-search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search family, customer, or order #…" />
            <div className="sb-dh2-sortwrap">
              <span className="sb-dh2-sortlab">Sort</span>
              <select className="sb-dh2-sel" value={sortKey} onChange={e => setSortKey(e.target.value)}>
                {SORTS.map(s => <option key={s.code} value={s.code}>{s.label}</option>)}
              </select>
            </div>
          </div>

          {/* CLEAN ROW LIST */}
          {visibleRows.length === 0 && pulseExtraRows.length === 0 ? (
            <div className="sb-dh2-empty">{layoutRows.length === 0 ? 'No contracted layouts in scope.' : 'Nothing matches.'}</div>
          ) : visibleRows.length === 0 ? null : (
            <div className="sb-dh2-rows">
              {visibleRows.map(r => (
                <div
                  key={r.job.id}
                  className={`sb-dh2-row sb-dh2-row-${r.urgency}`}
                  onClick={() => {
                    // Row click → the DESIGN PACKET (Paul's expectation,
                    // 2026-07-15 round 2); the order's design card is the
                    // secondary button.
                    rememberScroll()
                    onOpenJob?.(r.job.id, 'design')
                  }}
                  role="button"
                  tabIndex={0}
                  title="Open the design packet"
                >
                  <span className="sb-dh2-fam">{familyOf(r.order)}</span>
                  {(() => { const t = svcTag(r.order); return t ? <span className={`sb-dh2-typetag sb-dh2-typetag-${t.cls}`}>{t.label}</span> : null })()}
                  {r.state === 'revision' ? (
                    <span className="sb-dh2-pill sb-dh2-pill-amber">Adjustment needed</span>
                  ) : (
                    <span className={`sb-dh2-age sb-dh2-age-${r.urgency}`}>{r.ageDays != null ? `${r.ageDays}d` : '—'}</span>
                  )}
                  {r.order?.id && approvalBadge(r.order.id)}
                  <span className="sb-dh2-row-spacer" />
                  <button type="button" className="sb-dh2-createbtn"
                    onClick={e => { e.stopPropagation(); openUploader(r.order, r.job) }}
                    title="Upload the layout image right here — becomes the next proof version">
                    Upload layout
                  </button>
                  <button type="button" className="sb-dh2-jobbtn"
                    onClick={e => { e.stopPropagation(); rememberScroll(); if (r.order?.id) onOpenOrder?.(r.order.id, 'design') }}
                    title="The order's Design/proof card — approval links, statuses, change requests">
                    Order design
                  </button>
                  <button type="button" className="sb-dh2-jobbtn"
                    onClick={e => { e.stopPropagation(); (taskFor && taskFor.orderId === r.order?.id) ? setTaskFor(null) : openTaskFor(r) }}
                    title="Task a person or department with this order — lands in the Task Command Center, linked here">
                    Task…
                  </button>
                  <select
                    className={`sb-dh2-statusbox sb-dh2-st-${r.state}`}
                    value={r.state}
                    disabled={busyId === r.job.id}
                    onClick={e => e.stopPropagation()}
                    onChange={e => { e.stopPropagation(); changeStatus(r, e.target.value) }}
                  >
                    {STATUS_BOX.map(s => <option key={s.code} value={s.code}>{s.label}</option>)}
                  </select>
                  {(() => {
                    // The customer's words, readable right on the row: the
                    // revision-milestone note first, else the latest approval
                    // link's changes-requested note.
                    const l = approvalByOrder[r.order?.id]
                    const linkNote = l && (l.displayStatus || l.status) === 'changes_requested' ? l.change_notes : null
                    const note = (r.state === 'revision' && changeNotes[r.job.id]) || linkNote
                    return note ? <span className="sb-dh2-changenote">“{note}”</span> : null
                  })()}
                  {taskFor && taskFor.orderId && taskFor.orderId === r.order?.id && (
                    <div className="sb-dh2-rowtask" onClick={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}>
                      <select value={taskWho} onChange={e => setTaskWho(e.target.value)} aria-label="Who gets the task">
                        <optgroup label="People">{STAFF_NAMES.map(n => <option key={n} value={n}>{n}</option>)}</optgroup>
                        <optgroup label="Departments">{DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}</optgroup>
                      </select>
                      <input style={{ flex: 1, minWidth: 200 }} value={taskNote} onChange={e => setTaskNote(e.target.value)} placeholder="What needs doing…" />
                      <input type="date" value={taskDue} onChange={e => setTaskDue(e.target.value)} title="Due date — blank means today" />
                      <button type="button" className="sb-dh2-createbtn" disabled={taskBusy || !taskNote.trim()} onClick={sendRowTask}>
                        {taskBusy ? '…' : 'Task it'}
                      </button>
                      <button type="button" className="sb-dh2-jobbtn" onClick={() => setTaskFor(null)}>×</button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Pulse-filter safety net — approval states on orders OUTSIDE the
              contracted layout queue (leads, already-designed, non-layout). */}
          {pulseExtraRows.length > 0 && (
            <>
              <div className="sb-dh2-fallback-note">
                In this approval state, outside the layout queue:
              </div>
              <div className="sb-dh2-rows">
                {pulseExtraRows.map(o => {
                  const l = approvalByOrder[o.id]
                  const linkNote = l && (l.displayStatus || l.status) === 'changes_requested' ? l.change_notes : null
                  return (
                    <div key={o.id} className="sb-dh2-row" onClick={() => { rememberScroll(); onOpenOrder?.(o.id, 'design') }} role="button" tabIndex={0}>
                      <span className="sb-dh2-fam">{familyOf(o)}</span>
                      <span className="sb-dh2-est-meta">{o.order_number || (o.signed_at ? '—' : 'Lead / estimate')}</span>
                      {approvalBadge(o.id)}
                      <span className="sb-dh2-row-spacer" />
                      <button type="button" className="sb-dh2-createbtn"
                        onClick={e => { e.stopPropagation(); rememberScroll(); onOpenOrder?.(o.id, 'design') }}>
                        Open order
                      </button>
                      {linkNote && <span className="sb-dh2-changenote">“{linkNote}”</span>}
                    </div>
                  )
                })}
              </div>
            </>
          )}

          {/* Search safety net — orders the job list doesn't cover (signed but
              job not created yet, leads, etc.) so a searched family ALWAYS
              surfaces. Opening the order self-heals a missing job. */}
          {fallbackRows.length > 0 && (
            <>
              <div className="sb-dh2-fallback-note">Not in the design list — found in Orders:</div>
              <div className="sb-dh2-rows">
                {fallbackRows.map(o => (
                  <div key={o.id} className="sb-dh2-row" onClick={() => { rememberScroll(); onOpenOrder?.(o.id, 'design') }} role="button" tabIndex={0}>
                    <span className="sb-dh2-fam">{familyOf(o)}</span>
                    <span className="sb-dh2-est-meta">{o.order_number || '—'}</span>
                    <span className="sb-dh2-pill sb-dh2-pill-amber">{o.signed_at ? 'No design job yet — open to fix' : 'Lead / estimate'}</span>
                    {hasLayout(o.id) && <span className="sb-dh2-pill sb-dh2-pill-green">Layout ✓</span>}
                    {approvalBadge(o.id)}
                    <span className="sb-dh2-row-spacer" />
                    <button type="button" className="sb-dh2-createbtn" onClick={e => { e.stopPropagation(); openUploader(o) }}>
                      {hasLayout(o.id) ? 'View / update layout' : 'Upload layout'}
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      ) : tab === 'estimates' ? (
        /* ── ESTIMATE LAYOUTS (leads) ─────────────────────────────────────── */
        <>
          <div className="sb-dh2-toolbar">
            <input className="sb-dh2-search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search estimate family / order #…" />
            <span className="sb-dh2-estcount">{estimateRows.length} estimate {estimateRows.length === 1 ? 'layout' : 'layouts'}</span>
          </div>
          {estimateRows.length === 0 ? (
            <div className="sb-dh2-empty">No pre-contract estimate layouts.</div>
          ) : (
            <div className="sb-dh2-rows">
              {estimateRows.map(o => (
                <div key={o.id} className="sb-dh2-row" onClick={() => { rememberScroll(); onOpenOrder?.(o.id, 'design') }} role="button" tabIndex={0}>
                  <span className="sb-dh2-fam">{familyOf(o)}</span>
                  <span className="sb-dh2-est-meta">{o.order_number || 'estimate'}</span>
                  {hasLayout(o.id) && <span className="sb-dh2-pill sb-dh2-pill-green">Layout ✓</span>}
                  {approvalBadge(o.id)}
                  <span className="sb-dh2-row-spacer" />
                  <button type="button" className="sb-dh2-createbtn" onClick={e => { e.stopPropagation(); openUploader(o) }}>
                    {hasLayout(o.id) ? 'View / update layout' : 'Create estimate layout'}
                  </button>
                </div>
              ))}
            </div>
          )}
        </>
      ) : (
        /* ── LAYOUT LIBRARY — the latest layout per order, one card each ──── */
        <>
          <div className="sb-dh2-toolbar">
            <input className="sb-dh2-search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search the layout library — family or order #…" />
            <span className="sb-dh2-estcount">{libraryCards ? `${libraryCards.length} layout${libraryCards.length === 1 ? '' : 's'}` : 'Loading…'}</span>
          </div>
          {!libraryCards ? (
            <div className="sb-dh2-empty">Pulling every current layout…</div>
          ) : libraryCards.length === 0 ? (
            <div className="sb-dh2-empty">No layouts on file{typeFilter !== 'all' || search.trim() ? ' for this filter' : ' yet'}.</div>
          ) : (
            <div className="sb-dh2-libgrid">
              {libraryCards.map(c => (
                <button key={c.ref.id} type="button" className="sb-dh2-libcard"
                  onClick={() => { if (c.order) openUploader(c.order, c.job) }}
                  title={c.order ? 'Open — view full size, download, upload a new version' : 'No order record found for this layout'}>
                  <img src={c.ref.layout_image_url} alt="" loading="lazy" />
                  <span className="sb-dh2-libname">{familyOf(c.order)}</span>
                  <span className="sb-dh2-libmeta">
                    {c.order?.order_number || '—'}
                    {c.ref.approved_at ? ' · approved' : ''}
                  </span>
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {/* Follow-up email — PREVIEW, edit, then send. Nothing is automatic. */}
      {followup && (
        <div className="sb-dh2-modal-overlay" onClick={() => { if (!followup.busy) setFollowup(null) }}>
          <div className="sb-dh2-modal sb-dh2-modal-wide" onClick={e => e.stopPropagation()}>
            <div className="sb-dh2-modal-title">
              {followup.kind === 'approval' ? 'Approval email' : 'Follow-up'} · {properName(followup.link.order?.primary_lastname || '') || followup.link.order?.order_number || 'Order'}
            </div>
            <div className="sb-dh2-modal-sub">
              {followup.kind === 'approval'
                ? 'The approval link for the current layout. Review the email, adjust anything, then send — nothing goes out without this preview.'
                : <>{followup.status === 'viewed'
                    ? `The family opened the layout ${followup.days} days ago and hasn't answered.`
                    : `Sent ${followup.days} days ago, never opened.`}
                  {' '}Review the email, adjust anything, then send. The approval record is stamped on send.</>}
            </div>
            <label className="sb-dh2-fu-field">
              <span>To</span>
              <input className="sb-dh2-inp" type="email" value={followup.to}
                onChange={e => setFollowup(f => ({ ...f, to: e.target.value }))} />
            </label>
            <label className="sb-dh2-fu-field">
              <span>Subject</span>
              <input className="sb-dh2-inp" value={followup.subject}
                onChange={e => setFollowup(f => ({ ...f, subject: e.target.value }))} />
            </label>
            <label className="sb-dh2-fu-field">
              <span>Message</span>
              <textarea className="sb-dh2-inp sb-dh2-fu-body" rows={10} value={followup.body}
                onChange={e => setFollowup(f => ({ ...f, body: e.target.value }))} />
            </label>
            <div className="sb-dh2-fu-note">Your email signature is added automatically.</div>
            {followup.error && <div className="sb-dh2-modal-err">{followup.error}</div>}
            <div className="sb-dh2-fu-actions">
              <button type="button" className="sb-dh2-modal-cancel" onClick={() => setFollowup(null)} disabled={followup.busy}>Cancel</button>
              <button type="button" className="sb-dh2-savebtn" onClick={sendFollowup} disabled={followup.busy || !followup.to.trim()}>
                {followup.busy ? 'Sending…' : followup.kind === 'approval' ? 'Send approval email' : 'Send follow-up'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Order-scoped layout uploader (estimate leads) — reuses the proof plumbing */}
      {uploadFor && (
        <div className="sb-dh2-modal-overlay" onClick={closeUploader}>
          <div className="sb-dh2-modal" onClick={e => e.stopPropagation()}>
            <div className="sb-dh2-modal-title">{uploadFor.job ? 'Layout' : 'Estimate layout'} · {familyOf(uploadFor.order)}</div>
            <div className="sb-dh2-modal-sub">{uploadFor.job
              ? 'Uploads as the next proof version on this job — same as dropping it on the design packet.'
              : 'Attach a layout to this order. It carries onto the job when the contract is signed.'}</div>
            {Array.isArray(orderProof) && orderProof.filter(v => v.layout_image_url).map(v => {
              const fam = String(familyOf(uploadFor.order) || 'layout').replace(/[^\w-]+/g, '_')
              const dl = `${v.layout_image_url}${v.layout_image_url.includes('?') ? '&' : '?'}download=${encodeURIComponent(`${fam}-layout-v${v.version_number}.jpg`)}`
              return (
                <div key={v.id} className="sb-dh2-modal-thumbwrap">
                  <img src={v.layout_image_url} alt={`Layout v${v.version_number}`} className="sb-dh2-modal-thumb" />
                  <div className="sb-dh2-modal-verrow">
                    <span className="sb-dh2-modal-cur">v{v.version_number}{v.is_current ? ' — current' : ''}</span>
                    <a className="sb-dh2-verlink" href={v.layout_image_url} target="_blank" rel="noreferrer">View full size</a>
                    <a className="sb-dh2-verlink" href={dl}>Download image</a>
                    <button type="button" className="sb-dh2-verlink sb-dh2-verlink-btn" disabled={sheetBusyId === v.id}
                      title="The layout on a one-page estimate — line items with per-item prices hidden, final price shown"
                      onClick={() => downloadEstimateSheet(v)}>
                      {sheetBusyId === v.id ? 'Building…' : 'Estimate sheet'}
                    </button>
                  </div>
                </div>
              )
            })}
            {uploadFor && !uploadFor.job && Array.isArray(orderProof) && orderProof.length > 0 && (
              <div className="sb-dh2-modal-sub" style={{ marginTop: -6 }}>
                This is a pre-contract estimate layout — it carries onto the job automatically at signing.
              </div>
            )}
            {uploadErr && <div className="sb-dh2-modal-err">{uploadErr}</div>}
            <label className="sb-dh2-modal-uplabel">
              <input type="file" accept="image/jpeg,image/png" onChange={onPickLayout} disabled={uploadBusy} style={{ display: 'none' }} />
              <span className="sb-dh2-createbtn">{uploadBusy ? 'Uploading…' : ((Array.isArray(orderProof) && orderProof.length) ? 'Upload a new version' : 'Upload layout (JPG / PNG)')}</span>
            </label>
            <button type="button" className="sb-dh2-modal-cancel" onClick={closeUploader} disabled={uploadBusy}>Close</button>
          </div>
        </div>
      )}
    </div>
  )
}

const CSS = `
  .sb-dh2 { width: 100%; max-width: 1100px; margin: 0 auto; padding: 22px 32px 64px; }
  .sb-dh2-tabs { display: inline-flex; gap: 4px; background: #ece6d8; border-radius: 11px; padding: 4px; margin-bottom: 20px; }
  .sb-dh2-tab { border: none; cursor: pointer; border-radius: 8px; padding: 8px 20px; font: inherit; font-size: 14px; font-weight: 700; background: transparent; color: #7a756a; }
  .sb-dh2-tab.on { background: #fff; color: #0f1419; box-shadow: 0 1px 3px rgba(0,0,0,0.12); }
  .sb-dh2-tab:hover:not(.on) { color: #4a463f; }

  .sb-dh2-tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 14px; margin-bottom: 20px; }
  .sb-dh2-tile { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; text-align: left; cursor: pointer; font: inherit;
    background: #fff; border: 0.5px solid rgba(0,0,0,0.08); border-left: 4px solid #cfcabb; border-radius: 12px; padding: 16px 18px; transition: box-shadow .12s, transform .12s; }
  .sb-dh2-tile:hover { transform: translateY(-1px); box-shadow: 0 4px 14px rgba(15,20,25,.08); }
  .sb-dh2-tile.on { box-shadow: 0 0 0 2px #9A7209 inset; }
  .sb-dh2-tile-red { border-left-color: #b54040; }
  .sb-dh2-tile-amber { border-left-color: #b8842a; background: #fdfaf2; }
  .sb-dh2-tile-neutral { border-left-color: #9aa0a6; }
  .sb-dh2-tile-green { border-left-color: #1d7a55; }

  .sb-dh2-typechips { display: flex; gap: 6px; flex-wrap: wrap; margin: -8px 0 16px; }
  .sb-dh2-typechip { font: inherit; font-size: 12.5px; font-weight: 600; border: 1px solid #ddd6c6; background: #fff; border-radius: 999px; padding: 5px 14px; cursor: pointer; color: #6b6256; }
  .sb-dh2-typechip.on { background: #9A7209; border-color: #9A7209; color: #fff; }
  .sb-dh2-tile-num { font-size: 32px; font-weight: 700; color: #1e2d3d; line-height: 1; font-variant-numeric: tabular-nums; }
  .sb-dh2-tile-lab { font-size: 13px; font-weight: 600; color: #6a6a62; }

  .sb-dh2-tasks { background: #fff; border: 0.5px solid rgba(0,0,0,0.08); border-radius: 12px; padding: 12px 14px; margin-bottom: 18px; }
  .sb-dh2-tasks-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
  .sb-dh2-tasks-title { font-size: 11px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; color: #8a8472; }
  .sb-dh2-addbtn, .sb-dh2-savebtn { font: inherit; font-size: 12.5px; font-weight: 600; border-radius: 7px; cursor: pointer; padding: 6px 12px; border: 0.5px solid #9A7209; background: #fff; color: #9A7209; }
  .sb-dh2-savebtn { background: #9A7209; color: #fff; }
  .sb-dh2-savebtn:disabled { opacity: .5; cursor: default; }
  .sb-dh2-addrow { display: flex; gap: 8px; margin-bottom: 10px; flex-wrap: wrap; }
  .sb-dh2-inp, .sb-dh2-sel, .sb-dh2-search { font: inherit; font-size: 13.5px; padding: 8px 10px; border: 0.5px solid #d8d2c4; border-radius: 7px; background: #fff; color: #2a2a2a; }
  .sb-dh2-inp { flex: 1; min-width: 180px; }
  .sb-dh2-tasks-empty { font-size: 13px; color: #8a8a85; padding: 6px 2px; }
  .sb-dh2-taskmore { font-size: 12px; color: #8a8a85; padding: 8px 4px 2px; font-style: italic; }
  .sb-dh2-tasklist { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
  .sb-dh2-taskitem { display: flex; align-items: center; gap: 10px; padding: 8px 4px; border-top: 0.5px solid #f1efeb; cursor: pointer; font-size: 13.5px; color: #2a2a2a; }
  .sb-dh2-taskitem:first-child { border-top: none; }
  .sb-dh2-taskitem-manual { cursor: default; }
  .sb-dh2-tasktext { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .sb-dh2-taskfam { color: #8a8a85; }
  .sb-dh2-taskcheck { width: 15px; height: 15px; accent-color: #9A7209; cursor: pointer; }
  .sb-dh2-taskdot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
  .sb-dh2-dot-red { background: #b54040; } .sb-dh2-dot-amber { background: #b8842a; } .sb-dh2-dot-neutral { background: #9aa0a6; }
  .sb-dh2-taskkind { font-size: 10.5px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; padding: 2px 7px; border-radius: 999px; flex-shrink: 0; }
  .sb-dh2-kind-red { color: #b54040; background: rgba(181,64,64,.1); }
  .sb-dh2-kind-amber { color: #8b6418; background: rgba(184,132,42,.14); }
  .sb-dh2-kind-neutral { color: #6a6a62; background: rgba(0,0,0,.05); }

  .sb-dh2-toolbar { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
  .sb-dh2-search { flex: 1; }
  .sb-dh2-sortwrap { display: flex; align-items: center; gap: 6px; }
  .sb-dh2-sortlab { font-size: 11px; text-transform: uppercase; letter-spacing: .08em; color: #8a8a85; font-weight: 600; }
  .sb-dh2-estcount { font-size: 13px; color: #8a8a85; }

  .sb-dh2-rows { display: flex; flex-direction: column; background: #fff; border: 0.5px solid rgba(0,0,0,0.08); border-radius: 12px; overflow: hidden; }
  .sb-dh2-row { display: flex; align-items: center; gap: 12px; padding: 12px 16px; border-top: 0.5px solid #f1efeb; border-left: 3px solid transparent; cursor: pointer; }
  .sb-dh2-row:first-child { border-top: none; }
  .sb-dh2-row:hover { background: #faf8f4; }
  .sb-dh2-row-urgent { border-left-color: #b54040; }
  .sb-dh2-row-soon { border-left-color: #b8842a; }
  .sb-dh2-fam { font-size: 15px; font-weight: 600; color: #1e2d3d; }
  .sb-dh2-row-spacer { flex: 1; }
  .sb-dh2-age { font-size: 12.5px; font-weight: 600; padding: 2px 9px; border-radius: 999px; color: #6a6a62; background: rgba(0,0,0,.05); font-variant-numeric: tabular-nums; }
  .sb-dh2-age-urgent { color: #fff; background: #b54040; }
  .sb-dh2-age-soon { color: #8b6418; background: rgba(184,132,42,.16); }
  .sb-dh2-pill { font-size: 11.5px; font-weight: 700; padding: 3px 10px; border-radius: 999px; }
  .sb-dh2-pill-amber { color: #8b6418; background: rgba(184,132,42,.16); }
  .sb-dh2-pulse { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; background: #fff; border: 1px solid #ece6d8; border-radius: 12px; padding: 10px 14px; margin-bottom: 12px; }
  .sb-dh2-pulse-lab { font-size: 10.5px; font-weight: 800; letter-spacing: .12em; text-transform: uppercase; color: #9a9486; margin-right: 2px; }
  .sb-dh2-pulse-stat { font: inherit; font-size: 12.5px; font-weight: 600; border-radius: 999px; padding: 5px 12px; border: 1px solid transparent; cursor: pointer; }
  .sb-dh2-pulse-stat b { font-size: 14px; font-weight: 800; margin-right: 3px; }
  .sb-dh2-pulse-stat:hover { border-color: currentColor; }
  .sb-dh2-pulse-stat.on { border-color: currentColor; box-shadow: 0 0 0 2px rgba(154,114,9,0.15); font-weight: 800; }
  .sb-dh2-pulse-clear { font: inherit; font-size: 12px; font-weight: 600; color: #8a8472; background: none; border: none; cursor: pointer; text-decoration: underline; }
  .sb-dh2-stale { background: #fbeaea; border: 1px solid #e7b3ad; border-left: 4px solid #b3261e; border-radius: 12px; padding: 11px 14px; margin-bottom: 12px; display: flex; flex-direction: column; gap: 8px; }
  .sb-dh2-stale-head { font-size: 11.5px; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; color: #b3261e; }
  .sb-dh2-stale-row { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
  .sb-dh2-stale-fam { font-weight: 700; min-width: 110px; }
  .sb-dh2-stale-what { flex: 1; font-size: 13px; color: #7a2a25; }
  .sb-dh2-linkbadge { font-size: 10.5px; font-weight: 800; letter-spacing: .04em; text-transform: uppercase; border-radius: 999px; padding: 3px 9px; white-space: nowrap; }
  .sb-dh2-link-pending { color: #1d6fa8; background: rgba(29,111,168,.12); }
  .sb-dh2-link-viewed { color: #5b3e96; background: rgba(91,62,150,.12); }
  .sb-dh2-link-signed { color: #1d7a55; background: rgba(29,122,85,.14); }
  .sb-dh2-link-changes_requested { color: #b3261e; background: rgba(179,38,30,.12); }
  .sb-dh2-link-expired, .sb-dh2-link-revoked { color: #8a8a85; background: rgba(0,0,0,.06); }
  .sb-dh2-changenote { flex-basis: 100%; font-size: 12.5px; color: #7a2a25; background: rgba(179,38,30,.07); border-radius: 6px; padding: 5px 10px; margin-top: 4px; }
  .sb-dh2-rowtask { flex-basis: 100%; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-top: 8px; padding: 8px 10px; background: #F6F3EC; border: 1px solid #E2DCC8; border-radius: 8px; }
  .sb-dh2-rowtask select, .sb-dh2-rowtask input { font: inherit; font-size: 12.5px; padding: 6px 8px; border: 1px solid #D9D2C0; border-radius: 7px; background: #fff; }
  .sb-dh2-typetag { font: 800 9px/1 inherit; font-family: inherit; letter-spacing: 0.05em; border-radius: 5px; padding: 3px 7px; white-space: nowrap; }
  .sb-dh2-typetag-stone { color: #3C5A80; background: #E8F0FA; }
  .sb-dh2-typetag-bronze { color: #8A5A12; background: #FBF3DF; }
  .sb-dh2-typetag-insc { color: #534AB7; background: #EFEBFA; }
  .sb-dh2-jobbtn { font: inherit; font-size: 12px; font-weight: 600; border-radius: 7px; cursor: pointer; padding: 6px 10px; border: 0.5px solid #c9c2b0; background: #fff; color: #6b6256; }
  .sb-dh2-jobbtn:hover { border-color: #9A7209; color: #9A7209; }
  .sb-dh2-pill-green { color: #38704f; background: rgba(56,122,79,.12); }

  .sb-dh2-modal-overlay { position: fixed; inset: 0; z-index: 1300; background: rgba(15,20,25,.5); display: flex; align-items: center; justify-content: center; padding: 24px; }
  .sb-dh2-modal { background: #fff; border-radius: 14px; width: min(440px, 94vw); padding: 22px; box-shadow: 0 24px 60px rgba(0,0,0,.3); }
  .sb-dh2-modal-title { font-size: 16px; font-weight: 700; color: #1e2d3d; }
  .sb-dh2-modal-sub { font-size: 12.5px; color: #8a8a85; margin: 4px 0 14px; line-height: 1.45; }
  .sb-dh2-modal-thumbwrap { margin-bottom: 14px; }
  .sb-dh2-modal-thumb { width: 100%; max-height: 240px; object-fit: contain; border: 0.5px solid #e4e0d4; border-radius: 8px; background: #faf8f4; }
  .sb-dh2-modal-cur { font-size: 11.5px; color: #8a8a85; }
  .sb-dh2-modal-wide { max-width: 560px; }
  .sb-dh2-fu-field { display: flex; flex-direction: column; gap: 4px; margin-bottom: 10px; }
  .sb-dh2-fu-field > span { font-size: 11px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: #8a8472; }
  .sb-dh2-fu-body { resize: vertical; line-height: 1.5; font-size: 13.5px; }
  .sb-dh2-fu-note { font-size: 12px; color: #8a8a85; margin: 2px 0 10px; }
  .sb-dh2-fu-actions { display: flex; justify-content: flex-end; gap: 10px; }
  .sb-dh2-stale-tasked { font-size: 12.5px; font-weight: 700; color: #1D9E75; padding: 6px 4px; white-space: nowrap; }
  .sb-dh2-modal-verrow { display: flex; align-items: center; gap: 14px; margin-top: 5px; }
  .sb-dh2-verlink { font-size: 12.5px; font-weight: 700; color: #9A7209; text-decoration: none; }
  .sb-dh2-verlink:hover { text-decoration: underline; }
  .sb-dh2-verlink-btn { background: none; border: none; font: inherit; font-size: 12.5px; font-weight: 700; color: #9A7209; cursor: pointer; padding: 0; }
  .sb-dh2-verlink-btn:disabled { opacity: 0.6; cursor: default; }
  .sb-dh2-modal-err { font-size: 12.5px; color: #b3261e; background: rgba(179,38,30,.06); border: 0.5px solid rgba(179,38,30,.3); border-radius: 8px; padding: 8px 11px; margin-bottom: 12px; }
  .sb-dh2-modal-uplabel { display: block; cursor: pointer; margin-bottom: 10px; }
  .sb-dh2-modal-uplabel .sb-dh2-createbtn { display: block; text-align: center; padding: 10px; }
  .sb-dh2-modal-cancel { width: 100%; font: inherit; font-size: 13px; font-weight: 600; padding: 9px; border-radius: 8px; border: 0.5px solid #d8d2c4; background: #fff; color: #6a6a62; cursor: pointer; }
  .sb-dh2-modal-cancel:disabled { opacity: .5; }
  .sb-dh2-statusbox { font: inherit; font-size: 13px; padding: 6px 10px; border: 1.5px solid #d8d2c4; border-radius: 8px; background: #fff; color: #2a2a2a; cursor: pointer; min-width: 150px; font-weight: 700; }
  .sb-dh2-statusbox:disabled { opacity: .5; }
  .sb-dh2-st-due { border-color: #b54040; color: #b3261e; background: #fdf2f1; }
  .sb-dh2-st-revision { border-color: #b8842a; color: #8b6418; background: #fdf7ec; }
  .sb-dh2-st-need_approval { border-color: #1d6fa8; color: #1d6fa8; background: #f0f6fb; }
  .sb-dh2-st-approved { border-color: #1d7a55; color: #1d7a55; background: #f0f8f4; }

  .sb-dh2-libgrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 12px; }
  .sb-dh2-libcard { font: inherit; cursor: pointer; text-align: left; background: #fff; border: 0.5px solid rgba(0,0,0,0.08); border-radius: 12px; padding: 8px; display: flex; flex-direction: column; gap: 4px; transition: box-shadow .12s; }
  .sb-dh2-libcard:hover { box-shadow: 0 4px 14px rgba(15,20,25,.1); }
  .sb-dh2-libcard img { width: 100%; height: 150px; object-fit: contain; background: #faf8f4; border-radius: 8px; }
  .sb-dh2-libname { font-size: 13.5px; font-weight: 700; color: #1e2d3d; }
  .sb-dh2-libmeta { font-size: 11.5px; color: #8a8a85; font-variant-numeric: tabular-nums; }
  .sb-dh2-est-meta { font-size: 12.5px; color: #8a8a85; font-variant-numeric: tabular-nums; }
  .sb-dh2-createbtn { font: inherit; font-size: 12.5px; font-weight: 600; border-radius: 7px; cursor: pointer; padding: 6px 12px; border: 0.5px solid #9A7209; background: #9A7209; color: #fff; }
  .sb-dh2-empty { padding: 40px 16px; text-align: center; color: #8a8a85; font-size: 14px; background: #fff; border: 0.5px solid rgba(0,0,0,0.08); border-radius: 12px; font-style: italic; }
  .sb-dh2-fallback-note { font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; color: #8a8472; margin: 14px 2px 8px; }

  @media (max-width: 720px) {
    .sb-dh2 { padding: 16px 16px 48px; }
    .sb-dh2-tiles { grid-template-columns: 1fr; }
  }
`
