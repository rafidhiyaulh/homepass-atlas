// Screenshot pages after a one-click demo login: node scripts/shots.mjs [base] [role] [theme] path1 path2 ...
import { chromium } from 'playwright-core'
const [base = 'http://localhost:3007', role = 'planner', theme = 'light', ...paths] = process.argv.slice(2)
const out = process.env.SHOTS_DIR ?? '/tmp'
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: theme })
page.on('console', m => { if (m.type() === 'error') console.log('console:', m.text().slice(0, 200)) })
page.on('pageerror', e => console.log('pageerror:', e.message.slice(0, 300)))
await page.goto(base + '/login')
await page.click(`button[name=demo][value=${role}]`)
await page.waitForURL(u => !u.pathname.startsWith('/login'), { timeout: 60000 })
for (const p of paths.length ? paths : ['/']) {
  await page.goto(base + p, { waitUntil: 'networkidle', timeout: 90000 })
  await page.waitForTimeout(1500)
  const file = `${out}/shot-${role}-${theme}${p.replace(/[^\w]+/g, '_')}.png`
  await page.screenshot({ path: file, fullPage: true })
  console.log(file)
}
await browser.close()
