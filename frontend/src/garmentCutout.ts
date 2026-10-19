// Turns a product photo into a cutout of just the garment, for "Try it on". Everything
// happens in the browser: the photo's plain background (white or black in this catalogue) is
// made transparent by flood-filling inward from its edges, so the garment itself is kept even
// where it's close to the background color, as long as it's not touching the edge.

import { drawEmbroidery, embroiderySpot, previewThread } from './embroideryPlacement.ts'
import type { ProductDetail } from './api.ts'
import type { Embroidery } from './shop.ts'

export type Cutout = {
  canvas: HTMLCanvasElement // the garment on a transparent background, cropped to fit
  neck: number // how far down the cutout the neckline sits (0-1), so it lines up under the chin
}

const PHOTO_SIZE = 640 // working size; plenty for a phone screen
const TOLERANCE = 26 // how far (0-255 per channel) a pixel can be from the background color

// Waits for the load event rather than img.decode(), which some browsers hold back while
// the page is in the background.
function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`Couldn't load ${src}`))
    img.src = src
  })
}

export async function garmentCutout(product: ProductDetail, embroidery: Embroidery | null): Promise<Cutout> {
  const img = await loadImage(product.image_url)

  const size = PHOTO_SIZE
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  const fit = Math.min(size / img.naturalWidth, size / img.naturalHeight)
  const w = img.naturalWidth * fit
  const h = img.naturalHeight * fit
  // Fill around a non-square photo with its own corner color so the edges flood away too.
  ctx.drawImage(img, 0, 0, 1, 1, 0, 0, size, size)
  ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h)

  const image = ctx.getImageData(0, 0, size, size)
  const px = image.data
  const at = (i: number) => i * 4
  // Background color: the average of the four corners.
  const corners = [0, size - 1, size * (size - 1), size * size - 1]
  const bg = [0, 1, 2].map((c) => corners.reduce((sum, i) => sum + px[at(i) + c], 0) / 4)
  const isBackground = (i: number) =>
    Math.abs(px[at(i)] - bg[0]) <= TOLERANCE &&
    Math.abs(px[at(i) + 1] - bg[1]) <= TOLERANCE &&
    Math.abs(px[at(i) + 2] - bg[2]) <= TOLERANCE

  // Flood fill from every edge pixel.
  const cleared = new Uint8Array(size * size)
  const queue = new Int32Array(size * size)
  let head = 0
  let tail = 0
  const push = (i: number) => {
    if (!cleared[i] && isBackground(i)) {
      cleared[i] = 1
      queue[tail++] = i
    }
  }
  for (let k = 0; k < size; k++) {
    push(k)
    push(size * (size - 1) + k)
    push(k * size)
    push(k * size + size - 1)
  }
  const fill = () => {
    while (head < tail) {
      const i = queue[head++]
      const x = i % size
      if (x > 0) push(i - 1)
      if (x < size - 1) push(i + 1)
      if (i >= size) push(i - size)
      if (i < size * (size - 1)) push(i + size)
    }
  }
  fill()

  // Background shut in by the garment (between an arm and the body) isn't reached from the
  // edges. Clear such a patch only if it's shaped like that gap: a sliver at least a tenth of
  // the photo tall and three times as tall as it's wide. Anything else shut in is garment that
  // matches the background: a dark fold, or a white letter or crest on a white photo.
  const minPatch = Math.round(size * size * 0.001)
  const isArmGap = () => {
    if (tail < minPatch) return false
    let x0 = size, x1 = 0, y0 = size, y1 = 0
    for (let k = 0; k < tail; k++) {
      const x = queue[k] % size
      const y = (queue[k] - x) / size
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
    }
    const height = y1 - y0 + 1
    return height >= size * 0.1 && height >= 3 * (x1 - x0 + 1)
  }
  for (let start = 0; start < size * size; start++) {
    if (cleared[start] || !isBackground(start)) continue
    head = tail = 0
    push(start)
    fill()
    if (!isArmGap()) {
      for (let k = 0; k < tail; k++) cleared[queue[k]] = 2 // part of the garment
    }
  }
  for (let i = 0; i < size * size; i++) if (cleared[i] === 2) cleared[i] = 0

  // Trim the photo's one-pixel halo around the garment, soften the next pixel, and find
  // the garment's edges.
  const touchesCleared = (i: number) => {
    const x = i % size
    return (x > 0 && cleared[i - 1] === 1) || (x < size - 1 && cleared[i + 1] === 1) || (i >= size && cleared[i - size] === 1) || (i < size * (size - 1) && cleared[i + size] === 1)
  }
  const halo: number[] = []
  for (let i = 0; i < size * size; i++) if (!cleared[i] && touchesCleared(i)) halo.push(i)
  for (const i of halo) cleared[i] = 1

  let top = size
  let bottom = 0
  let left = size
  let right = 0
  for (let i = 0; i < size * size; i++) {
    if (cleared[i]) {
      px[at(i) + 3] = 0
      continue
    }
    if (touchesCleared(i)) px[at(i) + 3] = 150
    const x = i % size
    const y = (i - x) / size
    if (y < top) top = y
    if (y > bottom) bottom = y
    if (x < left) left = x
    if (x > right) right = x
  }
  ctx.putImageData(image, 0, 0)

  if (embroidery) {
    const spot = embroiderySpot(product, embroidery.location)
    drawEmbroidery(ctx, embroidery, spot, previewThread(embroidery, product.colorway), { x: 0, y: 0, size })
  }

  if (bottom <= top || right <= left) {
    // Nothing found (an unusual photo): use the whole photo.
    top = left = 0
    bottom = right = size - 1
  }
  const crop = document.createElement('canvas')
  crop.width = right - left + 1
  crop.height = bottom - top + 1
  crop.getContext('2d')!.drawImage(canvas, left, top, crop.width, crop.height, 0, 0, crop.width, crop.height)

  // A hoodie's hood sits above its neckline in the photo; other garments start at the collar.
  const neck = product.categories.includes('hoodie') ? 0.3 : 0.03
  return { canvas: crop, neck }
}
