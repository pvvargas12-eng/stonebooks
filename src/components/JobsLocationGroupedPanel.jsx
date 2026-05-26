// =============================================================================
// 📚 Stonebooks — Jobs Location-Grouped Panel
// =============================================================================
// Reusable grouping pattern: a queue panel whose rows are grouped by location
// (cemetery, today; install routes / delivery routes later). Each group gets
// a small header ("Hillside Cemetery · 3 stones") and the rows underneath
// render with plot location instead of the standard column set — the
// production guy plans his day as trips to cemeteries, not as individual rows.
//
// Used by the Rubs queue today. Same shape will support Doors-to-pick-up,
// Doors-to-drop-off, and Installs-by-route in future passes.
// =============================================================================

import JobsQueueRow from './JobsQueueRow'

export default function JobsLocationGroupedPanel({ groups, onOpenRow, emptyMessage }) {
  if (!groups || groups.length === 0) {
    return (
      <div className="sb-queue-empty">
        {emptyMessage || 'Nothing in this queue.'}
      </div>
    )
  }

  return (
    <div className="sb-location-grouped-panel">
      {groups.map((g, idx) => {
        const name = g.cemetery?.name || 'Cemetery not set'
        const count = g.rows.length
        return (
          <div key={g.cemetery?.id || idx} className="sb-location-grouped-section">
            <div className="sb-location-grouped-header">
              <span className="sb-location-grouped-name">{name}</span>
              <span className="sb-location-grouped-count">
                {count} {count === 1 ? 'stone' : 'stones'}
              </span>
            </div>
            <div className="sb-location-grouped-rows">
              {g.rows.map(row => (
                <JobsQueueRow
                  key={row.job.id + ':' + (row.milestone?.id || '')}
                  row={row}
                  onClick={onOpenRow}
                  showPlot
                />
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// =============================================================================
// STYLES
// =============================================================================

const localStyles = `
  .sb-location-grouped-panel {
    display: flex;
    flex-direction: column;
  }
  .sb-location-grouped-section {
    border-bottom: 0.5px solid var(--sb-border);
  }
  .sb-location-grouped-section:last-child {
    border-bottom: none;
  }
  .sb-location-grouped-header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
    padding: 12px 18px 8px 18px;
    background: var(--sb-surface-muted);
  }
  .sb-location-grouped-name {
    font-size: 13px;
    font-weight: 500;
    color: var(--sb-text);
    letter-spacing: -0.003em;
  }
  .sb-location-grouped-count {
    font-size: 12px;
    color: var(--sb-text-muted);
    font-variant-numeric: tabular-nums;
  }
  .sb-location-grouped-rows {
    display: flex;
    flex-direction: column;
  }
  .sb-queue-empty {
    padding: 28px 20px;
    font-size: 13px;
    color: var(--sb-text-muted);
    text-align: left;
  }
`

if (typeof document !== 'undefined' && !document.getElementById('sb-jobs-location-grouped-styles')) {
  const tag = document.createElement('style')
  tag.id = 'sb-jobs-location-grouped-styles'
  tag.textContent = localStyles
  document.head.appendChild(tag)
}
