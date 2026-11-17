// =============================================================================
// PREmailModal — preview the purchase request email before it goes to the
// vendor (PR-EMAIL, Paul 2026-11-17: "I want to see a preview email before it
// goes to the vendor so I can verify the right things, also an always CC
// option").
// =============================================================================
// Shows the vendor sheet PDF, the To box (the supplier's email on file), the
// CC box (on by default, remembered per browser), the subject and the message.
// Preview and send opens ConfirmSend, the send-safety gate: exact recipients,
// CC, subject, the letter with every line in a table, the PDF name. Nothing is
// sent before that gold button. No order or PR row is written here.
// =============================================================================
import { useState, useEffect, useRef } from 'react'
import { getBulkOrderWithItems, listSuppliers, sendShopEmail } from '../lib/stonebooksData'
import { resolveSpecsForPR, prKind } from '../lib/prKinds'
import { buildPRPdf, orderedRowsOf, structuredOf } from '../lib/prSheet'
import ConfirmSend from './ConfirmSend'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const splitList = (s) => String(s || '').split(/[,;\s]+/).map(x => x.trim()).filter(Boolean)
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const fmtDate = (d) => {
  if (!d) return ''
  const dt = new Date(String(d).slice(0, 10) + 'T00:00:00')
  return isNaN(dt) ? String(d) : dt.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
}

// The people Paul wants copied on every PR. Editable in the box; the box and
// the tick are remembered in this browser.
const DEFAULT_CC = 'chelsea@shevcomonuments.com, lonnie@shevcomonuments.com, pauly_vargas@outlook.com'
const CC_KEY = 'sb_pr_email_cc_v1'
const readCc = () => {
  try { const v = JSON.parse(localStorage.getItem(CC_KEY) || 'null'); if (v && typeof v.list === 'string') return { on: v.on !== false, list: v.list } } catch { /* fall through */ }
  return { on: true, list: DEFAULT_CC }
}

const defaultMessage = (o, rowCount, pieces) => [
  'Hello,',
  '',
  `Please find attached purchase request ${o.po_number || ''} from Shevchenko Monuments: ${rowCount} line${rowCount === 1 ? '' : 's'}, ${pieces} piece${pieces === 1 ? '' : 's'}.${o.supplier_eta ? ` Requested delivery: ${fmtDate(o.supplier_eta)}.` : ''}`,
  '',
  'Please confirm you received it and send back your order acknowledgement with the expected ship date.',
  '',
  'Thank you.',
].join('\n')

export default function PREmailModal({ bulkOrderId, kind = 'stone', onClose, onSent }) {
  const K = prKind(kind)
  const [state, setState] = useState(null)      // { order, rows, pieces, doc, filename }
  const [url, setUrl] = useState(null)
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState('build')     // 'build' | 'send' | null
  const [to, setTo] = useState('')
  const [ccOn, setCcOn] = useState(() => readCc().on)
  const [cc, setCc] = useState(() => readCc().list)
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')
  const [gate, setGate] = useState(false)
  const [sent, setSent] = useState(null)
  const urlRef = useRef(null)

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const [r, sup] = await Promise.all([getBulkOrderWithItems(bulkOrderId), listSuppliers().catch(() => ({ rows: [] }))])
        if (!alive) return
        if (!r.ok) { setErr(r.error || 'Could not load the PR.'); setBusy(null); return }
        const o = r.order || {}
        const items = r.items || []
        const { lineSpec, attach } = await resolveSpecsForPR(kind, items)
        const b = await buildPRPdf(o, items, lineSpec, kind, attach)
        if (!alive) return
        const blobUrl = URL.createObjectURL(b.doc.output('blob'))
        if (urlRef.current) URL.revokeObjectURL(urlRef.current)
        urlRef.current = blobUrl
        const rows = orderedRowsOf(items, lineSpec).map(it => ({ ...structuredOf(it, lineSpec), item: lineSpec[it.id] || '', qty: it.quantity ?? 1 }))
        const pieces = items.reduce((s, it) => s + (Number(it.quantity) || 0), 0)
        const supplier = (sup.rows || []).find(s => s.id === o.supplier_id) || (sup.rows || []).find(s => String(s.name || '').toLowerCase() === String(o.supplier_name || '').toLowerCase())
        setState({ order: o, rows, pieces, doc: b.doc, filename: b.filename })
        setUrl(blobUrl)
        setTo(supplier?.email || '')
        setSubject(`Purchase Request ${o.po_number || ''} - Shevchenko Monuments`.replace(/\s+/g, ' ').trim())
        setMessage(defaultMessage(o, rows.length, pieces))
        setBusy(null)
      } catch (e) {
        if (alive) { setErr(e?.message || 'Could not build the PR sheet.'); setBusy(null) }
      }
    })()
    return () => { alive = false }
  }, [bulkOrderId, kind])
  useEffect(() => () => { if (urlRef.current) URL.revokeObjectURL(urlRef.current) }, [])
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !gate) onClose?.() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [gate, onClose])

  const saveCc = (on, list) => { try { localStorage.setItem(CC_KEY, JSON.stringify({ on, list })) } catch { /* private window */ } }
  const toList = splitList(to)
  const ccList = ccOn ? splitList(cc) : []
  const toValid = toList.length > 0 && toList.every(a => EMAIL_RE.test(a))
  const ccValid = ccList.every(a => EMAIL_RE.test(a))
  const o = state?.order || {}

  // The letter: the typed message, then every line of the sheet in a table so
  // the lines can be checked in the preview without opening the PDF.
  const cell = 'padding:5px 9px;border:1px solid #d8d8d8;font-size:12.5px;vertical-align:top'
  const head = `${cell};background:#f2f2f2;font-size:11px;text-align:left`
  const table = !state ? '' : (kind === 'stone'
    ? `<table style="border-collapse:collapse;margin:14px 0"><tr>${['FAMILY', 'COLOR', 'TYPE', 'SIZE', 'SPECS', 'QTY'].map(h => `<th style="${head}">${h}</th>`).join('')}</tr>${state.rows.map(r => `<tr><td style="${cell};font-weight:bold">${esc(r.family)}</td><td style="${cell}">${esc(r.color)}</td><td style="${cell}">${esc(r.type)}</td><td style="${cell};white-space:nowrap">${esc(r.size)}</td><td style="${cell}">${esc(r.specs)}</td><td style="${cell};text-align:center">${esc(r.qty)}</td></tr>`).join('')}</table>`
    : `<table style="border-collapse:collapse;margin:14px 0"><tr>${['FAMILY', K.itemHeader.toUpperCase(), 'QTY'].map(h => `<th style="${head}">${h}</th>`).join('')}</tr>${state.rows.map(r => `<tr><td style="${cell};font-weight:bold">${esc(r.family)}</td><td style="${cell}">${esc(r.item || '—')}</td><td style="${cell};text-align:center">${esc(r.qty)}</td></tr>`).join('')}</table>`)
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1a1a1a;line-height:1.5">${esc(message).replace(/\n/g, '<br>')}${table}</div>`
  const textLines = !state ? '' : state.rows.map(r => kind === 'stone'
    ? `${r.qty} x ${r.family} | ${r.color} | ${r.type} | ${r.size} | ${r.specs}`
    : `${r.qty} x ${r.family} | ${r.item || ''}`).join('\n')
  const text = `${message}\n\n${textLines}`

  const send = async (edited) => {
    if (!state || !toValid || !ccValid) return
    setBusy('send'); setErr(null)
    try {
      const contentBase64 = (state.doc.output('datauristring').split('base64,')[1]) || ''
      const res = await sendShopEmail({
        to: toList.join(', '),
        cc: ccList.length ? ccList.join(', ') : undefined,
        subject,
        html: edited?.html || html,
        text: edited?.text || text,
        attachments: [{ filename: state.filename, contentBase64, contentType: 'application/pdf' }],
      })
      if (!res?.ok) { setErr(res?.error || 'The email did not send.'); setGate(false); return }
      const where = `${toList.join(', ')}${ccList.length ? ` (CC ${ccList.join(', ')})` : ''}`
      setSent(where); setGate(false); onSent?.(where)
    } catch (e) {
      setErr(e?.message || 'The email did not send.'); setGate(false)
    } finally {
      setBusy(null)
    }
  }

  const blocked = !state ? 'Building the sheet' : !toValid ? 'Type a valid vendor email address first' : !ccValid ? 'One of the CC addresses does not read as an email' : !subject.trim() ? 'The subject is blank' : null

  return (
    <div className="pre-scrim" onClick={() => !gate && onClose?.()}>
      <style>{PRE_CSS}</style>
      <div className="pre-modal" role="dialog" aria-modal="true" aria-label="Email the purchase request" onClick={e => e.stopPropagation()}>
        <div className="pre-head">
          <div className="pre-head-main">
            <div className="pre-eyebrow">Email to vendor</div>
            <div className="pre-title"><span className="pre-mono">{o.po_number || 'Purchase request'}</span>{o.supplier_name ? <span className="pre-sup">{o.supplier_name}</span> : null}</div>
            {state && <div className="pre-sub">{state.rows.length} line{state.rows.length === 1 ? '' : 's'} · {state.pieces} piece{state.pieces === 1 ? '' : 's'} · the sheet below is attached as {state.filename}</div>}
          </div>
          <button type="button" className="pre-x" onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className="pre-form">
          <label className="pre-row"><span>To</span>
            <input type="text" value={to} onChange={e => setTo(e.target.value)} placeholder="vendor email (set it once under Inventory, Suppliers)" /></label>
          <div className="pre-row">
            <label className="pre-cc-tick"><input type="checkbox" checked={ccOn} onChange={e => { setCcOn(e.target.checked); saveCc(e.target.checked, cc) }} /><span>CC</span></label>
            <input type="text" value={cc} disabled={!ccOn} onChange={e => { setCc(e.target.value); saveCc(ccOn, e.target.value) }} placeholder="copy these people, separated by commas" />
            {cc.trim() !== DEFAULT_CC && <button type="button" className="pre-link" onClick={() => { setCc(DEFAULT_CC); setCcOn(true); saveCc(true, DEFAULT_CC) }}>Reset</button>}
          </div>
          <label className="pre-row"><span>Subject</span>
            <input type="text" value={subject} onChange={e => setSubject(e.target.value)} /></label>
          <label className="pre-row pre-row-top"><span>Message</span>
            <textarea rows={6} value={message} onChange={e => setMessage(e.target.value)} /></label>
          <div className="pre-actions">
            <span className="pre-hint">{blocked ? `${blocked}.` : 'The next screen shows the exact email, lines included. Nothing is sent until you press send there.'}</span>
            <button type="button" className="pre-btn" disabled={!state || !!busy} onClick={() => state.doc.save(state.filename)}>Download PDF</button>
            <button type="button" className="pre-btn pre-btn-gold" disabled={!!blocked || !!busy} title={blocked || 'Preview the email, then send'} onClick={() => setGate(true)}>Preview and send</button>
          </div>
        </div>

        {err && <div className="pre-msg pre-msg-err">{err}</div>}
        {sent && <div className="pre-msg pre-msg-ok">Sent to {sent}.</div>}

        <div className="pre-body">
          {busy === 'build' && <div className="pre-wait">Building the sheet…</div>}
          {url && <iframe title="Purchase request sheet" className="pre-frame" src={`${url}#toolbar=0&navpanes=0`} />}
        </div>
      </div>

      {gate && state && (
        <ConfirmSend
          open
          to={toList.join(', ')}
          cc={ccList.length ? ccList.join(', ') : null}
          subject={subject}
          html={html}
          text={text}
          attachments={[state.filename]}
          busy={busy === 'send'}
          confirmLabel="Send to vendor"
          warning="This goes OUT to the vendor and everyone on CC the moment you press send."
          onConfirm={send}
          onClose={() => !busy && setGate(false)}
        />
      )}
    </div>
  )
}

const PRE_CSS = `
  .pre-scrim{ position:fixed; inset:0; background:rgba(15,20,25,.5); z-index:1250; display:flex; align-items:center; justify-content:center; padding:18px; }
  .pre-modal{ background:var(--sb-surface,#fff); color:var(--sb-text,#111); border-radius:12px; width:min(960px,100%); height:min(95vh,1150px); display:flex; flex-direction:column; box-shadow:0 24px 64px rgba(15,20,25,.3); overflow:hidden; min-width:0; }
  .pre-head{ display:flex; align-items:flex-start; justify-content:space-between; gap:12px; padding:16px 20px 10px; border-bottom:.5px solid var(--sb-border,#e4e0d8); }
  .pre-head-main{ min-width:0; }
  .pre-eyebrow{ font-size:11px; text-transform:uppercase; letter-spacing:.08em; color:var(--sb-text-muted,#73777e); }
  .pre-title{ font-size:20px; font-weight:600; display:flex; gap:10px; align-items:baseline; flex-wrap:wrap; min-width:0; }
  .pre-mono{ font-family:var(--font-m,'JetBrains Mono'),monospace; font-size:18px; overflow-wrap:anywhere; }
  .pre-sup{ font-size:15px; font-weight:400; color:var(--sb-text-muted,#73777e); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:100%; }
  .pre-sub{ font-size:12.5px; color:var(--sb-text-muted,#73777e); margin-top:4px; overflow-wrap:anywhere; }
  .pre-x{ border:none; background:none; font-size:24px; line-height:1; color:var(--sb-text-muted,#73777e); cursor:pointer; padding:2px 6px; }
  .pre-form{ display:flex; flex-direction:column; gap:8px; padding:12px 20px; border-bottom:.5px solid var(--sb-border,#e4e0d8); }
  .pre-row{ display:flex; align-items:center; gap:10px; min-width:0; }
  .pre-row-top{ align-items:flex-start; }
  .pre-row > span, .pre-cc-tick{ flex:0 0 70px; font-size:12px; color:var(--sb-text-muted,#73777e); }
  .pre-cc-tick{ display:flex; align-items:center; gap:6px; cursor:pointer; }
  .pre-cc-tick input{ width:15px; height:15px; accent-color:#9A7209; flex:none; }
  .pre-row input[type=text], .pre-row textarea{ flex:1; min-width:0; font:inherit; font-size:13px; padding:7px 10px; border:.5px solid var(--sb-border,#d8d2c4); border-radius:6px; background:var(--sb-surface,#fff); color:var(--sb-text,#111); box-sizing:border-box; }
  .pre-row input:disabled{ opacity:.45; }
  .pre-row textarea{ resize:vertical; line-height:1.45; }
  .pre-link{ border:none; background:none; font:inherit; font-size:12px; color:#9A7209; cursor:pointer; padding:0; flex:none; }
  .pre-actions{ display:flex; align-items:center; gap:8px; flex-wrap:wrap; justify-content:flex-end; }
  .pre-hint{ flex:1 1 240px; min-width:0; font-size:12px; color:var(--sb-text-muted,#73777e); overflow-wrap:anywhere; }
  .pre-btn{ font:inherit; font-size:13px; padding:8px 14px; border-radius:7px; border:.5px solid var(--sb-border,#d8d2c4); background:var(--sb-surface,#fff); color:var(--sb-text,#111); cursor:pointer; white-space:nowrap; }
  .pre-btn:disabled{ opacity:.5; cursor:not-allowed; }
  .pre-btn-gold{ background:#9A7209; border-color:#9A7209; color:#fff; font-weight:600; }
  .pre-btn-gold:hover:not(:disabled){ background:#7d5d07; }
  .pre-msg{ font-size:12.5px; padding:8px 20px; border-bottom:.5px solid var(--sb-border,#e4e0d8); overflow-wrap:anywhere; }
  .pre-msg-err{ color:#b54040; background:#fbeaea; }
  .pre-msg-ok{ color:#2d7a4f; background:#e6f4ec; }
  .pre-body{ flex:1; min-height:160px; background:#6b6b6b; position:relative; }
  .pre-frame{ width:100%; height:100%; border:none; display:block; }
  .pre-wait{ position:absolute; inset:0; display:flex; align-items:center; justify-content:center; color:#fff; font-size:14px; }
  @media (max-width:640px){ .pre-scrim{ padding:0; } .pre-modal{ height:100vh; border-radius:0; } .pre-row > span, .pre-cc-tick{ flex-basis:54px; } }
`
