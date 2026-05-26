// =============================================================================
// 📚 Stonebooks — Jobs Bucket Card
// =============================================================================
// One card per work-queue in a department. 3px left border (urgency-earned),
// small uppercase label, large count, one-line tertiary subline. Tappable —
// click scrolls the matching queue section into view. Calm by default;
// urgency only ever colored when a real signal warrants it.
//
// Visual posture: borderless surface card, hairline outer outline, generous
// internal breathing room. Counts use tabular numerals. No icons, no emoji.
// =============================================================================

import { URGENCY } from '../lib/stonebooksData'

const URGENCY_BORDER = {
  [URGENCY.NEUTRAL]: 'transparent',
  [URGENCY.AMBER]:   'var(--sb-amber, #b8842a)',
  [URGENCY.RED]:     'var(--sb-red, #b54040)',
}
const URGENCY_COUNT_COLOR = {
  [URGENCY.NEUTRAL]: 'var(--sb-text)',
  [URGENCY.AMBER]:   'var(--sb-amber, #b8842a)',
  [URGENCY.RED]:     'var(--sb-red, #b54040)',
}

export default function JobsBucketCard({ bucket, onClick, summaryStyle = false }) {
  const urgency = bucket.urgency || URGENCY.NEUTRAL
  const borderColor = URGENCY_BORDER[urgency]
  const countColor = URGENCY_COUNT_COLOR[urgency]
  const isDataGap = !!bucket.dataGap

  // Headline variant — used by the Owner Overview's Amber and Red summary
  // cards above the curated ten. Same component, heavier left border + a
  // bolder count + a wider grid span so the operator's eye sees the
  // overall-shop signal first. Tone (amber/red) inherits from the bucket's
  // urgency, so the parent only has to set summaryStyle.
  const className = [
    'sb-bucket-card',
    summaryStyle ? 'sb-bucket-card-summary' : '',
  ].filter(Boolean).join(' ')

  return (
    <button
      type="button"
      className={className}
      onClick={() => onClick?.(bucket)}
      style={{ borderLeftColor: borderColor }}
    >
      <div className="sb-bucket-card-label">{bucket.label}</div>
      <div
        className={
          'sb-bucket-card-count' +
          (isDataGap ? ' sb-bucket-card-count-gap' : '') +
          (summaryStyle ? ' sb-bucket-card-count-summary' : '')
        }
        style={{ color: isDataGap ? 'var(--sb-text-muted)' : countColor }}
      >
        {bucket.count}
      </div>
      {bucket.subline && (
        <div className="sb-bucket-card-subline">{bucket.subline}</div>
      )}
    </button>
  )
}

// =============================================================================
// STYLES
// =============================================================================

const localStyles = `
  .sb-bucket-card {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    text-align: left;
    width: 100%;
    min-height: 116px;
    padding: 18px 20px 16px 20px;
    background: var(--sb-surface);
    border: 0.5px solid var(--sb-border);
    border-left: 3px solid transparent;
    border-radius: var(--sb-r-sm, 6px);
    cursor: pointer;
    font: inherit;
    color: inherit;
    transition: background 0.12s, border-color 0.12s;
  }
  .sb-bucket-card:hover {
    background: var(--sb-surface-muted);
  }
  .sb-bucket-card:focus-visible {
    outline: none;
    box-shadow: 0 0 0 2px var(--sb-accent-bg, rgba(184, 132, 42, 0.18));
  }

  /* The single ALL-CAPS exception. Bucket card labels are uppercase by design;
     they read as small system labels above the count. Everything else on the
     page is sentence case. */
  .sb-bucket-card-label {
    font-size: 11px;
    font-weight: 500;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--sb-text-muted);
    margin-bottom: 12px;
    line-height: 1.2;
  }

  .sb-bucket-card-count {
    font-size: 34px;
    font-weight: 500;
    line-height: 1;
    font-variant-numeric: tabular-nums;
    letter-spacing: -0.02em;
    margin-bottom: 10px;
  }
  .sb-bucket-card-count-gap {
    /* Gap buckets get a quieter count so a real 0 (in-flow) doesn't read the
       same as a structural 0 (data not wired yet). */
    font-weight: 400;
  }

  /* Summary variant — Owner Overview "Tasks needing attention" / "Tasks
     overdue" headline cards. Heavier left border (5px vs 3px) and a bolder
     count are the visual cues that these are summary headlines, not bucket
     items. Tone (amber/red border) comes from urgency, set by
     borderLeftColor inline. The summary row itself is laid out by the
     parent (.sb-owner-summary-row, a 2-col grid), so this rule doesn't
     touch grid placement. */
  .sb-bucket-card-summary {
    border-left-width: 5px;
    min-height: 124px;
  }
  .sb-bucket-card-count-summary {
    font-size: 44px;
    font-weight: 600;
  }

  .sb-bucket-card-subline {
    font-size: 12px;
    font-weight: 400;
    color: var(--sb-text-muted);
    line-height: 1.4;
    letter-spacing: -0.002em;
  }

  @media (max-width: 600px) {
    .sb-bucket-card {
      min-height: 100px;
      padding: 14px 16px 14px 16px;
    }
    .sb-bucket-card-count {
      font-size: 28px;
    }
    .sb-bucket-card-count-summary {
      font-size: 36px;
    }
  }
`

if (typeof document !== 'undefined' && !document.getElementById('sb-jobs-bucket-card-styles')) {
  const tag = document.createElement('style')
  tag.id = 'sb-jobs-bucket-card-styles'
  tag.textContent = localStyles
  document.head.appendChild(tag)
}
