import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import type { Season } from '../season.ts'
import FadeImage from './FadeImage.tsx'

type Slide = { eyebrow: string; title: string; text: string; cta: string; to: string; image: string }

const BASE_SLIDES: Slide[] = [
  {
    eyebrow: 'Built for New Haven winters',
    title: 'Bulldog spirit, layer by layer',
    text: 'Hoodies, crewnecks, and fleece made for cold walks across Old Campus and late nights at Sterling.',
    cta: 'Shop hoodies',
    to: '/products?category=hoodie',
    image: '/images/products/champion-reverse-weave-hoodie-1.jpg',
  },
  {
    eyebrow: 'Fourteen colleges, one Yale',
    title: 'Wear your college crest',
    text: 'Crewnecks, quarter-zips, and tees for your residential college, plus gear for every graduate school.',
    cta: 'Shop college gear',
    to: '/products?q=college',
    image: '/images/products/pierson-college-crewneck.jpg',
  },
  {
    eyebrow: 'Personalized on Broadway',
    title: 'Make it yours',
    text: 'Add your name, your class year, or your team to the chest or shoulder, then save the design for the whole family.',
    cta: 'Find something to embroider',
    to: '/products?category=quarter-zip',
    image: '/images/products/branford-1-4-zip.jpg',
  },
]

const SLIDE_MS = 6500
const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

// Slides cross-fade into each other. Auto-play pauses while the shopper hovers or uses the
// controls, and is off for people who ask their device for reduced motion.
// The first slide is the current Yale season's (season.ts), so the Home page changes with
// the calendar; the others are always there.
export default function HeroCarousel({ season }: { season: Season }) {
  const [index, setIndex] = useState(0)
  const [paused, setPaused] = useState(false)
  const SLIDES: Slide[] = [season, ...BASE_SLIDES]

  useEffect(() => {
    if (paused || prefersReducedMotion()) return
    const timer = window.setTimeout(() => setIndex((i) => (i + 1) % SLIDES.length), SLIDE_MS)
    return () => window.clearTimeout(timer)
  }, [index, paused, SLIDES.length])

  const go = (step: number) => setIndex((i) => (i + step + SLIDES.length) % SLIDES.length)

  return (
    <section
      className="hero"
      aria-roledescription="carousel"
      aria-label="Featured"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      {SLIDES.map((slide, i) => (
        <div
          key={slide.title}
          className={`hero-slide${i === index ? ' active' : ''}`}
          aria-hidden={i !== index}
          role="group"
          aria-roledescription="slide"
          aria-label={`${i + 1} of ${SLIDES.length}`}
        >
          <div className="hero-copy">
            <p className="eyebrow">{slide.eyebrow}</p>
            <h1>{slide.title}</h1>
            <p className="hero-text">{slide.text}</p>
            <Link to={slide.to} className="button button-light" tabIndex={i === index ? 0 : -1}>
              {slide.cta}
            </Link>
          </div>
          <div className="hero-art">
            <FadeImage src={slide.image} alt="" />
          </div>
        </div>
      ))}
      <div className="hero-controls">
        <button type="button" onClick={() => go(-1)} aria-label="Previous slide">
          ‹
        </button>
        {SLIDES.map((slide, i) => (
          <button
            key={slide.title}
            type="button"
            className={`hero-dot${i === index ? ' active' : ''}`}
            onClick={() => setIndex(i)}
            aria-label={`Show slide ${i + 1}: ${slide.title}`}
            aria-current={i === index}
          />
        ))}
        <button type="button" onClick={() => go(1)} aria-label="Next slide">
          ›
        </button>
      </div>
    </section>
  )
}
