// =============================================================================
// CompletionEmailModal — the closeout task's one-button completion email
// =============================================================================
// Paul 2026-07-24: "in their task they can preview the ai generated email, make
// edits and send it... letting them know their order is complete, thank them,
// with the photo attached." The draft is auto-written from the order's real
// data (buildCompletionEmailDraft); every field is editable; NOTHING sends
// without the ConfirmSend gate (send-safety doctrine, TI-2026-001). Photos are
// the order's completion shots — all attached by default, un-checkable.
// =============================================================================
import { useState, useEffect } from 'react'
import {
  getOrderById, listCompletionPhotos, buildCompletionEmailDraft,
  sendShopEmail, addTaskReply, logOrderActivity, updateShopTask, getCurrentStaffName,
} from '../lib/stonebooksData'
import ConfirmSend from './ConfirmSend'

export default function CompletionEmailModal({ task, onClose, onChanged }) {
  const orderId = task?.order_id || task?.order?.id || null
  const [order, setOrder] = useState(undefined)   // undefined=loading, null=missing
  const [photos, setPhotos] = useState([])
  const [picked, setPicked] = useState(() => new Set())
  const [to, setTo] = useState('')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [gate, setGate] = useState(false)
  const [attachments, setAttachments] = useState(null)   // null until built for the gate
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [sentTo, setSentTo] = useState(task?.details?.completionEmailTo || null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const [o, ph] = await Promise.all([
        getOrderById(orderId),
        listCompletionPhotos(orderId),
      ])
      if (cancelled) return
      setOrder(o || null)
      setPhotos(ph || [])
      setPicked(new Set((ph || []).map(p => p.path)))
      if (o) {
        const draft = buildCompletionEmailDraft(o, o.customer)
        setTo(o.customer?.email || '')
        setSubject(draft.subject)
        setBody(draft.body)
      }
    })()
    return () => { cancelled = true }
  }, [orderId])

  const togglePhoto = (p) => setPicked(prev => {
    const n = new Set(prev)
    if (n.has(p.path)) n.delete(p.path); else n.add(p.path)
    return n
  })

  // Build attachments, then open the gate — the preview IS the send surface.
  // Photos go as URL REFS: the email API fetches them from our storage
  // server-side, so full-size photos never hit the request-body cap.
  const openGate = async () => {
    setErr(null)
    const chosen = photos.filter(p => picked.has(p.path))
    setAttachments(chosen.map(p => ({ filename: p.name, url: p.url })))
    setGate(true)
  }

  const doSend = async (edited) => {
    setBusy(true); setErr(null)
    // The gate's preview is editable — typed-over words win.
    const r = await sendShopEmail({
      to: to.trim(), subject, text: edited?.text || body, attachments: attachments || [],
      orderId, customerId: order?.customer_id || order?.customer?.id || null,
    })
    if (!r?.ok) { setBusy(false); setErr(r?.error || 'Send failed.'); setGate(false); return }
    const me = await getCurrentStaffName().catch(() => null)
    const n = (attachments || []).length
    await addTaskReply(task.id, `Completion email sent to ${to.trim()}${n ? ` — ${n} photo${n === 1 ? '' : 's'} attached` : ''}.`, me || 'Staff').catch(() => {})
    await logOrderActivity(orderId, { type: 'change', field: 'Completion email', newValue: 'Sent', note: `Sent to ${to.trim()}`, actor: me }).catch(() => {})
    await updateShopTask(task.id, {
      details: { ...(task.details || {}), completionEmailSentAt: new Date().toISOString(), completionEmailTo: to.trim() },
    }).catch(() => {})
    setBusy(false); setGate(false); setSentTo(to.trim())
    onChanged?.()
  }

  return (
    <div className="sb-cem-scrim" onClick={onClose}>
      <div className="sb-cem" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()}>
        <div className="sb-cem-title">Completion email</div>
        {order === undefined && <div className="sb-cem-note">Loading the order…</div>}
        {order === null && <div className="sb-cem-note">This task isn't linked to an order — link it first, then send from here.</div>}

        {order && sentTo && (
          <div className="sb-cem-sent">Sent to {sentTo}{task?.details?.completionEmailSentAt ? '' : ''} — sending again is allowed, but check the thread first.</div>
        )}

        {order && (
          <>
            {!to.trim() && (
              <div className="sb-cem-warn">No email on the customer card — type one here or add it on the order first.</div>
            )}
            <label className="sb-cem-l">To
              <input className="sb-cem-in" value={to} onChange={e => setTo(e.target.value)} placeholder="customer@email.com" />
            </label>
            <label className="sb-cem-l">Subject
              <input className="sb-cem-in" value={subject} onChange={e => setSubject(e.target.value)} />
            </label>
            <label className="sb-cem-l">Message
              <textarea className="sb-cem-in sb-cem-body" rows={9} value={body} onChange={e => setBody(e.target.value)} />
            </label>

            <div className="sb-cem-l" style={{ display: 'block' }}>Photos attached
              {photos.length === 0 && (
                <div className="sb-cem-note">No completion photos on the order yet — the crew adds them when marking installed.</div>
              )}
              {photos.length > 0 && (
                <div className="sb-cem-photos">
                  {photos.map(p => (
                    <button key={p.path} type="button"
                      className={`sb-cem-ph${picked.has(p.path) ? ' on' : ''}`}
                      onClick={() => togglePhoto(p)} title={picked.has(p.path) ? 'Attached — click to remove' : 'Click to attach'}>
                      <img src={p.url} alt={p.name} loading="lazy" />
                    </button>
                  ))}
                </div>
              )}
            </div>

            {err && <div className="sb-cem-warn">{err}</div>}
            <div className="sb-cem-actions">
              <button type="button" className="sb-cem-cancel" onClick={onClose} disabled={busy}>Close</button>
              <button type="button" className="sb-cem-go" disabled={busy || !to.trim() || !body.trim()} onClick={openGate}>
                {busy ? 'Preparing…' : 'Preview + send'}
              </button>
            </div>
          </>
        )}
      </div>

      <ConfirmSend open={gate} to={to.trim()} subject={subject} text={body}
        busy={busy} onConfirm={doSend} onClose={() => setGate(false)} />
      <style>{CSS}</style>
    </div>
  )
}

const CSS = `
  .sb-cem-scrim { position: fixed; inset: 0; background: rgba(15,20,25,0.5); z-index: 1200; display: flex; align-items: center; justify-content: center; padding: 20px; }
  .sb-cem { background: #fff; border-radius: 12px; width: 100%; max-width: 560px; max-height: 90vh; overflow-y: auto; padding: 20px 22px; }
  .sb-cem-title { font-size: 17px; font-weight: 800; margin-bottom: 10px; }
  .sb-cem-l { display: block; font-size: 11.5px; font-weight: 700; color: #6B6456; margin: 10px 0 0; }
  .sb-cem-in { display: block; width: 100%; margin-top: 4px; border: 1px solid #D9D2C0; border-radius: 8px; padding: 8px 10px; font: inherit; font-size: 13.5px; }
  .sb-cem-body { resize: vertical; line-height: 1.5; }
  .sb-cem-photos { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 6px; }
  .sb-cem-ph { border: 2px solid #D9D2C0; border-radius: 10px; padding: 0; background: none; cursor: pointer; opacity: 0.45; }
  .sb-cem-ph.on { border-color: #1f7a3d; opacity: 1; }
  .sb-cem-ph img { width: 74px; height: 74px; object-fit: cover; border-radius: 8px; display: block; }
  .sb-cem-warn { background: rgba(179,38,30,0.08); color: #B3261E; font-size: 12.5px; border-radius: 8px; padding: 8px 10px; margin-top: 10px; }
  .sb-cem-sent { background: rgba(31,122,61,0.10); color: #1f7a3d; font-size: 12.5px; font-weight: 700; border-radius: 8px; padding: 8px 10px; margin-bottom: 4px; }
  .sb-cem-note { font-size: 12.5px; color: #6B6456; margin-top: 6px; }
  .sb-cem-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 16px; }
  .sb-cem-cancel { background: none; border: 1px solid #D9D2C0; border-radius: 8px; padding: 8px 14px; font: inherit; cursor: pointer; }
  .sb-cem-go { background: #16150F; color: #C9A468; border: none; border-radius: 8px; padding: 8px 16px; font: inherit; font-weight: 800; cursor: pointer; }
  .sb-cem-go:disabled { opacity: 0.5; cursor: default; }
`
