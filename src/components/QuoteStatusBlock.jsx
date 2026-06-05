// =============================================================================
// QuoteStatusBlock — the universal "Send to Quote Hub" control. Used on every
// order surface (OrderDetail, the Sales-wizard Saved view, CemeteryOrderDetail)
// so the button + status chip appear for EVERY order type. onSend returns
// { ok, error } (fail-loud); the chip reads the shared QUOTE_STATUS vocabulary.
// =============================================================================

import { useState } from 'react'
import { QUOTE_STATUS_LABEL, QUOTE_STATUS_TONE } from '../lib/stonebooksData'

export default function QuoteStatusBlock({ status, onSend, disabled, hint }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const s = status || 'draft'
  const canSend = !disabled && (s === 'draft' || s === 'needs_changes')
  const send = async () => {
    setBusy(true); setErr(null)
    const r = await onSend?.()
    setBusy(false)
    if (!r?.ok) setErr(r?.error || 'Could not send to the Quote Hub.')
  }
  return (
    <div className="qsb">
      <style>{QSB_CSS}</style>
      <span className="qsb-chip" style={{ color: QUOTE_STATUS_TONE[s], borderColor: QUOTE_STATUS_TONE[s], background: `${QUOTE_STATUS_TONE[s]}12` }}>
        {QUOTE_STATUS_LABEL[s]}
      </span>
      {canSend && (
        <button type="button" className="qsb-btn" onClick={send} disabled={busy}>
          {busy ? 'Sending…' : 'Send to Quote Hub for Final Approval'}
        </button>
      )}
      {disabled && hint && <div className="qsb-hint">{hint}</div>}
      {err && <div className="qsb-err">{err}</div>}
    </div>
  )
}

const QSB_CSS = `
  .qsb { display: flex; flex-direction: column; gap: 8px; align-items: flex-start; }
  .qsb-chip { font-size: 11px; font-weight: 700; border: 1px solid; border-radius: 999px; padding: 2px 10px; text-transform: uppercase; letter-spacing: 0.04em; }
  .qsb-btn { font: inherit; font-size: 13px; font-weight: 700; color: #1a1206; background: #9A7209; border: 1px solid #9A7209; border-radius: 8px; padding: 9px 16px; cursor: pointer; transition: background 0.15s; }
  .qsb-btn:hover:not(:disabled) { background: #b3870c; }
  .qsb-btn:disabled { opacity: 0.6; cursor: default; }
  .qsb-hint { font-size: 12px; color: #8a7f6c; }
  .qsb-err { font-size: 12px; color: #b3261e; }
`
