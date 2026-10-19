import { useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { GROUP_NAV_LABELS } from '../categories.ts'
import { useMerchGroups } from '../productCache.ts'

const CLOSE_DELAY_MS = 160 // time to move the pointer from a menu button into its panel

// Second header row: shop by residential college, sport, graduate school, or family.
// Each menu opens on hover (or tap/click), lists every option with its item count, and
// closes on Escape, a click elsewhere, or when the shopper picks something.
export default function GroupBar() {
  const menu = useMerchGroups()
  const location = useLocation()
  const [openKey, setOpenKey] = useState<string | null>(null)
  const closeTimer = useRef<number | undefined>(undefined)
  const barRef = useRef<HTMLElement>(null)

  // Close the menu whenever the page changes (e.g. after choosing an option).
  const [seenLocation, setSeenLocation] = useState(location.key)
  if (seenLocation !== location.key) {
    setSeenLocation(location.key)
    setOpenKey(null)
  }

  useEffect(() => {
    if (!openKey) return
    const onPointer = (e: MouseEvent) => {
      if (!barRef.current?.contains(e.target as Node)) setOpenKey(null)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenKey(null)
    }
    document.addEventListener('mousedown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [openKey])

  if (!menu) return <nav className="group-bar" aria-label="Shop by group" />

  const current = location.pathname === '/products' ? new URLSearchParams(location.search).get('group') : null
  const activeGroup = current?.split(':')[0] ?? null

  const open = (key: string) => {
    window.clearTimeout(closeTimer.current)
    setOpenKey(key)
  }
  const closeSoon = () => {
    window.clearTimeout(closeTimer.current)
    closeTimer.current = window.setTimeout(() => setOpenKey(null), CLOSE_DELAY_MS)
  }

  return (
    <nav ref={barRef} className="group-bar" aria-label="Shop by group">
      <ul>
        <li className="group-bar-label" aria-hidden="true">
          Shop by
        </li>
        {menu.map((group) => (
          <li key={group.key} className="group-menu" onMouseEnter={() => open(group.key)} onMouseLeave={closeSoon}>
            <button
              type="button"
              className={`group-trigger${activeGroup === group.key ? ' active' : ''}`}
              aria-expanded={openKey === group.key}
              aria-controls={`group-panel-${group.key}`}
              onClick={() => (openKey === group.key ? setOpenKey(null) : open(group.key))}
            >
              {GROUP_NAV_LABELS[group.key] ?? group.label}
              <span className="caret" aria-hidden="true">
                ▾
              </span>
            </button>
            {openKey === group.key && (
              <div id={`group-panel-${group.key}`} className={`group-panel group-panel-${group.key}`}>
                <Link to={`/products?group=${group.key}`} className="group-panel-all">
                  All {group.label}
                  <span className="group-count">{group.count}</span>
                </Link>
                <ul className="group-options">
                  {group.options.map((option) => (
                    <li key={option.key}>
                      <Link
                        to={`/products?group=${encodeURIComponent(option.key)}`}
                        className={current === option.key ? 'active' : undefined}
                      >
                        {option.label}
                        <span className="group-count">{option.count}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </li>
        ))}
      </ul>
    </nav>
  )
}
