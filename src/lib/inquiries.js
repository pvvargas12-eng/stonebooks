// =============================================================================
// inquiries.js — Website Inquiries (INQUIRIES-1, 2026-10-08)
// =============================================================================
// Paul: "remove the website inquiries and put them somewhere else — they are
// critical for the business... number notification... send an email to ask
// what they're looking for... when actioned goes away, the customer goes into
// leads... data for how many website inquiries convert to sales."
//
// The website_leads row IS the inquiry (one per form submission; the sweep in
// websiteLeads.js claims + parses it). inquiry_status:
//   new      — untouched (the red nav badge)
//   emailed  — we wrote back (first_touch_at/by stamped), waiting on them
//   done     — actioned: a LEAD exists (order_id) — the card leaves the list
//   junk     — not a lead; never becomes one
// A draft order is created ONLY on Done (ensureLeadForInquiry in
// websiteLeads.js — dynamic import, it drags SalesMode). Conversion = the
// inquiry's order_id → orders.signed_at + rowGrandTotal.
// =============================================================================
import { supabase } from './supabase'
import { rowGrandTotal, rowTotalPaid } from './stonebooksData'

export const INTERESTS = [
  { code: 'new_stone',   label: 'New stone' },
  { code: 'bronze',      label: 'Bronze' },
  { code: 'inscription', label: 'Inscription' },
  { code: 'unsure',      label: 'Not sure yet' },
]
export const interestLabel = (c) => INTERESTS.find(i => i.code === c)?.label || ''

const INQ_SELECT = 'id, message_id, order_id, customer_id, task_id, form_name, parsed, status, created_at, inquiry_status, interest, first_touch_at, first_touch_by, actioned_at, actioned_by, inquiry_note'

// Parsed-field readers — the sweep stores every labeled line lower-cased.
export const inqName = (r) => (r.parsed?.name || r.parsed?.['full name'] || '').trim()
export const inqEmail = (r) => (r.parsed?.email || r.parsed?.['email address'] || '').trim()
export const inqPhone = (r) => String(r.parsed?.['phone number'] || r.parsed?.phone || '').replace(/\D/g, '').slice(0, 10)
export const inqMessage = (r) => (r.parsed?.message || r.parsed?.comments || r.parsed?.['how can we help'] || r.parsed?.['how can we help you'] || '').trim()
export const inqFormKind = (r) => /catalog/i.test(r.form_name || '') ? 'catalog' : 'contact'
export const inqDisplayName = (r) => inqName(r) || inqEmail(r) || (inqPhone(r) ? `(${inqPhone(r).slice(0, 3)}) ${inqPhone(r).slice(3, 6)}-${inqPhone(r).slice(6)}` : 'Unknown')

export async function listInquiries({ status = 'new', limit = 200 } = {}) {
  let q = supabase.from('website_leads').select(INQ_SELECT).order('created_at', { ascending: false }).limit(limit)
  if (status === 'new') q = q.eq('inquiry_status', 'new')
  else if (status === 'emailed') q = q.eq('inquiry_status', 'emailed')
  else if (status === 'done') q = q.eq('inquiry_status', 'done').gte('actioned_at', new Date(Date.now() - 30 * 86400000).toISOString())
  else if (status === 'junk') q = q.eq('inquiry_status', 'junk')
  const { data, error } = await q
  if (error) { console.warn('[inquiries] list:', error.message); return [] }
  // Claimed-but-unparsed rows (status 'claimed'/'error') carry no fields —
  // keep them out of the working list; they're the sweep's problem.
  return (data || []).filter(r => r.status !== 'claimed')
}

export async function getInquiryCounts() {
  const count = async (st) => {
    const { count: n } = await supabase.from('website_leads').select('id', { count: 'exact', head: true }).eq('inquiry_status', st).neq('status', 'claimed')
    return n || 0
  }
  const [fresh, emailed] = await Promise.all([count('new'), count('emailed')])
  const { count: done } = await supabase.from('website_leads').select('id', { count: 'exact', head: true })
    .eq('inquiry_status', 'done').gte('actioned_at', new Date(Date.now() - 30 * 86400000).toISOString())
  return { new: fresh, emailed, done: done || 0 }
}

// The nav badge — untouched inquiries.
export async function getNewInquiryCount() {
  const { count, error } = await supabase.from('website_leads').select('id', { count: 'exact', head: true }).eq('inquiry_status', 'new').neq('status', 'claimed')
  if (error) return 0
  return count || 0
}

export async function updateInquiry(id, patch = {}) {
  const row = {}
  for (const k of ['inquiry_status', 'interest', 'first_touch_at', 'first_touch_by', 'actioned_at', 'actioned_by', 'inquiry_note']) {
    if (k in patch) row[k] = patch[k]
  }
  if (!Object.keys(row).length) return { ok: true }
  const { error } = await supabase.from('website_leads').update(row).eq('id', id)
  return error ? { ok: false, error: error.message } : { ok: true }
}

export async function markInquiryEmailed(id, by = null) {
  const { data } = await supabase.from('website_leads').select('first_touch_at, inquiry_status').eq('id', id).single()
  const patch = {}
  if (!data?.first_touch_at) { patch.first_touch_at = new Date().toISOString(); patch.first_touch_by = by }
  if (data?.inquiry_status === 'new') patch.inquiry_status = 'emailed'
  return updateInquiry(id, patch)
}

// ── The numbers: website → sales ────────────────────────────────────────────
// Every inquiry that became a lead, joined to its order: signed? $? Lead →
// signed days. rowGrandTotal needs the full pricing shape, so orders are read
// with select('*').
export async function getInquiryFunnel() {
  const { data: rows, error } = await supabase.from('website_leads')
    .select('id, order_id, form_name, created_at, inquiry_status, first_touch_at, interest')
    .neq('status', 'claimed')
  if (error) { console.warn('[inquiries] funnel:', error.message); return null }
  const all = rows || []
  const ids = [...new Set(all.map(r => r.order_id).filter(Boolean))]
  const orders = new Map()
  for (let i = 0; i < ids.length; i += 150) {
    const { data } = await supabase.from('orders').select('*').in('id', ids.slice(i, i + 150))
    for (const o of (data || [])) orders.set(o.id, o)
  }
  const dayMs = 86400000
  const byForm = {}
  let signed = 0, contractUsd = 0, collectedUsd = 0
  const svc = {}
  const leadDays = [], touchDays = []
  for (const r of all) {
    const kind = /catalog/i.test(r.form_name || '') ? 'catalog' : 'contact'
    byForm[kind] = byForm[kind] || { inquiries: 0, signed: 0 }
    byForm[kind].inquiries++
    if (r.first_touch_at) touchDays.push(Math.max(0, (new Date(r.first_touch_at) - new Date(r.created_at)) / dayMs))
    const o = r.order_id ? orders.get(r.order_id) : null
    if (o && o.signed_at) {
      signed++; byForm[kind].signed++
      contractUsd += rowGrandTotal(o) || 0
      collectedUsd += rowTotalPaid(o) || 0
      for (const s of (o.service_types || [])) svc[s] = (svc[s] || 0) + 1
      leadDays.push(Math.max(0, (new Date(o.signed_at) - new Date(r.created_at)) / dayMs))
    }
  }
  const median = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2 }
  return {
    inquiries: all.filter(r => r.inquiry_status !== 'junk').length,
    junk: all.filter(r => r.inquiry_status === 'junk').length,
    signed, contractUsd, collectedUsd,
    closeRate: all.length ? signed / Math.max(1, all.filter(r => r.inquiry_status !== 'junk').length) : 0,
    byForm, byService: svc,
    medianLeadDays: median(leadDays), medianTouchDays: median(touchDays),
    since: all.length ? all.map(r => r.created_at).sort()[0] : null,
  }
}
