// =============================================================================
// InstallsScreen — what's getting installed, where and when (next 14 days)
// =============================================================================
// Reads the same scheduler batches the desktop Calendar builds. getBatches()
// returns shallow link rows, so each batch is re-fetched through getBatch(id)
// to attach stop.job → milestones/order (the same pattern SchedulerTab uses).
// =============================================================================
import { useState, useEffect } from 'react'
import { getBatches, getBatch, deriveFdnStatus, fdnStatusLabel, fdnStatusTone, customerName } from '../lib/stonebooksData'
import { isLeadRaw, directionsUrl, BATCH_KIND_CHIP, toneCls, fmtDayLabel, todayISO, isoPlusDays } from './fieldShared'

export default function InstallsScreen({ onOpenJob }) {
  const [days, setDays] = useState(null)   // null = loading, [] = nothing scheduled
  const [err, setErr] = useState(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const shallow = await getBatches({ from: todayISO(), to: isoPlusDays(14) })
        const active = (shallow || []).filter(b => b.status !== 'cancelled' && b.scheduled_date)
        const deep = await Promise.all(active.map(b => getBatch(b.id).catch(() => b)))
        if (cancelled) return
        const byDay = new Map()
        for (const b of deep.filter(Boolean)) {
          if (!byDay.has(b.scheduled_date)) byDay.set(b.scheduled_date, [])
          byDay.get(b.scheduled_date).push(b)
        }
        setDays([...byDay.entries()].sort((a, z) => a[0] < z[0] ? -1 : 1))
      } catch (e) {
        if (!cancelled) setErr(e?.message || 'Could not load the schedule.')
      }
    })()
    return () => { cancelled = true }
  }, [])

  if (err) return <div className="fl-empty">{err}</div>
  if (days === null) return <div className="fl-empty">Loading the schedule…</div>
  if (days.length === 0) return <div className="fl-empty">Nothing scheduled in the next two weeks.</div>

  return (
    <div>
      {days.map(([iso, batches]) => (
        <div key={iso}>
          <div className="fl-daylabel"><b>{fmtDayLabel(iso)}</b></div>
          {batches.map(b => <BatchBlock key={b.id} batch={b} onOpenJob={onOpenJob} />)}
        </div>
      ))}
    </div>
  )
}

function BatchBlock({ batch, onOpenJob }) {
  const kind = BATCH_KIND_CHIP[batch.kind] || { label: String(batch.kind || '').toUpperCase(), cls: 'fl-k-del' }
  const ampm = batch.am_pm ? ` · ${batch.am_pm.toUpperCase()}` : ''
  const stops = (batch.batch_jobs || []).filter(s => s && !s.completed_at)
  const dir = directionsUrl(batch.cemetery)

  // Zero-job batches (site visits, errands) render as a single simple card.
  if (stops.length === 0 && (batch.batch_jobs || []).length === 0) {
    return (
      <div className="fl-row" style={{ cursor: 'default' }}>
        <div className="fl-rowtop">
          <span className="fl-fam" style={{ fontSize: 14.5 }}>{batch.title || kind.label}</span>
          <span className={`fl-kind ${kind.cls}`}>{kind.label}{ampm}</span>
        </div>
        {batch.cemetery?.name && <div className="fl-cem">{batch.cemetery.name}</div>}
        {batch.notes && <div className="fl-spec" style={{ fontFamily: 'inherit' }}>{batch.notes}</div>}
        {dir && <div className="fl-chips"><a className="fl-dirlink" href={dir} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}>Directions</a></div>}
      </div>
    )
  }

  return (
    <>
      {stops.map(stop => {
        const job = stop.job
        const order = job?.order
        if (!job || !order) return null
        const fam = (order.primary_lastname || customerName(order.customer) || '—').toUpperCase()
        const cem = order.cemetery || batch.cemetery
        const fdn = deriveFdnStatus(job)
        const spec = [order.shape, order.granite_color].filter(Boolean).join(' · ')
        return (
          <button key={stop.id} type="button" className="fl-row"
            onClick={() => onOpenJob({ jobId: job.id, orderId: order.id })}>
            <div className="fl-rowtop">
              <span className="fl-fam">{fam}</span>
              <span className={`fl-kind ${kind.cls}`}>{kind.label}{ampm}</span>
            </div>
            {cem?.name && <div className="fl-cem">{cem.name}</div>}
            {spec && <div className="fl-spec">{spec}</div>}
            <div className="fl-chips">
              {fdn !== 'na' && <span className={`fl-chip ${toneCls(fdnStatusTone(fdn))}`}>{fdnStatusLabel(fdn).toUpperCase()}</span>}
              {isLeadRaw(order) && <span className="fl-chip fl-c-lead">LEAD · NO DEPOSIT</span>}
              {dir && <a className="fl-dirlink" href={dir} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}>Directions</a>}
            </div>
          </button>
        )
      })}
    </>
  )
}
