import { beforeEach, describe, expect, it, vi } from 'vitest'
import { toPDF } from '@opencalque/core'
import { exportPdf } from './actions'
import { pdfFonts } from './pdfFonts'
import { platform } from './platform'
import { toast } from './store'

vi.mock('@opencalque/core', async (original) => ({
  ...await original<typeof import('@opencalque/core')>(),
  pdfFontCharacters: vi.fn(() => ['中']),
  toPDF: vi.fn(() => new Uint8Array([37, 80, 68, 70])),
}))
vi.mock('./canvas/draw', () => ({ gridStep: vi.fn() }))
vi.mock('./prefs', () => ({ usePrefs: { getState: () => ({}) } }))
vi.mock('./pdfFonts', () => ({ pdfFonts: vi.fn() }))
vi.mock('./platform', () => ({ platform: { save: vi.fn() } }))
vi.mock('./store', () => ({
  useStore: {
    getState: () => ({ doc: { name: 'Drawing', nodes: { sheet: { id: 'sheet', type: 'paper' } } }, selection: [] }),
    subscribe: vi.fn(),
  },
  registry: {},
  toast: vi.fn(),
}))

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(pdfFonts).mockResolvedValue([])
  vi.mocked(platform.save).mockResolvedValue({ name: 'Drawing.pdf', token: null })
})

describe('canceling a PDF export', () => {
  it('stops waiting promptly and never saves when the shared font finishes later', async () => {
    const font = deferred<Uint8Array[]>()
    vi.mocked(pdfFonts).mockReturnValue(font.promise)
    const controller = new AbortController()
    const result = exportPdf(undefined, undefined, controller.signal)
    await vi.waitFor(() => expect(pdfFonts).toHaveBeenCalledOnce())
    controller.abort()
    expect(await result).toBe(false)
    font.resolve([])
    await font.promise
    expect(toPDF).not.toHaveBeenCalled()
    expect(platform.save).not.toHaveBeenCalled()
    expect(toast).not.toHaveBeenCalled()
  })

  it('lets a new export use the same font promise after the first is canceled', async () => {
    const font = deferred<Uint8Array[]>()
    vi.mocked(pdfFonts).mockReturnValue(font.promise)
    const controller = new AbortController()
    const canceled = exportPdf(undefined, undefined, controller.signal)
    await vi.waitFor(() => expect(pdfFonts).toHaveBeenCalledOnce())
    controller.abort()
    const retry = exportPdf()
    font.resolve([])
    expect(await canceled).toBe(false)
    expect(await retry).toBe(true)
    expect(toPDF).toHaveBeenCalledOnce()
    expect(platform.save).toHaveBeenCalledOnce()
  })

  it.each(['fonts', 'rendering', 'saving'] as const)('checks cancellation at the %s boundary', async (stopAt) => {
    const controller = new AbortController()
    const result = await exportPdf(undefined, async (stage) => {
      if (stage === stopAt) controller.abort()
    }, controller.signal)
    expect(result).toBe(false)
    expect(platform.save).not.toHaveBeenCalled()
    if (stopAt !== 'saving') expect(toPDF).not.toHaveBeenCalled()
    expect(toast).not.toHaveBeenCalled()
  })

  it('does no work for an already canceled export', async () => {
    const controller = new AbortController()
    controller.abort()
    expect(await exportPdf(undefined, undefined, controller.signal)).toBe(false)
    expect(pdfFonts).not.toHaveBeenCalled()
    expect(platform.save).not.toHaveBeenCalled()
  })

  it('ignores a late font failure after cancellation', async () => {
    const font = deferred<Uint8Array[]>()
    vi.mocked(pdfFonts).mockReturnValue(font.promise)
    const controller = new AbortController()
    const result = exportPdf(undefined, undefined, controller.signal)
    await vi.waitFor(() => expect(pdfFonts).toHaveBeenCalledOnce())
    controller.abort()
    expect(await result).toBe(false)
    font.reject(new Error('Font unavailable'))
    await Promise.resolve()
    expect(platform.save).not.toHaveBeenCalled()
    expect(toast).not.toHaveBeenCalled()
  })

  it('reports a real font failure, and allows a later attempt', async () => {
    vi.mocked(pdfFonts).mockRejectedValueOnce(new Error('Font unavailable'))
    expect(await exportPdf()).toBe(false)
    expect(toast).toHaveBeenCalledWith('Font unavailable')
    expect(platform.save).not.toHaveBeenCalled()
    expect(await exportPdf()).toBe(true)
  })

  it('returns false when the native save dialog is canceled', async () => {
    vi.mocked(platform.save).mockResolvedValue(null)
    expect(await exportPdf()).toBe(false)
    expect(toast).not.toHaveBeenCalled()
  })
})
