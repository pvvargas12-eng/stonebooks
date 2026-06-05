// =============================================================================
// dataCache — tiny cross-mount cache so re-opening a tab doesn't refetch from
// scratch. A module-level Map survives component unmount (the CRM renders tabs
// as `{tab === x && <Tab/>}`, which unmounts on every switch). Opt-in per fetch
// via cachedFetch; entries carry a timestamp for stale-while-revalidate.
//
// NOT a global store / rearchitecture — it's a thin memo wrapper a tab's
// existing load can adopt. Callers invalidate on save so it never serves stale
// data, and the TTL bounds cross-tab staleness from edits made elsewhere.
// =============================================================================

const store = new Map()        // key -> { data, ts, inFlight }
const DEFAULT_TTL = 60_000     // ms — fresh window; older entries refetch

// Returns cached data instantly when fresh; de-dupes concurrent calls; otherwise
// runs the fetcher and caches the result. On fetch error the previous cached
// value (if any) is retained and the error is rethrown for the caller to handle.
export function cachedFetch(key, fetcher, ttl = DEFAULT_TTL) {
  const e = store.get(key)
  if (e && e.data !== undefined && (Date.now() - e.ts) < ttl) return Promise.resolve(e.data)
  if (e && e.inFlight) return e.inFlight
  const inFlight = Promise.resolve().then(fetcher)
  inFlight.then(
    (data) => { store.set(key, { data, ts: Date.now() }) },
    () => { const cur = store.get(key); if (cur && cur.inFlight === inFlight) store.set(key, { data: cur.data, ts: cur.ts ?? 0 }) },
  )
  store.set(key, { data: e?.data, ts: e?.ts ?? 0, inFlight })
  return inFlight
}

// Synchronous read of whatever is cached (no fetch). undefined when absent —
// used to seed a tab's initial state so a cached re-entry renders instantly.
export function peekCache(key) {
  return store.get(key)?.data
}

// Drop entries. With a prefix, drops every key that starts with it (e.g.
// 'orders:board' clears all archive-view variants). No arg clears everything.
export function invalidateCache(prefix) {
  if (!prefix) { store.clear(); return }
  for (const k of [...store.keys()]) if (k.startsWith(prefix)) store.delete(k)
}
