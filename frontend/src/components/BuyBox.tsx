import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { checkEmbroideryText, describeColorway, formatPrice, type EmbroideryLocation, type ProductDetail } from '../api.ts'
import {
  cleanEmbroideryText,
  EMBROIDERY_MAX_CHARS,
  embroideryError,
  LOCATION_LABELS,
  MAX_CART_QUANTITY,
  THREAD_SWATCHES,
  hardToSee,
  threadName,
  useShop,
  type Embroidery,
  type EmbroideryDesign,
} from '../shop.ts'
import InStockAlternatives from './InStockAlternatives.tsx'
import WishlistButton from './WishlistButton.tsx'

const LOW_STOCK = 5

// Swatch colors for the catalogue's main garment colors.
const COLOR_SWATCHES: Record<string, string> = {
  navy: '#1f2a44',
  'navy blue': '#1f2a44',
  'heather gray': '#b9bbbf',
  'charcoal gray': '#4a4d52',
  'dark heather gray': '#5d6066',
  'dark heather charcoal': '#3f4246',
  'heather charcoal gray': '#55585d',
  gray: '#9a9ea6',
  'light gray': '#d3d5d8',
  cream: '#f2ead7',
  ivory: '#fbf7ea',
  white: '#ffffff',
  'dusty coral': '#e3a08f',
}

// Required choices, in the order they appear on the page.
type Field = 'color' | 'size' | 'text' | 'thread'
const FIELD_ORDER: Field[] = ['color', 'size', 'text', 'thread']
const TO_DO: Record<Field, string> = {
  color: 'choose the color',
  size: 'choose a size',
  text: 'fix the embroidery text',
  thread: 'choose a thread color',
}

function stockLabel(quantity: number) {
  if (quantity === 0) return 'Sold out'
  if (quantity <= LOW_STOCK) return `Only ${quantity} left`
  return `${quantity} in stock`
}

function listJoin(items: string[]) {
  return items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`
}

type Props = {
  product: ProductDetail
  onSizeGuide?: () => void
  // The embroidery being designed, for the live preview on the product photo.
  onPreview?: (embroidery: Embroidery | null) => void
}

// Color, size (one item, or a group order of many sizes), optional embroidery, Add to cart,
// and Save to wishlist for one product.
export default function BuyBox({ product, onSizeGuide, onPreview }: Props) {
  const { state, addToCart, addGroupOrder, deleteDesign } = useShop()
  const options = product.embroidery_options
  // One color (every product today): selected automatically. Several: the shopper picks.
  const singleColor = product.color_options.length === 1
  const [color, setColor] = useState<string | null>(singleColor ? product.color_options[0] : null)
  const [group, setGroup] = useState(false) // a group order: how many of each size
  const [size, setSize] = useState<string | null>(null)
  const [quantity, setQuantity] = useState(1)
  const [groupQty, setGroupQty] = useState<Record<string, number>>({})
  const [embroider, setEmbroider] = useState(false)
  const [text, setText] = useState('')
  const [location, setLocation] = useState<EmbroideryLocation | null>(options[0]?.location ?? null)
  const [threadColor, setThreadColor] = useState<string | null>(null)
  const [saveDesign, setSaveDesign] = useState(true)
  const [triedToAdd, setTriedToAdd] = useState(false)
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null)
  const [adding, setAdding] = useState(false)
  // Text the backend refused (safety rule 12), and why; cleared once the text changes.
  const [refused, setRefused] = useState<{ text: string; problem: string } | null>(null)
  const colorRef = useRef<HTMLDivElement>(null)
  const sizeRef = useRef<HTMLDivElement>(null)
  const textRef = useRef<HTMLDivElement>(null)
  const threadRef = useRef<HTMLDivElement>(null)

  const stock = product.sizes.find((s) => s.size === size)?.quantity ?? 0
  const maxQuantity = Math.min(MAX_CART_QUANTITY, stock)
  const allowed = new Set(options.map((o) => o.location))
  const groupLines = product.sizes.filter((s) => (groupQty[s.size] ?? 0) > 0)
  const groupTotal = groupLines.reduce((sum, s) => sum + groupQty[s.size], 0)

  // Show the design on the product photo as it's typed.
  const previewText = embroider ? cleanEmbroideryText(text) : ''
  useEffect(() => {
    onPreview?.(previewText && location ? { text: previewText, location, thread_color: threadColor } : null)
  }, [onPreview, previewText, location, threadColor])

  // What's still missing. Shown (highlighted) only after the shopper tries to add to cart,
  // and each highlight clears as soon as that choice is made.
  const missing: Partial<Record<Field, string>> = {}
  if (!color) missing.color = 'Choose the color to continue.'
  if (group) {
    if (groupTotal === 0) missing.size = 'Enter how many you need in at least one size.'
  } else if (!size) {
    missing.size = 'Choose a size.'
  } else if (stock === 0) {
    missing.size = `Size ${size} is sold out. Choose another size, or one of the similar items below.`
  }
  if (embroider) {
    const problem = embroideryError(text) ?? (refused?.text === cleanEmbroideryText(text) ? refused.problem : null)
    if (problem) missing.text = problem
    if (!threadColor) missing.thread = 'Choose a thread color.'
  }
  const missingFields = FIELD_ORDER.filter((f) => missing[f])
  const shown = triedToAdd ? missing : {}

  function chooseSize(next: string) {
    setSize(next)
    const nextStock = product.sizes.find((s) => s.size === next)?.quantity ?? 0
    setQuantity((q) => Math.max(1, Math.min(q, nextStock, MAX_CART_QUANTITY)))
    setStatus(null)
  }

  function setGroupSize(sizeCode: string, value: number, max: number) {
    const n = Number.isFinite(value) ? Math.max(0, Math.min(Math.floor(value), max)) : 0
    setGroupQty((current) => ({ ...current, [sizeCode]: n }))
    setStatus(null)
  }

  function switchMode(toGroup: boolean) {
    setGroup(toGroup)
    setTriedToAdd(false)
    setStatus(null)
  }

  function applyDesign(design: EmbroideryDesign) {
    setEmbroider(true)
    setText(design.text)
    // A saved design keeps its spot when this product offers it.
    if (allowed.has(design.location)) setLocation(design.location)
    if (design.thread_color) setThreadColor(design.thread_color)
    setStatus(null)
  }

  function showMissing(field: Field) {
    setTriedToAdd(true)
    const refs = { color: colorRef, size: sizeRef, text: textRef, thread: threadRef }
    const first = refs[field].current
    first?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    first?.querySelector<HTMLElement>('button:not(:disabled), input')?.focus({ preventScroll: true })
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setStatus(null)
    if (missingFields.length > 0 || !color || (!group && !size)) {
      showMissing(missingFields[0])
      return
    }
    if (embroider) {
      // Safety rule 12: the shop checks the wording before it goes on a garment.
      const clean = cleanEmbroideryText(text)
      try {
        const check = await checkEmbroideryText(clean)
        if (!check.ok) {
          setRefused({ text: clean, problem: check.problem ?? 'Please choose different wording.' })
          showMissing('text')
          return
        }
      } catch {
        setStatus({ ok: false, text: "We couldn't check the embroidery text just now. Please try again." })
        return
      }
    }
    const embroidery: Embroidery | null =
      embroider && location ? { text: cleanEmbroideryText(text), location, thread_color: threadColor } : null
    setAdding(true)
    try {
      if (group) {
        await addGroupOrder({
          product_id: product.product_id,
          color,
          sizes: groupLines.map((s) => ({ size: s.size, quantity: groupQty[s.size], stock: s.quantity })),
          embroidery,
          save_design: saveDesign,
        })
        setStatus({
          ok: true,
          text: `Added ${groupTotal} pieces in ${groupLines.length} size${groupLines.length === 1 ? '' : 's'} to your cart.`,
        })
        setGroupQty({})
      } else if (size) {
        await addToCart({ product_id: product.product_id, size, color, quantity, embroidery, save_design: saveDesign, stock })
        setStatus({ ok: true, text: `Added ${quantity} × size ${size} to your cart.` })
      }
      setTriedToAdd(false)
    } catch (err) {
      setStatus({ ok: false, text: err instanceof Error ? err.message : 'Could not add to cart.' })
    } finally {
      setAdding(false)
    }
  }

  const each = product.price + (embroider ? product.embroidery_price : 0)
  const groupClass = (field: Field, extra = '') => `field-group${extra}${shown[field] ? ' has-error' : ''}`
  const buttonText = group
    ? groupTotal > 0
      ? `Add ${groupTotal} piece${groupTotal === 1 ? '' : 's'} to cart · ${formatPrice(each * groupTotal)}`
      : 'Add group order to cart'
    : `Add to cart · ${formatPrice(each * quantity)}`

  return (
    <form className="buy-box" onSubmit={handleSubmit} noValidate>
      <div ref={colorRef} className={groupClass('color')}>
        <h2 id="color-label">
          Color <span className="required">required</span>
        </h2>
        <div className="choice-row" role="radiogroup" aria-labelledby="color-label">
          {product.color_options.map((option) => (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={color === option}
              className={`swatch-option${color === option ? ' selected' : ''}`}
              onClick={() => {
                setColor(option)
                setStatus(null)
              }}
            >
              <span className="swatch" style={{ background: COLOR_SWATCHES[option] ?? '#ccc' }} />
              <span className="capitalize">{option}</span>
            </button>
          ))}
        </div>
        <p className="hint">
          {singleColor
            ? `This item comes in one color, selected for you: ${describeColorway(product)}.`
            : 'Choose a color.'}
        </p>
        {shown.color && <p className="field-error">{shown.color}</p>}
      </div>

      <div ref={sizeRef} className={groupClass('size')}>
        <div className="label-row">
          <h2 id="size-label">
            {group ? 'Sizes' : 'Size'} <span className="required">required</span>
          </h2>
          {onSizeGuide && (
            <button type="button" className="link-button" onClick={onSizeGuide}>
              Size guide
            </button>
          )}
        </div>
        <div className="segmented order-mode" role="tablist" aria-label="Order type">
          <button type="button" role="tab" aria-selected={!group} className={!group ? 'active' : ''} onClick={() => switchMode(false)}>
            One item
          </button>
          <button type="button" role="tab" aria-selected={group} className={group ? 'active' : ''} onClick={() => switchMode(true)}>
            Group order
          </button>
        </div>

        {group ? (
          <div className="fade-swap">
            <p className="hint">
              For teams, clubs, and college events: enter how many of each size you need. Every piece gets the same color
              {options.length > 0 ? ' and the same embroidery' : ''}.
            </p>
            <div className="group-sizes" role="group" aria-labelledby="size-label">
              {product.sizes.map((s) => (
                <label key={s.size} className={`group-size${s.quantity === 0 ? ' sold-out' : ''}`}>
                  <strong>{s.size}</strong>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={s.quantity}
                    value={groupQty[s.size] ?? 0}
                    disabled={s.quantity === 0}
                    onChange={(e) => setGroupSize(s.size, e.target.valueAsNumber, s.quantity)}
                    onFocus={(e) => e.target.select()}
                    aria-label={`How many in size ${s.size}`}
                  />
                  <span>{stockLabel(s.quantity)}</span>
                </label>
              ))}
            </div>
            {groupTotal > 0 && (
              <p className="group-total" role="status">
                {groupTotal} piece{groupTotal === 1 ? '' : 's'}: {groupLines.map((s) => `${s.size} × ${groupQty[s.size]}`).join(', ')}
              </p>
            )}
          </div>
        ) : (
          <div className="fade-swap">
            <div className="sizes" role="radiogroup" aria-labelledby="size-label">
              {product.sizes.map((s) => (
                <button
                  key={s.size}
                  type="button"
                  role="radio"
                  aria-checked={size === s.size}
                  className={`size-option${size === s.size ? ' selected' : ''}${s.quantity === 0 ? ' sold-out' : ''}`}
                  onClick={() => chooseSize(s.size)}
                >
                  <strong>{s.size}</strong>
                  <span>{stockLabel(s.quantity)}</span>
                </button>
              ))}
            </div>
            {/* A sold-out size can still be picked, to see similar items that have it. */}
            {size && stock === 0 && <InStockAlternatives productId={product.product_id} size={size} />}
          </div>
        )}
        {shown.size && <p className="field-error">{shown.size}</p>}
        <p className="muted">{product.total_in_stock} total in stock</p>
      </div>

      {options.length > 0 ? (
        <fieldset className="embroidery">
          <label className="check">
            <input type="checkbox" checked={embroider} onChange={(e) => setEmbroider(e.target.checked)} />
            Add custom embroidery (+{formatPrice(product.embroidery_price)} per item)
          </label>

          {embroider && (
            <>
              {state.designs.length > 0 && (
                <div className="saved-designs">
                  <span className="hint">Your saved designs:</span>
                  {state.designs.map((d) => (
                    <span key={d.id} className="design-chip">
                      <button type="button" onClick={() => applyDesign(d)} title="Use this design">
                        “{d.text}” · {LOCATION_LABELS[d.location]}
                        {d.thread_color && ` · ${d.thread_color} thread`}
                      </button>
                      <button type="button" className="chip-remove" onClick={() => deleteDesign(d.id)} aria-label={`Delete design ${d.text}`}>
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <div ref={textRef} className={groupClass('text')}>
                <label>
                  <span>
                    Text <span className="required">required</span>
                  </span>
                  <input
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    maxLength={EMBROIDERY_MAX_CHARS}
                    placeholder="e.g. Class of 2027"
                    aria-invalid={Boolean(shown.text)}
                  />
                  <span className="hint">
                    {cleanEmbroideryText(text).length}/{EMBROIDERY_MAX_CHARS} characters. Letters, numbers, spaces, &amp; ' . ! # -
                    {previewText && ' · Previewed on the photo.'}
                  </span>
                </label>
                {shown.text && <p className="field-error">{shown.text}</p>}
              </div>
              <div className="locations" role="radiogroup" aria-label="Embroidery location">
                {options.map((o) => (
                  <label key={o.location} className="check">
                    <input
                      type="radio"
                      name="embroidery-location"
                      checked={location === o.location}
                      onChange={() => setLocation(o.location)}
                    />
                    {o.label}
                  </label>
                ))}
              </div>
              <div ref={threadRef} className={groupClass('thread')}>
                <span className="field-label" id="thread-label">
                  Thread color <span className="required">required</span>
                </span>
                <div className="choice-row" role="radiogroup" aria-labelledby="thread-label">
                  {product.thread_colors.map((c) => (
                    <button
                      key={c}
                      type="button"
                      role="radio"
                      aria-checked={threadColor === c}
                      className={`swatch-option small${threadColor === c ? ' selected' : ''}`}
                      onClick={() => setThreadColor(c)}
                    >
                      <span className="swatch" style={{ background: THREAD_SWATCHES[c] ?? '#ccc' }} />
                      {c}
                    </button>
                  ))}
                </div>
                {shown.thread && <p className="field-error">{shown.thread}</p>}
                {embroider && hardToSee(color, threadColor) && (
                  <p className="field-warning" role="note">
                    Heads up: {threadName(threadColor ?? '')} thread on a {color} garment may be hard to see. White or
                    gold thread stands out best on dark fabric. You can still add it if you like a subtle look.
                  </p>
                )}
              </div>
              <label className="check">
                <input type="checkbox" checked={saveDesign} onChange={(e) => setSaveDesign(e.target.checked)} />
                Save this design to use on other garments
              </label>
            </>
          )}
        </fieldset>
      ) : (
        <p className="muted">Embroidery isn't offered on this item because of its large front design.</p>
      )}

      <div className="buy-row">
        {!group && (
          <label className="quantity">
            Qty
            <select value={quantity} onChange={(e) => setQuantity(Number(e.target.value))} disabled={!size || stock === 0}>
              {Array.from({ length: Math.max(maxQuantity, 1) }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
        )}
        <button type="submit" className="button" disabled={adding}>
          {adding ? 'Adding…' : buttonText}
        </button>
      </div>
      {triedToAdd && missingFields.length > 0 && (
        <p className="form-error" role="alert">
          To add this to your cart,{' '}
          {listJoin(
            missingFields.map((f) =>
              f === 'text' && !cleanEmbroideryText(text)
                ? 'enter the embroidery text'
                : f === 'size' && group
                  ? 'enter how many of each size you need'
                  : f === 'size' && size && stock === 0
                    ? 'choose a size that is in stock'
                    : TO_DO[f],
            ),
          )}
          . The missing {missingFields.length === 1 ? 'choice is' : 'choices are'} highlighted above.
        </p>
      )}
      {status && (
        <p className={status.ok ? 'notice' : 'form-error'} role="status">
          {status.text} {status.ok && <Link to="/cart">View cart</Link>}
        </p>
      )}
      <WishlistButton productId={product.product_id} />
    </form>
  )
}
