import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NewProductPhotos, ProductImageManager, ProductThumb } from './product-photos'
import { prepareImage, productImagesApi, type ProductImage } from '../lib/product-images'

vi.mock('../lib/product-images', async importOriginal => ({ ...await importOriginal<typeof import('../lib/product-images')>(),
  prepareImage: vi.fn(),
  productImagesApi: { list: vi.fn(), upload: vi.fn(), replace: vi.fn(), makePrimary: vi.fn(), reorder: vi.fn(), remove: vi.fn() } }))

const image = (id: number, patch: Partial<ProductImage> = {}): ProductImage => ({ id, book_id: 5, is_primary: false, sort_order: id, width: 1600, height: 1200, size_bytes: 120000,
  original_name: `photo-${id}.jpg`, image_url: `/api/product-images/${id}/large?signature=a`, thumb_url: `/api/product-images/${id}/thumb?signature=a`, created_at: '2026-11-16T08:00:00Z', ...patch })
const file = (name: string) => new File(['photo-bytes'], name, { type: 'image/jpeg' })

beforeEach(() => {
  vi.resetAllMocks()
  URL.createObjectURL = vi.fn(() => `blob:preview-${Math.random()}`)
  URL.revokeObjectURL = vi.fn()
  vi.mocked(prepareImage).mockImplementation(async (f: File) => ({ blob: f, name: f.name, previewUrl: `blob:${f.name}`, width: 2048, height: 1536 }))
})

describe('ProductThumb', () => {
  it('shows the photo, or a placeholder when there is none', () => {
    const { container, rerender } = render(<ProductThumb url="/api/product-images/3/thumb?signature=x" alt="Cover" />)
    expect(screen.getByRole('img', { name: 'Cover' })).toHaveAttribute('src', '/api/product-images/3/thumb?signature=x')
    rerender(<ProductThumb url={null} />)
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('svg')).not.toBeNull()
  })
})

describe('Product photo manager', () => {
  it('takes a photo with the phone camera, allows a retake and uploads after confirmation', async () => {
    vi.mocked(productImagesApi.list).mockResolvedValue([])
    vi.mocked(productImagesApi.upload).mockResolvedValue({ data: [image(1, { is_primary: true })] })
    const user = userEvent.setup()
    const { container } = render(<ProductImageManager bookId={5} title="Grade 7 Science" canEdit />)
    expect(await screen.findByText(/No photos yet/)).toBeInTheDocument()
    const camera = container.querySelector<HTMLInputElement>('input[capture="environment"]')!
    expect(camera).toHaveAttribute('accept', 'image/*')

    await user.click(screen.getByRole('button', { name: 'Take Photo' }))
    await user.upload(camera, file('IMG_0001.jpg'))
    let dialog = await screen.findByRole('dialog', { name: 'Use this photo?' })
    expect(within(dialog).getByRole('img', { name: 'Preview 1' })).toHaveAttribute('src', 'blob:IMG_0001.jpg')
    expect(productImagesApi.upload).not.toHaveBeenCalled()

    await user.click(within(dialog).getByRole('button', { name: /Retake/ }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await user.upload(camera, file('IMG_0002.jpg'))
    dialog = await screen.findByRole('dialog', { name: 'Use this photo?' })
    await user.click(within(dialog).getByRole('button', { name: 'Use photo' }))

    await waitFor(() => expect(productImagesApi.upload).toHaveBeenCalledWith(5, expect.any(File), 'IMG_0002.jpg', expect.any(Function)))
    expect(await screen.findByText('Photo added.')).toBeInTheDocument()
    expect(screen.getByText('Main')).toBeInTheDocument()
  })

  it('uploads several gallery photos in one go', async () => {
    vi.mocked(productImagesApi.list).mockResolvedValue([])
    vi.mocked(productImagesApi.upload).mockResolvedValueOnce({ data: [image(1, { is_primary: true })] }).mockResolvedValueOnce({ data: [image(1, { is_primary: true }), image(2)] })
    const user = userEvent.setup()
    const { container } = render(<ProductImageManager bookId={5} title="Grade 7 Science" canEdit />)
    await screen.findByText(/No photos yet/)
    const gallery = container.querySelector<HTMLInputElement>('input[type="file"][multiple]')!
    await user.upload(gallery, [file('front.jpg'), file('back.jpg')])
    const dialog = await screen.findByRole('dialog', { name: 'Use these 2 photos?' })
    expect(within(dialog).queryByRole('button', { name: /Retake/ })).not.toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Upload 2 photos' }))
    await waitFor(() => expect(productImagesApi.upload).toHaveBeenCalledTimes(2))
    expect(await screen.findByText('2 photos added.')).toBeInTheDocument()
  })

  it('makes a photo the main one, reorders, and removes only after confirming', async () => {
    vi.mocked(productImagesApi.list).mockResolvedValue([image(1, { is_primary: true }), image(2)])
    vi.mocked(productImagesApi.makePrimary).mockResolvedValue({ message: 'Main photo updated.', data: [image(1), image(2, { is_primary: true })] })
    vi.mocked(productImagesApi.reorder).mockResolvedValue({ message: 'Photo order saved.', data: [image(2, { is_primary: true }), image(1)] })
    vi.mocked(productImagesApi.remove).mockResolvedValue({ message: 'Photo removed. The product was not changed.', data: [image(2, { is_primary: true })] })
    const user = userEvent.setup()
    render(<ProductImageManager bookId={5} title="Grade 7 Science" canEdit />)

    await user.click(await screen.findByRole('button', { name: 'Make photo 2 the main photo' }))
    expect(productImagesApi.makePrimary).toHaveBeenCalledWith(5, 2)
    await user.click(screen.getByRole('button', { name: 'Move photo 2 earlier' }))
    expect(productImagesApi.reorder).toHaveBeenCalledWith(5, [2, 1])

    await user.click(screen.getByRole('button', { name: 'Remove photo 2' }))
    const confirm = await screen.findByRole('dialog', { name: 'Remove this photo?' })
    expect(within(confirm).getByText(/The product, its stock and its sales are not affected/)).toBeInTheDocument()
    expect(productImagesApi.remove).not.toHaveBeenCalled()
    await user.click(within(confirm).getByRole('button', { name: /Remove photo/ }))
    expect(productImagesApi.remove).toHaveBeenCalledWith(5, 1)
    expect(await screen.findByText('Photo removed. The product was not changed.')).toBeInTheDocument()
  })

  it('shows server validation errors without losing the preview', async () => {
    vi.mocked(productImagesApi.list).mockResolvedValue([])
    vi.mocked(productImagesApi.upload).mockRejectedValue(new Error('The file is not a JPEG, PNG or WebP image.'))
    const user = userEvent.setup()
    const { container } = render(<ProductImageManager bookId={5} title="Grade 7 Science" canEdit />)
    await screen.findByText(/No photos yet/)
    await user.upload(container.querySelector<HTMLInputElement>('input[capture]')!, file('IMG.jpg'))
    const dialog = await screen.findByRole('dialog', { name: 'Use this photo?' })
    await user.click(within(dialog).getByRole('button', { name: 'Use photo' }))
    expect(await within(dialog).findByText('The file is not a JPEG, PNG or WebP image.')).toBeInTheDocument()
    expect(within(dialog).getByRole('img', { name: 'Preview 1' })).toBeInTheDocument()
  })

  it('is read-only for staff who cannot manage the catalogue', async () => {
    vi.mocked(productImagesApi.list).mockResolvedValue([image(1, { is_primary: true })])
    render(<ProductImageManager bookId={5} title="Grade 7 Science" canEdit={false} />)
    expect(await screen.findByRole('img', { name: 'Grade 7 Science, photo 1' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Take Photo' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Remove photo/ })).not.toBeInTheDocument()
  })

  it('falls back to the gallery when a computer camera is blocked', async () => {
    vi.mocked(productImagesApi.list).mockResolvedValue([])
    const getUserMedia = vi.fn().mockRejectedValue(Object.assign(new Error('denied'), { name: 'NotAllowedError' }))
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } })
    const user = userEvent.setup()
    render(<ProductImageManager bookId={5} title="Grade 7 Science" canEdit />)
    await user.click(await screen.findByRole('button', { name: 'Take Photo' }))
    expect(await screen.findByText(/Camera access was blocked/)).toBeInTheDocument()
    expect(getUserMedia).toHaveBeenCalled()
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: undefined })
  })
})

describe('Photos for a new product', () => {
  it('collects confirmed photos before the product exists, the first being the main photo', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    const { container, rerender } = render(<NewProductPhotos value={[]} onChange={onChange} />)
    await user.upload(container.querySelector<HTMLInputElement>('input[type="file"][multiple]')!, [file('a.jpg'), file('b.jpg')])
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Add 2 photos' }))
    expect(onChange).toHaveBeenCalledWith([expect.objectContaining({ name: 'a.jpg' }), expect.objectContaining({ name: 'b.jpg' })])
    rerender(<NewProductPhotos value={onChange.mock.calls[0][0]} onChange={onChange} />)
    expect(screen.getByText('Main')).toBeInTheDocument()
    expect(productImagesApi.upload).not.toHaveBeenCalled()
  })
})
