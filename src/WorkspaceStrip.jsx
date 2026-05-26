// =============================================================================
// 📚 Stonebooks — Workspace Strip (W-2)
// =============================================================================
// A thin, subdued row of chips representing the operator's open workpieces.
// Lives at the top of the main content area; renders only when at least one
// workpiece is open. The focused chip mirrors the currently-viewed entity.
//
// Visual posture: calm, peripheral, almost-invisible-when-not-needed. Not
// a tab strip (those are nav destinations). Not a list (no header, no
// counts, no actions beyond focus + close). One chip per workpiece, max
// label width caps long names with an ellipsis, close × on every chip.
//
// What this component does NOT do (deliberate, per W-2 scope):
//   • Keyboard shortcuts of any kind (no ⌘1–⌘5, no ⌘W, no arrows)
//   • Drag-to-reorder
//   • Hover previews
//   • Right-click menus
//   • Type labels or badges (the chip label disambiguates by convention:
//     "Patel — job" / "Smith" / "Patel — #1234")
// =============================================================================

import { workpieceKey } from './lib/useWorkpieces'

export default function WorkspaceStrip({ workpieces, focusedKey, onFocus, onClose }) {
  if (!workpieces || workpieces.length === 0) return null

  return (
    <div className="sb-workspace-strip" role="toolbar" aria-label="Open workpieces">
      {workpieces.map((wp) => {
        const key = workpieceKey(wp)
        const isFocused = key === focusedKey
        return (
          <div
            key={key}
            className={`sb-workspace-chip ${isFocused ? 'sb-workspace-chip-focused' : ''}`}
          >
            <button
              type="button"
              className="sb-workspace-chip-body"
              onClick={() => onFocus?.(wp)}
              title={wp.sublabel ? `${wp.label} · ${wp.sublabel}` : wp.label}
              aria-current={isFocused ? 'true' : undefined}
            >
              <span className="sb-workspace-chip-label">{wp.label}</span>
            </button>
            <button
              type="button"
              className="sb-workspace-chip-close"
              onClick={(e) => { e.stopPropagation(); onClose?.(wp) }}
              aria-label={`Close ${wp.label}`}
              title="Close"
            >
              ×
            </button>
          </div>
        )
      })}
    </div>
  )
}

// =============================================================================
// STYLES
// =============================================================================
// Subdued. Hairline separator below the strip so it visually anchors the
// peripheral chrome without competing with the page title beneath.

const localStyles = `
  /* Strip — no divider, no bordered "tab-bar" look. The strip is operational
     memory, not navigation chrome. Vertical breathing room replaces a hairline
     so the page title beneath has its own visual space without competing for
     attention with the strip. */
  .sb-workspace-strip {
    display: flex;
    flex-wrap: wrap;
    gap: 2px;
    padding: 2px 0 8px;
    margin-bottom: 22px;
    align-items: center;
  }

  /* Borderless chips. Inactive chips read as muted text on the page
     background; focus emerges via a subtle surface-muted fill plus weight
     500. No outline, no border, no tab-shaped container. */
  .sb-workspace-chip {
    display: inline-flex;
    align-items: stretch;
    background: transparent;
    border: none;
    border-radius: 6px;
    overflow: hidden;
    transition: background 0.12s;
    max-width: 240px;
  }
  .sb-workspace-chip:hover {
    background: var(--sb-surface-muted);
  }
  .sb-workspace-chip-focused {
    background: var(--sb-surface-muted);
  }

  /* Focus button — the label-clickable surface that re-opens the workpiece.
     Padding is light so chips read as text-with-a-soft-pill, not as buttons. */
  .sb-workspace-chip-body {
    display: inline-flex;
    align-items: center;
    padding: 4px 6px 4px 10px;
    background: transparent;
    border: none;
    color: var(--sb-text-muted);
    font: inherit;
    font-size: 14px;
    cursor: pointer;
    min-width: 0;
    flex: 1;
    transition: color 0.12s;
  }
  .sb-workspace-chip-body:hover {
    color: var(--sb-text);
  }
  .sb-workspace-chip-focused .sb-workspace-chip-body {
    color: var(--sb-text);
    font-weight: 500;
  }

  .sb-workspace-chip-label {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    letter-spacing: -0.005em;
  }

  /* Close × — hidden at rest, revealed on hover OR when the chip is
     focused. Reduces visual noise across the strip; the operator still
     always has access to the close on the chip they're actively engaged
     with. */
  .sb-workspace-chip-close {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    background: transparent;
    border: none;
    color: var(--sb-text-muted);
    font-size: 13px;
    line-height: 1;
    cursor: pointer;
    padding: 0;
    opacity: 0;
    transition: opacity 0.12s, color 0.12s;
  }
  .sb-workspace-chip:hover .sb-workspace-chip-close,
  .sb-workspace-chip-focused .sb-workspace-chip-close {
    opacity: 0.55;
  }
  .sb-workspace-chip-close:hover {
    opacity: 1;
    color: var(--sb-text);
  }

  /* Phone — same strip; chips wrap naturally. */
  @media (max-width: 600px) {
    .sb-workspace-strip {
      padding-bottom: 6px;
      margin-bottom: 18px;
    }
    .sb-workspace-chip { max-width: 100%; }
    /* On touch devices, the hover-reveal pattern doesn't apply — keep the
       close visible at low contrast so it's always tappable. */
    .sb-workspace-chip-close { opacity: 0.55; }
  }
`

if (typeof document !== 'undefined' && !document.getElementById('sb-workspace-strip-styles')) {
  const tag = document.createElement('style')
  tag.id = 'sb-workspace-strip-styles'
  tag.textContent = localStyles
  document.head.appendChild(tag)
}
