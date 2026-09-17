// =============================================================================
// HotListScreen — THE Hot List on the phone (HOT-LIST-2 field surface)
// =============================================================================
// Paul 2026-09-17: "stonebooks field... needs to have the hotlist in there and
// must be able to mark completed in desktop and in field." Same store as the
// desktop Hot List tab (hot_list_items): six lanes, DONE stamps history,
// Remove deletes, add by searching any active work or typing a note. Linked
// rows open the job so the crew can advance the actual work right there.
// =============================================================================
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  HOT_CATEGORIES, getHotListItems, addHotListItem, markHotListItemDone, removeHotListItem,
  getJobs, rowTotalPaid, dueDateTone, properName,
} from '../lib/stonebooksData'
import { familyNameOf } from './fieldShared'

const LEAD_STATUSES = new Set(['draft', 'scoping', 'quoted'])
const TERMINAL_STATUSES = new Set(['closed', 'cancelled'])
const isRealWork = (o) => o && !o.archived && !LEAD_STATUSES.has(o.status) && !TERMINAL_STATUSES.has(o.status) && rowTotalPaid(o) > 0

export default function HotListScreen({ onOpenJob, undo = null }) {
  const [items, setItems] = useState(null)
  const [jobs, setJobs] = useState([])
  const [err, setErr] = useState(null)
  const [busyId, setBusyId] = useState(null)
  const [addOpen, setAddOpen] = useState(false)
  const [addLane, setAddLane] = useState('blast')
  const [q, setQ] = useState('')

  const reload = useCallback(async () => {
    try {
      const [it, js] = await Promise.all([getHotListItems(), getJobs({})])
      setItems(it || []); setJobs(js || []); setErr(null)
    } catch (e) { setErr(e?.message || 'Could not load the hot list.') }
  }, [])
  useEffect(() => { reload() }, [reload])

  const jobById = useMemo(() => new Map(jobs.map(j => [j.id, j])), [jobs])

  const lanes = useMemo(() => {
    const by = new Map(HOT_CATEGORIES.map(c => [c.code, []]))
    for (const it of (items || [])) (by.get(it.category) || by.get('other')).push(it)
    return by
  }, [items])

  const done = async (it) => {
    if (busyId) return
    setBusyId(it.id)
    const r = await markHotListItemDone(it.id)
    setBusyId(null)
    if (!r.ok) { undo?.showError?.(r.error || 'Could not mark it done.'); return }
    setItems(list => (list || []).filter(x => x.id !== it.id))
  }
  const remove = async (it) => {
    if (busyId) return
    setBusyId(it.id)
    const r = await removeHotListItem(it.id)
    setBusyId(null)
    if (!r.ok) { undo?.showError?.(r.error || 'Could not remove it.'); return }
    setItems(list => (list || []).filter(x => x.id !== it.id))
  }

  const candidates = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return []
    const hot = new Set((items || []).filter(i => i.category === addLane && i.job_id).map(i => i.job_id))
    return jobs.filter(j => {
      if (!j.order || !isRealWork(j.order) || hot.has(j.id)) return false
      return [j.order.primary_lastname, j.order.order_number, j.cemetery?.name || j.order.cemetery?.name]
        .filter(Boolean).join(' ').toLowerCase().includes(needle)
    }).slice(0, 20)
  }, [q, jobs, items, addLane])

  const addJob = async (j) => {
    if (busyId) return
    setBusyId(j.id)
    const title = `${familyNameOf(j.order)}${j.order.order_number ? ` — ${j.order.order_number}` : ''}`
    const r = await addHotListItem({ category: addLane, title, jobId: j.id, orderId: j.order.id })
    setBusyId(null)
    if (!r.ok) { undo?.showError?.(r.error); return }
    setAddOpen(false); setQ('')
    reload()
  }
  const addNote = async () => {
    const t = q.trim()
    if (!t || busyId) return
    setBusyId('note')
    const r = await addHotListItem({ category: addLane, title: t })
    setBusyId(null)
    if (!r.ok) { undo?.showError?.(r.error); return }
    setAddOpen(false); setQ('')
    reload()
  }

  const total = items ? items.length : null

  return (
    <div>
      <div className="fl-sect">
        <span className="fl-sect-h" style={{ color: '#B3261E' }}>Hot list</span>
        {total != null && <span className="fl-sect-pill" style={{ background: '#B3261E', color: '#fff' }}>{total}</span>}
      </div>
      <button type="button" className="fl-btn" onClick={() => { setAddOpen(true); setQ('') }}>
        + Add to the hot list
      </button>

      {err && <div className="fl-empty">{err}</div>}
      {!err && items === null && <div className="fl-empty">Loading the hot list…</div>}
      {!err && items !== null && items.length === 0 && (
        <div className="fl-empty">Nothing on the hot list. When it's hot, it goes here.</div>
      )}

      {HOT_CATEGORIES.map(cat => {
        const rows = lanes.get(cat.code) || []
        if (rows.length === 0) return null
        return (
          <div key={cat.code}>
            <div className="fl-daylabel"><b>{cat.label}</b> · {rows.length}</div>
            {rows.map(it => {
              const job = it.job_id ? jobById.get(it.job_id) : null
              const o = job?.order || null
              const family = o ? familyNameOf(o) : it.title
              const dueTone = o ? dueDateTone(o.target_completion_date) : null
              return (
                <div key={it.id} className="fl-row" style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  <button type="button" style={{ flex: 1, minWidth: 0, background: 'none', border: 'none', padding: 0, textAlign: 'left', font: 'inherit', color: 'inherit' }}
                    onClick={() => { if (job) onOpenJob?.({ jobId: job.id, orderId: o?.id }, 'jobs') }}>
                    <div className="fl-fam">{properName(family)}</div>
                    <div className="fl-spec">
                      {[o?.order_number, job?.cemetery?.name || o?.cemetery?.name, it.note].filter(Boolean).join(' · ')
                        || (!job && `added by ${it.added_by || '—'}`)}
                    </div>
                    {dueTone && <span className={`fl-chip ${dueTone === 'red' ? 'fl-c-bad' : 'fl-c-warn'}`} style={{ marginTop: 4 }}>DUE SOON</span>}
                  </button>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flexShrink: 0 }}>
                    <button type="button" className="fl-chip-btn" disabled={busyId === it.id}
                      style={{ borderColor: '#1D9E75', color: '#15724a' }} onClick={() => done(it)}>DONE</button>
                    <button type="button" className="fl-chip-btn" disabled={busyId === it.id}
                      style={{ color: '#B3261E' }} onClick={() => remove(it)}>Remove</button>
                  </div>
                </div>
              )
            })}
          </div>
        )
      })}

      {addOpen && (
        <>
          <div className="fl-sheet-scrim" onClick={() => setAddOpen(false)} />
          <div className="fl-sheet">
            <div className="fl-sheet-grab" />
            <div className="fl-sheet-title">Add to the hot list</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '4px 0 10px' }}>
              {HOT_CATEGORIES.map(c => (
                <button key={c.code} type="button" className={`fl-chip-btn${addLane === c.code ? ' on' : ''}`}
                  onClick={() => setAddLane(c.code)}>{c.label}</button>
              ))}
            </div>
            <input className="fl-input" autoFocus placeholder="Search family, order #, cemetery — or type a note"
              value={q} onChange={e => setQ(e.target.value)} />
            <div style={{ maxHeight: '44vh', overflowY: 'auto' }}>
              {q.trim() && (
                <button type="button" className="fl-row fl-row-flex" disabled={busyId === 'note'} onClick={addNote}>
                  <div className="fl-row-main">
                    <div className="fl-fam" style={{ color: '#9A7209' }}>Add as note</div>
                    <div className="fl-spec">"{q.trim()}" — free text, no order link</div>
                  </div>
                </button>
              )}
              {candidates.map(j => (
                <button key={j.id} type="button" className="fl-row fl-row-flex" disabled={busyId === j.id} onClick={() => addJob(j)}>
                  <div className="fl-row-main">
                    <div className="fl-fam">{familyNameOf(j.order)}</div>
                    <div className="fl-spec">{[j.order.order_number, j.cemetery?.name || j.order.cemetery?.name].filter(Boolean).join(' · ')}</div>
                  </div>
                </button>
              ))}
              {q.trim() && candidates.length === 0 && (
                <div className="fl-empty">No active work matches — "Add as note" puts the text itself on the list.</div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
