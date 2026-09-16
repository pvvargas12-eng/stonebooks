// =============================================================================
// HotListBoard — Jobs › Hot list: WHAT NEEDS TO MOVE NOW
// =============================================================================
// Paul 2026-09-16: "I need you to draft a priority list for me in jobs...
// SUPER HOT — what NEEDS TO BE BLASTED IMMEDIATELY, SET, FOUNDATION POURED
// stuff like that. WE NEED TO SEE THE HOT STUFF."
//
// Three ranked sections, each fed by the stores the shop already runs on
// (never a parallel list — the boards and this page can't disagree):
//   • BLAST NOW — new-stone pieces sitting in the Blasting Queue on the floor
//     (stencil stuck = ready to blast; the board's own definition).
//   • SET NOW — install_list jobs where every gate reads green (paid, permit,
//     foundation, blasted) — the truck can roll on these today.
//   • POUR FOUNDATIONS — dig-list rows still open, PLUS blasted stones whose
//     foundation gate reads red but were never put on the dig list (those get
//     a NOT ON DIG LIST chip — the silent blockers Paul can't see anywhere).
//
// Heat score (per order): overdue due date +3 / due inside 14d +2, age 180d+
// +2 / 90d+ +1, paid in full +2 (they paid — every day now is on us).
// Score >= 4 wears the solid-red SUPER HOT tag and floats to the top.
// =============================================================================
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  getJobs, getProductionComponents, getInstallList, getFoundationList,
  installGates, deriveFdnStatus, dueDateTone, dueRelativeText,
  rowTotalPaid, rowBalanceDue, properName, fmtUSD,
} from './lib/stonebooksData'

const INSTALL_KEYS = ['installed', 'door_installed', 'work_completed']
const LEAD_STATUSES = new Set(['draft', 'scoping', 'quoted'])
const TERMINAL_STATUSES = new Set(['closed', 'cancelled'])

// Real production work only — the standing drafts-and-leads-never-on-work-
// lists doctrine (client twin of _filterRealWorkJobIds).
function isRealWork(order) {
  if (!order || order.archived) return false
  if (LEAD_STATUSES.has(order.status) || TERMINAL_STATUSES.has(order.status)) return false
  return rowTotalPaid(order) > 0
}

function ageDays(order) {
  const anchor = order?.signed_at || order?.created_at
  if (!anchor) return null
  const d = Math.floor((Date.now() - new Date(anchor).getTime()) / 86400000)
  return Number.isFinite(d) && d >= 0 ? d : null
}

function heatScore(order) {
  let s = 0
  const tone = dueDateTone(order?.target_completion_date)
  if (tone === 'red') s += 3
  else if (tone === 'amber') s += 2
  const age = ageDays(order)
  if (age != null) {
    if (age >= 180) s += 2
    else if (age >= 90) s += 1
  }
  if (rowTotalPaid(order) > 0 && rowBalanceDue(order) <= 0) s += 2
  return s
}

const SUPER_HOT_AT = 4

function installedDone(job) {
  return (job?.milestones || []).some(m => INSTALL_KEYS.includes(m.milestone_key) && m.status === 'done')
}

export default function HotListBoard({ onOpenOrderDetail, onOpenJob }) {
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState(null)
  const [jobs, setJobs] = useState([])
  const [comps, setComps] = useState([])
  const [installList, setInstallList] = useState([])
  const [fdnList, setFdnList] = useState([])

  const load = useCallback(async () => {
    setLoading(true); setErr(null)
    try {
      const [js, cs, il, fl] = await Promise.all([
        getJobs({ limit: 2000 }),
        getProductionComponents(),
        getInstallList(),
        getFoundationList(),
      ])
      setJobs(js || []); setComps(cs || []); setInstallList(il || []); setFdnList(fl || [])
    } catch (e) { setErr(e?.message || 'Failed to load the hot list') }
    setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  const jobById = useMemo(() => new Map(jobs.map(j => [j.id, j])), [jobs])
  const installSet = useMemo(() => new Set(installList.map(r => r.job_id)), [installList])
  const fdnSet = useMemo(() => new Set(fdnList.map(r => r.job_id)), [fdnList])

  const makeRow = useCallback((job, extraChips = []) => {
    const order = job?.order || null
    if (!isRealWork(order)) return null
    const score = heatScore(order)
    const age = ageDays(order)
    const balance = rowBalanceDue(order)
    return {
      jobId: job.id, orderId: order.id, score,
      family: properName(order.primary_lastname
        || [order.customer?.first_name, order.customer?.last_name].filter(Boolean).join(' ') || '—'),
      orderNumber: order.order_number || 'DRAFT',
      cemetery: job.cemetery?.name || order.cemetery?.name || null,
      age,
      dueText: dueRelativeText(order.target_completion_date),
      dueTone: dueDateTone(order.target_completion_date),
      paidInFull: rowTotalPaid(order) > 0 && balance <= 0,
      balance,
      chips: extraChips,
    }
  }, [])

  // ── BLAST NOW — Blasting Queue occupants (on-floor new-stone dies at
  // stencil_stuck: opened, stuck, waiting for sand). One row per job.
  const blastRows = useMemo(() => {
    const byJob = new Map()
    for (const c of comps) {
      if (c.track !== 'new_stone' || c.component_type === 'base') continue
      if (!c.on_floor || c.current_phase !== 'stencil_stuck') continue
      if (!c.job_id || byJob.has(c.job_id)) continue
      byJob.set(c.job_id, c)
    }
    const rows = []
    for (const jobId of byJob.keys()) {
      const job = jobById.get(jobId)
      if (!job) continue
      const row = makeRow(job)
      if (row) rows.push(row)
    }
    return rows.sort((a, b) => b.score - a.score || (b.age ?? 0) - (a.age ?? 0))
  }, [comps, jobById, makeRow])

  // ── SET NOW — set-list jobs with every gate green and not installed yet.
  const setRows = useMemo(() => {
    const rows = []
    for (const jobId of installSet) {
      const job = jobById.get(jobId)
      if (!job?.order || installedDone(job)) continue
      const g = installGates(job.order, job)
      if (g.paid === false || g.fdn === false || g.permit === false || g.blasted === false) continue
      const row = makeRow(job)
      if (row) rows.push(row)
    }
    return rows.sort((a, b) => b.score - a.score || (b.age ?? 0) - (a.age ?? 0))
  }, [installSet, jobById, makeRow])

  // ── POUR FOUNDATIONS — open dig-list rows + blasted stones whose fdn gate
  // reads red but never made the dig list (the invisible blockers).
  const fdnRows = useMemo(() => {
    const seen = new Set()
    const rows = []
    for (const jobId of fdnSet) {
      const job = jobById.get(jobId)
      if (!job?.order || installedDone(job)) continue
      const code = deriveFdnStatus(job)
      if (['in', 'na', 'drop_off'].includes(code)) continue
      seen.add(jobId)
      const row = makeRow(job, [{ key: 'stage', label: { not_in: 'NOT STARTED', need_map: 'NEEDS MAP', dug: 'DUG', poured: 'POURED — CURING' }[code] || code.toUpperCase(), tone: code === 'poured' ? 'amber' : 'red' }])
      if (row) rows.push(row)
    }
    for (const job of jobs) {
      if (seen.has(job.id) || !job.order || installedDone(job)) continue
      const g = installGates(job.order, job)
      if (g.fdn !== false || g.blasted !== true) continue
      const row = makeRow(job, [{ key: 'nolist', label: 'NOT ON DIG LIST', tone: 'red' }])
      if (row) rows.push(row)
    }
    return rows.sort((a, b) => b.score - a.score || (b.age ?? 0) - (a.age ?? 0))
  }, [fdnSet, jobs, jobById, makeRow])

  const superHotCount = useMemo(() =>
    [...blastRows, ...setRows, ...fdnRows].filter(r => r.score >= SUPER_HOT_AT).length,
  [blastRows, setRows, fdnRows])

  const open = useCallback((row) => {
    if (onOpenOrderDetail && row.orderId) onOpenOrderDetail(row.orderId)
    else if (onOpenJob) onOpenJob(row.jobId)
  }, [onOpenOrderDetail, onOpenJob])

  return (
    <div className="sb-hot">
      <style>{CSS}</style>
      <div className="sb-hot-head">
        <div>
          <div className="sb-hot-title">Hot list</div>
          <div className="sb-hot-lede">What needs to move NOW — hottest first. Rows come straight from the floor, the set list, and the dig list; click one to open the order.</div>
        </div>
        <div className="sb-hot-kpis">
          <div className={`sb-hot-kpi${superHotCount ? ' sb-hot-kpi-super' : ''}`}><b>{superHotCount}</b><span>Super hot</span></div>
          <div className="sb-hot-kpi"><b>{blastRows.length}</b><span>Blast now</span></div>
          <div className="sb-hot-kpi"><b>{setRows.length}</b><span>Set now</span></div>
          <div className="sb-hot-kpi"><b>{fdnRows.length}</b><span>Foundations</span></div>
        </div>
      </div>

      {err && <div className="sb-hot-err">{err}</div>}
      {loading && <div className="sb-hot-empty">Reading the floor, the set list, and the dig list…</div>}

      {!loading && (
        <>
          <HotSection title="BLAST NOW" sub="in the Blasting Queue — stencil stuck, waiting on sand"
            rows={blastRows} empty="Nothing sitting in the Blasting Queue." onOpen={open} />
          <HotSection title="SET NOW" sub="on the set list with every gate green — the truck can roll"
            rows={setRows} empty="Nothing on the set list reads fully green yet." onOpen={open} />
          <HotSection title="POUR FOUNDATIONS" sub="open dig-list work + blasted stones stuck waiting on a foundation"
            rows={fdnRows} empty="No open foundation work is blocking anything." onOpen={open} />
        </>
      )}
    </div>
  )
}

function HotRow({ r, onOpen }) {
  return (
    <button type="button" className={`sb-hot-row${r.score >= SUPER_HOT_AT ? ' sb-hot-row-super' : ''}`} onClick={() => onOpen(r)}>
      <div className="sb-hot-row-main">
        <span className="sb-hot-name">{r.family}</span>
        <span className="sb-hot-num">{r.orderNumber}</span>
        {r.cemetery && <span className="sb-hot-cem">{r.cemetery}</span>}
      </div>
      <div className="sb-hot-row-chips">
        {r.score >= SUPER_HOT_AT && <span className="sb-hot-chip sb-hot-chip-super">SUPER HOT</span>}
        {r.chips.map(c => <span key={c.key} className={`sb-hot-chip sb-hot-chip-${c.tone || 'red'}`}>{c.label}</span>)}
        {r.age != null && (
          <span className={`sb-hot-chip ${r.age >= 180 ? 'sb-hot-chip-red' : r.age >= 90 ? 'sb-hot-chip-amber' : 'sb-hot-chip-quiet'}`}>
            {r.age}d old
          </span>
        )}
        {r.dueText && (
          <span className={`sb-hot-chip ${r.dueTone === 'red' ? 'sb-hot-chip-red' : r.dueTone === 'amber' ? 'sb-hot-chip-amber' : 'sb-hot-chip-quiet'}`}>
            DUE {r.dueText}
          </span>
        )}
        {r.paidInFull
          ? <span className="sb-hot-chip sb-hot-chip-paid">PAID IN FULL — WAITING ON US</span>
          : (r.balance > 0 ? <span className="sb-hot-chip sb-hot-chip-quiet">owes {fmtUSD(r.balance)}</span> : null)}
      </div>
    </button>
  )
}

function HotSection({ title, sub, rows, empty, onOpen }) {
  return (
    <div className="sb-hot-section">
      <div className="sb-hot-sec-head">
        <span className="sb-hot-sec-title">{title}</span>
        <span className={`sb-hot-sec-count${rows.length ? '' : ' zero'}`}>{rows.length}</span>
        <span className="sb-hot-sec-sub">{sub}</span>
      </div>
      {rows.length === 0
        ? <div className="sb-hot-empty">{empty}</div>
        : <div className="sb-hot-rows">{rows.map(r => <HotRow key={r.jobId} r={r} onOpen={onOpen} />)}</div>}
    </div>
  )
}

const CSS = `
  .sb-hot { color: #ECE6D8; }
  .sb-hot-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; flex-wrap: wrap; margin-bottom: 18px; }
  .sb-hot-title { font-size: 22px; font-weight: 800; letter-spacing: 0.01em; color: #0F1419; }
  .sb-hot-lede { font-size: 13px; color: #6B6456; margin-top: 3px; max-width: 560px; }
  .sb-hot-kpis { display: flex; gap: 10px; }
  .sb-hot-kpi { background: #0F1419; border-radius: 12px; padding: 10px 16px; text-align: center; min-width: 86px; }
  .sb-hot-kpi b { display: block; font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 22px; color: #C9A468; }
  .sb-hot-kpi span { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.07em; color: #8a8a85; }
  .sb-hot-kpi-super { background: #B3261E; }
  .sb-hot-kpi-super b, .sb-hot-kpi-super span { color: #fff; }
  .sb-hot-err { background: rgba(179,38,30,0.1); color: #B3261E; border-radius: 10px; padding: 10px 14px; margin-bottom: 12px; font-size: 13px; }
  .sb-hot-section { margin-bottom: 22px; }
  .sb-hot-sec-head { display: flex; align-items: baseline; gap: 10px; margin-bottom: 8px; }
  .sb-hot-sec-title { font-size: 14px; font-weight: 800; letter-spacing: 0.09em; color: #0F1419; }
  .sb-hot-sec-count { font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 13px; font-weight: 700;
    color: #fff; background: #B3261E; border-radius: 999px; padding: 1px 9px; }
  .sb-hot-sec-count.zero { background: #d8d6d1; color: #6a6a66; }
  .sb-hot-sec-sub { font-size: 12px; color: #8a8a85; }
  .sb-hot-rows { display: flex; flex-direction: column; gap: 6px; }
  .sb-hot-row { display: block; width: 100%; text-align: left; cursor: pointer; font: inherit;
    background: #fff; border: 0.5px solid #E2D8C6; border-radius: 12px; padding: 10px 14px; }
  .sb-hot-row:hover { border-color: #9A7209; }
  .sb-hot-row-super { border-left: 4px solid #B3261E; }
  .sb-hot-row-main { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
  .sb-hot-name { font-size: 15px; font-weight: 800; color: #0F1419; }
  .sb-hot-num { font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 12px; color: #6a6a66; }
  .sb-hot-cem { font-size: 12.5px; color: #6B6456; }
  .sb-hot-row-chips { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-top: 5px; }
  .sb-hot-chip { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em;
    border-radius: 5px; padding: 2px 7px; white-space: nowrap; }
  .sb-hot-chip-super { color: #fff; background: #B3261E; font-weight: 800; letter-spacing: 0.07em; }
  .sb-hot-chip-red   { color: #B3261E; background: rgba(179,38,30,0.08); }
  .sb-hot-chip-amber { color: #8a5a12; background: rgba(183,121,31,0.12); }
  .sb-hot-chip-paid  { color: #15724a; background: rgba(29,158,117,0.11); }
  .sb-hot-chip-quiet { color: #6a6a66; background: #f0eee9; text-transform: none; letter-spacing: 0; }
  .sb-hot-empty { font-size: 13px; color: #8a8a85; background: #FBFAF7; border: 0.5px dashed #E2D8C6; border-radius: 10px; padding: 12px 14px; }
`
