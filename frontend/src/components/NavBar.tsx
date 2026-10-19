import { useState, type FormEvent } from 'react'
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth.ts'
import { openChat, SHOP_CATEGORIES } from '../categories.ts'
import { cartCount, useShop } from '../shop.ts'
import GroupBar from './GroupBar.tsx'

// Site header, in layers like a classic campus shop: a navy top bar, a white masthead
// (wordmark, search, account, wishlist, cart), a light category bar (garment types), and a
// second row to shop by college, sport, graduate school, or family (GroupBar).
export default function NavBar() {
  const { user, logout } = useAuth()
  const { state } = useShop()
  const navigate = useNavigate()
  const location = useLocation()
  const [query, setQuery] = useState('')
  const inCart = cartCount(state)
  const params = new URLSearchParams(location.search)
  const onShop = location.pathname === '/products'
  const activeCategory = onShop ? params.get('category') : null

  function search(event: FormEvent) {
    event.preventDefault()
    const q = query.trim()
    navigate(q ? `/products?${new URLSearchParams({ q })}` : '/products')
  }

  return (
    <header className="site-header">
      <div className="topbar">
        <div className="topbar-inner">
          <span>Officially licensed Yale apparel · 57 Broadway, New Haven</span>
          <span className="topbar-links">
            <Link to="/#size-guide">Size guide</Link>
            <button type="button" className="topbar-chat" onClick={openChat}>
              Chat with us
            </button>
          </span>
        </div>
      </div>

      <div className="masthead">
        <Link to="/" className="brand" aria-label="Campus Customs home">
          <span className="brand-mark">CC</span>
          <span className="brand-text">
            <span className="brand-name">Campus Customs</span>
            <span className="brand-sub">Yale · New Haven</span>
          </span>
        </Link>

        <form className="site-search" role="search" onSubmit={search}>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search hoodies, colleges, teams…"
            aria-label="Search products"
          />
          <button type="submit" aria-label="Search">
            Search
          </button>
        </form>

        <div className="masthead-links">
          {user ? (
            <>
              <span className="nav-greeting">Hi, {user.first_name}</span>
              <button type="button" className="link-quiet" onClick={logout}>
                Log out
              </button>
            </>
          ) : (
            <>
              <NavLink to="/login">Log in</NavLink>
              <NavLink to="/create-account">Create account</NavLink>
            </>
          )}
          <NavLink to="/wishlist" aria-label={`Wishlist, ${state.wishlist.length} items`}>
            ♡ Wishlist{state.wishlist.length > 0 && <span className="nav-count">{state.wishlist.length}</span>}
          </NavLink>
          <NavLink to="/cart" className="cart-link" aria-label={`Cart, ${inCart} items`}>
            Cart{inCart > 0 && <span className="nav-count">{inCart}</span>}
          </NavLink>
        </div>
      </div>

      <nav className="category-bar" aria-label="Shop">
        <ul>
          <li>
            <NavLink to="/" end>
              Home
            </NavLink>
          </li>
          <li>
            <Link
              to="/products"
              className={onShop && !activeCategory && !params.get('q') && !params.get('ids') && !params.get('group') ? 'active' : undefined}
            >
              Products
            </Link>
          </li>
          {SHOP_CATEGORIES.map((c) => (
            <li key={c.key}>
              <Link
                to={`/products?category=${encodeURIComponent(c.key)}`}
                className={activeCategory === c.key ? 'active' : undefined}
              >
                {c.label}
              </Link>
            </li>
          ))}
          <li>
            <NavLink to="/about">About us</NavLink>
          </li>
        </ul>
      </nav>

      <GroupBar />
    </header>
  )
}
