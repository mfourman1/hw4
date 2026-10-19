import { useState } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import { formatPrice } from '../api.ts'
import { categoryLabel, productKind } from '../categories.ts'
import BuyBox from '../components/BuyBox.tsx'
import CompleteTheLook from '../components/CompleteTheLook.tsx'
import FadeImage from '../components/FadeImage.tsx'
import { SizeGuideDialog } from '../components/SizeGuide.tsx'
import TryOn from '../components/TryOn.tsx'
import { embroiderySpot, previewThread } from '../embroideryPlacement.ts'
import { cachedSummary, useProduct } from '../productCache.ts'
import type { Embroidery } from '../shop.ts'

export default function ProductDetail() {
  const { productId = '' } = useParams()
  const location = useLocation()
  const { product, status } = useProduct(productId)
  const [sizeGuideOpen, setSizeGuideOpen] = useState(false)
  const [tryOnOpen, setTryOnOpen] = useState(false)
  // The embroidery the shopper is designing in the buy box, drawn live on the photo.
  const [preview, setPreview] = useState<Embroidery | null>(null)
  // Shown at once from the product list while the full details arrive, so the page never
  // looks like it's loading.
  const summary = cachedSummary(productId)

  // Cards pass the page they were clicked on. If that was search or chat results, the
  // breadcrumb links back to those results; category pages get the usual Shop / Category trail.
  const from: unknown = location.state?.from
  const fromResults = typeof from === 'string' && /^\/(products\?(.*&)?(ids|q)=|wishlist\/shared\/)/.test(from)
  const categories = product?.categories ?? summary?.categories ?? []
  const mainCategory = ['hoodie', 'crewneck', 't-shirt', 'quarter-zip', 'jacket'].find((c) => categories.includes(c)) ?? null

  if (!product && (status === 'not-found' || status === 'error')) {
    return (
      <section className="page">
        <Link to="/products" className="back-link">
          ← Shop all
        </Link>
        <p className="error">
          {status === 'not-found' ? "We couldn't find that product." : "We couldn't load this product. Is the backend running?"}
        </p>
      </section>
    )
  }

  const name = product?.name ?? summary?.name
  if (!name) return <section className="page product-page-placeholder" aria-busy="true" />

  const spot = product && preview ? embroiderySpot(product, preview.location) : null

  return (
    <section className="page">
      <nav className="breadcrumbs" aria-label="Breadcrumb">
        <Link to="/">Home</Link>
        <span aria-hidden="true">/</span>
        {fromResults ? (
          <Link to={from}>{from.startsWith('/wishlist') ? 'Back to the wishlist' : 'Back to results'}</Link>
        ) : (
          <Link to="/products">Shop</Link>
        )}
        {mainCategory && !fromResults && (
          <>
            <span aria-hidden="true">/</span>
            <Link to={`/products?category=${encodeURIComponent(mainCategory)}`}>{categoryLabel(mainCategory)}</Link>
          </>
        )}
        <span aria-hidden="true">/</span>
        <span aria-current="page">{name}</span>
      </nav>

      <div className="product-detail">
        <div className="product-detail-image">
          <div className="product-photo">
            <FadeImage src={product?.image_url ?? summary?.image_url} alt={name} />
            {product && preview && spot && (
              <span
                className="embroidery-preview"
                aria-label={`Embroidery preview: ${preview.text}`}
                style={{
                  left: `${spot.x}%`,
                  top: `${spot.y}%`,
                  transform: `translate(-50%, -50%) rotate(${spot.rotate}deg)`,
                  color: previewThread(preview, product.colorway),
                }}
              >
                {preview.text}
              </span>
            )}
          </div>
          {preview && <p className="preview-tag fade-swap">Embroidery preview · the shop places the real stitching by hand</p>}
        </div>
        <div className="product-detail-info">
          <p className="eyebrow">{product?.garment_type ?? summary?.garment_type}</p>
          <h1>{name}</h1>
          <p className="price price-large">{formatPrice(product?.price ?? summary?.price ?? 0)}</p>
          <p className="product-description">{product?.description ?? summary?.short_description}</p>

          {/* Phones only (see index.css): see yourself in it with the front camera. */}
          {product && (
            <button type="button" className="button button-ghost try-on-button" onClick={() => setTryOnOpen(true)}>
              📷 Try it on
            </button>
          )}

          {product &&
            (product.sizes.length > 0 ? (
              <div className="fade-swap">
                <BuyBox
                  key={product.product_id}
                  product={product}
                  onSizeGuide={() => setSizeGuideOpen(true)}
                  onPreview={setPreview}
                />
              </div>
            ) : (
              <p className="muted">Size and stock information isn't available for this item.</p>
            ))}
        </div>
      </div>

      {(product ?? summary) && <CompleteTheLook product={(product ?? summary)!} />}

      {sizeGuideOpen && <SizeGuideDialog product={productKind(categories)} onClose={() => setSizeGuideOpen(false)} />}
      {tryOnOpen && product && <TryOn product={product} embroidery={preview} onClose={() => setTryOnOpen(false)} />}
    </section>
  )
}
