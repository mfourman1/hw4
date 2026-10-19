import { useEffect, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import { fetchSharedWishlist, formatPrice, NotFoundError, type ProductDetail, type SharedItem, type SharedWishlist as Shared } from '../api.ts'
import FadeImage from '../components/FadeImage.tsx'
import InStockAlternatives from '../components/InStockAlternatives.tsx'
import { LOCATION_LABELS, threadName, useShop } from '../shop.ts'
import { useProductDetails } from '../useProductDetails.ts'

type ItemStatus = { ok: boolean; text: string }

// A wishlist someone shared (/wishlist/shared/<token>): family and friends see each item with
// the owner's size and embroidery, and can add it to their own cart in one click. When the
// owner's size has sold out, similar items in that size are suggested instead.
export default function SharedWishlist() {
  const { token = '' } = useParams()
  const location = useLocation()
  const { addToCart } = useShop()
  const [shared, setShared] = useState<Shared | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [statuses, setStatuses] = useState<Record<string, ItemStatus>>({})
  const [addingAll, setAddingAll] = useState(false)
  const details = useProductDetails(shared?.items.map((i) => i.product_id) ?? [])

  useEffect(() => {
    const controller = new AbortController()
    fetchSharedWishlist(token, controller.signal)
      .then(setShared)
      .catch((err) => {
        if (controller.signal.aborted) return
        setProblem(err instanceof NotFoundError ? "This wishlist link isn't valid. Ask for a new one." : "We couldn't open this wishlist. Please try again.")
      })
    return () => controller.abort()
  }, [token])

  const stockFor = (item: SharedItem, product?: ProductDetail) =>
    product?.sizes.find((s) => s.size === item.size)?.quantity ?? 0

  async function add(item: SharedItem, product: ProductDetail): Promise<boolean> {
    if (!item.size) return false
    try {
      await addToCart({
        product_id: item.product_id,
        size: item.size,
        color: product.colorway,
        quantity: 1,
        embroidery: item.embroidery,
        save_design: false,
        stock: stockFor(item, product),
      })
      setStatuses((s) => ({ ...s, [item.product_id]: { ok: true, text: `Added size ${item.size} to your cart.` } }))
      return true
    } catch (err) {
      setStatuses((s) => ({ ...s, [item.product_id]: { ok: false, text: err instanceof Error ? err.message : 'Could not add this.' } }))
      return false
    }
  }

  async function addAll() {
    if (!shared) return
    setAddingAll(true)
    for (const item of shared.items) {
      const product = details[item.product_id]
      if (product && item.size && stockFor(item, product) > 0 && !statuses[item.product_id]?.ok) await add(item, product)
    }
    setAddingAll(false)
  }

  if (problem) {
    return (
      <section className="page narrow">
        <h1>Shared wishlist</h1>
        <p className="error">{problem}</p>
        <Link to="/products">Browse our products</Link>
      </section>
    )
  }
  if (!shared) return <section className="page product-page-placeholder" />

  const owner = shared.owner_name
  const ready = shared.items.filter((i) => i.size && stockFor(i, details[i.product_id]) > 0).length

  return (
    <section className="page shared-wishlist">
      <p className="eyebrow">A Campus Customs wishlist</p>
      <h1>{owner ? `${owner}'s Yale wishlist` : 'A Yale wishlist'}</h1>
      {shared.note && <blockquote className="shared-note">“{shared.note}”</blockquote>}
      <p className="muted">
        {owner ?? 'They'} picked {shared.items.length === 1 ? 'this item' : `these ${shared.items.length} items`}, with
        their size. Add any of them to your cart, then bring your list to Campus Customs at 57 Broadway. There's no
        online checkout.
      </p>
      {ready > 1 && (
        <button type="button" className="button" onClick={addAll} disabled={addingAll}>
          {addingAll ? 'Adding…' : `Add all ${ready} in-stock items to my cart`}
        </button>
      )}

      <ul className="shared-items">
        {shared.items.map((item) => {
          const product = details[item.product_id]
          if (!product) return null // fades in once its details are ready
          const stock = stockFor(item, product)
          const status = statuses[item.product_id]
          const each = product.price + (item.embroidery ? product.embroidery_price : 0)
          return (
            <li key={item.product_id} className="shared-item fade-swap">
              <Link to={`/products/${item.product_id}`} state={{ from: location.pathname }} className="shared-thumb">
                <FadeImage src={product.image_url} alt="" />
              </Link>
              <div className="shared-info">
                <Link to={`/products/${item.product_id}`} state={{ from: location.pathname }} className="cart-name">
                  {product.name}
                </Link>
                <p className="price">{formatPrice(each)}</p>
                <p className="muted">
                  {item.size ? (
                    <>
                      {owner ? `${owner}'s` : 'Their'} size: <strong>{item.size}</strong> ·{' '}
                      {stock === 0 ? 'sold out' : stock <= 5 ? `only ${stock} left` : 'in stock'}
                    </>
                  ) : (
                    'No size given: choose one on the item page.'
                  )}
                </p>
                {item.embroidery && (
                  <p className="cart-embroidery">
                    Embroidery: “{item.embroidery.text}”, {LOCATION_LABELS[item.embroidery.location].toLowerCase()}
                    {item.embroidery.thread_color && `, ${threadName(item.embroidery.thread_color)} thread`} (+
                    {formatPrice(product.embroidery_price)})
                  </p>
                )}
                {status && (
                  <p className={status.ok ? 'notice' : 'form-error'} role="status">
                    {status.text} {status.ok && <Link to="/cart">View cart</Link>}
                  </p>
                )}
                {item.size && stock === 0 && (
                  <InStockAlternatives
                    productId={item.product_id}
                    size={item.size}
                    intro={`This one is sold out in ${owner ? `${owner}'s` : 'their'} size.`}
                  />
                )}
              </div>
              <div className="shared-actions">
                {item.size && stock > 0 ? (
                  <button type="button" className="button button-small" onClick={() => add(item, product)} disabled={status?.ok}>
                    {status?.ok ? 'In your cart' : 'Add to my cart'}
                  </button>
                ) : (
                  <Link to={`/products/${item.product_id}`} state={{ from: location.pathname }} className="button button-small button-ghost">
                    {item.size ? 'See the item' : 'Choose a size'}
                  </Link>
                )}
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
