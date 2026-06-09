// =============================================================================
// Stonebooks — New Order / Edit Order form (compact, single screen, type-aware)
// =============================================================================
// A fast one-screen alternative to the full Sales wizard. Unlike the first cut
// (which embedded the wizard's picture-picker step components), this is a
// COMPACT form: labeled boxes + dropdowns grouped into cards that mirror the
// Order Detail page (Customer & contact / Cemetery & grave / Monument /
// Inscription / Add-ons / Financial / Status). No emojis, no marketing chrome,
// sentence case, CRM theme.
//
// All pricing flows through src/lib/orderRates.js (computeFormLineItems /
// computeTotals / rankedBaseSizes / addonPrice) — the single rate module the
// next build's Settings editor will swap to DB-backed. All persistence flows
// through the wizard's own saveOrder / rowToOrder so totals + data shape never
// drift. On submit it persists, auto-creates the job (allowUnsigned), and
// backfills the job to the checked stage.
// =============================================================================

import { useState, useEffect, useMemo, useRef } from 'react'
import {
  makeBlankOrder, makeBlankDeceased, saveOrder, rowToOrder, salesModeStyles,
  searchCustomers, searchCemeteries, rowToCustomer, rowToCemetery,
  fetchMonuments, uploadAttachment,
} from './SalesMode'
import {
  getOrderById, getJobByOrderId, createJobFromOrder,
  getOrderMilestoneTemplate, backfillJobMilestones, fmtUSD,
  autoDetectOrderPermit, maskPhoneInput, phoneDigits, fmtPhone, applyDepositMilestones,
} from './lib/stonebooksData'
import { generateCarveText } from './lib/carveText'
import QuotesManager from './components/QuotesManager'
import {
  SHAPES, GRANITE_COLORS, POLISH_LEVELS, BASE_HEIGHTS,
  LASER_SIZES, BLING_SIZES, VASE_SIZES, PHOTO_TYPES, PHOTO_SIZES, SHAPE_CARVED_DESIGNS,
  MONUMENT_TYPES, BASE_FINISHES, INSCRIPTION_TIERS, ACID_WASH_BY_TYPE,
  computeFormLineItems, computeTotals, rankedBaseSizes, addonPrice, stoneFaceArea,
} from './lib/orderRates'

// ── Type config — drives which cards render per job type ────────────────────
const ORDER_TYPES = {
  new_monument: {
    label: 'New monument', jobType: 'new_stone', serviceTypes: ['NEW_STONE'], deceasedVariant: 'monument',
    sections: ['customer', 'cemetery', 'monument', 'deceased', 'inscription', 'catalog', 'attachments', 'addons', 'finance'],
  },
  additional_inscription: {
    label: 'Additional inscription', jobType: 'inscription', serviceTypes: ['INSCRIPTION'], deceasedVariant: 'inscription',
    sections: ['customer', 'cemetery', 'inscription_type', 'deceased', 'inscription', 'addons', 'finance'],
  },
  repair: {
    label: 'Repair', jobType: 'cleaning_repair', serviceKind: 'repair', serviceTypes: ['REPAIR'], deceasedVariant: 'repair',
    sections: ['customer', 'cemetery', 'deceased', 'repair_note', 'repair_stone', 'attachments', 'addons', 'finance'],
  },
  acid_wash: {
    label: 'Acid wash / cleaning', jobType: 'cleaning_repair', serviceKind: 'acid_wash', serviceTypes: ['ACID_WASH'], deceasedVariant: 'repair',
    sections: ['customer', 'cemetery', 'deceased', 'acidwash', 'attachments', 'finance'],
  },
}
const TYPE_KEYS = Object.keys(ORDER_TYPES)

// Grave/plot arrangement options (maps to order.plot.type).
const PLOT_TYPES = [
  { code: 'single', label: 'Single' },
  { code: 'sxs',    label: 'Side by side' },
  { code: 'dd',     label: 'Double deep' },
  { code: 'family', label: 'Family die' },
]
// Foundation type — plain text column (orders.foundation_type), extend freely.
const FOUNDATION_TYPES = ['Strip', 'Our Foundation', 'Cemetery Foundation']

// Add-on kinds the compact form supports. Priced kinds reuse the existing
// configurator math via addonPrice(); title/verse/panel/other are manual-price.
// eslint-disable-next-line react-refresh/only-export-components
export const ADDON_KINDS = [
  { code: 'etching',      label: 'Laser etching' },
  { code: 'vase',         label: 'Vase' },
  { code: 'photo',        label: 'Photo' },
  { code: 'bling',        label: 'Bling' },
  { code: 'shape-carved', label: 'Shape-carved design' },
  { code: 'title',        label: 'Additional title' },
  { code: 'verse',        label: 'Verse / epitaph' },
  { code: 'panel',        label: 'Panel' },
  { code: 'acid_wash',    label: 'Acid wash' },
  { code: 'custom_font',  label: 'Custom font (+$150)' },
  { code: 'other',        label: 'Other (manual price)' },
]
// Which add-on kinds each job type offers. (Acid-wash jobs price the wash as a
// base line, so they carry no add-ons set.)
const ADDON_SETS = {
  new_monument:           ['etching', 'vase', 'photo', 'bling', 'shape-carved', 'other'],
  additional_inscription: ['title', 'verse', 'photo', 'panel', 'acid_wash', 'etching', 'custom_font', 'other'],
  repair:                 ['acid_wash'],
}

// Edit-mode: infer the form type from the existing job/order.
function inferType(job, order) {
  if (job?.job_type === 'cleaning_repair') return job.service_kind === 'acid_wash' ? 'acid_wash' : 'repair'
  if (job?.job_type === 'inscription') return 'additional_inscription'
  if (job?.job_type === 'new_stone') return 'new_monument'
  const st = (order?.serviceTypes || []).map(s => String(s).toUpperCase())
  if (st.includes('INSCRIPTION')) return 'additional_inscription'
  if (st.includes('REPAIR')) return 'repair'
  if (st.includes('ACID_WASH')) return 'acid_wash'
  return 'new_monument'
}

// Header label — carry the surname/order# so an edit shows whose order it is
// without scrolling into the Customer card.
function headerLabel(isEdit, order) {
  const surname = order.customer?.lastName || order.deceased?.[0]?.lastName || ''
  if (!isEdit) return surname ? `New order · ${surname}` : 'New order'
  const num = order.orderNumber ? `Order ${order.orderNumber}` : 'Edit order'
  return surname ? `${num} · ${surname}` : num
}

function todayISODate() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// Short id for add-on rows / custom line items (event-handler use only).
function uid() {
  return (crypto?.randomUUID?.() || String(Math.random())).slice(0, 8)
}

// Pipeline rank for the order status (advance-only; never downgrade on save).
const STATUS_RANK = {
  draft: 0, scoping: 1, quoted: 2, contracted: 3,
  in_production: 4, installed: 5, paid_in_full: 6, closed: 7,
}
// Derive the order status from the signed toggle + the checked stage milestone.
// The form previously left status at 'draft' even for signed/in-production
// orders, forcing a manual fix in Order Detail. This advances status to match
// what was checked — and never downgrades an existing order's status.
function deriveStatus(currentStatus, markSigned, stageKey) {
  let rank = STATUS_RANK[currentStatus] ?? 0
  const bump = (code) => { rank = Math.max(rank, STATUS_RANK[code]) }
  if (markSigned) bump('contracted')
  if (stageKey) {
    const k = String(stageKey).toLowerCase()
    if (/paid/.test(k)) bump('paid_in_full')
    else if (/clos/.test(k)) bump('closed')
    else if (/install|after_photo|work_completed|\bset\b|setting/.test(k)) bump('installed')
    else if (/production|started|stencil|blast|carv|proof/.test(k)) bump('in_production')
    else if (/deposit|contract|confirmed|scheduled|plot/.test(k)) bump('contracted')
  }
  // Map the resolved rank back to a status code (highest at-or-below rank).
  const entries = Object.entries(STATUS_RANK).sort((a, b) => b[1] - a[1])
  return entries.find(([, r]) => r <= rank)?.[0] || currentStatus || 'draft'
}

// =============================================================================
// MAIN
// =============================================================================
export default function OrderForm({ orderId = null, onClose, onSaved }) {
  const isEdit = !!orderId
  const [type, setType] = useState('new_monument')
  const [order, setOrder] = useState(() => ({ ...makeBlankOrder(), serviceTypes: ORDER_TYPES.new_monument.serviceTypes }))
  const [jobId, setJobId] = useState(null)
  const [loading, setLoading] = useState(isEdit)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  // Stage backfill — index into templateMs of the furthest "done" milestone.
  // -1 = nothing done (fresh). Edit defaults to "leave unchanged" (null).
  const [templateMs, setTemplateMs] = useState([])
  const [stageIdx, setStageIdx] = useState(isEdit ? null : -1)  // null = keep (edit only)

  // Contract-signed toggle — drives signed_at (due-date math + "since signed").
  const [markSigned, setMarkSigned] = useState(false)
  const [signedDate, setSignedDate] = useState(() => todayISODate())

  // Deposit captured at entry — becomes the first payment in payments[].
  const [deposit, setDeposit] = useState({ amount: '', method: 'check', date: todayISODate() })

  // A stale "manual total override" must never silently diverge from the line
  // items: any edit that changes the priced contents clears it, so the displayed
  // and saved total fall back to the computed line-item total (which is what the
  // contract + payments use). Staff can re-enter a manual total afterward.
  const TOTAL_AFFECTING = ['addOns', 'shape', 'standardSizeCode', 'width', 'height', 'depth', 'thickness', 'graniteColor', 'serviceTypes', 'baseConfig', 'foundationType']
  const update = (patch) => setOrder(o => {
    const touchesTotal = TOTAL_AFFECTING.some(k => k in patch)
    const hasManual = o.pricing?.manualTotal != null && o.pricing?.manualTotal !== ''
    if (touchesTotal && hasManual) return { ...o, ...patch, pricing: { ...o.pricing, manualTotal: null } }
    return { ...o, ...patch }
  })
  const updatePricing = (patch) => setOrder(o => {
    const next = { ...o.pricing, ...patch }
    // Editing any pricing field other than the override itself invalidates it.
    const hasManual = o.pricing?.manualTotal != null && o.pricing?.manualTotal !== ''
    if (!('manualTotal' in patch) && hasManual) next.manualTotal = null
    return { ...o, pricing: next }
  })
  const updateInsc = (patch) => setOrder(o => ({ ...o, inscription: { ...o.inscription, ...patch } }))

  const changeType = (k) => {
    if (k === type || isEdit) return
    setType(k)
    update({ serviceTypes: ORDER_TYPES[k].serviceTypes })
  }

  // Edit load — fetch order + job, convert to wizard shape, infer type.
  useEffect(() => {
    if (!isEdit) return
    let cancelled = false
    Promise.all([getOrderById(orderId), getJobByOrderId(orderId)]).then(([row, job]) => {
      if (cancelled || !row) { if (!cancelled) { setErr('Order not found'); setLoading(false) } return }
      const ord = rowToOrder(row, row.customer, row.cemetery)
      setOrder(ord)
      setJobId(job?.id || null)
      setType(inferType(job, ord))
      if (row.signed_at) { setMarkSigned(true); setSignedDate(String(row.signed_at).slice(0, 10)) }
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [orderId, isEdit])

  // Milestone template for the current type (drives the status checklist).
  useEffect(() => {
    const cfg = ORDER_TYPES[type]
    if (!cfg) return
    let cancelled = false
    getOrderMilestoneTemplate(cfg.serviceTypes).then(ms => { if (!cancelled) setTemplateMs(ms || []) })
    return () => { cancelled = true }
  }, [type])

  const cfg = ORDER_TYPES[type]
  const sections = cfg.sections

  // ── Pricing (single source: orderRates) ──────────────────────────────────
  const lineItems = useMemo(() => computeFormLineItems(order), [order])
  const totals = useMemo(() => computeTotals(lineItems, {
    applyTax: order.pricing?.applyTax !== false,
    applyCCSurcharge: !!order.pricing?.applyCCSurcharge,
    discountType: order.pricing?.discountType,
    discountValue: order.pricing?.discountValue,
    discountPct: Number(order.pricing?.discountPct) || 0,
  }), [lineItems, order.pricing])
  const manualTotal = order.pricing?.manualTotal
  const displayedTotal = (manualTotal != null && manualTotal !== '') ? Number(manualTotal) : totals.grandTotal

  const submit = async () => {
    if (busy) return
    // Guard the silent-$0 order: a zero total with nothing parked on the
    // owner's quote list usually means a price/tier/type was missed.
    const nothingPending = !lineItems.some(it => it.quotePending)
    if (displayedTotal === 0 && nothingPending) {
      if (!window.confirm('This order totals $0 and nothing is on the owner\'s quote list. Save it anyway?')) return
    }
    setBusy(true); setErr(null)
    const signedAt = markSigned ? new Date(`${signedDate}T12:00:00`).toISOString() : null
    const stageKey = (stageIdx != null && stageIdx >= 0) ? templateMs[stageIdx]?.key : null
    const status = deriveStatus(order.status, markSigned, stageKey)

    // Deposit captured at entry → append as the first locked payment, so the
    // engine derives paid + balance from payments[] (mirrored to legacy cols on
    // save). Only on a NEW order (avoid double-adding when editing).
    let payments = Array.isArray(order.payments) ? order.payments : []
    const depAmt = Number(deposit.amount)
    // New order only, and only the first time (order.id is set after the first
    // successful save) — so a retry-after-partial-failure won't double-add it.
    if (!isEdit && !order.id && Number.isFinite(depAmt) && depAmt > 0) {
      payments = [...payments, {
        id: (crypto?.randomUUID?.() || `pay-${Date.now()}`),
        amount: depAmt, method: deposit.method, type: 'deposit',
        ref: null, receivedAt: deposit.date, createdAt: new Date().toISOString(),
        createdBy: null, note: null, locked: true,
        voided: false, voidedReason: null, voidedAt: null, voidedBy: null,
      }]
    }
    const toSave = { ...order, serviceTypes: cfg.serviceTypes, signedAt, status, payments }
    const res = await saveOrder(toSave)
    if (!res?.ok) { setBusy(false); setErr(res?.error?.message || res?.reason || 'Could not save the order'); return }
    const savedId = res.order?.id || orderId
    // Capture the new id + the deposit into local state so a retry after a
    // downstream failure (job create / backfill) UPDATES this order instead of
    // inserting a duplicate or re-appending the deposit.
    // Capture the new id AND the new customer's id (saveOrder inserts the
    // customer when there's a name/phone). Linking customer.id locally means a
    // retry UPDATEs the same customer instead of re-inserting, and confirms the
    // brand-new customer was created + linked to this order.
    if (!order.id && savedId) setOrder(o => ({
      ...o,
      id: savedId,
      customer: { ...o.customer, id: o.customer?.id || res.customerId || null },
      payments,
    }))

    // Auto-detect the permit requirement/fee/status from the selected cemetery
    // (never downgrades a submitted/approved filing; no-ops when cemetery_id is
    // null). Non-fatal — a permit-detect hiccup must not block the save.
    if (savedId) { try { await autoDetectOrderPermit(savedId) } catch { /* non-fatal */ } }

    let jid = jobId
    if (!jid) {
      const jr = await createJobFromOrder(savedId, { source: 'new_order_form', allowUnsigned: true })
      if (!jr.ok) { setBusy(false); setErr(`Order saved, but job creation failed: ${jr.error}`); return }
      jid = jr.job?.id || null
    }

    // Stage backfill — mark everything through the checked milestone done.
    // stageIdx null = leave unchanged (edit); -1 = fresh (nothing).
    if (jid && stageIdx != null && stageIdx >= 0 && templateMs[stageIdx]) {
      const br = await backfillJobMilestones(jid, templateMs[stageIdx].key)
      if (!br.ok) { setBusy(false); setErr(`Saved, but stage backfill failed: ${br.error}`); return }
    }

    // A logged deposit auto-completes contract_signed + deposit_received on the
    // job. createJobFromOrder already does this for NEW orders; this covers the
    // EDIT path (job already exists) so editing an order with a deposit still
    // ticks the deposit milestone. Deposit-gated + idempotent; non-fatal.
    if (savedId) { try { await applyDepositMilestones(savedId) } catch (e) { console.warn('applyDepositMilestones:', e?.message) } }

    setBusy(false)
    onSaved?.(savedId, jid)
  }

  if (loading) {
    return (
      <div className="of-overlay"><style>{salesModeStyles}</style><style>{OF_CSS}</style>
        <div className="of-shell"><div className="of-empty">Loading order…</div></div>
      </div>
    )
  }

  return (
    <div className="of-overlay">
      <style>{salesModeStyles}</style>
      <style>{OF_CSS}</style>
      <div className="of-shell">
        <header className="of-topbar">
          <button type="button" className="of-close" onClick={onClose}>← Close</button>
          <div className="of-title">{headerLabel(isEdit, order)}</div>
          <div className="of-headtotal">{fmtUSD(displayedTotal)}</div>
        </header>

        <div className="of-body">
          {/* Job type */}
          <div className="of-typebar">
            <span className="of-typebar-label">Job type</span>
            <div className="of-typeseg">
              {TYPE_KEYS.map(k => (
                <button key={k} type="button" className={`of-typebtn${type === k ? ' on' : ''}`}
                  onClick={() => changeType(k)} disabled={isEdit}
                  title={isEdit ? 'Type is fixed on an existing order' : ''}>
                  {ORDER_TYPES[k].label}
                </button>
              ))}
            </div>
          </div>

          {sections.includes('customer') && <CustomerCard order={order} update={update} updatePricing={updatePricing} />}
          {sections.includes('cemetery') && <CemeteryCard order={order} update={update} />}
          {sections.includes('monument') && <MonumentCard order={order} update={update} updatePricing={updatePricing} />}
          {/* Deceased FIRST so its data exists to populate the engraving text. */}
          {sections.includes('deceased') && <DeceasedCard order={order} update={update} updateInsc={updateInsc} variant={cfg.deceasedVariant} />}
          {sections.includes('inscription_type') && <InscriptionTypeCard order={order} updateInsc={updateInsc} />}
          {/* Auto-populated engraving text (same generator as the wizard) — only
              for inscription orders, right after the type, before engraver notes. */}
          {sections.includes('inscription_type') && <InscriptionCarveTextCard order={order} updateInsc={updateInsc} />}
          {sections.includes('inscription') && <InscriptionCard order={order} updateInsc={updateInsc} />}
          {sections.includes('catalog') && <CatalogPickerCard order={order} update={update} />}

          {sections.includes('repair_note') && (
            <NoteCard title="Repair details" value={order.otherServiceDescription || ''}
              onChange={v => update({ otherServiceDescription: v })}
              placeholder="Describe the repair (cracks, resetting, re-leveling, lettering touch-up…)." />
          )}
          {sections.includes('repair_stone') && <RepairStoneCard order={order} update={update} updatePricing={updatePricing} />}
          {sections.includes('acidwash') && <AcidWashCard order={order} update={update} updatePricing={updatePricing} />}

          {sections.includes('attachments') && <AttachmentsCard order={order} updatePricing={updatePricing} />}
          {sections.includes('addons') && <AddOnsCard order={order} update={update} updatePricing={updatePricing} kinds={ADDON_SETS[type] || []} />}
          {sections.includes('finance') && (
            <FinanceCard order={order} lineItems={lineItems} totals={totals} displayedTotal={displayedTotal}
              updatePricing={updatePricing} manualTotal={manualTotal} isEdit={isEdit}
              deposit={deposit} setDeposit={setDeposit}
              markSigned={markSigned} setMarkSigned={setMarkSigned} signedDate={signedDate} setSignedDate={setSignedDate} />
          )}

          {sections.includes('finance') && <QuotesManager order={order} update={update} />}

          <StatusCard isEdit={isEdit} templateMs={templateMs} stageIdx={stageIdx} setStageIdx={setStageIdx} />
        </div>

        <footer className="of-footer">
          {err && <div className="of-err">{err}</div>}
          <div className="of-footer-actions">
            <button type="button" className="of-btn" onClick={onClose} disabled={busy}>Cancel</button>
            <button type="button" className="of-btn of-btn-primary" onClick={submit} disabled={busy}>
              {busy ? (isEdit ? 'Saving…' : 'Creating…') : (isEdit ? 'Save order' : 'Create order')}
            </button>
          </div>
        </footer>
      </div>
    </div>
  )
}

// =============================================================================
// SHARED FIELD PRIMITIVES
// =============================================================================
function Card({ title, sub, children }) {
  return (
    <section className="of-card">
      <div className="of-card-head">
        <h2 className="of-card-title">{title}</h2>
        {sub && <p className="of-card-sub">{sub}</p>}
      </div>
      <div className="of-card-body">{children}</div>
    </section>
  )
}
function Grid({ cols = 2, children }) { return <div className={`of-grid of-grid-${cols}`}>{children}</div> }
function Field({ label, hint, children, full }) {
  return (
    <label className={`of-field${full ? ' of-field-full' : ''}`}>
      <span className="of-field-label">{label}</span>
      {children}
      {hint && <span className="of-field-hint">{hint}</span>}
    </label>
  )
}
function TextField({ label, value, onChange, placeholder, hint, full, type = 'text' }) {
  return (
    <Field label={label} hint={hint} full={full}>
      <input className="of-input" type={type} value={value ?? ''} placeholder={placeholder}
        onChange={e => onChange(e.target.value)} />
    </Field>
  )
}
function NumberField({ label, value, onChange, placeholder, hint, suffix }) {
  return (
    <Field label={label} hint={hint}>
      <div className="of-num-wrap">
        <input className="of-input" type="number" value={value ?? ''} placeholder={placeholder}
          onChange={e => onChange(e.target.value === '' ? null : Number(e.target.value))} />
        {suffix && <span className="of-num-suffix">{suffix}</span>}
      </div>
    </Field>
  )
}
function SelectField({ label, value, onChange, options, placeholder = 'Select…', hint, full }) {
  return (
    <Field label={label} hint={hint} full={full}>
      <select className="of-input of-select" value={value ?? ''} onChange={e => onChange(e.target.value || null)}>
        <option value="">{placeholder}</option>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </Field>
  )
}
function TextAreaField({ label, value, onChange, placeholder, rows = 3, full = true }) {
  return (
    <Field label={label} full={full}>
      <textarea className="of-input of-textarea" rows={rows} value={value ?? ''} placeholder={placeholder}
        onChange={e => onChange(e.target.value)} />
    </Field>
  )
}
function CheckRow({ checked, onChange, label, hint }) {
  return (
    <label className="of-check">
      <input type="checkbox" checked={!!checked} onChange={e => onChange(e.target.checked)} />
      <span className="of-check-text">{label}{hint && <em className="of-check-hint"> — {hint}</em>}</span>
    </label>
  )
}

// Autofill search box — debounced; on pick, hands the row up to the parent.
function AutoComplete({ search, onPick, placeholder, renderRow }) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState([])
  const [open, setOpen] = useState(false)
  const timer = useRef(null)
  const onType = (v) => {
    setQ(v)
    if (timer.current) clearTimeout(timer.current)
    if (!v || v.trim().length < 2) { setResults([]); setOpen(false); return }
    timer.current = setTimeout(() => {
      search(v).then(rows => { setResults(rows || []); setOpen(true) })
    }, 250)
  }
  const pick = (row) => { onPick(row); setQ(''); setResults([]); setOpen(false) }
  return (
    <div className="of-ac">
      <input className="of-input" value={q} placeholder={placeholder}
        onChange={e => onType(e.target.value)}
        onFocus={() => { if (results.length) setOpen(true) }} />
      {open && results.length > 0 && (
        <div className="of-ac-menu">
          {results.map((r, i) => (
            <button type="button" key={r.id || i} className="of-ac-item" onClick={() => pick(r)}>
              {renderRow(r)}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function NoteCard({ title, value, onChange, placeholder }) {
  return (
    <Card title={title}>
      <TextAreaField label="Details" value={value} onChange={onChange} placeholder={placeholder} rows={4} />
    </Card>
  )
}

// =============================================================================
// CUSTOMER & CONTACT
// =============================================================================
function CustomerCard({ order, update, updatePricing }) {
  const c = order.customer || {}
  const setC = (patch) => update({ customer: { ...c, ...patch } })
  const extras = order.pricing?.additionalContacts || []
  const setExtras = (arr) => updatePricing({ additionalContacts: arr })

  return (
    <Card title="Customer & contact" sub="Search to autofill an existing customer, or type a new one.">
      <Field label="Find existing customer" full hint="Type a last name or phone — pick to autofill.">
        <AutoComplete
          search={searchCustomers}
          onPick={(row) => setC(rowToCustomer(row))}
          placeholder="Search customers…"
          renderRow={(r) => (
            <span><strong>{r.last_name}, {r.first_name}</strong>
              {r.phone_primary ? <span className="of-ac-meta"> · {fmtPhone(r.phone_primary)}</span> : null}
              {r.city ? <span className="of-ac-meta"> · {r.city}</span> : null}</span>
          )}
        />
      </Field>
      <Grid cols={2}>
        <TextField label="First name" value={c.firstName} onChange={v => setC({ firstName: v })} />
        <TextField label="Last name" value={c.lastName} onChange={v => setC({ lastName: v })} />
        <TextField label="Primary phone" value={maskPhoneInput(c.phonePrimary)} onChange={v => setC({ phonePrimary: phoneDigits(v) })} />
        <TextField label="Alternate phone" value={maskPhoneInput(c.phoneAlt)} onChange={v => setC({ phoneAlt: phoneDigits(v) })} />
        <TextField label="Email" type="email" value={c.email} onChange={v => setC({ email: v })} />
        <TextField label="Alternate email" type="email" value={c.emailAlt} onChange={v => setC({ emailAlt: v })} />
        <TextField label="Address" value={c.addressLine1} onChange={v => setC({ addressLine1: v })} full />
        <TextField label="City" value={c.city} onChange={v => setC({ city: v })} />
        <TextField label="State" value={c.state} onChange={v => setC({ state: v })} />
        <TextField label="ZIP" value={c.zip} onChange={v => setC({ zip: v })} />
      </Grid>

      {/* Additional people / contacts */}
      <div className="of-sub">
        <div className="of-sub-head">
          <span className="of-sub-title">Additional people on this order</span>
          <button type="button" className="of-link" onClick={() => setExtras([...extras, { id: uid(), name: '', relationship: '', phone: '', email: '' }])}>+ Add additional person</button>
        </div>
        {extras.length === 0 && <p className="of-muted">No additional contacts.</p>}
        {extras.map((p, i) => (
          <div className="of-rowcard" key={p.id}>
            <Grid cols={2}>
              <TextField label="Name" value={p.name} onChange={v => setExtras(extras.map((x, j) => j === i ? { ...x, name: v } : x))} />
              <TextField label="Relationship" value={p.relationship} onChange={v => setExtras(extras.map((x, j) => j === i ? { ...x, relationship: v } : x))} placeholder="Daughter, son, executor…" />
              <TextField label="Phone" value={p.phone} onChange={v => setExtras(extras.map((x, j) => j === i ? { ...x, phone: v } : x))} />
              <TextField label="Email" value={p.email} onChange={v => setExtras(extras.map((x, j) => j === i ? { ...x, email: v } : x))} />
            </Grid>
            <button type="button" className="of-remove" onClick={() => setExtras(extras.filter((_, j) => j !== i))}>Remove</button>
          </div>
        ))}
      </div>
    </Card>
  )
}

// =============================================================================
// CEMETERY & GRAVE
// =============================================================================
function CemeteryCard({ order, update }) {
  const cem = order.cemetery || {}
  const plot = order.plot || {}
  const setCem = (patch) => update({ cemetery: { ...cem, ...patch } })
  const setPlot = (patch) => update({ plot: { ...plot, ...patch } })

  const mapUrl = () => {
    if (plot.lat != null && plot.lng != null && plot.lat !== '' && plot.lng !== '')
      return `https://www.google.com/maps/search/?api=1&query=${plot.lat},${plot.lng}&t=k`
    const q = [cem.name, cem.city, cem.state].filter(Boolean).join(' ')
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`
  }

  return (
    <Card title="Cemetery & grave" sub="Where the memorial will be installed.">
      <Field label="Find cemetery" full hint="Type a name — pick to autofill the address.">
        <AutoComplete
          search={searchCemeteries}
          onPick={(row) => setCem(rowToCemetery(row))}
          placeholder="Search cemeteries…"
          renderRow={(r) => (
            <span><strong>{r.name}</strong>{r.city ? <span className="of-ac-meta"> · {r.city}, {r.state}</span> : null}</span>
          )}
        />
      </Field>
      <Grid cols={2}>
        <TextField label="Cemetery name" value={cem.name} onChange={v => setCem({ name: v })} full />
        <TextField label="Address" value={cem.address} onChange={v => setCem({ address: v })} full />
        <TextField label="City" value={cem.city} onChange={v => setCem({ city: v })} />
        <TextField label="State" value={cem.state} onChange={v => setCem({ state: v })} />
        <TextField label="Cemetery phone" value={maskPhoneInput(cem.contactPhone)} onChange={v => setCem({ contactPhone: phoneDigits(v) })} />
      </Grid>

      <div className="of-sub">
        <span className="of-sub-title">Grave / plot</span>
        <Grid cols={2}>
          <SelectField label="Plot type" value={plot.type} onChange={v => setPlot({ type: v })}
            options={PLOT_TYPES.map(p => ({ value: p.code, label: p.label }))} placeholder="Select arrangement…" />
          <SelectField label="Foundation type" value={order.foundationType || ''} onChange={v => update({ foundationType: v || null })}
            options={FOUNDATION_TYPES.map(f => ({ value: f, label: f }))} placeholder="Not set…" />
          <TextField label="Section" value={plot.section} onChange={v => setPlot({ section: v })} />
          <TextField label="Block" value={plot.block} onChange={v => setPlot({ block: v })} />
          <TextField label="Lot" value={plot.lot} onChange={v => setPlot({ lot: v })} />
          <TextField label="Grave #" value={plot.grave} onChange={v => setPlot({ grave: v })} />
          <TextField label="Row / space" value={plot.row} onChange={v => setPlot({ row: v })} placeholder="Row or space" />
        </Grid>
        <TextAreaField label="Plot notes" value={plot.pinNotes} onChange={v => setPlot({ pinNotes: v })}
          placeholder="Landmarks, access notes, sexton instructions…" rows={2} />
        <div className="of-maprow">
          <Grid cols={2}>
            <NumberField label="Latitude" value={plot.lat} onChange={v => setPlot({ lat: v })} placeholder="40.5..." />
            <NumberField label="Longitude" value={plot.lng} onChange={v => setPlot({ lng: v })} placeholder="-74.2..." />
          </Grid>
          <a className="of-btn of-btn-ghost of-mapbtn" href={mapUrl()} target="_blank" rel="noreferrer">Open satellite map ↗</a>
        </div>
      </div>
    </Card>
  )
}

// =============================================================================
// MONUMENT (new-stone)
// =============================================================================
export function MonumentCard({ order, update, updatePricing }) {
  const shapeObj = SHAPES.find(s => s.code === order.shape) || null
  const typeCode = MONUMENT_TYPES.find(t => t.shapeCodes.includes(order.shape))?.code || ''
  const typeObj = MONUMENT_TYPES.find(t => t.code === typeCode) || null
  const isCustomSize = !!order.shape && !order.standardSizeCode

  const onType = (code) => {
    const t = MONUMENT_TYPES.find(x => x.code === code)
    if (!t) { update({ shape: null }); return }
    update({ shape: t.shapeCodes[0], standardSizeCode: null, width: null, depth: null, thickness: null, height: null, customShape: code === 'custom' ? order.customShape : null })
  }
  const onShape = (code) => update({ shape: code, standardSizeCode: null, width: null, depth: null, thickness: null, height: null })
  // Picking a standard color clears any custom-color upcharge so it can't linger.
  const onColor = (code) => {
    update({ graniteColor: code })
    if (code !== 'custom') updatePricing({ customColorName: '', customColorPct: null })
  }
  const onSize = (code) => {
    if (code === 'custom' || code === '') { update({ standardSizeCode: null }); return }
    const std = shapeObj?.standardSizes.find(s => s.code === code)
    if (!std) return
    update({ standardSizeCode: code, width: std.w, depth: std.d, thickness: std.t, height: std.t })
  }

  // Base
  const bc = order.baseConfig || {}
  const setBase = (patch) => update({ baseConfig: { ...bc, ...patch } })
  const ranked = useMemo(() => rankedBaseSizes(order.width, order.depth), [order.width, order.depth])
  const baseOptions = [
    ...ranked.ordered.map(b => ({
      value: b.code,
      label: `${b.label}${ranked.recommendedCodes.includes(b.code) ? '  ★ recommended' : (b.fits ? '' : '  (smaller than die)')}`,
    })),
    { value: 'custom', label: 'Custom size…' },
  ]
  const canHaveBase = shapeObj?.canHaveBase
  const requiresBase = shapeObj?.requiresBase

  return (
    <Card title="Monument" sub="Type, size, finish, color, and base.">
      <Grid cols={2}>
        <SelectField label="Type" value={typeCode} onChange={onType}
          options={MONUMENT_TYPES.map(t => ({ value: t.code, label: t.label }))} placeholder="Select type…" />
        {typeObj && typeObj.shapeCodes.length > 1 && (
          <SelectField label="Shape" value={order.shape} onChange={onShape}
            options={typeObj.shapeCodes.map(sc => ({ value: sc, label: SHAPES.find(s => s.code === sc)?.label || sc }))} />
        )}
        <SelectField label="Finish / polish" value={order.polishLevel} onChange={v => update({ polishLevel: v })}
          options={POLISH_LEVELS.map(p => ({ value: p.code, label: p.label }))} placeholder="Select polish…"
          hint="Spec only — no price effect." />
        <SelectField label="Granite color" value={order.graniteColor} onChange={v => onColor(v)}
          options={[
            ...GRANITE_COLORS.map(c => ({ value: c.code, label: `${c.label}${c.premium > 0 ? ` (+${Math.round(c.premium * 100)}%)` : ''}` })),
            { value: 'custom', label: 'Custom…' },
          ]}
          placeholder="Select color…" />
      </Grid>

      {order.graniteColor === 'custom' && (
        <div className="of-sub">
          <span className="of-sub-title">Custom color</span>
          <Grid cols={2}>
            <TextField label="Color name" value={order.pricing?.customColorName ?? ''}
              onChange={v => updatePricing({ customColorName: v })} placeholder="e.g. Tropical Green" />
            <NumberField label="% increase" value={order.pricing?.customColorPct} suffix="%"
              onChange={v => updatePricing({ customColorPct: v })} hint="Manual upcharge on the base stone" />
          </Grid>
        </div>
      )}

      {order.shape === 'custom' && (
        <TextAreaField label="Custom shape description" value={order.customShapeDescription}
          onChange={v => update({ customShapeDescription: v })} placeholder="Heart, cross, teardrop, angel — describe it." rows={2} />
      )}

      {shapeObj && (
        <Grid cols={2}>
          <SelectField label="Die size" value={isCustomSize ? 'custom' : order.standardSizeCode} onChange={onSize}
            options={[
              ...(shapeObj.standardSizes || []).map(s => ({ value: s.code, label: `${s.label} — ${fmtUSD(s.price)}` })),
              { value: 'custom', label: 'Custom size…' },
            ]}
            placeholder="Select size…" />
        </Grid>
      )}

      {isCustomSize && shapeObj && (
        <div className="of-sub">
          <span className="of-sub-title">Custom die size — face = length × height @ $4.55/sq in</span>
          <Grid cols={3}>
            <NumberField label="Length (L)" value={order.width} onChange={v => update({ width: v })} suffix="in" />
            <NumberField label="Thickness (front-to-back)" value={order.depth} onChange={v => update({ depth: v })} suffix="in" hint="8/10/12 sets the polish-side rate" />
            <NumberField label="Height (H)" value={order.height} onChange={v => update({ height: v })} suffix="in" />
          </Grid>
        </div>
      )}

      <CheckRow checked={order.pricing?.polishDieSides} onChange={v => updatePricing({ polishDieSides: v })}
        label="Polish die sides" hint="adds per-foot polish charge by die height" />

      {/* Base */}
      {(canHaveBase || requiresBase) && (
        <div className="of-sub">
          <CheckRow checked={bc.include || requiresBase} onChange={v => setBase({ include: v })}
            label={requiresBase ? 'Base (required for this shape)' : 'Add a base'} />
          {(bc.include || requiresBase) && (
            <>
              <Grid cols={2}>
                <SelectField label="Base size" value={bc.sizeCode} onChange={v => setBase({ sizeCode: v })}
                  options={baseOptions} placeholder="Select base…" hint="Best-fit sizes are starred." />
                <SelectField label="Base height" value={bc.heightCode != null ? String(bc.heightCode) : ''}
                  onChange={v => setBase({ heightCode: v ? Number(v) : null })}
                  options={BASE_HEIGHTS.map(h => ({ value: String(h.code), label: `${h.label} (+${fmtUSD(h.upcharge)})` }))}
                  placeholder="Select height…" />
                <SelectField label="Base finish" value={bc.finish} onChange={v => setBase({ finish: v })}
                  options={BASE_FINISHES.map(f => ({ value: f.code, label: f.label }))} placeholder="Select finish…"
                  hint="SB adds a saw-base charge." />
              </Grid>
              {bc.sizeCode === 'custom' && (
                <Grid cols={2}>
                  <NumberField label="Base width" value={bc.width} onChange={v => setBase({ width: v })} suffix="in" />
                  <NumberField label="Base depth" value={bc.depth} onChange={v => setBase({ depth: v })} suffix="in" />
                </Grid>
              )}
              <CheckRow checked={bc.polishMargin2in} onChange={v => setBase({ polishMargin2in: v })}
                label="2″ polished margin" hint="$70 per foot of base perimeter" />
            </>
          )}
        </div>
      )}

      <CheckRow checked={order.pricing?.foundationCalc !== false} onChange={v => updatePricing({ foundationCalc: v })}
        label="Include foundation" hint="auto-calculated from the footprint" />
    </Card>
  )
}

// =============================================================================
// DECEASED (per-person)
// =============================================================================
// variant: 'monument' (name + dates + side + title) · 'inscription' (name + dates
// only) · 'repair' (family name + full name + years only). Per-person fields
// differ by job type per spec.
function DeceasedCard({ order, update, updateInsc, variant = 'monument' }) {
  const people = order.deceased || []
  const setPeople = (arr) => update({ deceased: arr })
  const setP = (i, patch) => setPeople(people.map((p, j) => j === i ? { ...p, ...patch } : p))
  const showFamilyName = variant === 'monument' || variant === 'repair'
  const showTitle = variant === 'monument'
  const showSide = variant === 'monument'
  const yearsOnly = variant === 'repair'
  const yearOf = (iso) => (iso || '').slice(0, 4)

  return (
    <Card title="Deceased / honorees" sub={
      variant === 'inscription' ? 'Who is being added to the stone.'
        : variant === 'repair' ? 'Who the marker is for.'
        : 'One or more people. Add a family name if it appears on the stone.'}>
      {showFamilyName && (
        <TextField label="Family name on stone" value={order.inscription?.familyName ?? ''}
          onChange={v => updateInsc({ familyName: v })} placeholder="e.g. KOWALSKI" full
          hint="The shared surname carved across the top (leave blank to auto-derive)." />
      )}

      {people.map((p, i) => (
        <div className="of-rowcard" key={i}>
          <div className="of-rowcard-head">
            <span className="of-rowcard-title">Person {i + 1}</span>
            {people.length > 1 && (
              <button type="button" className="of-remove" onClick={() => setPeople(people.filter((_, j) => j !== i))}>Remove</button>
            )}
          </div>
          <Grid cols={2}>
            <TextField label="First name" value={p.firstName} onChange={v => setP(i, { firstName: v })} />
            <TextField label="Last name" value={p.lastName} onChange={v => setP(i, { lastName: v })} />
            {showTitle && (
              <TextField label="Title / relationship" value={p.title} onChange={v => setP(i, { title: v })}
                placeholder="Beloved Father, Husband…" full />
            )}
            {yearsOnly ? (
              <>
                <TextField label="Birth year" value={yearOf(p.dateOfBirth)} onChange={v => setP(i, { dateOfBirth: v })} placeholder="1942" />
                <TextField label="Death year" value={yearOf(p.dateOfDeath)} onChange={v => setP(i, { dateOfDeath: v })} placeholder="2021" />
              </>
            ) : (
              <>
                <TextField label="Date of birth" type="date" value={p.dateOfBirth} onChange={v => setP(i, { dateOfBirth: v })} />
                <TextField label="Date of death" type="date" value={p.dateOfDeath} onChange={v => setP(i, { dateOfDeath: v })} />
              </>
            )}
            {showSide && (
              <SelectField label="Side / position" value={p.side ?? ''} onChange={v => setP(i, { side: v })}
                options={[{ value: 'left', label: 'Left' }, { value: 'right', label: 'Right' }, { value: 'center', label: 'Center' }, { value: 'top', label: 'Top' }, { value: 'bottom', label: 'Bottom' }]}
                placeholder="—" />
            )}
            {!yearsOnly && <CheckRow checked={p.isPreNeed} onChange={v => setP(i, { isPreNeed: v })} label="Pre-need (living)" />}
          </Grid>
        </div>
      ))}
      <button type="button" className="of-link" onClick={() => setPeople([...people, makeBlankDeceased(people.length)])}>+ Add additional person</button>
    </Card>
  )
}

// =============================================================================
// INSCRIPTION (order-level)
// =============================================================================
function InscriptionCard({ order, updateInsc }) {
  const insc = order.inscription || {}
  // Custom font is handled as a $150 add-on (see ADDON_KINDS), so it's not a
  // checkbox here — avoids double-charging against buildLineItems' legacy fee.
  return (
    <Card title="Inscription" sub="Engraver notes.">
      {/* Epitaph / scripture field removed per spec. */}
      <TextAreaField label="Notes for the engraver" value={insc.customNotes} onChange={v => updateInsc({ customNotes: v })}
        placeholder="Layout preferences, fonts, anything the carver needs." rows={2} />
    </Card>
  )
}

// =============================================================================
// ADD-ONS
// =============================================================================
export function AddOnsCard({ order, update, updatePricing, kinds = [] }) {
  const addOns = order.addOns || []
  const setAddOns = (arr) => update({ addOns: arr })
  const customItems = order.pricing?.customLineItems || []
  const setCustom = (arr) => updatePricing({ customLineItems: arr })
  const kindOptions = ADDON_KINDS.filter(k => kinds.includes(k.code))
  const MANUAL_KINDS = ['other', 'title', 'verse', 'panel']

  // Recompute an add-on's price from its kind + selections (unless price was
  // hand-overridden on that row).
  const priceFor = (a) => {
    if (a.priceManual) return Number(a.price) || 0
    if (!a.kind || MANUAL_KINDS.includes(a.kind)) return Number(a.price) || 0
    return addonPrice(a.kind, { size: a.size, color: a.color, design: a.design, photoType: a.photoType, acidType: a.acidType, stoneFaceSqIn: stoneFaceArea(order) })
  }
  const labelFor = (a) => {
    if (!a.kind) return 'Add-on (pick a type)'
    const k = ADDON_KINDS.find(x => x.code === a.kind)?.label || a.kind
    if (a.kind === 'other') return a.label || 'Add-on'
    const parts = []
    if (a.kind === 'etching') parts.push(LASER_SIZES.find(s => s.code === a.size)?.label)
    if (a.kind === 'vase') parts.push(VASE_SIZES.find(s => s.code === a.size)?.label)
    if (a.kind === 'photo') { parts.push(PHOTO_TYPES.find(t => t.code === a.photoType)?.label); parts.push(PHOTO_SIZES.find(s => s.code === a.size)?.label) }
    if (a.kind === 'bling') parts.push(BLING_SIZES.find(s => s.code === a.size)?.label)
    if (a.kind === 'shape-carved') parts.push(SHAPE_CARVED_DESIGNS.find(d => d.code === a.design)?.label)
    if (a.kind === 'acid_wash') parts.push(ACID_WASH_BY_TYPE.find(t => t.code === a.acidType)?.label)
    return [k, ...parts.filter(Boolean)].join(' — ')
  }
  // Apply changes to a row, recomputing price + label.
  const setRow = (i, patch) => setAddOns(addOns.map((a, j) => {
    if (j !== i) return a
    const next = { ...a, ...patch }
    next.price = priceFor(next)
    next.label = labelFor(next)
    return next
  }))
  const addRow = () => setAddOns([...addOns, { code: `addon-${uid()}`, kind: null, size: null, color: null, design: null, photoType: 'porcelain', acidType: null, qty: 1, price: 0, label: 'Add-on (pick a type)', priceManual: false }])

  return (
    <Card title="Add-ons" sub="Extras priced on top of the base.">
      {addOns.length === 0 && <p className="of-muted">No add-ons yet.</p>}
      {addOns.map((a, i) => (
        <div className="of-rowcard" key={a.code}>
          <Grid cols={2}>
            <SelectField label="Add-on" value={a.kind} onChange={v => setRow(i, { kind: v, priceManual: false, size: defaultSizeFor(v) })}
              options={kindOptions.map(k => ({ value: k.code, label: k.label }))} placeholder="Select add-on…" />
            {a.kind === 'etching' && (
              <SelectField label="Size" value={a.size} onChange={v => setRow(i, { size: v })}
                options={LASER_SIZES.map(s => ({ value: s.code, label: `${s.label} (${s.dim})` }))} />
            )}
            {a.kind === 'vase' && (
              <SelectField label="Size" value={a.size} onChange={v => setRow(i, { size: v })}
                options={VASE_SIZES.map(s => ({ value: s.code, label: s.label }))} />
            )}
            {a.kind === 'photo' && (
              <>
                <SelectField label="Type" value={a.photoType} onChange={v => setRow(i, { photoType: v })}
                  options={PHOTO_TYPES.map(t => ({ value: t.code, label: t.label }))} />
                <SelectField label="Size" value={a.size} onChange={v => setRow(i, { size: v })}
                  options={PHOTO_SIZES.map(s => ({ value: s.code, label: `${s.label} (${s.dim})` }))} />
              </>
            )}
            {a.kind === 'bling' && (
              <SelectField label="Size" value={a.size} onChange={v => setRow(i, { size: v })}
                options={BLING_SIZES.map(s => ({ value: s.code, label: `${s.label} (${s.dim})` }))} />
            )}
            {a.kind === 'shape-carved' && (
              <SelectField label="Design" value={a.design} onChange={v => setRow(i, { design: v })}
                options={SHAPE_CARVED_DESIGNS.map(d => ({ value: d.code, label: d.label }))} placeholder="Select design…" />
            )}
            {a.kind === 'acid_wash' && (
              <SelectField label="Monument type" value={a.acidType} onChange={v => setRow(i, { acidType: v })}
                options={ACID_WASH_BY_TYPE.map(t => ({ value: t.code, label: `${t.label} — ${fmtUSD(t.price)}` }))} placeholder="Select type…" />
            )}
            {a.kind === 'other' && (
              <TextField label="Description" value={a.label} onChange={v => setRow(i, { label: v })} placeholder="What is it?" />
            )}
            {(a.kind === 'vase' || a.kind === 'bling') && (
              <SelectField label="Color upcharge" value={a.color} onChange={v => setRow(i, { color: v })}
                options={GRANITE_COLORS.filter(c => c.premium > 0).map(c => ({ value: c.code, label: `${c.label} (+${Math.round(c.premium * 100)}%)` }))}
                placeholder="Match stone (no upcharge)" />
            )}
          </Grid>
          <div className="of-rowcard-foot">
            <NumberField label="Qty" value={a.qty} onChange={v => setRow(i, { qty: v || 1 })} />
            <Field label="Price (each)">
              <div className="of-num-wrap">
                <span className="of-num-prefix">$</span>
                <input className="of-input" type="number" value={a.price ?? 0}
                  onChange={e => setAddOns(addOns.map((x, j) => j === i ? { ...x, price: Number(e.target.value), priceManual: true } : x))} />
              </div>
            </Field>
            <div className="of-rowcard-amt">{fmtUSD((Number(a.price) || 0) * (Number(a.qty) || 1))}</div>
            <button type="button" className="of-remove" onClick={() => setAddOns(addOns.filter((_, j) => j !== i))}>Remove</button>
          </div>
        </div>
      ))}
      <button type="button" className="of-link" onClick={addRow}>+ Add add-on</button>

      {/* Custom shape / color → manual price or owner quote */}
      <div className="of-sub">
        <div className="of-sub-head">
          <span className="of-sub-title">Custom shape / color & quote items</span>
          <button type="button" className="of-link" onClick={() => setCustom([...customItems, { id: uid(), label: '', amount: 0, quotePending: false }])}>+ Add custom item</button>
        </div>
        {customItems.length === 0 && <p className="of-muted">No custom items.</p>}
        {customItems.map((it) => (
          <div className="of-rowcard" key={it.id}>
            <Grid cols={2}>
              <TextField label="Description" value={it.label} onChange={v => setCustom(customItems.map(x => x.id === it.id ? { ...x, label: v } : x))} placeholder="Custom shape, special color, one-off…" full />
            </Grid>
            <div className="of-rowcard-foot">
              <Field label="Price">
                <div className="of-num-wrap">
                  <span className="of-num-prefix">$</span>
                  <input className="of-input" type="number" value={it.amount ?? 0} disabled={it.quotePending}
                    onChange={e => setCustom(customItems.map(x => x.id === it.id ? { ...x, amount: Number(e.target.value) } : x))} />
                </div>
              </Field>
              <CheckRow checked={it.quotePending} label="Add to owner's quote list"
                onChange={v => setCustom(customItems.map(x => x.id === it.id ? { ...x, quotePending: v } : x))} />
              <button type="button" className="of-remove" onClick={() => setCustom(customItems.filter(x => x.id !== it.id))}>Remove</button>
            </div>
            {it.quotePending && <p className="of-quote-note">Excluded from the total until the owner sets a price.</p>}
          </div>
        ))}
      </div>
    </Card>
  )
}
function defaultSizeFor(kind) {
  switch (kind) {
    case 'etching': return 'sm'
    case 'vase': return VASE_SIZES[0].code
    case 'photo': return PHOTO_SIZES[0].code
    case 'bling': return BLING_SIZES[0].code
    default: return null
  }
}

// =============================================================================
// INSCRIPTION TYPE (additional-inscription base price)
// =============================================================================
function InscriptionTypeCard({ order, updateInsc }) {
  const tier = order.inscription?.tier || null
  return (
    <Card title="Inscription type" sub="Sets the base price for this inscription.">
      <div className="of-tier-row">
        {INSCRIPTION_TIERS.map(t => (
          <button type="button" key={t.code}
            className={`of-tier${tier === t.code ? ' on' : ''}`}
            onClick={() => updateInsc({ tier: t.code })}>
            <span className="of-tier-label">{t.label}</span>
            <span className="of-tier-price">{fmtUSD(t.price)}</span>
          </button>
        ))}
      </div>
    </Card>
  )
}

// =============================================================================
// INSCRIPTION CARVE TEXT — auto-populated engraving text (shared generator)
// =============================================================================
// Mirrors the wizard's behavior: auto-fills from the deceased name/dates + the
// inscription tier, regenerating on any input/tier change UNLESS staff have
// edited it. Distinct from the "Notes for the engraver" box (free text) — this
// is the exact text to carve.
function InscriptionCarveTextCard({ order, updateInsc }) {
  const insc = order.inscription || {}
  const carveInputsKey = JSON.stringify((order.deceased || []).map(d =>
    [d.firstName, d.middleName, d.lastName, d.dateOfBirth, d.dateOfDeath, d.isReserved]))
  const autoCarveText = useMemo(
    () => generateCarveText(order),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [insc.tier, insc.type, carveInputsKey],
  )
  useEffect(() => {
    if (insc.carveTextEdited) return
    if ((insc.carveText || '') !== autoCarveText) {
      updateInsc({ carveText: autoCarveText })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoCarveText, insc.carveTextEdited])

  // Until a tier is picked there's nothing to auto-fill from.
  if (!insc.tier) return null

  return (
    <Card title="Engraving text" sub="Exactly what gets carved — auto-filled from the name & dates, editable.">
      <textarea
        className="of-input of-carve-text"
        value={insc.carveText || ''}
        onChange={e => updateInsc({ carveText: e.target.value, carveTextEdited: true })}
        rows={insc.tier === 'full' ? 3 : 2}
        placeholder="Auto-fills from the deceased name and dates"
        spellCheck={false}
      />
      <div className="of-carve-foot">
        {insc.carveTextEdited ? (
          <>
            <span className="of-carve-edited">Manually edited</span>
            <button type="button" className="of-link"
              onClick={() => updateInsc({ carveText: autoCarveText, carveTextEdited: false })}>
              ↻ Reset to auto
            </button>
          </>
        ) : (
          <span className="of-muted">Auto-generated. Type to override.</span>
        )}
      </div>
    </Card>
  )
}

// =============================================================================
// CATALOG PICKER (reuses the Sales Portal monuments catalog + design snapshot)
// =============================================================================
function catalogThumb(url) {
  if (!url) return url
  if (url.includes('drive.google.com')) return url.replace(/sz=w\d+/i, 'sz=w400')
  return url
}
function CatalogPickerCard({ order, update }) {
  const [all, setAll] = useState([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const designs = order.designs || []

  useEffect(() => {
    let cancelled = false
    fetchMonuments().then(rows => { if (!cancelled) { setAll(rows || []); setLoading(false) } })
    return () => { cancelled = true }
  }, [])

  const results = useMemo(() => {
    if (!q.trim()) return all.slice(0, 3)   // teaser row of 3 until they search
    const needle = q.trim().toLowerCase()
    return all.filter(m =>
      String(m.lastname || '').toLowerCase().includes(needle) ||
      String(m.name || '').toLowerCase().includes(needle) ||
      (m.tags || []).some(t => String(t).toLowerCase().includes(needle))
    ).slice(0, 12)
  }, [q, all])

  const isPicked = (id) => designs.some(d => d.id === id)
  const toggle = (m) => {
    if (isPicked(m.id)) { update({ designs: designs.filter(d => d.id !== m.id) }); return }
    const snapshot = {
      id: m.id, lastname: m.lastname, name: m.name, img: m.img,
      carve_type: m.carve_type, granite_color: m.granite_color,
      cats: m.cats, tags: m.tags, description: m.description,
    }
    update({ designs: [...designs, { id: m.id, snapshot, note: '' }] })
  }
  const setNote = (id, note) => update({ designs: designs.map(d => d.id === id ? { ...d, note } : d) })

  return (
    <Card title="Catalog reference" sub="Search the design catalog, pick a reference, and note what to match.">
      <Field label="Search the catalog" full hint="Search by family name (e.g. “Diaz”), design name, or element.">
        <input className="of-input" value={q} onChange={e => setQ(e.target.value)} placeholder="Search designs…" />
      </Field>
      {loading ? <p className="of-muted">Loading catalog…</p> : (
        <div className="of-cat-grid">
          {results.map(m => (
            <button type="button" key={m.id} className={`of-cat-card${isPicked(m.id) ? ' on' : ''}`} onClick={() => toggle(m)}>
              {m.img ? <img src={catalogThumb(m.img)} alt={m.name || m.lastname || 'design'} loading="lazy" />
                : <div className="of-cat-noimg">No image</div>}
              <span className="of-cat-name">{m.lastname || m.name || 'Design'}</span>
            </button>
          ))}
          {results.length === 0 && <p className="of-muted">No matches — keep typing.</p>}
        </div>
      )}

      {designs.length > 0 && (
        <div className="of-sub">
          <span className="of-sub-title">Selected references</span>
          {designs.map(d => (
            <div className="of-rowcard of-cat-selected" key={d.id}>
              {d.snapshot?.img ? <img className="of-cat-selthumb" src={catalogThumb(d.snapshot.img)} alt="" /> : <div className="of-cat-selthumb of-cat-noimg">No image</div>}
              <div className="of-cat-selbody">
                <div className="of-cat-selname">{d.snapshot?.lastname || d.snapshot?.name || d.id}</div>
                <TextField label="Match to this" value={d.note ?? ''} onChange={v => setNote(d.id, v)}
                  placeholder="What should we match — layout, lettering, the rose, etc." full />
              </div>
              <button type="button" className="of-remove" onClick={() => toggle({ id: d.id })}>Remove</button>
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}

// =============================================================================
// ATTACHMENTS (drag-drop, reuses uploadAttachment → orders-attachments bucket)
// =============================================================================
function AttachmentsCard({ order, updatePricing }) {
  const files = order.pricing?.attachments || []
  const [busy, setBusy] = useState(false)
  const [drag, setDrag] = useState(false)
  const [err, setErr] = useState(null)
  const inputRef = useRef(null)

  const addFiles = async (fileList) => {
    const arr = Array.from(fileList || [])
    if (arr.length === 0) return
    setBusy(true); setErr(null)
    const uploaded = []
    for (const f of arr) {
      const r = await uploadAttachment(f, order.id)
      if (r) uploaded.push({ url: r.url, path: r.path, name: f.name, type: f.type })
      else setErr('One or more files failed to upload.')
    }
    setBusy(false)
    if (uploaded.length) updatePricing({ attachments: [...files, ...uploaded] })
  }
  const onDrop = (e) => { e.preventDefault(); setDrag(false); addFiles(e.dataTransfer?.files) }

  return (
    <Card title="Attachments" sub="Photos, paperwork, sketches — drag in or browse.">
      <div className={`of-drop${drag ? ' drag' : ''}`}
        onDragOver={e => { e.preventDefault(); setDrag(true) }}
        onDragLeave={() => setDrag(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}>
        <input ref={inputRef} type="file" multiple hidden onChange={e => { addFiles(e.target.files); if (inputRef.current) inputRef.current.value = '' }} />
        <span className="of-drop-text">{busy ? 'Uploading…' : 'Drag files here, or click to browse'}</span>
      </div>
      {err && <p className="of-quote-note" style={{ color: '#b3261e' }}>{err}</p>}
      {files.length > 0 && (
        <div className="of-filelist">
          {files.map((f, i) => (
            <div className="of-filerow" key={f.path || i}>
              <a className="of-filelink" href={f.url} target="_blank" rel="noreferrer">{f.name || 'attachment'}</a>
              <button type="button" className="of-remove" onClick={() => updatePricing({ attachments: files.filter((_, j) => j !== i) })}>Remove</button>
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}

// =============================================================================
// REPAIR STONE (type + size + base description; owner-quoted pricing)
// =============================================================================
function RepairStoneCard({ order, update, updatePricing }) {
  const pr = order.pricing || {}
  const bc = order.baseConfig || {}
  return (
    <Card title="Stone & pricing" sub="Describe the marker. Repair pricing is set by the owner.">
      <Grid cols={2}>
        <SelectField label="Monument type" value={pr.repairType} onChange={v => updatePricing({ repairType: v })}
          options={MONUMENT_TYPES.map(t => ({ value: t.code, label: t.label }))} placeholder="Select type…" />
        <TextField label="Approx. size" value={pr.repairSizeNote ?? ''} onChange={v => updatePricing({ repairSizeNote: v })}
          placeholder='e.g. 30" × 12" slant' />
      </Grid>
      <CheckRow checked={bc.include} onChange={v => update({ baseConfig: { ...bc, include: v } })} label="Has a base" />
      <div className="of-sub">
        <span className="of-sub-title">Pricing</span>
        <div className="of-rowcard-foot">
          <Field label="Price">
            <div className="of-num-wrap">
              <span className="of-num-prefix">$</span>
              <input className="of-input" type="number" value={pr.repairPrice ?? ''} disabled={pr.repairQuote}
                onChange={e => updatePricing({ repairPrice: e.target.value === '' ? null : Number(e.target.value) })} />
            </div>
          </Field>
          <CheckRow checked={pr.repairQuote} label="Send to owner's quote list"
            onChange={v => updatePricing({ repairQuote: v })} />
        </div>
        {pr.repairQuote && <p className="of-quote-note">Excluded from the total until the owner sets a price.</p>}
      </div>
    </Card>
  )
}

// =============================================================================
// ACID WASH (price scales by monument type; override + owner-quote)
// =============================================================================
function AcidWashCard({ order, update, updatePricing }) {
  const pr = order.pricing || {}
  const scalePrice = ACID_WASH_BY_TYPE.find(t => t.code === pr.acidWashType)?.price
  return (
    <Card title="Acid wash / cleaning" sub="Price scales by monument type; override or quote as needed.">
      <Grid cols={2}>
        <SelectField label="Monument type" value={pr.acidWashType} onChange={v => updatePricing({ acidWashType: v })}
          options={ACID_WASH_BY_TYPE.map(t => ({ value: t.code, label: `${t.label} — ${fmtUSD(t.price)}` }))} placeholder="Select type…" />
        <Field label="Price override" hint={scalePrice != null ? `Scale default: ${fmtUSD(scalePrice)}` : 'Pick a type for the default'}>
          <div className="of-num-wrap">
            <span className="of-num-prefix">$</span>
            <input className="of-input" type="number" value={pr.acidWashPrice ?? ''} disabled={pr.acidWashQuote}
              placeholder={scalePrice != null ? String(scalePrice) : ''}
              onChange={e => updatePricing({ acidWashPrice: e.target.value === '' ? null : Number(e.target.value) })} />
          </div>
        </Field>
      </Grid>
      <CheckRow checked={pr.acidWashQuote} label="Send to owner's quote list"
        onChange={v => updatePricing({ acidWashQuote: v })} />
      <TextAreaField label="Cleaning details" value={order.otherServiceDescription || ''}
        onChange={v => update({ otherServiceDescription: v })}
        placeholder="Scope of the cleaning / acid wash, stone condition, anything to note." rows={3} />
    </Card>
  )
}

// =============================================================================
// LINE ITEMS BOX — derived lines + per-line $ override + remove + add custom +
// per-line taxable/discountable flags. Backed entirely by computeFormLineItems
// (passed in as `lineItems`) and order.pricing.{lineItemOverrides,
// customLineItems, removedLineItems, lineItemFlagOverrides} via updatePricing.
// Extracted from FinanceCard so the SAME box renders inside each multi-quote
// panel (QuotesManager) — one implementation, mount-agnostic.
// =============================================================================
export function LineItemsBox({ order, lineItems, updatePricing }) {
  const p = order.pricing || {}
  const overrides = p.lineItemOverrides || {}
  const customItems = p.customLineItems || []
  const setOverride = (code, val) => updatePricing({ lineItemOverrides: { ...overrides, [code]: val === '' ? '' : Number(val) } })
  const clearOverride = (code) => { const next = { ...overrides }; delete next[code]; updatePricing({ lineItemOverrides: next }) }
  const setCustom = (arr) => updatePricing({ customLineItems: arr })
  const setCustomField = (id, patch) => setCustom(customItems.map(c => c.id === id ? { ...c, ...patch } : c))
  const addCustom = () => setCustom([...customItems, { id: uid(), label: '', amount: 0, quotePending: false }])
  const removeCustom = (id) => setCustom(customItems.filter(c => c.id !== id))

  const removed = p.removedLineItems || []
  const removeDerived = (it) => updatePricing({ removedLineItems: [...removed.filter(r => r.code !== it.code), { code: it.code, label: it.label }] })
  const restoreDerived = (code) => updatePricing({ removedLineItems: removed.filter(r => r.code !== code) })

  const flagOv = p.lineItemFlagOverrides || {}
  const setFlag = (it, key, val) => it.custom
    ? setCustomField(it.code, { [key]: val })
    : updatePricing({ lineItemFlagOverrides: { ...flagOv, [it.code]: { ...(flagOv[it.code] || {}), [key]: val } } })

  return (
    <div className="of-li">
      {lineItems.map((it, i) => {
        const isCustom = !!it.custom
        const overridden = !isCustom && overrides[it.code] != null && overrides[it.code] !== ''
        return (
          <div key={`${it.code}-${i}`}>
          <div className="of-li-row of-li-edit">
            {isCustom ? (
              <input className="of-input of-li-label-input" value={it.label === 'Custom item' ? '' : it.label}
                placeholder="Custom line item" onChange={e => setCustomField(it.code, { label: e.target.value })} />
            ) : (
              <span className="of-li-label">{it.label}</span>
            )}
            {it.quotePending ? (
              <span className="of-li-amt of-li-amt-quote">$— (owner quote)</span>
            ) : (
              <div className="of-num-wrap of-li-amt-wrap">
                <span className="of-num-prefix">$</span>
                <input className="of-input of-li-amt-input" type="number" value={Number(it.amount) || 0}
                  onChange={e => isCustom
                    ? setCustomField(it.code, { amount: e.target.value === '' ? 0 : Number(e.target.value) })
                    : setOverride(it.code, e.target.value)} />
              </div>
            )}
            <span style={{ display: 'flex', alignItems: 'center', gap: 2, justifySelf: 'end' }}>
              {!isCustom && overridden && (
                <button type="button" className="of-li-x" title="Reset to calculated amount" onClick={() => clearOverride(it.code)}>↻</button>
              )}
              <button type="button" className="of-li-x" title="Remove line item"
                onClick={() => isCustom ? removeCustom(it.code) : removeDerived(it)}>×</button>
            </span>
          </div>
          {!it.quotePending && (
            <div style={{ display: 'flex', gap: 14, alignItems: 'center', padding: '1px 2px 7px', fontSize: 12, color: 'var(--sb-text-muted, #8a7f6c)' }}>
              <label style={{ display: 'flex', gap: 4, alignItems: 'center', cursor: 'pointer' }}>
                <input type="checkbox" checked={it.taxable !== false} onChange={e => setFlag(it, 'taxable', e.target.checked)} /> Taxable
              </label>
              <label style={{ display: 'flex', gap: 4, alignItems: 'center', cursor: 'pointer' }}>
                <input type="checkbox" checked={it.discountable !== false} onChange={e => setFlag(it, 'discountable', e.target.checked)} /> Discountable
              </label>
              {it.category && <span style={{ opacity: 0.7, textTransform: 'capitalize' }}>{it.category}</span>}
            </div>
          )}
          </div>
        )
      })}
      {lineItems.length === 0 && <p className="of-muted">No line items yet — pick a size, add an add-on, or add a line below.</p>}
      {removed.length > 0 && (
        <div className="of-li-removed" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginTop: 8, fontSize: 13 }}>
          <span className="of-muted">Removed:</span>
          {removed.map(r => (
            <button key={r.code} type="button" className="of-link" title="Restore this line item"
              onClick={() => restoreDerived(r.code)}>{r.label || r.code} ↩</button>
          ))}
        </div>
      )}
      <button type="button" className="of-link of-li-add" onClick={addCustom}>+ Add line item</button>
    </div>
  )
}

// =============================================================================
// FINANCIAL + signed date
// =============================================================================
function FinanceCard({ order, lineItems, totals, displayedTotal, updatePricing, manualTotal, isEdit, deposit, setDeposit, markSigned, setMarkSigned, signedDate, setSignedDate }) {
  const p = order.pricing || {}
  const hasManual = manualTotal != null && manualTotal !== ''
  const ownerQuoteItems = lineItems.filter(it => it.quotePending)

  // Discount type (% or $). Reads the new fields with a fall back to legacy discountPct.
  const discType = p.discountType || 'pct'
  const discValue = (p.discountValue != null && p.discountValue !== '') ? p.discountValue : (p.discountPct ?? '')
  const setDiscount = (patch) => {
    const next = { discountType: discType, discountValue: discValue, ...patch }
    // Mirror to legacy discountPct so any un-migrated reader stays correct.
    next.discountPct = next.discountType === 'pct' ? (Number(next.discountValue) || 0) : 0
    updatePricing(next)
  }
  const discLabel = discType === 'amount'
    ? `Discount (${fmtUSD(Number(discValue) || 0)})`
    : `Discount (${Number(discValue) || 0}%)`

  return (
    <Card title="Financial" sub="Line items, taxes, and the total. Everything here is hand-adjustable.">
      <LineItemsBox order={order} lineItems={lineItems} updatePricing={updatePricing} />

      <div className="of-toggles">
        <CheckRow checked={p.applyTax !== false} onChange={v => updatePricing({ applyTax: v })} label="Apply NJ sales tax (6.625%)" />
        <CheckRow checked={!!p.applyCCSurcharge} onChange={v => updatePricing({ applyCCSurcharge: v })} label="Add 3% credit-card surcharge" />
        <div className="of-discount" style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
          <SelectField label="Discount" value={discType} onChange={v => setDiscount({ discountType: v })}
            options={[{ value: 'pct', label: '% off' }, { value: 'amount', label: '$ off' }]} />
          <NumberField label={discType === 'amount' ? 'Amount ($)' : 'Amount (%)'} value={discValue}
            onChange={v => setDiscount({ discountValue: v === '' ? '' : Number(v) })}
            suffix={discType === 'amount' ? '' : '%'} />
        </div>
      </div>

      <div className="of-totals">
        <div className="of-tot-row"><span>Subtotal</span><span>{fmtUSD(totals.subtotalDisc)}</span></div>
        {totals.discountAmt > 0 && <div className="of-tot-row of-tot-neg"><span>{discLabel}</span><span>−{fmtUSD(totals.discountAmt)}</span></div>}
        {totals.subtotalPermit > 0 && <div className="of-tot-row"><span>Fees (permit/cemetery — not taxed)</span><span>{fmtUSD(totals.subtotalPermit)}</span></div>}
        {totals.tax > 0 && <div className="of-tot-row"><span>NJ tax</span><span>{fmtUSD(totals.tax)}</span></div>}
        {totals.cc > 0 && <div className="of-tot-row"><span>CC surcharge</span><span>{fmtUSD(totals.cc)}</span></div>}
        <div className={`of-tot-row of-tot-grand${hasManual ? ' of-tot-struck' : ''}`}><span>Calculated total</span><span>{fmtUSD(totals.grandTotal)}</span></div>
      </div>

      <div className="of-manual">
        <Field label="Manual total override" hint="Sticks once set — edits to line items won't change it.">
          <div className="of-num-wrap">
            <span className="of-num-prefix">$</span>
            <input className="of-input" type="number" value={manualTotal ?? ''} placeholder={String(totals.grandTotal)}
              onChange={e => updatePricing({ manualTotal: e.target.value === '' ? null : Number(e.target.value) })} />
          </div>
        </Field>
        {hasManual && <button type="button" className="of-link" onClick={() => updatePricing({ manualTotal: null })}>Reset to calculated</button>}
      </div>

      <div className="of-grandfinal"><span>Order total</span><span>{fmtUSD(displayedTotal)}</span></div>

      {ownerQuoteItems.length > 0 && (
        <div className="of-ownerquote">
          <span className="of-ownerquote-title">On the owner's quote list</span>
          {ownerQuoteItems.map((it, i) => <div key={i} className="of-ownerquote-item">{it.label}</div>)}
        </div>
      )}

      {!isEdit && (
        <div className="of-sub">
          <span className="of-sub-title">Deposit taken at signing</span>
          <Grid cols={3}>
            <Field label="Amount">
              <div className="of-num-wrap">
                <span className="of-num-prefix">$</span>
                <input className="of-input" type="number" value={deposit.amount}
                  onChange={e => setDeposit(d => ({ ...d, amount: e.target.value }))} placeholder="0" />
              </div>
            </Field>
            <SelectField label="Method" value={deposit.method} onChange={v => setDeposit(d => ({ ...d, method: v }))}
              options={[{ value: 'cash', label: 'Cash' }, { value: 'check', label: 'Check' }, { value: 'card', label: 'Card' }, { value: 'zelle', label: 'Zelle' }, { value: 'other', label: 'Other' }]} />
            <Field label="Date">
              <input className="of-input" type="date" value={deposit.date} onChange={e => setDeposit(d => ({ ...d, date: e.target.value }))} />
            </Field>
          </Grid>
          <p className="of-field-hint">Leave blank if no deposit was taken — you can record payments later from the order.</p>
        </div>
      )}

      <div className="of-sub">
        <CheckRow checked={markSigned} onChange={setMarkSigned} label="Contract signed" />
        {markSigned && (
          <Field label="Signed date">
            <input type="date" className="of-input of-signeddate" value={signedDate} onChange={e => setSignedDate(e.target.value)} />
          </Field>
        )}
        <p className="of-field-hint">Leave unchecked for an entered/active order — keeps the "since signed" clock clean.</p>
      </div>
    </Card>
  )
}

// =============================================================================
// STATUS / STAGE (multi-select milestone checklist)
// =============================================================================
function StatusCard({ isEdit, templateMs, stageIdx, setStageIdx }) {
  // Clicking milestone i fills the checklist through i. Clicking the current
  // furthest unsets it back one. backfillJobMilestones marks everything ≤ the
  // checked milestone done, so the checklist is naturally cumulative.
  const onToggle = (i) => {
    if (stageIdx === i) setStageIdx(i - 1)
    else setStageIdx(i)
  }
  return (
    <Card title="Status & stage" sub="Check off what's already done — the job lands at its real status.">
      {isEdit && (
        <CheckRow checked={stageIdx === null} onChange={(v) => setStageIdx(v ? null : -1)}
          label="Leave milestones unchanged" hint="don't touch the existing job stage" />
      )}
      {(!isEdit || stageIdx !== null) && (
        <div className="of-checklist">
          {templateMs.length === 0 && <p className="of-muted">No milestone template for this type.</p>}
          {templateMs.map((m, i) => (
            <label className="of-check" key={m.key}>
              <input type="checkbox" checked={stageIdx != null && i <= stageIdx} onChange={() => onToggle(i)} />
              <span className="of-check-text">{m.label}</span>
            </label>
          ))}
        </div>
      )}
    </Card>
  )
}

// =============================================================================
// STYLES
// =============================================================================
// eslint-disable-next-line react-refresh/only-export-components
export const OF_CSS = `
  .of-overlay { position: fixed; inset: 0; z-index: 950; background: var(--cream, #faf8f4); display: flex; flex-direction: column;
    font-family: var(--font-b, 'Lato'), 'Helvetica Neue', sans-serif; color: var(--text, #2a2a2a); }
  .of-overlay input, .of-overlay select, .of-overlay textarea, .of-overlay button { font-family: var(--font-b, 'Lato'), sans-serif; }
  .of-shell { display: flex; flex-direction: column; height: 100%; }
  .of-empty { margin: auto; color: #8a8a85; font-size: 15px; }

  .of-topbar { display: flex; align-items: center; gap: 16px; padding: 14px 24px; border-bottom: 0.5px solid #d8d6d1; background: #fff; flex-shrink: 0; }
  .of-close { background: none; border: none; font: inherit; font-size: 14px; color: #6b6b66; cursor: pointer; }
  .of-close:hover { color: #111; }
  .of-title { font-family: var(--font-d, 'Playfair Display'), Georgia, serif; font-size: 18px; font-weight: 600; color: #111; flex: 1 1 auto; }
  .of-headtotal { font-size: 18px; font-weight: 700; color: #1e2d3d; font-variant-numeric: tabular-nums; }

  .of-body { flex: 1 1 auto; overflow-y: auto; padding: 20px 24px 40px; max-width: 880px; width: 100%; margin: 0 auto; box-sizing: border-box; }

  .of-typebar { display: flex; align-items: center; gap: 12px; margin-bottom: 18px; flex-wrap: wrap; }
  .of-typebar-label { font-size: 13px; color: #8a8a85; font-weight: 600; }
  .of-typeseg { display: inline-flex; gap: 4px; background: #ece9e3; border-radius: 10px; padding: 4px; flex-wrap: wrap; }
  .of-typebtn { font: inherit; font-size: 13px; font-weight: 500; padding: 7px 14px; border: none; border-radius: 7px; background: none; color: #555; cursor: pointer; }
  .of-typebtn:hover:not(:disabled) { color: #111; }
  .of-typebtn.on { background: #fff; color: #9A7209; font-weight: 700; box-shadow: 0 1px 2px rgba(0,0,0,0.08); }
  .of-typebtn:disabled { cursor: default; opacity: 0.7; }

  .of-card { background: #fff; border: 0.5px solid #d8d6d1; border-radius: 14px; padding: 20px 22px; margin-bottom: 16px; }
  .of-card-head { margin-bottom: 16px; }
  .of-card-title { font-family: var(--font-d, 'Playfair Display'), Georgia, serif; font-size: 17px; font-weight: 600; color: #111; margin: 0; }
  .of-card-sub { font-size: 12.5px; color: #8a8a85; margin: 4px 0 0; }
  .of-card-body { display: flex; flex-direction: column; gap: 14px; }

  .of-grid { display: grid; gap: 12px 16px; }
  .of-grid-2 { grid-template-columns: 1fr 1fr; }
  .of-grid-3 { grid-template-columns: 1fr 1fr 1fr; }

  .of-field { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
  .of-field-full { grid-column: 1 / -1; }
  .of-field-label { font-size: 12px; font-weight: 600; color: #555; }
  .of-field-hint { font-size: 11.5px; color: #a0a09a; }
  .of-input { font: inherit; font-size: 14px; padding: 9px 11px; border: 0.5px solid #d8d6d1; border-radius: 8px; background: #fff; color: #111; width: 100%; box-sizing: border-box; }
  .of-input:focus { outline: none; border-color: #9A7209; box-shadow: 0 0 0 2px rgba(154,114,9,0.12); }
  .of-input:disabled { background: #f3f2ef; color: #9a9a94; }
  .of-select { cursor: pointer; }
  .of-textarea { resize: vertical; }
  .of-num-wrap { position: relative; display: flex; align-items: center; }
  .of-num-suffix { position: absolute; right: 11px; font-size: 12px; color: #a0a09a; pointer-events: none; }
  .of-num-prefix { position: absolute; left: 11px; font-size: 13px; color: #777; pointer-events: none; }
  .of-num-wrap .of-input { padding-left: 22px; }

  .of-check { display: inline-flex; align-items: flex-start; gap: 8px; font-size: 13.5px; color: #222; cursor: pointer; line-height: 1.4; }
  .of-check input { margin-top: 2px; }
  .of-check-hint { color: #a0a09a; font-style: normal; }
  .of-check-text em { color: #a0a09a; font-style: italic; }

  .of-sub { border-top: 0.5px dashed #e0ded9; padding-top: 14px; display: flex; flex-direction: column; gap: 12px; }
  .of-sub-head { display: flex; align-items: center; justify-content: space-between; }
  .of-sub-title { font-size: 13px; font-weight: 600; color: #555; }
  .of-muted { font-size: 13px; color: #a0a09a; margin: 0; }

  .of-link { background: none; border: none; font: inherit; font-size: 13px; font-weight: 600; color: #9A7209; cursor: pointer; padding: 0; align-self: flex-start; }
  .of-link:hover { color: #876307; text-decoration: underline; }

  .of-rowcard { border: 0.5px solid #e4e2dd; border-radius: 10px; padding: 14px; background: #fbfaf8; display: flex; flex-direction: column; gap: 12px; }
  .of-rowcard-head { display: flex; align-items: center; justify-content: space-between; }
  .of-rowcard-title { font-size: 13px; font-weight: 700; color: #333; }
  .of-rowcard-foot { display: flex; align-items: flex-end; gap: 14px; flex-wrap: wrap; }
  .of-rowcard-foot .of-field { width: 110px; }
  .of-rowcard-amt { font-size: 15px; font-weight: 700; color: #1e2d3d; margin-left: auto; font-variant-numeric: tabular-nums; }
  .of-remove { background: none; border: none; font: inherit; font-size: 12.5px; color: #b3261e; cursor: pointer; padding: 0; }
  .of-remove:hover { text-decoration: underline; }
  .of-quote-note { font-size: 12px; color: #9A7209; margin: 0; }

  .of-maprow { display: flex; align-items: flex-end; gap: 14px; flex-wrap: wrap; }
  .of-maprow .of-grid { flex: 1 1 auto; }
  .of-mapbtn { white-space: nowrap; text-decoration: none; }

  .of-ac { position: relative; }
  .of-ac-menu { position: absolute; top: calc(100% + 4px); left: 0; right: 0; background: #fff; border: 0.5px solid #d8d6d1; border-radius: 10px; box-shadow: 0 8px 24px rgba(0,0,0,0.12); z-index: 5; max-height: 280px; overflow-y: auto; }
  .of-ac-item { display: block; width: 100%; text-align: left; background: none; border: none; border-bottom: 0.5px solid #f0eeea; font: inherit; font-size: 13.5px; padding: 10px 12px; cursor: pointer; color: #222; }
  .of-ac-item:last-child { border-bottom: none; }
  .of-ac-item:hover { background: #f7f5f1; }
  .of-ac-meta { color: #a0a09a; }

  .of-li { display: flex; flex-direction: column; }
  .of-li-row { display: flex; justify-content: space-between; gap: 16px; padding: 7px 0; border-bottom: 0.5px solid #f0eeea; font-size: 13.5px; }
  .of-li-row:last-child { border-bottom: none; }
  .of-li-label { color: #333; }
  .of-li-amt { color: #1e2d3d; font-weight: 600; font-variant-numeric: tabular-nums; white-space: nowrap; }
  /* Editable line-item rows */
  .of-li-edit { align-items: center; gap: 10px; }
  .of-li-edit .of-li-label { flex: 1; min-width: 0; }
  .of-li-label-input { flex: 1; min-width: 0; font-size: 13.5px; padding: 6px 9px; }
  .of-li-amt-wrap { width: 120px; flex: 0 0 auto; }
  .of-li-amt-input { text-align: right; font-variant-numeric: tabular-nums; padding-top: 6px; padding-bottom: 6px; }
  .of-li-amt-quote { width: 120px; text-align: right; flex: 0 0 auto; color: #a0a09a; font-weight: 500; }
  .of-li-x { flex: 0 0 auto; width: 26px; height: 26px; display: inline-flex; align-items: center; justify-content: center; font-size: 15px; line-height: 1; color: #a0a09a; background: none; border: 0.5px solid transparent; border-radius: 6px; cursor: pointer; }
  .of-li-x:hover { color: #b3261e; border-color: #e3c3c3; background: #fbe5e5; }
  .of-li-x-spacer { flex: 0 0 auto; width: 26px; }
  .of-li-add { margin-top: 8px; align-self: flex-start; }

  /* Engraving text (carve) card */
  .of-carve-text { font-family: 'JetBrains Mono', monospace; font-size: 14px; line-height: 1.6; resize: vertical; white-space: pre; }
  .of-carve-foot { display: flex; align-items: center; gap: 12px; margin-top: 6px; }
  .of-carve-edited { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; color: #9A7209; }

  .of-toggles { display: flex; flex-direction: column; gap: 10px; border-top: 0.5px dashed #e0ded9; padding-top: 14px; }
  .of-discount { width: 140px; }

  .of-totals { display: flex; flex-direction: column; gap: 4px; border-top: 0.5px dashed #e0ded9; padding-top: 14px; }
  .of-tot-row { display: flex; justify-content: space-between; font-size: 13.5px; color: #555; font-variant-numeric: tabular-nums; }
  .of-tot-neg { color: #555; }
  .of-tot-grand { font-weight: 700; color: #111; font-size: 14.5px; padding-top: 4px; }
  .of-tot-struck span:last-child { text-decoration: line-through; color: #a0a09a; font-weight: 500; }

  .of-manual { display: flex; align-items: flex-end; gap: 14px; flex-wrap: wrap; border-top: 0.5px dashed #e0ded9; padding-top: 14px; }
  .of-manual .of-field { width: 220px; }
  .of-grandfinal { display: flex; justify-content: space-between; align-items: center; background: #1e2d3d; color: #fff; border-radius: 10px; padding: 14px 18px; font-size: 17px; font-weight: 700; font-variant-numeric: tabular-nums; }

  .of-ownerquote { background: #fdf8ec; border: 0.5px solid #e8d9a8; border-radius: 10px; padding: 12px 14px; }
  .of-ownerquote-title { font-size: 13px; font-weight: 600; color: #9A7209; }
  .of-ownerquote-item { font-size: 13px; color: #555; margin-top: 4px; }

  .of-checklist { display: flex; flex-direction: column; gap: 9px; }
  .of-signeddate { max-width: 200px; }

  .of-footer { flex-shrink: 0; border-top: 0.5px solid #d8d6d1; background: #fff; padding: 14px 24px; }
  .of-err { color: #b3261e; font-size: 13px; margin-bottom: 10px; max-width: 880px; margin-left: auto; margin-right: auto; }
  .of-footer-actions { display: flex; justify-content: flex-end; gap: 10px; max-width: 880px; margin: 0 auto; }
  .of-btn { font: inherit; font-size: 14px; font-weight: 600; padding: 10px 20px; border-radius: 9px; border: 0.5px solid #d8d6d1; background: #fff; color: #222; cursor: pointer; }
  .of-btn:disabled { opacity: 0.5; cursor: default; }
  .of-btn-primary { background: #9A7209; border-color: #9A7209; color: #fff; }
  .of-btn-primary:hover:not(:disabled) { background: #876307; }
  .of-btn-ghost { background: #fff; }
  .of-btn-ghost:hover { border-color: #9A7209; color: #9A7209; }

  /* Inscription tier selector */
  .of-tier-row { display: flex; gap: 10px; flex-wrap: wrap; }
  .of-tier { flex: 1 1 160px; display: flex; flex-direction: column; gap: 4px; align-items: flex-start; padding: 12px 14px; border: 0.5px solid #d8d6d1; border-radius: 10px; background: #fff; cursor: pointer; }
  .of-tier:hover { border-color: #9A7209; }
  .of-tier.on { border-color: #9A7209; background: #fdf8ec; box-shadow: 0 0 0 1px #9A7209 inset; }
  .of-tier-label { font-size: 13.5px; font-weight: 600; color: #222; }
  .of-tier-price { font-size: 15px; font-weight: 700; color: #1e2d3d; font-variant-numeric: tabular-nums; }

  /* Catalog picker */
  .of-cat-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
  .of-cat-card { display: flex; flex-direction: column; gap: 6px; padding: 0; border: 0.5px solid #d8d6d1; border-radius: 10px; background: #fff; cursor: pointer; overflow: hidden; text-align: left; }
  .of-cat-card:hover { border-color: #9A7209; }
  .of-cat-card.on { border-color: #9A7209; box-shadow: 0 0 0 2px rgba(154,114,9,0.25); }
  .of-cat-card img { width: 100%; aspect-ratio: 1 / 1; object-fit: cover; display: block; background: #f3f2ef; }
  .of-cat-noimg { width: 100%; aspect-ratio: 1 / 1; display: flex; align-items: center; justify-content: center; color: #b0b0a8; font-size: 12px; background: #f3f2ef; }
  .of-cat-name { font-size: 12px; color: #444; padding: 0 8px 8px; }
  .of-cat-selected { flex-direction: row; align-items: flex-start; gap: 12px; }
  .of-cat-selthumb { width: 64px; height: 64px; border-radius: 8px; object-fit: cover; flex-shrink: 0; }
  .of-cat-selbody { flex: 1 1 auto; display: flex; flex-direction: column; gap: 8px; min-width: 0; }
  .of-cat-selname { font-size: 13.5px; font-weight: 600; color: #222; }

  /* Drag-drop attachments */
  .of-drop { border: 1.5px dashed #cdc8be; border-radius: 12px; padding: 28px; text-align: center; cursor: pointer; background: #fbfaf8; transition: border-color 0.15s, background 0.15s; }
  .of-drop:hover { border-color: #9A7209; }
  .of-drop.drag { border-color: #9A7209; background: #fdf8ec; }
  .of-drop-text { font-size: 13.5px; color: #8a8a85; }
  .of-filelist { display: flex; flex-direction: column; gap: 6px; }
  .of-filerow { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 8px 10px; border: 0.5px solid #e4e2dd; border-radius: 8px; background: #fff; }
  .of-filelink { font-size: 13px; color: #9A7209; text-decoration: none; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .of-filelink:hover { text-decoration: underline; }

  @media (max-width: 680px) {
    .of-grid-2, .of-grid-3 { grid-template-columns: 1fr; }
    .of-cat-grid { grid-template-columns: repeat(2, 1fr); }
  }
`
