// =============================================================================
// DoorOrderLines — a cemetery order's doors as one line, on the phone
// =============================================================================
// Paul 2026-11-19: "when an order comes in ... those doors go into a mausoleum
// doors production line ... I want to update the production of the doors in
// Stonebooks Field." One row per submitted cemetery order: N of M doors
// complete, the count at each step; open it to move one door or every door at
// the furthest-behind step together. Same writes as the desktop door line.
// `comps` = getProductionComponents() rows (the caller already has them).
// =============================================================================
import { useState } from 'react'
import { advanceComponent, reverseComponent, qcApproveComponent } from '../lib/stonebooksData'
import { trackPhases, phaseLabel, phaseIndex, nextPhase, prevPhase, QC_PHASE, DOOR_DONE_PHASE, doorNameOf, doorLinesFrom } from '../lib/jobComponents'

export default function DoorOrderLines({ comps, who, undo, onChanged }) {
  const [openId, setOpenId] = useState(null)
  const [busy, setBusy] = useState(false)
  const [showDone, setShowDone] = useState(false)
  const actor = who?.name || null
  const lines = doorLinesFrom(comps)
  const live = lines.filter(g => g.complete < g.total)
  const finished = lines.filter(g => g.total > 0 && g.complete >= g.total)
  const phases = trackPhases('door')

  const forward = (d) => (d.current_phase === QC_PHASE
    ? qcApproveComponent(d.id, { actor, source: 'field' })
    : advanceComponent(d.id, { actor, source: 'field' }))
  const run = async (list, fn, label, undoFn) => {
    if (busy) return
    setBusy(true)
    let failed = null
    for (const d of list) {
      const r = await fn(d).catch(e => ({ ok: false, error: e?.message }))
      if (r && r.ok === false) { failed = `${doorNameOf(d)}: ${r.error || 'that move failed'}`; break }
    }
    setBusy(false)
    await onChanged?.()
    if (failed) { undo?.showError(failed); return }
    if (label && undoFn) undo?.show(label, async () => { for (const d of list) await undoFn(d).catch(() => {}); await onChanged?.() })
  }

  const renderLine = (g) => {
    const open = openId === g.co.id
    const idx = (d) => phaseIndex('door', d.current_phase)
    const minIdx = Math.min(...g.doors.map(idx))
    const behind = g.doors.filter(d => idx(d) === minIdx)
    const nextP = phases[minIdx + 1] || null
    const allDone = g.complete >= g.total
    const steps = phases.filter(p => p !== DOOR_DONE_PHASE && g.doors.some(d => d.current_phase === p))
      .map(p => `${g.doors.filter(d => d.current_phase === p).length} ${phaseLabel(p).toLowerCase()}`).join(' · ')
    return (
      <div key={g.co.id} className="fl-row" style={{ cursor: 'pointer', borderColor: allDone ? '#14775A' : '#2f5586' }}
        onClick={() => setOpenId(open ? null : g.co.id)}>
        <div className="fl-rowtop">
          <span className="fl-fam" style={{ minWidth: 0, overflowWrap: 'anywhere' }}>{String(g.co?.cemetery_name || 'Cemetery').toUpperCase()}</span>
          <span className={`fl-chip ${allDone ? 'fl-c-good' : 'fl-c-info'}`} style={{ flexShrink: 0 }}>{g.complete} OF {g.total} COMPLETE</span>
        </div>
        <div className="fl-spec" style={{ fontFamily: 'inherit', overflowWrap: 'anywhere' }}>
          {[g.co?.order_number, allDone ? 'every door complete' : steps].filter(Boolean).join(' · ')}
        </div>
        {open && (
          <div style={{ marginTop: 10 }} onClick={e => e.stopPropagation()}>
            {nextP && (
              <button type="button" className="fl-btn-gold" style={{ minHeight: 46, marginBottom: 8 }}
                disabled={busy || behind.some(d => d.qc_issue)}
                onClick={() => run(behind, forward, `${behind.length} door${behind.length === 1 ? '' : 's'} → ${phaseLabel(nextP)}`, d => reverseComponent(d.id, { actor, source: 'field' }))}>
                {busy ? 'Moving…' : `${behind.length === g.total && g.total > 1 ? `ALL ${g.total}` : behind.length} ${behind.length === 1 ? 'DOOR' : 'DOORS'} → ${phaseLabel(nextP).toUpperCase()}`}
              </button>
            )}
            {g.doors.map((d, i) => {
              const nx = nextPhase('door', d.current_phase)
              const pv = prevPhase('door', d.current_phase)
              const done = d.current_phase === DOOR_DONE_PHASE
              return (
                <div key={d.id} className="fl-rowline" style={{ minHeight: 48, gap: 8, alignItems: 'center' }}>
                  <span style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                    <span style={{ display: 'block', fontSize: 14, fontWeight: 800, color: '#16150F', overflowWrap: 'anywhere' }}>{i + 1}. {doorNameOf(d)}</span>
                    <span style={{ display: 'block', fontSize: 12, fontWeight: 700, color: done ? '#14775A' : d.qc_issue ? '#B3261E' : '#8A7F6C', overflowWrap: 'anywhere' }}>
                      {phaseLabel(d.current_phase)}{d.qc_issue ? ` · HELD: ${d.qc_issue}` : ''}
                    </span>
                  </span>
                  {pv && <button type="button" className="fl-verb" disabled={busy} title={`Back to ${phaseLabel(pv)}`}
                    onClick={() => run([d], x => reverseComponent(x.id, { actor, source: 'field' }), null, null)}>BACK</button>}
                  {nx && <button type="button" className="fl-verb" style={{ borderColor: '#9A7209', color: '#9A7209' }} disabled={busy || !!d.qc_issue}
                    onClick={() => run([d], forward, `${doorNameOf(d)} → ${phaseLabel(nx)}`, x => reverseComponent(x.id, { actor, source: 'field' }))}>
                    {phaseLabel(nx).toUpperCase()}</button>}
                </div>
              )
            })}
          </div>
        )}
      </div>
    )
  }

  if (!lines.length) return <div className="fl-empty">No cemetery order is in production. Submit one on the desktop and its doors show here.</div>
  return (
    <div style={{ margin: '0 2px 14px' }}>
      <div className="fl-label">Door orders</div>
      {live.map(renderLine)}
      {!live.length && <div className="fl-empty">Every door order is complete.</div>}
      {finished.length > 0 && (
        <button type="button" className="fl-rowline" style={{ minHeight: 44, color: '#8A7F6C', fontWeight: 700 }} onClick={() => setShowDone(v => !v)}>
          {showDone ? 'Hide' : 'Show'} completed door orders ({finished.length})
        </button>
      )}
      {showDone && finished.map(renderLine)}
    </div>
  )
}
