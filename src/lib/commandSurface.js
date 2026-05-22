// =============================================================================
// 📚 Stonebooks — Command Surface (W-0 + W-1)
// =============================================================================
// The substrate the Operational Workspace v2 transition stands on. Provides:
//
//   • The command bus — a tiny event emitter for sb:cmd events that the app
//     shell consumes to route navigation / entity-opening / sales-wizard.
//
//   • The entity index — an in-memory searchable record of customers, jobs,
//     and orders. Built once on app mount, refreshed lazily.
//
//   • The action registry — named operations the Command Surface can invoke
//     ("New sale", "Open Today", "Stones queue", etc.). Modules register
//     actions; the surface enumerates them.
//
//   • The saved-query registry — operational lenses addressable by phrase
//     ("stones", "layouts", "production", "waiting").
//
//   • Fuzzy matching — substring + subsequence + initials scoring. Calm
//     ranking: exact matches first, partials after, recency as a tiebreak.
//
//   • Time-phrase parsing — "today", "tomorrow", "thursday", "this week",
//     "next week". Returns a structured date/range the (future) time-lens
//     will consume; W-1 currently routes time queries to the Calendar tab.
//
// Public surface is plain functions — no React, no DOM, no globals beyond
// the in-module registry. The CommandSurface component imports from here
// and calls the dispatch functions.
//
// This file is intentionally framework-light: it could be lifted into a
// worker or a SSR build without modification.
// =============================================================================

import {
  listAllOrders,
  getJobs,
  customerName,
  statusInfo,
} from './stonebooksData.js'

// =============================================================================
// COMMAND BUS — events the app shell consumes to act on operator intent
// =============================================================================
//
// The Command Surface dispatches structured commands via `dispatchCommand`.
// Stonebooks.jsx listens for `sb:cmd` events on window and routes the kind
// to the existing nav / drill-in mechanisms. Designing the API as events
// (rather than direct props) lets later phases extract the Command Surface
// from the app shell without rewiring.
//
// Command kinds in W-1:
//   { kind: 'open-tab',      tab }                — navigate to a tab
//   { kind: 'open-job',      id, label? }         — open a specific job
//   { kind: 'open-customer', id, label? }         — open a customer
//   { kind: 'open-order',    id, label? }         — open the sales wizard
//   { kind: 'open-sales' }                        — new sale (no order)
//   { kind: 'open-queue',    queue }              — open a queue
//   { kind: 'time-query',    when }               — time lens (W-1: nav to calendar)

const SB_CMD_EVENT = 'sb:cmd'

export function dispatchCommand(detail) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(SB_CMD_EVENT, { detail }))
}

export function subscribeCommand(handler) {
  if (typeof window === 'undefined') return () => {}
  const wrapped = (e) => handler(e.detail)
  window.addEventListener(SB_CMD_EVENT, wrapped)
  return () => window.removeEventListener(SB_CMD_EVENT, wrapped)
}

// =============================================================================
// ENTITY INDEX — in-memory searchable record of operationally interesting rows
// =============================================================================
//
// Built once on app mount via `refreshEntityIndex`. Subsequent reads via
// `getEntityIndex` return the cached snapshot. For Stonebooks' scale
// (hundreds of customers, low thousands of jobs over years), one in-memory
// index is sufficient indefinitely.
//
// Each indexed record carries:
//   type        — 'job' | 'customer' | 'order' | 'supplier' | 'cemetery'
//   id          — the underlying row id (for routing)
//   label       — primary search text (customer surname, order number, etc.)
//   sublabel?   — quiet secondary text (cemetery, status, etc.)
//   searchText  — denormalized lowercase concat for fuzzy match
//   recencyHint? — last_update_at or similar (used to break ranking ties)
//
// Suppliers / cemeteries are first-class entity types in the schema but are
// not populated by W-0 (no canonical entity table for suppliers yet, and
// cemeteries are read only through joins). The slots are reserved so later
// phases can populate them without changing the public API.

let _index = {
  jobs:       [],
  customers:  [],
  orders:     [],
  suppliers:  [],     // reserved for later phase
  cemeteries: [],     // reserved for later phase
  builtAt:    0,
}
let _refreshPromise = null

export function getEntityIndex() {
  return _index
}

// Lookup a single indexed entity by (type, id). Returns the record (label,
// sublabel, searchText, recencyHint) or null if not yet indexed. W-2's
// workpiece activation calls this to populate the chip label without
// blocking on a fetch — when the index hasn't refreshed yet, callers fall
// back to a placeholder ("Job abc12345") which the next refresh upgrades.
export function lookupEntityRecord(type, id) {
  if (!type || !id) return null
  const bucket =
    type === 'job'      ? _index.jobs :
    type === 'customer' ? _index.customers :
    type === 'order'    ? _index.orders : null
  if (!bucket) return null
  return bucket.find(e => e.id === id) || null
}

export async function refreshEntityIndex({ force = false } = {}) {
  // De-dupe concurrent refresh requests
  if (_refreshPromise && !force) return _refreshPromise
  _refreshPromise = (async () => {
    try {
      const [orders, jobs] = await Promise.all([
        listAllOrders({ limit: 500 }),
        getJobs({ includeClosed: false, limit: 500 }),
      ])

      // Build customer records by deduping from orders (which carry the
      // customer join). One indexed customer per unique customer_id.
      const seenCustomers = new Map()
      for (const o of orders) {
        const c = o.customer
        if (!c || !c.id) continue
        if (seenCustomers.has(c.id)) continue
        const name = customerName(c) || c.last_name || ''
        if (!name.trim()) continue
        seenCustomers.set(c.id, {
          type: 'customer',
          id: c.id,
          label: name,
          sublabel: c.phone || c.email || null,
          searchText: `${name} ${c.phone || ''} ${c.email || ''}`.toLowerCase(),
          recencyHint: o.updated_at || null,
        })
      }

      // Orders — searchable by order number, customer name, status.
      // Status renders via statusInfo.label (e.g. "Paid in full") so the raw
      // enum code never leaks into the operator-facing sublabel.
      const orderRecords = orders.map(o => {
        const cn = customerName(o.customer)
        const num = o.order_number || ''
        const statusLabel = o.status ? (statusInfo(o.status)?.label || o.status) : null
        return {
          type: 'order',
          id: o.id,
          label: cn ? `${cn} — #${num || o.id.slice(0, 8)}` : `Order #${num || o.id.slice(0, 8)}`,
          sublabel: statusLabel,
          searchText: `${cn} ${num} ${statusLabel || ''}`.toLowerCase(),
          recencyHint: o.updated_at || null,
        }
      })

      // Jobs — searchable by customer surname (the primary operator handle).
      // Sub-label is the cemetery name when available.
      const jobRecords = (jobs || []).map(j => {
        const cn = customerName(j.customer) || j.order?.primary_lastname || ''
        const cemetery = j.cemetery?.name || null
        const orderNum = j.order?.order_number || ''
        return {
          type: 'job',
          id: j.id,
          label: cn ? `${cn} — job` : `Job ${j.id.slice(0, 8)}`,
          sublabel: cemetery
            ? (orderNum ? `${cemetery} · #${orderNum}` : cemetery)
            : (orderNum ? `#${orderNum}` : null),
          searchText: `${cn} ${orderNum} ${cemetery || ''} ${j.overall_status || ''}`.toLowerCase(),
          recencyHint: j.last_update_at || null,
        }
      })

      _index = {
        jobs:       jobRecords,
        customers:  Array.from(seenCustomers.values()),
        orders:     orderRecords,
        suppliers:  [],
        cemeteries: [],
        builtAt:    Date.now(),
      }
      return _index
    } finally {
      _refreshPromise = null
    }
  })()
  return _refreshPromise
}

// =============================================================================
// ACTION REGISTRY — named operations invocable by phrase
// =============================================================================
//
// Modules register actions via `registerAction`. Each action carries:
//   id:      stable string
//   phrases: array of phrases the operator might type
//   label:   short sentence-form display ("New sale")
//   sublabel? — quiet secondary text ("Start the sales wizard")
//   handler: () => void — what to do when invoked
//
// The action registry is module-singleton state; `registerDefaultActions`
// (below) populates it on first import. Re-registration is a no-op for the
// same id (idempotent).

const _actions = new Map()

export function registerAction(action) {
  if (!action || !action.id) return
  _actions.set(action.id, action)
}

export function listActions() {
  return Array.from(_actions.values())
}

// =============================================================================
// SAVED-QUERY REGISTRY — operational lenses addressable by phrase
// =============================================================================
//
// Saved queries are command-surface entries that, when invoked, take the
// operator to a queue or filtered view. W-1 surfaces the four existing
// queues; later phases add ad-hoc queries (jobs at risk, drafts over 30d).

const _queries = new Map()

export function registerQuery(query) {
  if (!query || !query.id) return
  _queries.set(query.id, query)
}

export function listQueries() {
  return Array.from(_queries.values())
}

// =============================================================================
// TIME-PHRASE PARSING
// =============================================================================
//
// Returns one of:
//   null                                — no time phrase recognized
//   { label, kind: 'date',  date }      — single date (today, tomorrow, thursday)
//   { label, kind: 'range', start, end} — date range (this week, next week)
//
// The Command Surface renders the recognized time as a result row. Selecting
// it dispatches a time-query command. W-1 routes time queries to the
// Calendar tab; W-5 will replace this with a true time-lens.

const WEEKDAYS = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday']

export function parseTimePhrase(input) {
  if (!input) return null
  const q = input.trim().toLowerCase()
  if (!q) return null

  const now = new Date()
  const today = startOfDay(now)

  if (q === 'today')     return { label: 'Today',     kind: 'date',  date: today }
  if (q === 'tomorrow')  return { label: 'Tomorrow',  kind: 'date',  date: addDays(today, 1) }
  if (q === 'yesterday') return { label: 'Yesterday', kind: 'date',  date: addDays(today, -1) }

  if (q === 'this week') {
    const monday = startOfWeek(today)
    return { label: 'This week', kind: 'range', start: monday, end: addDays(monday, 6) }
  }
  if (q === 'next week') {
    const monday = addDays(startOfWeek(today), 7)
    return { label: 'Next week', kind: 'range', start: monday, end: addDays(monday, 6) }
  }
  if (q === 'last week') {
    const monday = addDays(startOfWeek(today), -7)
    return { label: 'Last week', kind: 'range', start: monday, end: addDays(monday, 6) }
  }

  // Weekday names → next occurrence (today if matches today, else next).
  const idx = WEEKDAYS.indexOf(q)
  if (idx >= 0) {
    const todayIdx = today.getDay()
    const delta = idx >= todayIdx ? idx - todayIdx : 7 - (todayIdx - idx)
    const date = addDays(today, delta)
    return {
      label: delta === 0 ? `${cap(q)} (today)` : delta === 1 ? `${cap(q)} (tomorrow)` : cap(q),
      kind: 'date',
      date,
    }
  }
  return null
}

function startOfDay(d) {
  const x = new Date(d); x.setHours(0, 0, 0, 0); return x
}
function addDays(d, n) {
  return new Date(d.getTime() + n * 86400000)
}
function startOfWeek(d) {
  // Monday-anchored week (ISO convention).
  const x = startOfDay(d)
  const day = x.getDay()
  const delta = day === 0 ? -6 : 1 - day
  return addDays(x, delta)
}
function cap(s) { return s ? s[0].toUpperCase() + s.slice(1) : s }

// =============================================================================
// SEARCH / RANKING
// =============================================================================
//
// Given the typed query and the current entity index + registries, produces
// a ranked list of result rows the surface renders. Each result row:
//   { id, kind, label, sublabel?, badge?, score, exec }
//   - kind: 'entity-job' | 'entity-customer' | 'entity-order' |
//           'action' | 'query' | 'time'
//   - exec: () => void  — what to do on Enter
//
// Ranking is deliberately simple — fuzzy substring + initials + subsequence
// scoring blended with entity-type prior + recency tiebreak. Order of magnitude
// tuned by hand; refine as adoption produces data.

const MAX_RESULTS = 10

// W-5 flag — flipped to true when the time-lens consumer is wired. Until
// then, parsing time phrases is still supported (the parser ships now so
// the public API is stable) but time-query results are suppressed so the
// operator never types a phrase that silently no-ops on the Calendar tab.
const TIME_LENS_AVAILABLE = false

export function buildResults(query, { recents = [] } = {}) {
  const q = (query || '').trim()
  if (!q) {
    // Empty state — show recents + a few hero actions.
    return emptyStateResults(recents)
  }

  const candidates = []
  const lowQ = q.toLowerCase()
  const index = getEntityIndex()

  // Entities — the underlying record is preserved as `entity` for W-2
  // workpiece consumers; today's overlay only reads label/sublabel/kind.
  for (const arr of [index.jobs, index.customers, index.orders]) {
    for (const e of arr) {
      const score = fuzzyScore(e.searchText, lowQ)
      if (score <= 0) continue
      candidates.push({
        id: `${e.type}-${e.id}`,
        kind: `entity-${e.type}`,
        label: e.label,
        sublabel: e.sublabel,
        entity: e,
        score: score + entityPrior(e.type) + recencyBonus(e.recencyHint),
        exec: () => execEntityOpen(e),
      })
    }
  }

  // Actions — phrase-scored stricter (substring + initials only, no
  // subsequence) so short queries like "new" don't sprinkle every action
  // into the result list at low score.
  for (const a of listActions()) {
    const phraseHit = bestActionPhraseScore(a.phrases || [], lowQ)
    if (phraseHit <= 0) continue
    candidates.push({
      id: `action-${a.id}`,
      kind: 'action',
      label: a.label,
      sublabel: a.sublabel,
      score: phraseHit + 5, // small bias toward action matches over partial entity matches
      exec: () => { try { a.handler() } finally { /* no-op */ } },
    })
  }

  // Saved queries — same stricter phrase scoring as actions.
  for (const sq of listQueries()) {
    const phraseHit = bestActionPhraseScore(sq.phrases || [], lowQ)
    if (phraseHit <= 0) continue
    candidates.push({
      id: `query-${sq.id}`,
      kind: 'query',
      label: sq.label,
      sublabel: sq.sublabel,
      score: phraseHit + 8,
      exec: () => { try { sq.handler() } finally { /* no-op */ } },
    })
  }

  // Time phrases — gated. parseTimePhrase still ships in W-1 (the time-lens
  // engine in W-5 will consume it), but emitting time-query results today
  // silently no-ops on the Calendar tab and trains the operator to distrust
  // the surface. Keep the function; suppress the result until W-5 wires a
  // consumer that honors the structured `when` payload.
  // Re-enable by flipping TIME_LENS_AVAILABLE to true in W-5.
  if (TIME_LENS_AVAILABLE) {
    const t = parseTimePhrase(lowQ)
    if (t) {
      candidates.push({
        id: 'time',
        kind: 'time',
        label: t.label,
        sublabel: null,
        score: 150,
        exec: () => execTimeQuery(t),
      })
    }
  }

  candidates.sort((a, b) => b.score - a.score)
  return candidates.slice(0, MAX_RESULTS)
}

function emptyStateResults(recents) {
  const out = []
  for (const r of recents.slice(0, 5)) {
    out.push({
      id: `recent-${r.type}-${r.id}`,
      kind: `entity-${r.type}`,
      label: r.label,
      sublabel: r.sublabel,
      entity: r,
      score: 0,
      exec: () => execEntityOpen(r),
    })
  }
  // Always offer a few hero actions in the empty state. Direct lookups by
  // action id — keeps the discovery flow brittle-free if action ids change.
  for (const id of ['new-sale', 'open-today', 'open-calendar']) {
    const a = _actions.get(id)
    if (!a) continue
    out.push({
      id: `action-${a.id}`,
      kind: 'action',
      label: a.label,
      sublabel: a.sublabel,
      score: 0,
      exec: () => a.handler(),
    })
  }
  return out
}

function execEntityOpen(entity) {
  if (entity.type === 'job')      dispatchCommand({ kind: 'open-job',      id: entity.id, label: entity.label })
  else if (entity.type === 'customer') dispatchCommand({ kind: 'open-customer', id: entity.id, label: entity.label })
  else if (entity.type === 'order')    dispatchCommand({ kind: 'open-order',    id: entity.id, label: entity.label })
}

function execTimeQuery(t) {
  // W-1: time queries route to Calendar (the only existing time-aware
  // surface). W-5 will introduce the true time-lens which consumes the
  // structured payload.
  dispatchCommand({ kind: 'time-query', when: t })
}

// =============================================================================
// FUZZY MATCHING
// =============================================================================
//
// Score model (all values in the same arbitrary unit so they can be summed):
//   • Exact substring match           → 100 + position penalty
//   • Initials match (multi-word)     → 60
//   • Subsequence match (loose)       → 30 (proportional to coverage)
//   • Otherwise                       → 0 (filtered out)
//
// Position penalty: substring matches at index 0 score full, at index N
// lose N/2 points (so "patel install" with q="install" still scores well,
// but exact-prefix wins for short queries).

export function fuzzyScore(text, query) {
  if (!text || !query) return 0
  const t = text.toLowerCase()
  const q = query.toLowerCase()

  // Exact substring — strongest signal.
  const idx = t.indexOf(q)
  if (idx >= 0) {
    return Math.max(0, 100 - Math.min(idx, 30) * 1.5)
  }

  // Initials — for multi-word labels like "Holy Cross Cemetery", "hcc" hits.
  const initials = t.split(/\s+/).map(w => w[0]).filter(Boolean).join('')
  if (initials.includes(q)) return 60

  // Subsequence — q's characters appear in t in order.
  let i = 0
  for (let j = 0; j < t.length && i < q.length; j++) {
    if (t[j] === q[i]) i++
  }
  if (i === q.length) {
    // Coverage: how much of t we walked through to consume all of q.
    return Math.max(0, 30 - (t.length - q.length) * 0.1)
  }
  return 0
}

// Generic phrase scoring — includes subsequence. Suitable for entity search
// where loose matches still help.
function bestPhraseScore(phrases, query) {
  let best = 0
  for (const p of phrases) {
    const s = fuzzyScore(p, query)
    if (s > best) best = s
  }
  return best
}

// Stricter scoring for action / saved-query phrases. Substring + initials
// only — subsequence matches are too noisy for short queries against the
// global action vocabulary (e.g. "new" would weakly match "open-today").
function bestActionPhraseScore(phrases, query) {
  let best = 0
  for (const p of phrases) {
    const t = (p || '').toLowerCase()
    const idx = t.indexOf(query)
    if (idx >= 0) {
      const s = Math.max(0, 100 - Math.min(idx, 30) * 1.5)
      if (s > best) best = s
      continue
    }
    const initials = t.split(/\s+/).map(w => w[0]).filter(Boolean).join('')
    if (initials.includes(query)) {
      if (60 > best) best = 60
    }
  }
  return best
}

function entityPrior(type) {
  // Walk-in bias — when an operator types a surname, the most common
  // intent is "find the family record." Customer-first with small deltas
  // so a strong job/order match still surfaces above a partial customer.
  if (type === 'customer') return 6
  if (type === 'job')      return 5
  if (type === 'order')    return 4
  return 0
}

function recencyBonus(iso) {
  if (!iso) return 0
  const days = (Date.now() - new Date(iso).getTime()) / 86400000
  if (days < 1)   return 12
  if (days < 7)   return 8
  if (days < 30)  return 4
  return 0
}

// =============================================================================
// DEFAULT ACTIONS + DEFAULT QUERIES
// =============================================================================
//
// Registered on first import. Idempotent — re-registration is a no-op for
// the same id. Modules can register additional actions/queries via the
// registerAction / registerQuery functions; W-1 ships only the defaults.

function registerDefaults() {
  // ── Tab navigation ──
  const navAction = (id, label, tab, phrases) => registerAction({
    id,
    label,
    phrases,
    handler: () => dispatchCommand({ kind: 'open-tab', tab }),
  })
  navAction('open-today',     'Open Today',     'today',     ['today', 'open today', 'briefing'])
  navAction('open-jobs',      'Open Jobs',      'jobs',      ['jobs', 'open jobs', 'all jobs'])
  navAction('open-customers', 'Open Customers', 'customers', ['customers', 'open customers'])
  navAction('open-orders',    'Open Orders',    'orders',    ['orders', 'open orders'])
  navAction('open-calendar',  'Open Calendar',  'calendar',  ['calendar', 'schedule', 'open calendar'])
  navAction('open-reports',   'Open Reports',   'reports',   ['reports', 'analytics', 'open reports'])
  navAction('open-settings',  'Open Settings',  'settings',  ['settings', 'preferences'])

  // ── Sales / new ──
  registerAction({
    id: 'new-sale',
    label: 'New sale',
    sublabel: 'Start the sales wizard',
    phrases: ['new sale', 'new order', 'new', 'start sale', 'add sale'],
    handler: () => dispatchCommand({ kind: 'open-sales' }),
  })

  // ── Saved queries — the operational queues ──
  const queueQuery = (id, label, queue, phrases, sublabel) => registerQuery({
    id,
    label,
    sublabel,
    phrases,
    handler: () => dispatchCommand({ kind: 'open-queue', queue }),
  })
  queueQuery('stones',     'Stones queue',          'stones',
    ['stones', 'stone queue', 'suppliers', 'stone'],
    'Stones in flight — ordered, received, blocked')
  queueQuery('layouts',    'Layouts queue',         'layouts',
    ['layouts', 'layout queue', 'designs', 'drawing'],
    'Layouts in flight — drawing, awaiting approval')
  queueQuery('production', 'Production queue',      'production',
    ['production', 'carving', 'shop floor'],
    'Production in flight — stencil, carving, ready')
  queueQuery('waiting',    'Waiting on customer',   'waiting',
    ['waiting', 'waiting on customer', 'follow up'],
    'Jobs waiting on a customer response')
}

registerDefaults()
