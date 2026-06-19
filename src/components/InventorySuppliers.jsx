// =============================================================================
// InventorySuppliers — manage MATERIAL suppliers (stone / photo / etching /
// bronze). Distinct from the partner Vendors tab. Add / edit / deactivate; the PR
// builders' supplier dropdowns read from the same suppliers table.
// =============================================================================

import { useState, useEffect, useCallback } from 'react'
import { listSuppliers, createSupplier, updateSupplier, deleteSupplier, SUPPLIER_KINDS } from '../lib/stonebooksData'

const isActive = (s) => s.active !== false   // null/undefined → active
const KIND_COLOR = { stone: '#8a7340', photo: '#8a5cc4', etching: '#3f6ea5', bronze: '#a6701f' }
const BLANK = { name: '', contact_name: '', phone: '', email: '', terms: '', lead_time_days: '', kinds: ['stone'], notes: '', active: true }

export default function InventorySuppliers() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadErr, setLoadErr] = useState(null)
  const [showInactive, setShowInactive] = useState(false)
  const [editing, setEditing] = useState(null)   // null | 'new' | supplier row
  const [banner, setBanner] = useState(null)
  const [busyId, setBusyId] = useState(null)

  const load = useCallback(async () => {
    const r = await listSuppliers()
    setLoadErr(r.ok ? null : r.error)
    setRows(r.rows || [])
    setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  const visible = rows.filter(s => showInactive || isActive(s))
  const inactiveCount = rows.filter(s => !isActive(s)).length

  const toggleActive = async (s) => {
    setBusyId(s.id); setBanner(null)
    const r = await updateSupplier(s.id, { active: !isActive(s) })
    setBusyId(null)
    if (!r.ok) { setBanner({ kind: 'err', text: `Couldn’t update: ${r.error}` }); return }
    setBanner({ kind: 'ok', text: `${s.name} ${isActive(s) ? 'deactivated' : 'reactivated'}.` })
    load()
  }
  const remove = async (s) => {
    if (!window.confirm(`Delete ${s.name}? This only works if no purchase request uses it — otherwise deactivate.`)) return
    setBusyId(s.id); setBanner(null)
    const r = await deleteSupplier(s.id)
    setBusyId(null)
    if (!r.ok) { setBanner({ kind: r.inUse ? 'warn' : 'err', text: `Couldn’t delete ${s.name}: ${r.error}` }); return }
    setBanner({ kind: 'ok', text: `${s.name} deleted.` })
    load()
  }

  return (
    <div className="isup">
      <style>{ISUP_CSS}</style>
      <div className="isup-head">
        <span className="isup-sub">Material suppliers — stone, photo, etching, bronze. (Separate from the partner Vendors tab.)</span>
        <button type="button" className="sb-btn-primary" onClick={() => setEditing('new')}>+ Add supplier</button>
      </div>

      {banner && <div className={`isup-banner isup-banner-${banner.kind}`}>{banner.text}<button type="button" className="isup-banner-x" onClick={() => setBanner(null)}>×</button></div>}

      {loading ? (
        <div className="sb-empty">Loading suppliers…</div>
      ) : loadErr ? (
        <div className="sb-empty">Suppliers aren’t available yet.<br /><span className="isup-muted">Run the procurement migration in Studio, then refresh.</span></div>
      ) : rows.length === 0 ? (
        <div className="sb-empty">No suppliers yet.<br /><span className="isup-muted">Click <strong>+ Add supplier</strong> to add your first one (e.g. Peerless for stone).</span></div>
      ) : (
        <>
          {inactiveCount > 0 && (
            <label className="isup-showinactive">
              <input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} /> Show inactive ({inactiveCount})
            </label>
          )}
          <div className="isup-table-wrap">
            <table className="isup-table">
              <thead><tr><th>Supplier</th><th>Supplies</th><th>Contact</th><th>Phone</th><th>Email</th><th className="isup-num">Lead</th><th>Terms</th><th /></tr></thead>
              <tbody>
                {visible.map(s => (
                  <tr key={s.id} className={isActive(s) ? '' : 'isup-row-off'}>
                    <td className="isup-name">{s.name}{!isActive(s) && <span className="isup-inactive-pill">inactive</span>}</td>
                    <td><div className="isup-kinds">{(s.kinds || []).map(k => <span key={k} className="isup-kind" style={{ background: (KIND_COLOR[k] || '#888') + '22', color: KIND_COLOR[k] || '#555' }}>{k}</span>)}{(!s.kinds || s.kinds.length === 0) && <span className="isup-muted">—</span>}</div></td>
                    <td>{s.contact_name || '—'}</td>
                    <td>{s.phone || '—'}</td>
                    <td className="isup-email">{s.email || '—'}</td>
                    <td className="isup-num">{s.lead_time_days != null ? `${s.lead_time_days}d` : '—'}</td>
                    <td>{s.terms || '—'}</td>
                    <td className="isup-actions">
                      <button type="button" className="isup-link" disabled={busyId === s.id} onClick={() => setEditing(s)}>Edit</button>
                      <button type="button" className="isup-link" disabled={busyId === s.id} onClick={() => toggleActive(s)}>{isActive(s) ? 'Deactivate' : 'Reactivate'}</button>
                      <button type="button" className="isup-link isup-link-del" disabled={busyId === s.id} onClick={() => remove(s)}>Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {editing && (
        <SupplierForm
          supplier={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(name, isNew) => { setEditing(null); setBanner({ kind: 'ok', text: `${name} ${isNew ? 'added' : 'updated'}.` }); load() }}
        />
      )}
    </div>
  )
}

function SupplierForm({ supplier, onClose, onSaved }) {
  const isNew = !supplier
  const [f, setF] = useState(() => supplier ? {
    name: supplier.name || '', contact_name: supplier.contact_name || '', phone: supplier.phone || '',
    email: supplier.email || '', terms: supplier.terms || '',
    lead_time_days: supplier.lead_time_days != null ? String(supplier.lead_time_days) : '',
    kinds: Array.isArray(supplier.kinds) ? supplier.kinds : [], notes: supplier.notes || '',
    active: supplier.active !== false,
  } : { ...BLANK })
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState(null)
  const set = (patch) => setF(s => ({ ...s, ...patch }))
  const toggleKind = (k) => setF(s => ({ ...s, kinds: s.kinds.includes(k) ? s.kinds.filter(x => x !== k) : [...s.kinds, k] }))

  const save = async () => {
    if (saving) return
    if (!f.name.trim()) { setErr('Supplier name is required.'); return }
    setSaving(true); setErr(null)
    const r = isNew ? await createSupplier(f) : await updateSupplier(supplier.id, f)
    setSaving(false)
    if (!r.ok) { setErr(r.error); return }
    onSaved?.(f.name.trim(), isNew)
  }

  return (
    <div className="isf-overlay" onClick={onClose}>
      <style>{ISF_CSS}</style>
      <div className="isf-modal" onClick={e => e.stopPropagation()}>
        <div className="isf-head">
          <h2 className="isf-title">{isNew ? 'Add supplier' : `Edit ${supplier.name}`}</h2>
          <button type="button" className="isf-x" onClick={onClose}>×</button>
        </div>
        <div className="isf-body">
          <div className="isf-grid">
            <Field label="Name *"><input className="sb-input" value={f.name} onChange={e => set({ name: e.target.value })} placeholder="Peerless" /></Field>
            <Field label="Contact"><input className="sb-input" value={f.contact_name} onChange={e => set({ contact_name: e.target.value })} /></Field>
            <Field label="Phone"><input className="sb-input" value={f.phone} onChange={e => set({ phone: e.target.value })} /></Field>
            <Field label="Email"><input className="sb-input" value={f.email} onChange={e => set({ email: e.target.value })} /></Field>
            <Field label="Terms"><input className="sb-input" value={f.terms} onChange={e => set({ terms: e.target.value })} placeholder="Net 30" /></Field>
            <Field label="Lead time (days)"><input className="sb-input" type="number" min="0" value={f.lead_time_days} onChange={e => set({ lead_time_days: e.target.value })} /></Field>
          </div>
          <div className="isf-kinds">
            <span className="isf-kinds-l">Supplies:</span>
            {SUPPLIER_KINDS.map(k => (
              <label key={k} className="isf-kind"><input type="checkbox" checked={f.kinds.includes(k)} onChange={() => toggleKind(k)} /> {k}</label>
            ))}
          </div>
          <Field label="Notes"><textarea className="sb-input" rows={2} value={f.notes} onChange={e => set({ notes: e.target.value })} /></Field>
          {!isNew && (
            <label className="isf-active"><input type="checkbox" checked={f.active} onChange={e => set({ active: e.target.checked })} /> Active</label>
          )}
          {err && <div className="isf-err">{err}</div>}
        </div>
        <div className="isf-foot">
          <button type="button" className="sb-btn-secondary" onClick={onClose}>Cancel</button>
          <button type="button" className="sb-btn-primary" disabled={saving} onClick={save}>{saving ? 'Saving…' : (isNew ? 'Add supplier' : 'Save changes')}</button>
        </div>
      </div>
    </div>
  )
}

function Field({ label, children }) {
  return <label className="isf-field"><span>{label}</span>{children}</label>
}

const ISUP_CSS = `
  .isup-head { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 16px; flex-wrap: wrap; }
  .isup-sub { font-size: 13.5px; color: var(--sb-text-muted, #6b6256); }
  .isup-muted { color: var(--sb-text-muted, #8a7f6c); font-size: 13px; }
  .isup-showinactive { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; color: var(--sb-text-muted, #6b6256); margin-bottom: 12px; cursor: pointer; }
  .isup-table-wrap { overflow-x: auto; border: 1px solid var(--sb-border, #e4e0d4); border-radius: 12px; background: var(--sb-surface, #fff); }
  .isup-table { width: 100%; border-collapse: collapse; font-size: 13.5px; }
  .isup-table th { text-align: left; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--sb-text-muted, #8a7f6c); padding: 11px 14px; border-bottom: 1px solid var(--sb-border, #e4e0d4); }
  .isup-table td { padding: 10px 14px; border-bottom: 1px solid var(--sb-border-soft, #f0ece2); vertical-align: middle; }
  .isup-table tr:last-child td { border-bottom: 0; }
  .isup-row-off { opacity: 0.55; }
  .isup-name { font-weight: 700; }
  .isup-inactive-pill { margin-left: 8px; font-size: 10px; font-weight: 700; text-transform: uppercase; background: #ece9e3; color: #8a7f6c; border-radius: 999px; padding: 1px 7px; }
  .isup-kinds { display: flex; gap: 5px; flex-wrap: wrap; }
  .isup-kind { font-size: 10.5px; font-weight: 700; text-transform: capitalize; border-radius: 5px; padding: 1px 7px; }
  .isup-email { font-size: 12.5px; }
  .isup-num { text-align: center; }
  .isup-actions { display: flex; gap: 12px; flex-wrap: wrap; }
  .isup-link { background: none; border: none; font: inherit; font-size: 13px; font-weight: 600; color: #9A7209; cursor: pointer; padding: 0; }
  .isup-link:hover { text-decoration: underline; }
  .isup-link:disabled { opacity: 0.45; cursor: default; text-decoration: none; }
  .isup-link-del { color: #b3261e; }
  .isup-banner { display: flex; align-items: center; gap: 10px; padding: 10px 14px; border-radius: 9px; font-size: 13.5px; font-weight: 600; margin-bottom: 16px; }
  .isup-banner-ok { background: #e7f3ea; color: #1f7a3d; }
  .isup-banner-err { background: #fdeced; color: #b3261e; }
  .isup-banner-warn { background: #fbeede; color: #9A7209; }
  .isup-banner-x { margin-left: auto; background: none; border: none; font-size: 18px; line-height: 1; color: inherit; opacity: 0.6; cursor: pointer; }
`

const ISF_CSS = `
  .isf-overlay { position: fixed; inset: 0; z-index: 1270; background: rgba(20,18,14,0.45); display: flex; align-items: center; justify-content: center; padding: 24px; }
  .isf-modal { background: var(--sb-surface, #fff); width: min(640px, 96vw); max-height: 92vh; border-radius: 16px; display: flex; flex-direction: column; overflow: hidden; box-shadow: 0 24px 60px rgba(0,0,0,0.3); }
  .isf-head { display: flex; align-items: center; justify-content: space-between; padding: 18px 22px; border-bottom: 1px solid var(--sb-border, #e4e0d4); }
  .isf-title { margin: 0; font-size: 19px; font-weight: 700; color: var(--sb-text, #2a2a2a); }
  .isf-x { background: none; border: none; font-size: 26px; line-height: 1; color: #9a9389; cursor: pointer; }
  .isf-body { padding: 18px 22px; overflow-y: auto; }
  .isf-foot { display: flex; justify-content: flex-end; gap: 10px; padding: 14px 22px; border-top: 1px solid var(--sb-border, #e4e0d4); background: var(--sb-surface-muted, #faf8f3); }
  .isf-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px 14px; margin-bottom: 14px; }
  .isf-field { display: flex; flex-direction: column; gap: 5px; }
  .isf-field > span { font-size: 11.5px; font-weight: 600; color: var(--sb-text-muted, #8a7f6c); }
  .isf-kinds { display: flex; gap: 14px; align-items: center; flex-wrap: wrap; margin-bottom: 14px; font-size: 13px; }
  .isf-kinds-l { font-weight: 600; color: var(--sb-text-muted, #8a7f6c); }
  .isf-kind { display: inline-flex; gap: 4px; align-items: center; text-transform: capitalize; }
  .isf-active { display: inline-flex; gap: 6px; align-items: center; font-size: 13.5px; font-weight: 600; color: #6b5d3a; margin-top: 12px; }
  .isf-err { color: #b3261e; font-size: 13px; margin-top: 10px; }
`
