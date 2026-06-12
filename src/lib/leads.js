// =============================================================================
// leads.js — declarative config + pure helpers for the Leads pipeline view.
// =============================================================================
// A lead is any uncontracted order (status in ESTIMATE_STATUSES) — derived live,
// never a separate record. This module is pure config/helpers (structured to
// become per-tenant data later); no React, no Supabase.
// =============================================================================

// Uncontracted statuses = leads. (Mirrors stonebooksData ESTIMATE_STATUSES;
// duplicated here to keep this module dependency-free.)
export const LEAD_STATUSES = ['draft', 'scoping', 'quoted']
export function isLeadStatus(status) { return LEAD_STATUSES.includes(status) }

// Who's holding the ball. side 'us' renders in red/warning — WE are the
// bottleneck. side 'them' is neutral (customer / external).
export const WAITING_ON_OPTIONS = [
  { code: 'thinking',         label: 'Thinking it over',        side: 'them' },
  { code: 'comparing',        label: 'Comparing prices',        side: 'them' },
  { code: 'reviewing_layout', label: 'Reviewing example layout', side: 'them' },
  { code: 'owes_layout',      label: 'Owes example layout (US)', side: 'us' },
  { code: 'waiting_cemetery', label: 'Waiting on cemetery',     side: 'them' },
  { code: 'never_followed_up', label: 'Never followed up',      side: 'us' },
]
export function waitingOnOption(code) { return WAITING_ON_OPTIONS.find(o => o.code === code) || null }

// Follow-up touch types + next-due presets.
export const FOLLOWUP_TYPES = ['Call', 'Email', 'Text', 'Visit']
export const FOLLOWUP_PRESETS = [
  { label: '3 days', days: 3 },
  { label: '1 week', days: 7 },
  { label: '2 weeks', days: 14 },
]
export const AUTO_CADENCE_DAYS = 5   // first estimate → next_follow_up = +5d

// Lost reasons (learning data).
export const LOST_REASONS = [
  { code: 'price',       label: 'Price' },
  { code: 'elsewhere',   label: 'Went elsewhere' },
  { code: 'not_ready',   label: 'Not ready' },
  { code: 'no_response', label: 'No response' },
  { code: 'other',       label: 'Other' },
]
export function lostReasonLabel(code) { return (LOST_REASONS.find(r => r.code === code)?.label) || code }

// Follow-up urgency for a next_follow_up date (local, no timezone drift).
// 'overdue' (red) · 'today' (amber) · 'future' (neutral) · null (none set).
export function followUpUrgency(nextFollowUp, todayISO) {
  if (!nextFollowUp) return null
  const due = String(nextFollowUp).slice(0, 10)
  const today = todayISO || ''
  if (due < today) return 'overdue'
  if (due === today) return 'today'
  return 'future'
}

// Days between two ISO dates (b - a), floored. Both 'YYYY-MM-DD...' tolerant.
export function daysBetween(aISO, bISO) {
  if (!aISO || !bISO) return null
  const a = new Date(String(aISO).slice(0, 10) + 'T00:00:00')
  const b = new Date(String(bISO).slice(0, 10) + 'T00:00:00')
  if (isNaN(a.getTime()) || isNaN(b.getTime())) return null
  return Math.floor((b - a) / 86400000)
}

// Lead-list filter chips.
export const LEAD_FILTERS = [
  { code: 'all',       label: 'All' },
  { code: 'overdue',   label: 'Overdue' },
  { code: 'today',     label: 'Due today' },
  { code: 'us',        label: 'Waiting on us' },
  { code: 'them',      label: 'Waiting on them' },
  { code: 'lost',      label: 'Lost' },
]
