// =============================================================================
// approve-submit — Edge Function (Approval Packet, PUBLIC).
// =============================================================================
// The /approve/<token> page posts the DRAWN signature (PNG), typed name, and
// consent. SERVICE ROLE; re-validates the token, then runs the WHOLE lock flow
// server-side (the anon client never writes the private bucket or app tables):
//   1. Stamp the signature PNG + name/date into the immutable unsigned packet at
//      the stored sig rect (pdf-lib, mm->pt + origin flip) + an ESIGN/UETA cert page.
//   2. Pin the signed packet to the PRIVATE bucket at
//      orders-attachments-private/<order_id>/approval-signed.pdf.
//   3. Upload the signature PNG to the proof-signatures bucket; stamp the
//      proof_versions row (approved_at / approved_by_name / signature_method /
//      signature_url).
//   4. Flip the proof_approved milestone to 'done' (+ a job_events row).
//   5. Write an order_activity entry ("Customer approved & signed").
//   6. Mark the link 'signed' (audit: ip / user-agent / consent_at).
//
// action: 'approve' (default) runs the flow above. action: 'request_changes'
// records a customer rejection WITHOUT a signed PDF — notes go to job_events
// (same event_type the internal staff "request changes" flow uses) + the order
// timeline, and the link is stamped 'changes_requested'. Shop-side milestone
// routing + the re-approval block land in Phase 2.
//
// Deploy WITHOUT JWT:  supabase functions deploy approve-submit --no-verify-jwt
// =============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { PDFDocument, StandardFonts, rgb } from 'https://esm.sh/pdf-lib@1.17.1'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

const MM_TO_PT = 72 / 25.4
const PRIVATE_BUCKET = 'orders-attachments-private'
const SIG_BUCKET = 'proof-signatures'
const TENANT_ID = 'a1b2c3d4-e5f6-7890-abcd-ef0123456789'

function bytesFromBase64(b64: string): Uint8Array {
  const clean = b64.replace(/^data:[^;]+;base64,/, '')
  const bin = atob(clean)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}
async function sha256Hex(input: string | Uint8Array): Promise<string> {
  const data = typeof input === 'string' ? new TextEncoder().encode(input) : input
  const digest = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('')
}
function wrapText(text: string, max: number): string[] {
  const words = (text || '').split(/\s+/); const lines: string[] = []; let line = ''
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

  let body: { token?: string; signer_name?: string; consent?: boolean; signature_image?: string; action?: string; change_notes?: string }
  try { body = await req.json() } catch { return json({ error: 'invalid_json' }, 400) }
  const token = (body.token || '').trim()
  const action = body.action === 'request_changes' ? 'request_changes' : 'approve'
  const signerName = (body.signer_name || '').trim()
  const sigImage = body.signature_image || ''
  const changeNotes = (body.change_notes || '').trim()
  if (!token) return json({ error: 'missing_token' }, 400)
  if (action === 'approve') {
    if (body.consent !== true) return json({ error: 'consent_required' }, 400)
    if (!signerName) return json({ error: 'missing_signer_name' }, 400)
    if (!sigImage) return json({ error: 'missing_signature' }, 400)
  } else {
    if (!changeNotes) return json({ error: 'missing_change_notes' }, 400)
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } })
  const tokenHash = await sha256Hex(token)

  const { data: link, error: linkErr } = await admin
    .from('approval_links')
    .select('id, order_id, proof_version_id, status, expires_at, unsigned_pdf_path, sig_field_rects, viewed_at')
    .eq('token_hash', tokenHash)
    .maybeSingle()
  if (linkErr) return json({ error: 'lookup_failed' }, 500)
  if (!link) return json({ error: 'not_found' }, 404)
  if (link.status === 'signed') return json({ error: 'already_signed' }, 409)
  if (link.status === 'revoked') return json({ error: 'revoked' }, 409)
  if (link.status === 'changes_requested') return json({ error: 'changes_requested' }, 409)
  const nowMs = Date.now()
  if (link.status === 'expired' || (link.expires_at && new Date(link.expires_at).getTime() < nowMs)) {
    if (link.status !== 'expired') await admin.from('approval_links').update({ status: 'expired' }).eq('id', link.id)
    return json({ error: 'expired' }, 410)
  }

  // ── REQUEST CHANGES branch (Phase 1) ────────────────────────────────────────
  // No PDF, no signature, no signed-bucket write. Record the rejection to the
  // audit trail (job_events mirrors the internal staff "request changes" flow)
  // + the order timeline, and stamp the link terminal. Shop-side milestone
  // routing + the re-approval block land in Phase 2.
  if (action === 'request_changes') {
    const nowIso = new Date(nowMs).toISOString()
    const reqIp = (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || null
    const reqUa = req.headers.get('user-agent') || null

    let versionNumber: number | null = null
    let jobId: string | null = null
    const { data: pvRow } = await admin
      .from('proof_versions').select('id, job_id, version_number').eq('id', link.proof_version_id).maybeSingle()
    if (pvRow) { versionNumber = pvRow.version_number; jobId = pvRow.job_id }

    const today = nowIso.slice(0, 10)

    // Audit event (the notes store) — same event_type the internal flow writes.
    if (jobId) {
      const { data: job } = await admin.from('jobs').select('tenant_id').eq('id', jobId).maybeSingle()
      await admin.from('job_events').insert({
        tenant_id: job?.tenant_id || TENANT_ID,
        job_id: jobId,
        event_type: 'proof_changes_requested',
        milestone_key: 'proof_sent',
        note: `Customer requested changes${versionNumber ? ` (v${versionNumber})` : ''}: ${changeNotes}`,
        payload: { version_id: link.proof_version_id, version_number: versionNumber, requested_by: signerName || 'Customer', source: 'remote_approval' },
      })

      // Shop-side routing: flip the queryable "revision pending" signal
      // (proof_changes_requested -> in_progress) and send the proof back to
      // "not sent" so staff re-send a NEW version. proof_approved is NEVER
      // touched. Direct updates here intentionally bypass the in-app
      // updateMilestone readiness gate (this is the system acting on a
      // validated customer action).
      //
      // UPSERT, not blind-update: proof_changes_requested was only added to the
      // new_stone template (20260530); non-new_stone / pre-20260530 jobs never
      // seeded it, so a bare UPDATE would match zero rows and silently no-op.
      // No (job_id, milestone_key) unique constraint exists, so do it by hand —
      // insert inherits tenant/team/group/sort from the proof_sent sibling so it
      // satisfies job_milestones_team_check and lands in the design phase.
      const { data: pcr } = await admin.from('job_milestones')
        .select('id').eq('job_id', jobId).eq('milestone_key', 'proof_changes_requested').maybeSingle()
      const { data: psib } = await admin.from('job_milestones')
        .select('*').eq('job_id', jobId).eq('milestone_key', 'proof_sent').maybeSingle()
      if (pcr) {
        await admin.from('job_milestones')
          .update({ status: 'in_progress', status_date: today, updated_at: nowIso }).eq('id', pcr.id)
      } else {
        await admin.from('job_milestones').insert({
          tenant_id: psib?.tenant_id || TENANT_ID, job_id: jobId, milestone_key: 'proof_changes_requested',
          label: 'Changes requested', group: psib?.group || 'design', team: psib?.team || 'sales',
          requires: ['proof_sent'], cascades_to: [], is_decision: false,
          status: 'in_progress', status_date: today, sort_order: psib?.sort_order ?? 5, updated_at: nowIso,
        })
      }
      await admin.from('job_milestones')
        .update({ status: 'not_started', updated_at: nowIso })
        .eq('job_id', jobId).eq('milestone_key', 'proof_sent')
    }

    // Send the linked proof version back to "not sent" (mirror the internal flow).
    await admin.from('proof_versions').update({ sent_at: null }).eq('id', link.proof_version_id)

    // Order timeline (primary, automatic).
    await admin.from('order_activity').insert({
      tenant_id: TENANT_ID, order_id: link.order_id, type: 'change', field: 'Approval',
      old_value: link.status, new_value: 'changes_requested',
      note: `Customer requested changes: ${changeNotes}`, actor: signerName || 'Customer',
    })

    // Stamp the link terminal (audit-complete row).
    await admin.from('approval_links').update({
      status: 'changes_requested', changes_requested_at: nowIso, change_notes: changeNotes,
      signer_name: signerName || null, signer_ip: reqIp, signer_user_agent: reqUa,
    }).eq('id', link.id)

    return json({ ok: true, status: 'changes_requested' })
  }

  const signerIp = (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || null
  const userAgent = req.headers.get('user-agent') || null
  const signedAtIso = new Date(nowMs).toISOString()

  // Load the immutable unsigned packet.
  const { data: dl, error: dlErr } = await admin.storage.from(PRIVATE_BUCKET).download(link.unsigned_pdf_path)
  if (dlErr || !dl) return json({ error: 'snapshot_unavailable' }, 500)
  const unsignedBytes = new Uint8Array(await dl.arrayBuffer())
  const docHash = await sha256Hex(unsignedBytes)

  // Stamp the DRAWN signature + name/date with pdf-lib.
  let signedBytes: Uint8Array
  let sigPngBytes: Uint8Array
  try { sigPngBytes = bytesFromBase64(sigImage) } catch { return json({ error: 'bad_signature_encoding' }, 400) }
  try {
    const pdf = await PDFDocument.load(unsignedBytes)
    const font = await pdf.embedFont(StandardFonts.Helvetica)
    const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold)
    const sigPng = await pdf.embedPng(sigPngBytes)
    const page = pdf.getPages()[0]
    const pageH = page.getHeight()

    const r = link.sig_field_rects || {}
    if (r && r.w && r.h) {
      const boxX = r.x * MM_TO_PT, boxW = r.w * MM_TO_PT, boxH = r.h * MM_TO_PT
      const boxYBottom = pageH - r.y * MM_TO_PT - boxH
      // Contain-fit the signature image inside the rect (preserve aspect).
      const dims = sigPng.scale(1)
      const s = Math.min(boxW / dims.width, boxH / dims.height)
      const iw = dims.width * s, ih = dims.height * s
      page.drawImage(sigPng, { x: boxX + (boxW - iw) / 2, y: boxYBottom + (boxH - ih) / 2, width: iw, height: ih })
      // Typed name + date just under the signature box.
      const dateStr = new Date(nowMs).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
      page.drawText(`${signerName}  ·  ${dateStr}`, { x: boxX + 2, y: boxYBottom - 9, size: 8, font, color: rgb(0.1, 0.12, 0.14) })
    }

    // ESIGN/UETA certificate page.
    const cert = pdf.addPage([page.getWidth(), pageH])
    const M = 56
    let cy = pageH - 64
    const line = (txt: string, o: { size?: number; bold?: boolean; gap?: number; color?: [number, number, number] } = {}) => {
      const size = o.size ?? 10
      cert.drawText(txt, { x: M, y: cy, size, font: o.bold ? fontBold : font, color: rgb(...(o.color ?? [0.1, 0.12, 0.14])) })
      cy -= (o.gap ?? size + 6)
    }
    line('ELECTRONIC APPROVAL CERTIFICATE', { size: 15, bold: true, gap: 26 })
    line('This certificate documents the electronic approval of the attached monument', { size: 9, color: [0.4, 0.45, 0.5] })
    line('layout proof under the U.S. ESIGN Act and UETA.', { size: 9, color: [0.4, 0.45, 0.5], gap: 22 })
    const field = (label: string, value: string) => {
      cert.drawText(label, { x: M, y: cy, size: 9, font: fontBold, color: rgb(0.3, 0.34, 0.38) })
      const vlines = wrapText(value || '—', 78)
      vlines.forEach((vl, i) => cert.drawText(vl, { x: M + 150, y: cy - i * 12, size: 9, font, color: rgb(0.1, 0.12, 0.14) }))
      cy -= Math.max(18, vlines.length * 12 + 6)
    }
    field('Order', link.order_id)
    field('Approver name', signerName)
    field('Consent', 'Accepted — "I have reviewed this layout and approve it to be produced."')
    field('IP address', signerIp || '—')
    field('Device / browser', userAgent || '—')
    field('Opened (viewed) at', link.viewed_at || '—')
    field('Approved at', signedAtIso)
    field('Document SHA-256', docHash)
    cy -= 8
    wrapText(
      'The approver affirmed their intent to approve this layout and to transact electronically. The SHA-256 hash above is computed over the original unsigned packet bytes and binds this certificate to that exact document. Shevchenko Monuments, LLC retains this record.',
      92,
    ).forEach((d) => { cert.drawText(d, { x: M, y: cy, size: 8.5, font, color: rgb(0.4, 0.45, 0.5) }); cy -= 12 })

    signedBytes = await pdf.save()
  } catch (e) {
    return json({ error: 'stamp_failed', detail: (e as Error).message }, 500)
  }

  // 2. Pin the signed packet (the path OrderDetail's getApprovalSigned reads).
  const signedPath = `${link.order_id}/approval-signed.pdf`
  const { error: upErr } = await admin.storage
    .from(PRIVATE_BUCKET).upload(signedPath, signedBytes, { contentType: 'application/pdf', upsert: true })
  if (upErr) return json({ error: 'save_failed', detail: upErr.message }, 500)

  // 3. Stamp the proof_versions row (+ store the signature PNG privately).
  let sigUrlPath: string | null = null
  const { data: pv } = await admin
    .from('proof_versions').select('id, job_id').eq('id', link.proof_version_id).maybeSingle()
  if (pv) {
    sigUrlPath = `signatures/${pv.job_id}/${pv.id}.png`
    await admin.storage.from(SIG_BUCKET).upload(sigUrlPath, sigPngBytes, { contentType: 'image/png', upsert: true })
    await admin.from('proof_versions').update({
      approved_at: signedAtIso,
      approved_by_name: signerName,
      signature_method: 'e_signature',
      signature_url: sigUrlPath,
    }).eq('id', pv.id)

    // 4. Flip the proof_approved milestone to done (+ job_events row).
    if (pv.job_id) {
      const { data: ms } = await admin.from('job_milestones')
        .select('id, status, tenant_id').eq('job_id', pv.job_id).eq('milestone_key', 'proof_approved').maybeSingle()
      if (ms && ms.status !== 'done') {
        const today = signedAtIso.slice(0, 10)
        await admin.from('job_milestones')
          .update({ status: 'done', status_date: today, updated_at: signedAtIso }).eq('id', ms.id)
        await admin.from('job_events').insert({
          tenant_id: ms.tenant_id || TENANT_ID, job_id: pv.job_id,
          event_type: 'milestone_status_changed', milestone_key: 'proof_approved',
          payload: { from: ms.status, to: 'done', source: 'remote_approval' },
        })
      }
    }
  }

  // 5. Order activity entry.
  await admin.from('order_activity').insert({
    tenant_id: TENANT_ID, order_id: link.order_id, type: 'change', field: 'Approval',
    old_value: 'pending', new_value: 'signed',
    note: `Customer approved & signed (${signerName})`, actor: signerName,
  })

  // 6. Mark the link signed.
  await admin.from('approval_links').update({
    status: 'signed', signed_at: signedAtIso,
    signer_name: signerName, signer_ip: signerIp, signer_user_agent: userAgent, consent_at: signedAtIso,
  }).eq('id', link.id)

  const { data: signedUrlData } = await admin.storage.from(PRIVATE_BUCKET).createSignedUrl(signedPath, 600)
  return json({ ok: true, status: 'signed', signed_url: signedUrlData?.signedUrl || '' })
})
