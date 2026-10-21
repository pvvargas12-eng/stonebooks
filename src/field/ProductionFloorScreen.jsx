// =============================================================================
// ProductionFloorScreen — the REAL production floor in a pocket (v2)
// =============================================================================
// Paul (2026-07-23): "i need to be able to adjust these production queues on
// the field app... i want to start with blast — i'll go to my assembly line
// and add every order to that list. same thing for the others."
// The desktop ProductionBoard's exact substrate on a phone: same
// job_components, same track/phase vocabulary, same hand-picked rule (nothing
// lands on the floor by itself), same one-way rollup to the stone ladder.
// Track chips → phase buckets → bucket list with ADVANCE/BACK (8s undo), the
// QC approve/deny gate, and per-bucket "+ ADD" that searches the queue —
// ready pieces (design approved · stone here/in stock · contracted) first,
// wearing the same condition chips as the desktop picker. The old
// stone-ladder lanes are gone: Paul flagged twice that they weren't his
// steps; these are his columns.
// =============================================================================
import { useState, useEffect, useCallback } from 'react'
import {
  getProductionComponents, getBringUpReady,
  advanceComponent, reverseComponent, setComponentOnFloor, overrideComponentPhase,
  qcApproveComponent, qcDenyComponent, clearComponentQcIssue,
  addComponentExtraPhase, moveComponentExtraPhase, removeComponentExtraPhase,
  setComponentConfirmedSize, permitStatusLabel,
} from '../lib/stonebooksData'
import { boardPhases, phaseLabel, phaseIndex, nextPhase, prevPhase, QC_PHASE, TRACKS_WITH_QC, advanceVerb } from '../lib/jobComponents'
// Assembly lines (LINES-1, Paul 2026-10-08: "I need this updated in
// stonebooks field to view the lines — active then other ones"). Read-only
// on the phone: the strip + the L1 #07 tags; building lives on the desktop.
import { listFloorLines, lineLabel, itemTone, addStonesToLine, removeLineItem, moveStoneToNextLine, closeFloorLine, createFloorLine } from '../lib/floorLines'

const LINE_TONE = {
  ready: { bg: 'transparent', bd: '#2d7a4f', fg: '#1d7a55' },
  up:    { bg: '#1e3350', bd: '#2f5586', fg: '#bcd4f5' },
  cut:   { bg: '#4a3a12', bd: '#7a5d12', fg: '#fbe3a0' },
  blast: { bg: '#1d7a55', bd: '#34d399', fg: '#eafff4' },
  out:   { bg: '#e9e5da', bd: '#d9d2c0', fg: '#9a948a' },
  deck:  { bg: 'transparent', bd: '#9fb4d6', fg: '#6b7a90' },
}
const LINE_STATUS = { active: 'ACTIVE', on_deck: 'ON DECK', planning: 'PLANNING', complete: 'DONE' }

const TRACK_ORDER = ['new_stone', 'inscription', 'bronze', 'door']
const TRACK_CHIP = { new_stone: 'NEW STONE', inscription: 'INSCRIPTION', bronze: 'BRONZE', door: 'DOORS' }
const TYPE_LABEL = { die: 'Die', base: 'Base', inscription: 'Inscription', door: 'Door', bronze: 'Bronze' }
const DAY_MS = 86400000
// Confirm-size lives where the stone physically is when Paul measures it —
// Brought to Line / Cut, the same two phases the cut list's stone-up read
// covers (FIELD-FDN-CUT, 2026-07-29).
const SIZE_PHASES = new Set(['brought_to_line', 'cut'])
const sizeText = (cs) => (cs && (cs.l || cs.w)) ? [cs.l, cs.w].filter(Boolean).join(' × ') : null

// Order age in days (signed first, created fallback, piece created for trade).
const ageDaysOf = (c, todayMs) => {
  const t = Date.parse(c.order?.signed_at || c.order?.created_at || c.created_at || '')
  if (!todayMs || !Number.isFinite(t)) return null
  return Math.max(0, Math.floor((todayMs - t) / DAY_MS))
}
// Paul's age circle: under 2 months green, 2–5 amber, 5+ red.
const AgeDot = ({ n }) => n == null ? null : (
  <span className={`fl-chip ${n < 60 ? 'fl-c-good' : n < 150 ? 'fl-c-warn' : 'fl-c-bad'}`}>{n}d</span>
)

// Field grammar: families read ALL-CAPS. Same fallback chain as the desktop board.
const famOf = (c) => String(
  c.order?.primary_lastname || c.order?.customer?.last_name || c.vendor_request?.family_name
  || c.cemetery_order?.cemetery_name || c.order?.cemetery?.name || '—',
).toUpperCase()
const metaOf = (c) => [
  // c.size (buildDieSpec) already ends with the color name — c.color is the
  // raw code and read as a duplicate ("Mountain Rose · mountain-rose").
  TYPE_LABEL[c.component_type] || c.label, c.size,
  c.order?.order_number || c.cemetery_order?.order_number,
  c.order?.cemetery?.name || c.cemetery_order?.cemetery_name,
].filter(Boolean).join(' · ')
// Blockers on the card (Paul 2026-08-04: "i need to see blockers like permit
// not approved, not paid in full") — same rules as the desktop board.
const permitCtx = (c) => {
  const s = c.order?.permit_status
  return (s && s !== 'approved' && s !== 'not_required' && s !== 'unknown') ? permitStatusLabel(s) : null
}
const permitRed = (c) => !['submitted', 'pending'].includes(c.order?.permit_status)
const notPaidInFull = (c) => !!c.order?.status && !['paid_in_full', 'closed'].includes(c.order.status)

// Group queue pieces into ONE ROW PER ORDER, preserving the incoming sort.
const groupByOrder = (pieces) => {
  const order = []
  const byKey = new Map()
  for (const c of pieces) {
    const k = c.job_id || `solo:${c.id}`
    if (!byKey.has(k)) { byKey.set(k, []); order.push(k) }
    byKey.get(k).push(c)
  }
  return order.map(k => {
    const group = byKey.get(k)
    return { key: k, rep: group.find(p => p.component_type === 'die') || group[0], pieces: group }
  })
}
// A queue ROW is one order — die and base ride together.
const groupMeta = (g) => {
  const kinds = [...new Set(g.pieces.map(p => TYPE_LABEL[p.component_type] || p.label).filter(Boolean))]
  return [kinds.join(' + '), g.rep.size, g.rep.color,
    g.rep.order?.order_number || g.rep.cemetery_order?.order_number,
    g.rep.order?.cemetery?.name || g.rep.cemetery_order?.cemetery_name].filter(Boolean).join(' · ')
}

export default function ProductionFloorScreen({ who, undo, onOpenJob, onBack = null, backLabel = 'More' }) {
  const [comps, setComps] = useState(null)
  const [recs, setRecs] = useState(() => ({ count: 0, readyByTrack: {}, byJob: new Map() }))
  const [err, setErr] = useState(null)
  const [track, setTrack] = useState('new_stone')
  const [bucket, setBucket] = useState(null)     // phase code | null = buckets view
  const [addOpen, setAddOpen] = useState(false)
  const [q, setQ] = useState('')
  const [busyId, setBusyId] = useState(null)
  const [denyFor, setDenyFor] = useState(null)   // component id with the QC deny input open
  const [denyText, setDenyText] = useState('')
  const [sizeFor, setSizeFor] = useState(null)   // component with the confirm-size sheet open
  const [sizeL, setSizeL] = useState('')
  const [sizeW, setSizeW] = useState('')

  const [todayMs, setTodayMs] = useState(0)
  const [lines, setLines] = useState([])
  const [lineOpen, setLineOpen] = useState(null)   // line id expanded in the lines strip
  const [lineAddFor, setLineAddFor] = useState(null)   // line id with the add sheet open (LINES on the phone)
  const [lq, setLq] = useState('')
  const load = useCallback(async () => {
    try {
      const [d, rec, ls] = await Promise.all([
        getProductionComponents(),
        getBringUpReady().catch(() => ({ count: 0, readyByTrack: {}, byJob: new Map() })),
        listFloorLines().catch(() => []),
      ])
      setComps(d || []); setRecs(rec); setLines(ls || []); setErr(null)
      const t = new Date(); t.setHours(0, 0, 0, 0); setTodayMs(t.getTime())
    } catch (e) { setErr(e?.message || 'Could not load the floor.') }
  }, [])
  const compById = new Map((comps || []).map(c => [c.id, c]))
  const lineTagById = new Map()
  for (const l of lines) l.items.forEach((it, i) => lineTagById.set(it.component_id, `L${l.number} #${String(i + 1).padStart(2, '0')}`))
  const liveLines = lines.filter(l => l.status !== 'complete')
  useEffect(() => { load() }, [load])  // eslint-disable-line react-hooks/set-state-in-effect

  const loading = comps == null
  // Board vocabulary only — a blasted new-stone piece (ready_to_set) lives on
  // the installation list, never in a floor column or the add queue.
  const phases = boardPhases(track)
  const inTrack = (comps || []).filter(c => c.track === track && phases.includes(c.current_phase))
  const floor = inTrack.filter(c => c.on_floor)
  const queue = inTrack.filter(c => !c.on_floor)
  const readyOf = (c) => !!(c.job_id && recs.byJob.get(c.job_id)?.ready)
  // HARD RULE (Paul 2026-07-23, cut-list doctrine): pieces we positively KNOW
  // are not contracted — drafts/leads — never appear in the add sheet at all.
  // No-job pieces (trade/dealer) stay; they're real work.
  const notLead = (c) => { const r = c.job_id ? recs.byJob.get(c.job_id) : null; return !r || r.contracted }
  const queueVisible = queue.filter(notLead)
  const readyQueue = queueVisible.filter(readyOf)
  // Paul's queue order: all conditions met first, then oldest to newest.
  const queueSorted = [...queueVisible].sort((a, b) =>
    ((readyOf(b) ? 1 : 0) - (readyOf(a) ? 1 : 0))
    || ((ageDaysOf(b, todayMs) ?? -1) - (ageDaysOf(a, todayMs) ?? -1)))
  const actor = who?.name || null

  const matches = (c) => {
    const t = q.trim().toLowerCase()
    if (!t) return true
    return `${famOf(c)} ${metaOf(c)}`.toLowerCase().includes(t)
  }

  // One move at a time; every reversible move gets the field-standard 8s undo.
  const run = async (id, fn, undoLabel = null, undoFn = null) => {
    if (busyId) return
    setBusyId(id)
    const r = await fn().catch(e => ({ ok: false, error: e?.message }))
    setBusyId(null)
    if (r && r.ok === false) { undo.showError(r.error || 'That move failed.'); return }
    await load()
    if (undoLabel && undoFn) undo.show(undoLabel, async () => { await undoFn().catch(() => {}); load() })
  }

  // Add to / remove from a line — the field-standard 8s undo reverses each.
  const addToLine = (line, group) => {
    const dies = group.pieces.filter(pc => pc.component_type !== 'base')
    const ids = new Set(dies.map(pc => pc.id))
    run(group.rep.id, () => addStonesToLine(line.id, dies, { by: actor }),
      `Added ${famOf(group.rep)} to ${lineLabel(line)}`,
      async () => {
        const ls = await listFloorLines().catch(() => [])
        const its = (ls.find(l => l.id === line.id)?.items || []).filter(it => ids.has(it.component_id))
        for (const it of its) await removeLineItem(it.id)
        // A running line put the piece on the board — the undo takes it back off.
        if (line.status === 'active') for (const pc of dies) await setComponentOnFloor(pc.id, false, { actor, source: 'field' }).catch(() => {})
      })
  }
  const removeFromLine = (line, it) => {
    const full = compById.get(it.component_id)
    run(it.id, () => removeLineItem(it.id),
      `Removed ${full ? famOf(full) : 'the stone'} from ${lineLabel(line)}`,
      async () => { if (full) await addStonesToLine(line.id, [full], { by: actor }) })
  }

  // `pieces` = every die of the order at this step (a double die has two) —
  // one card, every verb moves them together (Paul 2026-10-21: no duplicates).
  const each = (pieces, fn) => async () => {
    let r = null
    for (const p of pieces) { r = await fn(p); if (r && r.ok === false) return r }
    return r || { ok: true }
  }
  const advance = (c, pieces = [c]) => {
    const next = nextPhase(c.track, c.current_phase)
    // Blasting out of the queue hands the piece to the installation list and
    // off the board — the undo has to bring it BACK onto the floor too.
    const handoff = c.track === 'new_stone' && next === 'ready_to_set'
    run(c.id,
      each(pieces, p => advanceComponent(p.id, { actor, source: 'field' })),
      handoff ? `${famOf(c)} blasted → installation list` : `${famOf(c)} → ${next ? phaseLabel(next) : 'done'}`,
      handoff
        ? each(pieces, async (p) => {
            await reverseComponent(p.id, { actor, source: 'field' })
            return setComponentOnFloor(p.id, true, { actor, source: 'field' })
          })
        : each(pieces, p => reverseComponent(p.id, { actor, source: 'field' })))
  }
  const back = (c, pieces = [c]) => {
    const prev = prevPhase(c.track, c.current_phase)
    run(c.id,
      each(pieces, p => reverseComponent(p.id, { actor, source: 'field' })),
      `${famOf(c)} ← ${prev ? phaseLabel(prev) : ''}`,
      each(pieces, p => advanceComponent(p.id, { actor, source: 'field' })))
  }
  // Off this line, onto the next one — next week's queue (Paul 2026-10-21).
  const nextLine = (c, pieces = [c]) => {
    run(c.id, each(pieces, p => moveStoneToNextLine(p.id, { by: actor })), null, null)
  }
  // ONE ROW PER ORDER (Paul 2026-07-27): die and base are separate components,
  // so a name search listed the same order twice. The queue lists the JOB once
  // (die is the face) and adding brings every piece of it — nothing orphaned.
  const queueGroups = groupByOrder(queueSorted)

  // LINES ON THE PHONE (Paul 2026-10-21: "when I view the lines I want to be
  // able to click on the lines then add and remove"). The pool mirrors the
  // desktop Line Planner: new-stone dies off the board, on no line, STONE
  // orders only (an inscription order with a stray die stays out), meeting the
  // bring-up gates. One row per order; adding takes every die of the order.
  const onLineIds = new Set(lines.flatMap(l => l.items.map(it => it.component_id)))
  const isStoneOrder = (o) => { const st = o?.service_types; return !Array.isArray(st) || st.length === 0 || st.some(x => ['NEW_STONE', 'CIVIC_MEMORIAL', 'MAUSOLEUM'].includes(x)) }
  const linePhases = boardPhases('new_stone')
  const linePool = groupByOrder((comps || []).filter(c => c.track === 'new_stone' && c.component_type !== 'base' && !c.on_floor
    && linePhases.includes(c.current_phase) && !onLineIds.has(c.id) && isStoneOrder(c.order) && readyOf(c)))
  const lineMatches = (c) => { const t = lq.trim().toLowerCase(); return !t || `${famOf(c)} ${metaOf(c)}`.toLowerCase().includes(t) }
  const addToBucket = (g) => {
    const prev = g.pieces.map(p => ({ id: p.id, phase: p.current_phase }))
    run(g.rep.id,
      async () => {
        for (const p of g.pieces) {
          const r = await setComponentOnFloor(p.id, true, { actor, phase: bucket })
          if (r && r.ok === false) return r
        }
        return { ok: true }
      },
      `${famOf(g.rep)} added to ${phaseLabel(bucket)}`,
      async () => {
        for (const p of prev) {
          await setComponentOnFloor(p.id, false, { actor })
          if (p.phase && p.phase !== bucket) await overrideComponentPhase(p.id, p.phase, { actor, source: 'field' })
        }
      })
  }
  const qcApprove = (c) => run(c.id, () => qcApproveComponent(c.id, { actor, source: 'field' }))
  const qcDeny = (c) => {
    if (!denyText.trim()) { undo.showError('Type the QC issue first.'); return }
    run(c.id, () => qcDenyComponent(c.id, denyText.trim(), { actor, source: 'field' }))
    setDenyFor(null); setDenyText('')
  }
  const qcClear = (c) => run(c.id, () => clearComponentQcIssue(c.id, { actor, source: 'field' }))

  // Confirm size for the cutter (Paul 2026-07-29): measure the stone that's
  // actually on the line — the stencil gets cut to THIS, not the spec. Undo
  // restores whatever was confirmed before (usually nothing).
  const openSize = (c) => {
    setSizeFor(c)
    setSizeL(c.confirmed_size?.l || '')
    setSizeW(c.confirmed_size?.w || '')
  }
  const saveSize = () => {
    const c = sizeFor
    if (!c) return
    const l = sizeL.trim(), w = sizeW.trim()
    if (!l || !w) { undo.showError('Enter both length and width.'); return }
    const prev = c.confirmed_size || null
    setSizeFor(null)
    run(c.id,
      () => setComponentConfirmedSize(c.id, { l, w }, { actor, source: 'field' }),
      `${famOf(c)} cut size confirmed ${l} × ${w}`,
      () => setComponentConfirmedSize(c.id, prev ? { l: prev.l, w: prev.w } : null, { actor, source: 'field' }))
  }
  const clearSize = () => {
    const c = sizeFor
    if (!c?.confirmed_size) { setSizeFor(null); return }
    const prev = c.confirmed_size
    setSizeFor(null)
    run(c.id,
      () => setComponentConfirmedSize(c.id, null, { actor, source: 'field' }),
      `${famOf(c)} confirmed size cleared`,
      () => setComponentConfirmedSize(c.id, { l: prev.l, w: prev.w }, { actor, source: 'field' }))
  }

  const openPiece = (c) => {
    if (c.job_id || c.order_id) onOpenJob?.({ jobId: c.job_id || null, orderId: c.order_id || null })
  }

  if (err) return <div className="fl-empty">{err}</div>

  const bucketCards = bucket ? floor.filter(c => c.current_phase === bucket) : []
  // Parallel memberships (the Boyd case): pieces ALSO in this column while
  // their primary card sits elsewhere — separate steps happening together.
  // Only extras strictly AHEAD of the primary render: a membership at or
  // behind it is stale history (Paul: "ready to install means its blasted").
  const aheadExtra = (c, p) => Array.isArray(c.extra_phases) && c.extra_phases.includes(p)
    && phaseIndex(c.track, p) > phaseIndex(c.track, c.current_phase)
  const bucketAlso = bucket
    ? floor.filter(c => c.current_phase !== bucket && aheadExtra(c, bucket))
    : []
  const inCol = (c, p) => c.current_phase === p || aheadExtra(c, p)
  const hasQc = TRACKS_WITH_QC.has(track)

  return (
    <div>
      {onBack && !bucket && (
        <button type="button" className="fl-rowline" onClick={onBack}
          style={{ color: '#9A7209', fontWeight: 700, fontSize: 15, minHeight: 44 }}>
          &#8249; {backLabel}
        </button>
      )}

      {!bucket ? (
        <>
          <div style={{ margin: '4px 2px 10px' }}>
            <div className="fl-sect-h" style={{ fontSize: 26 }}>Production floor</div>
            <div className="fl-greet-sub">Your columns. Open one, add pieces from the queue, advance them.</div>
          </div>

          {/* Track chips — counts = pieces ON the floor; red = queued + ready to add. */}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '0 2px 12px' }}>
            {TRACK_ORDER.map(t => {
              const n = (comps || []).filter(c => c.track === t && c.on_floor).length
              const need = recs.readyByTrack[t] || 0
              return (
                <button key={t} type="button"
                  className={`fl-chip-btn${track === t ? ' on' : ''}`}
                  onClick={() => setTrack(t)}>
                  {TRACK_CHIP[t]} {loading ? '' : n}
                  {need > 0 && <span style={{ color: '#fff', background: '#B3261E', borderRadius: 999, padding: '1px 7px', marginLeft: 6, fontWeight: 800 }}>{need}</span>}
                </button>
              )
            })}
          </div>

          {loading && <div className="fl-empty">Loading the floor…</div>}

          {/* THE LINES — active first, then on deck / planning. Tap a line
              to see every stone on it with where it physically is. */}
          {!loading && track === 'new_stone' && liveLines.length > 0 && (
            <div style={{ margin: '0 2px 14px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                <div className="fl-label" style={{ marginBottom: 0 }}>Lines</div>
                <button type="button" className="fl-verb" style={{ borderColor: '#9A7209', color: '#9A7209' }} disabled={busyId === 'newline'}
                  title="Plan the next line — it waits on deck until the running one closes"
                  onClick={() => run('newline', () => createFloorLine(), null, null)}>+ NEW LINE</button>
              </div>
              {liveLines.map(l => {
                const open = lineOpen === l.id || (lineOpen === null && l.status === 'active')
                const c = l.counts
                const accent = l.status === 'active' ? '#9A7209' : l.status === 'on_deck' ? '#2f5586' : '#9a948a'
                return (
                  <div key={l.id} className="fl-row" style={{ cursor: 'pointer', borderColor: accent, borderWidth: l.status === 'active' ? 2 : 1 }}
                    onClick={() => setLineOpen(open ? (l.status === 'active' ? 'none' : null) : l.id)}>
                    <div className="fl-rowtop">
                      <span className="fl-fam">{lineLabel(l).toUpperCase()} <span className="fl-chip" style={{ background: accent, color: '#fff', marginLeft: 6 }}>{LINE_STATUS[l.status]}</span></span>
                      <span className="fl-chip fl-c-neutral">{c.total} stones</span>
                    </div>
                    <div className="fl-spec" style={{ fontFamily: 'inherit' }}>
                      {l.status === 'active'
                        ? `${c.waiting} to bring up · ${c.up - c.cut - c.blastQ} on the line · ${c.cut} cut · ${c.blastQ} blasting · ${c.blasted} out`
                        : l.status === 'on_deck' ? 'Slides in when the running line is blasted out' : `${c.total} / ${l.capacity || 18} built`}
                    </div>
                    {open && (
                      <>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10 }} onClick={e => e.stopPropagation()}>
                        <button type="button" className="fl-verb" style={{ borderColor: '#1d7a55', color: '#1d7a55' }}
                          onClick={() => { setLq(''); setLineAddFor(l.id) }}>+ ADD STONE</button>
                        {l.status === 'active' && (
                          <button type="button" className="fl-verb" style={{ borderColor: '#B3261E', color: '#B3261E' }} disabled={busyId === l.id}
                            onClick={() => {
                              const n = (l.open || []).length
                              if (!window.confirm(n > 0 ? `Close ${lineLabel(l)}? ${n} stone${n === 1 ? '' : 's'} not blasted move to the next line.` : `Close ${lineLabel(l)}?`)) return
                              run(l.id, () => closeFloorLine(l.id), null, null)
                            }}>CLOSE LINE</button>
                        )}
                        <span className="fl-spec" style={{ margin: 0 }}>tap × on a stone to take it off</span>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 6, marginTop: 8 }}>
                        {l.items.map((it, i) => {
                          const tone = l.status === 'active' ? itemTone(it) : 'deck'
                          const t = LINE_TONE[tone] || LINE_TONE.deck
                          const full = compById.get(it.component_id)
                          return (
                            <div key={it.id} style={{ background: t.bg, border: `1.5px solid ${t.bd}`, color: t.fg, borderRadius: 7, padding: '6px 7px', minWidth: 0, minHeight: 44 }}
                              onClick={e => { e.stopPropagation(); if (full) openPiece(full) }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <span style={{ fontSize: 10, fontWeight: 800, opacity: .7, fontFamily: 'var(--font-m, monospace)' }}>#{i + 1}</span>
                                {tone !== 'out' && (
                                  <button type="button" aria-label="Take this stone off the line" disabled={busyId === it.id}
                                    onClick={e => { e.stopPropagation(); removeFromLine(l, it) }}
                                    style={{ font: 'inherit', fontSize: 15, lineHeight: 1, fontWeight: 800, background: 'none', border: 'none', color: 'inherit', opacity: .85, padding: '0 2px', cursor: 'pointer' }}>×</button>
                                )}
                              </div>
                              <div style={{ fontSize: 12.5, fontWeight: 800, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{full ? famOf(full) : '—'}</div>
                              {full?.size && <div style={{ fontSize: 9.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontFamily: 'var(--font-m, monospace)' }}>{full.size}</div>}
                            </div>
                          )
                        })}
                        {l.items.length === 0 && <div className="fl-spec" style={{ gridColumn: '1 / -1' }}>Empty — tap + ADD STONE.</div>}
                      </div>
                      </>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          {!loading && (
            <div className="fl-tilegrid">
              {phases.map((p, i) => {
                const n = floor.filter(c => inCol(c, p)).length
                const showNeed = i === 0 && readyQueue.length > 0
                return (
                  <button key={p} type="button" className="fl-tile"
                    onClick={() => { setBucket(p); setAddOpen(false); setQ('') }}>
                    <div className="fl-tile-main">
                      <div className="fl-tile-name">{phaseLabel(p)}</div>
                      <div className="fl-tile-sub" style={showNeed ? { color: '#B3261E', fontWeight: 800 } : undefined}>
                        {showNeed ? `${readyQueue.length} ready to add` : (i === 0 ? `${queueVisible.length} in the queue` : 'Tap to work this list')}
                      </div>
                    </div>
                    <div className="fl-tile-count">{n}</div>
                  </button>
                )
              })}
            </div>
          )}
        </>
      ) : (
        <>
          <button type="button" className="fl-rowline" onClick={() => { setBucket(null); setAddOpen(false); setDenyFor(null) }}
            style={{ color: '#9A7209', fontWeight: 700, fontSize: 15, minHeight: 44 }}>
            &#8249; Columns
          </button>
          <div className="fl-sect" style={{ margin: '2px 2px 10px', display: 'flex', alignItems: 'center', gap: 10 }}>
            <span className="fl-sect-h">{phaseLabel(bucket)}</span>
            <span className="fl-sect-pill">{bucketCards.length + bucketAlso.length}</span>
            <button type="button" className="fl-verb" style={{ marginLeft: 'auto', borderColor: '#9A7209', color: '#9A7209' }}
              onClick={() => { setAddOpen(true); setQ('') }}>
              + ADD
            </button>
          </div>
          {bucket === phases[0] && readyQueue.length > 0 && (
            <div className="fl-spec" style={{ margin: '0 2px 10px', color: '#B3261E', fontWeight: 700, fontFamily: 'inherit' }}>
              {readyQueue.length} queued piece{readyQueue.length === 1 ? ' meets' : 's meet'} the conditions (design approved · stone here · contracted) — tap + ADD.
            </div>
          )}

          {bucketCards.length === 0 && bucketAlso.length === 0 && <div className="fl-empty-serif">Nothing here yet — + ADD pulls from the queue.</div>}
          {bucketAlso.map(c => (
            <div key={`also-${c.id}`} className="fl-row" style={{ cursor: 'default', borderStyle: 'dashed' }}>
              <div className="fl-rowtop">
                <span className="fl-fam">{famOf(c)} <AgeDot n={ageDaysOf(c, todayMs)} /></span>
                <span className="fl-chip fl-c-neutral" title={`Main card is at ${phaseLabel(c.current_phase)}`}>ALSO</span>
              </div>
              <div className="fl-spec">{metaOf(c)} · main: {phaseLabel(c.current_phase)}</div>
              {sizeText(c.confirmed_size) && (
                <div className="fl-spec" style={{ color: '#14775A', fontWeight: 700, fontFamily: 'inherit' }}>
                  Cut size confirmed: {sizeText(c.confirmed_size)}
                </div>
              )}
              <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                <button type="button" className="fl-verb" style={{ borderColor: '#1d7a55', color: '#1d7a55' }}
                  disabled={busyId === c.id}
                  onClick={() => run(c.id,
                    () => moveComponentExtraPhase(c.id, bucket, +1, { actor, source: 'field' }),
                    `${famOf(c)} parallel step advanced`,
                    () => addComponentExtraPhase(c.id, bucket, { actor, source: 'field' }))}>
                  ADVANCE →
                </button>
                {track === 'new_stone' && SIZE_PHASES.has(bucket) && (
                  <button type="button" className="fl-verb" style={{ borderColor: '#9A7209', color: '#9A7209' }}
                    disabled={busyId === c.id} onClick={() => openSize(c)}>
                    {c.confirmed_size ? 'EDIT SIZE' : 'CONFIRM SIZE'}
                  </button>
                )}
                <button type="button" className="fl-verb" disabled={busyId === c.id}
                  onClick={() => run(c.id,
                    () => moveComponentExtraPhase(c.id, bucket, -1, { actor, source: 'field' }),
                    `${famOf(c)} parallel step back`,
                    () => addComponentExtraPhase(c.id, bucket, { actor, source: 'field' }))}>
                  ← BACK
                </button>
                <button type="button" className="fl-verb" disabled={busyId === c.id}
                  onClick={() => run(c.id,
                    () => removeComponentExtraPhase(c.id, bucket, { actor, source: 'field' }),
                    `${famOf(c)} removed from ${phaseLabel(bucket)}`,
                    () => addComponentExtraPhase(c.id, bucket, { actor, source: 'field' }))}>
                  REMOVE
                </button>
              </div>
            </div>
          ))}
          {groupByOrder(bucketCards).map(g => {
            const c = g.rep
            const pcs = g.pieces
            const atQc = hasQc && c.current_phase === QC_PHASE
            const held = !!c.qc_issue
            const first = phaseIndex(c.track, c.current_phase) === 0
            const busy = busyId === c.id
            return (
              <div key={c.id} className="fl-row" style={{ cursor: 'default' }}>
                <div className="fl-rowtop">
                  <span className="fl-fam">{famOf(c)} <AgeDot n={ageDaysOf(c, todayMs)} />
                    {lineTagById.get(c.id) && <span className="fl-chip" style={{ marginLeft: 6, color: '#9A7209', border: '1px solid #C9A468', background: 'transparent' }}>{lineTagById.get(c.id)}</span>}
                    {pcs.length > 1 && <span className="fl-chip fl-c-neutral" style={{ marginLeft: 6 }}>{pcs.length} DIES</span>}
                  </span>
                  {held ? <span className="fl-chip fl-c-bad">HELD</span>
                    : c.blocker ? <span className="fl-chip fl-c-warn">BLOCKED</span> : null}
                </div>
                <div className="fl-spec">{metaOf(c)}</div>
                {sizeText(c.confirmed_size) && (
                  <div className="fl-spec" style={{ color: '#14775A', fontWeight: 700, fontFamily: 'inherit' }}>
                    Cut size confirmed: {sizeText(c.confirmed_size)}
                  </div>
                )}
                {notPaidInFull(c) && (
                  <div className="fl-spec" style={{ color: '#B3261E', fontWeight: 700, fontFamily: 'inherit' }}>NOT PAID IN FULL</div>
                )}
                {permitCtx(c) && (
                  <div className="fl-spec" style={{ color: permitRed(c) ? '#B3261E' : '#8A5A12', fontWeight: 700, fontFamily: 'inherit' }}>
                    Permit: {permitCtx(c)}
                  </div>
                )}
                {held && <div className="fl-spec" style={{ color: '#B3261E', fontFamily: 'inherit' }}>QC: {c.qc_issue}</div>}
                {c.blocker && !held && <div className="fl-spec" style={{ fontFamily: 'inherit' }}>{c.blocker}</div>}

                {denyFor === c.id ? (
                  <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                    <input className="fl-input" style={{ flex: 1, margin: 0 }} autoFocus
                      placeholder="QC issue (chip, misspelling…)"
                      value={denyText} onChange={e => setDenyText(e.target.value)} />
                    <button type="button" className="fl-verb" style={{ borderColor: '#B3261E', color: '#B3261E' }}
                      disabled={busy} onClick={() => qcDeny(c)}>HOLD</button>
                    <button type="button" className="fl-verb" onClick={() => { setDenyFor(null); setDenyText('') }}>X</button>
                  </div>
                ) : (
                  <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                    {atQc ? (held ? (
                      <button type="button" className="fl-verb" disabled={busy} onClick={() => qcClear(c)}>CLEAR ISSUE</button>
                    ) : (
                      <>
                        <button type="button" className="fl-verb" style={{ borderColor: '#1d7a55', color: '#1d7a55' }}
                          disabled={busy} onClick={() => qcApprove(c)}>APPROVE</button>
                        <button type="button" className="fl-verb" style={{ borderColor: '#B3261E', color: '#B3261E' }}
                          disabled={busy} onClick={() => { setDenyFor(c.id); setDenyText('') }}>DENY</button>
                      </>
                    )) : (
                      // The verb IS the work (Paul 2026-08-03: "still hate how
                      // it says advance not blasted") — BLASTED, CUT, STENCIL
                      // STUCK… never "advance".
                      <button type="button" className="fl-verb" style={{ borderColor: '#1d7a55', color: '#1d7a55' }}
                        disabled={busy} onClick={() => advance(c, pcs)}>
                        {busy ? '…' : `${(advanceVerb(c.track, c.current_phase) || 'Done').toUpperCase()} →`}
                      </button>
                    )}
                    <button type="button" className="fl-verb" disabled={busy || first} onClick={() => back(c, pcs)}>← BACK</button>
                    {track === 'new_stone' && lineTagById.get(c.id) && (
                      <button type="button" className="fl-verb" style={{ borderColor: '#2f5586', color: '#93c5fd' }} disabled={busy}
                        title="Off this line, onto the next one — next week's queue" onClick={() => nextLine(c, pcs)}>NEXT LINE →</button>
                    )}
                    {track === 'new_stone' && SIZE_PHASES.has(bucket) && (
                      <button type="button" className="fl-verb" style={{ borderColor: '#9A7209', color: '#9A7209' }}
                        disabled={busy} onClick={() => openSize(c)}>
                        {c.confirmed_size ? 'EDIT SIZE' : 'CONFIRM SIZE'}
                      </button>
                    )}
                    {(c.job_id || c.order_id) && (
                      <button type="button" className="fl-verb" style={{ marginLeft: 'auto' }} onClick={() => openPiece(c)}>OPEN</button>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </>
      )}

      {/* + ADD — search the queue, drop a piece straight into this column.
          Hand-picked doctrine: this sheet is the ONLY way pieces reach the
          floor from the phone; ready pieces first with the condition chips. */}
      {addOpen && bucket && (
        <>
          <div className="fl-sheet-scrim" onClick={() => setAddOpen(false)} />
          <div className="fl-sheet">
            <div className="fl-sheet-grab" />
            <div className="fl-sheet-title">Add to {phaseLabel(bucket)} · {TRACK_CHIP[track]} only</div>
            {bucket === phases[0] && readyQueue.length > 0 && (
              <div className="fl-label" style={{ color: '#1d7a55' }}>
                {readyQueue.length} piece{readyQueue.length === 1 ? ' meets' : 's meet'} the bring-up conditions — listed first
              </div>
            )}
            <input className="fl-input" placeholder="Search family, order #, cemetery"
              value={q} onChange={e => setQ(e.target.value)} />
            <div style={{ maxHeight: '48vh', overflowY: 'auto', marginTop: 6 }}>
              {queueGroups.filter(g => matches(g.rep)).slice(0, 40).map(g => {
                const c = g.rep
                const r = c.job_id ? recs.byJob.get(c.job_id) : null
                return (
                  <div key={g.key} className="fl-row" style={{ cursor: 'default' }}>
                    <div className="fl-rowtop">
                      <span className="fl-fam" style={{ fontSize: 14.5 }}
                        role={c.job_id || c.order_id ? 'button' : undefined}
                        onClick={() => openPiece(c)}>
                        {famOf(c)} <AgeDot n={ageDaysOf(c, todayMs)} />
                      </span>
                      <button type="button" className="fl-verb" style={{ borderColor: '#1d7a55', color: '#1d7a55' }}
                        disabled={busyId === c.id} onClick={() => addToBucket(g)}>
                        {busyId === c.id ? '…' : 'ADD'}
                      </button>
                    </div>
                    <div className="fl-spec">{groupMeta(g)}</div>
                    {r && (
                      <div className="fl-chips" style={{ marginTop: 6 }}>
                        <span className={`fl-chip ${r.designOk ? 'fl-c-good' : 'fl-c-warn'}`}>{r.designOk ? 'DESIGN APPROVED' : 'DESIGN NOT APPROVED'}</span>
                        {r.hasStoneKey && <span className={`fl-chip ${r.stoneOk ? 'fl-c-good' : 'fl-c-warn'}`}>{r.stoneOk ? 'STONE HERE' : 'STONE NOT HERE'}</span>}
                        <span className={`fl-chip ${r.contracted ? 'fl-c-good' : 'fl-c-bad'}`}>{r.contracted ? 'CONTRACTED' : 'NOT CONTRACTED'}</span>
                      </div>
                    )}
                  </div>
                )
              })}
              {queueGroups.filter(g => matches(g.rep)).length === 0 && (
                <div className="fl-empty">Nothing in the queue matches.</div>
              )}
              {/* Already on the floor — add here TOO (parallel steps, the Boyd
                  case). Keeps its main column; gets its own card here. */}
              {(() => {
                const onBoard = floor.filter(c => !inCol(c, bucket) && matches(c))
                if (!onBoard.length) return null
                return (
                  <>
                    <div className="fl-label" style={{ marginTop: 12 }}>Already on the floor — add here too</div>
                    {onBoard.slice(0, 25).map(c => (
                      <div key={`ob-${c.id}`} className="fl-row" style={{ cursor: 'default' }}>
                        <div className="fl-rowtop">
                          <span className="fl-fam" style={{ fontSize: 14.5 }}>{famOf(c)}</span>
                          <button type="button" className="fl-verb" disabled={busyId === c.id}
                            onClick={() => run(c.id,
                              () => addComponentExtraPhase(c.id, bucket, { actor, source: 'field' }),
                              `${famOf(c)} also at ${phaseLabel(bucket)}`,
                              () => removeComponentExtraPhase(c.id, bucket, { actor, source: 'field' }))}>
                            {busyId === c.id ? '…' : 'ADD HERE TOO'}
                          </button>
                        </div>
                        <div className="fl-spec">{metaOf(c)} · main: {phaseLabel(c.current_phase)}</div>
                      </div>
                    ))}
                  </>
                )
              })()}
            </div>
            <button type="button" className="fl-btn-ghost" style={{ marginTop: 12 }} onClick={() => setAddOpen(false)}>Done</button>
          </div>
        </>
      )}

      {/* CONFIRM SIZE — measure the stone that's actually on the line; the
          stencil cutter cuts to THIS (actual runs off an inch from spec).
          Shows up on the desktop Cut list next to STONE IS UP. */}
      {/* LINES on the phone — the add sheet for one line. */}
      {lineAddFor && (() => {
        const line = lines.find(l => l.id === lineAddFor)
        if (!line) return null
        const shown = linePool.filter(g => lineMatches(g.rep)).slice(0, 40)
        return (
          <>
            <div className="fl-sheet-scrim" onClick={() => setLineAddFor(null)} />
            <div className="fl-sheet">
              <div className="fl-sheet-grab" />
              <div className="fl-sheet-title">Add to {lineLabel(line)}</div>
              <div className="fl-label" style={{ color: '#1d7a55' }}>{linePool.length} ready — design approved · stone here · contracted · on no line yet</div>
              <input className="fl-input" placeholder="Search family, order #, cemetery" value={lq} onChange={e => setLq(e.target.value)} />
              <div style={{ maxHeight: '48vh', overflowY: 'auto', marginTop: 6 }}>
                {shown.map(g => {
                  const c = g.rep
                  const dies = g.pieces.filter(pc => pc.component_type !== 'base').length
                  return (
                    <div key={g.key} className="fl-row" style={{ cursor: 'default' }}>
                      <div className="fl-rowtop">
                        <span className="fl-fam" style={{ fontSize: 14.5 }} role={c.job_id || c.order_id ? 'button' : undefined} onClick={() => openPiece(c)}>
                          {famOf(c)} <AgeDot n={ageDaysOf(c, todayMs)} />
                        </span>
                        <button type="button" className="fl-verb" style={{ borderColor: '#1d7a55', color: '#1d7a55' }}
                          disabled={busyId === c.id} onClick={() => addToLine(line, g)}>
                          {busyId === c.id ? '…' : `→ L${line.number}`}
                        </button>
                      </div>
                      <div className="fl-spec">{[dies > 1 ? `${dies} dies` : null, groupMeta(g)].filter(Boolean).join(' · ')}</div>
                    </div>
                  )
                })}
                {shown.length === 0 && <div className="fl-empty">{lq ? 'Nothing ready matches.' : 'Nothing ready and unassigned — every ready stone is on a line.'}</div>}
              </div>
            </div>
          </>
        )
      })()}
      {sizeFor && (
        <>
          <div className="fl-sheet-scrim" onClick={() => setSizeFor(null)} />
          <div className="fl-sheet">
            <div className="fl-sheet-grab" />
            <div className="fl-sheet-title">Confirm size for the cutter</div>
            <div className="fl-spec" style={{ marginTop: -6 }}>{famOf(sizeFor)} · {metaOf(sizeFor)}</div>
            <div className="fl-label">
              Measure the stone on the line — the stencil gets cut to this, not the spec.
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <div style={{ flex: 1 }}>
                <div className="fl-label" style={{ margin: '0 0 5px' }}>Length (in)</div>
                <input className="fl-input" type="text" inputMode="decimal" autoFocus
                  placeholder="e.g. 36" value={sizeL} onChange={e => setSizeL(e.target.value)} />
              </div>
              <div style={{ flex: 1 }}>
                <div className="fl-label" style={{ margin: '0 0 5px' }}>Width (in)</div>
                <input className="fl-input" type="text" inputMode="decimal"
                  placeholder="e.g. 8" value={sizeW} onChange={e => setSizeW(e.target.value)} />
              </div>
            </div>
            <button type="button" className="fl-btn" onClick={saveSize}>SAVE CONFIRMED SIZE</button>
            {sizeFor.confirmed_size && (
              <button type="button" className="fl-btn fl-btn-ghost" style={{ color: '#B3261E' }} onClick={clearSize}>
                Clear confirmed size
              </button>
            )}
            <button type="button" className="fl-btn-ghost" style={{ marginTop: 8 }} onClick={() => setSizeFor(null)}>Cancel</button>
          </div>
        </>
      )}
    </div>
  )
}
