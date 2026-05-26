#!/usr/bin/env node
// =============================================================================
// 📚 Stonebooks — One-time cemetery geocoder
// =============================================================================
// Selects cemeteries with NULL geocoded_at and a non-empty address, queries
// OpenStreetMap Nominatim to resolve lat/lng, and writes the result back to
// the cemeteries table. Honors Nominatim's 1 req/sec usage policy + the
// required User-Agent header.
//
// Usage:
//   1. Run the scheduler-substrate migration first (adds the geocoding cols).
//   2. From the repo root with .env populated:
//        node scripts/geocode_cemeteries.mjs
//   3. Re-run safely — it skips any row already geocoded.
//
// Environment variables required:
//   SUPABASE_URL              — your project URL
//   SUPABASE_SERVICE_ROLE_KEY — service role (the script writes back)
//
// The script writes ~1 cemetery per second. With 50-150 active cemeteries
// in Shevchenko's book this finishes in 1-3 minutes.
// =============================================================================

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL  = process.env.SUPABASE_URL
const SUPABASE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY
const USER_AGENT    = 'Stonebooks/1.0 (paul@shevchenkomonuments.com)'
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search'
const DELAY_MS      = 1100   // a hair over 1s to be safely under Nominatim's limit

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env.')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

const sleep = (ms) => new Promise(r => setTimeout(r, ms))

async function geocodeAddress(address) {
  const params = new URLSearchParams({ q: address, format: 'json', limit: '1' })
  const res = await fetch(`${NOMINATIM_URL}?${params}`, {
    headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json' },
  })
  if (!res.ok) {
    throw new Error(`Nominatim returned ${res.status} for "${address}"`)
  }
  const data = await res.json()
  if (!Array.isArray(data) || data.length === 0) return null
  const top = data[0]
  const lat = parseFloat(top.lat)
  const lng = parseFloat(top.lon)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  return { lat, lng, display: top.display_name }
}

async function main() {
  console.log('Fetching cemeteries needing geocoding…')
  const { data: rows, error } = await supabase
    .from('cemeteries')
    .select('id, name, address, geocoded_at')
    .is('geocoded_at', null)
  if (error) {
    console.error('Failed to fetch cemeteries:', error.message)
    process.exit(1)
  }
  const targets = (rows || []).filter(r => r.address && r.address.trim().length > 0)
  console.log(`Found ${targets.length} cemetery row(s) to geocode (skipping ${(rows || []).length - targets.length} without an address).`)
  if (targets.length === 0) return

  let success = 0
  let failed  = 0
  for (let i = 0; i < targets.length; i++) {
    const row = targets[i]
    process.stdout.write(`[${i + 1}/${targets.length}] ${row.name}… `)
    try {
      const result = await geocodeAddress(row.address)
      if (!result) {
        console.log('no match')
        failed += 1
      } else {
        const { error: updErr } = await supabase
          .from('cemeteries')
          .update({
            geocoded_lat: result.lat,
            geocoded_lng: result.lng,
            geocoded_at:  new Date().toISOString(),
          })
          .eq('id', row.id)
        if (updErr) {
          console.log(`update failed: ${updErr.message}`)
          failed += 1
        } else {
          console.log(`(${result.lat.toFixed(5)}, ${result.lng.toFixed(5)})`)
          success += 1
        }
      }
    } catch (e) {
      console.log(`error: ${e.message}`)
      failed += 1
    }
    if (i < targets.length - 1) await sleep(DELAY_MS)
  }

  console.log(`\nDone. ${success} succeeded, ${failed} failed.`)
}

main().catch(e => {
  console.error('Fatal:', e)
  process.exit(1)
})
