// =============================================================================
// fieldShared.js — tiny helpers shared by the Field Mode screens
// =============================================================================
import { rowTotalPaid } from '../lib/stonebooksData'

// LEAD = no real (locked, non-voided) money down and not a terminal status —
// the same money-half rule the desktop LEAD pills use.
export function isLeadRaw(orderRow) {
  if (!orderRow) return false
  if (['closed', 'cancelled', 'archived'].includes(orderRow.status)) return false
  return (rowTotalPaid(orderRow) || 0) <= 0
}

export function familyNameOf(orderRow) {
  const c = orderRow?.customer
  return (orderRow?.primary_lastname && String(orderRow.primary_lastname).trim().toUpperCase())
    || (c?.last_name && String(c.last_name).trim().toUpperCase())
    || [c?.first_name, c?.last_name].filter(Boolean).join(' ').toUpperCase()
    || '—'
}

// Apple Maps handles both platforms (iOS opens the app, elsewhere it 302s to
// Google). Address wins; falls back to geocoded coordinates, then name.
export function directionsUrl(cem) {
  if (!cem) return null
  const addr = [cem.address, [cem.city, cem.state, cem.zip].filter(Boolean).join(' ')]
    .filter(Boolean).join(', ')
  if (addr) return `https://maps.apple.com/?daddr=${encodeURIComponent(addr)}`
  if (cem.geocoded_lat && cem.geocoded_lng) return `https://maps.apple.com/?daddr=${cem.geocoded_lat},${cem.geocoded_lng}`
  if (cem.name) return `https://maps.apple.com/?q=${encodeURIComponent(cem.name)}`
  return null
}

export const BATCH_KIND_CHIP = {
  setting:         { label: 'SET',       cls: 'fl-k-set' },
  delivery:        { label: 'DELIVERY',  cls: 'fl-k-del' },
  foundation_trip: { label: 'FDN TRIP',  cls: 'fl-k-fdn' },
  inscription:     { label: 'INSCRIPTION', cls: 'fl-k-del' },
  blasting:        { label: 'BLASTING',  cls: 'fl-k-del' },
  acid_wash:       { label: 'ACID WASH', cls: 'fl-k-del' },
  repair:          { label: 'REPAIR',    cls: 'fl-k-del' },
  rub_grab:        { label: 'RUB & GRAB', cls: 'fl-k-fdn' },
  door_trip:       { label: 'DOOR TRIP', cls: 'fl-k-del' },
  site_visit:      { label: 'SITE VISIT', cls: 'fl-k-fdn' },
  errand:          { label: 'ERRAND',    cls: 'fl-k-fdn' },
}

const TONE_CLS = { good: 'fl-c-good', warn: 'fl-c-warn', info: 'fl-c-info', neutral: 'fl-c-neutral', bad: 'fl-c-bad' }
export const toneCls = (tone) => TONE_CLS[tone] || 'fl-c-neutral'

export function fmtDayLabel(iso) {
  const d = new Date(String(iso).slice(0, 10) + 'T00:00:00')
  if (isNaN(d.getTime())) return iso
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const diff = Math.round((d - today) / 86400000)
  const name = d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })
  if (diff === 0) return `Today — ${name}`
  if (diff === 1) return `Tomorrow — ${name}`
  return name
}

export const todayISO = () => {
  const d = new Date(); const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export const isoPlusDays = (days) => {
  const d = new Date(); d.setDate(d.getDate() + days)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
