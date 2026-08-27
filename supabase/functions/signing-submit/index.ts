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

  let body: { token?: string; signer_name?: string; consent?: boolean; signature_png?: string }
  try { body = await req.json() } catch { return json({ error: 'invalid_json' }, 400) }
  const token = (body.token || '').trim()
  const signerName = (body.signer_name || '').trim()
  // Optional hand-DRAWN signature (PB-ESIGN permits): a transparent PNG of the
  // customer's strokes, stamped as an image instead of the cursive text.
  const signaturePng = (body.signature_png || '').trim() || null
  if (!token) return json({ error: 'missing_token' }, 400)
  if (body.consent !== true) return json({ error: 'consent_required' }, 400)
  if (!signerName) return json({ error: 'missing_signer_name' }, 400)
  if (signaturePng && signaturePng.length > 1_400_000) return json({ error: 'signature_too_large' }, 400)

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } })

  // Re-validate the token.
  const { data: reqRow, error: reqErr } = await admin
    .from('signature_requests')
    .select('id, order_id, kind, status, expires_at, unsigned_pdf_path, sig_field_rects, customer_email, viewed_at')
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
    // Contract rects always sit on page 1; permit rects (PB-ESIGN) carry an
    // optional per-rect `page` (0-based) since the signature box can live on
    // any form page. Missing/old rects default to page 1.
    const allPages = pdf.getPages()
    const pageFor = (r: { page?: number } | null | undefined) =>
      allPages[Math.min(Math.max(0, r?.page ?? 0), allPages.length - 1)]
    const page = allPages[0]
    const pageH = page.getHeight()

    const rects = reqRow.sig_field_rects || {}
    const sigRect = rects.customer_signature
    const dateRect = rects.customer_date

    // Hand-drawn signature image (when the signer drew one) — else the typed
    // name in Dancing Script, drawn ON the signature line and auto-sized down
    // to fit the box width.
    let drawnImg: Awaited<ReturnType<typeof pdf.embedPng>> | null = null
    if (signaturePng) {
      try { drawnImg = await pdf.embedPng(bytesFromBase64(signaturePng)) } catch { drawnImg = null }
    }
    if (sigRect) {
      const sigPage = pageFor(sigRect)
      const sigPageH = sigPage.getHeight()
      const boxX = sigRect.x * MM_TO_PT
      const boxW = sigRect.w * MM_TO_PT
      const boxH = sigRect.h * MM_TO_PT
      const boxYBottom = sigPageH - sigRect.y * MM_TO_PT - boxH
      if (drawnImg) {
        // Contain-fit the drawing over the line, bottom-anchored; a signature
        // may ride a little taller than the box the way real ink does.
        const scale = Math.min((boxW - 4) / drawnImg.width, (boxH * 1.6) / drawnImg.height)
        const w = drawnImg.width * scale, h = drawnImg.height * scale
        sigPage.drawImage(drawnImg, { x: boxX + 2, y: boxYBottom + 1, width: w, height: h })
      } else {
        const maxW = boxW - 6
        let size = 22
        while (size > 9 && scriptFont.widthOfTextAtSize(signerName, size) > maxW) size -= 1
        sigPage.drawText(signerName, { x: boxX + 3, y: boxYBottom + 2, size, font: scriptFont, color: rgb(0.06, 0.08, 0.1) })
      }
      // Permits: stamp the signing date in small type just under the signature
      // box (permits have no dedicated date rect — the form's own date lines
      // are filled by staff; this documents WHEN the e-signature landed).
      if (reqRow.kind === 'permit' && !dateRect) {
        const dateStr = new Date(nowMs).toLocaleDateString('en-US', {
          timeZone: 'America/New_York', year: 'numeric', month: 'numeric', day: 'numeric',
        })
        sigPage.drawText(`Signed electronically ${dateStr}`, {
          x: boxX + 3, y: Math.max(6, boxYBottom - 8), size: 6.5, font, color: rgb(0.35, 0.38, 0.42),
        })
      }
    }

    // Date — numeric M/D/YYYY in SHOP time (the builder-formats rule; a 9pm ET
    // signature must not stamp tomorrow's UTC date), drawn in the date box.
    if (dateRect) {
      const dPage = pageFor(dateRect)
      const dPageH = dPage.getHeight()
      const dateStr = new Date(nowMs).toLocaleDateString('en-US', {
        timeZone: 'America/New_York', year: 'numeric', month: 'numeric', day: 'numeric',
      })
      const boxH = dateRect.h * MM_TO_PT
      const boxYBottom = dPageH - dateRect.y * MM_TO_PT - boxH
      dPage.drawText(dateStr, { x: dateRect.x * MM_TO_PT + 3, y: boxYBottom + 2, size: 11, font, color: rgb(0.06, 0.08, 0.1) })
    }

    // Printed name — the typed name in plain type on the Printed Name line
    // (older links carry no rect; they simply skip this).
    const pnRect = rects.customer_printed_name
    if (pnRect) {
      const pPage = pageFor(pnRect)
      const pPageH = pPage.getHeight()
      const boxH = pnRect.h * MM_TO_PT
      const boxYBottom = pPageH - pnRect.y * MM_TO_PT - boxH
      pPage.drawText(signerName, { x: pnRect.x * MM_TO_PT + 3, y: boxYBottom + 2, size: 10, font, color: rgb(0.06, 0.08, 0.1) })
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
    const docWord = reqRow.kind === 'permit' ? 'permit' : 'contract'
    line('ELECTRONIC SIGNATURE CERTIFICATE', { size: 15, bold: true, gap: 26 })
    line(`This certificate documents the electronic signing of the attached ${docWord}`, { size: 9, color: [0.4, 0.45, 0.5] })
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
    field('Signature method', drawnImg ? 'Hand-drawn on screen' : 'Typed name rendered in cursive')
    field('Signer email', reqRow.customer_email || '—')
    field('Consent', `Accepted — "I have reviewed this ${docWord} and agree to sign it electronically."`)
    field('IP address', signerIp || '—')
    field('Device / browser', userAgent || '—')
    field('Opened (viewed) at', reqRow.viewed_at || '—')
    field('Signed at', signedAtIso)
    field('Document SHA-256', docHash)

    cy -= 8
    const disclaimer =
      'The signer affirmed their intent to sign and to conduct this transaction electronically. ' +
      `The SHA-256 hash above is computed over the original unsigned ${docWord} bytes and binds this ` +
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

  if (reqRow.kind === 'permit') {
    // PERMIT signings (PB-ESIGN): no order-status side effects at all. The
    // signed permit ALSO lands in the order's public attachments folder so
    // listOrderAttachments (OrderDetail, Sales email picker, Permit Builder
    // rail) surfaces it like any staff upload. Best-effort — the signing
    // itself already succeeded.
    const dateStamp = new Date(nowMs).toLocaleDateString('en-US', {
      timeZone: 'America/New_York', year: 'numeric', month: 'numeric', day: 'numeric',
    })
    try {
      const attPath = `attachments/${reqRow.order_id}/${reqRow.id}_Permit_SIGNED_${dateStamp.replace(/\//g, '-')}.pdf`
      await admin.storage.from('orders-attachments-public')
        .upload(attPath, signedBytes, { contentType: 'application/pdf', upsert: true })
    } catch { /* attachments copy is a convenience */ }

    // Hard copy to the shop inbox so the admin team sees the signed permit
    // land (Paul 2026-08-26). Server-to-server call into our own email relay
    // authenticated with the shared service-role key. Best-effort.
    try {
      // The customer signs on the app's own origin, so the Origin header is
      // the same fallback signing-create uses for building the link.
      const base = (Deno.env.get('SIGN_BASE_URL') || req.headers.get('Origin') || '').replace(/\/+$/, '')
      if (base) {
        const { data: ord } = await admin.from('orders')
          .select('order_number, primary_lastname').eq('id', reqRow.order_id).maybeSingle()
        const fam = ord?.primary_lastname || ''
        const num = ord?.order_number || ''
        const label = [fam, num ? `(${num})` : ''].filter(Boolean).join(' ')
        let b64 = ''
        for (let i = 0; i < signedBytes.length; i += 0x8000) {
          b64 += String.fromCharCode.apply(null, Array.from(signedBytes.subarray(i, i + 0x8000)))
        }
        b64 = btoa(b64)
        const text = `${signerName} signed the cemetery permit electronically on ${dateStamp}.\n\n`
          + `The signed copy is attached, and it's also saved on the order's attachments in Stonebooks${label ? ` (${label})` : ''}.`
        await fetch(`${base}/api/email/send`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SERVICE_ROLE}` },
          body: JSON.stringify({
            to: 'shevcoteam@gmail.com',
            subject: `SIGNED permit — ${label || 'order'} · signed by ${signerName}`,
            text,
            attachments: [{
              filename: `Permit SIGNED - ${(fam || 'permit').replace(/[^\w -]+/g, '')} ${dateStamp.replace(/\//g, '-')}.pdf`,
              contentBase64: b64, contentType: 'application/pdf',
            }],
            order_id: reqRow.order_id,
          }),
        })
      }
    } catch { /* the notification is a convenience — signing already stuck */ }
  } else {
    // Flip the order to contracted — mirrors the in-app signing status change.
    // (Job creation stays on the existing backfill path; remote signing does not
    // run the client-side createJobFromOrder. See R5 / backfill follow-up.)
    await admin.from('orders').update({
      status: 'contracted',
      signed_at: signedAtIso,
      pricing_locked_at: signedAtIso,
      // The typed name IS the printed name — the same field the iPad on-glass
      // flow writes, so regenerated contracts stamp it on the Printed Name line.
      customer_printed_name: signerName,
    }).eq('id', reqRow.order_id)
  }

  // Short-lived signed URL so the customer can download immediately.
  const { data: signedUrlData } = await admin.storage.from('signatures').createSignedUrl(signedPath, 600)

  return json({ ok: true, status: 'signed', signed_url: signedUrlData?.signedUrl || '' })
})
