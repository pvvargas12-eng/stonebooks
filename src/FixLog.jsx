// =============================================================================
// FixLog — internal bug / request tracker (soft-launch triage)
// =============================================================================
// Staff file bugs / edits / build ideas / questions; the owner triages status +
// priority. QH palette + Fraunces header, no emojis. Deploy-safe — if the
// fix_log tables aren't applied yet the tab shows a "run the migration" note
// instead of crashing.
//
// Commit 2 of 3: list + filter chips + create modal + a read-only detail header.
// Commit 3 adds the unified timeline, the always-on comment box, and the
// owner-only triage controls.
// =============================================================================
import { useState, useEffect, useCallback } from 'react'
import {
  listFixItems, getFixItem, createFixItem,
  FIX_TYPES, FIX_PRIORITIES,
  fixTypeLabel, fixPriorityLabel, fixStatusLabel,
} from './lib/stonebooksData'

// Filter chips (top strip). Each maps to a listFixItems(filter) shape.
const FILTER_CHIPS = [
  { key: 'all',     label: 'All',           filter: {} },
  { key: 'new',     label: 'New',           filter: { status: 'new' } },
  { key: 'working', label: 'Working On It', filter: { status: 'working' } },
  { key: 'fixed',   label: 'Fixed',         filter: { status: 'fixed' } },
  { key: 'bugs',    label: 'Bugs',          filter: { type: 'bug' } },
  { key: 'ideas',   label: 'Build Ideas',   filter: { type: 'build_idea' } },
  { key: 'urgent',  label: 'Urgent',        filter: { priority: 'urgent' } },
]

// ── badge tone helpers ───────────────────────────────────────────────────────
const TONES = {
  red:     { color: 'var(--sb-red)',            background: 'var(--sb-red-bg)' },
  green:   { color: 'var(--sb-green)',          background: 'var(--sb-green-bg)' },
  amber:   { color: 'var(--sb-amber)',          background: 'var(--sb-amber-bg)' },
  blue:    { color: 'var(--sb-blue)',           background: 'var(--sb-blue-bg)' },
  muted:   { color: 'var(--sb-text-muted)',     background: 'var(--sb-surface-muted)' },
  neutral: { color: 'var(--sb-text-secondary)', background: 'var(--sb-surface-muted)' },
}
const statusTone = (s) => ({ new: 'blue', in_review: 'amber', working: 'blue', fixed: 'green', not_fixing: 'muted' }[s] || 'neutral')
const priorityTone = (p) => ({ urgent: 'red', high: 'amber', normal: 'neutral', low: 'muted' }[p] || 'neutral')

function Badge({ tone = 'neutral', children }) {
  return <span className="fl-badge" style={TONES[tone] || TONES.neutral}>{children}</span>
}

// Deterministic date formatting — `new Date(ts)` with an arg is pure (no bare
// new Date()/Date.now() in render, per the React 19 purity lint).
function fmtDate(ts) {
  if (!ts) return '—'
  try { return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) }
  catch { return '—' }
}
function fmtDateTime(ts) {
  if (!ts) return '—'
  try { return new Date(ts).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) }
  catch { return '—' }
}

// =============================================================================
// Create modal
// =============================================================================
function CreateFixModal({ defaultReporter, onClose, onCreated }) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [type, setType] = useState('bug')
  const [priority, setPriority] = useState('normal')
  const [reportedBy, setReportedBy] = useState(defaultReporter || '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const submit = async () => {
    if (!title.trim()) { setError('Enter a title.'); return }
    setSaving(true); setError('')
    const r = await createFixItem({ title, description, type, priority, reportedBy })
    setSaving(false)
    if (!r.ok) { setError(r.error || 'Could not create the item.'); return }
    onCreated(r.item)
  }

  return (
    <div className="fl-modal-backdrop" onClick={onClose}>
      <div className="fl-modal" onClick={(e) => e.stopPropagation()}>
        <div className="fl-modal-title">New Fix / Build Idea</div>

        <label className="fl-field">
          <span className="fl-field-label">Title</span>
          <input className="fl-input" value={title} autoFocus
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Short summary of the bug or idea" />
        </label>

        <label className="fl-field">
          <span className="fl-field-label">Description</span>
          <textarea className="fl-input fl-textarea" value={description} rows={4}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What happened, where, and what you expected (optional)" />
        </label>

        <div className="fl-field-row">
          <label className="fl-field">
            <span className="fl-field-label">Type</span>
            <select className="fl-input" value={type} onChange={(e) => setType(e.target.value)}>
              {FIX_TYPES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
          <label className="fl-field">
            <span className="fl-field-label">Priority</span>
            <select className="fl-input" value={priority} onChange={(e) => setPriority(e.target.value)}>
              {FIX_PRIORITIES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
        </div>

        <label className="fl-field">
          <span className="fl-field-label">Reported by</span>
          <input className="fl-input" value={reportedBy}
            onChange={(e) => setReportedBy(e.target.value)} placeholder="Your name" />
        </label>

        {error && <div className="fl-error">{error}</div>}

        <div className="fl-modal-actions">
          <button type="button" className="fl-btn-ghost" onClick={onClose} disabled={saving}>Cancel</button>
          <button type="button" className="fl-btn" onClick={submit} disabled={saving}>
            {saving ? 'Creating…' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  )
}

// =============================================================================
// Detail (read-only header — commit 2; timeline + triage arrive in commit 3)
// =============================================================================
function FixDetail({ id, onBack }) {
  const [item, setItem] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    const r = await getFixItem(id)
    setLoading(false)
    if (!r.ok) { setError(r.needsMigration ? 'migration' : (r.error || 'Could not load this item.')); return }
    setItem(r.item)
  }, [id])

  useEffect(() => { load() }, [load])

  if (loading) return <div className="fl-empty">Loading…</div>
  if (error === 'migration') return <MigrationNote />
  if (error) return <div className="fl-empty">{error}</div>
  if (!item) return <div className="fl-empty">Item not found.</div>

  return (
    <div className="fl-detail">
      <button type="button" className="fl-back" onClick={onBack}>← Back to Fix Log</button>

      <div className="fl-detail-head">
        <h2 className="fl-detail-title">{item.title}</h2>
        <div className="fl-badge-row">
          <Badge tone="neutral">{fixTypeLabel(item.type)}</Badge>
          <Badge tone={priorityTone(item.priority)}>{fixPriorityLabel(item.priority)}</Badge>
          <Badge tone={statusTone(item.status)}>{fixStatusLabel(item.status)}</Badge>
        </div>
        <div className="fl-detail-meta">
          Reported by {item.reported_by || 'Unknown'} · Created {fmtDateTime(item.created_at)} · Updated {fmtDateTime(item.updated_at)}
        </div>
      </div>

      {item.description && <div className="fl-detail-desc">{item.description}</div>}
    </div>
  )
}

function MigrationNote() {
  return (
    <div className="fl-empty">
      <div style={{ fontWeight: 600, marginBottom: 6 }}>The Fix Log isn’t set up yet.</div>
      <div>Apply the <code>20260608_fix_log</code> migration in Supabase Studio, then reload this tab.</div>
    </div>
  )
}

// =============================================================================
// Main tab
// =============================================================================
export default function FixLog({ user, profile, isOwner = false }) {
  const [chip, setChip] = useState('all')
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [needsMigration, setNeedsMigration] = useState(false)
  const [error, setError] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [selectedId, setSelectedId] = useState(null)

  const reporter = profile?.display_name || user?.email || ''
  const activeFilter = (FILTER_CHIPS.find(c => c.key === chip) || FILTER_CHIPS[0]).filter

  const load = useCallback(async () => {
    setLoading(true); setError('')
    const r = await listFixItems(activeFilter)
    setLoading(false)
    if (r.needsMigration) { setNeedsMigration(true); setItems([]); return }
    setNeedsMigration(false)
    if (!r.ok) { setError(r.error || 'Could not load the Fix Log.'); setItems([]); return }
    setItems(r.items)
  }, [chip]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load() }, [load])

  // Detail view replaces the list (in-tab, no route).
  if (selectedId) {
    return (
      <div className="fl-wrap">
        <FixLogStyles />
        <FixDetail id={selectedId} onBack={() => { setSelectedId(null); load() }} />
      </div>
    )
  }

  return (
    <div className="fl-wrap">
      <FixLogStyles />

      <div className="fl-header">
        <div>
          <h1 className="fl-title">Fix Log</h1>
          <div className="fl-subtitle">Bugs, edits, and build ideas — triaged for the soft launch.</div>
        </div>
        <button type="button" className="fl-btn" onClick={() => setShowCreate(true)}>New Fix / Build Idea</button>
      </div>

      <div className="fl-chips">
        {FILTER_CHIPS.map(c => (
          <button key={c.key} type="button"
            className={`fl-chip ${chip === c.key ? 'on' : ''}`}
            onClick={() => setChip(c.key)}>{c.label}</button>
        ))}
      </div>

      {needsMigration ? <MigrationNote />
        : loading ? <div className="fl-empty">Loading…</div>
        : error ? <div className="fl-empty">{error}</div>
        : items.length === 0 ? <div className="fl-empty">Nothing here yet. Use “New Fix / Build Idea” to add the first item.</div>
        : (
          <div className="fl-table-wrap">
            <table className="fl-table">
              <thead>
                <tr>
                  <th>Title</th><th>Type</th><th>Priority</th><th>Status</th>
                  <th>Reported By</th><th>Created</th><th>Last updated</th>
                </tr>
              </thead>
              <tbody>
                {items.map(it => (
                  <tr key={it.id} className="fl-row" onClick={() => setSelectedId(it.id)}>
                    <td className="fl-cell-title">{it.title}</td>
                    <td><Badge tone="neutral">{fixTypeLabel(it.type)}</Badge></td>
                    <td><Badge tone={priorityTone(it.priority)}>{fixPriorityLabel(it.priority)}</Badge></td>
                    <td><Badge tone={statusTone(it.status)}>{fixStatusLabel(it.status)}</Badge></td>
                    <td className="fl-cell-muted">{it.reported_by || '—'}</td>
                    <td className="fl-cell-muted">{fmtDate(it.created_at)}</td>
                    <td className="fl-cell-muted">{fmtDate(it.updated_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

      {showCreate && (
        <CreateFixModal
          defaultReporter={reporter}
          onClose={() => setShowCreate(false)}
          onCreated={(item) => { setShowCreate(false); load(); if (item?.id) setSelectedId(item.id) }}
        />
      )}
    </div>
  )
}

// Scoped styles — QH palette via CSS vars, Fraunces title.
function FixLogStyles() {
  return (
    <style>{`
      .fl-wrap { padding: 28px 32px 48px; max-width: 1180px; margin: 0 auto; color: var(--sb-text); }
      .fl-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 20px; }
      .fl-title { font-family: var(--sb-font-display); font-size: 32px; font-weight: 600; margin: 0 0 4px; color: var(--sb-text); }
      .fl-subtitle { font-size: 15px; color: var(--sb-text-secondary); }
      .fl-btn { background: var(--sb-accent); color: #fff; border: none; border-radius: var(--sb-r-md); padding: 10px 16px; font: inherit; font-weight: 600; font-size: 14px; cursor: pointer; white-space: nowrap; }
      .fl-btn:hover { background: var(--sb-accent-hover); }
      .fl-btn:disabled { opacity: 0.6; cursor: default; }
      .fl-btn-ghost { background: transparent; color: var(--sb-text-secondary); border: 0.5px solid var(--sb-border); border-radius: var(--sb-r-md); padding: 10px 16px; font: inherit; font-size: 14px; cursor: pointer; }
      .fl-btn-ghost:hover { border-color: var(--sb-border-hover); }

      .fl-chips { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 18px; }
      .fl-chip { background: var(--sb-surface); color: var(--sb-text-secondary); border: 0.5px solid var(--sb-border); border-radius: var(--sb-r-full); padding: 6px 14px; font: inherit; font-size: 14px; cursor: pointer; }
      .fl-chip:hover { border-color: var(--sb-border-hover); }
      .fl-chip.on { background: var(--sb-accent-bg); color: var(--sb-accent); border-color: var(--sb-accent); font-weight: 600; }

      .fl-table-wrap { background: var(--sb-surface); border: 0.5px solid var(--sb-border); border-radius: var(--sb-r-lg); overflow: hidden; }
      .fl-table { width: 100%; border-collapse: collapse; font-size: 15px; }
      .fl-table thead th { text-align: left; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; color: var(--sb-text-muted); padding: 12px 14px; border-bottom: 0.5px solid var(--sb-border); background: var(--sb-surface-muted); }
      .fl-table td { padding: 13px 14px; border-bottom: 0.5px solid var(--sb-border); vertical-align: middle; }
      .fl-table tbody tr:last-child td { border-bottom: none; }
      .fl-row { cursor: pointer; }
      .fl-row:hover td { background: var(--sb-surface-muted); }
      .fl-cell-title { font-weight: 600; color: var(--sb-text); max-width: 420px; }
      .fl-cell-muted { color: var(--sb-text-secondary); font-size: 14px; white-space: nowrap; }

      .fl-badge { display: inline-block; padding: 3px 9px; border-radius: var(--sb-r-full); font-size: 12px; font-weight: 600; white-space: nowrap; }
      .fl-badge-row { display: flex; gap: 8px; flex-wrap: wrap; margin: 8px 0; }

      .fl-empty { background: var(--sb-surface); border: 0.5px dashed var(--sb-border); border-radius: var(--sb-r-lg); padding: 32px; text-align: center; color: var(--sb-text-secondary); font-size: 15px; }
      .fl-empty code { font-family: var(--sb-font-mono); font-size: 13px; background: var(--sb-surface-muted); padding: 1px 6px; border-radius: 4px; }

      .fl-modal-backdrop { position: fixed; inset: 0; background: rgba(20,16,10,0.4); z-index: 1000; display: flex; align-items: center; justify-content: center; padding: 24px; }
      .fl-modal { background: var(--sb-surface); border-radius: var(--sb-r-lg); border: 0.5px solid var(--sb-border); padding: 24px; width: 100%; max-width: 520px; box-shadow: 0 12px 40px rgba(15,20,25,0.18); max-height: 90vh; overflow-y: auto; }
      .fl-modal-title { font-family: var(--sb-font-display); font-size: 22px; font-weight: 600; margin-bottom: 18px; color: var(--sb-text); }
      .fl-field { display: block; margin-bottom: 14px; }
      .fl-field-row { display: flex; gap: 14px; }
      .fl-field-row .fl-field { flex: 1; }
      .fl-field-label { display: block; font-size: 13px; font-weight: 600; color: var(--sb-text-secondary); margin-bottom: 5px; }
      .fl-input { width: 100%; box-sizing: border-box; padding: 9px 11px; border: 0.5px solid var(--sb-border-hover); border-radius: var(--sb-r-md); font: inherit; font-size: 15px; color: var(--sb-text); background: var(--sb-bg); }
      .fl-input:focus { outline: none; border-color: var(--sb-border-focus); }
      .fl-textarea { resize: vertical; min-height: 80px; }
      .fl-error { color: var(--sb-red); font-size: 14px; margin: 4px 0 10px; }
      .fl-modal-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 8px; }

      .fl-detail { }
      .fl-back { background: none; border: none; color: var(--sb-accent); font: inherit; font-size: 14px; cursor: pointer; padding: 0; margin-bottom: 18px; }
      .fl-back:hover { text-decoration: underline; }
      .fl-detail-head { border-bottom: 0.5px solid var(--sb-border); padding-bottom: 16px; margin-bottom: 18px; }
      .fl-detail-title { font-family: var(--sb-font-display); font-size: 26px; font-weight: 600; margin: 0; color: var(--sb-text); }
      .fl-detail-meta { font-size: 14px; color: var(--sb-text-muted); }
      .fl-detail-desc { font-size: 16px; line-height: 1.6; color: var(--sb-text); white-space: pre-wrap; margin-bottom: 24px; }
    `}</style>
  )
}
