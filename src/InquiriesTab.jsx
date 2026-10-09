// =============================================================================
// InquiriesTab — website form submissions, answered fast (INQUIRIES-1)
// =============================================================================
// Paul 2026-10-08: "remove the website inquiries and put them somewhere else
// — they are critical for the business, we get so much revenue from them and
// we want to be quick... a number notification... send an email to ask what
// they're looking for, new stone / bronze service / inscription... really
// simple: when actioned goes away, the customer goes into leads... data for
// how many website inquiries convert to sales and how much money."
//
// One card per submission (website_leads row): their message, click-to-call,
// a Looking-for picker, the "what are you looking for" email (catalog photos
// in the body, ConfirmSend gate — send-safety doctrine), Remind me, Done →
// Leads (mints the draft lead THEN leaves this list), Not a lead (never
// becomes one). Right rail = website → sales, from the inquiries' own order
// links. Cream Sales-tab aesthetic (.sb-inq-*).
// =============================================================================
import { useState, useEffect, useCallback, lazy, Suspense } from 'react'
import {
  listInquiries, getInquiryCounts, getInquiryFunnel, updateInquiry, markInquiryEmailed,
  listInquiryEmails, msgAt, interestLabel,
  INTERESTS, inqName, inqEmail, inqPhone, inqMessage, inqFormKind, inqDisplayName,
} from './lib/inquiries'
import { sendShopEmail, getCurrentStaffName, addShopTask, bulkArchiveOrders, fmtUSD, fmtPhone, fmtDate, todayISO, getOrderById } from './lib/stonebooksData'
import ConfirmSend from './components/ConfirmSend'
import CatalogPhotoPicker from './components/CatalogPhotoPicker'
// The full sales bundle (estimate PDF, layout, permit, files, catalog photos)
// — lazy: it drags the SalesMode chunk, which this tab must not pay for
// until someone actually clicks Sales email (PERF-1 discipline).
const SalesEmailModal = lazy(() => import('./components/SalesEmailModal'))

const fmtWhen = (iso) => {
  if (!iso) return ''
  const d = new Date(iso)
  return isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}
const STATUS_LABEL = { new: 'New', emailed: 'Emailed, waiting', done: 'Done', junk: 'Not a lead' }

const DAY_MS = 86400000
// Rail money reads whole ("$23,116") — never an ellipsis on a dollar figure
// (the first screenshot showed "$23,116…"); past six figures it compacts.
const money = (n) => {
  const v = Math.round(Number(n) || 0)
  if (v >= 1000000) return `$${(v / 1000000).toFixed(1)}M`
  if (v >= 100000) return `$${Math.round(v / 1000)}k`
  return fmtUSD(v)
}
const SERVICE_LABELS = { NEW_STONE: 'stone', INSCRIPTION: 'inscr', BRONZE: 'bronze', ACID_WASH: 'acid wash', REPAIR: 'repair', MAUSOLEUM: 'mausoleum' }

const ago = (iso, nowMs) => {
  if (!iso || !nowMs) return ''
  const d = (nowMs - new Date(iso).getTime()) / DAY_MS
  if (d < 1 / 24) return 'just now'
  if (d < 1) return `${Math.max(1, Math.round(d * 24))}h ago`
  if (d < 2) return 'Yesterday'
  return `${Math.floor(d)}d ago`
}
const isoPlusDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return todayISO(d) }
const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;')

// The "what are you looking for" email — Paul's words, verbatim (2026-10-08:
// "i hate the message, say this instead"). One message for every interest;
// only the opener changes for a Contact-page submission (they never opened
// the catalog). Staff retype anything in the gate anyway.
function draftFor(inq) {
  const first = (inqName(inq).split(/\s+/)[0] || '').trim()
  const hi = first ? `Hi ${first},` : 'Hello,'
  const catalog = inqFormKind(inq) === 'catalog'
  const opener = catalog
    ? "Thank you for visiting our website and taking the time to explore our catalog! We'd be happy to help you find the perfect memorial for your loved one."
    : "Thank you for visiting our website and reaching out! We'd be happy to help you find the perfect memorial for your loved one."
  const text = [
    hi,
    opener,
    "To help us better understand what you're looking for, could you let us know which of the following services you're interested in?",
    '* A new headstone or monument\n* A bronze marker or memorial plaque\n* Adding an inscription to an existing monument\n* Something custom or another memorial service',
    "If you already know which cemetery the memorial will be located in, please feel free to share the cemetery name and plot or section number. This information allows us to review the cemetery's specific regulations, determine what types and sizes of memorials are permitted, and recommend options that will work for your location.",
    "We would also be happy to share photographs of monuments we've previously completed at that cemetery to help you explore different styles and designs.",
    'We look forward to hearing from you and helping you create a meaningful and lasting tribute.',
    'Warm regards,\nThe Shevchenko Monuments Team',
  ].join('\n\n')
  return { subject: 'Thanks for reaching out to Shevchenko Monuments', text }
}

function photosHtml(photos) {
  if (!photos.length) return ''
  const fullImg = (u) => (u && u.includes('drive.google.com') ? u.replace(/sz=w\d+/i, 'sz=w1200') : u)
  return `<p style="margin:16px 0 6px"><b>A few examples to look at:</b></p>` +
    `<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse"><tr>` +
    photos.map((p, i) =>
      `${i > 0 && i % 2 === 0 ? '</tr><tr>' : ''}` +
      `<td style="padding:6px;vertical-align:top;text-align:center">` +
      `<a href="${fullImg(p.url)}" style="text-decoration:none;color:#17202a">` +
      `<img src="${fullImg(p.url)}" alt="${esc(p.name)}" width="260" style="max-width:260px;border-radius:8px;border:1px solid #e2dcc9;display:block" />` +
      `<span style="font-size:12.5px;font-weight:700">${esc(p.name)}${p.color ? ` · ${esc(p.color)}` : ''}</span></a></td>`
    ).join('') + `</tr></table>`
}

// ── The composer (module-level: react-hooks/static-components) ──────────────
// A typed reply starts from just the greeting and the sign-off (Paul
// 2026-10-08: "the button can just say reply and then you type a reply").
const replySkeleton = (inq) => {
  const first = (inqName(inq).split(/\s+/)[0] || '').trim()
  return `${first ? `Hi ${first},` : 'Hello,'}\n\n\n\nWarm regards,\nThe Shevchenko Monuments Team`
}
const reSubject = (s) => `Re: ${String(s || '').replace(/^\s*(re|fw|fwd)\s*:\s*/i, '').trim() || 'Your inquiry'}`

function InquiryEmailModal({ inquiry, me, onClose, onSent, mode = 'intro' }) {
  const d0 = draftFor(inquiry)
  const [to, setTo] = useState(inqEmail(inquiry))
  const [subject, setSubject] = useState(d0.subject)
  const [subjectTouched, setSubjectTouched] = useState(false)
  const [text, setText] = useState(mode === 'reply' ? replySkeleton(inquiry) : d0.text)
  const [photos, setPhotos] = useState([])
  const [pickerOpen, setPickerOpen] = useState(false)
  const [gate, setGate] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const toValid = /\S+@\S+\.\S+/.test(to.trim())
  // The chain so far — a reply picks up the last subject ("Re: …").
  const [thread, setThread] = useState([])
  useEffect(() => {
    let alive = true
    listInquiryEmails(inquiry).then(l => { if (alive) setThread(l) }).catch(() => {})
    return () => { alive = false }
  }, [inquiry])
  useEffect(() => {
    if (mode !== 'reply' || subjectTouched || !thread.length) return
    const last = [...thread].reverse().find(m => m.subject)
    if (last) setSubject(reSubject(last.subject))
  }, [thread, mode, subjectTouched])

  const openGate = () => {
    const html = `<div style="font-family:Arial,sans-serif;font-size:15px;color:#17202a;line-height:1.6">` +
      text.split(/\n\n/).map(p => `<p style="margin:0 0 10px">${esc(p).replace(/\n/g, '<br>')}</p>`).join('') +
      photosHtml(photos) + `</div>`
    const plain = text + (photos.length ? '\n\nExamples:\n' + photos.map(p => `- ${p.name}${p.color ? ` (${p.color})` : ''}: ${p.url}`).join('\n') : '')
    setGate({ subject, html, text: plain })
  }
  const doSend = async (edited) => {
    if (!gate) return
    setBusy(true); setErr(null)
    const r = await sendShopEmail({
      to: to.trim(), subject: gate.subject, html: edited?.html || gate.html, text: edited?.text || gate.text,
      orderId: inquiry.order_id || null, customerId: inquiry.customer_id || null,
    })
    if (!r?.ok) { setBusy(false); setErr(r?.error || 'Send failed.'); setGate(null); return }
    await markInquiryEmailed(inquiry.id, me)
    setBusy(false); setGate(null)
    onSent?.(`Emailed ${to.trim()}${photos.length ? ` with ${photos.length} photo${photos.length === 1 ? '' : 's'}` : ''}.`)
    onClose?.()
  }
  return (
    <div className="sb-inq-scrim" onClick={onClose}>
      <div className="sb-inq-modal" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()}>
        <div className="sb-inq-modal-t">{mode === 'reply' ? 'Reply to' : 'Email'} {inqDisplayName(inquiry)}</div>
        <div className="sb-inq-modal-s">{mode === 'reply' ? 'Type your reply. The preview is what goes out.' : 'Ask what they are looking for. Retype anything; the preview is what goes out.'}</div>
        <label className="sb-inq-l">To<input className="sb-inq-in" value={to} onChange={e => setTo(e.target.value)} placeholder="their@email.com" /></label>
        <label className="sb-inq-l">Subject<input className="sb-inq-in" value={subject} onChange={e => { setSubject(e.target.value); setSubjectTouched(true) }} /></label>
        <div className="sb-inq-l" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>Message
          {text === d0.text
            ? <button type="button" className="sb-inq-btn sb-inq-btn-ai" onClick={() => setText(replySkeleton(inquiry))} title="Clear to a greeting and sign-off and type your own">Reply</button>
            : <button type="button" className="sb-inq-btn" onClick={() => setText(d0.text)} title="Put the standard intro text back">Use the intro text</button>}
          {thread.length > 0 && <span className="sb-inq-soft">{thread.length} email{thread.length === 1 ? '' : 's'} in the chain</span>}
        </div>
        <textarea className="sb-inq-in sb-inq-body" rows={11} value={text} onChange={e => setText(e.target.value)} />
        <div className="sb-inq-l" style={{ display: 'block' }}>Catalog photos <span className="sb-inq-soft">— examples in the email body, up to 10</span>
          <div className="sb-inq-photos">
            {photos.map(p => (
              <span key={p.id} className="sb-inq-photo">{p.name}{p.color ? ` · ${p.color}` : ''}<button type="button" onClick={() => setPhotos(l => l.filter(x => x.id !== p.id))} aria-label="Remove">×</button></span>
            ))}
            <button type="button" className="sb-inq-pick" onClick={() => setPickerOpen(true)}>{photos.length ? 'Change photos' : '+ Pick from catalog'}</button>
          </div>
        </div>
        {err && <div className="sb-inq-warn">{err}</div>}
        <div className="sb-inq-modal-acts">
          <button type="button" className="sb-inq-btn" onClick={onClose} disabled={busy}>Close</button>
          <button type="button" className="sb-inq-btn sb-inq-btn-go" disabled={busy || !toValid || !text.trim()} onClick={openGate}>Preview + send</button>
        </div>
        {pickerOpen && <CatalogPhotoPicker initial={photos} onDone={(l) => { setPhotos(l); setPickerOpen(false) }} onClose={() => setPickerOpen(false)} />}
        <ConfirmSend open={!!gate} to={to.trim()} subject={gate?.subject || ''} html={gate?.html || ''} busy={busy} onConfirm={doSend} onClose={() => setGate(null)} />
      </div>
    </div>
  )
}

export default function InquiriesTab({ onOpenOrderDetail }) {
  const [status, setStatus] = useState('new')     // new | emailed | done | junk
  const [formF, setFormF] = useState('')          // '' | catalog | contact
  const [rows, setRows] = useState(null)
  const [counts, setCounts] = useState({ new: 0, emailed: 0, done: 0 })
  const [funnel, setFunnel] = useState(null)
  const [nowMs, setNowMs] = useState(0)
  const [me, setMe] = useState(null)
  const [busyId, setBusyId] = useState(null)
  const [emailFor, setEmailFor] = useState(null)
  const [remindFor, setRemindFor] = useState(null)
  const [toast, setToast] = useState(null)
  const [err, setErr] = useState(null)
  // Email chains per inquiry (Paul 2026-10-08: "in emailed waiting i want to
  // keep seeing the email chains"). Loaded for every card on the Emailed
  // view, on demand elsewhere.
  const [threads, setThreads] = useState(() => new Map())
  const [expanded, setExpanded] = useState(() => new Set())   // message ids showing the full body
  const [salesFor, setSalesFor] = useState(null)             // { inquiry, order } → SalesEmailModal

  const load = useCallback(async () => {
    const [list, c] = await Promise.all([listInquiries({ status }), getInquiryCounts()])
    setRows(list); setCounts(c); setNowMs(Date.now())
    if (status === 'emailed' && list.length) {
      const pairs = await Promise.all(list.slice(0, 60).map(r => listInquiryEmails(r).then(ms => [r.id, ms]).catch(() => [r.id, []])))
      setThreads(new Map(pairs))
    }
  }, [status])
  const loadThread = async (r) => {
    const ms = await listInquiryEmails(r).catch(() => [])
    setThreads(m => new Map(m).set(r.id, ms))
  }
  const toggleMsg = (id) => setExpanded(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  // The full sales bundle from an inquiry — the lead is minted first if it
  // doesn't exist (same path as Done), so estimate/photos/files all have an
  // order to hang on.
  const openSales = async (r) => {
    setBusyId(r.id); setErr(null)
    try {
      let orderId = r.order_id
      if (!orderId) {
        const m = await import('./lib/websiteLeads')
        const lead = await m.ensureLeadForInquiry(r)
        if (!lead.ok) { setErr(lead.error || 'Could not create the lead.'); return }
        orderId = lead.orderId
      }
      const order = await getOrderById(orderId)
      if (!order) { setErr('Could not open the lead for this inquiry.'); return }
      setSalesFor({ inquiry: { ...r, order_id: orderId }, order })
    } finally { setBusyId(null) }
  }
  useEffect(() => { load() }, [load])  // eslint-disable-line react-hooks/set-state-in-effect
  useEffect(() => {
    let alive = true
    getCurrentStaffName().then(n => { if (alive) setMe(n) }).catch(() => {})
    getInquiryFunnel().then(f => { if (alive) setFunnel(f) }).catch(() => {})
    return () => { alive = false }
  }, [])
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 4000)
    return () => clearTimeout(t)
  }, [toast])

  const shown = (rows || []).filter(r => !formF || inqFormKind(r) === formF)
  const oldestNew = status === 'new' && shown.length ? Math.floor((nowMs - new Date(shown[shown.length - 1].created_at).getTime()) / DAY_MS) : null

  const act = async (r, fn, okMsg) => {
    setBusyId(r.id); setErr(null)
    try {
      const res = await fn()
      if (res && res.ok === false) setErr(res.error || 'Action failed')
      else if (okMsg) setToast(okMsg)
    } catch (e) { setErr(e?.message || 'Action failed') }
    setBusyId(null)
    load()
    getInquiryFunnel().then(setFunnel).catch(() => {})
  }
  const setInterest = (r, code) => act(r, () => updateInquiry(r.id, { interest: r.interest === code ? null : code }))
  // Done → Leads: mint the draft lead (dynamic import — websiteLeads drags
  // SalesMode), then the card leaves this list.
  const markDone = (r) => act(r, async () => {
    const m = await import('./lib/websiteLeads')
    const lead = await m.ensureLeadForInquiry(r)
    if (!lead.ok) return lead
    return updateInquiry(r.id, { inquiry_status: 'done', actioned_at: new Date().toISOString(), actioned_by: me })
  }, `${inqDisplayName(r)} is in Leads now.`)
  const markJunk = (r) => act(r, async () => {
    // A legacy draft (pre-INQUIRIES-1 rows minted a lead on arrival) gets
    // archived so Leads stays clean; nothing is deleted.
    if (r.order_id) await bulkArchiveOrders([r.order_id]).catch(() => {})
    return updateInquiry(r.id, { inquiry_status: 'junk', actioned_at: new Date().toISOString(), actioned_by: me })
  }, 'Marked not a lead.')
  const reopen = (r) => act(r, () => updateInquiry(r.id, { inquiry_status: 'new', actioned_at: null, actioned_by: null }))
  const remind = (r, iso) => act(r, async () => {
    setRemindFor(null)
    return addShopTask({
      title: `Follow up website inquiry — ${inqDisplayName(r)}`.slice(0, 160),
      assignee: me || 'Sales', assigneeKind: me ? 'person' : 'department',
      orderId: r.order_id || null, dueDate: iso, createdBy: me, taskedBy: me, taskType: 'lead',
    })
  }, 'Reminder set.')

  const closeRate = funnel && funnel.inquiries ? Math.round((funnel.signed / funnel.inquiries) * 1000) / 10 : 0

  return (
    <div className="sb-page sb-page-wide sb-inq">
      <style>{CSS}</style>
      <div className="sb-inq-head">
        <h1 className="sb-inq-h1">Website Inquiries</h1>
        <span className="sb-inq-sub">Form submissions from the website. Answer fast — Done sends them to Leads.</span>
      </div>

      <div className="sb-inq-bar">
        <button type="button" className={`sb-inq-pill${status === 'new' ? ' on' : ''}`} onClick={() => setStatus('new')}>New <b>{counts.new}</b></button>
        <button type="button" className={`sb-inq-pill${status === 'emailed' ? ' on' : ''}`} onClick={() => setStatus('emailed')}>Emailed, waiting <b>{counts.emailed}</b></button>
        <button type="button" className={`sb-inq-pill${status === 'done' ? ' on' : ''}`} onClick={() => setStatus('done')}>Done this month <b>{counts.done}</b></button>
        <button type="button" className={`sb-inq-pill${status === 'junk' ? ' on' : ''}`} onClick={() => setStatus('junk')}>Not leads</button>
        <button type="button" className={`sb-inq-pill${status === 'all' ? ' on' : ''}`} onClick={() => setStatus('all')} title="Every submission ever, both forms — even the ones that never became an order">All inquiries</button>
        <span className="sb-inq-vr" />
        <button type="button" className={`sb-inq-pill${formF === '' ? ' on' : ''}`} onClick={() => setFormF('')}>All forms</button>
        <button type="button" className={`sb-inq-pill${formF === 'catalog' ? ' on' : ''}`} onClick={() => setFormF('catalog')}>Catalog popup</button>
        <button type="button" className={`sb-inq-pill${formF === 'contact' ? ' on' : ''}`} onClick={() => setFormF('contact')}>Contact page</button>
        {oldestNew != null && <span className="sb-inq-oldest">Oldest untouched: <b className={oldestNew >= 2 ? 'red' : ''}>{oldestNew === 0 ? 'today' : `${oldestNew} day${oldestNew === 1 ? '' : 's'}`}</b></span>}
      </div>

      {err && <div className="sb-inq-warn">{err}</div>}
      {toast && <div className="sb-inq-toast">{toast}</div>}

      <div className="sb-inq-body">
        <section className="sb-inq-list" aria-label="Inquiries">
          {rows == null && <div className="sb-inq-empty">Loading…</div>}
          {rows != null && shown.length === 0 && (
            <div className="sb-inq-empty">{status === 'new' ? 'Nothing waiting. Every inquiry has been answered.' : 'Nothing here.'}</div>
          )}
          {/* ALL — the ledger of every submission, both forms, whatever became of it. */}
          {status === 'all' && shown.length > 0 && (
            <div className="sb-inq-tablewrap">
              <table className="sb-inq-table">
                <thead><tr><th>Submitted</th><th>Name</th><th>Form</th><th>Looking for</th><th>Status</th><th>First email</th><th>Lead</th><th>Message</th></tr></thead>
                <tbody>
                  {shown.map(r => (
                    <tr key={r.id} className={r.order_id ? 'click' : ''} onClick={() => r.order_id && onOpenOrderDetail?.(r.order_id)}>
                      <td className="mono">{fmtDate(r.created_at)}</td>
                      <td className="b">{inqDisplayName(r)}</td>
                      <td><span className={`sb-inq-form sb-inq-form-${inqFormKind(r)}`}>{inqFormKind(r) === 'catalog' ? 'Catalog' : 'Contact'}</span></td>
                      <td>{interestLabel(r.interest) || '—'}</td>
                      <td><span className={`sb-inq-st sb-inq-st-${r.inquiry_status}`}>{STATUS_LABEL[r.inquiry_status] || r.inquiry_status}</span></td>
                      <td className="mono">{r.first_touch_at ? fmtDate(r.first_touch_at) : '—'}</td>
                      <td>{r.order_id ? <span className="sb-inq-leadlink">Open →</span> : '—'}</td>
                      <td className="msg">{inqMessage(r) || <span className="sb-inq-none-soft">—</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {status !== 'all' && shown.map(r => {
            const phone = inqPhone(r), email = inqEmail(r), msg = inqMessage(r)
            const kind = inqFormKind(r)
            const fresh = status === 'new' && (nowMs - new Date(r.created_at).getTime()) < 2 * DAY_MS
            const busy = busyId === r.id
            return (
              <article key={r.id} className={`sb-inq-card sb-inq-card-${r.inquiry_status}`}>
                <div className="sb-inq-row">
                  <span className="sb-inq-name">{inqDisplayName(r)}</span>
                  <span className={`sb-inq-form sb-inq-form-${kind}`}>{kind === 'catalog' ? 'Catalog popup' : 'Contact page'}</span>
                  {r.first_touch_at && <span className="sb-inq-sent">Emailed {new Date(r.first_touch_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}{r.first_touch_by ? ` · ${r.first_touch_by}` : ''}</span>}
                  {r.order_id && <button type="button" className="sb-inq-leadlink" onClick={() => onOpenOrderDetail?.(r.order_id)}>Open lead →</button>}
                  <span className={`sb-inq-when${fresh ? ' hot' : ''}`}>{ago(r.created_at, nowMs)}</span>
                </div>
                <div className="sb-inq-row sb-inq-contact">
                  {phone ? <a className="sb-inq-tel" href={`tel:${phone}`}>{fmtPhone(phone)}</a> : <span className="sb-inq-none">no phone</span>}
                  {email ? <a className="sb-inq-mail" href={`mailto:${email}`}>{email}</a> : <span className="sb-inq-none">no email</span>}
                </div>
                <div className={`sb-inq-msg${msg ? '' : ' none'}`}>{msg || (kind === 'catalog' ? 'No message left — just the catalog form.' : 'No message left.')}</div>
                {/* The email chain — every message to or from this address. */}
                {threads.has(r.id) ? (
                  (threads.get(r.id) || []).length === 0
                    ? <div className="sb-inq-soft">No emails to or from {email || 'this address'} yet.</div>
                    : (
                      <div className="sb-inq-thread">
                        <div className="sb-inq-lab">Email chain · {threads.get(r.id).length}</div>
                        {threads.get(r.id).map(m => {
                          const open = expanded.has(m.id)
                          const body = (m.body_text || m.snippet || '').trim()
                          return (
                            <div key={m.id} className={`sb-inq-mail ${m.direction}`}>
                              <div className="sb-inq-mail-top">
                                <span className={`sb-inq-dir ${m.direction}`}>{m.direction === 'outbound' ? 'Shop' : 'Them'}</span>
                                <span className="sb-inq-mail-subj">{m.subject || '(no subject)'}</span>
                                <span className="sb-inq-mail-when">{fmtWhen(msgAt(m))}</span>
                              </div>
                              <div className={`sb-inq-mail-body${open ? ' open' : ''}`}>{open ? body : (m.snippet || body.slice(0, 180))}</div>
                              {body.length > 180 && <button type="button" className="sb-inq-link" onClick={() => toggleMsg(m.id)}>{open ? 'Less' : 'Read the whole email'}</button>}
                            </div>
                          )
                        })}
                      </div>
                    )
                ) : (
                  <button type="button" className="sb-inq-link" onClick={() => loadThread(r)}>Show email chain</button>
                )}
                <div className="sb-inq-row">
                  <span className="sb-inq-lab">Looking for</span>
                  {INTERESTS.map(i => (
                    <button type="button" key={i.code} className={`sb-inq-pill sm${r.interest === i.code ? ' on' : ''}`} disabled={busy} onClick={() => setInterest(r, i.code)}>{i.label}</button>
                  ))}
                </div>
                <div className="sb-inq-row sb-inq-acts">
                  {r.inquiry_status === 'junk' || r.inquiry_status === 'done' ? (
                    <>
                      <button type="button" className="sb-inq-btn" disabled={busy} onClick={() => reopen(r)}>Back to new</button>
                      {r.inquiry_status === 'done' && <button type="button" className="sb-inq-btn" disabled={busy} title="The full sales bundle — estimate, photos, files" onClick={() => openSales(r)}>Sales email</button>}
                    </>
                  ) : (
                    <>
                      {r.first_touch_at ? (
                        <button type="button" className="sb-inq-btn sb-inq-btn-mail" disabled={busy || !email} title={email ? 'Type a reply' : 'No email address on the form'} onClick={() => setEmailFor({ row: r, mode: 'reply' })}>Reply</button>
                      ) : (
                        <>
                          <button type="button" className="sb-inq-btn sb-inq-btn-mail" disabled={busy || !email} title={email ? '' : 'No email address on the form'} onClick={() => setEmailFor({ row: r, mode: 'intro' })}>Email: what are you looking for?</button>
                          <button type="button" className="sb-inq-btn" disabled={busy || !email} title={email ? 'Type your own reply' : 'No email address on the form'} onClick={() => setEmailFor({ row: r, mode: 'reply' })}>Reply</button>
                        </>
                      )}
                      <button type="button" className="sb-inq-btn" disabled={busy} title="The full sales bundle — draft estimate, catalog photos, layout, files; creates the lead first if there isn't one" onClick={() => openSales(r)}>{busy ? '…' : 'Sales email'}</button>
                      {phone && <a className="sb-inq-btn" href={`tel:${phone}`}>Call</a>}
                      {remindFor === r.id ? (
                        <span className="sb-inq-remind">
                          <button type="button" className="sb-inq-btn" onClick={() => remind(r, isoPlusDays(3))}>3 days</button>
                          <button type="button" className="sb-inq-btn" onClick={() => remind(r, isoPlusDays(7))}>7 days</button>
                          <input type="date" onChange={e => e.target.value && remind(r, e.target.value)} />
                          <button type="button" className="sb-inq-btn" onClick={() => setRemindFor(null)}>×</button>
                        </span>
                      ) : (
                        <button type="button" className="sb-inq-btn" disabled={busy} onClick={() => setRemindFor(r.id)}>Remind me</button>
                      )}
                      <span className="sb-inq-grow" />
                      <button type="button" className="sb-inq-btn sb-inq-btn-junk" disabled={busy} onClick={() => markJunk(r)}>Not a lead</button>
                      <button type="button" className="sb-inq-btn sb-inq-btn-done" disabled={busy} onClick={() => markDone(r)}>{busy ? '…' : 'Done → Leads'}</button>
                    </>
                  )}
                </div>
              </article>
            )
          })}
        </section>

        <aside className="sb-inq-rail">
          <div className="sb-inq-stats">
            <div className="sb-inq-lab">Website → sales{funnel?.since ? ` · since ${new Date(funnel.since).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : ''}</div>
            {!funnel ? <div className="sb-inq-empty">Loading…</div> : (
              <>
                <div className="sb-inq-grid">
                  <div className="sb-inq-stat"><b>{funnel.inquiries}</b><span>inquiries</span></div>
                  <div className="sb-inq-stat"><b>{funnel.signed}</b><span>signed</span></div>
                  <div className="sb-inq-stat"><b>{closeRate}%</b><span>close rate</span></div>
                  <div className="sb-inq-stat"><b>{money(funnel.contractUsd)}</b><span>contract value</span></div>
                  <div className="sb-inq-stat"><b>{money(funnel.collectedUsd)}</b><span>collected</span></div>
                  <div className="sb-inq-stat"><b>{funnel.medianTouchDays == null ? '—' : `${Math.round(funnel.medianTouchDays * 10) / 10}d`}</b><span>median to first email</span></div>
                </div>
                <div className="sb-inq-bars">
                  {[['catalog', 'Catalog popup'], ['contact', 'Contact page']].map(([k, label]) => {
                    const f = funnel.byForm[k] || { inquiries: 0, signed: 0 }
                    const pct = funnel.inquiries ? Math.round((f.inquiries / Math.max(1, funnel.inquiries + funnel.junk)) * 100) : 0
                    return (
                      <div key={k}>
                        <div className="sb-inq-barrow"><span>{label}</span><span className="mono">{f.inquiries} · {f.signed} signed</span></div>
                        <div className="sb-inq-bar"><i style={{ width: `${pct}%` }} /></div>
                      </div>
                    )
                  })}
                </div>
                <div className="sb-inq-kv"><span>Signed by service</span><span className="mono">{Object.entries(funnel.byService).map(([s, n]) => `${n} ${SERVICE_LABELS[s] || s.toLowerCase()}`).join(' · ') || '—'}</span></div>
                <div className="sb-inq-kv"><span>Inquiry → signed</span><span className="mono">{funnel.medianLeadDays == null ? '—' : `${Math.round(funnel.medianLeadDays)} days (median)`}</span></div>
                <div className="sb-inq-kv"><span>Not leads (junk)</span><span className="mono">{funnel.junk}</span></div>
              </>
            )}
          </div>
        </aside>
      </div>

      {emailFor && <InquiryEmailModal inquiry={emailFor.row} mode={emailFor.mode} me={me} onClose={() => setEmailFor(null)} onSent={(m) => { setToast(m); load(); getInquiryFunnel().then(setFunnel).catch(() => {}) }} />}
      {salesFor && (
        <Suspense fallback={null}>
          <SalesEmailModal order={salesFor.order} mode="sales"
            onClose={() => setSalesFor(null)}
            onSaved={(m) => setToast(m)}
            onSent={async (m) => {
              await markInquiryEmailed(salesFor.inquiry.id, me).catch(() => {})
              setToast(m); load(); getInquiryFunnel().then(setFunnel).catch(() => {})
            }} />
        </Suspense>
      )}
    </div>
  )
}

const CSS = `
  .sb-inq { padding: 18px 0 24px; font-family: inherit; color: #16150F; }
  .sb-inq-head { display: flex; align-items: baseline; gap: 14px; flex-wrap: wrap; margin-bottom: 12px; }
  .sb-inq-h1 { margin: 0; font-size: 20px; font-weight: 800; }
  .sb-inq-sub { font-size: 12.5px; color: #8a8472; }
  /* The filter bar sits ABOVE the list in the stacking order and can never
     collapse (Paul's first screenshot showed it clipped under the cards). */
  .sb-inq-bar { position: relative; z-index: 2; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 14px; min-height: 36px; }
  .sb-inq-body { position: relative; z-index: 1; }
  .sb-inq-pill { font-family: inherit; font-size: 12px; font-weight: 700; line-height: 1.2; color: #6B6455; background: #fff; border: 1px solid #D9D2C0; border-radius: 999px; padding: 7px 12px; min-height: 32px; cursor: pointer; white-space: nowrap; display: inline-flex; gap: 6px; align-items: center; flex: 0 0 auto; }
  .sb-inq-pill b { font-family: var(--font-m, 'JetBrains Mono'), monospace; font-size: 10.5px; color: #9a9486; }
  .sb-inq-pill.on { background: #16150F; color: #fff; border-color: #16150F; }
  .sb-inq-pill.on b { color: #C9A468; }
  .sb-inq-pill.sm { padding: 5px 10px; font-size: 11px; }
  .sb-inq-pill:disabled { opacity: .6; cursor: default; }
  .sb-inq-vr { width: 1px; height: 22px; background: #ddd6c6; }
  .sb-inq-oldest { margin-left: auto; font-size: 12px; color: #8a8472; }
  .sb-inq-oldest b.red { color: #b3261e; }
  .sb-inq-body { display: flex; gap: 14px; align-items: flex-start; flex-wrap: wrap; }
  .sb-inq-list { flex: 999 1 520px; min-width: 0; display: flex; flex-direction: column; gap: 10px; }
  .sb-inq-rail { flex: 1 1 320px; min-width: 0; max-width: 420px; display: flex; flex-direction: column; gap: 12px; }
  .sb-inq-card { background: #fff; border: 1px solid #ece6d8; border-left: 4px solid #b3261e; border-radius: 10px; padding: 12px 14px; display: flex; flex-direction: column; gap: 8px; min-width: 0; }
  .sb-inq-card-emailed { border-left-color: #1D6FA8; }
  .sb-inq-card-done { border-left-color: #2d7a4f; }
  .sb-inq-card-junk { border-left-color: #c2bdb2; opacity: .8; }
  .sb-inq-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; min-width: 0; }
  .sb-inq-name { font: 700 15px/1.2 inherit; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
  .sb-inq-form { font: 700 10px/1 inherit; letter-spacing: .06em; text-transform: uppercase; color: #185F8F; background: rgba(29,111,168,.12); border-radius: 999px; padding: 3px 8px; white-space: nowrap; }
  .sb-inq-form-contact { color: #6B6455; background: #F5F1E6; border: 1px solid #E4DCC8; }
  .sb-inq-sent { font: 700 10px/1 inherit; letter-spacing: .04em; text-transform: uppercase; color: #1d7a55; background: #e7f4ec; border-radius: 5px; padding: 3px 7px; white-space: nowrap; }
  .sb-inq-leadlink { font: 700 11px/1 inherit; font-family: inherit; color: #1d4ed8; background: none; border: none; padding: 0; cursor: pointer; }
  .sb-inq-when { margin-left: auto; font-family: var(--font-m, 'JetBrains Mono'), monospace; font-size: 11px; color: #8a8472; white-space: nowrap; }
  .sb-inq-when.hot { color: #b3261e; font-weight: 700; }
  .sb-inq-contact { gap: 14px; font-size: 12.5px; }
  .sb-inq-tel { font-family: var(--font-m, 'JetBrains Mono'), monospace; font-size: 12px; color: #185F8F; text-decoration: none; white-space: nowrap; }
  .sb-inq-mail { color: #185F8F; text-decoration: none; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100%; }
  .sb-inq-tel:hover, .sb-inq-mail:hover { text-decoration: underline; }
  .sb-inq-none { color: #b3261e; font-weight: 700; font-size: 12px; }
  .sb-inq-msg { font-size: 13px; color: #2a2a2a; background: #faf8f3; border: 1px solid #f1ecdf; border-radius: 8px; padding: 8px 10px; overflow-wrap: anywhere; white-space: pre-line; }
  .sb-inq-msg.none { color: #a39b8b; font-style: italic; }
  .sb-inq-lab { font: 700 10px/1 inherit; letter-spacing: .08em; text-transform: uppercase; color: #8a8472; margin-right: 4px; }
  .sb-inq-acts { gap: 6px; }
  .sb-inq-grow { flex: 1; }
  .sb-inq-btn { font: 700 11.5px/1 inherit; font-family: inherit; color: #16150F; background: #fff; border: 1px solid #D9D2C0; border-radius: 6px; padding: 7px 10px; cursor: pointer; white-space: nowrap; text-decoration: none; display: inline-flex; align-items: center; }
  .sb-inq-btn:disabled { opacity: .45; cursor: default; }
  .sb-inq-btn-mail { background: #9A7209; color: #fff; border-color: #9A7209; }
  .sb-inq-btn-done { background: #2d7a4f; color: #fff; border-color: #2d7a4f; }
  .sb-inq-btn-junk { color: #8a8472; }
  .sb-inq-btn-go { background: #16150F; color: #C9A468; border-color: #16150F; }
  .sb-inq-remind { display: inline-flex; align-items: center; gap: 5px; }
  .sb-inq-remind input[type="date"] { font: 600 11px/1 inherit; font-family: inherit; border: 1px solid #D9D2C0; border-radius: 6px; padding: 5px 6px; background: #fff; }
  .sb-inq-stats { background: #fff; border: 1px solid #ece6d8; border-radius: 10px; padding: 12px 14px; display: flex; flex-direction: column; gap: 10px; }
  /* Overflow doctrine: money like $28,065.00 needs ~110px at this size — the
     grid drops to 2-up when the rail is narrow instead of letting numbers
     run into each other (Paul 2026-10-09: "look how bad the overlap is"). */
  .sb-inq-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(118px, 1fr)); gap: 12px 14px; }
  .sb-inq-stat { display: flex; flex-direction: column; min-width: 0; overflow: hidden; }
  .sb-inq-stat b { font-size: 18px; font-weight: 700; color: #1a1a1a; line-height: 1.15; letter-spacing: -0.01em; white-space: normal; overflow-wrap: anywhere; font-variant-numeric: tabular-nums; }
  .sb-inq-stat span { font-size: 11px; color: #8a8472; overflow-wrap: anywhere; }
  .sb-inq-bars { display: flex; flex-direction: column; gap: 6px; }
  .sb-inq-barrow { display: flex; justify-content: space-between; font-size: 12px; gap: 8px; }
  .sb-inq-bar { height: 8px; border-radius: 4px; background: #efece3; overflow: hidden; margin-top: 3px; }
  .sb-inq-bar i { display: block; height: 100%; background: #9A7209; }
  .sb-inq-kv { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; font-size: 12px; min-width: 0; }
  .sb-inq-kv > span:first-child { flex: 0 1 auto; }
  .sb-inq .mono { font-family: var(--font-m, 'JetBrains Mono'), monospace; color: #555; text-align: right; min-width: 0; flex: 1 1 auto; overflow-wrap: anywhere; }
  .sb-inq-empty { padding: 22px; text-align: center; color: #8a8472; background: #fff; border: 1px solid #ece6d8; border-radius: 10px; font-size: 13px; }
  .sb-inq-warn { background: rgba(179,38,30,0.08); color: #B3261E; font-size: 12.5px; border-radius: 8px; padding: 8px 10px; margin-bottom: 10px; }
  .sb-inq-toast { background: #e7f4ec; color: #1d7a55; font-size: 12.5px; font-weight: 700; border-radius: 8px; padding: 8px 10px; margin-bottom: 10px; }
  .sb-inq-scrim { position: fixed; inset: 0; background: rgba(15,20,25,0.5); z-index: 1200; display: flex; align-items: center; justify-content: center; padding: 20px; }
  .sb-inq-modal { background: #fff; border-radius: 12px; width: 100%; max-width: 580px; max-height: 92vh; overflow-y: auto; padding: 20px 22px; }
  .sb-inq-modal-t { font-size: 17px; font-weight: 800; }
  .sb-inq-modal-s { font-size: 12.5px; color: #6B6456; margin: 4px 0 10px; }
  .sb-inq-l { display: block; font-size: 11.5px; font-weight: 700; color: #6B6456; margin: 10px 0 0; }
  .sb-inq-soft { font-weight: 400; }
  .sb-inq-in { display: block; width: 100%; margin-top: 4px; border: 1px solid #D9D2C0; border-radius: 8px; padding: 8px 10px; font: inherit; font-size: 13.5px; box-sizing: border-box; }
  .sb-inq-body-ta { resize: vertical; }
  .sb-inq-in.sb-inq-body { resize: vertical; line-height: 1.5; display: block; }
  .sb-inq-photos { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; align-items: center; }
  .sb-inq-photo { font-size: 12px; background: #F5F1E6; border: 1px solid #E4DCC8; border-radius: 999px; padding: 3px 8px; display: inline-flex; gap: 6px; align-items: center; }
  .sb-inq-photo button { background: none; border: none; font-size: 14px; cursor: pointer; color: #8a8472; padding: 0; }
  .sb-inq-pick { background: none; border: 1px dashed #C9A468; color: #9A7209; border-radius: 8px; padding: 5px 10px; font: 700 12.5px/1 inherit; font-family: inherit; cursor: pointer; }
  .sb-inq-modal-acts { display: flex; justify-content: flex-end; gap: 10px; margin-top: 16px; }
  .sb-inq-btn-ai { background: #16150F; color: #C9A468; border-color: #16150F; padding: 5px 10px; }
  .sb-inq-link { font: 700 11.5px/1 inherit; font-family: inherit; color: #9A7209; background: none; border: none; padding: 0; cursor: pointer; align-self: flex-start; }
  .sb-inq-link:hover { text-decoration: underline; }
  .sb-inq-soft { font-size: 12px; color: #8a8472; }
  .sb-inq-thread { display: flex; flex-direction: column; gap: 6px; border-top: 1px dashed #e4dcc8; padding-top: 8px; }
  .sb-inq-mail { border: 1px solid #ece6d8; border-radius: 8px; padding: 7px 10px; background: #fff; min-width: 0; }
  .sb-inq-mail.outbound { background: #faf8f3; }
  .sb-inq-mail.inbound { border-left: 3px solid #1D6FA8; }
  .sb-inq-mail-top { display: flex; align-items: center; gap: 8px; min-width: 0; }
  .sb-inq-dir { font: 800 9.5px/1 inherit; font-family: inherit; letter-spacing: .06em; text-transform: uppercase; border-radius: 999px; padding: 3px 7px; white-space: nowrap; }
  .sb-inq-dir.outbound { color: #6B6455; background: #F5F1E6; border: 1px solid #E4DCC8; }
  .sb-inq-dir.inbound { color: #fff; background: #1D6FA8; }
  .sb-inq-mail-subj { font-size: 12.5px; font-weight: 700; color: #16150F; flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .sb-inq-mail-when { font-family: var(--font-m, 'JetBrains Mono'), monospace; font-size: 10.5px; color: #8a8472; white-space: nowrap; }
  .sb-inq-mail-body { font-size: 12.5px; color: #2a2a2a; margin-top: 4px; white-space: pre-line; overflow-wrap: anywhere; max-height: 3.2em; overflow: hidden; }
  .sb-inq-mail-body.open { max-height: none; }
  .sb-inq-tablewrap { overflow-x: auto; background: #fff; border: 1px solid #ece6d8; border-radius: 10px; }
  .sb-inq-table { width: 100%; border-collapse: collapse; min-width: 980px; table-layout: fixed; }
  .sb-inq-table th { text-align: left; font-size: 10px; text-transform: uppercase; letter-spacing: .06em; color: #9a9486; font-weight: 700; padding: 7px 10px; background: #faf8f3; border-bottom: 1px solid #ece6d8; white-space: nowrap; }
  .sb-inq-table td { padding: 7px 10px; border-bottom: 1px solid #f3f0e8; font-size: 12.5px; color: #2a2a2a; vertical-align: middle; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .sb-inq-table tr.click { cursor: pointer; } .sb-inq-table tr.click:hover td { background: #faf8f3; }
  .sb-inq-table td.b { font-weight: 700; } .sb-inq-table td.mono { font-family: var(--font-m, 'JetBrains Mono'), monospace; font-size: 11.5px; color: #555; }
  .sb-inq-table td.msg { color: #555; max-width: 320px; }
  .sb-inq-table col, .sb-inq-table th:nth-child(1) { width: 96px; } .sb-inq-table th:nth-child(3) { width: 80px; } .sb-inq-table th:nth-child(5) { width: 120px; } .sb-inq-table th:nth-child(6) { width: 96px; } .sb-inq-table th:nth-child(7) { width: 70px; }
  .sb-inq-st { font: 700 10px/1 inherit; font-family: inherit; letter-spacing: .04em; text-transform: uppercase; border-radius: 5px; padding: 3px 7px; white-space: nowrap; }
  .sb-inq-st-new { color: #b3261e; background: #fbeaea; } .sb-inq-st-emailed { color: #185F8F; background: rgba(29,111,168,.12); } .sb-inq-st-done { color: #1d7a55; background: #e7f4ec; } .sb-inq-st-junk { color: #8a8472; background: #f1ede3; }
  .sb-inq-none-soft { color: #c2bdb2; }
`
