/**
 * Browser driving: one lazy launch per process, one active verification
 * scenario, FIFO-serialized tool access, idle reclamation, graceful close +
 * temp dir removal on dispose. launch args are pure for unit tests.
 *
 * Two teardown paths, deliberately different:
 * - idle reclamation releases the browser but keeps the engine restartable
 *   (the next browser_open lazily launches again);
 * - disposal (plugin unload) is terminal — the engine cannot come back.
 * @module dsh-browser-verify/browser/driver
 */

import { exec } from 'node:child_process'
import { mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium, type Browser } from 'playwright-core'
import { discoverBrowser, type DiscoveredBrowser } from './discover.ts'
import { Scenario, type OpenResult } from './scenario.ts'

export interface OpenScenarioResult extends OpenResult {
  browserKnown: boolean
  versionHint: string | null
}

/**
 * Headless launch args. Deviation D8-3: playwright-core >= 1.41 rejects
 * `--user-data-dir` inside `args` (misuse error, both launch and
 * launchPersistentContext); the user data dir must be passed as the
 * launchPersistentContext first parameter. Only the headless-mode flag remains.
 */
export function buildLaunchArgs(headlessShell: boolean): string[] {
  return [headlessShell ? '--headless' : '--headless=new']
}

export class BrowserDriver {
  private browser: Browser | null = null
  private discovered: DiscoveredBrowser | null = null
  private scenario: Scenario | null = null
  private readonly userDataDir = join(tmpdir(), `dsh-browser-verify-${process.pid}`, 'profile')
  private idleTimer: NodeJS.Timeout | null = null
  private lockChain: Promise<unknown> = Promise.resolve()
  private disposed = false
  /** Wall clock of the last tool op; the idle reclaim re-checks against it. */
  private lastActivityAt = 0

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

  private get idleMs(): number {
    return this.opts.idleMs ?? 600000
  }

  /**
   * Reject new op entries once the plugin is gone. Only disposal reaches this
   * state: idle reclamation never stops the engine, so a tool call after an
   * idle window still works (browser_open relaunches lazily).
   */
  private ensureNotDisposed(): void {
    if (this.disposed) {
      throw new Error('browser-verify: 浏览器验证引擎已停止（插件已卸载）。请重启 dsh 或重新加载该插件后再试。')
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
      } finally {
        // Finishing an op is activity too: a slow op must not look idle the
        // instant it returns (idleMs can be small in tests or configs).
        if (!this.disposed) this.resetIdleTimer()
      }
    })
  }

  /** Open a fresh verification scenario; per design, each open = new context+page. */
  async startScenario(reset: { url: string; waitSelector?: string; timeoutMs?: number; viewport?: { width: number; height: number }; deviceScaleFactor?: number; mocks?: Array<{ urlPattern: string; json: unknown; status?: number }> }): Promise<OpenScenarioResult> {
    this.ensureNotDisposed()
    return this.chain(async () => {
      this.ensureNotDisposed()
      this.resetIdleTimer()
      try {
        return await this.openScenario(reset)
      } finally {
        if (!this.disposed) this.resetIdleTimer()
      }
    })
  }

  /**
   * Reload the current scenario in place (mocks and page state preserved) and
   * report the same page state as browser_open. The cheap re-verify path after
   * an edit: no context rebuild, no mock re-registration, no URL re-sent.
   */
  async reloadScenario(opts: { waitSelector?: string; timeoutMs?: number } = {}): Promise<OpenResult & { mockHits: string[] }> {
    this.ensureNotDisposed()
    return this.chain(async () => {
      this.ensureNotDisposed()
      this.resetIdleTimer()
      try {
        const scenario = this.requireScenario()
        const reloaded = await scenario.reload({
          waitSelector: opts.waitSelector,
          timeoutMs: opts.timeoutMs ?? this.opts.timeoutMs,
        })
        return { ...reloaded, mockHits: scenario.mockHitList() }
      } catch (error) {
        throw this.wrapError(error, '重新加载页面失败', '请检查页面是否可访问、是否已在超时内加载，必要时调大 DSH_BROWSER_VERIFY_TIMEOUT。')
      } finally {
        if (!this.disposed) this.resetIdleTimer()
      }
    })
  }

  private async openScenario(reset: { url: string; waitSelector?: string; timeoutMs?: number; viewport?: { width: number; height: number }; deviceScaleFactor?: number; mocks?: Array<{ urlPattern: string; json: unknown; status?: number }> }): Promise<OpenScenarioResult> {
    const browser = await this.ensureBrowser()
    await this.scenario?.close()
    const context = await browser.newContext({
      viewport: reset.viewport ?? this.opts.viewport ?? { width: 390, height: 844 },
      deviceScaleFactor: reset.deviceScaleFactor ?? this.opts.deviceScaleFactor ?? 2,
    })
    const page = await context.newPage()
    this.scenario = new Scenario(page, context)
    this.resetIdleTimer()
    try {
      // Deviation D8-5: pre-register mocks before the first navigations so the
      // app boots against mocked APIs (some apps bounce to a fallback route
      // when real APIs answer "session invalid").
      for (const rule of reset.mocks ?? []) {
        await this.scenario.addMock({ ...rule, reload: false })
      }
      const opened = await this.scenario.navigate({
        url: reset.url,
        waitSelector: reset.waitSelector,
        timeoutMs: reset.timeoutMs ?? this.opts.timeoutMs,
      })
      return {
        ...opened,
        browserKnown: this.discovered?.known ?? true,
        versionHint: this.discovered?.versionHint ?? null,
      }
    } catch (error) {
      await this.scenario.close()
      this.scenario = null
      throw this.wrapError(error, '打开页面失败', '请检查 URL 是否可访问、页面是否可在超时内加载，必要时调大 DSH_BROWSER_VERIFY_TIMEOUT。')
    }
  }

  /**
   * Arm the idle clock. Expiry reclaims the browser, never stops the engine —
   * a tool call waking up after an idle window keeps working (the regression
   * this fixes: the clock used to call dispose(), a one-way door, so every
   * later call — browser_open included — failed until the host restarted).
   */
  private resetIdleTimer(): void {
    this.lastActivityAt = Date.now()
    if (this.idleTimer !== null) clearTimeout(this.idleTimer)
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null
      void this.reclaimIfIdle()
    }, this.idleMs)
  }

  async ensureBrowser(): Promise<Browser> {
    this.ensureNotDisposed()
    if (this.browser !== null) return this.browser
    try {
      const found = (this.opts.discover ?? discoverBrowser)({ overridePath: process.env.DSH_BROWSER_VERIFY_CHROMIUM ?? undefined })
      this.discovered = found
      // A reclaim (or a previous dispose) may have removed the whole temp dir;
      // recreate it so the relaunch after an idle window starts from a clean slate.
      mkdirSync(this.userDataDir, { recursive: true })
      // Deviation D8-3: launchPersistentContext is the only launch path that
      // puts our predictable temp dir on the chromium command line
      // (`--user-data-dir` is appended by playwright itself), which the
      // cleanup/zombie matchers and the smoke rely on.
      const persistent = await chromium.launchPersistentContext(this.userDataDir, {
        executablePath: found.executablePath,
        args: buildLaunchArgs(found.kind === 'headless-shell'),
        headless: true,
      })
      const browser = persistent.browser()
      if (browser === null) throw new Error('browser-verify: 持久化上下文未返回浏览器实例。请检查 DSH_BROWSER_VERIFY_CHROMIUM 指向的浏览器，或重新执行 npx playwright install chromium。')
      this.browser = browser
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
   * Release browser resources but keep the engine restartable — the entry the
   * idle clock uses. Safe to call when nothing is open; the next browser_open
   * lazily launches a fresh browser.
   */
  async reclaim(): Promise<void> {
    if (this.disposed) return
    await this.chain(() => this.releaseBrowser())
  }

  /**
   * Idle expiry, serialized on the FIFO chain. An op may have landed (and
   * re-armed the clock) while this waited its turn, so re-check the wall clock
   * before releasing: only a genuinely idle engine gets reclaimed.
   */
  private reclaimIfIdle(): Promise<void> {
    return this.chain(async () => {
      if (this.disposed) return
      if (Date.now() - this.lastActivityAt < this.idleMs) {
        // An op landed (or was still finishing) while this reclaim waited its
        // turn on the chain — re-arm the clock instead of dropping reclamation.
        this.resetIdleTimer()
        return
      }
      await this.releaseBrowser()
    })
  }

  /** Best-effort release: close scenario + browser, delete the profile dir. */
  private async releaseBrowser(): Promise<void> {
    const scenario = this.scenario
    this.scenario = null
    if (scenario !== null) { try { await scenario.close() } catch { /* ignore */ } }
    const browser = this.browser
    this.browser = null
    if (browser !== null) {
      try { await browser.close() } catch {
        // Graceful close failed (hung process / dead transport; the persistent
        // context path has no internal kill fallback). Hard-kill any process
        // still carrying our user-data-dir so no orphan survives the release.
        try { await this.hardKillChromium() } catch { /* ignore */ }
      }
    }
    try { rmSync(join(tmpdir(), `dsh-browser-verify-${process.pid}`), { recursive: true, force: true }) } catch { /* ignore */ }
  }

  /**
   * Terminal stop on plugin disposal: mark disposed first (idempotent, blocks
   * new ops), then run the teardown serialized on the FIFO chain so it waits
   * out any in-flight op and cannot interleave with a launch or scenario op.
   * Idle reclamation deliberately does NOT go through here (see reclaim).
   */
  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    await this.chain(() => this.teardown())
  }

  /** Final teardown: stop the idle clock, then release everything. */
  private async teardown(): Promise<void> {
    if (this.idleTimer !== null) { clearTimeout(this.idleTimer); this.idleTimer = null }
    await this.releaseBrowser()
  }

  /**
   * Hard-kill fallback: SIGKILL every process whose command line still
   * carries our user-data-dir (playwright appends `--user-data-dir` itself;
   * our predictable temp dir is the reverse-lookup key, per design §6).
   */
  private async hardKillChromium(): Promise<void> {
    const out = await new Promise<string>((resolve) => {
      exec('ps -Ao pid=,ppid=,command=', { maxBuffer: 10 * 1024 * 1024 }, (error, stdout) => resolve(error ? '' : stdout))
    })
    const marker = `--user-data-dir=${this.userDataDir}`
    for (const line of out.split('\n')) {
      const m = /^\s*(\d+)\s+\d+\s+(.+)$/.exec(line)
      if (m === null) continue
      if (m[2].includes(marker)) {
        try { process.kill(Number(m[1]), 'SIGKILL') } catch { /* already gone */ }
      }
    }
  }
}
