// =============================================================================
// Stonebooks — CRM shared component primitives
// =============================================================================
// Pure-components module: Pill, FilterChip, ProgressMicroBar. Pages import
// these alongside tokens/helpers from crmTheme.js. Keeping components in a
// separate file from constants keeps React Fast Refresh's purity rule happy
// (`react-refresh/only-export-components`).
// =============================================================================

import { pillTone } from './crmTheme'

// ── Pill — small semantic chip ───────────────────────────────────────────────
// 4px radius, 3px×9px, 11px medium. Used inside table rows for blocker/status/
// payment indicators. Severity = visual tone. Inline overrides accepted.
export function Pill({ children, severity = 'bronze', dot = false, style, className = '' }) {
  const { fg, bg } = pillTone(severity)
  return (
    <span
      className={`sb-crm-pill ${className}`.trim()}
      style={{ color: fg, background: bg, ...(style || {}) }}
    >
      {dot && <span className="sb-crm-pill-dot" style={{ background: fg }} aria-hidden="true" />}
      {children}
    </span>
  )
}

// ── FilterChip — toggleable filter, 8px radius ───────────────────────────────
// Bronze when active (border + ink); muted when off. Click toggles.
export function FilterChip({ children, active, onClick, count }) {
  return (
    <button
      type="button"
      className={`sb-crm-chip${active ? ' sb-crm-chip-active' : ''}`}
      onClick={onClick}
    >
      <span>{children}</span>
      {count != null && count > 0 && (
        <span className="sb-crm-chip-count">{count}</span>
      )}
    </button>
  )
}

// ── ProgressMicroBar — payment ratio, 4px tall ───────────────────────────────
// fillRatio 0..1; tone bronze by default. Width is parent-driven.
export function ProgressMicroBar({ fillRatio, tone = 'bronze' }) {
  const pct = Math.max(0, Math.min(1, fillRatio || 0)) * 100
  const { fg } = pillTone(tone)
  return (
    <div className="sb-crm-bar">
      <div className="sb-crm-bar-fill" style={{ width: pct + '%', background: fg }} />
    </div>
  )
}
