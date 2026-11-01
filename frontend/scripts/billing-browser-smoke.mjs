// Run with the isolated Laravel smoke server, and Vite using DEV_API_TARGET=http://127.0.0.1:8001.
// Requires installed Chrome. No production data or credentials are used.
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, dirname, basename } from 'node:path'
import assert from 'node:assert/strict'

const profile = await mkdtemp(join(tmpdir(), 'hekima-chrome-'))
const baseUrl = process.env.SMOKE_BASE_URL || 'http://127.0.0.1:5173'
assert(['127.0.0.1', 'localhost'].includes(new URL(baseUrl).hostname), 'Billing browser fixtures must use isolated local services')
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
  await evaluate(`(() => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    for (const [selector, value] of [['input[type=email]', 'billing-smoke@example.test'], ['#login-password', 'password']]) {
      const input = document.querySelector(selector); set.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true }));
    }
    document.querySelector('form').requestSubmit();
  })()`)
  await waitFor("location.pathname === '/dashboard'")
  await send('Page.navigate', { url: `${baseUrl}/billing` })
  await waitFor("document.body.innerText.includes('TEST MODE — Sandbox shortcode: 174379')")
  assert.equal(await evaluate("document.body.innerText.includes('153283')"), false, 'Sandbox page must not direct payment to the live Paybill')
  await evaluate(`(() => {
    const select = document.querySelector('[aria-label="Renewal plan"]');
    select.value = Array.from(select.options).find(o => o.text.includes('Browser monthly')).value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  })()`)
  await evaluate("Array.from(document.querySelectorAll('button')).find(b => b.innerText === 'Create invoice').click()")
  await waitFor("document.querySelector('#billing-invoice') !== null")
  for (const width of [1440, 390]) {
    await send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 600 })
    await new Promise(resolve => setTimeout(resolve, 150))
    assert(await evaluate('document.documentElement.scrollWidth <= window.innerWidth'), `Billing overflows at ${width}px`)
  }
  assert(await evaluate("document.querySelector('#billing-invoice').innerText.includes('TEST MODE — Sandbox shortcode: 174379')"))
  assert(await evaluate("Array.from(document.querySelectorAll('button')).some(b => b.innerText === 'Print / save invoice PDF')"))
  assert.deepEqual(errors, [])
  console.log('PASS: owner cookie login, billing plan selection, real local invoice generation, sandbox shortcode isolation, printable invoice, desktop/mobile billing layout. No Safaricom request initiated.')
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
