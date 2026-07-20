// =============================================================================
// ApprovalsScreen — owner view of every proof out the door (FIELD-3)
// =============================================================================
// Four lanes off listAllApprovalLinks (displayStatus carries lazy expiry):
//   1. Changes requested — red fl-needs cards with the customer's own note
//      (batched via getLatestChangeRequestNotes, keyed here by order id).
//   2. Waiting — family opened the proof, never answered; NUDGE copies the
//      share link and opens a pre-filled SMS (nothing written, no undo).
//   3. Sent — pending links with hard email evidence (emailed_at) or the
//      loud NO EMAIL ON RECORD badge.
//   4. Signed — quiet rows for the last 14 days.
// One row per order per lane; the fetch is created_at DESC so the first link
// seen per order IS the latest. Every row opens the job.
// =============================================================================
import { useState, useEffect, useMemo } from 'react'
import { listAllApprovalLinks, getLatestChangeRequestNotes } from '../lib/stonebooksData'
import { familyNameOf, todayISO } from './fieldShared'

// Pure formatter — only ever called from useMemo bodies.
function fmtShortDate(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return String(iso).slice(0, 10)
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

const NOTE_CLAMP = {
  fontSize: 13, fontStyle: 'italic', fontWeight: 500, color: '#6B6456',
  marginTop: 4, lineHeight: 1.35,
  display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden',
}

export default function ApprovalsScreen({ who, undo, onOpenJob, onBack }) {
  const [links, setLinks] = useState(null)   // null = loading
  const [notes, setNotes] = useState({})     // orderId -> latest customer change note
  const [err, setErr] = useState(null)
  const [today, setToday] = useState(() => todayISO())

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const all = await listAllApprovalLinks()
        if (cancelled) return
        setLinks(all || [])
        setToday(todayISO())
        // Batched note load for the changes-requested orders. The helper takes
        // job-shaped rows ({ id, order_id }) and keys its result by id — feeding
        // the order id as BOTH keys the map by order, which is what we render by.
        const crOrders = [...new Set((all || [])
          .filter(l => l.order_id && (l.displayStatus === 'changes_requested' || l.status === 'changes_requested'))
          .map(l => l.order_id))]
        if (crOrders.length) {
          const map = await getLatestChangeRequestNotes(crOrders.map(id => ({ id, order_id: id }))).catch(() => ({}))
          if (!cancelled) setNotes(map || {})
        }
      } catch (e) {
        if (!cancelled) setErr(e?.message || 'Could not load approvals.')
      }
    })()
    return () => { cancelled = true }
  }, [])

  const groups = useMemo(() => {
    if (!links) return null
    // Day-granular ages off the fetch-time date stamp (noon keeps "N days ago"
    // honest against timestamps taken at any hour) — no impure clock in render.
    const nowMs = new Date(today + 'T12:00:00').getTime()
    const daysSince = (iso) => Math.floor((nowMs - new Date(iso).getTime()) / 86400000)

    // One row per order per lane; fetch order is created_at DESC, so the first
    // link seen for an order is the latest one — latest link wins.
    const pick = (pred) => {
      const seen = new Set()
      const out = []
      for (const l of links) {
        if (!l.order_id || !pred(l) || seen.has(l.order_id)) continue
        seen.add(l.order_id)
        out.push(l)
      }
      return out
    }

    const changes = pick(l => l.displayStatus === 'changes_requested' || l.status === 'changes_requested')
    const waiting = pick(l => l.displayStatus === 'viewed' && !l.signed_at && l.viewed_at)
      .map(l => ({ l, days: Math.max(0, daysSince(l.viewed_at)) }))
      .sort((a, z) => z.days - a.days)
    const sent = pick(l => l.displayStatus === 'pending')
      .map(l => ({ l, date: fmtShortDate(l.created_at) }))
    const signed = pick(l => l.signed_at && daysSince(l.signed_at) <= 14)
      .sort((a, z) => String(z.signed_at).localeCompare(String(a.signed_at)))
      .map(l => ({ l, date: fmtShortDate(l.signed_at) }))
    return { changes, waiting, sent, signed }
  }, [links, today])

  const openOrder = (l) => onOpenJob({ orderId: l.order_id }, 'menu')

  // NUDGE: copy the share link (silent fallback) + open a pre-filled text.
  // Nothing is written anywhere, so no undo.
  const nudge = (l) => {
    const url = l.share_url || ''
    if (!url) return
    try {
      if (navigator.clipboard?.writeText) navigator.clipboard.writeText(url).catch(() => {})
    } catch { /* clipboard unavailable — the SMS body still carries the link */ }
    window.location.href = 'sms:?&body=' +
      encodeURIComponent('Just checking in — your layout is ready to review: ' + url)
  }

  const empty = groups &&
    !groups.changes.length && !groups.waiting.length && !groups.sent.length && !groups.signed.length

  return (
    <div>
      {onBack && (
        <button type="button" className="fl-rowline" onClick={onBack}
          style={{ color: '#9A7209', fontWeight: 700, fontSize: 15, minHeight: 44 }}>&#8249; Menu</button>
      )}
      <div style={{ margin: '4px 2px 14px' }}>
        <div className="fl-sect-h" style={{ fontSize: 26 }}>Approvals &amp; design</div>
        <div className="fl-greet-sub">Every proof out the door</div>
      </div>

      {err && <div className="fl-empty">{err}</div>}
      {!err && links === null && <div className="fl-empty">Loading approvals…</div>}
      {!err && empty && <div className="fl-empty-serif">No proofs in motion.</div>}

      {!err && groups && groups.changes.length > 0 && (
        <>
          <div className="fl-sect">
            <span className="fl-sect-h">Changes requested</span>
            <span className="fl-sect-pill" style={{ background: '#B3261E', color: '#fff' }}>{groups.changes.length}</span>
          </div>
          {groups.changes.map(l => (
            <div key={l.id} className="fl-needs" onClick={() => openOrder(l)} style={{ cursor: 'pointer' }}>
              <div className="fl-needs-text">
                {familyNameOf(l.order)} asked for edits.
                {notes[l.order_id] && (
                  <div style={NOTE_CLAMP}>&#8220;{notes[l.order_id]}&#8221;</div>
                )}
              </div>
              <button type="button" className="fl-verb"
                onClick={(e) => { e.stopPropagation(); openOrder(l) }}>OPEN</button>
            </div>
          ))}
        </>
      )}

      {!err && groups && groups.waiting.length > 0 && (
        <>
          <div className="fl-sect">
            <span className="fl-sect-h">Waiting</span>
            <span className="fl-sect-pill">{groups.waiting.length}</span>
          </div>
          {groups.waiting.map(({ l, days }) => (
            <div key={l.id} className="fl-row fl-row-flex" role="button" tabIndex={0}
              onClick={() => openOrder(l)}
              onKeyDown={(e) => { if (e.key === 'Enter') openOrder(l) }}>
              <div className="fl-row-main">
                <div className="fl-fam" style={{ fontSize: 15 }}>{familyNameOf(l.order)}</div>
                <div className="fl-cem" style={{ fontWeight: 500 }}>
                  Opened the proof {days === 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`}
                </div>
                {days >= 3 && (
                  <div className="fl-chips">
                    <span className="fl-chip fl-c-warn">NO ANSWER {days}D</span>
                  </div>
                )}
              </div>
              <button type="button" className="fl-verb"
                onClick={(e) => { e.stopPropagation(); nudge(l) }}>NUDGE</button>
            </div>
          ))}
        </>
      )}

      {!err && groups && groups.sent.length > 0 && (
        <>
          <div className="fl-sect">
            <span className="fl-sect-h">Sent</span>
            <span className="fl-sect-pill">{groups.sent.length}</span>
          </div>
          {groups.sent.map(({ l, date }) => (
            <button key={l.id} type="button" className="fl-row fl-row-flex" onClick={() => openOrder(l)}>
              <div className="fl-row-main">
                <div className="fl-fam" style={{ fontSize: 15 }}>{familyNameOf(l.order)}</div>
                {date && <div className="fl-spec">Sent {date}</div>}
                <div className="fl-chips">
                  {l.emailed_at
                    ? <span className="fl-chip fl-c-good">EMAILED</span>
                    : <span className="fl-chip fl-c-bad">NO EMAIL ON RECORD</span>}
                </div>
              </div>
              <span className="fl-chev">&#8250;</span>
            </button>
          ))}
        </>
      )}

      {!err && groups && groups.signed.length > 0 && (
        <>
          <div className="fl-sect">
            <span className="fl-sect-h">Signed</span>
            <span className="fl-sect-pill">{groups.signed.length}</span>
          </div>
          {groups.signed.map(({ l, date }) => (
            <button key={l.id} type="button" className="fl-rowline" onClick={() => openOrder(l)}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="fl-fam" style={{ fontSize: 14.5 }}>{familyNameOf(l.order)}</div>
              </div>
              <span className="fl-spec">Signed {date}</span>
              <span className="fl-chev">&#8250;</span>
            </button>
          ))}
        </>
      )}
    </div>
  )
}
