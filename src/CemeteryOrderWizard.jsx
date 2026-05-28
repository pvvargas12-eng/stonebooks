// =============================================================================
// 📚 Stonebooks — Cemetery Order Wizard (Phase B, redesigned)
// =============================================================================
// Door/panel orders placed BY a cemetery. Six steps, desktop-first:
//   1. Cemetery picker — 4 known cards + "Add another" (Clover-Leaf-seeded custom)
//   2. Door count — centered mega-input
//   3. Doors editor — sticky left rail (door list) + right pane (selected door)
//   4. Packet upload — Supabase Storage (cemetery_packets)
//   5. Contact — auto-populated from the cemeteries record, editable, optional
//   6. Review — inline per-line price overrides + sticky dark totals card with
//      NJ-tax (6.625%) and CC-fee (3%) toggles; Submit spawns one job per door.
//
// Persists to cemetery_orders (debounced autosave). Per-door selectedItems are
// { key, price_override? } objects. Submit → createJobsFromCemeteryOrder → Jobs.
// =============================================================================

import { useState, useEffect, useRef, useMemo } from 'react'
import {
  CEMETERY_DOOR_PRICING,
  getCemeteryPricingForOrder,
  getDoorPrice,
  getCemeteryByName,
  createCemeteryOrderDraft,
  updateCemeteryOrder,
  uploadCemeteryPacket,
  createJobsFromCemeteryOrder,
  getCemeteryOrder,
  getJobsForCemeteryOrder,
  getJobCostEstimates,
  setJobCostEstimate,
  ESTIMATE_CATEGORIES,
} from './lib/stonebooksData'

// Static branding — mirrors COMPANY_INFO in SalesMode.jsx (kept local so the
// wizard stays self-contained; update both if the company info changes).
const COMPANY = {
  name: 'SHEVCHENKO MONUMENTS',
  legal: 'Shevchenko Monuments LLC',
  addr: '329 S Florida Grove Rd · Perth Amboy, NJ 08861',
  phone: '732-442-1286',
  email: 'shevcoteam@gmail.com',
  estd: 'Family-owned since 1919',
}
const KNOWN_ORDER = ['ST_JAMES', 'BETH_ISRAEL', 'WOODBRIDGE_MEMORIAL_GARDENS', 'CLOVER_LEAF']
const STEPS = ['Cemetery', 'Count', 'Doors', 'Packet', 'Contact', 'Review']
const TAX_RATE = 0.06625
const CC_RATE = 0.03

const money = (n) => `$${(Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const keyOf = (s) => (typeof s === 'string' ? s : s?.key)
const blankDoor = () => ({ location: null, selectedItems: [], inscriptionText: '', notes: '' })

function pricingHint(p) {
  if (!p) return ''
  if (p.type === 'indoor_outdoor_split') {
    const keys = new Set([...Object.keys(p.indoor || {}), ...Object.keys(p.outdoor || {})])
    return `Indoor + outdoor pricing · ${keys.size} line items`
  }
  if (p.type === 'flat') return `Flat pricing · ${Object.keys(p.items || {}).length} line items`
  return 'Custom pricing'
}

export default function CemeteryOrderWizard({ onClose, onSubmitted, initialOrderId = null, editMode = false }) {
  const [step, setStep] = useState(0)
  const [resuming, setResuming] = useState(!!initialOrderId)
  const [editMeta, setEditMeta] = useState({ orderNumber: null, jobCount: 0 })   // edit-mode context
  const [estimates, setEstimates] = useState({})   // optional quote-time cost estimates (per ESTIMATE_CATEGORIES)
  const [co, setCo] = useState({
    id: null, cemetery_name: '', cemetery_pricing_snapshot: null,
    doors: [], packet_storage_path: null,
    cemetery_contact_name: '', cemetery_contact_email: '', cemetery_contact_phone: '',
    tax_applied: false, cc_fee_applied: false,
  })
  // step 1
  const [choice, setChoice] = useState(null)            // known key | 'CUSTOM'
  const [showCustom, setShowCustom] = useState(false)
  const [customName, setCustomName] = useState('')
  // step 2
  const [doorCount, setDoorCount] = useState(1)
  // step 3
  const [selDoor, setSelDoor] = useState(0)
  // step 5
  const [contactPrefilled, setContactPrefilled] = useState(false)
  // step 6
  const [editing, setEditing] = useState(null)          // `${doorIdx}:${key}`
  const [editVal, setEditVal] = useState('')
  const [resetModal, setResetModal] = useState(false)
  const [confirmClose, setConfirmClose] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const pricing = useMemo(() => getCemeteryPricingForOrder(co), [co.cemetery_name, co.cemetery_pricing_snapshot])
  const isSplit = pricing.type === 'indoor_outdoor_split'

  // ── debounced autosave ────────────────────────────────────────────────────
  // The save payload (current co → cemetery_orders columns). Shared by the
  // debounced autosave and the flush-on-close path.
  const savePatch = () => ({
    cemetery_name: co.cemetery_name,
    cemetery_pricing_snapshot: co.cemetery_pricing_snapshot,
    doors: co.doors,
    packet_storage_path: co.packet_storage_path,
    cemetery_contact_name: co.cemetery_contact_name || null,
    cemetery_contact_email: co.cemetery_contact_email || null,
    cemetery_contact_phone: co.cemetery_contact_phone || null,
    tax_applied: co.tax_applied,
    cc_fee_applied: co.cc_fee_applied,
    // In edit mode (submitted order), keep the total in sync as doors change.
    ...(editMode ? { total_amount: total } : {}),
  })
  const saveTimer = useRef(null)
  const dirtyRef = useRef(false)   // true when edits are pending / in-flight
  useEffect(() => {
    if (!co.id) return
    if (saveTimer.current) clearTimeout(saveTimer.current)
    dirtyRef.current = true
    saveTimer.current = setTimeout(async () => {
      await updateCemeteryOrder(co.id, savePatch())
      dirtyRef.current = false
    }, 800)
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [co])

  // ── resume an existing draft ──────────────────────────────────────────────
  useEffect(() => {
    if (!initialOrderId) return
    let cancelled = false
    getCemeteryOrder(initialOrderId).then(row => {
      if (cancelled || !row) { setResuming(false); return }
      setCo({
        id: row.id,
        cemetery_name: row.cemetery_name || '',
        cemetery_pricing_snapshot: row.cemetery_pricing_snapshot || null,
        doors: Array.isArray(row.doors) && row.doors.length ? row.doors : [blankDoor()],
        packet_storage_path: row.packet_storage_path || null,
        cemetery_contact_name: row.cemetery_contact_name || '',
        cemetery_contact_email: row.cemetery_contact_email || '',
        cemetery_contact_phone: row.cemetery_contact_phone || '',
        tax_applied: !!row.tax_applied, cc_fee_applied: !!row.cc_fee_applied,
      })
      // derive step-1 selection from the saved cemetery name
      const known = KNOWN_ORDER.find(k => CEMETERY_DOOR_PRICING[k].label === row.cemetery_name)
      if (known) { setChoice(known) }
      else if (row.cemetery_name) { setChoice('CUSTOM'); setShowCustom(true); setCustomName(row.cemetery_name) }
      setDoorCount(Math.max(1, (row.doors || []).length || 1))
      setResuming(false)
      if (editMode) {
        setEditMeta({ orderNumber: row.order_number || null, jobCount: 0 })
        setStep(2)   // land on the doors editor
        getJobsForCemeteryOrder(row.id).then(js => setEditMeta(m => ({ ...m, jobCount: (js || []).length })))
      }
    })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialOrderId])

  // ── pricing helpers ─────────────────────────────────────────────────────
  const itemMapFor = (d) => (isSplit ? (d.location ? (pricing[d.location] || {}) : null) : (pricing.items || {}))
  const hasItem = (d, k) => (d.selectedItems || []).some(s => keyOf(s) === k)
  const overrideOf = (d, k) => { const s = (d.selectedItems || []).find(x => keyOf(x) === k); return (s && typeof s === 'object' && s.price_override != null) ? Number(s.price_override) : null }
  const defaultPrice = (d, k) => Number(itemMapFor(d)?.[k]?.price) || 0
  const effPrice = (d, k) => { const o = overrideOf(d, k); return o != null ? o : defaultPrice(d, k) }
  const doorSubtotal = (d) => getDoorPrice(d, pricing)

  const subtotal = co.doors.reduce((s, d) => s + doorSubtotal(d), 0)
  const taxAmt = co.tax_applied ? subtotal * TAX_RATE : 0
  const ccAmt = co.cc_fee_applied ? subtotal * CC_RATE : 0
  const total = subtotal + taxAmt + ccAmt

  const overrideStats = useMemo(() => {
    let count = 0, delta = 0
    for (const d of co.doors) for (const s of (d.selectedItems || [])) {
      if (s && typeof s === 'object' && s.price_override != null) {
        count++; delta += Number(s.price_override) - defaultPrice(d, keyOf(s))
      }
    }
    return { count, delta }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [co.doors, pricing])

  // ── door mutators ─────────────────────────────────────────────────────────
  const setDoors = (fn) => setCo(c => ({ ...c, doors: fn(c.doors) }))
  const updateDoor = (i, patch) => setDoors(ds => ds.map((d, idx) => (idx === i ? { ...d, ...patch } : d)))
  const toggleItem = (i, k) => setDoors(ds => ds.map((d, idx) => {
    if (idx !== i) return d
    return { ...d, selectedItems: hasItem(d, k) ? d.selectedItems.filter(s => keyOf(s) !== k) : [...(d.selectedItems || []), { key: k }] }
  }))
  const setOverride = (i, k, val) => setDoors(ds => ds.map((d, idx) => {
    if (idx !== i) return d
    return { ...d, selectedItems: d.selectedItems.map(s => (keyOf(s) === k ? (val == null ? { key: k } : { key: k, price_override: val }) : s)) }
  }))
  const addDoor = () => { if (co.doors.length < 50) setDoors(ds => [...ds, blankDoor()]) }
  const removeDoor = (i) => { setDoors(ds => ds.filter((_, idx) => idx !== i)); setSelDoor(s => Math.max(0, s - (i <= s ? 1 : 0))) }

  // ── step transitions ──────────────────────────────────────────────────────
  const resolveSelection = () => {
    if (choice && choice !== 'CUSTOM') {
      return { name: CEMETERY_DOOR_PRICING[choice].label, snapshot: null }
    }
    if (choice === 'CUSTOM' && customName.trim()) {
      return {
        name: customName.trim(),
        snapshot: { label: customName.trim(), type: 'flat', items: JSON.parse(JSON.stringify(CEMETERY_DOOR_PRICING.CLOVER_LEAF.items)) },
      }
    }
    return null
  }
  const proceedFromCemetery = async () => {
    const sel = resolveSelection()
    if (!sel) return
    setBusy(true); setError(null)
    if (!co.id) {
      const res = await createCemeteryOrderDraft({ cemeteryName: sel.name, cemeteryPricingSnapshot: sel.snapshot })
      setBusy(false)
      if (!res.ok) { setError(res.error); return }
      setCo(c => ({ ...c, id: res.order.id, cemetery_name: sel.name, cemetery_pricing_snapshot: sel.snapshot || null }))
    } else {
      setCo(c => ({ ...c, cemetery_name: sel.name, cemetery_pricing_snapshot: sel.snapshot || null }))
      setBusy(false)
    }
    setStep(1)
  }
  const proceedFromCount = () => {
    const n = Math.max(1, Math.min(50, Number(doorCount) || 1))
    setDoors(ds => { const out = ds.slice(0, n); while (out.length < n) out.push(blankDoor()); return out })
    setSelDoor(0)
    setStep(2)
  }

  // ── step 5 auto-populate ────────────────────────────────────────────────
  useEffect(() => {
    if (step !== 4 || contactPrefilled || !co.cemetery_name) return
    let cancelled = false
    getCemeteryByName(co.cemetery_name).then(rec => {
      if (cancelled || !rec) { setContactPrefilled(true); return }
      setCo(c => ({
        ...c,
        cemetery_contact_email: c.cemetery_contact_email || rec.contact_email || '',
        cemetery_contact_phone: c.cemetery_contact_phone || rec.contact_phone || '',
      }))
      setContactPrefilled(true)
    })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step])

  // ── step 4 upload ─────────────────────────────────────────────────────────
  const handleFile = async (e) => {
    const f = e.target.files?.[0]
    if (!f || !co.id) return
    setBusy(true); setError(null)
    const res = await uploadCemeteryPacket(co.id, f)
    setBusy(false)
    if (!res.ok) { setError(res.error); return }
    setCo(c => ({ ...c, packet_storage_path: res.path, _packetSize: f.size }))
  }

  // ── step 6 override editing ─────────────────────────────────────────────
  const beginEdit = (i, k) => { setEditing(`${i}:${k}`); setEditVal(String(effPrice(co.doors[i], k))) }
  const commitEdit = (i, k) => {
    const v = editVal.trim()
    const num = v === '' ? null : Number(v)
    if (num == null || !Number.isFinite(num) || num === defaultPrice(co.doors[i], k)) setOverride(i, k, null)
    else setOverride(i, k, Math.round(num * 100) / 100)
    setEditing(null)
  }
  const resetAll = () => {
    setDoors(ds => ds.map(d => ({ ...d, selectedItems: (d.selectedItems || []).map(s => ({ key: keyOf(s) })) })))
    setCo(c => ({ ...c, tax_applied: false, cc_fee_applied: false }))
    setResetModal(false)
  }

  // Prefill estimates when an order id exists (resume / edit).
  useEffect(() => {
    if (!co.id) return
    let c = false
    getJobCostEstimates({ cemeteryOrderId: co.id }).then(rows => {
      if (c || !rows.length) return
      const next = {}; for (const r of rows) next[r.category] = String(r.estimated_amount)
      setEstimates(next)
    })
    return () => { c = true }
  }, [co.id])

  // Persist entered estimates (cemetery-order level). Non-fatal best-effort.
  const writeEstimates = async () => {
    if (!co.id) return
    for (const { key } of ESTIMATE_CATEGORIES) {
      const amt = Number(estimates[key])
      if (Number.isFinite(amt) && amt > 0) {
        try { await setJobCostEstimate({ cemeteryOrderId: co.id, category: key, estimatedAmount: amt }) } catch { /* non-fatal */ }
      }
    }
  }

  const handleSubmit = async () => {
    if (!co.id) return
    setBusy(true); setError(null)
    await updateCemeteryOrder(co.id, {
      cemetery_name: co.cemetery_name,
      doors: co.doors,
      cemetery_contact_name: co.cemetery_contact_name || null,
      cemetery_contact_phone: co.cemetery_contact_phone || null,
      cemetery_contact_email: co.cemetery_contact_email || null,
      tax_applied: co.tax_applied,
      cc_fee_applied: co.cc_fee_applied,
    })
    const res = await createJobsFromCemeteryOrder(co.id)
    if (!res.ok) { setBusy(false); setError(res.error); return }
    await writeEstimates()
    setBusy(false)
    onSubmitted?.()
  }

  // ── close / back ──────────────────────────────────────────────────────────
  // The shell (closeSales) returns the operator to whichever tab they came from
  // — the Cemetery Orders list when resuming, the home tab when launched from
  // "+ New sale". We only intercept to guard pending (unsaved) edits.
  const requestClose = () => {
    if (saveTimer.current && dirtyRef.current) setConfirmClose(true)
    else onClose?.()
  }
  const saveAndClose = async () => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    if (co.id) { setBusy(true); await updateCemeteryOrder(co.id, savePatch()); dirtyRef.current = false; setBusy(false) }
    setConfirmClose(false); onClose?.()
  }
  const discardClose = () => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    setConfirmClose(false); onClose?.()
  }
  // Edit mode: flush the (door/total/contact) changes and return to the list.
  // No job re-spawn — jobs already exist for a submitted order.
  const saveChanges = async () => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    if (co.id) { setBusy(true); await updateCemeteryOrder(co.id, { ...savePatch(), total_amount: total }); await writeEstimates(); dirtyRef.current = false; setBusy(false) }
    onClose?.()
  }

  // ── nav gating ────────────────────────────────────────────────────────────
  const allDoorsValid = co.doors.length > 0 && co.doors.every(d => (d.selectedItems?.length > 0))
  const canContinue =
    step === 0 ? !!resolveSelection() :
    step === 1 ? Number(doorCount) >= 1 :
    step === 2 ? allDoorsValid : true
  const goNext = () => {
    if (step === 0) return proceedFromCemetery()
    if (step === 1) return proceedFromCount()
    setStep(s => Math.min(5, s + 1))
  }
  const goBack = () => setStep(s => Math.max(0, s - 1))

  const sel = co.doors[selDoor]

  return (
    <div className="co-root">
      <header className="co-top">
        <div>
          <div className="co-eyebrow">
            Cemetery order
            {!editMode && (initialOrderId || co.id) && <span className="co-draft-badge">Draft</span>}
          </div>
          <h1 className="co-h1">
            {editMode ? `Editing submitted order${editMeta.orderNumber ? ` ${editMeta.orderNumber}` : ''}`
              : initialOrderId ? 'Resume cemetery door order' : 'New cemetery door order'}
          </h1>
        </div>
        <button className="co-close" onClick={requestClose}>Close</button>
      </header>

      <div className="co-stepper">
        {STEPS.map((label, i) => (
          <div key={label} className={`co-sp ${i === step ? 'on' : ''} ${i < step ? 'done' : ''}`}>
            <span className="co-sp-n">{i + 1}</span>{label}
          </div>
        ))}
      </div>

      {error && <div className="co-err">{error}</div>}

      <div className="co-stage">
        {resuming && <div className="co-narrow"><p className="co-lede">Loading {editMode ? 'order' : 'draft'}…</p></div>}

        {editMode && editMeta.jobCount > 0 && !resuming && (
          <div className="co-editwarn">
            This order has {editMeta.jobCount} production job{editMeta.jobCount === 1 ? '' : 's'}.
            Changing doors or line items may affect scheduled work — the order total recalculates on save.
          </div>
        )}

        {/* STEP 1 — CEMETERY */}
        {!resuming && step === 0 && (
          <div className="co-narrow">
            <h2 className="co-h2">Which cemetery?</h2>
            <p className="co-lede">The cemetery is the customer on a door order.</p>
            <div className="co-cem-grid">
              {KNOWN_ORDER.map(key => {
                const p = CEMETERY_DOOR_PRICING[key]
                const on = choice === key
                return (
                  <button key={key} className={`co-cem-card ${on ? 'on' : ''}`} onClick={() => { setChoice(key); setShowCustom(false) }}>
                    <div className="co-cem-name">{p.label}</div>
                    <div className="co-cem-hint">{pricingHint({ ...p })}</div>
                  </button>
                )
              })}
            </div>
            {!showCustom ? (
              <button className="co-cem-add" onClick={() => { setShowCustom(true); setChoice('CUSTOM') }}>
                + Add another cemetery — starts with Clover Leaf price list, fully editable
              </button>
            ) : (
              <div className={`co-cem-customform ${choice === 'CUSTOM' ? 'on' : ''}`}>
                <input className="co-input" placeholder="Cemetery name" value={customName}
                  onChange={e => { setCustomName(e.target.value); setChoice('CUSTOM') }} autoFocus />
                <button className="co-btn-primary" disabled={!customName.trim()} onClick={() => setChoice('CUSTOM')}>
                  Create with Clover Leaf prices
                </button>
              </div>
            )}
          </div>
        )}

        {/* STEP 2 — COUNT */}
        {step === 1 && (
          <div className="co-narrow co-count">
            <h2 className="co-h2">How many doors?</h2>
            <input className="co-mega mono" type="number" min="1" max="50" value={doorCount}
              onChange={e => setDoorCount(e.target.value)} />
            <p className="co-lede">Each door becomes its own job in production — pickup, blasting, dropoff.</p>
          </div>
        )}

        {/* STEP 3 — DOORS (rail + pane) */}
        {step === 2 && (
          <div className="co-doors">
            <aside className="co-rail">
              {co.doors.map((d, i) => (
                <button key={i} className={`co-rail-item ${i === selDoor ? 'on' : ''}`} onClick={() => setSelDoor(i)}>
                  <div className="co-rail-name">Door {i + 1}{isSplit && d.location ? <span className="co-rail-loc">{d.location}</span> : null}</div>
                  <div className="co-rail-sub">{money(doorSubtotal(d))}</div>
                </button>
              ))}
              <button className="co-rail-add" disabled={co.doors.length >= 50} onClick={addDoor}>+ Add door</button>
              <div className="co-rail-total"><span>Order total</span><strong>{money(subtotal)}</strong></div>
            </aside>

            <section className="co-pane">
              {sel ? (
                <>
                  <div className="co-pane-head">
                    <h2 className="co-h2">Door {selDoor + 1}</h2>
                    <div className="co-pane-sub">{money(doorSubtotal(sel))}</div>
                  </div>
                  {co.doors.length > 1 && (
                    <button className="co-link-danger" onClick={() => removeDoor(selDoor)}>Remove this door</button>
                  )}

                  {isSplit && (
                    <div className="co-field">
                      <span className="co-label">Location</span>
                      <div className="co-pillgroup">
                        <button className={`co-pill ${sel.location === 'indoor' ? 'on' : ''}`} onClick={() => updateDoor(selDoor, { location: 'indoor', selectedItems: [] })}>Indoor</button>
                        <button className={`co-pill ${sel.location === 'outdoor' ? 'on' : ''}`} onClick={() => updateDoor(selDoor, { location: 'outdoor', selectedItems: [] })}>Outdoor</button>
                      </div>
                    </div>
                  )}

                  <div className="co-field">
                    <span className="co-label">Line items</span>
                    {itemMapFor(sel) ? (
                      <div className="co-items">
                        {Object.entries(itemMapFor(sel)).map(([k, entry]) => {
                          const on = hasItem(sel, k)
                          return (
                            <label key={k} className={`co-item ${on ? 'on' : ''}`}>
                              <input type="checkbox" checked={on} onChange={() => toggleItem(selDoor, k)} />
                              <span className="co-item-name">{entry.label}</span>
                              <span className="co-item-price">{money(entry.price)}</span>
                            </label>
                          )
                        })}
                      </div>
                    ) : <div className="co-lede">Pick a location to see the price list.</div>}
                  </div>

                  <div className="co-field">
                    <span className="co-label">Inscription content</span>
                    <textarea className="co-ta mono" rows={3} placeholder="Names / dates / verse carved on this door"
                      value={sel.inscriptionText || ''} onChange={e => updateDoor(selDoor, { inscriptionText: e.target.value })} />
                  </div>
                  <div className="co-field">
                    <span className="co-label">Door notes (optional)</span>
                    <input className="co-input" placeholder="Anything door-specific…"
                      value={sel.notes || ''} onChange={e => updateDoor(selDoor, { notes: e.target.value })} />
                  </div>
                </>
              ) : <div className="co-lede">No doors.</div>}
            </section>
          </div>
        )}

        {/* STEP 4 — PACKET */}
        {step === 3 && (
          <div className="co-narrow">
            <h2 className="co-h2">Upload packet</h2>
            {!co.packet_storage_path ? (
              <label className="co-drop">
                <input type="file" accept="application/pdf,image/*" onChange={handleFile} hidden />
                <div className="co-drop-title">Upload packet</div>
                <div>Click to upload a PDF or image</div>
              </label>
            ) : (
              <div className="co-file">
                <div className="co-file-meta">
                  <div className="co-file-name">{co.packet_storage_path.split('/').pop()}</div>
                  {co._packetSize ? <div className="co-file-size">{(co._packetSize / 1024).toFixed(0)} KB</div> : null}
                </div>
                <label className="co-btn"><input type="file" accept="application/pdf,image/*" onChange={handleFile} hidden />Replace</label>
              </div>
            )}
            <p className="co-lede">Skip this step if no packet was sent.</p>
          </div>
        )}

        {/* STEP 5 — CONTACT */}
        {step === 4 && (
          <div className="co-narrow">
            <h2 className="co-h2">Cemetery contact</h2>
            <div className="co-banner">Phone auto-populates from cemetery records when available. Name and email are typed in for this order.</div>
            <div className="co-field"><span className="co-label">Contact name</span>
              <input className="co-input" value={co.cemetery_contact_name || ''} onChange={e => setCo(c => ({ ...c, cemetery_contact_name: e.target.value }))} /></div>
            <div className="co-grid2">
              <div className="co-field"><span className="co-label">Contact phone</span>
                <input className="co-input" value={co.cemetery_contact_phone || ''} onChange={e => setCo(c => ({ ...c, cemetery_contact_phone: e.target.value }))} /></div>
              <div className="co-field"><span className="co-label">Contact email</span>
                <input className="co-input" type="email" value={co.cemetery_contact_email || ''} onChange={e => setCo(c => ({ ...c, cemetery_contact_email: e.target.value }))} /></div>
            </div>
            <p className="co-lede">All fields optional.</p>
          </div>
        )}

        {/* STEP 6 — REVIEW */}
        {step === 5 && (
          <div className="co-review">
            <div className="co-review-left">
              {overrideStats.count > 0 && (
                <div className="co-overbar">
                  <span>{overrideStats.count} price override{overrideStats.count === 1 ? '' : 's'} applied · {overrideStats.delta >= 0 ? '+' : '−'}{money(Math.abs(overrideStats.delta)).slice(1)}</span>
                  <button className="co-link" onClick={() => setResetModal(true)}>Reset all to defaults</button>
                </div>
              )}
              {co.doors.map((d, i) => {
                const map = itemMapFor(d) || {}
                return (
                  <div key={i} className="co-rcard">
                    <div className="co-rcard-head">
                      <div>
                        <strong>Door {i + 1}</strong>{isSplit && d.location ? <span className="co-rail-loc">{d.location}</span> : null}
                        {d.inscriptionText ? <div className="co-rcard-inscr">“{d.inscriptionText.slice(0, 60)}{d.inscriptionText.length > 60 ? '…' : ''}”</div> : null}
                      </div>
                      <div className="co-rcard-total">{money(doorSubtotal(d))}</div>
                    </div>
                    {(d.selectedItems || []).map(s => {
                      const k = keyOf(s)
                      const ov = overrideOf(d, k)
                      const def = defaultPrice(d, k)
                      const editKey = `${i}:${k}`
                      return (
                        <div key={k} className="co-rline">
                          <span className="co-rline-name">{map[k]?.label || k}</span>
                          {editing === editKey ? (
                            <input className="co-priceedit mono" autoFocus type="number" value={editVal}
                              onChange={e => setEditVal(e.target.value)}
                              onBlur={() => commitEdit(i, k)}
                              onKeyDown={e => { if (e.key === 'Enter') commitEdit(i, k); if (e.key === 'Escape') setEditing(null) }} />
                          ) : (
                            <span className="co-rline-price" onClick={() => beginEdit(i, k)}>
                              {ov != null && <span className="co-strike">{money(def)}</span>}
                              <span className={ov != null ? 'co-ov' : ''}>{money(effPrice(d, k))}</span>
                              <span className="co-pencil" aria-hidden="true">edit</span>
                            </span>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )
              })}
            </div>

            <aside className="co-totals">
              <div className="co-tot-row"><span>Subtotal</span><span className="mono">{money(subtotal)}</span></div>
              <div className="co-tot-toggle">
                <div><div className="co-tog-label">NJ sales tax</div><div className="co-tog-sub">6.625%</div></div>
                <button className={`co-switch ${co.tax_applied ? 'on' : ''}`} onClick={() => setCo(c => ({ ...c, tax_applied: !c.tax_applied }))}><span className="co-knob" /></button>
              </div>
              {co.tax_applied && <div className="co-tot-row co-tot-add"><span>+ Tax</span><span className="mono">{money(taxAmt)}</span></div>}
              <div className="co-tot-toggle">
                <div><div className="co-tog-label">Credit card fee</div><div className="co-tog-sub">3%</div></div>
                <button className={`co-switch ${co.cc_fee_applied ? 'on' : ''}`} onClick={() => setCo(c => ({ ...c, cc_fee_applied: !c.cc_fee_applied }))}><span className="co-knob" /></button>
              </div>
              {co.cc_fee_applied && <div className="co-tot-row co-tot-add"><span>+ CC fee</span><span className="mono">{money(ccAmt)}</span></div>}
              <div className="co-tot-total"><span>Total Due</span><span className="mono">{money(total)}</span></div>
              <div className="co-tot-foot">PO number assigned on submit (next: CO-{new Date().getFullYear()}-NNN)</div>
            </aside>
          </div>
        )}

        {step === 5 && (
          <div className="co-est">
            <div className="co-est-head">Cost estimates <span className="co-est-opt">optional</span></div>
            <p className="co-est-sub">Quote-time cost assumptions for this order — drives the projected margin in the order's P&amp;L. Leave blank to skip; editable later on the order.</p>
            <div className="co-est-grid">
              {ESTIMATE_CATEGORIES.map(({ key, label }) => (
                <label key={key} className="co-est-field">{label}
                  <input type="number" step="0.01" min="0" value={estimates[key] ?? ''}
                    onChange={e => setEstimates(s => ({ ...s, [key]: e.target.value }))} placeholder="0.00" />
                </label>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* footer nav */}
      {step < 5 ? (
        <footer className="co-foot">
          <button className="co-btn" onClick={goBack} disabled={step === 0}>Back</button>
          <div style={{ display: 'flex', gap: 8 }}>
            {editMode && <button className="co-btn-primary" disabled={busy} onClick={saveChanges}>{busy ? 'Saving…' : 'Save changes'}</button>}
            <button className="co-btn-primary" onClick={goNext} disabled={!canContinue || busy}>Continue</button>
          </div>
        </footer>
      ) : (
        <footer className="co-foot">
          <button className="co-btn" onClick={() => setStep(2)}>Back to edit</button>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="co-btn" onClick={() => window.print()}>Preview PO</button>
            {editMode
              ? <button className="co-btn-primary" disabled={busy} onClick={saveChanges}>{busy ? 'Saving…' : 'Save changes'}</button>
              : <button className="co-btn-primary" disabled={busy || !allDoorsValid} onClick={handleSubmit}>{busy ? 'Submitting…' : 'Submit to production'}</button>}
          </div>
        </footer>
      )}

      {resetModal && (
        <div className="co-modal-bg" onClick={() => setResetModal(false)}>
          <div className="co-modal" onClick={e => e.stopPropagation()}>
            <h3 className="co-modal-title">Reset all overrides?</h3>
            <p className="co-modal-body">This clears every price override and turns off the tax / CC-fee toggles, back to default pricing.</p>
            <div className="co-modal-actions">
              <button className="co-btn" onClick={() => setResetModal(false)}>Cancel</button>
              <button className="co-btn-primary" onClick={resetAll}>Reset to defaults</button>
            </div>
          </div>
        </div>
      )}

      {confirmClose && (
        <div className="co-modal-bg" onClick={() => setConfirmClose(false)}>
          <div className="co-modal" onClick={e => e.stopPropagation()}>
            <h3 className="co-modal-title">Unsaved changes</h3>
            <p className="co-modal-body">Your latest edits haven't finished saving yet. Save them before closing?</p>
            <div className="co-modal-actions">
              <button className="co-btn" onClick={() => setConfirmClose(false)}>Keep editing</button>
              <button className="co-btn" onClick={discardClose}>Discard</button>
              <button className="co-btn-primary" disabled={busy} onClick={saveAndClose}>{busy ? 'Saving…' : 'Save & close'}</button>
            </div>
          </div>
        </div>
      )}

      {/* print-only PO (Preview PO / print) */}
      <div className="co-print-po">
        <div className="co-ppo-lh">
          <div>
            <div className="co-ppo-name">{COMPANY.name}</div>
            <div className="co-ppo-estd">{COMPANY.estd}</div>
            <div className="co-ppo-addr">{COMPANY.addr}<br />{COMPANY.phone} · {COMPANY.email}</div>
          </div>
          <div className="co-ppo-poblock">
            <div className="co-ppo-potitle">Purchase Order</div>
            <div className="co-ppo-ponum mono">CO-{new Date().getFullYear()}-NNN</div>
            <div className="co-ppo-podate">Issued: {new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</div>
          </div>
        </div>
        <div className="co-ppo-billto"><strong>{co.cemetery_name}</strong>{co.cemetery_contact_name ? <> · {co.cemetery_contact_name}</> : null}{co.cemetery_contact_phone ? <> · {co.cemetery_contact_phone}</> : null}</div>
        <table className="co-ppo-table">
          <thead><tr><th>Door</th><th>Items / inscription</th><th className="r">Amount</th></tr></thead>
          <tbody>
            {co.doors.map((d, i) => {
              const map = itemMapFor(d) || {}
              return (
                <tr key={i}>
                  <td>{i + 1}{isSplit && d.location ? ` (${d.location})` : ''}</td>
                  <td>{(d.selectedItems || []).map(s => map[keyOf(s)]?.label || keyOf(s)).join(', ')}{d.inscriptionText ? <div className="co-ppo-inscr">“{d.inscriptionText}”</div> : null}</td>
                  <td className="r mono">{money(doorSubtotal(d))}</td>
                </tr>
              )
            })}
          </tbody>
          <tfoot>
            {co.tax_applied && <tr><td colSpan={2} className="r">NJ sales tax (6.625%)</td><td className="r mono">{money(taxAmt)}</td></tr>}
            {co.cc_fee_applied && <tr><td colSpan={2} className="r">Credit card fee (3%)</td><td className="r mono">{money(ccAmt)}</td></tr>}
            <tr><td colSpan={2} className="r"><strong>Total due</strong></td><td className="r mono"><strong>{money(total)}</strong></td></tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}

const styles = `
  :root{ --co-accent:#B8860B; --co-cream:#fdfaf2; --co-ink:#0F1419; }
  .co-root{ position:fixed; inset:0; background:var(--sb-bg,#f4f2ee); overflow-y:auto; z-index:900;
    padding:24px 28px 96px; font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; color:var(--sb-text,#0F1419); }
  .mono{ font-family:'JetBrains Mono',ui-monospace,Menlo,monospace; }
  .co-top{ display:flex; justify-content:space-between; align-items:flex-start; max-width:1100px; margin:0 auto 16px; }
  .co-eyebrow{ font-size:11px; text-transform:uppercase; letter-spacing:.09em; color:var(--sb-text-muted,#73777e); }
  .co-draft-badge{ display:inline-block; margin-left:8px; font-size:10px; font-weight:600; letter-spacing:.06em; color:#fff; background:#8b8f95; border-radius:3px; padding:1px 7px; vertical-align:middle; }
  .co-editwarn{ max-width:1100px; margin:0 auto 18px; background:#fbe9d6; color:#9a5b1a; border:.5px solid #efcfa3; padding:10px 14px; border-radius:8px; font-size:13px; }
  .co-drop-title{ font-weight:600; font-size:15px; margin-bottom:4px; }
  .co-est{ max-width:1100px; margin:18px auto 0; background:#fff; border:.5px solid var(--sb-border,#e4e0d8); border-radius:12px; padding:20px 22px; }
  .co-est-head{ font-size:15px; font-weight:600; }
  .co-est-opt{ font-size:10px; text-transform:uppercase; letter-spacing:.06em; color:#73777e; background:#f0eee9; border-radius:4px; padding:2px 8px; margin-left:8px; vertical-align:middle; }
  .co-est-sub{ font-size:12.5px; color:var(--sb-text-muted,#73777e); margin:4px 0 14px; }
  .co-est-grid{ display:grid; grid-template-columns:repeat(3,1fr); gap:12px 16px; }
  .co-est-field{ display:flex; flex-direction:column; gap:5px; font-size:12px; color:var(--sb-text-muted,#73777e); }
  .co-est-field input{ font:inherit; font-size:14px; padding:8px 10px; border:.5px solid var(--sb-border,#e4e0d8); border-radius:6px; background:#fff; }
  .co-h1{ font-size:25px; font-weight:600; margin:3px 0 0; letter-spacing:-.01em; }
  .co-close{ border:.5px solid var(--sb-border,#e4e0d8); background:#fff; border-radius:6px; padding:8px 14px; color:var(--sb-text-muted,#73777e); font:inherit; font-size:13px; cursor:pointer; }
  .co-stepper{ display:flex; gap:6px; flex-wrap:wrap; max-width:1100px; margin:0 auto 24px; }
  .co-sp{ font-size:12px; padding:5px 12px 5px 7px; border-radius:999px; background:#fff; border:.5px solid var(--sb-border,#e4e0d8); color:var(--sb-text-muted,#73777e); display:inline-flex; align-items:center; gap:7px; }
  .co-sp-n{ width:18px; height:18px; border-radius:999px; background:#eceae4; color:#73777e; font-size:11px; display:inline-flex; align-items:center; justify-content:center; }
  .co-sp.on{ background:var(--co-accent); color:#fff; border-color:transparent; } .co-sp.on .co-sp-n{ background:rgba(255,255,255,.25); color:#fff; }
  .co-sp.done{ color:var(--co-ink); } .co-sp.done .co-sp-n{ background:var(--co-cream); color:var(--co-accent); }
  .co-err{ max-width:1100px; margin:0 auto 14px; background:#fbe5e5; color:#b54040; padding:10px 14px; border-radius:6px; font-size:13px; }
  .co-stage{ max-width:1100px; margin:0 auto; }
  .co-narrow{ max-width:720px; }
  .co-h2{ font-size:19px; font-weight:600; margin:0 0 4px; }
  .co-lede{ font-size:13px; color:var(--sb-text-muted,#73777e); margin:6px 0 18px; }
  .co-label{ display:block; font-size:12px; font-weight:500; color:var(--sb-text-muted,#73777e); margin-bottom:6px; }
  .co-field{ margin-bottom:16px; }
  .co-grid2{ display:grid; grid-template-columns:1fr 1fr; gap:14px; }
  .co-input{ width:100%; font:inherit; font-size:14px; padding:10px 12px; border:.5px solid var(--sb-border,#e4e0d8); border-radius:6px; background:#fff; box-sizing:border-box; }
  .co-ta{ width:100%; font-size:13px; padding:10px 12px; border:.5px solid var(--sb-border,#e4e0d8); border-radius:6px; resize:vertical; box-sizing:border-box; }
  .co-banner{ background:var(--co-cream); border-left:3px solid var(--co-accent); padding:10px 14px; font-size:12.5px; color:#7a5e16; border-radius:0 6px 6px 0; margin-bottom:18px; }
  .co-btn{ border:.5px solid var(--sb-border,#e4e0d8); background:#fff; border-radius:6px; padding:9px 16px; font:inherit; font-size:13px; cursor:pointer; }
  .co-btn:disabled{ opacity:.5; cursor:not-allowed; }
  .co-btn-primary{ border:none; background:var(--co-ink); color:#fff; border-radius:6px; padding:10px 18px; font:inherit; font-size:13px; font-weight:600; cursor:pointer; }
  .co-btn-primary:disabled{ opacity:.5; cursor:not-allowed; }
  .co-link{ background:none; border:none; color:var(--co-accent); font:inherit; font-size:12.5px; cursor:pointer; text-decoration:underline; }
  .co-link-danger{ background:none; border:none; color:#b54040; font:inherit; font-size:12.5px; cursor:pointer; padding:0; margin-bottom:14px; }
  /* step 1 */
  .co-cem-grid{ display:grid; grid-template-columns:1fr 1fr; gap:12px; }
  .co-cem-card{ text-align:left; border:.5px solid var(--sb-border,#e4e0d8); background:#fff; border-radius:10px; padding:18px 20px; cursor:pointer; }
  .co-cem-card.on{ border:2px solid var(--co-accent); background:var(--co-cream); padding:17px 19px; }
  .co-cem-name{ font-size:15px; font-weight:600; }
  .co-cem-hint{ font-size:12px; color:var(--sb-text-muted,#73777e); margin-top:4px; }
  .co-cem-add{ display:block; width:100%; margin-top:12px; border:1.5px dashed var(--sb-border,#cfcabf); background:transparent; border-radius:10px; padding:16px; font:inherit; font-size:13px; color:var(--sb-text-muted,#73777e); cursor:pointer; }
  .co-cem-customform{ display:flex; gap:10px; margin-top:12px; padding:16px; border:1.5px dashed var(--sb-border,#cfcabf); border-radius:10px; }
  .co-cem-customform.on{ border:2px solid var(--co-accent); background:var(--co-cream); }
  .co-cem-customform .co-input{ flex:1; }
  /* step 2 */
  .co-count{ text-align:center; }
  .co-mega{ width:240px; text-align:center; font-size:64px; letter-spacing:4px; padding:28px; border:.5px solid var(--sb-border,#e4e0d8); border-radius:12px; background:#fff; }
  .co-count .co-lede{ max-width:420px; margin:18px auto 0; }
  /* step 3 */
  .co-doors{ display:grid; grid-template-columns:320px 1fr; gap:20px; align-items:start; }
  .co-rail{ position:sticky; top:24px; background:var(--co-cream); border:.5px solid var(--sb-border,#e4e0d8); border-radius:10px; padding:10px; }
  .co-rail-item{ display:flex; justify-content:space-between; align-items:center; width:100%; text-align:left; border:none; background:transparent; border-radius:8px; padding:11px 12px; cursor:pointer; font:inherit; margin-bottom:2px; }
  .co-rail-item.on{ background:var(--co-ink); color:#fff; }
  .co-rail-name{ font-size:13.5px; font-weight:500; }
  .co-rail-loc{ font-size:10px; text-transform:uppercase; letter-spacing:.05em; background:var(--co-accent); color:#fff; border-radius:3px; padding:1px 6px; margin-left:7px; }
  .co-rail-item.on .co-rail-loc{ background:rgba(255,255,255,.25); }
  .co-rail-sub{ font-size:12.5px; font-variant-numeric:tabular-nums; opacity:.85; }
  .co-rail-add{ width:100%; border:.5px solid var(--sb-border,#e4e0d8); background:#fff; border-radius:8px; padding:9px; font:inherit; font-size:13px; cursor:pointer; margin-top:6px; }
  .co-rail-total{ display:flex; justify-content:space-between; padding:12px 12px 6px; margin-top:6px; border-top:.5px solid var(--sb-border,#e4e0d8); font-size:14px; }
  .co-rail-total strong{ font-variant-numeric:tabular-nums; }
  .co-pane{ background:#fff; border:.5px solid var(--sb-border,#e4e0d8); border-radius:10px; padding:24px; }
  .co-pane-head{ display:flex; justify-content:space-between; align-items:baseline; margin-bottom:4px; }
  .co-pane-sub{ font-size:16px; font-weight:600; font-variant-numeric:tabular-nums; }
  .co-pillgroup{ display:inline-flex; border:.5px solid var(--sb-border,#e4e0d8); border-radius:6px; overflow:hidden; }
  .co-pill{ border:none; background:#fff; padding:8px 18px; font:inherit; font-size:13px; cursor:pointer; color:var(--sb-text-muted,#73777e); }
  .co-pill.on{ background:var(--co-accent); color:#fff; font-weight:500; }
  .co-items{ display:grid; grid-template-columns:1fr 1fr; gap:6px 16px; }
  .co-item{ display:flex; align-items:center; gap:9px; padding:8px 10px; border:.5px solid transparent; border-radius:6px; cursor:pointer; }
  .co-item.on{ background:var(--co-cream); }
  .co-item input{ accent-color:var(--co-accent); width:15px; height:15px; }
  .co-item-name{ flex:1; font-size:13.5px; }
  .co-item-price{ font-size:13px; color:var(--sb-text-muted,#73777e); font-variant-numeric:tabular-nums; }
  .co-item.on .co-item-price{ color:var(--co-ink); font-weight:600; }
  /* step 4 */
  .co-drop{ display:flex; flex-direction:column; align-items:center; gap:8px; border:1.5px dashed var(--sb-border,#cfcabf); border-radius:12px; padding:40px; cursor:pointer; color:var(--sb-text-muted,#73777e); }
  .co-drop-icon{ font-size:34px; }
  .co-file{ display:flex; align-items:center; gap:14px; border:.5px solid var(--sb-border,#e4e0d8); border-radius:10px; padding:16px; background:#fff; }
  .co-file-icon{ font-size:26px; } .co-file-meta{ flex:1; } .co-file-name{ font-weight:500; font-size:14px; } .co-file-size{ font-size:12px; color:var(--sb-text-muted,#73777e); }
  /* step 6 */
  .co-review{ display:grid; grid-template-columns:1fr 320px; gap:20px; align-items:start; }
  .co-overbar{ display:flex; justify-content:space-between; align-items:center; background:var(--co-cream); border:.5px solid #e8dcbf; border-radius:8px; padding:10px 14px; font-size:13px; margin-bottom:14px; color:#7a5e16; }
  .co-rcard{ background:#fff; border:.5px solid var(--sb-border,#e4e0d8); border-radius:10px; padding:18px 20px; margin-bottom:12px; }
  .co-rcard-head{ display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:10px; padding-bottom:10px; border-bottom:.5px solid var(--sb-border,#e4e0d8); }
  .co-rcard-inscr{ font-style:italic; font-size:12px; color:var(--sb-text-muted,#73777e); margin-top:4px; }
  .co-rcard-total{ font-weight:600; font-variant-numeric:tabular-nums; }
  .co-rline{ display:flex; justify-content:space-between; align-items:center; padding:6px 0; font-size:13.5px; }
  .co-rline-price{ display:inline-flex; align-items:center; gap:7px; cursor:pointer; font-variant-numeric:tabular-nums; }
  .co-pencil{ font-size:11px; color:var(--co-accent); opacity:.6; }
  .co-strike{ text-decoration:line-through; color:var(--sb-text-muted,#9a9da3); font-size:12px; }
  .co-ov{ color:var(--co-accent); font-weight:600; }
  .co-priceedit{ width:90px; text-align:right; border:1.5px solid var(--co-accent); background:var(--co-cream); border-radius:5px; padding:5px 8px; font-size:13px; }
  .co-totals{ position:sticky; top:24px; background:var(--co-ink); color:#fff; border-radius:12px; padding:22px; }
  .co-tot-row{ display:flex; justify-content:space-between; font-size:13.5px; padding:6px 0; color:#cdd0d4; }
  .co-tot-add{ color:#9aa; font-size:12.5px; }
  .co-tot-toggle{ display:flex; justify-content:space-between; align-items:center; padding:12px 0; border-top:.5px solid rgba(255,255,255,.12); margin-top:6px; }
  .co-tog-label{ font-size:13.5px; } .co-tog-sub{ font-size:11px; color:#8a8f96; }
  .co-switch{ width:32px; height:18px; border-radius:999px; background:#3a3f46; border:none; cursor:pointer; position:relative; padding:0; }
  .co-switch.on{ background:var(--co-accent); }
  .co-knob{ position:absolute; top:2px; left:2px; width:14px; height:14px; border-radius:999px; background:#fff; transition:transform .12s; }
  .co-switch.on .co-knob{ transform:translateX(14px); }
  .co-tot-total{ display:flex; justify-content:space-between; align-items:baseline; font-size:20px; font-weight:700; padding:14px 0 4px; margin-top:8px; border-top:1.5px solid rgba(255,255,255,.2); }
  .co-tot-total .mono{ font-variant-numeric:tabular-nums; }
  .co-tot-foot{ font-size:11px; color:#8a8f96; margin-top:10px; }
  /* footer + modal */
  .co-foot{ position:fixed; bottom:0; left:0; right:0; background:#fff; border-top:.5px solid var(--sb-border,#e4e0d8); padding:14px 28px; display:flex; justify-content:space-between; align-items:center; }
  .co-modal-bg{ position:fixed; inset:0; background:rgba(15,20,25,.42); z-index:1000; display:flex; align-items:center; justify-content:center; padding:24px; }
  .co-modal{ background:#fff; border-radius:10px; max-width:440px; padding:26px 28px; box-shadow:0 16px 48px rgba(15,20,25,.24); }
  .co-modal-title{ font-size:18px; font-weight:600; margin:0 0 10px; }
  .co-modal-body{ font-size:14px; color:var(--sb-text-muted,#54585e); margin:0 0 20px; line-height:1.5; }
  .co-modal-actions{ display:flex; justify-content:flex-end; gap:8px; }
  /* print PO — hidden on screen, shown only when printing */
  .co-print-po{ display:none; }
  @media print{
    .co-root > *:not(.co-print-po){ display:none !important; }
    .co-root{ position:static; padding:0; background:#fff; }
    .co-print-po{ display:block; color:#111; font-size:12.5px; }
    .co-ppo-lh{ display:flex; justify-content:space-between; border-bottom:2px solid var(--co-accent); padding-bottom:16px; }
    .co-ppo-name{ font-size:21px; font-weight:700; letter-spacing:.03em; }
    .co-ppo-estd{ font-size:10px; text-transform:uppercase; letter-spacing:.14em; color:var(--co-accent); margin-top:3px; font-weight:600; }
    .co-ppo-addr{ font-size:11px; color:#555; margin-top:8px; line-height:1.5; }
    .co-ppo-poblock{ text-align:right; }
    .co-ppo-potitle{ font-size:11px; letter-spacing:.16em; text-transform:uppercase; color:#888; font-weight:600; }
    .co-ppo-ponum{ font-size:22px; font-weight:700; margin-top:2px; }
    .co-ppo-podate{ font-size:11px; color:#555; margin-top:6px; }
    .co-ppo-billto{ margin:18px 0 14px; font-size:13px; }
    .co-ppo-table{ width:100%; border-collapse:collapse; }
    .co-ppo-table th{ text-align:left; font-size:10px; letter-spacing:.08em; text-transform:uppercase; color:#888; border-bottom:1.5px solid #111; padding:0 6px 7px; }
    .co-ppo-table td{ padding:9px 6px; border-bottom:.5px solid #ddd; vertical-align:top; }
    .co-ppo-table .r{ text-align:right; }
    .co-ppo-inscr{ font-style:italic; color:#555; margin-top:3px; }
  }
  @media (max-width:880px){ .co-doors,.co-review{ grid-template-columns:1fr; } .co-rail,.co-totals{ position:static; } .co-cem-grid,.co-items,.co-grid2{ grid-template-columns:1fr; } }
`

if (typeof document !== 'undefined' && !document.getElementById('co-wizard-styles')) {
  const tag = document.createElement('style')
  tag.id = 'co-wizard-styles'
  tag.textContent = styles
  document.head.appendChild(tag)
}
