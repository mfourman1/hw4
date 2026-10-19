// Hero photos are ones shot on a plain background; some catalogue photos are white in the
// middle with black bars at the sides, which look broken in the hero frame.
//
// The Home page follows the Yale calendar: the first hero slide and the featured products
// change with the time of year (move-in, Family Weekend, The Game, the holidays, winter,
// Bulldog Days, Commencement, summer). Dates are approximate windows, so the copy says
// "season", never a specific date. Add ?date=2026-11-20 to the Home page URL to preview
// another time of year.

import type { ProductSummary } from './api.ts'

export type Season = {
  key: string
  eyebrow: string
  title: string
  text: string
  cta: string
  to: string
  image: string
  featuredEyebrow: string
  featuredTitle: string
  // Products for this season, in order of preference (the first matches come first).
  picks: ((p: ProductSummary) => boolean)[]
}

const inGroup = (prefix: string) => (p: ProductSummary) => p.groups.some((g) => g.startsWith(prefix))
const isKind = (kind: string) => (p: ProductSummary) => p.categories.includes(kind)
const named = (word: string) => (p: ProductSummary) => p.name.toLowerCase().includes(word)

// [month (1-12), day] the season starts. Each runs until the next one starts.
const CALENDAR: { start: [number, number]; season: Season }[] = [
  {
    start: [1, 6],
    season: {
      key: 'winter',
      eyebrow: 'Winter on Old Campus',
      title: 'Layer up, Bulldogs',
      text: 'Fleece, jackets, and quarter-zips for the walk to class when the wind comes off the Sound.',
      cta: 'Shop jackets & fleece',
      to: '/products?category=jacket',
      image: '/images/products/champion-full-zip-hood.jpg',
      featuredEyebrow: 'For the cold months',
      featuredTitle: 'Warm layers',
      picks: [isKind('jacket'), isKind('fleece'), isKind('quarter-zip')],
    },
  },
  {
    start: [3, 21],
    season: {
      key: 'bulldog-days',
      eyebrow: 'Bulldog Days',
      title: 'Welcome, future Bulldogs',
      text: 'Admitted to Yale? Your first Yale tee is waiting on Broadway, and so is a college crest for next fall.',
      cta: 'Shop T-shirts',
      to: '/products?category=t-shirt',
      image: '/images/products/2025-yale-vs-harvard-t-shirt.jpg',
      featuredEyebrow: 'For admitted students',
      featuredTitle: 'Your first Yale gear',
      picks: [isKind('t-shirt'), isKind('hoodie')],
    },
  },
  {
    start: [5, 1],
    season: {
      key: 'commencement',
      eyebrow: 'Commencement season',
      title: 'Congratulations, graduates',
      text: 'Gear for every graduate and professional school, and for the families cheering them across the stage.',
      cta: 'Shop graduate schools',
      to: '/products?group=school',
      image: '/images/products/school-of-management-crest-t-shirt.jpg',
      featuredEyebrow: 'For graduates and their families',
      featuredTitle: 'Commencement gifts',
      picks: [inGroup('school:'), inGroup('family:')],
    },
  },
  {
    start: [6, 16],
    season: {
      key: 'summer',
      eyebrow: 'Summer in New Haven',
      title: 'Light layers for long days',
      text: 'Tees for summer on the Green, and a crewneck for the cool evenings.',
      cta: 'Shop T-shirts',
      to: '/products?category=t-shirt',
      image: '/images/products/2025-yale-vs-harvard-t-shirt.jpg',
      featuredEyebrow: 'For the summer',
      featuredTitle: 'Summer favorites',
      picks: [isKind('t-shirt'), isKind('crewneck')],
    },
  },
  {
    start: [8, 10],
    season: {
      key: 'move-in',
      eyebrow: 'Move-in season',
      title: 'Welcome home to your college',
      text: 'New to campus or coming back, find your residential college crest before the first college tea.',
      cta: 'Shop college gear',
      to: '/products?group=college',
      image: '/images/products/pierson-college-crewneck.jpg',
      featuredEyebrow: 'For move-in',
      featuredTitle: 'Rep your college',
      picks: [inGroup('college:')],
    },
  },
  {
    start: [9, 21],
    season: {
      key: 'family-weekend',
      eyebrow: 'Family Weekend season',
      title: 'Bring the whole family into the Yale fold',
      text: 'Yale Mom, Yale Dad, Grandpa, and the rest of the crew: gear for everyone who visits this fall.',
      cta: 'Shop family gear',
      to: '/products?group=family',
      image: '/images/products/yale-dad-t-shirt.jpg',
      featuredEyebrow: 'For Family Weekend',
      featuredTitle: 'Gear for the whole family',
      picks: [inGroup('family:')],
    },
  },
  {
    start: [11, 1],
    season: {
      key: 'the-game',
      eyebrow: 'The Game is coming',
      title: 'Beat Harvard',
      text: 'Yale vs. Harvard, the season’s biggest weekend. Get your game-day layers before kickoff.',
      cta: 'Shop game-day gear',
      to: '/products?group=sport:football',
      image: '/images/products/2025-yale-vs-harvard-t-shirt.jpg',
      featuredEyebrow: 'For The Game',
      featuredTitle: 'Game-day gear',
      picks: [named('harvard'), inGroup('sport:football'), isKind('hoodie')],
    },
  },
  {
    start: [12, 1],
    season: {
      key: 'holidays',
      eyebrow: 'Holiday gifts',
      title: 'Gifts for every Bulldog',
      text: 'Something blue for everyone on your list, with embroidery to make it theirs.',
      cta: 'Shop family gifts',
      to: '/products?group=family',
      image: '/images/products/champion-reverse-weave-hoodie-1.jpg',
      featuredEyebrow: 'For the holidays',
      featuredTitle: 'Gifts they’ll wear',
      picks: [inGroup('family:'), isKind('jacket'), isKind('quarter-zip')],
    },
  },
]

export function seasonFor(date: Date): Season {
  const today = (date.getMonth() + 1) * 100 + date.getDate()
  let current = CALENDAR[CALENDAR.length - 1].season // before Jan 6: still the holidays
  for (const { start, season } of CALENDAR) {
    if (today >= start[0] * 100 + start[1]) current = season
  }
  return current
}

// Today's season, or the one for ?date=YYYY-MM-DD (to preview another time of year).
export function currentSeason(search: string): Season {
  const preview = new URLSearchParams(search).get('date')
  const date = preview && /^\d{4}-\d{2}-\d{2}$/.test(preview) ? new Date(`${preview}T12:00:00`) : new Date()
  return seasonFor(Number.isNaN(date.getTime()) ? new Date() : date)
}

export function seasonPicks(season: Season, products: ProductSummary[], limit = 8): ProductSummary[] {
  const picked: ProductSummary[] = []
  for (const matches of season.picks) {
    for (const p of products) {
      if (picked.length >= limit) return picked
      if (matches(p) && !picked.includes(p)) picked.push(p)
    }
  }
  return picked
}
