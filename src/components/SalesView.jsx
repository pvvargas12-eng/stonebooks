// =============================================================================
// 📚 Stonebooks — Sales View
// =============================================================================
// Sales role's hybrid summary surface. The work shape genuinely differs from
// the other departments — sales lives in the Orders tab pre-contract — so
// rather than force-fit job-stage bucket cards, this view is metrics-focused:
//   1. Potential revenue across open estimates (headline)
//   2. Top-5 follow-ups due, with "See all in Orders →"
//   3. Recently won — orders signed in the last 7 days
//
// The data is one shot through getSalesSummary(orders) in stonebooksData.js.
// onSwitchTab plumbs back to Stonebooks.setTab so the "See all" button can
// land the operator in the Orders tab.
// =============================================================================

import { useMemo } from 'react'
import {
  URGENCY,
  fmtUSD,
  fmtDate,
  customerName,
  getSalesSummary,
  rowGrandTotal,
} from '../lib/stonebooksData'

const URGENCY_PILL = {
  [URGENCY.NEUTRAL]: { text: 'var(--sb-text-muted)',    bg: 'transparent' },
  [URGENCY.AMBER]:   { text: 'var(--sb-amber, #b8842a)', bg: 'var(--sb-amber-bg, #fbe5b8)' },
  [URGENCY.RED]:     { text: 'var(--sb-red, #b54040)',   bg: 'var(--sb-red-bg, #fbe5e5)' },
}

export default function SalesView({ orders, onSwitchTab, onOpenOrder }) {
  const summary = useMemo(() => getSalesSummary(orders || []), [orders])
  const {
    potentialRevenue,
    estimateCount,
    avgEstimateValue,
    followups,
    followupsCount,
    recentlyWon,
    recentlyWonCount,
  } = summary

  return (
    <div className="sb-sales-view">
      <PotentialRevenue
        revenue={potentialRevenue}
        count={estimateCount}
        avg={avgEstimateValue}
      />

      <FollowupsSection
        followups={followups}
        totalCount={followupsCount}
        onSwitchTab={onSwitchTab}
        onOpenOrder={onOpenOrder}
      />

      <RecentlyWonSection
        rows={recentlyWon}
        totalCount={recentlyWonCount}
        onOpenOrder={onOpenOrder}
      />
    </div>
  )
}

// ─── Potential revenue (headline) ──────────────────────────────────────────

function PotentialRevenue({ revenue, count, avg }) {
  if (count === 0) {
    return (
      <section className="sb-sales-section sb-sales-revenue">
        <div className="sb-sales-section-label">Potential revenue</div>
        <div className="sb-sales-revenue-amount sb-sales-revenue-empty">$0</div>
        <div className="sb-sales-section-subline">No open estimates right now.</div>
      </section>
    )
  }
  return (
    <section className="sb-sales-section sb-sales-revenue">
      <div className="sb-sales-section-label">Potential revenue</div>
      <div className="sb-sales-revenue-amount">{fmtUSD(revenue)}</div>
      <div className="sb-sales-section-subline">
        Across {count} {count === 1 ? 'open estimate' : 'open estimates'}
        {avg > 0 && ` · avg ${fmtUSD(avg)}`}
      </div>
    </section>
  )
}

// ─── Follow-ups (middle) ───────────────────────────────────────────────────

function FollowupsSection({ followups, totalCount, onSwitchTab, onOpenOrder }) {
  return (
    <section className="sb-sales-section">
      <header className="sb-sales-section-head">
        <div className="sb-sales-section-label">Follow-ups due</div>
        <span className="sb-sales-section-count">
          {totalCount === 0 ? 'all calm' : `${totalCount}`}
        </span>
      </header>

      {totalCount === 0 ? (
        <div className="sb-sales-empty">No estimates need a chase today.</div>
      ) : (
        <>
          <div className="sb-sales-list">
            {followups.map(row => (
              <FollowupRow
                key={row.order?.id}
                row={row}
                onOpenOrder={onOpenOrder}
              />
            ))}
          </div>
          {totalCount > followups.length && (
            <div className="sb-sales-section-foot">
              {totalCount - followups.length} more in the Orders tab.
            </div>
          )}
          <button
            type="button"
            className="sb-sales-action"
            onClick={() => onSwitchTab?.('orders')}
          >
            See all in Orders →
          </button>
        </>
      )}
    </section>
  )
}

function FollowupRow({ row, onOpenOrder }) {
  const order = row.order
  const surname = order?.primary_lastname || customerName(order?.customer) || '—'
  // The estimates helper provides agingDays + urgency; we lean on its
  // urgency directly so the Sales pill matches the Owner Overview signal.
  const urgency = row.urgency || URGENCY.NEUTRAL
  const pill = URGENCY_PILL[urgency]
  const days = row.agingDays ?? 0
  const pillLabel = `${days}d idle`
  const value = order ? rowGrandTotal(order) : 0

  return (
    <button
      type="button"
      className="sb-sales-row"
      onClick={() => order?.id && onOpenOrder?.(order.id)}
    >
      <div className="sb-sales-row-identity">
        <div className="sb-sales-row-primary">{surname}</div>
        {order?.order_number && (
          <div className="sb-sales-row-secondary">#{order.order_number}</div>
        )}
      </div>
      <div className="sb-sales-row-value">
        {value > 0 ? fmtUSD(value) : '—'}
      </div>
      <span
        className="sb-sales-row-pill"
        style={{
          color: pill.text,
          background: pill.bg,
          borderColor: urgency === URGENCY.NEUTRAL ? 'var(--sb-border)' : 'transparent',
        }}
      >
        {pillLabel}
      </span>
    </button>
  )
}

// ─── Recently won (bottom, smaller) ────────────────────────────────────────

function RecentlyWonSection({ rows, totalCount, onOpenOrder }) {
  return (
    <section className="sb-sales-section sb-sales-section-quiet">
      <header className="sb-sales-section-head">
        <div className="sb-sales-section-label">Recently won</div>
        <span className="sb-sales-section-count">
          {totalCount === 0 ? 'this week' : `${totalCount} this week`}
        </span>
      </header>

      {totalCount === 0 ? (
        <div className="sb-sales-empty">No new wins in the last 7 days.</div>
      ) : (
        <div className="sb-sales-list">
          {rows.map(w => (
            <button
              key={w.order.id}
              type="button"
              className="sb-sales-row sb-sales-row-quiet"
              onClick={() => onOpenOrder?.(w.order.id)}
            >
              <div className="sb-sales-row-identity">
                <div className="sb-sales-row-primary">
                  {w.order?.primary_lastname || customerName(w.customer) || '—'}
                </div>
                {w.order?.order_number && (
                  <div className="sb-sales-row-secondary">#{w.order.order_number}</div>
                )}
              </div>
              <div className="sb-sales-row-value">{fmtUSD(w.value)}</div>
              <div className="sb-sales-row-ago">
                {w.daysAgo === 0
                  ? 'today'
                  : w.daysAgo === 1
                    ? 'yesterday'
                    : `${w.daysAgo}d ago`}
                {w.signedAt && (
                  <span className="sb-sales-row-date">{fmtDate(w.signedAt)}</span>
                )}
              </div>
            </button>
          ))}
        </div>
      )}
    </section>
  )
}

// =============================================================================
// STYLES
// =============================================================================
// Three stacked metric-focused sections. Distinct from the bucket-card
// pattern used by other roles — sales work isn't queue-shaped, it's
// metric-shaped, and treating it that way is more honest. Calm by default;
// urgency only earns visual weight when a follow-up earns it.

const localStyles = `
  .sb-sales-view {
    display: flex;
    flex-direction: column;
    gap: 32px;
    width: 100%;
  }

  .sb-sales-section {
    background: var(--sb-surface);
    border: 0.5px solid var(--sb-border);
    border-radius: var(--sb-r-md, 10px);
    padding: 24px 28px;
  }
  .sb-sales-section-quiet {
    background: transparent;
    border: 0.5px solid var(--sb-border);
  }
  .sb-sales-section-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 16px;
  }
  .sb-sales-section-label {
    font-size: 11px;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--sb-text-muted);
  }
  .sb-sales-section-count {
    font-size: 12px;
    color: var(--sb-text-muted);
    font-variant-numeric: tabular-nums;
  }
  .sb-sales-section-subline {
    font-size: 14px;
    color: var(--sb-text-secondary);
    margin-top: 8px;
    font-variant-numeric: tabular-nums;
  }
  .sb-sales-section-foot {
    font-size: 12px;
    color: var(--sb-text-muted);
    margin-top: 10px;
    font-variant-numeric: tabular-nums;
  }

  /* Headline — the potential-revenue card. Large but not flashy. The label
     above + the count below ground the headline so it doesn't read as a
     bare vanity number. */
  .sb-sales-revenue {
    padding: 32px 36px;
  }
  .sb-sales-revenue-amount {
    font-size: 48px;
    font-weight: 500;
    letter-spacing: -0.02em;
    color: var(--sb-text);
    line-height: 1.05;
    font-variant-numeric: tabular-nums;
    margin-top: 4px;
  }
  .sb-sales-revenue-empty {
    color: var(--sb-text-muted);
  }

  /* List rows — used by both follow-ups and recently-won. Compact, calm. */
  .sb-sales-list {
    display: flex;
    flex-direction: column;
  }
  .sb-sales-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 130px 110px;
    gap: 16px;
    align-items: center;
    width: 100%;
    padding: 12px 8px;
    background: transparent;
    border: none;
    border-bottom: 0.5px solid var(--sb-border);
    text-align: left;
    cursor: pointer;
    font: inherit;
    color: inherit;
    transition: background 0.12s;
  }
  .sb-sales-row:last-child {
    border-bottom: none;
  }
  .sb-sales-row:hover {
    background: var(--sb-surface-muted);
  }
  .sb-sales-row:focus-visible {
    outline: 0.5px solid var(--sb-accent);
    outline-offset: -2px;
  }
  .sb-sales-row-quiet {
    grid-template-columns: minmax(0, 1fr) 130px 140px;
  }
  .sb-sales-row-identity {
    min-width: 0;
  }
  .sb-sales-row-primary {
    font-size: 14px;
    font-weight: 500;
    color: var(--sb-text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .sb-sales-row-secondary {
    font-size: 12px;
    color: var(--sb-text-muted);
    font-family: var(--sb-font-mono);
    margin-top: 2px;
  }
  .sb-sales-row-value {
    font-size: 14px;
    font-weight: 500;
    color: var(--sb-text);
    font-variant-numeric: tabular-nums;
    text-align: right;
  }
  .sb-sales-row-pill {
    display: inline-block;
    padding: 3px 10px;
    border-radius: 999px;
    border: 0.5px solid transparent;
    font-size: 11px;
    font-weight: 500;
    line-height: 1.4;
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
    text-align: center;
  }
  .sb-sales-row-ago {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    font-size: 12px;
    color: var(--sb-text-secondary);
    font-variant-numeric: tabular-nums;
    gap: 2px;
  }
  .sb-sales-row-date {
    font-size: 11px;
    color: var(--sb-text-muted);
    font-family: var(--sb-font-mono);
  }

  .sb-sales-empty {
    font-size: 14px;
    line-height: 1.55;
    color: var(--sb-text-muted);
    padding: 4px 0;
  }

  /* See-all action — a quiet link-like button rather than a primary CTA.
     This is a follow-through affordance, not a call to action. */
  .sb-sales-action {
    background: transparent;
    border: none;
    color: var(--sb-accent, #b8842a);
    font: inherit;
    font-size: 13px;
    font-weight: 500;
    padding: 12px 0 0;
    cursor: pointer;
    text-align: left;
  }
  .sb-sales-action:hover {
    text-decoration: underline;
  }
  .sb-sales-action:focus-visible {
    outline: 0.5px solid var(--sb-accent);
    outline-offset: 1px;
  }

  @media (max-width: 720px) {
    .sb-sales-revenue-amount {
      font-size: 38px;
    }
    .sb-sales-section {
      padding: 20px 18px;
    }
    .sb-sales-row {
      grid-template-columns: minmax(0, 1fr) 100px;
    }
    .sb-sales-row-pill,
    .sb-sales-row-ago {
      display: none;
    }
    .sb-sales-row-quiet {
      grid-template-columns: minmax(0, 1fr) 110px;
    }
  }
`

if (typeof document !== 'undefined' && !document.getElementById('sb-sales-view-styles')) {
  const tag = document.createElement('style')
  tag.id = 'sb-sales-view-styles'
  tag.textContent = localStyles
  document.head.appendChild(tag)
}
