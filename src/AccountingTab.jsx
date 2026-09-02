// =============================================================================
// AccountingTab — Stonebooks Accounting (ACCT-1, 2026-09-01)
// =============================================================================
// Paul's audit tab, from the approved mockup: INBOX (everything captured lands
// here with a PROPOSED category + write-off call — Confirm moves it, nothing
// moves itself) · EXPENSE BOOK (the confirmed ledger, receipts attached,
// write-off states incl. owner exclusions) · DOCUMENTS (statements, payroll,
// insurance, bills — the filing cabinet the CPA packet exports) · TAX CENTER
// (Schedule C shape, income straight from orders.payments[], flags in plain
// words, official letterhead packet that downloads).
// Money doctrines: outgoing payments mirror in automatically (entered once,
// counted once); write-offs assumed for obvious business spend, meals 50%,
// gray areas wait in Your-call; the packet preps the filing, the CPA signs.
// =============================================================================
import { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from './lib/supabase'
import { fetchAllPaged, fmtUSD, fmtDate, getCurrentStaffName, properName } from './lib/stonebooksData'
import {
  SCHEDC_CATEGORIES, schedcLabel, proposeExpense,
  uploadAcctFile, acctFileUrl,
  addAcctExpense, listAcctExpenses, updateAcctExpense, confirmAcctExpense, deleteAcctExpense,
  sweepOutgoingIntoBook,
  DOC_KINDS, docKindLabel, addAcctDocument, listAcctDocuments, deleteAcctDocument,
  deductibleAmount, summarizeSchedC, analyzeBooks, downloadCpaPacket,
} from './lib/acctData'

const SECTIONS = [
  { code: 'inbox', label: 'Inbox' },
  { code: 'book',  label: 'Expense book' },
  { code: 'docs',  label: 'Statements & documents' },
  { code: 'tax',   label: 'Tax center' },
]

const WRITEOFF_OPTS = [
  { code: 'yes',     label: 'Write off' },
  { code: 'no',      label: "Don't write off" },
  { code: 'pending', label: 'Your call' },
]
const woChip = (e) => e.writeoff === 'yes'
  ? { label: (Number(e.writeoff_pct) || 100) === 100 ? 'WRITE-OFF' : `WRITE-OFF ${e.writeoff_pct}%`, cls: 'sb-acct-chip-good' }
  : e.writeoff === 'no'
    ? { label: 'EXCLUDED — your call', cls: 'sb-acct-chip-bad' }
    : { label: 'YOUR CALL', cls: 'sb-acct-chip-warn' }

const monthOf = (e) => String(e.expense_date || '').slice(0, 7)

export default function AccountingTab() {
  const [sec, setSec] = useState('inbox')
  const [expenses, setExpenses] = useState(null)
  const [docs, setDocs] = useState(null)
  const [income, setIncome] = useState(null)   // year total, orders.payments[]
  const [year] = useState(() => String(new Date().getFullYear()))
  const [busyId, setBusyId] = useState(null)
  const [err, setErr] = useState(null)

  const loadExpenses = useCallback(async () => {
    try { await sweepOutgoingIntoBook() } catch { /* mirror is best-effort */ }
    setExpenses(await listAcctExpenses())
  }, [])
  const loadDocs = useCallback(async () => setDocs(await listAcctDocuments()), [])

  useEffect(() => {
    let cancelled = false
    loadExpenses(); loadDocs()
    // Income = locked, non-voided order payments received this year. Legacy
    // two-column rows without payments[] are a known small undercount here —
    // the Payments tab remains the payment ledger of record.
    const q = () => supabase.from('orders').select('id, payments')
      .or('archived.is.null,archived.eq.false').order('id', { ascending: true })
    fetchAllPaged(q).then(rows => {
      if (cancelled) return
      let sum = 0
      for (const r of rows || []) {
        for (const p of (Array.isArray(r.payments) ? r.payments : [])) {
          if (!p || p.voided || !(p.locked ?? true)) continue
          const d = String(p.receivedAt || p.createdAt || '').slice(0, 4)
          if (d === year) sum += Number(p.amount) || 0
        }
      }
      setIncome(sum)
    }).catch(() => { if (!cancelled) setIncome(0) })
    return () => { cancelled = true }
  }, [loadExpenses, loadDocs, year])

  const inbox = useMemo(() => (expenses || []).filter(e => e.status === 'inbox'), [expenses])
  const book = useMemo(() => (expenses || []).filter(e => e.status === 'confirmed'), [expenses])
  const pendingCalls = useMemo(() => (expenses || []).filter(e => e.status === 'confirmed' && e.writeoff === 'pending'), [expenses])

  const patchLocal = (id, patch) => setExpenses(prev => (prev || []).map(e => e.id === id ? { ...e, ...patch } : e))

  const viewReceipt = async (path) => {
    const r = await acctFileUrl(path)
    if (r.ok) window.open(r.url, '_blank', 'noopener')
    else setErr(r.error)
  }

  const loading = expenses === null

  return (
    <div className="sb-page sb-page-wide">
      <style>{ACCT_CSS}</style>
      <div className="sb-page-head">
        <div>
          <div className="sb-page-eyebrow">Money</div>
          <h1 className="sb-page-title">Accounting</h1>
        </div>
      </div>
      <div className="sb-acct-purpose">
        Every dollar out — captured, categorized, write-off decided, CPA-ready. The system proposes; you confirm. Income rides your order payments automatically.
      </div>

      <div className="sb-acct-seg" role="tablist">
        {SECTIONS.map(s => {
          const n = s.code === 'inbox' ? inbox.length : s.code === 'tax' ? pendingCalls.length : 0
          return (
            <button key={s.code} type="button" role="tab" aria-selected={sec === s.code}
              className={`sb-acct-segbtn${sec === s.code ? ' on' : ''}`} onClick={() => setSec(s.code)}>
              {s.label}{n > 0 && <span className="sb-acct-segbadge">{n}</span>}
            </button>
          )
        })}
      </div>

      {err && <div className="sb-acct-err">{err}</div>}

      {sec === 'inbox' && (
        <InboxSection loading={loading} rows={inbox} busyId={busyId}
          onView={viewReceipt}
          onEdit={(id, patch) => patchLocal(id, patch)}
          onConfirm={async (e) => {
            setBusyId(e.id)
            const by = await getCurrentStaffName().catch(() => null)
            const r = await confirmAcctExpense(e.id, { by, category: e.category, writeoff: e.writeoff, writeoffPct: e.writeoff_pct })
            // Persist any inline edits made before Confirm.
            if (r.ok) await updateAcctExpense(e.id, { expenseDate: e.expense_date, vendor: e.vendor, amount: e.amount })
            setBusyId(null)
            if (!r.ok) { setErr(r.error); return }
            patchLocal(e.id, { status: 'confirmed' })
          }}
          onDelete={async (e) => {
            if (!window.confirm('Delete this inbox item? (Use this for mistaken snaps only.)')) return
            setBusyId(e.id)
            const r = await deleteAcctExpense(e.id)
            setBusyId(null)
            if (!r.ok) { setErr(r.error); return }
            setExpenses(prev => (prev || []).filter(x => x.id !== e.id))
          }}
          onUpload={async (files) => {
            const by = await getCurrentStaffName().catch(() => null)
            for (const f of files) {
              const up = await uploadAcctFile(`acct/${year}`, f)
              if (!up.ok) { setErr(up.error); break }
              const prop = proposeExpense({ vendor: f.name, note: '' })
              await addAcctExpense({
                source: 'upload', status: 'inbox', receiptPath: up.path, vendor: null,
                note: f.name, category: prop.category, writeoff: prop.writeoff,
                writeoffPct: prop.writeoffPct, ai: { why: prop.why }, createdBy: by,
              })
            }
            loadExpenses()
          }}
        />
      )}

      {sec === 'book' && (
        <BookSection loading={loading} rows={book} year={year}
          onView={viewReceipt}
          onSetWriteoff={async (e, writeoff) => {
            const pct = writeoff === 'yes' ? (e.category === 'meals' ? 50 : 100) : e.writeoff_pct
            patchLocal(e.id, { writeoff, writeoff_pct: pct })
            const r = await updateAcctExpense(e.id, { writeoff, writeoffPct: pct })
            if (!r.ok) { setErr(r.error); loadExpenses() }
          }}
          onSetCategory={async (e, category) => {
            patchLocal(e.id, { category })
            const r = await updateAcctExpense(e.id, { category })
            if (!r.ok) { setErr(r.error); loadExpenses() }
          }}
          onAttach={async (e, file) => {
            const up = await uploadAcctFile(`acct/${year}`, file)
            if (!up.ok) { setErr(up.error); return }
            patchLocal(e.id, { receipt_path: up.path })
            const r = await updateAcctExpense(e.id, { receiptPath: up.path })
            if (!r.ok) { setErr(r.error); loadExpenses() }
          }}
        />
      )}

      {sec === 'docs' && (
        <DocsSection loading={docs === null} rows={docs || []}
          onView={viewReceipt}
          onUpload={async ({ kind, month, label, file }) => {
            const by = await getCurrentStaffName().catch(() => null)
            const up = await uploadAcctFile(`docs/${month || year}`, file)
            if (!up.ok) { setErr(up.error); return }
            const r = await addAcctDocument({ kind, month, label, storagePath: up.path, filename: up.name, uploadedBy: by })
            if (!r.ok) { setErr(r.error); return }
            loadDocs()
          }}
          onDelete={async (d) => {
            if (!window.confirm(`Delete ${d.label || d.filename || 'this document'}? The file is removed too.`)) return
            const r = await deleteAcctDocument(d.id, d.storage_path)
            if (!r.ok) { setErr(r.error); return }
            loadDocs()
          }}
        />
      )}

      {sec === 'tax' && (
        <TaxSection loading={loading || income === null} expenses={expenses || []}
          income={income || 0} year={year}
          onResolvePending={async (e, writeoff) => {
            patchLocal(e.id, { writeoff })
            const r = await updateAcctExpense(e.id, { writeoff })
            if (!r.ok) { setErr(r.error); loadExpenses() }
          }}
        />
      )}
    </div>
  )
}

// ── Inbox ────────────────────────────────────────────────────────────────────
function InboxSection({ loading, rows, busyId, onView, onEdit, onConfirm, onDelete, onUpload }) {
  return (
    <>
      <div className="sb-acct-lede">
        Phone receipt snaps and desk uploads land here with the category and write-off <b>proposed</b> — obvious business spend is assumed written off, meals ride the 50% cap, gray areas say YOUR CALL. Fix anything, then <b>Confirm</b> moves it into the book. Nothing moves itself.
      </div>
      <label className="sb-acct-drop">
        Drop receipts or expense reports here — or <b>browse files</b> (photos or PDFs, several at once)
        <input type="file" multiple accept="image/*,.pdf" style={{ display: 'none' }}
          onChange={e => { const fs = [...(e.target.files || [])]; e.target.value = ''; if (fs.length) onUpload(fs) }} />
      </label>
      <div className="sb-acct-table">
        <div className="sb-acct-row sb-acct-row-head sb-acct-inbox-grid">
          <div>Date</div><div>Vendor / what it is</div><div>Category</div><div>Write-off</div><div className="num">Amount</div><div />
        </div>
        {loading ? <div className="sb-acct-empty">Loading the inbox…</div>
          : rows.length === 0 ? <div className="sb-acct-empty">Inbox zero — everything captured is in the book.</div>
          : rows.map(e => (
            <div key={e.id} className="sb-acct-row sb-acct-inbox-grid">
              <input className="sb-acct-in" type="date" value={e.expense_date || ''}
                onChange={ev => onEdit(e.id, { expense_date: ev.target.value })} />
              <div>
                <input className="sb-acct-in" placeholder="Vendor" value={e.vendor || ''}
                  onChange={ev => onEdit(e.id, { vendor: ev.target.value })} />
                <div className="sb-acct-sub">
                  {e.source === 'phone' ? 'PHONE SNAP' : 'UPLOAD'}{e.note ? ` · ${e.note}` : ''}
                  {e.ai?.why ? ` · ${e.ai.why}` : ''}
                  {e.receipt_path && <> · <button type="button" className="sb-acct-link" onClick={() => onView(e.receipt_path)}>view receipt</button></>}
                </div>
              </div>
              <select className="sb-acct-in" value={e.category || ''}
                onChange={ev => onEdit(e.id, { category: ev.target.value || null })}>
                <option value="">— pick one —</option>
                {SCHEDC_CATEGORIES.map(c => <option key={c.code} value={c.code}>{c.label}</option>)}
              </select>
              <select className="sb-acct-in" value={e.writeoff}
                onChange={ev => onEdit(e.id, { writeoff: ev.target.value, writeoff_pct: ev.target.value === 'yes' && e.category === 'meals' ? 50 : e.writeoff_pct })}>
                {WRITEOFF_OPTS.map(w => <option key={w.code} value={w.code}>{w.label}</option>)}
              </select>
              <input className="sb-acct-in num" type="number" step="0.01" min="0" value={e.amount ?? ''}
                onChange={ev => onEdit(e.id, { amount: ev.target.value === '' ? null : Number(ev.target.value) })} />
              <div className="sb-acct-actions">
                <button type="button" className="sb-acct-btn sb-acct-btn-gold" disabled={busyId === e.id || !e.category || e.amount == null}
                  title={!e.category ? 'Pick a category first' : e.amount == null ? 'Enter the amount' : ''}
                  onClick={() => onConfirm(e)}>Confirm</button>
                <button type="button" className="sb-acct-btn" disabled={busyId === e.id} onClick={() => onDelete(e)}>Delete</button>
              </div>
            </div>
          ))}
      </div>
    </>
  )
}

// ── Expense book ─────────────────────────────────────────────────────────────
function BookSection({ loading, rows, year, onView, onSetWriteoff, onSetCategory, onAttach }) {
  const [month, setMonth] = useState('all')
  const [cat, setCat] = useState('all')
  const [wo, setWo] = useState('all')
  const [q, setQ] = useState('')
  const months = useMemo(() => [...new Set(rows.map(monthOf).filter(Boolean))].sort().reverse(), [rows])
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return rows.filter(e =>
      (month === 'all' || monthOf(e) === month)
      && (cat === 'all' || (e.category || 'other') === cat)
      && (wo === 'all' || e.writeoff === wo)
      && (!needle || `${e.vendor || ''} ${e.note || ''} ${schedcLabel(e.category)}`.toLowerCase().includes(needle)))
  }, [rows, month, cat, wo, q])
  const total = shown.reduce((s, e) => s + (Number(e.amount) || 0), 0)
  const deductible = shown.reduce((s, e) => s + deductibleAmount(e), 0)
  return (
    <>
      <div className="sb-acct-lede">
        The confirmed book. Permit fees and vendor checks from Payments › Outgoing flow in on their own — entered once, counted once. Every row holds its receipt and its write-off call; flip <b>Don't write off</b> on anything personal and it stays on the books but out of the taxes.
      </div>
      <div className="sb-acct-controls">
        <input className="sb-acct-search" placeholder="Search vendor, note, category…" value={q} onChange={e => setQ(e.target.value)} />
        <select className="sb-acct-in" value={month} onChange={e => setMonth(e.target.value)}>
          <option value="all">All months</option>
          {months.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
        <select className="sb-acct-in" value={cat} onChange={e => setCat(e.target.value)}>
          <option value="all">All categories</option>
          {SCHEDC_CATEGORIES.map(c => <option key={c.code} value={c.code}>{c.label}</option>)}
        </select>
        <select className="sb-acct-in" value={wo} onChange={e => setWo(e.target.value)}>
          <option value="all">All write-off states</option>
          <option value="yes">Written off</option>
          <option value="no">Excluded</option>
          <option value="pending">Your call</option>
        </select>
      </div>
      <div className="sb-acct-summary">
        <span><strong>{shown.length}</strong> entr{shown.length === 1 ? 'y' : 'ies'}</span>
        <span>Total: <strong>{fmtUSD(total)}</strong></span>
        <span>Deductible: <strong>{fmtUSD(deductible)}</strong></span>
      </div>
      <div className="sb-acct-table">
        <div className="sb-acct-row sb-acct-row-head sb-acct-book-grid">
          <div>Date</div><div>Vendor</div><div>Category</div><div>Write-off</div><div>Receipt</div><div className="num">Amount</div>
        </div>
        {loading ? <div className="sb-acct-empty">Loading the book…</div>
          : shown.length === 0 ? <div className="sb-acct-empty">Nothing matches the filters{rows.length === 0 ? ` — the ${year} book starts with your first confirm` : ''}.</div>
          : shown.map(e => {
            const chip = woChip(e)
            return (
              <div key={e.id} className="sb-acct-row sb-acct-book-grid">
                <span>{e.expense_date ? fmtDate(e.expense_date) : '—'}</span>
                <span>
                  <span className="sb-acct-vendor">{properName(e.vendor || '') || e.note || '—'}</span>
                  <div className="sb-acct-sub">{e.source === 'outgoing' ? 'from Payments › Outgoing' : e.source === 'phone' ? 'phone snap' : null}{e.note && e.vendor ? ` · ${e.note}` : ''}</div>
                </span>
                <select className="sb-acct-in" value={e.category || ''} onChange={ev => onSetCategory(e, ev.target.value || null)}>
                  <option value="">—</option>
                  {SCHEDC_CATEGORIES.map(c => <option key={c.code} value={c.code}>{c.label}</option>)}
                </select>
                <select className={`sb-acct-in sb-acct-wosel ${chip.cls}`} value={e.writeoff} onChange={ev => onSetWriteoff(e, ev.target.value)}>
                  {WRITEOFF_OPTS.map(w => <option key={w.code} value={w.code}>{w.label}</option>)}
                </select>
                <span>
                  {e.receipt_path
                    ? <button type="button" className="sb-acct-link" onClick={() => onView(e.receipt_path)}>View</button>
                    : e.source === 'outgoing' || e.source === 'statement'
                      ? <label className="sb-acct-link" style={{ cursor: 'pointer' }}>Attach
                          <input type="file" accept="image/*,.pdf" style={{ display: 'none' }}
                            onChange={ev => { const f = ev.target.files?.[0]; ev.target.value = ''; if (f) onAttach(e, f) }} />
                        </label>
                      : <span className="sb-acct-chip sb-acct-chip-bad">NO RECEIPT</span>}
                  {!e.receipt_path && (e.source === 'phone' || e.source === 'upload') && (
                    <label className="sb-acct-link" style={{ cursor: 'pointer', marginLeft: 8 }}>Attach
                      <input type="file" accept="image/*,.pdf" style={{ display: 'none' }}
                        onChange={ev => { const f = ev.target.files?.[0]; ev.target.value = ''; if (f) onAttach(e, f) }} />
                    </label>
                  )}
                </span>
                <span className="num sb-acct-amt">{e.amount != null ? fmtUSD(Number(e.amount)) : '—'}</span>
              </div>
            )
          })}
      </div>
    </>
  )
}

// ── Statements & documents ───────────────────────────────────────────────────
function DocsSection({ loading, rows, onView, onUpload, onDelete }) {
  const [kind, setKind] = useState('bank_statement')
  // LOCAL calendar month — never toISOString for a calendar default (DATE-1).
  const [month, setMonth] = useState(() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  })
  const [label, setLabel] = useState('')
  return (
    <>
      <div className="sb-acct-lede">
        The filing cabinet — bank statements, credit card statements, payroll reports, insurance, and bills, by month. Everything here rides into the CPA packet. (Statement line-by-line reconcile against your receipts is the next slice.)
      </div>
      <div className="sb-acct-controls" style={{ alignItems: 'flex-end' }}>
        <div className="sb-acct-field"><label>What is it</label>
          <select className="sb-acct-in" value={kind} onChange={e => setKind(e.target.value)}>
            {DOC_KINDS.map(d => <option key={d.code} value={d.code}>{d.label}</option>)}
          </select>
        </div>
        <div className="sb-acct-field"><label>Month</label>
          <input className="sb-acct-in" type="month" value={month} onChange={e => setMonth(e.target.value)} />
        </div>
        <div className="sb-acct-field" style={{ flex: 1 }}><label>Label (optional)</label>
          <input className="sb-acct-in" placeholder="e.g. Provident checking" value={label} onChange={e => setLabel(e.target.value)} />
        </div>
        <label className="sb-acct-btn sb-acct-btn-gold" style={{ cursor: 'pointer' }}>
          Upload
          <input type="file" accept="image/*,.pdf,.csv" style={{ display: 'none' }}
            onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) { onUpload({ kind, month, label: label.trim() || null, file: f }); setLabel('') } }} />
        </label>
      </div>
      <div className="sb-acct-table">
        <div className="sb-acct-row sb-acct-row-head sb-acct-doc-grid">
          <div>Month</div><div>Kind</div><div>Document</div><div /><div />
        </div>
        {loading ? <div className="sb-acct-empty">Loading…</div>
          : rows.length === 0 ? <div className="sb-acct-empty">Nothing filed yet — start with last month's bank statement.</div>
          : rows.map(d => (
            <div key={d.id} className="sb-acct-row sb-acct-doc-grid">
              <span className="sb-acct-mono">{d.month || '—'}</span>
              <span><span className="sb-acct-chip sb-acct-chip-neutral">{docKindLabel(d.kind).toUpperCase()}</span></span>
              <span className="sb-acct-vendor">{d.label || d.filename || '—'}</span>
              <button type="button" className="sb-acct-link" onClick={() => onView(d.storage_path)}>View</button>
              <button type="button" className="sb-acct-link" style={{ color: '#b54040' }} onClick={() => onDelete(d)}>Delete</button>
            </div>
          ))}
      </div>
    </>
  )
}

// ── Tax center ───────────────────────────────────────────────────────────────
function TaxSection({ loading, expenses, income, year, onResolvePending }) {
  const sched = useMemo(() => summarizeSchedC(expenses, { year }), [expenses, year])
  const flags = useMemo(() => analyzeBooks(expenses, { year }), [expenses, year])
  const pending = expenses.filter(e => String(e.expense_date || '').startsWith(year) && e.status === 'confirmed' && e.writeoff === 'pending')
  const profit = income - sched.totalDeductible
  // Rough self-employment + income tax figure — clearly labeled rough; the
  // packet carries the worksheets and the CPA trues it up.
  const seTax = Math.max(0, profit * 0.9235 * 0.153)
  const [busy, setBusy] = useState(false)
  return (
    <>
      <div className="sb-acct-lede">
        The year, shaped like the form your return files on — <b>Schedule C</b>, single-member LLC. It knows where you operate (Perth Amboy, NJ · Middlesex County): meals capped 50%, federal + New Jersey quarterlies. Estimates here are rough by design — <b>the packet preps the filing, your CPA signs</b>.
      </div>
      <div className="sb-acct-cards">
        <div className="sb-acct-card sb-acct-card-green"><div className="k">Income · {year}</div><div className="v">{loading ? '—' : fmtUSD(income)}</div><div className="s">order payments in</div></div>
        <div className="sb-acct-card"><div className="k">Write-offs · {year}</div><div className="v">{loading ? '—' : fmtUSD(sched.totalDeductible)}</div><div className="s">confirmed, caps applied</div></div>
        <div className="sb-acct-card sb-acct-card-gold"><div className="k">Tentative profit</div><div className="v">{loading ? '—' : fmtUSD(profit)}</div><div className="s">what tax is figured on</div></div>
        <div className="sb-acct-card sb-acct-card-red"><div className="k">Your call</div><div className="v">{loading ? '—' : pending.length}</div><div className="s">write-off decisions waiting</div></div>
      </div>

      <div className="sb-acct-taxgrid">
        <div className="sb-acct-sched">
          <div className="sb-acct-schedhead">
            <span>Schedule C — {year}</span>
            <button type="button" className="sb-acct-btn sb-acct-btn-dark" disabled={busy || loading}
              onClick={async () => {
                setBusy(true)
                try { await downloadCpaPacket({ year, income, expenses, flags }) }
                catch (e) { window.alert(e?.message || 'Could not build the packet.') }
                setBusy(false)
              }}>
              {busy ? 'Building…' : 'Download the CPA packet'}
            </button>
          </div>
          <div className="sb-acct-schedrow"><span><i>1</i>Gross receipts (order payments in)</span><b>{fmtUSD(income)}</b></div>
          <div className="sb-acct-schedrow"><span><i>4</i>Cost of goods sold (materials)</span><b>{fmtUSD(sched.cogs)}</b></div>
          <div className="sb-acct-schedrow sb-acct-schedsub"><span>Gross profit</span><b>{fmtUSD(income - sched.cogs)}</b></div>
          {sched.lines.map(l => (
            <div key={l.code} className="sb-acct-schedrow"><span><i>{l.line}</i>{l.label}</span><b>{fmtUSD(l.total)}</b></div>
          ))}
          <div className="sb-acct-schedrow sb-acct-schedtotal"><span>Tentative profit</span><b>{fmtUSD(profit)}</b></div>
        </div>

        <div>
          {pending.length > 0 && (
            <div className="sb-acct-note sb-acct-note-flag">
              <h5>Your call — decide these</h5>
              {pending.slice(0, 6).map(e => (
                <div key={e.id} className="sb-acct-pendrow">
                  <span>{properName(e.vendor || '') || e.note || '—'} · {e.amount != null ? fmtUSD(Number(e.amount)) : '—'}</span>
                  <span>
                    <button type="button" className="sb-acct-btn sb-acct-btn-mini" onClick={() => onResolvePending(e, 'yes')}>Write off</button>
                    <button type="button" className="sb-acct-btn sb-acct-btn-mini" onClick={() => onResolvePending(e, 'no')}>Don't</button>
                  </span>
                </div>
              ))}
              {pending.length > 6 && <div className="sb-acct-sub">+{pending.length - 6} more in the Expense book (filter: Your call)</div>}
            </div>
          )}
          {flags.filter(f => !f.title.startsWith('Your call')).map((f, i) => (
            <div key={i} className={`sb-acct-note ${f.tone === 'win' ? 'sb-acct-note-win' : 'sb-acct-note-flag'}`}>
              <h5>{f.title}</h5><p>{f.body}</p>
            </div>
          ))}
          <div className="sb-acct-note">
            <h5>Quarterly estimates — rough</h5>
            <p>Self-employment tax on profit so far: about {fmtUSD(seTax)} for the year. Federal 1040-ES + NJ-1040-ES worksheets ride in the packet; your CPA trues the numbers up.</p>
          </div>
          <div className="sb-acct-note">
            <h5>Knows your jurisdiction</h5>
            <p>Perth Amboy, NJ · Middlesex County. Meals capped at 50% (federal rule, applied for you). NJ sales tax stays where it already lives — on your orders.</p>
          </div>
        </div>
      </div>
    </>
  )
}

const ACCT_CSS = `
  .sb-acct-purpose { font-size: 13px; color: #6b6b66; margin: -6px 0 16px; max-width: 78ch; line-height: 1.5; }
  .sb-acct-seg { display: inline-flex; gap: 4px; padding: 4px; background: #f0eeea; border-radius: 999px; margin-bottom: 16px; flex-wrap: wrap; }
  .sb-acct-segbtn { font: inherit; font-size: 13px; padding: 6px 16px; border: none; background: transparent; color: #6b6b66; border-radius: 999px; cursor: pointer; }
  .sb-acct-segbtn.on { background: #fff; color: #1e2d3d; font-weight: 600; box-shadow: 0 1px 2px rgba(15,20,25,0.08); }
  .sb-acct-segbadge { display: inline-block; min-width: 17px; text-align: center; font-size: 10px; font-weight: 800; background: #b54040; color: #fff; border-radius: 999px; padding: 1px 5px; margin-left: 7px; }
  .sb-acct-lede { font-size: 13px; color: #6b6b66; line-height: 1.55; max-width: 84ch; margin-bottom: 14px; }
  .sb-acct-lede b { color: #1e2d3d; }
  .sb-acct-err { font-size: 12.5px; color: #b3261e; font-weight: 600; margin-bottom: 10px; }
  .sb-acct-drop { display: block; border: 2px dashed #d8d6d1; border-radius: 10px; padding: 18px 14px; text-align: center; color: #8a8a85; font-size: 13px; font-weight: 600; background: #fbfaf6; cursor: pointer; margin-bottom: 14px; }
  .sb-acct-drop b { color: #9A7209; }
  .sb-acct-table { background: #fff; border: 0.5px solid #e6e3dd; border-radius: 12px; overflow: hidden; margin-bottom: 18px; }
  .sb-acct-row { display: grid; gap: 12px; align-items: center; padding: 10px 14px; border-bottom: 0.5px solid #efece6; font-size: 13px; }
  .sb-acct-row:last-child { border-bottom: none; }
  .sb-acct-row-head { font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.08em; font-weight: 700; color: #8a8a85; background: #fbfaf6; }
  .sb-acct-inbox-grid { grid-template-columns: 130px 1.6fr 170px 140px 110px 150px; }
  .sb-acct-book-grid { grid-template-columns: 92px 1.5fr 170px 150px 130px 110px; }
  .sb-acct-doc-grid { grid-template-columns: 90px 190px 1fr 60px 60px; }
  .sb-acct-empty { padding: 22px 14px; font-size: 13px; color: #8a8a85; text-align: center; }
  .sb-acct-in { font: inherit; font-size: 12.5px; padding: 7px 9px; border: 0.5px solid #e6e3dd; border-radius: 7px; background: #fff; width: 100%; box-sizing: border-box; }
  .sb-acct-in.num { text-align: right; font-variant-numeric: tabular-nums; }
  .sb-acct-sub { font-size: 11.5px; color: #8a8a85; margin-top: 3px; }
  .sb-acct-vendor { font-weight: 600; color: #1e2d3d; }
  .sb-acct-amt { font-weight: 700; font-variant-numeric: tabular-nums; }
  .sb-acct-mono { font-family: "JetBrains Mono", Consolas, monospace; font-size: 12px; }
  .sb-acct-link { font: inherit; font-size: 12.5px; font-weight: 600; color: #9A7209; background: none; border: none; cursor: pointer; padding: 0; }
  .sb-acct-link:hover { text-decoration: underline; }
  .sb-acct-actions { display: flex; gap: 6px; justify-content: flex-end; }
  .sb-acct-btn { font: inherit; font-size: 12.5px; font-weight: 700; padding: 8px 13px; border: 0.5px solid #e6e3dd; border-radius: 8px; background: #fff; color: #2c2c2a; cursor: pointer; }
  .sb-acct-btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .sb-acct-btn-gold { background: #9A7209; border-color: #9A7209; color: #fff; }
  .sb-acct-btn-dark { background: #0F1419; border-color: #0F1419; color: #E8C15A; }
  .sb-acct-btn-mini { padding: 4px 9px; font-size: 11.5px; margin-left: 6px; }
  .sb-acct-chip { display: inline-block; font-size: 10px; font-weight: 800; letter-spacing: 0.04em; border-radius: 999px; padding: 3px 8px; white-space: nowrap; }
  .sb-acct-chip-good { color: #2d7a4f; background: #e6f4ec; }
  .sb-acct-chip-bad { color: #b3261e; background: #f9e7e5; }
  .sb-acct-chip-warn { color: #8a5a12; background: #fbe5b8; }
  .sb-acct-chip-neutral { color: #6b6b66; background: #f0eeea; }
  .sb-acct-wosel { font-weight: 700; }
  .sb-acct-controls { display: flex; gap: 10px; margin-bottom: 12px; flex-wrap: wrap; }
  .sb-acct-controls .sb-acct-in { width: auto; }
  .sb-acct-search { flex: 1; min-width: 200px; font: inherit; font-size: 13.5px; padding: 9px 13px; border: 0.5px solid #e6e3dd; border-radius: 8px; background: #fff; }
  .sb-acct-field label { display: block; font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.07em; font-weight: 700; color: #8a8a85; margin-bottom: 4px; }
  .sb-acct-summary { display: flex; gap: 22px; font-size: 13px; color: #6b6b66; margin-bottom: 10px; }
  .sb-acct-summary strong { color: #1e2d3d; }
  .sb-acct-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin-bottom: 16px; }
  .sb-acct-card { background: #fff; border: 0.5px solid #e6e3dd; border-left: 3px solid #ccc; border-radius: 10px; padding: 13px 15px; }
  .sb-acct-card-green { border-left-color: #2d7a4f; }
  .sb-acct-card-gold { border-left-color: #9A7209; }
  .sb-acct-card-red { border-left-color: #b54040; }
  .sb-acct-card .k { font-size: 10px; text-transform: uppercase; letter-spacing: 0.1em; font-weight: 600; color: #8a8a85; }
  .sb-acct-card .v { font-size: 23px; font-weight: 700; color: #1e2d3d; font-variant-numeric: tabular-nums; margin: 4px 0 2px; }
  .sb-acct-card .s { font-size: 11.5px; color: #8a8a85; }
  .sb-acct-taxgrid { display: grid; grid-template-columns: 1.2fr 1fr; gap: 16px; align-items: start; }
  @media (max-width: 900px) { .sb-acct-taxgrid { grid-template-columns: 1fr; } }
  .sb-acct-sched { background: #fff; border: 0.5px solid #e6e3dd; border-radius: 12px; overflow: hidden; }
  .sb-acct-schedhead { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 12px 16px; background: #fbfaf6; border-bottom: 0.5px solid #e6e3dd; font-weight: 700; color: #1e2d3d; flex-wrap: wrap; }
  .sb-acct-schedrow { display: flex; justify-content: space-between; gap: 14px; padding: 8px 16px; font-size: 13px; border-bottom: 0.5px solid #efece6; }
  .sb-acct-schedrow i { font-style: normal; font-family: "JetBrains Mono", Consolas, monospace; font-size: 10.5px; color: #a0a09a; margin-right: 8px; }
  .sb-acct-schedrow b { font-variant-numeric: tabular-nums; }
  .sb-acct-schedsub { background: #fbfaf6; font-weight: 700; }
  .sb-acct-schedtotal { background: #0F1419; color: #fff; font-weight: 800; border-bottom: none; }
  .sb-acct-schedtotal b { color: #E8C15A; }
  .sb-acct-note { background: #fff; border: 0.5px solid #e6e3dd; border-left: 3px solid #9A7209; border-radius: 10px; padding: 12px 14px; margin-bottom: 10px; }
  .sb-acct-note-flag { border-left-color: #b54040; }
  .sb-acct-note-win { border-left-color: #2d7a4f; }
  .sb-acct-note h5 { margin: 0 0 4px; font-size: 13px; color: #1e2d3d; }
  .sb-acct-note p { margin: 0; font-size: 12.5px; color: #6b6b66; line-height: 1.5; }
  .sb-acct-pendrow { display: flex; align-items: center; justify-content: space-between; gap: 10px; font-size: 12.5px; color: #2c2c2a; padding: 5px 0; }
`
