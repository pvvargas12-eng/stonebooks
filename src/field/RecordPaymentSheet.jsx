// =============================================================================
// RecordPaymentSheet — record a payment from the phone (2026-07-22)
// =============================================================================
// The Money screen's headline feature: pick the order (or arrive with one),
// amount + method + date, RECORD. Writes through recordOrderPayment — the SAME
// canonical path OrderDetail and the desktop Payments tab use (payments[] +
// legacy mirror + reactive paid_in_full + deposit milestone sync + concurrency
// guard). Field doctrine: no confirm dialog, every write offers the 8s undo —
// undo VOIDS the payment (money records are append-only; the trail stays
// whole) and the reactive status logic reverts paid_in_full on its own.
import { useMemo, useState } from 'react'
import {
  recordOrderPayment, voidOrderPayment, rowBalanceDue, fmtUSD,
  getActiveStaffUser, logOrderActivity,
} from '../lib/stonebooksData'
import { pokePushSender } from '../lib/pushPoke'
import { familyNameOf, todayISO } from './fieldShared'

const MONO = '"JetBrains Mono", Consolas, monospace'

const METHODS = [
  { code: 'check', label: 'Check' },
  { code: 'cash',  label: 'Cash' },
  { code: 'zelle', label: 'Zelle' },
  { code: 'card',  label: 'Card' },
  { code: 'ach',   label: 'ACH' },
  { code: 'other', label: 'Other' },
]
const REF_LABEL = { check: 'Check # (required)', zelle: 'Zelle confirmation #', card: 'Last 4 (optional)' }

// `order` preselects (owner order panel); otherwise `orders` feeds the picker
// (Money screen hands over its open-orders fetch — no second query).
export default function RecordPaymentSheet({ order = null, orders = null, undo, onClose, onRecorded }) {
  const [picked, setPicked] = useState(order)
  const [q, setQ] = useState('')
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState('check')
  const [ref, setRef] = useState('')
  const [date, setDate] = useState(() => todayISO())
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  const balance = picked ? rowBalanceDue(picked) : 0

  const results = useMemo(() => {
    if (picked || !Array.isArray(orders)) return []
    const norm = q.trim().toLowerCase()
    const rows = orders
      .map(o => ({ o, bal: rowBalanceDue(o) }))
      .filter(({ o, bal }) => {
        if (!norm) return bal > 0
        const last = String(o.primary_lastname || '').toLowerCase()
        const num = String(o.order_number || '').toLowerCase()
        return last.includes(norm) || num.includes(norm)
      })
    rows.sort((a, z) => z.bal - a.bal)
    return rows.slice(0, 12)
  }, [orders, q, picked])

  const record = async () => {
    if (busy || !picked) return
    const amt = Number(amount)
    if (!Number.isFinite(amt) || amt <= 0) { undo.showError('Enter the amount.'); return }
    if (method === 'check' && !ref.trim()) { undo.showError('Check number, please — same rule as the desk.'); return }
    setBusy(true)
    const staff = getActiveStaffUser()
    const priorReal = (Array.isArray(picked.payments) ? picked.payments : [])
      .filter(p => p && !p.voided && (p.locked ?? true)).length
    const res = await recordOrderPayment(picked.id, {
      amount: amt, method, ref: ref.trim() || null, receivedAt: date,
      note: note.trim() || null, createdBy: staff,
      type: priorReal === 0 ? 'deposit' : 'final',
    })
    setBusy(false)
    if (!res.ok) { undo.showError(res.error || 'Could not record the payment.'); return }
    logOrderActivity(picked.id, {
      type: 'activity',
      note: `Payment recorded: ${fmtUSD(amt)} (${method}) — field app`,
      actor: staff,
    }).catch(() => {})
    try { pokePushSender() } catch { /* owner payment push rides the next sweep */ }
    onClose()
    onRecorded?.(res)
    const fam = familyNameOf(picked)
    const paidOff = balance > 0 && res.balance === 0
    undo.show(
      `${fmtUSD(amt)} recorded${paidOff ? ' — PAID IN FULL' : ''} — ${fam}`,
      async () => {
        await voidOrderPayment(picked.id, res.payment.id, {
          reason: 'Undone from the field app (8-second undo)', actor: staff,
        }).catch(() => {})
        onRecorded?.(null)
      },
    )
  }

  return (
    <>
      <div className="fl-sheet-scrim" onClick={onClose} />
      <div className="fl-sheet">
        <div className="fl-sheet-grab" />
        <div className="fl-sheet-title">Record a payment</div>

        {!picked && (
          <>
            <input className="fl-input" autoFocus placeholder="Find the order — last name or number"
              value={q} onChange={e => setQ(e.target.value)} />
            <div style={{ maxHeight: 300, overflowY: 'auto', marginTop: 8 }}>
              {results.length === 0 && (
                <div className="fl-empty" style={{ padding: '14px 0' }}>
                  {q.trim() ? 'No orders match.' : 'Nobody owes a dollar.'}
                </div>
              )}
              {results.map(({ o, bal }) => (
                <button key={o.id} type="button" className="fl-rowline"
                  onClick={() => { setPicked(o); setAmount(bal > 0 ? String(bal.toFixed(2)) : '') }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14.5, fontWeight: 700, color: '#16150F', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {familyNameOf(o)}
                      {o.order_number && <span style={{ color: '#6B6456', fontWeight: 600 }}> &#183; {o.order_number}</span>}
                    </div>
                    <div style={{ fontSize: 11.5, color: '#8A7F6C', marginTop: 2 }}>
                      {bal > 0 ? <>Owes <span style={{ fontFamily: MONO, fontWeight: 700 }}>{fmtUSD(bal)}</span></> : 'Paid up'}
                    </div>
                  </div>
                  <span className="fl-chev">&#8250;</span>
                </button>
              ))}
            </div>
          </>
        )}

        {picked && (
          <>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 4 }}>
              <div style={{ flex: 1, minWidth: 0, fontSize: 15, fontWeight: 800, color: '#16150F', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {familyNameOf(picked)}
                {picked.order_number && <span style={{ color: '#6B6456', fontWeight: 600 }}> &#183; {picked.order_number}</span>}
              </div>
              {!order && (
                <button type="button" className="fl-verb" onClick={() => setPicked(null)}>CHANGE</button>
              )}
            </div>
            <div style={{ fontSize: 12, color: '#8A7F6C', marginBottom: 10 }}>
              Balance <span style={{ fontFamily: MONO, fontWeight: 700, color: '#16150F' }}>{fmtUSD(balance)}</span>
            </div>

            <div className="fl-label">Amount</div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input className="fl-input" style={{ fontFamily: MONO, fontSize: 20, fontWeight: 700 }}
                type="number" inputMode="decimal" min="0" step="0.01" placeholder="0.00"
                value={amount} onChange={e => setAmount(e.target.value)} />
              {balance > 0 && (
                <button type="button" className="fl-chip-btn" style={{ flexShrink: 0 }}
                  onClick={() => setAmount(String(balance.toFixed(2)))}>
                  Full balance
                </button>
              )}
            </div>

            <div className="fl-label">How it came in</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {METHODS.map(m => (
                <button key={m.code} type="button"
                  className={`fl-chip-btn${method === m.code ? ' on' : ''}`}
                  onClick={() => setMethod(m.code)}>
                  {m.label}
                </button>
              ))}
            </div>

            {REF_LABEL[method] && (
              <>
                <div className="fl-label">{REF_LABEL[method]}</div>
                <input className="fl-input" inputMode={method === 'card' ? 'numeric' : 'text'}
                  value={ref} onChange={e => setRef(e.target.value)} />
              </>
            )}

            <div className="fl-label">Received</div>
            <input type="date" className="fl-input" value={date} onChange={e => setDate(e.target.value)} />

            <div className="fl-label">Note (optional)</div>
            <input className="fl-input" placeholder="e.g. dropped off by the family"
              value={note} onChange={e => setNote(e.target.value)} />

            <div style={{ display: 'flex', gap: 8, marginTop: 18 }}>
              <button type="button" className="fl-btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
              <button type="button" className="fl-btn-gold" onClick={record}
                disabled={busy || !(Number(amount) > 0)}>
                {busy ? 'Recording…' : 'Record payment'}
              </button>
            </div>
          </>
        )}
      </div>
    </>
  )
}
