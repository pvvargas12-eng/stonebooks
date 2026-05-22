// =============================================================================
// 📚 Stonebooks — Command Surface (W-1)
// =============================================================================
// The first true Stonebooks v2 primitive — the keystone of the Operational
// Workspace transition. A floating overlay summoned by ⌘K / Ctrl+K / "/".
// Types-to-find-and-act over the existing app, dispatching commands the
// shell consumes via the sb:cmd event bus.
//
// Reference posture: Spotlight + Linear's palette + Superhuman. Calm,
// understated, fast. NOT a chatbot, NOT futuristic, NOT glowing.
//
// What this component does NOT do (deliberately, per W-1 scope):
//   • Persist its own state — the surface is ephemeral by design
//   • Render previews, badges with chrome, or rich entity cards
//   • Show inline contextual actions per result (no "more" affordances)
//   • Suggest completions inline as the operator types (suggestions are
//     the result list itself)
//   • AI / LLM behavior of any kind
//   • Notifications, onboarding, tutorials
// =============================================================================

import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import {
  buildResults,
  refreshEntityIndex,
} from './lib/commandSurface'
import { getRecentEntities, rememberRecent } from './lib/workspaceState'

// The useCommandSurface hook lives in src/lib/useCommandSurface.js — kept
// outside this file so React Fast Refresh treats this as a components-only
// module. Parents import the hook directly; this file exports the overlay.

// =============================================================================
// COMPONENT
// =============================================================================

export default function CommandSurface({ isOpen, onClose, userId }) {
  const [query, setQuery]               = useState('')
  const [selectedIndex, setSelected]    = useState(0)
  const [recents, setRecents]           = useState(() => getRecentEntities(userId))
  const inputRef                        = useRef(null)
  const listRef                         = useRef(null)

  // Refresh the entity index when the surface opens. Cheap if already built.
  useEffect(() => {
    if (!isOpen) return
    refreshEntityIndex().catch(err => {
      console.error('[CommandSurface] entity index refresh failed:', err)
    })
    setRecents(getRecentEntities(userId))
  }, [isOpen, userId])

  // Reset state every open. The surface is ephemeral; previous input shouldn't
  // bleed across invocations.
  useEffect(() => {
    if (isOpen) {
      setQuery('')
      setSelected(0)
      // Defer focus to after the dialog mounts.
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [isOpen])

  // Build results from the current query.
  const results = useMemo(() => buildResults(query, { recents }), [query, recents])

  // Clamp selection within the results length.
  useEffect(() => {
    if (selectedIndex >= results.length) setSelected(Math.max(0, results.length - 1))
  }, [results.length, selectedIndex])

  // Keep the selected row in view (no smooth scroll — operational, not flashy).
  useEffect(() => {
    if (!listRef.current) return
    const el = listRef.current.children?.[selectedIndex]
    if (!el) return
    if (typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ block: 'nearest' })
    }
  }, [selectedIndex])

  const execute = useCallback((row) => {
    if (!row) return
    // Remember entity opens as recents (actions / queries / time don't).
    if (row.kind.startsWith('entity-')) {
      const type = row.kind.replace('entity-', '')
      const id   = row.id.replace(`${type}-`, '')
      rememberRecent(userId, {
        type,
        id,
        label: row.label,
        sublabel: row.sublabel || null,
      })
    }
    try { row.exec?.() } finally { onClose?.() }
  }, [userId, onClose])

  const onKeyDown = (e) => {
    if (e.key === 'Escape')        { e.preventDefault(); onClose?.(); return }
    if (e.key === 'ArrowDown')     { e.preventDefault(); setSelected(i => Math.min(results.length - 1, i + 1)); return }
    if (e.key === 'ArrowUp')       { e.preventDefault(); setSelected(i => Math.max(0, i - 1)); return }
    if (e.key === 'Home')          { e.preventDefault(); setSelected(0); return }
    if (e.key === 'End')           { e.preventDefault(); setSelected(Math.max(0, results.length - 1)); return }
    if (e.key === 'Enter')         { e.preventDefault(); execute(results[selectedIndex]); return }
  }

  if (!isOpen) return null

  return (
    <div
      className="sb-cmd-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Command surface"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.() }}
    >
      <div className="sb-cmd-panel" onKeyDown={onKeyDown}>
        <div className="sb-cmd-input-wrap">
          <input
            ref={inputRef}
            type="text"
            className="sb-cmd-input"
            placeholder="Type a name, a job, an action…"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setSelected(0) }}
            autoComplete="off"
            autoCorrect="off"
            spellCheck="false"
          />
        </div>

        {results.length === 0 ? (
          <div className="sb-cmd-empty">
            {query.trim()
              ? `No matches for "${query.trim()}".`
              : 'Type to search customers, jobs, orders, or actions.'}
          </div>
        ) : (
          <ul ref={listRef} className="sb-cmd-list" role="listbox">
            {results.map((row, i) => (
              <li
                key={row.id}
                className={`sb-cmd-row ${i === selectedIndex ? 'sb-cmd-row-selected' : ''}`}
                role="option"
                aria-selected={i === selectedIndex}
                onMouseEnter={() => setSelected(i)}
                onMouseDown={(e) => { e.preventDefault(); execute(row) }}
              >
                <div className="sb-cmd-row-main">
                  <span className="sb-cmd-row-label">{row.label}</span>
                  {row.sublabel && <span className="sb-cmd-row-sublabel">{row.sublabel}</span>}
                </div>
              </li>
            ))}
          </ul>
        )}

        <div className="sb-cmd-foot">
          <span className="sb-cmd-foot-key"><kbd>↑</kbd><kbd>↓</kbd> navigate</span>
          <span className="sb-cmd-foot-key"><kbd>enter</kbd> open</span>
          <span className="sb-cmd-foot-key"><kbd>esc</kbd> close</span>
        </div>
      </div>
    </div>
  )
}

// =============================================================================
// STYLES
// =============================================================================
// Reference posture: Spotlight + Linear. Calm, restrained, fast.
// Single near-white panel, hairline border, soft shadow. No gradients,
// no glow, no animation beyond a quick fade.

const localStyles = `
  .sb-cmd-overlay {
    position: fixed;
    inset: 0;
    z-index: 9999;
    background: rgba(15, 20, 25, 0.28);
    backdrop-filter: blur(2px);
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding-top: 14vh;
    animation: sb-cmd-fade-in 90ms ease-out;
  }
  @keyframes sb-cmd-fade-in {
    from { opacity: 0; }
    to   { opacity: 1; }
  }

  .sb-cmd-panel {
    width: 100%;
    max-width: 640px;
    background: var(--sb-surface);
    border: 0.5px solid var(--sb-border);
    border-radius: 10px;
    box-shadow:
      0 1px 2px rgba(15, 20, 25, 0.04),
      0 12px 32px rgba(15, 20, 25, 0.12);
    overflow: hidden;
    display: flex;
    flex-direction: column;
    max-height: 72vh;
  }

  .sb-cmd-input-wrap {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 14px 18px;
    border-bottom: 0.5px solid var(--sb-border);
  }
  .sb-cmd-input {
    flex: 1;
    border: none;
    outline: none;
    background: transparent;
    color: var(--sb-text);
    font: inherit;
    font-size: 17px;
    line-height: 1.5;
    padding: 4px 0;
    letter-spacing: -0.005em;
  }
  .sb-cmd-input::placeholder {
    color: var(--sb-text-muted);
    letter-spacing: -0.005em;
  }
  .sb-cmd-foot kbd {
    font-family: var(--sb-font-mono);
    font-size: 11px;
    color: var(--sb-text-muted);
    background: var(--sb-surface-muted);
    border: 0.5px solid var(--sb-border);
    border-radius: 4px;
    padding: 1px 6px;
    line-height: 1.4;
  }

  .sb-cmd-list {
    list-style: none;
    margin: 0;
    padding: 6px 0;
    overflow-y: auto;
    flex: 1;
    min-height: 0;
  }

  .sb-cmd-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 10px 18px;
    cursor: pointer;
    color: var(--sb-text);
    transition: background 0.08s;
  }
  .sb-cmd-row-selected {
    background: var(--sb-surface-muted);
  }
  .sb-cmd-row-main {
    display: flex;
    align-items: baseline;
    gap: 10px;
    flex: 1;
    min-width: 0;
  }
  .sb-cmd-row-label {
    font-size: 15px;
    font-weight: 500;
    color: var(--sb-text);
    letter-spacing: -0.005em;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .sb-cmd-row-sublabel {
    font-size: 13px;
    color: var(--sb-text-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    flex-shrink: 1;
    min-width: 0;
  }
  .sb-cmd-empty {
    padding: 28px 18px 36px;
    color: var(--sb-text-muted);
    font-size: 15px;
    line-height: 1.5;
  }

  .sb-cmd-foot {
    display: flex;
    gap: 18px;
    align-items: center;
    padding: 9px 18px;
    border-top: 0.5px solid var(--sb-border);
    background: var(--sb-bg);
    color: var(--sb-text-muted);
    font-size: 12px;
  }
  .sb-cmd-foot-key {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }

  /* Responsive — phone tightens to viewport edges. */
  @media (max-width: 600px) {
    .sb-cmd-overlay {
      padding-top: 8vh;
      padding-left: 8px;
      padding-right: 8px;
    }
    .sb-cmd-panel { max-height: 80vh; }
    .sb-cmd-input { font-size: 16px; }
    .sb-cmd-foot { display: none; }
  }
`

if (typeof document !== 'undefined' && !document.getElementById('sb-cmd-surface-styles')) {
  const tag = document.createElement('style')
  tag.id = 'sb-cmd-surface-styles'
  tag.textContent = localStyles
  document.head.appendChild(tag)
}
