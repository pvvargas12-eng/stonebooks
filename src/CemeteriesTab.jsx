// =============================================================================
// CemeteriesTab — every cemetery, one place (2026-07-22)
// =============================================================================
// Paul: "a list of every single cemetery... their basic information... a google
// drive link or select their address like send a pin cause some dont show up on
// google... upload as many pics [of the maps] as I want and label each picture."
// Left: searchable roster. Right: editable info card, links-and-location card
// (Drive link + the manual PIN that beats a bad geocode), and the MAP PAGES
// grid — multi-file upload, label-per-picture (saved on blur), delete.
// The field app reads the same rows (GO TO rides the pin; maps render on the
// phone) — keep column names in lockstep with src/field/CemeteriesScreen.jsx.
// =============================================================================
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  listCemeteriesWithPermit, updateCemeteryPermit,
  listCemeteryMaps, addCemeteryMap, updateCemeteryMap, deleteCemeteryMap, countCemeteryMaps,
  getCurrentStaffName,
} from './lib/stonebooksData'

const INFO_FIELDS = [
  ['name', 'Name'], ['address', 'Address'], ['city', 'City'], ['state', 'State'],
  ['zip', 'Zip'], ['contact_phone', 'Phone'], ['contact_email', 'Email'], ['website', 'Website'],
]

// The pin wins; the geocode is the fallback; the address string is last.
function cemeteryMapsUrl(c) {
  if (c?.pin_lat != null && c?.pin_lng != null) return `https://www.google.com/maps/search/?api=1&query=${c.pin_lat},${c.pin_lng}`
  if (c?.geocoded_lat != null && c?.geocoded_lng != null) return `https://www.google.com/maps/search/?api=1&query=${c.geocoded_lat},${c.geocoded_lng}`
  const addr = [c?.address, c?.city, c?.state, c?.zip].filter(Boolean).join(', ')
  return addr ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addr)}` : null
}

export default function CemeteriesTab() {
  const [list, setList] = useState(null)
  const [mapCounts, setMapCounts] = useState(new Map())
  const [selId, setSelId] = useState(null)
  const [q, setQ] = useState('')
  const [flash, setFlash] = useState(null)
  const flashTimer = useRef(null)
  const say = (text, err = false) => {
    if (flashTimer.current) clearTimeout(flashTimer.current)
    setFlash({ text, err })
    flashTimer.current = setTimeout(() => setFlash(null), 3500)
  }

  const reload = async () => {
    const [rows, counts] = await Promise.all([listCemeteriesWithPermit(), countCemeteryMaps()])
    setList(rows || [])
    setMapCounts(counts)
  }
  useEffect(() => { reload() }, [])

  const sel = useMemo(() => (list || []).find(c => c.id === selId) || null, [list, selId])
  const visible = useMemo(() => {
    const norm = q.trim().toLowerCase()
    let rows = list || []
    if (norm) rows = rows.filter(c => [c.name, c.city, c.state].filter(Boolean).join(' ').toLowerCase().includes(norm))
    return rows
  }, [list, q])

  return (
    <div className="cmt-wrap">
      <style>{CSS}</style>
      {flash && <div className={`cmt-flash ${flash.err ? 'err' : ''}`}>{flash.text}</div>}
      <div className="cmt-head">
        <h1 className="cmt-title">Cemeteries</h1>
        <div className="cmt-sub">{list ? `${list.length} on the books` : 'Loading…'}</div>
      </div>
      <div className="cmt-grid">
        <aside className="cmt-list">
          <input className="cmt-input" placeholder="Search cemeteries…" value={q} onChange={e => setQ(e.target.value)} />
          <div className="cmt-rows">
            {(visible || []).map(c => (
              <button key={c.id} type="button" className={`cmt-row${selId === c.id ? ' on' : ''}`} onClick={() => setSelId(c.id)}>
                <span className="cmt-row-name">{c.name}</span>
                <span className="cmt-row-sub">
                  {[c.city, c.state].filter(Boolean).join(', ') || '—'}
                  {mapCounts.get(c.id) ? ` · ${mapCounts.get(c.id)} map${mapCounts.get(c.id) === 1 ? '' : 's'}` : ''}
                  {(c.pin_lat != null) ? ' · pin' : ''}
                </span>
              </button>
            ))}
            {visible && visible.length === 0 && <div className="cmt-empty">No cemetery matches.</div>}
          </div>
        </aside>
        <main className="cmt-main">
          {!sel
            ? <div className="cmt-empty" style={{ padding: 60, textAlign: 'center' }}>Pick a cemetery on the left — info, Drive link, location pin, and its map pages live here.</div>
            : <CemeteryDetail key={sel.id} cem={sel} say={say} onSaved={reload} />}
        </main>
      </div>
    </div>
  )
}

function CemeteryDetail({ cem, say, onSaved }) {
  const [draft, setDraft] = useState(() => {
    const d = {}
    for (const [k] of INFO_FIELDS) d[k] = cem[k] || ''
    d.notes = cem.notes || ''
    d.drive_link = cem.drive_link || ''
    return d
  })
  const [pinText, setPinText] = useState(() =>
    cem.pin_lat != null && cem.pin_lng != null ? `${cem.pin_lat}, ${cem.pin_lng}` : '')
  const [busy, setBusy] = useState(false)

  const saveInfo = async () => {
    setBusy(true)
    const patch = {}
    for (const [k] of INFO_FIELDS) patch[k] = (draft[k] || '').trim() || null
    patch.notes = (draft.notes || '').trim() || null
    patch.drive_link = (draft.drive_link || '').trim() || null
    const r = await updateCemeteryPermit(cem.id, patch)
    setBusy(false)
    if (!r.ok) { say(r.error, true); return }
    say('Saved.')
    onSaved()
  }

  const savePin = async (lat, lng) => {
    setBusy(true)
    const staff = await Promise.resolve(getCurrentStaffName()).catch(() => null)
    const r = await updateCemeteryPermit(cem.id, {
      pin_lat: lat, pin_lng: lng,
      pin_set_by: typeof staff === 'string' ? staff : null,
      pin_set_at: new Date().toISOString(),
    })
    setBusy(false)
    if (!r.ok) { say(r.error, true); return }
    say(lat == null ? 'Pin cleared.' : 'Pin saved — GO TO uses it everywhere now.')
    onSaved()
  }
  const setPinFromText = () => {
    const m = pinText.trim().match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/)
    if (!m) { say('Paste the pin as "latitude, longitude" — e.g. 40.5093, -74.2887 (copy it from Google Maps).', true); return }
    savePin(Number(m[1]), Number(m[2]))
  }

  const mapsUrl = cemeteryMapsUrl(cem)

  return (
    <div className="cmt-detail">
      <section className="cmt-card">
        <div className="cmt-card-head">
          <h2 className="cmt-h2">{cem.name}</h2>
          <button type="button" className="cmt-btn cmt-btn-gold" onClick={saveInfo} disabled={busy}>Save</button>
        </div>
        <div className="cmt-info-grid">
          {INFO_FIELDS.map(([k, label]) => (
            <label key={k} className="cmt-field">
              <span>{label}</span>
              <input className="cmt-input" value={draft[k]} onChange={e => setDraft(d => ({ ...d, [k]: e.target.value }))} />
            </label>
          ))}
        </div>
        <label className="cmt-field">
          <span>Notes</span>
          <textarea className="cmt-input" rows={2} value={draft.notes} onChange={e => setDraft(d => ({ ...d, notes: e.target.value }))} />
        </label>
      </section>

      <section className="cmt-card">
        <h2 className="cmt-h2">Location &amp; links</h2>
        <label className="cmt-field">
          <span>Google Drive link</span>
          <div className="cmt-inline">
            <input className="cmt-input" placeholder="https://drive.google.com/…" value={draft.drive_link}
              onChange={e => setDraft(d => ({ ...d, drive_link: e.target.value }))} onBlur={saveInfo} />
            {cem.drive_link && <a className="cmt-btn" href={cem.drive_link} target="_blank" rel="noreferrer">Open</a>}
          </div>
        </label>
        <label className="cmt-field">
          <span>Location pin — for the cemeteries Google can't find</span>
          <div className="cmt-inline">
            <input className="cmt-input" placeholder="latitude, longitude — paste from Google Maps" value={pinText}
              onChange={e => setPinText(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') setPinFromText() }} />
            <button type="button" className="cmt-btn" onClick={setPinFromText} disabled={busy}>Set pin</button>
            {cem.pin_lat != null && (
              <button type="button" className="cmt-btn cmt-btn-quiet" onClick={() => { setPinText(''); savePin(null, null) }} disabled={busy}>Clear</button>
            )}
          </div>
        </label>
        <div className="cmt-pinline">
          {cem.pin_lat != null
            ? <>Pin set{cem.pin_set_by ? ` by ${cem.pin_set_by}` : ''}{cem.pin_set_at ? ` · ${String(cem.pin_set_at).slice(0, 10)}` : ''}. The field app's GO TO drives to it.</>
            : (cem.geocoded_lat != null
              ? 'No manual pin — directions fall back to the auto-geocoded spot.'
              : 'No pin and no geocode — directions use the street address text.')}
          {mapsUrl && <> · <a href={mapsUrl} target="_blank" rel="noreferrer">Open in Google Maps</a></>}
        </div>
      </section>

      <MapPages cem={cem} say={say} onChanged={onSaved} />
    </div>
  )
}

// The map pages — bulk upload, label each picture, delete with a confirm.
function MapPages({ cem, say, onChanged }) {
  const [maps, setMaps] = useState(null)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(null)   // '3 / 12'
  const [labels, setLabels] = useState({})         // id -> draft label
  const [viewer, setViewer] = useState(null)       // map row for full-size view
  const fileRef = useRef(null)

  const reload = async () => setMaps(await listCemeteryMaps(cem.id))
  useEffect(() => { reload() }, [cem.id])   // eslint-disable-line react-hooks/exhaustive-deps

  const onFiles = async (files) => {
    if (!files?.length) return
    setBusy(true)
    const staff = await Promise.resolve(getCurrentStaffName()).catch(() => null)
    let base = (maps?.length || 0)
    let done = 0
    for (const file of files) {
      setProgress(`${done + 1} / ${files.length}`)
      const label = String(file.name || '').replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim()
      const r = await addCemeteryMap(cem.id, file, { label, sortOrder: base++, uploadedBy: typeof staff === 'string' ? staff : null })
      if (!r.ok) say(`${file.name}: ${r.error}`, true)
      done++
    }
    setProgress(null)
    setBusy(false)
    await reload()
    onChanged()
    say(`${done} map page${done === 1 ? '' : 's'} uploaded — label each one below.`)
  }

  const saveLabel = async (m) => {
    const v = labels[m.id]
    if (v === undefined || v === (m.label || '')) return
    const r = await updateCemeteryMap(m.id, { label: v })
    if (!r.ok) { say(r.error, true); return }
    setMaps(prev => prev.map(x => x.id === m.id ? { ...x, label: v.trim() || null } : x))
  }
  const remove = async (m) => {
    if (!window.confirm(`Delete this map page${m.label ? ` ("${m.label}")` : ''}? The picture is removed for everyone, including the phones.`)) return
    const r = await deleteCemeteryMap(m)
    if (!r.ok) { say(r.error, true); return }
    setMaps(prev => prev.filter(x => x.id !== m.id))
    onChanged()
  }

  return (
    <section className="cmt-card">
      <div className="cmt-card-head">
        <h2 className="cmt-h2">Map pages {maps ? `(${maps.length})` : ''}</h2>
        <button type="button" className="cmt-btn cmt-btn-gold" onClick={() => fileRef.current?.click()} disabled={busy}>
          {busy ? `Uploading ${progress || '…'}` : '+ Upload map pictures'}
        </button>
        <input ref={fileRef} type="file" accept="image/*" multiple style={{ display: 'none' }}
          onChange={e => { onFiles([...e.target.files]); e.target.value = '' }} />
      </div>
      <div className="cmt-hint">Pick as many pictures as you want in one go — each becomes a labeled page (label starts as the file name; fix it right on the card). The phones see the same pages.</div>
      {!maps && <div className="cmt-empty">Loading…</div>}
      {maps && maps.length === 0 && <div className="cmt-empty">No map pages yet.</div>}
      {maps && maps.length > 0 && (
        <div className="cmt-mapsgrid">
          {maps.map(m => (
            <div key={m.id} className="cmt-mapcard">
              <button type="button" className="cmt-mapimg" onClick={() => setViewer(m)} title="View full size">
                <img src={m.image_url} alt={m.label || 'Map page'} loading="lazy" />
              </button>
              <input className="cmt-input cmt-maplabel" placeholder="Label — e.g. Section C blocks 1-9"
                value={labels[m.id] ?? (m.label || '')}
                onChange={e => setLabels(prev => ({ ...prev, [m.id]: e.target.value }))}
                onBlur={() => saveLabel(m)}
                onKeyDown={e => { if (e.key === 'Enter') e.target.blur() }} />
              <button type="button" className="cmt-mapdel" onClick={() => remove(m)} title="Delete this page">Delete</button>
            </div>
          ))}
        </div>
      )}
      {viewer && (
        <div className="cmt-viewer" onClick={() => setViewer(null)}>
          <img src={viewer.image_url} alt={viewer.label || 'Map'} />
          <div className="cmt-viewer-label">{viewer.label || 'Map page'} — click anywhere to close</div>
        </div>
      )}
    </section>
  )
}

const CSS = `
  .cmt-wrap { padding: 24px 28px; max-width: 1500px; margin: 0 auto; }
  .cmt-flash { position: fixed; top: 14px; left: 50%; transform: translateX(-50%); z-index: 1200; background: #1D9E75; color: #fff; font-size: 13px; padding: 8px 18px; border-radius: 8px; box-shadow: 0 6px 20px rgba(15,20,25,0.25); }
  .cmt-flash.err { background: #b54040; }
  .cmt-head { margin-bottom: 16px; }
  .cmt-title { font-size: 24px; font-weight: 700; color: #0f1419; margin: 0; }
  .cmt-sub { font-size: 13px; color: #7a756a; margin-top: 4px; }
  .cmt-grid { display: grid; grid-template-columns: 320px minmax(0, 1fr); gap: 18px; align-items: start; }
  @media (max-width: 980px) { .cmt-grid { grid-template-columns: 1fr; } }
  .cmt-list { background: #fff; border: 0.5px solid #e6e2d8; border-radius: 12px; padding: 12px; position: sticky; top: 16px; }
  .cmt-rows { display: flex; flex-direction: column; max-height: 72vh; overflow-y: auto; margin-top: 10px; }
  .cmt-row { font: inherit; text-align: left; background: none; border: none; border-top: 0.5px solid #f1efeb; cursor: pointer; padding: 9px 8px; border-radius: 8px; }
  .cmt-row:first-child { border-top: none; }
  .cmt-row:hover { background: #faf8f4; }
  .cmt-row.on { background: rgba(154,114,9,0.1); }
  .cmt-row-name { display: block; font-size: 13.5px; font-weight: 600; color: #1e2d3d; }
  .cmt-row-sub { display: block; font-size: 11.5px; color: #8a8a85; margin-top: 1px; }
  .cmt-main { min-width: 0; }
  .cmt-detail { display: flex; flex-direction: column; gap: 14px; }
  .cmt-card { background: #fff; border: 0.5px solid #e6e2d8; border-radius: 12px; padding: 16px 18px; }
  .cmt-card-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 10px; }
  .cmt-h2 { font-size: 16px; font-weight: 700; color: #1e2d3d; margin: 0; }
  .cmt-input { font: inherit; font-size: 13.5px; padding: 8px 10px; width: 100%; border: 0.5px solid #d8d2c4; border-radius: 7px; background: #fff; color: #2a2a2a; }
  .cmt-input:focus { outline: none; border-color: #9A7209; box-shadow: 0 0 0 2px rgba(154,114,9,0.14); }
  .cmt-info-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 10px; margin-bottom: 10px; }
  .cmt-field { display: flex; flex-direction: column; gap: 4px; }
  .cmt-field > span { font-size: 11px; font-weight: 700; letter-spacing: 0.07em; text-transform: uppercase; color: #8a8472; }
  .cmt-inline { display: flex; gap: 8px; align-items: center; }
  .cmt-btn { font: inherit; font-size: 12.5px; font-weight: 600; padding: 7px 14px; cursor: pointer; border: 0.5px solid #c9c2b0; border-radius: 7px; background: #fff; color: #2a2a27; text-decoration: none; white-space: nowrap; }
  .cmt-btn:hover:not(:disabled) { border-color: #9A7209; color: #9A7209; }
  .cmt-btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .cmt-btn-gold { background: #9A7209; border-color: #9A7209; color: #fff; }
  .cmt-btn-gold:hover:not(:disabled) { background: #7d5d07; color: #fff; }
  .cmt-btn-quiet { border-color: transparent; color: #8a8a85; }
  .cmt-pinline { font-size: 12.5px; color: #6b6256; margin-top: 8px; }
  .cmt-pinline a { color: #9A7209; font-weight: 700; }
  .cmt-hint { font-size: 12px; color: #8a8a85; margin-bottom: 12px; }
  .cmt-empty { font-size: 13px; color: #9a948a; padding: 12px 4px; }
  .cmt-mapsgrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 12px; }
  .cmt-mapcard { display: flex; flex-direction: column; gap: 6px; background: #faf8f4; border: 0.5px solid #eee9dd; border-radius: 10px; padding: 8px; }
  .cmt-mapimg { font: inherit; border: none; background: #fff; border-radius: 7px; padding: 0; cursor: zoom-in; overflow: hidden; }
  .cmt-mapimg img { width: 100%; height: 140px; object-fit: contain; display: block; }
  .cmt-maplabel { font-size: 12.5px; }
  .cmt-mapdel { font: inherit; font-size: 11.5px; font-weight: 600; border: none; background: none; color: #b3261e; cursor: pointer; align-self: flex-end; padding: 2px 4px; }
  .cmt-mapdel:hover { text-decoration: underline; }
  .cmt-viewer { position: fixed; inset: 0; z-index: 1300; background: rgba(15,20,25,0.85); display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; padding: 24px; cursor: zoom-out; }
  .cmt-viewer img { max-width: 96vw; max-height: 88vh; object-fit: contain; border-radius: 6px; background: #fff; }
  .cmt-viewer-label { color: #fff; font-size: 13px; }
`
