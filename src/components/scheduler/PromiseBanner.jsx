// =============================================================================
// 📚 Stonebooks — Promise Banner
// =============================================================================
// The top-of-Scheduler call-out. Shows every open promise across all jobs
// at a glance, ordered by promised_date ascending so the most-imminent
// commitments lead. Click a row → opens the underlying job (or order if
// no job exists yet).
//
// Hides entirely when there are no open promises — the banner shouldn't
// exist on quiet days.
// =============================================================================

import { fmtDate, customerName } from '../../lib/stonebooksData'
import PromiseBadge from './PromiseBadge'

export default function PromiseBanner({ promises, onOpenJob }) {
  if (!promises || promises.length === 0) return null

  return (
    <section className="sb-promise-banner">
      <header className="sb-promise-banner-head">
        <span className="sb-promise-banner-icon" aria-hidden="true">🤡</span>
        <span className="sb-promise-banner-title">
          {promises.length} open {promises.length === 1 ? 'promise' : 'promises'}
        </span>
        <span className="sb-promise-banner-subline">
          Click any row to open the job.
        </span>
      </header>
      <ul className="sb-promise-banner-list">
        {promises.map(p => {
          const order = p.job?.order
          const surname = order?.primary_lastname
            || customerName(order?.customer)
            || '—'
          const orderNum = order?.order_number || (p.job?.id ? p.job.id.slice(0, 8) : '')
          return (
            <li key={p.id} className="sb-promise-banner-item">
              <button
                type="button"
                className="sb-promise-banner-row"
                onClick={() => p.job?.id && onOpenJob?.(p.job.id)}
              >
                <span className="sb-promise-banner-row-identity">
                  <span className="sb-promise-banner-row-name">{surname}</span>
                  {orderNum && (
                    <span className="sb-promise-banner-row-id">#{orderNum}</span>
                  )}
                </span>
                <PromiseBadge promise={p} size="sm" />
                <span className="sb-promise-banner-row-date">
                  {fmtDate(p.promised_date)}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

// =============================================================================
// STYLES
// =============================================================================

const localStyles = `
  .sb-promise-banner {
    border: 0.5px solid var(--sb-red, #b54040);
    background: var(--sb-red-bg, #fbe5e5);
    border-radius: var(--sb-r-sm, 6px);
    padding: 14px 18px;
    margin-bottom: 32px;
  }
  .sb-promise-banner-head {
    display: flex;
    align-items: baseline;
    gap: 10px;
    margin-bottom: 12px;
    flex-wrap: wrap;
  }
  .sb-promise-banner-icon {
    font-size: 16px;
    line-height: 1;
  }
  .sb-promise-banner-title {
    font-size: 14px;
    font-weight: 600;
    color: var(--sb-red, #b54040);
  }
  .sb-promise-banner-subline {
    font-size: 12px;
    color: var(--sb-text-muted);
    font-weight: 400;
  }
  .sb-promise-banner-list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .sb-promise-banner-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 14px;
    width: 100%;
    padding: 8px 10px;
    background: transparent;
    border: none;
    border-radius: var(--sb-r-sm, 6px);
    text-align: left;
    cursor: pointer;
    font: inherit;
    color: inherit;
    transition: background 0.12s;
  }
  .sb-promise-banner-row:hover {
    background: rgba(255, 255, 255, 0.55);
  }
  .sb-promise-banner-row-identity {
    display: inline-flex;
    align-items: baseline;
    gap: 8px;
    min-width: 0;
    flex: 1;
  }
  .sb-promise-banner-row-name {
    font-size: 14px;
    font-weight: 500;
    color: var(--sb-text);
  }
  .sb-promise-banner-row-id {
    font-size: 12px;
    font-family: var(--sb-font-mono);
    color: var(--sb-text-muted);
  }
  .sb-promise-banner-row-date {
    font-size: 12px;
    color: var(--sb-red, #b54040);
    font-variant-numeric: tabular-nums;
    font-weight: 500;
  }
`

if (typeof document !== 'undefined' && !document.getElementById('sb-promise-banner-styles')) {
  const tag = document.createElement('style')
  tag.id = 'sb-promise-banner-styles'
  tag.textContent = localStyles
  document.head.appendChild(tag)
}
