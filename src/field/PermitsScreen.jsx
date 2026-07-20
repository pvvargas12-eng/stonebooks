// =============================================================================
// PermitsScreen — every job still waiting on a permit (owner build)
// =============================================================================
// FIELD-3: permits are NOT milestone-derived — the desktop Permit Hub's source
// of truth is orders.permit_status (+ permit_required) via permitNeeded(), so
// this screen mirrors that exactly: keep active jobs whose order still has open
// permit work (needed / submitted / denied / required-but-undetermined), drop
// approved and not_required. Grouped by cemetery like the dig list; a row tap
// drills into the job.
// =============================================================================
import { useState, useEffect } from 'react'
import { getJobs, permitStatusLabel, permitNeeded } from '../lib/stonebooksData'
import { familyNameOf } from './fieldShared'

// Chip per the order's real permit status. Field doctrine: not-filed states
// read RED (fl-c-bad, the "red not-started" rule), submitted reads info —
// intentionally hotter than the desktop's amber so a missing filing can't hide.
// Labels come from PERMIT_STATUS_LABEL via permitStatusLabel; the
// undetermined-but-required case ('unknown' status) borrows the legacy
// 'required' label ("Permit Needed") because its own label is a bare dash.
function permitChip(order) {
  const st = order?.permit_status || 'unknown'
  const label = (st === 'unknown' ? permitStatusLabel('required') : permitStatusLabel(st)).toUpperCase()
  return { label, cls: st === 'submitted' ? 'fl-c-info' : 'fl-c-bad' }
}

// Same open-work test as PermitHub's needsPermit augmentation: a permit is in
// play (permitNeeded — cemetery requires one OR status is one of the needed/
// submitted/denied codes) and it hasn't reached a terminal state.
function permitOpen(order) {
  if (!order) return false
  if (order.status === 'closed' || order.status === 'cancelled') return false
  const st = order.permit_status || 'unknown'
  return permitNeeded(order) && st !== 'approved' && st !== 'not_required'
}

export default function PermitsScreen({ who, undo, onOpenJob, onBack }) {
  const [groups, setGroups] = useState(null)   // null = loading; [[cemName, jobs], …]
  const [err, setErr] = useState(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        // Wide limit like the desktop hub — getJobs already excludes closed
        // jobs and archived orders.
        const jobs = await getJobs({ limit: 2000 })
        if (cancelled) return
        // One row per order (first job wins — getJobs sorts by last update).
        const seen = new Set()
        const open = []
        for (const j of jobs || []) {
          if (!j.order || !permitOpen(j.order)) continue
          const oid = j.order_id || j.order.id
          if (seen.has(oid)) continue
          seen.add(oid)
          open.push(j)
        }
        const byCem = new Map()
        for (const j of open) {
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
          rows.sort((a, z) => familyNameOf(a.order).localeCompare(familyNameOf(z.order)))
        }
        setGroups(out)
      } catch (e) {
        if (!cancelled) setErr(e?.message || 'Could not load permits.')
      }
    })()
    return () => { cancelled = true }
  }, [])

  return (
    <div>
      {onBack && (
        <button type="button" className="fl-rowline" onClick={onBack}
          style={{ color: '#9A7209', fontWeight: 700, fontSize: 15, minHeight: 44 }}>
          &#8249; Menu
        </button>
      )}
      <div style={{ margin: '4px 2px 14px' }}>
        <div className="fl-sect-h" style={{ fontSize: 26 }}>Permits</div>
        <div className="fl-greet-sub">Still waiting on approval, by cemetery</div>
      </div>

      {err && <div className="fl-empty">{err}</div>}
      {!err && groups === null && <div className="fl-empty">Loading permits&#8230;</div>}
      {!err && groups !== null && groups.length === 0 && (
        <div className="fl-empty">No open permits. Everything is approved or not required.</div>
      )}
      {!err && groups !== null && groups.map(([cem, jobs]) => (
        <div key={cem}>
          <div className="fl-daylabel"><b>{cem}</b> &#183; {jobs.length}</div>
          {jobs.map(j => <PermitRow key={j.id} job={j} onOpenJob={onOpenJob} />)}
        </div>
      ))}
    </div>
  )
}

function PermitRow({ job: j, onOpenJob }) {
  const chip = permitChip(j.order)
  return (
    <button type="button" className="fl-row fl-row-flex"
      onClick={() => onOpenJob({ jobId: j.id, orderId: j.order_id || j.order?.id }, 'menu')}>
      <div className="fl-row-main">
        <div className="fl-fam">{familyNameOf(j.order)}</div>
        <div className="fl-spec">{j.order.order_number || 'DRAFT'}</div>
      </div>
      <span className={`fl-chip ${chip.cls}`} style={{ flexShrink: 0 }}>{chip.label}</span>
      <span className="fl-chev">&#8250;</span>
    </button>
  )
}
