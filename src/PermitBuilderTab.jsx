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
  listAllOrders, customerName, fmtUSD,
  permitNeeded, PERMIT_STATUS_OPTIONS, permitStatusLabel, permitStatusTone,
  setOrderPermit, createPermitOutgoingPayment, getCurrentStaffName, logOrderActivity,
  listCemeteriesWithPermit, getProofVersionsByOrder, getProofVersions, getJobByOrderId,
} from './lib/stonebooksData'
import {
  listPermitTemplates, getPermitTemplate, createPermitTemplate, updatePermitTemplate,
  listPermitDocs, getPermitDoc, createPermitDoc, updatePermitDoc, deletePermitDoc,
  uploadPermitAsset, rasterizePdfFile, readImageSize,
  AUTOFILL_FIELDS, autofillValue, seedDocData, effectiveBox, exportPermitPdf,
} from './lib/permitBuilder'
import PermitCanvas from './components/permit/PermitCanvas'

const _todayISO = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const rid = () => Math.random().toString(36).slice(2, 9)
const AUTOFILL_LABEL = new Map(AUTOFILL_FIELDS.map(f => [f.key, f.label]))

export default function PermitBuilderTab({ onOpenOrderDetail }) {
  const [view, setView] = useState({ name: 'home' })
  const [templates, setTemplates] = useState([])
  const [docs, setDocs] = useState([])
  const [orders, setOrders] = useState([])
  const [cemeteries, setCemeteries] = useState([])
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

  return (
    <div className="pbt-wrap">
      {flash && <div className={`pbt-flash ${flash.err ? 'err' : ''}`}>{flash.text}</div>}
      {view.name === 'home' && (
        <HomeView
          templates={templates} docs={docs} orders={orders} cemeteries={cemeteries}
          onOpenTemplate={(id) => setView({ name: 'template', id })}
          onOpenDoc={(id) => setView({ name: 'doc', id })}
          onBuild={openDocForOrder}
          onCreateTemplate={async (title, cemeteryId) => {
            const r = await createPermitTemplate({ title, cemeteryId })
            if (!r.ok) { say(r.error, true); return }
            setView({ name: 'template', id: r.template.id })
          }}
          onDeleteDoc={async (doc) => {
            if (!window.confirm('Delete this permit? The order itself is untouched.')) return
            await deletePermitDoc(doc.id)
            reloadHome()
          }}
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
    </div>
  )
}

// ── HOME ────────────────────────────────────────────────────────────────────

function HomeView({ templates, docs, orders, cemeteries, onOpenTemplate, onOpenDoc, onBuild, onCreateTemplate, onDeleteDoc, say }) {
  const [q, setQ] = useState('')
  const [newOpen, setNewOpen] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [newCem, setNewCem] = useState('')
  const [pickFor, setPickFor] = useState(null)   // order whose template choice is open

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
                  <span className="pbt-orderrow-name">{o.primary_lastname || customerName(o.customer) || '—'}</span>
                  {o.cemetery?.name && <span className="pbt-orderrow-cem">{o.cemetery.name}</span>}
                  <span className={`pbt-pill pbt-pill-${permitStatusTone(o.permit_status)}`}>{permitStatusLabel(o.permit_status)}</span>
                </div>
                {!picking ? (
                  <button type="button" className="pbt-btn pbt-btn-gold" onClick={() => {
                    if (tpls.length === 0) { say(`No template for ${o.cemetery?.name || 'this cemetery'} yet — create one on the right, then come back.`, true); return }
                    if (tpls.length === 1) { onBuild(o, tpls[0]); return }
                    setPickFor(o.id)
                  }}>Build</button>
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

        <h2 className="pbt-h2" style={{ marginTop: 22 }}>Recent permits</h2>
        <div className="pbt-doclist">
          {docs.length === 0 && <div className="pbt-empty">Built permits show up here to resume or reprint.</div>}
          {docs.map(d => (
            <div key={d.id} className="pbt-docrow">
              <button type="button" className="pbt-docrow-open" onClick={() => onOpenDoc(d.id)}>
                <span className="pbt-orderrow-name">{d.order?.primary_lastname || customerName(d.order?.customer) || '—'}</span>
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
  const [slotSel, setSlotSel] = useState(false)
  const [busy, setBusy] = useState(false)
  const fileRef = useRef(null)

  useEffect(() => {
    getPermitTemplate(id).then(t => {
      if (!t) { say('Template not found.', true); onBack(); return }
      setTpl(t); setPages(t.pages || []); setFields(t.fields || [])
      setSlot(t.layout_slot || null); setTitle(t.title || ''); setCemId(t.cemetery_id || '')
    })
  }, [id])   // eslint-disable-line react-hooks/exhaustive-deps

  const onFiles = async (files) => {
    if (!files?.length) return
    setBusy(true)
    try {
      const next = [...pages]
      for (const file of files) {
        if (/pdf$/i.test(file.type) || /\.pdf$/i.test(file.name)) {
          const rendered = await rasterizePdfFile(file)
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

  const addField = () => {
    const f = { id: rid(), key: 'custom', page, x: 0.08, y: 0.08, w: 0.28, h: 0.028, sizePct: 0.016, align: 'left', bold: false }
    setFields(prev => [...prev, f])
    setSel(f.id)
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
        <button type="button" className="pbt-btn pbt-btn-gold" onClick={save} disabled={busy}>{busy ? 'Working…' : 'Save template'}</button>
      </header>

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
            <button type="button" className="pbt-btn" onClick={addField}>+ Field box</button>
            <button type="button" className="pbt-btn" onClick={() => {
              if (slot?.page === page) { setSlot(null); setSlotSel(false) }
              else { setSlot({ page, x: 0.1, y: 0.55, w: 0.8, h: 0.33 }); setSlotSel(true) }
            }}>{slot?.page === page ? 'Remove layout area' : '+ Layout area'}</button>
          </>
        )}
      </div>

      {selField && (
        <div className="pbt-toolbar">
          <select className="pbt-input" style={{ maxWidth: 230 }} value={selField.key}
            onChange={e => patchField(selField.id, { key: e.target.value })}>
            {AUTOFILL_FIELDS.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
          </select>
          <button type="button" className="pbt-btn" onClick={() => patchField(selField.id, { sizePct: Math.max(0.008, (selField.sizePct || 0.016) - 0.002) })}>A−</button>
          <button type="button" className="pbt-btn" onClick={() => patchField(selField.id, { sizePct: Math.min(0.05, (selField.sizePct || 0.016) + 0.002) })}>A+</button>
          <button type="button" className={`pbt-btn ${selField.align === 'center' ? 'pbt-btn-on' : ''}`} onClick={() => patchField(selField.id, { align: selField.align === 'center' ? 'left' : 'center' })}>Center</button>
          <button type="button" className={`pbt-btn ${selField.bold ? 'pbt-btn-on' : ''}`} onClick={() => patchField(selField.id, { bold: !selField.bold })}>Bold</button>
          <button type="button" className="pbt-btn pbt-btn-quiet" onClick={() => { setFields(prev => prev.filter(f => f.id !== sel)); setSel(null) }}>Delete box</button>
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
            boxes={fields.filter(f => f.page === page).map(f => ({ ...f, text: '', hidden: false }))}
            selectedId={sel}
            onSelect={setSel}
            onBoxPatch={patchField}
            slot={slot?.page === page ? slot : null}
            slotSelected={slotSel}
            onSelectSlot={setSlotSel}
            onSlotPatch={(s) => setSlot({ ...s, page })}
            templateMode
            labelFor={(b) => AUTOFILL_LABEL.get(b.key) || b.key}
          />
        </div>
      )}
    </div>
  )
}

// ── DOC EDITOR ──────────────────────────────────────────────────────────────

function DocEditor({ id, say, onBack, onOpenOrderDetail }) {
  const [doc, setDoc] = useState(null)
  const [data, setData] = useState(null)
  const [page, setPage] = useState(0)          // number | 'back'
  const [sel, setSel] = useState(null)
  const [selDim, setSelDim] = useState(null)
  const [laySel, setLaySel] = useState(false)
  const [busy, setBusy] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [sources, setSources] = useState(null)
  const layFileRef = useRef(null)

  const load = async () => {
    const d = await getPermitDoc(id)
    if (!d) { say('Permit not found.', true); onBack(); return }
    setDoc(d)
    setData(prev => prev || d.data || { values: {}, extras: [], layout: null, dims: [] })
  }
  useEffect(() => { load() }, [id])   // eslint-disable-line react-hooks/exhaustive-deps

  const template = doc?.template
  const order = doc?.order
  const pages = template?.pages || []
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

  const addText = () => {
    const ex = { id: `x-${rid()}`, page, text: 'Text', x: 0.08, y: 0.08, w: 0.3, h: 0.028, sizePct: 0.016, align: 'left', bold: false }
    setData(prev => ({ ...prev, extras: [...(prev.extras || []), ex] }))
    setSel(ex.id)
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
  const download = async () => {
    setBusy(true)
    try {
      await save()
      const fam = (order?.primary_lastname || customerName(order?.customer) || 'permit').replace(/[^\w-]+/g, '_')
      await exportPermitPdf({ template, docData: data, filename: `${fam}-${(doc.title || 'permit').replace(/[^\w-]+/g, '_')}.pdf` })
    } catch (e) {
      say(e?.message || 'PDF export failed.', true)
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
          <span className="pbt-edid-name">{order?.primary_lastname || customerName(order?.customer) || '—'}</span>
          <span className="pbt-edid-sub">{doc.title || template?.title}{order?.cemetery?.name ? ` · ${order.cemetery.name}` : ''}</span>
        </div>
        <div className="pbt-edhead-spacer" />
        <button type="button" className="pbt-btn" onClick={save} disabled={busy}>Save</button>
        <button type="button" className="pbt-btn pbt-btn-gold" onClick={download} disabled={busy}>{busy ? 'Working…' : 'Download PDF'}</button>
      </header>

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
            <button type="button" className="pbt-btn" onClick={addText}>+ Text</button>
            <button type="button" className="pbt-btn" onClick={addDim}>+ Dimension</button>
            {!layout
              ? <button type="button" className="pbt-btn" onClick={openPicker}>Insert layout</button>
              : <button type="button" className="pbt-btn pbt-btn-quiet" onClick={() => { setData(prev => ({ ...prev, layout: null })); setLaySel(false) }}>Remove layout</button>}
          </div>

          {selBox && (
            <div className="pbt-toolbar">
              <span className="pbt-tool-label">{selIsField ? (AUTOFILL_LABEL.get(fields.find(f => f.id === sel)?.key) || 'Field') : 'Text box'}</span>
              <button type="button" className="pbt-btn" onClick={() => patchBox(sel, { sizePct: Math.max(0.008, (selBox.sizePct || 0.016) - 0.002) })}>A−</button>
              <button type="button" className="pbt-btn" onClick={() => patchBox(sel, { sizePct: Math.min(0.05, (selBox.sizePct || 0.016) + 0.002) })}>A+</button>
              <button type="button" className={`pbt-btn ${selBox.align === 'center' ? 'pbt-btn-on' : ''}`} onClick={() => patchBox(sel, { align: selBox.align === 'center' ? 'left' : 'center' })}>Center</button>
              <button type="button" className={`pbt-btn ${selBox.bold ? 'pbt-btn-on' : ''}`} onClick={() => patchBox(sel, { bold: !selBox.bold })}>Bold</button>
              {selIsField && (
                <button type="button" className="pbt-btn" onClick={() => {
                  const f = fields.find(x => x.id === sel)
                  patchBox(sel, { text: autofillValue(f.key, order) })
                }}>Re-autofill</button>
              )}
              {selIsField
                ? <button type="button" className="pbt-btn pbt-btn-quiet" onClick={() => { patchBox(sel, { hidden: true }); setSel(null) }}>Hide</button>
                : <button type="button" className="pbt-btn pbt-btn-quiet" onClick={() => { setData(prev => ({ ...prev, extras: prev.extras.filter(e => e.id !== sel) })); setSel(null) }}>Delete</button>}
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
              ? <div className="pbt-empty">This template has no pages yet — open it from Home and upload the blank form.</div>
              : (
                <PermitCanvas
                  page={currentPageObj}
                  boxes={boxesForPage(page)}
                  selectedId={sel}
                  onSelect={(v) => { setSel(v); if (v) { setSelDim(null); setLaySel(false) } }}
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

        <PermitMoneyRail order={order} say={say} onChanged={load} onOpenOrderDetail={onOpenOrderDetail} />
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
    <aside className="pbt-rail">
      <div className="pbt-rail-card">
        <div className="pbt-rail-title">Order</div>
        <div className="pbt-rail-name">{order.primary_lastname || customerName(order.customer) || '—'}</div>
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
    </aside>
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
  .pbt-tool-label { font-size: 11px; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase; color: #9A7209; margin-right: 4px; }
  .pbt-dropzone {
    font: inherit; border: 2px dashed var(--sb-border, #C9C3B4); border-radius: 12px; background: transparent;
    color: var(--sb-text-muted, #888780); font-size: 14px; line-height: 1.6; cursor: pointer;
    padding: 70px 40px; text-align: center;
  }
  .pbt-dropzone:hover { border-color: #9A7209; color: #9A7209; }
  .pbt-canvaswrap { max-width: 880px; }
  .pbt-docgrid { display: grid; grid-template-columns: minmax(0, 1fr) 280px; gap: 16px; align-items: start; }
  @media (max-width: 1080px) { .pbt-docgrid { grid-template-columns: 1fr; } }
  .pbt-docmain { display: flex; flex-direction: column; gap: 10px; min-width: 0; }
  .pbt-rail { display: flex; flex-direction: column; gap: 12px; }
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
