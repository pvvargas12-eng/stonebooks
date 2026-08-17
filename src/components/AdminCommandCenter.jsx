// =============================================================================
// AdminCommandCenter — GOD MODE front page for Jobs → Admin (ACC-1..3)
// =============================================================================
// Paul (2026-07-22): "GOD MODE CRM... see everything at once. WE LOVE VISUALS
// WE LOVE TO SEE BOTTLENECKS. LAYOUTS ARE VERY IMPORTANT — NEEDS DESIGN / SENT
// / APPROVED / DENIED. Everything needs a layout: new stone, bronze, AND
// inscription (inscriptions are separate). New contract must add to the permit
// list — same for all the others — unless stock stone is selected. Everything
// I click I can open and start actioning, and start assigning people easily."
//
// Everything DERIVES live from the jobs getJobs() already loads for this view
// (milestones + embedded order/customer/cemetery) + the Design hub's
// currentProofsByJob truth. Membership is automatic: a signed contract shows
// up in every lane that applies to it; nothing is hand-curated. One new field
// pair backs the photos lane (orders.photo_ordered_at/by).
// Assign = the real shop_tasks system (push notification included), deduped
// per order+title so a double-click can't double-task.
// =============================================================================
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  deriveDesignStatus, statusDimApplies, permitNeeded, computeOrderPressure,
  rowBalanceDue, fmtUSD, manualBlockerChipText,
  addShopTask, getCurrentStaffName, setOrderPermit, todayISO, STAFF_NAMES,
} from '../lib/stonebooksData'
import { DEPARTMENTS } from '../lib/employees'
import { supabase } from '../lib/supabase'

// Local-safe day counter — date-only strings parse as LOCAL midnight.
const _days = (iso) => {
  if (!iso) return null
  const s = String(iso)
  const d = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T00:00:00`) : new Date(s)
  if (isNaN(d)) return null
  return Math.max(0, Math.floor((Date.now() - d.getTime()) / 86400000))
}
const TYPE_TAG = { new_stone: 'STONE', bronze: 'BRONZE', inscription: 'INSC', mausoleum_door: 'DOOR', other: 'OTHER', cleaning_repair: 'CLEAN' }
const famOf = (o, j) => o?.primary_lastname || [j?.customer?.last_name, j?.customer?.first_name].filter(Boolean).join(', ') || o?.order_number || 'Order'
const ageDot = (d) => d == null ? 'ok' : d > 7 ? 'bad' : d > 3 ? 'warn' : 'ok'
const STONE_LATE_DAYS = 21

// One derivation pass over the hub's jobs → every lane + the river.
function deriveCommand(jobs, proofsByJob) {
  const layouts = { needs: [], sent: [], approved: [], denied: [] }
  const permits = [], stone = [], cash = [], photos = [], blockers = []
  const river = { intake: [], design: [], proof: [], approved_wait: [], stone_order: [], permit_wait: [], ready: [], money: [] }
  const seenOrder = new Set()

  for (const j of (jobs || [])) {
    const o = j.order
    if (!o || o.archived) continue
    if (o.status === 'closed' || o.status === 'cancelled' || o.status === 'archived') continue
    const fam = famOf(o, j)
    const base = { orderId: o.id, jobId: j.id, fam, ord: o.order_number || '', cem: j.cemetery?.name || '' }
    const proof = proofsByJob?.get?.(j.id) || null

    // ── Layouts (job-level; every job type with a design dimension) ──────────
    let designState = null
    if (statusDimApplies('design', j)) {
      const ds = deriveDesignStatus(j)
      const type = TYPE_TAG[j.job_type] || 'OTHER'
      const sitting = _days(j.last_update_at) ?? _days(o.updated_at) ?? 0
      if (ds === 'needs_adjustments') designState = 'denied'
      else if (ds === 'layout_approved' || ds === 'cut' || proof?.approved_at) designState = 'approved'
      else if (ds === 'layout_sent' || proof?.sent_at) designState = 'sent'
      else if (ds === 'layout_created') designState = 'drawn'
      else designState = 'needs'
      const card = { ...base, type, jobType: j.job_type, sitting, drawn: designState === 'drawn' }
      if (designState === 'denied') layouts.denied.push(card)
      else if (designState === 'approved') { if (sitting <= 14) layouts.approved.push(card) }
      else if (designState === 'sent') layouts.sent.push({ ...card, sentDays: _days(proof?.sent_at) ?? sitting })
      else layouts.needs.push(card)
    }

    // ── Order-level lanes (dedupe on order id) ──────────────────────────────
    const pressure = computeOrderPressure(o, j, j.milestones)
    if (!seenOrder.has(o.id)) {
      seenOrder.add(o.id)

      // Permits — permitNeeded => on the list until approved. Auto-entry.
      if (permitNeeded(o) && o.permit_status !== 'approved') {
        const ps = o.permit_status
        let tag = 'TO FILE', sev = 'tan', dd = _days(o.signed_at) ?? _days(o.created_at)
        if (ps === 'denied') { tag = 'DENIED'; sev = 'red'; dd = _days(o.permit_denied_at) ?? dd }
        else if (ps === 'submitted') { tag = 'WAITING'; sev = 'amber'; dd = _days(o.permit_filed_at) ?? dd }
        else if (ps === 'shev_permit_needed' || o.permit_form === 'shevco') { tag = 'BUILD SHEVCO'; sev = 'tan' }
        else if (!j.cemetery) { tag = 'NO CEMETERY'; sev = 'red' }
        permits.push({ ...base, tag, sev, dd: dd ?? 0, why: tag === 'DENIED' ? 'refile it' : tag === 'WAITING' ? 'chase the cemetery office' : tag === 'BUILD SHEVCO' ? 'build it in Permit Builder' : tag === 'NO CEMETERY' ? 'set the cemetery first' : 'file with the cemetery' })
      }

      // Stone — worst piece wins; in_stock (stock stone) drops off the list.
      if (statusDimApplies('stone', j)) {
        const die = o.die_stone_status || 'not_ordered'
        const bas = o.base_stone_status || null
        const worst = (die === 'not_ordered' || bas === 'not_ordered') ? 'not_ordered'
          : (die === 'ordered' || bas === 'ordered') ? 'ordered' : 'in_stock'
        if (worst === 'not_ordered' && o.signed_at) {
          const piece = die === 'not_ordered' ? (bas === 'not_ordered' ? 'die + base' : 'die') : 'base'
          stone.push({ ...base, tag: 'TO ORDER', sev: 'red', dd: _days(o.signed_at) ?? 0, why: `${piece} not ordered · ${o.stone_vendor || 'pick a vendor'}` })
        } else if (worst === 'ordered') {
          const dd = _days(o.stone_ordered_date) ?? _days(o.updated_at) ?? 0
          const late = dd > STONE_LATE_DAYS
          const noAck = !o.stone_purchase_ack
          stone.push({ ...base, tag: late ? 'LATE' : (noAck ? 'NO ACK' : 'ON ORDER'), sev: late ? 'red' : (noAck ? 'amber' : 'blue'), dd, why: `${o.stone_vendor || 'vendor'}${late ? ` · past ${STONE_LATE_DAYS}d — chase it` : noAck ? ' · log the purchase ack #' : ''}` })
        }
      }

      // Cash
      const bal = rowBalanceDue(o)
      if (bal > 0 && o.signed_at) {
        const dd = _days(o.signed_at) ?? 0
        const stoneHere = (o.die_stone_status === 'in_stock')
        cash.push({ ...base, amount: bal, dd, sev: dd > 90 ? 'red' : dd > 30 ? 'amber' : 'tan', why: stoneHere ? 'stone is HERE — collect before install' : (pressure.paymentState === 'overdue' ? 'overdue balance' : `signed ${dd}d ago`) })
      }

      // Photos — photo add-on with nothing ordered.
      const hasPhoto = (o.service_types || []).includes('ADD_PHOTO')
        || (Array.isArray(o.add_ons) && o.add_ons.some(a => String(a?.code || a?.kind || '').toUpperCase().includes('PHOTO')))
      if (hasPhoto && !o.photo_ordered_at) {
        photos.push({ ...base, tag: 'PHOTO', sev: 'plum', dd: _days(o.signed_at) ?? _days(o.created_at) ?? 0, why: 'ceramic/porcelain photo not ordered' })
      }

      // Blockers — derived pressure (cash has its own lane) + manual flags.
      if (pressure.blocker && pressure.blocker.kind !== 'overdue_balance') {
        const k = pressure.blocker.kind
        if (['cemetery_hold', 'waiting_on_family', 'proof_waiting_customer', 'production_blocked', 'install_late'].includes(k)) {
          blockers.push({ ...base, tag: pressure.blocker.label.toUpperCase(), sev: pressure.blocker.severity === 'red' ? 'red' : 'tan', dd: pressure.ageDays ?? 0, why: pressure.blocker.label })
        }
      }
      if (o.manual_blocker?.kind) {
        blockers.push({ ...base, tag: manualBlockerChipText(o.manual_blocker).toUpperCase(), sev: 'red', dd: _days(o.manual_blocker.at) ?? 0, why: o.manual_blocker.note || 'flagged by staff' })
      }

      if (bal > 0 && o.signed_at) river.money.push(base)
    }

    // ── River — each JOB sits at its furthest-blocked step ──────────────────
    const intakeGap = !j.cemetery || !(Array.isArray(o.deceased) && o.deceased.length)
    const stoneApplies = statusDimApplies('stone', j)
    const die = o.die_stone_status || 'not_ordered'
    if (intakeGap) river.intake.push(base)
    else if (designState === 'needs' || designState === 'drawn') river.design.push(base)
    else if (designState === 'sent' || designState === 'denied') river.proof.push(base)
    else if (stoneApplies && die === 'not_ordered') river.approved_wait.push(base)
    else if (stoneApplies && die === 'ordered') river.stone_order.push(base)
    else if (permitNeeded(o) && o.permit_status !== 'approved') river.permit_wait.push(base)
    else if (!pressure.blocker) river.ready.push(base)
  }

  permits.sort((a, b) => (b.sev === 'red') - (a.sev === 'red') || b.dd - a.dd)
  stone.sort((a, b) => (b.sev === 'red') - (a.sev === 'red') || b.dd - a.dd)
  cash.sort((a, b) => b.amount - a.amount)
  photos.sort((a, b) => b.dd - a.dd)
  blockers.sort((a, b) => b.dd - a.dd)
  layouts.needs.sort((a, b) => b.sitting - a.sitting)
  layouts.sent.sort((a, b) => (b.sentDays ?? 0) - (a.sentDays ?? 0))
  layouts.denied.sort((a, b) => b.sitting - a.sitting)
  const cashTotal = cash.reduce((s, r) => s + r.amount, 0)
  return { layouts, permits, stone, cash, photos, blockers, river, cashTotal }
}

const RIVER_DEF = [
  { key: 'intake', label: 'Intake\ngaps' },
  { key: 'design', label: 'Needs\ndesign' },
  { key: 'proof', label: 'Proof out /\nchanges' },
  { key: 'approved_wait', label: 'Approved\nnot ordered' },
  { key: 'stone_order', label: 'Stone\non order' },
  { key: 'permit_wait', label: 'Here, needs\npermit' },
  { key: 'ready', label: 'Ready to\nschedule' },
  { key: 'money', label: 'Money\nopen' },
]

export default function AdminCommandCenter({ jobs, proofsByJob, onOpenOrderDetail }) {
  const [openTasks, setOpenTasks] = useState([])
  const [drawer, setDrawer] = useState(null)      // { title, rows, kind }
  const [assignFor, setAssignFor] = useState(null) // row key an assign menu is open for
  const [typeFilter, setTypeFilter] = useState('all')
  const [toastMsg, setToastMsg] = useState(null)

  const loadTasks = useCallback(async () => {
    const { data } = await supabase.from('shop_tasks')
      .select('id, title, assignee, assignee_kind, status, order_id, deleted_at')
      .is('deleted_at', null).neq('status', 'done').limit(500)
    setOpenTasks(data || [])
  }, [])
  useEffect(() => { loadTasks() }, [loadTasks])

  const data = useMemo(() => deriveCommand(jobs, proofsByJob), [jobs, proofsByJob])
  const tasksByOrder = useMemo(() => {
    const m = new Map()
    for (const t of openTasks) { if (t.order_id) { if (!m.has(t.order_id)) m.set(t.order_id, []); m.get(t.order_id).push(t) } }
    return m
  }, [openTasks])
  const teamLoad = useMemo(() => {
    const m = new Map()
    for (const t of openTasks) { if (t.assignee_kind !== 'department') m.set(t.assignee, (m.get(t.assignee) || 0) + 1) }
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)
  }, [openTasks])

  const toast = (msg) => { setToastMsg(msg); setTimeout(() => setToastMsg(null), 2800) }

  const assign = async (row, lane, who) => {
    setAssignFor(null)
    const title = `${lane} — ${row.fam}${row.ord ? ` (${row.ord})` : ''}`
    const existing = (tasksByOrder.get(row.orderId) || []).find(t => t.title === title)
    if (existing) { toast(`Already tasked to ${existing.assignee}.`); return }
    const staff = await getCurrentStaffName()
    const r = await addShopTask({
      title, assignee: who,
      assigneeKind: DEPARTMENTS.includes(who) ? 'department' : 'person',
      orderId: row.orderId, createdBy: staff, taskedBy: staff,
      details: { auto: 'admin_command_center' },
    })
    if (!r.ok) { toast(r.error || 'Could not create the task.'); return }
    toast(`Task sent to ${who} — on their list with a phone push.`)
    loadTasks()
  }

  const markPhotoOrdered = async (row) => {
    const staff = await getCurrentStaffName()
    const r = await setOrderPermit(row.orderId, { photo_ordered_at: todayISO(), photo_ordered_by: staff })
    if (!r.ok) { toast(r.error || 'Could not mark it.'); return }
    toast(`${row.fam} — photo marked ordered.`)
  }

  const laneRows = {
    Permits: data.permits, 'Stone to order': data.stone, 'Cash due': data.cash,
    Photos: data.photos, Blockers: data.blockers,
  }
  const openDrawer = (title, rows, kind = null) => setDrawer({ title, rows, kind })
  const riverMax = Math.max(1, ...RIVER_DEF.slice(0, 7).map(s => data.river[s.key].length))
  const hotKey = RIVER_DEF.slice(0, 7).reduce((best, s) => data.river[s.key].length > data.river[best].length ? s.key : best, 'intake')
  const layoutCount = data.layouts.needs.length + data.layouts.sent.length + data.layouts.denied.length
  const typeFilterFn = (c) => typeFilter === 'all' || c.jobType === typeFilter

  const Row = ({ row, lane, extra = null }) => {
    const tasks = tasksByOrder.get(row.orderId) || []
    const laneTask = tasks.find(t => t.title.startsWith(`${lane} — `))
    const key = `${lane}:${row.orderId}:${row.jobId || ''}`
    return (
      <div className="sbacc-lrow">
        <span className="sbacc-fam" onClick={() => onOpenOrderDetail?.(row.orderId)}>{row.fam}</span>
        {row.tag && <span className={`sbacc-tag ${row.sev || 'tan'}`}>{row.tag}</span>}
        <span className="sbacc-why">{row.why}{row.cem ? ` · ${row.cem}` : ''}</span>
        <span className="sbacc-dd">{row.amount != null ? fmtUSD(row.amount) : `${row.dd}d`}</span>
        <span className="sbacc-acts">
          {laneTask ? (
            <span className="sbacc-tasked">&#10003; {laneTask.assignee}</span>
          ) : (
            <span style={{ position: 'relative' }}>
              <button type="button" className="sbacc-btn gold" onClick={() => setAssignFor(assignFor === key ? null : key)}>Assign</button>
              {assignFor === key && (
                <span className="sbacc-menu">
                  <span className="sbacc-mh">Send to</span>
                  {STAFF_NAMES.map(p => <button type="button" key={p} onClick={() => assign(row, lane, p)}>{p}</button>)}
                  <span className="sbacc-mh">Department</span>
                  {DEPARTMENTS.map(d => <button type="button" key={d} onClick={() => assign(row, lane, d)}>{d}</button>)}
                </span>
              )}
            </span>
          )}
          {extra}
          <button type="button" className="sbacc-btn" onClick={() => onOpenOrderDetail?.(row.orderId)}>Open</button>
        </span>
      </div>
    )
  }

  return (
    <div className="sbacc">
      <style>{CSS}</style>

      {/* KPI strip */}
      <div className="sbacc-kpis">
        <button type="button" className="sbacc-kpi red" onClick={() => openDrawer('Cash due', data.cash)}>
          <span className="l">Cash open</span><span className="v red">{fmtUSD(data.cashTotal)}</span><span className="s">{data.cash.length} order{data.cash.length === 1 ? '' : 's'} owing</span>
        </button>
        <button type="button" className="sbacc-kpi amber" onClick={() => openDrawer('Layouts — needs design / sent / denied', [...data.layouts.denied, ...data.layouts.sent, ...data.layouts.needs].map(c => ({ ...c, tag: c.type, sev: 'amber', dd: c.sitting, why: 'layout in play' })))}>
          <span className="l">Layouts in play</span><span className="v">{layoutCount}</span><span className="s">{data.layouts.denied.length} denied · {data.layouts.sent.length} sent</span>
        </button>
        <button type="button" className="sbacc-kpi amber" onClick={() => openDrawer('Permits', data.permits)}>
          <span className="l">Permits</span><span className="v">{data.permits.length}</span><span className="s">{data.permits.filter(p => p.tag === 'DENIED').length} denied · {data.permits.filter(p => p.tag === 'BUILD SHEVCO').length} to build</span>
        </button>
        <button type="button" className="sbacc-kpi blue" onClick={() => openDrawer('Stone to order', data.stone)}>
          <span className="l">Stone</span><span className="v">{data.stone.length}</span><span className="s">{data.stone.filter(s => s.tag === 'LATE').length} late — chase</span>
        </button>
        <button type="button" className="sbacc-kpi plum" onClick={() => openDrawer('Photos to order', data.photos)}>
          <span className="l">Photos</span><span className="v">{data.photos.length}</span><span className="s">{data.photos[0] ? `oldest ${data.photos[0].dd}d` : 'all ordered'}</span>
        </button>
        <button type="button" className="sbacc-kpi green" onClick={() => toast(`${openTasks.length} open tasks across the team`)}>
          <span className="l">Tasked + moving</span><span className="v green">{openTasks.length}</span><span className="s">open tasks</span>
        </button>
      </div>

      {/* Pipeline river */}
      <div className="sbacc-mod">
        <div className="sbacc-mhd"><h3>The pipeline — where jobs are piling up</h3><span className="note">bar = jobs sitting at that step · red = bottleneck</span></div>
        <div className="sbacc-river">
          {RIVER_DEF.map(s => {
            const rows = data.river[s.key]
            const hot = s.key === hotKey && rows.length > 0
            const h = s.key === 'money' ? Math.min(44, 10 + rows.length * 4) : Math.max(8, Math.round(38 * rows.length / riverMax))
            return (
              <button type="button" key={s.key} className={`sbacc-stage${hot ? ' hot' : ''}`}
                onClick={() => openDrawer(s.label.replace('\n', ' '), rows.map(r => ({ ...r, why: '', dd: 0, amount: undefined })), 'river')}>
                {hot && <span className="flag">PILE-UP</span>}
                <span className="bar" style={{ height: `${h}px` }} />
                <span className="n">{rows.length}</span>
                <span className="t">{s.label.split('\n').map((l, i) => <span key={i}>{l}<br /></span>)}</span>
              </button>
            )
          })}
        </div>
      </div>

      {/* Layouts */}
      <div className="sbacc-mod">
        <div className="sbacc-mhd">
          <h3>Layouts</h3>
          <span className="sbacc-typechips">
            {[['all', 'All'], ['new_stone', 'New stone'], ['bronze', 'Bronze Services'], ['inscription', 'Inscription']].map(([c, l]) => (
              <button type="button" key={c} className={`sbacc-chipbtn${typeFilter === c ? ' on' : ''}`} onClick={() => setTypeFilter(c)}>{l}</button>
            ))}
          </span>
          <span className="note">{layoutCount + data.layouts.approved.length} in play · dot = sitting time</span>
        </div>
        <div className="sbacc-kan">
          {[
            ['needs', 'Needs design', data.layouts.needs.filter(typeFilterFn), 'amber'],
            ['sent', 'Sent — waiting', data.layouts.sent.filter(typeFilterFn), 'blue'],
            ['approved', 'Approved (14d)', data.layouts.approved.filter(typeFilterFn), 'green'],
            ['denied', 'Denied / changes', data.layouts.denied.filter(typeFilterFn), 'red'],
          ].map(([k, label, cards, tone]) => (
            <div key={k} className={`sbacc-kcol ${tone}`}>
              <div className="kh">{label}<span className="kn">{cards.length}</span></div>
              {cards.slice(0, 6).map(c => (
                <button type="button" key={`${c.jobId}`} className="sbacc-kcard" onClick={() => onOpenOrderDetail?.(c.orderId)}>
                  <span className="kf"><span className={`adot ${ageDot(c.sentDays ?? c.sitting)}`} />{c.fam}<span className={`age ${ageDot(c.sentDays ?? c.sitting)}`}>{c.sentDays ?? c.sitting}d</span></span>
                  <span className="kd">{c.type}{c.drawn ? ' · drawn — send it' : ''}{c.ord ? ` · ${c.ord}` : ''}</span>
                </button>
              ))}
              {cards.length > 6 && (
                <button type="button" className="sbacc-more" onClick={() => openDrawer(`Layouts — ${label}`, cards.map(c => ({ ...c, tag: c.type, sev: tone === 'red' ? 'red' : 'amber', dd: c.sentDays ?? c.sitting, why: c.drawn ? 'drawn — send it' : '' })))}>+{cards.length - 6} more</button>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Lanes grid */}
      <div className="sbacc-grid">
        {Object.entries(laneRows).map(([lane, rows]) => (
          <div key={lane} className="sbacc-mod half">
            <div className="sbacc-mhd"><h3>{lane}</h3>
              {lane === 'Cash due' && <span className="note red">{fmtUSD(data.cashTotal)}</span>}
              <button type="button" className="sbacc-seeall" onClick={() => openDrawer(lane, rows)}>See all {rows.length}</button>
            </div>
            {rows.length === 0 && <div className="sbacc-quiet">Nothing — quiet is good.</div>}
            {rows.slice(0, 4).map((row, i) => (
              <Row key={`${lane}${row.orderId}${i}`} row={row} lane={lane}
                extra={lane === 'Photos' ? <button type="button" className="sbacc-btn" onClick={() => markPhotoOrdered(row)}>Mark ordered</button> : null} />
            ))}
          </div>
        ))}
        <div className="sbacc-mod half">
          <div className="sbacc-mhd"><h3>Team load</h3><span className="note">open tasks per person</span></div>
          {teamLoad.length === 0 && <div className="sbacc-quiet">No open tasks.</div>}
          {teamLoad.map(([name, n]) => (
            <div key={name} className="sbacc-trow">
              <span>{name}</span>
              <span className="tb"><i style={{ width: `${Math.min(100, n * 12)}%` }} /></span>
              <span className="tn">{n}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Drawer */}
      {drawer && (
        <div className="sbacc-overlay" onClick={(e) => { if (e.target === e.currentTarget) setDrawer(null) }}>
          <div className="sbacc-drawer">
            <div className="sbacc-dhd">
              <h3>{drawer.title}</h3>
              <span className="note">{drawer.rows.length} order{drawer.rows.length === 1 ? '' : 's'}</span>
              <button type="button" className="sbacc-btn" onClick={() => setDrawer(null)}>Close</button>
            </div>
            <div className="sbacc-dbody">
              {drawer.rows.length === 0 && <div className="sbacc-quiet">Nothing here right now.</div>}
              {drawer.rows.map((row, i) => (
                <Row key={`d${row.orderId}${row.jobId || ''}${i}`} row={row} lane={drawer.title.split(' — ')[0]}
                  extra={drawer.title === 'Photos to order' ? <button type="button" className="sbacc-btn" onClick={() => markPhotoOrdered(row)}>Mark ordered</button> : null} />
              ))}
            </div>
          </div>
        </div>
      )}

      {toastMsg && <div className="sbacc-toast">{toastMsg}</div>}
    </div>
  )
}

const CSS = `
.sbacc{background:#14110c;border:1px solid #2e2920;border-radius:14px;padding:16px;color:#f0e9da;font-size:13.5px}
.sbacc *{box-sizing:border-box}
.sbacc button{font-family:inherit}
.sbacc-kpis{display:grid;grid-template-columns:repeat(6,1fr);gap:9px;margin-bottom:12px}
@media (max-width:1100px){.sbacc-kpis{grid-template-columns:repeat(3,1fr)}}
.sbacc-kpi{background:#1c1915;border:1px solid #2e2920;border-radius:10px;padding:9px 11px;cursor:pointer;text-align:left;display:flex;flex-direction:column;gap:1px;border-top:3px solid #6b6353}
.sbacc-kpi:hover{border-color:#4a4133}
.sbacc-kpi.red{border-top-color:#ff6f61}.sbacc-kpi.amber{border-top-color:#e8b64c}.sbacc-kpi.blue{border-top-color:#6aa5f8}.sbacc-kpi.plum{border-top-color:#c09ae6}.sbacc-kpi.green{border-top-color:#5fbd85}
.sbacc-kpi .l{font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:#9a917f;font-weight:700}
.sbacc-kpi .v{font-size:21px;font-weight:800;font-variant-numeric:tabular-nums;color:#f0e9da}
.sbacc-kpi .v.red{color:#ff6f61}.sbacc-kpi .v.green{color:#5fbd85}
.sbacc-kpi .s{font-size:11px;color:#9a917f;font-variant-numeric:tabular-nums}
.sbacc-mod{background:#1c1915;border:1px solid #2e2920;border-radius:12px;padding:12px 14px;margin-bottom:12px}
.sbacc-mhd{display:flex;align-items:center;gap:10px;margin-bottom:10px;flex-wrap:wrap}
.sbacc-mhd h3{font-size:11.5px;letter-spacing:.1em;text-transform:uppercase;font-weight:800;color:#d4a944;margin:0}
.sbacc-mhd .note{font-size:11px;color:#6b6353}
.sbacc-mhd .note.red{color:#ff6f61;font-weight:800;font-size:13px}
.sbacc-seeall{margin-left:auto;background:none;border:none;color:#d4a944;font-size:12px;font-weight:700;cursor:pointer;padding:2px 4px}
.sbacc-seeall:hover{text-decoration:underline}
.sbacc-river{display:grid;grid-template-columns:repeat(8,1fr);gap:6px;align-items:end}
@media (max-width:1100px){.sbacc-river{grid-template-columns:repeat(4,1fr);row-gap:14px}}
.sbacc-stage{position:relative;background:none;border:none;color:inherit;text-align:center;cursor:pointer;padding:10px 2px 2px;border-radius:8px}
.sbacc-stage:hover{background:#211d17}
.sbacc-stage .bar{display:block;width:52%;margin:0 auto;border-radius:5px 5px 2px 2px;background:linear-gradient(180deg,#d4a944,#8a6f2e);opacity:.75}
.sbacc-stage.hot .bar{background:linear-gradient(180deg,#ff6f61,#8a3a30);opacity:1;box-shadow:0 0 16px rgba(255,111,97,.35)}
.sbacc-stage .n{display:block;font-size:16px;font-weight:800;font-variant-numeric:tabular-nums;margin-top:4px}
.sbacc-stage.hot .n{color:#ff6f61}
.sbacc-stage .t{display:block;font-size:10px;color:#9a917f;line-height:1.25}
.sbacc-stage .flag{position:absolute;top:-4px;left:50%;transform:translateX(-50%);font-size:8.5px;letter-spacing:.12em;font-weight:800;color:#ff6f61;background:#3a1f1b;border:1px solid #5c2d26;border-radius:999px;padding:1px 7px;white-space:nowrap}
.sbacc-typechips{display:flex;gap:6px}
.sbacc-chipbtn{background:#211d17;border:1px solid #2e2920;color:#9a917f;font-size:11px;font-weight:700;border-radius:999px;padding:3px 10px;cursor:pointer}
.sbacc-chipbtn.on{color:#14110c;background:#d4a944;border-color:#d4a944}
.sbacc-kan{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}
@media (max-width:1100px){.sbacc-kan{grid-template-columns:repeat(2,1fr)}}
.sbacc-kcol{background:#211d17;border:1px solid #2e2920;border-radius:9px;padding:8px;min-height:90px}
.sbacc-kcol .kh{display:flex;align-items:center;font-size:10px;letter-spacing:.07em;text-transform:uppercase;font-weight:800;margin-bottom:7px}
.sbacc-kcol .kh .kn{margin-left:auto;font-size:11.5px;font-variant-numeric:tabular-nums}
.sbacc-kcol.amber .kh{color:#e8b64c}.sbacc-kcol.blue .kh{color:#6aa5f8}.sbacc-kcol.green .kh{color:#5fbd85}.sbacc-kcol.red .kh{color:#ff6f61}
.sbacc-kcard{display:block;width:100%;text-align:left;background:#1c1915;border:1px solid #2e2920;border-radius:7px;padding:5px 7px;margin-bottom:5px;cursor:pointer;color:inherit;font-size:12px}
.sbacc-kcard:hover{border-color:#4a4133}
.sbacc-kcard .kf{display:flex;align-items:center;gap:6px;font-weight:700}
.sbacc-kcard .age{margin-left:auto;font-size:10px;font-variant-numeric:tabular-nums;font-weight:700}
.sbacc-kcard .kd{display:block;color:#9a917f;font-size:10px;margin-top:1px}
.sbacc-kcol.red .sbacc-kcard{border-color:#553028}
.adot{width:7px;height:7px;border-radius:50%;flex:none}
.adot.ok,.age.ok{color:#5fbd85}.adot.ok{background:#5fbd85}
.adot.warn,.age.warn{color:#e8b64c}.adot.warn{background:#e8b64c}
.adot.bad,.age.bad{color:#ff6f61}.adot.bad{background:#ff6f61}
.sbacc-more{background:none;border:none;color:#d4a944;font-size:11px;font-weight:700;cursor:pointer;padding:2px}
.sbacc-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
@media (max-width:1100px){.sbacc-grid{grid-template-columns:1fr}}
.sbacc-grid .sbacc-mod{margin-bottom:0}
.sbacc-lrow{display:flex;align-items:center;gap:8px;padding:6px 2px;border-top:1px solid #2e2920;font-size:12.5px;flex-wrap:wrap}
.sbacc-fam{font-weight:700;cursor:pointer;min-width:96px}
.sbacc-fam:hover{color:#d4a944}
.sbacc-tag{font-size:9.5px;font-weight:800;letter-spacing:.05em;border-radius:999px;padding:2px 8px;white-space:nowrap}
.sbacc-tag.red{background:#3a1f1b;color:#ff6f61}.sbacc-tag.amber{background:#38301a;color:#e8b64c}
.sbacc-tag.blue{background:#1c2a40;color:#6aa5f8}.sbacc-tag.plum{background:#2e2438;color:#c09ae6}
.sbacc-tag.tan{background:#332b1c;color:#c8a86a}.sbacc-tag.green{background:#1c3226;color:#5fbd85}
.sbacc-why{color:#9a917f;font-size:11.5px;flex:1;min-width:120px}
.sbacc-dd{font-variant-numeric:tabular-nums;font-weight:700;white-space:nowrap}
.sbacc-acts{display:flex;gap:6px;align-items:center}
.sbacc-btn{font-size:11.5px;font-weight:700;border-radius:7px;padding:4px 10px;cursor:pointer;border:1px solid #2e2920;background:#211d17;color:#f0e9da}
.sbacc-btn:hover{border-color:#4a4133}
.sbacc-btn.gold{background:#8f6f22;border-color:#8f6f22;color:#fff}
.sbacc-btn.gold:hover{background:#7d611e}
.sbacc-tasked{font-size:11.5px;font-weight:700;color:#5fbd85;background:#1c3226;border-radius:999px;padding:4px 10px;white-space:nowrap}
.sbacc-menu{position:absolute;top:28px;right:0;background:#26221b;border:1px solid #4a4133;border-radius:10px;box-shadow:0 10px 28px rgba(0,0,0,.5);min-width:170px;z-index:60;padding:5px;display:block;max-height:300px;overflow-y:auto}
.sbacc-mh{display:block;font-size:9.5px;letter-spacing:.08em;text-transform:uppercase;color:#6b6353;font-weight:800;padding:5px 9px 3px}
.sbacc-menu button{display:block;width:100%;text-align:left;font-size:12.5px;border:none;background:none;padding:6px 9px;border-radius:6px;cursor:pointer;color:#f0e9da}
.sbacc-menu button:hover{background:#38301a}
.sbacc-quiet{color:#6b6353;font-size:12px;padding:8px 2px}
.sbacc-trow{display:grid;grid-template-columns:76px 1fr 26px;gap:10px;align-items:center;padding:5px 2px;font-size:12.5px}
.sbacc-trow .tb{height:8px;background:#211d17;border:1px solid #2e2920;border-radius:5px;position:relative;display:block}
.sbacc-trow .tb i{position:absolute;left:0;top:0;bottom:0;border-radius:5px;background:linear-gradient(90deg,#8a6f2e,#d4a944)}
.sbacc-trow .tn{font-variant-numeric:tabular-nums;font-weight:700;text-align:right}
.sbacc-overlay{position:fixed;inset:0;background:rgba(10,8,5,.55);z-index:80;display:flex;justify-content:flex-end}
.sbacc-drawer{width:min(560px,94vw);background:#1c1915;border-left:1px solid #4a4133;height:100%;display:flex;flex-direction:column;box-shadow:-14px 0 40px rgba(0,0,0,.5)}
.sbacc-dhd{display:flex;align-items:center;gap:10px;padding:14px 16px;border-bottom:1px solid #2e2920}
.sbacc-dhd h3{font-size:14px;font-weight:800;color:#f0e9da;margin:0;flex:1}
.sbacc-dhd .note{font-size:11.5px;color:#9a917f}
.sbacc-dbody{overflow-y:auto;padding:6px 16px 20px}
.sbacc-toast{position:fixed;left:50%;bottom:26px;transform:translateX(-50%);background:#d4a944;color:#1c1608;font-size:13px;font-weight:700;padding:10px 18px;border-radius:999px;z-index:90;box-shadow:0 8px 24px rgba(0,0,0,.5);max-width:88vw;text-align:center}
`
