// =============================================================================
// Reports › Monthly review (OWNER-REVIEW-1, 2026-10-30)
// =============================================================================
// Paul: "where can I see this report and owner analysis? I want this to be a
// monthly thing where every single report is uploaded and I get an analysis;
// I want to see growth."
//
// Three blocks, top to bottom:
//   1. GROWTH — month by month (last 12): cash in (families, orders.payments[]),
//      cash out (the Accounting book, confirmed + inbox), net, the fixed nut,
//      sales signed; change vs the month before; a grouped bar chart.
//      Click a month to see where the money went (buckets).
//   2. STATEMENTS — which account statements are in the cabinet for each of
//      the last 6 months (the "every single report is uploaded" tracker).
//   3. REVIEWS — the written analysis per period: score out of 10, headline,
//      the analysis, the full report (file in the receipts bucket or a link).
//      Add / edit here; the score trend sits above the cards.
// =============================================================================

import { useState, useEffect, useMemo } from 'react'
import { rowGrandTotal, rowNonVoidedPayments, fmtUSD, fmtDate } from '../lib/stonebooksData'
import { listAcctDocuments, acctFileUrl, schedcLabel } from '../lib/acctData'
import {
  listOwnerReviews, addOwnerReview, updateOwnerReview, deleteOwnerReview,
  monthKey, monthLabel, lastMonths, periodBounds, periodLabel, STATEMENT_ACCOUNTS, statementCoverage, isFixedCost,
} from '../lib/ownerReviews'

const paymentDay = (p) => (p?.receivedAt && String(p.receivedAt).slice(0, 10)) || (p?.createdAt && String(p.createdAt).slice(0, 10)) || null
const pct = (cur, prev) => (prev > 0 && cur != null) ? Math.round(((cur - prev) / prev) * 100) : null
const fmtK = (n) => n >= 1000 ? `$${Math.round(n / 1000)}k` : `$${Math.round(n)}`
const scoreTone = (s) => s == null ? 'none' : s >= 7 ? 'good' : s >= 4 ? 'mid' : 'bad'

function Delta({ value, goodWhenUp = true }) {
  if (value == null) return <span className="orv-delta none">—</span>
  const up = value > 0
  const tone = value === 0 ? 'flat' : (up === goodWhenUp ? 'good' : 'bad')
  return <span className={`orv-delta ${tone}`}>{value > 0 ? '+' : ''}{value}%</span>
}

// Grouped bars: cash in beside cash out for every month, one shared scale.
function GrowthChart({ months }) {
  const W = 960, H = 230, padL = 56, padR = 12, padT = 18, padB = 34
  const innerW = W - padL - padR, innerH = H - padT - padB
  const max = Math.max(1, ...months.map(m => Math.max(m.cashIn, m.cashOut)))
  const n = months.length
  const slot = innerW / n
  const barW = Math.max(6, Math.min(26, (slot - 8) / 2))
  const y = (v) => padT + innerH - (v / max) * innerH
  const ticks = [0, 0.25, 0.5, 0.75, 1].map(t => t * max)
  return (
    <div className="orv-chart-wrap">
      <svg viewBox={`0 0 ${W} ${H}`} className="orv-chart" role="img" aria-label="Cash in and cash out by month">
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} className="orv-grid" />
            <text x={padL - 6} y={y(t) + 4} className="orv-tick" textAnchor="end">{fmtK(t)}</text>
          </g>
        ))}
        {months.map((m, i) => {
          const x0 = padL + i * slot + (slot - barW * 2 - 2) / 2
          return (
            <g key={m.key}>
              <title>{`${m.label}: in ${fmtUSD(m.cashIn)} · out ${fmtUSD(m.cashOut)} · net ${fmtUSD(m.net)}`}</title>
              <rect x={x0} y={y(m.cashIn)} width={barW} height={Math.max(0, padT + innerH - y(m.cashIn))} rx="3" className="orv-bar in" />
              <rect x={x0 + barW + 2} y={y(m.cashOut)} width={barW} height={Math.max(0, padT + innerH - y(m.cashOut))} rx="3" className="orv-bar out" />
              <text x={padL + i * slot + slot / 2} y={H - 12} className="orv-xlab" textAnchor="middle">{m.short}</text>
            </g>
          )
        })}
        <line x1={padL} x2={W - padR} y1={padT + innerH} y2={padT + innerH} className="orv-axis" />
      </svg>
      <div className="orv-key"><span className="orv-key-sw in" /> Cash in <span className="orv-key-sw out" /> Cash out</div>
    </div>
  )
}

// `preload` = { docs, reviews } skips the network (smoke mounts only).
export default function OwnerReviewView({ bundle, now, user, preload = null }) {
  const [docs, setDocs] = useState(() => preload?.docs || [])
  const [reviews, setReviews] = useState(() => preload?.reviews || null)
  const [openMonth, setOpenMonth] = useState(null)
  const [form, setForm] = useState(null)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState(null)
  const [expanded, setExpanded] = useState(() => new Set())

  useEffect(() => {
    if (preload) return undefined
    let c = false
    Promise.all([listAcctDocuments(), listOwnerReviews()]).then(([d, r]) => { if (!c) { setDocs(d); setReviews(r) } })
    return () => { c = true }
  }, [preload])

  const thisMonth = monthKey(now)

  // ── GROWTH table (last 12 months, oldest first) ───────────────────────────
  const months = useMemo(() => {
    const orders = bundle?.orders || []
    const expenses = bundle?.expenses || []
    const keys = lastMonths(now, 12)
    const rows = new Map(keys.map(k => [k, {
      key: k, label: monthLabel(k), short: monthLabel(k, { short: true }).replace(' 20', ' ’'),
      cashIn: 0, cashN: 0, cashOut: 0, outN: 0, fixed: 0, net: 0, signedUsd: 0, signedN: 0, buckets: new Map(),
    }]))
    for (const e of expenses) {
      const amt = Number(e.amount)
      if (!e.expense_date || !(amt > 0)) continue
      const r = rows.get(String(e.expense_date).slice(0, 7)); if (!r) continue
      r.cashOut += amt; r.outN++
      if (isFixedCost(e)) r.fixed += amt
      const b = e.ai?.bucket || (e.category ? schedcLabel(e.category) : 'Uncategorized')
      r.buckets.set(b, (r.buckets.get(b) || 0) + amt)
    }
    for (const o of orders) {
      if (o.signed_at) {
        const r = rows.get(monthKey(new Date(o.signed_at)))
        if (r) { r.signedUsd += rowGrandTotal(o) || 0; r.signedN++ }
      }
      for (const p of rowNonVoidedPayments(o)) {
        const day = paymentDay(p); const amt = Number(p.amount) || 0
        if (!day || amt <= 0) continue
        const r = rows.get(day.slice(0, 7)); if (r) { r.cashIn += amt; r.cashN++ }
      }
    }
    const list = [...rows.values()]
    list.forEach((r, i) => {
      r.net = r.cashIn - r.cashOut
      const p = list[i - 1]
      r.dIn = p ? pct(r.cashIn, p.cashIn) : null
      r.dOut = p ? pct(r.cashOut, p.cashOut) : null
      r.dSigned = p ? pct(r.signedUsd, p.signedUsd) : null
      r.topBuckets = [...r.buckets.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)
    })
    return list
  }, [bundle, now])

  const last3 = months.slice(-4, -1)   // the three finished months before this one
  const avg = (f) => last3.length ? last3.reduce((s, m) => s + f(m), 0) / last3.length : 0

  // ── STATEMENT coverage (last 6 months) ────────────────────────────────────
  const covMonths = useMemo(() => lastMonths(now, 6), [now])
  const coverage = useMemo(() => statementCoverage(docs, covMonths), [docs, covMonths])

  // ── REVIEWS ───────────────────────────────────────────────────────────────
  const reviewsAsc = useMemo(() => [...(reviews || [])].sort((a, b) => a.period_start < b.period_start ? -1 : 1), [reviews])

  const startForm = (r) => {
    setErr(null)
    if (r) setForm({ id: r.id, kind: r.kind, startMonth: r.period_start.slice(0, 7), score: r.score ?? '', headline: r.headline || '', narrative: r.narrative || '', report_url: r.report_url || '' })
    else {
      const prev = monthKey(new Date(now.getFullYear(), now.getMonth() - 1, 1))
      setForm({ kind: 'month', startMonth: prev, score: '', headline: '', narrative: '', report_url: '' })
    }
  }
  const metricsFor = (kind, startMonth) => {
    const { start, end } = periodBounds(kind, startMonth)
    const inside = months.filter(m => m.key >= start.slice(0, 7) && m.key <= end.slice(0, 7))
    const sum = (f) => inside.reduce((s, m) => s + f(m), 0)
    return { cashIn: sum(m => m.cashIn), cashOut: sum(m => m.cashOut), net: sum(m => m.net), fixed: sum(m => m.fixed), signedUsd: sum(m => m.signedUsd), signedN: sum(m => m.signedN), months: inside.length }
  }
  const save = async () => {
    if (!form || saving) return
    if (!/^\d{4}-\d{2}$/.test(form.startMonth)) { setErr('Pick the start month.'); return }
    setSaving(true); setErr(null)
    const { start, end } = periodBounds(form.kind, form.startMonth)
    const row = {
      kind: form.kind, period_start: start, period_end: end,
      score: form.score === '' ? null : Number(form.score),
      headline: form.headline.trim(), narrative: form.narrative.trim(), report_url: form.report_url.trim(),
      metrics: metricsFor(form.kind, form.startMonth),
    }
    const res = form.id ? await updateOwnerReview(form.id, row) : await addOwnerReview({ ...row, created_by: user?.email || null })
    setSaving(false)
    if (!res.ok) { setErr(res.error); return }
    setReviews(rs => form.id ? rs.map(r => r.id === form.id ? res.row : r) : [res.row, ...(rs || [])])
    setForm(null)
  }
  const remove = async (r) => {
    if (!window.confirm(`Delete the ${periodLabel(r)} review? The numbers stay; only the written review goes.`)) return
    const res = await deleteOwnerReview(r.id)
    if (res.ok) setReviews(rs => rs.filter(x => x.id !== r.id)); else setErr(res.error)
  }
  const openReport = async (r) => {
    if (r.report_path) {
      const res = await acctFileUrl(r.report_path, 900)
      if (res.ok) { window.open(res.url, '_blank', 'noopener'); return }
      setErr(res.error)
    }
    if (r.report_url) window.open(r.report_url, '_blank', 'noopener')
  }
  const toggleExpand = (id) => setExpanded(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })

  return (
    <div className="orv">
      <style>{ORV_CSS}</style>

      {/* ── 1. GROWTH ─────────────────────────────────────────────────── */}
      <section className="orv-sec">
        <div className="orv-sec-head">
          <div>
            <h2 className="orv-h2">Growth, month by month</h2>
            <div className="orv-sub">Cash in = every payment a family made (deposits and balances). Cash out = every line in the Accounting book, filed or still in the inbox. Fixed = payroll, loans, insurance, taxes, utilities, software. Change is against the month before.</div>
          </div>
        </div>
        <div className="orv-tiles">
          <div className="orv-tile"><div className="orv-tile-k">Avg cash in, last 3 full months</div><div className="orv-tile-v in">{fmtUSD(avg(m => m.cashIn))}</div></div>
          <div className="orv-tile"><div className="orv-tile-k">Avg cash out, last 3 full months</div><div className="orv-tile-v out">{fmtUSD(avg(m => m.cashOut))}</div></div>
          <div className="orv-tile"><div className="orv-tile-k">Avg fixed nut, last 3 full months</div><div className="orv-tile-v">{fmtUSD(avg(m => m.fixed))}</div><div className="orv-tile-s">{avg(m => m.cashIn) > 0 ? `${Math.round(avg(m => m.fixed) / avg(m => m.cashIn) * 100)}% of cash in` : '—'}</div></div>
          <div className="orv-tile"><div className="orv-tile-k">Avg net, last 3 full months</div><div className={`orv-tile-v ${avg(m => m.net) < 0 ? 'out' : 'in'}`}>{fmtUSD(avg(m => m.net))}</div></div>
        </div>
        <GrowthChart months={months} />
        <div className="orv-tablewrap">
          <table className="orv-table">
            <thead>
              <tr>
                <th>Month</th>
                <th className="r">Cash in</th><th className="r">vs prev</th>
                <th className="r">Cash out</th><th className="r">vs prev</th>
                <th className="r">Net</th>
                <th className="r">Fixed nut</th><th className="r">Fixed / in</th>
                <th className="r">Sales signed</th><th className="r">vs prev</th>
              </tr>
            </thead>
            <tbody>
              {[...months].reverse().map(m => {
                const open = openMonth === m.key
                return [
                  <tr key={m.key} className={`orv-row ${open ? 'open' : ''}`} onClick={() => setOpenMonth(open ? null : m.key)}>
                    <td className="orv-month">{m.label}{m.key === thisMonth && <span className="orv-sofar">so far</span>}</td>
                    <td className="r in">{fmtUSD(m.cashIn)}<span className="orv-n">{m.cashN}</span></td>
                    <td className="r"><Delta value={m.dIn} /></td>
                    <td className="r out">{fmtUSD(m.cashOut)}<span className="orv-n">{m.outN}</span></td>
                    <td className="r"><Delta value={m.dOut} goodWhenUp={false} /></td>
                    <td className={`r net ${m.net < 0 ? 'neg' : 'pos'}`}>{fmtUSD(m.net)}</td>
                    <td className="r">{fmtUSD(m.fixed)}</td>
                    <td className="r">{m.cashIn > 0 ? `${Math.round(m.fixed / m.cashIn * 100)}%` : '—'}</td>
                    <td className="r">{fmtUSD(m.signedUsd)}<span className="orv-n">{m.signedN}</span></td>
                    <td className="r"><Delta value={m.dSigned} /></td>
                  </tr>,
                  open && (
                    <tr key={`${m.key}-d`} className="orv-drill">
                      <td colSpan={10}>
                        <div className="orv-drill-h">Where {m.label}’s money went</div>
                        {m.topBuckets.length === 0 ? <div className="orv-empty">No expense lines for this month yet. Upload the statements in Accounting › Statements & documents and run the monthly load.</div> : (
                          <div className="orv-buckets">
                            {m.topBuckets.map(([b, usd]) => (
                              <div key={b} className="orv-bucket">
                                <div className="orv-bucket-k">{b}</div>
                                <div className="orv-bucket-bar"><span style={{ width: `${Math.round(usd / m.topBuckets[0][1] * 100)}%` }} /></div>
                                <div className="orv-bucket-v">{fmtUSD(usd)} <span className="orv-n">{m.cashOut > 0 ? `${Math.round(usd / m.cashOut * 100)}%` : ''}</span></div>
                              </div>
                            ))}
                          </div>
                        )}
                      </td>
                    </tr>
                  ),
                ]
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── 2. STATEMENTS uploaded ───────────────────────────────────── */}
      <section className="orv-sec">
        <div className="orv-sec-head">
          <div>
            <h2 className="orv-h2">Statements in the cabinet</h2>
            <div className="orv-sub">Every account, every month. Upload a month’s statements in Accounting › Statements & documents (label them with the account’s last four) and they show here. Bank statements close at month end, so the current month’s bank columns fill next month.</div>
          </div>
        </div>
        <div className="orv-tablewrap">
          <table className="orv-table orv-cov">
            <thead>
              <tr>
                <th>Account</th>
                {covMonths.map(mk => {
                  const row = coverage.get(mk); const have = [...row.values()].filter(Boolean).length
                  return <th key={mk} className="c">{monthLabel(mk, { short: true })}<div className={`orv-cov-n ${have === STATEMENT_ACCOUNTS.length ? 'full' : ''}`}>{have} of {STATEMENT_ACCOUNTS.length}</div></th>
                })}
              </tr>
            </thead>
            <tbody>
              {STATEMENT_ACCOUNTS.map(a => (
                <tr key={a.key}>
                  <td className="orv-acct">{a.label}<span className="orv-n">{a.kind}</span></td>
                  {covMonths.map(mk => {
                    const d = coverage.get(mk).get(a.key)
                    if (d) return <td key={mk} className="c"><span className="orv-cov-in" title={d.label || d.filename || ''}>in</span></td>
                    if (mk === thisMonth) return <td key={mk} className="c"><span className="orv-cov-wait">not yet</span></td>
                    return <td key={mk} className="c"><span className="orv-cov-miss">missing</span></td>
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── 3. REVIEWS ───────────────────────────────────────────────── */}
      <section className="orv-sec">
        <div className="orv-sec-head">
          <div>
            <h2 className="orv-h2">Owner reviews</h2>
            <div className="orv-sub">The written analysis for each period: an honest score out of 10, what happened, the game plan. The full report opens from the card.</div>
          </div>
          {!form && <button type="button" className="orv-btn gold" onClick={() => startForm(null)}>+ Add a review</button>}
        </div>

        {reviewsAsc.length > 1 && (
          <div className="orv-trend">
            <div className="orv-trend-k">Score trend</div>
            <div className="orv-trend-bars">
              {reviewsAsc.map(r => (
                <div key={r.id} className="orv-trend-col" title={`${periodLabel(r)}: ${r.score ?? '—'} / 10`}>
                  <div className={`orv-trend-bar ${scoreTone(r.score)}`} style={{ height: `${Math.max(4, (r.score || 0) * 10)}%` }} />
                  <div className="orv-trend-lab">{periodLabel(r)}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {form && (
          <div className="orv-form">
            <div className="orv-form-row">
              <label>Period<select value={form.kind} onChange={e => setForm(f => ({ ...f, kind: e.target.value }))}><option value="month">Month</option><option value="quarter">Quarter (3 months from the start)</option><option value="year">Year</option></select></label>
              <label>Start month<input type="month" value={form.startMonth} onChange={e => setForm(f => ({ ...f, startMonth: e.target.value }))} /></label>
              <label>Score (0–10)<input type="number" min="0" max="10" value={form.score} onChange={e => setForm(f => ({ ...f, score: e.target.value }))} /></label>
            </div>
            <label className="orv-form-full">Headline<input type="text" maxLength={160} value={form.headline} placeholder="One line: where the business stands" onChange={e => setForm(f => ({ ...f, headline: e.target.value }))} /></label>
            <label className="orv-form-full">Analysis and game plan<textarea rows={12} value={form.narrative} placeholder="What the numbers say, what to do about it, in order of dollars." onChange={e => setForm(f => ({ ...f, narrative: e.target.value }))} /></label>
            <label className="orv-form-full">Full report link (optional)<input type="url" value={form.report_url} placeholder="https://" onChange={e => setForm(f => ({ ...f, report_url: e.target.value }))} /></label>
            <div className="orv-form-foot">
              <div className="orv-n">The numbers for this period are snapshotted with the review: {(() => { const m = metricsFor(form.kind, form.startMonth || thisMonth); return `in ${fmtUSD(m.cashIn)} · out ${fmtUSD(m.cashOut)} · net ${fmtUSD(m.net)} · fixed ${fmtUSD(m.fixed)} · signed ${fmtUSD(m.signedUsd)}` })()}</div>
              <div className="orv-form-btns">
                <button type="button" className="orv-btn" onClick={() => setForm(null)} disabled={saving}>Cancel</button>
                <button type="button" className="orv-btn gold" onClick={save} disabled={saving}>{saving ? 'Saving…' : (form.id ? 'Save changes' : 'Save review')}</button>
              </div>
            </div>
          </div>
        )}
        {err && <div className="orv-err">{err}</div>}

        {reviews === null ? <div className="orv-empty">Loading reviews…</div>
          : reviews.length === 0 ? <div className="orv-empty">No reviews yet. Add the first one.</div>
          : (
            <div className="orv-cards">
              {reviews.map(r => {
                const long = (r.narrative || '').length > 900
                const open = expanded.has(r.id)
                const m = r.metrics || {}
                return (
                  <article key={r.id} className="orv-card">
                    <div className="orv-card-top">
                      <div className={`orv-score ${scoreTone(r.score)}`}><span className="orv-score-n">{r.score ?? '—'}</span><span className="orv-score-of">/ 10</span></div>
                      <div className="orv-card-main">
                        <div className="orv-card-period">{periodLabel(r)} <span className="orv-n">{r.kind}</span></div>
                        <div className="orv-card-head">{r.headline || '—'}</div>
                        {m.cashIn != null && <div className="orv-card-metrics">in {fmtUSD(m.cashIn)} · out {fmtUSD(m.cashOut)} · net <span className={m.net < 0 ? 'neg' : 'pos'}>{fmtUSD(m.net)}</span>{m.fixed != null && <> · fixed {fmtUSD(m.fixed)}</>}{m.owed != null && <> · owed to us {fmtUSD(m.owed)}</>}</div>}
                      </div>
                      <div className="orv-card-btns">
                        {(r.report_path || r.report_url) && <button type="button" className="orv-btn gold" onClick={() => openReport(r)}>Open the full report</button>}
                        <button type="button" className="orv-btn" onClick={() => startForm(r)}>Edit</button>
                        <button type="button" className="orv-btn danger" onClick={() => remove(r)}>Delete</button>
                      </div>
                    </div>
                    {r.narrative && (
                      <div className={`orv-narr ${long && !open ? 'clamp' : ''}`}>{r.narrative}</div>
                    )}
                    {long && <button type="button" className="orv-link" onClick={() => toggleExpand(r.id)}>{open ? 'Show less' : 'Read the whole review'}</button>}
                    <div className="orv-card-foot">{r.created_by ? `${r.created_by} · ` : ''}written {fmtDate(r.created_at)}{r.updated_at && r.updated_at !== r.created_at ? ` · edited ${fmtDate(r.updated_at)}` : ''}</div>
                  </article>
                )
              })}
            </div>
          )}
      </section>
    </div>
  )
}

const ORV_CSS = `
  .orv { display: flex; flex-direction: column; gap: 22px; min-width: 0; }
  .orv-sec { background: #fff; border: 1px solid #E6E1D6; border-radius: 12px; padding: 18px 20px; min-width: 0; }
  .orv-sec-head { display: flex; justify-content: space-between; gap: 16px; align-items: flex-start; flex-wrap: wrap; margin-bottom: 12px; }
  .orv-h2 { margin: 0 0 4px; font-size: 18px; font-weight: 800; color: #16150F; }
  .orv-sub { font-size: 12.5px; color: #6E6A5E; max-width: 760px; line-height: 1.45; overflow-wrap: anywhere; }
  .orv-tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 10px; margin-bottom: 14px; }
  .orv-tile { background: #FBF9F4; border: 1px solid #ECE7DB; border-radius: 10px; padding: 10px 12px; min-width: 0; }
  .orv-tile-k { font-size: 11px; letter-spacing: .04em; text-transform: uppercase; color: #8A8574; overflow-wrap: anywhere; }
  .orv-tile-v { font-size: 22px; font-weight: 800; color: #16150F; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
  .orv-tile-v.in { color: #1F7A3A; } .orv-tile-v.out { color: #B3261E; }
  .orv-tile-s { font-size: 12px; color: #6E6A5E; }
  .orv-chart-wrap { margin: 4px 0 12px; min-width: 0; }
  .orv-chart { width: 100%; height: auto; display: block; }
  .orv-grid { stroke: #EEEAE0; stroke-width: 1; } .orv-axis { stroke: #CFC8B8; stroke-width: 1; }
  .orv-tick { font-size: 11px; fill: #8A8574; font-variant-numeric: tabular-nums; } .orv-xlab { font-size: 11px; fill: #6E6A5E; }
  .orv-bar.in { fill: #2E8B4F; } .orv-bar.out { fill: #C9433A; }
  .orv-key { display: flex; gap: 8px; align-items: center; font-size: 12px; color: #6E6A5E; margin-top: 4px; }
  .orv-key-sw { display: inline-block; width: 12px; height: 12px; border-radius: 3px; } .orv-key-sw.in { background: #2E8B4F; } .orv-key-sw.out { background: #C9433A; margin-left: 10px; }
  .orv-tablewrap { overflow-x: auto; min-width: 0; }
  .orv-table { width: 100%; border-collapse: collapse; font-size: 13px; }
  .orv-table th { text-align: left; font-size: 11px; letter-spacing: .04em; text-transform: uppercase; color: #8A8574; padding: 8px 8px; border-bottom: 1px solid #E6E1D6; white-space: nowrap; }
  .orv-table th.r, .orv-table td.r { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .orv-table th.c, .orv-table td.c { text-align: center; }
  .orv-table td { padding: 9px 8px; border-bottom: 1px solid #F0ECE3; vertical-align: middle; }
  .orv-row { cursor: pointer; } .orv-row:hover td { background: #FBF9F4; } .orv-row.open td { background: #F6F2E8; }
  .orv-month { font-weight: 700; color: #16150F; white-space: nowrap; }
  .orv-sofar { margin-left: 6px; font-size: 10px; letter-spacing: .04em; text-transform: uppercase; color: #8A8574; background: #F0ECE3; border-radius: 999px; padding: 2px 7px; }
  .orv-table td.in { color: #1F7A3A; font-weight: 700; } .orv-table td.out { color: #B3261E; font-weight: 700; }
  .orv-table td.net { font-weight: 800; } .orv-table td.net.neg, .neg { color: #B3261E; } .orv-table td.net.pos, .pos { color: #1F7A3A; }
  .orv-n { font-size: 11px; color: #9A9484; margin-left: 5px; font-weight: 500; }
  .orv-delta { font-size: 12px; font-weight: 700; border-radius: 999px; padding: 2px 7px; }
  .orv-delta.good { color: #1F7A3A; background: #E8F4EC; } .orv-delta.bad { color: #B3261E; background: #FBE9E7; } .orv-delta.flat, .orv-delta.none { color: #9A9484; }
  .orv-drill td { background: #FBF9F4; padding: 12px 14px 16px; }
  .orv-drill-h { font-size: 12px; letter-spacing: .04em; text-transform: uppercase; color: #8A8574; margin-bottom: 8px; }
  .orv-buckets { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 6px 18px; }
  .orv-bucket { display: grid; grid-template-columns: minmax(0, 1.2fr) minmax(60px, 1fr) auto; gap: 8px; align-items: center; font-size: 12.5px; min-width: 0; }
  .orv-bucket-k { color: #16150F; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
  .orv-bucket-bar { height: 8px; background: #EEEAE0; border-radius: 999px; overflow: hidden; } .orv-bucket-bar span { display: block; height: 100%; background: #C9433A; border-radius: 999px; }
  .orv-bucket-v { font-variant-numeric: tabular-nums; white-space: nowrap; font-weight: 700; color: #16150F; }
  .orv-empty { font-size: 13px; color: #8A8574; padding: 10px 0; }
  .orv-cov th.c { min-width: 86px; } .orv-cov-n { font-size: 11px; font-weight: 700; color: #B3261E; letter-spacing: 0; text-transform: none; } .orv-cov-n.full { color: #1F7A3A; }
  .orv-acct { font-weight: 600; color: #16150F; overflow-wrap: anywhere; min-width: 220px; }
  .orv-cov-in, .orv-cov-miss, .orv-cov-wait { display: inline-block; font-size: 11px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; border-radius: 999px; padding: 3px 9px; }
  .orv-cov-in { background: #E8F4EC; color: #1F7A3A; } .orv-cov-miss { background: #FBE9E7; color: #B3261E; } .orv-cov-wait { background: #F0ECE3; color: #9A9484; }
  .orv-btn { font: inherit; font-size: 13px; padding: 8px 14px; border-radius: 8px; border: 1px solid #D9D2C2; background: #fff; color: #16150F; cursor: pointer; white-space: nowrap; }
  .orv-btn.gold { background: #B8862B; border-color: #B8862B; color: #fff; font-weight: 700; } .orv-btn.danger { color: #B3261E; border-color: #E8B4AF; }
  .orv-btn:disabled { opacity: .55; cursor: default; }
  .orv-link { font: inherit; font-size: 12.5px; color: #8A6413; background: none; border: none; padding: 4px 0; cursor: pointer; text-decoration: underline; }
  .orv-trend { display: flex; gap: 16px; align-items: flex-end; margin: 4px 0 14px; padding: 12px 14px; background: #FBF9F4; border: 1px solid #ECE7DB; border-radius: 10px; min-width: 0; }
  .orv-trend-k { font-size: 11px; letter-spacing: .04em; text-transform: uppercase; color: #8A8574; padding-bottom: 20px; white-space: nowrap; }
  .orv-trend-bars { display: flex; gap: 10px; align-items: flex-end; height: 90px; overflow-x: auto; min-width: 0; flex: 1; }
  .orv-trend-col { display: flex; flex-direction: column; align-items: center; justify-content: flex-end; height: 100%; min-width: 58px; }
  .orv-trend-bar { width: 26px; border-radius: 4px 4px 0 0; background: #CFC8B8; } .orv-trend-bar.good { background: #2E8B4F; } .orv-trend-bar.mid { background: #D9A441; } .orv-trend-bar.bad { background: #C9433A; }
  .orv-trend-lab { font-size: 10px; color: #6E6A5E; margin-top: 4px; white-space: nowrap; }
  .orv-form { border: 1px solid #E6E1D6; border-radius: 10px; padding: 14px; margin-bottom: 14px; background: #FBF9F4; display: flex; flex-direction: column; gap: 10px; min-width: 0; }
  .orv-form-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 10px; }
  .orv-form label { display: flex; flex-direction: column; gap: 4px; font-size: 11px; letter-spacing: .04em; text-transform: uppercase; color: #8A8574; min-width: 0; }
  .orv-form input, .orv-form select, .orv-form textarea { font: inherit; font-size: 13.5px; text-transform: none; letter-spacing: 0; color: #16150F; padding: 8px 10px; border: 1px solid #D9D2C2; border-radius: 8px; background: #fff; min-width: 0; width: 100%; box-sizing: border-box; }
  .orv-form textarea { resize: vertical; line-height: 1.5; }
  .orv-form-foot { display: flex; justify-content: space-between; gap: 12px; align-items: center; flex-wrap: wrap; }
  .orv-form-btns { display: flex; gap: 8px; }
  .orv-err { color: #B3261E; font-size: 13px; margin-bottom: 10px; overflow-wrap: anywhere; }
  .orv-cards { display: flex; flex-direction: column; gap: 12px; }
  .orv-card { border: 1px solid #E6E1D6; border-radius: 12px; padding: 14px 16px; min-width: 0; }
  .orv-card-top { display: flex; gap: 14px; align-items: flex-start; flex-wrap: wrap; }
  .orv-score { display: flex; align-items: baseline; gap: 3px; border-radius: 10px; padding: 8px 12px; min-width: 76px; justify-content: center; }
  .orv-score-n { font-size: 30px; font-weight: 900; line-height: 1; } .orv-score-of { font-size: 12px; font-weight: 700; }
  .orv-score.good { background: #E8F4EC; color: #1F7A3A; } .orv-score.mid { background: #FBF1DC; color: #8A6413; } .orv-score.bad { background: #FBE9E7; color: #B3261E; } .orv-score.none { background: #F0ECE3; color: #9A9484; }
  .orv-card-main { flex: 1 1 320px; min-width: 0; }
  .orv-card-period { font-size: 11px; letter-spacing: .04em; text-transform: uppercase; color: #8A8574; }
  .orv-card-head { font-size: 17px; font-weight: 800; color: #16150F; margin: 2px 0 4px; overflow-wrap: anywhere; }
  .orv-card-metrics { font-size: 12.5px; color: #6E6A5E; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
  .orv-card-btns { display: flex; gap: 6px; flex-wrap: wrap; }
  .orv-narr { white-space: pre-wrap; font-size: 13.5px; line-height: 1.55; color: #2A2820; margin-top: 12px; overflow-wrap: anywhere; }
  .orv-narr.clamp { display: -webkit-box; -webkit-line-clamp: 10; -webkit-box-orient: vertical; overflow: hidden; }
  .orv-card-foot { font-size: 11.5px; color: #9A9484; margin-top: 10px; }
  @media (max-width: 720px) { .orv-sec { padding: 14px; } .orv-card-btns { width: 100%; } }
`
