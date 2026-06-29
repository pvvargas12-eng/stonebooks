// =============================================================================
// CardQuickEdit — three-dot quick-edit popover for an Order detail card.
// =============================================================================
// The ⋯ trigger lives in a card's header (Section headerAction). Clicking it opens
// a tight, positioned popover with an edit form — NOT a modal maze. Closes on Save,
// Cancel, outside-click, or Esc. onSave returns { ok, error? }; the popover shows
// the error inline and stays open on failure, closes on success.
//
// Every control a panel renders inside must write to the REAL source of truth — the
// panels (in OrderDetail) do the writes in their onSave; this component is just the
// shell + a few tight input primitives (CqeText/CqeArea/CqeSelect/CqeDate/CqeRow).
// =============================================================================
import { useState, useEffect, useRef } from 'react'

export default function CardQuickEdit({ title, children, onOpen, onSave, saveLabel = 'Save', disabled, width = 320 }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey) }
  }, [open])

  const handleOpen = () => { setErr(null); onOpen?.(); setOpen(true) }
  const handleSave = async () => {
    if (busy) return
    setBusy(true); setErr(null)
    try {
      const r = await onSave?.()
      setBusy(false)
      if (r && r.ok === false) { setErr(r.error || 'Could not save.'); return }
      setOpen(false)
    } catch (e) {
      setBusy(false); setErr(e?.message || 'Could not save.')
    }
  }

  return (
    <div className="sb-cqe" ref={ref}>
      <button type="button" className="sb-cqe-trigger" aria-label={`Edit ${title}`} title={`Edit ${title}`}
        onClick={() => (open ? setOpen(false) : handleOpen())}>⋯</button>
      {open && (
        <div className="sb-cqe-pop" role="dialog" aria-label={`Edit ${title}`} style={{ width }}>
          <div className="sb-cqe-head">{title}</div>
          <div className="sb-cqe-body">{children}</div>
          {err && <div className="sb-cqe-err">{err}</div>}
          <div className="sb-cqe-foot">
            <button type="button" className="sb-cqe-btn" onClick={() => setOpen(false)} disabled={busy}>Cancel</button>
            <button type="button" className="sb-cqe-btn sb-cqe-btn-primary" onClick={handleSave} disabled={busy || disabled}>
              {busy ? 'Saving…' : saveLabel}
            </button>
          </div>
        </div>
      )}
      <style>{CQE_CSS}</style>
    </div>
  )
}

// ── Tight input primitives (shared layout for every panel) ───────────────────
export function CqeRow({ children, cols = 1 }) {
  return <div className="sb-cqe-row" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>{children}</div>
}
export function CqeText({ label, value, onChange, placeholder, type = 'text', hint }) {
  return (
    <label className="sb-cqe-field">
      <span className="sb-cqe-lab">{label}{hint && <em> {hint}</em>}</span>
      <input className="sb-cqe-input" type={type} value={value ?? ''} placeholder={placeholder || ''}
        onChange={e => onChange(e.target.value)} />
    </label>
  )
}
export function CqeArea({ label, value, onChange, placeholder, rows = 2, hint }) {
  return (
    <label className="sb-cqe-field">
      <span className="sb-cqe-lab">{label}{hint && <em> {hint}</em>}</span>
      <textarea className="sb-cqe-input sb-cqe-area" rows={rows} value={value ?? ''} placeholder={placeholder || ''}
        onChange={e => onChange(e.target.value)} />
    </label>
  )
}
export function CqeSelect({ label, value, onChange, options, hint }) {
  return (
    <label className="sb-cqe-field">
      <span className="sb-cqe-lab">{label}{hint && <em> {hint}</em>}</span>
      <select className="sb-cqe-input" value={value ?? ''} onChange={e => onChange(e.target.value)}>
        {options.map(o => <option key={o.code} value={o.code} disabled={o.disabled}>{o.label}</option>)}
      </select>
    </label>
  )
}
export function CqeDate({ label, value, onChange, hint }) {
  return <CqeText label={label} value={value} onChange={onChange} type="date" hint={hint} />
}
export function CqeCheck({ label, checked, onChange, hint }) {
  return (
    <label className="sb-cqe-check">
      <input type="checkbox" checked={!!checked} onChange={e => onChange(e.target.checked)} />
      <span>{label}{hint && <em className="sb-cqe-lab"> {hint}</em>}</span>
    </label>
  )
}
export function CqeNote({ children }) { return <div className="sb-cqe-note">{children}</div> }

const CQE_CSS = `
  .sb-cqe { position: relative; display: inline-flex; }
  .sb-cqe-trigger { border: none; background: transparent; color: #8a8a85; font-size: 18px; line-height: 1;
    width: 26px; height: 22px; border-radius: 6px; cursor: pointer; letter-spacing: 1px; }
  .sb-cqe-trigger:hover { background: #efece4; color: #2a2a27; }
  .sb-cqe-pop { position: absolute; top: 26px; right: 0; z-index: 40; background: #fff; border: 1px solid #e2ded4;
    border-radius: 12px; box-shadow: 0 10px 30px rgba(15,20,25,0.16); padding: 12px; max-height: 70vh; overflow: auto; }
  .sb-cqe-head { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.07em; color: #6a6a66;
    margin-bottom: 10px; }
  .sb-cqe-body { display: flex; flex-direction: column; gap: 9px; }
  .sb-cqe-row { display: grid; gap: 9px; }
  .sb-cqe-field { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
  .sb-cqe-lab { font-size: 11px; font-weight: 600; color: #6a6a66; }
  .sb-cqe-lab em { font-style: normal; font-weight: 400; color: #a09a8c; }
  .sb-cqe-input { font: inherit; font-size: 13px; padding: 7px 8px; border: 1px solid #d8d6d1; border-radius: 7px;
    background: #fff; color: #1a1a17; width: 100%; box-sizing: border-box; }
  .sb-cqe-input:focus { outline: none; border-color: #9A7209; }
  .sb-cqe-area { resize: vertical; line-height: 1.35; }
  .sb-cqe-check { display: flex; align-items: center; gap: 8px; font-size: 13px; color: #2a2a27; cursor: pointer; }
  .sb-cqe-note { font-size: 11.5px; color: #8a8a85; line-height: 1.4; background: #f7f5ef; border-radius: 7px; padding: 7px 8px; }
  .sb-cqe-err { margin-top: 9px; font-size: 12px; color: #b3261e; background: #fdeceb; border-radius: 7px; padding: 7px 8px; }
  .sb-cqe-foot { display: flex; justify-content: flex-end; gap: 8px; margin-top: 12px; }
  .sb-cqe-btn { font: inherit; font-size: 12.5px; font-weight: 600; padding: 7px 14px; border-radius: 8px;
    border: 1px solid #d8d6d1; background: #fff; color: #4a4a45; cursor: pointer; }
  .sb-cqe-btn:hover:not(:disabled) { background: #f3f1ec; }
  .sb-cqe-btn-primary { background: #0F1419; border-color: #0F1419; color: #fff; }
  .sb-cqe-btn-primary:hover:not(:disabled) { background: #1d2733; }
  .sb-cqe-btn:disabled { opacity: 0.5; cursor: default; }
  .sb-od-card-eyebrow-row { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }
  .sb-od-card-action { flex-shrink: 0; margin-top: -2px; }
  /* Quick-edit sub-section divider + permit-fee block (Cemetery & Grave panel). */
  .sb-od-cqe-divider { font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.07em;
    color: #9A7209; border-top: 1px solid #ece8df; padding-top: 10px; margin-top: 4px; }
  .sb-od-cqe-paid { display: flex; flex-direction: column; gap: 3px; }
  .sb-od-cqe-paid-row { font-size: 12px; color: #15724a; background: #e7f6ee; border-radius: 6px; padding: 5px 8px; }
  .sb-od-cqe-fee-btn { width: 100%; justify-content: center; margin-top: 2px; border-color: #c9a23a; color: #6a4d0c; background: #fdf6e7; }
  .sb-od-cqe-fee-btn:hover:not(:disabled) { background: #f8edd3; }
  .sb-od-cqe-okmsg { font-size: 12px; color: #15724a; background: #e7f6ee; border-radius: 7px; padding: 7px 8px; }
`
