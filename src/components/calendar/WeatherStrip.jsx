// =============================================================================
// 📚 Stonebooks — Weather Strip
// =============================================================================
// Two render shapes, gated by the `variant` prop:
//   • variant="day"  — full single-line strip in the Calendar Day view.
//                       "Thursday May 29 · 64°F · partly cloudy · 30%
//                       chance rain". Amber tint when forecast is adverse.
//   • variant="week" — compact per-day pill in Calendar Week column.
//                       "64° · rain" / "78° · clear" / etc.
//
// Both pull from the same shared session cache via fetchForecast. Failure
// renders nothing — silent per spec.
// =============================================================================

import { useEffect, useState } from 'react'
import {
  fetchForecast,
  periodForDate,
  forecastIsAdverse,
  shortConditionWord,
} from '../../lib/weather'

function useForecast() {
  const [forecast, setForecast] = useState(null)
  useEffect(() => {
    let cancelled = false
    fetchForecast().then(fc => { if (!cancelled) setForecast(fc) })
    return () => { cancelled = true }
  }, [])
  return forecast
}

export default function WeatherStrip({ date, variant = 'day' }) {
  const forecast = useForecast()
  if (!forecast) return null
  const iso = (date instanceof Date)
    ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
    : String(date || '').slice(0, 10)
  const period = periodForDate(forecast, iso)
  if (!period) return null

  if (variant === 'week') {
    const word = shortConditionWord(period)
    const adverse = forecastIsAdverse(period)
    return (
      <div className={`sb-weather-pill ${adverse ? 'sb-weather-pill-adverse' : ''}`}>
        <span className="sb-weather-pill-temp">{period.temperature}°</span>
        {word && <span className="sb-weather-pill-word">{word}</span>}
      </div>
    )
  }

  // Day variant — full single-line summary.
  const dayLabel = (date instanceof Date)
    ? date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
    : ''
  const conditionText = (period.shortForecast || '').toLowerCase()
  const adverse = forecastIsAdverse(period)
  const precip = period.probabilityOfPrecipitation
  const precipText = (precip != null && precip > 0) ? `${precip}% precip` : null

  return (
    <div className={`sb-weather-strip ${adverse ? 'sb-weather-strip-adverse' : ''}`}>
      <span className="sb-weather-strip-icon" aria-hidden="true">·</span>
      {dayLabel && <span className="sb-weather-strip-date">{dayLabel}</span>}
      <span className="sb-weather-strip-divider">·</span>
      <span className="sb-weather-strip-temp">{period.temperature}°{period.unit}</span>
      {conditionText && (
        <>
          <span className="sb-weather-strip-divider">·</span>
          <span className="sb-weather-strip-cond">{conditionText}</span>
        </>
      )}
      {precipText && (
        <>
          <span className="sb-weather-strip-divider">·</span>
          <span className="sb-weather-strip-precip">{precipText}</span>
        </>
      )}
    </div>
  )
}

// =============================================================================
// STYLES
// =============================================================================

const localStyles = `
  /* Day-view single line — sits below the date header, above field/shop.
     Calm by default; amber background and border when adverse. */
  .sb-weather-strip {
    display: flex;
    align-items: baseline;
    gap: 8px;
    padding: 8px 14px;
    margin-bottom: 16px;
    background: var(--sb-surface-muted);
    border: 0.5px solid var(--sb-border);
    border-radius: var(--sb-r-sm, 6px);
    font-size: 13px;
    color: var(--sb-text-secondary);
    flex-wrap: wrap;
  }
  .sb-weather-strip-adverse {
    background: var(--sb-amber-bg, #fbe5b8);
    border-color: var(--sb-amber, #b8842a);
    color: var(--sb-text);
  }
  .sb-weather-strip-icon {
    display: none;  /* reserved — keep slot for a future glyph */
  }
  .sb-weather-strip-date {
    font-weight: 500;
    color: var(--sb-text);
  }
  .sb-weather-strip-temp {
    font-weight: 500;
    color: var(--sb-text);
    font-variant-numeric: tabular-nums;
  }
  .sb-weather-strip-cond {
    color: var(--sb-text-secondary);
  }
  .sb-weather-strip-precip {
    color: var(--sb-text-secondary);
    font-variant-numeric: tabular-nums;
  }
  .sb-weather-strip-divider {
    color: var(--sb-text-muted);
  }

  /* Week-view compact pill — one per day column. Hangs out below the day
     header without dominating it. */
  .sb-weather-pill {
    display: inline-flex;
    align-items: baseline;
    gap: 4px;
    font-size: 10px;
    padding: 1px 6px;
    background: var(--sb-surface-muted);
    border-radius: 999px;
    color: var(--sb-text-muted);
    align-self: flex-start;
  }
  .sb-weather-pill-adverse {
    background: var(--sb-amber-bg, #fbe5b8);
    color: var(--sb-amber, #b8842a);
    font-weight: 500;
  }
  .sb-weather-pill-temp {
    font-variant-numeric: tabular-nums;
  }
  .sb-weather-pill-word {
    text-transform: lowercase;
  }
`

if (typeof document !== 'undefined' && !document.getElementById('sb-weather-strip-styles')) {
  const tag = document.createElement('style')
  tag.id = 'sb-weather-strip-styles'
  tag.textContent = localStyles
  document.head.appendChild(tag)
}
