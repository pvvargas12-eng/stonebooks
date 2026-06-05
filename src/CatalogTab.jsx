// =============================================================================
// Catalog — premium design gallery (gallery + detail). Read-only except the
// single Delete action in the detail view (Fix 3). Renders standalone (its own
// /catalog route, no CRM chrome) — see CatalogStandalone in App.jsx.
// =============================================================================
// Data mapping (verified against prod): name=lastname (title-cased), the long
// `name` is the descriptive title (detail only), granite=granite_color,
// shape/style=meta.Type, image=img (full Google-Drive URL, single image). No
// dimensions / price / archived flag exist, so none are shown. NO emojis (the
// `icon` column holds one — ignored).
// =============================================================================

import { useState, useEffect, useMemo } from 'react'
import { supabase } from './lib/supabase'
import { fetchAllPaged } from './lib/stonebooksData'

const thumbUrl = (url) => (url && url.includes('drive.google.com') ? url.replace(/sz=w\d+/i, 'sz=w400') : url)
const fullUrl  = (url) => (url && url.includes('drive.google.com') ? url.replace(/sz=w\d+/i, 'sz=w1200') : url)

const titleCase = (s) => String(s || '').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()).trim()
const specLine = (m) => [m.granite_color, m.carve_type].filter(Boolean).join('  ·  ')

// An image that degrades to an elegant monogram placeholder — never a broken img.
// object-fit: contain so the ENTIRE photo is visible, letterboxed on a neutral fill.
function CatImage({ src, alt, full = false, className }) {
  const [failed, setFailed] = useState(false)
  if (!src || failed) {
    return (
      <div className={`cat-ph ${className || ''}`}>
        <span className="cat-ph-mono">{titleCase(alt).slice(0, 1) || '·'}</span>
      </div>
    )
  }
  return (
    <img
      className={className}
      src={full ? fullUrl(src) : thumbUrl(src)}
      alt={alt || ''}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  )
}

export default function CatalogTab({ onStartOrder }) {
  const [monuments, setMonuments] = useState(null)   // null = loading
  const [search, setSearch] = useState('')
  const [fShape, setFShape] = useState('')
  const [fColor, setFColor] = useState('')
  const [selectedId, setSelectedId] = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [delError, setDelError] = useState(null)

  useEffect(() => {
    let cancelled = false
    fetchAllPaged(() => supabase.from('monuments').select('*'))
      .then((rows) => {
        if (cancelled) return
        const sorted = [...rows].sort((a, b) => String(a.lastname || 'zzz').localeCompare(String(b.lastname || 'zzz')))
        setMonuments(sorted)
      })
      .catch(() => { if (!cancelled) setMonuments([]) })
    return () => { cancelled = true }
  }, [])

  const shapeOptions = useMemo(() => {
    if (!monuments) return []
    return [...new Set(monuments.map((m) => m.meta?.Type).filter(Boolean))].sort()
  }, [monuments])
  const colorOptions = useMemo(() => {
    if (!monuments) return []
    return [...new Set(monuments.map((m) => m.granite_color).filter(Boolean))].sort()
  }, [monuments])

  const filtered = useMemo(() => {
    if (!monuments) return []
    const q = search.trim().toLowerCase()
    return monuments.filter((m) => {
      if (fShape && m.meta?.Type !== fShape) return false
      if (fColor && m.granite_color !== fColor) return false
      if (q) {
        const hay = `${m.lastname || ''} ${m.name || ''} ${m.granite_color || ''} ${m.description || ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [monuments, search, fShape, fColor])

  const selected = useMemo(
    () => (selectedId && monuments ? monuments.find((m) => m.id === selectedId) : null),
    [selectedId, monuments],
  )

  const closeDetail = () => { setSelectedId(null); setConfirmDelete(false); setDelError(null) }

  const doDelete = async () => {
    if (!selected) return
    setDeleting(true); setDelError(null)
    const { error } = await supabase.from('monuments').delete().eq('id', selected.id)
    setDeleting(false)
    if (error) {
      setDelError(/row-level security|permission|policy/i.test(error.message)
        ? 'Couldn’t delete — the catalog delete permission isn’t set up yet (apply migration 20260612_monuments_staff_delete).'
        : (error.message || 'Delete failed.'))
      return
    }
    const removedId = selected.id
    setMonuments((arr) => (arr || []).filter((m) => m.id !== removedId))
    setConfirmDelete(false)
    setSelectedId(null)
  }

  if (selected) {
    return (
      <div className="cat-page">
        <style>{CATALOG_CSS}</style>
        <CatalogDetail
          monument={selected}
          onBack={closeDetail}
          onStartOrder={onStartOrder}
          onDelete={() => { setDelError(null); setConfirmDelete(true) }}
        />
        {confirmDelete && (
          <DeleteConfirm
            monument={selected}
            busy={deleting}
            error={delError}
            onCancel={() => { if (!deleting) { setConfirmDelete(false); setDelError(null) } }}
            onConfirm={doDelete}
          />
        )}
      </div>
    )
  }

  return (
    <div className="cat-page">
      <style>{CATALOG_CSS}</style>

      <div className="cat-head">
        <div>
          <div className="cat-eyebrow">Design Library</div>
          <h1 className="cat-title">Catalog</h1>
        </div>
        <div className="cat-count">
          {monuments === null ? 'Loading…' : `${filtered.length.toLocaleString()} design${filtered.length === 1 ? '' : 's'}`}
        </div>
      </div>

      <div className="cat-toolbar">
        <input
          className="cat-search"
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name, granite, or description"
        />
        <select className="cat-select" value={fShape} onChange={(e) => setFShape(e.target.value)}>
          <option value="">All shapes</option>
          {shapeOptions.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select className="cat-select" value={fColor} onChange={(e) => setFColor(e.target.value)}>
          <option value="">All granites</option>
          {colorOptions.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      {monuments === null ? (
        <div className="cat-empty">Loading the design library…</div>
      ) : filtered.length === 0 ? (
        <div className="cat-empty">No designs match. Try clearing the search or filters.</div>
      ) : (
        <div className="cat-grid">
          {filtered.map((m) => (
            <button key={m.id} type="button" className="cat-card" onClick={() => setSelectedId(m.id)}>
              <div className="cat-card-tile">
                <CatImage src={m.img} alt={m.lastname || m.name} className="cat-card-img" />
              </div>
              <div className="cat-card-body">
                <div className="cat-card-name">{titleCase(m.lastname) || titleCase(m.name) || 'Untitled'}</div>
                {specLine(m) && <div className="cat-card-spec">{specLine(m)}</div>}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function CatalogDetail({ monument: m, onBack, onStartOrder, onDelete }) {
  const specs = [
    ['Granite', m.granite_color],
    ['Shape / style', m.meta?.Type],
    ['Carving', m.carve_type],
    ['Layout', m.meta?.Layout],
    ['Detail level', m.meta?.Complexity],
  ].filter(([, v]) => v)

  return (
    <>
      <button type="button" className="cat-back" onClick={onBack}>&larr; Back to catalog</button>

      <div className="cat-detail">
        <div className="cat-detail-media">
          <CatImage src={m.img} alt={m.lastname || m.name} full className="cat-detail-img" />
        </div>

        <div className="cat-detail-info">
          <div className="cat-eyebrow">{m.meta?.Type || 'Monument'}</div>
          <h1 className="cat-detail-name">{titleCase(m.lastname) || titleCase(m.name) || 'Untitled'}</h1>
          {m.name && m.name !== m.lastname && <div className="cat-detail-sub">{m.name}</div>}

          <dl className="cat-specs">
            {specs.map(([k, v]) => (
              <div key={k} className="cat-spec-row">
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>

          {m.description && <p className="cat-detail-desc">{m.description}</p>}
          {m.meta?.SalesUse && (
            <div className="cat-salesuse">
              <div className="cat-salesuse-label">When to show this</div>
              {m.meta.SalesUse}
            </div>
          )}
          {Array.isArray(m.tags) && m.tags.length > 0 && (
            <div className="cat-tags">{m.tags.map((t) => <span key={t} className="cat-tag">{t}</span>)}</div>
          )}

          <div className="cat-detail-actions">
            <button type="button" className="cat-order-btn" onClick={() => onStartOrder?.(m)}>
              Start an order from this
            </button>
          </div>

          <div className="cat-danger-zone">
            <button type="button" className="cat-delete-link" onClick={onDelete}>Delete this design</button>
          </div>
        </div>
      </div>
    </>
  )
}

function DeleteConfirm({ monument: m, busy, error, onCancel, onConfirm }) {
  return (
    <div className="cat-modal-backdrop" onClick={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="cat-modal" role="dialog" aria-modal="true">
        <div className="cat-modal-media">
          <CatImage src={m.img} alt={m.lastname || m.name} className="cat-modal-img" />
        </div>
        <div className="cat-modal-name">{titleCase(m.lastname) || titleCase(m.name) || 'Untitled'}</div>
        <p className="cat-modal-copy">Permanently remove this design from the catalog? This can&rsquo;t be undone.</p>
        {error && <div className="cat-modal-error">{error}</div>}
        <div className="cat-modal-actions">
          <button type="button" className="cat-modal-cancel" onClick={onCancel} disabled={busy}>Cancel</button>
          <button type="button" className="cat-modal-delete" onClick={onConfirm} disabled={busy}>{busy ? 'Deleting…' : 'Delete'}</button>
        </div>
      </div>
    </div>
  )
}

const CATALOG_CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;500;600&display=swap');
  .cat-card-name, .cat-detail-name, .cat-ph-mono, .cat-title, .cat-modal-name { font-family: 'Playfair Display', Georgia, 'Times New Roman', serif; }

  .cat-page { max-width: 1240px; margin: 0 auto; padding: 30px 24px 64px; }

  .cat-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; margin-bottom: 20px; }
  .cat-eyebrow { font-size: 11px; letter-spacing: 0.16em; text-transform: uppercase; color: #9a948a; font-weight: 600; margin-bottom: 6px; }
  .cat-title { font-size: 34px; font-weight: 500; color: #1e2330; letter-spacing: -0.01em; margin: 0; }
  .cat-count { font-size: 13px; color: #9a948a; padding-bottom: 6px; white-space: nowrap; }

  .cat-toolbar { display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 26px; }
  .cat-search { flex: 1; min-width: 240px; font: inherit; font-size: 14px; padding: 11px 14px; border: 1px solid #e4e0d8; border-radius: 9px; background: #fff; color: #2a2a2a; outline: none; transition: border-color 0.15s; }
  .cat-search:focus { border-color: #b8935a; }
  .cat-search::placeholder { color: #b3ada3; }
  .cat-select { font: inherit; font-size: 14px; padding: 11px 32px 11px 14px; border: 1px solid #e4e0d8; border-radius: 9px; background: #fff url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='6'><path d='M1 1l4 4 4-4' fill='none' stroke='%239a948a' stroke-width='1.4'/></svg>") no-repeat right 13px center; color: #2a2a2a; outline: none; cursor: pointer; appearance: none; -webkit-appearance: none; }
  .cat-select:focus { border-color: #b8935a; }

  .cat-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 22px; }
  @media (max-width: 920px) { .cat-grid { grid-template-columns: repeat(2, 1fr); } }
  @media (max-width: 560px) { .cat-grid { grid-template-columns: 1fr; } }

  .cat-card { display: flex; flex-direction: column; text-align: left; background: none; border: none; padding: 0; cursor: pointer; }
  /* FULL image, never cropped: square tile, contain, neutral letterbox fill. */
  .cat-card-tile { aspect-ratio: 1 / 1; border: 1px solid #e7e3db; border-radius: 12px; overflow: hidden; background: #f5f1ea; display: flex; align-items: center; justify-content: center; transition: border-color 0.18s, transform 0.18s; }
  .cat-card:hover .cat-card-tile { border-color: #c9bfa8; transform: translateY(-2px); }
  .cat-card-img { width: 100%; height: 100%; object-fit: contain; display: block; }
  .cat-card-body { padding: 13px 3px 4px; }
  .cat-card-name { font-size: 19px; font-weight: 500; color: #1e2330; line-height: 1.15; }
  .cat-card-spec { font-size: 13px; color: #9a948a; margin-top: 3px; }

  .cat-ph { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; background: linear-gradient(180deg, #f6f3ee 0%, #efeae1 100%); }
  .cat-ph-mono { font-size: 46px; color: #cfc6b4; font-weight: 500; }

  .cat-empty { padding: 80px 20px; text-align: center; color: #9a948a; font-size: 15px; }

  /* DETAIL */
  .cat-back { font: inherit; font-size: 13px; color: #6b6b66; background: none; border: none; cursor: pointer; padding: 4px 0; margin-bottom: 18px; }
  .cat-back:hover { color: #1e2330; }
  .cat-detail { display: grid; grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr); gap: 40px; align-items: start; }
  @media (max-width: 860px) { .cat-detail { grid-template-columns: 1fr; gap: 24px; } }
  .cat-detail-media { position: sticky; top: 20px; }
  /* FULL monument, uncropped: contain against a neutral fill, height-capped. */
  .cat-detail-img { width: 100%; max-height: 72vh; object-fit: contain; border: 1px solid #e7e3db; border-radius: 14px; background: #f5f1ea; display: block; }
  .cat-detail .cat-ph { aspect-ratio: 4 / 5; border: 1px solid #e7e3db; border-radius: 14px; }

  .cat-detail-name { font-size: 38px; font-weight: 500; color: #1e2330; line-height: 1.05; margin: 6px 0 4px; letter-spacing: -0.01em; }
  .cat-detail-sub { font-size: 16px; color: #6b6b66; line-height: 1.4; margin-bottom: 22px; }

  .cat-specs { margin: 8px 0 22px; border-top: 1px solid #ece8e0; }
  .cat-spec-row { display: flex; justify-content: space-between; gap: 16px; padding: 11px 0; border-bottom: 1px solid #ece8e0; }
  .cat-spec-row dt { font-size: 13px; color: #9a948a; }
  .cat-spec-row dd { font-size: 14px; color: #2a2a2a; text-align: right; }

  .cat-detail-desc { font-size: 15px; line-height: 1.7; color: #4a4a44; margin-bottom: 20px; }
  .cat-salesuse { background: #faf7f1; border: 1px solid #ece3d2; border-radius: 11px; padding: 15px 17px; font-size: 14px; line-height: 1.6; color: #5a5347; margin-bottom: 20px; }
  .cat-salesuse-label { font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; color: #b39a6a; font-weight: 600; margin-bottom: 6px; }

  .cat-tags { display: flex; flex-wrap: wrap; gap: 7px; margin-bottom: 26px; }
  .cat-tag { font-size: 12px; color: #6b6b66; background: #f3f0ea; border: 1px solid #e7e3db; border-radius: 999px; padding: 4px 11px; }

  .cat-detail-actions { display: flex; gap: 10px; }
  .cat-order-btn { font: inherit; font-size: 14px; font-weight: 600; color: #fff; background: #1e2330; border: 1px solid #1e2330; border-radius: 10px; padding: 13px 26px; cursor: pointer; transition: background 0.15s; }
  .cat-order-btn:hover { background: #2c3446; }

  /* Destructive, secondary — set apart at the bottom. */
  .cat-danger-zone { margin-top: 30px; padding-top: 18px; border-top: 1px solid #ece8e0; }
  .cat-delete-link { font: inherit; font-size: 13px; color: #9a4a40; background: none; border: none; padding: 4px 0; cursor: pointer; }
  .cat-delete-link:hover { color: #7e372f; text-decoration: underline; }

  /* DELETE CONFIRM */
  .cat-modal-backdrop { position: fixed; inset: 0; background: rgba(28,25,22,0.46); backdrop-filter: blur(2px); z-index: 1200; display: flex; align-items: center; justify-content: center; padding: 22px; }
  .cat-modal { background: #fff; border-radius: 14px; width: 100%; max-width: 380px; padding: 24px; box-shadow: 0 20px 60px rgba(28,25,22,0.3); text-align: center; }
  .cat-modal-media { width: 132px; height: 132px; margin: 0 auto 16px; border: 1px solid #e7e3db; border-radius: 11px; overflow: hidden; background: #f5f1ea; display: flex; align-items: center; justify-content: center; }
  .cat-modal-img { width: 100%; height: 100%; object-fit: contain; }
  .cat-modal-name { font-size: 22px; font-weight: 500; color: #1e2330; margin-bottom: 8px; }
  .cat-modal-copy { font-size: 14px; line-height: 1.6; color: #6b6b66; margin-bottom: 18px; }
  .cat-modal-error { font-size: 13px; color: #9a4a40; background: #fbeceb; border: 1px solid #f0cfca; border-radius: 8px; padding: 9px 11px; margin-bottom: 16px; text-align: left; }
  .cat-modal-actions { display: flex; gap: 10px; }
  .cat-modal-cancel { flex: 1; font: inherit; font-size: 14px; font-weight: 500; color: #4a4a44; background: #f3f0ea; border: 1px solid #e4e0d8; border-radius: 9px; padding: 11px; cursor: pointer; }
  .cat-modal-cancel:hover { background: #ece8e0; }
  .cat-modal-delete { flex: 1; font: inherit; font-size: 14px; font-weight: 600; color: #fff; background: #9a4a40; border: 1px solid #9a4a40; border-radius: 9px; padding: 11px; cursor: pointer; }
  .cat-modal-delete:hover { background: #843e35; }
  .cat-modal-delete:disabled, .cat-modal-cancel:disabled { opacity: 0.55; cursor: default; }
`
