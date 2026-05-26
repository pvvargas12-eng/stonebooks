// =============================================================================
// 📚 Stonebooks — Jobs Queue Section
// =============================================================================
// One queue rendered below the bucket cards. Header row carries:
//   • small dot matching the section's worst urgency
//   • queue name + count
//   • right-aligned secondary label describing the sort order
// Followed by the panel — flat rows by default, or a location-grouped panel
// when bucket.grouping === 'cemetery'.
// =============================================================================

import { forwardRef } from 'react'
import { URGENCY } from '../lib/stonebooksData'
import JobsQueueRow from './JobsQueueRow'
import JobsLocationGroupedPanel from './JobsLocationGroupedPanel'

const URGENCY_DOT_COLOR = {
  [URGENCY.NEUTRAL]: 'var(--sb-border)',
  [URGENCY.AMBER]:   'var(--sb-amber, #b8842a)',
  [URGENCY.RED]:     'var(--sb-red, #b54040)',
}

const JobsQueueSection = forwardRef(function JobsQueueSection(
  { bucket, onOpenRow },
  ref,
) {
  const urgency = bucket.urgency || URGENCY.NEUTRAL

  return (
    <section ref={ref} className="sb-queue-section" id={`queue-${bucket.code}`}>
      <header className="sb-queue-section-head">
        <div className="sb-queue-section-head-left">
          <span
            className="sb-queue-section-dot"
            style={{ background: URGENCY_DOT_COLOR[urgency] }}
            aria-hidden="true"
          />
          <span className="sb-queue-section-name">{bucket.label}</span>
          <span className="sb-queue-section-count">{bucket.count}</span>
        </div>
        {bucket.sortLabel && (
          <span className="sb-queue-section-sort">{bucket.sortLabel}</span>
        )}
      </header>

      <div className="sb-queue-section-panel">
        {bucket.dataGap && bucket.count === 0 ? (
          <div className="sb-queue-empty">
            {bucket.subline || 'Not wired yet.'}
          </div>
        ) : bucket.grouping === 'cemetery' ? (
          <JobsLocationGroupedPanel
            groups={bucket.groups || []}
            onOpenRow={onOpenRow}
            emptyMessage={bucket.subline || 'Nothing in this queue.'}
          />
        ) : bucket.rows.length === 0 ? (
          <div className="sb-queue-empty">Nothing in this queue.</div>
        ) : (
          <div className="sb-queue-section-rows">
            {bucket.rows.map(row => (
              <JobsQueueRow
                key={row.job.id + ':' + (row.milestone?.id || '')}
                row={row}
                onClick={onOpenRow}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  )
})

export default JobsQueueSection

// =============================================================================
// STYLES
// =============================================================================

const localStyles = `
  .sb-queue-section {
    margin-bottom: 40px;
    scroll-margin-top: 24px;
  }
  .sb-queue-section:last-child {
    margin-bottom: 0;
  }

  .sb-queue-section-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 16px;
    margin-bottom: 12px;
    padding: 0 2px;
  }
  .sb-queue-section-head-left {
    display: inline-flex;
    align-items: baseline;
    gap: 10px;
    min-width: 0;
  }
  .sb-queue-section-dot {
    display: inline-block;
    width: 8px;
    height: 8px;
    border-radius: 999px;
    transform: translateY(-1px);
  }
  .sb-queue-section-name {
    font-size: 15px;
    font-weight: 500;
    color: var(--sb-text);
    letter-spacing: -0.005em;
  }
  .sb-queue-section-count {
    font-size: 13px;
    color: var(--sb-text-muted);
    font-variant-numeric: tabular-nums;
  }
  .sb-queue-section-sort {
    font-size: 12px;
    color: var(--sb-text-muted);
    letter-spacing: 0;
  }

  .sb-queue-section-panel {
    background: var(--sb-surface);
    border: 0.5px solid var(--sb-border);
    border-radius: var(--sb-r-sm, 6px);
    overflow: hidden;
  }
  .sb-queue-section-rows {
    display: flex;
    flex-direction: column;
  }
`

if (typeof document !== 'undefined' && !document.getElementById('sb-jobs-queue-section-styles')) {
  const tag = document.createElement('style')
  tag.id = 'sb-jobs-queue-section-styles'
  tag.textContent = localStyles
  document.head.appendChild(tag)
}
