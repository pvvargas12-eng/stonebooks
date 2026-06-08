// =============================================================================
// Stonebooks — Email tab (Gmail Path B — App-Password SMTP/IMAP, shevcoteam@)
// =============================================================================
// Top-level mailbox surface for the shared shop Gmail (shevcoteam@gmail.com).
// Reads ONLY the `messages` table (synced from shevcoteam by /api/email/sync) —
// there is NO legacy gmail-list / OAuth read path, so the old (paul@) account's
// mail never appears here.
//   • Inbox — grouped by CUSTOMER (one thread per customer), unread emphasis
//     (getInboxThreads).
//   • Reading pane — the customer's full thread inbound+outbound (getMessageThread).
//   • Compose / Reply — sent via sendShopEmail (shop Gmail SMTP only; signature
//     auto-added; In-Reply-To/References set so Gmail threads it).
//   • "Sync now" — triggers /api/email/sync (the cron runs it every ~3 min).
// =============================================================================

import { useState, useEffect } from 'react'
import { getInboxThreads, getMessageThread, sendShopEmail, syncInbox, markThreadRead, getEmailSignature } from './lib/stonebooksData'

const FOLDERS = [
  { key: 'INBOX', label: 'Inbox' },
  { key: 'SENT', label: 'Sent' },
]

// Module-scope formatters (keeps `new Date()` out of the render body).
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
  const [folder, setFolder] = useState('INBOX')  // 'INBOX' | 'SENT'
  const [messages, setMessages] = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState(null)
  const [syncing, setSyncing] = useState(false)
  const [syncMsg, setSyncMsg] = useState(null)
  const [reading, setReading] = useState(null)   // { threadId, subject, busy, messages, err } | null
  const [composer, setComposer] = useState(null) // { to, subject, body, busy, error, sent } | null
  const [signature, setSignature] = useState('') // shop signature (auto-appended; shown in Compose)

  useEffect(() => {
    let cancelled = false
    getEmailSignature().then(s => { if (!cancelled) setSignature(s?.signature_text || '') })
    return () => { cancelled = true }
  }, [])

  // Load the current folder from the messages table. Inbox = inbound, Sent =
  // outbound. (Reads shevcoteam's mail synced by /api/email/sync — not paul@.)
  // Load the current folder, GROUPED BY CUSTOMER (one thread per customer).
  const load = async (target = folder) => {
    setLoading(true); setErr(null)
    const res = await getInboxThreads(target)
    if (!res.ok) { setErr(res.error || 'Could not load mail'); setMessages([]); setLoading(false); return }
    setMessages(res.threads); setLoading(false)
  }
  const switchFolder = (key) => {
    if (key === folder) return
    setFolder(key)
    setMessages([])
    load(key)
  }
  // loading inits true; fire once on mount (no synchronous setState before await).
  useEffect(() => {
    let cancelled = false
    getInboxThreads('INBOX').then(res => {
      if (cancelled) return
      if (!res.ok) { setErr(res.error || 'Could not load mail'); setMessages([]) }
      else setMessages(res.threads)
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [])

  // "Sync now" — trigger the IMAP poll, then refresh the list.
  const sync = async () => {
    setSyncing(true); setSyncMsg(null)
    const res = await syncInbox()
    setSyncing(false)
    if (!res.ok) { setSyncMsg(`Sync failed — ${res.error || 'error'}`); return }
    setSyncMsg(`Synced — ${res.processed} new message${res.processed === 1 ? '' : 's'}`)
    load(folder)
  }

  const isSent = folder === 'SENT'
  const folderLabel = FOLDERS.find(f => f.key === folder)?.label || 'Inbox'

  // Open the CUSTOMER's full thread (every message with the shop) — the same
  // thread shown in every one of that customer's orders.
  const openThread = async (t) => {
    const key = t.key
    setReading({ key, name: t.name, contact: t.contact, customerId: t.customerId, threadKey: t.threadKey, busy: true, messages: [], err: null })
    if (t.unread > 0) {
      markThreadRead({ customerId: t.customerId, threadKey: t.threadKey })
      setMessages(ms => ms.map(x => x.key === key ? { ...x, unread: 0 } : x))
    }
    const res = await getMessageThread({ customerId: t.customerId, threadKey: t.threadKey })
    setReading(r => r && r.key === key
      ? (res.ok ? { ...r, busy: false, messages: res.messages } : { ...r, busy: false, err: res.error || 'Could not load thread' })
      : r)
  }

  // Reply into a thread — sets In-Reply-To / References so Gmail threads it.
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
    // Refresh so the just-sent message threads in (and the Sent folder updates).
    load(folder)
  }

  return (
    <div className="sb-email-page">
      <style>{EMAIL_CSS}</style>
      <div className="sb-email-shell">
        {/* Left rail — folders + compose (mail-client layout). */}
        <aside className="sb-email-rail">
          <button type="button" className="sb-email-compose-btn" onClick={openComposer}>Compose</button>
          <div className="sb-email-rail-label">Folders</div>
          <nav className="sb-email-folders">
            {FOLDERS.map(f => (
              <button
                key={f.key}
                type="button"
                className={`sb-email-folder${folder === f.key ? ' on' : ''}`}
                onClick={() => switchFolder(f.key)}
              >
                {f.label}
              </button>
            ))}
          </nav>
        </aside>

        {/* Main — header + message list for the active folder. */}
        <div className="sb-email-main">
          <header className="sb-email-head">
            <div>
              <h1 className="sb-email-title">{folderLabel}</h1>
              <div className="sb-email-sub">
                {loading ? 'Loading…' : `${messages.length} message${messages.length === 1 ? '' : 's'}`}
              </div>
            </div>
            <div className="sb-email-head-actions">
              <button type="button" className="sb-email-btn" onClick={sync} disabled={syncing || loading}>
                {syncing ? 'Syncing…' : 'Sync inbox'}
              </button>
              <button type="button" className="sb-email-btn" onClick={() => load()} disabled={loading}>Refresh</button>
            </div>
          </header>

          {syncMsg && <div className="sb-email-syncmsg">{syncMsg}</div>}

          {err && (
            <div className="sb-email-error">
              {err}
              <div className="sb-email-error-hint">Make sure the mailbox is connected (Settings → Integrations) and the Gmail functions are deployed.</div>
            </div>
          )}

          <div className="sb-email-body">
          <div className="sb-email-list">
            {loading ? (
              <div className="sb-email-empty">Loading…</div>
            ) : messages.length === 0 && !err ? (
              <div className="sb-email-empty">{isSent ? 'No sent mail.' : 'Inbox is empty.'}</div>
            ) : (
              messages.map(t => (
                <button
                  key={t.key}
                  type="button"
                  className={`sb-email-row${t.unread > 0 ? ' sb-email-row-unread' : ''}`}
                  onClick={() => openThread(t)}
                >
                  {t.unread > 0 && <span className="sb-email-unread-dot" aria-label="unread" />}
                  {/* One row per customer — their whole thread with the shop. */}
                  <span className="sb-email-from">
                    {t.name}{t.unread > 0 ? <span className="sb-email-unread-count"> {t.unread}</span> : null}
                  </span>
                  <span className="sb-email-mid">
                    <span className="sb-email-subject">{t.latestSubject || '(no subject)'}</span>
                    <span className="sb-email-snippet">{t.latestSnippet}</span>
                  </span>
                  <span className="sb-email-date">{emailDate(t.latestDate)}</span>
                </button>
              ))
            )}
          </div>

          {/* Reading pane — full thread, inline (no modal) */}
          <div className="sb-email-reader-pane">
            {reading ? (
              <>
                <div className="sb-email-reader-head">
                  <div>
                    <div className="sb-email-reader-subject">{reading.name || 'Conversation'}</div>
                    {reading.contact && <div className="sb-email-reader-contact">{reading.contact}</div>}
                  </div>
                  <button type="button" className="sb-email-btn" onClick={() => setReading(null)}>Close</button>
                </div>
                <div className="sb-email-reader-body">
                  {reading.busy ? (
                    <div className="sb-email-empty">Loading thread…</div>
                  ) : reading.err ? (
                    <div className="sb-email-error">{reading.err}</div>
                  ) : reading.messages.length === 0 ? (
                    <div className="sb-email-empty">No messages in this thread yet.</div>
                  ) : (
                    reading.messages.map(msg => (
                      <div key={msg.id} className={`sb-email-msg${msg.direction === 'outbound' ? ' sb-email-msg-out' : ''}`}>
                        <div className="sb-email-msg-meta">
                          <span className="sb-email-msg-from">{msg.direction === 'outbound' ? 'Shevchenko Monuments' : fromName(msg.from)}</span>
                          {msg.subject && <span className="sb-email-msg-subj">{msg.subject}</span>}
                          <span className="sb-email-msg-date">{emailDate(msg.date)}</span>
                        </div>
                        <div className="sb-email-msg-body">{msg.body || '(no text body)'}</div>
                      </div>
                    ))
                  )}
                </div>
                {!reading.busy && !reading.err && (
                  <div className="sb-email-reader-foot">
                    <button type="button" className="sb-email-btn sb-email-btn-primary" onClick={replyToThread}>Reply</button>
                  </div>
                )}
              </>
            ) : (
              <div className="sb-email-reader-empty">Select a message to read it here.</div>
            )}
          </div>
          </div>
        </div>
      </div>

      {/* Compose modal — reuses the gmail-send path */}
      {composer && (
        <div className="sb-email-modal-overlay" onClick={closeComposer}>
          <div className="sb-email-composer" onClick={e => e.stopPropagation()}>
            <div className="sb-email-composer-title">New email</div>
            {composer.sent ? (
              <>
                <div className="sb-email-ok">✓ Sent to {composer.to}</div>
                <div className="sb-email-composer-actions">
                  <button type="button" className="sb-email-btn sb-email-btn-primary" onClick={() => setComposer(null)}>Done</button>
                </div>
              </>
            ) : (
              <>
                <label className="sb-email-field"><span>To</span>
                  <input type="email" className="sb-email-input" value={composer.to}
                    onChange={e => setComposer(c => ({ ...c, to: e.target.value }))} placeholder="recipient@example.com" /></label>
                <label className="sb-email-field"><span>Subject</span>
                  <input type="text" className="sb-email-input" value={composer.subject}
                    onChange={e => setComposer(c => ({ ...c, subject: e.target.value }))} placeholder="Subject" /></label>
                <label className="sb-email-field"><span>Message</span>
                  <textarea className="sb-email-input" rows={8} value={composer.body}
                    onChange={e => setComposer(c => ({ ...c, body: e.target.value }))} placeholder="Write your message…" /></label>
                {signature && (
                  <div className="sb-email-sig-preview">
                    <div className="sb-email-sig-label">Signature — added automatically</div>
                    <div className="sb-email-sig-body">{signature}</div>
                  </div>
                )}
                {composer.error && <div className="sb-email-error">{composer.error}</div>}
                <div className="sb-email-composer-actions">
                  <button type="button" className="sb-email-btn" onClick={closeComposer} disabled={composer.busy}>Cancel</button>
                  <button type="button" className="sb-email-btn sb-email-btn-primary" onClick={send}
                    disabled={composer.busy || !composer.to.trim() || !composer.subject.trim()}>
                    {composer.busy ? 'Sending…' : 'Send'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

const EMAIL_CSS = `
  .sb-email-page { background: var(--sb-canvas, #faf7f1); min-height: 100%; padding: 24px 0 64px; }
  /* Full-width — fills the page like the other tabs / Quote Hub (no centered card). */
  .sb-email-shell { margin: 0; padding: 0 32px; display: grid; grid-template-columns: 200px 1fr; gap: 28px; align-items: start; }
  @media (max-width: 720px) { .sb-email-shell { grid-template-columns: 1fr; } }

  /* List + inline reading pane, side by side, filling the width. */
  .sb-email-body { display: grid; grid-template-columns: minmax(340px, 460px) 1fr; gap: 20px; align-items: start; }
  @media (max-width: 1100px) { .sb-email-body { grid-template-columns: 1fr; } }
  .sb-email-reader-pane {
    background: #fff; border: 0.5px solid var(--sb-border, #ece3d2); border-radius: 12px;
    min-height: 460px; max-height: calc(100vh - 200px); display: flex; flex-direction: column;
    overflow: hidden; position: sticky; top: 24px;
  }
  .sb-email-reader-empty { color: #8a8a85; font-size: 14.5px; padding: 80px 24px; text-align: center; margin: auto; }
  .sb-email-unread-count { display: inline-block; background: #9a7209; color: #fff; font-size: 11px; font-weight: 700; border-radius: 999px; padding: 0 6px; margin-left: 5px; vertical-align: middle; }
  .sb-email-reader-contact { font-size: 12.5px; color: #8a7f6c; margin-top: 2px; }
  .sb-email-msg-out { background: #faf7f1; }
  .sb-email-msg-subj { font-size: 12px; color: #8a7f6c; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }

  /* Left rail */
  .sb-email-rail { display: flex; flex-direction: column; gap: 6px; position: sticky; top: 24px; }
  .sb-email-compose-btn {
    font-size: 13.5px; font-weight: 600; padding: 10px 14px; border-radius: 8px;
    border: 0.5px solid #9A7209; background: #9A7209; color: #fff; cursor: pointer; margin-bottom: 10px;
  }
  .sb-email-compose-btn:hover { background: #876307; }
  .sb-email-rail-label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: #8a8a85; font-weight: 600; padding: 0 6px 4px; }
  .sb-email-folders { display: flex; flex-direction: column; gap: 2px; }
  .sb-email-folder {
    text-align: left; font: inherit; font-size: 14px; color: #444; background: none; border: none;
    border-radius: 8px; padding: 8px 12px; cursor: pointer;
  }
  .sb-email-folder:hover { background: #f1efea; }
  .sb-email-folder.on { background: rgba(154,114,9,0.1); color: #876307; font-weight: 600; }

  .sb-email-main { min-width: 0; }
  .sb-email-head { display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 18px; }
  .sb-email-title { font-family: var(--sb-font-display, 'Fraunces', Georgia, serif); font-size: 30px; font-weight: 600; color: #2a2118; margin: 0; letter-spacing: -0.01em; }
  .sb-email-sub { font-size: 13px; color: #8a8a85; margin-top: 4px; }
  .sb-email-head-actions { display: flex; gap: 8px; }
  .sb-email-btn {
    font-size: 13px; font-weight: 500; padding: 8px 14px; border-radius: 8px;
    border: 0.5px solid var(--sb-border, #d8d6d1); background: #fff; color: #222; cursor: pointer;
  }
  .sb-email-btn:hover:not(:disabled) { background: #f4f2ee; }
  .sb-email-btn:disabled { opacity: 0.5; cursor: default; }
  .sb-email-btn-primary { background: #9A7209; border-color: #9A7209; color: #fff; font-weight: 600; }
  .sb-email-btn-primary:hover:not(:disabled) { background: #876307; }
  .sb-email-error {
    font-size: 13px; color: #b3261e; background: rgba(179,38,30,0.06);
    border: 0.5px solid rgba(179,38,30,0.3); border-radius: 8px; padding: 10px 12px; margin-bottom: 14px;
  }
  .sb-email-error-hint { font-size: 12px; color: #8a8a85; margin-top: 4px; }
  .sb-email-sig-preview { margin-top: 12px; padding: 10px 12px; background: #faf7f1; border: 0.5px solid var(--sb-border, #ece3d2); border-radius: 8px; }
  .sb-email-sig-label { font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.07em; color: #9a8a5e; font-weight: 700; margin-bottom: 4px; }
  .sb-email-sig-body { font-size: 12.5px; color: #6b6256; white-space: pre-wrap; line-height: 1.45; }
  .sb-email-syncmsg {
    font-size: 12.5px; color: #876307; background: rgba(154,114,9,0.07);
    border: 0.5px solid rgba(154,114,9,0.25); border-radius: 8px; padding: 8px 12px; margin-bottom: 14px;
  }
  .sb-email-assoc {
    flex-shrink: 0; font-size: 11px; font-weight: 600; color: #1f7a3d;
    background: rgba(31,122,61,0.1); border-radius: 4px; padding: 1px 7px; white-space: nowrap;
  }
  .sb-email-empty { color: #8a8a85; font-size: 14px; padding: 40px 0; text-align: center; }

  .sb-email-list { background: #fff; border: 0.5px solid var(--sb-border, #ece3d2); border-radius: 12px; overflow: hidden; max-height: calc(100vh - 200px); overflow-y: auto; }
  .sb-email-row {
    display: grid; grid-template-columns: minmax(96px, 150px) 1fr auto; gap: 10px; align-items: center;
    width: 100%; text-align: left; background: none; border: none; cursor: pointer;
    padding: 12px 16px; font: inherit; border-bottom: 0.5px solid #f1efeb; position: relative;
  }
  .sb-email-row:hover { background: #faf8f4; }
  .sb-email-row-unread { background: #fffdf7; }
  .sb-email-unread-dot { position: absolute; left: 6px; top: 50%; transform: translateY(-50%); width: 6px; height: 6px; border-radius: 50%; background: #9A7209; }
  .sb-email-from { font-size: 13.5px; color: #222; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .sb-email-row-unread .sb-email-from, .sb-email-row-unread .sb-email-subject { font-weight: 700; }
  .sb-email-mid { min-width: 0; display: flex; gap: 8px; overflow: hidden; }
  .sb-email-subject { font-size: 13.5px; color: #222; flex-shrink: 0; max-width: 45%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .sb-email-snippet { font-size: 13px; color: #8a8a85; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .sb-email-date { font-size: 12px; color: #8a8a85; text-align: right; }

  .sb-email-modal-overlay { position: fixed; inset: 0; background: rgba(15,20,25,0.5); display: flex; align-items: center; justify-content: center; z-index: 1000; }
  .sb-email-reader { background: #fff; border-radius: 12px; width: min(720px, 94vw); max-height: 90vh; display: flex; flex-direction: column; box-shadow: 0 12px 48px rgba(0,0,0,0.2); }
  .sb-email-reader-head { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 18px 20px; border-bottom: 0.5px solid var(--sb-border, #e4e2dd); }
  .sb-email-reader-subject { font-size: 16px; font-weight: 600; color: #111; }
  .sb-email-reader-body { padding: 8px 20px; overflow-y: auto; flex: 1 1 auto; }
  .sb-email-msg { padding: 14px 0; border-bottom: 0.5px solid #f1efeb; }
  .sb-email-msg-meta { display: flex; gap: 8px; align-items: baseline; flex-wrap: wrap; margin-bottom: 8px; }
  .sb-email-msg-from { font-size: 13.5px; font-weight: 600; color: #222; }
  .sb-email-msg-addr { font-size: 12px; color: #8a8a85; }
  .sb-email-msg-date { font-size: 12px; color: #8a8a85; margin-left: auto; }
  .sb-email-msg-body { font-size: 13.5px; color: #333; white-space: pre-wrap; word-break: break-word; line-height: 1.5; }
  .sb-email-reader-foot { padding: 14px 20px; border-top: 0.5px solid var(--sb-border, #e4e2dd); display: flex; justify-content: flex-end; }

  .sb-email-composer { background: #fff; border-radius: 12px; padding: 22px; width: min(560px, 94vw); box-shadow: 0 12px 48px rgba(0,0,0,0.2); }
  .sb-email-composer-title { font-size: 16px; font-weight: 600; color: #111; margin-bottom: 14px; }
  .sb-email-field { display: flex; flex-direction: column; gap: 4px; margin-bottom: 12px; }
  .sb-email-field > span { font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: #8a8a85; font-weight: 600; }
  .sb-email-input { width: 100%; box-sizing: border-box; font: inherit; font-size: 13.5px; padding: 9px 12px; border-radius: 8px; border: 0.5px solid var(--sb-border, #d8d6d1); resize: vertical; }
  .sb-email-input:focus-visible { outline: 2px solid #9A7209; outline-offset: 1px; }
  .sb-email-composer-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 6px; }
  .sb-email-ok { font-size: 13px; color: #1f7a3d; background: rgba(31,122,61,0.07); border: 0.5px solid rgba(31,122,61,0.3); border-radius: 8px; padding: 10px 12px; margin-bottom: 14px; }
`
