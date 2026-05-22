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
  .sb-workspace-strip {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    padding: 0 0 14px;
    margin-bottom: 24px;
    border-bottom: 0.5px solid var(--sb-border);
    align-items: center;
  }

  /* Each chip is a two-element compound: a focus button (the body) and a
     close button. Both share a single rounded outer frame so they read as
     one operational object, not two adjacent controls. */
  .sb-workspace-chip {
    display: inline-flex;
    align-items: stretch;
    background: transparent;
    border: 0.5px solid var(--sb-border);
    border-radius: 6px;
    overflow: hidden;
    transition: border-color 0.12s, background 0.12s;
    max-width: 280px;
  }
  .sb-workspace-chip:hover {
    border-color: var(--sb-border-hover);
  }
  .sb-workspace-chip-focused {
    background: var(--sb-surface);
    border-color: var(--sb-border-hover);
  }

  /* Focus button — the label-clickable surface that re-opens the workpiece. */
  .sb-workspace-chip-body {
    display: inline-flex;
    align-items: center;
    padding: 5px 4px 5px 11px;
    background: transparent;
    border: none;
    color: var(--sb-text-secondary);
    font: inherit;
    font-size: 13px;
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

  /* Close × — always present, low contrast, expands its hover area gently. */
  .sb-workspace-chip-close {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    background: transparent;
    border: none;
    color: var(--sb-text-muted);
    font-size: 14px;
    line-height: 1;
    cursor: pointer;
    padding: 0;
    transition: color 0.12s, background 0.12s;
  }
  .sb-workspace-chip-close:hover {
    color: var(--sb-text);
    background: var(--sb-surface-muted);
  }

  /* Phone — same strip; chips wrap naturally. */
  @media (max-width: 600px) {
    .sb-workspace-strip {
      padding-bottom: 10px;
      margin-bottom: 20px;
    }
    .sb-workspace-chip { max-width: 100%; }
  }
`

if (typeof document !== 'undefined' && !document.getElementById('sb-workspace-strip-styles')) {
  const tag = document.createElement('style')
  tag.id = 'sb-workspace-strip-styles'
  tag.textContent = localStyles
  document.head.appendChild(tag)
}
