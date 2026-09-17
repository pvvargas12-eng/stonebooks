// =============================================================================
// HotListTab — THE Hot List: its own top-level tab, above Today (HOT-LIST-2)
// =============================================================================
// Paul 2026-09-17: "the hotlist is terrible I want that to be a tab even above
// Today in a different color so it stands out and you can add and remove things
// from the hotlist. Stones to be blasted, To be set, inscriptions, acid wash,
// other.. THIS IS INCREDIBLY IMPORTANT SO WE COULD SEE WHATS HOT ADD AND REMOVE
// STUFF FROM IT... ALSO FOR ADMIN I WANT TO BE ABLE TO ADD HOT THINGS TO THEM."
//
// v2 doctrine — the list is HAND-CURATED (hot_list_items), not derived:
//   • Six lanes: Stones to be blasted / To be set / Inscriptions / Acid wash /
//     Admin / Other. Add and remove in every lane; Done stamps history.
//   • Items link a job (search any active work) or are free text (Admin/Other
//     errands live here too). Linked items wear the live heat chips — due
//     tone, age, paid-in-full — and click through to the order.
//   • Each lane's add-panel SUGGESTS candidates from the stores the old
//     auto-list read (blasting queue, green-gated set list, inscription /
//     acid-wash work) so building the list is two taps, never a hunt.
// =============================================================================
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  HOT_CATEGORIES, getHotListItems, addHotListItem, markHotListItemDone, removeHotListItem,
  getJobs, getProductionComponents, getInstallList,
  installGates, dueDateTone, dueRelativeText,
  rowTotalPaid, rowBalanceDue, properName, fmtUSD, customerName,
} from './lib/stonebooksData'

const INSTALL_KEYS = ['installed', 'door_installed', 'work_completed']
const LEAD_STATUSES = new Set(['draft', 'scoping', 'quoted'])
const TERMINAL_STATUSES = new Set(['closed', 'cancelled'])
const SUPER_HOT_AT = 4

function isRealWork(order) {
  if (!order || order.archived) return false
  if (LEAD_STATUSES.has(order.status) || TERMINAL_STATUSES.has(order.status)) return false
  return rowTotalPaid(order) > 0
}

function ageDays(order) {
  const anchor = order?.signed_at || order?.created_at
  if (!anchor) return null
  const d = Math.floor((Date.now() - new Date(anchor).getTime()) / 86400000)
  return Number.isFinite(d) && d >= 0 ? d : null
}

function heatScore(order) {
  let s = 0
  const tone = dueDateTone(order?.target_completion_date)
  if (tone === 'red') s += 3
  else if (tone === 'amber') s += 2
  const age = ageDays(order)
  if (age != null) {
    if (age >= 180) s += 2
    else if (age >= 90) s += 1
  }
  if (rowTotalPaid(order) > 0 && rowBalanceDue(order) <= 0) s += 2
  return s
}

const installedDone = (job) =>
  (job?.milestones || []).some(m => INSTALL_KEYS.includes(m.milestone_key) && m.status === 'done')

const familyOf = (order) => properName(order?.primary_lastname
  || [order?.customer?.first_name, order?.customer?.last_name].filter(Boolean).join(' ') || '—')

const hasService = (order, code) => {
  const st = order?.service_types
  return Array.isArray(st) ? st.includes(code) : false
}

export default function HotListTab({ onOpenOrderDetail, onOpenJob, onCountChange }) {
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState(null)
  const [items, setItems] = useState([])
  const [jobs, setJobs] = useState([])
  const [comps, setComps] = useState([])
  const [installList, setInstallList] = useState([])
  const [addFor, setAddFor] = useState(null)   // lane code with the add panel open
  const [busyId, setBusyId] = useState(null)

  const load = useCallback(async () => {
    setLoading(true); setErr(null)
    try {
      const [it, js, cs, il] = await Promise.all([
        getHotListItems(),
        getJobs({ limit: 2000 }),
        getProductionComponents(),
        getInstallList(),
      ])
      setItems(it || []); setJobs(js || []); setComps(cs || []); setInstallList(il || [])
    } catch (e) { setErr(e?.message || 'Failed to load the hot list') }
    setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  // Keep the sidebar badge honest without a refetch round-trip.
  useEffect(() => { onCountChange?.(items.length) }, [items.length, onCountChange])

  const jobById = useMemo(() => new Map(jobs.map(j => [j.id, j])), [jobs])
  const jobByOrderId = useMemo(() => {
    const m = new Map()
    for (const j of jobs) if (j.order?.id && !m.has(j.order.id)) m.set(j.order.id, j)
    return m
  }, [jobs])
  const hotJobIdsByLane = useMemo(() => {
    const m = new Map()
    for (const it of items) {
      if (!it.job_id) continue
      if (!m.has(it.category)) m.set(it.category, new Set())
      m.get(it.category).add(it.job_id)
    }
    return m
  }, [items])

  // Enrich a stored item with the live job/order for chips + click-through.
  const enrich = useCallback((it) => {
    const job = (it.job_id && jobById.get(it.job_id)) || (it.order_id && jobByOrderId.get(it.order_id)) || null
    const order = job?.order || null
    return {
      ...it,
      job, order,
      family: order ? familyOf(order) : it.title,
      orderNumber: order?.order_number || null,
      cemetery: job?.cemetery?.name || order?.cemetery?.name || null,
      score: order ? heatScore(order) : 0,
      age: order ? ageDays(order) : null,
      dueText: order ? dueRelativeText(order.target_completion_date) : null,
      dueTone: order ? dueDateTone(order.target_completion_date) : null,
      paidInFull: order ? (rowTotalPaid(order) > 0 && rowBalanceDue(order) <= 0) : false,
      balance: order ? rowBalanceDue(order) : 0,
    }
  }, [jobById, jobByOrderId])

  const lanes = useMemo(() => {
    const by = new Map(HOT_CATEGORIES.map(c => [c.code, []]))
    for (const it of items) {
      const row = enrich(it)
      ;(by.get(it.category) || by.get('other')).push(row)
    }
    for (const rows of by.values()) {
      rows.sort((a, b) => b.score - a.score || (b.age ?? 0) - (a.age ?? 0) || String(a.created_at).localeCompare(String(b.created_at)))
    }
    return by
  }, [items, enrich])

  const totalOpen = items.length
  const superHot = useMemo(() =>
    [...lanes.values()].flat().filter(r => r.score >= SUPER_HOT_AT).length, [lanes])

  // ── Suggestion pools per lane (the old auto-list's eyes, now advisors) ──
  const suggestions = useMemo(() => {
    const out = { blast: [], set: [], inscription: [], acid_wash: [], admin: [], other: [] }
    const blastJobs = new Set()
    for (const c of comps) {
      if (c.track !== 'new_stone' || c.component_type === 'base') continue
      if (!c.on_floor || c.current_phase !== 'stencil_stuck') continue
      if (c.job_id) blastJobs.add(c.job_id)
    }
    for (const jobId of blastJobs) {
      const job = jobById.get(jobId)
      if (job?.order && isRealWork(job.order)) out.blast.push(job)
    }
    const installSet = new Set(installList.map(r => r.job_id))
    for (const jobId of installSet) {
      const job = jobById.get(jobId)
      if (!job?.order || !isRealWork(job.order) || installedDone(job)) continue
      const g = installGates(job.order, job)
      if (g.paid === false || g.fdn === false || g.permit === false || g.blasted === false) continue
      out.set.push(job)
    }
    for (const job of jobs) {
      if (!job.order || !isRealWork(job.order) || installedDone(job)) continue
      if (job.job_type === 'inscription' || hasService(job.order, 'INSCRIPTION')) out.inscription.push(job)
      if (hasService(job.order, 'ACID_WASH')) out.acid_wash.push(job)
    }
    for (const k of Object.keys(out)) {
      out[k].sort((a, b) => heatScore(b.order) - heatScore(a.order) || (ageDays(b.order) ?? 0) - (ageDays(a.order) ?? 0))
    }
    return out
  }, [comps, installList, jobs, jobById])

  // Any active work — the add-panel's search universe (every lane).
  const searchPool = useMemo(
    () => jobs.filter(j => j.order && isRealWork(j.order)),
    [jobs])

  const addJob = async (lane, job) => {
    setBusyId(job.id)
    const title = `${familyOf(job.order)}${job.order.order_number ? ` — ${job.order.order_number}` : ''}`
    const r = await addHotListItem({ category: lane, title, jobId: job.id, orderId: job.order.id })
    setBusyId(null)
    if (!r.ok) { setErr(r.error); return }
    setItems(await getHotListItems())
  }

  const addNote = async (lane, text) => {
    const t = text.trim()
    if (!t) return
    setBusyId('note')
    const r = await addHotListItem({ category: lane, title: t })
    setBusyId(null)
    if (!r.ok) { setErr(r.error); return }
    setItems(await getHotListItems())
  }

  const done = async (it) => {
    setBusyId(it.id)
    const r = await markHotListItemDone(it.id)
    setBusyId(null)
    if (!r.ok) { setErr(r.error); return }
    setItems(list => list.filter(x => x.id !== it.id))
  }

  const remove = async (it) => {
    setBusyId(it.id)
    const r = await removeHotListItem(it.id)
    setBusyId(null)
    if (!r.ok) { setErr(r.error); return }
    setItems(list => list.filter(x => x.id !== it.id))
  }

  const open = useCallback((row) => {
    if (onOpenOrderDetail && (row.order?.id || row.order_id)) onOpenOrderDetail(row.order?.id || row.order_id)
    else if (onOpenJob && row.job_id) onOpenJob(row.job_id)
  }, [onOpenOrderDetail, onOpenJob])

  return (
    <div className="sb-page sb-page-wide sb-hot2">
      <style>{CSS}</style>
      <div className="sb-hot2-head">
        <div>
          <div className="sb-hot2-eyebrow">WHAT'S HOT RIGHT NOW</div>
          <h1 className="sb-hot2-title">Hot List</h1>
          <div className="sb-hot2-lede">
            The board the whole shop answers to. Add what's hot, knock it off when it's handled —
            linked work carries live due/age/paid heat and opens the order in one click.
          </div>
        </div>
        <div className="sb-hot2-kpis">
          <div className={`sb-hot2-kpi${superHot ? ' hot' : ''}`}><b>{superHot}</b><span>Super hot</span></div>
          <div className="sb-hot2-kpi"><b>{loading ? '—' : totalOpen}</b><span>On the list</span></div>
        </div>
      </div>

      {err && <div className="sb-hot2-err">{err}</div>}
      {loading && <div className="sb-hot2-empty">Loading the hot list…</div>}

      {!loading && HOT_CATEGORIES.map(cat => (
        <HotLane
          key={cat.code}
          cat={cat}
          rows={lanes.get(cat.code) || []}
          addOpen={addFor === cat.code}
          onToggleAdd={() => setAddFor(f => (f === cat.code ? null : cat.code))}
          suggestions={(suggestions[cat.code] || []).filter(j => !hotJobIdsByLane.get(cat.code)?.has(j.id))}
          searchPool={searchPool}
          hotIds={hotJobIdsByLane.get(cat.code) || new Set()}
          busyId={busyId}
          onAddJob={(job) => addJob(cat.code, job)}
          onAddNote={(text) => addNote(cat.code, text)}
          onDone={done}
          onRemove={remove}
          onOpen={open}
        />
      ))}
    </div>
  )
}

function HotLane({ cat, rows, addOpen, onToggleAdd, suggestions, searchPool, hotIds, busyId, onAddJob, onAddNote, onDone, onRemove, onOpen }) {
  return (
    <div className="sb-hot2-lane">
      <div className="sb-hot2-lane-head">
        <span className="sb-hot2-lane-title">{cat.label}</span>
        <span className={`sb-hot2-lane-count${rows.length ? '' : ' zero'}`}>{rows.length}</span>
        <button type="button" className={`sb-hot2-add${addOpen ? ' on' : ''}`} onClick={onToggleAdd}>
          {addOpen ? 'Close' : '+ Add'}
        </button>
      </div>

      {addOpen && (
        <AddPanel
          cat={cat}
          suggestions={suggestions}
          searchPool={searchPool}
          hotIds={hotIds}
          busyId={busyId}
          onAddJob={onAddJob}
          onAddNote={onAddNote}
        />
      )}

      {rows.length === 0
        ? <div className="sb-hot2-empty">Nothing hot here — hit + Add when something is.</div>
        : (
          <div className="sb-hot2-rows">
            {rows.map(r => <HotItemRow key={r.id} r={r} busyId={busyId} onDone={onDone} onRemove={onRemove} onOpen={onOpen} />)}
          </div>
        )}
    </div>
  )
}

function HotItemRow({ r, busyId, onDone, onRemove, onOpen }) {
  const linked = !!(r.order || r.order_id || r.job_id)
  const Body = (
    <>
      <div className="sb-hot2-row-main">
        <span className="sb-hot2-name">{r.family}</span>
        {r.orderNumber && <span className="sb-hot2-num">{r.orderNumber}</span>}
        {r.cemetery && <span className="sb-hot2-cem">{r.cemetery}</span>}
        {!linked && r.added_by && <span className="sb-hot2-cem">added by {r.added_by}</span>}
      </div>
      <div className="sb-hot2-row-chips">
        {r.score >= SUPER_HOT_AT && <span className="sb-hot2-chip super">SUPER HOT</span>}
        {r.age != null && (
          <span className={`sb-hot2-chip ${r.age >= 180 ? 'red' : r.age >= 90 ? 'amber' : 'quiet'}`}>{r.age}d old</span>
        )}
        {r.dueText && (
          <span className={`sb-hot2-chip ${r.dueTone === 'red' ? 'red' : r.dueTone === 'amber' ? 'amber' : 'quiet'}`}>DUE {r.dueText}</span>
        )}
        {r.paidInFull
          ? <span className="sb-hot2-chip paid">PAID IN FULL — WAITING ON US</span>
          : (r.balance > 0 ? <span className="sb-hot2-chip quiet">owes {fmtUSD(r.balance)}</span> : null)}
        {r.note && <span className="sb-hot2-chip quiet">{r.note}</span>}
      </div>
    </>
  )
  return (
    <div className={`sb-hot2-row${r.score >= SUPER_HOT_AT ? ' super' : ''}`}>
      {linked
        ? <button type="button" className="sb-hot2-row-open" onClick={() => onOpen(r)}>{Body}</button>
        : <div className="sb-hot2-row-open">{Body}</div>}
      <div className="sb-hot2-row-actions">
        <button type="button" className="sb-hot2-btn done" disabled={busyId === r.id} onClick={() => onDone(r)} title="Done — off the list, kept as history">DONE</button>
        <button type="button" className="sb-hot2-btn ghost" disabled={busyId === r.id} onClick={() => onRemove(r)} title="Remove — not hot after all">Remove</button>
      </div>
    </div>
  )
}

function AddPanel({ cat, suggestions, searchPool, hotIds, busyId, onAddJob, onAddNote }) {
  const [q, setQ] = useState('')
  const needle = q.trim().toLowerCase()

  const matches = useMemo(() => {
    if (!needle) return []
    return searchPool.filter(j => !hotIds.has(j.id) && [
      j.order?.primary_lastname, customerName(j.customer || j.order?.customer),
      j.order?.order_number, j.cemetery?.name || j.order?.cemetery?.name,
    ].filter(Boolean).join(' ').toLowerCase().includes(needle)).slice(0, 25)
  }, [needle, searchPool, hotIds])

  const shown = needle ? matches : suggestions.slice(0, 15)

  return (
    <div className="sb-hot2-addpanel">
      <div className="sb-hot2-addrow">
        <input
          type="search" className="sb-hot2-search" autoFocus
          placeholder="Search any active work — family, order #, cemetery… or type a note"
          value={q} onChange={e => setQ(e.target.value)}
        />
        {needle && (
          <button type="button" className="sb-hot2-btn note" disabled={busyId === 'note'}
            onClick={() => { onAddNote(q); setQ('') }}>
            Add as note
          </button>
        )}
      </div>
      {!needle && suggestions.length > 0 && (
        <div className="sb-hot2-addsub">Suggested — {suggestionHint(cat.code)}</div>
      )}
      {shown.length === 0
        ? <div className="sb-hot2-empty">{needle ? 'No active work matches — "Add as note" puts the text itself on the list.' : 'No suggestions for this lane — search for work or type a note.'}</div>
        : (
          <div className="sb-hot2-addlist">
            {shown.map(j => (
              <button key={j.id} type="button" className="sb-hot2-addhit" disabled={busyId === j.id} onClick={() => onAddJob(j)}>
                <span className="sb-hot2-name">{familyOf(j.order)}</span>
                <span className="sb-hot2-num">{j.order?.order_number || ''}</span>
                <span className="sb-hot2-cem">{j.cemetery?.name || j.order?.cemetery?.name || ''}</span>
                <span className="sb-hot2-addgo">+ Add</span>
              </button>
            ))}
          </div>
        )}
    </div>
  )
}

function suggestionHint(code) {
  switch (code) {
    case 'blast': return 'sitting in the Blasting Queue right now'
    case 'set': return 'on the set list with every gate green'
    case 'inscription': return 'active inscription work'
    case 'acid_wash': return 'active acid-wash work'
    default: return 'search for work or type a note'
  }
}

const CSS = `
  .sb-hot2-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; flex-wrap: wrap; margin-bottom: 20px; }
  .sb-hot2-eyebrow { font-size: 11px; font-weight: 800; letter-spacing: 0.12em; color: #B3261E; }
  .sb-hot2-title { font-size: 26px; font-weight: 800; color: var(--sb-text, #0F1419); margin: 2px 0 0; }
  .sb-hot2-lede { font-size: 13px; color: var(--sb-text-muted, #6B6456); margin-top: 4px; max-width: 620px; }
  .sb-hot2-kpis { display: flex; gap: 10px; }
  .sb-hot2-kpi { background: #0F1419; border-radius: 12px; padding: 10px 18px; text-align: center; min-width: 96px; }
  .sb-hot2-kpi b { display: block; font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 24px; color: #C9A468; }
  .sb-hot2-kpi span { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.07em; color: #8a8a85; }
  .sb-hot2-kpi.hot { background: #B3261E; }
  .sb-hot2-kpi.hot b, .sb-hot2-kpi.hot span { color: #fff; }
  .sb-hot2-err { background: rgba(179,38,30,0.1); color: #B3261E; border-radius: 10px; padding: 10px 14px; margin-bottom: 12px; font-size: 13px; }
  .sb-hot2-empty { font-size: 13px; color: #8a8a85; background: var(--sb-surface, #FBFAF7); border: 0.5px dashed #E2D8C6; border-radius: 10px; padding: 12px 14px; }

  .sb-hot2-lane { margin-bottom: 24px; }
  .sb-hot2-lane-head { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
  .sb-hot2-lane-title { font-size: 14px; font-weight: 800; letter-spacing: 0.07em; text-transform: uppercase; color: var(--sb-text, #0F1419); }
  .sb-hot2-lane-count { font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 13px; font-weight: 700;
    color: #fff; background: #B3261E; border-radius: 999px; padding: 1px 9px; }
  .sb-hot2-lane-count.zero { background: #d8d6d1; color: #6a6a66; }
  .sb-hot2-add { font: inherit; font-size: 12px; font-weight: 700; padding: 4px 12px; border-radius: 999px;
    border: 1px solid #C9A468; background: transparent; color: #9A7209; cursor: pointer; margin-left: auto; }
  .sb-hot2-add:hover, .sb-hot2-add.on { background: #9A7209; border-color: #9A7209; color: #fff; }

  .sb-hot2-rows { display: flex; flex-direction: column; gap: 6px; }
  .sb-hot2-row { display: flex; align-items: stretch; gap: 8px;
    background: #fff; border: 0.5px solid #E2D8C6; border-radius: 12px; padding: 10px 12px 10px 14px; }
  .sb-hot2-row.super { border-left: 4px solid #B3261E; }
  .sb-hot2-row-open { flex: 1; min-width: 0; display: block; text-align: left; background: none; border: none; padding: 0; font: inherit; color: inherit; }
  button.sb-hot2-row-open { cursor: pointer; }
  button.sb-hot2-row-open:hover .sb-hot2-name { text-decoration: underline; }
  .sb-hot2-row-main { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
  .sb-hot2-name { font-size: 15px; font-weight: 800; color: #0F1419; }
  .sb-hot2-num { font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 12px; color: #6a6a66; }
  .sb-hot2-cem { font-size: 12.5px; color: #6B6456; }
  .sb-hot2-row-chips { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-top: 5px; }
  .sb-hot2-chip { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em;
    border-radius: 5px; padding: 2px 7px; white-space: nowrap; max-width: 340px; overflow: hidden; text-overflow: ellipsis; }
  .sb-hot2-chip.super { color: #fff; background: #B3261E; font-weight: 800; letter-spacing: 0.07em; }
  .sb-hot2-chip.red   { color: #B3261E; background: rgba(179,38,30,0.08); }
  .sb-hot2-chip.amber { color: #8a5a12; background: rgba(183,121,31,0.12); }
  .sb-hot2-chip.paid  { color: #15724a; background: rgba(29,158,117,0.11); }
  .sb-hot2-chip.quiet { color: #6a6a66; background: #f0eee9; text-transform: none; letter-spacing: 0; }
  .sb-hot2-row-actions { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
  .sb-hot2-btn { font: inherit; font-size: 11.5px; font-weight: 800; padding: 6px 12px; border-radius: 8px;
    border: 1px solid #E2D8C6; background: #fff; color: #0F1419; cursor: pointer; letter-spacing: 0.04em; }
  .sb-hot2-btn:disabled { opacity: 0.5; cursor: default; }
  .sb-hot2-btn.done { border-color: #1D9E75; color: #15724a; }
  .sb-hot2-btn.done:hover { background: #1D9E75; color: #fff; }
  .sb-hot2-btn.ghost { border-color: transparent; color: #8a8a85; }
  .sb-hot2-btn.ghost:hover { color: #B3261E; }
  .sb-hot2-btn.note { border-color: #C9A468; color: #9A7209; white-space: nowrap; }
  .sb-hot2-btn.note:hover { background: #9A7209; border-color: #9A7209; color: #fff; }

  .sb-hot2-addpanel { background: var(--sb-surface, #FBFAF7); border: 0.5px solid #E2D8C6; border-radius: 12px; padding: 12px; margin-bottom: 10px; }
  .sb-hot2-addrow { display: flex; gap: 8px; }
  .sb-hot2-search { flex: 1; font: inherit; font-size: 13.5px; padding: 8px 12px; border-radius: 9px; border: 0.5px solid #E2D8C6; background: #fff; color: #0F1419; }
  .sb-hot2-addsub { font-size: 11.5px; color: #8a8a85; margin: 10px 2px 6px; font-weight: 600; }
  .sb-hot2-addlist { display: flex; flex-direction: column; margin-top: 8px; max-height: 320px; overflow-y: auto; }
  .sb-hot2-addhit { display: flex; align-items: baseline; gap: 10px; width: 100%; text-align: left; font: inherit;
    background: none; border: none; border-top: 0.5px solid #EFEAE0; padding: 8px 6px; cursor: pointer; }
  .sb-hot2-addhit:hover { background: #fff; }
  .sb-hot2-addhit:disabled { opacity: 0.5; cursor: default; }
  .sb-hot2-addgo { margin-left: auto; font-size: 11.5px; font-weight: 800; color: #9A7209; white-space: nowrap; }
`
