// =============================================================================
// 📚 Stonebooks — Promise Badge
// =============================================================================
// The 🤡 is the only emoji in the entire app. It earns its place because it
// carries operational meaning — a customer-facing promise was made about
// this job, by a named team member, for a specific date. When the promise
// is open (kept IS NULL, resolved_at IS NULL), the badge renders loud so
// nobody can ignore it. When the date is past and the work is still open,
// the badge turns red.
//
// Used on:
//   • TodayTab rows
//   • SchedulerTab Month cells and column cards
//   • CalendarTab batch cards and dispatch stops
//   • JobDetail header
//
// Always positioned beside the customer identity — the surname + the 🤡 +
// the promiser name forms one tight unit so the operator instantly sees
// "this is whose promise, made by whom."
// =============================================================================

import { fmtDate } from '../../lib/stonebooksData'

export default function PromiseBadge({ promise, size = 'sm' }) {
  if (!promise) return null
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const dueDate = promise.promised_date
    ? new Date(`${String(promise.promised_date).slice(0, 10)}T00:00:00`)
    : null
  const isOverdue = !!(dueDate && dueDate.getTime() < today.getTime())
  const cls = [
    'sb-promise-badge',
    `sb-promise-badge-${size}`,
    isOverdue ? 'sb-promise-badge-red' : 'sb-promise-badge-amber',
  ].join(' ')
  const dateLabel = promise.promised_date ? fmtDate(promise.promised_date) : null

  return (
    <span className={cls} title={promise.notes || `Promised by ${promise.promised_by}`}>
      <span className="sb-promise-badge-icon" aria-hidden="true">🤡</span>
      <span className="sb-promise-badge-text">
        {promise.promised_by}
        {dateLabel && <span className="sb-promise-badge-date"> · {dateLabel}</span>}
      </span>
    </span>
  )
}

// =============================================================================
// STYLES
// =============================================================================
// The badge is small in `sm` (inline beside surname / row identity) and a
// half-step larger in `md` (in batch cards and JobDetail header). Loud color
// is the point — red for overdue, amber for open-but-not-yet-due. No hover
// state; this isn't interactive on its own (parent rows are the click
// targets).

const localStyles = `
  .sb-promise-badge {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    border-radius: 999px;
    line-height: 1.4;
    font-weight: 500;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    vertical-align: middle;
  }
  .sb-promise-badge-icon {
    line-height: 1;
  }
  .sb-promise-badge-sm {
    font-size: 11px;
    padding: 2px 8px 2px 6px;
    gap: 3px;
  }
  .sb-promise-badge-sm .sb-promise-badge-icon {
    font-size: 12px;
  }
  .sb-promise-badge-md {
    font-size: 13px;
    padding: 4px 12px 4px 8px;
  }
  .sb-promise-badge-md .sb-promise-badge-icon {
    font-size: 16px;
  }

  /* Amber — promise is still open and the date hasn't passed yet. */
  .sb-promise-badge-amber {
    color: var(--sb-amber, #b8842a);
    background: var(--sb-amber-bg, #fbe5b8);
  }
  /* Red — promised date is in the past and the promise hasn't been resolved.
     This is the "we're already late or about to be" state. Bold call-out. */
  .sb-promise-badge-red {
    color: var(--sb-red, #b54040);
    background: var(--sb-red-bg, #fbe5e5);
    font-weight: 600;
  }

  .sb-promise-badge-date {
    color: inherit;
    opacity: 0.85;
  }
`

if (typeof document !== 'undefined' && !document.getElementById('sb-promise-badge-styles')) {
  const tag = document.createElement('style')
  tag.id = 'sb-promise-badge-styles'
  tag.textContent = localStyles
  document.head.appendChild(tag)
}
