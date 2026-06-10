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
import { computeFormLineItems, priceOrderTotals } from '../lib/orderRates'
import { extractSpecFromOrder, applySpecToOrder } from '../lib/quoteSpec'
import { logOrderActivity, getSignedContract } from '../lib/stonebooksData'

const money = (n) =>
  `$${(Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const newId = () =>
  (globalThis.crypto?.randomUUID?.() || `q-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`)

// Price any (synthesized) order via priceOrderTotals — the SAME unified pipeline
// the wizard + estimate/contract PDF use ($ discounts, per-line taxable/
// discountable flags, pricing.overrides, and manualTotal all honored), so a
// quote's shown total can never disagree with its PDF.
function priceOrder(o) {
  return priceOrderTotals(o).displayed
}

// Manual grand-total override on an order, or null. When set, it wins over the
// computed total everywhere (PDF + quotes) — surfaced here so a stuck override is
// visible and clearable. (#8 diagnostic)
function manualOf(o) {
  const mt = o?.pricing?.manualTotal
  return (mt != null && mt !== '') ? Number(mt) : null
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
  const addQuote = () => {
    if (isLocked || isMausoleum) return
    const q = { id: newId(), title: `Quote ${quotes.length + 2}`, spec: extractSpecFromOrder(order) }
    commit([...quotes, q])
    setOpenId(q.id)
  }

  // ── Promote / delete lifecycle ──────────────────────────────────────────────
  const [confirm, setConfirm] = useState(null)  // { kind, q?, nextTitle? } | null

  const logAct = (note) => {
    if (!order.id) return
    logOrderActivity(order.id, { type: 'change', field: 'Quote', note, actor: order.salesRep || 'Staff' }).catch(() => {})
  }
  // Relabel any default-numbered ("Quote N") or empty title to its array position
  // (snapshots are positions 2+; Quote 1 is the primary). Custom names preserved.
  const renumber = (arr) => arr.map((q, i) => {
    const t = (q.title || '').trim()
    return (!t || /^Quote \d+$/.test(t)) ? { ...q, title: `Quote ${i + 2}` } : q
  })

  // Promote a snapshot to primary: snapshot the current primary (preserved, never
  // destroyed), apply the promoted spec onto the order's primary columns, drop the
  // promoted entry from the array. Totals everywhere then derive from the new
  // primary via priceOrderTotals.
  const doPromote = (q) => {
    const demoted = { id: newId(), title: order.quoteTitle || 'Quote 1', spec: extractSpecFromOrder(order) }
    const applied = applySpecToOrder(order, q.spec)
    const nextQuotes = renumber([demoted, ...quotes.filter((x) => x.id !== q.id)])
    quotesRef.current = nextQuotes
    update({ ...applied, quoteTitle: q.title || 'Quote 1', quotes: nextQuotes })
    setConfirm(null); setOpenId(null)
    logAct(`${q.title || 'Quote'} promoted to primary`)
  }

  const doDeleteSnapshot = (q) => {
    const nextQuotes = renumber(quotes.filter((x) => x.id !== q.id))
    quotesRef.current = nextQuotes
    update({ quotes: nextQuotes })
    setConfirm(null)
    logAct(`${q.title || 'Quote'} deleted`)
  }

  // Delete the primary: auto-promote the first snapshot into the primary slot (the
  // deleted primary is NOT preserved). Blocked when no snapshots exist (the row
  // isn't rendered then, so an order always keeps at least one quote).
  const doDeletePrimary = () => {
    if (quotes.length === 0) { setConfirm(null); return }
    const next = quotes[0]
    const applied = applySpecToOrder(order, next.spec)
    const rest = renumber(quotes.slice(1))
    const deletedLabel = order.quoteTitle || 'Quote 1'
    quotesRef.current = rest
    update({ ...applied, quoteTitle: next.title || 'Quote 1', quotes: rest })
    setConfirm(null)
    logAct(`${deletedLabel} deleted`)
  }

  // Promote freely when unsigned; warn loudly when a signed contract is pinned
  // (or the order is e-signed) — promoting changes working numbers but never the
  // signed contract.
  const requestPromote = async (q) => {
    if (isMausoleum) return
    let signed = !!order.signedAt
    if (!signed && order.id) { try { signed = !!(await getSignedContract(order.id)) } catch { /* bucket pending */ } }
    if (signed) { setConfirm({ kind: 'promote', q }); return }
    doPromote(q)
  }
  const requestDeleteSnapshot = (q) => setConfirm({ kind: 'delete-snapshot', q })
  const requestDeletePrimary = () => setConfirm({ kind: 'delete-primary', nextTitle: quotes[0]?.title || 'Quote 2' })

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
            <input
              style={S.titleInput}
              value={order.quoteTitle || ''}
              disabled={isLocked}
              placeholder="Quote 1"
              onChange={(e) => update({ quoteTitle: e.target.value })}
            />
            {manualOf(order) != null && (
              <span style={S.manualTag} title="Manual override — overrides the calculated total">
                manual override
                {!isLocked && (
                  <button type="button" style={S.manualClear} title="Clear manual override"
                    onClick={() => update({ pricing: { ...(order.pricing || {}), manualTotal: null } })}>×</button>
                )}
              </span>
            )}
            <span style={S.q1total}>{money(priceOrder(order))}</span>
            <span style={S.primaryBadge}>PRIMARY</span>
            {!isMausoleum && (
              <button type="button" style={S.xBtn} title="Delete this quote (promotes the next quote to primary)" onClick={requestDeletePrimary}>×</button>
            )}
          </div>
          <div style={S.subtle}>Quote 1 is this order’s current configuration (edited on the form above). It drives the contract, pricing, and balance.</div>
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
              {manualOf(synth) != null && (
                <span style={S.manualTag} title="Manual override — overrides the calculated total">
                  manual override
                  {!isLocked && (
                    <button type="button" style={S.manualClear} title="Clear manual override"
                      onClick={() => adUpdatePricing({ manualTotal: null })}>×</button>
                  )}
                </span>
              )}
              <span style={S.qtotal}>{money(priceOrder(synth))}</span>
              {!isMausoleum && (
                <button type="button" style={S.promoteBtn} title="Make this the primary quote (drives the contract & pricing)" onClick={() => requestPromote(q)}>
                  Use this quote
                </button>
              )}
              <button type="button" style={S.linkBtn} onClick={() => setOpenId(isOpen ? null : q.id)}>
                {isOpen ? 'Close' : 'Edit'}
              </button>
              <button type="button" style={S.xBtn} title="Delete this quote" onClick={() => requestDeleteSnapshot(q)}>×</button>
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

      {confirm && (
        <div style={S.overlay} onClick={() => setConfirm(null)}>
          <div style={S.modal} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            {confirm.kind === 'promote' && (
              <>
                <div style={S.modalTitle}>Promote this quote?</div>
                <p style={S.modalBody}>
                  This order has a <strong>signed contract</strong> based on the current primary. Promoting{' '}
                  <strong>{confirm.q.title || 'this quote'}</strong> changes the working numbers (pricing, balance, the draft contract) but does <strong>NOT</strong> touch the signed contract — the signed pin stays in place.
                </p>
                <div style={S.modalActions}>
                  <button type="button" style={S.btn} onClick={() => setConfirm(null)}>Cancel</button>
                  <button type="button" style={S.btnPrimary} onClick={() => doPromote(confirm.q)}>Promote anyway</button>
                </div>
              </>
            )}
            {confirm.kind === 'delete-snapshot' && (
              <>
                <div style={S.modalTitle}>Delete {confirm.q.title || 'this quote'}?</div>
                <p style={S.modalBody}>This quote will be removed from the order. This can’t be undone.</p>
                <div style={S.modalActions}>
                  <button type="button" style={S.btn} onClick={() => setConfirm(null)}>Cancel</button>
                  <button type="button" style={S.btnDanger} onClick={() => doDeleteSnapshot(confirm.q)}>Delete</button>
                </div>
              </>
            )}
            {confirm.kind === 'delete-primary' && (
              <>
                <div style={S.modalTitle}>Delete the primary quote?</div>
                <p style={S.modalBody}>
                  <strong>{order.quoteTitle || 'Quote 1'}</strong> is the current primary. Deleting it promotes{' '}
                  <strong>{confirm.nextTitle}</strong> to become the new primary (the deleted quote is not kept). This can’t be undone.
                </p>
                <div style={S.modalActions}>
                  <button type="button" style={S.btn} onClick={() => setConfirm(null)}>Cancel</button>
                  <button type="button" style={S.btnDanger} onClick={doDeletePrimary}>Delete &amp; promote next</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
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
  manualTag: { display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: '#7a4a12', background: '#fdf2e9', border: '1px solid #e0a85f', borderRadius: 4, padding: '2px 6px' },
  manualClear: { border: 'none', background: 'none', color: '#b3261e', cursor: 'pointer', fontSize: 13, lineHeight: 1, padding: 0 },
  linkBtn: { border: 'none', background: 'none', color: '#9a7209', cursor: 'pointer', fontWeight: 600 },
  xBtn: { border: 'none', background: 'none', color: '#b3261e', cursor: 'pointer', fontSize: 16, lineHeight: 1 },
  editor: { marginTop: 10, paddingTop: 8, borderTop: '1px dashed #e3ded3' },
  promoteBtn: { border: '1px solid #2e7d3a', color: '#2e7d3a', background: '#fff', borderRadius: 6, padding: '3px 9px', cursor: 'pointer', fontWeight: 600, fontSize: 12, whiteSpace: 'nowrap' },
  primaryBadge: { marginLeft: 8, fontSize: 9.5, fontWeight: 700, letterSpacing: '0.05em', color: '#fff', background: '#2e7d3a', borderRadius: 4, padding: '1px 5px' },
  overlay: { position: 'fixed', inset: 0, background: 'rgba(15,20,25,0.5)', zIndex: 9000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 },
  modal: { background: '#fff', borderRadius: 10, width: 'min(460px, 94vw)', padding: 20, boxShadow: '0 20px 60px rgba(0,0,0,0.35)' },
  modalTitle: { fontWeight: 700, fontSize: 16, marginBottom: 8 },
  modalBody: { fontSize: 13.5, color: '#444', lineHeight: 1.5, margin: '0 0 16px' },
  modalActions: { display: 'flex', justifyContent: 'flex-end', gap: 10 },
  btn: { border: '1px solid #d8d2c4', background: '#fff', borderRadius: 6, padding: '7px 14px', cursor: 'pointer', fontWeight: 600 },
  btnPrimary: { border: '1px solid #9a7209', background: '#9a7209', color: '#fff', borderRadius: 6, padding: '7px 14px', cursor: 'pointer', fontWeight: 600 },
  btnDanger: { border: '1px solid #b3261e', background: '#b3261e', color: '#fff', borderRadius: 6, padding: '7px 14px', cursor: 'pointer', fontWeight: 600 },
}
