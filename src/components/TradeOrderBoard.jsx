// =============================================================================
// Stonebooks Trade — the order board (SHARED: dealer portal + staff Vendors tab)
// =============================================================================
// Paul's whiteboard, live: F/N · services · design phase · stone status ·
// started · deadline, with Active / Complete / Archived tabs, search, and sort.
// ONE component serves both sides so the two boards can never disagree:
//   staffView  — inline design-phase / stone-status selects, rush approve /
//                decline, company column (all partners visible).
//   dealer     — read-only status pills + "Stone dropped off" quick action;
//                archive their own orders. RLS scopes their queries server-side.
// Row click expands: item specs, notes, and the SHARED activity log (who did
// what, when — both sides read the same timeline).
// =============================================================================

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import {
  listTradeOrders, updateTradeOrder, logTradeEvent, listTradeOrderEvents,
  decideTradeRush, acceptTradeOrder, deleteTradeOrder, getTradeTracker,
  getTradeLayouts, uploadTradeSignature, approveTradeLayout, signTradeReceipt,
  uploadVendorFile, listVendorAttachments, vendorFileSignedUrl, notifyTradeDealer, sendTradeDealerEmail,
  TRADE_SERVICES, TRADE_DESIGN_PHASES, TRADE_STONE_STATUSES, tradeServiceLabel,
} from '../lib/vendorsData'
import {
  getCurrentStaffName, uploadProofLayout, createProofVersion,
  setComponentOnFloor, getComponentsForJobs, seedComponentsForTradeJob, setJobOverallStatus,
  properName,
} from '../lib/stonebooksData'
import { trackPhases, phaseLabel as compPhaseLabel } from '../lib/jobComponents'

const TABS = [
  { code: 'active',   label: 'Active' },
  { code: 'complete', label: 'Complete' },
  { code: 'archived', label: 'Archived' },
]
const SORTS = [
  { code: 'deadline', label: 'Deadline soonest' },
  { code: 'newest',   label: 'Newest first' },
  { code: 'family',   label: 'Family A→Z' },
]

const pad2 = (n) => String(n).padStart(2, '0')
const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}` }
const dOnly = (v) => (v ? String(v).slice(0, 10) : null)
const fmtD = (v) => { const s = dOnly(v); if (!s) return '—'; const [y, m, d] = s.split('-'); return `${Number(m)}/${Number(d)}/${y.slice(2)}` }
const fmtDT = (v) => (v ? fmtD(v) : '—')
const daysUntil = (iso, today) => {
  if (!iso || !today) return null
  const a = Date.parse(today + 'T00:00:00'), b = Date.parse(dOnly(iso) + 'T00:00:00')
  if (Number.isNaN(a) || Number.isNaN(b)) return null
  return Math.round((b - a) / 86400000)
}

const familyOf = (r) => r.family_name || r.items?.find(i => i.deceased_family_name)?.deceased_family_name || r.request_name || '—'
const orderNumOf = (r) => r.dealer_order_number || r.items?.find(i => i.vendor_reference)?.vendor_reference || null
const servicesOf = (r) => {
  if (r.services?.length) {
    return r.services.map(s => s === 'custom' && r.service_custom ? r.service_custom : tradeServiceLabel(s)).join(' + ')
  }
  const kinds = [...new Set((r.items || []).map(i => i.work_type).filter(Boolean))]
  return kinds.map(tradeServiceLabel).join(' + ') || '—'
}
const deadlineOf = (r) => (r.rush_status === 'approved' && r.rush_need_by) ? r.rush_need_by : (r.needed_by || r.rush_need_by || null)
// Design-only orders: the job IS the design + approval — stone status and
// production don't apply, and approval completes the order (Paul, 2026-07-08).
const isDesignOnly = (r) => (r.services || []).length > 0 && (r.services || []).every(s => s === 'design')

const humanizeEvent = (t) => String(t || '').replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase())

export default function TradeOrderBoard({ staffView = false, partnerId = null, actorName = null, onNewOrder = null, initialExpandId = null }) {
  const [todayISO, setTodayISO] = useState('')
  useEffect(() => { setTodayISO(todayStr()) }, [])

  const [orders, setOrders] = useState(null)
  const [tab, setTab] = useState('active')
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState('deadline')
  const [expandedId, setExpandedId] = useState(null)
  const [eventsById, setEventsById] = useState({})
  const [busyId, setBusyId] = useState(null)
  const [editOrder, setEditOrder] = useState(null)   // order being edited | null
  const [deleteArmId, setDeleteArmId] = useState(null) // two-step delete (archive, staff)
  const [nonce, setNonce] = useState(0)
  const reload = useCallback(() => setNonce(n => n + 1), [])

  useEffect(() => {
    let alive = true
    listTradeOrders({ partnerId, scope: 'all' }).then(rows => { if (alive) setOrders(rows) })
    return () => { alive = false }
  }, [partnerId, nonce])

  // Production column (staff) — reads the SAME job_components rows the
  // Production floor board moves, so the two surfaces can never disagree.
  const [compsByJob, setCompsByJob] = useState({})
  useEffect(() => {
    if (!staffView || !orders) return
    const ids = orders.map(r => r.job_id).filter(Boolean)
    if (!ids.length) { setCompsByJob({}); return }
    let alive = true
    getComponentsForJobs(ids).then(rows => {
      if (!alive) return
      const m = {}
      for (const c of rows) if (!m[c.job_id]) m[c.job_id] = c   // primary piece (die/door)
      setCompsByJob(m)
    })
    return () => { alive = false }
  }, [staffView, orders])

  const actor = useCallback(async () => {
    if (!staffView) return actorName || 'Dealer'
    return (await getCurrentStaffName().catch(() => null)) || 'Staff'
  }, [staffView, actorName])

  // Partition once for tab counts; the visible list applies search + sort.
  const partitioned = useMemo(() => {
    const rows = orders || []
    const isComplete = (r) => ['completed', 'cancelled'].includes(r.status)
    return {
      active: rows.filter(r => !r.archived_at && !isComplete(r)),
      complete: rows.filter(r => !r.archived_at && isComplete(r)),
      archived: rows.filter(r => r.archived_at),
    }
  }, [orders])

  const visible = useMemo(() => {
    let list = partitioned[tab] || []
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      list = list.filter(r => [familyOf(r), orderNumOf(r), r.partner?.company_name, servicesOf(r)]
        .filter(Boolean).join(' ').toLowerCase().includes(q))
    }
    const cmp = sortKey === 'newest'
      ? (a, b) => (b.created_at || '').localeCompare(a.created_at || '')
      : sortKey === 'family'
        ? (a, b) => familyOf(a).localeCompare(familyOf(b))
        : (a, b) => (dOnly(deadlineOf(a)) || '9999-12-31').localeCompare(dOnly(deadlineOf(b)) || '9999-12-31')
    return [...list].sort(cmp)
  }, [partitioned, tab, search, sortKey])

  // ── Actions (every one logs the shared activity event) ─────────────────────
  const withBusy = async (id, fn) => { setBusyId(id); try { await fn() } finally { setBusyId(null); reload() } }

  // Dealer emails PREVIEW before sending (Paul, 2026-07-14 — no more silent
  // auto-sends). Prepares the draft and opens the composer; staff edit, then
  // Send (or close to skip). Muted kinds (dealer Settings) never open.
  const [emailDraft, setEmailDraft] = useState(null)  // { to, subject, body, cta, link, busy, error } | null
  const openDealerEmail = async (requestId, kind) => {
    const d = await notifyTradeDealer(requestId, kind, { draft: true })
    if (!d?.ok || !d.draft || d.muted) return
    setEmailDraft({ ...d.draft, busy: false, error: null })
  }
  const sendDealerEmail = async () => {
    if (!emailDraft || emailDraft.busy) return
    setEmailDraft(m => ({ ...m, busy: true, error: null }))
    const r = await sendTradeDealerEmail(emailDraft)
    if (!r.ok) { setEmailDraft(m => ({ ...m, busy: false, error: r.error || 'Send failed.' })); return }
    setEmailDraft(null)
  }

  const setPhase = (r, code) => withBusy(r.id, async () => {
    const who = await actor()
    const label = TRADE_DESIGN_PHASES.find(p => p.code === code)?.label || code
    await updateTradeOrder(r.id, {
      designPhase: code,
      designApprovedAt: code === 'approved' ? new Date().toISOString() : null,
    })
    await logTradeEvent({ requestId: r.id, partnerId: r.partner_id, type: 'design_phase', detail: `Design phase → ${label}`, actor: who, actorRole: staffView ? 'staff' : 'partner' })
    // Design-only: approval IS completion — the whole job was the design.
    if (code === 'approved' && isDesignOnly(r)) {
      await updateTradeOrder(r.id, { status: 'completed' })
      if (r.job_id) await setJobOverallStatus(r.job_id, 'completed', 'Design-only trade order — design approved = complete')
      await logTradeEvent({ requestId: r.id, partnerId: r.partner_id, type: 'completed', detail: 'Design approved — design-only order completed', actor: who, actorRole: 'staff' })
    }
    // Layout going out for review pulls the dealer in by email (deep link) —
    // PREVIEWED in the composer first, never auto-sent.
    if (staffView && code === 'sent_draft') openDealerEmail(r.id, 'layout_ready').catch(() => {})
  })

  // Production column write — moves the SAME piece the Production floor tracks
  // (overrideComponentPhase rolls up to the job milestones, which drive the
  // dealer's live tracker too).
  const setProd = (r, comp, phase) => withBusy(r.id, async () => {
    const who = await actor()
    // setComponentOnFloor(true, phase) = move the phase AND make sure the piece
    // is ON the Production floor board — a phase set from here must be visible
    // there (the audit mismatch: phase moved but the piece sat in the queue).
    const res = await setComponentOnFloor(comp.id, true, { actor: who, phase, source: 'trade_board' })
    if (res && res.ok === false) { console.warn('[trade] production:', res.error); return }
    await logTradeEvent({ requestId: r.id, partnerId: r.partner_id, type: 'production_status', detail: `Production → ${compPhaseLabel(phase)}`, actor: who, actorRole: 'staff' })
  })
  const setupProd = (r) => withBusy(r.id, async () => {
    const res = await seedComponentsForTradeJob(r)
    if (!res.ok) console.warn('[trade] seed component:', res.error)
  })

  const setStone = (r, code) => withBusy(r.id, async () => {
    const who = await actor()
    await updateTradeOrder(r.id, {
      stoneStatus: code,
      stoneArrivedAt: code === 'arrived' ? new Date().toISOString() : null,
      ...(code === 'arrived' && !r.stone_drop_location ? { stoneDropLocation: 'Shevchenko shop' } : {}),
    })
    await logTradeEvent({
      requestId: r.id, partnerId: r.partner_id,
      type: code === 'arrived' ? 'stone_dropped_off' : 'stone_status',
      detail: code === 'arrived' ? 'Stone dropped off / arrived at the shop' : 'Stone marked not here',
      actor: who, actorRole: staffView ? 'staff' : 'partner',
    })
  })

  const setArchived = (r, on) => withBusy(r.id, async () => {
    const who = await actor()
    await updateTradeOrder(r.id, { archivedAt: on ? new Date().toISOString() : null, archivedBy: on ? who : null })
    await logTradeEvent({ requestId: r.id, partnerId: r.partner_id, type: on ? 'archived' : 'unarchived', detail: on ? 'Order archived' : 'Order restored', actor: who, actorRole: staffView ? 'staff' : 'partner' })
  })

  const rushDecide = (r, approve) => withBusy(r.id, async () => {
    const who = await actor()
    await decideTradeRush(r.id, approve, { actor: who })
  })

  // Accept checkpoint (staff) — specs verified, guarantee attaches. Slice 4
  // hooks job creation here.
  const accept = (r) => withBusy(r.id, async () => {
    const who = await actor()
    await acceptTradeOrder(r.id, { actor: who })
  })

  // ── Slice 5: signatures (layout approval / drop-off / pickup) ──────────────
  const onSigDone = async ({ dataUrl, where }) => {
    const m = sigModal
    if (!m) return
    setSigModal(null)
    await withBusy(m.order.id, async () => {
      const who = await actor()
      const role = staffView ? 'staff' : 'partner'
      let sigPath = null
      if (dataUrl) {
        const up = await uploadTradeSignature(m.order.partner_id, m.order.id, dataUrl)
        if (up.ok) sigPath = up.path
      }
      // Surface failures — an approve that silently no-ops looks like a dead
      // button (the constraint bug Paul hit: RPC threw, screen never changed).
      const res = m.mode === 'approve'
        ? await approveTradeLayout(m.order.id, m.proofId, { partnerId: m.order.partner_id, sigPath, approver: who, actorRole: role })
        : await signTradeReceipt(m.order, m.mode, { where, signerRole: role, signerName: who, sigPath })
      if (res && res.ok === false) window.alert(`That didn't save: ${res.error || 'unknown error'}. Try again or contact Shevchenko.`)
      refreshDetail(m.order.id)
    })
  }

  const requestChanges = (r) => withBusy(r.id, async () => {
    const who = await actor()
    const note = (changesFor?.note || '').trim()
    // Attachments ride along (Paul, 2026-07-08) — the dealer can drop a marked-up
    // photo or reference file right in the change request; it lands in the
    // order's Files list where staff see it.
    const files = changesFor?.files || []
    for (const f of files) {
      await uploadVendorFile(f, { partnerId: r.partner_id, requestId: r.id, uploaderRole: staffView ? 'staff' : 'partner', kind: 'upload' })
    }
    await updateTradeOrder(r.id, { designPhase: 'changes_requested' })
    await logTradeEvent({
      requestId: r.id, partnerId: r.partner_id, type: 'changes_requested',
      detail: `Changes requested${note ? `: "${note}"` : ''}${files.length ? ` · ${files.length} attachment${files.length === 1 ? '' : 's'}` : ''}`,
      actor: who, actorRole: staffView ? 'staff' : 'partner',
    })
    setChangesFor(null)
    refreshDetail(r.id)
  })

  const onPickPhoto = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    const r = photoForRef.current
    if (!file || !r) return
    await withBusy(r.id, async () => {
      await uploadVendorFile(file, { partnerId: r.partner_id, requestId: r.id, uploaderRole: staffView ? 'staff' : 'partner', kind: 'completion_photo' })
      if (staffView) openDealerEmail(r.id, 'photo').catch(() => {})
      refreshDetail(r.id)
    })
  }

  // Staff layout upload — right here on the board (no Design-hub detour).
  // Creates the next proof version (V1..Vn stack), flips the phase to Sent
  // draft, and emails the dealer their approve/deny link.
  const layoutInputRef = useRef(null)
  const layoutForRef = useRef(null)
  const onPickLayout = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    const r = layoutForRef.current
    if (!file || !r) return
    await withBusy(r.id, async () => {
      const who = await actor()
      const up = r.job_id
        ? await uploadProofLayout(r.job_id, file)
        : await uploadProofLayout(r.id, file, { scope: 'order' })
      if (!up.ok) { console.warn('[trade] layout upload:', up.error); return }
      const { error } = await createProofVersion(r.job_id
        ? { jobId: r.job_id, layoutImageUrl: up.url, uploadedBy: who }
        : { orderId: r.id, layoutImageUrl: up.url, uploadedBy: who })
      if (error) { console.warn('[trade] proof version:', error.message); return }
      await updateTradeOrder(r.id, { designPhase: 'sent_draft' })
      await logTradeEvent({ requestId: r.id, partnerId: r.partner_id, type: 'layout_sent', detail: 'Layout uploaded — approval email drafted for review', actor: who, actorRole: 'staff' })
      openDealerEmail(r.id, 'layout_ready').catch(() => {})
      refreshDetail(r.id)
    })
  }

  const [trackerById, setTrackerById] = useState({})
  const [layoutsById, setLayoutsById] = useState({})
  const [photosById, setPhotosById] = useState({})
  const [filesById, setFilesById] = useState({})   // non-photo attachments (order files + change-request uploads)
  const [sigModal, setSigModal] = useState(null)   // { mode: 'approve'|'dropoff'|'pickup', order, proofId? }
  const [changesFor, setChangesFor] = useState(null) // { id, note, files: File[] } — request-changes box
  const [lightbox, setLightbox] = useState(null)   // { url, version } — large layout viewer
  const photoInputRef = useRef(null)
  const photoForRef = useRef(null)
  const changesFileRef = useRef(null)

  const addChangesFiles = (list) => setChangesFor(c => c ? { ...c, files: [...(c.files || []), ...Array.from(list || [])] } : c)

  // Real download (not just open-in-tab) — fetch → blob → anchor click.
  const downloadLayout = async (url, version) => {
    try {
      const res = await fetch(url)
      const blob = await res.blob()
      const objUrl = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = objUrl
      a.download = `layout-V${version}${blob.type.includes('png') ? '.png' : '.jpg'}`
      document.body.appendChild(a); a.click(); a.remove()
      setTimeout(() => URL.revokeObjectURL(objUrl), 4000)
    } catch { window.open(url, '_blank', 'noopener') }
  }

  const refreshDetail = useCallback((id) => {
    listTradeOrderEvents(id).then(ev => setEventsById(m => ({ ...m, [id]: ev })))
    getTradeTracker(id).then(steps => setTrackerById(m => ({ ...m, [id]: steps })))
    getTradeLayouts(id).then(vs => setLayoutsById(m => ({ ...m, [id]: vs })))
    listVendorAttachments({ requestId: id }).then(async (rows) => {
      const photos = (rows || []).filter(a => a.kind === 'completion_photo')
      const withUrls = await Promise.all(photos.map(async p => ({ ...p, url: await vendorFileSignedUrl(p.file_path) })))
      setPhotosById(m => ({ ...m, [id]: withUrls }))
      // Everything else — the dealer's order files + change-request attachments.
      const uploads = (rows || []).filter(a => a.kind !== 'completion_photo')
      const uploadUrls = await Promise.all(uploads.map(async f => ({ ...f, url: await vendorFileSignedUrl(f.file_path) })))
      setFilesById(m => ({ ...m, [id]: uploadUrls }))
    })
  }, [])

  const toggleExpand = (r) => {
    const next = expandedId === r.id ? null : r.id
    setExpandedId(next)
    // Everything refetches on expand — shop milestone flips, new layout
    // versions, and fresh photos show the moment anyone looks.
    if (next) refreshDetail(r.id)
  }

  // Email deep link (?trade=<id>) — auto-expand that order once on first load.
  const deepLinked = useRef(false)
  useEffect(() => {
    if (deepLinked.current || !initialExpandId || !orders) return
    deepLinked.current = true
    const hit = orders.find(o => o.id === initialExpandId)
    if (hit) {
      if (hit.archived_at) setTab('archived')
      else if (['completed', 'cancelled'].includes(hit.status)) setTab('complete')
      setExpandedId(hit.id)
      refreshDetail(hit.id)
    }
  }, [orders, initialExpandId, refreshDetail])

  const phaseMeta = (code) => TRADE_DESIGN_PHASES.find(p => p.code === code) || TRADE_DESIGN_PHASES[0]
  const stoneMeta = (code) => TRADE_STONE_STATUSES.find(s => s.code === code) || TRADE_STONE_STATUSES[0]

  const deadlineCell = (r) => {
    const dl = deadlineOf(r)
    if (!dl) return <span className="sb-tb-dim">—</span>
    const days = daysUntil(dl, todayISO)
    const cls = days == null ? '' : days <= 7 ? ' sb-tb-dl-red' : days <= 14 ? ' sb-tb-dl-amber' : ''
    return <span className={`sb-tb-date${cls}`}>{fmtD(dl)}{days != null && days < 0 ? ' · late' : ''}</span>
  }

  const rushPill = (r) => {
    if (r.rush_status === 'approved') return <span className="sb-tb-pill sb-tb-rush">RUSH</span>
    if (r.rush_status === 'pending') return <span className="sb-tb-pill sb-tb-rushq">RUSH?</span>
    return null
  }

  if (orders === null) return <div className="sb-tb"><style>{TB_CSS}</style><div className="sb-tb-empty">Loading orders…</div></div>

  return (
    <div className="sb-tb">
      <style>{TB_CSS}</style>

      <div className="sb-tb-toolbar">
        <div className="sb-tb-tabs">
          {TABS.map(t => (
            <button key={t.code} type="button" className={`sb-tb-tab${tab === t.code ? ' on' : ''}`} onClick={() => { setTab(t.code); setExpandedId(null); setDeleteArmId(null) }}>
              {t.label} · {partitioned[t.code].length}
            </button>
          ))}
        </div>
        <input className="sb-tb-search" type="search" placeholder="Search family, order #…" value={search} onChange={e => setSearch(e.target.value)} />
        <select className="sb-tb-sel" value={sortKey} onChange={e => setSortKey(e.target.value)}>
          {SORTS.map(s => <option key={s.code} value={s.code}>{s.label}</option>)}
        </select>
        {onNewOrder && <button type="button" className="sb-tb-new" onClick={onNewOrder}>+ New order</button>}
      </div>

      {visible.length === 0 ? (
        <div className="sb-tb-empty">{search ? 'Nothing matches.' : tab === 'active' ? 'No active orders.' : tab === 'complete' ? 'No completed orders yet.' : 'Nothing archived.'}</div>
      ) : (
        <div className="sb-tb-board">
          <div className={`sb-tb-head${staffView ? ' staff' : ''}`}>
            <span>F/N</span>
            {staffView && <span>Company</span>}
            <span>Order #</span>
            <span>Service</span>
            <span>Design phase</span>
            <span>Stone status</span>
            {staffView && <span>Production</span>}
            <span>Started</span>
            <span>Deadline</span>
          </div>
          {visible.map(r => {
            const ph = phaseMeta(r.design_phase)
            const st = stoneMeta(r.stone_status)
            const busy = busyId === r.id
            const open = expandedId === r.id
            return (
              <div key={r.id} className={`sb-tb-rowwrap${open ? ' open' : ''}`}>
                <div className={`sb-tb-row${staffView ? ' staff' : ''}${r.rush_status === 'approved' ? ' sb-tb-row-rush' : ''}`} onClick={() => toggleExpand(r)} role="button" tabIndex={0}
                  onKeyDown={e => { if (e.key === 'Enter') toggleExpand(r) }}>
                  <span className="sb-tb-fam">{properName(familyOf(r))} {rushPill(r)} {r.needs_reaccept && staffView && <span className="sb-tb-pill sb-tb-rushq" title="Edited after accept — needs re-accept">RE-ACCEPT</span>}</span>
                  {staffView && <span className="sb-tb-co">{r.partner?.company_name || '—'}</span>}
                  <span className="sb-tb-num">{orderNumOf(r) || '—'}</span>
                  <span className="sb-tb-svc">{servicesOf(r)}</span>
                  <span onClick={e => e.stopPropagation()}>
                    {staffView ? (
                      <select className={`sb-tb-status sb-tb-t-${ph.tone}`} value={r.design_phase || 'not_created'} disabled={busy} onChange={e => setPhase(r, e.target.value)}>
                        {TRADE_DESIGN_PHASES.map(p => <option key={p.code} value={p.code}>{p.label}</option>)}
                      </select>
                    ) : (
                      <span className={`sb-tb-pill sb-tb-t-${ph.tone}`}>{ph.label}{r.design_phase === 'approved' && r.design_approved_at ? ` ${fmtDT(r.design_approved_at)}` : ''}</span>
                    )}
                  </span>
                  <span onClick={e => e.stopPropagation()}>
                    {isDesignOnly(r) ? (
                      <span className="sb-tb-dim" title="Design-only order — no stone involved">— design only</span>
                    ) : staffView ? (
                      <select className={`sb-tb-status sb-tb-t-${st.tone}`} value={r.stone_status || 'not_here'} disabled={busy} onChange={e => setStone(r, e.target.value)}>
                        {TRADE_STONE_STATUSES.map(s => <option key={s.code} value={s.code}>{s.label}</option>)}
                      </select>
                    ) : r.stone_status === 'arrived' ? (
                      <span className="sb-tb-pill sb-tb-t-green">Arrived {fmtDT(r.stone_arrived_at)}</span>
                    ) : (
                      <button type="button" className="sb-tb-dropbtn" disabled={busy} onClick={() => setSigModal({ mode: 'dropoff', order: r })} title="Sign the drop-off receipt — marks the stone arrived">
                        Stone dropped off?
                      </button>
                    )}
                  </span>
                  {staffView && (
                    <span onClick={e => e.stopPropagation()}>
                      {isDesignOnly(r) ? (
                        <span className="sb-tb-dim" title="Design-only — complete when the design is approved">—</span>
                      ) : !r.job_id ? (
                        <span className="sb-tb-dim" title="Accept the order first — production tracking starts with the job">—</span>
                      ) : compsByJob[r.job_id] ? (
                        <select className="sb-tb-status sb-tb-t-blue" value={compsByJob[r.job_id].current_phase} disabled={busy}
                          title="Two-way with the Jobs Production floor — moving it there shows here and vice versa"
                          onChange={e => setProd(r, compsByJob[r.job_id], e.target.value)}>
                          {trackPhases(compsByJob[r.job_id].track).map(p => <option key={p} value={p}>{compPhaseLabel(p)}</option>)}
                        </select>
                      ) : (
                        <button type="button" className="sb-tb-linkbtn" disabled={busy} onClick={() => setupProd(r)}
                          title="Put this piece on the production floor so its status can be tracked here and in Jobs">
                          + Track production
                        </button>
                      )}
                    </span>
                  )}
                  <span className="sb-tb-date">{fmtD(r.accepted_at || r.created_at)}</span>
                  {deadlineCell(r)}
                </div>

                {open && (
                  <div className="sb-tb-detail">
                    {(trackerById[r.id] || []).length > 0 && (
                      <div className="sb-tb-track">
                        {trackerById[r.id].map((s, i, arr) => {
                          const doneCount = arr.filter(x => x.done).length
                          const state = s.done ? 'done' : (i === doneCount ? 'now' : 'todo')
                          return (
                            <div key={s.key} className={`sb-tb-tstep ${state}`}>
                              <div className="sb-tb-tdot">{s.done ? '✓' : ''}</div>
                              <div className="sb-tb-tlab">{s.key === 'blast' && !s.done && s.started ? 'Blasting…' : s.label}</div>
                              <div className="sb-tb-tdate">{s.done && s.date ? fmtD(s.date) : state === 'now' ? 'next' : '—'}</div>
                            </div>
                          )
                        })}
                      </div>
                    )}
                    {staffView && r.rush_status === 'pending' && (
                      <div className="sb-tb-rushbar">
                        <b>Rush requested — needed by {fmtD(r.rush_need_by)}.</b> Approving guarantees the date.
                        <button type="button" className="sb-tb-approve" disabled={busy} onClick={() => rushDecide(r, true)}>Approve rush</button>
                        <button type="button" className="sb-tb-decline" disabled={busy} onClick={() => rushDecide(r, false)}>Decline</button>
                      </div>
                    )}

                    {/* Layout versions V1..Vn — dealer approves & signs the current
                        one, or requests changes (their words land in the feed).
                        Staff upload the next version right here. */}
                    {((layoutsById[r.id] || []).length > 0 || staffView) && (
                      <div className="sb-tb-layouts">
                        <div className="sb-tb-dl" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <span>Layout versions — every one kept</span>
                          {staffView && (
                            <button type="button" className="sb-tb-linkbtn" disabled={busy}
                              onClick={() => { layoutForRef.current = r; layoutInputRef.current?.click() }}
                              title="Upload the next version (JPG/PNG) — sends it to the dealer for approval">
                              ⤴ Upload layout
                            </button>
                          )}
                        </div>
                        {(layoutsById[r.id] || []).length === 0 && <div className="sb-tb-dim">No layout yet — upload the first version.</div>}
                        {/* Guarded — for staff this section renders BEFORE the
                            layouts fetch resolves (the crash Paul hit: undefined
                            .map → blank screen on expanding a fresh order). */}
                        {(layoutsById[r.id] || []).map(v => (
                          <div key={v.id} className={`sb-tb-layout${v.is_current ? ' cur' : ''}`}>
                            {v.image_url
                              ? <button type="button" className="sb-tb-layimgbtn" title="Click to enlarge" onClick={() => setLightbox({ url: v.image_url, version: v.version })}>
                                  <img src={v.image_url} alt={`Layout V${v.version}`} className="sb-tb-layimg" />
                                </button>
                              : <span className="sb-tb-layimg sb-tb-layimg-none">V{v.version}</span>}
                            <div className="sb-tb-layinfo">
                              <b>V{v.version}{v.is_current ? ' · current' : ''}</b>
                              <span className="sb-tb-dim">
                                {v.approved_at ? `Approved ${fmtD(v.approved_at)}${v.approved_by ? ` — ${v.approved_by}` : ''}`
                                  : v.sent_at ? `Sent for approval ${fmtD(v.sent_at)}`
                                  : `Uploaded ${fmtD(v.uploaded_at)}`}
                              </span>
                              {v.image_url && (
                                <span style={{ display: 'flex', gap: 10 }}>
                                  <button type="button" className="sb-tb-linkbtn" onClick={() => setLightbox({ url: v.image_url, version: v.version })}>🔍 Preview</button>
                                  <button type="button" className="sb-tb-linkbtn" onClick={() => downloadLayout(v.image_url, v.version)}>⬇ Download</button>
                                </span>
                              )}
                            </div>
                            {v.is_current && !v.approved_at && (
                              <span className="sb-tb-layactions">
                                <button type="button" className="sb-tb-acceptbtn" disabled={busy} onClick={() => setSigModal({ mode: 'approve', order: r, proofId: v.id })}>✓ Approve &amp; sign</button>
                                <button type="button" className="sb-tb-linkbtn" disabled={busy} onClick={() => setChangesFor({ id: r.id, note: '', files: [] })}>Request changes</button>
                              </span>
                            )}
                          </div>
                        ))}
                        {changesFor?.id === r.id && (
                          <div className="sb-tb-changes"
                            onDragOver={e => e.preventDefault()}
                            onDrop={e => { e.preventDefault(); addChangesFiles(e.dataTransfer.files) }}>
                            <textarea rows={2} placeholder='What needs to change? e.g. "date should read 1941"' value={changesFor.note}
                              onChange={e => setChangesFor(c => ({ ...c, id: r.id, note: e.target.value }))} />
                            {/* Attachments — mark-ups, reference photos. Drag & drop works too. */}
                            <div className="sb-tb-changes-attach">
                              <button type="button" className="sb-tb-linkbtn" onClick={() => changesFileRef.current?.click()}>📎 Add attachment</button>
                              <span className="sb-tb-dim">drag &amp; drop or tap</span>
                              {(changesFor.files || []).map((f, i) => (
                                <span key={i} className="sb-tb-changes-chip">{f.name}
                                  <button type="button" onClick={() => setChangesFor(c => ({ ...c, files: c.files.filter((_, j) => j !== i) }))}>×</button>
                                </span>
                              ))}
                            </div>
                            <div className="sb-tb-modal-actions">
                              <button type="button" className="sb-tb-linkbtn" onClick={() => setChangesFor(null)}>Cancel</button>
                              <button type="button" className="sb-tb-acceptbtn" disabled={busy || !changesFor.note.trim()} onClick={() => requestChanges(r)}>Send change request</button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                    <div className="sb-tb-detail-cols">
                      <div>
                        <div className="sb-tb-dl">Items</div>
                        {(r.items || []).length === 0 ? <div className="sb-tb-dim">No items.</div> : (r.items || []).map(it => (
                          <div key={it.id} className="sb-tb-item">
                            <b>{properName(it.deceased_family_name) || it.vendor_reference || tradeServiceLabel(it.work_type)}</b>
                            <span className="sb-tb-dim">
                              {[it.stone_size && `Stone ${it.stone_size}`, it.base_size && `Base ${it.base_size}`, it.location && `Location ${it.location}`, it.color, it.cemetery].filter(Boolean).join(' · ') || '—'}
                            </span>
                            {it.item_notes && (
                              <span className="sb-tb-note" style={it.notes_align === 'center'
                                ? { display: 'block', textAlign: 'center', whiteSpace: 'pre-wrap', fontFamily: 'Georgia, serif', fontStyle: 'normal', background: '#faf8f2', border: '0.5px solid #e8e2d2', borderRadius: 8, padding: '8px 10px' }
                                : undefined}>{it.item_notes}</span>
                            )}
                          </div>
                        ))}
                        {r.general_notes && <div className="sb-tb-note" style={{ marginTop: 6 }}>{r.general_notes}</div>}
                        {r.submitted_by && <div className="sb-tb-dim" style={{ marginTop: 6 }}>Submitted by {r.submitted_by}</div>}
                        {(filesById[r.id] || []).length > 0 && (
                          <div style={{ marginTop: 8 }}>
                            <div className="sb-tb-dl">Files</div>
                            {(filesById[r.id] || []).map(f => (
                              <div key={f.id} style={{ fontSize: 12.5 }}>
                                <a href={f.url} target="_blank" rel="noreferrer" style={{ color: '#9A7209' }}>{f.file_name || 'File'}</a>
                                <span className="sb-tb-dim"> · {f.uploader_role === 'partner' ? 'dealer' : 'staff'}</span>
                              </div>
                            ))}
                          </div>
                        )}
                        <div className="sb-tb-detail-actions">
                          {staffView && (!r.accepted_at || r.needs_reaccept) && (
                            <button type="button" className="sb-tb-acceptbtn" disabled={busy} onClick={() => accept(r)}
                              title="Specs verified — the order is locked in and the guarantee attaches">
                              {r.needs_reaccept ? '✓ Re-accept order' : '✓ Accept order'}
                            </button>
                          )}
                          {r.accepted_at && !r.needs_reaccept && <span className="sb-tb-pill sb-tb-t-green" title={`Accepted by ${r.accepted_by || 'staff'}`}>Accepted {fmtDT(r.accepted_at)}</span>}
                          <button type="button" className="sb-tb-linkbtn" disabled={busy} onClick={() => setEditOrder(r)}>✎ Edit order</button>
                          {tab !== 'archived'
                            ? <button type="button" className="sb-tb-linkbtn" disabled={busy} onClick={() => setArchived(r, true)}>Archive order</button>
                            : <button type="button" className="sb-tb-linkbtn" disabled={busy} onClick={() => setArchived(r, false)}>Restore order</button>}
                          {staffView && tab === 'archived' && (
                            deleteArmId === r.id ? (
                              <button type="button" className="sb-tb-deletebtn armed" disabled={busy}
                                onClick={() => withBusy(r.id, async () => { await deleteTradeOrder(r.id); setDeleteArmId(null); setExpandedId(null) })}>
                                Really delete forever? Click again
                              </button>
                            ) : (
                              <button type="button" className="sb-tb-deletebtn" disabled={busy} onClick={() => setDeleteArmId(r.id)}
                                title="Permanently removes the order, its items, and its activity log">
                                Delete permanently
                              </button>
                            )
                          )}
                        </div>

                        {/* Receipts — drop-off / pickup, dual signature */}
                        <div className="sb-tb-receipts">
                          {r.dropoff_receipt ? (
                            <div className="sb-tb-receipt">
                              <b>Drop-off</b> · {fmtD(r.dropoff_receipt.at)} · {r.dropoff_receipt.where}
                              <span className="sb-tb-dim"> · signed: {(r.dropoff_receipt.signatures || []).map(s => s.name).join(' + ') || '—'}</span>
                              {!(r.dropoff_receipt.signatures || []).some(s => s.role === (staffView ? 'staff' : 'partner')) && (
                                <button type="button" className="sb-tb-linkbtn" disabled={busy} onClick={() => setSigModal({ mode: 'dropoff', order: r })}>Countersign</button>
                              )}
                            </div>
                          ) : staffView && (
                            <button type="button" className="sb-tb-linkbtn" disabled={busy} onClick={() => setSigModal({ mode: 'dropoff', order: r })}>Stone drop-off receipt…</button>
                          )}
                          {r.pickup_receipt ? (
                            <div className="sb-tb-receipt">
                              <b>Pickup</b> · {fmtD(r.pickup_receipt.at)}
                              <span className="sb-tb-dim"> · signed: {(r.pickup_receipt.signatures || []).map(s => s.name).join(' + ') || '—'}</span>
                              {!(r.pickup_receipt.signatures || []).some(s => s.role === (staffView ? 'staff' : 'partner')) && (
                                <button type="button" className="sb-tb-linkbtn" disabled={busy} onClick={() => setSigModal({ mode: 'pickup', order: r })}>Countersign</button>
                              )}
                            </div>
                          ) : (r.accepted_at && r.status !== 'completed' && (
                            <button type="button" className="sb-tb-linkbtn" disabled={busy} onClick={() => setSigModal({ mode: 'pickup', order: r })}>Mark picked up (sign)…</button>
                          ))}
                        </div>

                        {/* Completion photos — staff add; dealer sees the work
                            before driving over. */}
                        <div className="sb-tb-dl" style={{ marginTop: 12 }}>Completion photos</div>
                        <div className="sb-tb-photos">
                          {(photosById[r.id] || []).map(p => p.url && (
                            <a key={p.id} href={p.url} target="_blank" rel="noreferrer">
                              <img src={p.url} className="sb-tb-photo" alt={p.file_name || 'Completion photo'} />
                            </a>
                          ))}
                          {(photosById[r.id] || []).length === 0 && <span className="sb-tb-dim">None yet.</span>}
                          {staffView && (
                            <button type="button" className="sb-tb-linkbtn" disabled={busy}
                              onClick={() => { photoForRef.current = r; photoInputRef.current?.click() }}>+ Add photo</button>
                          )}
                        </div>
                      </div>
                      <div>
                        <div className="sb-tb-dl">Activity — who did what, when</div>
                        {!eventsById[r.id] ? <div className="sb-tb-dim">Loading…</div> : eventsById[r.id].length === 0 ? <div className="sb-tb-dim">No activity yet.</div> : (
                          <ul className="sb-tb-log">
                            {eventsById[r.id].map(ev => (
                              <li key={ev.id}>
                                <span className={`sb-tb-logdot ${ev.actor_role === 'partner' ? 'p' : 's'}`} />
                                <span className="sb-tb-logtext">{ev.detail || humanizeEvent(ev.event_type)}</span>
                                <span className="sb-tb-logmeta">{fmtD(ev.created_at)} · {ev.actor || (ev.actor_role === 'partner' ? 'Dealer' : 'Shevchenko')}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {editOrder && (
        <TradeOrderEditModal order={editOrder} staffView={staffView} getActor={actor}
          onClose={() => setEditOrder(null)}
          onSaved={() => { setEditOrder(null); reload() }} />
      )}

      {sigModal && (
        <TradeSignModal mode={sigModal.mode} busy={busyId === sigModal.order.id}
          onCancel={() => setSigModal(null)} onDone={onSigDone} />
      )}

      {/* Dealer email composer — EVERY dealer email previews here before it
          sends (Paul, 2026-07-14). Close = don't send. */}
      {emailDraft && (
        <div className="sb-tb-modal-overlay" onClick={() => { if (!emailDraft.busy) setEmailDraft(null) }}>
          <div className="sb-tb-lightbox" style={{ maxWidth: 560, padding: 18 }} onClick={e => e.stopPropagation()}>
            <div className="sb-tb-lightbox-bar" style={{ marginBottom: 10 }}>
              <b>Email the dealer — review before sending</b>
              <span style={{ flex: 1 }} />
              <button type="button" className="sb-tb-linkbtn" onClick={() => { if (!emailDraft.busy) setEmailDraft(null) }}>✕ Don’t send</button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: '#6a6a62' }}>To
                <input style={{ display: 'block', width: '100%', font: 'inherit', fontSize: 13.5, padding: '8px 10px', border: '0.5px solid #d8d2c4', borderRadius: 7, marginTop: 3 }}
                  value={emailDraft.to} onChange={e => setEmailDraft(m => ({ ...m, to: e.target.value }))} disabled={emailDraft.busy} />
              </label>
              <label style={{ fontSize: 12, fontWeight: 600, color: '#6a6a62' }}>Subject
                <input style={{ display: 'block', width: '100%', font: 'inherit', fontSize: 13.5, padding: '8px 10px', border: '0.5px solid #d8d2c4', borderRadius: 7, marginTop: 3 }}
                  value={emailDraft.subject} onChange={e => setEmailDraft(m => ({ ...m, subject: e.target.value }))} disabled={emailDraft.busy} />
              </label>
              <label style={{ fontSize: 12, fontWeight: 600, color: '#6a6a62' }}>Message
                <textarea rows={5} style={{ display: 'block', width: '100%', font: 'inherit', fontSize: 13.5, padding: '8px 10px', border: '0.5px solid #d8d2c4', borderRadius: 7, marginTop: 3, resize: 'vertical' }}
                  value={emailDraft.body} onChange={e => setEmailDraft(m => ({ ...m, body: e.target.value }))} disabled={emailDraft.busy} />
              </label>
              <div style={{ fontSize: 12, color: '#8a8a85' }}>A “{emailDraft.cta}” button linking to their order is added automatically.</div>
              {emailDraft.error && <div style={{ fontSize: 12.5, fontWeight: 600, color: '#b3261e' }}>{emailDraft.error}</div>}
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
                <button type="button" className="sb-tb-linkbtn" disabled={emailDraft.busy} onClick={() => setEmailDraft(null)}>Don’t send</button>
                <button type="button" style={{ font: 'inherit', fontSize: 13, fontWeight: 700, padding: '8px 18px', borderRadius: 8, border: 'none', background: '#9A7209', color: '#fff', cursor: 'pointer', opacity: emailDraft.busy ? 0.6 : 1 }}
                  disabled={emailDraft.busy} onClick={sendDealerEmail}>{emailDraft.busy ? 'Sending…' : 'Send email'}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Layout lightbox — big, easy to read, with download (Paul, 2026-07-08). */}
      {lightbox && (
        <div className="sb-tb-modal-overlay" onClick={() => setLightbox(null)}>
          <div className="sb-tb-lightbox" onClick={e => e.stopPropagation()}>
            <div className="sb-tb-lightbox-bar">
              <b>Layout V{lightbox.version}</b>
              <span style={{ flex: 1 }} />
              <button type="button" className="sb-tb-linkbtn" onClick={() => downloadLayout(lightbox.url, lightbox.version)}>⬇ Download</button>
              <button type="button" className="sb-tb-linkbtn" onClick={() => window.open(lightbox.url, '_blank', 'noopener')}>Open full size ↗</button>
              <button type="button" className="sb-tb-linkbtn" onClick={() => setLightbox(null)}>✕ Close</button>
            </div>
            <img src={lightbox.url} alt={`Layout V${lightbox.version}`} className="sb-tb-lightbox-img" />
          </div>
        </div>
      )}
      <input ref={photoInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={onPickPhoto} />
      <input ref={layoutInputRef} type="file" accept="image/jpeg,image/png" style={{ display: 'none' }} onChange={onPickLayout} />
      <input ref={changesFileRef} type="file" multiple style={{ display: 'none' }} onChange={e => { addChangesFiles(e.target.files); e.target.value = '' }} />
    </div>
  )
}

// ── Signature modal — shared by layout approval, drop-off, and pickup ────────
// Plain canvas pad (mouse + touch — drop-offs happen at a truck tailgate).
function TradeSignModal({ mode, busy, onCancel, onDone }) {
  const canvasRef = useRef(null)
  const drawing = useRef(false)
  const [hasInk, setHasInk] = useState(false)
  const [where, setWhere] = useState('Shevchenko shop — Perth Amboy')
  const pos = (e) => {
    const c = canvasRef.current
    const rect = c.getBoundingClientRect()
    const t = e.touches?.[0] || e
    return { x: (t.clientX - rect.left) * (c.width / rect.width), y: (t.clientY - rect.top) * (c.height / rect.height) }
  }
  const start = (e) => { drawing.current = true; const ctx = canvasRef.current.getContext('2d'); const p = pos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y) }
  const move = (e) => {
    if (!drawing.current) return
    e.preventDefault()
    const ctx = canvasRef.current.getContext('2d')
    const p = pos(e)
    ctx.lineWidth = 2.4; ctx.lineCap = 'round'; ctx.strokeStyle = '#17202a'
    ctx.lineTo(p.x, p.y); ctx.stroke()
    setHasInk(true)
  }
  const end = () => { drawing.current = false }
  const clear = () => { const c = canvasRef.current; c.getContext('2d').clearRect(0, 0, c.width, c.height); setHasInk(false) }
  const titles = {
    approve: 'Approve this layout — sign below',
    dropoff: 'Stone drop-off receipt — sign below',
    pickup: 'Stone pickup receipt — sign below',
  }
  return (
    <div className="sb-tb-modal-overlay" onClick={() => !busy && onCancel()}>
      <div className="sb-tb-modal" onClick={e => e.stopPropagation()}>
        <div className="sb-tb-modal-title">{titles[mode] || 'Sign below'}</div>
        {mode === 'dropoff' && (
          <label className="sb-tb-f"><span>Where</span><input value={where} onChange={e => setWhere(e.target.value)} /></label>
        )}
        <canvas ref={canvasRef} width={520} height={160} className="sb-tb-sigpad"
          onMouseDown={start} onMouseMove={move} onMouseUp={end} onMouseLeave={end}
          onTouchStart={start} onTouchMove={move} onTouchEnd={end} />
        <div className="sb-tb-modal-actions">
          <button type="button" className="sb-tb-linkbtn" onClick={clear}>Clear</button>
          <button type="button" className="sb-tb-linkbtn" onClick={onCancel} disabled={busy}>Cancel</button>
          <button type="button" className="sb-tb-acceptbtn" disabled={busy || !hasInk}
            onClick={() => onDone({ dataUrl: canvasRef.current.toDataURL('image/png'), where })}>
            {busy ? 'Saving…' : mode === 'approve' ? '✓ Approve & sign' : 'Sign & save'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Edit modal — order-grain fields, both sides ──────────────────────────────
// Dealers edit freely BEFORE Accept; a dealer edit AFTER Accept flips
// needs_reaccept so staff re-verify the specs before the shop cuts anything.
// Staff edits never trigger re-accept (they ARE the verification).
function TradeOrderEditModal({ order: r, staffView, getActor, onClose, onSaved }) {
  const [familyName, setFamilyName] = useState(r.family_name || '')
  const [dealerOrderNumber, setDealerOrderNumber] = useState(r.dealer_order_number || '')
  const [services, setServices] = useState(() => new Set(r.services || []))
  const [serviceCustom, setServiceCustom] = useState(r.service_custom || '')
  const [neededBy, setNeededBy] = useState(dOnly(r.needed_by) || '')
  const [rush, setRush] = useState(!!r.rush || r.rush_status === 'pending' || r.rush_status === 'approved')
  const [rushNeedBy, setRushNeedBy] = useState(dOnly(r.rush_need_by) || '')
  const [notes, setNotes] = useState(r.general_notes || '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  const toggleSvc = (code) => setServices(prev => {
    const n = new Set(prev); if (n.has(code)) n.delete(code); else n.add(code); return n
  })

  const save = async () => {
    if (!familyName.trim()) { setErr('Family name is required.') ; return }
    if (rush && !rushNeedBy) { setErr('Rush needs the date you need it by.'); return }
    setBusy(true); setErr(null)
    const who = await getActor()
    const rushTurnedOn = rush && r.rush_status === 'none'
    const dealerEditPostAccept = !staffView && !!r.accepted_at
    const res = await updateTradeOrder(r.id, {
      familyName: familyName.trim(), dealerOrderNumber: dealerOrderNumber.trim() || null,
      services: [...services], serviceCustom: serviceCustom.trim() || null,
      neededBy: neededBy || null,
      rush, rushNeedBy: rush ? (rushNeedBy || null) : null,
      ...(rushTurnedOn ? { rushStatus: 'pending' } : (!rush && r.rush_status !== 'none' ? { rushStatus: 'none' } : {})),
      generalNotes: notes.trim() || null,
      ...(dealerEditPostAccept ? { needsReaccept: true } : {}),
    })
    if (!res.ok) { setBusy(false); setErr(res.error || 'Save failed.'); return }
    await logTradeEvent({
      requestId: r.id, partnerId: r.partner_id, type: 'order_edited',
      detail: `Order edited${dealerEditPostAccept ? ' after accept — needs re-accept' : ''}${rushTurnedOn ? ` · RUSH requested for ${rushNeedBy}` : ''}`,
      actor: who, actorRole: staffView ? 'staff' : 'partner',
    })
    setBusy(false)
    onSaved()
  }

  return (
    <div className="sb-tb-modal-overlay" onClick={() => !busy && onClose()}>
      <div className="sb-tb-modal" onClick={e => e.stopPropagation()}>
        <div className="sb-tb-modal-title">Edit order{r.dealer_order_number ? ` · ${r.dealer_order_number}` : ''}</div>
        {!staffView && r.accepted_at && (
          <div className="sb-tb-modal-warn">This order was already accepted — saving changes sends it back to Shevchenko for a quick re-check before work continues.</div>
        )}
        <div className="sb-tb-modal-grid">
          <label className="sb-tb-f"><span>Family name *</span><input value={familyName} onChange={e => setFamilyName(e.target.value)} /></label>
          <label className="sb-tb-f"><span>Order #</span><input value={dealerOrderNumber} onChange={e => setDealerOrderNumber(e.target.value)} /></label>
        </div>
        <div className="sb-tb-f"><span>Services</span>
          <div className="sb-tb-svcrow">
            {TRADE_SERVICES.map(s => (
              <button key={s.code} type="button" className={`sb-tb-svcchip${services.has(s.code) ? ' on' : ''}`} onClick={() => toggleSvc(s.code)}>{s.label}</button>
            ))}
          </div>
          {services.has('custom') && <input value={serviceCustom} onChange={e => setServiceCustom(e.target.value)} placeholder="Describe the custom service" style={{ marginTop: 6 }} />}
        </div>
        <div className="sb-tb-modal-grid">
          <label className="sb-tb-f"><span>Deadline</span><input type="date" value={neededBy} onChange={e => setNeededBy(e.target.value)} /></label>
          <label className="sb-tb-f sb-tb-f-rush"><span>Rush — need it by</span>
            <span className="sb-tb-rushline">
              <input type="checkbox" checked={rush} onChange={e => setRush(e.target.checked)} />
              <input type="date" value={rushNeedBy} onChange={e => setRushNeedBy(e.target.value)} disabled={!rush} />
            </span>
          </label>
        </div>
        <label className="sb-tb-f"><span>Notes</span><textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)} /></label>
        {err && <div className="sb-tb-modal-err">{err}</div>}
        <div className="sb-tb-modal-actions">
          <button type="button" className="sb-tb-linkbtn" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className="sb-tb-acceptbtn" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</button>
        </div>
      </div>
    </div>
  )
}

const TB_CSS = `
  .sb-tb { width: 100%; }
  .sb-tb-toolbar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 12px; }
  .sb-tb-tabs { display: inline-flex; gap: 3px; background: #ece6d8; border-radius: 10px; padding: 3px; }
  .sb-tb-tab { border: none; cursor: pointer; border-radius: 8px; padding: 7px 16px; font: inherit; font-size: 13px; font-weight: 700; background: transparent; color: #7a756a; }
  .sb-tb-tab.on { background: #fff; color: #0f1419; box-shadow: 0 1px 3px rgba(0,0,0,0.12); }
  .sb-tb-search { flex: 1; min-width: 180px; font: inherit; font-size: 13.5px; padding: 8px 11px; border: 0.5px solid #d8d2c4; border-radius: 8px; background: #fff; }
  .sb-tb-sel { font: inherit; font-size: 13px; padding: 8px 10px; border: 0.5px solid #d8d2c4; border-radius: 8px; background: #fff; cursor: pointer; }
  .sb-tb-new { font: inherit; font-size: 13px; font-weight: 700; padding: 8px 16px; border-radius: 8px; border: none; background: #9A7209; color: #fff; cursor: pointer; }
  .sb-tb-new:hover { background: #876307; }

  .sb-tb-board { background: #fff; border: 0.5px solid rgba(0,0,0,0.09); border-radius: 12px; overflow: hidden; }
  .sb-tb-head, .sb-tb-row { display: grid; grid-template-columns: minmax(150px,1.6fr) minmax(90px,1fr) minmax(120px,1.1fr) minmax(140px,1.2fr) minmax(140px,1.2fr) minmax(84px,.8fr) minmax(90px,.9fr); gap: 10px; align-items: center; padding: 10px 14px; }
  .sb-tb-head.staff, .sb-tb-row.staff { grid-template-columns: minmax(120px,1.3fr) minmax(100px,.9fr) minmax(75px,.8fr) minmax(100px,.9fr) minmax(125px,1.1fr) minmax(115px,1fr) minmax(140px,1.2fr) minmax(72px,.7fr) minmax(84px,.8fr); }
  .sb-tb-head { font-size: 10px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; color: #979387; border-bottom: 1px solid #ece8df; }
  .sb-tb-rowwrap { border-top: 0.5px solid #f0ede6; }
  .sb-tb-rowwrap:first-of-type { border-top: none; }
  .sb-tb-row { cursor: pointer; border-left: 3px solid transparent; }
  .sb-tb-row:hover { background: #faf8f4; }
  .sb-tb-row-rush { border-left-color: #b3261e; }
  .sb-tb-fam { font-size: 14px; font-weight: 700; color: #1e2d3d; min-width: 0; }
  .sb-tb-co { font-size: 12.5px; color: #6a6a62; }
  .sb-tb-num { font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 12px; color: #6a6a62; }
  .sb-tb-svc { font-size: 12.5px; color: #4a463f; }
  .sb-tb-date { font-size: 12.5px; color: #4a463f; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .sb-tb-dl-red { color: #b3261e; font-weight: 700; }
  .sb-tb-dl-amber { color: #8a5a12; font-weight: 700; }
  .sb-tb-dim { font-size: 12.5px; color: #a09a8c; }

  .sb-tb-pill { display: inline-block; font-size: 11px; font-weight: 700; padding: 2px 9px; border-radius: 999px; white-space: nowrap; }
  .sb-tb-rush { background: #b3261e; color: #fff; }
  .sb-tb-rushq { background: #fdf3e2; color: #8a5a12; border: 0.5px solid #e6b667; }
  .sb-tb-t-gray  { background: #f1eee5; color: #6a6a62; }
  .sb-tb-t-blue  { background: #eaf1fb; color: #1d5fa8; }
  .sb-tb-t-red   { background: #fbedec; color: #b3261e; }
  .sb-tb-t-amber { background: #fbf3df; color: #8a5a12; }
  .sb-tb-t-green { background: #e9f4ec; color: #2f7d4f; }
  .sb-tb-status { font: inherit; font-size: 12.5px; font-weight: 600; padding: 5px 8px; border: 0.5px solid #d8d2c4; border-radius: 8px; cursor: pointer; max-width: 100%; }
  .sb-tb-status:disabled { opacity: .5; }
  .sb-tb-dropbtn { font: inherit; font-size: 12px; font-weight: 700; padding: 5px 11px; border-radius: 999px; border: 1px dashed #9A7209; background: #fdf8ec; color: #9A7209; cursor: pointer; white-space: nowrap; }
  .sb-tb-dropbtn:hover:not(:disabled) { background: #9A7209; color: #fff; border-style: solid; }

  .sb-tb-detail { padding: 4px 16px 16px; background: #faf9f5; border-top: 0.5px dashed #e4e0d4; }
  .sb-tb-track { display: flex; align-items: flex-start; overflow-x: auto; padding: 14px 2px 6px; }
  .sb-tb-tstep { flex: 1; min-width: 82px; text-align: center; position: relative; }
  .sb-tb-tstep::before { content: ""; position: absolute; top: 10px; left: 0; right: 0; height: 3px; background: #e4e0d4; }
  .sb-tb-tstep:first-child::before { left: 50%; }
  .sb-tb-tstep:last-child::before { right: 50%; }
  .sb-tb-tstep.done::before { background: #2f7d4f; }
  .sb-tb-tstep.now::before { background: linear-gradient(90deg, #2f7d4f 50%, #e4e0d4 50%); }
  .sb-tb-tdot { position: relative; z-index: 1; width: 20px; height: 20px; margin: 0 auto 5px; border-radius: 50%; background: #fff; border: 3px solid #e4e0d4; display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: 800; color: #fff; }
  .sb-tb-tstep.done .sb-tb-tdot { background: #2f7d4f; border-color: #2f7d4f; }
  .sb-tb-tstep.now .sb-tb-tdot { background: #9A7209; border-color: #9A7209; box-shadow: 0 0 0 4px #f5edda; }
  .sb-tb-tlab { font-size: 10.5px; font-weight: 700; line-height: 1.25; color: #2a2a2a; }
  .sb-tb-tstep.todo .sb-tb-tlab { color: #a09a8c; font-weight: 600; }
  .sb-tb-tdate { font-size: 10px; color: #a09a8c; font-variant-numeric: tabular-nums; }
  .sb-tb-rushbar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; background: #fdf3e2; border: 1px solid #e6b667; color: #8a5a12; border-radius: 10px; padding: 9px 13px; margin: 10px 0 4px; font-size: 13px; }
  .sb-tb-approve { font: inherit; font-size: 12.5px; font-weight: 700; padding: 6px 14px; border-radius: 8px; border: none; background: #2f7d4f; color: #fff; cursor: pointer; margin-left: auto; }
  .sb-tb-decline { font: inherit; font-size: 12.5px; font-weight: 700; padding: 6px 14px; border-radius: 8px; border: 0.5px solid #b3261e; background: #fff; color: #b3261e; cursor: pointer; }
  .sb-tb-detail-cols { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 18px; margin-top: 10px; }
  .sb-tb-dl { font-size: 10px; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; color: #979387; margin-bottom: 7px; }
  .sb-tb-item { display: flex; flex-direction: column; gap: 1px; padding: 7px 0; border-top: 0.5px solid #ece8df; font-size: 13px; }
  .sb-tb-item:first-of-type { border-top: none; }
  .sb-tb-note { font-size: 12.5px; color: #6a6a62; font-style: italic; }
  .sb-tb-detail-actions { margin-top: 10px; }
  .sb-tb-linkbtn { font: inherit; font-size: 12.5px; font-weight: 600; color: #9A7209; background: none; border: 0.5px solid #d9c48a; border-radius: 7px; padding: 5px 12px; cursor: pointer; }
  .sb-tb-linkbtn:hover { background: #fdf8ec; }
  .sb-tb-log { list-style: none; margin: 0; padding: 0; }
  .sb-tb-log li { display: flex; align-items: baseline; gap: 8px; padding: 5px 0; border-top: 0.5px solid #ece8df; font-size: 12.5px; }
  .sb-tb-log li:first-child { border-top: none; }
  .sb-tb-logdot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; align-self: center; }
  .sb-tb-logdot.p { background: #9A7209; }
  .sb-tb-logdot.s { background: #1d5fa8; }
  .sb-tb-logtext { flex: 1; min-width: 0; color: #2a2a2a; }
  .sb-tb-logmeta { color: #a09a8c; font-size: 11.5px; white-space: nowrap; }
  .sb-tb-empty { padding: 40px 16px; text-align: center; color: #8a8a85; font-size: 14px; background: #fff; border: 0.5px solid rgba(0,0,0,0.08); border-radius: 12px; font-style: italic; }

  .sb-tb-deletebtn { font: inherit; font-size: 12.5px; font-weight: 700; padding: 5px 12px; border-radius: 7px; border: 0.5px solid rgba(179,38,30,.5); background: #fff; color: #b3261e; cursor: pointer; margin-left: auto; }
  .sb-tb-deletebtn.armed, .sb-tb-deletebtn:hover:not(:disabled) { background: #b3261e; border-color: #b3261e; color: #fff; }
  .sb-tb-acceptbtn { font: inherit; font-size: 12.5px; font-weight: 700; padding: 6px 14px; border-radius: 8px; border: none; background: #2f7d4f; color: #fff; cursor: pointer; }
  .sb-tb-acceptbtn:hover:not(:disabled) { background: #256a41; }
  .sb-tb-acceptbtn:disabled { opacity: .5; }
  .sb-tb-detail-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }

  .sb-tb-modal-overlay { position: fixed; inset: 0; z-index: 1200; background: rgba(15,20,25,.5); display: flex; align-items: center; justify-content: center; padding: 20px; }
  .sb-tb-modal { background: #fff; border-radius: 14px; width: min(560px, 96vw); max-height: 92vh; overflow-y: auto; padding: 20px 22px; box-shadow: 0 24px 60px rgba(0,0,0,.3); }
  .sb-tb-modal-title { font-size: 16px; font-weight: 700; color: #1e2d3d; margin-bottom: 12px; }
  .sb-tb-modal-warn { background: #fdf3e2; border: 1px solid #e6b667; color: #8a5a12; border-radius: 9px; padding: 8px 12px; font-size: 12.5px; margin-bottom: 12px; }
  .sb-tb-modal-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .sb-tb-f { display: flex; flex-direction: column; gap: 4px; margin-bottom: 10px; }
  .sb-tb-f > span { font-size: 11px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: #979387; }
  .sb-tb-f input, .sb-tb-f textarea { font: inherit; font-size: 13.5px; padding: 8px 10px; border: 0.5px solid #d8d2c4; border-radius: 8px; background: #fff; }
  .sb-tb-f input[type=checkbox] { width: 16px; height: 16px; padding: 0; accent-color: #9A7209; }
  .sb-tb-rushline { display: flex; align-items: center; gap: 8px; }
  .sb-tb-svcrow { display: flex; flex-wrap: wrap; gap: 6px; }
  .sb-tb-svcchip { font: inherit; font-size: 12px; font-weight: 600; border: 1px solid #d8d2c4; border-radius: 999px; padding: 4px 12px; background: #fff; color: #6a6a62; cursor: pointer; }
  .sb-tb-svcchip.on { background: #9A7209; border-color: #9A7209; color: #fff; }
  .sb-tb-modal-err { background: #fbedec; color: #b3261e; border-radius: 8px; padding: 8px 12px; font-size: 12.5px; margin-bottom: 10px; }
  .sb-tb-modal-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 4px; }

  .sb-tb-sigpad { width: 100%; height: 160px; border: 1.5px dashed #c9c2b1; border-radius: 10px; background: #fff; touch-action: none; cursor: crosshair; margin-bottom: 10px; }
  .sb-tb-layouts { margin: 10px 0 4px; }
  .sb-tb-layout { display: flex; align-items: center; gap: 12px; padding: 8px 0; border-top: 0.5px solid #ece8df; flex-wrap: wrap; }
  .sb-tb-layout:first-of-type { border-top: none; }
  .sb-tb-layout.cur { background: #fdfbf4; }
  .sb-tb-layimg { width: 150px; height: 108px; object-fit: cover; border: 0.5px solid #ddd6c6; border-radius: 8px; background: #f4f1e9; display: block; }
  .sb-tb-layimgbtn { border: none; background: none; padding: 0; cursor: zoom-in; }
  .sb-tb-layimg-none { display: inline-flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 700; color: #a09a8c; }
  .sb-tb-lightbox { background: #fff; border-radius: 14px; padding: 14px 16px; max-width: 94vw; max-height: 92vh; display: flex; flex-direction: column; gap: 10px; box-shadow: 0 24px 60px rgba(0,0,0,.35); }
  .sb-tb-lightbox-bar { display: flex; align-items: center; gap: 14px; font-size: 14px; color: #1e2d3d; flex-wrap: wrap; }
  .sb-tb-lightbox-img { max-width: 90vw; max-height: 78vh; object-fit: contain; border: 0.5px solid #ddd6c6; border-radius: 8px; background: #f4f1e9; }
  .sb-tb-changes-attach { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; border: 0.5px dashed #d8d2c4; border-radius: 8px; padding: 7px 10px; margin-bottom: 8px; }
  .sb-tb-changes-chip { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; background: #f4f2ee; border-radius: 6px; padding: 3px 8px; }
  .sb-tb-changes-chip button { font: inherit; border: none; background: none; cursor: pointer; color: #8a8a85; font-size: 14px; padding: 0; }
  .sb-tb-layinfo { display: flex; flex-direction: column; gap: 1px; font-size: 13px; min-width: 0; }
  .sb-tb-layactions { display: flex; gap: 8px; margin-left: auto; flex-wrap: wrap; }
  .sb-tb-changes { padding: 8px 0; }
  .sb-tb-changes textarea { font: inherit; font-size: 13px; width: 100%; box-sizing: border-box; padding: 8px 10px; border: 0.5px solid #d8d2c4; border-radius: 8px; margin-bottom: 8px; }
  .sb-tb-receipts { display: flex; flex-direction: column; gap: 6px; margin-top: 10px; }
  .sb-tb-receipt { font-size: 12.5px; color: #2a2a2a; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; background: #f4f7f4; border: 0.5px solid #cfe0d2; border-radius: 8px; padding: 6px 10px; }
  .sb-tb-photos { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .sb-tb-photo { width: 84px; height: 62px; object-fit: cover; border: 0.5px solid #ddd6c6; border-radius: 7px; }

  @media (max-width: 900px) {
    .sb-tb-head { display: none; }
    .sb-tb-row, .sb-tb-row.staff { grid-template-columns: 1fr 1fr; }
    .sb-tb-modal-grid { grid-template-columns: 1fr; }
  }
`
