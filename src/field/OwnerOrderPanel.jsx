// =============================================================================
// OwnerOrderPanel — the owner's desk view of one order (FIELD-3)
// =============================================================================
// NOT a screen: a section stack the shell mounts inside JobDetailScreen for
// the owner build, below the cut-sheet/ladder cards. Contact verbs, balance +
// payment history (read-only — entry stays at the desk), approval links with
// the customer's change notes, the order's tasks (check-off with undo), and a
// quiet activity trail. Contact + balance render straight off the order prop;
// the three fetched sections appear when their data lands (each section skips
// itself when empty, so there is no loading flash). One mount effect keyed on
// order.id, independent .catch per source.
// NOTE the real customer phone columns are phone_primary / phone_alt — there
// is no bare `phone` column (same as CustomersScreen).
// =============================================================================
import { useState, useEffect, useMemo } from 'react'
import {
  getApprovalLinksForOrder, listShopTasksForOrder, getOrderActivity,
  setShopTaskDone, customerName, fmtUSD, fmtDate, rowBalanceDue,
} from '../lib/stonebooksData'
import { todayISO } from './fieldShared'

const MONO = '"JetBrains Mono", Consolas, monospace'
const HAIR = '1px solid #EEE9DD'
const digitsOf = (raw) => String(raw || '').replace(/\D/g, '')

// Approval-link status chip, keyed on displayStatus||status. Anything outside
// the four named states (expired / revoked) falls back to a neutral chip.
const LINK_CHIP = {
  signed:            { label: 'SIGNED',            cls: 'fl-c-good' },
  changes_requested: { label: 'CHANGES REQUESTED', cls: 'fl-c-bad' },
  viewed:            { label: 'VIEWED',            cls: 'fl-c-warn' },
  pending:           { label: 'PENDING',           cls: 'fl-c-neutral' },
}
const linkChip = (l) => {
  const s = l.displayStatus || l.status || 'pending'
  return LINK_CHIP[s] || { label: String(s).replace(/_/g, ' ').toUpperCase(), cls: 'fl-c-neutral' }
}

const METHOD_LABEL = {
  check: 'Check', cash: 'Cash', card: 'Card', credit_card: 'Card', ach: 'ACH',
  wire: 'Wire', zelle: 'Zelle', venmo: 'Venmo', money_order: 'Money order', other: 'Other',
}
const methodLabel = (m) =>
  METHOD_LABEL[m] || (m ? String(m).replace(/_/g, ' ').replace(/^./, ch => ch.toUpperCase()) : '—')

// Due chip — same shape as TodayScreen's; pure on the fetch-time date stamp.
function dueChipFor(t, today) {
  if (!t.due_date) return null
  const due = String(t.due_date).slice(0, 10)
  if (due < today) return { label: 'OVERDUE', cls: 'fl-c-bad' }
  if (due === today) return { label: 'DUE TODAY', cls: 'fl-c-warn' }
  const d = new Date(due + 'T00:00:00')
  const wkd = isNaN(d.getTime()) ? due : d.toLocaleDateString(undefined, { weekday: 'short' })
  return { label: `DUE ${wkd.toUpperCase()}`, cls: 'fl-c-neutral' }
}

const CHECK_GLYPH = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12.5 l5 5 L20 7" /></svg>
)

export default function OwnerOrderPanel({ order, who, undo, onChanged }) {
  const orderId = order?.id
  const [data, setData] = useState(null)     // { links, tasks, activity }
  const [bump, setBump] = useState(0)        // undo restored something -> refetch
  const [doneIds, setDoneIds] = useState(() => new Set())  // optimistic strikethroughs
  const [today, setToday] = useState(() => todayISO())     // re-stamped on every fetch

  useEffect(() => {
    if (!orderId) return undefined
    let cancelled = false
    ;(async () => {
      const [links, tasks, activity] = await Promise.all([
        getApprovalLinksForOrder(orderId).catch(() => []),
        listShopTasksForOrder(orderId).catch(() => []),
        getOrderActivity(orderId).catch(() => []),
      ])
      if (cancelled) return
      setData({ links: links || [], tasks: tasks || [], activity: activity || [] })
      setDoneIds(new Set())
      setToday(todayISO())
    })()
    return () => { cancelled = true }
  }, [orderId, bump])

  // ── Contact (off the order prop) ──────────────────────────────────────────
  const customer = order?.customer || null
  const phone = customer ? (customer.phone_primary || customer.phone_alt || null) : null
  const digits = digitsOf(phone)
  const email = customer ? (customer.email || customer.email_alt || null) : null

  // ── Balance + locked payments (off the order prop) ────────────────────────
  const balance = order ? rowBalanceDue(order) : 0
  const payments = useMemo(() => {
    const all = Array.isArray(order?.payments) ? order.payments : []
    // Same filter as rowTotalPaid: a payment missing `locked` counts as locked;
    // only explicit locked:false drafts are excluded. Voided ones stay listed
    // (struck) so the money trail reads whole.
    return all.filter(p => p && (p.locked ?? true))
  }, [order])

  // ── Tasks: open first (due-dated before undated), done trail after ────────
  const tasks = useMemo(() => {
    if (!data) return []
    const rank = (t) => t.status === 'done' ? 2 : t.due_date ? 0 : 1
    return data.tasks
      .map(t => ({ t, rank: rank(t), chip: dueChipFor(t, today) }))
      .sort((a, z) => a.rank - z.rank ||
        String(a.t.due_date || '9999').localeCompare(String(z.t.due_date || '9999')))
  }, [data, today])
  const openTaskCount = useMemo(
    () => tasks.filter(x => x.t.status !== 'done' && !doneIds.has(x.t.id)).length,
    [tasks, doneIds])

  // Optimistic done — TodayScreen's markDone pattern + onChanged for the host.
  const markDone = (t) => {
    setDoneIds(prev => { const n = new Set(prev); n.add(t.id); return n })
    setShopTaskDone(t.id, true, who.name).then(res => {
      if (!res?.ok) {
        setDoneIds(prev => { const n = new Set(prev); n.delete(t.id); return n })
        undo.showError(res?.error || 'Could not mark it done.')
        return
      }
      onChanged?.()
      undo.show('Marked done', async () => {
        await setShopTaskDone(t.id, false, who.name).catch(() => {})
        setDoneIds(prev => { const n = new Set(prev); n.delete(t.id); return n })
        setBump(b => b + 1)
        onChanged?.()
      })
    })
  }

  const copyLink = (l) => {
    try {
      if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(l.share_url).catch(() => {})
        undo.show('Link copied')   // no undoFn -> plain confirmation toast
      } else {
        undo.showError('Clipboard unavailable.')
      }
    } catch { undo.showError('Clipboard unavailable.') }
  }

  const go = (href) => { window.location.href = href }

  if (!order) return null

  const links = data?.links || []
  const activity = (data?.activity || []).slice(0, 8)
  const showBalance = payments.length > 0 || balance > 0

  return (
    <div>
      {/* ── 1. Contact ─────────────────────────────────────────────────── */}
      {customer && (
        <>
          <div className="fl-sect"><span className="fl-sect-h">Contact</span></div>
          <div className="fl-row" style={{ cursor: 'default' }}>
            <div style={{ fontSize: 15.5, fontWeight: 800, color: '#16150F' }}>
              {customerName(customer)}
            </div>
            {(phone || email) && (
              <div style={{ fontSize: 12.5, color: '#6B6456', marginTop: 2 }}>
                {[phone, email].filter(Boolean).join(' · ')}
              </div>
            )}
            {(digits || email) && (
              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                {digits && (
                  <button type="button" className="fl-verb" style={{ flex: 1 }}
                    onClick={() => go('tel:' + digits)}>CALL</button>
                )}
                {digits && (
                  <button type="button" className="fl-verb" style={{ flex: 1 }}
                    onClick={() => go('sms:' + digits)}>TEXT</button>
                )}
                {email && (
                  <button type="button" className="fl-verb" style={{ flex: 1 }}
                    onClick={() => go('mailto:' + email)}>EMAIL</button>
                )}
              </div>
            )}
          </div>
        </>
      )}

      {/* ── 2. Balance & payments (read-only) ──────────────────────────── */}
      {showBalance && (
        <>
          <div className="fl-sect"><span className="fl-sect-h">Balance &amp; payments</span></div>
          <div className="fl-row" style={{ cursor: 'default' }}>
            <div className="fl-lab">Balance</div>
            <div style={{ fontFamily: MONO, fontSize: 22, fontWeight: 700, color: '#16150F' }}>
              {fmtUSD(balance)}
            </div>
            {payments.length > 0 && (
              <div style={{ marginTop: 6, borderTop: '1px solid #F0ECE2' }}>
                {payments.map((p, i) => {
                  const struck = p.voided ? { textDecoration: 'line-through', color: '#8A7F6C' } : null
                  return (
                    <div key={p.id || i}
                      style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 44, padding: '8px 0', borderBottom: i < payments.length - 1 ? HAIR : 'none' }}>
                      <span style={{ fontFamily: MONO, fontSize: 14.5, fontWeight: 700, color: '#16150F', ...struck }}>
                        {fmtUSD(p.amount)}
                      </span>
                      <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 600, color: '#55503F', ...struck }}>
                        {methodLabel(p.method)}{p.method === 'check' && p.ref ? ` #${p.ref}` : ''}
                      </span>
                      {p.voided && <span className="fl-chip fl-c-bad">VOIDED</span>}
                      <span style={{ fontSize: 12, color: '#8A7F6C', flexShrink: 0 }}>
                        {fmtDate(p.receivedAt || p.createdAt)}
                      </span>
                    </div>
                  )
                })}
              </div>
            )}
            <div style={{ fontSize: 11.5, color: '#8A7F6C', marginTop: 8 }}>
              Entry stays at the desk.
            </div>
          </div>
        </>
      )}

      {/* ── 3. Approvals ───────────────────────────────────────────────── */}
      {links.length > 0 && (
        <>
          <div className="fl-sect"><span className="fl-sect-h">Approvals</span></div>
          <div className="fl-row" style={{ cursor: 'default', padding: '4px 14px' }}>
            {links.map((l, i) => {
              const chip = linkChip(l)
              const signed = (l.displayStatus || l.status) === 'signed'
              return (
                <div key={l.id} style={{ padding: '11px 0', borderBottom: i < links.length - 1 ? HAIR : 'none' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span className={`fl-chip ${chip.cls}`}>{chip.label}</span>
                    <span style={{ flex: 1, minWidth: 0, fontSize: 12, color: '#8A7F6C' }}>
                      {fmtDate(l.created_at)}
                    </span>
                    {!signed && l.share_url && (
                      <button type="button" className="fl-verb" onClick={() => copyLink(l)}>
                        COPY LINK
                      </button>
                    )}
                  </div>
                  {l.change_notes && (
                    <div style={{ fontStyle: 'italic', fontSize: 13.5, color: '#55503F', lineHeight: 1.45, marginTop: 7 }}>
                      &#8220;{l.change_notes}&#8221;
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </>
      )}

      {/* ── 4. Tasks on this order ─────────────────────────────────────── */}
      {tasks.length > 0 && (
        <>
          <div className="fl-sect">
            <span className="fl-sect-h">Tasks on this order</span>
            {openTaskCount > 0 && <span className="fl-sect-pill">{openTaskCount}</span>}
          </div>
          <div className="fl-row" style={{ cursor: 'default', padding: '4px 14px' }}>
            {tasks.map(({ t, chip }) => {
              const isDone = t.status === 'done' || doneIds.has(t.id)
              return (
                <div key={t.id} className="fl-rowline" style={{ cursor: 'default' }}>
                  <button type="button" className={`fl-check${isDone ? ' done' : ''}`}
                    aria-label={isDone ? 'Done' : 'Mark done'} disabled={isDone}
                    onClick={() => { if (!isDone) markDone(t) }}>
                    {isDone && CHECK_GLYPH}
                  </button>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className={isDone ? 'fl-task-done' : ''}
                      style={{ fontSize: 14.5, fontWeight: 700, color: '#16150F', lineHeight: 1.35 }}>
                      {t.title}
                    </div>
                    <div style={{ fontSize: 11.5, color: '#8A7F6C', marginTop: 2, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      {t.assignee && <span>{t.assignee}</span>}
                      {t.task_type === 'check_job' && <span className="fl-chip fl-c-info">CHECK JOB</span>}
                      {chip && !isDone && <span className={`fl-chip ${chip.cls}`}>{chip.label}</span>}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}

      {/* ── 5. Activity ────────────────────────────────────────────────── */}
      {activity.length > 0 && (
        <>
          <div className="fl-sect"><span className="fl-sect-h">Activity</span></div>
          <div style={{ padding: '0 2px' }}>
            {activity.map(r => (
              <div key={r.id} style={{ fontSize: 13, color: '#6B6456', lineHeight: 1.4, padding: '6px 0' }}>
                {String(r.type || 'activity').replace(/_/g, ' ')} — {r.actor || '—'} · {fmtDate(r.created_at)}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
