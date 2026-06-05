// =============================================================================
// signing-submit — Supabase Edge Function (Remote e-signing, step R4)
// =============================================================================
// PUBLIC endpoint (no staff login). The /sign/<token> page posts the typed name
// + consent (type-name-to-cursive — no drawn image). Runs as SERVICE ROLE,
// re-validates the token, stamps the name into the immutable unsigned snapshot in
// the SAME Dancing Script cursive the signer saw (embedded via fontkit) plus the
// date, appends an ESIGN/UETA audit certificate page, stores signed.pdf, flips
// the request to 'signed' and the order to 'contracted', and returns a signed URL
// to the finished PDF for the customer to download.
//
// Deploy WITHOUT JWT verification:
//   supabase functions deploy signing-submit --no-verify-jwt
//
// Coordinate note: the snapshot is produced by jsPDF (TOP-LEFT origin, mm). The
// stored sig_field_rects carry {unit:'mm', origin:'top-left', pageWidth/Height,
// customer_signature, customer_date}. pdf-lib uses a BOTTOM-LEFT origin in
// points, so each rect is converted mm->pt and flipped against page height.
//
// Auto-injected secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
// =============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { PDFDocument, StandardFonts, rgb } from 'https://esm.sh/pdf-lib@1.17.1'
import fontkit from 'https://esm.sh/@pdf-lib/fontkit@1.1.1'
import { DANCING_SCRIPT_BASE64 } from './dancingScript.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

const MM_TO_PT = 72 / 25.4

function bytesFromBase64(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}
async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('')
}
function wrapText(text: string, max: number): string[] {
  const words = (text || '').split(/\s+/)
  const lines: string[] = []
  let line = ''
  for (const w of words) {
    if ((line + ' ' + w).trim().length > max) { if (line) lines.push(line); line = w }
    else line = (line + ' ' + w).trim()
  }
  if (line) lines.push(line)
  return lines
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
  const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  if (!SUPABASE_URL || !SERVICE_ROLE) return json({ error: 'server_not_configured' }, 500)

  let body: { token?: string; signer_name?: string; consent?: boolean }
  try { body = await req.json() } catch { return json({ error: 'invalid_json' }, 400) }
  const token = (body.token || '').trim()
  const signerName = (body.signer_name || '').trim()
  if (!token) return json({ error: 'missing_token' }, 400)
  if (body.consent !== true) return json({ error: 'consent_required' }, 400)
  if (!signerName) return json({ error: 'missing_signer_name' }, 400)

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } })

  // Re-validate the token.
  const { data: reqRow, error: reqErr } = await admin
    .from('signature_requests')
    .select('id, order_id, status, expires_at, unsigned_pdf_path, sig_field_rects, customer_email, viewed_at')
    .eq('token', token)
    .maybeSingle()
  if (reqErr) return json({ error: 'lookup_failed' }, 500)
  if (!reqRow) return json({ error: 'not_found' }, 404)
  if (reqRow.status === 'signed') return json({ error: 'already_signed' }, 409)
  if (reqRow.status === 'voided') return json({ error: 'voided' }, 409)
  const nowMs = Date.now()
  if (reqRow.status === 'expired' || (reqRow.expires_at && new Date(reqRow.expires_at).getTime() < nowMs)) {
    if (reqRow.status !== 'expired') await admin.from('signature_requests').update({ status: 'expired' }).eq('id', reqRow.id)
    return json({ error: 'expired' }, 410)
  }

  // Audit capture.
  const signerIp = (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || null
  const userAgent = req.headers.get('user-agent') || null
  const signedAtIso = new Date(nowMs).toISOString()

  // Load the immutable unsigned snapshot.
  const { data: dl, error: dlErr } = await admin.storage.from('signatures').download(reqRow.unsigned_pdf_path)
  if (dlErr || !dl) return json({ error: 'snapshot_unavailable' }, 500)
  const unsignedBytes = new Uint8Array(await dl.arrayBuffer())
  const docHash = await sha256Hex(unsignedBytes)

  // Stamp signature + date with pdf-lib.
  let signedBytes: Uint8Array
  try {
    const pdf = await PDFDocument.load(unsignedBytes)
    pdf.registerFontkit(fontkit)
    const font = await pdf.embedFont(StandardFonts.Helvetica)
    const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold)
    // Dancing Script — the SAME cursive the signer saw on the /sign page, embedded
    // (subset) into the output PDF so the stamped signature matches exactly.
    const scriptFont = await pdf.embedFont(bytesFromBase64(DANCING_SCRIPT_BASE64), { subset: true })
    const page = pdf.getPages()[0]
    const pageH = page.getHeight()

    const rects = reqRow.sig_field_rects || {}
    const sigRect = rects.customer_signature
    const dateRect = rects.customer_date

    // Cursive signature — the typed name in Dancing Script, drawn ON the signature
    // line and auto-sized down to fit the box width.
    if (sigRect) {
      const boxX = sigRect.x * MM_TO_PT
      const boxW = sigRect.w * MM_TO_PT
      const boxH = sigRect.h * MM_TO_PT
      const boxYBottom = pageH - sigRect.y * MM_TO_PT - boxH
      const maxW = boxW - 6
      let size = 22
      while (size > 9 && scriptFont.widthOfTextAtSize(signerName, size) > maxW) size -= 1
      page.drawText(signerName, { x: boxX + 3, y: boxYBottom + 2, size, font: scriptFont, color: rgb(0.06, 0.08, 0.1) })
    }

    // Date — long format to match the page ("June 5, 2026"), drawn in the date box.
    if (dateRect) {
      const dateStr = new Date(nowMs).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
      const boxH = dateRect.h * MM_TO_PT
      const boxYBottom = pageH - dateRect.y * MM_TO_PT - boxH
      page.drawText(dateStr, { x: dateRect.x * MM_TO_PT + 3, y: boxYBottom + 2, size: 11, font, color: rgb(0.06, 0.08, 0.1) })
    }

    // ── Audit certificate page (Letter, matches contract) ──
    const cert = pdf.addPage([page.getWidth(), pageH])
    const M = 56
    let cy = pageH - 64
    const line = (txt: string, opts: { size?: number; bold?: boolean; gap?: number; color?: [number, number, number] } = {}) => {
      const size = opts.size ?? 10
      cert.drawText(txt, { x: M, y: cy, size, font: opts.bold ? fontBold : font, color: rgb(...(opts.color ?? [0.1, 0.12, 0.14])) })
      cy -= (opts.gap ?? size + 6)
    }
    line('ELECTRONIC SIGNATURE CERTIFICATE', { size: 15, bold: true, gap: 26 })
    line('This certificate documents the electronic signing of the attached contract', { size: 9, color: [0.4, 0.45, 0.5] })
    line('under the U.S. ESIGN Act and the Uniform Electronic Transactions Act (UETA).', { size: 9, color: [0.4, 0.45, 0.5], gap: 22 })

    const field = (label: string, value: string) => {
      cert.drawText(label, { x: M, y: cy, size: 9, font: fontBold, color: rgb(0.3, 0.34, 0.38) })
      const vlines = wrapText(value || '—', 78)
      vlines.forEach((vl, i) => {
        cert.drawText(vl, { x: M + 150, y: cy - i * 12, size: 9, font, color: rgb(0.1, 0.12, 0.14) })
      })
      cy -= Math.max(18, vlines.length * 12 + 6)
    }
    field('Order', reqRow.order_id)
    field('Signer name', signerName)
    field('Signer email', reqRow.customer_email || '—')
    field('Consent', 'Accepted — "I have reviewed this contract and agree to sign it electronically."')
    field('IP address', signerIp || '—')
    field('Device / browser', userAgent || '—')
    field('Opened (viewed) at', reqRow.viewed_at || '—')
    field('Signed at', signedAtIso)
    field('Document SHA-256', docHash)

    cy -= 8
    const disclaimer =
      'The signer affirmed their intent to sign and to conduct this transaction electronically. ' +
      'The SHA-256 hash above is computed over the original unsigned contract bytes and binds this ' +
      'certificate to that exact document. Shevchenko Monuments, LLC retains this record.'
    wrapText(disclaimer, 92).forEach((dl2) => {
      cert.drawText(dl2, { x: M, y: cy, size: 8.5, font, color: rgb(0.4, 0.45, 0.5) })
      cy -= 12
    })

    signedBytes = await pdf.save()
  } catch (e) {
    return json({ error: 'stamp_failed', detail: (e as Error).message }, 500)
  }

  // Store signed.pdf alongside the unsigned snapshot.
  const signedPath = reqRow.unsigned_pdf_path.replace(/unsigned\.pdf$/, 'signed.pdf')
  const { error: upErr } = await admin.storage
    .from('signatures').upload(signedPath, signedBytes, { contentType: 'application/pdf', upsert: true })
  if (upErr) return json({ error: 'save_failed', detail: upErr.message }, 500)

  // Mark the request signed (audit fields).
  const { error: updErr } = await admin.from('signature_requests').update({
    status: 'signed',
    signed_at: signedAtIso,
    signed_pdf_path: signedPath,
    signer_name: signerName,
    signer_ip: signerIp,
    signer_user_agent: userAgent,
    consent_at: signedAtIso,
  }).eq('id', reqRow.id)
  if (updErr) return json({ error: 'update_failed', detail: updErr.message }, 500)

  // Flip the order to contracted — mirrors the in-app signing status change.
  // (Job creation stays on the existing backfill path; remote signing does not
  // run the client-side createJobFromOrder. See R5 / backfill follow-up.)
  await admin.from('orders').update({
    status: 'contracted',
    signed_at: signedAtIso,
    pricing_locked_at: signedAtIso,
  }).eq('id', reqRow.order_id)

  // Short-lived signed URL so the customer can download immediately.
  const { data: signedUrlData } = await admin.storage.from('signatures').createSignedUrl(signedPath, 600)

  return json({ ok: true, status: 'signed', signed_url: signedUrlData?.signedUrl || '' })
})
