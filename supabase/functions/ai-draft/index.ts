// =============================================================================
// ai-draft — Supabase Edge Function (Gmail AI draft replies)
// =============================================================================
// Input (JSON): { order_id, mode, balance?, total?, photo_count? }
//   mode ∈ 'reply' | 'request_photo' | 'request_approval' | 'balance_reminder'
//          | 'install_complete' | 'closeout'
// Pulls order context server-side (order + customer + cemetery, the job's proof
// milestones, and the recent order_emails thread), asks Claude Haiku to write a
// warm, professional email body, and returns { subject, body }. The subject is
// computed per mode; the body is AI-generated. NOTHING is sent here — the app
// prefills the composer and a human always sends.
//
// Deploy WITH JWT verification (called from the authenticated app):
//   supabase functions deploy ai-draft
// Secrets: ANTHROPIC_API_KEY (+ GOOGLE_* are unused here). Auto: SUPABASE_URL,
// SUPABASE_SERVICE_ROLE_KEY. The Anthropic key never reaches the browser.
// =============================================================================

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

const MODELS = ['claude-haiku-4-5', 'claude-haiku-4-5-20251001']

const fmtUSD = (n: number | null | undefined) =>
  n == null ? null : `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const SYSTEM = `You write short email replies for Shevchenko Monuments, a family-owned monument company in business since 1919.

Tone: warm and personal, but professional — a real person who knows the family and respects their time. Not a corporate template, not chatty.

Length is the priority. Keep it SHORT: 2–4 short sentences, one brief paragraph (a second only if truly needed), under ~70 words. Never write a long email. Don't over-explain, don't restate the obvious, no filler or throat-clearing — get to the point in the first sentence.

Use the order context provided. Sign off simply as the business (e.g., 'Shevchenko Monuments'). Return the email body only — no subject line, no 'Subject:', no notes.`

// 'polish' mode rewrites the user's OWN draft — preserve their intent + every
// fact/number/name, just improve clarity/flow/tone. Never invent.
const POLISH_SYSTEM = `You are polishing an email the user drafted for Shevchenko Monuments (family-owned monument company, est. 1919). Rewrite it to be clear, warm, and professional — fix grammar, flow, and tone. CRITICAL: preserve the writer's intent, meaning, and every fact, number, and name. Do not add information, invent details, or change what they're saying. Keep it concise — a few short sentences, no filler. Return only the polished email body: no preamble, no notes, no subject line.`

const MODE_INSTRUCTION: Record<string, string> = {
  reply: 'Write a reply to the family\'s most recent message (the latest inbound message in the thread below). Address what they said.',
  request_photo: 'Write a short, kind email asking the family to send a photo — for example of the existing marker or the grave/plot — so we can proceed accurately.',
  request_approval: 'Write a short email inviting the family to review and approve the monument proof/layout we have prepared, so we can begin production. Reassure them we will not start until they approve.',
  balance_reminder: 'Write a gentle, low-pressure note that there is a remaining balance on their order (include the amount), with a simple line on how to take care of it whenever they are ready.',
  install_complete: 'Write a warm email letting the family know their monument has been installed at the cemetery, inviting them to visit and to reach out with any questions or concerns.',
  closeout: 'Write a warm closing email for a now-completed order: thank the family for trusting Shevchenko Monuments, confirm the work is finished, let them know we are sharing photos of the completed work (mention they are attached/enclosed if photos exist), and invite them to reach out with any questions or concerns. Warm and gracious, not salesy.',
}
const MODE_SUBJECT: Record<string, string> = {
  request_photo: 'A quick photo request for your monument order',
  request_approval: 'Your monument proof — ready for your approval',
  balance_reminder: 'A note about your monument order',
  install_complete: 'Your monument has been installed',
  closeout: 'Your monument is complete — thank you',
}

async function callClaude(apiKey: string, system: string, userText: string) {
  let lastErr = ''
  for (const model of MODELS) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, max_tokens: 512, system, messages: [{ role: 'user', content: userText }] }),
    })
    const data = await res.json()
    if (res.ok) {
      const text = (data.content ?? []).filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n').trim()
      if (text) return { ok: true, text }
      lastErr = 'empty_completion'
    } else {
      lastErr = data?.error?.message ?? `status_${res.status}`
      // Only fall through to the dated alias on a model-resolution error.
      const isModelErr = res.status === 404 || /model/i.test(lastErr)
      if (!isModelErr) break
    }
  }
  return { ok: false, error: lastErr }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
  const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY') ?? ''
  if (!ANTHROPIC_API_KEY) return json({ error: 'server_not_configured' }, 500)

  let payload: { order_id?: string; mode?: string; balance?: number; total?: number; draft_text?: string; photo_count?: number }
  try { payload = await req.json() } catch { return json({ error: 'invalid_json' }, 400) }
  const { order_id, mode } = payload
  const isPolish = mode === 'polish'
  const draftText = (payload.draft_text || '').trim()
  if (!order_id || !mode || (!isPolish && !MODE_INSTRUCTION[mode])) return json({ error: 'missing_or_bad_input' }, 400)
  if (isPolish && !draftText) return json({ error: 'missing_draft_text' }, 400)

  const rest = (path: string) => `${SUPABASE_URL}/rest/v1/${path}`
  const restHeaders = { apikey: SERVICE_ROLE, Authorization: `Bearer ${SERVICE_ROLE}` }

  try {
    // 1. Order + customer + cemetery.
    const oRes = await fetch(
      rest(`orders?id=eq.${order_id}&select=*,customer:customers(*),cemetery:cemeteries(*)&limit=1`),
      { headers: restHeaders },
    )
    const orders = oRes.ok ? await oRes.json() : []
    const order = Array.isArray(orders) ? orders[0] : null
    if (!order) return json({ error: 'order_not_found' }, 404)

    // 2. Job proof milestones (proof/approval status).
    const jRes = await fetch(
      rest(`jobs?order_id=eq.${order_id}&select=overall_status,milestones:job_milestones(milestone_key,status)&limit=1`),
      { headers: restHeaders },
    )
    const jobs = jRes.ok ? await jRes.json() : []
    const job = Array.isArray(jobs) ? jobs[0] : null
    const ms: Array<{ milestone_key: string; status: string }> = job?.milestones ?? []
    const done = (k: string) => ms.some(m => m.milestone_key === k && m.status === 'done')
    const proofStatus = (done('proof_approved') || done('bronze_proof_approved')) ? 'approved by the family'
      : (done('proof_sent') || done('bronze_proof_sent')) ? 'sent — awaiting the family\'s approval'
      : (done('proof_created') || done('bronze_proof_created')) ? 'drafted internally'
      : 'not started'

    // 3. Recent thread.
    const tRes = await fetch(
      rest(`order_emails?order_id=eq.${order_id}&select=direction,from_email,to_email,subject,snippet,body,sent_at&order=sent_at.desc&limit=8`),
      { headers: restHeaders },
    )
    const thread = tRes.ok ? await tRes.json() : []
    const latestInbound = (Array.isArray(thread) ? thread : []).find((e: any) => e.direction === 'inbound')

    // 4. Build the context block.
    const cust = order.customer || {}
    const customerName = [cust.first_name, cust.last_name].filter(Boolean).join(' ') || 'the family'
    const deceased = Array.isArray(order.deceased) ? order.deceased : []
    const deceasedLine = deceased
      .filter((d: any) => d && (d.firstName || d.lastName))
      .map((d: any) => {
        const nm = [d.firstName, d.lastName].filter(Boolean).join(' ')
        const b = (d.dateOfBirth || '').slice(0, 4), dd = (d.dateOfDeath || '').slice(0, 4)
        return b || dd ? `${nm} (${b || '?'}–${dd || '?'})` : nm
      }).join('; ') || '—'
    const dims = [order.width_inches, order.depth_inches, order.thickness_inches, order.height_inches]
      .filter((v: any) => v != null && v !== '').map((v: any) => `${v}"`).join(' × ') || '—'

    const ctxLines = [
      `Customer: ${customerName}`,
      `Order #: ${order.order_number || 'draft'}`,
      `In memory of: ${deceasedLine}`,
      `Cemetery: ${order.cemetery?.name || '—'}`,
      `Monument: ${order.granite_color || '—'} · ${order.shape || '—'} · ${dims}`,
      `Proof / approval status: ${proofStatus}`,
      `Order total: ${fmtUSD(payload.total) || 'unknown'} · Balance due: ${fmtUSD(payload.balance) ?? 'unknown'}`,
    ]
    // Completion photos (closeout mode) — count comes from the client, which
    // already listed orders-attachments-public/<order_id>/completion/.
    if (typeof payload.photo_count === 'number' && payload.photo_count > 0) {
      ctxLines.push(`Completion photos available to share: ${payload.photo_count}`)
    }
    if (Array.isArray(thread) && thread.length) {
      ctxLines.push('', 'Recent email thread (newest first):')
      for (const e of thread.slice(0, 6)) {
        const who = e.direction === 'inbound' ? `From ${e.from_email}` : `Sent to ${e.to_email}`
        ctxLines.push(`- [${e.direction}] ${who} · "${e.subject || '(no subject)'}": ${(e.body || e.snippet || '').slice(0, 400)}`)
      }
    }

    // 5. Generate. Polish rewrites the user's own draft (context is tone-only,
    //    not a source of new facts); other modes generate fresh from context.
    const system = isPolish ? POLISH_SYSTEM : SYSTEM
    const userText = isPolish
      ? `Polish the email below. Preserve its meaning and every fact, number, and name. The order context is for TONE ONLY — do not pull new facts from it.\n\nORDER CONTEXT (tone reference only):\n${ctxLines.join('\n')}\n\nEMAIL TO POLISH:\n${draftText}`
      : `${MODE_INSTRUCTION[mode]}\n\nORDER CONTEXT:\n${ctxLines.join('\n')}`
    const ai = await callClaude(ANTHROPIC_API_KEY, system, userText)
    if (!ai.ok) {
      console.error('[ai-draft] claude failed:', ai.error)
      return json({ error: 'ai_failed', detail: ai.error }, 502)
    }

    // 6. Polish returns the body only (never overwrites the caller's subject).
    if (isPolish) return json({ ok: true, body: ai.text })

    // Generate modes — subject per mode; replies echo the inbound subject.
    let subject = MODE_SUBJECT[mode] || 'Your monument order'
    if (mode === 'reply') {
      const s = (latestInbound?.subject || '').replace(/^\s*(re:\s*)+/i, '').trim()
      subject = s ? `Re: ${s}` : 'Re: your monument order'
    }
    return json({ ok: true, subject, body: ai.text })
  } catch (e) {
    console.error('[ai-draft] error:', e)
    return json({ error: (e as Error)?.message ?? 'unexpected' }, 500)
  }
})
