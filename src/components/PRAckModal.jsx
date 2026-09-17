// =============================================================================
// PRAckModal — vendor order acknowledgement: upload, compare, confirm (PR-ACK)
// =============================================================================
// Paul 2026-09-17: "they send us an order acknowledgement i need to be able to
// upload the order acknowledgement and compare it and confirm they have the
// right data before its official."
//
// Flow: upload the vendor's ack (PDF/image) → it opens beside the PR's own
// lines → the operator ticks MATCHES on every line while reading the ack →
// Confirm stamps ack_confirmed_at/by, and a SUBMITTED PR flips to Ordered
// (the official state). The ticks are the comparison ritual, not stored —
// the confirm stamp is the record. Remove confirmation to redo it after a
// revised ack.
// =============================================================================
import { useState, useEffect } from 'react'
import {
  getBulkOrderWithItems, updatePRHeader, uploadPRAckFile,
  markBulkOrderStatus, getCurrentStaffName,
} from '../lib/stonebooksData'

const specOf = (it) => it.spec_text || it.specs
  || [it.top && `Top: ${it.top}`, it.sides && `Sides: ${it.sides}`].filter(Boolean).join(' · ')
  || ''

export default function PRAckModal({ pr, onClose, onSaved }) {
  const [order, setOrder] = useState(pr)
  const [items, setItems] = useState(null)
  const [checked, setChecked] = useState(new Set())
  const [note, setNote] = useState(pr.ack_note || '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  useEffect(() => {
    let cancelled = false
    getBulkOrderWithItems(pr.id).then(r => {
      if (cancelled) return
      if (!r.ok) { setErr(r.error); setItems([]); return }
      setOrder(r.order || pr)
      setItems(r.items || [])
      setNote((r.order?.ack_note ?? pr.ack_note) || '')
    })
    return () => { cancelled = true }
  }, [pr])

  const confirmed = !!order.ack_confirmed_at
  const hasFile = !!order.ack_file_url
  const allChecked = (items || []).length > 0 && (items || []).every(it => checked.has(it.id))
  const toggle = (id) => setChecked(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })

  const upload = async (file) => {
    if (!file || busy) return
    setBusy(true); setErr(null)
    const up = await uploadPRAckFile(pr.id, file)
    if (!up.ok) { setBusy(false); setErr(up.error); return }
    const by = await getCurrentStaffName()
    const stamp = new Date().toISOString()
    const r = await updatePRHeader(pr.id, {
      ack_file_url: up.url, ack_file_name: up.name,
      ack_uploaded_at: stamp, ack_uploaded_by: by,
      // A replacement ack resets the confirmation — compare again.
      ack_confirmed_at: null, ack_confirmed_by: null,
    })
    setBusy(false)
    if (!r.ok) { setErr(r.error); return }
    setOrder(o => ({ ...o, ack_file_url: up.url, ack_file_name: up.name, ack_uploaded_at: stamp, ack_confirmed_at: null, ack_confirmed_by: null }))
    setChecked(new Set())
  }

  const confirmAck = async () => {
    if (!hasFile || !allChecked || busy) return
    setBusy(true); setErr(null)
    const by = await getCurrentStaffName()
    const stamp = new Date().toISOString()
    const r = await updatePRHeader(pr.id, { ack_confirmed_at: stamp, ack_confirmed_by: by, ack_note: note })
    if (r.ok && order.status === 'submitted' && !order.received_at) {
      await markBulkOrderStatus(pr.id, 'ordered')
    }
    setBusy(false)
    if (!r.ok) { setErr(r.error); return }
    onSaved?.()
  }

  const unconfirm = async () => {
    if (busy) return
    setBusy(true); setErr(null)
    const r = await updatePRHeader(pr.id, { ack_confirmed_at: null, ack_confirmed_by: null })
    setBusy(false)
    if (!r.ok) { setErr(r.error); return }
    setOrder(o => ({ ...o, ack_confirmed_at: null, ack_confirmed_by: null }))
    setChecked(new Set())
  }

  return (
    <div className="prack-scrim" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <style>{CSS}</style>
      <div className="prack" role="dialog" aria-label="Order acknowledgement">
        <div className="prack-head">
          <div>
            <div className="prack-eyebrow">ORDER ACKNOWLEDGEMENT</div>
            <div className="prack-title">{order.po_number || 'PR'} <span className="prack-sup">{order.supplier_name}</span></div>
            {confirmed
              ? <div className="prack-stamp ok">Confirmed {new Date(order.ack_confirmed_at).toLocaleDateString()} by {order.ack_confirmed_by || '—'} — this PR is official.</div>
              : <div className="prack-stamp">Not confirmed yet — the PR isn't official until the vendor's data checks out.</div>}
          </div>
          <button type="button" className="prack-x" onClick={onClose} aria-label="Close">×</button>
        </div>

        {err && <div className="prack-err">{err}</div>}

        <div className="prack-filebar">
          {hasFile ? (
            <>
              <a className="prack-filelink" href={order.ack_file_url} target="_blank" rel="noreferrer">
                Open acknowledgement — {order.ack_file_name || 'file'}
              </a>
              <label className="prack-upl">
                Replace
                <input type="file" accept=".pdf,image/*,.eml,.msg" hidden disabled={busy}
                  onChange={e => { upload(e.target.files?.[0]); e.target.value = '' }} />
              </label>
            </>
          ) : (
            <label className="prack-upl big">
              {busy ? 'Uploading…' : 'Upload the vendor’s acknowledgement (PDF or photo)'}
              <input type="file" accept=".pdf,image/*,.eml,.msg" hidden disabled={busy}
                onChange={e => { upload(e.target.files?.[0]); e.target.value = '' }} />
            </label>
          )}
        </div>

        <div className="prack-hint">
          Open the acknowledgement, then tick MATCHES on every line as you verify the vendor has it right —
          color, size, specs, quantity.
        </div>

        {items === null ? (
          <div className="prack-empty">Loading lines…</div>
        ) : items.length === 0 ? (
          <div className="prack-empty">This PR has no line items.</div>
        ) : (
          <table className="prack-table">
            <thead><tr><th>Family</th><th>Color</th><th>Type</th><th>Size</th><th>Specs</th><th className="n">Qty</th><th className="n">Matches</th></tr></thead>
            <tbody>
              {items.map(it => (
                <tr key={it.id} className={checked.has(it.id) ? 'ok' : ''}>
                  <td className="fam">{it.family_name || (it.is_stock ? 'STOCK' : '—')}</td>
                  <td>{it.color || '—'}</td>
                  <td>{it.item_type || '—'}</td>
                  <td>{it.size || '—'}</td>
                  <td className="spec">{specOf(it) || '—'}</td>
                  <td className="n">{it.quantity ?? 1}</td>
                  <td className="n">
                    <button type="button" className={`prack-tick${checked.has(it.id) ? ' on' : ''}`}
                      disabled={confirmed} onClick={() => toggle(it.id)}>
                      {checked.has(it.id) ? 'MATCHES' : 'Check'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <label className="prack-notewrap">
          <span className="prack-notelabel">Ack notes — anything the vendor changed or flagged</span>
          <input className="prack-note" type="text" value={note} disabled={confirmed}
            placeholder="e.g. ETA pushed to 11/2, base ships separately"
            onChange={e => setNote(e.target.value)} />
        </label>

        <div className="prack-actions">
          {confirmed ? (
            <>
              <div className="prack-actionhint">Vendor sent a revised ack? Upload it above — replacing the file reopens the comparison.</div>
              <button type="button" className="prack-btn ghost" onClick={unconfirm} disabled={busy}>Remove confirmation</button>
            </>
          ) : (
            <>
              <div className="prack-actionhint">
                {!hasFile ? 'Upload the acknowledgement first.'
                  : !allChecked ? `Tick every line — ${(items || []).filter(it => checked.has(it.id)).length}/${(items || []).length} checked.`
                  : order.status === 'submitted' ? 'All lines verified — confirming marks this PR Ordered.' : 'All lines verified.'}
              </div>
              <button type="button" className="prack-btn ghost" onClick={onClose} disabled={busy}>Close</button>
              <button type="button" className="prack-btn go" onClick={confirmAck} disabled={busy || !hasFile || !allChecked}>
                {busy ? 'Saving…' : 'Confirm — data matches'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

const CSS = `
  .prack-scrim { position: fixed; inset: 0; background: rgba(15,20,25,0.5); z-index: 1300;
    display: flex; align-items: flex-start; justify-content: center; padding: 6vh 16px 16px; overflow-y: auto; }
  .prack { background: #fff; border: 0.5px solid #E2D8C6; border-radius: 14px; padding: 18px 20px;
    width: 100%; max-width: 760px; box-shadow: 0 18px 50px rgba(15,20,25,0.25); }
  .prack-head { display: flex; justify-content: space-between; gap: 12px; margin-bottom: 10px; }
  .prack-eyebrow { font-size: 10.5px; font-weight: 800; letter-spacing: 0.11em; color: #9A7209; }
  .prack-title { font-size: 17px; font-weight: 800; color: #0F1419; margin-top: 2px; font-family: var(--font-m, 'JetBrains Mono'), monospace; }
  .prack-sup { font-family: var(--sb-font-sans, Inter), sans-serif; font-weight: 700; color: #6B6456; margin-left: 8px; font-size: 14px; }
  .prack-stamp { font-size: 12px; color: #8a5a12; margin-top: 3px; }
  .prack-stamp.ok { color: #15724a; font-weight: 600; }
  .prack-x { font: inherit; font-size: 22px; line-height: 1; background: none; border: none; color: #8a8a85; cursor: pointer; padding: 2px 6px; }
  .prack-err { font-size: 12.5px; color: #B3261E; background: rgba(179,38,30,0.08); border-radius: 8px; padding: 7px 10px; margin-bottom: 10px; }
  .prack-filebar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 8px; }
  .prack-filelink { font-size: 13.5px; font-weight: 700; color: #1D6FA8; }
  .prack-upl { font-size: 12px; font-weight: 700; color: #9A7209; border: 0.5px solid #C9A468; border-radius: 999px;
    padding: 4px 12px; cursor: pointer; }
  .prack-upl:hover { background: #9A7209; border-color: #9A7209; color: #fff; }
  .prack-upl.big { font-size: 13.5px; padding: 12px 18px; border-style: dashed; border-radius: 10px; display: block; text-align: center; width: 100%; box-sizing: border-box; }
  .prack-hint { font-size: 12.5px; color: #6B6456; margin-bottom: 10px; }
  .prack-empty { font-size: 13px; color: #8a8a85; background: #FBFAF7; border: 0.5px dashed #E2D8C6; border-radius: 10px; padding: 12px 14px; margin-bottom: 10px; }
  .prack-table { width: 100%; border-collapse: collapse; font-size: 13px; margin-bottom: 12px; }
  .prack-table th { text-align: left; font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em;
    color: #8a8a85; padding: 7px 8px; border-bottom: 1px solid #E2D8C6; }
  .prack-table td { padding: 7px 8px; border-bottom: 0.5px solid #f0ece2; vertical-align: top; }
  .prack-table tr.ok td { background: rgba(29,158,117,0.06); }
  .prack-table .n { text-align: center; }
  .prack-table .fam { font-weight: 700; }
  .prack-table .spec { color: #6B6456; font-size: 12px; max-width: 220px; }
  .prack-tick { font: inherit; font-size: 10.5px; font-weight: 800; letter-spacing: 0.04em; border-radius: 999px;
    padding: 3px 11px; border: 0.5px solid #E2D8C6; background: #fff; color: #6a6a66; cursor: pointer; white-space: nowrap; }
  .prack-tick:hover { border-color: #1D9E75; color: #15724a; }
  .prack-tick.on { background: #1D9E75; border-color: #1D9E75; color: #fff; }
  .prack-tick:disabled { opacity: 0.55; cursor: default; }
  .prack-notewrap { display: block; margin-bottom: 12px; }
  .prack-notelabel { display: block; font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: #8a8a85; margin-bottom: 4px; }
  .prack-note { width: 100%; font: inherit; font-size: 13px; padding: 8px 11px; border-radius: 9px; border: 0.5px solid #E2D8C6; box-sizing: border-box; }
  .prack-actions { display: flex; align-items: center; gap: 10px; }
  .prack-actionhint { font-size: 12px; color: #8a8a85; margin-right: auto; }
  .prack-btn { font: inherit; font-size: 13px; font-weight: 700; padding: 8px 16px; border-radius: 9px;
    border: 0.5px solid #E2D8C6; background: #fff; cursor: pointer; white-space: nowrap; }
  .prack-btn:disabled { opacity: 0.5; cursor: default; }
  .prack-btn.ghost { color: #8a8a85; border-color: transparent; }
  .prack-btn.go { background: #1D9E75; border-color: #1D9E75; color: #fff; }
  .prack-btn.go:not(:disabled):hover { background: #15724a; }
`
