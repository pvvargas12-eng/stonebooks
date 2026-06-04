// =============================================================================
// 📚 Stonebooks — Reports data layer (loading, date ranges, layout, CSV)
// =============================================================================
// Shared plumbing for the Reports tab. One bundle load (orders + jobs +
// outgoing + promises), filtered client-side per card. Archived orders are
// excluded at the query (D1 rule). Layout persists to localStorage immediately
// and to user_settings.reports_layout (migration 20260607) best-effort.
// =============================================================================

import { supabase } from './supabase'
import {
  fetchAllPaged, getJobs, listOutgoingPayments, getAllOpenPromises,
  getBatches, getUserSettings, upsertUserSettings,
} from './stonebooksData'

const REPORT_ORDER_SELECT =
  'id, order_number, status, created_at, signed_at, target_completion_date, ' +
  'payments, deposit_amount, deposit_received_at, balance_amount, balance_received_at, ' +
  'pricing, add_ons, contract_total, primary_lastname, deceased, archived, ' +
  'customer:customers(id, first_name, last_name, email), cemetery:cemeteries(id, name)'

// One bundle for every report. Best-effort per source so one failure doesn't
// blank the whole tab.
export async function loadReportsData() {
  const [orders, jobs, outgoing, promises, batches] = await Promise.all([
    fetchAllPaged(() => supabase.from('orders').select(REPORT_ORDER_SELECT)
      .or('archived.is.null,archived.eq.false').order('created_at', { ascending: false })).catch(() => []),
    getJobs({ includeClosed: true, limit: 1000 }).catch(() => []),
    listOutgoingPayments().catch(() => []),
    getAllOpenPromises({ includeResolved: true }).catch(() => []),
    getBatches({}).catch(() => []),
  ])
  return { orders: orders || [], jobs: jobs || [], outgoing: outgoing || [], promises: promises || [], batches: batches || [] }
}

// ── Date range ───────────────────────────────────────────────────────────────
const startOfMonth   = (d) => new Date(d.getFullYear(), d.getMonth(), 1)
const startOfQuarter = (d) => new Date(d.getFullYear(), Math.floor(d.getMonth() / 3) * 3, 1)
const startOfYear    = (d) => new Date(d.getFullYear(), 0, 1)

// `now` is required (callers pass a stable lazy-init Date — no Date() in render).
export function reportDateRange(code, custom, now) {
  let start, end = now, label
  if (code === 'quarter') { start = startOfQuarter(now); label = 'This quarter' }
  else if (code === 'year') { start = startOfYear(now); label = 'This year' }
  else if (code === 'custom' && custom?.start) {
    start = new Date(`${custom.start}T00:00:00`)
    end = custom.end ? new Date(`${custom.end}T23:59:59`) : now
    label = 'Custom'
  } else { start = startOfMonth(now); label = 'This month' }
  const span = Math.max(1, end.getTime() - start.getTime())
  return { start, end, prevStart: new Date(start.getTime() - span), prevEnd: new Date(start.getTime()), label, code }
}

export const inRange = (iso, r) => {
  if (!iso) return false
  const t = new Date(iso).getTime()
  return t >= r.start.getTime() && t <= r.end.getTime()
}
export const inPrevRange = (iso, r) => {
  if (!iso) return false
  const t = new Date(iso).getTime()
  return t >= r.prevStart.getTime() && t < r.prevEnd.getTime()
}

// ── Layout persistence ───────────────────────────────────────────────────────
const LS_KEY = (uid) => `sb-reports-layout-${uid || 'anon'}`

export async function getReportsLayout(userId) {
  if (userId) {
    try { const s = await getUserSettings(userId); if (s && s.reports_layout) return s.reports_layout } catch { /* column may not exist yet */ }
  }
  try { const raw = localStorage.getItem(LS_KEY(userId)); if (raw) return JSON.parse(raw) } catch { /* ignore */ }
  return null
}

export async function saveReportsLayout(userId, layout) {
  try { localStorage.setItem(LS_KEY(userId), JSON.stringify(layout)) } catch { /* ignore */ }
  if (userId) { try { await upsertUserSettings(userId, { reports_layout: layout }) } catch { /* needs the 20260607 migration */ } }
}

// ── CSV export ───────────────────────────────────────────────────────────────
export function downloadReportCSV(filename, headers, rows) {
  const esc = (v) => { const s = String(v == null ? '' : v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
  const lines = [headers.map(esc).join(','), ...rows.map(r => r.map(esc).join(','))]
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

// ── Health thresholds (stub — user-editable later) ───────────────────────────
// Each report passes a value + its default thresholds; returns red/yellow/green.
// Centralized so the future Settings editor can override per report id.
export function healthFrom(value, { red, yellow, invert = false } = {}) {
  if (value == null || red == null || yellow == null) return 'neutral'
  if (invert) {
    // higher is worse (e.g. $ at risk, days stuck)
    if (value >= red) return 'red'
    if (value >= yellow) return 'yellow'
    return 'green'
  }
  // higher is better
  if (value <= red) return 'red'
  if (value <= yellow) return 'yellow'
  return 'green'
}
