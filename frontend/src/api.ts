// Calls to the FastAPI backend (backend/main.py). In dev, Vite forwards /api and /images to it.

export type ProductSummary = {
  product_id: string
  name: string
  garment_type: string
  price: number
  short_description: string
  image_url: string
  categories: string[] // garment kinds (hoodie, crewneck, t-shirt, ...) for shop filters
  groups: string[] // merchandise groups, e.g. 'college:pierson', 'sport:ice-hockey', 'family:dad'
}

export type SizeStock = {
  size: string
  quantity: number
}

export type EmbroideryLocation = 'left_chest' | 'right_chest' | 'shoulder'

export type ProductDetail = {
  product_id: string
  name: string
  garment_type: string
  price: number
  description: string
  colors: string[]
  search_tags: string[]
  image_url: string
  sizes: SizeStock[]
  total_in_stock: number
  // Empty when the product has a large central design (no room for embroidery).
  embroidery_options: { location: EmbroideryLocation; label: string }[]
  embroidery_price: number
  categories: string[]
  groups: string[]
  colorway: string // the garment's main color
  // Colors the shopper can choose. One today for every product (selected automatically);
  // a product sold in several colors would list them all and the shopper would pick one.
  color_options: string[]
  thread_colors: string[] // thread colors offered for embroidery
}

export class NotFoundError extends Error {}

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(path, { signal })
  if (res.status === 404) throw new NotFoundError(path)
  if (!res.ok) throw new Error(`${path} failed with status ${res.status}`)
  return res.json() as Promise<T>
}

export function fetchProducts(signal?: AbortSignal) {
  return getJson<ProductSummary[]>('/api/products', signal)
}

export function fetchProduct(productId: string, signal?: AbortSignal) {
  return getJson<ProductDetail>(`/api/products/${encodeURIComponent(productId)}`, signal)
}

// The header's second-row menus (colleges, sports, graduate schools, family), from
// GET /api/groups. Only options that have products are listed.
export type MenuOption = { key: string; label: string; count: number }
export type MenuGroup = { key: string; label: string; count: number; options: MenuOption[] }

export function fetchGroups(signal?: AbortSignal) {
  return getJson<MenuGroup[]>('/api/groups', signal)
}

export function formatPrice(price: number) {
  return `$${price.toFixed(2)}`
}

// Each product comes in one colorway. `colors` lists every color on it: the first is the
// garment's main color and the rest are its design and trim colors, never other options.
// This sentence is used wherever the site describes an item's color, so they always agree.
export function describeColorway(product: { colorway: string; colors: string[] }) {
  const details = product.colors.filter((c) => c !== product.colorway)
  if (details.length === 0) return product.colorway
  const list = details.length === 1 ? details[0] : `${details.slice(0, -1).join(', ')} and ${details.at(-1)}`
  return `${product.colorway} with ${list} details`
}

// Accounts

export type User = {
  id: number
  first_name: string
  last_name: string
  email: string
}

export type SignupDetails = {
  first_name: string
  last_name: string
  email: string
  password: string
}

// FastAPI sends `detail` as a string for our own errors, or as a list for validation errors.
function errorMessage(detail: unknown): string {
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail) && detail[0]?.msg) return String(detail[0].msg).replace(/^Value error, /, '')
  return 'Something went wrong. Please try again.'
}

export async function requestJson<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const data = await res.json().catch(() => null)
  if (!res.ok) throw new Error(errorMessage(data?.detail))
  return data as T
}

function postJson<T>(path: string, body: unknown): Promise<T> {
  return requestJson<T>('POST', path, body)
}

export function signup(details: SignupDetails) {
  return postJson<User>('/api/auth/signup', details)
}

export function login(email: string, password: string) {
  return postJson<User>('/api/auth/login', { email, password })
}

// Login and signup set an HttpOnly session cookie; the browser sends it with every request,
// so the backend knows who is chatting. These two calls check and end that session.

export async function fetchMe(): Promise<User | null> {
  const res = await fetch('/api/auth/me') // null for guests
  if (!res.ok) throw new Error(`/api/auth/me failed with status ${res.status}`)
  return res.json() as Promise<User | null>
}

export async function logout() {
  await fetch('/api/auth/logout', { method: 'POST' })
}

// Similar items in stock in a size the shopper wanted but is sold out (backend tools.similar_in_size).
export type AlternativeProduct = ProductSummary & { why: string }

export function fetchAlternatives(productId: string, size: string, signal?: AbortSignal) {
  const query = new URLSearchParams({ size })
  return getJson<AlternativeProduct[]>(`/api/products/${encodeURIComponent(productId)}/alternatives?${query}`, signal)
}

// Safety rule 12: is this embroidery text allowed? (No profanity, slurs, or contact details.)
// The product page asks before adding to the cart, since a guest's cart never reaches the
// backend; cart, design, and share routes check again on the server.
export function checkEmbroideryText(text: string) {
  return requestJson<{ ok: boolean; problem: string | null }>('POST', '/api/embroidery/check', { text })
}

// Shared wishlist links: a snapshot of a wishlist, with each item's size and embroidery,
// that family and friends can shop from (POST /api/wishlist/share).
export type SharedItem = {
  product_id: string
  size: string | null
  embroidery: { text: string; location: EmbroideryLocation; thread_color: string | null } | null
}

export type SharedWishlist = {
  owner_name: string | null
  note: string | null
  created_at: string
  items: SharedItem[]
}

export function createWishlistShare(body: { owner_name: string | null; note: string | null; items: SharedItem[] }) {
  return requestJson<{ token: string; path: string }>('POST', '/api/wishlist/share', body)
}

export function fetchSharedWishlist(token: string, signal?: AbortSignal) {
  return getJson<SharedWishlist>(`/api/wishlist/shared/${encodeURIComponent(token)}`, signal)
}
