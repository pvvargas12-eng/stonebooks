// =============================================================================
// 📚 Stonebooks — Vendors tab (internal staff). PHASE 2.
// =============================================================================
// Sub-nav: Work Queue | Batches | Partners | POs. The Work Queue is the main
// operating screen; New Request (internal) uses the SAME createVendorRequest as
// the future partner portal, so both land here. Item drawer = full edit + status
// + files/photos + request-info email + timeline. Batches group items + generate
// a simple PO. Partner-facing emails route through a reviewable composer.
// =============================================================================

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { fmtDate, getCurrentStaffName, sendOrderEmail, sendShopEmail } from './lib/stonebooksData'
import PartnerPortal from './PartnerPortal'
import {
  listPartners, createPartner, updatePartner,
  listVendorItems, getVendorItem, createVendorRequest, updateVendorRequest, updateVendorItem,
  addVendorItem, deleteVendorItem, duplicateVendorItem,
  uploadVendorFile, listVendorAttachments, vendorFileSignedUrl, addVendorEvent, listVendorEvents,
  listVendorBatches, createVendorBatch, updateVendorBatch, setItemBatch,
  listVendorPOs, createVendorPO, updateVendorPO, nextPONumber,
  invitePartnerUser, listPartnerUsers,
  listTradeUpdates, markTradeUpdatesSeen, getTradeUpdatesCount, decideTradeRush,
  listTradeIssues, setTradeIssueStatus,
  listTradeInvoices, listUninvoicedTradeOrders, createTradeInvoice,
  deleteTradeInvoiceLine, setTradeInvoiceStatus, tradeServiceLabel,
  getOrCreatePartnerInvite,
} from './lib/vendorsData'
import VendorItemCard, { VENDOR_ITEM_CARD_CSS } from './components/VendorItemCard'
import TradeOrderBoard from './components/TradeOrderBoard'

const SUBNAV = [
  { code: 'board', label: 'Trade Board' },
  { code: 'updates', label: 'Updates' },
  { code: 'invoices', label: 'Invoices' },
  { code: 'queue', label: 'Work Queue' },
  { code: 'batches', label: 'Batches' },
  { code: 'partners', label: 'Partners' },
  { code: 'pos', label: 'POs' },
]
const WORK_TYPES = ['design', 'blasting', 'setting', 'other']
const ITEM_STATUSES = ['submitted', 'waiting_on_info', 'ready_to_work', 'in_progress', 'design_uploaded', 'ready_for_pickup', 'completed', 'cancelled']
const statusLabel = (s) => (s || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
const STATUS_TONE = { submitted: '#6b6b66', waiting_on_info: '#b54040', ready_to_work: '#1d4ed8', in_progress: '#b8842a', design_uploaded: '#7c3aed', ready_for_pickup: '#0d9488', completed: '#2d7a4f', cancelled: '#a0a09a' }
const blankItem = () => ({ workType: 'design', vendorReference: '', stoneSize: '', baseSize: '', color: '', cemetery: '', deceasedFamilyName: '', itemNotes: '', _files: [] })

export default function VendorsTab() {
  const [sub, setSub] = useState('board')   // Trade Board is the main surface
  const [partners, setPartners] = useState([])
  const [items, setItems] = useState(null)
  const [batches, setBatches] = useState([])
  const [pos, setPos] = useState([])
  const [drawerId, setDrawerId] = useState(null)
  const [newReqOpen, setNewReqOpen] = useState(false)
  const [poModal, setPoModal] = useState(null)   // { partnerId, items:[], batchId? }
  const [toast, setToast] = useState(null)
  const [updatesCount, setUpdatesCount] = useState(0)

  const flash = useCallback((msg) => { setToast(msg); setTimeout(() => setToast(t => t === msg ? null : t), 3000) }, [])
  const refreshUpdatesCount = useCallback(() => { getTradeUpdatesCount().then(setUpdatesCount).catch(() => {}) }, [])
  useEffect(() => { refreshUpdatesCount() }, [refreshUpdatesCount])

  // Partner-submitted requests still awaiting first triage (≥1 'submitted' item).
  const newPartnerCount = useMemo(() => {
    if (!items) return 0
    const ids = new Set()
    for (const it of items) if (it.request?.source === 'partner' && it.status === 'submitted') ids.add(it.request_id)
    return ids.size
  }, [items])

  const loadAll = useCallback(async () => {
    const [p, it, b, po] = await Promise.all([listPartners(), listVendorItems(), listVendorBatches(), listVendorPOs()])
    setPartners(p); setItems(it); setBatches(b); setPos(po)
  }, [])
  useEffect(() => {
    let c = false
    Promise.all([listPartners(), listVendorItems(), listVendorBatches(), listVendorPOs()])
      .then(([p, it, b, po]) => { if (!c) { setPartners(p); setItems(it); setBatches(b); setPos(po) } })
    return () => { c = true }
  }, [])

  return (
    <div className="sb-page sb-page-wide">
      <style>{VENDOR_ITEM_CARD_CSS}{VEND_CSS}</style>
      <div className="sb-page-head vend-head">
        <div><div className="sb-page-eyebrow">B2B</div><h1 className="sb-page-title">Vendors</h1></div>
        <button type="button" className="vend-primary" onClick={() => setNewReqOpen(true)}>+ New vendor request</button>
      </div>

      <div className="vend-subnav">
        {SUBNAV.map(s => (
          <button key={s.code} type="button" className={`vend-subtab ${sub === s.code ? 'on' : ''}`} onClick={() => setSub(s.code)}>
            {s.label}
            {s.code === 'queue' && newPartnerCount > 0 && <span className="vend-subbadge">{newPartnerCount}</span>}
            {s.code === 'updates' && updatesCount > 0 && <span className="vend-subbadge">{updatesCount}</span>}
          </button>
        ))}
      </div>

      {/* Stonebooks Trade order board — all dealers, whiteboard columns, inline
          status edits, rush approve/decline in the expanded row. */}
      {sub === 'board' && <TradeOrderBoard staffView />}
      {sub === 'updates' && <TradeUpdatesFeed onSeen={refreshUpdatesCount} />}
      {sub === 'invoices' && <TradeInvoicesView partners={partners} flash={flash} />}
      {sub === 'queue' && <WorkQueue items={items} partners={partners} onOpen={setDrawerId} />}
      {sub === 'batches' && <BatchesView batches={batches} items={items || []} partners={partners} onReload={loadAll} onOpenItem={setDrawerId} onGeneratePO={(b) => setPoModal({ partnerId: b.partner_id, batchId: b.id, items: (items || []).filter(i => i.batch_id === b.id) })} flash={flash} />}
      {sub === 'partners' && <PartnersView partners={partners} onReload={loadAll} flash={flash} />}
      {sub === 'pos' && <POsView pos={pos} partners={partners} onNew={() => setPoModal({ partnerId: partners[0]?.id || null, items: [] })} onEdit={(po) => setPoModal({ existing: po, partnerId: po.partner_id })} onReload={loadAll} flash={flash} />}

      {newReqOpen && <NewRequestModal partners={partners} onClose={() => setNewReqOpen(false)} onSaved={() => { setNewReqOpen(false); setSub('queue'); loadAll(); flash('Request created — in the Work Queue.') }} />}
      {drawerId && <ItemDrawer itemId={drawerId} batches={batches} onClose={() => setDrawerId(null)} onChanged={loadAll} onGeneratePO={(it) => setPoModal({ partnerId: it.request?.partner_id, items: [it] })} flash={flash} />}
      {/* Saving jumps to the POs tab — Paul saved two from Batches and thought
          they were lost because the list lives on another sub-tab. */}
      {poModal && <POModal seed={poModal} partners={partners} onClose={() => setPoModal(null)} onSaved={() => { setPoModal(null); setSub('pos'); loadAll(); flash('Invoice saved — it lives here in the POs tab.') }} />}

      {toast && <div className="vend-toast">{toast}</div>}
    </div>
  )
}

// ── Trade Updates feed — every dealer action, newest first ───────────────────
// Opening the feed stamps everything seen (clears the red badge on the Vendors
// nav + sub-tab). Pending rush requests are actionable inline.
function TradeUpdatesFeed({ onSeen }) {
  const [rows, setRows] = useState(null)
  const [issues, setIssues] = useState([])
  const [busyId, setBusyId] = useState(null)
  const load = useCallback(() => {
    listTradeUpdates({ limit: 80 }).then(setRows).catch(() => setRows([]))
    listTradeIssues({ openOnly: true }).then(setIssues).catch(() => setIssues([]))
  }, [])
  useEffect(() => {
    load()
    markTradeUpdatesSeen().then(() => onSeen?.())
  }, [load, onSeen])

  const resolveIssue = async (issue, status) => {
    setBusyId(issue.id)
    await setTradeIssueStatus(issue.id, status)
    setBusyId(null)
    load()
  }

  const decideRush = async (ev, approve) => {
    setBusyId(ev.id)
    const who = await getCurrentStaffName().catch(() => null)
    await decideTradeRush(ev.request_id, approve, { actor: who })
    setBusyId(null)
    load()
  }

  const dotFor = (t) => /approved|dropped|picked/.test(t) ? '#2d7a4f'
    : /changes|rush_requested|fix/.test(t) ? '#b54040'
    : '#9A7209'

  if (rows === null) return <div className="vend-updates-empty">Loading updates…</div>
  if (rows.length === 0 && issues.length === 0) return <div className="vend-updates-empty">No dealer activity yet — everything dealers do lands here.</div>
  return (
    <div className="vend-updates">
      {/* Open portal issues (the dealer Fix tab) pinned on top — bugs first. */}
      {issues.map(i => (
        <div key={i.id} className="vend-update fresh" style={{ borderLeft: '3px solid #b54040' }}>
          <span className="vend-update-dot" style={{ background: '#b54040' }} />
          <div className="vend-update-body">
            <div className="vend-update-line"><b>{i.partner?.company_name || 'Dealer'}</b> — portal problem: “{i.description}”</div>
            <div className="vend-update-meta">{fmtDate(i.created_at)}{i.created_by ? ` · ${i.created_by}` : ''}</div>
          </div>
          <span className="vend-update-actions">
            <button type="button" className="vend-update-approve" disabled={busyId === i.id} onClick={() => resolveIssue(i, 'fixed')}>Mark fixed</button>
            <button type="button" className="vend-update-decline" disabled={busyId === i.id} onClick={() => resolveIssue(i, 'dismissed')}>Dismiss</button>
          </span>
        </div>
      ))}
      {rows.map(ev => {
        const rushPending = ev.request?.rush_status === 'pending'
        return (
          <div key={ev.id} className={`vend-update${ev.staff_seen_at ? '' : ' fresh'}`}>
            <span className="vend-update-dot" style={{ background: dotFor(ev.event_type || '') }} />
            <div className="vend-update-body">
              <div className="vend-update-line">
                <b>{ev.partner?.company_name || 'Dealer'}</b>
                <span> — {ev.detail || (ev.event_type || '').replace(/_/g, ' ')}</span>
                {ev.request?.family_name && <span className="vend-update-fam"> · {ev.request.family_name}{ev.request.dealer_order_number ? ` (${ev.request.dealer_order_number})` : ''}</span>}
              </div>
              <div className="vend-update-meta">{fmtDate(ev.created_at)}{ev.actor ? ` · ${ev.actor}` : ''}</div>
            </div>
            {rushPending && (
              <span className="vend-update-actions">
                <button type="button" className="vend-update-approve" disabled={busyId === ev.id} onClick={() => decideRush(ev, true)}>Approve rush{ev.request?.rush_need_by ? ` · ${ev.request.rush_need_by}` : ''}</button>
                <button type="button" className="vend-update-decline" disabled={busyId === ev.id} onClick={() => decideRush(ev, false)}>Decline</button>
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── Trade Invoices — price, bundle, send, mark paid ──────────────────────────
// Total is always the sum of the lines. Drafts are invisible to dealers (RLS);
// Send emails the dealer the full invoice + stamps events on every order in it.
function TradeInvoicesView({ partners, flash }) {
  const [invoices, setInvoices] = useState(null)
  const [openId, setOpenId] = useState(null)
  const [builder, setBuilder] = useState(false)
  const [busyId, setBusyId] = useState(null)
  const [payNote, setPayNote] = useState({})   // invoiceId → note draft
  const load = useCallback(() => listTradeInvoices().then(setInvoices).catch(() => setInvoices([])), [])
  useEffect(() => { load() }, [load])

  const act = async (inv, status, extra = {}) => {
    setBusyId(inv.id)
    const who = await getCurrentStaffName().catch(() => null)
    const r = await setTradeInvoiceStatus(inv.id, status, { ...extra, actor: who })
    setBusyId(null)
    if (r.ok) { flash(status === 'sent' ? `Invoice ${inv.invoice_number} sent.` : status === 'paid' ? `Invoice ${inv.invoice_number} marked paid.` : 'Invoice updated.'); load() }
    else flash(r.error || 'Failed.')
  }
  const strikeLine = async (inv, line) => {
    setBusyId(inv.id)
    await deleteTradeInvoiceLine(line.id)
    setBusyId(null); load()
  }

  const STATUS_PILL = { draft: ['#f1eee5', '#6a6a62'], sent: ['#fbf3df', '#8a5a12'], paid: ['#e9f4ec', '#2f7d4f'], void: ['#f4f2ee', '#9a9a92'] }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
        <button type="button" className="vend-primary" onClick={() => setBuilder(true)}>+ New invoice</button>
      </div>
      {invoices === null ? <div className="vend-updates-empty">Loading invoices…</div>
        : invoices.length === 0 ? <div className="vend-updates-empty">No invoices yet — “+ New invoice” bundles a dealer’s orders into one bill.</div>
        : (
          <div className="vend-updates">
            {invoices.map(inv => {
              const [bg, fg] = STATUS_PILL[inv.status] || STATUS_PILL.draft
              const open = openId === inv.id
              const busy = busyId === inv.id
              return (
                <div key={inv.id} style={{ borderTop: '0.5px solid #f0ede6' }}>
                  <div className="vend-update" style={{ cursor: 'pointer' }} onClick={() => setOpenId(open ? null : inv.id)}>
                    <div className="vend-update-body">
                      <div className="vend-update-line"><b>{inv.invoice_number}</b> · {inv.partner?.company_name || '—'} <span className="vend-update-fam">· {(inv.lines || []).length} line{(inv.lines || []).length === 1 ? '' : 's'}</span></div>
                      <div className="vend-update-meta">{fmtDate(inv.created_at)}{inv.status === 'paid' && inv.paid_note ? ` · ${inv.paid_note}` : ''}</div>
                    </div>
                    <b style={{ fontVariantNumeric: 'tabular-nums' }}>${inv.total.toLocaleString()}</b>
                    <span style={{ background: bg, color: fg, fontSize: 11, fontWeight: 700, borderRadius: 999, padding: '2px 10px', textTransform: 'uppercase' }}>{inv.status}</span>
                  </div>
                  {open && (
                    <div style={{ padding: '4px 16px 14px', background: '#faf9f5' }}>
                      {(inv.lines || []).map(l => (
                        <div key={l.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '5px 0', fontSize: 13, borderTop: '0.5px solid #ece8df' }}>
                          <span style={{ flex: 1 }}>{l.description}{l.is_rush_fee && <b style={{ color: '#b3261e' }}> (rush fee)</b>}</span>
                          <span style={{ fontVariantNumeric: 'tabular-nums' }}>${(Number(l.amount) || 0).toLocaleString()}</span>
                          {inv.status === 'draft' && (
                            <button type="button" className="vend-update-decline" disabled={busy} title="Strike this line" onClick={() => strikeLine(inv, l)}>✕</button>
                          )}
                        </div>
                      ))}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10, flexWrap: 'wrap' }}>
                        {inv.status === 'draft' && (
                          <>
                            <button type="button" className="vend-update-approve" disabled={busy || !(inv.lines || []).length} onClick={() => act(inv, 'sent')}>Send invoice · ${inv.total.toLocaleString()}</button>
                            <button type="button" className="vend-update-decline" disabled={busy} onClick={() => act(inv, 'void')}>Void</button>
                          </>
                        )}
                        {inv.status === 'sent' && (
                          <>
                            <input className="vic-input" style={{ maxWidth: 220 }} placeholder='e.g. check #2211 / Zelle conf' value={payNote[inv.id] || ''}
                              onChange={e => setPayNote(m => ({ ...m, [inv.id]: e.target.value }))} />
                            <button type="button" className="vend-update-approve" disabled={busy} onClick={() => act(inv, 'paid', { paidNote: (payNote[inv.id] || '').trim() || null })}>Mark paid</button>
                            <button type="button" className="vend-update-decline" disabled={busy} onClick={() => act(inv, 'void')}>Void</button>
                          </>
                        )}
                        {inv.status === 'paid' && <span className="vend-update-meta">Paid {inv.paid_at ? fmtDate(inv.paid_at) : ''}</span>}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      {builder && <TradeInvoiceBuilder partners={partners} onClose={() => setBuilder(false)} onSaved={() => { setBuilder(false); flash('Draft invoice created.'); load() }} />}
    </div>
  )
}

// Builder: pick the company → check off their un-invoiced orders → price each →
// rush-approved orders auto-suggest a strikeable rush-fee line → custom lines.
function TradeInvoiceBuilder({ partners, onClose, onSaved }) {
  const [partnerId, setPartnerId] = useState(partners[0]?.id || '')
  const [orders, setOrders] = useState(null)
  const [picked, setPicked] = useState({})    // requestId → { on, amount, rushOn, rushAmount }
  const [custom, setCustom] = useState([])    // [{ key, description, amount }]
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  useEffect(() => {
    if (!partnerId) { setOrders([]); return }
    let alive = true
    setOrders(null)
    listUninvoicedTradeOrders(partnerId).then(rows => { if (alive) { setOrders(rows); setPicked({}) } })
    return () => { alive = false }
  }, [partnerId])

  const descFor = (o) => {
    const svc = (o.services || []).map(tradeServiceLabel).join(' + ')
    return `${o.family_name || o.request_name || 'Order'}${o.dealer_order_number ? ` (${o.dealer_order_number})` : ''}${svc ? ` — ${svc}` : ''}`
  }
  const setPick = (id, patch) => setPicked(m => ({ ...m, [id]: { on: false, amount: '', rushOn: true, rushAmount: '', ...(m[id] || {}), ...patch } }))
  const addCustom = () => setCustom(c => [...c, { key: Date.now() + Math.random(), description: '', amount: '' }])

  const save = async () => {
    const lines = []
    for (const o of (orders || [])) {
      const p = picked[o.id]
      if (!p?.on) continue
      lines.push({ requestId: o.id, description: descFor(o), amount: Number(p.amount) || 0 })
      if (o.rush_status === 'approved' && p.rushOn && Number(p.rushAmount) > 0) {
        lines.push({ requestId: o.id, description: `Rush fee — ${o.family_name || o.dealer_order_number || 'order'}`, amount: Number(p.rushAmount), isRushFee: true })
      }
    }
    for (const c of custom) if (c.description.trim()) lines.push({ description: c.description, amount: Number(c.amount) || 0 })
    if (!lines.length) { setErr('Pick at least one order or add a line.'); return }
    setBusy(true); setErr(null)
    const who = await getCurrentStaffName().catch(() => null)
    const r = await createTradeInvoice({ partnerId, lines, notes: notes.trim() || null, createdBy: who })
    setBusy(false)
    if (r.ok) onSaved()
    else setErr(r.error || 'Could not create the invoice.')
  }

  const total = (orders || []).reduce((s, o) => {
    const p = picked[o.id]
    if (!p?.on) return s
    let t = s + (Number(p.amount) || 0)
    if (o.rush_status === 'approved' && p.rushOn) t += Number(p.rushAmount) || 0
    return t
  }, 0) + custom.reduce((s, c) => s + (Number(c.amount) || 0), 0)

  return (
    <div className="vend-backdrop" onClick={() => !busy && onClose()}>
      <div className="vend-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 640 }}>
        <div className="vend-modal-title">New invoice</div>
        <label className="vic-field"><span>Company</span>
          <select className="vic-input" value={partnerId} onChange={e => setPartnerId(e.target.value)}>
            {partners.map(p => <option key={p.id} value={p.id}>{p.company_name}</option>)}
          </select>
        </label>
        {orders === null ? <div className="vend-update-meta" style={{ padding: '10px 0' }}>Loading their orders…</div>
          : orders.length === 0 ? <div className="vend-update-meta" style={{ padding: '10px 0' }}>No un-invoiced orders for this company.</div>
          : orders.map(o => {
            const p = picked[o.id] || {}
            return (
              <div key={o.id} style={{ borderTop: '0.5px solid #ece8df', padding: '8px 0' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13.5, cursor: 'pointer' }}>
                  <input type="checkbox" checked={!!p.on} onChange={e => setPick(o.id, { on: e.target.checked })} />
                  <span style={{ flex: 1 }}>{descFor(o)}</span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>$
                    <input className="vic-input" style={{ width: 100, textAlign: 'right' }} value={p.amount || ''} placeholder="0"
                      onChange={e => setPick(o.id, { on: true, amount: e.target.value })} /></span>
                </label>
                {o.rush_status === 'approved' && p.on && (
                  <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12.5, color: '#8a5a12', margin: '6px 0 0 26px', cursor: 'pointer' }}>
                    <input type="checkbox" checked={p.rushOn !== false} onChange={e => setPick(o.id, { rushOn: e.target.checked })} />
                    <span>Rush fee (auto — uncheck to waive)</span>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>$
                      <input className="vic-input" style={{ width: 80, textAlign: 'right' }} value={p.rushAmount || ''} placeholder="0"
                        onChange={e => setPick(o.id, { rushAmount: e.target.value })} /></span>
                  </label>
                )}
              </div>
            )
          })}
        {custom.map((c, i) => (
          <div key={c.key} style={{ display: 'flex', gap: 8, alignItems: 'center', borderTop: '0.5px solid #ece8df', padding: '8px 0' }}>
            <input className="vic-input" style={{ flex: 1 }} placeholder="Custom line — e.g. delivery" value={c.description}
              onChange={e => setCustom(arr => arr.map((x, j) => j === i ? { ...x, description: e.target.value } : x))} />
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>$
              <input className="vic-input" style={{ width: 100, textAlign: 'right' }} value={c.amount} placeholder="0"
                onChange={e => setCustom(arr => arr.map((x, j) => j === i ? { ...x, amount: e.target.value } : x))} /></span>
            <button type="button" className="vend-update-decline" onClick={() => setCustom(arr => arr.filter((_, j) => j !== i))}>✕</button>
          </div>
        ))}
        <button type="button" className="vend-update-decline" style={{ borderStyle: 'dashed', color: '#9A7209', borderColor: '#d9c48a', marginTop: 8 }} onClick={addCustom}>+ Add a custom line</button>
        <label className="vic-field" style={{ marginTop: 10 }}><span>Note on the invoice (optional)</span>
          <input className="vic-input" value={notes} onChange={e => setNotes(e.target.value)} placeholder="e.g. Net 30 · June work" /></label>
        {err && <div style={{ background: '#fbedec', color: '#b3261e', borderRadius: 8, padding: '8px 12px', fontSize: 12.5, marginTop: 8 }}>{err}</div>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 14 }}>
          <button type="button" className="vend-update-decline" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className="vend-primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : `Create draft · $${total.toLocaleString()}`}</button>
        </div>
      </div>
    </div>
  )
}

// ── Work Queue ───────────────────────────────────────────────────────────────
function WorkQueue({ items, partners, onOpen }) {
  const [fPartner, setFPartner] = useState('')
  const [fType, setFType] = useState('')
  const [fStatus, setFStatus] = useState('')
  const [onlyNew, setOnlyNew] = useState(false)
  const isNew = (i) => i.request?.source === 'partner' && i.status === 'submitted'
  const newCount = useMemo(() => {
    if (!items) return 0
    const ids = new Set()
    for (const it of items) if (isNew(it)) ids.add(it.request_id)
    return ids.size
  }, [items])
  const rows = useMemo(() => {
    if (!items) return null
    return items.filter(i =>
      (!fPartner || i.request?.partner_id === fPartner) &&
      (!fType || i.work_type === fType) &&
      (!fStatus || i.status === fStatus) &&
      (!onlyNew || isNew(i)))
      // New partner items first, then most-recently-updated.
      .sort((a, b) => (isNew(b) - isNew(a)) || String(b.updated_at || '').localeCompare(String(a.updated_at || '')))
  }, [items, fPartner, fType, fStatus, onlyNew])

  return (
    <>
      {newCount > 0 && (
        <div className="vend-newbanner">
          <span><strong>{newCount}</strong> new partner request{newCount === 1 ? '' : 's'} awaiting triage</span>
          <button type="button" onClick={() => setOnlyNew(v => !v)}>{onlyNew ? 'Show all' : 'Show only these'}</button>
        </div>
      )}
      <div className="vend-filters">
        <select value={fPartner} onChange={e => setFPartner(e.target.value)}><option value="">All partners</option>{partners.map(p => <option key={p.id} value={p.id}>{p.company_name}</option>)}</select>
        <select value={fType} onChange={e => setFType(e.target.value)}><option value="">All work types</option>{WORK_TYPES.map(t => <option key={t} value={t}>{statusLabel(t)}</option>)}</select>
        <select value={fStatus} onChange={e => setFStatus(e.target.value)}><option value="">All statuses</option>{ITEM_STATUSES.map(s => <option key={s} value={s}>{statusLabel(s)}</option>)}</select>
      </div>
      <div className="vend-table">
        <div className="vend-row vend-row-head">
          <div>Partner</div><div>Work</div><div>Ref</div><div>Status</div><div>Needed by</div><div>Batch</div><div>Updated</div><div />
        </div>
        {rows === null ? <div className="vend-empty">Loading…</div>
          : rows.length === 0 ? <div className="vend-empty">No items. Use “+ New vendor request”. (If this stays empty, the 20260608 migration may need to be applied.)</div>
          : rows.map(i => (
            <div key={i.id} className="vend-row">
              <div className="vend-strong">{i.request?.partner?.company_name || '—'}{isNew(i) && <span className="vend-newpill">NEW</span>}</div>
              <div>{statusLabel(i.work_type)}</div>
              <div className="vend-mono">{i.vendor_reference || '—'}</div>
              <div><StatusChip status={i.status} /></div>
              <div>{i.request?.needed_by ? fmtDate(i.request.needed_by) : '—'}{i.request?.rush && <span className="vend-rush">RUSH</span>}</div>
              <div>{i.batch?.name || (i.batch_id ? 'Batched' : '—')}</div>
              <div className="vend-dim">{i.updated_at ? fmtDate(i.updated_at) : '—'}</div>
              <div><button type="button" className="vend-open" onClick={() => onOpen(i.id)}>Open</button></div>
            </div>
          ))}
      </div>
    </>
  )
}

function StatusChip({ status }) {
  return <span className="vend-chip" style={{ color: STATUS_TONE[status] || '#6b6b66', borderColor: STATUS_TONE[status] || '#ccc' }}>{statusLabel(status)}</span>
}

// ── New Request (internal) ───────────────────────────────────────────────────
function NewRequestModal({ partners, onClose, onSaved }) {
  const [partnerId, setPartnerId] = useState(partners[0]?.id || '')
  const [requestName, setRequestName] = useState('')
  const [neededBy, setNeededBy] = useState('')
  const [rush, setRush] = useState(false)
  const [generalNotes, setGeneralNotes] = useState('')
  const [items, setItems] = useState([blankItem()])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const setItem = (idx, next) => setItems(arr => arr.map((it, i) => i === idx ? next : it))
  const dupItem = (idx) => setItems(arr => { const c = { ...arr[idx], _files: [] }; return [...arr.slice(0, idx + 1), c, ...arr.slice(idx + 1)] })
  const rmItem = (idx) => setItems(arr => arr.length > 1 ? arr.filter((_, i) => i !== idx) : arr)

  const submit = async () => {
    if (!partnerId) { setError('Pick a partner.'); return }
    setBusy(true); setError(null)
    const res = await createVendorRequest({ partnerId, requestName, neededBy, rush, generalNotes, source: 'internal', items })
    if (!res.ok) { setBusy(false); setError(res.error); return }
    // Upload each item's staged files against the created item.
    const created = res.items || []
    for (let i = 0; i < created.length; i++) {
      const files = items[i]?._files || []
      for (const f of files) await uploadVendorFile(f, { partnerId, requestId: res.request.id, itemId: created[i].id, uploaderRole: 'staff', kind: 'upload' }).catch(() => {})
    }
    setBusy(false)
    onSaved()
  }

  return (
    <div className="vend-backdrop" onClick={() => { if (!busy) onClose() }}>
      <div className="vend-modal vend-modal-lg" onClick={e => e.stopPropagation()}>
        <h3 className="vend-modal-title">New vendor request</h3>
        <div className="vend-grid2">
          <label className="vic-field"><span>Partner company</span>
            <select className="vic-input" value={partnerId} onChange={e => setPartnerId(e.target.value)}>
              <option value="">Select partner…</option>{partners.map(p => <option key={p.id} value={p.id}>{p.company_name}</option>)}
            </select>
          </label>
          <label className="vic-field"><span>Request / batch name</span><input className="vic-input" value={requestName} onChange={e => setRequestName(e.target.value)} placeholder="optional" /></label>
          <label className="vic-field"><span>Needed by</span><input className="vic-input" type="date" value={neededBy} onChange={e => setNeededBy(e.target.value)} /></label>
          <label className="vic-field vend-rush-field"><input type="checkbox" checked={rush} onChange={e => setRush(e.target.checked)} /> <span>Rush</span></label>
        </div>
        <label className="vic-field"><span>General notes</span><textarea className="vic-input" rows={2} value={generalNotes} onChange={e => setGeneralNotes(e.target.value)} placeholder="optional — applies to the whole request" /></label>

        <div className="vend-items">
          {items.map((it, i) => (
            <VendorItemCard key={i} item={it} index={i} onChange={(n) => setItem(i, n)} onDuplicate={() => dupItem(i)} onRemove={() => rmItem(i)} canRemove={items.length > 1} />
          ))}
        </div>
        <button type="button" className="vend-add-item" onClick={() => setItems(arr => [...arr, blankItem()])}>+ Add another stone / item</button>

        {error && <div className="vend-error">{error}</div>}
        <div className="vend-modal-actions">
          <button type="button" className="vend-cancel" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className="vend-primary" onClick={submit} disabled={busy}>{busy ? 'Saving…' : 'Create request'}</button>
        </div>
      </div>
    </div>
  )
}

// ── Item drawer ──────────────────────────────────────────────────────────────
function ItemDrawer({ itemId, batches, onClose, onChanged, onGeneratePO, flash }) {
  const [item, setItem] = useState(null)
  const [atts, setAtts] = useState([])
  const [events, setEvents] = useState([])
  const [edit, setEdit] = useState(false)
  const [draft, setDraft] = useState({})
  const [email, setEmail] = useState(null)
  const [reqEdit, setReqEdit] = useState(false)
  const fileRef = useRef(null); const photoRef = useRef(null)

  const reload = useCallback(async () => {
    const it = await getVendorItem(itemId)
    setItem(it); setDraft(it || {})
    setAtts(await listVendorAttachments({ itemId }))
    setEvents(await listVendorEvents({ itemId, requestId: it?.request_id }))
  }, [itemId])
  useEffect(() => {
    let c = false
    ;(async () => {
      const it = await getVendorItem(itemId)
      if (c) return
      setItem(it); setDraft(it || {})
      const [a, ev] = await Promise.all([listVendorAttachments({ itemId }), listVendorEvents({ itemId, requestId: it?.request_id })])
      if (!c) { setAtts(a); setEvents(ev) }
    })()
    return () => { c = true }
  }, [itemId])

  if (!item) return <div className="vend-drawer-backdrop" onClick={onClose}><div className="vend-drawer" onClick={e => e.stopPropagation()}><div className="vend-empty">Loading…</div></div></div>

  const partner = item.request?.partner
  const setStatus = async (s) => { await updateVendorItem(item.id, { status: s }, { actor: await getCurrentStaffName().catch(() => 'Staff') }); await reload(); onChanged?.() }
  const saveEdits = async () => {
    const patch = {}
    for (const [k, col] of Object.entries({ workType: 'work_type', vendorReference: 'vendor_reference', stoneSize: 'stone_size', baseSize: 'base_size', color: 'color', cemetery: 'cemetery', deceasedFamilyName: 'deceased_family_name', itemNotes: 'item_notes', internalNotes: 'internal_notes', assignedTo: 'assigned_to' })) {
      if (draft[col] !== item[col]) patch[k] = draft[col]
    }
    if (Object.keys(patch).length) { await updateVendorItem(item.id, patch); }
    setEdit(false); await reload(); onChanged?.()
  }
  const doUpload = async (file, kind) => {
    if (!file) return
    await uploadVendorFile(file, { partnerId: item.request?.partner_id, requestId: item.request_id, itemId: item.id, uploaderRole: 'staff', kind })
    await reload(); onChanged?.()
    if (fileRef.current) fileRef.current.value = ''; if (photoRef.current) photoRef.current.value = ''
  }
  const openEmail = async (kind) => {
    const subjects = { info: `We need a bit more info — ${item.vendor_reference || 'your item'}`, design: `Your design is ready — ${item.vendor_reference || ''}`, pickup: `Ready for pickup — ${item.vendor_reference || ''}`, completed: `Completed — ${item.vendor_reference || ''}` }
    const bodies = {
      info: `Hi ${partner?.contact_person || partner?.company_name || ''},\n\nWe’re working on ${item.vendor_reference || 'your item'} and need a little more information to proceed. Could you send over the details when you get a chance?\n\nThanks,\nShevchenko Monuments`,
      design: `Hi ${partner?.contact_person || partner?.company_name || ''},\n\nThe design for ${item.vendor_reference || 'your item'} is ready — you can download it from your partner portal under Open Jobs.\n\nThanks,\nShevchenko Monuments`,
      pickup: `Hi ${partner?.contact_person || partner?.company_name || ''},\n\n${item.vendor_reference || 'Your item'} is ready for pickup. See it under Ready for Pickup in your portal.\n\nThanks,\nShevchenko Monuments`,
      completed: `Hi ${partner?.contact_person || partner?.company_name || ''},\n\n${item.vendor_reference || 'Your item'} is complete — the completion photo is in your portal.\n\nThanks,\nShevchenko Monuments`,
    }
    setEmail({ to: partner?.email || '', subject: subjects[kind] || '', body: bodies[kind] || '', kind })
  }

  const dupItem = async () => { await duplicateVendorItem(item.id); onChanged?.(); flash('Item duplicated.') }
  const rmItem = async () => { await deleteVendorItem(item.id); onChanged?.(); onClose() }
  const addSibling = async () => { await addVendorItem(item.request_id, { workType: 'design' }); onChanged?.(); flash('Item added to this request.') }
  const moveToBatch = async (batchId) => { await updateVendorItem(item.id, { batchId: batchId || null }); await reload(); onChanged?.() }
  const vendorFiles = atts.filter(a => a.kind === 'upload' && a.uploader_role === 'partner')
  const staffFiles = atts.filter(a => a.kind === 'upload' && a.uploader_role === 'staff')
  const photos = atts.filter(a => a.kind === 'completion_photo')

  return (
    <div className="vend-drawer-backdrop" onClick={onClose}>
      <div className="vend-drawer" onClick={e => e.stopPropagation()}>
        <div className="vend-drawer-head">
          <div>
            <div className="vend-drawer-sub">{partner?.company_name} · {statusLabel(item.work_type)}</div>
            <div className="vend-drawer-title">{item.vendor_reference || 'Item'}</div>
            <div className="vend-drawer-meta"><StatusChip status={item.status} />{item.request?.needed_by && <span>Needed {fmtDate(item.request.needed_by)}</span>}{item.request?.rush && <span className="vend-rush">RUSH</span>}</div>
          </div>
          <button type="button" className="vend-drawer-close" onClick={onClose}>Close ×</button>
        </div>

        {/* Actions */}
        <div className="vend-actions">
          <label className="vend-act-status">Status
            <select value={item.status} onChange={e => setStatus(e.target.value)}>{ITEM_STATUSES.map(s => <option key={s} value={s}>{statusLabel(s)}</option>)}</select>
          </label>
          <button type="button" onClick={() => fileRef.current?.click()}>Upload file</button>
          <button type="button" onClick={() => photoRef.current?.click()}>Upload photo</button>
          <button type="button" onClick={() => openEmail('info')}>Request info</button>
          <button type="button" onClick={() => setStatus('ready_for_pickup')}>Ready for pickup</button>
          <button type="button" onClick={() => setStatus('completed')}>Mark completed</button>
          <button type="button" onClick={() => onGeneratePO(item)}>Generate PO</button>
          <button type="button" onClick={dupItem}>Duplicate</button>
          <button type="button" onClick={rmItem}>Remove</button>
          <button type="button" onClick={addSibling}>+ Item to request</button>
          <button type="button" onClick={() => setReqEdit(true)}>Edit request</button>
          <select className="vend-act-batch" value={item.batch_id || ''} onChange={e => moveToBatch(e.target.value)} title="Move to batch">
            <option value="">No batch</option>
            {batches.filter(b => !b.partner_id || b.partner_id === item.request?.partner_id).map(b => <option key={b.id} value={b.id}>{b.name || 'Batch'}</option>)}
          </select>
          <input ref={fileRef} type="file" style={{ display: 'none' }} onChange={e => doUpload(e.target.files?.[0], 'upload')} />
          <input ref={photoRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={e => doUpload(e.target.files?.[0], 'completion_photo')} />
        </div>

        {/* Details */}
        <div className="vend-drawer-section">
          <div className="vend-sec-head"><span>Details</span><button type="button" className="vend-sec-edit" onClick={() => edit ? saveEdits() : setEdit(true)}>{edit ? 'Save' : 'Edit'}</button></div>
          {edit ? (
            <div className="vend-detail-edit">
              <Field label="Work type"><select className="vic-input" value={draft.work_type} onChange={e => setDraft(d => ({ ...d, work_type: e.target.value }))}>{WORK_TYPES.map(t => <option key={t} value={t}>{statusLabel(t)}</option>)}</select></Field>
              {['vendor_reference', 'stone_size', 'base_size', 'color', 'cemetery', 'deceased_family_name', 'assigned_to'].map(col => (
                <Field key={col} label={statusLabel(col)}><input className="vic-input" value={draft[col] || ''} onChange={e => setDraft(d => ({ ...d, [col]: e.target.value }))} /></Field>
              ))}
              <Field label="Item notes" wide><textarea className="vic-input" rows={3} value={draft.item_notes || ''} onChange={e => setDraft(d => ({ ...d, item_notes: e.target.value }))} /></Field>
              <Field label="Internal notes" wide><textarea className="vic-input" rows={2} value={draft.internal_notes || ''} onChange={e => setDraft(d => ({ ...d, internal_notes: e.target.value }))} /></Field>
            </div>
          ) : (
            <div className="vend-detail">
              <Detail label="Partner" value={partner?.company_name} /><Detail label="Contact" value={partner?.contact_person || partner?.phone || partner?.email} />
              <Detail label="Work type" value={statusLabel(item.work_type)} /><Detail label="Vendor ref" value={item.vendor_reference} />
              <Detail label="Stone size" value={item.stone_size} /><Detail label="Base size" value={item.base_size} />
              <Detail label="Color" value={item.color} /><Detail label="Cemetery" value={item.cemetery} />
              <Detail label="Deceased / family" value={item.deceased_family_name} /><Detail label="Assigned to" value={item.assigned_to} />
              <Detail label="Item notes" value={item.item_notes} wide /><Detail label="Internal notes" value={item.internal_notes} wide />
            </div>
          )}
        </div>

        {/* Files */}
        <div className="vend-drawer-section">
          <div className="vend-sec-head"><span>Files</span></div>
          <FileGroup title="Vendor-uploaded" files={vendorFiles} />
          <FileGroup title="Shevchenko-uploaded" files={staffFiles} />
          <FileGroup title="Completion photos" files={photos} />
        </div>

        {/* Timeline */}
        <div className="vend-drawer-section">
          <div className="vend-sec-head"><span>Timeline</span></div>
          {events.length === 0 ? <div className="vend-dim">No events yet.</div> : (
            <div className="vend-timeline">
              {events.map(e => (
                <div key={e.id} className="vend-tl-row">
                  <span className="vend-tl-dot" />
                  <div><div className="vend-tl-detail">{e.detail || statusLabel(e.event_type)}</div><div className="vend-tl-meta">{e.actor || '—'} · {fmtDate(e.created_at)}</div></div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {email && <EmailComposer email={email} onClose={() => setEmail(null)} onSent={async () => { await addVendorEvent({ requestId: item.request_id, itemId: item.id, eventType: email.kind === 'info' ? 'info_requested' : 'email_sent', actor: 'Staff', detail: `Email: ${email.subject}` }); setEmail(null); await reload(); flash('Email sent.') }} />}
      {reqEdit && <RequestEditModal request={item.request} onClose={() => setReqEdit(false)} onSaved={async () => { setReqEdit(false); await reload(); onChanged?.(); flash('Request updated.') }} />}
    </div>
  )
}

// Edit the PARENT request fields (name / needed-by / rush / general notes) after
// submission — staff keep full control of the request, not just line items.
function RequestEditModal({ request, onClose, onSaved }) {
  const [f, setF] = useState({ requestName: request?.request_name || '', neededBy: request?.needed_by || '', rush: !!request?.rush, generalNotes: request?.general_notes || '', status: request?.status || 'submitted' })
  const [busy, setBusy] = useState(false); const [error, setError] = useState(null)
  const set = (k, v) => setF(s => ({ ...s, [k]: v }))
  const save = async () => {
    setBusy(true); setError(null)
    const res = await updateVendorRequest(request.id, { requestName: f.requestName, neededBy: f.neededBy || null, rush: f.rush, generalNotes: f.generalNotes, status: f.status })
    setBusy(false)
    if (!res.ok) { setError(res.error); return }
    onSaved()
  }
  return (
    <div className="vend-backdrop" onClick={() => { if (!busy) onClose() }}>
      <div className="vend-modal" onClick={e => e.stopPropagation()}>
        <h3 className="vend-modal-title">Edit request</h3>
        <div className="vend-grid2">
          <label className="vic-field"><span>Request name</span><input className="vic-input" value={f.requestName} onChange={e => set('requestName', e.target.value)} /></label>
          <label className="vic-field"><span>Needed by</span><input className="vic-input" type="date" value={f.neededBy || ''} onChange={e => set('neededBy', e.target.value)} /></label>
        </div>
        <label className="vend-rush-field"><input type="checkbox" checked={f.rush} onChange={e => set('rush', e.target.checked)} /> <span>Rush</span></label>
        <label className="vic-field"><span>General notes</span><textarea className="vic-input" rows={2} value={f.generalNotes} onChange={e => set('generalNotes', e.target.value)} /></label>
        {error && <div className="vend-error">{error}</div>}
        <div className="vend-modal-actions"><button type="button" className="vend-cancel" onClick={onClose} disabled={busy}>Cancel</button><button type="button" className="vend-primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button></div>
      </div>
    </div>
  )
}

function Field({ label, children, wide }) { return <label className={`vic-field ${wide ? 'vend-wide' : ''}`}><span>{label}</span>{children}</label> }
function Detail({ label, value, wide }) { return <div className={`vend-detail-row ${wide ? 'vend-wide' : ''}`}><span className="vend-detail-label">{label}</span><span className="vend-detail-val">{value || '—'}</span></div> }

function FileGroup({ title, files }) {
  const open = async (path) => { const url = await vendorFileSignedUrl(path); if (url) window.open(url, '_blank') }
  return (
    <div className="vend-filegroup">
      <div className="vend-filegroup-title">{title}</div>
      {files.length === 0 ? <div className="vend-dim vend-filegroup-empty">None</div> : (
        <div className="vend-filegroup-list">{files.map(f => <button key={f.id} type="button" className="vend-file" onClick={() => open(f.file_path)}>{f.file_name || 'file'} ↗</button>)}</div>
      )}
    </div>
  )
}

// ── Reviewable email composer (human-in-loop; reuses gmail-send) ─────────────
function EmailComposer({ email, onClose, onSent }) {
  const [to, setTo] = useState(email.to || '')
  const [subject, setSubject] = useState(email.subject || '')
  const [body, setBody] = useState(email.body || '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const send = async () => {
    if (!to.trim()) { setError('Enter a recipient.'); return }
    setBusy(true); setError(null)
    const res = await sendOrderEmail({ orderId: null, to: to.trim(), subject, body })
    setBusy(false)
    if (!res.ok) { setError(res.error || 'Send failed — check Gmail is connected.'); return }
    onSent()
  }
  return (
    <div className="vend-backdrop" onClick={() => { if (!busy) onClose() }}>
      <div className="vend-modal" onClick={e => e.stopPropagation()}>
        <h3 className="vend-modal-title">Review &amp; send</h3>
        <label className="vic-field"><span>To</span><input className="vic-input" value={to} onChange={e => setTo(e.target.value)} /></label>
        <label className="vic-field"><span>Subject</span><input className="vic-input" value={subject} onChange={e => setSubject(e.target.value)} /></label>
        <label className="vic-field"><span>Message</span><textarea className="vic-input" rows={8} value={body} onChange={e => setBody(e.target.value)} /></label>
        {error && <div className="vend-error">{error}</div>}
        <div className="vend-modal-actions"><button type="button" className="vend-cancel" onClick={onClose} disabled={busy}>Cancel</button><button type="button" className="vend-primary" onClick={send} disabled={busy}>{busy ? 'Sending…' : 'Send'}</button></div>
      </div>
    </div>
  )
}

// ── Partners ─────────────────────────────────────────────────────────────────
function PartnersView({ partners, onReload, flash }) {
  const [editing, setEditing] = useState(null)   // partner | 'new' | null
  const [viewAs, setViewAs] = useState(null)     // partner | null — troubleshooting portal view
  const [inviteBusy, setInviteBusy] = useState(null)

  // ONE reusable signup link per company — copied to the clipboard and (when a
  // company email exists) emailed with a short note. Unlimited logins per link.
  const inviteLink = async (p) => {
    setInviteBusy(p.id)
    const who = await getCurrentStaffName().catch(() => null)
    const r = await getOrCreatePartnerInvite(p.id, { createdBy: who })
    setInviteBusy(null)
    if (!r.ok) { flash(r.error || 'Could not create the invite link.'); return }
    try { await navigator.clipboard.writeText(r.url) } catch { /* clipboard optional */ }
    if (p.email) {
      // sendShopEmail reports failure by RESOLVING with {ok:false} — check it,
      // never assume (the launch-day invite "sent" toast lied on a failed send).
      const mail = await sendShopEmail({
        to: p.email,
        subject: `Your Stonebooks Trade portal — ${p.company_name}`,
        html: `<div style="font-family:Arial,sans-serif;font-size:15px;color:#17202a;line-height:1.6">` +
          `<p style="margin:0 0 10px"><b>Welcome to Stonebooks Trade.</b></p>` +
          `<p style="margin:0">Place orders, track design and stone status live, approve layouts, and see invoices — all in one place. ` +
          `Use the link below to create your login. Anyone at ${p.company_name} can use the same link to make their own.</p>` +
          `<p style="margin:18px 0"><a href="${r.url}" style="background:#9A7209;color:#ffffff;padding:11px 24px;border-radius:8px;text-decoration:none;font-weight:700">Create your login →</a></p>` +
          `<p style="margin:0;color:#8a8a85;font-size:12.5px">Stonebooks Trade · Shevchenko Monuments · Perth Amboy, NJ</p></div>`,
        text: `Welcome to Stonebooks Trade. Create your login: ${r.url}`,
      }).catch(e => ({ ok: false, error: e?.message || 'send threw' }))
      if (mail.ok) flash(`Invite emailed to ${p.email} + link copied.`)
      else flash(`Link COPIED (paste it manually) — email failed: ${mail.error}`)
    } else {
      flash('Invite link copied — add a company email to send it from here.')
    }
  }

  return (
    <>
      <div className="vend-filters"><div style={{ flex: 1 }} /><button type="button" className="vend-primary" onClick={() => setEditing('new')}>+ Add partner</button></div>
      <div className="vend-table">
        <div className="vend-row vend-prow vend-row-head"><div>Company</div><div>Contact</div><div>Phone</div><div>Email</div><div>Terms</div><div>Active</div><div /></div>
        {partners.length === 0 ? <div className="vend-empty">No partners yet. Add one to start taking requests.</div>
          : partners.map(p => (
            <div key={p.id} className="vend-row vend-prow">
              <div className="vend-strong">{p.company_name}</div><div>{p.contact_person || '—'}</div><div>{p.phone || '—'}</div>
              <div className="vend-dim">{p.email || '—'}</div><div>{p.payment_terms || '—'}</div><div>{p.active ? 'Yes' : 'No'}</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <button type="button" className="vend-open" onClick={() => setEditing(p)}>Edit</button>
                <button type="button" className="vend-open" disabled={inviteBusy === p.id} onClick={() => inviteLink(p)}
                  title="Copy (and email) the reusable signup link — unlimited logins per company">
                  {inviteBusy === p.id ? '…' : 'Invite link'}
                </button>
                <button type="button" className="vend-open" onClick={() => setViewAs(p)}
                  title="See their portal exactly as they see it (troubleshooting)">View portal</button>
              </div>
            </div>
          ))}
      </div>
      {editing && <PartnerModal partner={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); onReload(); flash('Partner saved.') }} />}
      {viewAs && <ViewAsPartner partner={viewAs} onClose={() => setViewAs(null)} />}
    </>
  )
}

// ── View-as — the dealer's exact portal, rendered under the staff session ─────
// Everything works (staff RLS is a superset), so Paul can reproduce anything a
// dealer reports. The amber bar makes the mode unmistakable.
function ViewAsPartner({ partner, onClose }) {
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1400, background: '#f7f5f0', overflowY: 'auto' }}>
      <div style={{ position: 'sticky', top: 0, zIndex: 10, display: 'flex', alignItems: 'center', gap: 12, background: '#8a5a12', color: '#fff', padding: '9px 16px', fontSize: 13.5, fontWeight: 600 }}>
        <span>Viewing the portal as <b>{partner.company_name}</b> — actions you take here are real and logged as staff.</span>
        <button type="button" onClick={onClose}
          style={{ marginLeft: 'auto', font: 'inherit', fontWeight: 700, background: '#fff', color: '#8a5a12', border: 'none', borderRadius: 8, padding: '6px 14px', cursor: 'pointer' }}>
          ✕ Exit view-as
        </button>
      </div>
      <PartnerPortal context={{ partner, partnerId: partner.id }} onSignOut={onClose} viewAs />
    </div>
  )
}

function PartnerModal({ partner, onClose, onSaved }) {
  const [f, setF] = useState({
    companyName: partner?.company_name || '', contactPerson: partner?.contact_person || '', phone: partner?.phone || '',
    email: partner?.email || '', address: partner?.address || '', paymentTerms: partner?.payment_terms || '',
    notes: partner?.notes || '', active: partner ? !!partner.active : true,
  })
  const [busy, setBusy] = useState(false); const [error, setError] = useState(null)
  const set = (k, v) => setF(s => ({ ...s, [k]: v }))
  const save = async () => {
    if (!f.companyName.trim()) { setError('Enter a company name.'); return }
    setBusy(true); setError(null)
    const res = partner ? await updatePartner(partner.id, f) : await createPartner(f)
    setBusy(false)
    if (!res.ok) { setError(res.error); return }
    onSaved()
  }
  return (
    <div className="vend-backdrop" onClick={() => { if (!busy) onClose() }}>
      <div className="vend-modal" onClick={e => e.stopPropagation()}>
        <h3 className="vend-modal-title">{partner ? 'Edit partner' : 'Add partner'}</h3>
        <label className="vic-field"><span>Company name</span><input className="vic-input" value={f.companyName} onChange={e => set('companyName', e.target.value)} autoFocus /></label>
        <div className="vend-grid2">
          <label className="vic-field"><span>Contact person</span><input className="vic-input" value={f.contactPerson} onChange={e => set('contactPerson', e.target.value)} /></label>
          <label className="vic-field"><span>Phone</span><input className="vic-input" value={f.phone} onChange={e => set('phone', e.target.value)} /></label>
          <label className="vic-field"><span>Email</span><input className="vic-input" value={f.email} onChange={e => set('email', e.target.value)} /></label>
          <label className="vic-field"><span>Payment terms</span><input className="vic-input" value={f.paymentTerms} onChange={e => set('paymentTerms', e.target.value)} placeholder="e.g. Net 30" /></label>
        </div>
        <label className="vic-field"><span>Address</span><input className="vic-input" value={f.address} onChange={e => set('address', e.target.value)} /></label>
        <label className="vend-rush-field"><input type="checkbox" checked={f.active} onChange={e => set('active', e.target.checked)} /> <span>Active</span></label>
        {error && <div className="vend-error">{error}</div>}
        <div className="vend-modal-actions"><button type="button" className="vend-cancel" onClick={onClose} disabled={busy}>Cancel</button><button type="button" className="vend-primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button></div>
        {partner && <PortalInvite partner={partner} defaultEmail={f.email} />}
      </div>
    </div>
  )
}

// Staff invites a partner contact to the external portal. The partner gets an
// email and SETS THEIR OWN password — staff never type partner credentials.
function PortalInvite({ partner, defaultEmail }) {
  const [email, setEmail] = useState(defaultEmail || '')
  const [users, setUsers] = useState([])
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  useEffect(() => {
    let cancelled = false
    listPartnerUsers(partner.id).then(u => { if (!cancelled) setUsers(u) })
    return () => { cancelled = true }
  }, [partner.id])
  const invite = async () => {
    setBusy(true); setMsg(null)
    const res = await invitePartnerUser({ partnerId: partner.id, email })
    setBusy(false)
    if (!res.ok) { setMsg({ kind: 'err', text: res.error }); return }
    setMsg({ kind: 'ok', text: `Invite sent to ${email}. They’ll set their own password.` })
    listPartnerUsers(partner.id).then(setUsers)
  }
  return (
    <div className="vend-invite">
      <div className="vend-invite-title">Portal access</div>
      <p className="vend-invite-sub">Invite this partner to log into the portal and submit their own work. They set their own password from the email.</p>
      <div className="vend-invite-row">
        <input className="vic-input" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="partner contact email" />
        <button type="button" className="vend-primary" onClick={invite} disabled={busy || !email.trim()}>{busy ? 'Sending…' : 'Send invite'}</button>
      </div>
      {msg && <div className={msg.kind === 'err' ? 'vend-error' : 'vend-invite-ok'}>{msg.text}</div>}
      {users.length > 0 && <div className="vend-invite-users">{users.length} portal user{users.length === 1 ? '' : 's'} linked</div>}
    </div>
  )
}

// ── Batches ──────────────────────────────────────────────────────────────────
function BatchesView({ batches, items, partners, onReload, onOpenItem, onGeneratePO, flash }) {
  const [newOpen, setNewOpen] = useState(false)
  const unbatched = items.filter(i => !i.batch_id)
  return (
    <>
      <div className="vend-filters"><div style={{ flex: 1 }} /><button type="button" className="vend-primary" onClick={() => setNewOpen(true)}>+ New batch</button></div>
      {batches.length === 0 ? <div className="vend-empty">No batches yet.</div> : (
        <div className="vend-batches">
          {batches.map(b => {
            const its = items.filter(i => i.batch_id === b.id)
            return (
              <div key={b.id} className="vend-batch">
                <div className="vend-batch-head">
                  <div><div className="vend-strong">{b.name || 'Batch'}</div><div className="vend-dim">{b.partner?.company_name || '—'} · {its.length} item{its.length === 1 ? '' : 's'}</div></div>
                  <div className="vend-batch-actions">
                    <select value={b.status} onChange={async e => { await updateVendorBatch(b.id, { status: e.target.value }); onReload() }}>{['open', 'in_progress', 'ready_for_pickup', 'completed', 'po_sent'].map(s => <option key={s} value={s}>{statusLabel(s)}</option>)}</select>
                    <button type="button" onClick={() => onGeneratePO(b)}>Generate invoice</button>
                  </div>
                </div>
                <div className="vend-batch-items">
                  {its.map(i => <button key={i.id} type="button" className="vend-batch-item" onClick={() => onOpenItem(i.id)}>{i.vendor_reference || statusLabel(i.work_type)} <span className="vend-mini-x" onClick={async (e) => { e.stopPropagation(); await setItemBatch(i.id, null); onReload() }}>remove</span></button>)}
                  <AddToBatch batchId={b.id} unbatched={unbatched.filter(i => !b.partner_id || i.request?.partner_id === b.partner_id)} onAdded={onReload} />
                </div>
              </div>
            )
          })}
        </div>
      )}
      {newOpen && <NewBatchModal partners={partners} onClose={() => setNewOpen(false)} onSaved={() => { setNewOpen(false); onReload(); flash('Batch created.') }} />}
    </>
  )
}
function AddToBatch({ batchId, unbatched, onAdded }) {
  const [v, setV] = useState('')
  return (
    <select className="vend-addbatch" value={v} onChange={async e => { if (e.target.value) { await setItemBatch(e.target.value, batchId); setV(''); onAdded() } }}>
      <option value="">+ Add item…</option>
      {unbatched.map(i => <option key={i.id} value={i.id}>{i.request?.partner?.company_name} · {i.vendor_reference || statusLabel(i.work_type)}</option>)}
    </select>
  )
}
function NewBatchModal({ partners, onClose, onSaved }) {
  const [partnerId, setPartnerId] = useState(partners[0]?.id || '')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false); const [error, setError] = useState(null)
  const save = async () => { setBusy(true); const res = await createVendorBatch({ partnerId: partnerId || null, name }); setBusy(false); if (!res.ok) { setError(res.error); return } onSaved() }
  return (
    <div className="vend-backdrop" onClick={() => { if (!busy) onClose() }}>
      <div className="vend-modal" onClick={e => e.stopPropagation()}>
        <h3 className="vend-modal-title">New batch</h3>
        <label className="vic-field"><span>Partner</span><select className="vic-input" value={partnerId} onChange={e => setPartnerId(e.target.value)}><option value="">Any</option>{partners.map(p => <option key={p.id} value={p.id}>{p.company_name}</option>)}</select></label>
        <label className="vic-field"><span>Batch name</span><input className="vic-input" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Week of Jun 9 setting trip" autoFocus /></label>
        {error && <div className="vend-error">{error}</div>}
        <div className="vend-modal-actions"><button type="button" className="vend-cancel" onClick={onClose} disabled={busy}>Cancel</button><button type="button" className="vend-primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Create'}</button></div>
      </div>
    </div>
  )
}

// ── POs ──────────────────────────────────────────────────────────────────────
function POsView({ pos, partners, onNew, onEdit, onReload, flash }) {
  return (
    <>
      <div className="vend-filters"><div style={{ flex: 1 }} /><button type="button" className="vend-primary" onClick={onNew} disabled={!partners.length}>+ New invoice</button></div>
      <div className="vend-table">
        <div className="vend-row vend-porow vend-row-head"><div>Invoice #</div><div>Partner</div><div>Date</div><div>Amount</div><div>Status</div><div /></div>
        {pos.length === 0 ? <div className="vend-empty">No invoices yet — generate one from an item or a batch.</div>
          : pos.map(po => {
            const lineSum = (po.po_items || []).reduce((s, li) => s + (li.unit_price != null ? Number(li.unit_price) * (Number(li.quantity) || 1) : 0), 0)
            const amt = po.custom_amount != null ? Number(po.custom_amount) : lineSum
            return (
              <div key={po.id} className="vend-row vend-porow">
                <div className="vend-mono vend-strong">{po.po_number}</div><div>{po.partner?.company_name || '—'}</div><div>{po.po_date ? fmtDate(po.po_date) : '—'}</div>
                <div className="vend-mono">{amt > 0 ? `$${amt.toLocaleString('en-US', { minimumFractionDigits: 2 })}` : '—'}</div>
                <div><span className="vend-chip">{statusLabel(po.status)}</span></div>
                <div className="vend-po-actions">
                  <button type="button" onClick={() => onEdit(po)}>✎ Open</button>
                  {po.status === 'draft' && <button type="button" onClick={async () => { await updateVendorPO(po.id, { status: 'sent' }); onReload(); flash('Invoice marked sent.') }}>Send</button>}
                  <button type="button" onClick={() => previewPOPdf(po)}>Preview</button>
                  <button type="button" onClick={() => downloadPOPdf(po)}>⬇ Download</button>
                </div>
              </div>
            )
          })}
      </div>
    </>
  )
}

// Invoice builder — per-line pricing + professional preview. Opens fresh from
// a batch/item OR loads an EXISTING invoice for editing (seed.existing) so
// saved lines are always visible and fixable (Paul, 2026-07-08: typed lines
// looked lost because nothing displayed them after save). Backdrop clicks do
// NOT close it — typed lines are too easy to lose; use Cancel.
function POModal({ seed, partners, onClose, onSaved }) {
  const ex = seed.existing || null
  const [partnerId, setPartnerId] = useState(ex?.partner_id || seed.partnerId || partners[0]?.id || '')
  const [poNumber, setPoNumber] = useState(ex?.po_number || '')
  const [notes, setNotes] = useState(ex?.notes || '')
  const [customAmount, setCustomAmount] = useState(ex?.custom_amount != null ? String(ex.custom_amount) : '')
  const [busy, setBusy] = useState(false); const [error, setError] = useState(null)
  useEffect(() => { if (!ex) nextPONumber().then(setPoNumber) }, [ex])
  const [lines, setLines] = useState(() => ex
    ? (ex.po_items || []).map(li => ({
        itemId: li.item_id || null, description: li.description || '', quantity: li.quantity || 1,
        unitPrice: li.unit_price != null ? String(li.unit_price) : '',
      }))
    : (seed.items || []).map(it => ({
        itemId: it.id,
        description: `${it.vendor_reference || ''} ${it.work_type ? '· ' + statusLabel(it.work_type) : ''}`.trim() || 'Item',
        quantity: 1, unitPrice: '',
      })))
  const setLine = (i, patch) => setLines(arr => arr.map((li, j) => j === i ? { ...li, ...patch } : li))
  const lineSum = lines.reduce((s, li) => s + (li.unitPrice !== '' && li.unitPrice != null ? Number(li.unitPrice) * (Number(li.quantity) || 1) : 0), 0)
  const total = customAmount !== '' ? Number(customAmount) : lineSum
  const toPoObject = () => ({
    po_number: poNumber, po_date: ex?.po_date || new Date().toISOString().slice(0, 10),
    partner: partners.find(p => p.id === partnerId) || ex?.partner || null,
    notes, custom_amount: customAmount !== '' ? Number(customAmount) : null,
    po_items: lines.map(li => ({ description: li.description, quantity: Number(li.quantity) || 1, unit_price: li.unitPrice === '' ? null : Number(li.unitPrice) })),
  })
  const save = async (status) => {
    if (!partnerId) { setError('Pick a partner.'); return }
    setBusy(true); setError(null)
    const res = ex
      ? await updateVendorPO(ex.id, { status, poNumber, notes, customAmount, poItems: lines })
      : await createVendorPO({ partnerId, poNumber, batchId: seed.batchId || null, notes, customAmount, poItems: lines, status })
    setBusy(false)
    if (!res.ok) { setError(res.error); return }
    onSaved()
  }
  return (
    <div className="vend-backdrop">
      <div className="vend-modal" onClick={e => e.stopPropagation()}>
        <h3 className="vend-modal-title">{ex ? `Edit invoice ${ex.po_number || ''}` : 'Generate invoice'}</h3>
        <div className="vend-grid2">
          <label className="vic-field"><span>Partner</span><select className="vic-input" value={partnerId} onChange={e => setPartnerId(e.target.value)}><option value="">Select…</option>{partners.map(p => <option key={p.id} value={p.id}>{p.company_name}</option>)}</select></label>
          <label className="vic-field"><span>PO number</span><input className="vic-input" value={poNumber} onChange={e => setPoNumber(e.target.value)} /></label>
        </div>
        <div className="vend-po-editor">
          <div className="vend-po-erow vend-po-ehead"><div>Description</div><div>Qty</div><div>Price</div><div>Amount</div><div /></div>
          {lines.length === 0 ? <div className="vend-dim" style={{ padding: '8px 0' }}>No line items yet — add one below.</div> : lines.map((li, i) => (
            <div key={i} className="vend-po-erow">
              <input className="vic-input" value={li.description} onChange={e => setLine(i, { description: e.target.value })} />
              <input className="vic-input" type="number" min="1" value={li.quantity} onChange={e => setLine(i, { quantity: e.target.value })} />
              <input className="vic-input" type="number" step="0.01" placeholder="0.00" value={li.unitPrice} onChange={e => setLine(i, { unitPrice: e.target.value })} />
              <div className="vend-po-eamt">{li.unitPrice !== '' ? `$${(Number(li.unitPrice) * (Number(li.quantity) || 1)).toLocaleString('en-US', { minimumFractionDigits: 2 })}` : '—'}</div>
              <button type="button" className="vend-mini-x" onClick={() => setLines(arr => arr.filter((_, j) => j !== i))}>remove</button>
            </div>
          ))}
          <button type="button" className="vend-po-addline" onClick={() => setLines(arr => [...arr, { itemId: null, description: '', quantity: 1, unitPrice: '' }])}>+ Add line</button>
          <div className="vend-po-total">Total <b>${total.toLocaleString('en-US', { minimumFractionDigits: 2 })}</b>{customAmount !== '' && <span className="vend-dim"> (custom override)</span>}</div>
        </div>
        <div className="vend-grid2">
          <label className="vic-field"><span>Custom total override (optional)</span><input className="vic-input" type="number" value={customAmount} onChange={e => setCustomAmount(e.target.value)} placeholder="—" /></label>
        </div>
        <label className="vic-field"><span>Notes</span><textarea className="vic-input" rows={2} value={notes} onChange={e => setNotes(e.target.value)} /></label>
        {error && <div className="vend-error">{error}</div>}
        <div className="vend-modal-actions">
          <button type="button" className="vend-cancel" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className="vend-cancel" onClick={() => previewPOPdf(toPoObject())} disabled={busy}>👁 Preview</button>
          <button type="button" className="vend-cancel" onClick={() => downloadPOPdf(toPoObject())} disabled={busy}>⬇ Download</button>
          {ex ? (
            <>
              {/* Editing keeps the invoice's current status — Save never demotes a sent invoice. */}
              <button type="button" className="vend-primary" onClick={() => save(ex.status)} disabled={busy}>Save changes</button>
              {ex.status === 'draft' && <button type="button" className="vend-primary" onClick={() => save('sent')} disabled={busy}>Save &amp; send</button>}
            </>
          ) : (
            <>
              <button type="button" className="vend-cancel" onClick={() => save('draft')} disabled={busy}>Save draft</button>
              <button type="button" className="vend-primary" onClick={() => save('sent')} disabled={busy}>Save &amp; send</button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// jsPDF is loaded from CDN (not an npm dep) — same loader pattern as SalesMode.
let _jsPDFPromise = null
function loadJsPDF() {
  if (window.jspdf?.jsPDF) return Promise.resolve(window.jspdf.jsPDF)
  if (_jsPDFPromise) return _jsPDFPromise
  _jsPDFPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js'
    s.async = true
    s.onload = () => window.jspdf?.jsPDF ? resolve(window.jspdf.jsPDF) : reject(new Error('jsPDF global missing'))
    s.onerror = () => { _jsPDFPromise = null; reject(new Error('Failed to load jsPDF')) }
    document.head.appendChild(s)
  })
  return _jsPDFPromise
}

// Invoice document — strict black & white per Paul (2026-07-08): solid black
// table header, every other line shaded light gray, heavy rules, bold amounts.
// Shared by download AND preview.
const money = (n) => `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2 })}`
async function buildPOPdf(po) {
  const jsPDF = await loadJsPDF()
  const doc = new jsPDF({ unit: 'mm', format: 'letter' })
  const W = 215.9, M = 16, RIGHT = W - M, TABLE_W = W - M * 2
  const INK = 25, MUTE = 115, ZEBRA = 242

  // ── Letterhead ──────────────────────────────────────────────────────────
  doc.setFont('helvetica', 'bold'); doc.setFontSize(15.5); doc.setTextColor(INK)
  doc.text('SHEVCHENKO MONUMENTS, LLC.', M, 22)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(MUTE)
  doc.text('329 S Florida Grove Rd, Perth Amboy, NJ 08861', M, 27.4)
  doc.text('732-442-1286   ·   shevcoteam@gmail.com', M, 31.6)
  doc.setFont('helvetica', 'bold'); doc.setFontSize(26); doc.setTextColor(INK)
  doc.text('INVOICE', RIGHT, 25, { align: 'right' })
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(70)
  doc.text(`No. ${po.po_number || '—'}`, RIGHT, 31.4, { align: 'right' })
  doc.text(`Date: ${po.po_date || '—'}`, RIGHT, 36.2, { align: 'right' })
  doc.setDrawColor(INK); doc.setLineWidth(0.8); doc.line(M, 41.5, RIGHT, 41.5)

  // ── Bill to ─────────────────────────────────────────────────────────────
  let y = 50
  doc.setFont('helvetica', 'bold'); doc.setFontSize(7.8); doc.setTextColor(MUTE)
  doc.text('BILL TO', M, y)
  doc.setFontSize(11.5); doc.setTextColor(INK)
  doc.text(po.partner?.company_name || '—', M, y + 6)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(80)
  let vy = y + 11
  for (const line of [po.partner?.contact_person, po.partner?.address, [po.partner?.phone, po.partner?.email].filter(Boolean).join('  ·  ')].filter(Boolean)) {
    doc.text(String(line), M, vy); vy += 4.6
  }
  y = Math.max(vy + 7, 72)

  // ── Line-item table — black header bar, zebra rows ──────────────────────
  const colDescX = M + 3, qtyC = 142, priceR = 174, amtR = RIGHT - 3
  const descMaxW = qtyC - colDescX - 12
  const HEAD_H = 8.4
  const tableHead = () => {
    doc.setFillColor(INK); doc.rect(M, y, TABLE_W, HEAD_H, 'F')
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(255)
    const by = y + 5.6
    doc.text('DESCRIPTION', colDescX, by)
    doc.text('QTY', qtyC, by, { align: 'center' })
    doc.text('UNIT PRICE', priceR, by, { align: 'right' })
    doc.text('AMOUNT', amtR, by, { align: 'right' })
    y += HEAD_H
  }
  tableHead()
  let lineSum = 0
  const items = po.po_items || []
  items.forEach((li, idx) => {
    const qty = Number(li.quantity) || 1
    const hasPrice = li.unit_price != null
    const amt = hasPrice ? Number(li.unit_price) * qty : null
    if (hasPrice) lineSum += amt
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5)
    const descLines = doc.splitTextToSize(String(li.description || 'Item'), descMaxW)
    const rowH = Math.max(8.2, descLines.length * 4.4 + 3.8)
    if (y + rowH > 246) { doc.addPage(); y = 20; tableHead(); doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5) }
    if (idx % 2 === 1) { doc.setFillColor(ZEBRA); doc.rect(M, y, TABLE_W, rowH, 'F') }
    const ty = y + 5.5
    doc.setTextColor(INK)
    doc.text(descLines, colDescX, ty)
    doc.text(String(qty), qtyC, ty, { align: 'center' })
    doc.text(hasPrice ? money(li.unit_price) : '—', priceR, ty, { align: 'right' })
    doc.setFont('helvetica', 'bold')
    doc.text(amt != null ? money(amt) : '—', amtR, ty, { align: 'right' })
    y += rowH
  })
  doc.setDrawColor(INK); doc.setLineWidth(0.3); doc.line(M, y, RIGHT, y)

  // ── Total due — custom override wins when set ───────────────────────────
  const total = po.custom_amount != null ? Number(po.custom_amount) : lineSum
  y += 9
  if (y > 238) { doc.addPage(); y = 26 }
  doc.setDrawColor(INK); doc.setLineWidth(0.8); doc.line(134, y, RIGHT, y)
  doc.setFont('helvetica', 'bold'); doc.setFontSize(12.5); doc.setTextColor(INK)
  doc.text('TOTAL DUE', 134, y + 7.6)
  doc.text(money(total), amtR, y + 7.6, { align: 'right' })
  y += 18

  if (po.notes) {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(80)
    doc.text(doc.splitTextToSize(String(po.notes), TABLE_W), M, y)
    y += 10
  }

  // ── Footer ──────────────────────────────────────────────────────────────
  doc.setDrawColor(190); doc.setLineWidth(0.2); doc.line(M, 258, RIGHT, 258)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(MUTE)
  doc.text('Thank you for your business  ·  Shevchenko Monuments, est. 1919', M, 263)
  doc.text('Make checks payable to Shevchenko Monuments, LLC.', RIGHT, 263, { align: 'right' })
  return doc
}
async function downloadPOPdf(po) {
  const doc = await buildPOPdf(po)
  doc.save(`${po.po_number || 'PO'}.pdf`)
}
async function previewPOPdf(po) {
  const doc = await buildPOPdf(po)
  window.open(doc.output('bloburl'), '_blank', 'noopener')
}

const VEND_CSS = `
  .vend-updates { background: #fff; border: 0.5px solid rgba(0,0,0,0.09); border-radius: 12px; overflow: hidden; }
  .vend-update { display: flex; align-items: center; gap: 12px; padding: 11px 16px; border-top: 0.5px solid #f0ede6; }
  .vend-update:first-child { border-top: none; }
  .vend-update.fresh { background: #fdfaf1; }
  .vend-update-dot { width: 9px; height: 9px; border-radius: 50%; flex-shrink: 0; }
  .vend-update-body { flex: 1; min-width: 0; }
  .vend-update-line { font-size: 13.5px; color: #2a2a2a; }
  .vend-update-fam { color: #6a6a62; }
  .vend-update-meta { font-size: 11.5px; color: #a09a8c; margin-top: 1px; }
  .vend-update-actions { display: flex; gap: 8px; flex-shrink: 0; }
  .vend-update-approve { font: inherit; font-size: 12px; font-weight: 700; padding: 6px 12px; border-radius: 8px; border: none; background: #2d7a4f; color: #fff; cursor: pointer; }
  .vend-update-decline { font: inherit; font-size: 12px; font-weight: 700; padding: 6px 12px; border-radius: 8px; border: 0.5px solid #b3261e; background: #fff; color: #b3261e; cursor: pointer; }
  .vend-updates-empty { padding: 40px 16px; text-align: center; color: #8a8a85; font-size: 14px; background: #fff; border: 0.5px solid rgba(0,0,0,0.08); border-radius: 12px; font-style: italic; }
  .vend-head { display: flex; align-items: flex-start; justify-content: space-between; }
  .vend-primary { font: inherit; font-size: 13px; font-weight: 600; padding: 9px 16px; border: 0.5px solid transparent; border-radius: 8px; background: #9A7209; color: #fff; cursor: pointer; white-space: nowrap; }
  .vend-primary:hover:not(:disabled) { filter: brightness(0.95); } .vend-primary:disabled { opacity: 0.5; cursor: not-allowed; }
  .vend-subnav { display: inline-flex; gap: 4px; padding: 4px; background: #f0eeea; border-radius: 999px; margin-bottom: 16px; }
  .vend-subtab { font: inherit; font-size: 13px; padding: 7px 18px; border: none; background: transparent; color: #6b6b66; border-radius: 999px; cursor: pointer; }
  .vend-subtab.on { background: #fff; color: #1e2d3d; font-weight: 600; box-shadow: 0 1px 2px rgba(15,20,25,0.08); }
  .vend-subbadge { display: inline-block; margin-left: 7px; min-width: 17px; height: 17px; padding: 0 5px; border-radius: 999px; background: #9A7209; color: #fff; font-size: 10px; font-weight: 700; line-height: 17px; text-align: center; vertical-align: middle; }
  .vend-newbanner { display: flex; align-items: center; justify-content: space-between; gap: 12px; background: #fdf8ec; border: 0.5px solid #e8d9a8; border-radius: 10px; padding: 11px 16px; margin-bottom: 12px; font-size: 14px; color: #6b5d2f; }
  .vend-newbanner strong { color: #9A7209; font-size: 16px; }
  .vend-newbanner button { font: inherit; font-size: 12px; font-weight: 600; color: #9A7209; background: #fff; border: 0.5px solid #d8c89a; border-radius: 7px; padding: 6px 12px; cursor: pointer; }
  .vend-newpill { display: inline-block; margin-left: 8px; padding: 1px 7px; border-radius: 999px; background: #9A7209; color: #fff; font-size: 9px; font-weight: 700; letter-spacing: 0.04em; vertical-align: middle; }
  .vend-filters { display: flex; gap: 8px; margin-bottom: 12px; flex-wrap: wrap; }
  .vend-filters select { font: inherit; font-size: 13px; padding: 7px 10px; border: 0.5px solid #e6e3dd; border-radius: 8px; background: #fff; }
  .vend-table { background: #fff; border: 0.5px solid #e6e3dd; border-radius: 12px; overflow: hidden; }
  .vend-row { display: grid; grid-template-columns: 1.3fr 90px 100px 130px 130px 100px 100px 70px; gap: 10px; align-items: center; padding: 11px 16px; border-bottom: 0.5px solid #f1efeb; font-size: 13px; }
  .vend-prow { grid-template-columns: 1.4fr 1fr 110px 1.3fr 110px 70px 70px; }
  .vend-porow { grid-template-columns: 130px 1.4fr 110px 70px 100px 120px; }
  .vend-row:last-child { border-bottom: none; }
  .vend-row-head { font-size: 10px; text-transform: uppercase; letter-spacing: 0.1em; color: #8a8a85; font-weight: 600; }
  .vend-strong { font-weight: 600; color: #1e2d3d; }
  .vend-mono { font-family: 'JetBrains Mono', monospace; font-size: 12px; color: #6b6b66; }
  .vend-dim { color: #a0a09a; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .vend-rush { font-size: 9px; font-weight: 700; color: #fff; background: #b54040; padding: 1px 5px; border-radius: 999px; margin-left: 6px; }
  .vend-open { font: inherit; font-size: 12px; font-weight: 600; color: #9A7209; border: 0.5px solid #d8c89a; border-radius: 6px; padding: 4px 12px; background: #fdf8ec; cursor: pointer; }
  .vend-chip { font-size: 11px; font-weight: 600; border: 0.5px solid; border-radius: 999px; padding: 2px 9px; white-space: nowrap; }
  .vend-empty { padding: 28px 16px; text-align: center; color: #8a8a85; font-size: 14px; }

  .vend-backdrop { position: fixed; inset: 0; background: rgba(15,20,25,0.42); z-index: 1100; display: flex; align-items: flex-start; justify-content: center; padding: 24px; overflow-y: auto; }
  .vend-modal { background: #fff; border-radius: 12px; box-shadow: 0 16px 48px rgba(15,20,25,0.24); max-width: 560px; width: 100%; padding: 24px 26px; display: flex; flex-direction: column; gap: 12px; }
  .vend-modal-lg { max-width: 760px; }
  .vend-modal-title { font-size: 18px; font-weight: 600; color: #1e2d3d; margin: 0; }
  .vend-grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .vend-rush-field { flex-direction: row !important; align-items: center; gap: 8px; }
  .vend-items { display: flex; flex-direction: column; gap: 14px; }
  .vend-add-item { font: inherit; font-size: 13px; font-weight: 600; color: #9A7209; background: #fdf8ec; border: 0.5px dashed #d8c89a; border-radius: 8px; padding: 10px; cursor: pointer; }
  .vend-error { color: #b54040; font-size: 13px; padding: 8px 10px; background: #fbe5e5; border-radius: 8px; }
  .vend-modal-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 6px; }
  .vend-cancel { font: inherit; font-size: 14px; font-weight: 500; padding: 9px 18px; border-radius: 8px; border: 0.5px solid #e6e3dd; background: #fff; color: #6b6b66; cursor: pointer; }
  .vend-invite { border-top: 0.5px solid #f1efeb; margin-top: 6px; padding-top: 14px; display: flex; flex-direction: column; gap: 6px; }
  .vend-invite-title { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: #8a8a85; }
  .vend-invite-sub { font-size: 12px; color: #8a8a85; line-height: 1.5; margin: 0; }
  .vend-invite-row { display: flex; gap: 8px; align-items: center; }
  .vend-invite-row .vic-input { flex: 1; }
  .vend-invite-ok { color: #2d6a4f; font-size: 13px; padding: 8px 10px; background: #e8f5ee; border-radius: 8px; }
  .vend-invite-users { font-size: 12px; color: #6b6b66; }

  .vend-drawer-backdrop { position: fixed; inset: 0; background: rgba(15,20,25,0.42); z-index: 1100; display: flex; justify-content: flex-end; }
  .vend-drawer { background: #fff; width: min(620px, 100%); height: 100%; overflow-y: auto; padding: 22px 24px; display: flex; flex-direction: column; gap: 16px; box-shadow: -8px 0 32px rgba(15,20,25,0.16); }
  .vend-drawer-head { display: flex; align-items: flex-start; justify-content: space-between; }
  .vend-drawer-sub { font-size: 12px; color: #8a8a85; }
  .vend-drawer-title { font-size: 20px; font-weight: 700; color: #1e2d3d; margin: 2px 0; }
  .vend-drawer-meta { display: flex; align-items: center; gap: 10px; font-size: 12px; color: #6b6b66; }
  .vend-drawer-close { font: inherit; font-size: 14px; color: #6b6b66; background: none; border: none; cursor: pointer; }
  .vend-actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
  .vend-actions button { font: inherit; font-size: 12px; padding: 6px 12px; border: 0.5px solid #e6e3dd; background: #fff; color: #1e2d3d; border-radius: 7px; cursor: pointer; }
  .vend-actions button:hover { background: #f4f2ee; }
  .vend-act-status { font-size: 12px; color: #6b6b66; display: inline-flex; align-items: center; gap: 6px; }
  .vend-act-status select, .vend-batch-actions select, .vend-addbatch, .vend-act-batch { font: inherit; font-size: 12px; padding: 5px 8px; border: 0.5px solid #e6e3dd; border-radius: 7px; background: #fff; }
  .vend-drawer-section { border-top: 0.5px solid #f1efeb; padding-top: 14px; }
  .vend-sec-head { display: flex; align-items: center; justify-content: space-between; font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: #8a8a85; font-weight: 700; margin-bottom: 10px; }
  .vend-sec-edit { font: inherit; font-size: 12px; color: #9A7209; background: none; border: none; cursor: pointer; text-transform: none; letter-spacing: 0; font-weight: 600; }
  .vend-detail { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 16px; }
  .vend-detail-row.vend-wide, .vend-detail-edit .vend-wide { grid-column: 1 / -1; }
  .vend-detail-row { display: flex; flex-direction: column; gap: 1px; }
  .vend-detail-label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; color: #a0a09a; }
  .vend-detail-val { font-size: 13.5px; color: #1e2d3d; white-space: pre-wrap; }
  .vend-detail-edit { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .vend-filegroup { margin-bottom: 12px; }
  .vend-filegroup-title { font-size: 12px; font-weight: 600; color: #4a4a45; margin-bottom: 5px; }
  .vend-filegroup-list { display: flex; flex-wrap: wrap; gap: 6px; }
  .vend-file { font: inherit; font-size: 12px; color: #1d4ed8; background: #f4f7fd; border: 0.5px solid #d4e0f5; border-radius: 6px; padding: 4px 10px; cursor: pointer; }
  .vend-filegroup-empty { font-size: 12px; }
  .vend-timeline { display: flex; flex-direction: column; gap: 10px; }
  .vend-tl-row { display: flex; gap: 10px; }
  .vend-tl-dot { width: 8px; height: 8px; border-radius: 50%; background: #9A7209; margin-top: 5px; flex: 0 0 auto; }
  .vend-tl-detail { font-size: 13px; color: #1e2d3d; }
  .vend-tl-meta { font-size: 11px; color: #a0a09a; }

  .vend-batches { display: flex; flex-direction: column; gap: 12px; }
  .vend-batch { background: #fff; border: 0.5px solid #e6e3dd; border-radius: 12px; padding: 14px 16px; }
  .vend-batch-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-bottom: 10px; }
  .vend-batch-actions { display: flex; gap: 8px; align-items: center; }
  .vend-batch-actions button { font: inherit; font-size: 12px; padding: 5px 12px; border: 0.5px solid #d8c89a; background: #fdf8ec; color: #9A7209; border-radius: 7px; cursor: pointer; }
  .vend-batch-items { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
  .vend-batch-item { font: inherit; font-size: 12px; padding: 4px 10px; border: 0.5px solid #e6e3dd; background: #faf8f3; border-radius: 7px; cursor: pointer; display: inline-flex; align-items: center; gap: 8px; }
  .vend-mini-x { color: #b54040; font-size: 11px; }
  .vend-toast { position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%); background: #1e2d3d; color: #fff; font-size: 13px; padding: 10px 18px; border-radius: 8px; z-index: 1200; box-shadow: 0 8px 24px rgba(15,20,25,0.24); }
  .vend-po-lines { display: flex; flex-direction: column; gap: 4px; }
  .vend-po-line { display: flex; justify-content: space-between; font-size: 13px; color: #1e2d3d; padding: 4px 0; border-bottom: 0.5px solid #f1efeb; }
  .vend-po-editor { border: 0.5px solid #e6e3dd; border-radius: 10px; padding: 10px 12px; margin: 4px 0 12px; }
  .vend-po-erow { display: grid; grid-template-columns: 1fr 60px 90px 90px 52px; gap: 8px; align-items: center; padding: 4px 0; }
  .vend-po-ehead { font-size: 10px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: #979387; }
  .vend-po-erow .vic-input { padding: 6px 8px; font-size: 13px; }
  .vend-po-eamt { font-size: 13px; text-align: right; font-variant-numeric: tabular-nums; color: #1e2d3d; }
  .vend-po-erow button.vend-mini-x { font: inherit; font-size: 11px; color: #b54040; background: none; border: none; cursor: pointer; text-align: right; }
  .vend-po-addline { font: inherit; font-size: 12.5px; font-weight: 600; color: #9A7209; background: none; border: none; cursor: pointer; padding: 6px 0 2px; }
  .vend-po-total { display: flex; justify-content: flex-end; gap: 10px; align-items: baseline; font-size: 14px; border-top: 0.5px solid #e6e3dd; margin-top: 6px; padding-top: 8px; }
  .vend-po-actions, .vend-batch-actions { display: flex; gap: 6px; }
  .vend-po-actions button { font: inherit; font-size: 12px; padding: 4px 10px; border: 0.5px solid #e6e3dd; background: #fff; border-radius: 6px; cursor: pointer; }
  @media (max-width: 800px) { .vend-grid2 { grid-template-columns: 1fr; } .vend-detail { grid-template-columns: 1fr; } }
`
