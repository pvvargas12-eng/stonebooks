// =============================================================================
// CatalogPhotoPicker — pick up to 10 catalog photos for a sales email
// =============================================================================
// Paul 2026-09-17: "i want in sales email to be able to select photos from
// catalog to email to customers sometimes they want to see options I want to
// be able to select up to 10 photos... scroll search and click in the catalog
// then it would say at the bottom add to sales email."
// The photos ride IN the email body as a linked photo grid (never as
// attachments) so the email can't blow a size cap no matter what's picked.
// =============================================================================
import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { fetchAllPaged } from '../lib/stonebooksData'

const MAX_PICK = 10
const SHOW_CAP = 200
const titleCase = (s) => String(s || '').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()).trim()
const nameOf = (m) => titleCase(m.lastname) || titleCase(m.name) || 'Untitled'
const thumbUrl = (url) => (url && url.includes('drive.google.com') ? url.replace(/sz=w\d+/i, 'sz=w400') : url)
// The catalog's shape vocabulary lives in meta.Type (Single Upright, Double
// Upright, Slant Marker, Custom Shape, Flat Marker, Double Slant) — Paul
// 2026-10-08: "select the shape first or search all shapes, then pick photos".
const shapeOf = (m) => (m.meta?.Type || '').trim() || 'Other'
const hay = (m) => [
  m.lastname, m.name, m.granite_color, m.meta?.Type, m.meta?.Color, m.meta?.Carving, m.meta?.Layout,
  Array.isArray(m.tags) ? m.tags.join(' ') : m.tags, Array.isArray(m.cats) ? m.cats.join(' ') : m.cats,
].filter(Boolean).join(' ').toLowerCase()

export default function CatalogPhotoPicker({ initial = [], onDone, onClose }) {
  const [monuments, setMonuments] = useState(null)
  const [q, setQ] = useState('')
  const [shape, setShape] = useState('')   // '' = all shapes
  const [picked, setPicked] = useState(() => new Map(initial.map(p => [p.id, p])))

  useEffect(() => {
    let cancelled = false
    fetchAllPaged(() => supabase.from('monuments').select('id, lastname, name, granite_color, img, is_archived, meta, tags, cats'))
      .then(rows => { if (!cancelled) setMonuments((rows || []).filter(m => !m.is_archived && m.img)) })
      .catch(() => { if (!cancelled) setMonuments([]) })
    return () => { cancelled = true }
  }, [])

  // Shape chips with live counts, biggest first.
  const shapes = useMemo(() => {
    const m = new Map()
    for (const x of (monuments || [])) { const s = shapeOf(x); m.set(s, (m.get(s) || 0) + 1) }
    return [...m.entries()].sort((a, b) => b[1] - a[1])
  }, [monuments])

  const filtered = useMemo(() => {
    if (!monuments) return []
    const needle = q.trim().toLowerCase()
    let pool = shape ? monuments.filter(m => shapeOf(m) === shape) : monuments
    if (needle) pool = pool.filter(m => hay(m).includes(needle))
    return pool.slice(0, SHOW_CAP)
  }, [monuments, q, shape])

  const toggle = (m) => setPicked(prev => {
    const n = new Map(prev)
    if (n.has(m.id)) n.delete(m.id)
    else if (n.size < MAX_PICK) n.set(m.id, { id: m.id, name: nameOf(m), url: m.img, color: m.granite_color || null })
    return n
  })

  return (
    // stopPropagation on EVERY click: the picker is mounted inside the Sales
    // email modal's backdrop, whose own click handler closes that modal —
    // so picking a photo (or clicking the search box) bubbled up and killed
    // the whole email ("it crashes", Paul 2026-10-08). Scrim click = close.
    <div className="catpick-scrim" onClick={(e) => { e.stopPropagation(); if (e.target === e.currentTarget) onClose() }}
      onMouseDown={(e) => e.stopPropagation()}>
      <style>{CSS}</style>
      <div className="catpick" role="dialog" aria-label="Pick catalog photos">
        <div className="catpick-head">
          <div className="catpick-title">Catalog photos <span className="catpick-cap">{picked.size}/{MAX_PICK}</span></div>
          <button type="button" className="catpick-x" onClick={onClose} aria-label="Close">×</button>
        </div>
        {/* Shape first, then search within it. */}
        <div className="catpick-shapes">
          <button type="button" className={`catpick-chip${shape === '' ? ' on' : ''}`} onClick={() => setShape('')}>All shapes <b>{monuments ? monuments.length : ''}</b></button>
          {shapes.map(([s, n]) => (
            <button type="button" key={s} className={`catpick-chip${shape === s ? ' on' : ''}`} onClick={() => setShape(shape === s ? '' : s)}>{s} <b>{n}</b></button>
          ))}
        </div>
        <input
          type="search" className="catpick-search" autoFocus
          placeholder={shape ? `Search ${shape.toLowerCase()}s — family, color, carving…` : 'Search designs — family, color, carving, layout…'}
          value={q} onChange={e => setQ(e.target.value)}
        />
        <div className="catpick-grid">
          {monuments === null && <div className="catpick-note">Loading the catalog…</div>}
          {monuments !== null && filtered.length === 0 && <div className="catpick-note">No designs match{shape ? ` under ${shape}` : ''}.</div>}
          {filtered.map(m => {
            const on = picked.has(m.id)
            const full = !on && picked.size >= MAX_PICK
            return (
              <button key={m.id} type="button" className={`catpick-card${on ? ' on' : ''}`}
                disabled={full} title={full ? `Limit is ${MAX_PICK} photos per email` : nameOf(m)}
                onClick={() => toggle(m)}>
                <img className="catpick-img" src={thumbUrl(m.img)} alt={nameOf(m)} loading="lazy" referrerPolicy="no-referrer" />
                <span className="catpick-name">{nameOf(m)}</span>
                {m.granite_color && <span className="catpick-sub">{m.granite_color}</span>}
                {on && <span className="catpick-badge">{[...picked.keys()].indexOf(m.id) + 1}</span>}
              </button>
            )
          })}
          {monuments !== null && filtered.length === SHOW_CAP && (
            <div className="catpick-note">Showing the first {SHOW_CAP} — pick a shape or narrow with search.</div>
          )}
        </div>
        <div className="catpick-foot">
          <span className="catpick-hint">{picked.size ? `${picked.size} picked — they go in the email body, full size on click.` : `Tap photos to pick up to ${MAX_PICK}.`}</span>
          <button type="button" className="catpick-btn ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="catpick-btn go" disabled={picked.size === 0}
            onClick={() => onDone([...picked.values()])}>
            Add {picked.size || ''} photo{picked.size === 1 ? '' : 's'} to email
          </button>
        </div>
      </div>
    </div>
  )
}

const CSS = `
  .catpick-scrim { position: fixed; inset: 0; background: rgba(15,20,25,0.55); z-index: 1400;
    display: flex; align-items: center; justify-content: center; padding: 20px; }
  .catpick { background: #fff; border-radius: 14px; width: 100%; max-width: 860px; height: min(86vh, 780px);
    display: flex; flex-direction: column; padding: 16px 18px; box-sizing: border-box; }
  .catpick-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
  .catpick-title { font-size: 16px; font-weight: 800; }
  .catpick-cap { font-family: var(--font-m, 'JetBrains Mono'), monospace; font-size: 12px; color: #9A7209; margin-left: 8px; }
  .catpick-x { font: inherit; font-size: 22px; line-height: 1; background: none; border: none; color: #8a8a85; cursor: pointer; }
  .catpick-shapes { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 8px; }
  .catpick-chip { font: inherit; font-size: 12px; font-weight: 700; color: #6B6455; background: #fff; border: 1px solid #D9D2C0; border-radius: 999px; padding: 6px 11px; cursor: pointer; white-space: nowrap; display: inline-flex; gap: 6px; align-items: center; }
  .catpick-chip b { font-family: var(--font-m, 'JetBrains Mono'), monospace; font-size: 10.5px; font-weight: 700; color: #9a9486; }
  .catpick-chip.on { background: #16150F; color: #fff; border-color: #16150F; }
  .catpick-chip.on b { color: #C9A468; }
  .catpick-search { font: inherit; font-size: 14px; padding: 9px 12px; border-radius: 10px; border: 1px solid #D9D2C0; margin-bottom: 10px; }
  .catpick-hint { margin-right: auto; align-self: center; font-size: 12px; color: #8a8a85; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .catpick-grid { flex: 1; overflow-y: auto; display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 10px; align-content: start; }
  .catpick-note { grid-column: 1 / -1; font-size: 13px; color: #8a8a85; padding: 10px 2px; }
  .catpick-card { position: relative; display: flex; flex-direction: column; gap: 2px; font: inherit; text-align: left;
    background: #FBFAF7; border: 1.5px solid #EAE4D6; border-radius: 10px; padding: 6px; cursor: pointer; }
  .catpick-card:hover { border-color: #C9A468; }
  .catpick-card.on { border-color: #9A7209; background: #fdf6e7; }
  .catpick-card:disabled { opacity: 0.4; cursor: default; }
  .catpick-img { width: 100%; height: 110px; object-fit: contain; background: #f0eee9; border-radius: 7px; }
  .catpick-name { font-size: 12.5px; font-weight: 700; color: #16150F; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .catpick-sub { font-size: 11px; color: #8a8a85; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .catpick-badge { position: absolute; top: 8px; right: 8px; width: 22px; height: 22px; border-radius: 999px;
    background: #9A7209; color: #fff; font-size: 12px; font-weight: 800; line-height: 22px; text-align: center; }
  .catpick-foot { display: flex; justify-content: flex-end; gap: 10px; padding-top: 12px; }
  .catpick-btn { font: inherit; font-size: 13.5px; font-weight: 700; padding: 9px 18px; border-radius: 9px;
    border: 1px solid #D9D2C0; background: #fff; cursor: pointer; }
  .catpick-btn.ghost { color: #8a8a85; }
  .catpick-btn.go { background: #16150F; color: #C9A468; border-color: #16150F; }
  .catpick-btn.go:disabled { opacity: 0.5; cursor: default; }
`
