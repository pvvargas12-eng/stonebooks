// =============================================================================
// /api/email/send — Vercel Node serverless function (Gmail Path B, Phase G2)
// =============================================================================
// Sends a shop email through Gmail SMTP using the single shared account's App
// Password, then logs an OUTBOUND row in `messages`. Node runtime (not Deno) —
// nodemailer for SMTP. Every Stonebooks email routes here (the client falls back
// to the legacy gmail-send Edge Function if this endpoint isn't deployed yet).
//
// Server-only env (set in Vercel, NEVER in client/repo):
//   GMAIL_ADDRESS            = shevcoteam@gmail.com
//   GMAIL_APP_PASSWORD       = the 16-char App Password
//   SUPABASE_URL             (or VITE_SUPABASE_URL)
//   SUPABASE_SERVICE_ROLE_KEY  (for caller verification + messages logging)
//
// Auth: the browser passes the staff member's Supabase JWT in Authorization;
// we verify it (and reject portal users) before sending.
// =============================================================================
import nodemailer from 'nodemailer'
import { createClient } from '@supabase/supabase-js'

const stripTags = (html) => (html ? String(html).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : '')

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })

  const GMAIL_ADDRESS = process.env.GMAIL_ADDRESS
  const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD
  const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!GMAIL_ADDRESS || !GMAIL_APP_PASSWORD) {
    return res.status(500).json({ error: 'server_not_configured' })
  }

  // Verify the caller is authenticated STAFF (not a portal user).
  const admin = (SUPABASE_URL && SERVICE_ROLE)
    ? createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } })
    : null
  if (admin) {
    const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '')
    if (!token) return res.status(401).json({ error: 'not_authenticated' })
    const { data: caller, error: callerErr } = await admin.auth.getUser(token)
    if (callerErr || !caller?.user) return res.status(401).json({ error: 'not_authenticated' })
    const { data: partner } = await admin
      .from('partner_users').select('id').eq('auth_user_id', caller.user.id).maybeSingle()
    if (partner) return res.status(403).json({ error: 'forbidden' })
  }

  let body = req.body
  if (typeof body === 'string') { try { body = JSON.parse(body) } catch { return res.status(400).json({ error: 'invalid_json' }) } }
  const { to, subject, html, text, attachments, order_id, customer_id, in_reply_to, references } = body || {}
  const toList = (Array.isArray(to) ? to : (to ? [to] : [])).map(s => String(s).trim()).filter(Boolean)
  if (!toList.length) return res.status(400).json({ error: 'missing_to' })

  const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,             // STARTTLS on 587
    auth: { user: GMAIL_ADDRESS, pass: GMAIL_APP_PASSWORD },
  })

  // attachments: [{ filename, contentBase64, contentType }]
  const mailAttachments = (Array.isArray(attachments) ? attachments : [])
    .filter(a => a && a.filename && a.contentBase64)
    .map(a => ({ filename: a.filename, content: Buffer.from(a.contentBase64, 'base64'), contentType: a.contentType || undefined }))

  const headers = {}
  if (in_reply_to) headers['In-Reply-To'] = in_reply_to
  if (references) headers['References'] = Array.isArray(references) ? references.join(' ') : references

  let info
  try {
    info = await transporter.sendMail({
      from: GMAIL_ADDRESS,
      to: toList.join(', '),
      subject: subject || '(no subject)',
      text: text || (html ? stripTags(html) : undefined),
      html: html || undefined,
      attachments: mailAttachments,
      headers,
    })
  } catch (e) {
    return res.status(502).json({ error: 'send_failed', detail: e?.message || String(e) })
  }

  // Log the outbound row (best-effort — a logging miss must not fail the send).
  if (admin) {
    try {
      const ref0 = references ? (Array.isArray(references) ? references[0] : String(references).split(/\s+/)[0]) : null
      const threadKey = ref0 || in_reply_to || info.messageId || null
      await admin.from('messages').insert({
        gmail_message_id: info.messageId || null,
        thread_key: threadKey,
        direction: 'outbound',
        from_email: GMAIL_ADDRESS,
        to_emails: toList,
        subject: subject || null,
        body_text: text || null,
        body_html: html || null,
        snippet: (text || stripTags(html) || '').slice(0, 200),
        has_attachments: mailAttachments.length > 0,
        attachments: mailAttachments.map(a => ({ filename: a.filename, contentType: a.contentType || null })),
        order_id: order_id || null,
        customer_id: customer_id || null,
        sent_at: new Date().toISOString(),
        is_read: true,
      })
    } catch (e) {
      console.warn('[email/send] messages insert failed:', e?.message)
    }
  }

  return res.status(200).json({ ok: true, messageId: info.messageId || null })
}
