// =============================================================================
// Quote Hub — owner approval desk, a SECTION HUB inside the Jobs tab.
// Queue-left + review-desk-right. Reviews family orders AND cemetery (crypt /
// mausoleum door) orders. The owner adjusts line items live (orders, reusing the
// order editor's pricing engine), leaves internal notes, approves, and sends a
// customer-facing quote. Every action is fail-loud and appends to quote_events.
//
// Quote-Hub-only aesthetic: warm cream, gold #9a7209, Fraunces serif, pills.
// =============================================================================

import { useState, useMemo, useEffect } from 'react'
import {
  getOrderById, getCemeteryOrders, getCemeteryOrder, getCemeteryPricingForOrder, getDoorPrice,
  updateCemeteryOrder,
  setOrderQuoteStatus, setCemeteryOrderQuoteStatus, appendQuoteEvent, getCurrentStaffName,
  rowGrandTotal, customerName, fmtUSD, fmtDate, fmtRelative, sendOrderEmail,
  QUOTE_STATUS_LABEL, QUOTE_STATUS_TONE, NJ_TAX_RATE, CC_SURCHARGE,
} from './lib/stonebooksData'
import { rowToOrder, saveOrder, generateEstimatePDF } from './SalesMode'
import { computeFormLineItems, computeTotals } from './lib/orderRates'

const FILTERS = [
  { code: 'pending_review',   label: 'Pending Owner Review' },
  { code: 'approved',         label: 'Approved' },
  { code: 'needs_changes',    label: 'Needs Changes' },
  { code: 'sent_to_customer', label: 'Sent to Customer' },
  { code: 'all',              label: 'All' },
]
const STEPS = ['Draft Order', 'Sent to Quote Hub', 'Pending Owner Review', 'Quote Approved', 'Quote Sent to Customer']
const STATUS_STEP = { draft: 0, pending_review: 2, approved: 3, sent_to_customer: 4 }
const EVENT_LABEL = { sent: 'Sent to Quote Hub', approved: 'Approved', changes_requested: 'Changes requested', sent_to_customer: 'Sent to customer', note: 'Note' }

const uid = () => (crypto?.randomUUID?.() || `q-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`)

function QuotePill({ status }) {
  const s = status || 'draft'
  return <span className="qh-pill" style={{ color: QUOTE_STATUS_TONE[s], borderColor: QUOTE_STATUS_TONE[s], background: `${QUOTE_STATUS_TONE[s]}14` }}>{QUOTE_STATUS_LABEL[s]}</span>
}

const totalOf = (o) => (o._kind === 'cemetery' ? Number(o.total_amount || 0) : rowGrandTotal(o))
const nameOf = (o) => (o._kind === 'cemetery' ? (o.cemetery_name || 'Cemetery order') : (o.primary_lastname || customerName(o.customer) || 'Customer'))

export default function QuoteHub({ orders, jobs, onReload, onEditOrder }) {
  const [filter, setFilter] = useState('pending_review')
  const [selected, setSelected] = useState(null)     // { id, _kind }
  const [cemOrders, setCemOrders] = useState([])

  // Cemetery orders aren't loaded by JobsDepartmentView — fetch them here.
  useEffect(() => {
    let cancelled = false
    getCemeteryOrders().then(list => {
      if (cancelled) return
      setCemOrders((list || []).map(o => ({ ...o, _kind: 'cemetery' })))
    }).catch(() => {})
  }, [onReload])

  const all = useMemo(() => {
    const ords = (orders || []).map(o => ({ ...o, _kind: 'order' }))
    return [...ords, ...cemOrders]
  }, [orders, cemOrders])

  const jobByOrder = useMemo(() => {
    const m = new Map()
    for (const j of (jobs || [])) if (j.order_id && !m.has(j.order_id)) m.set(j.order_id, j)
    return m
  }, [jobs])

  const counts = useMemo(() => {
    const c = { pending_review: 0, approved: 0, needs_changes: 0, sent_to_customer: 0, all: 0 }
    for (const o of all) {
      const s = o.quote_status || 'draft'
      if (s === 'draft') continue
      c.all += 1
      if (c[s] != null) c[s] += 1
    }
    return c
  }, [all])

  const queue = useMemo(() => {
    const list = all.filter(o => {
      const s = o.quote_status || 'draft'
      return filter === 'all' ? s !== 'draft' : s === filter
    })
    return [...list].sort((a, b) => new Date(a.updated_at || 0).getTime() - new Date(b.updated_at || 0).getTime())
  }, [all, filter])

  const selectedRow = useMemo(() => (selected ? all.find(o => o.id === selected.id && o._kind === selected._kind) || null : null), [all, selected])

  const reloadAll = () => { onReload?.(); getCemeteryOrders().then(list => setCemOrders((list || []).map(o => ({ ...o, _kind: 'cemetery' })))).catch(() => {}) }

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
            const job = o._kind === 'order' ? jobByOrder.get(o.id) : null
            const isSel = selected?.id === o.id && selected?._kind === o._kind
            return (
              <button key={`${o._kind}-${o.id}`} type="button" className={`qh-card ${isSel ? 'sel' : ''}`} onClick={() => setSelected({ id: o.id, _kind: o._kind })}>
                <div className="qh-card-top">
                  <span className="qh-card-name">{nameOf(o)}</span>
                  <QuotePill status={o.quote_status} />
                </div>
                <div className="qh-card-meta">
                  <span>{o.order_number || '—'}</span>
                  <span>{o._kind === 'cemetery' ? 'mausoleum door' : (job?.job_type ? job.job_type.replace(/_/g, ' ') : 'order')}</span>
                  {o._kind === 'order' && o.cemetery?.name && <span>{o.cemetery.name}</span>}
                </div>
                <div className="qh-card-foot">
                  <span className="qh-card-total">{totalOf(o) > 0 ? fmtUSD(totalOf(o)) : '—'}</span>
                  <span className="qh-card-wait">waiting {fmtRelative(o.updated_at)}</span>
                </div>
              </button>
            )
          })}
        </div>

        <div className="qh-desk">
          {!selectedRow ? (
            <div className="qh-desk-empty">Select a quote to review.</div>
          ) : selectedRow._kind === 'cemetery' ? (
            <CemeteryReviewDesk key={`c-${selectedRow.id}`} row={selectedRow} onReload={reloadAll} onClose={() => setSelected(null)} />
          ) : (
            <ReviewDesk key={`o-${selectedRow.id}`} row={selectedRow} onReload={reloadAll} onEditOrder={onEditOrder} onClose={() => setSelected(null)} />
          )}
        </div>
      </div>
    </div>
  )
}

function Stepper({ currentStatus }) {
  const active = STATUS_STEP[currentStatus] ?? -1
  return (
    <div className="qh-stepper">
      {STEPS.map((label, i) => (
        <div key={label} className={`qh-step ${i <= active ? 'done' : ''} ${i === active ? 'cur' : ''}`}>
          <span className="qh-step-dot">{i + 1}</span>
          <span className="qh-step-label">{label}</span>
          {i < STEPS.length - 1 && <span className="qh-step-line" />}
        </div>
      ))}
      {currentStatus === 'needs_changes' && <div className="qh-step-branch">Needs Changes → back to the order</div>}
    </div>
  )
}

// ── Shared Layer-2 pieces ────────────────────────────────────────────────────
function ApprovedStamp({ events }) {
  const last = [...(events || [])].reverse().find(e => e.type === 'approved')
  if (!last) return null
  return <div className="qh-stamp">Approved by {last.by || 'staff'} on {fmtDate(last.at)}</div>
}

function QuoteTimeline({ events }) {
  if (!events || events.length === 0) return <div className="qh-dim">No history yet.</div>
  return (
    <div className="qh-timeline">
      {[...events].reverse().map((e, i) => (
        <div key={i} className="qh-tl-row">
          <span className="qh-tl-dot" />
          <div>
            <div className="qh-tl-label">{EVENT_LABEL[e.type] || e.type}{e.text ? <span className="qh-tl-text">: {e.text}</span> : null}</div>
            <div className="qh-tl-meta">{e.by || 'System'} · {fmtDate(e.at)}</div>
          </div>
        </div>
      ))}
    </div>
  )
}

function NotesAndHistory({ events, onAddNote }) {
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const add = async () => {
    if (!note.trim()) return
    setBusy(true); setErr(null)
    const r = await onAddNote(note.trim())
    setBusy(false)
    if (!r?.ok) { setErr(r?.error || 'Could not save the note.'); return }
    setNote('')
  }
  return (
    <div className="qh-l2">
      <div className="qh-l2-h">Internal notes &amp; history</div>
      <div className="qh-note-row">
        <textarea className="qh-note-input" rows={2} value={note} onChange={e => setNote(e.target.value)} placeholder="Add an internal note (owner / staff only)…" />
        <button type="button" className="qh-btn qh-btn-ghost" onClick={add} disabled={busy || !note.trim()}>{busy ? 'Saving…' : 'Add note'}</button>
      </div>
      {err && <div className="qh-msg-err">{err}</div>}
      <QuoteTimeline events={events} />
    </div>
  )
}

// Shared action helpers ------------------------------------------------------
async function moveStatus({ table, id, status, eventType, setEvents, setMsg, onReload }) {
  const sr = await (table === 'orders' ? setOrderQuoteStatus(id, status) : setCemeteryOrderQuoteStatus(id, status))
  if (!sr.ok) { setMsg({ kind: 'err', text: sr.error }); return { ok: false } }
  const by = await getCurrentStaffName().catch(() => null)
  const er = await appendQuoteEvent(table, id, { type: eventType, by })
  if (er.ok) setEvents(ev => [...ev, er.event])
  onReload?.()
  return { ok: true }
}

// ── ORDER review desk (editable line items + Layer 2) ────────────────────────
function ReviewDesk({ row, onReload, onEditOrder, onClose }) {
  const [order, setOrder] = useState(null)
  const [events, setEvents] = useState(() => Array.isArray(row?.quote_events) ? row.quote_events : [])
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState(null)
  const [dirty, setDirty] = useState(false)
  const orderId = row.id

  useEffect(() => {
    let cancelled = false
    getOrderById(orderId).then(r => { if (!cancelled) setOrder(r ? rowToOrder(r, r.customer, r.cemetery) : null) })
    return () => { cancelled = true }
  }, [orderId])

  const items = useMemo(() => (order ? computeFormLineItems(order) : []), [order])
  const totals = useMemo(() => computeTotals(items, {
    applyTax: order?.pricing?.applyTax !== false,
    applyCCSurcharge: !!order?.pricing?.applyCCSurcharge,
    discountType: order?.pricing?.discountType,
    discountValue: order?.pricing?.discountValue,
    discountPct: Number(order?.pricing?.discountPct) || 0,
  }), [items, order])

  const patchPricing = (fn) => { setDirty(true); setOrder(o => ({ ...o, pricing: fn({ ...(o.pricing || {}) }) })) }
  const customById = (id) => (order?.pricing?.customLineItems || []).find(c => c.id === id)
  const mapCustom = (id, fn) => patchPricing(p => ({ ...p, customLineItems: (p.customLineItems || []).map(c => (c.id === id ? fn(c) : c)) }))
  const recalc = (c) => ({ ...c, amount: (Math.max(1, Number(c.qty) || 1)) * (Number(c.unit) || 0) })
  const setDerivedPrice = (item, value) => patchPricing(p => ({ ...p, lineItemOverrides: { ...(p.lineItemOverrides || {}), [item.code]: value === '' ? 0 : Number(value) } }))
  const setCustomLabel = (id, label) => mapCustom(id, c => ({ ...c, label }))
  const setCustomQty = (id, qty) => mapCustom(id, c => recalc({ ...c, qty: Math.max(1, Number(qty) || 1) }))
  const setCustomUnit = (id, unit) => mapCustom(id, c => recalc({ ...c, unit: unit === '' ? 0 : Number(unit) }))
  const addLine = () => patchPricing(p => ({ ...p, customLineItems: [...(p.customLineItems || []), { id: uid(), label: 'New line item', qty: 1, unit: 0, amount: 0 }] }))
  const removeLine = (item) => {
    if (item.custom) patchPricing(p => ({ ...p, customLineItems: (p.customLineItems || []).filter(c => c.id !== item.code) }))
    else patchPricing(p => ({ ...p, lineItemOverrides: { ...(p.lineItemOverrides || {}), [item.code]: 0 } }))
  }

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
  const addNote = async (text) => {
    const by = await getCurrentStaffName().catch(() => null)
    const r = await appendQuoteEvent('orders', orderId, { type: 'note', by, text })
    if (r.ok) setEvents(ev => [...ev, r.event])
    return r
  }
  const moveTo = async (status, eventType, { saveFirst = true } = {}) => {
    if (saveFirst && dirty) { const r = await persist(); if (!r.ok) return }
    setSaving(true); setMsg(null)
    const r = await moveStatus({ table: 'orders', id: orderId, status, eventType, setEvents, setMsg, onReload })
    setSaving(false)
    if (!r.ok) return
    if (status === 'needs_changes') onEditOrder?.(orderId)
    else onClose?.()
  }

  const previewQuote = async () => {
    setMsg(null)
    try { await generateEstimatePDF(order, { mode: 'estimate' }) }
    catch (e) { setMsg({ kind: 'err', text: `Could not generate the quote PDF — ${e?.message || 'error'}.` }) }
  }

  const sendToCustomer = async () => {
    if (dirty) { const r = await persist(); if (!r.ok) return }
    const to = row.customer?.email
    if (!to) { setMsg({ kind: 'err', text: 'No customer email on file — add one on the order, then send.' }); return }
    setSaving(true); setMsg(null)
    const body = `Hello,\n\nPlease find your quote from Shevchenko Monuments below.\n\nFamily: ${nameOf(row)}\nQuote total: ${fmtUSD(totals.grandTotal)}\n\nWe'll follow up with the full quote document. Thank you.\n— Shevchenko Monuments`
    const er = await sendOrderEmail({ orderId, to, subject: `Your quote from Shevchenko Monuments — ${fmtUSD(totals.grandTotal)}`, body })
    if (!er.ok) {
      setSaving(false)
      setMsg({ kind: 'err', text: `Email not sent (${er.error}). Connect Gmail in Settings, or use Preview quote to export the PDF and send it manually.` })
      return
    }
    await moveStatus({ table: 'orders', id: orderId, status: 'sent_to_customer', eventType: 'sent_to_customer', setEvents, setMsg, onReload })
    setSaving(false)
    setMsg({ kind: 'ok', text: `Quote emailed to ${to}.` })
  }

  if (!order) return <div className="qh-desk-empty">Loading quote…</div>

  const deceasedLine = Array.isArray(row?.deceased)
    ? row.deceased.map(d => [d.firstName, d.lastName].filter(Boolean).join(' ')).filter(Boolean).join(' · ') : ''
  const njPct = (NJ_TAX_RATE * 100).toFixed(3).replace(/0+$/, '').replace(/\.$/, '')

  return (
    <div className="qh-review">
      <ReviewHeader row={row} deceasedLine={deceasedLine} total={totals.grandTotal} />
      <ApprovedStamp events={events} />

      <div className="qh-lines">
        <div className="qh-lines-head"><span>Line item</span><span>Qty</span><span>Price</span><span /></div>
        {items.map((it) => {
          const c = it.custom ? (customById(it.code) || {}) : null
          return (
            <div key={it.code} className={`qh-line ${it.quotePending ? 'pending' : ''}`}>
              {it.custom
                ? <input className="qh-line-label-input" value={it.label} onChange={e => setCustomLabel(it.code, e.target.value)} />
                : <span className="qh-line-label">{it.label}</span>}
              {it.custom
                ? <input className="qh-line-qty" type="number" min="1" value={c.qty ?? 1} onChange={e => setCustomQty(it.code, e.target.value)} />
                : <span className="qh-line-qty-static">—</span>}
              <div className="qh-line-price">
                <span className="qh-line-dollar">$</span>
                {it.custom
                  ? <input type="number" step="0.01" value={c.unit ?? c.amount ?? 0} onChange={e => setCustomUnit(it.code, e.target.value)} />
                  : <input type="number" step="0.01" value={Number(it.amount) || 0} onChange={e => setDerivedPrice(it, e.target.value)} />}
              </div>
              <button type="button" className="qh-line-x" title="Remove" onClick={() => removeLine(it)}>×</button>
            </div>
          )
        })}
        <button type="button" className="qh-add-line" onClick={addLine}>+ Add line item</button>
      </div>

      <Totals totals={totals} njPct={njPct} />
      {msg && <div className={msg.kind === 'err' ? 'qh-msg-err' : 'qh-msg-ok'}>{msg.text}</div>}

      <div className="qh-actions">
        <div className="qh-actions-left">
          <button type="button" className="qh-btn qh-btn-ghost" onClick={saveOnly} disabled={saving || !dirty}>{saving ? 'Saving…' : 'Save changes'}</button>
          <button type="button" className="qh-btn qh-btn-ghost" onClick={previewQuote} disabled={saving}>Preview quote PDF</button>
        </div>
        <div className="qh-actions-right">
          <button type="button" className="qh-btn qh-btn-warn" onClick={() => moveTo('needs_changes', 'changes_requested')} disabled={saving}>Needs Changes</button>
          <button type="button" className="qh-btn qh-btn-go" onClick={() => moveTo('approved', 'approved')} disabled={saving}>Approve Quote</button>
          <button type="button" className="qh-btn qh-btn-send" onClick={sendToCustomer} disabled={saving}>Send to Customer</button>
        </div>
      </div>

      <NotesAndHistory events={events} onAddNote={addNote} />
    </div>
  )
}

// ── CEMETERY (crypt / mausoleum door) review desk — EDITABLE, same as orders ──
function CemeteryReviewDesk({ row, onReload, onClose }) {
  const [order, setOrder] = useState(null)
  const [events, setEvents] = useState(() => Array.isArray(row?.quote_events) ? row.quote_events : [])
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [msg, setMsg] = useState(null)
  const id = row.id

  useEffect(() => {
    let cancelled = false
    getCemeteryOrder(id).then(o => { if (!cancelled) setOrder(o) })
    return () => { cancelled = true }
  }, [id])

  const pricing = useMemo(() => (order ? getCemeteryPricingForOrder(order) : null), [order])
  // Reuse the wizard's exact door-pricing helpers (price_override mechanism).
  const keyOf = (s) => (typeof s === 'string' ? s : s?.key)
  const itemMapFor = (d) => (pricing?.type === 'indoor_outdoor_split' ? (d.location ? (pricing[d.location] || {}) : {}) : (pricing?.items || {}))
  const defaultPrice = (d, k) => Number(itemMapFor(d)?.[k]?.price) || 0
  const overrideOf = (d, k) => { const s = (d.selectedItems || []).find(x => keyOf(x) === k); return (s && typeof s === 'object' && s.price_override != null) ? Number(s.price_override) : null }
  const effPrice = (d, k) => { const o = overrideOf(d, k); return o != null ? o : defaultPrice(d, k) }

  const doors = order?.doors || []
  const subtotal = useMemo(() => (order?.doors || []).reduce((s, d) => s + (pricing ? getDoorPrice(d, pricing) : 0), 0), [order, pricing])
  const taxAmt = order?.tax_applied ? subtotal * NJ_TAX_RATE : 0
  const ccAmt = order?.cc_fee_applied ? subtotal * CC_SURCHARGE : 0
  const total = subtotal + taxAmt + ccAmt

  const setDoors = (fn) => { setDirty(true); setOrder(o => ({ ...o, doors: fn(o.doors || []) })) }
  const setToggle = (field, val) => { setDirty(true); setOrder(o => ({ ...o, [field]: val })) }
  // Edit an item's price via the same { key, price_override } shape the wizard
  // writes; clearing reverts to the cemetery's default price.
  const setItemPrice = (di, key, val) => setDoors(ds => ds.map((d, idx) => {
    if (idx !== di) return d
    const num = val === '' ? null : Number(val)
    return { ...d, selectedItems: (d.selectedItems || []).map(s => (keyOf(s) === key ? (num == null ? { key } : { key, price_override: num }) : s)) }
  }))
  const setCustomPrice = (di, li, val) => setDoors(ds => ds.map((d, idx) => {
    if (idx !== di) return d
    return { ...d, customLineItems: (d.customLineItems || []).map((c, j) => (j === li ? { ...c, price: val === '' ? 0 : Number(val) } : c)) }
  }))

  // Persist to the cemetery_order — fail-loud (updateCemeteryOrder .select()s).
  const persist = async () => {
    setSaving(true); setMsg(null)
    const r = await updateCemeteryOrder(id, {
      doors: order.doors,
      total_amount: Math.round(total * 100) / 100,
      tax_applied: !!order.tax_applied,
      cc_fee_applied: !!order.cc_fee_applied,
    })
    setSaving(false)
    if (!r.ok) { setMsg({ kind: 'err', text: r.error }); return { ok: false } }
    setDirty(false)
    return { ok: true }
  }
  const saveOnly = async () => { const r = await persist(); if (r.ok) { setMsg({ kind: 'ok', text: 'Changes saved.' }); onReload?.() } }
  const addNote = async (text) => {
    const by = await getCurrentStaffName().catch(() => null)
    const r = await appendQuoteEvent('cemetery_orders', id, { type: 'note', by, text })
    if (r.ok) setEvents(ev => [...ev, r.event])
    return r
  }
  const moveTo = async (status, eventType) => {
    if (dirty) { const r = await persist(); if (!r.ok) return }
    setSaving(true); setMsg(null)
    const r = await moveStatus({ table: 'cemetery_orders', id, status, eventType, setEvents, setMsg, onReload })
    setSaving(false)
    if (r.ok && status !== 'needs_changes') onClose?.()
  }

  if (!order) return <div className="qh-desk-empty">Loading cemetery order…</div>

  return (
    <div className="qh-review">
      <ReviewHeader row={row} deceasedLine="" total={total} />
      <ApprovedStamp events={events} />

      <div className="qh-lines">
        <div className="qh-lines-head"><span>Door / item</span><span>Location</span><span>Price</span><span /></div>
        {doors.length === 0 ? <div className="qh-line"><span className="qh-line-label qh-dim">No doors on this order.</span></div>
          : doors.map((d, di) => {
            const sel = d.selectedItems || []
            const cust = d.customLineItems || []
            const lines = sel.length
              ? sel.map(s => ({ kind: 'sel', key: keyOf(s) }))
              : cust.map((c, j) => ({ kind: 'custom', j, label: c.label, price: c.price }))
            if (lines.length === 0) return (
              <div key={di} className="qh-line">
                <span className="qh-line-label">Door {di + 1}</span>
                <span className="qh-line-qty-static" style={{ textAlign: 'left', textTransform: 'capitalize' }}>{d.location || '—'}</span>
                <span className="qh-line-price-static">—</span><span />
              </div>
            )
            return lines.map((ln, li) => (
              <div key={`${di}-${li}`} className="qh-line">
                <span className="qh-line-label">Door {di + 1}{ln.kind === 'sel' ? ` — ${String(ln.key).replace(/_/g, ' ')}` : (ln.label ? ` — ${ln.label}` : '')}</span>
                <span className="qh-line-qty-static" style={{ textAlign: 'left', textTransform: 'capitalize' }}>{d.location || '—'}</span>
                <div className="qh-line-price">
                  <span className="qh-line-dollar">$</span>
                  {ln.kind === 'sel'
                    ? <input type="number" step="0.01" value={effPrice(d, ln.key)} onChange={e => setItemPrice(di, ln.key, e.target.value)} />
                    : <input type="number" step="0.01" value={Number(ln.price) || 0} onChange={e => setCustomPrice(di, ln.j, e.target.value)} />}
                </div>
                <span />
              </div>
            ))
          })}
      </div>

      <div className="qh-totals">
        <div className="qh-total-row"><span>Subtotal</span><span>{fmtUSD(subtotal)}</span></div>
        <label className="qh-toggle"><input type="checkbox" checked={!!order.tax_applied} onChange={e => setToggle('tax_applied', e.target.checked)} /> NJ tax (6.625%)</label>
        {order.tax_applied && <div className="qh-total-row"><span>NJ tax</span><span>{fmtUSD(taxAmt)}</span></div>}
        <label className="qh-toggle"><input type="checkbox" checked={!!order.cc_fee_applied} onChange={e => setToggle('cc_fee_applied', e.target.checked)} /> Card fee (3%)</label>
        {order.cc_fee_applied && <div className="qh-total-row"><span>Card fee</span><span>{fmtUSD(ccAmt)}</span></div>}
        <div className="qh-total-row qh-grand"><span>Grand total</span><span>{fmtUSD(total)}</span></div>
      </div>

      {msg && <div className={msg.kind === 'err' ? 'qh-msg-err' : 'qh-msg-ok'}>{msg.text}</div>}

      <div className="qh-actions">
        <div className="qh-actions-left">
          <button type="button" className="qh-btn qh-btn-ghost" onClick={saveOnly} disabled={saving || !dirty}>{saving ? 'Saving…' : 'Save changes'}</button>
        </div>
        <div className="qh-actions-right">
          <button type="button" className="qh-btn qh-btn-warn" onClick={() => moveTo('needs_changes', 'changes_requested')} disabled={saving}>Needs Changes</button>
          <button type="button" className="qh-btn qh-btn-go" onClick={() => moveTo('approved', 'approved')} disabled={saving}>Approve Quote</button>
          <button type="button" className="qh-btn qh-btn-send" onClick={() => moveTo('sent_to_customer', 'sent_to_customer')} disabled={saving}>Mark Sent to Customer</button>
        </div>
      </div>

      <NotesAndHistory events={events} onAddNote={addNote} />
    </div>
  )
}

function ReviewHeader({ row, deceasedLine, total }) {
  return (
    <div className="qh-review-head">
      <div>
        <div className="qh-eyebrow">{row?.order_number || ''}</div>
        <h2 className="qh-review-name">{nameOf(row)}</h2>
        {deceasedLine && <div className="qh-review-mem">In memory of {deceasedLine}</div>}
        <div className="qh-review-sub">
          {row?._kind === 'order' && row?.cemetery?.name && <span>{row.cemetery.name}</span>}
          {row?.sales_rep && <span>Built by {row.sales_rep}</span>}
          {row?._kind === 'cemetery' && <span>{(row.doors || []).length} door(s)</span>}
          <QuotePill status={row?.quote_status} />
        </div>
      </div>
      <div className="qh-review-total">
        <div className="qh-review-total-n">{fmtUSD(total)}</div>
        <div className="qh-review-total-l">Quote total</div>
      </div>
    </div>
  )
}

function Totals({ totals, njPct }) {
  return (
    <div className="qh-totals">
      <div className="qh-total-row"><span>Subtotal</span><span>{fmtUSD(totals.subtotalDisc + totals.subtotalPermit)}</span></div>
      {totals.discountAmt > 0 && <div className="qh-total-row"><span>Discount</span><span>−{fmtUSD(totals.discountAmt)}</span></div>}
      <div className="qh-total-row"><span>NJ tax ({njPct}%)</span><span>{fmtUSD(totals.tax)}</span></div>
      {totals.cc > 0 && <div className="qh-total-row"><span>Card surcharge</span><span>{fmtUSD(totals.cc)}</span></div>}
      <div className="qh-total-row qh-grand"><span>Grand total</span><span>{fmtUSD(totals.grandTotal)}</span></div>
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

  .qh-stepper { display: flex; align-items: center; background: #fff; border: 1px solid #ece3d2; border-radius: 12px; padding: 14px 18px; margin-bottom: 16px; flex-wrap: wrap; }
  .qh-step { display: flex; align-items: center; gap: 8px; padding-right: 8px; }
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
  .qh-review-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 18px; border-bottom: 1px solid #f1ead9; padding-bottom: 16px; margin-bottom: 14px; }
  .qh-review-name { font-size: 26px; font-weight: 600; color: #2a2118; margin: 2px 0 4px; }
  .qh-review-mem { font-size: 14px; color: #6b6256; font-style: italic; margin-bottom: 8px; }
  .qh-review-sub { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; font-size: 13px; color: #8a7f6c; }
  .qh-review-total { text-align: right; flex-shrink: 0; }
  .qh-review-total-n { font-size: 26px; font-weight: 700; color: #9a7209; }
  .qh-review-total-l { font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: #b39a6a; }
  .qh-stamp { background: #e8f5ee; border: 1px solid #b7e0c6; color: #2d7a4f; font-size: 13px; font-weight: 600; border-radius: 8px; padding: 8px 12px; margin-bottom: 14px; }

  .qh-lines { border: 1px solid #f1ead9; border-radius: 10px; overflow: hidden; margin-bottom: 16px; }
  .qh-lines-head, .qh-line { display: grid; grid-template-columns: 1fr 90px 130px 34px; gap: 10px; align-items: center; padding: 9px 14px; }
  .qh-lines-head { background: #faf7f1; font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: #a89c86; font-weight: 700; }
  .qh-line { border-top: 1px solid #f4eede; }
  .qh-line.pending { background: #fdf6e8; }
  .qh-line-label { font-size: 14px; color: #2a2118; }
  .qh-line-label-input { font: inherit; font-size: 14px; padding: 6px 8px; border: 1px solid #e4dcc8; border-radius: 7px; }
  .qh-line-qty-static { color: #c3b89f; text-align: center; }
  .qh-line-qty { font: inherit; font-size: 14px; padding: 6px 8px; border: 1px solid #e4dcc8; border-radius: 7px; width: 100%; text-align: center; }
  .qh-line-price { display: flex; align-items: center; gap: 4px; border: 1px solid #e4dcc8; border-radius: 7px; padding: 0 8px; background: #fff; }
  .qh-line-price-static { font-size: 14px; font-weight: 600; color: #2a2118; text-align: right; }
  .qh-line-dollar { color: #a89c86; font-size: 13px; }
  .qh-line-price input { font: inherit; font-size: 14px; padding: 6px 2px; border: none; outline: none; width: 100%; text-align: right; background: transparent; }
  .qh-line-x { font: inherit; font-size: 18px; line-height: 1; color: #c0a98a; background: none; border: none; cursor: pointer; }
  .qh-line-x:hover { color: #b3261e; }
  .qh-add-line { font: inherit; font-size: 13px; font-weight: 600; color: #9a7209; background: #faf7f1; border: none; border-top: 1px solid #f4eede; width: 100%; padding: 10px; cursor: pointer; }
  .qh-add-line:hover { background: #f4eede; }

  .qh-totals { margin-bottom: 16px; }
  .qh-total-row { display: flex; justify-content: space-between; font-size: 14px; color: #6b6256; padding: 5px 2px; }
  .qh-total-row.qh-grand { border-top: 1.5px solid #ece3d2; margin-top: 4px; padding-top: 10px; font-size: 18px; font-weight: 700; color: #2a2118; }
  .qh-toggle { display: flex; align-items: center; gap: 8px; font-size: 13px; color: #6b6256; padding: 4px 2px; cursor: pointer; }

  .qh-dim { font-size: 13px; color: #a89c86; }
  .qh-msg-err { font-size: 13px; color: #b3261e; background: #fbeceb; border: 1px solid #f0cfca; border-radius: 8px; padding: 9px 11px; margin-bottom: 14px; }
  .qh-msg-ok { font-size: 13px; color: #2d7a4f; background: #e8f5ee; border: 1px solid #b7e0c6; border-radius: 8px; padding: 9px 11px; margin-bottom: 14px; }

  .qh-actions { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; margin-bottom: 8px; }
  .qh-actions-left, .qh-actions-right { display: flex; gap: 8px; flex-wrap: wrap; }
  .qh-btn { font: inherit; font-size: 14px; font-weight: 600; border-radius: 9px; padding: 10px 16px; cursor: pointer; border: 1px solid; }
  .qh-btn:disabled { opacity: 0.5; cursor: default; }
  .qh-btn-ghost { background: #fff; border-color: #e4dcc8; color: #6b6256; }
  .qh-btn-ghost:hover:not(:disabled) { background: #faf7f1; }
  .qh-btn-warn { background: #fff; border-color: #e6b8b2; color: #b3261e; }
  .qh-btn-warn:hover:not(:disabled) { background: #fbeceb; }
  .qh-btn-go { background: #2d7a4f; border-color: #2d7a4f; color: #fff; }
  .qh-btn-go:hover:not(:disabled) { background: #266b45; }
  .qh-btn-send { background: #9a7209; border-color: #9a7209; color: #fff; }
  .qh-btn-send:hover:not(:disabled) { background: #b3870c; }

  .qh-l2 { border-top: 1px solid #f1ead9; margin-top: 6px; padding-top: 16px; }
  .qh-l2-h { font-size: 13px; font-weight: 700; color: #2a2118; margin-bottom: 10px; }
  .qh-note-row { display: flex; gap: 8px; align-items: flex-end; margin-bottom: 8px; }
  .qh-note-input { flex: 1; font: inherit; font-size: 14px; padding: 9px 11px; border: 1px solid #e4dcc8; border-radius: 8px; resize: vertical; }
  .qh-timeline { display: flex; flex-direction: column; gap: 9px; margin-top: 10px; }
  .qh-tl-row { display: flex; gap: 10px; align-items: flex-start; }
  .qh-tl-dot { width: 7px; height: 7px; border-radius: 50%; background: #c9a84c; margin-top: 5px; flex-shrink: 0; }
  .qh-tl-label { font-size: 13px; color: #2a2118; }
  .qh-tl-text { color: #6b6256; }
  .qh-tl-meta { font-size: 11px; color: #a89c86; margin-top: 1px; }
`
