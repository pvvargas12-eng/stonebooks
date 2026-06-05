// =============================================================================
// Quote Hub — owner approval desk, a SECTION HUB inside the Jobs tab.
// Queue-left + review-desk-right (same shape as the Design Hub). The owner
// reviews each order sent for final approval, ADJUSTS line items live (reusing
// the order editor's pricing engine — computeFormLineItems / computeTotals /
// pricing.lineItemOverrides / customLineItems), and moves it Approved / Needs
// Changes / Sent to Customer. Edits persist via saveOrder and FAIL LOUD.
//
// Quote-Hub-only aesthetic this pass: warm cream, gold #9a7209, Fraunces serif
// titles, status pills. Self-contained CSS so no other tab is restyled.
// =============================================================================

import { useState, useMemo, useEffect } from 'react'
import {
  getOrderById, setOrderQuoteStatus, rowGrandTotal, customerName, fmtUSD,
  fmtRelative, QUOTE_STATUS_LABEL, QUOTE_STATUS_TONE, NJ_TAX_RATE,
} from './lib/stonebooksData'
import { rowToOrder, saveOrder } from './SalesMode'
import { computeFormLineItems, computeTotals } from './lib/orderRates'

const FILTERS = [
  { code: 'pending_review',   label: 'Pending Owner Review' },
  { code: 'approved',         label: 'Approved' },
  { code: 'needs_changes',    label: 'Needs Changes' },
  { code: 'sent_to_customer', label: 'Sent to Customer' },
  { code: 'all',              label: 'All' },
]
// Status-flow stepper. needs_changes branches back to the order (rendered apart).
const STEPS = ['Draft Order', 'Sent to Quote Hub', 'Pending Owner Review', 'Quote Approved', 'Quote Sent to Customer']
const STATUS_STEP = { draft: 0, pending_review: 2, approved: 3, sent_to_customer: 4 }

const uid = () => (crypto?.randomUUID?.() || `q-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`)

function QuotePill({ status }) {
  const s = status || 'draft'
  return <span className="qh-pill" style={{ color: QUOTE_STATUS_TONE[s], borderColor: QUOTE_STATUS_TONE[s], background: `${QUOTE_STATUS_TONE[s]}14` }}>{QUOTE_STATUS_LABEL[s]}</span>
}

export default function QuoteHub({ orders, jobs, onReload, onEditOrder }) {
  const [filter, setFilter] = useState('pending_review')
  const [selectedId, setSelectedId] = useState(null)

  const jobByOrder = useMemo(() => {
    const m = new Map()
    for (const j of (jobs || [])) if (j.order_id && !m.has(j.order_id)) m.set(j.order_id, j)
    return m
  }, [jobs])

  const counts = useMemo(() => {
    const c = { pending_review: 0, approved: 0, needs_changes: 0, sent_to_customer: 0, all: 0 }
    for (const o of (orders || [])) {
      const s = o.quote_status || 'draft'
      if (s === 'draft') continue
      c.all += 1
      if (c[s] != null) c[s] += 1
    }
    return c
  }, [orders])

  const queue = useMemo(() => {
    const list = (orders || []).filter(o => {
      const s = o.quote_status || 'draft'
      if (filter === 'all') return s !== 'draft'
      return s === filter
    })
    // Longest-waiting first (oldest updated_at).
    return [...list].sort((a, b) => new Date(a.updated_at || 0).getTime() - new Date(b.updated_at || 0).getTime())
  }, [orders, filter])

  const selectedRow = useMemo(() => (orders || []).find(o => o.id === selectedId) || null, [orders, selectedId])

  const openCard = (o) => setSelectedId(o.id)

  return (
    <div className="qh-root">
      <style>{QH_CSS}</style>

      <div className="qh-head">
        <div>
          <div className="qh-eyebrow">Owner Approval</div>
          <h1 className="qh-title">Quote Hub</h1>
        </div>
        <div className="qh-head-count">{counts.pending_review} pending review</div>
      </div>

      <Stepper currentStatus={selectedRow?.quote_status} />

      <div className="qh-filters">
        {FILTERS.map(f => (
          <button key={f.code} type="button" className={`qh-chip ${filter === f.code ? 'on' : ''}`} onClick={() => setFilter(f.code)}>
            {f.label}{f.code !== 'all' && counts[f.code] > 0 ? ` (${counts[f.code]})` : ''}
          </button>
        ))}
      </div>

      <div className="qh-body">
        <div className="qh-queue">
          {queue.length === 0 ? (
            <div className="qh-empty">Nothing here. Orders sent from an order’s “Send to Quote Hub” button land in this queue.</div>
          ) : queue.map(o => {
            const job = jobByOrder.get(o.id)
            const total = rowGrandTotal(o)
            return (
              <button key={o.id} type="button" className={`qh-card ${selectedId === o.id ? 'sel' : ''}`} onClick={() => openCard(o)}>
                <div className="qh-card-top">
                  <span className="qh-card-name">{o.primary_lastname || customerName(o.customer) || 'Customer'}</span>
                  <QuotePill status={o.quote_status} />
                </div>
                <div className="qh-card-meta">
                  <span>{o.order_number || '—'}</span>
                  {job?.job_type && <span>{job.job_type.replace(/_/g, ' ')}</span>}
                  {o.cemetery?.name && <span>{o.cemetery.name}</span>}
                </div>
                <div className="qh-card-foot">
                  <span className="qh-card-total">{total > 0 ? fmtUSD(total) : '—'}</span>
                  <span className="qh-card-wait">waiting {fmtRelative(o.updated_at)}</span>
                </div>
              </button>
            )
          })}
        </div>

        <div className="qh-desk">
          {!selectedId ? (
            <div className="qh-desk-empty">Select a quote to review.</div>
          ) : (
            <ReviewDesk key={selectedId} orderId={selectedId} row={selectedRow} onReload={onReload} onEditOrder={onEditOrder} onClose={() => setSelectedId(null)} />
          )}
        </div>
      </div>
    </div>
  )
}

function Stepper({ currentStatus }) {
  const active = STATUS_STEP[currentStatus] ?? -1
  const needsChanges = currentStatus === 'needs_changes'
  return (
    <div className="qh-stepper">
      {STEPS.map((label, i) => (
        <div key={label} className={`qh-step ${i <= active ? 'done' : ''} ${i === active ? 'cur' : ''}`}>
          <span className="qh-step-dot">{i + 1}</span>
          <span className="qh-step-label">{label}</span>
          {i < STEPS.length - 1 && <span className="qh-step-line" />}
        </div>
      ))}
      {needsChanges && <div className="qh-step-branch">Needs Changes → back to the order</div>}
    </div>
  )
}

// ── Review desk: editable line items + totals + action bar ───────────────────
function ReviewDesk({ orderId, row, onReload, onEditOrder, onClose }) {
  const [order, setOrder] = useState(null)     // camel order (rowToOrder) for the engine
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState(null)
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    let cancelled = false
    getOrderById(orderId).then(r => { if (!cancelled) setOrder(r ? rowToOrder(r, r.customer, r.cemetery) : null) })
    return () => { cancelled = true }
  }, [orderId])

  const items = useMemo(() => (order ? computeFormLineItems(order) : []), [order])
  const totals = useMemo(() => computeTotals(items, {
    applyTax: order?.pricing?.applyTax !== false,
    applyCCSurcharge: !!order?.pricing?.applyCCSurcharge,
    discountPct: Number(order?.pricing?.discountPct) || 0,
  }), [items, order])

  // ── Edits route into the SAME pricing structure the order editor uses ──
  // Custom lines store { qty, unit }; their amount (= qty × unit) feeds the
  // engine. Derived lines are price-overridden via pricing.lineItemOverrides.
  const patchPricing = (fn) => { setDirty(true); setOrder(o => ({ ...o, pricing: fn({ ...(o.pricing || {}) }) })) }
  const customById = (id) => (order?.pricing?.customLineItems || []).find(c => c.id === id)
  const mapCustom = (id, fn) => patchPricing(p => ({ ...p, customLineItems: (p.customLineItems || []).map(c => (c.id === id ? fn(c) : c)) }))
  const recalc = (c) => ({ ...c, amount: (Math.max(1, Number(c.qty) || 1)) * (Number(c.unit) || 0) })

  // Derived line — override its computed amount (Finance-card mechanism).
  const setDerivedPrice = (item, value) => patchPricing(p => ({ ...p, lineItemOverrides: { ...(p.lineItemOverrides || {}), [item.code]: value === '' ? 0 : Number(value) } }))
  // Custom line — edit label / qty / unit price (amount recomputes).
  const setCustomLabel = (id, label) => mapCustom(id, c => ({ ...c, label }))
  const setCustomQty   = (id, qty)   => mapCustom(id, c => recalc({ ...c, qty: Math.max(1, Number(qty) || 1) }))
  const setCustomUnit  = (id, unit)  => mapCustom(id, c => recalc({ ...c, unit: unit === '' ? 0 : Number(unit) }))
  const addLine = () => patchPricing(p => ({ ...p, customLineItems: [...(p.customLineItems || []), { id: uid(), label: 'New line item', qty: 1, unit: 0, amount: 0 }] }))
  const removeLine = (item) => {
    if (item.custom) patchPricing(p => ({ ...p, customLineItems: (p.customLineItems || []).filter(c => c.id !== item.code) }))
    else patchPricing(p => ({ ...p, lineItemOverrides: { ...(p.lineItemOverrides || {}), [item.code]: 0 } }))  // zero out a derived line
  }

  // Persist edits — fail loud, never silent.
  const persist = async () => {
    if (!order) return { ok: false }
    setSaving(true); setMsg(null)
    const res = await saveOrder(order)
    setSaving(false)
    if (!res?.ok) { setMsg({ kind: 'err', text: res?.error?.message || res?.reason || 'Could not save the quote.' }); return { ok: false } }
    setDirty(false)
    return { ok: true }
  }
  const saveOnly = async () => { const r = await persist(); if (r.ok) { setMsg({ kind: 'ok', text: 'Changes saved.' }); onReload?.() } }

  const moveTo = async (status, { saveFirst = true } = {}) => {
    if (saveFirst && dirty) { const r = await persist(); if (!r.ok) return }
    setSaving(true); setMsg(null)
    const r = await setOrderQuoteStatus(orderId, status)
    setSaving(false)
    if (!r.ok) { setMsg({ kind: 'err', text: r.error }); return }
    onReload?.()
    if (status === 'needs_changes') onEditOrder?.(orderId)   // branch back to the order
    else onClose?.()
  }

  if (!order) return <div className="qh-desk-empty">Loading quote…</div>

  // Display from the RAW row (snake joins) so nothing blanks; the camel `order`
  // is only for the pricing engine + saveOrder.
  const deceasedLine = Array.isArray(row?.deceased)
    ? row.deceased.map(d => [d.firstName, d.lastName].filter(Boolean).join(' ')).filter(Boolean).join(' · ')
    : ''
  const njPct = (NJ_TAX_RATE * 100).toFixed(3).replace(/0+$/, '').replace(/\.$/, '')

  return (
    <div className="qh-review">
      <div className="qh-review-head">
        <div>
          <div className="qh-eyebrow">{row?.order_number || ''}</div>
          <h2 className="qh-review-name">{row?.primary_lastname || customerName(row?.customer) || 'Customer'}</h2>
          {deceasedLine && <div className="qh-review-mem">In memory of {deceasedLine}</div>}
          <div className="qh-review-sub">
            {row?.cemetery?.name && <span>{row.cemetery.name}</span>}
            {row?.sales_rep && <span>Built by {row.sales_rep}</span>}
            <QuotePill status={row?.quote_status} />
          </div>
        </div>
        <div className="qh-review-total">
          <div className="qh-review-total-n">{fmtUSD(totals.grandTotal)}</div>
          <div className="qh-review-total-l">Quote total</div>
        </div>
      </div>

      {/* Editable line items */}
      <div className="qh-lines">
        <div className="qh-lines-head"><span>Line item</span><span>Qty</span><span>Price</span><span /></div>
        {items.map((it) => {
          const c = it.custom ? (customById(it.code) || {}) : null
          return (
            <div key={it.code} className={`qh-line ${it.quotePending ? 'pending' : ''}`}>
              {it.custom ? (
                <input className="qh-line-label-input" value={it.label} onChange={e => setCustomLabel(it.code, e.target.value)} />
              ) : (
                <span className="qh-line-label">{it.label}</span>
              )}
              {it.custom ? (
                <input className="qh-line-qty" type="number" min="1" value={c.qty ?? 1} onChange={e => setCustomQty(it.code, e.target.value)} />
              ) : (
                <span className="qh-line-qty-static">—</span>
              )}
              <div className="qh-line-price">
                <span className="qh-line-dollar">$</span>
                {it.custom ? (
                  <input type="number" step="0.01" value={c.unit ?? c.amount ?? 0} onChange={e => setCustomUnit(it.code, e.target.value)} />
                ) : (
                  <input type="number" step="0.01" value={Number(it.amount) || 0} onChange={e => setDerivedPrice(it, e.target.value)} />
                )}
              </div>
              <button type="button" className="qh-line-x" title="Remove" onClick={() => removeLine(it)}>×</button>
            </div>
          )
        })}
        <button type="button" className="qh-add-line" onClick={addLine}>+ Add line item</button>
      </div>

      {/* Totals */}
      <div className="qh-totals">
        <div className="qh-total-row"><span>Subtotal</span><span>{fmtUSD(totals.subtotalDisc + totals.subtotalPermit)}</span></div>
        {totals.discountAmt > 0 && <div className="qh-total-row"><span>Discount</span><span>−{fmtUSD(totals.discountAmt)}</span></div>}
        <div className="qh-total-row"><span>NJ tax ({njPct}%)</span><span>{fmtUSD(totals.tax)}</span></div>
        {totals.cc > 0 && <div className="qh-total-row"><span>Card surcharge</span><span>{fmtUSD(totals.cc)}</span></div>}
        <div className="qh-total-row qh-grand"><span>Grand total</span><span>{fmtUSD(totals.grandTotal)}</span></div>
      </div>

      {msg && <div className={msg.kind === 'err' ? 'qh-msg-err' : 'qh-msg-ok'}>{msg.text}</div>}

      {/* Action bar */}
      <div className="qh-actions">
        <button type="button" className="qh-btn qh-btn-ghost" onClick={saveOnly} disabled={saving || !dirty}>{saving ? 'Saving…' : 'Save changes'}</button>
        <div className="qh-actions-right">
          <button type="button" className="qh-btn qh-btn-warn" onClick={() => moveTo('needs_changes')} disabled={saving}>Needs Changes</button>
          <button type="button" className="qh-btn qh-btn-go" onClick={() => moveTo('approved')} disabled={saving}>Approve Quote</button>
          <button type="button" className="qh-btn qh-btn-send" onClick={() => moveTo('sent_to_customer')} disabled={saving}>Send to Customer</button>
        </div>
      </div>
    </div>
  )
}

const QH_CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600&display=swap');
  .qh-title, .qh-review-name { font-family: 'Fraunces', Georgia, serif; }

  .qh-root { background: #faf7f1; min-height: 100%; padding: 22px 26px 60px; }
  .qh-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; margin-bottom: 16px; }
  .qh-eyebrow { font-size: 11px; letter-spacing: 0.16em; text-transform: uppercase; color: #b39a6a; font-weight: 700; margin-bottom: 5px; }
  .qh-title { font-size: 32px; font-weight: 600; color: #2a2118; margin: 0; letter-spacing: -0.01em; }
  .qh-head-count { font-size: 13px; color: #9a7209; font-weight: 600; padding-bottom: 6px; }

  .qh-stepper { display: flex; align-items: center; gap: 0; background: #fff; border: 1px solid #ece3d2; border-radius: 12px; padding: 14px 18px; margin-bottom: 16px; flex-wrap: wrap; }
  .qh-step { display: flex; align-items: center; gap: 8px; position: relative; padding-right: 8px; }
  .qh-step-dot { width: 24px; height: 24px; border-radius: 50%; background: #efe7d6; color: #b39a6a; font-size: 12px; font-weight: 700; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
  .qh-step.done .qh-step-dot { background: #9a7209; color: #fff; }
  .qh-step.cur .qh-step-dot { box-shadow: 0 0 0 3px #9a720933; }
  .qh-step-label { font-size: 12px; color: #8a7f6c; white-space: nowrap; }
  .qh-step.done .qh-step-label { color: #2a2118; font-weight: 600; }
  .qh-step-line { width: 28px; height: 1.5px; background: #e6dcc6; margin: 0 8px; }
  .qh-step.done .qh-step-line { background: #d8c89a; }
  .qh-step-branch { font-size: 12px; color: #b3261e; font-weight: 600; margin-left: 12px; }

  .qh-filters { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 16px; }
  .qh-chip { font: inherit; font-size: 13px; font-weight: 500; color: #6b6256; background: #fff; border: 1px solid #ece3d2; border-radius: 999px; padding: 7px 15px; cursor: pointer; }
  .qh-chip:hover { border-color: #d8c89a; }
  .qh-chip.on { background: #9a7209; border-color: #9a7209; color: #fff; font-weight: 600; }

  .qh-body { display: grid; grid-template-columns: 340px minmax(0, 1fr); gap: 20px; align-items: start; }
  @media (max-width: 900px) { .qh-body { grid-template-columns: 1fr; } }

  .qh-queue { display: flex; flex-direction: column; gap: 10px; }
  .qh-empty, .qh-desk-empty { background: #fff; border: 1px solid #ece3d2; border-radius: 12px; padding: 30px 20px; text-align: center; color: #9a8f7c; font-size: 14px; line-height: 1.6; }
  .qh-card { text-align: left; background: #fff; border: 1px solid #ece3d2; border-radius: 12px; padding: 14px; cursor: pointer; display: flex; flex-direction: column; gap: 8px; }
  .qh-card:hover { border-color: #d8c89a; }
  .qh-card.sel { border-color: #9a7209; box-shadow: 0 0 0 1px #9a7209; }
  .qh-card-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .qh-card-name { font-size: 16px; font-weight: 600; color: #2a2118; }
  .qh-card-meta { display: flex; flex-wrap: wrap; gap: 6px; font-size: 12px; color: #8a7f6c; }
  .qh-card-meta span { background: #f4eede; border-radius: 5px; padding: 2px 7px; text-transform: capitalize; }
  .qh-card-foot { display: flex; align-items: baseline; justify-content: space-between; }
  .qh-card-total { font-size: 17px; font-weight: 700; color: #9a7209; }
  .qh-card-wait { font-size: 11px; color: #a89c86; }
  .qh-pill { font-size: 10px; font-weight: 700; border: 1px solid; border-radius: 999px; padding: 2px 8px; text-transform: uppercase; letter-spacing: 0.03em; white-space: nowrap; }

  .qh-desk { position: sticky; top: 16px; }
  .qh-review { background: #fff; border: 1px solid #ece3d2; border-radius: 14px; padding: 22px 24px; }
  .qh-review-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 18px; border-bottom: 1px solid #f1ead9; padding-bottom: 16px; margin-bottom: 16px; }
  .qh-review-name { font-size: 26px; font-weight: 600; color: #2a2118; margin: 2px 0 4px; }
  .qh-review-mem { font-size: 14px; color: #6b6256; font-style: italic; margin-bottom: 8px; }
  .qh-review-sub { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; font-size: 13px; color: #8a7f6c; }
  .qh-review-total { text-align: right; flex-shrink: 0; }
  .qh-review-total-n { font-size: 26px; font-weight: 700; color: #9a7209; }
  .qh-review-total-l { font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: #b39a6a; }

  .qh-lines { border: 1px solid #f1ead9; border-radius: 10px; overflow: hidden; margin-bottom: 16px; }
  .qh-lines-head, .qh-line { display: grid; grid-template-columns: 1fr 70px 130px 34px; gap: 10px; align-items: center; padding: 9px 14px; }
  .qh-lines-head { background: #faf7f1; font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: #a89c86; font-weight: 700; }
  .qh-line { border-top: 1px solid #f4eede; }
  .qh-line.pending { background: #fdf6e8; }
  .qh-line-label { font-size: 14px; color: #2a2118; }
  .qh-line-label-input { font: inherit; font-size: 14px; padding: 6px 8px; border: 1px solid #e4dcc8; border-radius: 7px; }
  .qh-line-qty-static { color: #c3b89f; text-align: center; }
  .qh-line-qty { font: inherit; font-size: 14px; padding: 6px 8px; border: 1px solid #e4dcc8; border-radius: 7px; width: 100%; text-align: center; }
  .qh-line-price { display: flex; align-items: center; gap: 4px; border: 1px solid #e4dcc8; border-radius: 7px; padding: 0 8px; background: #fff; }
  .qh-line-dollar { color: #a89c86; font-size: 13px; }
  .qh-line-price input { font: inherit; font-size: 14px; padding: 6px 2px; border: none; outline: none; width: 100%; text-align: right; background: transparent; }
  .qh-line-x { font: inherit; font-size: 18px; line-height: 1; color: #c0a98a; background: none; border: none; cursor: pointer; }
  .qh-line-x:hover { color: #b3261e; }
  .qh-add-line { font: inherit; font-size: 13px; font-weight: 600; color: #9a7209; background: #faf7f1; border: none; border-top: 1px solid #f4eede; width: 100%; padding: 10px; cursor: pointer; }
  .qh-add-line:hover { background: #f4eede; }

  .qh-totals { margin-bottom: 16px; }
  .qh-total-row { display: flex; justify-content: space-between; font-size: 14px; color: #6b6256; padding: 5px 2px; }
  .qh-total-row.qh-grand { border-top: 1.5px solid #ece3d2; margin-top: 4px; padding-top: 10px; font-size: 18px; font-weight: 700; color: #2a2118; }

  .qh-msg-err { font-size: 13px; color: #b3261e; background: #fbeceb; border: 1px solid #f0cfca; border-radius: 8px; padding: 9px 11px; margin-bottom: 14px; }
  .qh-msg-ok { font-size: 13px; color: #2d7a4f; background: #e8f5ee; border: 1px solid #b7e0c6; border-radius: 8px; padding: 9px 11px; margin-bottom: 14px; }

  .qh-actions { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
  .qh-actions-right { display: flex; gap: 8px; flex-wrap: wrap; }
  .qh-btn { font: inherit; font-size: 14px; font-weight: 600; border-radius: 9px; padding: 10px 18px; cursor: pointer; border: 1px solid; }
  .qh-btn:disabled { opacity: 0.5; cursor: default; }
  .qh-btn-ghost { background: #fff; border-color: #e4dcc8; color: #6b6256; }
  .qh-btn-ghost:hover:not(:disabled) { background: #faf7f1; }
  .qh-btn-warn { background: #fff; border-color: #e6b8b2; color: #b3261e; }
  .qh-btn-warn:hover:not(:disabled) { background: #fbeceb; }
  .qh-btn-go { background: #2d7a4f; border-color: #2d7a4f; color: #fff; }
  .qh-btn-go:hover:not(:disabled) { background: #266b45; }
  .qh-btn-send { background: #9a7209; border-color: #9a7209; color: #fff; }
  .qh-btn-send:hover:not(:disabled) { background: #b3870c; }
`
