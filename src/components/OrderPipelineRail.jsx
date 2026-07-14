// =============================================================================
// OrderPipelineRail — right-hand lifecycle rail on the Order Detail page.
// =============================================================================
// Strictly additive. Shows overall progress, then a section per phase (Sales,
// Admin, Design, Production, Installation) with milestone rows derived from
// buildPipeline(order, job). Milestone taps go through onUpdateMilestone (the
// real updateMilestone path in OrderDetail, which also logs to order_activity).
// Custom tasks are order_activity rows (type 'task', phase stored in `field`).
// =============================================================================

import { useState } from 'react'
import { buildPipeline, PIPELINE_PHASES } from '../lib/orderPipeline'

const STATUS_TONE = {
  done:        { fg: '#2d7a4f', bg: '#e8f5ea', label: 'Done' },
  in_progress: { fg: '#1d4ed8', bg: '#e7edfd', label: 'In progress' },
  not_started: { fg: '#8a8a85', bg: '#f1efe9', label: 'Not started' },
  blocked:     { fg: '#b54040', bg: '#fbeaea', label: 'Blocked' },
}
const tone = (s) => STATUS_TONE[s] || STATUS_TONE.not_started

export default function OrderPipelineRail({ order, job, tasks = [], onUpdateMilestone, onOpenPhase, onAddTask, onRemoveTask, onSetTaskStatus }) {
  const pipe = buildPipeline(order, job)
  // Customer/staff requested layout changes — read the live signal directly off
  // the job milestones so the Design-phase flag is independent of where the
  // proof_changes_requested row's team/group happens to place its row.
  const changeRequested = (job?.milestones || []).some(
    m => m.milestone_key === 'proof_changes_requested' && m.status === 'in_progress'
  )
  const [openKey, setOpenKey] = useState(null)
  const [busyKey, setBusyKey] = useState(null)
  const [addPhase, setAddPhase] = useState('production')
  const [addText, setAddText] = useState('')
  const [adding, setAdding] = useState(false)
  // Multi-select mode (Paul, 2026-07-08) — check several milestones, mark them
  // done in one shot instead of tapping each one open.
  const [selectMode, setSelectMode] = useState(false)
  const [selected, setSelected] = useState(() => new Set())
  const [bulkBusy, setBulkBusy] = useState(false)

  const tasksByPhase = (code) => tasks.filter(t => (t.field || 'production') === code)

  const setStatus = async (key, status) => {
    if (!onUpdateMilestone) return
    setBusyKey(key)
    await onUpdateMilestone(key, status)
    setBusyKey(null); setOpenKey(null)
  }

  const toggleSelected = (key) => setSelected(prev => {
    const n = new Set(prev); if (n.has(key)) n.delete(key); else n.add(key); return n
  })
  const exitSelect = () => { setSelectMode(false); setSelected(new Set()) }
  const bulkComplete = async () => {
    if (!onUpdateMilestone || selected.size === 0 || bulkBusy) return
    setBulkBusy(true)
    for (const key of selected) await onUpdateMilestone(key, 'done')
    setBulkBusy(false)
    exitSelect()
  }

  const submitTask = async () => {
    const text = addText.trim()
    if (!text || adding || !onAddTask) return
    setAdding(true)
    await onAddTask(addPhase, text)
    setAdding(false); setAddText('')
  }

  return (
    <aside className="sb-opr" aria-label="Order pipeline">
      <style>{CSS}</style>

      <div className="sb-opr-head">
        <span className="sb-opr-title">Pipeline</span>
        <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 10 }}>
          {onUpdateMilestone && pipe.hasJob && (
            <button type="button" className={`sb-opr-selbtn${selectMode ? ' on' : ''}`}
              onClick={() => selectMode ? exitSelect() : setSelectMode(true)}
              title="Check several items, then mark them done at once">
              {selectMode ? 'Cancel' : '☑ Select'}
            </button>
          )}
          <span className="sb-opr-pct">{pipe.overallPct}%</span>
        </span>
      </div>
      {selectMode && (
        <div className="sb-opr-bulkbar">
          <span>{selected.size} selected</span>
          <button type="button" className="sb-opr-bulkgo" disabled={selected.size === 0 || bulkBusy} onClick={bulkComplete}>
            {bulkBusy ? 'Marking…' : `✓ Mark ${selected.size || ''} done`}
          </button>
        </div>
      )}
      <div className="sb-opr-bar"><div className="sb-opr-bar-fill" style={{ width: `${pipe.overallPct}%` }} /></div>
      {!pipe.hasJob && (
        <div className="sb-opr-preview-note">Preview — milestones activate when the order is signed and a job is created.</div>
      )}

      {pipe.phases.map(phase => (
        <section key={phase.code} className="sb-opr-phase">
          <div className="sb-opr-phase-head">
            <button type="button" className="sb-opr-phase-name" onClick={() => onOpenPhase?.(phase.code)} title="Open this phase for this order">
              {phase.label}
            </button>
            <span className="sb-opr-phase-count">{phase.done}/{phase.total}</span>
          </div>
          <div className="sb-opr-pbar"><div className="sb-opr-pbar-fill" style={{ width: `${phase.pct}%` }} /></div>

          {phase.code === 'design' && changeRequested && (
            <div className="sb-opr-change-flag">⚠ Customer requested changes</div>
          )}

          {phase.items.length === 0 && tasksByPhase(phase.code).length === 0 && (
            <div className="sb-opr-empty">—</div>
          )}

          {phase.items.map(it => {
            const t = tone(it.status)
            const isOpen = openKey === `${phase.code}:${it.key}`
            const tappable = !it.readOnly && !!onUpdateMilestone
            // Select mode: tap toggles the checkbox (done items can't be re-selected).
            const selectable = selectMode && tappable && it.status !== 'done'
            const isSel = selected.has(it.key)
            return (
              <div key={it.key} className={`sb-opr-row${it.readOnly ? ' sb-opr-row-ro' : ''}`}>
                <button
                  type="button"
                  className={`sb-opr-row-main${isSel ? ' sb-opr-row-sel' : ''}`}
                  disabled={selectMode ? !selectable : (!tappable || busyKey === it.key)}
                  onClick={() => selectMode
                    ? (selectable && toggleSelected(it.key))
                    : (tappable && setOpenKey(isOpen ? null : `${phase.code}:${it.key}`))}
                  title={selectMode ? (selectable ? 'Select' : t.label) : (tappable ? 'Set status' : t.label)}
                >
                  {selectMode
                    ? <span className={`sb-opr-check${isSel ? ' on' : ''}`}>{isSel ? '✓' : ''}</span>
                    : <span className="sb-opr-dot" style={{ background: t.fg }}>{it.status === 'done' ? '✓' : ''}</span>}
                  <span className="sb-opr-label">{it.label}</span>
                  {it.derived && <span className="sb-opr-from" title="Added from this order's contents">from order</span>}
                </button>
                {isOpen && tappable && !selectMode && (
                  <div className="sb-opr-actions">
                    <button type="button" className="sb-opr-act sb-opr-act-done" onClick={() => setStatus(it.key, 'done')}>Done</button>
                    <button type="button" className="sb-opr-act sb-opr-act-prog" onClick={() => setStatus(it.key, 'in_progress')}>In progress</button>
                    <button type="button" className="sb-opr-act sb-opr-act-clear" onClick={() => setStatus(it.key, 'not_started')}>Clear</button>
                    {/* Remove = marks the milestone not_needed, so it drops off
                        this rail AND every work queue / Jobs-tab surface (they
                        all read the same milestone). Reversible from JobDetail. */}
                    <button type="button" className="sb-opr-act sb-opr-act-remove"
                      title="Remove this line — marks it not needed on the job (undo from the job's milestone list)"
                      onClick={() => setStatus(it.key, 'not_needed')}>Remove</button>
                  </div>
                )}
              </div>
            )
          })}

          {tasksByPhase(phase.code).map(tk => {
            const tkOpen = openKey === `task:${tk.id}`
            const tkTone = tk.task_status === 'done' ? '#2d7a4f' : tk.task_status === 'in_progress' ? '#1d4ed8' : '#9a7209'
            return (
              <div key={tk.id} className="sb-opr-row sb-opr-taskwrap">
                <div className="sb-opr-task">
                  <button type="button" className="sb-opr-row-main" title="Set task status"
                    onClick={() => setOpenKey(tkOpen ? null : `task:${tk.id}`)}>
                    <span className="sb-opr-dot" style={{ background: tkTone }}>{tk.task_status === 'done' ? '✓' : '•'}</span>
                    <span className="sb-opr-label" style={tk.task_status === 'done' ? { textDecoration: 'line-through', color: '#8a8a85' } : undefined}>
                      {tk.note}{tk.assignee ? ` · ${tk.assignee}` : ''}
                    </span>
                  </button>
                  <button type="button" className="sb-opr-task-x" title="Remove task" onClick={() => onRemoveTask?.(tk)}>×</button>
                </div>
                {tkOpen && onSetTaskStatus && (
                  <div className="sb-opr-actions">
                    <button type="button" className="sb-opr-act sb-opr-act-done" onClick={async () => { await onSetTaskStatus(tk, 'done'); setOpenKey(null) }}>Done</button>
                    <button type="button" className="sb-opr-act sb-opr-act-prog" onClick={async () => { await onSetTaskStatus(tk, 'in_progress'); setOpenKey(null) }}>In progress</button>
                    <button type="button" className="sb-opr-act sb-opr-act-clear" onClick={async () => { await onSetTaskStatus(tk, 'open'); setOpenKey(null) }}>Reopen</button>
                  </div>
                )}
              </div>
            )
          })}
        </section>
      ))}

      <div className="sb-opr-add">
        <select className="sb-opr-add-phase" value={addPhase} onChange={e => setAddPhase(e.target.value)}>
          {PIPELINE_PHASES.map(p => <option key={p.code} value={p.code}>{p.label}</option>)}
        </select>
        <input
          className="sb-opr-add-text" type="text" value={addText} placeholder="Add a task…"
          onChange={e => setAddText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') submitTask() }}
        />
        <button type="button" className="sb-opr-add-btn" disabled={!addText.trim() || adding} onClick={submitTask}>{adding ? '…' : 'Add'}</button>
      </div>
    </aside>
  )
}

const CSS = `
.sb-opr { font-size: 13px; color: #1a1a1a; }
.sb-opr-head { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 6px; }
.sb-opr-title { font-weight: 700; font-size: 14px; }
.sb-opr-pct { font-weight: 700; color: #2d7a4f; }
.sb-opr-bar { height: 7px; background: #ece6d8; border-radius: 4px; overflow: hidden; margin-bottom: 10px; }
.sb-opr-bar-fill { height: 100%; background: #2d7a4f; transition: width 0.3s; }
.sb-opr-preview-note { font-size: 11px; color: #8a8472; font-style: italic; background: #faf8f3; border: 1px solid #eee7d8; border-radius: 6px; padding: 6px 8px; margin-bottom: 10px; }
.sb-opr-phase { margin-bottom: 12px; }
.sb-opr-phase-head { display: flex; align-items: center; justify-content: space-between; }
.sb-opr-phase-name { border: none; background: none; padding: 0; font: inherit; font-weight: 700; color: #9a7209; cursor: pointer; }
.sb-opr-phase-name:hover { text-decoration: underline; }
.sb-opr-phase-count { font-size: 11px; color: #8a8a85; }
.sb-opr-pbar { height: 4px; background: #ece6d8; border-radius: 3px; overflow: hidden; margin: 4px 0 6px; }
.sb-opr-pbar-fill { height: 100%; background: #c8a24a; transition: width 0.3s; }
.sb-opr-empty { font-size: 11px; color: #c2bdb2; padding: 2px 0 4px; }
.sb-opr-change-flag { font-size: 11.5px; font-weight: 700; color: #9a3412; background: #fff4ed; border: 1px solid #f0a878; border-radius: 6px; padding: 5px 8px; margin: 2px 0 6px; }
.sb-opr-row { margin: 1px 0; }
.sb-opr-row-main { display: flex; align-items: center; gap: 7px; width: 100%; border: none; background: none; text-align: left; padding: 4px 2px; cursor: pointer; font: inherit; border-radius: 4px; }
.sb-opr-row-main:hover:not(:disabled) { background: #f4f2ee; }
.sb-opr-row-main:disabled { cursor: default; }
.sb-opr-row-ro .sb-opr-label { color: #8a8a85; }
.sb-opr-dot { flex: 0 0 14px; width: 14px; height: 14px; border-radius: 50%; color: #fff; font-size: 10px; line-height: 14px; text-align: center; }
.sb-opr-label { flex: 1 1 auto; word-break: break-word; }
.sb-opr-from { flex: 0 0 auto; font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.03em; color: #7a4a12; background: #fdf2e9; border: 1px solid #e8c98f; border-radius: 3px; padding: 0 4px; }
.sb-opr-actions { display: flex; gap: 5px; padding: 2px 0 4px 21px; }
.sb-opr-act { border: 1px solid #d8d2c4; background: #fff; border-radius: 5px; padding: 3px 8px; font-size: 11px; font-weight: 600; cursor: pointer; }
.sb-opr-act-done { border-color: #2d7a4f; color: #2d7a4f; }
.sb-opr-act-prog { border-color: #1d4ed8; color: #1d4ed8; }
.sb-opr-act-clear { border-color: #b0aba0; color: #8a8a85; }
.sb-opr-act-remove { border-color: #b3261e; color: #b3261e; margin-left: auto; }
.sb-opr-task .sb-opr-dot { font-size: 11px; }
.sb-opr-task { display: flex; align-items: center; gap: 7px; padding: 3px 2px; }
.sb-opr-task-x { border: none; background: none; color: #b3261e; cursor: pointer; font-size: 15px; line-height: 1; }
.sb-opr-add { display: flex; gap: 5px; margin-top: 10px; padding-top: 10px; border-top: 1px solid #eee7d8; }
.sb-opr-add-phase { border: 1px solid #d8d2c4; border-radius: 5px; padding: 4px; font-size: 11px; max-width: 84px; }
.sb-opr-add-text { flex: 1 1 auto; min-width: 0; border: 1px solid #d8d2c4; border-radius: 5px; padding: 4px 7px; font: inherit; font-size: 12px; }
.sb-opr-add-btn { border: 1px solid #9a7209; background: #9a7209; color: #fff; border-radius: 5px; padding: 4px 10px; font-size: 12px; font-weight: 600; cursor: pointer; }
.sb-opr-add-btn:disabled { opacity: 0.5; cursor: default; }
.sb-opr-selbtn { border: 1px solid #d8d2c4; background: #fff; border-radius: 5px; padding: 2px 9px; font-size: 11px; font-weight: 700; color: #6a6a62; cursor: pointer; }
.sb-opr-selbtn.on { border-color: #9a7209; color: #9a7209; background: #fdf8ec; }
.sb-opr-bulkbar { display: flex; align-items: center; justify-content: space-between; gap: 8px; background: #fdf8ec; border: 1px solid #e8d9a8; border-radius: 7px; padding: 6px 9px; margin-bottom: 8px; font-size: 12px; font-weight: 600; color: #6b5d2f; }
.sb-opr-bulkgo { border: none; background: #2d7a4f; color: #fff; border-radius: 6px; padding: 4px 12px; font-size: 12px; font-weight: 700; cursor: pointer; }
.sb-opr-bulkgo:disabled { opacity: 0.45; cursor: default; }
.sb-opr-check { flex: 0 0 15px; width: 15px; height: 15px; border-radius: 4px; border: 1.5px solid #b8b2a4; background: #fff; color: #fff; font-size: 11px; line-height: 13px; text-align: center; }
.sb-opr-check.on { background: #2d7a4f; border-color: #2d7a4f; }
.sb-opr-row-sel { background: #f2f8f3; }
`
