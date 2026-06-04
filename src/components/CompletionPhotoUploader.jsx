// =============================================================================
// 📚 Stonebooks — Completion photo uploader (ITEM 4)
// =============================================================================
// Opens right after a field/production task is marked complete. Lets the crew
// attach one or more job-site photos (install / repair / acid wash / etc.).
// Uploads land in orders-attachments-public under <order_id>/completion/ via
// uploadCompletionPhoto — the same files then surface on the Order record's
// "Completion photos" section (listCompletionPhotos), so nothing is lost on
// navigation. The task is already complete before this opens; photos are
// optional and "Done" closes without blocking anything.
// =============================================================================

import { useEffect, useRef, useState } from 'react'
import { uploadCompletionPhoto, listCompletionPhotos } from '../lib/stonebooksData'

export default function CompletionPhotoUploader({ orderId, label, onClose, onUploaded }) {
  const [photos, setPhotos] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const fileRef = useRef(null)

  // Initial load — set state from inside the async .then (not synchronously in
  // the effect body) with a cancelled guard, matching the OrderDetail pattern.
  useEffect(() => {
    let cancelled = false
    listCompletionPhotos(orderId).then(rows => { if (!cancelled) setPhotos(rows) })
    return () => { cancelled = true }
  }, [orderId])

  const handleFiles = async (fileList) => {
    const files = Array.from(fileList || [])
    if (files.length === 0) return
    setBusy(true)
    setError(null)
    const errs = []
    let any = false
    for (const f of files) {
      const res = await uploadCompletionPhoto(orderId, f)
      if (!res.ok) errs.push(res.error || f.name)
      else any = true
    }
    setBusy(false)
    if (errs.length) setError(`Some photos failed: ${errs.join(', ')}`)
    setPhotos(await listCompletionPhotos(orderId))   // event-handler context — safe
    if (any) onUploaded?.()
    if (fileRef.current) fileRef.current.value = ''
  }

  return (
    <div className="sb-cpu-backdrop" onClick={() => { if (!busy) onClose?.() }}>
      <div
        className="sb-cpu"
        role="dialog"
        aria-modal="true"
        aria-label="Add completion photos"
        onClick={e => e.stopPropagation()}
      >
        <h3 className="sb-cpu-title">Add completion photos</h3>
        <p className="sb-cpu-sub">
          {label ? <>For {label}. </> : null}
          Attach photos of the finished work — they save to the order record. Optional.
        </p>

        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          capture="environment"
          className="sb-cpu-input"
          onChange={e => handleFiles(e.target.files)}
        />

        <button
          type="button"
          className="sb-cpu-add"
          onClick={() => fileRef.current?.click()}
          disabled={busy}
        >
          {busy ? 'Uploading…' : '+ Add photos'}
        </button>

        {error && <div className="sb-cpu-error">{error}</div>}

        {photos.length > 0 && (
          <div className="sb-cpu-grid">
            {photos.map(p => (
              <a key={p.path} className="sb-cpu-thumb" href={p.url} target="_blank" rel="noreferrer" title={p.name}>
                <img src={p.url} alt={p.name} loading="lazy" />
              </a>
            ))}
          </div>
        )}

        <div className="sb-cpu-actions">
          <button type="button" className="sb-cpu-done" onClick={() => onClose?.()} disabled={busy}>
            Done
          </button>
        </div>
      </div>
    </div>
  )
}

const localStyles = `
  .sb-cpu-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(15, 20, 25, 0.42);
    z-index: 1100;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
  }
  .sb-cpu {
    background: var(--sb-surface);
    border-radius: var(--sb-r-md, 10px);
    box-shadow: 0 16px 48px rgba(15, 20, 25, 0.24);
    max-width: 520px;
    width: 100%;
    padding: 28px 32px 24px;
    max-height: 86vh;
    overflow-y: auto;
  }
  .sb-cpu-title {
    font-size: 18px;
    font-weight: 500;
    color: var(--sb-text);
    margin: 0 0 8px;
    letter-spacing: -0.005em;
  }
  .sb-cpu-sub {
    font-size: 13px;
    line-height: 1.5;
    color: var(--sb-text-secondary);
    margin: 0 0 16px;
  }
  .sb-cpu-input { display: none; }
  .sb-cpu-add {
    font: inherit;
    font-size: 14px;
    font-weight: 500;
    padding: 9px 18px;
    border-radius: var(--sb-r-sm, 6px);
    border: 0.5px solid transparent;
    background: var(--sb-accent, #b8842a);
    color: #fff;
    cursor: pointer;
  }
  .sb-cpu-add:hover:not(:disabled) { filter: brightness(0.95); }
  .sb-cpu-add:disabled { opacity: 0.6; cursor: not-allowed; }
  .sb-cpu-error {
    color: var(--sb-red, #b54040);
    font-size: 13px;
    padding: 8px 10px;
    margin-top: 14px;
    background: var(--sb-red-bg, #fbe5e5);
    border-radius: var(--sb-r-sm, 6px);
  }
  .sb-cpu-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(92px, 1fr));
    gap: 8px;
    margin-top: 18px;
  }
  .sb-cpu-thumb {
    display: block;
    aspect-ratio: 1 / 1;
    border-radius: var(--sb-r-sm, 6px);
    overflow: hidden;
    border: 0.5px solid var(--sb-border);
    background: var(--sb-surface-muted);
  }
  .sb-cpu-thumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
  .sb-cpu-actions {
    display: flex;
    justify-content: flex-end;
    margin-top: 22px;
  }
  .sb-cpu-done {
    font: inherit;
    font-size: 14px;
    font-weight: 500;
    padding: 8px 22px;
    border-radius: var(--sb-r-sm, 6px);
    border: 0.5px solid var(--sb-border);
    background: var(--sb-surface);
    color: var(--sb-text);
    cursor: pointer;
  }
  .sb-cpu-done:hover:not(:disabled) { background: var(--sb-surface-muted); }
  .sb-cpu-done:disabled { opacity: 0.6; cursor: not-allowed; }
`

if (typeof document !== 'undefined' && !document.getElementById('sb-cpu-styles')) {
  const tag = document.createElement('style')
  tag.id = 'sb-cpu-styles'
  tag.textContent = localStyles
  document.head.appendChild(tag)
}
