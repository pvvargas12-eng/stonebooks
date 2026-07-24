// =============================================================================
// SandblastBoard — Jobs › Sandblasting: trade blasting work as a shop queue
// =============================================================================
// Paul 2026-07-24: "in stonebooks trade i need this in jobs — i want a
// sandblasting tab." Every vendor_items row with work_type 'blasting' (the
// trade partners' stones we blast), grouped by partner, stepping the vendor
// status ladder with the floor's Advance/Back grammar. Status writes go through
// updateVendorItem, so the Vendors tab, the partner portal, and this board all
// read the same truth — deep edits (files, POs, emails) stay in Vendors.
// =============================================================================
import { useState, useEffect, useMemo, useCallback } from 'react'
import { listVendorItems, updateVendorItem } from './lib/vendorsData'
import { getCurrentStaffName } from './lib/stonebooksData'

const ACTIVE = ['submitted', 'waiting_on_info', 'ready_to_work', 'in_progress', 'design_uploaded', 'ready_for_pickup']
const NEXT = {
  submitted: 'ready_to_work', waiting_on_info: 'ready_to_work', ready_to_work: 'in_progress',
  in_progress: 'ready_for_pickup', design_uploaded: 'ready_for_pickup', ready_for_pickup: 'completed',
}
const PREV = {
  completed: 'ready_for_pickup', ready_for_pickup: 'in_progress', in_progress: 'ready_to_work',
  ready_to_work: 'submitted', design_uploaded: 'in_progress', waiting_on_info: 'submitted',
}
const TONE = {
  submitted: '#8b93a1', waiting_on_info: '#e05d55', ready_to_work: '#6fb3f0',
  in_progress: '#d8a03f', design_uploaded: '#a78bfa', ready_for_pickup: '#39c6a5',
  completed: '#4fbf7c', cancelled: '#767c86',
}
const label = (s) => (s || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())

export default function SandblastBoard() {
  const [items, setItems] = useState(null)
  const [showDone, setShowDone] = useState(false)
  const [busyId, setBusyId] = useState(null)

  const load = useCallback(async () => {
    const all = await listVendorItems()
    setItems((all || []).filter(i => i.work_type === 'blasting'))
  }, [])
  useEffect(() => { load() }, [load])

  const visible = useMemo(() => {
    if (!items) return []
    return items.filter(i => (showDone ? true : ACTIVE.includes(i.status)))
  }, [items, showDone])

  const groups = useMemo(() => {
    const byPartner = new Map()
    for (const i of visible) {
      const key = i.request?.partner?.company_name || 'No partner on file'
      if (!byPartner.has(key)) byPartner.set(key, [])
      byPartner.get(key).push(i)
    }
    return [...byPartner.entries()].sort((a, z) => a[0].localeCompare(z[0]))
  }, [visible])

  const counts = useMemo(() => {
    const c = { queue: 0, blasting: 0, pickup: 0, done: 0 }
    for (const i of (items || [])) {
      if (['submitted', 'waiting_on_info', 'ready_to_work'].includes(i.status)) c.queue++
      else if (['in_progress', 'design_uploaded'].includes(i.status)) c.blasting++
      else if (i.status === 'ready_for_pickup') c.pickup++
      else if (i.status === 'completed') c.done++
    }
    return c
  }, [items])

  const step = async (item, dir) => {
    const to = dir === 'next' ? NEXT[item.status] : PREV[item.status]
    if (!to || busyId) return
    setBusyId(item.id)
    const actor = await getCurrentStaffName().catch(() => null)
    const r = await updateVendorItem(item.id, { status: to }, { actor })
    setBusyId(null)
    if (r.ok) setItems(list => (list || []).map(x => (x.id === item.id ? { ...x, status: to } : x)))
  }

  return (
    <div className="sbb">
      <style>{CSS}</style>
      <div className="sbb-head">
        <div>
          <div className="sbb-title">Sandblasting</div>
          <div className="sbb-sub">Trade partners' stones in our blast room — statuses shared with Vendors and the trade portal</div>
        </div>
        <label className="sbb-toggle">
          <input type="checkbox" checked={showDone} onChange={e => setShowDone(e.target.checked)} />
          Show completed
        </label>
      </div>

      <div className="sbb-kpis">
        <div className="sbb-kpi"><div className="n">{counts.queue}</div><div className="l">In the queue</div></div>
        <div className="sbb-kpi"><div className="n" style={{ color: '#d8a03f' }}>{counts.blasting}</div><div className="l">Being blasted</div></div>
        <div className="sbb-kpi"><div className="n" style={{ color: '#39c6a5' }}>{counts.pickup}</div><div className="l">Ready for pickup</div></div>
        <div className="sbb-kpi"><div className="n" style={{ color: '#4fbf7c' }}>{counts.done}</div><div className="l">Completed</div></div>
      </div>

      {items === null && <div className="sbb-empty">Loading trade blasting work…</div>}
      {items !== null && visible.length === 0 && (
        <div className="sbb-empty">
          {showDone ? 'No trade sandblasting work on the books.' : 'Nothing active — partner blasting requests land here the moment they’re submitted.'}
        </div>
      )}

      {groups.map(([partner, rows]) => (
        <div key={partner} className="sbb-group">
          <div className="sbb-gh"><b>{partner}</b><span className="sbb-gn">{rows.length}</span></div>
          {rows.map(i => {
            const fam = i.deceased_family_name || i.request?.family_name || i.vendor_reference || 'Stone'
            const spec = [i.stone_size && `Stone ${i.stone_size}`, i.base_size && `Base ${i.base_size}`, i.color]
              .filter(Boolean).join(' · ')
            return (
              <div key={i.id} className="sbb-row">
                <div className="sbb-main">
                  <div className="sbb-fam">{String(fam).toUpperCase()}</div>
                  <div className="sbb-spec">{spec || i.item_notes || '—'}{i.request?.dealer_order_number ? ` · ${i.request.dealer_order_number}` : ''}</div>
                </div>
                <span className="sbb-chip" style={{ color: TONE[i.status] || '#8b93a1', borderColor: TONE[i.status] || '#8b93a1' }}>
                  {label(i.status)}
                </span>
                <div className="sbb-acts">
                  {PREV[i.status] && (
                    <button type="button" disabled={busyId === i.id} onClick={() => step(i, 'prev')} className="sbb-btn">&#8592; Back</button>
                  )}
                  {NEXT[i.status] && (
                    <button type="button" disabled={busyId === i.id} onClick={() => step(i, 'next')} className="sbb-btn sbb-btn-go">
                      {i.status === 'ready_for_pickup' ? 'Picked up' : 'Advance →'}
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}

const CSS = `
  .sbb { background: #0F1419; border-radius: 16px; padding: 22px 24px; color: #e6e9ef; font-family: 'Inter', 'Helvetica Neue', sans-serif; }
  .sbb-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 14px; margin-bottom: 16px; }
  .sbb-title { font-size: 21px; font-weight: 800; letter-spacing: 0.01em; }
  .sbb-sub { font-size: 12.5px; color: #8b93a1; margin-top: 3px; }
  .sbb-toggle { display: flex; align-items: center; gap: 7px; font-size: 12.5px; color: #8b93a1; cursor: pointer; white-space: nowrap; }
  .sbb-kpis { display: grid; grid-template-columns: repeat(4, minmax(0,1fr)); gap: 10px; margin-bottom: 18px; }
  .sbb-kpi { background: #151b23; border: 1px solid #232b36; border-radius: 12px; padding: 12px 14px; }
  .sbb-kpi .n { font-size: 26px; font-weight: 800; font-family: 'JetBrains Mono', monospace; }
  .sbb-kpi .l { font-size: 11px; color: #8b93a1; margin-top: 2px; letter-spacing: 0.05em; text-transform: uppercase; }
  .sbb-empty { color: #8b93a1; font-size: 13.5px; padding: 26px 4px; text-align: center; }
  .sbb-group { margin-bottom: 16px; }
  .sbb-gh { display: flex; align-items: center; gap: 9px; font-size: 13px; color: #c9d2dd; padding: 6px 2px; border-bottom: 1px solid #232b36; margin-bottom: 6px; }
  .sbb-gn { font-family: 'JetBrains Mono', monospace; font-size: 11px; color: #6f7a8a; background: #1a212b; border-radius: 999px; padding: 1px 8px; }
  .sbb-row { display: flex; align-items: center; gap: 12px; padding: 10px 8px; border-radius: 10px; }
  .sbb-row:hover { background: #151b23; }
  .sbb-main { flex: 1; min-width: 0; }
  .sbb-fam { font-size: 14px; font-weight: 800; letter-spacing: 0.02em; }
  .sbb-spec { font-size: 12px; color: #8b93a1; margin-top: 1px; }
  .sbb-chip { font-size: 10.5px; font-weight: 800; letter-spacing: 0.06em; border: 1px solid; border-radius: 999px; padding: 3px 10px; white-space: nowrap; }
  .sbb-acts { display: flex; gap: 7px; flex-shrink: 0; }
  .sbb-btn { background: #1a212b; color: #c9d2dd; border: 1px solid #2a313c; border-radius: 8px; padding: 6px 11px; font: inherit; font-size: 12px; font-weight: 700; cursor: pointer; }
  .sbb-btn:disabled { opacity: 0.5; cursor: default; }
  .sbb-btn-go { background: rgba(79,191,124,0.14); color: #4fbf7c; border-color: rgba(79,191,124,0.4); }
`
