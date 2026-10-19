import { useEffect, useRef, useState } from 'react'
import { openChat, type ProductKind } from '../categories.ts'

// Size chart by sex and product type. These are general body measurements (what to measure
// on yourself), the usual way apparel shops publish sizing; individual brands can vary.

export type Fit = 'mens' | 'womens'

const SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL']

type Row = { label: string; inches: [number, number][] }

// Body measurements in inches, [min, max] per size XS..XXL.
const MEASUREMENTS: Record<Fit, Record<'chest' | 'waist' | 'sleeve', Row>> = {
  mens: {
    chest: { label: 'Chest', inches: [[32, 34], [35, 37], [38, 40], [41, 43], [44, 46], [47, 49]] },
    waist: { label: 'Waist', inches: [[26, 28], [29, 31], [32, 34], [35, 37], [38, 40], [41, 43]] },
    sleeve: { label: 'Sleeve', inches: [[31, 32], [32, 33], [33, 34], [34, 35], [35, 36], [36, 37]] },
  },
  womens: {
    chest: { label: 'Bust', inches: [[31, 32], [33, 34], [35, 36], [37, 39], [40, 42], [43, 45]] },
    waist: { label: 'Waist', inches: [[24, 25], [26, 27], [28, 29], [30, 32], [33, 35], [36, 38]] },
    sleeve: { label: 'Sleeve', inches: [[28.5, 29], [29, 29.5], [29.5, 30], [30, 30.5], [30.5, 31], [31, 31.5]] },
  },
}

const PRODUCTS: Record<ProductKind, { label: string; rows: ('chest' | 'waist' | 'sleeve')[]; fit: string }> = {
  tee: {
    label: 'T-shirts',
    rows: ['chest', 'waist'],
    fit: 'Classic fit. Cotton tees can shrink a little in a hot dryer, so wash cold if you are between sizes.',
  },
  sweatshirt: {
    label: 'Sweatshirts & hoodies',
    rows: ['chest', 'sleeve'],
    fit: 'Relaxed fit for crewnecks, hoodies, and quarter-zips. Between sizes? Size down for a closer fit, or up for that oversized library look.',
  },
  jacket: {
    label: 'Jackets & fleece',
    rows: ['chest', 'sleeve'],
    fit: 'Cut with room to layer over a sweater. Between sizes? Take your usual size.',
  },
}

const FIT_LABELS: Record<Fit, string> = { mens: "Men's / unisex", womens: "Women's" }

function format(value: number, unit: 'in' | 'cm') {
  return unit === 'in' ? String(value) : String(Math.round(value * 2.54))
}

export default function SizeGuide({ initialProduct = 'sweatshirt', headingId }: { initialProduct?: ProductKind; headingId?: string }) {
  const [fit, setFit] = useState<Fit>('mens')
  const [product, setProduct] = useState<ProductKind>(initialProduct)
  const [unit, setUnit] = useState<'in' | 'cm'>('in')
  const spec = PRODUCTS[product]

  return (
    <div className="size-guide">
      <div className="size-controls">
        <div className="segmented" role="tablist" aria-label="Fit">
          {(Object.keys(FIT_LABELS) as Fit[]).map((f) => (
            <button key={f} type="button" role="tab" aria-selected={fit === f} className={fit === f ? 'active' : ''} onClick={() => setFit(f)}>
              {FIT_LABELS[f]}
            </button>
          ))}
        </div>
        <div className="segmented" role="tablist" aria-label="Product">
          {(Object.keys(PRODUCTS) as ProductKind[]).map((p) => (
            <button key={p} type="button" role="tab" aria-selected={product === p} className={product === p ? 'active' : ''} onClick={() => setProduct(p)}>
              {PRODUCTS[p].label}
            </button>
          ))}
        </div>
        <div className="segmented small" role="tablist" aria-label="Units">
          {(['in', 'cm'] as const).map((u) => (
            <button key={u} type="button" role="tab" aria-selected={unit === u} className={unit === u ? 'active' : ''} onClick={() => setUnit(u)}>
              {u === 'in' ? 'Inches' : 'Centimeters'}
            </button>
          ))}
        </div>
      </div>

      {/* Re-keyed so the table fades softly whenever a different chart is chosen. */}
      <div key={`${fit}-${product}-${unit}`} className="size-table-wrap fade-swap">
        <table className="size-table" aria-labelledby={headingId}>
          <caption>
            {FIT_LABELS[fit]} {spec.label.toLowerCase()} · body measurements in {unit === 'in' ? 'inches' : 'centimeters'}
          </caption>
          <thead>
            <tr>
              <th scope="col">Size</th>
              {SIZES.map((s) => (
                <th key={s} scope="col">
                  {s}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {spec.rows.map((key) => {
              const row = MEASUREMENTS[fit][key]
              return (
                <tr key={key}>
                  <th scope="row">{row.label}</th>
                  {row.inches.map(([min, max], i) => (
                    <td key={SIZES[i]}>
                      {format(min, unit)}–{format(max, unit)}
                    </td>
                  ))}
                </tr>
              )
            })}
          </tbody>
        </table>
        <p className="size-fit-note">
          <strong>Fit:</strong> {spec.fit}
          {fit === 'womens' &&
            ' Most of our garments are a unisex cut; for a more fitted look, many women size down one from their unisex size.'}
        </p>
      </div>

      <div className="size-help">
        <div>
          <p className="eyebrow">How to measure</p>
          <ul>
            <li>
              <strong>{fit === 'womens' ? 'Bust' : 'Chest'}:</strong> around the fullest part, under the arms, tape level.
            </li>
            <li>
              <strong>Waist:</strong> around your natural waistline, where you usually wear your pants.
            </li>
            <li>
              <strong>Sleeve:</strong> from the center of the back of your neck, over the shoulder, to your wrist.
            </li>
          </ul>
        </div>
        <p className="size-chat">
          Still unsure? <button type="button" className="link-button" onClick={openChat}>Ask our chat</button> or stop by
          57 Broadway to try one on.
        </p>
      </div>
    </div>
  )
}

// The same chart in a pop-up, opened from a product page's "Size guide" link.
export function SizeGuideDialog({ product, onClose }: { product: ProductKind; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    ref.current?.showModal()
  }, [])
  return (
    <dialog ref={ref} className="size-dialog" onClose={onClose} onClick={(e) => e.target === ref.current && ref.current?.close()} aria-labelledby="size-dialog-title">
      <div className="size-dialog-body">
        <div className="size-dialog-head">
          <h2 id="size-dialog-title">Size guide</h2>
          <button type="button" className="dialog-close" onClick={() => ref.current?.close()} aria-label="Close size guide">
            ×
          </button>
        </div>
        <SizeGuide initialProduct={product} headingId="size-dialog-title" />
      </div>
    </dialog>
  )
}
