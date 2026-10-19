import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth.ts'
import { formatPrice } from '../api.ts'
import { cartCount, hardToSee, LOCATION_LABELS, threadName, MAX_LINE_QUANTITY, useShop, type CartLine } from '../shop.ts'
import { useProductDetails } from '../useProductDetails.ts'

// The shopping cart. There's no checkout or payment on this site (a project decision):
// shoppers use the cart to plan what to buy at the shop.
export default function Cart() {
  const { user } = useAuth()
  const { state, setQuantity, removeLine } = useShop()
  const details = useProductDetails(state.cart.map((l) => l.product_id))
  const [error, setError] = useState<{ lineId: string; text: string } | null>(null)

  const loaded = state.cart.every((l) => details[l.product_id])
  const garments = state.cart.reduce((sum, l) => sum + (details[l.product_id]?.price ?? 0) * l.quantity, 0)
  const embroideredCount = state.cart.reduce((sum, l) => sum + (l.embroidery ? l.quantity : 0), 0)
  const embroideryPrice = Object.values(details)[0]?.embroidery_price ?? 0
  const embroidery = embroideredCount * embroideryPrice

  async function change(line: CartLine, quantity: number) {
    const stock = details[line.product_id]?.sizes.find((s) => s.size === line.size)?.quantity ?? 0
    setError(null)
    try {
      await setQuantity(line.id, quantity, stock)
    } catch (err) {
      setError({ lineId: line.id, text: err instanceof Error ? err.message : 'Could not change the quantity.' })
    }
  }

  return (
    <section className="page">
      <h1>Your cart</h1>
      {!user && state.cart.length > 0 && (
        <p className="muted">
          You're browsing as a guest, so this cart is saved on this device only. <Link to="/login">Log in</Link> to
          keep it on your account.
        </p>
      )}

      {state.cart.length === 0 ? (
        <p>
          Your cart is empty. <Link to="/products">Browse products</Link>
        </p>
      ) : (
        <div className="cart-layout">
          <ul className="cart-lines">
            {state.cart.map((line) => {
              const product = details[line.product_id]
              if (!product) return null // appears (fading in) as soon as its details are ready
              const stock = product.sizes.find((s) => s.size === line.size)?.quantity ?? 0
              const each = product.price + (line.embroidery ? product.embroidery_price : 0)
              const options = Math.max(Math.min(MAX_LINE_QUANTITY, stock), line.quantity)
              return (
                <li key={line.id} className="cart-line fade-swap">
                  <Link to={`/products/${line.product_id}`} className="cart-thumb">
                    <img src={product.image_url} alt="" />
                  </Link>
                  <div className="cart-info">
                    <Link to={`/products/${line.product_id}`} className="cart-name">
                      {product.name}
                    </Link>
                    <p className="muted">
                      Size {line.size} · <span className="capitalize">{line.color ?? product.colorway}</span> ·{' '}
                      {formatPrice(product.price)}
                    </p>
                    {line.embroidery && (
                      <p className="cart-embroidery">
                        Embroidery: “{line.embroidery.text}”, {LOCATION_LABELS[line.embroidery.location].toLowerCase()}
                        {line.embroidery.thread_color && `, ${threadName(line.embroidery.thread_color)} thread`} (+
                        {formatPrice(product.embroidery_price)})
                      </p>
                    )}
                    {line.embroidery && hardToSee(line.color ?? product.colorway, line.embroidery.thread_color) && (
                      <p className="field-warning small">Dark thread on a dark garment may be hard to see.</p>
                    )}
                    {stock < line.quantity && (
                      <p className="form-error">
                        {stock === 0 ? 'This size has sold out.' : `Only ${stock} left in this size.`}
                      </p>
                    )}
                    {error?.lineId === line.id && <p className="form-error">{error.text}</p>}
                  </div>
                  <div className="cart-controls">
                    <select
                      value={line.quantity}
                      onChange={(e) => change(line, Number(e.target.value))}
                      aria-label={`Quantity of ${product.name}`}
                    >
                      {Array.from({ length: options }, (_, i) => i + 1).map((n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ))}
                    </select>
                    <strong>{formatPrice(each * line.quantity)}</strong>
                    <button type="button" className="link-button" onClick={() => removeLine(line.id)}>
                      Remove
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>

          <aside className="cart-summary">
            <h2>Summary</h2>
            <dl>
              <dt>Items</dt>
              <dd>{cartCount(state)}</dd>
              <dt>Garments</dt>
              <dd>{loaded ? formatPrice(garments) : '…'}</dd>
              {embroideredCount > 0 && (
                <>
                  <dt>
                    Embroidery ({embroideredCount} × {formatPrice(embroideryPrice)})
                  </dt>
                  <dd>{formatPrice(embroidery)}</dd>
                </>
              )}
              <dt className="total">Estimated total</dt>
              <dd className="total">{loaded ? formatPrice(garments + embroidery) : '…'}</dd>
            </dl>
            <p className="notice">
              Online checkout and payment aren't available on this site. Bring your list to Campus Customs at 57
              Broadway, New Haven, to buy in person.
            </p>
          </aside>
        </div>
      )}
    </section>
  )
}
