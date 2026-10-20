// =============================================================================
// Payments › Collect balances (COLLECT-1, 2026-10-20)
// =============================================================================
// Paul: "another tab inside payments next to zelle reconcile for collecting
// balances from stones that are on an assembly line or on an installation
// list, or a bronze that was delivered. THIS IS CRITICAL. Very clear,
// sortable, priority being installation. A button that will preview an email
// requesting a balance — our Zelle, mail or deliver a check, cash, credit or
// debit (2%) — preview, adjust senders, add attachments. Say the stone is on
// the production line and we want to schedule it for delivery, however the
// balance must be paid in full first. A Call button that updates last
// contact; last contacted for payment X days ago; a notes section. How much is
// owed on the blasting queue and the delivery queue so we can target it."
//
// The queues are READ off the shop's own truths (install list, floor lines,
// bronze_received) — see lib/collections.js. The only thing this tab writes
// is balance_collection_log (calls, emails, notes).
// =============================================================================
import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import {
  fmtUSD, fmtDate, fmtPhone, properName, customerName,
  rowBalanceDue, rowGrandTotal, rowTotalPaid,
  sendShopEmail, getEmailSenders, listOrderAttachments, todayISO,
} from '../lib/stonebooksData'
import {
  STAGES, stageDef, listCollectionLog, addCollectionLog, setPromiseToPay,
  lastContactOf, lastNoteOf, activePromiseOf, promiseMissed, daysAgo,
} from '../lib/collections'
import ConfirmSend from './ConfirmSend'
import { phaseLabel } from '../lib/jobComponents'

const SHOP = {
  name: 'Shevchenko Monuments',
  address: '329 S Florida Grove Rd, Perth Amboy, NJ 08861',
  phone: '(732) 442-1286',
  zelle: 'shevcoteam@gmail.com',
  cardFeePct: 2,
}
const TOUCH_DAYS = 14   // "needs a touch" = never contacted or older than this

// Round 3 (Paul): no Priority / Balance owed / Family / Oldest chips — the
// list is ordered by balance unless one of these is picked, and the direction
// toggle (high to low / low to high) flips whichever ordering is active.
const SORTS = [
  { code: 'contact',   label: 'Since last contact' },
  { code: 'scheduled', label: 'Install date' },
  { code: 'promise',   label: 'Promise date' },
  { code: 'cemetery',  label: 'By cemetery' },
]

const addDaysISO = (iso, n) => { const d = new Date(`${iso}T00:00:00`); d.setDate(d.getDate() + n); return todayISO(d) }
const familyOf = (o) => {
  const last = (o.primary_lastname || '').trim()
  if (last) return properName(last)
  const cn = customerName(o.customer)
  return cn && cn !== '—' ? properName(cn) : (o.order_number || 'Unknown')
}
const serviceTag = (o) => {
  const s = Array.isArray(o.service_types) ? o.service_types : []
  if (s.includes('BRONZE') || s.includes('BRONZE_MARKER')) return 'BRONZE'
  if (s.includes('NEW_STONE')) return 'NEW STONE'
  if (s.includes('INSCRIPTION')) return 'INSCRIPTION'
  return s[0] ? s[0].replace(/_/g, ' ') : ''
}
const stageSentence = (row) => {
  const cem = row.cemetery ? ` at ${row.cemetery}` : ''
  if (row.stage === 'delivery') {
    if (row.bronze) return 'has arrived at our shop'
    if (row.detail === 'blasted') return `has been blasted and is ready to be set${cem}`
    return `is finished and ready to be installed${cem}`
  }
  return 'is on our production line and headed to blasting'
}

// ── The email text, Paul's message polished ─────────────────────────────────
function buildBalanceRequest(row, { sender = null } = {}) {
  const first = (row.order.customer?.first_name || '').trim()
  const fam = row.name
  const subject = `Balance due before delivery — ${fam} memorial${row.order.order_number ? ` (${row.order.order_number})` : ''}`
  const lines = [
    `Dear ${first || 'Family'},`,
    '',
    `Good news: the memorial for ${fam} ${stageSentence(row)}. We would like to schedule its delivery and installation${row.cemetery && row.stage !== 'delivery' ? ` at ${row.cemetery}` : ''}.`,
    '',
    'Before we can deliver, the remaining balance must be paid in full. Once we receive it, we will call you right away to set the installation date.',
    '',
    `Contract total: ${fmtUSD(row.total)}`,
    `Paid to date: ${fmtUSD(row.paid)}`,
    `Balance due: ${fmtUSD(row.balance)}`,
    '',
    'Ways to pay:',
    `- Zelle: send to ${SHOP.zelle} (please put "${fam}" in the memo)`,
    `- Check: mail or drop off to ${SHOP.name}, ${SHOP.address}`,
    '- Cash: in person at our office',
    `- Credit or debit card: in person or over the phone at ${SHOP.phone} (a ${SHOP.cardFeePct}% processing fee applies)`,
    '',
    `If you have already sent this payment, thank you — please disregard this note. Reply to this email or call us at ${SHOP.phone} with any questions.`,
    '',
    "Thank you for trusting us with your family's memorial.",
  ]
  if (sender?.name) {
    lines.push('', `${sender.name}${sender.title ? `, ${sender.title}` : ''}`)
  }
  return { subject, text: lines.join('\n') }
}

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
// Plain text → tidy HTML: blank lines = paragraphs, "- " lines = a list,
// "Label: $x" money lines bold the label.
function balanceTextToHtml(text) {
  const blocks = String(text || '').split(/\n\s*\n/)
  const html = blocks.map(b => {
    const ls = b.split('\n')
    if (ls.every(l => /^- /.test(l))) return `<ul style="margin:0 0 0 18px;padding:0">${ls.map(l => `<li style="margin:3px 0">${esc(l.slice(2))}</li>`).join('')}</ul>`
    return `<p style="margin:0 0 12px">${ls.map(l => {
      const m = l.match(/^(Contract total|Paid to date|Balance due):\s*(.*)$/)
      if (m) return `<strong>${esc(m[1])}:</strong> ${m[1] === 'Balance due' ? `<strong style="color:#B3261E">${esc(m[2])}</strong>` : esc(m[2])}`
      return esc(l)
    }).join('<br>')}</p>`
  }).join('')
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1c1c1c;line-height:1.55">${html}</div>`
}

// ── The view ────────────────────────────────────────────────────────────────
// `queues` = Map(order_id → queue entry) from getCollectionQueues — the parent
// (PaymentsTab) loads it once so the view tab's badge and this list agree.
export default function CollectBalancesView({ orders, queues, loading, onOpenOrder, onRefreshQueues }) {
  const [log, setLog] = useState(() => new Map())  // Map(order_id → rows desc)
  const [nowMs, setNowMs] = useState(() => Date.now())
  const [today, setToday] = useState(() => todayISO())
  const [promiseDraft, setPromiseDraft] = useState({})   // order id → { date, note }
  const [sort, setSort] = useState(null)              // null = by balance
  const [dir, setDir] = useState('desc')              // 'desc' high to low · 'asc' low to high
  const [stageF, setStageF] = useState(() => new Set())   // queue tiles — multi-select, empty = all
  const [q, setQ] = useState('')
  const [touchOnly, setTouchOnly] = useState(false)
  const [open, setOpen] = useState(() => new Set())   // rows with the notes panel open
  const [drafts, setDrafts] = useState({})            // order id → note draft
  const [busyId, setBusyId] = useState(null)
  const [emailFor, setEmailFor] = useState(null)
  const [toast, setToast] = useState(null)
  const toastTimer = useRef(null)
  const say = (t) => { if (toastTimer.current) clearTimeout(toastTimer.current); setToast(t); toastTimer.current = setTimeout(() => setToast(null), 3200) }

  // The rows: every order in a queue that still owes money.
  const rows = useMemo(() => {
    if (!orders || !queues) return []
    const out = []
    for (const o of orders) {
      const e = queues.get(o.id)
      if (!e) continue
      if (['closed', 'cancelled'].includes(o.status)) continue
      const balance = rowBalanceDue(o)
      if (balance <= 0) continue
      const entries = log.get(o.id) || []
      const lc = lastContactOf(entries)
      const promise = activePromiseOf(entries)
      out.push({
        id: o.id, order: o, name: familyOf(o),
        cemetery: o.cemetery?.name ? properName(o.cemetery.name) : '',
        service: serviceTag(o),
        stage: e.stage, stages: e.stages, line: e.line, phase: e.phase, detail: e.detail, bronze: !!e.bronze, scheduledDate: e.scheduledDate,
        balance, total: rowGrandTotal(o), paid: rowTotalPaid(o),
        email: (o.customer?.email || '').trim(), phone: o.customer?.phone_primary || '',
        log: entries, lastContact: lc, lastNote: lastNoteOf(entries),
        promise, promiseMissed: promiseMissed(promise, today),
        days: lc ? daysAgo(lc.created_at, nowMs) : null,
        signedMs: o.signed_at ? new Date(o.signed_at).getTime() : (o.created_at ? new Date(o.created_at).getTime() : 0),
      })
    }
    return out
  }, [orders, queues, log, nowMs, today])

  const ids = useMemo(() => rows.map(r => r.id).join(','), [rows])
  const loadLog = useCallback(async () => {
    if (!ids) return
    const m = await listCollectionLog(ids.split(',')).catch(() => new Map())
    setLog(m); setNowMs(Date.now()); setToday(todayISO())
  }, [ids])
  useEffect(() => { loadLog() }, [loadLog])   // eslint-disable-line react-hooks/set-state-in-effect

  // Money by stage — an order counts under EVERY stage it sits in (an
  // install-list stone that is also on a line shows in both), the total once.
  const totals = useMemo(() => {
    const by = {}
    for (const s of STAGES) by[s.code] = { owed: 0, n: 0 }
    let owed = 0
    for (const r of rows) {
      owed += r.balance
      for (const s of r.stages) if (by[s]) { by[s].owed += r.balance; by[s].n += 1 }
    }
    return { by, owed, n: rows.length }
  }, [rows])

  const shown = useMemo(() => {
    const norm = q.trim().toLowerCase()
    let list = rows.filter(r => {
      if (stageF.size > 0 && ![...stageF].some(s => r.stages.has(s))) return false
      if (touchOnly && !r.promiseMissed && r.days != null && r.days < TOUCH_DAYS) return false
      if (norm) {
        const hay = `${r.name} ${r.order.order_number || ''} ${r.cemetery} ${customerName(r.order.customer) || ''}`.toLowerCase()
        if (!hay.includes(norm)) return false
      }
      return true
    })
    // Rows with no value for the picked key always sit last; the direction
    // toggle flips the rest. "High to low" on a date = latest first; on
    // contact = longest ago first (never-contacted counts as longest).
    const flip = dir === 'asc' ? -1 : 1
    const sched = (r) => r.scheduledDate ? new Date(r.scheduledDate + 'T00:00:00').getTime() : null
    const contactKey = (r) => r.lastContact ? (nowMs - new Date(r.lastContact.created_at).getTime()) : Number.MAX_SAFE_INTEGER
    const promiseKey = (r) => r.promise ? new Date(r.promise.promised_for + 'T00:00:00').getTime() : null
    const byBalance = (a, b) => flip * (b.balance - a.balance)
    const numeric = (key, { nullsLast = true } = {}) => (a, b) => {
      const ka = key(a), kb = key(b)
      if (ka == null && kb == null) return byBalance(a, b)
      if (ka == null) return nullsLast ? 1 : -1
      if (kb == null) return nullsLast ? -1 : 1
      return flip * (kb - ka) || byBalance(a, b)
    }
    const cmp = {
      contact:   numeric(contactKey),
      scheduled: numeric(sched),
      promise:   numeric(promiseKey),
      cemetery:  (a, b) => flip * (a.cemetery || 'zzz').localeCompare(b.cemetery || 'zzz') || a.name.localeCompare(b.name),
    }[sort] || byBalance
    list = [...list].sort(cmp)
    return list
  }, [rows, q, stageF, touchOnly, sort, dir, nowMs])

  const touchCount = useMemo(() => rows.filter(r => r.promiseMissed || r.days == null || r.days >= TOUCH_DAYS).length, [rows])

  // ── actions ───────────────────────────────────────────────────────────────
  const logCall = async (r) => {
    if (busyId) return
    setBusyId(r.id)
    const res = await addCollectionLog({ orderId: r.id, kind: 'call', amount: r.balance })
    setBusyId(null)
    if (!res.ok) { say(res.error || 'Could not log the call.'); return }
    setOpen(s => new Set(s).add(r.id))
    setDrafts(d => ({ ...d, [r.id]: d[r.id] || '' }))
    say(`Call logged for ${r.name} — add a note on what was said.`)
    loadLog()
  }
  const saveNote = async (r) => {
    const text = (drafts[r.id] || '').trim()
    if (!text || busyId) return
    setBusyId(r.id)
    const res = await addCollectionLog({ orderId: r.id, kind: 'note', note: text })
    setBusyId(null)
    if (!res.ok) { say(res.error || 'Could not save the note.'); return }
    setDrafts(d => ({ ...d, [r.id]: '' }))
    loadLog()
  }
  const toggleOpen = (id) => setOpen(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  // Promise to pay: the panel's strip. Default date = a week out; a standing
  // promise seeds its own date so "Update" starts from what they said.
  const draftFor = (r) => promiseDraft[r.id] || { date: r.promise?.promised_for || addDaysISO(today, 7), note: '' }
  const openPromise = (r) => {
    setOpen(s => new Set(s).add(r.id))
    setPromiseDraft(d => ({ ...d, [r.id]: draftFor(r) }))
  }
  const savePromise = async (r) => {
    const pd = draftFor(r)
    if (!pd.date || busyId) return
    setBusyId(r.id)
    const res = await setPromiseToPay({ orderId: r.id, family: r.name, orderNumber: r.order.order_number, balance: r.balance, promisedFor: pd.date, note: pd.note })
    setBusyId(null)
    if (!res.ok) { say(res.error || 'Could not save the promise.'); return }
    setPromiseDraft(d => ({ ...d, [r.id]: { date: pd.date, note: '' } }))
    say(`${r.name} promised ${fmtUSD(r.balance)} by ${fmtDate(pd.date)} — reminder task set for that day.`)
    loadLog()
  }

  const contactText = (r) => {
    if (!r.lastContact) return null
    const k = r.lastContact.kind
    const verb = k === 'call' ? 'Called' : k === 'email' ? 'Emailed' : 'Texted'
    const d = r.days
    const when = d === 0 ? 'today' : d === 1 ? 'yesterday' : `${d} days ago`
    return `${verb} ${when}${r.lastContact.actor ? ` · ${r.lastContact.actor}` : ''}`
  }
  const contactTone = (r) => r.days == null ? 'never' : r.days >= TOUCH_DAYS ? 'stale' : r.days >= 7 ? 'warm' : 'fresh'

  const isLoading = loading || queues === null

  return (
    <div className="sb-col">
      <style>{COLLECT_CSS}</style>
      {toast && <div className="sb-col-toast">{toast}</div>}

      {/* The money to target */}
      <div className="sb-col-tiles">
        <button type="button" className={`sb-col-tile sb-col-tile-total${stageF.size === 0 ? ' on' : ''}`} onClick={() => setStageF(new Set())} title="Show both queues">
          <span className="sb-col-tile-label">In reach</span>
          <span className="sb-col-tile-amt">{fmtUSD(totals.owed)}</span>
          <span className="sb-col-tile-sub">{totals.n} order{totals.n === 1 ? '' : 's'} with work done or nearly done</span>
        </button>
        {STAGES.map(s => {
          const t = totals.by[s.code]
          const on = stageF.has(s.code)
          return (
            <button key={s.code} type="button" className={`sb-col-tile sb-col-tile-${s.tone}${on ? ' on' : ''}`}
              title={on ? 'Click to drop this queue from the list' : 'Click to show this queue — pick both to see both'}
              onClick={() => setStageF(f => { const n = new Set(f); if (n.has(s.code)) n.delete(s.code); else n.add(s.code); return n })}>
              <span className="sb-col-tile-label">{s.label}</span>
              <span className="sb-col-tile-amt">{fmtUSD(t.owed)}</span>
              <span className="sb-col-tile-sub">{t.n} order{t.n === 1 ? '' : 's'} · {s.sub}</span>
            </button>
          )
        })}
      </div>

      {/* Controls */}
      <div className="sb-col-controls">
        <div className="sb-col-sorts" role="tablist" aria-label="Sort">
          <span className="sb-col-sortlab">Sort</span>
          <button type="button" className={`sb-col-chip${sort === null ? ' on' : ''}`} onClick={() => setSort(null)} title="Order by the balance owed">Balance</button>
          {SORTS.map(s => (
            <button key={s.code} type="button" className={`sb-col-chip${sort === s.code ? ' on' : ''}`} onClick={() => setSort(sort === s.code ? null : s.code)}>{s.label}</button>
          ))}
          <button type="button" className="sb-col-chip sb-col-dir" onClick={() => setDir(d => (d === 'desc' ? 'asc' : 'desc'))}
            title="Flip the order">
            {dir === 'desc' ? 'High to low' : 'Low to high'}
          </button>
        </div>
        <div className="sb-col-filters">
          <button type="button" className={`sb-col-chip sb-col-chip-touch${touchOnly ? ' on' : ''}`} onClick={() => setTouchOnly(v => !v)}
            title={`Never contacted, or last contacted ${TOUCH_DAYS}+ days ago`}>
            Needs a touch <b>{touchCount}</b>
          </button>
          <input type="search" className="sb-pay-input sb-col-search" placeholder="Search family, order #, cemetery…" value={q} onChange={e => setQ(e.target.value)} />
          <button type="button" className="sb-col-chip" onClick={() => { onRefreshQueues?.(); loadLog() }}>Refresh</button>
        </div>
      </div>

      {/* The list */}
      <div className="sb-pay-table sb-col-table">
        <div className="sb-col-head">
          <span>Family · order · cemetery</span>
          <span>Where it sits</span>
          <span className="r">Balance owed</span>
          <span>Last contact for payment</span>
          <span>Latest note</span>
          <span />
        </div>
        {isLoading && <div className="sb-pay-empty">Loading the queues…</div>}
        {!isLoading && shown.length === 0 && (
          <div className="sb-pay-empty">{rows.length === 0 ? 'Nothing owed on the install list, the lines, or arrived bronze — every stone in reach is paid.' : 'No orders match.'}</div>
        )}
        {!isLoading && shown.map(r => {
          const isOpen = open.has(r.id)
          const tone = contactTone(r)
          return (
            <div key={r.id} className={`sb-col-row${isOpen ? ' open' : ''}`}>
              <div className="sb-col-grid">
                <div className="sb-col-who">
                  <button type="button" className="sb-col-name" onClick={() => onOpenOrder?.(r.id)} title="Open the order">{r.name}</button>
                  <div className="sb-col-meta">
                    {r.order.order_number && <span className="sb-pay-mono">{r.order.order_number}</span>}
                    {r.service && <span className="sb-col-svc">{r.service}</span>}
                    {r.cemetery && <span className="sb-col-cem">{r.cemetery}</span>}
                  </div>
                  <div className="sb-col-contact">
                    {r.phone ? <a className="sb-col-tel" href={`tel:${r.phone}`}>{fmtPhone(r.phone)}</a> : <span className="sb-col-none">no phone</span>}
                    {r.email ? <span className="sb-col-email" title={r.email}>{r.email}</span> : <span className="sb-col-none">no email</span>}
                  </div>
                </div>
                <div className="sb-col-stage">
                  {[...r.stages].sort((a, b) => (stageDef(a)?.rank ?? 9) - (stageDef(b)?.rank ?? 9)).map(code => {
                    const d = stageDef(code)
                    return <span key={code} className={`sb-col-pill sb-col-pill-${d?.tone || 'grey'}${code === r.stage ? ' main' : ''}`}>{d?.short || code}</span>
                  })}
                  {r.scheduledDate && <span className="sb-col-sched">Install {fmtDate(r.scheduledDate)}</span>}
                  {r.stages.has('delivery') && r.detail && r.detail !== 'install list' && <span className="sb-col-line">{r.detail}</span>}
                  {r.stages.has('blast') && r.line && <span className="sb-col-line">{r.line}{r.phase ? ` · ${phaseLabel(r.phase)}` : ''}</span>}
                </div>
                <div className="sb-col-money">
                  <span className="sb-col-bal">{fmtUSD(r.balance)}</span>
                  <span className="sb-col-sub">{fmtUSD(r.total)} contract · {fmtUSD(r.paid)} paid</span>
                  {r.promise && (
                    <span className={`sb-col-promise${r.promiseMissed ? ' missed' : ''}`} title={r.promise.note || ''}>
                      {r.promiseMissed ? 'Promise missed' : 'Promised by'} {fmtDate(r.promise.promised_for)}
                    </span>
                  )}
                </div>
                <div className={`sb-col-last sb-col-last-${tone}`}>
                  {r.lastContact ? (
                    <>
                      <span className="sb-col-last-main">{contactText(r)}</span>
                      <span className="sb-col-sub">{fmtDate(r.lastContact.created_at)}{r.lastContact.sent_to ? ` · ${r.lastContact.sent_to}` : ''}</span>
                    </>
                  ) : <span className="sb-col-last-main">Never contacted</span>}
                </div>
                <div className="sb-col-note">
                  {r.lastNote ? (
                    <>
                      <span className="sb-col-note-text">{r.lastNote.note}</span>
                      <span className="sb-col-sub">{fmtDate(r.lastNote.created_at)}{r.lastNote.actor ? ` · ${r.lastNote.actor}` : ''}</span>
                    </>
                  ) : <span className="sb-col-none">—</span>}
                </div>
                <div className="sb-col-actions">
                  <button type="button" className="sb-col-btn sb-col-btn-gold" onClick={() => setEmailFor(r)} title="Preview and send a balance request">Request balance</button>
                  <button type="button" className="sb-col-btn" disabled={busyId === r.id} onClick={() => logCall(r)} title="Log a call — updates last contact">Call</button>
                  <button type="button" className={`sb-col-btn${r.promiseMissed ? ' sb-col-btn-red' : ''}`} onClick={() => openPromise(r)} title="Record the date they promised to pay — a reminder task lands that day">Promise</button>
                  <button type="button" className={`sb-col-btn${isOpen ? ' on' : ''}`} onClick={() => toggleOpen(r.id)}>Notes{r.log.length ? ` ${r.log.length}` : ''}</button>
                </div>
              </div>
              {isOpen && (
                <div className="sb-col-panel">
                  {(() => {
                    const pd = draftFor(r)
                    return (
                      <div className="sb-col-promise-strip">
                        <span className="sb-col-promise-lab">Promise to pay</span>
                        {r.promise
                          ? <span className={`sb-col-promise${r.promiseMissed ? ' missed' : ''}`}>{r.promiseMissed ? 'Missed' : 'Promised'} · {fmtDate(r.promise.promised_for)}{r.promise.note ? ` — ${r.promise.note}` : ''}</span>
                          : <span className="sb-col-none">no promise on record</span>}
                        <input type="date" className="sb-pay-input sb-col-promise-date" value={pd.date} min={today}
                          onChange={e => setPromiseDraft(d => ({ ...d, [r.id]: { ...pd, date: e.target.value } }))} />
                        <input className="sb-pay-input sb-col-promise-note" placeholder="What they said (optional)" value={pd.note}
                          onChange={e => setPromiseDraft(d => ({ ...d, [r.id]: { ...pd, note: e.target.value } }))}
                          onKeyDown={e => { if (e.key === 'Enter') savePromise(r) }} />
                        <button type="button" className="sb-col-btn sb-col-btn-dark" disabled={busyId === r.id || !pd.date} onClick={() => savePromise(r)}>
                          {r.promise ? 'Update promise' : 'Save promise'}
                        </button>
                      </div>
                    )
                  })()}
                  <div className="sb-col-addnote">
                    <input className="sb-pay-input" value={drafts[r.id] || ''} placeholder="Add a note — what was said, what they promised, when to try again"
                      onChange={e => setDrafts(d => ({ ...d, [r.id]: e.target.value }))}
                      onKeyDown={e => { if (e.key === 'Enter') saveNote(r) }} />
                    <button type="button" className="sb-col-btn sb-col-btn-dark" disabled={busyId === r.id || !(drafts[r.id] || '').trim()} onClick={() => saveNote(r)}>Save note</button>
                  </div>
                  {r.log.length === 0 ? (
                    <div className="sb-col-none" style={{ padding: '6px 0' }}>No calls, emails, or notes yet.</div>
                  ) : (
                    <ul className="sb-col-log">
                      {r.log.map(e => (
                        <li key={e.id} className={`sb-col-log-${e.kind}`}>
                          <span className="sb-col-log-kind">{e.kind === 'call' ? 'CALL' : e.kind === 'email' ? 'EMAIL' : e.kind === 'text' ? 'TEXT' : e.kind === 'promise' ? 'PROMISE' : 'NOTE'}</span>
                          <span className="sb-col-log-body">
                            {e.kind === 'email' ? `Balance request sent${e.sent_to ? ` to ${e.sent_to}` : ''}${e.amount ? ` for ${fmtUSD(e.amount)}` : ''}`
                              : e.kind === 'call' ? `Called about the balance${e.amount ? ` (${fmtUSD(e.amount)} owed)` : ''}`
                              : e.kind === 'promise' ? `Promised ${e.amount ? `${fmtUSD(e.amount)} ` : ''}by ${e.promised_for ? fmtDate(e.promised_for) : '—'}` : ''}
                            {e.note ? (e.kind === 'note' ? e.note : ` — ${e.note}`) : ''}
                          </span>
                          <span className="sb-col-log-when">{fmtDate(e.created_at)}{e.actor ? ` · ${e.actor}` : ''}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {emailFor && (
        <BalanceRequestModal row={emailFor} onClose={() => setEmailFor(null)}
          onSent={(to) => { setEmailFor(null); say(`Balance request sent to ${to}.`); loadLog() }} />
      )}
    </div>
  )
}

// ── The balance request email ───────────────────────────────────────────────
// Preview before anything goes out (ConfirmSend — the send-safety doctrine).
// To can hold several addresses; the sender identity picks whose signature
// rides under the message; order files + uploads ride as attachments.
function BalanceRequestModal({ row, onClose, onSent }) {
  const [senders, setSenders] = useState([])
  const [senderId, setSenderId] = useState(() => { try { return localStorage.getItem('cc_sender') || '' } catch { return '' } })
  const [to, setTo] = useState(row.email || '')
  const [subject, setSubject] = useState(() => buildBalanceRequest(row).subject)
  const [body, setBody] = useState(() => buildBalanceRequest(row).text)
  const [bodyTouched, setBodyTouched] = useState(false)
  const [files, setFiles] = useState([])          // the order's files
  const [picked, setPicked] = useState(() => new Set())
  const [uploads, setUploads] = useState([])      // [{ filename, contentBase64, contentType }]
  const [gate, setGate] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const upRef = useRef(null)

  useEffect(() => {
    let alive = true
    getEmailSenders().then(list => { if (alive) setSenders(list || []) }).catch(() => {})
    listOrderAttachments(row.id).then(list => { if (alive) setFiles(list || []) }).catch(() => {})
    return () => { alive = false }
  }, [row.id])

  const sender = senders.find(s => s.id === senderId) || null
  // Re-seed the body when the sender changes, unless the operator already
  // edited it — their words win.
  useEffect(() => {
    if (bodyTouched) return
    setBody(buildBalanceRequest(row, { sender }).text)   // eslint-disable-line react-hooks/set-state-in-effect
  }, [sender, row, bodyTouched])

  const html = useMemo(() => balanceTextToHtml(body), [body])
  const toList = useMemo(() => to.split(/[,;\s]+/).map(s => s.trim()).filter(Boolean), [to])
  const toBad = toList.filter(e => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e))

  const attachmentNames = [
    ...files.filter(f => picked.has(f.name)).map(f => f.name),
    ...uploads.map(u => u.filename),
  ]

  const onUpload = async (fileList) => {
    const arr = [...(fileList || [])]
    for (const f of arr) {
      if (f.size > 8 * 1024 * 1024) { setErr(`${f.name} is over 8 MB — attach it from the order's files instead.`); continue }
      const b64 = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split('base64,')[1] || ''); r.onerror = rej; r.readAsDataURL(f) })
      setUploads(u => [...u, { filename: f.name, contentBase64: b64, contentType: f.type || 'application/octet-stream' }])
    }
  }

  const doSend = async (edited) => {
    setBusy(true); setErr(null)
    const useOwn = !!sender?.signature_text
    const text = edited?.text || body
    const finalText = useOwn ? `${text}\n\n-- \n${sender.signature_text}` : text
    const finalHtml = useOwn
      ? `${edited?.html || html}<br><br>-- <br><div style="font-size:13px;line-height:1.5;color:#555;font-family:Arial,sans-serif">${esc(sender.signature_text).replace(/\n/g, '<br>')}</div>`
      : (edited?.html || html)
    const attachments = [
      ...files.filter(f => picked.has(f.name)).map(f => ({ filename: f.name, url: f.url })),
      ...uploads,
    ]
    const res = await sendShopEmail({
      to: toList, subject: subject.trim(), html: finalHtml, text: finalText,
      attachments: attachments.length ? attachments : undefined,
      includeSignature: !useOwn,
      orderId: row.id, customerId: row.order.customer?.id || null,
    })
    setBusy(false)
    if (!res.ok) { setGate(false); setErr(res.error || 'Send failed.'); return }
    await addCollectionLog({ orderId: row.id, kind: 'email', note: subject.trim(), amount: row.balance, sentTo: toList.join(', ') }).catch(() => {})
    onSent(toList.join(', '))
  }

  return (
    <div className="sb-pay-backdrop" onClick={() => { if (!busy) onClose() }}>
      <div className="sb-pay-modal sb-col-modal" role="dialog" aria-modal="true" aria-label="Request the balance" onClick={e => e.stopPropagation()}>
        <h3 className="sb-pay-modal-title">Request the balance · {row.name}</h3>
        <div className="sb-col-modal-facts">
          <span><b>{fmtUSD(row.balance)}</b> owed</span>
          <span>{fmtUSD(row.total)} contract · {fmtUSD(row.paid)} paid</span>
          <span>{stageDef(row.stage)?.label}{row.cemetery ? ` · ${row.cemetery}` : ''}</span>
        </div>

        <div className="sb-col-modal-grid">
          <div className="sb-pay-field">
            <label>To — one or more emails, comma separated</label>
            <input className="sb-pay-input" value={to} onChange={e => setTo(e.target.value)} placeholder={row.email ? '' : 'No email on file — type one'} />
            {toBad.length > 0 && <div className="sb-pay-modal-err">Check: {toBad.join(', ')}</div>}
          </div>
          <div className="sb-pay-field">
            <label>Send as</label>
            <select className="sb-pay-input" value={senderId} onChange={e => { setSenderId(e.target.value); try { localStorage.setItem('cc_sender', e.target.value) } catch { /* ignore */ } }}>
              <option value="">Shop signature ({SHOP.name})</option>
              {senders.map(s => <option key={s.id} value={s.id}>{s.name}{s.title ? ` — ${s.title}` : ''}</option>)}
            </select>
          </div>
        </div>
        <div className="sb-pay-field">
          <label>Subject</label>
          <input className="sb-pay-input" value={subject} onChange={e => setSubject(e.target.value)} />
        </div>
        <div className="sb-pay-field">
          <label>Message — Zelle, mailing address, cash, and the {SHOP.cardFeePct}% card fee are already in it</label>
          <textarea className="sb-pay-input sb-col-body" rows={14} value={body} onChange={e => { setBody(e.target.value); setBodyTouched(true) }} />
          {bodyTouched && <button type="button" className="sb-col-linkbtn" onClick={() => { setBody(buildBalanceRequest(row, { sender }).text); setBodyTouched(false) }}>Reset to the standard message</button>}
        </div>

        <div className="sb-pay-field">
          <label>Attachments — optional</label>
          <div className="sb-col-files">
            {files.length === 0 && uploads.length === 0 && <span className="sb-col-none">No files on this order yet.</span>}
            {files.map(f => (
              <label key={f.name} className={`sb-col-file${picked.has(f.name) ? ' on' : ''}`}>
                <input type="checkbox" checked={picked.has(f.name)} onChange={() => setPicked(s => { const n = new Set(s); if (n.has(f.name)) n.delete(f.name); else n.add(f.name); return n })} />
                <span className="sb-col-file-name">{f.name}</span>
                {f.url && <a href={f.url} target="_blank" rel="noreferrer" className="sb-col-linkbtn" onClick={e => e.stopPropagation()}>view</a>}
              </label>
            ))}
            {uploads.map((u, i) => (
              <span key={`${u.filename}-${i}`} className="sb-col-file on">
                <span className="sb-col-file-name">{u.filename}</span>
                <button type="button" className="sb-col-linkbtn" onClick={() => setUploads(a => a.filter((_, j) => j !== i))}>remove</button>
              </span>
            ))}
            <button type="button" className="sb-col-btn" onClick={() => upRef.current?.click()}>+ Upload a file</button>
            <input ref={upRef} type="file" multiple style={{ display: 'none' }} onChange={e => { onUpload(e.target.files); e.target.value = '' }} />
          </div>
        </div>

        {err && <div className="sb-pay-modal-err">{err}</div>}
        <div className="sb-pay-modal-actions">
          <button type="button" className="sb-pay-cancel" disabled={busy} onClick={onClose}>Cancel</button>
          <button type="button" className="sb-pay-confirm" disabled={busy || toList.length === 0 || toBad.length > 0 || !subject.trim() || !body.trim()} onClick={() => setGate(true)}>
            Preview & send
          </button>
        </div>
      </div>
      <div onClick={e => e.stopPropagation()}>
        <ConfirmSend open={gate} to={toList.join(', ')} subject={subject.trim()} html={html} text={body}
          attachments={attachmentNames.length ? attachmentNames : null}
          busy={busy} onConfirm={doSend} onClose={() => setGate(false)} />
      </div>
    </div>
  )
}

const COLLECT_CSS = `
  .sb-col { position: relative; }
  .sb-col-toast { position: fixed; bottom: 22px; left: 50%; transform: translateX(-50%); background: #1e2d3d; color: #fff; font-size: 13px; font-weight: 600; padding: 10px 16px; border-radius: 999px; box-shadow: 0 8px 24px rgba(15,20,25,.28); z-index: 900; max-width: min(92vw, 560px); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .sb-col-tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; margin-bottom: 14px; }
  .sb-col-tile { display: flex; flex-direction: column; gap: 3px; min-width: 0; text-align: left; font: inherit; background: #fff; border: 0.5px solid #e6e3dd; border-radius: 12px; padding: 12px 14px; cursor: pointer; color: #1e2d3d; transition: border-color .12s, box-shadow .12s; }
  .sb-col-tile:hover { border-color: #9A7209; }
  .sb-col-tile.on { border-color: #9A7209; box-shadow: 0 0 0 2px rgba(154,114,9,.18); }
  .sb-col-tile-label { font-size: 10.5px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; color: #8a8a85; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .sb-col-tile-amt { font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 20px; font-weight: 700; color: #B3261E; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .sb-col-tile-sub { font-size: 11.5px; color: #6b6b66; overflow-wrap: anywhere; }
  .sb-col-tile-total { background: #1e2d3d; border-color: #1e2d3d; color: #fff; grid-column: span 2; }
  .sb-col-tile-total .sb-col-tile-label { color: #c9b27a; }
  .sb-col-tile-total .sb-col-tile-amt { color: #fff; font-size: 24px; }
  .sb-col-tile-total .sb-col-tile-sub { color: #c7cdd4; }
  .sb-col-tile-total.on { box-shadow: 0 0 0 2px rgba(201,178,122,.5); }
  .sb-col-tile-green.on { background: #f1f9f4; }
  .sb-col-tile-amber.on { background: #fbf3e4; }
  .sb-col-dir { border-color: #1e2d3d; color: #1e2d3d; font-weight: 700; }
  .sb-col-controls { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px 14px; margin-bottom: 10px; }
  .sb-col-sorts, .sb-col-filters { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; min-width: 0; }
  .sb-col-sortlab { font-size: 10.5px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; color: #8a8a85; margin-right: 2px; }
  .sb-col-chip { font: inherit; font-size: 12.5px; font-weight: 600; padding: 6px 12px; border-radius: 999px; border: 0.5px solid #e6e3dd; background: #fff; color: #55503F; cursor: pointer; white-space: nowrap; }
  .sb-col-chip:hover { border-color: #9A7209; }
  .sb-col-chip.on { background: #9A7209; border-color: #9A7209; color: #fff; }
  .sb-col-chip-touch b { font-family: 'JetBrains Mono', ui-monospace, monospace; font-weight: 800; margin-left: 4px; color: #B3261E; }
  .sb-col-chip-touch.on b { color: #fff; }
  .sb-col-search { max-width: 300px; padding: 7px 11px; font-size: 13px; }
  .sb-col-table { overflow-x: auto; }
  .sb-col-head, .sb-col-grid { display: grid; grid-template-columns: minmax(200px, 1.5fr) minmax(150px, 1fr) minmax(130px, .9fr) minmax(150px, 1fr) minmax(160px, 1.2fr) minmax(250px, auto); gap: 12px; align-items: start; padding: 12px 16px; min-width: 1040px; }
  .sb-col-head { font-size: 10.5px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; color: #8a8a85; background: #faf9f6; border-bottom: 0.5px solid #e6e3dd; padding-top: 9px; padding-bottom: 9px; }
  .sb-col-head .r { text-align: right; }
  .sb-col-row { border-bottom: 0.5px solid #f0ede7; }
  .sb-col-row:last-child { border-bottom: 0; }
  .sb-col-row.open { background: #fdfcf9; }
  .sb-col-grid > * { min-width: 0; }
  .sb-col-who { display: flex; flex-direction: column; gap: 3px; }
  .sb-col-name { font: inherit; font-size: 15px; font-weight: 700; color: #1e2d3d; background: none; border: none; padding: 0; cursor: pointer; text-align: left; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100%; }
  .sb-col-name:hover { color: #9A7209; text-decoration: underline; }
  .sb-col-meta { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; font-size: 12px; color: #6b6b66; }
  .sb-col-svc { font-size: 9.5px; font-weight: 800; letter-spacing: .06em; padding: 2px 6px; border-radius: 4px; background: #eef2f6; color: #1e2d3d; white-space: nowrap; }
  .sb-col-cem { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100%; }
  .sb-col-contact { display: flex; flex-wrap: wrap; gap: 8px; font-size: 12px; }
  .sb-col-tel { color: #1d4ed8; text-decoration: none; font-weight: 600; white-space: nowrap; }
  .sb-col-email { color: #6b6b66; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100%; }
  .sb-col-none { color: #a3a09a; font-style: italic; font-size: 12px; }
  .sb-col-stage { display: flex; flex-wrap: wrap; gap: 5px; align-items: center; }
  .sb-col-pill { font-size: 10px; font-weight: 800; letter-spacing: .06em; padding: 3px 8px; border-radius: 999px; border: 1px solid transparent; white-space: nowrap; opacity: .72; }
  .sb-col-pill.main { opacity: 1; }
  .sb-col-pill-green { background: #e6f4ec; color: #1f6b3d; border-color: #bfe0cb; }
  .sb-col-pill-amber { background: #fbf1d2; color: #7A5A00; border-color: #e9c46a; }
  .sb-col-pill-blue { background: #e4ecf7; color: #1d4ed8; border-color: #c2d2ec; }
  .sb-col-pill-grey { background: #f1efeb; color: #55503F; border-color: #e2dcce; }
  .sb-col-sched { font-size: 11.5px; font-weight: 700; color: #1f6b3d; white-space: nowrap; }
  .sb-col-line { font-size: 11px; color: #6b6b66; white-space: nowrap; }
  .sb-col-money { display: flex; flex-direction: column; align-items: flex-end; gap: 2px; text-align: right; }
  .sb-col-bal { font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 16px; font-weight: 700; color: #B3261E; white-space: nowrap; }
  .sb-col-sub { font-size: 11.5px; color: #8a8a85; overflow-wrap: anywhere; }
  .sb-col-last { display: flex; flex-direction: column; gap: 2px; }
  .sb-col-last-main { font-size: 13px; font-weight: 700; overflow-wrap: anywhere; }
  .sb-col-last-never .sb-col-last-main { color: #B3261E; }
  .sb-col-last-stale .sb-col-last-main { color: #B3261E; }
  .sb-col-last-warm .sb-col-last-main { color: #7A5A00; }
  .sb-col-last-fresh .sb-col-last-main { color: #1f6b3d; }
  .sb-col-note { display: flex; flex-direction: column; gap: 2px; }
  .sb-col-note-text { font-size: 13px; color: #1e2d3d; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere; }
  .sb-col-actions { display: flex; flex-wrap: wrap; gap: 6px; justify-content: flex-end; }
  .sb-col-btn { font: inherit; font-size: 12.5px; font-weight: 600; padding: 7px 12px; border-radius: 8px; border: 0.5px solid #e6e3dd; background: #fff; color: #1e2d3d; cursor: pointer; white-space: nowrap; }
  .sb-col-btn:hover:not(:disabled) { background: #f4f2ee; }
  .sb-col-btn:disabled { opacity: .5; cursor: default; }
  .sb-col-btn.on { background: #1e2d3d; border-color: #1e2d3d; color: #fff; }
  .sb-col-btn-gold { background: #9A7209; border-color: #9A7209; color: #fff; }
  .sb-col-btn-gold:hover:not(:disabled) { background: #876307; }
  .sb-col-btn-dark { background: #1e2d3d; border-color: #1e2d3d; color: #fff; }
  .sb-col-btn-red { color: #B3261E; border-color: #dda9a4; background: #fdf1f0; }
  .sb-col-promise { font-size: 11px; font-weight: 800; letter-spacing: .04em; text-transform: uppercase; color: #1f6b3d; background: #e6f4ec; border: 1px solid #bfe0cb; border-radius: 999px; padding: 2px 8px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
  .sb-col-promise.missed { color: #B3261E; background: #fdf1f0; border-color: #dda9a4; }
  .sb-col-promise-strip { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-bottom: 8px; padding: 8px 10px; border-radius: 8px; background: #fbf3e4; border: 0.5px solid #e9c46a; }
  .sb-col-promise-lab { font-size: 10.5px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; color: #7A5A00; white-space: nowrap; }
  .sb-col-promise-strip .sb-col-promise { text-transform: none; letter-spacing: 0; font-weight: 700; font-size: 12px; }
  .sb-col-promise-date { width: 160px; padding: 7px 10px; font-size: 13px; }
  .sb-col-promise-note { flex: 1; min-width: 180px; padding: 7px 10px; font-size: 13px; }
  .sb-col-log-promise .sb-col-log-kind { background: #e6f4ec; color: #1f6b3d; }
  .sb-col-panel { padding: 0 16px 14px 16px; }
  .sb-col-addnote { display: flex; gap: 8px; align-items: center; margin-bottom: 8px; }
  .sb-col-addnote .sb-pay-input { flex: 1; min-width: 0; padding: 8px 11px; font-size: 13px; }
  .sb-col-log { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
  .sb-col-log li { display: grid; grid-template-columns: 54px minmax(0, 1fr) auto; gap: 10px; align-items: baseline; font-size: 12.5px; padding: 5px 8px; border-radius: 6px; background: #fff; border: 0.5px solid #f0ede7; }
  .sb-col-log-kind { font-size: 9.5px; font-weight: 800; letter-spacing: .08em; padding: 2px 6px; border-radius: 4px; text-align: center; background: #f1efeb; color: #55503F; }
  .sb-col-log-call .sb-col-log-kind { background: #e4ecf7; color: #1d4ed8; }
  .sb-col-log-email .sb-col-log-kind { background: #fbf1d2; color: #7A5A00; }
  .sb-col-log-body { min-width: 0; overflow-wrap: anywhere; color: #1e2d3d; }
  .sb-col-log-when { font-size: 11px; color: #8a8a85; white-space: nowrap; }
  .sb-col-modal { max-width: 760px; }
  .sb-col-modal-facts { display: flex; flex-wrap: wrap; gap: 6px 16px; font-size: 13px; color: #55503F; margin: -8px 0 14px; }
  .sb-col-modal-facts b { font-family: 'JetBrains Mono', ui-monospace, monospace; color: #B3261E; }
  .sb-col-modal-grid { display: grid; grid-template-columns: minmax(0, 1.6fr) minmax(0, 1fr); gap: 0 12px; }
  @media (max-width: 640px) { .sb-col-modal-grid { grid-template-columns: 1fr; } }
  .sb-col-body { font-family: inherit; line-height: 1.5; resize: vertical; }
  .sb-col-linkbtn { font: inherit; font-size: 12px; color: #9A7209; background: none; border: none; padding: 0; cursor: pointer; text-decoration: underline; white-space: nowrap; }
  .sb-col-files { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
  .sb-col-file { display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; padding: 5px 9px; border-radius: 999px; border: 0.5px solid #e6e3dd; background: #fff; max-width: 100%; cursor: pointer; }
  .sb-col-file.on { border-color: #9A7209; background: #fbf3e4; }
  .sb-col-file-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 260px; }
`
