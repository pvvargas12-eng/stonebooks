// =============================================================================
// FoundationsScreen — the dig list, BUILT from the phone (FIELD-JOBS-1)
// =============================================================================
// Paul 2026-07-24: "why cant i build a foundation list in the app... under the
// name i need the size of the base L×W, i need the section number thats
// incredibly important." Same doctrine as the install set list: foundation_list
// is membership only, milestones stay the status truth — foundation marked IN
// drops the row's work, Remove drops the row. Add-picker = contracted work with
// open foundation steps; drafts and leads never appear (standing doctrine).
// =============================================================================
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  getFoundationList, addToFoundationList, removeFromFoundationList, getJobs,
  deriveFdnStatus, fdnStatusLabel, fdnStatusTone,
  setOrderFdnStatus, orderStatusWritePlan,
} from '../lib/stonebooksData'
import { rowToOrder } from '../SalesMode'
import { buildBaseSizeOnly, composeGraveLocation } from '../lib/monumentCatalog'
import { familyNameOf, directionsUrl, toneCls } from './fieldShared'

const DAY_MS = 86400000
const DEAD_ORDER = new Set(['closed', 'cancelled'])
// 4-stage dig run. need_map / drop_off read as stage 0 — the chip carries the
// nuance; the bar just says how far along the hole is.
const STAGE_IDX = { not_in: 0, need_map: 0, drop_off: 0, dug: 1, poured: 2, in: 3 }
// The peek sheet's status verbs (Paul 2026-07-29: "i must be able to update
// the status like not started, dug, poured, in") — same 4 rungs as the desktop
// FoundationsBoard stepper; need_map/drop_off stay reachable from the desk.
const DIG_STATUSES = [
  ['not_in', 'NOT STARTED'],
  ['dug', 'DUG'],
  ['poured', 'POURED'],
  ['in', 'IN'],
]

// Mirror a fdn write plan onto the local job row — no 400-job refetch per tap
// (the CutListBoard/FoundationsBoard pattern).
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

// Base L×W + the grave location (leads with "Sec N") — the two lines Paul
// wants under every dig-list name. Computed once per row via rowToOrder.
function digFacts(orderRow) {
  const mapped = orderRow ? rowToOrder(orderRow, orderRow.customer, orderRow.cemetery) : null
  const base = mapped ? buildBaseSizeOnly(mapped) : ''
  const grave = composeGraveLocation(orderRow) || orderRow?.grave_location || ''
  return { base, grave }
}

export default function FoundationsScreen({ onOpenJob, undo = null }) {
  const [list, setList] = useState(null)
  const [jobs, setJobs] = useState(null)
  const [err, setErr] = useState(null)
  const [addOpen, setAddOpen] = useState(false)
  const [q, setQ] = useState('')
  const [peekJob, setPeekJob] = useState(null)
  const [busy, setBusy] = useState(false)
  // React 19 purity: never Date.now() in render — stamped at load time instead.
  const [todayMs, setTodayMs] = useState(0)

  const reload = useCallback(async () => {
    try {
      setTodayMs(Date.now())
      const [l, j] = await Promise.all([getFoundationList(), getJobs({})])
      setList(l || []); setJobs(j || []); setErr(null)
    } catch (e) { setErr(e?.message || 'Could not load the dig list.') }
  }, [])
  useEffect(() => { reload() }, [reload])

  const memberIds = useMemo(() => new Set((list || []).map(r => r.job_id)), [list])
  const listOrder = useMemo(() => new Map((list || []).map((r, i) => [r.job_id, r.sort_order ?? i])), [list])

  // The list, grouped by cemetery (one block = one dig run).
  const groups = useMemo(() => {
    if (!jobs || !list) return null
    const mine = jobs.filter(j => memberIds.has(j.id) && j.order)
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
    for (const [, rows] of out) rows.sort((a, z) => (listOrder.get(a.id) ?? 0) - (listOrder.get(z.id) ?? 0))
    return out
  }, [jobs, list, memberIds, listOrder])

  // Add-picker pool: contracted work whose foundation is still open ('na' =
  // no foundation concept on the job, 'in' = already done — both excluded).
  const candidates = useMemo(() => {
    if (!jobs) return []
    const query = q.trim().toLowerCase()
    const pool = jobs.filter(j => {
      if (!j.order || memberIds.has(j.id)) return false
      const o = j.order
      if (o.archived || DEAD_ORDER.has(o.status) || !o.signed_at) return false
      const code = deriveFdnStatus(j)
      return code !== 'na' && code !== 'in'
    })
    const scored = pool.map(j => ({
      j,
      code: deriveFdnStatus(j),
      age: ageDaysOf(j.order, todayMs),
      facts: digFacts(j.order),
      hay: [familyNameOf(j.order), j.order.order_number, j.order.cemetery?.name].filter(Boolean).join(' ').toLowerCase(),
    }))
    const hit = query ? scored.filter(c => c.hay.includes(query)) : scored
    hit.sort((a, z) => (z.age ?? 0) - (a.age ?? 0))
    return hit.slice(0, query ? 40 : 30)
  }, [jobs, memberIds, q, todayMs])

  const add = async (jobId) => {
    setBusy(true)
    const r = await addToFoundationList(jobId)
    setBusy(false)
    if (r.ok) reload()
  }
  const remove = async (jobId) => {
    setBusy(true)
    await removeFromFoundationList(jobId)
    setBusy(false)
    setPeekJob(null)
    reload()
  }

  // Status write from the peek — instant commit, optimistic milestone mirror
  // so the row + progress bar move without refetching the whole job pool.
  // NO undo capsule here (Paul 2026-07-29: "i want to update the status
  // instantly and if i had to change it i can just change it back") — the
  // four chips are their own undo, and the capsule parked over the sheet's
  // buttons. Failures still toast via showError.
  const setStatus = async (job, code) => {
    if (deriveFdnStatus(job) === code || busy) return
    setBusy(true)
    const r = await setOrderFdnStatus(job.id, code)
    setBusy(false)
    if (!r?.ok) { undo?.showError(r?.error || 'Could not update the status.'); return }
    const plan = orderStatusWritePlan('fdn', code)
    setJobs(js => (js || []).map(j => (j.id === job.id ? applyPlanLocally(j, plan) : j)))
    setPeekJob(p => (p && p.id === job.id ? applyPlanLocally(p, plan) : p))
  }

  const total = groups ? groups.reduce((n, [, rows]) => n + rows.length, 0) : null

  return (
    <div>
      <div className="fl-sect">
        <span className="fl-sect-h">Dig list</span>
        {total != null && <span className="fl-sect-pill">{total}</span>}
      </div>
      <button type="button" className="fl-btn" onClick={() => { setAddOpen(true); setQ('') }}>
        + Add to list
      </button>

      {err && <div className="fl-empty">{err}</div>}
      {!err && groups === null && <div className="fl-empty">Loading the dig list…</div>}
      {!err && groups !== null && groups.length === 0 && (
        <div className="fl-empty">Dig list is empty — add the foundations you're digging.</div>
      )}

      {(groups || []).map(([cem, rows]) => (
        <div key={cem}>
          <div className="fl-daylabel"><b>{cem}</b> · {rows.length}</div>
          {rows.map(j => <FdnRow key={j.id} job={j} onPeek={() => setPeekJob(j)} todayMs={todayMs} />)}
        </div>
      ))}

      {addOpen && (
        <>
          <div className="fl-sheet-scrim" onClick={() => setAddOpen(false)} />
          <div className="fl-sheet">
            <div className="fl-sheet-grab" />
            <div className="fl-sheet-title">Add to the dig list</div>
            <input className="fl-input" autoFocus placeholder="Family, order number, cemetery…"
              value={q} onChange={e => setQ(e.target.value)} />
            <div style={{ maxHeight: '52vh', overflowY: 'auto' }}>
              {candidates.length === 0 && (
                <div className="fl-empty">{q ? 'No matching contracted work with an open foundation.' : 'Nothing waiting on a foundation.'}</div>
              )}
              {candidates.map(({ j, code, age, facts }) => (
                <button key={j.id} type="button" className="fl-row fl-row-flex" disabled={busy}
                  onClick={() => add(j.id)}>
                  <div className="fl-row-main">
                    <div className="fl-fam">{familyNameOf(j.order)}</div>
                    <div className="fl-spec">
                      {[facts.base && `Base ${facts.base}`, facts.grave].filter(Boolean).join(' · ')
                        || [j.order.order_number, j.order.cemetery?.name].filter(Boolean).join(' · ')}
                    </div>
                  </div>
                  <div className="fl-chips" style={{ flexShrink: 0 }}>
                    <AgeDot n={age} />
                    <span className={`fl-chip ${toneCls(fdnStatusTone(code))}`}>{fdnStatusLabel(code).toUpperCase()}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      {peekJob && (
        <FdnPeek job={peekJob} onClose={() => setPeekJob(null)}
          onOpenJob={onOpenJob} onRemove={remove} onSetStatus={setStatus} busy={busy} />
      )}
    </div>
  )
}

// Row: family, then Paul's two facts UNDER the name — base L×W and the grave
// location (section first). Status chip + dig progress on the right.
function FdnRow({ job, onPeek, todayMs }) {
  const code = deriveFdnStatus(job)
  const idx = STAGE_IDX[code] ?? 0
  const { base, grave } = digFacts(job.order)
  return (
    <button type="button" className="fl-row fl-row-flex" onClick={onPeek}>
      <div className="fl-row-main">
        <div className="fl-fam">{familyNameOf(job.order)}</div>
        {base && <div className="fl-spec"><b>Base {base}</b></div>}
        <div className="fl-spec">
          {grave || <span style={{ color: '#B3261E', fontWeight: 700 }}>NO SECTION ON FILE</span>}
        </div>
      </div>
      <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
        <div className="fl-chips">
          <AgeDot n={ageDaysOf(job.order, todayMs)} />
          <span className={`fl-chip ${toneCls(fdnStatusTone(code))}`}>{fdnStatusLabel(code).toUpperCase()}</span>
        </div>
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

// One tap → what the dig needs: base size, section, status verbs, directions,
// the job. Status commits instantly, no undo capsule — the chips reverse
// themselves. Milestones stay the truth, so the desktop Foundations board
// and the install gates read the same tap.
function FdnPeek({ job, onClose, onOpenJob, onRemove, onSetStatus, busy }) {
  const o = job.order
  const orderId = job.order_id || o?.id
  const { base, grave } = digFacts(o)
  const dir = directionsUrl(o?.cemetery)
  const code = deriveFdnStatus(job)
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
          {base && <div className="fl-statusrow"><span>Base</span><b>{base}</b></div>}
          <div className="fl-statusrow"><span>Grave</span><b>{grave || 'No section on file'}</b></div>
        </div>
        <div className="fl-label">
          Foundation status — now <b style={{ color: '#16150F' }}>{fdnStatusLabel(code)}</b>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '8px 0 14px' }}>
          {DIG_STATUSES.map(([c, label]) => (
            <button key={c} type="button"
              className={`fl-chip-btn${code === c ? ' on' : ''}`}
              disabled={busy}
              onClick={() => onSetStatus(job, c)}>
              {label}
            </button>
          ))}
        </div>
        <button type="button" className="fl-btn"
          onClick={() => { onClose(); onOpenJob?.({ jobId: job.id, orderId }, 'jobs') }}>
          Open job
        </button>
        {dir && (
          <a className="fl-btn fl-btn-ghost" style={{ display: 'block', textAlign: 'center', textDecoration: 'none' }}
            href={dir} target="_blank" rel="noreferrer">Directions</a>
        )}
        <button type="button" className="fl-btn fl-btn-ghost" disabled={busy}
          style={{ color: '#B3261E' }} onClick={() => onRemove(job.id)}>
          Remove from list
        </button>
      </div>
    </>
  )
}
