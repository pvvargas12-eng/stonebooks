// =============================================================================
// QuotesManager — additional-quote editor for an order (multi-quote substrate).
// =============================================================================
// Controlled component: the parent owns `order` and persists via `update`
// ({ quotes }). Renders nothing extra when there are no additional quotes, so a
// single-quote order behaves byte-identically to before (additive only).
//
// Data model: Quote 1 = the order's live primary columns. order.quotes holds the
// ADDITIONAL quotes only — each { id, title, spec }, spec = extractSpecFromOrder
// snapshot. No cached total: every quote is priced live by synthesizing
// applySpecToOrder(order, spec) and running the form engine (matches the PDF).
//
// Step-4 path = FOCUSED EDITOR (not the wizard pickers): the two mount points
// (wizard PricingStep + new-order OrderForm) use DIFFERENT native stone-spec
// pickers (ShapeStep vs MonumentCard), so a single synthetic-order adapter can't
// serve both. This focused editor reuses the shared DATA (SHAPES, GRANITE_COLORS,
// ADD_ONS_CATALOG) and is mount-agnostic. v1 covers shape/size, graniteColor,
// foundation, and catalog add-ons; base config and configurator add-ons
// (BLING/Vase/etc.) inherit Quote 1's values.
//
// Mausoleum orders are single-quote (their pricing is custom/TBD and isn't
// captured by the spec) — "Add additional quote" is hidden with a short note.
// =============================================================================

import { useState } from 'react'
import { SHAPES, GRANITE_COLORS, ADD_ONS_CATALOG } from '../SalesMode'
import { computeFormLineItems, computeTotals } from '../lib/orderRates'
import { extractSpecFromOrder, applySpecToOrder } from '../lib/quoteSpec'

const money = (n) =>
  `$${(Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const newId = () =>
  (globalThis.crypto?.randomUUID?.() || `q-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`)

// Price any (synthesized) order via the live form engine — the SAME path the
// estimate PDF uses, so a quote's shown total can never disagree with its PDF.
function priceOrder(o) {
  const items = computeFormLineItems(o)
  const pr = o.pricing || {}
  const totals = computeTotals(items, {
    applyTax: pr.applyTax !== false,
    applyCCSurcharge: !!pr.applyCCSurcharge,
    discountType: pr.discountType,
    discountValue: pr.discountValue,
    discountPct: Number(pr.discountPct) || 0,
  })
  const manual = (pr.manualTotal != null && pr.manualTotal !== '') ? Number(pr.manualTotal) : null
  return manual != null ? manual : totals.grandTotal
}

export default function QuotesManager({ order, update }) {
  const quotes = Array.isArray(order.quotes) ? order.quotes : []
  const isMausoleum = (order.serviceTypes || []).includes('MAUSOLEUM')
  const isLocked = !!(order.signedAt || order.pricingLockedAt)
  const [openId, setOpenId] = useState(null)

  const setQuotes = (next) => update({ quotes: next })
  const addQuote = () => {
    if (isLocked || isMausoleum) return
    const q = { id: newId(), title: `Quote ${quotes.length + 2}`, spec: extractSpecFromOrder(order) }
    setQuotes([...quotes, q])
    setOpenId(q.id)
  }
  const patchQuote = (id, patch) => setQuotes(quotes.map((q) => (q.id === id ? { ...q, ...patch } : q)))
  const patchSpec = (id, specPatch) =>
    setQuotes(quotes.map((q) => (q.id === id ? { ...q, spec: { ...q.spec, ...specPatch } } : q)))
  const removeQuote = (id) => setQuotes(quotes.filter((q) => q.id !== id))

  return (
    <div style={S.wrap}>
      <div style={S.headRow}>
        <span style={S.h}>Quotes</span>
        {!isLocked && !isMausoleum && (
          <button type="button" style={S.addBtn} onClick={addQuote}>+ Add additional quote</button>
        )}
      </div>

      {isMausoleum && (
        <div style={S.note}>Multiple quotes aren’t available for mausoleum orders.</div>
      )}

      {/* Quote 1 — the live order. Only labeled when alternatives exist. */}
      {quotes.length > 0 && (
        <>
          <div style={S.q1row}>
            <span style={S.q1title}>Quote 1</span>
            <span style={S.q1total}>{money(priceOrder(order))}</span>
          </div>
          <div style={S.subtle}>Quote 1 is this order’s current configuration (edit it on the form above).</div>
        </>
      )}

      {quotes.map((q) => {
        const synth = applySpecToOrder(order, q.spec)
        const isOpen = openId === q.id
        return (
          <div key={q.id} style={S.qcard}>
            <div style={S.qrow}>
              <input
                style={S.titleInput}
                value={q.title || ''}
                disabled={isLocked}
                placeholder="Quote title"
                onChange={(e) => patchQuote(q.id, { title: e.target.value })}
              />
              <span style={S.qtotal}>{money(priceOrder(synth))}</span>
              <button type="button" style={S.linkBtn} onClick={() => setOpenId(isOpen ? null : q.id)}>
                {isOpen ? 'Close' : 'Edit'}
              </button>
              {!isLocked && (
                <button type="button" style={S.xBtn} title="Remove this quote" onClick={() => removeQuote(q.id)}>×</button>
              )}
            </div>
            {isOpen && (
              <QuoteEditor order={order} spec={q.spec || {}} disabled={isLocked} onSpec={(p) => patchSpec(q.id, p)} />
            )}
          </div>
        )
      })}
    </div>
  )
}

// Focused per-quote editor — shape/size, graniteColor, foundation, catalog add-ons.
function QuoteEditor({ order, spec, disabled, onSpec }) {
  const svc = spec.serviceTypes || order.serviceTypes || []
  const availableShapes = SHAPES.filter(
    (s) => !s.onlyForServices || s.onlyForServices.some((x) => svc.includes(x)),
  )
  const shape = SHAPES.find((s) => s.code === spec.shape)
  const sizes = shape?.standardSizes || []
  const addOns = spec.addOns || []
  const catalogAddons = ADD_ONS_CATALOG.filter((a) => !a.custom)

  const pickShape = (code) => {
    const s = SHAPES.find((x) => x.code === code)
    onSpec({
      shape: code || null,
      standardSizeCode: null,
      width: null, depth: null, thickness: null,
      baseConfig: { ...(spec.baseConfig || {}), include: !!s?.requiresBase },
      customShape: code === 'custom' ? spec.customShape : null,
    })
  }
  const pickSize = (sizeCode) => {
    if (!sizeCode || sizeCode === 'custom') { onSpec({ standardSizeCode: null }); return }
    const sz = sizes.find((s) => s.code === sizeCode)
    onSpec({ standardSizeCode: sizeCode, width: sz?.w ?? null, depth: sz?.d ?? null, thickness: sz?.t ?? null })
  }
  const toggleFoundation = () =>
    onSpec({ pricing: { ...(spec.pricing || {}), foundationCalc: !(spec.pricing?.foundationCalc) } })
  const toggleAddon = (cat) => {
    const next = addOns.some((a) => a.code === cat.code)
      ? addOns.filter((a) => a.code !== cat.code)
      : [...addOns, { code: cat.code, qty: 1, price: cat.price, label: cat.label }]
    onSpec({ addOns: next })
  }
  const setAddonQty = (code, qty) =>
    onSpec({ addOns: addOns.map((a) => (a.code === code ? { ...a, qty: Math.max(1, Number(qty) || 1) } : a)) })

  return (
    <div style={S.editor}>
      <div style={S.field}>
        <label style={S.lab}>Shape</label>
        <select style={S.sel} disabled={disabled} value={spec.shape || ''} onChange={(e) => pickShape(e.target.value)}>
          <option value="">— pick shape —</option>
          {availableShapes.map((s) => <option key={s.code} value={s.code}>{s.label}</option>)}
        </select>
      </div>

      <div style={S.field}>
        <label style={S.lab}>Size</label>
        <select style={S.sel} disabled={disabled || !shape} value={spec.standardSizeCode || ''} onChange={(e) => pickSize(e.target.value)}>
          <option value="">{shape ? '— pick size (or custom) —' : 'pick a shape first'}</option>
          {sizes.map((s) => <option key={s.code} value={s.code}>{s.label} — {money(s.price)}</option>)}
          {shape && <option value="custom">Custom (set price on the line above)</option>}
        </select>
      </div>

      <div style={S.field}>
        <label style={S.lab}>Granite color</label>
        <select style={S.sel} disabled={disabled} value={spec.graniteColor || ''} onChange={(e) => onSpec({ graniteColor: e.target.value || null })}>
          <option value="">— pick color —</option>
          {GRANITE_COLORS.map((c) => (
            <option key={c.code} value={c.code}>{c.label}{c.premium > 0 ? ` (+${Math.round(c.premium * 100)}%)` : ''}</option>
          ))}
        </select>
      </div>

      <div style={S.field}>
        <label style={S.lab}>Foundation</label>
        <button type="button" disabled={disabled} style={{ ...S.chip, ...(spec.pricing?.foundationCalc ? S.chipOn : null) }} onClick={toggleFoundation}>
          {spec.pricing?.foundationCalc ? '✓ Included' : 'Not included'}
        </button>
      </div>

      <div style={S.field}>
        <label style={S.lab}>Add-ons</label>
        <div style={S.addonList}>
          {catalogAddons.map((cat) => {
            const on = addOns.find((a) => a.code === cat.code)
            return (
              <div key={cat.code} style={S.addonRow}>
                <label style={S.addonLbl}>
                  <input type="checkbox" disabled={disabled} checked={!!on} onChange={() => toggleAddon(cat)} /> {cat.label} ({money(cat.price)})
                </label>
                {on && (
                  <input type="number" min="1" disabled={disabled} style={S.qty} value={on.qty || 1}
                    onChange={(e) => setAddonQty(cat.code, e.target.value)} />
                )}
              </div>
            )
          })}
        </div>
        <div style={S.subtle}>Base config and configurator add-ons (BLING, Vase, etc.) follow Quote 1.</div>
      </div>
    </div>
  )
}

const S = {
  wrap: { border: '1px solid #e3ded3', borderRadius: 8, padding: 12, marginTop: 12, background: '#fcfbf8' },
  headRow: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 },
  h: { fontWeight: 700, fontSize: 14 },
  addBtn: { marginLeft: 'auto', border: '1px solid #9a7209', color: '#9a7209', background: '#fff', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontWeight: 600 },
  note: { fontSize: 12, color: '#777', fontStyle: 'italic' },
  subtle: { fontSize: 11, color: '#8a8472', marginTop: 2 },
  q1row: { display: 'flex', alignItems: 'center', padding: '6px 4px', borderTop: '1px solid #eee7d8' },
  q1title: { fontWeight: 700 },
  q1total: { marginLeft: 'auto', fontWeight: 700 },
  qcard: { border: '1px solid #ece6d8', borderRadius: 6, padding: 8, marginTop: 8, background: '#fff' },
  qrow: { display: 'flex', alignItems: 'center', gap: 8 },
  titleInput: { flex: '0 0 200px', border: '1px solid #d8d2c4', borderRadius: 4, padding: '4px 6px' },
  qtotal: { marginLeft: 'auto', fontWeight: 700 },
  linkBtn: { border: 'none', background: 'none', color: '#9a7209', cursor: 'pointer', fontWeight: 600 },
  xBtn: { border: 'none', background: 'none', color: '#b3261e', cursor: 'pointer', fontSize: 16, lineHeight: 1 },
  editor: { marginTop: 8, paddingTop: 8, borderTop: '1px dashed #e3ded3', display: 'grid', gap: 8 },
  field: { display: 'grid', gridTemplateColumns: '110px 1fr', alignItems: 'center', gap: 8 },
  lab: { fontSize: 12, color: '#555', fontWeight: 600 },
  sel: { width: '100%', padding: '4px 6px', border: '1px solid #d8d2c4', borderRadius: 4 },
  chip: { border: '1px solid #d8d2c4', background: '#fff', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', width: 'fit-content' },
  chipOn: { borderColor: '#9a7209', color: '#9a7209', background: '#fbf6e9', fontWeight: 600 },
  addonList: { display: 'grid', gap: 4 },
  addonRow: { display: 'flex', alignItems: 'center', gap: 8 },
  addonLbl: { fontSize: 13 },
  qty: { width: 56, padding: '2px 4px', border: '1px solid #d8d2c4', borderRadius: 4 },
}
