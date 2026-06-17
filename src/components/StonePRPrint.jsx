// =============================================================================
// StonePRPrint — print-ready vendor sheet for a Stone Purchase Request.
// =============================================================================
// Modeled on a real vendor sheet (Peerless-style): letterhead, PR meta, a clean
// line-item table grouped by family, and a signature footer. Browser print (v1).
// =============================================================================

import { useState, useEffect } from 'react'
import { getBulkOrderWithItems } from '../lib/stonebooksData'

const fmtDate = (d) => {
  if (!d) return '—'
  const dt = new Date(String(d).slice(0, 10) + 'T00:00:00')
  return isNaN(dt) ? String(d) : dt.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
}

export default function StonePRPrint({ bulkOrderId, onClose }) {
  const [state, setState] = useState({ loading: true })

  useEffect(() => {
    let alive = true
    getBulkOrderWithItems(bulkOrderId).then(r => { if (alive) setState({ loading: false, ...r }) }).catch(e => { if (alive) setState({ loading: false, ok: false, error: String(e?.message || e) }) })
    return () => { alive = false }
  }, [bulkOrderId])

  if (state.loading) return <div className="prp-overlay"><div className="prp-loading">Loading purchase request…</div></div>
  if (!state.ok) return (
    <div className="prp-overlay" onClick={onClose}>
      <div className="prp-sheet" onClick={e => e.stopPropagation()}><div className="prp-err">Couldn’t load the PR.<br />{state.error}</div></div>
    </div>
  )

  const o = state.order || {}
  const items = state.items || []
  // createdBy was stored in notes as "… · Created by X". Split it back out.
  const rawNotes = o.notes || ''
  const m = rawNotes.match(/(?:^|·\s*)Created by (.+)$/)
  const createdBy = m ? m[1].trim() : null
  const prNotes = createdBy ? rawNotes.replace(/\s*·?\s*Created by .+$/, '').trim() : rawNotes

  // Group lines by family (preserve first-seen order).
  const groups = []
  const byFam = new Map()
  for (const it of items) {
    const f = it.family_name || '—'
    if (!byFam.has(f)) { byFam.set(f, []); groups.push(f) }
    byFam.get(f).push(it)
  }
  const totalQty = items.reduce((s, it) => s + (Number(it.quantity) || 0), 0)

  return (
    <div className="prp-overlay" onClick={onClose}>
      <style>{PRP_CSS}</style>
      <div className="prp-shell" onClick={e => e.stopPropagation()}>
        <div className="prp-toolbar">
          <button type="button" className="prp-btn" onClick={onClose}>← Close</button>
          <button type="button" className="prp-btn prp-btn-primary" onClick={() => window.print()}>Print</button>
        </div>

        <div className="prp-sheet">
          <div className="prp-head">
            <div className="prp-letterhead">
              <div className="prp-co">SHEVCHENKO MONUMENTS LLC</div>
              <div className="prp-co-sub">Perth Amboy, New Jersey · Est. 1919</div>
            </div>
            <div className="prp-doctype">
              <div className="prp-doctype-main">PURCHASE REQUEST</div>
              <div className="prp-prnum">{o.po_number || '—'}</div>
            </div>
          </div>

          <div className="prp-meta">
            <Meta label="Vendor" value={o.supplier_name || '—'} wide />
            <Meta label="Date" value={fmtDate(o.placed_at)} />
            <Meta label="Requested Delivery" value={fmtDate(o.supplier_eta)} />
            <Meta label="Created By" value={createdBy || '—'} />
            <Meta label="Status" value={(o.status || 'ordered').toUpperCase()} />
          </div>

          <table className="prp-table">
            <thead>
              <tr>
                <th className="prp-c-fam">Family Name</th>
                <th>Color</th>
                <th>Type</th>
                <th>Size</th>
                <th>Specs</th>
                <th className="prp-c-qty">Qty</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {groups.length === 0 && <tr><td colSpan={7} className="prp-empty-row">No line items.</td></tr>}
              {groups.map(fam => byFam.get(fam).map((it, i) => (
                <tr key={it.id || `${fam}-${i}`}>
                  <td className="prp-c-fam">{i === 0 ? fam : ''}</td>
                  <td>{it.color || ''}</td>
                  <td>{it.kind ? it.kind[0].toUpperCase() + it.kind.slice(1) : 'Stone'}</td>
                  <td className="prp-mono">{it.size || ''}</td>
                  <td>{[it.top, it.sides].filter(Boolean).join(' · ')}</td>
                  <td className="prp-c-qty">{it.quantity ?? 1}</td>
                  <td className="prp-notes-cell">{it.notes || ''}</td>
                </tr>
              )))}
            </tbody>
            <tfoot>
              <tr><td colSpan={5} className="prp-total-l">Total pieces</td><td className="prp-c-qty">{totalQty}</td><td /></tr>
            </tfoot>
          </table>

          {prNotes && (
            <div className="prp-notesblock"><span className="prp-notesblock-l">Notes:</span> {prNotes}</div>
          )}

          <div className="prp-sign">
            <div className="prp-sign-line"><span>Authorized by</span></div>
            <div className="prp-sign-line"><span>Date</span></div>
          </div>
          <div className="prp-footer">Shevchenko Monuments LLC · Purchase Request {o.po_number || ''} · generated {fmtDate(o.created_at)}</div>
        </div>
      </div>
    </div>
  )
}

function Meta({ label, value, wide }) {
  return (
    <div className={`prp-metaitem ${wide ? 'prp-metaitem-wide' : ''}`}>
      <div className="prp-meta-l">{label}</div>
      <div className="prp-meta-v">{value}</div>
    </div>
  )
}

const PRP_CSS = `
  .prp-overlay { position: fixed; inset: 0; z-index: 1300; background: rgba(20,18,14,0.5); display: flex; align-items: flex-start; justify-content: center; overflow-y: auto; padding: 24px; }
  .prp-loading { color: #fff; margin: auto; }
  .prp-shell { width: min(820px, 96vw); }
  .prp-toolbar { display: flex; justify-content: space-between; margin-bottom: 12px; }
  .prp-btn { font: inherit; font-size: 13px; font-weight: 600; padding: 8px 16px; border-radius: 8px; border: 1px solid #d8d2c4; background: #fff; color: #2a2a2a; cursor: pointer; }
  .prp-btn-primary { background: #1e2d3d; border-color: #1e2d3d; color: #fff; }

  .prp-sheet { background: #fff; color: #1a1a1a; padding: 44px 48px; border-radius: 6px; font-family: Georgia, 'Times New Roman', serif; }
  .prp-err { padding: 40px; text-align: center; color: #b3261e; font-family: sans-serif; }
  .prp-head { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #1a1a1a; padding-bottom: 14px; margin-bottom: 18px; }
  .prp-co { font-size: 22px; font-weight: 700; letter-spacing: 0.02em; }
  .prp-co-sub { font-size: 12px; color: #555; margin-top: 3px; font-family: Arial, sans-serif; }
  .prp-doctype { text-align: right; }
  .prp-doctype-main { font-size: 16px; font-weight: 700; letter-spacing: 0.08em; }
  .prp-prnum { font-family: 'Courier New', monospace; font-size: 13px; color: #444; margin-top: 4px; }

  .prp-meta { display: flex; flex-wrap: wrap; gap: 8px 28px; margin-bottom: 20px; font-family: Arial, sans-serif; }
  .prp-metaitem-wide { flex: 1 1 100%; }
  .prp-meta-l { font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; color: #888; }
  .prp-meta-v { font-size: 14px; font-weight: 600; color: #1a1a1a; }

  .prp-table { width: 100%; border-collapse: collapse; font-family: Arial, sans-serif; font-size: 12.5px; }
  .prp-table th { text-align: left; font-size: 10px; text-transform: uppercase; letter-spacing: 0.04em; color: #444; border-bottom: 1.5px solid #1a1a1a; padding: 7px 8px; }
  .prp-table td { padding: 8px; border-bottom: 1px solid #ddd; vertical-align: top; }
  .prp-c-fam { font-weight: 700; }
  .prp-c-qty { text-align: center; width: 44px; }
  .prp-mono { font-family: 'Courier New', monospace; }
  .prp-notes-cell { color: #555; font-size: 11.5px; }
  .prp-empty-row { text-align: center; color: #999; padding: 20px; }
  .prp-total-l { text-align: right; font-weight: 700; border-top: 1.5px solid #1a1a1a; padding-top: 8px; }
  .prp-table tfoot td { border-bottom: none; }

  .prp-notesblock { margin-top: 18px; font-family: Arial, sans-serif; font-size: 12.5px; color: #333; }
  .prp-notesblock-l { font-weight: 700; }
  .prp-sign { display: flex; gap: 50px; margin-top: 48px; }
  .prp-sign-line { flex: 1; border-top: 1px solid #1a1a1a; padding-top: 5px; font-family: Arial, sans-serif; font-size: 11px; color: #666; }
  .prp-footer { margin-top: 30px; text-align: center; font-family: Arial, sans-serif; font-size: 10px; color: #999; }

  @media print {
    .prp-overlay { position: static; background: #fff; padding: 0; display: block; }
    .prp-shell { width: 100%; }
    .prp-toolbar { display: none; }
    .prp-sheet { box-shadow: none; border-radius: 0; padding: 0; }
  }
`
