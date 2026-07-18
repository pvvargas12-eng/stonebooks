// Drive the OWNER build (Paul): six-slot bar → JOBS hub tiles → ORDERS tab.
import { chromium } from './node_modules/playwright-core/index.mjs'

const out = (n) => `${import.meta.dirname}/screens_owner/${n}.png`
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })
const context = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2 })
const page = await context.newPage()
const errors = []
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
page.on('pageerror', e => errors.push('PAGEERROR ' + e.message))
await page.route('**/api/push/send**', r => r.fulfill({ json: { publicKey: null } }))

await page.goto('http://localhost:5173/field')
await page.waitForSelector('text=crew sign-in')
await page.fill('input[type=email]', 'shop@shevchenko.test')
await page.fill('input[type=password]', 'demo')
await page.click('button:has-text("Sign in")')
await page.waitForSelector('text=Who is holding this phone?')
await page.click('button.fl-who-row:has-text("Paul")')
await page.waitForSelector('text=Paul.')
await page.screenshot({ path: out('01_owner_today_sixslots') })
const tabs = await page.$$eval('.fl-nav button', els => els.map(e => e.textContent.trim()).filter(Boolean))
console.log('nav slots:', JSON.stringify(tabs))

await page.click('.fl-nav button:has-text("JOBS")')
await page.waitForSelector('text=Queues built at the desk')
await page.screenshot({ path: out('02_owner_jobs_hub') })
console.log('✓ JOBS hub renders (tiles)')

await page.click('.fl-nav button:has-text("ORDERS")')
await page.waitForSelector('.fl-search')
await page.screenshot({ path: out('03_owner_orders_tab') })
console.log('✓ ORDERS tab renders')

console.log('console errors:', errors.length ? errors : 'none')
await browser.close()
