import { groupHeading } from '../categories.ts'
import { useMerchGroups, useProducts } from '../productCache.ts'
import type { ProductSummary } from '../api.ts'
import ProductCard from './ProductCard.tsx'

// "Complete the look" on a product page: other items for the same college, team, school, or
// family member first, favoring a different kind of garment (a crewneck suggests the matching
// tee), then gear from the same kind of group (other college crests) or with the same name
// (Champion Reverse Weave), so one purchase can become an outfit. Built from the cached list.

const MAIN_KINDS = ['hoodie', 'quarter-zip', 'crewneck', 't-shirt', 'jacket', 'long-sleeve']
const COMMON_WORDS = new Set(['yale', 't', 'shirt', 'tee', 'crewneck', 'hoodie', 'zip', '1', '4', 'jacket', 'fleece', 'sweater', 'college', 'school', 'of', 'the', 'left', 'chest', 'and', 'vs'])

const mainKind = (categories: string[]) => MAIN_KINDS.find((k) => categories.includes(k)) ?? null
const nameWords = (name: string) => new Set(name.toLowerCase().match(/[a-z0-9]+/g)?.filter((w) => !COMMON_WORDS.has(w)) ?? [])

function completeTheLook(product: { product_id: string; name: string; categories: string[]; groups: string[] }, all: ProductSummary[], limit = 4) {
  const kind = mainKind(product.categories)
  const words = nameWords(product.name)
  const groupTypes = new Set(product.groups.map((g) => g.split(':')[0]))
  const seen = new Set<string>()
  return all
    .filter((p) => p.product_id !== product.product_id)
    .map((p) => {
      const shared = p.groups.filter((g) => product.groups.includes(g)).length
      // Same kind of group (another residential college, another sport): a lighter match.
      const sameKindOfGroup = p.groups.some((g) => groupTypes.has(g.split(':')[0]))
      const differentKind = mainKind(p.categories) !== kind
      const commonWords = [...nameWords(p.name)].filter((w) => words.has(w)).length
      return { p, score: shared * 3 + (sameKindOfGroup ? 1 : 0) + (differentKind ? 1 : 0) + commonWords }
    })
    .filter((s) => s.score >= 2)
    .sort((a, b) => b.score - a.score || a.p.name.localeCompare(b.p.name))
    .filter((s) => {
      // At most one item from each other college, team, or school, so the row has variety.
      const other = s.p.groups.find((g) => !product.groups.includes(g))
      if (!other || s.p.groups.some((g) => product.groups.includes(g))) return true
      if (seen.has(other)) return false
      seen.add(other)
      return true
    })
    .slice(0, limit)
    .map((s) => s.p)
}

export default function CompleteTheLook({ product }: { product: { product_id: string; name: string; categories: string[]; groups: string[] } }) {
  const { products } = useProducts()
  const menu = useMerchGroups()
  if (!products) return null
  const picks = completeTheLook(product, products)
  if (picks.length === 0) return null
  const group = product.groups.find((g) => picks.some((p) => p.groups.includes(g)))
  return (
    <section className="complete-look fade-swap" aria-labelledby="complete-look-title">
      <div className="section-title">
        <p className="eyebrow">{group ? `More ${groupHeading(menu, group).title}` : 'Pairs well with'}</p>
        <h2 id="complete-look-title">Complete the look</h2>
      </div>
      <div className="product-grid">
        {picks.map((p) => (
          <ProductCard key={p.product_id} product={p} />
        ))}
      </div>
    </section>
  )
}
