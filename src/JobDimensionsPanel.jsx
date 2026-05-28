// =============================================================================
// Stonebooks — Job dimensions panel (backfill tags for future rollups)
// =============================================================================
// Collapsed-by-default accordion under the P&L panel. Tags a job / cemetery
// order with dimensional data (sales rep, referral source) so future sprints
// can build rep / referral rollups on the dimensional substrate (Migration K).
// One Save button, disabled until dirty. NOTE: Crew and Referral-entity are
// deferred — their columns (crew_id, referral_entity_id) are uuid/FK-shaped
// with no lookup tables yet, so free-text entry would fail; they get pickers
// in a later sprint when crews / funeral_homes tables exist.
// =============================================================================

import { useState, useEffect } from 'react'
import { getStaffList, updateJobDimensions, updateCemeteryOrder } from './lib/stonebooksData'

const REFERRAL_SOURCES = [
  { key: 'funeral_home',      label: 'Funeral home' },
  { key: 'repeat_family',     label: 'Repeat family' },
  { key: 'walk_in',           label: 'Walk-in' },
  { key: 'web',               label: 'Web' },
  { key: 'cemetery_referral', label: 'Cemetery referral' },
  { key: 'other',             label: 'Other' },
]

export default function JobDimensionsPanel({ target, initial = {}, contractTotal = null, onSaved }) {
  const isJob = !!target?.jobId
  const [open, setOpen] = useState(false)
  const [staff, setStaff] = useState([])
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)

  // quoted_total prefills from the contract total only when not already set.
  const qtPrefilled = isJob && (initial.quoted_total == null) && contractTotal != null
  const [form, setForm] = useState({
    sales_rep_id: initial.sales_rep_id || '',
    referral_source: initial.referral_source || '',
    quoted_total: initial.quoted_total != null ? String(initial.quoted_total) : (qtPrefilled ? String(contractTotal) : ''),
  })
  const [qtTouched, setQtTouched] = useState(initial.quoted_total != null)

  useEffect(() => { getStaffList().then(setStaff) }, [])

  const dirty =
    form.sales_rep_id !== (initial.sales_rep_id || '') ||
    form.referral_source !== (initial.referral_source || '') ||
    (isJob && qtTouched && form.quoted_total !== (initial.quoted_total != null ? String(initial.quoted_total) : ''))

  const save = async () => {
    setBusy(true); setSaved(false)
    const patch = {
      sales_rep_id: form.sales_rep_id || null,
      referral_source: form.referral_source || null,
    }
    if (isJob) {
      const qt = form.quoted_total.trim()
      patch.quoted_total = qt === '' ? null : Math.round(Number(qt) * 100) / 100
      await updateJobDimensions(target.jobId, patch)
    } else {
      await updateCemeteryOrder(target.cemeteryOrderId, patch)
    }
    setBusy(false); setSaved(true); onSaved?.()
  }

  return (
    <div className="jdp">
      <button className="jdp-head" onClick={() => setOpen(o => !o)}>
        <span className="jdp-title">Job tags &amp; dimensions</span>
        <span className="jdp-chev">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div className="jdp-body">
          <p className="jdp-lede">Tagging powers future sales-rep and referral rollups. Optional — leave blank if unknown.</p>
          <div className="jdp-grid">
            <label className="jdp-field">Sales rep
              <select value={form.sales_rep_id} onChange={e => setForm(f => ({ ...f, sales_rep_id: e.target.value }))}>
                <option value="">— unset —</option>
                {staff.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
            <label className="jdp-field">Referral source
              <select value={form.referral_source} onChange={e => setForm(f => ({ ...f, referral_source: e.target.value }))}>
                <option value="">— unset —</option>
                {REFERRAL_SOURCES.map(r => <option key={r.key} value={r.key}>{r.label}</option>)}
              </select>
            </label>
            {isJob && (
              <label className="jdp-field">Quoted total
                <input type="number" step="0.01" min="0"
                  className={qtPrefilled && !qtTouched ? 'jdp-prefill' : ''}
                  value={form.quoted_total}
                  onChange={e => { setQtTouched(true); setForm(f => ({ ...f, quoted_total: e.target.value })) }} />
                {qtPrefilled && !qtTouched && <span className="jdp-hint">from contract total — edit if different</span>}
              </label>
            )}
          </div>
          <div className="jdp-actions">
            {saved && !dirty && <span className="jdp-saved">Saved</span>}
            <button className="jdp-save" disabled={busy || !dirty} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>
          </div>
        </div>
      )}
    </div>
  )
}

const styles = `
  .jdp{ border:.5px solid var(--sb-border); border-radius:10px; margin-top:12px; background:var(--sb-surface); }
  .jdp-head{ display:flex; align-items:center; justify-content:space-between; width:100%; background:none; border:none; padding:14px 18px; font:inherit; cursor:pointer; }
  .jdp-title{ font-size:14px; font-weight:600; color:var(--sb-text); }
  .jdp-chev{ color:var(--sb-text-muted); }
  .jdp-body{ padding:0 18px 18px; }
  .jdp-lede{ font-size:12px; color:var(--sb-text-muted); margin:0 0 14px; }
  .jdp-grid{ display:grid; grid-template-columns:repeat(3,1fr); gap:14px; }
  .jdp-field{ display:flex; flex-direction:column; gap:5px; font-size:12px; color:var(--sb-text-muted); }
  .jdp-field select, .jdp-field input{ font:inherit; font-size:13px; padding:8px 10px; border:.5px solid var(--sb-border); border-radius:6px; background:var(--sb-bg); color:var(--sb-text); }
  .jdp-prefill{ color:var(--sb-text-muted); font-style:italic; }
  .jdp-hint{ font-size:11px; color:var(--sb-text-muted); font-style:italic; }
  .jdp-actions{ display:flex; justify-content:flex-end; align-items:center; gap:12px; margin-top:16px; }
  .jdp-saved{ font-size:12px; color:#2d7a4f; }
  .jdp-save{ border:.5px solid var(--sb-border); background:var(--sb-text); color:var(--sb-bg); border-radius:6px; padding:8px 18px; font:inherit; font-size:13px; cursor:pointer; }
  .jdp-save:disabled{ opacity:.4; cursor:not-allowed; }
`
if (typeof document !== 'undefined' && !document.getElementById('jdp-styles')) {
  const tag = document.createElement('style'); tag.id = 'jdp-styles'; tag.textContent = styles
  document.head.appendChild(tag)
}
