// =============================================================================
// VendorsScreen — vendor / partner work at a glance (owner build)
// =============================================================================
// FIELD-3: read-only. Rides listVendorItems() (vendor_items joined to their
// vendor_requests + partners, archived requests already excluded) and folds
// items back into requests. Two groups, mirroring the desktop VendorsTab:
//   NEW FROM PARTNERS  — partner-submitted requests still holding a 'submitted'
//                        item (the same test as the desktop's Vendors badge)
//   READY FOR PICKUP   — any request with an item at 'ready_for_pickup'
// A request with both lives in both. The desktop owns the whole workflow —
// this screen only answers "did anything land / is anything ready?".
// =============================================================================
import { useState, useEffect } from 'react'
import { listVendorItems } from '../lib/vendorsData'

// vendor_items.status vocabulary (desktop ITEM_STATUSES) → field chip tones.
const ITEM_TONE = {
  submitted: 'fl-c-warn',
  waiting_on_info: 'fl-c-bad',
  ready_to_work: 'fl-c-info',
  in_progress: 'fl-c-info',
  design_uploaded: 'fl-c-info',
  ready_for_pickup: 'fl-c-good',
  completed: 'fl-c-good',
  cancelled: 'fl-c-neutral',
}
const itemToneCls = (s) => ITEM_TONE[s] || 'fl-c-neutral'
const itemLabel = (s) => String(s || '').replace(/_/g, ' ').toUpperCase()

export default function VendorsScreen({ who, undo, onOpenJob, onBack }) {
  const [reqs, setReqs] = useState(null)   // null = loading; [{ request, items }]
  const [err, setErr] = useState(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const items = await listVendorItems()
        if (cancelled) return
        // Fold items into requests. listVendorItems sorts by item updated_at
        // desc, so each request's item list arrives newest-first already.
        const byReq = new Map()
        for (const it of items || []) {
          if (!it.request) continue
          if (!byReq.has(it.request_id)) byReq.set(it.request_id, { request: it.request, items: [] })
          byReq.get(it.request_id).items.push(it)
        }
        setReqs([...byReq.values()])
      } catch (e) {
        if (!cancelled) setErr(e?.message || 'Could not load vendor work.')
      }
    })()
    return () => { cancelled = true }
  }, [])

  const newFromPartners = (reqs || []).filter(r =>
    r.request.source === 'partner' && r.items.some(i => i.status === 'submitted'))
  const readyForPickup = (reqs || []).filter(r =>
    r.items.some(i => i.status === 'ready_for_pickup'))

  return (
    <div>
      {onBack && (
        <button type="button" className="fl-rowline" onClick={onBack}
          style={{ color: '#9A7209', fontWeight: 700, fontSize: 15, minHeight: 44 }}>
          &#8249; Menu
        </button>
      )}
      <div style={{ margin: '4px 2px 14px' }}>
        <div className="fl-sect-h" style={{ fontSize: 26 }}>Vendor work</div>
        <div className="fl-greet-sub">Partner requests at a glance</div>
      </div>

      {err && <div className="fl-empty">{err}</div>}
      {!err && reqs === null && <div className="fl-empty">Loading vendor work&#8230;</div>}
      {!err && reqs !== null && (
        <>
          <GroupHeader label="New from partners" count={newFromPartners.length} chipCls="fl-c-warn" />
          {newFromPartners.length === 0 && (
            <div className="fl-empty" style={{ padding: '14px 16px' }}>Nothing new from partners.</div>
          )}
          {newFromPartners.map(r => <RequestRow key={`new-${r.request.id}`} entry={r} />)}

          <GroupHeader label="Ready for pickup" count={readyForPickup.length} chipCls="fl-c-good" />
          {readyForPickup.length === 0 && (
            <div className="fl-empty" style={{ padding: '14px 16px' }}>Nothing waiting for pickup.</div>
          )}
          {readyForPickup.map(r => <RequestRow key={`ready-${r.request.id}`} entry={r} />)}

          <div style={{ textAlign: 'center', fontSize: 12.5, color: '#8A8267', padding: '20px 16px 8px' }}>
            Full vendor workflow lives on the desktop.
          </div>
        </>
      )}
    </div>
  )
}

function GroupHeader({ label, count, chipCls }) {
  return (
    <div className="fl-daylabel" style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
      <b>{label}</b>
      <span className={`fl-chip ${chipCls}`}>{count}</span>
    </div>
  )
}

function RequestRow({ entry }) {
  const { request: req, items } = entry
  const partner = req.partner?.company_name || 'Partner'
  const title = req.request_name || req.family_name || req.dealer_order_number || 'Request'
  const ref = req.dealer_order_number && req.dealer_order_number !== title ? req.dealer_order_number : null
  const newest = items.slice(0, 3)   // items arrive newest-first
  return (
    <div className="fl-row" style={{ cursor: 'default' }}>
      <div className="fl-rowtop">
        <div className="fl-fam" style={{ fontSize: 15, minWidth: 0 }}>{partner}</div>
        <div className="fl-spec" style={{ marginTop: 0, flexShrink: 0 }}>
          {items.length} {items.length === 1 ? 'item' : 'items'}
        </div>
      </div>
      <div className="fl-cem">
        {title}{ref ? <> &#183; <span style={{ fontFamily: '"JetBrains Mono", Consolas, monospace', fontSize: 11.5 }}>{ref}</span></> : null}
      </div>
      <div className="fl-chips">
        {newest.map(i => (
          <span key={i.id} className={`fl-chip ${itemToneCls(i.status)}`}>{itemLabel(i.status)}</span>
        ))}
      </div>
    </div>
  )
}
