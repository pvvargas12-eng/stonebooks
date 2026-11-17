// =============================================================================
// StonePRPrint — vendor sheet for a Stone Purchase Request (print + PDF).
// =============================================================================
// One clean typeface throughout. The "Item" column reads identically to the
// order's contract line item: a manual wording override (spec_text) wins; else the
// spec is resolved LIVE from the linked order via the SAME resolver the contract
// uses (resolveStoneNeeds → buildDieSpec / buildBaseSpec); else a composed
// color+size fallback. Each order shows its die line AND a separate base line.
// Letter-size browser print + a real jsPDF download (same CDN pattern as the
// contract/estimate PDFs).
// =============================================================================

import { useState, useEffect } from 'react'
import { getBulkOrderWithItems } from '../lib/stonebooksData'
import { resolveSpecsForPR, prKind } from '../lib/prKinds'
import { fmtDate, parseCreatedBy, orderedRowsOf, structuredOf, buildPRPdf } from '../lib/prSheet'

export default function StonePRPrint({ bulkOrderId, onClose, kind = 'stone' }) {
  const K = prKind(kind)
  const [state, setState] = useState({ loading: true })
  const [pdfBusy, setPdfBusy] = useState(false)

  useEffect(() => {
    let alive = true
    ;(async () => {
      const r = await getBulkOrderWithItems(bulkOrderId)
      if (!alive) return
      if (!r.ok) { setState({ loading: false, ok: false, error: r.error }); return }
      const items = r.items || []
      const { lineSpec, attach } = await resolveSpecsForPR(kind, items)
      if (alive) setState({ loading: false, ok: true, order: r.order, items, lineSpec, attach })
    })().catch(e => { if (alive) setState({ loading: false, ok: false, error: String(e?.message || e) }) })
    return () => { alive = false }
  }, [bulkOrderId, kind])

  const downloadPdf = async () => {
    if (pdfBusy || !state.ok) return
    setPdfBusy(true)
    try { const b = await buildPRPdf(state.order || {}, state.items || [], state.lineSpec || {}, kind, state.attach || {}); b.doc.save(b.filename) }
    catch (e) { window.alert(`Couldn’t make the PDF: ${e?.message || e}`) }
    setPdfBusy(false)
  }

  if (state.loading) return <div className="prp-overlay"><div className="prp-loading">Loading purchase request…</div></div>
  if (!state.ok) return (
    <div className="prp-overlay" onClick={onClose}>
      <div className="prp-sheet" onClick={e => e.stopPropagation()}><div className="prp-err">Couldn’t load the PR.<br />{state.error}</div></div>
    </div>
  )

  const o = state.order || {}
  const items = state.items || []
  const lineSpec = state.lineSpec || {}
  const attach = state.attach || {}
  const { createdBy, prNotes } = parseCreatedBy(o.notes)
  const rowsArr = orderedRowsOf(items, lineSpec)
  const totalQty = items.reduce((s, it) => s + (Number(it.quantity) || 0), 0)

  return (
    <div className="prp-overlay" onClick={onClose}>
      <style>{PRP_CSS}</style>
      <div className="prp-shell" onClick={e => e.stopPropagation()}>
        <div className="prp-toolbar">
          <button type="button" className="prp-btn" onClick={onClose}>← Close</button>
          <div className="prp-toolbar-r">
            <button type="button" className="prp-btn" disabled={pdfBusy} onClick={downloadPdf}>{pdfBusy ? 'Building…' : 'Download PDF'}</button>
            <button type="button" className="prp-btn prp-btn-primary" onClick={() => window.print()}>Print</button>
          </div>
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

          {kind === 'stone' ? (
            <table className="prp-table">
              <thead>
                <tr>
                  <th className="prp-c-fam2">Family Name</th>
                  <th className="prp-c-color">Color</th>
                  <th className="prp-c-type">Type</th>
                  <th className="prp-c-size">Size</th>
                  <th>Specs</th>
                  <th className="prp-c-qty">Qty</th>
                </tr>
              </thead>
              <tbody>
                {rowsArr.length === 0 && <tr><td colSpan={6} className="prp-empty-row">No line items.</td></tr>}
                {rowsArr.map((it, idx) => {
                  const s = structuredOf(it, lineSpec)
                  return (
                    <tr key={it.id || idx} className={idx % 2 === 1 ? 'prp-zebra' : ''}>
                      <td className="prp-c-fam2">{s.family}</td>
                      <td className="prp-c-color">{s.color}</td>
                      <td className="prp-c-type">{s.type}</td>
                      <td className="prp-c-size prp-mono">{s.size}</td>
                      <td className="prp-mono">{s.specs}</td>
                      <td className="prp-c-qty">{it.quantity ?? 1}</td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr><td colSpan={4} className="prp-total-l">Total pieces</td><td /><td className="prp-c-qty">{totalQty}</td></tr>
              </tfoot>
            </table>
          ) : (
            <table className="prp-table">
              <thead>
                <tr>
                  <th className="prp-c-fam">Family Name</th>
                  <th className="prp-c-item">{K.itemHeader}</th>
                  <th className="prp-c-qty">Qty</th>
                </tr>
              </thead>
              <tbody>
                {rowsArr.length === 0 && <tr><td colSpan={3} className="prp-empty-row">No line items.</td></tr>}
                {rowsArr.map((it, idx) => (
                  <tr key={it.id || idx} className={idx % 2 === 1 ? 'prp-zebra' : ''}>
                    <td className="prp-c-fam">{it.family_name || '—'}</td>
                    <td className="prp-c-item">
                      {lineSpec[it.id] || '—'}
                      {attach[it.id] && <div className={`prp-attach ${/awaiting/i.test(attach[it.id]) ? 'prp-attach-warn' : ''}`}>{attach[it.id]}</div>}
                    </td>
                    <td className="prp-c-qty">{it.quantity ?? 1}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr><td className="prp-total-l">Total pieces</td><td /><td className="prp-c-qty">{totalQty}</td></tr>
              </tfoot>
            </table>
          )}

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

// ONE typeface throughout: Helvetica/Arial. Letter-size sheet (8.5in = 816px @96dpi)
// with @page letter + 0.75in margins for print.
const PRP_CSS = `
  .prp-overlay { position: fixed; inset: 0; z-index: 1300; background: rgba(20,18,14,0.5); display: flex; align-items: flex-start; justify-content: center; overflow-y: auto; padding: 24px; font-family: Helvetica, Arial, sans-serif; }
  .prp-loading { color: #fff; margin: auto; }
  .prp-shell { width: min(816px, 96vw); }
  .prp-toolbar { display: flex; justify-content: space-between; margin-bottom: 12px; }
  .prp-toolbar-r { display: flex; gap: 10px; }
  .prp-btn { font: inherit; font-size: 13px; font-weight: 600; padding: 8px 16px; border-radius: 8px; border: 1px solid #d8d2c4; background: #fff; color: #2a2a2a; cursor: pointer; }
  .prp-btn:disabled { opacity: 0.5; cursor: default; }
  .prp-btn-primary { background: #1e2d3d; border-color: #1e2d3d; color: #fff; }

  .prp-sheet { background: #fff; color: #1a1a1a; padding: 0.75in; border-radius: 6px; font-family: Helvetica, Arial, sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .prp-err { padding: 40px; text-align: center; color: #b3261e; }
  .prp-head { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2.5px solid #1a1a1a; padding-bottom: 16px; margin-bottom: 22px; }
  .prp-co { font-size: 22px; font-weight: 700; letter-spacing: 0.02em; }
  .prp-co-sub { font-size: 12px; color: #666; margin-top: 5px; letter-spacing: 0.01em; }
  .prp-doctype { text-align: right; }
  .prp-doctype-main { font-size: 14px; font-weight: 700; letter-spacing: 0.12em; }
  .prp-prnum { font-size: 13px; color: #555; margin-top: 6px; letter-spacing: 0.03em; }

  .prp-meta { display: flex; flex-wrap: wrap; gap: 14px 40px; margin-bottom: 26px; }
  .prp-metaitem-wide { flex: 1 1 100%; }
  .prp-meta-l { font-size: 9.5px; text-transform: uppercase; letter-spacing: 0.08em; color: #999; margin-bottom: 3px; }
  .prp-meta-v { font-size: 14px; font-weight: 700; color: #1a1a1a; }

  .prp-table { width: 100%; border-collapse: collapse; font-size: 13px; }
  .prp-table th { text-align: left; font-size: 9.5px; text-transform: uppercase; letter-spacing: 0.07em; color: #444; border-bottom: 2px solid #1a1a1a; padding: 8px 10px; }
  .prp-table td { padding: 10px; border-bottom: 1px solid #e6e6e6; vertical-align: top; }
  .prp-zebra { background: #f5f5f5; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .prp-c-fam { font-weight: 700; font-size: 13.5px; width: 30%; }
  .prp-c-item { width: 58%; line-height: 1.5; }
  .prp-c-fam2 { font-weight: 700; font-size: 13px; width: 18%; }
  .prp-c-color { width: 13%; }
  .prp-c-type { width: 9%; }
  .prp-c-size { width: 20%; white-space: nowrap; }
  .prp-mono { font-family: 'Courier New', monospace; font-size: 12.5px; }
  .prp-attach { font-size: 10.5px; color: #777; margin-top: 2px; }
  .prp-attach-warn { color: #b3261e; font-weight: 700; text-transform: uppercase; letter-spacing: 0.03em; }
  .prp-c-qty { text-align: center; width: 56px; }
  .prp-empty-row { text-align: center; color: #999; padding: 22px; }
  .prp-total-l { text-align: right; font-weight: 700; border-top: 2px solid #1a1a1a; padding-top: 9px; }
  .prp-table tfoot td { border-bottom: none; }
  .prp-table tfoot .prp-c-qty { border-top: 2px solid #1a1a1a; padding-top: 9px; font-weight: 700; }

  .prp-notesblock { margin-top: 20px; font-size: 12.5px; color: #333; line-height: 1.5; }
  .prp-notesblock-l { font-weight: 700; }

  .prp-auth { margin-top: 56px; padding-top: 10px; border-top: 1px solid #1a1a1a; width: 320px; }
  .prp-auth-row { display: flex; align-items: baseline; gap: 8px; }
  .prp-auth-l { font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: #888; }
  .prp-auth-name { font-size: 17px; font-weight: 700; color: #1a1a1a; }
  .prp-auth-date { font-size: 12px; color: #666; margin-top: 4px; }

  .prp-footer { margin-top: 34px; text-align: center; font-size: 10px; color: #aaa; letter-spacing: 0.03em; }

  @media print {
    @page { size: letter; margin: 0.75in; }
    .prp-overlay { position: static; background: #fff; padding: 0; display: block; }
    .prp-shell { width: 100%; }
    .prp-toolbar { display: none; }
    .prp-sheet { box-shadow: none; border-radius: 0; padding: 0; }
  }
`
