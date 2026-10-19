// Chat client: talks to the agent backend (backend/main.py).
//   POST /api/chat          one message + the page the shopper is on (+ guest history)
//   GET  /api/chat/history  a logged-in shopper's saved conversation

export type ChatProductCard = {
  product_id: string
  name: string
  price: number
  short_description: string
  image_url: string
}

export type ChatReply = {
  reply: string
  products: ChatProductCard[]
  // true: a browsing search, so the products go on the page as cards (Products page).
  // false: the products are shown as small cards in the chat panel.
  show_on_page: boolean
  results_title: string | null
  filtered: boolean // blocked by the content filter: keep it out of the conversation history
  withheld?: boolean // the agent's reply failed the safety checks, so a safe fallback was sent
  your_message: string // the message as saved and sent to the agent (sensitive details removed)
  removed: string[] // kinds of sensitive detail taken out, e.g. ["card number"]
}

export type ChatMessage = {
  role: 'user' | 'assistant'
  content: string
  products?: ChatProductCard[] // small cards under this message
  resultsUrl?: string // page the chat put results on, so the shopper can go back to it
  notHistory?: boolean // greetings and filtered turns aren't sent back as history
  notice?: string // small note under the message, e.g. that a card number was removed
}

export function removedNotice(removed: string[]) {
  if (removed.length === 0) return undefined
  const list = removed.length === 1 ? removed[0] : `${removed.slice(0, -1).join(', ')} and ${removed.at(-1)}`
  return `For your safety, we removed the ${list} from your message. Please don't share ${removed.length === 1 ? 'it' : 'them'} in chat.`
}

// Where the shopper is, so "do you have this in pink?" on a product page means that product.
export type PageContext = {
  path: string
  product_id: string | null
}

type SavedMessage = {
  role: 'user' | 'assistant'
  content: string
  products: ChatProductCard[]
  results_title: string | null
  created_at: string
}

const MAX_GUEST_HISTORY = 20

async function readJson<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => null)
  if (!res.ok) {
    throw new Error(typeof data?.detail === 'string' ? data.detail : `Chat failed (${res.status})`)
  }
  return data as T
}

export async function sendChatMessage(
  message: string,
  page: PageContext,
  history: ChatMessage[],
): Promise<ChatReply> {
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, page, history }),
  })
  return readJson<ChatReply>(res)
}

// A guest's conversation lives only in this page's memory. It's sent with each message so the
// agent can follow along, and it's gone on refresh. Logged-in shoppers send none: the server
// reads their saved history from the database instead.
export function guestHistory(messages: ChatMessage[]) {
  return messages
    .filter((m) => !m.notHistory)
    .slice(-MAX_GUEST_HISTORY)
    .map(({ role, content }) => ({ role, content }))
}

export async function fetchChatHistory(): Promise<ChatMessage[]> {
  const saved = await readJson<SavedMessage[]>(await fetch('/api/chat/history'))
  return saved.map((m) => {
    if (m.results_title && m.products.length > 0) {
      const ids = m.products.map((p) => p.product_id)
      return { role: m.role, content: m.content, resultsUrl: chatResultsUrl(m.results_title, ids) }
    }
    return { role: m.role, content: m.content, products: m.products.length ? m.products : undefined }
  })
}

// The Products page shows chat results from the URL, e.g.
// /products?results=Hoodies&ids=basic-hoodie-big-yale,crew-left-chest-hoodie
// Keeping them in the URL means Back, refresh, and "back to results" all work.
export function chatResultsUrl(title: string, productIds: string[]) {
  const params = new URLSearchParams({ results: title, ids: productIds.join(',') })
  return `/products?${params}`
}

export function currentPage(pathname: string): PageContext {
  const match = pathname.match(/^\/products\/([^/]+)\/?$/)
  return { path: pathname, product_id: match ? decodeURIComponent(match[1]) : null }
}
