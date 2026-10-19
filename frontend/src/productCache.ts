// Product data kept for the whole visit, so moving between pages never waits on the network
// or shows a "Loading…" state:
// - the product list is fetched once and shared by every page;
// - each product's details are fetched once, and ahead of time when a shopper hovers or
//   focuses a product card (prefetchProduct), so the product page opens instantly;
// - pages show what's cached right away and refresh it quietly in the background.

import { useEffect, useState } from 'react'
import {
  fetchGroups,
  fetchProduct,
  fetchProducts,
  NotFoundError,
  type MenuGroup,
  type ProductDetail,
  type ProductSummary,
} from './api.ts'

let productList: ProductSummary[] | null = null
let listRequest: Promise<ProductSummary[]> | null = null
const details = new Map<string, ProductDetail>()
const detailRequests = new Map<string, Promise<ProductDetail>>()

export function loadProducts(): Promise<ProductSummary[]> {
  listRequest ??= fetchProducts()
    .then((list) => (productList = list))
    .catch((err) => {
      listRequest = null // let the next call try again
      throw err
    })
  return listRequest
}

export function loadProduct(productId: string, refresh = false): Promise<ProductDetail> {
  const pending = detailRequests.get(productId)
  if (pending && !refresh) return pending
  const request = fetchProduct(productId)
    .then((product) => {
      details.set(productId, product)
      return product
    })
    .finally(() => detailRequests.delete(productId))
  detailRequests.set(productId, request)
  return request
}

export function prefetchProduct(productId: string) {
  if (!details.has(productId)) loadProduct(productId).catch(() => {})
}

export function cachedSummary(productId: string) {
  return productList?.find((p) => p.product_id === productId) ?? null
}

// Every product, for lists. `products` is the cached list right away when there is one.
export function useProducts() {
  const [products, setProducts] = useState<ProductSummary[] | null>(productList)
  const [error, setError] = useState(false)

  useEffect(() => {
    let active = true
    loadProducts()
      .then((list) => active && setProducts(list))
      .catch(() => active && setError(true))
    return () => {
      active = false
    }
  }, [])

  return { products, error }
}

type DetailState = { productId: string; product: ProductDetail | null; status: 'ok' | 'not-found' | 'error' | 'loading' }

// One product's details: cached ones immediately, then refreshed (stock may have changed).
export function useProduct(productId: string) {
  const fromCache = (): DetailState => ({
    productId,
    product: details.get(productId) ?? null,
    status: details.has(productId) ? 'ok' : 'loading',
  })
  const [state, setState] = useState<DetailState>(fromCache)
  const current = state.productId === productId ? state : fromCache()

  useEffect(() => {
    let active = true
    loadProduct(productId, details.has(productId))
      .then((product) => active && setState({ productId, product, status: 'ok' }))
      .catch((err) => {
        if (!active || details.has(productId)) return
        setState({ productId, product: null, status: err instanceof NotFoundError ? 'not-found' : 'error' })
      })
    return () => {
      active = false
    }
  }, [productId])

  return current
}

// Details for several products at once (cart, wishlist). Maps product_id -> ProductDetail.
export function useProductDetails(productIds: string[]) {
  const key = [...new Set(productIds)].sort().join(',')
  const fromCache = () => {
    const found: Record<string, ProductDetail> = {}
    for (const id of key ? key.split(',') : []) {
      const product = details.get(id)
      if (product) found[id] = product
    }
    return found
  }
  const [found, setFound] = useState<Record<string, ProductDetail>>(fromCache)

  useEffect(() => {
    let active = true
    const ids = key ? key.split(',') : []
    Promise.all(ids.map((id) => loadProduct(id).catch(() => null))).then((list) => {
      if (!active) return
      const next: Record<string, ProductDetail> = {}
      for (const product of list) if (product) next[product.product_id] = product
      setFound(next)
    })
    return () => {
      active = false
    }
  }, [key])

  return found
}

// The header menus (colleges, sports, graduate schools, family): fetched once per visit.
let groupMenu: MenuGroup[] | null = null
let groupRequest: Promise<MenuGroup[]> | null = null

function loadGroups(): Promise<MenuGroup[]> {
  groupRequest ??= fetchGroups()
    .then((menu) => (groupMenu = menu))
    .catch((err) => {
      groupRequest = null
      throw err
    })
  return groupRequest
}

export function useMerchGroups() {
  const [menu, setMenu] = useState<MenuGroup[] | null>(groupMenu)
  useEffect(() => {
    let active = true
    loadGroups()
      .then((m) => active && setMenu(m))
      .catch(() => {})
    return () => {
      active = false
    }
  }, [])
  return menu
}
