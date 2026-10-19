import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { fetchAlternatives, formatPrice, type AlternativeProduct } from '../api.ts'
import { prefetchProduct } from '../productCache.ts'
import FadeImage from './FadeImage.tsx'

// When the shopper's size is sold out: similar items (same college, team, school, or family
// group first, then the same kind of garment) that are in stock in that size.
export default function InStockAlternatives({ productId, size, intro }: { productId: string; size: string; intro?: string }) {
  const location = useLocation()
  const key = `${productId}|${size}`
  const [result, setResult] = useState<{ key: string; items: AlternativeProduct[] } | null>(null)
  const items = result?.key === key ? result.items : null

  useEffect(() => {
    const controller = new AbortController()
    fetchAlternatives(productId, size, controller.signal)
      .then((found) => setResult({ key, items: found }))
      .catch(() => {
        if (!controller.signal.aborted) setResult({ key, items: [] })
      })
    return () => controller.abort()
  }, [key, productId, size])

  if (!items) return null // fades in once ready, never a loading message
  return (
    <div className="alternatives fade-swap" role="status">
      <p className="alternatives-intro">
        {intro ?? `Size ${size} is sold out in this item.`}{' '}
        {items.length > 0 ? `These similar items are in stock in ${size}:` : `Nothing similar is in stock in ${size} right now.`}
      </p>
      {items.length > 0 && (
        <div className="mini-cards">
          {items.map((p) => (
            <Link
              key={p.product_id}
              to={`/products/${p.product_id}`}
              state={{ from: location.pathname + location.search }}
              className="mini-card"
              onMouseEnter={() => prefetchProduct(p.product_id)}
              onFocus={() => prefetchProduct(p.product_id)}
            >
              <FadeImage src={p.image_url} alt="" />
              <span className="mini-card-why">{p.why}</span>
              <span className="mini-card-name">{p.name}</span>
              <span className="mini-card-price">{formatPrice(p.price)}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
