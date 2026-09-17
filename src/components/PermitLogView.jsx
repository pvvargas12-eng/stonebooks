// =============================================================================
// PermitLogView — Permit Builder › Permit Log (PERMIT-LOG, 2026-09-17)
// =============================================================================
// Paul: "in permit log i want everything logged this is the spreadsheet they
// still use... click on the name and it would take me to their order. to
// populate it start with all of the permits that have been logged already in
// stonebooks both open and closed.. only ones with paid orders and payments
// to cemeteries that have been paid."
//
// The old spreadsheet (Permit Log.xlsx, one sheet per year) is: Cemetery |
// Name | Job | Amount | Method (ck#) | Date. Stonebooks already HOLDS that
// truth: every filed permit syncs an outgoing payment (category Permits,
// order_id + check# reference + paid date). So this log is DERIVED — it can
// never drift from the money, it reaches back through every year already in
// the system (open AND closed orders), and every new filed permit appears by
// itself. Filter honors Paul's rule: the cemetery payment exists (that's the
// row) AND the order has money in (rowTotalPaid > 0); unlinked cemetery
// payments still show (they're real log lines) without a click-through.
// =============================================================================
import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import {
  listOutgoingPayments, rowTotalPaid, fmtUSD, properName, customerName,
  permitStatusLabel, permitStatusTone, PERMIT_STATUS_OPTIONS, setOrderPermit,
} from '../lib/stonebooksData'
import { downloadReportCSV } from '../lib/reportsData'

// Paul's vocabulary (2026-09-17): "New Stone (not monument), Insc. (not LTT),
// Bronze Services (not Brnz)".
const SERVICE_SHORT = {
  NEW_STONE: 'New Stone', BRONZE: 'Bronze Services', INSCRIPTION: 'Insc.', ACID_WASH: 'Acid wash',
  REPAIR: 'Repair', MAUSOLEUM: 'Mausoleum', MAUSOLEUM_DOOR: 'Door', CIVIC_MEMORIAL: 'Civic', ADD_PHOTO: 'Photo', OTHER: 'Other',
}
const jobLabel = (o) => {
  const st = o?.service_types
  if (!Array.isArray(st) || !st.length) return '—'
  return st.map(s => SERVICE_SHORT[s]).filter(Boolean).join(' + ') || '—'
}
const isPermitRow = (p) => p.source_permit_key || String(p.category || '').toLowerCase() === 'permits'

export default function PermitLogView({ onOpenOrderDetail }) {
  const [rows, setRows] = useState(null)
  const [orders, setOrders] = useState(new Map())
  const [err, setErr] = useState(null)
  const [q, setQ] = useState('')
  const [year, setYear] = useState('')
  const [savingPermit, setSavingPermit] = useState(null)   // order id mid-write

  // Editable permit status (Paul 2026-09-17: "i must be able to change permit
  // to approved") — same setOrderPermit chokepoint the Orders table uses, with
  // an auto approved-date stamp. Optimistic map update, revert on failure.
  const changePermit = async (orderId, code) => {
    if (!orderId || savingPermit) return
    const prev = orders.get(orderId)
    if (!prev || prev.permit_status === code) return
    setSavingPermit(orderId)
    setOrders(m => { const n = new Map(m); n.set(orderId, { ...prev, permit_status: code }); return n })
    const r = await setOrderPermit(orderId, { permit_status: code })
    setSavingPermit(null)
    if (!r.ok) {
      setOrders(m => { const n = new Map(m); n.set(orderId, prev); return n })
      setErr(r.error || 'Could not update the permit status')
    }
  }

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const all = await listOutgoingPayments()
        const permits = (all || []).filter(isPermitRow)
        if (cancelled) return
        setRows(permits)
        const ids = [...new Set(permits.map(p => p.order_id).filter(Boolean))]
        const found = new Map()
        for (let i = 0; i < ids.length; i += 100) {
          const { data } = await supabase.from('orders')
            .select('id, order_number, primary_lastname, status, archived, service_types, permit_status, payments, deposit_amount, balance_amount, customer:customers(first_name, last_name), cemetery:cemeteries(name)')
            .in('id', ids.slice(i, i + 100))
          for (const o of (data || [])) found.set(o.id, o)
        }
        if (!cancelled) setOrders(found)
      } catch (e) {
        if (!cancelled) { setErr(e?.message || 'Could not load the permit log'); setRows([]) }
      }
    })()
    return () => { cancelled = true }
  }, [])

  // The log: cemetery paid (the row exists) + the ORDER has money in.
  const log = useMemo(() => {
    if (!rows) return null
    return rows
      .map(p => {
        const o = p.order_id ? orders.get(p.order_id) : null
        return {
          id: p.id,
          date: p.paid_date || '',
          name: o ? properName(o.primary_lastname || customerName(o.customer) || '—') : (p.payee || '—'),
          orderId: o?.id || null,
          orderNumber: o?.order_number || '',
          cemetery: o?.cemetery?.name || (o ? '—' : p.payee || '—'),
          job: jobLabel(o),
          amount: Number(p.amount) || 0,
          method: [p.method, p.reference].filter(Boolean).join(' '),
          permitStatus: o?.permit_status || null,
          closed: o ? ['closed', 'cancelled'].includes(o.status) : false,
          _paidOrder: o ? rowTotalPaid(o) > 0 : true,   // unlinked rows stay — they're real ledger lines
        }
      })
      .filter(r => r._paidOrder)
      .sort((a, b) => String(b.date).localeCompare(String(a.date)))
  }, [rows, orders])

  const years = useMemo(() => {
    const s = new Set((log || []).map(r => String(r.date).slice(0, 4)).filter(y => y.length === 4))
    return [...s].sort((a, b) => b.localeCompare(a))
  }, [log])

  const shown = useMemo(() => {
    if (!log) return []
    const norm = q.trim().toLowerCase()
    return log.filter(r => {
      if (year && !String(r.date).startsWith(year)) return false
      if (!norm) return true
      return [r.name, r.cemetery, r.method, r.orderNumber, r.job].filter(Boolean).join(' ').toLowerCase().includes(norm)
    })
  }, [log, q, year])

  const totals = useMemo(() => shown.reduce((a, r) => ({ n: a.n + 1, usd: a.usd + r.amount }), { n: 0, usd: 0 }), [shown])

  const exportCsv = () => {
    downloadReportCSV(
      `permit-log${year ? `-${year}` : ''}.csv`,
      ['Date', 'Name', 'Order #', 'Cemetery', 'Job', 'Amount', 'Method'],
      shown.map(r => [r.date, r.name, r.orderNumber, r.cemetery, r.job, r.amount.toFixed(2), r.method]),
    )
  }

  return (
    <div className="plog">
      <style>{CSS}</style>
      <div className="plog-head">
        <div>
          <h2 className="pbt-h2">Permit Log</h2>
          <div className="plog-sub">
            Every cemetery permit payment on the books — open and closed orders, straight from the money ledger.
            The spreadsheet, retired. Click a name to open the order.
          </div>
        </div>
        <button type="button" className="plog-csv" onClick={exportCsv} disabled={!shown.length}>Export CSV</button>
      </div>

      <div className="plog-bar">
        <input type="search" className="pbt-input plog-search" value={q} onChange={e => setQ(e.target.value)}
          placeholder="Search — name, cemetery, check #, order number…" />
        <div className="plog-years">
          <button type="button" className={`plog-chip${year === '' ? ' on' : ''}`} onClick={() => setYear('')}>All years</button>
          {years.map(y => (
            <button type="button" key={y} className={`plog-chip${year === y ? ' on' : ''}`} onClick={() => setYear(v => (v === y ? '' : y))}>{y}</button>
          ))}
        </div>
      </div>

      {err && <div className="plog-err">{err}</div>}
      {log === null ? (
        <div className="pbt-empty">Reading the permit ledger…</div>
      ) : shown.length === 0 ? (
        <div className="pbt-empty">{q || year ? 'Nothing matches.' : 'No permit payments on the books yet — filing a permit with a fee logs it here automatically.'}</div>
      ) : (
        <table className="plog-table">
          <thead>
            <tr><th>Date</th><th>Name</th><th>Cemetery</th><th>Job</th><th className="n">Amount</th><th>Method</th><th>Permit</th></tr>
          </thead>
          <tbody>
            {shown.map(r => (
              <tr key={r.id}>
                <td className="mono">{r.date || '—'}</td>
                <td>
                  {r.orderId ? (
                    <button type="button" className="plog-name" onClick={() => onOpenOrderDetail?.(r.orderId)} title={`Open ${r.orderNumber || 'the order'}`}>
                      {r.name}{r.closed && <span className="plog-closed">closed</span>}
                    </button>
                  ) : <span className="plog-name-plain">{r.name}</span>}
                </td>
                <td>{r.cemetery}</td>
                <td>{r.job}</td>
                <td className="n mono">{fmtUSD(r.amount)}</td>
                <td className="mono">{r.method || '—'}</td>
                <td>
                  {r.orderId ? (
                    <select
                      className={`plog-permit plog-permit-${permitStatusTone(r.permitStatus || 'unknown')}`}
                      value={PERMIT_STATUS_OPTIONS.some(o => o.code === r.permitStatus) ? r.permitStatus : ''}
                      disabled={savingPermit === r.orderId}
                      onChange={e => changePermit(r.orderId, e.target.value)}
                      title="Change the order's permit status right here"
                    >
                      {!PERMIT_STATUS_OPTIONS.some(o => o.code === r.permitStatus) && (
                        <option value="" disabled>{permitStatusLabel(r.permitStatus)}</option>
                      )}
                      {PERMIT_STATUS_OPTIONS.map(o => <option key={o.code} value={o.code}>{o.label}</option>)}
                    </select>
                  ) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={4}>Total — {totals.n} permit{totals.n === 1 ? '' : 's'}{year ? ` in ${year}` : ''}</td>
              <td className="n mono">{fmtUSD(totals.usd)}</td>
              <td colSpan={2}></td>
            </tr>
          </tfoot>
        </table>
      )}
    </div>
  )
}

const CSS = `
  .plog { background: var(--sb-surface, #fff); border: 0.5px solid var(--sb-border, #E2D8C6); border-radius: 14px; padding: 18px 20px; overflow-x: auto; }
  .plog-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 14px; flex-wrap: wrap; }
  .plog-sub { font-size: 12.5px; color: #8a8a85; margin: 3px 0 12px; max-width: 640px; }
  .plog-csv { font: inherit; font-size: 12.5px; font-weight: 700; padding: 6px 14px; border-radius: 8px;
    border: 1px solid #C9A468; background: none; color: #9A7209; cursor: pointer; }
  .plog-csv:hover:not(:disabled) { background: #9A7209; border-color: #9A7209; color: #fff; }
  .plog-csv:disabled { opacity: 0.5; cursor: default; }
  .plog-bar { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 12px; }
  .plog-search { max-width: 380px; }
  .plog-years { display: flex; gap: 6px; flex-wrap: wrap; }
  .plog-chip { font: inherit; font-size: 12px; font-weight: 700; padding: 4px 12px; border-radius: 999px;
    border: 1px solid var(--sb-border, #E2D8C6); background: none; color: #6a6a66; cursor: pointer; }
  .plog-chip.on { background: #16150F; border-color: #16150F; color: #C9A468; }
  .plog-err { font-size: 12.5px; color: #B3261E; background: rgba(179,38,30,0.08); border-radius: 8px; padding: 7px 10px; margin-bottom: 10px; }
  .plog-table { width: 100%; border-collapse: collapse; font-size: 13.5px; }
  .plog-table th { text-align: left; font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em;
    color: #8a8a85; padding: 8px 10px; border-bottom: 1px solid var(--sb-border, #E2D8C6); }
  .plog-table td { padding: 8px 10px; border-bottom: 0.5px solid #f0ece2; vertical-align: middle; }
  .plog-table .n { text-align: right; white-space: nowrap; }
  .plog-table .mono { font-family: var(--sb-font-mono, 'JetBrains Mono'), monospace; font-size: 12.5px; white-space: nowrap; }
  .plog-name { font: inherit; font-weight: 700; color: #16150F; background: none; border: none; padding: 0; cursor: pointer;
    text-decoration: underline; text-decoration-color: #C9A468; text-underline-offset: 2px; }
  .plog-name:hover { color: #9A7209; }
  .plog-name-plain { font-weight: 700; }
  .plog-closed { font-size: 9px; font-weight: 800; letter-spacing: 0.05em; text-transform: uppercase;
    color: #6a6a66; background: #f0eee9; border-radius: 4px; padding: 1px 5px; margin-left: 7px; }
  .plog-table tfoot td { border-top: 2px solid var(--sb-border, #E2D8C6); border-bottom: none; font-weight: 800; }
  .plog-permit { font: inherit; font-size: 12px; font-weight: 700; padding: 3px 8px; border-radius: 999px; cursor: pointer; max-width: 100%; }
  .plog-permit:disabled { opacity: 0.6; cursor: default; }
  .plog-permit-good    { background: rgba(29,158,117,0.12); border: 1px solid rgba(29,158,117,0.5); color: #15724a; }
  .plog-permit-info    { background: rgba(29,111,168,0.10); border: 1px solid rgba(29,111,168,0.45); color: #1D6FA8; }
  .plog-permit-warn    { background: rgba(183,121,31,0.12); border: 1px solid rgba(183,121,31,0.5); color: #8a5a12; }
  .plog-permit-bad     { background: rgba(179,38,30,0.10); border: 1px solid rgba(179,38,30,0.45); color: #B3261E; }
  .plog-permit-neutral { background: #f0eee9; border: 1px solid #d8d6d1; color: #6a6a66; }
`
