// =============================================================================
// Stonebooks — Inventory tab (Phase 1: stock foundation)
// =============================================================================
// YARD-FIRST. Lists physical yard stock from inventory_stock and a fast Add form.
// All text is preserved verbatim (exact size strings + locations are never parsed).
// Standalone — reads/writes only inventory_stock; touches nothing in orders/jobs.
// The premium dark "war-room" styling comes in a later Dashboard phase; Phase 1
// stays in the current app's design language so it's not jarring mid-build.
// =============================================================================

import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  getInventoryStock, addInventoryItem, releaseInventoryItem, INVENTORY_ITEM_TYPES, INVENTORY_STATUSES,
} from './lib/stonebooksData'
import InventoryImportModal from './components/InventoryImportModal'
import InventorySmartMatches from './components/InventorySmartMatches'
import InventoryDashboard from './components/InventoryDashboard'
import InventoryProcurement from './components/InventoryProcurement'
import InventoryReceiving from './components/InventoryReceiving'
import InventoryPhotoEtching from './components/InventoryPhotoEtching'
import InventoryNeedsOrdering from './components/InventoryNeedsOrdering'
import InventorySuppliers from './components/InventorySuppliers'

const BLANK = {
  item_type: '', color: '', size: '', top: '', sides: '', back: '',
  location: '', quantity: 1, status: 'available', assigned_to: '', notes: '',
}

const titleCase = (s) => String(s || '').replace(/\b\w/g, c => c.toUpperCase())

export default function InventoryTab({ onOpenOrder }) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadErr, setLoadErr] = useState(null)

  const [q, setQ] = useState('')
  const [fType, setFType] = useState('')
  const [fStatus, setFStatus] = useState('')

  const [form, setForm] = useState(BLANK)
  const [saving, setSaving] = useState(false)
  const [saveErr, setSaveErr] = useState(null)
  const [showImport, setShowImport] = useState(false)
  const [view, setView] = useState('dashboard')   // 'dashboard' | 'yard' | 'matches' | 'procurement'
  const [autoNewPR, setAutoNewPR] = useState(false)
  const setF = (patch) => setForm(f => ({ ...f, ...patch }))

  // Await first (no synchronous setState in the mount effect); `loading` starts true.
  // Reloads after Add just swap the list in — no loading flash.
  const load = useCallback(async () => {
    const r = await getInventoryStock()
    setLoadErr(r.ok ? null : r.error)
    setRows(r.rows || [])
    setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  // Require at least a type to add (otherwise the row is meaningless); everything
  // else is optional so adding stays fast.
  const canAdd = !!form.item_type && !saving

  const submit = async () => {
    if (!canAdd) return
    setSaving(true); setSaveErr(null)
    const r = await addInventoryItem(form)
    setSaving(false)
    if (!r.ok) { setSaveErr(r.error); return }
    // Keep type + location for rapid batch entry; clear the rest.
    setForm({ ...BLANK, item_type: form.item_type, location: form.location })
    load()
  }
  const onAddKey = (e) => { if (e.key === 'Enter') { e.preventDefault(); submit() } }

  const release = async (row) => {
    if (!window.confirm(`Release this ${row.item_type || 'stone'}${row.location ? ` at ${row.location}` : ''} back to available?`)) return
    const res = await releaseInventoryItem(row)
    if (res.ok) load()
    else window.alert(`Couldn’t release: ${res.error}`)
  }

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return rows.filter(r => {
      if (fType && r.item_type !== fType) return false
      if (fStatus && (r.status || 'available') !== fStatus) return false
      if (needle) {
        const hay = [r.item_type, r.color, r.size, r.top, r.sides, r.back, r.location, r.assigned_to, r.notes]
          .filter(Boolean).join(' ').toLowerCase()
        if (!hay.includes(needle)) return false
      }
      return true
    })
  }, [rows, q, fType, fStatus])

  const totalQty = useMemo(() => filtered.reduce((s, r) => s + (Number(r.quantity) || 0), 0), [filtered])

  return (
    <div className="sb-page sb-page-wide">
      <style>{INV_CSS}</style>

      <div className="sb-page-head inv-head">
        <div>
          <div className="sb-page-eyebrow">Inventory</div>
          <h1 className="sb-page-title">{view === 'matches' ? 'Smart Matches' : view === 'needs' ? 'Needs Ordering' : view === 'yard' ? 'Yard' : view === 'procurement' ? 'Procurement' : view === 'receiving' ? 'Receiving' : view === 'photos' ? 'Photos & Etching' : view === 'suppliers' ? 'Suppliers' : 'Dashboard'}</h1>
        </div>
        <div className="inv-head-actions">
          <div className="inv-seg">
            <button type="button" className={`inv-seg-btn${view === 'dashboard' ? ' on' : ''}`} onClick={() => setView('dashboard')}>Dashboard</button>
            <button type="button" className={`inv-seg-btn${view === 'yard' ? ' on' : ''}`} onClick={() => setView('yard')}>Yard</button>
            <button type="button" className={`inv-seg-btn${view === 'matches' ? ' on' : ''}`} onClick={() => setView('matches')}>Smart Matches</button>
            <button type="button" className={`inv-seg-btn${view === 'needs' ? ' on' : ''}`} onClick={() => setView('needs')}>Needs Ordering</button>
            <button type="button" className={`inv-seg-btn${view === 'procurement' ? ' on' : ''}`} onClick={() => setView('procurement')}>Procurement</button>
            <button type="button" className={`inv-seg-btn${view === 'receiving' ? ' on' : ''}`} onClick={() => setView('receiving')}>Receiving</button>
            <button type="button" className={`inv-seg-btn${view === 'suppliers' ? ' on' : ''}`} onClick={() => setView('suppliers')}>Suppliers</button>
            <button type="button" className={`inv-seg-btn${view === 'photos' ? ' on' : ''}`} onClick={() => setView('photos')}>Photos &amp; Etching</button>
          </div>
          {view === 'yard' && (
            <button type="button" className="sb-btn-secondary inv-import-btn" onClick={() => setShowImport(true)}>
              Import from Excel
            </button>
          )}
        </div>
      </div>

      {showImport && (
        <InventoryImportModal
          onClose={() => setShowImport(false)}
          onImported={load}
        />
      )}

      {view === 'dashboard' && (
        <InventoryDashboard
          onImport={() => setShowImport(true)}
          onAddStone={() => setView('yard')}
          onOpenMatches={() => setView('matches')}
          onBuildPR={() => { setAutoNewPR(true); setView('procurement') }}
        />
      )}

      {view === 'procurement' && (
        <InventoryProcurement autoNew={autoNewPR} onConsumeAutoNew={() => setAutoNewPR(false)} />
      )}

      {view === 'receiving' && <InventoryReceiving />}

      {view === 'photos' && <InventoryPhotoEtching />}

      {view === 'matches' && <InventorySmartMatches />}

      {view === 'needs' && <InventoryNeedsOrdering onOpenMatches={() => setView('matches')} onOpenOrder={onOpenOrder} />}

      {view === 'suppliers' && <InventorySuppliers />}

      {view === 'yard' && (<>
      {/* FAST ADD — always visible, minimal friction */}
      <div className="sb-card inv-add">
        <div className="inv-add-grid">
          <label className="inv-f">
            <span>Type</span>
            <select className="sb-input" value={form.item_type} onChange={e => setF({ item_type: e.target.value })}>
              <option value="">—</option>
              {INVENTORY_ITEM_TYPES.map(t => <option key={t} value={t}>{titleCase(t)}</option>)}
            </select>
          </label>
          <label className="inv-f">
            <span>Color</span>
            <input className="sb-input" value={form.color} onChange={e => setF({ color: e.target.value })}
              onKeyDown={onAddKey} placeholder="Md Barre Gray" />
          </label>
          <label className="inv-f">
            <span>Size</span>
            <input className="sb-input" value={form.size} onChange={e => setF({ size: e.target.value })}
              onKeyDown={onAddKey} placeholder="2-6x1-0x0-6" />
          </label>
          <label className="inv-f">
            <span>Top</span>
            <input className="sb-input" value={form.top} onChange={e => setF({ top: e.target.value })}
              onKeyDown={onAddKey} placeholder="Polished" />
          </label>
          <label className="inv-f">
            <span>Sides</span>
            <input className="sb-input" value={form.sides} onChange={e => setF({ sides: e.target.value })}
              onKeyDown={onAddKey} placeholder="BRP" />
          </label>
          <label className="inv-f inv-f-loc">
            <span>Location</span>
            <input className="sb-input" value={form.location} onChange={e => setF({ location: e.target.value })}
              onKeyDown={onAddKey} placeholder="1.2 A" />
          </label>
          <label className="inv-f inv-f-qty">
            <span>Qty</span>
            <input className="sb-input" type="number" min="1" value={form.quantity}
              onChange={e => setF({ quantity: e.target.value })} onKeyDown={onAddKey} />
          </label>
          <label className="inv-f">
            <span>Status</span>
            <select className="sb-input" value={form.status} onChange={e => setF({ status: e.target.value })}>
              {INVENTORY_STATUSES.map(s => <option key={s.code} value={s.code}>{s.label}</option>)}
            </select>
          </label>
          {form.status === 'allocated' && (
            <label className="inv-f">
              <span>Assigned to</span>
              <input className="sb-input" value={form.assigned_to} onChange={e => setF({ assigned_to: e.target.value })}
                onKeyDown={onAddKey} placeholder="Family name" />
            </label>
          )}
          <div className="inv-add-actions">
            <button type="button" className="sb-btn-primary" onClick={submit} disabled={!canAdd}>
              {saving ? 'Adding…' : 'Add to yard'}
            </button>
          </div>
        </div>
        {saveErr && <div className="inv-err">Couldn’t add: {saveErr}</div>}
      </div>

      {/* SEARCH + FILTERS */}
      <div className="inv-toolbar">
        <input className="sb-input inv-search" value={q} onChange={e => setQ(e.target.value)}
          placeholder="Search color, size, location, family…" />
        <select className="sb-input inv-filter" value={fType} onChange={e => setFType(e.target.value)}>
          <option value="">All types</option>
          {INVENTORY_ITEM_TYPES.map(t => <option key={t} value={t}>{titleCase(t)}</option>)}
        </select>
        <select className="sb-input inv-filter" value={fStatus} onChange={e => setFStatus(e.target.value)}>
          <option value="">All status</option>
          {INVENTORY_STATUSES.map(s => <option key={s.code} value={s.code}>{s.label}</option>)}
        </select>
        <span className="inv-count">{filtered.length} row{filtered.length === 1 ? '' : 's'} · {totalQty} stone{totalQty === 1 ? '' : 's'}</span>
      </div>

      {/* TABLE */}
      {loading ? (
        <div className="sb-empty">Loading yard…</div>
      ) : loadErr ? (
        <div className="sb-empty">
          Inventory isn’t available yet.<br />
          <span className="inv-muted">Run the Phase 1 migration (inventory_stock) in Studio, then refresh.</span>
        </div>
      ) : filtered.length === 0 ? (
        <div className="sb-empty">
          {rows.length === 0 ? 'No stock in the yard yet — add your first stone above.' : 'No stock matches your search.'}
        </div>
      ) : (
        <div className="inv-table-wrap">
          <table className="inv-table">
            <thead>
              <tr>
                <th>Location</th><th>Type</th><th>Color</th><th>Size</th>
                <th>Top</th><th>Sides</th><th className="inv-num">Qty</th><th>Status</th><th>Assigned to</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(r => (
                <tr key={r.id}>
                  <td className="inv-loc">{r.location || '—'}</td>
                  <td>{r.item_type ? titleCase(r.item_type) : '—'}</td>
                  <td>{r.color || '—'}</td>
                  <td className="inv-mono">{r.size || '—'}</td>
                  <td>{r.top || '—'}</td>
                  <td>{r.sides || '—'}</td>
                  <td className="inv-num">{r.quantity ?? 1}</td>
                  <td>
                    <span className={`inv-pill inv-pill-${(r.status || 'available')}`}>
                      {(r.status || 'available') === 'allocated' ? 'Allocated' : 'Available'}
                    </span>
                  </td>
                  <td>
                    {r.status === 'allocated' ? (
                      <span className="inv-assigned">
                        <span>{r.assigned_to || '—'}</span>
                        <button type="button" className="inv-release" onClick={() => release(r)}>Release</button>
                      </span>
                    ) : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      </>)}
    </div>
  )
}

const INV_CSS = `
  .inv-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; }
  .inv-head-actions { display: flex; align-items: center; gap: 12px; flex: 0 0 auto; }
  .inv-import-btn { white-space: nowrap; flex: 0 0 auto; }
  .inv-seg { display: inline-flex; flex-wrap: wrap; gap: 3px; background: #ece9e3; border-radius: 9px; padding: 3px; }
  .inv-seg-btn { font: inherit; font-size: 13px; font-weight: 500; padding: 6px 14px; border: none; border-radius: 6px; background: none; color: #6b6256; cursor: pointer; white-space: nowrap; }
  .inv-seg-btn.on { background: #fff; color: #9A7209; font-weight: 700; box-shadow: 0 1px 2px rgba(0,0,0,0.08); }
  .inv-add { padding: 16px 18px; margin-bottom: 18px; }
  .inv-add-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 10px 14px; align-items: end; }
  .inv-f { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
  .inv-f > span { font-size: 11.5px; font-weight: 600; color: var(--sb-text-muted, #8a7f6c); }
  .inv-f-qty { max-width: 90px; }
  .inv-add-actions { display: flex; align-items: flex-end; }
  .inv-add-actions .sb-btn-primary { white-space: nowrap; }
  .inv-err { margin-top: 10px; color: #b3261e; font-size: 13px; }

  .inv-toolbar { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; flex-wrap: wrap; }
  .inv-search { flex: 1 1 280px; min-width: 220px; }
  .inv-filter { flex: 0 0 auto; min-width: 130px; }
  .inv-count { margin-left: auto; font-size: 12.5px; color: var(--sb-text-muted, #8a7f6c); white-space: nowrap; }

  .inv-table-wrap { overflow-x: auto; border: 1px solid var(--sb-border, #e4e0d4); border-radius: 12px; background: var(--sb-surface, #fff); }
  .inv-table { width: 100%; border-collapse: collapse; font-size: 13.5px; }
  .inv-table thead th { text-align: left; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em;
    color: var(--sb-text-muted, #8a7f6c); padding: 11px 14px; border-bottom: 1px solid var(--sb-border, #e4e0d4); white-space: nowrap; }
  .inv-table tbody td { padding: 10px 14px; border-bottom: 1px solid var(--sb-border-soft, #f0ece2); color: var(--sb-text, #2a2a2a); }
  .inv-table tbody tr:last-child td { border-bottom: 0; }
  .inv-table tbody tr:hover td { background: var(--sb-surface-muted, #faf8f3); }
  .inv-loc { font-weight: 700; white-space: nowrap; }
  .inv-mono { font-family: var(--font-m, 'JetBrains Mono'), monospace; font-size: 12.5px; }
  .inv-num { text-align: right; font-variant-numeric: tabular-nums; }

  .inv-assigned { display: inline-flex; align-items: center; gap: 8px; }
  .inv-release { font: inherit; font-size: 11.5px; font-weight: 600; padding: 2px 9px; border-radius: 6px; border: 1px solid var(--sb-border, #d8d2c4); background: var(--sb-surface, #fff); color: #8a5a00; cursor: pointer; }
  .inv-release:hover { background: #fbf1df; border-color: #d9b873; }
  .inv-pill { display: inline-block; padding: 2px 9px; border-radius: 999px; font-size: 11.5px; font-weight: 600; }
  .inv-pill-available { background: #e7f3ea; color: #1f7a3d; }
  .inv-pill-allocated { background: #fbeede; color: #9A7209; }
  .inv-muted { color: var(--sb-text-muted, #8a7f6c); font-size: 13px; }
`
