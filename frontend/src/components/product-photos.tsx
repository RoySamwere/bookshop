import { useEffect, useRef, useState, type DragEvent, type ReactNode } from 'react'
import { BookOpen, Camera, ChevronLeft, ChevronRight, ImagePlus, RefreshCw, Star, Trash2, X } from 'lucide-react'
import { Modal, secondaryButton, primaryButton, dangerButton } from './ui-kit'
import { assetUrl, errorMessage } from '../lib/api'
import { MAX_PRODUCT_IMAGES, prepareImage, productImagesApi, type PreparedImage, type ProductImage } from '../lib/product-images'

const SIZES = { xs: 'size-8', sm: 'size-10', md: 'size-14', lg: 'size-24', xl: 'size-40' } as const

/** A product's photo, or a calm placeholder. Used everywhere products are listed. */
export function ProductThumb({ url, alt = '', size = 'sm', className = '' }: { url?: string | null; alt?: string; size?: keyof typeof SIZES; className?: string }) {
  const [failed, setFailed] = useState(false)
  const src = assetUrl(url)
  useEffect(() => setFailed(false), [src])
  return <span className={`product-thumb relative inline-grid shrink-0 place-items-center overflow-hidden rounded-lg border border-slate-200 bg-gradient-to-br from-slate-50 to-slate-100 ${SIZES[size]} ${className}`}>
    {src && !failed ? <img src={src} alt={alt} loading="lazy" decoding="async" className="h-full w-full object-cover" onError={() => setFailed(true)} />
      : <BookOpen aria-hidden="true" className="w-1/2 text-slate-300" strokeWidth={1.5} />}
  </span>
}

/** Prefers the small thumbnail, falling back to the large image or an external cover URL. */
export const thumbOf = (row: { thumb_url?: string | null; image_url?: string | null; cover_url?: string | null }) => row.thumb_url ?? row.image_url ?? row.cover_url ?? null

type Source = 'camera' | 'gallery'
const touchDevice = () => typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches

/**
 * Take Photo / Choose from Gallery / drag and drop. Phones open their own camera app through the
 * native capture input; computers with a webcam get a live camera view; anything else falls back to
 * choosing a file. Every chosen photo is prepared on the device, then confirmed before upload.
 */
function PhotoSources({ onPrepared, multiple, disabled, compact = false, children }: { onPrepared: (photos: PreparedImage[], source: Source) => void; multiple: boolean; disabled?: boolean; compact?: boolean; children?: ReactNode }) {
  const cameraInput = useRef<HTMLInputElement>(null)
  const galleryInput = useRef<HTMLInputElement>(null)
  const [webcam, setWebcam] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState('')
  const [preparing, setPreparing] = useState(false)

  async function handle(files: FileList | File[] | null, source: Source) {
    setError('')
    const list = Array.from(files ?? []).filter(file => file.type.startsWith('image/') || /\.(jpe?g|png|webp|heic|heif)$/i.test(file.name))
    if (!list.length) { if (files && Array.from(files).length) setError('Choose a JPEG, PNG or WebP photo.'); return }
    setPreparing(true)
    const prepared: PreparedImage[] = []
    const problems: string[] = []
    for (const file of list.slice(0, MAX_PRODUCT_IMAGES)) {
      try { prepared.push(await prepareImage(file)) } catch (e) { problems.push(`${file.name}: ${errorMessage(e)}`) }
    }
    setPreparing(false)
    if (problems.length) setError(problems.join(' '))
    if (prepared.length) onPrepared(prepared, source)
  }
  function takePhoto() {
    setError('')
    if (touchDevice() || !navigator.mediaDevices?.getUserMedia) cameraInput.current?.click()
    else setWebcam(true)
  }
  const drop = (event: DragEvent) => { event.preventDefault(); setDragging(false); if (!disabled) void handle(event.dataTransfer.files, 'gallery') }

  return <div onDragOver={event => { event.preventDefault(); if (!disabled) setDragging(true) }} onDragLeave={() => setDragging(false)} onDrop={drop}
    className={`rounded-xl border-2 border-dashed transition ${dragging ? 'border-teal-500 bg-teal-50' : 'border-slate-200 bg-slate-50/60'} ${compact ? 'p-3' : 'p-4 sm:p-5'}`}>
    {children}
    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
      <button type="button" className={`${primaryButton} h-11 w-full whitespace-nowrap sm:w-auto`} disabled={disabled || preparing} onClick={takePhoto}><Camera size={17} /> Take Photo</button>
      <button type="button" className={`${secondaryButton} h-11 w-full whitespace-nowrap sm:w-auto`} disabled={disabled || preparing} onClick={() => galleryInput.current?.click()}><ImagePlus size={17} /> Choose from Gallery</button>
      <span className="hidden text-xs text-slate-500 md:inline">{preparing ? 'Preparing photo…' : 'or drag photos here'}</span>
      {preparing && <span className="text-xs text-slate-500 md:hidden" role="status">Preparing photo…</span>}
    </div>
    <p className="mt-2 text-xs text-slate-500">JPEG, PNG or WebP. Large photos are resized automatically.</p>
    {error && <p role="alert" className="mt-2 text-xs font-medium text-rose-700">{error}</p>}
    {/* capture="environment" opens the phone's rear camera; desktop browsers ignore it and show a file picker. */}
    <input ref={cameraInput} type="file" accept="image/*" capture="environment" className="sr-only" tabIndex={-1} aria-hidden="true" onChange={event => { void handle(event.target.files, 'camera'); event.target.value = '' }} />
    <input ref={galleryInput} type="file" accept="image/jpeg,image/png,image/webp,image/*" multiple={multiple} className="sr-only" tabIndex={-1} aria-hidden="true" onChange={event => { void handle(event.target.files, 'gallery'); event.target.value = '' }} />
    {webcam && <WebcamCapture onClose={() => setWebcam(false)} onCaptured={photo => { setWebcam(false); onPrepared([photo], 'camera') }}
      onUnavailable={message => { setWebcam(false); setError(message); galleryInput.current?.click() }} />}
  </div>
}

/** Live camera for computers and tablets with a webcam. Permission problems fall back to choosing a file. */
function WebcamCapture({ onClose, onCaptured, onUnavailable }: { onClose: () => void; onCaptured: (photo: PreparedImage) => void; onUnavailable: (message: string) => void }) {
  const video = useRef<HTMLVideoElement>(null)
  const stream = useRef<MediaStream | null>(null)
  const [ready, setReady] = useState(false)
  useEffect(() => {
    let cancelled = false
    navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false })
      .then(media => {
        if (cancelled) { media.getTracks().forEach(track => track.stop()); return }
        stream.current = media
        if (video.current) { video.current.srcObject = media; void video.current.play().then(() => setReady(true)).catch(() => setReady(true)) }
      })
      .catch((e: DOMException) => {
        if (cancelled) return
        onUnavailable(e?.name === 'NotAllowedError' ? 'Camera access was blocked. Allow the camera in your browser settings, or choose a photo instead.'
          : e?.name === 'NotFoundError' || e?.name === 'OverconstrainedError' ? 'No camera was found on this device. Choose a photo instead.'
          : e?.name === 'NotReadableError' ? 'The camera is being used by another app. Close it, or choose a photo instead.'
          : 'The camera could not be opened. Choose a photo instead.')
      })
    return () => { cancelled = true; stream.current?.getTracks().forEach(track => track.stop()) }
  }, [onUnavailable])
  async function capture() {
    const element = video.current
    if (!element || !element.videoWidth) return
    const canvas = document.createElement('canvas')
    canvas.width = element.videoWidth; canvas.height = element.videoHeight
    canvas.getContext('2d')?.drawImage(element, 0, 0)
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.92))
    if (!blob) return
    stream.current?.getTracks().forEach(track => track.stop())
    onCaptured({ blob, name: `photo-${Date.now()}.jpg`, previewUrl: URL.createObjectURL(blob), width: canvas.width, height: canvas.height })
  }
  return <Modal elevated title="Take a photo" description="Hold the product in good light, fill the frame and keep the cover straight." icon={<Camera size={18} />} wide onClose={onClose}>
    <div className="overflow-hidden rounded-xl bg-slate-900"><video ref={video} playsInline muted className="aspect-[4/3] w-full object-contain" aria-label="Camera preview" /></div>
    {!ready && <p className="mt-3 text-sm text-slate-500" role="status">Waiting for camera permission…</p>}
    <div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
      <button type="button" className={secondaryButton} onClick={onClose}>Cancel</button>
      <button type="button" className={primaryButton} disabled={!ready} onClick={() => void capture()}><Camera size={16} /> Capture</button>
    </div>
  </Modal>
}

/** Confirm photos before they are saved: retake (camera) or remove individual photos. */
function ReviewPhotos({ photos, source, busy, progress, error, onRemove, onRetake, onCancel, onConfirm, confirmLabel }: {
  photos: PreparedImage[]; source: Source; busy: boolean; progress: string; error: string
  onRemove: (index: number) => void; onRetake: () => void; onCancel: () => void; onConfirm: () => void; confirmLabel: string
}) {
  return <Modal elevated title={photos.length === 1 ? 'Use this photo?' : `Use these ${photos.length} photos?`} description="Check that the product is clear and readable before saving." icon={<ImagePlus size={18} />} wide onClose={onCancel} busy={busy}>
    <div className={`grid gap-3 ${photos.length === 1 ? '' : 'grid-cols-2 sm:grid-cols-3'}`}>
      {photos.map((photo, index) => <figure key={photo.previewUrl} className="relative m-0 overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
        <img src={photo.previewUrl} alt={`Preview ${index + 1}`} className={`w-full object-contain ${photos.length === 1 ? 'max-h-[55vh]' : 'aspect-square'}`} />
        {photos.length > 1 && !busy && <button type="button" onClick={() => onRemove(index)} className="absolute right-2 top-2 grid size-8 place-items-center rounded-full bg-white/90 text-slate-700 shadow" aria-label={`Remove preview ${index + 1}`}><X size={15} /></button>}
      </figure>)}
    </div>
    {busy && <div className="mt-4" role="status"><div className="h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-teal-600 transition-all" style={{ width: `${Number(progress.match(/(\d+)%/)?.[1] ?? 0)}%` }} /></div><p className="mt-1.5 text-xs text-slate-500">{progress}</p></div>}
    {error && <p role="alert" className="mt-3 rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
    <div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
      <button type="button" className={secondaryButton} disabled={busy} onClick={onCancel}>Cancel</button>
      {source === 'camera' && <button type="button" className={secondaryButton} disabled={busy} onClick={onRetake}><RefreshCw size={16} /> Retake</button>}
      <button type="button" className={primaryButton} disabled={busy || !photos.length} onClick={onConfirm}>{busy ? 'Uploading…' : confirmLabel}</button>
    </div>
  </Modal>
}

/** Full photo management for a saved product. Read-only when the user cannot manage the catalogue. */
export function ProductImageManager({ bookId, title, canEdit, onChanged }: { bookId: number; title: string; canEdit: boolean; onChanged?: (images: ProductImage[]) => void }) {
  const [images, setImages] = useState<ProductImage[] | null>(null)
  const [loadError, setLoadError] = useState('')
  const [pending, setPending] = useState<{ photos: PreparedImage[]; source: Source; replace?: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [confirmDelete, setConfirmDelete] = useState<ProductImage | null>(null)
  const [replacing, setReplacing] = useState<ProductImage | null>(null)
  const [dragId, setDragId] = useState<number | null>(null)
  const retakeTrigger = useRef<HTMLDivElement>(null)

  const apply = (list: ProductImage[], message?: string) => { setImages(list); onChanged?.(list); if (message) setNotice(message) }
  useEffect(() => {
    let active = true
    productImagesApi.list(bookId).then(list => { if (active) setImages(list) }).catch(e => { if (active) setLoadError(errorMessage(e)) })
    return () => { active = false }
  }, [bookId])
  const release = (photos: PreparedImage[]) => photos.forEach(photo => URL.revokeObjectURL(photo.previewUrl))

  async function upload() {
    if (!pending) return
    setBusy(true); setError(''); setNotice('')
    let latest: ProductImage[] | null = null
    let duplicates = 0
    try {
      for (const [index, photo] of pending.photos.entries()) {
        const label = pending.photos.length > 1 ? `Photo ${index + 1} of ${pending.photos.length}: ` : ''
        setProgress(`${label}0%`)
        const onProgress = (fraction: number) => setProgress(`${label}${Math.round(fraction * 100)}%`)
        const result = pending.replace
          ? await productImagesApi.replace(bookId, pending.replace, photo.blob, photo.name, onProgress)
          : await productImagesApi.upload(bookId, photo.blob, photo.name, onProgress)
        if (result.duplicate) duplicates++
        latest = result.data
      }
      if (latest) apply(latest, pending.replace ? 'Photo replaced.' : duplicates ? `Saved. ${duplicates} photo(s) were already attached and were skipped.` : pending.photos.length > 1 ? `${pending.photos.length} photos added.` : 'Photo added.')
      release(pending.photos); setPending(null)
    } catch (e) {
      setError(errorMessage(e))
      if (latest) apply(latest)
    } finally { setBusy(false); setProgress('') }
  }
  async function run(action: () => Promise<{ data: ProductImage[]; message?: string }>) {
    setError(''); setNotice('')
    try { const result = await action(); apply(result.data, result.message) } catch (e) { setError(errorMessage(e)) }
  }
  function move(id: number, offset: number) {
    if (!images) return
    const ids = images.map(image => image.id)
    const from = ids.indexOf(id), to = from + offset
    if (from < 0 || to < 0 || to >= ids.length) return
    ids.splice(to, 0, ...ids.splice(from, 1))
    void run(() => productImagesApi.reorder(bookId, ids))
  }
  function dropOn(targetId: number) {
    if (!images || dragId === null || dragId === targetId) return
    const ids = images.map(image => image.id).filter(id => id !== dragId)
    ids.splice(ids.indexOf(targetId), 0, dragId)
    setDragId(null)
    void run(() => productImagesApi.reorder(bookId, ids))
  }

  if (loadError) return <p role="alert" className="text-sm text-rose-700">Photos could not be loaded: {loadError}</p>
  if (!images) return <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">{[1, 2, 3].map(n => <div key={n} className="aspect-square animate-pulse rounded-xl bg-slate-100" />)}</div>
  const full = images.length >= MAX_PRODUCT_IMAGES

  return <section aria-label={`Photos of ${title}`} className="grid gap-3">
    {images.length === 0 ? <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-3"><ProductThumb size="md" /><p className="text-sm text-slate-500">{canEdit ? 'No photos yet. Add a clear photo of the cover so staff can recognise it at the till.' : 'No photos yet.'}</p></div>
      : <ol className="m-0 grid list-none grid-cols-2 gap-3 p-0 sm:grid-cols-3 md:grid-cols-4">{images.map((image, index) => <li key={image.id}
        draggable={canEdit} onDragStart={() => setDragId(image.id)} onDragOver={event => { if (dragId !== null) event.preventDefault() }} onDrop={() => dropOn(image.id)}
        className={`group relative overflow-hidden rounded-xl border bg-white ${image.is_primary ? 'border-teal-500 ring-2 ring-teal-100' : 'border-slate-200'} ${dragId === image.id ? 'opacity-50' : ''}`}>
        <a href={assetUrl(image.image_url) ?? undefined} target="_blank" rel="noreferrer" className="block aspect-square bg-slate-50" aria-label={`Open photo ${index + 1} full size`}>
          <img src={assetUrl(image.thumb_url) ?? undefined} alt={`${title}, photo ${index + 1}`} loading="lazy" className="h-full w-full object-cover" />
        </a>
        {image.is_primary && <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-teal-700 px-2 py-0.5 text-[11px] font-semibold text-white"><Star size={11} fill="currentColor" /> Main</span>}
        {canEdit && <div className="flex flex-wrap items-center justify-between gap-1 border-t border-slate-100 p-1.5">
          <span className="flex">
            <button type="button" className="grid size-8 place-items-center rounded-md text-slate-500 hover:bg-slate-100 disabled:opacity-30" disabled={index === 0} onClick={() => move(image.id, -1)} aria-label={`Move photo ${index + 1} earlier`}><ChevronLeft size={16} /></button>
            <button type="button" className="grid size-8 place-items-center rounded-md text-slate-500 hover:bg-slate-100 disabled:opacity-30" disabled={index === images.length - 1} onClick={() => move(image.id, 1)} aria-label={`Move photo ${index + 1} later`}><ChevronRight size={16} /></button>
          </span>
          <span className="flex">
            {!image.is_primary && <button type="button" className="grid size-8 place-items-center rounded-md text-slate-500 hover:bg-teal-50 hover:text-teal-700" onClick={() => void run(() => productImagesApi.makePrimary(bookId, image.id))} aria-label={`Make photo ${index + 1} the main photo`} title="Make main photo"><Star size={15} /></button>}
            <button type="button" className="grid size-8 place-items-center rounded-md text-slate-500 hover:bg-slate-100" onClick={() => setReplacing(image)} aria-label={`Replace photo ${index + 1}`} title="Replace"><RefreshCw size={15} /></button>
            <button type="button" className="grid size-8 place-items-center rounded-md text-slate-500 hover:bg-rose-50 hover:text-rose-600" onClick={() => setConfirmDelete(image)} aria-label={`Remove photo ${index + 1}`} title="Remove"><Trash2 size={15} /></button>
          </span>
        </div>}
      </li>)}</ol>}
    {notice && <p role="status" className="text-sm font-medium text-emerald-700">{notice}</p>}
    {error && !pending && <p role="alert" className="text-sm text-rose-700">{error}</p>}
    {canEdit && (full ? <p className="text-xs text-slate-500">This product has the maximum of {MAX_PRODUCT_IMAGES} photos. Remove or replace one to add another.</p>
      : <div ref={retakeTrigger}><PhotoSources multiple disabled={busy} onPrepared={(photos, source) => { setError(''); setPending({ photos: photos.slice(0, MAX_PRODUCT_IMAGES - images.length), source }) }} /></div>)}
    {replacing && <Modal elevated title="Replace photo" description="Take a new photo or choose one. It takes the old photo's place." icon={<RefreshCw size={18} />} onClose={() => setReplacing(null)}>
      <PhotoSources multiple={false} onPrepared={(photos, source) => { setPending({ photos: photos.slice(0, 1), source, replace: replacing.id }); setReplacing(null) }} />
    </Modal>}
    {pending && <ReviewPhotos photos={pending.photos} source={pending.source} busy={busy} progress={progress} error={error} confirmLabel={pending.replace ? 'Replace photo' : pending.photos.length > 1 ? `Upload ${pending.photos.length} photos` : 'Use photo'}
      onRemove={index => { release([pending.photos[index]]); setPending({ ...pending, photos: pending.photos.filter((_, i) => i !== index) }) }}
      onCancel={() => { release(pending.photos); setPending(null); setError('') }}
      onRetake={() => { const replace = pending.replace; release(pending.photos); setPending(null); setError(''); if (replace) { setReplacing(images.find(i => i.id === replace) ?? null) } else retakeTrigger.current?.querySelector<HTMLButtonElement>('button')?.click() }}
      onConfirm={() => void upload()} />}
    {confirmDelete && <Modal elevated title="Remove this photo?" description="Only the photo is removed. The product, its stock and its sales are not affected." icon={<Trash2 size={18} />} onClose={() => setConfirmDelete(null)}>
      <div className="flex items-center gap-3"><ProductThumb url={confirmDelete.thumb_url} size="lg" alt="" /><p className="text-sm text-slate-600">{confirmDelete.is_primary ? 'This is the main photo; the next photo will become the main photo.' : 'This photo will be deleted permanently.'}</p></div>
      <div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        <button type="button" className={secondaryButton} onClick={() => setConfirmDelete(null)}>Cancel</button>
        <button type="button" className={dangerButton} onClick={() => { const image = confirmDelete; setConfirmDelete(null); void run(() => productImagesApi.remove(bookId, image.id)) }}><Trash2 size={16} /> Remove photo</button>
      </div>
    </Modal>}
  </section>
}

/**
 * Photos chosen while adding a product that has not been saved yet. They are uploaded with
 * uploadPendingPhotos() right after the product is created; the first one becomes the main photo.
 */
export function NewProductPhotos({ value, onChange, disabled }: { value: PreparedImage[]; onChange: (photos: PreparedImage[]) => void; disabled?: boolean }) {
  const [review, setReview] = useState<{ photos: PreparedImage[]; source: Source } | null>(null)
  const trigger = useRef<HTMLDivElement>(null)
  return <div className="grid gap-3">
    {value.length > 0 && <ol className="m-0 grid list-none grid-cols-3 gap-2 p-0 sm:grid-cols-4">{value.map((photo, index) => <li key={photo.previewUrl} className={`relative overflow-hidden rounded-xl border bg-slate-50 ${index === 0 ? 'border-teal-500 ring-2 ring-teal-100' : 'border-slate-200'}`}>
      <img src={photo.previewUrl} alt={`New photo ${index + 1}`} className="aspect-square w-full object-cover" />
      {index === 0 && <span className="absolute left-1.5 top-1.5 rounded-full bg-teal-700 px-2 py-0.5 text-[10px] font-semibold text-white">Main</span>}
      <span className="absolute right-1 top-1 flex gap-1">
        {index > 0 && <button type="button" disabled={disabled} className="grid size-7 place-items-center rounded-full bg-white/90 text-slate-700 shadow" onClick={() => onChange([photo, ...value.filter((_, i) => i !== index)])} aria-label={`Make new photo ${index + 1} the main photo`}><Star size={13} /></button>}
        <button type="button" disabled={disabled} className="grid size-7 place-items-center rounded-full bg-white/90 text-slate-700 shadow" onClick={() => { URL.revokeObjectURL(photo.previewUrl); onChange(value.filter((_, i) => i !== index)) }} aria-label={`Remove new photo ${index + 1}`}><X size={13} /></button>
      </span>
    </li>)}</ol>}
    {value.length < MAX_PRODUCT_IMAGES && <div ref={trigger}><PhotoSources compact multiple disabled={disabled} onPrepared={(photos, source) => setReview({ photos, source })} /></div>}
    {review && <ReviewPhotos photos={review.photos} source={review.source} busy={false} progress="" error="" confirmLabel={review.photos.length > 1 ? `Add ${review.photos.length} photos` : 'Use photo'}
      onRemove={index => { URL.revokeObjectURL(review.photos[index].previewUrl); setReview({ ...review, photos: review.photos.filter((_, i) => i !== index) }) }}
      onCancel={() => { review.photos.forEach(photo => URL.revokeObjectURL(photo.previewUrl)); setReview(null) }}
      onRetake={() => { review.photos.forEach(photo => URL.revokeObjectURL(photo.previewUrl)); setReview(null); trigger.current?.querySelector<HTMLButtonElement>('button')?.click() }}
      onConfirm={() => { onChange([...value, ...review.photos].slice(0, MAX_PRODUCT_IMAGES)); setReview(null) }} />}
  </div>
}

/** Uploads photos chosen before the product existed. Returns a message describing any that failed. */
export async function uploadPendingPhotos(bookId: number, photos: PreparedImage[]): Promise<string> {
  const failed: string[] = []
  for (const photo of photos) {
    try { await productImagesApi.upload(bookId, photo.blob, photo.name) } catch (e) { failed.push(errorMessage(e)) }
    URL.revokeObjectURL(photo.previewUrl)
  }
  return failed.length ? `The product was saved, but ${failed.length} photo(s) could not be uploaded: ${failed[0]} You can add them from Products & Books.` : ''
}

