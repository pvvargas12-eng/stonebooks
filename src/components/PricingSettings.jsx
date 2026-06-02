// =============================================================================
// Settings → Pricing — owner-editable rate editor
// =============================================================================
// Grouped number inputs for every rate the engine uses. Loads the effective
// config (pristine defaults merged with the stored tenant row) from orderRates,
// edits in local state, and Save → savePricingConfig (persists + re-applies
// live, so the New Order form reprices immediately). Owner-gated by the parent;
// a non-owner sees a locked message. The big per-size catalog tables (die /
// base / add-on prices) sit behind disclosure so the common rates stay scannable.
// =============================================================================

import { useState, useEffect } from 'react'
import {
  getEffectivePricingConfig, savePricingConfig, DEFAULT_PRICING_CONFIG,
  SHAPES, BASE_SIZES, BASE_HEIGHTS, GRANITE_COLORS, ADD_ONS_CATALOG,
  FOUNDATION_RATE, INSCRIPTION_TIERS, ACID_WASH_BY_TYPE,
} from '../lib/orderRates'

const humanize = (s) =>
  s == null ? '' : String(s).replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase())

// Immutable nested set by dot path (string keys; numeric segments coerce).
function setIn(obj, path, value) {
  const keys = String(path).split('.')
  const next = Array.isArray(obj) ? [...obj] : { ...obj }
  let cur = next
  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i]
    cur[k] = (cur[k] && typeof cur[k] === 'object') ? { ...cur[k] } : {}
    cur = cur[k]
  }
  cur[keys[keys.length - 1]] = value
  return next
}
function getIn(obj, path) {
  return String(path).split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj)
}

export default function PricingSettings({ user, canEdit = false }) {
  const [config, setConfig] = useState(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  const [dirty, setDirty] = useState(false)
  const [showCatalog, setShowCatalog] = useState(false)

  useEffect(() => {
    let cancelled = false
    getEffectivePricingConfig().then(c => { if (!cancelled) { setConfig(c); setLoading(false) } })
    return () => { cancelled = true }
  }, [])

  const set = (path, raw, { pct = false } = {}) => {
    setMsg(null); setDirty(true)
    const v = raw === '' ? null : (pct ? Number(raw) / 100 : Number(raw))
    setConfig(c => setIn(c, path, v))
  }
  const val = (path, { pct = false } = {}) => {
    const v = getIn(config, path)
    if (v == null || v === '') return ''
    return pct ? +(Number(v) * 100).toFixed(4) : v
  }

  const save = async () => {
    if (!canEdit) return
    setBusy(true); setMsg(null)
    const res = await savePricingConfig(config, user?.id)
    setBusy(false)
    if (!res.ok) { setMsg({ type: 'err', text: res.error || 'Could not save.' }); return }
    setDirty(false); setMsg({ type: 'ok', text: 'Pricing saved — the New Order form now uses these values.' })
  }
  const resetAll = () => {
    if (!canEdit) return
    if (!confirm('Reset every rate back to the built-in defaults? This clears your saved overrides (after you Save).')) return
    setConfig(JSON.parse(JSON.stringify(DEFAULT_PRICING_CONFIG)))
    setDirty(true); setMsg({ type: 'ok', text: 'Reset to defaults — click Save to persist.' })
  }

  if (!canEdit) {
    return (
      <div className="ps-locked">
        <style>{PS_CSS}</style>
        Pricing is owner-only. Ask the shop owner to adjust rates, or sign in with the owner account.
      </div>
    )
  }
  if (loading || !config) return <div className="ps-locked"><style>{PS_CSS}</style>Loading pricing…</div>

  return (
    <div className="ps">
      <style>{PS_CSS}</style>
      <p className="ps-lede">Every rate the New Order form uses. Edit, Save, and new orders price at these values. Blank a field to fall back to the built-in default.</p>

      <Group title="Monument fabrication (per unit)">
        <Num label="Custom die — $ per sq in (face)" value={val('perUnit.customDiePerSqIn')} onChange={v => set('perUnit.customDiePerSqIn', v)} step="0.01" />
        <Num label="Polish die sides — $/ft @ 8″ thick" value={val('perUnit.polishSidePerFoot.8')} onChange={v => set('perUnit.polishSidePerFoot.8', v)} />
        <Num label="Polish die sides — $/ft @ 10″ thick" value={val('perUnit.polishSidePerFoot.10')} onChange={v => set('perUnit.polishSidePerFoot.10', v)} />
        <Num label="Polish die sides — $/ft @ 12″ thick" value={val('perUnit.polishSidePerFoot.12')} onChange={v => set('perUnit.polishSidePerFoot.12', v)} />
        <Num label="Saw base — $/ft of base width (SB)" value={val('perUnit.sawBasePerFoot')} onChange={v => set('perUnit.sawBasePerFoot', v)} />
        <Num label="2″ polished margin — $/ft of base perimeter" value={val('perUnit.basePolishMarginPerFoot')} onChange={v => set('perUnit.basePolishMarginPerFoot', v)} />
      </Group>

      <Group title="Base height upcharges">
        {BASE_HEIGHTS.map(h => (
          <Num key={h.code} label={`Base height ${h.code}″`} value={val(`baseHeights.${h.code}`)} onChange={v => set(`baseHeights.${h.code}`, v)} />
        ))}
      </Group>

      <Group title="Inscription tiers (base price)">
        {INSCRIPTION_TIERS.map(t => (
          <Num key={t.code} label={t.label} value={val(`inscriptionTiers.${t.code}`)} onChange={v => set(`inscriptionTiers.${t.code}`, v)} />
        ))}
        <Num label="Custom font add-on" value={val('fees.customFontAddon')} onChange={v => set('fees.customFontAddon', v)} />
      </Group>

      <Group title="Acid wash by monument type">
        {ACID_WASH_BY_TYPE.map(t => (
          <Num key={t.code} label={t.label} value={val(`acidWashByType.${t.code}`)} onChange={v => set(`acidWashByType.${t.code}`, v)} />
        ))}
      </Group>

      <Group title="Foundation rates ($ per sq in)">
        {Object.keys(FOUNDATION_RATE).map(k => (
          <Num key={k} label={humanize(k)} value={val(`foundationRates.${k}`)} onChange={v => set(`foundationRates.${k}`, v)} step="0.01" />
        ))}
      </Group>

      <Group title="Color premiums (% on base stone)">
        {GRANITE_COLORS.map(c => (
          <Num key={c.code} label={c.label} suffix="%" value={val(`colorPremiums.${c.code}`, { pct: true })} onChange={v => set(`colorPremiums.${c.code}`, v, { pct: true })} step="0.1" />
        ))}
      </Group>

      <Group title="Taxes & surcharge">
        <Num label="NJ sales tax" suffix="%" value={val('taxes.njTax', { pct: true })} onChange={v => set('taxes.njTax', v, { pct: true })} step="0.001" />
        <Num label="Credit-card surcharge" suffix="%" value={val('taxes.ccSurcharge', { pct: true })} onChange={v => set('taxes.ccSurcharge', v, { pct: true })} step="0.1" />
      </Group>

      <button type="button" className="ps-disclosure" onClick={() => setShowCatalog(s => !s)}>
        {showCatalog ? '▾' : '▸'} Catalog per-size prices (die, base, add-ons) — {showCatalog ? 'hide' : 'show'}
      </button>
      {showCatalog && (
        <>
          {SHAPES.filter(s => (s.standardSizes || []).length).map(s => (
            <Group key={s.code} title={`Die prices — ${s.label}`}>
              {s.standardSizes.map(sz => (
                <Num key={sz.code} label={sz.label} value={val(`diePrices.${sz.code}`)} onChange={v => set(`diePrices.${sz.code}`, v)} />
              ))}
            </Group>
          ))}
          <Group title="Base size prices">
            {BASE_SIZES.map(b => (
              <Num key={b.code} label={b.label} value={val(`baseSizePrices.${b.code}`)} onChange={v => set(`baseSizePrices.${b.code}`, v)} />
            ))}
          </Group>
          <Group title="Add-on catalog prices">
            {ADD_ONS_CATALOG.filter(a => !a.custom).map(a => (
              <Num key={a.code} label={a.label} value={val(`addOnPrices.${a.code}`)} onChange={v => set(`addOnPrices.${a.code}`, v)} />
            ))}
          </Group>
        </>
      )}

      <div className="ps-actions">
        {msg && <span className={`ps-msg ps-msg-${msg.type}`}>{msg.text}</span>}
        <span className="ps-spacer" />
        <button type="button" className="ps-btn" onClick={resetAll} disabled={busy}>Reset to defaults</button>
        <button type="button" className="ps-btn ps-btn-primary" onClick={save} disabled={busy || !dirty}>
          {busy ? 'Saving…' : 'Save pricing'}
        </button>
      </div>
    </div>
  )
}

function Group({ title, children }) {
  return (
    <section className="ps-group">
      <h3 className="ps-group-title">{title}</h3>
      <div className="ps-grid">{children}</div>
    </section>
  )
}
function Num({ label, value, onChange, suffix = '$', step }) {
  const dollar = suffix === '$'
  return (
    <label className="ps-field">
      <span className="ps-field-label">{label}</span>
      <span className="ps-input-wrap">
        {dollar && <span className="ps-affix ps-affix-pre">$</span>}
        <input className={`ps-input${dollar ? ' ps-input-pre' : ''}`} type="number" step={step || '1'}
          value={value} onChange={e => onChange(e.target.value)} />
        {!dollar && <span className="ps-affix ps-affix-post">{suffix}</span>}
      </span>
    </label>
  )
}

const PS_CSS = `
  .ps { font-family: var(--font-b, 'Lato'), sans-serif; }
  .ps-locked { font-family: var(--font-b, 'Lato'), sans-serif; color: #8a8a85; font-size: 14px; padding: 8px 0; }
  .ps-lede { font-size: 13.5px; color: #6b6b66; margin: 0 0 20px; max-width: 620px; line-height: 1.5; }
  .ps-group { margin-bottom: 22px; }
  .ps-group-title { font-family: var(--font-d, 'Playfair Display'), Georgia, serif; font-size: 16px; font-weight: 600; color: #1e2d3d; margin: 0 0 12px; }
  .ps-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px 18px; }
  .ps-field { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
  .ps-field-label { font-size: 13px; color: #444; flex: 1 1 auto; min-width: 0; }
  .ps-input-wrap { position: relative; display: inline-flex; align-items: center; width: 120px; flex: 0 0 auto; }
  .ps-input { width: 100%; box-sizing: border-box; font: inherit; font-size: 14px; padding: 7px 10px; border: 0.5px solid #d8d6d1; border-radius: 8px; background: #fff; color: #111; text-align: right; font-variant-numeric: tabular-nums; }
  .ps-input-pre { padding-left: 20px; }
  .ps-input:focus { outline: none; border-color: #9A7209; box-shadow: 0 0 0 2px rgba(154,114,9,0.12); }
  .ps-affix { position: absolute; font-size: 12px; color: #a0a09a; pointer-events: none; }
  .ps-affix-pre { left: 9px; }
  .ps-affix-post { right: 9px; }
  .ps-disclosure { background: none; border: none; font: inherit; font-size: 13.5px; font-weight: 600; color: #9A7209; cursor: pointer; padding: 4px 0; margin: 4px 0 18px; }
  .ps-disclosure:hover { color: #876307; }
  .ps-actions { display: flex; align-items: center; gap: 12px; border-top: 0.5px solid #e4e2dd; padding-top: 16px; margin-top: 8px; }
  .ps-spacer { flex: 1 1 auto; }
  .ps-msg { font-size: 13px; }
  .ps-msg-ok { color: #1D9E75; }
  .ps-msg-err { color: #B54040; }
  .ps-btn { font: inherit; font-size: 13.5px; font-weight: 600; padding: 9px 18px; border-radius: 9px; border: 0.5px solid #d8d6d1; background: #fff; color: #222; cursor: pointer; }
  .ps-btn:disabled { opacity: 0.5; cursor: default; }
  .ps-btn-primary { background: #9A7209; border-color: #9A7209; color: #fff; }
  .ps-btn-primary:hover:not(:disabled) { background: #876307; }
  @media (max-width: 720px) { .ps-grid { grid-template-columns: 1fr; } }
`
