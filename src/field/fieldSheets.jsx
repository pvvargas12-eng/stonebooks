// =============================================================================
// fieldSheets — bottom sheets for the phone app: New task + photo Capture
// =============================================================================
// NewTaskSheet: quick task capture (title, person-or-department chip, due).
// CaptureSheet: a photo just taken via the center camera button — attach it to
// one of MY open tasks, or spin up a new task carrying the photo.
// Every write is optimistic-ish: close the sheet, offer UNDO via the toast.
// =============================================================================
import { useState, useEffect, useMemo } from 'react'
import { addShopTask, deleteShopTask, listShopTasks, updateShopTask, uploadTaskAttachment } from '../lib/stonebooksData'
import { getActiveEmployees, DEPARTMENTS } from '../lib/employees'
import { toneCls, todayISO } from './fieldShared'

const CHIP_ROW = { display: 'flex', flexWrap: 'wrap', gap: 8 }

// Precomputed off-render (inside the load effect) so no bare date math ever
// runs in a render body.
function dueChip(iso, today) {
  if (!iso) return null
  if (iso < today) return { label: 'OVERDUE', tone: 'bad' }
  if (iso === today) return { label: 'DUE TODAY', tone: 'warn' }
  const d = new Date(String(iso).slice(0, 10) + 'T00:00:00')
  if (isNaN(d.getTime())) return { label: iso, tone: 'neutral' }
  return { label: d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }).toUpperCase(), tone: 'neutral' }
}

// ── New task ─────────────────────────────────────────────────────────────────

export function NewTaskSheet({ who, undo, onClose, onChanged }) {
  const [title, setTitle] = useState('')
  const [sel, setSel] = useState(() => ({ assignee: who?.name || '', kind: 'person' }))
  const [due, setDue] = useState('')
  const [busy, setBusy] = useState(false)
  const people = useMemo(() => getActiveEmployees().map(r => r.name), [])

  const create = async () => {
    const t = title.trim()
    if (!t || !sel.assignee || busy) return
    setBusy(true)
    const res = await addShopTask({
      title: t,
      assignee: sel.assignee,
      assigneeKind: sel.kind,
      dueDate: due || null,
      createdBy: who?.name || null,
      taskedBy: who?.name || null,
      taskType: 'general',
    })
    setBusy(false)
    if (!res.ok) { undo.showError(res.error || 'Could not create the task.'); return }
    onClose()
    if (onChanged) onChanged()
    undo.show(`Task created — ${sel.assignee}`, async () => {
      await deleteShopTask(res.task.id, who?.name || null).catch(() => {})
      if (onChanged) onChanged()
    })
  }

  return (
    <>
      <div className="fl-sheet-scrim" onClick={onClose} />
      <div className="fl-sheet">
        <div className="fl-sheet-grab" />
        <div className="fl-sheet-title">New task</div>

        <input className="fl-input" autoFocus placeholder="What needs doing?"
          value={title} onChange={e => setTitle(e.target.value)} />

        <div className="fl-label">Assign to</div>
        <div style={CHIP_ROW}>
          {people.map(name => (
            <button key={name} type="button"
              className={`fl-chip-btn${sel.kind === 'person' && sel.assignee === name ? ' on' : ''}`}
              onClick={() => setSel({ assignee: name, kind: 'person' })}>
              {name}
            </button>
          ))}
        </div>

        <div className="fl-label">Or a department</div>
        <div style={CHIP_ROW}>
          {DEPARTMENTS.map(dept => (
            <button key={dept} type="button"
              className={`fl-chip-btn${sel.kind === 'department' && sel.assignee === dept ? ' on' : ''}`}
              onClick={() => setSel({ assignee: dept, kind: 'department' })}>
              {dept}
            </button>
          ))}
        </div>

        <div className="fl-label">Due</div>
        <input type="date" className="fl-input" value={due} onChange={e => setDue(e.target.value)} />

        <div style={{ display: 'flex', gap: 8, marginTop: 18 }}>
          <button type="button" className="fl-btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className="fl-btn-gold" onClick={create} disabled={busy || !title.trim()}>
            {busy ? 'Saving…' : 'Create'}
          </button>
        </div>
      </div>
    </>
  )
}

// ── Capture — attach the photo just taken ────────────────────────────────────

export function CaptureSheet({ who, undo, file, onClose, onChanged }) {
  const [preview, setPreview] = useState(null)
  const [tasks, setTasks] = useState(null)      // null = loading, [] = none of mine
  const [busyId, setBusyId] = useState(null)    // task id mid-upload
  const [newOpen, setNewOpen] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    if (!file) return undefined
    const url = URL.createObjectURL(file)
    let cancelled = false
    Promise.resolve().then(() => { if (!cancelled) setPreview(url) })
    return () => { cancelled = true; URL.revokeObjectURL(url) }
  }, [file])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const rows = await listShopTasks().catch(() => [])
      if (cancelled) return
      const today = todayISO()
      const mine = (rows || []).filter(t =>
        t.status !== 'done' &&
        ((t.assignee_kind === 'person' && t.assignee === who?.name) ||
         (t.assignee_kind === 'department' && who?.department && t.assignee === who.department)))
      setTasks(mine.map(t => ({ ...t, _due: dueChip(t.due_date, today) })))
    })()
    return () => { cancelled = true }
  }, [who])

  const attachTo = async (t) => {
    if (busyId || creating) return
    setBusyId(t.id)
    const up = await uploadTaskAttachment({ taskId: t.id, orderId: t.order_id || null }, file)
    if (!up.ok) { setBusyId(null); undo.showError(up.error || 'Could not upload the photo.'); return }
    const entry = { name: up.name, url: up.url, path: up.path }
    const res = await updateShopTask(t.id, { attachments: [...(t.attachments || []), entry] })
    setBusyId(null)
    if (!res.ok) { undo.showError(res.error || 'Could not attach the photo.'); return }
    const after = res.task?.attachments || []
    onClose()
    if (onChanged) onChanged()
    undo.show(`Photo attached — ${String(t.title || '').slice(0, 40)}`, async () => {
      await updateShopTask(t.id, { attachments: after.filter(a => a?.path !== entry.path) }).catch(() => {})
      if (onChanged) onChanged()
    })
  }

  const createWithPhoto = async () => {
    const t = newTitle.trim()
    if (!t || creating || busyId) return
    setCreating(true)
    const made = await addShopTask({
      title: t, assignee: who?.name, assigneeKind: 'person',
      createdBy: who?.name, taskedBy: who?.name,
    })
    if (!made.ok) { setCreating(false); undo.showError(made.error || 'Could not create the task.'); return }
    const task = made.task
    const up = await uploadTaskAttachment({ taskId: task.id, orderId: null }, file)
    const att = up.ok
      ? await updateShopTask(task.id, { attachments: [{ name: up.name, url: up.url, path: up.path }] })
      : null
    if (!up.ok || !att?.ok) {
      // Roll the fresh task back so a retry doesn't leave duplicates behind.
      await deleteShopTask(task.id, who?.name || null).catch(() => {})
      setCreating(false)
      undo.showError(up.ok
        ? (att?.error || 'Could not attach the photo.')
        : (up.error || 'Could not upload the photo.'))
      return
    }
    setCreating(false)
    onClose()
    if (onChanged) onChanged()
    undo.show(`Task created — ${t.slice(0, 40)}`, async () => {
      await deleteShopTask(task.id, who?.name || null).catch(() => {})
      if (onChanged) onChanged()
    })
  }

  return (
    <>
      <div className="fl-sheet-scrim" onClick={onClose} />
      <div className="fl-sheet">
        <div className="fl-sheet-grab" />
        {preview && (
          <img src={preview} alt="Captured photo"
            style={{ width: 96, height: 96, objectFit: 'cover', borderRadius: 14, display: 'block', marginBottom: 12 }} />
        )}
        <div className="fl-sheet-title">Attach to</div>

        {tasks === null && <div className="fl-empty">Loading your tasks…</div>}
        {tasks && tasks.length === 0 && <div className="fl-empty">No open tasks with your name on them.</div>}
        {tasks && tasks.map(t => (
          <button key={t.id} type="button" className="fl-rowline"
            disabled={!!busyId || creating} onClick={() => attachTo(t)}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14.5, fontWeight: 700, color: '#16150F', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {t.title}
              </div>
              {t.order?.primary_lastname && (
                <div className="fl-cem">{String(t.order.primary_lastname).toUpperCase()}</div>
              )}
            </div>
            {busyId === t.id
              ? <span className="fl-chip fl-c-info">UPLOADING…</span>
              : (t._due && <span className={`fl-chip ${toneCls(t._due.tone)}`}>{t._due.label}</span>)}
          </button>
        ))}

        <div className="fl-label">Or</div>
        {newOpen ? (
          <>
            <input className="fl-input" autoFocus placeholder="What needs doing?"
              value={newTitle} onChange={e => setNewTitle(e.target.value)} />
            <button type="button" className="fl-btn-gold" style={{ marginTop: 10 }}
              onClick={createWithPhoto} disabled={creating || !newTitle.trim()}>
              {creating ? 'Uploading…' : 'Create'}
            </button>
          </>
        ) : (
          <button type="button" className="fl-btn-ghost"
            onClick={() => setNewOpen(true)} disabled={!!busyId}>
            New task with this photo
          </button>
        )}
      </div>
    </>
  )
}
