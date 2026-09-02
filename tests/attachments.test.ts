import { describe, expect, it } from 'vitest'
import { imageRefFromValue, renderScreenshotBlocks } from '../src/attachments.ts'

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
})
