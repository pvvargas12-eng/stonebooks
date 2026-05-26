// =============================================================================
// 📚 Stonebooks — Owner Attention List View
// =============================================================================
// Inline list view shown when the operator clicks one of the Owner Overview
// summary cards ("Tasks needing attention" / "Tasks overdue"). Replaces the
// Overview grid while active — same role, same workspaceState, just a
// different body slot.
//
// Each row uses JobsQueueRow with its `row.department` field set so the
// row renders a small department chip alongside the surname. That answers
// "which department's work is on fire?" without leaving the Owner role.
// =============================================================================

import JobsQueueRow from './JobsQueueRow'

export default function OwnerAttentionListView({
  mode,        // 'amber' | 'red'
  rows,
  bulkOrders,
  onBack,
  onOpenRow,
}) {
  const isRed = mode === 'red'
  const heading = isRed ? 'Tasks overdue' : 'Tasks needing attention'
  const subline = isRed
    ? 'Sorted by days overdue — worst first.'
    : 'Sorted by aging — worst first.'

  return (
    <div className="sb-attention-view">
      <button
        type="button"
        className="sb-attention-back"
        onClick={onBack}
      >
        ← Back to overview
      </button>

      <header className="sb-attention-head">
        <h2 className="sb-attention-heading">{heading}</h2>
        <div className="sb-attention-meta">
          <span className="sb-attention-count">
            {rows.length} {rows.length === 1 ? 'task' : 'tasks'}
          </span>
          <span className="sb-attention-sort">{subline}</span>
        </div>
      </header>

      <div className="sb-attention-panel">
        {rows.length === 0 ? (
          // Defensive empty state — in normal flow the summary card would
          // be hidden and the view never opened, but a stale click after a
          // background reload could land here.
          <div className="sb-queue-empty">
            {isRed
              ? 'Nothing overdue right now. Good.'
              : 'Nothing in the amber band right now.'}
          </div>
        ) : (
          <div className="sb-queue-section-rows">
            {rows.map(row => (
              <JobsQueueRow
                key={row.job.id + ':' + (row.milestone?.id || '')}
                row={row}
                bulkOrders={bulkOrders}
                onClick={onOpenRow}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// =============================================================================
// STYLES
// =============================================================================

const localStyles = `
  .sb-attention-view {
    width: 100%;
  }
  .sb-attention-back {
    background: transparent;
    border: none;
    color: var(--sb-text-muted);
    font: inherit;
    font-size: 13px;
    padding: 4px 8px 4px 0;
    cursor: pointer;
    margin-bottom: 16px;
  }
  .sb-attention-back:hover {
    color: var(--sb-text);
  }
  .sb-attention-back:focus-visible {
    outline: 0.5px solid var(--sb-accent);
    outline-offset: 1px;
  }

  .sb-attention-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 16px;
    margin-bottom: 20px;
    padding-bottom: 12px;
    border-bottom: 0.5px solid var(--sb-border);
    flex-wrap: wrap;
  }
  .sb-attention-heading {
    font-size: 22px;
    font-weight: 500;
    color: var(--sb-text);
    margin: 0;
    letter-spacing: -0.01em;
  }
  .sb-attention-meta {
    display: inline-flex;
    align-items: baseline;
    gap: 12px;
    color: var(--sb-text-muted);
    font-size: 13px;
  }
  .sb-attention-count {
    font-variant-numeric: tabular-nums;
  }
  .sb-attention-sort {
    font-size: 12px;
  }

  /* Reuse the standard queue panel chrome so the attention list looks like
     a single big bucket queue. The internal rows are JobsQueueRow with the
     row.department chip rendering by virtue of the data layer setting that
     field on every collected row. */
  .sb-attention-panel {
    background: var(--sb-surface);
    border: 0.5px solid var(--sb-border);
    border-radius: var(--sb-r-sm, 6px);
    overflow: hidden;
  }
`

if (typeof document !== 'undefined' && !document.getElementById('sb-attention-view-styles')) {
  const tag = document.createElement('style')
  tag.id = 'sb-attention-view-styles'
  tag.textContent = localStyles
  document.head.appendChild(tag)
}
