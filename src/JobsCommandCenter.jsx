// =============================================================================
// JobsCommandCenter — Phase A: shop-floor command center (READ-ONLY reskin)
// =============================================================================
// A dark "war-room" surface over the EXISTING Jobs truth — no schema, no new
// status. KPI cards read live hub counts (getHubWorkItems) + Overdue/Blocked
// (computeOrderPressure); clicking a card filters the job list below. Two alert
// panels surface red/amber pressure. A Shop Monitor mode goes full-screen with
// large type + auto-refresh for the shop wall.
//
// Mirrors the Inventory Command Center's .invd-* dark system, namespaced .jobcc-*.
// Counts are never hardcoded — they read ~308 today and will fall to ~92 after
// reconciliation closes the phantom orders. That drop is expected and correct.
// =============================================================================
import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { getJobs, HUB_DEFS, getHubWorkItems, computeOrderPressure } from './lib/stonebooksData'
import { currentStage } from './lib/jobsRowHelpers'

const HUB_ORDER = ['admin', 'design', 'production', 'installation']
const HUB_TONE = { admin: 'purple', design: 'amber', production: 'green', installation: 'green' }
const REFRESH_MS = 30000

const familyOf = (o) => o?.primary_lastname || o?.customer?.last_name || '—'

// One display row from either a hub work-item or a pressure item.
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
  }
}

export default function JobsCommandCenter({ onOpenJob }) {
  const [jobs, setJobs] = useState(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState(null)
  const [syncedAt, setSyncedAt] = useState('')
  const [activeKpi, setActiveKpi] = useState('overdue')   // which card filters the list
  const [monitor, setMonitor] = useState(false)
  const reqRef = useRef(0)

  const load = useCallback(async () => {
    const token = ++reqRef.current
    try {
      const data = await getJobs({ includeClosed: false, limit: 1000 })
      if (token !== reqRef.current) return
      setJobs((data || []).filter(j => j.overall_status !== 'cancelled'))
      setErr(null)
      // Stamp outside render (avoids the React 19 new-Date-in-render lint).
      setSyncedAt(new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }))
    } catch (e) {
      if (token === reqRef.current) { setErr(e?.message || 'Failed to load jobs'); setJobs([]) }
    } finally {
      if (token === reqRef.current) setLoading(false)
    }
  }, [])
  useEffect(() => { load() }, [load])  // eslint-disable-line react-hooks/set-state-in-effect

  // Shop Monitor auto-refresh — only while monitor mode is on.
  useEffect(() => {
    if (!monitor) return
    const id = setInterval(load, REFRESH_MS)
    return () => clearInterval(id)
  }, [monitor, load])

  // Escape exits the full-screen shop wall.
  useEffect(() => {
    if (!monitor) return
    const onKey = (e) => { if (e.key === 'Escape') setMonitor(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [monitor])

  // Hub counts — the exact same derivation the Hubs view uses (no copy).
  const hubData = useMemo(() => {
    if (!jobs) return null
    return Object.fromEntries(HUB_ORDER.map(h => [h, getHubWorkItems(h, jobs)]))
  }, [jobs])

  // Pressure across every job → Overdue (red) / Blocked (amber) headline + panels.
  const pressure = useMemo(() => {
    const red = [], amber = []
    for (const j of (jobs || [])) {
      if (!j?.order) continue
      const p = computeOrderPressure(j.order, j, j.milestones || [])
      if (!p?.blocker) continue
      if (p.blocker.severity === 'red') red.push(j)
      else if (p.blocker.severity === 'amber') amber.push(j)
    }
    return { red, amber }
  }, [jobs])

  const kpis = useMemo(() => ([
    ...HUB_ORDER.map(h => ({
      key: h, label: HUB_DEFS[h].label, tone: HUB_TONE[h],
      value: hubData?.[h]?.counts.total ?? 0,
      sub: `${hubData?.[h]?.counts.urgent ?? 0} need attention`,
    })),
    { key: 'overdue', label: 'Overdue', tone: 'red', value: pressure.red.length, sub: 'red — past due / unpaid' },
    { key: 'blocked', label: 'Blocked', tone: 'amber', value: pressure.amber.length, sub: 'amber — waiting / stalled' },
  ]), [hubData, pressure])

  // Alert panels — the at-a-glance red/amber lists (always visible).
  const alertRows = useMemo(() => ({
    red: pressure.red.map(toRow),
    amber: pressure.amber.map(toRow),
  }), [pressure])

  // The list below reflects the selected card.
  const listRows = useMemo(() => {
    if (!jobs) return []
    let src
    if (activeKpi === 'overdue') src = pressure.red
    else if (activeKpi === 'blocked') src = pressure.amber
    else src = (hubData?.[activeKpi]?.items || []).map(it => it.job)
    return src.map(toRow)
  }, [jobs, activeKpi, hubData, pressure])

  const activeLabel = kpis.find(k => k.key === activeKpi)?.label || ''

  return (
    <div className={`jobcc ${monitor ? 'jobcc-monitor' : ''}`}>
      <style>{JOBCC_CSS}</style>

      <header className="jobcc-cmd">
        <div className="jobcc-cmd-left">
          <h1 className="jobcc-title">Jobs Command Center</h1>
          <div className="jobcc-purpose">Live shop-floor state — what's overdue, blocked, and moving across every department.</div>
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

      {/* ALERT PANELS — red/amber pressure at a glance */}
      <div className="jobcc-grid">
        <AlertPanel title="Overdue" tone="red" rows={alertRows.red} loading={loading} onOpenJob={onOpenJob}
          empty="✓ Nothing overdue — no red blockers." />
        <AlertPanel title="Blocked / Waiting" tone="amber" rows={alertRows.amber} loading={loading} onOpenJob={onOpenJob}
          empty="✓ Nothing blocked — no amber holds." />
      </div>

      {/* JOB LIST — reflects the selected card */}
      <section className="jobcc-panel">
        <div className="jobcc-panel-head">
          <span className="jobcc-panel-title">{activeLabel}</span>
          <span className="jobcc-panel-count">{loading ? '—' : listRows.length}</span>
        </div>
        {loading ? (
          <div className="jobcc-empty">Loading…</div>
        ) : listRows.length === 0 ? (
          <div className="jobcc-empty jobcc-empty-ok">✓ Nothing here — all clear.</div>
        ) : (
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

function AlertPanel({ title, tone, rows, loading, onOpenJob, empty }) {
  const shown = rows.slice(0, 8)
  return (
    <section className="jobcc-panel">
      <div className="jobcc-panel-head">
        <span className="jobcc-panel-title">{title}</span>
        <span className={`jobcc-panel-count jobcc-c-${tone}`}>{loading ? '—' : rows.length}</span>
      </div>
      {loading ? (
        <div className="jobcc-empty">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="jobcc-empty jobcc-empty-ok">{empty}</div>
      ) : (
        <div className="jobcc-alerts">
          {shown.map(r => (
            <button type="button" key={r.jobId} className={`jobcc-alert jobcc-alert-${tone}`} onClick={() => onOpenJob?.(r.jobId)}>
              <div className="jobcc-alert-top">
                <span className="jobcc-alert-fam">{r.family}</span>
                {r.blocker && <span className={`jobcc-tag jobcc-tag-${tone}`}>{r.blocker.label}</span>}
              </div>
              <div className="jobcc-alert-spec">{r.stage}{r.orderNumber || r.cemetery ? ` · ${[r.orderNumber, r.cemetery].filter(Boolean).join(' · ')}` : ''}</div>
            </button>
          ))}
          {rows.length > 8 && <div className="jobcc-more">+{rows.length - 8} more</div>}
        </div>
      )}
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

  .jobcc-kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin-bottom: 18px; }
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
  .jobcc-c-red { color: #f87171; } .jobcc-c-amber { color: #fbbf24; }
  .jobcc-alerts { display: flex; flex-direction: column; gap: 9px; }
  .jobcc-alert { text-align: left; font: inherit; cursor: pointer; width: 100%; background: #151a22; border: 1px solid #232a35; border-radius: 9px; padding: 10px 12px; color: #e6e9ef; }
  .jobcc-alert:hover { background: #1a212b; }
  .jobcc-alert-red { border-color: #5c2a2a; background: #1c1416; }
  .jobcc-alert-top { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
  .jobcc-alert-fam { font-size: 14px; font-weight: 700; color: #f4f6fa; }
  .jobcc-alert-spec { font-family: var(--font-m, 'JetBrains Mono'), monospace; font-size: 11.5px; color: #c7cedb; }
  .jobcc-more { font-size: 11.5px; color: #6f7a8a; padding: 2px 2px 0; }

  .jobcc-panel { background: #11151c; border: 1px solid #20262f; border-radius: 12px; padding: 15px 17px; margin-bottom: 16px; }
  .jobcc-panel-head { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; }
  .jobcc-panel-title { font-size: 13px; font-weight: 700; color: #f4f6fa; text-transform: uppercase; letter-spacing: 0.04em; }
  .jobcc-panel-count { font-family: var(--font-m, 'JetBrains Mono'), monospace; font-size: 12px; font-weight: 700; padding: 1px 8px; border-radius: 999px; background: #1a212b; color: #c7cedb; }
  .jobcc-empty { color: #6f7a8a; font-size: 13px; padding: 10px 2px; }
  .jobcc-empty-ok { color: #34d399; }

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
