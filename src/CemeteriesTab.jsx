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
  cemeteryRefCounts, mergeCemeteries, listOrdersAtCemetery, listPermitTemplatesForCemetery,
  getCurrentStaffName,
} from './lib/stonebooksData'

// Duplicate scent: lowercase, strip punctuation, Saint→St / Mount→Mt, drop the
// suffix words (cemetery/memorial/park/…) — "ALPINE" and "Alpine Cemetery"
// land on the same key. Deliberately conservative: typos don't group (merge
// those by hand from the detail's Merge button).
const normCemName = (n) => String(n || '')
  .toLowerCase()
  .replace(/[.'’,()–—-]/g, ' ')
  .replace(/\bsaint\b/g, 'st')
  .replace(/\bmount\b/g, 'mt')
  .replace(/\b(cemetery|cem|memorial|park|gardens?|mausoleum)\b/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()

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

export default function CemeteriesTab({ onOpenOrder }) {
  const [list, setList] = useState(null)
  const [mapCounts, setMapCounts] = useState(new Map())
  const [selId, setSelId] = useState(null)
  const [q, setQ] = useState('')
  const [merge, setMerge] = useState(null)   // { keepId, awayId } | null
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

  // Possible duplicates — same normalized scent, 2+ rows.
  const dupGroups = useMemo(() => {
    const byKey = new Map()
    for (const c of (list || [])) {
      const key = normCemName(c.name)
      if (!key) continue
      if (!byKey.has(key)) byKey.set(key, [])
      byKey.get(key).push(c)
    }
    return [...byKey.entries()].filter(([, rows]) => rows.length > 1)
      .map(([key, rows]) => ({ key, rows }))
      .sort((a, b) => a.rows[0].name.localeCompare(b.rows[0].name))
  }, [list])

  // Merge review from a dup group: keep the row that looks most "real"
  // (address on file, then more map pages) — swappable in the modal.
  const openGroupMerge = (g) => {
    const score = (c) => (c.address ? 4 : 0) + (mapCounts.get(c.id) || 0) + (c.pin_lat != null ? 1 : 0)
    const sorted = [...g.rows].sort((a, b) => score(b) - score(a))
    setMerge({ keepId: sorted[0].id, awayId: sorted[1].id })
  }

  const onMerged = (keepId, awayId) => {
    setMerge(null)
    if (selId === awayId) setSelId(keepId)
    reload()
  }

  return (
    <div className="cmt-wrap">
      <style>{CSS}</style>
      {flash && <div className={`cmt-flash ${flash.err ? 'err' : ''}`}>{flash.text}</div>}
      <div className="cmt-head">
        <h1 className="cmt-title">Cemeteries</h1>
        <div className="cmt-sub">{list ? `${list.length} on the books` : 'Loading…'}</div>
      </div>

      {dupGroups.length > 0 && (
        <div className="cmt-dup">
          <div className="cmt-dup-head">
            Possible duplicates — {dupGroups.length} group{dupGroups.length === 1 ? '' : 's'}. Merging moves every order, permit, map page, and scheduled run onto the one you keep.
          </div>
          {dupGroups.map(g => (
            <div key={g.key} className="cmt-dup-row">
              <span className="cmt-dup-names">{g.rows.map(r => r.name).join('   ·   ')}</span>
              <button type="button" className="cmt-btn" onClick={() => openGroupMerge(g)}>Review merge</button>
            </div>
          ))}
        </div>
      )}

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
            : <CemeteryDetail key={sel.id} cem={sel} say={say} onSaved={reload}
                onOpenOrder={onOpenOrder}
                onStartMerge={() => setMerge({ keepId: '', awayId: sel.id })} />}
        </main>
      </div>

      {merge && (
        <MergeModal
          list={list || []}
          initialKeepId={merge.keepId}
          initialAwayId={merge.awayId}
          say={say}
          onClose={() => setMerge(null)}
          onMerged={onMerged}
        />
      )}
    </div>
  )
}

// ── Merge modal — fold a duplicate into the keeper ──────────────────────────
function MergeModal({ list, initialKeepId, initialAwayId, say, onClose, onMerged }) {
  const [keepId, setKeepId] = useState(initialKeepId || '')
  const [awayId, setAwayId] = useState(initialAwayId || '')
  const [counts, setCounts] = useState(null)
  const [busy, setBusy] = useState(false)
  const keep = list.find(c => c.id === keepId) || null
  const away = list.find(c => c.id === awayId) || null

  useEffect(() => {
    if (!awayId) { setCounts(null); return }
    let alive = true
    setCounts(null)
    cemeteryRefCounts(awayId).then(c => { if (alive) setCounts(c) }).catch(() => { if (alive) setCounts(null) })
    return () => { alive = false }
  }, [awayId])

  const doMerge = async () => {
    if (!keep || !away || busy) return
    setBusy(true)
    const r = await mergeCemeteries(away.id, keep.id)
    setBusy(false)
    if (!r.ok) { say(r.error, true); return }
    say(`Merged — "${away.name}" folded into "${keep.name}".`)
    onMerged(keep.id, away.id)
  }

  const pickRow = (label, value, setValue, excludeId) => (
    <label className="cmt-field">
      <span>{label}</span>
      <select className="cmt-input" value={value} onChange={e => setValue(e.target.value)}>
        <option value="">— pick a cemetery —</option>
        {list.filter(c => c.id !== excludeId).map(c => (
          <option key={c.id} value={c.id}>{c.name}{c.city ? ` — ${c.city}` : ''}</option>
        ))}
      </select>
    </label>
  )

  return (
    <div className="cmt-viewer" style={{ cursor: 'default', alignItems: 'center' }} onClick={busy ? undefined : onClose}>
      <div className="cmt-card" style={{ maxWidth: 520, width: '100%', cursor: 'default' }} onClick={e => e.stopPropagation()}>
        <h2 className="cmt-h2" style={{ marginBottom: 4 }}>Merge duplicates</h2>
        <div className="cmt-hint">
          Everything on the duplicate — orders, permit templates, built permits, map pages, scheduled runs — moves onto the keeper. Blank info on the keeper (phone, address, pin, Drive link) fills in from the duplicate. The duplicate row is then removed. Nothing about any order changes except which cemetery it points to.
        </div>
        {pickRow('Keep this one', keepId, setKeepId, awayId)}
        {pickRow('Merge this one away', awayId, setAwayId, keepId)}
        {keep && away && (
          <button type="button" className="cmt-btn cmt-btn-quiet" style={{ margin: '2px 0 8px' }}
            onClick={() => { setKeepId(away.id); setAwayId(keep.id) }}>
            Swap direction
          </button>
        )}
        {away && (
          <div className="cmt-pinline" style={{ marginTop: 4 }}>
            {counts === null
              ? `Counting what's on "${away.name}"…`
              : `Moving from "${away.name}": ${counts.orders} order${counts.orders === 1 ? '' : 's'} · ${counts.templates} permit template${counts.templates === 1 ? '' : 's'} · ${counts.docs} built permit${counts.docs === 1 ? '' : 's'} · ${counts.maps} map page${counts.maps === 1 ? '' : 's'} · ${counts.batches} scheduled run${counts.batches === 1 ? '' : 's'}`}
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}>
          <button type="button" className="cmt-btn cmt-btn-quiet" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className="cmt-btn cmt-btn-danger" onClick={doMerge}
            disabled={busy || !keep || !away || counts === null}>
            {busy ? 'Merging…' : keep ? `Merge — keep "${keep.name}"` : 'Merge'}
          </button>
        </div>
      </div>
    </div>
  )
}

function CemeteryDetail({ cem, say, onSaved, onOpenOrder, onStartMerge }) {
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
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="cmt-btn cmt-btn-danger-quiet" onClick={onStartMerge}
              title="This cemetery is a duplicate — fold it into the real one">
              Merge…
            </button>
            <button type="button" className="cmt-btn cmt-btn-gold" onClick={saveInfo} disabled={busy}>Save</button>
          </div>
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

      <CemeteryWork cem={cem} onOpenOrder={onOpenOrder} />

      <MapPages cem={cem} say={say} onChanged={onSaved} />
    </div>
  )
}

// What's happening AT this cemetery — the open orders/leads and the permit
// templates bound to it. Read-only glance; rows open the order.
function CemeteryWork({ cem, onOpenOrder }) {
  const [orders, setOrders] = useState(null)
  const [templates, setTemplates] = useState(null)
  const [showAll, setShowAll] = useState(false)

  useEffect(() => {
    let alive = true
    Promise.all([listOrdersAtCemetery(cem.id), listPermitTemplatesForCemetery(cem.id)]).then(([o, t]) => {
      if (!alive) return
      setOrders(o); setTemplates(t)
    }).catch(() => { if (alive) { setOrders([]); setTemplates([]) } })
    return () => { alive = false }
  }, [cem.id])

  const rows = orders ? (showAll ? orders : orders.slice(0, 10)) : null
  return (
    <section className="cmt-card">
      <h2 className="cmt-h2">Work here</h2>
      {templates !== null && (
        <div className="cmt-pinline" style={{ marginTop: 6 }}>
          {templates.length === 0
            ? <>No permit template bound to this cemetery yet — set one up in Permit Builder.</>
            : <>Permit template{templates.length === 1 ? '' : 's'}: {templates.map(t => t.title).join(' · ')}</>}
        </div>
      )}
      <div className="cmt-hint" style={{ margin: '10px 0 6px' }}>
        {orders === null ? 'Loading open orders…' : `${orders.length} open order${orders.length === 1 ? '' : 's'} and lead${orders.length === 1 ? '' : 's'} at this cemetery.`}
      </div>
      {rows && rows.length > 0 && (
        <div className="cmt-workrows">
          {rows.map(o => {
            const fam = o.primary_lastname || [o.customer?.first_name, o.customer?.last_name].filter(Boolean).join(' ') || '—'
            return (
              <button key={o.id} type="button" className="cmt-workrow" onClick={() => onOpenOrder?.(o.id)}
                title="Open the order">
                <span className="cmt-workrow-fam">{fam}</span>
                <span className="cmt-workrow-num">{o.order_number || 'DRAFT'}</span>
                <span className="cmt-workrow-status">{String(o.status || '').replace(/_/g, ' ')}</span>
              </button>
            )
          })}
        </div>
      )}
      {orders && orders.length > 10 && (
        <button type="button" className="cmt-btn cmt-btn-quiet" style={{ marginTop: 8 }} onClick={() => setShowAll(v => !v)}>
          {showAll ? 'Show fewer' : `Show all ${orders.length}`}
        </button>
      )}
    </section>
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
  .cmt-btn-danger { background: #b54040; border-color: #b54040; color: #fff; }
  .cmt-btn-danger:hover:not(:disabled) { background: #983434; border-color: #983434; color: #fff; }
  .cmt-btn-danger-quiet { border-color: transparent; color: #b3261e; }
  .cmt-btn-danger-quiet:hover:not(:disabled) { border-color: #b3261e; color: #b3261e; }
  .cmt-dup { background: #fffaf3; border: 1px solid #e6c98a; border-left: 4px solid #b8842a; border-radius: 12px; padding: 12px 16px; margin-bottom: 16px; display: flex; flex-direction: column; gap: 8px; }
  .cmt-dup-head { font-size: 12px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; color: #8a5a12; }
  .cmt-dup-row { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
  .cmt-dup-names { flex: 1; min-width: 200px; font-size: 13.5px; font-weight: 600; color: #2a2a27; white-space: pre-wrap; }
  .cmt-workrows { display: flex; flex-direction: column; }
  .cmt-workrow { display: flex; align-items: baseline; gap: 12px; font: inherit; text-align: left; background: none; border: none; border-top: 0.5px solid #f1efeb; padding: 7px 4px; cursor: pointer; }
  .cmt-workrow:first-child { border-top: none; }
  .cmt-workrow:hover { background: #faf8f4; }
  .cmt-workrow-fam { font-size: 13.5px; font-weight: 600; color: #1e2d3d; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .cmt-workrow-num { font-size: 12px; color: #234c8a; font-family: ui-monospace, monospace; }
  .cmt-workrow-status { font-size: 12px; color: #8a8a85; }
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
