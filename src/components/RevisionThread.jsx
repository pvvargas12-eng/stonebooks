// =============================================================================
// RevisionThread — full customer-revision thread for an order (shared).
// =============================================================================
// Renders every change request for the order (newest first) with the version it
// was against ("re: vN") + timestamp, plus staff replies inline. Each revision
// has a Reply action: the reply is logged to the order timeline (shows in the
// thread) AND opens a prefilled mailto: draft — it is NOT auto-sent (server-side
// email is the future Gmail integration). Self-gating: renders nothing unless the
// order actually has change-request history (approval_links rows OR internal
// request-changes job_events). Used by the Design hub preview pane AND the Design
// packet — one component, one data path (getChangeRequestThread). Stops click
// propagation because host surfaces use the container as a click target.
// =============================================================================

import { useState, useEffect } from 'react'
import { getChangeRequestThread, logRevisionReply, getCurrentStaffName, fmtDate } from '../lib/stonebooksData'

export default function RevisionThread({ order, jobId }) {
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
