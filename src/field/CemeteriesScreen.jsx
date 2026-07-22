// =============================================================================
// CemeteriesScreen — the cemetery book, in your pocket (2026-07-22)
// =============================================================================
// Paul: pick a cemetery, hit GO TO and the phone drives you there (the manual
// pin beats a bad geocode — some of these places are a dirt pull-off Google
// has never heard of), flip through the uploaded map pages full-screen, set
// the pin from where you're standing, and mark a specific grave on any open
// order or lead at that cemetery (same GPS+photo spot form as the job screen).
// Data is the SAME rows the desktop Cemeteries tab writes.
// =============================================================================
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import {
  listCemeteriesWithPermit, updateCemeteryPermit, listCemeteryMaps, countCemeteryMaps,
} from '../lib/stonebooksData'
import { directionsUrl } from './fieldShared'
import { MarkSpotForm } from './JobDetailScreen'

// GO TO target: manual pin first, then the shared address/geocode fallback.
const goToUrl = (c) => {
  if (c?.pin_lat != null && c?.pin_lng != null) return `https://maps.apple.com/?daddr=${c.pin_lat},${c.pin_lng}`
  return directionsUrl(c)
}

const OPEN_STATUSES = ['draft', 'scoping', 'quoted', 'contracted', 'in_production', 'installed', 'paid_in_full']

export default function CemeteriesScreen({ who, undo, onBack }) {
  const [list, setList] = useState(null)
  const [counts, setCounts] = useState(new Map())
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(null)

  useEffect(() => {
    let cancelled = false
    Promise.all([listCemeteriesWithPermit(), countCemeteryMaps()]).then(([rows, m]) => {
      if (cancelled) return
      setList(rows || [])
      setCounts(m)
    }).catch(() => { if (!cancelled) setList([]) })
    return () => { cancelled = true }
  }, [])

  const visible = useMemo(() => {
    const norm = q.trim().toLowerCase()
    let rows = list || []
    if (norm) rows = rows.filter(c => [c.name, c.city].filter(Boolean).join(' ').toLowerCase().includes(norm))
    return rows
  }, [list, q])

  if (sel) {
    return <CemeteryDetail cem={sel} who={who} undo={undo}
      mapCount={counts.get(sel.id) || 0}
      onBack={() => setSel(null)}
      onPinSaved={(patch) => {
        setSel(s => ({ ...s, ...patch }))
        setList(prev => (prev || []).map(c => c.id === sel.id ? { ...c, ...patch } : c))
      }} />
  }

  return (
    <div>
      {onBack && (
        <button type="button" className="fl-rowline" onClick={onBack}
          style={{ color: '#9A7209', fontWeight: 700, fontSize: 15, minHeight: 44 }}>
          &#8249; Menu
        </button>
      )}
      <div className="fl-greet" style={{ fontSize: 29 }}>Cemeteries</div>
      <div className="fl-greet-sub">Directions, maps, and grave marking</div>

      <input className="fl-input" style={{ marginTop: 10 }} placeholder="Search cemeteries&#8230;"
        value={q} onChange={e => setQ(e.target.value)} />

      {list === null && <div className="fl-empty">Loading the cemetery book&#8230;</div>}
      {list !== null && visible.length === 0 && <div className="fl-empty-serif">No cemetery matches.</div>}
      {visible.length > 0 && (
        <div className="fl-row" style={{ cursor: 'default', padding: '4px 14px', marginTop: 10 }}>
          {visible.map(c => (
            <button key={c.id} type="button" className="fl-rowline" onClick={() => setSel(c)}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14.5, fontWeight: 700, color: '#16150F', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {c.name}
                </div>
                <div style={{ fontSize: 11.5, color: '#8A7F6C', marginTop: 2, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <span>{[c.city, c.state].filter(Boolean).join(', ') || '—'}</span>
                  {counts.get(c.id) > 0 && <span className="fl-chip fl-c-info">{counts.get(c.id)} MAP{counts.get(c.id) === 1 ? '' : 'S'}</span>}
                  {c.pin_lat != null && <span className="fl-chip fl-c-good">PIN</span>}
                </div>
              </div>
              <span className="fl-chev">&#8250;</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function CemeteryDetail({ cem, who, undo, mapCount, onBack, onPinSaved }) {
  const [maps, setMaps] = useState(null)
  const [mapsOpen, setMapsOpen] = useState(false)
  const [viewer, setViewer] = useState(null)     // map row full-screen
  const [pinBusy, setPinBusy] = useState(false)
  const [graves, setGraves] = useState(null)     // open orders/leads here
  const [gravesOpen, setGravesOpen] = useState(false)
  const [markFor, setMarkFor] = useState(null)   // order being marked

  useEffect(() => {
    let cancelled = false
    listCemeteryMaps(cem.id).then(m => { if (!cancelled) setMaps(m || []) }).catch(() => { if (!cancelled) setMaps([]) })
    return () => { cancelled = true }
  }, [cem.id])

  const loadGraves = async () => {
    if (graves) { setGravesOpen(v => !v); return }
    setGravesOpen(true)
    const { data, error } = await supabase.from('orders')
      .select('id, order_number, primary_lastname, status, field_location, grave_location, plot_section, plot_grave, customer:customers(first_name, last_name)')
      .eq('cemetery_id', cem.id)
      .in('status', OPEN_STATUSES)
      .or('archived.is.null,archived.eq.false')
      .order('updated_at', { ascending: false })
      .limit(60)
    if (error) { undo.showError(error.message); setGraves([]); return }
    setGraves(data || [])
  }

  const go = goToUrl(cem)
  const digits = String(cem.contact_phone || '').replace(/\D/g, '')

  // Set the pin from where the phone is standing — instant write + 8s undo
  // back to whatever the pin was before.
  const markHere = () => {
    if (pinBusy) return
    if (!navigator.geolocation) { undo.showError('No GPS on this device.'); return }
    setPinBusy(true)
    const prev = { pin_lat: cem.pin_lat ?? null, pin_lng: cem.pin_lng ?? null, pin_set_by: cem.pin_set_by ?? null, pin_set_at: cem.pin_set_at ?? null }
    navigator.geolocation.getCurrentPosition(async (p) => {
      const patch = {
        pin_lat: p.coords.latitude, pin_lng: p.coords.longitude,
        pin_set_by: who?.name || null, pin_set_at: new Date().toISOString(),
      }
      const r = await updateCemeteryPermit(cem.id, patch)
      setPinBusy(false)
      if (!r.ok) { undo.showError(r.error || 'Could not save the pin.'); return }
      onPinSaved(patch)
      undo.show(`Pin set — ${cem.name}`, async () => {
        await updateCemeteryPermit(cem.id, prev).catch(() => {})
        onPinSaved(prev)
      })
    }, () => {
      setPinBusy(false)
      undo.showError('No GPS fix — step outside and try again.')
    }, { enableHighAccuracy: true, timeout: 12000 })
  }

  if (markFor) {
    const fam = (markFor.primary_lastname || [markFor.customer?.first_name, markFor.customer?.last_name].filter(Boolean).join(' ') || markFor.order_number || 'Order').toUpperCase()
    return (
      <div>
        <button type="button" className="fl-back" onClick={() => setMarkFor(null)}>&#8249; {cem.name}</button>
        <div className="fl-detfam" style={{ fontSize: 24 }}>{fam}</div>
        <div className="fl-detsub">Mark the exact grave &#8212; GPS, a note, a photo</div>
        <div className="fl-card">
          <MarkSpotForm order={markFor} undo={undo}
            onSaved={() => { setMarkFor(null); setGraves(null); setGravesOpen(false) }}
            onCancel={() => setMarkFor(null)} />
        </div>
      </div>
    )
  }

  return (
    <div>
      <button type="button" className="fl-back" onClick={onBack}>&#8249; Cemeteries</button>
      <div className="fl-detfam" style={{ fontSize: 26 }}>{cem.name}</div>
      <div className="fl-detsub">
        {[cem.address, [cem.city, cem.state].filter(Boolean).join(', '), cem.zip].filter(Boolean).join(' · ') || 'No address on file'}
      </div>

      {go && (
        <a className="fl-btn fl-btn-gold" style={{ display: 'block', textAlign: 'center', textDecoration: 'none', marginTop: 12 }}
          href={go} target="_blank" rel="noreferrer">
          GO TO {cem.pin_lat != null ? '— drives to the pin' : ''}
        </a>
      )}
      <div style={{ display: 'flex', gap: 8 }}>
        {digits && (
          <a className="fl-btn fl-btn-ghost" style={{ flex: 1, textAlign: 'center', textDecoration: 'none' }} href={`tel:${digits}`}>Call office</a>
        )}
        {cem.drive_link && (
          <a className="fl-btn fl-btn-ghost" style={{ flex: 1, textAlign: 'center', textDecoration: 'none' }} href={cem.drive_link} target="_blank" rel="noreferrer">Drive folder</a>
        )}
      </div>

      {/* Map pages */}
      <div className="fl-sect">
        <span className="fl-sect-h">Maps</span>
        {mapCount > 0 && <span className="fl-sect-pill">{mapCount}</span>}
      </div>
      {maps === null && <div className="fl-empty">Loading&#8230;</div>}
      {maps !== null && maps.length === 0 && (
        <div className="fl-empty-serif">No map pages uploaded yet &#8212; the desk adds them in the Cemeteries tab.</div>
      )}
      {maps !== null && maps.length > 0 && (
        <div className="fl-row" style={{ cursor: 'default', padding: '4px 14px' }}>
          {(mapsOpen ? maps : maps.slice(0, 6)).map(m => (
            <button key={m.id} type="button" className="fl-rowline" onClick={() => setViewer(m)}>
              <img src={m.image_url} alt="" loading="lazy"
                style={{ width: 46, height: 46, objectFit: 'cover', borderRadius: 6, border: '1px solid #EEE9DD', flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: 600, color: '#16150F', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {m.label || 'Map page'}
              </div>
              <span className="fl-chev">&#8250;</span>
            </button>
          ))}
          {maps.length > 6 && (
            <button type="button" className="fl-verb" style={{ width: '100%', marginTop: 8 }} onClick={() => setMapsOpen(v => !v)}>
              {mapsOpen ? 'SHOW FEWER' : `SHOW ALL ${maps.length}`}
            </button>
          )}
        </div>
      )}

      {/* The pin */}
      <div className="fl-sect"><span className="fl-sect-h">Location pin</span></div>
      <div className="fl-row" style={{ cursor: 'default' }}>
        <div style={{ fontSize: 12.5, color: '#55503F' }}>
          {cem.pin_lat != null
            ? <>Pinned at {Number(cem.pin_lat).toFixed(5)}, {Number(cem.pin_lng).toFixed(5)}{cem.pin_set_by ? ` — ${cem.pin_set_by}` : ''}</>
            : 'No pin yet. Stand at the entrance and mark it once — GO TO drives straight here forever after.'}
        </div>
        <button type="button" className="fl-btn fl-btn-ghost" style={{ marginTop: 10, marginBottom: 0 }} onClick={markHere} disabled={pinBusy}>
          {pinBusy ? 'Getting GPS…' : cem.pin_lat != null ? 'Move the pin to where I am' : 'Mark the location (I am here)'}
        </button>
      </div>

      {/* Grave marking */}
      <div className="fl-sect"><span className="fl-sect-h">Mark a grave</span></div>
      <div className="fl-row" style={{ cursor: 'default' }}>
        <div style={{ fontSize: 12.5, color: '#55503F' }}>
          Pin the exact grave on any open order or lead here &#8212; GPS, a note, a photo. The desk sees it on the order.
        </div>
        <button type="button" className="fl-btn fl-btn-ghost" style={{ marginTop: 10, marginBottom: 0 }} onClick={loadGraves}>
          {gravesOpen ? 'Hide the list' : 'Pick the order or lead'}
        </button>
        {gravesOpen && graves === null && <div className="fl-empty">Loading&#8230;</div>}
        {gravesOpen && Array.isArray(graves) && graves.length === 0 && (
          <div className="fl-empty-serif">No open orders or leads at this cemetery.</div>
        )}
        {gravesOpen && Array.isArray(graves) && graves.length > 0 && (
          <div style={{ marginTop: 6, borderTop: '1px solid #F0ECE2' }}>
            {graves.map(o => {
              const fam = o.primary_lastname || [o.customer?.first_name, o.customer?.last_name].filter(Boolean).join(' ') || '—'
              const marked = !!(o.field_location && (o.field_location.lat || o.field_location.note || o.field_location.photoUrl))
              return (
                <button key={o.id} type="button" className="fl-rowline" onClick={() => setMarkFor(o)}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: '#16150F', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {fam}
                      {o.order_number && <span style={{ color: '#6B6456', fontWeight: 600 }}> &#183; {o.order_number}</span>}
                    </div>
                    <div style={{ fontSize: 11.5, color: '#8A7F6C', marginTop: 2, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <span>{String(o.status).replace(/_/g, ' ')}</span>
                      {marked && <span className="fl-chip fl-c-good">SPOT MARKED</span>}
                    </div>
                  </div>
                  <span className="fl-chev">&#8250;</span>
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* Full-screen map viewer */}
      {viewer && (
        <div className="fl-zoom-overlay" onClick={() => setViewer(null)}>
          <button type="button" className="fl-zoom-close" aria-label="Close" onClick={() => setViewer(null)}>&#215;</button>
          <img src={viewer.image_url} alt={viewer.label || 'Map'} />
          <div style={{ position: 'fixed', bottom: 18, left: 0, right: 0, textAlign: 'center', color: '#fff', fontSize: 13, fontWeight: 600, textShadow: '0 1px 4px rgba(0,0,0,0.7)' }}>
            {viewer.label || 'Map page'}
          </div>
        </div>
      )}
    </div>
  )
}
