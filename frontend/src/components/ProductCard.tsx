import { Link, useLocation } from 'react-router-dom'
import { formatPrice, type ProductSummary } from '../api.ts'
import { prefetchProduct } from '../productCache.ts'
import FadeImage from './FadeImage.tsx'
import WishlistButton from './WishlistButton.tsx'

export default function ProductCard({ product }: { product: ProductSummary }) {
  const location = useLocation()
  // Start fetching the product page's details as soon as the shopper points at the card,
  // so clicking it opens the page instantly.
  const warm = () => prefetchProduct(product.product_id)
  return (
    <div className="product-card" onMouseEnter={warm} onFocus={warm} onTouchStart={warm}>
      <Link
        to={`/products/${product.product_id}`}
        // Remember where the card was clicked, so the detail page can link back to those
        // results (e.g. the chat's search results) instead of always to all products.
        state={{ from: location.pathname + location.search }}
        className="product-card-link"
      >
        <div className="product-card-image">
          <FadeImage src={product.image_url} alt={product.name} loading="lazy" />
        </div>
        <div className="product-card-body">
          <p className="product-card-type">{product.garment_type}</p>
          <h3>{product.name}</h3>
          <p className="price">{formatPrice(product.price)}</p>
          <p className="product-card-description">{product.short_description}</p>
        </div>
      </Link>
      <WishlistButton productId={product.product_id} compact />
    </div>
  )
}
