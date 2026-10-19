// Problem 11: live site check. Drives a real Microsoft Edge browser (headless) against the
// running site, does the three checks a shopper would do, and saves full-resolution PNG
// screenshots to output/app_check_images/ for output/app_check.html.
//
// Needs both servers running:
//   backend:   cd backend  && uvicorn main:app --reload --port 8000
//   frontend:  cd frontend && npm run dev            (http://localhost:5173)
// Then, from the Homework 4 folder:
//   node tests/app_check.mjs
//
// It talks to Edge over the Chrome DevTools Protocol with Node's built-in WebSocket, so
// nothing extra needs installing. It starts as a guest with an empty browser profile, so
// the cart and chat start empty. Prints what it saw (chat replies, card counts, cart totals)
// as JSON at the end.

import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SITE = 'http://localhost:5173'
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
const PORT = 9333
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const IMAGES = join(ROOT, 'output', 'app_check_images')
const VIEW = { width: 1280, height: 800, deviceScaleFactor: 1.5 } // 1920 x 1200 PNGs

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// --- A tiny DevTools Protocol client -----------------------------------------------------

async function connect() {
  for (let i = 0; i < 50; i++) {
    try {
      const targets = await fetch(`http://127.0.0.1:${PORT}/json/list`).then((r) => r.json())
      const page = targets.find((t) => t.type === 'page')
      if (page) return page.webSocketDebuggerUrl
    } catch {
      // Edge is still starting
    }
    await sleep(200)
  }
  throw new Error('Edge did not start')
}

function client(url) {
  const ws = new WebSocket(url)
  let next = 0
  const pending = new Map()
  const listeners = []
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data)
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id)
      pending.delete(msg.id)
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result)
    } else if (msg.method) {
      for (const l of listeners) l(msg)
    }
  }
  const ready = new Promise((r) => (ws.onopen = r))
  return {
    ready,
    close: () => ws.close(),
    send(method, params = {}) {
      const id = ++next
      ws.send(JSON.stringify({ id, method, params }))
      return new Promise((resolve, reject) => pending.set(id, { resolve, reject }))
    },
    once(method) {
      return new Promise((resolve) => {
        const l = (msg) => {
          if (msg.method === method) {
            listeners.splice(listeners.indexOf(l), 1)
            resolve(msg.params)
          }
        }
        listeners.push(l)
      })
    },
  }
}

// --- Page helpers ------------------------------------------------------------------------

let cdp

async function run(expression) {
  const { result, exceptionDetails } = await cdp.send('Runtime.evaluate', {
    expression: `(async () => { ${expression} })()`,
    awaitPromise: true,
    returnByValue: true,
  })
  if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text)
  return result.value
}

async function open(path) {
  const loaded = cdp.once('Page.loadEventFired')
  await cdp.send('Page.navigate', { url: SITE + path })
  await loaded
  await sleep(2000) // let the page fade in and product photos load
}

async function screenshot(name, clip) {
  await sleep(800)
  const { data } = await cdp.send('Page.captureScreenshot', {
    format: 'png',
    ...(clip ? { clip: { ...clip, scale: 1 }, captureBeyondViewport: true } : {}),
  })
  writeFileSync(join(IMAGES, `${name}.png`), Buffer.from(data, 'base64'))
  return `app_check_images/${name}.png`
}

// Type into a React-controlled input and fire the events React listens for.
const typeInto = (selector, text) => `
  const el = document.querySelector(${JSON.stringify(selector)})
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(text)})
  el.dispatchEvent(new Event('input', { bubbles: true }))
`

async function askChat(question) {
  return run(`
    if (!document.querySelector('.chat-panel.is-open')) document.querySelector('.chat-tab').click()
    await new Promise((r) => setTimeout(r, 600))
    const before = document.querySelectorAll('.chat-message.assistant').length
    ${typeInto('.chat-input input', question)}
    await new Promise((r) => setTimeout(r, 100))
    document.querySelector('.chat-input').requestSubmit()
    for (let i = 0; i < 180; i++) {
      await new Promise((r) => setTimeout(r, 1000))
      const done = !document.querySelector('.chat-message.typing')
      if (done && document.querySelectorAll('.chat-message.assistant').length > before) break
    }
    await new Promise((r) => setTimeout(r, 2500)) // cards on the page fade in
    const replies = [...document.querySelectorAll('.chat-message.assistant')]
    return replies.at(-1).textContent
  `)
}

// --- The checks --------------------------------------------------------------------------

const PRODUCT = 'pierson-college-crewneck'

async function checkInventory() {
  // What the database says (the product API reads the catalogue and inventory tables).
  const db = await fetch(`${SITE}/api/products/${PRODUCT}`).then((r) => r.json())
  await open(`/products/${PRODUCT}`)
  const question = 'How many of these do you have in a medium, and how much is it? Is a large available?'
  const reply = await askChat(question)
  await run(`window.scrollTo(0, 150)`)
  const image = await screenshot('inventory')

  // The same product page with the chat closed: its price and size tiles come straight
  // from the database, so they can be compared with the chat's answer.
  await run(`document.querySelector('.chat-close')?.click()`)
  const region = await run(`
    await new Promise((r) => setTimeout(r, 700))
    const info = document.querySelector('.product-detail-info').getBoundingClientRect()
    const title = document.querySelector('.product-detail-info h1').getBoundingClientRect()
    const sizes = document.querySelector('.sizes').getBoundingClientRect()
    return { x: info.left - 20 + scrollX, y: title.top - 20 + scrollY, width: info.width + 40, height: sizes.bottom - title.top + 40 }
  `)
  const pageImage = await screenshot('inventory_page', region)
  const tiles = await run(`
    return [...document.querySelectorAll('.size-option')].map((b) => b.querySelector('strong').textContent + ': ' + b.querySelector('span').textContent)
  `)
  return {
    image,
    pageImage,
    tiles,
    question,
    reply,
    database: { name: db.name, price: db.price, sizes: db.sizes },
  }
}

async function checkSearchCards() {
  await open('/')
  // The chat remembers nothing between page loads for a guest, so start a fresh chat here.
  const question = 'What hoodies do you have?'
  const reply = await askChat(question)
  const page = await run(`
    window.scrollTo(0, 0)
    return {
      url: location.pathname + location.search,
      heading: document.querySelector('main h1')?.textContent,
      banner: document.querySelector('.results-banner')?.textContent ?? null,
      cards: [...document.querySelectorAll('main .product-card h3')].map((h) => h.textContent),
    }
  `)
  const image = await screenshot('search_cards')
  const all = await fetch(`${SITE}/api/products`).then((r) => r.json())
  page.catalogueHoodies = all.filter((p) => p.categories.includes('hoodie')).length
  // The cards still open the product page (Problem 3's single-item view).
  const opened = await run(`
    document.querySelector('main .product-card a').click()
    await new Promise((r) => setTimeout(r, 1500))
    return { url: location.pathname, title: document.querySelector('main h1')?.textContent }
  `)
  return { image, question, reply, page, firstCardOpens: opened }
}

async function checkCart() {
  // Close the chat so it doesn't cover the cart.
  await run(`document.querySelector('.chat-close')?.click()`)

  // Item 1: two embroidered crewnecks in M.
  await open(`/products/${PRODUCT}`)
  const first = await run(`
    const wait = (ms) => new Promise((r) => setTimeout(r, ms))
    ;[...document.querySelectorAll('.size-option')].find((b) => b.querySelector('strong').textContent === 'M').click()
    await wait(200)
    const qty = document.querySelector('.buy-row select')
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(qty, '2')
    qty.dispatchEvent(new Event('change', { bubbles: true }))
    document.querySelector('.embroidery input[type=checkbox]').click()
    await wait(200)
    ${typeInto('.embroidery input[placeholder^="e.g."]', 'Class of 2027')}
    ;[...document.querySelectorAll('.embroidery .swatch-option')].find((b) => b.textContent.includes('Gold')).click()
    await wait(200)
    document.querySelector('.buy-box button[type=submit]').click()
    await wait(1200)
    return document.querySelector('.buy-box .notice')?.textContent
  `)

  // Item 2: one T-shirt in L, no embroidery.
  await open('/products/2025-yale-vs-harvard-t-shirt')
  const second = await run(`
    const wait = (ms) => new Promise((r) => setTimeout(r, ms))
    const size = [...document.querySelectorAll('.size-option')].find((b) => b.querySelector('strong').textContent === 'L')
    size.click()
    await wait(200)
    document.querySelector('.buy-box button[type=submit]').click()
    await wait(1200)
    return document.querySelector('.buy-box .notice')?.textContent
  `)

  await open('/cart')
  const cart = await run(`
    return {
      lines: [...document.querySelectorAll('.cart-line')].map((li) => ({
        name: li.querySelector('.cart-name')?.textContent,
        details: li.querySelector('.cart-info .muted')?.textContent,
        embroidery: li.querySelector('.cart-embroidery')?.textContent ?? null,
        quantity: li.querySelector('.cart-controls select')?.value,
        lineTotal: li.querySelector('.cart-controls strong')?.textContent,
      })),
      summary: [...document.querySelectorAll('.cart-summary dt')].map((dt) => dt.textContent + ': ' + dt.nextElementSibling?.textContent),
      cartCount: document.querySelector('a[href="/cart"] .nav-count')?.textContent ?? null,
      note: document.querySelector('.cart-summary .notice')?.textContent,
    }
  `)
  const image = await screenshot('cart')
  return { image, added: [first, second], cart }
}

// --- Run ---------------------------------------------------------------------------------

mkdirSync(IMAGES, { recursive: true })
const profile = mkdtempSync(join(tmpdir(), 'cc-app-check-'))
const edge = spawn(EDGE, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`,
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-extensions',
  '--hide-scrollbars',
  'about:blank',
])

try {
  cdp = client(await connect())
  await cdp.ready
  await cdp.send('Page.enable')
  await cdp.send('Runtime.enable')
  await cdp.send('Emulation.setDeviceMetricsOverride', { ...VIEW, mobile: false })

  const results = {
    checkedAt: new Date().toISOString(),
    inventory: await checkInventory(),
    searchCards: await checkSearchCards(),
    cart: await checkCart(),
  }
  writeFileSync(join(IMAGES, 'results.json'), JSON.stringify(results, null, 2))
  console.log(JSON.stringify(results, null, 2))
} finally {
  cdp?.close()
  // Close the whole browser (and its helper processes) through DevTools, then make sure.
  const exited = new Promise((r) => edge.once('exit', r))
  try {
    const { webSocketDebuggerUrl } = await fetch(`http://127.0.0.1:${PORT}/json/version`).then((r) => r.json())
    const browser = client(webSocketDebuggerUrl)
    await browser.ready
    browser.send('Browser.close').catch(() => {})
  } catch {
    edge.kill()
  }
  await Promise.race([exited, sleep(5000)])
  await sleep(1500) // helper processes let go of the profile folder
  try {
    rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 })
  } catch {
    console.warn(`Couldn't remove the temporary browser profile ${profile}; it's safe to delete.`)
  }
}
