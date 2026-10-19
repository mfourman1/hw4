import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth.ts'
import ProductCard from '../components/ProductCard.tsx'
import ShareLinkPanel from '../components/ShareLinkPanel.tsx'
import { useShop } from '../shop.ts'
import { useProductDetails } from '../useProductDetails.ts'
import { useProducts } from '../useProducts.ts'
import { downloadWishlistPdf, isEmail, wishlistEmailLink } from '../wishlistShare.ts'

export default function Wishlist() {
  const { user } = useAuth()
  const { state } = useShop()
  const { products } = useProducts()
  const details = useProductDetails(state.wishlist)
  const [makingPdf, setMakingPdf] = useState(false)
  const [emailOpen, setEmailOpen] = useState(false)
  const [linkOpen, setLinkOpen] = useState(false)
  const [to, setTo] = useState('')
  const [note, setNote] = useState('')
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  const byId = new Map(products?.map((p) => [p.product_id, p]))
  const items = state.wishlist.flatMap((id) => byId.get(id) ?? [])
  const owner = user ? `${user.first_name} ${user.last_name}` : undefined

  async function handlePdf() {
    const full = state.wishlist.flatMap((id) => details[id] ?? [])
    if (full.length < items.length) return setMessage({ ok: false, text: 'Still loading product details. Try again in a moment.' })
    setMakingPdf(true)
    setMessage(null)
    try {
      await downloadWishlistPdf(full, owner)
      setMessage({ ok: true, text: 'Your wishlist PDF has been downloaded.' })
    } catch {
      setMessage({ ok: false, text: "Sorry, the PDF couldn't be made. Please try again." })
    } finally {
      setMakingPdf(false)
    }
  }

  function handleEmail(event: FormEvent) {
    event.preventDefault()
    if (!isEmail(to)) return setMessage({ ok: false, text: 'Enter a valid email address.' })
    window.location.href = wishlistEmailLink(to, note, items, owner)
    setMessage({ ok: true, text: 'Your email app should open with the list filled in. Review it and press send there.' })
  }

  return (
    <section className="page">
      <h1>Your wishlist</h1>
      {!user && (
        <p className="muted">
          You're browsing as a guest, so this list is saved on this device only.{' '}
          <Link to="/login">Log in</Link> to keep it on your account.
        </p>
      )}

      {items.length === 0 ? (
        <p>
          Nothing saved yet. Tap the ♡ on any product to keep it here. <Link to="/products">Browse products</Link>
        </p>
      ) : (
        <>
          <div className="share-bar">
            <span className="muted">{items.length} saved item{items.length === 1 ? '' : 's'}</span>
            <button
              type="button"
              className="button button-small"
              onClick={() => {
                setLinkOpen((o) => !o)
                setEmailOpen(false)
              }}
            >
              Share a link
            </button>
            <button type="button" className="button button-small button-ghost" onClick={handlePdf} disabled={makingPdf}>
              {makingPdf ? 'Making PDF…' : 'Download PDF'}
            </button>
            <button
              type="button"
              className="button button-small button-ghost"
              onClick={() => {
                setEmailOpen((o) => !o)
                setLinkOpen(false)
              }}
            >
              Email this list
            </button>
          </div>

          {linkOpen && (
            <ShareLinkPanel
              products={state.wishlist.flatMap((id) => details[id] ?? [])}
              designs={state.designs}
              defaultName={user?.first_name ?? ''}
            />
          )}

          {emailOpen && (
            <form className="form share-email" onSubmit={handleEmail}>
              <label>
                Send to
                <input type="email" value={to} onChange={(e) => setTo(e.target.value)} placeholder="friend@example.com" required />
              </label>
              <label>
                Add a note (optional)
                <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={300} />
              </label>
              <p className="hint">
                This opens your own email app with the list filled in, for you to review and send. Campus Customs
                never sends email for you.
              </p>
              <button type="submit" className="button button-small">
                Open in my email app
              </button>
            </form>
          )}

          {message && <p className={message.ok ? 'notice' : 'form-error'} role="status">{message.text}</p>}

          <div className="product-grid">
            {items.map((p) => (
              <ProductCard key={p.product_id} product={p} />
            ))}
          </div>
        </>
      )}
    </section>
  )
}
