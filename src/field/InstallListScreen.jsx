// =============================================================================
// InstallListScreen — the hand-picked set list, built from the phone
// =============================================================================
// Paul 2026-07-24: "i want to build my lists from the app... search orders and
// add them... see the family name, age of order and cemetery, then click and
// very quickly see the layout, the size stone and the base." Same doctrine as
// the Foundations dig list: install_list is membership only, milestones stay
// the status truth — marking installed drops the row off by itself. The PHOTO
// chip flags Add Photo orders so the ceramic never gets left at the shop.
// INSTALL COMPLETE routes into the existing CompleteScreen (photo-gated), which
// creates the Admin closeout task. "Scheduled runs" keeps the desk-built
// 14-day batches one tap away.
// =============================================================================
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  getInstallList, addToInstallList, removeFromInstallList, getJobs,
  getProofVersions, getProofVersionsByOrder, setBlockReason, installGates,
} from '../lib/stonebooksData'
import { rowToOrder } from '../SalesMode'
import { buildDieSpec, buildBaseSpec, displayGraniteColor, composeGraveLocation } from '../lib/monumentCatalog'
import { familyNameOf, directionsUrl } from './fieldShared'
import InstallsScreen from './InstallsScreen'

const DAY_MS = 86400000
const INSTALL_KEYS = ['installed', 'door_installed', 'work_completed']
const DEAD_ORDER = new Set(['closed', 'cancelled'])

const ageDaysOf = (order, todayMs) => {
  const t = Date.parse(order?.signed_at || order?.created_at || '')
  if (!todayMs || !Number.isFinite(t)) return null
  return Math.max(0, Math.floor((todayMs - t) / DAY_MS))
}
// Paul's age circle: under 2 months green, 2–5 amber, 5+ red.
const AgeDot = ({ n }) => n == null ? null : (
  <span className={`fl-chip ${n < 60 ? 'fl-c-good' : n < 150 ? 'fl-c-warn' : 'fl-c-bad'}`}>{n}d</span>
)
const hasPhoto = (order) => (order?.service_types || []).includes('ADD_PHOTO')
const installMsOf = (job) => (job?.milestones || []).find(m => INSTALL_KEYS.includes(m.milestone_key)) || null

// The four gates, on EVERY install row (Paul 2026-07-31: "I CANT GET OUT
// THERE AND IT NOT BE DONE") — green when good, red when it would strand the
// truck, neutral when the gate doesn't apply to this job.
function GateChips({ order, job }) {
  const g = installGates(order, job)
  return (
    <>
      <span className={`fl-chip ${g.paid ? 'fl-c-good' : 'fl-c-bad'}`}>{g.paid ? 'PAID' : 'NOT PAID'}</span>
      {g.fdn === null
        ? <span className="fl-chip fl-c-neutral">NO FDN</span>
        : <span className={`fl-chip ${g.fdn ? 'fl-c-good' : 'fl-c-bad'}`}>{g.fdn ? 'FDN IN' : 'FDN NOT IN'}</span>}
      {g.permit === null
        ? <span className="fl-chip fl-c-neutral">NO PERMIT NEEDED</span>
        : <span className={`fl-chip ${g.permit ? 'fl-c-good' : 'fl-c-bad'}`}>{g.permit ? 'PERMIT APPROVED' : 'PERMIT NOT APPROVED'}</span>}
      <span className={`fl-chip ${g.blasted ? 'fl-c-good' : 'fl-c-bad'}`}>{g.blasted ? 'BLASTED' : 'NOT BLASTED'}</span>
    </>
  )
}

export default function InstallListScreen({ onOpenJob, onComplete }) {
  const [sub, setSub] = useState('list')          // 'list' | 'runs'
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
      const [l, j] = await Promise.all([getInstallList(), getJobs({})])
      setList(l || []); setJobs(j || []); setErr(null)
    } catch (e) { setErr(e?.message || 'Could not load the set list.') }
  }, [])
  useEffect(() => { reload() }, [reload])
  // CompleteScreen announces a finished install — the row leaves without a remount.
  useEffect(() => {
    const onDone = () => reload()
    window.addEventListener('sb-field-install-done', onDone)
    return () => window.removeEventListener('sb-field-install-done', onDone)
  }, [reload])

  const memberIds = useMemo(() => new Set((list || []).map(r => r.job_id)), [list])
  const listOrder = useMemo(() => new Map((list || []).map((r, i) => [r.job_id, r.sort_order ?? i])), [list])

  // The list, grouped by cemetery (one block = one truck run).
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

  // Add-picker pool: contracted work with an OPEN install step. Gates inform
  // (READY / reason chip), they never wall — Paul's standing rule. Drafts and
  // leads never appear on production lists (standing doctrine).
  const candidates = useMemo(() => {
    if (!jobs) return []
    const query = q.trim().toLowerCase()
    const pool = jobs.filter(j => {
      if (!j.order || memberIds.has(j.id)) return false
      const o = j.order
      if (o.archived || DEAD_ORDER.has(o.status) || !o.signed_at) return false
      const ms = installMsOf(j)
      return !!ms && ms.status !== 'done'
    })
    const scored = pool.map(j => ({
      j,
      gate: setBlockReason(j.order, j),
      age: ageDaysOf(j.order, todayMs),
      hay: [familyNameOf(j.order), j.order.order_number, j.order.cemetery?.name].filter(Boolean).join(' ').toLowerCase(),
    }))
    const hit = query ? scored.filter(c => c.hay.includes(query)) : scored
    hit.sort((a, z) => (a.gate ? 1 : 0) - (z.gate ? 1 : 0) || (z.age ?? 0) - (a.age ?? 0))
    return hit.slice(0, query ? 40 : 30)
  }, [jobs, memberIds, q, todayMs])

  const add = async (jobId) => {
    setBusy(true)
    const r = await addToInstallList(jobId)
    setBusy(false)
    if (r.ok) reload()
  }
  const remove = async (jobId) => {
    setBusy(true)
    await removeFromInstallList(jobId)
    setBusy(false)
    setPeekJob(null)
    reload()
  }

  if (sub === 'runs') {
    return (
      <div>
        <button type="button" className="fl-rowline" onClick={() => setSub('list')}>
          <span style={{ fontSize: 13.5, fontWeight: 700, color: '#6B6456' }}>&#8249; Set list</span>
        </button>
        <InstallsScreen onOpenJob={(ids) => onOpenJob(ids, 'jobs')} />
      </div>
    )
  }

  const total = groups ? groups.reduce((n, [, rows]) => n + rows.length, 0) : null

  return (
    <div>
      <div className="fl-sect">
        <span className="fl-sect-h">Install list</span>
        {total != null && <span className="fl-sect-pill">{total}</span>}
      </div>
      <button type="button" className="fl-btn" onClick={() => { setAddOpen(true); setQ('') }}>
        + Add to list
      </button>

      {err && <div className="fl-empty">{err}</div>}
      {!err && groups === null && <div className="fl-empty">Loading the set list…</div>}
      {!err && groups !== null && groups.length === 0 && (
        <div className="fl-empty">Nothing on the set list — add the installs you're taking out.</div>
      )}

      {(groups || []).map(([cem, rows]) => (
        <div key={cem}>
          <div className="fl-daylabel"><b>{cem}</b> · {rows.length}</div>
          {rows.map(j => (
            <button key={j.id} type="button" className="fl-row fl-row-flex" onClick={() => setPeekJob(j)}>
              <div className="fl-row-main">
                <div className="fl-fam">{familyNameOf(j.order)}</div>
                <div className="fl-spec">{j.order.order_number || 'DRAFT'}</div>
                {/* The four gates, below the name next to the order number
                    (Paul 2026-07-31) — what the truck needs to know. */}
                <div className="fl-chips" style={{ marginTop: 5 }}>
                  <GateChips order={j.order} job={j} />
                </div>
              </div>
              <div className="fl-chips" style={{ flexShrink: 0 }}>
                {hasPhoto(j.order) && <span className="fl-chip fl-c-photo">PHOTO</span>}
                <AgeDot n={ageDaysOf(j.order, todayMs)} />
              </div>
              <span className="fl-chev">&#8250;</span>
            </button>
          ))}
        </div>
      ))}

      <button type="button" className="fl-rowline" onClick={() => setSub('runs')} style={{ marginTop: 14 }}>
        <span style={{ fontSize: 13.5, fontWeight: 700, color: '#6B6456' }}>Scheduled runs (next 14 days) &#8250;</span>
      </button>

      {addOpen && (
        <>
          <div className="fl-sheet-scrim" onClick={() => setAddOpen(false)} />
          <div className="fl-sheet">
            <div className="fl-sheet-grab" />
            <div className="fl-sheet-title">Add to the install list</div>
            <input className="fl-input" autoFocus placeholder="Family, order number, cemetery…"
              value={q} onChange={e => setQ(e.target.value)} />
            <div style={{ maxHeight: '52vh', overflowY: 'auto' }}>
              {candidates.length === 0 && (
                <div className="fl-empty">{q ? 'No matching contracted work with an open install.' : 'Nothing waiting to install.'}</div>
              )}
              {candidates.map(({ j, gate, age }) => (
                <button key={j.id} type="button" className="fl-row fl-row-flex" disabled={busy}
                  onClick={() => add(j.id)}>
                  <div className="fl-row-main">
                    <div className="fl-fam">{familyNameOf(j.order)}</div>
                    <div className="fl-spec">
                      {[j.order.order_number, j.order.cemetery?.name].filter(Boolean).join(' · ')}
                    </div>
                  </div>
                  <div className="fl-chips" style={{ flexShrink: 0 }}>
                    {hasPhoto(j.order) && <span className="fl-chip fl-c-photo">PHOTO</span>}
                    <AgeDot n={age} />
                    <span className={`fl-chip ${gate ? 'fl-c-warn' : 'fl-c-good'}`}>{gate ? gate.toUpperCase() : 'READY'}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      {peekJob && (
        <InstallPeek job={peekJob} onClose={() => setPeekJob(null)}
          onOpenJob={onOpenJob} onComplete={onComplete} onRemove={remove} busy={busy} />
      )}
    </div>
  )
}

// One tap → the whole story: layout image, die, base, color, grave, directions.
function InstallPeek({ job, onClose, onOpenJob, onComplete, onRemove, busy }) {
  const [img, setImg] = useState(undefined)   // undefined=loading, null=none
  const [zoom, setZoom] = useState(false)
  const o = job.order
  const orderId = job.order_id || o?.id

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const jobProofs = job?.id ? await getProofVersions(job.id).catch(() => []) : []
        const ordProofs = orderId ? await getProofVersionsByOrder(orderId).catch(() => []) : []
        const all = [...(jobProofs || []), ...(ordProofs || [])]
        const best = all.find(p => p.approved_at) || all.find(p => p.is_current) || all[0]
        const url = best?.image_url || best?.url || null
        if (!cancelled && url) { setImg({ url, approved: !!best.approved_at }); return }
        const mapped = o ? rowToOrder(o, o.customer, o.cemetery) : null
        const designImg = mapped?.designs?.[0]?.snapshot?.img || null
        if (!cancelled) setImg(designImg ? { url: designImg, approved: false, design: true } : null)
      } catch { if (!cancelled) setImg(null) }
    })()
    return () => { cancelled = true }
  }, [job, orderId, o])

  const mapped = useMemo(() => (o ? rowToOrder(o, o.customer, o.cemetery) : null), [o])
  const die = mapped ? buildDieSpec(mapped) : ''
  const base = mapped ? buildBaseSpec(mapped) : ''
  const granite = mapped?.graniteColor ? displayGraniteColor(mapped.graniteColor) : ''
  const grave = composeGraveLocation(o) || o?.grave_location || ''
  const dir = directionsUrl(o?.cemetery)

  return (
    <>
      <div className="fl-sheet-scrim" onClick={onClose} />
      <div className="fl-sheet">
        <div className="fl-sheet-grab" />
        <div className="fl-sheet-title">{familyNameOf(o)}</div>
        <div className="fl-spec" style={{ marginTop: -6, marginBottom: 8 }}>
          {[o?.order_number, o?.cemetery?.name].filter(Boolean).join(' · ')}
        </div>
        <div className="fl-chips" style={{ marginBottom: 10 }}>
          <GateChips order={o} job={job} />
        </div>

        {hasPhoto(o) && (
          <div className="fl-photo-alert">PHOTO ON THIS ORDER — bring the ceramic photo</div>
        )}

        {img === undefined && <div className="fl-empty" style={{ padding: '10px 0' }}>Loading layout…</div>}
        {img === null && <div className="fl-empty" style={{ padding: '10px 0' }}>No layout on this order.</div>}
        {img && (
          <div className="fl-layout-wrap" onClick={() => setZoom(true)} role="button" tabIndex={0}
            onKeyDown={e => { if (e.key === 'Enter') setZoom(true) }}>
            <img src={img.url} alt="Layout" loading="lazy" />
          </div>
        )}

        <div style={{ margin: '10px 0 12px' }}>
          {die && <div className="fl-statusrow"><span>Die</span><b>{die}</b></div>}
          {base && <div className="fl-statusrow"><span>Base</span><b>{base}</b></div>}
          {granite && <div className="fl-statusrow"><span>Granite</span><b>{granite}</b></div>}
          {grave && <div className="fl-statusrow"><span>Grave</span><b>{grave}</b></div>}
        </div>

        <button type="button" className="fl-btn fl-btn-green" disabled={busy}
          onClick={() => { onClose(); onComplete?.({ jobId: job.id, orderId }) }}>
          Install complete
        </button>
        <button type="button" className="fl-btn fl-btn-ghost"
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
      {zoom && img && (
        <div className="fl-zoom-overlay" onClick={() => setZoom(false)}>
          <button type="button" className="fl-zoom-close" aria-label="Close" onClick={() => setZoom(false)}>×</button>
          <img src={img.url} alt="Layout, zoomed" />
        </div>
      )}
    </>
  )
}
