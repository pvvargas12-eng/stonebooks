// =============================================================================
// /api/email/attachment — Vercel Node serverless function (Gmail Path B)
// =============================================================================
// On-demand attachment fetch. The sync stores attachment METADATA only (name/
// type/size — no bytes), so this endpoint re-pulls the original message from
// Gmail over IMAP when staff click an attachment, and streams the file back.
// Works for every synced message, past or future — no storage, no backfill.
//
// GET /api/email/attachment?id=<messages.id>&idx=<attachment index>
// Auth: staff JWT (same check as /api/email/sync — partner users rejected).
// Lookup: direct UID fetch via the stored imap_uid (fast path), falling back to
// an IMAP Message-ID header search if the UID is missing or stale.
// =============================================================================
import dns from 'node:dns'
import { ImapFlow } from 'imapflow'
import { simpleParser } from 'mailparser'
import { createClient } from '@supabase/supabase-js'

dns.setDefaultResultOrder('ipv4first')

const CONNECT_TIMEOUT_MS = 12000
const STEP_TIMEOUT_MS = 15000
const FETCH_TIMEOUT_MS = 40000   // full-source download of a big attachment (function maxDuration is 60s)
const IMAP_TIMEOUTS = { connectionTimeout: 12000, greetingTimeout: 10000, socketTimeout: 25000 }

function withTimeout(promise, ms, label) {
  let t
  const timer = new Promise((_, reject) => {
    t = setTimeout(() => reject(new Error(`timeout:${label} after ${ms}ms`)), ms)
  })
  return Promise.race([Promise.resolve(promise), timer]).finally(() => clearTimeout(t))
}

async function closeClient(client) {
  try { await withTimeout(client.logout(), 3000, 'logout') } catch { /* ignore */ }
  try { client.close() } catch { /* ignore */ }
}

// Fetch one message's raw source from a mailbox, by UID first, then by
// Message-ID search. Returns a Buffer or null.
async function fetchSource(client, mailbox, { uid, messageId }) {
  const lock = await withTimeout(client.getMailboxLock(mailbox), STEP_TIMEOUT_MS, `open:${mailbox}`)
  try {
    if (uid) {
      try {
        const msg = await withTimeout(client.fetchOne(String(uid), { source: true }, { uid: true }), FETCH_TIMEOUT_MS, 'fetchOne')
        if (msg?.source) {
          // Guard against a recycled UID (uidValidity change): confirm Message-ID.
          const head = msg.source.toString('utf8', 0, Math.min(msg.source.length, 16384))
          if (!messageId || head.toLowerCase().includes(messageId.toLowerCase())) return msg.source
        }
      } catch { /* fall through to search */ }
    }
    if (messageId) {
      const uids = await withTimeout(
        client.search({ header: { 'message-id': messageId } }, { uid: true }),
        STEP_TIMEOUT_MS, `search:${mailbox}`
      )
      if (Array.isArray(uids) && uids.length) {
        const msg = await withTimeout(client.fetchOne(String(uids[0]), { source: true }, { uid: true }), FETCH_TIMEOUT_MS, 'fetchOne:searched')
        if (msg?.source) return msg.source
      }
    }
    return null
  } finally {
    lock.release()
  }
}

export default async function handler(req, res) {
  const GMAIL_ADDRESS = process.env.GMAIL_ADDRESS
  const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD
  const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!GMAIL_ADDRESS || !GMAIL_APP_PASSWORD || !SUPABASE_URL || !SERVICE_ROLE) {
    return res.status(500).json({ error: 'server_not_configured' })
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } })
  const bearer = (req.headers.authorization || '').replace(/^Bearer\s+/i, '')
  if (!bearer) return res.status(401).json({ error: 'not_authenticated' })
  const { data: caller } = await admin.auth.getUser(bearer)
  if (!caller?.user) return res.status(401).json({ error: 'not_authenticated' })
  const { data: partner } = await admin.from('partner_users').select('id').eq('auth_user_id', caller.user.id).maybeSingle()
  if (partner) return res.status(403).json({ error: 'not_authorized' })

  const id = String(req.query?.id || '')
  const idx = Number(req.query?.idx ?? 0)
  if (!id || !Number.isInteger(idx) || idx < 0) return res.status(400).json({ error: 'bad_request' })

  const { data: row, error } = await admin.from('messages')
    .select('gmail_message_id, imap_uid, direction, attachments')
    .eq('id', id).maybeSingle()
  if (error || !row) return res.status(404).json({ error: 'message_not_found' })
  const meta = (row.attachments || [])[idx]
  if (!meta) return res.status(404).json({ error: 'attachment_not_found' })

  let imapHost = 'imap.gmail.com'
  try {
    const addrs = await withTimeout(dns.promises.resolve4('imap.gmail.com'), 4000, 'dns')
    if (addrs && addrs.length) imapHost = addrs[0]
  } catch { /* hostname fallback */ }

  const client = new ImapFlow({
    host: imapHost, port: 993, secure: true,
    servername: 'imap.gmail.com',
    auth: { user: GMAIL_ADDRESS, pass: GMAIL_APP_PASSWORD },
    logger: false,
    tls: { servername: 'imap.gmail.com', family: 4 },
    ...IMAP_TIMEOUTS,
  })

  try {
    await withTimeout(client.connect(), CONNECT_TIMEOUT_MS, 'connect')
    // The message lives in the mailbox its direction was synced from; check the
    // other one too in case of odd filing (e.g. self-addressed mail).
    const mailboxes = row.direction === 'outbound'
      ? ['[Gmail]/Sent Mail', 'INBOX']
      : ['INBOX', '[Gmail]/Sent Mail']
    let source = null
    for (const mb of mailboxes) {
      try {
        source = await fetchSource(client, mb, { uid: mb === mailboxes[0] ? row.imap_uid : null, messageId: row.gmail_message_id })
      } catch (e) { console.warn('[email/attachment]', mb, e?.message) }
      if (source) break
    }
    if (!source) return res.status(404).json({ error: 'source_not_found', detail: 'Message no longer available on Gmail.' })

    const parsed = await withTimeout(simpleParser(source), STEP_TIMEOUT_MS, 'parse')
    const atts = parsed.attachments || []
    // Prefer positional match; fall back to filename match if counts shifted.
    const att = atts[idx] || atts.find(a => meta.filename && a.filename === meta.filename)
    if (!att?.content) return res.status(404).json({ error: 'attachment_not_found' })

    const filename = att.filename || meta.filename || 'attachment'
    res.setHeader('Content-Type', att.contentType || meta.contentType || 'application/octet-stream')
    res.setHeader('Content-Disposition', `inline; filename="${filename.replace(/["\\]/g, '_')}"`)
    res.setHeader('Cache-Control', 'private, max-age=3600')
    return res.status(200).send(att.content)
  } catch (e) {
    const detail = e?.message || String(e)
    console.error('[email/attachment] failed:', detail)
    return res.status(502).json({ error: 'imap_failed', detail })
  } finally {
    await closeClient(client)
  }
}
