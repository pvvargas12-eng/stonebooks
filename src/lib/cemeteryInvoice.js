// =============================================================================
// Cemetery invoice — the ONE-PAGE black-and-white bill to the cemetery
// (CEM-INVOICE, Paul 2026-11-09: "a 1 page black and white Invoice to send to
// the cemetery, the email on file is who it will go to").
// =============================================================================
// buildCemeteryInvoicePdf(order, { paidTotal }) → { doc, filename, totals }
//   Letter, jsPDF (CDN, shared window.jspdf with the receipts). One row per
//   door (# · crypt / name · work · amount); a door's additional charges print
//   INDENTED under it; order-level custom charges sit in the totals block.
//   Always one page: the row pitch and type size step down together until the
//   table fits above the footer.
// buildCemeteryInvoiceEmail(order, totals, { balance }) → { to, subject, html, text }
// Ink doctrine: no solid fills, hairlines only (see [[pdf-style-rules]]).
// =============================================================================
import { cemeteryOrderTotals, getDoorPrice, doorExtrasTotal } from './stonebooksData'

export const INVOICE_COMPANY = {
  name: 'SHEVCHENKO MONUMENTS, LLC.',
  estd: 'FAMILY-OWNED SINCE 1919',
  addr: '329 S Florida Grove Rd  ·  Perth Amboy, NJ 08861',
  phone: '732-442-1286',
  email: 'shevcoteam@gmail.com',
  terms: 'Due upon receipt',
}

const keyOf = (s) => (typeof s === 'string' ? s : s?.key)
const money = (n) => `$${(Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const longDate = (iso) => {
  const d = iso ? new Date(iso) : new Date()
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
}
// iPad / phone typed text can carry unicode spaces that jsPDF renders as byte
// soup (the Colburn contract) — normalize before every doc.text.
const clean = (s) => String(s ?? '').replace(/[\u00A0\u2000-\u200B\u202F\u205F\u3000]/g, ' ').replace(/\s+/g, ' ').trim()

let _jsPDFPromise = null
function loadJsPDF() {
  if (typeof window === 'undefined') return Promise.reject(new Error('PDF needs a browser.'))
  if (window.jspdf?.jsPDF) return Promise.resolve(window.jspdf.jsPDF)
  if (_jsPDFPromise) return _jsPDFPromise
  _jsPDFPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js'
    s.onload = () => (window.jspdf?.jsPDF ? resolve(window.jspdf.jsPDF) : reject(new Error('PDF library did not load.')))
    s.onerror = () => reject(new Error('Could not load the PDF library.'))
    document.head.appendChild(s)
  })
  return _jsPDFPromise
}

// The invoice's view of a door: the name as typed, the work words, the amount,
// and the indented extras.
export function invoiceDoorRows(order) {
  const { pricing } = cemeteryOrderTotals(order)
  const isSplit = pricing?.type === 'indoor_outdoor_split'
  const doors = Array.isArray(order?.doors) ? order.doors : []
  return doors.map((d, i) => {
    const map = isSplit ? (d.location ? (pricing[d.location] || {}) : {}) : (pricing?.items || {})
    const items = pricing?.type === 'custom'
      ? (d.customLineItems || []).map(li => clean(li.label || 'Custom item'))
      : (d.selectedItems || []).map(s => clean(map[keyOf(s)]?.label || keyOf(s)))
    const firstLine = clean((d.inscriptionText || '').split(/\r?\n/)[0])
    return {
      n: i + 1,
      name: firstLine || `Door ${i + 1}`,
      location: isSplit && d.location ? d.location : null,
      work: items.join(', ') || '—',
      amount: getDoorPrice(d, pricing),
      base: getDoorPrice(d, pricing) - doorExtrasTotal(d),
      extras: (d.extras || []).filter(x => clean(x?.label) || Number(x?.price)).map(x => ({ label: clean(x.label) || 'Additional charge', price: Number(x.price) || 0 })),
    }
  })
}

export function cemeteryInvoiceFilename(order) {
  return `Invoice ${order?.order_number || 'DRAFT'} - ${clean(order?.cemetery_name || 'Cemetery').replace(/[\\/:*?"<>|]/g, '')}.pdf`
}

export async function buildCemeteryInvoicePdf(order, { paidTotal = 0, invoiceDate = null } = {}) {
  const JsPDF = await loadJsPDF()
  const doc = new JsPDF({ unit: 'mm', format: 'letter' })
  const W = 215.9, H = 279.4, M = 16
  const R = W - M
  const totals = cemeteryOrderTotals(order)
  const rows = invoiceDoorRows(order)
  const paid = Math.round((Number(paidTotal) || 0) * 100) / 100
  const balance = Math.max(0, Math.round((totals.total - paid) * 100) / 100)
  const num = order?.order_number || 'DRAFT'
  const ink = () => doc.setTextColor(17, 17, 17)
  const dim = () => doc.setTextColor(85, 85, 85)
  const faint = () => doc.setTextColor(135, 135, 135)

  // ── letterhead ─────────────────────────────────────────────────────────
  let y = 20
  doc.setFont('helvetica', 'bold'); doc.setFontSize(15); ink()
  doc.text(INVOICE_COMPANY.name, M, y)
  doc.setFont('helvetica', 'bold'); doc.setFontSize(7); dim(); doc.setCharSpace?.(0.6)
  doc.text(INVOICE_COMPANY.estd, M, y + 4.6)
  doc.setCharSpace?.(0)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); dim()
  doc.text(INVOICE_COMPANY.addr, M, y + 10.2)
  doc.text(`${INVOICE_COMPANY.phone}  ·  ${INVOICE_COMPANY.email}`, M, y + 14.4)

  doc.setFont('helvetica', 'bold'); doc.setFontSize(10); ink(); doc.setCharSpace?.(1.2)
  doc.text('INVOICE', R, y, { align: 'right' })
  doc.setCharSpace?.(0)
  doc.setFont('courier', 'bold'); doc.setFontSize(16)
  doc.text(num, R, y + 7, { align: 'right' })
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5)
  const meta = [
    ['Invoice date', longDate(invoiceDate)],
    ['Order submitted', longDate(order?.submitted_at || order?.created_at)],
    ['Terms', INVOICE_COMPANY.terms],
  ]
  let my = y + 12.4
  for (const [k, v] of meta) {
    dim(); doc.text(`${k}  `, R - doc.getTextWidth(v) - 1, my, { align: 'right' })
    ink(); doc.setFont('helvetica', 'bold'); doc.text(v, R, my, { align: 'right' }); doc.setFont('helvetica', 'normal')
    my += 4.2
  }
  y = Math.max(y + 18, my) + 3
  doc.setDrawColor(17, 17, 17); doc.setLineWidth(0.6); doc.line(M, y, R, y)

  // ── bill to / for ──────────────────────────────────────────────────────
  y += 8
  const colW = (R - M) / 2 - 6
  const label = (t, x, yy) => { doc.setFont('helvetica', 'bold'); doc.setFontSize(6.8); faint(); doc.setCharSpace?.(0.5); doc.text(t, x, yy); doc.setCharSpace?.(0) }
  label('BILL TO', M, y)
  label('FOR', M + colW + 12, y)
  y += 4.6
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5); ink()
  const cemName = doc.splitTextToSize(clean(order?.cemetery_name || 'Cemetery'), colW)
  doc.text(cemName, M, y)
  const forTitle = doc.splitTextToSize(`Mausoleum door work  ·  ${rows.length} door${rows.length === 1 ? '' : 's'}`, colW)
  doc.text(forTitle, M + colW + 12, y)
  let ly = y + cemName.length * 4.6
  let ry = y + forTitle.length * 4.6
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.8); dim()
  const billLines = [
    order?.cemetery_contact_name ? `Attn: ${clean(order.cemetery_contact_name)}` : null,
    order?.cemetery_contact_email ? clean(order.cemetery_contact_email) : null,
    order?.cemetery_contact_phone ? fmtPhone(order.cemetery_contact_phone) : null,
  ].filter(Boolean)
  for (const l of billLines) { doc.text(doc.splitTextToSize(l, colW), M, ly); ly += 4.3 }
  const schedule = totals.pricing?.key === 'CUSTOM' || totals.pricing?.key === 'CUSTOM_SNAPSHOT'
    ? 'Priced from the agreed schedule for this cemetery'
    : `Priced from the ${clean(totals.pricing?.label || order?.cemetery_name)} schedule`
  for (const l of [schedule, `Shevchenko order ${num}`]) { doc.text(doc.splitTextToSize(l, colW), M + colW + 12, ry); ry += 4.3 }
  y = Math.max(ly, ry) + 5

  // ── the table — sized to fit ONE page ──────────────────────────────────
  // Reserve the bottom for totals + footer, then shrink the row pitch (and
  // the type with it) until every door and extra fits above that line.
  const totalsLines = 3 + totals.extraCharges.length + (totals.tax ? 1 : 0) + (totals.cc ? 1 : 0)
  const totalsH = 6 + totalsLines * 5.4 + 10
  const footerH = 30
  const tableTop = y
  const tableBottom = H - M - footerH - totalsH
  const avail = tableBottom - tableTop - 9
  const baseRow = 6.4, baseExtra = 4.6
  // A door with extras also carries its own "Door N total" line.
  const need = rows.length * baseRow + rows.reduce((s, r) => s + (r.extras.length ? (r.extras.length + 1) * baseExtra : 0), 0)
  // k = 1 is the comfortable pitch; 0.42 still reads (about 5.6pt) and holds a
  // 50-door order with extras on the one page.
  const k = Math.max(0.42, Math.min(1, avail / Math.max(need, 1)))
  const rowH = baseRow * k, extraH = baseExtra * k
  const fs = Math.max(5.6, 9.4 * k), fsx = Math.max(5, 8.2 * k)

  const xN = M, xName = M + 10, xAmt = R
  const xWork = M + (R - M) * 0.52
  const nameW = xWork - xName - 4
  const workW = xAmt - xWork - 28

  doc.setFont('helvetica', 'bold'); doc.setFontSize(6.8); faint(); doc.setCharSpace?.(0.5)
  doc.text('#', xN, y); doc.text('CRYPT / NAME', xName, y); doc.text('WORK', xWork, y); doc.text('AMOUNT', xAmt, y, { align: 'right' })
  doc.setCharSpace?.(0)
  y += 1.8
  doc.setDrawColor(17, 17, 17); doc.setLineWidth(0.45); doc.line(M, y, R, y)
  y += rowH * 0.8

  for (const r of rows) {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(fs)
    faint(); doc.text(String(r.n), xN, y)
    ink(); doc.setFont('helvetica', 'bold')
    const nm = doc.splitTextToSize(r.name + (r.location ? `  (${r.location})` : ''), nameW)
    doc.text(nm[0] + (nm.length > 1 ? '…' : ''), xName, y)
    doc.setFont('helvetica', 'normal'); doc.setTextColor(51, 51, 51)
    const wk = doc.splitTextToSize(r.work, workW)
    doc.text(wk[0] + (wk.length > 1 ? '…' : ''), xWork, y)
    doc.setFont('courier', 'normal'); ink()
    doc.text(money(r.extras.length ? r.base : r.amount), xAmt, y, { align: 'right' })
    // Additional charges: indented under the door, then the door's own total.
    for (const x of r.extras) {
      y += extraH
      doc.setFont('helvetica', 'italic'); doc.setFontSize(fsx); dim()
      const xl = doc.splitTextToSize(`+ ${x.label}`, xAmt - xName - 40)
      doc.text(xl[0] + (xl.length > 1 ? '…' : ''), xName + 4, y)
      doc.setFont('courier', 'normal')
      doc.text(money(x.price), xAmt, y, { align: 'right' })
    }
    if (r.extras.length) {
      y += extraH
      doc.setFont('helvetica', 'normal'); doc.setFontSize(fsx); faint()
      doc.text(`Door ${r.n} total`, xAmt - 30, y, { align: 'right' })
      doc.setFont('courier', 'bold'); ink(); doc.text(money(r.amount), xAmt, y, { align: 'right' })
    }
    // One hairline under the whole door block, never between a door and its charges.
    const sep = y + rowH * 0.38
    doc.setDrawColor(212, 212, 212); doc.setLineWidth(0.2); doc.line(M, sep, R, sep)
    y = sep + rowH * 0.62
  }

  // ── totals — right after the table (the footer stays at the bottom) ────
  let ty = y + 4
  const tx0 = R - 96, tx1 = R
  const trow = (k2, v, { bold = false, size = 9, muted = false, wrapW = 66 } = {}) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal'); doc.setFontSize(size); muted ? dim() : ink()
    const lines = doc.splitTextToSize(k2, wrapW).slice(0, 2)
    doc.text(lines[0], tx0, ty)
    doc.setFont('courier', bold ? 'bold' : 'normal'); doc.text(v, tx1, ty, { align: 'right' })
    if (lines[1]) { ty += 3.8; doc.setFont('helvetica', 'normal'); doc.setFontSize(size - 0.5); doc.text(lines[1] + (doc.splitTextToSize(k2, wrapW).length > 2 ? '…' : ''), tx0, ty) }
    ty += 5.4
  }
  trow(`Subtotal  ·  ${rows.length} door${rows.length === 1 ? '' : 's'}`, money(totals.doorsTotal), { muted: true })
  for (const x of totals.extraCharges) {
    trow(clean(x.label) || 'Custom charge', money(x.price), { muted: true })
  }
  if (totals.tax) trow('NJ sales tax (6.625%)', money(totals.tax), { muted: true })
  if (totals.cc) trow('Credit card fee (3%)', money(totals.cc), { muted: true })
  doc.setDrawColor(17, 17, 17); doc.setLineWidth(0.45); doc.line(tx0, ty - 3.6, tx1, ty - 3.6)
  ty += 0.4
  trow('Total', money(totals.total), { bold: true, size: 10 })
  trow('Paid to date', money(paid), { muted: true })
  doc.setLineWidth(0.5); doc.rect(tx0 - 3, ty - 4.2, tx1 - tx0 + 6, 7.6)
  ty += 0.8
  trow('Balance due', money(balance), { bold: true, size: 11 })

  // ── footer — pinned to the bottom, but never under the totals ──────────
  let fy = Math.max(H - M - footerH + 4, ty + 5)
  doc.setDrawColor(150, 150, 150); doc.setLineWidth(0.25); doc.line(M, fy - 4, R, fy - 4)
  label('HOW TO PAY', M, fy); label('QUESTIONS', M + colW + 12, fy)
  fy += 4.4
  doc.setFontSize(8); doc.setFont('helvetica', 'normal'); dim()
  const payLines = [
    ['Check', ` payable to Shevchenko Monuments, LLC  ·  mail or deliver to 329 S Florida Grove Rd, Perth Amboy, NJ 08861`],
    ['Zelle', ` to shevcoteam@gmail.com  ·  put ${num} in the memo`],
    ['Credit card', ` by phone at 732-442-1286 (3% card fee applies)`],
  ]
  let py = fy
  for (const [b, rest] of payLines) {
    doc.setFont('helvetica', 'bold'); ink(); doc.text(b, M, py)
    const bw = doc.getTextWidth(b)
    doc.setFont('helvetica', 'normal'); dim()
    const lines = doc.splitTextToSize(rest, colW - bw)
    doc.text(lines, M + bw, py)
    py += 3.9 * lines.length
  }
  doc.setFont('helvetica', 'italic'); faint()
  doc.text('Thank you for your business. Please reference the invoice number with your payment.', M, py + 1.2)
  doc.setFont('helvetica', 'normal'); dim()
  doc.text(`Shevchenko Monuments  ·  ${INVOICE_COMPANY.phone}  ·  ${INVOICE_COMPANY.email}`, M + colW + 12, fy)
  doc.text('Monday to Friday, 8:00 to 4:30', M + colW + 12, fy + 3.9)
  doc.setFontSize(6.5); faint(); doc.setCharSpace?.(0.5)
  doc.text('PAGE 1 OF 1', R, H - 9, { align: 'right' })
  doc.setCharSpace?.(0)

  return { doc, filename: cemeteryInvoiceFilename(order), totals, balance, paid }
}

export function fmtPhone(raw) {
  const d = String(raw || '').replace(/\D/g, '')
  if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`
  if (d.length === 11 && d[0] === '1') return fmtPhone(d.slice(1))
  return clean(raw)
}

// The email that carries the PDF. Plain, short, the money in the body too.
export function buildCemeteryInvoiceEmail(order, totals, { balance = null, paid = 0 } = {}) {
  const num = order?.order_number || 'DRAFT'
  const cem = clean(order?.cemetery_name || 'Cemetery')
  const who = clean(order?.cemetery_contact_name)
  const first = who ? who.split(' ')[0] : ''
  const due = balance == null ? totals.total : balance
  const doors = (order?.doors || []).length
  const greet = first ? `Hello ${first},` : 'Hello,'
  const text =
`${greet}

Attached is invoice ${num} from Shevchenko Monuments for the mausoleum door work at ${cem} (${doors} door${doors === 1 ? '' : 's'}).

Total ${money(totals.total)}${paid ? `  ·  Paid to date ${money(paid)}` : ''}
Balance due ${money(due)}

Pay by check to Shevchenko Monuments, LLC (329 S Florida Grove Rd, Perth Amboy, NJ 08861), by Zelle to shevcoteam@gmail.com with ${num} in the memo, or by card over the phone at 732-442-1286 (3% card fee).

Thank you,
Shevchenko Monuments
732-442-1286 · shevcoteam@gmail.com`
  const html =
    `<div style="font-family:Arial,sans-serif;font-size:15px;color:#17202a;line-height:1.55">` +
    `<p style="margin:0 0 12px">${greet}</p>` +
    `<p style="margin:0 0 12px">Attached is invoice <b>${num}</b> from Shevchenko Monuments for the mausoleum door work at <b>${cem}</b> (${doors} door${doors === 1 ? '' : 's'}).</p>` +
    `<table style="border-collapse:collapse;font-size:15px;margin:0 0 14px">` +
    `<tr><td style="padding:3px 18px 3px 0;color:#555">Total</td><td style="padding:3px 0;text-align:right"><b>${money(totals.total)}</b></td></tr>` +
    (paid ? `<tr><td style="padding:3px 18px 3px 0;color:#555">Paid to date</td><td style="padding:3px 0;text-align:right">${money(paid)}</td></tr>` : '') +
    `<tr><td style="padding:3px 18px 3px 0;color:#555">Balance due</td><td style="padding:3px 0;text-align:right;color:#b3261e"><b>${money(due)}</b></td></tr>` +
    `</table>` +
    `<p style="margin:0 0 12px;color:#333">Pay by <b>check</b> to Shevchenko Monuments, LLC (329 S Florida Grove Rd, Perth Amboy, NJ 08861), by <b>Zelle</b> to shevcoteam@gmail.com with <b>${num}</b> in the memo, or by <b>card</b> over the phone at 732-442-1286 (3% card fee).</p>` +
    `<p style="margin:0">Thank you,<br>Shevchenko Monuments<br><span style="color:#555">732-442-1286 · shevcoteam@gmail.com</span></p>` +
    `</div>`
  return {
    to: clean(order?.cemetery_contact_email || ''),
    subject: `Invoice ${num} — ${cem} — Shevchenko Monuments`,
    html,
    text,
  }
}
