// =============================================================================
// Stonebooks Trade — the order board (SHARED: dealer portal + staff Vendors tab)
// =============================================================================
// Paul's whiteboard, live: F/N · services · design phase · stone status ·
// started · deadline, with Active / Complete / Archived tabs, search, and sort.
// ONE component serves both sides so the two boards can never disagree:
//   staffView  — inline design-phase / stone-status selects, rush approve /
//                decline, company column (all partners visible).
//   dealer     — read-only status pills + "Stone dropped off" quick action;
//                archive their own orders. RLS scopes their queries server-side.
// Row click expands: item specs, notes, and the SHARED activity log (who did
// what, when — both sides read the same timeline).
// =============================================================================

import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  listTradeOrders, updateTradeOrder, logTradeEvent, listTradeOrderEvents,
  decideTradeRush, acceptTradeOrder, deleteTradeOrder, getTradeTracker,
  TRADE_SERVICES, TRADE_DESIGN_PHASES, TRADE_STONE_STATUSES, tradeServiceLabel,
} from '../lib/vendorsData'
import { getCurrentStaffName } from '../lib/stonebooksData'

const TABS = [
  { code: 'active',   label: 'Active' },
  { code: 'complete', label: 'Complete' },
  { code: 'archived', label: 'Archived' },
]
const SORTS = [
  { code: 'deadline', label: 'Deadline soonest' },
  { code: 'newest',   label: 'Newest first' },
  { code: 'family',   label: 'Family A→Z' },
]

const pad2 = (n) => String(n).padStart(2, '0')
const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}` }
const dOnly = (v) => (v ? String(v).slice(0, 10) : null)
const fmtD = (v) => { const s = dOnly(v); if (!s) return '—'; const [y, m, d] = s.split('-'); return `${Number(m)}/${Number(d)}/${y.slice(2)}` }
const fmtDT = (v) => (v ? fmtD(v) : '—')
const daysUntil = (iso, today) => {
  if (!iso || !today) return null
  const a = Date.parse(today + 'T00:00:00'), b = Date.parse(dOnly(iso) + 'T00:00:00')
  if (Number.isNaN(a) || Number.isNaN(b)) return null
  return Math.round((b - a) / 86400000)
}

const familyOf = (r) => r.family_name || r.items?.find(i => i.deceased_family_name)?.deceased_family_name || r.request_name || '—'
const orderNumOf = (r) => r.dealer_order_number || r.items?.find(i => i.vendor_reference)?.vendor_reference || null
const servicesOf = (r) => {
  if (r.services?.length) {
    return r.services.map(s => s === 'custom' && r.service_custom ? r.service_custom : tradeServiceLabel(s)).join(' + ')
  }
  const kinds = [...new Set((r.items || []).map(i => i.work_type).filter(Boolean))]
  return kinds.map(tradeServiceLabel).join(' + ') || '—'
}
const deadlineOf = (r) => (r.rush_status === 'approved' && r.rush_need_by) ? r.rush_need_by : (r.needed_by || r.rush_need_by || null)

const humanizeEvent = (t) => String(t || '').replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase())

export default function TradeOrderBoard({ staffView = false, partnerId = null, actorName = null, onNewOrder = null }) {
  const [todayISO, setTodayISO] = useState('')
  useEffect(() => { setTodayISO(todayStr()) }, [])

  const [orders, setOrders] = useState(null)
  const [tab, setTab] = useState('active')
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState('deadline')
  const [expandedId, setExpandedId] = useState(null)
  const [eventsById, setEventsById] = useState({})
  const [busyId, setBusyId] = useState(null)
  const [editOrder, setEditOrder] = useState(null)   // order being edited | null
  const [deleteArmId, setDeleteArmId] = useState(null) // two-step delete (archive, staff)
  const [nonce, setNonce] = useState(0)
  const reload = useCallback(() => setNonce(n => n + 1), [])

  useEffect(() => {
    let alive = true
    listTradeOrders({ partnerId, scope: 'all' }).then(rows => { if (alive) setOrders(rows) })
    return () => { alive = false }
  }, [partnerId, nonce])

  const actor = useCallback(async () => {
    if (!staffView) return actorName || 'Dealer'
    return (await getCurrentStaffName().catch(() => null)) || 'Staff'
  }, [staffView, actorName])

  // Partition once for tab counts; the visible list applies search + sort.
  const partitioned = useMemo(() => {
    const rows = orders || []
    const isComplete = (r) => ['completed', 'cancelled'].includes(r.status)
    return {
      active: rows.filter(r => !r.archived_at && !isComplete(r)),
      complete: rows.filter(r => !r.archived_at && isComplete(r)),
      archived: rows.filter(r => r.archived_at),
    }
  }, [orders])

  const visible = useMemo(() => {
    let list = partitioned[tab] || []
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      list = list.filter(r => [familyOf(r), orderNumOf(r), r.partner?.company_name, servicesOf(r)]
        .filter(Boolean).join(' ').toLowerCase().includes(q))
    }
    const cmp = sortKey === 'newest'
      ? (a, b) => (b.created_at || '').localeCompare(a.created_at || '')
      : sortKey === 'family'
        ? (a, b) => familyOf(a).localeCompare(familyOf(b))
        : (a, b) => (dOnly(deadlineOf(a)) || '9999-12-31').localeCompare(dOnly(deadlineOf(b)) || '9999-12-31')
    return [...list].sort(cmp)
  }, [partitioned, tab, search, sortKey])

  // ── Actions (every one logs the shared activity event) ─────────────────────
  const withBusy = async (id, fn) => { setBusyId(id); try { await fn() } finally { setBusyId(null); reload() } }

  const setPhase = (r, code) => withBusy(r.id, async () => {
    const who = await actor()
    const label = TRADE_DESIGN_PHASES.find(p => p.code === code)?.label || code
    await updateTradeOrder(r.id, {
      designPhase: code,
      designApprovedAt: code === 'approved' ? new Date().toISOString() : null,
    })
    await logTradeEvent({ requestId: r.id, partnerId: r.partner_id, type: 'design_phase', detail: `Design phase → ${label}`, actor: who, actorRole: staffView ? 'staff' : 'partner' })
  })

  const setStone = (r, code) => withBusy(r.id, async () => {
    const who = await actor()
    await updateTradeOrder(r.id, {
      stoneStatus: code,
      stoneArrivedAt: code === 'arrived' ? new Date().toISOString() : null,
      ...(code === 'arrived' && !r.stone_drop_location ? { stoneDropLocation: 'Shevchenko shop' } : {}),
    })
    await logTradeEvent({
      requestId: r.id, partnerId: r.partner_id,
      type: code === 'arrived' ? 'stone_dropped_off' : 'stone_status',
      detail: code === 'arrived' ? 'Stone dropped off / arrived at the shop' : 'Stone marked not here',
      actor: who, actorRole: staffView ? 'staff' : 'partner',
    })
  })

  const setArchived = (r, on) => withBusy(r.id, async () => {
    const who = await actor()
    await updateTradeOrder(r.id, { archivedAt: on ? new Date().toISOString() : null, archivedBy: on ? who : null })
    await logTradeEvent({ requestId: r.id, partnerId: r.partner_id, type: on ? 'archived' : 'unarchived', detail: on ? 'Order archived' : 'Order restored', actor: who, actorRole: staffView ? 'staff' : 'partner' })
  })

  const rushDecide = (r, approve) => withBusy(r.id, async () => {
    const who = await actor()
    await decideTradeRush(r.id, approve, { actor: who })
  })

  // Accept checkpoint (staff) — specs verified, guarantee attaches. Slice 4
  // hooks job creation here.
  const accept = (r) => withBusy(r.id, async () => {
    const who = await actor()
    await acceptTradeOrder(r.id, { actor: who })
  })

  const [trackerById, setTrackerById] = useState({})
  const toggleExpand = (r) => {
    const next = expandedId === r.id ? null : r.id
    setExpandedId(next)
    if (next && !eventsById[r.id]) {
      listTradeOrderEvents(r.id).then(ev => setEventsById(m => ({ ...m, [r.id]: ev })))
    }
    if (next) {
      // Tracker refetches on every expand — milestone flips in the shop should
      // show the moment anyone looks.
      getTradeTracker(r.id).then(steps => setTrackerById(m => ({ ...m, [r.id]: steps })))
    }
  }

  const phaseMeta = (code) => TRADE_DESIGN_PHASES.find(p => p.code === code) || TRADE_DESIGN_PHASES[0]
  const stoneMeta = (code) => TRADE_STONE_STATUSES.find(s => s.code === code) || TRADE_STONE_STATUSES[0]

  const deadlineCell = (r) => {
    const dl = deadlineOf(r)
    if (!dl) return <span className="sb-tb-dim">—</span>
    const days = daysUntil(dl, todayISO)
    const cls = days == null ? '' : days <= 7 ? ' sb-tb-dl-red' : days <= 14 ? ' sb-tb-dl-amber' : ''
    return <span className={`sb-tb-date${cls}`}>{fmtD(dl)}{days != null && days < 0 ? ' · late' : ''}</span>
  }

  const rushPill = (r) => {
    if (r.rush_status === 'approved') return <span className="sb-tb-pill sb-tb-rush">RUSH</span>
    if (r.rush_status === 'pending') return <span className="sb-tb-pill sb-tb-rushq">RUSH?</span>
    return null
  }

  if (orders === null) return <div className="sb-tb"><style>{TB_CSS}</style><div className="sb-tb-empty">Loading orders…</div></div>

  return (
    <div className="sb-tb">
      <style>{TB_CSS}</style>

      <div className="sb-tb-toolbar">
        <div className="sb-tb-tabs">
          {TABS.map(t => (
            <button key={t.code} type="button" className={`sb-tb-tab${tab === t.code ? ' on' : ''}`} onClick={() => { setTab(t.code); setExpandedId(null); setDeleteArmId(null) }}>
              {t.label} · {partitioned[t.code].length}
            </button>
          ))}
        </div>
        <input className="sb-tb-search" type="search" placeholder="Search family, order #…" value={search} onChange={e => setSearch(e.target.value)} />
        <select className="sb-tb-sel" value={sortKey} onChange={e => setSortKey(e.target.value)}>
          {SORTS.map(s => <option key={s.code} value={s.code}>{s.label}</option>)}
        </select>
        {onNewOrder && <button type="button" className="sb-tb-new" onClick={onNewOrder}>+ New order</button>}
      </div>

      {visible.length === 0 ? (
        <div className="sb-tb-empty">{search ? 'Nothing matches.' : tab === 'active' ? 'No active orders.' : tab === 'complete' ? 'No completed orders yet.' : 'Nothing archived.'}</div>
      ) : (
        <div className="sb-tb-board">
          <div className={`sb-tb-head${staffView ? ' staff' : ''}`}>
            <span>F/N</span>
            {staffView && <span>Company</span>}
            <span>Order #</span>
            <span>Service</span>
            <span>Design phase</span>
            <span>Stone status</span>
            <span>Started</span>
            <span>Deadline</span>
          </div>
          {visible.map(r => {
            const ph = phaseMeta(r.design_phase)
            const st = stoneMeta(r.stone_status)
            const busy = busyId === r.id
            const open = expandedId === r.id
            return (
              <div key={r.id} className={`sb-tb-rowwrap${open ? ' open' : ''}`}>
                <div className={`sb-tb-row${staffView ? ' staff' : ''}${r.rush_status === 'approved' ? ' sb-tb-row-rush' : ''}`} onClick={() => toggleExpand(r)} role="button" tabIndex={0}
                  onKeyDown={e => { if (e.key === 'Enter') toggleExpand(r) }}>
                  <span className="sb-tb-fam">{familyOf(r)} {rushPill(r)} {r.needs_reaccept && staffView && <span className="sb-tb-pill sb-tb-rushq" title="Edited after accept — needs re-accept">RE-ACCEPT</span>}</span>
                  {staffView && <span className="sb-tb-co">{r.partner?.company_name || '—'}</span>}
                  <span className="sb-tb-num">{orderNumOf(r) || '—'}</span>
                  <span className="sb-tb-svc">{servicesOf(r)}</span>
                  <span onClick={e => e.stopPropagation()}>
                    {staffView ? (
                      <select className={`sb-tb-status sb-tb-t-${ph.tone}`} value={r.design_phase || 'not_created'} disabled={busy} onChange={e => setPhase(r, e.target.value)}>
                        {TRADE_DESIGN_PHASES.map(p => <option key={p.code} value={p.code}>{p.label}</option>)}
                      </select>
                    ) : (
                      <span className={`sb-tb-pill sb-tb-t-${ph.tone}`}>{ph.label}{r.design_phase === 'approved' && r.design_approved_at ? ` ${fmtDT(r.design_approved_at)}` : ''}</span>
                    )}
                  </span>
                  <span onClick={e => e.stopPropagation()}>
                    {staffView ? (
                      <select className={`sb-tb-status sb-tb-t-${st.tone}`} value={r.stone_status || 'not_here'} disabled={busy} onChange={e => setStone(r, e.target.value)}>
                        {TRADE_STONE_STATUSES.map(s => <option key={s.code} value={s.code}>{s.label}</option>)}
                      </select>
                    ) : r.stone_status === 'arrived' ? (
                      <span className="sb-tb-pill sb-tb-t-green">Arrived {fmtDT(r.stone_arrived_at)}</span>
                    ) : (
                      <button type="button" className="sb-tb-dropbtn" disabled={busy} onClick={() => setStone(r, 'arrived')} title="Mark the stone as dropped off at the shop">
                        Stone dropped off?
                      </button>
                    )}
                  </span>
                  <span className="sb-tb-date">{fmtD(r.accepted_at || r.created_at)}</span>
                  {deadlineCell(r)}
                </div>

                {open && (
                  <div className="sb-tb-detail">
                    {(trackerById[r.id] || []).length > 0 && (
                      <div className="sb-tb-track">
                        {trackerById[r.id].map((s, i, arr) => {
                          const doneCount = arr.filter(x => x.done).length
                          const state = s.done ? 'done' : (i === doneCount ? 'now' : 'todo')
                          return (
                            <div key={s.key} className={`sb-tb-tstep ${state}`}>
                              <div className="sb-tb-tdot">{s.done ? '✓' : ''}</div>
                              <div className="sb-tb-tlab">{s.key === 'blast' && !s.done && s.started ? 'Blasting…' : s.label}</div>
                              <div className="sb-tb-tdate">{s.done && s.date ? fmtD(s.date) : state === 'now' ? 'next' : '—'}</div>
                            </div>
                          )
                        })}
                      </div>
                    )}
                    {staffView && r.rush_status === 'pending' && (
                      <div className="sb-tb-rushbar">
                        <b>Rush requested — needed by {fmtD(r.rush_need_by)}.</b> Approving guarantees the date.
                        <button type="button" className="sb-tb-approve" disabled={busy} onClick={() => rushDecide(r, true)}>Approve rush</button>
                        <button type="button" className="sb-tb-decline" disabled={busy} onClick={() => rushDecide(r, false)}>Decline</button>
                      </div>
                    )}
                    <div className="sb-tb-detail-cols">
                      <div>
                        <div className="sb-tb-dl">Items</div>
                        {(r.items || []).length === 0 ? <div className="sb-tb-dim">No items.</div> : (r.items || []).map(it => (
                          <div key={it.id} className="sb-tb-item">
                            <b>{it.deceased_family_name || it.vendor_reference || tradeServiceLabel(it.work_type)}</b>
                            <span className="sb-tb-dim">
                              {[it.stone_size && `Stone ${it.stone_size}`, it.base_size && `Base ${it.base_size}`, it.color, it.cemetery].filter(Boolean).join(' · ') || '—'}
                            </span>
                            {it.item_notes && <span className="sb-tb-note">{it.item_notes}</span>}
                          </div>
                        ))}
                        {r.general_notes && <div className="sb-tb-note" style={{ marginTop: 6 }}>{r.general_notes}</div>}
                        <div className="sb-tb-detail-actions">
                          {staffView && (!r.accepted_at || r.needs_reaccept) && (
                            <button type="button" className="sb-tb-acceptbtn" disabled={busy} onClick={() => accept(r)}
                              title="Specs verified — the order is locked in and the guarantee attaches">
                              {r.needs_reaccept ? '✓ Re-accept order' : '✓ Accept order'}
                            </button>
                          )}
                          {r.accepted_at && !r.needs_reaccept && <span className="sb-tb-pill sb-tb-t-green" title={`Accepted by ${r.accepted_by || 'staff'}`}>Accepted {fmtDT(r.accepted_at)}</span>}
                          <button type="button" className="sb-tb-linkbtn" disabled={busy} onClick={() => setEditOrder(r)}>✎ Edit order</button>
                          {tab !== 'archived'
                            ? <button type="button" className="sb-tb-linkbtn" disabled={busy} onClick={() => setArchived(r, true)}>Archive order</button>
                            : <button type="button" className="sb-tb-linkbtn" disabled={busy} onClick={() => setArchived(r, false)}>Restore order</button>}
                          {staffView && tab === 'archived' && (
                            deleteArmId === r.id ? (
                              <button type="button" className="sb-tb-deletebtn armed" disabled={busy}
                                onClick={() => withBusy(r.id, async () => { await deleteTradeOrder(r.id); setDeleteArmId(null); setExpandedId(null) })}>
                                Really delete forever? Click again
                              </button>
                            ) : (
                              <button type="button" className="sb-tb-deletebtn" disabled={busy} onClick={() => setDeleteArmId(r.id)}
                                title="Permanently removes the order, its items, and its activity log">
                                Delete permanently
                              </button>
                            )
                          )}
                        </div>
                      </div>
                      <div>
                        <div className="sb-tb-dl">Activity — who did what, when</div>
                        {!eventsById[r.id] ? <div className="sb-tb-dim">Loading…</div> : eventsById[r.id].length === 0 ? <div className="sb-tb-dim">No activity yet.</div> : (
                          <ul className="sb-tb-log">
                            {eventsById[r.id].map(ev => (
                              <li key={ev.id}>
                                <span className={`sb-tb-logdot ${ev.actor_role === 'partner' ? 'p' : 's'}`} />
                                <span className="sb-tb-logtext">{ev.detail || humanizeEvent(ev.event_type)}</span>
                                <span className="sb-tb-logmeta">{fmtD(ev.created_at)} · {ev.actor || (ev.actor_role === 'partner' ? 'Dealer' : 'Shevchenko')}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {editOrder && (
        <TradeOrderEditModal order={editOrder} staffView={staffView} getActor={actor}
          onClose={() => setEditOrder(null)}
          onSaved={() => { setEditOrder(null); reload() }} />
      )}
    </div>
  )
}

// ── Edit modal — order-grain fields, both sides ──────────────────────────────
// Dealers edit freely BEFORE Accept; a dealer edit AFTER Accept flips
// needs_reaccept so staff re-verify the specs before the shop cuts anything.
// Staff edits never trigger re-accept (they ARE the verification).
function TradeOrderEditModal({ order: r, staffView, getActor, onClose, onSaved }) {
  const [familyName, setFamilyName] = useState(r.family_name || '')
  const [dealerOrderNumber, setDealerOrderNumber] = useState(r.dealer_order_number || '')
  const [services, setServices] = useState(() => new Set(r.services || []))
  const [serviceCustom, setServiceCustom] = useState(r.service_custom || '')
  const [neededBy, setNeededBy] = useState(dOnly(r.needed_by) || '')
  const [rush, setRush] = useState(!!r.rush || r.rush_status === 'pending' || r.rush_status === 'approved')
  const [rushNeedBy, setRushNeedBy] = useState(dOnly(r.rush_need_by) || '')
  const [notes, setNotes] = useState(r.general_notes || '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  const toggleSvc = (code) => setServices(prev => {
    const n = new Set(prev); if (n.has(code)) n.delete(code); else n.add(code); return n
  })

  const save = async () => {
    if (!familyName.trim()) { setErr('Family name is required.') ; return }
    if (rush && !rushNeedBy) { setErr('Rush needs the date you need it by.'); return }
    setBusy(true); setErr(null)
    const who = await getActor()
    const rushTurnedOn = rush && r.rush_status === 'none'
    const dealerEditPostAccept = !staffView && !!r.accepted_at
    const res = await updateTradeOrder(r.id, {
      familyName: familyName.trim(), dealerOrderNumber: dealerOrderNumber.trim() || null,
      services: [...services], serviceCustom: serviceCustom.trim() || null,
      neededBy: neededBy || null,
      rush, rushNeedBy: rush ? (rushNeedBy || null) : null,
      ...(rushTurnedOn ? { rushStatus: 'pending' } : (!rush && r.rush_status !== 'none' ? { rushStatus: 'none' } : {})),
      generalNotes: notes.trim() || null,
      ...(dealerEditPostAccept ? { needsReaccept: true } : {}),
    })
    if (!res.ok) { setBusy(false); setErr(res.error || 'Save failed.'); return }
    await logTradeEvent({
      requestId: r.id, partnerId: r.partner_id, type: 'order_edited',
      detail: `Order edited${dealerEditPostAccept ? ' after accept — needs re-accept' : ''}${rushTurnedOn ? ` · RUSH requested for ${rushNeedBy}` : ''}`,
      actor: who, actorRole: staffView ? 'staff' : 'partner',
    })
    setBusy(false)
    onSaved()
  }

  return (
    <div className="sb-tb-modal-overlay" onClick={() => !busy && onClose()}>
      <div className="sb-tb-modal" onClick={e => e.stopPropagation()}>
        <div className="sb-tb-modal-title">Edit order{r.dealer_order_number ? ` · ${r.dealer_order_number}` : ''}</div>
        {!staffView && r.accepted_at && (
          <div className="sb-tb-modal-warn">This order was already accepted — saving changes sends it back to Shevchenko for a quick re-check before work continues.</div>
        )}
        <div className="sb-tb-modal-grid">
          <label className="sb-tb-f"><span>Family name *</span><input value={familyName} onChange={e => setFamilyName(e.target.value)} /></label>
          <label className="sb-tb-f"><span>Order #</span><input value={dealerOrderNumber} onChange={e => setDealerOrderNumber(e.target.value)} /></label>
        </div>
        <div className="sb-tb-f"><span>Services</span>
          <div className="sb-tb-svcrow">
            {TRADE_SERVICES.map(s => (
              <button key={s.code} type="button" className={`sb-tb-svcchip${services.has(s.code) ? ' on' : ''}`} onClick={() => toggleSvc(s.code)}>{s.label}</button>
            ))}
          </div>
          {services.has('custom') && <input value={serviceCustom} onChange={e => setServiceCustom(e.target.value)} placeholder="Describe the custom service" style={{ marginTop: 6 }} />}
        </div>
        <div className="sb-tb-modal-grid">
          <label className="sb-tb-f"><span>Deadline</span><input type="date" value={neededBy} onChange={e => setNeededBy(e.target.value)} /></label>
          <label className="sb-tb-f sb-tb-f-rush"><span>Rush — need it by</span>
            <span className="sb-tb-rushline">
              <input type="checkbox" checked={rush} onChange={e => setRush(e.target.checked)} />
              <input type="date" value={rushNeedBy} onChange={e => setRushNeedBy(e.target.value)} disabled={!rush} />
            </span>
          </label>
        </div>
        <label className="sb-tb-f"><span>Notes</span><textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)} /></label>
        {err && <div className="sb-tb-modal-err">{err}</div>}
        <div className="sb-tb-modal-actions">
          <button type="button" className="sb-tb-linkbtn" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className="sb-tb-acceptbtn" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</button>
        </div>
      </div>
    </div>
  )
}

const TB_CSS = `
  .sb-tb { width: 100%; }
  .sb-tb-toolbar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 12px; }
  .sb-tb-tabs { display: inline-flex; gap: 3px; background: #ece6d8; border-radius: 10px; padding: 3px; }
  .sb-tb-tab { border: none; cursor: pointer; border-radius: 8px; padding: 7px 16px; font: inherit; font-size: 13px; font-weight: 700; background: transparent; color: #7a756a; }
  .sb-tb-tab.on { background: #fff; color: #0f1419; box-shadow: 0 1px 3px rgba(0,0,0,0.12); }
  .sb-tb-search { flex: 1; min-width: 180px; font: inherit; font-size: 13.5px; padding: 8px 11px; border: 0.5px solid #d8d2c4; border-radius: 8px; background: #fff; }
  .sb-tb-sel { font: inherit; font-size: 13px; padding: 8px 10px; border: 0.5px solid #d8d2c4; border-radius: 8px; background: #fff; cursor: pointer; }
  .sb-tb-new { font: inherit; font-size: 13px; font-weight: 700; padding: 8px 16px; border-radius: 8px; border: none; background: #9A7209; color: #fff; cursor: pointer; }
  .sb-tb-new:hover { background: #876307; }

  .sb-tb-board { background: #fff; border: 0.5px solid rgba(0,0,0,0.09); border-radius: 12px; overflow: hidden; }
  .sb-tb-head, .sb-tb-row { display: grid; grid-template-columns: minmax(150px,1.6fr) minmax(90px,1fr) minmax(120px,1.1fr) minmax(140px,1.2fr) minmax(140px,1.2fr) minmax(84px,.8fr) minmax(90px,.9fr); gap: 10px; align-items: center; padding: 10px 14px; }
  .sb-tb-head.staff, .sb-tb-row.staff { grid-template-columns: minmax(130px,1.4fr) minmax(110px,1fr) minmax(80px,.9fr) minmax(110px,1fr) minmax(130px,1.2fr) minmax(130px,1.2fr) minmax(80px,.8fr) minmax(90px,.9fr); }
  .sb-tb-head { font-size: 10px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; color: #979387; border-bottom: 1px solid #ece8df; }
  .sb-tb-rowwrap { border-top: 0.5px solid #f0ede6; }
  .sb-tb-rowwrap:first-of-type { border-top: none; }
  .sb-tb-row { cursor: pointer; border-left: 3px solid transparent; }
  .sb-tb-row:hover { background: #faf8f4; }
  .sb-tb-row-rush { border-left-color: #b3261e; }
  .sb-tb-fam { font-size: 14px; font-weight: 700; color: #1e2d3d; min-width: 0; }
  .sb-tb-co { font-size: 12.5px; color: #6a6a62; }
  .sb-tb-num { font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 12px; color: #6a6a62; }
  .sb-tb-svc { font-size: 12.5px; color: #4a463f; }
  .sb-tb-date { font-size: 12.5px; color: #4a463f; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .sb-tb-dl-red { color: #b3261e; font-weight: 700; }
  .sb-tb-dl-amber { color: #8a5a12; font-weight: 700; }
  .sb-tb-dim { font-size: 12.5px; color: #a09a8c; }

  .sb-tb-pill { display: inline-block; font-size: 11px; font-weight: 700; padding: 2px 9px; border-radius: 999px; white-space: nowrap; }
  .sb-tb-rush { background: #b3261e; color: #fff; }
  .sb-tb-rushq { background: #fdf3e2; color: #8a5a12; border: 0.5px solid #e6b667; }
  .sb-tb-t-gray  { background: #f1eee5; color: #6a6a62; }
  .sb-tb-t-blue  { background: #eaf1fb; color: #1d5fa8; }
  .sb-tb-t-amber { background: #fbf3df; color: #8a5a12; }
  .sb-tb-t-green { background: #e9f4ec; color: #2f7d4f; }
  .sb-tb-status { font: inherit; font-size: 12.5px; font-weight: 600; padding: 5px 8px; border: 0.5px solid #d8d2c4; border-radius: 8px; cursor: pointer; max-width: 100%; }
  .sb-tb-status:disabled { opacity: .5; }
  .sb-tb-dropbtn { font: inherit; font-size: 12px; font-weight: 700; padding: 5px 11px; border-radius: 999px; border: 1px dashed #9A7209; background: #fdf8ec; color: #9A7209; cursor: pointer; white-space: nowrap; }
  .sb-tb-dropbtn:hover:not(:disabled) { background: #9A7209; color: #fff; border-style: solid; }

  .sb-tb-detail { padding: 4px 16px 16px; background: #faf9f5; border-top: 0.5px dashed #e4e0d4; }
  .sb-tb-track { display: flex; align-items: flex-start; overflow-x: auto; padding: 14px 2px 6px; }
  .sb-tb-tstep { flex: 1; min-width: 82px; text-align: center; position: relative; }
  .sb-tb-tstep::before { content: ""; position: absolute; top: 10px; left: 0; right: 0; height: 3px; background: #e4e0d4; }
  .sb-tb-tstep:first-child::before { left: 50%; }
  .sb-tb-tstep:last-child::before { right: 50%; }
  .sb-tb-tstep.done::before { background: #2f7d4f; }
  .sb-tb-tstep.now::before { background: linear-gradient(90deg, #2f7d4f 50%, #e4e0d4 50%); }
  .sb-tb-tdot { position: relative; z-index: 1; width: 20px; height: 20px; margin: 0 auto 5px; border-radius: 50%; background: #fff; border: 3px solid #e4e0d4; display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: 800; color: #fff; }
  .sb-tb-tstep.done .sb-tb-tdot { background: #2f7d4f; border-color: #2f7d4f; }
  .sb-tb-tstep.now .sb-tb-tdot { background: #9A7209; border-color: #9A7209; box-shadow: 0 0 0 4px #f5edda; }
  .sb-tb-tlab { font-size: 10.5px; font-weight: 700; line-height: 1.25; color: #2a2a2a; }
  .sb-tb-tstep.todo .sb-tb-tlab { color: #a09a8c; font-weight: 600; }
  .sb-tb-tdate { font-size: 10px; color: #a09a8c; font-variant-numeric: tabular-nums; }
  .sb-tb-rushbar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; background: #fdf3e2; border: 1px solid #e6b667; color: #8a5a12; border-radius: 10px; padding: 9px 13px; margin: 10px 0 4px; font-size: 13px; }
  .sb-tb-approve { font: inherit; font-size: 12.5px; font-weight: 700; padding: 6px 14px; border-radius: 8px; border: none; background: #2f7d4f; color: #fff; cursor: pointer; margin-left: auto; }
  .sb-tb-decline { font: inherit; font-size: 12.5px; font-weight: 700; padding: 6px 14px; border-radius: 8px; border: 0.5px solid #b3261e; background: #fff; color: #b3261e; cursor: pointer; }
  .sb-tb-detail-cols { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 18px; margin-top: 10px; }
  .sb-tb-dl { font-size: 10px; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; color: #979387; margin-bottom: 7px; }
  .sb-tb-item { display: flex; flex-direction: column; gap: 1px; padding: 7px 0; border-top: 0.5px solid #ece8df; font-size: 13px; }
  .sb-tb-item:first-of-type { border-top: none; }
  .sb-tb-note { font-size: 12.5px; color: #6a6a62; font-style: italic; }
  .sb-tb-detail-actions { margin-top: 10px; }
  .sb-tb-linkbtn { font: inherit; font-size: 12.5px; font-weight: 600; color: #9A7209; background: none; border: 0.5px solid #d9c48a; border-radius: 7px; padding: 5px 12px; cursor: pointer; }
  .sb-tb-linkbtn:hover { background: #fdf8ec; }
  .sb-tb-log { list-style: none; margin: 0; padding: 0; }
  .sb-tb-log li { display: flex; align-items: baseline; gap: 8px; padding: 5px 0; border-top: 0.5px solid #ece8df; font-size: 12.5px; }
  .sb-tb-log li:first-child { border-top: none; }
  .sb-tb-logdot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; align-self: center; }
  .sb-tb-logdot.p { background: #9A7209; }
  .sb-tb-logdot.s { background: #1d5fa8; }
  .sb-tb-logtext { flex: 1; min-width: 0; color: #2a2a2a; }
  .sb-tb-logmeta { color: #a09a8c; font-size: 11.5px; white-space: nowrap; }
  .sb-tb-empty { padding: 40px 16px; text-align: center; color: #8a8a85; font-size: 14px; background: #fff; border: 0.5px solid rgba(0,0,0,0.08); border-radius: 12px; font-style: italic; }

  .sb-tb-deletebtn { font: inherit; font-size: 12.5px; font-weight: 700; padding: 5px 12px; border-radius: 7px; border: 0.5px solid rgba(179,38,30,.5); background: #fff; color: #b3261e; cursor: pointer; margin-left: auto; }
  .sb-tb-deletebtn.armed, .sb-tb-deletebtn:hover:not(:disabled) { background: #b3261e; border-color: #b3261e; color: #fff; }
  .sb-tb-acceptbtn { font: inherit; font-size: 12.5px; font-weight: 700; padding: 6px 14px; border-radius: 8px; border: none; background: #2f7d4f; color: #fff; cursor: pointer; }
  .sb-tb-acceptbtn:hover:not(:disabled) { background: #256a41; }
  .sb-tb-acceptbtn:disabled { opacity: .5; }
  .sb-tb-detail-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }

  .sb-tb-modal-overlay { position: fixed; inset: 0; z-index: 1200; background: rgba(15,20,25,.5); display: flex; align-items: center; justify-content: center; padding: 20px; }
  .sb-tb-modal { background: #fff; border-radius: 14px; width: min(560px, 96vw); max-height: 92vh; overflow-y: auto; padding: 20px 22px; box-shadow: 0 24px 60px rgba(0,0,0,.3); }
  .sb-tb-modal-title { font-size: 16px; font-weight: 700; color: #1e2d3d; margin-bottom: 12px; }
  .sb-tb-modal-warn { background: #fdf3e2; border: 1px solid #e6b667; color: #8a5a12; border-radius: 9px; padding: 8px 12px; font-size: 12.5px; margin-bottom: 12px; }
  .sb-tb-modal-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .sb-tb-f { display: flex; flex-direction: column; gap: 4px; margin-bottom: 10px; }
  .sb-tb-f > span { font-size: 11px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: #979387; }
  .sb-tb-f input, .sb-tb-f textarea { font: inherit; font-size: 13.5px; padding: 8px 10px; border: 0.5px solid #d8d2c4; border-radius: 8px; background: #fff; }
  .sb-tb-f input[type=checkbox] { width: 16px; height: 16px; padding: 0; accent-color: #9A7209; }
  .sb-tb-rushline { display: flex; align-items: center; gap: 8px; }
  .sb-tb-svcrow { display: flex; flex-wrap: wrap; gap: 6px; }
  .sb-tb-svcchip { font: inherit; font-size: 12px; font-weight: 600; border: 1px solid #d8d2c4; border-radius: 999px; padding: 4px 12px; background: #fff; color: #6a6a62; cursor: pointer; }
  .sb-tb-svcchip.on { background: #9A7209; border-color: #9A7209; color: #fff; }
  .sb-tb-modal-err { background: #fbedec; color: #b3261e; border-radius: 8px; padding: 8px 12px; font-size: 12.5px; margin-bottom: 10px; }
  .sb-tb-modal-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 4px; }

  @media (max-width: 900px) {
    .sb-tb-head { display: none; }
    .sb-tb-row, .sb-tb-row.staff { grid-template-columns: 1fr 1fr; }
    .sb-tb-modal-grid { grid-template-columns: 1fr; }
  }
`
