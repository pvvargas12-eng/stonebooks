// =============================================================================
// 📚 Stonebooks — Stop search picker (SCHED-1)
// =============================================================================
// The complete-orders picker Paul asked for (2026-07-20): "must be able to
// choose from orders — should have the complete [list] — but I should also be
// able to select any order and add that to the install list."
//
// Focus the input with no query → the COMPLETE ready-for-this-kind list
// (destination-agnostic, what the scheduler column gates would allow). Type →
// search EVERY open order by last name / customer / order number / cemetery.
// Every result is addable; readiness is a chip, not a wall — READY when the
// job passes the kind's gates, the plain-words gate reason when it doesn't
// (routeStopForKind). Used by BatchBuilder (new lists) and the Day dispatch
// sheet (append to an existing list).
// =============================================================================

import { useMemo, useState } from 'react'
import { customerName, routeStopForKind, batchKindInfo } from '../../lib/stonebooksData'

const _label = (job) =>
  job?.order?.primary_lastname || customerName(job?.order?.customer) || '—'

export default function StopSearchPicker({ allJobs, kind, excludeIds, onAdd }) {
  const [q, setQ] = useState('')
  const [focused, setFocused] = useState(false)

  const kindInfo = batchKindInfo(kind)

  // Route every open job once per (jobs, kind) — the chip + provenance source.
  const routed = useMemo(() => {
    const m = new Map()
    for (const job of (allJobs || [])) {
      if (!job || job.overall_status === 'closed') continue
      m.set(job.id, routeStopForKind(job, kind))
    }
    return m
  }, [allJobs, kind])

  const results = useMemo(() => {
    const openJobs = (allJobs || []).filter(j => j && j.overall_status !== 'closed')
    const norm = q.trim().toLowerCase()
    if (!norm) {
      // The complete ready list for this kind, alphabetical.
      return openJobs
        .filter(j => {
          const r = routed.get(j.id)
          return r?.ready && (r.source_milestone_key || r.completion_milestone_key)
        })
        .sort((a, b) => _label(a).localeCompare(_label(b)))
        .slice(0, 30)
    }
    const scored = []
    for (const j of openJobs) {
      const last = (j.order?.primary_lastname || '').toLowerCase()
      const cust = (customerName(j.order?.customer) || '').toLowerCase()
      const num  = String(j.order?.order_number || '').toLowerCase()
      const cem  = (j.order?.cemetery?.name || j.cemetery?.name || '').toLowerCase()
      let rank = null
      if (last.startsWith(norm) || cust.startsWith(norm)) rank = 0
      else if (last.includes(norm) || cust.includes(norm)) rank = 1
      else if (num.includes(norm)) rank = 2
      else if (cem.includes(norm)) rank = 3
      if (rank === null) continue
      scored.push({ j, rank })
    }
    scored.sort((a, b) => a.rank - b.rank || _label(a.j).localeCompare(_label(b.j)))
    return scored.slice(0, 14).map(s => s.j)
  }, [allJobs, q, routed])

  const open = focused || q.trim().length > 0

  const handleAdd = (job) => {
    if (!job?.id || excludeIds?.has(job.id)) return
    const r = routed.get(job.id) || {}
    onAdd?.({
      job,
      milestone: r.source_milestone_key ? { milestone_key: r.source_milestone_key } : null,
      completion_milestone_key: r.completion_milestone_key || null,
      gate_note: r.ready ? null : (r.note || null),
    })
    setQ('')
  }

  return (
    <div
      className="sb-stoppick"
      onFocus={() => setFocused(true)}
      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setFocused(false) }}
    >
      <input
        type="text"
        className="sb-stoppick-input"
        value={q}
        onChange={e => setQ(e.target.value)}
        placeholder="Add any order — search by last name"
        aria-label="Search orders to add as stops"
      />
      {open && (
        <div className="sb-stoppick-panel">
          <div className="sb-stoppick-panel-head">
            {q.trim()
              ? `${results.length === 14 ? '14+' : results.length} ${results.length === 1 ? 'match' : 'matches'} — any order can be added`
              : `Ready for ${kindInfo.label.toLowerCase()} — ${results.length}${results.length === 30 ? '+' : ''} · or type to search every order`}
          </div>
          {results.length === 0 ? (
            <div className="sb-stoppick-none">
              {q.trim() ? 'No orders match that.' : `Nothing is fully ready for ${kindInfo.label.toLowerCase()} — type a name to add any order anyway.`}
            </div>
          ) : (
            <ul className="sb-stoppick-list">
              {results.map(job => {
                const r = routed.get(job.id) || {}
                const added = excludeIds?.has(job.id)
                const cem = job.order?.cemetery?.name || job.cemetery?.name || null
                const spec = [job.order?.shape, job.order?.granite_color].filter(Boolean).join(' · ')
                const num = job.order?.order_number || null
                return (
                  <li key={job.id} className="sb-stoppick-row">
                    <div className="sb-stoppick-row-body">
                      <div className="sb-stoppick-row-primary">
                        <span className="sb-stoppick-row-name">{_label(job)}</span>
                        {num && <span className="sb-stoppick-row-num">{num}</span>}
                        {r.ready && (r.source_milestone_key || r.completion_milestone_key) && (
                          <span className="sb-stoppick-chip sb-stoppick-chip-ready">Ready</span>
                        )}
                        {!r.ready && r.note && (
                          <span className="sb-stoppick-chip sb-stoppick-chip-gate">{r.note}</span>
                        )}
                      </div>
                      {(cem || spec) && (
                        <div className="sb-stoppick-row-secondary">
                          {[cem, spec].filter(Boolean).join(' · ')}
                        </div>
                      )}
                    </div>
                    <button
                      type="button"
                      className="sb-stoppick-add"
                      onClick={() => handleAdd(job)}
                      disabled={added}
                    >
                      {added ? 'Added' : 'Add'}
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

// =============================================================================
// STYLES
// =============================================================================

const localStyles = `
  .sb-stoppick {
    position: relative;
    margin-top: 6px;
  }
  .sb-stoppick-input {
    font: inherit;
    font-size: 13px;
    padding: 7px 10px;
    border: 0.5px solid var(--sb-border);
    border-radius: var(--sb-r-sm, 6px);
    background: var(--sb-surface);
    color: var(--sb-text);
    width: 100%;
  }
  .sb-stoppick-input:focus {
    outline: none;
    border-color: var(--sb-accent, #b8842a);
    box-shadow: 0 0 0 2px var(--sb-accent-bg, rgba(184, 132, 42, 0.15));
  }
  .sb-stoppick-panel {
    margin-top: 4px;
    border: 0.5px solid var(--sb-border);
    border-radius: var(--sb-r-sm, 6px);
    background: var(--sb-surface);
    box-shadow: 0 8px 24px rgba(15, 20, 25, 0.10);
    overflow: hidden;
  }
  .sb-stoppick-panel-head {
    font-size: 11px;
    color: var(--sb-text-muted);
    padding: 7px 12px;
    border-bottom: 0.5px solid var(--sb-border);
    background: var(--sb-surface-muted);
  }
  .sb-stoppick-none {
    font-size: 12px;
    color: var(--sb-text-muted);
    padding: 12px;
  }
  .sb-stoppick-list {
    list-style: none;
    margin: 0;
    padding: 0;
    max-height: 280px;
    overflow-y: auto;
  }
  .sb-stoppick-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 12px;
    border-bottom: 0.5px solid var(--sb-border);
  }
  .sb-stoppick-row:last-child { border-bottom: none; }
  .sb-stoppick-row-body { flex: 1; min-width: 0; }
  .sb-stoppick-row-primary {
    display: flex;
    align-items: baseline;
    gap: 8px;
    flex-wrap: wrap;
  }
  .sb-stoppick-row-name {
    font-size: 13px;
    font-weight: 500;
    color: var(--sb-text);
  }
  .sb-stoppick-row-num {
    font-size: 11px;
    color: var(--sb-text-muted);
    font-family: var(--sb-font-mono);
  }
  .sb-stoppick-row-secondary {
    font-size: 11px;
    color: var(--sb-text-muted);
    margin-top: 1px;
  }
  .sb-stoppick-chip {
    font-size: 10px;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    padding: 1px 7px;
    border-radius: 999px;
    white-space: nowrap;
  }
  .sb-stoppick-chip-ready {
    color: var(--sb-green, #2d7a4f);
    border: 0.5px solid var(--sb-green, #2d7a4f);
  }
  .sb-stoppick-chip-gate {
    color: var(--sb-amber, #b8842a);
    border: 0.5px solid var(--sb-amber, #b8842a);
  }
  .sb-stoppick-add {
    font: inherit;
    font-size: 12px;
    font-weight: 500;
    padding: 4px 12px;
    border-radius: var(--sb-r-sm, 6px);
    border: 0.5px solid var(--sb-accent, #b8842a);
    color: var(--sb-accent, #b8842a);
    background: transparent;
    cursor: pointer;
    white-space: nowrap;
  }
  .sb-stoppick-add:hover:not(:disabled) {
    background: var(--sb-accent, #b8842a);
    color: white;
  }
  .sb-stoppick-add:disabled {
    color: var(--sb-text-muted);
    border-color: var(--sb-border);
    cursor: default;
  }
`

if (typeof document !== 'undefined' && !document.getElementById('sb-stoppick-styles')) {
  const tag = document.createElement('style')
  tag.id = 'sb-stoppick-styles'
  tag.textContent = localStyles
  document.head.appendChild(tag)
}
