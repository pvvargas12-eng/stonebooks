// =============================================================================
// 📚 Stonebooks — Global Search Bar
// =============================================================================
// Thin UI layer over the existing W-1 entity index in commandSurface.js.
// `buildResults(query)` already ranks customers + jobs + orders with fuzzy
// matching; each result row carries an `exec` that dispatches the right
// open-* command, which Stonebooks.jsx already routes.
//
// Mounted on Jobs and Scheduler only — the spec is explicit that this
// surface is for triage, not navigation. Today / Calendar / Customers /
// Orders all have their own scoped affordances.
//
// Keyboard:
//   • typing  → live fuzzy results
//   • Esc     → clear + close dropdown
//   • Enter   → execute the top result
//   • ↑ / ↓   → move highlight (basic — no listbox semantics yet)
// =============================================================================

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  refreshEntityIndex,
  buildResults,
} from '../lib/commandSurface'

// Tiny shape mapper — buildResults returns kinds like 'entity-job' /
// 'entity-customer' / 'entity-order'. We render a quiet "type" label so
// the grouping is visible without forcing a multi-section layout.
const KIND_LABEL = {
  'entity-job':      'Job',
  'entity-customer': 'Customer',
  'entity-order':    'Order',
}
const KIND_GROUP_ORDER = ['Customers', 'Jobs', 'Orders']
const KIND_TO_GROUP = {
  'entity-customer': 'Customers',
  'entity-job':      'Jobs',
  'entity-order':    'Orders',
}

export default function SearchBar({ placeholder = 'Search customers, jobs, orders…' }) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [results, setResults] = useState([])
  const [highlight, setHighlight] = useState(0)
  const wrapRef = useRef(null)

  // Refresh the entity index once on mount. Subsequent calls are de-duped
  // inside refreshEntityIndex, so it's cheap to call from multiple search
  // bars mounted on different tabs.
  useEffect(() => {
    refreshEntityIndex().catch(() => { /* silent */ })
  }, [])

  // Recompute on every keystroke. buildResults caps at MAX_RESULTS (10).
  useEffect(() => {
    if (!open) return
    const q = query.trim()
    if (!q) {
      setResults([])
      return
    }
    const rows = buildResults(q).filter(r => r.kind?.startsWith('entity-'))
    setResults(rows)
    setHighlight(0)
  }, [query, open])

  // Close on outside click.
  useEffect(() => {
    if (!open) return
    const handler = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  // Group results by type. The result list comes back already ranked across
  // types; we preserve that ranking inside each group so the most-relevant
  // hit per type sits at the top. Within a group, sort is implicit by
  // score order from buildResults.
  const groupedResults = useMemo(() => {
    const map = new Map()
    for (const r of results) {
      const g = KIND_TO_GROUP[r.kind] || 'Other'
      if (!map.has(g)) map.set(g, [])
      map.get(g).push(r)
    }
    return KIND_GROUP_ORDER
      .filter(g => map.has(g))
      .map(g => ({ group: g, rows: map.get(g) }))
  }, [results])

  const flatResults = useMemo(
    () => groupedResults.flatMap(g => g.rows),
    [groupedResults],
  )

  const handleKey = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      setQuery('')
      setOpen(false)
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlight(h => Math.min(h + 1, Math.max(0, flatResults.length - 1)))
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlight(h => Math.max(0, h - 1))
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      const target = flatResults[highlight]
      if (target?.exec) {
        target.exec()
        setOpen(false)
        setQuery('')
      }
    }
  }

  const handleSelect = (r) => {
    r.exec?.()
    setOpen(false)
    setQuery('')
  }

  const showDropdown = open && query.trim().length > 0
  const showEmptyState = showDropdown && flatResults.length === 0

  // Running flat-index counter so each row can compare against highlight
  // when rendering across grouped sections.
  let runningIdx = -1

  return (
    <div className="sb-search" ref={wrapRef}>
      <input
        type="text"
        className="sb-search-input"
        placeholder={placeholder}
        value={query}
        onChange={e => { setQuery(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKey}
      />
      {query && (
        <button
          type="button"
          className="sb-search-clear"
          onClick={() => { setQuery(''); setOpen(false) }}
          aria-label="Clear search"
        >
          ×
        </button>
      )}

      {showDropdown && (
        <div className="sb-search-dropdown">
          {showEmptyState && (
            <div className="sb-search-empty">No matches for "{query.trim()}".</div>
          )}
          {groupedResults.map(({ group, rows }) => (
            <div key={group} className="sb-search-group">
              <div className="sb-search-group-label">{group}</div>
              {rows.map(r => {
                runningIdx += 1
                const isHi = runningIdx === highlight
                return (
                  <button
                    key={r.id}
                    type="button"
                    className={`sb-search-row ${isHi ? 'sb-search-row-hi' : ''}`}
                    onClick={() => handleSelect(r)}
                    onMouseEnter={() => setHighlight(runningIdx)}
                  >
                    <span className="sb-search-row-label">{r.label}</span>
                    {r.sublabel && (
                      <span className="sb-search-row-sub">{r.sublabel}</span>
                    )}
                    <span className="sb-search-row-kind">{KIND_LABEL[r.kind] || ''}</span>
                  </button>
                )
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// =============================================================================
// STYLES
// =============================================================================

const localStyles = `
  .sb-search {
    position: relative;
    width: 100%;
    max-width: 480px;
  }
  .sb-search-input {
    width: 100%;
    font: inherit;
    font-size: 14px;
    padding: 10px 36px 10px 14px;
    border: 0.5px solid var(--sb-border);
    border-radius: var(--sb-r-sm, 6px);
    background: var(--sb-surface);
    color: var(--sb-text);
  }
  .sb-search-input::placeholder {
    color: var(--sb-text-muted);
  }
  .sb-search-input:focus {
    outline: none;
    border-color: var(--sb-accent, #b8842a);
    box-shadow: 0 0 0 2px var(--sb-accent-bg, rgba(184, 132, 42, 0.15));
  }
  .sb-search-clear {
    position: absolute;
    right: 6px;
    top: 50%;
    transform: translateY(-50%);
    width: 24px;
    height: 24px;
    background: transparent;
    border: none;
    border-radius: 999px;
    color: var(--sb-text-muted);
    font-size: 18px;
    line-height: 1;
    cursor: pointer;
    padding: 0;
  }
  .sb-search-clear:hover {
    background: var(--sb-surface-muted);
    color: var(--sb-text);
  }

  .sb-search-dropdown {
    position: absolute;
    top: calc(100% + 6px);
    left: 0;
    right: 0;
    z-index: 50;
    max-height: 420px;
    overflow-y: auto;
    background: var(--sb-surface);
    border: 0.5px solid var(--sb-border);
    border-radius: var(--sb-r-sm, 6px);
    box-shadow: 0 8px 24px rgba(15, 20, 25, 0.12);
  }
  .sb-search-empty {
    padding: 14px 16px;
    font-size: 13px;
    color: var(--sb-text-muted);
    font-style: italic;
  }
  .sb-search-group {
    display: flex;
    flex-direction: column;
    border-bottom: 0.5px solid var(--sb-border);
  }
  .sb-search-group:last-child {
    border-bottom: none;
  }
  .sb-search-group-label {
    font-size: 10px;
    font-weight: 500;
    color: var(--sb-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    padding: 8px 14px 4px;
  }
  .sb-search-row {
    display: flex;
    align-items: baseline;
    gap: 10px;
    padding: 8px 14px;
    background: transparent;
    border: none;
    text-align: left;
    cursor: pointer;
    font: inherit;
    color: inherit;
    width: 100%;
  }
  .sb-search-row:hover,
  .sb-search-row-hi {
    background: var(--sb-surface-muted);
  }
  .sb-search-row-label {
    font-size: 13px;
    font-weight: 500;
    color: var(--sb-text);
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .sb-search-row-sub {
    font-size: 11px;
    color: var(--sb-text-muted);
    white-space: nowrap;
  }
  .sb-search-row-kind {
    font-size: 10px;
    font-weight: 500;
    color: var(--sb-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    white-space: nowrap;
  }
`

if (typeof document !== 'undefined' && !document.getElementById('sb-search-styles')) {
  const tag = document.createElement('style')
  tag.id = 'sb-search-styles'
  tag.textContent = localStyles
  document.head.appendChild(tag)
}
