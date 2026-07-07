// =============================================================================
// Stonebooks — ContractEditor
// =============================================================================
// The per-order contract/estimate wording editor (the "no more Photoshop"
// surface). Renders the document as an editable paper page: every block is
// click-to-edit, prefilled with the GENERATED text from buildContractDefaults
// (the same shared builders the PDF generator reads, so "auto" here is exactly
// what prints). Saving writes order.pricing.contractOverrides — text only;
// money stays in the pricing engine. One override layer serves BOTH documents.
//
// Props (all data is prepared by the OPENER — OrderDetail's handler — so this
// component stays render-pure; buildContractDefaults calls new Date()):
//   camel     — camelCase order (rowToOrder output) for live PDF previews
//   defaults  — buildContractDefaults(camel, { isContract: true })
//   existing  — order.pricing.contractOverrides || null
//   lineItems — priced items [{ code, label, amount }] (read-only this slice)
//   total     — priceOrderTotals(camel).displayed
//   locked    — true when the contract is signed (view-only; unlock to edit)
//   onClose() / onSave(overridesOrNull) → { ok, error? }
// =============================================================================

import { useState, useEffect, useRef, useMemo } from 'react'
import { generateEstimatePDF } from '../SalesMode'
import { fmtUSD } from '../lib/stonebooksData'
import { LineItemsBox, OF_CSS } from '../OrderForm'
import { priceOrderTotals } from '../lib/orderRates'

// Text blocks that can be overridden (order = document order). `hideKey` blocks
// can be removed from the print entirely; boxes and fields cannot (core layout).
const TEXT_BLOCKS = [
  { key: 'dueDateText',  label: 'Due date (headline)', doc: 'contract', input: true },
  { key: 'dueDateNote',  label: 'Delivery disclaimer', doc: 'contract', hideKey: 'dueDate' },
  { key: 'validityNote', label: 'Validity note',       doc: 'estimate', hideKey: 'validity', input: true },
  { key: 'customerBox',  label: 'Name / address / phone / email', doc: 'both' },
  { key: 'cemeteryBox',  label: 'Cemetery',            doc: 'both' },
  { key: 'deceasedBlock', label: 'Deceased information', doc: 'both', hideKey: 'deceased',
    hint: 'One person per line. Write "Name | dates" to right-align the dates on the printed page.' },
  { key: 'notesText',    label: 'Note under pricing',  doc: 'both', hideKey: 'notes',
    hint: 'Optional customer-facing paragraph printed under the pricing box. Leave empty for none.' },
  { key: 'terms',        label: 'Terms & conditions',  doc: 'contract', hideKey: 'terms',
    hint: 'Separate paragraphs with a blank line — numbering is added automatically when printed.' },
]
const FIELD_ROWS = [
  ['date', 'Date'], ['dueDate', 'Due Date'], ['familyName', 'Family Name'], ['orderNumber', 'Order #'],
]

export default function ContractEditor({ camel, defaults, existing, locked, onClose, onSave }) {
  const [ov, setOv] = useState(() => {
    const base = existing ? { ...existing } : {}
    base.fields = { ...(existing?.fields || {}) }
    return base
  })
  const [hidden, setHidden] = useState(() => new Set(existing?.hidden || []))
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  // ── Line items (slice 3) — the REAL pricing mechanisms, drafted locally ────
  // LineItemsBox edits pricing.{lineItemLabels,lineItemOrder,lineItemOverrides,
  // customLineItems,removedLineItems,lineItemFlagOverrides} and order.addOns
  // (qty steppers) — the exact keys the Pricing step writes, so receipts,
  // quotes, and totals stay honest. Edits stage in pricingPatch / addOnsDraft
  // until Save; priceOrderTotals recomputes the folded rows + total live.
  const [pricingPatch, setPricingPatch] = useState({})
  const [addOnsDraft, setAddOnsDraft] = useState(null)   // null = untouched
  const draftOrder = useMemo(() => ({
    ...camel,
    addOns: addOnsDraft ?? camel.addOns,
    pricing: { ...(camel.pricing || {}), ...pricingPatch },
  }), [camel, pricingPatch, addOnsDraft])
  const priced = useMemo(() => priceOrderTotals(draftOrder), [draftOrder])
  const updatePricing = (patch) => setPricingPatch(p => ({ ...p, ...patch }))
  const updateDraft = (patch) => { if (patch.addOns) setAddOnsDraft(patch.addOns) }
  const linesDirty = Object.keys(pricingPatch).length > 0 || addOnsDraft != null
  const [preview, setPreview] = useState(null)   // { url, filename, label }
  const previewRef = useRef(null)
  useEffect(() => { previewRef.current = preview }, [preview])

  // Escape closes the preview first, then the editor. Blob URLs are revoked on
  // every close path (ref, not state updater — updaters must stay side-effect-free).
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return
      if (previewRef.current) {
        URL.revokeObjectURL(previewRef.current.url)
        setPreview(null)
      } else {
        onClose()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])
  useEffect(() => () => { if (previewRef.current?.url) URL.revokeObjectURL(previewRef.current.url) }, [])

  const defStr = (key) => String(defaults[key] ?? '')
  const val = (key) => (ov[key] != null ? ov[key] : defStr(key))
  const isCustom = (key) => ov[key] != null && String(ov[key]).trim() !== defStr(key).trim()
  const setVal = (key) => (e) => { const v = e.target.value; setOv(p => ({ ...p, [key]: v })) }
  const resetVal = (key) => setOv(p => { const n = { ...p }; delete n[key]; return n })

  const fieldVal = (k) => (ov.fields?.[k] != null ? ov.fields[k] : String(defaults.fields[k] ?? ''))
  const fieldCustom = (k) => ov.fields?.[k] != null && ov.fields[k].trim() !== String(defaults.fields[k] ?? '').trim()
  const setField = (k) => (e) => { const v = e.target.value; setOv(p => ({ ...p, fields: { ...(p.fields || {}), [k]: v } })) }
  const resetFieldKey = (k) => setOv(p => { const f = { ...(p.fields || {}) }; delete f[k]; return { ...p, fields: f } })

  const toggleHidden = (key) => setHidden(prev => {
    const n = new Set(prev); if (n.has(key)) n.delete(key); else n.add(key); return n
  })

  const anyCustom = TEXT_BLOCKS.some(b => isCustom(b.key)) || FIELD_ROWS.some(([k]) => fieldCustom(k)) || hidden.size > 0
  const resetAll = () => { setOv({ fields: {} }); setHidden(new Set()) }

  // Only genuine differences are stored — a value identical to its generated
  // default is dropped, so untouched orders carry no contractOverrides at all.
  const normalized = () => {
    const out = {}
    const fields = {}
    for (const [k] of FIELD_ROWS) {
      const v = ov.fields?.[k]
      if (v != null && v.trim() && v.trim() !== String(defaults.fields[k] ?? '').trim()) fields[k] = v.trim()
    }
    if (Object.keys(fields).length) out.fields = fields
    for (const b of TEXT_BLOCKS) {
      const v = ov[b.key]
      if (v != null && v.trim() && v.trim() !== defStr(b.key).trim()) out[b.key] = v
    }
    if (hidden.size) out.hidden = [...hidden]
    return Object.keys(out).length ? out : null
  }

  const handleSave = async () => {
    setBusy(true); setErr(null)
    const r = await onSave({
      overrides: normalized(),
      pricingPatch: linesDirty ? pricingPatch : null,
      addOns: addOnsDraft,
    })
    setBusy(false)
    if (r?.ok) onClose()
    else setErr(r?.error || 'Save failed — nothing was changed. Try again.')
  }

  const openPreview = async (docMode) => {
    setErr(null)
    try {
      // Preview includes UNSAVED edits — wording overrides AND line-item drafts.
      const o = { ...draftOrder, pricing: { ...draftOrder.pricing, contractOverrides: normalized() || undefined } }
      const { doc, filename } = await generateEstimatePDF(o, { mode: docMode, returnDoc: true })
      const url = URL.createObjectURL(doc.output('blob'))
      setPreview(p => { if (p?.url) URL.revokeObjectURL(p.url); return { url, filename, label: docMode === 'contract' ? 'Contract preview' : 'Estimate preview' } })
    } catch (e) {
      setErr(`Preview failed — ${e?.message || 'error'}.`)
    }
  }
  const closePreview = () => setPreview(p => { if (p?.url) URL.revokeObjectURL(p.url); return null })

  const rowsFor = (text) => Math.min(14, Math.max(2, String(text).split('\n').length + (text.length > 400 ? 3 : 0)))

  const blockHead = (label, custom, onReset, extra) => (
    <div className="sb-ce-bhead">
      <span className="sb-ce-blabel">{label}</span>
      <span className={`sb-ce-chip${custom ? ' custom' : ''}`}>{custom ? 'Custom' : 'Auto'}</span>
      {extra}
      {custom && <button type="button" className="sb-ce-reset" onClick={onReset}>Reset to auto</button>}
    </div>
  )
  const docTag = (docKind) => docKind !== 'both' && (
    <span className={`sb-ce-doctag sb-ce-doctag-${docKind}`}>{docKind === 'contract' ? 'Contract only' : 'Estimate only'}</span>
  )
  const hideToggle = (hideKey) => hideKey && (
    <label className="sb-ce-hide">
      <input type="checkbox" checked={hidden.has(hideKey)} onChange={() => toggleHidden(hideKey)} disabled={locked} />
      Don't print this section
    </label>
  )

  return (
    <div className="sb-ce-overlay" onClick={onClose}>
      <style>{CE_CSS}</style>
      <div className="sb-ce-shell" onClick={e => e.stopPropagation()}>
        <header className="sb-ce-toolbar">
          <div className="sb-ce-title">
            Contract editor
            <span className="sb-ce-sub">{camel.orderNumber || 'DRAFT'} · edits print on the contract AND the estimate</span>
          </div>
          <div className="sb-ce-actions">
            <button type="button" className="sb-ce-btn" onClick={() => openPreview('contract')}>Preview contract</button>
            <button type="button" className="sb-ce-btn" onClick={() => openPreview('estimate')}>Preview estimate</button>
            {anyCustom && !locked && <button type="button" className="sb-ce-btn sb-ce-btn-warn" onClick={resetAll}>Reset wording to auto</button>}
            <button type="button" className="sb-ce-btn" onClick={onClose}>Cancel</button>
            <button type="button" className="sb-ce-btn sb-ce-btn-primary" onClick={handleSave} disabled={busy || locked}>
              {busy ? 'Saving…' : 'Save'}
            </button>
          </div>
        </header>

        {locked && (
          <div className="sb-ce-lockbar">
            This contract is <strong>signed &amp; locked</strong> — wording can't change on a signed agreement.
            Use Unlock &amp; Edit on the Sign step first if you truly need to reword it.
          </div>
        )}
        {err && <div className="sb-ce-err">{err}</div>}

        <div className="sb-ce-scroll">
          <div className="sb-ce-paper">
            {/* Letterhead (fixed) + header info box (editable fields) */}
            <div className="sb-ce-letterhead">
              <div>
                <div className="sb-ce-company">SHEVCHENKO MONUMENTS, LLC.</div>
                <div className="sb-ce-company-sub">Letterhead prints automatically</div>
              </div>
              <div className="sb-ce-doctitle">CONTRACT / ESTIMATE</div>
            </div>
            <div className="sb-ce-infobox">
              {FIELD_ROWS.map(([k, label]) => (
                <div key={k} className="sb-ce-inforow">
                  <span className="sb-ce-infolabel">{label}</span>
                  <input className={`sb-ce-input${fieldCustom(k) ? ' custom' : ''}`} value={fieldVal(k)}
                    onChange={setField(k)} disabled={locked} aria-label={label} />
                  {fieldCustom(k) && <button type="button" className="sb-ce-reset" onClick={() => resetFieldKey(k)}>↺</button>}
                </div>
              ))}
            </div>

            {/* Editable text blocks, in document order */}
            {TEXT_BLOCKS.map(b => (
              <section key={b.key} className={`sb-ce-block${hidden.has(b.hideKey) ? ' off' : ''}`}>
                {blockHead(b.label, isCustom(b.key), () => resetVal(b.key), <>
                  {docTag(b.doc)}
                  {hideToggle(b.hideKey)}
                </>)}
                {b.input ? (
                  <input className="sb-ce-input sb-ce-input-wide" value={val(b.key)} onChange={setVal(b.key)}
                    disabled={locked || hidden.has(b.hideKey)} aria-label={b.label} />
                ) : (
                  <textarea className="sb-ce-ta" value={val(b.key)} onChange={setVal(b.key)}
                    rows={rowsFor(val(b.key))} disabled={locked || hidden.has(b.hideKey)} aria-label={b.label} />
                )}
                {b.hint && <div className="sb-ce-hint">{b.hint}</div>}
              </section>
            ))}

            {/* Pricing — the REAL line-item editor (same component as the
                Pricing step / multi-quotes): rename ✎, ▲▼ reorder, price
                override, remove/restore, add custom line, qty steppers. */}
            <section className="sb-ce-block">
              <div className="sb-ce-bhead">
                <span className="sb-ce-blabel">Pricing</span>
                <span className={`sb-ce-chip${linesDirty ? ' custom' : ''}`}>{linesDirty ? 'Edited — saves with this order' : 'From the pricing engine'}</span>
              </div>
              <style>{OF_CSS}</style>
              <LineItemsBox order={draftOrder} lineItems={priced.items}
                update={updateDraft} updatePricing={updatePricing} isLocked={locked} />
              <div className="sb-ce-lines" style={{ marginTop: 8 }}>
                <div className="sb-ce-line sb-ce-line-total">
                  <span className="sb-ce-line-label">TOTAL</span>
                  <span className="sb-ce-line-amt">{fmtUSD(priced.displayed)}</span>
                </div>
              </div>
              <div className="sb-ce-hint">
                Renames print exactly as typed (spec kept as fine print); price edits go through the same
                override system as the Pricing step, so receipts and balances always match.
              </div>
            </section>
          </div>
        </div>
      </div>

      {preview && (
        <div className="sb-ce-pv" onClick={closePreview}>
          <div className="sb-ce-pv-shell" onClick={e => e.stopPropagation()}>
            <div className="sb-ce-pv-bar">
              <span>{preview.label} — unsaved edits included</span>
              <button type="button" className="sb-ce-btn" onClick={closePreview}>✕ Close preview</button>
            </div>
            <iframe title="Document preview" src={preview.url} className="sb-ce-pv-frame" />
          </div>
        </div>
      )}
    </div>
  )
}

const CE_CSS = `
  .sb-ce-overlay { position: fixed; inset: 0; z-index: 1080; background: rgba(15,20,25,0.55); display: flex; align-items: stretch; justify-content: center; padding: 18px; }
  .sb-ce-shell { background: #f0ede6; border-radius: 14px; width: min(940px, 100%); display: flex; flex-direction: column; overflow: hidden; box-shadow: 0 24px 60px rgba(0,0,0,0.35); }
  .sb-ce-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; padding: 12px 18px; background: #0f1419; }
  .sb-ce-title { color: #fff; font-size: 16px; font-weight: 700; display: flex; flex-direction: column; }
  .sb-ce-sub { color: #b9b3a6; font-size: 11.5px; font-weight: 500; }
  .sb-ce-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .sb-ce-btn { font: inherit; font-size: 12.5px; font-weight: 600; padding: 7px 13px; border-radius: 8px; border: 0.5px solid rgba(255,255,255,0.35); background: transparent; color: #fff; cursor: pointer; }
  .sb-ce-btn:hover:not(:disabled) { border-color: #d6a85a; color: #d6a85a; }
  .sb-ce-btn:disabled { opacity: 0.5; cursor: default; }
  .sb-ce-btn-primary { background: #9A7209; border-color: #9A7209; }
  .sb-ce-btn-primary:hover:not(:disabled) { background: #876307; color: #fff; }
  .sb-ce-btn-warn { border-color: rgba(230,120,110,0.7); color: #f0a89f; }
  .sb-ce-lockbar { background: #fdf3e2; color: #8a5a12; font-size: 13px; padding: 9px 18px; border-bottom: 0.5px solid #e6b667; }
  .sb-ce-err { background: #fcebeb; color: #a32d2d; font-size: 13px; padding: 9px 18px; }
  .sb-ce-scroll { overflow-y: auto; padding: 18px; }
  .sb-ce-paper { background: #fff; border-radius: 4px; box-shadow: 0 2px 14px rgba(0,0,0,0.18); padding: 26px 30px 30px; max-width: 820px; margin: 0 auto; }
  .sb-ce-letterhead { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; border-bottom: 2px solid #0f1419; padding-bottom: 10px; margin-bottom: 12px; }
  .sb-ce-company { font-size: 18px; font-weight: 800; letter-spacing: 0.01em; color: #0f1419; }
  .sb-ce-company-sub { font-size: 10.5px; color: #a09a8c; }
  .sb-ce-doctitle { font-size: 16px; font-weight: 800; color: #9A7209; }
  .sb-ce-infobox { border: 1px solid #cfc9bb; border-radius: 6px; padding: 8px 10px; width: 320px; margin-left: auto; margin-bottom: 14px; display: flex; flex-direction: column; gap: 5px; }
  .sb-ce-inforow { display: flex; align-items: center; gap: 8px; }
  .sb-ce-infolabel { font-size: 11px; color: #8a8a85; width: 84px; flex-shrink: 0; }
  .sb-ce-input { font: inherit; font-size: 13px; font-weight: 600; padding: 5px 8px; border: 0.5px solid #d8d6d1; border-radius: 6px; background: #fff; color: #1e2d3d; flex: 1; min-width: 0; }
  .sb-ce-input:focus, .sb-ce-ta:focus { outline: none; border-color: #9A7209; box-shadow: 0 0 0 2px rgba(154,114,9,0.15); }
  .sb-ce-input.custom { border-color: #9A7209; background: #fdf8ec; }
  .sb-ce-input-wide { width: 100%; }
  .sb-ce-block { margin-bottom: 16px; }
  .sb-ce-block.off .sb-ce-ta, .sb-ce-block.off .sb-ce-input-wide { opacity: 0.4; text-decoration: line-through; }
  .sb-ce-bhead { display: flex; align-items: center; gap: 8px; margin-bottom: 5px; flex-wrap: wrap; }
  .sb-ce-blabel { font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: #6a6a66; }
  .sb-ce-chip { font-size: 10px; font-weight: 700; border-radius: 999px; padding: 1px 8px; background: #f0ede4; color: #8a8a85; }
  .sb-ce-chip.custom { background: #fdf3d9; color: #876307; border: 0.5px solid #d9b45c; }
  .sb-ce-doctag { font-size: 10px; font-weight: 600; border-radius: 4px; padding: 1px 6px; }
  .sb-ce-doctag-contract { background: #eaf1fb; color: #234c8a; }
  .sb-ce-doctag-estimate { background: #e7f6ee; color: #15724a; }
  .sb-ce-reset { font: inherit; font-size: 11px; font-weight: 600; color: #9A7209; background: none; border: none; cursor: pointer; padding: 0 2px; }
  .sb-ce-reset:hover { text-decoration: underline; }
  .sb-ce-hide { margin-left: auto; display: flex; align-items: center; gap: 5px; font-size: 11px; color: #8a5a12; cursor: pointer; }
  .sb-ce-hide input { accent-color: #9A7209; }
  .sb-ce-ta { font: inherit; font-size: 13px; line-height: 1.45; width: 100%; box-sizing: border-box; padding: 8px 10px; border: 0.5px solid #d8d6d1; border-radius: 6px; background: #fff; color: #1e2d3d; resize: vertical; }
  .sb-ce-hint { font-size: 11px; color: #a09a8c; margin-top: 4px; }
  .sb-ce-lines { border: 0.5px solid #d8d6d1; border-radius: 6px; overflow: hidden; }
  .sb-ce-line { display: flex; justify-content: space-between; gap: 10px; padding: 6px 10px; font-size: 13px; border-bottom: 0.5px solid #ece8df; }
  .sb-ce-line:last-child { border-bottom: none; }
  .sb-ce-line-total { background: #faf8f3; font-weight: 700; }
  .sb-ce-line-amt { font-variant-numeric: tabular-nums; white-space: nowrap; }
  .sb-ce-pv { position: fixed; inset: 0; z-index: 1120; background: rgba(15,20,25,0.6); display: flex; align-items: center; justify-content: center; padding: 20px; }
  .sb-ce-pv-shell { background: #2b2b2b; border-radius: 12px; width: min(900px, 100%); height: 92%; display: flex; flex-direction: column; overflow: hidden; }
  .sb-ce-pv-bar { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 9px 14px; color: #fff; font-size: 13px; }
  .sb-ce-pv-frame { flex: 1; border: none; background: #444; }
`
