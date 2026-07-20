// =============================================================================
// ScheduleScreen — owner Schedule tab: runs, installs, and field work by day
// =============================================================================
// One shallow getBatches() pull covers the 14-day window; the selected day is
// deep-fetched through getBatch(id), which resolves null on error — every run
// falls back to its shallow row rather than dropping off the day. BUMP +1 DAY
// is an optimistic updateBatch({ scheduled_date }) computed from the batch's
// OWN date string, with an 8s undo back to the original date. No confirms.
// =============================================================================
import { useState, useEffect, useMemo } from 'react'
import { getBatches, getBatch, updateBatch } from '../lib/stonebooksData'
import { familyNameOf, BATCH_KIND_CHIP, fmtDayLabel, todayISO, isoPlusDays } from './fieldShared'

// Add one day to a stored iso date string — handlers only; never reads the
// live clock (the +1 rides the batch's own scheduled_date, not "today").
function isoNextDay(iso) {
  const d = new Date(String(iso).slice(0, 10) + 'T00:00:00')
  if (isNaN(d.getTime())) return iso
  d.setDate(d.getDate() + 1)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

// Pure parse of a stored completed_at timestamp (no clock read) — render-safe.
function fmtStopTime(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  if (isNaN(d.getTime())) return ''
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

export default function ScheduleScreen({ who, undo, onOpenJob }) {   // eslint-disable-line no-unused-vars
  const [shallow, setShallow] = useState(null)   // all 14 days, link rows only
  const [err, setErr] = useState(null)
  const [selected, setSelected] = useState(() => todayISO())
  const [deep, setDeep] = useState(null)         // { day, list } for the selected day

  const days = useMemo(() => Array.from({ length: 14 }, (_, i) => isoPlusDays(i)), [])

  // Shallow window, once on mount.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const rows = await getBatches({ from: todayISO(), to: isoPlusDays(13) })
        if (cancelled) return
        setShallow((rows || []).filter(b => b.status !== 'cancelled' && b.scheduled_date))
      } catch (e) {
        if (!cancelled) setErr(e?.message || 'Could not load the schedule.')
      }
    })()
    return () => { cancelled = true }
  }, [])

  // Deep-fetch the selected day. getBatch resolves null on error — fall back
  // to the shallow row so a flaky fetch never drops a run. Re-runs when
  // shallow changes (a bump moved a date); same-day reruns keep the current
  // list on screen while the refresh lands, so bumps stay visually optimistic.
  useEffect(() => {
    if (!shallow) return
    let cancelled = false
    setDeep(prev => (prev && prev.day === selected) ? prev : null)
    const dayRows = shallow.filter(b => b.scheduled_date === selected)
    ;(async () => {
      const full = await Promise.all(dayRows.map(b => getBatch(b.id).then(d => d || b).catch(() => b)))
      if (cancelled) return
      const slotRank = (x) => x.am_pm === 'am' ? 0 : x.am_pm === 'pm' ? 2 : 1
      setDeep({ day: selected, list: full.filter(Boolean).sort((a, z) => slotRank(a) - slotRank(z)) })
    })()
    return () => { cancelled = true }
  }, [shallow, selected])

  // BUMP +1 DAY — optimistic: off this day immediately, shallow row carries
  // the new date (so the next day's pill picks it up and the deep effect
  // re-syncs the remaining runs). Failure reverts; success offers undo, which
  // writes the original date back and lets the shallow change trigger a
  // clean refetch of whatever day is on screen.
  const bumpBatch = (b) => {
    const orig = b.scheduled_date
    if (!orig) return
    const next = isoNextDay(orig)
    if (next === orig) return
    setDeep(prev => prev ? { ...prev, list: prev.list.filter(x => x.id !== b.id) } : prev)
    setShallow(rows => (rows || []).map(r => r.id === b.id ? { ...r, scheduled_date: next } : r))
    updateBatch(b.id, { scheduled_date: next }).then(res => {
      if (!res?.ok) {
        setShallow(rows => (rows || []).map(r => r.id === b.id ? { ...r, scheduled_date: orig } : r))
        undo.showError(res?.error || 'Could not bump the run.')
        return
      }
      undo.show('Bumped to tomorrow', async () => {
        await updateBatch(b.id, { scheduled_date: orig }).catch(() => {})
        setShallow(rows => (rows || []).map(r => r.id === b.id ? { ...r, scheduled_date: orig } : r))
      })
    })
  }

  const openStop = (stop) => {
    if (!stop) return
    onOpenJob({
      jobId: stop.job_id || stop.job?.id || null,
      orderId: stop.job?.order_id || stop.job?.order?.id || null,
    }, 'schedule')
  }

  if (err) return <div className="fl-empty">{err}</div>
  if (shallow === null) return <div className="fl-empty">Loading the schedule…</div>

  const list = (deep && deep.day === selected) ? deep.list : null

  return (
    <div>
      <div className="fl-greet">Schedule</div>
      <div className="fl-greet-sub">Runs, installs, and field work by day</div>

      <div style={{ display: 'flex', gap: 8, overflowX: 'auto', margin: '16px -14px 6px', padding: '2px 14px 10px', WebkitOverflowScrolling: 'touch' }}>
        {days.map(iso => (
          <button key={iso} type="button"
            className={`fl-chip-btn${iso === selected ? ' on' : ''}`}
            style={{ whiteSpace: 'nowrap', flexShrink: 0 }}
            onClick={() => setSelected(iso)}>
            {fmtDayLabel(iso)}
          </button>
        ))}
      </div>

      {list === null && <div className="fl-empty">Loading…</div>}
      {list && list.length === 0 && <div className="fl-empty-serif">Nothing scheduled.</div>}
      {list && list.map(b => (
        <BatchCard key={b.id} batch={b} onOpenStop={openStop} onBump={bumpBatch} />
      ))}
    </div>
  )
}

function BatchCard({ batch: b, onOpenStop, onBump }) {
  const kind = BATCH_KIND_CHIP[b.kind] || { label: String(b.kind || '').toUpperCase(), cls: 'fl-k-del' }
  const ampm = b.am_pm ? ` · ${b.am_pm.toUpperCase()}` : ''
  // Deep rows carry stop.job.order; a shallow fallback row has bare link rows,
  // which filter out here — the run still renders (title/cemetery/bump), it
  // just lists no tappable stops until a refetch lands.
  const stops = (b.batch_jobs || []).filter(s => s && s.job && s.job.order)
  const done = stops.filter(s => s.completed_at)
  const curIdx = stops.findIndex(s => !s.completed_at)

  return (
    <div className="fl-row" style={{ cursor: 'default' }}>
      <div className="fl-rowtop">
        <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <span className={`fl-kind ${kind.cls}`}>{kind.label}{ampm}</span>
          {(b.title || b.assigned_to) && (
            <span style={{ fontSize: 12.5, fontWeight: 700, color: '#55503F', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {[b.title, b.assigned_to].filter(Boolean).join(' · ')}
            </span>
          )}
        </span>
        {stops.length > 0 && (
          <span className="fl-spec" style={{ marginTop: 0 }}>{done.length}/{stops.length}</span>
        )}
      </div>

      {stops.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <span className="fl-dots">
            {stops.map((s, i) => (
              <i key={s.id} className={s.completed_at ? 'done' : (i === curIdx ? 'cur' : '')} />
            ))}
          </span>
        </div>
      )}

      {stops.length === 0 && (b.cemetery?.name || b.notes) && (
        <div className="fl-cem">{[b.cemetery?.name, b.notes].filter(Boolean).join(' — ')}</div>
      )}

      {stops.length > 0 && (
        <div style={{ marginTop: 6, borderTop: '1px solid #F0ECE2' }}>
          {stops.map(s => {
            const fam = familyNameOf(s.job.order)
            const cemName = s.job.order?.cemetery?.name || b.cemetery?.name
            if (s.completed_at) {
              return (
                <div key={s.id} className="fl-rowline" style={{ cursor: 'default' }}>
                  <span className="fl-task-done" style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 700 }}>
                    {fam}{cemName ? ` — ${cemName}` : ''}
                  </span>
                  <span className="fl-spec" style={{ marginTop: 0 }}>{fmtStopTime(s.completed_at)}</span>
                </div>
              )
            }
            return (
              <button key={s.id} type="button" className="fl-rowline" onClick={() => onOpenStop(s)}>
                <span style={{ flex: 1, minWidth: 0, fontSize: 14, color: '#16150F' }}>
                  <b>{fam}</b>
                  {cemName && <span style={{ color: '#6B6456', fontWeight: 600 }}> — {cemName}</span>}
                </span>
                <span className="fl-chev">&#8250;</span>
              </button>
            )
          })}
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
        <button type="button" className="fl-verb" onClick={() => onBump(b)}>BUMP +1 DAY</button>
      </div>
    </div>
  )
}
