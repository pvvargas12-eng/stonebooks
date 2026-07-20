// =============================================================================
// fieldTabs.js — the bottom-bar registry, role defaults, per-person resolve
// =============================================================================
// FIELD-7: each person chooses which tabs sit in their bottom bar (saved to
// their employees.field_tabs — the private link pins the person, so the
// layout follows them to any phone). Everything not in the bar is reachable
// from MORE. TODAY is always first and MORE is always last — the anchor and
// the overflow home are not negotiable; the middle is.
export const TAB_REGISTRY = [
  { key: 'today',      label: 'TODAY', locked: 'first' },
  { key: 'tasks',      label: 'TASKS' },
  { key: 'production', label: 'FLOOR' },
  { key: 'jobs',       label: 'JOBS' },
  { key: 'sales',      label: 'SALES', ownerOnly: true },
  { key: 'find',       label: 'FIND' },
  { key: 'more',       label: 'MORE', locked: 'last' },
]
export const MAX_BAR_TABS = 6

const KEYS = new Set(TAB_REGISTRY.map(t => t.key))
const ORDER = Object.fromEntries(TAB_REGISTRY.map((t, i) => [t.key, i]))

export function defaultTabsFor(who) {
  if (who?.isOwner) return ['today', 'tasks', 'jobs', 'sales', 'find', 'more']
  if (who?.department === 'Production' || who?.department === 'Installation') {
    return ['today', 'tasks', 'production', 'jobs', 'more']
  }
  return ['today', 'tasks', 'jobs', 'find', 'more']
}

// Stored prefs -> a safe, ordered bar: known keys only, role-gated, deduped,
// today first / more last, capped. Garbage in the column can never brick the
// nav — worst case the person gets their role default back.
export function resolveTabs(who) {
  const stored = who?.fieldTabs
  if (!Array.isArray(stored) || stored.length === 0) return defaultTabsFor(who)
  const mid = [...new Set(stored)]
    .filter(k => KEYS.has(k) && k !== 'today' && k !== 'more')
    .filter(k => {
      const t = TAB_REGISTRY.find(x => x.key === k)
      return !(t?.ownerOnly && !who?.isOwner)
    })
    .sort((a, b) => ORDER[a] - ORDER[b])
    .slice(0, MAX_BAR_TABS - 2)
  if (mid.length === 0) return defaultTabsFor(who)
  return ['today', ...mid, 'more']
}

// The customizable middle choices for this role (the tab editor's list).
export function editableTabsFor(who) {
  return TAB_REGISTRY.filter(t => !t.locked && !(t.ownerOnly && !who?.isOwner))
}

// Core tabs NOT in this person's bar — MORE surfaces them as its top rows.
export function overflowTabsFor(who) {
  const bar = new Set(resolveTabs(who))
  return TAB_REGISTRY.filter(t => !t.locked && !bar.has(t.key) && !(t.ownerOnly && !who?.isOwner))
}
