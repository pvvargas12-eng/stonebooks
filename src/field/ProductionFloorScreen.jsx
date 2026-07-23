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
} from '../lib/stonebooksData'
import { trackPhases, phaseLabel, phaseIndex, nextPhase, prevPhase, QC_PHASE, TRACKS_WITH_QC } from '../lib/jobComponents'

const TRACK_ORDER = ['new_stone', 'inscription', 'bronze', 'door']
const TRACK_CHIP = { new_stone: 'NEW STONE', inscription: 'INSCRIPTION', bronze: 'BRONZE', door: 'DOORS' }
const TYPE_LABEL = { die: 'Die', base: 'Base', inscription: 'Inscription', door: 'Door', bronze: 'Bronze' }

// Field grammar: families read ALL-CAPS. Same fallback chain as the desktop board.
const famOf = (c) => String(
  c.order?.primary_lastname || c.order?.customer?.last_name || c.vendor_request?.family_name
  || c.cemetery_order?.cemetery_name || c.order?.cemetery?.name || '—',
).toUpperCase()
const metaOf = (c) => [
  TYPE_LABEL[c.component_type] || c.label, c.size, c.color,
  c.order?.order_number || c.cemetery_order?.order_number,
  c.order?.cemetery?.name || c.cemetery_order?.cemetery_name,
].filter(Boolean).join(' · ')

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

  const load = useCallback(async () => {
    try {
      const [d, rec] = await Promise.all([
        getProductionComponents(),
        getBringUpReady().catch(() => ({ count: 0, readyByTrack: {}, byJob: new Map() })),
      ])
      setComps(d || []); setRecs(rec); setErr(null)
    } catch (e) { setErr(e?.message || 'Could not load the floor.') }
  }, [])
  useEffect(() => { load() }, [load])  // eslint-disable-line react-hooks/set-state-in-effect

  const loading = comps == null
  const inTrack = (comps || []).filter(c => c.track === track)
  const floor = inTrack.filter(c => c.on_floor)
  const queue = inTrack.filter(c => !c.on_floor)
  const phases = trackPhases(track)
  const readyOf = (c) => !!(c.job_id && recs.byJob.get(c.job_id)?.ready)
  const readyQueue = queue.filter(readyOf)
  const queueSorted = [...queue].sort((a, b) => (readyOf(b) ? 1 : 0) - (readyOf(a) ? 1 : 0))
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

  const advance = (c) => {
    const next = nextPhase(c.track, c.current_phase)
    run(c.id,
      () => advanceComponent(c.id, { actor, source: 'field' }),
      `${famOf(c)} → ${next ? phaseLabel(next) : 'done'}`,
      () => reverseComponent(c.id, { actor, source: 'field' }))
  }
  const back = (c) => {
    const prev = prevPhase(c.track, c.current_phase)
    run(c.id,
      () => reverseComponent(c.id, { actor, source: 'field' }),
      `${famOf(c)} ← ${prev ? phaseLabel(prev) : ''}`,
      () => advanceComponent(c.id, { actor, source: 'field' }))
  }
  const addToBucket = (c) => {
    const prevPhaseCode = c.current_phase
    run(c.id,
      () => setComponentOnFloor(c.id, true, { actor, phase: bucket }),
      `${famOf(c)} added to ${phaseLabel(bucket)}`,
      async () => {
        await setComponentOnFloor(c.id, false, { actor })
        if (prevPhaseCode && prevPhaseCode !== bucket) await overrideComponentPhase(c.id, prevPhaseCode, { actor, source: 'field' })
      })
  }
  const qcApprove = (c) => run(c.id, () => qcApproveComponent(c.id, { actor, source: 'field' }))
  const qcDeny = (c) => {
    if (!denyText.trim()) { undo.showError('Type the QC issue first.'); return }
    run(c.id, () => qcDenyComponent(c.id, denyText.trim(), { actor, source: 'field' }))
    setDenyFor(null); setDenyText('')
  }
  const qcClear = (c) => run(c.id, () => clearComponentQcIssue(c.id, { actor, source: 'field' }))

  const openPiece = (c) => {
    if (c.job_id || c.order_id) onOpenJob?.({ jobId: c.job_id || null, orderId: c.order_id || null })
  }

  if (err) return <div className="fl-empty">{err}</div>

  const bucketCards = bucket ? floor.filter(c => c.current_phase === bucket) : []
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
          {!loading && (
            <div className="fl-tilegrid">
              {phases.map((p, i) => {
                const n = floor.filter(c => c.current_phase === p).length
                const showNeed = i === 0 && readyQueue.length > 0
                return (
                  <button key={p} type="button" className="fl-tile"
                    onClick={() => { setBucket(p); setAddOpen(false); setQ('') }}>
                    <div className="fl-tile-main">
                      <div className="fl-tile-name">{phaseLabel(p)}</div>
                      <div className="fl-tile-sub" style={showNeed ? { color: '#B3261E', fontWeight: 800 } : undefined}>
                        {showNeed ? `${readyQueue.length} ready to add` : (i === 0 ? `${queue.length} in the queue` : 'Tap to work this list')}
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
            <span className="fl-sect-pill">{bucketCards.length}</span>
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

          {bucketCards.length === 0 && <div className="fl-empty-serif">Nothing here yet — + ADD pulls from the queue.</div>}
          {bucketCards.map(c => {
            const atQc = hasQc && c.current_phase === QC_PHASE
            const held = !!c.qc_issue
            const first = phaseIndex(c.track, c.current_phase) === 0
            const busy = busyId === c.id
            return (
              <div key={c.id} className="fl-row" style={{ cursor: 'default' }}>
                <div className="fl-rowtop">
                  <span className="fl-fam">{famOf(c)}</span>
                  {held ? <span className="fl-chip fl-c-bad">HELD</span>
                    : c.blocker ? <span className="fl-chip fl-c-warn">BLOCKED</span> : null}
                </div>
                <div className="fl-spec">{metaOf(c)}</div>
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
                      <button type="button" className="fl-verb" style={{ borderColor: '#1d7a55', color: '#1d7a55' }}
                        disabled={busy} onClick={() => advance(c)}>{busy ? '…' : 'ADVANCE →'}</button>
                    )}
                    <button type="button" className="fl-verb" disabled={busy || first} onClick={() => back(c)}>← BACK</button>
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
            <div className="fl-sheet-title">Add to {phaseLabel(bucket)}</div>
            {bucket === phases[0] && readyQueue.length > 0 && (
              <div className="fl-label" style={{ color: '#1d7a55' }}>
                {readyQueue.length} piece{readyQueue.length === 1 ? ' meets' : 's meet'} the bring-up conditions — listed first
              </div>
            )}
            <input className="fl-input" placeholder="Search family, order #, cemetery"
              value={q} onChange={e => setQ(e.target.value)} />
            <div style={{ maxHeight: '48vh', overflowY: 'auto', marginTop: 6 }}>
              {queueSorted.filter(matches).slice(0, 40).map(c => {
                const r = c.job_id ? recs.byJob.get(c.job_id) : null
                return (
                  <div key={c.id} className="fl-row" style={{ cursor: 'default' }}>
                    <div className="fl-rowtop">
                      <span className="fl-fam" style={{ fontSize: 14.5 }}>{famOf(c)}</span>
                      <button type="button" className="fl-verb" style={{ borderColor: '#1d7a55', color: '#1d7a55' }}
                        disabled={busyId === c.id} onClick={() => addToBucket(c)}>
                        {busyId === c.id ? '…' : 'ADD'}
                      </button>
                    </div>
                    <div className="fl-spec">{metaOf(c)}</div>
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
              {queueSorted.filter(matches).length === 0 && (
                <div className="fl-empty">Nothing in the queue matches — everything else is already on the floor.</div>
              )}
            </div>
            <button type="button" className="fl-btn-ghost" style={{ marginTop: 12 }} onClick={() => setAddOpen(false)}>Done</button>
          </div>
        </>
      )}
    </div>
  )
}
