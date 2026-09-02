// =============================================================================
// acctData — Stonebooks Accounting data layer (ACCT-1, 2026-09-01)
// =============================================================================
// One expense book (acct_expenses) + one document cabinet (acct_documents),
// files in the pre-existing PRIVATE `receipts` bucket (signed URLs only).
// Doctrines from the approved design: the system PROPOSES (category + the
// write-off call), Paul CONFIRMS — nothing categorizes itself into the taxes;
// gas stations / known vendors / supplies / crew food are ASSUMED write-offs
// (meals capped 50%), anything that could be personal stays 'pending' (the
// Your-call queue); outgoing payments mirror in automatically (entered once,
// counted once — the unique outgoing_payment_id is the claim).
// Income is NOT stored here — orders.payments[] stays the revenue truth.
// =============================================================================
import { supabase } from './supabase'

const BUCKET = 'receipts'

// ── Schedule C vocabulary (single-member LLC files on Schedule C) ────────────
export const SCHEDC_CATEGORIES = [
  { code: 'materials_cogs',   label: 'Materials (COGS)',    line: '4'   },
  { code: 'advertising',      label: 'Advertising',         line: '8'   },
  { code: 'car_truck',        label: 'Car & truck',         line: '9'   },
  { code: 'contract_labor',   label: 'Contract labor',      line: '11'  },
  { code: 'insurance',        label: 'Insurance',           line: '15'  },
  { code: 'legal_professional', label: 'Legal & professional', line: '17' },
  { code: 'office',           label: 'Office',              line: '18'  },
  { code: 'rent',             label: 'Rent',                line: '20b' },
  { code: 'repairs',          label: 'Repairs',             line: '21'  },
  { code: 'supplies',         label: 'Supplies',            line: '22'  },
  { code: 'taxes_licenses',   label: 'Taxes & licenses',    line: '23'  },
  { code: 'travel',           label: 'Travel',              line: '24a' },
  { code: 'meals',            label: 'Meals (50%)',         line: '24b' },
  { code: 'utilities',        label: 'Utilities',           line: '25'  },
  { code: 'wages',            label: 'Wages (payroll)',     line: '26'  },
  { code: 'other',            label: 'Other',               line: '27a' },
]
export const schedcLabel = (code) =>
  SCHEDC_CATEGORIES.find(c => c.code === code)?.label || (code ? String(code) : '—')

// Outgoing-payments free-text categories → Schedule C. Debt/loan principal is
// NOT deductible — those land 'pending' so Paul (or the CPA) makes the call.
const OUTGOING_TO_SCHEDC = {
  'Utilities': { category: 'utilities', writeoff: 'yes' },
  'Payroll': { category: 'wages', writeoff: 'yes' },
  'Debt/loan': { category: 'other', writeoff: 'pending' },
  'Subscription': { category: 'office', writeoff: 'yes' },
  'Supplier/materials': { category: 'materials_cogs', writeoff: 'yes' },
  'Permits': { category: 'taxes_licenses', writeoff: 'yes' },
  'Taxes': { category: 'taxes_licenses', writeoff: 'yes' },
  'Other': { category: 'other', writeoff: 'pending' },
}

// ── The propose engine — vendor/note keywords → category + write-off call ────
// Rule-based v1 (an LLM pass can layer on later); the WRITE-OFF assumptions
// are Paul's own rule: "gas stations, vendors, food... automatically should be
// assumed to be written off", with 'pending' for could-be-personal retailers.
const RULES = [
  { re: /\b(wawa|shell|exxon|sunoco|bp|speedway|quiktrip|gas|diesel|fuel|ez.?pass|toll|parking)\b/i,
    category: 'car_truck', writeoff: 'yes', why: 'fuel / vehicle' },
  { re: /\b(lunch|dinner|breakfast|food|pizza|deli|diner|restaurant|manor|dunkin|starbucks|coffee|bagel|sandwich|catering)\b/i,
    category: 'meals', writeoff: 'yes', pct: 50, why: 'business meal — 50% cap applied' },
  { re: /\b(peerless|coldspring|matthews|granite|bronze|monument|stone|quarry|marker)\b/i,
    category: 'materials_cogs', writeoff: 'yes', why: 'known supplier' },
  { re: /\b(home depot|lowe'?s|lowes|harbor freight|grainger|fastenal|ace hardware|concrete|rebar|lumber|hardware)\b/i,
    category: 'supplies', writeoff: 'yes', why: 'shop / job supplies' },
  { re: /\b(insurance|selective|geico|progressive|allstate|liberty mutual)\b/i,
    category: 'insurance', writeoff: 'yes', why: 'insurance' },
  { re: /\b(verizon|at&t|t-?mobile|optimum|comcast|pse&?g|nj natural gas|electric|water bill|internet|phone bill)\b/i,
    category: 'utilities', writeoff: 'yes', why: 'utility' },
  { re: /\b(adp|gusto|paychex|payroll)\b/i,
    category: 'wages', writeoff: 'yes', why: 'payroll' },
  { re: /\b(permit|cemetery fee|license|dmv|registration)\b/i,
    category: 'taxes_licenses', writeoff: 'yes', why: 'permit / license' },
  { re: /\b(accountant|cpa|attorney|lawyer|legal)\b/i,
    category: 'legal_professional', writeoff: 'yes', why: 'professional services' },
  { re: /\b(staples|office depot|ink|printer|paper|quickbooks|software|subscription)\b/i,
    category: 'office', writeoff: 'yes', why: 'office' },
  { re: /\b(repair|mechanic|tire|brake|oil change)\b/i,
    category: 'repairs', writeoff: 'yes', why: 'repair' },
  // Could-be-personal retailers — never assumed. Paul decides.
  { re: /\b(amazon|costco|walmart|target|sam'?s club|bj'?s|ebay|temu)\b/i,
    category: null, writeoff: 'pending', why: 'could be personal — your call' },
]
// Quick chips the phone offers — chip pick beats keyword guessing.
export const RECEIPT_CHIPS = [
  { code: 'supplies',       label: 'Supplies' },
  { code: 'car_truck',      label: 'Fuel' },
  { code: 'materials_cogs', label: 'Materials' },
  { code: 'repairs',        label: 'Tools/repair' },
  { code: 'meals',          label: 'Food' },
  { code: 'other',          label: 'Other' },
]

export function proposeExpense({ vendor, note, chip } = {}) {
  if (chip) {
    const pct = chip === 'meals' ? 50 : 100
    return { category: chip, writeoff: chip === 'other' ? 'pending' : 'yes', writeoffPct: pct, why: 'your pick' }
  }
  const hay = `${vendor || ''} ${note || ''}`
  for (const r of RULES) {
    if (r.re.test(hay)) {
      return { category: r.category, writeoff: r.writeoff, writeoffPct: r.pct ?? 100, why: r.why }
    }
  }
  return { category: null, writeoff: 'pending', writeoffPct: 100, why: 'no rule matched — your call' }
}

// ── Files (private bucket → signed URLs only) ────────────────────────────────
export async function uploadAcctFile(prefix, file) {
  if (!file) return { ok: false, error: 'No file' }
  const safe = String(file.name || 'file').replace(/[^\w.-]+/g, '_')
  const path = `${prefix}/${crypto.randomUUID()}_${safe}`
  const { error } = await supabase.storage.from(BUCKET)
    .upload(path, file, { upsert: false, contentType: file.type || undefined })
  if (error) return { ok: false, error: error.message }
  return { ok: true, path, name: safe }
}
export async function acctFileUrl(path, seconds = 600) {
  if (!path) return { ok: false, error: 'No path' }
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, seconds)
  if (error) return { ok: false, error: error.message }
  return { ok: true, url: data.signedUrl }
}

// ── Expense book CRUD ────────────────────────────────────────────────────────
export async function addAcctExpense(input = {}) {
  const row = {
    expense_date: input.expenseDate || null,
    vendor: input.vendor || null,
    note: input.note || null,
    amount: input.amount != null ? Number(input.amount) : null,
    category: input.category || null,
    writeoff: input.writeoff || 'pending',
    writeoff_pct: input.writeoffPct ?? 100,
    status: input.status || 'inbox',
    source: input.source || 'upload',
    receipt_path: input.receiptPath || null,
    ai: input.ai || null,
    created_by: input.createdBy || null,
    ...(input.confirmedBy ? { confirmed_by: input.confirmedBy, confirmed_at: new Date().toISOString() } : {}),
  }
  const { data, error } = await supabase.from('acct_expenses').insert(row).select('*').single()
  if (error) return { ok: false, error: error.message }
  return { ok: true, expense: data }
}

export async function listAcctExpenses({ limit = 1200 } = {}) {
  const { data, error } = await supabase.from('acct_expenses')
    .select('*')
    .order('expense_date', { ascending: false, nullsFirst: false })
    .limit(limit)
  if (error) { console.warn('[acct] list:', error.message); return [] }
  return data || []
}

const _EXP_PATCH_KEYS = {
  expenseDate: 'expense_date', vendor: 'vendor', note: 'note', amount: 'amount',
  category: 'category', writeoff: 'writeoff', writeoffPct: 'writeoff_pct',
  status: 'status', receiptPath: 'receipt_path',
  confirmedBy: 'confirmed_by', confirmedAt: 'confirmed_at',
}
export async function updateAcctExpense(id, patch = {}) {
  const row = {}
  for (const [k, col] of Object.entries(_EXP_PATCH_KEYS)) {
    if (patch[k] !== undefined) row[col] = patch[k]
  }
  if (!Object.keys(row).length) return { ok: true }
  const { error } = await supabase.from('acct_expenses').update(row).eq('id', id)
  return error ? { ok: false, error: error.message } : { ok: true }
}

export async function confirmAcctExpense(id, { by, category, writeoff, writeoffPct } = {}) {
  return updateAcctExpense(id, {
    status: 'confirmed', confirmedBy: by || null, confirmedAt: new Date().toISOString(),
    ...(category !== undefined ? { category } : {}),
    ...(writeoff !== undefined ? { writeoff } : {}),
    ...(writeoffPct !== undefined ? { writeoffPct } : {}),
  })
}

export async function deleteAcctExpense(id) {
  const { error } = await supabase.from('acct_expenses').delete().eq('id', id)
  return error ? { ok: false, error: error.message } : { ok: true }
}

// ── Outgoing payments mirror — entered once, counted once ────────────────────
// Every outgoing_payments row lands in the book exactly once (unique
// outgoing_payment_id claim; 23505 = another desk already mirrored it). They
// arrive CONFIRMED — Paul already entered them by hand — with the category
// mapped and only genuinely ambiguous kinds (loans, Other) left pending.
export async function sweepOutgoingIntoBook() {
  const { data: outs, error } = await supabase.from('outgoing_payments')
    .select('id, payee, category, amount, paid_date, notes, created_by')
    .order('paid_date', { ascending: false })
    .limit(1000)
  if (error || !outs?.length) return { created: 0 }
  const { data: done } = await supabase.from('acct_expenses')
    .select('outgoing_payment_id').not('outgoing_payment_id', 'is', null)
  const seen = new Set((done || []).map(r => r.outgoing_payment_id))
  let created = 0
  for (const o of outs) {
    if (seen.has(o.id)) continue
    const map = OUTGOING_TO_SCHEDC[o.category] || { category: 'other', writeoff: 'pending' }
    const { error: iErr } = await supabase.from('acct_expenses').insert({
      outgoing_payment_id: o.id,
      expense_date: o.paid_date || null,
      vendor: o.payee || null,
      note: o.notes || (o.category ? `Outgoing · ${o.category}` : 'Outgoing payment'),
      amount: o.amount != null ? Number(o.amount) : null,
      category: map.category, writeoff: map.writeoff, writeoff_pct: 100,
      status: 'confirmed', source: 'outgoing',
      confirmed_by: o.created_by || 'outgoing-sync', confirmed_at: new Date().toISOString(),
      created_by: 'outgoing-sync',
    })
    if (!iErr) created++   // 23505 = already mirrored by another desk
  }
  return { created }
}

// ── Document cabinet ─────────────────────────────────────────────────────────
export const DOC_KINDS = [
  { code: 'bank_statement', label: 'Bank statement' },
  { code: 'cc_statement',   label: 'Credit card statement' },
  { code: 'payroll',        label: 'Payroll report' },
  { code: 'insurance',      label: 'Insurance' },
  { code: 'bill',           label: 'Bill' },
  { code: 'other',          label: 'Other' },
]
export const docKindLabel = (k) => DOC_KINDS.find(d => d.code === k)?.label || 'Document'

export async function addAcctDocument({ kind, label, month, storagePath, filename, uploadedBy } = {}) {
  const { data, error } = await supabase.from('acct_documents').insert({
    kind: kind || 'other', label: label || null, month: month || null,
    storage_path: storagePath, filename: filename || null, uploaded_by: uploadedBy || null,
  }).select('*').single()
  if (error) return { ok: false, error: error.message }
  return { ok: true, doc: data }
}
export async function listAcctDocuments() {
  const { data, error } = await supabase.from('acct_documents')
    .select('*').order('month', { ascending: false, nullsFirst: false }).limit(500)
  if (error) { console.warn('[acct] docs:', error.message); return [] }
  return data || []
}
export async function deleteAcctDocument(id, storagePath) {
  if (storagePath) await supabase.storage.from(BUCKET).remove([storagePath]).catch(() => {})
  const { error } = await supabase.from('acct_documents').delete().eq('id', id)
  return error ? { ok: false, error: error.message } : { ok: true }
}

// ── Tax math (Schedule C shape; income comes from orders.payments[]) ─────────
export function deductibleAmount(e) {
  if (e.status !== 'confirmed' || e.writeoff !== 'yes') return 0
  return (Number(e.amount) || 0) * ((Number(e.writeoff_pct) || 100) / 100)
}

export function summarizeSchedC(expenses, { year } = {}) {
  const inYear = (e) => !year || String(e.expense_date || '').startsWith(String(year))
  const byCat = new Map()
  let cogs = 0, totalDeductible = 0
  for (const e of expenses) {
    if (!inYear(e)) continue
    const amt = deductibleAmount(e)
    if (amt <= 0) continue
    totalDeductible += amt
    if (e.category === 'materials_cogs') { cogs += amt; continue }
    const key = e.category || 'other'
    byCat.set(key, (byCat.get(key) || 0) + amt)
  }
  const lines = SCHEDC_CATEGORIES
    .filter(c => c.code !== 'materials_cogs')
    .map(c => ({ ...c, total: byCat.get(c.code) || 0 }))
    .filter(l => l.total > 0)
  return { cogs, lines, totalDeductible }
}

// Plain-words book review — the rule-based expert pass (flags, not writes).
export function analyzeBooks(expenses, { year } = {}) {
  const inYear = (e) => !year || String(e.expense_date || '').startsWith(String(year))
  const rows = expenses.filter(inYear)
  const flags = []
  const pending = rows.filter(e => e.writeoff === 'pending')
  if (pending.length) {
    flags.push({ tone: 'flag', title: `Your call — ${pending.length} waiting`,
      body: `Gray-area spends the system won't guess on. Each needs Write off / Don't: ${pending.slice(0, 4).map(e => `${e.vendor || 'unknown'} ${e.amount != null ? '$' + Number(e.amount).toFixed(0) : ''}`).join(', ')}${pending.length > 4 ? '…' : ''}.` })
  }
  const noReceipt = rows.filter(e => e.status === 'confirmed' && e.writeoff === 'yes'
    && !e.receipt_path && e.source !== 'outgoing' && e.category !== 'utilities')
  if (noReceipt.length) {
    flags.push({ tone: 'flag', title: `Missing receipts — ${noReceipt.length} row${noReceipt.length === 1 ? '' : 's'}`,
      body: 'Deductible either way, but receipts make them audit-proof. Attach from the Expense book.' })
  }
  // Duplicates: same vendor + same amount within 5 days.
  const dupes = []
  const sorted = [...rows].filter(e => e.vendor && e.amount != null)
    .sort((a, b) => String(a.vendor).localeCompare(String(b.vendor)) || String(a.expense_date || '').localeCompare(String(b.expense_date || '')))
  for (let i = 1; i < sorted.length; i++) {
    const a = sorted[i - 1], b = sorted[i]
    if (String(a.vendor).toLowerCase() === String(b.vendor).toLowerCase()
      && Math.abs(Number(a.amount) - Number(b.amount)) < 0.005
      && a.expense_date && b.expense_date
      && Math.abs(Date.parse(a.expense_date) - Date.parse(b.expense_date)) <= 5 * 86400000) {
      dupes.push(b)
    }
  }
  if (dupes.length) {
    flags.push({ tone: 'flag', title: `Possible duplicate${dupes.length === 1 ? '' : 's'} — ${dupes.length}`,
      body: dupes.slice(0, 3).map(d => `${d.vendor} $${Number(d.amount).toFixed(2)} (${d.expense_date})`).join(' · ') })
  }
  // 1099-NEC candidates: contract labor vendors at $600+.
  const labor = new Map()
  for (const e of rows) {
    if (e.category === 'contract_labor' && e.status === 'confirmed' && e.vendor) {
      labor.set(e.vendor, (labor.get(e.vendor) || 0) + (Number(e.amount) || 0))
    }
  }
  const nec = [...labor.entries()].filter(([, v]) => v >= 600)
  if (nec.length) {
    flags.push({ tone: 'win', title: `1099s you'll owe in January — ${nec.length}`,
      body: nec.map(([v, t]) => `${v} $${t.toFixed(0)}`).join(' · ') + '. Contract labor at $600+ needs a 1099-NEC.' })
  }
  return flags
}

// ── The CPA packet — an official letterhead PDF that downloads ───────────────
let _jsPDF = null
function loadJsPDF() {
  if (window.jspdf?.jsPDF) return Promise.resolve(window.jspdf.jsPDF)
  if (_jsPDF) return _jsPDF
  _jsPDF = new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js'
    s.onload = () => resolve(window.jspdf.jsPDF)
    s.onerror = () => reject(new Error('Could not load the PDF library.'))
    document.head.appendChild(s)
  })
  return _jsPDF
}

const _usd = (n) => `$${(Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

// Ink-light letterhead (PDF style rules: no solid heavy fills).
export async function downloadCpaPacket({ year, income, expenses, flags }) {
  const JsPDF = await loadJsPDF()
  const doc = new JsPDF({ unit: 'mm', format: 'letter' })
  const W = doc.internal.pageSize.getWidth(), M = 16
  let y = 18
  const ensure = (h) => { if (y + h > 258) { doc.addPage(); y = 18 } }
  const head = (t) => { ensure(14); doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor(30, 30, 30); doc.text(t, M, y); doc.setDrawColor(154, 114, 9); doc.setLineWidth(0.5); doc.line(M, y + 1.6, W - M, y + 1.6); y += 8 }
  const row = (l, v, bold) => { ensure(6); doc.setFont('helvetica', bold ? 'bold' : 'normal'); doc.setFontSize(9.5); doc.setTextColor(40, 40, 40); doc.text(l, M, y); doc.text(v, W - M, y, { align: 'right' }); y += 5.4 }

  doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.setTextColor(20, 20, 20)
  doc.text('SHEVCHENKO MONUMENTS LLC', M, y); y += 6
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(110, 105, 90)
  doc.text(`CPA packet — tax year ${year} · prepared by Stonebooks Accounting · ${new Date().toLocaleDateString('en-US')}`, M, y); y += 4
  doc.text('Draft for CPA review — the CPA files and signs the return.', M, y); y += 9

  const sched = summarizeSchedC(expenses, { year })
  head(`Schedule C draft — ${year}`)
  row('1 · Gross receipts (order payments in)', _usd(income), true)
  row('4 · Cost of goods sold (materials)', _usd(sched.cogs))
  row('Gross profit', _usd(income - sched.cogs), true)
  for (const l of sched.lines) row(`${l.line} · ${l.label}`, _usd(l.total))
  const profit = income - sched.totalDeductible
  y += 1.5
  row(`Tentative profit — ${year}`, _usd(profit), true)
  y += 4

  head('Expense detail by category (write-offs only)')
  const byCat = new Map()
  for (const e of expenses) {
    if (!String(e.expense_date || '').startsWith(String(year))) continue
    const amt = deductibleAmount(e)
    if (amt <= 0) continue
    const k = e.category || 'other'
    if (!byCat.has(k)) byCat.set(k, [])
    byCat.get(k).push(e)
  }
  for (const [cat, rowsIn] of [...byCat.entries()].sort((a, z) => a[0].localeCompare(z[0]))) {
    ensure(8)
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(60, 55, 40)
    doc.text(schedcLabel(cat), M, y); y += 5
    for (const e of rowsIn.sort((a, z) => String(a.expense_date || '').localeCompare(String(z.expense_date || '')))) {
      ensure(5)
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(70, 70, 70)
      const tail = [(e.writeoff_pct || 100) !== 100 ? `${e.writeoff_pct}%` : null, e.receipt_path ? 'receipt on file' : 'no receipt'].filter(Boolean).join(' · ')
      doc.text(`${e.expense_date || '—'}  ${String(e.vendor || e.note || '—').slice(0, 52)}  (${tail})`, M + 3, y)
      doc.text(_usd(deductibleAmount(e)), W - M, y, { align: 'right' })
      y += 4.6
    }
    y += 2
  }

  const excluded = expenses.filter(e => String(e.expense_date || '').startsWith(String(year)) && e.writeoff === 'no')
  if (excluded.length) {
    head('Excluded by owner decision (not deducted)')
    for (const e of excluded) row(`${e.expense_date || '—'} · ${e.vendor || e.note || '—'}`, _usd(e.amount))
  }

  if (flags?.length) {
    head('Open items for review')
    for (const f of flags) {
      ensure(10)
      doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(40, 40, 40)
      doc.text(f.title, M, y); y += 4.4
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(90, 85, 70)
      const wrapped = doc.splitTextToSize(f.body, W - 2 * M)
      doc.text(wrapped, M, y); y += wrapped.length * 4 + 2.5
    }
  }

  doc.save(`Shevchenko-CPA-Packet-${year}.pdf`)
}
