// =============================================================================
// InventoryPhotoEtching — read-only Photo Queue + Etching Queue (separate vendors).
// =============================================================================
// Scans active orders' addOns: photo-* (porcelain/ceramic, a DIFFERENT vendor) and
// laser-* (etching). Photos track attachment status (has-image vs MISSING). Etchings
// show the data that exists — no fabricated status. NO writes, NO migration.
// =============================================================================

import { useState, useEffect, useCallback, useMemo } from 'react'
import { rowToOrder } from '../SalesMode'
import { getActiveStoneOrders } from '../lib/stonebooksData' // getActiveStoneOrders = active-orders loader (status-filtered)

const titleCase = (s) => String(s || '').replace(/\b\w/g, c => c.toUpperCase())
const IMG_RE = /\.(jpe?g|png|gif|webp|heic|tiff?)$/i

function familyOf(row) {
  if (row.primary_lastname && String(row.primary_lastname).trim()) return String(row.primary_lastname).trim()
  if (Array.isArray(row.deceased)) {
    const d = row.deceased.find(x => x && !x.isReserved && (x.lastName || x.firstName))
    if (d) return [d.lastName, d.firstName].filter(Boolean).join(', ')
  }
  return row.order_number || 'Order'
}
function imageAttachmentCount(order) {
  const atts = order?.pricing?.attachments
  if (!Array.isArray(atts)) return 0
  return atts.filter(a => /image/i.test(a?.type || '') || IMG_RE.test(a?.name || '')).length
}

export default function InventoryPhotoEtching() {
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState(null)
  const [photos, setPhotos] = useState([])
  const [etchings, setEtchings] = useState([])
  const [orderCount, setOrderCount] = useState(0)

  const load = useCallback(async () => {
    try {
      const ordRes = await getActiveStoneOrders()
      const orders = (ordRes.rows || []).map(r => {
        const o = rowToOrder(r, null, null)
        o.family = familyOf(r)
        return o
      })
      const ph = [], et = []
      for (const o of orders) {
        const addOns = Array.isArray(o.addOns) ? o.addOns : []
        const imgAtt = imageAttachmentCount(o)
        for (const a of addOns) {
          const code = String(a?.code || '')
          if (code.startsWith('photo-')) {
            const parts = code.split('-')
            const imageUrl = a.customerPhotoUrl || null
            ph.push({
              key: `${o.id}:${code}`, orderId: o.id, orderNumber: o.orderNumber || null, family: o.family,
              label: a.label || code, type: a.type || parts[1] || 'photo', size: a.size || parts[2] || '',
              qty: Math.max(1, Number(a.qty) || 1), notes: a.notes || '',
              imageUrl, hasImage: !!(a.customerPhotoUrl || a.customerPhotoPath), orderImgAtt: imgAtt,
            })
          } else if (code.startsWith('laser-')) {
            const parts = code.split('-')
            et.push({
              key: `${o.id}:${code}`, orderId: o.id, orderNumber: o.orderNumber || null, family: o.family,
              label: a.label || code, size: a.size || parts[1] || '',
              qty: Math.max(1, Number(a.qty) || 1), notes: a.notes || '',
              imageUrl: a.customerPhotoUrl || null,
            })
          }
        }
      }
      setPhotos(ph); setEtchings(et); setOrderCount(orders.length)
      setErr(ordRes.ok ? null : ordRes.error)
    } catch (e) {
      setErr(String(e?.message || e)); setPhotos([]); setEtchings([])
    }
    setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  const photoGroups = useMemo(() => {
    const missing = [], ready = []
    for (const p of photos) (p.hasImage ? ready : missing).push(p)
    return { missing, ready }
  }, [photos])

  if (loading) return <div className="sb-empty">Scanning orders for photos &amp; etchings…</div>
  if (err) return <div className="sb-empty">Couldn’t load the queues.<br /><span className="ipe-muted">{err}</span></div>

  return (
    <div className="ipe">
      <style>{IPE_CSS}</style>

      {/* ── PHOTO QUEUE (porcelain / ceramic — photo vendor) ── */}
      <section className="ipe-section">
        <div className="ipe-sec-head ipe-sec-photo">
          <span className="ipe-sec-title">Photo Queue</span>
          <span className="ipe-sec-sub">Porcelain / ceramic — photo vendor</span>
          <span className="ipe-sec-count">{photos.length}</span>
        </div>

        {photos.length === 0 ? (
          <div className="sb-empty">No porcelain/ceramic photos on active orders.</div>
        ) : (
          <>
            {photoGroups.missing.length > 0 && (
              <div className="ipe-group">
                <div className="ipe-group-head ipe-group-missing">Missing photo <span className="ipe-group-count">{photoGroups.missing.length}</span><span className="ipe-group-hint">needed before ordering</span></div>
                <div className="ipe-cards">
                  {photoGroups.missing.map(p => <PhotoCard key={p.key} p={p} missing />)}
                </div>
              </div>
            )}
            {photoGroups.ready.length > 0 && (
              <div className="ipe-group">
                <div className="ipe-group-head ipe-group-ready">Ready to order <span className="ipe-group-count">{photoGroups.ready.length}</span><span className="ipe-group-hint">image on file</span></div>
                <div className="ipe-cards">
                  {photoGroups.ready.map(p => <PhotoCard key={p.key} p={p} />)}
                </div>
              </div>
            )}
          </>
        )}
      </section>

      {/* ── ETCHING QUEUE (laser — different vendor) ── */}
      <section className="ipe-section">
        <div className="ipe-sec-head ipe-sec-etch">
          <span className="ipe-sec-title">Etching Queue</span>
          <span className="ipe-sec-sub">Laser etching — separate vendor</span>
          <span className="ipe-sec-count">{etchings.length}</span>
        </div>

        {etchings.length === 0 ? (
          <div className="sb-empty">No laser etchings on active orders.</div>
        ) : (
          <div className="ipe-table-wrap">
            <table className="ipe-table">
              <thead><tr><th>Family</th><th>Order #</th><th>Etching</th><th>Size</th><th className="ipe-num">Qty</th><th>Notes</th><th>Design</th></tr></thead>
              <tbody>
                {etchings.map(e => (
                  <tr key={e.key}>
                    <td className="ipe-fam">{e.family}</td>
                    <td className="ipe-mono">{e.orderNumber || '—'}</td>
                    <td>{e.label}</td>
                    <td>{e.size ? String(e.size).toUpperCase() : '—'}</td>
                    <td className="ipe-num">{e.qty}</td>
                    <td className="ipe-notes">{e.notes || ''}</td>
                    <td>{e.imageUrl ? <a href={e.imageUrl} target="_blank" rel="noreferrer" className="ipe-link">view</a> : <span className="ipe-muted">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="ipe-foot">Scanned {orderCount} active order(s). Ordered / received tracking arrives with the photo-procurement phase.</div>
    </div>
  )
}

function PhotoCard({ p, missing }) {
  return (
    <div className={`ipe-card ${missing ? 'ipe-card-missing' : 'ipe-card-ready'}`}>
      <div className="ipe-thumb-wrap">
        {p.imageUrl
          ? <img src={p.imageUrl} alt="" className="ipe-thumb" onError={(e) => { e.currentTarget.style.display = 'none' }} />
          : <div className="ipe-thumb-empty">{missing ? 'No image' : ''}</div>}
      </div>
      <div className="ipe-card-body">
        <div className="ipe-card-top">
          <span className="ipe-fam">{p.family}</span>
          {p.orderNumber && <span className="ipe-ordnum">{p.orderNumber}</span>}
        </div>
        <div className="ipe-card-spec">{titleCase(p.type)}{p.size ? ` · ${String(p.size).toUpperCase()}` : ''}{p.qty > 1 ? ` · qty ${p.qty}` : ''}</div>
        {p.notes && <div className="ipe-card-notes">{p.notes}</div>}
        {missing ? (
          <div className="ipe-warn">⚠ Missing photo — needed before ordering{p.orderImgAtt > 0 ? ` · order has ${p.orderImgAtt} image attachment(s) — may need linking` : ''}</div>
        ) : (
          <div className="ipe-ok">✓ Image on file</div>
        )}
      </div>
    </div>
  )
}

const IPE_CSS = `
  .ipe-muted { color: var(--sb-text-muted, #8a7f6c); font-size: 13px; }
  .ipe-section { margin-bottom: 28px; }
  .ipe-sec-head { display: flex; align-items: baseline; gap: 10px; padding: 9px 14px; border-radius: 9px; margin-bottom: 14px; border-left: 4px solid; }
  .ipe-sec-photo { background: #f3eef7; border-left-color: #8a5cc4; }
  .ipe-sec-etch  { background: #eef2f6; border-left-color: #3f6ea5; }
  .ipe-sec-title { font-size: 15px; font-weight: 700; color: var(--sb-text, #2a2a2a); }
  .ipe-sec-sub { font-size: 12px; color: var(--sb-text-muted, #6b6256); }
  .ipe-sec-count { margin-left: auto; font-size: 13px; font-weight: 700; background: rgba(0,0,0,0.07); border-radius: 999px; padding: 1px 10px; }

  .ipe-group { margin-bottom: 16px; }
  .ipe-group-head { display: flex; align-items: center; gap: 8px; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; margin-bottom: 10px; }
  .ipe-group-missing { color: #b3261e; }
  .ipe-group-ready { color: #1f7a3d; }
  .ipe-group-count { background: rgba(0,0,0,0.08); border-radius: 999px; padding: 0 8px; }
  .ipe-group-hint { font-weight: 500; text-transform: none; letter-spacing: 0; color: var(--sb-text-muted, #8a7f6c); }

  .ipe-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 14px; }
  .ipe-card { display: flex; gap: 12px; background: var(--sb-surface, #fff); border: 1px solid var(--sb-border, #e4e0d4); border-radius: 12px; padding: 12px; }
  .ipe-card-missing { border-color: #e7b9b3; background: #fdf6f5; }
  .ipe-card-ready { border-color: #bcdfc7; }
  .ipe-thumb-wrap { flex: 0 0 72px; width: 72px; height: 72px; border-radius: 8px; overflow: hidden; background: #f0ece2; display: flex; align-items: center; justify-content: center; }
  .ipe-thumb { width: 100%; height: 100%; object-fit: cover; }
  .ipe-thumb-empty { font-size: 10px; color: #b3261e; font-weight: 600; text-align: center; }
  .ipe-card-body { flex: 1; min-width: 0; }
  .ipe-card-top { display: flex; align-items: baseline; gap: 8px; }
  .ipe-fam { font-size: 14px; font-weight: 700; color: var(--sb-text, #2a2a2a); }
  .ipe-ordnum { font-size: 11.5px; color: var(--sb-text-muted, #8a7f6c); font-variant-numeric: tabular-nums; }
  .ipe-card-spec { font-size: 12.5px; color: #6b6256; margin-top: 2px; }
  .ipe-card-notes { font-size: 11.5px; color: var(--sb-text-muted, #8a7f6c); margin-top: 3px; }
  .ipe-warn { font-size: 11.5px; font-weight: 600; color: #b3261e; margin-top: 6px; }
  .ipe-ok { font-size: 11.5px; font-weight: 600; color: #1f7a3d; margin-top: 6px; }

  .ipe-table-wrap { overflow-x: auto; border: 1px solid var(--sb-border, #e4e0d4); border-radius: 12px; background: var(--sb-surface, #fff); }
  .ipe-table { width: 100%; border-collapse: collapse; font-size: 13.5px; }
  .ipe-table th { text-align: left; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--sb-text-muted, #8a7f6c); padding: 11px 14px; border-bottom: 1px solid var(--sb-border, #e4e0d4); }
  .ipe-table td { padding: 10px 14px; border-bottom: 1px solid var(--sb-border-soft, #f0ece2); }
  .ipe-table tr:last-child td { border-bottom: 0; }
  .ipe-mono { font-family: var(--font-m, 'JetBrains Mono'), monospace; font-size: 12.5px; }
  .ipe-num { text-align: center; }
  .ipe-notes { color: var(--sb-text-muted, #6b6256); font-size: 12px; }
  .ipe-link { color: #9A7209; font-weight: 600; }
  .ipe-foot { font-size: 12px; color: var(--sb-text-muted, #8a7f6c); margin-top: 8px; }
`
