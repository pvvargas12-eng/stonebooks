// =============================================================================
// InstallBoard — Installation hub: readiness-gated install board (Phase 1, read-only)
// =============================================================================
// Five gates decide "Ready to set". A card is ready only when ALL applicable gates
// are green. Scoped to stone-DONE jobs (the stone is physically finished and ready
// to leave the shop) — a stone still in production stays on the Production floor,
// not here. Dark .jobcc-* command-center style.
//
//   1. Stone done   — job_components: all at the track's STRICT terminal phase, none
//                     held at QC. new_stone→ready_to_set · bronze→mounted_on_base(+) ·
//                     inscription→inscription_complete · door→drop_off_doors.
//   2. Foundation   — deriveFdnStatus(job)==='in'. N/A (dash) for inscription + door.
//   3. Paid in full — rowBalanceDue(order)===0 (read-only).
//   4. Cemetery set — order.cemetery_id present.
//   5. Permit ok    — order.permit_status ∈ {approved, not_required} (or not needed).
// =============================================================================
import { useState, useEffect, useMemo, useCallback } from 'react'
import { getProductionComponents, deriveFdnStatus, rowBalanceDue, permitNeeded } from '../lib/stonebooksData'
import { composeGraveLocation } from '../lib/monumentCatalog'
import { TRACK_LABEL, phaseIndex } from '../lib/jobComponents'
import { JOBCC_BASE_CSS } from './jobccBase'

// Track's STRICT terminal phase for "stone done" (decision-locked).
const TERMINAL = { new_stone: 'ready_to_set', bronze: 'mounted_on_base', inscription: 'inscription_complete', door: 'drop_off_doors' }
const FDN_TRACKS = new Set(['new_stone', 'bronze'])   // inscription + door need no foundation
const TRACK_TONE = { new_stone: 'green', inscription: 'amber', bronze: 'purple', door: 'blue' }
const GATE_DEFS = [
  { key: 'stone', label: 'Stone' }, { key: 'fdn', label: 'Fdn' }, { key: 'paid', label: 'Paid' },
  { key: 'cem', label: 'Cemetery' }, { key: 'permit', label: 'Permit' },
]
const installMilestone = (job) => {
  const by = new Map((job.milestones || []).map(m => [m.milestone_key, m]))
  return by.get('installed') || by.get('door_installed') || by.get('work_completed') || null
}

export default function InstallBoard({ jobs, onOpenJob, onOpenOrderDetail }) {
  const [components, setComponents] = useState(null)
  const [monthKey, setMonthKey] = useState('')
  const [activeKpi, setActiveKpi] = useState('ready')

  const load = useCallback(async () => {
    const d = await getProductionComponents()
    setComponents(d || [])
    const now = new Date(); setMonthKey(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`)
  }, [])
  useEffect(() => { load() }, [load])  // eslint-disable-line react-hooks/set-state-in-effect

  // Index components by job_id → track + phases + cemetery/order context.
  const byJob = useMemo(() => {
    const m = new Map()
    for (const c of (components || [])) {
      if (!c.job_id) continue
      if (!m.has(c.job_id)) m.set(c.job_id, {
        track: c.track, comps: [],
        cemetery: c.order?.cemetery?.name || c.cemetery_order?.cemetery_name || '',
        orderNumber: c.order?.order_number || c.cemetery_order?.order_number || '',
      })
      m.get(c.job_id).comps.push(c)
    }
    return m
  }, [components])

  // Per-job gate evaluation. Only stone-DONE jobs surface (the rest are production).
  const buckets = useMemo(() => {
    const out = { ready: [], scheduled: [], blocked: [], foundationNeeded: [], doneThisMonth: [] }
    if (components == null) return out
    for (const job of (jobs || [])) {
      const ci = byJob.get(job.id)
      if (!ci) continue
      const track = ci.track
      const order = job.order || {}
      // Gate 1 — strict terminal, no QC hold.
      const termIdx = phaseIndex(track, TERMINAL[track])
      const stoneDone = ci.comps.length > 0 && ci.comps.every(c => !c.qc_issue && phaseIndex(track, c.current_phase) >= termIdx && termIdx >= 0)
      const ms = installMilestone(job)
      const installed = ms?.status === 'done'
      if (installed) {
        if (ms?.status_date && String(ms.status_date).slice(0, 7) === monthKey) {
          out.doneThisMonth.push(makeRow(job, ci, order, { installed: true }))
        }
        continue
      }
      if (!stoneDone) continue   // still in production — not an install concern
      // Gates 2–5.
      const needsFdn = FDN_TRACKS.has(track)
      const fdn = needsFdn ? (deriveFdnStatus(job) === 'in') : null   // null = N/A
      const paid = rowBalanceDue(order) === 0
      const cem = !!order.cemetery_id
      const permit = order.permit_status === 'approved' || order.permit_status === 'not_required' || !permitNeeded(order)
      const gates = { stone: true, fdn, paid, cem, permit }
      const unmet = []
      if (fdn === false) unmet.push('foundation')
      if (!paid) unmet.push('balance')
      if (!cem) unmet.push('cemetery')
      if (!permit) unmet.push('permit')
      const scheduled = ms?.status === 'in_progress'
      const row = makeRow(job, ci, order, { gates, unmet, scheduled })
      if (needsFdn && fdn === false) out.foundationNeeded.push(row)
      if (scheduled) out.scheduled.push(row)
      else if (unmet.length === 0) out.ready.push(row)
      else out.blocked.push(row)
    }
    return out
  }, [components, jobs, byJob, monthKey])

  const loading = components == null
  const kpis = [
    { key: 'ready', label: 'Ready to set', tone: 'green', value: buckets.ready.length, sub: 'all 5 gates green' },
    { key: 'scheduled', label: 'Scheduled', tone: 'purple', value: buckets.scheduled.length, sub: 'install date set' },
    { key: 'blocked', label: 'Blocked', tone: 'red', value: buckets.blocked.length, sub: 'stone done, gate unmet' },
    { key: 'foundation', label: 'Foundation needed', tone: 'amber', value: buckets.foundationNeeded.length, sub: 'pour not in' },
    { key: 'done', label: 'Done this month', tone: 'green', value: buckets.doneThisMonth.length, sub: 'installed' },
  ]
  const sectionRows = { ready: buckets.ready, scheduled: buckets.scheduled, blocked: buckets.blocked, foundation: buckets.foundationNeeded, done: buckets.doneThisMonth }[activeKpi] || buckets.ready
  const sectionLabel = kpis.find(k => k.key === activeKpi)?.label || ''
  const groupByCem = activeKpi !== 'done'

  return (
    <div className="jobcc ib">
      <style>{JOBCC_BASE_CSS}{IB_CSS}</style>
      <header className="jobcc-cmd">
        <div className="jobcc-cmd-left">
          <h1 className="jobcc-title">Installation</h1>
          <div className="jobcc-purpose">Stones physically done — gated to "Ready to set" by foundation, payment, cemetery, and permit. Ready ones cluster by cemetery so loading a run is obvious.</div>
        </div>
        <div className="jobcc-cmd-right"><div className="jobcc-actions"><button type="button" className="jobcc-btn" onClick={load}>Refresh</button></div></div>
      </header>

      <div className="jobcc-kpis">
        {kpis.map(k => (
          <button type="button" key={k.key} className={`jobcc-kpi jobcc-kpi-${k.tone} ${activeKpi === k.key ? 'jobcc-kpi-on' : ''}`} onClick={() => setActiveKpi(k.key)}>
            <div className="jobcc-kpi-label">{k.label}</div>
            <div className="jobcc-kpi-value">{loading ? '—' : k.value}</div>
            <div className="jobcc-kpi-sub">{k.sub}</div>
          </button>
        ))}
      </div>

      <section className="jobcc-panel">
        <div className="jobcc-panel-head"><span className="jobcc-panel-title">{sectionLabel}</span><span className="jobcc-panel-count">{loading ? '—' : sectionRows.length}</span></div>
        {loading ? <div className="jobcc-empty">Loading…</div>
          : sectionRows.length === 0 ? <div className="jobcc-empty jobcc-empty-ok">✓ Nothing here.</div>
          : groupByCem ? groupByCemetery(sectionRows).map(([cem, rows]) => (
            <div key={cem} className="ib-group">
              <div className="ib-group-head">{cem || 'Cemetery not set'} <span className="ib-group-n">{rows.length}</span></div>
              <div className="ib-cards">{rows.map(r => <InstallCard key={r.jobId} row={r} onOpenJob={onOpenJob} onOpenOrderDetail={onOpenOrderDetail} />)}</div>
            </div>
          ))
          : <div className="ib-cards">{sectionRows.map(r => <InstallCard key={r.jobId} row={r} onOpenJob={onOpenJob} onOpenOrderDetail={onOpenOrderDetail} />)}</div>}
      </section>
    </div>
  )
}

function makeRow(job, ci, order, extra) {
  return {
    jobId: job.id, orderId: order.id || null,
    family: order.primary_lastname || '—',
    orderNumber: ci.orderNumber || order.order_number || '',
    track: ci.track, cemetery: ci.cemetery || '',
    grave: composeGraveLocation(order) || '',
    ...extra,
  }
}
function groupByCemetery(rows) {
  const m = new Map()
  for (const r of rows) { const k = r.cemetery || ''; if (!m.has(k)) m.set(k, []); m.get(k).push(r) }
  return [...m.entries()].sort((a, b) => (a[0] || '~').localeCompare(b[0] || '~'))
}

function InstallCard({ row, onOpenJob, onOpenOrderDetail }) {
  const tone = TRACK_TONE[row.track] || 'neutral'
  return (
    <div className="ib-card">
      <div className="ib-card-top">
        <button type="button" className="ib-card-fam" onClick={() => onOpenJob?.(row.jobId)}>{row.family}</button>
        <span className={`ib-track ib-track-${tone}`}>{TRACK_LABEL[row.track] || row.track}</span>
      </div>
      <div className="ib-card-meta">
        {row.orderNumber && <button type="button" className="ib-card-ord" onClick={() => row.orderId && onOpenOrderDetail?.(row.orderId)}>{row.orderNumber}</button>}
        <span className="ib-card-cem">{[row.cemetery, row.grave].filter(Boolean).join(' · ') || '—'}</span>
      </div>
      {!row.installed && (
        <div className="ib-gates">
          {GATE_DEFS.map(g => {
            const v = row.gates ? row.gates[g.key] : (g.key === 'stone' ? true : null)
            const cls = v === true ? 'ok' : v === false ? 'no' : 'na'
            const mark = v === true ? '✓' : v === false ? '✗' : '–'
            return <span key={g.key} className={`ib-gate ib-gate-${cls}`}><span className="ib-gate-m">{mark}</span>{g.label}</span>
          })}
        </div>
      )}
      {row.installed && <div className="ib-installed">✓ Installed</div>}
      {row.unmet && row.unmet.length > 0 && <div className="ib-blocked">Blocked: {row.unmet.join(' + ')}</div>}
    </div>
  )
}

const IB_CSS = `
  .ib-group { margin-bottom: 14px; }
  .ib-group-head { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: #c7cedb; margin: 6px 0 8px; display: flex; align-items: center; gap: 8px; }
  .ib-group-n { font-family: var(--font-m, 'JetBrains Mono'), monospace; font-size: 11px; color: #6f7a8a; background: #1a212b; border-radius: 999px; padding: 1px 8px; }
  .ib-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 10px; }
  .ib-card { background: #151a22; border: 1px solid #232a35; border-radius: 10px; padding: 11px 13px; }
  .ib-card-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .ib-card-fam { font: inherit; font-size: 14.5px; font-weight: 700; color: #f4f6fa; background: none; border: none; cursor: pointer; padding: 0; text-align: left; }
  .ib-card-fam:hover { color: #fff; text-decoration: underline; }
  .ib-track { font-size: 9.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; border-radius: 999px; padding: 2px 8px; }
  .ib-track-green { background: #15301f; color: #34d399; } .ib-track-amber { background: #322712; color: #fbbf24; }
  .ib-track-purple { background: #261f3a; color: #a78bfa; } .ib-track-blue { background: #16263a; color: #6fb3f0; }
  .ib-track-neutral { background: #1a212b; color: #8b95a5; }
  .ib-card-meta { display: flex; align-items: center; gap: 8px; margin-top: 4px; flex-wrap: wrap; }
  .ib-card-ord { font: inherit; font-family: var(--font-m, 'JetBrains Mono'), monospace; font-size: 11px; color: #6fb3f0; background: none; border: none; cursor: pointer; padding: 0; }
  .ib-card-cem { font-size: 11.5px; color: #8b95a5; }
  .ib-gates { display: flex; gap: 5px; margin-top: 9px; flex-wrap: wrap; }
  .ib-gate { font-size: 10px; font-weight: 600; color: #8b95a5; display: inline-flex; align-items: center; gap: 3px; background: #11151c; border: 1px solid #20262f; border-radius: 6px; padding: 2px 7px; }
  .ib-gate-m { font-weight: 800; }
  .ib-gate-ok { color: #34d399; border-color: #1f3a2a; } .ib-gate-ok .ib-gate-m { color: #34d399; }
  .ib-gate-no { color: #f87171; border-color: #3a2020; } .ib-gate-no .ib-gate-m { color: #f87171; }
  .ib-gate-na { color: #5a6470; }
  .ib-blocked { font-size: 11px; color: #f87171; margin-top: 8px; font-weight: 600; }
  .ib-installed { font-size: 11.5px; color: #34d399; margin-top: 8px; font-weight: 600; }
`
