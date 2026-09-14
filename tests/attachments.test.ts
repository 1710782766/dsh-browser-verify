import { describe, expect, it } from 'vitest'
import { AttachmentError, AttachmentId } from '@deepseek-ai/dsh-attachment'
import { assertImageCapable, imageRefFromValue, renderScreenshotBlocks, saveScreenshot, screenshotValueFrom } from '../src/attachments.ts'

describe('attachments', () => {
  it('brands a value into a durable attachment ref', () => {
    const ref = imageRefFromValue({
      attachmentId: 'sha256:abc', mediaType: 'image/png' as const,
      bytes: 10, width: 390, height: 844, name: 'empty.png',
    })
    expect(ref.attachmentId).toBe('sha256:abc')
    expect(ref.name).toBe('empty.png')
  })

  it('renders text envelope plus an image block', () => {
    const blocks = renderScreenshotBlocks({
      image: { attachmentId: 'sha256:abc', mediaType: 'image/png' as const, bytes: 10, width: 390, height: 844 },
      sha256: 'sha256:abc', identicalToPrevious: false,
    })
    expect(blocks[0]).toMatchObject({ type: 'text' })
    expect(blocks[1]).toMatchObject({ type: 'image' })
  })

  it('flags duplicate screenshots in the text envelope', () => {
    const blocks = renderScreenshotBlocks({
      image: { attachmentId: 'sha256:abc', mediaType: 'image/png' as const, bytes: 10, width: 390, height: 844 },
      sha256: 'sha256:abc', identicalToPrevious: true,
    })
    expect(blocks[0]).toMatchObject({ type: 'text', text: expect.stringMatching(/疑似页面未刷新/) })
  })

  it('copies every stored fact instead of restating the capture format', () => {
    // Regression: the returned format used to be the literal 'image/png' while
    // the store had normalized an oversized capture to JPEG, so the reference
    // written into history disagreed with the stored bytes (the read path
    // re-derives them) and every later request on that session failed.
    const value = screenshotValueFrom({
      attachmentId: AttachmentId('sha256:abc'), mediaType: 'image/jpeg',
      bytes: 580417, width: 2442, height: 1717, originalDimensions: { width: 2560, height: 1800 },
    }, 'sha256:abc', false)
    expect(value.image).toEqual({
      attachmentId: 'sha256:abc', mediaType: 'image/jpeg',
      bytes: 580417, width: 2442, height: 1717, originalDimensions: { width: 2560, height: 1800 },
    })
  })

  it('publishes a WebP re-encode (alpha capture) and names the downscale', () => {
    const value = screenshotValueFrom({
      attachmentId: AttachmentId('sha256:alpha'), mediaType: 'image/webp',
      bytes: 1200, width: 1024, height: 512, originalDimensions: { width: 1280, height: 640 },
    }, 'sha256:alpha', false)
    const blocks = renderScreenshotBlocks(value)
    expect(blocks[0]).toMatchObject({ text: expect.stringContaining('image/webp, 1024x512 px（原图 1280x640，已按宿主预算缩放）') })
    expect(blocks[1]).toMatchObject({
      type: 'image',
      attachment: { mediaType: 'image/webp', width: 1024, height: 512, originalDimensions: { width: 1280, height: 640 } },
    })
  })

  it('leaves the envelope untouched when the store did not rescale', () => {
    const value = screenshotValueFrom({
      attachmentId: AttachmentId('sha256:plain'), mediaType: 'image/png',
      bytes: 10, width: 390, height: 844,
    }, 'sha256:plain', false)
    expect(renderScreenshotBlocks(value)[0]).toMatchObject({ text: expect.stringContaining('image/png, 390x844 px, 10 bytes') })
  })

  it('maps store refusal codes to actionable messages', async () => {
    const ctx = {
      get(service: string) {
        if (service === 'attachments') {
          return {
            saveImage: async () => {
              throw new AttachmentError('too big', 'IMAGE_TOO_LARGE')
            },
          }
        }
        return undefined
      },
    }
    let message = ''
    try {
      await saveScreenshot(ctx as never, Buffer.from('x'), undefined)
    } catch (error) {
      message = (error as Error).message
    }
    expect(message.startsWith('browser-verify: ')).toBe(true)
    expect(message).toContain('fullPage')
    expect(message).toMatch(/重试/)
  })

  it('fails actionably when the model route is unresolvable', async () => {
    const ctx = { get: () => undefined }
    let message = ''
    try {
      await assertImageCapable(ctx as never, {})
    } catch (error) {
      message = (error as Error).message
    }
    expect(message.startsWith('browser-verify: ')).toBe(true)
    expect(message).toMatch(/重试/)
  })

  it('rejects text-only models with a usable hint', async () => {
    const ctx = {
      get(service: string) {
        if (service === 'llm') {
          return { resolveModelInfo: async () => ({ inputModalities: ['text'] }) }
        }
        return undefined
      },
    }
    const exec = { agent: { options: { provider: 'p', model: 'm' } } }
    let message = ''
    try {
      await assertImageCapable(ctx as never, exec as never)
    } catch (error) {
      message = (error as Error).message
    }
    expect(message).toContain('不支持看图')
  })

  it('persists screenshot bytes into the attachment store', async () => {
    const saved = {
      attachmentId: AttachmentId('sha256:abc'),
      mediaType: 'image/png' as const,
      bytes: 10,
      width: 390,
      height: 844,
      name: 'empty.png',
    }
    let submitted: { mediaType?: string } = {}
    const ctx = {
      get(service: string) {
        if (service === 'attachments') {
          return { saveImage: async (input: { mediaType?: string }) => { submitted = input; return saved } }
        }
        return undefined
      },
    }
    await expect(saveScreenshot(ctx as never, Buffer.from('x'), 'empty.png')).resolves.toBe(saved)
    // Playwright really does capture PNG: the declaration is the request, not the result.
    expect(submitted.mediaType).toBe('image/png')
  })

  it('fails actionably when the attachment store is not mounted', async () => {
    let message = ''
    try {
      await saveScreenshot({ get: () => undefined } as never, Buffer.from('x'), undefined)
    } catch (error) {
      message = (error as Error).message
    }
    expect(message).toContain('附件存储未挂载')
  })

  it('maps dimension/pixel refusal codes to resize hints', async () => {
    for (const code of ['IMAGE_DIMENSION_TOO_LARGE', 'IMAGE_TOO_MANY_PIXELS']) {
      const ctx = {
        get(service: string) {
          if (service === 'attachments') {
            return {
              saveImage: async () => { throw new AttachmentError('too many px', code as never) },
            }
          }
          return undefined
        },
      }
      let message = ''
      try {
        await saveScreenshot(ctx as never, Buffer.from('x'), undefined)
      } catch (error) {
        message = (error as Error).message
      }
      expect(message).toContain('尺寸')
      expect(message).toContain('fullPage')
    }
  })

  it('maps a format-mismatch refusal to a rerun hint', async () => {
    const ctx = {
      get(service: string) {
        if (service === 'attachments') {
          return {
            saveImage: async () => { throw new AttachmentError('format', 'IMAGE_TYPE_MISMATCH' as never) },
          }
        }
        return undefined
      },
    }
    let message = ''
    try {
      await saveScreenshot(ctx as never, Buffer.from('x'), undefined)
    } catch (error) {
      message = (error as Error).message
    }
    expect(message).toContain('格式校验失败')
    expect(message).toContain('重试')
  })

  it('rethrows non-AttachmentError store failures unchanged', async () => {
    const boom = new Error('store exploded')
    const ctx = {
      get(service: string) {
        if (service === 'attachments') return { saveImage: async () => { throw boom } }
        return undefined
      },
    }
    let caught: unknown
    try {
      await saveScreenshot(ctx as never, Buffer.from('x'), undefined)
    } catch (error) {
      caught = error
    }
    expect(caught).toBe(boom)
  })
})
