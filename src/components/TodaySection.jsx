// =============================================================================
// 📚 Stonebooks — Today Section
// =============================================================================
// Section header + row list for the Today page. Same posture as
// JobsQueueSection — small urgency dot, section name + count, right-aligned
// secondary slot — but tuned for the Today context:
//   • No "sort label" (the rows are already worst-first).
//   • Empty state uses an intentional sentence ("Nothing overdue. Good.")
//     instead of "Nothing in this queue."
//   • Caller can collapse the section entirely when empty (the Aging section
//     hides when there's nothing in it).
// =============================================================================

import { URGENCY } from '../lib/stonebooksData'
import TodayRow from './TodayRow'

const URGENCY_DOT_COLOR = {
  [URGENCY.NEUTRAL]: 'var(--sb-border)',
  [URGENCY.AMBER]:   'var(--sb-amber, #b8842a)',
  [URGENCY.RED]:     'var(--sb-red, #b54040)',
}

export default function TodaySection({
  label,
  rows,
  urgency = URGENCY.NEUTRAL,
  emptyText,
  hideWhenEmpty = false,
  onOpenRow,
  rowUrgency,    // optional override applied to every row in the section
}) {
  const isEmpty = !rows || rows.length === 0
  if (isEmpty && hideWhenEmpty) return null

  return (
    <section className="sb-today-section">
      <header className="sb-today-section-head">
        <div className="sb-today-section-head-left">
          <span
            className="sb-today-section-dot"
            style={{ background: URGENCY_DOT_COLOR[urgency] }}
            aria-hidden="true"
          />
          <span className="sb-today-section-name">{label}</span>
          {!isEmpty && (
            <span className="sb-today-section-count">{rows.length}</span>
          )}
        </div>
      </header>

      {isEmpty ? (
        <p className="sb-today-section-empty">{emptyText}</p>
      ) : (
        <div className="sb-today-section-panel">
          <div className="sb-today-section-rows">
            {rows.map(row => (
              <TodayRow
                key={row.job.id + ':' + (row.milestone?.id || row.milestone?.milestone_key || '')}
                row={row}
                urgency={rowUrgency || row.urgency}
                onClick={onOpenRow}
              />
            ))}
          </div>
        </div>
      )}
    </section>
  )
}

// =============================================================================
// STYLES
// =============================================================================

const localStyles = `
  .sb-today-section {
    margin-bottom: 40px;
  }
  .sb-today-section:last-child {
    margin-bottom: 0;
  }

  .sb-today-section-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 16px;
    margin-bottom: 12px;
    padding: 0 2px;
  }
  .sb-today-section-head-left {
    display: inline-flex;
    align-items: baseline;
    gap: 10px;
    min-width: 0;
  }
  .sb-today-section-dot {
    display: inline-block;
    width: 8px;
    height: 8px;
    border-radius: 999px;
    transform: translateY(-1px);
  }
  .sb-today-section-name {
    font-size: 15px;
    font-weight: 500;
    color: var(--sb-text);
    letter-spacing: -0.005em;
  }
  .sb-today-section-count {
    font-size: 13px;
    color: var(--sb-text-muted);
    font-variant-numeric: tabular-nums;
  }

  /* Empty section — sentence-form prose, not a card. The section dot, label,
     and the empty sentence read as one calm acknowledgment that the bucket is
     clean. No hairline border under the sentence (the section is closed). */
  .sb-today-section-empty {
    font-size: 15px;
    line-height: 1.5;
    color: var(--sb-text-secondary);
    max-width: 60ch;
    margin: 0;
    padding: 4px 2px 8px;
  }

  /* Panel — same chrome as JobsQueueSection's panel so both pages feel like
     one design language. The bordered, rounded container makes a populated
     section feel like a list with weight; the empty section above intentionally
     skips this chrome. */
  .sb-today-section-panel {
    background: var(--sb-surface);
    border: 0.5px solid var(--sb-border);
    border-radius: var(--sb-r-sm, 6px);
    overflow: hidden;
  }
  .sb-today-section-rows {
    display: flex;
    flex-direction: column;
  }
`

if (typeof document !== 'undefined' && !document.getElementById('sb-today-section-styles')) {
  const tag = document.createElement('style')
  tag.id = 'sb-today-section-styles'
  tag.textContent = localStyles
  document.head.appendChild(tag)
}
