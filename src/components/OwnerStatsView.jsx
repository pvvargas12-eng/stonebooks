// =============================================================================
// OwnerStatsView — Reports › Owner stats (STATS-1, 2026-09-17)
// =============================================================================
// Paul: "this reports is trash, I want stats on jobs Sales by month week year,
// by type. How many orders complete by month week year... how many active
// orders do we have by type stuff like that true data that i can use as an
// owner."
//
// One surface, three truths, zero derived cleverness:
//   • ACTIVE NOW — signed + money down, nothing terminal; counted per service
//     type with MULTI-membership (a New stone + Acid wash order counts under
//     both — the standing Dziamba rule).
//   • SALES — orders by the date the CONTRACT WAS SIGNED (count + contract $
//     from the line-item engine), bucketed by week / month / year.
//   • COMPLETED — orders whose install/completion milestone went DONE, dated
//     by that milestone's own status_date, same buckets.
// The type chips re-slice everything on the page. CSV export per table.
// =============================================================================
import { useState, useMemo } from 'react'
import { rowGrandTotal, rowTotalPaid, rowBalanceDue, fmtUSD } from '../lib/stonebooksData'
import { downloadReportCSV } from '../lib/reportsData'

const INSTALL_KEYS = ['installed', 'door_installed', 'work_completed']
const LEAD_STATUSES = new Set(['draft', 'scoping', 'quoted'])
const TERMINAL_STATUSES = new Set(['closed', 'cancelled'])

const SERVICE_LABELS = {
  NEW_STONE: 'New stone', BRONZE: 'Bronze', INSCRIPTION: 'Inscription',
  ACID_WASH: 'Acid wash', REPAIR: 'Repair', MAUSOLEUM: 'Mausoleum',
  MAUSOLEUM_DOOR: 'Doors', CIVIC_MEMORIAL: 'Civic', ADD_PHOTO: 'Photo', OTHER: 'Other',
}
const servicesOf = (o) => {
  const st = o?.service_types
  return Array.isArray(st) && st.length ? st.filter(s => SERVICE_LABELS[s]) : ['OTHER']
}

// ── Period bucketing (local time, Monday weeks) ─────────────────────────────
const MON = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); const wd = (x.getDay() + 6) % 7; x.setDate(x.getDate() - wd); return x }
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
function periodKey(iso, gran) {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return null
  if (gran === 'year') return String(d.getFullYear())
  if (gran === 'month') return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  const m = MON(d)
  return `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}-${String(m.getDate()).padStart(2, '0')}`
}
function periodLabel(key, gran) {
  if (gran === 'year') return key
  if (gran === 'month') { const [y, m] = key.split('-'); return `${MONTHS[Number(m) - 1]} ${y}` }
  const [y, m, d] = key.split('-')
  return `wk of ${Number(m)}/${Number(d)}/${String(y).slice(2)}`
}
// The last N period keys ending at `now`, newest first.
function lastPeriods(now, gran, n) {
  const out = []
  if (gran === 'year') {
    for (let i = 0; i < n; i++) out.push(String(now.getFullYear() - i))
  } else if (gran === 'month') {
    let y = now.getFullYear(), m = now.getMonth()
    for (let i = 0; i < n; i++) { out.push(`${y}-${String(m + 1).padStart(2, '0')}`); m--; if (m < 0) { m = 11; y-- } }
  } else {
    const cur = MON(now)
    for (let i = 0; i < n; i++) {
      const d = new Date(cur.getTime() - i * 7 * 86400000)
      out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`)
    }
  }
  return out
}

export default function OwnerStatsView({ bundle, now }) {
  const [gran, setGran] = useState('month')       // 'week' | 'month' | 'year'
  const [typeFilter, setTypeFilter] = useState('') // '' = all

  const orders = bundle?.orders || []
  const jobs = bundle?.jobs || []

  // Completion date per ORDER — the earliest done install-key milestone's own
  // status_date across the order's jobs (the honest "we finished it" date).
  const completionByOrder = useMemo(() => {
    const m = new Map()
    for (const j of jobs) {
      const oid = j.order_id || j.order?.id
      if (!oid) continue
      for (const ms of (j.milestones || [])) {
        if (!INSTALL_KEYS.includes(ms.milestone_key) || ms.status !== 'done' || !ms.status_date) continue
        const prev = m.get(oid)
        if (!prev || ms.status_date < prev) m.set(oid, ms.status_date)
      }
    }
    return m
  }, [jobs])

  const matchesType = (o) => !typeFilter || servicesOf(o).includes(typeFilter)

  // ── ACTIVE NOW — signed + money down, nothing terminal ────────────────────
  const active = useMemo(() => orders.filter(o =>
    !o.archived && !LEAD_STATUSES.has(o.status) && !TERMINAL_STATUSES.has(o.status)
    && o.signed_at && rowTotalPaid(o) > 0), [orders])
  const activeByType = useMemo(() => {
    const m = new Map()
    for (const o of active) for (const s of servicesOf(o)) {
      const e = m.get(s) || { count: 0, owed: 0 }
      e.count++; e.owed += Math.max(0, rowBalanceDue(o))
      m.set(s, e)
    }
    return [...m.entries()].sort((a, b) => b[1].count - a[1].count)
  }, [active])
  const activeFiltered = useMemo(() => active.filter(matchesType), [active, typeFilter])  // eslint-disable-line react-hooks/exhaustive-deps
  const activeOwed = useMemo(() => activeFiltered.reduce((s, o) => s + Math.max(0, rowBalanceDue(o)), 0), [activeFiltered])

  // ── SALES + COMPLETED per period ───────────────────────────────────────────
  const table = useMemo(() => {
    const keys = lastPeriods(now, gran, gran === 'year' ? 6 : 12)
    const rows = new Map(keys.map(k => [k, { key: k, sales: 0, salesUsd: 0, completed: 0 }]))
    for (const o of orders) {
      if (!matchesType(o)) continue
      if (o.signed_at) {
        const k = periodKey(o.signed_at, gran)
        const r = k && rows.get(k)
        if (r) { r.sales++; r.salesUsd += rowGrandTotal(o) || 0 }
      }
      const doneAt = completionByOrder.get(o.id)
      if (doneAt) {
        const k = periodKey(doneAt, gran)
        const r = k && rows.get(k)
        if (r) r.completed++
      }
    }
    return keys.map(k => rows.get(k))
  }, [orders, completionByOrder, gran, now, typeFilter])  // eslint-disable-line react-hooks/exhaustive-deps

  const totals = useMemo(() => table.reduce((a, r) => ({
    sales: a.sales + r.sales, salesUsd: a.salesUsd + r.salesUsd, completed: a.completed + r.completed,
  }), { sales: 0, salesUsd: 0, completed: 0 }), [table])

  const exportCsv = () => {
    downloadReportCSV(
      `owner-stats-${gran}${typeFilter ? `-${typeFilter.toLowerCase()}` : ''}.csv`,
      ['Period', 'New sales', 'Sales $', 'Avg sale $', 'Completed'],
      table.map(r => [periodLabel(r.key, gran), r.sales, r.salesUsd.toFixed(2), r.sales ? (r.salesUsd / r.sales).toFixed(2) : '', r.completed]),
    )
  }

  const maxSalesUsd = Math.max(1, ...table.map(r => r.salesUsd))

  return (
    <div className="ost">
      <style>{CSS}</style>

      {/* Type chips re-slice EVERYTHING on the page (multi-membership). */}
      <div className="ost-chips">
        <button type="button" className={`ost-chip${typeFilter === '' ? ' on' : ''}`} onClick={() => setTypeFilter('')}>All types</button>
        {Object.keys(SERVICE_LABELS).filter(s => activeByType.some(([t]) => t === s) || orders.some(o => servicesOf(o).includes(s))).map(s => (
          <button type="button" key={s} className={`ost-chip${typeFilter === s ? ' on' : ''}`}
            title="Combined orders count under every type they carry"
            onClick={() => setTypeFilter(f => (f === s ? '' : s))}>{SERVICE_LABELS[s]}</button>
        ))}
      </div>

      {/* ACTIVE NOW */}
      <div className="ost-cards">
        <div className="ost-card ost-card-big">
          <div className="ost-card-l">Active orders{typeFilter ? ` — ${SERVICE_LABELS[typeFilter]}` : ''}</div>
          <div className="ost-card-v">{activeFiltered.length}</div>
          <div className="ost-card-s">signed · money down · not closed</div>
        </div>
        <div className="ost-card ost-card-big">
          <div className="ost-card-l">Owed on them</div>
          <div className="ost-card-v">{fmtUSD(activeOwed)}</div>
          <div className="ost-card-s">open balances on that work</div>
        </div>
        {activeByType.map(([s, e]) => (
          <button type="button" key={s} className={`ost-card ost-card-type${typeFilter === s ? ' on' : ''}`}
            onClick={() => setTypeFilter(f => (f === s ? '' : s))}>
            <div className="ost-card-l">{SERVICE_LABELS[s]}</div>
            <div className="ost-card-v">{e.count}</div>
            <div className="ost-card-s">owed {fmtUSD(e.owed)}</div>
          </button>
        ))}
      </div>

      {/* SALES + COMPLETED trend */}
      <div className="ost-panel">
        <div className="ost-panel-head">
          <span className="ost-panel-title">Sales & completions{typeFilter ? ` — ${SERVICE_LABELS[typeFilter]}` : ''}</span>
          <div className="ost-grans">
            {[['week', 'By week'], ['month', 'By month'], ['year', 'By year']].map(([code, label]) => (
              <button type="button" key={code} className={`ost-chip${gran === code ? ' on' : ''}`} onClick={() => setGran(code)}>{label}</button>
            ))}
          </div>
          <button type="button" className="ost-csv" onClick={exportCsv}>Export CSV</button>
        </div>
        <div className="ost-hint">
          Sales = contracts SIGNED in the period (count + contract total). Completed = the install/completion
          milestone went done in the period. Newest first.
        </div>
        <table className="ost-table">
          <thead>
            <tr><th>Period</th><th className="n">New sales</th><th className="n">Sales $</th><th className="bar" aria-hidden="true"></th><th className="n">Avg sale</th><th className="n">Completed</th></tr>
          </thead>
          <tbody>
            {table.map(r => (
              <tr key={r.key}>
                <td className="p">{periodLabel(r.key, gran)}</td>
                <td className="n">{r.sales || '—'}</td>
                <td className="n money">{r.salesUsd ? fmtUSD(r.salesUsd) : '—'}</td>
                <td className="bar"><i style={{ width: `${Math.round((r.salesUsd / maxSalesUsd) * 100)}%` }} /></td>
                <td className="n">{r.sales ? fmtUSD(Math.round(r.salesUsd / r.sales)) : '—'}</td>
                <td className="n">{r.completed || '—'}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td className="p">Total ({gran === 'year' ? 'last 6 years' : gran === 'month' ? 'last 12 months' : 'last 12 weeks'})</td>
              <td className="n">{totals.sales}</td>
              <td className="n money">{fmtUSD(totals.salesUsd)}</td>
              <td className="bar"></td>
              <td className="n">{totals.sales ? fmtUSD(Math.round(totals.salesUsd / totals.sales)) : '—'}</td>
              <td className="n">{totals.completed}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}

const CSS = `
  .ost-chips { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 14px; }
  .ost-chip { font: inherit; font-size: 12.5px; font-weight: 600; padding: 5px 14px; border-radius: 999px;
    border: 1px solid var(--sb-border, #E2D8C6); background: var(--sb-surface, #fff); color: #6a6a66; cursor: pointer; }
  .ost-chip:hover { border-color: #C9A468; color: #16150F; }
  .ost-chip.on { background: #16150F; border-color: #16150F; color: #C9A468; font-weight: 700; }
  /* Overflow doctrine (Paul 2026-09-17: "i hate seeing words outside of the
     boxes"): cards clip, money never leaks — wide enough for $XXX,XXX.XX at
     the value size, and the value ellipsizes rather than escapes. */
  .ost-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 10px; margin-bottom: 16px; }
  .ost-card { background: var(--sb-surface, #fff); border: 0.5px solid var(--sb-border, #E2D8C6); border-radius: 12px; padding: 12px 14px; text-align: left; font: inherit; min-width: 0; overflow: hidden; }
  .ost-card-big { border-left: 3px solid #9A7209; }
  .ost-card-type { cursor: pointer; }
  .ost-card-type:hover { border-color: #C9A468; }
  .ost-card-type.on { border-color: #9A7209; box-shadow: inset 0 0 0 1px #9A7209; }
  .ost-card-l { font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: #8a8a85; }
  .ost-card-v { font-family: var(--sb-font-mono, 'JetBrains Mono'), monospace; font-size: 21px; font-weight: 700; color: #16150F; margin: 3px 0 2px;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-variant-numeric: tabular-nums; }
  .ost-card-s { font-size: 11.5px; color: #8a8a85; }
  .ost-panel { background: var(--sb-surface, #fff); border: 0.5px solid var(--sb-border, #E2D8C6); border-radius: 14px; padding: 16px 18px; overflow-x: auto; }
  .ost-panel-head { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 4px; }
  .ost-panel-title { font-size: 14px; font-weight: 800; letter-spacing: 0.04em; text-transform: uppercase; }
  .ost-grans { display: flex; gap: 6px; margin-left: auto; }
  .ost-csv { font: inherit; font-size: 12px; font-weight: 700; padding: 5px 12px; border-radius: 8px;
    border: 1px solid #C9A468; background: none; color: #9A7209; cursor: pointer; }
  .ost-csv:hover { background: #9A7209; border-color: #9A7209; color: #fff; }
  .ost-hint { font-size: 12px; color: #8a8a85; margin-bottom: 10px; }
  .ost-table { width: 100%; border-collapse: collapse; font-size: 13.5px; }
  .ost-table th { text-align: left; font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em;
    color: #8a8a85; padding: 7px 10px; border-bottom: 1px solid var(--sb-border, #E2D8C6); }
  .ost-table td { padding: 7px 10px; border-bottom: 0.5px solid #f0ece2; }
  .ost-table .n { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .ost-table .p { font-weight: 700; white-space: nowrap; }
  .ost-table .money { font-family: var(--sb-font-mono, 'JetBrains Mono'), monospace; font-size: 12.5px; }
  .ost-table .bar { width: 22%; min-width: 90px; }
  .ost-table .bar i { display: block; height: 8px; border-radius: 5px; background: #C9A468; min-width: 2px; }
  .ost-table tfoot td { border-top: 2px solid var(--sb-border, #E2D8C6); border-bottom: none; font-weight: 800; }
`
