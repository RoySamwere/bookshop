// End-to-end check of bookshop registration, onboarding, the workspace and the platform console.
// Run against a disposable Laravel server (SQLite) and Vite with DEV_API_TARGET pointing at it.
// Requires installed Chrome and PHP. The owner's emailed verification link is generated with the backend's
// own key via `php artisan tinker`, run in SMOKE_BACKEND_DIR with this process's DB_* environment.
import { spawn, execFileSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'

const baseUrl = process.env.SMOKE_BASE_URL || 'http://127.0.0.1:5173'
const chrome = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const owner = { email: `owner-${Date.now()}@example.test`, password: 'Strong-pass1!' }
const platform = { email: process.env.PLATFORM_EMAIL || 'owner@platform.test', password: process.env.PLATFORM_PASSWORD || 'Platform-pass-123' }
const shots = process.env.SMOKE_SCREENSHOTS
const profile = await mkdtemp(join(tmpdir(), 'hekima-tenancy-'))
const browser = spawn(chrome, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=9338', `--user-data-dir=${profile}`, 'about:blank'], { windowsHide: true, stdio: 'ignore' })
let socket
const step = message => console.log(`✓ ${message}`)
try {
  let tabs
  for (let i = 0; i < 80 && !tabs?.length; i++) {
    try { tabs = await fetch('http://127.0.0.1:9338/json').then(r => r.json()) } catch { await new Promise(r => setTimeout(r, 100)) }
  }
  socket = new WebSocket(tabs.find(tab => tab.type === 'page').webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject })
  const pending = new Map()
  const errors = []
  let id = 0
  socket.onmessage = event => {
    const message = JSON.parse(event.data)
    if (message.id) { const request = pending.get(message.id); pending.delete(message.id); message.error ? request.reject(message.error) : request.resolve(message.result) }
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text)
  }
  const send = (method, params = {}) => new Promise((resolve, reject) => { const key = ++id; pending.set(key, { resolve, reject }); socket.send(JSON.stringify({ id: key, method, params })) })
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails))
    return result.result.value
  }
  const waitFor = async (expression, label = expression) => {
    for (let i = 0; i < 150; i++) { if (await evaluate(expression)) return; await new Promise(r => setTimeout(r, 100)) }
    throw new Error(`Timed out waiting for ${label}\n${await evaluate('location.href + "\\n" + document.body.innerText.slice(0, 1500)')}`)
  }
  const waitForText = text => waitFor(`document.body.innerText.includes(${JSON.stringify(text)})`, `text "${text}"`)
  const go = async path => { await send('Page.navigate', { url: baseUrl + path }); await new Promise(r => setTimeout(r, 300)) }
  // React-controlled inputs need the native setter plus an input event.
  const fill = (label, value) => evaluate(`(() => {
    const field = [...document.querySelectorAll('label')].find(l => l.textContent.trim().startsWith(${JSON.stringify(label)}))?.querySelector('input, textarea, select')
    if (!field) throw new Error('No field labelled ' + ${JSON.stringify(label)})
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(field), 'value').set
    setter.call(field, ${JSON.stringify(value)}); field.dispatchEvent(new Event('input', { bubbles: true })); field.dispatchEvent(new Event('change', { bubbles: true })); return true })()`)
  const fillId = (selector, value) => evaluate(`(() => { const field = document.querySelector(${JSON.stringify(selector)}); const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(field), 'value').set; setter.call(field, ${JSON.stringify(value)}); field.dispatchEvent(new Event('input', { bubbles: true })); return true })()`)
  const check = label => evaluate(`(() => { const box = [...document.querySelectorAll('label')].find(l => l.textContent.includes(${JSON.stringify(label)}))?.querySelector('input[type=checkbox]'); box.click(); return true })()`)
  const click = text => evaluate(`(() => { const target = [...document.querySelectorAll('button, a')].find(el => el.textContent.trim().startsWith(${JSON.stringify(text)}) && !el.disabled); if (!target) throw new Error('No control ' + ${JSON.stringify(text)}); target.click(); return true })()`)
  const path = () => evaluate('location.pathname')
  const noOverflow = async name => {
    for (const width of [390, 1440]) {
      await send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 600 })
      await new Promise(r => setTimeout(r, 150))
      assert(await evaluate('document.documentElement.scrollWidth <= window.innerWidth'), `${name} overflows at ${width}px`)
      if (shots) await writeFile(join(shots, `${name}-${width}.png`), Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64'))
    }
  }
  const signIn = async (email, password) => {
    await go('/login')
    await waitFor("document.querySelector('#login-password') !== null", 'login form')
    await fill('Email address', email)
    await fillId('#login-password', password)
    await evaluate("document.querySelector('form').requestSubmit()")
  }
  const signOut = () => evaluate("fetch('/api/v1/auth/logout', { method: 'POST', credentials: 'include', headers: { Accept: 'application/json', 'X-XSRF-TOKEN': decodeURIComponent(document.cookie.split('; ').find(c => c.startsWith('XSRF-TOKEN=')).slice(11)) } }).then(r => r.status)")

  await send('Runtime.enable'); await send('Page.enable')

  // 1. Self-service registration.
  await go('/register/bookshop')
  await waitForText('Register your bookshop')
  await noOverflow('register-bookshop')
  await fill('Full name', 'Smoke Owner'); await fill('Email address', owner.email); await fill('Your phone', '+254712000111')
  await fillId('#bookshop-password', owner.password); await fillId('#bookshop-confirm', owner.password)
  await fill('Bookshop name', 'Smoke Test Books'); await fill('Business phone', '+254201112222'); await fill('Town or street', 'Nakuru')
  await check('I accept')
  await click('Create my bookshop')
  await waitFor("location.pathname === '/onboarding/verify-email'", 'redirect to verification')
  await waitForText('Confirm your email')
  await noOverflow('onboarding-verify')
  step('registration signs the owner in and lands on email verification')

  // 2. Unverified owners stay out of the workspace.
  await go('/dashboard')
  await waitFor("location.pathname === '/onboarding/verify-email'", 'unverified owner kept in onboarding')
  step('unverified owner is redirected away from the dashboard')

  // 3. Verify from the emailed link, then onboarding and the workspace.
  const link = execFileSync('php', ['artisan', 'tinker', String.raw`--execute=echo App\Support\FrontendUrl::verification(App\Models\User::where('email', '${owner.email}')->firstOrFail());`],
    { cwd: process.env.SMOKE_BACKEND_DIR || '../backend', encoding: 'utf8', env: { ...process.env, FRONTEND_URL: baseUrl } }).trim().split(/\r?\n/).pop()
  assert(link.startsWith('http'), `No verification link: ${link}`)
  await send('Page.navigate', { url: link })
  await waitForText('Email verified')
  await click('Continue setting up your bookshop')
  await waitFor("location.pathname === '/onboarding/setup'", 'setup checklist')
  await waitForText('Open my dashboard')
  await noOverflow('onboarding-setup')
  step('verification link activates the bookshop and opens the setup checklist')
  await click('Open my dashboard')
  await waitFor("location.pathname === '/dashboard'", 'dashboard')
  await waitForText('Smoke Test Books')
  await go('/dashboard?section=My%20Bookshop')
  await waitForText('Invite an employee')
  await waitForText('smoke-test-books')
  await noOverflow('workspace-my-bookshop')
  step('workspace shows the bookshop name and the owner administration section')

  // 4. Bookshop owners are kept out of the platform console.
  await go('/platform')
  await waitForText('Access restricted')
  step('bookshop owner cannot open /platform')
  assert.equal(await signOut(), 200)

  // 5. Platform console: directory, detail and suspension.
  await signIn(platform.email, platform.password)
  await waitFor("location.pathname === '/platform'", 'platform console')
  await waitForText('Platform overview')
  await noOverflow('platform-overview')
  await go('/platform/bookshops')
  await waitForText('Smoke Test Books')
  await click('Smoke Test Books')
  await waitForText('Lifecycle history')
  await noOverflow('platform-bookshop-detail')
  await click('Suspend')
  await waitForText('Reason (shown to the bookshop owner)')
  await fill('Reason', 'Smoke test suspension')
  await click('Suspend bookshop')
  await waitForText('Smoke test suspension')
  step('platform owner suspends the bookshop with a reason')
  await go('/dashboard')
  await waitForText('Access restricted')
  step('platform owner is kept out of bookshop workspaces')
  assert.equal(await signOut(), 200)

  // 6. The suspended owner sees an explanation instead of the workspace.
  await signIn(owner.email, owner.password)
  await waitForText('This bookshop is suspended')
  await waitForText('Smoke test suspension')
  step('suspended bookshop owner sees the suspension notice')

  assert.deepEqual(errors, [], `Runtime exceptions:\n${errors.join('\n')}`)
  console.log('Tenancy smoke check passed.')
} finally {
  socket?.close()
  browser.kill()
  await new Promise(r => setTimeout(r, 300))
  await rm(profile, { recursive: true, force: true }).catch(() => undefined)
}
