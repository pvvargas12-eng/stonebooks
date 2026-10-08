// =============================================================================
// LinePlanner — build and order the assembly lines (LINES-1, 2026-10-08)
// =============================================================================
// Paul: "line planner should be a button in this corner, you hit it and then
// it goes to line planner, you see your active line, on deck, then future...
// when building you have RECOMMENDED — design approved and stone in stock or
// arrived as criteria, then by due date... when going over 18 have a brief
// message recommending another line but you can override."
// Lines run in order (keep ~3 ahead, up to 6 is fine). Left: every line,
// active → on deck → planning (completed fold away). Right: the recommended
// pool for the next unfilled line — the bring-up gates, sorted by due date.
// Dark .jobcc / .pf-* aesthetic (mounted inside ProductionBoard's shell).
// =============================================================================
import { useState, useEffect, useCallback } from 'react'
import { getProductionComponents, getBringUpReady, fmtDate } from '../lib/stonebooksData'
import { boardPhases, phaseLabel } from '../lib/jobComponents'
import {
  reconcileFloorLines, createFloorLine, updateFloorLine, deleteFloorLine, addStonesToLine,
  removeLineItem, moveLineItem, startFloorLine, completeFloorLine, itemTone, lineLabel,
  DEFAULT_LINE_CAPACITY,
} from '../lib/floorLines'

const DAY_MS = 86400000
const niceCase = (s) => {
  if (!s || s !== s.toUpperCase() || !/[A-Z]/.test(s)) return s
  return s.toLowerCase().replace(/(^|[\s\-'])(\p{L})/gu, (m, sep, ch) => sep + ch.toUpperCase())
}
const famOf = (c) => niceCase(c?.order?.primary_lastname || c?.order?.customer?.last_name || c?.vendor_request?.family_name || c?.cemetery_order?.cemetery_name || c?.order?.cemetery?.name || '—')
const orderNoOf = (c) => c?.order?.order_number || c?.cemetery_order?.order_number || ''
const cemOf = (c) => c?.order?.cemetery?.name || c?.cemetery_order?.cemetery_name || ''
const dueOf = (c) => c?.order?.target_completion_date || null
const STATUS_LABEL = { active: 'Active', on_deck: 'On deck', planning: 'Planning', complete: 'Complete' }
const TONE_TITLE = { ready: 'Ready to bring up', up: 'Brought to line', cut: 'Stencil cut', blast: 'Blasting queue', out: 'Blasted', deck: 'Planned' }

// Due tone: past = red, within 3 weeks = amber, else green; none = grey.
const dueTone = (iso, todayMs) => {
  if (!iso || !todayMs) return 'none'
  const t = new Date(iso + 'T00:00:00').getTime()
  const d = (t - todayMs) / DAY_MS
  return d < 0 ? 'r' : d <= 21 ? 'a' : 'g'
}
const fmtWeek = (iso) => iso ? new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''

export default function LinePlanner({ onBack, onOpenOrderDetail }) {
  const [lines, setLines] = useState(null)
  const [comps, setComps] = useState([])
  const [recs, setRecs] = useState(() => ({ byJob: new Map() }))
  const [todayMs, setTodayMs] = useState(0)
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)
  const [openIds, setOpenIds] = useState(() => new Set())   // lines with the stone list expanded
  const [showDone, setShowDone] = useState(false)
  const [q, setQ] = useState('')
  const [capWarn, setCapWarn] = useState(null)   // { line } after an add pushed it over

  const load = useCallback(async () => {
    try {
      const [d, rec] = await Promise.all([
        getProductionComponents(),
        getBringUpReady().catch(() => ({ byJob: new Map() })),
      ])
      setComps(d || []); setRecs(rec)
      const t = new Date(); t.setHours(0, 0, 0, 0); setTodayMs(t.getTime())
      setLines(await reconcileFloorLines({ floorComps: d || [] }))
      setErr(null)
    } catch (e) { setErr(e?.message || 'Failed to load'); setLines([]) }
  }, [])
  useEffect(() => { load() }, [load])  // eslint-disable-line react-hooks/set-state-in-effect

  const run = async (fn) => {
    if (busy) return
    setBusy(true); setErr(null)
    const r = await fn()
    setBusy(false)
    if (r && r.ok === false) { setErr(r.error || 'Action failed'); return }
    load()
  }

  const compById = new Map(comps.map(c => [c.id, c]))
  const all = lines || []
  const live = all.filter(l => l.status !== 'complete')
  const done = all.filter(l => l.status === 'complete')
  const onLine = new Set(all.flatMap(l => l.items.map(it => it.component_id)))

  // The RECOMMENDED pool: new-stone dies, off the board, not on any line,
  // meeting the bring-up gates (design approved · stone here/in stock ·
  // contracted) — due date first, then oldest signing.
  const phases = boardPhases('new_stone')
  const pool = comps
    .filter(c => c.track === 'new_stone' && c.component_type !== 'base' && !c.on_floor
      && phases.includes(c.current_phase) && !onLine.has(c.id) && c.job_id && recs.byJob.get(c.job_id)?.ready)
    .sort((a, b) => {
      const da = dueOf(a) || '9999-12-31', db = dueOf(b) || '9999-12-31'
      if (da !== db) return da < db ? -1 : 1
      return String(a.order?.signed_at || a.order?.created_at || '').localeCompare(String(b.order?.signed_at || b.order?.created_at || ''))
    })
  const matches = (c) => {
    const t = q.trim().toLowerCase()
    if (!t) return true
    return [famOf(c), orderNoOf(c), cemOf(c), c.size].filter(Boolean).join(' ').toLowerCase().includes(t)
  }
  const poolShown = pool.filter(matches)

  // Fill target = the first unstarted line with room; else the last unstarted
  // line; else nothing (the + New line button is the answer).
  const unstarted = live.filter(l => l.status === 'on_deck' || l.status === 'planning')
  const target = unstarted.find(l => l.counts.total < (l.capacity || DEFAULT_LINE_CAPACITY)) || unstarted[unstarted.length - 1] || null
  const nextAfter = (line) => all.find(l => l.number > line.number && l.status !== 'complete') || null

  const addTo = (line, list) => run(async () => {
    const r = await addStonesToLine(line.id, list)
    if (r.ok && line.counts.total + r.added > (line.capacity || DEFAULT_LINE_CAPACITY)) setCapWarn({ lineId: line.id })
    return r
  })
  const fillByDue = (line) => {
    const room = Math.max(0, (line.capacity || DEFAULT_LINE_CAPACITY) - line.counts.total)
    if (!room) { setCapWarn({ lineId: line.id }); return }
    addTo(line, pool.slice(0, room))
  }
  const moveLast = (line) => run(async () => {
    const last = line.items[line.items.length - 1]
    if (!last) return { ok: true }
    let to = nextAfter(line)
    if (!to) { const r = await createFloorLine(); if (!r.ok) return r; to = r.line }
    setCapWarn(null)
    return moveLineItem(last.id, to.id)
  })
  const moveItemTo = (it, line) => run(async () => {
    let to = nextAfter(line)
    if (!to) { const r = await createFloorLine(); if (!r.ok) return r; to = r.line }
    return moveLineItem(it.id, to.id)
  })
  const toggleOpen = (id) => setOpenIds(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })

  const renderLine = (l) => {
    const cap = l.capacity || DEFAULT_LINE_CAPACITY
    const c = l.counts
    const isOpen = openIds.has(l.id)
    const over = l.overCap
    return (
      <div key={l.id} className={`lp-line lp-line-${l.status}${over ? ' lp-line-over' : ''}`}>
        <div className="lp-line-head">
          <span className={`lp-st lp-st-${l.status}`}>{STATUS_LABEL[l.status]}</span>
          <span className="lp-line-name">{lineLabel(l)}</span>
          <label className="lp-week" title="Week this line is planned for">
            <input type="date" value={l.week_start || ''} onChange={e => run(() => updateFloorLine(l.id, { weekStart: e.target.value || null }))} />
          </label>
          <span className="lp-line-cnt">
            {l.status === 'active'
              ? <>{c.total} stones · <b className="t-blast">{c.blasted} blasted</b> · {c.waiting} to bring up</>
              : l.status === 'complete'
                ? <>{c.total} stones · {l.started_at && l.completed_at ? `${Math.max(1, Math.round((new Date(l.completed_at) - new Date(l.started_at)) / DAY_MS))} days` : ''}</>
                : <span className={over ? 't-over' : ''}>{c.total} / {cap}{over ? ' · over the soft limit' : ''}</span>}
          </span>
        </div>
        {l.status === 'active' && (
          <div className="lp-bar">
            <i style={{ width: `${c.total ? (c.blasted / c.total) * 100 : 0}%`, background: '#0e1116' }} />
            <i style={{ width: `${c.total ? (c.blastQ / c.total) * 100 : 0}%`, background: '#1d7a55' }} />
            <i style={{ width: `${c.total ? (c.cut / c.total) * 100 : 0}%`, background: '#7a5d12' }} />
            <i style={{ width: `${c.total ? ((c.up - c.cut - c.blastQ) / c.total) * 100 : 0}%`, background: '#2f5586' }} />
          </div>
        )}
        <div className="lp-tiles">
          {l.items.map((it, i) => {
            const tone = l.status === 'active' || l.status === 'complete' ? itemTone(it) : (i >= cap ? 'over' : 'deck')
            const full = compById.get(it.component_id)
            return <span key={it.id} className={`lp-tl lp-tl-${tone}`} title={`#${i + 1} ${full ? famOf(full) : '—'} · ${TONE_TITLE[tone] || 'Over the soft limit'}`}>{full ? famOf(full) : '—'}</span>
          })}
          {Array.from({ length: Math.max(0, cap - l.items.length) }, (_, i) => <span key={`e${i}`} className="lp-tl lp-tl-empty" />)}
        </div>
        {(over || capWarn?.lineId === l.id) && l.status !== 'complete' && (
          <div className="lp-capnote">
            <span>{lineLabel(l)} is over {cap}. Recommend starting {nextAfter(l) ? lineLabel(nextAfter(l)) : 'a new line'} with the rest.</span>
            <button type="button" className="pf-btn" onClick={() => setCapWarn(null)}>Keep {c.total}</button>
            <button type="button" className="pf-btn pf-btn-gold" disabled={busy} onClick={() => moveLast(l)}>Move last → {nextAfter(l) ? lineLabel(nextAfter(l)) : 'new line'}</button>
          </div>
        )}
        <div className="lp-line-acts">
          <button type="button" className="pf-btn" onClick={() => toggleOpen(l.id)}>{isOpen ? 'Hide list' : `Open list (${c.total})`}</button>
          {(l.status === 'on_deck' || l.status === 'planning') && c.total < cap && pool.length > 0 && (
            <button type="button" className="pf-btn pf-btn-gold" disabled={busy} onClick={() => fillByDue(l)}>Fill the rest by due date</button>
          )}
          {(l.status === 'on_deck' || l.status === 'planning') && c.total > 0 && (
            <button type="button" className="pf-btn pf-btn-deck" disabled={busy} title="Run this line now — its stones land in Ready to Bring Up" onClick={() => run(() => startFloorLine(l.id))}>
              {l.status === 'on_deck' ? 'Start now →' : 'Start this line →'}
            </button>
          )}
          {l.status === 'active' && c.blasted < c.total && (
            <button type="button" className="pf-btn" disabled={busy} title="Close this line out by hand (stragglers stay on the board)"
              onClick={() => { if (window.confirm(`Mark ${lineLabel(l)} complete with ${c.total - c.blasted} stone(s) not blasted?`)) run(() => completeFloorLine(l.id)) }}>Mark complete</button>
          )}
          {l.status !== 'active' && l.status !== 'complete' && c.total === 0 && (
            <button type="button" className="pf-btn pf-btn-deny" disabled={busy} onClick={() => run(() => deleteFloorLine(l.id))}>Delete</button>
          )}
          <label className="lp-cap" title="Soft limit — a warning, never a wall">cap
            <input type="number" min="1" max="60" value={cap} onChange={e => run(() => updateFloorLine(l.id, { capacity: e.target.value }))} />
          </label>
        </div>
        {isOpen && (
          <div className="lp-list">
            {l.items.map((it, i) => {
              const full = compById.get(it.component_id)
              const tone = itemTone(it)
              return (
                <div key={it.id} className="lp-row">
                  <span className="lp-row-n">{i + 1}</span>
                  {full?.order_id
                    ? <button type="button" className="lp-row-fam lp-row-btn" onClick={() => onOpenOrderDetail?.(full.order_id, 'production')}>{famOf(full)}</button>
                    : <span className="lp-row-fam">{full ? famOf(full) : '—'}</span>}
                  <span className="lp-row-meta">{[full?.size, orderNoOf(full), cemOf(full)].filter(Boolean).join(' · ')}</span>
                  <span className={`lp-due lp-due-${dueTone(dueOf(full), todayMs)}`}>{dueOf(full) ? fmtDate(dueOf(full)) : 'no due date'}</span>
                  <span className={`lp-tone lp-tl-${tone}`}>{it.component ? phaseLabel(it.component.current_phase) : '—'}</span>
                  {l.status !== 'complete' && !(l.status === 'active' && tone !== 'ready') && (
                    <>
                      <button type="button" className="pf-btn" disabled={busy} title="Move to the next line" onClick={() => moveItemTo(it, l)}>→ next</button>
                      <button type="button" className="pf-btn" disabled={busy} title="Take off this line" onClick={() => run(() => removeLineItem(it.id))}>×</button>
                    </>
                  )}
                </div>
              )
            })}
            {l.items.length === 0 && <div className="lp-empty">Empty — add from the recommended list.</div>}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="lp">
      <style>{LP_CSS}</style>
      <header className="jobcc-cmd">
        <div className="jobcc-cmd-left">
          <div className="lp-titlerow">
            <button type="button" className="jobcc-btn" onClick={onBack}>← Production floor</button>
            <h1 className="jobcc-title">Line Planner</h1>
          </div>
          <div className="jobcc-purpose">Lines run in order. Keep about 3 ahead — up to 6 is fine. A line completes when every stone on it is blasted; the next one slides into Ready to Bring Up by itself.</div>
        </div>
        <div className="jobcc-cmd-right">
          <div className="jobcc-actions">
            <button type="button" className="pf-lp-btn" disabled={busy} onClick={() => run(() => createFloorLine())}>+ New line</button>
          </div>
        </div>
      </header>

      {err && <div className="jobcc-err">{err}</div>}
      {lines == null ? <div className="jobcc-empty">Loading…</div> : (
        <div className="lp-body">
          <section className="lp-lines" aria-label="Lines in order">
            {live.map(renderLine)}
            {live.length === 0 && <div className="lp-empty">No lines yet. Hit + New line, then fill it from the recommended list.</div>}
            {done.length > 0 && (
              <button type="button" className="lp-donehead" onClick={() => setShowDone(v => !v)}>
                {showDone ? '▾' : '▸'} Completed lines ({done.length})
              </button>
            )}
            {showDone && done.slice().reverse().map(renderLine)}
          </section>

          <aside className="lp-pool" aria-label="Recommended">
            <div className="lp-pool-head">
              <span className="lp-pool-title">Recommended{target ? ` for ${lineLabel(target)}` : ''}</span>
              <span className="lp-pool-n">{pool.length} ready</span>
            </div>
            <div className="lp-pool-hint">Design approved · stone here or in stock · contracted. Due date first. Nothing already on a line.</div>
            <div className="lp-pool-acts">
              {target && pool.length > 0 && (
                <button type="button" className="pf-btn pf-btn-go" disabled={busy} onClick={() => fillByDue(target)}>
                  Add top {Math.min(pool.length, Math.max(0, (target.capacity || DEFAULT_LINE_CAPACITY) - target.counts.total)) || pool.length} → {lineLabel(target)}
                </button>
              )}
              {!target && <span className="lp-pool-hint">Every line is running — hit + New line to plan the next one.</span>}
              <input className="pf-input lp-search" type="search" placeholder="Search family, order #, cemetery…" value={q} onChange={e => setQ(e.target.value)} />
            </div>
            <div className="lp-pool-list">
              {poolShown.slice(0, 80).map(c => (
                <div key={c.id} className="lp-row">
                  {c.order_id
                    ? <button type="button" className="lp-row-fam lp-row-btn" onClick={() => onOpenOrderDetail?.(c.order_id, 'production')}>{famOf(c)}</button>
                    : <span className="lp-row-fam">{famOf(c)}</span>}
                  <span className="lp-row-meta">{[c.size, orderNoOf(c), cemOf(c)].filter(Boolean).join(' · ')}</span>
                  <span className={`lp-due lp-due-${dueTone(dueOf(c), todayMs)}`}>{dueOf(c) ? fmtDate(dueOf(c)) : 'no due date'}</span>
                  {target && <button type="button" className="pf-btn pf-btn-gold" disabled={busy} onClick={() => addTo(target, [c])}>→ L{target.number}</button>}
                </div>
              ))}
              {poolShown.length === 0 && <div className="lp-empty">{q ? 'Nothing ready matches.' : 'Nothing ready and unassigned — every ready stone is on a line.'}</div>}
            </div>
          </aside>
        </div>
      )}
    </div>
  )
}

const LP_CSS = `
  .lp-titlerow { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
  .lp-body { display: flex; gap: 14px; align-items: flex-start; flex-wrap: wrap; }
  .lp-lines { flex: 1 1 620px; min-width: 0; display: flex; flex-direction: column; gap: 10px; }
  .lp-pool { flex: 1 1 420px; min-width: 0; max-width: 640px; background: #11151c; border: 1px solid #5a4a1e; border-radius: 10px; padding: 10px 12px; display: flex; flex-direction: column; gap: 8px; }
  .lp-pool-head { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
  .lp-pool-title { font-size: 14px; font-weight: 800; color: #f4f6fa; }
  .lp-pool-n { font-family: var(--font-m, 'JetBrains Mono'), monospace; font-size: 11px; color: #fbbf24; }
  .lp-pool-hint { font-size: 11px; color: #6f7a8a; }
  .lp-pool-acts { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  .lp-search { flex: 1 1 180px; }
  .lp-pool-list { display: flex; flex-direction: column; gap: 4px; max-height: 70vh; overflow-y: auto; }
  .lp-line { background: #11151c; border: 1px solid #20262f; border-radius: 10px; padding: 10px 12px; display: flex; flex-direction: column; gap: 7px; min-width: 0; }
  .lp-line-active { border-color: #C9A468; }
  .lp-line-on_deck { border-color: #2f5586; }
  .lp-line-over { border-color: #7a5d12; }
  .lp-line-complete { opacity: .75; }
  .lp-line-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; min-width: 0; }
  .lp-st { font-size: 9px; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase; border-radius: 999px; padding: 3px 7px; white-space: nowrap; }
  .lp-st-active { color: #C9A468; border: 1px solid #C9A468; }
  .lp-st-on_deck { color: #bcd4f5; border: 1px solid #2f5586; background: #1e3350; }
  .lp-st-planning { color: #8b95a5; border: 1px solid #3a4452; }
  .lp-st-complete { color: #34d399; border: 1px solid #2d5a44; }
  .lp-line-name { font-size: 13px; font-weight: 800; color: #f4f6fa; white-space: nowrap; }
  .lp-week input { font: inherit; font-size: 11px; background: #0E1116; border: 1px solid #2a313c; border-radius: 6px; color: #c7cedb; padding: 2px 6px; }
  .lp-line-cnt { margin-left: auto; font-size: 11px; color: #8b95a5; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .lp-line-cnt .t-blast { color: #34d399; } .lp-line-cnt .t-over { color: #fbbf24; }
  .lp-bar { height: 6px; border-radius: 3px; background: #0E1116; overflow: hidden; display: flex; }
  .lp-bar i { display: block; height: 100%; }
  .lp-tiles { display: grid; grid-template-columns: repeat(auto-fill, minmax(56px, 1fr)); gap: 4px; }
  .lp-tl { height: 30px; border-radius: 4px 4px 2px 2px; border: 1px solid #2a313c; display: flex; align-items: flex-end; justify-content: center; padding: 0 2px 2px; font-size: 7.5px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
  .lp-tl-ready { background: none; border: 1.5px solid #2d7a4f; color: #34d399; }
  .lp-tl-up { background: #1e3350; border-color: #2f5586; color: #bcd4f5; }
  .lp-tl-cut { background: #4a3a12; border-color: #7a5d12; color: #fbe3a0; }
  .lp-tl-blast { background: #1d7a55; border-color: #34d399; color: #eafff4; }
  .lp-tl-out { background: #0e1116; border-color: #232a35; color: #3a4452; }
  .lp-tl-deck { background: none; border: 1px dashed #3a4452; color: #8b95a5; }
  .lp-tl-over { background: none; border: 1.5px solid #fbbf24; color: #fbbf24; }
  .lp-tl-empty { background: none; border: 1px dashed #232a35; }
  .lp-capnote { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; background: #2a2210; border: 1px solid #5a4a1e; border-radius: 7px; padding: 6px 9px; font-size: 11px; color: #fbbf24; }
  .lp-capnote span { flex: 1 1 240px; min-width: 0; }
  .lp-line-acts { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
  .lp-cap { margin-left: auto; font-size: 10.5px; color: #6f7a8a; display: inline-flex; align-items: center; gap: 4px; }
  .lp-cap input { width: 48px; font: inherit; font-size: 11px; background: #0E1116; border: 1px solid #2a313c; border-radius: 6px; color: #c7cedb; padding: 2px 5px; }
  .lp-list { display: flex; flex-direction: column; gap: 4px; border-top: 1px solid #232a35; padding-top: 7px; }
  .lp-row { display: flex; align-items: center; gap: 8px; background: #151a22; border: 1px solid #232a35; border-radius: 7px; padding: 5px 9px; min-width: 0; }
  .lp-row-n { font-family: var(--font-m, 'JetBrains Mono'), monospace; font-size: 10px; color: #6f7a8a; width: 20px; text-align: right; flex: 0 0 auto; }
  .lp-row-fam { font-size: 12px; font-weight: 700; color: #f4f6fa; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 90px; max-width: 180px; }
  .lp-row-btn { font: inherit; background: none; border: none; padding: 0; cursor: pointer; text-align: left; text-decoration: underline dotted rgba(139,149,165,0.6); text-underline-offset: 3px; }
  .lp-row-btn:hover { color: #fbbf24; }
  .lp-row-meta { flex: 1 1 120px; font-family: var(--font-m, 'JetBrains Mono'), monospace; font-size: 10px; color: #8b95a5; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
  .lp-due { font-family: var(--font-m, 'JetBrains Mono'), monospace; font-size: 10px; font-weight: 800; border-radius: 999px; padding: 2px 7px; white-space: nowrap; }
  .lp-due-r { color: #f87171; background: rgba(248,113,113,.16); } .lp-due-a { color: #fbbf24; background: rgba(251,191,36,.14); } .lp-due-g { color: #34d399; background: rgba(52,211,153,.14); } .lp-due-none { color: #6f7a8a; background: #0e1116; }
  .lp-tone { font-size: 9px; font-weight: 800; letter-spacing: .04em; text-transform: uppercase; border-radius: 999px; padding: 2px 7px; white-space: nowrap; border: 1px solid transparent; }
  .lp-empty { font-size: 11.5px; color: #6f7a8a; padding: 6px 2px; }
  .lp-donehead { font: inherit; font-size: 12px; font-weight: 700; color: #8b95a5; background: none; border: 1px dashed #2a313c; border-radius: 8px; padding: 8px 12px; cursor: pointer; text-align: left; }
  .lp-donehead:hover { color: #f4f6fa; border-color: #3a4452; }
  .pf-btn-deck { border-color: #2f5586; color: #bcd4f5; }
`
