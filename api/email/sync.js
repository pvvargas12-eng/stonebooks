// =============================================================================
// /api/email/sync — Vercel Node serverless function (Gmail Path B, Phase G3)
// =============================================================================
// Incremental IMAP poll of the shared shop Gmail (shevcoteam@gmail.com). Fetches
// new mail from INBOX and Sent (UID > last-synced), parses, matches a CUSTOMER by
// email address (inbound=from, outbound=to), best-effort tags an order_id, and
// upserts into `messages` (deduped by Message-ID). Updates email_sync_state.
// Unmatched senders are still stored (customer_id null) — nothing is dropped.
//
// Triggered by Vercel Cron (every ~3 min, see vercel.json) and by the in-app
// "Sync now" button. Node runtime — imapflow + mailparser (Deno IMAP is immature).
//
// Server-only env (Vercel): GMAIL_ADDRESS, GMAIL_APP_PASSWORD, SUPABASE_URL,
// SUPABASE_SERVICE_ROLE_KEY, and optionally CRON_SECRET (if set, cron must present
// it as a Bearer token; staff JWT is also accepted for the manual button).
// =============================================================================
import { ImapFlow } from 'imapflow'
import { simpleParser } from 'mailparser'
import { createClient } from '@supabase/supabase-js'

const MAX_PER_RUN = 40          // cap per mailbox per run — keeps under the function timeout
const MAILBOXES = [
  { name: 'INBOX', direction: 'inbound' },
  { name: '[Gmail]/Sent Mail', direction: 'outbound' },
]

const lc = (s) => (s ? String(s).toLowerCase().trim() : null)
const snippetOf = (t) => (t || '').replace(/\s+/g, ' ').trim().slice(0, 200)

async function matchCustomerId(admin, addr) {
  if (!addr) return null
  const { data } = await admin.from('customers').select('id').ilike('email', addr).limit(1).maybeSingle()
  return data?.id || null
}
async function bestEffortOrderId(admin, subject) {
  const m = (subject || '').match(/\b([EC]O?-?\d{2,4}-\d{3,4})\b/i)
  if (!m) return null
  const { data } = await admin.from('orders').select('id').ilike('order_number', m[1]).limit(1).maybeSingle()
  return data?.id || null
}

async function upsertParsed(admin, parsed, direction, uid) {
  const messageId = parsed.messageId || null
  if (!messageId) return false                 // no Message-ID → can't dedupe; skip
  const fromAddr = lc(parsed.from?.value?.[0]?.address)
  const toAddrs = (parsed.to?.value || []).map(v => v.address).filter(Boolean)
  const subject = parsed.subject || null
  const text = parsed.text || null
  const html = typeof parsed.html === 'string' ? parsed.html : null
  const dateIso = parsed.date ? new Date(parsed.date).toISOString() : new Date().toISOString()
  const refs = parsed.references ? (Array.isArray(parsed.references) ? parsed.references : [parsed.references]) : []
  const threadKey = refs[0] || parsed.inReplyTo || messageId

  // Customer = grouping key: inbound→sender, outbound→first recipient.
  const matchAddr = direction === 'inbound' ? fromAddr : lc(toAddrs[0])
  const customerId = await matchCustomerId(admin, matchAddr)
  const orderId = await bestEffortOrderId(admin, subject)   // optional tag only — never used to filter

  await admin.from('messages').upsert({
    gmail_message_id: messageId,
    thread_key: threadKey,
    direction,
    from_email: fromAddr,
    to_emails: toAddrs,
    subject,
    body_text: text,
    body_html: html,
    snippet: snippetOf(text),
    has_attachments: (parsed.attachments || []).length > 0,
    attachments: (parsed.attachments || []).map(a => ({ filename: a.filename || null, contentType: a.contentType || null, size: a.size || null })),
    order_id: orderId,
    customer_id: customerId,
    imap_uid: uid,
    sent_at: direction === 'outbound' ? dateIso : null,
    received_at: direction === 'inbound' ? dateIso : null,
    is_read: direction === 'outbound',          // our own sent mail is "read"; inbound starts unread
  }, { onConflict: 'gmail_message_id', ignoreDuplicates: true })
  return true
}

async function syncMailbox(client, admin, mailbox, direction, { anchor = false } = {}) {
  const { data: state } = await admin.from('email_sync_state').select('last_uid, uid_validity').eq('mailbox', mailbox).maybeSingle()
  let lastUid = Number(state?.last_uid) || 0
  let uidValidity = state?.uid_validity != null ? Number(state.uid_validity) : null
  let processed = 0, maxUid = lastUid

  const lock = await client.getMailboxLock(mailbox)
  try {
    const box = client.mailbox
    const curValidity = Number(box.uidValidity)
    if (uidValidity != null && curValidity !== uidValidity) { lastUid = 0; maxUid = 0 }   // UIDVALIDITY changed → restart
    uidValidity = curValidity

    // ANCHOR MODE: jump the cursor to the CURRENT tail (uidNext - 1) WITHOUT
    // importing anything, so future polls only fetch mail that arrives from now
    // on (no backfill of existing history). Use after a clean-slate delete.
    if (anchor) {
      const tail = Math.max(0, Number(box.uidNext || 1) - 1)
      maxUid = Math.max(maxUid, tail)
    } else if (box.exists > 0) {
      for await (const msg of client.fetch(`${lastUid + 1}:*`, { uid: true, source: true }, { uid: true })) {
        if (msg.uid <= lastUid) continue       // ':*' always returns the last msg even if below range
        if (processed >= MAX_PER_RUN) break
        try {
          const parsed = await simpleParser(msg.source)
          await upsertParsed(admin, parsed, direction, msg.uid)
        } catch (e) { console.warn('[email/sync] parse/insert failed uid', msg.uid, e?.message) }
        maxUid = Math.max(maxUid, msg.uid)
        processed++
      }
    }
  } finally {
    lock.release()
  }

  await admin.from('email_sync_state').upsert({
    mailbox, last_uid: maxUid, uid_validity: uidValidity,
    last_run_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  }, { onConflict: 'mailbox' })
  return { mailbox, processed, lastUid: maxUid }
}

export default async function handler(req, res) {
  const GMAIL_ADDRESS = process.env.GMAIL_ADDRESS
  const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD
  const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY
  const CRON_SECRET = process.env.CRON_SECRET
  if (!GMAIL_ADDRESS || !GMAIL_APP_PASSWORD || !SUPABASE_URL || !SERVICE_ROLE) {
    return res.status(500).json({ error: 'server_not_configured' })
  }

  // Auth: Vercel Cron (CRON_SECRET bearer, if set) OR an authenticated staff user.
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } })
  const authHeader = req.headers.authorization || ''
  const bearer = authHeader.replace(/^Bearer\s+/i, '')
  let authorized = false
  if (CRON_SECRET && bearer === CRON_SECRET) authorized = true
  if (!authorized && bearer) {
    const { data: caller } = await admin.auth.getUser(bearer)
    if (caller?.user) {
      const { data: partner } = await admin.from('partner_users').select('id').eq('auth_user_id', caller.user.id).maybeSingle()
      authorized = !partner
    }
  }
  // If no CRON_SECRET is configured, allow unauthenticated cron calls (Vercel cron
  // is the only scheduled caller). Set CRON_SECRET to lock the endpoint down.
  if (!authorized && CRON_SECRET) return res.status(401).json({ error: 'not_authorized' })

  const client = new ImapFlow({
    host: 'imap.gmail.com', port: 993, secure: true,
    auth: { user: GMAIL_ADDRESS, pass: GMAIL_APP_PASSWORD },
    logger: false,
  })
  // ?anchor=1 → don't import; jump each cursor to the current mailbox tail so
  // future polls only see NEW mail (use once after a clean-slate delete).
  const anchor = String(req.query?.anchor || (typeof req.body === 'object' ? req.body?.anchor : '') || '') === '1'

  const results = []
  try {
    await client.connect()
    for (const mb of MAILBOXES) {
      try { results.push(await syncMailbox(client, admin, mb.name, mb.direction, { anchor })) }
      catch (e) { results.push({ mailbox: mb.name, error: e?.message || String(e) }) }
    }
  } catch (e) {
    return res.status(502).json({ error: 'imap_failed', detail: e?.message || String(e) })
  } finally {
    try { await client.logout() } catch { /* ignore */ }
  }

  return res.status(200).json({ ok: true, anchor, results })
}
