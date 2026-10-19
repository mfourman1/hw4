import { Link, useLocation } from 'react-router-dom'
import { openChat, SHOP_CATEGORIES } from '../categories.ts'
import FadeImage from '../components/FadeImage.tsx'
import HeroCarousel from '../components/HeroCarousel.tsx'
import ProductCard from '../components/ProductCard.tsx'
import SizeGuide from '../components/SizeGuide.tsx'
import { currentSeason, seasonPicks } from '../season.ts'
import { useProducts } from '../useProducts.ts'

// Year-round favorites, shown after the season's picks if the season has fewer than eight.
const featuredIds = [
  'basic-hoodie-big-yale',
  '2025-yale-vs-harvard-t-shirt',
  'champion-reverse-weave-crewneck',
  'pierson-college-crewneck',
  'yale-dad-hoodie',
  'saybrook-sweater-fleece-jacket',
  'school-of-management-crest-t-shirt',
  'brooks-brothers-bomber-jacket-yale',
]

export default function Home() {
  const { search } = useLocation()
  const { products } = useProducts()
  const season = currentSeason(search)
  const favorites = featuredIds.flatMap((id) => products?.find((p) => p.product_id === id) ?? [])
  const seasonal = products ? seasonPicks(season, products) : []
  const featured = [...seasonal, ...favorites.filter((p) => !seasonal.includes(p))].slice(0, 8)

  return (
    <>
      <HeroCarousel season={season} />

      <section className="story">
        <p className="eyebrow">57 Broadway · New Haven</p>
        <h2>Tradition you can wear</h2>
        <p>
          Campus Customs makes officially licensed Yale apparel for everyone who calls Yale theirs: students walking to
          class, alumni coming back for The Game, and families cheering from the stands. Pick your college or your team,
          add your own embroidery, and we'll make it feel like it was always yours.
        </p>
      </section>

      <section className="page">
        <div className="section-title">
          <p className="eyebrow">Shop by category</p>
          <h2>Find your layer</h2>
        </div>
        <div className="category-tiles">
          {SHOP_CATEGORIES.map((c) => (
            <Link key={c.key} to={`/products?category=${encodeURIComponent(c.key)}`} className="category-tile">
              <FadeImage src={c.image} alt="" loading="lazy" />
              <span className="category-caption">{c.label}</span>
            </Link>
          ))}
        </div>

        {featured.length > 0 && (
          <>
            <div className="section-title">
              <p className="eyebrow">{season.featuredEyebrow}</p>
              <h2>{season.featuredTitle}</h2>
            </div>
            <div className="product-grid">
              {featured.map((p) => (
                <ProductCard key={p.product_id} product={p} />
              ))}
            </div>
            <p className="center">
              <Link to={season.to} className="button">
                {season.cta}
              </Link>{' '}
              <Link to="/products" className="button button-ghost">
                Shop everything
              </Link>
            </p>
          </>
        )}
      </section>

      <section id="size-guide" className="size-section">
        <div className="page">
          <div className="section-title">
            <p className="eyebrow">Find your fit</p>
            <h2 id="size-guide-title">Size guide</h2>
          </div>
          <SizeGuide headingId="size-guide-title" />
        </div>
      </section>

      <section className="visit-band">
        <div>
          <p className="eyebrow">Come say hi</p>
          <h2>Stop by the shop on Broadway</h2>
          <p>
            We're at 57 Broadway in New Haven, right by campus. Can't make it in? Handsome Dan's chat in the corner can
            help you find the right fit.
          </p>
        </div>
        <div className="visit-actions">
          <button type="button" className="button button-light" onClick={openChat}>
            Chat with us
          </button>
          <a
            className="button button-outline"
            href="https://www.google.com/maps/search/?api=1&query=57+Broadway+New+Haven+CT"
            target="_blank"
            rel="noreferrer"
          >
            Get directions
          </a>
        </div>
      </section>
    </>
  )
}
