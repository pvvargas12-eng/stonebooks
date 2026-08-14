// =============================================================================
// BronzeScreen — active bronze work, by pipeline stage (BRONZE-WIRE)
// =============================================================================
// Paul 2026-08-14: "none of my bronze jobs populate stonebooks field." Every
// ACTIVE contracted bronze job (job_type 'bronze'), grouped by where it sits
// in the pipeline — To order / On order / Received. Installed work drops off.
// Status verbs commit instantly with an optimistic milestone mirror (the
// FoundationsScreen pattern; no undo capsule on status chips — standing
// doctrine, the chips are their own undo). Marking RECEIVED auto-joins the
// installation list (setOrderStoneStatus's bronze handoff).
// =============================================================================
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  getJobs, getInstallList,
  deriveStoneStatus, stoneStatusLabel, stoneStatusTone,
  setOrderStoneStatus, orderStatusWritePlan,
} from '../lib/stonebooksData'
import { bronzeWorkTypeLabel } from '../lib/orderRates'
import { composeGraveLocation } from '../lib/monumentCatalog'
import { familyNameOf, directionsUrl, toneCls } from './fieldShared'

const DAY_MS = 86400000
const DEAD_ORDER = new Set(['closed', 'cancelled'])
// Pipeline groups in shop order. 'received' work is what the truck can take.
const GROUPS = [
  ['not_ordered', 'To order'],
  ['ordered', 'On order'],
  ['received', 'Received — ready for the set list'],
]
// The peek sheet's status verbs — the bronze 3-rung ladder (stoneStatusOptions
// vocabulary; desktop Stone/Bronze dropdown reads the same milestones).
const BRONZE_STATUSES = [
  ['not_ordered', 'NOT ORDERED'],
  ['ordered', 'ORDERED'],
  ['received', 'RECEIVED'],
]

// Mirror a stone write plan onto the local job row (the FoundationsScreen
// applyPlanLocally twin) — no full job refetch per tap.
function applyPlanLocally(job, plan) {
  if (!plan) return job
  const ms = (job.milestones || []).map(m => {
    if (plan.done?.includes(m.milestone_key) && m.status !== 'done') return { ...m, status: 'done' }
    if (plan.notStarted?.includes(m.milestone_key) && m.status === 'done') return { ...m, status: 'not_started' }
    return m
  })
  return { ...job, milestones: ms }
}

const ageDaysOf = (order, todayMs) => {
  const t = Date.parse(order?.signed_at || order?.created_at || '')
  if (!todayMs || !Number.isFinite(t)) return null
  return Math.max(0, Math.floor((todayMs - t) / DAY_MS))
}
const AgeDot = ({ n }) => n == null ? null : (
  <span className={`fl-chip ${n < 60 ? 'fl-c-good' : n < 150 ? 'fl-c-warn' : 'fl-c-bad'}`}>{n}d</span>
)

const installedDone = (job) => (job.milestones || []).some(m =>
  m.milestone_key === 'installed' && m.status === 'done')

export default function BronzeScreen({ onOpenJob, undo = null }) {
  const [jobs, setJobs] = useState(null)
  const [setListIds, setSetListIds] = useState(new Set())
  const [err, setErr] = useState(null)
  const [peekJob, setPeekJob] = useState(null)
  const [busy, setBusy] = useState(false)
  const [todayMs, setTodayMs] = useState(0)

  const reload = useCallback(async () => {
    try {
      setTodayMs(Date.now())
      const [j, list] = await Promise.all([getJobs({}), getInstallList().catch(() => [])])
      setJobs(j || [])
      setSetListIds(new Set((list || []).map(r => r.job_id)))
      setErr(null)
    } catch (e) { setErr(e?.message || 'Could not load bronze work.') }
  }, [])
  useEffect(() => { reload() }, [reload])

  const groups = useMemo(() => {
    if (!jobs) return null
    const mine = jobs.filter(j => {
      if (j.job_type !== 'bronze' || !j.order) return false
      const o = j.order
      if (o.archived || DEAD_ORDER.has(o.status) || !o.signed_at) return false
      return !installedDone(j)
    })
    const out = GROUPS.map(([code, label]) => [code, label,
      mine.filter(j => deriveStoneStatus(j) === code)])
    for (const [, , rows] of out) {
      rows.sort((a, z) => (ageDaysOf(z.order, todayMs) ?? 0) - (ageDaysOf(a.order, todayMs) ?? 0))
    }
    return out
  }, [jobs, todayMs])

  // Instant status write + optimistic mirror (no undo capsule on status chips
  // — Paul's 2026-07-29 doctrine; RECEIVED also auto-joins the install list
  // inside setOrderStoneStatus, so the ON SET LIST chip lights on reload).
  const setStatus = async (job, code) => {
    if (deriveStoneStatus(job) === code || busy) return
    setBusy(true)
    const r = await setOrderStoneStatus(job.id, code)
    setBusy(false)
    if (!r?.ok) { undo?.showError(r?.error || 'Could not update the status.'); return }
    const plan = orderStatusWritePlan('stone', code, job)
    setJobs(js => (js || []).map(j => (j.id === job.id ? applyPlanLocally(j, plan) : j)))
    setPeekJob(p => (p && p.id === job.id ? applyPlanLocally(p, plan) : p))
    if (code === 'received') setSetListIds(ids => new Set([...ids, job.id]))
  }

  if (err) return <div className="fl-empty">{err}</div>
  if (groups === null) return <div className="fl-empty">Loading bronze work…</div>

  const total = groups.reduce((n, [, , rows]) => n + rows.length, 0)

  return (
    <div>
      <div className="fl-sect">
        <span className="fl-sect-h">Bronze</span>
        <span className="fl-sect-pill">{total}</span>
      </div>
      {total === 0 && <div className="fl-empty">No active bronze work.</div>}
      {groups.map(([code, label, rows]) => rows.length === 0 ? null : (
        <div key={code}>
          <div className="fl-daylabel"><b>{label}</b> · {rows.length}</div>
          {rows.map(j => (
            <BronzeRow key={j.id} job={j} todayMs={todayMs}
              onSetList={setListIds.has(j.id)} onPeek={() => setPeekJob(j)} />
          ))}
        </div>
      ))}
      {peekJob && (
        <BronzePeek job={peekJob} onClose={() => setPeekJob(null)}
          onOpenJob={onOpenJob} onSetStatus={setStatus} busy={busy}
          onSetList={setListIds.has(peekJob.id)} />
      )}
    </div>
  )
}

function BronzeRow({ job, todayMs, onSetList, onPeek }) {
  const o = job.order
  const code = deriveStoneStatus(job)
  const work = bronzeWorkTypeLabel(o.pricing?.bronze?.workType)
  return (
    <button type="button" className="fl-row fl-row-flex" onClick={onPeek}>
      <div className="fl-row-main">
        <div className="fl-fam">{familyNameOf(o)}</div>
        <div className="fl-spec">
          {[work, o.cemetery?.name, o.order_number].filter(Boolean).join(' · ')}
        </div>
      </div>
      <div className="fl-chips" style={{ flexShrink: 0 }}>
        <AgeDot n={ageDaysOf(o, todayMs)} />
        {onSetList && <span className="fl-chip fl-c-good">ON SET LIST</span>}
        <span className={`fl-chip ${toneCls(stoneStatusTone(code))}`}>{stoneStatusLabel(code).toUpperCase()}</span>
      </div>
      <span className="fl-chev">&#8250;</span>
    </button>
  )
}

// One tap → the bronze's facts + the 3 status verbs. RECEIVED = the handoff:
// the job auto-joins the installation list (milestones stay the truth — the
// desktop Stone/Bronze dropdown and the install gates read the same tap).
function BronzePeek({ job, onClose, onOpenJob, onSetStatus, busy, onSetList }) {
  const o = job.order
  const orderId = job.order_id || o?.id
  const code = deriveStoneStatus(job)
  const work = bronzeWorkTypeLabel(o?.pricing?.bronze?.workType)
  const grave = composeGraveLocation(o) || o?.grave_location || ''
  const dir = directionsUrl(o?.cemetery)
  return (
    <>
      <div className="fl-sheet-scrim" onClick={onClose} />
      <div className="fl-sheet">
        <div className="fl-sheet-grab" />
        <div className="fl-sheet-title">{familyNameOf(o)}</div>
        <div className="fl-spec" style={{ marginTop: -6, marginBottom: 10 }}>
          {[o?.order_number, o?.cemetery?.name].filter(Boolean).join(' · ')}
        </div>
        <div style={{ margin: '2px 0 12px' }}>
          <div className="fl-statusrow"><span>Work</span><b>{work}</b></div>
          <div className="fl-statusrow"><span>Grave</span><b>{grave || 'No section on file'}</b></div>
          {onSetList && <div className="fl-statusrow"><span>Set list</span><b>On the installation list</b></div>}
        </div>
        <div className="fl-label">
          Bronze status — now <b style={{ color: '#16150F' }}>{stoneStatusLabel(code)}</b>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '8px 0 6px' }}>
          {BRONZE_STATUSES.map(([c, label]) => (
            <button key={c} type="button"
              className={`fl-chip-btn${code === c ? ' on' : ''}`}
              disabled={busy}
              onClick={() => onSetStatus(job, c)}>
              {label}
            </button>
          ))}
        </div>
        <div className="fl-spec" style={{ marginBottom: 12 }}>
          RECEIVED adds it to the installation list automatically.
        </div>
        <button type="button" className="fl-btn"
          onClick={() => { onClose(); onOpenJob?.({ jobId: job.id, orderId }, 'jobs') }}>
          Open job
        </button>
        {dir && (
          <a className="fl-btn fl-btn-ghost" style={{ display: 'block', textAlign: 'center', textDecoration: 'none' }}
            href={dir} target="_blank" rel="noreferrer">Directions</a>
        )}
      </div>
    </>
  )
}
