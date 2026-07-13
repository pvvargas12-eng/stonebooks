// =============================================================================
// ProductionScreen — every active stone and where it sits, filterable
// =============================================================================
// getJobs() gives job + order + milestones in one query — the same rows the
// desktop hubs derive from, so the statuses can never disagree. Advancing
// happens on the Job detail ladder (with UNDO); this list is for finding.
// =============================================================================
import { useState, useEffect, useMemo } from 'react'
import { getJobs, deriveStoneStatus, stoneStatusLabel, stoneStatusTone, deriveFdnStatus, customerName } from '../lib/stonebooksData'
import { isLeadRaw, toneCls } from './fieldShared'

const IN_SHOP = ['ordered', 'in_stock', 'needs_pickup', 'needs_stencil_cut', 'needs_blasting']
const FDN_OPEN = ['need_map', 'not_in', 'drop_off', 'dug', 'poured']

const FILTERS = [
  { code: 'all',        label: 'All',            match: () => true },
  { code: 'to_order',   label: 'To order',       match: (j) => deriveStoneStatus(j) === 'not_ordered' },
  { code: 'in_shop',    label: 'In shop',        match: (j) => IN_SHOP.includes(deriveStoneStatus(j)) },
  { code: 'blasted',    label: 'Blasted',        match: (j) => deriveStoneStatus(j) === 'blasted' },
  { code: 'foundation', label: 'Foundation',     match: (j) => FDN_OPEN.includes(deriveFdnStatus(j)) },
]

export default function ProductionScreen({ onOpenJob }) {
  const [jobs, setJobs] = useState(null)
  const [err, setErr] = useState(null)
  const [filter, setFilter] = useState('all')

  useEffect(() => {
    let cancelled = false
    getJobs({})
      .then(rows => { if (!cancelled) setJobs((rows || []).filter(j => j.order)) })
      .catch(e => { if (!cancelled) setErr(e?.message || 'Could not load jobs.') })
    return () => { cancelled = true }
  }, [])

  const counts = useMemo(() => {
    const out = {}
    for (const f of FILTERS) out[f.code] = (jobs || []).filter(f.match).length
    return out
  }, [jobs])

  const list = useMemo(() => {
    const f = FILTERS.find(x => x.code === filter) || FILTERS[0]
    return (jobs || []).filter(f.match)
  }, [jobs, filter])

  if (err) return <div className="fl-empty">{err}</div>
  if (jobs === null) return <div className="fl-empty">Loading the shop…</div>

  return (
    <div>
      <div className="fl-filters">
        {FILTERS.map(f => (
          <button key={f.code} type="button" className={`fl-fchip${filter === f.code ? ' on' : ''}`}
            onClick={() => setFilter(f.code)}>
            {f.label} · {counts[f.code] ?? 0}
          </button>
        ))}
      </div>

      {list.length === 0 && <div className="fl-empty">Nothing in this bucket.</div>}
      {list.map(j => {
        const o = j.order
        const fam = (o.primary_lastname || customerName(j.customer) || '—').toUpperCase()
        const stone = deriveStoneStatus(j)
        const spec = [o.order_number, o.shape, o.granite_color].filter(Boolean).join(' · ')
        return (
          <button key={j.id} type="button" className="fl-row fl-row-flex"
            onClick={() => onOpenJob({ jobId: j.id, orderId: o.id })}>
            <div className="fl-row-main">
              <div className="fl-fam">{fam}{isLeadRaw(o) && <span className="fl-chip fl-c-lead" style={{ marginLeft: 8, verticalAlign: 'middle' }}>LEAD</span>}</div>
              <div className="fl-spec">{spec || '—'}</div>
            </div>
            <span className={`fl-chip ${toneCls(stoneStatusTone(stone))}`}>{stoneStatusLabel(stone).toUpperCase()}</span>
            <span className="fl-chev">&#8250;</span>
          </button>
        )
      })}
    </div>
  )
}
