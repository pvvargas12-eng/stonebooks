// =============================================================================
// AttachmentPreviewModal (#3) — in-app preview for any order attachment.
// =============================================================================
// Images render inline, PDFs in an embedded <iframe> viewer, everything else
// falls back to a download prompt. Always offers a Download button. No new
// browser tab — the preview stays in-app. Self-contained inline styles so it
// works in both OrderDetail and the wizard without depending on a stylesheet.
//
// `attachment` shape: { url, name, mime?, isBlob? }. Pass null to close. The
// CALLER owns blob-URL lifecycle (revoke on close) — see closePreview helpers.
// =============================================================================

import { useEffect } from 'react'

const IMG_RE = /\.(jpe?g|png|gif|webp|svg|bmp|avif)(\?|#|$)/i
const PDF_RE = /\.pdf(\?|#|$)/i

function inferType(name = '', mime = '', url = '') {
  if (mime.startsWith('image/')) return 'image'
  if (mime === 'application/pdf') return 'pdf'
  if (IMG_RE.test(name) || IMG_RE.test(url)) return 'image'
  if (PDF_RE.test(name) || PDF_RE.test(url)) return 'pdf'
  return 'other'
}

export default function AttachmentPreviewModal({ attachment, onClose }) {
  useEffect(() => {
    if (!attachment) return
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [attachment, onClose])

  if (!attachment) return null
  const { url, name, mime } = attachment
  const type = inferType(name || '', mime || '', url || '')

  return (
    <div style={S.backdrop} onClick={onClose}>
      <div style={S.modal} onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={`Preview ${name || 'attachment'}`}>
        <div style={S.head}>
          <span style={S.title} title={name}>{name || 'Attachment'}</span>
          <div style={S.actions}>
            <a style={S.download} href={url} download={name || undefined} rel="noreferrer">Download</a>
            <button type="button" style={S.close} onClick={onClose} aria-label="Close preview">×</button>
          </div>
        </div>
        <div style={S.body}>
          {type === 'image' && <img src={url} alt={name || 'attachment'} style={S.img} />}
          {type === 'pdf' && <iframe title={name || 'PDF preview'} src={url} style={S.iframe} />}
          {type === 'other' && (
            <div style={S.fallback}>
              <p style={{ margin: '0 0 12px' }}>This file type can’t be previewed in-app.</p>
              <a style={S.download} href={url} download={name || undefined} rel="noreferrer">Download to view</a>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

const S = {
  backdrop: {
    position: 'fixed', inset: 0, background: 'rgba(15,20,25,0.66)', zIndex: 9000,
    display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
  },
  modal: {
    background: '#fff', borderRadius: 10, width: 'min(960px, 96vw)', height: 'min(90vh, 1100px)',
    display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 20px 60px rgba(0,0,0,0.4)',
  },
  head: {
    display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px',
    borderBottom: '1px solid #e7e2d6', background: '#faf8f3',
  },
  title: { fontWeight: 700, fontSize: 14, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  actions: { display: 'flex', alignItems: 'center', gap: 10 },
  download: {
    border: '1px solid #9a7209', color: '#9a7209', background: '#fff', borderRadius: 6,
    padding: '5px 12px', cursor: 'pointer', fontWeight: 600, fontSize: 13, textDecoration: 'none',
  },
  close: { border: 'none', background: 'none', fontSize: 24, lineHeight: 1, cursor: 'pointer', color: '#555', padding: '0 4px' },
  body: { flex: 1, overflow: 'auto', background: '#f1efe9', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  img: { maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', display: 'block' },
  iframe: { width: '100%', height: '100%', border: 'none', background: '#fff' },
  fallback: { textAlign: 'center', color: '#555', fontSize: 14, padding: 40 },
}
