// =============================================================================
// StatusSheet — owner bottom sheet: flip an order's status dims from the phone
// =============================================================================
// Four chip groups: Design / Stone-Bronze / Foundation / Blocker. Same derive +
// write helpers the desktop OrdersTab dropdowns use (milestone-ladder writes,
// vocabulary-aware), so the phone and the office can never disagree. Every tap
// is optimistic (local override state), offers UNDO via the toast, and reverts
// on failure. Writes take the JOB id (setOrder*Status signatures) — job may be
// null (no production job yet): Design + Blocker render, stone/foundation wait.
// =============================================================================
import { useRef, useState } from 'react'
import {
  designStatusOptions, deriveDesignStatus, designStatusLabel, setOrderDesignStatus,
  stoneStatusOptions, deriveStoneStatus, stoneStatusLabel, setOrderStoneStatus,
  FDN_STATUS, deriveFdnStatus, fdnStatusLabel, setOrderFdnStatus,
  statusDimApplies,
  MANUAL_BLOCKER_KINDS, manualBlockerKindLabel, manualBlockerChipText, setOrderManualBlocker,
} from '../lib/stonebooksData'
import { familyNameOf } from './fieldShared'

const CHIP_ROW = { display: 'flex', flexWrap: 'wrap', gap: 8 }
const HINT = { fontSize: 13, color: '#8A8267', margin: '16px 0 2px', lineHeight: 1.4 }
// Crash insurance if the shell ever renders this without the toast wired.
const NOOP_TOAST = { show: () => {}, showError: () => {} }

export default function StatusSheet({ order, job, who, undo, onClose, onChanged }) {
  const toast = undo || NOOP_TOAST
  // Local override map — the sheet's chips read THIS, not a refetch, so taps
  // re-render instantly and a failed write can snap back to the previous code.
  const [design, setDesign] = useState(() => deriveDesignStatus(job))
  const [stone, setStone] = useState(() => deriveStoneStatus(job))
  const [fdn, setFdn] = useState(() => deriveFdnStatus(job))
  const [blocker, setBlocker] = useState(() => order?.manual_blocker || null)
  // One write in flight per group — extra taps on a busy group are dropped.
  const inflight = useRef({})

  // Shared milestone-dim tap: optimistic set, write against the job, undo back
  // to the previous code, revert + toast on failure. setOrderDesignStatus may
  // return { seeded: true } (it created the design milestone rows) — the local
  // override already shows the new code, and undo still works because the rows
  // now exist, so no special handling beyond onChanged.
  const tapDim = async (dim, code, current, setLocal, writeFn, groupLabel, labelFn) => {
    if (code === current || inflight.current[dim]) return
    if (!job) { toast.showError('No production job yet — set this from the desktop.'); return }
    inflight.current[dim] = true
    setLocal(code)
    const res = await writeFn(job.id, code)
    inflight.current[dim] = false
    if (!res?.ok) {
      setLocal(current)
      toast.showError(res?.error || 'Could not update.')
      return
    }
    if (onChanged) onChanged()
    toast.show(`${groupLabel} → ${labelFn(code)}`, async () => {
      const r = await writeFn(job.id, current)
      if (r?.ok) { setLocal(current); if (onChanged) onChanged() }
      else toast.showError(r?.error || 'Could not undo.')
    })
  }

  // Blocker rides orders.manual_blocker (order id, not job) — kind chips plus
  // Clear. The server stamps setAt/setBy itself; undo restores the previous
  // blocker object (kind/label/note — custom flags keep their name).
  const tapBlocker = async (kind) => {
    if (inflight.current.blocker) return
    const prev = blocker || null
    if ((prev?.kind || null) === kind) return
    inflight.current.blocker = true
    setBlocker(kind ? { kind, note: prev?.note || null, setBy: who?.name || null } : null)
    const res = await setOrderManualBlocker(order.id,
      kind ? { kind, note: prev?.note || '', setBy: who?.name } : null)
    inflight.current.blocker = false
    if (!res?.ok) {
      setBlocker(prev)
      toast.showError(res?.error || 'Could not update the blocker.')
      return
    }
    if (res.value) setBlocker(res.value)
    if (onChanged) onChanged()
    const label = kind ? `Blocker → ${manualBlockerKindLabel(kind)}` : 'Blocker cleared'
    toast.show(label, async () => {
      const r = await setOrderManualBlocker(order.id,
        prev ? { kind: prev.kind, label: prev.label, note: prev.note } : null)
      if (r?.ok) { setBlocker(prev ? (r.value || prev) : null); if (onChanged) onChanged() }
      else toast.showError(r?.error || 'Could not undo.')
    })
  }

  const showStone = !!job && statusDimApplies('stone', job, order)
  const showFdn = !!job && statusDimApplies('fdn', job, order)
  const currentKind = blocker?.kind || null
  // The sheet offers call/email only (no custom text input on the phone) — but
  // an existing custom flag still shows as the lit chip under its own name.
  const blockerChips = [
    ...MANUAL_BLOCKER_KINDS.filter(k => k.code !== 'custom'),
    ...(currentKind === 'custom' ? [{ code: 'custom', label: manualBlockerChipText(blocker) }] : []),
  ]

  return (
    <>
      <div className="fl-sheet-scrim" onClick={onClose} />
      <div className="fl-sheet">
        <div className="fl-sheet-grab" />
        <div className="fl-sheet-title">{familyNameOf(order)}</div>
        <div className="fl-spec" style={{ marginTop: -6 }}>
          {[order?.order_number || 'DRAFT', order?.cemetery?.name].filter(Boolean).join(' · ')}
        </div>

        <div className="fl-label">Design</div>
        <div style={CHIP_ROW}>
          {designStatusOptions(job, order).map(s => (
            <button key={s.code} type="button"
              className={`fl-chip-btn${design === s.code ? ' on' : ''}`}
              style={job ? undefined : { opacity: 0.55 }}
              onClick={() => tapDim('design', s.code, design, setDesign, setOrderDesignStatus, 'Design', designStatusLabel)}>
              {s.label}
            </button>
          ))}
        </div>

        {showStone && (
          <>
            <div className="fl-label">Stone / Bronze</div>
            <div style={CHIP_ROW}>
              {stoneStatusOptions(job).map(s => (
                <button key={s.code} type="button"
                  className={`fl-chip-btn${stone === s.code ? ' on' : ''}`}
                  onClick={() => tapDim('stone', s.code, stone, setStone, setOrderStoneStatus, 'Stone', stoneStatusLabel)}>
                  {s.label}
                </button>
              ))}
            </div>
          </>
        )}

        {showFdn && (
          <>
            <div className="fl-label">Foundation</div>
            <div style={CHIP_ROW}>
              {FDN_STATUS.map(s => (
                <button key={s.code} type="button"
                  className={`fl-chip-btn${fdn === s.code ? ' on' : ''}`}
                  onClick={() => tapDim('fdn', s.code, fdn, setFdn, setOrderFdnStatus, 'Foundation', fdnStatusLabel)}>
                  {s.label}
                </button>
              ))}
            </div>
          </>
        )}

        {!job && <div style={HINT}>Stone and foundation appear once a job exists.</div>}

        <div className="fl-label">Blocker</div>
        <div style={CHIP_ROW}>
          {blockerChips.map(k => (
            <button key={k.code} type="button"
              className={`fl-chip-btn${currentKind === k.code ? ' on' : ''}`}
              onClick={() => tapBlocker(k.code)}>
              {k.label}
            </button>
          ))}
          <button type="button"
            className={`fl-chip-btn${currentKind ? '' : ' on'}`}
            onClick={() => tapBlocker(null)}>
            Clear
          </button>
        </div>

        <button type="button" className="fl-btn-ghost" onClick={onClose} style={{ marginTop: 20 }}>
          Done
        </button>
      </div>
    </>
  )
}
