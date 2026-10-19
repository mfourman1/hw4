// Where embroidery shows on a product photo, for the live preview on the product page and
// the try-on photo. Positions are percentages of the (square) product photo, measured on the
// catalogue's photos: the left chest (the wearer's left, so the photo's right) sits just below
// the small logo, the right chest mirrors it, and the shoulder runs down the top of the
// wearer's left sleeve. The preview is a guide; the shop places the real stitching by hand.

import type { EmbroideryLocation } from './api.ts'
import { hardToSee, THREAD_SWATCHES, type Embroidery } from './shop.ts'

export type Spot = { x: number; y: number; rotate: number }

type PhotoKind = 'hoodie' | 'crewneck' | 'quarter-zip' | 'jacket' | 't-shirt'

const SPOTS: Record<PhotoKind, Record<EmbroideryLocation, Spot>> = {
  crewneck: {
    left_chest: { x: 61, y: 37, rotate: 0 },
    right_chest: { x: 38, y: 31, rotate: 0 },
    shoulder: { x: 80, y: 30, rotate: 68 },
  },
  'quarter-zip': {
    left_chest: { x: 61, y: 39, rotate: 0 },
    right_chest: { x: 39, y: 32, rotate: 0 },
    shoulder: { x: 81, y: 31, rotate: 68 },
  },
  jacket: {
    left_chest: { x: 61, y: 39, rotate: 0 },
    right_chest: { x: 39, y: 32, rotate: 0 },
    shoulder: { x: 81, y: 31, rotate: 68 },
  },
  hoodie: {
    left_chest: { x: 61, y: 45, rotate: 0 },
    right_chest: { x: 39, y: 40, rotate: 0 },
    shoulder: { x: 80, y: 40, rotate: 68 },
  },
  't-shirt': {
    left_chest: { x: 62, y: 38, rotate: 0 },
    right_chest: { x: 39, y: 31, rotate: 0 },
    shoulder: { x: 81, y: 25, rotate: 55 },
  },
}

// Photos whose logo sits lower than most of their kind.
const OVERRIDES: Record<string, Partial<Record<EmbroideryLocation, Spot>>> = {
  'sailing-left-chest-hoodie': {
    left_chest: { x: 63, y: 56, rotate: 0 },
    right_chest: { x: 39, y: 48, rotate: 0 },
  },
}

// Embroidery text height, as a percentage of the photo's width.
export const PREVIEW_TEXT_SIZE = 3.4

function photoKind(categories: string[]): PhotoKind {
  if (categories.includes('hoodie')) return 'hoodie'
  if (categories.includes('quarter-zip')) return 'quarter-zip'
  if (categories.includes('jacket') || categories.includes('fleece')) return 'jacket'
  if (categories.includes('t-shirt') || categories.includes('long-sleeve')) return 't-shirt'
  return 'crewneck'
}

export function embroiderySpot(product: { product_id: string; categories: string[] }, location: EmbroideryLocation): Spot {
  return OVERRIDES[product.product_id]?.[location] ?? SPOTS[photoKind(product.categories)][location]
}

// The thread color to draw. Until the shopper picks one, show the one that stands out.
export function previewThread(embroidery: Embroidery, garmentColor: string) {
  const thread = embroidery.thread_color ?? (hardToSee(garmentColor, 'Navy') ? 'White' : 'Navy')
  return THREAD_SWATCHES[thread] ?? '#ffffff'
}

// For the try-on, which draws the garment on a canvas.
export function drawEmbroidery(
  ctx: CanvasRenderingContext2D,
  embroidery: Embroidery,
  spot: Spot,
  color: string,
  photo: { x: number; y: number; size: number },
) {
  ctx.save()
  ctx.translate(photo.x + (spot.x / 100) * photo.size, photo.y + (spot.y / 100) * photo.size)
  ctx.rotate((spot.rotate * Math.PI) / 180)
  ctx.font = `700 ${(PREVIEW_TEXT_SIZE / 100) * photo.size}px 'Archivo Narrow', 'Arial Narrow', sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.shadowColor = 'rgba(0, 0, 0, 0.35)'
  ctx.shadowOffsetY = Math.max(1, photo.size / 400)
  ctx.fillStyle = color
  ctx.fillText(embroidery.text, 0, 0)
  ctx.restore()
}
