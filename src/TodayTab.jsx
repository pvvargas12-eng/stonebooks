// =============================================================================
// 📚 Stonebooks — TODAY (GOD MODE rebuild, Paul 2026-07-14)
// =============================================================================
// The failsafe screen. Doctrine: every commitment is a RECORD with an owner,
// an age, and a status — never a notification someone has to remember. A loop
// leaves this screen only by being resolved (or snoozed to a date, and a
// snooze comes back). Approvals are PROVEN sent against the outbound mail
// record, never assumed. "Needs you first" prints the rule that put each row
// there. Money lives in Reports now (money_pulse report), not here.
//
// Sections: I-am switcher → open-loops ledger → self-check → yesterday band →
// needs-you + approvals + schedule | tomorrow + shop pulse → tasks (task-me
// capture, replies inbox, All / By employee).
// =============================================================================

import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  listAllOrders, getJobs, getBatches, getAllOpenPromises, getFoundationList,
  listAllApprovalLinks, getApprovalEmailEvidence,
  listShopTasks, addShopTask, setShopTaskDone, deleteShopTask, snoozeShopTask,
  listTaskReplies, addTaskReply, markReplyHandled,
  computeOrderPressure, deriveStoneStatus, statusDimApplies, isReadyToSet,
  manualBlockerChipText,
  STAFF_NAMES, getActiveStaffUser, setActiveStaffUser,
  fmtDate, customerName,
} from './lib/stonebooksData'

const pad = (n) => String(n).padStart(2, '0')
const isoOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const dayLabel = (d) => d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
const famOf = (o) => {
  const raw = (o?.primary_lastname && String(o.primary_lastname).trim())
    || (o?.customer?.last_name && String(o.customer.last_name).trim())
    || customerName(o?.customer) || '—'
  return String(raw).toLowerCase().replace(/(^|[\s'’-])([a-z])/g, (_, s, c) => s + c.toUpperCase())
}
const daysBetween = (fromIso, toIso) => {
  const a = Date.parse(String(fromIso).slice(0, 10) + 'T00:00:00')
  const b = Date.parse(String(toIso).slice(0, 10) + 'T00:00:00')
  if (Number.isNaN(a) || Number.isNaN(b)) return null
  return Math.max(0, Math.floor((b - a) / 86400000))
}
const KIND_LABEL = {
  foundation_trip: 'Foundation run', setting: 'Set', delivery: 'Delivery',
  inscription: 'Inscription', blasting: 'Shop — blasting', acid_wash: 'Acid wash',
  repair: 'Repair', rub_grab: 'Rub & grab', door_trip: 'Door run',
  site_visit: 'Site visit', errand: 'Errand',
}
const IN_SHOP = new Set(['ordered', 'in_stock', 'needs_pickup', 'needs_stencil_cut', 'needs_blasting'])
const PERMIT_PENDING = new Set(['cemetery_permit_needed', 'shev_permit_needed', 'submitted', 'required'])

export default function TodayTab({ user, profile, onOpenSales, onOpenOrder, onOpenOrderDetail, onOpenJob, onOpenCustomer }) { // eslint-disable-line no-unused-vars
  const [now] = useState(() => new Date())
  const todayISO = isoOf(now)
  const yestISO = isoOf(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1))
  const tmrwISO = isoOf(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1))

  const openOrder = onOpenOrderDetail || onOpenOrder

  const [me, setMe] = useState(() => getActiveStaffUser())
  const pickMe = (name) => { setActiveStaffUser(name); setMe(name) }

  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState(null)
  const [orders, setOrders] = useState([])
  const [jobs, setJobs] = useState([])
  const [links, setLinks] = useState([])
  const [evidence, setEvidence] = useState([])
  const [batches, setBatches] = useState([])
  const [promises, setPromises] = useState([])
  const [fdnCount, setFdnCount] = useState(0)
  const [tasks, setTasks] = useState([])
  const [replies, setReplies] = useState([])
  const [busyId, setBusyId] = useState(null)

  const reloadTasks = useCallback(async () => {
    const ts = await listShopTasks()
    setTasks(ts)
    setReplies(await listTaskReplies(ts.map(t => t.id)))
  }, [])

  const loadAll = useCallback(async () => {
    setLoading(true); setErr(null)
    try {
      const [os, js, ls, ev, bs, ps, fl, ts] = await Promise.all([
        listAllOrders({ archived: false, limit: 2000 }),
        getJobs({ includeClosed: false, limit: 2000 }),
        listAllApprovalLinks(),
        getApprovalEmailEvidence(),
        getBatches({ from: yestISO, to: tmrwISO }),
        getAllOpenPromises(),
        getFoundationList(),
        listShopTasks(),
      ])
      setOrders(os || []); setJobs(js || []); setLinks(ls || []); setEvidence(ev || [])
      setBatches(bs || []); setPromises(ps || []); setFdnCount((fl || []).length)
      setTasks(ts || [])
      setReplies(await listTaskReplies((ts || []).map(t => t.id)))
    } catch (e) { setErr(e?.message || 'Failed to load Today') }
    setLoading(false)
  }, [yestISO, tmrwISO])
  useEffect(() => { loadAll() }, [loadAll])

  // ── Enrichment ──────────────────────────────────────────────────────────────
  const jobByOrderId = useMemo(() => {
    const m = new Map()
    for (const j of jobs) if (j.order_id && !m.has(j.order_id)) m.set(j.order_id, j)
    return m
  }, [jobs])
  const orderById = useMemo(() => new Map(orders.map(o => [o.id, o])), [orders])
  const enriched = useMemo(() => orders.map(o => {
    const job = jobByOrderId.get(o.id) || null
    return { o, job, pressure: computeOrderPressure(o, job, job?.milestones) }
  }), [orders, jobByOrderId])

  // ── Approvals — open links + hard email verdict ─────────────────────────────
  const approvals = useMemo(() => {
    const open = links.filter(l => l.displayStatus === 'pending' || l.displayStatus === 'viewed' || l.displayStatus === 'expired')
    return open.map(l => {
      let verdict = null
      if (l.emailed_at) verdict = { ok: true, when: l.emailed_at, to: l.emailed_to }
      else {
        const hit = l.share_url ? evidence.find(m => (m.body_text || '').includes(l.share_url)) : null
        verdict = hit ? { ok: true, when: hit.created_at, to: (hit.to_emails || [])[0] } : { ok: false }
      }
      const ageDays = daysBetween(l.created_at, todayISO)
      const expSoon = l.expires_at && (new Date(l.expires_at).getTime() - now.getTime()) < 48 * 3600000 && l.displayStatus !== 'expired'
      return { ...l, verdict, ageDays, expSoon }
    }).sort((a, b) => (a.verdict.ok === b.verdict.ok ? (b.ageDays || 0) - (a.ageDays || 0) : a.verdict.ok ? 1 : -1))
  }, [links, evidence, todayISO, now])

  // ── Needs you — every row carries the RULE that put it there ────────────────
  const needsYou = useMemo(() => {
    const rows = []
    for (const a of approvals) {
      const ord = a.order || orderById.get(a.order_id) || null
      if (!a.verdict.ok && a.displayStatus !== 'expired') {
        rows.push({ key: `apr-${a.id}`, sev: 0, fam: famOf(ord), orderId: a.order_id, pill: ['red', 'Approval'], ruleText: 'rule: approval link created, never emailed', text: 'Approval link exists but no email ever carried it — review & send.' })
      } else if (a.displayStatus === 'viewed' && a.viewed_at && daysBetween(a.viewed_at, todayISO) >= 3) {
        rows.push({ key: `aprv-${a.id}`, sev: 0, fam: famOf(ord), orderId: a.order_id, pill: ['red', 'Needs call'], ruleText: `rule: approval viewed, no answer ${daysBetween(a.viewed_at, todayISO)}d`, text: `Family opened the approval ${daysBetween(a.viewed_at, todayISO)} days ago and hasn't answered.` })
      }
    }
    for (const { o, pressure } of enriched) {
      if (o.manual_blocker) {
        rows.push({ key: `mb-${o.id}`, sev: 1, fam: famOf(o), orderId: o.id, pill: ['amber', manualBlockerChipText(o.manual_blocker)], ruleText: `rule: manual flag, set by ${o.manual_blocker.setBy || 'staff'}${o.manual_blocker.setAt ? ' ' + String(o.manual_blocker.setAt).slice(0, 10) : ''}`, text: o.manual_blocker.note || 'Flagged by hand — clear it from the order when handled.' })
      }
      const b = pressure.blocker
      if (b && b.severity === 'red') {
        rows.push({ key: `pb-${o.id}`, sev: 0, fam: famOf(o), orderId: o.id, pill: ['red', b.label], ruleText: `rule: ${b.kind}`, text: `${b.label}.` })
      }
      if (!o.signed_at && ['contracted', 'in_production'].includes(o.status)) {
        const age = daysBetween(o.created_at, todayISO)
        if (age != null && age > 14) rows.push({ key: `us-${o.id}`, sev: 1, fam: famOf(o), orderId: o.id, pill: ['amber', 'Unsigned'], ruleText: `rule: contracted + unsigned > 14 days (${age}d)`, text: `Contracted ${age} days, still unsigned — resend the signing link?` })
      }
    }
    const seen = new Set()
    const out = rows.filter(r => { const k = `${r.orderId}:${r.pill[1]}`; if (seen.has(k)) return false; seen.add(k); return true })
    out.sort((a, b) => a.sev - b.sev)
    return out
  }, [approvals, enriched, orderById, todayISO])

  // ── Schedule (yesterday / today / tomorrow batches) ─────────────────────────
  const batchesOn = useCallback((iso) => batches.filter(b => String(b.scheduled_date || '').slice(0, 10) === iso && b.status !== 'cancelled'), [batches])
  const yBatches = useMemo(() => batchesOn(yestISO), [batchesOn, yestISO])
  const tBatches = useMemo(() => batchesOn(todayISO).sort((a, b) => String(a.am_pm || 'zz').localeCompare(String(b.am_pm || 'zz'))), [batchesOn, todayISO])
  const mBatches = useMemo(() => batchesOn(tmrwISO), [batchesOn, tmrwISO])

  const openTasks = useMemo(() => tasks.filter(t => t.status === 'open' && (!t.snoozed_until || t.snoozed_until <= todayISO)), [tasks, todayISO])
  const snoozedCount = useMemo(() => tasks.filter(t => t.status === 'open' && t.snoozed_until && t.snoozed_until > todayISO).length, [tasks, todayISO])
  const yTasksPlanned = useMemo(() => tasks.filter(t => t.due_date === yestISO), [tasks, yestISO])
  const ySlippedTasks = useMemo(() => openTasks.filter(t => t.due_date && t.due_date < todayISO), [openTasks, todayISO])
  const tmrwTasks = useMemo(() => openTasks.filter(t => t.due_date === tmrwISO), [openTasks, tmrwISO])

  const yesterday = useMemo(() => {
    const planned = yBatches.length + yTasksPlanned.length
    const doneB = yBatches.filter(b => b.status === 'completed')
    const doneT = yTasksPlanned.filter(t => t.status === 'done')
    const slippedB = yBatches.filter(b => b.status !== 'completed')
    return { planned, done: doneB.length + doneT.length, slippedB, slippedT: ySlippedTasks.slice(0, 4) }
  }, [yBatches, yTasksPlanned, ySlippedTasks])

  // ── Pulse + open loops ──────────────────────────────────────────────────────
  const pulse = useMemo(() => {
    let inShop = 0, ready = 0
    for (const j of jobs) {
      if (statusDimApplies('stone', j) && IN_SHOP.has(deriveStoneStatus(j))) inShop++
      const o = j.order
      if (o && isReadyToSet(o, j)) ready++
    }
    const callsOwed = enriched.filter(({ o, pressure }) => pressure.needsCall || o.manual_blocker?.kind === 'needs_call').length
    return { inShop, ready, callsOwed }
  }, [jobs, enriched])
  const loops = useMemo(() => {
    const approvalsOut = approvals.filter(a => a.displayStatus !== 'expired').length
    const permits = orders.filter(o => PERMIT_PENDING.has(o.permit_status)).length
    return {
      approvals: approvalsOut, calls: pulse.callsOwed, tasks: openTasks.length,
      promises: promises.length, permits,
      total: approvalsOut + pulse.callsOwed + openTasks.length + promises.length + permits,
    }
  }, [approvals, pulse, openTasks, promises, orders])

  // ── Self-check — the audit, every load ──────────────────────────────────────
  const selfCheck = useMemo(() => {
    const flags = []
    const signedNoJob = orders.filter(o => o.signed_at && !jobByOrderId.get(o.id))
    if (signedNoJob.length) flags.push({ label: `${signedNoJob.length} signed order${signedNoJob.length > 1 ? 's' : ''} with no job (opening self-heals)`, orderId: signedNoJob[0].id })
    const unsentApr = approvals.filter(a => !a.verdict.ok && a.displayStatus !== 'expired')
    if (unsentApr.length) flags.push({ label: `${unsentApr.length} approval link${unsentApr.length > 1 ? 's' : ''} never emailed`, orderId: unsentApr[0].order_id })
    const expSoon = approvals.filter(a => a.expSoon)
    if (expSoon.length) flags.push({ label: `${expSoon.length} approval link${expSoon.length > 1 ? 's' : ''} expiring within 48h`, orderId: expSoon[0].order_id })
    const noRefOrders = orders.filter(o => Array.isArray(o.payments) && o.payments.some(p => p && p.method === 'check' && (p.locked ?? true) && !p.voided && !String(p.ref || '').trim()))
    if (noRefOrders.length) flags.push({ label: `${noRefOrders.length} order${noRefOrders.length > 1 ? 's' : ''} carry check payments with no check #`, orderId: noRefOrders[0].id })
    const stale = jobs.filter(j => j.order && !j.order.archived && j.last_update_at && daysBetween(j.last_update_at, todayISO) > 14)
    if (stale.length) flags.push({ label: `${stale.length} active job${stale.length > 1 ? 's' : ''} untouched for 14+ days`, jobId: stale[0].id })
    return { total: 5, flags }
  }, [orders, jobs, jobByOrderId, approvals, todayISO])

  // ── Tasks: replies inbox + capture ──────────────────────────────────────────
  const taskById = useMemo(() => new Map(tasks.map(t => [t.id, t])), [tasks])
  const inbox = useMemo(() => {
    if (!me) return []
    return replies.filter(r => {
      if (r.handled_at) return false
      const t = taskById.get(r.task_id)
      if (!t) return false
      const recipient = r.author === t.assignee ? (t.created_by || t.assignee) : t.assignee
      return recipient === me && r.author !== me
    })
  }, [replies, taskById, me])
  const replyCountByTask = useMemo(() => {
    const m = new Map()
    for (const r of replies) m.set(r.task_id, (m.get(r.task_id) || 0) + 1)
    return m
  }, [replies])

  const [taskTab, setTaskTab] = useState('all')
  const [draft, setDraft] = useState({ assignee: '', title: '', orderId: '', due: '' })
  useEffect(() => { setDraft(d => ({ ...d, assignee: d.assignee || me || 'Paul', due: d.due || todayISO })) }, [me, todayISO])
  const [taskErr, setTaskErr] = useState(null)
  const [replyFor, setReplyFor] = useState(null)   // task id with reply box open
  const [replyText, setReplyText] = useState('')

  const submitTask = async () => {
    setTaskErr(null)
    const r = await addShopTask({ title: draft.title, assignee: draft.assignee, orderId: draft.orderId || null, dueDate: draft.due || null, createdBy: me || null })
    if (!r.ok) { setTaskErr(r.error); return }
    setDraft(d => ({ ...d, title: '', orderId: '' }))
    reloadTasks()
  }
  const toggleTask = async (t) => {
    setBusyId(t.id)
    await setShopTaskDone(t.id, t.status !== 'done', me || null)
    setBusyId(null); reloadTasks()
  }
  const removeTask = async (t) => {
    if (!window.confirm(`Delete "${t.title}"? Replies go with it.`)) return
    await deleteShopTask(t.id); reloadTasks()
  }
  const snoozeTask = async (t) => { await snoozeShopTask(t.id, tmrwISO); reloadTasks() }
  const sendReply = async (t) => {
    const r = await addTaskReply(t.id, replyText, me || 'Staff')
    if (r.ok) { setReplyFor(null); setReplyText(''); reloadTasks() }
  }
  const handleInbox = async (r) => { await markReplyHandled(r.id, me || null); reloadTasks() }

  const visibleTasks = useMemo(() => {
    const open = openTasks.slice().sort((a, b) => String(a.due_date || '9999').localeCompare(String(b.due_date || '9999')))
    const done = tasks.filter(t => t.status === 'done').slice(0, 6)
    return [...open, ...done]
  }, [openTasks, tasks])
  const byEmployee = useMemo(() => {
    const m = new Map(STAFF_NAMES.map(n => [n, []]))
    for (const t of visibleTasks) {
      if (!m.has(t.assignee)) m.set(t.assignee, [])
      m.get(t.assignee).push(t)
    }
    return m
  }, [visibleTasks])

  const orderOptions = useMemo(() =>
    orders.slice().sort((a, b) => famOf(a).localeCompare(famOf(b))).slice(0, 500)
      .map(o => ({ id: o.id, label: `${famOf(o)}${o.order_number ? ` · ${o.order_number}` : ''}` })),
  [orders])

  const dueTone = (t) => !t.due_date ? '' : t.due_date < todayISO ? 'over' : t.due_date === todayISO ? 'today' : ''
  const dueText = (t) => t.status === 'done' ? `done${t.done_at ? ' ' + fmtDate(t.done_at) : ''}` : !t.due_date ? '—' : t.due_date < todayISO ? `${daysBetween(t.due_date, todayISO)}d late` : t.due_date === todayISO ? 'today' : fmtDate(t.due_date)

  const renderTaskRow = (t, compact = false) => (
    <div key={t.id} className={`sb-td2-trow${t.status === 'done' ? ' done' : ''}`}>
      <input type="checkbox" checked={t.status === 'done'} disabled={busyId === t.id} onChange={() => toggleTask(t)} aria-label="Done" />
      <span className="txt">
        {t.title}
        {!compact && replyCountByTask.get(t.id) ? <span className="meta"> — {replyCountByTask.get(t.id)} repl{replyCountByTask.get(t.id) === 1 ? 'y' : 'ies'}</span> : null}
      </span>
      {!compact && t.order && (
        <button type="button" className="oc" onClick={() => openOrder?.(t.order.id)}>{t.order.order_number || famOf(t.order)}</button>
      )}
      {!compact && <span className="who">{(t.assignee || '').toUpperCase()}</span>}
      <span className={`due ${dueTone(t)}`}>{dueText(t)}</span>
      {t.status !== 'done' && <button type="button" className="rbtn" onClick={() => { setReplyFor(replyFor === t.id ? null : t.id); setReplyText('') }}>Reply</button>}
      {t.status !== 'done' && !compact && <button type="button" className="rbtn" title="Push to tomorrow — it comes back" onClick={() => snoozeTask(t)}>→ tmrw</button>}
      <button type="button" className="xbtn" title="Delete task" onClick={() => removeTask(t)}>×</button>
      {replyFor === t.id && (
        <span className="replybox">
          <input type="text" value={replyText} placeholder={`Reply as ${me || 'Staff'}…`} onChange={e => setReplyText(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') sendReply(t) }} autoFocus />
          <button type="button" className="rbtn" onClick={() => sendReply(t)}>Send</button>
        </span>
      )}
    </div>
  )

  if (loading) return <div className="sb-td2"><style>{CSS}</style><div className="sb-td2-empty">Loading Today…</div></div>

  return (
    <div className="sb-td2">
      <style>{CSS}</style>
      {err && <div className="sb-td2-err">{err}</div>}

      <header className="sb-td2-day">
        <h1>Today</h1>
        <span className="date">{dayLabel(now)}</span>
        <span className="spacer" />
        {needsYou.length > 0 && <span className="chip needs">{needsYou.length} need you</span>}
      </header>

      <div className="sb-td2-users">
        <span className="lab">I am</span>
        {STAFF_NAMES.map(n => (
          <button key={n} type="button" className={`ubtn${me === n ? ' on' : ''}`} onClick={() => pickMe(n)}>{n}</button>
        ))}
        {!me && <span className="hint">— pick yourself so tasks and stamps carry your name</span>}
      </div>

      {/* ── OPEN LOOPS ── */}
      <div className="sb-td2-loops">
        <div className="head">
          <span className="title">Open loops</span>
          <b className="total">{loops.total}</b>
          <span className="sub">a loop only leaves by being resolved or snoozed to a date — snoozes come back</span>
        </div>
        <div className="chips">
          <span className={`loopchip${loops.approvals ? ' red' : ''}`}>{loops.approvals} approvals out</span>
          <span className={`loopchip${loops.calls ? ' red' : ''}`}>{loops.calls} calls owed</span>
          <span className={`loopchip${loops.tasks ? ' amber' : ''}`}>{loops.tasks} open tasks{snoozedCount ? ` (+${snoozedCount} snoozed)` : ''}</span>
          <span className={`loopchip${loops.promises ? ' amber' : ''}`}>{loops.promises} promises</span>
          <span className={`loopchip${loops.permits ? ' blue' : ''}`}>{loops.permits} permits pending</span>
        </div>
      </div>

      {/* ── SELF-CHECK ── */}
      <div className="sb-td2-integrity">
        <span className="lab">Self-check</span>
        {selfCheck.flags.length === 0
          ? <span className="ok">all {selfCheck.total} checks passed</span>
          : <>
              <span className="ok">{selfCheck.total - selfCheck.flags.length} of {selfCheck.total} passed</span>
              {selfCheck.flags.map((f, i) => (
                <span key={i} className="flag">
                  {f.label}
                  {(f.orderId || f.jobId) && (
                    <button type="button" className="fixbtn" onClick={() => f.orderId ? openOrder?.(f.orderId) : onOpenJob?.(f.jobId)}>Fix</button>
                  )}
                </span>
              ))}
            </>}
      </div>

      {/* ── YESTERDAY ── */}
      <div className="sb-td2-yband">
        <span className="lab">Yesterday</span>
        <span className="ynum"><b>{yesterday.planned}</b><span>planned</span></span>
        <span className="ynum done"><b>{yesterday.done}</b><span>done</span></span>
        <span className="ynum slip"><b>{yesterday.slippedB.length + ySlippedTasks.length}</b><span>slipped</span></span>
        {(yesterday.slippedB.length > 0 || yesterday.slippedT.length > 0) && <span className="ydiv" />}
        <span className="yslip">
          {yesterday.slippedB.map(b => (
            <span key={b.id} className="slipchip">{KIND_LABEL[b.kind] || b.kind}{b.cemetery?.name ? ` — ${b.cemetery.name}` : ''} <em>· not completed</em></span>
          ))}
          {yesterday.slippedT.map(t => (
            <span key={t.id} className="slipchip">{t.title} <em>· rolled to {t.assignee}</em></span>
          ))}
        </span>
      </div>

      <div className="sb-td2-grid">
        <div>
          {/* ── NEEDS YOU ── */}
          <div className="sb-td2-card">
            <h2>Needs you first <span className="n">{needsYou.length}</span> <span className="why-note">every row prints the rule that put it here</span></h2>
            {needsYou.length === 0 && <div className="sb-td2-empty">Nothing needs you. Rare — enjoy it.</div>}
            {needsYou.slice(0, 8).map(r => (
              <div key={r.key} className="need">
                <span className={`sevbar ${r.sev === 0 ? 'r' : 'a'}`} />
                <span className="who">{r.fam}</span>
                <span className="what">{r.text}<br /><span className="why">{r.ruleText}</span></span>
                <span className={`pill ${r.pill[0]}`}>{r.pill[1]}</span>
                <button type="button" className="act" onClick={() => openOrder?.(r.orderId)}>Open order</button>
              </div>
            ))}
            {needsYou.length > 8 && <div className="sb-td2-more">+{needsYou.length - 8} more in Orders</div>}
          </div>

          {/* ── APPROVALS OUT ── */}
          <div className="sb-td2-card" style={{ marginTop: 18 }}>
            <h2>Approvals out <span className="n">{approvals.length}</span> <span className="why-note">verified against the real outbound mail record</span></h2>
            {approvals.length === 0 && <div className="sb-td2-empty">No approval links outstanding.</div>}
            {approvals.map(a => {
              const ord = a.order || orderById.get(a.order_id) || null
              return (
                <div key={a.id} className="apr">
                  <span className="fam">{famOf(ord)}</span>
                  <span className="d">
                    {a.displayStatus === 'viewed' ? `Opened by the family${a.viewed_at ? ' ' + fmtDate(a.viewed_at) : ''}` : a.displayStatus === 'expired' ? 'Link expired — never answered' : 'Waiting to be opened'}
                    <br />
                    {a.verdict.ok
                      ? <span className="verify ok">Email verified — sent {fmtDate(a.verdict.when)}{a.verdict.to ? ` to ${a.verdict.to}` : ''}</span>
                      : <span className="verify bad">NO EMAIL ON RECORD — the family has received nothing</span>}
                  </span>
                  <span className={`pill ${!a.verdict.ok ? 'red' : a.expSoon || a.displayStatus === 'expired' ? 'red' : 'amber'}`}>
                    {!a.verdict.ok ? 'Never sent' : a.displayStatus === 'expired' ? 'Expired' : a.expSoon ? 'Expiring' : a.displayStatus === 'viewed' ? 'Viewed · waiting' : 'Sent · waiting'}
                  </span>
                  <span className="age">{a.ageDays != null ? `${a.ageDays}d` : ''}</span>
                  <button type="button" className={`act${!a.verdict.ok ? ' solid' : ''}`} onClick={() => openOrder?.(a.order_id)}>
                    {!a.verdict.ok ? 'Send now' : 'Open'}
                  </button>
                </div>
              )
            })}
          </div>

          {/* ── SCHEDULE ── */}
          <div className="sb-td2-card" style={{ marginTop: 18 }}>
            <h2>Today's schedule <span className="n">{tBatches.length} run{tBatches.length === 1 ? '' : 's'}</span></h2>
            {tBatches.length === 0 && <div className="sb-td2-empty">Nothing scheduled today — the Scheduler builds the runs.</div>}
            {tBatches.map(b => (
              <div key={b.id} className="slot">
                <span className="t">{(b.am_pm || '—').toUpperCase()}</span>
                <div className="body">
                  <div className="title">{b.title || KIND_LABEL[b.kind] || b.kind}{b.cemetery?.name ? ` — ${b.cemetery.name}` : ''}
                    {b.assigned_to && <span className="crew">{String(b.assigned_to).toUpperCase()}</span>}
                  </div>
                  <div className="sub">{(b.batch_jobs || []).length} stop{(b.batch_jobs || []).length === 1 ? '' : 's'}{b.notes ? ` · ${b.notes}` : ''}</div>
                </div>
                <span className={`pill ${b.status === 'completed' ? 'green' : b.status === 'running_late' ? 'red' : 'blue'}`}>{b.status === 'completed' ? 'Done' : b.status === 'running_late' ? 'Late' : 'Planned'}</span>
              </div>
            ))}
          </div>
        </div>

        <div>
          {/* ── TOMORROW ── */}
          <div className="sb-td2-card">
            <h2>Tomorrow — just thinking</h2>
            {mBatches.length === 0 && tmrwTasks.length === 0 && <div className="sb-td2-empty">Clear so far.</div>}
            {mBatches.map(b => (
              <div key={b.id} className="slot">
                <span className="t">{(b.am_pm || '—').toUpperCase()}</span>
                <div className="body">
                  <div className="title">{b.title || KIND_LABEL[b.kind] || b.kind}{b.cemetery?.name ? ` — ${b.cemetery.name}` : ''}</div>
                  <div className="sub">{(b.batch_jobs || []).length} stop{(b.batch_jobs || []).length === 1 ? '' : 's'}</div>
                </div>
              </div>
            ))}
            {tmrwTasks.length > 0 && (
              <div className="slot"><span className="t">—</span>
                <div className="body">
                  <div className="title">{tmrwTasks.length} task{tmrwTasks.length === 1 ? '' : 's'} come due</div>
                  <div className="sub">{[...new Set(tmrwTasks.map(t => t.assignee))].map(n => `${tmrwTasks.filter(t => t.assignee === n).length} ${n}`).join(' · ')}</div>
                </div>
              </div>
            )}
          </div>

          {/* ── PULSE ── */}
          <div className="sb-td2-card" style={{ marginTop: 18 }}>
            <h2>Shop pulse</h2>
            <div className="pulse">
              <div><b>{pulse.inShop}</b><span>stones in shop</span></div>
              <div><b>{pulse.ready}</b><span>ready to set</span></div>
              <div><b>{fdnCount}</b><span>foundations on the list</span></div>
              <div><b>{pulse.callsOwed}</b><span>calls owed</span></div>
            </div>
          </div>

          <div className="sb-td2-moved">
            <b>Money moved out</b>
            Collected / owed / pace now live in Reports (Money pulse). Today is for work.
          </div>
        </div>
      </div>

      {/* ── TASKS ── */}
      <div className="sb-td2-card sb-td2-tasks">
        <h2>Tasks — "don't tell me, task me"</h2>
        <div className="taskbar">
          <select value={draft.assignee} onChange={e => setDraft(d => ({ ...d, assignee: e.target.value }))}>
            {STAFF_NAMES.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
          <input type="text" className="big" placeholder="Task them — e.g. order the Perez photo, 8×10 porcelain"
            value={draft.title} onChange={e => setDraft(d => ({ ...d, title: e.target.value }))}
            onKeyDown={e => { if (e.key === 'Enter') submitTask() }} />
          <select value={draft.orderId} onChange={e => setDraft(d => ({ ...d, orderId: e.target.value }))}>
            <option value="">No order</option>
            {orderOptions.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
          <input type="date" value={draft.due} onChange={e => setDraft(d => ({ ...d, due: e.target.value }))} />
          <button type="button" className="act solid" onClick={submitTask}>Task it</button>
          {taskErr && <span className="terr">{taskErr}</span>}
        </div>

        {inbox.length > 0 && (
          <div className="inbox">
            <span className="lab">Replies to you · {inbox.length}</span>
            {inbox.slice(0, 3).map(r => {
              const t = taskById.get(r.task_id)
              return (
                <span key={r.id} className="msg">
                  <b>{r.author}</b> on "{t?.title || 'task'}": <i>"{r.body}"</i>
                  <button type="button" className="act" style={{ marginLeft: 8, padding: '4px 10px', fontSize: 12 }} onClick={() => handleInbox(r)}>Mark handled</button>
                </span>
              )
            })}
          </div>
        )}

        <div className="ttabs">
          <button type="button" className={`ttab${taskTab === 'all' ? ' on' : ''}`} onClick={() => setTaskTab('all')}>All · {openTasks.length}</button>
          <button type="button" className={`ttab${taskTab === 'emp' ? ' on' : ''}`} onClick={() => setTaskTab('emp')}>By employee</button>
        </div>

        {taskTab === 'all' ? (
          <div className="tlist">
            {visibleTasks.length === 0 && <div className="sb-td2-empty">No tasks yet — task somebody.</div>}
            {visibleTasks.map(t => renderTaskRow(t))}
          </div>
        ) : (
          <div className="cols">
            {STAFF_NAMES.map(n => (
              <div key={n} className="col">
                <h3>{n} <span className="n">{(byEmployee.get(n) || []).filter(t => t.status === 'open').length}</span></h3>
                {(byEmployee.get(n) || []).map(t => renderTaskRow(t, true))}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

const CSS = `
  .sb-td2{max-width:1180px;margin:0 auto;padding:8px 28px 80px;color:#1A1E24;font-size:14px}
  .sb-td2 *{box-sizing:border-box}
  .sb-td2-err{background:#FBEDEA;border:1px solid rgba(179,38,30,.35);color:#B3261E;border-radius:10px;padding:10px 14px;margin-bottom:14px}
  .sb-td2-empty{color:#A39C87;font-size:13px;padding:16px 18px;font-style:italic}
  .sb-td2-more{color:#79735F;font-size:12px;padding:10px 18px;border-top:1px solid rgba(26,30,36,.09)}

  .sb-td2-day{display:flex;align-items:flex-end;gap:16px;flex-wrap:wrap;padding:18px 0 4px}
  .sb-td2-day h1{font-size:32px;letter-spacing:-.02em;line-height:1;margin:0}
  .sb-td2-day .date{font-size:14px;color:#79735F;padding-bottom:3px}
  .sb-td2-day .spacer{flex:1}
  .sb-td2 .chip.needs{background:#B3261E;color:#fff;font-size:12.5px;font-weight:700;border-radius:999px;padding:6px 13px}

  .sb-td2-users{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin:8px 0 18px}
  .sb-td2-users .lab{font:700 10.5px/1 var(--sb-font-mono,monospace);letter-spacing:.14em;text-transform:uppercase;color:#A39C87;margin-right:4px}
  .sb-td2-users .hint{font-size:12px;color:#B3261E;font-weight:600}
  .sb-td2 .ubtn{font:600 12.5px/1 inherit;font-family:inherit;border:1px solid rgba(26,30,36,.12);background:#fff;color:#79735F;border-radius:999px;padding:7px 14px;cursor:pointer}
  .sb-td2 .ubtn:hover{color:#1A1E24}
  .sb-td2 .ubtn.on{background:#0F1419;color:#fff;border-color:#0F1419;font-weight:700}

  .sb-td2-loops{background:#fff;border:1px solid rgba(26,30,36,.09);border-left:4px solid #9A7209;border-radius:14px;padding:13px 18px;margin-bottom:10px}
  .sb-td2-loops .head{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;margin-bottom:8px}
  .sb-td2-loops .title{font-size:11.5px;font-weight:800;letter-spacing:.13em;text-transform:uppercase;color:#79735F}
  .sb-td2-loops .total{font:700 21px/1 var(--sb-font-mono,monospace)}
  .sb-td2-loops .sub{font-size:12px;color:#A39C87}
  .sb-td2-loops .chips{display:flex;gap:8px;flex-wrap:wrap}
  .sb-td2 .loopchip{font-size:12.5px;font-weight:700;border-radius:999px;padding:6px 13px;border:1px solid rgba(26,30,36,.12);background:#fff;color:#79735F}
  .sb-td2 .loopchip.red{color:#B3261E;border-color:rgba(179,38,30,.35);background:#FBEDEA}
  .sb-td2 .loopchip.amber{color:#8A5A12;border-color:rgba(184,132,42,.35);background:#FBF2DE}
  .sb-td2 .loopchip.blue{color:#1D6FA8;border-color:rgba(29,111,168,.3);background:#EAF2FA}

  .sb-td2-integrity{display:flex;align-items:center;gap:12px;flex-wrap:wrap;background:#FDFCF8;border:1px dashed #CFC7B0;border-radius:12px;padding:9px 16px;margin-bottom:10px;font-size:12.5px}
  .sb-td2-integrity .lab{font:700 10.5px/1 var(--sb-font-mono,monospace);letter-spacing:.14em;text-transform:uppercase;color:#A39C87}
  .sb-td2-integrity .ok{color:#1D7A55;font-weight:700}
  .sb-td2-integrity .flag{color:#8A5A12;font-weight:600;display:inline-flex;align-items:center;gap:8px}
  .sb-td2 .fixbtn{font:600 11.5px/1 inherit;font-family:inherit;color:#9A7209;background:#fff;border:1px solid #9A7209;border-radius:7px;padding:4px 10px;cursor:pointer}

  .sb-td2-yband{background:#0F1419;border-radius:14px;color:#E7E2D4;padding:14px 20px;display:flex;gap:22px;align-items:center;flex-wrap:wrap;margin-bottom:18px}
  .sb-td2-yband .lab{font:700 10.5px/1 var(--sb-font-mono,monospace);letter-spacing:.16em;color:#8f8874;text-transform:uppercase}
  .sb-td2 .ynum{display:flex;align-items:baseline;gap:7px}
  .sb-td2 .ynum b{font:700 24px/1 var(--sb-font-mono,monospace)}
  .sb-td2 .ynum span{font-size:12px;color:#9d967f}
  .sb-td2 .ynum.done b{color:#4CC38A}.sb-td2 .ynum.slip b{color:#F28B82}
  .sb-td2 .ydiv{width:1px;align-self:stretch;background:rgba(255,255,255,.12)}
  .sb-td2 .yslip{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
  .sb-td2 .slipchip{background:rgba(242,139,130,.12);border:1px solid rgba(242,139,130,.35);color:#F5B9B3;font-size:12px;font-weight:600;border-radius:8px;padding:5px 11px}
  .sb-td2 .slipchip em{font-style:normal;color:#9d967f;font-size:11px}

  .sb-td2-grid{display:grid;grid-template-columns:1fr 320px;gap:18px;align-items:start}
  @media(max-width:900px){.sb-td2-grid{grid-template-columns:1fr}}
  .sb-td2-card{background:#fff;border:1px solid rgba(26,30,36,.09);border-radius:14px}
  .sb-td2-card h2{font-size:11.5px;font-weight:800;letter-spacing:.13em;text-transform:uppercase;color:#79735F;padding:14px 18px 4px;margin:0}
  .sb-td2-card h2 .n{font:700 12px var(--sb-font-mono,monospace);color:#1A1E24;background:#F6F3EC;border-radius:999px;padding:1px 9px;margin-left:8px}
  .sb-td2 .why-note{font-size:10.5px;font-weight:600;letter-spacing:0;text-transform:none;color:#A39C87;margin-left:8px}

  .sb-td2 .need{display:flex;align-items:center;gap:12px;padding:12px 18px;border-top:1px solid rgba(26,30,36,.07)}
  .sb-td2 .sevbar{width:4px;align-self:stretch;border-radius:3px;flex:0 0 4px}
  .sb-td2 .sevbar.r{background:#B3261E}.sb-td2 .sevbar.a{background:#C79A3B}
  .sb-td2 .need .who{font-weight:700;min-width:105px}
  .sb-td2 .need .what{color:#79735F;flex:1;min-width:0;font-size:13px}
  .sb-td2 .why{font-size:10.5px;color:#A39C87;font-family:var(--sb-font-mono,monospace)}
  .sb-td2 .pill{font-size:10px;font-weight:800;letter-spacing:.05em;text-transform:uppercase;border-radius:999px;padding:3px 9px;white-space:nowrap}
  .sb-td2 .pill.red{color:#B3261E;background:#FBEDEA}
  .sb-td2 .pill.amber{color:#8A5A12;background:#FBF2DE}
  .sb-td2 .pill.blue{color:#1D6FA8;background:#EAF2FA}
  .sb-td2 .pill.green{color:#1D7A55;background:#E7F4EC}
  .sb-td2 .act{font:600 12.5px/1 inherit;font-family:inherit;color:#9A7209;background:#fff;border:1px solid #9A7209;border-radius:8px;padding:7px 13px;cursor:pointer;white-space:nowrap}
  .sb-td2 .act:hover{background:#F4EBD4}
  .sb-td2 .act.solid{background:#9A7209;color:#fff}

  .sb-td2 .apr{display:flex;align-items:center;gap:12px;padding:11px 18px;border-top:1px solid rgba(26,30,36,.07)}
  .sb-td2 .apr .fam{font-weight:700;min-width:105px}
  .sb-td2 .apr .d{font-size:12.5px;color:#79735F;flex:1;min-width:0}
  .sb-td2 .apr .age{font:600 11.5px var(--sb-font-mono,monospace);color:#79735F;white-space:nowrap}
  .sb-td2 .verify{font-size:11px;font-family:var(--sb-font-mono,monospace)}
  .sb-td2 .verify.ok{color:#1D7A55}
  .sb-td2 .verify.bad{color:#B3261E;font-weight:700}

  .sb-td2 .slot{display:flex;gap:14px;padding:12px 18px;border-top:1px solid rgba(26,30,36,.07)}
  .sb-td2 .slot .t{font:700 12px var(--sb-font-mono,monospace);color:#79735F;min-width:40px;padding-top:2px}
  .sb-td2 .slot .body{flex:1;min-width:0}
  .sb-td2 .slot .title{font-weight:700;font-size:13.5px}
  .sb-td2 .slot .sub{font-size:12.5px;color:#79735F;margin-top:2px}
  .sb-td2 .crew{font-size:10.5px;font-weight:800;letter-spacing:.05em;border-radius:6px;padding:2px 8px;background:#F6F3EC;color:#79735F;margin-left:8px}

  .sb-td2 .pulse{display:grid;grid-template-columns:1fr 1fr;gap:1px;background:rgba(26,30,36,.09);border-radius:0 0 14px 14px;overflow:hidden;margin-top:10px}
  .sb-td2 .pulse div{background:#fff;padding:12px 16px}
  .sb-td2 .pulse b{display:block;font:700 22px/1.1 var(--sb-font-mono,monospace)}
  .sb-td2 .pulse span{font-size:11.5px;color:#79735F}
  .sb-td2-moved{background:#F4EBD4;border:1px dashed #9A7209;border-radius:14px;padding:13px 18px;font-size:13px;color:#6a4d0c;margin-top:18px}
  .sb-td2-moved b{display:block;font-size:11px;letter-spacing:.12em;text-transform:uppercase;margin-bottom:3px}

  .sb-td2-tasks{margin-top:18px}
  .sb-td2 .taskbar{display:flex;gap:10px;align-items:center;padding:14px 18px;flex-wrap:wrap;border-bottom:1px solid rgba(26,30,36,.09)}
  .sb-td2 .taskbar input[type=text],.sb-td2 .taskbar select,.sb-td2 .taskbar input[type=date]{font:inherit;font-size:13px;padding:9px 12px;border:1px solid #DAD4C2;border-radius:9px;background:#FDFCF9;max-width:100%}
  .sb-td2 .taskbar .big{flex:1;min-width:220px}
  .sb-td2 .terr{font-size:12px;font-weight:700;color:#B3261E}
  .sb-td2 .inbox{margin:12px 18px 0;background:#EAF2FA;border:1px solid rgba(29,111,168,.25);border-radius:10px;padding:10px 14px;display:flex;align-items:center;gap:12px;flex-wrap:wrap}
  .sb-td2 .inbox .lab{font:700 10.5px/1 var(--sb-font-mono,monospace);letter-spacing:.12em;text-transform:uppercase;color:#1D6FA8}
  .sb-td2 .inbox .msg{flex:1;min-width:220px;font-size:13px}
  .sb-td2 .ttabs{display:inline-flex;background:#ECE6D8;border-radius:10px;padding:3px;margin:14px 18px 0}
  .sb-td2 .ttab{font:700 13px/1 inherit;font-family:inherit;border:none;background:none;color:#7a756a;border-radius:8px;padding:8px 18px;cursor:pointer}
  .sb-td2 .ttab.on{background:#fff;color:#9A7209;box-shadow:0 1px 2px rgba(0,0,0,.08)}
  .sb-td2 .tlist{padding:8px 0 6px}
  .sb-td2-trow{display:flex;align-items:center;gap:10px;padding:10px 18px;border-top:1px solid rgba(26,30,36,.07);flex-wrap:wrap}
  .sb-td2 .tlist .sb-td2-trow:first-child{border-top:none}
  .sb-td2-trow input[type=checkbox]{width:16px;height:16px;accent-color:#9A7209;cursor:pointer;flex:0 0 auto}
  .sb-td2-trow .txt{flex:1;min-width:140px}
  .sb-td2-trow .meta{font-size:11.5px;color:#79735F}
  .sb-td2-trow.done .txt{color:#A39C87;text-decoration:line-through}
  .sb-td2-trow .oc{font:600 11px var(--sb-font-mono,monospace);color:#1D6FA8;background:#EAF2FA;border:none;border-radius:6px;padding:3px 8px;white-space:nowrap;cursor:pointer}
  .sb-td2-trow .who{font-size:10.5px;font-weight:800;letter-spacing:.04em;border-radius:999px;padding:3px 9px;background:#F6F3EC;color:#79735F}
  .sb-td2-trow .due{font:600 11.5px var(--sb-font-mono,monospace);color:#79735F;white-space:nowrap}
  .sb-td2-trow .due.today{color:#8A5A12}.sb-td2-trow .due.over{color:#B3261E}
  .sb-td2-trow .rbtn{font:600 11.5px/1 inherit;font-family:inherit;color:#1D6FA8;background:none;border:1px solid rgba(29,111,168,.35);border-radius:7px;padding:5px 10px;cursor:pointer;white-space:nowrap}
  .sb-td2-trow .xbtn{font:700 15px/1 inherit;font-family:inherit;color:#B3261E;background:none;border:none;cursor:pointer;padding:2px 4px}
  .sb-td2 .replybox{display:flex;gap:8px;flex-basis:100%;padding-left:26px}
  .sb-td2 .replybox input{flex:1;font:inherit;font-size:13px;padding:7px 10px;border:1px solid #DAD4C2;border-radius:8px;background:#FDFCF9}
  .sb-td2 .cols{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:14px;padding:16px 18px}
  .sb-td2 .col{background:#F6F3EC;border-radius:12px;padding:4px 0 8px}
  .sb-td2 .col h3{display:flex;align-items:center;gap:8px;font-size:13px;padding:12px 14px 4px;margin:0}
  .sb-td2 .col h3 .n{font:700 11px var(--sb-font-mono,monospace);background:#fff;border:1px solid rgba(26,30,36,.09);border-radius:999px;padding:1px 8px;color:#79735F}
  .sb-td2 .col .sb-td2-trow{padding:8px 14px;border-top:1px solid rgba(26,30,36,.05)}
`
