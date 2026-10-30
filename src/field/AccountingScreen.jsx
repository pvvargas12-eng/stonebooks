// =============================================================================
// AccountingScreen — the Accounting tab on the phone, every feature (Paul
// 2026-10-30: "accounting as well with all the features to see everything…
// only my SB Field"). Owner tile gated to Paul alone in MoreScreen.
// =============================================================================
// Five sub-views, the same truths as the desktop tab (acct_expenses,
// acct_documents, orders.payments[]), phone-first:
//   INBOX      every unfiled line (statement loads, phone snaps, uploads):
//              filter by source / account / what it was for, fix the category
//              and the write-off call, Confirm one or Confirm all shown.
//   BOOK       the confirmed book: month / category / write-off filters,
//              search, totals + deductible, category and write-off edits,
//              receipt view / attach.
//   CARDS      card charges by person (the CARDS-BY-PERSON rule): pick a person
//              for total, by card, what it was for, month by month, history.
//   STATEMENTS the filing cabinet: upload (kind, month, label, the file),
//              open, delete.
//   TAX        the Schedule C shape: income, write-offs (+ the Inbox money not
//              counted yet), tentative profit, your-call decisions, the book
//              review flags, the CPA packet.
// Writes go through the same acctData helpers the desktop uses.
// =============================================================================
import { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { fmtUSD, fmtDate, properName } from '../lib/stonebooksData'
import {
  listAcctExpenses, updateAcctExpense, confirmAcctExpense, deleteAcctExpense, sweepOutgoingIntoBook,
  listAcctDocuments, addAcctDocument, deleteAcctDocument, uploadAcctFile, acctFileUrl,
  SCHEDC_CATEGORIES, schedcLabel, DOC_KINDS, docKindLabel, deductibleAmount, summarizeSchedC, analyzeBooks, downloadCpaPacket,
  holderKey, isCardCharge, cardBucket, PERSONAL_HINT,
} from '../lib/acctData'

const MONO = '"JetBrains Mono", Consolas, monospace'
const SUBS = [
  { key: 'inbox', label: 'Inbox' },
  { key: 'book', label: 'Book' },
  { key: 'cards', label: 'Cards' },
  { key: 'docs', label: 'Statements' },
  { key: 'tax', label: 'Tax' },
]
const WRITEOFF_OPTS = [
  { code: 'yes', label: 'Write off' },
  { code: 'no', label: "Don't write off" },
  { code: 'pending', label: 'Your call' },
]
const SOURCE_LABEL = { statement: 'statement', phone: 'phone snap', upload: 'upload', outgoing: 'Payments › Outgoing' }
const monthOf = (e) => String(e.expense_date || '').slice(0, 7)
const monthName = (k) => { const [y, m] = String(k).split('-').map(Number); return m ? new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) : k }
const isRealPayment = (p) => p && (p.locked ?? true) && !p.voided
const payDate = (p) => String(p.receivedAt || p.createdAt || '').slice(0, 10)

// ── Small phone pieces ──────────────────────────────────────────────────────
const selStyle = { font: 'inherit', fontSize: 13, padding: '8px 10px', borderRadius: 10, border: '1px solid #E2DCCE', background: '#fff', color: '#16150F', minHeight: 40, width: '100%', minWidth: 0 }
const inputStyle = { ...selStyle }
function Chip({ on, children, onClick, tone }) {
  const bg = on ? '#16150F' : '#fff', fg = on ? '#E9C46A' : (tone === 'red' ? '#B00020' : '#55503F')
  return (
    <button type="button" onClick={onClick} aria-pressed={!!on}
      style={{ font: 'inherit', fontSize: 13, fontWeight: 700, padding: '7px 12px', borderRadius: 999, cursor: 'pointer', minHeight: 36, background: bg, color: fg, border: `1px solid ${on ? '#16150F' : '#E2DCCE'}`, whiteSpace: 'nowrap' }}>
      {children}
    </button>
  )
}
function Btn({ children, onClick, tone = 'ghost', disabled, style }) {
  const base = { font: 'inherit', fontSize: 13.5, fontWeight: 700, padding: '9px 12px', borderRadius: 10, cursor: disabled ? 'default' : 'pointer', minHeight: 40, border: '1px solid #E2DCCE', background: '#fff', color: '#16150F', opacity: disabled ? 0.5 : 1, whiteSpace: 'nowrap' }
  if (tone === 'gold') Object.assign(base, { background: '#B8862B', borderColor: '#B8862B', color: '#fff' })
  if (tone === 'dark') Object.assign(base, { background: '#16150F', borderColor: '#16150F', color: '#E9C46A' })
  if (tone === 'red') Object.assign(base, { color: '#B00020', borderColor: '#E8B4AF' })
  return <button type="button" onClick={onClick} disabled={disabled} style={{ ...base, ...style }}>{children}</button>
}
const Amt = ({ v, tone }) => <span style={{ fontFamily: MONO, fontSize: 15, fontWeight: 700, whiteSpace: 'nowrap', color: tone === 'bad' ? '#B00020' : tone === 'good' ? '#1F7A3A' : '#16150F' }}>{v != null ? fmtUSD(Number(v)) : '—'}</span>
const Sub = ({ children, red }) => <div style={{ fontSize: 11.5, color: red ? '#B00020' : '#8A7F6C', marginTop: 2, overflowWrap: 'anywhere', fontWeight: red ? 700 : 400 }}>{children}</div>
const Card = ({ children, style }) => <div className="fl-row" style={{ cursor: 'default', display: 'block', ...style }}>{children}</div>
const Tile = ({ label, value, sub, tone }) => (
  <div style={{ flex: '1 1 46%', minWidth: 0 }}>
    <div className="fl-lab">{label}</div>
    <div style={{ fontFamily: MONO, fontSize: 20, fontWeight: 700, color: tone === 'bad' ? '#B00020' : tone === 'good' ? '#1F7A3A' : '#16150F', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{value}</div>
    {sub && <Sub>{sub}</Sub>}
  </div>
)
const StatRow = ({ k, v, sub }) => (
  <div className="fl-statusrow">
    <span className="lab" style={{ minWidth: 0, overflowWrap: 'anywhere' }}>{k}</span>
    <span style={{ fontFamily: MONO, fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap', marginLeft: 10 }}>{v}{sub && <span style={{ fontFamily: 'inherit', fontWeight: 400, fontSize: 11, color: '#8A7F6C', marginLeft: 5 }}>{sub}</span>}</span>
  </div>
)
function CatSel({ e, onChange }) {
  return (
    <select style={selStyle} value={e.category || ''} onChange={ev => onChange(ev.target.value || null)}>
      <option value="">— category —</option>
      {SCHEDC_CATEGORIES.map(c => <option key={c.code} value={c.code}>{c.label}</option>)}
    </select>
  )
}
function WoSel({ e, onChange }) {
  const color = e.writeoff === 'yes' ? '#1F7A3A' : e.writeoff === 'no' ? '#B00020' : '#9A7209'
  return (
    <select style={{ ...selStyle, color, fontWeight: 700 }} value={e.writeoff || 'pending'} onChange={ev => onChange(ev.target.value)}>
      {WRITEOFF_OPTS.map(w => <option key={w.code} value={w.code}>{w.label}</option>)}
    </select>
  )
}

// Every non-archived order's payments, paged (income for the Tax view).
async function fetchIncome(year) {
  let total = 0
  for (let start = 0; ; start += 1000) {
    const { data, error } = await supabase.from('orders').select('id, payments')
      .or('archived.is.null,archived.eq.false').order('id', { ascending: true }).range(start, start + 999)
    if (error) { console.warn('[field] accounting income:', error.message); break }
    for (const o of data || []) for (const p of (Array.isArray(o.payments) ? o.payments : [])) {
      if (!isRealPayment(p)) continue
      if (payDate(p).startsWith(year)) total += Number(p.amount) || 0
    }
    if (!data || data.length < 1000) break
  }
  return total
}

// `preload` = { expenses, docs, income } skips the network (smoke mounts only).
export default function AccountingScreen({ who, onBack, preload = null }) {
  const [sub, setSub] = useState('inbox')
  const [expenses, setExpenses] = useState(() => preload?.expenses || null)
  const [docs, setDocs] = useState(() => preload?.docs || null)
  const [income, setIncome] = useState(() => preload?.income ?? null)
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)
  const [year] = useState(() => String(new Date().getFullYear()))
  const by = who?.name || null

  const loadExpenses = useCallback(async () => {
    try { await sweepOutgoingIntoBook() } catch { /* best-effort mirror */ }
    setExpenses(await listAcctExpenses({ limit: 6000 }))
  }, [])
  const loadDocs = useCallback(async () => setDocs(await listAcctDocuments()), [])
  useEffect(() => {
    if (preload) return undefined
    let c = false
    loadExpenses(); loadDocs()
    fetchIncome(year).then(v => { if (!c) setIncome(v) })
    return () => { c = true }
  }, [loadExpenses, loadDocs, year, preload])

  const patchLocal = (id, patch) => setExpenses(prev => (prev || []).map(e => e.id === id ? { ...e, ...patch } : e))
  const dropLocal = (id) => setExpenses(prev => (prev || []).filter(e => e.id !== id))
  const openFile = async (path) => { const r = await acctFileUrl(path, 600); if (r.ok) window.open(r.url, '_blank', 'noopener'); else setErr(r.error) }

  const inbox = useMemo(() => (expenses || []).filter(e => e.status === 'inbox'), [expenses])
  const book = useMemo(() => (expenses || []).filter(e => e.status === 'confirmed'), [expenses])
  const loading = expenses === null

  // Writes, shared by the views.
  const setCategory = async (e, category, { persist = true } = {}) => {
    patchLocal(e.id, { category })
    if (!persist) return
    const r = await updateAcctExpense(e.id, { category }); if (!r.ok) { setErr(r.error); loadExpenses() }
  }
  const setWriteoff = async (e, writeoff, { persist = true } = {}) => {
    const pct = writeoff === 'yes' ? (e.category === 'meals' ? 50 : 100) : e.writeoff_pct
    patchLocal(e.id, { writeoff, writeoff_pct: pct })
    if (!persist) return
    const r = await updateAcctExpense(e.id, { writeoff, writeoffPct: pct }); if (!r.ok) { setErr(r.error); loadExpenses() }
  }
  const confirmOne = async (e) => {
    const r = await confirmAcctExpense(e.id, { by, category: e.category, writeoff: e.writeoff, writeoffPct: e.writeoff_pct })
    if (!r.ok) { setErr(r.error); return false }
    patchLocal(e.id, { status: 'confirmed' }); return true
  }
  const confirmMany = async (list) => {
    setBusy(true); let failed = 0
    for (const e of list) { if (!(await confirmOne(e))) failed++ }
    setBusy(false)
    if (failed) setErr(`${failed} row${failed === 1 ? '' : 's'} could not be confirmed.`)
  }
  const deleteOne = async (e) => {
    if (!window.confirm('Delete this line? Use this for mistaken snaps only.')) return
    const r = await deleteAcctExpense(e.id); if (!r.ok) { setErr(r.error); return }
    dropLocal(e.id)
  }
  const attachReceipt = async (e, file) => {
    const up = await uploadAcctFile(`acct/${year}`, file); if (!up.ok) { setErr(up.error); return }
    const r = await updateAcctExpense(e.id, { receiptPath: up.path }); if (!r.ok) { setErr(r.error); return }
    patchLocal(e.id, { receipt_path: up.path })
  }

  return (
    <div style={{ minWidth: 0 }}>
      {onBack && (
        <button type="button" className="fl-rowline" onClick={onBack}
          style={{ color: '#9A7209', fontWeight: 700, fontSize: 15, minHeight: 44 }}>
          &#8249; Menu
        </button>
      )}
      <div className="fl-greet" style={{ fontSize: 29 }}>Accounting</div>
      <div className="fl-greet-sub">Every dollar out — the same book as the desktop, on the phone</div>

      <div style={{ display: 'flex', gap: 6, overflowX: 'auto', padding: '12px 0 6px', margin: '0 -2px' }}>
        {SUBS.map(s => (
          <Chip key={s.key} on={sub === s.key} onClick={() => { setSub(s.key); setErr(null) }}>
            {s.label}{s.key === 'inbox' && inbox.length > 0 && <span style={{ marginLeft: 6, fontSize: 11, padding: '1px 6px', borderRadius: 999, background: sub === 'inbox' ? '#E9C46A' : '#B00020', color: sub === 'inbox' ? '#16150F' : '#fff' }}>{inbox.length}</span>}
          </Chip>
        ))}
      </div>
      {err && <div className="fl-empty" style={{ color: '#B00020' }}>{err}</div>}

      {sub === 'inbox' && <InboxView loading={loading} rows={inbox} busy={busy} onCategory={(e, c) => setCategory(e, c, { persist: false })} onWriteoff={(e, w) => setWriteoff(e, w, { persist: false })} onConfirm={confirmOne} onConfirmMany={confirmMany} onDelete={deleteOne} onOpen={openFile} />}
      {sub === 'book' && <BookView loading={loading} rows={book} year={year} onCategory={setCategory} onWriteoff={setWriteoff} onOpen={openFile} onAttach={attachReceipt} />}
      {sub === 'cards' && <CardsView loading={loading} rows={expenses || []} onCategory={setCategory} onOpen={openFile} />}
      {sub === 'docs' && <DocsView loading={docs === null} rows={docs || []} year={year} by={by} onOpen={openFile} onChanged={loadDocs} onErr={setErr} />}
      {sub === 'tax' && <TaxView loading={loading || income === null} expenses={expenses || []} income={income || 0} year={year} onWriteoff={setWriteoff} onErr={setErr} />}
    </div>
  )
}

// ── INBOX ───────────────────────────────────────────────────────────────────
function InboxView({ loading, rows, busy, onCategory, onWriteoff, onConfirm, onConfirmMany, onDelete, onOpen }) {
  const [src, setSrc] = useState('all')
  const [acct, setAcct] = useState('all')
  const [bucket, setBucket] = useState('all')
  const [armed, setArmed] = useState(false)
  const [limit, setLimit] = useState(60)
  const accts = useMemo(() => [...new Set(rows.map(e => e.ai?.accountName).filter(Boolean))].sort(), [rows])
  const buckets = useMemo(() => [...new Set(rows.map(e => e.ai?.bucket).filter(Boolean))].sort(), [rows])
  const shown = useMemo(() => rows.filter(e =>
    (src === 'all' || e.source === src) && (acct === 'all' || e.ai?.accountName === acct) && (bucket === 'all' || e.ai?.bucket === bucket)), [rows, src, acct, bucket])
  const ready = shown.filter(e => e.category)
  const total = shown.reduce((s, e) => s + (Number(e.amount) || 0), 0)
  return (
    <>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
        {[['all', 'All'], ['statement', 'Statement'], ['phone', 'Phone snap'], ['upload', 'Upload']].map(([k, l]) => <Chip key={k} on={src === k} onClick={() => setSrc(k)}>{l}</Chip>)}
      </div>
      {(accts.length > 0 || buckets.length > 0) && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginTop: 8 }}>
          <select style={selStyle} value={acct} onChange={e => setAcct(e.target.value)}><option value="all">All accounts</option>{accts.map(a => <option key={a} value={a}>{a}</option>)}</select>
          <select style={selStyle} value={bucket} onChange={e => setBucket(e.target.value)}><option value="all">Everything</option>{buckets.map(b => <option key={b} value={b}>{b}</option>)}</select>
        </div>
      )}
      <div className="fl-sect"><span className="fl-sect-h">{shown.length} shown · {fmtUSD(total)}</span></div>
      {ready.length > 0 && (
        !armed
          ? <Btn tone="gold" style={{ width: '100%' }} disabled={busy} onClick={() => setArmed(true)}>{busy ? 'Confirming…' : `Confirm all shown (${ready.length})`}</Btn>
          : (
            <Card>
              <div style={{ fontWeight: 700, overflowWrap: 'anywhere' }}>File {ready.length} line{ready.length === 1 ? '' : 's'} into the book as they read now?{shown.length > ready.length && ` ${shown.length - ready.length} with no category stay in the Inbox.`}</div>
              <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                <Btn tone="dark" style={{ flex: 1 }} onClick={() => { setArmed(false); onConfirmMany(ready) }}>Yes, confirm {ready.length}</Btn>
                <Btn onClick={() => setArmed(false)}>Cancel</Btn>
              </div>
            </Card>
          )
      )}
      {loading ? <div className="fl-empty">Loading the inbox…</div>
        : shown.length === 0 ? <div className="fl-empty-serif">{rows.length === 0 ? 'Inbox is clear.' : 'Nothing matches the filters.'}</div>
        : shown.slice(0, limit).map(e => (
          <Card key={e.id} style={{ marginTop: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start' }}>
              <div style={{ minWidth: 0 }}>
                <div className="fl-fam" style={{ fontSize: 15, overflowWrap: 'anywhere' }}>{properName(e.vendor || '') || e.note || '—'}</div>
                <Sub>{e.expense_date ? fmtDate(e.expense_date) : 'no date'} · {SOURCE_LABEL[e.source] || e.source}{e.ai?.accountName ? ` · ${e.ai.accountName}` : ''}{e.ai?.cardholder ? ` · ${holderKey(e.ai.cardholder)}` : ''}{e.ai?.bucket ? ` · ${e.ai.bucket}` : ''}</Sub>
                {e.ai?.flag && <Sub red>{e.ai.flag}</Sub>}
                {e.ai?.why && !e.ai?.bucket && <Sub>{e.ai.why}</Sub>}
              </div>
              <Amt v={e.amount} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginTop: 8 }}>
              <CatSel e={e} onChange={c => onCategory(e, c)} />
              <WoSel e={e} onChange={w => onWriteoff(e, w)} />
            </div>
            <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
              <Btn tone="gold" style={{ flex: 1 }} disabled={busy || !e.category} onClick={() => onConfirm(e)}>{e.category ? 'Confirm' : 'Pick a category first'}</Btn>
              {e.receipt_path && <Btn onClick={() => onOpen(e.receipt_path)}>Receipt</Btn>}
              <Btn tone="red" onClick={() => onDelete(e)}>Delete</Btn>
            </div>
          </Card>
        ))}
      {shown.length > limit && <Btn style={{ width: '100%', marginTop: 8 }} onClick={() => setLimit(l => l + 60)}>Show {Math.min(60, shown.length - limit)} more of {shown.length - limit}</Btn>}
    </>
  )
}

// ── BOOK ────────────────────────────────────────────────────────────────────
function BookView({ loading, rows, year, onCategory, onWriteoff, onOpen, onAttach }) {
  const [month, setMonth] = useState('all')
  const [cat, setCat] = useState('all')
  const [wo, setWo] = useState('all')
  const [q, setQ] = useState('')
  const [limit, setLimit] = useState(60)
  const months = useMemo(() => [...new Set(rows.map(monthOf).filter(Boolean))].sort().reverse(), [rows])
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return rows.filter(e => (month === 'all' || monthOf(e) === month) && (cat === 'all' || (e.category || 'other') === cat) && (wo === 'all' || e.writeoff === wo)
      && (!needle || `${e.vendor || ''} ${e.note || ''} ${schedcLabel(e.category)}`.toLowerCase().includes(needle)))
      .sort((a, b) => String(b.expense_date || '').localeCompare(String(a.expense_date || '')))
  }, [rows, month, cat, wo, q])
  const total = shown.reduce((s, e) => s + (Number(e.amount) || 0), 0)
  const deductible = shown.reduce((s, e) => s + deductibleAmount(e), 0)
  return (
    <>
      <input style={{ ...inputStyle, marginTop: 6 }} placeholder="Search vendor, note, category…" value={q} onChange={e => setQ(e.target.value)} />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6, marginTop: 6 }}>
        <select style={selStyle} value={month} onChange={e => setMonth(e.target.value)}><option value="all">All months</option>{months.map(m => <option key={m} value={m}>{monthName(m)}</option>)}</select>
        <select style={selStyle} value={cat} onChange={e => setCat(e.target.value)}><option value="all">All categories</option>{SCHEDC_CATEGORIES.map(c => <option key={c.code} value={c.code}>{c.label}</option>)}</select>
        <select style={selStyle} value={wo} onChange={e => setWo(e.target.value)}><option value="all">Any write-off</option><option value="yes">Written off</option><option value="no">Excluded</option><option value="pending">Your call</option></select>
      </div>
      <div className="fl-sect"><span className="fl-sect-h">{shown.length} entr{shown.length === 1 ? 'y' : 'ies'} · {fmtUSD(total)}</span><span className="fl-sect-pill">deductible {fmtUSD(deductible)}</span></div>
      {loading ? <div className="fl-empty">Loading the book…</div>
        : shown.length === 0 ? <div className="fl-empty-serif">Nothing matches{rows.length === 0 ? ` — the ${year} book starts with your first confirm` : ''}.</div>
        : shown.slice(0, limit).map(e => (
          <Card key={e.id} style={{ marginTop: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start' }}>
              <div style={{ minWidth: 0 }}>
                <div className="fl-fam" style={{ fontSize: 15, overflowWrap: 'anywhere' }}>{properName(e.vendor || '') || e.note || '—'}</div>
                <Sub>{e.expense_date ? fmtDate(e.expense_date) : 'no date'} · {SOURCE_LABEL[e.source] || e.source}{e.ai?.accountName ? ` · ${e.ai.accountName}` : ''}{e.note && e.vendor ? ` · ${e.note}` : ''}</Sub>
              </div>
              <Amt v={e.amount} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginTop: 8 }}>
              <CatSel e={e} onChange={c => onCategory(e, c)} />
              <WoSel e={e} onChange={w => onWriteoff(e, w)} />
            </div>
            <div style={{ display: 'flex', gap: 6, marginTop: 8, alignItems: 'center' }}>
              {e.receipt_path
                ? <Btn onClick={() => onOpen(e.receipt_path)}>View receipt</Btn>
                : <label style={{ font: 'inherit', fontSize: 13.5, fontWeight: 700, padding: '9px 12px', borderRadius: 10, border: '1px solid #E2DCCE', background: '#fff', minHeight: 40, display: 'inline-flex', alignItems: 'center', cursor: 'pointer' }}>
                    Attach receipt
                    <input type="file" accept="image/*,.pdf" capture="environment" style={{ display: 'none' }} onChange={ev => { const f = ev.target.files?.[0]; ev.target.value = ''; if (f) onAttach(e, f) }} />
                  </label>}
              {!e.receipt_path && e.source !== 'outgoing' && e.source !== 'statement' && <span style={{ fontSize: 11, fontWeight: 700, color: '#B00020' }}>NO RECEIPT</span>}
            </div>
          </Card>
        ))}
      {shown.length > limit && <Btn style={{ width: '100%', marginTop: 8 }} onClick={() => setLimit(l => l + 60)}>Show {Math.min(60, shown.length - limit)} more of {shown.length - limit}</Btn>}
    </>
  )
}

// ── CARDS by person ─────────────────────────────────────────────────────────
function CardsView({ loading, rows, onCategory, onOpen }) {
  const [person, setPerson] = useState('')
  const [card, setCard] = useState('all')
  const [month, setMonth] = useState('all')
  const [limit, setLimit] = useState(60)
  const charges = useMemo(() => rows.filter(isCardCharge), [rows])
  const cards = useMemo(() => [...new Set(charges.map(e => e.ai?.accountName).filter(Boolean))].sort(), [charges])
  const months = useMemo(() => [...new Set(charges.map(monthOf).filter(Boolean))].sort().reverse(), [charges])
  const pool = useMemo(() => charges.filter(e => (card === 'all' || e.ai?.accountName === card) && (month === 'all' || monthOf(e) === month)), [charges, card, month])
  const people = useMemo(() => {
    const m = new Map()
    for (const e of pool) {
      const k = holderKey(e.ai?.cardholder); if (!k) continue
      const r = m.get(k) || { key: k, total: 0, n: 0, personal: 0 }
      const amt = Number(e.amount) || 0
      r.total += amt; r.n++; if (PERSONAL_HINT.test(cardBucket(e))) r.personal += amt
      m.set(k, r)
    }
    return [...m.values()].sort((a, b) => b.total - a.total)
  }, [pool])
  const shown = useMemo(() => (person ? pool.filter(e => holderKey(e.ai?.cardholder) === person) : pool)
    .slice().sort((a, b) => String(b.expense_date).localeCompare(String(a.expense_date)) || (Number(b.amount) - Number(a.amount))), [pool, person])
  const group = (f) => { const m = new Map(); for (const e of shown) { const k = f(e); m.set(k, (m.get(k) || 0) + (Number(e.amount) || 0)) } return [...m.entries()].sort((a, b) => b[1] - a[1]) }
  const byCard = useMemo(() => group(e => e.ai?.accountName || 'Card'), [shown])  // eslint-disable-line react-hooks/exhaustive-deps
  const byBucket = useMemo(() => group(cardBucket).slice(0, 8), [shown])  // eslint-disable-line react-hooks/exhaustive-deps
  const byMonth = useMemo(() => group(monthOf).sort((a, b) => b[0].localeCompare(a[0])), [shown])  // eslint-disable-line react-hooks/exhaustive-deps
  const total = shown.reduce((s, e) => s + (Number(e.amount) || 0), 0)
  const inboxN = shown.filter(e => e.status === 'inbox').length
  const sel = people.find(p => p.key === person)
  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginTop: 6 }}>
        <select style={selStyle} value={card} onChange={e => setCard(e.target.value)}><option value="all">All cards</option>{cards.map(c => <option key={c} value={c}>{c}</option>)}</select>
        <select style={selStyle} value={month} onChange={e => setMonth(e.target.value)}><option value="all">All months</option>{months.map(m => <option key={m} value={m}>{monthName(m)}</option>)}</select>
      </div>
      {loading ? <div className="fl-empty">Loading the book…</div>
        : charges.length === 0 ? <div className="fl-empty-serif">No card charges in the book yet. Load a card statement and they show here by person.</div>
        : (
          <>
            <div className="fl-sect"><span className="fl-sect-h">Who spent what</span></div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <Chip on={!person} onClick={() => setPerson('')}>Everyone · {fmtUSD(pool.reduce((s, e) => s + (Number(e.amount) || 0), 0))}</Chip>
              {people.map(p => <Chip key={p.key} on={person === p.key} onClick={() => setPerson(person === p.key ? '' : p.key)}>{p.key} · {fmtUSD(p.total)}</Chip>)}
            </div>
            <Card style={{ marginTop: 10 }}>
              <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', rowGap: 12 }}>
                <Tile label={sel ? sel.key : 'Everyone'} value={fmtUSD(total)} sub={`${shown.length} charge${shown.length === 1 ? '' : 's'} · avg ${fmtUSD(shown.length ? total / shown.length : 0)}${inboxN ? ` · ${inboxN} still in the Inbox` : ''}`} />
                {sel && sel.personal > 0 && <Tile label="To sort (shop vs personal)" value={fmtUSD(sel.personal)} tone="bad" />}
              </div>
            </Card>
            <div className="fl-sect"><span className="fl-sect-h">By card</span></div>
            <Card style={{ padding: '4px 14px' }}>{byCard.map(([k, v]) => <StatRow key={k} k={k} v={fmtUSD(v)} sub={total > 0 ? `${Math.round(v / total * 100)}%` : ''} />)}</Card>
            <div className="fl-sect"><span className="fl-sect-h">What it was for</span></div>
            <Card style={{ padding: '4px 14px' }}>{byBucket.map(([k, v]) => <StatRow key={k} k={k} v={fmtUSD(v)} sub={total > 0 ? `${Math.round(v / total * 100)}%` : ''} />)}</Card>
            <div className="fl-sect"><span className="fl-sect-h">Month by month</span></div>
            <Card style={{ padding: '4px 14px' }}>{byMonth.map(([k, v]) => <StatRow key={k} k={monthName(k)} v={fmtUSD(v)} />)}</Card>
            <div className="fl-sect"><span className="fl-sect-h">Every charge</span><span className="fl-sect-pill">{shown.length}</span></div>
            {shown.slice(0, limit).map(e => (
              <Card key={e.id} style={{ marginTop: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start' }}>
                  <div style={{ minWidth: 0 }}>
                    <div className="fl-fam" style={{ fontSize: 15, overflowWrap: 'anywhere' }}>{properName(e.vendor || '') || e.note || '—'}</div>
                    <Sub>{e.expense_date ? fmtDate(e.expense_date) : 'no date'} · {holderKey(e.ai?.cardholder)} · {e.ai?.accountName || 'card'} · {cardBucket(e)}{e.status === 'inbox' ? ' · INBOX' : ''}</Sub>
                    {e.ai?.flag && <Sub red>{e.ai.flag}</Sub>}
                  </div>
                  <Amt v={e.amount} />
                </div>
                <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                  <div style={{ flex: 1, minWidth: 0 }}><CatSel e={e} onChange={c => onCategory(e, c)} /></div>
                  {e.receipt_path && <Btn onClick={() => onOpen(e.receipt_path)}>Receipt</Btn>}
                </div>
              </Card>
            ))}
            {shown.length > limit && <Btn style={{ width: '100%', marginTop: 8 }} onClick={() => setLimit(l => l + 60)}>Show {Math.min(60, shown.length - limit)} more of {shown.length - limit}</Btn>}
          </>
        )}
    </>
  )
}

// ── STATEMENTS & documents ──────────────────────────────────────────────────
function DocsView({ loading, rows, year, by, onOpen, onChanged, onErr }) {
  const [kind, setKind] = useState('bank_statement')
  const [month, setMonth] = useState(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` })
  const [label, setLabel] = useState('')
  const [file, setFile] = useState(null)
  const [busy, setBusy] = useState(false)
  const upload = async () => {
    if (!file || busy) return
    setBusy(true)
    const up = await uploadAcctFile(`docs/${month || year}`, file)
    if (!up.ok) { onErr(up.error); setBusy(false); return }
    const r = await addAcctDocument({ kind, month, label: label.trim() || null, storagePath: up.path, filename: up.name, uploadedBy: by })
    setBusy(false)
    if (!r.ok) { onErr(r.error); return }
    setFile(null); setLabel(''); onChanged()
  }
  const remove = async (d) => {
    if (!window.confirm(`Delete ${d.label || d.filename || 'this document'}? The file goes too.`)) return
    const r = await deleteAcctDocument(d.id, d.storage_path); if (!r.ok) { onErr(r.error); return }
    onChanged()
  }
  const grouped = useMemo(() => {
    const m = new Map()
    for (const d of rows) { const k = d.month || 'undated'; if (!m.has(k)) m.set(k, []); m.get(k).push(d) }
    return [...m.entries()].sort((a, b) => b[0].localeCompare(a[0]))
  }, [rows])
  return (
    <>
      <div className="fl-sect"><span className="fl-sect-h">Add to the cabinet</span></div>
      <Card>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
          <select style={selStyle} value={kind} onChange={e => setKind(e.target.value)}>{DOC_KINDS.map(d => <option key={d.code} value={d.code}>{d.label}</option>)}</select>
          <input style={inputStyle} type="month" value={month} onChange={e => setMonth(e.target.value)} />
        </div>
        <input style={{ ...inputStyle, marginTop: 6 }} placeholder="Label — e.g. Chase Ink 8051 - closing Nov 19" value={label} onChange={e => setLabel(e.target.value)} />
        <div style={{ display: 'flex', gap: 6, marginTop: 6, alignItems: 'center' }}>
          <label style={{ flex: 1, minWidth: 0, font: 'inherit', fontSize: 13.5, fontWeight: 700, padding: '9px 12px', borderRadius: 10, border: '1px solid #E2DCCE', background: '#fff', minHeight: 40, display: 'flex', alignItems: 'center', cursor: 'pointer', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {file ? file.name : 'Choose a PDF or photo'}
            <input type="file" accept=".pdf,image/*" style={{ display: 'none' }} onChange={ev => { setFile(ev.target.files?.[0] || null); ev.target.value = '' }} />
          </label>
          <Btn tone="gold" disabled={!file || busy} onClick={upload}>{busy ? 'Uploading…' : 'Upload'}</Btn>
        </div>
        <Sub>Label with the account’s last four and the month, so the Money review knows which statement this is.</Sub>
      </Card>
      {loading ? <div className="fl-empty">Opening the cabinet…</div>
        : rows.length === 0 ? <div className="fl-empty-serif">The cabinet is empty.</div>
        : grouped.map(([mk, list]) => (
          <div key={mk}>
            <div className="fl-sect"><span className="fl-sect-h">{mk === 'undated' ? 'Undated' : monthName(mk)}</span><span className="fl-sect-pill">{list.length}</span></div>
            {list.map(d => (
              <Card key={d.id} style={{ marginTop: 6 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center' }}>
                  <div style={{ minWidth: 0 }}>
                    <div className="fl-fam" style={{ fontSize: 14.5, overflowWrap: 'anywhere' }}>{d.label || d.filename || 'Document'}</div>
                    <Sub>{docKindLabel(d.kind)}{d.uploaded_by ? ` · ${d.uploaded_by}` : ''}{d.created_at ? ` · ${fmtDate(d.created_at)}` : ''}</Sub>
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <Btn onClick={() => onOpen(d.storage_path)}>Open</Btn>
                    <Btn tone="red" onClick={() => remove(d)}>Delete</Btn>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        ))}
    </>
  )
}

// ── TAX center ──────────────────────────────────────────────────────────────
function TaxView({ loading, expenses, income, year, onWriteoff, onErr }) {
  const [busy, setBusy] = useState(false)
  const sched = useMemo(() => summarizeSchedC(expenses, { year }), [expenses, year])
  const flags = useMemo(() => analyzeBooks(expenses, { year }), [expenses, year])
  const inYear = (e) => String(e.expense_date || '').startsWith(year)
  const pending = expenses.filter(e => inYear(e) && e.status === 'confirmed' && e.writeoff === 'pending')
  const inboxYear = expenses.filter(e => inYear(e) && e.status === 'inbox')
  const inboxUsd = inboxYear.reduce((t, e) => t + (Number(e.amount) || 0), 0)
  const profit = income - sched.totalDeductible
  const seTax = Math.max(0, profit * 0.9235 * 0.153)
  const packet = async () => {
    setBusy(true)
    try { await downloadCpaPacket({ year, income, expenses, flags }) } catch (e) { onErr(e?.message || 'Could not build the packet.') }
    setBusy(false)
  }
  if (loading) return <div className="fl-empty">Adding it up…</div>
  return (
    <>
      <div className="fl-sect"><span className="fl-sect-h">{year}, the Schedule C shape</span></div>
      <Card>
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', rowGap: 14 }}>
          <Tile label="Income" value={fmtUSD(income)} sub="order payments in" tone="good" />
          <Tile label="Write-offs" value={fmtUSD(sched.totalDeductible)} sub="confirmed, caps applied" />
          <Tile label="Tentative profit" value={fmtUSD(profit)} sub="what tax is figured on" tone={profit < 0 ? 'bad' : null} />
          <Tile label="Your call" value={String(pending.length)} sub="write-off decisions waiting" tone={pending.length ? 'bad' : null} />
        </div>
        {inboxUsd > 0 && <Sub red>{fmtUSD(inboxUsd)} in {inboxYear.length} Inbox lines is not counted yet. Confirm the Inbox and the write-offs rise.</Sub>}
      </Card>
      <Card style={{ marginTop: 8, padding: '4px 14px' }}>
        <StatRow k="1 · Gross receipts" v={fmtUSD(income)} />
        <StatRow k="4 · Cost of goods sold" v={fmtUSD(sched.cogs)} />
        <StatRow k="Gross profit" v={fmtUSD(income - sched.cogs)} />
        {sched.lines.map(l => <StatRow key={l.code} k={`${l.line} · ${l.label}`} v={fmtUSD(l.total)} />)}
        <StatRow k="Tentative profit" v={fmtUSD(profit)} />
      </Card>
      <Sub>Self-employment tax on this profit so far: about {fmtUSD(seTax)}. Rough by design — the packet preps the filing, your CPA signs.</Sub>
      <Btn tone="dark" style={{ width: '100%', marginTop: 10 }} disabled={busy} onClick={packet}>{busy ? 'Building…' : 'Download the CPA packet'}</Btn>

      {flags.length > 0 && <div className="fl-sect"><span className="fl-sect-h">The book review</span></div>}
      {flags.map((f, i) => (
        <Card key={i} style={{ marginTop: 6, borderLeft: `4px solid ${f.tone === 'win' ? '#1F7A3A' : '#B8862B'}` }}>
          <div className="fl-fam" style={{ fontSize: 14.5, overflowWrap: 'anywhere' }}>{f.title}</div>
          <Sub>{f.body}</Sub>
        </Card>
      ))}

      {pending.length > 0 && (
        <>
          <div className="fl-sect"><span className="fl-sect-h">Your call</span><span className="fl-sect-pill">{pending.length}</span></div>
          {pending.slice(0, 25).map(e => (
            <Card key={e.id} style={{ marginTop: 6 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                <div style={{ minWidth: 0 }}>
                  <div className="fl-fam" style={{ fontSize: 14.5, overflowWrap: 'anywhere' }}>{properName(e.vendor || '') || e.note || '—'}</div>
                  <Sub>{e.expense_date ? fmtDate(e.expense_date) : ''} · {schedcLabel(e.category)}</Sub>
                </div>
                <Amt v={e.amount} />
              </div>
              <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                <Btn tone="gold" style={{ flex: 1 }} onClick={() => onWriteoff(e, 'yes')}>Write off</Btn>
                <Btn style={{ flex: 1 }} onClick={() => onWriteoff(e, 'no')}>Don’t</Btn>
              </div>
            </Card>
          ))}
          {pending.length > 25 && <Sub>{pending.length - 25} more in the Book (filter: Your call).</Sub>}
        </>
      )}
    </>
  )
}
