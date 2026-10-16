// =============================================================================
// QuoteBuilder — the Quote Generator (Paul 2026-10-16). ONE component for the
// desktop Tools tab and Stonebooks Field (`compact`).
// =============================================================================
// Left: the spec — shape chips, three size boxes per piece (type "4-0" or
// "48"), P2 / P3 / P5 + steel sides, color + the % hit, the base (own line:
// size, BRP / saw back / all sawn, polished top, margin), foundation, add-ons.
// Middle: the quote — the contract's own line items (priceOrderTotals, the
// same engine the signed PDF prints) + "Put it on a lead".
// Right: the books — Peerless + Kani rows for that exact size (or the nearest,
// or an estimate off the book's sq-ft rate), the column for the picked color,
// cost × markup (default 500%), Use for die / base, the page itself with the
// row highlighted. Rates & markup = a mini settings strip (pricing_config
// .quoteBook) so next year's book is one number per color per thickness.
// =============================================================================
import { useState, useEffect, useMemo, useCallback } from 'react'
import { priceOrderTotals, computeFormLineItems, getEffectivePricingConfig, savePricingConfig } from '../lib/orderRates'
import { getActiveStoneColors } from '../lib/salesOptions'
import { nearestFittingBaseSize } from '../lib/monumentCatalog'
import { fmtUSD, searchOrdersLight, setOrderStoneVendor, getOrderById, logOrderActivity, getActiveStaffUser } from '../lib/stonebooksData'
import {
  BOOKS, BOOK_KEYS, BOOK_GENERATED, DEFAULT_MARKUP_PCT, QUOTE_SHAPES, BASE_FINISH_OPTIONS, POLISH_OPTIONS,
  FOUNDATION_OPTIONS, QUOTE_ADDONS, parseDim, inToTrade, fmtForBook, quoteColorOptions, bookColumnFor, bookColorLabel,
  colorLabel, standingPremium, searchBook, estimateFromRate, bookRate, markupPrice, pageImageUrl, applyQuoteSpec,
  supplierVendorName, isFlatSection,
} from '../lib/quoteEngine'

const PLACEHOLDER = {
  die: ['4-0', '0-8', '2-4'], 'double-die': ['5-0', '0-8', '2-4'],
  slant: ['2-6', '1-0', '1-6'], 'double-slant': ['4-0', '1-0', '1-6'],
  grass: ['2-0', '1-0', '0-4'], hickey: ['2-0', '1-0', '0-8'],
}
const BASE_PLACEHOLDER = ['2-8', '1-0', '0-8']

const BLANK_SPEC = () => ({
  shape: 'die', L: '', W: '', H: '',
  polishLevel: 'P2', steelSides: false,
  colorCode: 'medium-barre-grey', colorPct: '0', customColorName: '',
  base: { include: true, L: '', W: '', H: '', finish: 'BRP', topFinish: 'pol', polishMargin: false },
  foundationType: 'Our Foundation', addOns: [],
  markupPct: DEFAULT_MARKUP_PCT, bookPick: null,
})

const TIER_LABEL = { exact: 'EXACT', face: 'SAME FACE', near: 'NEAR', estimate: 'BY RATE' }
const dimsOf = (s) => ({ L: parseDim(s.L), W: parseDim(s.W), H: parseDim(s.H) })

export default function QuoteBuilder({ compact = false, onOpenSales, onOpenOrder, onPriced }) {
  const [sm, setSm] = useState(null)              // SalesMode module (makeBlankOrder / saveOrder / rowToOrder)
  const [spec, setSpec] = useState(BLANK_SPEC)
  const [sup, setSup] = useState('peerless')
  const [colBySup, setColBySup] = useState({})     // supplier → forced book column
  const [view, setView] = useState(null)           // { sup, page, yPct, label }
  const [qb, setQb] = useState(null)               // pricing_config.quoteBook
  const [showRates, setShowRates] = useState(false)
  const [rateKey, setRateKey] = useState('')
  const [rateDraft, setRateDraft] = useState({})
  const [saveMsg, setSaveMsg] = useState('')
  const [lead, setLead] = useState({ mode: 'search', q: '', results: [], picked: null, first: '', last: '', phone: '', email: '', busy: false, msg: '', err: '' })

  useEffect(() => { import('../SalesMode').then(m => setSm(m)).catch(e => console.error('QuoteBuilder SalesMode:', e)) }, [])
  useEffect(() => {
    getEffectivePricingConfig().then(c => {
      const q = c?.quoteBook || {}
      setQb(q)
      if (q.markupPct != null) setSpec(s => ({ ...s, markupPct: Number(q.markupPct) || DEFAULT_MARKUP_PCT }))
    }).catch(() => setQb({}))
  }, [])

  const up = useCallback((patch) => setSpec(s => ({ ...s, ...patch })), [])
  const upBase = useCallback((patch) => setSpec(s => ({ ...s, base: { ...s.base, ...patch } })), [])
  const shapeDef = QUOTE_SHAPES.find(s => s.code === spec.shape) || QUOTE_SHAPES[0]
  const dims = dimsOf(spec)
  const bdims = { L: parseDim(spec.base.L), W: parseDim(spec.base.W), H: parseDim(spec.base.H) }
  const baseOn = spec.base.include
  const colorOpts = useMemo(() => quoteColorOptions(getActiveStoneColors()), [])
  const rateOverrides = qb?.rates || null

  // ── the quote (the contract's own math) ──────────────────────────────────
  const priced = useMemo(() => {
    if (!sm) return null
    try {
      const blank = sm.makeBlankOrder()
      // Extras the book base must carry on top of the marked-up stone (saw /
      // margin): read them off the engine for the SAME spec without the book.
      let extrasBase = 0
      if (spec.bookPick?.base && spec.bookPick.useForBase) {
        const raw = computeFormLineItems(applyQuoteSpec(sm.makeBlankOrder(), { ...spec, bookPick: null }))
        extrasBase = raw.filter(it => ['saw-base', 'base-margin', 'all-polish-base'].includes(String(it.code))).reduce((s, it) => s + (Number(it.amount) || 0), 0)
      }
      const full = spec.bookPick ? { ...spec, bookPick: { ...spec.bookPick, extrasBase } } : spec
      const order = applyQuoteSpec(blank, full)
      return { order, spec: full, ...priceOrderTotals(order) }
    } catch (e) { console.error('QuoteBuilder price:', e); return null }
  }, [sm, spec])
  useEffect(() => { if (priced && onPriced) onPriced(priced) }, [priced, onPriced])

  // ── the books ─────────────────────────────────────────────────────────────
  const book = BOOKS[sup]
  const mapped = bookColumnFor(spec.colorCode, sup)
  const col = colBySup[sup] || mapped?.key || book.colors[0].key
  const colIsForced = !!colBySup[sup]
  const dieRows = useMemo(() => {
    if (!dims.L) return []
    const rows = searchBook({ supplierKey: sup, section: shapeDef.section, L: dims.L, W: dims.W, H: dims.H }).slice(0, 8)
    if (!rows.some(r => r.tier === 'exact')) {
      const est = estimateFromRate({ supplierKey: sup, section: shapeDef.section, L: dims.L, W: dims.W, H: dims.H, rateOverrides })
      if (est) rows.unshift(est)
    }
    return rows
  }, [sup, shapeDef.section, dims.L, dims.W, dims.H, rateOverrides])
  const baseRows = useMemo(() => {
    if (!baseOn || !bdims.L) return []
    const rows = searchBook({ supplierKey: sup, section: 'base', L: bdims.L, W: bdims.W, H: bdims.H }).slice(0, 8)
    if (!rows.some(r => r.tier === 'exact')) {
      const est = estimateFromRate({ supplierKey: sup, section: 'base', L: bdims.L, W: bdims.W, H: bdims.H, rateOverrides })
      if (est) rows.unshift(est)
    }
    return rows
  }, [sup, baseOn, bdims.L, bdims.W, bdims.H, rateOverrides])

  const pick = (kind, row) => {
    const cost = row.prices[col]
    if (cost == null) return
    setSpec(s => {
      const cur = s.bookPick && s.bookPick.supplier === sup ? s.bookPick : { supplier: sup, die: null, base: null, useForDie: false, useForBase: false }
      const same = cur[kind]?.id === row.id && cur[kind === 'die' ? 'useForDie' : 'useForBase']
      const next = { ...cur, supplier: sup }
      if (same) { next[kind] = null; next[kind === 'die' ? 'useForDie' : 'useForBase'] = false }
      else { next[kind] = { ...row, cost }; next[kind === 'die' ? 'useForDie' : 'useForBase'] = true; next[kind === 'die' ? 'dieColor' : 'baseColor'] = bookColorLabel(sup, col) }
      const empty = !next.useForDie && !next.useForBase
      return { ...s, bookPick: empty ? null : next }
    })
    if (row.page) setView({ sup, page: row.page, yPct: row.yPct, label: row.label })
  }
  const picked = (kind, row) => spec.bookPick && spec.bookPick.supplier === sup && spec.bookPick[kind]?.id === row.id && spec.bookPick[kind === 'die' ? 'useForDie' : 'useForBase']

  // ── rates & markup (the mini settings) ────────────────────────────────────
  const rateKeys = useMemo(() => {
    const seen = new Map()
    for (const r of book.rates) { const k = `${r.section}|${r.thick}`; if (!seen.has(k)) seen.set(k, r) }
    return [...seen.values()]
  }, [book])
  useEffect(() => { if (!rateKey && rateKeys.length) setRateKey(`${rateKeys[0].section}|${rateKeys[0].thick}`) }, [rateKeys, rateKey])
  useEffect(() => {
    const [section, thick] = String(rateKey).split('|')
    if (!section) return
    const r = bookRate(sup, section, thick, rateOverrides)
    setRateDraft(r ? { ...r.perSqFt } : {})
  }, [rateKey, sup, rateOverrides])
  const saveRates = async () => {
    setSaveMsg('Saving…')
    const cfg = await getEffectivePricingConfig()
    const next = { ...(cfg.quoteBook || {}), markupPct: Number(spec.markupPct) || DEFAULT_MARKUP_PCT, rates: { ...((cfg.quoteBook || {}).rates || {}) } }
    const base = book.rates.find(r => `${r.section}|${r.thick}` === rateKey)
    if (base) {
      const ov = {}
      for (const [k, v] of Object.entries(rateDraft)) { const n = Number(v); if (Number.isFinite(n) && n > 0 && n !== base.perSqFt[k]) ov[k] = n }
      next.rates[sup] = { ...(next.rates[sup] || {}) }
      if (Object.keys(ov).length) next.rates[sup][rateKey] = ov; else delete next.rates[sup][rateKey]
    }
    const res = await savePricingConfig({ ...cfg, quoteBook: next }, getActiveStaffUser() || null)
    if (res.ok) { setQb(next); setSaveMsg('Saved.') } else setSaveMsg(res.error || 'Could not save.')
    setTimeout(() => setSaveMsg(''), 2500)
  }

  // ── put it on a lead ──────────────────────────────────────────────────────
  useEffect(() => {
    if (lead.mode !== 'search' || !lead.q.trim()) return
    let alive = true
    const t = setTimeout(() => searchOrdersLight(lead.q, 10).then(rows => { if (alive) setLead(l => ({ ...l, results: rows || [] })) }), 280)
    return () => { alive = false; clearTimeout(t) }
  }, [lead.q, lead.mode])
  const specLine = useMemo(() => {
    const parts = [shapeDef.label, dims.L ? `${inToTrade(dims.L)} x ${inToTrade(dims.W)} x ${inToTrade(dims.H)}` : '(no size)']
    if (!shapeDef.flat) parts.push(spec.polishLevel)
    if (spec.steelSides && !shapeDef.flat) parts.push('steel sides')
    parts.push(colorLabel(spec.colorCode, spec.customColorName))
    if (baseOn && bdims.L) parts.push(`base ${inToTrade(bdims.L)} x ${inToTrade(bdims.W)} x ${inToTrade(bdims.H)} ${spec.base.finish}`)
    if (spec.bookPick) parts.push(`${BOOKS[spec.bookPick.supplier].short} book × ${1 + (Number(spec.markupPct) || 0) / 100}`)
    return parts.join(' · ')
  }, [shapeDef, dims.L, dims.W, dims.H, spec, baseOn, bdims.L, bdims.W, bdims.H])

  const priceToLead = async () => {
    if (!sm || !priced) return
    setLead(l => ({ ...l, busy: true, err: '', msg: '' }))
    try {
      let order, id
      if (lead.mode === 'search') {
        if (!lead.picked) throw new Error('Pick a lead first.')
        const row = await getOrderById(lead.picked.id)
        if (!row) throw new Error('That lead could not be loaded.')
        if (row.signed_at || row.pricing_locked_at) throw new Error('That contract is signed — unlock it on the order first, then price it.')
        order = sm.rowToOrder(row, row.customer, row.cemetery)
        id = row.id
      } else {
        if (!lead.last.trim() && !lead.first.trim()) throw new Error('Type the customer’s name.')
        order = sm.makeBlankOrder()
        order.customer = { ...order.customer, firstName: lead.first.trim(), lastName: lead.last.trim(), phonePrimary: lead.phone.trim(), email: lead.email.trim() }
        order.salesRep = getActiveStaffUser() || ''
      }
      const merged = applyQuoteSpec(order, priced.spec)
      if (!merged.serviceTypes.includes('NEW_STONE')) merged.serviceTypes = ['NEW_STONE', ...merged.serviceTypes]
      const res = await sm.saveOrder(merged)
      if (!res?.ok) throw new Error(res?.error?.message || res?.reason || 'The lead did not save.')
      id = id || res.order?.id
      const vendor = spec.bookPick ? supplierVendorName(spec.bookPick.supplier) : null
      if (id && vendor) await setOrderStoneVendor(id, vendor)
      if (id) await logOrderActivity(id, { type: 'note', note: `Quote Generator: ${specLine} — ${fmtUSD(priced.displayed)}${vendor ? ` · order the stone from ${vendor}` : ''}`, actor: getActiveStaffUser() || null })
      setLead(l => ({ ...l, busy: false, msg: `On the lead${res.order?.orderNumber ? ` ${res.order.orderNumber}` : ''} — ${fmtUSD(priced.displayed)}${vendor ? ` · vendor ${vendor}` : ''}.`, pickedId: id }))
      if (onOpenSales && id) onOpenSales(id)
    } catch (e) {
      setLead(l => ({ ...l, busy: false, err: e?.message || String(e) }))
    }
  }

  // ── render helpers ─────────────────────────────────────────────────────────
  const sizeBox = (label, value, onChange, ph) => {
    const n = parseDim(value)
    return (
      <label className="qg-dim">
        <span className="qg-dim-l">{label}</span>
        <input className="qg-in qg-mono" inputMode="decimal" value={value} placeholder={ph} onChange={e => onChange(e.target.value)} />
        <span className="qg-dim-h">{n != null ? `${n}″` : value ? 'type 4-0 or 48' : ' '}</span>
      </label>
    )
  }
  const bookRowsTable = (kind, rows, section) => {
    if (!rows.length) return <div className="qg-muted">{kind === 'die' ? 'Type the stone size to search the book.' : baseOn ? 'Type the base size.' : 'No base on this quote.'}</div>
    return (
      <table className="qg-tbl">
        <thead><tr><th>Size{BOOKS[sup].units === 'trade' ? '' : ' (in)'}</th><th>Match</th><th className="r">Cost</th><th className="r">× {1 + (Number(spec.markupPct) || 0) / 100}</th><th></th></tr></thead>
        <tbody>
          {rows.map(r => {
            const cost = r.prices[col]
            const on = picked(kind, r)
            return (
              <tr key={r.id} className={`${on ? 'on' : ''} ${r.tier === 'estimate' ? 'est' : ''}`} onClick={() => r.page && setView({ sup, page: r.page, yPct: r.yPct, label: r.label })}>
                <td className="qg-mono">{r.label}{r.tier !== 'estimate' && r.thick && !isFlatSection(section) ? '' : ''}</td>
                <td><span className={`qg-tier ${r.tier}`}>{TIER_LABEL[r.tier]}</span>{r.tier === 'estimate' && r.rate && <span className="qg-tiny"> {r.area} sq ft × ${r.rate.perSqFt[col] ?? '—'}{r.rate.derived ? ' (derived)' : ''}{r.rate.overridden ? ' (your rate)' : ''}</span>}{r.bookPage ? <span className="qg-tiny"> · p.{r.bookPage}</span> : null}</td>
                <td className="r qg-mono">{cost != null ? fmtUSD(cost) : '—'}</td>
                <td className="r qg-mono qg-sell">{cost != null ? fmtUSD(markupPrice(cost, spec.markupPct)) : '—'}</td>
                <td className="r"><button type="button" className={`qg-use ${on ? 'on' : ''}`} disabled={cost == null} onClick={(e) => { e.stopPropagation(); pick(kind, r) }}>{on ? 'IN QUOTE' : `Use for ${kind}`}</button></td>
              </tr>
            )
          })}
        </tbody>
      </table>
    )
  }

  const totals = priced?.totals
  const bp = spec.bookPick
  // A custom base bigger than every printed base has NO sheet price (the
  // engine prices custom bases as the nearest printed base that fits).
  const baseNoSheetPrice = !!(priced && baseOn && bdims.L && bdims.W && !(bp?.useForBase)
    && priced.order.baseConfig.sizeCode === 'custom' && !nearestFittingBaseSize(bdims.L, bdims.W))

  return (
    <div className={`qg ${compact ? 'qg-compact' : ''}`}>
      <style>{CSS}</style>

      {/* ── SPEC ── */}
      <section className="qg-col qg-spec">
        <div className="qg-h">The stone</div>
        <div className="qg-chips">
          {QUOTE_SHAPES.map(s => (
            <button key={s.code} type="button" className={`qg-chip ${spec.shape === s.code ? 'on' : ''}`}
              onClick={() => up({ shape: s.code, base: { ...spec.base, include: s.section === 'die' || s.section === 'slant' ? spec.base.include : false } })}>{s.label}</button>
          ))}
        </div>
        <div className="qg-dims">
          {sizeBox(shapeDef.dims[0], spec.L, v => up({ L: v }), PLACEHOLDER[spec.shape][0])}
          <span className="qg-x">x</span>
          {sizeBox(shapeDef.dims[1], spec.W, v => up({ W: v }), PLACEHOLDER[spec.shape][1])}
          <span className="qg-x">x</span>
          {sizeBox(shapeDef.dims[2], spec.H, v => up({ H: v }), PLACEHOLDER[spec.shape][2])}
        </div>
        {!shapeDef.flat && (
          <div className="qg-row">
            <div className="qg-chips">
              {POLISH_OPTIONS.map(p => <button key={p.code} type="button" className={`qg-chip ${spec.polishLevel === p.code ? 'on' : ''}`} onClick={() => up({ polishLevel: p.code })} title={p.blurb}>{p.code}</button>)}
              <button type="button" className={`qg-chip ${spec.steelSides ? 'on' : ''}`} onClick={() => up({ steelSides: !spec.steelSides })}>Steel sides</button>
            </div>
            <div className="qg-tiny">P2 standard · P3 = L ÷ 12 × rate · P5 = (L + H) ÷ 12 × rate · rate by thickness 8″ $105 / 10″ $115 / 12″ $125 · steel $75/ft</div>
          </div>
        )}
        <div className="qg-row qg-grid2">
          <label className="qg-f"><span>Color</span>
            <select className="qg-in" value={spec.colorCode} onChange={e => { const c = e.target.value; up({ colorCode: c, colorPct: String(standingPremium(c)) }) }}>
              {colorOpts.map(g => <optgroup key={g.group} label={g.group}>{g.options.map(o => <option key={o.code} value={o.code}>{o.label}</option>)}</optgroup>)}
            </select>
          </label>
          <label className="qg-f"><span>Color % (die + base)</span>
            <input className="qg-in qg-mono" inputMode="decimal" value={spec.colorPct} onChange={e => up({ colorPct: e.target.value })} disabled={!!bp} title={bp ? 'A book price already includes the color' : ''} />
          </label>
          {spec.colorCode === 'custom' && (
            <label className="qg-f qg-span2"><span>Custom color name</span>
              <input className="qg-in" value={spec.customColorName} placeholder="e.g. Blue Pearl" onChange={e => up({ customColorName: e.target.value })} />
            </label>
          )}
        </div>

        <div className="qg-h qg-h2">
          <span>The base</span>
          {shapeDef.section !== 'die' && <button type="button" className={`qg-chip sm ${baseOn ? 'on' : ''}`} onClick={() => upBase({ include: !baseOn })}>{baseOn ? 'On the quote' : 'Add a base'}</button>}
        </div>
        {baseOn ? (
          <>
            <div className="qg-dims">
              {sizeBox('Length', spec.base.L, v => upBase({ L: v }), BASE_PLACEHOLDER[0])}
              <span className="qg-x">x</span>
              {sizeBox('Width', spec.base.W, v => upBase({ W: v }), BASE_PLACEHOLDER[1])}
              <span className="qg-x">x</span>
              {sizeBox('Height', spec.base.H, v => upBase({ H: v }), BASE_PLACEHOLDER[2])}
            </div>
            <div className="qg-row qg-grid2">
              <label className="qg-f"><span>Finish</span>
                <select className="qg-in" value={spec.base.finish} onChange={e => upBase({ finish: e.target.value })}>
                  {BASE_FINISH_OPTIONS.map(f => <option key={f.code} value={f.code}>{f.label}</option>)}
                </select>
              </label>
              <label className="qg-f"><span>Top</span>
                <select className="qg-in" value={spec.base.topFinish} onChange={e => upBase({ topFinish: e.target.value })}>
                  <option value="pol">Polished top</option>
                  <option value="steel">Steel top</option>
                  <option value="rock">Rock top</option>
                </select>
              </label>
              <label className="qg-check qg-span2"><input type="checkbox" checked={spec.base.polishMargin} onChange={e => upBase({ polishMargin: e.target.checked })} /> 2″ polished margin ($55/ft around)</label>
            </div>
          </>
        ) : <div className="qg-muted">No base — the stone is priced alone.</div>}

        <div className="qg-h qg-h2">Foundation + extras</div>
        <div className="qg-row qg-grid2">
          <label className="qg-f"><span>Foundation</span>
            <select className="qg-in" value={spec.foundationType || ''} onChange={e => up({ foundationType: e.target.value || null })}>
              <option value="">None</option>
              {FOUNDATION_OPTIONS.map(f => <option key={f} value={f}>{f}</option>)}
            </select>
          </label>
          <div className="qg-tiny" style={{ alignSelf: 'end' }}>Our foundation / strip = base footprint × $2.85 sq in (slants $2.25, markers $2.00). Cemetery foundation = no line.</div>
        </div>
        <div className="qg-addons">
          {QUOTE_ADDONS.map(a => (
            <label key={a.code} className="qg-check"><input type="checkbox" checked={spec.addOns.includes(a.code)} onChange={e => up({ addOns: e.target.checked ? [...spec.addOns, a.code] : spec.addOns.filter(c => c !== a.code) })} /> {a.label}</label>
          ))}
        </div>
        <div className="qg-row"><button type="button" className="qg-link" onClick={() => { setSpec(s => ({ ...BLANK_SPEC(), markupPct: s.markupPct })); setView(null); setLead(l => ({ ...l, picked: null, msg: '', err: '' })) }}>Start over</button></div>
      </section>

      {/* ── QUOTE ── */}
      <section className="qg-col qg-quote">
        <div className="qg-h">The quote</div>
        <div className="qg-specline">{specLine}</div>
        {!priced && <div className="qg-muted">Loading the pricing engine…</div>}
        {priced && !dims.L && <div className="qg-muted">Type the stone’s size to price it.</div>}
        {priced && dims.L && (
          <>
            <table className="qg-lines">
              <tbody>
                {priced.items.map(it => (
                  <tr key={it.code} className={it.quotePending ? 'pend' : ''}>
                    <td>{it.label}{it.code === 'base-stone' && bp?.useForDie ? <span className="qg-tiny"> · {BOOKS[bp.supplier].short} {bp.die.label} {fmtUSD(bp.die.cost)} × {1 + (Number(spec.markupPct) || 0) / 100}</span> : null}{it.code === 'base-block' && bp?.useForBase ? <span className="qg-tiny"> · {BOOKS[bp.supplier].short} {bp.base.label} {fmtUSD(bp.base.cost)} × {1 + (Number(spec.markupPct) || 0) / 100}</span> : null}</td>
                    <td className="r qg-mono">{it.quotePending ? '—' : fmtUSD(it.amount)}</td>
                  </tr>
                ))}
                {priced.items.length === 0 && <tr><td colSpan={2} className="qg-muted">Type a size to price it.</td></tr>}
                {baseNoSheetPrice && <tr><td colSpan={2} className="qg-warn">The sheet has no base price for {inToTrade(bdims.L)} x {inToTrade(bdims.W)} (bigger than every printed base) — the base line carries only the finish. Use a book price for the base.</td></tr>}
              </tbody>
              <tfoot>
                <tr><td>Subtotal</td><td className="r qg-mono">{fmtUSD((totals.subtotalDisc || 0) + (totals.subtotalPermit || 0))}</td></tr>
                <tr><td>NJ sales tax 6.625%</td><td className="r qg-mono">{fmtUSD(totals.tax)}</td></tr>
                <tr className="tot"><td>Total</td><td className="r qg-mono">{fmtUSD(priced.displayed)}</td></tr>
              </tfoot>
            </table>
            {bp && (
              <div className="qg-bookpick">
                Stone priced from the <b>{BOOKS[bp.supplier].short}</b> book at <b>{spec.markupPct}%</b> markup — order it from <b>{supplierVendorName(bp.supplier)}</b>.
                {bp.useForDie && <div className="qg-tiny">Die: {bp.die.label} · {bp.dieColor} · cost {fmtUSD(bp.die.cost)} → {fmtUSD(markupPrice(bp.die.cost, spec.markupPct))}</div>}
                {bp.useForBase && <div className="qg-tiny">Base: {bp.base.label} · {bp.baseColor} · cost {fmtUSD(bp.base.cost)} → {fmtUSD(markupPrice(bp.base.cost, spec.markupPct))}{priced.spec.bookPick?.extrasBase ? ` + ${fmtUSD(priced.spec.bookPick.extrasBase)} finish` : ''}</div>}
                <button type="button" className="qg-link" onClick={() => up({ bookPick: null })}>Back to the sheet price</button>
              </div>
            )}
          </>
        )}

        <div className="qg-h qg-h2">Put it on a lead</div>
        <div className="qg-chips">
          <button type="button" className={`qg-chip sm ${lead.mode === 'search' ? 'on' : ''}`} onClick={() => setLead(l => ({ ...l, mode: 'search', err: '', msg: '' }))}>Existing lead</button>
          <button type="button" className={`qg-chip sm ${lead.mode === 'new' ? 'on' : ''}`} onClick={() => setLead(l => ({ ...l, mode: 'new', err: '', msg: '' }))}>New lead</button>
        </div>
        {lead.mode === 'search' ? (
          <div className="qg-row">
            {lead.picked ? (
              <div className="qg-picked">
                <div><b>{lead.picked.primary_lastname || lead.picked.customer?.last_name || 'Lead'}</b> <span className="qg-tiny">{lead.picked.order_number} · {lead.picked.status}</span></div>
                <button type="button" className="qg-link" onClick={() => setLead(l => ({ ...l, picked: null, msg: '', err: '' }))}>change</button>
              </div>
            ) : (
              <>
                <input className="qg-in" type="search" placeholder="Family, customer or order #…" value={lead.q} onChange={e => setLead(l => ({ ...l, q: e.target.value }))} />
                {lead.q.trim() && (
                  <div className="qg-results">
                    {lead.results.length === 0 && <div className="qg-muted">No matches.</div>}
                    {lead.results.map(r => (
                      <button key={r.id} type="button" className="qg-result" onClick={() => setLead(l => ({ ...l, picked: r, results: [] }))}>
                        <span>{r.primary_lastname || r.customer?.last_name || '—'}{r.customer && r.customer.last_name && r.customer.last_name !== r.primary_lastname ? ` · ${r.customer.first_name || ''} ${r.customer.last_name}` : ''}</span>
                        <span className="qg-tiny">{r.order_number} · {r.status}{r.signed_at ? ' · SIGNED' : ''}</span>
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        ) : (
          <div className="qg-row qg-grid2">
            <label className="qg-f"><span>First name</span><input className="qg-in" value={lead.first} onChange={e => setLead(l => ({ ...l, first: e.target.value }))} /></label>
            <label className="qg-f"><span>Last name</span><input className="qg-in" value={lead.last} onChange={e => setLead(l => ({ ...l, last: e.target.value }))} /></label>
            <label className="qg-f"><span>Phone</span><input className="qg-in" inputMode="tel" value={lead.phone} onChange={e => setLead(l => ({ ...l, phone: e.target.value }))} /></label>
            <label className="qg-f"><span>Email</span><input className="qg-in" inputMode="email" value={lead.email} onChange={e => setLead(l => ({ ...l, email: e.target.value }))} /></label>
          </div>
        )}
        <button type="button" className="qg-go" disabled={!priced || lead.busy || !dims.L || (lead.mode === 'search' && !lead.picked)} onClick={priceToLead}>
          {lead.busy ? 'Saving…' : lead.mode === 'search' ? 'Put this quote on the lead' : 'Create the lead with this quote'}
        </button>
        <div className="qg-tiny">Writes the stone, size, polish, color, base, foundation and these prices onto the lead’s contract — then opens it in the sales wizard.{bp ? ` The vendor is stamped ${supplierVendorName(bp.supplier)} so the PR builder knows.` : ''}</div>
        {lead.err && <div className="qg-err">{lead.err}</div>}
        {lead.msg && <div className="qg-ok">{lead.msg}{lead.pickedId && onOpenOrder ? <> · <button type="button" className="qg-link" onClick={() => onOpenOrder(lead.pickedId)}>open the order</button></> : null}</div>}
      </section>

      {/* ── BOOKS ── */}
      <section className="qg-col qg-books">
        <div className="qg-h">
          <span>The books — what it costs</span>
          <label className="qg-markup">Markup <input className="qg-in qg-mono" inputMode="numeric" value={spec.markupPct} onChange={e => up({ markupPct: e.target.value })} />% <span className="qg-tiny">= cost × {1 + (Number(spec.markupPct) || 0) / 100}</span></label>
        </div>
        <div className="qg-chips">
          {BOOK_KEYS.map(k => <button key={k} type="button" className={`qg-chip ${sup === k ? 'on' : ''}`} onClick={() => setSup(k)}>{BOOKS[k].short}<span className="qg-tiny"> {BOOKS[k].edition}</span></button>)}
          <button type="button" className={`qg-chip sm ${showRates ? 'on' : ''}`} onClick={() => setShowRates(v => !v)}>Rates &amp; markup</button>
        </div>
        <div className="qg-row qg-colrow">
          <span className="qg-tiny">Column for {colorLabel(spec.colorCode, spec.customColorName)}:</span>
          <select className="qg-in sm" value={col} onChange={e => setColBySup(c => ({ ...c, [sup]: e.target.value }))}>
            {book.colors.map(c => <option key={c.key} value={c.key}>{c.names ? c.names.join(' / ') : c.label}</option>)}
          </select>
          {!mapped && !colIsForced && <span className="qg-warn">{BOOKS[sup].short} does not list this color — pick the closest column.</span>}
          {mapped?.approx && !colIsForced && <span className="qg-warn">nearest {BOOKS[sup].short} stone, not the same granite.</span>}
        </div>

        {showRates && (
          <div className="qg-rates">
            <div className="qg-tiny">Next year’s book without the PDF: type the new $ per sq ft per color for a section and thickness, Save. The estimate rows use it. Blank = the book’s printed rate.</div>
            <select className="qg-in sm" value={rateKey} onChange={e => setRateKey(e.target.value)}>
              {rateKeys.map(r => <option key={`${r.section}|${r.thick}`} value={`${r.section}|${r.thick}`}>{r.section} {r.thick != null && ['die', 'base', 'slant', 'backer'].includes(r.section) ? `${r.thick}″` : ''}{r.derived ? ' (derived from the rows)' : ''}</option>)}
            </select>
            <div className="qg-rategrid">
              {book.colors.map(c => (
                <label key={c.key} className="qg-f"><span>{c.names ? c.names[0] : c.label}</span><input className="qg-in qg-mono sm" inputMode="decimal" value={rateDraft[c.key] ?? ''} onChange={e => setRateDraft(d => ({ ...d, [c.key]: e.target.value }))} /></label>
              ))}
            </div>
            <div className="qg-chips"><button type="button" className="qg-go sm" onClick={saveRates}>Save rates + default markup</button><span className="qg-tiny">{saveMsg}</span></div>
          </div>
        )}

        <div className="qg-sub">{shapeDef.label}{dims.L ? ` ${fmtForBook(sup, dims.L, dims.W, dims.H)}` : ''}</div>
        {bookRowsTable('die', dieRows, shapeDef.section)}
        <div className="qg-sub">Base{baseOn && bdims.L ? ` ${fmtForBook(sup, bdims.L, bdims.W, bdims.H)}` : ''}</div>
        {bookRowsTable('base', baseRows, 'base')}

        {view && view.sup === sup && (
          <div className="qg-page">
            <div className="qg-tiny">{BOOKS[sup].short} page {view.page - (BOOKS[sup].units === 'trade' ? 2 : 1)} · {view.label} <button type="button" className="qg-link" onClick={() => setView(null)}>hide</button></div>
            <div className="qg-page-wrap">
              <img src={pageImageUrl(sup, view.page)} alt={`${BOOKS[sup].short} page ${view.page}`} />
              {view.yPct != null && <div className="qg-page-hl" style={{ top: `${view.yPct * 100}%` }} />}
            </div>
          </div>
        )}
        <div className="qg-tiny" style={{ marginTop: 8 }}>Books parsed {BOOK_GENERATED}. Peerless prices are the printed rows; Kani groups A–H by color. EXACT = that row in the book · SAME FACE = same face, other thickness · BY RATE = size × the book’s sq-ft rate.</div>
      </section>
    </div>
  )
}

const CSS = `
.qg{display:grid;grid-template-columns:minmax(300px,1fr) minmax(300px,1fr) minmax(340px,1.2fr);gap:18px;align-items:start;color:#16150F}
.qg *{box-sizing:border-box;min-width:0}
.qg-col{background:#fff;border:1px solid #E2DCCE;border-radius:12px;padding:14px 16px;overflow:hidden}
.qg-h{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;font-family:Georgia,serif;font-size:19px;font-weight:600;margin:0 0 10px}
.qg-h2{margin-top:18px;font-size:16px;padding-top:12px;border-top:1px dashed #E2DCCE}
.qg-chips{display:flex;flex-wrap:wrap;gap:6px;margin:4px 0 8px}
.qg-chip{font:inherit;font-size:13px;font-weight:700;padding:7px 12px;border-radius:999px;border:1px solid #E2DCCE;background:#fff;color:#55503F;cursor:pointer;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.qg-chip.sm{font-size:12px;padding:5px 10px}
.qg-chip.on{background:#16150F;color:#E9C46A;border-color:#16150F}
.qg-dims{display:flex;align-items:flex-start;gap:6px;margin:4px 0 8px}
.qg-dim{display:flex;flex-direction:column;gap:3px;flex:1 1 0}
.qg-dim-l{font-size:11px;font-weight:700;color:#8A7F6C;letter-spacing:.04em;text-transform:uppercase;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.qg-dim-h{font-size:11px;color:#8A7F6C;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.qg-x{align-self:center;padding-top:14px;color:#8A7F6C;font-weight:700}
.qg-in{font:inherit;font-size:15px;padding:9px 10px;border:1px solid #D9D2C2;border-radius:8px;background:#fff;width:100%;color:#16150F}
.qg-in.sm{font-size:13px;padding:6px 8px;width:auto;max-width:100%}
.qg-in:disabled{background:#F4F1EA;color:#8A7F6C}
.qg-mono{font-family:"JetBrains Mono",Consolas,monospace}
.qg-row{margin:6px 0 10px}
.qg-grid2{display:grid;grid-template-columns:1fr 1fr;gap:8px 12px}
.qg-span2{grid-column:1/-1}
.qg-f{display:flex;flex-direction:column;gap:3px}
.qg-f>span{font-size:11px;font-weight:700;color:#8A7F6C;letter-spacing:.04em;text-transform:uppercase;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.qg-check{display:flex;align-items:center;gap:8px;font-size:13.5px;padding:4px 0;cursor:pointer}
.qg-addons{display:grid;grid-template-columns:1fr 1fr;gap:0 12px}
.qg-tiny{font-size:11.5px;color:#8A7F6C;overflow-wrap:anywhere}
.qg-muted{font-size:13px;color:#8A7F6C;padding:6px 0}
.qg-warn{font-size:11.5px;color:#9A3412;font-weight:700;overflow-wrap:anywhere}
.qg-err{margin-top:8px;padding:8px 10px;border-radius:8px;background:#FDECEC;color:#B00020;font-size:13px;overflow-wrap:anywhere}
.qg-ok{margin-top:8px;padding:8px 10px;border-radius:8px;background:#E8F5EC;color:#1F7A3A;font-size:13px;overflow-wrap:anywhere}
.qg-link{font:inherit;font-size:12.5px;color:#9A7209;background:none;border:0;padding:0;cursor:pointer;text-decoration:underline}
.qg-specline{font-size:13px;color:#55503F;margin:-4px 0 8px;overflow-wrap:anywhere}
.qg-lines{width:100%;border-collapse:collapse;font-size:14px;table-layout:fixed}
.qg-lines td{padding:6px 4px;border-bottom:1px solid #F0EBDF;vertical-align:top;overflow-wrap:anywhere}
.qg-lines td.r,.qg-tbl .r{text-align:right;white-space:nowrap}
.qg-lines td.r{width:112px}
.qg-lines tr.pend td{color:#8A7F6C;font-style:italic}
.qg-lines tfoot td{border-bottom:0;color:#55503F}
.qg-lines tfoot tr.tot td{font-size:20px;font-weight:800;color:#16150F;padding-top:10px}
.qg-bookpick{margin:10px 0;padding:10px 12px;border-radius:10px;background:#FBF4DF;border:1px solid #E9C46A;font-size:13px;overflow-wrap:anywhere}
.qg-picked{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:8px 10px;border:1px solid #E2DCCE;border-radius:8px;overflow:hidden}
.qg-results{display:flex;flex-direction:column;border:1px solid #E2DCCE;border-radius:8px;margin-top:6px;max-height:220px;overflow:auto}
.qg-result{font:inherit;display:flex;justify-content:space-between;gap:8px;text-align:left;padding:8px 10px;border:0;border-bottom:1px solid #F0EBDF;background:#fff;cursor:pointer}
.qg-result:hover{background:#FBF8F0}
.qg-result>span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.qg-go{font:inherit;font-size:15px;font-weight:800;padding:12px 16px;border-radius:10px;border:0;background:#16150F;color:#E9C46A;cursor:pointer;width:100%;margin-top:10px}
.qg-go.sm{font-size:13px;padding:8px 12px;width:auto;margin:0}
.qg-go:disabled{opacity:.45;cursor:default}
.qg-markup{display:flex;align-items:center;gap:6px;font-size:13px;font-weight:700;font-family:Inter,system-ui,sans-serif}
.qg-markup .qg-in{width:72px;padding:6px 8px;font-size:14px}
.qg-colrow{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.qg-sub{font-size:12px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:#8A7F6C;margin:12px 0 4px}
.qg-tbl{width:100%;border-collapse:collapse;font-size:13px;table-layout:fixed}
.qg-tbl th{font-size:10.5px;letter-spacing:.05em;text-transform:uppercase;color:#8A7F6C;text-align:left;padding:4px;border-bottom:1px solid #E2DCCE;white-space:nowrap}
.qg-tbl th:nth-child(1){width:26%}.qg-tbl th:nth-child(3),.qg-tbl th:nth-child(4){width:17%}.qg-tbl th:nth-child(5){width:21%}
.qg-tbl td{padding:6px 4px;border-bottom:1px solid #F0EBDF;vertical-align:top;overflow:hidden;text-overflow:ellipsis;overflow-wrap:anywhere}
.qg-tbl tr{cursor:pointer}
.qg-tbl tr.on td{background:#FBF4DF}
.qg-tbl tr.est td{color:#55503F;font-style:italic}
.qg-sell{font-weight:800;color:#16150F}
.qg-tier{display:inline-block;font-size:10px;font-weight:800;letter-spacing:.05em;padding:1px 6px;border-radius:999px;background:#EEE9DD;color:#55503F}
.qg-tier.exact{background:#1F7A3A;color:#fff}.qg-tier.face{background:#E9C46A;color:#16150F}.qg-tier.estimate{background:#E2DCCE;color:#55503F}
.qg-use{font:inherit;font-size:11.5px;font-weight:800;padding:5px 8px;border-radius:999px;border:1px solid #16150F;background:#fff;color:#16150F;cursor:pointer;white-space:nowrap;max-width:100%;overflow:hidden;text-overflow:ellipsis}
.qg-use.on{background:#1F7A3A;border-color:#1F7A3A;color:#fff}
.qg-use:disabled{opacity:.4;cursor:default}
.qg-rates{margin:6px 0 10px;padding:10px 12px;border:1px dashed #E9C46A;border-radius:10px;background:#FFFDF6}
.qg-rategrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:6px 10px;margin:8px 0}
.qg-page{margin-top:12px}
.qg-page-wrap{position:relative;max-height:520px;overflow:auto;border:1px solid #E2DCCE;border-radius:8px;margin-top:4px}
.qg-page-wrap img{display:block;width:100%;height:auto}
.qg-page-hl{position:absolute;left:0;right:0;height:2.1%;margin-top:-0.4%;background:rgba(233,196,106,.45);border-top:2px solid #E9C46A;border-bottom:2px solid #E9C46A;pointer-events:none}
@media (max-width: 1100px){.qg{grid-template-columns:1fr 1fr}.qg-books{grid-column:1/-1}}
@media (max-width: 760px){.qg{grid-template-columns:1fr}.qg-books{grid-column:auto}}
.qg-compact{grid-template-columns:1fr;gap:12px}
.qg-compact .qg-books{grid-column:auto}
.qg-compact .qg-col{padding:12px}
.qg-compact .qg-addons{grid-template-columns:1fr}
.qg-compact .qg-tbl th:nth-child(5){width:26%}
`
