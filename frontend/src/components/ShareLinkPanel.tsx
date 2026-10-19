import { useState, type FormEvent } from 'react'
import { createWishlistShare, type ProductDetail, type SharedItem } from '../api.ts'
import { LOCATION_LABELS, type EmbroideryDesign } from '../shop.ts'

// "Share a link": the shopper picks their size (and, if they like, a saved embroidery design)
// for each item, and gets a link that family and friends can open to add those exact items
// to their own cart. The link is a snapshot of the list; share again after changing it.
export default function ShareLinkPanel({
  products,
  designs,
  defaultName,
}: {
  products: ProductDetail[]
  designs: EmbroideryDesign[]
  defaultName: string
}) {
  const [name, setName] = useState(defaultName)
  const [note, setNote] = useState('')
  const [sizes, setSizes] = useState<Record<string, string>>({})
  const [designFor, setDesignFor] = useState<Record<string, string>>({})
  const [creating, setCreating] = useState(false)
  const [link, setLink] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  // One size for everything, applied to each item that's made in it.
  function sameSizeForAll(size: string) {
    setSizes(Object.fromEntries(products.map((p) => [p.product_id, p.sizes.some((s) => s.size === size) ? size : ''])))
    setLink(null)
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setCreating(true)
    setError(null)
    try {
      const items: SharedItem[] = products.map((p) => {
        const design = designs.find((d) => d.id === designFor[p.product_id])
        const offered = design && p.embroidery_options.some((o) => o.location === design.location)
        return {
          product_id: p.product_id,
          size: sizes[p.product_id] || null,
          embroidery: offered ? { text: design.text, location: design.location, thread_color: design.thread_color } : null,
        }
      })
      const share = await createWishlistShare({ owner_name: name.trim() || null, note: note.trim() || null, items })
      setLink(`${window.location.origin}${share.path}`)
      setCopied(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sorry, the link couldn't be made. Please try again.")
    } finally {
      setCreating(false)
    }
  }

  async function copy() {
    if (!link) return
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
    } catch {
      setError('Copy the link from the box above.')
    }
  }

  async function shareLink() {
    if (!link) return
    try {
      await navigator.share({ title: 'My Campus Customs wishlist', text: note.trim() || 'Here’s my Yale wishlist, with my sizes:', url: link })
    } catch {
      // The shopper closed the share sheet.
    }
  }

  const allSizes = [...new Set(products.flatMap((p) => p.sizes.map((s) => s.size)))]

  return (
    <form className="form share-link fade-swap" onSubmit={handleSubmit}>
      <p className="hint">
        Add your size to each item, and family and friends can open the link and add your exact picks to their own cart.
        Only your name and note below are shared, never your email or account.
      </p>
      <div className="share-link-fields">
        <label>
          Your name on the list
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={50} placeholder="e.g. Sam" />
        </label>
        <label>
          Same size for everything
          <select value="" onChange={(e) => e.target.value && sameSizeForAll(e.target.value)}>
            <option value="">Choose…</option>
            {allSizes.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
      </div>
      <ul className="share-items">
        {products.map((p) => (
          <li key={p.product_id}>
            <img src={p.image_url} alt="" />
            <span className="share-item-name">{p.name}</span>
            <select
              value={sizes[p.product_id] ?? ''}
              onChange={(e) => {
                setSizes((s) => ({ ...s, [p.product_id]: e.target.value }))
                setLink(null)
              }}
              aria-label={`Your size for ${p.name}`}
            >
              <option value="">My size: not set</option>
              {p.sizes.map((s) => (
                <option key={s.size} value={s.size}>
                  My size: {s.size}
                </option>
              ))}
            </select>
            {p.embroidery_options.length > 0 && designs.length > 0 && (
              <select
                value={designFor[p.product_id] ?? ''}
                onChange={(e) => {
                  setDesignFor((d) => ({ ...d, [p.product_id]: e.target.value }))
                  setLink(null)
                }}
                aria-label={`Embroidery for ${p.name}`}
              >
                <option value="">No embroidery</option>
                {designs
                  .filter((d) => p.embroidery_options.some((o) => o.location === d.location))
                  .map((d) => (
                    <option key={d.id} value={d.id}>
                      “{d.text}”, {LOCATION_LABELS[d.location].toLowerCase()}
                    </option>
                  ))}
              </select>
            )}
          </li>
        ))}
      </ul>
      <label>
        Add a note (optional)
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={300} placeholder="e.g. For my birthday! Any of these would be great." />
      </label>
      <button type="submit" className="button button-small" disabled={creating}>
        {creating ? 'Making link…' : link ? 'Make a new link' : 'Make my link'}
      </button>
      {error && <p className="form-error" role="alert">{error}</p>}
      {link && (
        <div className="share-result fade-swap" role="status">
          <input readOnly value={link} onFocus={(e) => e.target.select()} aria-label="Your wishlist link" />
          <div className="share-result-actions">
            <button type="button" className="button button-small" onClick={copy}>
              {copied ? 'Copied!' : 'Copy link'}
            </button>
            {typeof navigator.share === 'function' && (
              <button type="button" className="button button-small button-ghost" onClick={shareLink}>
                Share…
              </button>
            )}
            <a
              className="button button-small button-ghost"
              href={`mailto:?subject=${encodeURIComponent('My Campus Customs wishlist')}&body=${encodeURIComponent(`${note.trim() ? `${note.trim()}\n\n` : ''}Here's my Yale wishlist, with my sizes:\n${link}`)}`}
            >
              Email it
            </a>
          </div>
          <p className="hint">This link shows the list as it is now. If you change your wishlist, make a new link.</p>
        </div>
      )}
    </form>
  )
}
