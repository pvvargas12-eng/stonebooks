// =============================================================================
// 📚 Stonebooks — Team roster
// =============================================================================
// The team members who appear in promise-by pickers, batch assigned-to
// pickers, and the per-person rolling promise counters. Order in this array
// drives the order in dropdowns.
//
// SOURCE OF TRUTH IS NOW THE employees TABLE (Settings → Staff):
// lib/employees.js overlays this array in place at boot. The hardcoded list
// below is only the pre-auth / offline fallback.
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

// Default selection on the "Mark as promised" picker. Cathy/Catherina answers
// the phone and books most of the customer-facing promises, so she's the
// default — resolved against the live roster (she's 'Catherina' in the
// employees table, 'Cathy' in the fallback list above).
export const DEFAULT_PROMISE_MAKER = 'Cathy'
export function getDefaultPromiseMaker() {
  return TEAM_ROSTER.find(n => n.toLowerCase().startsWith('cath')) || TEAM_ROSTER[0] || DEFAULT_PROMISE_MAKER
}
