// =============================================================================
// Catalog — premium design gallery (gallery + detail + Settings > Archive).
// Renders standalone (its own /catalog route, no CRM chrome) — see
// CatalogStandalone in App.jsx. Staff-only (the route is auth-gated).
// =============================================================================
// Archive model: designs are soft-archived (monuments.is_archived) rather than
// deleted. The gallery shows only non-archived; Settings > Archive lists the
// archived ones with Restore / Delete-permanently.
//
// Sync correctness (the bug we fixed): an RLS-blocked write returns NO error but
// affects 0 rows. So every write does .select() and we only touch the on-screen
// list once the DB confirms ≥1 row changed — screen and DB never drift.
//
// Data mapping: name=lastname (title-cased), granite=granite_color,
// shape/style=meta.Type, image=img (full Google-Drive URL). NO emojis (the
// `icon` column holds one — ignored).
// =============================================================================

import { useState, useEffect, useMemo, useRef } from 'react'
import { supabase } from './lib/supabase'
import { fetchAllPaged } from './lib/stonebooksData'

const IMAGE_BUCKET = 'monument-images'
const safeFileName = (n) => String(n || 'photo').replace(/[^\w.-]+/g, '_').slice(-80)

const thumbUrl = (url) => (url && url.includes('drive.google.com') ? url.replace(/sz=w\d+/i, 'sz=w400') : url)
const fullUrl  = (url) => (url && url.includes('drive.google.com') ? url.replace(/sz=w\d+/i, 'sz=w1200') : url)

const titleCase = (s) => String(s || '').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()).trim()
const specLine = (m) => [m.granite_color, m.carve_type].filter(Boolean).join('  ·  ')
const nameOf = (m) => titleCase(m.lastname) || titleCase(m.name) || 'Untitled'

const friendlyErr = (error, what) =>
  /row-level security|permission|policy/i.test(error?.message || '')
    ? `${what} permission isn’t set up yet — apply migration 20260613_monuments_archive.`
    : (error?.message || 'Something went wrong.')

function Gear() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  )
}

// Image that degrades to a serif-monogram placeholder — never a broken img.
// object-fit: contain so the ENTIRE photo shows, letterboxed on a neutral fill.
function CatImage({ src, alt, full = false, className }) {
  const [failed, setFailed] = useState(false)
  if (!src || failed) {
    return <div className={`cat-ph ${className || ''}`}><span className="cat-ph-mono">{titleCase(alt).slice(0, 1) || '·'}</span></div>
  }
  return (
    <img className={className} src={full ? fullUrl(src) : thumbUrl(src)} alt={alt || ''}
      loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
  )
}

export default function CatalogTab({ onStartOrder }) {
  const [monuments, setMonuments] = useState(null)   // null = loading; full list (archived + active)
  const [view, setView] = useState('gallery')        // 'gallery' | 'archive' | 'duplicates' | 'form'
  const [search, setSearch] = useState('')
  const [fShape, setFShape] = useState('')
  const [fColor, setFColor] = useState('')
  const [selectedId, setSelectedId] = useState(null)
  const [editing, setEditing] = useState(null)       // monument being edited; null in 'form' = add

  useEffect(() => {
    let cancelled = false
    fetchAllPaged(() => supabase.from('monuments').select('*'))
      .then((rows) => {
        if (cancelled) return
        setMonuments([...rows].sort((a, b) => String(a.lastname || 'zzz').localeCompare(String(b.lastname || 'zzz'))))
      })
      .catch(() => { if (!cancelled) setMonuments([]) })
    return () => { cancelled = true }
  }, [])

  // Split the single fetch by the persisted flag — gallery excludes archived.
  const active = useMemo(() => (monuments || []).filter((m) => !m.is_archived), [monuments])
  const archived = useMemo(() => (monuments || []).filter((m) => m.is_archived === true), [monuments])

  const shapeOptions = useMemo(() => [...new Set(active.map((m) => m.meta?.Type).filter(Boolean))].sort(), [active])
  const colorOptions = useMemo(() => [...new Set(active.map((m) => m.granite_color).filter(Boolean))].sort(), [active])
  const carveOptions = useMemo(() => [...new Set(active.map((m) => m.carve_type).filter(Boolean))].sort(), [active])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return active.filter((m) => {
      if (fShape && m.meta?.Type !== fShape) return false
      if (fColor && m.granite_color !== fColor) return false
      if (q) {
        const hay = `${m.lastname || ''} ${m.name || ''} ${m.granite_color || ''} ${m.description || ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [active, search, fShape, fColor])

  const selected = useMemo(
    () => (selectedId ? (monuments || []).find((m) => m.id === selectedId) : null),
    [selectedId, monuments],
  )

  // ── Writes — each confirms the DB actually changed before updating state ──
  const setArchivedFlag = async (id, value) => {
    const { data, error } = await supabase.from('monuments').update({ is_archived: value }).eq('id', id).select('id')
    if (error) return { ok: false, error: friendlyErr(error, 'Archive') }
    if (!data || data.length === 0) return { ok: false, error: 'The change didn’t save — apply migration 20260613_monuments_archive, then try again.' }
    setMonuments((arr) => (arr || []).map((m) => (m.id === id ? { ...m, is_archived: value } : m)))
    return { ok: true }
  }
  const purge = async (id) => {
    const { data, error } = await supabase.from('monuments').delete().eq('id', id).select('id')
    if (error) return { ok: false, error: friendlyErr(error, 'Delete') }
    if (!data || data.length === 0) return { ok: false, error: 'Couldn’t delete — apply migration 20260613_monuments_archive, then try again.' }
    setMonuments((arr) => (arr || []).filter((m) => m.id !== id))
    return { ok: true }
  }
  // Bulk archive in ONE batched UPDATE … WHERE id IN (...), confirmed by .select().
  const archiveMany = async (ids) => {
    if (!ids.length) return { ok: false, error: 'Nothing selected.' }
    const { data, error } = await supabase.from('monuments').update({ is_archived: true }).in('id', ids).select('id')
    if (error) return { ok: false, error: friendlyErr(error, 'Archive') }
    if (!data || data.length === 0) return { ok: false, error: 'The change didn’t save — apply migration 20260613_monuments_archive, then try again.' }
    const done = new Set(data.map((r) => r.id))
    setMonuments((arr) => (arr || []).map((m) => (done.has(m.id) ? { ...m, is_archived: true } : m)))
    return { ok: true, count: done.size }
  }

  // Add / edit — the saved row comes back from .select(); merge into state.
  const handleSaved = (savedRow, mode) => {
    setMonuments((arr) => {
      const base = arr || []
      const next = mode === 'edit'
        ? base.map((m) => (m.id === savedRow.id ? savedRow : m))
        : [...base, savedRow]
      return next.sort((a, b) => String(a.lastname || 'zzz').localeCompare(String(b.lastname || 'zzz')))
    })
    setSelectedId(mode === 'edit' ? savedRow.id : null)
    setEditing(null)
    setView('gallery')
  }
  const openAdd = () => { setEditing(null); setSelectedId(null); setView('form') }
  const openEdit = (m) => { setEditing(m); setView('form') }
  const cancelForm = () => { setEditing(null); setView('gallery') }

  const inSettings = view === 'archive' || view === 'duplicates'
  const goHome = () => { setView('gallery'); setSelectedId(null); setEditing(null) }

  return (
    <div className="cat-root">
      <style>{CATALOG_CSS}</style>

      <div className="cat-topbar">
        <button type="button" className="cat-brand" onClick={goHome}>
          Shevchenko <span>Monuments</span><em>Catalog</em>
        </button>
        <button
          type="button"
          className={`cat-gear ${inSettings ? 'on' : ''}`}
          onClick={() => { setSelectedId(null); setEditing(null); setView(inSettings ? 'gallery' : 'archive') }}
          aria-label="Settings"
          title="Settings"
        ><Gear /></button>
      </div>

      <div className="cat-page">
        {view === 'form' ? (
          <DesignForm
            monument={editing}
            shapeOptions={shapeOptions} colorOptions={colorOptions} carveOptions={carveOptions}
            onCancel={cancelForm} onSaved={handleSaved}
          />
        ) : inSettings ? (
          <>
            <SettingsHeader active={view} onBack={goHome} onTab={setView} />
            {view === 'archive' ? (
              <ArchiveSettings archived={archived} loading={monuments === null} onRestore={(id) => setArchivedFlag(id, false)} onPurge={purge} />
            ) : (
              <DuplicatesView active={active} loading={monuments === null} onArchiveMany={archiveMany} />
            )}
          </>
        ) : selected ? (
          <CatalogDetail
            monument={selected}
            onBack={goHome}
            onStartOrder={onStartOrder}
            onEdit={() => openEdit(selected)}
            onArchive={() => setArchivedFlag(selected.id, true)}
          />
        ) : (
          <Gallery
            monuments={monuments} filtered={filtered}
            search={search} setSearch={setSearch}
            fShape={fShape} setFShape={setFShape} shapeOptions={shapeOptions}
            fColor={fColor} setFColor={setFColor} colorOptions={colorOptions}
            onOpen={setSelectedId} onAdd={openAdd}
          />
        )}
      </div>
    </div>
  )
}

function Gallery({ monuments, filtered, search, setSearch, fShape, setFShape, shapeOptions, fColor, setFColor, colorOptions, onOpen, onAdd }) {
  return (
    <>
      <div className="cat-head">
        <div>
          <div className="cat-eyebrow">Design Library</div>
          <h1 className="cat-title">Catalog</h1>
        </div>
        <div className="cat-head-right">
          <span className="cat-count">{monuments === null ? 'Loading…' : `${filtered.length.toLocaleString()} design${filtered.length === 1 ? '' : 's'}`}</span>
          <button type="button" className="cat-add-btn" onClick={onAdd}>+ Add design</button>
        </div>
      </div>

      <div className="cat-toolbar">
        <input className="cat-search" type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name, granite, or description" />
        <select className="cat-select" value={fShape} onChange={(e) => setFShape(e.target.value)}>
          <option value="">All shapes</option>
          {shapeOptions.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select className="cat-select" value={fColor} onChange={(e) => setFColor(e.target.value)}>
          <option value="">All granites</option>
          {colorOptions.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      {monuments === null ? (
        <div className="cat-empty">Loading the design library…</div>
      ) : filtered.length === 0 ? (
        <div className="cat-empty">No designs match. Try clearing the search or filters.</div>
      ) : (
        <div className="cat-grid">
          {filtered.map((m) => (
            <button key={m.id} type="button" className="cat-card" onClick={() => onOpen(m.id)}>
              <div className="cat-card-tile"><CatImage src={m.img} alt={m.lastname || m.name} className="cat-card-img" /></div>
              <div className="cat-card-body">
                <div className="cat-card-name">{nameOf(m)}</div>
                {specLine(m) && <div className="cat-card-spec">{specLine(m)}</div>}
              </div>
            </button>
          ))}
        </div>
      )}
    </>
  )
}

function CatalogDetail({ monument: m, onBack, onStartOrder, onEdit, onArchive }) {
  const [confirm, setConfirm] = useState(false)
  const specs = [
    ['Granite', m.granite_color],
    ['Shape / style', m.meta?.Type],
    ['Carving', m.carve_type],
    ['Layout', m.meta?.Layout],
    ['Detail level', m.meta?.Complexity],
  ].filter(([, v]) => v)

  return (
    <>
      <button type="button" className="cat-back" onClick={onBack}>&larr; Back to catalog</button>
      <div className="cat-detail">
        <div className="cat-detail-media"><CatImage src={m.img} alt={m.lastname || m.name} full className="cat-detail-img" /></div>
        <div className="cat-detail-info">
          <div className="cat-eyebrow">{m.meta?.Type || 'Monument'}</div>
          <h1 className="cat-detail-name">{nameOf(m)}</h1>
          {m.name && m.name !== m.lastname && <div className="cat-detail-sub">{m.name}</div>}

          <dl className="cat-specs">
            {specs.map(([k, v]) => (<div key={k} className="cat-spec-row"><dt>{k}</dt><dd>{v}</dd></div>))}
          </dl>

          {m.description && <p className="cat-detail-desc">{m.description}</p>}
          {m.meta?.SalesUse && (
            <div className="cat-salesuse"><div className="cat-salesuse-label">When to show this</div>{m.meta.SalesUse}</div>
          )}
          {Array.isArray(m.tags) && m.tags.length > 0 && (
            <div className="cat-tags">{m.tags.map((t) => <span key={t} className="cat-tag">{t}</span>)}</div>
          )}

          <div className="cat-detail-actions">
            <button type="button" className="cat-order-btn" onClick={() => onStartOrder?.(m)}>Start an order from this</button>
            <button type="button" className="cat-edit-btn" onClick={() => onEdit?.()}>Edit</button>
          </div>
          <div className="cat-danger-zone">
            <button type="button" className="cat-archive-link" onClick={() => setConfirm(true)}>Archive this design</button>
          </div>
        </div>
      </div>

      {confirm && (
        <ConfirmModal
          monument={m}
          title="Move this design to the archive?"
          copy="You can restore it anytime from Settings."
          confirmLabel="Archive"
          busyLabel="Archiving…"
          onCancel={() => setConfirm(false)}
          run={onArchive}
          onDone={onBack}
        />
      )}
    </>
  )
}

// Settings sub-nav: Back to catalog + Archive / Duplicates segmented control.
function SettingsHeader({ active, onBack, onTab }) {
  return (
    <div className="cat-settings-header">
      <button type="button" className="cat-back" onClick={onBack}>&larr; Back to catalog</button>
      <div className="cat-segments">
        <button type="button" className={`cat-segment ${active === 'archive' ? 'on' : ''}`} onClick={() => onTab('archive')}>Archive</button>
        <button type="button" className={`cat-segment ${active === 'duplicates' ? 'on' : ''}`} onClick={() => onTab('duplicates')}>Duplicates</button>
      </div>
    </div>
  )
}

function ArchiveSettings({ archived, loading, onRestore, onPurge }) {
  const [purgeTarget, setPurgeTarget] = useState(null)
  const [busyId, setBusyId] = useState(null)
  const [rowError, setRowError] = useState(null)

  const restore = async (id) => {
    setBusyId(id); setRowError(null)
    const res = await onRestore(id)
    setBusyId(null)
    if (!res.ok) setRowError({ id, msg: res.error })
  }

  return (
    <>
      <div className="cat-head">
        <div>
          <div className="cat-eyebrow">Settings</div>
          <h1 className="cat-title">Archive</h1>
        </div>
        <div className="cat-count">{loading ? 'Loading…' : `${archived.length.toLocaleString()} archived`}</div>
      </div>

      {loading ? (
        <div className="cat-empty">Loading…</div>
      ) : archived.length === 0 ? (
        <div className="cat-empty">Nothing archived. Archived designs appear here and can be restored or permanently deleted.</div>
      ) : (
        <div className="cat-grid cat-arch-grid">
          {archived.map((m) => (
            <div key={m.id} className="cat-arch-card">
              <div className="cat-card-tile"><CatImage src={m.img} alt={m.lastname || m.name} className="cat-card-img" /></div>
              <div className="cat-card-body">
                <div className="cat-card-name">{nameOf(m)}</div>
                {specLine(m) && <div className="cat-card-spec">{specLine(m)}</div>}
              </div>
              {rowError?.id === m.id && <div className="cat-arch-error">{rowError.msg}</div>}
              <div className="cat-arch-actions">
                <button type="button" className="cat-arch-restore" disabled={busyId === m.id} onClick={() => restore(m.id)}>
                  {busyId === m.id ? 'Restoring…' : 'Restore'}
                </button>
                <button type="button" className="cat-arch-delete" onClick={() => setPurgeTarget(m)}>Delete permanently</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {purgeTarget && (
        <ConfirmModal
          monument={purgeTarget}
          title="Permanently delete this design?"
          copy="This cannot be undone."
          confirmLabel="Delete"
          busyLabel="Deleting…"
          destructive
          onCancel={() => setPurgeTarget(null)}
          run={() => onPurge(purgeTarget.id)}
          onDone={() => setPurgeTarget(null)}
        />
      )}
    </>
  )
}

function Check() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 6L9 17l-5-5" />
    </svg>
  )
}

// Add / edit a design. Photo -> monument-images bucket -> public URL -> img.
// Every write is awaited and confirmed (.select()); failures keep the form open.
function DesignForm({ monument, shapeOptions, colorOptions, carveOptions, onCancel, onSaved }) {
  const isEdit = !!monument
  const [name, setName] = useState(monument?.lastname || '')
  const [granite, setGranite] = useState(monument?.granite_color || '')
  const [shape, setShape] = useState(monument?.meta?.Type || '')
  const [carve, setCarve] = useState(monument?.carve_type || '')
  const [description, setDescription] = useState(monument?.description || '')
  const [salesNote, setSalesNote] = useState(monument?.meta?.SalesUse || '')
  const [tagsStr, setTagsStr] = useState((monument?.tags || []).join(', '))
  const [imgUrl, setImgUrl] = useState(monument?.img || '')
  const [uploading, setUploading] = useState(false)
  const [uploadErr, setUploadErr] = useState(null)
  const [saving, setSaving] = useState(false)
  const [saveErr, setSaveErr] = useState(null)
  const fileRef = useRef(null)

  const pickPhoto = async (file) => {
    if (!file) return
    setUploading(true); setUploadErr(null)
    try {
      const path = `${monument?.id || 'new'}/${Date.now()}_${safeFileName(file.name)}`
      const { error: upErr } = await supabase.storage.from(IMAGE_BUCKET).upload(path, file, { upsert: false, contentType: file.type || undefined })
      if (upErr) throw upErr
      const { data } = supabase.storage.from(IMAGE_BUCKET).getPublicUrl(path)
      if (!data?.publicUrl) throw new Error('Could not get the image URL.')
      setImgUrl(data.publicUrl)
    } catch (e) {
      setUploadErr(/row-level security|policy|denied|unauthor|bucket/i.test(e?.message || '')
        ? 'Upload isn’t permitted yet — apply migration 20260614_monuments_management (creates the bucket + staff policy).'
        : (e?.message || 'Upload failed.'))
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const save = async () => {
    if (!name.trim()) { setSaveErr('Enter a name.'); return }
    setSaving(true); setSaveErr(null)
    const tags = tagsStr.split(',').map((t) => t.trim()).filter(Boolean)
    const meta = { ...(monument?.meta || {}), Type: shape.trim() || null, Color: granite.trim() || null, SalesUse: salesNote.trim() || null }
    const base = {
      lastname: name.trim(),
      granite_color: granite.trim() || null,
      carve_type: carve.trim() || null,
      description: description.trim() || null,
      tags, meta, img: imgUrl || null,
    }
    try {
      const q = isEdit
        ? supabase.from('monuments').update(base).eq('id', monument.id).select()
        : supabase.from('monuments').insert({ id: `cat-${crypto.randomUUID()}`, is_archived: false, ...base }).select()
      const { data, error } = await q
      if (error) throw error
      if (!data || data.length === 0) throw new Error('The change didn’t save — apply migration 20260614_monuments_management, then try again.')
      onSaved(data[0], isEdit ? 'edit' : 'add')
    } catch (e) {
      setSaveErr(/row-level security|policy/i.test(e?.message || '')
        ? 'Not permitted — apply migration 20260614_monuments_management (staff write policy).'
        : (e?.message || 'Save failed.'))
      setSaving(false)
    }
  }

  return (
    <>
      <button type="button" className="cat-back" onClick={onCancel}>&larr; Back to catalog</button>
      <div className="cat-form-head">
        <div>
          <div className="cat-eyebrow">{isEdit ? 'Edit' : 'New'}</div>
          <h1 className="cat-title">{isEdit ? 'Edit design' : 'Add design'}</h1>
        </div>
        <div className="cat-form-head-actions">
          <button type="button" className="cat-modal-cancel cat-form-cancel" onClick={onCancel} disabled={saving}>Cancel</button>
          <button type="button" className="cat-order-btn" onClick={save} disabled={saving || uploading}>{saving ? 'Saving…' : 'Save design'}</button>
        </div>
      </div>

      <div className="cat-form-grid">
        <div className="cat-form-photo">
          <div className="cat-card-tile"><CatImage src={imgUrl} alt={name} full className="cat-card-img" /></div>
          <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => pickPhoto(e.target.files?.[0])} />
          <button type="button" className="cat-upload-btn" disabled={uploading} onClick={() => fileRef.current?.click()}>
            {uploading ? 'Uploading…' : imgUrl ? 'Replace photo' : 'Upload photo'}
          </button>
          {uploadErr && <div className="cat-form-error">{uploadErr}</div>}
        </div>

        <div className="cat-form-fields">
          <label className="cat-field">
            <span>Name</span>
            <input className="cat-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Family name shown on the card" autoFocus />
          </label>
          <div className="cat-field-row">
            <label className="cat-field">
              <span>Granite / color</span>
              <input className="cat-input" list="cat-colors" value={granite} onChange={(e) => setGranite(e.target.value)} placeholder="e.g. Gray" />
              <datalist id="cat-colors">{colorOptions.map((c) => <option key={c} value={c} />)}</datalist>
            </label>
            <label className="cat-field">
              <span>Shape</span>
              <input className="cat-input" list="cat-shapes" value={shape} onChange={(e) => setShape(e.target.value)} placeholder="e.g. Single Upright" />
              <datalist id="cat-shapes">{shapeOptions.map((s) => <option key={s} value={s} />)}</datalist>
            </label>
          </div>
          <label className="cat-field">
            <span>Carve type</span>
            <input className="cat-input" list="cat-carves" value={carve} onChange={(e) => setCarve(e.target.value)} placeholder="e.g. Flat Carve" />
            <datalist id="cat-carves">{carveOptions.map((c) => <option key={c} value={c} />)}</datalist>
          </label>
          <label className="cat-field">
            <span>Description</span>
            <textarea className="cat-input cat-textarea" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What the design features" />
          </label>
          <label className="cat-field">
            <span>When to show this</span>
            <textarea className="cat-input cat-textarea" rows={2} value={salesNote} onChange={(e) => setSalesNote(e.target.value)} placeholder="Sales note — which families this suits" />
          </label>
          <label className="cat-field">
            <span>Tags</span>
            <input className="cat-input" value={tagsStr} onChange={(e) => setTagsStr(e.target.value)} placeholder="Comma-separated, e.g. Cross, Roses, Veteran" />
          </label>
          {saveErr && <div className="cat-form-error">{saveErr}</div>}
        </div>
      </div>
    </>
  )
}

// Show duplicates: group the gallery by name, show only names that repeat 2+,
// select the extras, archive them all in one batched UPDATE.
function DuplicatesView({ active, loading, onArchiveMany }) {
  const [selected, setSelected] = useState(() => new Set())
  const [confirm, setConfirm] = useState(false)

  const groups = useMemo(() => {
    const map = new Map()
    for (const m of active) {
      const key = (m.lastname || m.name || '').trim().toLowerCase()
      if (!key) continue
      if (!map.has(key)) map.set(key, [])
      map.get(key).push(m)
    }
    return [...map.values()]
      .filter((g) => g.length >= 2)
      .sort((a, b) => nameOf(a[0]).localeCompare(nameOf(b[0])))
  }, [active])

  const totalPhotos = useMemo(() => groups.reduce((n, g) => n + g.length, 0), [groups])
  const selectedCount = selected.size

  const toggle = (id) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })

  const doArchive = async () => {
    const res = await onArchiveMany([...selected])
    if (res.ok) setSelected(new Set())
    return res
  }

  return (
    <>
      <div className="cat-head">
        <div>
          <div className="cat-eyebrow">Settings</div>
          <h1 className="cat-title">Duplicates</h1>
        </div>
        <div className="cat-count">
          {loading ? 'Loading…'
            : groups.length === 0 ? 'None'
            : `${groups.length.toLocaleString()} name${groups.length === 1 ? '' : 's'}  ·  ${totalPhotos.toLocaleString()} photos`}
        </div>
      </div>

      {loading ? (
        <div className="cat-empty">Loading…</div>
      ) : groups.length === 0 ? (
        <div className="cat-empty">No duplicate names. Every design in the gallery has a unique name.</div>
      ) : (
        <div className="cat-dupes">
          {groups.map((g) => (
            <div key={nameOf(g[0]).toLowerCase()} className="cat-dupe-group">
              <div className="cat-dupe-name">{nameOf(g[0])}<span>{g.length} photos</span></div>
              <div className="cat-grid">
                {g.map((m) => {
                  const sel = selected.has(m.id)
                  return (
                    <button key={m.id} type="button" className={`cat-card cat-select-card ${sel ? 'sel' : ''}`} onClick={() => toggle(m.id)} aria-pressed={sel}>
                      <div className="cat-card-tile">
                        <CatImage src={m.img} alt={m.lastname || m.name} className="cat-card-img" />
                        <span className="cat-check">{sel ? <Check /> : null}</span>
                      </div>
                      <div className="cat-card-body">
                        <div className="cat-card-name">{nameOf(m)}</div>
                        {specLine(m) && <div className="cat-card-spec">{specLine(m)}</div>}
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {groups.length > 0 && (
        <div className="cat-actionbar">
          <span className="cat-actionbar-count">{selectedCount} selected</span>
          <button type="button" className="cat-actionbar-btn" disabled={selectedCount === 0} onClick={() => setConfirm(true)}>Archive selected</button>
        </div>
      )}

      {confirm && (
        <ConfirmModal
          title={`Archive ${selectedCount} design${selectedCount === 1 ? '' : 's'}?`}
          copy="You can restore them from the Archive."
          confirmLabel="Archive"
          busyLabel="Archiving…"
          onCancel={() => setConfirm(false)}
          run={doArchive}
          onDone={() => setConfirm(false)}
        />
      )}
    </>
  )
}

// Shared confirm dialog. `run` returns { ok, error }; on ok we call onDone.
// `monument` is optional — omit it for a bulk action (title-only heading).
function ConfirmModal({ monument: m, title, copy, confirmLabel, busyLabel, destructive, onCancel, run, onDone }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const go = async () => {
    setBusy(true); setError(null)
    const res = await run()
    setBusy(false)
    if (!res || !res.ok) { setError(res?.error || 'Something went wrong.'); return }
    onDone?.()
  }
  return (
    <div className="cat-modal-backdrop" onClick={(e) => e.target === e.currentTarget && !busy && onCancel()}>
      <div className="cat-modal" role="dialog" aria-modal="true">
        {m ? (
          <>
            <div className="cat-modal-media"><CatImage src={m.img} alt={m.lastname || m.name} className="cat-modal-img" /></div>
            <div className="cat-modal-name">{nameOf(m)}</div>
            <p className="cat-modal-copy">{title} {copy}</p>
          </>
        ) : (
          <>
            <div className="cat-modal-name cat-modal-name-bulk">{title}</div>
            <p className="cat-modal-copy">{copy}</p>
          </>
        )}
        {error && <div className="cat-modal-error">{error}</div>}
        <div className="cat-modal-actions">
          <button type="button" className="cat-modal-cancel" onClick={onCancel} disabled={busy}>Cancel</button>
          <button type="button" className={destructive ? 'cat-modal-delete' : 'cat-modal-confirm'} onClick={go} disabled={busy}>
            {busy ? busyLabel : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

const CATALOG_CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;500;600&display=swap');
  .cat-card-name, .cat-detail-name, .cat-ph-mono, .cat-title, .cat-modal-name, .cat-brand { font-family: 'Playfair Display', Georgia, 'Times New Roman', serif; }

  .cat-root { min-height: 100vh; background: #fbfaf7; }
  .cat-topbar { display: flex; align-items: center; justify-content: space-between; padding: 13px 24px; background: #fff; border-bottom: 1px solid #ece8e0; position: sticky; top: 0; z-index: 50; }
  .cat-brand { font-size: 18px; color: #1e2330; background: none; border: none; cursor: pointer; padding: 0; }
  .cat-brand span { color: #9A7209; }
  .cat-brand em { font-family: system-ui, sans-serif; font-style: normal; font-size: 11px; color: #9a948a; letter-spacing: 0.14em; text-transform: uppercase; margin-left: 10px; }
  .cat-gear { display: flex; align-items: center; justify-content: center; width: 36px; height: 36px; border-radius: 9px; border: 1px solid #e7e3db; background: #fff; color: #6b6b66; cursor: pointer; transition: all 0.15s; }
  .cat-gear:hover { color: #1e2330; border-color: #c9bfa8; }
  .cat-gear.on { color: #9A7209; border-color: #d8c89a; background: #fdf8ec; }

  .cat-page { max-width: 1240px; margin: 0 auto; padding: 30px 24px 64px; }

  .cat-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; margin-bottom: 20px; }
  .cat-eyebrow { font-size: 11px; letter-spacing: 0.16em; text-transform: uppercase; color: #9a948a; font-weight: 600; margin-bottom: 6px; }
  .cat-title { font-size: 34px; font-weight: 500; color: #1e2330; letter-spacing: -0.01em; margin: 0; }
  .cat-count { font-size: 13px; color: #9a948a; padding-bottom: 6px; white-space: nowrap; }

  .cat-toolbar { display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 26px; }
  .cat-search { flex: 1; min-width: 240px; font: inherit; font-size: 14px; padding: 11px 14px; border: 1px solid #e4e0d8; border-radius: 9px; background: #fff; color: #2a2a2a; outline: none; transition: border-color 0.15s; }
  .cat-search:focus { border-color: #b8935a; }
  .cat-search::placeholder { color: #b3ada3; }
  .cat-select { font: inherit; font-size: 14px; padding: 11px 32px 11px 14px; border: 1px solid #e4e0d8; border-radius: 9px; background: #fff url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='6'><path d='M1 1l4 4 4-4' fill='none' stroke='%239a948a' stroke-width='1.4'/></svg>") no-repeat right 13px center; color: #2a2a2a; outline: none; cursor: pointer; appearance: none; -webkit-appearance: none; }
  .cat-select:focus { border-color: #b8935a; }

  .cat-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 22px; }
  @media (max-width: 920px) { .cat-grid { grid-template-columns: repeat(2, 1fr); } }
  @media (max-width: 560px) { .cat-grid { grid-template-columns: 1fr; } }

  .cat-card { display: flex; flex-direction: column; text-align: left; background: none; border: none; padding: 0; cursor: pointer; }
  .cat-card-tile { aspect-ratio: 1 / 1; border: 1px solid #e7e3db; border-radius: 12px; overflow: hidden; background: #f5f1ea; display: flex; align-items: center; justify-content: center; transition: border-color 0.18s, transform 0.18s; }
  .cat-card:hover .cat-card-tile { border-color: #c9bfa8; transform: translateY(-2px); }
  .cat-card-img { width: 100%; height: 100%; object-fit: contain; display: block; }
  .cat-card-body { padding: 13px 3px 4px; }
  .cat-card-name { font-size: 19px; font-weight: 500; color: #1e2330; line-height: 1.15; }
  .cat-card-spec { font-size: 13px; color: #9a948a; margin-top: 3px; }

  .cat-ph { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; background: linear-gradient(180deg, #f6f3ee 0%, #efeae1 100%); }
  .cat-ph-mono { font-size: 46px; color: #cfc6b4; font-weight: 500; }

  .cat-empty { padding: 80px 20px; text-align: center; color: #9a948a; font-size: 15px; line-height: 1.6; }

  /* ARCHIVE (settings) cards carry their own action row. */
  .cat-arch-card { display: flex; flex-direction: column; }
  .cat-arch-error { font-size: 12px; color: #9a4a40; margin: 6px 3px 0; }
  .cat-arch-actions { display: flex; gap: 8px; padding: 10px 3px 2px; }
  .cat-arch-restore { flex: 1; font: inherit; font-size: 13px; font-weight: 600; color: #1e2330; background: #f3f0ea; border: 1px solid #e4e0d8; border-radius: 8px; padding: 8px; cursor: pointer; }
  .cat-arch-restore:hover { background: #ece8e0; }
  .cat-arch-restore:disabled { opacity: 0.55; cursor: default; }
  .cat-arch-delete { font: inherit; font-size: 13px; color: #9a4a40; background: none; border: none; padding: 8px 6px; cursor: pointer; }
  .cat-arch-delete:hover { text-decoration: underline; }

  /* DETAIL */
  .cat-back { font: inherit; font-size: 13px; color: #6b6b66; background: none; border: none; cursor: pointer; padding: 4px 0; margin-bottom: 18px; }
  .cat-back:hover { color: #1e2330; }
  .cat-detail { display: grid; grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr); gap: 40px; align-items: start; }
  @media (max-width: 860px) { .cat-detail { grid-template-columns: 1fr; gap: 24px; } }
  .cat-detail-media { position: sticky; top: 82px; }
  .cat-detail-img { width: 100%; max-height: 72vh; object-fit: contain; border: 1px solid #e7e3db; border-radius: 14px; background: #f5f1ea; display: block; }
  .cat-detail .cat-ph { aspect-ratio: 4 / 5; border: 1px solid #e7e3db; border-radius: 14px; }

  .cat-detail-name { font-size: 38px; font-weight: 500; color: #1e2330; line-height: 1.05; margin: 6px 0 4px; letter-spacing: -0.01em; }
  .cat-detail-sub { font-size: 16px; color: #6b6b66; line-height: 1.4; margin-bottom: 22px; }

  .cat-specs { margin: 8px 0 22px; border-top: 1px solid #ece8e0; }
  .cat-spec-row { display: flex; justify-content: space-between; gap: 16px; padding: 11px 0; border-bottom: 1px solid #ece8e0; }
  .cat-spec-row dt { font-size: 13px; color: #9a948a; }
  .cat-spec-row dd { font-size: 14px; color: #2a2a2a; text-align: right; }

  .cat-detail-desc { font-size: 15px; line-height: 1.7; color: #4a4a44; margin-bottom: 20px; }
  .cat-salesuse { background: #faf7f1; border: 1px solid #ece3d2; border-radius: 11px; padding: 15px 17px; font-size: 14px; line-height: 1.6; color: #5a5347; margin-bottom: 20px; }
  .cat-salesuse-label { font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; color: #b39a6a; font-weight: 600; margin-bottom: 6px; }

  .cat-tags { display: flex; flex-wrap: wrap; gap: 7px; margin-bottom: 26px; }
  .cat-tag { font-size: 12px; color: #6b6b66; background: #f3f0ea; border: 1px solid #e7e3db; border-radius: 999px; padding: 4px 11px; }

  .cat-detail-actions { display: flex; gap: 10px; }
  .cat-order-btn { font: inherit; font-size: 14px; font-weight: 600; color: #fff; background: #1e2330; border: 1px solid #1e2330; border-radius: 10px; padding: 13px 26px; cursor: pointer; transition: background 0.15s; }
  .cat-order-btn:hover { background: #2c3446; }

  .cat-danger-zone { margin-top: 30px; padding-top: 18px; border-top: 1px solid #ece8e0; }
  .cat-archive-link { font: inherit; font-size: 13px; color: #6b6b66; background: none; border: none; padding: 4px 0; cursor: pointer; }
  .cat-archive-link:hover { color: #1e2330; text-decoration: underline; }

  /* CONFIRM MODAL */
  .cat-modal-backdrop { position: fixed; inset: 0; background: rgba(28,25,22,0.46); backdrop-filter: blur(2px); z-index: 1200; display: flex; align-items: center; justify-content: center; padding: 22px; }
  .cat-modal { background: #fff; border-radius: 14px; width: 100%; max-width: 380px; padding: 24px; box-shadow: 0 20px 60px rgba(28,25,22,0.3); text-align: center; }
  .cat-modal-media { width: 132px; height: 132px; margin: 0 auto 16px; border: 1px solid #e7e3db; border-radius: 11px; overflow: hidden; background: #f5f1ea; display: flex; align-items: center; justify-content: center; }
  .cat-modal-img { width: 100%; height: 100%; object-fit: contain; }
  .cat-modal-name { font-size: 22px; font-weight: 500; color: #1e2330; margin-bottom: 8px; }
  .cat-modal-copy { font-size: 14px; line-height: 1.6; color: #6b6b66; margin-bottom: 18px; }
  .cat-modal-error { font-size: 13px; color: #9a4a40; background: #fbeceb; border: 1px solid #f0cfca; border-radius: 8px; padding: 9px 11px; margin-bottom: 16px; text-align: left; }
  .cat-modal-actions { display: flex; gap: 10px; }
  .cat-modal-cancel { flex: 1; font: inherit; font-size: 14px; font-weight: 500; color: #4a4a44; background: #f3f0ea; border: 1px solid #e4e0d8; border-radius: 9px; padding: 11px; cursor: pointer; }
  .cat-modal-cancel:hover { background: #ece8e0; }
  .cat-modal-confirm { flex: 1; font: inherit; font-size: 14px; font-weight: 600; color: #fff; background: #1e2330; border: 1px solid #1e2330; border-radius: 9px; padding: 11px; cursor: pointer; }
  .cat-modal-confirm:hover { background: #2c3446; }
  .cat-modal-delete { flex: 1; font: inherit; font-size: 14px; font-weight: 600; color: #fff; background: #9a4a40; border: 1px solid #9a4a40; border-radius: 9px; padding: 11px; cursor: pointer; }
  .cat-modal-delete:hover { background: #843e35; }
  .cat-modal-delete:disabled, .cat-modal-confirm:disabled, .cat-modal-cancel:disabled { opacity: 0.55; cursor: default; }
  .cat-modal-name-bulk { margin-top: 4px; margin-bottom: 10px; }

  /* SETTINGS sub-nav */
  .cat-settings-header { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 18px; flex-wrap: wrap; }
  .cat-settings-header .cat-back { margin-bottom: 0; }
  .cat-segments { display: inline-flex; gap: 2px; background: #f1ede5; border-radius: 999px; padding: 3px; }
  .cat-segment { font: inherit; font-size: 13px; font-weight: 500; color: #6b6b66; background: none; border: none; border-radius: 999px; padding: 7px 18px; cursor: pointer; }
  .cat-segment.on { background: #fff; color: #1e2330; font-weight: 600; box-shadow: 0 1px 2px rgba(28,25,22,0.1); }

  /* DUPLICATES */
  .cat-dupes { display: flex; flex-direction: column; gap: 36px; padding-bottom: 96px; }
  .cat-dupe-name { font-family: 'Playfair Display', Georgia, serif; font-size: 22px; font-weight: 500; color: #1e2330; margin-bottom: 14px; padding-bottom: 8px; border-bottom: 1px solid #ece8e0; display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
  .cat-dupe-name span { font-family: system-ui, sans-serif; font-size: 12px; font-weight: 400; color: #9a948a; letter-spacing: 0.04em; }

  .cat-select-card { position: relative; }
  .cat-select-card .cat-card-tile { position: relative; transition: border-color 0.15s, box-shadow 0.15s, transform 0.18s; }
  .cat-select-card.sel .cat-card-tile { border-color: #9A7209; box-shadow: 0 0 0 2px #9A7209; transform: none; }
  .cat-check { position: absolute; top: 9px; right: 9px; width: 24px; height: 24px; border-radius: 50%; border: 1.5px solid #cbc4b5; background: rgba(255,255,255,0.82); display: flex; align-items: center; justify-content: center; }
  .cat-select-card.sel .cat-check { background: #9A7209; border-color: #9A7209; }
  .cat-select-card.sel .cat-card-name { color: #9A7209; }

  /* persistent action bar (floating pill) */
  .cat-actionbar { position: fixed; left: 50%; transform: translateX(-50%); bottom: 22px; z-index: 60; display: flex; align-items: center; gap: 16px; background: #1e2330; color: #fff; border-radius: 999px; padding: 10px 12px 10px 22px; box-shadow: 0 12px 36px rgba(28,25,22,0.34); }
  .cat-actionbar-count { font-size: 14px; color: rgba(255,255,255,0.82); white-space: nowrap; }
  .cat-actionbar-btn { font: inherit; font-size: 14px; font-weight: 600; color: #1e2330; background: #fff; border: none; border-radius: 999px; padding: 9px 20px; cursor: pointer; transition: opacity 0.15s; }
  .cat-actionbar-btn:hover:not(:disabled) { background: #f3f0ea; }
  .cat-actionbar-btn:disabled { opacity: 0.4; cursor: default; }

  /* MANAGEMENT — add / edit */
  .cat-head-right { display: flex; align-items: center; gap: 16px; }
  .cat-add-btn { font: inherit; font-size: 14px; font-weight: 600; color: #fff; background: #1e2330; border: 1px solid #1e2330; border-radius: 10px; padding: 10px 18px; cursor: pointer; transition: background 0.15s; white-space: nowrap; }
  .cat-add-btn:hover { background: #2c3446; }
  .cat-edit-btn { font: inherit; font-size: 14px; font-weight: 600; color: #1e2330; background: #f3f0ea; border: 1px solid #e4e0d8; border-radius: 10px; padding: 13px 24px; cursor: pointer; transition: background 0.15s; }
  .cat-edit-btn:hover { background: #ece8e0; }

  .cat-form-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; margin-bottom: 26px; flex-wrap: wrap; }
  .cat-form-head-actions { display: flex; gap: 10px; align-items: center; }
  .cat-form-cancel { flex: 0 0 auto; }
  .cat-form-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.2fr); gap: 40px; align-items: start; }
  @media (max-width: 860px) { .cat-form-grid { grid-template-columns: 1fr; gap: 24px; } }
  .cat-form-photo { display: flex; flex-direction: column; gap: 12px; position: sticky; top: 82px; }
  .cat-upload-btn { font: inherit; font-size: 14px; font-weight: 600; color: #1e2330; background: #fff; border: 1px solid #cbc4b5; border-radius: 10px; padding: 11px; cursor: pointer; transition: all 0.15s; }
  .cat-upload-btn:hover:not(:disabled) { border-color: #9A7209; color: #9A7209; }
  .cat-upload-btn:disabled { opacity: 0.6; cursor: default; }

  .cat-form-fields { display: flex; flex-direction: column; gap: 16px; }
  .cat-field-row { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  @media (max-width: 520px) { .cat-field-row { grid-template-columns: 1fr; } }
  .cat-field { display: flex; flex-direction: column; gap: 6px; }
  .cat-field > span { font-size: 12px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; color: #9a948a; }
  .cat-input { font: inherit; font-size: 15px; padding: 11px 13px; border: 1px solid #e4e0d8; border-radius: 9px; background: #fff; color: #2a2a2a; outline: none; transition: border-color 0.15s; width: 100%; box-sizing: border-box; }
  .cat-input:focus { border-color: #b8935a; }
  .cat-input::placeholder { color: #b3ada3; }
  .cat-textarea { resize: vertical; line-height: 1.55; }
  .cat-form-error { font-size: 13px; color: #9a4a40; background: #fbeceb; border: 1px solid #f0cfca; border-radius: 8px; padding: 9px 11px; }
`
