import { Link } from 'react-router-dom'
import { openChat, SHOP_CATEGORIES } from '../categories.ts'

export default function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="footer-inner">
        <div>
          <p className="footer-brand">Campus Customs</p>
          <p>Officially licensed Yale apparel, personalized in New Haven.</p>
          <p>57 Broadway, New Haven, CT</p>
        </div>
        <div>
          <p className="footer-heading">Shop</p>
          <ul>
            <li>
              <Link to="/products">Products</Link>
            </li>
            {SHOP_CATEGORIES.map((c) => (
              <li key={c.key}>
                <Link to={`/products?category=${encodeURIComponent(c.key)}`}>{c.label}</Link>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <p className="footer-heading">Help</p>
          <ul>
            <li>
              <Link to="/#size-guide">Size guide</Link>
            </li>
            <li>
              <button type="button" className="link-quiet" onClick={openChat}>
                Chat with us
              </button>
            </li>
            <li>
              <Link to="/wishlist">Wishlist</Link>
            </li>
            <li>
              <Link to="/cart">Cart</Link>
            </li>
          </ul>
        </div>
        <div>
          <p className="footer-heading">Campus Customs</p>
          <ul>
            <li>
              <Link to="/about">About us</Link>
            </li>
            <li>
              <Link to="/login">Log in</Link>
            </li>
            <li>
              <Link to="/create-account">Create account</Link>
            </li>
          </ul>
        </div>
      </div>
      <p className="footer-legal">© Campus Customs · Boola Boola</p>
    </footer>
  )
}
