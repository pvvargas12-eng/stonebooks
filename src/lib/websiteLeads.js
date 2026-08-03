// =============================================================================
// websiteLeads.js — website form submissions → draft leads + follow-up tasks
// =============================================================================
// The site (Duda, managed by Visual Media) emails every form submission to
// the synced inbox as no-reply@multiscreensite.com with subject
// "New form submission - <form> - <page>" and labeled body lines
// ("Name: …", "Email: …", "Phone Number: … [tel:…]"). The sweep:
//   1. finds recent unprocessed form messages,
//   2. CLAIMS each in website_leads (unique message_id — claim-before-create,
//      so several open desks never double-create; the push-sender pattern),
//   3. mints a DRAFT LEAD through the EXACT desktop path (makeBlankOrder +
//      saveOrder — the IntakeScreen precedent; salesRep 'Website' so the
//      Created-by filter finds them),
//   4. cuts a Sales-department follow-up task due today + an order note with
//      what they wrote.
// IMPORT DYNAMICALLY from the shell — this drags the SalesMode chunk and must
// never ride in the entry bundle (PERF-1 discipline).
// =============================================================================
import { supabase } from './supabase'
import { makeBlankOrder, saveOrder } from '../SalesMode'
import { addShopTask, addOrderNote, phoneDigits, todayISO } from './stonebooksData'

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
      const name = fields['name'] || fields['full name'] || ''
      const email = fields['email'] || fields['email address'] || ''
      const phone = fields['phone number'] || fields['phone'] || ''
      const message = fields['message'] || fields['comments'] || fields['how can we help'] || fields['how can we help you'] || ''
      if (!name.trim() && !email.trim() && !phone.trim()) {
        await supabase.from('website_leads')
          .update({ status: 'skipped_empty', form_name: formName, parsed: fields }).eq('id', claim.id)
        continue
      }
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
      if (!res?.ok) throw new Error(res?.error?.message || res?.reason || 'saveOrder failed')
      const orderId = res.order?.id || null
      let taskId = null
      if (orderId) {
        await addOrderNote({
          orderId,
          body: `Website lead — auto-created from the ${formName} submission (${String(msg.received_at).slice(0, 10)}).${message ? `\nTheir message: ${message}` : ''}`,
          author: 'Website',
        }).catch(() => {})
        const t = await addShopTask({
          title: `Follow up website lead — ${name.trim() || email.trim() || phone} (${formName})`,
          assignee: 'Sales', assigneeKind: 'department',
          orderId, dueDate: todayISO(),
          createdBy: 'Website', taskedBy: 'Website', taskType: 'lead',
        }).catch(() => null)
        taskId = t?.task?.id || null
      }
      await supabase.from('website_leads').update({
        status: 'created', order_id: orderId,
        customer_id: res.order?.customer_id || null,
        task_id: taskId, form_name: formName, parsed: fields,
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
