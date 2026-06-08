// =============================================================================
// 📚 Stonebooks — Weather forecast (NWS / weather.gov)
// =============================================================================
// One-shot NWS lookup driven by SHOP_COORDINATES. Two-call protocol:
//   1. GET /points/{lat},{lng}   → returns a grid-specific forecast URL
//   2. GET <that URL>            → returns 7 days of period forecasts
//
// Session-cached in memory — NWS forecasts update ~hourly, so a per-mount
// fetch per session is plenty. UA header included per NWS usage policy.
//
// Silent failure: every error path resolves to null. The UI never shows
// an error; it just doesn't render a weather strip when the data isn't
// available. Weather is a nice-to-have, never blocking.
// =============================================================================

import { SHOP_COORDINATES } from './stonebooksData'

const USER_AGENT = 'Stonebooks/1.0 (shevcoteam@gmail.com)'
const POINTS_BASE = 'https://api.weather.gov/points'
// Session cache — key by rounded lat,lng so multiple consumers share the
// same payload. We do NOT persist across reloads; the page lifetime is the
// natural cache window for an hourly-updated forecast.
const _cache = new Map()
const _inflight = new Map()

function _key(lat, lng) {
  return `${Number(lat).toFixed(4)},${Number(lng).toFixed(4)}`
}

async function _fetchJson(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/geo+json' },
  })
  if (!res.ok) throw new Error(`NWS ${res.status}`)
  return res.json()
}

// Returns { periods: [...] } where each period is the simplified shape:
//   { name, isDaytime, startTime, endTime, temperature, unit,
//     shortForecast, detailedForecast, probabilityOfPrecipitation,
//     windSpeed, windDirection }
// On any failure (network, NWS down, malformed response) resolves to null.
export async function fetchForecast(lat, lng) {
  const latN = Number(lat ?? SHOP_COORDINATES.lat)
  const lngN = Number(lng ?? SHOP_COORDINATES.lng)
  if (!Number.isFinite(latN) || !Number.isFinite(lngN)) return null
  const key = _key(latN, lngN)
  if (_cache.has(key)) return _cache.get(key)
  if (_inflight.has(key)) return _inflight.get(key)

  const promise = (async () => {
    try {
      const pointsUrl = `${POINTS_BASE}/${latN},${lngN}`
      const point = await _fetchJson(pointsUrl)
      const forecastUrl = point?.properties?.forecast
      if (!forecastUrl) return null
      const fc = await _fetchJson(forecastUrl)
      const periods = fc?.properties?.periods || []
      const simplified = periods.map(p => ({
        name:                      p.name,
        isDaytime:                 !!p.isDaytime,
        startTime:                 p.startTime,
        endTime:                   p.endTime,
        temperature:               p.temperature,
        unit:                      p.temperatureUnit || 'F',
        shortForecast:             p.shortForecast,
        detailedForecast:          p.detailedForecast,
        probabilityOfPrecipitation: p.probabilityOfPrecipitation?.value ?? null,
        windSpeed:                 p.windSpeed,
        windDirection:             p.windDirection,
      }))
      const out = { periods: simplified }
      _cache.set(key, out)
      return out
    } catch (e) {
      console.warn('[weather] forecast fetch failed:', e?.message || e)
      return null
    } finally {
      _inflight.delete(key)
    }
  })()
  _inflight.set(key, promise)
  return promise
}

// Convenience — pick the period that covers an ISO date. NWS periods come
// as alternating day/night entries; we prefer the daytime period when one
// exists for that calendar date (a field crew cares about the day's high
// + the daytime conditions, not the overnight low).
export function periodForDate(forecast, isoDate) {
  if (!forecast?.periods?.length || !isoDate) return null
  const target = String(isoDate).slice(0, 10)
  // Walk periods, pick first daytime period whose startTime begins on the
  // target date. Falls back to the first period that starts on the date
  // (in case the day's first period is the overnight one).
  let fallback = null
  for (const p of forecast.periods) {
    if (!p.startTime) continue
    const s = String(p.startTime).slice(0, 10)
    if (s !== target) continue
    if (p.isDaytime) return p
    if (!fallback) fallback = p
  }
  return fallback
}

// Tone classifier — used by the strip to decide whether to render the
// amber tint. We trigger amber when the forecast contains words that
// genuinely affect field work. Conservative on purpose; "partly cloudy"
// does NOT trigger amber.
const ALARM_WORDS = [
  'snow', 'thunderstorm', 'storm', 'severe', 'tornado',
  'high wind', 'gust', 'heavy rain', 'freezing', 'ice',
  'sleet', 'hurricane', 'tropical',
]
export function forecastIsAdverse(period) {
  if (!period) return false
  const text = `${period.shortForecast || ''} ${period.detailedForecast || ''}`.toLowerCase()
  return ALARM_WORDS.some(w => text.includes(w))
}

// Short word for the compact Week-view indicator. Picks one of: rain, snow,
// storm, clear, cloudy, sun. Defaults to lowercase of the short forecast's
// first word if nothing recognizable.
export function shortConditionWord(period) {
  if (!period) return ''
  const text = (period.shortForecast || '').toLowerCase()
  if (text.includes('snow'))       return 'snow'
  if (text.includes('thunder'))    return 'storm'
  if (text.includes('storm'))      return 'storm'
  if (text.includes('rain'))       return 'rain'
  if (text.includes('shower'))     return 'rain'
  if (text.includes('sunny'))      return 'sunny'
  if (text.includes('clear'))      return 'clear'
  if (text.includes('cloud'))      return 'cloudy'
  if (text.includes('fog'))        return 'foggy'
  return text.split(/\s+/)[0] || ''
}
