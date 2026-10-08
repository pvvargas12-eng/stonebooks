// =============================================================================
// TeamMeetingTab — the Monday/Friday meeting + A/B week plans (TEAM-MEETING-1)
// =============================================================================
// Paul 2026-10-06 (spec docs/TEAM_MEETING_SPEC.md, mockup approved through 5
// rounds): run the shop like the Army. Alternating A (install) / B
// (production) weeks; the office preps the opposite week. This tab IS the
// meeting: live slides over the existing stores, presentable full-screen and
// scrollable, every number clickable to its orders. The one new truth is the
// COMMITTED plan (week_plans/week_plan_items) — which makes Last Week Review
// honest, feeds the CARRYOVER strip (nothing dies in the minutes), and trends
// the PROMISE-VS-DELIVERY score.
// =============================================================================
import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import {
  getJobs, getInstallList, getFoundationList, getStencilCutList,
  installGates, deriveFdnStatus, deriveDesignStatus, deriveStoneStatus,
  stoneStatusLabel, fdnStatusLabel,
  rowTotalPaid, rowBalanceDue, rowGrandTotal, properName, customerName, fmtUSD,
  listOutgoingPayments, permitNeeded,
  getCalendarBatches, expandBatchOccurrences, updateBatch, createBatch, BATCH_KINDS,
  addShopTask, todayISO,
  getActiveStoneOrders, getInventoryStock, listOpenPRCoverage, getStoneProgressByOrder,
} from './lib/stonebooksData'
import { resolveStoneNeeds, matchNeedsToStock } from './lib/inventoryMatch'
import { rowToOrder } from './SalesMode'
import { listVendorItems } from './lib/vendorsData'
import {
  isoOf, mondayOf, addDays, weekKindFor, weekKindLabel, SHEET_LANES, PLAN_LANES,
  getWeekPlanWithItems, peekWeekPlan, addPlanItem, removePlanItem, scorePlanItem,
  lockWeekPlan, getScoreHistory, getMeetingNotes, saveMeetingNotes,
} from './lib/meetingData'

const DAY_MS = 86400000
const DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI']
const LEAD = new Set(['draft', 'scoping', 'quoted'])
const DEAD = new Set(['closed', 'cancelled'])
const INSTALL_KEYS = ['installed', 'door_installed', 'work_completed']

const isRealWork = (o) => o && !o.archived && !LEAD.has(o.status) && !DEAD.has(o.status) && rowTotalPaid(o) > 0
const msDone = (job, keys) => (job?.milestones || []).some(m => keys.includes(m.milestone_key) && m.status === 'done')
const familyOf = (o) => properName(o?.primary_lastname || customerName(o?.customer) || '—')
// Current time is read once in the load effect (todayMs) — bare Date.now()
// during render is the React 19 purity violation (JobsCommandCenter pattern).
const ageDays = (o, todayMs) => {
  const t = Date.parse(o?.signed_at || o?.created_at || '')
  return todayMs && Number.isFinite(t) ? Math.max(0, Math.floor((todayMs - t) / DAY_MS)) : null
}

// Is the lane's real-world work DONE on this job? (Friday auto-score + the
// carryover strip's self-cleaning both read this.)
function laneDone(job, lane) {
  if (!job) return false
  if (lane === 'set') return msDone(job, INSTALL_KEYS)
  if (lane === 'foundation') return deriveFdnStatus(job) === 'in'
  // The inscription template's key is `inscription_completed` (the floor PHASE
  // is `inscription_complete` — different vocabulary); both read, so the lane
  // can actually score done (2026-10-08 fix — it never did before).
  if (lane === 'inscription') return msDone(job, ['inscription_completed', 'inscription_complete', 'work_completed'])
  if (lane === 'blast') return msDone(job, ['production_completed'])
  return false
}
const LANE_TO_BATCH_KIND = { set: 'setting', foundation: 'foundation_trip', inscription: 'inscription', blast: 'blasting' }
// A/B switch (Paul 2026-10-08): the stored week_plans.kind is the truth.
import { setWeekKind, otherKind } from './lib/meetingData'
// The four install gates as chips — READY TO SET green when nothing reads
// red (Paul 2026-10-07: the picker must show ready vs blockers, it's the
// daily install-planning surface).
function setGateChips(job) {
  const o = job?.order
  if (!o) return []
  const g = installGates(o, job)
  const out = []
  if (g.blasted === false) out.push({ t: job?.job_type === 'bronze' ? 'NOT ARRIVED' : 'NOT BLASTED', tone: 'bad' })
  if (g.fdn === false) out.push({ t: `FDN ${fdnStatusLabel(g.fdnCode || deriveFdnStatus(job)).toUpperCase()}`, tone: 'bad' })
  if (g.permit === false) out.push({ t: 'PERMIT NOT APPROVED', tone: 'bad' })
  const bal = rowBalanceDue(o)
  if (g.paid === false && bal > 0) out.push({ t: `OWES ${fmtUSD(bal)}`, tone: 'bad' })
  if (!out.length) out.push({ t: 'READY TO SET', tone: 'good' })
  return out
}
// New stone vs bronze at a glance (Paul 2026-10-07: "i want to see
// difference between bronze service and newstone").
const TRACK_TAG = {
  new_stone: { t: 'NEW STONE', cls: 'ns' }, bronze: { t: 'BRONZE SERVICES', cls: 'br' },
  inscription: { t: 'INSCRIPTION', cls: 'other' }, mausoleum_door: { t: 'DOORS', cls: 'other' },
  cleaning_repair: { t: 'REPAIR', cls: 'other' },
}
const trackTagOf = (job) => TRACK_TAG[job?.job_type] || null
const SERVICE_LABELS = {
  NEW_STONE: 'New stone', BRONZE: 'Bronze services', INSCRIPTION: 'Inscriptions',
  ACID_WASH: 'Acid wash', REPAIR: 'Repair', MAUSOLEUM: 'Mausoleum',
  MAUSOLEUM_DOOR: 'Doors', CIVIC_MEMORIAL: 'Civic', ADD_PHOTO: 'Photo', OTHER: 'Other',
}

export default function TeamMeetingTab({ onOpenOrderDetail, onOpenJob }) {
  const [mode, setMode] = useState('review')     // 'review' | 'present'
  const [cur, setCur] = useState(0)
  const [err, setErr] = useState(null)
  const [loading, setLoading] = useState(true)
  const [todayMs, setTodayMs] = useState(0)

  // Core stores
  const [jobs, setJobs] = useState([])
  const [outgoing, setOutgoing] = useState([])
  const [vendorItems, setVendorItems] = useState([])
  const [installList, setInstallList] = useState([])
  const [fdnList, setFdnList] = useState([])
  const [cutList, setCutList] = useState([])
  // Plans + meeting shell
  const [planThis, setPlanThis] = useState(null)   // { plan, items }
  const [planNext, setPlanNext] = useState(null)
  const [planLast, setPlanLast] = useState(null)
  const [notes, setNotes] = useState(null)
  const [history, setHistory] = useState([])
  // Boards
  const [batches, setBatches] = useState([])
  // Inventory slide
  const [inv, setInv] = useState(null)

  const thisMonday = useMemo(() => isoOf(mondayOf()), [])
  const nextMonday = useMemo(() => addDays(thisMonday, 7), [thisMonday])
  const lastMonday = useMemo(() => addDays(thisMonday, -7), [thisMonday])
  // The STORED kind wins (A/B switch); the parity anchor is only the fallback
  // before the plan row loads.
  const thisKind = planThis?.plan?.kind || weekKindFor(thisMonday)
  const nextKind = planNext?.plan?.kind || otherKind(thisKind)
  const meetingDate = todayISO()
  const [kindBusy, setKindBusy] = useState(false)
  const flipWeek = async (weekStartISO, toKind) => {
    if (kindBusy) return
    const label = toKind === 'install' ? 'an A week (install · foundations · inscriptions)' : 'a B week (stone production)'
    if (!window.confirm(`Make the week of ${weekStartISO} ${label}? Weeks after it alternate from there.`)) return
    setKindBusy(true)
    const r = await setWeekKind(weekStartISO, toKind)
    setKindBusy(false)
    if (!r.ok) { setErr(r.error); return }
    reloadPlans()
  }

  const reloadPlans = useCallback(async () => {
    const [pt, pn, pl] = await Promise.all([
      getWeekPlanWithItems(thisMonday),
      getWeekPlanWithItems(nextMonday),
      peekWeekPlan(lastMonday),
    ])
    if (pt.ok) setPlanThis(pt); else setErr(pt.error)
    if (pn.ok) setPlanNext(pn)
    if (pl.ok) setPlanLast(pl)
  }, [thisMonday, nextMonday, lastMonday])

  const reloadBatches = useCallback(async () => {
    const rows = await getCalendarBatches({ from: thisMonday, to: addDays(nextMonday, 4) }).catch(() => [])
    setBatches(rows || [])
  }, [thisMonday, nextMonday])

  useEffect(() => {
    let cancelled = false
    setTodayMs(Date.now())
    ;(async () => {
      try {
        const [js, og, vi, il, fl, cl, n, h] = await Promise.all([
          getJobs({ limit: 2000 }),
          listOutgoingPayments().catch(() => []),
          listVendorItems().catch(() => []),
          getInstallList().catch(() => []),
          getFoundationList().catch(() => []),
          getStencilCutList().catch(() => []),
          getMeetingNotes(meetingDate),
          getScoreHistory(12),
        ])
        if (cancelled) return
        setJobs((js || []).filter(j => j.order))
        setOutgoing(og); setVendorItems(vi)
        setInstallList(il); setFdnList(fl); setCutList(cl)
        setNotes(n || { meeting_date: meetingDate, verse: '', verse_ref: '', closing_notes: '', inputs: [] })
        setHistory(h)
        await Promise.all([reloadPlans(), reloadBatches()])
        // Inventory counts — same pools as Needs Ordering, order-linked PR
        // coverage only (the conservative read).
        try {
          const [ordRes, stockRes, covRes] = await Promise.all([getActiveStoneOrders(), getInventoryStock(), listOpenPRCoverage()])
          const orders = (ordRes.rows || []).map(r => { const o = rowToOrder(r, null, null); o.family = r.primary_lastname || ''; return o })
          const progress = await getStoneProgressByOrder(orders.map(o => o.id))
          const prItems = covRes.items || []
          const matched = matchNeedsToStock(resolveStoneNeeds(orders), stockRes.rows || [])
          let stones = 0, bronzes = 0
          for (const m of matched) {
            if (progress.has(m.need.orderId)) continue
            if (m.fulfilled || m.best?.strength === 'exact') continue
            if (prItems.some(it => it.order_id && it.order_id === m.need.orderId)) continue
            if (m.need.itemType === 'bronze') bronzes++; else stones++
          }
          if (!cancelled) setInv({ stones, bronzes, openPRs: covRes.prCount ?? null, awaitingAck: null })
        } catch { if (!cancelled) setInv(null) }
      } catch (e) {
        if (!cancelled) setErr(e?.message || 'Failed to load the meeting data')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [meetingDate, reloadPlans, reloadBatches])  // eslint-disable-line react-hooks/set-state-in-effect

  const jobById = useMemo(() => new Map(jobs.map(j => [j.id, j])), [jobs])
  const uniqueOrders = useMemo(() => {
    const m = new Map()
    for (const j of jobs) if (j.order?.id && !m.has(j.order.id)) m.set(j.order.id, j.order)
    return [...m.values()]
  }, [jobs])

  // ── Last-week windows ───────────────────────────────────────────────────
  const inLastWeek = useCallback((iso) => {
    if (!iso) return false
    const s = String(iso).slice(0, 10)
    return s >= lastMonday && s < thisMonday
  }, [lastMonday, thisMonday])

  // ── Sales last week ─────────────────────────────────────────────────────
  const sales = useMemo(() => {
    const signed = uniqueOrders.filter(o => inLastWeek(o.signed_at))
    let collected = 0
    for (const o of uniqueOrders) {
      for (const p of (Array.isArray(o.payments) ? o.payments : [])) {
        if (inLastWeek(p?.date || p?.paid_date || p?.paidDate)) collected += Number(p.amount) || 0
      }
    }
    const totalSale = signed.reduce((s, o) => s + (rowGrandTotal(o) || 0), 0)
    const byType = new Map()
    for (const o of signed) for (const c of (o.service_types || [])) {
      if (!SERVICE_LABELS[c]) continue
      const e = byType.get(c) || { n: 0, usd: 0 }
      e.n++; e.usd += rowGrandTotal(o) || 0
      byType.set(c, e)
    }
    return { signed, collected, totalSale, byType: [...byType.entries()].sort((a, b) => b[1].n - a[1].n) }
  }, [uniqueOrders, inLastWeek])

  // ── Last week review + score ────────────────────────────────────────────
  const lastItems = planLast?.items || []
  const lastByLane = useMemo(() => {
    const m = new Map()
    for (const it of lastItems) { const a = m.get(it.lane) || []; a.push(it); m.set(it.lane, a) }
    return m
  }, [lastItems])
  const effectiveOutcome = useCallback((it) => {
    if (it.outcome) return it.outcome
    return laneDone(jobById.get(it.job_id), it.lane) ? 'done' : null
  }, [jobById])
  const lastScore = useMemo(() => {
    const scorable = lastItems.filter(it => effectiveOutcome(it) !== 'dropped')
    const done = scorable.filter(it => effectiveOutcome(it) === 'done').length
    return { planned: scorable.length, done, pct: scorable.length ? Math.round((done / scorable.length) * 100) : null }
  }, [lastItems, effectiveOutcome])

  // CARRYOVER — last week's not-done, still-not-done items (self-cleaning:
  // the moment the milestone flips done in the real world, the row drops,
  // scored-missed rows included).
  const carryover = useMemo(() =>
    lastItems.filter(it => {
      const oc = effectiveOutcome(it)
      if (oc === 'done' || oc === 'dropped') return false
      return !laneDone(jobById.get(it.job_id), it.lane)
    }),
  [lastItems, effectiveOutcome, jobById])

  // ── Blockers for a plan item's row ──────────────────────────────────────
  const blockersFor = useCallback((it) => {
    const job = jobById.get(it.job_id)
    const o = job?.order
    const out = []
    if (!job || !o) return out
    if (it.lane === 'set') out.push(...setGateChips(job))
    if (it.lane === 'foundation') {
      const code = deriveFdnStatus(job)
      out.push({ t: fdnStatusLabel(code).toUpperCase(), tone: code === 'in' ? 'good' : code === 'dug' || code === 'poured' ? 'warn' : 'bad' })
    }
    if (it.lane === 'inscription') {
      const ds = deriveDesignStatus(job)
      if (ds === 'need_rub') out.push({ t: 'NEED RUB', tone: 'warn' })
      else if (ds === 'layout_approved' || ds === 'cut') out.push({ t: 'LAYOUT APPROVED', tone: 'good' })
      else out.push({ t: 'LAYOUT NOT APPROVED', tone: 'warn' })
    }
    if (it.lane === 'blast') {
      const ss = deriveStoneStatus(job)
      if (['not_ordered', 'ordered', 'needs_pickup'].includes(ss)) out.push({ t: ss === 'not_ordered' ? 'STONE NOT ORDERED' : 'STONE NOT ARRIVED', tone: 'bad' })
      else out.push({ t: stoneStatusLabel(ss).toUpperCase(), tone: 'good' })
      const ds = deriveDesignStatus(job)
      if (ds !== 'layout_approved' && ds !== 'cut') out.push({ t: 'DESIGN NOT APPROVED', tone: 'warn' })
      const cut = msDone(job, ['stencil_cut'])
      out.push({ t: cut ? 'CUT' : 'NOT CUT', tone: cut ? 'good' : 'warn', cutbox: true })
    }
    return out
  }, [jobById])

  // ── Plan mutations ──────────────────────────────────────────────────────
  const [picker, setPicker] = useState(null)   // { planKey:'this'|'next', lane }
  const planFor = (key) => key === 'this' ? planThis : planNext
  const addItem = async (planKey, lane, payload) => {
    const p = planFor(planKey)
    if (!p?.plan) return
    const r = await addPlanItem({ planId: p.plan.id, lane, ...payload })
    if (!r.ok) { setErr(r.error); return }
    await reloadPlans()
  }
  const dropItem = async (id) => { await removePlanItem(id); await reloadPlans() }
  const score = async (it, outcome) => {
    const note = outcome === 'missed' ? (window.prompt('Why not? (one line — this shows on the review)') || '') : ''
    await scorePlanItem(it.id, outcome, note)
    await reloadPlans()
  }

  // ── Boards ──────────────────────────────────────────────────────────────
  const boardFor = useCallback((weekStartISO) => {
    const from = weekStartISO, to = addDays(weekStartISO, 4)
    const days = [0, 1, 2, 3, 4].map(i => ({ iso: addDays(weekStartISO, i), events: [] }))
    for (const b of batches) {
      const occ = expandBatchOccurrences(b, from, to)
      for (const d of occ) {
        const day = days.find(x => x.iso === d)
        if (day) day.events.push(b)
      }
    }
    return days
  }, [batches])
  // A ref, NOT state — a re-render mid-drag would replace the dragged DOM
  // node and Chrome cancels the drag when the source node disappears.
  const dragRef = useRef(null)   // { batchId } | { trayItem }
  const [boardMsg, setBoardMsg] = useState(null)
  const dropOnDay = async (iso) => {
    const drag = dragRef.current
    dragRef.current = null
    if (!drag) return
    if (drag.batchId) {
      const r = await updateBatch(drag.batchId, { scheduled_date: iso })
      if (!r.ok) setBoardMsg(r.error)
    } else if (drag.trayItem) {
      const it = drag.trayItem
      const job = jobById.get(it.job_id)
      const kind = LANE_TO_BATCH_KIND[it.lane] || 'setting'
      const kindInfo = BATCH_KINDS.find(k => k.code === kind)
      const cemId = job?.cemetery?.id || job?.order?.cemetery?.id || job?.order?.cemetery_id || null
      if (kindInfo?.requiresDestination && !cemId) { setBoardMsg(`${it.title || 'This job'} has no cemetery linked — link one on the order first.`); return }
      const r = await createBatch({
        kind, scheduled_date: iso,
        title: it.title || (job ? familyOf(job.order) : null),
        destination_cemetery_id: kindInfo?.requiresDestination ? cemId : null,
        job_ids: it.job_id ? [it.job_id] : [],
      })
      if (!r.ok) setBoardMsg(r.error)
    }
    await reloadBatches()
  }
  // Tray: this week's plan items whose job isn't on any batch this week.
  const tray = useMemo(() => {
    const onBatches = new Set()
    for (const b of batches) for (const l of (b.batch_jobs || [])) onBatches.add(l.job_id)
    return (planThis?.items || []).filter(it => it.job_id && !onBatches.has(it.job_id) && !laneDone(jobById.get(it.job_id), it.lane))
  }, [batches, planThis, jobById])

  // ── Permits / designs / admin derivations ───────────────────────────────
  const permits = useMemo(() => {
    const filed = (outgoing || []).filter(p => (p.source_permit_key || String(p.category || '').toLowerCase() === 'permits') && inLastWeek(p.paid_date))
    const act = uniqueOrders.filter(isRealWork)
    const need = act.filter(o => permitNeeded(o) && !['submitted', 'approved'].includes(o.permit_status)).length
    const awaiting = act.filter(o => o.permit_status === 'submitted').length
    const approved = act.filter(o => o.permit_status === 'approved').length
    let cemFdn = 0, shevFdn = 0
    for (const j of jobs) {
      if (!isRealWork(j.order)) continue
      const code = deriveFdnStatus(j)
      if (code === 'na' || code === 'in') continue
      if (j.order.foundation_type === 'Cemetery Foundation') cemFdn++; else shevFdn++
    }
    return { filedCount: filed.length, filedUsd: filed.reduce((s, p) => s + (Number(p.amount) || 0), 0), need, awaiting, approved, cemFdn, shevFdn }
  }, [outgoing, uniqueOrders, jobs, inLastWeek])

  const designs = useMemo(() => {
    const real = jobs.filter(j => isRealWork(j.order))
    let apprNS = 0, apprBR = 0, needDesign = [], sent = 0, needRub = 0
    for (const j of real) {
      const ds = deriveDesignStatus(j)
      if (ds === 'layout_approved' || ds === 'cut') { if (j.job_type === 'bronze') apprBR++; else apprNS++ }
      else if (ds === 'layout_sent') sent++
      else if (ds === 'need_rub') needRub++
      else if (ds === 'not_created') needDesign.push(j)
    }
    needDesign.sort((a, b) => (ageDays(b.order, todayMs) ?? 0) - (ageDays(a.order, todayMs) ?? 0))
    return { apprNS, apprBR, needDesign, sent, needRub }
  }, [jobs, todayMs])

  const admin = useMemo(() => {
    const act = uniqueOrders.filter(isRealWork)
    const today = todayISO()
    const overdue = act.filter(o => o.target_completion_date && o.target_completion_date < today && !msDone(jobs.find(j => j.order?.id === o.id), INSTALL_KEYS)).length
    const byType = { NEW_STONE: 0, BRONZE: 0, INSCRIPTION: 0, OTHER: 0 }
    const owedBy = { NEW_STONE: 0, BRONZE: 0, INSCRIPTION: 0, OTHER: 0 }
    for (const o of act) {
      const svcs = (o.service_types || [])
      const hit = { NEW_STONE: false, BRONZE: false, INSCRIPTION: false, OTHER: false }
      for (const c of svcs) {
        const key = c === 'NEW_STONE' ? 'NEW_STONE' : c === 'BRONZE' ? 'BRONZE' : c === 'INSCRIPTION' ? 'INSCRIPTION' : 'OTHER'
        hit[key] = true
      }
      if (!svcs.length) hit.OTHER = true
      for (const k of Object.keys(hit)) if (hit[k]) { byType[k]++; owedBy[k] += Math.max(0, rowBalanceDue(o)) }
    }
    const owed = act.reduce((s, o) => s + Math.max(0, rowBalanceDue(o)), 0)
    // Orders per month (signed), last 6 months, 3 series.
    const months = []
    const now = new Date(todayMs || 0)
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      months.push({ key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, label: d.toLocaleDateString('en-US', { month: 'short' }), ns: 0, br: 0, ins: 0 })
    }
    for (const o of uniqueOrders) {
      if (!o.signed_at) continue
      const k = String(o.signed_at).slice(0, 7)
      const m = months.find(x => x.key === k)
      if (!m) continue
      const svcs = o.service_types || []
      if (svcs.includes('NEW_STONE')) m.ns++
      if (svcs.includes('BRONZE')) m.br++
      if (svcs.includes('INSCRIPTION')) m.ins++
    }
    return { active: act.length, overdue, owed, byType, owedBy, months }
  }, [uniqueOrders, jobs, todayMs])

  // ── Inputs & notes ──────────────────────────────────────────────────────
  const inputRef = useRef(null)
  const saveNotesPatch = async (patch) => {
    const r = await saveMeetingNotes(meetingDate, patch)
    if (r.ok) setNotes(r.notes)
  }
  const addMeetingInput = async () => {
    const t = (inputRef.current?.value || '').trim()
    if (!t) return
    const next = [...(notes?.inputs || []), { text: t, at: new Date().toISOString(), tasked: false }]
    inputRef.current.value = ''
    await saveNotesPatch({ inputs: next })
  }
  const taskInput = async (idx) => {
    const list = [...(notes?.inputs || [])]
    const item = list[idx]
    if (!item || item.tasked) return
    const r = await addShopTask({ title: item.text.slice(0, 300), assignee: 'Admin', assigneeKind: 'department', dueDate: todayISO(), taskType: 'general', details: { auto: 'meeting_input', meeting: meetingDate } })
    if (r?.ok) { list[idx] = { ...item, tasked: true }; await saveNotesPatch({ inputs: list }) }
  }

  // ── Present mode plumbing ───────────────────────────────────────────────
  const slideRefs = useRef([])
  const SLIDE_TITLES = ['Verse', 'Last week', 'Sales', thisKind === 'install' ? 'A sheet' : 'B sheet', thisKind === 'install' ? 'B sheet' : 'A sheet', 'This week board', 'Next week board', 'Inputs', 'Permits', 'Designs', 'Inventory', 'Admin', 'Closing']
  useEffect(() => {
    if (mode !== 'present') return
    const onKey = (e) => {
      if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return
      if (e.key === 'ArrowRight' || e.key === 'PageDown') setCur(c => Math.min(SLIDE_TITLES.length - 1, c + 1))
      if (e.key === 'ArrowLeft' || e.key === 'PageUp') setCur(c => Math.max(0, c - 1))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [mode, SLIDE_TITLES.length])

  const openRow = (it) => {
    const job = jobById.get(it.job_id)
    if (job?.order?.id && onOpenOrderDetail) onOpenOrderDetail(job.order.id)
    else if (it.job_id && onOpenJob) onOpenJob(it.job_id)
  }

  // ── Render helpers ──────────────────────────────────────────────────────
  // Plain functions, NOT components — in-render component definitions are a
  // react-hooks/static-components error (and remount their subtree every
  // parent render).
  const renderPlanRow = (it, { scoreable = false, showRemove = true } = {}) => {
    const job = jobById.get(it.job_id)
    const o = job?.order
    const chips = blockersFor(it)
    const oc = it.outcome || null
    return (
      <div key={it.id} className={`sb-tm-row${chips.some(c => c.tone === 'bad') ? ' bad' : ''}`}>
        <button type="button" className="sb-tm-row-open" onClick={() => openRow(it)} disabled={!o}>
          <span className="sb-tm-fam">{o ? familyOf(o) : (it.title || '—')}</span>
          {o?.order_number && <span className="sb-tm-num">{o.order_number}</span>}
          {trackTagOf(job) && <span className={`sb-tm-tag ${trackTagOf(job).cls}`}>{trackTagOf(job).t}</span>}
          {it.vendor_label && <span className="sb-tm-chip vendor">{it.vendor_label.toUpperCase()}</span>}
          {(job?.cemetery?.name || o?.cemetery?.name) && <span className="sb-tm-cem">{job?.cemetery?.name || o?.cemetery?.name}</span>}
        </button>
        <span className="sb-tm-chips">
          {chips.map((c, i) => c.cutbox
            ? <span key={i} className={`sb-tm-cut ${c.t === 'CUT' ? 'on' : ''}`}><i></i>{c.t}</span>
            : <span key={i} className={`sb-tm-chip ${c.tone}`}>{c.t}</span>)}
          {scoreable && (
            oc
              ? <span className={`sb-tm-chip ${oc === 'done' ? 'good' : oc === 'missed' ? 'bad' : 'warn'}`}>{oc.toUpperCase()}{it.outcome_note ? ` — ${it.outcome_note}` : ''}</span>
              : <>
                  <button type="button" className="sb-tm-minibtn good" onClick={() => score(it, 'done')}>Done</button>
                  <button type="button" className="sb-tm-minibtn bad" onClick={() => score(it, 'missed')}>Missed</button>
                </>
          )}
          {showRemove && !scoreable && <button type="button" className="sb-tm-x" title="Remove from the plan" onClick={() => dropItem(it.id)}>×</button>}
        </span>
      </div>
    )
  }

  const renderLane = (planKey, lane) => {
    const p = planFor(planKey)
    const items = (p?.items || []).filter(i => i.lane === lane)
    const meta = PLAN_LANES.find(l => l.code === lane)
    // The set lane GROUPS BY CEMETERY (Paul 2026-10-07: "from things on that
    // list we will group by cemetery and do the daily planning of installs")
    // — one block = one trip's worth of work.
    let body
    if (lane === 'set' && items.length) {
      const groups = new Map()
      for (const it of items) {
        const job = jobById.get(it.job_id)
        const cem = job?.cemetery?.name || job?.order?.cemetery?.name || (it.vendor_label ? `Dealer — ${it.vendor_label}` : 'No cemetery on file')
        const g = groups.get(cem) || []; g.push(it); groups.set(cem, g)
      }
      body = [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([cem, rows]) => (
        <div key={cem} className="sb-tm-cemgroup">
          <div className="sb-tm-cemgroup-h">{cem} <span className="sb-tm-cem">· {rows.length}</span></div>
          {rows.map(it => renderPlanRow(it))}
        </div>
      ))
    } else {
      body = items.map(it => renderPlanRow(it))
    }
    return (
      <div key={lane} className="sb-tm-lane">
        <div className="sb-tm-lane-h">
          <strong>{meta.label.toUpperCase()}</strong>
          <span className="sb-tm-lane-n">{items.length}</span>
          <button type="button" className="sb-tm-add" onClick={() => setPicker({ planKey, lane })}>+ Add to this sheet</button>
        </div>
        {items.length === 0 && <div className="sb-tm-empty">Nothing on this lane yet — hit + Add.</div>}
        {body}
      </div>
    )
  }

  const renderSheet = (kind, planKey, focus) => (
    <>
      {focus && <span className="sb-tm-weekpill">THIS IS THE FOCUS WEEK</span>}
      {focus && carryover.length > 0 && (
        <div className="sb-tm-carry">
          <div className="sb-tm-carry-h">STILL OPEN SINCE LAST WEEK — {carryover.length}</div>
          {carryover.map(it => {
            const job = jobById.get(it.job_id); const o = job?.order
            return (
              <div key={it.id} className="sb-tm-carry-row">
                <span className="sb-tm-fam">{o ? familyOf(o) : it.title || '—'}</span>
                <span className="sb-tm-cem">{PLAN_LANES.find(l => l.code === it.lane)?.label}{it.outcome_note ? ` · ${it.outcome_note}` : ''}</span>
                <button type="button" className="sb-tm-minibtn" onClick={() => addItem(planKey, it.lane, { jobId: it.job_id, orderId: it.order_id, title: it.title, vendorLabel: it.vendor_label })}>Add to this week</button>
              </div>
            )
          })}
        </div>
      )}
      {SHEET_LANES[kind].map(lane => renderLane(planKey, lane))}
    </>
  )

  const renderBoard = (weekStartISO, showTray) => {
    const days = boardFor(weekStartISO)
    return (
      <>
        <div className="sb-tm-boardwrap">
          <div className="sb-tm-board">
            {days.map((d, i) => (
              <div key={d.iso} className="sb-tm-day"
                onDragOver={e => { if (dragRef.current) e.preventDefault() }}
                onDrop={e => { e.preventDefault(); dropOnDay(d.iso) }}>
                <div className="sb-tm-day-h">{DAYS[i]} <small>{Number(d.iso.slice(5, 7))}/{Number(d.iso.slice(8, 10))}</small></div>
                {d.events.map(b => {
                  const ki = BATCH_KINDS.find(k => k.code === b.kind)
                  return (
                    <div key={b.id + d.iso} className="sb-tm-ev" style={{ borderLeftColor: ki?.color || '#9A7209' }}
                      draggable={!b.recur_rule}
                      onDragStart={() => { dragRef.current = { batchId: b.id } }}
                      onDragEnd={() => { dragRef.current = null }}
                      title={b.recur_rule ? 'Recurring — edit from the Calendar' : 'Drag to another day'}>
                      <b>{b.title || ki?.label || b.kind}</b>
                      <span className="sb-tm-ev-sub">{[ki?.label !== b.title ? ki?.label : null, b.cemetery?.name, b.assigned_to].filter(Boolean).join(' · ')}</span>
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
        </div>
        {showTray && (
          <div className="sb-tm-lane" style={{ marginTop: 12 }}>
            <div className="sb-tm-lane-h"><strong>UNSCHEDULED FROM THE PLAN — DRAG ONTO A DAY</strong><span className="sb-tm-lane-n">{tray.length}</span></div>
            <div className="sb-tm-tray">
              {tray.length === 0 && <span className="sb-tm-empty">Everything on the plan has a day.</span>}
              {tray.map(it => {
                const job = jobById.get(it.job_id); const o = job?.order
                return (
                  <div key={it.id} className="sb-tm-ev tray" draggable
                    onDragStart={() => { dragRef.current = { trayItem: it } }} onDragEnd={() => { dragRef.current = null }}>
                    <b>{o ? familyOf(o) : it.title || '—'}</b>
                    <span className="sb-tm-ev-sub">{PLAN_LANES.find(l => l.code === it.lane)?.label}{o?.cemetery?.name ? ` · ${o.cemetery.name}` : ''}</span>
                  </div>
                )
              })}
            </div>
          </div>
        )}
        {boardMsg && <div className="sb-tm-err">{boardMsg} <button type="button" className="sb-tm-x" onClick={() => setBoardMsg(null)}>×</button></div>}
      </>
    )
  }

  const renderSpark = () => {
    if (!history.length) return <span className="sb-tm-cem">Score history builds as weeks get scored.</span>
    const w = 220, h = 44, max = 100
    const pts = history.map((r, i) => `${(i / Math.max(1, history.length - 1)) * (w - 10) + 5},${h - 6 - ((r.pct || 0) / max) * (h - 12)}`).join(' ')
    return (
      <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} role="img" aria-label="Promise vs delivery trend">
        <polyline fill="none" stroke="#9A7209" strokeWidth="2.5" points={pts} />
        {history.map((r, i) => (
          <circle key={r.weekStart} cx={(i / Math.max(1, history.length - 1)) * (w - 10) + 5} cy={h - 6 - ((r.pct || 0) / max) * (h - 12)} r="3" fill="#9A7209" />
        ))}
      </svg>
    )
  }

  // ── Slides ──────────────────────────────────────────────────────────────
  const focusSheetKind = thisKind
  const otherSheetKind = nextKind
  const slides = [
    // 0 Verse
    <section key="verse" className="sb-tm-slide">
      <div className="sb-tm-eyebrow">{todayMs ? new Date(todayMs).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) : ''}</div>
      <h2>Shevchenko Monuments — Team Meeting</h2>
      <span className="sb-tm-weekpill">{weekKindLabel(thisKind)}</span>
      <div className="sb-tm-abrow">
        <button type="button" className="sb-tm-ab" disabled={kindBusy} onClick={() => flipWeek(thisMonday, otherKind(thisKind))}>
          Switch this week to {thisKind === 'install' ? 'B (production)' : 'A (install)'}
        </button>
        <span className="sb-tm-abnext">Next week: <b>{nextKind === 'install' ? 'A — install' : 'B — production'}</b></span>
        <button type="button" className="sb-tm-ab" disabled={kindBusy} onClick={() => flipWeek(nextMonday, otherKind(nextKind))}>
          Switch next week to {nextKind === 'install' ? 'B (production)' : 'A (install)'}
        </button>
      </div>
      <input className="sb-tm-input sb-tm-verse" placeholder="Type the verse of the day…" defaultValue={notes?.verse || ''}
        onBlur={e => saveNotesPatch({ verse: e.target.value })} />
      <input className="sb-tm-input" style={{ maxWidth: 320 }} placeholder="Reference — e.g. Colossians 3:23" defaultValue={notes?.verse_ref || ''}
        onBlur={e => saveNotesPatch({ verse_ref: e.target.value })} />
    </section>,
    // 1 Last week review
    <section key="lastweek" className="sb-tm-slide">
      <div className="sb-tm-eyebrow">Last week — {planLast?.plan ? weekKindLabel(planLast.plan.kind) : 'no plan was locked'}</div>
      <h2>What we said vs. what we did</h2>
      <div className="sb-tm-tiles">
        <div className="sb-tm-tile good"><span>Score</span><b>{lastScore.pct == null ? '—' : `${lastScore.pct}%`}</b><span className="sub">{lastScore.done} done of {lastScore.planned} planned</span></div>
        <div className="sb-tm-tile"><span>Promise vs delivery</span>{renderSpark()}<span className="sub">last {history.length || 0} scored weeks</span></div>
      </div>
      {!planLast?.plan && <div className="sb-tm-empty">No plan existed for last week — this Friday locks the first one, and this slide starts keeping score.</div>}
      {PLAN_LANES.map(l => {
        const items = lastByLane.get(l.code) || []
        if (!items.length) return null
        return (
          <div key={l.code} className="sb-tm-lane">
            <div className="sb-tm-lane-h"><strong>{l.label.toUpperCase()}</strong>
              <span className="sb-tm-lane-n">{items.filter(i => effectiveOutcome(i) === 'done').length}/{items.length}</span>
              <span className="sb-tm-cem">Done auto-detects from the milestones — score the rest</span></div>
            {items.map(it => renderPlanRow(it, { scoreable: true, showRemove: false }))}
          </div>
        )
      })}
    </section>,
    // 2 Sales
    <section key="sales" className="sb-tm-slide">
      <div className="sb-tm-eyebrow">Last week — sales</div>
      <h2>New business on the books</h2>
      <div className="sb-tm-tiles">
        <div className="sb-tm-tile"><span>New orders</span><b>{sales.signed.length}</b><span className="sub">contracts signed</span></div>
        <div className="sb-tm-tile good"><span>Collected</span><b>{fmtUSD(sales.collected)}</b><span className="sub">money in, all payments</span></div>
        <div className="sb-tm-tile"><span>Total sale</span><b>{fmtUSD(sales.totalSale)}</b><span className="sub">contract value signed</span></div>
        <div className="sb-tm-tile"><span>Avg sale</span><b>{sales.signed.length ? fmtUSD(Math.round(sales.totalSale / sales.signed.length)) : '—'}</b></div>
      </div>
      {sales.byType.length > 0 && (
        <div className="sb-tm-tiles" style={{ marginTop: 10 }}>
          {sales.byType.map(([c, e]) => (
            <div key={c} className="sb-tm-tile"><span>{SERVICE_LABELS[c]}</span><b>{e.n}</b><span className="sub">{fmtUSD(e.usd)}</span></div>
          ))}
        </div>
      )}
    </section>,
    // 3 Focus sheet
    <section key="sheetA" className="sb-tm-slide">
      <div className="sb-tm-eyebrow">This week — the plan{planThis?.plan?.locked_at ? ` · locked ${String(planThis.plan.locked_at).slice(0, 10)}` : ''}</div>
      <h2>{focusSheetKind === 'install' ? 'A sheet: set, dig, carve' : 'B sheet: stencil and blast'}</h2>
      <div className="sb-tm-lockrow">
        {planThis?.plan && !planThis.plan.locked_at && (
          <button type="button" className="sb-tm-btn gold" onClick={async () => { await lockWeekPlan(planThis.plan.id); await reloadPlans() }}>Lock this week's plan</button>
        )}
      </div>
      {renderSheet(focusSheetKind, 'this', true)}
    </section>,
    // 4 Other sheet (next week's plan of the other kind)
    <section key="sheetB" className="sb-tm-slide">
      <div className="sb-tm-eyebrow">The other sheet — next week ({nextMonday})</div>
      <h2>{otherSheetKind === 'install' ? 'A sheet: set, dig, carve' : 'B sheet: stencil and blast'}</h2>
      <p className="sb-tm-lede">Next week's list, visible NOW — the cutter works ahead and admin clears blockers before Monday.</p>
      {renderSheet(otherSheetKind, 'next', false)}
    </section>,
    // 5 This week board
    <section key="boardThis" className="sb-tm-slide">
      <div className="sb-tm-eyebrow">Schedule review</div>
      <h2>This week — the 5-day board</h2>
      <p className="sb-tm-lede"><strong style={{ color: '#9A7209' }}>Drag any card to another day</strong> — it writes straight back to the Scheduler. Recurring events stay put (edit those on the Calendar).</p>
      {renderBoard(thisMonday, true)}
    </section>,
    // 6 Next week board
    <section key="boardNext" className="sb-tm-slide">
      <div className="sb-tm-eyebrow">Look ahead</div>
      <h2>Next week, day by day</h2>
      {renderBoard(nextMonday, false)}
    </section>,
    // 7 Inputs
    <section key="inputs" className="sb-tm-slide">
      <div className="sb-tm-eyebrow">Raised in the room</div>
      <h2>Inputs and needs</h2>
      <div>
        {(notes?.inputs || []).length === 0 && <div className="sb-tm-empty">Nothing raised yet — type below.</div>}
        {(notes?.inputs || []).map((it, i) => (
          <div key={i} className="sb-tm-row">
            <span className="sb-tm-fam" style={{ flex: 1, minWidth: 0 }}>{it.text}</span>
            <span className="sb-tm-chips">
              {it.tasked
                ? <span className="sb-tm-chip good">TASKED</span>
                : <button type="button" className="sb-tm-minibtn gold" onClick={() => taskInput(i)}>TASK IT</button>}
            </span>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
        <input ref={inputRef} className="sb-tm-input" style={{ flex: 1, minWidth: 220 }} placeholder="Type a new input — hey, we need to…"
          onKeyDown={e => { if (e.key === 'Enter') addMeetingInput() }} />
        <button type="button" className="sb-tm-btn gold" onClick={addMeetingInput}>Add input</button>
      </div>
    </section>,
    // 8 Permits + foundations
    <section key="permits" className="sb-tm-slide">
      <div className="sb-tm-eyebrow">Paper that blocks stone</div>
      <h2>Permits and foundations</h2>
      <div className="sb-tm-tiles">
        <div className="sb-tm-tile good"><span>Filed last week</span><b>{permits.filedCount}</b><span className="sub">{fmtUSD(permits.filedUsd)} in fees paid</span></div>
        <div className="sb-tm-tile bad"><span>Open — need a permit</span><b>{permits.need}</b></div>
        <div className="sb-tm-tile warn"><span>Awaiting approval</span><b>{permits.awaiting}</b></div>
        <div className="sb-tm-tile good"><span>Approved</span><b>{permits.approved}</b></div>
      </div>
      <div className="sb-tm-tiles" style={{ marginTop: 10 }}>
        <div className="sb-tm-tile warn"><span>Waiting on cemetery foundations</span><b>{permits.cemFdn}</b><span className="sub">their pour, our follow-up</span></div>
        <div className="sb-tm-tile"><span>Waiting on Shevco foundations</span><b>{permits.shevFdn}</b><span className="sub">our dig list</span></div>
      </div>
    </section>,
    // 9 Designs
    <section key="designs" className="sb-tm-slide">
      <div className="sb-tm-eyebrow">Design pipeline</div>
      <h2>Layouts: approved, owed, waiting</h2>
      <div className="sb-tm-tiles">
        <div className="sb-tm-tile good"><span>Approved — new stone</span><b>{designs.apprNS}</b></div>
        <div className="sb-tm-tile good"><span>Approved — bronze</span><b>{designs.apprBR}</b></div>
        <div className="sb-tm-tile bad"><span>Need design</span><b>{designs.needDesign.length}</b><span className="sub">the names are below</span></div>
        <div className="sb-tm-tile warn"><span>Sent — awaiting family</span><b>{designs.sent}</b></div>
        <div className="sb-tm-tile warn"><span>Need rub</span><b>{designs.needRub}</b></div>
      </div>
      {designs.needDesign.length > 0 && (
        <div className="sb-tm-lane">
          <div className="sb-tm-lane-h"><strong>NEED DESIGN — OLDEST FIRST</strong><span className="sb-tm-cem">stone state + age next to each (arrived + old = design first)</span></div>
          {designs.needDesign.slice(0, 15).map(j => {
            const a = ageDays(j.order, todayMs)
            const ss = deriveStoneStatus(j)
            return (
              <div key={j.id} className="sb-tm-row">
                <button type="button" className="sb-tm-row-open" onClick={() => onOpenOrderDetail?.(j.order.id)}>
                  <span className="sb-tm-fam">{familyOf(j.order)}</span>
                  <span className="sb-tm-num">{j.order.order_number}</span>
                </button>
                <span className="sb-tm-chips">
                  <span className={`sb-tm-chip ${['arrived', 'in_stock', 'needs_stencil_cut', 'needs_blasting', 'blasted'].includes(ss) ? 'good' : ss === 'not_ordered' ? 'bad' : 'warn'}`}>{stoneStatusLabel(ss).toUpperCase()}</span>
                  {a != null && <span className={`sb-tm-chip ${a >= 180 ? 'bad' : a >= 90 ? 'warn' : 'quiet'}`}>{a}d OLD</span>}
                </span>
              </div>
            )
          })}
          {designs.needDesign.length > 15 && <div className="sb-tm-cem" style={{ padding: '4px 2px' }}>+ {designs.needDesign.length - 15} more — the Design hub has the full list.</div>}
        </div>
      )}
    </section>,
    // 10 Inventory
    <section key="inventory" className="sb-tm-slide">
      <div className="sb-tm-eyebrow">What we have to buy</div>
      <h2>Needs ordering</h2>
      {inv ? (
        <div className="sb-tm-tiles">
          <div className="sb-tm-tile bad"><span>Stones</span><b>{inv.stones}</b><span className="sub">no yard match, not on a PR</span></div>
          <div className="sb-tm-tile warn"><span>Bronzes + backers</span><b>{inv.bronzes}</b></div>
        </div>
      ) : <div className="sb-tm-empty">Couldn't read the needs pool — the Inventory tab has the live list.</div>}
      <p className="sb-tm-lede" style={{ marginTop: 10 }}>The Inventory tab's Needs Ordering view is one click from a Build PR.</p>
    </section>,
    // 11 Admin
    <section key="admin" className="sb-tm-slide">
      <div className="sb-tm-eyebrow">Admin — the trend</div>
      <h2>Orders per month, by type</h2>
      <TrendChart months={admin.months} />
      <div className="sb-tm-tiles" style={{ marginTop: 14 }}>
        <div className="sb-tm-tile bad"><span>Overdue orders</span><b>{admin.overdue}</b><span className="sub">past target date</span></div>
        <div className="sb-tm-tile good"><span>Active orders</span><b>{admin.active}</b><span className="sub">signed · money down</span></div>
        <div className="sb-tm-tile"><span>Owed to us</span><b>{fmtUSD(admin.owed)}</b></div>
      </div>
      <div className="sb-tm-lane">
        <div className="sb-tm-lane-h"><strong>ACTIVE — BY TYPE</strong><span className="sb-tm-cem">combined orders count under every type they carry</span></div>
        <div className="sb-tm-tiles" style={{ marginTop: 4 }}>
          <div className="sb-tm-tile"><span>New stone</span><b>{admin.byType.NEW_STONE}</b><span className="sub">owed {fmtUSD(admin.owedBy.NEW_STONE)}</span></div>
          <div className="sb-tm-tile"><span>Bronze services</span><b>{admin.byType.BRONZE}</b><span className="sub">owed {fmtUSD(admin.owedBy.BRONZE)}</span></div>
          <div className="sb-tm-tile"><span>Inscriptions</span><b>{admin.byType.INSCRIPTION}</b><span className="sub">owed {fmtUSD(admin.owedBy.INSCRIPTION)}</span></div>
          <div className="sb-tm-tile"><span>Other</span><b>{admin.byType.OTHER}</b><span className="sub">acid wash · repair · photo · doors</span></div>
        </div>
      </div>
    </section>,
    // 12 Closing
    <section key="closing" className="sb-tm-slide">
      <div className="sb-tm-eyebrow">Before we break</div>
      <h2>Comments and questions</h2>
      <textarea className="sb-tm-input" rows={5} placeholder="Typed live during the meeting — saved with today's date."
        defaultValue={notes?.closing_notes || ''} onBlur={e => saveNotesPatch({ closing_notes: e.target.value })} />
      <p className="sb-tm-lede" style={{ marginTop: 14 }}>Friday we score this week's plan on this same screen. Dismissed.</p>
    </section>,
  ]

  return (
    <div className={`sb-page sb-page-wide sb-tm${mode === 'present' ? ' present' : ''}`}>
      <style>{CSS}</style>
      <div className="sb-tm-bar">
        <div>
          <div className="sb-page-eyebrow">The Monday / Friday ritual</div>
          <h1 className="sb-page-title" style={{ margin: 0 }}>Team Meeting</h1>
        </div>
        <div className="sb-tm-bar-right">
          <button type="button" className={`sb-tm-btn${mode === 'review' ? ' on' : ''}`} onClick={() => setMode('review')}>Review</button>
          <button type="button" className={`sb-tm-btn${mode === 'present' ? ' on' : ''}`} onClick={() => { setMode('present'); setCur(0) }}>Present</button>
          {mode === 'present' && <>
            <button type="button" className="sb-tm-btn" onClick={() => setCur(c => Math.max(0, c - 1))}>&#8249; Prev</button>
            <button type="button" className="sb-tm-btn" onClick={() => setCur(c => Math.min(slides.length - 1, c + 1))}>Next &#8250;</button>
          </>}
        </div>
      </div>

      {err && <div className="sb-tm-err">{err}</div>}
      {loading ? <div className="sb-tm-empty">Pulling the whole shop into one room…</div> : (
        <div className="sb-tm-deck">
          {slides.map((s, i) => (
            <div key={i} ref={el => { slideRefs.current[i] = el }} hidden={mode === 'present' && i !== cur}>{s}</div>
          ))}
          {mode === 'present' && (
            <div className="sb-tm-dots">
              {slides.map((_, i) => (
                <button key={i} type="button" className={`sb-tm-dot${i === cur ? ' on' : ''}`} title={SLIDE_TITLES[i]} onClick={() => setCur(i)} />
              ))}
            </div>
          )}
        </div>
      )}

      {picker && (
        <AddPicker
          lane={picker.lane}
          jobs={jobs} installList={installList} fdnList={fdnList} cutList={cutList}
          vendorItems={vendorItems} todayMs={todayMs}
          excludeJobIds={new Set((planFor(picker.planKey)?.items || []).filter(i => i.lane === picker.lane && i.job_id).map(i => i.job_id))}
          onAdd={async (payload) => { await addItem(picker.planKey, picker.lane, payload); setPicker(null) }}
          onClose={() => setPicker(null)}
        />
      )}
    </div>
  )
}

// Module-level so typing in the search box never remounts the deck behind it.
function AddPicker({ lane, jobs, installList, fdnList, cutList, vendorItems, todayMs, excludeJobIds, onAdd, onClose }) {
  const [q, setQ] = useState('')
  const candidates = useMemo(() => {
    const needle = q.trim().toLowerCase()
    let pool = []
    if (lane === 'set') {
      const ids = new Set(installList.map(r => r.job_id))
      pool = jobs.filter(j => ids.has(j.id) && !msDone(j, INSTALL_KEYS))
    } else if (lane === 'foundation') {
      const ids = new Set(fdnList.map(r => r.job_id))
      pool = jobs.filter(j => ids.has(j.id) && deriveFdnStatus(j) !== 'in')
    } else if (lane === 'inscription') {
      pool = jobs.filter(j => (j.job_type === 'inscription' || (j.order.service_types || []).includes('INSCRIPTION'))
        && !msDone(j, ['inscription_completed', 'inscription_complete', 'work_completed']))
    } else {
      const ids = new Set(cutList.map(r => r.job_id))
      pool = jobs.filter(j => (ids.has(j.id) || j.job_type === 'new_stone') && !msDone(j, ['production_completed']))
    }
    pool = pool.filter(j => isRealWork(j.order) && !excludeJobIds.has(j.id))
    if (needle) {
      pool = pool.filter(j => [j.order.primary_lastname, customerName(j.order.customer), j.order.order_number, j.cemetery?.name || j.order.cemetery?.name]
        .filter(Boolean).join(' ').toLowerCase().includes(needle))
    }
    // The set picker is the daily install-planning surface (Paul 2026-10-07):
    // every row wears READY TO SET green or its red gate chips + the
    // new-stone/bronze tag, ready rows first, then oldest first.
    const rows = pool.map(j => {
      const chips = lane === 'set' ? setGateChips(j) : []
      return { j, chips, ready: chips.length === 1 && chips[0].tone === 'good' }
    })
    rows.sort((a, b) => (b.ready ? 1 : 0) - (a.ready ? 1 : 0)
      || (ageDays(b.j.order, todayMs) ?? 0) - (ageDays(a.j.order, todayMs) ?? 0))
    return rows.slice(0, lane === 'set' ? 60 : 30)
  }, [q, lane, jobs, installList, fdnList, cutList, excludeJobIds, todayMs])
  const dealers = useMemo(() => (vendorItems || [])
    .filter(v => !['completed', 'cancelled'].includes(v.status))
    .slice(0, 15)
    .map(v => ({
      id: v.id,
      title: `${properName(v.request?.family_name || 'Dealer job')}${v.vendor_reference ? ` — ${v.vendor_reference}` : ''}`,
      vendorLabel: v.request?.partner?.company_name || 'Dealer',
    })), [vendorItems])
  return (
    <div className="sb-tm-scrim" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="sb-tm-picker">
        <h3>Add to {PLAN_LANES.find(l => l.code === lane)?.label}</h3>
        <input className="sb-tm-input" autoFocus placeholder="Search family, order #, cemetery…" value={q} onChange={e => setQ(e.target.value)} />
        <div className="sb-tm-picklist">
          {candidates.map(({ j, chips }) => (
            <div key={j.id} className="sb-tm-row">
              <span className="sb-tm-fam">{familyOf(j.order)}</span>
              <span className="sb-tm-num">{j.order.order_number}</span>
              {trackTagOf(j) && <span className={`sb-tm-tag ${trackTagOf(j).cls}`}>{trackTagOf(j).t}</span>}
              <span className="sb-tm-cem">{j.cemetery?.name || j.order.cemetery?.name || ''}</span>
              <span className="sb-tm-chips">
                {chips.map((c, i) => <span key={i} className={`sb-tm-chip ${c.tone}`}>{c.t}</span>)}
                <button type="button" className="sb-tm-minibtn gold" onClick={() => onAdd({ jobId: j.id, orderId: j.order.id, title: `${familyOf(j.order)} — ${j.order.order_number || ''}` })}>+ ADD</button>
              </span>
            </div>
          ))}
          {candidates.length === 0 && <div className="sb-tm-empty">No eligible work matches.</div>}
          {dealers.length > 0 && <div className="sb-tm-lane-h" style={{ marginTop: 10 }}><strong>DEALER WORK</strong></div>}
          {dealers.map(d => (
            <div key={d.id} className="sb-tm-row">
              <span className="sb-tm-fam">{d.title}</span>
              <span className="sb-tm-chip vendor">{d.vendorLabel.toUpperCase()}</span>
              <span className="sb-tm-chips">
                <button type="button" className="sb-tm-minibtn gold" onClick={() => onAdd({ title: d.title, vendorLabel: d.vendorLabel, vendorItemId: d.id })}>+ ADD</button>
              </span>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
          <button type="button" className="sb-tm-btn" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}

function TrendChart({ months }) {
  const max = Math.max(5, ...months.map(m => Math.max(m.ns, m.br, m.ins)))
  const W = 720, H = 260, L = 46, B = 36, T = 14, R = 16
  const x = (i) => L + (i / Math.max(1, months.length - 1)) * (W - L - R)
  const y = (v) => H - B - (v / max) * (H - B - T)
  const line = (key) => months.map((m, i) => `${x(i)},${y(m[key])}`).join(' ')
  const ticks = [0, Math.round(max / 2), max]
  return (
    <div style={{ overflowX: 'auto' }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ maxWidth: W }} role="img" aria-label="Orders per month by type">
        {ticks.map(t => (
          <g key={t}>
            <line x1={L} y1={y(t)} x2={W - R} y2={y(t)} stroke="#E8E2D2" />
            <text x={L - 8} y={y(t) + 4} textAnchor="end" fontSize="11" fill="#6B6456" fontFamily="JetBrains Mono, monospace">{t}</text>
          </g>
        ))}
        {months.map((m, i) => (
          <text key={m.key} x={x(i)} y={H - 12} textAnchor="middle" fontSize="11" fill="#6B6456" fontFamily="JetBrains Mono, monospace">{m.label}</text>
        ))}
        <polyline fill="none" stroke="#9A7209" strokeWidth="3" points={line('ns')} />
        <polyline fill="none" stroke="#1D6FA8" strokeWidth="3" points={line('br')} />
        <polyline fill="none" stroke="#15724A" strokeWidth="3" points={line('ins')} />
      </svg>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 12.5, color: '#6B6456', marginTop: 4 }}>
        <span><i style={{ display: 'inline-block', width: 18, height: 3, background: '#9A7209', verticalAlign: 'middle', marginRight: 6 }}></i>New stone</span>
        <span><i style={{ display: 'inline-block', width: 18, height: 3, background: '#1D6FA8', verticalAlign: 'middle', marginRight: 6 }}></i>Bronze services</span>
        <span><i style={{ display: 'inline-block', width: 18, height: 3, background: '#15724A', verticalAlign: 'middle', marginRight: 6 }}></i>Inscriptions</span>
      </div>
    </div>
  )
}

const CSS = `
  .sb-tm-bar { display: flex; align-items: flex-end; justify-content: space-between; gap: 14px; flex-wrap: wrap; margin-bottom: 18px; }
  .sb-tm-bar-right { display: flex; gap: 8px; flex-wrap: wrap; }
  .sb-tm-btn { font: 700 12.5px var(--sb-font-sans, 'Lato'); color: #6a6a66; background: #fff; border: 1px solid #E2DCC9; border-radius: 8px; padding: 7px 14px; cursor: pointer; }
  .sb-tm-btn.on { color: #fff; background: #16150F; border-color: #16150F; }
  .sb-tm-btn.gold { color: #fff; background: #9A7209; border-color: #9A7209; }
  .sb-tm-deck { display: flex; flex-direction: column; gap: 22px; }
  .sb-tm-slide { background: #fff; border: 0.5px solid #E2DCC9; border-radius: 16px; padding: 28px 32px 32px; min-width: 0; }
  @media (max-width: 640px) { .sb-tm-slide { padding: 18px 16px 22px; } }
  .sb-tm.present .sb-tm-slide { min-height: 64vh; }
  .sb-tm-dots { display: flex; justify-content: center; gap: 7px; padding: 6px 0; flex-wrap: wrap; }
  .sb-tm-dot { width: 9px; height: 9px; border-radius: 50%; background: #E2DCC9; border: none; cursor: pointer; padding: 0; }
  .sb-tm-dot.on { background: #9A7209; }
  .sb-tm-eyebrow { font: 700 11px var(--sb-font-mono, 'JetBrains Mono'); letter-spacing: 0.13em; color: #9A7209; text-transform: uppercase; }
  .sb-tm-slide h2 { font-size: clamp(22px, 3vw, 30px); font-weight: 800; margin: 6px 0 10px; }
  .sb-tm-lede { color: #6B6456; font-size: 13.5px; margin: 0 0 14px; max-width: 64ch; }
  .sb-tm-weekpill { display: inline-block; font: 900 12px var(--sb-font-sans, 'Lato'); letter-spacing: 0.1em; color: #fff; background: #9A7209; border-radius: 999px; padding: 5px 16px; margin: 4px 0 12px; }
  .sb-tm-abrow { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin: -4px 0 14px; }
  .sb-tm-ab { font: 700 11.5px var(--sb-font-sans, 'Lato'); color: #9A7209; background: none; border: 1px dashed #C9A468; border-radius: 999px; padding: 5px 11px; cursor: pointer; white-space: nowrap; }
  .sb-tm-ab:hover { background: #F4EBD4; border-style: solid; }
  .sb-tm-ab:disabled { opacity: .5; cursor: default; }
  .sb-tm-abnext { font-size: 12px; color: #6B6455; }
  .sb-tm-tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 10px; }
  .sb-tm-tile { background: #FBFAF7; border: 1px solid #E2DCC9; border-left: 3px solid #C9A468; border-radius: 12px; padding: 12px 14px; min-width: 0; overflow: hidden; }
  .sb-tm-tile b { display: block; font: 700 25px var(--sb-font-mono, 'JetBrains Mono'); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-variant-numeric: tabular-nums; }
  .sb-tm-tile > span { font: 700 10px var(--sb-font-mono, 'JetBrains Mono'); letter-spacing: 0.07em; color: #8a8a85; text-transform: uppercase; }
  .sb-tm-tile .sub { display: block; font: 400 11.5px var(--sb-font-sans, 'Lato'); color: #8a8a85; text-transform: none; letter-spacing: 0; margin-top: 2px; }
  .sb-tm-tile.good { border-left-color: #15724A; } .sb-tm-tile.good b { color: #15724A; }
  .sb-tm-tile.warn { border-left-color: #B7791F; } .sb-tm-tile.warn b { color: #8A5A12; }
  .sb-tm-tile.bad  { border-left-color: #B3261E; } .sb-tm-tile.bad b  { color: #B3261E; }
  .sb-tm-lane { margin-top: 16px; }
  .sb-tm-lane-h { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; margin-bottom: 7px; }
  .sb-tm-lane-h strong { font: 900 12.5px var(--sb-font-sans, 'Lato'); letter-spacing: 0.08em; }
  .sb-tm-lane-n { font: 700 12px var(--sb-font-mono, 'JetBrains Mono'); color: #fff; background: #9A7209; border-radius: 999px; padding: 1px 9px; }
  .sb-tm-add { font: 700 11px var(--sb-font-sans, 'Lato'); color: #9A7209; background: none; border: 1px solid #C9A468; border-radius: 999px; padding: 3px 12px; cursor: pointer; margin-left: auto; }
  .sb-tm-add:hover { background: #9A7209; color: #fff; }
  .sb-tm-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; background: #FBFAF7; border: 1px solid #EAE4D6; border-radius: 11px; padding: 9px 13px; margin-bottom: 6px; min-width: 0; }
  .sb-tm-row.bad { border-left: 4px solid #B3261E; }
  .sb-tm-row-open { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; background: none; border: none; padding: 0; font: inherit; color: inherit; cursor: pointer; text-align: left; min-width: 0; }
  .sb-tm-row-open:disabled { cursor: default; }
  .sb-tm-row-open:hover:not(:disabled) .sb-tm-fam { text-decoration: underline; }
  .sb-tm-fam { font-weight: 900; font-size: 14.5px; overflow-wrap: anywhere; }
  .sb-tm-num { font: 400 11.5px var(--sb-font-mono, 'JetBrains Mono'); color: #8a8a85; }
  .sb-tm-cem { font-size: 12px; color: #8a8a85; }
  .sb-tm-chips { display: flex; gap: 6px; flex-wrap: wrap; margin-left: auto; align-items: center; }
  .sb-tm-chip { font: 700 10px var(--sb-font-sans, 'Lato'); letter-spacing: 0.05em; border-radius: 5px; padding: 2px 8px; white-space: nowrap; max-width: 320px; overflow: hidden; text-overflow: ellipsis; }
  .sb-tm-chip.good { color: #15724A; background: rgba(29,158,117,0.11); }
  .sb-tm-chip.warn { color: #8A5A12; background: rgba(183,121,31,0.13); }
  .sb-tm-chip.bad  { color: #B3261E; background: rgba(179,38,30,0.1); }
  .sb-tm-chip.quiet { color: #6a6a66; background: #F0EBDD; }
  .sb-tm-chip.vendor { color: #fff; background: #6D28D9; font-weight: 900; letter-spacing: 0.07em; }
  .sb-tm-tag { font: 800 9.5px var(--sb-font-sans, 'Lato'); letter-spacing: 0.07em; border-radius: 5px; padding: 2px 7px; white-space: nowrap; }
  .sb-tm-tag.ns { color: #1D6FA8; background: rgba(29,111,168,0.12); }
  .sb-tm-tag.br { color: #8A5A12; background: rgba(183,121,31,0.15); }
  .sb-tm-tag.other { color: #6a6a66; background: #F0EBDD; }
  .sb-tm-cemgroup { margin-bottom: 10px; }
  .sb-tm-cemgroup-h { font: 800 11px var(--sb-font-mono, 'JetBrains Mono'); letter-spacing: 0.09em; text-transform: uppercase; color: #16150F; border-bottom: 1px solid #E2DCC9; padding: 2px 2px 5px; margin-bottom: 6px; overflow-wrap: anywhere; }
  .sb-tm-cut { display: inline-flex; align-items: center; gap: 5px; font: 700 10.5px var(--sb-font-mono, 'JetBrains Mono'); color: #8A5A12; }
  .sb-tm-cut i { width: 14px; height: 14px; border-radius: 4px; border: 2px solid #B7791F; display: inline-block; }
  .sb-tm-cut.on { color: #15724A; } .sb-tm-cut.on i { border-color: #15724A; background: rgba(29,158,117,0.15); }
  .sb-tm-minibtn { font: 800 10.5px var(--sb-font-sans, 'Lato'); letter-spacing: 0.04em; border-radius: 6px; padding: 3px 10px; cursor: pointer; background: #fff; border: 1px solid #E2DCC9; color: #6a6a66; }
  .sb-tm-minibtn.good { border-color: #15724A; color: #15724A; } .sb-tm-minibtn.good:hover { background: #15724A; color: #fff; }
  .sb-tm-minibtn.bad { border-color: #B3261E; color: #B3261E; } .sb-tm-minibtn.bad:hover { background: #B3261E; color: #fff; }
  .sb-tm-minibtn.gold { border-color: #9A7209; color: #9A7209; } .sb-tm-minibtn.gold:hover { background: #9A7209; color: #fff; }
  .sb-tm-x { font: 700 15px var(--sb-font-sans, 'Lato'); background: none; border: none; color: #8a8a85; cursor: pointer; padding: 0 4px; }
  .sb-tm-x:hover { color: #B3261E; }
  .sb-tm-empty { font-size: 12.5px; color: #8a8a85; background: #FBFAF7; border: 1px dashed #E2DCC9; border-radius: 10px; padding: 10px 13px; }
  .sb-tm-err { font-size: 12.5px; color: #B3261E; background: rgba(179,38,30,0.08); border-radius: 9px; padding: 8px 11px; margin-top: 10px; }
  .sb-tm-input { width: 100%; background: #FBFAF7; border: 1px solid #E2DCC9; border-radius: 10px; color: #16150F; font: 400 14px var(--sb-font-sans, 'Lato'); padding: 10px 13px; box-sizing: border-box; resize: vertical; }
  .sb-tm-verse { font-size: 20px; margin: 16px 0 8px; }
  .sb-tm-lockrow { margin-bottom: 8px; }
  .sb-tm-carry { background: rgba(179,38,30,0.06); border: 1px solid rgba(179,38,30,0.35); border-radius: 12px; padding: 12px 14px; margin-bottom: 14px; }
  .sb-tm-carry-h { font: 900 11.5px var(--sb-font-mono, 'JetBrains Mono'); letter-spacing: 0.09em; color: #B3261E; margin-bottom: 8px; }
  .sb-tm-carry-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; padding: 5px 0; border-top: 1px solid rgba(179,38,30,0.15); }
  .sb-tm-carry-row:first-of-type { border-top: 0; }
  .sb-tm-boardwrap { overflow-x: auto; }
  .sb-tm-board { display: grid; grid-template-columns: repeat(5, minmax(150px, 1fr)); gap: 8px; min-width: 780px; }
  .sb-tm-day { background: #FBFAF7; border: 1px solid #E2DCC9; border-radius: 12px; padding: 8px; min-height: 160px; min-width: 0; }
  .sb-tm-day-h { font: 700 11px var(--sb-font-mono, 'JetBrains Mono'); letter-spacing: 0.1em; color: #9A7209; padding: 2px 4px 8px; display: flex; justify-content: space-between; }
  .sb-tm-day-h small { color: #8a8a85; font-weight: 400; }
  .sb-tm-ev { background: #fff; border: 1px solid #E2DCC9; border-left: 4px solid #9A7209; border-radius: 9px; padding: 7px 9px; margin-bottom: 6px; cursor: grab; font-size: 12px; line-height: 1.35; }
  .sb-tm-ev:active { cursor: grabbing; }
  .sb-tm-ev b { display: block; font-size: 12.5px; overflow-wrap: anywhere; }
  .sb-tm-ev-sub { color: #8a8a85; font-size: 11px; }
  .sb-tm-tray { display: flex; gap: 8px; flex-wrap: wrap; }
  .sb-tm-tray .sb-tm-ev { margin-bottom: 0; min-width: 180px; border-left-color: #B3261E; }
  .sb-tm-scrim { position: fixed; inset: 0; background: rgba(22,21,15,0.45); z-index: 1200; display: flex; align-items: flex-start; justify-content: center; padding: 9vh 16px; }
  .sb-tm-picker { background: #fff; border: 1px solid #E2DCC9; border-radius: 16px; padding: 18px 20px; width: 100%; max-width: 560px; }
  .sb-tm-picker h3 { margin: 0 0 10px; }
  .sb-tm-picklist { max-height: 46vh; overflow-y: auto; margin-top: 10px; }
`
