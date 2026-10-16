// =============================================================================
// QuoteGeneratorTab — Tools → Quote Generator (Paul 2026-10-16). The desktop
// shell around QuoteBuilder; Stonebooks Field mounts the same builder.
// =============================================================================
import QuoteBuilder from './components/QuoteBuilder'

export default function QuoteGeneratorTab({ onOpenSales, onOpenOrder }) {
  return (
    <div className="sb-page sb-page-wide">
      <style>{`
        .sb-qg-head{display:flex;align-items:baseline;gap:14px;flex-wrap:wrap;margin:0 0 14px}
        .sb-qg-h1{font-family:Georgia,serif;font-size:26px;font-weight:600;margin:0;color:var(--sb-text,#16150F)}
        .sb-qg-sub{font-size:13px;color:var(--sb-text-muted,#8A7F6C);overflow-wrap:anywhere}
      `}</style>
      <div className="sb-qg-head">
        <h1 className="sb-qg-h1">Quote Generator</h1>
        <span className="sb-qg-sub">Type the size, pick the shape, polish and color. The quote is the contract’s own math. The books show what the stone costs and what it sells for at your markup.</span>
      </div>
      <QuoteBuilder onOpenSales={onOpenSales} onOpenOrder={onOpenOrder} />
    </div>
  )
}
