import { Link, useSearchParams } from 'react-router-dom'
import type { ProductSummary } from '../api.ts'
import { categoryLabel, groupHeading, inGroup, SHOP_CATEGORIES } from '../categories.ts'
import ProductCard from '../components/ProductCard.tsx'
import { useMerchGroups } from '../productCache.ts'
import { useProducts } from '../useProducts.ts'

// Header search words that mean a kind of garment (the same idea as the chat's search in
// backend/tools.py), so "tees", "hoody", or "1/4 zip" find what the shopper means.
const GARMENT_WORDS: [RegExp, string][] = [
  [/\b(t[- ]?shirts?|tee[- ]?shirts?|tees?)\b/g, 't-shirt'],
  [/\b(hood(ie|y)s?|hoodies|hooded( sweat ?shirts?)?)\b/g, 'hoodie'],
  [/\bcrew[- ]?necks?\b/g, 'crewneck'],
  [/\b(quarter[- ]?zips?|1\/4[- ]?zips?)\b/g, 'quarter-zip'],
  [/\b(jackets?|coats?|fleeces?)\b/g, 'jacket'],
]
const STOPWORDS = new Set(['a', 'an', 'and', 'the', 'for', 'of', 'in', 'with', 'yale'])

function searchProducts(products: ProductSummary[], query: string) {
  let text = query.toLowerCase().replace(/\bgrey\b/g, 'gray')
  const kinds = new Set<string>()
  for (const [pattern, kind] of GARMENT_WORDS) {
    if (text.match(pattern)) {
      kinds.add(kind)
      text = text.replace(pattern, ' ')
    }
  }
  const words = text.split(/[^a-z0-9]+/).filter((w) => w.length > 1 && !STOPWORDS.has(w))
  return products.filter((p) => {
    if (kinds.size && !p.categories.some((c) => kinds.has(c))) return false
    const haystack = `${p.name} ${p.garment_type} ${p.short_description}`.toLowerCase()
    return words.every((w) => haystack.includes(w.replace(/s$/, '')))
  })
}

// Shows every product; one category (?category=hoodie); header search results (?q=navy);
// or, when the chat put search results on the page (?results=Hoodies&ids=a,b,c), just those
// products in the agent's order.
export default function Products() {
  const { products, error } = useProducts()
  const menu = useMerchGroups()
  const [params] = useSearchParams()
  const group = params.get('group')
  const chatIds = params.get('ids')?.split(',').filter(Boolean)
  const chatTitle = params.get('results')
  const category = params.get('category')
  const query = params.get('q')?.trim() ?? ''

  let shown: ProductSummary[] | null = products
  if (products && chatIds) {
    const byId = new Map(products.map((p) => [p.product_id, p]))
    shown = chatIds.flatMap((id) => byId.get(id) ?? [])
  } else if (products && group) {
    shown = products.filter((p) => inGroup(p.groups, group))
  } else if (products && category) {
    shown = products.filter((p) => p.categories.includes(category))
  } else if (products && query) {
    shown = searchProducts(products, query)
  }

  const heading = group ? groupHeading(menu, group) : null
  const groupKey = group?.split(':')[0]
  const groupOptions = menu?.find((m) => m.key === groupKey)?.options ?? []
  const title = chatIds
    ? chatTitle || 'Chat results'
    : heading
      ? heading.title
      : category
      ? categoryLabel(category) ?? 'Shop'
      : query
        ? `Results for “${query}”`
        : 'Products'

  return (
    <section className="page">
      {chatIds ? (
        <div className="results-banner">
          <div>
            <p className="eyebrow">From your chat search</p>
            <h1>{title}</h1>
          </div>
          <Link to="/products" className="button button-ghost">
            Show all products
          </Link>
        </div>
      ) : (
        <div className="shop-head">
          <p className="eyebrow">{heading?.eyebrow ?? (query ? 'Search' : 'Shop')}</p>
          <h1>{title}</h1>
          {group ? (
            <nav className="filter-chips" aria-label={heading?.eyebrow ?? 'Group'}>
              <Link to={`/products?group=${groupKey}`} className={group === groupKey ? 'active' : undefined}>
                All
              </Link>
              {groupOptions.map((o) => (
                <Link
                  key={o.key}
                  to={`/products?group=${encodeURIComponent(o.key)}`}
                  className={group === o.key ? 'active' : undefined}
                >
                  {o.label}
                </Link>
              ))}
            </nav>
          ) : (
            <nav className="filter-chips" aria-label="Categories">
              <Link to="/products" className={!category && !query && !group ? 'active' : undefined}>
                All
              </Link>
              {SHOP_CATEGORIES.map((c) => (
                <Link
                  key={c.key}
                  to={`/products?category=${encodeURIComponent(c.key)}`}
                  className={category === c.key ? 'active' : undefined}
                >
                  {c.label}
                </Link>
              ))}
            </nav>
          )}
        </div>
      )}
      {error && <p className="error">We couldn't load products. Is the backend running?</p>}
      {shown && (
        <div className="fade-swap">
          <p className="muted">
            {shown.length} {shown.length === 1 ? 'item' : 'items'}
          </p>
          {shown.length === 0 ? (
            <p>
              Nothing matched. Try fewer words, <Link to="/products">browse everything</Link>, or ask the chat in the
              corner.
            </p>
          ) : (
            <div className="product-grid">
              {shown.map((p) => (
                <ProductCard key={p.product_id} product={p} />
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  )
}
