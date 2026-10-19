// Sharing a wishlist: a PDF with photos and descriptions, or an email draft.
// Nothing is sent by Campus Customs: the PDF is downloaded, and the email opens in the
// shopper's own email app (a mailto: link) for them to review and send.

import { describeColorway, formatPrice, type ProductDetail } from './api.ts'

const SHOP_LINE = 'Campus Customs · 57 Broadway, New Haven, CT'

function productUrl(productId: string) {
  return `${window.location.origin}/products/${productId}`
}

// Draw a product photo on a white square and return it as a JPEG data URL for the PDF.
async function photoData(src: string, size = 360): Promise<string> {
  const img = new Image()
  img.src = src
  await img.decode()
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, size, size)
  const scale = Math.min(size / img.naturalWidth, size / img.naturalHeight)
  const w = img.naturalWidth * scale
  const h = img.naturalHeight * scale
  ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h)
  return canvas.toDataURL('image/jpeg', 0.85)
}

export async function downloadWishlistPdf(products: ProductDetail[], ownerName?: string) {
  const { jsPDF } = await import('jspdf') // loaded only when someone downloads a PDF
  const doc = new jsPDF({ unit: 'pt', format: 'letter' })
  const margin = 48
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()
  const photo = 110
  const textX = margin + photo + 18
  const textWidth = pageWidth - textX - margin
  let y = margin

  doc.setFont('times', 'bold')
  doc.setFontSize(22)
  doc.setTextColor(0, 53, 107)
  doc.text(`${ownerName ? `${ownerName}'s` : 'My'} Campus Customs Wishlist`, margin, y + 10)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.setTextColor(95, 102, 115)
  const date = new Date().toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })
  doc.text(`${products.length} item${products.length === 1 ? '' : 's'} · ${date} · ${SHOP_LINE}`, margin, y + 28)
  y += 52

  for (const product of products) {
    const descLines: string[] = doc.splitTextToSize(product.description, textWidth)
    const blockHeight = Math.max(photo, 44 + descLines.length * 13 + 30)
    if (y + blockHeight > pageHeight - margin) {
      doc.addPage()
      y = margin
    }
    doc.setDrawColor(226, 229, 234)
    doc.line(margin, y, pageWidth - margin, y)
    y += 14

    try {
      doc.addImage(await photoData(product.image_url), 'JPEG', margin, y, photo, photo)
    } catch {
      doc.rect(margin, y, photo, photo) // photo couldn't load: leave a frame
    }

    let ty = y + 12
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(13)
    doc.setTextColor(31, 36, 48)
    doc.text(product.name, textX, ty)
    ty += 18
    doc.setTextColor(0, 53, 107)
    doc.setFontSize(12)
    doc.text(`${formatPrice(product.price)}  ·  ${product.garment_type}`, textX, ty)
    ty += 18
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(10)
    doc.setTextColor(31, 36, 48)
    doc.text(descLines, textX, ty)
    ty += descLines.length * 13 + 4
    doc.setTextColor(95, 102, 115)
    doc.text(`Color: ${describeColorway(product)}`, textX, ty)
    ty += 14
    doc.setTextColor(40, 109, 192)
    doc.textWithLink('View this item online', textX, ty, { url: productUrl(product.product_id) })

    y += blockHeight + 8
  }

  doc.save('campus-customs-wishlist.pdf')
}

const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
const MAILTO_MAX = 1800 // keep links short enough for email apps to open

export function isEmail(value: string) {
  return EMAIL_PATTERN.test(value.trim())
}

export function wishlistEmailLink(
  to: string,
  note: string,
  products: { product_id: string; name: string; price: number }[],
  ownerName?: string,
) {
  const subject = `${ownerName ? `${ownerName}'s` : 'My'} Campus Customs wishlist`
  const intro = `${note.trim() ? `${note.trim()}\n\n` : ''}Here's my Campus Customs wishlist:\n\n`
  const outro = `\n${SHOP_LINE}`
  let body = intro
  for (const [i, p] of products.entries()) {
    const line = `${i + 1}. ${p.name} (${formatPrice(p.price)})\n   ${productUrl(p.product_id)}\n`
    if (encodeURIComponent(body + line + outro).length > MAILTO_MAX) {
      body += `…and ${products.length - i} more. Download the PDF from the wishlist page for the full list.\n`
      break
    }
    body += line
  }
  body += outro
  return `mailto:${to.trim()}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
}
