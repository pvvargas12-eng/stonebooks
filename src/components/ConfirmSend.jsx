// =============================================================================
// ConfirmSend — the send-safety gate (SEND-1, Paul 2026-07-21)
// =============================================================================
// "For anything that's sent to customer I want a confirmation before sending
// with option to preview the email... send is very sensitive." A worker
// one-click sent an invoice she didn't mean to. This modal shows EXACTLY what
// will go out — recipient, subject, the rendered email — and nothing sends
// until the explicit gold button is pressed. viewOnly mode reuses the same
// surface as a pure preview (no send button at all).
// The html is our own composed markup rendered in a sandboxed iframe.
// =============================================================================
import { useMemo } from 'react'

export default function ConfirmSend({
  open, to, subject, html, text,
  onConfirm, onClose, busy = false,
  viewOnly = false,
  confirmLabel,
  warning = 'This goes OUT to the recipient the moment you press send.',
}) {
  const srcDoc = useMemo(() => {
    const body = html || `<pre style="font-family:Arial,sans-serif;white-space:pre-wrap">${(text || '').replace(/</g, '&lt;')}</pre>`
    return `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:14px;background:#fff">${body}</body></html>`
  }, [html, text])

  if (!open) return null
  return (
    <div className="sb-csend-scrim" onClick={onClose}>
      <div className="sb-csend" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()}>
        <div className="sb-csend-head">
          <div className="sb-csend-title">{viewOnly ? 'Email preview' : 'Confirm before sending'}</div>
          {!viewOnly && <div className="sb-csend-warn">{warning}</div>}
        </div>
        <div className="sb-csend-meta">
          <div><span className="sb-csend-label">To</span><b>{to || '—'}</b></div>
          <div><span className="sb-csend-label">Subject</span>{subject || '—'}</div>
        </div>
        <iframe className="sb-csend-frame" title="Email preview" sandbox="" srcDoc={srcDoc} />
        <div className="sb-csend-actions">
          <button type="button" className="sb-csend-cancel" onClick={onClose} disabled={busy}>
            {viewOnly ? 'Close' : 'Cancel — do not send'}
          </button>
          {!viewOnly && (
            <button type="button" className="sb-csend-go" onClick={onConfirm} disabled={busy || !to}>
              {busy ? 'Sending…' : (confirmLabel || `Send to ${to}`)}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

const localStyles = `
  .sb-csend-scrim {
    position: fixed; inset: 0; background: rgba(15,20,25,0.5); z-index: 1300;
    display: flex; align-items: center; justify-content: center; padding: 20px;
  }
  .sb-csend {
    background: #fff; border-radius: 12px; width: 100%; max-width: 640px;
    max-height: 88vh; display: flex; flex-direction: column;
    box-shadow: 0 20px 60px rgba(15,20,25,0.35); overflow: hidden;
  }
  .sb-csend-head { padding: 16px 20px 10px; }
  .sb-csend-title { font-size: 16px; font-weight: 700; color: #1c1c1c; }
  .sb-csend-warn { font-size: 12.5px; color: #854F0B; margin-top: 3px; }
  .sb-csend-meta {
    padding: 0 20px 10px; font-size: 13px; color: #2C2C2A;
    display: flex; flex-direction: column; gap: 3px;
  }
  .sb-csend-label { display: inline-block; min-width: 58px; color: #888780; }
  .sb-csend-frame {
    border: none; border-top: 0.5px solid #DCD7CB; border-bottom: 0.5px solid #DCD7CB;
    width: 100%; flex: 1; min-height: 260px; background: #fff;
  }
  .sb-csend-actions { display: flex; justify-content: flex-end; gap: 10px; padding: 14px 20px; }
  .sb-csend-cancel {
    font: inherit; font-size: 13.5px; font-weight: 600; padding: 9px 16px; cursor: pointer;
    border: 0.5px solid #C9C3B4; border-radius: 8px; background: #fff; color: #2C2C2A;
  }
  .sb-csend-cancel:hover { border-color: #9A7209; }
  .sb-csend-go {
    font: inherit; font-size: 13.5px; font-weight: 700; padding: 9px 18px; cursor: pointer;
    border: none; border-radius: 8px; background: #9A7209; color: #fff;
  }
  .sb-csend-go:hover:not(:disabled) { background: #7d5d07; }
  .sb-csend-go:disabled, .sb-csend-cancel:disabled { opacity: 0.55; cursor: not-allowed; }
`
if (typeof document !== 'undefined' && !document.getElementById('sb-csend-styles')) {
  const tag = document.createElement('style')
  tag.id = 'sb-csend-styles'
  tag.textContent = localStyles
  document.head.appendChild(tag)
}
