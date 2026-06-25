// =============================================================================
// 📚 Stonebooks — Design Hub Home (DESIGN-HUB-REDESIGN)
// =============================================================================
// A calm, scannable design surface. EVERY count/tile/list/task derives from ONE
// state machine — designStateFor(order, job, currentProofsByJob) — which reads
// the REAL layout source of truth (proof_versions.is_current) plus the existing
// approved/revision indicators. There is NO items.length count anywhere.
//
//   • Two sub-tabs: "Layouts needed" (CONTRACTED, 4-state) · "Estimate layouts"
//     (pre-contract leads of the same 3 types).
//   • 3 clickable summary tiles: Layouts due · Need revision · Need approval.
//   • A task panel (auto-derived from the 4 states + manual tasks persisted via
//     the SAME order_activity store the Sales-Leads task list uses).
//   • Search + sort over a MINIMAL row list: family · age/Adjustment pill · a
//     one-tap status box that WRITES the real design state (setOrderDesignStatus).
//   • Row click opens the existing design packet (onOpenJob) — packet untouched.
//
// Reused, not duplicated: designStateFor / getCurrentProofsByJob (proof truth),
// setOrderDesignStatus (the milestone-ladder writer the Orders/Jobs dropdowns
// use), addOrderTask / setOrderTaskStatus / getOpenTasksList (the Leads task
// store), getLatestChangeRequestNotes (revision notes). No pricing, no packet
// rebuild, no new tables.
// =============================================================================

import { useState, useMemo, useEffect, useCallback } from 'react'
import {
  getLatestChangeRequestNotes,
  designStateFor, orderIsEstimateLayout,
  setOrderDesignStatus, addOrderTask, setOrderTaskStatus, getOpenTasksList,
  getCurrentStaffName,
  getProofVersionsByOrder, uploadProofLayout, createProofVersion,
} from './lib/stonebooksData'

// ── small helpers (no Date in render — todayISO comes from an effect) ────────
const pad = (n) => String(n).padStart(2, '0')
const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` }
const familyOf = (o) => (o?.primary_lastname || o?.customer?.last_name || '—')
const customerOf = (o) => [o?.customer?.first_name, o?.customer?.last_name].filter(Boolean).join(' ')
const msFrom = (iso) => { if (!iso) return null; const t = Date.parse(String(iso).slice(0, 10) + 'T00:00:00'); return Number.isNaN(t) ? null : t }

// Order age (days) from signed_at, falling back to the contract/created date.
function ageDaysOf(order, nowMs) {
  const t = msFrom(order?.signed_at || order?.contract_date || order?.created_at)
  if (t == null || !nowMs) return null
  return Math.max(0, Math.floor((nowMs - t) / 86400000))
}
// 2-week SLA urgency. DUE: >14d red, 7–14d amber, else neutral. REVISION: amber.
// NEED_APPROVAL / APPROVED: neutral.
function urgencyFor(state, ageDays) {
  if (state === 'due') {
    if (ageDays != null && ageDays > 14) return 'urgent'
    if (ageDays != null && ageDays >= 7) return 'soon'
    return 'none'
  }
  if (state === 'revision') return 'soon'
  return 'none'
}

// The one-tap status box. Each option WRITES the real design state via the SAME
// milestone-ladder writer the Orders/Jobs design dropdowns use.
const STATUS_BOX = [
  { code: 'due',           label: 'Needs design',     write: 'not_created' },
  { code: 'need_approval', label: 'Sent to customer', write: 'layout_created' },
  { code: 'revision',      label: 'Revision',         write: 'needs_adjustments' },
  { code: 'approved',      label: 'Approved',         write: 'layout_approved' },
]
const STATE_ORDER = { due: 0, revision: 1, need_approval: 2, approved: 3 }
const URG_RANK = { urgent: 0, soon: 1, none: 2 }

const TILES = [
  { code: 'due',           label: 'Layouts due',  tone: 'red' },
  { code: 'revision',      label: 'Need revision', tone: 'amber' },
  { code: 'need_approval', label: 'Need approval', tone: 'neutral' },
]
const SORTS = [
  { code: 'urgency', label: 'Urgency' },
  { code: 'oldest',  label: 'Oldest first' },
  { code: 'newest',  label: 'Newest first' },
  { code: 'status',  label: 'By status' },
]
const TASK_CAP = 10   // visible manual-task cap; overflow shows "+N more"

export default function DesignHubHome({ jobs = [], orders = [], currentProofsByJob, currentProofOrderIds, onOpenJob, onOpenOrder, onReload }) {
  const [todayISO, setTodayISO] = useState('')
  useEffect(() => { setTodayISO(todayStr()) }, [])
  const nowMs = todayISO ? msFrom(todayISO) : null

  const [tab, setTab] = useState('layouts')        // 'layouts' | 'estimates'
  const [activeTile, setActiveTile] = useState(null)
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState('urgency')
  const [busyId, setBusyId] = useState(null)

  // ── ONE state machine → rows (contracted, 4 states) ────────────────────────
  const layoutRows = useMemo(() => {
    const rows = []
    for (const job of (jobs || [])) {
      if (!job) continue
      const order = job.order || null
      const state = designStateFor(order, job, currentProofsByJob)
      if (!state) continue
      const ageDays = ageDaysOf(order, nowMs)
      rows.push({ job, order, state, ageDays, urgency: urgencyFor(state, ageDays) })
    }
    return rows
  }, [jobs, currentProofsByJob, nowMs])

  // Tile counts — derived from the SAME rows (never items.length).
  const counts = useMemo(() => {
    const c = { due: 0, revision: 0, need_approval: 0, approved: 0 }
    for (const r of layoutRows) c[r.state]++
    return c
  }, [layoutRows])

  // Revision notes (the customer's words) for revision rows + tasks.
  const [changeNotes, setChangeNotes] = useState({})
  const revisionKey = layoutRows.filter(r => r.state === 'revision').map(r => r.job.id).join(',')
  useEffect(() => {
    const revs = layoutRows.filter(r => r.state === 'revision')
      .map(r => ({ id: r.job.id, order_id: r.order?.id })).filter(j => j.id)
    if (!revs.length) { setChangeNotes({}); return }
    let alive = true
    getLatestChangeRequestNotes(revs).then(m => { if (alive) setChangeNotes(m || {}) }).catch(() => { if (alive) setChangeNotes({}) })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revisionKey])

  // ── MANUAL tasks ONLY (persisted via the SAME order_activity store as Leads) ──
  // Auto-generated tasks were dropped — the work is already visible in the rows,
  // so the panel shows only user-added tasks. Capped at 10 in the render (TASK_CAP).
  const scopeIds = useMemo(() => layoutRows.map(r => r.order?.id).filter(Boolean), [layoutRows])
  const scopeKey = scopeIds.join(',')
  const [manualTasks, setManualTasks] = useState([])
  const [taskNonce, setTaskNonce] = useState(0)
  useEffect(() => {
    if (!scopeKey) { setManualTasks([]); return }
    let alive = true
    getOpenTasksList(scopeKey.split(',')).then(l => {
      if (alive) setManualTasks((l || []).filter(t => t.kind === 'design'))
    }).catch(() => { if (alive) setManualTasks([]) })
    return () => { alive = false }
  }, [scopeKey, taskNonce])

  // Soonest-due first (NULLS LAST), then newest-created; cap the visible list.
  const sortedTasks = useMemo(() => {
    return [...manualTasks].sort((a, b) => {
      const da = a.due_date || '9999-12-31', db = b.due_date || '9999-12-31'
      if (da !== db) return da < db ? -1 : 1
      return (b.created_at || '').localeCompare(a.created_at || '')
    })
  }, [manualTasks])
  const visibleTasks = sortedTasks.slice(0, TASK_CAP)
  const moreTasks = Math.max(0, sortedTasks.length - TASK_CAP)

  const familyById = useMemo(() => {
    const m = {}; for (const r of layoutRows) if (r.order?.id) m[r.order.id] = familyOf(r.order); return m
  }, [layoutRows])

  // ── Visible row list (tile filter → search → sort) ─────────────────────────
  const visibleRows = useMemo(() => {
    let list = activeTile ? layoutRows.filter(r => r.state === activeTile) : layoutRows.filter(r => r.state !== 'approved')
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      list = list.filter(r => [familyOf(r.order), customerOf(r.order), r.order?.order_number].filter(Boolean).join(' ').toLowerCase().includes(q))
    }
    const byUrg = (a, b) => (URG_RANK[a.urgency] - URG_RANK[b.urgency]) || ((b.ageDays || 0) - (a.ageDays || 0))
    const dt = (r) => (r.order?.signed_at || r.order?.created_at || '')
    const cmp =
      sortKey === 'oldest' ? (a, b) => dt(a).localeCompare(dt(b))
        : sortKey === 'newest' ? (a, b) => dt(b).localeCompare(dt(a))
          : sortKey === 'status' ? (a, b) => (STATE_ORDER[a.state] - STATE_ORDER[b.state]) || byUrg(a, b)
            : byUrg
    return [...list].sort(cmp)
  }, [layoutRows, activeTile, search, sortKey])

  // ── Estimate-layout (lead) rows ────────────────────────────────────────────
  const estimateRows = useMemo(() => {
    let list = (orders || []).filter(o => orderIsEstimateLayout(o) && !o.archived && !o.lost_at)
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      list = list.filter(o => [familyOf(o), customerOf(o), o.order_number].filter(Boolean).join(' ').toLowerCase().includes(q))
    }
    return list.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))
  }, [orders, search])

  // ── Actions ────────────────────────────────────────────────────────────────
  const changeStatus = useCallback(async (row, code) => {
    const target = STATUS_BOX.find(s => s.code === code)
    if (!target || code === row.state) return
    setBusyId(row.job.id)
    try { await setOrderDesignStatus(row.job.id, target.write); await onReload?.() }
    finally { setBusyId(null) }
  }, [onReload])

  const completeTask = useCallback(async (id) => {
    await setOrderTaskStatus(id, 'done'); setTaskNonce(n => n + 1)
  }, [])

  const [adding, setAdding] = useState(false)
  const [addOrderId, setAddOrderId] = useState('')
  const [addNote, setAddNote] = useState('')
  const saveTask = useCallback(async () => {
    const note = addNote.trim()
    if (!note || !addOrderId) return
    const actor = await getCurrentStaffName().catch(() => null)
    await addOrderTask(addOrderId, { note, kind: 'design', actor, dueDate: todayStr() })
    setAddNote(''); setAddOrderId(''); setAdding(false); setTaskNonce(n => n + 1)
  }, [addNote, addOrderId])

  const toggleTile = (code) => setActiveTile(t => (t === code ? null : code))

  // ── Estimate-layout uploader (order-scoped; reuses uploadProofLayout +
  // createProofVersion with an orderId — NOT the job-scoped DesignPacket). ──────
  const [uploadFor, setUploadFor] = useState(null)   // the lead order | null
  const [uploadBusy, setUploadBusy] = useState(false)
  const [uploadErr, setUploadErr] = useState(null)
  const [orderProof, setOrderProof] = useState(null) // current order-scoped proof
  const openUploader = useCallback(async (order) => {
    setUploadFor(order); setUploadErr(null); setOrderProof(null)
    const vers = await getProofVersionsByOrder(order.id).catch(() => [])
    setOrderProof(vers.find(v => v.is_current) || vers[0] || null)
  }, [])
  const closeUploader = () => { if (!uploadBusy) { setUploadFor(null); setUploadErr(null); setOrderProof(null) } }
  const onPickLayout = useCallback(async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || !uploadFor) return
    setUploadBusy(true); setUploadErr(null)
    const up = await uploadProofLayout(uploadFor.id, file, { scope: 'order' })
    if (!up.ok) { setUploadErr(up.error || 'Upload failed.'); setUploadBusy(false); return }
    const me = await getCurrentStaffName().catch(() => null)
    const { error } = await createProofVersion({ orderId: uploadFor.id, layoutImageUrl: up.url, uploadedBy: me })
    setUploadBusy(false)
    if (error) { setUploadErr(error.message || 'Could not save the layout.'); return }
    setUploadFor(null); setOrderProof(null)
    await onReload?.()
  }, [uploadFor, onReload])
  const hasLayout = (orderId) => !!(currentProofOrderIds && currentProofOrderIds.has(orderId))

  return (
    <div className="sb-dh2">
      <style>{CSS}</style>

      {/* SUB-TABS */}
      <div className="sb-dh2-tabs">
        <button type="button" className={`sb-dh2-tab${tab === 'layouts' ? ' on' : ''}`} onClick={() => setTab('layouts')}>Layouts needed</button>
        <button type="button" className={`sb-dh2-tab${tab === 'estimates' ? ' on' : ''}`} onClick={() => setTab('estimates')}>Estimate layouts</button>
      </div>

      {tab === 'layouts' ? (
        <>
          {/* TILES */}
          <div className="sb-dh2-tiles">
            {TILES.map(t => (
              <button
                key={t.code}
                type="button"
                className={`sb-dh2-tile sb-dh2-tile-${t.tone}${activeTile === t.code ? ' on' : ''}`}
                onClick={() => toggleTile(t.code)}
              >
                <span className="sb-dh2-tile-num">{counts[t.code]}</span>
                <span className="sb-dh2-tile-lab">{t.label}</span>
              </button>
            ))}
          </div>

          {/* TASK PANEL */}
          <div className="sb-dh2-tasks">
            <div className="sb-dh2-tasks-head">
              <span className="sb-dh2-tasks-title">Tasks</span>
              <button type="button" className="sb-dh2-addbtn" onClick={() => setAdding(a => !a)}>{adding ? 'Cancel' : '+ Add task'}</button>
            </div>
            {adding && (
              <div className="sb-dh2-addrow">
                <select className="sb-dh2-sel" value={addOrderId} onChange={e => setAddOrderId(e.target.value)}>
                  <option value="">— pick a family —</option>
                  {layoutRows.map(r => <option key={r.job.id} value={r.order?.id}>{familyOf(r.order)}{r.order?.order_number ? ` · ${r.order.order_number}` : ''}</option>)}
                </select>
                <input className="sb-dh2-inp" value={addNote} onChange={e => setAddNote(e.target.value)} placeholder="Task — e.g. confirm photo with family" />
                <button type="button" className="sb-dh2-savebtn" onClick={saveTask} disabled={!addNote.trim() || !addOrderId}>Save</button>
              </div>
            )}
            {manualTasks.length === 0 ? (
              <div className="sb-dh2-tasks-empty">No tasks yet. Use “+ Add task”.</div>
            ) : (
              <>
                <ul className="sb-dh2-tasklist">
                  {visibleTasks.map(t => (
                    <li key={t.id} className="sb-dh2-taskitem sb-dh2-taskitem-manual">
                      <input type="checkbox" className="sb-dh2-taskcheck" onChange={() => completeTask(t.id)} aria-label="Complete task" />
                      <span className="sb-dh2-tasktext">{t.note} <span className="sb-dh2-taskfam">· {familyById[t.order_id] || ''}</span></span>
                      <span className="sb-dh2-taskkind sb-dh2-kind-neutral">Manual</span>
                    </li>
                  ))}
                </ul>
                {moreTasks > 0 && <div className="sb-dh2-taskmore">+{moreTasks} more</div>}
              </>
            )}
          </div>

          {/* SEARCH + SORT */}
          <div className="sb-dh2-toolbar">
            <input className="sb-dh2-search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search family, customer, or order #…" />
            <div className="sb-dh2-sortwrap">
              <span className="sb-dh2-sortlab">Sort</span>
              <select className="sb-dh2-sel" value={sortKey} onChange={e => setSortKey(e.target.value)}>
                {SORTS.map(s => <option key={s.code} value={s.code}>{s.label}</option>)}
              </select>
            </div>
          </div>

          {/* CLEAN ROW LIST */}
          {visibleRows.length === 0 ? (
            <div className="sb-dh2-empty">{layoutRows.length === 0 ? 'No contracted layouts in scope.' : 'Nothing matches.'}</div>
          ) : (
            <div className="sb-dh2-rows">
              {visibleRows.map(r => (
                <div
                  key={r.job.id}
                  className={`sb-dh2-row sb-dh2-row-${r.urgency}`}
                  onClick={() => onOpenJob?.(r.job.id, 'design')}
                  role="button"
                  tabIndex={0}
                >
                  <span className="sb-dh2-fam">{familyOf(r.order)}</span>
                  {r.state === 'revision' ? (
                    <span className="sb-dh2-pill sb-dh2-pill-amber" title={changeNotes[r.job.id] || ''}>Adjustment needed</span>
                  ) : (
                    <span className={`sb-dh2-age sb-dh2-age-${r.urgency}`}>{r.ageDays != null ? `${r.ageDays}d` : '—'}</span>
                  )}
                  <span className="sb-dh2-row-spacer" />
                  <select
                    className="sb-dh2-statusbox"
                    value={r.state}
                    disabled={busyId === r.job.id}
                    onClick={e => e.stopPropagation()}
                    onChange={e => { e.stopPropagation(); changeStatus(r, e.target.value) }}
                  >
                    {STATUS_BOX.map(s => <option key={s.code} value={s.code}>{s.label}</option>)}
                  </select>
                </div>
              ))}
            </div>
          )}
        </>
      ) : (
        /* ── ESTIMATE LAYOUTS (leads) ─────────────────────────────────────── */
        <>
          <div className="sb-dh2-toolbar">
            <input className="sb-dh2-search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search estimate family / order #…" />
            <span className="sb-dh2-estcount">{estimateRows.length} estimate {estimateRows.length === 1 ? 'layout' : 'layouts'}</span>
          </div>
          {estimateRows.length === 0 ? (
            <div className="sb-dh2-empty">No pre-contract estimate layouts.</div>
          ) : (
            <div className="sb-dh2-rows">
              {estimateRows.map(o => (
                <div key={o.id} className="sb-dh2-row" onClick={() => onOpenOrder?.(o.id)} role="button" tabIndex={0}>
                  <span className="sb-dh2-fam">{familyOf(o)}</span>
                  <span className="sb-dh2-est-meta">{o.order_number || 'estimate'}</span>
                  {hasLayout(o.id) && <span className="sb-dh2-pill sb-dh2-pill-green">Layout ✓</span>}
                  <span className="sb-dh2-row-spacer" />
                  <button type="button" className="sb-dh2-createbtn" onClick={e => { e.stopPropagation(); openUploader(o) }}>
                    {hasLayout(o.id) ? 'Update layout' : 'Create estimate layout'}
                  </button>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* Order-scoped layout uploader (estimate leads) — reuses the proof plumbing */}
      {uploadFor && (
        <div className="sb-dh2-modal-overlay" onClick={closeUploader}>
          <div className="sb-dh2-modal" onClick={e => e.stopPropagation()}>
            <div className="sb-dh2-modal-title">Estimate layout · {familyOf(uploadFor)}</div>
            <div className="sb-dh2-modal-sub">Attach a layout to this estimate. It carries onto the job when the contract is signed.</div>
            {orderProof?.layout_image_url && (
              <div className="sb-dh2-modal-thumbwrap">
                <img src={orderProof.layout_image_url} alt="Current layout" className="sb-dh2-modal-thumb" />
                <div className="sb-dh2-modal-cur">Current — v{orderProof.version_number}</div>
              </div>
            )}
            {uploadErr && <div className="sb-dh2-modal-err">{uploadErr}</div>}
            <label className="sb-dh2-modal-uplabel">
              <input type="file" accept="image/jpeg,image/png" onChange={onPickLayout} disabled={uploadBusy} style={{ display: 'none' }} />
              <span className="sb-dh2-createbtn">{uploadBusy ? 'Uploading…' : (orderProof ? 'Upload a new version' : 'Upload layout (JPG / PNG)')}</span>
            </label>
            <button type="button" className="sb-dh2-modal-cancel" onClick={closeUploader} disabled={uploadBusy}>Close</button>
          </div>
        </div>
      )}
    </div>
  )
}

const CSS = `
  .sb-dh2 { width: 100%; max-width: 1100px; margin: 0 auto; padding: 22px 32px 64px; }
  .sb-dh2-tabs { display: inline-flex; gap: 4px; background: #ece6d8; border-radius: 11px; padding: 4px; margin-bottom: 20px; }
  .sb-dh2-tab { border: none; cursor: pointer; border-radius: 8px; padding: 8px 20px; font: inherit; font-size: 14px; font-weight: 700; background: transparent; color: #7a756a; }
  .sb-dh2-tab.on { background: #fff; color: #0f1419; box-shadow: 0 1px 3px rgba(0,0,0,0.12); }
  .sb-dh2-tab:hover:not(.on) { color: #4a463f; }

  .sb-dh2-tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 14px; margin-bottom: 20px; }
  .sb-dh2-tile { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; text-align: left; cursor: pointer; font: inherit;
    background: #fff; border: 0.5px solid rgba(0,0,0,0.08); border-left: 4px solid #cfcabb; border-radius: 12px; padding: 16px 18px; transition: box-shadow .12s, transform .12s; }
  .sb-dh2-tile:hover { transform: translateY(-1px); box-shadow: 0 4px 14px rgba(15,20,25,.08); }
  .sb-dh2-tile.on { box-shadow: 0 0 0 2px #9A7209 inset; }
  .sb-dh2-tile-red { border-left-color: #b54040; }
  .sb-dh2-tile-amber { border-left-color: #b8842a; background: #fdfaf2; }
  .sb-dh2-tile-neutral { border-left-color: #9aa0a6; }
  .sb-dh2-tile-num { font-size: 32px; font-weight: 700; color: #1e2d3d; line-height: 1; font-variant-numeric: tabular-nums; }
  .sb-dh2-tile-lab { font-size: 13px; font-weight: 600; color: #6a6a62; }

  .sb-dh2-tasks { background: #fff; border: 0.5px solid rgba(0,0,0,0.08); border-radius: 12px; padding: 12px 14px; margin-bottom: 18px; }
  .sb-dh2-tasks-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
  .sb-dh2-tasks-title { font-size: 11px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; color: #8a8472; }
  .sb-dh2-addbtn, .sb-dh2-savebtn { font: inherit; font-size: 12.5px; font-weight: 600; border-radius: 7px; cursor: pointer; padding: 6px 12px; border: 0.5px solid #9A7209; background: #fff; color: #9A7209; }
  .sb-dh2-savebtn { background: #9A7209; color: #fff; }
  .sb-dh2-savebtn:disabled { opacity: .5; cursor: default; }
  .sb-dh2-addrow { display: flex; gap: 8px; margin-bottom: 10px; flex-wrap: wrap; }
  .sb-dh2-inp, .sb-dh2-sel, .sb-dh2-search { font: inherit; font-size: 13.5px; padding: 8px 10px; border: 0.5px solid #d8d2c4; border-radius: 7px; background: #fff; color: #2a2a2a; }
  .sb-dh2-inp { flex: 1; min-width: 180px; }
  .sb-dh2-tasks-empty { font-size: 13px; color: #8a8a85; padding: 6px 2px; }
  .sb-dh2-taskmore { font-size: 12px; color: #8a8a85; padding: 8px 4px 2px; font-style: italic; }
  .sb-dh2-tasklist { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
  .sb-dh2-taskitem { display: flex; align-items: center; gap: 10px; padding: 8px 4px; border-top: 0.5px solid #f1efeb; cursor: pointer; font-size: 13.5px; color: #2a2a2a; }
  .sb-dh2-taskitem:first-child { border-top: none; }
  .sb-dh2-taskitem-manual { cursor: default; }
  .sb-dh2-tasktext { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .sb-dh2-taskfam { color: #8a8a85; }
  .sb-dh2-taskcheck { width: 15px; height: 15px; accent-color: #9A7209; cursor: pointer; }
  .sb-dh2-taskdot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
  .sb-dh2-dot-red { background: #b54040; } .sb-dh2-dot-amber { background: #b8842a; } .sb-dh2-dot-neutral { background: #9aa0a6; }
  .sb-dh2-taskkind { font-size: 10.5px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; padding: 2px 7px; border-radius: 999px; flex-shrink: 0; }
  .sb-dh2-kind-red { color: #b54040; background: rgba(181,64,64,.1); }
  .sb-dh2-kind-amber { color: #8b6418; background: rgba(184,132,42,.14); }
  .sb-dh2-kind-neutral { color: #6a6a62; background: rgba(0,0,0,.05); }

  .sb-dh2-toolbar { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
  .sb-dh2-search { flex: 1; }
  .sb-dh2-sortwrap { display: flex; align-items: center; gap: 6px; }
  .sb-dh2-sortlab { font-size: 11px; text-transform: uppercase; letter-spacing: .08em; color: #8a8a85; font-weight: 600; }
  .sb-dh2-estcount { font-size: 13px; color: #8a8a85; }

  .sb-dh2-rows { display: flex; flex-direction: column; background: #fff; border: 0.5px solid rgba(0,0,0,0.08); border-radius: 12px; overflow: hidden; }
  .sb-dh2-row { display: flex; align-items: center; gap: 12px; padding: 12px 16px; border-top: 0.5px solid #f1efeb; border-left: 3px solid transparent; cursor: pointer; }
  .sb-dh2-row:first-child { border-top: none; }
  .sb-dh2-row:hover { background: #faf8f4; }
  .sb-dh2-row-urgent { border-left-color: #b54040; }
  .sb-dh2-row-soon { border-left-color: #b8842a; }
  .sb-dh2-fam { font-size: 15px; font-weight: 600; color: #1e2d3d; }
  .sb-dh2-row-spacer { flex: 1; }
  .sb-dh2-age { font-size: 12.5px; font-weight: 600; padding: 2px 9px; border-radius: 999px; color: #6a6a62; background: rgba(0,0,0,.05); font-variant-numeric: tabular-nums; }
  .sb-dh2-age-urgent { color: #fff; background: #b54040; }
  .sb-dh2-age-soon { color: #8b6418; background: rgba(184,132,42,.16); }
  .sb-dh2-pill { font-size: 11.5px; font-weight: 700; padding: 3px 10px; border-radius: 999px; }
  .sb-dh2-pill-amber { color: #8b6418; background: rgba(184,132,42,.16); }
  .sb-dh2-pill-green { color: #38704f; background: rgba(56,122,79,.12); }

  .sb-dh2-modal-overlay { position: fixed; inset: 0; z-index: 1300; background: rgba(15,20,25,.5); display: flex; align-items: center; justify-content: center; padding: 24px; }
  .sb-dh2-modal { background: #fff; border-radius: 14px; width: min(440px, 94vw); padding: 22px; box-shadow: 0 24px 60px rgba(0,0,0,.3); }
  .sb-dh2-modal-title { font-size: 16px; font-weight: 700; color: #1e2d3d; }
  .sb-dh2-modal-sub { font-size: 12.5px; color: #8a8a85; margin: 4px 0 14px; line-height: 1.45; }
  .sb-dh2-modal-thumbwrap { margin-bottom: 14px; }
  .sb-dh2-modal-thumb { width: 100%; max-height: 240px; object-fit: contain; border: 0.5px solid #e4e0d4; border-radius: 8px; background: #faf8f4; }
  .sb-dh2-modal-cur { font-size: 11.5px; color: #8a8a85; margin-top: 4px; }
  .sb-dh2-modal-err { font-size: 12.5px; color: #b3261e; background: rgba(179,38,30,.06); border: 0.5px solid rgba(179,38,30,.3); border-radius: 8px; padding: 8px 11px; margin-bottom: 12px; }
  .sb-dh2-modal-uplabel { display: block; cursor: pointer; margin-bottom: 10px; }
  .sb-dh2-modal-uplabel .sb-dh2-createbtn { display: block; text-align: center; padding: 10px; }
  .sb-dh2-modal-cancel { width: 100%; font: inherit; font-size: 13px; font-weight: 600; padding: 9px; border-radius: 8px; border: 0.5px solid #d8d2c4; background: #fff; color: #6a6a62; cursor: pointer; }
  .sb-dh2-modal-cancel:disabled { opacity: .5; }
  .sb-dh2-statusbox { font: inherit; font-size: 13px; padding: 6px 10px; border: 0.5px solid #d8d2c4; border-radius: 8px; background: #fff; color: #2a2a2a; cursor: pointer; min-width: 150px; }
  .sb-dh2-statusbox:disabled { opacity: .5; }
  .sb-dh2-est-meta { font-size: 12.5px; color: #8a8a85; font-variant-numeric: tabular-nums; }
  .sb-dh2-createbtn { font: inherit; font-size: 12.5px; font-weight: 600; border-radius: 7px; cursor: pointer; padding: 6px 12px; border: 0.5px solid #9A7209; background: #9A7209; color: #fff; }
  .sb-dh2-empty { padding: 40px 16px; text-align: center; color: #8a8a85; font-size: 14px; background: #fff; border: 0.5px solid rgba(0,0,0,0.08); border-radius: 12px; font-style: italic; }

  @media (max-width: 720px) {
    .sb-dh2 { padding: 16px 16px 48px; }
    .sb-dh2-tiles { grid-template-columns: 1fr; }
  }
`
