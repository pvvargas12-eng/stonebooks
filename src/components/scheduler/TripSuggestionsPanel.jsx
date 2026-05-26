// =============================================================================
// 📚 Stonebooks — Trip suggestions panel
// =============================================================================
// Right-side panel inside the BatchBuilder modal. When a destination
// cemetery is chosen, this surfaces piggyback opportunities the operator
// might otherwise miss: same cemetery, nearby cemetery, or upstream
// (cross-stage) work that could ship with the same trip.
//
// Reasons are color-tagged and explained in plain English. Click + Add →
// adds the suggested job to the batch. Once added, the suggestion drops
// from the list (driven by the parent passing the new selected-ids set).
// =============================================================================

import { customerName } from '../../lib/stonebooksData'

const REASON_LABELS = {
  same_cemetery:                'Same cemetery',
  piggyback:                    'Piggyback',
  nearby_cemetery:              'Nearby cemetery',
  cross_stage_same_cemetery:    'Upstream work',
}
const REASON_BLURBS = {
  same_cemetery:                'Already going there — add this stop.',
  piggyback:                    'Photo / rub run can ride along.',
  nearby_cemetery:              'Short detour from your destination.',
  cross_stage_same_cemetery:    'Different stage, same cemetery — bring along if ready enough.',
}
const REASON_TONES = {
  same_cemetery:             { color: '#1D9E75', bg: 'rgba(29, 158, 117, 0.10)' },
  piggyback:                 { color: '#534AB7', bg: 'rgba(83, 74, 183, 0.10)' },
  nearby_cemetery:           { color: '#b8842a', bg: 'rgba(184, 132, 42, 0.12)' },
  cross_stage_same_cemetery: { color: '#5F5E5A', bg: 'rgba(95, 94, 90, 0.10)' },
}

export default function TripSuggestionsPanel({ suggestions, onAdd, destinationName }) {
  if (!destinationName) {
    return (
      <aside className="sb-trip-suggest">
        <header className="sb-trip-suggest-head">
          <span className="sb-trip-suggest-title">Trip suggestions</span>
        </header>
        <div className="sb-trip-suggest-empty">
          Pick a destination cemetery to see piggyback opportunities.
        </div>
      </aside>
    )
  }
  if (!suggestions || suggestions.length === 0) {
    return (
      <aside className="sb-trip-suggest">
        <header className="sb-trip-suggest-head">
          <span className="sb-trip-suggest-title">Trip suggestions</span>
        </header>
        <div className="sb-trip-suggest-empty">
          No piggyback opportunities at {destinationName} or within 10 miles.
        </div>
      </aside>
    )
  }
  return (
    <aside className="sb-trip-suggest">
      <header className="sb-trip-suggest-head">
        <span className="sb-trip-suggest-title">Trip suggestions</span>
        <span className="sb-trip-suggest-count">{suggestions.length}</span>
      </header>
      <ul className="sb-trip-suggest-list">
        {suggestions.map(s => {
          const surname = s.job.order?.primary_lastname
            || customerName(s.job.order?.customer)
            || '—'
          const cem = s.job.order?.cemetery?.name || s.job.cemetery?.name || null
          const tone = REASON_TONES[s.reason] || REASON_TONES.cross_stage_same_cemetery
          const dist = s.distance_miles > 0 ? ` · ${s.distance_miles.toFixed(1)} mi` : ''
          return (
            <li key={s.job.id} className="sb-trip-suggest-item">
              <div className="sb-trip-suggest-body">
                <span
                  className="sb-trip-suggest-reason"
                  style={{ color: tone.color, background: tone.bg }}
                >
                  {REASON_LABELS[s.reason] || s.reason}{dist}
                </span>
                <div className="sb-trip-suggest-primary">
                  <span className="sb-trip-suggest-surname">{surname}</span>
                  {s.milestone?.label && (
                    <span className="sb-trip-suggest-stage">{s.milestone.label}</span>
                  )}
                </div>
                {cem && (
                  <div className="sb-trip-suggest-cem">{cem}</div>
                )}
                <div className="sb-trip-suggest-blurb">
                  {REASON_BLURBS[s.reason]}
                </div>
              </div>
              <button
                type="button"
                className="sb-trip-suggest-add"
                onClick={() => onAdd?.(s.job)}
              >
                + add
              </button>
            </li>
          )
        })}
      </ul>
    </aside>
  )
}

const localStyles = `
  .sb-trip-suggest {
    display: flex;
    flex-direction: column;
    background: var(--sb-surface-muted);
    border: 0.5px solid var(--sb-border);
    border-radius: var(--sb-r-sm, 6px);
    max-height: 100%;
    overflow: hidden;
  }
  .sb-trip-suggest-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
    padding: 12px 14px;
    border-bottom: 0.5px solid var(--sb-border);
  }
  .sb-trip-suggest-title {
    font-size: 12px;
    font-weight: 500;
    color: var(--sb-text);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  .sb-trip-suggest-count {
    font-size: 12px;
    color: var(--sb-text-muted);
    font-variant-numeric: tabular-nums;
  }
  .sb-trip-suggest-empty {
    font-size: 13px;
    color: var(--sb-text-muted);
    padding: 14px;
    line-height: 1.5;
    font-style: italic;
  }
  .sb-trip-suggest-list {
    list-style: none;
    margin: 0;
    padding: 0;
    overflow-y: auto;
  }
  .sb-trip-suggest-item {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 12px 14px;
    border-bottom: 0.5px solid var(--sb-border);
  }
  .sb-trip-suggest-item:last-child {
    border-bottom: none;
  }
  .sb-trip-suggest-body {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .sb-trip-suggest-reason {
    align-self: flex-start;
    font-size: 10px;
    font-weight: 600;
    padding: 2px 8px;
    border-radius: 999px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  .sb-trip-suggest-primary {
    display: flex;
    align-items: baseline;
    gap: 8px;
  }
  .sb-trip-suggest-surname {
    font-size: 13px;
    font-weight: 500;
    color: var(--sb-text);
  }
  .sb-trip-suggest-stage {
    font-size: 11px;
    color: var(--sb-text-muted);
    font-style: italic;
  }
  .sb-trip-suggest-cem {
    font-size: 11px;
    color: var(--sb-text-muted);
  }
  .sb-trip-suggest-blurb {
    font-size: 11px;
    color: var(--sb-text-secondary);
    line-height: 1.4;
    margin-top: 2px;
  }
  .sb-trip-suggest-add {
    background: transparent;
    border: 0.5px solid var(--sb-border);
    color: var(--sb-accent, #b8842a);
    font: inherit;
    font-size: 12px;
    font-weight: 500;
    padding: 4px 10px;
    border-radius: var(--sb-r-sm, 6px);
    cursor: pointer;
    white-space: nowrap;
  }
  .sb-trip-suggest-add:hover {
    background: var(--sb-surface);
  }
`

if (typeof document !== 'undefined' && !document.getElementById('sb-trip-suggest-styles')) {
  const tag = document.createElement('style')
  tag.id = 'sb-trip-suggest-styles'
  tag.textContent = localStyles
  document.head.appendChild(tag)
}
