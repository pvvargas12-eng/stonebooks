// =============================================================================
// generate_vapid_keys.mjs — one-shot VAPID keypair for FIELD-PUSH
// =============================================================================
// Run once:  node scripts/generate_vapid_keys.mjs
// Then set the printed values as env vars on the Vercel project (Production):
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT
// NEVER commit the private key. Rotating keys silently kills every existing
// phone subscription (each phone must re-enable) — generate once, keep forever.
// =============================================================================
import webpush from 'web-push'

const keys = webpush.generateVAPIDKeys()
console.log('Set these on the Vercel project (Settings → Environment Variables):\n')
console.log(`VAPID_PUBLIC_KEY=${keys.publicKey}`)
console.log(`VAPID_PRIVATE_KEY=${keys.privateKey}`)
console.log('VAPID_SUBJECT=mailto:shevcoteam@gmail.com')
console.log('\nAlso required (already set if email sync works): SUPABASE_URL,')
console.log('SUPABASE_SERVICE_ROLE_KEY. Optional: CRON_SECRET locks the endpoint.')
