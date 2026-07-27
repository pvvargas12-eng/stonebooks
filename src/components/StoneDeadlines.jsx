// =============================================================================
// StoneDeadlines — Sabina's deadline chart vs the orders, Paul clicks (RECON-4)
// =============================================================================
// Lives in the TOP-LEVEL Reconcile tab. Staged rows come from stone_deadlines;
// NOTHING writes to an order until he presses Set.
//
// RECON-4 (Paul: "especially when you ask which order for multiple of the same
// name you cant view gotta be able to open and view the orders then go back
// and select which one it is"):
//   • Same-name candidates render as full CARDS — cemetery, deceased, grave,
//     current due date, money in, when it was written — so two Garras are
//     tellable apart WITHOUT leaving the tab. Each still has Open order
//     (Back returns here).
//   • The date is EDITABLE before it's set. A chart cell that only says
//     "April" proposes April 30 but says so, so a real due date is never
//     silently replaced by a month-end guess.
// Rows are grouped by family — the chart lists a family once per month column.
// =============================================================================
import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  listStoneDeadlines, applyStoneDeadline, dismissStoneDeadline,
  listOpenOrdersLight, getCurrentStaffName, rowTotalPaid, fmtUSD, properName,
} from '../lib/stonebooksData'

const norm = (s) => String(s || '').toUpperCase().replace(/[^A-Z ]/g, ' ').replace(/\s+/g, ' ').trim()
const keysOf = (raw) => {
  const n = norm(String(raw || '').split(/[-–]/)[0])
  const words = n.split(' ').filter(Boolean)
  return { full: n, longest: words.slice().sort((a, z) => z.length - a.length)[0] || '' }
}
const fmt = (iso) => {
  if (!iso) return '—'
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number)
  return `${m}/${d}/${y}`
}
const monthName = (iso) => {
  const [y, m] = String(iso).slice(0, 10).split('-').map(Number)
  return `${['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][m]} ${y}`
}
const lastDayOf = (monthIso) => {
  const [y, m] = String(monthIso).slice(0, 10).split('-').map(Number)
  const d = new Date(y, m, 0).getDate()
  return `${String(y)}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}
const famOf = (o) => properName((o.primary_lastname && String(o.primary_lastname).trim())
  || [o.customer?.first_name, o.customer?.last_name].filter(Boolean).join(' ')
  || o.order_number || 'Order')

// Deceased names off the jsonb, defensively — shapes have drifted over time.
const deceasedOf = (o) => {
  const arr = Array.isArray(o.deceased) ? o.deceased : []
  return arr.map(p => properName([p?.firstName || p?.first_name, p?.lastName || p?.last_name].filter(Boolean).join(' ')))
    .filter(Boolean).join(' · ')
}
const graveOf = (o) => o.grave_location
  || [o.plot_section && `Sec ${o.plot_section}`, o.plot_block && `Blk ${o.plot_block}`,
      o.plot_lot && `Lot ${o.plot_lot}`, o.plot_grave && `Gr ${o.plot_grave}`].filter(Boolean).join(' · ')

const colorChip = (r) => (
  r.sheet_color === 'blue' ? <span className="sd-chip sd-blue">STENCIL CUT</span>
    : r.sheet_color === 'orange' ? <span className="sd-chip sd-orange">HAS PHOTO</span>
      : <span className="sd-chip">NOT CUT</span>
)

export default function StoneDeadlines({ onOpenOrder }) {
  const [rows, setRows] = useState(null)
  const [orders, setOrders] = useState(null)
  const [busyId, setBusyId] = useState(null)
  const [banner, setBanner] = useState(null)
  const [pick, setPick] = useState({})        // deadline row id -> chosen order
  const [dateEdit, setDateEdit] = useState({})// deadline row id -> overridden ISO date
  const [searchFor, setSearchFor] = useState(null)
  const [q, setQ] = useState('')

  const load = useCallback(async () => {
    const [r, o] = await Promise.all([listStoneDeadlines(), listOpenOrdersLight()])
    setRows(r); setOrders(o)
  }, [])
  useEffect(() => { load() }, [load])

  const index = useMemo(() => {
    const m = new Map()
    const push = (k, o) => { if (!k) return; if (!m.has(k)) m.set(k, []); m.get(k).push(o) }
    for (const o of (orders || [])) {
      push(norm(o.primary_lastname), o)
      const ln = norm(o.customer?.last_name)
      if (ln && ln !== norm(o.primary_lastname)) push(ln, o)
    }
    return m
  }, [orders])

  const families = useMemo(() => {
    if (!rows || !orders) return null
    const uniq = (arr) => { const s = new Set(); return arr.filter(o => !s.has(o.id) && s.add(o.id)) }
    const byFam = new Map()
    for (const r of rows) {
      const { full, longest } = keysOf(r.family)
      let hits = uniq([...(index.get(full) || []), ...(index.get(longest) || [])])
      if (hits.length === 0 && longest.length >= 4) {
        hits = uniq((orders || []).filter(o => {
          const pn = norm(o.primary_lastname), ln = norm(o.customer?.last_name)
          return (pn && pn.includes(longest)) || (ln && ln.includes(longest))
        }))
        if (hits.length > 3) hits = []
      }
      const key = full || r.family
      if (!byFam.has(key)) byFam.set(key, { key, family: r.family, dates: [], hits })
      const g = byFam.get(key)
      g.dates.push(r)
      if (hits.length > g.hits.length) g.hits = hits
    }
    const out = [...byFam.values()]
    for (const g of out) g.dates.sort((a, z) => String(a.proposed_date).localeCompare(String(z.proposed_date)))
    out.sort((a, z) => (a.hits.length === 0 ? 0 : 1) - (z.hits.length === 0 ? 0 : 1)
      || z.dates.length - a.dates.length
      || a.family.localeCompare(z.family))
    return out
  }, [rows, orders, index])

  const searchHits = useMemo(() => {
    if (!orders || q.trim().length < 2) return []
    const t = q.trim().toLowerCase()
    return orders.filter(o => `${o.primary_lastname || ''} ${o.customer?.last_name || ''} ${o.order_number || ''}`.toLowerCase().includes(t)).slice(0, 6)
  }, [orders, q])

  const apply = async (row, order, dateIso) => {
    if (busyId) return
    setBusyId(row.id); setBanner(null)
    const who = await getCurrentStaffName().catch(() => null)
    const res = await applyStoneDeadline(row.id, order.id, dateIso, who)
    setBusyId(null)
    if (!res.ok) { setBanner({ kind: 'err', text: res.error || 'Could not set the due date.' }); return }
    setBanner({ kind: 'ok', text: `${famOf(order)} (${order.order_number}) due ${fmt(dateIso)}.` })
    load()
  }
  const dismiss = async (row) => {
    if (busyId) return
    setBusyId(row.id); setBanner(null)
    const who = await getCurrentStaffName().catch(() => null)
    const res = await dismissStoneDeadline(row.id, who)
    setBusyId(null)
    if (!res.ok) { setBanner({ kind: 'err', text: res.error || 'Could not disregard.' }); return }
    load()
  }

  if (rows === null || orders === null) return <div className="sd-wrap"><style>{SD_CSS}</style><div className="sd-empty">Reading the deadline chart…</div></div>
  if (!rows.length) return null

  const unmatched = families.filter(g => g.hits.length === 0).length

  return (
    <div className="sd-wrap">
      <style>{SD_CSS}</style>
      <div className="sd-head">
        <h2 className="sd-title">Stone deadline chart</h2>
        <span className="sd-count">{rows.length} open stone{rows.length === 1 ? '' : 's'} · {families.length} famil{families.length === 1 ? 'y' : 'ies'}</span>
      </div>
      <div className="sd-hint">
        Sabina's chart, finished (green) stones left out. Nothing changes until you press Set — and you can
        change the date first. {unmatched > 0 && <><b>{unmatched}</b> famil{unmatched === 1 ? 'y is' : 'ies are'} not in Stonebooks at all; those are first.</>}
      </div>
      {banner && <div className={`sd-banner sd-banner-${banner.kind}`}>{banner.text}<button type="button" onClick={() => setBanner(null)}>×</button></div>}

      {families.map(g => {
        const taken = new Set(g.dates.map(d => pick[d.id]?.id).filter(Boolean))
        return (
          <div key={g.key} className={`sd-fam${g.hits.length === 0 ? ' sd-fam-gap' : ''}`}>
            <div className="sd-fam-head">
              <span className="sd-fam-name">{g.family}</span>
              {g.hits.length === 0
                ? <span className="sd-tag sd-tag-red">NOT IN STONEBOOKS</span>
                : g.hits.length > 1
                  ? <span className="sd-tag sd-tag-amber">{g.hits.length} orders with this name — pick per date</span>
                  : <span className="sd-tag">{g.hits[0].order_number} · {g.hits[0].status}</span>}
              {g.dates.length > 1 && <span className="sd-tag">{g.dates.length} dates on the chart</span>}
            </div>

            {g.dates.map(r => {
              const chosen = pick[r.id] || (g.hits.length === 1 ? g.hits[0] : null)
              const cur = chosen?.target_completion_date ? String(chosen.target_completion_date).slice(0, 10) : null
              const inferred = r.proposed_date === lastDayOf(r.due_month)
              const theDate = dateEdit[r.id] || r.proposed_date
              const aligned = chosen && cur === theDate
              const options = g.hits.filter(o => !taken.has(o.id) || chosen?.id === o.id)
              return (
                <div key={r.id} className="sd-block">
                  <div className="sd-row">
                    <span className="sd-src">
                      {inferred
                        ? <>chart column <b>{monthName(r.due_month)}</b> <span className="sd-guess">no day written — proposing month end</span></>
                        : <>chart says <b>{fmt(r.proposed_date)}</b></>}
                    </span>
                    {colorChip(r)}
                    {r.detail && <span className="sd-detail">{r.detail}</span>}
                    <button type="button" className="sd-btn sd-btn-x" disabled={!!busyId} onClick={() => dismiss(r)}>Disregard</button>
                  </div>

                  {/* Same-name candidates: real cards, not bare numbers. */}
                  {!chosen && g.hits.length > 1 && (
                    <div className="sd-cands">
                      <div className="sd-cands-lab">Which order is this? Open one if you need to look — Back brings you here.</div>
                      {options.map(o => (
                        <div key={o.id} className="sd-cand">
                          <div className="sd-cand-main">
                            <div className="sd-cand-top">
                              <b>{famOf(o)}</b>
                              <span className="sd-cand-no">{o.order_number}</span>
                              <span className="sd-tag">{o.status}</span>
                              {rowTotalPaid(o) > 0 && <span className="sd-tag">{fmtUSD(rowTotalPaid(o))} in</span>}
                            </div>
                            <div className="sd-cand-facts">
                              {[o.cemetery?.name, graveOf(o), deceasedOf(o) && `for ${deceasedOf(o)}`,
                                o.target_completion_date ? `due ${fmt(o.target_completion_date)}` : 'no due date',
                                o.created_at ? `written ${fmt(o.created_at)}` : null,
                              ].filter(Boolean).join('  ·  ')}
                            </div>
                          </div>
                          <div className="sd-cand-acts">
                            <button type="button" className="sd-btn" onClick={() => onOpenOrder?.(o.id)}>Open</button>
                            <button type="button" className="sd-btn sd-btn-pick" onClick={() => setPick(p => ({ ...p, [r.id]: o }))}>This one</button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Nothing matched — search for it */}
                  {!chosen && g.hits.length === 0 && (
                    <div className="sd-cands">
                      <button type="button" className="sd-btn" disabled={!!busyId}
                        onClick={() => { setSearchFor(searchFor === r.id ? null : r.id); setQ('') }}>
                        {searchFor === r.id ? 'Close search' : 'Find this order…'}
                      </button>
                      {searchFor === r.id && (
                        <div className="sd-search">
                          <input className="sd-input" autoFocus placeholder="Search family, customer name, or order #…"
                            value={q} onChange={e => setQ(e.target.value)} />
                          {searchHits.map(o => (
                            <div key={o.id} className="sd-cand">
                              <div className="sd-cand-main">
                                <div className="sd-cand-top"><b>{famOf(o)}</b><span className="sd-cand-no">{o.order_number}</span><span className="sd-tag">{o.status}</span></div>
                                <div className="sd-cand-facts">
                                  {[o.cemetery?.name, o.target_completion_date ? `due ${fmt(o.target_completion_date)}` : 'no due date'].filter(Boolean).join('  ·  ')}
                                </div>
                              </div>
                              <div className="sd-cand-acts">
                                <button type="button" className="sd-btn" onClick={() => onOpenOrder?.(o.id)}>Open</button>
                                <button type="button" className="sd-btn sd-btn-pick"
                                  onClick={() => { setPick(p => ({ ...p, [r.id]: o })); setSearchFor(null); setQ('') }}>This one</button>
                              </div>
                            </div>
                          ))}
                          {q.trim().length >= 2 && searchHits.length === 0 && <div className="sd-empty">No open order matches.</div>}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Chosen — compare, adjust the date, commit */}
                  {chosen && (
                    <div className="sd-apply">
                      <button type="button" className="sd-order" onClick={() => onOpenOrder?.(chosen.id)}>
                        {famOf(chosen)} · {chosen.order_number}
                      </button>
                      <span className="sd-cand-facts">
                        {[chosen.cemetery?.name, deceasedOf(chosen) && `for ${deceasedOf(chosen)}`].filter(Boolean).join('  ·  ')}
                      </span>
                      <span className="sd-cmp">
                        <span className="sd-cmp-now">{cur ? `now ${fmt(cur)}` : 'no due date'}</span>
                        <span className="sd-arrow">→</span>
                        <input type="date" className="sd-date-in" value={theDate}
                          onChange={e => setDateEdit(d => ({ ...d, [r.id]: e.target.value }))} />
                      </span>
                      {aligned
                        ? <span className="sd-ok">already this date</span>
                        : (
                          <button type="button" className="sd-btn sd-btn-go" disabled={!!busyId}
                            onClick={() => apply(r, chosen, theDate)}>
                            {busyId === r.id ? 'Saving…' : `Set ${fmt(theDate)}`}
                          </button>
                        )}
                      {g.hits.length > 1 && (
                        <button type="button" className="sd-btn" disabled={!!busyId}
                          onClick={() => setPick(p => { const n = { ...p }; delete n[r.id]; return n })}>Different order</button>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}

const SD_CSS = `
  .sd-wrap { margin-bottom: 26px; }
  .sd-head { display: flex; align-items: baseline; gap: 12px; margin-bottom: 4px; }
  .sd-title { font-family: 'Fraunces', Georgia, serif; font-size: 21px; font-weight: 600; color: #16150F; margin: 0; }
  .sd-count { font-size: 12.5px; font-weight: 700; color: #8a7f6c; }
  .sd-hint { font-size: 12.5px; color: #8a7f6c; line-height: 1.55; max-width: 900px; margin-bottom: 12px; }
  .sd-banner { display: flex; align-items: center; gap: 10px; padding: 10px 14px; border-radius: 9px; font-size: 13.5px; font-weight: 600; margin-bottom: 12px; }
  .sd-banner-ok { background: #e7f3ea; color: #1f7a3d; }
  .sd-banner-err { background: #fdeced; color: #b3261e; }
  .sd-banner button { margin-left: auto; background: none; border: none; font-size: 17px; color: inherit; opacity: 0.6; cursor: pointer; }
  .sd-fam { background: #fff; border: 1px solid #e4e0d4; border-left: 5px solid #d8d2c4; border-radius: 12px; padding: 12px 14px; margin-bottom: 10px; }
  .sd-fam-gap { border-left-color: #B3261E; }
  .sd-fam-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 6px; }
  .sd-fam-name { font-size: 15px; font-weight: 800; color: #1e2d3d; }
  .sd-tag { font-size: 10.5px; font-weight: 700; color: #6b6256; background: #f2eee4; border-radius: 6px; padding: 2px 8px; white-space: nowrap; }
  .sd-tag-red { background: #fdeced; color: #b3261e; }
  .sd-tag-amber { background: #fcefd9; color: #8a5a12; }
  .sd-block { border-top: 1px solid #f3f0e8; padding: 8px 0 4px; }
  .sd-block:first-of-type { border-top: 0; }
  .sd-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .sd-src { font-size: 12.5px; color: #57503f; }
  .sd-guess { font-size: 11px; color: #a09884; font-style: italic; margin-left: 4px; }
  .sd-chip { font-size: 9.5px; font-weight: 800; letter-spacing: 0.05em; border-radius: 6px; padding: 3px 8px; background: #f0ece2; color: #6b6256; white-space: nowrap; }
  .sd-blue { background: #EAF1FB; color: #234C8A; }
  .sd-orange { background: #FCEFD9; color: #A05A12; }
  .sd-detail { font-size: 12px; color: #8a7f6c; flex: 1; min-width: 100px; }
  .sd-cands { margin: 8px 0 4px; padding-left: 2px; }
  .sd-cands-lab { font-size: 11.5px; font-weight: 700; color: #8a5a12; margin-bottom: 6px; }
  .sd-cand { display: flex; align-items: center; gap: 12px; background: #FBFAF6; border: 1px solid #EFEBE0; border-radius: 10px; padding: 9px 12px; margin-bottom: 6px; flex-wrap: wrap; }
  .sd-cand-main { flex: 1; min-width: 220px; }
  .sd-cand-top { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 13.5px; color: #1e2d3d; }
  .sd-cand-no { font-size: 12px; font-weight: 700; color: #6b6256; font-variant-numeric: tabular-nums; }
  .sd-cand-facts { font-size: 12px; color: #8a7f6c; margin-top: 2px; }
  .sd-cand-acts { display: flex; gap: 6px; flex-shrink: 0; }
  .sd-apply { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin: 8px 0 4px; }
  .sd-order { font: inherit; font-size: 13.5px; font-weight: 700; color: #1e2d3d; background: none; border: none; padding: 0; cursor: pointer; }
  .sd-order:hover { color: #9A7209; }
  .sd-cmp { display: inline-flex; align-items: center; gap: 8px; }
  .sd-cmp-now { font-size: 12.5px; color: #8a7f6c; font-variant-numeric: tabular-nums; }
  .sd-arrow { color: #b3aea2; }
  .sd-date-in { font: inherit; font-size: 13px; padding: 6px 9px; border: 1px solid #d8d2c4; border-radius: 8px; background: #fff; color: #16150F; }
  .sd-date-in:focus { outline: none; border-color: #9A7209; box-shadow: 0 0 0 3px rgba(154,114,9,0.14); }
  .sd-ok { font-size: 12px; font-weight: 700; color: #1f7a3d; }
  .sd-btn { font: inherit; font-size: 12px; font-weight: 700; padding: 6px 13px; border-radius: 8px; border: 1px solid #d8d2c4; background: #fff; color: #2a2a27; cursor: pointer; white-space: nowrap; }
  .sd-btn:hover:not(:disabled) { border-color: #9A7209; color: #9A7209; }
  .sd-btn:disabled { opacity: 0.5; cursor: default; }
  .sd-btn-go { border-color: #1f7a3d; background: #1f7a3d; color: #fff; }
  .sd-btn-go:hover:not(:disabled) { background: #16612f; border-color: #16612f; color: #fff; }
  .sd-btn-pick { border-color: #2563a8; color: #2563a8; }
  .sd-btn-x { color: #a09884; border-color: #e4e0d4; margin-left: auto; }
  .sd-btn-x:hover:not(:disabled) { border-color: #B3261E; color: #B3261E; }
  .sd-search { margin-top: 6px; border: 1px solid #e4e0d4; border-radius: 9px; padding: 8px; }
  .sd-input { font: inherit; font-size: 13px; padding: 8px 10px; border: 1px solid #d8d2c4; border-radius: 8px; width: 100%; margin-bottom: 6px; }
  .sd-empty { font-size: 13px; color: #9a9486; padding: 8px 2px; }
`
