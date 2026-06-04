// =============================================================================
// 📚 Stonebooks — Reports tab (framework)
// =============================================================================
// Two modes — Daily Command (pinned cards) and Library (all reports, grouped).
// Reusable ReportCard chassis; global date range + compare-to-previous drive
// every card; per-user layout (pinned / hidden / order) persists. Every value is
// REAL — a report that can't be computed honestly shows a "not yet tracked"
// note. READ-ONLY: no actions fire. Archived orders excluded (D1).
// =============================================================================

import { useState, useEffect, useMemo, useCallback } from 'react'
import { customerName, fmtUSD, statusInfo, rowGrandTotal } from './lib/stonebooksData'
import {
  loadReportsData, reportDateRange, getReportsLayout, saveReportsLayout, downloadReportCSV,
} from './lib/reportsData'
import { REPORTS, REPORTS_BY_ID, REPORT_GROUPS } from './lib/reportDefs'
import ReportCard, { REPORT_CSS } from './components/ReportCard'

const RANGES = [
  { code: 'month',   label: 'This month' },
  { code: 'quarter', label: 'Quarter' },
  { code: 'year',    label: 'Year' },
  { code: 'custom',  label: 'Custom' },
]

function defaultLayout() {
  return { pinned: REPORTS.filter(r => r.daily).map(r => r.id), hidden: [], order: REPORTS.map(r => r.id) }
}
function mergeLayout(loaded) {
  const def = defaultLayout()
  if (!loaded) return def
  const known = new Set(REPORTS.map(r => r.id))
  const order = (loaded.order || []).filter(id => known.has(id))
  for (const id of def.order) if (!order.includes(id)) order.push(id)
  return {
    pinned: (loaded.pinned || def.pinned).filter(id => known.has(id)),
    hidden: (loaded.hidden || []).filter(id => known.has(id)),
    order,
  }
}

function orderName(row) {
  if (row?.primary_lastname && String(row.primary_lastname).trim()) return String(row.primary_lastname).trim()
  const cn = customerName(row?.customer)
  if (cn && cn !== '—') return cn
  return row?.order_number || 'Unknown'
}

export default function ReportsTab({ user, onOpenOrder, onOpenJob }) {
  const [now] = useState(() => new Date())
  const [bundle, setBundle] = useState(null)
  const [err, setErr] = useState(null)
  const [rangeCode, setRangeCode] = useState('month')
  const [custom, setCustom] = useState({ start: '', end: '' })
  const [compare, setCompare] = useState(false)
  const [mode, setMode] = useState('daily')
  const [group, setGroup] = useState('money')
  const [layout, setLayout] = useState(null)
  const [drill, setDrill] = useState(null)

  useEffect(() => {
    let c = false
    loadReportsData().then(b => { if (!c) setBundle(b) }).catch(e => { if (!c) setErr(e?.message || 'Failed to load') })
    return () => { c = true }
  }, [])
  useEffect(() => {
    let c = false
    getReportsLayout(user?.id).then(l => { if (!c) setLayout(mergeLayout(l)) })
    return () => { c = true }
  }, [user?.id])

  const range = useMemo(() => reportDateRange(rangeCode, custom, now), [rangeCode, custom, now])
  const onDrill = useCallback((d) => setDrill(d), [])

  const results = useMemo(() => {
    if (!bundle) return {}
    const ctx = { range, compare, onDrill }
    const out = {}
    for (const r of REPORTS) {
      try { out[r.id] = r.compute(bundle, ctx) }
      catch (e) { out[r.id] = { health: 'neutral', note: `Couldn’t compute this report (${e?.message || 'error'}).` } }
    }
    return out
  }, [bundle, range, compare, onDrill])

  // ── Layout mutations ───────────────────────────────────────────────────────
  const persist = (next) => { setLayout(next); saveReportsLayout(user?.id, next) }
  const togglePin = (id) => { if (!layout) return; const has = layout.pinned.includes(id); persist({ ...layout, pinned: has ? layout.pinned.filter(x => x !== id) : [...layout.pinned, id] }) }
  const toggleHide = (id) => { if (!layout) return; const has = layout.hidden.includes(id); persist({ ...layout, hidden: has ? layout.hidden.filter(x => x !== id) : [...layout.hidden, id] }) }

  const visibleIds = useMemo(() => {
    if (!layout) return []
    const ordered = layout.order.filter(id => REPORTS_BY_ID[id])
    if (mode === 'daily') return ordered.filter(id => layout.pinned.includes(id) && !layout.hidden.includes(id))
    return ordered.filter(id => REPORTS_BY_ID[id].group === group)   // library: hidden shown dimmed
  }, [layout, mode, group])

  const move = (id, dir) => {
    if (!layout) return
    const vis = visibleIds
    const i = vis.indexOf(id); if (i < 0) return
    const j = dir < 0 ? i - 1 : i + 1; if (j < 0 || j >= vis.length) return
    const order = [...layout.order]
    const ai = order.indexOf(id), bi = order.indexOf(vis[j])
    ;[order[ai], order[bi]] = [order[bi], order[ai]]
    persist({ ...layout, order })
  }

  const exportCsv = (id) => {
    const r = results[id]; if (!r?.csv) return
    downloadReportCSV(`${r.csv.filename}.csv`, r.csv.headers, r.csv.rows)
  }

  const deltaTextFor = (res) => {
    if (!compare || res?.value == null || res?.prevValue == null) return null
    const d = res.value - res.prevValue
    if (res.prevValue === 0) return d === 0 ? '±0' : '▲ new'
    const pct = Math.round((d / Math.abs(res.prevValue)) * 100)
    return `${d >= 0 ? '▲' : '▼'} ${Math.abs(pct)}% vs prev`
  }

  const groupHasHidden = mode === 'library' && layout && visibleIds.some(id => layout.hidden.includes(id))

  return (
    <div className="sb-page sb-page-wide">
      <style>{REPORT_CSS}{RT_CSS}</style>
      <div className="sb-page-head">
        <div className="sb-page-eyebrow">Intelligence</div>
        <h1 className="sb-page-title">Reports</h1>
      </div>

      {/* Global controls */}
      <div className="rt-controls">
        <div className="rt-modes" role="tablist">
          <button type="button" className={`rt-mode ${mode === 'daily' ? 'on' : ''}`} onClick={() => setMode('daily')}>Daily Command</button>
          <button type="button" className={`rt-mode ${mode === 'library' ? 'on' : ''}`} onClick={() => setMode('library')}>Library</button>
        </div>
        <div className="rt-ctrl-right">
          <div className="rt-ranges">
            {RANGES.map(r => (
              <button key={r.code} type="button" className={`rt-range ${rangeCode === r.code ? 'on' : ''}`} onClick={() => setRangeCode(r.code)}>{r.label}</button>
            ))}
          </div>
          {rangeCode === 'custom' && (
            <div className="rt-custom">
              <input type="date" value={custom.start} onChange={e => setCustom(c => ({ ...c, start: e.target.value }))} />
              <span>–</span>
              <input type="date" value={custom.end} onChange={e => setCustom(c => ({ ...c, end: e.target.value }))} />
            </div>
          )}
          <label className="rt-compare">
            <input type="checkbox" checked={compare} onChange={e => setCompare(e.target.checked)} /> Compare to prev
          </label>
        </div>
      </div>

      {/* Library group sub-tabs */}
      {mode === 'library' && (
        <div className="rt-groups">
          {REPORT_GROUPS.map(g => {
            const n = REPORTS.filter(r => r.group === g.code).length
            return (
              <button key={g.code} type="button" className={`rt-group ${group === g.code ? 'on' : ''}`} onClick={() => setGroup(g.code)} disabled={n === 0}>
                {g.label}{n > 0 && <span className="rt-group-n">{n}</span>}
              </button>
            )
          })}
        </div>
      )}

      {err && <div className="sb-empty" style={{ color: '#b54040' }}>{err}</div>}

      {!bundle || !layout ? (
        <div className="sb-empty">Loading reports…</div>
      ) : visibleIds.length === 0 ? (
        <div className="sb-empty">
          {mode === 'daily'
            ? 'No cards pinned to Daily Command yet. Open the Library and pin the reports you check each morning.'
            : 'No reports in this group yet.'}
        </div>
      ) : (
        <div className="rt-grid">
          {visibleIds.map(id => {
            const def = REPORTS_BY_ID[id]
            const res = results[id]
            const isHidden = layout.hidden.includes(id)
            return (
              <ReportCard
                key={id} def={def} result={res}
                pinned={layout.pinned.includes(id)} hidden={isHidden}
                deltaText={deltaTextFor(res)}
                onTogglePin={() => togglePin(id)} onToggleHide={() => toggleHide(id)}
                onMoveUp={() => move(id, -1)} onMoveDown={() => move(id, 1)}
                onExport={() => exportCsv(id)}
              >
                {res?.body}
              </ReportCard>
            )
          })}
        </div>
      )}

      {groupHasHidden && <div className="rt-hidden-note">Dimmed cards are hidden — use the ⋯ menu to show them.</div>}

      {drill && (
        <DrillModal drill={drill} bundle={bundle} onClose={() => setDrill(null)} onOpenOrder={onOpenOrder} onOpenJob={onOpenJob} />
      )}
    </div>
  )
}

// ── Drill-through modal — the underlying orders/jobs for a clicked segment ────
function DrillModal({ drill, bundle, onClose, onOpenOrder, onOpenJob }) {
  const items = useMemo(() => {
    const ids = new Set(drill.ids || [])
    if (drill.kind === 'jobs') {
      return (bundle.jobs || []).filter(j => ids.has(j.id)).map(j => ({
        id: j.id, kind: 'job', name: orderName(j.order), num: j.order?.order_number || String(j.id).slice(0, 8),
        amount: j.order ? fmtUSD(rowGrandTotal(j.order)) : '—', sub: j.job_type || j.overall_status || '',
      }))
    }
    return (bundle.orders || []).filter(o => ids.has(o.id)).map(o => ({
      id: o.id, kind: 'order', name: orderName(o), num: o.order_number || String(o.id).slice(0, 8),
      amount: fmtUSD(rowGrandTotal(o)), sub: statusInfo(o.status).label,
    }))
  }, [drill, bundle])

  return (
    <div className="rb-drill-backdrop" onClick={onClose}>
      <div className="rb-drill" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()}>
        <div className="rb-drill-head">
          <div className="rb-drill-title">{drill.title} · {items.length}</div>
          <button type="button" className="rb-drill-close" onClick={onClose}>Close ×</button>
        </div>
        <div className="rb-drill-list">
          {items.length === 0 ? <div className="rb-drill-empty">Nothing in this subset.</div>
            : items.map(it => (
              <button type="button" key={it.id} className="rb-drill-row"
                onClick={() => { it.kind === 'job' ? onOpenJob?.(it.id) : onOpenOrder?.(it.id); onClose() }}>
                <span className="rb-drill-name">{it.name}</span>
                <span className="rb-drill-mono">{it.num}</span>
                <span className="rb-drill-amt">{it.amount}</span>
                <span className="rb-drill-sub">{it.sub}</span>
              </button>
            ))}
        </div>
      </div>
    </div>
  )
}

const RT_CSS = `
  .rt-controls { display: flex; align-items: center; justify-content: space-between; gap: 14px; margin-bottom: 14px; flex-wrap: wrap; }
  .rt-modes { display: inline-flex; gap: 4px; padding: 4px; background: #f0eeea; border-radius: 999px; }
  .rt-mode { font: inherit; font-size: 13px; padding: 7px 18px; border: none; background: transparent; color: #6b6b66; border-radius: 999px; cursor: pointer; }
  .rt-mode.on { background: #fff; color: #1e2d3d; font-weight: 600; box-shadow: 0 1px 2px rgba(15,20,25,0.08); }
  .rt-ctrl-right { display: inline-flex; align-items: center; gap: 12px; flex-wrap: wrap; }
  .rt-ranges { display: inline-flex; gap: 4px; }
  .rt-range { font: inherit; font-size: 12px; padding: 6px 12px; border: 0.5px solid #e6e3dd; background: #fff; color: #6b6b66; border-radius: 7px; cursor: pointer; }
  .rt-range.on { border-color: #9A7209; color: #9A7209; font-weight: 600; }
  .rt-custom { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: #6b6b66; }
  .rt-custom input { font: inherit; font-size: 12px; padding: 5px 8px; border: 0.5px solid #e6e3dd; border-radius: 6px; }
  .rt-compare { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: #6b6b66; cursor: pointer; }
  .rt-groups { display: flex; gap: 6px; margin-bottom: 16px; flex-wrap: wrap; border-bottom: 0.5px solid #e6e3dd; padding-bottom: 12px; }
  .rt-group { font: inherit; font-size: 13px; padding: 6px 14px; border: 0.5px solid #e6e3dd; background: #fff; color: #6b6b66; border-radius: 8px; cursor: pointer; display: inline-flex; align-items: center; gap: 7px; }
  .rt-group.on { background: #1e2d3d; color: #fff; border-color: #1e2d3d; }
  .rt-group:disabled { opacity: 0.45; cursor: not-allowed; }
  .rt-group-n { font-size: 11px; opacity: 0.7; }
  .rt-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(360px, 1fr)); gap: 14px; align-items: start; }
  .rt-hidden-note { font-size: 12px; color: #a0a09a; margin-top: 12px; }
`
