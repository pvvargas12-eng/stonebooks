// =============================================================================
// Stonebooks — Email Command Center (Slice 1: the shell)
// =============================================================================
// The Email tab as a CRM operations surface, not a basic mailbox. Four zones:
//   • Smart buckets rail — Inbox / Needs reply / Customer replies / Unlinked /
//     Photos / Sent are data-backed today; the CRM-event buckets (Layout
//     approvals, Contracts, Quotes, Closeout, Waiting-on-X …) show as a roadmap
//     with a "soon" tag and light up as their engine slices land.
//   • Universal search — filters the list by sender, subject, snippet, customer
//     name (CRM-semantic search comes in a later slice).
//   • Message list — the selected bucket's customer threads.
//   • Reading pane + CRM brain — the thread, plus the customer/order context
//     (contract / quote / balance / warnings) so you never leave the tab.
//
// Reads shevcoteam's mail from the `messages` table (getEmailThreadsWorkspace).
// Sending stays on the shop Gmail via sendShopEmail. No migration.
// =============================================================================

import { useState, useEffect, useMemo } from 'react'
import {
  getEmailThreadsWorkspace, getMessageThread, getCustomerBrain,
  sendShopEmail, syncInbox, markThreadRead, getEmailSignature,
  rowBalanceDue, statusInfo, customerName, fmtUSD,
} from './lib/stonebooksData'

const SEARCH_EXAMPLES = ['Smith layout', 'Rosehill unsigned contract', 'photos missing', 'balance due', 'emails with attachments', 'waiting on approval']

// Sidebar buckets. `key` = data-backed + clickable now; `soon` = roadmap only.
const BUCKET_GROUPS = [
  { label: 'Mail', items: [
    { key: 'inbox', label: 'Inbox' },
    { key: 'needs_reply', label: 'Needs reply', tone: 'amber' },
    { key: 'unlinked', label: 'Unlinked', tone: 'red' },
  ] },
  { label: 'Replies', items: [
    { key: 'customer_replies', label: 'Customer replies' },
    { soon: true, label: 'Vendor replies' },
  ] },
  { label: 'Documents', items: [
    { soon: true, label: 'Layout approvals' },
    { soon: true, label: 'Contracts' },
    { soon: true, label: 'Quotes' },
    { soon: true, label: 'Receipts / payments' },
    { key: 'photos', label: 'Photos & files' },
    { soon: true, label: 'Cemetery / permits' },
    { soon: true, label: 'Closeout' },
  ] },
  { label: 'Workflow', items: [
    { soon: true, label: 'Production questions' },
    { soon: true, label: 'Waiting on customer' },
    { soon: true, label: 'Waiting on vendor' },
  ] },
  { label: 'System', items: [
    { key: 'sent', label: 'Sent' },
    { soon: true, label: 'Drafts' },
    { soon: true, label: 'Junk / spam' },
    { soon: true, label: 'Failed / attention' },
  ] },
]
const BUCKET_LABEL = {
  inbox: 'Inbox', needs_reply: 'Needs reply', customer_replies: 'Customer replies',
  unlinked: 'Unlinked', photos: 'Photos & files', sent: 'Sent',
}

function matchBucket(t, b) {
  switch (b) {
    case 'inbox': return t.hasInbound
    case 'needs_reply': return t.latestDirection === 'inbound'
    case 'customer_replies': return t.matched && t.hasInbound
    case 'unlinked': return !t.matched
    case 'photos': return t.hasAttachments
    case 'sent': return t.hasOutbound
    default: return true
  }
}
function matchSearch(t, q) {
  if (!q) return true
  const s = q.toLowerCase()
  return [t.name, t.contact, t.latestSubject, t.latestSnippet].some(x => (x || '').toLowerCase().includes(s))
}

function fromName(raw) {
  if (!raw) return '—'
  const m = String(raw).match(/^\s*"?(.*?)"?\s*<(.+?)>\s*$/)
  if (m && m[1]) return m[1]
  if (m && m[2]) return m[2]
  return raw
}
function fromEmail(raw) {
  const m = String(raw || '').match(/<(.+?)>/)
  return m ? m[1] : (raw || '')
}
function emailDate(str) {
  if (!str) return ''
  try {
    const d = new Date(str)
    if (isNaN(d.getTime())) return str
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  } catch { return str }
}

export default function EmailTab() {
  const [threads, setThreads] = useState([])
  const [counts, setCounts] = useState({})
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState(null)
  const [bucket, setBucket] = useState('inbox')
  const [q, setQ] = useState('')
  const [syncing, setSyncing] = useState(false)
  const [syncMsg, setSyncMsg] = useState(null)
  const [reading, setReading] = useState(null)  // { key, name, contact, customerId, threadKey, matched, busy, messages, err }
  const [brain, setBrain] = useState(null)       // { customer, orders } | null
  const [composer, setComposer] = useState(null)
  const [signature, setSignature] = useState('')

  useEffect(() => {
    let cancelled = false
    getEmailThreadsWorkspace().then(res => {
      if (cancelled) return
      if (!res.ok) { setErr(res.error || 'Could not load mail'); setThreads([]) }
      else { setThreads(res.threads); setCounts(res.counts) }
      setLoading(false)
    })
    getEmailSignature().then(s => { if (!cancelled) setSignature(s?.signature_text || '') })
    return () => { cancelled = true }
  }, [])

  const reload = async () => {
    setLoading(true); setErr(null)
    const res = await getEmailThreadsWorkspace()
    if (!res.ok) { setErr(res.error || 'Could not load mail'); setThreads([]) }
    else { setThreads(res.threads); setCounts(res.counts) }
    setLoading(false)
  }

  const visible = useMemo(
    () => threads.filter(t => matchBucket(t, bucket)).filter(t => matchSearch(t, q)),
    [threads, bucket, q],
  )

  const sync = async () => {
    setSyncing(true); setSyncMsg(null)
    const res = await syncInbox()
    setSyncing(false)
    if (!res.ok) { setSyncMsg(`Sync failed — ${res.error || 'error'}`); return }
    setSyncMsg(`Synced — ${res.processed} new message${res.processed === 1 ? '' : 's'}`)
    reload()
  }

  const openThread = async (t) => {
    setReading({ key: t.key, name: t.name, contact: t.contact, customerId: t.customerId, threadKey: t.threadKey, matched: t.matched, busy: true, messages: [], err: null })
    setBrain(null)
    if (t.unread > 0) {
      markThreadRead({ customerId: t.customerId, threadKey: t.threadKey })
      setThreads(ts => ts.map(x => x.key === t.key ? { ...x, unread: 0 } : x))
    }
    const res = await getMessageThread({ customerId: t.customerId, threadKey: t.threadKey })
    setReading(r => r && r.key === t.key
      ? (res.ok ? { ...r, busy: false, messages: res.messages } : { ...r, busy: false, err: res.error || 'Could not load thread' })
      : r)
    if (t.customerId) {
      const b = await getCustomerBrain(t.customerId)
      setBrain(prev => (b.ok ? { customer: b.customer, orders: b.orders } : prev))
    }
  }

  const replyToThread = () => {
    if (!reading || !reading.messages.length) return
    const msgs = reading.messages
    const last = [...msgs].reverse().find(m => m.gmailMessageId) || msgs[msgs.length - 1]
    const lastInbound = [...msgs].reverse().find(m => m.direction === 'inbound')
    const replyTo = fromEmail((lastInbound || last)?.from) || reading.contact || ''
    const subj = (last.subject || '').replace(/^(re:\s*)+/i, '')
    const refs = msgs.map(m => m.gmailMessageId).filter(Boolean)
    setComposer({
      to: replyTo, subject: subj ? `Re: ${subj}` : 'Re:', body: '',
      customerId: reading.customerId || null,
      inReplyTo: last.gmailMessageId || null, references: refs,
      busy: false, error: null, sent: false,
    })
  }

  const openComposer = () => setComposer({ to: '', subject: '', body: '', busy: false, error: null, sent: false })
  const closeComposer = () => setComposer(c => (c && c.busy ? c : null))
  const send = async () => {
    if (!composer) return
    const to = composer.to.trim(), subject = composer.subject.trim()
    if (!to || !subject || composer.busy) return
    setComposer(c => ({ ...c, busy: true, error: null }))
    const res = await sendShopEmail({
      to, subject, text: composer.body,
      customerId: composer.customerId || null,
      inReplyTo: composer.inReplyTo || null, references: composer.references || null,
    })
    if (!res.ok) { setComposer(c => ({ ...c, busy: false, error: res.error || 'Send failed' })); return }
    setComposer(c => ({ ...c, busy: false, sent: true }))
    reload()
  }

  return (
    <div className="cc-page">
      <style>{CC_CSS}</style>

      <header className="cc-top">
        <div className="cc-brandwrap">
          <h1 className="cc-title">Email</h1>
          <span className="cc-badge">Command center</span>
        </div>
        <div className="cc-search">
          <span className="cc-search-ic" aria-hidden="true">⌕</span>
          <input
            className="cc-search-input"
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Search customers, orders, subjects, senders…"
          />
          {q && <button type="button" className="cc-search-clear" onClick={() => setQ('')} aria-label="Clear search">×</button>}
        </div>
        <div className="cc-top-actions">
          <button type="button" className="cc-btn" onClick={sync} disabled={syncing || loading}>{syncing ? 'Syncing…' : 'Sync'}</button>
          <button type="button" className="cc-btn" onClick={reload} disabled={loading}>Refresh</button>
          <button type="button" className="cc-btn cc-btn-primary" onClick={openComposer}>Compose</button>
        </div>
      </header>

      <div className="cc-chips">
        <span className="cc-chips-lead">Try</span>
        {SEARCH_EXAMPLES.map(x => (
          <button type="button" key={x} className="cc-chip" onClick={() => setQ(x)}>{x}</button>
        ))}
      </div>

      {syncMsg && <div className="cc-syncmsg">{syncMsg}</div>}

      <div className="cc-body">
        {/* Smart buckets */}
        <aside className="cc-rail">
          {BUCKET_GROUPS.map(g => (
            <div key={g.label} className="cc-rail-group">
              <div className="cc-rail-label">{g.label}</div>
              {g.items.map(item => item.soon ? (
                <div key={item.label} className="cc-brow cc-brow-soon" title="Coming in a later slice">
                  <span className="cc-brow-name">{item.label}</span>
                  <span className="cc-soon">soon</span>
                </div>
              ) : (
                <button
                  key={item.key}
                  type="button"
                  className={`cc-brow${bucket === item.key ? ' on' : ''}`}
                  onClick={() => { setBucket(item.key); setReading(null); setBrain(null) }}
                >
                  {item.tone && <span className={`cc-dot cc-dot-${item.tone}`} aria-hidden="true" />}
                  <span className="cc-brow-name">{item.label}</span>
                  {counts[item.key] > 0 && <span className={`cc-count${item.tone ? ` cc-count-${item.tone}` : ''}`}>{counts[item.key]}</span>}
                </button>
              ))}
            </div>
          ))}
        </aside>

        {/* Message list */}
        <section className="cc-list">
          <div className="cc-list-head">
            <span className="cc-list-title">{BUCKET_LABEL[bucket] || 'Inbox'}</span>
            <span className="cc-list-sub">{loading ? 'Loading…' : `${visible.length} thread${visible.length === 1 ? '' : 's'}`}</span>
          </div>
          {err && <div className="cc-error">{err}<div className="cc-error-hint">Make sure the mailbox is connected and the Gmail functions are deployed.</div></div>}
          <div className="cc-list-scroll">
            {loading ? (
              <div className="cc-empty">Loading…</div>
            ) : visible.length === 0 && !err ? (
              <div className="cc-empty">{q ? 'No threads match your search.' : 'Nothing here.'}</div>
            ) : (
              visible.map(t => (
                <button
                  key={t.key}
                  type="button"
                  className={`cc-row${t.unread > 0 ? ' unread' : ''}${reading?.key === t.key ? ' active' : ''}`}
                  onClick={() => openThread(t)}
                >
                  <div className="cc-row-top">
                    <span className="cc-row-from">
                      {t.unread > 0 && <span className="cc-unread-dot" aria-hidden="true" />}
                      {t.name}
                    </span>
                    <span className="cc-row-date">{emailDate(t.latestDate)}</span>
                  </div>
                  <div className="cc-row-subject">{t.latestSubject || '(no subject)'}</div>
                  <div className="cc-row-bottom">
                    <span className="cc-row-snippet">{t.latestSnippet}</span>
                    {!t.matched && <span className="cc-tag cc-tag-warn">unlinked</span>}
                    {t.hasAttachments && <span className="cc-tag">attach</span>}
                    {t.unread > 0 && <span className="cc-tag cc-tag-unread">{t.unread}</span>}
                  </div>
                </button>
              ))
            )}
          </div>
        </section>

        {/* Reading pane + CRM brain */}
        <section className="cc-detail">
          <div className="cc-read">
            {!reading ? (
              <div className="cc-read-empty">Select a thread to read it here.</div>
            ) : (
              <>
                <div className="cc-read-head">
                  <div>
                    <div className="cc-read-name">{reading.name || 'Conversation'}</div>
                    {reading.contact && <div className="cc-read-contact">{reading.contact}</div>}
                  </div>
                  <div className="cc-read-head-actions">
                    <button type="button" className="cc-btn cc-btn-primary" onClick={replyToThread} disabled={reading.busy}>Reply</button>
                    <button type="button" className="cc-btn" onClick={() => { setReading(null); setBrain(null) }}>Close</button>
                  </div>
                </div>
                <div className="cc-read-body">
                  {reading.busy ? (
                    <div className="cc-empty">Loading thread…</div>
                  ) : reading.err ? (
                    <div className="cc-error">{reading.err}</div>
                  ) : reading.messages.length === 0 ? (
                    <div className="cc-empty">No messages in this thread yet.</div>
                  ) : (
                    reading.messages.map(msg => (
                      <div key={msg.id} className={`cc-msg${msg.direction === 'outbound' ? ' out' : ''}`}>
                        <div className="cc-msg-meta">
                          <span className="cc-msg-from">{msg.direction === 'outbound' ? 'Shevchenko Monuments' : fromName(msg.from)}</span>
                          {msg.subject && <span className="cc-msg-subj">{msg.subject}</span>}
                          <span className="cc-msg-date">{emailDate(msg.date)}</span>
                        </div>
                        <div className="cc-msg-body">{msg.body || '(no text body)'}</div>
                      </div>
                    ))
                  )}
                </div>
              </>
            )}
          </div>

          <aside className="cc-brain">
            {!reading ? (
              <div className="cc-brain-empty">CRM context appears here.</div>
            ) : !reading.matched ? (
              <div className="cc-brain-pad">
                <div className="cc-brain-warn"><strong>Not linked to a customer.</strong> This email’s sender didn’t match anyone on file.</div>
                <div className="cc-brain-hint">Linking &amp; the full CRM brain arrive with the next slices.</div>
              </div>
            ) : !brain ? (
              <div className="cc-brain-pad"><div className="cc-empty">Loading customer…</div></div>
            ) : (
              <div className="cc-brain-pad">
                <div className="cc-brain-cust">
                  <div className="cc-avatar">{initials(brain.customer)}</div>
                  <div>
                    <div className="cc-brain-name">{brain.customer ? customerName(brain.customer) : reading.name}</div>
                    <div className="cc-brain-contact">{brain.customer?.email || reading.contact}</div>
                    {brain.customer?.phone_primary && <div className="cc-brain-contact">{brain.customer.phone_primary}</div>}
                  </div>
                </div>

                {brainWarnings(brain).length > 0 && (
                  <div className="cc-brain-sec">
                    <div className="cc-brain-seclabel">Warnings</div>
                    {brainWarnings(brain).map((w, i) => (
                      <div key={i} className={`cc-warn cc-warn-${w.tone}`}>{w.text}</div>
                    ))}
                  </div>
                )}

                <div className="cc-brain-sec">
                  <div className="cc-brain-seclabel">Orders · {brain.orders.length}</div>
                  {brain.orders.length === 0 ? (
                    <div className="cc-brain-hint">No orders on file.</div>
                  ) : brain.orders.slice(0, 4).map(o => {
                    const si = statusInfo(o.status)
                    const bal = rowBalanceDue(o)
                    return (
                      <div key={o.id} className="cc-order">
                        <div className="cc-order-top">
                          <span className="cc-order-num">#{o.order_number || 'DRAFT'}</span>
                          <span className="cc-order-status" style={{ '--sc': si?.color || '#8a8a85' }}>{si?.label || o.status}</span>
                        </div>
                        {o.cemetery?.name && <div className="cc-order-cem">{o.cemetery.name}</div>}
                        <div className="cc-order-chips">
                          <span className={`cc-schip ${o.signed_at ? 'ok' : 'mut'}`}>{o.signed_at ? 'Contract signed' : 'Not signed'}</span>
                          {o.quote_status && <span className="cc-schip mut">Quote: {o.quote_status}</span>}
                          <span className={`cc-schip ${bal > 0 ? 'amber' : 'ok'}`}>{bal > 0 ? `${fmtUSD(bal)} due` : 'Paid'}</span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </aside>
        </section>
      </div>

      {/* Compose / reply modal */}
      {composer && (
        <div className="cc-modal-overlay" onClick={closeComposer}>
          <div className="cc-composer" onClick={e => e.stopPropagation()}>
            <div className="cc-composer-title">New email</div>
            {composer.sent ? (
              <>
                <div className="cc-ok">✓ Sent to {composer.to}</div>
                <div className="cc-composer-actions">
                  <button type="button" className="cc-btn cc-btn-primary" onClick={() => setComposer(null)}>Done</button>
                </div>
              </>
            ) : (
              <>
                <label className="cc-field"><span>To</span>
                  <input type="email" className="cc-input" value={composer.to} onChange={e => setComposer(c => ({ ...c, to: e.target.value }))} placeholder="recipient@example.com" /></label>
                <label className="cc-field"><span>Subject</span>
                  <input type="text" className="cc-input" value={composer.subject} onChange={e => setComposer(c => ({ ...c, subject: e.target.value }))} placeholder="Subject" /></label>
                <label className="cc-field"><span>Message</span>
                  <textarea className="cc-input" rows={8} value={composer.body} onChange={e => setComposer(c => ({ ...c, body: e.target.value }))} placeholder="Write your message…" /></label>
                {signature && (
                  <div className="cc-sig">
                    <div className="cc-sig-label">Signature — added automatically</div>
                    <div className="cc-sig-body">{signature}</div>
                  </div>
                )}
                {composer.error && <div className="cc-error">{composer.error}</div>}
                <div className="cc-composer-actions">
                  <button type="button" className="cc-btn" onClick={closeComposer} disabled={composer.busy}>Cancel</button>
                  <button type="button" className="cc-btn cc-btn-primary" onClick={send} disabled={composer.busy || !composer.to.trim() || !composer.subject.trim()}>{composer.busy ? 'Sending…' : 'Send'}</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function initials(c) {
  if (!c) return '—'
  const a = (c.first_name || '').trim()[0] || ''
  const b = (c.last_name || '').trim()[0] || ''
  return (a + b).toUpperCase() || '—'
}

// Warnings for the CRM brain — computed from the customer + their orders.
function brainWarnings(brain) {
  const out = []
  if (!brain?.customer?.email) out.push({ tone: 'red', text: 'No customer email on file' })
  const open = (brain?.orders || []).length
  if (open > 1) out.push({ tone: 'amber', text: `Customer has ${open} orders` })
  const due = (brain?.orders || []).reduce((s, o) => s + rowBalanceDue(o), 0)
  if (due > 0) out.push({ tone: 'amber', text: `${fmtUSD(due)} balance due` })
  return out
}

const CC_CSS = `
  .cc-page { background: var(--sb-canvas, #F7F6F3); min-height: 100%; padding: 20px 0 48px; color: #2A2118; }
  .cc-top { display: flex; align-items: center; gap: 14px; padding: 0 28px 14px; }
  .cc-brandwrap { display: flex; align-items: baseline; gap: 9px; flex-shrink: 0; }
  .cc-title { font-family: var(--sb-font-display, 'Fraunces', Georgia, serif); font-size: 28px; font-weight: 600; margin: 0; letter-spacing: -0.01em; }
  .cc-badge { font-size: 11px; font-weight: 600; color: #876307; background: rgba(154,114,9,0.1); border-radius: 999px; padding: 3px 10px; }
  .cc-search { flex: 1; display: flex; align-items: center; gap: 8px; background: #fff; border: 0.5px solid #E2D8C6; border-radius: 10px; padding: 9px 13px; min-width: 0; }
  .cc-search-ic { color: #8a8a85; font-size: 16px; }
  .cc-search-input { flex: 1; border: none; outline: none; font: inherit; font-size: 14px; background: none; color: #2A2118; min-width: 0; }
  .cc-search-clear { border: none; background: none; color: #8a8a85; font-size: 18px; cursor: pointer; line-height: 1; padding: 0 2px; }
  .cc-top-actions { display: flex; gap: 8px; flex-shrink: 0; }
  .cc-btn { font: inherit; font-size: 13px; font-weight: 500; padding: 8px 14px; border-radius: 8px; border: 0.5px solid #d8d6d1; background: #fff; color: #222; cursor: pointer; }
  .cc-btn:hover:not(:disabled) { background: #f4f2ee; }
  .cc-btn:disabled { opacity: 0.5; cursor: default; }
  .cc-btn-primary { background: #9A7209; border-color: #9A7209; color: #fff; }
  .cc-btn-primary:hover:not(:disabled) { background: #876307; }
  .cc-chips { display: flex; align-items: center; gap: 7px; flex-wrap: wrap; padding: 0 28px 12px; }
  .cc-chips-lead { font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em; color: #8a8a85; font-weight: 600; }
  .cc-chip { font: inherit; font-size: 12px; padding: 4px 10px; border-radius: 7px; border: 0.5px solid #E2D8C6; background: #fff; color: #444; cursor: pointer; }
  .cc-chip:hover { background: #faf8f4; border-color: #9A7209; }
  .cc-syncmsg { margin: 0 28px 12px; font-size: 12.5px; color: #876307; background: rgba(154,114,9,0.07); border: 0.5px solid rgba(154,114,9,0.25); border-radius: 8px; padding: 8px 12px; }

  .cc-body { display: grid; grid-template-columns: 210px 340px 1fr; gap: 0; margin: 0 28px; background: #fff; border: 0.5px solid #E2D8C6; border-radius: 14px; overflow: hidden; }
  @media (max-width: 1100px) { .cc-body { grid-template-columns: 190px 300px 1fr; } }

  .cc-rail { background: #0F1419; padding: 8px 8px 16px; max-height: calc(100vh - 210px); overflow-y: auto; }
  .cc-rail-group { margin-bottom: 4px; }
  .cc-rail-label { font-size: 10px; letter-spacing: 0.09em; text-transform: uppercase; color: #8a8272; padding: 11px 10px 4px; font-weight: 600; }
  .cc-brow { display: flex; align-items: center; gap: 8px; width: 100%; text-align: left; font: inherit; font-size: 12.5px; color: #d8d2c6; background: none; border: none; border-radius: 8px; padding: 7px 10px; cursor: pointer; }
  .cc-brow:hover { background: rgba(255,255,255,0.05); }
  .cc-brow.on { background: rgba(184,134,11,0.18); color: #fff; }
  .cc-brow-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .cc-brow-soon { cursor: default; color: #6f6a5f; }
  .cc-brow-soon:hover { background: none; }
  .cc-soon { font-size: 9.5px; text-transform: uppercase; letter-spacing: 0.06em; color: #6f6a5f; border: 0.5px solid #33302a; border-radius: 5px; padding: 1px 5px; }
  .cc-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
  .cc-dot-amber { background: #d9a441; } .cc-dot-red { background: #d76d63; }
  .cc-count { font-size: 10.5px; font-weight: 600; padding: 1px 7px; border-radius: 999px; background: rgba(255,255,255,0.09); color: #cfc9bf; }
  .cc-count-amber { background: rgba(183,121,31,0.28); color: #e9b45f; }
  .cc-count-red { background: rgba(179,38,30,0.28); color: #e79892; }

  .cc-list { border-left: 0.5px solid #ECE3D2; border-right: 0.5px solid #ECE3D2; display: flex; flex-direction: column; min-width: 0; }
  .cc-list-head { padding: 13px 16px 10px; border-bottom: 0.5px solid #ECE3D2; }
  .cc-list-title { font-size: 15px; font-weight: 600; }
  .cc-list-sub { font-size: 12px; color: #8a8a85; margin-left: 8px; }
  .cc-list-scroll { overflow-y: auto; max-height: calc(100vh - 258px); }
  .cc-row { display: block; width: 100%; text-align: left; font: inherit; background: none; border: none; border-bottom: 0.5px solid #f1efeb; padding: 11px 16px; cursor: pointer; }
  .cc-row:hover { background: #faf8f4; }
  .cc-row.active { background: rgba(154,114,9,0.06); }
  .cc-row.unread { background: #fffdf7; }
  .cc-row-top { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
  .cc-row-from { font-size: 13.5px; color: #222; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .cc-row.unread .cc-row-from, .cc-row.unread .cc-row-subject { font-weight: 700; }
  .cc-unread-dot { display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: #9A7209; margin-right: 6px; vertical-align: middle; }
  .cc-row-date { font-size: 11.5px; color: #8a8a85; flex-shrink: 0; }
  .cc-row-subject { font-size: 13px; color: #333; margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .cc-row-bottom { display: flex; align-items: center; gap: 6px; margin-top: 3px; }
  .cc-row-snippet { font-size: 12px; color: #8a8a85; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; min-width: 0; }
  .cc-tag { font-size: 10px; font-weight: 600; padding: 1px 6px; border-radius: 5px; background: #f1efeb; color: #7a7468; flex-shrink: 0; }
  .cc-tag-warn { background: rgba(179,38,30,0.08); color: #b3261e; }
  .cc-tag-unread { background: #9A7209; color: #fff; }

  .cc-detail { display: flex; min-width: 0; }
  .cc-read { flex: 1; min-width: 0; display: flex; flex-direction: column; max-height: calc(100vh - 210px); }
  .cc-read-empty, .cc-brain-empty { color: #8a8a85; font-size: 14px; padding: 70px 22px; text-align: center; margin: auto; }
  .cc-read-head { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 14px 18px; border-bottom: 0.5px solid #ECE3D2; }
  .cc-read-name { font-size: 15px; font-weight: 600; }
  .cc-read-contact { font-size: 12.5px; color: #8a7f6c; margin-top: 2px; }
  .cc-read-head-actions { display: flex; gap: 8px; }
  .cc-read-body { padding: 6px 18px 18px; overflow-y: auto; flex: 1; }
  .cc-msg { padding: 13px 0; border-bottom: 0.5px solid #f1efeb; }
  .cc-msg.out { background: #faf7f1; margin: 0 -18px; padding: 13px 18px; }
  .cc-msg-meta { display: flex; gap: 8px; align-items: baseline; flex-wrap: wrap; margin-bottom: 6px; }
  .cc-msg-from { font-size: 13px; font-weight: 600; }
  .cc-msg-subj { font-size: 12px; color: #8a7f6c; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
  .cc-msg-date { font-size: 11.5px; color: #8a8a85; margin-left: auto; }
  .cc-msg-body { font-size: 13.5px; color: #333; white-space: pre-wrap; word-break: break-word; line-height: 1.5; }

  .cc-brain { width: 288px; flex-shrink: 0; border-left: 0.5px solid #ECE3D2; background: #FCFAF6; max-height: calc(100vh - 210px); overflow-y: auto; }
  @media (max-width: 1100px) { .cc-brain { width: 240px; } }
  .cc-brain-pad { padding: 14px 15px; }
  .cc-brain-cust { display: flex; align-items: center; gap: 10px; padding-bottom: 12px; border-bottom: 0.5px solid #ECE3D2; }
  .cc-avatar { width: 36px; height: 36px; border-radius: 50%; background: rgba(154,114,9,0.1); color: #876307; font-weight: 700; font-size: 12px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
  .cc-brain-name { font-size: 13.5px; font-weight: 600; }
  .cc-brain-contact { font-size: 11.5px; color: #8a7f6c; }
  .cc-brain-sec { padding: 12px 0; border-bottom: 0.5px solid #ECE3D2; }
  .cc-brain-seclabel { font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em; color: #9a8a5e; font-weight: 700; margin-bottom: 7px; }
  .cc-brain-hint { font-size: 11.5px; color: #8a8a85; }
  .cc-warn { font-size: 11.5px; border-radius: 7px; padding: 6px 8px; margin-bottom: 5px; }
  .cc-warn-red { color: #b3261e; background: rgba(179,38,30,0.07); }
  .cc-warn-amber { color: #8a5a12; background: rgba(183,121,31,0.13); }
  .cc-brain-warn { font-size: 12px; color: #8a5a12; background: rgba(183,121,31,0.12); border-radius: 8px; padding: 9px 10px; margin-bottom: 8px; }
  .cc-order { padding: 9px 0; border-bottom: 0.5px solid #f1efeb; }
  .cc-order:last-child { border-bottom: none; }
  .cc-order-top { display: flex; justify-content: space-between; align-items: center; }
  .cc-order-num { font-size: 12.5px; font-weight: 600; font-family: ui-monospace, monospace; }
  .cc-order-status { font-size: 10.5px; font-weight: 600; padding: 1px 7px; border-radius: 5px; color: var(--sc); background: color-mix(in srgb, var(--sc) 12%, transparent); }
  .cc-order-cem { font-size: 11.5px; color: #8a7f6c; margin: 2px 0 5px; }
  .cc-order-chips { display: flex; gap: 5px; flex-wrap: wrap; }
  .cc-schip { font-size: 10.5px; font-weight: 500; padding: 2px 7px; border-radius: 5px; }
  .cc-schip.ok { background: rgba(31,122,61,0.1); color: #1f7a3d; }
  .cc-schip.amber { background: rgba(183,121,31,0.13); color: #8a5a12; }
  .cc-schip.mut { background: #f1efeb; color: #7a7468; }

  .cc-empty { color: #8a8a85; font-size: 13.5px; padding: 34px 0; text-align: center; }
  .cc-error { font-size: 13px; color: #b3261e; background: rgba(179,38,30,0.06); border: 0.5px solid rgba(179,38,30,0.3); border-radius: 8px; padding: 10px 12px; margin: 12px 16px; }
  .cc-error-hint { font-size: 12px; color: #8a8a85; margin-top: 4px; }

  .cc-modal-overlay { position: fixed; inset: 0; background: rgba(15,20,25,0.5); display: flex; align-items: center; justify-content: center; z-index: 1000; }
  .cc-composer { background: #fff; border-radius: 12px; padding: 22px; width: min(560px, 94vw); box-shadow: 0 12px 48px rgba(0,0,0,0.2); }
  .cc-composer-title { font-size: 16px; font-weight: 600; margin-bottom: 14px; }
  .cc-field { display: flex; flex-direction: column; gap: 4px; margin-bottom: 12px; }
  .cc-field > span { font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: #8a8a85; font-weight: 600; }
  .cc-input { width: 100%; box-sizing: border-box; font: inherit; font-size: 13.5px; padding: 9px 12px; border-radius: 8px; border: 0.5px solid #d8d6d1; resize: vertical; }
  .cc-input:focus-visible { outline: 2px solid #9A7209; outline-offset: 1px; }
  .cc-composer-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 6px; }
  .cc-sig { margin-top: 4px; padding: 10px 12px; background: #faf7f1; border: 0.5px solid #ece3d2; border-radius: 8px; }
  .cc-sig-label { font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.07em; color: #9a8a5e; font-weight: 700; margin-bottom: 4px; }
  .cc-sig-body { font-size: 12.5px; color: #6b6256; white-space: pre-wrap; line-height: 1.45; }
  .cc-ok { font-size: 13px; color: #1f7a3d; background: rgba(31,122,61,0.07); border: 0.5px solid rgba(31,122,61,0.3); border-radius: 8px; padding: 10px 12px; margin-bottom: 14px; }
`
