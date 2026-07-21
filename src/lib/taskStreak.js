// =============================================================================
// Task streak easter egg (Paul, 2026-07-21)
// =============================================================================
// "If you in one sitting assign 3 tasks I want different funny captions to
// come up... if she does 5 or more I want one of the photos to pop up,
// random, different every time."
//
// Per-DEVICE sitting counter in localStorage; a sitting ends after 45 quiet
// minutes. Tasks 3-4 fire a caption toast; task 5+ fires a poster popup.
// Captions and posters both rotate through a shuffled order so nothing
// repeats until the pool runs dry (then reshuffles, never repeating the
// last one back-to-back). Pure fun, zero data writes: the ONLY consumer
// signal is a window CustomEvent('sb-task-streak') that the desktop shell
// and FieldApp both listen for. If localStorage is unavailable the whole
// thing silently does nothing — the egg must never break tasking.
// =============================================================================

const KEY = 'sb_task_streak_v1'
const IDLE_RESET_MS = 45 * 60 * 1000

// Task 3 is always the coronation line; the rest shuffle.
const OPENER = 'Task Master engaged.'
const CAPTIONS = [
  'Delegation level: Expert.',
  'HR has been notified.',
  'Easy there, manager.',
  'That escalated quickly.',
  'Chelsea approves this workload.',
  'Somewhere, Chelsea is smiling.',
  'Achievement unlocked: Professional Delegator.',
  'Productivity intensifies.',
  'Inbox anxiety increased by 12%.',
]

// Vite serves public/ at the site root; loaded only when a popup fires.
const PHOTOS = [
  '/easter/streak-queen.webp',
  '/easter/streak-overlord.webp',
  '/easter/streak-pilot.webp',
]

function _load() {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}
function _save(s) {
  try { localStorage.setItem(KEY, JSON.stringify(s)) } catch { /* egg stays quiet */ }
}
function _shuffled(n, avoidFirst = -1) {
  const a = Array.from({ length: n }, (_, i) => i)
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  // Never let a reshuffle serve the same item twice in a row.
  if (a.length > 1 && a[0] === avoidFirst) [a[0], a[1]] = [a[1], a[0]]
  return a
}
function _fresh() {
  return {
    count: 0, last: 0,
    capOrder: _shuffled(CAPTIONS.length), capIdx: 0,
    photoOrder: _shuffled(PHOTOS.length), photoIdx: 0,
  }
}
function _nextCaption(s) {
  if (s.capIdx >= s.capOrder.length) {
    s.capOrder = _shuffled(CAPTIONS.length, s.capOrder[s.capOrder.length - 1])
    s.capIdx = 0
  }
  return CAPTIONS[s.capOrder[s.capIdx++]]
}
function _nextPhoto(s) {
  if (s.photoIdx >= s.photoOrder.length) {
    s.photoOrder = _shuffled(PHOTOS.length, s.photoOrder[s.photoOrder.length - 1])
    s.photoIdx = 0
  }
  return PHOTOS[s.photoOrder[s.photoIdx++]]
}
function _peekPhoto(s) {
  return s.photoIdx < s.photoOrder.length
    ? PHOTOS[s.photoOrder[s.photoIdx]]
    : null   // about to reshuffle — skip the prefetch, the pool is tiny anyway
}

// Called from addShopTask's success path (the one choke point every task
// assignment in both apps flows through). Fire-and-forget.
export function recordTaskAssigned() {
  if (typeof window === 'undefined') return
  const now = Date.now()
  let s = _load()
  if (!s || typeof s.count !== 'number' || (now - (s.last || 0)) > IDLE_RESET_MS) s = _fresh()
  s.count += 1
  s.last = now

  let detail = null
  if (s.count === 3) {
    detail = { kind: 'caption', text: OPENER, count: s.count }
  } else if (s.count === 4) {
    detail = { kind: 'caption', text: _nextCaption(s), count: s.count }
    // Warm the cache so the 5th task's poster pops instantly.
    const next = _peekPhoto(s)
    if (next) { try { new Image().src = next } catch { /* no-op */ } }
  } else if (s.count >= 5) {
    detail = { kind: 'photo', src: _nextPhoto(s), count: s.count }
  }
  _save(s)
  if (detail) {
    try { window.dispatchEvent(new CustomEvent('sb-task-streak', { detail })) } catch { /* no-op */ }
  }
}
