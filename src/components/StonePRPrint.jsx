// =============================================================================
// StonePRPrint — print-ready vendor sheet for a Stone Purchase Request.
// =============================================================================
// Professional vendor document: letterhead, PR meta, and a clean line table whose
// single "Item" column carries the FULL contract-format spec string (buildDieSpec /
// buildBaseSpec output, persisted as spec_text at PR creation) — so each line reads
// identically to the order's contract line item. Manual lines with no spec_text
// compose the same-format string from the stored fields. Browser print.
// =============================================================================

import { useState, useEffect } from 'react'
import { getBulkOrderWithItems } from '../lib/stonebooksData'

const fmtDate = (d) => {
  if (!d) return '—'
  const dt = new Date(String(d).slice(0, 10) + 'T00:00:00')
  return isNaN(dt) ? String(d) : dt.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
}

// The line's display spec: prefer the stored contract-format string; otherwise
// compose from whatever fields were entered manually (same dotted style).
function itemSpec(it) {
  const stored = (it.spec_text || '').trim()
  if (stored) return stored
  const composed = [it.color, it.size, it.top, it.sides].map(v => (v || '').trim()).filter(Boolean).join(' · ')
  return composed || '—'
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

  // Group lines by family (preserve first-seen order) so the family name reads once
  // per group, prominently, with its piece(s) listed beneath.
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
              <div className="prp-co-sub">Perth Amboy, New Jersey · Established 1919</div>
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
          </div>

          <table className="prp-table">
            <thead>
              <tr>
                <th className="prp-c-fam">Family Name</th>
                <th className="prp-c-item">Item</th>
                <th className="prp-c-qty">Qty</th>
                <th className="prp-c-notes">Notes</th>
              </tr>
            </thead>
            <tbody>
              {groups.length === 0 && <tr><td colSpan={4} className="prp-empty-row">No line items.</td></tr>}
              {groups.map(fam => byFam.get(fam).map((it, i) => (
                <tr key={it.id || `${fam}-${i}`} className={i === 0 ? 'prp-fam-first' : ''}>
                  <td className="prp-c-fam">{i === 0 ? fam : ''}</td>
                  <td className="prp-c-item">{itemSpec(it)}</td>
                  <td className="prp-c-qty">{it.quantity ?? 1}</td>
                  <td className="prp-c-notes">{it.notes || ''}</td>
                </tr>
              )))}
            </tbody>
            <tfoot>
              <tr><td className="prp-total-l" colSpan={2}>Total pieces</td><td className="prp-c-qty">{totalQty}</td><td /></tr>
            </tfoot>
          </table>

          {prNotes && (
            <div className="prp-notesblock"><span className="prp-notesblock-l">Notes:</span> {prNotes}</div>
          )}

          <div className="prp-auth">
            <div className="prp-auth-row">
              <span className="prp-auth-l">Authorized by:</span>
              <span className="prp-auth-name">Lionel P. Vargas</span>
            </div>
            <div className="prp-auth-date">{fmtDate(o.created_at || o.placed_at)}</div>
          </div>

          <div className="prp-footer">Shevchenko Monuments LLC · Purchase Request {o.po_number || ''}</div>
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

  .prp-sheet { background: #fff; color: #1a1a1a; padding: 48px 52px; border-radius: 6px; font-family: Georgia, 'Times New Roman', serif; }
  .prp-err { padding: 40px; text-align: center; color: #b3261e; font-family: sans-serif; }
  .prp-head { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2.5px solid #1a1a1a; padding-bottom: 16px; margin-bottom: 22px; }
  .prp-co { font-size: 23px; font-weight: 700; letter-spacing: 0.03em; }
  .prp-co-sub { font-size: 12px; color: #555; margin-top: 4px; font-family: Arial, sans-serif; letter-spacing: 0.02em; }
  .prp-doctype { text-align: right; }
  .prp-doctype-main { font-size: 15px; font-weight: 700; letter-spacing: 0.12em; }
  .prp-prnum { font-family: 'Courier New', monospace; font-size: 13px; color: #444; margin-top: 5px; letter-spacing: 0.04em; }

  .prp-meta { display: flex; flex-wrap: wrap; gap: 12px 36px; margin-bottom: 26px; font-family: Arial, sans-serif; }
  .prp-metaitem-wide { flex: 1 1 100%; }
  .prp-meta-l { font-size: 9.5px; text-transform: uppercase; letter-spacing: 0.08em; color: #999; margin-bottom: 2px; }
  .prp-meta-v { font-size: 14px; font-weight: 700; color: #1a1a1a; }

  .prp-table { width: 100%; border-collapse: collapse; font-family: Arial, sans-serif; font-size: 13px; }
  .prp-table th { text-align: left; font-size: 9.5px; text-transform: uppercase; letter-spacing: 0.07em; color: #444; border-bottom: 2px solid #1a1a1a; padding: 8px 10px; }
  .prp-table td { padding: 10px; border-bottom: 1px solid #e2e2e2; vertical-align: top; }
  .prp-fam-first td { border-top: 1px solid #cfcfcf; }
  .prp-table tbody tr:first-child td { border-top: none; }
  .prp-c-fam { font-weight: 700; font-size: 13.5px; white-space: nowrap; width: 22%; }
  .prp-c-item { width: 56%; line-height: 1.45; }
  .prp-c-qty { text-align: center; width: 50px; }
  .prp-c-notes { color: #555; font-size: 12px; }
  .prp-empty-row { text-align: center; color: #999; padding: 22px; }
  .prp-total-l { text-align: right; font-weight: 700; border-top: 2px solid #1a1a1a; padding-top: 9px; }
  .prp-table tfoot td { border-bottom: none; }
  .prp-table tfoot .prp-c-qty { border-top: 2px solid #1a1a1a; padding-top: 9px; font-weight: 700; }

  .prp-notesblock { margin-top: 20px; font-family: Arial, sans-serif; font-size: 12.5px; color: #333; line-height: 1.5; }
  .prp-notesblock-l { font-weight: 700; }

  .prp-auth { margin-top: 56px; padding-top: 10px; border-top: 1px solid #1a1a1a; width: 320px; }
  .prp-auth-row { display: flex; align-items: baseline; gap: 8px; font-family: Arial, sans-serif; }
  .prp-auth-l { font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: #888; }
  .prp-auth-name { font-family: Georgia, serif; font-size: 16px; font-weight: 700; color: #1a1a1a; }
  .prp-auth-date { font-family: Arial, sans-serif; font-size: 12px; color: #666; margin-top: 3px; }

  .prp-footer { margin-top: 34px; text-align: center; font-family: Arial, sans-serif; font-size: 10px; color: #aaa; letter-spacing: 0.03em; }

  @media print {
    .prp-overlay { position: static; background: #fff; padding: 0; display: block; }
    .prp-shell { width: 100%; }
    .prp-toolbar { display: none; }
    .prp-sheet { box-shadow: none; border-radius: 0; padding: 0; }
  }
`
