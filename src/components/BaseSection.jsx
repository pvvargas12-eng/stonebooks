// =============================================================================
// Stonebooks — Shared <BaseSection>
// =============================================================================
// ONE base configurator used by BOTH the Sales wizard (SalesMode) and Quick
// Order (OrderForm) — kills the two duplicated base UIs so they can't drift.
//
// Flow: Add base → "From selection" (standard catalog size) OR "Custom size".
//  • The standalone base-height dropdown is GONE. Standard catalog prices already
//    include the base's physical height, so a separate tier double-charged.
//  • Custom mode shows typed L×W×H. The typed height snaps DOWN to the nearest
//    priced tier (snapHeightToTier) for the upcharge; the typed inches still
//    display on the line. Custom price = the nearest STANDARD base that FITS the
//    die footprint (nearestFittingBaseSize) — reuses the catalog price, no new
//    rate. No fitting size → a visible warning + price left unset.
//
// This component ONLY edits baseConfig (via onChange(patch)); all pricing lives
// in the shared buildLineItems. It imports only data-layer modules (no SalesMode
// import) to avoid an import cycle.
// =============================================================================
import {
  SHAPES, BASE_SIZES, BASE_HEIGHTS, buildBaseSpec,
  nearestFittingBaseSize, snapHeightToTier,
} from '../lib/monumentCatalog'

// Mirror of orderRates.BASE_FINISHES — the codes are the source of truth there
// (the SB/AP per-foot charges read baseConfig.finish in computeFormLineItems).
// Kept local so this shared component imports only the catalog (no cycle).
const FINISH_OPTS = [
  { code: 'SB',  label: 'SB (sawn)' },
  { code: 'RB',  label: 'RB (rock pitch)' },
  { code: 'BRP', label: 'BRP (balance rock pitch)' },
  { code: 'AP',  label: 'All Polish' },
]
const TOP_OPTS = [{ code: 'pol', label: 'POL TOP' }, { code: 'frost', label: 'FROST TOP' }]
const fmt$ = n => '$' + (Number(n) || 0).toLocaleString()

export default function BaseSection({ order, onChange, dieLineText = '' }) {
  const shape = SHAPES.find(s => s.code === order?.shape)
  const canHave = shape?.canHaveBase
  const requires = shape?.requiresBase
  if (!shape || (!canHave && !requires)) return null

  const bc = order.baseConfig || {}
  const set = (patch) => onChange?.(patch)

  // Die footprint — standard size first, then custom dims.
  const stdSize = order.standardSizeCode ? shape.standardSizes?.find(s => s.code === order.standardSizeCode) : null
  const stoneW = stdSize?.w ?? order.width ?? null
  const stoneD = stdSize?.d ?? order.depth ?? null

  const include = bc.include || requires
  const mode = bc.sizeCode === 'custom' ? 'custom' : 'selection'

  // Fitting standard sizes (strictly larger than the die on both dims), nearest first.
  const fitting = BASE_SIZES
    .filter(b => (stoneW ? b.w > stoneW : true) && (stoneD ? b.d > stoneD : true))
    .map(b => ({ ...b, overhang: (b.w - (stoneW || 0)) + (b.d - (stoneD || 0)) }))
    .sort((a, z) => a.overhang - z.overhang)
  const sizeOptions = fitting.map((b, i) => ({ value: b.code, label: `${i === 0 ? '★ ' : ''}${b.label} — ${fmt$(b.price)}` }))

  // Custom fit/price preview (fits the DIE footprint per the locked rule).
  const customFit = mode === 'custom' ? nearestFittingBaseSize(stoneW, stoneD) : null
  const noFit = mode === 'custom' && (stoneW || stoneD) && !customFit
  const hasTypedH = mode === 'custom' && bc.heightInches != null && bc.heightInches !== ''
  const tier = hasTypedH ? snapHeightToTier(bc.heightInches) : null
  const lowHeight = hasTypedH && tier == null
  const tierUp = tier ? BASE_HEIGHTS.find(h => h.code === tier)?.upcharge : 0

  const setMode = (m) => {
    if (m === 'custom') set({ sizeCode: 'custom' })
    else set({ sizeCode: null, heightCode: null, heightInches: null })   // standard = no separate height upcharge
  }
  const setHeight = (v) => {
    const inches = v === '' ? null : Number(v)
    set({ heightInches: inches, heightCode: snapHeightToTier(inches) })
  }

  const effDie = (bc.dieTextOverride || '').trim() || dieLineText

  return (
    <div className="bsx">
      <style>{BSX_CSS}</style>

      {/* DIE line preview (always visible — verify before configuring the base). */}
      <div className="bsx-prev">
        <span className="bsx-prev-lbl">Die line</span>
        <span className="bsx-prev-txt">{effDie || '— size · top · sides · color —'}</span>
      </div>

      {!requires && (
        <label className="bsx-toggle">
          <input type="checkbox" checked={!!bc.include} onChange={e => set({ include: e.target.checked })} />
          <span>Add a base to this stone</span>
        </label>
      )}

      {include && (
        <div className="bsx-body">
          {/* Mode */}
          <div className="bsx-seg" role="tablist">
            <button type="button" className={mode === 'selection' ? 'on' : ''} onClick={() => setMode('selection')}>From selection</button>
            <button type="button" className={mode === 'custom' ? 'on' : ''} onClick={() => setMode('custom')}>Custom size</button>
          </div>

          {mode === 'selection' ? (
            <label className="bsx-field">
              <span>Base size <em>standard catalog price — height already included</em></span>
              <select
                value={bc.sizeCode && bc.sizeCode !== 'custom' ? bc.sizeCode : ''}
                onChange={e => set({ sizeCode: e.target.value || null, heightCode: null, heightInches: null })}
              >
                <option value="">— pick a base size —</option>
                {sizeOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              {sizeOptions.length === 0 && <span className="bsx-warn">No standard base is larger than the die — use Custom size.</span>}
            </label>
          ) : (
            <>
              <div className="bsx-grid3">
                <label className="bsx-field"><span>Base width (in)</span>
                  <input type="number" value={bc.width ?? ''} onChange={e => set({ width: e.target.value === '' ? null : Number(e.target.value) })} /></label>
                <label className="bsx-field"><span>Base depth (in)</span>
                  <input type="number" value={bc.depth ?? ''} onChange={e => set({ depth: e.target.value === '' ? null : Number(e.target.value) })} /></label>
                <label className="bsx-field"><span>Base height (in)</span>
                  <input type="number" value={bc.heightInches ?? ''} onChange={e => setHeight(e.target.value)} /></label>
              </div>
              {customFit && (
                <div className="bsx-note">
                  Priced as nearest fitting standard base <strong>{customFit.label}</strong> — {fmt$(customFit.price)}
                  {tier ? ` · height ${bc.heightInches}″ → ${tier}″ tier (+${fmt$(tierUp)})` : ''}.
                </div>
              )}
              {lowHeight && <div className="bsx-warn">Height under 6″ — no priced tier applied. Enter 6″ or more.</div>}
              {noFit && <div className="bsx-warn">⚠ No standard base fits this die footprint — needs a larger/custom base. Base price left unset; enter it on the line item.</div>}
            </>
          )}

          <div className="bsx-grid2">
            <label className="bsx-field"><span>Base finish <em>SB / AP carry a per-foot charge</em></span>
              <select value={bc.finish || ''} onChange={e => set({ finish: e.target.value || null })}>
                <option value="">— pick finish —</option>
                {FINISH_OPTS.map(f => <option key={f.code} value={f.code}>{f.label}</option>)}
              </select></label>
            <label className="bsx-field"><span>Base top <em>display only</em></span>
              <select value={bc.topFinish || ''} onChange={e => set({ topFinish: e.target.value || null })}>
                <option value="">— pick top —</option>
                {TOP_OPTS.map(t => <option key={t.code} value={t.code}>{t.label}</option>)}
              </select></label>
          </div>

          <label className="bsx-toggle">
            <input type="checkbox" checked={!!bc.polishMargin2in} onChange={e => set({ polishMargin2in: e.target.checked })} />
            <span>2″ polished margin <em>$70 / ft of base perimeter</em></span>
          </label>

          <label className="bsx-field"><span>Die description override <em>display only — replaces the die line text</em></span>
            <textarea rows={2} value={bc.dieTextOverride || ''} onChange={e => set({ dieTextOverride: e.target.value })}
              placeholder="Optional — leave blank to auto-build the die line." /></label>

          <label className="bsx-field"><span>Base description override <em>display only — replaces the base line text</em></span>
            <textarea rows={2} value={bc.baseTextOverride || ''} onChange={e => set({ baseTextOverride: e.target.value })}
              placeholder="Optional — custom bevels, special notes. Leave blank to auto-build." /></label>

          {/* BASE line preview — same buildBaseSpec the contract base row reads. */}
          <div className="bsx-prev">
            <span className="bsx-prev-lbl">Base line</span>
            <span className="bsx-prev-txt">{buildBaseSpec(order)}</span>
          </div>
        </div>
      )}
    </div>
  )
}

const BSX_CSS = `
  .bsx { display: flex; flex-direction: column; gap: 12px; }
  .bsx-body { display: flex; flex-direction: column; gap: 12px; }
  .bsx-prev { padding: 8px 11px; background: #f6f4ef; border: 1px solid #e4e0d4; border-radius: 7px; display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
  .bsx-prev-lbl { font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: #9a8f78; }
  .bsx-prev-txt { font-size: 13.5px; font-weight: 600; color: #2a2a2a; }
  .bsx-toggle { display: flex; align-items: center; gap: 9px; font-size: 14px; color: #2a2a2a; cursor: pointer; }
  .bsx-toggle input { width: 16px; height: 16px; accent-color: #9A7209; cursor: pointer; }
  .bsx-toggle em { font-style: normal; color: #8a8f78; font-size: 12px; }
  .bsx-seg { display: inline-flex; border: 1px solid #d8d2c4; border-radius: 8px; overflow: hidden; width: fit-content; }
  .bsx-seg button { font: inherit; font-size: 13px; padding: 7px 16px; background: #fff; border: none; cursor: pointer; color: #6a6a62; }
  .bsx-seg button + button { border-left: 1px solid #d8d2c4; }
  .bsx-seg button.on { background: #9A7209; color: #fff; font-weight: 600; }
  .bsx-field { display: flex; flex-direction: column; gap: 5px; font-size: 12px; color: #6a6a62; }
  .bsx-field > span em { font-style: normal; color: #9a8f78; font-size: 11px; margin-left: 4px; }
  .bsx-field select, .bsx-field input, .bsx-field textarea { font: inherit; font-size: 14px; padding: 8px 10px; border: 1px solid #d8d2c4; border-radius: 6px; background: #fff; color: #2a2a2a; box-sizing: border-box; width: 100%; }
  .bsx-field textarea { resize: vertical; }
  .bsx-grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .bsx-grid3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; }
  .bsx-note { font-size: 12.5px; color: #5a5a52; background: #f1efe8; border-radius: 6px; padding: 8px 11px; }
  .bsx-note strong { color: #2a2a2a; }
  .bsx-warn { font-size: 12.5px; color: #8a4b00; background: #fbf1da; border: 1px solid #ecd9a8; border-radius: 6px; padding: 8px 11px; }
  @media (max-width: 620px) { .bsx-grid2, .bsx-grid3 { grid-template-columns: 1fr; } }
`
