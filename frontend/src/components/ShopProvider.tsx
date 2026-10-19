import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useAuth } from '../auth.ts'
import {
  accountApi,
  EMPTY_SHOP,
  guestShop,
  hasGuestItems,
  loadGuestShop,
  saveGuestShop,
  ShopContext,
  type ShopActions,
  type ShopState,
} from '../shop.ts'

// Holds the wishlist, cart, and saved designs for whoever is using the site (see shop.ts).
export default function ShopProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const [state, setState] = useState<ShopState>(loadGuestShop)
  const loggedIn = Boolean(user)

  // When someone logs in, move anything they collected as a guest into their account, then
  // show the account's lists. On logout, show this browser's (now empty) guest lists, so the
  // next person at the computer doesn't see the account's cart.
  const userId = user?.id
  const [shownFor, setShownFor] = useState(userId)
  if (shownFor !== userId) {
    // The account changed: show the guest lists after logout, or nothing until the
    // account's lists arrive after login.
    setShownFor(userId)
    setState(userId === undefined ? loadGuestShop() : EMPTY_SHOP)
  }

  // One load (or merge) per login, even if this effect runs twice, so a guest's cart is
  // never added to the account twice.
  const loading = useRef<{ userId: number; request: Promise<ShopState> } | null>(null)
  useEffect(() => {
    if (userId === undefined) {
      loading.current = null
      return
    }
    if (loading.current?.userId !== userId) {
      const guest = loadGuestShop()
      let request: Promise<ShopState>
      if (hasGuestItems(guest)) {
        saveGuestShop(null) // taken out of the browser now, so it's merged only once
        request = accountApi.merge(guest).catch((err) => {
          saveGuestShop(guest) // merge failed: keep the guest's items for next time
          throw err
        })
      } else {
        request = accountApi.load()
      }
      loading.current = { userId, request }
    }
    let cancelled = false
    loading.current.request
      .then((account) => {
        if (!cancelled) setState(account)
      })
      .catch(() => {
        if (!cancelled) setState(EMPTY_SHOP)
      })
    return () => {
      cancelled = true
    }
  }, [userId])

  // Logged in: ask the backend, which returns the new state. Guest: change it here and
  // keep it in localStorage.
  async function change(account: () => Promise<ShopState>, guest: (s: ShopState) => ShopState) {
    if (loggedIn) {
      setState(await account())
    } else {
      const next = guest(state)
      saveGuestShop(next)
      setState(next)
    }
  }

  const value: ShopActions = {
    state,
    inWishlist: (productId) => state.wishlist.includes(productId),
    toggleWishlist: (productId) =>
      change(
        () =>
          state.wishlist.includes(productId)
            ? accountApi.removeWishlist(productId)
            : accountApi.addWishlist(productId),
        (s) => guestShop.toggleWishlist(s, productId),
      ),
    addToCart: (input) =>
      change(
        () => accountApi.addToCart(input),
        (s) => guestShop.addToCart(s, input),
      ),
    addGroupOrder: (input) =>
      change(
        () => accountApi.addGroupOrder(input),
        (s) => guestShop.addGroupOrder(s, input),
      ),
    setQuantity: (lineId, quantity, stock) =>
      change(
        () => accountApi.setQuantity(lineId, quantity),
        (s) => guestShop.setQuantity(s, lineId, quantity, stock),
      ),
    removeLine: (lineId) =>
      change(
        () => accountApi.removeLine(lineId),
        (s) => guestShop.removeLine(s, lineId),
      ),
    deleteDesign: (designId) =>
      change(
        () => accountApi.deleteDesign(designId),
        (s) => guestShop.deleteDesign(s, designId),
      ),
  }

  return <ShopContext.Provider value={value}>{children}</ShopContext.Provider>
}
