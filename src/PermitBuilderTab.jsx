// =============================================================================
// Permit Builder — its own top tab (PB-1, 2026-07-21)
// =============================================================================
// "One of the most time consuming parts of the job" (Paul). Three surfaces:
//   HOME      — pick a job and build its permit (template auto-matched by
//               cemetery), manage the template library, resume recent permits.
//   TEMPLATE  — upload the blank cemetery form (image/PDF), place autofill
//               field boxes on it, mark the LAYOUT AREA.
//   DOC       — the actual permit for an order: everything autofilled, every
//               box editable/movable, layout image with pan/zoom crop (front
//               slot or blank back page), dimension arrows, and the money:
//               permit status + filed fees on the SAME rails OrderDetail uses
//               (orders.permit_status / orders.permit[] / outgoing payments).
// =============================================================================
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  listAllOrders, customerName, fmtUSD, properName,
  permitNeeded, PERMIT_STATUS_OPTIONS, permitStatusLabel, permitStatusTone,
  setOrderPermit, createPermitOutgoingPayment, getCurrentStaffName, logOrderActivity,
  listCemeteriesWithPermit, getProofVersionsByOrder, getProofVersions, getJobByOrderId,
} from './lib/stonebooksData'
import {
  listPermitTemplates, getPermitTemplate, createPermitTemplate, updatePermitTemplate,
  listPermitDocs, getPermitDoc, createPermitDoc, updatePermitDoc, deletePermitDoc,
  uploadPermitAsset, rasterizePdfFile, readImageSize,
  AUTOFILL_FIELDS, autofillValue, seedDocData, effectiveBox, exportPermitPdf, fmtPhoneUS,
  missingAutofill, MISSING_ORDER_WRITEBACK, getOrderContext, attachPermitPdfToOrder,
} from './lib/permitBuilder'
import PermitCanvas from './components/permit/PermitCanvas'

const _todayISO = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const rid = () => Math.random().toString(36).slice(2, 9)
const AUTOFILL_LABEL = new Map(AUTOFILL_FIELDS.map(f => [f.key, f.label]))
const clampSize = (v) => Math.min(0.06, Math.max(0.008, v))

// Shared font-size control cluster — steppers + number + a SLIDER (Paul
// 2026-07-22: "easier to change the font size"). `value` is sizePct×1000.
function SizeControls({ value, onDelta, onSet }) {
  return (
    <>
      <button type="button" className="pbt-btn" onClick={() => onDelta(-0.002)}>A−</button>
      <input type="number" className="pbt-input pbt-sizein" min={8} max={60} value={value}
        onChange={e => { const v = Number(e.target.value); if (Number.isFinite(v)) onSet(clampSize(v / 1000)) }} />
      <button type="button" className="pbt-btn" onClick={() => onDelta(0.002)}>A+</button>
      <input type="range" className="pbt-sizeslider" min={8} max={60} step={1} value={value}
        onChange={e => onSet(clampSize(Number(e.target.value) / 1000))} />
    </>
  )
}

export default function PermitBuilderTab({ onOpenOrderDetail }) {
  const [view, setView] = useState({ name: 'home' })
  const [templates, setTemplates] = useState([])
  const [docs, setDocs] = useState([])
  const [orders, setOrders] = useState([])
  const [cemeteries, setCemeteries] = useState([])
  const [confirm, setConfirm] = useState(null)   // { title, body, confirmLabel, onConfirm }
  const [uploadBusy, setUploadBusy] = useState(false)
  const [flash, setFlash] = useState(null)
  const flashTimer = useRef(null)
  const say = (text, err = false) => {
    if (flashTimer.current) clearTimeout(flashTimer.current)
    setFlash({ text, err })
    flashTimer.current = setTimeout(() => setFlash(null), 3500)
  }

  const reloadHome = async () => {
    const [t, d, o, c] = await Promise.all([
      listPermitTemplates(),
      listPermitDocs({ limit: 25 }),
      listAllOrders({ archived: false }),
      listCemeteriesWithPermit().catch(() => []),
    ])
    setTemplates(t); setDocs(d); setOrders(o || []); setCemeteries(c || [])
  }
  useEffect(() => { reloadHome() }, [])

  const openDocForOrder = async (order, template) => {
    const seeded = seedDocData(template, order)
    const r = await createPermitDoc({
      orderId: order.id, templateId: template.id, cemeteryId: order.cemetery_id || null,
      title: template.title, data: seeded,
    })
    if (!r.ok) { say(r.error, true); return }
    setView({ name: 'doc', id: r.doc.id })
  }

  // "Upload a permit and edit over it" (Paul 2026-07-22): a one-off doc that
  // carries its OWN pages (data.pages, no template) — the doc editor's extras/
  // checks/dims/layout then type straight over the uploaded form.
  const uploadDocForOrder = async (order, files) => {
    if (!files?.length || uploadBusy) return
    setUploadBusy(true)
    say('Reading the permit…')
    const created = await createPermitDoc({
      orderId: order.id, templateId: null, cemeteryId: order.cemetery_id || null,
      title: 'Uploaded permit', data: { values: {}, extras: [], layout: null, dims: [], pages: [] },
    })
    if (!created.ok) { setUploadBusy(false); say(created.error, true); return }
    const docId = created.doc.id
    const pages = []
    try {
      for (const file of files) {
        if (/pdf$/i.test(file.type) || /\.pdf$/i.test(file.name)) {
          const rendered = await rasterizePdfFile(file)
          for (const pg of rendered) {
            const up = await uploadPermitAsset(`permit-docs/${docId}`, pg.blob, 'page.png')
            if (up.ok) pages.push({ url: up.url, w: pg.w, h: pg.h })
            else say(up.error, true)
          }
          if (rendered.truncatedFrom) say(`Long document — kept the first ${pages.length} of ${rendered.truncatedFrom} pages.`, true)
        } else {
          const up = await uploadPermitAsset(`permit-docs/${docId}`, file, file.name)
          if (up.ok) {
            const size = await readImageSize(up.url)
            pages.push({ url: up.url, w: size?.w || 1700, h: size?.h || 2200 })
          } else say(up.error, true)
        }
      }
    } catch (e) {
      say(e?.message || 'Upload failed.', true)
    }
    if (pages.length === 0) {
      await deletePermitDoc(docId).catch(() => {})
      setUploadBusy(false)
      say('No usable pages in that file.', true)
      return
    }
    await updatePermitDoc(docId, { values: {}, extras: [], layout: null, dims: [], pages })
    setUploadBusy(false)
    setView({ name: 'doc', id: docId })
  }

  return (
    <div className="pbt-wrap">
      {flash && <div className={`pbt-flash ${flash.err ? 'err' : ''}`}>{flash.text}</div>}
      {view.name === 'home' && (
        <HomeView
          templates={templates} docs={docs} orders={orders} cemeteries={cemeteries}
          uploadBusy={uploadBusy}
          onOpenTemplate={(id) => setView({ name: 'template', id })}
          onOpenDoc={(id) => setView({ name: 'doc', id })}
          onBuild={openDocForOrder}
          onUploadDoc={uploadDocForOrder}
          onCreateTemplate={async (title, cemeteryId) => {
            const r = await createPermitTemplate({ title, cemeteryId })
            if (!r.ok) { say(r.error, true); return }
            setView({ name: 'template', id: r.template.id })
          }}
          onDeleteDoc={(doc) => setConfirm({
            title: 'Delete this permit?',
            body: `${doc.order?.primary_lastname || customerName(doc.order?.customer) || 'This order'} — ${doc.title || doc.template?.title || 'permit'}. The built PDF copy in the order's attachments goes with it. The order itself is untouched.`,
            confirmLabel: 'Delete permit',
            onConfirm: async () => {
              const r = await deletePermitDoc(doc.id)
              setConfirm(null)
              if (!r.ok) { say(r.error, true); return }
              say('Permit deleted.')
              reloadHome()
            },
          })}
          say={say}
        />
      )}
      {view.name === 'template' && (
        <TemplateEditor id={view.id} cemeteries={cemeteries} say={say}
          onBack={() => { setView({ name: 'home' }); reloadHome() }} />
      )}
      {view.name === 'doc' && (
        <DocEditor id={view.id} say={say} onOpenOrderDetail={onOpenOrderDetail}
          onBack={() => { setView({ name: 'home' }); reloadHome() }} />
      )}
      {confirm && (
        <PbtConfirm {...confirm} onCancel={() => setConfirm(null)} />
      )}
    </div>
  )
}

// ── HOME ────────────────────────────────────────────────────────────────────

function HomeView({ templates, docs, orders, cemeteries, uploadBusy, onOpenTemplate, onOpenDoc, onBuild, onUploadDoc, onCreateTemplate, onDeleteDoc, say }) {
  const [q, setQ] = useState('')
  const [newOpen, setNewOpen] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [newCem, setNewCem] = useState('')
  const [pickFor, setPickFor] = useState(null)   // order whose template choice is open
  const upRef = useRef(null)                     // hidden input for per-order Upload
  const upForRef = useRef(null)                  // which order the pick belongs to

  const activeOrders = useMemo(() => (orders || []).filter(o => o && !o.archived), [orders])
  const results = useMemo(() => {
    const norm = q.trim().toLowerCase()
    if (!norm) {
      return activeOrders.filter(o => permitNeeded(o)).slice(0, 12)
    }
    return activeOrders.filter(o => {
      const last = (o.primary_lastname || '').toLowerCase()
      const cust = (customerName(o.customer) || '').toLowerCase()
      const cem = (o.cemetery?.name || '').toLowerCase()
      const num = String(o.order_number || '').toLowerCase()
      return last.includes(norm) || cust.includes(norm) || cem.includes(norm) || num.includes(norm)
    }).slice(0, 14)
  }, [activeOrders, q])

  const templatesFor = (order) => templates.filter(t => t.cemetery_id && order.cemetery_id && t.cemetery_id === order.cemetery_id)

  return (
    <div className="pbt-home">
      <section className="pbt-panel pbt-build">
        <h2 className="pbt-h2">Build a permit</h2>
        <input
          type="text" className="pbt-input" value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="Search any order — last name, cemetery, order number"
        />
        <div className="pbt-hint">{q.trim() ? 'Every order is searchable.' : 'Jobs with a permit in play. Type to search every order.'}</div>
        <div className="pbt-orderlist">
          {results.length === 0 && <div className="pbt-empty">{q.trim() ? 'No orders match.' : 'Nothing needs a permit right now — search to build one anyway.'}</div>}
          {results.map(o => {
            const tpls = templatesFor(o)
            const picking = pickFor === o.id
            return (
              <div key={o.id} className="pbt-orderrow">
                <div className="pbt-orderrow-main">
                  <span className="pbt-orderrow-name">{properName(o.primary_lastname || customerName(o.customer)) || '—'}</span>
                  {o.cemetery?.name && <span className="pbt-orderrow-cem">{o.cemetery.name}</span>}
                  <span className={`pbt-pill pbt-pill-${permitStatusTone(o.permit_status)}`}>{permitStatusLabel(o.permit_status)}</span>
                </div>
                {!picking ? (
                  <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                    <button type="button" className="pbt-btn" disabled={uploadBusy}
                      title="Upload this order's permit file and type over it"
                      onClick={() => { upForRef.current = o; upRef.current?.click() }}>
                      {uploadBusy ? 'Working…' : 'Upload'}
                    </button>
                    <button type="button" className="pbt-btn pbt-btn-gold" onClick={() => {
                      if (tpls.length === 0) { say(`No template for ${o.cemetery?.name || 'this cemetery'} yet — create one on the right, or hit Upload to type over the permit file itself.`, true); return }
                      if (tpls.length === 1) { onBuild(o, tpls[0]); return }
                      setPickFor(o.id)
                    }}>Build</button>
                  </div>
                ) : (
                  <div className="pbt-tplpick">
                    {tpls.map(t => (
                      <button key={t.id} type="button" className="pbt-btn" onClick={() => { setPickFor(null); onBuild(o, t) }}>{t.title}</button>
                    ))}
                    <button type="button" className="pbt-btn pbt-btn-quiet" onClick={() => setPickFor(null)}>Cancel</button>
                  </div>
                )}
              </div>
            )
          })}
        </div>

        <input ref={upRef} type="file" accept="image/*,application/pdf" multiple style={{ display: 'none' }}
          onChange={e => {
            const files = [...e.target.files]
            e.target.value = ''
            const order = upForRef.current
            upForRef.current = null
            if (order && files.length) onUploadDoc(order, files)
          }} />

        <h2 className="pbt-h2" style={{ marginTop: 22 }}>Recent permits</h2>
        <div className="pbt-doclist">
          {docs.length === 0 && <div className="pbt-empty">Built permits show up here to resume or reprint.</div>}
          {docs.map(d => (
            <div key={d.id} className="pbt-docrow">
              <button type="button" className="pbt-docrow-open" onClick={() => onOpenDoc(d.id)}>
                <span className="pbt-orderrow-name">{properName(d.order?.primary_lastname || customerName(d.order?.customer)) || '—'}</span>
                <span className="pbt-orderrow-cem">{d.title || d.template?.title || 'Permit'}</span>
                <span className="pbt-docrow-date">{String(d.updated_at || '').slice(0, 10)}</span>
              </button>
              <button type="button" className="pbt-btn pbt-btn-quiet" onClick={() => onDeleteDoc(d)}>Delete</button>
            </div>
          ))}
        </div>
      </section>

      <section className="pbt-panel">
        <div className="pbt-tpl-head">
          <h2 className="pbt-h2">Cemetery templates</h2>
          <button type="button" className="pbt-btn" onClick={() => setNewOpen(v => !v)}>{newOpen ? 'Close' : '+ New template'}</button>
        </div>
        {newOpen && (
          <div className="pbt-newtpl">
            <input type="text" className="pbt-input" value={newTitle} onChange={e => setNewTitle(e.target.value)} placeholder="Template name — e.g. Cloverleaf permit" />
            <select className="pbt-input" value={newCem} onChange={e => setNewCem(e.target.value)}>
              <option value="">— cemetery (recommended: enables auto-match) —</option>
              {(cemeteries || []).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <button type="button" className="pbt-btn pbt-btn-gold" disabled={!newTitle.trim()}
              onClick={() => { onCreateTemplate(newTitle, newCem || null); setNewOpen(false); setNewTitle(''); setNewCem('') }}>
              Create and set up
            </button>
          </div>
        )}
        <div className="pbt-tplgrid">
          {templates.length === 0 && (
            <div className="pbt-empty">
              Upload each cemetery's blank permit once — after that, building one is a single click from the left.
            </div>
          )}
          {templates.map(t => (
            <button key={t.id} type="button" className="pbt-tplcard" onClick={() => onOpenTemplate(t.id)}>
              <span className="pbt-tplcard-title">{t.title}</span>
              <span className="pbt-tplcard-sub">{t.cemetery?.name || 'No cemetery bound'}</span>
              <span className="pbt-tplcard-meta">{(t.pages || []).length} page{(t.pages || []).length === 1 ? '' : 's'} · {(t.fields || []).length} fields{t.layout_slot ? ' · layout area' : ''}</span>
            </button>
          ))}
        </div>
      </section>
    </div>
  )
}

// ── TEMPLATE EDITOR ─────────────────────────────────────────────────────────

function TemplateEditor({ id, cemeteries, say, onBack }) {
  const [tpl, setTpl] = useState(null)
  const [pages, setPages] = useState([])
  const [fields, setFields] = useState([])
  const [slot, setSlot] = useState(null)
  const [title, setTitle] = useState('')
  const [cemId, setCemId] = useState('')
  const [page, setPage] = useState(0)
  const [sel, setSel] = useState(null)
  const [selAll, setSelAll] = useState(false)   // one size for every box at once
  const [slotSel, setSlotSel] = useState(false)
  const [busy, setBusy] = useState(false)
  const [delOpen, setDelOpen] = useState(false)
  const fileRef = useRef(null)

  useEffect(() => {
    getPermitTemplate(id).then(t => {
      if (!t) { say('Template not found.', true); onBack(); return }
      setTpl(t); setPages(t.pages || []); setFields(t.fields || [])
      setSlot(t.layout_slot || null); setTitle(t.title || ''); setCemId(t.cemetery_id || '')
    })
  }, [id])   // eslint-disable-line react-hooks/exhaustive-deps

  // Re-uploading the ORIGINAL 2-page PDF into a template that already has a
  // perfected page 1 must not duplicate that page (Paul 2026-07-27: "do not
  // touch the first page because i spent a lot of time fixing those"). When
  // the template already has pages, the rendered pages go to a picker with
  // the ones he already has pre-UNchecked; only what he confirms is appended.
  const [pagePick, setPagePick] = useState(null)   // { rendered, file }

  const appendRendered = async (chosen) => {
    setBusy(true)
    try {
      const next = [...pages]
      for (const pg of chosen) {
        const up = await uploadPermitAsset(`permit-templates/${id}`, pg.blob, 'page.png')
        if (up.ok) next.push({ url: up.url, w: pg.w, h: pg.h })
        else say(up.error, true)
      }
      setPages(next)
      setPage(Math.max(0, next.length - 1))
      say(`Added ${chosen.length} page${chosen.length === 1 ? '' : 's'} — page 1 untouched.`)
    } catch (e) { say(e?.message || 'Upload failed.', true) }
    setBusy(false)
    setPagePick(null)
  }

  const onFiles = async (files) => {
    if (!files?.length) return
    setBusy(true)
    try {
      const next = [...pages]
      for (const file of files) {
        if (/pdf$/i.test(file.type) || /\.pdf$/i.test(file.name)) {
          const rendered = await rasterizePdfFile(file)
          // Template already built → let him choose which pages to append.
          if (pages.length > 0 && rendered.length > 1) {
            setBusy(false)
            setPagePick({ rendered, name: file.name })
            return
          }
          for (const pg of rendered) {
            const up = await uploadPermitAsset(`permit-templates/${id}`, pg.blob, 'page.png')
            if (up.ok) next.push({ url: up.url, w: pg.w, h: pg.h })
            else say(up.error, true)
          }
        } else {
          const up = await uploadPermitAsset(`permit-templates/${id}`, file, file.name)
          if (up.ok) {
            const size = await readImageSize(up.url)
            next.push({ url: up.url, w: size?.w || 1700, h: size?.h || 2200 })
          } else say(up.error, true)
        }
      }
      setPages(next)
      setPage(Math.max(0, next.length - 1))
    } catch (e) {
      say(e?.message || 'Upload failed.', true)
    }
    setBusy(false)
  }

  const selField = fields.find(f => f.id === sel) || null
  const patchField = (fid, patch) => setFields(prev => prev.map(f => f.id === fid ? { ...f, ...patch } : f))
  // "All boxes" sizing — every text/fixed box on every page (checks size by w/h).
  const sizeAllFields = (fn) => setFields(prev =>
    prev.map(f => f.kind === 'check' ? f : ({ ...f, sizePct: clampSize(fn(f.sizePct || 0.016)) })))
  const allSizeValue = Math.round(((fields.find(f => (f.kind || 'text') !== 'check')?.sizePct) || 0.016) * 1000)

  // PB-3: three field kinds — autofill text, fixed text (never changes),
  // and checkmark spots (click toggles on the permit).
  const addField = (kind = 'text') => {
    const f = kind === 'check'
      ? { id: rid(), key: 'custom', kind: 'check', mark: 'check', on: false, page, x: 0.08, y: 0.08, w: 0.02, h: 0.014, sizePct: 0.016 }
      : kind === 'fixed'
        ? { id: rid(), key: 'custom', kind: 'fixed', text: '', page, x: 0.08, y: 0.08, w: 0.28, h: 0.028, sizePct: 0.016, align: 'left', bold: false }
        : { id: rid(), key: 'custom', page, x: 0.08, y: 0.08, w: 0.28, h: 0.028, sizePct: 0.016, align: 'left', bold: false }
    setFields(prev => [...prev, f])
    setSel(f.id)
  }
  const duplicateField = () => {
    const f = fields.find(x => x.id === sel)
    if (!f) return
    const copy = { ...f, id: rid(), x: Math.min(0.95, f.x + 0.02), y: Math.min(0.95, f.y + 0.02) }
    setFields(prev => [...prev, copy])
    setSel(copy.id)
  }
  const removePage = () => {
    if (!window.confirm(`Remove page ${page + 1}? Its fields go with it.`)) return
    setPages(prev => prev.filter((_, i) => i !== page))
    setFields(prev => prev.filter(f => f.page !== page).map(f => f.page > page ? { ...f, page: f.page - 1 } : f))
    if (slot?.page === page) setSlot(null)
    setPage(p => Math.max(0, p - 1))
  }

  const save = async () => {
    setBusy(true)
    const r = await updatePermitTemplate(id, { title, cemeteryId: cemId || null, pages, fields, layoutSlot: slot })
    setBusy(false)
    if (!r.ok) { say(r.error, true); return }
    say('Template saved.')
  }

  if (!tpl) return <div className="pbt-empty" style={{ padding: 30 }}>Loading…</div>

  return (
    <div className="pbt-editor">
      <header className="pbt-edhead">
        <button type="button" className="pbt-btn pbt-btn-quiet" onClick={onBack}>← Back</button>
        <input type="text" className="pbt-input pbt-edtitle" value={title} onChange={e => setTitle(e.target.value)} />
        <select className="pbt-input" style={{ maxWidth: 220 }} value={cemId} onChange={e => setCemId(e.target.value)}>
          <option value="">— cemetery —</option>
          {(cemeteries || []).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <div className="pbt-edhead-spacer" />
        <button type="button" className="pbt-btn pbt-btn-danger-quiet" onClick={() => setDelOpen(true)} disabled={busy}>Delete</button>
        <button type="button" className="pbt-btn pbt-btn-gold" onClick={save} disabled={busy}>{busy ? 'Working…' : 'Save template'}</button>
      </header>

      {delOpen && (
        <PbtConfirm
          title="Remove this template from the library?"
          body={`"${title || 'Untitled permit'}" comes off the template list and Build stops offering it. Permits already built with it keep working, and uploading the blank again brings it back as a fresh template.`}
          confirmLabel="Remove template"
          onCancel={() => setDelOpen(false)}
          onConfirm={async () => {
            const r = await updatePermitTemplate(id, { archived: true })
            if (!r.ok) { say(r.error, true); setDelOpen(false); return }
            say('Template removed.')
            onBack()
          }}
        />
      )}

      <div className="pbt-edbar">
        {pages.map((_, i) => (
          <button key={i} type="button" className={`pbt-pagetab ${i === page ? 'on' : ''}`} onClick={() => { setPage(i); setSel(null) }}>Page {i + 1}</button>
        ))}
        <button type="button" className="pbt-btn" onClick={() => fileRef.current?.click()} disabled={busy}>{pages.length ? '+ Add page' : 'Upload the blank permit'}</button>
        {pages.length > 0 && <button type="button" className="pbt-btn pbt-btn-quiet" onClick={removePage}>Remove page</button>}
        <input ref={fileRef} type="file" accept="image/*,application/pdf" multiple style={{ display: 'none' }}
          onChange={e => { onFiles([...e.target.files]); e.target.value = '' }} />
        <div className="pbt-edhead-spacer" />
        {pages.length > 0 && (
          <>
            <button type="button" className="pbt-btn" onClick={() => addField('text')}>+ Field box</button>
            <button type="button" className="pbt-btn" onClick={() => addField('fixed')}>+ Fixed text</button>
            <button type="button" className="pbt-btn" onClick={() => addField('check')}>+ Checkmark</button>
            <button type="button" className="pbt-btn" onClick={() => {
              if (slot?.page === page) { setSlot(null); setSlotSel(false) }
              else { setSlot({ page, x: 0.1, y: 0.55, w: 0.8, h: 0.33 }); setSlotSel(true) }
            }}>{slot?.page === page ? 'Remove layout area' : '+ Layout area'}</button>
            {fields.length > 0 && (
              <button type="button" className={`pbt-btn ${selAll ? 'pbt-btn-on' : ''}`}
                onClick={() => { setSelAll(v => !v); setSel(null) }}>
                All boxes
              </button>
            )}
          </>
        )}
      </div>

      {selAll && !selField && (
        <div className="pbt-toolbar">
          <span className="pbt-tool-label">All boxes — one font size everywhere</span>
          <SizeControls value={allSizeValue}
            onDelta={(d) => sizeAllFields(s => s + d)}
            onSet={(v) => sizeAllFields(() => v)} />
          <span className="pbt-hint" style={{ marginTop: 0 }}>Every text box on every page. Click a box to size just that one.</span>
        </div>
      )}

      {selField && (
        <div className="pbt-toolbar">
          {(selField.kind || 'text') === 'text' && (
            <select className="pbt-input" style={{ maxWidth: 230 }} value={selField.key}
              onChange={e => patchField(selField.id, { key: e.target.value })}>
              {AUTOFILL_FIELDS.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
            </select>
          )}
          {selField.kind === 'fixed' && <span className="pbt-tool-label">Fixed text — double-click the box to type</span>}
          {selField.kind === 'check' ? (
            <>
              <button type="button" className={`pbt-btn ${(selField.mark || 'check') === 'check' ? 'pbt-btn-on' : ''}`} onClick={() => patchField(selField.id, { mark: 'check' })}>Checkmark</button>
              <button type="button" className={`pbt-btn ${selField.mark === 'x' ? 'pbt-btn-on' : ''}`} onClick={() => patchField(selField.id, { mark: 'x' })}>X</button>
              <button type="button" className={`pbt-btn ${selField.on ? 'pbt-btn-on' : ''}`} onClick={() => patchField(selField.id, { on: !selField.on })}>Starts checked</button>
            </>
          ) : (
            <>
              <SizeControls value={Math.round((selField.sizePct || 0.016) * 1000)}
                onDelta={(d) => patchField(selField.id, { sizePct: clampSize((selField.sizePct || 0.016) + d) })}
                onSet={(v) => patchField(selField.id, { sizePct: v })} />
              <button type="button" className={`pbt-btn ${selField.align === 'center' ? 'pbt-btn-on' : ''}`} onClick={() => patchField(selField.id, { align: selField.align === 'center' ? 'left' : 'center' })}>Center</button>
              <button type="button" className={`pbt-btn ${selField.bold ? 'pbt-btn-on' : ''}`} onClick={() => patchField(selField.id, { bold: !selField.bold })}>Bold</button>
            </>
          )}
          <button type="button" className="pbt-btn" onClick={duplicateField}>Duplicate</button>
          <button type="button" className="pbt-btn pbt-btn-quiet" onClick={() => { setFields(prev => prev.filter(f => f.id !== sel)); setSel(null) }}>Delete box</button>
          <span className="pbt-hint" style={{ marginTop: 0 }}>Arrow keys nudge, Shift+arrows jump</span>
        </div>
      )}

      {pages.length === 0 ? (
        <button type="button" className="pbt-dropzone" onClick={() => fileRef.current?.click()} disabled={busy}>
          {busy ? 'Reading the form…' : 'Upload the blank cemetery permit — image or PDF. Pages become the canvas; then drop field boxes where the info goes.'}
        </button>
      ) : (
        <div className="pbt-canvaswrap">
          <PermitCanvas
            page={pages[page]}
            boxes={fields.filter(f => f.page === page).map(f => ({
              ...f, kind: f.kind || 'text',
              text: f.kind === 'fixed' ? (f.text || '') : '',
              on: !!f.on,   // template shows the DEFAULT state; click or "Starts checked" toggles
              mark: f.mark || 'check', hidden: false,
            }))}
            selectedId={sel}
            onSelect={(v) => { setSel(v); if (v) setSelAll(false) }}
            onBoxPatch={patchField}
            slot={slot?.page === page ? slot : null}
            slotSelected={slotSel}
            onSelectSlot={setSlotSel}
            onSlotPatch={(s) => setSlot({ ...s, page })}
            templateMode
            labelFor={(b) => AUTOFILL_LABEL.get(b.key) || b.key}
            allSelected={selAll}
          />
        </div>
      )}

      {pagePick && (
        <PagePickModal
          rendered={pagePick.rendered}
          fileName={pagePick.name}
          haveCount={pages.length}
          busy={busy}
          onCancel={() => setPagePick(null)}
          onAdd={appendRendered}
        />
      )}
    </div>
  )
}

// This template already has pages Paul spent time getting right. When he
// re-uploads the ORIGINAL multi-page PDF to recover a missing back page, the
// pages he already has come in UNCHECKED so re-adding page 1 takes a
// deliberate click. Blank back pages are shown and addable — that is the
// whole point of the re-upload.
function PagePickModal({ rendered, fileName, haveCount, busy, onCancel, onAdd }) {
  const [pick, setPick] = useState(() => rendered.map((_, i) => i >= haveCount))
  const thumbs = useMemo(() => rendered.map(p => URL.createObjectURL(p.blob)), [rendered])
  useEffect(() => () => thumbs.forEach(u => URL.revokeObjectURL(u)), [thumbs])

  const chosen = rendered.filter((_, i) => pick[i])

  return (
    <div className="pbt-scrim" onClick={onCancel}>
      <div className="pbt-modal" onClick={e => e.stopPropagation()}>
        <h3 className="pbt-h2">Which pages should be added?</h3>
        <p className="pbt-hint" style={{ marginTop: 0 }}>
          {fileName} has {rendered.length} pages. This template already has {haveCount}
          {haveCount === 1 ? ' page' : ' pages'} — those are unchecked so nothing you already
          set up gets touched. Checked pages are ADDED to the end.
        </p>
        <div className="pbt-srcgrid">
          {rendered.map((pg, i) => (
            <button
              key={i}
              type="button"
              className="pbt-srccard"
              style={{ outline: pick[i] ? '2px solid var(--sb-gold, #b8963f)' : 'none' }}
              onClick={() => setPick(prev => prev.map((v, n) => (n === i ? !v : v)))}
            >
              {thumbs[i] && <img src={thumbs[i]} alt="" />}
              <span>
                {pick[i] ? 'ADD — ' : 'skip — '}page {pg.pageNo}
                {pg.blank ? ' (blank)' : ''}
              </span>
            </button>
          ))}
        </div>
        <div className="pbt-modal-actions">
          <button type="button" className="pbt-btn pbt-btn-quiet" onClick={onCancel} disabled={busy}>Cancel</button>
          <button type="button" className="pbt-btn" onClick={() => onAdd(chosen)} disabled={busy || chosen.length === 0}>
            {busy ? 'Adding…' : `Add ${chosen.length} page${chosen.length === 1 ? '' : 's'}`}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── DOC EDITOR ──────────────────────────────────────────────────────────────

function DocEditor({ id, say, onBack, onOpenOrderDetail }) {
  const [doc, setDoc] = useState(null)
  const [data, setData] = useState(null)
  const [page, setPage] = useState(0)          // number | 'back'
  const [sel, setSel] = useState(null)
  const [selAll, setSelAll] = useState(false)  // one size for every box at once
  const [selDim, setSelDim] = useState(null)
  const [laySel, setLaySel] = useState(false)
  const [busy, setBusy] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [sources, setSources] = useState(null)
  const [delOpen, setDelOpen] = useState(false)
  const layFileRef = useRef(null)
  const pageFileRef = useRef(null)

  const [ctx, setCtx] = useState(null)   // { attachments, emails } for the rail
  const load = async () => {
    const d = await getPermitDoc(id)
    if (!d) { say('Permit not found.', true); onBack(); return }
    setDoc(d)
    setData(prev => prev || d.data || { values: {}, extras: [], layout: null, dims: [] })
    getOrderContext(d.order?.id, d.order?.customer?.id).then(setCtx).catch(() => setCtx({ attachments: [], emails: [] }))
  }
  useEffect(() => { load() }, [id])   // eslint-disable-line react-hooks/exhaustive-deps

  // Layout sources load eagerly now — the rail shows the thumbnails and the
  // Insert-layout picker reuses them.
  useEffect(() => {
    if (!doc?.order?.id || sources) return
    ;(async () => {
      const [byOrder, job] = await Promise.all([
        getProofVersionsByOrder(doc.order.id).catch(() => []),
        getJobByOrderId(doc.order.id).catch(() => null),
      ])
      const byJob = job?.id ? await getProofVersions(job.id).catch(() => []) : []
      const seen = new Set()
      const list = []
      for (const v of [...(byOrder || []), ...(byJob || [])]) {
        const url = v?.layout_image_url
        if (!url || seen.has(url)) continue
        seen.add(url)
        list.push({ url, label: `Layout v${v.version_number ?? ''}`.trim() })
      }
      setSources(list)
    })()
  }, [doc, sources])   // eslint-disable-line react-hooks/exhaustive-deps

  const template = doc?.template
  const order = doc?.order
  // Uploaded one-off permits carry their OWN pages in data.pages (no template);
  // template docs keep reading the template's. Fields only ever come from a
  // template — an uploaded permit is typed over with extras/checks/dims.
  const ownPages = Array.isArray(data?.pages) && data.pages.length > 0
  const pages = ownPages ? data.pages : (template?.pages || [])
  const fields = template?.fields || []
  const layout = data?.layout || null
  const hasBack = layout?.frame?.page === 'back' || (data?.extras || []).some(e => e.page === 'back') || (data?.dims || []).some(d => d.page === 'back')

  // ── box plumbing: template fields (with overrides) + ad-hoc extras ────────
  const fieldIds = useMemo(() => new Set(fields.map(f => f.id)), [fields])
  const boxesForPage = (pg) => {
    const out = []
    for (const f of fields.filter(f => f.page === pg)) out.push(effectiveBox(f, data?.values?.[f.id]))
    for (const ex of (data?.extras || []).filter(e => e.page === pg)) out.push({ ...ex, hidden: false })
    return out
  }
  const patchBox = (bid, patch) => {
    setData(prev => {
      if (fieldIds.has(bid)) {
        return { ...prev, values: { ...prev.values, [bid]: { ...(prev.values?.[bid] || {}), ...patch } } }
      }
      return { ...prev, extras: (prev.extras || []).map(e => e.id === bid ? { ...e, ...patch } : e) }
    })
  }
  const selBox = sel
    ? (fieldIds.has(sel)
        ? effectiveBox(fields.find(f => f.id === sel), data?.values?.[sel])
        : (data?.extras || []).find(e => e.id === sel) || null)
    : null
  const selIsField = sel ? fieldIds.has(sel) : false

  // "All boxes" sizing — template-field overrides + extras together (checks
  // size by their w/h, skipped).
  const sizeAllBoxes = (fn) => {
    setData(prev => {
      const values = { ...(prev.values || {}) }
      for (const f of fields) {
        if ((f.kind || 'text') === 'check') continue
        const cur = effectiveBox(f, values[f.id]).sizePct || 0.016
        values[f.id] = { ...(values[f.id] || {}), sizePct: clampSize(fn(cur)) }
      }
      const extras = (prev.extras || []).map(ex =>
        ex.kind === 'check' ? ex : ({ ...ex, sizePct: clampSize(fn(ex.sizePct || 0.016)) }))
      return { ...prev, values, extras }
    })
  }
  const allSizeValue = (() => {
    const f = fields.find(x => (x.kind || 'text') !== 'check')
    const cur = f ? (effectiveBox(f, data?.values?.[f.id]).sizePct || 0.016)
      : ((data?.extras || []).find(e => e.kind !== 'check')?.sizePct || 0.016)
    return Math.round(cur * 1000)
  })()

  const addText = () => {
    const ex = { id: `x-${rid()}`, page, text: 'Text', x: 0.08, y: 0.08, w: 0.3, h: 0.028, sizePct: 0.016, align: 'left', bold: false }
    setData(prev => ({ ...prev, extras: [...(prev.extras || []), ex] }))
    setSel(ex.id)
  }
  const addCheck = () => {
    const ex = { id: `x-${rid()}`, kind: 'check', mark: 'check', on: true, page, x: 0.08, y: 0.08, w: 0.02, h: 0.014, sizePct: 0.016 }
    setData(prev => ({ ...prev, extras: [...(prev.extras || []), ex] }))
    setSel(ex.id)
  }
  const duplicateSel = () => {
    if (!selBox) return
    const ex = { ...selBox, id: `x-${rid()}`, page, x: Math.min(0.95, selBox.x + 0.02), y: Math.min(0.95, selBox.y + 0.02) }
    delete ex.hidden
    setData(prev => ({ ...prev, extras: [...(prev.extras || []), ex] }))
    setSel(ex.id)
  }

  // PB-3 — "ask me for the info that you dont have": template fields that are
  // order-bound but resolved empty. Filling one writes every box bound to the
  // same key; plot fields also write BACK to the order.
  const missing = useMemo(
    () => (template && data) ? missingAutofill(template, data.values) : [],
    [template, data],
  )
  const [missDraft, setMissDraft] = useState({})
  const [missBusy, setMissBusy] = useState(false)
  const [missHidden, setMissHidden] = useState(false)
  const fillMissing = async (m) => {
    const v = (missDraft[m.key] || '').trim()
    if (!v) return
    setData(prev => {
      const values = { ...prev.values }
      for (const f of fields.filter(f => f.key === m.key)) values[f.id] = { ...(values[f.id] || {}), text: v }
      return { ...prev, values }
    })
    setMissDraft(prev => ({ ...prev, [m.key]: '' }))
    if (MISSING_ORDER_WRITEBACK[m.key] && order?.id) {
      setMissBusy(true)
      await setOrderPermit(order.id, { [MISSING_ORDER_WRITEBACK[m.key]]: v })
      setMissBusy(false)
    }
  }
  // Custom text boxes fill from the SAME top panel (Paul 2026-07-22): numbered
  // "Custom text 1..N" reading top-to-bottom, left-to-right across the pages.
  // The number lives ONLY here — the canvas never shows it. Numbering runs over
  // ALL custom boxes (stable as you fill); only the still-empty ones list.
  const customPending = useMemo(() => {
    if (!template || !data) return []
    const all = fields
      .filter(f => (f.kind || 'text') === 'text' && f.key === 'custom')
      .sort((a, b) => (a.page - b.page) || (a.y - b.y) || (a.x - b.x))
    return all.map((f, i) => ({ f, n: i + 1 }))
      .filter(({ f }) => !String(data.values?.[f.id]?.text ?? '').trim())
  }, [template, data, fields])
  const fillCustom = (f) => {
    const v = (missDraft[`c:${f.id}`] || '').trim()
    if (!v) return
    setData(prev => ({ ...prev, values: { ...prev.values, [f.id]: { ...(prev.values?.[f.id] || {}), text: v } } }))
    setMissDraft(prev => ({ ...prev, [`c:${f.id}`]: '' }))
  }

  // ── layout ────────────────────────────────────────────────────────────────
  const placeLayout = async (src) => {
    const size = await readImageSize(src)
    if (!size) { say('Could not read that image.', true); return }
    const slotDef = template?.layout_slot
    const frame = slotDef
      ? { page: slotDef.page, x: slotDef.x, y: slotDef.y, w: slotDef.w, h: slotDef.h }
      : { page: typeof page === 'number' ? page : 0, x: 0.1, y: 0.55, w: 0.8, h: 0.3 }
    setData(prev => ({ ...prev, layout: { mode: 'front', src, iw: size.w, ih: size.h, frame, img: { scale: 1, ox: 0, oy: 0 } } }))
    setPage(frame.page)
    setLaySel(true)
    setPickerOpen(false)
  }
  const openPicker = async () => {
    setPickerOpen(true)
    if (sources) return
    const [byOrder, job] = await Promise.all([
      getProofVersionsByOrder(order.id).catch(() => []),
      getJobByOrderId(order.id).catch(() => null),
    ])
    const byJob = job?.id ? await getProofVersions(job.id).catch(() => []) : []
    const seen = new Set()
    const list = []
    for (const v of [...(byOrder || []), ...(byJob || [])]) {
      const url = v?.layout_image_url
      if (!url || seen.has(url)) continue
      seen.add(url)
      list.push({ url, label: `Layout v${v.version_number ?? ''}`.trim() })
    }
    setSources(list)
  }
  const layoutToBack = () => {
    setData(prev => ({
      ...prev,
      layout: { ...prev.layout, mode: 'back', frame: { page: 'back', x: 0.08, y: 0.08, w: 0.84, h: 0.8 } },
    }))
    setPage('back')
  }
  const layoutToFront = () => {
    const slotDef = template?.layout_slot
    const frame = slotDef
      ? { page: slotDef.page, x: slotDef.x, y: slotDef.y, w: slotDef.w, h: slotDef.h }
      : { page: 0, x: 0.1, y: 0.55, w: 0.8, h: 0.3 }
    setData(prev => ({ ...prev, layout: { ...prev.layout, mode: 'front', frame } }))
    setPage(frame.page)
  }

  // ── dimensions ────────────────────────────────────────────────────────────
  const addDim = () => {
    const d = { id: `d-${rid()}`, page, x1: 0.3, y1: 0.35, x2: 0.7, y2: 0.35, label: '' }
    setData(prev => ({ ...prev, dims: [...(prev.dims || []), d] }))
    setSelDim(d.id)
    setSel(null); setLaySel(false)
  }
  const selDimObj = (data?.dims || []).find(d => d.id === selDim) || null
  const patchDim = (did, patch) => setData(prev => ({ ...prev, dims: (prev.dims || []).map(d => d.id === did ? { ...d, ...patch } : d) }))

  // ── save / export ─────────────────────────────────────────────────────────
  const save = async () => {
    setBusy(true)
    const r = await updatePermitDoc(id, data)
    setBusy(false)
    if (!r.ok) { say(r.error, true); return }
    say('Permit saved.')
  }
  // Every built PDF also lands in the order's attachments (upsert — a rebuild
  // replaces the previous copy of this same permit, no duplicate stacking).
  const attachBuiltPdf = async (d) => {
    if (!doc?.order_id && !doc?.order?.id) return
    try {
      const staff = await getCurrentStaffName()
      const r = await attachPermitPdfToOrder(doc, d.output('blob'), staff)
      if (r.ok) say('Saved to the order’s attachments too.')
    } catch { /* the download/print itself already succeeded */ }
  }
  // Export sees one template shape whether the pages are the template's or the
  // doc's own upload.
  const exportTemplate = () => ({ ...(template || {}), pages, fields })
  const download = async () => {
    setBusy(true)
    try {
      await save()
      const fam = (order?.primary_lastname || customerName(order?.customer) || 'permit').replace(/[^\w-]+/g, '_')
      const d = await exportPermitPdf({ template: exportTemplate(), docData: data, returnDoc: true })
      d.save(`${fam}-${(doc.title || 'permit').replace(/[^\w-]+/g, '_')}.pdf`)
      await attachBuiltPdf(d)
    } catch (e) {
      say(e?.message || 'PDF export failed.', true)
    }
    setBusy(false)
  }
  // Print — same PDF, opened in the browser's viewer so the print dialog is
  // one keystroke away (no download shuffle).
  const printPdf = async () => {
    setBusy(true)
    try {
      await save()
      const d = await exportPermitPdf({ template: exportTemplate(), docData: data, returnDoc: true })
      window.open(d.output('bloburl'), '_blank')
      await attachBuiltPdf(d)
    } catch (e) {
      say(e?.message || 'Could not open the print view.', true)
    }
    setBusy(false)
  }
  // Uploaded permits can grow pages after the fact (page 2 arrives, the map
  // sheet, the county's addendum) — same rasterize path as the first upload.
  const addPages = async (files) => {
    if (!files?.length) return
    setBusy(true)
    try {
      const next = [...(data?.pages || [])]
      for (const file of files) {
        if (/pdf$/i.test(file.type) || /\.pdf$/i.test(file.name)) {
          const rendered = await rasterizePdfFile(file)
          for (const pg of rendered) {
            const up = await uploadPermitAsset(`permit-docs/${id}`, pg.blob, 'page.png')
            if (up.ok) next.push({ url: up.url, w: pg.w, h: pg.h })
            else say(up.error, true)
          }
        } else {
          const up = await uploadPermitAsset(`permit-docs/${id}`, file, file.name)
          if (up.ok) {
            const size = await readImageSize(up.url)
            next.push({ url: up.url, w: size?.w || 1700, h: size?.h || 2200 })
          } else say(up.error, true)
        }
      }
      setData(prev => ({ ...prev, pages: next }))
      setPage(Math.max(0, next.length - 1))
    } catch (e) {
      say(e?.message || 'Upload failed.', true)
    }
    setBusy(false)
  }

  if (!doc || !data) return <div className="pbt-empty" style={{ padding: 30 }}>Loading…</div>

  const currentPageObj = page === 'back' ? { blank: true } : pages[page]

  return (
    <div className="pbt-editor">
      <header className="pbt-edhead">
        <button type="button" className="pbt-btn pbt-btn-quiet" onClick={onBack}>← Back</button>
        <div className="pbt-edid">
          <span className="pbt-edid-name">{properName(order?.primary_lastname || customerName(order?.customer)) || '—'}</span>
          <span className="pbt-edid-sub">{doc.title || template?.title}{order?.cemetery?.name ? ` · ${order.cemetery.name}` : ''}</span>
        </div>
        <div className="pbt-edhead-spacer" />
        <button type="button" className="pbt-btn pbt-btn-danger-quiet" onClick={() => setDelOpen(true)} disabled={busy}>Delete</button>
        <button type="button" className="pbt-btn" onClick={save} disabled={busy}>Save</button>
        <button type="button" className="pbt-btn" onClick={printPdf} disabled={busy}>Print</button>
        <button type="button" className="pbt-btn pbt-btn-gold" onClick={download} disabled={busy}>{busy ? 'Working…' : 'Download PDF'}</button>
      </header>

      {delOpen && (
        <PbtConfirm
          title="Delete this permit?"
          body={`${order?.primary_lastname || customerName(order?.customer) || 'This order'} — ${doc.title || template?.title || 'permit'}. The built PDF copy in the order's attachments goes with it. The order itself is untouched.`}
          confirmLabel="Delete permit"
          onCancel={() => setDelOpen(false)}
          onConfirm={async () => {
            const r = await deletePermitDoc(id)
            if (!r.ok) { say(r.error, true); setDelOpen(false); return }
            say('Permit deleted.')
            onBack()
          }}
        />
      )}

      {(missing.length > 0 || customPending.length > 0) && !missHidden && (
        <div className="pbt-missing">
          <div className="pbt-missing-head">
            <span className="pbt-missing-title">Needed for this permit — fill it here, it lands in the right box</span>
            <button type="button" className="pbt-btn pbt-btn-quiet" onClick={() => setMissHidden(true)}>Hide</button>
          </div>
          <div className="pbt-missing-rows">
            {missing.map(m => (
              <div key={m.key} className="pbt-missing-row">
                <span className="pbt-missing-label">{m.label}</span>
                <input type="text" className="pbt-input" style={{ maxWidth: 220 }}
                  value={missDraft[m.key] || ''}
                  onChange={e => setMissDraft(prev => ({ ...prev, [m.key]: e.target.value }))}
                  onKeyDown={e => { if (e.key === 'Enter') fillMissing(m) }} />
                <button type="button" className="pbt-btn" disabled={missBusy || !(missDraft[m.key] || '').trim()}
                  onClick={() => fillMissing(m)}>Fill</button>
              </div>
            ))}
            {customPending.map(({ f, n }) => (
              <div key={f.id} className="pbt-missing-row">
                <span className="pbt-missing-label">Custom text {n}</span>
                <input type="text" className="pbt-input" style={{ maxWidth: 220 }}
                  value={missDraft[`c:${f.id}`] || ''}
                  onChange={e => setMissDraft(prev => ({ ...prev, [`c:${f.id}`]: e.target.value }))}
                  onKeyDown={e => { if (e.key === 'Enter') fillCustom(f) }} />
                <button type="button" className="pbt-btn" disabled={!(missDraft[`c:${f.id}`] || '').trim()}
                  onClick={() => fillCustom(f)}>Fill</button>
              </div>
            ))}
          </div>
          <div className="pbt-rail-hint">Custom text counts top to bottom, left to right. Section / lot / grave answers also save back to the order, so it knows next time.</div>
        </div>
      )}

      <div className="pbt-docgrid">
        <div className="pbt-docmain">
          <div className="pbt-edbar">
            {pages.map((_, i) => (
              <button key={i} type="button" className={`pbt-pagetab ${page === i ? 'on' : ''}`} onClick={() => { setPage(i); setSel(null); setSelDim(null) }}>Page {i + 1}</button>
            ))}
            <button type="button" className={`pbt-pagetab ${page === 'back' ? 'on' : ''}`} onClick={() => { setPage('back'); setSel(null); setSelDim(null) }}>
              Back{hasBack ? '' : ' (blank)'}
            </button>
            <div className="pbt-edhead-spacer" />
            {(ownPages || !template) && (
              <>
                <button type="button" className="pbt-btn" onClick={() => pageFileRef.current?.click()} disabled={busy}>+ Add page</button>
                <input ref={pageFileRef} type="file" accept="image/*,application/pdf" multiple style={{ display: 'none' }}
                  onChange={e => { addPages([...e.target.files]); e.target.value = '' }} />
              </>
            )}
            <button type="button" className="pbt-btn" onClick={addText}>+ Text</button>
            <button type="button" className="pbt-btn" onClick={addCheck}>+ Checkmark</button>
            <button type="button" className="pbt-btn" onClick={addDim}>+ Dimension</button>
            {!layout
              ? <button type="button" className="pbt-btn" onClick={openPicker}>Insert layout</button>
              : <button type="button" className="pbt-btn pbt-btn-quiet" onClick={() => { setData(prev => ({ ...prev, layout: null })); setLaySel(false) }}>Remove layout</button>}
            {(fields.length > 0 || (data?.extras || []).length > 0) && (
              <button type="button" className={`pbt-btn ${selAll ? 'pbt-btn-on' : ''}`}
                onClick={() => { setSelAll(v => !v); setSel(null); setSelDim(null); setLaySel(false) }}>
                All boxes
              </button>
            )}
          </div>

          {selAll && !selBox && (
            <div className="pbt-toolbar">
              <span className="pbt-tool-label">All boxes — one font size everywhere</span>
              <SizeControls value={allSizeValue}
                onDelta={(d) => sizeAllBoxes(s => s + d)}
                onSet={(v) => sizeAllBoxes(() => v)} />
              <span className="pbt-hint" style={{ marginTop: 0 }}>Every box on every page. Click a box to size just that one.</span>
            </div>
          )}

          {selBox && (
            <div className="pbt-toolbar">
              <span className="pbt-tool-label">{selBox.kind === 'check' ? 'Checkmark — click it to toggle' : selIsField ? (AUTOFILL_LABEL.get(fields.find(f => f.id === sel)?.key) || 'Field') : 'Text box'}</span>
              {selBox.kind === 'check' ? (
                <>
                  <button type="button" className={`pbt-btn ${(selBox.mark || 'check') === 'check' ? 'pbt-btn-on' : ''}`} onClick={() => patchBox(sel, { mark: 'check' })}>Checkmark</button>
                  <button type="button" className={`pbt-btn ${selBox.mark === 'x' ? 'pbt-btn-on' : ''}`} onClick={() => patchBox(sel, { mark: 'x' })}>X</button>
                  <button type="button" className={`pbt-btn ${selBox.on ? 'pbt-btn-on' : ''}`} onClick={() => patchBox(sel, { on: !selBox.on })}>{selBox.on ? 'Checked' : 'Unchecked'}</button>
                </>
              ) : (
                <>
                  <SizeControls value={Math.round((selBox.sizePct || 0.016) * 1000)}
                    onDelta={(d) => patchBox(sel, { sizePct: clampSize((selBox.sizePct || 0.016) + d) })}
                    onSet={(v) => patchBox(sel, { sizePct: v })} />
                  <button type="button" className={`pbt-btn ${selBox.align === 'center' ? 'pbt-btn-on' : ''}`} onClick={() => patchBox(sel, { align: selBox.align === 'center' ? 'left' : 'center' })}>Center</button>
                  <button type="button" className={`pbt-btn ${selBox.bold ? 'pbt-btn-on' : ''}`} onClick={() => patchBox(sel, { bold: !selBox.bold })}>Bold</button>
                </>
              )}
              {selIsField && selBox.kind !== 'check' && (
                <button type="button" className="pbt-btn" onClick={() => {
                  const f = fields.find(x => x.id === sel)
                  patchBox(sel, { text: autofillValue(f.key, order) })
                }}>Re-autofill</button>
              )}
              <button type="button" className="pbt-btn" onClick={duplicateSel}>Duplicate</button>
              {selIsField
                ? <button type="button" className="pbt-btn pbt-btn-quiet" onClick={() => { patchBox(sel, { hidden: true }); setSel(null) }}>Hide</button>
                : <button type="button" className="pbt-btn pbt-btn-quiet" onClick={() => { setData(prev => ({ ...prev, extras: prev.extras.filter(e => e.id !== sel) })); setSel(null) }}>Delete</button>}
              <span className="pbt-hint" style={{ marginTop: 0 }}>Arrows nudge</span>
            </div>
          )}

          {selDimObj && (
            <div className="pbt-toolbar">
              <span className="pbt-tool-label">Dimension</span>
              <input type="text" className="pbt-input" style={{ maxWidth: 170 }} value={selDimObj.label}
                placeholder={'Label — e.g. 24"'} onChange={e => patchDim(selDim, { label: e.target.value })} />
              {autofillValue('die_size', order) && (
                <button type="button" className="pbt-btn" onClick={() => patchDim(selDim, { label: `DIE ${autofillValue('die_size', order)}` })}>Die size</button>
              )}
              {autofillValue('base_size', order) && (
                <button type="button" className="pbt-btn" onClick={() => patchDim(selDim, { label: `BASE ${autofillValue('base_size', order)}` })}>Base size</button>
              )}
              {autofillValue('foundation_size', order) && (
                <button type="button" className="pbt-btn" onClick={() => patchDim(selDim, { label: `FDN ${autofillValue('foundation_size', order)}` })}>Foundation</button>
              )}
              <button type="button" className="pbt-btn pbt-btn-quiet" onClick={() => { setData(prev => ({ ...prev, dims: prev.dims.filter(d => d.id !== selDim) })); setSelDim(null) }}>Delete</button>
            </div>
          )}

          {laySel && layout && (
            <div className="pbt-toolbar">
              <span className="pbt-tool-label">Layout — drag the picture to crop</span>
              <input type="range" min="0.4" max="4" step="0.05" value={layout.img?.scale ?? 1}
                onChange={e => setData(prev => ({ ...prev, layout: { ...prev.layout, img: { ...(prev.layout.img || { ox: 0, oy: 0 }), scale: Number(e.target.value) } } }))} />
              <button type="button" className="pbt-btn" onClick={() => setData(prev => ({ ...prev, layout: { ...prev.layout, img: { scale: 1, ox: 0, oy: 0 } } }))}>Fit</button>
              {layout.frame?.page === 'back'
                ? <button type="button" className="pbt-btn" onClick={layoutToFront}>Put on front</button>
                : <button type="button" className="pbt-btn" onClick={layoutToBack}>Put on back page</button>}
            </div>
          )}

          <div className="pbt-canvaswrap">
            {(!currentPageObj && page !== 'back')
              ? <div className="pbt-empty">{(ownPages || !template) ? 'No pages yet — use + Add page to upload the permit.' : 'This template has no pages yet — open it from Home and upload the blank form.'}</div>
              : (
                <PermitCanvas
                  page={currentPageObj}
                  boxes={boxesForPage(page)}
                  selectedId={sel}
                  allSelected={selAll}
                  onSelect={(v) => { setSel(v); if (v) { setSelDim(null); setLaySel(false); setSelAll(false) } }}
                  onBoxPatch={patchBox}
                  dims={(data?.dims || []).filter(d => d.page === page)}
                  selectedDimId={selDim}
                  onSelectDim={(v) => { setSelDim(v); if (v) { setSel(null); setLaySel(false) } }}
                  onDimPatch={patchDim}
                  layout={layout && layout.frame?.page === page ? layout : null}
                  layoutSelected={laySel}
                  onSelectLayout={(v) => { setLaySel(!!v); if (v) { setSel(null); setSelDim(null) } }}
                  onLayoutPatch={(patch) => setData(prev => ({ ...prev, layout: { ...prev.layout, ...patch } }))}
                />
              )}
          </div>
        </div>

        <div className="pbt-rail">
          <OrderInfoSections order={order} ctx={ctx} sources={sources} onInsertLayout={placeLayout} />
          <PermitMoneyRail order={order} say={say} onChanged={load} onOpenOrderDetail={onOpenOrderDetail} />
        </div>
      </div>

      {pickerOpen && (
        <div className="pbt-scrim" onClick={() => setPickerOpen(false)}>
          <div className="pbt-modal" onClick={e => e.stopPropagation()}>
            <h3 className="pbt-h2">Insert the layout</h3>
            {!sources && <div className="pbt-empty">Looking for this order's layouts…</div>}
            {sources && sources.length === 0 && <div className="pbt-empty">No saved layouts on this order — upload one below.</div>}
            {sources && sources.length > 0 && (
              <div className="pbt-srcgrid">
                {sources.map(s => (
                  <button key={s.url} type="button" className="pbt-srccard" onClick={() => placeLayout(s.url)}>
                    <img src={s.url} alt="" />
                    <span>{s.label || 'Layout'}</span>
                  </button>
                ))}
              </div>
            )}
            <div className="pbt-modal-actions">
              <button type="button" className="pbt-btn" onClick={() => layFileRef.current?.click()}>Upload an image</button>
              <button type="button" className="pbt-btn pbt-btn-quiet" onClick={() => setPickerOpen(false)}>Cancel</button>
            </div>
            <input ref={layFileRef} type="file" accept="image/*" style={{ display: 'none' }}
              onChange={async e => {
                const f = e.target.files?.[0]
                e.target.value = ''
                if (!f) return
                const up = await uploadPermitAsset(`permit-docs/${id}`, f, f.name)
                if (!up.ok) { say(up.error, true); return }
                placeLayout(up.url)
              }} />
          </div>
        </div>
      )}
    </div>
  )
}

// ── MONEY + STATUS RAIL ─────────────────────────────────────────────────────
// Same rails as OrderDetail: permit_status (+ auto timestamps) via
// setOrderPermit, fees via createPermitOutgoingPayment + orders.permit[].

function PermitMoneyRail({ order, say, onChanged, onOpenOrderDetail }) {
  const [status, setStatus] = useState(order?.permit_status || '')
  const [fee, setFee] = useState({ amount: '', method: 'check', ck: '', date: _todayISO(), payee: '' })
  const [busy, setBusy] = useState(false)
  useEffect(() => { setStatus(order?.permit_status || '') }, [order?.permit_status])

  if (!order) return null
  const filings = Array.isArray(order.permit) ? order.permit : []

  const saveStatus = async () => {
    if (!status || status === order.permit_status) return
    setBusy(true)
    const today = _todayISO()
    const patch = { permit_status: status }
    if (status === 'submitted') patch.permit_filed_at = today
    if (status === 'approved') { patch.permit_filed_at = order.permit_filed_at || today; patch.permit_approved_at = today }
    if (status === 'denied') { patch.permit_filed_at = order.permit_filed_at || today; patch.permit_denied_at = today; patch.permit_approved_at = null }
    const r = await setOrderPermit(order.id, patch)
    setBusy(false)
    if (!r.ok) { say(r.error || 'Could not update the status.', true); return }
    const staff = await getCurrentStaffName()
    logOrderActivity(order.id, {
      type: 'change', field: 'Permit status',
      oldValue: permitStatusLabel(order.permit_status), newValue: permitStatusLabel(status),
      note: 'Changed from Permit Builder', actor: staff,
    }).catch(() => {})
    say(`Status: ${permitStatusLabel(status)}.`)
    onChanged?.()
  }

  const recordFee = async () => {
    const amt = Number(fee.amount)
    if (!Number.isFinite(amt) || amt <= 0) { say('Enter a fee amount.', true); return }
    setBusy(true)
    const payee = (fee.payee || '').trim() || order?.cemetery?.name || null
    const filing = { type: 'permit', amount: amt, method: fee.method, ck: fee.ck ? String(fee.ck).trim() : null, date_filed: fee.date, name: payee }
    const staff = await getCurrentStaffName()
    const exp = await createPermitOutgoingPayment(order, filing, { cemeteryName: payee, createdBy: staff })
    if (exp.status === 'skipped') { setBusy(false); say(`Not recorded — ${exp.reason}`, true); return }
    if (exp.status === 'duplicate') { setBusy(false); say('That permit fee is already recorded.', true); return }
    const r = await setOrderPermit(order.id, { permit: [...filings, filing] })
    setBusy(false)
    if (!r.ok) { say(r.error || 'Fee ledgered, but the permit log write failed.', true); return }
    logOrderActivity(order.id, {
      type: 'change', field: 'Permit expense',
      newValue: `${fmtUSD(amt)}${filing.ck ? ` ck #${filing.ck}` : ''} (outgoing)`,
      note: `Permit fee paid to ${payee || 'cemetery'} — recorded from Permit Builder`, actor: staff,
    }).catch(() => {})
    setFee({ amount: '', method: 'check', ck: '', date: _todayISO(), payee: payee || '' })
    say('Fee recorded — it shows in Payments › Outgoing too.')
    onChanged?.()
  }

  return (
    <div className="pbt-rail-stack">
      <div className="pbt-rail-card">
        <div className="pbt-rail-title">Order</div>
        <div className="pbt-rail-name">{properName(order.primary_lastname || customerName(order.customer)) || '—'}</div>
        {order.order_number && <div className="pbt-rail-sub">{order.order_number}</div>}
        {order.cemetery?.name && <div className="pbt-rail-sub">{order.cemetery.name}</div>}
        {onOpenOrderDetail && (
          <button type="button" className="pbt-btn" style={{ marginTop: 8 }} onClick={() => onOpenOrderDetail(order.id)}>Open order</button>
        )}
      </div>

      <div className="pbt-rail-card">
        <div className="pbt-rail-title">Permit status</div>
        <select className="pbt-input" value={status} onChange={e => setStatus(e.target.value)}>
          <option value="">—</option>
          {PERMIT_STATUS_OPTIONS.map(o => <option key={o.code} value={o.code}>{o.label}</option>)}
        </select>
        <button type="button" className="pbt-btn pbt-btn-gold" style={{ marginTop: 8, width: '100%' }}
          onClick={saveStatus} disabled={busy || !status || status === order.permit_status}>
          Update status
        </button>
        <div className="pbt-rail-hint">Feeds the install gate and Permit Hub.</div>
      </div>

      <div className="pbt-rail-card">
        <div className="pbt-rail-title">Permit fees</div>
        {filings.length === 0 && <div className="pbt-rail-hint">Nothing filed yet.</div>}
        {filings.map((f, i) => (
          <div key={i} className="pbt-fee">
            <span className="pbt-fee-amt">{fmtUSD(Number(f.amount) || 0)}</span>
            <span className="pbt-fee-meta">{[f.method, f.ck && `ck #${f.ck}`, f.date_filed].filter(Boolean).join(' · ')}</span>
          </div>
        ))}
        <div className="pbt-feeform">
          <input type="number" className="pbt-input" placeholder="Amount" value={fee.amount} onChange={e => setFee(p => ({ ...p, amount: e.target.value }))} />
          <div className="pbt-feerow">
            <select className="pbt-input" value={fee.method} onChange={e => setFee(p => ({ ...p, method: e.target.value }))}>
              <option value="check">Check</option>
              <option value="cash">Cash</option>
              <option value="card">Card</option>
              <option value="other">Other</option>
            </select>
            <input type="text" className="pbt-input" placeholder="Ck #" value={fee.ck} onChange={e => setFee(p => ({ ...p, ck: e.target.value }))} />
          </div>
          <input type="date" className="pbt-input" value={fee.date} onChange={e => setFee(p => ({ ...p, date: e.target.value }))} />
          <input type="text" className="pbt-input" placeholder={`Payee — default ${order?.cemetery?.name || 'cemetery'}`} value={fee.payee} onChange={e => setFee(p => ({ ...p, payee: e.target.value }))} />
          <button type="button" className="pbt-btn pbt-btn-gold" style={{ width: '100%' }} onClick={recordFee} disabled={busy}>Record fee</button>
          <div className="pbt-rail-hint">Outgoing expense — never touches the customer balance.</div>
        </div>
      </div>
    </div>
  )
}

// ── ORDER INFO — everything about the order beside the permit (PB-4) ────────
// Paul: "on the right side all the order information... attachments email
// traffic stone size layout... deceased info customer info cemetery info."
// Native <details> sections — zero state, fast, collapsible.

const _tradeStr = (v) => {
  const n = Number(v)
  if (!Number.isFinite(n)) return v ?? ''
  return `${Math.floor(n / 12)}-${Math.round(n % 12)}`
}
function InfoRow({ label, value }) {
  if (value === null || value === undefined || value === '') return null
  return (
    <div className="pbt-info-row">
      <span className="pbt-info-label">{label}</span>
      <span className="pbt-info-value">{value}</span>
    </div>
  )
}
function OrderInfoSections({ order, ctx, sources, onInsertLayout }) {
  if (!order) return null
  const cust = order.customer || {}
  const cem = order.cemetery || {}
  const dec = Array.isArray(order.deceased) ? order.deceased : []
  const notes = Array.isArray(order.staff_notes) ? order.staff_notes : []
  const custAddr = [cust.address || cust.address_line1, [cust.city, cust.state].filter(Boolean).join(', '), cust.zip].filter(Boolean).join(', ')
  const dieDims = [order.width_inches, order.height_inches, order.thickness_inches ?? order.depth_inches].filter(v => v != null)
  const base = order.base_config || {}
  const baseDims = [base.width ?? base.w, base.height ?? base.h, base.depth ?? base.d].filter(v => v != null)
  // Local calendar day for both date-only strings and full timestamps — a raw
  // UTC slice dated evening emails a day ahead.
  const fmtDT = (iso) => {
    if (!iso) return null
    const s = String(iso)
    const d = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T00:00:00`) : new Date(s)
    return isNaN(d) ? s.slice(0, 10) : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }
  return (
    <div className="pbt-info">
      <details className="pbt-info-sec" open>
        <summary>Customer</summary>
        <InfoRow label="Name" value={[cust.first_name, cust.last_name].filter(Boolean).join(' ') || order.primary_lastname} />
        <InfoRow label="Phone" value={fmtPhoneUS(cust.phone_primary || cust.phone)} />
        <InfoRow label="Email" value={cust.email} />
        <InfoRow label="Address" value={custAddr} />
      </details>
      <details className="pbt-info-sec" open>
        <summary>Deceased</summary>
        {dec.length === 0 && <div className="pbt-info-empty">None recorded.</div>}
        {dec.map((p, i) => (
          <InfoRow key={i} label={`Person ${i + 1}`}
            value={[[p.firstName || p.first_name, p.lastName || p.last_name].filter(Boolean).join(' '),
              (p.dateOfDeath || p.date_of_death) ? `d. ${p.dateOfDeath || p.date_of_death}` : null].filter(Boolean).join(' — ')} />
        ))}
      </details>
      <details className="pbt-info-sec" open>
        <summary>Cemetery and grave</summary>
        <InfoRow label="Cemetery" value={cem.name} />
        <InfoRow label="Address" value={[cem.address, cem.city, cem.state].filter(Boolean).join(', ')} />
        <InfoRow label="Phone" value={fmtPhoneUS(cem.phone)} />
        <InfoRow label="Section" value={order.plot_section} />
        <InfoRow label="Block" value={order.plot_block} />
        <InfoRow label="Lot" value={order.plot_lot} />
        <InfoRow label="Row" value={order.plot_row} />
        <InfoRow label="Grave" value={order.plot_grave || order.plot_space} />
        <InfoRow label="Location" value={order.grave_location} />
        <InfoRow label="Permit" value={permitStatusLabel(order.permit_status)} />
      </details>
      <details className="pbt-info-sec" open>
        <summary>Stone</summary>
        <InfoRow label="Shape" value={[order.shape, order.top_shape].filter(Boolean).join(' · ')} />
        <InfoRow label="Color" value={order.granite_color} />
        <InfoRow label="Die" value={dieDims.length ? `${dieDims.map(_tradeStr).join(' x ')}  (${dieDims.join('" x ')}")` : null} />
        <InfoRow label="Base" value={baseDims.length ? `${baseDims.map(_tradeStr).join(' x ')}  (${baseDims.join('" x ')}")` : null} />
        <InfoRow label="Polish" value={order.polish_level} />
        <InfoRow label="Sides" value={order.sides} />
        <InfoRow label="Total" value={order.contract_total != null ? fmtUSD(order.contract_total) : null} />
      </details>
      <details className="pbt-info-sec" open>
        <summary>Layouts</summary>
        {!sources && <div className="pbt-info-empty">Loading…</div>}
        {sources && sources.length === 0 && <div className="pbt-info-empty">No saved layouts.</div>}
        {sources && sources.length > 0 && (
          <div className="pbt-info-thumbs">
            {sources.map(s => (
              <button key={s.url} type="button" className="pbt-info-thumb" title="Insert into the permit"
                onClick={() => onInsertLayout?.(s.url)}>
                <img src={s.url} alt="" />
                <span>{s.label}</span>
              </button>
            ))}
          </div>
        )}
      </details>
      <details className="pbt-info-sec">
        <summary>Attachments {ctx ? `(${ctx.attachments.length})` : ''}</summary>
        {!ctx && <div className="pbt-info-empty">Loading…</div>}
        {ctx && ctx.attachments.length === 0 && <div className="pbt-info-empty">None.</div>}
        {ctx && ctx.attachments.map(a => (
          <a key={a.id} className="pbt-info-link" href={a.file_url} target="_blank" rel="noreferrer">
            {(a.category || 'file').toUpperCase()} · {a.filename || 'attachment'}
          </a>
        ))}
      </details>
      <details className="pbt-info-sec">
        <summary>Email traffic {ctx ? `(${ctx.emails.length})` : ''}</summary>
        {!ctx && <div className="pbt-info-empty">Loading…</div>}
        {ctx && ctx.emails.length === 0 && <div className="pbt-info-empty">Nothing linked to this customer.</div>}
        {ctx && ctx.emails.map(e => (
          <div key={e.id} className="pbt-info-mail">
            <span className={`pbt-info-dir ${e.direction === 'outbound' ? 'out' : 'in'}`}>{e.direction === 'outbound' ? 'SENT' : 'IN'}</span>
            <span className="pbt-info-mail-sub">{e.subject || '(no subject)'}</span>
            <span className="pbt-info-mail-date">{fmtDT(e.sent_at || e.created_at)}</span>
          </div>
        ))}
      </details>
      {notes.length > 0 && (
        <details className="pbt-info-sec">
          <summary>Notes ({notes.length})</summary>
          {notes.slice().reverse().map((n, i) => (
            <div key={i} className="pbt-info-note">
              <div className="pbt-info-note-meta">{n.by || 'Staff'}{n.at ? ` · ${String(n.at).slice(0, 10)}` : ''}</div>
              <div>{n.text}</div>
            </div>
          ))}
        </details>
      )}
    </div>
  )
}

// ── CONFIRM MODAL — the safety stop before anything is destroyed ────────────
// Paul 2026-07-22: "delete permits ... with a safety message." One shape for
// permit-doc deletes (Home + doc editor) and template removal.

function PbtConfirm({ title, body, confirmLabel = 'Delete', onConfirm, onCancel }) {
  const [busy, setBusy] = useState(false)
  return (
    <div className="pbt-scrim" onClick={busy ? undefined : onCancel}>
      <div className="pbt-modal" style={{ maxWidth: 440 }} onClick={e => e.stopPropagation()}>
        <h3 className="pbt-h2" style={{ marginBottom: 6 }}>{title}</h3>
        <div className="pbt-confirm-body">{body}</div>
        <div className="pbt-modal-actions">
          <button type="button" className="pbt-btn pbt-btn-quiet" onClick={onCancel} disabled={busy}>Cancel</button>
          <button type="button" className="pbt-btn pbt-btn-danger" disabled={busy}
            onClick={async () => { setBusy(true); try { await onConfirm() } finally { setBusy(false) } }}>
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── STYLES ──────────────────────────────────────────────────────────────────

const localStyles = `
  .pbt-wrap { padding: 18px 20px 40px; max-width: 1500px; margin: 0 auto; }
  .pbt-flash {
    position: fixed; top: 14px; left: 50%; transform: translateX(-50%); z-index: 1200;
    background: #1D9E75; color: #fff; font-size: 13px; padding: 8px 18px; border-radius: 8px;
    box-shadow: 0 6px 20px rgba(15,20,25,0.25);
  }
  .pbt-flash.err { background: #b54040; }
  .pbt-h2 { font-size: 15px; font-weight: 600; color: var(--sb-text, #2C2C2A); margin: 0 0 10px; }
  .pbt-home { display: grid; grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr); gap: 18px; align-items: start; }
  @media (max-width: 980px) { .pbt-home { grid-template-columns: 1fr; } }
  .pbt-panel {
    background: var(--sb-surface, #fff); border: 0.5px solid var(--sb-border, #DCD7CB);
    border-radius: 10px; padding: 16px 18px;
  }
  .pbt-input {
    font: inherit; font-size: 13.5px; padding: 8px 10px; width: 100%;
    border: 0.5px solid var(--sb-border, #DCD7CB); border-radius: 7px;
    background: var(--sb-surface, #fff); color: var(--sb-text, #2C2C2A);
  }
  .pbt-input:focus { outline: none; border-color: #9A7209; box-shadow: 0 0 0 2px rgba(154,114,9,0.14); }
  .pbt-hint, .pbt-rail-hint { font-size: 11.5px; color: var(--sb-text-muted, #888780); margin-top: 6px; }
  .pbt-empty { font-size: 13px; color: var(--sb-text-muted, #888780); padding: 14px 4px; }
  .pbt-btn {
    font: inherit; font-size: 12.5px; font-weight: 500; padding: 6px 12px; cursor: pointer;
    border: 0.5px solid var(--sb-border, #C9C3B4); border-radius: 7px;
    background: var(--sb-surface, #fff); color: var(--sb-text, #2C2C2A); white-space: nowrap;
  }
  .pbt-btn:hover:not(:disabled) { border-color: #9A7209; color: #9A7209; }
  .pbt-btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .pbt-btn-gold { background: #9A7209; border-color: #9A7209; color: #fff; }
  .pbt-btn-gold:hover:not(:disabled) { background: #7d5d07; color: #fff; }
  .pbt-btn-quiet { border-color: transparent; color: var(--sb-text-muted, #888780); }
  .pbt-btn-on { background: rgba(154,114,9,0.12); border-color: #9A7209; color: #9A7209; }
  .pbt-btn-danger { background: #b54040; border-color: #b54040; color: #fff; }
  .pbt-btn-danger:hover:not(:disabled) { background: #983434; border-color: #983434; color: #fff; }
  .pbt-btn-danger-quiet { border-color: transparent; color: #b54040; }
  .pbt-btn-danger-quiet:hover:not(:disabled) { border-color: #b54040; color: #b54040; }
  .pbt-confirm-body { font-size: 13px; color: var(--sb-text, #2C2C2A); line-height: 1.55; margin-bottom: 6px; }

  .pbt-orderlist, .pbt-doclist { display: flex; flex-direction: column; margin-top: 10px; }
  .pbt-orderrow, .pbt-docrow {
    display: flex; align-items: center; justify-content: space-between; gap: 10px;
    padding: 9px 2px; border-bottom: 0.5px solid var(--sb-border, #EEE9DD);
  }
  .pbt-orderrow:last-child, .pbt-docrow:last-child { border-bottom: none; }
  .pbt-orderrow-main { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; min-width: 0; }
  .pbt-orderrow-name { font-size: 14px; font-weight: 600; color: var(--sb-text, #2C2C2A); }
  .pbt-orderrow-cem { font-size: 12px; color: var(--sb-text-muted, #888780); }
  .pbt-docrow-open { display: flex; align-items: baseline; gap: 10px; flex: 1; min-width: 0; background: none; border: none; font: inherit; cursor: pointer; text-align: left; padding: 0; }
  .pbt-docrow-date { font-size: 11px; color: var(--sb-text-muted, #888780); margin-left: auto; }
  .pbt-tplpick { display: flex; gap: 6px; flex-wrap: wrap; }
  .pbt-pill { font-size: 10.5px; font-weight: 600; padding: 2px 9px; border-radius: 999px; letter-spacing: 0.02em; }
  .pbt-pill-good { color: #0F6E56; border: 0.5px solid #1D9E75; }
  .pbt-pill-warn { color: #854F0B; border: 0.5px solid #BA7517; }
  .pbt-pill-bad { color: #A32D2D; border: 0.5px solid #E24B4A; }
  .pbt-pill-info { color: #185FA5; border: 0.5px solid #378ADD; }
  .pbt-pill-neutral { color: #5F5E5A; border: 0.5px solid #B4B2A9; }

  .pbt-tpl-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
  .pbt-newtpl { display: flex; flex-direction: column; gap: 8px; margin: 10px 0 14px; }
  .pbt-tplgrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 10px; margin-top: 12px; }
  .pbt-tplcard {
    display: flex; flex-direction: column; gap: 3px; text-align: left; cursor: pointer;
    font: inherit; background: var(--sb-surface-muted, #F7F5F0); border: 0.5px solid var(--sb-border, #DCD7CB);
    border-radius: 9px; padding: 12px 13px;
  }
  .pbt-tplcard:hover { border-color: #9A7209; }
  .pbt-tplcard-title { font-size: 13.5px; font-weight: 600; color: var(--sb-text, #2C2C2A); }
  .pbt-tplcard-sub { font-size: 12px; color: #9A7209; }
  .pbt-tplcard-meta { font-size: 11px; color: var(--sb-text-muted, #888780); }

  .pbt-editor { display: flex; flex-direction: column; gap: 10px; }
  .pbt-edhead { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .pbt-edhead-spacer { flex: 1; }
  .pbt-edtitle { max-width: 320px; font-weight: 600; }
  .pbt-edid { display: flex; flex-direction: column; }
  .pbt-edid-name { font-size: 16px; font-weight: 600; color: var(--sb-text, #2C2C2A); }
  .pbt-edid-sub { font-size: 12px; color: var(--sb-text-muted, #888780); }
  .pbt-edbar { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
  .pbt-pagetab {
    font: inherit; font-size: 12.5px; padding: 6px 12px; cursor: pointer;
    border: 0.5px solid var(--sb-border, #C9C3B4); border-radius: 7px; background: transparent;
    color: var(--sb-text-muted, #888780);
  }
  .pbt-pagetab.on { background: #2C2C2A; border-color: #2C2C2A; color: #fff; }
  .pbt-toolbar {
    display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
    background: var(--sb-surface-muted, #F7F5F0); border: 0.5px solid var(--sb-border, #DCD7CB);
    border-radius: 8px; padding: 7px 10px;
  }
  .pbt-toolbar .pbt-input { width: auto; }
  .pbt-sizein { max-width: 64px; text-align: center; }
  .pbt-sizeslider { width: 170px; accent-color: #9A7209; cursor: pointer; }
  .pbt-missing {
    background: #FDF6E3; border: 0.5px solid #BA7517; border-radius: 9px; padding: 11px 14px;
  }
  .pbt-missing-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
  .pbt-missing-title { font-size: 12.5px; font-weight: 700; color: #854F0B; }
  .pbt-missing-rows { display: flex; flex-direction: column; gap: 7px; margin-top: 9px; }
  .pbt-missing-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .pbt-missing-label { font-size: 12.5px; color: #5F5E5A; min-width: 150px; }
  .pbt-tool-label { font-size: 11px; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase; color: #9A7209; margin-right: 4px; }
  .pbt-dropzone {
    font: inherit; border: 2px dashed var(--sb-border, #C9C3B4); border-radius: 12px; background: transparent;
    color: var(--sb-text-muted, #888780); font-size: 14px; line-height: 1.6; cursor: pointer;
    padding: 70px 40px; text-align: center;
  }
  .pbt-dropzone:hover { border-color: #9A7209; color: #9A7209; }
  .pbt-canvaswrap { max-width: 880px; }
  .pbt-docgrid { display: grid; grid-template-columns: minmax(0, 1fr) 340px; gap: 16px; align-items: start; }
  @media (max-width: 1120px) { .pbt-docgrid { grid-template-columns: 1fr; } }
  .pbt-docmain { display: flex; flex-direction: column; gap: 10px; min-width: 0; }
  .pbt-rail { display: flex; flex-direction: column; gap: 12px; }
  .pbt-rail-stack { display: flex; flex-direction: column; gap: 12px; }
  .pbt-info { display: flex; flex-direction: column; gap: 8px; }
  .pbt-info-sec {
    background: var(--sb-surface, #fff); border: 0.5px solid var(--sb-border, #DCD7CB);
    border-radius: 10px; padding: 4px 14px 8px;
  }
  .pbt-info-sec summary {
    font-size: 10.5px; font-weight: 700; letter-spacing: 0.07em; text-transform: uppercase;
    color: var(--sb-text-muted, #888780); padding: 8px 0 6px; cursor: pointer; user-select: none;
  }
  .pbt-info-row { display: flex; gap: 10px; padding: 3px 0; font-size: 12.5px; }
  .pbt-info-label { color: var(--sb-text-muted, #888780); min-width: 70px; flex-shrink: 0; }
  .pbt-info-value { color: var(--sb-text, #2C2C2A); word-break: break-word; }
  .pbt-info-empty { font-size: 12px; color: var(--sb-text-muted, #888780); padding: 3px 0 5px; }
  .pbt-info-thumbs { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; padding: 2px 0 4px; }
  .pbt-info-thumb {
    font: inherit; cursor: pointer; background: var(--sb-surface-muted, #F7F5F0);
    border: 0.5px solid var(--sb-border, #DCD7CB); border-radius: 8px; padding: 6px;
    display: flex; flex-direction: column; gap: 4px;
  }
  .pbt-info-thumb:hover { border-color: #9A7209; }
  .pbt-info-thumb img { width: 100%; height: 64px; object-fit: contain; background: #fff; border-radius: 4px; }
  .pbt-info-thumb span { font-size: 10.5px; color: var(--sb-text, #2C2C2A); }
  .pbt-info-link { display: block; font-size: 12px; color: #9A7209; padding: 3px 0; text-decoration: none; }
  .pbt-info-link:hover { text-decoration: underline; }
  .pbt-info-mail { display: flex; align-items: baseline; gap: 7px; padding: 3px 0; font-size: 12px; }
  .pbt-info-dir { font-size: 9px; font-weight: 700; letter-spacing: 0.05em; padding: 1px 6px; border-radius: 999px; flex-shrink: 0; }
  .pbt-info-dir.in { color: #185FA5; border: 0.5px solid #378ADD; }
  .pbt-info-dir.out { color: #0F6E56; border: 0.5px solid #1D9E75; }
  .pbt-info-mail-sub { color: var(--sb-text, #2C2C2A); flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .pbt-info-mail-date { color: var(--sb-text-muted, #888780); font-size: 11px; flex-shrink: 0; }
  .pbt-info-note { font-size: 12px; color: var(--sb-text, #2C2C2A); padding: 4px 0; border-top: 0.5px solid var(--sb-border, #EEE9DD); white-space: pre-wrap; }
  .pbt-info-note-meta { font-size: 10.5px; color: var(--sb-text-muted, #888780); }
  .pbt-rail-card { background: var(--sb-surface, #fff); border: 0.5px solid var(--sb-border, #DCD7CB); border-radius: 10px; padding: 13px 14px; }
  .pbt-rail-title { font-size: 10.5px; font-weight: 700; letter-spacing: 0.07em; text-transform: uppercase; color: var(--sb-text-muted, #888780); margin-bottom: 7px; }
  .pbt-rail-name { font-size: 15px; font-weight: 600; color: var(--sb-text, #2C2C2A); }
  .pbt-rail-sub { font-size: 12px; color: var(--sb-text-muted, #888780); }
  .pbt-fee { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; padding: 5px 0; border-bottom: 0.5px solid var(--sb-border, #EEE9DD); }
  .pbt-fee-amt { font-size: 13px; font-weight: 600; color: var(--sb-text, #2C2C2A); }
  .pbt-fee-meta { font-size: 11px; color: var(--sb-text-muted, #888780); }
  .pbt-feeform { display: flex; flex-direction: column; gap: 7px; margin-top: 10px; }
  .pbt-feerow { display: grid; grid-template-columns: 1fr 1fr; gap: 7px; }

  .pbt-scrim { position: fixed; inset: 0; background: rgba(15,20,25,0.45); z-index: 1100; display: flex; align-items: center; justify-content: center; padding: 20px; }
  .pbt-modal { background: var(--sb-surface, #fff); border-radius: 12px; padding: 18px 20px; width: 100%; max-width: 640px; max-height: 84vh; overflow-y: auto; box-shadow: 0 18px 50px rgba(15,20,25,0.3); }
  .pbt-srcgrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 10px; margin: 10px 0; }
  .pbt-srccard { font: inherit; cursor: pointer; background: var(--sb-surface-muted, #F7F5F0); border: 0.5px solid var(--sb-border, #DCD7CB); border-radius: 9px; padding: 8px; display: flex; flex-direction: column; gap: 6px; }
  .pbt-srccard:hover { border-color: #9A7209; }
  .pbt-srccard img { width: 100%; height: 96px; object-fit: contain; background: #fff; border-radius: 5px; }
  .pbt-srccard span { font-size: 11.5px; color: var(--sb-text, #2C2C2A); }
  .pbt-modal-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 8px; }
`

if (typeof document !== 'undefined' && !document.getElementById('pbt-styles')) {
  const tag = document.createElement('style')
  tag.id = 'pbt-styles'
  tag.textContent = localStyles
  document.head.appendChild(tag)
}
