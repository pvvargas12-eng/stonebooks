// =============================================================================
// prSheet — the vendor sheet for a purchase request: row order, the structured
// cells (capitals on every line) and the jsPDF builder. Shared by the print
// view (StonePRPrint) and the vendor email (PREmailModal).
// =============================================================================
import { isBaseSpec } from './prSpec'
import { prKind } from './prKinds'

export const fmtDate = (d) => {
  if (!d) return '—'
  const dt = new Date(String(d).slice(0, 10) + 'T00:00:00')
  return isNaN(dt) ? String(d) : dt.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
}

// jsPDF Helvetica is WinAnsi — map prime/smart-quote/dash/nbsp glyphs to ASCII so
// text measures + wraps correctly (× and · are WinAnsi-safe, left as-is).
const pdfSafe = (s) => String(s ?? '')
  .replace(/[″“”]/g, '"')
  .replace(/[′‘’]/g, "'")
  .replace(/[–—]/g, '-')

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
export function orderedRowsOf(items, lineSpec) {
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

export function parseCreatedBy(notes) {
  const raw = notes || ''
  const m = raw.match(/(?:^|·\s*)Created by (.+)$/)
  const createdBy = m ? m[1].trim() : null
  const prNotes = createdBy ? raw.replace(/\s*·?\s*Created by .+$/, '').trim() : raw
  return { createdBy, prNotes }
}

// Structured vendor-sheet cells (Paul's columns: Color · Type · Size · Specs).
// New lines carry item_type/specs directly; legacy lines derive Type from the
// resolved spec and fall back to top/sides (or the whole resolved spec when the
// line has no stored size).
export function structuredOf(it, lineSpec) {
  const isStock = !!it.is_stock || String(it.family_name || '').trim().toLowerCase() === 'stock'
  // The vendor sheet reads in capitals on every line (Paul 2026-11-17), however
  // the line was typed. Print and PDF both go through here.
  const up = (s) => String(s ?? '').toUpperCase()
  return {
    family: isStock ? 'STOCK' : up(it.family_name || '—'),
    isStock,
    color: up(it.color || '—'),
    type: up(it.item_type || (isStock ? 'Stock' : isBaseSpec(lineSpec[it.id]) ? 'Base' : 'Die')),
    size: up(it.size || '—'),
    specs: up(it.specs || it.spec_text || [it.top, it.sides].filter(Boolean).join('; ') || (!it.size ? (lineSpec[it.id] || '—') : '—')),
  }
}

// ── Real PDF (letter, jsPDF manual layout, single Helvetica face) ─────────────
// Returns the jsPDF doc + its file name; the caller saves it or attaches it
// to the vendor email (PREmailModal).
export async function buildPRPdf(o, items, lineSpec, kind = 'stone', attach = {}) {
  const K = prKind(kind)
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

  const LH = 13
  const qtyCX = kind === 'stone' ? 540 : 536
  if (kind === 'stone') {
    // Paul's vendor-sheet columns: Family · Color · Type · Size · Specs · Qty.
    const famX = M, colorX = 148, typeX = 224, sizeX = 272, specX = 390
    const drawHeader = () => {
      doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(60)
      doc.text('FAMILY NAME', famX, y); doc.text('COLOR', colorX, y); doc.text('TYPE', typeX, y)
      doc.text('SIZE', sizeX, y); doc.text('SPECS', specX, y)
      doc.text('QTY', qtyCX, y, { align: 'center' })
      y += 6
      doc.setDrawColor(20); doc.setLineWidth(1.2); doc.line(M, y, RIGHT, y)
      y += 12
    }
    drawHeader()
    rowsArr.forEach((it, idx) => {
      const s = structuredOf(it, lineSpec)
      const famLines = doc.splitTextToSize(pdfSafe(s.family), colorX - famX - 8)
      const colorLines = doc.splitTextToSize(pdfSafe(s.color), typeX - colorX - 8)
      const sizeLines = doc.splitTextToSize(pdfSafe(s.size), specX - sizeX - 8)
      const specLines = doc.splitTextToSize(pdfSafe(s.specs), qtyCX - 22 - specX)
      const rows = Math.max(famLines.length, colorLines.length, sizeLines.length, specLines.length, 1)
      const rowH = rows * LH + 8
      if (y + rowH > PH - M - 80) { doc.addPage(); y = M; drawHeader() }
      if (idx % 2 === 1) { doc.setFillColor(245, 245, 245); doc.rect(M - 6, y - 2, (RIGHT - M) + 12, rowH, 'F') }
      const ty = y + 12
      doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(20)
      famLines.forEach((ln, k) => doc.text(ln, famX, ty + k * LH))
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(30)
      colorLines.forEach((ln, k) => doc.text(ln, colorX, ty + k * LH))
      doc.text(pdfSafe(s.type), typeX, ty)
      sizeLines.forEach((ln, k) => doc.text(ln, sizeX, ty + k * LH))
      specLines.forEach((ln, k) => doc.text(ln, specX, ty + k * LH))
      doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(20)
      doc.text(String(it.quantity ?? 1), qtyCX, ty, { align: 'center' })
      y += rowH
      doc.setDrawColor(228); doc.setLineWidth(0.5); doc.line(M, y, RIGHT, y)
    })
  } else {
    // Photo / etching keep the single Item column.
    const famX = M, itemX = 188
    const itemW = qtyCX - 40 - itemX
    const drawHeader = () => {
      doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(60)
      doc.text('FAMILY NAME', famX, y); doc.text(K.itemHeader.toUpperCase(), itemX, y)
      doc.text('QTY', qtyCX, y, { align: 'center' })
      y += 6
      doc.setDrawColor(20); doc.setLineWidth(1.2); doc.line(M, y, RIGHT, y)
      y += 12
    }
    drawHeader()
    rowsArr.forEach((it, idx) => {
      const itemLines = doc.splitTextToSize(pdfSafe(lineSpec[it.id] || '—'), itemW)
      const att = attach[it.id] || ''
      const famLines = doc.splitTextToSize(pdfSafe(it.family_name || '—'), itemX - famX - 8)
      const rows = Math.max(itemLines.length + (att ? 1 : 0), famLines.length, 1)
      const rowH = rows * LH + 8
      if (y + rowH > PH - M - 80) { doc.addPage(); y = M; drawHeader() }
      if (idx % 2 === 1) { doc.setFillColor(245, 245, 245); doc.rect(M - 6, y - 2, (RIGHT - M) + 12, rowH, 'F') }
      const ty = y + 4
      doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5); doc.setTextColor(20)
      famLines.forEach((ln, k) => doc.text(ln, famX, ty + 8 + k * LH))
      doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(30)
      itemLines.forEach((ln, k) => doc.text(ln, itemX, ty + 8 + k * LH))
      if (att) {
        const awaiting = /awaiting/i.test(att)
        doc.setFont('helvetica', awaiting ? 'bold' : 'normal'); doc.setFontSize(8.5)
        doc.setTextColor(awaiting ? 179 : 110, awaiting ? 38 : 110, awaiting ? 30 : 110)
        doc.text(pdfSafe(att), itemX, ty + 8 + itemLines.length * LH)
      }
      doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(20)
      doc.text(String(it.quantity ?? 1), qtyCX, ty + 8, { align: 'center' })
      y += rowH
      doc.setDrawColor(228); doc.setLineWidth(0.5); doc.line(M, y, RIGHT, y)
    })
  }

  // Total
  y += 16
  const totalQty = items.reduce((s, it) => s + (Number(it.quantity) || 0), 0)
  doc.setDrawColor(20); doc.setLineWidth(1.2); doc.line(qtyCX - 110, y - 8, RIGHT, y - 8)
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(20)
  doc.text('Total pieces', qtyCX - 30, y + 4, { align: 'right' })
  doc.text(String(totalQty), qtyCX, y + 4, { align: 'center' })
  y += 26

  if (prNotes) {
    const nl = doc.splitTextToSize(pdfSafe(`Notes: ${prNotes}`), RIGHT - M)
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

  return { doc, filename: `${o.po_number || 'purchase-request'}.pdf` }
}
