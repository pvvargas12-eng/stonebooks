// =============================================================================
// TasksScreen — the full task list + task detail (FIELD-2)
// =============================================================================
// Mine / Everyone / Done over listShopTasks(); reply threads + photo
// attachments per task. Every write is optimistic with the 8s UNDO; failures
// revert the local state and surface the red toast. The detail view lives in
// this file (internal selectedId) so the list state survives the drill.
// =============================================================================
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  listShopTasks, listTaskReplies, addTaskReply,
  setShopTaskDone, setShopTaskStatus, updateShopTask, uploadTaskAttachment,
} from '../lib/stonebooksData'
import { fmtDayLabel, todayISO } from './fieldShared'
import CompletionEmailModal from '../components/CompletionEmailModal'

const SAVE_ERR = 'Could not save — try again.'
const SEGS = [['mine', 'Mine'], ['everyone', 'Everyone'], ['done', 'Done']]
const STATUS_CHIP = { open: 'fl-c-neutral', pending: 'fl-c-warn', done: 'fl-c-good' }
const CHECK_SHOT_LIST = ['Cemetery sign', 'Section or lot marker', 'Existing stone, all sides', 'Base measurements']

// The uniform MY-TASKS rule: direct assignment or my department's queue.
const isMine = (t, who) =>
  (t.assignee_kind === 'person' && t.assignee === who.name) ||
  (t.assignee_kind === 'department' && !!who.department && t.assignee === who.department)

const shortDate = (iso) => {
  if (!iso) return ''
  const parts = String(iso).slice(0, 10).split('-')
  return `${parseInt(parts[1], 10)}/${parseInt(parts[2], 10)}`
}

// '{M/D h:mm}' stamp for reply rows — deterministic from the stored timestamp.
const replyStamp = (iso) => {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  let h = d.getHours()
  const ap = h >= 12 ? 'pm' : 'am'
  h = h % 12 || 12
  return `${d.getMonth() + 1}/${d.getDate()} ${h}:${String(d.getMinutes()).padStart(2, '0')}${ap}`
}

const typeChipCls = (code) => (code === 'check_job' ? 'fl-c-info' : 'fl-c-neutral')
const typeLabel = (code) => String(code || '').replace(/_/g, ' ').toUpperCase()

// Due chip per row. Snoozed tasks read as SNOOZED, not overdue — the snooze
// keeps them out of the pressure read until the date comes back around.
function dueChip(t, today) {
  if (t.snoozed_until && String(t.snoozed_until).slice(0, 10) > today) {
    return { label: `SNOOZED ${shortDate(t.snoozed_until)}`, cls: 'fl-c-neutral' }
  }
  if (!t.due_date) return null
  if (t.status === 'done') return { label: `DUE ${shortDate(t.due_date)}`, cls: 'fl-c-neutral' }
  if (t.due_date < today) return { label: `OVERDUE ${shortDate(t.due_date)}`, cls: 'fl-c-bad' }
  if (t.due_date === today) return { label: 'DUE TODAY', cls: 'fl-c-warn' }
  return { label: `DUE ${shortDate(t.due_date)}`, cls: 'fl-c-neutral' }
}

const CheckGlyph = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round"><path d="M4.5 12.5 l5 5 L19.5 7" /></svg>
)
const CamGlyph = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 8 h3 l2-2.5 h6 L17 8 h3 v11 H4 z" /><circle cx="12" cy="13" r="3.5" /></svg>
)

export default function TasksScreen({ who, undo, onOpenJob, focusTaskId, onFocusConsumed, onNewTask, refreshKey = 0 }) {
  const [tasks, setTasks] = useState(null)      // null = loading
  const [replies, setReplies] = useState({})    // task_id -> [reply rows]
  const [err, setErr] = useState(null)
  const [seg, setSeg] = useState('mine')
  // FieldApp mounts this screen fresh whenever the Tasks tab opens (a drill or
  // another tab is showing at the moment taskFocus gets set), so the deep-link
  // is applied once here at mount and released in the effect below.
  const [selectedId, setSelectedId] = useState(() => focusTaskId || null)
  const today = useMemo(() => todayISO(), [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        // 30-day done window matches the Check-jobs queue (WorkHub deep-links
        // completed check jobs up to 30 days back).
        const rows = await listShopTasks({ doneWithinDays: 30 })
        if (cancelled) return
        setTasks(rows || [])
        const reps = await listTaskReplies((rows || []).map(t => t.id))
        if (cancelled) return
        const by = {}
        for (const r of reps || []) {
          if (!by[r.task_id]) by[r.task_id] = []
          by[r.task_id].push(r)
        }
        setReplies(by)
      } catch (e) {
        if (!cancelled) setErr(e?.message || 'Could not load tasks.')
      }
    })()
    return () => { cancelled = true }
  }, [refreshKey])

  // Deep-link from Today / the tab badge. The screen can already be mounted
  // (hidden during a drill, or the user is on the list) — apply the focus
  // explicitly rather than relying on the mount initializer, then release it.
  useEffect(() => {
    if (focusTaskId) {
      setSelectedId(focusTaskId)
      if (onFocusConsumed) onFocusConsumed()
    }
  }, [focusTaskId, onFocusConsumed])

  const patchTask = useCallback((id, patch) => {
    setTasks(list => (list || []).map(t => (t.id === id ? { ...t, ...patch } : t)))
  }, [])

  const mutateReplies = useCallback((taskId, fn) => {
    setReplies(by => ({ ...by, [taskId]: fn(by[taskId] || []) }))
  }, [])

  // ── Mutations — optimistic, undoable, revert-on-failure ────────────────────
  const markDone = useCallback(async (t) => {
    if (t.status === 'done') return
    const prev = { status: t.status, done_at: t.done_at, done_by: t.done_by }
    patchTask(t.id, { status: 'done', done_at: new Date().toISOString(), done_by: who.name })
    const res = await setShopTaskDone(t.id, true, who.name)
    if (!res.ok) { patchTask(t.id, prev); undo.showError(SAVE_ERR); return }
    undo.show(`Done — ${t.title}`, async () => {
      const back = prev.status === 'pending' ? 'pending' : 'open'
      const r = await setShopTaskStatus(t.id, back)
      if (r.ok) patchTask(t.id, { status: back, done_at: null, done_by: null })
      else undo.showError(SAVE_ERR)
    })
  }, [patchTask, undo, who.name])

  const unDone = useCallback(async (t) => {
    if (t.status !== 'done') return
    const prev = { status: 'done', done_at: t.done_at, done_by: t.done_by }
    patchTask(t.id, { status: 'open', done_at: null, done_by: null })
    const res = await setShopTaskDone(t.id, false)
    if (!res.ok) { patchTask(t.id, prev); undo.showError(SAVE_ERR); return }
    undo.show(`Reopened — ${t.title}`, async () => {
      const r = await setShopTaskDone(t.id, true, prev.done_by || who.name)
      if (r.ok) patchTask(t.id, prev)
      else undo.showError(SAVE_ERR)
    })
  }, [patchTask, undo, who.name])

  const togglePending = useCallback(async (t) => {
    if (t.status === 'done') return
    const next = t.status === 'pending' ? 'open' : 'pending'
    const prev = t.status
    patchTask(t.id, { status: next })
    const res = await setShopTaskStatus(t.id, next, who.name)
    if (!res.ok) { patchTask(t.id, { status: prev }); undo.showError(SAVE_ERR); return }
    undo.show(next === 'pending' ? `Pending — ${t.title}` : `Reopened — ${t.title}`, async () => {
      const r = await setShopTaskStatus(t.id, prev, who.name)
      if (r.ok) patchTask(t.id, { status: prev })
      else undo.showError(SAVE_ERR)
    })
  }, [patchTask, undo, who.name])

  const visible = useMemo(() => {
    const list = tasks || []
    if (seg === 'done') {
      return list.filter(t => t.status === 'done')
        .slice().sort((a, z) => String(z.done_at || '').localeCompare(String(a.done_at || '')))
    }
    const open = list.filter(t => t.status === 'open' || t.status === 'pending')
    return seg === 'mine' ? open.filter(t => isMine(t, who)) : open
  }, [tasks, seg, who])

  if (err) return <div className="fl-empty">{err}</div>
  if (tasks === null) return <div className="fl-empty">Loading tasks…</div>

  const selected = selectedId ? tasks.find(t => t.id === selectedId) : null
  if (selected) {
    return (
      <TaskDetail task={selected} thread={replies[selected.id] || []} who={who} undo={undo}
        today={today} onBack={() => setSelectedId(null)} onOpenJob={onOpenJob}
        onMarkDone={markDone} onUnDone={unDone} onTogglePending={togglePending}
        onPatchTask={patchTask} mutateReplies={mutateReplies} />
    )
  }

  return (
    <div>
      <div className="fl-sect" style={{ margin: '2px 2px 12px' }}>
        <div className="fl-sect-h" style={{ fontSize: 26 }}>Tasks</div>
        <div className="fl-sect-spacer" />
        {onNewTask && <button type="button" className="fl-sect-see" onClick={onNewTask}>+ New task</button>}
      </div>

      <div className="fl-seg">
        {SEGS.map(([k, label]) => (
          <button key={k} type="button" className={seg === k ? 'on' : ''} onClick={() => setSeg(k)}>{label}</button>
        ))}
      </div>

      {visible.length === 0 ? (
        <div className="fl-empty-serif">Nothing here.</div>
      ) : (
        <div className="fl-row" style={{ cursor: 'default', padding: '2px 14px' }}>
          {visible.map(t => (
            <TaskRow key={t.id} t={t} who={who} thread={replies[t.id] || []} today={today}
              onToggle={(task) => (task.status === 'done' ? unDone(task) : markDone(task))}
              onOpen={(id) => setSelectedId(id)} />
          ))}
        </div>
      )}
    </div>
  )
}

// ── One list row — check circle, title, meta chips ───────────────────────────
function TaskRow({ t, who, thread, today, onToggle, onOpen }) {
  const done = t.status === 'done'
  const due = dueChip(t, today)
  const replyCount = thread.length
  const newCount = thread.filter(r => !r.handled_at && r.author !== who.name).length
  return (
    <div className="fl-rowline" onClick={() => onOpen(t.id)}>
      <button type="button" className={`fl-check${done ? ' done' : ''}`}
        aria-label={done ? 'Reopen task' : 'Mark done'}
        onClick={e => { e.stopPropagation(); onToggle(t) }}>
        {done && <CheckGlyph />}
      </button>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className={done ? 'fl-task-done' : ''}
          style={{ fontSize: 15, fontWeight: 700, color: '#16150F', lineHeight: 1.3 }}>{t.title}</div>
        <div className="fl-chips" style={{ marginTop: 5 }}>
          {(t.tasked_by || t.created_by) && (
            <span style={{ fontSize: 11.5, fontWeight: 600, color: '#8A7F6C' }}>{t.tasked_by || t.created_by}</span>
          )}
          {due && <span className={`fl-chip ${due.cls}`}>{due.label}</span>}
          {t.task_type && t.task_type !== 'general' && (
            <span className={`fl-chip ${typeChipCls(t.task_type)}`}>{typeLabel(t.task_type)}</span>
          )}
          {newCount > 0
            ? <span className="fl-chip fl-c-warn">{newCount} NEW</span>
            : (replyCount > 0 && <span className="fl-chip fl-c-neutral">{replyCount} {replyCount === 1 ? 'reply' : 'replies'}</span>)}
        </div>
      </div>
      <span className="fl-chev">›</span>
    </div>
  )
}

function MetaRow({ label, value }) {
  return (
    <div className="fl-rowline" style={{ cursor: 'default', minHeight: 44 }}>
      <span style={{ fontSize: 12.5, fontWeight: 700, color: '#8A7F6C', width: 92, flexShrink: 0 }}>{label}</span>
      <span style={{ fontSize: 14, fontWeight: 600, color: '#16150F' }}>{value}</span>
    </div>
  )
}

// ── Task detail — chips, meta, actions, thread, composer ─────────────────────
function TaskDetail({ task: t, thread, who, undo, today, onBack, onOpenJob, onMarkDone, onUnDone, onTogglePending, onPatchTask, mutateReplies }) {
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [emailOpen, setEmailOpen] = useState(false)
  const due = dueChip(t, today)
  const isCheckJob = t.task_type === 'check_job'
  const isCloseout = t.task_type === 'closeout' || t.details?.auto === 'install_completed'
  const atts = Array.isArray(t.attachments) ? t.attachments : []
  const done = t.status === 'done'

  const send = async () => {
    const text = draft.trim()
    if (!text || sending) return
    setSending(true)
    setDraft('')
    const temp = {
      id: `temp-${Date.now()}`, task_id: t.id, body: text, author: who.name,
      created_at: new Date().toISOString(), handled_at: null,
    }
    mutateReplies(t.id, list => [...list, temp])
    const res = await addTaskReply(t.id, text, who.name)
    setSending(false)
    if (!res.ok) {
      mutateReplies(t.id, list => list.filter(r => r.id !== temp.id))
      setDraft(text)
      undo.showError(SAVE_ERR)
      return
    }
    mutateReplies(t.id, list => list.map(r => (r.id === temp.id ? res.reply : r)))
  }

  const pickPhoto = async (file) => {
    if (!file || uploading) return
    setUploading(true)
    const up = await uploadTaskAttachment({ taskId: t.id, orderId: t.order_id }, file)
    if (!up.ok) { setUploading(false); undo.showError('Could not upload — try again.'); return }
    const prevAtts = Array.isArray(t.attachments) ? t.attachments : []
    const nextAtts = [...prevAtts, { name: up.name, url: up.url, path: up.path }]
    onPatchTask(t.id, { attachments: nextAtts })
    const res = await updateShopTask(t.id, { attachments: nextAtts })
    setUploading(false)
    if (!res.ok) {
      onPatchTask(t.id, { attachments: prevAtts })
      undo.showError(SAVE_ERR)
      return
    }
    undo.show('Photo attached', async () => {
      const r = await updateShopTask(t.id, { attachments: prevAtts })
      if (r.ok) onPatchTask(t.id, { attachments: prevAtts })
      else undo.showError(SAVE_ERR)
    })
  }

  const onFilePick = (e) => {
    const f = e.target.files && e.target.files[0]
    e.target.value = ''
    if (f) pickPhoto(f)
  }

  return (
    <div>
      <button type="button" className="fl-rowline" onClick={onBack} style={{ minHeight: 48 }}>
        <span className="fl-chev" style={{ fontSize: 20 }}>‹</span>
        <span style={{ fontSize: 14.5, fontWeight: 700, color: '#16150F' }}>Tasks</span>
      </button>

      <div className="fl-sect" style={{ margin: '12px 2px 8px' }}>
        <div className="fl-sect-h" style={{ fontSize: 24 }}>{t.title}</div>
      </div>

      <div className="fl-chips" style={{ marginTop: 0, marginBottom: 12 }}>
        <span className={`fl-chip ${STATUS_CHIP[t.status] || 'fl-c-neutral'}`}>{String(t.status || 'open').toUpperCase()}</span>
        {due && <span className={`fl-chip ${due.cls}`}>{due.label}</span>}
        {t.task_type && t.task_type !== 'general' && (
          <span className={`fl-chip ${typeChipCls(t.task_type)}`}>{typeLabel(t.task_type)}</span>
        )}
        {t.order && (
          <button type="button" className="fl-chip fl-c-info"
            style={{ border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}
            onClick={() => onOpenJob({ orderId: t.order_id, jobId: null }, 'tasks')}>
            {t.order.order_number} · {String(t.order.primary_lastname || '—').toUpperCase()}
          </button>
        )}
      </div>

      <div className="fl-thread">
        <MetaRow label="Tasked by" value={t.tasked_by || t.created_by || '—'} />
        <MetaRow label="Assigned to" value={`${t.assignee || '—'} (${t.assignee_kind === 'department' ? 'department' : 'person'})`} />
        <MetaRow label="Due" value={t.due_date ? fmtDayLabel(t.due_date) : 'No due date'} />
      </div>

      {isCheckJob && (
        <div className="fl-row" style={{ cursor: 'default' }}>
          <div className="fl-fam" style={{ fontSize: 14.5 }}>What to shoot</div>
          {t.details?.cemeteryName && <div className="fl-cem">{t.details.cemeteryName}</div>}
          <div style={{ fontSize: 13.5, color: '#55503F', fontWeight: 600, marginTop: 7, lineHeight: 1.75 }}>
            {CHECK_SHOT_LIST.map(line => <div key={line}>· {line}</div>)}
          </div>
          <label className="fl-btn-gold" style={{ marginTop: 12 }}>
            {uploading ? 'Uploading…' : 'Add photos'}
            <input type="file" accept="image/*" capture="environment" style={{ display: 'none' }}
              onChange={onFilePick} disabled={uploading} />
          </label>
        </div>
      )}

      {isCloseout && t.order_id && (
        <button type="button" className="fl-btn fl-btn-green" onClick={() => setEmailOpen(true)}>
          {t.details?.completionEmailSentAt ? 'Completion email sent — resend' : 'Preview completion email'}
        </button>
      )}
      {emailOpen && (
        <CompletionEmailModal task={t} onClose={() => setEmailOpen(false)}
          onChanged={() => setEmailOpen(false)} />
      )}

      <div style={{ display: 'flex', gap: 8, margin: '12px 0' }}>
        <button type="button" className="fl-btn-ghost"
          style={t.status === 'pending' ? { background: 'rgba(184,132,42,0.16)', color: '#8A5A12', borderColor: '#C9A25E' } : undefined}
          onClick={() => onTogglePending(t)} disabled={done}>
          Pending
        </button>
        <button type="button" className="fl-btn-ghost"
          style={done ? { background: 'rgba(29,158,117,0.13)', color: '#14775A', borderColor: '#14775A' } : undefined}
          onClick={() => (done ? onUnDone(t) : onMarkDone(t))}>
          {done ? 'Done' : 'Mark done'}
        </button>
      </div>

      <div className="fl-sect" style={{ margin: '16px 2px 8px' }}>
        <div className="fl-sect-h" style={{ fontSize: 17 }}>Thread</div>
        {thread.length > 0 && <span className="fl-sect-pill">{thread.length}</span>}
      </div>

      <div className="fl-thread">
        {thread.length === 0 && atts.length === 0 && (
          <div style={{ fontSize: 13, color: '#8A7F6C', padding: '12px 0' }}>No replies yet.</div>
        )}
        {thread.map((r, i) => (
          <div key={r.id} style={{ padding: '10px 0', borderBottom: (i < thread.length - 1 || atts.length > 0) ? '1px solid #EEE9DD' : 'none' }}>
            <div className="fl-reply-meta">{r.author || '—'} · {replyStamp(r.created_at)}</div>
            <div className="fl-reply-body">{r.body}</div>
          </div>
        ))}
        {atts.length > 0 && (
          <div className="fl-attach-grid" style={{ padding: '10px 0' }}>
            {atts.map((a, i) => (
              <img key={a.path || i} src={a.url} alt={a.name || 'Attachment'} style={{ cursor: 'pointer' }}
                onClick={() => window.open(a.url, '_blank', 'noopener')} />
            ))}
          </div>
        )}
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'stretch' }}>
        <input className="fl-input" style={{ flex: 1, minWidth: 0 }} placeholder="Reply…"
          value={draft} onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') send() }} />
        <label className="fl-btn-ghost" style={{ width: 56, flexShrink: 0 }} aria-label="Attach a photo">
          <CamGlyph />
          <input type="file" accept="image/*" capture="environment" style={{ display: 'none' }}
            onChange={onFilePick} disabled={uploading} />
        </label>
        <button type="button" className="fl-btn-dark" style={{ width: 84, flexShrink: 0 }}
          onClick={send} disabled={sending || !draft.trim()}>
          {sending ? '…' : 'Send'}
        </button>
      </div>
    </div>
  )
}
