/**
 * The four model-facing browser verification tools. Thin shells: validate
 * args, take the driver lock, run the scenario core, translate failures.
 * @module dsh-browser-verify/tools
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { BrowserDriver } from '../browser/driver.ts'
import { assertImageCapable, renderScreenshotBlocks, saveScreenshot } from '../attachments.ts'
import { withTimeout } from './timeout.ts'

const envTimeoutMs = (): number => Number(process.env.DSH_BROWSER_VERIFY_TIMEOUT ?? 10000)
const envIdleMs = (): number => Number(process.env.DSH_BROWSER_VERIFY_IDLE_MS ?? 600000)
const defaultViewport = { width: 390, height: 844 }

export function registerBrowserTools(ctx: Context): void {
  const driver = new BrowserDriver({ timeoutMs: envTimeoutMs(), idleMs: envIdleMs() })
  ctx.effect(() => () => { void driver.dispose() })

  ctx.tools.register(defineTool({
    name: 'browser_open',
    description: '在无头浏览器中打开一个页面并返回页面状态（标题/状态码/可见文本摘要/console 错误）用于验证前端页面；可选 waitSelector 等待关键元素出现，默认视口 390×844 @2x（移动端形态）。可传 mocks 在打开时拦截接口（用于启动即依赖接口数据的页面）。验证顺序：先 browser_assert 做 DOM 断言，确需看版式再 browser_screenshot。',
    parameters: {
      url: { type: 'string', required: true, description: '页面地址，如 http://localhost:5173/hweb/pages/...' },
      viewport: { type: 'object', additionalProperties: true, description: `视口尺寸，默认 ${defaultViewport.width}x${defaultViewport.height}` },
      deviceScaleFactor: { type: 'number', description: '缩放比，默认 2' },
      mocks: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            urlPattern: { type: 'string', required: true },
            json: { type: 'json', required: true },
            status: { type: 'number' },
          },
        },
        description: '可选：页面启动前注册的接口拦截（glob urlPattern + json，如 [{urlPattern: "**/api/*.do*", json: {...}}]）',
      },
      waitSelector: { type: 'string', description: '可选：等待该选择器出现后再返回（优先于固定等待）' },
      timeoutMs: { type: 'number', description: `加载超时，默认 ${envTimeoutMs()}ms` },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          title: { type: 'string', required: true },
          url: { type: 'string', required: true },
          status: { oneOf: [{ type: 'number' }, { type: 'null' }], required: true },
          visible: { type: 'array', items: { type: 'string' }, required: true },
          consoleErrors: { type: 'array', items: { type: 'string' }, required: true },
          elapsedMs: { type: 'number', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args) {
      return withTimeout(
        driver.startScenario({ url: args.url, waitSelector: args.waitSelector, timeoutMs: args.timeoutMs ?? envTimeoutMs(), viewport: args.viewport as { width: number; height: number } | undefined, deviceScaleFactor: args.deviceScaleFactor, mocks: args.mocks }),
        envTimeoutMs(), 'browser_open',
      )
    },
  }))

  ctx.tools.register(defineTool({
    name: 'browser_mock',
    description: '为当前验证场景注册接口拦截并自动重新加载页面：urlPattern 用 playwright glob（如 **/api/lifeIndex.do*），拦截后返回指定 json，用于 mock 空态/异常态。与已注册 pattern 完全相同时报错；请先 browser_open。',
    parameters: {
      urlPattern: { type: 'string', required: true, description: 'glob 模式，如 **/api/lifeIndex.do*' },
      json: { type: 'json', description: '拦截响应体（任意 JSON）', required: true },
      status: { type: 'number', description: '响应状态码，默认 200' },
      reload: { type: 'boolean', description: '注册后自动 reload 当前页，默认 true' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          patterns: { type: 'array', items: { type: 'string' }, required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args) {
      return driver.withScenario(async scenario => ({ patterns: await scenario.addMock({ urlPattern: args.urlPattern, json: args.json, status: args.status, reload: args.reload, timeoutMs: envTimeoutMs() }) }))
    },
  }))

  ctx.tools.register(defineTool({
    name: 'browser_assert',
    description: '对当前页面 DOM 断言：selector 必须存在，可校验匹配数量（count，数字或 {min,max}）与文本包含（text）。不满足时返回 pass:false 并附差异、不抛错。这是最省 token 的验证手段，优先于截图。',
    parameters: {
      selector: { type: 'string', required: true, description: 'CSS 选择器' },
      count: { oneOf: [{ type: 'number' }, { type: 'object', additionalProperties: false, properties: { min: { type: 'number', required: true }, max: { type: 'number', required: true } } }], description: '期望匹配数量：数字=精确，或 {min,max}=范围' },
      text: { type: 'string', description: '期望包含于首个匹配元素文本（contains 谓词）' },
      timeoutMs: { type: 'number', description: '等待选择器出现的超时，默认 5000ms' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          pass: { type: 'boolean', required: true },
          count: { type: 'number', required: true },
          actualText: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
          elapsedMs: { type: 'number', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args) {
      return driver.withScenario(scenario => scenario.assert({
        selector: args.selector, count: args.count, text: args.text, timeoutMs: args.timeoutMs ?? 5000,
      }))
    },
  }))

  ctx.tools.register(defineTool({
    name: 'browser_screenshot',
    description: '截图当前页面并自动投影进模型上下文（图片块），返回尺寸与哈希；与上一张完全一致时 identicalToPrevious:true（疑似页面未刷新，请 browser_open 重开）。仅需要检查版式时使用——能断言就别截图。',
    parameters: {
      name: { type: 'string', description: '可选命名（进入附件名）' },
      fullPage: { type: 'boolean', description: '是否整页截图，默认 false' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          image: {
            type: 'object',
            additionalProperties: false,
            required: true,
            properties: {
              attachmentId: { type: 'string', required: true },
              mediaType: { type: 'string', enum: ['image/png'], required: true },
              bytes: { type: 'integer', required: true },
              width: { type: 'integer', required: true },
              height: { type: 'integer', required: true },
              name: { type: 'string' },
            },
          },
          sha256: { type: 'string', required: true },
          identicalToPrevious: { type: 'boolean', required: true },
        },
      },
      render: (_args, value) => renderScreenshotBlocks(value),
    },
    async execute(args, exec) {
      await assertImageCapable(ctx, exec)
      return driver.withScenario(async scenario => {
        const shot = await scenario.screenshot({ fullPage: args.fullPage })
        const ref = await saveScreenshot(ctx, shot.data, args.name)
        return {
          image: {
            attachmentId: String(ref.attachmentId),
            mediaType: 'image/png' as const,
            bytes: ref.bytes,
            width: ref.width,
            height: ref.height,
            ...ref.name === undefined ? {} : { name: ref.name },
          },
          sha256: shot.sha256,
          identicalToPrevious: shot.identicalToPrevious,
        }
      })
    },
  }))
}
