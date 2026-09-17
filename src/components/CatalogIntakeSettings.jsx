// =============================================================================
// CatalogIntakeSettings — Settings › Catalog intake (CATALOG-INTAKE)
// =============================================================================
// Paul 2026-09-17: "we are uploading a lot of finished designs in settings i
// want to see all the finished final photos and be able to select each one
// edit the metadata and then upload it to the catalog."
// Grid of every completed-job photo (orders-attachments-public
// {orderId}/completion/…, via the staff-gated list_completion_photos RPC).
// Click one → metadata form (name prefills from the order's family) →
// Publish copies the image into monument-images and inserts the monuments
// row (same shape as the Catalog's own Add design form). meta.SourcePath
// remembers what's already published so nothing gets catalogued twice.
// =============================================================================
import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { fetchAllPaged, properName } from '../lib/stonebooksData'

const SRC_BUCKET = 'orders-attachments-public'
const IMAGE_BUCKET = 'monument-images'
const safeFileName = (n) => String(n || 'photo').replace(/[^\w.-]+/g, '_').slice(-80)

export default function CatalogIntakeSettings() {
  const [photos, setPhotos] = useState(null)   // [{path, created_at, size, url, orderId}]
  const [orders, setOrders] = useState(new Map())
  const [publishedPaths, setPublishedPaths] = useState(new Set())
  const [sel, setSel] = useState(null)         // the photo being catalogued
  const [err, setErr] = useState(null)
  const [showPublished, setShowPublished] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const [{ data, error }, mons] = await Promise.all([
        supabase.rpc('list_completion_photos'),
        fetchAllPaged(() => supabase.from('monuments').select('id, meta')).catch(() => []),
      ])
      if (cancelled) return
      if (error) { setErr(error.message); setPhotos([]); return }
      const rows = (data || []).map(r => ({
        ...r,
        orderId: String(r.path).split('/')[0],
        url: supabase.storage.from(SRC_BUCKET).getPublicUrl(r.path).data.publicUrl,
      }))
      setPhotos(rows)
      setPublishedPaths(new Set((mons || []).map(m => m.meta?.SourcePath).filter(Boolean)))
      const ids = [...new Set(rows.map(r => r.orderId))].filter(Boolean)
      const found = new Map()
      for (let i = 0; i < ids.length; i += 100) {
        const { data: os } = await supabase.from('orders')
          .select('id, order_number, primary_lastname, granite_color, shape')
          .in('id', ids.slice(i, i + 100))
        for (const o of (os || [])) found.set(o.id, o)
      }
      if (!cancelled) setOrders(found)
    })()
    return () => { cancelled = true }
  }, [])

  const visible = useMemo(() => (photos || []).filter(p => showPublished || !publishedPaths.has(p.path)),
    [photos, publishedPaths, showPublished])

  return (
    <div className="cin">
      <style>{CSS}</style>
      <h2 className="cin-h">Catalog intake</h2>
      <p className="cin-sub">
        Every finished-job photo the crew has uploaded, newest first. Click one, fill in the design's
        details, and publish it to the Catalog. Published photos drop off this list.
      </p>
      <label className="cin-togglerow">
        <input type="checkbox" checked={showPublished} onChange={e => setShowPublished(e.target.checked)} />
        Show already-published photos too
      </label>

      {err && <div className="cin-err">{err}</div>}
      {photos === null && <div className="cin-note">Scanning finished photos…</div>}
      {photos !== null && visible.length === 0 && (
        <div className="cin-note">No finished photos waiting — everything uploaded from the field has been catalogued.</div>
      )}

      <div className="cin-grid">
        {visible.map(p => {
          const o = orders.get(p.orderId)
          const done = publishedPaths.has(p.path)
          return (
            <button key={p.path} type="button" className={`cin-card${done ? ' pub' : ''}`} onClick={() => setSel(p)}>
              <img className="cin-img" src={p.url} alt="" loading="lazy" />
              <span className="cin-name">{o ? properName(o.primary_lastname || '—') : '—'}</span>
              <span className="cin-sub2">{[o?.order_number, new Date(p.created_at).toLocaleDateString()].filter(Boolean).join(' · ')}</span>
              {done && <span className="cin-pubtag">IN CATALOG</span>}
            </button>
          )
        })}
      </div>

      {sel && (
        <IntakeForm photo={sel} order={orders.get(sel.orderId) || null}
          onClose={() => setSel(null)}
          onPublished={(path) => { setPublishedPaths(s => new Set([...s, path])); setSel(null) }} />
      )}
    </div>
  )
}

function IntakeForm({ photo, order, onClose, onPublished }) {
  const [name, setName] = useState(properName(order?.primary_lastname || ''))
  const [granite, setGranite] = useState(order?.granite_color || '')
  const [shape, setShape] = useState(order?.shape || '')
  const [description, setDescription] = useState('')
  const [tagsStr, setTagsStr] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  const publish = async () => {
    if (!name.trim() || busy) { if (!name.trim()) setErr('Give the design a name.'); return }
    setBusy(true); setErr(null)
    try {
      // Copy the photo into the catalog's own bucket so archiving/cleaning
      // order files can never break a catalog card.
      const resp = await fetch(photo.url)
      if (!resp.ok) throw new Error('Could not read the photo file.')
      const blob = await resp.blob()
      const destPath = `catalog-intake/${crypto.randomUUID()}_${safeFileName(photo.path.split('/').pop())}`
      const { error: upErr } = await supabase.storage.from(IMAGE_BUCKET)
        .upload(destPath, blob, { upsert: false, contentType: blob.type || undefined })
      if (upErr) throw upErr
      const { data: pub } = supabase.storage.from(IMAGE_BUCKET).getPublicUrl(destPath)
      const tags = tagsStr.split(',').map(t => t.trim()).filter(Boolean)
      const { data, error } = await supabase.from('monuments').insert({
        id: `cat-${crypto.randomUUID()}`,
        is_archived: false,
        lastname: name.trim(),
        granite_color: granite.trim() || null,
        description: description.trim() || null,
        tags,
        meta: { Type: shape.trim() || null, Color: granite.trim() || null, SourcePath: photo.path, SourceOrder: order?.order_number || null },
        img: pub.publicUrl,
      }).select('id')
      if (error) throw error
      if (!data || data.length === 0) throw new Error('The catalog row did not save.')
      onPublished(photo.path)
    } catch (e) {
      setErr(e?.message || 'Publish failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="cin-scrim" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="cin-form" role="dialog" aria-label="Publish to catalog">
        <div className="cin-form-media"><img src={photo.url} alt="" /></div>
        <div className="cin-form-fields">
          <div className="cin-h" style={{ fontSize: 16 }}>Publish to the Catalog</div>
          {order && <div className="cin-sub2">From {properName(order.primary_lastname || '')} · {order.order_number}</div>}
          {err && <div className="cin-err">{err}</div>}
          <label className="cin-l">Design name
            <input className="cin-in" value={name} onChange={e => setName(e.target.value)} />
          </label>
          <label className="cin-l">Granite / color
            <input className="cin-in" value={granite} onChange={e => setGranite(e.target.value)} placeholder="e.g. Bahama Blue" />
          </label>
          <label className="cin-l">Shape / style
            <input className="cin-in" value={shape} onChange={e => setShape(e.target.value)} placeholder="e.g. Serp top upright" />
          </label>
          <label className="cin-l">Description <span className="cin-soft">(optional)</span>
            <textarea className="cin-in" rows={2} value={description} onChange={e => setDescription(e.target.value)} />
          </label>
          <label className="cin-l">Tags <span className="cin-soft">(comma separated)</span>
            <input className="cin-in" value={tagsStr} onChange={e => setTagsStr(e.target.value)} placeholder="roses, double heart, russian" />
          </label>
          <div className="cin-actions">
            <button type="button" className="cin-btn ghost" onClick={onClose} disabled={busy}>Cancel</button>
            <button type="button" className="cin-btn go" onClick={publish} disabled={busy || !name.trim()}>
              {busy ? 'Publishing…' : 'Publish to catalog'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

const CSS = `
  .cin { max-width: 980px; }
  .cin-h { font-size: 18px; font-weight: 700; margin: 0 0 4px; }
  .cin-sub { font-size: 13.5px; color: var(--sb-text-muted, #6B6456); margin: 0 0 10px; }
  .cin-togglerow { display: flex; align-items: center; gap: 8px; font-size: 12.5px; color: var(--sb-text-muted, #6B6456); margin-bottom: 12px; cursor: pointer; }
  .cin-err { font-size: 12.5px; color: #B3261E; background: rgba(179,38,30,0.08); border-radius: 8px; padding: 7px 10px; margin: 8px 0; }
  .cin-note { font-size: 13px; color: #8a8a85; background: var(--sb-surface, #FBFAF7); border: 0.5px dashed #E2D8C6; border-radius: 10px; padding: 12px 14px; }
  .cin-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px; margin-top: 6px; }
  .cin-card { position: relative; display: flex; flex-direction: column; gap: 2px; font: inherit; text-align: left;
    background: var(--sb-surface, #FBFAF7); border: 1.5px solid #EAE4D6; border-radius: 10px; padding: 6px; cursor: pointer; }
  .cin-card:hover { border-color: #C9A468; }
  .cin-card.pub { opacity: 0.65; }
  .cin-img { width: 100%; height: 118px; object-fit: cover; border-radius: 7px; background: #f0eee9; }
  .cin-name { font-size: 12.5px; font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .cin-sub2 { font-size: 11px; color: #8a8a85; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .cin-pubtag { position: absolute; top: 10px; right: 10px; font-size: 9px; font-weight: 800; letter-spacing: 0.05em;
    background: #1D9E75; color: #fff; border-radius: 5px; padding: 2px 6px; }
  .cin-scrim { position: fixed; inset: 0; background: rgba(15,20,25,0.55); z-index: 1400;
    display: flex; align-items: center; justify-content: center; padding: 20px; }
  .cin-form { background: #fff; border-radius: 14px; width: 100%; max-width: 760px; max-height: 88vh; overflow-y: auto;
    display: flex; gap: 16px; padding: 18px; box-sizing: border-box; }
  .cin-form-media { flex: 1; min-width: 0; }
  .cin-form-media img { width: 100%; border-radius: 10px; background: #f0eee9; }
  .cin-form-fields { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 6px; }
  .cin-l { display: block; font-size: 11.5px; font-weight: 700; color: #6B6456; }
  .cin-soft { font-weight: 400; }
  .cin-in { display: block; width: 100%; margin-top: 3px; border: 1px solid #D9D2C0; border-radius: 8px; padding: 7px 10px; font: inherit; font-size: 13.5px; box-sizing: border-box; resize: vertical; }
  .cin-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 8px; }
  .cin-btn { font: inherit; font-size: 13px; font-weight: 700; padding: 8px 16px; border-radius: 9px; border: 1px solid #D9D2C0; background: #fff; cursor: pointer; }
  .cin-btn.ghost { color: #8a8a85; }
  .cin-btn.go { background: #16150F; color: #C9A468; border-color: #16150F; }
  .cin-btn.go:disabled { opacity: 0.5; cursor: default; }
  @media (max-width: 700px) { .cin-form { flex-direction: column; } }
`
