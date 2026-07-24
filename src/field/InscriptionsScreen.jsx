// =============================================================================
// InscriptionsScreen — active inscription work, by cemetery (FIELD-JOBS-1)
// =============================================================================
// Paul 2026-07-24: "i want inscription section in jobs." Every ACTIVE
// contracted inscription job (job_type 'inscription'), grouped by cemetery —
// inscriptions are cemetery work, so the grouping IS the route. Drafts and
// leads never appear (standing production doctrine). Rows carry the grave
// location (section first) and the age circle; tap opens the job.
// =============================================================================
import { useState, useEffect, useMemo } from 'react'
import { getJobs } from '../lib/stonebooksData'
import { composeGraveLocation } from '../lib/monumentCatalog'
import { familyNameOf } from './fieldShared'

const DAY_MS = 86400000
const DEAD_ORDER = new Set(['closed', 'cancelled'])

const ageDaysOf = (order, todayMs) => {
  const t = Date.parse(order?.signed_at || order?.created_at || '')
  if (!todayMs || !Number.isFinite(t)) return null
  return Math.max(0, Math.floor((todayMs - t) / DAY_MS))
}
const AgeDot = ({ n }) => n == null ? null : (
  <span className={`fl-chip ${n < 60 ? 'fl-c-good' : n < 150 ? 'fl-c-warn' : 'fl-c-bad'}`}>{n}d</span>
)

export default function InscriptionsScreen({ onOpenJob }) {
  const [jobs, setJobs] = useState(null)
  const [err, setErr] = useState(null)
  const [todayMs, setTodayMs] = useState(0)

  useEffect(() => {
    let cancelled = false
    setTodayMs(Date.now())
    getJobs({})
      .then(rows => { if (!cancelled) setJobs(rows || []) })
      .catch(e => { if (!cancelled) setErr(e?.message || 'Could not load inscriptions.') })
    return () => { cancelled = true }
  }, [])

  const groups = useMemo(() => {
    if (!jobs) return null
    const mine = jobs.filter(j => {
      if (j.job_type !== 'inscription' || !j.order) return false
      const o = j.order
      return !o.archived && !DEAD_ORDER.has(o.status) && !!o.signed_at
    })
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
      rows.sort((a, z) => (ageDaysOf(z.order, todayMs) ?? 0) - (ageDaysOf(a.order, todayMs) ?? 0))
    }
    return out
  }, [jobs, todayMs])

  if (err) return <div className="fl-empty">{err}</div>
  if (groups === null) return <div className="fl-empty">Loading inscriptions…</div>

  const total = groups.reduce((n, [, rows]) => n + rows.length, 0)

  return (
    <div>
      <div className="fl-sect">
        <span className="fl-sect-h">Inscriptions</span>
        <span className="fl-sect-pill">{total}</span>
      </div>
      {total === 0 && <div className="fl-empty">No active inscription work.</div>}
      {groups.map(([cem, rows]) => (
        <div key={cem}>
          <div className="fl-daylabel"><b>{cem}</b> · {rows.length}</div>
          {rows.map(j => {
            const grave = composeGraveLocation(j.order) || j.order?.grave_location || ''
            return (
              <button key={j.id} type="button" className="fl-row fl-row-flex"
                onClick={() => onOpenJob({ jobId: j.id, orderId: j.order_id || j.order?.id }, 'jobs')}>
                <div className="fl-row-main">
                  <div className="fl-fam">{familyNameOf(j.order)}</div>
                  <div className="fl-spec">
                    {[j.order.order_number, grave].filter(Boolean).join(' · ') || '—'}
                  </div>
                </div>
                <AgeDot n={ageDaysOf(j.order, todayMs)} />
                <span className="fl-chev">&#8250;</span>
              </button>
            )
          })}
        </div>
      ))}
    </div>
  )
}
