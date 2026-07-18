// =============================================================================
// TodayScreen — the FIELD-2 landing screen, two builds in one component
// =============================================================================
// Crew build: greeting -> today's run (featured next stop + remaining stops)
// -> my tasks. Owner build: greeting -> needs-you lane (proof edits, stale
// approvals, overdue tasks) -> today's runs -> this-month money card -> my
// tasks. Everything loads in ONE effect (Promise.all) and refetches when the
// bump counter moves (an undo restored something). Every mutation here is
// optimistic with an 8s undo — no confirm dialogs.
// =============================================================================
import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import {
  listShopTasks, setShopTaskDone, getBatches, getBatch,
  listAllApprovalLinks, fmtUSD, rowBalanceDue,
} from '../lib/stonebooksData'
import { familyNameOf, directionsUrl, BATCH_KIND_CHIP, todayISO } from './fieldShared'
import { getPushState, enablePush, isPushCardDismissed, dismissPushCard } from './fieldPush'

// ── date helpers — only ever called from useMemo bodies / handlers ──────────
function dueChipFor(t, today) {
  if (!t.due_date) return null
  const due = String(t.due_date).slice(0, 10)
  if (due < today) return { label: 'OVERDUE', cls: 'fl-c-bad' }
  if (due === today) return { label: 'DUE TODAY', cls: 'fl-c-warn' }
  const d = new Date(due + 'T00:00:00')
  const wkd = isNaN(d.getTime()) ? due : d.toLocaleDateString(undefined, { weekday: 'short' })
  return { label: `DUE ${wkd.toUpperCase()}`, cls: 'fl-c-neutral' }
}
function weekdayLongOf(iso) {
  const d = new Date(String(iso).slice(0, 10) + 'T00:00:00')
  return isNaN(d.getTime()) ? String(iso) : d.toLocaleDateString(undefined, { weekday: 'long' })
}

// MY-TASKS RULE (uniform across the field app): mine = named me, or my
// department. Snoozed-forward tasks stay off the Today surface entirely.
function isMine(t, who) {
  return (t.assignee_kind === 'person' && t.assignee === who.name) ||
    (t.assignee_kind === 'department' && who.department && t.assignee === who.department)
}
const isSnoozed = (t, today) => !!t.snoozed_until && String(t.snoozed_until).slice(0, 10) > today

// Same open-orders shape OrdersScreen uses (owner month card only). Paged so
// the balance-due total never silently truncates.
async function fetchOpenOrders() {
  const out = []
  for (let start = 0; ; start += 1000) {
    const { data, error } = await supabase
      .from('orders')
      .select('*, customer:customers(*)')
      .neq('status', 'archived')
      .neq('status', 'cancelled')
      .neq('status', 'closed')
      .or('archived.is.null,archived.eq.false')
      .order('updated_at', { ascending: false })
      .range(start, start + 999)
    if (error) { console.warn('[field] today orders:', error.message); break }
    out.push(...(data || []))
    if (!data || data.length < 1000) break
  }
  return out
}

// Collected-this-month must include orders that CLOSED after paying (an order
// leaving open status must not shrink the month) — so it gets its own narrow
// query over every non-archived order that has any payment, mirroring the
// desktop MONEY_PULSE semantics.
async function fetchMonthPaymentOrders() {
  const { data, error } = await supabase
    .from('orders')
    .select('id, payments')
    .or('archived.is.null,archived.eq.false')
    .neq('payments', '[]')
  if (error) { console.warn('[field] month payments:', error.message); return [] }
  return data || []
}

const CHECK_GLYPH = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12.5 l5 5 L20 7" /></svg>
)

export default function TodayScreen({ who, undo, onOpenJob, onOpenTask, onOpenTab, onNewTask, refreshKey = 0 }) {
  const isOwner = !!who?.isOwner
  const [data, setData] = useState(null)     // { batches, tasks, links, orders }
  const [err, setErr] = useState(null)
  const [bump, setBump] = useState(0)        // undo restored something -> refetch
  const [doneIds, setDoneIds] = useState(() => new Set())  // optimistic strikethroughs
  const [showDone, setShowDone] = useState(false)
  const [monthOpen, setMonthOpen] = useState(false)
  const [today, setToday] = useState(() => todayISO())     // re-stamped on every fetch

  const greet = useMemo(() => {
    const d = new Date()
    const h = d.getHours()
    const part = h < 12 ? 'Morning' : h < 17 ? 'Afternoon' : 'Evening'
    return { part, dateLabel: d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }) }
  }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const [shallow, tasks, links, orders, payOrders] = await Promise.all([
          getBatches({ from: todayISO(), to: todayISO() }).catch(() => []),
          listShopTasks().catch(() => []),
          isOwner ? listAllApprovalLinks().catch(() => []) : Promise.resolve([]),
          isOwner ? fetchOpenOrders().catch(() => []) : Promise.resolve([]),
          isOwner ? fetchMonthPaymentOrders().catch(() => []) : Promise.resolve([]),
        ])
        const active = (shallow || []).filter(b => b.status !== 'cancelled')
        // getBatch resolves null on error (it doesn't reject) — fall back to
        // the shallow row so a flaky deep fetch can't erase the run from Today.
        const deep = await Promise.all(active.map(b => getBatch(b.id).then(d => d || b).catch(() => b)))
        if (cancelled) return
        const slotRank = (b) => b.am_pm === 'am' ? 0 : b.am_pm === 'pm' ? 2 : 1
        const batches = deep.filter(Boolean).sort((a, z) => slotRank(a) - slotRank(z))
        setData({ batches, tasks: tasks || [], links: links || [], orders: orders || [], payOrders: payOrders || [] })
        setDoneIds(new Set())
        setToday(todayISO())
      } catch (e) {
        if (!cancelled) setErr(e?.message || 'Could not load your day.')
      }
    })()
    return () => { cancelled = true }
  }, [isOwner, bump, refreshKey])

  // Batches -> view models (stops with jobs only; getBatch pre-sorts stop_order).
  const runs = useMemo(() => {
    if (!data) return []
    return data.batches.map(b => {
      const stops = (b.batch_jobs || []).filter(s => s && s.job && s.job.order)
      const done = stops.filter(s => s.completed_at)
      const open = stops.filter(s => !s.completed_at)
      return { b, stops, done, open, next: open[0] || null }
    })
  }, [data])

  // My open tasks, ordered overdue -> due today -> dated -> undated.
  const myTasks = useMemo(() => {
    if (!data) return []
    const rank = (t) => !t.due_date ? 3
      : String(t.due_date).slice(0, 10) < today ? 0
      : String(t.due_date).slice(0, 10) === today ? 1 : 2
    return data.tasks
      .filter(t => t.status !== 'done' && !isSnoozed(t, today) && isMine(t, who))
      .map(t => ({ t, rank: rank(t), chip: dueChipFor(t, today) }))
      .sort((a, z) => a.rank - z.rank ||
        String(a.t.due_date || '9999').localeCompare(String(z.t.due_date || '9999')))
  }, [data, who, today])
  const myOpenCount = useMemo(
    () => myTasks.filter(x => !doneIds.has(x.t.id)).length, [myTasks, doneIds])

  // Owner needs-you lane: proof edits > stale approvals > overdue tasks.
  const needsYou = useMemo(() => {
    if (!isOwner || !data) return []
    // Day-granular age off the fetch-time date stamp (noon keeps "N days ago"
    // honest against timestamps taken at any hour) — no impure clock in render.
    const nowMs = new Date(today + 'T12:00:00').getTime()
    const daysSince = (iso) => Math.floor((nowMs - new Date(iso).getTime()) / 86400000)
    const out = []
    const seen = new Set()   // one card per order per source (Medina had 4 links)
    for (const l of data.links) {
      if (!l.order_id || l.signed_at || seen.has(`cr:${l.order_id}`)) continue
      const changed = l.displayStatus === 'changes_requested' || l.status === 'changes_requested' ||
        (l.changes_requested_at && daysSince(l.changes_requested_at) <= 14)
      if (!changed) continue
      seen.add(`cr:${l.order_id}`)
      out.push({
        key: `cr-${l.id}`, sev: 0, warn: false, verb: 'REVIEW',
        text: `${familyNameOf(l.order)} asked for proof edits.`,
        go: () => onOpenJob({ orderId: l.order_id, jobId: null }, 'today'),
      })
    }
    for (const l of data.links) {
      if (!l.order_id || l.displayStatus !== 'viewed' || l.signed_at || !l.viewed_at) continue
      if (seen.has(`cr:${l.order_id}`) || seen.has(`vw:${l.order_id}`)) continue
      const n = daysSince(l.viewed_at)
      if (n < 3) continue
      seen.add(`vw:${l.order_id}`)
      const num = l.order?.order_number
      out.push({
        key: `vw-${l.id}`, sev: 1, warn: false, verb: 'OPEN',
        text: `${familyNameOf(l.order)} opened the ${num ? `${num} ` : ''}proof ${n} days ago — no answer.`,
        go: () => onOpenJob({ orderId: l.order_id, jobId: null }, 'today'),
      })
    }
    for (const t of data.tasks) {
      if (t.status === 'done' || !t.due_date || isSnoozed(t, today)) continue
      if (String(t.due_date).slice(0, 10) >= today) continue
      out.push({
        key: `task-${t.id}`, sev: 2, warn: true, verb: 'OPEN TASK',
        text: `"${t.title}" was due ${weekdayLongOf(t.due_date)}. ${t.assignee || 'Nobody'} has it.`,
        go: () => onOpenTask(t.id),
      })
    }
    return out.sort((a, z) => a.sev - z.sev)
  }, [isOwner, data, today, onOpenJob, onOpenTask])

  // Owner month card: collected this month + balance due across open orders.
  const month = useMemo(() => {
    if (!isOwner || !data) return null
    const mk = today.slice(0, 7)
    let collected = 0
    let balance = 0
    const owing = []
    for (const o of (data.payOrders || [])) {
      const pays = Array.isArray(o.payments) ? o.payments : []
      for (const p of pays) {
        if ((p.locked ?? true) && !p.voided &&
          String(p.receivedAt || p.createdAt || '').slice(0, 7) === mk) {
          collected += Number(p.amount) || 0
        }
      }
    }
    for (const o of data.orders) {
      const bal = rowBalanceDue(o)
      balance += bal
      if (bal > 0) owing.push({ o, bal })
    }
    owing.sort((a, z) => z.bal - a.bal)
    return { collected, balance, openCount: data.orders.length, top: owing.slice(0, 3) }
  }, [isOwner, data, today])

  // Optimistic done: write fires immediately, undo reverts + refetches.
  const markDone = (t) => {
    setDoneIds(prev => { const n = new Set(prev); n.add(t.id); return n })
    setShopTaskDone(t.id, true, who.name).then(res => {
      if (!res?.ok) {
        setDoneIds(prev => { const n = new Set(prev); n.delete(t.id); return n })
        undo.showError(res?.error || 'Could not mark it done.')
        return
      }
      undo.show('Marked done', async () => {
        await setShopTaskDone(t.id, false, who.name).catch(() => {})
        setDoneIds(prev => { const n = new Set(prev); n.delete(t.id); return n })
        setBump(b => b + 1)
      })
    })
  }

  const openStop = (stop) => {
    if (!stop) return
    onOpenJob({
      jobId: stop.job_id || stop.job?.id || null,
      orderId: stop.job?.order_id || stop.job?.order?.id || null,
    }, 'today')
  }

  if (err) return <div className="fl-empty">{err}</div>
  if (data === null) return <div className="fl-empty">Loading your day…</div>

  const totalStops = runs.reduce((n, r) => n + r.stops.length, 0)
  const sub = isOwner
    ? `${greet.dateLabel} · ${runs.length} run${runs.length === 1 ? '' : 's'} out · ${needsYou.length === 1 ? '1 needs you' : `${needsYou.length} need you`}`
    : `${greet.dateLabel} · ${totalStops} stop${totalStops === 1 ? '' : 's'} · ${myOpenCount} open task${myOpenCount === 1 ? '' : 's'}`

  return (
    <div>
      <div className="fl-greet">{greet.part}, {who.name}.</div>
      <div className="fl-greet-sub">{sub}</div>

      <PushCard who={who} />

      {isOwner ? (
        <>
          <NeedsYouLane items={needsYou} />
          <OwnerRuns runs={runs} onOpenStop={openStop} />
          {month && (
            <MonthCard month={month} open={monthOpen} onToggle={() => setMonthOpen(v => !v)}
              onOpenOrder={(o) => onOpenJob({ orderId: o.id, jobId: null }, 'today')} />
          )}
        </>
      ) : (
        <CrewRun runs={runs} showDone={showDone} onToggleDone={() => setShowDone(v => !v)}
          onOpenStop={openStop} />
      )}

      <MyTasks items={myTasks} doneIds={doneIds} onMarkDone={markDone}
        onOpenTask={onOpenTask} onOpenTab={onOpenTab} onNewTask={onNewTask}
        openCount={myOpenCount} />
    </div>
  )
}

// ── Push enable card — both builds, shows until on / blocked / dismissed ────
// iOS quirk baked into the flow: Safari only exposes push to an INSTALLED PWA,
// so a phone still in the browser tab gets Add-to-Home-Screen instructions
// instead of a button that can't work.
function PushCard({ who }) {
  const [st, setSt] = useState(null)          // null loading | fieldPush state
  const [busy, setBusy] = useState(false)
  const [cardErr, setCardErr] = useState(null)
  const [hidden, setHidden] = useState(() => isPushCardDismissed())
  useEffect(() => {
    let cancelled = false
    getPushState().then(r => { if (!cancelled) setSt(r.state) })
    return () => { cancelled = true }
  }, [])
  if (hidden || st === null || st === 'on' || st === 'denied' || st === 'unsupported') return null
  const dismiss = () => { dismissPushCard(); setHidden(true) }
  const turnOn = async () => {
    if (busy) return
    setBusy(true); setCardErr(null)
    const r = await enablePush(who)
    setBusy(false)
    if (r.ok) setSt('on')
    else if (r.error === 'denied') setSt('denied')
    else if (r.error !== 'dismissed') setCardErr(r.error)
  }
  return (
    <div className="fl-push-card">
      <div className="fl-push-title">Get task alerts on this phone</div>
      {st === 'needs-install' ? (
        <>
          <div className="fl-push-body">
            First add the app to your Home Screen — tap Share, then
            &#8220;Add to Home Screen&#8221; — and turn alerts on from there.
          </div>
          <div className="fl-push-row">
            <button type="button" className="fl-btn fl-btn-ghost" onClick={dismiss}>Got it</button>
          </div>
        </>
      ) : (
        <>
          <div className="fl-push-body">
            New tasks and replies land here the moment they&#8217;re sent,
            plus a morning heads-up on what&#8217;s due.
          </div>
          {cardErr && <div className="fl-push-err">{cardErr}</div>}
          <div className="fl-push-row">
            <button type="button" className="fl-btn fl-btn-gold" disabled={busy} onClick={turnOn}>
              {busy ? 'Turning on…' : 'Turn on'}
            </button>
            <button type="button" className="fl-btn fl-btn-ghost" onClick={dismiss}>Not now</button>
          </div>
        </>
      )}
    </div>
  )
}

// ── Owner: needs-you lane ───────────────────────────────────────────────────
function NeedsYouLane({ items }) {
  return (
    <>
      <div className="fl-sect">
        <span className="fl-sect-h">Needs you</span>
        {items.length > 0 && (
          <span className="fl-sect-pill" style={{ background: '#B3261E', color: '#fff' }}>{items.length}</span>
        )}
      </div>
      {items.length === 0 && <div className="fl-empty-serif">Nothing needs you.</div>}
      {items.slice(0, 5).map(it => (
        <div key={it.key} className={`fl-needs${it.warn ? ' warn' : ''}`}>
          <div className="fl-needs-text">{it.text}</div>
          <button type="button" className="fl-verb" onClick={it.go}>{it.verb}</button>
        </div>
      ))}
    </>
  )
}

// ── Owner: today's runs ─────────────────────────────────────────────────────
function OwnerRuns({ runs, onOpenStop }) {
  return (
    <>
      <div className="fl-sect">
        <span className="fl-sect-h">Today&#8217;s runs</span>
        {runs.length > 0 && <span className="fl-sect-pill">{runs.length}</span>}
      </div>
      {runs.length === 0 && <div className="fl-empty-serif">No runs out today.</div>}
      {runs.map(({ b, stops, done, next }) => {
        const kind = BATCH_KIND_CHIP[b.kind] || { label: String(b.kind || '').toUpperCase(), cls: 'fl-k-del' }
        const ampm = b.am_pm ? ` · ${b.am_pm.toUpperCase()}` : ''
        const target = next || stops[0] || null
        const curIdx = stops.findIndex(s => !s.completed_at)
        const nextCem = next?.job?.order?.cemetery?.name || b.cemetery?.name
        return (
          <button key={b.id} type="button" className="fl-row" onClick={() => onOpenStop(target)}>
            <div className="fl-rowtop">
              <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                <span className={`fl-kind ${kind.cls}`}>{kind.label}{ampm}</span>
                {(b.title || b.assigned_to) && (
                  <span style={{ fontSize: 12.5, fontWeight: 700, color: '#55503F', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {[b.title, b.assigned_to].filter(Boolean).join(' · ')}
                  </span>
                )}
              </span>
              <span className="fl-spec" style={{ marginTop: 0 }}>{done.length}/{stops.length}</span>
            </div>
            {stops.length > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }}>
                <span className="fl-dots">
                  {stops.map((s, i) => (
                    <i key={s.id} className={s.completed_at ? 'done' : (i === curIdx ? 'cur' : '')} />
                  ))}
                </span>
              </div>
            )}
            <div className="fl-cem">
              {next
                ? `Next: ${familyNameOf(next.job.order)}${nextCem ? ` — ${nextCem}` : ''}`
                : stops.length > 0 ? 'All stops done.' : (b.cemetery?.name || 'No stops linked.')}
            </div>
          </button>
        )
      })}
    </>
  )
}

// ── Owner: this-month money card (tap to expand top balances) ───────────────
function MonthCard({ month, open, onToggle, onOpenOrder }) {
  return (
    <div className="fl-row" style={{ marginTop: 18 }} onClick={onToggle}>
      <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#8A7F6C' }}>
        This month
      </div>
      <div style={{ display: 'flex', gap: 18, marginTop: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="fl-lab">Collected this month</div>
          <div style={{ fontFamily: '"JetBrains Mono", Consolas, monospace', fontSize: 24, fontWeight: 700, color: '#16150F' }}>
            {fmtUSD(month.collected)}
          </div>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="fl-lab">Balance due</div>
          <div style={{ fontFamily: '"JetBrains Mono", Consolas, monospace', fontSize: 24, fontWeight: 700, color: '#16150F' }}>
            {fmtUSD(month.balance)}
          </div>
          <div style={{ fontSize: 11.5, color: '#8A7F6C', marginTop: 2 }}>{month.openCount} open orders</div>
        </div>
      </div>
      {open && (
        <div style={{ marginTop: 6 }}>
          {month.top.length === 0 && (
            <div style={{ fontSize: 12.5, color: '#8A7F6C', padding: '10px 0 4px' }}>No balances due.</div>
          )}
          {month.top.map(({ o, bal }) => (
            <button key={o.id} type="button" className="fl-rowline"
              onClick={(e) => { e.stopPropagation(); onOpenOrder(o) }}>
              <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: 700, color: '#16150F' }}>
                {familyNameOf(o)}{o.order_number ? ` · ${o.order_number}` : ''}
                <span style={{ color: '#6B6456' }}> — {fmtUSD(bal)}</span>
              </span>
              <span className="fl-chev">&#8250;</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Crew: today's run — featured first batch + compact extras ───────────────
function CrewRun({ runs, showDone, onToggleDone, onOpenStop }) {
  return (
    <>
      <div className="fl-sect">
        <span className="fl-sect-h">Today&#8217;s run</span>
        {runs.length > 1 && <span className="fl-sect-pill">{runs.length}</span>}
      </div>
      {runs.length === 0 && <div className="fl-empty-serif">No run scheduled. Yard day.</div>}
      {runs.length > 0 && (
        <FeaturedRun run={runs[0]} showDone={showDone} onToggleDone={onToggleDone} onOpenStop={onOpenStop} />
      )}
      {runs.slice(1).map(({ b, stops, open }) => {
        const kind = BATCH_KIND_CHIP[b.kind] || { label: String(b.kind || '').toUpperCase(), cls: 'fl-k-del' }
        const ampm = b.am_pm ? ` · ${b.am_pm.toUpperCase()}` : ''
        const target = open[0] || stops[0] || null
        const curIdx = stops.findIndex(s => !s.completed_at)
        return (
          <button key={b.id} type="button" className="fl-row fl-row-flex" onClick={() => onOpenStop(target)}>
            <span className={`fl-kind ${kind.cls}`}>{kind.label}{ampm}</span>
            <div className="fl-row-main">
              <div style={{ fontSize: 13.5, fontWeight: 700, color: '#16150F', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {b.title || b.cemetery?.name || `${stops.length} stop${stops.length === 1 ? '' : 's'}`}
              </div>
            </div>
            {stops.length > 0 && (
              <span className="fl-dots">
                {stops.map((s, i) => (
                  <i key={s.id} className={s.completed_at ? 'done' : (i === curIdx ? 'cur' : '')} />
                ))}
              </span>
            )}
            <span className="fl-chev">&#8250;</span>
          </button>
        )
      })}
    </>
  )
}

function FeaturedRun({ run, showDone, onToggleDone, onOpenStop }) {
  const { b, stops, done, open, next } = run
  const kind = BATCH_KIND_CHIP[b.kind] || { label: String(b.kind || '').toUpperCase(), cls: 'fl-k-del' }
  const ampm = b.am_pm ? ` · ${b.am_pm.toUpperCase()}` : ''
  const curIdx = stops.findIndex(s => !s.completed_at)
  const nextOrder = next?.job?.order
  const cem = nextOrder?.cemetery || b.cemetery
  const dir = directionsUrl(b.cemetery || nextOrder?.cemetery)
  const section = nextOrder?.plot_section ? `Sec ${nextOrder.plot_section}` : null

  return (
    <div className="fl-row" style={{ cursor: 'default' }}>
      <div className="fl-rowtop">
        <span className={`fl-kind ${kind.cls}`}>{kind.label}{ampm}</span>
        <span className="fl-spec" style={{ marginTop: 0 }}>{done.length}/{stops.length}</span>
      </div>
      {stops.length > 0 && (
        <div className="fl-runprog">
          {stops.map((s, i) => (
            <i key={s.id} className={s.completed_at ? 'done' : (i === curIdx ? 'cur' : '')} />
          ))}
        </div>
      )}

      {next ? (
        <>
          <div className="fl-lab" style={{ marginTop: stops.length ? 0 : 10 }}>Next stop</div>
          <div className="fl-fam">{familyNameOf(nextOrder)}</div>
          {nextOrder.order_number && <div className="fl-spec">{nextOrder.order_number}</div>}
          {(cem?.name || section) && (
            <div className="fl-cem">{[cem?.name, section].filter(Boolean).join(' · ')}</div>
          )}
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            {dir && (
              <button type="button" className="fl-btn-dark" style={{ flex: 1 }}
                onClick={() => window.open(dir, '_blank', 'noopener')}>
                Directions
              </button>
            )}
            <button type="button" className="fl-btn-ghost" style={{ flex: 1 }}
              onClick={() => onOpenStop(next)}>
              Open stop
            </button>
          </div>
        </>
      ) : (
        <div className="fl-cem" style={{ marginTop: 6 }}>
          {stops.length > 0 ? 'All stops done.' : (b.title || 'No stops linked yet.')}
        </div>
      )}

      {(open.length > 1 || done.length > 0) && (
        <div style={{ marginTop: 10, borderTop: '1px solid #F0ECE2' }}>
          {open.slice(1).map(s => {
            const cemName = s.job.order?.cemetery?.name || b.cemetery?.name
            return (
              <button key={s.id} type="button" className="fl-rowline" onClick={() => onOpenStop(s)}>
                <span style={{ flex: 1, minWidth: 0, fontSize: 14, color: '#16150F' }}>
                  <b>{familyNameOf(s.job.order)}</b>
                  {cemName && <span style={{ color: '#6B6456', fontWeight: 600 }}> — {cemName}</span>}
                </span>
                <span className="fl-chev">&#8250;</span>
              </button>
            )
          })}
          {done.length > 0 && (
            <button type="button" className="fl-rowline" onClick={onToggleDone}>
              <span style={{ flex: 1, fontSize: 12.5, fontWeight: 700, color: '#8A7F6C' }}>
                {done.length} done
              </span>
              <span className="fl-chev" style={{ transform: showDone ? 'rotate(90deg)' : 'none' }}>&#8250;</span>
            </button>
          )}
          {showDone && done.map(s => (
            <button key={s.id} type="button" className="fl-rowline" onClick={() => onOpenStop(s)}>
              <span className="fl-task-done" style={{ flex: 1, fontSize: 14, fontWeight: 700 }}>
                {familyNameOf(s.job.order)}
              </span>
              <span className="fl-chev">&#8250;</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Shared: my tasks (crew + owner) ─────────────────────────────────────────
function MyTasks({ items, doneIds, onMarkDone, onOpenTask, onOpenTab, onNewTask, openCount }) {
  return (
    <>
      <div className="fl-sect">
        <span className="fl-sect-h">My tasks</span>
        {openCount > 0 && <span className="fl-sect-pill">{openCount}</span>}
        <span className="fl-sect-spacer" />
        <button type="button" className="fl-sect-see" onClick={() => onOpenTab('tasks')}>See all</button>
      </div>

      {items.length === 0 ? (
        <div className="fl-empty-serif">Nothing on your list.</div>
      ) : (
        <div className="fl-row" style={{ cursor: 'default', padding: '4px 14px' }}>
          {items.map(({ t, chip }) => {
            const isDone = doneIds.has(t.id)
            const isCheckJob = t.task_type === 'check_job'
            return (
              <div key={t.id} className="fl-rowline" onClick={() => onOpenTask(t.id)}>
                {isCheckJob ? (
                  <span className="fl-chip fl-c-info">CHECK JOB</span>
                ) : (
                  <button type="button" className={`fl-check${isDone ? ' done' : ''}`}
                    aria-label={isDone ? 'Done' : 'Mark done'}
                    onClick={(e) => { e.stopPropagation(); if (!isDone) onMarkDone(t) }}>
                    {isDone && CHECK_GLYPH}
                  </button>
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className={isDone ? 'fl-task-done' : ''}
                    style={{ fontSize: 14.5, fontWeight: 700, color: '#16150F', lineHeight: 1.35 }}>
                    {t.title}
                  </div>
                  <div style={{ fontSize: 11.5, color: '#8A7F6C', marginTop: 2, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    {t.tasked_by && <span>{t.tasked_by}</span>}
                    {t.order?.primary_lastname && <span>{String(t.order.primary_lastname).toUpperCase()}</span>}
                    {chip && !isDone && <span className={`fl-chip ${chip.cls}`}>{chip.label}</span>}
                  </div>
                </div>
                <span className="fl-chev">&#8250;</span>
              </div>
            )
          })}
        </div>
      )}

      <button type="button" className="fl-btn-ghost fl-btn-dashed" onClick={onNewTask}>
        + New task
      </button>
    </>
  )
}
