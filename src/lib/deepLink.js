// =============================================================================
// deepLink.js — "open that tab on THAT sub-view" (SHOP-PULSE, 2026-11-10)
// =============================================================================
// The Dashboard's rows link out (Design hub, Needs Ordering, Foundations,
// Collect balances…). The shell mounts a tab only while it is the open one, so
// the hand-off is a one-shot note: the caller leaves the sub-view it wants,
// the tab's own useState initializer takes it on mount. Module memory only —
// nothing is stored, and a note is consumed the first time it is read.
// =============================================================================
const pending = {}
export const setPendingSub = (tab, sub) => { if (tab && sub) pending[tab] = sub }
export const takePendingSub = (tab) => { const v = pending[tab] || null; delete pending[tab]; return v }
