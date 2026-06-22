// =============================================================================
// 📚 Stonebooks — Payments tab (v2: Incoming / Outgoing / Estimates)
// =============================================================================
// Three views + four summary cards.
//   INCOMING  — customer payments, logged through recordOrderPayment (the SAME
//               path OrderDetail uses) so balances, Profit, and the A6 deposit
//               milestones reconcile — single source of truth, no double-count.
//               Each payment is a discrete record (date/amount/method/reference/
//               order link/direction=in). Plus an "open balances" list.
//   OUTGOING  — money paid OUT (suppliers/subs/overhead) in its own table
//               (outgoing_payments). Not tied to a customer order.
//   ESTIMATES — open quotes "on the table": $ value + age, with a Contact action
//               that opens the order's email composer.
// Every record (in + out) is stored atomically with the fields QuickBooks needs
// so a later sync is a mapping job. "Connect QuickBooks" is a placeholder only.
// Archived orders are excluded from every figure (query-level + status filters).
// =============================================================================

import { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from './lib/supabase'
import {
  fetchAllPaged, recordOrderPayment, recordOutgoingPayment, listOutgoingPayments,
  listRecurringBills, createRecurringBill, OUTGOING_CATEGORIES,
  fmtUSD, fmtDate, customerName, getCurrentStaffName,
  rowGrandTotal, rowTotalPaid, rowBalanceDue, SOLD_STATUSES,
} from './lib/stonebooksData'
import { ReceiptActions, rowToOrder } from './SalesMode'

// Customer-payment methods + method-specific reference label.
const IN_METHODS = [
  { code: 'check', label: 'Check' },
  { code: 'zelle', label: 'Zelle' },
  { code: 'card',  label: 'Card' },
  { code: 'cash',  label: 'Cash' },
]
const inMethodLabel = (m) => IN_METHODS.find(x => x.code === m)?.label || (m ? m[0].toUpperCase() + m.slice(1) : '—')
function inRefLabel(method) {
  if (method === 'check') return 'Check number'
  if (method === 'zelle') return 'Zelle confirmation #'
  if (method === 'card')  return 'Card confirmation / auth #'
  return null   // cash — no reference
}

const OUT_METHODS = [
  { code: 'check', label: 'Check' },
  { code: 'ach',   label: 'ACH / transfer' },
  { code: 'card',  label: 'Card' },
  { code: 'cash',  label: 'Cash' },
  { code: 'zelle', label: 'Zelle' },
  { code: 'other', label: 'Other' },
]
const outMethodLabel = (m) => OUT_METHODS.find(x => x.code === m)?.label || (m ? m[0].toUpperCase() + m.slice(1) : '—')

// Open quotes "on the table" — pre-close estimate statuses.
const ESTIMATE_STATUSES = ['scoping', 'quoted']

const VIEWS = [
  { code: 'incoming',  label: 'Incoming' },
  { code: 'outgoing',  label: 'Outgoing' },
  { code: 'estimates', label: 'Estimates' },
]

// Order display name: stone/family name first, customer record second.
function orderName(row) {
  if (row.primary_lastname && String(row.primary_lastname).trim()) return String(row.primary_lastname).trim()
  const cn = customerName(row.customer)
  if (cn && cn !== '—') return cn
  const d = Array.isArray(row.deceased) ? row.deceased.find(x => x && !x.isReserved && (x.firstName || x.lastName)) : null
  if (d) return [d.lastName, d.firstName].filter(Boolean).join(', ')
  return row.order_number || 'Unknown'
}

// Flatten an order row into its incoming-payment ledger rows. Prefers payments[];
// falls back to the legacy deposit/balance columns when the array is empty.
function paymentsOf(row) {
  const out = []
  const arr = Array.isArray(row.payments) ? row.payments : []
  if (arr.length > 0) {
    for (const p of arr) {
      if (!p || p.voided) continue
      if (!(p.locked ?? true)) continue
      out.push({
        key: `${row.id}:${p.id}`, orderId: row.id, orderNumber: row.order_number,
        name: orderName(row), dateISO: p.receivedAt || p.createdAt || null,
        method: p.method, amount: Number(p.amount) || 0, ref: p.ref || '',
      })
    }
    return out
  }
  if (Number(row.deposit_amount) > 0) {
    out.push({ key: `${row.id}:legacy-deposit`, orderId: row.id, orderNumber: row.order_number,
      name: orderName(row), dateISO: row.deposit_received_at || null,
      method: row.deposit_method || 'check', amount: Number(row.deposit_amount), ref: row.deposit_ref || '' })
  }
  if (Number(row.balance_amount) > 0) {
    out.push({ key: `${row.id}:legacy-balance`, orderId: row.id, orderNumber: row.order_number,
      name: orderName(row), dateISO: row.balance_received_at || null,
      method: row.balance_method || 'check', amount: Number(row.balance_amount), ref: row.balance_ref || '' })
  }
  return out
}

const ORDER_SELECT =
  'id, order_number, status, created_at, signed_at, target_completion_date, ' +
  'payments, primary_lastname, deceased, ' +
  'deposit_amount, deposit_method, deposit_ref, deposit_received_at, ' +
  'balance_amount, balance_method, balance_ref, balance_received_at, ' +
  'pricing, add_ons, customer:customers(first_name, last_name, email)'

export default function PaymentsTab({ onOpenOrder, onContactOrder }) {
  const [view, setView] = useState('incoming')
  const [orders, setOrders] = useState(null)
  const [outgoing, setOutgoing] = useState(null)
  const [bills, setBills] = useState(null)
  const [search, setSearch] = useState('')
  const [logIn, setLogIn] = useState(null)    // null | {} | { prefill: orderRow }
  const [addOutgoing, setAddOutgoing] = useState(false)
  const [addBill, setAddBill] = useState(false)
  const [payBill, setPayBill] = useState(null)   // a bill instance pending "Update & pay"

  // Stable "now" anchors (lazy init — no Date()/Date.now() in the render body).
  const [monthPrefix] = useState(() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  })
  const [nowMs] = useState(() => Date.now())

  // D1 — archived orders never count toward any money figure.
  const ordersQuery = () => supabase.from('orders').select(ORDER_SELECT)
    .or('archived.is.null,archived.eq.false').order('updated_at', { ascending: false })

  const loadOrders = useCallback(async () => { try { setOrders(await fetchAllPaged(ordersQuery) || []) } catch { setOrders([]) } }, [])
  const loadOutgoing = useCallback(async () => setOutgoing(await listOutgoingPayments() || []), [])
  const loadBills = useCallback(async () => setBills(await listRecurringBills() || []), [])

  useEffect(() => {
    let cancelled = false
    // fetchAllPaged can throw on a page error — keep the floating promise caught.
    fetchAllPaged(ordersQuery).then(r => { if (!cancelled) setOrders(r || []) }).catch(() => { if (!cancelled) setOrders([]) })
    listOutgoingPayments().then(r => { if (!cancelled) setOutgoing(r || []) })
    listRecurringBills().then(r => { if (!cancelled) setBills(r || []) })
    return () => { cancelled = true }
  }, [])

  // ── Derivations ────────────────────────────────────────────────────────────
  const incomingRows = useMemo(() => {
    if (!orders) return []
    const all = orders.flatMap(paymentsOf)
    all.sort((a, b) => (b.dateISO ? new Date(b.dateISO).getTime() : 0) - (a.dateISO ? new Date(a.dateISO).getTime() : 0))
    return all
  }, [orders])

  const incomingFiltered = useMemo(() => {
    const needle = search.trim().toLowerCase()
    if (!needle) return incomingRows
    return incomingRows.filter(r => [r.name, r.orderNumber, inMethodLabel(r.method), r.ref]
      .filter(Boolean).join(' ').toLowerCase().includes(needle))
  }, [incomingRows, search])

  const openBalances = useMemo(() => {
    if (!orders) return []
    return orders
      .filter(o => SOLD_STATUSES.includes(o.status) && rowBalanceDue(o) > 0)
      .map(o => ({ order: o, name: orderName(o), balance: rowBalanceDue(o) }))
      .sort((a, b) => b.balance - a.balance)
  }, [orders])

  const estimates = useMemo(() => {
    if (!orders) return []
    return orders
      .filter(o => ESTIMATE_STATUSES.includes(o.status))
      .map(o => {
        const value = rowGrandTotal(o)
        const ageDays = o.created_at ? Math.max(0, Math.floor((nowMs - new Date(o.created_at).getTime()) / 86400000)) : 0
        return { order: o, name: orderName(o), value, ageDays }
      })
      .sort((a, b) => b.ageDays - a.ageDays)   // stalest quotes first
  }, [orders, nowMs])

  // Summary cards
  const outstanding = useMemo(() => openBalances.reduce((s, b) => s + b.balance, 0), [openBalances])
  const onTheTable = useMemo(() => estimates.reduce((s, e) => s + e.value, 0), [estimates])
  const collectedThisMonth = useMemo(
    () => incomingRows.filter(r => (r.dateISO || '').startsWith(monthPrefix)).reduce((s, r) => s + r.amount, 0),
    [incomingRows, monthPrefix])
  const paidOutThisMonth = useMemo(
    () => (outgoing || []).filter(o => (o.paid_date || '').startsWith(monthPrefix)).reduce((s, o) => s + (Number(o.amount) || 0), 0),
    [outgoing, monthPrefix])

  const loading = orders === null

  return (
    <div className="sb-page sb-page-wide">
      <style>{PAY_CSS}</style>
      <div className="sb-page-head sb-pay-head">
        <div>
          <div className="sb-page-eyebrow">Money</div>
          <h1 className="sb-page-title">Payments</h1>
        </div>
        <button type="button" className="sb-pay-qb" disabled title="QuickBooks sync — coming in a future update">
          <span className="sb-pay-qb-dot" /> Connect QuickBooks
          <span className="sb-pay-qb-soon">soon</span>
        </button>
      </div>

      {/* Summary cards */}
      <div className="sb-pay-cards">
        <SummaryCard label="Outstanding" value={outstanding} sub={`Owed to you · ${openBalances.length} order${openBalances.length === 1 ? '' : 's'}`} tone="amber" />
        <SummaryCard label="On the table" value={onTheTable} sub={`${estimates.length} open estimate${estimates.length === 1 ? '' : 's'}`} tone="blue" />
        <SummaryCard label="Collected" value={collectedThisMonth} sub="This month · incoming" tone="green" />
        <SummaryCard label="Paid out" value={paidOutThisMonth} sub="This month · outgoing" tone="red" />
      </div>

      {/* View toggle */}
      <div className="sb-pay-views" role="tablist" aria-label="Payments view">
        {VIEWS.map(v => (
          <button key={v.code} type="button" role="tab" aria-selected={view === v.code}
            className={`sb-pay-view ${view === v.code ? 'on' : ''}`} onClick={() => setView(v.code)}>
            {v.label}
          </button>
        ))}
      </div>

      {view === 'incoming' && (
        <IncomingView
          loading={loading} rows={incomingFiltered} search={search} setSearch={setSearch}
          openBalances={openBalances} onOpenOrder={onOpenOrder}
          onLog={() => setLogIn({})} onLogFor={(order) => setLogIn({ prefill: order })}
        />
      )}
      {view === 'outgoing' && (
        <OutgoingView
          loading={outgoing === null || bills === null}
          payments={outgoing || []} bills={bills || []} monthPrefix={monthPrefix}
          onAddBill={() => setAddBill(true)} onAddOutgoing={() => setAddOutgoing(true)}
          onPayBill={(instance) => setPayBill(instance)}
        />
      )}
      {view === 'estimates' && (
        <EstimatesView loading={loading} rows={estimates} onOpenOrder={onOpenOrder} onContact={onContactOrder} />
      )}

      {logIn && (
        <LogIncomingModal
          orders={orders || []} prefill={logIn.prefill || null}
          onClose={() => setLogIn(null)}
          onLogged={() => { setLogIn(null); loadOrders() }}
        />
      )}
      {addOutgoing && (
        <LogOutgoingModal
          orders={orders || []}
          onClose={() => setAddOutgoing(false)}
          onLogged={() => { setAddOutgoing(false); loadOutgoing() }}
        />
      )}
      {addBill && (
        <AddBillModal
          onClose={() => setAddBill(false)}
          onSaved={() => { setAddBill(false); loadBills() }}
        />
      )}
      {payBill && (
        <PayBillModal
          instance={payBill}
          onClose={() => setPayBill(null)}
          onPaid={() => { setPayBill(null); loadOutgoing() }}
        />
      )}
    </div>
  )
}

function SummaryCard({ label, value, sub, tone }) {
  return (
    <div className={`sb-pay-card sb-pay-card-${tone}`}>
      <div className="sb-pay-card-label">{label}</div>
      <div className="sb-pay-card-value">{fmtUSD(value)}</div>
      <div className="sb-pay-card-sub">{sub}</div>
    </div>
  )
}

// ── Incoming view ────────────────────────────────────────────────────────────
function IncomingView({ loading, rows, search, setSearch, openBalances, onOpenOrder, onLog, onLogFor }) {
  const total = rows.reduce((s, r) => s + r.amount, 0)
  return (
    <>
      <div className="sb-pay-controls">
        <input className="sb-pay-search" placeholder="Search by name, order #, method, reference…"
          value={search} onChange={e => setSearch(e.target.value)} />
        <button type="button" className="sb-pay-log-btn" onClick={onLog}>+ Log incoming payment</button>
      </div>
      <div className="sb-pay-summary">
        <span><strong>{rows.length}</strong> payment{rows.length === 1 ? '' : 's'}</span>
        <span>Total: <strong>{fmtUSD(total)}</strong></span>
      </div>

      <div className="sb-pay-table">
        <div className="sb-pay-row sb-pay-row-head">
          <div>Date</div><div>Customer / Stone</div><div>Order #</div><div>Method</div>
          <div className="num">Amount</div><div>Reference</div>
        </div>
        {loading ? <div className="sb-pay-empty">Loading…</div>
          : rows.length === 0 ? <div className="sb-pay-empty">No payments {search ? 'match your search' : 'logged yet'}.</div>
          : rows.map(r => (
            <button type="button" key={r.key} className="sb-pay-row sb-pay-row-data" onClick={() => onOpenOrder?.(r.orderId)} title="Open order">
              <div>{r.dateISO ? fmtDate(r.dateISO) : '—'}</div>
              <div className="sb-pay-name">{r.name}</div>
              <div className="sb-pay-mono">{r.orderNumber || '—'}</div>
              <div>{inMethodLabel(r.method)}</div>
              <div className="num sb-pay-amt">{fmtUSD(r.amount)}</div>
              <div className="sb-pay-ref">{r.ref || '—'}</div>
            </button>
          ))}
      </div>

      {/* Open balances */}
      <div className="sb-pay-subhead">Open balances <span className="sb-pay-subhead-note">(excludes archived)</span></div>
      <div className="sb-pay-table">
        <div className="sb-pay-row sb-pay-bal-row sb-pay-row-head">
          <div>Customer / Stone</div><div>Order #</div><div className="num">Balance due</div><div />
        </div>
        {loading ? <div className="sb-pay-empty">Loading…</div>
          : openBalances.length === 0 ? <div className="sb-pay-empty">No open balances — everything's collected.</div>
          : openBalances.map(b => (
            <div key={b.order.id} className="sb-pay-row sb-pay-bal-row sb-pay-row-data2">
              <button type="button" className="sb-pay-bal-name" onClick={() => onOpenOrder?.(b.order.id)}>{b.name}</button>
              <span className="sb-pay-mono">{b.order.order_number || '—'}</span>
              <span className="num sb-pay-amt">{fmtUSD(b.balance)}</span>
              <button type="button" className="sb-pay-bal-log" onClick={() => onLogFor(b.order)}>Log payment</button>
            </div>
          ))}
      </div>
    </>
  )
}

// Derive this month's bill instances from active templates (NO materialized
// rows — Due/Paid is computed from real payments linked to each template).
function billInstancesForMonth(bills, payments, monthPrefix) {
  const yearPrefix = monthPrefix.slice(0, 4)
  const curMM = monthPrefix.slice(5, 7)
  const out = []
  for (const bill of bills) {
    if (!bill.active) continue
    const linked = payments.filter(p => p.recurring_bill_id === bill.id)
    const paidCount = linked.length
    // Fixed-term: stop generating once the term is fully paid.
    if (bill.frequency === 'fixed_term' && bill.term_count && paidCount >= bill.term_count) continue
    let dueThisMonth = false, paidThisCycle = false
    if (bill.frequency === 'monthly' || bill.frequency === 'fixed_term') {
      dueThisMonth = true
      paidThisCycle = linked.some(p => (p.paid_date || '').startsWith(monthPrefix))
    } else if (bill.frequency === 'yearly') {
      const annivMM = (bill.created_at || '').slice(5, 7) || curMM
      dueThisMonth = annivMM === curMM
      paidThisCycle = linked.some(p => (p.paid_date || '').startsWith(yearPrefix))
    }
    if (!dueThisMonth) continue
    out.push({
      bill, status: paidThisCycle ? 'paid' : 'due',
      expected: bill.amount_default != null ? Number(bill.amount_default) : null,
      varies: bill.amount_varies, paidCount, term: bill.term_count,
    })
  }
  out.sort((a, b) => (a.status === b.status ? a.bill.name.localeCompare(b.bill.name) : (a.status === 'due' ? -1 : 1)))
  return out
}

// ── Outgoing view ────────────────────────────────────────────────────────────
function OutgoingView({ loading, payments, bills, monthPrefix, onAddBill, onAddOutgoing, onPayBill }) {
  const instances = useMemo(() => billInstancesForMonth(bills, payments, monthPrefix), [bills, payments, monthPrefix])
  const dueThisMonth = useMemo(
    () => instances.filter(i => i.status === 'due').reduce((s, i) => s + (i.expected || 0), 0),
    [instances])
  const paidThisMonth = useMemo(
    () => payments.filter(p => (p.paid_date || '').startsWith(monthPrefix)).reduce((s, p) => s + (Number(p.amount) || 0), 0),
    [payments, monthPrefix])

  return (
    <>
      <div className="sb-pay-cards sb-pay-cards-2">
        <SummaryCard label="Due this month" value={dueThisMonth} sub={`${instances.filter(i => i.status === 'due').length} bill${instances.filter(i => i.status === 'due').length === 1 ? '' : 's'} outstanding`} tone="amber" />
        <SummaryCard label="Paid this month" value={paidThisMonth} sub="Bills + one-offs" tone="red" />
      </div>

      <div className="sb-pay-controls">
        <div style={{ flex: 1 }} />
        <button type="button" className="sb-pay-log-btn sb-pay-log-ghost" onClick={onAddBill}>+ Add bill</button>
        <button type="button" className="sb-pay-log-btn" onClick={onAddOutgoing}>+ Add outgoing payment</button>
      </div>

      {/* Bills this month */}
      <div className="sb-pay-subhead">Bills this month <span className="sb-pay-subhead-note">(from recurring templates)</span></div>
      <div className="sb-pay-table">
        <div className="sb-pay-row sb-pay-bill-row sb-pay-row-head">
          <div>Bill</div><div>Category</div><div>Cadence</div><div className="num">Amount</div><div>Status</div><div />
        </div>
        {loading ? <div className="sb-pay-empty">Loading…</div>
          : instances.length === 0 ? <div className="sb-pay-empty">No bills due this month. Use “+ Add bill” to set up recurring overhead.</div>
          : instances.map(i => (
            <div key={i.bill.id} className="sb-pay-row sb-pay-bill-row">
              <div className="sb-pay-name">{i.bill.name}</div>
              <div>{i.bill.category || '—'}</div>
              <div className="sb-pay-cadence">
                {i.bill.frequency === 'fixed_term'
                  ? `Fixed term · ${Math.min(i.paidCount + (i.status === 'due' ? 1 : 0), i.term || 0)} of ${i.term || '?'}`
                  : i.bill.frequency === 'yearly' ? 'Yearly' : 'Monthly'}
              </div>
              <div className="num sb-pay-amt">{i.expected != null ? fmtUSD(i.expected) : '—'}{i.varies && <span className="sb-pay-varies">varies</span>}</div>
              <div>{i.status === 'paid'
                ? <span className="sb-pay-pill sb-pay-pill-paid">Paid</span>
                : <span className="sb-pay-pill sb-pay-pill-due">Due</span>}</div>
              <div>{i.status === 'due' && <button type="button" className="sb-pay-contact" onClick={() => onPayBill(i)}>Update &amp; pay</button>}</div>
            </div>
          ))}
      </div>

      {/* Outgoing payments ledger */}
      <div className="sb-pay-subhead">Outgoing payments</div>
      <div className="sb-pay-table">
        <div className="sb-pay-row sb-pay-out-row sb-pay-row-head">
          <div>Date</div><div>Payee</div><div>Category</div><div>Method</div><div className="num">Amount</div><div>Reference</div>
        </div>
        {loading ? <div className="sb-pay-empty">Loading…</div>
          : payments.length === 0 ? <div className="sb-pay-empty">No outgoing payments yet. (If this stays empty after logging one, the outgoing_payments / recurring_bills migrations may still need to be applied.)</div>
          : payments.map(o => (
            <div key={o.id} className="sb-pay-row sb-pay-out-row">
              <div>{o.paid_date ? fmtDate(o.paid_date) : '—'}</div>
              <div className="sb-pay-name">{o.payee}{o.order_id && <span className="sb-pay-tag">order cost</span>}{o.recurring_bill_id && <span className="sb-pay-tag sb-pay-tag-bill">bill</span>}</div>
              <div>{o.category || '—'}</div>
              <div>{outMethodLabel(o.method)}</div>
              <div className="num sb-pay-amt">{fmtUSD(Number(o.amount) || 0)}</div>
              <div className="sb-pay-ref">{o.reference || '—'}</div>
            </div>
          ))}
      </div>
    </>
  )
}

// ── Estimates view ───────────────────────────────────────────────────────────
function EstimatesView({ loading, rows, onOpenOrder, onContact }) {
  return (
    <>
      <div className="sb-pay-summary"><span><strong>{rows.length}</strong> open estimate{rows.length === 1 ? '' : 's'} on the table</span></div>
      <div className="sb-pay-table">
        <div className="sb-pay-row sb-pay-est-row sb-pay-row-head">
          <div>Customer / Stone</div><div>Order #</div><div className="num">Value</div><div className="num">Age</div><div />
        </div>
        {loading ? <div className="sb-pay-empty">Loading…</div>
          : rows.length === 0 ? <div className="sb-pay-empty">No open estimates right now.</div>
          : rows.map(e => (
            <div key={e.order.id} className="sb-pay-row sb-pay-est-row">
              <button type="button" className="sb-pay-bal-name" onClick={() => onOpenOrder?.(e.order.id)}>{e.name}</button>
              <span className="sb-pay-mono">{e.order.order_number || '—'}</span>
              <span className="num sb-pay-amt">{fmtUSD(e.value)}</span>
              <span className={`num sb-pay-age ${e.ageDays >= 30 ? 'stale' : ''}`}>{e.ageDays}d</span>
              <button type="button" className="sb-pay-contact" onClick={() => onContact?.(e.order.id)}>Contact</button>
            </div>
          ))}
      </div>
    </>
  )
}

// ── Log incoming modal ───────────────────────────────────────────────────────
function todayISO() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function LogIncomingModal({ orders, prefill, onClose, onLogged }) {
  const [pick, setPick] = useState(prefill || null)
  const [orderSearch, setOrderSearch] = useState('')
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState('check')
  const [date, setDate] = useState(todayISO)
  const [ref, setRef] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [confirm, setConfirm] = useState(false)
  const [saved, setSaved] = useState(null)        // { payment, receiptOrder } → post-save receipt offer

  const matches = useMemo(() => {
    const needle = orderSearch.trim().toLowerCase()
    if (!needle) return []
    return orders.filter(o => [orderName(o), o.order_number].filter(Boolean).join(' ').toLowerCase().includes(needle)).slice(0, 8)
  }, [orders, orderSearch])

  const pickBalance = pick ? Math.max(0, rowGrandTotal(pick) - rowTotalPaid(pick)) : 0
  const refLabel = inRefLabel(method)

  const submit = async () => {
    if (!pick) { setError('Pick an order first.'); return }
    const amt = Number(amount)
    if (!Number.isFinite(amt) || amt <= 0) { setError('Enter an amount greater than zero.'); return }
    if (!confirm) { setConfirm(true); setError(null); return }
    setBusy(true); setError(null)
    const createdBy = await getCurrentStaffName()
    const res = await recordOrderPayment(pick.id, { amount: amt, method, ref: ref.trim() || null, receivedAt: date, createdBy })
    setBusy(false)
    if (!res.ok) { setError(res.error || 'Could not record the payment.'); setConfirm(false); return }
    // ⭐ Keep the modal open and offer Print + Email + Download right after save.
    // Build the receipt order WITH the new payment appended so the receipt's
    // running totals are correct (pick is the pre-save row).
    const withNew = [...(Array.isArray(pick.payments) ? pick.payments : []), res.payment]
    const receiptOrder = rowToOrder({ ...pick, payments: withNew }, pick.customer, undefined)
    setSaved({ payment: res.payment, receiptOrder })
  }

  return (
    <div className="sb-pay-backdrop" onClick={() => { if (!busy) onClose() }}>
      <div className="sb-pay-modal" role="dialog" aria-modal="true" aria-label="Log incoming payment" onClick={e => e.stopPropagation()}>
        <h3 className="sb-pay-modal-title">{saved ? 'Payment recorded' : 'Log an incoming payment'}</h3>

        {saved ? (
          <>
            <div className="sb-pay-confirm-note" style={{ background: '#e6f4ec', borderColor: '#2d7a4f', color: '#2d7a4f' }}>
              Recorded {fmtUSD(Number(saved.payment.amount) || 0)} ({inMethodLabel(saved.payment.method)}){pick ? ` against ${orderName(pick)}` : ''}.
            </div>
            <ReceiptActions order={saved.receiptOrder} payment={saved.payment} />
            <div className="sb-pay-modal-actions">
              <button type="button" className="sb-pay-confirm" onClick={onLogged}>Done</button>
            </div>
          </>
        ) : (<>
        {!pick ? (
          <div className="sb-pay-field">
            <label>Order</label>
            <input className="sb-pay-input" placeholder="Search by family name or order #…" value={orderSearch} onChange={e => setOrderSearch(e.target.value)} autoFocus />
            {matches.length > 0 && (
              <div className="sb-pay-order-results">
                {matches.map(o => (
                  <button type="button" key={o.id} className="sb-pay-order-result" onClick={() => { setPick(o); setConfirm(false) }}>
                    <span className="sb-pay-name">{orderName(o)}</span>
                    <span className="sb-pay-mono">{o.order_number || '—'}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="sb-pay-picked">
            <div>
              <div className="sb-pay-name">{orderName(pick)}</div>
              <div className="sb-pay-mono sb-pay-picked-num">{pick.order_number} · balance {fmtUSD(pickBalance)}</div>
            </div>
            <button type="button" className="sb-pay-change" onClick={() => { setPick(null); setConfirm(false) }}>Change</button>
          </div>
        )}

        <div className="sb-pay-grid2">
          <div className="sb-pay-field">
            <label>Amount</label>
            <input className="sb-pay-input" type="number" min="0" step="0.01" value={amount} onChange={e => { setAmount(e.target.value); setConfirm(false) }} placeholder="0.00" />
          </div>
          <div className="sb-pay-field">
            <label>Method</label>
            <select className="sb-pay-input" value={method} onChange={e => setMethod(e.target.value)}>
              {IN_METHODS.map(m => <option key={m.code} value={m.code}>{m.label}</option>)}
            </select>
          </div>
          <div className="sb-pay-field">
            <label>Date received</label>
            <input className="sb-pay-input" type="date" value={date} onChange={e => setDate(e.target.value)} />
          </div>
          {refLabel ? (
            <div className="sb-pay-field">
              <label>{refLabel}</label>
              <input className="sb-pay-input" value={ref} onChange={e => setRef(e.target.value)} placeholder="optional" />
            </div>
          ) : <div className="sb-pay-field" />}
        </div>

        {error && <div className="sb-pay-error">{error}</div>}
        {confirm && !error && (
          <div className="sb-pay-confirm-note">Record {fmtUSD(Number(amount) || 0)} ({inMethodLabel(method)}) against {pick ? orderName(pick) : 'this order'}?</div>
        )}
        <div className="sb-pay-modal-actions">
          <button type="button" className="sb-pay-cancel" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className="sb-pay-confirm" onClick={submit} disabled={busy}>
            {busy ? 'Recording…' : confirm ? 'Confirm — record payment' : 'Log payment'}
          </button>
        </div>
        </>)}
      </div>
    </div>
  )
}

// Outgoing reference label by method (check # vs confirmation #; none for cash).
function outRefLabel(method) {
  if (method === 'check') return 'Check number'
  if (method === 'cash')  return null
  return 'Confirmation / reference #'
}

// ── Log outgoing modal (one-off expense, optional order link) ────────────────
function LogOutgoingModal({ orders, onClose, onLogged }) {
  const [payee, setPayee] = useState('')
  const [category, setCategory] = useState('Supplier/materials')
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState('check')
  const [date, setDate] = useState(todayISO)
  const [ref, setRef] = useState('')
  const [orderLink, setOrderLink] = useState(null)
  const [orderSearch, setOrderSearch] = useState('')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [confirm, setConfirm] = useState(false)
  const refLabel = outRefLabel(method)

  const matches = useMemo(() => {
    const needle = orderSearch.trim().toLowerCase()
    if (!needle) return []
    return orders.filter(o => [orderName(o), o.order_number].filter(Boolean).join(' ').toLowerCase().includes(needle)).slice(0, 8)
  }, [orders, orderSearch])

  const submit = async () => {
    if (!payee.trim()) { setError('Enter a payee.'); return }
    const amt = Number(amount)
    if (!Number.isFinite(amt) || amt <= 0) { setError('Enter an amount greater than zero.'); return }
    if (!confirm) { setConfirm(true); setError(null); return }
    setBusy(true); setError(null)
    const createdBy = await getCurrentStaffName()
    const res = await recordOutgoingPayment({ payee, category, method, reference: ref, amount: amt, paidDate: date, notes, orderId: orderLink?.id || null, createdBy })
    setBusy(false)
    if (!res.ok) { setError(res.error || 'Could not record the payment.'); setConfirm(false); return }
    onLogged()
  }

  return (
    <div className="sb-pay-backdrop" onClick={() => { if (!busy) onClose() }}>
      <div className="sb-pay-modal" role="dialog" aria-modal="true" aria-label="Log outgoing payment" onClick={e => e.stopPropagation()}>
        <h3 className="sb-pay-modal-title">Log an outgoing payment</h3>
        <div className="sb-pay-field">
          <label>Payee</label>
          <input className="sb-pay-input" value={payee} onChange={e => { setPayee(e.target.value); setConfirm(false) }} placeholder="Supplier, sub, landlord…" autoFocus />
        </div>
        <div className="sb-pay-grid2">
          <div className="sb-pay-field">
            <label>Category</label>
            <select className="sb-pay-input" value={category} onChange={e => setCategory(e.target.value)}>
              {OUTGOING_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="sb-pay-field">
            <label>Amount</label>
            <input className="sb-pay-input" type="number" min="0" step="0.01" value={amount} onChange={e => { setAmount(e.target.value); setConfirm(false) }} placeholder="0.00" />
          </div>
          <div className="sb-pay-field">
            <label>Method</label>
            <select className="sb-pay-input" value={method} onChange={e => setMethod(e.target.value)}>
              {OUT_METHODS.map(m => <option key={m.code} value={m.code}>{m.label}</option>)}
            </select>
          </div>
          <div className="sb-pay-field">
            <label>Date paid</label>
            <input className="sb-pay-input" type="date" value={date} onChange={e => setDate(e.target.value)} />
          </div>
          {refLabel && (
            <div className="sb-pay-field" style={{ gridColumn: '1 / -1' }}>
              <label>{refLabel}</label>
              <input className="sb-pay-input" value={ref} onChange={e => setRef(e.target.value)} placeholder="optional" />
            </div>
          )}
        </div>

        {/* Optional order link */}
        <div className="sb-pay-field">
          <label>Link to a job / order <span className="sb-pay-optional">optional — makes it a cost on that order</span></label>
          {orderLink ? (
            <div className="sb-pay-picked">
              <div><div className="sb-pay-name">{orderName(orderLink)}</div><div className="sb-pay-mono sb-pay-picked-num">{orderLink.order_number}</div></div>
              <button type="button" className="sb-pay-change" onClick={() => setOrderLink(null)}>Remove</button>
            </div>
          ) : (
            <>
              <input className="sb-pay-input" placeholder="Search by family name or order #…" value={orderSearch} onChange={e => setOrderSearch(e.target.value)} />
              {matches.length > 0 && (
                <div className="sb-pay-order-results">
                  {matches.map(o => (
                    <button type="button" key={o.id} className="sb-pay-order-result" onClick={() => { setOrderLink(o); setOrderSearch('') }}>
                      <span className="sb-pay-name">{orderName(o)}</span><span className="sb-pay-mono">{o.order_number || '—'}</span>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
        <div className="sb-pay-field">
          <label>Notes</label>
          <input className="sb-pay-input" value={notes} onChange={e => setNotes(e.target.value)} placeholder="optional" />
        </div>

        {error && <div className="sb-pay-error">{error}</div>}
        {confirm && !error && (
          <div className="sb-pay-confirm-note">Record {fmtUSD(Number(amount) || 0)} ({outMethodLabel(method)}) to {payee || 'this payee'}{orderLink ? ` — cost on ${orderLink.order_number}` : ' (overhead)'}?</div>
        )}
        <div className="sb-pay-modal-actions">
          <button type="button" className="sb-pay-cancel" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className="sb-pay-confirm" onClick={submit} disabled={busy}>
            {busy ? 'Recording…' : confirm ? 'Confirm — record payment' : 'Log payment'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Add recurring bill modal (template only — no payment) ────────────────────
function AddBillModal({ onClose, onSaved }) {
  const [name, setName] = useState('')
  const [category, setCategory] = useState('Utilities')
  const [frequency, setFrequency] = useState('monthly')
  const [termCount, setTermCount] = useState('')
  const [amountDefault, setAmountDefault] = useState('')
  const [amountVaries, setAmountVaries] = useState(false)
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const submit = async () => {
    if (!name.trim()) { setError('Enter a bill name.'); return }
    setBusy(true); setError(null)
    const createdBy = await getCurrentStaffName()
    const res = await createRecurringBill({ name, category, frequency, termCount, amountDefault, amountVaries, notes, createdBy })
    setBusy(false)
    if (!res.ok) { setError(res.error || 'Could not save the bill.'); return }
    onSaved()
  }

  return (
    <div className="sb-pay-backdrop" onClick={() => { if (!busy) onClose() }}>
      <div className="sb-pay-modal" role="dialog" aria-modal="true" aria-label="Add recurring bill" onClick={e => e.stopPropagation()}>
        <h3 className="sb-pay-modal-title">Add a recurring bill</h3>
        <p className="sb-pay-modal-sub">A template for overhead that repeats. No payment is created — it shows as “Due” each cycle until you pay it.</p>
        <div className="sb-pay-field">
          <label>Name</label>
          <input className="sb-pay-input" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Electric" autoFocus />
        </div>
        <div className="sb-pay-grid2">
          <div className="sb-pay-field">
            <label>Category</label>
            <select className="sb-pay-input" value={category} onChange={e => setCategory(e.target.value)}>
              {OUTGOING_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="sb-pay-field">
            <label>Frequency</label>
            <select className="sb-pay-input" value={frequency} onChange={e => setFrequency(e.target.value)}>
              <option value="monthly">Monthly</option>
              <option value="yearly">Yearly</option>
              <option value="fixed_term">Fixed term</option>
            </select>
          </div>
          {frequency === 'fixed_term' && (
            <div className="sb-pay-field">
              <label>Term (number of payments)</label>
              <input className="sb-pay-input" type="number" min="1" step="1" value={termCount} onChange={e => setTermCount(e.target.value)} placeholder="e.g. 15" />
            </div>
          )}
          <div className="sb-pay-field">
            <label>Default amount</label>
            <input className="sb-pay-input" type="number" min="0" step="0.01" value={amountDefault} onChange={e => setAmountDefault(e.target.value)} placeholder="0.00" />
          </div>
        </div>
        <label className="sb-pay-check">
          <input type="checkbox" checked={amountVaries} onChange={e => setAmountVaries(e.target.checked)} />
          <span>Amount varies each cycle (correct the number when you pay)</span>
        </label>
        <div className="sb-pay-field">
          <label>Notes</label>
          <input className="sb-pay-input" value={notes} onChange={e => setNotes(e.target.value)} placeholder="optional" />
        </div>

        {error && <div className="sb-pay-error">{error}</div>}
        <div className="sb-pay-modal-actions">
          <button type="button" className="sb-pay-cancel" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className="sb-pay-confirm" onClick={submit} disabled={busy}>{busy ? 'Saving…' : 'Add bill'}</button>
        </div>
      </div>
    </div>
  )
}

// ── Update & pay a bill (writes a real outgoing_payments row) ────────────────
function PayBillModal({ instance, onClose, onPaid }) {
  const bill = instance.bill
  const [amount, setAmount] = useState(instance.expected != null ? String(instance.expected) : '')
  const [method, setMethod] = useState('ach')
  const [ref, setRef] = useState('')
  const [date, setDate] = useState(todayISO)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const refLabel = outRefLabel(method)

  const submit = async () => {
    const amt = Number(amount)
    if (!Number.isFinite(amt) || amt <= 0) { setError('Enter an amount greater than zero.'); return }
    setBusy(true); setError(null)
    const createdBy = await getCurrentStaffName()
    const res = await recordOutgoingPayment({
      payee: bill.name, category: bill.category, method, reference: ref,
      amount: amt, paidDate: date, recurringBillId: bill.id, createdBy,
    })
    setBusy(false)
    if (!res.ok) { setError(res.error || 'Could not record the payment.'); return }
    onPaid()
  }

  return (
    <div className="sb-pay-backdrop" onClick={() => { if (!busy) onClose() }}>
      <div className="sb-pay-modal" role="dialog" aria-modal="true" aria-label="Pay bill" onClick={e => e.stopPropagation()}>
        <h3 className="sb-pay-modal-title">Pay “{bill.name}”</h3>
        <p className="sb-pay-modal-sub">{bill.category || 'Uncategorized'}{instance.varies ? ' · amount varies — enter the actual' : ''}. This creates a paid record linked to the bill.</p>
        <div className="sb-pay-grid2">
          <div className="sb-pay-field">
            <label>Actual amount</label>
            <input className="sb-pay-input" type="number" min="0" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00" autoFocus />
          </div>
          <div className="sb-pay-field">
            <label>Method</label>
            <select className="sb-pay-input" value={method} onChange={e => setMethod(e.target.value)}>
              {OUT_METHODS.map(m => <option key={m.code} value={m.code}>{m.label}</option>)}
            </select>
          </div>
          <div className="sb-pay-field">
            <label>Date paid</label>
            <input className="sb-pay-input" type="date" value={date} onChange={e => setDate(e.target.value)} />
          </div>
          {refLabel && (
            <div className="sb-pay-field">
              <label>{refLabel}</label>
              <input className="sb-pay-input" value={ref} onChange={e => setRef(e.target.value)} placeholder="optional" />
            </div>
          )}
        </div>
        {error && <div className="sb-pay-error">{error}</div>}
        <div className="sb-pay-modal-actions">
          <button type="button" className="sb-pay-cancel" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className="sb-pay-confirm" onClick={submit} disabled={busy}>{busy ? 'Recording…' : 'Record payment'}</button>
        </div>
      </div>
    </div>
  )
}

const PAY_CSS = `
  .sb-pay-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
  .sb-pay-qb {
    display: inline-flex; align-items: center; gap: 8px; font: inherit; font-size: 13px; font-weight: 500;
    padding: 8px 14px; border: 0.5px solid #d8d6d1; border-radius: 8px; background: #fff; color: #6b6b66;
    cursor: not-allowed; white-space: nowrap;
  }
  .sb-pay-qb-dot { width: 8px; height: 8px; border-radius: 50%; background: #2CA01C; }
  .sb-pay-qb-soon { font-size: 9px; text-transform: uppercase; letter-spacing: 0.08em; color: #a0a09a; background: #f4f2ee; padding: 1px 5px; border-radius: 999px; }

  .sb-pay-cards { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin: 18px 0; }
  .sb-pay-cards-2 { grid-template-columns: repeat(2, 1fr); max-width: 520px; }
  .sb-pay-card { background: #fff; border: 0.5px solid #e6e3dd; border-left: 3px solid #ccc; border-radius: 10px; padding: 14px 16px; }
  .sb-pay-card-amber { border-left-color: #b8842a; }
  .sb-pay-card-blue  { border-left-color: #1d4ed8; }
  .sb-pay-card-green { border-left-color: #2d7a4f; }
  .sb-pay-card-red   { border-left-color: #b54040; }
  .sb-pay-card-label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.1em; font-weight: 600; color: #8a8a85; }
  .sb-pay-card-value { font-size: 24px; font-weight: 700; color: #1e2d3d; font-variant-numeric: tabular-nums; margin: 4px 0 2px; }
  .sb-pay-card-sub { font-size: 12px; color: #8a8a85; }

  .sb-pay-views { display: inline-flex; gap: 4px; padding: 4px; background: #f0eeea; border-radius: 999px; margin-bottom: 16px; }
  .sb-pay-view { font: inherit; font-size: 13px; padding: 6px 16px; border: none; background: transparent; color: #6b6b66; border-radius: 999px; cursor: pointer; }
  .sb-pay-view:hover { color: #1e2d3d; }
  .sb-pay-view.on { background: #fff; color: #1e2d3d; font-weight: 600; box-shadow: 0 1px 2px rgba(15,20,25,0.08); }

  .sb-pay-controls { display: flex; gap: 12px; align-items: center; margin-bottom: 12px; flex-wrap: wrap; }
  .sb-pay-search { flex: 1; min-width: 220px; font: inherit; font-size: 14px; padding: 9px 13px; border: 0.5px solid #e6e3dd; border-radius: 8px; background: #fff; }
  .sb-pay-log-btn { font: inherit; font-size: 13px; font-weight: 600; padding: 9px 16px; border: 0.5px solid transparent; border-radius: 8px; background: #9A7209; color: #fff; cursor: pointer; white-space: nowrap; }
  .sb-pay-log-btn:hover { filter: brightness(0.95); }
  .sb-pay-log-ghost { background: #fff; color: #9A7209; border-color: #d8c89a; }
  .sb-pay-cadence { font-size: 12px; color: #6b6b66; }
  .sb-pay-varies { font-size: 10px; color: #b8842a; margin-left: 6px; }
  .sb-pay-pill { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; padding: 2px 8px; border-radius: 999px; }
  .sb-pay-pill-due { color: #5e3a0e; background: #fbe5b8; }
  .sb-pay-pill-paid { color: #2d7a4f; background: #e6f4ec; }
  .sb-pay-tag { font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: #6b6b66; background: #f0eeea; padding: 1px 6px; border-radius: 999px; margin-left: 8px; }
  .sb-pay-tag-bill { color: #4a3a8a; background: #ece9f7; }
  .sb-pay-optional { font-weight: 400; text-transform: none; letter-spacing: 0; color: #a0a09a; margin-left: 6px; }
  .sb-pay-check { display: flex; align-items: center; gap: 8px; font-size: 13px; color: #333; margin-bottom: 12px; }
  .sb-pay-modal-sub { font-size: 13px; color: #6b6b66; margin: -8px 0 16px; line-height: 1.45; }
  .sb-pay-summary { display: flex; gap: 22px; font-size: 13px; color: #6b6b66; margin-bottom: 10px; }
  .sb-pay-summary strong { color: #1e2d3d; }
  .sb-pay-subhead { font-size: 13px; font-weight: 700; color: #1e2d3d; margin: 22px 0 8px; }
  .sb-pay-subhead-note { font-weight: 400; color: #a0a09a; }

  .sb-pay-table { background: #fff; border: 0.5px solid #e6e3dd; border-radius: 12px; overflow: hidden; }
  .sb-pay-row { display: grid; grid-template-columns: 110px 1.4fr 110px 110px 110px 1fr; gap: 12px; padding: 11px 16px; align-items: center; }
  .sb-pay-out-row { grid-template-columns: 110px 1.4fr 1fr 110px 110px 1fr; }
  .sb-pay-bal-row { grid-template-columns: 1.6fr 120px 130px 120px; }
  .sb-pay-est-row { grid-template-columns: 1.6fr 120px 130px 90px 110px; }
  .sb-pay-bill-row { grid-template-columns: 1.6fr 1fr 150px 130px 80px 120px; }
  .sb-pay-row-head { font-size: 10px; text-transform: uppercase; letter-spacing: 0.12em; font-weight: 600; color: #8a8a85; border-bottom: 0.5px solid #e6e3dd; }
  .sb-pay-row-data { width: 100%; text-align: left; font: inherit; background: none; border: none; border-bottom: 0.5px solid #f1efeb; cursor: pointer; color: inherit; }
  .sb-pay-row-data:hover { background: #faf8f3; }
  .sb-pay-row-data:last-child, .sb-pay-row-data2:last-child { border-bottom: none; }
  .sb-pay-row-data2 { border-bottom: 0.5px solid #f1efeb; }
  .sb-pay-row .num { text-align: right; font-variant-numeric: tabular-nums; }
  .sb-pay-name { font-weight: 600; color: #1e2d3d; }
  .sb-pay-mono { font-family: 'JetBrains Mono', monospace; font-size: 12px; color: #6b6b66; }
  .sb-pay-amt { font-weight: 600; color: #1e2d3d; }
  .sb-pay-ref { color: #6b6b66; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .sb-pay-age { color: #6b6b66; }
  .sb-pay-age.stale { color: #b54040; font-weight: 600; }
  .sb-pay-empty { padding: 28px 16px; text-align: center; color: #8a8a85; font-size: 14px; }
  .sb-pay-bal-name, .sb-pay-contact, .sb-pay-bal-log {
    font: inherit; text-align: left; background: none; border: none; cursor: pointer; padding: 0;
  }
  .sb-pay-bal-name { font-weight: 600; color: #1e2d3d; }
  .sb-pay-bal-name:hover { color: #9A7209; }
  .sb-pay-contact, .sb-pay-bal-log {
    justify-self: end; font-size: 12px; font-weight: 600; color: #9A7209;
    border: 0.5px solid #d8c89a; border-radius: 6px; padding: 4px 12px; background: #fdf8ec;
  }
  .sb-pay-contact:hover, .sb-pay-bal-log:hover { background: #f7efd8; filter: brightness(0.98); }

  .sb-pay-backdrop { position: fixed; inset: 0; background: rgba(15,20,25,0.42); z-index: 1000; display: flex; align-items: center; justify-content: center; padding: 24px; }
  .sb-pay-modal { background: #fff; border-radius: 12px; box-shadow: 0 16px 48px rgba(15,20,25,0.24); max-width: 560px; width: 100%; padding: 26px 28px 22px; max-height: 88vh; overflow-y: auto; }
  .sb-pay-modal-title { font-size: 18px; font-weight: 600; color: #1e2d3d; margin: 0 0 16px; }
  .sb-pay-field { display: flex; flex-direction: column; gap: 5px; margin-bottom: 12px; }
  .sb-pay-field label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: #8a8a85; font-weight: 600; }
  .sb-pay-input { font: inherit; font-size: 14px; padding: 9px 12px; border: 0.5px solid #e6e3dd; border-radius: 8px; background: #fff; width: 100%; box-sizing: border-box; }
  .sb-pay-grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .sb-pay-order-results { display: flex; flex-direction: column; border: 0.5px solid #e6e3dd; border-radius: 8px; margin-top: 6px; overflow: hidden; }
  .sb-pay-order-result { display: flex; justify-content: space-between; align-items: center; gap: 10px; padding: 9px 12px; font: inherit; background: #fff; border: none; border-bottom: 0.5px solid #f1efeb; cursor: pointer; text-align: left; }
  .sb-pay-order-result:last-child { border-bottom: none; }
  .sb-pay-order-result:hover { background: #faf8f3; }
  .sb-pay-picked { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 12px 14px; background: #faf8f3; border: 0.5px solid #e6e3dd; border-radius: 8px; margin-bottom: 12px; }
  .sb-pay-picked-num { margin-top: 2px; }
  .sb-pay-change { font: inherit; font-size: 12px; color: #9A7209; background: none; border: none; cursor: pointer; text-decoration: underline; }
  .sb-pay-error { color: #b54040; font-size: 13px; padding: 8px 10px; background: #fbe5e5; border-radius: 8px; margin: 8px 0 0; }
  .sb-pay-confirm-note { font-size: 13px; color: #5e3a0e; background: #fbe5b8; border: 0.5px solid #b8842a; border-radius: 8px; padding: 9px 12px; margin: 10px 0 0; }
  .sb-pay-modal-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 18px; }
  .sb-pay-cancel { font: inherit; font-size: 14px; font-weight: 500; padding: 9px 18px; border-radius: 8px; border: 0.5px solid #e6e3dd; background: #fff; color: #6b6b66; cursor: pointer; }
  .sb-pay-confirm { font: inherit; font-size: 14px; font-weight: 600; padding: 9px 18px; border-radius: 8px; border: 0.5px solid transparent; background: #9A7209; color: #fff; cursor: pointer; }
  .sb-pay-confirm:disabled, .sb-pay-cancel:disabled { opacity: 0.6; cursor: not-allowed; }

  @media (max-width: 900px) {
    .sb-pay-cards { grid-template-columns: repeat(2, 1fr); }
    .sb-pay-row { grid-template-columns: 90px 1.2fr 90px; }
    .sb-pay-row > div:nth-child(4), .sb-pay-row > div:nth-child(5), .sb-pay-row > div:nth-child(6) { display: none; }
    .sb-pay-grid2 { grid-template-columns: 1fr; }
  }
`
