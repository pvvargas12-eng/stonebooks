// =============================================================================
// CheckJobsBoard — Jobs › Check jobs (Paul 2026-07-15)
// =============================================================================
// The site-inspection queue: every check job in the shop (shop_tasks,
// task_type='check_job'), open ones first. A check job is created from a lead
// (⋯ menu / "Save + check job" in New Lead) or an order (quick action) and
// also shows up in the Task Command Center — this tab is the Jobs-side lens.
// Row: who goes out · cemetery · what the family says is wrong · photos ·
// linked lead/order · due (overdue screams) · done/pending controls.
// =============================================================================

import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  listCheckJobTasks, setShopTaskStatus, deleteShopTask, getCurrentStaffName, fmtDate,
} from './lib/stonebooksData'

const pad = (n) => String(n).padStart(2, '0')
const isoOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const daysLate = (dueIso, todayIso) => {
  const a = Date.parse(String(dueIso).slice(0, 10) + 'T00:00:00')
  const b = Date.parse(String(todayIso).slice(0, 10) + 'T00:00:00')
  if (Number.isNaN(a) || Number.isNaN(b)) return 0
  return Math.max(0, Math.floor((b - a) / 86400000))
}

export default function CheckJobsBoard({ onOpenOrderDetail }) {
  const [now] = useState(() => new Date())
  const todayISO = isoOf(now)
  const [rows, setRows] = useState(null)   // null = loading
  const [busyId, setBusyId] = useState(null)

  const load = useCallback(async () => setRows(await listCheckJobTasks()), [])
  useEffect(() => { load() }, [load])

  const open = useMemo(() => (rows || []).filter(t => t.status !== 'done'), [rows])
  const done = useMemo(() => (rows || []).filter(t => t.status === 'done'), [rows])
  const overdueCount = open.filter(t => t.due_date && t.due_date < todayISO).length

  const setStatus = async (t, status) => {
    setBusyId(t.id)
    await setShopTaskStatus(t.id, status, await getCurrentStaffName().catch(() => null))
    setBusyId(null); load()
  }
  const remove = async (t) => {
    if (!window.confirm(`Delete this check job — "${t.title}"?`)) return
    await deleteShopTask(t.id, await getCurrentStaffName().catch(() => null))
    load()
  }

  const renderRow = (t) => {
    const d = t.details || {}
    const late = t.status !== 'done' && t.due_date && t.due_date < todayISO
    const photos = Array.isArray(t.attachments) ? t.attachments : []
    return (
      <div key={t.id} className={`cjb-row${t.status === 'done' ? ' done' : ''}${late ? ' late' : ''}`}>
        <input type="checkbox" checked={t.status === 'done'} disabled={busyId === t.id}
          onChange={() => setStatus(t, t.status === 'done' ? 'open' : 'done')} aria-label="Done" />
        <div className="cjb-main">
          <div className="cjb-top">
            <span className="cjb-cem">{d.cemeteryName || 'No cemetery set'}</span>
            {t.order && (
              <button type="button" className="cjb-ord" onClick={() => onOpenOrderDetail?.(t.order.id)}>
                {t.order.primary_lastname || t.order.order_number || 'Open lead/order'}
              </button>
            )}
            {late && <span className="cjb-late">{daysLate(t.due_date, todayISO)}d late</span>}
            {t.status === 'pending' && <span className="cjb-pend">pending</span>}
          </div>
          {d.notes && <div className="cjb-notes">{d.notes}</div>}
          <div className="cjb-meta">
            <span><b>{t.assignee}</b>{t.assignee_kind === 'department' ? ' (dept)' : ''} checks it</span>
            <span>tasked by {t.tasked_by || t.created_by || '—'}</span>
            <span>{t.status === 'done'
              ? `done ${t.done_at ? fmtDate(t.done_at) : ''}${t.done_by ? ` by ${t.done_by}` : ''}`
              : t.due_date ? `due ${fmtDate(t.due_date)}` : 'no date'}</span>
            {photos.map(p => (
              <a key={p.path} href={p.url} target="_blank" rel="noreferrer" className="cjb-photo">{p.name}</a>
            ))}
          </div>
        </div>
        <div className="cjb-acts">
          {t.status !== 'done' && (
            <button type="button" className="cjb-btn" disabled={busyId === t.id}
              onClick={() => setStatus(t, t.status === 'pending' ? 'open' : 'pending')}>
              {t.status === 'pending' ? 'Reopen' : 'Pending'}
            </button>
          )}
          <button type="button" className="cjb-x" title="Delete" onClick={() => remove(t)}>×</button>
        </div>
      </div>
    )
  }

  return (
    <div className="cjb">
      <style>{CSS}</style>
      <div className="cjb-head">
        <h2>Check jobs</h2>
        <span className="cjb-sub">site inspections before a repair quote — add one from the lead or the order</span>
        <span className="cjb-kpis">
          <span className="cjb-kpi">{open.length} open</span>
          {overdueCount > 0 && <span className="cjb-kpi red">{overdueCount} overdue</span>}
        </span>
      </div>

      {rows === null && <div className="cjb-empty">Loading check jobs…</div>}
      {rows !== null && open.length === 0 && (
        <div className="cjb-empty">No open check jobs. Add one from a lead's ⋯ menu, the New Lead form, or an order's quick actions.</div>
      )}
      {open.map(renderRow)}

      {done.length > 0 && (
        <>
          <div className="cjb-donehead">Checked in the last 30 days · {done.length}</div>
          {done.map(renderRow)}
        </>
      )}
    </div>
  )
}

const CSS = `
  .cjb{max-width:980px;margin:0 auto;padding:8px 0 60px;font-size:14px;color:#1A1E24}
  .cjb-head{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap;padding:12px 2px 14px}
  .cjb-head h2{font-size:22px;margin:0;letter-spacing:-.01em}
  .cjb-sub{font-size:12.5px;color:#8a8472}
  .cjb-kpis{margin-left:auto;display:flex;gap:8px}
  .cjb-kpi{font-size:12.5px;font-weight:700;border-radius:999px;padding:5px 12px;background:#fff;border:1px solid rgba(26,30,36,.12);color:#79735F}
  .cjb-kpi.red{color:#B3261E;border-color:rgba(179,38,30,.35);background:#FBEDEA}
  .cjb-empty{color:#A39C87;font-style:italic;background:#fff;border:1px solid #ece6d8;border-radius:12px;padding:22px;text-align:center}
  .cjb-row{display:flex;gap:12px;align-items:flex-start;background:#fff;border:1px solid #ece6d8;border-radius:12px;padding:13px 16px;margin-bottom:9px}
  .cjb-row.late{border-color:rgba(179,38,30,.45);box-shadow:inset 4px 0 0 #B3261E}
  .cjb-row.done{opacity:.65}
  .cjb-row input[type=checkbox]{width:17px;height:17px;accent-color:#1d7a55;cursor:pointer;margin-top:2px}
  .cjb-main{flex:1;min-width:0}
  .cjb-top{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
  .cjb-cem{font-weight:700;font-size:14.5px}
  .cjb-row.done .cjb-cem{text-decoration:line-through;color:#A39C87}
  .cjb-ord{font:600 11.5px var(--sb-font-mono,monospace);color:#1D6FA8;background:#EAF2FA;border:none;border-radius:6px;padding:3px 9px;cursor:pointer;white-space:nowrap}
  .cjb-late{font-size:10.5px;font-weight:800;letter-spacing:.04em;text-transform:uppercase;color:#B3261E;background:#FBEDEA;border-radius:6px;padding:2px 8px}
  .cjb-pend{font-size:10.5px;font-weight:800;letter-spacing:.04em;text-transform:uppercase;color:#8A5A12;background:#FBF2DE;border-radius:6px;padding:2px 8px}
  .cjb-notes{font-size:13px;color:#5d5d5a;margin-top:5px;line-height:1.45}
  .cjb-meta{display:flex;gap:14px;flex-wrap:wrap;font-size:12px;color:#8a8472;margin-top:7px}
  .cjb-meta b{color:#1A1E24}
  .cjb-photo{font-size:12px;color:#1D6FA8;text-decoration:none;border-bottom:1px dotted rgba(29,111,168,.5)}
  .cjb-acts{display:flex;align-items:center;gap:8px}
  .cjb-btn{font:600 12px/1 inherit;font-family:inherit;color:#8A5A12;background:none;border:1px solid rgba(184,132,42,.4);border-radius:7px;padding:6px 11px;cursor:pointer;white-space:nowrap}
  .cjb-x{font:700 16px/1 inherit;font-family:inherit;color:#B3261E;background:none;border:none;cursor:pointer;padding:2px 4px}
  .cjb-donehead{font-size:11px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:#A39C87;padding:16px 2px 8px}
`
