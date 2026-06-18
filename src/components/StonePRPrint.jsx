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
import { resolvePRLineSpecs, isBaseSpec } from '../lib/prSpec'

const fmtDate = (d) => {
  if (!d) return '—'
  const dt = new Date(String(d).slice(0, 10) + 'T00:00:00')
  return isNaN(dt) ? String(d) : dt.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
}

// Lazy-load jsPDF from CDN (no npm dep — same pattern as the SalesMode PDFs).
let _jsPDFPromise = null
function loadJsPDF() {
  if (window.jspdf?.jsPDF) return Promise.resolve(window.jspdf.jsPDF)
  if (_jsPDFPromise) return _jsPDFPromise
  _jsPDFPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js'
    script.async = true
    script.onload = () => { window.jspdf?.jsPDF ? resolve(window.jspdf.jsPDF) : reject(new Error('jsPDF global missing')) }
    script.onerror = () => { _jsPDFPromise = null; reject(new Error('Failed to load jsPDF from CDN')) }
    document.head.appendChild(script)
  })
  return _jsPDFPromise
}

// Flat ordered rows: grouped by family (first-seen order), die before base within a
// family. Family shows on EVERY row. Shared by the on-screen sheet and the PDF, so
// zebra striping is a simple alternating row index.
function orderedRowsOf(items, lineSpec) {
  const groups = []
  const byFam = new Map()
  for (const it of items) {
    const f = it.family_name || '—'
    if (!byFam.has(f)) { byFam.set(f, []); groups.push(f) }
    byFam.get(f).push(it)
  }
  for (const f of groups) byFam.get(f).sort((a, b) => (isBaseSpec(lineSpec[a.id]) ? 1 : 0) - (isBaseSpec(lineSpec[b.id]) ? 1 : 0))
  return groups.flatMap(f => byFam.get(f))
}

function parseCreatedBy(notes) {
  const raw = notes || ''
  const m = raw.match(/(?:^|·\s*)Created by (.+)$/)
  const createdBy = m ? m[1].trim() : null
  const prNotes = createdBy ? raw.replace(/\s*·?\s*Created by .+$/, '').trim() : raw
  return { createdBy, prNotes }
}

// ── Real PDF (letter, jsPDF manual layout, single Helvetica face) ─────────────
async function generatePRPdf(o, items, lineSpec) {
  const JsPDF = await loadJsPDF()
  const doc = new JsPDF({ unit: 'pt', format: 'letter' })   // 612 × 792 pt
  const PW = 612, PH = 792, M = 54
  const RIGHT = PW - M
  const { createdBy, prNotes } = parseCreatedBy(o.notes)
  const rowsArr = orderedRowsOf(items, lineSpec)

  let y = M
  // Letterhead
  doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.setTextColor(20)
  doc.text('SHEVCHENKO MONUMENTS LLC', M, y + 4)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(110)
  doc.text('Perth Amboy, New Jersey · Established 1919', M, y + 18)
  doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(20)
  doc.text('PURCHASE REQUEST', RIGHT, y + 2, { align: 'right' })
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(70)
  doc.text(o.po_number || '', RIGHT, y + 16, { align: 'right' })
  y += 30
  doc.setDrawColor(20); doc.setLineWidth(1.4); doc.line(M, y, RIGHT, y)
  y += 22

  // Meta
  const meta = [['Vendor', o.supplier_name || '—'], ['Date', fmtDate(o.placed_at)], ['Requested Delivery', fmtDate(o.supplier_eta)], ['Created By', createdBy || '—']]
  let mx = M
  for (const [lab, val] of meta) {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(150)
    doc.text(lab.toUpperCase(), mx, y)
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(20)
    doc.text(String(val), mx, y + 13)
    mx += lab === 'Vendor' ? 150 : 130
  }
  y += 34

  // Table columns — Family · Item · Qty (no Notes)
  const famX = M, itemX = 188, qtyCX = 536
  const itemW = qtyCX - 40 - itemX
  const drawHeader = () => {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(60)
    doc.text('FAMILY NAME', famX, y); doc.text('ITEM', itemX, y)
    doc.text('QTY', qtyCX, y, { align: 'center' })
    y += 6
    doc.setDrawColor(20); doc.setLineWidth(1.2); doc.line(M, y, RIGHT, y)
    y += 12
  }
  drawHeader()

  const LH = 13
  rowsArr.forEach((it, idx) => {
    const itemLines = doc.splitTextToSize(lineSpec[it.id] || '—', itemW)
    const famLines = doc.splitTextToSize(it.family_name || '—', itemX - famX - 8)
    const rows = Math.max(itemLines.length, famLines.length, 1)
    const rowH = rows * LH + 8
    if (y + rowH > PH - M - 80) { doc.addPage(); y = M; drawHeader() }
    if (idx % 2 === 1) { doc.setFillColor(245, 245, 245); doc.rect(M - 6, y - 2, (RIGHT - M) + 12, rowH, 'F') }
    const ty = y + 4
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5); doc.setTextColor(20)
    famLines.forEach((ln, k) => doc.text(ln, famX, ty + 8 + k * LH))
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(30)
    itemLines.forEach((ln, k) => doc.text(ln, itemX, ty + 8 + k * LH))
    doc.setFont('helvetica', 'bold'); doc.setTextColor(20)
    doc.text(String(it.quantity ?? 1), qtyCX, ty + 8, { align: 'center' })
    y += rowH
    doc.setDrawColor(228); doc.setLineWidth(0.5); doc.line(M, y, RIGHT, y)
  })

  // Total
  y += 16
  const totalQty = items.reduce((s, it) => s + (Number(it.quantity) || 0), 0)
  doc.setDrawColor(20); doc.setLineWidth(1.2); doc.line(qtyCX - 110, y - 8, RIGHT, y - 8)
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(20)
  doc.text('Total pieces', qtyCX - 30, y + 4, { align: 'right' })
  doc.text(String(totalQty), qtyCX, y + 4, { align: 'center' })
  y += 26

  if (prNotes) {
    const nl = doc.splitTextToSize(`Notes: ${prNotes}`, RIGHT - M)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(60)
    nl.forEach((ln, k) => doc.text(ln, M, y + k * 13)); y += nl.length * 13 + 8
  }

  // Authorized
  y = Math.max(y + 30, PH - M - 56)
  doc.setDrawColor(20); doc.setLineWidth(0.8); doc.line(M, y, M + 240, y)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(140)
  doc.text('AUTHORIZED BY', M, y + 14)
  doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.setTextColor(20)
  doc.text('Lionel P. Vargas', M + 96, y + 15)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(110)
  doc.text(fmtDate(o.created_at || o.placed_at), M, y + 30)

  doc.save(`${o.po_number || 'purchase-request'}.pdf`)
}

export default function StonePRPrint({ bulkOrderId, onClose }) {
  const [state, setState] = useState({ loading: true })
  const [pdfBusy, setPdfBusy] = useState(false)

  useEffect(() => {
    let alive = true
    ;(async () => {
      const r = await getBulkOrderWithItems(bulkOrderId)
      if (!alive) return
      if (!r.ok) { setState({ loading: false, ok: false, error: r.error }); return }
      const items = r.items || []
      const { lineSpec } = await resolvePRLineSpecs(items)
      if (alive) setState({ loading: false, ok: true, order: r.order, items, lineSpec })
    })().catch(e => { if (alive) setState({ loading: false, ok: false, error: String(e?.message || e) }) })
    return () => { alive = false }
  }, [bulkOrderId])

  const downloadPdf = async () => {
    if (pdfBusy || !state.ok) return
    setPdfBusy(true)
    try { await generatePRPdf(state.order || {}, state.items || [], state.lineSpec || {}) }
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

          <table className="prp-table">
            <thead>
              <tr>
                <th className="prp-c-fam">Family Name</th>
                <th className="prp-c-item">Item</th>
                <th className="prp-c-qty">Qty</th>
              </tr>
            </thead>
            <tbody>
              {rowsArr.length === 0 && <tr><td colSpan={3} className="prp-empty-row">No line items.</td></tr>}
              {rowsArr.map((it, idx) => (
                <tr key={it.id || idx} className={idx % 2 === 1 ? 'prp-zebra' : ''}>
                  <td className="prp-c-fam">{it.family_name || '—'}</td>
                  <td className="prp-c-item">{lineSpec[it.id] || '—'}</td>
                  <td className="prp-c-qty">{it.quantity ?? 1}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr><td className="prp-total-l">Total pieces</td><td /><td className="prp-c-qty">{totalQty}</td></tr>
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
