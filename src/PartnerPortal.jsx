// =============================================================================
// 📚 Stonebooks — External Partner Portal (PHASE 3)
// =============================================================================
// The surface an OUTSIDE company sees after logging in. RLS scopes every query
// to this partner's rows (one partner can never see another's data), so these
// views need no explicit partner filter — isolation is enforced server-side.
//
// Partner can: submit a new request (same createVendorRequest as staff, with
// source='partner'), view their jobs by stage, upload additional files, and
// comment. Partners CANNOT change status or edit submitted line items — staff
// own the work lifecycle. POs are view-only.
// =============================================================================

import { useState, useEffect, useCallback } from 'react'
import { signOut } from './lib/auth'
import {
  listVendorItems, createVendorRequest, uploadVendorFile, listVendorAttachments,
  vendorFileSignedUrl, addVendorEvent, listVendorEvents, listVendorPOs,
  listTradeInvoices, listTradeOrders,
  TRADE_NOTIFY_PREFS, updatePartnerNotificationPrefs,
  getPartnerTeamNames, updatePartnerTeamNames,
  submitTradeIssue, listTradeIssues,
} from './lib/vendorsData'
import VendorItemCard, { VENDOR_ITEM_CARD_CSS } from './components/VendorItemCard'
import TradeOrderBoard from './components/TradeOrderBoard'
import { fmtDate } from './lib/stonebooksData'

const PARTNER_STATUS = {
  submitted: 'Submitted', waiting_on_info: 'Waiting on info', ready_to_work: 'Received',
  in_progress: 'In progress', design_uploaded: 'Design ready', ready_for_pickup: 'Ready for pickup',
  completed: 'Completed', cancelled: 'Cancelled',
}
const STATUS_TONE = {
  submitted: { bg: '#eef2f7', bd: '#c9d4e0', fg: '#3a526b' },
  waiting_on_info: { bg: '#fbeee0', bd: '#e6c79a', fg: '#8a5a1a' },
  ready_to_work: { bg: '#eef2f7', bd: '#c9d4e0', fg: '#3a526b' },
  in_progress: { bg: '#fdf8ec', bd: '#e8d9a8', fg: '#8a6d12' },
  design_uploaded: { bg: '#ecf3ff', bd: '#b9cef0', fg: '#2b5cb0' },
  ready_for_pickup: { bg: '#e8f5ee', bd: '#7ac4a0', fg: '#1f6b46' },
  completed: { bg: '#eef0ee', bd: '#cdd4cd', fg: '#52605a' },
  cancelled: { bg: '#f4f2ee', bd: '#ddd9d2', fg: '#9a9a92' },
}
const OPEN_STATUSES = ['submitted', 'waiting_on_info', 'ready_to_work', 'in_progress', 'design_uploaded']

// One stone per order (Paul, 2026-07-08) — the form carries a single item card.
const blankItem = (workType = 'design') => ({
  workType, vendorReference: '', stoneSize: '', baseSize: '', color: '',
  cemetery: '', deceasedFamilyName: '', itemNotes: '', location: '', notesAlign: 'left', _files: [], _key: 0,
})

function PartnerStatusChip({ status }) {
  const t = STATUS_TONE[status] || STATUS_TONE.submitted
  return <span className="vp-chip" style={{ background: t.bg, borderColor: t.bd, color: t.fg }}>{PARTNER_STATUS[status] || status}</span>
}

export default function PartnerPortal({ context, onSignOut, viewAs = false }) {
  const partner = context?.partner
  const partnerId = context?.partnerId
  // Email deep link: ?trade=<orderId> lands the dealer straight on that order,
  // expanded on the board — no hunting.
  const [deepTradeId] = useState(() => {
    try { return new URLSearchParams(window.location.search).get('trade') } catch { return null }
  })
  const [deepPayments] = useState(() => {
    try { return !!new URLSearchParams(window.location.search).get('payments') } catch { return false }
  })
  const [view, setView] = useState(deepTradeId ? 'orders' : deepPayments ? 'payments' : 'home')
  const [items, setItems] = useState([])
  const [pos, setPos] = useState([])
  const [loading, setLoading] = useState(true)
  const [openItem, setOpenItem] = useState(null)
  const [toast, setToast] = useState(null)

  const flash = (m) => { setToast(m); setTimeout(() => setToast(null), 2600) }

  const loadAll = useCallback(() => {
    return Promise.all([listVendorItems(), listVendorPOs()]).then(([it, p]) => {
      setItems(it); setPos(p)
    })
  }, [])

  useEffect(() => {
    let cancelled = false
    Promise.all([listVendorItems(), listVendorPOs()])
      .then(([it, p]) => { if (!cancelled) { setItems(it); setPos(p); setLoading(false) } })
      .catch(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  // Partner sessions are RLS-scoped already; the explicit partner filter makes
  // staff "View as" render exactly what the dealer sees (staff RLS is a
  // superset and would otherwise show every company's rows).
  const scoped = partnerId ? items.filter(i => i.request?.partner_id === partnerId) : items
  const scopedPos = partnerId ? pos.filter(po => po.partner_id === partnerId) : pos
  const openJobs = scoped.filter(i => OPEN_STATUSES.includes(i.status))
  const ready = scoped.filter(i => i.status === 'ready_for_pickup')
  const completed = scoped.filter(i => i.status === 'completed')

  const handleSignOut = async () => {
    await signOut()
    onSignOut?.()
  }

  return (
    <div className="vp-shell">
      <style>{VENDOR_ITEM_CARD_CSS}</style>
      <style>{VP_CSS}</style>

      <header className="vp-header">
        <div className="vp-brand">
          <div className="vp-brand-mark">stonebooks <span>· Trade</span></div>
          <div className="vp-brand-sub">Shevchenko Monuments{partner?.company_name ? ` · ${partner.company_name}` : ''}</div>
        </div>
        <button type="button" className="vp-signout" onClick={handleSignOut}>{viewAs ? 'Exit' : 'Sign out'}</button>
      </header>

      <nav className="vp-nav">
        {[
          { code: 'home', label: 'Home' },
          { code: 'orders', label: 'Orders' },
          { code: 'new', label: '+ New Request' },
          { code: 'open', label: `Open Jobs${openJobs.length ? ` (${openJobs.length})` : ''}` },
          { code: 'ready', label: `Ready for Pickup${ready.length ? ` (${ready.length})` : ''}` },
          { code: 'completed', label: 'Completed' },
          { code: 'payments', label: 'Payments' },
          { code: 'fix', label: 'Fix' },
          { code: 'reports', label: 'Reports' },
          { code: 'settings', label: 'Settings' },
          { code: 'pos', label: 'POs' },
        ].map(t => (
          <button key={t.code} type="button" className={`vp-nav-btn ${view === t.code ? 'on' : ''}`} onClick={() => setView(t.code)}>{t.label}</button>
        ))}
      </nav>

      <main className="vp-main">
        {loading ? <div className="vp-empty">Loading…</div> : (
          <>
            {view === 'home' && (
              <PortalHome partner={partner} openJobs={openJobs} ready={ready} completed={completed} onNew={() => setView('new')} onGo={setView} onOpenItem={setOpenItem} />
            )}
            {view === 'orders' && (
              /* Stonebooks Trade order board — the whiteboard columns, dealer side.
                 RLS scopes queries to this partner; partnerId narrows explicitly. */
              <TradeOrderBoard partnerId={partnerId} actorName={partner?.contact_person || partner?.company_name || 'Dealer'}
                onNewOrder={() => setView('new')} initialExpandId={deepTradeId} />
            )}
            {view === 'new' && (
              <NewRequestForm partnerId={partnerId} partner={partner} onDone={async () => { await loadAll(); setView('open'); flash('Request submitted — thank you.') }} />
            )}
            {view === 'open' && <ItemList title="Open Jobs" empty="No open jobs right now." items={openJobs} onOpenItem={setOpenItem} />}
            {view === 'ready' && <ItemList title="Ready for Pickup" empty="Nothing ready for pickup yet." items={ready} onOpenItem={setOpenItem} />}
            {view === 'completed' && <ItemList title="Completed" empty="No completed jobs yet." items={completed} onOpenItem={setOpenItem} />}
            {view === 'payments' && <PartnerPayments partnerId={partnerId} />}
            {view === 'fix' && <PartnerFix partnerId={partnerId} partner={partner} />}
            {view === 'reports' && <PartnerReports partnerId={partnerId} />}
            {view === 'settings' && <PartnerSettings partner={partner} />}
            {view === 'pos' && <POList pos={scopedPos} />}
          </>
        )}
      </main>

      {openItem && <PartnerItemDetail item={openItem} partnerId={partnerId} onClose={() => setOpenItem(null)} onChanged={loadAll} flash={flash} />}
      {toast && <div className="vp-toast">{toast}</div>}
    </div>
  )
}

function PortalHome({ partner, openJobs, ready, completed, onNew, onGo, onOpenItem }) {
  const recent = [...openJobs, ...ready].slice(0, 6)
  return (
    <div className="vp-home">
      <div className="vp-hero">
        <div>
          <div className="vp-hero-h">Welcome{partner?.contact_person ? `, ${partner.contact_person}` : ''}</div>
          <div className="vp-hero-sub">Place orders, watch them move through the shop live, and pick up on time.
            <b style={{ color: '#9A7209' }}> Work placed through the portal is guaranteed.</b></div>
        </div>
        <button type="button" className="vp-primary vp-hero-cta" onClick={onNew}>+ New Request</button>
      </div>
      <div className="vp-stats">
        <button type="button" className="vp-stat" onClick={() => onGo('open')}><div className="vp-stat-n">{openJobs.length}</div><div className="vp-stat-l">Open jobs</div></button>
        <button type="button" className="vp-stat" onClick={() => onGo('ready')}><div className="vp-stat-n" style={{ color: '#1f6b46' }}>{ready.length}</div><div className="vp-stat-l">Ready for pickup</div></button>
        <button type="button" className="vp-stat" onClick={() => onGo('completed')}><div className="vp-stat-n">{completed.length}</div><div className="vp-stat-l">Completed</div></button>
      </div>
      {recent.length > 0 && (
        <div className="vp-section">
          <div className="vp-section-h">Active work</div>
          <div className="vp-cards">{recent.map(it => <ItemCard key={it.id} item={it} onOpen={() => onOpenItem(it)} />)}</div>
        </div>
      )}
    </div>
  )
}

function ItemList({ title, empty, items, onOpenItem }) {
  return (
    <div className="vp-section">
      <div className="vp-section-h">{title}</div>
      {items.length === 0 ? <div className="vp-empty">{empty}</div>
        : <div className="vp-cards">{items.map(it => <ItemCard key={it.id} item={it} onOpen={() => onOpenItem(it)} />)}</div>}
    </div>
  )
}

function ItemCard({ item, onOpen }) {
  const wt = item.work_type ? item.work_type[0].toUpperCase() + item.work_type.slice(1) : 'Item'
  return (
    <button type="button" className="vp-card" onClick={onOpen}>
      <div className="vp-card-top">
        <span className="vp-card-type">{wt}</span>
        <PartnerStatusChip status={item.status} />
      </div>
      <div className="vp-card-ref">{item.vendor_reference || item.deceased_family_name || '—'}</div>
      <div className="vp-card-meta">
        {item.stone_size && <span>{item.stone_size}</span>}
        {item.color && <span>{item.color}</span>}
        {item.cemetery && <span>{item.cemetery}</span>}
      </div>
      {item.item_notes && <div className="vp-card-notes">{item.item_notes}</div>}
    </button>
  )
}

// Trade service chips — mirrors TRADE_SERVICES in vendorsData (kept inline so
// this file stays dependency-light; codes must match the DB check). 'fix' is
// NOT offered — the Fix tab is for PORTAL issues; stone rework goes via Custom.
const TRADE_SVC = [
  ['design', 'Design'], ['blast', 'Blast'], ['pickup', 'Pickup'],
  ['install', 'Install'], ['doors', 'Doors'], ['custom', 'Custom…'],
]

function NewRequestForm({ partnerId, partner, onDone }) {
  const [familyName, setFamilyName] = useState('')
  const [dealerOrderNumber, setDealerOrderNumber] = useState('')
  const [services, setServices] = useState(() => new Set(['design']))
  const [serviceCustom, setServiceCustom] = useState('')
  const [requestName, setRequestName] = useState('')
  const [neededBy, setNeededBy] = useState('')
  const [rush, setRush] = useState(false)
  const [rushNeedBy, setRushNeedBy] = useState('')
  const [generalNotes, setGeneralNotes] = useState('')
  const [items, setItems] = useState([blankItem('design')])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  // Who's submitting — bubbles from the names managed in Settings. Fetched
  // fresh so a name added in Settings shows up here without a re-login.
  const [teamNames, setTeamNames] = useState([])
  const [submittedBy, setSubmittedBy] = useState('')
  useEffect(() => {
    let alive = true
    getPartnerTeamNames(partnerId).then(names => { if (alive) setTeamNames(names) })
    return () => { alive = false }
  }, [partnerId])

  const toggleSvc = (code) => setServices(prev => {
    const n = new Set(prev); if (n.has(code)) n.delete(code); else n.add(code); return n
  })

  const setItem = (idx, next) => setItems(arr => arr.map((it, i) => i === idx ? next : it))

  const submit = async () => {
    if (!familyName.trim()) { setError('Enter the family name — it is how everyone tracks this order.'); return }
    if (rush && !rushNeedBy) { setError('Rush orders need the date you need it by.'); return }
    if (teamNames.length > 0 && !submittedBy.trim()) { setError('Tap your name below — who is submitting this order?'); return }
    // Single-service sanity check (Paul): design-only and blast-only orders are
    // easy to mis-click — confirm before submitting.
    const svcList = [...services]
    if (svcList.length === 1 && (svcList[0] === 'design' || svcList[0] === 'blast')) {
      const word = svcList[0] === 'design' ? 'DESIGN' : 'BLAST'
      const sure = window.confirm(`Just to be sure — this order is ${word} ONLY.\n\nNo other services will be scheduled. Submit it as ${word} only?`)
      if (!sure) return
    }
    setBusy(true); setError(null)
    const res = await createVendorRequest({
      partnerId, source: 'partner', requestName, neededBy: neededBy || null, rush, generalNotes,
      familyName, dealerOrderNumber, services: [...services], serviceCustom, rushNeedBy: rushNeedBy || null,
      submittedBy: submittedBy || null,
      createdBy: submittedBy || partner?.contact_person || partner?.company_name || 'Partner',
      items: items.map(({ _files, _key, ...rest }) => rest),  // eslint-disable-line no-unused-vars
    })
    if (!res.ok) { setBusy(false); setError(res.error); return }
    // Upload each item's staged files now that the items have ids.
    const created = res.items || []
    for (let i = 0; i < items.length; i++) {
      const files = items[i]._files || []
      const target = created[i]
      for (const f of files) {
        await uploadVendorFile(f, { partnerId, requestId: res.request.id, itemId: target?.id, uploaderRole: 'partner', kind: 'upload' })
      }
    }
    setBusy(false)
    onDone()
  }

  return (
    <div className="vp-section vp-newreq">
      <div className="vp-section-h">New order</div>
      <p className="vp-newreq-lede">Everything you used to email — family name, your order number, the drawing — plus the details that keep your order moving. One stone per order.</p>
      <style>{`
        .vp-svcrow { display: flex; flex-wrap: wrap; gap: 7px; margin: 4px 0 12px; }
        .vp-svc { font: inherit; font-size: 12.5px; font-weight: 600; border: 1px solid #d8d2c4; border-radius: 999px; padding: 5px 14px; background: #fff; color: #6a6a62; cursor: pointer; }
        .vp-svc.on { background: #9A7209; border-color: #9A7209; color: #fff; }
        .vp-rushdate { display: inline-flex; align-items: center; gap: 8px; margin-left: 10px; }
        .vp-rushnote { font-size: 12px; color: #8a5a12; margin: 4px 0 10px; }
      `}</style>
      <div className="vp-grid2">
        <label className="vic-field"><span>Family name *</span><input className="vic-input" value={familyName} onChange={e => setFamilyName(e.target.value)} placeholder="e.g. Kowalski" /></label>
        <label className="vic-field"><span>Your order # (optional)</span><input className="vic-input" value={dealerOrderNumber} onChange={e => setDealerOrderNumber(e.target.value)} placeholder="e.g. HM-2211" /></label>
      </div>
      <div className="vic-field"><span style={{ fontSize: 12, fontWeight: 600, color: '#6a6a62' }}>Services</span>
        <div className="vp-svcrow">
          {TRADE_SVC.map(([code, label]) => (
            <button key={code} type="button" className={`vp-svc${services.has(code) ? ' on' : ''}`} onClick={() => toggleSvc(code)}>{label}</button>
          ))}
        </div>
        {services.has('custom') && (
          <input className="vic-input" style={{ marginBottom: 12 }} value={serviceCustom} onChange={e => setServiceCustom(e.target.value)} placeholder="Describe the custom service" />
        )}
      </div>
      <div className="vp-grid2">
        <label className="vic-field"><span>Deadline (optional)</span><input className="vic-input" type="date" value={neededBy} onChange={e => setNeededBy(e.target.value)} /></label>
        <label className="vic-field"><span>Request name (optional)</span><input className="vic-input" value={requestName} onChange={e => setRequestName(e.target.value)} placeholder="e.g. Smith — 2 stones" /></label>
      </div>
      <label className="vp-rush">
        <input type="checkbox" checked={rush} onChange={e => setRush(e.target.checked)} /> <span><b style={{ color: '#b3261e' }}>Rush order</b> — I need this by:</span>
        {rush && <span className="vp-rushdate"><input className="vic-input" type="date" value={rushNeedBy} onChange={e => setRushNeedBy(e.target.value)} /></span>}
      </label>
      {rush && <div className="vp-rushnote">Rush requests go to Shevchenko for approval — once approved, your date is guaranteed. Rush pricing may apply.</div>}
      <label className="vic-field"><span>General notes (optional)</span><textarea className="vic-input" rows={2} value={generalNotes} onChange={e => setGeneralNotes(e.target.value)} placeholder="Anything that applies to the whole order" /></label>

      <div className="vp-items">
        {items.map((it, idx) => (
          <VendorItemCard key={it._key} item={it} index={idx} onChange={(n) => setItem(idx, n)} onDuplicate={null} onRemove={() => {}} canRemove={false}
            hideWorkType hideReference hideOptional showLocation notesCenterOption />
        ))}
      </div>

      {/* Submitted by — tap a bubble. Names are managed in Settings. */}
      <div className="vic-field" style={{ marginTop: 14 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: '#6a6a62' }}>Submitted by</span>
        {teamNames.length > 0 ? (
          <div className="vp-svcrow" style={{ marginBottom: 4 }}>
            {teamNames.map(n => (
              <button key={n} type="button" className={`vp-svc${submittedBy === n ? ' on' : ''}`} onClick={() => setSubmittedBy(submittedBy === n ? '' : n)}>{n}</button>
            ))}
          </div>
        ) : (
          <>
            <input className="vic-input" style={{ maxWidth: 280 }} value={submittedBy} onChange={e => setSubmittedBy(e.target.value)} placeholder="Your name" />
            <span style={{ fontSize: 12, color: '#8a8a85', marginTop: 3 }}>Tip: add your team's names in Settings and they show up here as one-tap bubbles.</span>
          </>
        )}
      </div>

      {error && <div className="vp-error">{error}</div>}
      <div className="vp-newreq-actions">
        <button type="button" className="vp-primary" onClick={submit} disabled={busy}>{busy ? 'Submitting…' : 'Submit request'}</button>
      </div>
    </div>
  )
}

// ── Payments — the dealer's invoices (RLS hides drafts; sent + paid only) ────
function PartnerPayments({ partnerId = null }) {
  const [invoices, setInvoices] = useState(null)
  useEffect(() => {
    let alive = true
    listTradeInvoices({ partnerId }).then(rows => { if (alive) setInvoices(rows) }).catch(() => { if (alive) setInvoices([]) })
    return () => { alive = false }
  }, [partnerId])
  if (invoices === null) return <div className="vp-empty">Loading…</div>
  const openBal = invoices.filter(i => i.status === 'sent').reduce((s, i) => s + i.total, 0)
  return (
    <div className="vp-section">
      <div className="vp-section-h">Payments</div>
      <div style={{ display: 'flex', gap: 14, margin: '10px 0 16px', flexWrap: 'wrap' }}>
        <div style={{ background: openBal > 0 ? '#fdf3df' : '#e9f4ec', border: `1px solid ${openBal > 0 ? '#e6b667' : '#8fceb0'}`, borderRadius: 12, padding: '12px 18px' }}>
          <div style={{ fontSize: 24, fontWeight: 800, color: openBal > 0 ? '#8a5a12' : '#1f6b46', fontVariantNumeric: 'tabular-nums' }}>${openBal.toLocaleString()}</div>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#6a6a62' }}>Open balance</div>
        </div>
      </div>
      {invoices.length === 0 ? <div className="vp-empty">No invoices yet.</div> : invoices.map(inv => (
        <div key={inv.id} style={{ background: '#fff', border: '0.5px solid rgba(0,0,0,0.09)', borderRadius: 12, padding: '12px 16px', marginBottom: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <b>{inv.invoice_number}</b>
            <span className="vp-chip" style={inv.status === 'paid'
              ? { background: '#e8f5ee', borderColor: '#7ac4a0', color: '#1f6b46' }
              : { background: '#fdf3df', borderColor: '#e6b667', color: '#8a5a12' }}>
              {inv.status === 'paid' ? `Paid${inv.paid_at ? ` ${fmtDate(inv.paid_at)}` : ''}` : 'Due'}
            </span>
            <span style={{ marginLeft: 'auto', fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>${inv.total.toLocaleString()}</span>
          </div>
          <div style={{ marginTop: 8 }}>
            {(inv.lines || []).map(l => (
              <div key={l.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 13, padding: '4px 0', borderTop: '0.5px solid #f0ede6' }}>
                <span>{l.description}{l.is_rush_fee && <b style={{ color: '#b3261e' }}> (rush)</b>}</span>
                <span style={{ fontVariantNumeric: 'tabular-nums' }}>${(Number(l.amount) || 0).toLocaleString()}</span>
              </div>
            ))}
          </div>
          {inv.status === 'sent' && (
            <div style={{ fontSize: 12.5, color: '#6a6a62', marginTop: 8 }}>
              Pay by check, or Zelle <b>shevcoteam@gmail.com</b> — memo <b>{inv.invoice_number}</b>.
            </div>
          )}
          {inv.notes && <div style={{ fontSize: 12.5, color: '#6a6a62', marginTop: 6, fontStyle: 'italic' }}>{inv.notes}</div>}
        </div>
      ))}
    </div>
  )
}

// ── Fix — report a problem with the PORTAL itself (Paul's Fix Log, dealer
// side). Not stone rework — that goes through a normal order. Issues land in
// Shevchenko's Updates feed and get tracked open → fixed.
function PartnerFix({ partnerId, partner }) {
  const [issues, setIssues] = useState(null)
  const [desc, setDesc] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  const load = () => listTradeIssues({ partnerId }).then(setIssues).catch(() => setIssues([]))
  useEffect(() => { load() }, [partnerId])   // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async () => {
    if (!desc.trim()) { setMsg({ err: true, text: 'Describe what went wrong.' }); return }
    setBusy(true); setMsg(null)
    const r = await submitTradeIssue({
      partnerId, description: desc,
      createdBy: partner?.contact_person || partner?.company_name || 'Dealer',
    })
    setBusy(false)
    if (r.ok) { setDesc(''); setMsg({ text: 'Sent — Shevchenko sees this right away. Thank you!' }); load() }
    else setMsg({ err: true, text: r.error || 'Could not send — try again.' })
  }

  const STATUS = { open: ['Open', '#fdf8ec', '#e8d9a8', '#8a6d12'], fixed: ['Fixed ✓', '#e8f5ee', '#7ac4a0', '#1f6b46'], dismissed: ['Closed', '#f4f2ee', '#ddd9d2', '#9a9a92'] }
  return (
    <div className="vp-section">
      <div className="vp-section-h">Fix — report a portal problem</div>
      <p style={{ fontSize: 13.5, color: '#6a6a62', margin: '6px 0 12px', maxWidth: 560 }}>
        Something in <b>Stonebooks Trade</b> not working right — a button, a page, a number that looks off?
        Tell us here and we'll fix it. (Problems with a <b>stone</b> belong on an order — use + New Request.)
      </p>
      <textarea className="vic-input" rows={3} value={desc} onChange={e => setDesc(e.target.value)}
        style={{ width: '100%', maxWidth: 560, boxSizing: 'border-box' }}
        placeholder='What happened, and where? e.g. "On the Orders page, the tracker shows the wrong date for KOWALSKI."' />
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 10 }}>
        <button type="button" className="vp-primary" onClick={submit} disabled={busy}>{busy ? 'Sending…' : 'Send to Shevchenko'}</button>
        {msg && <span style={{ fontSize: 13, color: msg.err ? '#b54040' : '#1f6b46', fontWeight: 600 }}>{msg.text}</span>}
      </div>
      <div style={{ marginTop: 20 }}>
        {issues === null ? <div className="vp-empty">Loading…</div>
          : issues.length === 0 ? <div className="vp-empty">Nothing reported yet.</div>
          : issues.map(i => {
            const [label, bg, bd, fg] = STATUS[i.status] || STATUS.open
            return (
              <div key={i.id} style={{ background: '#fff', border: '0.5px solid rgba(0,0,0,0.09)', borderRadius: 12, padding: '10px 16px', marginBottom: 8, display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
                <span style={{ flex: 1, minWidth: 200, fontSize: 13.5 }}>{i.description}</span>
                <span style={{ fontSize: 12, color: '#8a8a85', whiteSpace: 'nowrap' }}>{fmtDate(i.created_at)}{i.created_by ? ` · ${i.created_by}` : ''}</span>
                <span className="vp-chip" style={{ background: bg, borderColor: bd, color: fg }}>{label}</span>
              </div>
            )
          })}
      </div>
    </div>
  )
}

// ── Reports — their numbers, our receipts (on-time proof for the guarantee) ──
function PartnerReports({ partnerId }) {
  const [orders, setOrders] = useState(null)
  useEffect(() => {
    let alive = true
    listTradeOrders({ partnerId, scope: 'all' }).then(rows => { if (alive) setOrders(rows) }).catch(() => { if (alive) setOrders([]) })
    return () => { alive = false }
  }, [partnerId])
  if (orders === null) return <div className="vp-empty">Loading…</div>
  const done = orders.filter(o => o.status === 'completed')
  const finishedAt = (o) => o.pickup_receipt?.at || o.updated_at
  const withDeadline = done.filter(o => o.needed_by || o.rush_need_by)
  const onTime = withDeadline.filter(o => {
    const dl = (o.rush_status === 'approved' && o.rush_need_by) ? o.rush_need_by : (o.needed_by || o.rush_need_by)
    return String(finishedAt(o)).slice(0, 10) <= String(dl).slice(0, 10)
  })
  const turnarounds = done
    .map(o => (Date.parse(String(finishedAt(o)).slice(0, 10)) - Date.parse(String(o.created_at).slice(0, 10))) / 86400000)
    .filter(d => Number.isFinite(d) && d >= 0)
  const avgDays = turnarounds.length ? Math.round(turnarounds.reduce((s, d) => s + d, 0) / turnarounds.length) : null
  const stat = (n, label, color = '#1e2d3d') => (
    <div style={{ background: '#fff', border: '0.5px solid rgba(0,0,0,0.09)', borderRadius: 12, padding: '14px 20px', minWidth: 130 }}>
      <div style={{ fontSize: 26, fontWeight: 800, color, fontVariantNumeric: 'tabular-nums' }}>{n}</div>
      <div style={{ fontSize: 12, fontWeight: 600, color: '#6a6a62' }}>{label}</div>
    </div>
  )
  return (
    <div className="vp-section">
      <div className="vp-section-h">Reports</div>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 12 }}>
        {stat(orders.length, 'Orders all-time')}
        {stat(done.length, 'Completed')}
        {stat(withDeadline.length ? `${Math.round((onTime.length / withDeadline.length) * 100)}%` : '—', 'On time (of dated orders)', '#1f6b46')}
        {stat(avgDays != null ? `${avgDays}d` : '—', 'Avg turnaround')}
      </div>
      <p style={{ fontSize: 12.5, color: '#8a8a85', marginTop: 12 }}>
        On-time counts completed orders against the deadline you gave us (rush dates included). Our guarantee lives and dies by this number.
      </p>
    </div>
  )
}

// ── Settings — company info, who has access, email notification toggles ──────
function PartnerSettings({ partner }) {
  const [prefs, setPrefs] = useState(() => ({ ...(partner?.notification_prefs || {}) }))
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)
  // Team names — the "submitted by" bubbles on the order form.
  const [names, setNames] = useState(null)
  const [newName, setNewName] = useState('')
  const [namesSaved, setNamesSaved] = useState(false)
  useEffect(() => {
    let alive = true
    getPartnerTeamNames(partner?.id).then(list => { if (alive) setNames(list) })
    return () => { alive = false }
  }, [partner?.id])
  const saveNames = async (next) => {
    setNames(next); setNamesSaved(false)
    const r = await updatePartnerTeamNames(partner?.id, next)
    if (r.ok) { setNames(r.names); setNamesSaved(true); setTimeout(() => setNamesSaved(false), 2000) }
  }
  const addName = () => {
    const n = newName.trim()
    if (!n) return
    setNewName('')
    saveNames([...(names || []), n])
  }
  const toggle = async (key) => {
    const next = { ...prefs, [key]: prefs[key] === false ? true : false }
    // Normalize: true = default, store only the mutes.
    for (const k of Object.keys(next)) if (next[k] !== false) delete next[k]
    setPrefs(next); setBusy(true); setSaved(false)
    const r = await updatePartnerNotificationPrefs(partner?.id, next)
    setBusy(false)
    if (r.ok) { setSaved(true); setTimeout(() => setSaved(false), 2000) }
  }
  const row = (k, v) => (
    <div style={{ display: 'flex', gap: 12, padding: '7px 0', borderTop: '0.5px solid #f0ede6', fontSize: 13.5 }}>
      <span style={{ width: 120, color: '#8a8a85', flexShrink: 0 }}>{k}</span><span>{v || '—'}</span>
    </div>
  )
  return (
    <div className="vp-section">
      <div className="vp-section-h">Settings</div>
      <div style={{ background: '#fff', border: '0.5px solid rgba(0,0,0,0.09)', borderRadius: 12, padding: '14px 18px', marginTop: 12, maxWidth: 520 }}>
        {row('Company', partner?.company_name)}
        {row('Contact', partner?.contact_person)}
        {row('Phone', partner?.phone)}
        {row('Email', partner?.email)}
        {row('Address', partner?.address)}
        {row('Terms', partner?.payment_terms)}
      </div>

      {/* Team names — one-tap "submitted by" bubbles on the New Order form. */}
      <div style={{ background: '#fff', border: '0.5px solid rgba(0,0,0,0.09)', borderRadius: 12, padding: '14px 18px', marginTop: 14, maxWidth: 520 }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', color: '#979387', marginBottom: 6 }}>
          Team names {namesSaved && <span style={{ color: '#2d7a4f', textTransform: 'none', letterSpacing: 0 }}>· saved ✓</span>}
        </div>
        <p style={{ fontSize: 12.5, color: '#8a8a85', margin: '0 0 10px' }}>
          Add the people who place orders. On the New Order form they show up as one-tap bubbles under "Submitted by."
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginBottom: 10 }}>
          {names === null ? <span style={{ fontSize: 13, color: '#8a8a85' }}>Loading…</span>
            : names.length === 0 ? <span style={{ fontSize: 13, color: '#8a8a85', fontStyle: 'italic' }}>No names yet.</span>
            : names.map(n => (
              <span key={n} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 12.5, fontWeight: 600, border: '1px solid #d8c89a', background: '#fdf8ec', color: '#9A7209', borderRadius: 999, padding: '5px 8px 5px 14px' }}>
                {n}
                <button type="button" onClick={() => saveNames(names.filter(x => x !== n))} title={`Remove ${n}`}
                  style={{ font: 'inherit', border: 'none', background: 'none', color: '#b3a06a', cursor: 'pointer', fontSize: 14, lineHeight: 1, padding: 0 }}>×</button>
              </span>
            ))}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input className="vic-input" style={{ maxWidth: 240 }} value={newName} onChange={e => setNewName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') addName() }} placeholder="e.g. Maria" />
          <button type="button" className="vp-primary" onClick={addName} disabled={!newName.trim()}>Add name</button>
        </div>
      </div>

      <div style={{ background: '#fff', border: '0.5px solid rgba(0,0,0,0.09)', borderRadius: 12, padding: '14px 18px', marginTop: 14, maxWidth: 520 }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', color: '#979387', marginBottom: 6 }}>
          Email notifications {saved && <span style={{ color: '#2d7a4f', textTransform: 'none', letterSpacing: 0 }}>· saved ✓</span>}
        </div>
        {TRADE_NOTIFY_PREFS.map(p => (
          <label key={p.key} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', borderTop: '0.5px solid #f0ede6', fontSize: 13.5, cursor: 'pointer' }}>
            <input type="checkbox" checked={prefs[p.key] !== false} disabled={busy} onChange={() => toggle(p.key)}
              style={{ width: 16, height: 16, accentColor: '#9A7209' }} />
            <span>{p.label}</span>
          </label>
        ))}
        <p style={{ fontSize: 12, color: '#8a8a85', marginTop: 8, marginBottom: 0 }}>
          Sent to the company email above. Unchecking mutes that email — everything still shows in your portal.
        </p>
      </div>

      <p style={{ fontSize: 12.5, color: '#8a8a85', marginTop: 12, maxWidth: 520 }}>
        To update company info, add teammates (your signup link works for everyone at your company),
        or remove a login, contact Shevchenko Monuments — 732-442-1286 · shevcoteam@gmail.com.
      </p>
    </div>
  )
}

function POList({ pos }) {
  return (
    <div className="vp-section">
      <div className="vp-section-h">Purchase Orders</div>
      {pos.length === 0 ? <div className="vp-empty">No purchase orders yet.</div> : (
        <div className="vp-po-table">
          <div className="vp-po-row vp-po-head"><div>PO #</div><div>Date</div><div>Status</div><div>Amount</div></div>
          {pos.map(p => {
            // Custom override wins; otherwise sum the priced lines.
            const lineSum = (p.po_items || []).reduce((s, li) => s + (li.unit_price != null ? Number(li.unit_price) * (Number(li.quantity) || 1) : 0), 0)
            const amt = p.custom_amount != null ? Number(p.custom_amount) : (lineSum || null)
            return (
              <div key={p.id} className="vp-po-row">
                <div className="vp-mono">{p.po_number || '—'}</div>
                <div>{p.po_date ? fmtDate(p.po_date) : '—'}</div>
                <div><span className="vp-chip" style={p.status === 'paid'
                  ? { background: '#e8f5ee', borderColor: '#7ac4a0', color: '#1f6b46', fontWeight: 700 }
                  : { background: p.status === 'sent' ? '#e8f5ee' : '#f4f2ee', borderColor: p.status === 'sent' ? '#7ac4a0' : '#ddd9d2', color: p.status === 'sent' ? '#1f6b46' : '#9a9a92' }}>
                  {p.status === 'paid' ? 'Paid ✓' : p.status === 'sent' ? 'Sent' : 'Draft'}</span></div>
                <div>{amt != null ? `$${amt.toLocaleString('en-US', { minimumFractionDigits: 2 })}` : '—'}</div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function PartnerItemDetail({ item, partnerId, onClose, onChanged, flash }) {
  const [files, setFiles] = useState([])
  const [events, setEvents] = useState([])
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState(false)

  const reload = useCallback(() => {
    return Promise.all([
      listVendorAttachments({ itemId: item.id }),
      listVendorAttachments({ requestId: item.request_id }),
      listVendorEvents({ itemId: item.id, requestId: item.request_id }),
    ]).then(([itFiles, reqFiles, evs]) => {
      const seen = new Set()
      const merged = [...itFiles, ...reqFiles].filter(f => { if (seen.has(f.id)) return false; seen.add(f.id); return true })
      setFiles(merged); setEvents(evs)
    })
  }, [item.id, item.request_id])

  useEffect(() => {
    let cancelled = false
    Promise.all([
      listVendorAttachments({ itemId: item.id }),
      listVendorAttachments({ requestId: item.request_id }),
      listVendorEvents({ itemId: item.id, requestId: item.request_id }),
    ]).then(([itFiles, reqFiles, evs]) => {
      if (cancelled) return
      const seen = new Set()
      const merged = [...itFiles, ...reqFiles].filter(f => { if (seen.has(f.id)) return false; seen.add(f.id); return true })
      setFiles(merged); setEvents(evs)
    })
    return () => { cancelled = true }
  }, [item.id, item.request_id])

  const download = async (path) => {
    const url = await vendorFileSignedUrl(path)
    if (url) window.open(url, '_blank', 'noopener')
  }
  const onUpload = async (list) => {
    setBusy(true)
    for (const f of Array.from(list || [])) {
      await uploadVendorFile(f, { partnerId, requestId: item.request_id, itemId: item.id, uploaderRole: 'partner', kind: 'upload' })
    }
    setBusy(false)
    await reload(); onChanged?.(); flash('File uploaded.')
  }
  const postComment = async () => {
    if (!comment.trim()) return
    setBusy(true)
    await addVendorEvent({ requestId: item.request_id, itemId: item.id, eventType: 'note', actor: 'Partner', detail: comment.trim() })
    setComment(''); setBusy(false)
    await reload(); flash('Comment added.')
  }

  const wt = item.work_type ? item.work_type[0].toUpperCase() + item.work_type.slice(1) : 'Item'
  const designFiles = files.filter(f => f.uploader_role === 'staff' && f.kind !== 'completion_photo')
  const myFiles = files.filter(f => f.uploader_role === 'partner')
  const photos = files.filter(f => f.kind === 'completion_photo')

  return (
    <div className="vp-drawer-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="vp-drawer">
        <div className="vp-drawer-head">
          <div>
            <div className="vp-drawer-sub">{wt}{item.vendor_reference ? ` · ${item.vendor_reference}` : ''}</div>
            <div className="vp-drawer-title">{item.deceased_family_name || item.vendor_reference || 'Item'}</div>
            <div style={{ marginTop: 6 }}><PartnerStatusChip status={item.status} /></div>
          </div>
          <button type="button" className="vp-drawer-close" onClick={onClose}>Close ✕</button>
        </div>

        <div className="vp-detail-meta">
          {item.stone_size && <div><span>Stone</span>{item.stone_size}</div>}
          {item.base_size && <div><span>Base</span>{item.base_size}</div>}
          {item.color && <div><span>Color</span>{item.color}</div>}
          {item.cemetery && <div><span>Cemetery</span>{item.cemetery}</div>}
        </div>
        {item.item_notes && (
          <div className="vp-detail-notes"><div className="vp-detail-notes-l">Notes / instructions</div>{item.item_notes}</div>
        )}

        {designFiles.length > 0 && (
          <div className="vp-drawer-section">
            <div className="vp-ds-h">From Shevchenko</div>
            {designFiles.map(f => <button key={f.id} type="button" className="vp-file" onClick={() => download(f.file_path)}>↓ {f.file_name}</button>)}
          </div>
        )}
        {photos.length > 0 && (
          <div className="vp-drawer-section">
            <div className="vp-ds-h">Completion photos</div>
            {photos.map(f => <button key={f.id} type="button" className="vp-file" onClick={() => download(f.file_path)}>↓ {f.file_name}</button>)}
          </div>
        )}

        <div className="vp-drawer-section">
          <div className="vp-ds-h">Your files</div>
          {myFiles.map(f => <button key={f.id} type="button" className="vp-file" onClick={() => download(f.file_path)}>↓ {f.file_name}</button>)}
          <label className="vp-upload">
            <input type="file" multiple style={{ display: 'none' }} onChange={e => onUpload(e.target.files)} disabled={busy} />
            <span>{busy ? 'Uploading…' : '+ Upload a file'}</span>
          </label>
        </div>

        <div className="vp-drawer-section">
          <div className="vp-ds-h">Messages &amp; timeline</div>
          <div className="vp-comment">
            <textarea className="vic-input" rows={2} value={comment} onChange={e => setComment(e.target.value)} placeholder="Add a comment or question for Shevchenko…" />
            <button type="button" className="vp-primary vp-comment-btn" onClick={postComment} disabled={busy || !comment.trim()}>Send</button>
          </div>
          <div className="vp-timeline">
            {events.length === 0 ? <div className="vp-dim">No activity yet.</div>
              : events.map(ev => (
                <div key={ev.id} className="vp-tl-row">
                  <div className="vp-tl-dot" />
                  <div>
                    <div className="vp-tl-detail">{ev.detail || ev.event_type}</div>
                    <div className="vp-tl-meta">{ev.actor || 'System'} · {fmtDate(ev.created_at)}</div>
                  </div>
                </div>
              ))}
          </div>
        </div>
      </div>
    </div>
  )
}

const VP_CSS = `
  .vp-shell { min-height: 100vh; background: #f7f5f1; font-family: Inter, system-ui, sans-serif; color: #1e2d3d; }
  .vp-header { display: flex; align-items: center; justify-content: space-between; padding: 14px 24px; background: #0F1419; color: #fff; }
  .vp-brand-mark { font-size: 18px; font-weight: 700; letter-spacing: -0.2px; }
  .vp-brand-mark span { color: #c9a84c; }
  .vp-brand-sub { font-size: 11px; color: rgba(255,255,255,0.55); text-transform: uppercase; letter-spacing: 0.08em; margin-top: 2px; }
  .vp-signout { font: inherit; font-size: 13px; color: rgba(255,255,255,0.8); background: none; border: 0.5px solid rgba(255,255,255,0.3); border-radius: 7px; padding: 7px 14px; cursor: pointer; }
  .vp-signout:hover { background: rgba(255,255,255,0.08); }
  .vp-nav { display: flex; gap: 4px; padding: 0 16px; background: #fff; border-bottom: 0.5px solid #e6e3dd; overflow-x: auto; }
  .vp-nav-btn { font: inherit; font-size: 13px; font-weight: 500; color: #6b6b66; background: none; border: none; border-bottom: 2px solid transparent; padding: 13px 14px; cursor: pointer; white-space: nowrap; }
  .vp-nav-btn:hover { color: #1e2d3d; }
  .vp-nav-btn.on { color: #9A7209; border-bottom-color: #9A7209; font-weight: 600; }
  .vp-main { max-width: 980px; margin: 0 auto; padding: 24px 18px 60px; }
  .vp-primary { font: inherit; font-size: 14px; font-weight: 600; color: #fff; background: #9A7209; border: none; border-radius: 8px; padding: 10px 20px; cursor: pointer; }
  .vp-primary:hover { background: #856208; }
  .vp-primary:disabled { opacity: 0.5; cursor: default; }
  .vp-empty { padding: 40px 16px; text-align: center; color: #8a8a85; font-size: 14px; }
  .vp-dim { color: #a0a09a; font-size: 13px; }

  .vp-hero { display: flex; align-items: center; justify-content: space-between; gap: 16px; background: #fff; border: 0.5px solid #e6e3dd; border-radius: 14px; padding: 22px 24px; flex-wrap: wrap; }
  .vp-hero-h { font-size: 22px; font-weight: 700; }
  .vp-hero-sub { font-size: 14px; color: #6b6b66; margin-top: 4px; }
  .vp-hero-cta { padding: 12px 22px; }
  .vp-stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin: 16px 0 8px; }
  .vp-stat { background: #fff; border: 0.5px solid #e6e3dd; border-radius: 12px; padding: 18px; text-align: left; cursor: pointer; }
  .vp-stat:hover { border-color: #d8c89a; }
  .vp-stat-n { font-size: 30px; font-weight: 700; color: #1e2d3d; line-height: 1; }
  .vp-stat-l { font-size: 12px; color: #8a8a85; text-transform: uppercase; letter-spacing: 0.06em; margin-top: 6px; }

  .vp-section { margin-top: 22px; }
  .vp-section-h { font-size: 15px; font-weight: 700; color: #1e2d3d; margin-bottom: 12px; }
  .vp-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 12px; }
  .vp-card { text-align: left; background: #fff; border: 0.5px solid #e6e3dd; border-radius: 12px; padding: 14px; cursor: pointer; display: flex; flex-direction: column; gap: 7px; }
  .vp-card:hover { border-color: #d8c89a; box-shadow: 0 2px 10px rgba(15,20,25,0.05); }
  .vp-card-top { display: flex; align-items: center; justify-content: space-between; }
  .vp-card-type { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: #8a8a85; }
  .vp-card-ref { font-size: 15px; font-weight: 600; color: #1e2d3d; }
  .vp-card-meta { display: flex; flex-wrap: wrap; gap: 6px; font-size: 12px; color: #6b6b66; }
  .vp-card-meta span { background: #f4f2ee; border-radius: 5px; padding: 2px 7px; }
  .vp-card-notes { font-size: 12px; color: #6b6b66; line-height: 1.5; max-height: 3em; overflow: hidden; border-top: 0.5px solid #f1efeb; padding-top: 7px; }
  .vp-chip { font-size: 11px; font-weight: 600; border: 0.5px solid; border-radius: 999px; padding: 2px 9px; white-space: nowrap; }

  .vp-newreq { background: #fff; border: 0.5px solid #e6e3dd; border-radius: 14px; padding: 22px 24px; display: flex; flex-direction: column; gap: 12px; }
  .vp-newreq-lede { font-size: 13px; color: #6b6b66; margin: -4px 0 4px; line-height: 1.5; }
  .vp-grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .vp-rush { display: flex; align-items: center; gap: 8px; font-size: 14px; color: #1e2d3d; }
  .vp-items { display: flex; flex-direction: column; gap: 14px; margin-top: 4px; }
  .vp-additem { font: inherit; font-size: 13px; font-weight: 600; color: #9A7209; background: #fdf8ec; border: 0.5px dashed #d8c89a; border-radius: 8px; padding: 11px; cursor: pointer; }
  .vp-newreq-actions { display: flex; justify-content: flex-end; margin-top: 6px; }
  .vp-error { color: #b54040; font-size: 13px; padding: 8px 10px; background: #fbe5e5; border-radius: 8px; }

  .vp-po-table { background: #fff; border: 0.5px solid #e6e3dd; border-radius: 12px; overflow: hidden; }
  .vp-po-row { display: grid; grid-template-columns: 1.2fr 1fr 100px 100px; gap: 10px; align-items: center; padding: 12px 16px; border-bottom: 0.5px solid #f1efeb; font-size: 13px; }
  .vp-po-row:last-child { border-bottom: none; }
  .vp-po-head { font-size: 10px; text-transform: uppercase; letter-spacing: 0.1em; color: #8a8a85; font-weight: 600; }
  .vp-mono { font-family: 'JetBrains Mono', monospace; font-size: 12px; }

  .vp-drawer-backdrop { position: fixed; inset: 0; background: rgba(15,20,25,0.42); z-index: 1100; display: flex; justify-content: flex-end; }
  .vp-drawer { background: #fff; width: min(560px, 100%); height: 100%; overflow-y: auto; padding: 22px 24px; display: flex; flex-direction: column; gap: 16px; }
  .vp-drawer-head { display: flex; align-items: flex-start; justify-content: space-between; }
  .vp-drawer-sub { font-size: 12px; color: #8a8a85; }
  .vp-drawer-title { font-size: 20px; font-weight: 700; margin: 2px 0; }
  .vp-drawer-close { font: inherit; font-size: 13px; color: #6b6b66; background: none; border: none; cursor: pointer; }
  .vp-detail-meta { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; background: #f7f5f1; border-radius: 10px; padding: 14px; }
  .vp-detail-meta > div { font-size: 14px; color: #1e2d3d; }
  .vp-detail-meta span { display: block; font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: #8a8a85; margin-bottom: 2px; }
  .vp-detail-notes { background: #fdf8ec; border: 0.5px solid #e8d9a8; border-radius: 10px; padding: 12px 14px; font-size: 14px; line-height: 1.6; color: #1e2d3d; white-space: pre-wrap; }
  .vp-detail-notes-l { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: #6b5d2f; margin-bottom: 5px; }
  .vp-drawer-section { border-top: 0.5px solid #f1efeb; padding-top: 14px; display: flex; flex-direction: column; gap: 8px; }
  .vp-ds-h { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: #8a8a85; }
  .vp-file { font: inherit; font-size: 13px; color: #2b5cb0; background: #ecf3ff; border: 0.5px solid #b9cef0; border-radius: 7px; padding: 8px 12px; text-align: left; cursor: pointer; }
  .vp-file:hover { background: #e0ecff; }
  .vp-upload { font-size: 13px; font-weight: 600; color: #9A7209; background: #fdf8ec; border: 0.5px dashed #d8c89a; border-radius: 8px; padding: 10px; cursor: pointer; text-align: center; }
  .vp-comment { display: flex; gap: 8px; align-items: flex-end; }
  .vp-comment .vic-input { flex: 1; }
  .vp-comment-btn { padding: 9px 16px; }
  .vp-timeline { display: flex; flex-direction: column; gap: 10px; margin-top: 4px; }
  .vp-tl-row { display: flex; gap: 10px; align-items: flex-start; }
  .vp-tl-dot { width: 7px; height: 7px; border-radius: 50%; background: #c9a84c; margin-top: 5px; flex-shrink: 0; }
  .vp-tl-detail { font-size: 13px; color: #1e2d3d; }
  .vp-tl-meta { font-size: 11px; color: #a0a09a; margin-top: 1px; }

  .vp-toast { position: fixed; bottom: 22px; left: 50%; transform: translateX(-50%); background: #1e2d3d; color: #fff; font-size: 14px; font-weight: 500; padding: 12px 22px; border-radius: 10px; z-index: 1300; box-shadow: 0 8px 28px rgba(15,20,25,0.28); }

  @media (max-width: 640px) {
    .vp-stats { grid-template-columns: 1fr; }
    .vp-grid2 { grid-template-columns: 1fr; }
    .vp-detail-meta { grid-template-columns: 1fr; }
    .vp-po-row { grid-template-columns: 1fr 1fr; }
  }
`
