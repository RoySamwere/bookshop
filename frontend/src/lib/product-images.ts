import { api, apiUpload } from './api'

export type ProductImage = {
  id: number; book_id: number; is_primary: boolean; sort_order: number; width: number; height: number; size_bytes: number
  original_name: string | null; image_url: string | null; thumb_url: string | null; created_at: string
}
type ImagesResponse = { message?: string; duplicate?: boolean; data: ProductImage[] }

export const MAX_PRODUCT_IMAGES = 8
export const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp']
/** What the server accepts; prepared photos are always well under this. */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024
const PREPARED_EDGE = 2048

export const productImagesApi = {
  list: async (bookId: number) => (await api<ImagesResponse>(`/books/${bookId}/images`)).data,
  upload: (bookId: number, file: Blob, name: string, onProgress?: (fraction: number) => void) => {
    const form = new FormData(); form.append('image', file, name)
    return apiUpload<ImagesResponse>(`/books/${bookId}/images`, form, onProgress)
  },
  replace: (bookId: number, imageId: number, file: Blob, name: string, onProgress?: (fraction: number) => void) => {
    const form = new FormData(); form.append('image', file, name)
    return apiUpload<ImagesResponse>(`/books/${bookId}/images/${imageId}/replace`, form, onProgress)
  },
  makePrimary: (bookId: number, imageId: number) => api<ImagesResponse>(`/books/${bookId}/images/${imageId}/primary`, { method: 'POST' }),
  reorder: (bookId: number, ids: number[]) => api<ImagesResponse>(`/books/${bookId}/images/order`, { method: 'PUT', body: { ids } }),
  remove: (bookId: number, imageId: number) => api<ImagesResponse>(`/books/${bookId}/images/${imageId}`, { method: 'DELETE' }),
}

export type PreparedImage = { blob: Blob; name: string; previewUrl: string; width: number; height: number }

/**
 * Readies a camera or gallery photo for upload: decodes it with the photo's own orientation, scales
 * the long edge to at most 2048 px and re-encodes as JPEG. Small JPEG/PNG/WebP files that need no
 * work are sent as they are. Formats the browser cannot decode are rejected with a clear message.
 */
export async function prepareImage(file: File): Promise<PreparedImage> {
  const supported = ACCEPTED_TYPES.includes(file.type)
  let bitmap: ImageBitmap | null = null
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    if (!supported) throw new Error('This photo format is not supported. Choose a JPEG, PNG or WebP image.')
    if (file.size > MAX_UPLOAD_BYTES) throw new Error('This photo is larger than 10 MB. Choose a smaller photo.')
    return { blob: file, name: file.name, previewUrl: URL.createObjectURL(file), width: 0, height: 0 }
  }
  const { width, height } = bitmap
  if (width < 50 || height < 50) { bitmap.close(); throw new Error('This photo is too small. Use a photo at least 50 pixels wide.') }
  const needsWork = !supported || Math.max(width, height) > PREPARED_EDGE || file.size > 3 * 1024 * 1024
  if (!needsWork) { bitmap.close(); return { blob: file, name: file.name, previewUrl: URL.createObjectURL(file), width, height } }

  const scale = Math.min(1, PREPARED_EDGE / Math.max(width, height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(width * scale); canvas.height = Math.round(height * scale)
  const context = canvas.getContext('2d')
  if (!context) { bitmap.close(); throw new Error('This device could not prepare the photo. Try choosing it from the gallery instead.') }
  context.fillStyle = '#ffffff'; context.fillRect(0, 0, canvas.width, canvas.height)
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.9))
  if (!blob) throw new Error('This device could not prepare the photo. Try choosing it from the gallery instead.')
  const name = file.name.replace(/\.[^.]+$/, '') + '.jpg'
  return { blob, name, previewUrl: URL.createObjectURL(blob), width: canvas.width, height: canvas.height }
}
