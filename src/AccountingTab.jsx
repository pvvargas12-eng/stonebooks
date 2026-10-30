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
import { useState, useEffect, useMemo, useCallback, lazy, Suspense } from 'react'
import { supabase } from './lib/supabase'
import { fetchAllPaged, fmtUSD, fmtDate, getCurrentStaffName, properName } from './lib/stonebooksData'
import {
  SCHEDC_CATEGORIES, schedcLabel, proposeExpense,
  uploadAcctFile, acctFileUrl,
  addAcctExpense, listAcctExpenses, updateAcctExpense, confirmAcctExpense, deleteAcctExpense,
  sweepOutgoingIntoBook,
  DOC_KINDS, docKindLabel, addAcctDocument, listAcctDocuments, deleteAcctDocument,
  deductibleAmount, summarizeSchedC, analyzeBooks, downloadCpaPacket, holderKey, isCardCharge, cardBucket, PERSONAL_HINT, COGS_CODES, inRangeFor } from './lib/acctData'

const SECTIONS = [
  { code: 'inbox', label: 'Inbox' },
  { code: 'book',  label: 'Expense book' },
  { code: 'cards', label: 'Credit cards' },
  { code: 'docs',  label: 'Statements & documents' },
  { code: 'tax',   label: 'Tax center' },
  // Paul 2026-10-30: "payroll stats, password protected" — who is paid what, why it moved.
  { code: 'payroll', label: 'Payroll' },
  // Paul 2026-09-17: "profit I want that to be a tab in accounting" — the
  // whole ProfitTab surface rides here now (its nav entry is gone).
  { code: 'profit', label: 'Profit' },
]
const ProfitTab = lazy(() => import('./ProfitTab'))

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

export default function AccountingTab({ onOpenJob, onOpenCemeteryOrder }) {
  const [sec, setSec] = useState('inbox')
  const [expenses, setExpenses] = useState(null)
  const [docs, setDocs] = useState(null)
  const [income, setIncome] = useState(null)   // year total, orders.payments[]
  const [incomeByMonth, setIncomeByMonth] = useState({})   // YYYY-MM → payments in (every year)
  const [year] = useState(() => String(new Date().getFullYear()))
  const [busyId, setBusyId] = useState(null)
  const [err, setErr] = useState(null)

  const loadExpenses = useCallback(async () => {
    try { await sweepOutgoingIntoBook() } catch { /* mirror is best-effort */ }
    setExpenses(await listAcctExpenses({ limit: 6000 }))
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
      const byMonth = {}
      for (const r of rows || []) {
        for (const p of (Array.isArray(r.payments) ? r.payments : [])) {
          if (!p || p.voided || !(p.locked ?? true)) continue
          const day = String(p.receivedAt || p.createdAt || '').slice(0, 10)
          const amt = Number(p.amount) || 0
          if (day.slice(0, 4) === year) sum += amt
          const mk = day.slice(0, 7)
          if (mk.length === 7) byMonth[mk] = (byMonth[mk] || 0) + amt
        }
      }
      setIncome(sum)
      setIncomeByMonth(byMonth)
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

      {sec === 'profit' && (
        <Suspense fallback={<div className="sb-acct-purpose">Loading profit…</div>}>
          <ProfitTab onOpenJob={onOpenJob} onOpenCemeteryOrder={onOpenCemeteryOrder} embedded />
        </Suspense>
      )}

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
          onConfirmMany={async (list) => {
            // Statement lines arrive by the hundred (the bank audit) — one
            // press files every shown row that already has a category.
            const by = await getCurrentStaffName().catch(() => null)
            let failed = 0
            for (const e of list) {
              setBusyId(e.id)
              const r = await confirmAcctExpense(e.id, { by, category: e.category, writeoff: e.writeoff, writeoffPct: e.writeoff_pct })
              if (!r.ok) { failed++; continue }
              await updateAcctExpense(e.id, { expenseDate: e.expense_date, vendor: e.vendor, amount: e.amount })
              patchLocal(e.id, { status: 'confirmed' })
            }
            setBusyId(null)
            if (failed) setErr(`${failed} row${failed === 1 ? '' : 's'} could not be confirmed.`)
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

      {sec === 'cards' && (
        <CardsSection loading={loading} rows={expenses || []}
          onView={viewReceipt}
          onSetCategory={async (e, category) => {
            patchLocal(e.id, { category })
            const r = await updateAcctExpense(e.id, { category })
            if (!r.ok) { setErr(r.error); loadExpenses() }
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

      {sec === 'payroll' && (
        <PayrollSection loading={loading} expenses={expenses || []} docs={docs || []} year={year} />
      )}

      {sec === 'tax' && (
        <TaxSection loading={loading || income === null} expenses={expenses || []}
          income={income || 0} incomeByMonth={incomeByMonth} year={year}
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
const SOURCE_LABEL = { phone: 'PHONE SNAP', upload: 'UPLOAD', statement: 'STATEMENT', outgoing: 'OUTGOING' }
function InboxSection({ loading, rows, busyId, onView, onEdit, onConfirm, onConfirmMany, onDelete, onUpload }) {
  // Filters (bank-audit load, 2026-10-30): by source, by account, by the
  // audit's bucket — and one button to file every shown row that has a category.
  const [src, setSrc] = useState('all')
  const [acct, setAcct] = useState('all')
  const [bucket, setBucket] = useState('all')
  const [armed, setArmed] = useState(false)
  const accounts = useMemo(() => [...new Set(rows.map(e => e.ai?.accountName).filter(Boolean))].sort(), [rows])
  const buckets = useMemo(() => {
    const m = new Map()
    for (const e of rows) { const b = e.ai?.bucket; if (b) m.set(b, (m.get(b) || 0) + 1) }
    return [...m.entries()].sort((a, b) => b[1] - a[1])
  }, [rows])
  const shown = useMemo(() => rows.filter(e =>
    (src === 'all' || e.source === src)
    && (acct === 'all' || e.ai?.accountName === acct)
    && (bucket === 'all' || e.ai?.bucket === bucket)), [rows, src, acct, bucket])
  const ready = shown.filter(e => e.category && e.amount != null)
  const shownTotal = shown.reduce((s, e) => s + (Number(e.amount) || 0), 0)
  return (
    <>
      <div className="sb-acct-lede">
        Phone receipt snaps, desk uploads and bank-statement lines land here with the category and write-off <b>proposed</b> — obvious business spend is assumed written off, meals ride the 50% cap, gray areas say YOUR CALL. Fix anything, then <b>Confirm</b> moves it into the book. Nothing moves itself.
      </div>
      {rows.length > 0 && (
        <div className="sb-acct-filt">
          <span className="sb-acct-filt-lab">Show</span>
          {[['all', `All ${rows.length}`], ...Object.keys(SOURCE_LABEL).filter(s => rows.some(e => e.source === s)).map(s => [s, `${SOURCE_LABEL[s]} ${rows.filter(e => e.source === s).length}`])].map(([code, label]) => (
            <button key={code} type="button" className={`sb-acct-fchip${src === code ? ' on' : ''}`} onClick={() => { setSrc(code); setArmed(false) }}>{label}</button>
          ))}
          {accounts.length > 1 && (
            <select className="sb-acct-in sb-acct-filt-sel" value={acct} onChange={e => { setAcct(e.target.value); setArmed(false) }}>
              <option value="all">Every account</option>
              {accounts.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
          )}
          {buckets.length > 1 && (
            <select className="sb-acct-in sb-acct-filt-sel" value={bucket} onChange={e => { setBucket(e.target.value); setArmed(false) }}>
              <option value="all">Every kind</option>
              {buckets.map(([b, n]) => <option key={b} value={b}>{b} ({n})</option>)}
            </select>
          )}
          <span className="sb-acct-filt-sum">{shown.length} shown · ${shownTotal.toFixed(2)}</span>
          {ready.length > 0 && !armed && (
            <button type="button" className="sb-acct-btn sb-acct-btn-gold" disabled={!!busyId} onClick={() => setArmed(true)}>Confirm all shown ({ready.length})</button>
          )}
          {armed && (
            <span className="sb-acct-filt-arm">
              File {ready.length} row{ready.length === 1 ? '' : 's'} into the book with the categories as they stand?
              <button type="button" className="sb-acct-btn sb-acct-btn-gold" disabled={!!busyId} onClick={async () => { setArmed(false); await onConfirmMany(ready) }}>Yes, confirm {ready.length}</button>
              <button type="button" className="sb-acct-btn" onClick={() => setArmed(false)}>Cancel</button>
            </span>
          )}
          {shown.length > ready.length && <span className="sb-acct-sub">{shown.length - ready.length} shown row{shown.length - ready.length === 1 ? ' has' : 's have'} no category yet — pick one to include them.</span>}
        </div>
      )}
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
          : shown.length === 0 ? <div className="sb-acct-empty">Nothing matches these filters.</div>
          : shown.map(e => (
            <div key={e.id} className="sb-acct-row sb-acct-inbox-grid">
              <input className="sb-acct-in" type="date" value={e.expense_date || ''}
                onChange={ev => onEdit(e.id, { expense_date: ev.target.value })} />
              <div>
                <input className="sb-acct-in" placeholder="Vendor" value={e.vendor || ''}
                  onChange={ev => onEdit(e.id, { vendor: ev.target.value })} />
                <div className="sb-acct-sub">
                  {SOURCE_LABEL[e.source] || 'UPLOAD'}{e.ai?.accountName ? ` · ${e.ai.accountName}` : ''}{e.note ? ` · ${e.note}` : ''}
                  {e.ai?.why && e.ai.why !== e.ai?.bucket ? ` · ${e.ai.why}` : ''}
                  {e.ai?.flag && <> · <b className="sb-acct-flag">{e.ai.flag}</b></>}
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

// ── Credit cards — charges by person ─────────────────────────────────────────
// Paul 2026-10-30: "in accounting for expense book I want a credit card
// section and then see credit card charges by person, select a person and see
// their total spending and then spending history." A card charge is any
// statement line that carries a cardholder (the parser stamps ai.cardholder
// and ai.accountName on every card-statement purchase). The same person on
// two cards is ONE person: names fold to first + last word, proper-cased.

function CardsSection({ loading, rows, onView, onSetCategory }) {
  const [person, setPerson] = useState('')      // '' = everyone
  const [card, setCard] = useState('all')
  const [month, setMonth] = useState('all')
  const [q, setQ] = useState('')
  const [bucketF, setBucketF] = useState('')   // a purpose picked in "What it was for" (Paul 2026-10-30)
  const charges = useMemo(() => rows.filter(isCardCharge), [rows])
  const cards = useMemo(() => [...new Set(charges.map(e => e.ai?.accountName).filter(Boolean))].sort(), [charges])
  const months = useMemo(() => [...new Set(charges.map(monthOf).filter(Boolean))].sort().reverse(), [charges])
  // The pool the person tiles are built from: card + month + search, NOT person.
  const pool = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return charges.filter(e =>
      (card === 'all' || e.ai?.accountName === card)
      && (month === 'all' || monthOf(e) === month)
      && (!needle || `${e.vendor || ''} ${e.note || ''} ${cardBucket(e)}`.toLowerCase().includes(needle)))
  }, [charges, card, month, q])
  const people = useMemo(() => {
    const m = new Map()
    for (const e of pool) {
      const k = holderKey(e.ai?.cardholder); if (!k) continue
      const r = m.get(k) || { key: k, total: 0, n: 0, cards: new Set(), buckets: new Map(), last: null, personal: 0 }
      const amt = Number(e.amount) || 0
      r.total += amt; r.n++; if (e.ai?.accountName) r.cards.add(e.ai.accountName)
      const b = cardBucket(e); r.buckets.set(b, (r.buckets.get(b) || 0) + amt)
      if (PERSONAL_HINT.test(b)) r.personal += amt
      if (!r.last || String(e.expense_date) > r.last) r.last = String(e.expense_date)
      m.set(k, r)
    }
    return [...m.values()].sort((a, b) => b.total - a.total)
  }, [pool])
  const everyone = useMemo(() => ({ total: pool.reduce((s, e) => s + (Number(e.amount) || 0), 0), n: pool.length }), [pool])
  const sel = person ? people.find(p => p.key === person) : null
  // personRows = the picked person (or everyone); the purpose / card / month
  // boxes are built from it so the list of purposes never shrinks to the one
  // you clicked. shown = personRows narrowed to the clicked purpose.
  const personRows = useMemo(() => {
    const list = person ? pool.filter(e => holderKey(e.ai?.cardholder) === person) : pool
    return [...list].sort((a, b) => String(b.expense_date).localeCompare(String(a.expense_date)) || (Number(b.amount) - Number(a.amount)))
  }, [pool, person])
  const shown = useMemo(() => bucketF ? personRows.filter(e => cardBucket(e) === bucketF) : personRows, [personRows, bucketF])
  const byMonth = useMemo(() => {
    const m = new Map()
    for (const e of personRows) { const k = monthOf(e); if (!k) continue; const r = m.get(k) || { total: 0, n: 0 }; r.total += Number(e.amount) || 0; r.n++; m.set(k, r) }
    return [...m.entries()].sort((a, b) => b[0].localeCompare(a[0]))
  }, [personRows])
  const byCard = useMemo(() => {
    const m = new Map()
    for (const e of personRows) { const k = e.ai?.accountName || 'Card'; const r = m.get(k) || { total: 0, n: 0 }; r.total += Number(e.amount) || 0; r.n++; m.set(k, r) }
    return [...m.entries()].sort((a, b) => b[1].total - a[1].total)
  }, [personRows])
  const topBuckets = useMemo(() => {
    const m = new Map()
    for (const e of personRows) { const b = cardBucket(e); m.set(b, (m.get(b) || 0) + (Number(e.amount) || 0)) }
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)
  }, [personRows])
  const shownTotal = shown.reduce((s, e) => s + (Number(e.amount) || 0), 0)
  const inboxN = shown.filter(e => e.status === 'inbox').length
  const personTotal = personRows.reduce((s, e) => s + (Number(e.amount) || 0), 0)
  const monthLabel = (k) => { const [y, m] = k.split('-').map(Number); return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) }
  return (
    <>
      <div className="sb-acct-lede">
        Every card charge in the book, by the person whose name is on the card. Pick a person to see their total, their split by card and by what it was for, month by month, and every charge. Charges land here from the statement load (Inbox and confirmed alike); a charge still in the Inbox wears an INBOX tag.
      </div>
      <div className="sb-acct-controls">
        <input className="sb-acct-search" placeholder="Search vendor, note, what it was for…" value={q} onChange={e => setQ(e.target.value)} />
        <select className="sb-acct-in" value={card} onChange={e => setCard(e.target.value)}>
          <option value="all">All cards</option>
          {cards.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select className="sb-acct-in" value={month} onChange={e => setMonth(e.target.value)}>
          <option value="all">All months</option>
          {months.map(m => <option key={m} value={m}>{monthLabel(m)}</option>)}
        </select>
      </div>
      {loading ? <div className="sb-acct-empty">Loading the book…</div>
        : charges.length === 0 ? <div className="sb-acct-empty">No card charges in the book yet. Load a card statement (Statements & documents, then the monthly review) and they show here by person.</div>
        : (
          <>
            <div className="sb-acct-people">
              <button type="button" className={`sb-acct-ptile ${!person ? 'on' : ''}`} onClick={() => setPerson('')}>
                <div className="sb-acct-ptile-name">Everyone</div>
                <div className="sb-acct-ptile-total">{fmtUSD(everyone.total)}</div>
                <div className="sb-acct-ptile-sub">{everyone.n} charge{everyone.n === 1 ? '' : 's'} · {people.length} {people.length === 1 ? 'person' : 'people'}</div>
              </button>
              {people.map(p => (
                <button key={p.key} type="button" className={`sb-acct-ptile ${person === p.key ? 'on' : ''}`} onClick={() => setPerson(person === p.key ? '' : p.key)}>
                  <div className="sb-acct-ptile-name">{p.key}</div>
                  <div className="sb-acct-ptile-total">{fmtUSD(p.total)}</div>
                  <div className="sb-acct-ptile-sub">{p.n} charge{p.n === 1 ? '' : 's'} · {[...p.cards].length} card{p.cards.size === 1 ? '' : 's'}{p.last ? ` · last ${fmtDate(p.last)}` : ''}</div>
                  {p.personal > 0 && <div className="sb-acct-ptile-flag">{fmtUSD(p.personal)} to sort (shop vs personal)</div>}
                </button>
              ))}
            </div>

            <div className="sb-acct-pdetail">
              <div className="sb-acct-pdetail-head">
                <div className="sb-acct-pdetail-title">{sel ? sel.key : 'Everyone'}{bucketF && <> · {bucketF} <button type="button" className="sb-acct-link" onClick={() => setBucketF('')}>show everything</button></>} <span className="sb-acct-sub">{card === 'all' ? 'all cards' : card} · {month === 'all' ? 'all months' : monthLabel(month)}</span></div>
                <div className="sb-acct-summary" style={{ marginBottom: 0 }}>
                  <span>Total: <strong>{fmtUSD(shownTotal)}</strong></span>
                  <span><strong>{shown.length}</strong> charge{shown.length === 1 ? '' : 's'}</span>
                  <span>Avg: <strong>{fmtUSD(shown.length ? shownTotal / shown.length : 0)}</strong></span>
                  {inboxN > 0 && <span className="sb-acct-flag">{inboxN} still in the Inbox</span>}
                </div>
              </div>
              <div className="sb-acct-pdetail-grid">
                <div className="sb-acct-pbox">
                  <div className="sb-acct-pbox-h">By card</div>
                  {byCard.map(([k, v]) => (
                    <div key={k} className="sb-acct-pline"><span className="sb-acct-pline-k">{k}</span><span className="sb-acct-pline-bar"><span style={{ width: `${Math.round(v.total / (byCard[0][1].total || 1) * 100)}%` }} /></span><span className="sb-acct-pline-v">{fmtUSD(v.total)} <span className="sb-acct-sub">{v.n}</span></span></div>
                  ))}
                </div>
                <div className="sb-acct-pbox">
                  <div className="sb-acct-pbox-h">What it was for</div>
                  {topBuckets.map(([k, v]) => (
                    <button key={k} type="button" className={`sb-acct-pline sb-acct-pline-btn ${bucketF === k ? 'on' : ''}`} onClick={() => setBucketF(bucketF === k ? '' : k)} title="Click to see just these charges"><span className="sb-acct-pline-k">{k}</span><span className="sb-acct-pline-bar"><span style={{ width: `${Math.round(v / (topBuckets[0][1] || 1) * 100)}%` }} /></span><span className="sb-acct-pline-v">{fmtUSD(v)} <span className="sb-acct-sub">{personTotal > 0 ? `${Math.round(v / personTotal * 100)}%` : ''}</span></span></button>
                  ))}
                </div>
                <div className="sb-acct-pbox">
                  <div className="sb-acct-pbox-h">Month by month</div>
                  {byMonth.map(([k, v]) => (
                    <div key={k} className="sb-acct-pline"><span className="sb-acct-pline-k">{monthLabel(k)}</span><span className="sb-acct-pline-bar"><span style={{ width: `${Math.round(v.total / (Math.max(...byMonth.map(x => x[1].total)) || 1) * 100)}%` }} /></span><span className="sb-acct-pline-v">{fmtUSD(v.total)} <span className="sb-acct-sub">{v.n}</span></span></div>
                  ))}
                </div>
              </div>
            </div>

            <div className="sb-acct-table">
              <div className="sb-acct-row sb-acct-row-head sb-acct-cards-grid">
                <div>Date</div><div>Charge</div><div>Who</div><div>Card</div><div>Category</div><div className="num">Amount</div>
              </div>
              {shown.length === 0 ? <div className="sb-acct-empty">Nothing matches the filters.</div>
                : shown.map(e => (
                  <div key={e.id} className="sb-acct-row sb-acct-cards-grid">
                    <span>{e.expense_date ? fmtDate(e.expense_date) : '—'}</span>
                    <span>
                      <span className="sb-acct-vendor">{properName(e.vendor || '') || e.note || '—'}</span>
                      <div className="sb-acct-sub">{cardBucket(e)}{e.status === 'inbox' ? ' · ' : ''}{e.status === 'inbox' && <span className="sb-acct-chip sb-acct-chip-warn">INBOX</span>}{e.ai?.flag ? ` · ${e.ai.flag}` : ''}</div>
                    </span>
                    <span className="sb-acct-who">{holderKey(e.ai?.cardholder)}</span>
                    <span className="sb-acct-sub">{e.ai?.accountName || '—'}</span>
                    <select className="sb-acct-in" value={e.category || ''} onChange={ev => onSetCategory(e, ev.target.value || null)}>
                      <option value="">—</option>
                      {SCHEDC_CATEGORIES.map(c => <option key={c.code} value={c.code}>{c.label}</option>)}
                    </select>
                    <span className="num sb-acct-amt">
                      {e.amount != null ? fmtUSD(Number(e.amount)) : '—'}
                      {e.receipt_path && <button type="button" className="sb-acct-link" style={{ marginLeft: 8 }} onClick={() => onView(e.receipt_path)}>Receipt</button>}
                    </span>
                  </div>
                ))}
            </div>
          </>
        )}
    </>
  )
}
// ── Payroll stats (behind a PIN) ─────────────────────────────────────────────
// Paul 2026-10-30: "payroll stats, password protected; how much each
// person is being paid; I don't understand why payroll skyrocketed." The bank
// shows payroll as ADP lump debits per pay run (net wages, taxes, 401k, fees)
// plus checks written from the payroll account — so this page answers WHEN
// and HOW MUCH per run and per month, and names the checks by amount. Per-
// PERSON pay lives only in ADP's payroll register; upload it under Statements
// & documents › Payroll report and the next pass reads it in.
// The PIN is a courtesy curtain on a shared screen, not security: anyone who
// can sign in to Stonebooks can read these rows in the Expense book.
// Only the SHA-256 of the PIN lives here; the PIN itself is Paul's.
const PAYROLL_PIN_SHA256 = '3f735c67d29014733cf56508d3c5dba2c87abb07313998e23b49b7c8cc0d7e4a'
const sha256Hex = async (t) => { const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t)); return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('') }
const PAYROLL_KEY = 'sb_payroll_ok'
const payrollKind = (e) => {
  const v = `${e.vendor || ''} ${e.note || ''}`
  if (/net wages|wage pay/i.test(v)) return 'net'
  if (/payroll tax|adp tax/i.test(v)) return 'tax'
  if (/401/.test(v)) return 'k401'
  if (/service fee|payroll fee/i.test(v)) return 'fees'
  if (/^payroll check|payroll checking · check/i.test(v)) return 'check'
  return 'other'
}
const PAYROLL_KIND_LABEL = { net: 'Net wages (ADP)', tax: 'Payroll taxes (ADP)', k401: '401(k)', fees: 'ADP fees', check: 'Checks from the payroll account', other: 'Other payroll' }
const isPayrollRow = (e) => e.category === 'wages' || /^Payroll/.test(e.ai?.bucket || '')
function PayrollSection({ loading, expenses, docs, year }) {
  const [ok, setOk] = useState(() => { try { return sessionStorage.getItem(PAYROLL_KEY) === '1' } catch { return false } })
  const [pin, setPin] = useState('')
  const [bad, setBad] = useState(false)
  const [q, setQ] = useState('')
  const rows = useMemo(() => expenses.filter(isPayrollRow).sort((a, b) => String(b.expense_date || '').localeCompare(String(a.expense_date || ''))), [expenses])
  const months = useMemo(() => {
    const m = new Map()
    for (const e of rows) {
      const k = monthOf(e); if (!k) continue
      const r = m.get(k) || { key: k, total: 0, net: 0, tax: 0, k401: 0, fees: 0, check: 0, other: 0, runs: 0, checks: 0 }
      const amt = Number(e.amount) || 0, kind = payrollKind(e)
      r.total += amt; r[kind] += amt
      if (kind === 'net') r.runs++
      if (kind === 'check') r.checks++
      m.set(k, r)
    }
    const list = [...m.values()].sort((a, b) => a.key.localeCompare(b.key))
    list.forEach((r, i) => { const p = list[i - 1]; r.delta = p && p.total > 0 ? Math.round((r.total - p.total) / p.total * 100) : null })
    return list.reverse()
  }, [rows])
  const checksByAmount = useMemo(() => {
    const m = new Map()
    for (const e of rows) { if (payrollKind(e) !== 'check') continue; const k = (Number(e.amount) || 0).toFixed(2); const r = m.get(k) || { amount: Number(k), n: 0, dates: [] }; r.n++; r.dates.push(e.expense_date); m.set(k, r) }
    return [...m.values()].sort((a, b) => b.n * b.amount - a.n * a.amount)
  }, [rows])
  const payrollDocs = useMemo(() => docs.filter(d => d.kind === 'payroll'), [docs])
  const shown = useMemo(() => { const n = q.trim().toLowerCase(); return n ? rows.filter(e => `${e.vendor || ''} ${e.note || ''} ${PAYROLL_KIND_LABEL[payrollKind(e)]}`.toLowerCase().includes(n)) : rows }, [rows, q])
  const monthLabel = (k) => { const [y, m] = k.split('-').map(Number); return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) }
  const unlock = async () => { const h = await sha256Hex(pin.trim()).catch(() => ''); if (h === PAYROLL_PIN_SHA256) { setOk(true); setBad(false); try { sessionStorage.setItem(PAYROLL_KEY, '1') } catch { /* fine */ } } else setBad(true) }
  const lock = () => { setOk(false); setPin(''); try { sessionStorage.removeItem(PAYROLL_KEY) } catch { /* fine */ } }
  if (!ok) {
    return (
      <div className="sb-acct-gate">
        <div className="sb-acct-gate-box">
          <div className="sb-acct-gate-h">Payroll is behind a PIN</div>
          <div className="sb-acct-sub">Who is paid what stays off a shared screen. Type the PIN to open it for this browser session.</div>
          <input className="sb-acct-in" type="password" inputMode="numeric" autoFocus value={pin} placeholder="PIN" onChange={e => { setPin(e.target.value); setBad(false) }} onKeyDown={e => { if (e.key === 'Enter') unlock() }} />
          {bad && <div className="sb-acct-flag">That is not it.</div>}
          <button type="button" className="sb-acct-btn sb-acct-btn-dark" onClick={unlock}>Open payroll</button>
        </div>
      </div>
    )
  }
  const latest = months[0], prev = months[1]
  return (
    <>
      <div className="sb-acct-lede">
        Every payroll dollar the bank saw, by month and by pay run: ADP net wages, the payroll taxes ADP pulls, 401(k), ADP fees, and checks written from the payroll account. <b>Per-person pay is not in the bank data</b> — ADP moves one lump per run. Upload ADP's payroll register under Statements & documents (Payroll report) and the next pass reads names and amounts off it.
        <button type="button" className="sb-acct-link" style={{ marginLeft: 10 }} onClick={lock}>Lock</button>
      </div>
      {loading ? <div className="sb-acct-empty">Loading…</div> : rows.length === 0 ? <div className="sb-acct-empty">No payroll lines in the book yet — load the payroll account's statements.</div> : (
        <>
          {latest && prev && (
            <div className={`sb-acct-note ${latest.total > prev.total * 1.15 ? 'sb-acct-note-flag' : ''}`}>
              <h5>Why {monthLabel(latest.key)} reads {latest.delta != null ? `${latest.delta > 0 ? '+' : ''}${latest.delta}%` : 'the way it does'} against {monthLabel(prev.key)}</h5>
              <p>{monthLabel(latest.key)}: {latest.runs} pay run{latest.runs === 1 ? '' : 's'} ({fmtUSD(latest.net)} net wages, {fmtUSD(latest.tax)} taxes) and {latest.checks} check{latest.checks === 1 ? '' : 's'} from the payroll account ({fmtUSD(latest.check)}). {monthLabel(prev.key)}: {prev.runs} run{prev.runs === 1 ? '' : 's'} ({fmtUSD(prev.net)} net, {fmtUSD(prev.tax)} taxes) and {prev.checks} check{prev.checks === 1 ? '' : 's'} ({fmtUSD(prev.check)}). A month with a third biweekly pay date, or extra checks, is the usual reason a month jumps; a higher net per run means more hours or more people.</p>
            </div>
          )}
          <div className="sb-acct-table">
            <div className="sb-acct-row sb-acct-row-head sb-acct-pay-grid"><div>Month</div><div className="num">Runs</div><div className="num">Net wages</div><div className="num">Taxes</div><div className="num">401(k)</div><div className="num">Fees</div><div className="num">Checks</div><div className="num">Total</div><div className="num">vs prev</div></div>
            {months.map(r => (
              <div key={r.key} className="sb-acct-row sb-acct-pay-grid">
                <span><b>{monthLabel(r.key)}</b></span>
                <span className="num">{r.runs}</span>
                <span className="num">{fmtUSD(r.net)}</span>
                <span className="num">{fmtUSD(r.tax)}</span>
                <span className="num">{fmtUSD(r.k401)}</span>
                <span className="num">{fmtUSD(r.fees)}</span>
                <span className="num">{fmtUSD(r.check)}<span className="sb-acct-sub"> {r.checks || ''}</span></span>
                <span className="num sb-acct-amt">{fmtUSD(r.total)}</span>
                <span className={`num ${r.delta > 0 ? 'sb-acct-flag' : ''}`}>{r.delta == null ? '—' : `${r.delta > 0 ? '+' : ''}${r.delta}%`}</span>
              </div>
            ))}
          </div>
          <div className="sb-acct-taxgrid">
            <div className="sb-acct-note">
              <h5>Checks from the payroll account — who are they?</h5>
              {checksByAmount.length === 0 ? <p>None.</p> : checksByAmount.map(c => (
                <div key={c.amount} className="sb-acct-pendrow"><span>{fmtUSD(c.amount)} × {c.n} — {c.dates.map(d => fmtDate(d)).join(', ')}</span><span className="sb-acct-sub">{c.n > 1 ? 'the same amount every time reads as one person' : ''}</span></div>
              ))}
              <p className="sb-acct-sub">Name them in the Inbox / Expense book (the vendor field) and they will read as people here.</p>
            </div>
            <div className="sb-acct-note">
              <h5>Per-person pay</h5>
              {payrollDocs.length === 0
                ? <p>No ADP payroll register in the cabinet yet. Upload one month's register under <b>Statements & documents › Payroll report</b>, then ask Claude to read it: names, gross, net, hours, per run.</p>
                : <p>{payrollDocs.length} payroll report{payrollDocs.length === 1 ? '' : 's'} in the cabinet ({payrollDocs.map(d => d.month).filter(Boolean).join(', ')}). Ask Claude to read them into per-person rows.</p>}
            </div>
          </div>
          <div className="sb-acct-controls"><input className="sb-acct-search" placeholder="Search payroll lines…" value={q} onChange={e => setQ(e.target.value)} /><span className="sb-acct-filt-sum">{shown.length} line{shown.length === 1 ? '' : 's'} · {fmtUSD(shown.reduce((t, e) => t + (Number(e.amount) || 0), 0))}</span></div>
          <div className="sb-acct-table">
            <div className="sb-acct-row sb-acct-row-head sb-acct-payrow-grid"><div>Date</div><div>What</div><div>Kind</div><div className="num">Amount</div></div>
            {shown.slice(0, 300).map(e => (
              <div key={e.id} className="sb-acct-row sb-acct-payrow-grid">
                <span>{e.expense_date ? fmtDate(e.expense_date) : '—'}</span>
                <span><span className="sb-acct-vendor">{e.vendor || '—'}</span><div className="sb-acct-sub">{e.note || ''}{e.status === 'inbox' ? ' · INBOX' : ''}</div></span>
                <span className="sb-acct-sub">{PAYROLL_KIND_LABEL[payrollKind(e)]}</span>
                <span className="num sb-acct-amt">{e.amount != null ? fmtUSD(Number(e.amount)) : '—'}</span>
              </div>
            ))}
          </div>
        </>
      )}
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
const TAX_PERIODS = [
  { code: 'year', label: 'Whole year', months: [1, 12] },
  { code: 'Q1', label: 'Q1 · Jan–Mar', months: [1, 3] },
  { code: 'Q2', label: 'Q2 · Apr–Jun', months: [4, 6] },
  { code: 'Q3', label: 'Q3 · Jul–Sep', months: [7, 9] },
  { code: 'Q4', label: 'Q4 · Oct–Dec', months: [10, 12] },
]
const pad2 = (n) => String(n).padStart(2, '0')
function TaxSection({ loading, expenses, income: incomeYear, incomeByMonth = {}, year, onResolvePending }) {
  // Whole year or a quarter (Paul 2026-10-30: "broken up yearly and quarterly").
  const [period, setPeriod] = useState('year')
  const per = TAX_PERIODS.find(p => p.code === period) || TAX_PERIODS[0]
  const from = `${year}-${pad2(per.months[0])}-01`
  const to = `${year}-${pad2(per.months[1])}-31`
  const inP = useMemo(() => inRangeFor({ from, to }), [from, to])
  const income = useMemo(() => {
    if (period === 'year') return incomeYear
    let t = 0; for (let m = per.months[0]; m <= per.months[1]; m++) t += incomeByMonth[`${year}-${pad2(m)}`] || 0
    return t
  }, [period, incomeYear, incomeByMonth, year, per])
  const sched = useMemo(() => summarizeSchedC(expenses, { from, to }), [expenses, from, to])
  const flags = useMemo(() => analyzeBooks(expenses, { from, to }), [expenses, from, to])
  const pending = expenses.filter(e => inP(e) && e.status === 'confirmed' && e.writeoff === 'pending')
  // Months in this period (up to today) with NO statement lines loaded — the
  // book is blind there, so the profit number is too high by whatever those
  // months cost.
  const blindMonths = useMemo(() => {
    const now = new Date(); const cur = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}`
    const have = new Set(expenses.filter(e => e.source === 'statement').map(monthOf))
    const out = []
    for (let m = per.months[0]; m <= per.months[1]; m++) { const k = `${year}-${pad2(m)}`; if (k <= cur && !have.has(k)) out.push(k) }
    return out
  }, [expenses, per, year])
  const loansP = expenses.filter(e => inP(e) && (e.ai?.bucket === 'Mortgage & loans')).reduce((t, e) => t + (Number(e.amount) || 0), 0)
  // Inbox lines are NOT in the write-off total until confirmed (Paul 2026-10-30:
  // "shouldn't the write-off be much higher?" — it was: 534 statement lines sat
  // in the Inbox). Say so on the tile instead of letting the number mislead.
  const inboxYear = expenses.filter(e => inP(e) && e.status === 'inbox')
  const inboxUsd = inboxYear.reduce((t, e) => t + (Number(e.amount) || 0), 0)
  const profit = income - sched.totalDeductible
  // Rough self-employment + income tax figure — clearly labeled rough; the
  // packet carries the worksheets and the CPA trues it up.
  const seTax = Math.max(0, profit * 0.9235 * 0.153)
  const [busy, setBusy] = useState(false)
  // Click a Schedule C line → every row behind it, searchable (Paul
  // 2026-10-30: "click on permits and scroll through and see and search").
  const [drill, setDrill] = useState(null)   // a category code, or 'cogs' for all three
  const [dq, setDq] = useState('')
  const drillRows = useMemo(() => {
    if (!drill) return []
    const needle = dq.trim().toLowerCase()
    return expenses.filter(e => inP(e)
      && (drill === 'cogs' ? COGS_CODES.includes(e.category) : (e.category || 'other') === drill)
      && (!needle || `${e.vendor || ''} ${e.note || ''} ${e.ai?.bucket || ''}`.toLowerCase().includes(needle)))
      .sort((a, b) => String(b.expense_date || '').localeCompare(String(a.expense_date || '')))
  }, [expenses, inP, drill, dq])
  const drillCounted = drillRows.reduce((t, e) => t + deductibleAmount(e), 0)
  const drillAll = drillRows.reduce((t, e) => t + (Number(e.amount) || 0), 0)
  const drillLabel = drill === 'cogs' ? 'Cost of goods sold' : schedcLabel(drill)
  const toggle = (code) => { setDrill(d => d === code ? null : code); setDq('') }
  return (
    <>
      <div className="sb-acct-lede">
        The year, shaped like the form your return files on — <b>Schedule C</b>, single-member LLC. It knows where you operate (Perth Amboy, NJ · Middlesex County): meals capped 50%, federal + New Jersey quarterlies. Estimates here are rough by design — <b>the packet preps the filing, your CPA signs</b>.
      </div>
      <div className="sb-acct-filt" style={{ marginBottom: 12 }}>
        {TAX_PERIODS.map(p => <button key={p.code} type="button" className={`sb-acct-fchip ${period === p.code ? 'on' : ''}`} onClick={() => { setPeriod(p.code); setDrill(null) }}>{p.label}</button>)}
      </div>
      <div className="sb-acct-cards">
        <div className="sb-acct-card sb-acct-card-green"><div className="k">Income · {period === 'year' ? year : `${year} ${period}`}</div><div className="v">{loading ? '—' : fmtUSD(income)}</div><div className="s">order payments in</div></div>
        <div className="sb-acct-card"><div className="k">Write-offs · {period === 'year' ? year : `${year} ${period}`}</div><div className="v">{loading ? '—' : fmtUSD(sched.totalDeductible)}</div><div className="s">confirmed, caps applied{inboxUsd > 0 && <span className="sb-acct-flag"> · {fmtUSD(inboxUsd)} in {inboxYear.length} Inbox lines not counted yet</span>}</div></div>
        <div className="sb-acct-card sb-acct-card-gold"><div className="k">Tentative profit</div><div className="v">{loading ? '—' : fmtUSD(profit)}</div><div className="s">what tax is figured on</div></div>
        <div className="sb-acct-card sb-acct-card-red"><div className="k">Your call</div><div className="v">{loading ? '—' : pending.length}</div><div className="s">write-off decisions waiting</div></div>
      </div>

      <div className="sb-acct-taxgrid">
        <div className="sb-acct-sched">
          <div className="sb-acct-schedhead">
            <span>Schedule C — {year}{period !== 'year' ? ` · ${per.label}` : ''}</span>
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
          <button type="button" className={`sb-acct-schedrow sb-acct-schedbtn ${drill === 'cogs' ? 'on' : ''}`} onClick={() => toggle('cogs')}><span><i>4</i>Cost of goods sold (materials)</span><b>{fmtUSD(sched.cogs)}</b></button>
          {(sched.cogsLines || []).map(l => (
            <button key={l.code} type="button" className={`sb-acct-schedrow sb-acct-schedbtn sb-acct-schedind ${drill === l.code ? 'on' : ''}`} onClick={() => toggle(l.code)}><span>{l.label.replace(/^Materials — /, '')}</span><b>{fmtUSD(l.total)}</b></button>
          ))}
          <div className="sb-acct-schedrow sb-acct-schedsub"><span>Gross profit</span><b>{fmtUSD(income - sched.cogs)}</b></div>
          {sched.lines.map(l => (
            <button key={l.code} type="button" className={`sb-acct-schedrow sb-acct-schedbtn ${drill === l.code ? 'on' : ''}`} onClick={() => toggle(l.code)}><span><i>{l.line}</i>{l.label}</span><b>{fmtUSD(l.total)}</b></button>
          ))}
          <div className="sb-acct-schedrow sb-acct-schedtotal"><span>Tentative profit</span><b>{fmtUSD(profit)}</b></div>
          {drill && (
            <div className="sb-acct-drill">
              <div className="sb-acct-drill-head">
                <div><b>{drillLabel}</b> · {year} <span className="sb-acct-sub">{drillRows.length} row{drillRows.length === 1 ? '' : 's'} · counted {fmtUSD(drillCounted)}{drillAll !== drillCounted ? ` · all lines ${fmtUSD(drillAll)}` : ''}</span></div>
                <button type="button" className="sb-acct-link" onClick={() => setDrill(null)}>close</button>
              </div>
              <input className="sb-acct-search" placeholder={`Search ${drillLabel.toLowerCase()}…`} value={dq} onChange={e => setDq(e.target.value)} />
              <div className="sb-acct-drill-list">
                {drillRows.length === 0 && <div className="sb-acct-empty">Nothing here{dq ? ' for that search' : ''}.</div>}
                {drillRows.slice(0, 300).map(e => {
                  const counted = deductibleAmount(e) > 0
                  return (
                    <div key={e.id} className="sb-acct-drill-row">
                      <span className="sb-acct-drill-date">{e.expense_date ? fmtDate(e.expense_date) : '—'}</span>
                      <span className="sb-acct-drill-main"><span className="sb-acct-vendor">{properName(e.vendor || '') || e.note || '—'}</span><div className="sb-acct-sub">{[e.source === 'outgoing' ? 'Payments › Outgoing' : e.source === 'statement' ? (e.ai?.accountName || 'statement') : e.source, e.ai?.cardholder ? holderKey(e.ai.cardholder) : null, e.note && e.vendor ? e.note : null].filter(Boolean).join(' · ')}</div></span>
                      <span>{counted ? <span className="sb-acct-chip sb-acct-chip-good">COUNTED</span> : e.status === 'inbox' ? <span className="sb-acct-chip sb-acct-chip-warn">INBOX</span> : <span className="sb-acct-chip sb-acct-chip-bad">{e.writeoff === 'no' ? 'EXCLUDED' : 'YOUR CALL'}</span>}</span>
                      <span className="num sb-acct-amt">{e.amount != null ? fmtUSD(Number(e.amount)) : '—'}</span>
                    </div>
                  )
                })}
                {drillRows.length > 300 && <div className="sb-acct-sub">Showing 300 of {drillRows.length} — narrow it with the search.</div>}
              </div>
            </div>
          )}
        </div>

        <div>
          {/* Paul 2026-10-30: "I still don't see how there is $600k in tentative
              profit — we aren't profitable." This is a TAX-FORM number built from
              confirmed write-offs only; the box says exactly what it is missing. */}
          <div className="sb-acct-note sb-acct-note-flag">
            <h5>Why this profit is not your cash profit</h5>
            <p>Only <b>confirmed</b> write-offs count here. {inboxUsd > 0 ? <>The Inbox still holds <b>{fmtUSD(inboxUsd)}</b> in {inboxYear.length} lines for this period that are not counted yet — confirm them and the profit drops by most of that. </> : null}
            {blindMonths.length > 0 ? <>No bank or card statement lines are loaded for <b>{blindMonths.length} month{blindMonths.length === 1 ? '' : 's'}</b> in this period ({blindMonths.join(', ')}) — payroll, loans, insurance and card spend for those months are simply absent, so the book is blind there. </> : null}
            {loansP > 0 ? <>Loan and mortgage payments ({fmtUSD(loansP)} here) are cash out but mostly not deductible (principal is not an expense), so they never lower this number. </> : null}
            Cash in versus cash out, the number that says whether the shop made money, is on Reports › Monthly review.</p>
          </div>
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
  .sb-acct-cards-grid { grid-template-columns: 92px 1.6fr 150px 170px 170px 130px; }
  .sb-acct-schedbtn { font: inherit; width: 100%; text-align: left; background: none; border: none; border-bottom: 0.5px solid #efece6; cursor: pointer; color: inherit; }
  .sb-acct-schedbtn:hover { background: #FBF9F4; } .sb-acct-schedbtn.on { background: #16150F; color: #F3EAD6; } .sb-acct-schedbtn.on b { color: #E9C46A; } .sb-acct-schedbtn.on i { color: #BDB6A6; }
  .sb-acct-schedind { padding-left: 34px !important; font-size: 12.5px; color: #6b6b66; }
  .sb-acct-drill { border-top: 2px solid #16150F; padding: 12px 14px 8px; background: #FBF9F4; }
  .sb-acct-drill-head { display: flex; justify-content: space-between; gap: 12px; align-items: baseline; margin-bottom: 8px; flex-wrap: wrap; }
  .sb-acct-drill-list { margin-top: 8px; max-height: 520px; overflow-y: auto; }
  .sb-acct-drill-row { display: grid; grid-template-columns: 92px minmax(0, 1fr) 110px 110px; gap: 10px; align-items: center; padding: 7px 0; border-bottom: 0.5px solid #efece6; font-size: 13px; }
  .sb-acct-drill-row > * { min-width: 0; overflow-wrap: anywhere; } .sb-acct-drill-date { white-space: nowrap; color: #6b6b66; }
  .sb-acct-pay-grid { grid-template-columns: 150px 60px 1fr 1fr 90px 80px 1fr 1fr 80px; }
  .sb-acct-payrow-grid { grid-template-columns: 92px 1.6fr 200px 120px; }
  .sb-acct-gate { display: flex; justify-content: center; padding: 40px 0; }
  .sb-acct-gate-box { width: min(380px, 100%); background: #fff; border: 0.5px solid #e6e3dd; border-radius: 12px; padding: 20px; display: flex; flex-direction: column; gap: 10px; }
  .sb-acct-gate-h { font-size: 17px; font-weight: 800; color: #16150F; }
  .sb-acct-cards-grid > * { min-width: 0; overflow-wrap: anywhere; }
  .sb-acct-who { font-weight: 700; color: #16150F; }
  .sb-acct-people { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 10px; margin-bottom: 14px; }
  .sb-acct-ptile { font: inherit; text-align: left; background: #fff; border: 1px solid #e6e3dd; border-radius: 12px; padding: 12px 14px; cursor: pointer; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
  .sb-acct-ptile:hover { border-color: #C9A468; }
  .sb-acct-ptile.on { background: #16150F; border-color: #16150F; color: #F3EAD6; }
  .sb-acct-ptile-name { font-weight: 800; font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .sb-acct-ptile-total { font-size: 22px; font-weight: 800; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
  .sb-acct-ptile.on .sb-acct-ptile-total { color: #C9A468; }
  .sb-acct-ptile-sub { font-size: 11.5px; color: #8a8a85; overflow-wrap: anywhere; } .sb-acct-ptile.on .sb-acct-ptile-sub { color: #BDB6A6; }
  .sb-acct-ptile-flag { font-size: 11px; font-weight: 700; color: #B3261E; margin-top: 4px; overflow-wrap: anywhere; } .sb-acct-ptile.on .sb-acct-ptile-flag { color: #F2A59E; }
  .sb-acct-pdetail { background: #fff; border: 1px solid #e6e3dd; border-radius: 12px; padding: 14px 16px; margin-bottom: 14px; min-width: 0; }
  .sb-acct-pdetail-head { display: flex; justify-content: space-between; gap: 14px; align-items: baseline; flex-wrap: wrap; margin-bottom: 10px; }
  .sb-acct-pdetail-title { font-size: 17px; font-weight: 800; color: #16150F; overflow-wrap: anywhere; }
  .sb-acct-pdetail-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 14px; }
  .sb-acct-pbox { min-width: 0; }
  .sb-acct-pbox-h { font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.08em; font-weight: 700; color: #8a8a85; margin-bottom: 6px; }
  .sb-acct-pline { display: grid; grid-template-columns: minmax(0, 1.1fr) minmax(50px, 1fr) auto; gap: 8px; align-items: center; font-size: 12.5px; padding: 3px 0; min-width: 0; }
  .sb-acct-pline-k { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #16150F; }
  .sb-acct-pline-bar { height: 7px; background: #efece6; border-radius: 999px; overflow: hidden; } .sb-acct-pline-bar span { display: block; height: 100%; background: #C9A468; border-radius: 999px; }
  .sb-acct-pline-v { font-variant-numeric: tabular-nums; font-weight: 700; white-space: nowrap; color: #16150F; }
  .sb-acct-pline-btn { font: inherit; width: 100%; text-align: left; background: none; border: none; border-radius: 6px; cursor: pointer; padding: 3px 4px; }
  .sb-acct-pline-btn:hover { background: #FBF9F4; } .sb-acct-pline-btn.on { background: #16150F; } .sb-acct-pline-btn.on .sb-acct-pline-k, .sb-acct-pline-btn.on .sb-acct-pline-v { color: #F3EAD6; } .sb-acct-pline-btn.on .sb-acct-sub { color: #BDB6A6; }
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
  .sb-acct-filt { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin: 0 0 10px; min-width: 0; }
  .sb-acct-filt-lab { font-size: 10.5px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; color: #8a8a85; }
  .sb-acct-fchip { font: inherit; font-size: 12px; font-weight: 700; padding: 5px 12px; border-radius: 999px; border: 1px solid #e6e3dd; background: #fff; color: #6a6a66; cursor: pointer; white-space: nowrap; }
  .sb-acct-fchip.on { background: #16150F; border-color: #16150F; color: #C9A468; }
  .sb-acct-filt-sel { max-width: 320px; }
  .sb-acct-filt-sum { font-size: 12.5px; font-weight: 700; color: #2c2c2a; white-space: nowrap; }
  .sb-acct-filt-arm { display: inline-flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 12.5px; font-weight: 700; color: #B3261E; }
  .sb-acct-flag { color: #B3261E; font-weight: 700; }
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



