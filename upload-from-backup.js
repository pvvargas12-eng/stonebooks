// =============================================================================
// upload-from-backup.js
// Reads one or more tagger backup JSON files and uploads to Supabase.
// Uses upsert(onConflict:id) so re-running won't create duplicates.
//
// USAGE (PowerShell):
//   node upload-from-backup.js "<service_role_key>" "C:\path\to\backup1.json" "C:\path\to\backup2.json" ...
//
// You can pass multiple backup files at once — they'll all be uploaded.
// =============================================================================

import { createClient } from '@supabase/supabase-js'
import fs from 'fs'
import path from 'path'

const SUPABASE_URL = 'https://ibekfollqnytxcuyekad.supabase.co'

const args = process.argv.slice(2)
const serviceKey = args[0]
const files = args.slice(1)

if (!serviceKey || files.length === 0) {
  console.error('\nUsage:')
  console.error('  node upload-from-backup.js "<service_role_key>" "<backup1.json>" ["<backup2.json>" ...]\n')
  process.exit(1)
}

if (!serviceKey.startsWith('sb_secret_') && !serviceKey.startsWith('eyJ')) {
  console.error('\n⚠️  That doesn\'t look like a service_role key.')
  console.error('Get it from: Supabase → Settings → API → "Secret keys" → service_role.')
  console.error('Should start with "sb_secret_" or "eyJ".\n')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, serviceKey, {
  auth: { persistSession: false },
})

// Transform a backup record into the monuments table row shape
function transform(r) {
  const f = r.fields || {}
  return {
    id: r.id,
    lastname: f.lastname || null,
    name: f.name || null,
    img: r.url || '',
    icon: '🪨',
    badge: f.badge || null,
    cats: f.cats || [],
    tags: f.tags || [],
    similarity_keys: f.simKeys || [],
    carve_type: f.carveType || null,
    granite_color: f.graniteColor || null,
    skin_frosted: false,
    description: f.desc || null,
    meta: f.meta || {},
  }
}

// Collect rows from all backup files, deduping by id (last write wins)
const rowsById = new Map()
for (const file of files) {
  if (!fs.existsSync(file)) {
    console.error(`✗ File not found: ${file}`)
    process.exit(1)
  }
  const backup = JSON.parse(fs.readFileSync(file, 'utf-8'))
  const records = backup.records || []
  console.log(`\n📂 ${path.basename(file)}`)
  console.log(`   Category: ${backup.category}, records: ${records.length}, exported: ${backup.exportedAt}`)

  let added = 0
  for (const r of records) {
    if (!r.id || !r.fields) continue
    // Only upload approved records (skip pending / skipped / failed)
    if (r.status && r.status !== 'approved' && r.status !== 'uploaded') continue
    rowsById.set(r.id, transform(r))
    added++
  }
  console.log(`   ✓ Queued ${added} records`)
}

const rows = [...rowsById.values()]
console.log(`\n📊 Total unique records to upload: ${rows.length}\n`)

if (rows.length === 0) {
  console.log('Nothing to upload.')
  process.exit(0)
}

// Upload in batches of 100
const BATCH_SIZE = 100
let uploaded = 0
let failed = 0

for (let i = 0; i < rows.length; i += BATCH_SIZE) {
  const batch = rows.slice(i, i + BATCH_SIZE)
  const { error } = await supabase
    .from('monuments')
    .upsert(batch, { onConflict: 'id' })

  if (error) {
    failed += batch.length
    console.error(`✗ Batch ${i}–${i + batch.length}: ${error.message}`)
    console.error('  Stopping. Fix the error and re-run — already-uploaded rows will be skipped automatically.')
    process.exit(1)
  }
  uploaded += batch.length
  process.stdout.write(`\r✓ Uploaded ${uploaded}/${rows.length}`)
}

console.log(`\n\n🎉 Done! ${uploaded} records in monuments table.\n`)
console.log('Refresh your catalog at http://localhost:5173 to see them.')
