// =============================================================================
// 📚 Stonebooks — Workspace state (W-0 partial)
// =============================================================================
// Per-operator local workspace state. W-0 scope: recent-entity tracking
// (drives the empty-state of the Command Surface). Also persists per-user
// view preferences (role lens, hub selection, Jobs view mode).
//
// Schema (current keys are non-destructive — new keys can append without
// breaking existing reads; reads tolerate missing keys with sensible defaults):
//
//   {
//     recents:    [{ type, id, label, sublabel?, openedAt }],   // last 10
//     // Reserved for later phases (not populated yet):
//     timeLens:   null,
//   }
//
// (The W-2 workpiece registry + WorkspaceStrip header chips were removed
// 2026-07 — stale `workpieces`/`focusedKey` keys in stored blobs are ignored.)
//
// All values are scoped per user via the storage key (which embeds the user
// id when available; falls back to a single-tenant key for anonymous reads).
// =============================================================================

const RECENTS_CAP = 10
const STORAGE_KEY_PREFIX = 'sb:workspace:'

function storageKey(userId) {
  return `${STORAGE_KEY_PREFIX}${userId || 'anon'}`
}

function readRaw(userId) {
  try {
    const raw = localStorage.getItem(storageKey(userId))
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return null
    return parsed
  } catch {
    return null
  }
}

function writeRaw(userId, state) {
  try {
    localStorage.setItem(storageKey(userId), JSON.stringify(state))
  } catch {
    // localStorage may be full or unavailable; swallow — workspace state is
    // a convenience, not authoritative.
  }
}

// Defensive default — every consumer reads through this so a missing or
// corrupt blob never throws.
function withDefaults(state) {
  return {
    recents:    Array.isArray(state?.recents) ? state.recents : [],
    timeLens:   state?.timeLens || null,
  }
}

// ─── RECENTS ────────────────────────────────────────────────────────────────

export function getRecentEntities(userId) {
  return withDefaults(readRaw(userId)).recents
}

// Push an entity onto the recents list. Deduped by (type, id) — re-opening
// an existing entity moves it to the top. List is capped at RECENTS_CAP.
export function rememberRecent(userId, entity) {
  if (!entity || !entity.type || !entity.id) return
  const state = withDefaults(readRaw(userId))
  const next = [
    { ...entity, openedAt: Date.now() },
    ...state.recents.filter(r => !(r.type === entity.type && r.id === entity.id)),
  ].slice(0, RECENTS_CAP)
  writeRaw(userId, { ...state, recents: next })
}

export function clearRecents(userId) {
  const state = withDefaults(readRaw(userId))
  writeRaw(userId, { ...state, recents: [] })
}

// ─── ROLE (department lens) ─────────────────────────────────────────────────
// Per-operator selection of which department's view to show on the Jobs tab.
// One of: 'admin' | 'design' | 'sales' | 'production' | 'installation' | 'owner'.
// Not real auth — anyone can switch. Default is 'owner' (stacks all five).

const VALID_ROLES = ['admin', 'design', 'sales', 'production', 'installation', 'owner']

export function getSelectedRole(userId) {
  const raw = readRaw(userId)
  const role = raw?.selectedRole
  return VALID_ROLES.includes(role) ? role : 'owner'
}

export function setSelectedRole(userId, role) {
  if (!VALID_ROLES.includes(role)) return
  const state = withDefaults(readRaw(userId))
  writeRaw(userId, { ...state, selectedRole: role })
}

// ─── OWNER VIEW MODE ────────────────────────────────────────────────────────
// When the selected role is 'owner', the Jobs page can render either a
// curated ten-queue overview ('overview', the default) or the full stack of
// every department ('departments', the legacy view). The choice is persisted
// per-user so the shop owner's preference survives reloads. Values outside
// the valid set fall through to 'overview'.

const VALID_OWNER_MODES = ['overview', 'departments']

export function getOwnerViewMode(userId) {
  const raw = readRaw(userId)
  const mode = raw?.ownerViewMode
  return VALID_OWNER_MODES.includes(mode) ? mode : 'overview'
}

export function setOwnerViewMode(userId, mode) {
  if (!VALID_OWNER_MODES.includes(mode)) return
  const state = withDefaults(readRaw(userId))
  writeRaw(userId, { ...state, ownerViewMode: mode })
}

// ─── JOBS HUB (Phase 1A) ────────────────────────────────────────────────────
// Persists which of the 4 operational hubs the operator was last looking at
// on the Jobs tab (admin / design / production / installation). Distinct
// from `selectedRole` because the role enum also includes 'sales' + 'owner'
// (used by the Today tab + legacy Owner aggregator); the hub set is the
// Phase 1A subset. Default 'admin' — the broadest hub, what someone scans
// first thing in the morning.

// admin/design/production/installation are work-item hubs; workflow/permits
// are the section hubs that re-parent the Workflow queues + Permit command
// center inside the Jobs hub strip.
const VALID_HUBS = ['admin', 'design', 'production', 'installation', 'workflow', 'permits']

export function getSelectedHub(userId) {
  const raw = readRaw(userId)
  const hub = raw?.selectedHub
  return VALID_HUBS.includes(hub) ? hub : 'admin'
}

export function setSelectedHub(userId, hub) {
  if (!VALID_HUBS.includes(hub)) return
  const state = withDefaults(readRaw(userId))
  writeRaw(userId, { ...state, selectedHub: hub })
}

// Jobs view mode — 'hubs' (default, the new 4-hub operational surface) vs
// 'all' (the flat family-first JobsListView preserved from JOBS-RESKIN-PASS).
// Operators can flip back to 'all' when they want to scan every job across
// every hub at once. Persists per user so a preference for the flat view
// survives reloads.

const VALID_JOBS_VIEWS = ['dashboard', 'admin', 'design', 'production', 'installation', 'permits', 'workflow', 'all']

export function getJobsView(userId) {
  const raw = readRaw(userId)
  const mode = raw?.jobsView
  return VALID_JOBS_VIEWS.includes(mode) ? mode : 'dashboard'
}

export function setJobsView(userId, mode) {
  if (!VALID_JOBS_VIEWS.includes(mode)) return
  const state = withDefaults(readRaw(userId))
  writeRaw(userId, { ...state, jobsView: mode })
}

// ─── FUTURE-PHASE STUBS ─────────────────────────────────────────────────────

export function getTimeLens(userId) {
  return withDefaults(readRaw(userId)).timeLens
}
