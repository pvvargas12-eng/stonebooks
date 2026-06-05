// =============================================================================
// 📚 Stonebooks — Vendor item card (shared by the internal + partner forms)
// =============================================================================
// Controlled over an in-memory item: { workType, vendorReference, stoneSize,
// baseSize, color, cemetery, deceasedFamilyName, itemNotes, _files: File[] }.
// Files are staged in memory and uploaded by the parent after the item is saved
// (a brand-new item has no id to attach to yet). The notes box is PROMINENT with
// a work-type-specific placeholder.
// =============================================================================

import { useState, useRef } from 'react'

const WORK_TYPES = [
  { code: 'design',   label: 'Design' },
  { code: 'blasting', label: 'Blasting' },
  { code: 'setting',  label: 'Setting' },
  { code: 'other',    label: 'Other' },
]
const COMMON_COLORS = ['Barre Gray', 'Jet Black', 'Bahama Blue', 'Mountain Rose', 'India Red', 'Mahogany', 'Impala Black', 'Royal Pink', 'Forest Green', 'White', 'Gray']
const NOTE_PLACEHOLDER = {
  design: "Design instructions / customer email — paste the customer's email, inscription request, layout notes, or design instructions here.",
  blasting: 'Add blasting instructions, stencil notes, layout notes, or pickup notes.',
  setting: 'Add cemetery / location / setting instructions.',
  other: 'Describe what needs to be done.',
}

export default function VendorItemCard({ item, index, onChange, onDuplicate, onRemove, canRemove = true }) {
  const [showOptional, setShowOptional] = useState(!!(item.cemetery || item.deceasedFamilyName))
  const fileRef = useRef(null)
  const wt = item.workType || 'design'
  const set = (patch) => onChange({ ...item, ...patch })
  const files = item._files || []

  const addFiles = (list) => {
    const next = [...files, ...Array.from(list || [])]
    set({ _files: next })
    if (fileRef.current) fileRef.current.value = ''
  }

  return (
    <div className="vic">
      <div className="vic-head">
        <span className="vic-num">Item {index + 1}</span>
        <div className="vic-head-actions">
          <button type="button" className="vic-mini" onClick={onDuplicate}>Duplicate</button>
          {canRemove && <button type="button" className="vic-mini vic-mini-danger" onClick={onRemove}>Remove</button>}
        </div>
      </div>

      <div className="vic-tiles">
        {WORK_TYPES.map(t => (
          <button key={t.code} type="button" className={`vic-tile ${wt === t.code ? 'on' : ''}`} onClick={() => set({ workType: t.code })}>{t.label}</button>
        ))}
      </div>

      <div className="vic-grid">
        <label className="vic-field">
          <span>Vendor reference</span>
          <input className="vic-input" value={item.vendorReference || ''} onChange={e => set({ vendorReference: e.target.value })} placeholder="e.g. HM-2441" />
        </label>
        <label className="vic-field">
          <span>Color</span>
          <input className="vic-input" list={`vic-colors-${index}`} value={item.color || ''} onChange={e => set({ color: e.target.value })} placeholder="Select or type" />
          <datalist id={`vic-colors-${index}`}>{COMMON_COLORS.map(c => <option key={c} value={c} />)}</datalist>
        </label>
        <label className="vic-field">
          <span>Stone size</span>
          <input className="vic-input" value={item.stoneSize || ''} onChange={e => set({ stoneSize: e.target.value })} placeholder="L × W × T" />
        </label>
        <label className="vic-field">
          <span>Base size</span>
          <input className="vic-input" value={item.baseSize || ''} onChange={e => set({ baseSize: e.target.value })} placeholder="L × W × T" />
        </label>
      </div>

      {/* Attachments for THIS item */}
      <div className="vic-files"
        onDragOver={e => { e.preventDefault() }}
        onDrop={e => { e.preventDefault(); addFiles(e.dataTransfer.files) }}>
        <input ref={fileRef} type="file" multiple style={{ display: 'none' }} onChange={e => addFiles(e.target.files)} />
        <button type="button" className="vic-files-btn" onClick={() => fileRef.current?.click()}>+ Attach files</button>
        <span className="vic-files-hint">drag &amp; drop or tap</span>
        {files.length > 0 && (
          <div className="vic-files-list">
            {files.map((f, i) => (
              <span key={i} className="vic-file-chip">{f.name}<button type="button" onClick={() => set({ _files: files.filter((_, j) => j !== i) })}>×</button></span>
            ))}
          </div>
        )}
      </div>

      {/* Notes — prominent */}
      <label className="vic-notes">
        <span className="vic-notes-label">Item notes / instructions</span>
        <textarea className="vic-notes-input" rows={4} value={item.itemNotes || ''} onChange={e => set({ itemNotes: e.target.value })} placeholder={NOTE_PLACEHOLDER[wt] || NOTE_PLACEHOLDER.other} />
      </label>

      {/* Optional details */}
      {showOptional ? (
        <div className="vic-grid">
          <label className="vic-field"><span>Cemetery</span><input className="vic-input" value={item.cemetery || ''} onChange={e => set({ cemetery: e.target.value })} placeholder="optional" /></label>
          <label className="vic-field"><span>Deceased / family name</span><input className="vic-input" value={item.deceasedFamilyName || ''} onChange={e => set({ deceasedFamilyName: e.target.value })} placeholder="optional" /></label>
        </div>
      ) : (
        <button type="button" className="vic-optional-toggle" onClick={() => setShowOptional(true)}>+ Add cemetery / family name</button>
      )}
    </div>
  )
}

export const VENDOR_ITEM_CARD_CSS = `
  .vic { border: 0.5px solid #e6e3dd; border-radius: 12px; padding: 16px; background: #fff; display: flex; flex-direction: column; gap: 12px; }
  .vic-head { display: flex; align-items: center; justify-content: space-between; }
  .vic-num { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: #8a8a85; }
  .vic-head-actions { display: flex; gap: 8px; }
  .vic-mini { font: inherit; font-size: 12px; color: #6b6b66; background: none; border: 0.5px solid #e6e3dd; border-radius: 6px; padding: 3px 10px; cursor: pointer; }
  .vic-mini:hover { background: #f4f2ee; }
  .vic-mini-danger:hover { color: #b54040; border-color: #e3b3b3; background: #fbe5e5; }
  .vic-tiles { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
  .vic-tile { font: inherit; font-size: 13px; font-weight: 500; padding: 9px; border: 0.5px solid #e6e3dd; background: #fff; color: #6b6b66; border-radius: 8px; cursor: pointer; }
  .vic-tile.on { border-color: #9A7209; color: #9A7209; background: #fdf8ec; font-weight: 600; }
  .vic-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .vic-field { display: flex; flex-direction: column; gap: 4px; }
  .vic-field > span { font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: #8a8a85; font-weight: 600; }
  .vic-input { font: inherit; font-size: 14px; padding: 9px 11px; border: 0.5px solid #e6e3dd; border-radius: 8px; background: #fff; width: 100%; box-sizing: border-box; }
  .vic-files { border: 0.5px dashed #d8d6d1; border-radius: 8px; padding: 10px 12px; display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .vic-files-btn { font: inherit; font-size: 13px; font-weight: 600; color: #9A7209; background: none; border: none; cursor: pointer; padding: 0; }
  .vic-files-hint { font-size: 12px; color: #a0a09a; }
  .vic-files-list { display: flex; flex-wrap: wrap; gap: 6px; width: 100%; }
  .vic-file-chip { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; background: #f4f2ee; border-radius: 6px; padding: 3px 8px; }
  .vic-file-chip button { font: inherit; border: none; background: none; cursor: pointer; color: #8a8a85; font-size: 14px; }
  .vic-notes { display: flex; flex-direction: column; gap: 5px; background: #fdf8ec; border: 0.5px solid #e8d9a8; border-radius: 10px; padding: 12px; }
  .vic-notes-label { font-size: 12px; font-weight: 700; color: #6b5d2f; text-transform: uppercase; letter-spacing: 0.04em; }
  .vic-notes-input { font: inherit; font-size: 14px; line-height: 1.5; padding: 10px; border: 0.5px solid #e0d6b0; border-radius: 8px; background: #fff; resize: vertical; }
  .vic-optional-toggle { font: inherit; font-size: 13px; color: #9A7209; background: none; border: none; cursor: pointer; padding: 0; align-self: flex-start; }
  @media (max-width: 700px) { .vic-grid { grid-template-columns: 1fr; } .vic-tiles { grid-template-columns: repeat(2, 1fr); } }
`
