// =============================================================================
// ReceiptScreen — the 15-second receipt, on the phone (ACCT-1, 2026-09-01)
// =============================================================================
// Paul: "in stonebooks field i also need a section where I can upload receipts
// like take a picture say what it is, and the price... im not an expert at all
// i need help." Snap → a few words or a chip → price → SAVE. It lands in the
// desktop Accounting inbox with the category + write-off PROPOSED (chip pick
// wins over keyword guessing; Food rides the 50% meals cap) — confirming into
// the book happens at the desk. Camera re-opens after save: a stack of
// receipts takes a minute.
// =============================================================================
import { useState, useRef } from 'react'
import { uploadAcctFile, addAcctExpense, proposeExpense, RECEIPT_CHIPS } from '../lib/acctData'

export default function ReceiptScreen({ who, undo, onBack }) {
  const [file, setFile] = useState(null)
  const [preview, setPreview] = useState(null)
  const [note, setNote] = useState('')
  const [chip, setChip] = useState(null)
  const [price, setPrice] = useState('')
  const [busy, setBusy] = useState(false)
  const [savedCount, setSavedCount] = useState(0)
  const camRef = useRef(null)
  const libRef = useRef(null)

  const onPick = (e) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    if (preview) URL.revokeObjectURL(preview)
    setFile(f)
    setPreview(URL.createObjectURL(f))
  }

  const reset = ({ reopenCamera } = {}) => {
    if (preview) URL.revokeObjectURL(preview)
    setFile(null); setPreview(null); setNote(''); setChip(null); setPrice('')
    // iOS may block a programmatic re-open — the SNAP button is always there.
    if (reopenCamera) requestAnimationFrame(() => camRef.current?.click())
  }

  const save = async () => {
    if (!file || busy) return
    const amt = Number(price)
    if (!Number.isFinite(amt) || amt <= 0) { undo.showError('Type the price off the receipt.'); return }
    setBusy(true)
    const year = new Date().getFullYear()
    const up = await uploadAcctFile(`acct/${year}`, file)
    if (!up.ok) { setBusy(false); undo.showError(up.error || 'Upload failed — try again.'); return }
    const prop = proposeExpense({ vendor: '', note, chip })
    const today = new Date()
    const r = await addAcctExpense({
      source: 'phone', status: 'inbox', receiptPath: up.path,
      note: note.trim() || null, amount: amt,
      category: prop.category, writeoff: prop.writeoff, writeoffPct: prop.writeoffPct,
      expenseDate: `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`,
      ai: { why: prop.why }, createdBy: who?.name || null,
    })
    setBusy(false)
    if (!r.ok) { undo.showError(r.error || 'Could not save the receipt.'); return }
    setSavedCount(n => n + 1)
    reset({ reopenCamera: true })
  }

  return (
    <div>
      <button type="button" className="fl-rowline" onClick={onBack}
        style={{ color: '#9A7209', fontWeight: 700, fontSize: 15, minHeight: 44 }}>&#8249; More</button>
      <div className="fl-greet" style={{ marginBottom: 4 }}>Receipt</div>
      <div style={{ fontSize: 12.5, color: '#6B6456', marginBottom: 12 }}>
        Snap it, say what it is, type the price. It lands in the shop's books
        {savedCount > 0 ? ` — ${savedCount} saved this visit.` : '.'}
      </div>

      {!file ? (
        <>
          <button type="button" className="fl-btn fl-btn-gold" onClick={() => camRef.current?.click()}>
            SNAP THE RECEIPT
          </button>
          <button type="button" className="fl-btn fl-btn-ghost" onClick={() => libRef.current?.click()}>
            Upload from photos
          </button>
        </>
      ) : (
        <div className="fl-card">
          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', marginBottom: 8 }}>
            <img src={preview} alt="Receipt" style={{ width: 84, height: 112, objectFit: 'cover', borderRadius: 8, border: '1px solid #DAD3C2', flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="fl-lab">Say it in a few words</div>
              <input className="fl-input" placeholder="e.g. foundation supplies" value={note}
                onChange={e => setNote(e.target.value)} />
            </div>
          </div>

          <div className="fl-lab">Or tap one</div>
          <div className="fl-chips" style={{ marginBottom: 10 }}>
            {RECEIPT_CHIPS.map(c => (
              <button key={c.code} type="button" className={`fl-chip-btn${chip === c.code ? ' on' : ''}`}
                onClick={() => setChip(prev => prev === c.code ? null : c.code)}>{c.label}</button>
            ))}
          </div>

          <div className="fl-lab">Price</div>
          <input className="fl-input" type="number" inputMode="decimal" step="0.01" min="0"
            placeholder="0.00" value={price} onChange={e => setPrice(e.target.value)}
            style={{ fontFamily: '"JetBrains Mono", Consolas, monospace', fontSize: 20, fontWeight: 700 }} />

          <button type="button" className="fl-btn fl-btn-gold" disabled={busy} onClick={save}>
            {busy ? 'Saving…' : 'SAVE RECEIPT'}
          </button>
          <button type="button" className="fl-btn fl-btn-ghost" disabled={busy} onClick={() => reset({})}>
            Retake / cancel
          </button>
        </div>
      )}

      {savedCount > 0 && !file && (
        <div className="fl-empty" style={{ color: '#14775A', fontWeight: 700 }}>
          Saved — it's in the Accounting inbox for the desk to confirm.
        </div>
      )}

      <input ref={camRef} type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={onPick} />
      <input ref={libRef} type="file" accept="image/*,.pdf" style={{ display: 'none' }} onChange={onPick} />
    </div>
  )
}
