/**
 * Screenshot persistence + model projection, mirroring the read_image output
 * direction: save into the durable attachment store, render a text envelope
 * beside the image block the harness projects into the next model request.
 * @module dsh-browser-verify/attachments
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ImageAttachmentRef, ImageMediaType } from '@deepseek-ai/dsh-attachment'
import { AttachmentError, AttachmentId } from '@deepseek-ai/dsh-attachment'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'

/**
 * Formats a stored screenshot can carry: Playwright captures PNG, and the
 * attachment store re-encodes above its normalization budget (JPEG, or WebP
 * when the source keeps alpha). Every entry is a possible store fact — never
 * assume PNG.
 */
export const SCREENSHOT_MEDIA_TYPES = [
  'image/png', 'image/jpeg', 'image/webp', 'image/gif',
] as const satisfies readonly ImageMediaType[]

export interface ScreenshotImage {
  attachmentId: string
  mediaType: ImageMediaType
  bytes: number
  width: number
  height: number
  name?: string
  /** Present only when the store downscaled the capture; the pre-scaling pixels. */
  originalDimensions?: { width: number; height: number }
}

export interface ScreenshotValue {
  image: ScreenshotImage
  sha256: string
  identicalToPrevious: boolean
}

export function imageRefFromValue(image: ScreenshotImage): ImageAttachmentRef {
  return {
    attachmentId: AttachmentId(image.attachmentId),
    mediaType: image.mediaType,
    bytes: image.bytes,
    width: image.width,
    height: image.height,
    ...image.name === undefined ? {} : { name: image.name },
    ...image.originalDimensions === undefined ? {} : { originalDimensions: image.originalDimensions },
  }
}

/**
 * Build the tool value from the store reference alone. Every fact — format,
 * byte length, dimensions — is copied from what the store actually published,
 * because the read path re-derives them from the stored bytes and rejects any
 * reference that disagrees. Restating a constant here (e.g. PNG for a capture
 * the store normalized to JPEG) writes a self-contradicting attachment
 * reference into immutable history, which fails every later model request.
 * @param ref - reference returned by `saveImage`.
 * @param sha256 - digest of the captured bytes.
 * @param identicalToPrevious - whether this capture repeated the previous one.
 * @returns the tool-facing value projected into the model context.
 */
export function screenshotValueFrom(
  ref: ImageAttachmentRef,
  sha256: string,
  identicalToPrevious: boolean,
): ScreenshotValue {
  return {
    image: {
      attachmentId: String(ref.attachmentId),
      mediaType: ref.mediaType,
      bytes: ref.bytes,
      width: ref.width,
      height: ref.height,
      ...ref.name === undefined ? {} : { name: ref.name },
      ...ref.originalDimensions === undefined ? {} : { originalDimensions: ref.originalDimensions },
    },
    sha256,
    identicalToPrevious,
  }
}

export function renderScreenshotBlocks(value: ScreenshotValue): ContentBlock[] {
  const dup = value.identicalToPrevious
    ? '（与上一张截图哈希相同，疑似页面未刷新；请 browser_open 重开场景后重试）'
    : ''
  const original = value.image.originalDimensions
  const scaled = original === undefined ? '' : `（原图 ${original.width}x${original.height}，已按宿主预算缩放）`
  return [
    {
      type: 'text',
      text: `<type>screenshot</type>\n<content>\n${value.image.mediaType}, ${value.image.width}x${value.image.height} px${scaled}, ${value.image.bytes} bytes, sha256 ${value.sha256.slice(0, 12)}${dup}\n</content>`,
    },
    { type: 'image', attachment: imageRefFromValue(value.image) },
  ]
}

/** Persist screenshot bytes, mapping store refusals to actionable errors. */
export async function saveScreenshot(ctx: Context, data: Buffer, name: string | undefined): Promise<ImageAttachmentRef> {
  const attachments = ctx.get('attachments')
  if (attachments === undefined) {
    throw new Error('browser-verify: 附件存储未挂载，无法持久化截图。请检查当前 DSH 组合是否包含 attachment 插件。')
  }
  try {
    return await attachments.saveImage({ data, mediaType: 'image/png', ...name === undefined ? {} : { name } })
  } catch (error: unknown) {
    if (!(error instanceof AttachmentError)) throw error
    if (error.code === 'IMAGE_TOO_LARGE') {
      throw new Error('browser-verify: 截图超过 attachment 存储字节上限。请改用 fullPage:false 或调低 deviceScaleFactor 后重试。', { cause: error })
    }
    if (error.code === 'IMAGE_DIMENSION_TOO_LARGE' || error.code === 'IMAGE_TOO_MANY_PIXELS') {
      throw new Error('browser-verify: 截图尺寸超过 attachment 存储限制。请改用 fullPage:false 或调低 deviceScaleFactor 后重试。', { cause: error })
    }
    if (error.code === 'IMAGE_TYPE_MISMATCH') {
      throw new Error(`browser-verify: 截图格式校验失败：${error.message} 请改用其他附件类型或重试。`, { cause: error })
    }
    throw error
  }
}

/** Gate: the calling route must be able to see image input (mirror of read-image). */
export async function assertImageCapable(
  ctx: Context,
  exec: { agent?: { session?: { requestHeader?: () => { config?: { provider?: string; model?: string } } | undefined }; options?: { provider?: string; model?: string } } },
): Promise<void> {
  const routed = exec.agent?.session?.requestHeader?.()?.config
  const provider = routed?.provider ?? exec.agent?.options?.provider
  const model = routed?.model ?? exec.agent?.options?.model
  const llm = ctx.get('llm')
  if (provider === undefined || model === undefined || llm === undefined) {
    throw new Error('browser-verify: 无法解析当前模型路由（或模型服务未挂载），无法判断图片输入能力。请检查当前会话的模型路由配置后重试。')
  }
  const active = await llm.resolveModelInfo(provider, model)
  if (active.inputModalities === undefined || !active.inputModalities.includes('image')) {
    throw new Error('browser-verify: 当前模型不支持看图：请改用 browser_assert 做文本断言（更省 token），或切换到图片模型后重试。')
  }
}
