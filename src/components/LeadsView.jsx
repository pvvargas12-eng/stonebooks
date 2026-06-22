// =============================================================================
// LeadsView — revenue-recovery pipeline for uncontracted orders.
// =============================================================================
// A lead is any order with an estimate status (draft/scoping/quoted) — derived
// live from order status, never a separate record. When an order is contracted
// it leaves this view automatically. Strictly additive to OrdersTab.
//
// PHASE 1 (this build): read-only rows (name, est#, age, owner, estimate value,
// last touch) + summary + filter chips + sort + Log-follow-up (writes
// order_activity, appears in the order timeline) + Open order + Won → contract.
// The four new order columns (next_follow_up / waiting_on / lost_reason /
// lost_at) are NOT written yet — that persistence lands in Phase 2 once the
// 20260623 migration is confirmed. Their display cells render gracefully empty.
// =============================================================================

import { useState, useEffect, useMemo } from 'react'
import { rowGrandTotal, fmtUSD, fmtDate, logOrderActivity, getRecentFollowupsForOrders, getCurrentStaffName, updateOrderLeadFields } from '../lib/stonebooksData'
import {
  LEAD_STATUSES, WAITING_ON_OPTIONS, waitingOnOption,
  FOLLOWUP_TYPES, FOLLOWUP_PRESETS, LOST_REASONS, followUpUrgency, daysBetween,
} from '../lib/leads'

const isoPlusDays = (days) => {
  const d = new Date(); d.setDate(d.getDate() + days)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const pad = (n) => String(n).padStart(2, '0')
const leadName = (o) => {
  const c = o.customer
  if (c && (c.last_name || c.first_name)) return `${c.last_name || ''}${c.first_name ? `, ${c.first_name}` : ''}`.trim()
  return o.primary_lastname || '(no name)'
}

// ── Work-queue sections (top→bottom by urgency) ──────────────────────────────
// Only buckets backed by REAL data exist here. "Coming in today" is intentionally
// absent — there is no appointment/visit-date field on a lead (see investigation
// B). Every non-lost lead lands in exactly one bucket via bucketOf()'s precedence;
// "Waiting on them" is the catch-all so nothing ever disappears.
const SECTIONS = [
  { code: 'new',     label: 'New — needs first contact', tone: 'amber', hint: 'Fresh leads, no contact yet' },
  { code: 'overdue', label: 'Follow-up overdue',         tone: 'red',   hint: 'Past their follow-up date' },
  { code: 'today',   label: 'Follow-up due today',       tone: 'amber', hint: 'Reach out today' },
  { code: 'quote',   label: 'Waiting on quote',          tone: 'blue',  hint: 'We owe them an estimate' },
  { code: 'layout',  label: 'Waiting on layout',         tone: 'blue',  hint: 'They\'re deciding on the design' },
  { code: 'them',    label: 'Waiting on them',           tone: 'neutral', hint: 'Ball is in their court' },
  { code: 'lost',    label: 'Lost',                      tone: 'neutral', collapsible: true, hint: '' },
]

const SORT_OPTIONS = [
  { code: 'newest',   label: 'Newest first' },
  { code: 'oldest',   label: 'Oldest first' },
  { code: 'followup', label: 'Follow-up due (soonest)' },
  { code: 'value',    label: 'Highest $ first' },
]

// Assign a lead row (x = enriched { o, value, urgency, noContact, ... }) to its
// single work-queue bucket. Precedence top→bottom = urgency. Explicit operator
// signals (waiting_on, follow-up date) beat the value proxy. See investigation C:
// "quote" = no priced estimate yet (value 0) OR an "our court" waiting_on flag;
// "layout" = the customer is reviewing the layout we sent.
function bucketOf(x) {
  const o = x.o
  const w = o.waiting_on
  if (o.lost_at) return 'lost'
  if (x.noContact && !o.next_follow_up && !w && !(x.value > 0)) return 'new'
  if (x.urgency === 'overdue') return 'overdue'
  if (x.urgency === 'today') return 'today'
  if (w === 'reviewing_layout') return 'layout'
  if (w === 'owes_layout' || w === 'never_followed_up') return 'quote'
  if (!(x.value > 0)) return 'quote'
  return 'them'   // thinking / comparing / waiting_cemetery, or estimate-out awaiting decision
}

// Within-section comparator for the Sort dropdown.
function makeSorter(sortKey) {
  const cmpCreated = (a, b) => {
    const ca = a.o.created_at || '', cb = b.o.created_at || ''
    return ca < cb ? -1 : ca > cb ? 1 : 0
  }
  if (sortKey === 'oldest')   return cmpCreated
  if (sortKey === 'value')    return (a, b) => (b.value || 0) - (a.value || 0)
  if (sortKey === 'followup') return (a, b) => {
    const na = a.o.next_follow_up || '9999-12-31', nb = b.o.next_follow_up || '9999-12-31'
    return na < nb ? -1 : na > nb ? 1 : cmpCreated(b, a)
  }
  return (a, b) => cmpCreated(b, a)   // newest (default)
}

export default function LeadsView({ orders = [], onOpenDetail, onOpenOrder, onConvert, onChanged }) {
  const [todayISO, setTodayISO] = useState('')
  const [lastTouch, setLastTouch] = useState({})
  const [sortKey, setSortKey] = useState('newest')   // default: newest-created first (a new lead never sinks)
  const [lostOpen, setLostOpen] = useState(false)    // Lost section collapsed by default
  const [openId, setOpenId] = useState(null)
  const [touchNonce, setTouchNonce] = useState(0)   // bump to refresh last-touch after a follow-up

  useEffect(() => {
    const d = new Date()
    setTodayISO(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`)
  }, [])

  // Leads = uncontracted, not archived. (lost_at filtering lands in Phase 2.)
  const leads = useMemo(
    () => (orders || []).filter(o => LEAD_STATUSES.includes(o.status) && !o.archived),
    [orders])

  // Batch the last-touch (most recent activity) for the visible leads.
  const leadIdsKey = leads.map(o => o.id).join(',')
  useEffect(() => {
    let alive = true
    const ids = leadIdsKey ? leadIdsKey.split(',') : []
    if (!ids.length) { setLastTouch({}); return }
    getRecentFollowupsForOrders(ids).then(m => { if (alive) setLastTouch(m) })
    return () => { alive = false }
  }, [leadIdsKey, touchNonce])

  const rows = useMemo(() => leads.map(o => {
    const value = rowGrandTotal(o)
    const age = todayISO ? daysBetween(o.created_at, todayISO) : null
    const touch = lastTouch[o.id] || null
    const touchAge = touch && todayISO ? daysBetween(touch.created_at, todayISO) : null
    const noContact = !touch
    const urgency = followUpUrgency(o.next_follow_up, todayISO)
    const wait = waitingOnOption(o.waiting_on)
    return { o, value, age, touch, touchAge, noContact, urgency, wait }
  }), [leads, lastTouch, todayISO])

  // Group every lead into its work-queue section, then sort WITHIN each section
  // by the chosen Sort option (default newest-first).
  const grouped = useMemo(() => {
    const map = { new: [], overdue: [], today: [], quote: [], layout: [], them: [], lost: [] }
    for (const x of rows) map[bucketOf(x)].push(x)
    const cmp = makeSorter(sortKey)
    for (const k of Object.keys(map)) map[k].sort(cmp)
    return map
  }, [rows, sortKey])

  const totalVisible = rows.length

  // Summary across all (non-lost) leads.
  const summary = useMemo(() => {
    const active = rows.filter(x => !x.o.lost_at)
    return {
      total: active.reduce((s, x) => s + (x.value || 0), 0),
      overdue: active.filter(x => x.urgency === 'overdue').length,
      count: active.length,
    }
  }, [rows])

  // One row — identical markup across every section.
  const renderRow = ({ o, value, age, touch, touchAge, noContact, urgency, wait }) => {
    const isOpen = openId === o.id
    return (
      <div key={o.id} className={`sb-leads-row${o.lost_at ? ' sb-leads-row-lost' : ''}`}>
        <button type="button" className="sb-leads-rowmain" onClick={() => setOpenId(isOpen ? null : o.id)}>
          <div className="sb-leads-c-name">
            <span className="sb-leads-name">{leadName(o)}</span>
            <span className="sb-leads-sub">{o.order_number || 'EST'} · {age != null ? `${age}d old` : ''}{o.sales_rep ? ` · ${o.sales_rep}` : ''}</span>
          </div>
          <div className="sb-leads-c-val">{fmtUSD(value)}</div>
          <div className="sb-leads-c-touch">
            {noContact
              ? <span className="sb-leads-nocontact">No contact since estimate{age != null ? ` — ${age}d` : ''}</span>
              : <span className="sb-leads-touch">{touch.note || 'Contact'}{touchAge != null ? ` · ${touchAge}d ago` : ''}</span>}
          </div>
          <div className="sb-leads-c-wait">
            {wait && <span className={`sb-leads-waitchip${wait.side === 'us' ? ' us' : ''}`}>{wait.label}</span>}
          </div>
          <div className="sb-leads-c-next">
            {o.next_follow_up
              ? <span className={`sb-leads-due sb-leads-due-${urgency}`}>{fmtDate(o.next_follow_up)}</span>
              : <span className="sb-leads-due-none">—</span>}
          </div>
        </button>
        {isOpen && (
          <LeadActions
            order={o}
            onOpenDetail={onOpenDetail}
            onOpenOrder={onOpenOrder}
            onConvert={onConvert}
            onLogged={() => setTouchNonce(n => n + 1)}
            onChanged={onChanged}
          />
        )}
      </div>
    )
  }

  return (
    <div className="sb-leads">
      <style>{CSS}</style>

      <div className="sb-leads-summary">
        <div className="sb-leads-stat"><span className="sb-leads-stat-num">{fmtUSD(summary.total)}</span><span className="sb-leads-stat-lab">open estimates</span></div>
        <div className="sb-leads-stat"><span className={`sb-leads-stat-num${summary.overdue > 0 ? ' sb-leads-red' : ''}`}>{summary.overdue}</span><span className="sb-leads-stat-lab">overdue follow-ups</span></div>
        <div className="sb-leads-stat"><span className="sb-leads-stat-num">{summary.count}</span><span className="sb-leads-stat-lab">{summary.count === 1 ? 'lead' : 'leads'}</span></div>
      </div>

      <div className="sb-leads-sortbar">
        <span className="sb-leads-sortlab">Sort</span>
        <select className="sb-leads-sortsel" value={sortKey} onChange={e => setSortKey(e.target.value)}>
          {SORT_OPTIONS.map(o => <option key={o.code} value={o.code}>{o.label}</option>)}
        </select>
      </div>

      {totalVisible === 0 ? (
        <div className="sb-leads-empty">No leads yet. Use “+ New Lead” to capture one.</div>
      ) : (
        SECTIONS.map(sec => {
          const list = grouped[sec.code]
          if (!list || list.length === 0) return null
          if (sec.collapsible) {
            return (
              <div key={sec.code} className="sb-leads-section">
                <button type="button" className={`sb-leads-section-head sb-leads-tone-${sec.tone} sb-leads-section-toggle`}
                  onClick={() => setLostOpen(v => !v)}>
                  <span className="sb-leads-section-title">{sec.label}</span>
                  <span className="sb-leads-count">{list.length}</span>
                  <span className="sb-leads-caret">{lostOpen ? '▾' : '▸'}</span>
                </button>
                {lostOpen && <div className="sb-leads-list">{list.map(renderRow)}</div>}
              </div>
            )
          }
          return (
            <div key={sec.code} className="sb-leads-section">
              <div className={`sb-leads-section-head sb-leads-tone-${sec.tone}`}>
                <span className="sb-leads-section-title">{sec.label}</span>
                <span className="sb-leads-count">{list.length}</span>
                {sec.hint && <span className="sb-leads-section-hint">{sec.hint}</span>}
              </div>
              <div className="sb-leads-list">{list.map(renderRow)}</div>
            </div>
          )
        })
      )}
    </div>
  )
}

// ── Inline expanded actions ──────────────────────────────────────────────────
function LeadActions({ order, onOpenDetail, onOpenOrder, onConvert, onLogged, onChanged }) {
  const [type, setType] = useState('Call')
  const [note, setNote] = useState('')
  const [nextPreset, setNextPreset] = useState('')   // '' | '3'|'7'|'14' | 'pick'
  const [pickDate, setPickDate] = useState('')
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [lostOpen, setLostOpen] = useState(false)
  const [lostReason, setLostReason] = useState('')
  const [lostNote, setLostNote] = useState('')

  // Log follow-up → order_activity touch + (optional) next_follow_up date.
  const logFollowup = async () => {
    if (busy) return
    setBusy(true)
    const actor = await getCurrentStaffName()
    await logOrderActivity(order.id, { type: 'activity', field: 'followup', note: `${type} · ${note.trim() || 'follow-up'}`, actor })
    let nextIso = null
    if (nextPreset === 'pick') nextIso = pickDate || null
    else if (nextPreset) nextIso = isoPlusDays(Number(nextPreset))
    if (nextIso) await updateOrderLeadFields(order.id, { next_follow_up: nextIso })
    setBusy(false); setNote(''); setSaved(true)
    onLogged?.()
    if (nextIso) onChanged?.()
    setTimeout(() => setSaved(false), 1600)
  }

  // Set waiting-on (who's holding the ball) + log the change.
  const setWaiting = async (code) => {
    if (busy) return
    setBusy(true)
    const actor = await getCurrentStaffName()
    await updateOrderLeadFields(order.id, { waiting_on: code })
    const label = (WAITING_ON_OPTIONS.find(o => o.code === code)?.label) || code
    await logOrderActivity(order.id, { type: 'change', field: 'Waiting on', newValue: label, note: `Waiting on: ${label}`, actor })
    setBusy(false)
    onChanged?.()
  }

  // Mark lost → stamp lost_reason + lost_at, log, drop from default view.
  const markLost = async () => {
    if (busy || !lostReason) return
    setBusy(true)
    const actor = await getCurrentStaffName()
    const reasonLabel = (LOST_REASONS.find(r => r.code === lostReason)?.label) || lostReason
    const detail = lostReason === 'other' && lostNote.trim() ? `${reasonLabel}: ${lostNote.trim()}` : reasonLabel
    await updateOrderLeadFields(order.id, { lost_reason: detail, lost_at: new Date().toISOString() })
    await logOrderActivity(order.id, { type: 'change', field: 'Lead lost', newValue: detail, note: `Lost — ${detail}`, actor })
    setBusy(false); setLostOpen(false)
    onChanged?.()
  }

  return (
    <div className="sb-leads-actions">
      <div className="sb-leads-act-row">
        <span className="sb-leads-act-lab">Log follow-up</span>
        <select className="sb-leads-act-sel" value={type} onChange={e => setType(e.target.value)}>
          {FOLLOWUP_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <input className="sb-leads-act-input" type="text" value={note} placeholder="One-line note…"
          onChange={e => setNote(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') logFollowup() }} />
        <select className="sb-leads-act-sel" value={nextPreset} onChange={e => setNextPreset(e.target.value)} title="Next follow-up">
          <option value="">Next: —</option>
          {FOLLOWUP_PRESETS.map(p => <option key={p.days} value={String(p.days)}>Next: {p.label}</option>)}
          <option value="pick">Next: pick date…</option>
        </select>
        {nextPreset === 'pick' && (
          <input className="sb-leads-act-sel" type="date" value={pickDate} onChange={e => setPickDate(e.target.value)} />
        )}
        <button type="button" className="sb-leads-act-btn" disabled={busy} onClick={logFollowup}>{busy ? '…' : saved ? 'Logged ✓' : 'Log'}</button>
      </div>

      <div className="sb-leads-act-row">
        <span className="sb-leads-act-lab">Waiting on</span>
        {WAITING_ON_OPTIONS.map(w => (
          <button key={w.code} type="button"
            className={`sb-leads-waitbtn${w.side === 'us' ? ' us' : ''}${order.waiting_on === w.code ? ' on' : ''}`}
            disabled={busy} onClick={() => setWaiting(w.code)}>{w.label}</button>
        ))}
      </div>

      <div className="sb-leads-act-row">
        <button type="button" className="sb-leads-act-convert" onClick={() => onConvert?.(order.id)}>Convert to Order →</button>
        <button type="button" className="sb-leads-act-link" onClick={() => onOpenDetail?.(order.id)}>Open order →</button>
        <button type="button" className="sb-leads-act-won" onClick={() => onOpenOrder?.(order.id)}>Won → contract (wizard)</button>
        {!order.lost_at && <button type="button" className="sb-leads-act-lost" onClick={() => setLostOpen(o => !o)}>Lost…</button>}
      </div>

      {lostOpen && (
        <div className="sb-leads-lost">
          <span className="sb-leads-act-lab">Reason</span>
          <select className="sb-leads-act-sel" value={lostReason} onChange={e => setLostReason(e.target.value)}>
            <option value="">Pick a reason…</option>
            {LOST_REASONS.map(r => <option key={r.code} value={r.code}>{r.label}</option>)}
          </select>
          {lostReason === 'other' && (
            <input className="sb-leads-act-input" type="text" value={lostNote} placeholder="Note…" onChange={e => setLostNote(e.target.value)} />
          )}
          <button type="button" className="sb-leads-act-lostconfirm" disabled={busy || !lostReason} onClick={markLost}>Mark lost</button>
          <button type="button" className="sb-leads-act-link" onClick={() => setLostOpen(false)}>Cancel</button>
        </div>
      )}
    </div>
  )
}

const CSS = `
.sb-leads { padding: 4px 0 24px; }
.sb-leads-summary { display: flex; gap: 28px; padding: 14px 18px; background: #fff; border: 1px solid #ece6d8; border-radius: 10px; margin-bottom: 14px; }
.sb-leads-stat { display: flex; flex-direction: column; }
.sb-leads-stat-num { font-size: 22px; font-weight: 700; color: #1a1a1a; }
.sb-leads-stat-lab { font-size: 12px; color: #8a8472; }
.sb-leads-red { color: #b3261e; }
.sb-leads-sortbar { display: flex; align-items: center; gap: 8px; margin-bottom: 14px; }
.sb-leads-sortlab { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: #8a8472; }
.sb-leads-sortsel { font: inherit; font-size: 13px; padding: 6px 10px; border: 1px solid #d8d2c4; border-radius: 8px; background: #fff; color: #1a1a1a; cursor: pointer; }
.sb-leads-sortsel:focus { outline: none; border-color: #9A7209; }
.sb-leads-empty { padding: 40px; text-align: center; color: #8a8472; }

/* Work-queue sections */
.sb-leads-section { margin-bottom: 18px; }
.sb-leads-section-head { display: flex; align-items: center; gap: 10px; padding: 7px 12px; border-radius: 8px; margin-bottom: 8px; border-left: 4px solid #c2bdb2; background: #f4f2ec; }
.sb-leads-section-toggle { width: 100%; border: none; border-left: 4px solid #c2bdb2; font: inherit; text-align: left; cursor: pointer; }
.sb-leads-section-title { font-size: 14px; font-weight: 700; color: #1a1a1a; }
.sb-leads-count { font-size: 12px; font-weight: 700; color: #fff; background: #8a8472; border-radius: 20px; min-width: 20px; height: 20px; padding: 0 7px; display: inline-flex; align-items: center; justify-content: center; }
.sb-leads-section-hint { font-size: 12px; color: #8a8472; }
.sb-leads-caret { margin-left: auto; font-size: 12px; color: #8a8472; }
.sb-leads-tone-red { background: #fbeaea; border-left-color: #b3261e; }
.sb-leads-tone-red .sb-leads-count { background: #b3261e; }
.sb-leads-tone-amber { background: #fdf2e9; border-left-color: #c8821f; }
.sb-leads-tone-amber .sb-leads-count { background: #c8821f; }
.sb-leads-tone-blue { background: #eef2fb; border-left-color: #2c5cc5; }
.sb-leads-tone-blue .sb-leads-count { background: #2c5cc5; }
.sb-leads-tone-neutral { background: #f4f2ec; border-left-color: #c2bdb2; }
.sb-leads-list { display: flex; flex-direction: column; gap: 6px; }
.sb-leads-row { background: #fff; border: 1px solid #ece6d8; border-radius: 9px; overflow: hidden; }
.sb-leads-row-lost { opacity: 0.6; }
.sb-leads-rowmain { display: grid; grid-template-columns: 2fr 0.9fr 1.8fr 1.3fr 1fr; gap: 14px; align-items: center; width: 100%; text-align: left; background: none; border: none; padding: 11px 16px; cursor: pointer; font: inherit; }
.sb-leads-rowmain:hover { background: #faf8f3; }
.sb-leads-c-name { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.sb-leads-name { font-weight: 600; color: #1a1a1a; }
.sb-leads-sub { font-size: 12px; color: #8a8472; }
.sb-leads-c-val { font-weight: 700; color: #1a1a1a; }
.sb-leads-touch { font-size: 13px; color: #555; }
.sb-leads-nocontact { font-size: 12.5px; font-weight: 700; color: #b3261e; background: #fbeaea; border-radius: 6px; padding: 3px 8px; display: inline-block; }
.sb-leads-waitchip { font-size: 11.5px; font-weight: 600; color: #5d5d5a; background: #f1efe9; border: 1px solid #e0dccf; border-radius: 6px; padding: 2px 8px; }
.sb-leads-waitchip.us { color: #b3261e; background: #fbeaea; border-color: #e7b3ad; }
.sb-leads-due { font-size: 13px; font-weight: 600; border-radius: 6px; padding: 2px 8px; }
.sb-leads-due-overdue { color: #b3261e; background: #fbeaea; }
.sb-leads-due-today { color: #7a4a12; background: #fdf2e9; }
.sb-leads-due-future { color: #555; }
.sb-leads-due-none { color: #c2bdb2; }
.sb-leads-actions { border-top: 1px solid #f1efeb; padding: 12px 16px; background: #fcfbf8; display: flex; flex-direction: column; gap: 10px; }
.sb-leads-act-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.sb-leads-act-lab { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: #8a8472; }
.sb-leads-act-sel { border: 1px solid #d8d2c4; border-radius: 6px; padding: 5px 8px; font: inherit; font-size: 13px; }
.sb-leads-act-input { flex: 1 1 220px; min-width: 160px; border: 1px solid #d8d2c4; border-radius: 6px; padding: 5px 9px; font: inherit; font-size: 13px; }
.sb-leads-act-btn { border: 1px solid #9a7209; background: #9a7209; color: #fff; border-radius: 6px; padding: 5px 13px; font-weight: 600; cursor: pointer; }
.sb-leads-act-btn:disabled { opacity: 0.6; }
.sb-leads-act-link { border: none; background: none; color: #9a7209; font-weight: 600; cursor: pointer; padding: 0; }
.sb-leads-act-convert { border: 1px solid #0f1419; background: #0f1419; color: #fff; border-radius: 6px; padding: 5px 14px; font-weight: 700; cursor: pointer; }
.sb-leads-act-convert:hover { background: #1e2d3d; border-color: #1e2d3d; }
.sb-leads-act-won { border: 1px solid #2d7a4f; background: #fff; color: #2d7a4f; border-radius: 6px; padding: 5px 13px; font-weight: 600; cursor: pointer; }
.sb-leads-act-soon { font-size: 11.5px; color: #a8a294; font-style: italic; margin-left: auto; }
.sb-leads-waitbtn { border: 1px solid #d8d2c4; background: #fff; color: #5d5d5a; border-radius: 14px; padding: 3px 10px; font-size: 12px; font-weight: 600; cursor: pointer; }
.sb-leads-waitbtn:hover:not(:disabled) { background: #f4f2ee; }
.sb-leads-waitbtn.us { border-color: #e7b3ad; color: #b3261e; }
.sb-leads-waitbtn.on { background: #0f1419; color: #fff; border-color: #0f1419; }
.sb-leads-waitbtn.us.on { background: #b3261e; border-color: #b3261e; color: #fff; }
.sb-leads-act-lost { border: 1px solid #d8a7a2; background: #fff; color: #b3261e; border-radius: 6px; padding: 5px 13px; font-weight: 600; cursor: pointer; margin-left: auto; }
.sb-leads-lost { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; background: #fbeaea; border: 1px solid #e7b3ad; border-radius: 8px; padding: 8px 12px; }
.sb-leads-act-lostconfirm { border: 1px solid #b3261e; background: #b3261e; color: #fff; border-radius: 6px; padding: 5px 13px; font-weight: 600; cursor: pointer; }
.sb-leads-act-lostconfirm:disabled { opacity: 0.55; cursor: default; }
@media (max-width: 760px) {
  .sb-leads-rowmain { grid-template-columns: 1fr; gap: 6px; }
}
`
