// =============================================================================
// SizeBoxes3 — three boxes for a stone size, the way the phone's Inventory does
// it (Paul 2026-11-17: "I like how it is in inventory, either type 1-10 or 22,
// have the preview in grey in the box").
// =============================================================================
// Each box takes feet-inches ("1-10") or inches ("22"). The grey text inside an
// empty box is the example. Leaving a box settles what was typed to the trade
// form. The parent holds INCHES: values = [n | null, n | null, n | null] and
// onChange(nextValues) fires on every keystroke that reads as a number (or a
// cleared box).
// =============================================================================
import { useState } from 'react'
import { tokenToInches, inchesToTrade } from '../lib/yardStone'

const show = (v) => (v == null || v === '' ? '' : inchesToTrade(Number(v)))
const read = (t) => { const s = String(t || '').trim().replace(/[″"']/g, ''); if (!s) return null; const n = tokenToInches(s); return n != null && n > 0 ? n : undefined }
const DEFAULT_HINTS = ['1-10 or 22', '0-8 or 8', '2-4 or 28']

function Box({ label, value, hint, onValue }) {
  const [txt, setTxt] = useState(() => show(value))
  const [seen, setSeen] = useState(value)
  // The value changed from outside (another order, a "use this size" button):
  // show it, unless it is just what this box already reads as.
  if (value !== seen) {
    setSeen(value)
    if ((read(txt) ?? null) !== (value ?? null)) setTxt(show(value))
  }
  const bad = txt.trim() !== '' && read(txt) === undefined
  return (
    <label className={`sz3-box${bad ? ' sz3-bad' : ''}`}>
      <span>{label}</span>
      <input type="text" inputMode="text" autoComplete="off" value={txt} placeholder={hint}
        onChange={e => {
          const t = e.target.value
          setTxt(t)
          const n = read(t)
          if (n !== undefined) onValue(n)        // a number, or null for a cleared box
        }}
        onBlur={() => { if (read(txt) !== undefined) setTxt(show(value)) }} />
    </label>
  )
}

export default function SizeBoxes3({ labels, values, onChange, hints = DEFAULT_HINTS, note = null }) {
  const v = [values?.[0] ?? null, values?.[1] ?? null, values?.[2] ?? null]
  const set = (i, n) => { const next = v.slice(); next[i] = n; onChange?.(next) }
  const all = v.every(x => x != null)
  return (
    <div className="sz3">
      <style>{SZ3_CSS}</style>
      <div className="sz3-row">
        {[0, 1, 2].map(i => <Box key={i} label={labels[i]} value={v[i]} hint={hints[i]} onValue={n => set(i, n)} />)}
      </div>
      <div className="sz3-read">
        {all
          ? <><b>{v.map(inchesToTrade).join(' x ')}</b> <span>({v.map(n => Math.round(n * 10) / 10).join(' x ')} in)</span></>
          : <span>Type each box in feet-inches (1-10) or inches (22).</span>}
        {note ? <span className="sz3-note">{note}</span> : null}
      </div>
    </div>
  )
}

const SZ3_CSS = `
  .sz3 { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
  .sz3-row { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
  .sz3-box { display: flex; flex-direction: column; gap: 5px; font-size: 12px; color: #6a6a62; min-width: 0; }
  .sz3-box > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .sz3-box input { font: inherit; font-family: var(--font-m, 'JetBrains Mono'), monospace; font-size: 15px; padding: 9px 10px; border: 1px solid #d8d2c4; border-radius: 6px; background: #fff; color: #2a2a2a; box-sizing: border-box; width: 100%; min-width: 0; }
  .sz3-box input::placeholder { color: #b9b3a6; }
  .sz3-box input:focus { outline: none; border-color: #9A7209; }
  .sz3-bad input { border-color: #b3261e; background: #fdf3f2; }
  .sz3-read { font-size: 12.5px; color: #6a6a62; display: flex; flex-wrap: wrap; gap: 4px 10px; align-items: baseline; overflow-wrap: anywhere; min-width: 0; }
  .sz3-read b { color: #2a2a2a; font-family: var(--font-m, 'JetBrains Mono'), monospace; font-weight: 600; }
  .sz3-note { color: #5a5a52; }
  @media (max-width: 520px) { .sz3-row { gap: 8px; } .sz3-box input { font-size: 16px; } }
`
