/**
 * One verification scenario = one page + its request mocks + assertion/shot
 * state. Pure helpers are exported for unit tests; the IO methods use
 * playwright-core. Polluting nothing outside the page's own requests.
 * @module dsh-browser-verify/browser/scenario
 */

import { createHash } from 'node:crypto'
import type { BrowserContext, Page } from 'playwright-core'

export interface MockRule {
  json: unknown
  status: number
}

export interface OpenResult {
  title: string
  url: string
  status: number | null
  visible: string[]
  consoleErrors: string[]
  elapsedMs: number
}

export interface AssertResult {
  pass: boolean
  count: number
  actualText: string | null
  elapsedMs: number
}

const MAX_VISIBLE = 8
const MAX_VISIBLE_LEN = 40
const MAX_ERRORS = 5
const MAX_ERROR_LEN = 120
const MAX_DIFF_LEN = 120

export function assertNoMockConflict(patterns: string[], next: string): void {
  if (patterns.includes(next)) {
    throw new Error(`browser-verify: 拦截 pattern 已存在: ${next}（已有: ${patterns.join(', ')}）。请先 browser_open 重开场景或用不同的 urlPattern。`)
  }
}

export function normalizeCountSpec(count: number | { min: number; max: number } | undefined): { min: number; max: number } | null {
  if (typeof count === 'number') return { min: count, max: count }
  if (count !== undefined && typeof count.min === 'number' && typeof count.max === 'number') return { min: count.min, max: count.max }
  return null
}

export function summarizeVisibleText(texts: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of texts) {
    const trimmed = raw.trim()
    if (trimmed === '') continue
    const reduced = trimmed.length > MAX_VISIBLE_LEN ? trimmed.slice(0, MAX_VISIBLE_LEN) : trimmed
    if (seen.has(raw)) continue
    seen.add(raw)
    out.push(reduced)
    if (out.length >= MAX_VISIBLE) break
  }
  return out
}

export function capConsoleErrors(errors: string[]): string[] {
  return errors.slice(0, MAX_ERRORS).map(e => e.length > MAX_ERROR_LEN ? `${e.slice(0, MAX_ERROR_LEN - 1)}…` : e)
}

export function sha256Hex(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex')
}

export function textDiff(actual: string | null, expected: string): string {
  if (actual === null) return `未找到匹配元素文本（期望包含: ${expected.slice(0, MAX_DIFF_LEN)}）`
  if (actual === expected) return '文本一致'
  const head = actual.length > MAX_DIFF_LEN ? `${actual.slice(0, MAX_DIFF_LEN)}…` : actual
  return `期望包含「${expected.slice(0, MAX_DIFF_LEN)}」，实际: ${head}`
}

/** Visible-text extraction, evaluated in the page: text of visible elements. */
export const VISIBLE_TEXT_SCRIPT = `
Array.from(document.querySelectorAll('body *')).map(el => {
  const rect = el.getBoundingClientRect()
  if (rect.width === 0 || rect.height === 0) return ''
  const text = (el.childElementCount === 0 ? el.textContent ?? '' : '').trim()
  return text.length > 0 ? text : ''
})
`

export class Scenario {
  readonly mocks = new Map<string, MockRule>()
  lastScreenshotHash: string | null = null

  constructor(
    readonly page: Page,
    readonly context: BrowserContext,
  ) {}

  async navigate(opts: { url: string; waitSelector?: string; timeoutMs?: number }): Promise<OpenResult> {
    const started = Date.now()
    const timeout = opts.timeoutMs ?? 10000
    const errors: string[] = []
    const onError = (message: string): void => { errors.push(message) }
    this.page.on('console', msg => { if (msg.type() === 'error') onError(msg.text()) })
    this.page.on('pageerror', err => onError(String(err)))
    const response = await this.page.goto(opts.url, { waitUntil: 'domcontentloaded', timeout })
    if (opts.waitSelector !== undefined) {
      await this.page.waitForSelector(opts.waitSelector, { timeout })
    }
    const texts = await this.page.evaluate(VISIBLE_TEXT_SCRIPT) as string[]
    return {
      title: await this.page.title(),
      url: this.page.url(),
      status: response?.status() ?? null,
      visible: summarizeVisibleText(texts),
      consoleErrors: capConsoleErrors(errors),
      elapsedMs: Date.now() - started,
    }
  }

  async addMock(rule: { urlPattern: string; json: unknown; status?: number; reload?: boolean; timeoutMs?: number }): Promise<string[]> {
    assertNoMockConflict([...this.mocks.keys()], rule.urlPattern)
    const status = rule.status ?? 200
    this.mocks.set(rule.urlPattern, { json: rule.json, status })
    await this.context.route(rule.urlPattern, async route => {
      const body = Buffer.from(JSON.stringify(this.mocks.get(rule.urlPattern)?.json ?? rule.json))
      await route.fulfill({ status, body, contentType: 'application/json; charset=utf-8' })
    })
    if (rule.reload !== false) {
      await this.page.reload({ waitUntil: 'domcontentloaded', timeout: rule.timeoutMs ?? 10000 })
    }
    return [...this.mocks.keys()]
  }

  async assert(opts: { selector: string; count?: number | { min: number; max: number }; text?: string; timeoutMs: number }): Promise<AssertResult> {
    const started = Date.now()
    try {
      await this.page.waitForSelector(opts.selector, { state: 'attached', timeout: opts.timeoutMs })
    } catch (error) {
      const timedOut = error instanceof Error && /timeout/i.test(error.message)
      // Element never appeared: a normal verification outcome, not a thrown failure.
      if (timedOut) return { pass: false, count: 0, actualText: null, elapsedMs: Date.now() - started }
      throw error
    }
    const count = await this.page.locator(opts.selector).count()
    const actualText = await this.page.locator(opts.selector).first().textContent()
    const expected = normalizeCountSpec(opts.count)
    const pass = (expected === null || (count >= expected.min && count <= expected.max))
      && (opts.text === undefined || (actualText !== null && actualText.includes(opts.text)))
    return { pass, count, actualText, elapsedMs: Date.now() - started }
  }

  async screenshot(opts: { fullPage?: boolean }): Promise<{ data: Buffer; sha256: string; identicalToPrevious: boolean }> {
    const data = await this.page.screenshot({ fullPage: opts.fullPage ?? false, type: 'png' })
    const sha256 = sha256Hex(data)
    const identicalToPrevious = sha256 === this.lastScreenshotHash
    this.lastScreenshotHash = sha256
    return { data, sha256, identicalToPrevious }
  }

  async close(): Promise<void> {
    try { await this.context.close() } catch { /* already gone */ }
  }
}
