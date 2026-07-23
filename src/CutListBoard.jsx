// =============================================================================
// CutListBoard — Jobs › Cut list (CUT-LIST sprint, 2026-07-22)
// =============================================================================
// The hand-built stencil cutting queue. Paul's rules, verbatim intent:
//   • A stone belongs on the list only when the STONE IS IN THE SHOP
//     (stone_received done — jobs with no stone leg, like inscriptions, skip
//     that gate) AND the LAYOUT IS APPROVED.
//   • RED, unmissable: any stone that meets both gates and is NOT on the list
//     screams at the top of this board (and as a red count on the Jobs tab
//     strip) until Paul adds it — but NOTHING is ever auto-added. He builds
//     his lists (same doctrine as the Foundations list).
//   • Gates inform, never wall: the picker can add ANY uncut job; non-ready
//     rows carry amber gate chips instead of being hidden.
// MARK CUT rides the EXISTING stone ladder (setOrderStoneStatus
// 'needs_blasting' → stencil_created + stencil_cut done) so the Production
// floor, dispatch grid, and field app all read the same truth. No parallel
// status store — the list table records membership only.
// =============================================================================
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  getJobs, getStencilCutList, addToStencilCutList, removeFromStencilCutList,
  getCurrentProofsByJob, designStateFor, setOrderStoneStatus, orderStatusWritePlan,
  customerName, properName, rowTotalPaid, getStoneUpByJob,
} from './lib/stonebooksData'
import { rowToOrder } from './SalesMode'
import { buildDieSpec, displayGraniteColor } from './lib/monumentCatalog'

const msFind = (job, key) => (job.milestones || []).find(m => m.milestone_key === key) || null
const msDone = (job, key) => msFind(job, key)?.status === 'done'
const hasKey = (job, key) => !!msFind(job, key)

// HARD RULE (Paul 2026-07-22): drafts and leads NEVER touch the cut list or
// production. Not addable, not counted, not even amber-gated — a lead is not
// work. Lead = pre-contract status OR no locked deposit on the books (the
// same LEAD — NO DEPOSIT rule every other surface shouts about).
const PRE_CONTRACT = new Set(['draft', 'scoping', 'quoted'])
const TERMINAL = new Set(['closed', 'cancelled'])
const isRealWork = (job) => {
  const o = job.order
  if (!o || o.archived) return false
  if (PRE_CONTRACT.has(o.status) || TERMINAL.has(o.status)) return false
  if (rowTotalPaid(o) <= 0) return false
  return true
}

export default function CutListBoard({ onOpenJob }) {
  const [jobs, setJobs] = useState([])
  const [list, setList] = useState([])
  const [proofs, setProofs] = useState(() => new Map())
  const [stoneUp, setStoneUp] = useState(() => new Map())
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [busyId, setBusyId] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    setErr(null)
    try {
      const [js, cl, pf, su] = await Promise.all([
        getJobs({ limit: 2000 }), getStencilCutList(), getCurrentProofsByJob(),
        getStoneUpByJob().catch(() => new Map()),
      ])
      setJobs(js || [])
      setList(cl || [])
      setProofs(pf || new Map())
      setStoneUp(su || new Map())
    } catch (e) {
      setErr(e?.message || 'Failed to load the cut list')
    }
    setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  const jobById = useMemo(() => new Map(jobs.map(j => [j.id, j])), [jobs])
  const listJobs = useMemo(() => list.map(l => jobById.get(l.job_id)).filter(Boolean), [list, jobById])
  const listIds = useMemo(() => new Set(list.map(l => l.job_id)), [list])

  // ── The readiness read (Paul's two gates) ─────────────────────────────────
  const readiness = useCallback((job) => {
    const raw = job.order || null
    const order = raw ? (raw.customer ? raw : { ...raw, customer: job.customer || null }) : null
    const stoneOk = !hasKey(job, 'stone_received') || msDone(job, 'stone_received')
    const state = designStateFor(order, job, proofs)
    const layoutOk = state === 'approved' || msDone(job, 'proof_approved') || !!proofs.get(job.id)?.approved_at
    const cut = msDone(job, 'stencil_cut')
    return { stoneOk, layoutOk, cut, ready: stoneOk && layoutOk && !cut }
  }, [proofs])

  // Every uncut job that carries a stencil leg — the addable universe.
  // Drafts/leads are excluded OUTRIGHT (isRealWork), not gate-chipped.
  const pool = useMemo(
    () => jobs.filter(j => isRealWork(j) && hasKey(j, 'stencil_cut') && !msDone(j, 'stencil_cut')),
    [jobs],
  )
  // THE RED LIST — stencil not cut and NOT on Paul's list, with two ways in:
  // (a) both gates green (ready to cut), or (b) the stone is physically UP ON
  // THE LINE — which alerts regardless of gates (reality outranks paperwork).
  // Stone-up rows scream first.
  const alerts = useMemo(
    () => pool
      .filter(j => !listIds.has(j.id) && (stoneUp.has(j.id) || readiness(j).ready))
      .sort((a, b) => (stoneUp.has(b.id) ? 1 : 0) - (stoneUp.has(a.id) ? 1 : 0)),
    [pool, listIds, readiness, stoneUp],
  )

  const famOf = (j) => properName(j.order?.primary_lastname || customerName(j.customer) || j.order?.order_number || '—')
  const specOf = useMemo(() => {
    const m = new Map()
    for (const j of jobs) {
      if (!j.order || m.has(j.id)) continue
      try {
        const mapped = rowToOrder(j.order, j.customer, j.cemetery)
        m.set(j.id, { die: buildDieSpec(mapped) || null, color: displayGraniteColor(mapped) || null })
      } catch { m.set(j.id, {}) }
    }
    return m
  }, [jobs])

  const counts = useMemo(() => {
    let cut = 0, waiting = 0, readyOnList = 0
    for (const j of listJobs) {
      const r = readiness(j)
      if (r.cut) cut++
      else if (r.ready) readyOnList++
      else waiting++
    }
    return { cut, waiting, readyOnList }
  }, [listJobs, readiness])

  const add = async (jobId) => {
    if (busyId) return
    setBusyId(jobId)
    const res = await addToStencilCutList(jobId)
    if (res.ok) setList(await getStencilCutList())
    else setErr(res.error || 'Could not add to the list')
    setBusyId(null)
  }
  const remove = async (jobId) => {
    if (busyId) return
    setBusyId(jobId)
    const res = await removeFromStencilCutList(jobId)
    if (res.ok) setList(l => l.filter(x => x.job_id !== jobId))
    else setErr(res.error || 'Could not remove from the list')
    setBusyId(null)
  }
  // MARK CUT — the stone ladder's needs_blasting write (stencil_created +
  // stencil_cut flip done); optimistic local milestone apply, no refetch.
  const markCut = async (job) => {
    if (busyId) return
    setBusyId(job.id)
    setErr(null)
    const res = await setOrderStoneStatus(job.id, 'needs_blasting')
    if (res.ok) {
      const plan = orderStatusWritePlan('stone', 'needs_blasting', job)
      setJobs(js => js.map(j => (j.id === job.id ? applyPlanLocally(j, plan) : j)))
    } else {
      setErr(res.error || 'Could not mark it cut')
    }
    setBusyId(null)
  }

  const poolFiltered = useMemo(() => {
    let l = pool.filter(j => !listIds.has(j.id))
    const needle = search.trim().toLowerCase()
    if (needle) {
      l = l.filter(j => [
        j.order?.primary_lastname, customerName(j.customer),
        j.order?.order_number, j.cemetery?.name,
      ].filter(Boolean).join(' ').toLowerCase().includes(needle))
    }
    // Ready first, then family.
    return [...l].sort((a, b) => {
      const ra = readiness(a).ready ? 0 : 1
      const rb = readiness(b).ready ? 0 : 1
      return (ra - rb) || famOf(a).localeCompare(famOf(b))
    })
  }, [pool, listIds, search, readiness])   // eslint-disable-line react-hooks/exhaustive-deps

  const gateChips = (j) => {
    if (!isRealWork(j)) return <span className="scc-chip scc-chip-red">DRAFT / LEAD — not production work</span>
    const r = readiness(j)
    if (r.cut) return <span className="scc-chip scc-chip-green">CUT</span>
    return (
      <>
        {stoneUp.has(j.id) && <span className="scc-chip scc-chip-red">STONE IS UP</span>}
        {r.stoneOk
          ? <span className="scc-chip scc-chip-green">STONE IN SHOP</span>
          : <span className="scc-chip scc-chip-amber">STONE NOT HERE</span>}
        {r.layoutOk
          ? <span className="scc-chip scc-chip-green">LAYOUT APPROVED</span>
          : <span className="scc-chip scc-chip-amber">LAYOUT NOT APPROVED</span>}
      </>
    )
  }

  return (
    <div className="scc">
      <style>{CSS}</style>

      <div className="scc-head">
        <div>
          <h2 className="scc-title">Cut list</h2>
          <div className="scc-sub">
            The stencils we're cutting — hand-picked, never auto-added. A stone earns the red call-out when it's IN THE SHOP with an APPROVED layout and isn't on your list yet — and a stone that's UP ON THE LINE with no stencil cut screams loudest of all. Drafts and leads never appear here — no deposit, no production.
          </div>
        </div>
        <div className="scc-actions">
          <button type="button" className="scc-btn" onClick={load} disabled={loading}>Refresh</button>
          <button type="button" className="scc-btn scc-btn-gold" onClick={() => setPickerOpen(o => !o)}>
            {pickerOpen ? 'Close picker' : '+ Add to cut list'}
          </button>
        </div>
      </div>

      {err && <div className="scc-err">{err}</div>}

      <div className="scc-kpis">
        <div className={`scc-kpi ${alerts.length > 0 ? 'scc-kpi-red' : 'scc-kpi-quiet'}`}>
          <div className="scc-kpi-label">Needs cutting, not on your list</div>
          <div className="scc-kpi-value">{loading ? '—' : alerts.length}</div>
          <div className="scc-kpi-sub">stone up, or here + layout approved</div>
        </div>
        <div className="scc-kpi scc-kpi-gold">
          <div className="scc-kpi-label">Ready to cut</div>
          <div className="scc-kpi-value">{loading ? '—' : counts.readyOnList}</div>
          <div className="scc-kpi-sub">on the list, gates green</div>
        </div>
        <div className="scc-kpi scc-kpi-amber">
          <div className="scc-kpi-label">Waiting on gates</div>
          <div className="scc-kpi-value">{loading ? '—' : counts.waiting}</div>
          <div className="scc-kpi-sub">on the list early</div>
        </div>
        <div className="scc-kpi scc-kpi-green">
          <div className="scc-kpi-label">Cut</div>
          <div className="scc-kpi-value">{loading ? '—' : counts.cut}</div>
          <div className="scc-kpi-sub">headed to blasting</div>
        </div>
      </div>

      {/* THE RED NOTIFICATION — stones that should be on the list and aren't:
          stone-up-no-stencil rows first, then the gate-ready ones. Nothing
          here is ever added for you; each row is one click. */}
      {!loading && alerts.length > 0 && (
        <div className="scc-alert">
          <div className="scc-alert-head">
            {alerts.length} stone{alerts.length === 1 ? '' : 's'} need{alerts.length === 1 ? 's' : ''} cutting and NOT on your list
          </div>
          {alerts.map(j => {
            const spec = specOf.get(j.id) || {}
            const up = stoneUp.has(j.id)
            return (
              <div key={j.id} className="scc-alert-row">
                <button type="button" className="scc-fam" onClick={() => onOpenJob?.(j.id, 'design')}>{famOf(j)}</button>
                <span className="scc-meta">
                  {j.order?.order_number || 'DRAFT'}
                  {spec.die ? ` · ${spec.die}` : ''}{spec.color ? ` · ${spec.color}` : ''}
                </span>
                {up
                  ? <span className="scc-alert-why scc-alert-why-up">STONE IS UP — stencil not cut</span>
                  : <span className="scc-alert-why">stone in shop · layout approved</span>}
                <button type="button" className="scc-btn scc-btn-gold" disabled={busyId === j.id}
                  onClick={() => add(j.id)}>
                  Add to cut list
                </button>
              </div>
            )
          })}
        </div>
      )}

      {pickerOpen && (
        <div className="scc-panel">
          <div className="scc-panel-head">
            <span className="scc-panel-title">Uncut stencils</span>
            <span className="scc-panel-count">{poolFiltered.length}</span>
            <input type="search" className="scc-search" placeholder="Search family, order #, cemetery…"
              value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          {loading ? (
            <div className="scc-empty">Loading…</div>
          ) : poolFiltered.length === 0 ? (
            <div className="scc-empty">Nothing matches — everything is already on your list or already cut.</div>
          ) : (
            <div className="scc-rows">
              {poolFiltered.slice(0, 60).map(j => {
                const spec = specOf.get(j.id) || {}
                return (
                  <div key={j.id} className="scc-row">
                    <div className="scc-row-main">
                      <button type="button" className="scc-fam" onClick={() => onOpenJob?.(j.id, 'design')}>{famOf(j)}</button>
                      <span className="scc-meta">
                        {j.order?.order_number || 'DRAFT'}
                        {spec.die ? ` · ${spec.die}` : ''}{spec.color ? ` · ${spec.color}` : ''}
                        {j.cemetery?.name ? ` · ${j.cemetery.name}` : ''}
                      </span>
                      <span className="scc-chiprow">{gateChips(j)}</span>
                    </div>
                    <button type="button" className="scc-btn" disabled={busyId === j.id} onClick={() => add(j.id)}>Add</button>
                  </div>
                )
              })}
              {poolFiltered.length > 60 && <div className="scc-empty">Narrow the search to see the rest.</div>}
            </div>
          )}
        </div>
      )}

      <div className="scc-listwrap">
        <div className="scc-listhead">Your cut list <span className="scc-panel-count">{listJobs.length}</span></div>
        {loading ? (
          <div className="scc-empty">Loading…</div>
        ) : listJobs.length === 0 ? (
          <div className="scc-empty">Nothing on the list yet — the red call-outs above and the picker feed it, but only when you say so.</div>
        ) : (
          <div className="scc-rows">
            {listJobs.map(j => {
              const r = readiness(j)
              const spec = specOf.get(j.id) || {}
              return (
                <div key={j.id} className={`scc-row${r.cut ? ' scc-row-done' : ''}`}>
                  <div className="scc-row-main">
                    <button type="button" className="scc-fam" onClick={() => onOpenJob?.(j.id, 'design')}>{famOf(j)}</button>
                    <span className="scc-meta">
                      {j.order?.order_number || 'DRAFT'}
                      {spec.die ? ` · ${spec.die}` : ''}{spec.color ? ` · ${spec.color}` : ''}
                      {j.cemetery?.name ? ` · ${j.cemetery.name}` : ''}
                    </span>
                    <span className="scc-chiprow">{gateChips(j)}</span>
                  </div>
                  {!r.cut && isRealWork(j) && (
                    <button type="button" className="scc-btn scc-btn-gold" disabled={busyId === j.id}
                      title={r.ready ? 'Stencil is cut — flips the stone ladder to blasting' : 'Gates are still open — you can still mark it if it really is cut'}
                      onClick={() => markCut(j)}>
                      Mark cut
                    </button>
                  )}
                  <button type="button" className="scc-btn scc-btn-quiet" disabled={busyId === j.id}
                    onClick={() => remove(j.id)}>
                    Remove
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

// Mirror a stone status write plan onto the local job row (no refetch of the
// 2000-job list per tap) — the FoundationsBoard pattern.
function applyPlanLocally(job, plan) {
  if (!plan) return job
  const ms = (job.milestones || []).map(m => {
    if (plan.done?.includes(m.milestone_key) && m.status !== 'done') return { ...m, status: 'done' }
    if (plan.notStarted?.includes(m.milestone_key) && m.status === 'done') return { ...m, status: 'not_started' }
    return m
  })
  return { ...job, milestones: ms }
}

const CSS = `
  .scc { padding: 20px 4px 60px; max-width: 1200px; margin: 0 auto; }
  .scc-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; flex-wrap: wrap; margin-bottom: 14px; }
  .scc-title { font-family: 'Fraunces', Georgia, serif; font-size: 26px; font-weight: 600; color: #0F1419; margin: 0; }
  .scc-sub { font-size: 12.5px; color: #8a8472; margin-top: 4px; max-width: 640px; line-height: 1.5; }
  .scc-actions { display: flex; gap: 8px; }
  .scc-btn { font: inherit; font-size: 12.5px; font-weight: 600; padding: 7px 14px; border-radius: 9px; border: 1px solid #DCD6C8; background: #fff; color: #2a2a27; cursor: pointer; white-space: nowrap; }
  .scc-btn:hover:not(:disabled) { border-color: #9A7209; color: #9A7209; }
  .scc-btn:disabled { opacity: 0.5; cursor: default; }
  .scc-btn-gold { background: #9A7209; border-color: #9A7209; color: #fff; }
  .scc-btn-gold:hover:not(:disabled) { background: #7d5d07; color: #fff; }
  .scc-btn-quiet { border-color: transparent; color: #8a8a85; }
  .scc-err { background: #fdeceb; color: #b3261e; padding: 10px 12px; border-radius: 9px; margin-bottom: 12px; font-size: 13px; }

  .scc-kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin-bottom: 16px; }
  .scc-kpi { background: #fff; border: 1px solid #E6E1D4; border-left-width: 5px; border-radius: 12px; padding: 13px 16px; }
  .scc-kpi-red { border-left-color: #B3261E; background: #FFF7F6; }
  .scc-kpi-red .scc-kpi-value { color: #B3261E; }
  .scc-kpi-quiet { border-left-color: #C9C3B4; }
  .scc-kpi-gold { border-left-color: #9A7209; }
  .scc-kpi-amber { border-left-color: #b8842a; }
  .scc-kpi-green { border-left-color: #1d7a55; }
  .scc-kpi-label { font-size: 11px; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase; color: #8a8472; }
  .scc-kpi-value { font-size: 30px; font-weight: 700; color: #0F1419; line-height: 1.1; font-variant-numeric: tabular-nums; }
  .scc-kpi-sub { font-size: 11px; color: #9a948a; margin-top: 2px; }

  .scc-alert { background: #FFF7F6; border: 1px solid #EFC5C1; border-left: 5px solid #B3261E; border-radius: 14px; padding: 14px 16px; margin-bottom: 16px; }
  .scc-alert-head { font-size: 13px; font-weight: 800; letter-spacing: 0.04em; text-transform: uppercase; color: #B3261E; margin-bottom: 8px; animation: sccpulse 2.2s ease-in-out infinite; display: inline-block; }
  @keyframes sccpulse { 0%,100% { opacity: 1; } 50% { opacity: 0.55; } }
  .scc-alert-row { display: flex; align-items: center; gap: 12px; padding: 9px 0; border-top: 1px solid #F6DEDC; flex-wrap: wrap; }
  .scc-alert-why { font-size: 11.5px; font-weight: 700; color: #1d7a55; }
  .scc-alert-why-up { color: #b3261e; animation: sccpulse 2.2s ease-in-out infinite; }

  .scc-panel, .scc-listwrap { background: #fff; border: 1px solid #E6E1D4; border-radius: 14px; padding: 14px 16px; margin-bottom: 16px; }
  .scc-panel-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 8px; }
  .scc-panel-title, .scc-listhead { font-size: 14px; font-weight: 700; color: #0F1419; }
  .scc-listhead { margin-bottom: 8px; }
  .scc-panel-count { background: rgba(15,20,25,0.08); border-radius: 999px; padding: 1px 10px; font-size: 12.5px; font-weight: 800; }
  .scc-search { font: inherit; font-size: 13px; padding: 7px 11px; border: 1px solid #DCD6C8; border-radius: 9px; flex: 1; min-width: 200px; }
  .scc-rows { display: flex; flex-direction: column; }
  .scc-row { display: flex; align-items: center; gap: 10px; padding: 9px 2px; border-top: 1px solid #F3F0E8; }
  .scc-row:first-child { border-top: none; }
  .scc-row-done { opacity: 0.72; }
  .scc-row-main { flex: 1; min-width: 0; display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .scc-fam { font: inherit; font-size: 14px; font-weight: 700; color: #1e2d3d; background: none; border: none; padding: 0; cursor: pointer; text-align: left; }
  .scc-fam:hover { color: #9A7209; }
  .scc-meta { font-size: 12px; color: #8a8472; }
  .scc-chiprow { display: inline-flex; gap: 5px; flex-wrap: wrap; }
  .scc-chip { font-size: 9.5px; font-weight: 800; letter-spacing: 0.05em; border-radius: 999px; padding: 2px 8px; white-space: nowrap; }
  .scc-chip-green { color: #1d7a55; background: rgba(29,122,85,0.12); }
  .scc-chip-amber { color: #8a5a12; background: rgba(216,144,31,0.15); }
  .scc-chip-red { color: #b3261e; background: rgba(179,38,30,0.12); }
  .scc-empty { font-size: 13px; color: #9a948a; padding: 12px 2px; }
`
