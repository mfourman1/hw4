// Wishlist, shopping cart, and saved embroidery designs.
//
// Logged-in shoppers: kept in the database through the backend (/api/shop, /api/wishlist,
// /api/cart, /api/embroidery-designs), so they follow the shopper to any device.
// Guests: kept in this browser's localStorage. When a guest logs in, everything they
// collected is merged into their account (POST /api/shop/merge) and cleared from the browser.
// Both cases share one state shape (ShopState) and one set of actions (ShopActions).

import { createContext, useContext } from 'react'
import { requestJson, type EmbroideryLocation } from './api.ts'

export type Embroidery = { text: string; location: EmbroideryLocation; thread_color: string | null }
export type EmbroideryDesign = Embroidery & { id: string }

export type CartLine = {
  id: string
  product_id: string
  size: string
  color?: string // missing only on guest lines saved before color was required
  quantity: number
  embroidery: Embroidery | null
}

export type ShopState = {
  wishlist: string[] // product_ids, newest first
  cart: CartLine[]
  designs: EmbroideryDesign[] // newest first
}

export type CartAddInput = {
  product_id: string
  size: string
  color: string // the colorway the shopper confirmed
  quantity: number
  embroidery: Embroidery | null
  save_design: boolean
  stock: number // units in this size, so a guest's cart can be checked too
}

// A group order (team, club, event): one product, color, and embroidery design, several
// sizes. Added all at once, or not at all if any size is short on stock.
export type GroupOrderInput = {
  product_id: string
  color: string
  sizes: { size: string; quantity: number; stock: number }[]
  embroidery: Embroidery | null
  save_design: boolean
}

export type ShopActions = {
  state: ShopState
  inWishlist: (productId: string) => boolean
  toggleWishlist: (productId: string) => Promise<void>
  addToCart: (input: CartAddInput) => Promise<void>
  addGroupOrder: (input: GroupOrderInput) => Promise<void>
  setQuantity: (lineId: string, quantity: number, stock: number) => Promise<void>
  removeLine: (lineId: string) => Promise<void>
  deleteDesign: (designId: string) => Promise<void>
}

export const EMPTY_SHOP: ShopState = { wishlist: [], cart: [], designs: [] }
export const MAX_CART_QUANTITY = 10 // the quantity picker for a single order
export const MAX_LINE_QUANTITY = 50 // most units on one cart line (group orders); stock is the usual limit
export const EMBROIDERY_MAX_CHARS = 20
const EMBROIDERY_PATTERN = /^[A-Za-z0-9 &'.!#-]+$/

// Swatches for thread colors (names match backend models.ThreadColor).
export const THREAD_SWATCHES: Record<string, string> = {
  White: '#ffffff',
  Navy: '#1f2a44',
  'Yale blue': '#00356b',
  Gray: '#9a9ea6',
  Black: '#111111',
  Gold: '#c9a227',
}

// Dark thread on a dark garment can be hard to see. Only white and gold count as light
// threads; the garment colors below are the catalogue's dark main colors (50 products).
// It's a warning only: shoppers can still order it.
const LIGHT_THREADS = new Set(['White', 'Gold'])
const DARK_GARMENT_COLORS = new Set([
  'navy',
  'navy blue',
  'charcoal gray',
  'dark heather gray',
  'dark heather charcoal',
  'heather charcoal gray',
])

export function hardToSee(garmentColor: string | null | undefined, threadColor: string | null | undefined) {
  return Boolean(
    garmentColor && threadColor && DARK_GARMENT_COLORS.has(garmentColor.toLowerCase()) && !LIGHT_THREADS.has(threadColor),
  )
}

// Thread color for use mid-sentence: "navy thread", but "Yale blue thread".
export function threadName(color: string) {
  return color.startsWith('Yale') ? color : color.toLowerCase()
}

export const LOCATION_LABELS: Record<EmbroideryLocation, string> = {
  left_chest: 'Left chest, below the logo',
  right_chest: 'Right chest',
  shoulder: 'Shoulder',
}

// Same rules the backend checks (models.Embroidery).
export function cleanEmbroideryText(text: string) {
  return text.split(/\s+/).filter(Boolean).join(' ')
}

export function embroideryError(text: string): string | null {
  const clean = cleanEmbroideryText(text)
  if (!clean) return 'Enter the text to embroider.'
  if (clean.length > EMBROIDERY_MAX_CHARS) return `Keep it to ${EMBROIDERY_MAX_CHARS} characters.`
  if (!EMBROIDERY_PATTERN.test(clean)) return "Use letters, numbers, spaces, and & ' . ! # - only."
  return null
}

export const ShopContext = createContext<ShopActions | null>(null)

export function useShop() {
  const shop = useContext(ShopContext)
  if (!shop) throw new Error('useShop must be used inside <ShopProvider>')
  return shop
}

export function cartCount(state: ShopState) {
  return state.cart.reduce((sum, line) => sum + line.quantity, 0)
}

// --- Logged in: the backend ------------------------------------------------------------

export const accountApi = {
  load: () => requestJson<ShopState>('GET', '/api/shop'),
  merge: (guest: ShopState) =>
    requestJson<ShopState>('POST', '/api/shop/merge', {
      wishlist: guest.wishlist,
      cart: guest.cart.map((l) => ({ product_id: l.product_id, size: l.size, color: l.color ?? null, quantity: l.quantity, embroidery: l.embroidery, save_design: false })),
      designs: guest.designs.map(({ text, location, thread_color }) => ({ text, location, thread_color })),
    }),
  addWishlist: (productId: string) => requestJson<ShopState>('POST', '/api/wishlist', { product_id: productId }),
  removeWishlist: (productId: string) =>
    requestJson<ShopState>('DELETE', `/api/wishlist/${encodeURIComponent(productId)}`),
  addToCart: ({ stock: _stock, ...item }: CartAddInput) => requestJson<ShopState>('POST', '/api/cart', item),
  addGroupOrder: ({ sizes, ...order }: GroupOrderInput) =>
    requestJson<ShopState>('POST', '/api/cart/group', {
      ...order,
      sizes: sizes.filter((s) => s.quantity > 0).map(({ size, quantity }) => ({ size, quantity })),
    }),
  setQuantity: (lineId: string, quantity: number) =>
    requestJson<ShopState>('PATCH', `/api/cart/${lineId}`, { quantity }),
  removeLine: (lineId: string) => requestJson<ShopState>('DELETE', `/api/cart/${lineId}`),
  deleteDesign: (designId: string) => requestJson<ShopState>('DELETE', `/api/embroidery-designs/${designId}`),
}

// --- Guest: this browser ---------------------------------------------------------------

const GUEST_KEY = 'campus-customs-guest-shop'

export function loadGuestShop(): ShopState {
  try {
    const saved = JSON.parse(localStorage.getItem(GUEST_KEY) ?? 'null')
    return saved ? { ...EMPTY_SHOP, ...saved } : EMPTY_SHOP
  } catch {
    return EMPTY_SHOP
  }
}

export function saveGuestShop(state: ShopState | null) {
  if (state) localStorage.setItem(GUEST_KEY, JSON.stringify(state))
  else localStorage.removeItem(GUEST_KEY)
}

export function hasGuestItems(state: ShopState) {
  return state.wishlist.length + state.cart.length + state.designs.length > 0
}

const sameEmbroidery = (a: Embroidery | null, b: Embroidery | null) =>
  a?.text === b?.text && a?.location === b?.location && a?.thread_color === b?.thread_color

function inCart(state: ShopState, productId: string, size: string, exceptLine?: string) {
  return state.cart
    .filter((l) => l.product_id === productId && l.size === size && l.id !== exceptLine)
    .reduce((sum, l) => sum + l.quantity, 0)
}

// The guest versions apply the same rules as backend/shop.py.
export const guestShop = {
  toggleWishlist(state: ShopState, productId: string): ShopState {
    const wishlist = state.wishlist.includes(productId)
      ? state.wishlist.filter((id) => id !== productId)
      : [productId, ...state.wishlist]
    return { ...state, wishlist }
  },

  addToCart(state: ShopState, input: CartAddInput): ShopState {
    const already = inCart(state, input.product_id, input.size)
    if (input.stock === 0) throw new Error(`Size ${input.size} is sold out.`)
    if (already + input.quantity > input.stock) {
      throw new Error(
        already
          ? `We only have ${input.stock} in size ${input.size}, and ${already} are already in your cart.`
          : `We only have ${input.stock} in size ${input.size}.`,
      )
    }
    const same = state.cart.find(
      (l) =>
        l.product_id === input.product_id &&
        l.size === input.size &&
        l.color === input.color &&
        sameEmbroidery(l.embroidery, input.embroidery),
    )
    if (same && same.quantity + input.quantity > MAX_LINE_QUANTITY) {
      throw new Error(`You can have at most ${MAX_LINE_QUANTITY} of one item in your cart.`)
    }
    const cart = same
      ? state.cart.map((l) => (l === same ? { ...l, quantity: l.quantity + input.quantity } : l))
      : [
          ...state.cart,
          {
            id: crypto.randomUUID(),
            product_id: input.product_id,
            size: input.size,
            color: input.color,
            quantity: input.quantity,
            embroidery: input.embroidery,
          },
        ]
    let designs = state.designs
    const design = input.embroidery
    if (design && input.save_design && !designs.some((d) => sameEmbroidery(d, design))) {
      designs = [{ id: crypto.randomUUID(), ...design }, ...designs].slice(0, 20)
    }
    return { ...state, cart, designs }
  },

  addGroupOrder(state: ShopState, input: GroupOrderInput): ShopState {
    const wanted = input.sizes.filter((s) => s.quantity > 0)
    if (wanted.length === 0) throw new Error('Enter how many you need in at least one size.')
    let next = state
    for (const { size, quantity, stock } of wanted) {
      try {
        next = guestShop.addToCart(next, { ...input, size, quantity, stock })
      } catch (err) {
        // Nothing is saved until every size fits, like the backend's single transaction.
        throw new Error(`Nothing was added. ${err instanceof Error ? err.message : ''}`.trim(), { cause: err })
      }
    }
    return next
  },

  setQuantity(state: ShopState, lineId: string, quantity: number, stock: number): ShopState {
    const line = state.cart.find((l) => l.id === lineId)
    if (!line) return state
    if (inCart(state, line.product_id, line.size, lineId) + quantity > stock) {
      throw new Error(`We only have ${stock} in size ${line.size}.`)
    }
    return { ...state, cart: state.cart.map((l) => (l.id === lineId ? { ...l, quantity } : l)) }
  },

  removeLine: (state: ShopState, lineId: string): ShopState => ({
    ...state,
    cart: state.cart.filter((l) => l.id !== lineId),
  }),

  deleteDesign: (state: ShopState, designId: string): ShopState => ({
    ...state,
    designs: state.designs.filter((d) => d.id !== designId),
  }),
}
