// =============================================================================
// meetingData — A/B weeks + Team Meeting data layer (TEAM-MEETING-1, 2026-10-06)
// =============================================================================
// Paul's operating system: Monday+Friday meetings, alternating A (install) /
// B (production) weeks. This module owns the ONE new truth the spec added —
// the COMMITTED week plan (week_plans / week_plan_items) — plus the editable
// meeting shell (meeting_notes). Everything else the Team Meeting tab shows
// derives from the existing stores. Spec: docs/TEAM_MEETING_SPEC.md.
// =============================================================================
import { supabase } from './supabase'
import { getCurrentStaffName, todayISO } from './stonebooksData'

// ── Week math ────────────────────────────────────────────────────────────────
// Anchor: the week of Mon 2026-10-06 is an A (install) week. Weeks alternate
// from there. Flip the anchor here if Paul ever swaps the rhythm.
const ANCHOR_MONDAY = '2026-10-06'
const ANCHOR_KIND = 'install'
const DAY_MS = 86400000

const pad = (n) => String(n).padStart(2, '0')
export const isoOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

// Monday of the week containing `date` (local time).
export function mondayOf(date = new Date()) {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  return d
}
export const addDays = (iso, n) => {
  const [y, m, d] = iso.split('-').map(Number)
  return isoOf(new Date(y, m - 1, d + n))
}

export function weekKindFor(weekStartISO) {
  const a = new Date(ANCHOR_MONDAY + 'T00:00:00')
  const w = new Date(weekStartISO + 'T00:00:00')
  const weeks = Math.round((w.getTime() - a.getTime()) / (7 * DAY_MS))
  const even = ((weeks % 2) + 2) % 2 === 0
  return even ? ANCHOR_KIND : (ANCHOR_KIND === 'install' ? 'production' : 'install')
}
export const weekKindLabel = (kind) =>
  kind === 'install' ? 'A WEEK — INSTALL · FOUNDATIONS · INSCRIPTIONS' : 'B WEEK — STONE PRODUCTION'

export const PLAN_LANES = [
  { code: 'set',         label: 'To be set' },
  { code: 'foundation',  label: 'Foundations to dig / pour' },
  { code: 'inscription', label: 'Inscriptions at the cemetery' },
  { code: 'blast',       label: 'To be blasted' },
]
// Which lanes belong to which sheet (both sheets show every week).
export const SHEET_LANES = {
  install: ['set', 'foundation', 'inscription'],
  production: ['blast'],
}

// ── Week plans ───────────────────────────────────────────────────────────────
export async function getOrCreateWeekPlan(weekStartISO) {
  const { data: existing, error } = await supabase
    .from('week_plans').select('*').eq('week_start', weekStartISO).maybeSingle()
  if (error) return { ok: false, error: error.message }
  if (existing) return { ok: true, plan: existing, created: false }
  const created_by = await getCurrentStaffName().catch(() => null)
  const { data, error: insErr } = await supabase
    .from('week_plans')
    .insert({ week_start: weekStartISO, kind: weekKindFor(weekStartISO), created_by })
    .select().single()
  // Race with another device: unique week_start — refetch on conflict.
  if (insErr) {
    if (insErr.code === '23505') {
      const { data: again } = await supabase.from('week_plans').select('*').eq('week_start', weekStartISO).maybeSingle()
      if (again) return { ok: true, plan: again, created: false }
    }
    return { ok: false, error: insErr.message }
  }
  return { ok: true, plan: data, created: true }
}

export async function getWeekPlanWithItems(weekStartISO) {
  const r = await getOrCreateWeekPlan(weekStartISO)
  if (!r.ok) return r
  const { data: items, error } = await supabase
    .from('week_plan_items').select('*').eq('plan_id', r.plan.id)
    .order('lane', { ascending: true }).order('sort_order', { ascending: true }).order('created_at', { ascending: true })
  if (error) return { ok: false, error: error.message }
  return { ok: true, plan: r.plan, items: items || [] }
}

// Read-only fetch (no auto-create) — for history/scoring of past weeks.
export async function peekWeekPlan(weekStartISO) {
  const { data: plan } = await supabase.from('week_plans').select('*').eq('week_start', weekStartISO).maybeSingle()
  if (!plan) return { ok: true, plan: null, items: [] }
  const { data: items } = await supabase.from('week_plan_items').select('*').eq('plan_id', plan.id)
  return { ok: true, plan, items: items || [] }
}

export async function addPlanItem({ planId, lane, jobId = null, orderId = null, title = null, vendorLabel = null, vendorItemId = null }) {
  const added_by = await getCurrentStaffName().catch(() => null)
  const { data, error } = await supabase
    .from('week_plan_items')
    .insert({ plan_id: planId, lane, job_id: jobId, order_id: orderId, title, added_by, vendor_label: vendorLabel, vendor_item_id: vendorItemId })
    .select().single()
  if (error && error.code === '23505') return { ok: true, existed: true }   // already on this lane
  if (error) return { ok: false, error: error.message }
  return { ok: true, item: data }
}

export async function removePlanItem(itemId) {
  const { error } = await supabase.from('week_plan_items').delete().eq('id', itemId)
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

// Friday scoring — outcome + the why-not. `outcome` null clears a mis-score.
export async function scorePlanItem(itemId, outcome, note = null) {
  const scored_by = await getCurrentStaffName().catch(() => null)
  const { error } = await supabase.from('week_plan_items')
    .update({ outcome: outcome || null, outcome_note: (note || '').trim() || null, scored_by, scored_at: outcome ? new Date().toISOString() : null })
    .eq('id', itemId)
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

export async function lockWeekPlan(planId) {
  const locked_by = await getCurrentStaffName().catch(() => null)
  const { error } = await supabase.from('week_plans')
    .update({ locked_at: new Date().toISOString(), locked_by }).eq('id', planId)
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

// ── Promise-vs-delivery score ────────────────────────────────────────────────
// done ÷ planned per past week (dropped items don't count against the crew).
// Returns newest-last for the sparkline: [{ weekStart, kind, planned, done, pct }]
export async function getScoreHistory(weeks = 12) {
  const thisMonday = isoOf(mondayOf())
  const from = addDays(thisMonday, -7 * weeks)
  const { data: plans, error } = await supabase
    .from('week_plans').select('id, week_start, kind')
    .gte('week_start', from).lt('week_start', thisMonday)
    .order('week_start', { ascending: true })
  if (error || !plans?.length) return []
  const { data: items } = await supabase
    .from('week_plan_items').select('plan_id, outcome')
    .in('plan_id', plans.map(p => p.id))
  const byPlan = new Map()
  for (const it of (items || [])) {
    const e = byPlan.get(it.plan_id) || { planned: 0, done: 0 }
    if (it.outcome !== 'dropped') {
      e.planned++
      if (it.outcome === 'done') e.done++
    }
    byPlan.set(it.plan_id, e)
  }
  return plans.map(p => {
    const e = byPlan.get(p.id) || { planned: 0, done: 0 }
    return { weekStart: p.week_start, kind: p.kind, planned: e.planned, done: e.done, pct: e.planned ? Math.round((e.done / e.planned) * 100) : null }
  }).filter(r => r.planned > 0)
}

// ── Meeting notes (the editable shell) ───────────────────────────────────────
export async function getMeetingNotes(dateISO = todayISO()) {
  const { data, error } = await supabase
    .from('meeting_notes').select('*').eq('meeting_date', dateISO).maybeSingle()
  if (error) { console.warn('[meeting] notes:', error.message); return null }
  return data || null
}

export async function saveMeetingNotes(dateISO, patch) {
  const row = { meeting_date: dateISO, updated_at: new Date().toISOString() }
  for (const k of ['verse', 'verse_ref', 'closing_notes', 'inputs']) {
    if (patch[k] !== undefined) row[k] = patch[k]
  }
  const { data, error } = await supabase
    .from('meeting_notes').upsert(row, { onConflict: 'meeting_date' }).select().single()
  if (error) return { ok: false, error: error.message }
  return { ok: true, notes: data }
}
