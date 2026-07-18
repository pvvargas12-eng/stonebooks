// =============================================================================
// FoundationsScreen — the dig list from the phone (twin of Jobs › Foundations)
// =============================================================================
// Same hand-picked foundation_list membership + milestone-derived status as
// the desktop board, grouped by cemetery (one block = one dig run). Status
// writes happen on the Job detail ladder — this list is for running the route.
// =============================================================================
import { useState, useEffect } from 'react'
import { getFoundationList, getJobs, deriveFdnStatus, fdnStatusLabel, fdnStatusTone } from '../lib/stonebooksData'
import { familyNameOf, toneCls } from './fieldShared'

// 4-stage dig run. need_map / drop_off read as stage 0 — the chip carries the
// nuance; the bar just says how far along the hole is.
const STAGE_IDX = { not_in: 0, need_map: 0, drop_off: 0, dug: 1, poured: 2, in: 3 }

export default function FoundationsScreen({ onOpenJob }) {
  const [groups, setGroups] = useState(null)   // null = loading, [] = empty list
  const [err, setErr] = useState(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const [list, jobs] = await Promise.all([getFoundationList(), getJobs({})])
        if (cancelled) return
        const orderOf = new Map((list || []).map((r, i) => [r.job_id, r.sort_order ?? i]))
        const mine = (jobs || []).filter(j => orderOf.has(j.id) && j.order)
        const byCem = new Map()
        for (const j of mine) {
          const key = j.order.cemetery?.name || 'No cemetery on file'
          if (!byCem.has(key)) byCem.set(key, [])
          byCem.get(key).push(j)
        }
        const out = [...byCem.entries()].sort((a, z) => {
          if (a[0] === 'No cemetery on file') return 1
          if (z[0] === 'No cemetery on file') return -1
          return a[0].localeCompare(z[0])
        })
        for (const [, rows] of out) {
          rows.sort((a, z) => (orderOf.get(a.id) ?? 0) - (orderOf.get(z.id) ?? 0))
        }
        setGroups(out)
      } catch (e) {
        if (!cancelled) setErr(e?.message || 'Could not load the dig list.')
      }
    })()
    return () => { cancelled = true }
  }, [])

  if (err) return <div className="fl-empty">{err}</div>
  if (groups === null) return <div className="fl-empty">Loading the dig list…</div>
  if (groups.length === 0) return <div className="fl-empty">Dig list is empty.</div>

  return (
    <div>
      {groups.map(([cem, jobs]) => (
        <div key={cem}>
          <div className="fl-daylabel"><b>{cem}</b> · {jobs.length}</div>
          {jobs.map(j => <FdnRow key={j.id} job={j} onOpenJob={onOpenJob} />)}
        </div>
      ))}
    </div>
  )
}

function FdnRow({ job, onOpenJob }) {
  const code = deriveFdnStatus(job)
  const idx = STAGE_IDX[code] ?? 0
  return (
    <button type="button" className="fl-row fl-row-flex"
      onClick={() => onOpenJob({ jobId: job.id, orderId: job.order_id || job.order?.id }, 'jobs')}>
      <div className="fl-row-main">
        <div className="fl-fam">{familyNameOf(job.order)}</div>
        <div className="fl-spec">{job.order.order_number || 'DRAFT'}</div>
      </div>
      <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
        <span className={`fl-chip ${toneCls(fdnStatusTone(code))}`}>{fdnStatusLabel(code).toUpperCase()}</span>
        <div className="fl-runprog" style={{ width: 66, margin: '8px 0 0' }}>
          {[0, 1, 2, 3].map(i => (
            <i key={i} className={i < idx ? 'done' : i === idx ? 'cur' : ''} />
          ))}
        </div>
      </div>
      <span className="fl-chev">&#8250;</span>
    </button>
  )
}
