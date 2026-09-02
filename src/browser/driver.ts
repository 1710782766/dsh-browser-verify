/**
 * Browser driving: one lazy launch per process, one active verification
 * scenario, FIFO-serialized tool access, idle reclamation, graceful close +
 * temp dir removal on dispose. launch args are pure for unit tests.
 * @module dsh-browser-verify/browser/driver
 */

import { exec } from 'node:child_process'
import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium, type Browser } from 'playwright-core'
import { discoverBrowser } from './discover.ts'
import { Scenario, type OpenResult } from './scenario.ts'

export function buildLaunchArgs(userDataDir: string, executablePath: string, headlessShell: boolean): string[] {
  return [
    `--user-data-dir=${userDataDir}`,
    headlessShell ? '--headless' : '--headless=new',
  ]
}

/** Best-effort SIGKILL of a pid and its descendants (macOS ps). */
export async function killProcessTree(pid: number): Promise<void> {
  const out = await new Promise<string>((resolve) => {
    exec('ps -Ao pid=,ppid=,command=', { maxBuffer: 10 * 1024 * 1024 }, (error, stdout) => resolve(error ? String(error.message) : stdout))
  })
  const children = new Map<number, number[]>()
  for (const line of out.split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)/.exec(line)
    if (m === null) continue
    const child = Number(m[1]); const parent = Number(m[2])
    const list = children.get(parent) ?? []
    list.push(child)
    children.set(parent, list)
  }
  const toKill: number[] = [pid]
  for (let i = 0; i < toKill.length; i++) {
    const next = children.get(toKill[i])
    if (next !== undefined) toKill.push(...next)
  }
  for (const target of toKill.reverse()) {
    try { process.kill(target, 'SIGKILL') } catch { /* already gone */ }
  }
}

export class BrowserDriver {
  private browser: Browser | null = null
  private scenario: Scenario | null = null
  private readonly userDataDir = join(tmpdir(), `dsh-browser-verify-${process.pid}`, 'profile')
  private idleTimer: NodeJS.Timeout | null = null
  private lockChain: Promise<unknown> = Promise.resolve()
  private disposed = false

  constructor(
    private readonly opts: {
      discover?: typeof discoverBrowser
      viewport?: { width: number; height: number }
      deviceScaleFactor?: number
      timeoutMs?: number
      idleMs?: number
    } = {},
  ) {}

  /** FIFO serialization: every tool op runs alone. */
  private chain<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.lockChain.then(fn)
    this.lockChain = run.catch(() => undefined)
    return run
  }

  /** Reject new op entries once disposed; the engine cannot come back. */
  private ensureNotDisposed(): void {
    if (this.disposed) {
      throw new Error('browser-verify: 验证引擎已停止。请重新调用 browser_open 开始新的验证。')
    }
  }

  /** Normalize errors at the driver boundary: prefix + context + advice. */
  private wrapError(error: unknown, context: string, advice: string): Error {
    if (error instanceof Error && error.message.startsWith('browser-verify: ')) return error
    const message = error instanceof Error ? error.message : String(error)
    return new Error(`browser-verify: ${context}: ${message}。${advice}`)
  }

  withScenario<T>(fn: (scenario: Scenario) => Promise<T>): Promise<T> {
    this.ensureNotDisposed()
    return this.chain(async () => {
      this.ensureNotDisposed()
      this.resetIdleTimer()
      try {
        return await fn(this.requireScenario())
      } catch (error) {
        throw this.wrapError(error, '场景操作失败', '请 browser_open 重开场景后重试。')
      }
    })
  }

  /** Open a fresh verification scenario; per design, each open = new context+page. */
  async startScenario(reset: { url: string; waitSelector?: string; timeoutMs?: number }): Promise<OpenResult> {
    this.ensureNotDisposed()
    return this.chain(async () => {
      this.ensureNotDisposed()
      this.resetIdleTimer()
      return this.openScenario(reset)
    })
  }

  private async openScenario(reset: { url: string; waitSelector?: string; timeoutMs?: number }): Promise<OpenResult> {
    const browser = await this.ensureBrowser()
    await this.scenario?.close()
    const context = await browser.newContext({
      viewport: this.opts.viewport ?? { width: 390, height: 844 },
      deviceScaleFactor: this.opts.deviceScaleFactor ?? 2,
    })
    const page = await context.newPage()
    this.scenario = new Scenario(page, context)
    this.resetIdleTimer()
    try {
      return await this.scenario.navigate({
        url: reset.url,
        waitSelector: reset.waitSelector,
        timeoutMs: reset.timeoutMs ?? this.opts.timeoutMs,
      })
    } catch (error) {
      await this.scenario.close()
      this.scenario = null
      throw this.wrapError(error, '打开页面失败', '请检查 URL 是否可访问、页面是否可在超时内加载，必要时调大 DSH_BROWSER_VERIFY_TIMEOUT。')
    }
  }

  private resetIdleTimer(): void {
    if (this.idleTimer !== null) clearTimeout(this.idleTimer)
    this.idleTimer = setTimeout(() => { void this.dispose() }, this.opts.idleMs ?? 600000)
  }

  async ensureBrowser(): Promise<Browser> {
    this.ensureNotDisposed()
    if (this.browser !== null) return this.browser
    try {
      const found = (this.opts.discover ?? discoverBrowser)()
      this.browser = await chromium.launch({
        executablePath: found.executablePath,
        args: buildLaunchArgs(this.userDataDir, found.executablePath, found.kind === 'headless-shell'),
      })
    } catch (error) {
      throw this.wrapError(error, '浏览器启动失败', '请检查 DSH_BROWSER_VERIFY_CHROMIUM 指向的浏览器路径，或重新执行 npx playwright install chromium。')
    }
    this.resetIdleTimer()
    return this.browser
  }

  private requireScenario(): Scenario {
    if (this.scenario === null) {
      throw new Error('browser-verify: 尚未打开验证会话。请先调用 browser_open 打开页面。')
    }
    return this.scenario
  }

  /**
   * Reset on dispose: mark disposed first (idempotent, blocks new ops), then
   * run the teardown serialized on the FIFO chain so it waits out any
   * in-flight op and cannot interleave with a launch or scenario op.
   */
  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    await this.chain(() => this.teardown())
  }

  /** Best-effort teardown: close scenario + browser, delete the profile dir. */
  private async teardown(): Promise<void> {
    if (this.idleTimer !== null) { clearTimeout(this.idleTimer); this.idleTimer = null }
    const scenario = this.scenario
    this.scenario = null
    if (scenario !== null) { try { await scenario.close() } catch { /* ignore */ } }
    const browser = this.browser
    this.browser = null
    if (browser !== null) { try { await browser.close() } catch { /* ignore */ } }
    try { rmSync(join(tmpdir(), `dsh-browser-verify-${process.pid}`), { recursive: true, force: true }) } catch { /* ignore */ }
  }
}
