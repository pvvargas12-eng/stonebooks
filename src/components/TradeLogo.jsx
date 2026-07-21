// =============================================================================
// TradeLogo — Stonebooks TRADE's own mark (SEND-1, Paul 2026-07-21)
// =============================================================================
// "I want a different logo than stonebooks because my workers..." — the trade
// side needs to be unmistakable at a glance. Steel-blue stacked slabs (granite
// stock on a rack) + a heavier wordmark, deliberately far from the cream/gold
// Stonebooks look. Inline SVG, no assets.
// =============================================================================

export default function TradeLogo({ size = 24, stacked = false, light = false }) {
  const ink = light ? '#EAF1F7' : '#1F3A52'
  const blue = light ? '#9FC2DD' : '#2C5F8A'
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 9, flexDirection: stacked ? 'column' : 'row' }}>
      <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
        <rect x="2.5" y="15" width="19" height="5.5" rx="1.2" fill={blue} />
        <rect x="5" y="9" width="14" height="4.8" rx="1.2" fill={blue} opacity="0.72" />
        <rect x="7.5" y="3.5" width="9" height="4.3" rx="1.2" fill={blue} opacity="0.45" />
      </svg>
      <span style={{
        fontFamily: "'Lato', 'Helvetica Neue', sans-serif", fontWeight: 900,
        letterSpacing: '0.04em', fontSize: Math.round(size * 0.78), lineHeight: 1,
        color: ink, textAlign: stacked ? 'center' : 'left',
      }}>
        STONEBOOKS <span style={{ color: blue }}>TRADE</span>
      </span>
    </span>
  )
}
