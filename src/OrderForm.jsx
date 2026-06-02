// =============================================================================
// Stonebooks — New Order / Edit Order form (single screen, type-aware)
// =============================================================================
// A fast one-screen alternative to the full Sales wizard. It REUSES the
// wizard's actual controls (CustomerStep, CemeteryStep + map, DeceasedStep,
// ShapeStep/ColorStep, InscriptionStep, AddOnsStep, PricingStep) — nothing is
// rebuilt — gated by a Job Type selector driven by ORDER_TYPES. Finance runs the
// wizard's own buildLineItems, so totals match exactly. On submit it persists
// via the wizard's saveOrder, auto-creates the job (allowUnsigned — no contract
// step), and backfills the job to a chosen stage. Edit reuses the same form,
// prefilled, and updates order + job in place (replaces "Edit in Sales Portal").
// =============================================================================

import { useState, useEffect } from 'react'
import {
  CustomerStep, CemeteryStep, DeceasedStep, ShapeStep, ColorStep,
  InscriptionStep, AddOnsStep, PricingStep,
  makeBlankOrder, saveOrder, rowToOrder, salesModeStyles,
} from './SalesMode'
import {
  getOrderById, getJobByOrderId, createJobFromOrder,
  getOrderMilestoneTemplate, backfillJobMilestones,
} from './lib/stonebooksData'

// ── Type config — drives which reused sections render per job type ──────────
const ORDER_TYPES = {
  new_monument: {
    label: 'New Monument', jobType: 'new_stone', serviceTypes: ['NEW_STONE'],
    sections: ['customer', 'cemetery', 'deceased', 'design', 'inscription', 'addons', 'finance'],
  },
  additional_inscription: {
    label: 'Additional Inscription', jobType: 'inscription', serviceTypes: ['INSCRIPTION'],
    sections: ['customer', 'cemetery', 'deceased', 'inscription', 'addons', 'finance'],
  },
  repair: {
    label: 'Repair', jobType: 'cleaning_repair', serviceKind: 'repair', serviceTypes: ['REPAIR'],
    sections: ['customer', 'cemetery', 'deceased', 'repair_note', 'addons', 'finance'],
  },
  acid_wash: {
    label: 'Acid Wash / Cleaning', jobType: 'cleaning_repair', serviceKind: 'acid_wash', serviceTypes: ['ACID_WASH'],
    sections: ['customer', 'cemetery', 'deceased', 'acidwash', 'finance'],
  },
}
const TYPE_KEYS = Object.keys(ORDER_TYPES)

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

function todayISODate() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export default function OrderForm({ orderId = null, onClose, onSaved }) {
  const isEdit = !!orderId
  const [type, setType] = useState('new_monument')
  // Seed the default type's service types so a fresh form is ready immediately
  // (avoids a synchronous setState-in-effect to sync them).
  const [order, setOrder] = useState(() => ({ ...makeBlankOrder(), serviceTypes: ORDER_TYPES.new_monument.serviceTypes }))
  const [jobId, setJobId] = useState(null)
  const [loading, setLoading] = useState(isEdit)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  // Stage backfill: 'fresh' (nothing done) | 'keep' (edit: don't touch) | a key.
  const [stageKey, setStageKey] = useState(isEdit ? 'keep' : 'fresh')
  const [templateMs, setTemplateMs] = useState([])

  // Contract-signed toggle — default OFF (signed_at stays null for entered
  // orders; due-date math + "since signed" age stay clean unless checked).
  const [markSigned, setMarkSigned] = useState(false)
  const [signedDate, setSignedDate] = useState(() => todayISODate())

  const update = (patch) => setOrder(o => ({ ...o, ...patch }))

  // Switch job type (new orders only) — sets the service types in the same
  // event tick (no effect-driven setState).
  const changeType = (k) => {
    if (k === type) return
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

  // Load the milestone template for the current type (drives the stage dropdown).
  // Async only — no synchronous setState in the effect body.
  useEffect(() => {
    const cfg = ORDER_TYPES[type]
    if (!cfg) return
    let cancelled = false
    getOrderMilestoneTemplate(cfg.serviceTypes).then(ms => { if (!cancelled) setTemplateMs(ms) })
    return () => { cancelled = true }
  }, [type])

  const cfg = ORDER_TYPES[type]
  const sections = cfg.sections

  const submit = async () => {
    if (busy) return
    setBusy(true); setErr(null)
    // Apply the signed toggle into the order before save (orderToRow maps it).
    const signedAt = markSigned ? new Date(`${signedDate}T12:00:00`).toISOString() : null
    const toSave = { ...order, serviceTypes: cfg.serviceTypes, signedAt }
    const res = await saveOrder(toSave)
    if (!res?.ok) { setBusy(false); setErr(res?.error?.message || res?.reason || 'Could not save the order'); return }
    const savedId = res.order?.id || orderId

    // Ensure the job exists (idempotent; unsigned allowed for entered orders).
    let jid = jobId
    if (!jid) {
      const jr = await createJobFromOrder(savedId, { source: 'new_order_form', allowUnsigned: true })
      if (!jr.ok) { setBusy(false); setErr(`Order saved, but job creation failed: ${jr.error}`); return }
      jid = jr.job?.id || null
    }

    // Stage backfill (skip when 'keep' on edit, or 'fresh').
    if (jid && stageKey !== 'keep' && stageKey !== 'fresh') {
      const br = await backfillJobMilestones(jid, stageKey)
      if (!br.ok) { setBusy(false); setErr(`Saved, but stage backfill failed: ${br.error}`); return }
    }

    setBusy(false)
    onSaved?.(savedId, jid)
  }

  if (loading) {
    return (
      <div className="sb-of-overlay"><style>{salesModeStyles}</style><style>{OF_CSS}</style>
        <div className="sb-of-shell"><div className="sb-of-empty">Loading order…</div></div>
      </div>
    )
  }

  return (
    <div className="sb-of-overlay">
      <style>{salesModeStyles}</style>
      <style>{OF_CSS}</style>
      <div className="sb-of-shell">
        {/* Top bar */}
        <header className="sb-of-topbar">
          <button type="button" className="sb-of-close" onClick={onClose}>← Close</button>
          <div className="sb-of-title">{isEdit ? `Edit order ${order.orderNumber || ''}`.trim() : 'New Order'}</div>
          <div className="sb-of-total">{cfg.label}</div>
        </header>

        <div className="sb-of-body">
          {/* Job Type selector */}
          <div className="sb-of-typebar">
            <span className="sb-of-typebar-label">Job type</span>
            <div className="sb-of-typeseg">
              {TYPE_KEYS.map(k => (
                <button
                  key={k}
                  type="button"
                  className={`sb-of-typebtn${type === k ? ' on' : ''}`}
                  onClick={() => changeType(k)}
                  disabled={isEdit}
                  title={isEdit ? 'Type is fixed on an existing order' : ''}
                >{ORDER_TYPES[k].label}</button>
              ))}
            </div>
          </div>

          {/* Reused wizard controls, gated by the type's sections */}
          {sections.includes('customer') && <CustomerStep order={order} update={update} />}
          {sections.includes('cemetery') && <CemeteryStep order={order} update={update} />}
          {sections.includes('deceased') && <DeceasedStep order={order} update={update} />}
          {sections.includes('design') && (
            <>
              <ShapeStep order={order} update={update} />
              <ColorStep order={order} update={update} />
            </>
          )}
          {sections.includes('inscription') && <InscriptionStep order={order} update={update} />}

          {sections.includes('repair_note') && (
            <NoteSection
              title="Repair details"
              eyebrow="What needs repair"
              value={order.otherServiceDescription || ''}
              onChange={v => update({ otherServiceDescription: v })}
              placeholder="Describe the repair (cracks, resetting, re-leveling, lettering touch-up…)."
            />
          )}
          {sections.includes('acidwash') && (
            <NoteSection
              title="Acid wash / cleaning"
              eyebrow="Cleaning details"
              value={order.otherServiceDescription || ''}
              onChange={v => update({ otherServiceDescription: v })}
              placeholder="Scope of the cleaning / acid wash, stone condition, anything to note."
            />
          )}

          {sections.includes('addons') && <AddOnsStep order={order} update={update} />}
          {sections.includes('finance') && <PricingStep order={order} update={update} />}

          {/* Stage backfill */}
          <section className="sm-step sb-of-stage">
            <div className="sm-step-head">
              <div className="sm-step-eyebrow">Production</div>
              <h2 className="sm-step-title">Current stage</h2>
              <p className="sm-step-lede">
                Set where this job already is so it lands at its real status — or start fresh.
              </p>
            </div>
            <select className="sm-input sb-of-stageselect" value={stageKey} onChange={e => setStageKey(e.target.value)}>
              {isEdit && <option value="keep">Leave milestones unchanged</option>}
              <option value="fresh">Start fresh — nothing done yet</option>
              {templateMs.map(m => (
                <option key={m.key} value={m.key}>Through: {m.label}</option>
              ))}
            </select>
            {!isEdit && stageKey !== 'fresh' && (
              <p className="sb-of-stagehint">Everything up to and including this milestone will be marked done.</p>
            )}
          </section>

          {/* Contract-signed toggle */}
          <section className="sm-step sb-of-signed">
            <label className="sb-of-check">
              <input type="checkbox" checked={markSigned} onChange={e => setMarkSigned(e.target.checked)} />
              <span>Contract signed</span>
            </label>
            {markSigned && (
              <input type="date" className="sm-input sb-of-signeddate" value={signedDate} onChange={e => setSignedDate(e.target.value)} />
            )}
            <p className="sb-of-stagehint">
              Leave unchecked for an entered/active order (keeps the “since signed” clock clean). Check it only if a contract was actually signed.
            </p>
          </section>
        </div>

        {/* Footer */}
        <footer className="sb-of-footer">
          {err && <div className="sb-of-err">{err}</div>}
          <div className="sb-of-footer-actions">
            <button type="button" className="sb-of-btn" onClick={onClose} disabled={busy}>Cancel</button>
            <button type="button" className="sb-of-btn sb-of-btn-primary" onClick={submit} disabled={busy}>
              {busy ? (isEdit ? 'Saving…' : 'Creating…') : (isEdit ? 'Save order' : 'Create order')}
            </button>
          </div>
        </footer>
      </div>
    </div>
  )
}

function NoteSection({ title, eyebrow, value, onChange, placeholder }) {
  return (
    <section className="sm-step">
      <div className="sm-step-head">
        <div className="sm-step-eyebrow">{eyebrow}</div>
        <h2 className="sm-step-title">{title}</h2>
      </div>
      <textarea
        className="sm-input sb-of-note"
        rows={4}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </section>
  )
}

const OF_CSS = `
  .sb-of-overlay { position: fixed; inset: 0; z-index: 950; background: var(--sm-cream, #f5f4f1); display: flex; flex-direction: column; }
  .sb-of-shell { display: flex; flex-direction: column; height: 100%; }
  .sb-of-empty { margin: auto; color: #8a8a85; font-size: 15px; }
  .sb-of-topbar { display: flex; align-items: center; gap: 16px; padding: 14px 24px; border-bottom: 0.5px solid var(--sm-border, #d8d6d1); background: #fff; flex-shrink: 0; }
  .sb-of-close { background: none; border: none; font: inherit; font-size: 14px; color: #6b6b66; cursor: pointer; }
  .sb-of-close:hover { color: #111; }
  .sb-of-title { font-size: 16px; font-weight: 600; color: #111; flex: 1 1 auto; }
  .sb-of-total { font-size: 18px; font-weight: 700; color: #1e2d3d; font-variant-numeric: tabular-nums; }
  .sb-of-body { flex: 1 1 auto; overflow-y: auto; padding: 20px 24px 32px; max-width: 860px; width: 100%; margin: 0 auto; box-sizing: border-box; }
  .sb-of-typebar { display: flex; align-items: center; gap: 12px; margin-bottom: 20px; flex-wrap: wrap; }
  .sb-of-typebar-label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: #8a8a85; font-weight: 700; }
  .sb-of-typeseg { display: inline-flex; gap: 4px; background: #ece9e3; border-radius: 10px; padding: 4px; flex-wrap: wrap; }
  .sb-of-typebtn { font: inherit; font-size: 13px; font-weight: 500; padding: 7px 14px; border: none; border-radius: 7px; background: none; color: #555; cursor: pointer; }
  .sb-of-typebtn:hover:not(:disabled) { color: #111; }
  .sb-of-typebtn.on { background: #fff; color: #9A7209; font-weight: 700; box-shadow: 0 1px 2px rgba(0,0,0,0.08); }
  .sb-of-typebtn:disabled { cursor: default; opacity: 0.7; }
  .sb-of-stage, .sb-of-signed { border-top: 0.5px dashed var(--sm-border, #d8d6d1); }
  .sb-of-stageselect { max-width: 420px; }
  .sb-of-stagehint { font-size: 12.5px; color: #8a8a85; margin-top: 8px; }
  .sb-of-check { display: inline-flex; align-items: center; gap: 8px; font-size: 14px; color: #222; cursor: pointer; }
  .sb-of-signeddate { max-width: 200px; margin-top: 10px; }
  .sb-of-note { width: 100%; box-sizing: border-box; }
  .sb-of-footer { flex-shrink: 0; border-top: 0.5px solid var(--sm-border, #d8d6d1); background: #fff; padding: 14px 24px; }
  .sb-of-err { color: #b3261e; font-size: 13px; margin-bottom: 10px; }
  .sb-of-footer-actions { display: flex; justify-content: flex-end; gap: 10px; max-width: 860px; margin: 0 auto; }
  .sb-of-btn { font: inherit; font-size: 14px; font-weight: 600; padding: 10px 20px; border-radius: 9px; border: 0.5px solid var(--sm-border, #d8d6d1); background: #fff; color: #222; cursor: pointer; }
  .sb-of-btn:disabled { opacity: 0.5; cursor: default; }
  .sb-of-btn-primary { background: #9A7209; border-color: #9A7209; color: #fff; }
  .sb-of-btn-primary:hover:not(:disabled) { background: #876307; }
`
