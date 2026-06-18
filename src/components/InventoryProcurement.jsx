// =============================================================================
// InventoryProcurement — purchase requests (Stone / Photo / Etching) list +
// builder + editor + print. One kind-tabbed surface; each kind pulls from its own
// needs + suppliers. Only Stone PRs touch an order milestone on submit.
// =============================================================================

import { useState, useEffect, useCallback } from 'react'
import { listPRs, markBulkOrderStatus, submitPR, cancelPR, deletePR } from '../lib/stonebooksData'
import { PR_KIND_LIST, prKind } from '../lib/prKinds'
import StonePRBuilder from './StonePRBuilder'
import StonePRPrint from './StonePRPrint'
import StonePREditor from './StonePREditor'

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
  const [kind, setKind] = useState('stone')
  const K = prKind(kind)
  const [prs, setPrs] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadErr, setLoadErr] = useState(null)
  const [showBuilder, setShowBuilder] = useState(false)
  const [printId, setPrintId] = useState(null)
  const [editId, setEditId] = useState(null)
  const [banner, setBanner] = useState(null)
  const [busyId, setBusyId] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    const r = await listPRs(kind)
    setLoadErr(r.ok ? null : r.error)
    setPrs(r.rows || [])
    setLoading(false)
  }, [kind])
  useEffect(() => { load() }, [load])

  // Opened via the Dashboard "Build PR" button → auto-open the (stone) builder once.
  useEffect(() => {
    if (autoNew) { setShowBuilder(true); onConsumeAutoNew?.() }
  }, [autoNew, onConsumeAutoNew])

  const markOrdered = async (pr) => {
    const r = await markBulkOrderStatus(pr.id, 'ordered')
    if (r.ok) load(); else window.alert(`Couldn’t update: ${r.error}`)
  }

  const doSubmit = async (pr) => {
    const msg = kind === 'stone'
      ? `Submit ${pr.po_number || 'this PR'}?\n\nThis marks every order on it as “stone ordered.”`
      : `Submit ${pr.po_number || 'this PR'} to the ${K.label.toLowerCase()} supplier?`
    if (!window.confirm(msg)) return
    setBusyId(pr.id); setBanner(null)
    const r = await submitPR(pr.id, kind)
    setBusyId(null)
    if (!r.ok) { setBanner({ kind: 'err', text: `Couldn’t submit: ${r.error}` }); return }
    const text = kind === 'stone'
      ? `${pr.po_number || 'PR'} submitted — marked ${r.marked} of ${r.orderCount} order${r.orderCount === 1 ? '' : 's'} as stone ordered.${r.milestoneError ? ` (Note: ${r.milestoneError})` : ''}`
      : `${pr.po_number || 'PR'} submitted to the supplier.`
    setBanner({ kind: 'ok', text })
    load()
  }
  const doCancel = async (pr) => {
    const msg = kind === 'stone'
      ? `Cancel ${pr.po_number || 'this PR'}?\n\nIt stays on record as cancelled, and every order on it reverts to NOT stone-ordered.`
      : `Cancel ${pr.po_number || 'this PR'}?\n\nIt stays on record as cancelled.`
    if (!window.confirm(msg)) return
    setBusyId(pr.id); setBanner(null)
    const r = await cancelPR(pr.id, kind)
    setBusyId(null)
    if (!r.ok) { setBanner({ kind: 'err', text: `Couldn’t cancel: ${r.error}` }); return }
    const text = kind === 'stone'
      ? `${pr.po_number || 'PR'} cancelled — reverted ${r.reverted} order${r.reverted === 1 ? '' : 's'} to not-ordered.`
      : `${pr.po_number || 'PR'} cancelled.`
    setBanner({ kind: 'ok', text })
    load()
  }
  const doDelete = async (pr) => {
    const tail = kind === 'stone' ? ' Any order it marked “stone ordered” reverts to not-ordered.' : ''
    if (!window.confirm(`Delete ${pr.po_number || 'this PR'} permanently?\n\nThis removes the PR and its line items.${tail} This cannot be undone.`)) return
    setBusyId(pr.id); setBanner(null)
    const r = await deletePR(pr.id, kind)
    setBusyId(null)
    if (!r.ok) { setBanner({ kind: 'err', text: `Couldn’t delete: ${r.error}` }); return }
    const text = (kind === 'stone' && r.reverted) ? `${pr.po_number || 'PR'} deleted — reverted ${r.reverted} order${r.reverted === 1 ? '' : 's'} to not-ordered.` : `${pr.po_number || 'PR'} deleted.`
    setBanner({ kind: 'ok', text })
    load()
  }

  const itemCount = (pr) => (Array.isArray(pr.items) ? (pr.items[0]?.count ?? pr.items.length) : null)
  const switchKind = (k) => { if (k !== kind) { setKind(k); setBanner(null) } }

  return (
    <div className="ipr">
      <style>{IPR_CSS}</style>

      <div className="ipr-tabs">
        {PR_KIND_LIST.map(k => (
          <button key={k} type="button" className={`ipr-tab${k === kind ? ' on' : ''}`} onClick={() => switchKind(k)}>{prKind(k).label}</button>
        ))}
      </div>

      <div className="ipr-head">
        <span className="ipr-sub">
          {kind === 'stone'
            ? 'Stone purchase requests — print + send to a supplier, then Submit to mark its orders “stone ordered.”'
            : `${K.noun} purchase requests — print + send to your ${K.label.toLowerCase()} supplier.`}
        </span>
        <button type="button" className="sb-btn-primary" onClick={() => setShowBuilder(true)}>+ New {K.noun} PR</button>
      </div>

      {banner && <div className={`ipr-banner ipr-banner-${banner.kind}`}>{banner.text}<button type="button" className="ipr-banner-x" onClick={() => setBanner(null)}>×</button></div>}

      {loading ? (
        <div className="sb-empty">Loading purchase requests…</div>
      ) : loadErr ? (
        <div className="sb-empty">Procurement isn’t available yet.<br /><span className="ipr-muted">Run the procurement migration (suppliers + bulk_order_items) in Studio, then refresh.</span></div>
      ) : prs.length === 0 ? (
        <div className="sb-empty">No {K.label.toLowerCase()} purchase requests yet.<br /><span className="ipr-muted">Click <strong>+ New {K.noun} PR</strong> to build one.</span></div>
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
                      {st !== 'received' && st !== 'cancelled' && <button type="button" className="ipr-link" disabled={busyId === pr.id} onClick={() => setEditId(pr.id)}>Edit</button>}
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
          kind={kind}
          onClose={() => setShowBuilder(false)}
          onSaved={(id) => { setShowBuilder(false); load(); if (id) setPrintId(id) }}
        />
      )}
      {printId && <StonePRPrint bulkOrderId={printId} kind={kind} onClose={() => setPrintId(null)} />}
      {editId && <StonePREditor bulkOrderId={editId} kind={kind} onClose={() => setEditId(null)} onSaved={() => { setEditId(null); setBanner({ kind: 'ok', text: 'PR lines updated.' }); load() }} />}
    </div>
  )
}

const IPR_CSS = `
  .ipr-tabs { display: flex; gap: 4px; margin-bottom: 16px; border-bottom: 1px solid var(--sb-border, #e4e0d4); }
  .ipr-tab { background: none; border: none; border-bottom: 2px solid transparent; font: inherit; font-size: 14px; font-weight: 600; color: var(--sb-text-muted, #8a7f6c); padding: 8px 16px; cursor: pointer; margin-bottom: -1px; }
  .ipr-tab.on { color: #6b5d3a; border-bottom-color: #9A7209; }
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
