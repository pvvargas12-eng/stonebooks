// =============================================================================
// JobsCommandCenter — PART 1: shop-floor command center (READ-ONLY)
// =============================================================================
// A dark "war-room" over the EXISTING Jobs truth — no schema, no new status.
// KPI cards read live counts (jobs + milestones + computeOrderPressure); clicking
// one filters the list below. An on-time gauge and an aging-bottlenecks list give
// the owner read. A placeholder panel reserves the layout for the PART 2 three-
// track production funnel. A Shop Monitor mode goes full-screen + auto-refresh.
//
// Mirrors the Inventory Command Center's .invd-* dark system, namespaced .jobcc-*.
// Counts are never hardcoded — they read ~308 today and fall to ~92 after
// reconciliation closes the phantom orders. That drop is expected and correct.
// =============================================================================
import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { getJobs, computeOrderPressure } from './lib/stonebooksData'
import { currentStage } from './lib/jobsRowHelpers'

const REFRESH_MS = 30000
const DAY_MS = 86400000

const familyOf = (o) => o?.primary_lastname || o?.customer?.last_name || '—'
const msDone = (job, key) => (job?.milestones || []).some(m => m.milestone_key === key && m.status === 'done')
// new Date(<string>) is deterministic (pure) — only bare new Date()/Date.now() in
// render is the React 19 violation. Current time is read once in load() (todayMs).
const dateMs = (d) => (d ? new Date(`${String(d).slice(0, 10)}T00:00:00`).getTime() : null)

function toRow(job) {
  const o = job?.order || null
  const stage = currentStage(job)
  const pressure = o ? computeOrderPressure(o, job, job.milestones || []) : null
  return {
    jobId: job.id,
    family: familyOf(o),
    orderNumber: o?.order_number || '',
    cemetery: o?.cemetery?.name || '',
    stage: stage?.fineLabel || stage?.bucketLabel || 'Intake',
    blocker: pressure?.blocker || null,
    updateMs: job.last_update_at ? dateMs(job.last_update_at) : null,
  }
}

export default function JobsCommandCenter({ onOpenJob, view = 'dashboard' }) {
  const isProductionView = view === 'production'
  const [jobs, setJobs] = useState(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState(null)
  const [syncedAt, setSyncedAt] = useState('')
  const [todayMs, setTodayMs] = useState(0)
  const [activeKpi, setActiveKpi] = useState(isProductionView ? 'in_production' : 'overdue')
  const [monitor, setMonitor] = useState(false)
  const reqRef = useRef(0)

  const load = useCallback(async () => {
    const token = ++reqRef.current
    try {
      const data = await getJobs({ includeClosed: false, limit: 1000 })
      if (token !== reqRef.current) return
      setJobs((data || []).filter(j => j.overall_status !== 'cancelled'))
      setErr(null)
      // Read the clock once, outside render (avoids the React 19 purity lint).
      const d = new Date(); d.setHours(0, 0, 0, 0); setTodayMs(d.getTime())
      setSyncedAt(new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }))
    } catch (e) {
      if (token === reqRef.current) { setErr(e?.message || 'Failed to load jobs'); setJobs([]) }
    } finally {
      if (token === reqRef.current) setLoading(false)
    }
  }, [])
  useEffect(() => { load() }, [load])  // eslint-disable-line react-hooks/set-state-in-effect

  useEffect(() => {
    if (!monitor) return
    const id = setInterval(load, REFRESH_MS)
    return () => clearInterval(id)
  }, [monitor, load])

  useEffect(() => {
    if (!monitor) return
    const onKey = (e) => { if (e.key === 'Escape') setMonitor(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [monitor])

  // Pressure across every job → Overdue (red) / Blocked (amber).
  const pressure = useMemo(() => {
    const red = [], amber = []
    for (const j of (jobs || [])) {
      if (!j?.order) continue
      const p = computeOrderPressure(j.order, j, j.milestones || [])
      if (p?.blocker?.severity === 'red') red.push(j)
      else if (p?.blocker?.severity === 'amber') amber.push(j)
    }
    return { red, amber }
  }, [jobs])

  // Milestone/date-derived metric sets (all from existing truth).
  const metrics = useMemo(() => {
    const list = jobs || []
    const wk = todayMs + 7 * DAY_MS
    const dueWeek = [], readySet = [], inProd = []
    for (const j of list) {
      const tm = dateMs(j.order?.target_completion_date)
      if (tm != null && todayMs && tm >= todayMs && tm <= wk && !msDone(j, 'installed')) dueWeek.push(j)
      if (msDone(j, 'ready_to_install') && !msDone(j, 'installed')) readySet.push(j)
      if (msDone(j, 'production_started') && !msDone(j, 'production_completed')) inProd.push(j)
    }
    return { active: list, dueWeek, readySet, inProd }
  }, [jobs, todayMs])

  // On-time gauge — distribution of DATED, not-yet-installed jobs.
  const gauge = useMemo(() => {
    const wk = todayMs + 7 * DAY_MS
    let onTrack = 0, dueSoon = 0, overdue = 0
    for (const j of (jobs || [])) {
      const tm = dateMs(j.order?.target_completion_date)
      if (tm == null || !todayMs || msDone(j, 'installed')) continue
      if (tm < todayMs) overdue++
      else if (tm <= wk) dueSoon++
      else onTrack++
    }
    return { onTrack, dueSoon, overdue, total: onTrack + dueSoon + overdue }
  }, [jobs, todayMs])

  // Aging bottlenecks — not-done jobs that have sat untouched > 14 days, oldest first.
  const aging = useMemo(() => {
    if (!todayMs) return []
    return (jobs || [])
      .map(toRow)
      .filter(r => r.updateMs && (todayMs - r.updateMs) > 14 * DAY_MS)
      .map(r => ({ ...r, days: Math.floor((todayMs - r.updateMs) / DAY_MS) }))
      .sort((a, b) => b.days - a.days)
      .slice(0, 12)
  }, [jobs, todayMs])

  const kpis = useMemo(() => ([
    { key: 'active',        label: 'Active jobs',   tone: 'green',  value: metrics.active.length, sub: 'in production' },
    { key: 'due_week',      label: 'Due this week', tone: 'amber',  value: metrics.dueWeek.length, sub: 'target within 7 days' },
    { key: 'overdue',       label: 'Overdue',       tone: 'red',    value: pressure.red.length,   sub: 'red — past due / unpaid' },
    { key: 'blocked',       label: 'Blocked',       tone: 'amber',  value: pressure.amber.length, sub: 'amber — waiting / stalled' },
    { key: 'ready_set',     label: 'Ready to set',  tone: 'purple', value: metrics.readySet.length, sub: 'stone ready, not installed' },
    { key: 'in_production', label: 'In production', tone: 'green',  value: metrics.inProd.length, sub: 'cutting → blasting' },
  ]), [metrics, pressure])

  const listRows = useMemo(() => {
    const pick = {
      active: metrics.active, due_week: metrics.dueWeek, overdue: pressure.red,
      blocked: pressure.amber, ready_set: metrics.readySet, in_production: metrics.inProd,
    }[activeKpi] || metrics.active
    return pick.map(toRow)
  }, [activeKpi, metrics, pressure])

  const activeLabel = kpis.find(k => k.key === activeKpi)?.label || ''

  return (
    <div className={`jobcc ${monitor ? 'jobcc-monitor' : ''}`}>
      <style>{JOBCC_CSS}</style>

      <header className="jobcc-cmd">
        <div className="jobcc-cmd-left">
          <h1 className="jobcc-title">{isProductionView ? 'Production' : 'Jobs Command Center'}</h1>
          <div className="jobcc-purpose">{isProductionView
            ? 'Production-floor jobs across the shop — the three-track assembly board lands here next.'
            : "Live shop-floor state — what's overdue, blocked, due, and moving across every department."}</div>
        </div>
        <div className="jobcc-cmd-right">
          <span className="jobcc-live"><span className="jobcc-live-dot" /> LIVE · synced {syncedAt || '—'}{monitor ? ' · auto every 30s · Esc to exit' : ''}</span>
          <div className="jobcc-actions">
            <button type="button" className="jobcc-btn" onClick={load}>Refresh</button>
            <button type="button" className="jobcc-btn" onClick={() => setMonitor(m => !m)}>{monitor ? 'Exit monitor' : 'Shop Monitor'}</button>
          </div>
        </div>
      </header>

      {err && <div className="jobcc-err">{err}</div>}

      {/* KPI CARDS — click to filter the list below */}
      <div className="jobcc-kpis">
        {kpis.map(k => (
          <button type="button" key={k.key}
            className={`jobcc-kpi jobcc-kpi-${k.tone} ${activeKpi === k.key ? 'jobcc-kpi-on' : ''}`}
            onClick={() => setActiveKpi(k.key)}>
            <div className="jobcc-kpi-label">{k.label}</div>
            <div className="jobcc-kpi-value">{loading ? '—' : k.value}</div>
            <div className="jobcc-kpi-sub">{k.sub}</div>
          </button>
        ))}
      </div>

      {/* ON-TIME GAUGE + AGING BOTTLENECKS */}
      <div className="jobcc-grid">
        <OnTimeGauge gauge={gauge} loading={loading} />
        <section className="jobcc-panel">
          <div className="jobcc-panel-head">
            <span className="jobcc-panel-title">Aging bottlenecks</span>
            <span className="jobcc-panel-count jobcc-c-amber">{loading ? '—' : aging.length}</span>
          </div>
          <div className="jobcc-panel-hint">Not touched in 14+ days — oldest first.</div>
          {loading ? <div className="jobcc-empty">Loading…</div>
            : aging.length === 0 ? <div className="jobcc-empty jobcc-empty-ok">✓ Nothing stale — everything's moving.</div>
            : (
              <div className="jobcc-alerts">
                {aging.map(r => (
                  <button type="button" key={r.jobId} className="jobcc-alert" onClick={() => onOpenJob?.(r.jobId)}>
                    <div className="jobcc-alert-top">
                      <span className="jobcc-alert-fam">{r.family}</span>
                      <span className="jobcc-tag jobcc-tag-amber">{r.days}d</span>
                      {r.blocker && <span className={`jobcc-tag jobcc-tag-${r.blocker.severity === 'red' ? 'red' : 'amber'}`}>{r.blocker.label}</span>}
                    </div>
                    <div className="jobcc-alert-spec">{r.stage}{r.orderNumber || r.cemetery ? ` · ${[r.orderNumber, r.cemetery].filter(Boolean).join(' · ')}` : ''}</div>
                  </button>
                ))}
              </div>
            )}
        </section>
      </div>

      {/* PRODUCTION FLOOR — PART 2 placeholder */}
      <section className="jobcc-panel jobcc-floor">
        <div className="jobcc-panel-head"><span className="jobcc-panel-title">Production floor — three tracks</span></div>
        <div className="jobcc-floor-stub">
          <div className="jobcc-floor-tracks">
            {['New Stone', 'Inscription', 'Mausoleum Door'].map(t => (
              <div key={t} className="jobcc-floor-track"><span className="jobcc-floor-track-l">{t}</span></div>
            ))}
          </div>
          <div className="jobcc-floor-note">⚙ Production tracking coming online — per-component assembly board (Part 2).</div>
        </div>
      </section>

      {/* JOB LIST — reflects the selected KPI */}
      <section className="jobcc-panel">
        <div className="jobcc-panel-head">
          <span className="jobcc-panel-title">{activeLabel}</span>
          <span className="jobcc-panel-count">{loading ? '—' : listRows.length}</span>
        </div>
        {loading ? <div className="jobcc-empty">Loading…</div>
          : listRows.length === 0 ? <div className="jobcc-empty jobcc-empty-ok">✓ Nothing here — all clear.</div>
          : (
            <div className="jobcc-rows">
              {listRows.map(r => (
                <button type="button" key={r.jobId} className="jobcc-row" onClick={() => onOpenJob?.(r.jobId)}>
                  <span className="jobcc-row-fam">{r.family}</span>
                  <span className="jobcc-row-stage">{r.stage}</span>
                  {r.blocker
                    ? <span className={`jobcc-tag jobcc-tag-${r.blocker.severity === 'red' ? 'red' : 'amber'}`}>{r.blocker.label}</span>
                    : <span className="jobcc-row-clear">on track</span>}
                  <span className="jobcc-row-meta">{[r.orderNumber, r.cemetery].filter(Boolean).join(' · ')}</span>
                </button>
              ))}
            </div>
          )}
      </section>
    </div>
  )
}

function OnTimeGauge({ gauge, loading }) {
  const { onTrack, dueSoon, overdue, total } = gauge
  const pct = (n) => total ? Math.round((n / total) * 100) : 0
  const a = total ? (onTrack / total) * 100 : 0
  const b = total ? a + (dueSoon / total) * 100 : 0
  const ring = total
    ? `conic-gradient(#34d399 0 ${a}%, #fbbf24 ${a}% ${b}%, #f87171 ${b}% 100%)`
    : 'conic-gradient(#232a35 0 100%)'
  return (
    <section className="jobcc-panel">
      <div className="jobcc-panel-head"><span className="jobcc-panel-title">On-time</span><span className="jobcc-panel-count">{loading ? '—' : total} dated</span></div>
      <div className="jobcc-gauge">
        <div className="jobcc-donut" style={{ background: ring }}>
          <div className="jobcc-donut-hole">
            <div className="jobcc-donut-n">{loading ? '—' : `${pct(onTrack)}%`}</div>
            <div className="jobcc-donut-l">on track</div>
          </div>
        </div>
        <div className="jobcc-legend">
          <div className="jobcc-leg"><span className="jobcc-dot jobcc-dot-green" /> On track <strong>{onTrack}</strong> <span className="jobcc-leg-pct">{pct(onTrack)}%</span></div>
          <div className="jobcc-leg"><span className="jobcc-dot jobcc-dot-amber" /> Due this week <strong>{dueSoon}</strong> <span className="jobcc-leg-pct">{pct(dueSoon)}%</span></div>
          <div className="jobcc-leg"><span className="jobcc-dot jobcc-dot-red" /> Overdue <strong>{overdue}</strong> <span className="jobcc-leg-pct">{pct(overdue)}%</span></div>
        </div>
      </div>
    </section>
  )
}

const JOBCC_CSS = `
  .jobcc { background: #0E1116; border-radius: 16px; padding: 22px 24px 26px; color: #e6e9ef;
    font-family: var(--font-b, 'Lato'), 'Helvetica Neue', sans-serif; }
  .jobcc * { box-sizing: border-box; }
  .jobcc-monitor { position: fixed; inset: 0; z-index: 9000; border-radius: 0; overflow-y: auto; padding: 28px 36px 40px; }

  .jobcc-cmd { display: flex; align-items: flex-start; justify-content: space-between; gap: 20px; flex-wrap: wrap; margin-bottom: 22px; }
  .jobcc-title { font-size: 22px; font-weight: 700; color: #f4f6fa; margin: 0; letter-spacing: -0.01em; }
  .jobcc-monitor .jobcc-title { font-size: 30px; }
  .jobcc-purpose { font-size: 13px; color: #8b95a5; margin-top: 4px; max-width: 560px; }
  .jobcc-cmd-right { display: flex; flex-direction: column; align-items: flex-end; gap: 10px; }
  .jobcc-live { font-family: var(--font-m, 'JetBrains Mono'), monospace; font-size: 11.5px; letter-spacing: 0.06em; color: #34d399; display: inline-flex; align-items: center; gap: 7px; }
  .jobcc-live-dot { width: 7px; height: 7px; border-radius: 50%; background: #34d399; box-shadow: 0 0 8px #34d399; }
  .jobcc-actions { display: flex; gap: 8px; }
  .jobcc-btn { font: inherit; font-size: 13px; font-weight: 600; padding: 7px 14px; border-radius: 8px; border: 1px solid #2a313c; background: #1a212b; color: #e6e9ef; cursor: pointer; }
  .jobcc-btn:hover { background: #232c38; border-color: #3a4452; }
  .jobcc-err { background: #1c1416; border: 1px solid #5c2a2a; color: #f87171; padding: 10px 12px; border-radius: 9px; margin-bottom: 14px; }

  .jobcc-kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 12px; margin-bottom: 18px; }
  .jobcc-kpi { text-align: left; font: inherit; cursor: pointer; background: #11151c; border: 1px solid #20262f; border-left-width: 3px; border-radius: 11px; padding: 13px 15px; transition: background .12s, border-color .12s; }
  .jobcc-kpi:hover { background: #151b24; }
  .jobcc-kpi-on { background: #1a2230; border-color: #3a4452; box-shadow: inset 0 0 0 1px #3a4452; }
  .jobcc-kpi-label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: #8b95a5; }
  .jobcc-kpi-value { font-family: var(--font-m, 'JetBrains Mono'), monospace; font-size: 30px; font-weight: 700; line-height: 1.1; margin: 4px 0 3px; color: #f4f6fa; }
  .jobcc-monitor .jobcc-kpi-value { font-size: 44px; }
  .jobcc-kpi-sub { font-size: 11.5px; color: #6f7a8a; }
  .jobcc-kpi-green  { border-left-color: #34d399; }
  .jobcc-kpi-amber  { border-left-color: #fbbf24; }
  .jobcc-kpi-red    { border-left-color: #f87171; }
  .jobcc-kpi-purple { border-left-color: #a78bfa; }

  .jobcc-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 16px; }
  @media (max-width: 1000px) { .jobcc-grid { grid-template-columns: 1fr; } }
  .jobcc-panel { background: #11151c; border: 1px solid #20262f; border-radius: 12px; padding: 15px 17px; margin-bottom: 16px; }
  .jobcc-panel-head { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
  .jobcc-panel-title { font-size: 13px; font-weight: 700; color: #f4f6fa; text-transform: uppercase; letter-spacing: 0.04em; }
  .jobcc-panel-count { font-family: var(--font-m, 'JetBrains Mono'), monospace; font-size: 12px; font-weight: 700; padding: 1px 8px; border-radius: 999px; background: #1a212b; color: #c7cedb; }
  .jobcc-panel-hint { font-size: 11.5px; color: #6f7a8a; margin-bottom: 10px; }
  .jobcc-c-red { color: #f87171; } .jobcc-c-amber { color: #fbbf24; }
  .jobcc-empty { color: #6f7a8a; font-size: 13px; padding: 10px 2px; }
  .jobcc-empty-ok { color: #34d399; }

  .jobcc-gauge { display: flex; align-items: center; gap: 22px; padding: 6px 0 2px; }
  .jobcc-donut { width: 120px; height: 120px; border-radius: 50%; flex-shrink: 0; display: flex; align-items: center; justify-content: center; }
  .jobcc-donut-hole { width: 82px; height: 82px; border-radius: 50%; background: #11151c; display: flex; flex-direction: column; align-items: center; justify-content: center; }
  .jobcc-donut-n { font-family: var(--font-m, 'JetBrains Mono'), monospace; font-size: 24px; font-weight: 700; color: #f4f6fa; }
  .jobcc-donut-l { font-size: 10.5px; color: #8b95a5; text-transform: uppercase; letter-spacing: 0.04em; }
  .jobcc-legend { display: flex; flex-direction: column; gap: 8px; }
  .jobcc-leg { font-size: 13px; color: #c7cedb; display: flex; align-items: center; gap: 8px; }
  .jobcc-leg strong { color: #f4f6fa; }
  .jobcc-leg-pct { font-family: var(--font-m, 'JetBrains Mono'), monospace; font-size: 11.5px; color: #6f7a8a; }
  .jobcc-dot { width: 9px; height: 9px; border-radius: 50%; }
  .jobcc-dot-green { background: #34d399; } .jobcc-dot-amber { background: #fbbf24; } .jobcc-dot-red { background: #f87171; }

  .jobcc-alerts { display: flex; flex-direction: column; gap: 9px; }
  .jobcc-alert { text-align: left; font: inherit; cursor: pointer; width: 100%; background: #151a22; border: 1px solid #232a35; border-radius: 9px; padding: 10px 12px; color: #e6e9ef; }
  .jobcc-alert:hover { background: #1a212b; }
  .jobcc-alert-top { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
  .jobcc-alert-fam { font-size: 14px; font-weight: 700; color: #f4f6fa; }
  .jobcc-alert-spec { font-family: var(--font-m, 'JetBrains Mono'), monospace; font-size: 11.5px; color: #c7cedb; }

  .jobcc-floor-stub { display: flex; flex-direction: column; gap: 12px; }
  .jobcc-floor-tracks { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
  .jobcc-floor-track { background: #151a22; border: 1px dashed #2a3340; border-radius: 9px; padding: 18px 12px; text-align: center; }
  .jobcc-floor-track-l { font-size: 13px; font-weight: 700; color: #8b95a5; text-transform: uppercase; letter-spacing: 0.04em; }
  .jobcc-floor-note { font-size: 12.5px; color: #6f7a8a; }

  .jobcc-rows { display: flex; flex-direction: column; }
  .jobcc-row { text-align: left; font: inherit; cursor: pointer; display: grid; grid-template-columns: 1.4fr 1fr auto 1.3fr; gap: 12px; align-items: center;
    background: transparent; border: none; border-top: 1px solid #1c222b; padding: 9px 4px; color: #e6e9ef; }
  .jobcc-row:hover { background: #151b24; }
  .jobcc-row-fam { font-size: 14px; font-weight: 700; color: #f4f6fa; }
  .jobcc-monitor .jobcc-row-fam { font-size: 17px; }
  .jobcc-row-stage { font-size: 12.5px; color: #c7cedb; }
  .jobcc-row-meta { font-family: var(--font-m, 'JetBrains Mono'), monospace; font-size: 11.5px; color: #6f7a8a; text-align: right; }
  .jobcc-row-clear { font-size: 11px; color: #34d399; }
  .jobcc-tag { font-size: 9.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; padding: 2px 8px; border-radius: 999px; justify-self: start; }
  .jobcc-tag-red { background: #3a1d1d; color: #f87171; }
  .jobcc-tag-amber { background: #322712; color: #fbbf24; }
`
