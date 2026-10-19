import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import type { ProductDetail } from '../api.ts'
import { garmentCutout, type Cutout } from '../garmentCutout.ts'
import type { Embroidery } from '../shop.ts'

// "Try it on" (phones): the shopper sees themselves in the garment. The front camera shows
// them live with the garment over their shoulders; they line their face up with the guide
// and take a photo (or pick one from their phone). Then they can drag the garment and resize
// it, and save or share the picture. Nothing leaves the phone: the photo and the garment
// cutout are drawn in the browser and never uploaded.

const FRAME_W = 900 // the saved picture, 3:4 portrait
const FRAME_H = 1200

// Where the garment starts: centered, as wide as the frame, its neckline just below the
// face guide. x and y are fractions of the frame; width is a fraction of the frame's width.
const START = { x: 0.5, y: 0.47, width: 0.95 }

type Placement = typeof START
type Stage = 'camera' | 'photo'

function drawCover(ctx: CanvasRenderingContext2D, source: CanvasImageSource, sw: number, sh: number, mirror: boolean) {
  const scale = Math.max(FRAME_W / sw, FRAME_H / sh)
  const w = sw * scale
  const h = sh * scale
  ctx.save()
  if (mirror) {
    ctx.translate(FRAME_W, 0)
    ctx.scale(-1, 1)
  }
  ctx.drawImage(source, (FRAME_W - w) / 2, (FRAME_H - h) / 2, w, h)
  ctx.restore()
}

// The shopper's face, just above the garment's neckline: drawn over the garment so a collar
// or hood sits behind their chin instead of covering it. It moves and scales with the garment
// (at the start it's the face guide's oval). Fractions of the frame.
function faceOval(place: Placement) {
  const k = place.width / START.width
  return { cx: place.x, cy: place.y - 0.2 * k, rx: 0.18 * k, ry: 0.18 * k }
}

function garmentBox(cutout: Cutout, place: Placement) {
  const w = place.width * FRAME_W
  const h = (w * cutout.canvas.height) / cutout.canvas.width
  return { x: place.x * FRAME_W - w / 2, y: place.y * FRAME_H - cutout.neck * h, w, h }
}

export default function TryOn({ product, embroidery, onClose }: { product: ProductDetail; embroidery: Embroidery | null; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const sceneRef = useRef<HTMLCanvasElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const selfieRef = useRef<HTMLCanvasElement | null>(null)
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const [stage, setStage] = useState<Stage>('camera')
  const [cameraError, setCameraError] = useState<string | null>(null)
  const [cutout, setCutout] = useState<Cutout | null>(null)
  const [cutoutUrl, setCutoutUrl] = useState<string | null>(null)
  const [place, setPlace] = useState<Placement>(START)
  const [message, setMessage] = useState<string | null>(null)
  const canShareFiles = typeof navigator.canShare === 'function'
  const cameraSupported = Boolean(navigator.mediaDevices?.getUserMedia)

  useEffect(() => {
    dialogRef.current?.showModal()
  }, [])

  // Cut the garment out of its product photo (with any embroidery being designed).
  useEffect(() => {
    let active = true
    garmentCutout(product, embroidery)
      .then((c) => {
        if (!active) return
        setCutout(c)
        setCutoutUrl(c.canvas.toDataURL('image/png'))
      })
      .catch(() => active && setMessage("Sorry, this garment's photo couldn't be prepared for try-on."))
    return () => {
      active = false
    }
  }, [product, embroidery])

  // The front camera, while on the camera step.
  useEffect(() => {
    if (stage !== 'camera' || !cameraSupported) return
    let stream: MediaStream | null = null
    let active = true
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'user', width: { ideal: 1080 }, height: { ideal: 1440 } }, audio: false })
      .then((s) => {
        if (!active) return s.getTracks().forEach((t) => t.stop())
        stream = s
        setCameraError(null)
        if (videoRef.current) {
          videoRef.current.srcObject = s
          videoRef.current.play().catch(() => {})
        }
      })
      .catch(() => active && setCameraError('The camera is off or not allowed. You can use a photo from your phone instead.'))
    return () => {
      active = false
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [stage, cameraSupported])

  // Redraw the finished picture whenever the garment moves.
  useEffect(() => {
    const canvas = sceneRef.current
    const selfie = selfieRef.current
    if (stage !== 'photo' || !canvas || !selfie) return
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(selfie, 0, 0)
    if (cutout) {
      const box = garmentBox(cutout, place)
      ctx.drawImage(cutout.canvas, box.x, box.y, box.w, box.h)
      const face = faceOval(place)
      ctx.save()
      ctx.beginPath()
      ctx.ellipse(face.cx * FRAME_W, face.cy * FRAME_H, face.rx * FRAME_W, face.ry * FRAME_H, 0, 0, Math.PI * 2)
      ctx.clip()
      ctx.drawImage(selfie, 0, 0)
      ctx.restore()
    }
  }, [stage, cutout, place])

  function keepSelfie(draw: (ctx: CanvasRenderingContext2D) => void) {
    const selfie = document.createElement('canvas')
    selfie.width = FRAME_W
    selfie.height = FRAME_H
    const ctx = selfie.getContext('2d')!
    ctx.fillStyle = '#e9eef4'
    ctx.fillRect(0, 0, FRAME_W, FRAME_H)
    draw(ctx)
    selfieRef.current = selfie
    setMessage(null)
    setStage('photo')
  }

  function takePhoto() {
    const video = videoRef.current
    if (!video || !video.videoWidth) return
    // Saved the way the shopper saw it on screen (mirrored, like a mirror).
    keepSelfie((ctx) => drawCover(ctx, video, video.videoWidth, video.videoHeight, true))
  }

  async function openPhotoFile(file: File | undefined) {
    if (!file) return
    try {
      const bitmap = await createImageBitmap(file)
      keepSelfie((ctx) => drawCover(ctx, bitmap, bitmap.width, bitmap.height, false))
      bitmap.close()
    } catch {
      setMessage("That photo couldn't be opened. Try another one.")
    }
  }

  // Drag with one finger to move the garment; pinch with two to resize it.
  function frameScale(event: ReactPointerEvent) {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
    return { x: 1 / rect.width, y: 1 / rect.height }
  }

  function onPointerDown(event: ReactPointerEvent) {
    ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
  }

  function onPointerMove(event: ReactPointerEvent) {
    const last = pointers.current.get(event.pointerId)
    if (!last) return
    const scale = frameScale(event)
    const others = [...pointers.current.entries()].filter(([id]) => id !== event.pointerId)
    if (others.length === 0) {
      const dx = (event.clientX - last.x) * scale.x
      const dy = (event.clientY - last.y) * scale.y
      setPlace((p) => ({ ...p, x: Math.min(1, Math.max(0, p.x + dx)), y: Math.min(1, Math.max(0, p.y + dy)) }))
    } else {
      const other = others[0][1]
      const before = Math.hypot(last.x - other.x, last.y - other.y)
      const after = Math.hypot(event.clientX - other.x, event.clientY - other.y)
      if (before > 0) setPlace((p) => ({ ...p, width: Math.min(1.8, Math.max(0.4, p.width * (after / before))) }))
    }
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
  }

  function onPointerUp(event: ReactPointerEvent) {
    pointers.current.delete(event.pointerId)
  }

  function photoBlob() {
    return new Promise<Blob | null>((resolve) => sceneRef.current?.toBlob(resolve, 'image/jpeg', 0.9) ?? resolve(null))
  }

  async function savePhoto() {
    const blob = await photoBlob()
    if (!blob) return
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `campus-customs-${product.product_id}-try-on.jpg`
    link.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    setMessage('Saved to your downloads.')
  }

  async function sharePhoto() {
    const blob = await photoBlob()
    if (!blob) return
    const file = new File([blob], `campus-customs-try-on.jpg`, { type: 'image/jpeg' })
    if (!navigator.canShare?.({ files: [file] })) return savePhoto()
    try {
      await navigator.share({ files: [file], title: `Me in the ${product.name}` })
    } catch {
      // The shopper closed the share sheet.
    }
  }

  const cameraProblem = cameraSupported
    ? cameraError
    : "This browser can't open the camera here. You can use a photo from your phone instead."
  const box = cutout ? garmentBox(cutout, place) : null
  const face = faceOval(place)
  // Live view: the same face oval is cut out of the garment layer, so the camera shows through.
  const faceMask = `radial-gradient(ellipse ${face.rx * 100}% ${face.ry * 100}% at ${face.cx * 100}% ${face.cy * 100}%, transparent 97%, #000 100%)`
  const overlayStyle = box
    ? {
        left: `${(box.x / FRAME_W) * 100}%`,
        top: `${(box.y / FRAME_H) * 100}%`,
        width: `${(box.w / FRAME_W) * 100}%`,
      }
    : undefined

  return (
    <dialog ref={dialogRef} className="try-on" onClose={onClose} aria-labelledby="try-on-title">
      <div className="try-on-head">
        <h2 id="try-on-title">Try it on</h2>
        <button type="button" className="dialog-close" onClick={() => dialogRef.current?.close()} aria-label="Close try-on">
          ×
        </button>
      </div>

      <div
        className={`try-on-frame${stage === 'photo' ? ' is-photo' : ''}`}
        onPointerDown={stage === 'photo' ? onPointerDown : undefined}
        onPointerMove={stage === 'photo' ? onPointerMove : undefined}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {stage === 'camera' ? (
          <>
            {cameraProblem ? (
              <p className="try-on-camera-off">{cameraProblem}</p>
            ) : (
              <video ref={videoRef} className="try-on-video" playsInline muted autoPlay />
            )}
            <svg className="try-on-guide" viewBox="0 0 300 400" aria-hidden="true">
              <ellipse cx="150" cy="108" rx="58" ry="74" />
            </svg>
            {cutoutUrl && (
              <div className="try-on-garment-layer" style={{ maskImage: faceMask, WebkitMaskImage: faceMask }}>
                <img className="try-on-garment" src={cutoutUrl} alt="" style={overlayStyle} />
              </div>
            )}
          </>
        ) : (
          <canvas ref={sceneRef} className="try-on-photo" width={FRAME_W} height={FRAME_H} aria-label={`You in the ${product.name}`} />
        )}
      </div>

      <p className="try-on-tip">
        {stage === 'camera'
          ? 'Line your face up with the oval, with your shoulders under it, then take the photo.'
          : 'Drag the garment to move it, and pinch or use the slider to resize it.'}
      </p>

      {stage === 'photo' && (
        <label className="try-on-size">
          Size on screen
          <input
            type="range"
            min={40}
            max={180}
            value={Math.round(place.width * 100)}
            onChange={(e) => setPlace((p) => ({ ...p, width: Number(e.target.value) / 100 }))}
          />
        </label>
      )}

      <div className="try-on-actions">
        {stage === 'camera' ? (
          <>
            {!cameraProblem && (
              <button type="button" className="button" onClick={takePhoto} disabled={!cutout}>
                Take photo
              </button>
            )}
            <button type="button" className={`button${cameraProblem ? '' : ' button-ghost'}`} onClick={() => fileRef.current?.click()}>
              Use a photo instead
            </button>
          </>
        ) : (
          <>
            <button type="button" className="button" onClick={canShareFiles ? sharePhoto : savePhoto}>
              {canShareFiles ? 'Share' : 'Save photo'}
            </button>
            {canShareFiles && (
              <button type="button" className="button button-ghost" onClick={savePhoto}>
                Save photo
              </button>
            )}
            <button
              type="button"
              className="button button-ghost"
              onClick={() => {
                setPlace(START)
                setStage('camera')
              }}
            >
              Retake
            </button>
          </>
        )}
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="user"
        hidden
        onChange={(e) => {
          openPhotoFile(e.target.files?.[0])
          e.target.value = ''
        }}
      />
      {message && <p className="try-on-message" role="status">{message}</p>}
      <p className="try-on-privacy">🔒 Your photo stays on your phone. Nothing is uploaded or saved by Campus Customs.</p>
    </dialog>
  )
}
