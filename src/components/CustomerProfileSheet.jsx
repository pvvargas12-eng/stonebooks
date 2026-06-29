// =============================================================================
// 📚 Stonebooks — Customer Profile sheet (printable intake form)
// =============================================================================
// Mirrors the shop's paper customer-intake form, pre-filled from order +
// customer data. Reachable from the customer record AND from an order. Renders
// in an overlay you can read on screen, with a Print button; the print CSS
// isolates just the sheet so it comes out clean (no app chrome).
//
// `order` is a raw orders row (snake_case) with customer + cemetery joined, as
// returned by getOrderById. When opened from a customer with no order, a minimal
// { customer } object is passed and every order-derived field falls back to a
// blank line — exactly like a fresh paper form.
// =============================================================================

import { fmtPhone, fmtDate } from '../lib/stonebooksData'

// Service-type checklist — the codes the paper form carries. Inscription splits
// into Full / M-D-Y / Year by the order's inscription type (wizard: type
// full/date/year; quick form: tier full/mdy/year).
function buildServiceChecks(order) {
  const st = (order?.service_types || []).map(s => String(s).toUpperCase())
  const insc = order?.inscription || {}
  const t = insc.type || insc.tier || null
  const hasInsc = st.includes('INSCRIPTION')
  return [
    { label: 'New stone',  on: st.includes('NEW_STONE') },
    { label: 'Bronze',     on: st.includes('BRONZE') },
    { label: 'Full insc.', on: hasInsc && t === 'full' },
    { label: 'M/D/Y insc.', on: hasInsc && (t === 'date' || t === 'mdy') },
    { label: 'Year only',  on: hasInsc && t === 'year' },
    { label: 'Acid wash',  on: st.includes('ACID_WASH') },
    { label: 'Repair',     on: st.includes('REPAIR') },
    { label: 'Add photo',  on: st.includes('ADD_PHOTO') },
  ]
}

function plotChecks(order) {
  const type = (order?.plot_type || '').toLowerCase()
  // "Map on back" — checked when the order carries specific plot-location detail
  // (the cemetery map gets sketched on the back of the form for those).
  const hasMapDetail = !!(order?.grave_location || order?.plot_section || order?.plot_block ||
    order?.plot_lot || order?.plot_grave || order?.plot_space || order?.plot_lat)
  return [
    { label: 'Single',      on: type === 'single' },
    { label: 'Double',      on: type === 'double' },
    { label: 'DD',          on: type === 'dd' },
    { label: 'SxS',         on: type === 'sxs' },
    { label: 'Map on back', on: hasMapDetail },
  ]
}

function Box({ on, label }) {
  return (
    <span className="cps-check">
      <span className={`cps-box${on ? ' on' : ''}`}>{on ? '✓' : ''}</span>
      <span className="cps-check-label">{label}</span>
    </span>
  )
}

// A labeled fill-in line; renders the value, or a blank rule when empty.
function Line({ label, value, wide }) {
  return (
    <div className={`cps-line${wide ? ' wide' : ''}`}>
      <span className="cps-line-label">{label}</span>
      <span className="cps-line-value">{value || ' '}</span>
    </div>
  )
}

export default function CustomerProfileSheet({ order, onClose }) {
  const c = order?.customer || {}
  const name = [c.first_name, c.last_name].filter(Boolean).join(' ')
  const addr1 = c.address_line1 || ''
  const addr2 = [c.city, c.state].filter(Boolean).join(', ') + (c.zip ? ` ${c.zip}` : '')
  const fullAddr = [addr1, c.address_line2, addr2.trim()].filter(Boolean).join(', ')
  const cemetery = order?.cemetery?.name || order?.cemetery_name || ''
  const deceased = Array.isArray(order?.deceased) ? order.deceased : []
  const firstNamed = deceased.find(d => d && !d.isReserved && (d.firstName || d.lastName)) || deceased[0] || {}
  const title = firstNamed.title || ''
  const matchingTo = order?.matching_to_description || ''
  // "Description" — the free-text describing the work. Prefer the design wishes
  // and any repair/other detail; fall back to staff notes.
  const description = (() => {
    const parts = [order?.design_preferences, order?.other_service_description].filter(Boolean)
    if (parts.length) return parts.join('\n\n')
    const sn = order?.staff_notes
    if (Array.isArray(sn)) return sn.map(n => typeof n === 'string' ? n : (n?.text || n?.body || '')).filter(Boolean).join('\n')
    return ''
  })()

  return (
    <div className="cps-overlay" onClick={onClose}>
      <style>{CPS_CSS}</style>
      <div className="cps-modal" onClick={e => e.stopPropagation()}>
        <div className="cps-actions">
          <button type="button" className="cps-btn cps-btn-primary" onClick={() => window.print()}>Print</button>
          <button type="button" className="cps-btn" onClick={onClose}>Close</button>
        </div>

        <div className="cps-sheet">
          {/* Header */}
          <div className="cps-head">
            <div className="cps-head-brand">
              <div className="cps-brand-name">Shevchenko Monuments</div>
              <div className="cps-brand-sub">Customer Profile</div>
            </div>
            <div className="cps-head-meta">
              <div><span className="cps-meta-label">Date</span> {order?.created_at ? fmtDate(order.created_at) : ' '}</div>
              <div><span className="cps-meta-label">Estimate #</span> {order?.order_number || ' '}</div>
            </div>
          </div>

          {/* Service-type checklist */}
          <div className="cps-section">
            <div className="cps-section-title">Service</div>
            <div className="cps-checks">
              {buildServiceChecks(order).map((s, i) => <Box key={i} on={s.on} label={s.label} />)}
            </div>
          </div>

          {/* Cemetery + plot */}
          <div className="cps-section">
            <div className="cps-section-title">Cemetery</div>
            <Line label="Cemetery" value={cemetery} wide />
            <div className="cps-checks">
              {plotChecks(order).map((s, i) => <Box key={i} on={s.on} label={s.label} />)}
            </div>
          </div>

          {/* Customer */}
          <div className="cps-section">
            <div className="cps-section-title">Customer</div>
            <Line label="Name" value={name} wide />
            <Line label="Address" value={fullAddr} wide />
            <div className="cps-row2">
              <Line label="Phone" value={c.phone_primary ? fmtPhone(c.phone_primary) : ''} />
              <Line label="Email" value={c.email || ''} />
            </div>
          </div>

          {/* Description */}
          <div className="cps-section">
            <div className="cps-section-title">Description</div>
            <div className="cps-desc">{description || ' '}</div>
          </div>

          {/* Extra questions */}
          <div className="cps-section">
            <div className="cps-section-title">Details</div>
            <Line label="Matching to" value={matchingTo} wide />
            <Line label="Title of deceased" value={title} wide />
            <Line label="Permit or deed" value="" wide />
            <Line label="How did you hear about us?" value="" wide />
          </div>
        </div>
      </div>
    </div>
  )
}

const CPS_CSS = `
  .cps-overlay {
    position: fixed; inset: 0; background: rgba(15,20,25,0.5); z-index: 1200;
    display: flex; align-items: flex-start; justify-content: center;
    padding: 24px; overflow-y: auto;
  }
  .cps-modal { width: 100%; max-width: 820px; }
  .cps-actions { display: flex; justify-content: flex-end; gap: 8px; margin-bottom: 10px; }
  .cps-btn {
    font: inherit; font-size: 14px; font-weight: 500; padding: 8px 18px; border-radius: 8px;
    border: 0.5px solid #d8d6d1; background: #fff; color: #333; cursor: pointer;
  }
  .cps-btn-primary { background: #9A7209; color: #fff; border-color: transparent; font-weight: 600; }
  .cps-btn-primary:hover { filter: brightness(0.95); }

  .cps-sheet {
    background: #fff; color: #111; padding: 32px 36px; border-radius: 8px;
    font-family: Georgia, 'Times New Roman', serif; font-size: 13.5px; line-height: 1.5;
  }
  .cps-head { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #111; padding-bottom: 12px; margin-bottom: 16px; }
  .cps-brand-name { font-size: 20px; font-weight: 700; letter-spacing: 0.01em; }
  .cps-brand-sub { font-size: 13px; color: #555; text-transform: uppercase; letter-spacing: 0.14em; margin-top: 2px; }
  .cps-head-meta { text-align: right; font-size: 13px; }
  .cps-head-meta > div { margin-bottom: 4px; }
  .cps-meta-label { font-weight: 700; text-transform: uppercase; font-size: 10px; letter-spacing: 0.08em; color: #555; margin-right: 6px; }

  .cps-section { border: 1px solid #bdbab3; border-radius: 6px; padding: 12px 14px; margin-bottom: 12px; }
  .cps-section-title { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.12em; color: #777; margin-bottom: 10px; }

  .cps-checks { display: flex; flex-wrap: wrap; gap: 8px 22px; }
  .cps-check { display: inline-flex; align-items: center; gap: 7px; font-size: 13px; }
  .cps-box { width: 15px; height: 15px; border: 1.5px solid #333; border-radius: 2px; display: inline-flex; align-items: center; justify-content: center; font-size: 11px; line-height: 1; color: #111; }
  .cps-box.on { background: #111; color: #fff; }

  .cps-line { display: flex; align-items: baseline; gap: 8px; margin-bottom: 8px; }
  .cps-line.wide { display: block; }
  .cps-line-label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: #555; white-space: nowrap; }
  .cps-line.wide .cps-line-label { display: block; margin-bottom: 2px; }
  .cps-line-value { flex: 1; border-bottom: 1px solid #999; min-height: 18px; padding: 0 2px 2px; }
  .cps-line.wide .cps-line-value { display: block; }
  .cps-row2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  .cps-row2 .cps-line { display: block; }

  .cps-desc { border: 1px solid #ccc; border-radius: 4px; min-height: 56px; padding: 8px 10px; white-space: pre-wrap; }

  @media print {
    body * { visibility: hidden !important; }
    .cps-overlay, .cps-overlay * { visibility: visible !important; }
    .cps-overlay { position: absolute; inset: 0; background: #fff; padding: 0; display: block; overflow: visible; }
    .cps-modal { max-width: none; width: 100%; }
    .cps-actions { display: none !important; }
    .cps-sheet { border-radius: 0; padding: 0.25in 0.4in; }
    .cps-section { break-inside: avoid; }
    @page { margin: 0.5in; }
  }
`
