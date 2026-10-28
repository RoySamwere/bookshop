const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

function harness(remember = false) {
  let now = 1_800_000_000_000, id = 0
  const timers = new Map(), requests = [], ended = [], revoked = []
  class Events {
    listeners = new Map()
    addEventListener(name, fn) { if (!this.listeners.has(name)) this.listeners.set(name, new Set()); this.listeners.get(name).add(fn) }
    removeEventListener(name, fn) { this.listeners.get(name)?.delete(fn) }
    dispatchEvent(event) { for (const fn of [...(this.listeners.get(event.type) ?? [])]) fn(event); return true }
    emit(type, extra = {}) { this.dispatchEvent({ type, isTrusted: true, ...extra }) }
  }
  class Storage {
    data = new Map()
    getItem(key) { return this.data.get(key) ?? null }
    setItem(key, value) { this.data.set(key, String(value)) }
    removeItem(key) { this.data.delete(key) }
  }
  const window = Object.assign(new Events(), { sessionStorage: new Storage(), localStorage: new Storage() })
  const document = Object.assign(new Events(), { visibilityState: 'visible' })
  const schedule = (fn, delay, repeat = false) => { const key = ++id; timers.set(key, { fn, at: now + delay, delay, repeat }); return key }
  const context = vm.createContext({
    window, document, URLSearchParams, process: { env: {} }, DOMException,
    Date: class extends Date { static now() { return now } },
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options?.detail } },
    AbortSignal: { timeout: () => undefined },
    setTimeout: (fn, delay) => schedule(fn, delay), clearTimeout: key => timers.delete(key),
    setInterval: (fn, delay) => schedule(fn, delay, true), clearInterval: key => timers.delete(key),
    fetch: async (url, options) => { requests.push({ url, options }); return { ok: true, json: async () => ({}) } },
  })
  function load(name, dependencies) {
    const source = fs.readFileSync(path.join(__dirname, '..', 'lib', name + '.ts'), 'utf8')
    const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
    const exports = {}
    context.exports = exports
    context.require = name => { if (!(name in dependencies)) throw new Error(`Unexpected import: ${name}`); return dependencies[name] }
    vm.runInContext(`(function(exports, require) { ${code}\n })(exports, require)`, context)
    return exports
  }
  const api = load('api', {})
  const logout = async () => { revoked.push(api.tokenStore.get()); api.tokenStore.clear() }
  const session = load('session', { './api': api, './auth': { logout } })
  const auth = load('auth', { './api': api })
  api.tokenStore.set('test-session', remember)
  const stop = session.startSessionMonitor(reason => ended.push(reason))
  async function advance(ms) {
    const target = now + ms
    while (true) {
      const entry = [...timers].filter(([, timer]) => timer.at <= target).sort((a, b) => a[1].at - b[1].at)[0]
      if (!entry) break
      const [key, timer] = entry
      now = timer.at
      if (timer.repeat) timer.at += timer.delay; else timers.delete(key)
      timer.fn()
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
    }
    now = target
  }
  return { window, document, api, session, auth, ended, revoked, requests, stop, advance, jump: ms => { now += ms } }
}

test('expires at exactly ten idle minutes, including remembered sessions', async () => {
  const h = harness(true)
  await h.advance(599_999)
  assert.equal(h.ended.length, 0)
  await h.advance(1)
  assert.deepEqual(h.ended, ['idle'])
  assert.equal(h.api.tokenStore.get(), null)
  assert.deepEqual(h.revoked, ['test-session'])
})

test('keyboard activity resets the deadline; only new interaction sends a heartbeat', async () => {
  const h = harness()
  await h.advance(300_000)
  assert.equal(h.requests.length, 0)
  h.window.emit('keydown')
  await h.advance(30_000)
  assert.equal(h.requests.length, 1)
  assert.match(h.requests[0].url, /\/auth\/activity$/)
  await h.advance(569_999)
  assert.equal(h.ended.length, 0)
  assert.equal(h.requests.length, 1)
  await h.advance(1)
  assert.deepEqual(h.ended, ['idle'])
})

test('waking a suspended tab cannot revive an expired session', () => {
  const h = harness()
  h.jump(600_001)
  h.window.emit('pointerdown')
  assert.deepEqual(h.ended, ['idle'])
})

test('another tab shares activity for a remembered session', async () => {
  const h = harness(true)
  await h.advance(590_000)
  h.api.tokenStore.touch()
  h.window.emit('storage')
  await h.advance(10_000)
  assert.equal(h.ended.length, 0)
  await h.advance(590_000)
  assert.deepEqual(h.ended, ['idle'])
})

test('expired local session blocks a pending stock write before fetch', async () => {
  const h = harness()
  h.jump(600_000)
  await assert.rejects(h.api.api('/inventory/receive', { method: 'POST', body: { quantity: 5 } }), { status: 401 })
  assert.equal(h.requests.length, 1)
  assert.match(h.requests[0].url, /\/auth\/logout$/)
  assert.deepEqual(h.ended, ['idle'])
})

test('cleanup removes listeners and timers', async () => {
  const h = harness()
  h.stop()
  await h.advance(900_000)
  h.window.emit('keydown')
  assert.equal(h.ended.length, 0)
  assert.equal(h.requests.length, 0)
})

test('reloading preserves the idle deadline and syncs only pending real activity', async () => {
  const h = harness()
  await h.advance(300_001)
  h.window.emit('keydown')
  h.stop()
  h.session.startSessionMonitor(reason => h.ended.push(reason))
  await h.advance(1)
  assert.equal(h.requests.length, 1)
  await h.advance(599_998)
  assert.equal(h.ended.length, 0)
  await h.advance(1)
  assert.deepEqual(h.ended, ['idle'])
})

test('return URL preserves section, query and hash; external redirects are rejected', () => {
  const h = harness()
  const previous = { pathname: '/dashboard', search: '?section=Inventory+%26+Stock', hash: '#stock-levels' }
  const login = new URL(h.session.sessionLoginUrl('idle', previous), 'https://bookshop.test')
  assert.equal(login.searchParams.get('idle'), '1')
  assert.equal(h.auth.safeNextPath(login.searchParams.get('next')), previous.pathname + previous.search + previous.hash)
  for (const next of ['https://evil.test', '//evil.test', '/\\evil.test', '/\nevil.test']) assert.equal(h.auth.safeNextPath(next), null)
})
