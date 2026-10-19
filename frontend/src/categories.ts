// Shop categories, used by the nav bar, the Home page tiles, and the Shop page filters.
// `key` matches the `categories` the backend gives each product (tools.garment_categories).

export type ShopCategory = { key: string; label: string; image: string }

export const SHOP_CATEGORIES: ShopCategory[] = [
  { key: 'hoodie', label: 'Hoodies', image: '/images/products/champion-reverse-weave-hoodie-1.jpg' },
  { key: 'crewneck', label: 'Crewnecks', image: '/images/products/champion-reverse-weave-crewneck.jpg' },
  { key: 't-shirt', label: 'T-Shirts', image: '/images/products/2025-yale-vs-harvard-t-shirt.jpg' },
  { key: 'quarter-zip', label: 'Quarter-Zips', image: '/images/products/benjamin-franklin-1-4-zip.jpg' },
  { key: 'jacket', label: 'Jackets & Fleece', image: '/images/products/saybrook-sweater-fleece-jacket.jpg' },
]

export function categoryLabel(key: string | null) {
  return SHOP_CATEGORIES.find((c) => c.key === key)?.label ?? null
}

// Anywhere on the site can open the chat (e.g. "Chat with us" in the top bar).
export const OPEN_CHAT_EVENT = 'campus-customs:open-chat'
export function openChat() {
  window.dispatchEvent(new Event(OPEN_CHAT_EVENT))
}

// Which size chart a product uses (see SizeGuide).
export type ProductKind = 'tee' | 'sweatshirt' | 'jacket'

export function productKind(categories: string[]): ProductKind {
  if (categories.includes('t-shirt') || categories.includes('long-sleeve')) return 'tee'
  if (categories.includes('jacket') || categories.includes('fleece')) return 'jacket'
  return 'sweatshirt'
}

// The header's second row: merchandise groups (data from GET /api/groups).
export const GROUP_NAV_LABELS: Record<string, string> = {
  college: 'Colleges',
  sport: 'Sports',
  school: 'Graduate Schools',
  family: 'Parents & Family',
}

// Page heading for /products?group=college or ?group=college:pierson.
export function groupHeading(menu: { key: string; label: string; options: { key: string; label: string }[] }[] | null, key: string) {
  const [group, option] = key.split(':')
  const menuGroup = menu?.find((m) => m.key === group)
  const groupLabel = menuGroup?.label ?? GROUP_NAV_LABELS[group] ?? 'Shop'
  if (!option) return { eyebrow: 'Shop by', title: groupLabel }
  const label = menuGroup?.options.find((o) => o.key === key)?.label ?? option
  const title = group === 'college' ? `${label} College` : group === 'sport' || group === 'family' ? `Yale ${label}` : label
  return { eyebrow: groupLabel, title }
}

export function inGroup(productGroups: string[], key: string) {
  return key.includes(':') ? productGroups.includes(key) : productGroups.some((g) => g.startsWith(`${key}:`))
}
