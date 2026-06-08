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
import dns from 'node:dns'
import { ImapFlow } from 'imapflow'
import { simpleParser } from 'mailparser'
import { createClient } from '@supabase/supabase-js'

// Force IPv4. Vercel's egress often can't route IPv6, and Node may prefer the
// AAAA record — so the TCP connect to imap.gmail.com:993 silently hangs (SMTP
// send works because nodemailer resolves differently). This makes every DNS
// lookup return IPv4 first; we also resolve an A record explicitly below.
dns.setDefaultResultOrder('ipv4first')

// Per-run caps. The function must NOT depend on draining the whole mailbox in one
// HTTP request — it pulls a small batch, advances the cursor, and returns; the
// next run (cron or manual) continues from the saved cursor. Small batch + a
// wall-clock budget keep every invocation well under the function timeout.
const MAX_PER_RUN = 15          // messages per mailbox per run — keep one invocation short

// === HARD wall-clock guarantees ============================================
// imapflow's built-in timeouts proved unreliable on Vercel — a connect/op can
// hang at a layer they don't catch, and the whole invocation gets killed at the
// platform limit. So we race EVERY network step against our own setTimeout and
// hard-cap the whole handler. The function ALWAYS returns within ~HANDLER_BUDGET.
const HANDLER_BUDGET_MS = 25000 // absolute ceiling — return partial rather than hang
const CONNECT_TIMEOUT_MS = 12000 // connect()+auth must settle within this
const STEP_TIMEOUT_MS = 15000   // any single open/fetch/parse step
const RUN_BUDGET_MS = 18000     // graceful per-run budget (below the hard cap) — stop, persist cursor, return

// imapflow's own timeouts (belt-and-suspenders; the Promise.race below is the real guard).
const IMAP_TIMEOUTS = {
  connectionTimeout: 12000,
  greetingTimeout: 10000,
  socketTimeout: 25000,
}

const MAILBOXES = [
  { name: 'INBOX', direction: 'inbound' },
  { name: '[Gmail]/Sent Mail', direction: 'outbound' },
]

const lc = (s) => (s ? String(s).toLowerCase().trim() : null)
const snippetOf = (t) => (t || '').replace(/\s+/g, ' ').trim().slice(0, 200)

// Race a promise against a wall-clock timer. The timer fires regardless of what
// the underlying (possibly-hung) promise is doing — that's the whole point.
function withTimeout(promise, ms, label) {
  let t
  const timer = new Promise((_, reject) => {
    t = setTimeout(() => reject(new Error(`timeout:${label} after ${ms}ms`)), ms)
  })
  return Promise.race([Promise.resolve(promise), timer]).finally(() => clearTimeout(t))
}

// Tear the IMAP client down on EVERY exit path (success, error, or hard-cap
// timeout) so a hung socket can't keep the function alive. logout() is graceful
// but can itself hang — race it, then force .close().
async function closeClient(client) {
  try { await withTimeout(client.logout(), 3000, 'logout') } catch { /* ignore */ }
  try { client.close() } catch { /* ignore */ }
}

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

async function syncMailbox(client, admin, mailbox, direction, { anchor = false, deadline = 0 } = {}) {
  const { data: state } = await admin.from('email_sync_state').select('last_uid, uid_validity').eq('mailbox', mailbox).maybeSingle()
  let lastUid = Number(state?.last_uid) || 0
  let uidValidity = state?.uid_validity != null ? Number(state.uid_validity) : null
  let processed = 0, maxUid = lastUid, more = false

  // Open/select the mailbox — raced so a hung SELECT can't stall the run.
  const lock = await withTimeout(client.getMailboxLock(mailbox), STEP_TIMEOUT_MS, `open:${mailbox}`)
  console.log(`[email/sync] selected ${mailbox}`)
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
      // Manual iteration so each `.next()` (the network read) can be raced — a
      // bare `for await` would hang invisibly waiting on the server.
      const iter = client.fetch(`${lastUid + 1}:*`, { uid: true, source: true }, { uid: true })[Symbol.asyncIterator]()
      try {
        while (true) {
          // Batch cap OR wall-clock budget → stop, persist cursor, let the next run continue.
          if (processed >= MAX_PER_RUN || (deadline && Date.now() > deadline)) { more = true; break }
          const step = await withTimeout(iter.next(), STEP_TIMEOUT_MS, `fetch:${mailbox}`)
          if (step.done) break
          const msg = step.value
          if (msg.uid <= lastUid) continue       // ':*' always returns the last msg even if below range
          try {
            const parsed = await withTimeout(simpleParser(msg.source), STEP_TIMEOUT_MS, 'parse')
            await upsertParsed(admin, parsed, direction, msg.uid)
          } catch (e) { console.warn('[email/sync] parse/insert failed uid', msg.uid, e?.message) }
          maxUid = Math.max(maxUid, msg.uid)
          processed++
        }
      } finally {
        try { await iter.return?.() } catch { /* ignore — stop the stream */ }
      }
    }
    console.log(`[email/sync] fetched ${processed} from ${mailbox} (more=${more})`)
  } finally {
    lock.release()
  }

  await admin.from('email_sync_state').upsert({
    mailbox, last_uid: maxUid, uid_validity: uidValidity,
    last_run_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  }, { onConflict: 'mailbox' })
  return { mailbox, processed, lastUid: maxUid, more }
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

  // Explicitly resolve an IPv4 (A) record and connect to the IP directly, so we
  // never even attempt the IPv6 route. `servername` keeps TLS SNI + cert
  // validation pointed at the real hostname. Falls back to the hostname if the
  // resolve fails (setDefaultResultOrder('ipv4first') still biases that path).
  let imapHost = 'imap.gmail.com'
  try {
    const addrs = await withTimeout(dns.promises.resolve4('imap.gmail.com'), 4000, 'dns')
    if (addrs && addrs.length) imapHost = addrs[0]
    console.log('[email/sync] resolved imap.gmail.com (A) ->', imapHost)
  } catch (e) {
    console.warn('[email/sync] resolve4 failed, using hostname:', e?.message)
  }

  const client = new ImapFlow({
    host: imapHost, port: 993, secure: true,
    servername: 'imap.gmail.com',      // TLS SNI + cert validation against the real host
    auth: { user: GMAIL_ADDRESS, pass: GMAIL_APP_PASSWORD },
    logger: false,
    tls: { servername: 'imap.gmail.com', family: 4 },
    ...IMAP_TIMEOUTS,            // fail fast on connect/greeting/socket stalls
  })
  // ?anchor=1 → don't import; jump each cursor to the current mailbox tail so
  // future polls only see NEW mail (use once after a clean-slate delete).
  const anchor = String(req.query?.anchor || (typeof req.body === 'object' ? req.body?.anchor : '') || '') === '1'

  // Graceful per-run budget (below the hard cap): each mailbox stops here and
  // persists its cursor, so a manual/browser hit returns quickly and backfill
  // continues on the next run. The hard cap below is the safety net for true hangs.
  const deadline = Date.now() + RUN_BUDGET_MS

  // `results` is mutated as each mailbox completes, so even if the hard cap fires
  // mid-run we can return whatever was imported so far.
  const results = []
  const doWork = async () => {
    console.log('[email/sync] connecting')
    await withTimeout(client.connect(), CONNECT_TIMEOUT_MS, 'connect')
    console.log('[email/sync] connected/authed')
    for (const mb of MAILBOXES) {
      if (Date.now() > deadline) { results.push({ mailbox: mb.name, skipped: 'time_budget', more: true }); continue }
      try { results.push(await syncMailbox(client, admin, mb.name, mb.direction, { anchor, deadline })) }
      catch (e) { results.push({ mailbox: mb.name, error: e?.message || String(e) }) }
    }
  }

  // Hard cap the WHOLE work body. Whatever happens inside, this handler returns
  // within ~HANDLER_BUDGET_MS — a batch, a clear error, or a partial result.
  let outcome
  try {
    outcome = await Promise.race([
      doWork().then(() => ({ kind: 'done' }), (e) => ({ kind: 'error', error: e })),
      new Promise((resolve) => setTimeout(() => resolve({ kind: 'timeout' }), HANDLER_BUDGET_MS)),
    ])
  } finally {
    await closeClient(client)   // tear down on success, error, AND hard-cap timeout
  }

  if (outcome.kind === 'error') {
    const detail = outcome.error?.message || String(outcome.error)
    console.error('[email/sync] failed:', detail)
    const code = /^timeout:connect\b/.test(detail) ? 'imap_connect_timeout' : 'imap_failed'
    return res.status(502).json({ error: code, detail, results })
  }
  if (outcome.kind === 'timeout') {
    console.warn('[email/sync] hard cap hit — returning partial')
    return res.status(200).json({ ok: true, anchor, more: true, partial: true, results })
  }

  // `more` true → not fully drained; hit the endpoint again (or wait for cron) to continue.
  const more = results.some(r => r && r.more)
  return res.status(200).json({ ok: true, anchor, more, results })
}
