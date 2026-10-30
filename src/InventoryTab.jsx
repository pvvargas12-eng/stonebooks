// =============================================================================
// Stonebooks — Inventory tab (Phase 1: stock foundation)
// =============================================================================
// YARD-FIRST. Lists physical yard stock from inventory_stock and a fast Add form.
// All text is preserved verbatim (exact size strings + locations are never parsed).
// Standalone — reads/writes only inventory_stock; touches nothing in orders/jobs.
//
// RESET-TAG-1 (2026-10-19): the painted running number (yard_tag) leads the
// table and sorts it; zone + crate columns; a zone filter; the Find box
// searches number / family / type / color / size / zone / crate; the owner's
// "Reset the yard list" button (typed RESET) SOFT-archives every current row
// (nothing deleted) and the "Old list (pre-reset)" view keeps them readable so
// the 75 allocated family names stay visible as hints during the walk.
// =============================================================================

import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  getInventoryStock, getArchivedInventoryStock, archiveYardForReset, addInventoryItem, updateInventoryItem, releaseInventoryItem,
  INVENTORY_ITEM_TYPES, INVENTORY_STATUSES, INVENTORY_STATUS_LABEL, fmtYardTag, getActiveStaffUser, fmtDate, todayISO,
} from './lib/stonebooksData'
import InventoryImportModal from './components/InventoryImportModal'
import InventorySmartMatches from './components/InventorySmartMatches'
import InventoryDashboard from './components/InventoryDashboard'
import InventoryProcurement from './components/InventoryProcurement'
import InventoryReceiving from './components/InventoryReceiving'
import InventoryPhotoEtching from './components/InventoryPhotoEtching'
import InventoryNeedsOrdering from './components/InventoryNeedsOrdering'
import StonePositionList from './components/StonePositionList'
import InventorySuppliers from './components/InventorySuppliers'
import { yardStoneSpecLine, conditionLabel, yardCategoryLabel, sizeBoxesActive, sizeBoxesMatch } from './lib/yardStone'

const BLANK = {
  item_type: '', color: '', size: '', top: '', sides: '', back: '',
  location: '', zone: '', crate: '', quantity: 1, status: 'available', assigned_to: '', notes: '',
}

const titleCase = (s) => String(s || '').replace(/\b\w/g, c => c.toUpperCase())
const statusLabel = (s) => INVENTORY_STATUS_LABEL[s || 'available'] || titleCase(s)
const cmpText = (a, b) => String(a || '').localeCompare(String(b || ''), undefined, { numeric: true, sensitivity: 'base' })

export default function InventoryTab({ onOpenOrder, canReset = false }) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadErr, setLoadErr] = useState(null)

  const [q, setQ] = useState('')
  // Find by (Paul 2026-10-30): anything / number / family / SIZE — size is
  // three boxes L W H, any subset filled ("even if I just type L 1-10 I want
  // to see all that pop up").
  const [findBy, setFindBy] = useState('any')   // any | tag | family | size
  const [sizeQ, setSizeQ] = useState(['', '', ''])
  const [fType, setFType] = useState('')
  const [fStatus, setFStatus] = useState('')
  const [fCond, setFCond] = useState('')     // '' all · 'good' · 'look' (anything but good)
  const [fZone, setFZone] = useState('')
  const [sort, setSort] = useState({ key: 'tag', dir: 'asc' })

  const [form, setForm] = useState(BLANK)
  const [saving, setSaving] = useState(false)
  const [saveErr, setSaveErr] = useState(null)
  const [showImport, setShowImport] = useState(false)
  const [view, setView] = useState('dashboard')   // 'dashboard' | 'yard' | 'matches' | 'procurement'
  const [autoNewPR, setAutoNewPR] = useState(false)
  const setF = (patch) => setForm(f => ({ ...f, ...patch }))

  // The reset + the old list.
  const [resetOpen, setResetOpen] = useState(false)
  const [oldOpen, setOldOpen] = useState(false)
  const [oldRows, setOldRows] = useState(null)
  const [oldErr, setOldErr] = useState(null)

  // Inline row editing (fix locations + any field, fast, no modal).
  const [editingId, setEditingId] = useState(null)
  const [editDraft, setEditDraft] = useState(null)
  const [editBusy, setEditBusy] = useState(false)
  const [editErr, setEditErr] = useState(null)
  const setE = (patch) => setEditDraft(d => ({ ...d, ...patch }))
  const startEdit = (r) => {
    setEditErr(null)
    setEditDraft({
      yard_tag: r.yard_tag ?? '', zone: r.zone || '', crate: r.crate || '', spot: r.spot || '', specs: r.specs || '',
      condition: r.condition || 'good', condition_note: r.condition_note || '',
      item_type: r.item_type || '', color: r.color || '', size: r.size || '', top: r.top || '',
      sides: r.sides || '', back: r.back || '', location: r.location || '',
      quantity: r.quantity ?? 1, status: r.status || 'available', assigned_to: r.assigned_to || '', notes: r.notes || '',
    })
    setEditingId(r.id)
  }
  const cancelEdit = () => { setEditingId(null); setEditDraft(null); setEditErr(null) }
  const saveEdit = async () => {
    if (editBusy || !editingId) return
    setEditBusy(true); setEditErr(null)
    const r = await updateInventoryItem(editingId, editDraft)
    setEditBusy(false)
    if (!r.ok) { setEditErr(r.error); return }
    cancelEdit()
    load()
  }
  const onEditKey = (e) => { if (e.key === 'Enter') { e.preventDefault(); saveEdit() } else if (e.key === 'Escape') cancelEdit() }

  // Await first (no synchronous setState in the mount effect); `loading` starts true.
  // Reloads after Add just swap the list in — no loading flash.
  const load = useCallback(async () => {
    const r = await getInventoryStock()
    setLoadErr(r.ok ? null : r.error)
    setRows(r.rows || [])
    setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  const loadOld = useCallback(async () => {
    const r = await getArchivedInventoryStock()
    setOldErr(r.ok ? null : r.error)
    setOldRows(r.rows || [])
  }, [])
  const toggleOld = () => {
    const next = !oldOpen
    setOldOpen(next)
    if (next && oldRows === null) loadOld()
  }

  // Require at least a type to add (otherwise the row is meaningless); everything
  // else is optional so adding stays fast.
  const canAdd = !!form.item_type && !saving

  const submit = async () => {
    if (!canAdd) return
    setSaving(true); setSaveErr(null)
    const r = await addInventoryItem(form)
    setSaving(false)
    if (!r.ok) { setSaveErr(r.error); return }
    // Keep type + location + zone for rapid batch entry; clear the rest.
    setForm({ ...BLANK, item_type: form.item_type, location: form.location, zone: form.zone })
    load()
  }
  const onAddKey = (e) => { if (e.key === 'Enter') { e.preventDefault(); submit() } }

  const release = async (row) => {
    if (!window.confirm(`Release this ${row.item_type || 'stone'}${row.location ? ` at ${row.location}` : ''} back to available?`)) return
    const res = await releaseInventoryItem(row)
    if (res.ok) load()
    else window.alert(`Couldn’t release: ${res.error}`)
  }

  const zones = useMemo(() => {
    const s = new Set()
    for (const r of rows) if (r.zone && String(r.zone).trim()) s.add(String(r.zone).trim())
    return [...s].sort(cmpText)
  }, [rows])

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    // A short all-digit search is a painted number: "41" finds 041 only.
    const needleNum = /^\d{1,4}$/.test(needle) ? Number(needle) : null
    const tagOnly = needleNum != null && needle.length < 4
    const l = rows.filter(r => {
      if (fType && r.item_type !== fType) return false
      if (fStatus && (r.status || 'available') !== fStatus) return false
      if (fZone && String(r.zone || '').trim() !== fZone) return false
      if (fCond === 'good' && (r.condition || 'good') !== 'good') return false
      if (fCond === 'look' && (r.condition || 'good') === 'good') return false
      if (findBy === 'size') {
        if (sizeBoxesActive(sizeQ) && !sizeBoxesMatch(r.size, sizeQ)) return false
      } else if (findBy === 'tag' && needle) {
        if (!(needleNum != null && Number(r.yard_tag) === needleNum) && !String(fmtYardTag(r.yard_tag) || '').includes(needle)) return false
      } else if (findBy === 'family' && needle) {
        if (!String(r.assigned_to || '').toLowerCase().includes(needle)) return false
      } else if (needle) {
        if (needleNum != null && Number(r.yard_tag) === needleNum) return true
        if (tagOnly) return false
        const hay = [fmtYardTag(r.yard_tag), r.item_type, yardCategoryLabel(r), r.color, r.size, r.specs, yardStoneSpecLine(r), r.top, r.sides, r.back, r.zone, r.crate, r.spot, r.location, r.assigned_to, r.notes, r.condition_note]
          .filter(Boolean).join(' ').toLowerCase()
        if (!hay.includes(needle)) return false
      }
      return true
    })
    const dir = sort.dir === 'desc' ? -1 : 1
    const by = {
      tag: (a, b) => {
        const ta = a.yard_tag == null ? Infinity : Number(a.yard_tag)
        const tb = b.yard_tag == null ? Infinity : Number(b.yard_tag)
        if (ta === Infinity && tb === Infinity) return cmpText(a.location, b.location)
        if (ta === Infinity) return 1
        if (tb === Infinity) return -1
        return (ta - tb) * dir
      },
      zone: (a, b) => cmpText(a.zone, b.zone) * dir || cmpText(a.crate, b.crate),
      type: (a, b) => cmpText(a.item_type, b.item_type) * dir,
      color: (a, b) => cmpText(a.color, b.color) * dir,
      size: (a, b) => cmpText(a.size, b.size) * dir,
      location: (a, b) => cmpText(a.location, b.location) * dir,
      status: (a, b) => cmpText(a.status, b.status) * dir,
    }
    return [...l].sort(by[sort.key] || by.tag)
  }, [rows, q, findBy, sizeQ, fType, fStatus, fZone, fCond, sort])

  const totalQty = useMemo(() => filtered.reduce((s, r) => s + (Number(r.quantity) || 0), 0), [filtered])
  const toggleSort = (key) => setSort(s => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }))
  // Plain render function, not a nested component (react-hooks/static-components).
  const renderTh = (k, label, className) => (
    <th className={`${className || ''}${k ? ' inv-th-sort' : ''}${sort.key === k ? ' on' : ''}`.trim()}
      onClick={k ? () => toggleSort(k) : undefined} title={k ? 'Sort' : undefined}>
      {label}{sort.key === k ? (sort.dir === 'asc' ? ' ▴' : ' ▾') : ''}
    </th>
  )

  return (
    <div className="sb-page sb-page-wide">
      <style>{INV_CSS}</style>

      <div className="sb-page-head inv-head">
        <div>
          <div className="sb-page-eyebrow">Inventory</div>
          <h1 className="sb-page-title">{view === 'matches' ? 'Smart Matches' : view === 'needs' ? 'Needs Ordering' : view === 'position' ? 'Stone Position' : view === 'yard' ? 'Yard' : view === 'procurement' ? 'Procurement' : view === 'receiving' ? 'Receiving' : view === 'photos' ? 'Photos & Etching' : view === 'suppliers' ? 'Suppliers' : 'Dashboard'}</h1>
        </div>
        <div className="inv-head-actions">
          <div className="inv-seg">
            <button type="button" className={`inv-seg-btn${view === 'dashboard' ? ' on' : ''}`} onClick={() => setView('dashboard')}>Dashboard</button>
            <button type="button" className={`inv-seg-btn${view === 'yard' ? ' on' : ''}`} onClick={() => setView('yard')}>Yard</button>
            <button type="button" className={`inv-seg-btn${view === 'matches' ? ' on' : ''}`} onClick={() => setView('matches')}>Smart Matches</button>
            <button type="button" className={`inv-seg-btn${view === 'needs' ? ' on' : ''}`} onClick={() => setView('needs')}>Needs Ordering</button>
            <button type="button" className={`inv-seg-btn${view === 'position' ? ' on' : ''}`} onClick={() => setView('position')}>Stone Position</button>
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
          {view === 'yard' && canReset && (
            <button type="button" className="inv-reset-btn" onClick={() => setResetOpen(true)} title="Archive every current row to the Old list (nothing is deleted)">
              Reset the yard list
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

      {resetOpen && (
        <ResetDialog liveCount={rows.length} onClose={() => setResetOpen(false)}
          onDone={() => { setResetOpen(false); setOldRows(null); setOldOpen(false); load() }} />
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
      {view === 'position' && <StonePositionList onOpenOrder={onOpenOrder} />}

      {view === 'suppliers' && <InventorySuppliers />}

      {view === 'yard' && (<>
      {/* FAST ADD — always visible, minimal friction. Numbered stones are tagged
          from the phone on the walk; this desk add is for the office. */}
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
          <label className="inv-f">
            <span>Zone</span>
            <input className="sb-input" list="inv-zones" value={form.zone} onChange={e => setF({ zone: e.target.value })}
              onKeyDown={onAddKey} placeholder="B" />
          </label>
          <label className="inv-f">
            <span>Crate</span>
            <input className="sb-input" value={form.crate} onChange={e => setF({ crate: e.target.value })}
              onKeyDown={onAddKey} placeholder="C-7" />
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
        <datalist id="inv-zones">{zones.map(z => <option key={z} value={z} />)}</datalist>
        {saveErr && <div className="inv-err">Couldn’t add: {saveErr}</div>}
      </div>

      {/* SEARCH + FILTERS */}
      <div className="inv-toolbar">
        <select className="sb-input inv-filter" value={findBy} onChange={e => setFindBy(e.target.value)} title="What to search by">
          <option value="any">Find anything</option>
          <option value="tag">By number</option>
          <option value="family">By family</option>
          <option value="size">By size</option>
        </select>
        {findBy === 'size' ? (
          <div className="inv-sizeq">
            {['L', 'W', 'H'].map((lab, i) => (
              <label key={lab} className="inv-sizeq-box">
                <span>{lab}</span>
                <input className="sb-input" value={sizeQ[i]} placeholder={i === 0 ? '1-10' : i === 1 ? '0-8' : '2-0'} inputMode="text"
                  onChange={e => setSizeQ(prev => prev.map((v, j) => j === i ? e.target.value : v))} />
              </label>
            ))}
            <span className="inv-sizeq-hint">{sizeBoxesActive(sizeQ) ? 'Matching every box you filled, within half an inch.' : 'Type any box — 1-10 or 22. Leave the rest blank.'}</span>
            {sizeBoxesActive(sizeQ) && <button type="button" className="inv-sizeq-clear" onClick={() => setSizeQ(['', '', ''])}>Clear</button>}
          </div>
        ) : (
          <input className="sb-input inv-search" value={q} onChange={e => setQ(e.target.value)}
            placeholder={findBy === 'tag' ? 'Painted number — 41 finds 041' : findBy === 'family' ? 'Family name on the tape' : 'Find a number, family, type, color, size, zone, crate…'} />
        )}
        <select className="sb-input inv-filter" value={fZone} onChange={e => setFZone(e.target.value)}>
          <option value="">All zones</option>
          {zones.map(z => <option key={z} value={z}>Zone {z}</option>)}
        </select>
        <select className="sb-input inv-filter" value={fType} onChange={e => setFType(e.target.value)}>
          <option value="">All types</option>
          {INVENTORY_ITEM_TYPES.map(t => <option key={t} value={t}>{titleCase(t)}</option>)}
        </select>
        <select className="sb-input inv-filter" value={fStatus} onChange={e => setFStatus(e.target.value)}>
          <option value="">All status</option>
          {INVENTORY_STATUSES.map(s => <option key={s.code} value={s.code}>{s.label}</option>)}
          <option value="problem">Problem</option>
          <option value="missing">Missing</option>
        </select>
        <select className="sb-input inv-filter" value={fCond} onChange={e => setFCond(e.target.value)}>
          <option value="">Any condition</option>
          <option value="good">Good</option>
          <option value="look">Needs a look</option>
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
          {rows.length === 0 ? 'The yard list is empty — the next stone tagged on the phone lands here.' : 'No stock matches your search.'}
        </div>
      ) : (
        <div className="inv-table-wrap">
          <table className="inv-table">
            <thead>
              <tr>
                {renderTh('tag', 'Tag', 'inv-tagcol')}{renderTh('zone', 'Zone')}<th>Crate · spot</th>
                {renderTh('type', 'Type')}{renderTh('color', 'Color')}{renderTh('size', 'Size')}<th>Specs</th>
                {renderTh('location', 'Location')}<th className="inv-num">Qty</th>{renderTh('status', 'Status')}<th>Assigned to</th><th />
              </tr>
            </thead>
            <tbody>
              {filtered.map(r => (editingId === r.id ? (
                <EditRows key={r.id} draft={editDraft} setE={setE} onKey={onEditKey}
                  onSave={saveEdit} onCancel={cancelEdit} busy={editBusy} err={editErr} />
              ) : (
                <tr key={r.id}>
                  <td className="inv-tag">{r.yard_tag != null ? fmtYardTag(r.yard_tag) : <span className="inv-muted">—</span>}</td>
                  <td className="inv-loc">{r.zone || '—'}</td>
                  <td className="inv-mono inv-wrap">{[r.crate, r.spot].filter(Boolean).join(' · ') || '—'}</td>
                  <td>{yardCategoryLabel(r) || (r.item_type ? titleCase(r.item_type) : '—')}</td>
                  <td className="inv-wrap">{r.color || '—'}</td>
                  <td className="inv-mono">{r.size || '—'}</td>
                  <td className="inv-wrap inv-specs">{yardStoneSpecLine(r, { withSize: false, withColor: false }) || '—'}</td>
                  <td className="inv-wrap">{r.location || '—'}</td>
                  <td className="inv-num">{r.quantity ?? 1}</td>
                  <td>
                    <span className={`inv-pill inv-pill-${(r.status || 'available')}`}>{statusLabel(r.status)}</span>
                    {r.condition && r.condition !== 'good' && (
                      <span className="inv-pill inv-pill-cond" title={r.condition_note || ''}>{conditionLabel(r.condition)}</span>
                    )}
                  </td>
                  <td className="inv-wrap">
                    {r.status === 'allocated' ? (
                      <span className="inv-assigned">
                        <span>{r.assigned_to || '—'}</span>
                        <button type="button" className="inv-release" onClick={() => release(r)}>Release</button>
                      </span>
                    ) : (r.assigned_to || '')}
                  </td>
                  <td className="inv-actions-cell">
                    <button type="button" className="inv-edit-btn" onClick={() => startEdit(r)}>Edit</button>
                  </td>
                </tr>
              )))}
            </tbody>
          </table>
        </div>
      )}

      {/* OLD LIST — the pre-reset rows, read-only, collapsed. */}
      <div className="inv-old">
        <button type="button" className="inv-old-toggle" onClick={toggleOld}>
          {oldOpen ? '▾' : '▸'} Old list (pre-reset){oldRows ? ` · ${oldRows.length} row${oldRows.length === 1 ? '' : 's'}` : ''}
        </button>
        {oldOpen && (
          <div className="inv-old-body">
            <div className="inv-muted" style={{ marginBottom: 10 }}>
              Archived by the reset — read-only. Family names here are hints for the walk: find the stone, then on the phone search the family and tap Die is here / Base is here.
            </div>
            {oldRows === null ? <div className="sb-empty">Loading the old list…</div>
              : oldErr ? <div className="sb-empty">{oldErr}</div>
              : oldRows.length === 0 ? <div className="sb-empty">Nothing archived yet.</div>
              : (
                <div className="inv-table-wrap">
                  <table className="inv-table inv-table-old">
                    <thead>
                      <tr><th>Family</th><th>Type</th><th>Color</th><th>Size</th><th>Top</th><th>Sides</th><th>Location</th><th className="inv-num">Qty</th><th>Status</th><th>Archived</th></tr>
                    </thead>
                    <tbody>
                      {oldRows.map(r => (
                        <tr key={r.id}>
                          <td className="inv-wrap" style={{ fontWeight: 700 }}>{r.assigned_to || <span className="inv-muted">—</span>}</td>
                          <td>{yardCategoryLabel(r) || (r.item_type ? titleCase(r.item_type) : '—')}</td>
                          <td className="inv-wrap">{r.color || '—'}</td>
                          <td className="inv-mono">{r.size || '—'}</td>
                          <td>{r.top || '—'}</td>
                          <td>{r.sides || '—'}</td>
                          <td className="inv-wrap">{r.location || '—'}</td>
                          <td className="inv-num">{r.quantity ?? 1}</td>
                          <td><span className={`inv-pill inv-pill-${(r.status || 'available')}`}>{statusLabel(r.status)}</span></td>
                          <td className="inv-wrap inv-muted">{r.archived_at ? fmtDate(r.archived_at) : '—'}{r.archived_reason ? ` · ${r.archived_reason}` : ''}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
          </div>
        )}
      </div>
      </>)}
    </div>
  )
}

// THE RESET — typed confirmation. Archives (never deletes) every live row.
function ResetDialog({ liveCount, onClose, onDone }) {
  const [typed, setTyped] = useState('')
  const [reason, setReason] = useState(`Founding walk ${todayISO()}`)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const ok = typed.trim() === 'RESET' && !busy
  const run = async () => {
    if (!ok) return
    setBusy(true); setErr(null)
    const r = await archiveYardForReset(reason, { by: getActiveStaffUser() || null })
    setBusy(false)
    if (!r.ok) { setErr(r.error); return }
    window.alert(`${r.count} row${r.count === 1 ? '' : 's'} moved to the Old list. The yard list starts fresh — tag the first stone on the phone.`)
    onDone()
  }
  return (
    <div className="inv-modal-scrim" onClick={onClose}>
      <div className="inv-modal" onClick={e => e.stopPropagation()}>
        <div className="inv-modal-title">Reset the yard list</div>
        <div className="inv-modal-body">
          Every one of the <b>{liveCount}</b> current row{liveCount === 1 ? '' : 's'} moves to the <b>Old list (pre-reset)</b> — read-only, nothing deleted,
          family names kept as hints. Stone Position, Needs Ordering, Reconcile and the phone stop counting them.
          From then on the yard is only what gets painted and tagged on the walk.
        </div>
        <label className="inv-f" style={{ marginTop: 12 }}>
          <span>Reason (goes on every archived row)</span>
          <input className="sb-input" value={reason} onChange={e => setReason(e.target.value)} />
        </label>
        <label className="inv-f" style={{ marginTop: 12 }}>
          <span>Type RESET to confirm</span>
          <input className="sb-input" value={typed} onChange={e => setTyped(e.target.value)} placeholder="RESET" autoFocus
            onKeyDown={e => { if (e.key === 'Enter') run() }} />
        </label>
        {err && <div className="inv-err">Could not reset: {err}</div>}
        <div className="inv-modal-actions">
          <button type="button" className="inv-cancel-btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className="inv-reset-go" onClick={run} disabled={!ok}>{busy ? 'Archiving…' : 'Archive the list and start fresh'}</button>
        </div>
      </div>
    </div>
  )
}

// Inline edit: the main row of inputs (aligned to the columns) + a sub-row for the
// fields with no column (Back, Notes) and the save error. Location is verbatim.
function EditRows({ draft, setE, onKey, onSave, onCancel, busy, err }) {
  return (
    <>
      <tr className="inv-edit-row">
        <td><input className="sb-input inv-ei inv-ei-qty" type="number" min="1" value={draft.yard_tag} onChange={e => setE({ yard_tag: e.target.value })} onKeyDown={onKey} placeholder="Tag" /></td>
        <td><input className="sb-input inv-ei" value={draft.zone} onChange={e => setE({ zone: e.target.value })} onKeyDown={onKey} autoFocus placeholder="Zone" /></td>
        <td><input className="sb-input inv-ei" value={draft.crate} onChange={e => setE({ crate: e.target.value })} onKeyDown={onKey} placeholder="Crate" /></td>
        <td><select className="sb-input inv-ei" value={draft.item_type} onChange={e => setE({ item_type: e.target.value })}><option value="">—</option>{INVENTORY_ITEM_TYPES.map(t => <option key={t} value={t}>{titleCase(t)}</option>)}</select></td>
        <td><input className="sb-input inv-ei" value={draft.color} onChange={e => setE({ color: e.target.value })} onKeyDown={onKey} placeholder="Color" /></td>
        <td><input className="sb-input inv-ei" value={draft.size} onChange={e => setE({ size: e.target.value })} onKeyDown={onKey} placeholder="Size" /></td>
        <td><input className="sb-input inv-ei" value={draft.specs} onChange={e => setE({ specs: e.target.value })} onKeyDown={onKey} placeholder="Specs" /></td>
        <td><input className="sb-input inv-ei" value={draft.location} onChange={e => setE({ location: e.target.value })} onKeyDown={onKey} placeholder="Location" /></td>
        <td><input className="sb-input inv-ei inv-ei-qty" type="number" min="1" value={draft.quantity} onChange={e => setE({ quantity: e.target.value })} onKeyDown={onKey} /></td>
        <td><select className="sb-input inv-ei" value={draft.status} onChange={e => setE({ status: e.target.value })}>{INVENTORY_STATUSES.map(s => <option key={s.code} value={s.code}>{s.label}</option>)}{!INVENTORY_STATUSES.some(s => s.code === draft.status) && <option value={draft.status}>{statusLabel(draft.status)}</option>}</select></td>
        <td><input className="sb-input inv-ei" value={draft.assigned_to} onChange={e => setE({ assigned_to: e.target.value })} onKeyDown={onKey} placeholder="Assigned to" /></td>
        <td className="inv-actions-cell">
          <div className="inv-edit-actions">
            <button type="button" className="inv-save-btn" onClick={onSave} disabled={busy}>{busy ? '…' : 'Save'}</button>
            <button type="button" className="inv-cancel-btn" onClick={onCancel}>Cancel</button>
          </div>
        </td>
      </tr>
      <tr className="inv-edit-subrow">
        <td colSpan={12}>
          <div className="inv-edit-sub">
            <label className="inv-ei-f"><span>Top</span><input className="sb-input inv-ei" value={draft.top} onChange={e => setE({ top: e.target.value })} onKeyDown={onKey} placeholder="Top finish" /></label>
            <label className="inv-ei-f"><span>Sides</span><input className="sb-input inv-ei" value={draft.sides} onChange={e => setE({ sides: e.target.value })} onKeyDown={onKey} placeholder="Sides" /></label>
            <label className="inv-ei-f"><span>Back</span><input className="sb-input inv-ei" value={draft.back} onChange={e => setE({ back: e.target.value })} onKeyDown={onKey} placeholder="Back finish" /></label>
            <label className="inv-ei-f"><span>Spot</span><input className="sb-input inv-ei" value={draft.spot} onChange={e => setE({ spot: e.target.value })} onKeyDown={onKey} placeholder="stack 3, row 2" /></label>
            <label className="inv-ei-f"><span>Condition</span><select className="sb-input inv-ei" value={draft.condition} onChange={e => setE({ condition: e.target.value })}>{['good', 'chip', 'crack', 'scratch', 'wrong_size', 'other'].map(c => <option key={c} value={c}>{conditionLabel(c)}</option>)}</select></label>
            <label className="inv-ei-f inv-ei-f-grow"><span>Condition note</span><input className="sb-input inv-ei" value={draft.condition_note} onChange={e => setE({ condition_note: e.target.value })} onKeyDown={onKey} placeholder="small chip back lower left" /></label>
            <label className="inv-ei-f inv-ei-f-grow"><span>Notes</span><input className="sb-input inv-ei" value={draft.notes} onChange={e => setE({ notes: e.target.value })} onKeyDown={onKey} placeholder="Notes" /></label>
            {err && <span className="inv-edit-err">Couldn’t save: {err}</span>}
          </div>
        </td>
      </tr>
    </>
  )
}

const INV_CSS = `
  .inv-actions-cell { white-space: nowrap; text-align: right; }
  .inv-edit-btn { background: none; border: 1px solid var(--sb-border, #d8d2c4); border-radius: 6px; font: inherit; font-size: 12px; font-weight: 600; color: #6b5d3a; padding: 3px 11px; cursor: pointer; }
  .inv-edit-btn:hover { background: var(--sb-surface-muted, #faf8f3); }
  .inv-edit-row td { background: #fbf7ec; padding: 6px 8px; vertical-align: middle; }
  .inv-ei { font-size: 12.5px; padding: 5px 7px; width: 100%; min-width: 70px; }
  .inv-ei-qty { text-align: center; min-width: 48px; }
  .inv-edit-actions { display: flex; gap: 6px; justify-content: flex-end; }
  .inv-save-btn { background: #1f7a3d; border: none; color: #fff; font: inherit; font-size: 12px; font-weight: 600; padding: 5px 12px; border-radius: 6px; cursor: pointer; }
  .inv-save-btn:disabled { opacity: 0.5; cursor: default; }
  .inv-cancel-btn { background: none; border: 1px solid var(--sb-border, #d8d2c4); font: inherit; font-size: 12px; font-weight: 600; color: #6b6256; padding: 5px 11px; border-radius: 6px; cursor: pointer; }
  .inv-edit-subrow td { background: #fbf7ec; border-bottom: 2px solid var(--sb-border, #e4e0d4); padding: 0 8px 8px; }
  .inv-edit-sub { display: flex; align-items: flex-end; gap: 14px; flex-wrap: wrap; }
  .inv-ei-f { display: flex; flex-direction: column; gap: 3px; }
  .inv-ei-f-grow { flex: 1 1 240px; }
  .inv-ei-f > span { font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: var(--sb-text-muted, #8a7f6c); }
  .inv-edit-err { color: #b3261e; font-size: 12.5px; font-weight: 600; align-self: center; }
  .inv-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; }
  .inv-head-actions { display: flex; align-items: center; gap: 12px; flex: 0 0 auto; flex-wrap: wrap; }
  .inv-import-btn { white-space: nowrap; flex: 0 0 auto; }
  .inv-reset-btn { white-space: nowrap; flex: 0 0 auto; font: inherit; font-size: 13px; font-weight: 700; padding: 8px 14px; border-radius: 8px; border: 1px solid #B3261E; background: #fff; color: #B3261E; cursor: pointer; }
  .inv-reset-btn:hover { background: #fbeceb; }
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
  .inv-err { margin-top: 10px; color: #b3261e; font-size: 13px; overflow-wrap: anywhere; }

  .inv-toolbar { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; flex-wrap: wrap; }
  .inv-search { flex: 1 1 280px; min-width: 220px; }
  .inv-sizeq { display: flex; align-items: center; gap: 8px; flex: 1 1 320px; min-width: 0; flex-wrap: wrap; }
  .inv-sizeq-box { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; font-weight: 700; color: #6b6b66; }
  .inv-sizeq-box input { width: 76px; font-family: "JetBrains Mono", Consolas, monospace; }
  .inv-sizeq-hint { font-size: 12px; color: #8a8a85; min-width: 0; overflow-wrap: anywhere; }
  .inv-sizeq-clear { font: inherit; font-size: 12px; font-weight: 700; color: #9A7209; background: none; border: none; cursor: pointer; text-decoration: underline; }
  .inv-filter { flex: 0 0 auto; min-width: 130px; }
  .inv-count { margin-left: auto; font-size: 12.5px; color: var(--sb-text-muted, #8a7f6c); white-space: nowrap; }

  .inv-table-wrap { overflow-x: auto; border: 1px solid var(--sb-border, #e4e0d4); border-radius: 12px; background: var(--sb-surface, #fff); }
  .inv-table { width: 100%; border-collapse: collapse; font-size: 13.5px; }
  .inv-table thead th { text-align: left; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em;
    color: var(--sb-text-muted, #8a7f6c); padding: 11px 14px; border-bottom: 1px solid var(--sb-border, #e4e0d4); white-space: nowrap; }
  .inv-th-sort { cursor: pointer; user-select: none; }
  .inv-th-sort:hover, .inv-th-sort.on { color: #9A7209; }
  .inv-table tbody td { padding: 10px 14px; border-bottom: 1px solid var(--sb-border-soft, #f0ece2); color: var(--sb-text, #2a2a2a); vertical-align: top; }
  .inv-table tbody tr:last-child td { border-bottom: 0; }
  .inv-table tbody tr:hover td { background: var(--sb-surface-muted, #faf8f3); }
  .inv-tag { font-family: var(--font-m, 'JetBrains Mono'), monospace; font-size: 15px; font-weight: 800; white-space: nowrap; }
  .inv-loc { font-weight: 700; white-space: nowrap; }
  .inv-mono { font-family: var(--font-m, 'JetBrains Mono'), monospace; font-size: 12.5px; }
  .inv-num { text-align: right; font-variant-numeric: tabular-nums; }
  .inv-wrap { overflow-wrap: anywhere; word-break: break-word; min-width: 0; }
  .inv-specs { max-width: 240px; color: #55503F; font-size: 12.5px; }

  .inv-assigned { display: inline-flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .inv-release { font: inherit; font-size: 11.5px; font-weight: 600; padding: 2px 9px; border-radius: 6px; border: 1px solid var(--sb-border, #d8d2c4); background: var(--sb-surface, #fff); color: #8a5a00; cursor: pointer; }
  .inv-release:hover { background: #fbf1df; border-color: #d9b873; }
  .inv-pill { display: inline-block; padding: 2px 9px; border-radius: 999px; font-size: 11.5px; font-weight: 600; white-space: nowrap; }
  .inv-pill-available { background: #e7f3ea; color: #1f7a3d; }
  .inv-pill-allocated { background: #fbeede; color: #9A7209; }
  .inv-pill-problem { background: #B3261E; color: #fff; }
  .inv-pill-missing { background: rgba(179,38,30,0.12); color: #B3261E; }
  .inv-pill-hold { background: rgba(184,132,42,0.16); color: #8A5A12; }
  .inv-pill-removed { background: #EEEAE0; color: #6B6456; }
  .inv-pill-cond { background: rgba(184,132,42,0.16); color: #8A5A12; margin-left: 6px; }
  .inv-muted { color: var(--sb-text-muted, #8a7f6c); font-size: 13px; }

  .inv-old { margin-top: 22px; }
  .inv-old-toggle { font: inherit; font-size: 13px; font-weight: 700; color: #6b6256; background: none; border: 1px solid var(--sb-border, #d8d2c4); border-radius: 8px; padding: 7px 13px; cursor: pointer; }
  .inv-old-toggle:hover { color: #9A7209; border-color: #9A7209; }
  .inv-old-body { margin-top: 12px; }
  .inv-table-old tbody td { color: #6b6256; }

  .inv-modal-scrim { position: fixed; inset: 0; background: rgba(15,20,25,0.45); z-index: 80; display: flex; align-items: center; justify-content: center; padding: 20px; }
  .inv-modal { background: #fff; border-radius: 14px; padding: 22px 24px; width: min(520px, 100%); box-shadow: 0 18px 50px rgba(0,0,0,0.25); min-width: 0; }
  .inv-modal-title { font-size: 18px; font-weight: 800; color: #B3261E; margin-bottom: 8px; }
  .inv-modal-body { font-size: 13.5px; line-height: 1.5; color: #2a2a2a; overflow-wrap: anywhere; }
  .inv-modal-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 18px; }
  .inv-reset-go { font: inherit; font-size: 13px; font-weight: 800; padding: 8px 16px; border-radius: 8px; border: none; background: #B3261E; color: #fff; cursor: pointer; }
  .inv-reset-go:disabled { opacity: 0.4; cursor: default; }
`
