// =============================================================================
// /api/ai/inquiry-reply — draft a reply to a website inquiry with Claude
// =============================================================================
// INQUIRIES-2 (Paul 2026-10-08): "have an AI generated response" for the
// follow-up email on an inquiry. The browser sends the inquiry (name, form,
// their message, interest) + the email chain so far; this returns ONE draft
// in the shop's voice, grounded only in what we know — no invented prices,
// no promises. The draft lands in the composer; staff still read, retype and
// send through the confirm gate (send-safety doctrine). Vercel Node function.
//
// Server-only env (set in Vercel, NEVER in client/repo):
//   ANTHROPIC_API_KEY          = the Anthropic API key
//   SUPABASE_URL (or VITE_SUPABASE_URL) + SUPABASE_SERVICE_ROLE_KEY — caller check
// Auth: the browser passes the staff member's Supabase JWT; portal users are
// rejected (same gate as /api/email/send).
// =============================================================================
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'

const MODEL = 'claude-opus-5-5'

const SYSTEM = `You write customer emails for Shevchenko Monuments, a family-run monument company in New Jersey (shop phone 732-442-1286). You are drafting a reply to a person who filled out a form on the website.

Voice: warm, plain, respectful of a grieving family, never salesy or flowery. Short paragraphs. No bullet lists unless listing the services. No emojis. No subject line.

Rules:
- Use only facts given to you. Never invent prices, lead times, cemetery rules, or what the shop has done before.
- If they said what they are looking for, speak to that. If not, ask which it is: a new headstone or monument, a bronze marker or memorial plaque, adding an inscription to an existing monument, or something custom.
- If the cemetery is unknown, ask for the cemetery name and plot/section so the shop can check that cemetery's regulations and allowed sizes, and offer photos of work done there.
- If the shop already emailed them and they have not answered, write a brief, kind follow-up that references the earlier note without repeating it, and makes replying easy.
- If they replied with a question, answer what can be answered from the facts given and say the shop will confirm the rest.
- Offer, where it fits, to send photos of options, an estimate, or to set up a visit or a call.
- Sign off exactly as: "Warm regards,\\n{signoff}". Open with "Hi {first name}," when a first name is known, else "Hello,".
Return only the email body text.`

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })

  const API_KEY = process.env.ANTHROPIC_API_KEY
  if (!API_KEY) return res.status(500).json({ error: 'ai_not_configured' })
  const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY

  const admin = (SUPABASE_URL && SERVICE_ROLE)
    ? createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } })
    : null
  if (admin) {
    const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '')
    if (!token) return res.status(401).json({ error: 'not_authenticated' })
    const { data: caller, error: callerErr } = await admin.auth.getUser(token)
    if (callerErr || !caller?.user) return res.status(401).json({ error: 'not_authenticated' })
    const { data: partner } = await admin.from('partner_users').select('id').eq('auth_user_id', caller.user.id).maybeSingle()
    if (partner) return res.status(403).json({ error: 'forbidden' })
  }

  let body = req.body
  if (typeof body === 'string') { try { body = JSON.parse(body) } catch { return res.status(400).json({ error: 'invalid_json' }) } }
  const { inquiry = {}, thread = [], staff = null } = body || {}

  const first = String(inquiry.name || '').trim().split(/\s+/)[0] || ''
  const signoff = staff ? `${staff}\nShevchenko Monuments` : 'The Shevchenko Monuments Team'
  const facts = [
    `Name: ${inquiry.name || '(unknown)'}${first ? ` (first name: ${first})` : ''}`,
    `Form they used: ${inquiry.form || '(unknown)'}`,
    `Their message: ${inquiry.message ? `"${String(inquiry.message).slice(0, 2000)}"` : '(none — just the form)'}`,
    `What they said they want: ${inquiry.interest || '(not picked yet)'}`,
    `Cemetery: ${inquiry.cemetery || '(unknown)'}`,
    `Submitted: ${inquiry.submittedAt || '(unknown)'}`,
  ].join('\n')
  const chain = (Array.isArray(thread) ? thread : []).slice(-8).map(m =>
    `[${m.direction === 'outbound' ? 'SHOP → them' : 'THEM → shop'} · ${m.at || ''}] ${m.subject ? `Subject: ${m.subject}\n` : ''}${String(m.text || '').slice(0, 1500)}`
  ).join('\n\n---\n\n')

  const user = `${facts}\n\nEmail chain so far (oldest first):\n${chain || '(nothing sent yet)'}\n\nSign-off to use verbatim at the end: ${signoff}\n\nWrite the reply now.`

  const client = new Anthropic({ apiKey: API_KEY })
  const params = {
    model: MODEL,
    max_tokens: 2000,
    output_config: { effort: 'medium' },
    system: SYSTEM.replace('{signoff}', signoff),
    messages: [{ role: 'user', content: user }],
  }
  let response
  try {
    // Server-side refusal fallback (routes by category; no model list to maintain).
    response = await client.beta.messages.create({ ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' })
  } catch (e) {
    if (e instanceof Anthropic.BadRequestError) {
      // A platform/plan without the fallback beta — same request, plain path.
      try { response = await client.messages.create(params) } catch (e2) { return res.status(502).json({ error: 'ai_failed', detail: e2?.message || String(e2) }) }
    } else if (e instanceof Anthropic.AuthenticationError) {
      return res.status(500).json({ error: 'ai_not_configured', detail: 'Invalid ANTHROPIC_API_KEY' })
    } else {
      return res.status(502).json({ error: 'ai_failed', detail: e?.message || String(e) })
    }
  }
  if (response.stop_reason === 'refusal') return res.status(502).json({ error: 'ai_refused', detail: response.stop_details?.explanation || 'declined' })
  const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim()
  if (!text) return res.status(502).json({ error: 'ai_empty' })
  return res.status(200).json({ ok: true, text, model: response.model })
}
