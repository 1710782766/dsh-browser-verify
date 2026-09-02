import { describe, expect, it } from 'vitest'
import { AttachmentError, AttachmentId } from '@deepseek-ai/dsh-attachment'
import { assertImageCapable, imageRefFromValue, renderScreenshotBlocks, saveScreenshot } from '../src/attachments.ts'

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
    const ctx = {
      get(service: string) {
        if (service === 'attachments') return { saveImage: async () => saved }
        return undefined
      },
    }
    await expect(saveScreenshot(ctx as never, Buffer.from('x'), 'empty.png')).resolves.toBe(saved)
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
