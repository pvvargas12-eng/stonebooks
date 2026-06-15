// =============================================================================
// 📚 Stonebooks — Design Hub Home (JOBS-OPERATIONAL-HUBS Phase 2A.2)
// =============================================================================
// Studio-style two-column home for the Design hub. Replaces the generic
// filter-chip-and-row list view when the operator is in hub === 'design'.
// Other hubs (Admin / Production / Installation) keep their list view
// unchanged; this surface is design-specific.
//
// Layout:
//   Header strip — DESIGN HUB title + operator-prose sub-line (NOT chips —
//     the counts ARE the prose)
//   Filter chips — All / Needs attention / Layout needed / Awaiting customer /
//     Revision / Approved
//   Two-column split:
//     LEFT (360px fixed)  — Studio Queue · selectable job cards
//     RIGHT (fills 720px) — Selected job preview · Open packet → CTA
//
// Pure read-arrange — consumes the hub items already produced by
// getHubWorkItems in JobsDepartmentView. Click "Open packet →" calls the
// onOpenJob prop with a tab='design' hint so the host (JobsTab) opens
// JobDetail with the Design Packet tab pre-selected.
// =============================================================================

import { useState, useMemo, useEffect } from 'react'
import {
  fmtUSD, fmtDate, getLatestChangeRequestNotes,
  getChangeRequestThread, logRevisionReply, getCurrentStaffName,
} from './lib/stonebooksData'
import { FilterChip } from './lib/crmComponents.jsx'

// Local short-date — fmtDate is fine but the deadline label in the preview
// pane wants a compact month-day rendering ("May 28") rather than a full
// year. fmtDate already supports this with no opts.
const shortDate = (iso) => fmtDate(iso)

// Classifies a hub item by its proof state. Used by the filter chip
// predicates + the queue card status pill. Reads job.milestones directly
// since the per-item pressure isn't proof-aware.
function proofStateForItem(item) {
  const milestones = item?.job?.milestones || []
  const byKey = new Map(milestones.map(m => [m.milestone_key, m]))
  const approved = byKey.get('proof_approved') || byKey.get('bronze_proof_approved')
  const sent     = byKey.get('proof_sent')     || byKey.get('bronze_proof_sent')
  const created  = byKey.get('proof_created')  || byKey.get('bronze_proof_created')
  const isDone = (m) => m && m.status === 'done'
  if (isDone(approved)) return 'approved'
  // Revision: customer (or staff) requested changes — proof_changes_requested
  // is the live "revision pending" signal (set by markProofChangesRequested /
  // the approve-submit Edge Function). Checked before awaiting/sending because
  // a rejection reverts proof_sent, which would otherwise read as 'sending'.
  const changeReq = byKey.get('proof_changes_requested')
  if (changeReq && changeReq.status === 'in_progress') return 'revision'
  if (isDone(sent) && approved && !isDone(approved)) return 'awaiting'
  if (isDone(created) && sent && !isDone(sent)) return 'sending'
  return 'design_needed'
}

// Full customer-revision THREAD for the order — every change request (newest
// first) with the version it was against + timestamp, plus staff replies inline.
// On each revision the staff can "Reply": the reply is logged to the order
// timeline (shows in the thread) AND opens a prefilled mailto draft — it is NOT
// auto-sent (server-side email is the future Gmail integration). Renders nothing
// when the order has no revision history. Stops click propagation because the
// whole preview pane is a click target that opens the packet.
function RevisionThread({ order, jobId }) {
  const orderId = order?.id || null
  const email = order?.customer?.email || ''
  const orderNum = order?.order_number || ''
  const [entries, setEntries] = useState(null)
  const [openReplyId, setOpenReplyId] = useState(null)
  const [replyText, setReplyText] = useState('')
  const [busy, setBusy] = useState(false)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let alive = true
    getChangeRequestThread({ orderId, jobId })
      .then(rows => { if (alive) setEntries(rows || []) })
      .catch(() => { if (alive) setEntries([]) })
    return () => { alive = false }
  }, [orderId, jobId, tick])

  if (entries === null) return null
  const hasRevisions = entries.some(e => e.kind === 'revision')
  if (!hasRevisions) return null

  const openReply = (id) => { setOpenReplyId(id); setReplyText('') }
  const cancelReply = () => { setOpenReplyId(null); setReplyText('') }

  const saveReply = async (entry) => {
    const text = replyText.trim()
    if (!text || busy) return
    setBusy(true)
    const actor = await getCurrentStaffName()
    await logRevisionReply({ orderId, versionNumber: entry.versionNumber, text, actor })
    const subject = `Re: Your monument layout${orderNum ? ` — Order ${orderNum}` : ''}`
    const mailto = `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}`
    setBusy(false); setOpenReplyId(null); setReplyText('')
    setTick(t => t + 1)
    // Open the mail client with a draft without navigating the SPA away.
    const a = document.createElement('a')
    a.href = mailto
    a.rel = 'noopener'
    a.click()
  }

  return (
    <div onClick={e => e.stopPropagation()} style={{ marginTop: 8 }}>
      <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: '#9a3412', marginBottom: 6 }}>
        Customer revisions · {entries.filter(e => e.kind === 'revision').length}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
        {entries.map(e => e.kind === 'reply' ? (
          <div key={e.id} style={{ marginLeft: 16, padding: '6px 9px', background: '#f4f2ee', borderLeft: '2px solid #c9c2b1', borderRadius: 4 }}>
            <div style={{ fontSize: 10.5, fontWeight: 700, color: '#6a655c', marginBottom: 2 }}>
              ↳ Reply · {e.by}{e.versionNumber ? ` · re: v${e.versionNumber}` : ''} · {fmtDate(e.at)}
            </div>
            <div style={{ fontSize: 12.5, color: '#3a362f', lineHeight: 1.45 }}>{e.note}</div>
          </div>
        ) : (
          <div key={e.id} style={{ padding: '8px 10px', background: '#fff4ed', border: '1px solid #f0a878', borderRadius: 6 }}>
            <div style={{ fontSize: 10.5, fontWeight: 700, color: '#9a3412', marginBottom: 3, display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <span>⚠ {e.by} requested changes{e.versionNumber ? ` · re: v${e.versionNumber}` : ''}</span>
              <span style={{ color: '#b08a6a', fontWeight: 600 }}>{fmtDate(e.at)}</span>
            </div>
            <div style={{ fontSize: 12.5, color: '#5a4326', lineHeight: 1.45 }}>{e.note || '(no detail provided)'}</div>
            {openReplyId === e.id ? (
              <div style={{ marginTop: 7 }}>
                <textarea
                  value={replyText}
                  onChange={ev => setReplyText(ev.target.value)}
                  rows={3}
                  placeholder="Ask the family for clarification or confirm the fix…"
                  style={{ width: '100%', border: '1px solid #d8d2c4', borderRadius: 5, padding: 7, font: 'inherit', fontSize: 12.5, resize: 'vertical', boxSizing: 'border-box' }}
                />
                <div style={{ fontSize: 10.5, color: '#8a8472', margin: '4px 0 6px' }}>
                  Logs to the order timeline and opens an email draft in your mail client — not sent automatically.
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    type="button" disabled={!replyText.trim() || busy} onClick={() => saveReply(e)}
                    style={{ border: '1px solid #9a7209', background: '#9a7209', color: '#fff', borderRadius: 5, padding: '5px 11px', fontSize: 12, fontWeight: 600, cursor: 'pointer', opacity: (!replyText.trim() || busy) ? 0.5 : 1 }}
                  >
                    {busy ? 'Saving…' : (email ? 'Log & draft email' : 'Log reply')}
                  </button>
                  <button
                    type="button" onClick={cancelReply}
                    style={{ border: '1px solid #d8d2c4', background: '#fff', color: '#6a655c', borderRadius: 5, padding: '5px 11px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button" onClick={() => openReply(e.id)}
                style={{ marginTop: 6, border: 'none', background: 'none', color: '#9a7209', fontSize: 12, fontWeight: 700, cursor: 'pointer', padding: 0 }}
              >
                Reply ↩
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

// Operator prose sub-line — "{N} layouts in flight · {N} waiting on customer
// · {N} needs design". Counts ARE the prose; do not chip-ify these. Updates
// live as items / filters change.
function makeSubline({ total, waiting, needsDesign, approved }) {
  if (total === 0) {
    return 'Design hub is clear · no layouts, proofs, or inscriptions waiting.'
  }
  const parts = [
    `${total} ${total === 1 ? 'layout' : 'layouts'} in flight`,
    waiting > 0 && `${waiting} waiting on customer`,
    needsDesign > 0 && `${needsDesign} ${needsDesign === 1 ? 'needs design' : 'need design'}`,
    approved > 0 && `${approved} approved`,
  ].filter(Boolean)
  return parts.join(' · ')
}

const FILTER_CHIPS = [
  { code: 'attention',     label: 'Needs attention',  match: (it) => it.urgent === true },
  { code: 'layout',        label: 'Layout needed',    match: (it) => proofStateForItem(it) === 'design_needed' },
  { code: 'awaiting',      label: 'Awaiting customer',match: (it) => proofStateForItem(it) === 'awaiting' },
  { code: 'revision',      label: 'Revision',         match: (it) => proofStateForItem(it) === 'revision' },
  { code: 'approved',      label: 'Approved',         match: (it) => proofStateForItem(it) === 'approved' },
]

export default function DesignHubHome({ hubData, onOpenJob }) {
  // Memoize so the array identity is stable across renders — feeds the
  // useMemo hooks below without re-firing them on every parent render.
  const items = useMemo(() => hubData?.items || [], [hubData])

  // Selected job id (local UI state — not persisted). Defaults to the first
  // item when the queue is non-empty so the preview pane never opens blank.
  const [selectedId, setSelectedId] = useState(() => items[0]?.job?.id || null)
  const [activeFilters, setActiveFilters] = useState(() => new Set())

  // Change-request note previews for revision cards — one batched fetch so the
  // queue cards show the customer's words while scanning, no per-card round trip.
  const [changeNotes, setChangeNotes] = useState({})
  useEffect(() => {
    const revisionJobs = items
      .filter(it => proofStateForItem(it) === 'revision')
      .map(it => ({ id: it.job?.id, order_id: it.job?.order_id || it.order?.id }))
      .filter(j => j.id)
    if (!revisionJobs.length) { setChangeNotes({}); return }
    let alive = true
    getLatestChangeRequestNotes(revisionJobs)
      .then(map => { if (alive) setChangeNotes(map) })
      .catch(() => { if (alive) setChangeNotes({}) })
    return () => { alive = false }
  }, [items])

  // Apply filter chips. OR-style multi-select within the chip row.
  const filteredItems = useMemo(() => {
    if (activeFilters.size === 0) return items
    return items.filter(it => {
      for (const code of activeFilters) {
        const chip = FILTER_CHIPS.find(c => c.code === code)
        if (chip && chip.match(it)) return true
      }
      return false
    })
  }, [items, activeFilters])

  // Counts for the operator-prose sub-line. Computed across ALL items
  // (not the filtered view) so the prose reads as the hub's current truth,
  // not "what's left after my filter."
  const counts = useMemo(() => {
    let waiting = 0, needsDesign = 0, approved = 0
    for (const it of items) {
      const ps = proofStateForItem(it)
      if (ps === 'awaiting') waiting++
      else if (ps === 'design_needed') needsDesign++
      else if (ps === 'approved') approved++
    }
    return { total: items.length, waiting, needsDesign, approved }
  }, [items])

  // Chip-level counts inside the FilterChip badge. Reads from full item set
  // so the badge represents reality, not post-filter residue.
  const chipCounts = useMemo(() => {
    const c = {}
    for (const chip of FILTER_CHIPS) {
      c[chip.code] = items.filter(it => chip.match(it)).length
    }
    return c
  }, [items])

  // Auto-pick a sensible selection when the filter changes and the current
  // selection drops out of the visible queue.
  const visibleIds = useMemo(
    () => new Set(filteredItems.map(it => it.job?.id).filter(Boolean)),
    [filteredItems],
  )
  const effectiveSelectedId = selectedId && visibleIds.has(selectedId)
    ? selectedId
    : (filteredItems[0]?.job?.id || null)
  const selectedItem = filteredItems.find(it => it.job?.id === effectiveSelectedId) || null

  const toggleFilter = (code) => {
    const next = new Set(activeFilters)
    if (next.has(code)) next.delete(code); else next.add(code)
    setActiveFilters(next)
  }

  return (
    <div className="sb-dh-page">
      {/* HEADER STRIP — title + operator-prose sub-line */}
      <header className="sb-dh-head">
        <div className="sb-dh-title">DESIGN HUB</div>
        <div className="sb-dh-subline">{makeSubline(counts)}</div>
      </header>

      {/* FILTER CHIPS — bronze-active multi-select */}
      <div className="sb-dh-chip-row">
        {FILTER_CHIPS.map(chip => (
          <FilterChip
            key={chip.code}
            active={activeFilters.has(chip.code)}
            onClick={() => toggleFilter(chip.code)}
            count={chipCounts[chip.code] || 0}
          >
            {chip.label}
          </FilterChip>
        ))}
      </div>

      {/* TWO-COLUMN SPLIT */}
      <div className="sb-dh-split">
        {/* LEFT — STUDIO QUEUE */}
        <div className="sb-dh-queue">
          <div className="sb-dh-queue-eyebrow">Studio queue</div>
          {filteredItems.length === 0 ? (
            <div className="sb-dh-queue-empty">
              {items.length === 0
                ? 'Design hub is clear. No layouts, proofs, or inscriptions waiting.'
                : 'No items match these filters.'}
            </div>
          ) : (
            <div className="sb-dh-queue-list">
              {filteredItems.map(it => (
                <QueueCard
                  key={it.job?.id}
                  item={it}
                  note={changeNotes[it.job?.id]}
                  selected={it.job?.id === effectiveSelectedId}
                  onSelect={() => setSelectedId(it.job?.id)}
                />
              ))}
            </div>
          )}
        </div>

        {/* RIGHT — SELECTED JOB PREVIEW */}
        <div className="sb-dh-preview-wrap">
          {selectedItem ? (
            <PreviewPane item={selectedItem} onOpenPacket={() => onOpenJob?.(selectedItem.job.id, 'design')} />
          ) : (
            <div className="sb-dh-preview-empty">Select a job from the queue to preview.</div>
          )}
        </div>
      </div>
    </div>
  )
}

// =============================================================================
// QUEUE CARD — one per item in the left rail
// =============================================================================
function QueueCard({ item, note, selected, onSelect }) {
  const job = item.job
  const order = item.order || job.order || null
  const familyName = order?.primary_lastname || order?.customer?.last_name || null
  const deceasedFirst = Array.isArray(order?.deceased) && order.deceased.length > 0
    ? [order.deceased[0].firstName, order.deceased[0].lastName].filter(Boolean).join(' ')
    : null
  const ps = proofStateForItem(item)
  const statusInfo = STATUS_PILL_MAP[ps] || STATUS_PILL_MAP.design_needed
  const orderNum = order?.order_number || (job.id ? job.id.slice(0, 8) : '—')
  const ageDays = item.pressure?.ageDays || 0

  return (
    <button
      type="button"
      onClick={onSelect}
      className={`sb-dh-card${selected ? ' sb-dh-card-selected' : ''}`}
      aria-pressed={selected}
    >
      <div className="sb-dh-card-family">
        {familyName ? familyName.toUpperCase() : '— FAMILY —'}
      </div>
      <div className="sb-dh-card-deceased">
        {deceasedFirst || (job.job_type === 'cleaning_repair' ? 'Cleaning / repair' : 'Stone TBD')}
      </div>
      <div className="sb-dh-card-foot">
        <span className={`sb-dh-card-pill sb-dh-card-pill-${statusInfo.tone}`}>
          {statusInfo.label}
        </span>
        <span className="sb-dh-card-foot-spacer" />
        <span className="sb-dh-card-meta sb-crm-tabular">{ageDays}d · {orderNum}</span>
      </div>
      {ps === 'revision' && note && (
        <div
          title={note}
          style={{ marginTop: 6, fontSize: 11.5, fontWeight: 600, color: '#9a3412', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
        >
          ⚠ {note}
        </div>
      )}
    </button>
  )
}

// Status pill vocabulary — mirrors DesignPacket's proofSummary text exactly
// so the operator sees the same prose across the queue card and the packet
// hero. Revision tone is AMBER (not red) — revision is work-in-progress,
// not a broken state; red would misread as critical (CRM + Monument Ops
// review consensus 2026-05-29).
const STATUS_PILL_MAP = {
  design_needed:  { label: 'Layout needed',    tone: 'bronze' },
  sending:        { label: 'Ready to send',    tone: 'bronze' },
  awaiting:       { label: 'Awaiting customer', tone: 'amber' },
  revision:       { label: 'Revision',         tone: 'amber' },
  approved:       { label: 'Approved',         tone: 'green' },
}

// =============================================================================
// PREVIEW PANE — selected job preview, full design packet CTA
// =============================================================================
function PreviewPane({ item, onOpenPacket }) {
  const job = item.job
  const order = item.order || job.order || null
  const cemetery = job.cemetery || order?.cemetery || null
  const familyName = order?.primary_lastname || order?.customer?.last_name || null
  const deceasedName = Array.isArray(order?.deceased) && order.deceased.length > 0
    ? [order.deceased[0].firstName, order.deceased[0].lastName].filter(Boolean).join(' ')
    : null
  const ps = proofStateForItem(item)
  const ageDays = item.pressure?.ageDays || 0
  const statusInfo = STATUS_PILL_MAP[ps] || STATUS_PILL_MAP.design_needed

  // Status prose for the inline Status block. Reads from real milestones.
  const statusProse = (() => {
    if (ps === 'approved')      return `Approved · ${ageDays}d total in flight`
    if (ps === 'awaiting')      return `Awaiting customer approval · ${ageDays}d in flight`
    if (ps === 'sending')       return `Ready to send · ${ageDays}d in flight`
    if (ps === 'revision')      return `Revision requested · ${ageDays}d in flight`
    return `Layout needed · ${ageDays}d waiting`
  })()

  // Missing-info quick scan — operator sees the count + first 3 items
  // inline. Detailed list lives on the full packet.
  const missingItems = computePreviewMissing(item)

  // Whole-card click — the preview card is one large affordance per spec
  // ("Whole card clickable, CTA is the visible affordance"). Routes via
  // the same onOpenPacket callback the button uses; the button stays as
  // the visual signal so an operator scanning the card knows the gesture
  // exists. Keyboard reachable via the button.
  return (
    <div
      className="sb-dh-preview"
      role="button"
      tabIndex={-1}
      onClick={onOpenPacket}
      aria-label="Open full design packet"
    >
      <header className="sb-dh-preview-head">
        <div>
          <h2 className="sb-dh-preview-family">
            {familyName || <span className="sb-dh-preview-missing">— family —</span>}
          </h2>
          {deceasedName && (
            <div className="sb-dh-preview-deceased">{deceasedName}</div>
          )}
        </div>
        <span className={`sb-dh-preview-pill sb-dh-preview-pill-${statusInfo.tone}`}>
          {statusInfo.label}
        </span>
      </header>

      <div className="sb-dh-preview-meta">
        {cemetery?.name && <span>{cemetery.name}</span>}
        {order?.plot_type && (
          <>
            <span className="sb-dh-preview-sep">·</span>
            <span>{humanizePlotType(order.plot_type)}</span>
          </>
        )}
        {order?.order_number && (
          <>
            <span className="sb-dh-preview-sep">·</span>
            <span className="sb-crm-mono">{order.order_number}</span>
          </>
        )}
        {job.job_type && (
          <>
            <span className="sb-dh-preview-sep">·</span>
            <span>{jobTypeLabel(job.job_type)}</span>
          </>
        )}
      </div>

      <div className="sb-dh-preview-section">
        <div className="sb-dh-preview-section-eyebrow">Status</div>
        <div className="sb-dh-preview-status-prose">{statusProse}</div>
        {/* Full revision thread (history + reply). Rendered unconditionally — the
            component self-gates: it shows ONLY when the order actually has
            change-request history (approval_links rows OR internal request-changes
            job_events) and returns null otherwise. This is deliberate: revisions
            are a permanent record across ALL versions, so they must surface
            regardless of the CURRENT proof's send/draft state (e.g. rejections on
            v3/v4 still show while v5 is a fresh draft). Zero-revision orders keep
            showing just "Layout needed". */}
        <RevisionThread order={order} jobId={job.id} />
        {/* Cemetery deadline + rush flag surface here too — operators
            browsing the queue need to see hard external pressure without
            opening the full packet (CRM review 2026-05-29). */}
        {(order?.cemetery_deadline || order?.rush_order) && (
          <div className="sb-dh-preview-pressure">
            {order.rush_order && (
              <span className="sb-dh-preview-rush">RUSH</span>
            )}
            {order.cemetery_deadline && (
              <span className="sb-dh-preview-deadline">
                Cemetery deadline <strong className="sb-crm-tabular">{shortDate(order.cemetery_deadline)}</strong>
              </span>
            )}
          </div>
        )}
      </div>

      <div className="sb-dh-preview-section">
        <div className="sb-dh-preview-section-eyebrow">
          Missing {missingItems.length > 0 && <span className="sb-dh-preview-missing-count">· {missingItems.length}</span>}
        </div>
        {missingItems.length === 0 ? (
          <div className="sb-dh-preview-clear">
            <span className="sb-dh-preview-clear-glyph" aria-hidden="true">✓</span>
            All information complete
          </div>
        ) : (
          <ul className="sb-dh-preview-missing-list">
            {missingItems.slice(0, 3).map(m => (
              <li key={m.key} className="sb-dh-preview-missing-item">
                <span className="sb-dh-preview-missing-glyph" aria-hidden="true">↳</span>
                <span>{m.label}</span>
              </li>
            ))}
            {missingItems.length > 3 && (
              <li className="sb-dh-preview-missing-more">
                +{missingItems.length - 3} more — see full packet
              </li>
            )}
          </ul>
        )}
      </div>

      {/* Financial summary — if order has a balance, surface it as part of
          the prose context. Operators benefit from "this stone is paid" /
          "balance still due" when deciding sequencing. */}
      {order?.grand_total != null && (
        <div className="sb-dh-preview-section">
          <div className="sb-dh-preview-section-eyebrow">Financial</div>
          <div className="sb-dh-preview-financial">
            {fmtUSD(Number(order.grand_total))} total
          </div>
        </div>
      )}

      {/* CTA — bronze pill button. Whole card is clickable too. */}
      <button
        type="button"
        className="sb-dh-preview-cta"
        onClick={onOpenPacket}
      >
        Open packet →
      </button>
    </div>
  )
}

// Mirrors the DesignPacket detectMissingInfo() heuristic but lighter — the
// preview pane shows a quick scan; the full packet runs the full check.
function computePreviewMissing(item) {
  const job = item.job
  const order = item.order || job.order || {}
  const cemetery = job.cemetery || null
  const milestones = Array.isArray(job.milestones) ? job.milestones : []
  const inscription = order.inscription || {}
  const deceased = Array.isArray(order.deceased) ? order.deceased : []
  const byKey = new Map(milestones.map(m => [m.milestone_key, m]))
  const isDone = (k) => byKey.get(k)?.status === 'done'

  const missing = []
  if (!order.standard_size_code && order.width_inches == null) {
    missing.push({ key: 'stone_size', label: 'Stone size not set' })
  }
  if (job.job_type !== 'cleaning_repair' && !inscription.epitaph) {
    missing.push({ key: 'epitaph', label: 'Inscription verse not chosen' })
  }
  if (!inscription.preExistingPhotoUrl) {
    missing.push({ key: 'photo', label: 'Customer photo missing' })
  }
  const cemeteryConfirmed = isDone('cemetery_confirmed') || isDone('permit_approved') || isDone('permit_filed')
  if (!cemeteryConfirmed && !(cemetery?.notes || cemetery?.rules_notes)) {
    missing.push({ key: 'cemetery_rules', label: 'Cemetery rules unconfirmed' })
  }
  let datesGap = false
  for (const d of deceased) {
    const pn = !!(d?.isPreNeed ?? d?.is_pre_need)
    const dob = d?.dateOfBirth || d?.date_of_birth
    const dod = d?.dateOfDeath || d?.date_of_death
    if (pn) { if (!dob) { datesGap = true; break } }
    else    { if (!dob || !dod) { datesGap = true; break } }
  }
  if (deceased.length > 0 && datesGap) {
    missing.push({ key: 'dates', label: 'Birth or death dates incomplete' })
  }
  if (!isDone('proof_approved') && !isDone('bronze_proof_approved')) {
    missing.push({ key: 'approval', label: 'Customer approval not yet received' })
  }
  return missing
}

// ── small label helpers (mirror DesignPacket's but inline for self-containment)
function humanizePlotType(code) {
  if (!code) return ''
  return String(code).replace(/[_-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}
function jobTypeLabel(jt) {
  if (jt === 'new_stone')       return 'New stone'
  if (jt === 'mausoleum_door')  return 'Crypt door'
  if (jt === 'cleaning_repair') return 'Cleaning / Repair'
  if (jt === 'inscription')     return 'Inscription'
  return humanizePlotType(jt)
}

// =============================================================================
// STYLES
// =============================================================================
const localStyles = `
  /* ── PAGE FRAME ──────────────────────────────────────────────────────── */
  .sb-dh-page {
    width: 100%;
    max-width: 1180px;
    margin: 0 auto;
    padding: 24px 32px 64px;
  }

  /* ── HEADER STRIP ────────────────────────────────────────────────────── */
  .sb-dh-head {
    margin-bottom: 24px;
  }
  .sb-dh-title {
    font-size: 13px;
    font-weight: 600;
    letter-spacing: 0.2em;
    text-transform: uppercase;
    color: #111;
    margin-bottom: 8px;
  }
  .sb-dh-subline {
    font-size: 15px;
    color: var(--sb-text-muted);
    line-height: 1.5;
  }

  /* ── FILTER CHIPS ────────────────────────────────────────────────────── */
  .sb-dh-chip-row {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-bottom: 24px;
  }

  /* ── SPLIT LAYOUT ────────────────────────────────────────────────────── */
  .sb-dh-split {
    display: grid;
    grid-template-columns: 360px 1fr;
    gap: 24px;
    align-items: start;
  }
  @media (max-width: 960px) {
    .sb-dh-split {
      grid-template-columns: 1fr;
    }
  }

  /* ── STUDIO QUEUE ────────────────────────────────────────────────────── */
  .sb-dh-queue {
    min-width: 0;
  }
  .sb-dh-queue-eyebrow {
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.2em;
    text-transform: uppercase;
    color: #666;
    margin-bottom: 10px;
    padding: 0 4px;
  }
  .sb-dh-queue-list {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .sb-dh-queue-empty {
    padding: 24px 16px;
    text-align: center;
    background: #fff;
    border: 0.5px solid rgba(0,0,0,0.08);
    border-radius: 12px;
    font-size: 14px;
    color: var(--sb-text-muted);
    font-style: italic;
  }

  /* ── QUEUE CARD ──────────────────────────────────────────────────────── */
  .sb-dh-card {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    width: 100%;
    background: #fff;
    border: 0.5px solid rgba(0,0,0,0.08);
    border-left: 3px solid transparent;
    border-radius: 12px;
    padding: 14px 16px 12px 13px;
    cursor: pointer;
    text-align: left;
    font: inherit;
    color: inherit;
    box-shadow: 0 1px 2px rgba(15,20,25,0.03);
    transition: transform 0.12s, box-shadow 0.12s, border-color 0.12s, background 0.12s;
  }
  .sb-dh-card:hover {
    transform: translateY(-1px);
    box-shadow: 0 4px 12px rgba(15,20,25,0.08);
  }
  .sb-dh-card:focus-visible {
    outline: 2px solid #9A7209;
    outline-offset: 2px;
  }
  .sb-dh-card-selected {
    border-left-color: #9A7209;
    background: #fbf8f0;
    transform: translateY(-1px);
    box-shadow: 0 4px 12px rgba(154,114,9,0.10);
  }
  .sb-dh-card-family {
    font-size: 18px;
    font-weight: 600;
    letter-spacing: 0.05em;
    color: #111;
    margin-bottom: 4px;
    line-height: 1.2;
  }
  .sb-dh-card-deceased {
    font-size: 14px;
    color: var(--sb-text-muted);
    margin-bottom: 12px;
    font-weight: 400;
  }
  .sb-dh-card-foot {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-top: auto;
  }
  .sb-dh-card-foot-spacer { flex: 1; }
  .sb-dh-card-meta {
    font-size: 12px;
    color: var(--sb-text-muted);
  }
  .sb-dh-card-pill {
    font-size: 11px;
    font-weight: 500;
    padding: 2px 8px;
    border-radius: 999px;
    letter-spacing: 0.02em;
  }
  .sb-dh-card-pill-bronze { background: rgba(154,114,9,0.12); color: #9A7209; }
  .sb-dh-card-pill-amber  { background: rgba(184,132,42,0.14); color: #8b6418; }
  .sb-dh-card-pill-red    { background: rgba(181,64,64,0.12); color: #b54040; }
  .sb-dh-card-pill-green  { background: rgba(56,122,79,0.12); color: #38704f; }

  /* ── PREVIEW PANE ────────────────────────────────────────────────────── */
  .sb-dh-preview-wrap {
    min-width: 0;
  }
  .sb-dh-preview-empty {
    padding: 96px 32px;
    text-align: center;
    background: #fff;
    border: 0.5px solid rgba(0,0,0,0.08);
    border-radius: 16px;
    font-size: 15px;
    color: var(--sb-text-muted);
    font-style: italic;
  }
  .sb-dh-preview {
    background: #fff;
    border-radius: 16px;
    padding: 32px;
    box-shadow: 0 1px 2px rgba(15,20,25,0.04), 0 8px 24px rgba(15,20,25,0.06);
    cursor: pointer;
    transition: box-shadow 0.18s;
  }
  .sb-dh-preview:hover {
    box-shadow: 0 1px 2px rgba(15,20,25,0.06), 0 12px 28px rgba(15,20,25,0.08);
  }
  .sb-dh-preview-head {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 16px;
    margin-bottom: 12px;
  }
  .sb-dh-preview-family {
    margin: 0 0 4px;
    font-size: 32px;
    font-weight: 600;
    letter-spacing: 0.02em;
    color: #111;
    line-height: 1.1;
    text-transform: uppercase;
  }
  .sb-dh-preview-deceased {
    font-size: 18px;
    color: var(--sb-text-muted);
  }
  .sb-dh-preview-missing {
    color: var(--sb-text-muted);
    font-style: italic;
  }
  .sb-dh-preview-pill {
    font-size: 11px;
    font-weight: 500;
    padding: 4px 10px;
    border-radius: 999px;
    letter-spacing: 0.02em;
    white-space: nowrap;
  }
  .sb-dh-preview-pill-bronze { background: rgba(154,114,9,0.12); color: #9A7209; }
  .sb-dh-preview-pill-amber  { background: rgba(184,132,42,0.14); color: #8b6418; }
  .sb-dh-preview-pill-red    { background: rgba(181,64,64,0.12); color: #b54040; }
  .sb-dh-preview-pill-green  { background: rgba(56,122,79,0.12); color: #38704f; }

  .sb-dh-preview-meta {
    font-size: 13px;
    color: var(--sb-text-muted);
    display: flex;
    flex-wrap: wrap;
    column-gap: 8px;
    row-gap: 4px;
    margin-bottom: 24px;
  }
  .sb-dh-preview-sep { color: var(--sb-border); }

  .sb-dh-preview-section {
    margin-bottom: 16px;
  }
  .sb-dh-preview-section-eyebrow {
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: #666;
    margin-bottom: 8px;
  }
  .sb-dh-preview-missing-count {
    color: #9A7209;
    letter-spacing: 0;
    text-transform: none;
  }
  .sb-dh-preview-status-prose {
    font-size: 15px;
    color: #111;
    line-height: 1.5;
  }
  .sb-dh-preview-pressure {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px;
    margin-top: 8px;
  }
  .sb-dh-preview-rush {
    display: inline-block;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.14em;
    color: #fff;
    background: var(--sb-red, #b54040);
    padding: 2px 8px;
    border-radius: 3px;
  }
  .sb-dh-preview-deadline {
    font-size: 13px;
    color: var(--sb-text-muted);
  }
  .sb-dh-preview-deadline strong {
    color: #111;
    font-weight: 500;
  }
  .sb-dh-preview-missing-list {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .sb-dh-preview-missing-item {
    display: flex;
    align-items: baseline;
    gap: 8px;
    padding: 4px 0;
    font-size: 14px;
    color: #111;
  }
  .sb-dh-preview-missing-glyph {
    color: #9A7209;
    flex-shrink: 0;
  }
  .sb-dh-preview-missing-more {
    padding: 6px 0 2px 16px;
    font-size: 13px;
    color: var(--sb-text-muted);
    font-style: italic;
  }
  .sb-dh-preview-clear {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 14px;
    color: var(--sb-text);
    padding: 4px 0;
  }
  .sb-dh-preview-clear-glyph {
    color: #38704f;
    font-size: 18px;
  }
  .sb-dh-preview-financial {
    font-size: 15px;
    color: #111;
    font-variant-numeric: tabular-nums;
  }
  .sb-dh-preview-cta {
    margin-top: 12px;
    background: #9A7209;
    color: #fff;
    border: none;
    font: inherit;
    font-size: 15px;
    font-weight: 500;
    padding: 12px 24px;
    border-radius: 999px;
    cursor: pointer;
    align-self: flex-start;
    transition: filter 0.12s, transform 0.12s;
  }
  .sb-dh-preview-cta:hover {
    filter: brightness(0.94);
    transform: translateY(-1px);
  }
  .sb-dh-preview-cta:focus-visible {
    outline: 2px solid #9A7209;
    outline-offset: 3px;
  }

  /* ── RESPONSIVE ──────────────────────────────────────────────────────── */
  @media (max-width: 720px) {
    .sb-dh-page { padding: 16px 16px 48px; }
    .sb-dh-preview { padding: 20px; }
    .sb-dh-preview-family { font-size: 26px; }
  }
`

if (typeof document !== 'undefined' && !document.getElementById('sb-design-hub-home-styles')) {
  const tag = document.createElement('style')
  tag.id = 'sb-design-hub-home-styles'
  tag.textContent = localStyles
  document.head.appendChild(tag)
}
