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

// Cap the per-message download. We persist text bodies + attachment METADATA
// only, so there's no need to pull multi-MB attachments through the sync — a
// single huge email used to hang the fetch step past its timeout and wedge the
// whole sync on that message forever. Attachment metadata comes from the IMAP
// bodystructure (exact, no download); /api/email/attachment pulls full files
// on demand.
const MAX_SOURCE_BYTES = 2 * 1024 * 1024

// Date floor — never import mail older than this. On a FRESH cursor (last_uid = 0)
// the sync seeks to the first message on/after this date (IMAP SINCE) instead of
// crawling from the mailbox start, so the pre-cutoff backlog is skipped entirely.
// Override with EMAIL_SYNC_SINCE (YYYY-MM-DD); default keeps mail from 2025 onward.
const SYNC_SINCE = process.env.EMAIL_SYNC_SINCE || '2025-01-01'

// === HARD wall-clock guarantees ============================================
// imapflow's built-in timeouts proved unreliable on Vercel — a connect/op can
// hang at a layer they don't catch, and the whole invocation gets killed at the
// platform limit. So we race EVERY network step against our own setTimeout and
// hard-cap the whole handler. The function ALWAYS returns within ~HANDLER_BUDGET.
const HANDLER_BUDGET_MS = 50000 // absolute ceiling — return partial rather than hang
const CONNECT_TIMEOUT_MS = 12000 // connect()+auth must settle within this
const STEP_TIMEOUT_MS = 30000   // any single open/fetch/parse step (Sent Mail's
                                // SELECT was blowing the old 15s on every run
                                // 2026-07-20 — Gmail is slow opening big boxes)
const RUN_BUDGET_MS = 40000     // graceful per-run budget (below the hard cap) — stop, persist cursor, return

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

// Walk an IMAP bodystructure tree and collect attachment metadata — filename,
// content type, size — without downloading any bytes. Mirrors what mailparser
// reports from a full source, but stays correct when the source was truncated.
function attachmentsFromStructure(node, out = []) {
  if (!node) return out
  const disp = (node.disposition || '').toLowerCase()
  const filename = node.dispositionParameters?.filename || node.parameters?.name || null
  const type = node.type || null
  if ((disp === 'attachment' || filename) && !/^multipart\//i.test(type || '')) {
    out.push({ filename, contentType: type, size: node.size || null })
  }
  for (const child of (node.childNodes || [])) attachmentsFromStructure(child, out)
  return out
}

async function upsertParsed(admin, parsed, direction, uid, bodyStructure) {
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

  // Attachment metadata: prefer the bodystructure walk (exact even when the
  // source download was capped); fall back to what mailparser saw.
  const structAtts = attachmentsFromStructure(bodyStructure)
  const attachmentMeta = structAtts.length ? structAtts
    : (parsed.attachments || []).map(a => ({ filename: a.filename || null, contentType: a.contentType || null, size: a.size || null }))

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
    has_attachments: attachmentMeta.length > 0,
    attachments: attachmentMeta,
    order_id: orderId,
    customer_id: customerId,
    imap_uid: uid,
    sent_at: direction === 'outbound' ? dateIso : null,
    // received_at is the tab's sort/window column for BOTH directions — a
    // null here made every synced sent message invisible (all 10k of them
    // sorted behind the 3000-row window; Paul 2026-07-20). dateIso is the
    // message's own header date either way.
    received_at: dateIso,
    is_read: direction === 'outbound',          // our own sent mail is "read"; inbound starts unread
  }, { onConflict: 'gmail_message_id', ignoreDuplicates: true })
  return true
}

// Fetch a UID range and import each message (parse + dedup upsert). Shares the
// per-run cap via `alreadyDone`; `skipAtOrBelow` drops the trailing ':*' echo that
// IMAP returns for open-ended ranges. Returns count + the highest UID seen.
async function importRange(client, admin, mailbox, direction, range, skipAtOrBelow, deadline, alreadyDone) {
  let processed = 0, maxUid = 0, more = false
  const iter = client.fetch(range, { uid: true, source: { maxLength: MAX_SOURCE_BYTES }, bodyStructure: true }, { uid: true })[Symbol.asyncIterator]()
  try {
    while (true) {
      if ((alreadyDone + processed) >= MAX_PER_RUN || (deadline && Date.now() > deadline)) { more = true; break }
      const step = await withTimeout(iter.next(), STEP_TIMEOUT_MS, `fetch:${mailbox}`)
      if (step.done) break
      const msg = step.value
      if (msg.uid <= skipAtOrBelow) continue
      try {
        const parsed = await withTimeout(simpleParser(msg.source), STEP_TIMEOUT_MS, 'parse')
        await upsertParsed(admin, parsed, direction, msg.uid, msg.bodyStructure)
      } catch (e) { console.warn('[email/sync] parse/insert failed uid', msg.uid, e?.message) }
      if (msg.uid > maxUid) maxUid = msg.uid
      processed++
    }
  } finally { try { await iter.return?.() } catch { /* ignore — stop the stream */ } }
  return { processed, maxUid, more }
}

// Newest-first sync. Two cursors live in email_sync_state (no migration — extra
// rows keyed by mailbox name):
//   `${mailbox}`      TOP  — highest UID imported; catches NEW mail as it arrives.
//   `${mailbox}:back` BACK — lowest UID imported; walked DOWN toward the date floor
//                            so recent history backfills newest-first.
// First newest-first run (no BACK row) re-anchors TOP to the tail, abandoning any
// in-progress old forward crawl so fresh mail lands immediately.
async function syncMailbox(client, admin, mailbox, direction, { deadline = 0 } = {}) {
  const { data: topRow } = await admin.from('email_sync_state').select('last_uid, uid_validity').eq('mailbox', mailbox).maybeSingle()
  const { data: backRow } = await admin.from('email_sync_state').select('last_uid').eq('mailbox', `${mailbox}:back`).maybeSingle()
  const { data: floorRow } = await admin.from('email_sync_state').select('last_uid, uid_validity').eq('mailbox', `${mailbox}:floor`).maybeSingle()
  // GAP LANE (Paul, 2026-07-20: "start with recent then work to old") — when
  // an outage leaves a big hole between topUid and the tail, the newest batch
  // imports FIRST and the middle of the hole drains DOWNWARD through these
  // two cursors instead of crawling up from six days ago.
  const { data: gapHighRow } = await admin.from('email_sync_state').select('last_uid').eq('mailbox', `${mailbox}:gap_high`).maybeSingle()
  const { data: gapLowRow } = await admin.from('email_sync_state').select('last_uid').eq('mailbox', `${mailbox}:gap_low`).maybeSingle()
  let gapHigh = gapHighRow?.last_uid != null ? Number(gapHighRow.last_uid) : null
  let gapLow = gapLowRow?.last_uid != null ? Number(gapLowRow.last_uid) : null
  let gapTouched = false
  let uidValidity = topRow?.uid_validity != null ? Number(topRow.uid_validity) : null
  let topUid = Number(topRow?.last_uid) || 0
  let backUid = null
  let floorUid = null
  let floorComputed = false
  let processed = 0, more = false

  const lock = await withTimeout(client.getMailboxLock(mailbox), STEP_TIMEOUT_MS, `open:${mailbox}`)
  console.log(`[email/sync] selected ${mailbox}`)
  try {
    const box = client.mailbox
    const curValidity = Number(box.uidValidity)
    const validityChanged = uidValidity != null && curValidity !== uidValidity
    uidValidity = curValidity
    const tail = Math.max(0, Number(box.uidNext || 1) - 1)

    if (backRow == null || backRow.last_uid == null || validityChanged) {
      topUid = tail            // abandon any old forward crawl; new mail only from here
      backUid = tail + 1       // backfill starts at the tail and walks DOWN
      if (validityChanged) { gapHigh = null; gapLow = null; gapTouched = true }   // UIDs renumbered — the lane is meaningless
    } else {
      backUid = Number(backRow.last_uid) || (tail + 1)
    }

    if (box.exists > 0) {
      // 1. NEW arrivals FIRST — this must never be starved by backfill work.
      // When the hole between topUid and the tail is BIG (cron outage), the
      // NEWEST batch imports now and the rest of the hole becomes a gap lane
      // drained downward in step 1.5 — recent mail lands on the first pass
      // instead of after days of oldest-first crawling.
      if (tail > topUid && processed < MAX_PER_RUN) {
        const gapActive = gapHigh != null && gapLow != null && gapHigh > gapLow
        const hole = tail - topUid
        if (!gapActive && hole > MAX_PER_RUN * 2) {
          const from = tail - MAX_PER_RUN + 1
          const r = await importRange(client, admin, mailbox, direction, `${from}:*`, topUid, deadline, processed)
          processed += r.processed
          gapHigh = from - 1
          gapLow = topUid
          gapTouched = true
          topUid = Math.max(topUid, r.maxUid, tail)
          more = true
        } else {
          const r = await importRange(client, admin, mailbox, direction, `${topUid + 1}:*`, topUid, deadline, processed)
          processed += r.processed
          if (r.maxUid > topUid) topUid = r.maxUid
          if (r.more) more = true
        }
      }

      // 1.5 GAP LANE — drain the outage hole newest-first, one batch per run.
      if (gapHigh != null && gapLow != null && gapHigh > gapLow &&
          processed < MAX_PER_RUN && (!deadline || Date.now() < deadline)) {
        const from = Math.max(gapLow + 1, gapHigh - MAX_PER_RUN + 1)
        const r = await importRange(client, admin, mailbox, direction, `${from}:${gapHigh}`, 0, deadline, processed)
        processed += r.processed
        gapHigh = from - 1
        gapTouched = true
        if (gapHigh > gapLow) more = true
      }

      // 2. BACKFILL newest-first — the batch just below the back cursor.
      // Floor = lowest UID on/after SYNC_SINCE. The IMAP SINCE search is
      // expensive on a big mailbox, so the result is CACHED in email_sync_state
      // (`${mailbox}:floor`) and recomputed only if uidValidity changes.
      if (processed < MAX_PER_RUN && (!deadline || Date.now() < deadline)) {
        if (floorRow?.last_uid != null && !validityChanged && Number(floorRow.uid_validity) === curValidity) {
          floorUid = Number(floorRow.last_uid)
        } else if (SYNC_SINCE) {
          try {
            const sinceUids = await withTimeout(client.search({ since: new Date(`${SYNC_SINCE}T00:00:00Z`) }, { uid: true }), STEP_TIMEOUT_MS, `search:${mailbox}`)
            floorUid = (Array.isArray(sinceUids) && sinceUids.length) ? sinceUids.reduce((m, u) => (u < m ? u : m), sinceUids[0]) : tail + 1
            floorComputed = true
          } catch (e) { console.warn(`[email/sync] ${mailbox} since-search failed:`, e?.message); floorUid = null }
        } else {
          floorUid = 1
          floorComputed = true
        }
        if (floorUid != null && backUid > floorUid && processed < MAX_PER_RUN && (!deadline || Date.now() < deadline)) {
          const from = Math.max(floorUid, backUid - MAX_PER_RUN)
          const r = await importRange(client, admin, mailbox, direction, `${from}:${backUid - 1}`, 0, deadline, processed)
          processed += r.processed
          backUid = from
          if (from > floorUid) more = true
        }
      } else if (backUid > 1) {
        more = true   // backfill didn't get a turn this run
      }
    }
    console.log(`[email/sync] ${mailbox}: +${processed} (top=${topUid} back=${backUid} floor=${floorUid} more=${more})`)
  } finally {
    lock.release()
  }

  const stamp = new Date().toISOString()
  await admin.from('email_sync_state').upsert({ mailbox, last_uid: topUid, uid_validity: uidValidity, last_run_at: stamp, updated_at: stamp }, { onConflict: 'mailbox' })
  if (backUid != null) {
    await admin.from('email_sync_state').upsert({ mailbox: `${mailbox}:back`, last_uid: backUid, uid_validity: uidValidity, last_run_at: stamp, updated_at: stamp }, { onConflict: 'mailbox' })
  }
  if (floorComputed && floorUid != null) {
    await admin.from('email_sync_state').upsert({ mailbox: `${mailbox}:floor`, last_uid: floorUid, uid_validity: uidValidity, last_run_at: stamp, updated_at: stamp }, { onConflict: 'mailbox' })
  }
  if (gapTouched) {
    await admin.from('email_sync_state').upsert({ mailbox: `${mailbox}:gap_high`, last_uid: gapHigh, uid_validity: uidValidity, last_run_at: stamp, updated_at: stamp }, { onConflict: 'mailbox' })
    await admin.from('email_sync_state').upsert({ mailbox: `${mailbox}:gap_low`, last_uid: gapLow, uid_validity: uidValidity, last_run_at: stamp, updated_at: stamp }, { onConflict: 'mailbox' })
  }
  return { mailbox, processed, more }
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
    // Alternate which mailbox goes first (minute parity): INBOX-first runs
    // were eating the whole budget and Sent Mail NEVER got a fresh window —
    // its open timed out on every pass (2026-07-20). Odd minutes lead with
    // Sent so each box regularly gets the front of the run budget.
    const boxes = (new Date().getMinutes() % 2 === 1) ? [...MAILBOXES].reverse() : MAILBOXES
    for (const mb of boxes) {
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

  // Retention sweeps ride every successful sync run (best-effort, DB-only).
  let pruned = 0, hidden = 0
  try { pruned = await pruneOldEmailBodies(admin) } catch (e) { console.warn('[email/sync] prune failed:', e?.message) }
  try { hidden = await hideOldEmails(admin) } catch (e) { console.warn('[email/sync] hide failed:', e?.message) }

  // `more` true → not fully drained; hit the endpoint again (or wait for cron) to continue.
  const more = results.some(r => r && r.more)
  return res.status(200).json({ ok: true, anchor, more, pruned, hidden, results })
}

// =============================================================================
// 6-MONTH EMAIL RETENTION (STORAGE-1, Paul 2026-09-17)
// =============================================================================
// "I want every email after 6 months attachments to not be saved... the email
// traffic can still save... because they are saved in the gmail."
// Audit truth: attachment BYTES were never stored (messages.attachments is
// filename/size metadata; files pull from Gmail on demand). The 7 GB was
// body_html — inline-image HTML the app never renders (thread views read
// body_text). So retention = null out body_html after 6 months and drop any
// hydrated attachment-cache files in storage, stamping body_pruned_at.
// Subject / snippet / body_text / order links keep forever; Gmail keeps the
// original, and a click on an old attachment re-hydrates from Gmail as always.
// ~PRUNE_BATCH rows per cron run → a fresh backlog drains in under a day.
// =============================================================================
const RETENTION_DAYS = 183
const PRUNE_BATCH = 300
const EMAIL_ATT_BUCKET = 'orders-attachments-public'

// Effective-age filter: 76% of rows (backfilled inbound) carry NULL sent_at
// but a real received_at (audit 2026-09-17 — a sent_at-only filter silently
// skips 40k rows and most of the 7 GB). PostgREST or-syntax for
// coalesce(sent_at, received_at) < cutoff.
const olderThan = (cutoffISO) =>
  `sent_at.lt.${cutoffISO},and(sent_at.is.null,received_at.lt.${cutoffISO})`

async function pruneOldEmailBodies(admin) {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 86400000).toISOString()
  const { data: victims, error } = await admin
    .from('messages')
    .select('id, attachments')
    .is('body_pruned_at', null)
    .or(olderThan(cutoff))
    .order('created_at', { ascending: true })
    .limit(PRUNE_BATCH)
  if (error) throw new Error(error.message)
  if (!victims || victims.length === 0) return 0

  const stamp = new Date().toISOString()
  const plain = []      // no hydrated cache — one bulk update
  for (const v of victims) {
    const atts = Array.isArray(v.attachments) ? v.attachments : []
    const hydrated = atts.some(a => a && a.path)
    if (!hydrated) { plain.push(v.id); continue }
    // Hydrated cache: delete the storage files, strip path/url from the
    // metadata (a later click re-hydrates from Gmail), then prune the row.
    const paths = atts.filter(a => a && a.path).map(a => a.path)
    try { await admin.storage.from(EMAIL_ATT_BUCKET).remove(paths) }
    catch (e) { console.warn('[email/sync] prune: cache remove failed', v.id, e?.message) }
    const cleaned = atts.map(({ path, url, ...rest }) => rest)
    const { error: rowErr } = await admin.from('messages')
      .update({ body_html: null, body_pruned_at: stamp, attachments: cleaned })
      .eq('id', v.id)
    if (rowErr) console.warn('[email/sync] prune: row update failed', v.id, rowErr.message)
  }
  if (plain.length) {
    const { error: bulkErr } = await admin.from('messages')
      .update({ body_html: null, body_pruned_at: stamp })
      .in('id', plain)
    if (bulkErr) throw new Error(bulkErr.message)
  }
  console.log(`[email/sync] retention: pruned ${victims.length} bodies older than ${RETENTION_DAYS}d`)
  return victims.length
}

// =============================================================================
// EMAIL VISIBILITY WINDOW (STORAGE-1 round 2, Paul 2026-09-17)
// =============================================================================
// "i only want emails linked to an order existing over six months to 2 years.
// if its not linked directly to an order and its older than 6 months remove it
// from stonebooks (dont delete it just i dont want to see it)."
// Soft-hide, NEVER a delete: stamp messages.hidden_at when
//   • order_id IS NULL and effective age > 6 months, or
//   • effective age > 2 years (even order-linked).
// Every client reader filters hidden_at IS NULL; the row (and its Gmail
// original) survives, so un-hiding is just clearing the stamp. Customer-linked
// without an order counts as NOT linked (Paul: "linked directly to an order").
// =============================================================================
const HIDE_UNLINKED_DAYS = 183
const HIDE_ALL_DAYS = 730
const HIDE_BATCH = 2000

async function hideOldEmails(admin) {
  const stamp = new Date().toISOString()
  const cut6 = new Date(Date.now() - HIDE_UNLINKED_DAYS * 86400000).toISOString()
  const cut24 = new Date(Date.now() - HIDE_ALL_DAYS * 86400000).toISOString()
  let total = 0

  // Pass 1 — unlinked mail past 6 months.
  const p1 = await admin.from('messages')
    .select('id')
    .is('hidden_at', null)
    .is('order_id', null)
    .or(olderThan(cut6))
    .limit(HIDE_BATCH)
  if (p1.error) throw new Error(p1.error.message)
  // Pass 2 — anything past 2 years, order-linked or not.
  const p2 = await admin.from('messages')
    .select('id')
    .is('hidden_at', null)
    .not('order_id', 'is', null)
    .or(olderThan(cut24))
    .limit(HIDE_BATCH)
  if (p2.error) throw new Error(p2.error.message)

  const ids = [...new Set([...(p1.data || []), ...(p2.data || [])].map(r => r.id))]
  if (ids.length === 0) return 0
  // Chunked stamp — one fat .in() can blow the URL/statement limits.
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500)
    const { error } = await admin.from('messages')
      .update({ hidden_at: stamp })
      .in('id', chunk)
    if (error) throw new Error(error.message)
    total += chunk.length
  }
  console.log(`[email/sync] visibility: hid ${total} (unlinked>${HIDE_UNLINKED_DAYS}d or all>${HIDE_ALL_DAYS}d)`)
  return total
}
