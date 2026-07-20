// =============================================================================
// ProductionFloorScreen — the shop floor in a pocket (FIELD-7)
// =============================================================================
// Paul: "a phone version of the production floor — very easily see my buckets
// and update statuses." Bucket lanes first (big tiles, live counts, same
// derivers as the desktop hubs so they can never disagree), tap a lane for
// its stones, and every row carries STATUS — the same StatusSheet the owner
// Orders rows use (design / stone-bronze / foundation / blocker chips,
// instant commit, 8s undo). No more three-screen drill to move a stone.
// getJobs rows already carry job+milestones+order, so the sheet opens with
// zero extra fetches; the list refetches once when a sheet that changed
// something closes.
// =============================================================================
import { useState, useEffect, useMemo, useRef } from 'react'
import {
  getJobs, deriveStoneStatus, stoneStatusLabel, stoneStatusTone,
  deriveFdnStatus, fdnStatusLabel, customerName, statusDimApplies,
} from '../lib/stonebooksData'
import { isLeadRaw, toneCls } from './fieldShared'
import StatusSheet from './StatusSheet'

// Same bucket math as the flat ProductionScreen (audit B2 lineage).
const IN_SHOP = ['ordered', 'in_stock', 'needs_pickup', 'needs_stencil_cut', 'needs_blasting']
const FDN_OPEN = ['need_map', 'not_in', 'drop_off', 'dug', 'poured']

const LANES = [
  { code: 'to_order',   name: 'To order',   sub: 'Stone not ordered yet',
    match: (j) => statusDimApplies('stone', j) && deriveStoneStatus(j) === 'not_ordered' },
  { code: 'in_shop',    name: 'In shop',    sub: 'Ordered through blasting prep',
    match: (j) => statusDimApplies('stone', j) && IN_SHOP.includes(deriveStoneStatus(j)) },
  { code: 'blasted',    name: 'Blasted',    sub: 'Carved and ready to move',
    match: (j) => statusDimApplies('stone', j) && ['blasted', 'received'].includes(deriveStoneStatus(j)) },
  { code: 'foundation', name: 'Foundation', sub: 'Dig list through cure',
    match: (j) => FDN_OPEN.includes(deriveFdnStatus(j)) },
  { code: 'all',        name: 'Everything', sub: 'Every active stone',
    match: () => true },
]

export default function ProductionFloorScreen({ who, undo, onOpenJob, onBack = null, backLabel = 'More' }) {
  const [jobs, setJobs] = useState(null)
  const [err, setErr] = useState(null)
  const [lane, setLane] = useState(null)        // open lane code | null = lanes view
  const [sheet, setSheet] = useState(null)      // job row for the StatusSheet
  const dirty = useRef(false)                   // a sheet write happened — refetch on close

  const load = () => getJobs({})
    .then(rows => setJobs((rows || []).filter(j => j.order)))
    .catch(e => setErr(e?.message || 'Could not load the shop.'))

  useEffect(() => {
    let cancelled = false
    getJobs({})
      .then(rows => { if (!cancelled) setJobs((rows || []).filter(j => j.order)) })
      .catch(e => { if (!cancelled) setErr(e?.message || 'Could not load the shop.') })
    return () => { cancelled = true }
  }, [])

  const counts = useMemo(() => {
    const out = {}
    for (const l of LANES) out[l.code] = (jobs || []).filter(l.match).length
    return out
  }, [jobs])

  const activeLane = LANES.find(l => l.code === lane) || null
  const list = useMemo(
    () => (activeLane ? (jobs || []).filter(activeLane.match) : []),
    [jobs, activeLane],
  )

  const closeSheet = () => {
    setSheet(null)
    if (dirty.current) { dirty.current = false; load() }
  }

  if (err) return <div className="fl-empty">{err}</div>

  return (
    <div>
      {onBack && !lane && (
        <button type="button" className="fl-rowline" onClick={onBack}
          style={{ color: '#9A7209', fontWeight: 700, fontSize: 15, minHeight: 44 }}>
          &#8249; {backLabel}
        </button>
      )}

      {!lane ? (
        <>
          <div style={{ margin: '4px 2px 14px' }}>
            <div className="fl-sect-h" style={{ fontSize: 26 }}>Production floor</div>
            <div className="fl-greet-sub">Tap a bucket, move the stones</div>
          </div>
          {jobs === null && <div className="fl-empty">Loading the shop…</div>}
          {jobs !== null && (
            <div className="fl-tilegrid">
              {LANES.map(l => (
                <button key={l.code} type="button" className="fl-tile" onClick={() => setLane(l.code)}>
                  <div className="fl-tile-main">
                    <div className="fl-tile-name">{l.name}</div>
                    <div className="fl-tile-sub">{l.sub}</div>
                  </div>
                  <div className="fl-tile-count">{counts[l.code] ?? 0}</div>
                </button>
              ))}
            </div>
          )}
        </>
      ) : (
        <>
          <button type="button" className="fl-rowline" onClick={() => setLane(null)}
            style={{ color: '#9A7209', fontWeight: 700, fontSize: 15, minHeight: 44 }}>
            &#8249; Buckets
          </button>
          <div className="fl-sect" style={{ margin: '2px 2px 10px' }}>
            <span className="fl-sect-h">{activeLane.name}</span>
            <span className="fl-sect-pill">{list.length}</span>
          </div>

          {list.length === 0 && <div className="fl-empty-serif">Nothing in this bucket.</div>}
          {list.map(j => {
            const o = j.order
            const fam = (o.primary_lastname || customerName(j.customer) || '—').toUpperCase()
            const stoneApplies = statusDimApplies('stone', j)
            const stone = stoneApplies ? deriveStoneStatus(j) : null
            const fdn = lane === 'foundation' ? deriveFdnStatus(j) : null
            const spec = [o.order_number, o.shape, o.granite_color].filter(Boolean).join(' · ')
            return (
              <div key={j.id} role="button" tabIndex={0} className="fl-row fl-row-flex"
                onClick={() => onOpenJob({ jobId: j.id, orderId: o.id })}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpenJob({ jobId: j.id, orderId: o.id }) } }}>
                <div className="fl-row-main">
                  <div className="fl-fam">{fam}{isLeadRaw(o) && <span className="fl-chip fl-c-lead" style={{ marginLeft: 8, verticalAlign: 'middle' }}>LEAD</span>}</div>
                  <div className="fl-spec">{spec || '—'}</div>
                </div>
                {lane === 'foundation'
                  ? <span className="fl-chip fl-c-neutral">{fdnStatusLabel(fdn).toUpperCase()}</span>
                  : stoneApplies && <span className={`fl-chip ${toneCls(stoneStatusTone(stone))}`}>{stoneStatusLabel(stone).toUpperCase()}</span>}
                <button type="button" className="fl-verb"
                  onClick={e => { e.stopPropagation(); setSheet(j) }}>
                  STATUS
                </button>
                <span className="fl-chev">&#8250;</span>
              </div>
            )
          })}
        </>
      )}

      {sheet && (
        <StatusSheet key={sheet.id} order={sheet.order} job={sheet}
          who={who} undo={undo}
          onClose={closeSheet}
          onChanged={() => { dirty.current = true }} />
      )}
    </div>
  )
}
