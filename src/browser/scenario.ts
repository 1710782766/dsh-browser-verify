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

export interface MockResult {
  patterns: string[]
  /** True when this call replaced an existing rule for the same pattern. */
  updated: boolean
  /** Requests intercepted since this call started (pattern ← url), bounded. */
  hits: string[]
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
/** Mock-hit lines stay bounded too: 5 entries of 120 chars. */
const MAX_MOCK_HITS = 5
const MAX_HIT_LEN = 120
/** Poll interval and cap for the default render-settled wait (no waitSelector). */
const SETTLE_INTERVAL_MS = 250
const SETTLE_CAP_MS = 3000
/**
 * Loading-state noise (uni-app showLoading / boot toasts) filtered out of the
 * visible summary. Anchored full-string patterns only, so business states like
 * 加载失败 / 加载更多 are never affected.
 */
const NOISE_TEXT_PATTERN = /^(加载中|正在加载|请稍候|loading)[.…]{0,3}$/i

/** True for transient loading-state text that should not pollute the summary. */
export function isNoiseText(text: string): boolean {
  return NOISE_TEXT_PATTERN.test(text)
}

/**
 * One mock-hit line, bounded for token economy. Reading it tells the model
 * whether its pattern actually matched a request — the answer it used to have
 * to guess (probe patterns, re-assert the page, reopen to reset state).
 */
export function formatMockHit(pattern: string, url: string): string {
  const line = `${pattern} ← ${url}`
  return line.length > MAX_HIT_LEN ? `${line.slice(0, MAX_HIT_LEN - 1)}…` : line
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
    if (trimmed === '' || isNoiseText(trimmed)) continue
    const reduced = trimmed.length > MAX_VISIBLE_LEN ? trimmed.slice(0, MAX_VISIBLE_LEN) : trimmed
    if (seen.has(reduced)) continue
    seen.add(reduced)
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
  /** Console errors of the current load only (reset per navigate/reload). */
  private consoleErrors: string[] = []
  /** Mock hits observed during the current load window, tagged by rule. */
  private mockHits: Array<{ pattern: string; line: string }> = []

  constructor(
    readonly page: Page,
    readonly context: BrowserContext,
  ) {
    // Listeners are registered once per page: navigate/reload reuse the same
    // scenario, and re-registering per call would multiply every console error.
    page.on('console', msg => { if (msg.type() === 'error') this.consoleErrors.push(msg.text()) })
    page.on('pageerror', err => this.consoleErrors.push(String(err)))
  }

  /** Start a fresh observation window: per-load errors and mock hits. */
  private beginLoadWindow(): void {
    this.consoleErrors = []
    this.mockHits = []
  }

  private recordMockHit(pattern: string, url: string): void {
    const line = formatMockHit(pattern, url)
    if (this.mockHits.some(hit => hit.line === line)) return
    if (this.mockHits.length >= MAX_MOCK_HITS) return
    this.mockHits.push({ pattern, line })
  }

  /**
   * Hits intercepted during the current load window (bounded copy). Pass a
   * pattern to report only that rule's hits: a `browser_mock` call must answer
   * "did MY glob match anything", not list a neighbouring rule's traffic —
   * otherwise a wrong glob looks like a working one.
   */
  mockHitList(pattern?: string): string[] {
    return this.mockHits
      .filter(hit => pattern === undefined || hit.pattern === pattern)
      .map(hit => hit.line)
  }

  /** Load-wait shared by navigate/reload: explicit selector, else render settle. */
  private async settle(waitSelector: string | undefined, timeout: number): Promise<void> {
    if (waitSelector !== undefined) {
      await this.page.waitForSelector(waitSelector, { timeout })
      return
    }
    // No explicit selector: wait for the page to render-settle instead of
    // snapshotting the boot frame (SPAs like uni-app show skeleton/loading
    // right after domcontentloaded — a 500ms snapshot reads empty).
    await this.waitUntilRendered(timeout)
  }

  private async snapshot(started: number, status: number | null): Promise<OpenResult> {
    const texts = await this.page.evaluate(VISIBLE_TEXT_SCRIPT) as string[]
    return {
      title: await this.page.title(),
      url: this.page.url(),
      status,
      visible: summarizeVisibleText(texts),
      consoleErrors: capConsoleErrors(this.consoleErrors),
      elapsedMs: Date.now() - started,
    }
  }

  async navigate(opts: { url: string; waitSelector?: string; timeoutMs?: number }): Promise<OpenResult> {
    const started = Date.now()
    const timeout = opts.timeoutMs ?? 10000
    this.beginLoadWindow()
    const response = await this.page.goto(opts.url, { waitUntil: 'domcontentloaded', timeout })
    await this.settle(opts.waitSelector, timeout)
    return this.snapshot(started, response?.status() ?? null)
  }

  /**
   * Reload the current page in place: same context, same registered mocks.
   * The cheap path for "code changed, re-verify" — a full browser_open would
   * rebuild the context and drop every mock (forcing a re-register round trip).
   */
  async reload(opts: { waitSelector?: string; timeoutMs?: number } = {}): Promise<OpenResult> {
    const started = Date.now()
    const timeout = opts.timeoutMs ?? 10000
    this.beginLoadWindow()
    const response = await this.page.reload({ waitUntil: 'domcontentloaded', timeout })
    await this.settle(opts.waitSelector, timeout)
    return this.snapshot(started, response?.status() ?? null)
  }

  /**
   * Default settle wait: two consecutive identical non-empty visible-text
   * samples (250ms apart) mean the render stopped changing. Bounded by
   * min(timeoutMs, 3s) — pages that never settle (polling/animations) fall
   * through to the current snapshot instead of burning the whole budget.
   */
  private async waitUntilRendered(timeoutMs: number): Promise<void> {
    const cap = Math.min(timeoutMs, SETTLE_CAP_MS)
    const deadline = Date.now() + cap
    let prev: string | null = null
    for (;;) {
      const sig = (await this.page.evaluate(VISIBLE_TEXT_SCRIPT) as string[]).join('\u0000')
      if (sig !== '') {
        if (prev !== null && sig === prev) return
        prev = sig
      }
      if (Date.now() >= deadline) return
      await new Promise(resolve => setTimeout(resolve, SETTLE_INTERVAL_MS))
    }
  }

  /**
   * Register or update a request mock. Re-registering the same pattern replaces
   * the previous rule (json + status) instead of stacking a second Playwright
   * route: the model could not tell which of two overlapping rules won, so it
   * reopened the page to clear them — the expensive habit this removes.
   */
  async addMock(rule: { urlPattern: string; json: unknown; status?: number; reload?: boolean; timeoutMs?: number }): Promise<MockResult> {
    const status = rule.status ?? 200
    const updated = this.mocks.has(rule.urlPattern)
    if (updated) {
      await this.context.unroute(rule.urlPattern).catch(() => undefined)
    }
    this.mocks.set(rule.urlPattern, { json: rule.json, status })
    await this.context.route(rule.urlPattern, async route => {
      const current = this.mocks.get(rule.urlPattern) ?? { json: rule.json, status }
      this.recordMockHit(rule.urlPattern, route.request().url())
      const body = Buffer.from(JSON.stringify(current.json))
      await route.fulfill({ status: current.status, body, contentType: 'application/json; charset=utf-8' })
    })
    this.beginLoadWindow()
    if (rule.reload !== false) {
      const timeout = rule.timeoutMs ?? 10000
      await this.page.reload({ waitUntil: 'domcontentloaded', timeout })
      // Settle before reporting hits: an SPA fires its boot requests only after
      // the bundle runs, so a bare domcontentloaded would report an empty hit
      // list for a mock that is in fact working.
      await this.settle(undefined, timeout)
    }
    return { patterns: [...this.mocks.keys()], updated, hits: this.mockHitList(rule.urlPattern) }
  }

  async assert(opts: { selector: string; count?: number | { min: number; max: number }; text?: string; timeoutMs: number }): Promise<AssertResult> {
    const started = Date.now()
    const expected = normalizeCountSpec(opts.count)
    try {
      await this.page.waitForSelector(opts.selector, { state: 'attached', timeout: opts.timeoutMs })
    } catch (error) {
      const timedOut = error instanceof Error && /timeout/i.test(error.message)
      // Element never appeared: a normal verification outcome, not a thrown
      // failure. An explicit absence assertion (count 0..0, no text) passes;
      // everything else stays a normal pass:false.
      if (timedOut) {
        return {
          pass: expected !== null && expected.min === 0 && expected.max === 0 && opts.text === undefined,
          count: 0,
          actualText: null,
          elapsedMs: Date.now() - started,
        }
      }
      throw error
    }
    const count = await this.page.locator(opts.selector).count()
    const actualText = await this.page.locator(opts.selector).first().textContent()
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
