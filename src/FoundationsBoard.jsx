// =============================================================================
// FoundationsBoard — Jobs › Foundations (FOUNDATIONS-LIST sprint, 2026-07-14)
// =============================================================================
// The foundation work queue: Paul hand-picks which foundations we're actually
// digging/pouring (out of the full needs-a-foundation pool) onto a persisted
// list (foundation_list table), grouped by cemetery so a dig run is obvious.
// Each row: family, section/plot, base size, a one-tap status stepper
// (Not started → Dug → Poured → Ready), and a GPS pin.
//
// Status writes ride the EXISTING foundation milestone ladder
// (setOrderFdnStatus) — so "Ready" here is the same FDN-in signal the
// Installation gates and the field app read. No parallel status store.
// GPS pins write orders.field_location — the same jsonb the field app's
// "Mark exact spot" uses, so pins made anywhere show everywhere.
// =============================================================================
import { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from './lib/supabase'
import {
  getJobs, getFoundationList, addToFoundationList, removeFromFoundationList,
  deriveFdnStatus, fdnStatusLabel, setOrderFdnStatus, orderStatusWritePlan,
  customerName, getCurrentStaffName,
} from './lib/stonebooksData'
import { rowToOrder } from './SalesMode'
import { buildBaseSpec, composeGraveLocation } from './lib/monumentCatalog'

// The 4 working stages, in dig order. need_map / drop_off jobs read as
// stage 0 on the stepper but keep their true label as a side tag.
const STAGES = [
  { code: 'not_in', label: 'Not started' },
  { code: 'dug',    label: 'Dug' },
  { code: 'poured', label: 'Poured' },
  { code: 'in',     label: 'Ready' },
]
const STAGE_IDX = { not_in: 0, need_map: 0, drop_off: 0, dug: 1, poured: 2, in: 3 }

export default function FoundationsBoard({ onOpenJob }) {
  const [jobs, setJobs] = useState([])
  const [list, setList] = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [cemFilter, setCemFilter] = useState('all')
  const [busyId, setBusyId] = useState(null)
  const [pinFor, setPinFor] = useState(null)   // job id with the pin form open

  const load = useCallback(async () => {
    setLoading(true)
    setErr(null)
    try {
      const [js, fl] = await Promise.all([getJobs({ limit: 1000 }), getFoundationList()])
      setJobs(js || [])
      setList(fl || [])
    } catch (e) {
      setErr(e?.message || 'Failed to load foundations')
    }
    setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  const jobById = useMemo(() => new Map(jobs.map(j => [j.id, j])), [jobs])

  // My list — the picked jobs, in added order, joined to live job rows.
  const listJobs = useMemo(
    () => list.map(l => jobById.get(l.job_id)).filter(Boolean),
    [list, jobById],
  )
  const listIds = useMemo(() => new Set(list.map(l => l.job_id)), [list])

  // The pool — every job whose foundation ladder is open (not N/A, not in)
  // and isn't the cemetery's to pour. This is the "300 need a foundation".
  const pool = useMemo(() => jobs.filter(j => {
    const s = deriveFdnStatus(j)
    if (s === 'na' || s === 'in') return false
    if (j.order?.foundation_type === 'Cemetery Foundation') return false
    return true
  }), [jobs])

  // Display specs (base size + section) for the jobs we actually render.
  const specById = useMemo(() => {
    const m = new Map()
    for (const j of [...listJobs, ...pool]) {
      if (m.has(j.id) || !j.order) continue
      let base = null
      try {
        const mapped = rowToOrder(j.order, j.customer, j.cemetery)
        base = buildBaseSpec(mapped) || null
      } catch { /* spec is best-effort */ }
      m.set(j.id, { base, grave: composeGraveLocation(j.order) || null })
    }
    return m
  }, [listJobs, pool])

  // Group my list by cemetery so a dig run reads as one block.
  const groups = useMemo(() => {
    const m = new Map()
    for (const j of listJobs) {
      const name = j.cemetery?.name || 'No cemetery on file'
      if (!m.has(name)) m.set(name, [])
      m.get(name).push(j)
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [listJobs])

  const counts = useMemo(() => {
    const c = { todig: 0, dug: 0, poured: 0, ready: 0 }
    for (const j of listJobs) {
      const i = STAGE_IDX[deriveFdnStatus(j)] ?? 0
      if (i === 0) c.todig++
      else if (i === 1) c.dug++
      else if (i === 2) c.poured++
      else c.ready++
    }
    return c
  }, [listJobs])

  // One-tap status write + optimistic local milestone flip (no refetch).
  const setStage = async (job, code) => {
    if (busyId) return
    setBusyId(job.id)
    setErr(null)
    const res = await setOrderFdnStatus(job.id, code)
    if (res.ok) {
      const plan = orderStatusWritePlan('fdn', code)
      setJobs(js => js.map(j => (j.id === job.id ? applyFdnPlanLocally(j, plan) : j)))
    } else {
      setErr(res.error || 'Status update failed')
    }
    setBusyId(null)
  }

  const add = async (jobId) => {
    setBusyId(jobId)
    const res = await addToFoundationList(jobId)
    if (res.ok) setList(await getFoundationList())
    else setErr(res.error || 'Could not add to the list')
    setBusyId(null)
  }
  const remove = async (jobId) => {
    setBusyId(jobId)
    const res = await removeFromFoundationList(jobId)
    if (res.ok) setList(l => l.filter(x => x.job_id !== jobId))
    else setErr(res.error || 'Could not remove from the list')
    setBusyId(null)
  }

  // After a pin save, patch the order row locally so the row updates in place.
  const onPinSaved = (jobId, fieldLocation) => {
    setJobs(js => js.map(j => (j.id === jobId ? { ...j, order: { ...j.order, field_location: fieldLocation } } : j)))
    setPinFor(null)
  }

  // Picker filters
  const cemNames = useMemo(() => {
    const s = new Set(pool.map(j => j.cemetery?.name).filter(Boolean))
    return [...s].sort((a, b) => a.localeCompare(b))
  }, [pool])
  const poolFiltered = useMemo(() => {
    let l = pool.filter(j => !listIds.has(j.id))
    if (cemFilter !== 'all') l = l.filter(j => (j.cemetery?.name || '') === cemFilter)
    const needle = search.trim().toLowerCase()
    if (needle) {
      l = l.filter(j => [
        j.order?.primary_lastname, customerName(j.customer),
        j.order?.order_number, j.cemetery?.name,
      ].filter(Boolean).join(' ').toLowerCase().includes(needle))
    }
    return [...l].sort((a, b) => (a.cemetery?.name || 'zz').localeCompare(b.cemetery?.name || 'zz'))
  }, [pool, listIds, cemFilter, search])

  return (
    <div className="fdncc">
      <style>{FDNCC_CSS}</style>

      <div className="fdncc-cmd">
        <div>
          <h2 className="fdncc-title">Foundations</h2>
          <div className="fdncc-purpose">
            The foundations we dig and pour — hand-picked from the {pool.length} jobs that need one.
            Tap a stage when it's done; Ready flips the job's foundation gate in Installation.
          </div>
        </div>
        <div className="fdncc-actions">
          <button type="button" className="fdncc-btn" onClick={load} disabled={loading}>Refresh</button>
          <button type="button" className="fdncc-btn fdncc-btn-gold" onClick={() => setPickerOpen(o => !o)}>
            {pickerOpen ? 'Close picker' : '+ Add foundations'}
          </button>
        </div>
      </div>

      {err && <div className="fdncc-err">{err}</div>}

      <div className="fdncc-kpis">
        <div className="fdncc-kpi fdncc-kpi-amber">
          <div className="fdncc-kpi-label">To dig</div>
          <div className="fdncc-kpi-value">{loading ? '—' : counts.todig}</div>
          <div className="fdncc-kpi-sub">on your list, not started</div>
        </div>
        <div className="fdncc-kpi fdncc-kpi-blue">
          <div className="fdncc-kpi-label">Dug</div>
          <div className="fdncc-kpi-value">{loading ? '—' : counts.dug}</div>
          <div className="fdncc-kpi-sub">waiting on the pour</div>
        </div>
        <div className="fdncc-kpi fdncc-kpi-purple">
          <div className="fdncc-kpi-label">Poured</div>
          <div className="fdncc-kpi-value">{loading ? '—' : counts.poured}</div>
          <div className="fdncc-kpi-sub">curing</div>
        </div>
        <div className="fdncc-kpi fdncc-kpi-green">
          <div className="fdncc-kpi-label">Ready</div>
          <div className="fdncc-kpi-value">{loading ? '—' : counts.ready}</div>
          <div className="fdncc-kpi-sub">good to set</div>
        </div>
      </div>

      {pickerOpen && (
        <div className="fdncc-panel">
          <div className="fdncc-panel-head">
            <span className="fdncc-panel-title">Needs a foundation</span>
            <span className="fdncc-panel-count">{poolFiltered.length}</span>
            <input
              type="search" className="fdncc-search" placeholder="Search family, order #, cemetery…"
              value={search} onChange={e => setSearch(e.target.value)}
            />
            <select className="fdncc-select" value={cemFilter} onChange={e => setCemFilter(e.target.value)}>
              <option value="all">All cemeteries</option>
              {cemNames.map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
          {loading ? (
            <div className="fdncc-empty">Loading…</div>
          ) : poolFiltered.length === 0 ? (
            <div className="fdncc-empty">Nothing matches — every match is already on your list.</div>
          ) : (
            <div className="fdncc-rows">
              {poolFiltered.slice(0, 60).map(j => {
                const spec = specById.get(j.id) || {}
                return (
                  <div key={j.id} className="fdncc-row fdncc-row-pick">
                    <div>
                      <div className="fdncc-row-fam">{j.order?.primary_lastname || customerName(j.customer) || '—'}</div>
                      <div className="fdncc-row-sub">{j.order?.order_number || j.id.slice(0, 8)}</div>
                    </div>
                    <div className="fdncc-row-meta">{j.cemetery?.name || '—'}</div>
                    <div className="fdncc-row-meta">{spec.grave || '—'}</div>
                    <div className="fdncc-row-meta">{spec.base || 'No base'}</div>
                    <span className="fdncc-tag">{fdnStatusLabel(deriveFdnStatus(j))}</span>
                    <button type="button" className="fdncc-btn fdncc-btn-sm" disabled={busyId === j.id} onClick={() => add(j.id)}>
                      + Add
                    </button>
                  </div>
                )
              })}
              {poolFiltered.length > 60 && (
                <div className="fdncc-empty">Showing the first 60 — narrow it with search or the cemetery filter.</div>
              )}
            </div>
          )}
        </div>
      )}

      {loading ? (
        <div className="fdncc-panel"><div className="fdncc-empty">Loading your list…</div></div>
      ) : listJobs.length === 0 ? (
        <div className="fdncc-panel">
          <div className="fdncc-empty">
            Nothing on your list yet. Hit “+ Add foundations” and pick the ones you're doing.
          </div>
        </div>
      ) : (
        groups.map(([cemName, cemJobs]) => (
          <div key={cemName} className="fdncc-panel">
            <div className="fdncc-panel-head">
              <span className="fdncc-panel-title">{cemName}</span>
              <span className="fdncc-panel-count">{cemJobs.length}</span>
            </div>
            <div className="fdncc-rows">
              {cemJobs.map(j => {
                const spec = specById.get(j.id) || {}
                const cur = deriveFdnStatus(j)
                const curIdx = STAGE_IDX[cur] ?? 0
                const loc = j.order?.field_location || null
                const hasPin = !!(loc && loc.lat)
                const sideTag = (cur === 'need_map' || cur === 'drop_off') ? fdnStatusLabel(cur) : null
                return (
                  <div key={j.id} className="fdncc-item">
                    <div className="fdncc-row">
                      <button type="button" className="fdncc-fam-btn" onClick={() => onOpenJob?.(j.id)} title="Open job">
                        <div className="fdncc-row-fam">{j.order?.primary_lastname || customerName(j.customer) || '—'}</div>
                        <div className="fdncc-row-sub">{j.order?.order_number || j.id.slice(0, 8)}</div>
                      </button>
                      <div className="fdncc-row-meta">
                        {spec.grave || 'No section on file'}
                        {j.order?.foundation_type === 'Strip' && <span className="fdncc-tag fdncc-tag-dim">Strip</span>}
                        {sideTag && <span className="fdncc-tag fdncc-tag-warn">{sideTag}</span>}
                      </div>
                      <div className="fdncc-row-meta">{spec.base || 'No base'}</div>
                      <div className="fdncc-steps" role="group" aria-label="Foundation status">
                        {STAGES.map((s, i) => (
                          <button
                            key={s.code} type="button"
                            className={`fdncc-step ${i <= curIdx ? 'on' : ''} ${i === curIdx ? 'cur' : ''}`}
                            disabled={busyId === j.id || s.code === cur}
                            onClick={() => setStage(j, s.code)}
                            title={s.code === cur ? 'Current' : `Set to ${s.label}`}
                          >
                            {s.label}
                          </button>
                        ))}
                      </div>
                      <div className="fdncc-rowend">
                        {hasPin && (
                          <a className="fdncc-pinlink" href={`https://maps.apple.com/?daddr=${loc.lat},${loc.lng}`} target="_blank" rel="noreferrer">
                            Open pin
                          </a>
                        )}
                        <button type="button" className="fdncc-btn fdncc-btn-sm" onClick={() => setPinFor(p => (p === j.id ? null : j.id))}>
                          {hasPin ? 'Re-pin' : 'Pin spot'}
                        </button>
                        <button type="button" className="fdncc-btn fdncc-btn-sm fdncc-btn-ghost" disabled={busyId === j.id} onClick={() => remove(j.id)} title="Remove from the list">
                          Remove
                        </button>
                      </div>
                    </div>
                    {loc?.note && !pinFor && (
                      <div className="fdncc-pinnote">{loc.note}</div>
                    )}
                    {pinFor === j.id && (
                      <PinSpotForm job={j} onSaved={onPinSaved} onCancel={() => setPinFor(null)} onError={setErr} />
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        ))
      )}
    </div>
  )
}

// Local optimistic mirror of setOrderFdnStatus's milestone batch write — same
// shape _applyMilestonePlan uses, so the derived status matches a refetch.
function applyFdnPlanLocally(job, plan) {
  if (!plan) return job
  const today = new Date().toISOString().slice(0, 10)
  const milestones = (job.milestones || []).map(m => {
    if (plan.done?.includes(m.milestone_key))       return { ...m, status: 'done', status_date: today }
    if (plan.notStarted?.includes(m.milestone_key)) return { ...m, status: 'not_started', status_date: null }
    if (plan.notNeeded?.includes(m.milestone_key))  return { ...m, status: 'not_needed', status_date: null }
    return m
  })
  return { ...job, milestones }
}

// GPS + note → orders.field_location. Same jsonb the field app's "Mark exact
// spot" writes, minus the photo (that stays a phone/field-app affordance).
// An existing photo on the pin is preserved.
function PinSpotForm({ job, onSaved, onCancel, onError }) {
  const prev = job.order?.field_location || null
  const [note, setNote] = useState(prev?.note || '')
  const [gps, setGps] = useState(null)   // {lat,lng,accuracy} | 'error' | null=asking
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!navigator.geolocation) { setGps('error'); return }
    navigator.geolocation.getCurrentPosition(
      p => setGps({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: Math.round(p.coords.accuracy) }),
      () => setGps('error'),
      { enableHighAccuracy: true, timeout: 12000 },
    )
  }, [])

  const save = async () => {
    if (!job.order?.id) return
    setBusy(true)
    const next = {
      lat: gps && gps !== 'error' ? gps.lat : prev?.lat || null,
      lng: gps && gps !== 'error' ? gps.lng : prev?.lng || null,
      accuracy: gps && gps !== 'error' ? gps.accuracy : prev?.accuracy || null,
      note: note.trim() || null,
      photoUrl: prev?.photoUrl || null,
      markedAt: new Date().toISOString(),
      markedBy: (await getCurrentStaffName()) || null,
    }
    const { error } = await supabase.from('orders').update({ field_location: next }).eq('id', job.order.id)
    setBusy(false)
    if (error) { onError?.(error.message); return }
    onSaved(job.id, next)
  }

  return (
    <div className="fdncc-pinform">
      <div className="fdncc-pinform-gps" data-state={gps === 'error' ? 'err' : gps ? 'ok' : 'wait'}>
        {gps === null ? 'Getting your position…'
          : gps === 'error' ? 'No GPS here — the note still saves; drop the pin from your phone at the grave.'
          : `Locked: ${gps.lat.toFixed(6)}, ${gps.lng.toFixed(6)} (±${gps.accuracy} m)`}
      </div>
      <input
        className="fdncc-input" type="text" value={note}
        placeholder="Where exactly — e.g. row 4, third stone left of the maple"
        onChange={e => setNote(e.target.value)}
      />
      <div className="fdncc-pinform-actions">
        <button type="button" className="fdncc-btn fdncc-btn-sm fdncc-btn-ghost" onClick={onCancel} disabled={busy}>Cancel</button>
        <button type="button" className="fdncc-btn fdncc-btn-sm" onClick={save} disabled={busy || gps === null || (gps === 'error' && !note.trim())}>
          {busy ? 'Saving…' : 'Save pin'}
        </button>
      </div>
    </div>
  )
}

const FDNCC_CSS = `
  .fdncc { background: #0E1116; border-radius: 16px; padding: 22px 24px 26px; color: #e6e9ef;
    font-family: var(--font-b, 'Lato'), 'Helvetica Neue', sans-serif; }
  .fdncc * { box-sizing: border-box; }

  .fdncc-cmd { display: flex; align-items: flex-start; justify-content: space-between; gap: 20px; flex-wrap: wrap; margin-bottom: 22px; }
  .fdncc-title { font-size: 22px; font-weight: 700; color: #f4f6fa; margin: 0; letter-spacing: -0.01em; }
  .fdncc-purpose { font-size: 13px; color: #8b95a5; margin-top: 4px; max-width: 620px; }
  .fdncc-actions { display: flex; gap: 8px; }
  .fdncc-btn { font: inherit; font-size: 13px; font-weight: 600; padding: 7px 14px; border-radius: 8px; border: 1px solid #2a313c; background: #1a212b; color: #e6e9ef; cursor: pointer; }
  .fdncc-btn:hover { background: #232c38; border-color: #3a4452; }
  .fdncc-btn:disabled { opacity: 0.5; cursor: default; }
  .fdncc-btn-gold { border-color: #6b5310; background: #2a2210; color: #e7c86a; }
  .fdncc-btn-gold:hover { background: #362c14; border-color: #8a6c15; }
  .fdncc-btn-sm { font-size: 12px; padding: 5px 10px; }
  .fdncc-btn-ghost { background: transparent; color: #8b95a5; }
  .fdncc-err { background: #1c1416; border: 1px solid #5c2a2a; color: #f87171; padding: 10px 12px; border-radius: 9px; margin-bottom: 14px; }

  .fdncc-kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; margin-bottom: 18px; }
  .fdncc-kpi { background: #11151c; border: 1px solid #20262f; border-left-width: 3px; border-radius: 11px; padding: 13px 15px; }
  .fdncc-kpi-label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: #8b95a5; }
  .fdncc-kpi-value { font-family: var(--font-m, 'JetBrains Mono'), monospace; font-size: 30px; font-weight: 700; line-height: 1.1; margin: 4px 0 3px; color: #f4f6fa; }
  .fdncc-kpi-sub { font-size: 11.5px; color: #6f7a8a; }
  .fdncc-kpi-amber  { border-left-color: #fbbf24; }
  .fdncc-kpi-blue   { border-left-color: #60a5fa; }
  .fdncc-kpi-purple { border-left-color: #a78bfa; }
  .fdncc-kpi-green  { border-left-color: #34d399; }

  .fdncc-panel { background: #11151c; border: 1px solid #20262f; border-radius: 12px; padding: 15px 17px; margin-bottom: 16px; }
  .fdncc-panel-head { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; flex-wrap: wrap; }
  .fdncc-panel-title { font-size: 13px; font-weight: 700; color: #f4f6fa; text-transform: uppercase; letter-spacing: 0.04em; }
  .fdncc-panel-count { font-family: var(--font-m, 'JetBrains Mono'), monospace; font-size: 12px; font-weight: 700; padding: 1px 8px; border-radius: 999px; background: #1a212b; color: #c7cedb; }
  .fdncc-search { font: inherit; font-size: 13px; margin-left: auto; padding: 6px 10px; border-radius: 8px; border: 1px solid #2a313c; background: #0E1116; color: #e6e9ef; min-width: 240px; }
  .fdncc-select { font: inherit; font-size: 13px; padding: 6px 10px; border-radius: 8px; border: 1px solid #2a313c; background: #0E1116; color: #e6e9ef; }
  .fdncc-empty { color: #6f7a8a; font-size: 13px; padding: 10px 2px; }

  .fdncc-rows { display: flex; flex-direction: column; }
  .fdncc-item { border-top: 1px solid #1c222b; }
  .fdncc-row { display: grid; grid-template-columns: 1.2fr 1.3fr 1fr auto auto; gap: 12px; align-items: center; padding: 10px 4px; }
  .fdncc-row-pick { grid-template-columns: 1.2fr 1fr 1fr 1fr auto auto; border-top: 1px solid #1c222b; }
  .fdncc-fam-btn { font: inherit; text-align: left; background: none; border: none; padding: 0; cursor: pointer; color: inherit; }
  .fdncc-fam-btn:hover .fdncc-row-fam { text-decoration: underline; }
  .fdncc-row-fam { font-size: 14px; font-weight: 700; color: #f4f6fa; }
  .fdncc-row-sub { font-family: var(--font-m, 'JetBrains Mono'), monospace; font-size: 11px; color: #6f7a8a; }
  .fdncc-row-meta { font-size: 12.5px; color: #c7cedb; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .fdncc-tag { font-size: 9.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; padding: 2px 8px; border-radius: 999px; background: #1a212b; color: #c7cedb; white-space: nowrap; }
  .fdncc-tag-dim { color: #8b95a5; }
  .fdncc-tag-warn { background: #322712; color: #fbbf24; }

  .fdncc-steps { display: inline-flex; gap: 4px; }
  .fdncc-step { font: inherit; font-size: 11.5px; font-weight: 600; padding: 5px 10px; border-radius: 999px; border: 1px solid #2a313c; background: #151a22; color: #8b95a5; cursor: pointer; white-space: nowrap; }
  .fdncc-step:hover { border-color: #3a4452; color: #e6e9ef; }
  .fdncc-step.on { background: #14261f; border-color: #1f4737; color: #34d399; }
  .fdncc-step.cur { box-shadow: inset 0 0 0 1px #34d399; cursor: default; }
  .fdncc-step:disabled { cursor: default; }

  .fdncc-rowend { display: flex; align-items: center; gap: 6px; justify-content: flex-end; }
  .fdncc-pinlink { font-size: 12px; font-weight: 600; color: #60a5fa; text-decoration: none; white-space: nowrap; }
  .fdncc-pinlink:hover { text-decoration: underline; }
  .fdncc-pinnote { font-size: 12px; color: #8b95a5; padding: 0 4px 10px; margin-top: -4px; }

  .fdncc-pinform { display: flex; flex-direction: column; gap: 8px; padding: 4px 4px 12px; }
  .fdncc-pinform-gps { font-family: var(--font-m, 'JetBrains Mono'), monospace; font-size: 11.5px; }
  .fdncc-pinform-gps[data-state='ok'] { color: #34d399; }
  .fdncc-pinform-gps[data-state='err'] { color: #f87171; }
  .fdncc-pinform-gps[data-state='wait'] { color: #8b95a5; }
  .fdncc-input { font: inherit; font-size: 13px; padding: 7px 10px; border-radius: 8px; border: 1px solid #2a313c; background: #0E1116; color: #e6e9ef; width: 100%; max-width: 520px; }
  .fdncc-pinform-actions { display: flex; gap: 8px; }

  @media (max-width: 900px) {
    .fdncc { padding: 16px 14px 20px; }
    .fdncc-row, .fdncc-row-pick { grid-template-columns: 1fr; gap: 6px; }
    .fdncc-rowend { justify-content: flex-start; }
    .fdncc-search { min-width: 0; width: 100%; margin-left: 0; }
  }
`
