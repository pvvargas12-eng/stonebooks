// =============================================================================
// QuotesManager — additional-quote editor (multi-quote substrate).
// =============================================================================
// Controlled: parent owns `order`, persists via `update({ quotes })`. Renders an
// "Add additional quote" entry point; each additional quote is a FULL copy of the
// pricing surface — the real MonumentCard + AddOnsCard config controls + the
// extracted LineItemsBox — so a quote is edited with the SAME controls as the main
// form, not a stripped-down one. (Earlier v1's reduced editor + the baseConfig/
// configurator-add-on inheritance limitation are removed.)
//
// Data model unchanged: Quote 1 = the order's live primary columns; order.quotes
// holds additional quotes as { id, title, spec }, spec = extractSpecFromOrder
// snapshot (no cached totals — priced live by the same engine as the PDF).
//
// Each quote drives the real cards through a SYNTHETIC-ORDER adapter:
//   synth = applySpecToOrder(order, quote.spec)
//   a card's update/updatePricing patch is applied to synth, re-extracted to a
//   spec, and stored on the quote. A useRef holds the latest quotes so two writes
//   in one handler (e.g. MonumentCard's color picker calls update THEN
//   updatePricing) compose instead of clobbering via a stale render snapshot.
//
// OF_CSS is injected here so the reused .of-* cards are styled in BOTH mounts
// (the wizard doesn't otherwise mount OrderForm's stylesheet).
// =============================================================================

import { useState, useRef } from 'react'
import { MonumentCard, AddOnsCard, LineItemsBox, ADDON_KINDS, OF_CSS } from '../OrderForm'
import { computeFormLineItems, computeTotals } from '../lib/orderRates'
import { extractSpecFromOrder, applySpecToOrder } from '../lib/quoteSpec'

const money = (n) =>
  `$${(Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const newId = () =>
  (globalThis.crypto?.randomUUID?.() || `q-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`)

// Price any (synthesized) order via the live engine — the SAME path the estimate
// PDF uses, so a quote's shown total can never disagree with its PDF.
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
  // Computed at render (not module scope) to avoid a temporal-dead-zone read of
  // ADDON_KINDS during the OrderForm<->QuotesManager circular import init.
  const allKinds = ADDON_KINDS.map((k) => k.code)

  // Latest quotes, so sequential writes in one event handler compose (two cards
  // calling update→updatePricing must not clobber via a stale render snapshot).
  const quotesRef = useRef(quotes)
  quotesRef.current = quotes

  const commit = (next) => { quotesRef.current = next; update({ quotes: next }) }
  const patchQuote = (id, patch) => commit(quotesRef.current.map((q) => (q.id === id ? { ...q, ...patch } : q)))
  // Update a quote's spec via a function of its CURRENT spec (ref-latest).
  const patchSpecBy = (id, fn) =>
    commit(quotesRef.current.map((q) => (q.id === id ? { ...q, spec: fn(q.spec) } : q)))
  const removeQuote = (id) => commit(quotesRef.current.filter((q) => q.id !== id))
  const addQuote = () => {
    if (isLocked || isMausoleum) return
    const q = { id: newId(), title: `Quote ${quotes.length + 2}`, spec: extractSpecFromOrder(order) }
    commit([...quotes, q])
    setOpenId(q.id)
  }

  return (
    <div style={S.wrap}>
      <style>{OF_CSS}</style>
      <div style={S.headRow}>
        <span style={S.h}>Quotes</span>
        {!isLocked && !isMausoleum && (
          <button type="button" style={S.addBtn} onClick={addQuote}>+ Add additional quote</button>
        )}
      </div>

      {isMausoleum && <div style={S.note}>Multiple quotes aren’t available for mausoleum orders.</div>}

      {quotes.length > 0 && (
        <>
          <div style={S.q1row}>
            <span style={S.q1title}>Quote 1</span>
            <span style={S.q1total}>{money(priceOrder(order))}</span>
          </div>
          <div style={S.subtle}>Quote 1 is this order’s current configuration (edited on the form above).</div>
        </>
      )}

      {quotes.map((q) => {
        const synth = applySpecToOrder(order, q.spec)
        const lineItems = computeFormLineItems(synth)
        const isOpen = openId === q.id
        // Synthetic-order adapter — route the real cards' edits back into this
        // quote's spec, computed from the quote's CURRENT spec (ref-latest).
        const adUpdate = (patch) =>
          patchSpecBy(q.id, (cur) => extractSpecFromOrder({ ...applySpecToOrder(order, cur), ...patch }))
        const adUpdatePricing = (patch) =>
          patchSpecBy(q.id, (cur) => {
            const s = applySpecToOrder(order, cur)
            return extractSpecFromOrder({ ...s, pricing: { ...(s.pricing || {}), ...patch } })
          })
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
              <div style={S.editor}>
                <MonumentCard order={synth} update={adUpdate} updatePricing={adUpdatePricing} />
                <AddOnsCard order={synth} update={adUpdate} updatePricing={adUpdatePricing} kinds={allKinds} />
                <div className="of-card">
                  <div className="of-card-head"><h3 className="of-card-title">Line items</h3></div>
                  <LineItemsBox order={synth} lineItems={lineItems} updatePricing={adUpdatePricing} />
                </div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

const S = {
  wrap: { border: '1px solid #e3ded3', borderRadius: 8, padding: 12, marginTop: 12, background: '#fcfbf8' },
  headRow: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 },
  h: { fontWeight: 700, fontSize: 14 },
  addBtn: { marginLeft: 'auto', border: '1px solid #9a7209', color: '#9a7209', background: '#fff', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontWeight: 600 },
  note: { fontSize: 12, color: '#777', fontStyle: 'italic' },
  subtle: { fontSize: 11, color: '#8a8472', marginTop: 2, marginBottom: 4 },
  q1row: { display: 'flex', alignItems: 'center', padding: '6px 4px', borderTop: '1px solid #eee7d8' },
  q1title: { fontWeight: 700 },
  q1total: { marginLeft: 'auto', fontWeight: 700 },
  qcard: { border: '1px solid #ece6d8', borderRadius: 6, padding: 8, marginTop: 8, background: '#fff' },
  qrow: { display: 'flex', alignItems: 'center', gap: 8 },
  titleInput: { flex: '0 0 220px', border: '1px solid #d8d2c4', borderRadius: 4, padding: '4px 6px' },
  qtotal: { marginLeft: 'auto', fontWeight: 700 },
  linkBtn: { border: 'none', background: 'none', color: '#9a7209', cursor: 'pointer', fontWeight: 600 },
  xBtn: { border: 'none', background: 'none', color: '#b3261e', cursor: 'pointer', fontSize: 16, lineHeight: 1 },
  editor: { marginTop: 10, paddingTop: 8, borderTop: '1px dashed #e3ded3' },
}
