// =============================================================================
// Stonebooks — CRM theme tokens + style injection
// =============================================================================
// Pure-JS module (no JSX): exports token constants, semantic helpers, and
// injects the shared .sb-crm-* CSS into <head>. React components that USE
// these tokens live in crmComponents.jsx so React-Fast-Refresh's purity
// rule stays happy.
// =============================================================================

// ── Tokens ───────────────────────────────────────────────────────────────────
export const CRM = {
  canvas:       '#F7F6F3',
  card:         '#FFFFFF',
  cardBorder:   'rgba(15, 20, 25, 0.08)',
  cardShadow1:  'rgba(15, 20, 25, 0.04)',
  cardShadow2:  'rgba(15, 20, 25, 0.04)',
  ink:          '#1A1A1A',
  inkMuted:     '#5D5D5A',
  inkSubtle:    '#8B8B87',
  bronze:       '#9A7209',
  bronzeBg:     'rgba(154, 114, 9, 0.10)',
  red:          '#B54040',
  redBg:        'rgba(181, 64, 64, 0.10)',
  amber:        '#B8842A',
  amberBg:      'rgba(184, 132, 42, 0.14)',
  green:        '#1D9E75',
  greenBg:      'rgba(29, 158, 117, 0.10)',
  blue:         '#3F6FD1',
  blueBg:       'rgba(63, 111, 209, 0.10)',
  line:         'rgba(15, 20, 25, 0.08)',
  lineSoft:     'rgba(15, 20, 25, 0.05)',
}

export function pillTone(severity) {
  switch (severity) {
    case 'red':   return { fg: CRM.red,    bg: CRM.redBg }
    case 'amber': return { fg: CRM.amber,  bg: CRM.amberBg }
    case 'blue':  return { fg: CRM.blue,   bg: CRM.blueBg }
    case 'green': return { fg: CRM.green,  bg: CRM.greenBg }
    case 'bronze':
    default:      return { fg: CRM.bronze, bg: CRM.bronzeBg }
  }
}

export function paymentTone(state) {
  switch (state) {
    case 'paid_in_full': return 'green'
    case 'partial':      return 'amber'
    case 'unpaid':       return 'red'
    case 'overdue':      return 'red'
    default:             return null
  }
}

export function paymentLabel(state) {
  switch (state) {
    case 'paid_in_full': return 'Paid in full'
    case 'partial':      return 'Partial'
    case 'unpaid':       return 'Unpaid'
    case 'overdue':      return 'Overdue'
    default:             return null
  }
}

// =============================================================================
// Style injection — idempotent. Runs on first import of this module by any
// CRM-style page; components in crmComponents.jsx reference these classes.
// =============================================================================

const styles = `
  .sb-crm-page {
    background: ${CRM.canvas};
    margin: 0 -24px -32px;
    padding: 40px 0 80px;
    min-height: 100%;
    box-sizing: border-box;
  }
  .sb-crm-container {
    max-width: 1180px;
    margin: 0 auto;
    padding: 0 32px;
    display: flex;
    flex-direction: column;
    gap: 20px;
  }
  .sb-crm-error {
    background: ${CRM.card};
    border: 0.5px solid ${CRM.red};
    color: ${CRM.red};
    padding: 14px 18px;
    border-radius: 10px;
    font-size: 13px;
  }
  .sb-crm-card {
    background: ${CRM.card};
    border: 0.5px solid ${CRM.cardBorder};
    border-radius: 12px;
    box-shadow:
      0 1px 3px ${CRM.cardShadow1},
      0 8px 24px ${CRM.cardShadow2};
    box-sizing: border-box;
  }
  .sb-crm-head {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 16px;
    padding: 4px 0;
    flex-wrap: wrap;
  }
  .sb-crm-head-title {
    font-size: 28px;
    font-weight: 600;
    letter-spacing: -0.012em;
    color: ${CRM.ink};
    margin: 0;
    line-height: 1.1;
  }
  .sb-crm-head-count {
    font-size: 13px;
    color: ${CRM.inkMuted};
    margin-top: 4px;
  }
  .sb-crm-head-count strong {
    color: ${CRM.ink};
    font-weight: 600;
  }
  .sb-crm-head-actions { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }

  .sb-crm-search {
    font: inherit;
    font-size: 13px;
    padding: 9px 12px;
    border: 0.5px solid ${CRM.cardBorder};
    border-radius: 8px;
    background: ${CRM.card};
    color: ${CRM.ink};
    min-width: 260px;
  }
  .sb-crm-search:focus {
    outline: none;
    border-color: ${CRM.bronze};
    box-shadow: 0 0 0 2px ${CRM.bronzeBg};
  }

  .sb-crm-sort {
    font: inherit;
    font-size: 13px;
    padding: 8px 28px 8px 12px;
    border: 0.5px solid ${CRM.cardBorder};
    border-radius: 8px;
    background: ${CRM.card};
    color: ${CRM.ink};
    appearance: none;
    cursor: pointer;
    background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'><path d='M1 1l4 4 4-4' stroke='%235D5D5A' stroke-width='1.2' fill='none' stroke-linecap='round'/></svg>");
    background-repeat: no-repeat;
    background-position: right 10px center;
  }
  .sb-crm-sort:focus { outline: none; border-color: ${CRM.bronze}; box-shadow: 0 0 0 2px ${CRM.bronzeBg}; }

  .sb-crm-btn-primary {
    font: inherit;
    font-size: 13px;
    font-weight: 500;
    padding: 9px 16px;
    border-radius: 8px;
    background: ${CRM.bronze};
    color: ${CRM.card};
    border: 0.5px solid transparent;
    cursor: pointer;
  }
  .sb-crm-btn-primary:hover { filter: brightness(0.95); }

  .sb-crm-btn-secondary {
    font: inherit;
    font-size: 13px;
    font-weight: 500;
    padding: 9px 16px;
    border-radius: 8px;
    background: ${CRM.card};
    color: ${CRM.ink};
    border: 0.5px solid ${CRM.cardBorder};
    cursor: pointer;
  }
  .sb-crm-btn-secondary:hover { background: ${CRM.bronzeBg}; }

  .sb-crm-chip-row {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    align-items: center;
  }
  .sb-crm-chip-group {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding-right: 8px;
    border-right: 0.5px solid ${CRM.line};
  }
  .sb-crm-chip-group:last-child { border-right: none; padding-right: 0; }
  .sb-crm-chip-group-label {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: ${CRM.inkSubtle};
    font-weight: 600;
    margin-right: 4px;
  }

  .sb-crm-chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font: inherit;
    font-size: 12px;
    font-weight: 500;
    padding: 5px 11px;
    border-radius: 8px;
    background: ${CRM.card};
    border: 0.5px solid ${CRM.cardBorder};
    color: ${CRM.inkMuted};
    cursor: pointer;
    line-height: 1.2;
    transition: background 0.12s, color 0.12s, border-color 0.12s;
  }
  .sb-crm-chip:hover { background: ${CRM.canvas}; color: ${CRM.ink}; }
  .sb-crm-chip-active {
    background: ${CRM.bronzeBg};
    color: ${CRM.bronze};
    border-color: ${CRM.bronze};
  }
  .sb-crm-chip-active:hover { background: ${CRM.bronzeBg}; color: ${CRM.bronze}; }
  .sb-crm-chip-count {
    font-size: 10px;
    color: ${CRM.inkSubtle};
    font-variant-numeric: tabular-nums;
    padding: 1px 5px;
    border-radius: 999px;
    background: ${CRM.canvas};
  }
  .sb-crm-chip-active .sb-crm-chip-count {
    background: ${CRM.card};
    color: ${CRM.bronze};
  }

  .sb-crm-pill {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-size: 11px;
    font-weight: 600;
    padding: 3px 9px;
    border-radius: 4px;
    line-height: 1.3;
    white-space: nowrap;
    letter-spacing: 0.02em;
  }
  .sb-crm-pill-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    display: inline-block;
  }

  .sb-crm-bar {
    width: 64px;
    height: 4px;
    background: ${CRM.line};
    border-radius: 2px;
    overflow: hidden;
    margin-top: 5px;
  }
  .sb-crm-bar-fill {
    height: 100%;
    border-radius: 2px;
    transition: width 0.3s ease;
  }

  .sb-crm-metric {
    padding: 18px 20px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .sb-crm-metric-label {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.14em;
    color: ${CRM.bronze};
    font-weight: 600;
  }
  .sb-crm-metric-value {
    font-size: 28px;
    font-weight: 600;
    letter-spacing: -0.012em;
    color: ${CRM.ink};
    font-variant-numeric: tabular-nums;
    line-height: 1;
  }
  .sb-crm-metric-sub {
    font-size: 11px;
    color: ${CRM.inkMuted};
  }
  .sb-crm-metric-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 12px;
  }
  @media (max-width: 760px) {
    .sb-crm-metric-grid { grid-template-columns: repeat(2, 1fr); }
  }
  @media (max-width: 480px) {
    .sb-crm-metric-grid { grid-template-columns: 1fr; }
    .sb-crm-metric-value { font-size: 22px; }
  }

  .sb-crm-table { padding: 6px 0; }
  .sb-crm-row {
    display: grid;
    align-items: center;
    gap: 14px;
    width: 100%;
    box-sizing: border-box;
    padding: 14px 24px;
    border: none;
    background: transparent;
    text-align: left;
    font: inherit;
    color: inherit;
    border-bottom: 0.5px solid ${CRM.lineSoft};
    cursor: pointer;
    transition: background 0.1s ease;
  }
  .sb-crm-row:last-child { border-bottom: none; }
  .sb-crm-row:hover { background: ${CRM.canvas}; }
  .sb-crm-row-head {
    cursor: default;
    background: transparent !important;
    border-bottom: 0.5px solid ${CRM.line};
    padding-top: 12px;
    padding-bottom: 12px;
  }
  .sb-crm-row-head > div {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: ${CRM.inkSubtle};
    font-weight: 600;
  }
  .sb-crm-row .num,
  .sb-crm-row-head .num {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }

  .sb-crm-primary {
    font-size: 14px;
    font-weight: 600;
    color: ${CRM.ink};
    letter-spacing: -0.003em;
    line-height: 1.2;
  }
  .sb-crm-secondary {
    font-size: 11px;
    color: ${CRM.inkMuted};
    margin-top: 2px;
    line-height: 1.3;
  }
  .sb-crm-mono {
    font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
    font-size: 11px;
    color: ${CRM.inkMuted};
    letter-spacing: 0.01em;
  }
  .sb-crm-num {
    font-size: 13px;
    color: ${CRM.ink};
    font-variant-numeric: tabular-nums;
    text-align: right;
  }
  .sb-crm-muted {
    font-size: 12px;
    color: ${CRM.inkMuted};
  }
  .sb-crm-tabular {
    font-variant-numeric: tabular-nums;
  }

  .sb-crm-empty {
    padding: 40px 24px;
    text-align: center;
    color: ${CRM.inkMuted};
    font-size: 14px;
  }
  .sb-crm-empty button {
    background: transparent;
    border: 0.5px solid ${CRM.bronze};
    color: ${CRM.bronze};
    font: inherit;
    font-size: 12px;
    font-weight: 500;
    padding: 6px 14px;
    border-radius: 6px;
    cursor: pointer;
    margin-top: 12px;
  }

  .sb-crm-call-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: ${CRM.bronze};
    display: inline-block;
    margin-right: 6px;
    vertical-align: middle;
    box-shadow: 0 0 4px rgba(154, 114, 9, 0.4);
  }

  .sb-crm-toolbar {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
  }

  .sb-crm-tel {
    color: ${CRM.inkMuted};
    text-decoration: none;
    font-size: 12px;
  }
  .sb-crm-tel:hover { color: ${CRM.bronze}; }

  /* Min-width advisory banner — shown only at narrow widths. The table
     below still renders (in single-column stack form) but the operator is
     told the dense table layout is desktop-first. Phase 6 work for a
     proper mobile card-list. */
  .sb-crm-min-width-banner { display: none; }
  @media (max-width: 900px) {
    .sb-crm-min-width-banner {
      display: block;
      background: ${CRM.amberBg};
      color: #6b4a1c;
      border: 0.5px solid ${CRM.amber};
      padding: 12px 16px;
      border-radius: 10px;
      font-size: 13px;
      line-height: 1.45;
    }
    .sb-crm-row, .sb-crm-row-head {
      grid-template-columns: 1fr !important;
      gap: 6px;
      padding: 16px 20px;
    }
    .sb-crm-row-head { display: none; }
    .sb-crm-row .num { text-align: left; }
  }
`

if (typeof document !== 'undefined' && !document.getElementById('sb-crm-theme-styles')) {
  const tag = document.createElement('style')
  tag.id = 'sb-crm-theme-styles'
  tag.textContent = styles
  document.head.appendChild(tag)
}
