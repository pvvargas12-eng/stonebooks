// =============================================================================
// JobDetailScreen — the whole job on one phone screen
// =============================================================================
// Approved layout image (tap to zoom — the image only, never the signed
// document), sizes as a cut sheet, the stone/FDN ladders as tap targets with
// UNDO, LEAD banner, and "Mark exact spot" (GPS + note + photo → the new
// orders.field_location column). Money/contract edits stay on desktop.
// =============================================================================
import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import {
  getOrderById, getJobByOrderId, getJob,
  STONE_STATUS, FDN_STATUS, deriveStoneStatus, deriveFdnStatus, stoneStatusOptions, statusDimApplies,
  setOrderStoneStatus, setOrderFdnStatus,
  getProofVersions, getProofVersionsByOrder,
  uploadOrderAttachment, customerName, getActiveStaffUser, fmtUSD, rowBalanceDue,
} from '../lib/stonebooksData'
import { rowToOrder } from '../SalesMode'
import { buildDieSpec, buildBaseSpec, displayGraniteColor, composeGraveLocation } from '../lib/monumentCatalog'
import { isLeadRaw, directionsUrl } from './fieldShared'

import OwnerOrderPanel from './OwnerOrderPanel'

// FIELD-2: showMoney gates the LEAD banner's balance line — crew builds pass
// false and get the warning without the amount. FIELD-3 adds the owner panel
// (payments, approvals, tasks, activity) below the job cards when showMoney.
export default function JobDetailScreen({ jobId, orderId, onBack, onComplete, undo, showMoney = true, who = null, onTaskChanged = null }) {
  const [order, setOrder] = useState(null)     // raw row + customer/cemetery
  const [job, setJob] = useState(undefined)    // undefined=loading, null=no job
  const [proofImg, setProofImg] = useState(null)
  const [zoom, setZoom] = useState(false)
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)
  const [spotOpen, setSpotOpen] = useState(false)

  const reloadJob = useCallback(async () => {
    if (jobId) { setJob(await getJob(jobId).catch(() => null)); return }
    if (orderId) { setJob(await getJobByOrderId(orderId).catch(() => null)); return }
    setJob(null)
  }, [jobId, orderId])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const [o] = await Promise.all([orderId ? getOrderById(orderId) : null, reloadJob()])
        if (!cancelled) setOrder(o)
      } catch (e) { if (!cancelled) setErr(e?.message || 'Could not load the order.') }
    })()
    return () => { cancelled = true }
  }, [orderId, reloadJob])

  // Approved layout image: job-scoped proofs first, then order-scoped (leads),
  // then the primary design snapshot. Image only, by design.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const jobProofs = job?.id ? await getProofVersions(job.id).catch(() => []) : []
        const ordProofs = orderId ? await getProofVersionsByOrder(orderId).catch(() => []) : []
        const all = [...(jobProofs || []), ...(ordProofs || [])]
        const approved = all.find(p => p.approved_at) || all.find(p => p.is_current) || all[0]
        // The proof_versions image column is layout_image_url — the old
        // image_url/url read matched NOTHING, so uploaded proofs were
        // invisible in the field forever (found 2026-08-14).
        const url = approved?.layout_image_url || null
        if (!cancelled && url) { setProofImg({ url, approved: !!approved.approved_at }); return }
        const mapped = order ? rowToOrder(order, order.customer, order.cemetery) : null
        const designImg = mapped?.designs?.[0]?.snapshot?.img || null
        if (!cancelled) setProofImg(designImg ? { url: designImg, approved: false, design: true } : null)
      } catch { /* layout image is best-effort */ }
    })()
    return () => { cancelled = true }
  }, [job, order, orderId])

  if (err) return <div><BackBtn onBack={onBack} /><div className="fl-empty">{err}</div></div>
  if (!order || job === undefined) return <div><BackBtn onBack={onBack} /><div className="fl-empty">Loading…</div></div>

  const mapped = rowToOrder(order, order.customer, order.cemetery)
  const fam = (order.primary_lastname || customerName(order.customer) || '—').toUpperCase()
  const grave = composeGraveLocation(order)
  const dieSpec = buildDieSpec(mapped)
  const baseSpec = buildBaseSpec(mapped)
  const dir = directionsUrl(order.cemetery)
  const lead = isLeadRaw(order)
  const loc = order.field_location || null

  return (
    <div>
      <BackBtn onBack={onBack} />
      {lead && (
        <div className="fl-lead-banner">
          <b>STILL A LEAD — NO DEPOSIT RECEIVED</b>
          <span>{showMoney ? `Balance ${fmtUSD(rowBalanceDue(order))}. ` : ''}Check with the office before leaving product.</span>
        </div>
      )}

      <div className="fl-detfam">{fam}</div>
      <div className="fl-detsub">
        <span className="mono">{order.order_number || 'DRAFT'}</span>
        {order.cemetery?.name ? ` · ${order.cemetery.name}` : ''}{grave ? ` · ${grave}` : ''}
        {dir && <> · <a className="fl-dirlink" style={{ marginLeft: 0 }} href={dir} target="_blank" rel="noreferrer">Directions</a></>}
      </div>

      {/* Approved layout — the image only, tap to zoom */}
      <div className="fl-card">
        <div className="fl-eyebrow">Approved layout</div>
        {proofImg ? (
          <>
            <div className="fl-layout-wrap" onClick={() => setZoom(true)} role="button" tabIndex={0}
              onKeyDown={e => { if (e.key === 'Enter') setZoom(true) }}>
              <img src={proofImg.url} alt="Layout" loading="lazy" />
            </div>
            <div className="fl-layout-meta">
              <span>{proofImg.design ? 'Primary design (no proof yet)' : proofImg.approved ? 'Approved proof' : 'Latest proof (not yet approved)'}</span>
              <span className="zoom">Tap to zoom</span>
            </div>
          </>
        ) : (
          <div className="fl-empty" style={{ padding: '14px 0' }}>No layout on this order yet.</div>
        )}
      </div>
      {zoom && proofImg && (
        <div className="fl-zoom-overlay" onClick={() => setZoom(false)}>
          <button type="button" className="fl-zoom-close" aria-label="Close" onClick={() => setZoom(false)}>×</button>
          <img src={proofImg.url} alt="Layout, zoomed" />
        </div>
      )}

      {/* Sizes — a cut sheet */}
      <div className="fl-card">
        <div className="fl-eyebrow">Stone &amp; sizes</div>
        <div className="fl-specgrid">
          <div><div className="fl-speclab">Die</div><div className="fl-specval">{dieSpec || '—'}</div></div>
          <div><div className="fl-speclab">Base</div><div className="fl-specval">{baseSpec || '—'}</div></div>
          <div><div className="fl-speclab">Granite</div><div className="fl-specval sans">{displayGraniteColor(mapped) || '—'}</div></div>
          <div><div className="fl-speclab">Grave</div><div className="fl-specval sans">{grave || '—'}</div></div>
        </div>
      </div>

      {/* Mark the exact spot */}
      <div className="fl-card">
        <div className="fl-eyebrow">Exact spot</div>
        {loc && !spotOpen && (
          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 12.5, color: '#55503F', fontWeight: 600 }}>
              {loc.note || 'Spot marked'}
            </div>
            <div style={{ fontSize: 11, color: '#8A8267', marginTop: 2 }}>
              {loc.lat ? `${Number(loc.lat).toFixed(6)}, ${Number(loc.lng).toFixed(6)} · ` : ''}
              {loc.markedBy || ''}{loc.markedAt ? ` · ${String(loc.markedAt).slice(0, 10)}` : ''}
              {loc.lat && <> · <a className="fl-dirlink" style={{ marginLeft: 0 }} href={`https://maps.apple.com/?daddr=${loc.lat},${loc.lng}`} target="_blank" rel="noreferrer">Open pin</a></>}
            </div>
            {loc.photoUrl && (
              <div className="fl-photo-strip"><a href={loc.photoUrl} target="_blank" rel="noreferrer"><img className="fl-photo-thumb" src={loc.photoUrl} alt="Spot" /></a></div>
            )}
          </div>
        )}
        {spotOpen ? (
          <MarkSpotForm order={order} undo={undo}
            onSaved={async () => { setSpotOpen(false); setOrder(await getOrderById(orderId)) }}
            onCancel={() => setSpotOpen(false)} />
        ) : (
          <button type="button" className="fl-btn fl-btn-ghost" style={{ marginBottom: 0 }} onClick={() => setSpotOpen(true)}>
            {loc ? 'Update the spot' : 'Mark exact spot (GPS + photo)'}
          </button>
        )}
      </div>

      {/* Ladders */}
      {job ? (
        <>
          {/* Ladders only where the dimension exists for this job type (audit
              B2 — inscriptions/repairs have no stone or foundation to tap). */}
          {statusDimApplies('stone', job) && (
          <StatusLadder title="Stone — tap the true state" options={stoneStatusOptions(job)}
            current={deriveStoneStatus(job)} busy={busy}
            onSet={async (code, prev) => {
              setBusy(true)
              const res = await setOrderStoneStatus(job.id, code)
              await reloadJob(); setBusy(false)
              if (!res.ok) { undo.showError(res.error || 'Could not update.'); return }
              undo.show(`Stone → ${STONE_STATUS.find(s => s.code === code)?.label}`, async () => {
                await setOrderStoneStatus(job.id, prev); await reloadJob()
              })
            }} />
          )}
          {statusDimApplies('fdn', job) && (
          <StatusLadder title="Foundation" options={FDN_STATUS}
            current={deriveFdnStatus(job)} busy={busy}
            onSet={async (code, prev) => {
              setBusy(true)
              const res = await setOrderFdnStatus(job.id, code)
              await reloadJob(); setBusy(false)
              if (!res.ok) { undo.showError(res.error || 'Could not update.'); return }
              undo.show(`Foundation → ${FDN_STATUS.find(s => s.code === code)?.label}`, async () => {
                await setOrderFdnStatus(job.id, prev); await reloadJob()
              })
            }} />
          )}
          <button type="button" className="fl-btn fl-btn-gold" onClick={() => onComplete({ jobId: job.id, orderId: order.id })}>
            Finish job — final photo
          </button>
        </>
      ) : (
        <div className="fl-card">
          <div className="fl-eyebrow">Production</div>
          <div style={{ fontSize: 12.5, color: '#8A8267' }}>No production job on this order yet (statuses appear once a job exists).</div>
        </div>
      )}
      {/* FIELD-3: the owner suite — contact / payments / approvals / tasks /
          activity. Only mounted for the owner build; the crew bundle renders
          nothing here. Recording a payment refetches the order so the balance,
          payment list, and LEAD banner all catch up. */}
      {showMoney && (
        <OwnerOrderPanel order={order} who={who} undo={undo} onChanged={onTaskChanged}
          onOrderChanged={async () => { if (orderId) setOrder(await getOrderById(orderId).catch(() => order)) }} />
      )}
    </div>
  )
}

function BackBtn({ onBack }) {
  return <button type="button" className="fl-back" onClick={onBack}>&#8249; Back</button>
}

// One dimension as big tap targets. Tapping ANY rung declares that state (so a
// mis-tap is fixable), and every write offers UNDO back to the previous rung.
function StatusLadder({ title, options, current, onSet, busy }) {
  const curIdx = options.findIndex(o => o.code === current)
  return (
    <div className="fl-card">
      <div className="fl-eyebrow">{title}</div>
      <div className="fl-ladder">
        {options.map((o, i) => {
          const done = i <= curIdx
          const isNext = i === curIdx + 1
          return (
            <button key={o.code} type="button" disabled={busy || o.code === current}
              className={o.code === current ? 'done' : isNext ? 'next' : done ? 'done' : ''}
              onClick={() => onSet(o.code, current)}>
              {o.label}
              <span className="tick">{o.code === current ? 'CURRENT' : isNext ? 'TAP WHEN DONE' : done ? 'DONE' : ''}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

// GPS + note + optional photo → orders.field_location (+ photo also lands in
// the order's general attachments so the office sees it on the desktop).
// Exported: the Cemeteries screen reuses it to mark a grave on any open order.
export function MarkSpotForm({ order, onSaved, onCancel, undo }) {
  const [note, setNote] = useState(order.field_location?.note || '')
  const [gps, setGps] = useState(null)      // {lat,lng,accuracy} | 'error' | null=asking
  const [file, setFile] = useState(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!navigator.geolocation) { setGps('error'); return }
    navigator.geolocation.getCurrentPosition(
      p => setGps({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: Math.round(p.coords.accuracy) }),
      () => setGps('error'),
      { enableHighAccuracy: true, timeout: 12000 }
    )
  }, [])

  const save = async () => {
    setBusy(true)
    const prev = order.field_location || null
    let photoUrl = prev?.photoUrl || null
    if (file) {
      const up = await uploadOrderAttachment(order.id, file)
      if (up.ok) photoUrl = up.url
      else { undo.showError(up.error || 'Photo upload failed.'); setBusy(false); return }
    }
    const next = {
      lat: gps && gps !== 'error' ? gps.lat : prev?.lat || null,
      lng: gps && gps !== 'error' ? gps.lng : prev?.lng || null,
      accuracy: gps && gps !== 'error' ? gps.accuracy : prev?.accuracy || null,
      note: note.trim() || null,
      photoUrl,
      markedAt: new Date().toISOString(),
      markedBy: getActiveStaffUser() || null,
    }
    const { error } = await supabase.from('orders').update({ field_location: next }).eq('id', order.id)
    setBusy(false)
    if (error) { undo.showError(error.message); return }
    undo.show('Spot marked on the order', async () => {
      await supabase.from('orders').update({ field_location: prev }).eq('id', order.id)
    })
    onSaved()
  }

  return (
    <div>
      <div className="fl-lab">GPS</div>
      <div style={{ fontSize: 12.5, fontWeight: 700, color: gps === 'error' ? '#B3261E' : '#14775A', marginBottom: 8 }}>
        {gps === null ? 'Getting your position…'
          : gps === 'error' ? 'No GPS — the note and photo still save.'
          : `Locked: ${gps.lat.toFixed(6)}, ${gps.lng.toFixed(6)} (±${gps.accuracy} m)`}
      </div>
      <div className="fl-lab">Where exactly</div>
      <textarea className="fl-textarea" placeholder="e.g. Rubbing taken — 3rd stone left of the maple, faces the road"
        value={note} onChange={e => setNote(e.target.value)} />
      <div className="fl-lab">Photo of the spot</div>
      <input className="fl-input" type="file" accept="image/*" capture="environment"
        onChange={e => setFile(e.target.files?.[0] || null)} />
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" className="fl-btn fl-btn-ghost" style={{ marginBottom: 0 }} onClick={onCancel} disabled={busy}>Cancel</button>
        <button type="button" className="fl-btn" style={{ marginBottom: 0 }} onClick={save}
          disabled={busy || gps === null || (!note.trim() && !file && gps === 'error')}>
          {busy ? 'Saving…' : 'Save spot'}
        </button>
      </div>
    </div>
  )
}
