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
import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import {
  listCemeteriesWithPermit, updateCemeteryPermit, listCemeteryMaps, countCemeteryMaps,
  addCemeteryMap, listMapPins, addMapPin, deleteMapPin,
} from '../lib/stonebooksData'
import { directionsUrl } from './fieldShared'
import { MarkSpotForm } from './JobDetailScreen'

const famNameOf = (o) => o?.primary_lastname
  || [o?.customer?.first_name, o?.customer?.last_name].filter(Boolean).join(' ')
  || o?.order_number || '—'

// GO TO target: manual pin first, then the shared address/geocode fallback.
const goToUrl = (c) => {
  if (c?.pin_lat != null && c?.pin_lng != null) return `https://maps.apple.com/?daddr=${c.pin_lat},${c.pin_lng}`
  return directionsUrl(c)
}

const OPEN_STATUSES = ['draft', 'scoping', 'quoted', 'contracted', 'in_production', 'installed', 'paid_in_full']

export default function CemeteriesScreen({ who, undo, onBack, onOpenJob }) {
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
    return <CemeteryDetail cem={sel} who={who} undo={undo} onOpenJob={onOpenJob}
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

function CemeteryDetail({ cem, who, undo, mapCount, onBack, onPinSaved, onOpenJob }) {
  const [maps, setMaps] = useState(null)
  const [mapsOpen, setMapsOpen] = useState(false)
  const [viewer, setViewer] = useState(null)     // map row full-screen
  const [gravePins, setGravePins] = useState([]) // pins across this cemetery's maps
  const [pinBusy, setPinBusy] = useState(false)
  const [graves, setGraves] = useState(null)     // open orders/leads here
  const [gravesOpen, setGravesOpen] = useState(false)
  const [markFor, setMarkFor] = useState(null)   // order being marked
  const [snapping, setSnapping] = useState(false)  // camera run active
  const [snapCount, setSnapCount] = useState(0)
  const [snapBusy, setSnapBusy] = useState(false)
  const snapRef = useRef(null)

  useEffect(() => {
    let cancelled = false
    listCemeteryMaps(cem.id).then(m => { if (!cancelled) setMaps(m || []) }).catch(() => { if (!cancelled) setMaps([]) })
    listMapPins(cem.id).then(p => { if (!cancelled) setGravePins(p || []) }).catch(() => { /* pins are additive */ })
    return () => { cancelled = true }
  }, [cem.id])

  // Open orders/leads here — shared by the Mark-a-grave list and the map
  // viewer's drop-a-pin picker. Fetched once on first need.
  const ensureGraves = async () => {
    if (graves) return graves
    const { data, error } = await supabase.from('orders')
      .select('id, order_number, primary_lastname, status, field_location, grave_location, plot_section, plot_grave, customer:customers(first_name, last_name)')
      .eq('cemetery_id', cem.id)
      .in('status', OPEN_STATUSES)
      .or('archived.is.null,archived.eq.false')
      .order('updated_at', { ascending: false })
      .limit(60)
    if (error) { undo.showError(error.message); setGraves([]); return [] }
    setGraves(data || [])
    return data || []
  }
  const loadGraves = async () => {
    if (graves) { setGravesOpen(v => !v); return }
    setGravesOpen(true)
    await ensureGraves()
  }

  // "Very very quickly just start snapping photos" (Paul) — one tap opens the
  // camera; every shot uploads as the next labeled page and the camera comes
  // straight back (with a tap-fallback bar for browsers that block the
  // re-open). Cancel the camera or hit DONE to end the run.
  const startSnapping = () => {
    setSnapping(true)
    setSnapCount(0)
    snapRef.current?.click()
  }
  const onSnap = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setSnapBusy(true)
    const n = (maps?.length || 0) + 1
    const r = await addCemeteryMap(cem.id, file, { label: `Page ${n}`, sortOrder: n - 1, uploadedBy: who?.name || null })
    setSnapBusy(false)
    if (!r.ok) { undo.showError(r.error || 'Upload failed.'); return }
    setMaps(prev => [...(prev || []), r.map])
    setSnapCount(c => c + 1)
    requestAnimationFrame(() => snapRef.current?.click())
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
        {maps !== null && maps.length > 0 && <span className="fl-sect-pill">{maps.length}</span>}
        {maps === null && mapCount > 0 && <span className="fl-sect-pill">{mapCount}</span>}
      </div>
      <input ref={snapRef} type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={onSnap} />
      {!snapping ? (
        <button type="button" className="fl-btn fl-btn-gold" onClick={startSnapping}>
          Snap map pages &#8212; camera stays open
        </button>
      ) : (
        <div className="fl-card" style={{ marginBottom: 10 }}>
          <div className="fl-eyebrow">Snapping run</div>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#16150F' }}>
            {snapCount} page{snapCount === 1 ? '' : 's'} saved{snapBusy ? ' — saving…' : ''}
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button type="button" className="fl-btn fl-btn-ghost" style={{ flex: 1, marginBottom: 0 }}
              onClick={() => setSnapping(false)} disabled={snapBusy}>Done</button>
            <button type="button" className="fl-btn fl-btn-gold" style={{ flex: 1, marginBottom: 0 }}
              onClick={() => snapRef.current?.click()} disabled={snapBusy}>Snap next page</button>
          </div>
        </div>
      )}
      {maps === null && <div className="fl-empty">Loading&#8230;</div>}
      {maps !== null && maps.length === 0 && !snapping && (
        <div className="fl-empty-serif">No map pages yet &#8212; snap the binder right here, or the desk uploads in the Cemeteries tab.</div>
      )}
      {maps !== null && maps.length > 0 && (
        <div className="fl-row" style={{ cursor: 'default', padding: '4px 14px' }}>
          {(mapsOpen ? maps : maps.slice(0, 6)).map(m => {
            const nPins = gravePins.filter(p => p.map_id === m.id).length
            return (
              <button key={m.id} type="button" className="fl-rowline" onClick={() => setViewer(m)}>
                <img src={m.image_url} alt="" loading="lazy"
                  style={{ width: 46, height: 46, objectFit: 'cover', borderRadius: 6, border: '1px solid #EEE9DD', flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600, color: '#16150F', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {m.label || 'Map page'}
                  </div>
                  {nPins > 0 && (
                    <div style={{ marginTop: 2 }}><span className="fl-chip fl-c-good">{nPins} GRAVE PIN{nPins === 1 ? '' : 'S'}</span></div>
                  )}
                </div>
                <span className="fl-chev">&#8250;</span>
              </button>
            )
          })}
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

      {/* Full-screen map viewer with grave pins */}
      {viewer && (
        <MapPinViewer
          map={viewer}
          pins={gravePins.filter(p => p.map_id === viewer.id)}
          cem={cem}
          who={who}
          undo={undo}
          ensureGraves={ensureGraves}
          onPinsChanged={setGravePins}
          onOpenOrder={(orderId) => onOpenJob?.({ orderId, jobId: null }, 'menu')}
          onClose={() => setViewer(null)}
        />
      )}
    </div>
  )
}

// Full-screen map page: pinch/scroll the sheet, tap a pin for who it is, or
// DROP A PIN — pick the order, tap the grave. Pins vanish on their own when
// the order closes out (read-time filter).
function MapPinViewer({ map, pins, cem, who, undo, ensureGraves, onPinsChanged, onOpenOrder, onClose }) {
  const [pinFor, setPinFor] = useState('')       // orderId mid-placement
  const [pickOpen, setPickOpen] = useState(false)
  const [orders, setOrders] = useState(null)
  const [activePin, setActivePin] = useState(null)
  const wrapRef = useRef(null)

  const openPicker = async () => {
    setPickOpen(v => !v)
    setActivePin(null)
    if (!orders) setOrders(await ensureGraves())
  }
  const tapMap = (e) => {
    if (!pinFor || !wrapRef.current) { setActivePin(null); return }
    const rect = wrapRef.current.getBoundingClientRect()
    const x = (e.clientX - rect.left) / rect.width
    const y = (e.clientY - rect.top) / rect.height
    const o = (orders || []).find(g => g.id === pinFor)
    setPinFor('')
    addMapPin({
      cemeteryId: cem.id, mapId: map.id, orderId: o?.id || pinFor, x, y,
      label: o ? famNameOf(o) : null, createdBy: who?.name || null,
    }).then(r => {
      if (!r.ok) { undo.showError(r.error || 'Could not drop the pin.'); return }
      onPinsChanged(prev => [...prev, r.pin])
      undo.show(`Pin dropped — ${o ? famNameOf(o) : 'grave'}`, async () => {
        await deleteMapPin(r.pin.id).catch(() => {})
        onPinsChanged(prev => prev.filter(p => p.id !== r.pin.id))
      })
    })
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 95, background: 'rgba(10,12,16,0.96)', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', flexShrink: 0 }}>
        <div style={{ flex: 1, minWidth: 0, color: '#fff', fontSize: 14.5, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {map.label || 'Map page'}
        </div>
        <button type="button" onClick={onClose}
          style={{ background: 'rgba(255,255,255,0.14)', border: 'none', color: '#fff', fontSize: 20, lineHeight: 1, borderRadius: 8, padding: '6px 12px' }}>
          &#215;
        </button>
      </div>
      <div style={{ flex: 1, overflow: 'auto', WebkitOverflowScrolling: 'touch' }}>
        <div ref={wrapRef} onClick={tapMap}
          style={{ position: 'relative', cursor: pinFor ? 'crosshair' : 'default' }}>
          <img src={map.image_url} alt={map.label || 'Map'} draggable={false}
            style={{ display: 'block', width: '100%', height: 'auto' }} />
          {pins.map(p => (
            <button key={p.id} type="button"
              onClick={e => { e.stopPropagation(); setActivePin(a => a?.id === p.id ? null : p); setPinFor(''); setPickOpen(false) }}
              style={{
                position: 'absolute', left: `${(Number(p.x) || 0) * 100}%`, top: `${(Number(p.y) || 0) * 100}%`,
                transform: 'translate(-50%, -100%)', background: 'none', border: 'none', padding: '0 0 2px',
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1,
              }}>
              <span style={{
                fontSize: 10, fontWeight: 800, color: '#16150F', background: 'rgba(255,255,255,0.94)',
                borderRadius: 4, padding: '1px 5px', whiteSpace: 'nowrap', boxShadow: '0 1px 3px rgba(0,0,0,0.4)',
              }}>{p.label || famNameOf(p.order)}</span>
              <span style={{
                width: 15, height: 15, borderRadius: '50% 50% 50% 0', transform: 'rotate(-45deg)',
                background: activePin?.id === p.id ? '#E24B4A' : '#C79B2E', border: '2px solid #fff',
                boxShadow: '0 1px 4px rgba(0,0,0,0.6)',
              }} />
            </button>
          ))}
        </div>
      </div>
      <div style={{ flexShrink: 0, padding: '10px 14px calc(14px + env(safe-area-inset-bottom))', background: '#0F1419' }}>
        {activePin ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ flex: 1, minWidth: 0, color: '#fff' }}>
              <div style={{ fontSize: 14.5, fontWeight: 800, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {activePin.label || famNameOf(activePin.order)}
              </div>
              <div style={{ fontSize: 11.5, color: '#B9AE93' }}>{activePin.order?.order_number || ''}</div>
            </div>
            {activePin.order?.id && (
              <button type="button" className="fl-verb" onClick={() => { onClose(); onOpenOrder(activePin.order.id) }}>OPEN ORDER</button>
            )}
            <button type="button" className="fl-verb" onClick={() => setActivePin(null)}>CLOSE</button>
          </div>
        ) : pinFor ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ flex: 1, color: '#F0C24B', fontSize: 13.5, fontWeight: 700 }}>
              Tap the map right on the grave
            </div>
            <button type="button" className="fl-verb" onClick={() => setPinFor('')}>CANCEL</button>
          </div>
        ) : pickOpen ? (
          <div>
            <div style={{ color: '#B9AE93', fontSize: 11.5, fontWeight: 700, letterSpacing: '0.06em', marginBottom: 6 }}>
              WHOSE GRAVE? {orders === null ? '(loading…)' : ''}
            </div>
            <div style={{ maxHeight: 180, overflowY: 'auto' }}>
              {(orders || []).map(o => (
                <button key={o.id} type="button"
                  onClick={() => { setPinFor(o.id); setPickOpen(false) }}
                  style={{ display: 'block', width: '100%', textAlign: 'left', background: 'none', border: 'none', color: '#fff', fontSize: 14, fontWeight: 700, padding: '9px 2px', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
                  {famNameOf(o)}{o.order_number ? ` · ${o.order_number}` : ''}
                </button>
              ))}
              {Array.isArray(orders) && orders.length === 0 && (
                <div style={{ color: '#B9AE93', fontSize: 13 }}>No open orders or leads at this cemetery.</div>
              )}
            </div>
            <button type="button" className="fl-verb" style={{ width: '100%', marginTop: 8 }} onClick={() => setPickOpen(false)}>CANCEL</button>
          </div>
        ) : (
          <button type="button" className="fl-btn fl-btn-gold" style={{ marginBottom: 0 }} onClick={openPicker}>
            Drop a grave pin
          </button>
        )}
      </div>
    </div>
  )
}
