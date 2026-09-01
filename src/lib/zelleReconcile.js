// =============================================================================
// zelleReconcile — Chase Zelle alert emails → the Payments tab (2026-09-01)
// =============================================================================
// Paul: "some payments are getting missed from zelle, too many emails." The
// synced inbox already holds every Chase alert (575 and counting, subject
// 'You received money with Zelle®' from no.reply.alerts@chase.com). The sweep
// claims each alert into zelle_alerts (claim-before-create on message_id —
// the website_leads pattern, safe across several open desks), parses the
// details, and the Zelle Reconcile view surfaces them for Paul's click:
// attach to an order as a real payment, or dismiss. NOTHING writes an order
// by itself — reconcile doctrine.
//
// Parser is defensive: built from the real alert format ("Amount $1,228.00
// Sent on Sep 01, 2026 Transaction number 30645554685 Memo ..."). A field
// that fails to parse stays null and the row still surfaces — a payment must
// never be invisible because Chase reworded an email.
// NO SalesMode imports here (keep this module light; the view does the PDF).
// =============================================================================
import { supabase } from './supabase'

const ZELLE_FROM_LIKE = '%chase.com'
const ZELLE_SUBJECT_LIKE = 'You received money with Zelle%'

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 }

// "Sep 01, 2026" / "September 1, 2026" → 'YYYY-MM-DD' (no Date() — TZ-proof).
function parseUsDate(raw) {
  const m = /([A-Za-z]{3,9})\.?\s+(\d{1,2}),\s*(\d{4})/.exec(raw || '')
  if (!m) return null
  const mo = MONTHS[m[1].slice(0, 3).toLowerCase()]
  if (!mo) return null
  return `${m[3]}-${String(mo).padStart(2, '0')}-${String(m[2]).padStart(2, '0')}`
}

export function parseZelleAlert({ body_text, snippet } = {}) {
  const text = String(body_text || snippet || '').replace(/\s+/g, ' ').trim()
  const amountM = /Amount\s*\$\s*([\d,]+(?:\.\d{1,2})?)/i.exec(text)
  const sentM = /Sent on\s+([A-Za-z]{3,9}\.?\s+\d{1,2},\s*\d{4})/i.exec(text)
  const txnM = /Transaction number\s*:?\s*(\d{5,})/i.exec(text)
  // Memo runs from its label to the next known label or trailing boilerplate.
  const memoM = /Memo\s*:?\s*(.+?)(?=\s*(?:Amount\b|Sent on\b|Transaction number\b|If you|Thanks|To see|©|JPMorgan|$))/i.exec(text)
  const senderM = /([A-Za-z][A-Za-z .,'&-]{1,60}?)\s+sent you/i.exec(text)
  return {
    amount: amountM ? Number(amountM[1].replace(/,/g, '')) : null,
    sentDate: sentM ? parseUsDate(sentM[1]) : null,
    txnNumber: txnM ? txnM[1] : null,
    memo: memoM ? memoM[1].trim().slice(0, 300) : null,
    senderName: senderM ? senderM[1].trim().slice(0, 80) : null,
  }
}

// Sweep the window of Chase Zelle-received alerts into zelle_alerts. Claim
// FIRST (unique message_id — a 23505 means another desk has it), parse after.
export async function sweepZelleAlerts({ days = 120, limit = 120 } = {}) {
  const since = new Date(Date.now() - days * 86400000).toISOString()
  const { data: msgs, error } = await supabase.from('messages')
    .select('id, subject, body_text, snippet, received_at')
    .ilike('from_email', ZELLE_FROM_LIKE)
    .ilike('subject', ZELLE_SUBJECT_LIKE)
    .gte('received_at', since)
    .order('received_at', { ascending: false })
    .limit(limit)
  if (error || !msgs?.length) return { created: 0 }

  const { data: done } = await supabase.from('zelle_alerts')
    .select('message_id').in('message_id', msgs.map(m => m.id))
  const seen = new Set((done || []).map(r => r.message_id))

  let created = 0
  for (const msg of msgs) {
    if (seen.has(msg.id)) continue
    const { data: claim, error: cErr } = await supabase.from('zelle_alerts')
      .insert({ message_id: msg.id }).select('id').single()
    if (cErr || !claim) continue   // 23505 = another desk claimed it
    try {
      const p = parseZelleAlert(msg)
      await supabase.from('zelle_alerts').update({
        txn_number: p.txnNumber, amount: p.amount, sender_name: p.senderName,
        memo: p.memo, sent_date: p.sentDate, received_at: msg.received_at,
        status: 'new',
      }).eq('id', claim.id)
      created++
    } catch (e) {
      console.warn('[zelle] parse/update failed:', e?.message)
      // Row stays 'claimed' — still listed so the payment can't vanish.
    }
  }
  return { created }
}

export async function listZelleAlerts({ limit = 400 } = {}) {
  const { data, error } = await supabase.from('zelle_alerts')
    .select('*')
    .order('received_at', { ascending: false, nullsFirst: false })
    .limit(limit)
  if (error) { console.warn('[zelle] list:', error.message); return [] }
  return data || []
}

export async function markZelleMatched(id, { orderId, paymentId, by } = {}) {
  const { error } = await supabase.from('zelle_alerts').update({
    status: 'matched', order_id: orderId || null, payment_id: paymentId || null,
    matched_by: by || null, matched_at: new Date().toISOString(),
  }).eq('id', id)
  return error ? { ok: false, error: error.message } : { ok: true }
}

export async function dismissZelleAlert(id) {
  const { error } = await supabase.from('zelle_alerts').update({ status: 'dismissed' }).eq('id', id)
  return error ? { ok: false, error: error.message } : { ok: true }
}

export async function restoreZelleAlert(id) {
  const { error } = await supabase.from('zelle_alerts').update({ status: 'new' }).eq('id', id)
  return error ? { ok: false, error: error.message } : { ok: true }
}

export async function stampZelleReceiptSent(id, to) {
  const { error } = await supabase.from('zelle_alerts').update({
    receipt_sent_at: new Date().toISOString(), receipt_sent_to: to || null,
  }).eq('id', id)
  return error ? { ok: false, error: error.message } : { ok: true }
}
