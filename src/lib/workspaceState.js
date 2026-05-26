// =============================================================================
// 📚 Stonebooks — Workspace state (W-0 partial)
// =============================================================================
// Per-operator local workspace state. W-0 scope: recent-entity tracking
// (drives the empty-state of the Command Surface). Later phases extend this
// to open workpieces, scroll positions, in-progress unsaved input, time-lens
// state, etc.
//
// Schema (current keys are non-destructive — new keys can append without
// breaking existing reads; reads tolerate missing keys with sensible defaults):
//
//   {
//     recents:    [{ type, id, label, sublabel?, openedAt }],   // last 10
//     workpieces: [{ type, id, label, sublabel?, openedAt, lastFocusedAt }],
//     focusedKey: 'type:id' | null,    // last-focused workpiece, for restoration
//     // Reserved for later phases (not populated yet):
//     timeLens:   null,
//   }
//
// W-2 introduces workpieces + focusedKey. A workpiece is a persisted handle
// to an entity (job, customer) the operator opened. The strip in the shell
// renders one chip per workpiece; the focused chip mirrors the operator's
// current detail view. On app mount, the stored focusedKey is restored so
// "I reopened Stonebooks and my operational context was still alive" holds.
//
// All values are scoped per user via the storage key (which embeds the user
// id when available; falls back to a single-tenant key for anonymous reads).
// =============================================================================

const RECENTS_CAP = 10
const WORKPIECES_CAP = 5       // strict cap — older workpieces fall off silently;
                               // the strip is operational memory, not a tab bar
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
    workpieces: Array.isArray(state?.workpieces) ? state.workpieces : [],
    focusedKey: state?.focusedKey || null,
    timeLens:   state?.timeLens || null,
  }
}

// Composite key — used as the focus identifier and for dedupe.
export function workpieceKey({ type, id }) {
  return `${type}:${id}`
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

// ─── WORKPIECES (W-2) ───────────────────────────────────────────────────────
// A workpiece is a persisted handle to an entity the operator has opened.
// Each workpiece carries its label cached at activation time so the strip
// renders instantly on app mount, before the entity index has refreshed.

export function getWorkpieces(userId) {
  return withDefaults(readRaw(userId)).workpieces
}

export function getStoredFocusedKey(userId) {
  return withDefaults(readRaw(userId)).focusedKey
}

// Add a new workpiece or touch an existing one (move it to the front,
// update its lastFocusedAt). Idempotent on (type, id) — re-activating an
// already-open workpiece does not duplicate; it just updates focus time.
// If a label is passed and the existing workpiece has none, the new label
// is adopted (graceful upgrade as entity-index labels become available).
export function activateWorkpiece(userId, spec) {
  if (!spec || !spec.type || !spec.id) return getWorkpieces(userId)
  const state = withDefaults(readRaw(userId))
  const key = workpieceKey(spec)
  const now = Date.now()

  const existing = state.workpieces.find(w => workpieceKey(w) === key)
  const others   = state.workpieces.filter(w => workpieceKey(w) !== key)

  const next = existing
    ? { ...existing,
        label:    spec.label    || existing.label,
        sublabel: spec.sublabel ?? existing.sublabel,
        lastFocusedAt: now }
    : { type:     spec.type,
        id:       spec.id,
        label:    spec.label    || fallbackLabel(spec.type, spec.id),
        sublabel: spec.sublabel || null,
        openedAt: now,
        lastFocusedAt: now }

  // Most-recently-focused first. Cap is a soft ceiling — older workpieces
  // fall off the strip silently. (Re-opening them via the command surface
  // or list view brings them back.)
  const workpieces = [next, ...others].slice(0, WORKPIECES_CAP)
  writeRaw(userId, { ...state, workpieces, focusedKey: key })
  return workpieces
}

// Remove a workpiece. If it was the focused one, clear focus too — the
// shell consumer should also exit the corresponding detail view so the
// operator isn't left staring at a workpiece-less detail page.
export function closeWorkpiece(userId, spec) {
  const state = withDefaults(readRaw(userId))
  const key   = workpieceKey(spec)
  const workpieces = state.workpieces.filter(w => workpieceKey(w) !== key)
  const focusedKey = state.focusedKey === key ? null : state.focusedKey
  writeRaw(userId, { ...state, workpieces, focusedKey })
  return { workpieces, focusedKey }
}

// Set/clear the focused workpiece without altering the list. Called when
// the shell's tab + selected-id state changes (e.g. operator switches from
// jobs to Today; focus clears).
export function setFocusedKey(userId, key) {
  const state = withDefaults(readRaw(userId))
  if (state.focusedKey === key) return state.workpieces
  writeRaw(userId, { ...state, focusedKey: key })
  return state.workpieces
}

// Best-effort label when one isn't supplied. The strip will show this
// briefly; the entity index will refresh it on a later activation.
function fallbackLabel(type, id) {
  const stub = (id || '').slice(0, 8)
  if (type === 'job')      return `Job ${stub}`
  if (type === 'customer') return `Customer ${stub}`
  if (type === 'order')    return `Order ${stub}`
  return `${type} ${stub}`
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

// ─── FUTURE-PHASE STUBS ─────────────────────────────────────────────────────

export function getTimeLens(userId) {
  return withDefaults(readRaw(userId)).timeLens
}
