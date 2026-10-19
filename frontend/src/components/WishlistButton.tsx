import { useState, type MouseEvent } from 'react'
import { useShop } from '../shop.ts'

// Heart toggle for the wishlist. `compact` is the small heart on product cards.
export default function WishlistButton({ productId, compact = false }: { productId: string; compact?: boolean }) {
  const { inWishlist, toggleWishlist } = useShop()
  const [error, setError] = useState('')
  const saved = inWishlist(productId)

  async function handleClick(event: MouseEvent) {
    event.preventDefault() // cards are links; don't open the product
    setError('')
    try {
      await toggleWishlist(productId)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update your wishlist.')
    }
  }

  const label = saved ? 'Remove from wishlist' : 'Save to wishlist'
  return (
    <>
      <button
        type="button"
        className={`wishlist-button${compact ? ' compact' : ''}${saved ? ' saved' : ''}`}
        onClick={handleClick}
        aria-pressed={saved}
        aria-label={label}
        title={error || label}
      >
        <span aria-hidden="true">{saved ? '♥' : '♡'}</span>
        {!compact && (saved ? ' In your wishlist' : ' Save to wishlist')}
      </button>
      {error && !compact && <p className="form-error">{error}</p>}
    </>
  )
}
