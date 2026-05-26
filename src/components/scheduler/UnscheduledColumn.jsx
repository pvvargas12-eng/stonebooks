// =============================================================================
// 📚 Stonebooks — Unscheduled column
// =============================================================================
// One column of actionable jobs that qualify for a specific batch kind.
// Lives inside WeekWorkbench. Each card shows the customer surname, the
// cemetery name, the milestone label that gates this batch kind, and a
// checkbox for inclusion in the next batch-builder action.
//
// The column displays its kind's color stripe at the top so the operator
// can scan visually across columns by color. Counts include any active
// promise badges on jobs that have one.
// =============================================================================

import { customerName } from '../../lib/stonebooksData'
import PromiseBadge from './PromiseBadge'

export default function UnscheduledColumn({
  kindInfo,
  rows,
  selectedIds,
  onToggle,
  promisesByJob,
}) {
  const total = rows.length
  return (
    <section className="sb-uncol" style={{ borderTopColor: kindInfo.color }}>
      <header className="sb-uncol-head">
        <span className="sb-uncol-label">{kindInfo.label}</span>
        <span className="sb-uncol-count">{total}</span>
      </header>
      {total === 0 ? (
        <div className="sb-uncol-empty">Nothing waiting.</div>
      ) : (
        <ul className="sb-uncol-list">
          {rows.map(({ job, milestone }) => {
            const surname = job.order?.primary_lastname
              || customerName(job.order?.customer)
              || '—'
            const cemetery = job.order?.cemetery?.name || job.cemetery?.name || null
            const promises = promisesByJob?.get(job.id) || []
            const checked = selectedIds.has(job.id)
            return (
              <li key={job.id} className="sb-uncol-card">
                <label className="sb-uncol-card-label">
                  <input
                    type="checkbox"
                    className="sb-uncol-card-checkbox"
                    checked={checked}
                    onChange={e => onToggle?.(job, e.target.checked)}
                  />
                  <div className="sb-uncol-card-body">
                    <div className="sb-uncol-card-primary">
                      <span className="sb-uncol-card-surname">{surname}</span>
                      {promises.length > 0 && (
                        <PromiseBadge promise={promises[0]} size="sm" />
                      )}
                    </div>
                    {cemetery && (
                      <div className="sb-uncol-card-secondary">{cemetery}</div>
                    )}
                    {milestone?.label && (
                      <div className="sb-uncol-card-stage">{milestone.label}</div>
                    )}
                  </div>
                </label>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

const localStyles = `
  .sb-uncol {
    display: flex;
    flex-direction: column;
    background: var(--sb-surface);
    border: 0.5px solid var(--sb-border);
    border-top: 3px solid transparent;
    border-radius: var(--sb-r-sm, 6px);
    min-height: 220px;
  }
  .sb-uncol-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
    padding: 12px 14px;
    border-bottom: 0.5px solid var(--sb-border);
  }
  .sb-uncol-label {
    font-size: 12px;
    font-weight: 500;
    color: var(--sb-text);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  .sb-uncol-count {
    font-size: 12px;
    color: var(--sb-text-muted);
    font-variant-numeric: tabular-nums;
  }
  .sb-uncol-empty {
    font-size: 13px;
    color: var(--sb-text-muted);
    padding: 16px 14px;
    font-style: italic;
  }
  .sb-uncol-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
  }
  .sb-uncol-card {
    border-bottom: 0.5px solid var(--sb-border);
  }
  .sb-uncol-card:last-child {
    border-bottom: none;
  }
  .sb-uncol-card-label {
    display: flex;
    gap: 10px;
    align-items: flex-start;
    padding: 10px 14px;
    cursor: pointer;
    transition: background 0.12s;
  }
  .sb-uncol-card-label:hover {
    background: var(--sb-surface-muted);
  }
  .sb-uncol-card-checkbox {
    margin-top: 3px;
    accent-color: var(--sb-accent, #b8842a);
    cursor: pointer;
  }
  .sb-uncol-card-body {
    flex: 1;
    min-width: 0;
  }
  .sb-uncol-card-primary {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }
  .sb-uncol-card-surname {
    font-size: 13px;
    font-weight: 500;
    color: var(--sb-text);
  }
  .sb-uncol-card-secondary {
    font-size: 11px;
    color: var(--sb-text-muted);
    margin-top: 2px;
  }
  .sb-uncol-card-stage {
    font-size: 11px;
    color: var(--sb-text-secondary);
    margin-top: 2px;
    font-style: italic;
  }
`

if (typeof document !== 'undefined' && !document.getElementById('sb-uncol-styles')) {
  const tag = document.createElement('style')
  tag.id = 'sb-uncol-styles'
  tag.textContent = localStyles
  document.head.appendChild(tag)
}
