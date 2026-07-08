// =============================================================================
// ProductionFloor — PART 2 B2: three-track per-component assembly board
// =============================================================================
// ThreeTrackFunnel  — compact 3-track funnel for the Dashboard (phase counts +
//                     each track's bottleneck).
// ProductionBoard   — the full Production-tab board: per-component cards grouped
//                     by phase within each track, with one-click advance/reverse,
//                     override, the QC approve/deny-with-issue gate, blocker +
//                     notes. Every phase change / QC action is event-logged in the
//                     data layer. Blockers READ existing truth (permit) read-only.
// Dark .jobcc-* aesthetic; board-specific .pf-* classes.
// =============================================================================
import { useState, useEffect, useCallback } from 'react'
import {
  getProductionComponents, getJobComponents, getCurrentStaffName,
  advanceComponent, reverseComponent, overrideComponentPhase,
  qcApproveComponent, qcDenyComponent, clearComponentQcIssue,
  setComponentBlocker, setComponentNotes, setComponentOnFloor, permitStatusLabel,
} from '../lib/stonebooksData'
import { TRACK_PHASES, TRACK_LABEL, phaseLabel, QC_PHASE, trackPhases } from '../lib/jobComponents'
import { JOBCC_BASE_CSS } from './jobccBase'

const TRACK_ORDER = ['new_stone', 'inscription', 'bronze', 'door']
// Tab labels per Paul (2026-07-08) — plural, his words.
const TAB_LABEL = { new_stone: 'New Stone', inscription: 'Inscription', bronze: 'Bronze Markers', door: 'Mausoleum Doors' }
const TYPE_LABEL = { die: 'Die', base: 'Base', inscription: 'Inscription', door: 'Door', bronze: 'Bronze' }
const DAY_MS = 86400000

// Family names arrive however they were typed on the order — some ALL CAPS.
// Normalize purely for display: only rewrite strings that are entirely upper.
const niceCase = (s) => {
  if (!s || s !== s.toUpperCase() || !/[A-Z]/.test(s)) return s
  return s.toLowerCase().replace(/(^|[\s\-'])(\p{L})/gu, (m, sep, ch) => sep + ch.toUpperCase())
}
// Order surname first, then the CUSTOMER's last name (many old orders never
// got a family name on the order itself — fix them in Reconcile), cemetery last.
const famOf = (c) => niceCase(c.order?.primary_lastname || c.order?.customer?.last_name || c.cemetery_order?.cemetery_name || c.order?.cemetery?.name || '—')
const orderNoOf = (c) => c.order?.order_number || c.cemetery_order?.order_number || ''
const cemOf = (c) => c.order?.cemetery?.name || c.cemetery_order?.cemetery_name || ''
// Read-only permit context from existing truth (orders.permit_status).
const permitContext = (c) => {
  const s = c.order?.permit_status
  return (s && s !== 'approved' && s !== 'not_required' && s !== 'unknown') ? permitStatusLabel(s) : null
}

// ── Dashboard funnel ─────────────────────────────────────────────────────────
export function ThreeTrackFunnel({ onOpenBoard, onOpenJob }) {
  const [components, setComponents] = useState(null)
  const [open, setOpen] = useState(null)   // `${track}|${phase}` expanded
  useEffect(() => {
    let alive = true
    getProductionComponents().then(d => { if (alive) setComponents(d || []) })
    return () => { alive = false }
  }, [])
  const loading = components == null

  return (
    <div className="pf-funnel-wrap">
      <style>{PF_CSS}</style>
      <div className="pf-funnel-tracks">
        {TRACK_ORDER.map(track => {
          const phases = TRACK_PHASES[track]
          const inTrack = (components || []).filter(c => c.track === track)
          const counts = phases.map(p => inTrack.filter(c => c.current_phase === p).length)
          const max = Math.max(1, ...counts)
          const bottleneckIdx = counts.indexOf(Math.max(...counts))
          const hasWork = inTrack.length > 0
          return (
            <div key={track} className="pf-funnel-track">
              <div className="pf-funnel-head">
                <span className="pf-funnel-label">{TRACK_LABEL[track]}</span>
                <span className="pf-funnel-total">{loading ? '—' : inTrack.length}</span>
              </div>
              {phases.map((p, i) => {
                const key = `${track}|${p}`
                const isOpen = open === key
                const cards = inTrack.filter(c => c.current_phase === p)
                return (
                  <div key={p}>
                    <button type="button" className={`pf-funnel-row ${hasWork && i === bottleneckIdx && counts[i] > 0 ? 'pf-funnel-bottleneck' : ''} ${isOpen ? 'pf-funnel-row-open' : ''}`}
                      disabled={counts[i] === 0} onClick={() => setOpen(isOpen ? null : key)}>
                      <span className="pf-funnel-pl">{phaseLabel(p)}</span>
                      <span className="pf-funnel-bar"><span className="pf-funnel-fill" style={{ width: `${(counts[i] / max) * 100}%` }} /></span>
                      <span className="pf-funnel-n">{loading ? '' : counts[i]}</span>
                    </button>
                    {isOpen && cards.length > 0 && (
                      <div className="pf-funnel-detail">
                        {cards.map(c => (
                          <button type="button" key={c.id} className="pf-funnel-card" onClick={() => c.job_id ? onOpenJob?.(c.job_id) : onOpenBoard?.()}>
                            {famOf(c)} · {TYPE_LABEL[c.component_type] || c.label}{orderNoOf(c) ? ` · ${orderNoOf(c)}` : ''}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>
      <div className="pf-funnel-note">Longest bar = each track's bottleneck. Click a phase to see its pieces · <button type="button" className="pf-funnel-link" onClick={() => onOpenBoard?.()}>open full board →</button></div>
    </div>
  )
}

// ── Full board (Production tab) ──────────────────────────────────────────────
// Hand-picked board (Paul, 2026-07-08): one track per TAB, the board shows only
// pieces staff pulled up (on_floor). The full backlog lives in the Queue log —
// searchable, never automatic. Every column has "+ Add" to search the queue and
// drop a piece straight into that column.
export default function ProductionBoard({ onOpenJob, onOpenOrderDetail }) {
  const [components, setComponents] = useState(null)
  const [todayMs, setTodayMs] = useState(0)
  const [err, setErr] = useState(null)
  const [track, setTrack] = useState('new_stone')
  const [queueOpen, setQueueOpen] = useState(false)
  const [queueQ, setQueueQ] = useState('')
  const [addCol, setAddCol] = useState(null)   // phase code the "+ Add" modal targets
  const [addQ, setAddQ] = useState('')
  const [busyId, setBusyId] = useState(null)

  const load = useCallback(async () => {
    try {
      const d = await getProductionComponents()
      setComponents(d || []); setErr(null)
      const t = new Date(); t.setHours(0, 0, 0, 0); setTodayMs(t.getTime())
    } catch (e) { setErr(e?.message || 'Failed to load'); setComponents([]) }
  }, [])
  useEffect(() => { load() }, [load])  // eslint-disable-line react-hooks/set-state-in-effect

  const loading = components == null
  const inTrack = (components || []).filter(c => c.track === track)
  const floor = inTrack.filter(c => c.on_floor)
  const queue = inTrack.filter(c => !c.on_floor)
  const phases = trackPhases(track)
  const counts = phases.map(p => floor.filter(c => c.current_phase === p).length)
  const bnIdx = counts.indexOf(Math.max(...counts))

  const matches = (c, q) => {
    const t = q.trim().toLowerCase()
    if (!t) return true
    return [famOf(c), orderNoOf(c), cemOf(c), c.size, c.color].filter(Boolean).join(' ').toLowerCase().includes(t)
  }

  const pullUp = async (c, phase) => {
    setBusyId(c.id); setErr(null)
    const actor = await getCurrentStaffName()
    const r = await setComponentOnFloor(c.id, true, { actor, phase })
    setBusyId(null)
    if (r && r.ok === false) { setErr(r.error); return }
    setAddCol(null); setAddQ('')
    load()
  }

  return (
    <div className="jobcc">
      <style>{JOBCC_BASE_CSS}{PF_CSS}</style>
      <header className="jobcc-cmd">
        <div className="jobcc-cmd-left">
          <h1 className="jobcc-title">Production floor</h1>
          <div className="jobcc-purpose">Only the pieces you pull up. + Add on any column searches the queue; nothing lands here automatically.</div>
        </div>
        <div className="jobcc-cmd-right">
          <div className="jobcc-actions">
            <button type="button" className={`jobcc-btn${queueOpen ? ' pf-qbtn-on' : ''}`} onClick={() => setQueueOpen(o => !o)}>
              Queue log · {loading ? '—' : queue.length}
            </button>
            <button type="button" className="jobcc-btn" onClick={load}>Refresh</button>
          </div>
        </div>
      </header>

      {/* Track tabs */}
      <div className="pf-tabs">
        {TRACK_ORDER.map(t => {
          const n = (components || []).filter(c => c.track === t && c.on_floor).length
          return (
            <button key={t} type="button" className={`pf-tab${track === t ? ' on' : ''}`}
              onClick={() => { setTrack(t); setQueueOpen(false); setAddCol(null) }}>
              {TAB_LABEL[t]} <span className="pf-tab-n">{loading ? '' : n}</span>
            </button>
          )
        })}
      </div>

      {err && <div className="jobcc-err">{err}</div>}

      {/* Queue log — the full backlog, searchable. Bring up = first column. */}
      {queueOpen && (
        <div className="pf-queue">
          <div className="pf-queue-head">
            <input className="pf-input pf-queue-search" type="search" placeholder="Search family, order #, cemetery…" value={queueQ} onChange={e => setQueueQ(e.target.value)} autoFocus />
            <span className="pf-queue-count">{queue.filter(c => matches(c, queueQ)).length} of {queue.length} in the queue</span>
          </div>
          <div className="pf-queue-list">
            {queue.filter(c => matches(c, queueQ)).slice(0, 60).map(c => (
              <div key={c.id} className="pf-queue-row">
                <span className="pf-queue-fam">{famOf(c)}</span>
                <span className="pf-queue-meta">{[TYPE_LABEL[c.component_type] || c.label, c.size, orderNoOf(c), cemOf(c)].filter(Boolean).join(' · ')}</span>
                <button type="button" className="pf-btn pf-btn-go" disabled={busyId === c.id} onClick={() => pullUp(c, phases[0])}>
                  {busyId === c.id ? '…' : '⤒ Bring up'}
                </button>
              </div>
            ))}
            {queue.filter(c => matches(c, queueQ)).length === 0 && <div className="pf-queue-empty">Nothing in the queue matches.</div>}
          </div>
        </div>
      )}

      {loading ? <div className="jobcc-empty">Loading…</div> : (
        <section className="pf-board-track">
          <div className="pf-cols">
            {phases.map((p, i) => {
              const cards = floor.filter(c => c.current_phase === p)
              return (
                <div key={p} className={`pf-col ${i === bnIdx && counts[i] > 0 ? 'pf-col-bn' : ''}`}>
                  <div className="pf-col-head">
                    <span className="pf-col-l">{phaseLabel(p)}</span>
                    <span className="pf-col-headr">
                      <span className="pf-col-n">{cards.length}</span>
                      <button type="button" className="pf-col-add" title={`Search the queue and add a piece to ${phaseLabel(p)}`}
                        onClick={() => { setAddCol(addCol === p ? null : p); setAddQ('') }}>+ Add</button>
                    </span>
                  </div>
                  <div className="pf-col-body">
                    {cards.length === 0 && <div className="pf-col-empty">—</div>}
                    {cards.map(c => (
                      <ComponentCard key={c.id} comp={c} todayMs={todayMs} onChanged={load}
                        onOpenJob={onOpenJob} onOpenOrderDetail={onOpenOrderDetail} />
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* "+ Add" — search the queue, drop the piece straight into this column. */}
      {addCol && (
        <div className="pf-modal-overlay" onClick={() => setAddCol(null)}>
          <div className="pf-modal" onClick={e => e.stopPropagation()}>
            <div className="pf-modal-title">Add to “{phaseLabel(addCol)}”</div>
            <input className="pf-input" type="search" placeholder="Search family, order #, cemetery…" value={addQ} onChange={e => setAddQ(e.target.value)} autoFocus />
            <div className="pf-queue-list" style={{ maxHeight: '46vh' }}>
              {queue.filter(c => matches(c, addQ)).slice(0, 40).map(c => (
                <div key={c.id} className="pf-queue-row">
                  <span className="pf-queue-fam">{famOf(c)}</span>
                  <span className="pf-queue-meta">{[TYPE_LABEL[c.component_type] || c.label, c.size, orderNoOf(c), cemOf(c)].filter(Boolean).join(' · ')}</span>
                  <button type="button" className="pf-btn pf-btn-go" disabled={busyId === c.id} onClick={() => pullUp(c, addCol)}>
                    {busyId === c.id ? '…' : 'Add →'}
                  </button>
                </div>
              ))}
              {queue.filter(c => matches(c, addQ)).length === 0 && <div className="pf-queue-empty">No queue pieces match — everything else is already on the board.</div>}
            </div>
            <div className="pf-card-form-actions" style={{ justifyContent: 'flex-end', marginTop: 8 }}>
              <button type="button" className="pf-btn" onClick={() => setAddCol(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function ComponentCard({ comp, todayMs, onChanged, onOpenJob, onOpenOrderDetail }) {
  const [busy, setBusy] = useState(false)
  const [menu, setMenu] = useState(false)
  const [mode, setMode] = useState(null)   // 'deny' | 'note' | 'block' | 'override'
  const [text, setText] = useState('')
  const [err, setErr] = useState(null)

  const atQc = comp.current_phase === QC_PHASE
  const held = !!comp.qc_issue
  const ageD = comp.phase_changed_at && todayMs ? Math.floor((todayMs - new Date(comp.phase_changed_at).getTime()) / DAY_MS) : null
  const permit = permitContext(comp)

  const run = async (fn) => {
    setBusy(true); setErr(null)
    const actor = await getCurrentStaffName()
    const r = await fn(actor)
    setBusy(false)
    if (r && r.ok === false) { setErr(r.error || 'Action failed'); return }
    setMenu(false); setMode(null); setText('')
    onChanged?.()
  }
  const openMode = (m) => { setMode(m); setText(m === 'note' ? (comp.notes || '') : m === 'block' ? (comp.blocker || '') : ''); setMenu(false); setErr(null) }

  return (
    <div className={`pf-card ${held ? 'pf-card-held' : comp.blocker ? 'pf-card-blocked' : ''}`}>
      <div className="pf-card-top">
        <span className="pf-card-fam">{famOf(comp)}</span>
        <span className="pf-card-type">{TYPE_LABEL[comp.component_type] || comp.label}</span>
      </div>
      {comp.size && <div className="pf-card-spec">{comp.size}{comp.color ? ` · ${comp.color}` : ''}</div>}
      <div className="pf-card-meta">{[orderNoOf(comp), cemOf(comp)].filter(Boolean).join(' · ')}{ageD != null ? ` · ${ageD}d` : ''}</div>

      {held && <div className="pf-card-issue">⚠ HELD — {comp.qc_issue}</div>}
      {comp.blocker && !held && <div className="pf-card-blk">⛔ {comp.blocker}</div>}
      {permit && <div className="pf-card-ctx">🔒 Permit: {permit}</div>}
      {comp.notes && mode !== 'note' && <div className="pf-card-note">📝 {comp.notes}</div>}
      {err && <div className="pf-card-err">{err}</div>}

      {mode ? (
        <div className="pf-card-form">
          {mode === 'override' ? (
            <select className="pf-input" value={text} onChange={e => setText(e.target.value)}>
              <option value="">— move to phase —</option>
              {trackPhases(comp.track).map(p => <option key={p} value={p}>{phaseLabel(p)}</option>)}
            </select>
          ) : (
            <textarea className="pf-input" rows={2} value={text} placeholder={mode === 'deny' ? 'QC issue (e.g. chip, misspelling)…' : mode === 'block' ? 'Blocker reason…' : 'Note…'} onChange={e => setText(e.target.value)} />
          )}
          <div className="pf-card-form-actions">
            <button type="button" className="pf-btn pf-btn-go" disabled={busy} onClick={() => {
              if (mode === 'deny') return run(a => qcDenyComponent(comp.id, text, { actor: a }))
              if (mode === 'note') return run(a => setComponentNotes(comp.id, text, { actor: a }))
              if (mode === 'block') return run(a => setComponentBlocker(comp.id, text, { actor: a }))
              if (mode === 'override') { if (!text) { setErr('Pick a phase'); return } return run(a => overrideComponentPhase(comp.id, text, { actor: a })) }
            }}>{busy ? '…' : 'Save'}</button>
            <button type="button" className="pf-btn" onClick={() => { setMode(null); setText(''); setErr(null) }}>Cancel</button>
          </div>
        </div>
      ) : (
        <div className="pf-card-actions">
          {atQc ? (
            <>
              <button type="button" className="pf-btn pf-btn-go" disabled={busy || held} title={held ? 'Clear the issue first' : 'Approve'} onClick={() => run(a => qcApproveComponent(comp.id, { actor: a }))}>✓ Approve</button>
              {held
                ? <button type="button" className="pf-btn" disabled={busy} onClick={() => run(a => clearComponentQcIssue(comp.id, { actor: a }))}>Clear issue</button>
                : <button type="button" className="pf-btn pf-btn-deny" disabled={busy} onClick={() => openMode('deny')}>✕ Deny</button>}
            </>
          ) : (
            <button type="button" className="pf-btn pf-btn-go" disabled={busy} onClick={() => run(a => advanceComponent(comp.id, { actor: a }))}>Advance →</button>
          )}
          <button type="button" className="pf-btn" disabled={busy} onClick={() => run(a => reverseComponent(comp.id, { actor: a }))}>← Back</button>
          <button type="button" className="pf-btn pf-btn-more" onClick={() => setMenu(m => !m)}>⋯</button>
        </div>
      )}

      {menu && !mode && (
        <div className="pf-menu">
          <button type="button" onClick={() => openMode('override')}>Override phase</button>
          {comp.on_floor && <button type="button" onClick={() => run(a => setComponentOnFloor(comp.id, false, { actor: a }))}>↩ Return to queue</button>}
          {comp.blocker
            ? <button type="button" onClick={() => run(a => setComponentBlocker(comp.id, null, { actor: a }))}>Clear blocker</button>
            : <button type="button" onClick={() => openMode('block')}>Mark blocked</button>}
          <button type="button" onClick={() => openMode('note')}>Add / edit note</button>
          {comp.job_id && <button type="button" onClick={() => onOpenJob?.(comp.job_id)}>Open job</button>}
          {comp.order_id && <button type="button" onClick={() => onOpenOrderDetail?.(comp.order_id)}>Open order</button>}
        </div>
      )}
    </div>
  )
}

// ── Order-side production control (OrderDetail) ──────────────────────────────
// Reads + writes the SAME job_components the board uses (source:'order'). Light-
// themed to match OrderDetail. Track-aware (only that order's track's phases),
// multi-component (die + base set independently), QC gate respected. Two-way: this
// and the board both write the one job_components row — no second status field.
export function OrderProductionStatus({ orderId }) {
  const [comps, setComps] = useState(null)
  const load = useCallback(async () => { setComps(await getJobComponents({ orderId })) }, [orderId])
  useEffect(() => { load() }, [load])  // eslint-disable-line react-hooks/set-state-in-effect
  if (comps == null) return <div className="ops"><style>{OPS_CSS}</style><div className="ops-empty">Loading…</div></div>
  if (comps.length === 0) return (
    <div className="ops"><style>{OPS_CSS}</style>
      <div className="ops-empty">No production components yet — they seed when the order enters production.</div>
    </div>
  )
  return (
    <div className="ops">
      <style>{OPS_CSS}</style>
      <div className="ops-head">
        <span className="ops-track">{TRACK_LABEL[comps[0].track]} track</span>
        <button type="button" className="ops-refresh" onClick={load} title="Reflect board changes">↻</button>
      </div>
      {comps.map(c => <OpsRow key={c.id} comp={c} onChanged={load} />)}
      <div className="ops-note">Edits here move the same piece the Jobs board tracks — one source of truth.</div>
    </div>
  )
}

function OpsRow({ comp, onChanged }) {
  const [busy, setBusy] = useState(false)
  const [mode, setMode] = useState(null)   // 'deny' | 'override'
  const [text, setText] = useState('')
  const [err, setErr] = useState(null)
  const atQc = comp.current_phase === QC_PHASE
  const held = !!comp.qc_issue
  const run = async (fn) => {
    setBusy(true); setErr(null)
    const actor = await getCurrentStaffName()
    const r = await fn(actor)
    setBusy(false)
    if (r && r.ok === false) { setErr(r.error || 'Failed'); return }
    setMode(null); setText(''); onChanged?.()
  }
  return (
    <div className={`ops-row ${held ? 'ops-row-held' : ''}`}>
      <div className="ops-row-main">
        <span className="ops-type">{TYPE_LABEL[comp.component_type] || comp.label}</span>
        <span className="ops-phase">{phaseLabel(comp.current_phase)}</span>
        {held && <span className="ops-held">⚠ HELD: {comp.qc_issue}</span>}
      </div>
      {mode === 'deny' ? (
        <div className="ops-form">
          <input className="ops-input" value={text} placeholder="QC issue (chip, misspelling…)" onChange={e => setText(e.target.value)} />
          <button type="button" className="ops-btn ops-btn-deny" disabled={busy} onClick={() => run(a => qcDenyComponent(comp.id, text, { actor: a, source: 'order' }))}>Hold</button>
          <button type="button" className="ops-btn" onClick={() => { setMode(null); setText('') }}>Cancel</button>
        </div>
      ) : mode === 'override' ? (
        <div className="ops-form">
          <select className="ops-input" value={text} onChange={e => setText(e.target.value)}>
            <option value="">— move to phase —</option>
            {trackPhases(comp.track).map(p => <option key={p} value={p}>{phaseLabel(p)}</option>)}
          </select>
          <button type="button" className="ops-btn ops-btn-go" disabled={busy || !text} onClick={() => run(a => overrideComponentPhase(comp.id, text, { actor: a, source: 'order' }))}>Set</button>
          <button type="button" className="ops-btn" onClick={() => { setMode(null); setText('') }}>Cancel</button>
        </div>
      ) : (
        <div className="ops-actions">
          {atQc ? (
            <>
              <button type="button" className="ops-btn ops-btn-go" disabled={busy || held} title={held ? 'Clear the issue first' : 'Approve'} onClick={() => run(a => qcApproveComponent(comp.id, { actor: a, source: 'order' }))}>✓ Approve</button>
              {held
                ? <button type="button" className="ops-btn" disabled={busy} onClick={() => run(a => clearComponentQcIssue(comp.id, { actor: a, source: 'order' }))}>Clear issue</button>
                : <button type="button" className="ops-btn ops-btn-deny" disabled={busy} onClick={() => setMode('deny')}>✕ Deny</button>}
            </>
          ) : (
            <button type="button" className="ops-btn ops-btn-go" disabled={busy} onClick={() => run(a => advanceComponent(comp.id, { actor: a, source: 'order' }))}>Advance →</button>
          )}
          <button type="button" className="ops-btn" disabled={busy} onClick={() => run(a => reverseComponent(comp.id, { actor: a, source: 'order' }))}>← Back</button>
          <button type="button" className="ops-btn ops-btn-ghost" onClick={() => { setMode('override'); setText('') }}>Set phase…</button>
        </div>
      )}
      {err && <div className="ops-err">{err}</div>}
    </div>
  )
}

const OPS_CSS = `
  .ops { font: inherit; }
  .ops-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
  .ops-track { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: #8a7f6a; }
  .ops-refresh { font: inherit; font-size: 13px; background: none; border: 1px solid #e0dbd0; border-radius: 6px; padding: 2px 8px; cursor: pointer; color: #6b6256; }
  .ops-empty { font-size: 13px; color: #9a948a; }
  .ops-row { padding: 8px 0; border-top: 1px solid #f0ece1; }
  .ops-row:first-of-type { border-top: none; }
  .ops-row-held { background: #fdf3f2; border-radius: 8px; padding: 8px 10px; }
  .ops-row-main { display: flex; align-items: center; gap: 10px; margin-bottom: 6px; flex-wrap: wrap; }
  .ops-type { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: #6b6256; background: #f0ece1; border-radius: 999px; padding: 2px 9px; }
  .ops-phase { font-size: 13.5px; font-weight: 700; color: #2a2a27; }
  .ops-held { font-size: 11.5px; color: #b3261e; font-weight: 600; }
  .ops-actions, .ops-form { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
  .ops-btn { font: inherit; font-size: 12px; font-weight: 600; padding: 4px 10px; border-radius: 7px; border: 1px solid #d8d2c6; background: #fff; color: #2a2a27; cursor: pointer; }
  .ops-btn:hover:not(:disabled) { background: #f7f4ee; }
  .ops-btn:disabled { opacity: 0.45; cursor: not-allowed; }
  .ops-btn-go { border-color: #b9892e; background: #fbf6ec; color: #8a5a12; }
  .ops-btn-deny { border-color: #e3b4b0; background: #fdf3f2; color: #b3261e; }
  .ops-btn-ghost { color: #6b6256; }
  .ops-input { font: inherit; font-size: 13px; padding: 4px 8px; border: 1px solid #d8d2c6; border-radius: 7px; min-width: 180px; }
  .ops-err { font-size: 11.5px; color: #b3261e; margin-top: 4px; }
  .ops-note { font-size: 11px; color: #9a948a; margin-top: 8px; }
`

const PF_CSS = `
  .pf-funnel-wrap { display: flex; flex-direction: column; gap: 10px; }
  .pf-funnel-tracks { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; }
  .pf-funnel-track { background: #151a22; border: 1px solid #232a35; border-radius: 9px; padding: 12px; cursor: pointer; }
  .pf-funnel-track:hover { border-color: #3a4452; }
  .pf-funnel-head { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 8px; }
  .pf-funnel-label { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: #c7cedb; }
  .pf-funnel-total { font-family: var(--font-m, 'JetBrains Mono'), monospace; font-size: 16px; font-weight: 700; color: #f4f6fa; }
  .pf-funnel-row { width: 100%; font: inherit; background: none; border: 1px solid transparent; border-radius: 6px; display: grid; grid-template-columns: 92px 1fr 22px; gap: 6px; align-items: center; padding: 3px 4px; cursor: pointer; text-align: left; }
  .pf-funnel-row:hover:not(:disabled) { background: #1a212b; }
  .pf-funnel-row:disabled { cursor: default; opacity: 0.7; }
  .pf-funnel-row-open { background: #1a2230; border-color: #3a4452; }
  .pf-funnel-pl { font-size: 10px; color: #8b95a5; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .pf-funnel-bar { height: 9px; background: #0E1116; border-radius: 5px; overflow: hidden; }
  .pf-funnel-fill { display: block; height: 100%; background: #3a4452; border-radius: 5px; }
  .pf-funnel-bottleneck .pf-funnel-fill { background: #fbbf24; }
  .pf-funnel-bottleneck .pf-funnel-pl { color: #fbbf24; }
  .pf-funnel-n { font-family: var(--font-m, 'JetBrains Mono'), monospace; font-size: 11px; color: #c7cedb; text-align: right; }
  .pf-funnel-detail { display: flex; flex-direction: column; gap: 3px; padding: 4px 4px 6px 8px; }
  .pf-funnel-card { font: inherit; font-size: 11px; text-align: left; background: #0E1116; border: 1px solid #232a35; border-radius: 6px; padding: 4px 8px; color: #c7cedb; cursor: pointer; }
  .pf-funnel-card:hover { background: #151b24; color: #f4f6fa; }
  .pf-funnel-note { font-size: 11.5px; color: #6f7a8a; }
  .pf-funnel-link { font: inherit; font-size: 11.5px; background: none; border: none; color: #8b95a5; cursor: pointer; text-decoration: underline; padding: 0; }
  .pf-funnel-link:hover { color: #f4f6fa; }

  .pf-tabs { display: flex; gap: 6px; margin-bottom: 14px; flex-wrap: wrap; }
  .pf-tab { font: inherit; font-size: 12.5px; font-weight: 700; padding: 7px 16px; border-radius: 999px; border: 1px solid #232a35; background: #11151c; color: #8b95a5; cursor: pointer; }
  .pf-tab:hover { border-color: #3a4452; color: #c7cedb; }
  .pf-tab.on { background: #1a2230; border-color: #3a4452; color: #f4f6fa; }
  .pf-tab-n { font-family: var(--font-m, 'JetBrains Mono'), monospace; font-size: 11px; color: #6f7a8a; margin-left: 4px; }
  .pf-tab.on .pf-tab-n { color: #fbbf24; }
  .pf-qbtn-on { border-color: #5a4a1e !important; color: #fbbf24 !important; }
  .pf-col-headr { display: inline-flex; align-items: baseline; gap: 8px; }
  .pf-col-add { font: inherit; font-size: 10.5px; font-weight: 700; border: 1px solid #2a313c; background: #1a212b; color: #8b95a5; border-radius: 5px; padding: 1px 7px; cursor: pointer; }
  .pf-col-add:hover { color: #f4f6fa; border-color: #3a4452; }
  .pf-col-empty { font-size: 11px; color: #3a4452; text-align: center; padding: 8px 0; }
  .pf-queue { background: #11151c; border: 1px solid #5a4a1e; border-radius: 10px; padding: 12px; margin-bottom: 16px; }
  .pf-queue-head { display: flex; align-items: center; gap: 12px; margin-bottom: 8px; flex-wrap: wrap; }
  .pf-queue-search { max-width: 340px; }
  .pf-queue-count { font-size: 11.5px; color: #8b95a5; }
  .pf-queue-list { display: flex; flex-direction: column; gap: 4px; max-height: 320px; overflow-y: auto; }
  .pf-queue-row { display: flex; align-items: center; gap: 10px; background: #151a22; border: 1px solid #232a35; border-radius: 7px; padding: 6px 10px; }
  .pf-queue-fam { font-size: 12.5px; font-weight: 700; color: #f4f6fa; min-width: 110px; }
  .pf-queue-meta { flex: 1; font-size: 11px; color: #8b95a5; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .pf-queue-empty { font-size: 12px; color: #6f7a8a; padding: 10px; text-align: center; }
  .pf-modal-overlay { position: fixed; inset: 0; z-index: 1300; background: rgba(5,8,12,.6); display: flex; align-items: center; justify-content: center; padding: 20px; }
  .pf-modal { background: #11151c; border: 1px solid #3a4452; border-radius: 12px; width: min(640px, 96vw); padding: 16px 18px; display: flex; flex-direction: column; gap: 10px; box-shadow: 0 24px 60px rgba(0,0,0,.5); }
  .pf-modal-title { font-size: 14px; font-weight: 700; color: #f4f6fa; }

  .pf-board-track { margin-bottom: 22px; }
  .pf-board-track-head { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
  .pf-board-track-label { font-size: 15px; font-weight: 700; color: #f4f6fa; }
  .pf-cols { display: flex; gap: 10px; overflow-x: auto; padding-bottom: 6px; }
  .pf-col { flex: 0 0 200px; background: #11151c; border: 1px solid #20262f; border-radius: 10px; padding: 9px; }
  .pf-col-bn { border-color: #5a4a1e; }
  .pf-col-head { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 8px; }
  .pf-col-l { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.03em; color: #8b95a5; }
  .pf-col-n { font-family: var(--font-m, 'JetBrains Mono'), monospace; font-size: 11px; color: #c7cedb; }
  .pf-col-body { display: flex; flex-direction: column; gap: 8px; min-height: 12px; }

  .pf-card { background: #151a22; border: 1px solid #232a35; border-radius: 9px; padding: 9px 10px; position: relative; }
  .pf-card-held { border-color: #5c2a2a; background: #1c1416; }
  .pf-card-blocked { border-color: #5a4a1e; }
  .pf-card-top { display: flex; justify-content: space-between; align-items: baseline; gap: 6px; }
  .pf-card-fam { font-size: 13px; font-weight: 700; color: #f4f6fa; }
  .pf-card-type { font-size: 9.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: #8b95a5; background: #1a212b; border-radius: 999px; padding: 1px 7px; }
  .pf-card-spec { font-family: var(--font-m, 'JetBrains Mono'), monospace; font-size: 10.5px; color: #c7cedb; margin-top: 2px; }
  .pf-card-meta { font-size: 10.5px; color: #6f7a8a; margin-top: 2px; }
  .pf-card-issue { font-size: 11px; color: #f87171; margin-top: 6px; font-weight: 600; }
  .pf-card-blk { font-size: 11px; color: #fbbf24; margin-top: 6px; }
  .pf-card-ctx { font-size: 10.5px; color: #a78bfa; margin-top: 4px; }
  .pf-card-note { font-size: 10.5px; color: #8b95a5; margin-top: 4px; }
  .pf-card-err { font-size: 10.5px; color: #f87171; margin-top: 4px; }
  .pf-card-actions { display: flex; gap: 5px; margin-top: 8px; flex-wrap: wrap; }
  .pf-btn { font: inherit; font-size: 11px; font-weight: 600; padding: 4px 8px; border-radius: 6px; border: 1px solid #2a313c; background: #1a212b; color: #e6e9ef; cursor: pointer; }
  .pf-btn:hover:not(:disabled) { background: #232c38; }
  .pf-btn:disabled { opacity: 0.4; cursor: not-allowed; }
  .pf-btn-go { border-color: #2d5a44; background: #15301f; color: #34d399; }
  .pf-btn-deny { border-color: #5c2a2a; background: #1c1416; color: #f87171; }
  .pf-btn-more { padding: 4px 7px; }
  .pf-card-form { margin-top: 8px; display: flex; flex-direction: column; gap: 6px; }
  .pf-input { font: inherit; font-size: 11.5px; width: 100%; background: #0E1116; border: 1px solid #2a313c; border-radius: 6px; color: #e6e9ef; padding: 5px 7px; resize: vertical; }
  .pf-card-form-actions { display: flex; gap: 5px; }
  .pf-menu { display: flex; flex-direction: column; gap: 2px; margin-top: 7px; border-top: 1px solid #232a35; padding-top: 7px; }
  .pf-menu button { font: inherit; font-size: 11.5px; text-align: left; background: none; border: none; color: #c7cedb; cursor: pointer; padding: 3px 4px; border-radius: 5px; }
  .pf-menu button:hover { background: #1a212b; color: #f4f6fa; }
`
