// =============================================================================
// 📚 Stonebooks — Team roster
// =============================================================================
// Single source of truth for the team members who appear in promise-by
// pickers, batch assigned-to pickers, and the per-person rolling promise
// counters. Order in this array drives the order in dropdowns; Cathy first
// because she is the default promise-maker on jobs at this shop.
// =============================================================================

export const TEAM_ROSTER = [
  'Cathy',
  'Lonnie',
  'Chelsea',
  'Sabina',
  'Paul',
  'Collin',
  'Denise',
  'Alex',
  'Bill',
  'Maria',
]

// Default selection on the "Mark as promised" picker. Cathy answers the
// phone and books most of the customer-facing promises that land in the
// queue, so it's the right default.
export const DEFAULT_PROMISE_MAKER = 'Cathy'
