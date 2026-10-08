// =============================================================================
// websiteLeads.js — website form submissions → INQUIRIES (→ leads on Done)
// =============================================================================
// The site (Duda, managed by Visual Media) emails every form submission to
// the synced inbox as no-reply@multiscreensite.com with subject
// "New form submission - <form> - <page>" and labeled body lines
// ("Name: …", "Email: …", "Phone Number: … [tel:…]"). The sweep:
//   1. finds recent unprocessed form messages,
//   2. CLAIMS each in website_leads (unique message_id — claim-before-create,
//      so several open desks never double-create; the push-sender pattern),
//   3. parses the fields and parks the row as an INQUIRY (inquiry_status
//      'new' — the Inquiries tab + its red nav badge).
// INQUIRIES-1 (Paul 2026-10-08): the sweep NO LONGER mints a draft lead or a
// Sales task on arrival — that flooded the reminders list (57 of 113 open
// lead tasks were website follow-ups). The lead is created when the inquiry
// is actioned: ensureLeadForInquiry below, through the EXACT desktop path
// (makeBlankOrder + saveOrder; salesRep 'Website').
// IMPORT DYNAMICALLY from the shell / Inquiries tab — this drags the
// SalesMode chunk and must never ride in the entry bundle (PERF-1).
// =============================================================================
import { supabase } from './supabase'
import { makeBlankOrder, saveOrder } from '../SalesMode'
import { addOrderNote, phoneDigits } from './stonebooksData'

const FORM_FROM = 'no-reply@multiscreensite.com'
const SWEEP_WINDOW_DAYS = 14

// "Label: value" body lines → { label(lower): value }; strips the trailing
// "[tel:…]" / "[mailto:…]" duplicates Duda appends.
function parseFormBody(bodyText) {
  const out = {}
  for (const raw of String(bodyText || '').split(/\r?\n/)) {
    const m = raw.match(/^([A-Za-z][A-Za-z0-9 /#()'-]{1,40}):\s*(.+)$/)
    if (!m) continue
    const key = m[1].trim().toLowerCase()
    if (key === 'form response notification') continue
    out[key] = m[2].trim().replace(/\s*\[(?:tel|mailto):[^\]]*\]\s*$/i, '')
  }
  return out
}
function splitName(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return { first: '', last: '' }
  if (parts.length === 1) return { first: parts[0], last: parts[0] }
  return { first: parts.slice(0, -1).join(' '), last: parts[parts.length - 1] }
}
const fieldsOf = (fields) => ({
  name: fields['name'] || fields['full name'] || '',
  email: fields['email'] || fields['email address'] || '',
  phone: fields['phone number'] || fields['phone'] || '',
  message: fields['message'] || fields['comments'] || fields['how can we help'] || fields['how can we help you'] || '',
})

export async function sweepWebsiteLeadForms() {
  const since = new Date(Date.now() - SWEEP_WINDOW_DAYS * 86400000).toISOString()
  const { data: msgs, error } = await supabase.from('messages')
    .select('id, subject, body_text, snippet, received_at')
    .eq('from_email', FORM_FROM)
    .ilike('subject', 'New form submission%')
    .gte('received_at', since)
    .order('received_at', { ascending: false })
    .limit(50)
  if (error || !msgs?.length) return { created: 0 }

  const { data: done } = await supabase.from('website_leads')
    .select('message_id').in('message_id', msgs.map(m => m.id))
  const seen = new Set((done || []).map(r => r.message_id))
  let created = 0

  for (const msg of msgs.filter(m => !seen.has(m.id))) {
    // Claim FIRST — a unique-violation here means another desk has it.
    const { data: claim, error: cErr } = await supabase.from('website_leads')
      .insert({ message_id: msg.id }).select('id').single()
    if (cErr || !claim) continue
    const formName = (String(msg.subject || '').match(/^New form submission - (.+)$/) || [])[1] || 'Website form'
    try {
      const fields = parseFormBody(msg.body_text || msg.snippet)
      const { name, email, phone } = fieldsOf(fields)
      if (!name.trim() && !email.trim() && !phone.trim()) {
        await supabase.from('website_leads')
          .update({ status: 'skipped_empty', inquiry_status: 'junk', actioned_at: new Date().toISOString(), actioned_by: 'sweep', form_name: formName, parsed: fields })
          .eq('id', claim.id)
        continue
      }
      // Parked as an inquiry — the submission's own timestamp is what the
      // tab ages against, not the sweep's.
      await supabase.from('website_leads').update({
        status: 'inquiry', inquiry_status: 'new', form_name: formName, parsed: fields,
        created_at: msg.received_at || new Date().toISOString(),
      }).eq('id', claim.id)
      created++
    } catch (e) {
      await supabase.from('website_leads')
        .update({ status: 'error', form_name: formName, parsed: { error: String(e?.message || e) } })
        .eq('id', claim.id)
    }
  }
  return { created }
}

// Done → Leads: the inquiry becomes a DRAFT LEAD (salesRep 'Website'), with
// their message as the first order note. Idempotent — an inquiry that already
// has an order (the pre-INQUIRIES-1 rows) just returns it. Does NOT touch
// inquiry_status; the caller stamps done.
export async function ensureLeadForInquiry(inquiry) {
  if (!inquiry?.id) return { ok: false, error: 'Missing inquiry' }
  if (inquiry.order_id) return { ok: true, orderId: inquiry.order_id, existed: true }
  const fields = inquiry.parsed || {}
  const { name, email, phone, message } = fieldsOf(fields)
  const { first, last } = splitName(name)
  const blank = makeBlankOrder()
  const res = await saveOrder({
    ...blank,
    status: 'draft',
    salesRep: 'Website',
    customer: {
      ...blank.customer,
      firstName: first,
      lastName: last,
      phonePrimary: phoneDigits(phone),
      email: email.trim(),
    },
  })
  if (!res?.ok) return { ok: false, error: res?.error?.message || res?.reason || 'saveOrder failed' }
  const orderId = res.order?.id || null
  if (!orderId) return { ok: false, error: 'No order id returned' }
  const formName = inquiry.form_name || 'Website form'
  await addOrderNote({
    orderId,
    body: `Website lead — from the ${formName} submission (${String(inquiry.created_at || '').slice(0, 10)}).${message ? `\nTheir message: ${message}` : ''}${inquiry.interest ? `\nLooking for: ${inquiry.interest.replace('_', ' ')}` : ''}`,
    author: 'Website',
  }).catch(() => {})
  await supabase.from('website_leads').update({
    status: 'created', order_id: orderId, customer_id: res.order?.customer_id || null,
  }).eq('id', inquiry.id)
  return { ok: true, orderId, customerId: res.order?.customer_id || null }
}
