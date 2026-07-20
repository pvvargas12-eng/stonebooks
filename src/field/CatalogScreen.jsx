// =============================================================================
// CatalogScreen — the monument catalog in a pocket (FIELD-5)
// =============================================================================
// Paul: "a catalog button in More — pull up the search, people able to search
// by shape, name, stuff like that." Read-only browse over the same monuments
// the sales wizard's Design step uses (shared fetchMonuments cache): search by
// design name / tags, narrow by shape chips (the DESIGN_CATEGORIES codes),
// 2-up image grid, tap a card for the full-size look. Show it to a family at
// the counter or graveside.
// =============================================================================
import { useState, useEffect, useMemo } from 'react'
import { fetchMonuments } from '../SalesMode'

// Same codes DesignStep filters on — m.cats includes the chip's code.
const SHAPES = [
  { code: 'all',            label: 'All' },
  { code: 'slant',          label: 'Slants' },
  { code: 'double-slant',   label: 'Double Slants' },
  { code: 'upright-single', label: 'Uprights' },
  { code: 'upright-double', label: 'Double Uprights' },
  { code: 'flat',           label: 'Flat Markers' },
  { code: 'custom-shape',   label: 'Custom Shape' },
]
const SHAPE_LABEL = Object.fromEntries(SHAPES.map(s => [s.code, s.label]))

// Hide the ugly internal filename (DesignStep's cleanCatalogId, replicated —
// it's local to that component): "local_A0001.jpg_370245" -> "A1".
function cleanId(rawId) {
  if (!rawId) return ''
  const m = String(rawId).match(/^local_([A-Z]+)0*(\d+)\.(?:jpg|jpeg|png|webp)/i)
  if (m) return m[1].toUpperCase() + parseInt(m[2], 10)
  const s = String(rawId)
  return s.length > 14 ? s.slice(0, 14) + '…' : s
}

const displayName = (m) => m.lastname || m.name || cleanId(m.id)

export default function CatalogScreen({ onBack }) {
  const [rows, setRows] = useState(null)
  const [err, setErr] = useState(null)
  const [q, setQ] = useState('')
  const [shape, setShape] = useState('all')
  const [limit, setLimit] = useState(40)
  const [open, setOpen] = useState(null)   // monument for the detail sheet

  useEffect(() => {
    let cancelled = false
    fetchMonuments()
      .then(all => { if (!cancelled) setRows((all || []).filter(m => !m.is_archived)) })
      .catch(e => { if (!cancelled) setErr(e?.message || 'Could not load the catalog.') })
    return () => { cancelled = true }
  }, [])

  const list = useMemo(() => {
    if (!rows) return []
    let pool = rows
    if (shape !== 'all') pool = pool.filter(m => m.cats?.includes(shape))
    const needle = q.trim().toLowerCase()
    if (needle) {
      pool = pool.filter(m => {
        const hay = [m.lastname, m.name, cleanId(m.id), ...(m.tags || []), ...(m.cats || [])]
          .filter(Boolean).join(' · ').toLowerCase()
        return hay.includes(needle)
      })
    }
    return pool
  }, [rows, q, shape])

  const shown = list.slice(0, limit)

  if (err) return <div className="fl-empty">{err}</div>

  return (
    <div>
      <button type="button" className="fl-rowline" onClick={onBack}
        style={{ color: '#9A7209', fontWeight: 700, fontSize: 15, minHeight: 44 }}>
        &#8249; More
      </button>

      <div className="fl-sect" style={{ margin: '2px 2px 10px' }}>
        <div className="fl-sect-h" style={{ fontSize: 26 }}>Catalog</div>
        <div className="fl-sect-spacer" />
        {rows && <span className="fl-spec" style={{ marginTop: 0 }}>{list.length} designs</span>}
      </div>

      <input className="fl-search" type="search" placeholder="Search by name, tag, code"
        value={q} onChange={e => { setQ(e.target.value); setLimit(40) }} />

      <div style={{ display: 'flex', gap: 8, overflowX: 'auto', margin: '0 -14px 12px', padding: '2px 14px 8px', WebkitOverflowScrolling: 'touch' }}>
        {SHAPES.map(s => (
          <button key={s.code} type="button"
            className={`fl-chip-btn${shape === s.code ? ' on' : ''}`}
            style={{ whiteSpace: 'nowrap', flexShrink: 0 }}
            onClick={() => { setShape(s.code); setLimit(40) }}>
            {s.label}
          </button>
        ))}
      </div>

      {rows === null && <div className="fl-empty">Loading the catalog…</div>}
      {rows !== null && shown.length === 0 && <div className="fl-empty-serif">No designs match.</div>}

      <div className="fl-cat-grid">
        {shown.map(m => (
          <button key={m.id} type="button" className="fl-cat-card" onClick={() => setOpen(m)}>
            {m.img
              ? <img className="fl-cat-img" src={m.img} alt={displayName(m)} loading="lazy" />
              : <span className="fl-cat-img fl-cat-noimg">No photo</span>}
            <span className="fl-cat-name">{displayName(m)}</span>
          </button>
        ))}
      </div>

      {list.length > shown.length && (
        <button type="button" className="fl-btn-ghost" style={{ marginTop: 12 }}
          onClick={() => setLimit(n => n + 40)}>
          Show more ({list.length - shown.length} left)
        </button>
      )}

      {open && (
        <>
          <div className="fl-sheet-scrim" onClick={() => setOpen(null)} />
          <div className="fl-sheet">
            <div className="fl-sheet-grab" />
            <div className="fl-sheet-title" style={{ marginBottom: 6 }}>{displayName(open)}</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
              {(open.cats || []).filter(c => SHAPE_LABEL[c]).map(c => (
                <span key={c} className="fl-chip fl-c-neutral">{SHAPE_LABEL[c].toUpperCase()}</span>
              ))}
              {open.granite_color && <span className="fl-chip fl-c-info">{String(open.granite_color).toUpperCase()}</span>}
            </div>
            {open.img && (
              <img src={open.img} alt={displayName(open)}
                style={{ width: '100%', maxHeight: '52dvh', objectFit: 'contain', borderRadius: 12, background: '#F5F3EE' }} />
            )}
            {(open.tags || []).length > 0 && (
              <div style={{ fontSize: 12.5, color: '#8A7F6C', marginTop: 10, lineHeight: 1.5 }}>
                {(open.tags || []).join(' · ')}
              </div>
            )}
            <button type="button" className="fl-btn-ghost" style={{ marginTop: 16 }} onClick={() => setOpen(null)}>
              Done
            </button>
          </div>
        </>
      )}
    </div>
  )
}
