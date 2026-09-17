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
const titleCase = (s) => String(s || '').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()).trim()
const nameOf = (m) => titleCase(m.lastname) || titleCase(m.name) || 'Untitled'
const thumbUrl = (url) => (url && url.includes('drive.google.com') ? url.replace(/sz=w\d+/i, 'sz=w400') : url)

export default function CatalogPhotoPicker({ initial = [], onDone, onClose }) {
  const [monuments, setMonuments] = useState(null)
  const [q, setQ] = useState('')
  const [picked, setPicked] = useState(() => new Map(initial.map(p => [p.id, p])))

  useEffect(() => {
    let cancelled = false
    fetchAllPaged(() => supabase.from('monuments').select('id, lastname, name, granite_color, img, is_archived, meta'))
      .then(rows => { if (!cancelled) setMonuments((rows || []).filter(m => !m.is_archived && m.img)) })
      .catch(() => { if (!cancelled) setMonuments([]) })
    return () => { cancelled = true }
  }, [])

  const filtered = useMemo(() => {
    if (!monuments) return []
    const needle = q.trim().toLowerCase()
    const pool = needle
      ? monuments.filter(m => [m.lastname, m.name, m.granite_color, m.meta?.Type].filter(Boolean).join(' ').toLowerCase().includes(needle))
      : monuments
    return pool.slice(0, 120)
  }, [monuments, q])

  const toggle = (m) => setPicked(prev => {
    const n = new Map(prev)
    if (n.has(m.id)) n.delete(m.id)
    else if (n.size < MAX_PICK) n.set(m.id, { id: m.id, name: nameOf(m), url: m.img, color: m.granite_color || null })
    return n
  })

  return (
    <div className="catpick-scrim" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <style>{CSS}</style>
      <div className="catpick" role="dialog" aria-label="Pick catalog photos">
        <div className="catpick-head">
          <div className="catpick-title">Catalog photos <span className="catpick-cap">{picked.size}/{MAX_PICK}</span></div>
          <button type="button" className="catpick-x" onClick={onClose} aria-label="Close">×</button>
        </div>
        <input
          type="search" className="catpick-search" autoFocus
          placeholder="Search designs — family, color, shape…"
          value={q} onChange={e => setQ(e.target.value)}
        />
        <div className="catpick-grid">
          {monuments === null && <div className="catpick-note">Loading the catalog…</div>}
          {monuments !== null && filtered.length === 0 && <div className="catpick-note">No designs match.</div>}
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
          {monuments !== null && filtered.length === 120 && (
            <div className="catpick-note">Showing the first 120 — narrow with search.</div>
          )}
        </div>
        <div className="catpick-foot">
          <button type="button" className="catpick-btn ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="catpick-btn go" disabled={picked.size === 0}
            onClick={() => onDone([...picked.values()])}>
            Add {picked.size || ''} photo{picked.size === 1 ? '' : 's'} to sales email
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
  .catpick-search { font: inherit; font-size: 14px; padding: 9px 12px; border-radius: 10px; border: 1px solid #D9D2C0; margin-bottom: 10px; }
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
