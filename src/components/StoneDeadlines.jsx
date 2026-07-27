// =============================================================================
// StoneDeadlines — Sabina's deadline chart vs the orders, Paul clicks (RECON-3)
// =============================================================================
// Lives in the TOP-LEVEL Reconcile tab (Paul 2026-07-27: "why is this in
// inventory tab and not reconcile tab — that's where i'm totally thrown off").
// Staged rows come from stone_deadlines (the workbook import); NOTHING writes
// to an order until he presses Set.
//
// Rows are GROUPED BY FAMILY — the chart lists a family once per month column,
// so an ungrouped view showed the same order two or three times and read as
// duplicates. One card per family: every chart date it carries, the order(s)
// that match, and a per-date decision. Picking an order for one date removes it
// from the other dates in that family (one order has one due date).
// =============================================================================
import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  listStoneDeadlines, applyStoneDeadline, dismissStoneDeadline,
  listOpenOrdersLight, getCurrentStaffName,
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
const famOf = (o) => (o.primary_lastname && String(o.primary_lastname).trim())
  || [o.customer?.first_name, o.customer?.last_name].filter(Boolean).join(' ')
  || o.order_number || 'Order'

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
  const [pick, setPick] = useState({})       // deadline row id -> chosen order
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

  // One card per FAMILY: its chart dates + the orders that match the name.
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
    // Sort: nothing-matched first (real gaps), then most chart dates, then name.
    out.sort((a, z) => (a.hits.length === 0 ? 0 : 1) - (z.hits.length === 0 ? 0 : 1)
      || z.dates.length - a.dates.length
      || a.family.localeCompare(z.family))
    return out
  }, [rows, orders, index])

  const searchHits = useMemo(() => {
    if (!orders || q.trim().length < 2) return []
    const t = q.trim().toLowerCase()
    return orders.filter(o => `${o.primary_lastname || ''} ${o.customer?.last_name || ''} ${o.order_number || ''}`.toLowerCase().includes(t)).slice(0, 8)
  }, [orders, q])

  const apply = async (row, order) => {
    if (busyId) return
    setBusyId(row.id); setBanner(null)
    const who = await getCurrentStaffName().catch(() => null)
    const res = await applyStoneDeadline(row.id, order.id, row.proposed_date, who)
    setBusyId(null)
    if (!res.ok) { setBanner({ kind: 'err', text: res.error || 'Could not set the due date.' }); return }
    setBanner({ kind: 'ok', text: `${famOf(order)} (${order.order_number}) due ${fmt(row.proposed_date)}.` })
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

  const totalDates = rows.length
  const unmatched = families.filter(g => g.hits.length === 0).length

  return (
    <div className="sd-wrap">
      <style>{SD_CSS}</style>
      <div className="sd-head">
        <h2 className="sd-title">Stone deadline chart</h2>
        <span className="sd-count">{totalDates} open stone{totalDates === 1 ? '' : 's'} · {families.length} famil{families.length === 1 ? 'y' : 'ies'}</span>
      </div>
      <div className="sd-hint">
        Sabina's chart, green (finished) left out. One card per family — a family the chart lists in two months
        shows both dates here, so the same order never appears twice. Nothing changes until you press Set.
        {unmatched > 0 && <> <b>{unmatched}</b> famil{unmatched === 1 ? 'y is' : 'ies are'} not in Stonebooks at all — those are first.</>}
      </div>
      {banner && <div className={`sd-banner sd-banner-${banner.kind}`}>{banner.text}<button type="button" onClick={() => setBanner(null)}>×</button></div>}

      {families.map(g => {
        // An order already assigned to one date in this family is off the table
        // for its other dates — one order carries one due date.
        const taken = new Set(g.dates.map(d => pick[d.id]?.id).filter(Boolean))
        return (
          <div key={g.key} className={`sd-fam${g.hits.length === 0 ? ' sd-fam-gap' : ''}`}>
            <div className="sd-fam-head">
              <span className="sd-fam-name">{g.family}</span>
              {g.hits.length === 0
                ? <span className="sd-tag sd-tag-red">NOT IN STONEBOOKS</span>
                : g.hits.length > 1
                  ? <span className="sd-tag sd-tag-amber">{g.hits.length} orders with this name</span>
                  : <span className="sd-tag">{g.hits[0].order_number} · {g.hits[0].status}</span>}
              {g.dates.length > 1 && <span className="sd-tag">{g.dates.length} dates on the chart</span>}
            </div>

            {g.dates.map(r => {
              const chosen = pick[r.id] || (g.hits.length === 1 ? g.hits[0] : null)
              const cur = chosen?.target_completion_date ? String(chosen.target_completion_date).slice(0, 10) : null
              const aligned = chosen && cur === r.proposed_date
              const options = g.hits.filter(o => !taken.has(o.id) || chosen?.id === o.id)
              return (
                <div key={r.id} className="sd-row">
                  <span className="sd-date">{fmt(r.proposed_date)}</span>
                  {colorChip(r)}
                  <span className="sd-detail">{r.detail || r.family_raw}</span>

                  {chosen ? (
                    <>
                      <button type="button" className="sd-order" onClick={() => onOpenOrder?.(chosen.id)}>
                        {famOf(chosen)} · {chosen.order_number}
                      </button>
                      <span className="sd-now">{cur ? `now ${fmt(cur)}` : 'no due date'}</span>
                      {aligned
                        ? <span className="sd-ok">already matches</span>
                        : (
                          <button type="button" className="sd-btn sd-btn-go" disabled={!!busyId} onClick={() => apply(r, chosen)}>
                            {busyId === r.id ? '…' : `Set ${fmt(r.proposed_date)}`}
                          </button>
                        )}
                      {g.hits.length > 1 && (
                        <button type="button" className="sd-btn" disabled={!!busyId}
                          onClick={() => setPick(p => { const n = { ...p }; delete n[r.id]; return n })}>Change</button>
                      )}
                    </>
                  ) : g.hits.length > 1 ? (
                    <span className="sd-picks">
                      <span className="sd-pick-lab">Which order?</span>
                      {options.map(o => (
                        <button key={o.id} type="button" className="sd-btn sd-btn-pick" disabled={!!busyId}
                          onClick={() => setPick(p => ({ ...p, [r.id]: o }))}>
                          {o.order_number}{o.target_completion_date ? ` · now ${fmt(o.target_completion_date)}` : ' · no due date'}
                        </button>
                      ))}
                    </span>
                  ) : (
                    <>
                      <button type="button" className="sd-btn" disabled={!!busyId}
                        onClick={() => { setSearchFor(searchFor === r.id ? null : r.id); setQ('') }}>
                        {searchFor === r.id ? 'Close search' : 'Find the order…'}
                      </button>
                    </>
                  )}

                  <button type="button" className="sd-btn sd-btn-x" disabled={!!busyId} onClick={() => dismiss(r)}>Disregard</button>

                  {searchFor === r.id && (
                    <div className="sd-search">
                      <input className="sd-input" autoFocus placeholder="Search family, customer name, or order #…"
                        value={q} onChange={e => setQ(e.target.value)} />
                      {searchHits.map(o => (
                        <button key={o.id} type="button" className="sd-hit"
                          onClick={() => { setPick(p => ({ ...p, [r.id]: o })); setSearchFor(null); setQ('') }}>
                          <b>{famOf(o)}</b> <span>{o.order_number} · {o.status}{o.target_completion_date ? ` · due ${fmt(o.target_completion_date)}` : ' · no due date'}</span>
                        </button>
                      ))}
                      {q.trim().length >= 2 && searchHits.length === 0 && <div className="sd-empty">No open order matches.</div>}
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
  .sd-fam-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 4px; }
  .sd-fam-name { font-size: 15px; font-weight: 800; color: #1e2d3d; }
  .sd-tag { font-size: 10.5px; font-weight: 700; letter-spacing: 0.03em; color: #6b6256; background: #f2eee4; border-radius: 6px; padding: 2px 8px; }
  .sd-tag-red { background: #fdeced; color: #b3261e; }
  .sd-tag-amber { background: #fcefd9; color: #8a5a12; }
  .sd-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; padding: 7px 0; border-top: 1px solid #f3f0e8; }
  .sd-row:first-of-type { border-top: 0; }
  .sd-date { font-size: 13px; font-weight: 800; color: #16150F; font-variant-numeric: tabular-nums; min-width: 78px; }
  .sd-chip { font-size: 9.5px; font-weight: 800; letter-spacing: 0.05em; border-radius: 6px; padding: 3px 8px; background: #f0ece2; color: #6b6256; white-space: nowrap; }
  .sd-blue { background: #EAF1FB; color: #234C8A; }
  .sd-orange { background: #FCEFD9; color: #A05A12; }
  .sd-detail { font-size: 12px; color: #8a7f6c; flex: 1; min-width: 120px; }
  .sd-order { font: inherit; font-size: 13px; font-weight: 700; color: #1e2d3d; background: none; border: none; padding: 0; cursor: pointer; text-align: left; }
  .sd-order:hover { color: #9A7209; }
  .sd-now { font-size: 12px; color: #8a7f6c; font-variant-numeric: tabular-nums; }
  .sd-ok { font-size: 12px; font-weight: 700; color: #1f7a3d; }
  .sd-picks { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
  .sd-pick-lab { font-size: 11.5px; font-weight: 700; color: #8a5a12; }
  .sd-btn { font: inherit; font-size: 12px; font-weight: 700; padding: 5px 12px; border-radius: 8px; border: 1px solid #d8d2c4; background: #fff; color: #2a2a27; cursor: pointer; white-space: nowrap; }
  .sd-btn:hover:not(:disabled) { border-color: #9A7209; color: #9A7209; }
  .sd-btn:disabled { opacity: 0.5; cursor: default; }
  .sd-btn-go { border-color: #1f7a3d; background: #1f7a3d; color: #fff; }
  .sd-btn-go:hover:not(:disabled) { background: #16612f; border-color: #16612f; color: #fff; }
  .sd-btn-pick { border-color: #2563a8; color: #2563a8; }
  .sd-btn-x { color: #a09884; border-color: #e4e0d4; }
  .sd-btn-x:hover:not(:disabled) { border-color: #B3261E; color: #B3261E; }
  .sd-search { flex-basis: 100%; margin-top: 6px; border: 1px solid #e4e0d4; border-radius: 9px; padding: 8px; }
  .sd-input { font: inherit; font-size: 13px; padding: 8px 10px; border: 1px solid #d8d2c4; border-radius: 8px; width: 100%; }
  .sd-hit { display: block; width: 100%; text-align: left; font: inherit; font-size: 13px; background: none; border: none; border-top: 1px solid #f3f0e8; padding: 7px 4px; cursor: pointer; }
  .sd-hit:hover { background: #faf8f3; }
  .sd-hit span { color: #8a7f6c; font-size: 12px; font-weight: 500; }
  .sd-empty { font-size: 13px; color: #9a9486; padding: 8px 2px; }
`
