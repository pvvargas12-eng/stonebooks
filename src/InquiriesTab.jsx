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
import { useState, useEffect, useCallback } from 'react'
import {
  listInquiries, getInquiryCounts, getInquiryFunnel, updateInquiry, markInquiryEmailed,
  INTERESTS, inqName, inqEmail, inqPhone, inqMessage, inqFormKind, inqDisplayName,
} from './lib/inquiries'
import { sendShopEmail, getCurrentStaffName, addShopTask, bulkArchiveOrders, fmtUSD, fmtPhone, todayISO } from './lib/stonebooksData'
import ConfirmSend from './components/ConfirmSend'
import CatalogPhotoPicker from './components/CatalogPhotoPicker'

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
function InquiryEmailModal({ inquiry, me, onClose, onSent }) {
  const d0 = draftFor(inquiry)
  const [to, setTo] = useState(inqEmail(inquiry))
  const [subject, setSubject] = useState(d0.subject)
  const [text, setText] = useState(d0.text)
  const [photos, setPhotos] = useState([])
  const [pickerOpen, setPickerOpen] = useState(false)
  const [gate, setGate] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const toValid = /\S+@\S+\.\S+/.test(to.trim())

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
        <div className="sb-inq-modal-t">Email {inqDisplayName(inquiry)}</div>
        <div className="sb-inq-modal-s">Ask what they are looking for. Retype anything; the preview is what goes out.</div>
        <label className="sb-inq-l">To<input className="sb-inq-in" value={to} onChange={e => setTo(e.target.value)} placeholder="their@email.com" /></label>
        <label className="sb-inq-l">Subject<input className="sb-inq-in" value={subject} onChange={e => setSubject(e.target.value)} /></label>
        <label className="sb-inq-l">Message<textarea className="sb-inq-in sb-inq-body" rows={11} value={text} onChange={e => setText(e.target.value)} /></label>
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

  const load = useCallback(async () => {
    const [list, c] = await Promise.all([listInquiries({ status }), getInquiryCounts()])
    setRows(list); setCounts(c); setNowMs(Date.now())
  }, [status])
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
          {shown.map(r => {
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
                <div className="sb-inq-row">
                  <span className="sb-inq-lab">Looking for</span>
                  {INTERESTS.map(i => (
                    <button type="button" key={i.code} className={`sb-inq-pill sm${r.interest === i.code ? ' on' : ''}`} disabled={busy} onClick={() => setInterest(r, i.code)}>{i.label}</button>
                  ))}
                </div>
                <div className="sb-inq-row sb-inq-acts">
                  {r.inquiry_status === 'junk' || r.inquiry_status === 'done' ? (
                    <button type="button" className="sb-inq-btn" disabled={busy} onClick={() => reopen(r)}>Back to new</button>
                  ) : (
                    <>
                      <button type="button" className="sb-inq-btn sb-inq-btn-mail" disabled={busy || !email} title={email ? '' : 'No email address on the form'} onClick={() => setEmailFor(r)}>
                        {r.first_touch_at ? 'Email again' : r.interest && r.interest !== 'unsure' ? `Email: ${INTERESTS.find(i => i.code === r.interest)?.label} intro + photos` : 'Email: what are you looking for?'}
                      </button>
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

      {emailFor && <InquiryEmailModal inquiry={emailFor} me={me} onClose={() => setEmailFor(null)} onSent={(m) => { setToast(m); load(); getInquiryFunnel().then(setFunnel).catch(() => {}) }} />}
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
  .sb-inq-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
  .sb-inq-stat { display: flex; flex-direction: column; min-width: 0; }
  .sb-inq-stat b { font-size: 19px; font-weight: 700; color: #1a1a1a; line-height: 1.1; white-space: nowrap; letter-spacing: -0.01em; }
  .sb-inq-stat span { font-size: 11px; color: #8a8472; }
  .sb-inq-bars { display: flex; flex-direction: column; gap: 6px; }
  .sb-inq-barrow { display: flex; justify-content: space-between; font-size: 12px; gap: 8px; }
  .sb-inq-bar { height: 8px; border-radius: 4px; background: #efece3; overflow: hidden; margin-top: 3px; }
  .sb-inq-bar i { display: block; height: 100%; background: #9A7209; }
  .sb-inq-kv { display: flex; justify-content: space-between; gap: 8px; font-size: 12px; }
  .sb-inq .mono { font-family: var(--font-m, 'JetBrains Mono'), monospace; color: #555; text-align: right; }
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
`
