// =============================================================================
// QuoteScreen — the Quote Generator on the phone (owner More tile). Paul
// 2026-10-16: "mainly on Stonebooks desktop, I just also want it built for
// Stonebooks Field." Same QuoteBuilder, stacked for a phone; pricing a lead
// from here saves the contract and opens the order in the drill.
// =============================================================================
import QuoteBuilder from '../components/QuoteBuilder'

export default function QuoteScreen({ onBack, onOpenJob }) {
  return (
    <div>
      {onBack && (
        <button type="button" className="fl-rowline" onClick={onBack}
          style={{ color: '#9A7209', fontWeight: 700, fontSize: 15, minHeight: 44 }}>
          &#8249; Menu
        </button>
      )}
      <div className="fl-greet" style={{ fontSize: 29 }}>Quote</div>
      <div className="fl-greet-sub">Size, shape, polish, color — the contract’s own price, and what the books say it costs</div>
      <div style={{ marginTop: 10 }}>
        <QuoteBuilder compact onOpenOrder={onOpenJob ? (id) => onOpenJob({ orderId: id }) : undefined} />
      </div>
    </div>
  )
}
