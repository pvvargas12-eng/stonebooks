// =============================================================================
// 📚 Stonebooks — Payments tab (B1)
// =============================================================================
// One ledger of every payment across all orders, plus a "Log payment" action.
// Payments are stored on orders.payments[] (the money source of truth) and
// written through recordOrderPayment — the SAME path OrderDetail uses — so the
// order balance, status, Profit rollups, and the A6 deposit-milestone auto-
// complete all reconcile with no double-counting. Legacy deposit/balance
// columns are synthesized into the list only when an order has no payments[]
// yet, so pre-refactor money still shows without being counted twice.
// =============================================================================

import { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from './lib/supabase'
import {
  fetchAllPaged, recordOrderPayment, fmtUSD, fmtDate, customerName,
  getCurrentStaffName, rowGrandTotal, rowTotalPaid,
} from './lib/stonebooksData'

const METHODS = [
  { code: 'check', label: 'Check' },
  { code: 'card',  label: 'Credit Card' },
  { code: 'zelle', label: 'Zelle' },
  { code: 'other', label: 'Other' },
]
const methodLabel = (m) => METHODS.find(x => x.code === m)?.label || (m ? m[0].toUpperCase() + m.slice(1) : '—')

// Order display name: stone/family name first (matches the Orders + Customers
// surfaces), customer record second.
function orderName(row) {
  if (row.primary_lastname && String(row.primary_lastname).trim()) return String(row.primary_lastname).trim()
  const cn = customerName(row.customer)
  if (cn && cn !== '—') return cn
  const d = Array.isArray(row.deceased) ? row.deceased.find(x => x && !x.isReserved && (x.firstName || x.lastName)) : null
  if (d) return [d.lastName, d.firstName].filter(Boolean).join(', ')
  return row.order_number || 'Unknown'
}

// Flatten an order row into its payment ledger rows. Prefers payments[]; falls
// back to the legacy deposit/balance columns when the array is empty (so the
// two are never summed together).
function paymentsOf(row) {
  const out = []
  const arr = Array.isArray(row.payments) ? row.payments : []
  if (arr.length > 0) {
    for (const p of arr) {
      if (!p || p.voided) continue
      if (!(p.locked ?? true)) continue        // drafts aren't money yet
      out.push({
        key: `${row.id}:${p.id}`, orderId: row.id, orderNumber: row.order_number,
        name: orderName(row), dateISO: p.receivedAt || p.createdAt || null,
        method: p.method, amount: Number(p.amount) || 0, ref: p.ref || '',
      })
    }
    return out
  }
  // Legacy fallback
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
  'id, order_number, status, payments, primary_lastname, deceased, ' +
  'deposit_amount, deposit_method, deposit_ref, deposit_received_at, ' +
  'balance_amount, balance_method, balance_ref, balance_received_at, ' +
  'pricing, add_ons, customer:customers(first_name, last_name)'

export default function PaymentsTab({ onOpenOrder }) {
  const [orders, setOrders] = useState(null)
  const [search, setSearch] = useState('')
  const [logOpen, setLogOpen] = useState(false)

  // D1 — archived orders never count toward the money ledger.
  const ordersQuery = () => supabase.from('orders').select(ORDER_SELECT)
    .or('archived.is.null,archived.eq.false').order('updated_at', { ascending: false })
  const load = useCallback(async () => {
    const rows = await fetchAllPaged(ordersQuery)
    setOrders(rows || [])
  }, [])
  // Initial load — set state from the async .then (not synchronously in the
  // effect body) with a cancelled guard, matching the OrderDetail pattern.
  useEffect(() => {
    let cancelled = false
    fetchAllPaged(ordersQuery).then(rows => { if (!cancelled) setOrders(rows || []) })
    return () => { cancelled = true }
  }, [])

  const rows = useMemo(() => {
    if (!orders) return []
    const all = orders.flatMap(paymentsOf)
    all.sort((a, b) => {
      const ta = a.dateISO ? new Date(a.dateISO).getTime() : 0
      const tb = b.dateISO ? new Date(b.dateISO).getTime() : 0
      return tb - ta
    })
    const needle = search.trim().toLowerCase()
    if (!needle) return all
    return all.filter(r => [r.name, r.orderNumber, methodLabel(r.method), r.ref]
      .filter(Boolean).join(' ').toLowerCase().includes(needle))
  }, [orders, search])

  const total = useMemo(() => rows.reduce((s, r) => s + r.amount, 0), [rows])

  return (
    <div className="sb-page sb-page-wide">
      <style>{PAY_CSS}</style>
      <div className="sb-page-head">
        <div className="sb-page-eyebrow">Money</div>
        <h1 className="sb-page-title">Payments</h1>
      </div>

      <div className="sb-pay-controls">
        <input
          className="sb-pay-search"
          placeholder="Search by name, order #, method, reference…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <button type="button" className="sb-pay-log-btn" onClick={() => setLogOpen(true)}>
          + Log payment
        </button>
      </div>

      <div className="sb-pay-summary">
        <span><strong>{rows.length}</strong> payment{rows.length === 1 ? '' : 's'}</span>
        <span>Total: <strong>{fmtUSD(total)}</strong></span>
      </div>

      <div className="sb-pay-table">
        <div className="sb-pay-row sb-pay-row-head">
          <div>Date</div>
          <div>Customer / Stone</div>
          <div>Order #</div>
          <div>Method</div>
          <div className="num">Amount</div>
          <div>Reference</div>
        </div>
        {orders === null ? (
          <div className="sb-pay-empty">Loading payments…</div>
        ) : rows.length === 0 ? (
          <div className="sb-pay-empty">No payments {search ? 'match your search' : 'logged yet'}.</div>
        ) : (
          rows.map(r => (
            <button
              type="button"
              key={r.key}
              className="sb-pay-row sb-pay-row-data"
              onClick={() => onOpenOrder?.(r.orderId)}
              title="Open order"
            >
              <div>{r.dateISO ? fmtDate(r.dateISO) : '—'}</div>
              <div className="sb-pay-name">{r.name}</div>
              <div className="sb-pay-mono">{r.orderNumber || '—'}</div>
              <div>{methodLabel(r.method)}</div>
              <div className="num sb-pay-amt">{fmtUSD(r.amount)}</div>
              <div className="sb-pay-ref">{r.ref || '—'}</div>
            </button>
          ))
        )}
      </div>

      {logOpen && (
        <LogPaymentModal
          orders={orders || []}
          onClose={() => setLogOpen(false)}
          onLogged={() => { setLogOpen(false); load() }}
        />
      )}
    </div>
  )
}

// ── Log payment modal ───────────────────────────────────────────────────────
function LogPaymentModal({ orders, onClose, onLogged }) {
  const [pick, setPick] = useState(null)        // selected order row
  const [orderSearch, setOrderSearch] = useState('')
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState('check')
  const [date, setDate] = useState(() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  })
  const [ref, setRef] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [confirm, setConfirm] = useState(false)

  const matches = useMemo(() => {
    const needle = orderSearch.trim().toLowerCase()
    if (!needle) return []
    return orders.filter(o => [orderName(o), o.order_number]
      .filter(Boolean).join(' ').toLowerCase().includes(needle)).slice(0, 8)
  }, [orders, orderSearch])

  const pickBalance = pick ? Math.max(0, rowGrandTotal(pick) - rowTotalPaid(pick)) : 0

  const submit = async () => {
    if (!pick) { setError('Pick an order first.'); return }
    const amt = Number(amount)
    if (!Number.isFinite(amt) || amt <= 0) { setError('Enter an amount greater than zero.'); return }
    if (!confirm) { setConfirm(true); setError(null); return }
    setBusy(true); setError(null)
    const createdBy = await getCurrentStaffName()
    const res = await recordOrderPayment(pick.id, {
      amount: amt, method, ref: ref.trim() || null, receivedAt: date, createdBy,
    })
    setBusy(false)
    if (!res.ok) { setError(res.error || 'Could not record the payment.'); setConfirm(false); return }
    onLogged()
  }

  return (
    <div className="sb-pay-backdrop" onClick={() => { if (!busy) onClose() }}>
      <div className="sb-pay-modal" role="dialog" aria-modal="true" aria-label="Log payment" onClick={e => e.stopPropagation()}>
        <h3 className="sb-pay-modal-title">Log a payment</h3>

        {!pick ? (
          <div className="sb-pay-field">
            <label>Order</label>
            <input
              className="sb-pay-input"
              placeholder="Search by family name or order #…"
              value={orderSearch}
              onChange={e => setOrderSearch(e.target.value)}
              autoFocus
            />
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
              {METHODS.map(m => <option key={m.code} value={m.code}>{m.label}</option>)}
            </select>
          </div>
          <div className="sb-pay-field">
            <label>Date received</label>
            <input className="sb-pay-input" type="date" value={date} onChange={e => setDate(e.target.value)} />
          </div>
          <div className="sb-pay-field">
            <label>Reference {method === 'zelle' ? '(Zelle confirmation #)' : '(check # / note)'}</label>
            <input className="sb-pay-input" value={ref} onChange={e => setRef(e.target.value)} placeholder="optional" />
          </div>
        </div>

        {error && <div className="sb-pay-error">{error}</div>}
        {confirm && !error && (
          <div className="sb-pay-confirm-note">
            Record {fmtUSD(Number(amount) || 0)} ({methodLabel(method)}) against {pick ? orderName(pick) : 'this order'}?
          </div>
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

const PAY_CSS = `
  .sb-pay-controls { display: flex; gap: 12px; align-items: center; margin-bottom: 14px; flex-wrap: wrap; }
  .sb-pay-search { flex: 1; min-width: 220px; font: inherit; font-size: 14px; padding: 9px 13px; border: 0.5px solid var(--sb-border, #e6e3dd); border-radius: 8px; background: #fff; }
  .sb-pay-log-btn { font: inherit; font-size: 13px; font-weight: 600; padding: 9px 16px; border: 0.5px solid transparent; border-radius: 8px; background: #9A7209; color: #fff; cursor: pointer; white-space: nowrap; }
  .sb-pay-log-btn:hover { filter: brightness(0.95); }
  .sb-pay-summary { display: flex; gap: 22px; font-size: 13px; color: #6b6b66; margin-bottom: 10px; }
  .sb-pay-summary strong { color: #1e2d3d; }

  .sb-pay-table { background: #fff; border: 0.5px solid #e6e3dd; border-radius: 12px; overflow: hidden; }
  .sb-pay-row { display: grid; grid-template-columns: 110px 1.4fr 110px 110px 110px 1fr; gap: 12px; padding: 11px 16px; align-items: center; }
  .sb-pay-row-head { font-size: 10px; text-transform: uppercase; letter-spacing: 0.12em; font-weight: 600; color: #8a8a85; border-bottom: 0.5px solid #e6e3dd; }
  .sb-pay-row-data { width: 100%; text-align: left; font: inherit; background: none; border: none; border-bottom: 0.5px solid #f1efeb; cursor: pointer; color: inherit; }
  .sb-pay-row-data:hover { background: #faf8f3; }
  .sb-pay-row-data:last-child { border-bottom: none; }
  .sb-pay-row .num { text-align: right; font-variant-numeric: tabular-nums; }
  .sb-pay-name { font-weight: 600; color: #1e2d3d; }
  .sb-pay-mono { font-family: 'JetBrains Mono', monospace; font-size: 12px; color: #6b6b66; }
  .sb-pay-amt { font-weight: 600; color: #1e2d3d; }
  .sb-pay-ref { color: #6b6b66; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .sb-pay-empty { padding: 28px 16px; text-align: center; color: #8a8a85; font-size: 14px; }

  .sb-pay-backdrop { position: fixed; inset: 0; background: rgba(15,20,25,0.42); z-index: 1000; display: flex; align-items: center; justify-content: center; padding: 24px; }
  .sb-pay-modal { background: #fff; border-radius: 12px; box-shadow: 0 16px 48px rgba(15,20,25,0.24); max-width: 560px; width: 100%; padding: 26px 28px 22px; max-height: 88vh; overflow-y: auto; }
  .sb-pay-modal-title { font-size: 18px; font-weight: 600; color: #1e2d3d; margin: 0 0 16px; }
  .sb-pay-field { display: flex; flex-direction: column; gap: 5px; margin-bottom: 12px; }
  .sb-pay-field label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: #8a8a85; font-weight: 600; }
  .sb-pay-input { font: inherit; font-size: 14px; padding: 9px 12px; border: 0.5px solid #e6e3dd; border-radius: 8px; background: #fff; width: 100%; }
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

  @media (max-width: 820px) {
    .sb-pay-row { grid-template-columns: 90px 1.2fr 90px; }
    .sb-pay-row > div:nth-child(4), .sb-pay-row > div:nth-child(5), .sb-pay-row > div:nth-child(6) { display: none; }
    .sb-pay-grid2 { grid-template-columns: 1fr; }
  }
`
