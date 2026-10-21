// =============================================================================
// OrderPeek — everything important about an order, in one dark sheet.
// =============================================================================
// Paul 2026-10-20: "click on the name and see a preview of all important order
// information, then easily open the order in sales and quickly go back." Used
// by the Production floor (every family name) and the Line Planner's rows.
// Paul 2026-10-21: "is the stone here and is the design approved — that's what
// I'm looking for" → the GATES strip up top answers that first.
// =============================================================================
import { useState, useEffect } from 'react'
import {
  getOrderById, getJobByOrderId, getOrderNotes,
  rowGrandTotal, rowTotalPaid, rowBalanceDue, derivePaymentStatus,
  deriveDesignStatus, deriveStoneStatus, deriveFdnStatus, DESIGN_STATUS, STONE_STATUS, FDN_STATUS,
  fmtUSD, fmtDate, fmtPhone, properName, dueDateTone, permitStatusLabel,
} from '../lib/stonebooksData'
import { contractDieLabel, contractBaseLabel } from '../lib/jobComponents'
import { composeGraveLocation, displayGraniteColor } from '../lib/monumentCatalog'

const niceCase = (s) => {
  if (!s || s !== s.toUpperCase() || !/[A-Z]/.test(s)) return s
  return s.toLowerCase().replace(/(^|[\s\-'])(\p{L})/gu, (m, sep, ch) => sep + ch.toUpperCase())
}
// ── ORDER PEEK — everything important about the order, in one dark sheet ──
const statusLabel = (arr, code) => arr.find(s => s.code === code)?.label || (code ? String(code).replace(/_/g, ' ') : '—')
const SERVICE_WORDS = { NEW_STONE: 'New stone', BRONZE: 'Bronze services', BRONZE_MARKER: 'Bronze services', INSCRIPTION: 'Inscription', ACID_WASH: 'Acid wash', ADD_PHOTO: 'Add photo', REPAIR: 'Repair', CIVIC_MEMORIAL: 'Civic memorial', MAUSOLEUM: 'Mausoleum', OTHER: 'Other' }
const Row = ({ label, children, tone = null }) => (
  <div className="pf-peek-row"><span className="pf-peek-lab">{label}</span><span className={`pf-peek-val${tone ? ` ${tone}` : ''}`}>{children ?? '—'}</span></div>
)
export default function OrderPeek({ orderId, onClose, onOpenOrder, onOpenSales }) {
  const [data, setData] = useState(null)   // { orderId, order, job, notes }
  useEffect(() => {
    let alive = true
    Promise.all([getOrderById(orderId), getJobByOrderId(orderId).catch(() => null), getOrderNotes(orderId).catch(() => [])])
      .then(([order, job, notes]) => { if (alive) setData({ orderId, order, job, notes: notes || [] }) })
      .catch(() => { if (alive) setData({ orderId, order: null, job: null, notes: [] }) })
    return () => { alive = false }
  }, [orderId])
  useEffect(() => {
    const k = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])
  const loaded = data && data.orderId === orderId
  const o = loaded ? data.order : null
  const job = loaded ? data.job : null
  const notes = loaded ? data.notes : []

  const fam = o ? niceCase(o.primary_lastname || o.customer?.last_name || '') || '—' : '…'
  const cust = o?.customer ? [o.customer.first_name, o.customer.last_name].filter(Boolean).join(' ') : ''
  const phone = o?.customer?.phone_primary || ''
  const email = o?.customer?.email || ''
  const total = o ? rowGrandTotal(o) : 0, paid = o ? rowTotalPaid(o) : 0, bal = o ? rowBalanceDue(o) : 0
  const services = (o?.service_types || []).map(c => SERVICE_WORDS[c] || String(c).replace(/_/g, ' '))
  const deceased = (Array.isArray(o?.deceased) ? o.deceased : []).filter(d => d && !d.isReserved && (d.firstName || d.lastName)).map(d => {
    const yrs = [d.dateOfBirth, d.dateOfDeath].map(x => (x ? String(x).slice(0, 4) : '')).filter(Boolean).join('–')
    return `${[d.firstName, d.lastName].filter(Boolean).join(' ')}${yrs ? ` (${yrs})` : ''}`
  })
  const grave = o ? composeGraveLocation(o) : ''
  const die = o ? contractDieLabel(o) : null
  const base = o ? contractBaseLabel(o) : null
  const color = o ? displayGraniteColor(o) : null
  const design = job ? deriveDesignStatus(job) : null
  const stone = job ? deriveStoneStatus(job) : null
  const fdn = job ? deriveFdnStatus(job) : null
  const payState = o ? derivePaymentStatus(o) : null
  const due = o?.target_completion_date || null
  const dueTone = due ? dueDateTone(due) : null
  // The three bring-up gates, answered first. The order's own piece statuses
  // (Monument card: not_ordered / ordered / in_stock) win over the milestones.
  const dieS = o?.die_stone_status || null
  const baseS = o?.base_stone_status || null
  const stoneWord = dieS === 'in_stock' ? 'here' : dieS === 'ordered' ? 'ordered' : dieS === 'not_ordered' ? 'not ordered'
    : ['arrived', 'in_stock', 'needs_stencil_cut', 'needs_blasting', 'blasted'].includes(stone) ? 'here'
    : ['ordered', 'needs_pickup'].includes(stone) ? 'ordered' : stone ? 'not ordered' : null
  const designOk = ['layout_approved', 'cut'].includes(design)
  const contracted = !!o?.signed_at || ['contracted', 'in_production', 'paid_in_full', 'installed', 'closed'].includes(o?.status)
  const blocker = o?.manual_blocker?.kind ? `${String(o.manual_blocker.kind).replace(/_/g, ' ').toUpperCase()}${o.manual_blocker.note ? ` — ${o.manual_blocker.note}` : ''}` : null
  return (
    <div className="pf-modal-overlay" onClick={onClose}>
      <style>{PEEK_CSS}</style>
      <div className="pf-modal pf-peek" role="dialog" aria-modal="true" aria-label="Order preview" onClick={e => e.stopPropagation()}>
        {!loaded ? <div className="pf-modal-hint">Loading the order…</div> : !o ? <div className="pf-card-err">Could not load this order.</div> : (
          <>
            <div className="pf-peek-head">
              <span className="pf-peek-fam">{fam}</span>
              <span className="pf-peek-num">{o.order_number || 'DRAFT'}</span>
              {services.map(sv => <span key={sv} className="pf-peek-tag">{sv}</span>)}
              <span className="pf-peek-tag">{String(o.status || '').replace(/_/g, ' ')}</span>
              <span className={`pf-peek-bal${bal <= 0 ? ' paid' : ''}`}>
                <b>{bal > 0 ? fmtUSD(bal) : 'PAID'}</b>
                <span>{bal > 0 ? 'balance due' : 'in full'} · {fmtUSD(total)} contract · {fmtUSD(paid)} paid</span>
              </span>
            </div>
            <div className="pf-peek-gates">
              <span className={`pf-peek-gate ${stoneWord === 'here' ? 'good' : stoneWord === 'ordered' ? 'mid' : 'bad'}`}>
                {stoneWord === 'here' ? 'STONE HERE' : stoneWord === 'ordered' ? 'STONE ORDERED' : stoneWord === 'not ordered' ? 'STONE NOT ORDERED' : 'STONE —'}
              </span>
              {baseS && <span className={`pf-peek-gate ${baseS === 'in_stock' ? 'good' : baseS === 'ordered' ? 'mid' : 'bad'}`}>{baseS === 'in_stock' ? 'BASE HERE' : baseS === 'ordered' ? 'BASE ORDERED' : 'BASE NOT ORDERED'}</span>}
              <span className={`pf-peek-gate ${designOk ? 'good' : 'bad'}`}>{designOk ? 'DESIGN APPROVED' : job ? 'DESIGN NOT APPROVED' : 'NO JOB YET'}</span>
              <span className={`pf-peek-gate ${contracted ? 'good' : 'bad'}`}>{contracted ? 'CONTRACTED' : 'NOT SIGNED'}</span>
            </div>
            <div className="pf-peek-grid">
              <Row label="Customer">{cust ? properName(cust) : '—'}{phone ? <> · <a href={`tel:${phone}`}>{fmtPhone(phone)}</a></> : null}{email ? <> · <a href={`mailto:${email}`}>{email}</a></> : null}</Row>
              <Row label="In memory of">{deceased.length ? deceased.join(' · ') : '—'}</Row>
              <Row label="Cemetery">{o.cemetery?.name ? niceCase(o.cemetery.name) : '—'}{grave ? ` · ${grave}` : ''}</Row>
              <Row label="Due" tone={dueTone === 'red' ? 'red' : dueTone === 'amber' ? 'amber' : null}>{due ? fmtDate(due) : '—'}</Row>
              <Row label="Die">{die || '—'}</Row>
              <Row label="Base">{base || '—'}</Row>
              <Row label="Color">{color || '—'}</Row>
              <Row label="Payment" tone={payState === 'paid_in_full' || bal <= 0 ? 'green' : 'red'}>{bal <= 0 ? 'Paid in full' : statusLabel([], payState)}</Row>
              <Row label="Design" tone={design === 'layout_approved' || design === 'cut' ? 'green' : null}>{job ? statusLabel(DESIGN_STATUS, design) : 'no job yet'}</Row>
              <Row label="Stone / bronze" tone={['blasted', 'arrived', 'in_stock'].includes(stone) ? 'green' : null}>{job ? statusLabel(STONE_STATUS, stone) : 'no job yet'}</Row>
              <Row label="Foundation" tone={fdn === 'in' || fdn === 'drop_off' ? 'green' : null}>{job ? statusLabel(FDN_STATUS, fdn) : 'no job yet'}{o.foundation_type ? ` · ${o.foundation_type}` : ''}</Row>
              <Row label="Permit" tone={o.permit_status === 'approved' ? 'green' : o.permit_status === 'denied' ? 'red' : null}>{permitStatusLabel(o.permit_status) || '—'}{o.permit_form ? ` · ${o.permit_form === 'shevco' ? 'Shevco form' : "cemetery's form"}` : ''}</Row>
              <Row label="Signed">{o.signed_at ? fmtDate(o.signed_at) : 'not signed'}</Row>
              <Row label="Blocker" tone={blocker ? 'red' : null}>{blocker || 'none'}</Row>
              {o.inscription?.epitaph && <Row label="Verse">{o.inscription.epitaph}</Row>}
            </div>
            <div className="pf-peek-lab" style={{ marginTop: 4 }}>Notes</div>
            {notes.length === 0 ? <div className="pf-modal-hint" style={{ color: '#8b95a5' }}>No notes on this order.</div> : (
              <div className="pf-peek-notes">
                {notes.slice(0, 3).map(n => <div key={n.id} className="pf-peek-note">{n.body}<small>{n.author || 'Staff'} · {fmtDate(n.created_at)}</small></div>)}
                {notes.length > 3 && <div className="pf-modal-hint" style={{ color: '#8b95a5' }}>{notes.length - 3} more on the order page.</div>}
              </div>
            )}
            <div className="pf-peek-actions">
              <button type="button" className="pf-peek-btn" onClick={onClose}>Back to the floor</button>
              <button type="button" className="pf-peek-btn green" onClick={onOpenOrder} title="Open the order page — Back returns to the floor">Open order</button>
              {onOpenSales && <button type="button" className="pf-peek-btn gold" onClick={onOpenSales} title="Open the contract in the sales wizard — Exit returns to the floor">Open in Sales</button>}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// The overlay / modal shell classes come from the floor's CSS when mounted
// there; these cover the sheet itself (and the shell, when mounted elsewhere).
const PEEK_CSS = `
  .pf-modal-overlay { position: fixed; inset: 0; z-index: 1300; background: rgba(5,8,12,.6); display: flex; align-items: center; justify-content: center; padding: 20px; }
  .pf-modal { background: #11151c; border: 1px solid #3a4452; border-radius: 12px; width: min(640px, 96vw); padding: 16px 18px; display: flex; flex-direction: column; gap: 10px; box-shadow: 0 24px 60px rgba(0,0,0,.5); color: #e5e7eb; font-size: 13px; }
  .pf-modal-hint { font-size: 11.5px; color: #34d399; }
  .pf-card-err { font-size: 12px; color: #f87171; }
  .pf-peek { width: min(780px, 96vw); max-height: 90vh; overflow-y: auto; }
  .pf-peek-gates { display: flex; flex-wrap: wrap; gap: 6px; }
  .pf-peek-gate { font-size: 11px; font-weight: 800; letter-spacing: .06em; padding: 5px 10px; border-radius: 999px; border: 1px solid transparent; white-space: nowrap; }
  .pf-peek-gate.good { background: rgba(52,211,153,.14); color: #34d399; border-color: rgba(52,211,153,.4); }
  .pf-peek-gate.mid { background: rgba(96,165,250,.14); color: #93c5fd; border-color: rgba(96,165,250,.4); }
  .pf-peek-gate.bad { background: rgba(248,113,113,.14); color: #f87171; border-color: rgba(248,113,113,.4); }
  .pf-peek-head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 8px 12px; }
  .pf-peek-fam { font-size: 20px; font-weight: 800; color: #f4f6fa; overflow-wrap: anywhere; }
  .pf-peek-num { font-family: ui-monospace, 'JetBrains Mono', monospace; font-size: 12px; color: #8b95a5; }
  .pf-peek-tag { font-size: 10px; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; padding: 2px 7px; border-radius: 999px; background: #1f2937; color: #cbd5e1; border: 1px solid #334155; white-space: nowrap; }
  .pf-peek-bal { margin-left: auto; text-align: right; display: flex; flex-direction: column; min-width: 0; }
  .pf-peek-bal b { font-family: ui-monospace, 'JetBrains Mono', monospace; font-size: 20px; color: #f87171; white-space: nowrap; }
  .pf-peek-bal.paid b { color: #34d399; }
  .pf-peek-bal span { font-size: 11px; color: #8b95a5; overflow-wrap: anywhere; }
  .pf-peek-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 0 18px; }
  .pf-peek-row { min-width: 0; display: flex; flex-direction: column; gap: 2px; padding: 7px 0; border-bottom: 1px solid #232a35; }
  .pf-peek-lab { font-size: 10px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; color: #8b95a5; }
  .pf-peek-val { font-size: 13px; color: #e5e7eb; overflow-wrap: anywhere; }
  .pf-peek-val a { color: #93c5fd; text-decoration: none; }
  .pf-peek-val.red { color: #f87171; font-weight: 700; }
  .pf-peek-val.green { color: #34d399; font-weight: 700; }
  .pf-peek-val.amber { color: #fbbf24; font-weight: 700; }
  .pf-peek-notes { display: flex; flex-direction: column; gap: 6px; }
  .pf-peek-note { background: #0f131a; border: 1px solid #232a35; border-radius: 8px; padding: 7px 10px; font-size: 12.5px; color: #e5e7eb; overflow-wrap: anywhere; white-space: pre-wrap; }
  .pf-peek-note small { display: block; color: #8b95a5; margin-top: 3px; font-size: 11px; }
  .pf-peek-actions { display: flex; flex-wrap: wrap; gap: 8px; justify-content: flex-end; margin-top: 4px; }
  .pf-peek-btn { font: inherit; font-size: 13px; font-weight: 700; padding: 8px 14px; border-radius: 8px; border: 1px solid #3a4452; background: #1a212b; color: #f4f6fa; cursor: pointer; white-space: nowrap; }
  .pf-peek-btn.gold { background: #b8842a; border-color: #b8842a; color: #16150f; }
  .pf-peek-btn.green { background: #1f7a3a; border-color: #1f7a3a; color: #fff; }
`
