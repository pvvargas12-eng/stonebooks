// =============================================================================
// InventoryProcurement — Stone Purchase Requests list + builder + print (Phase 1).
// =============================================================================

import { useState, useEffect, useCallback } from 'react'
import { listStonePRs, markBulkOrderStatus, submitStonePR, cancelStonePR, deleteStonePR } from '../lib/stonebooksData'
import StonePRBuilder from './StonePRBuilder'
import StonePRPrint from './StonePRPrint'

const fmtDate = (d) => {
  if (!d) return '—'
  const dt = new Date(String(d).slice(0, 10) + 'T00:00:00')
  return isNaN(dt) ? String(d) : dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}
function statusOf(pr) {
  if (pr.status === 'cancelled') return 'cancelled'
  if (pr.received_at) return 'received'
  if (pr.status === 'submitted') return 'submitted'
  if (pr.status === 'draft') return 'draft'
  return 'ordered'
}
const STATUS_LABEL = { draft: 'Draft', submitted: 'Submitted', ordered: 'Ordered', received: 'Received', cancelled: 'Cancelled' }

export default function InventoryProcurement({ autoNew = false, onConsumeAutoNew }) {
  const [prs, setPrs] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadErr, setLoadErr] = useState(null)
  const [showBuilder, setShowBuilder] = useState(false)
  const [printId, setPrintId] = useState(null)
  const [banner, setBanner] = useState(null)
  const [busyId, setBusyId] = useState(null)

  const load = useCallback(async () => {
    const r = await listStonePRs()
    setLoadErr(r.ok ? null : r.error)
    setPrs(r.rows || [])
    setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  // Opened via the Dashboard "Build PR" button → auto-open the builder once.
  useEffect(() => {
    if (autoNew) { setShowBuilder(true); onConsumeAutoNew?.() }
  }, [autoNew, onConsumeAutoNew])

  const markOrdered = async (pr) => {
    const r = await markBulkOrderStatus(pr.id, 'ordered')
    if (r.ok) load(); else window.alert(`Couldn’t update: ${r.error}`)
  }

  const doSubmit = async (pr) => {
    if (!window.confirm(`Submit ${pr.po_number || 'this PR'}?\n\nThis marks every order on it as “stone ordered.”`)) return
    setBusyId(pr.id); setBanner(null)
    const r = await submitStonePR(pr.id)
    setBusyId(null)
    if (!r.ok) { setBanner({ kind: 'err', text: `Couldn’t submit: ${r.error}` }); return }
    setBanner({ kind: 'ok', text: `${pr.po_number || 'PR'} submitted — marked ${r.marked} of ${r.orderCount} order${r.orderCount === 1 ? '' : 's'} as stone ordered.${r.milestoneError ? ` (Note: ${r.milestoneError})` : ''}` })
    load()
  }
  const doCancel = async (pr) => {
    if (!window.confirm(`Cancel ${pr.po_number || 'this PR'}?\n\nIt stays on record as cancelled, and every order on it reverts to NOT stone-ordered.`)) return
    setBusyId(pr.id); setBanner(null)
    const r = await cancelStonePR(pr.id)
    setBusyId(null)
    if (!r.ok) { setBanner({ kind: 'err', text: `Couldn’t cancel: ${r.error}` }); return }
    setBanner({ kind: 'ok', text: `${pr.po_number || 'PR'} cancelled — reverted ${r.reverted} order${r.reverted === 1 ? '' : 's'} to not-ordered.` })
    load()
  }
  const doDelete = async (pr) => {
    if (!window.confirm(`Delete ${pr.po_number || 'this PR'} permanently?\n\nThis removes the PR and its line items. Any order it marked “stone ordered” reverts to not-ordered. This cannot be undone.`)) return
    setBusyId(pr.id); setBanner(null)
    const r = await deleteStonePR(pr.id)
    setBusyId(null)
    if (!r.ok) { setBanner({ kind: 'err', text: `Couldn’t delete: ${r.error}` }); return }
    setBanner({ kind: 'ok', text: `${pr.po_number || 'PR'} deleted${r.reverted ? ` — reverted ${r.reverted} order${r.reverted === 1 ? '' : 's'} to not-ordered.` : '.'}` })
    load()
  }

  const itemCount = (pr) => (Array.isArray(pr.items) ? (pr.items[0]?.count ?? pr.items.length) : null)

  return (
    <div className="ipr">
      <style>{IPR_CSS}</style>
      <div className="ipr-head">
        <span className="ipr-sub">Stone purchase requests — print + send to a supplier, then Submit to mark its orders “stone ordered.”</span>
        <button type="button" className="sb-btn-primary" onClick={() => setShowBuilder(true)}>+ New Stone PR</button>
      </div>

      {banner && <div className={`ipr-banner ipr-banner-${banner.kind}`}>{banner.text}<button type="button" className="ipr-banner-x" onClick={() => setBanner(null)}>×</button></div>}

      {loading ? (
        <div className="sb-empty">Loading purchase requests…</div>
      ) : loadErr ? (
        <div className="sb-empty">Procurement isn’t available yet.<br /><span className="ipr-muted">Run the procurement migration (suppliers + bulk_order_items) in Studio, then refresh.</span></div>
      ) : prs.length === 0 ? (
        <div className="sb-empty">No purchase requests yet.<br /><span className="ipr-muted">Click <strong>+ New Stone PR</strong> to build one (Peerless will be your first stone supplier).</span></div>
      ) : (
        <div className="ipr-table-wrap">
          <table className="ipr-table">
            <thead><tr><th>PR #</th><th>Supplier</th><th>Date</th><th>Requested</th><th className="ipr-num">Lines</th><th>Status</th><th /></tr></thead>
            <tbody>
              {prs.map(pr => {
                const st = statusOf(pr)
                return (
                  <tr key={pr.id}>
                    <td className="ipr-mono">{pr.po_number || '—'}</td>
                    <td className="ipr-sup">{pr.supplier_name || '—'}</td>
                    <td>{fmtDate(pr.placed_at)}</td>
                    <td>{fmtDate(pr.supplier_eta)}</td>
                    <td className="ipr-num">{itemCount(pr) ?? '—'}</td>
                    <td><span className={`ipr-pill ipr-pill-${st}`}>{STATUS_LABEL[st]}</span></td>
                    <td className="ipr-actions">
                      <button type="button" className="ipr-link" disabled={busyId === pr.id} onClick={() => setPrintId(pr.id)}>Print</button>
                      {(st === 'draft' || st === 'ordered') && <button type="button" className="ipr-link ipr-link-go" disabled={busyId === pr.id} onClick={() => doSubmit(pr)}>Submit</button>}
                      {st === 'draft' && <button type="button" className="ipr-link" disabled={busyId === pr.id} onClick={() => markOrdered(pr)}>Mark ordered</button>}
                      {st === 'submitted' && <button type="button" className="ipr-link ipr-link-warn" disabled={busyId === pr.id} onClick={() => doCancel(pr)}>Cancel</button>}
                      <button type="button" className="ipr-link ipr-link-del" disabled={busyId === pr.id} onClick={() => doDelete(pr)}>Delete</button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {showBuilder && (
        <StonePRBuilder
          onClose={() => setShowBuilder(false)}
          onSaved={(id) => { setShowBuilder(false); load(); if (id) setPrintId(id) }}
        />
      )}
      {printId && <StonePRPrint bulkOrderId={printId} onClose={() => setPrintId(null)} />}
    </div>
  )
}

const IPR_CSS = `
  .ipr-head { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 18px; flex-wrap: wrap; }
  .ipr-sub { font-size: 13.5px; color: var(--sb-text-muted, #6b6256); }
  .ipr-muted { color: var(--sb-text-muted, #8a7f6c); font-size: 13px; }
  .ipr-table-wrap { overflow-x: auto; border: 1px solid var(--sb-border, #e4e0d4); border-radius: 12px; background: var(--sb-surface, #fff); }
  .ipr-table { width: 100%; border-collapse: collapse; font-size: 13.5px; }
  .ipr-table th { text-align: left; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--sb-text-muted, #8a7f6c); padding: 11px 14px; border-bottom: 1px solid var(--sb-border, #e4e0d4); }
  .ipr-table td { padding: 10px 14px; border-bottom: 1px solid var(--sb-border-soft, #f0ece2); }
  .ipr-table tr:last-child td { border-bottom: 0; }
  .ipr-mono { font-family: var(--font-m, 'JetBrains Mono'), monospace; font-size: 12.5px; }
  .ipr-sup { font-weight: 700; }
  .ipr-num { text-align: center; }
  .ipr-pill { display: inline-block; padding: 2px 9px; border-radius: 999px; font-size: 11px; font-weight: 700; }
  .ipr-pill-draft { background: #ece9e3; color: #6b6256; }
  .ipr-pill-submitted { background: #e4eefb; color: #2563a8; }
  .ipr-pill-ordered { background: #ede8f7; color: #6d49b8; }
  .ipr-pill-received { background: #e7f3ea; color: #1f7a3d; }
  .ipr-pill-cancelled { background: #f3e6e5; color: #b3261e; }
  .ipr-actions { display: flex; gap: 12px; flex-wrap: wrap; }
  .ipr-link { background: none; border: none; font: inherit; font-size: 13px; font-weight: 600; color: #9A7209; cursor: pointer; padding: 0; }
  .ipr-link:hover { text-decoration: underline; }
  .ipr-link:disabled { opacity: 0.45; cursor: default; text-decoration: none; }
  .ipr-link-go { color: #1f7a3d; }
  .ipr-link-warn { color: #b3261e; }
  .ipr-link-del { color: #b3261e; }
  .ipr-banner { display: flex; align-items: center; gap: 10px; padding: 10px 14px; border-radius: 9px; font-size: 13.5px; font-weight: 600; margin-bottom: 16px; }
  .ipr-banner-ok { background: #e7f3ea; color: #1f7a3d; }
  .ipr-banner-err { background: #fdeced; color: #b3261e; }
  .ipr-banner-x { margin-left: auto; background: none; border: none; font-size: 18px; line-height: 1; color: inherit; opacity: 0.6; cursor: pointer; }
`
