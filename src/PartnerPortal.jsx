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
} from './lib/vendorsData'
import VendorItemCard, { VENDOR_ITEM_CARD_CSS } from './components/VendorItemCard'
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

// Stable list-keys for the new-request item cards without touching render purity.
let _keySeq = 1
const nextKey = () => _keySeq++
const blankItem = (workType = 'design') => ({
  workType, vendorReference: '', stoneSize: '', baseSize: '', color: '',
  cemetery: '', deceasedFamilyName: '', itemNotes: '', _files: [], _key: 0,
})

function PartnerStatusChip({ status }) {
  const t = STATUS_TONE[status] || STATUS_TONE.submitted
  return <span className="vp-chip" style={{ background: t.bg, borderColor: t.bd, color: t.fg }}>{PARTNER_STATUS[status] || status}</span>
}

export default function PartnerPortal({ context, onSignOut }) {
  const partner = context?.partner
  const partnerId = context?.partnerId
  const [view, setView] = useState('home')
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

  const openJobs = items.filter(i => OPEN_STATUSES.includes(i.status))
  const ready = items.filter(i => i.status === 'ready_for_pickup')
  const completed = items.filter(i => i.status === 'completed')

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
          <div className="vp-brand-mark">Shevchenko <span>Monuments</span></div>
          <div className="vp-brand-sub">Partner Portal{partner?.company_name ? ` · ${partner.company_name}` : ''}</div>
        </div>
        <button type="button" className="vp-signout" onClick={handleSignOut}>Sign out</button>
      </header>

      <nav className="vp-nav">
        {[
          { code: 'home', label: 'Home' },
          { code: 'new', label: '+ New Request' },
          { code: 'open', label: `Open Jobs${openJobs.length ? ` (${openJobs.length})` : ''}` },
          { code: 'ready', label: `Ready for Pickup${ready.length ? ` (${ready.length})` : ''}` },
          { code: 'completed', label: 'Completed' },
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
            {view === 'new' && (
              <NewRequestForm partnerId={partnerId} partner={partner} onDone={async () => { await loadAll(); setView('open'); flash('Request submitted — thank you.') }} />
            )}
            {view === 'open' && <ItemList title="Open Jobs" empty="No open jobs right now." items={openJobs} onOpenItem={setOpenItem} />}
            {view === 'ready' && <ItemList title="Ready for Pickup" empty="Nothing ready for pickup yet." items={ready} onOpenItem={setOpenItem} />}
            {view === 'completed' && <ItemList title="Completed" empty="No completed jobs yet." items={completed} onOpenItem={setOpenItem} />}
            {view === 'pos' && <POList pos={pos} />}
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
          <div className="vp-hero-sub">Submit work to Shevchenko Monuments and track it through to pickup.</div>
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

function NewRequestForm({ partnerId, partner, onDone }) {
  const [requestName, setRequestName] = useState('')
  const [neededBy, setNeededBy] = useState('')
  const [rush, setRush] = useState(false)
  const [generalNotes, setGeneralNotes] = useState('')
  const [items, setItems] = useState([blankItem('design')])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const setItem = (idx, next) => setItems(arr => arr.map((it, i) => i === idx ? next : it))
  const dupItem = (idx) => setItems(arr => { const c = { ...arr[idx], _files: [...(arr[idx]._files || [])], _key: nextKey() }; const n = [...arr]; n.splice(idx + 1, 0, c); return n })
  const rmItem = (idx) => setItems(arr => arr.filter((_, i) => i !== idx))
  const addItem = () => setItems(arr => [...arr, { ...blankItem('design'), _key: nextKey() }])

  const submit = async () => {
    setBusy(true); setError(null)
    const res = await createVendorRequest({
      partnerId, source: 'partner', requestName, neededBy: neededBy || null, rush, generalNotes,
      createdBy: partner?.contact_person || partner?.company_name || 'Partner',
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
      <div className="vp-section-h">New Request</div>
      <p className="vp-newreq-lede">Tell us what you need. Add one card per stone or item — the notes box on each card is where the detail goes.</p>
      <div className="vp-grid2">
        <label className="vic-field"><span>Request name (optional)</span><input className="vic-input" value={requestName} onChange={e => setRequestName(e.target.value)} placeholder="e.g. Smith — 2 stones" /></label>
        <label className="vic-field"><span>Needed by (optional)</span><input className="vic-input" type="date" value={neededBy} onChange={e => setNeededBy(e.target.value)} /></label>
      </div>
      <label className="vp-rush"><input type="checkbox" checked={rush} onChange={e => setRush(e.target.checked)} /> <span>Rush — needed urgently</span></label>
      <label className="vic-field"><span>General notes (optional)</span><textarea className="vic-input" rows={2} value={generalNotes} onChange={e => setGeneralNotes(e.target.value)} placeholder="Anything that applies to the whole request" /></label>

      <div className="vp-items">
        {items.map((it, idx) => (
          <VendorItemCard key={it._key} item={it} index={idx} onChange={(n) => setItem(idx, n)} onDuplicate={() => dupItem(idx)} onRemove={() => rmItem(idx)} canRemove={items.length > 1} />
        ))}
      </div>
      <button type="button" className="vp-additem" onClick={addItem}>+ Add another item</button>

      {error && <div className="vp-error">{error}</div>}
      <div className="vp-newreq-actions">
        <button type="button" className="vp-primary" onClick={submit} disabled={busy}>{busy ? 'Submitting…' : 'Submit request'}</button>
      </div>
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
          {pos.map(p => (
            <div key={p.id} className="vp-po-row">
              <div className="vp-mono">{p.po_number || '—'}</div>
              <div>{p.po_date ? fmtDate(p.po_date) : '—'}</div>
              <div><span className="vp-chip" style={{ background: p.status === 'sent' ? '#e8f5ee' : '#f4f2ee', borderColor: p.status === 'sent' ? '#7ac4a0' : '#ddd9d2', color: p.status === 'sent' ? '#1f6b46' : '#9a9a92' }}>{p.status === 'sent' ? 'Sent' : 'Draft'}</span></div>
              <div>{p.custom_amount != null ? `$${Number(p.custom_amount).toLocaleString()}` : '—'}</div>
            </div>
          ))}
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
