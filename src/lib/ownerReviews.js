// =============================================================================
// Owner reviews — Reports › Monthly review (OWNER-REVIEW-1, 2026-10-30)
// =============================================================================
// Paul: "I want this to be a monthly thing where every single report is
// uploaded and I get an analysis; I want to see growth." The growth numbers
// are derived from the money truths at read time (orders.payments[] in,
// acct_expenses out); this module holds the written reviews (score, headline,
// analysis, where the full report lives) and the statement-coverage rule.
// =============================================================================

import { supabase } from './supabase'

export const REVIEW_SELECT = 'id, kind, period_start, period_end, score, headline, narrative, metrics, report_path, report_url, created_by, created_at, updated_at'

export async function listOwnerReviews() {
  const { data, error } = await supabase.from('owner_reviews')
    .select(REVIEW_SELECT).order('period_start', { ascending: false }).limit(200)
  if (error) { console.warn('[owner-reviews] list:', error.message); return [] }
  return data || []
}

export async function addOwnerReview(row) {
  const { data, error } = await supabase.from('owner_reviews').insert(cleanRow(row)).select(REVIEW_SELECT).single()
  if (error) return { ok: false, error: error.message }
  return { ok: true, row: data }
}

export async function updateOwnerReview(id, patch) {
  const { data, error } = await supabase.from('owner_reviews')
    .update({ ...cleanRow(patch), updated_at: new Date().toISOString() }).eq('id', id).select(REVIEW_SELECT).single()
  if (error) return { ok: false, error: error.message }
  return { ok: true, row: data }
}

export async function deleteOwnerReview(id) {
  const { error } = await supabase.from('owner_reviews').delete().eq('id', id)
  return error ? { ok: false, error: error.message } : { ok: true }
}

function cleanRow(r) {
  const out = {}
  for (const k of ['kind', 'period_start', 'period_end', 'score', 'headline', 'narrative', 'metrics', 'report_path', 'report_url', 'created_by']) {
    if (r[k] !== undefined) out[k] = r[k] === '' ? null : r[k]
  }
  if (out.score != null) out.score = Math.max(0, Math.min(10, Math.round(Number(out.score))))
  return out
}

// ── Periods ──────────────────────────────────────────────────────────────────
const pad = (n) => String(n).padStart(2, '0')
export const monthKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`
export function monthLabel(key, { short = false } = {}) {
  const [y, m] = key.split('-').map(Number)
  const d = new Date(y, m - 1, 1)
  return d.toLocaleDateString('en-US', { month: short ? 'short' : 'long', year: 'numeric' })
}
export function lastMonths(now, n) {
  const out = []
  for (let i = n - 1; i >= 0; i--) out.push(monthKey(new Date(now.getFullYear(), now.getMonth() - i, 1)))
  return out
}
// A review's period from its kind + the start month → ISO start/end days.
export function periodBounds(kind, startMonthKey) {
  const [y, m] = startMonthKey.split('-').map(Number)
  const months = kind === 'year' ? 12 : kind === 'quarter' ? 3 : 1
  const start = new Date(y, m - 1, 1)
  const end = new Date(y, m - 1 + months, 0)
  const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  return { start: iso(start), end: iso(end) }
}
export function periodLabel(r) {
  const s = r.period_start, e = r.period_end
  if (!s) return '—'
  if (r.kind === 'month') return monthLabel(s.slice(0, 7))
  if (r.kind === 'year') return s.slice(0, 4)
  return `${monthLabel(s.slice(0, 7), { short: true })} – ${monthLabel((e || s).slice(0, 7), { short: true })}`
}

// ── Statement coverage ("every single report is uploaded") ───────────────────
// One line per account the shop's money moves through. A document counts for
// an account when its label or filename carries the account's last four.
// Edit this list when an account opens or closes.
export const STATEMENT_ACCOUNTS = [
  { key: '0775', label: 'Chase business (operating 0775 · payroll 0783 · savings 9966)', kind: 'bank' },
  { key: '8957', label: 'Chase · Shiloh Estates 8957', kind: 'bank' },
  { key: '1060', label: 'Capital One Spark 1060', kind: 'card' },
  { key: '8051', label: 'Chase Ink 8051', kind: 'card' },
  { key: '9462', label: 'Chase Prime Visa 9462', kind: 'card' },
  { key: '0745', label: 'Chase United MileagePlus 0745', kind: 'card' },
]
export function statementCoverage(docs, monthKeys) {
  const out = new Map()
  for (const mk of monthKeys) out.set(mk, new Map(STATEMENT_ACCOUNTS.map(a => [a.key, null])))
  for (const d of docs || []) {
    if (!d.month || !(d.kind === 'bank_statement' || d.kind === 'cc_statement')) continue
    const row = out.get(String(d.month).slice(0, 7)); if (!row) continue
    const hay = `${d.label || ''} ${d.filename || ''}`
    for (const a of STATEMENT_ACCOUNTS) if (hay.includes(a.key) && !row.get(a.key)) row.set(a.key, d)
  }
  return out
}

// ── Fixed costs (the nut) ────────────────────────────────────────────────────
// Statement lines carry the audit bucket in ai.bucket; everything else goes by
// its Schedule C category.
const FIXED_BUCKETS = new Set([
  'Payroll', 'Payroll — checks from the payroll account (who?)', 'Mortgage & loans', 'Insurance', 'Taxes',
  'Utilities', 'Software & subscriptions',
])
const FIXED_CATEGORIES = new Set(['wages', 'insurance', 'utilities', 'rent'])
export function isFixedCost(e) {
  const b = e?.ai?.bucket
  if (b) return FIXED_BUCKETS.has(b)
  return FIXED_CATEGORIES.has(e?.category)
}
