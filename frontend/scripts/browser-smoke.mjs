// Run with the isolated Laravel smoke server, and Vite using DEV_API_TARGET=http://127.0.0.1:8001.
// Requires installed Chrome. No production data or credentials are used.
import { spawn } from 'node:child_process'
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, dirname, basename } from 'node:path'
import assert from 'node:assert/strict'

const profile = await mkdtemp(join(tmpdir(), 'hekima-chrome-'))
const baseUrl = process.env.SMOKE_BASE_URL || 'http://127.0.0.1:5173'
const chrome = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const browser = spawn(chrome, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=9337', `--user-data-dir=${profile}`, 'about:blank'], { windowsHide: true, stdio: 'ignore' })
let socket
try {
  let tabs
  for (let i = 0; i < 80; i++) {
    try { tabs = await fetch('http://127.0.0.1:9337/json').then(r => r.json()); if (tabs.length) break } catch {}
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  assert(tabs?.length, 'Chrome debugging endpoint unavailable')
  socket = new WebSocket(tabs.find(tab => tab.type === 'page').webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject })
  const pending = new Map()
  let id = 0
  const errors = []
  socket.onmessage = event => {
    const message = JSON.parse(event.data)
    if (message.id) {
      const request = pending.get(message.id); pending.delete(message.id)
      message.error ? request.reject(message.error) : request.resolve(message.result)
    }
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text)
  }
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const key = ++id
    pending.set(key, { resolve, reject }); socket.send(JSON.stringify({ id: key, method, params }))
  })
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails))
    return result.result.value
  }
  const waitFor = async expression => {
    for (let i = 0; i < 120; i++) {
      if (await evaluate(expression)) return
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    throw new Error(`Timed out: ${expression}\n${await evaluate('document.body.innerText')}`)
  }
  await send('Runtime.enable')
  await send('Page.enable')
  await send('Page.navigate', { url: `${baseUrl}/login` })
  await waitFor("document.querySelector('#login-password') !== null")
  for (const width of [1440, 390]) {
    await send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 600 })
    assert(await evaluate('document.documentElement.scrollWidth <= window.innerWidth'), `Login overflows at ${width}px`)
  }
  if (process.env.SMOKE_SCREENSHOT) {
    const screenshot = await send('Page.captureScreenshot', { format: 'png' })
    await writeFile(process.env.SMOKE_SCREENSHOT, Buffer.from(screenshot.data, 'base64'))
  }
  await evaluate(`(() => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    for (const [selector, value] of [['input[type=email]', 'spa-smoke@example.test'], ['#login-password', 'password']]) {
      const input = document.querySelector(selector); set.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true }));
    }
  })()`)
  await evaluate("document.querySelector('form').requestSubmit()")
  if (process.env.SMOKE_UI === '1') {
    await waitFor("location.pathname === '/dashboard' && document.querySelector('.dashboard-hero') && !document.querySelector('.shop-dashboard[aria-busy=true]')")
    const output = process.env.SMOKE_OUTPUT || join(tmpdir(), 'hekima-ui-check')
    await mkdir(output, { recursive: true })
    const screenshot = async name => {
      await new Promise(resolve => setTimeout(resolve, 450))
      const shot = await send('Page.captureScreenshot', { format: 'png' })
      await writeFile(join(output, name + '.png'), Buffer.from(shot.data, 'base64'))
    }
    const click = async selector => { assert(await evaluate(`!!document.querySelector(${JSON.stringify(selector)})`), `Missing control: ${selector}`); await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`) }
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1320, deviceScaleFactor: 1, mobile: false })
    await screenshot('dashboard-desktop')
    await click('[aria-label="Collapse sidebar"]')
    await waitFor("document.querySelector('.nav-collapsed') !== null && Math.round(document.querySelector('.app-sidebar').getBoundingClientRect().width) === 80")
    assert.equal(await evaluate("Math.round(document.querySelector('.app-sidebar').getBoundingClientRect().width)"), 80)
    await screenshot('sidebar-collapsed')
    await click('[aria-label="Expand sidebar"]')
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
    assert(await evaluate('document.documentElement.scrollWidth <= innerWidth'), 'Dashboard overflows on mobile')
    await click('[aria-label="Open navigation"]')
    await screenshot('navigation-mobile')
    await click('[aria-label="Close navigation"]')
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
    await click('.sidebar-new-sale')
    await waitFor("document.querySelectorAll('.pos-product').length === 12")
    const wanted = [{ title: "Grade 7 Integrated Science Learner's Book", qty: 1 }, { title: 'Exercise Book A4 · 96 pages · Ruled', qty: 12 }, { title: 'Ballpoint Pen · Blue', qty: 3 }, { title: 'Geometry Set · 9 pieces', qty: 1 }, { title: 'Kamusi ya Kiswahili Sanifu', qty: 1 }]
    for (const item of wanted) for (let i = 0; i < item.qty; i++) {
      await evaluate(`Array.from(document.querySelectorAll('.pos-product')).find(button => button.getAttribute('aria-label').startsWith(${JSON.stringify('Add ' + item.title + ',')})).click()`)
      await new Promise(resolve => setTimeout(resolve, 60))
    }
    await waitFor("document.querySelector('[aria-label=\"Current sale\"]').innerText.includes('3,515.00')")
    await screenshot('pos-desktop')
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
    await screenshot('pos-mobile')
    assert(await evaluate('document.documentElement.scrollWidth <= innerWidth'), 'POS overflows on mobile')
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
    await waitFor("document.querySelector('[aria-label=\"Current sale\"]') !== null")
    await evaluate("Array.from(document.querySelectorAll('button')).find(button=>button.innerText.startsWith('Charge KSh')).click()")
    await click('[data-method=mpesa]')
    await evaluate(`(() => { const input = document.querySelector('#pos-reference'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'SJK7H2M1QX'); input.dispatchEvent(new Event('input',{bubbles:true})); })()`)
    await waitFor("document.querySelector('.pos-code-valid') !== null")
    await screenshot('payment-mpesa')
    await click('.pos-payment-form button[type=submit]')
    await waitFor("document.querySelector('[aria-label=\"Sale complete\"]') !== null")
    await screenshot('receipt-complete')
    assert(await evaluate("document.querySelector('.pos-payment-summary').innerText.includes('SJK7H2M1QX')"))
    await evaluate("Array.from(document.querySelectorAll('button')).find(button=>button.innerText==='Next customer').click()")
    await waitFor("document.body.innerText.includes('Nothing added yet')")
    assert.deepEqual(errors, [])
    console.log('PASS: dashboard data, expanded/collapsed navigation, mobile drawer, responsive POS, cart, M-Pesa checkout, receipt, next customer. Screenshots: ' + output)
  } else {
  await waitFor("location.pathname === '/account' && document.body.innerText.includes('Welcome, Browser')")
  const user = await evaluate("fetch('/api/v1/auth/me',{headers:{Accept:'application/json'},credentials:'include'}).then(r=>r.json())")
  assert.equal(user.data.email, 'spa-smoke@example.test')
  const cookies = await send('Network.getAllCookies')
  assert(cookies.cookies.some(cookie => cookie.name !== 'XSRF-TOKEN' && cookie.httpOnly), `Session cookie must be HttpOnly: ${JSON.stringify(cookies.cookies.map(({ name, httpOnly }) => ({ name, httpOnly })))}`)
  assert.equal(await evaluate("localStorage.getItem('bookshop_token')"), null)
  await send('Page.reload')
  await waitFor("location.pathname === '/account' && document.body.innerText.includes('Welcome, Browser')")
  await send('Page.navigate', { url: `${baseUrl}/dashboard` })
  await waitFor("document.body.innerText.includes('Access restricted')")
  await evaluate(`(async () => {
    const token = decodeURIComponent(document.cookie.split('; ').find(c=>c.startsWith('XSRF-TOKEN=')).slice(11));
    const response = await fetch('/api/v1/auth/logout',{method:'POST',credentials:'include',headers:{Accept:'application/json','X-XSRF-TOKEN':token}});
    if (!response.ok) throw Error('Logout failed '+response.status);
  })()`)
  const status = await evaluate("fetch('/api/v1/auth/me',{headers:{Accept:'application/json'},credentials:'include'}).then(r=>r.status)")
  assert.equal(status, 401)
  assert.deepEqual(errors, [])
  console.log('PASS: desktop/mobile login layout, real cookie login, refresh restoration, permission guard, logout, no runtime exceptions.')
  }
} finally {
  socket?.close()
  browser.kill()
  await new Promise(resolve => setTimeout(resolve, 500))
  // Only this script-created temporary browser profile is removed.
  const cleanupPath = resolve(profile)
  assert.equal(dirname(cleanupPath), resolve(tmpdir()))
  assert(basename(cleanupPath).startsWith('hekima-chrome-'))
  await rm(cleanupPath, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => {})
}
