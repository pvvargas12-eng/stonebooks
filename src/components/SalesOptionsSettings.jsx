// =============================================================================
// Settings → Sales Options — owner-managed option lists (Directive Part 1C)
// =============================================================================
// Category-driven editor over public.sales_options. Stone Colors ships first;
// future categories (monument types, …) drop into CATEGORIES without new UI.
//
//  • drag-to-reorder rows (writes sort_order for the whole list on drop)
//  • inline edit label + premium (% shown; stored as a fraction — the same
//    numeric the pricing engine multiplies)
//  • Add Color: label, premium %, optional swatch image upload
//  • Deactivate = is_active:false (soft delete — NEVER hard-delete). Copy:
//    "Deactivating hides this from new orders. Existing orders are not
//    affected." Reactivate lives in a collapsed "Inactive" section.
//
// Every successful write calls refreshStoneColorCatalog() so the wizard's
// picker + pricing pick the change up without a reload. Saved orders are
// unaffected by premium edits (order-level snapshot — see monumentCatalog
// effectiveColorPremium).
// =============================================================================

import { useState, useEffect, useCallback } from 'react'
import {
  listSalesOptions, createSalesOption, updateSalesOption,
  reorderSalesOptions, uploadSalesOptionImage, refreshStoneColorCatalog,
} from '../lib/salesOptions'

const CATEGORIES = [
  { key: 'stone_color', label: 'Stone Colors', addLabel: '+ Add Color' },
]

// slugify a label into a stable value ('Imperial Pink' → 'imperial-pink')
const slugify = (s) => String(s || '').toLowerCase().trim()
  .replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

const pctOf = (fraction) => {
  const n = Number(fraction) || 0
  return Math.round(n * 1000) / 10   // 0.25 → 25, 0.125 → 12.5
}

export default function SalesOptionsSettings({ canEdit = false }) {
  const [category, setCategory] = useState('stone_color')
  const [rows, setRows] = useState(null)      // null = loading
  const [error, setError] = useState(null)
  const [msg, setMsg] = useState(null)
  const [showInactive, setShowInactive] = useState(false)
  const [showAdd, setShowAdd] = useState(false)
  const [dragId, setDragId] = useState(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      setRows(await listSalesOptions(category))
    } catch (e) {
      setError(e?.message || String(e))
      setRows([])
    }
  }, [category])

  useEffect(() => { load() }, [load])

  const flash = (m) => { setMsg(m); setTimeout(() => setMsg(null), 2500) }

  const afterWrite = async () => {
    await refreshStoneColorCatalog()
    await load()
  }

  const patchRow = async (id, patch, note) => {
    try {
      await updateSalesOption(id, patch)
      await afterWrite()
      if (note) flash(note)
    } catch (e) {
      setError(e?.message || String(e))
    }
  }

  const active = (rows || []).filter(r => r.is_active)
  const inactive = (rows || []).filter(r => !r.is_active)
  const cat = CATEGORIES.find(c => c.key === category)

  // ── drag-to-reorder (active rows only) ────────────────────────────────────
  const onDropOn = async (targetId) => {
    if (!dragId || dragId === targetId) { setDragId(null); return }
    const ids = active.map(r => r.id)
    const from = ids.indexOf(dragId)
    const to = ids.indexOf(targetId)
    if (from < 0 || to < 0) { setDragId(null); return }
    ids.splice(to, 0, ids.splice(from, 1)[0])
    setDragId(null)
    // optimistic local order
    setRows(prev => {
      const byId = new Map(prev.map(r => [r.id, r]))
      return [...ids.map(id => byId.get(id)), ...prev.filter(r => !r.is_active)]
    })
    try {
      await reorderSalesOptions(category, ids)
      await refreshStoneColorCatalog()
    } catch (e) {
      setError(e?.message || String(e))
      await load()
    }
  }

  if (!canEdit) {
    return <div className="sos-wrap"><div className="sos-locked">Sales options are owner-managed. Ask the owner to make changes.</div><style>{CSS}</style></div>
  }

  return (
    <div className="sos-wrap">
      <div className="sos-cat-row">
        {CATEGORIES.map(c => (
          <button key={c.key} type="button"
            className={`sos-cat ${category === c.key ? 'on' : ''}`}
            onClick={() => setCategory(c.key)}>
            {c.label}
          </button>
        ))}
        <div className="sos-cat-spacer" />
        <button type="button" className="sos-add-btn" onClick={() => setShowAdd(v => !v)}>
          {showAdd ? 'Cancel' : (cat?.addLabel || '+ Add')}
        </button>
      </div>

      {msg && <div className="sos-msg">{msg}</div>}
      {error && <div className="sos-err">{error}</div>}

      {showAdd && (
        <AddOptionForm
          category={category}
          nextSortOrder={(rows || []).reduce((m, r) => Math.max(m, r.sort_order || 0), 0) + 10}
          onDone={async (created) => {
            setShowAdd(false)
            if (created) { await afterWrite(); flash(`Added "${created.label}".`) }
          }}
          onError={(e) => setError(e?.message || String(e))}
        />
      )}

      {rows === null ? (
        <div className="sos-loading">Loading…</div>
      ) : (
        <>
          <div className="sos-hint">
            Drag rows to reorder the picker. Premium is a percentage added on the base stone price.
            Deactivating hides a color from new orders — existing orders are not affected.
          </div>

          <div className="sos-table">
            <div className="sos-row sos-row-head">
              <div className="sos-c-drag" />
              <div className="sos-c-swatch">Swatch</div>
              <div className="sos-c-label">Label</div>
              <div className="sos-c-premium">Premium %</div>
              <div className="sos-c-actions" />
            </div>
            {active.map(r => (
              <OptionRow key={r.id} row={r}
                draggable
                isDragging={dragId === r.id}
                onDragStart={() => setDragId(r.id)}
                onDragEnd={() => setDragId(null)}
                onDropOn={() => onDropOn(r.id)}
                onPatch={patchRow}
              />
            ))}
            {active.length === 0 && <div className="sos-empty">No active options. Add one above.</div>}
          </div>

          {inactive.length > 0 && (
            <div className="sos-inactive">
              <button type="button" className="sos-disclosure" onClick={() => setShowInactive(v => !v)}>
                {showInactive ? '▾' : '▸'} Inactive ({inactive.length})
              </button>
              {showInactive && (
                <div className="sos-table">
                  {inactive.map(r => (
                    <OptionRow key={r.id} row={r} inactive onPatch={patchRow} />
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}
      <style>{CSS}</style>
    </div>
  )
}

function OptionRow({ row, inactive = false, draggable = false, isDragging = false, onDragStart, onDragEnd, onDropOn, onPatch }) {
  const [label, setLabel] = useState(row.label)
  const [pct, setPct] = useState(pctOf(row.premium))
  const [uploading, setUploading] = useState(false)

  useEffect(() => { setLabel(row.label); setPct(pctOf(row.premium)) }, [row.label, row.premium])

  const commitLabel = () => {
    const v = label.trim()
    if (v && v !== row.label) onPatch(row.id, { label: v }, 'Label updated.')
    else setLabel(row.label)
  }
  const commitPremium = () => {
    const n = Number(pct)
    if (!Number.isFinite(n) || n < 0) { setPct(pctOf(row.premium)); return }
    const fraction = Math.round(n * 10) / 1000   // 25 → 0.25
    if (fraction !== Number(row.premium)) onPatch(row.id, { premium: fraction }, 'Premium updated. Saved orders keep their locked-in pricing.')
  }
  const onSwatchFile = async (file) => {
    if (!file) return
    setUploading(true)
    try {
      const url = await uploadSalesOptionImage(file, row.value)
      await onPatch(row.id, { imageUrl: url }, 'Swatch updated.')
    } catch (e) {
      console.error('swatch upload:', e)
    } finally {
      setUploading(false)
    }
  }

  return (
    <div
      className={`sos-row ${inactive ? 'sos-row-inactive' : ''} ${isDragging ? 'sos-row-dragging' : ''}`}
      draggable={draggable}
      onDragStart={draggable ? onDragStart : undefined}
      onDragEnd={draggable ? onDragEnd : undefined}
      onDragOver={draggable ? (e) => e.preventDefault() : undefined}
      onDrop={draggable ? (e) => { e.preventDefault(); onDropOn() } : undefined}
    >
      <div className="sos-c-drag" title={draggable ? 'Drag to reorder' : ''}>{draggable ? '⠿' : ''}</div>
      <div className="sos-c-swatch">
        {row.image_url
          ? <img src={row.image_url} alt={row.label} />
          : <label className="sos-swatch-add" title="Upload a swatch photo">
              {uploading ? '…' : '+'}
              <input type="file" accept="image/*" style={{ display: 'none' }}
                onChange={e => onSwatchFile(e.target.files?.[0])} />
            </label>}
      </div>
      <div className="sos-c-label">
        <input value={label} disabled={inactive}
          onChange={e => setLabel(e.target.value)}
          onBlur={commitLabel}
          onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }} />
        <div className="sos-value">{row.value}</div>
      </div>
      <div className="sos-c-premium">
        <input type="number" step="0.5" min="0" value={pct} disabled={inactive}
          onChange={e => setPct(e.target.value)}
          onBlur={commitPremium}
          onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }} />
        <span className="sos-pct">%</span>
      </div>
      <div className="sos-c-actions">
        {inactive
          ? <button type="button" className="sos-act sos-act-on" onClick={() => onPatch(row.id, { isActive: true }, `"${row.label}" reactivated.`)}>Reactivate</button>
          : <button type="button" className="sos-act sos-act-off"
              title="Deactivating hides this from new orders. Existing orders are not affected."
              onClick={() => onPatch(row.id, { isActive: false }, `"${row.label}" deactivated — hidden from new orders. Existing orders are not affected.`)}>
              Deactivate
            </button>}
      </div>
    </div>
  )
}

function AddOptionForm({ category, nextSortOrder, onDone, onError }) {
  const [label, setLabel] = useState('')
  const [pct, setPct] = useState('')
  const [file, setFile] = useState(null)
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    const l = label.trim()
    if (!l) return
    setBusy(true)
    try {
      const value = slugify(l)
      let imageUrl = null
      if (file) imageUrl = await uploadSalesOptionImage(file, value)
      const fraction = Math.round((Number(pct) || 0) * 10) / 1000
      const created = await createSalesOption({
        category, label: l, value,
        premium: fraction, imageUrl, sortOrder: nextSortOrder,
      })
      onDone(created)
    } catch (e) {
      onError(e)
      onDone(null)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="sos-addform">
      <div className="sos-addform-grid">
        <label>
          <span>Label</span>
          <input value={label} onChange={e => setLabel(e.target.value)} placeholder="e.g. Blue Pearl" autoFocus />
        </label>
        <label>
          <span>Premium %</span>
          <input type="number" step="0.5" min="0" value={pct} onChange={e => setPct(e.target.value)} placeholder="0" />
        </label>
        <label>
          <span>Swatch photo (optional)</span>
          <input type="file" accept="image/*" onChange={e => setFile(e.target.files?.[0] || null)} />
        </label>
      </div>
      <button type="button" className="sos-add-btn" disabled={busy || !label.trim()} onClick={submit}>
        {busy ? 'Adding…' : 'Add'}
      </button>
    </div>
  )
}

const CSS = `
  .sos-wrap { max-width: 720px; }
  .sos-locked { font-size: 14px; color: #5a6472; background: #f6f4ef; border: 1px solid #e3ded2; border-radius: 8px; padding: 12px 16px; }
  .sos-cat-row { display: flex; align-items: center; gap: 8px; margin-bottom: 14px; }
  .sos-cat { border: 1px solid #d8d2c4; background: #fff; border-radius: 999px; padding: 6px 14px; font-size: 13px; font-weight: 600; color: #4a5260; cursor: pointer; }
  .sos-cat.on { background: #1e2d3d; border-color: #1e2d3d; color: #f5efe2; }
  .sos-cat-spacer { flex: 1; }
  .sos-add-btn { border: 1px solid #1e2d3d; background: #1e2d3d; color: #f5efe2; border-radius: 8px; padding: 7px 14px; font-size: 13px; font-weight: 700; cursor: pointer; }
  .sos-add-btn:disabled { opacity: 0.5; cursor: default; }
  .sos-msg { font-size: 13px; color: #22633a; background: #eef6ee; border: 1px solid #cfe4cf; border-radius: 8px; padding: 8px 12px; margin-bottom: 10px; }
  .sos-err { font-size: 13px; color: #8f2b21; background: #fbeeec; border: 1px solid #ecc9c3; border-radius: 8px; padding: 8px 12px; margin-bottom: 10px; }
  .sos-hint { font-size: 12px; color: #7a828e; margin-bottom: 10px; }
  .sos-loading, .sos-empty { font-size: 13px; color: #7a828e; padding: 14px 4px; }
  .sos-table { border: 1px solid #e3ded2; border-radius: 10px; overflow: hidden; background: #fff; }
  .sos-row { display: grid; grid-template-columns: 28px 56px 1fr 110px 110px; align-items: center; gap: 10px; padding: 8px 10px; border-bottom: 1px solid #efeadf; }
  .sos-row:last-child { border-bottom: none; }
  .sos-row-head { background: #f8f6f1; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: #8b8577; font-weight: 700; }
  .sos-row-dragging { opacity: 0.4; }
  .sos-row-inactive { opacity: 0.65; background: #fbfaf7; }
  .sos-c-drag { color: #b9b2a2; cursor: grab; user-select: none; text-align: center; }
  .sos-c-swatch img { width: 48px; height: 34px; object-fit: cover; border-radius: 6px; display: block; }
  .sos-swatch-add { width: 48px; height: 34px; border: 1px dashed #c9c2b1; border-radius: 6px; display: flex; align-items: center; justify-content: center; color: #a39b88; cursor: pointer; font-size: 16px; }
  .sos-c-label input { width: 100%; border: 1px solid transparent; border-radius: 6px; padding: 5px 8px; font-size: 13.5px; font-weight: 600; color: #1e2d3d; background: transparent; }
  .sos-c-label input:hover:not(:disabled), .sos-c-label input:focus { border-color: #d8d2c4; background: #fff; outline: none; }
  .sos-value { font-size: 10.5px; color: #a39b88; font-family: 'JetBrains Mono', monospace; padding-left: 8px; }
  .sos-c-premium { display: flex; align-items: center; gap: 4px; }
  .sos-c-premium input { width: 70px; border: 1px solid transparent; border-radius: 6px; padding: 5px 8px; font-size: 13.5px; color: #1e2d3d; background: transparent; text-align: right; }
  .sos-c-premium input:hover:not(:disabled), .sos-c-premium input:focus { border-color: #d8d2c4; background: #fff; outline: none; }
  .sos-pct { font-size: 12px; color: #8b8577; }
  .sos-c-actions { text-align: right; }
  .sos-act { border: 1px solid #d8d2c4; background: #fff; border-radius: 6px; padding: 5px 10px; font-size: 12px; font-weight: 600; cursor: pointer; }
  .sos-act-off { color: #8f2b21; border-color: #ecc9c3; }
  .sos-act-off:hover { background: #fbeeec; }
  .sos-act-on { color: #22633a; border-color: #cfe4cf; }
  .sos-act-on:hover { background: #eef6ee; }
  .sos-inactive { margin-top: 14px; }
  .sos-disclosure { border: none; background: transparent; font-size: 13px; font-weight: 600; color: #4a5260; cursor: pointer; padding: 4px 0; margin-bottom: 6px; }
  .sos-addform { border: 1px solid #e3ded2; border-radius: 10px; background: #fbfaf7; padding: 12px 14px; margin-bottom: 14px; display: flex; align-items: flex-end; gap: 12px; }
  .sos-addform-grid { display: grid; grid-template-columns: 1fr 110px 1fr; gap: 10px; flex: 1; }
  .sos-addform label { display: flex; flex-direction: column; gap: 4px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: #8b8577; }
  .sos-addform input { border: 1px solid #d8d2c4; border-radius: 6px; padding: 7px 9px; font-size: 13px; background: #fff; }
`
