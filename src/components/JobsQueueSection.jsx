// =============================================================================
// 📚 Stonebooks — Jobs Queue Section
// =============================================================================
// One queue rendered below the bucket cards. Header row carries:
//   • small dot matching the section's worst urgency
//   • queue name + count
//   • right-aligned secondary label describing the sort order
// Followed by the panel — flat rows by default, or a location-grouped panel
// when bucket.grouping === 'cemetery'.
//
// When the parent passes `selectable`, each row gets a checkbox and the
// section grows a sticky action bar at the bottom that bundles the selection
// into a bulk PO via BulkOrderModal. The action bar only renders when ≥1 row
// is checked, so the calm-by-default posture is preserved on idle queues.
// =============================================================================

import { forwardRef, useState, useCallback } from 'react'
import { URGENCY } from '../lib/stonebooksData'
import JobsQueueRow from './JobsQueueRow'
import JobsLocationGroupedPanel from './JobsLocationGroupedPanel'
import BulkOrderRow from './BulkOrderRow'
import BulkOrderModal from './BulkOrderModal'

const URGENCY_DOT_COLOR = {
  [URGENCY.NEUTRAL]: 'var(--sb-border)',
  [URGENCY.AMBER]:   'var(--sb-amber, #b8842a)',
  [URGENCY.RED]:     'var(--sb-red, #b54040)',
}

// Map from bucket code to the default bulk-order kind for the multi-select
// modal. Adding a new selectable queue means registering its kind here.
const SELECTABLE_BUCKET_KINDS = {
  stones_to_order:   'stone',
  photos_to_request: 'photo',
}

const JobsQueueSection = forwardRef(function JobsQueueSection(
  { bucket, onOpenRow, bulkOrders, selectable = false, onReload, onMarkBulkReceived, onPromiseClick },
  ref,
) {
  const urgency = bucket.urgency || URGENCY.NEUTRAL
  const [selectedIds, setSelectedIds] = useState(() => new Set())
  const [modalOpen, setModalOpen] = useState(false)

  // The bulk-order list bucket renders BulkOrderRow components instead of
  // milestone rows. It's not selectable; rows have their own "Mark received"
  // action that calls onMarkBulkReceived(bulkOrder.id).
  const isBulkOrderList = bucket.kind === 'bulk_order_list'

  const handleToggle = useCallback((row, checked) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      const id = row.milestone?.id
      if (!id) return prev
      if (checked) next.add(id)
      else next.delete(id)
      return next
    })
  }, [])

  const handleClearSelection = useCallback(() => {
    setSelectedIds(new Set())
  }, [])

  const selectedRows = (bucket.rows || []).filter(r =>
    r.milestone?.id && selectedIds.has(r.milestone.id)
  )
  const defaultKind = SELECTABLE_BUCKET_KINDS[bucket.code] || 'stone'

  const handleCreated = useCallback(() => {
    setSelectedIds(new Set())
    setModalOpen(false)
    onReload?.()
  }, [onReload])

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
        {isBulkOrderList ? (
          bucket.rows.length === 0 ? (
            <div className="sb-queue-empty">
              {bucket.dataGap
                ? (bucket.subline || 'Not wired yet.')
                : 'No open bulk orders.'}
            </div>
          ) : (
            <div className="sb-queue-section-rows">
              {bucket.rows.map(row => (
                <BulkOrderRow
                  key={row.bulkOrder.id}
                  row={row}
                  onMarkReceived={onMarkBulkReceived}
                />
              ))}
            </div>
          )
        ) : bucket.dataGap && bucket.count === 0 ? (
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
                variant={bucket.kind}
                bulkOrders={bulkOrders}
                onClick={onOpenRow}
                selectable={selectable}
                selected={selectable && row.milestone?.id && selectedIds.has(row.milestone.id)}
                onSelectToggle={handleToggle}
                onPromiseClick={onPromiseClick}
              />
            ))}
          </div>
        )}
      </div>

      {selectable && selectedIds.size > 0 && (
        <MultiSelectActionBar
          count={selectedIds.size}
          onClear={handleClearSelection}
          onAddToBulk={() => setModalOpen(true)}
        />
      )}

      {selectable && (
        <BulkOrderModal
          open={modalOpen}
          defaultKind={defaultKind}
          selectedRows={selectedRows}
          onClose={() => setModalOpen(false)}
          onCreated={handleCreated}
        />
      )}
    </section>
  )
})

export default JobsQueueSection

// Action bar — appears below a selectable section's panel only when the
// operator has checked one or more rows. Mirrors the email-app affordance
// of "N selected · primary action · clear" without imitating its iconography.
function MultiSelectActionBar({ count, onClear, onAddToBulk }) {
  return (
    <div className="sb-queue-action-bar" role="region" aria-label="Bulk selection actions">
      <div className="sb-queue-action-count">
        {count} selected
      </div>
      <div className="sb-queue-action-buttons">
        <button
          type="button"
          className="sb-queue-action-clear"
          onClick={onClear}
        >
          Clear selection
        </button>
        <button
          type="button"
          className="sb-queue-action-primary"
          onClick={onAddToBulk}
        >
          Add to bulk order
        </button>
      </div>
    </div>
  )
}

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

  /* Action bar — appears below a selectable section only when the operator
     has checked ≥1 row. Keeps the section calm by default; the bar earns
     its presence by an explicit user action. */
  .sb-queue-action-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    margin-top: 8px;
    padding: 10px 14px;
    background: var(--sb-surface-muted);
    border: 0.5px solid var(--sb-border);
    border-radius: var(--sb-r-sm, 6px);
  }
  .sb-queue-action-count {
    font-size: 13px;
    font-weight: 500;
    color: var(--sb-text);
  }
  .sb-queue-action-buttons {
    display: flex;
    gap: 8px;
  }
  .sb-queue-action-clear,
  .sb-queue-action-primary {
    font: inherit;
    font-size: 13px;
    padding: 6px 14px;
    border-radius: var(--sb-r-sm, 6px);
    cursor: pointer;
    font-weight: 500;
    border: 0.5px solid transparent;
  }
  .sb-queue-action-clear {
    background: transparent;
    color: var(--sb-text-muted);
    border-color: var(--sb-border);
  }
  .sb-queue-action-clear:hover {
    color: var(--sb-text);
    background: var(--sb-surface);
  }
  .sb-queue-action-primary {
    background: var(--sb-accent, #b8842a);
    color: white;
  }
  .sb-queue-action-primary:hover {
    filter: brightness(0.95);
  }
`

if (typeof document !== 'undefined' && !document.getElementById('sb-jobs-queue-section-styles')) {
  const tag = document.createElement('style')
  tag.id = 'sb-jobs-queue-section-styles'
  tag.textContent = localStyles
  document.head.appendChild(tag)
}
