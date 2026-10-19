import { useEffect } from 'react'
import { Link, Route, Routes, useLocation } from 'react-router-dom'
import NavBar from './components/NavBar.tsx'
import ChatWidget from './components/ChatWidget.tsx'
import SiteFooter from './components/SiteFooter.tsx'
import Home from './pages/Home.tsx'
import Products from './pages/Products.tsx'
import ProductDetail from './pages/ProductDetail.tsx'
import About from './pages/About.tsx'
import Login from './pages/Login.tsx'
import CreateAccount from './pages/CreateAccount.tsx'
import Wishlist from './pages/Wishlist.tsx'
import SharedWishlist from './pages/SharedWishlist.tsx'
import Cart from './pages/Cart.tsx'

// On a new page, start at the top, unless the link points to a section (e.g. /#size-guide),
// in which case glide to that section.
function ScrollManager() {
  const { pathname, hash } = useLocation()
  useEffect(() => {
    if (hash) {
      const target = document.getElementById(hash.slice(1))
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'start' })
        return
      }
    }
    window.scrollTo({ top: 0, behavior: 'instant' })
  }, [pathname, hash])
  return null
}

function NotFound() {
  return (
    <section className="page narrow">
      <h1>Page not found</h1>
      <p>
        That page doesn't exist. <Link to="/products">Browse our products</Link> instead.
      </p>
    </section>
  )
}

export default function App() {
  const location = useLocation()
  return (
    <>
      <ScrollManager />
      <NavBar />
      {/* The key makes each page fade in when it opens; header, footer, and chat stay put,
          so moving around feels like one continuous page. */}
      <main key={location.pathname + location.search} className="page-fade">
        <Routes location={location}>
          <Route path="/" element={<Home />} />
          <Route path="/products" element={<Products />} />
          <Route path="/products/:productId" element={<ProductDetail />} />
          <Route path="/about" element={<About />} />
          <Route path="/login" element={<Login />} />
          <Route path="/create-account" element={<CreateAccount />} />
          <Route path="/wishlist" element={<Wishlist />} />
          <Route path="/wishlist/shared/:token" element={<SharedWishlist />} />
          <Route path="/cart" element={<Cart />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>
      <SiteFooter />
      <ChatWidget />
    </>
  )
}
