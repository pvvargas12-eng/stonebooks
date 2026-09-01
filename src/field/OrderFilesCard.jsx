// =============================================================================
// OrderFilesCard — the order's files & photos, on the phone
// =============================================================================
// Paul 2026-09-01: "upload photos to customer order... pull up customer
// attachments like contracts and stuff like that and have option to view
// attachments... when you upload photos those always go in the attachments."
// One home: everything reads/writes the SAME storage the desktop Attachments
// section uses (listOrderAttachments merges general uploads + completion
// photos), plus the pinned signed contract/approval from the private bucket.
// Money doctrine: crew builds see PHOTOS only — documents (contracts,
// estimates, permits carry prices) render when showMoney.
// =============================================================================
import { useState, useEffect, useCallback, useRef } from 'react'
import {
  listOrderAttachments, uploadOrderAttachment, deleteOrderAttachment,
  getSignedContract, signedContractFileUrl, getApprovalSigned, approvalSignedFileUrl,
} from '../lib/stonebooksData'

const IMG_RE = /\.(jpe?g|png|gif|heic|heif|webp|bmp)$/i

export default function OrderFilesCard({ orderId, showMoney = false, undo }) {
  const [rows, setRows] = useState(undefined)          // undefined=loading
  const [pins, setPins] = useState({ contract: null, approval: null })
  const [busy, setBusy] = useState(false)
  const [zoomUrl, setZoomUrl] = useState(null)
  const camRef = useRef(null)
  const libRef = useRef(null)

  const reload = useCallback(async () => {
    const [atts, contract, approval] = await Promise.all([
      listOrderAttachments(orderId).catch(() => []),
      showMoney ? getSignedContract(orderId).catch(() => null) : null,
      showMoney ? getApprovalSigned(orderId).catch(() => null) : null,
    ])
    setRows(atts || [])
    setPins({ contract, approval })
  }, [orderId, showMoney])
  useEffect(() => { if (orderId) reload() }, [orderId, reload])

  const onPick = async (e) => {
    const files = [...(e.target.files || [])]
    e.target.value = ''
    if (!files.length) return
    setBusy(true)
    const uploaded = []
    let failed = null
    for (const f of files) {
      const up = await uploadOrderAttachment(orderId, f)
      if (up.ok) uploaded.push(up)
      else { failed = up.error || 'Upload failed.'; break }
    }
    setBusy(false)
    await reload()
    if (failed) { undo?.showError(failed); return }
    if (uploaded.length) {
      undo?.show(`${uploaded.length} ${uploaded.length === 1 ? 'file' : 'files'} added to the order`, async () => {
        for (const u of uploaded) await deleteOrderAttachment(u.path)
        await reload()
      })
    }
  }

  const openPin = async (kind) => {
    const res = kind === 'contract'
      ? await signedContractFileUrl(orderId)
      : await approvalSignedFileUrl(orderId)
    if (res.ok) window.open(res.url, '_blank', 'noopener')
    else undo?.showError(res.error || 'Could not open the file.')
  }

  const photos = (rows || []).filter(r => IMG_RE.test(r.name))
  const docs = (rows || []).filter(r => !IMG_RE.test(r.name))

  return (
    <div className="fl-card">
      <div className="fl-eyebrow">Files &amp; photos</div>

      {rows === undefined && <div className="fl-empty" style={{ padding: '10px 0' }}>Loading files…</div>}

      {rows !== undefined && (
        <>
          {/* Documents — signed pins first, then everything non-photo. Owner
              build only (contracts and estimates carry money). */}
          {showMoney && (
            <div style={{ marginBottom: photos.length ? 10 : 6 }}>
              {pins.contract && (
                <button type="button" className="fl-rowline" onClick={() => openPin('contract')}>
                  <span style={{ fontSize: 13, fontWeight: 800, color: '#14775A' }}>SIGNED CONTRACT</span>
                  <span className="fl-chev">&#8250;</span>
                </button>
              )}
              {pins.approval && (
                <button type="button" className="fl-rowline" onClick={() => openPin('approval')}>
                  <span style={{ fontSize: 13, fontWeight: 800, color: '#14775A' }}>SIGNED APPROVAL</span>
                  <span className="fl-chev">&#8250;</span>
                </button>
              )}
              {docs.map(d => (
                <a key={d.path} className="fl-rowline" style={{ textDecoration: 'none', display: 'flex' }}
                  href={d.url} target="_blank" rel="noreferrer">
                  <span style={{ fontSize: 13, fontWeight: 700, color: '#3A3628', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.name}</span>
                  <span className="fl-chev">&#8250;</span>
                </a>
              ))}
              {!pins.contract && !pins.approval && docs.length === 0 && (
                <div style={{ fontSize: 12, color: '#8A8267' }}>No documents on this order.</div>
              )}
            </div>
          )}

          {/* Photos — general uploads + completion photos, one grid. */}
          {photos.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6, marginBottom: 10 }}>
              {photos.map(p => (
                <button key={p.path} type="button" onClick={() => setZoomUrl(p.url)}
                  style={{ padding: 0, border: '1px solid #DAD3C2', borderRadius: 8, overflow: 'hidden', background: '#fff', cursor: 'pointer' }}>
                  <img src={p.url} alt={p.name} loading="lazy"
                    style={{ display: 'block', width: '100%', height: 92, objectFit: 'cover' }} />
                </button>
              ))}
            </div>
          )}
          {photos.length === 0 && (
            <div style={{ fontSize: 12, color: '#8A8267', marginBottom: 10 }}>No photos on this order yet.</div>
          )}

          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="fl-btn fl-btn-gold" style={{ flex: 1, marginBottom: 0 }}
              disabled={busy} onClick={() => camRef.current?.click()}>
              {busy ? 'Uploading…' : 'Take photo'}
            </button>
            <button type="button" className="fl-btn fl-btn-ghost" style={{ flex: 1, marginBottom: 0 }}
              disabled={busy} onClick={() => libRef.current?.click()}>
              Upload files
            </button>
          </div>
          <input ref={camRef} type="file" accept="image/*" capture="environment" multiple
            style={{ display: 'none' }} onChange={onPick} />
          <input ref={libRef} type="file" multiple style={{ display: 'none' }} onChange={onPick} />
        </>
      )}

      {zoomUrl && (
        <div className="fl-zoom-overlay" onClick={() => setZoomUrl(null)}>
          <button type="button" className="fl-zoom-close" aria-label="Close" onClick={() => setZoomUrl(null)}>×</button>
          <img src={zoomUrl} alt="Attachment, zoomed" />
        </div>
      )}
    </div>
  )
}
