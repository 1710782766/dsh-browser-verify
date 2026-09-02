/**
 * Browser driving: one lazy launch per process, one active verification
 * scenario, FIFO-serialized tool access, idle reclamation, hard kill on
 * dispose. launch args are pure for unit tests.
 * @module dsh-browser-verify/browser/driver
 */

import { exec } from 'node:child_process'
import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium, type Browser } from 'playwright-core'
import { discoverBrowser, type DiscoveredBrowser } from './discover.ts'
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
    exec('ps -Ao pid=,ppid=,command=', (error, stdout) => resolve(error ? String(error.message) : stdout))
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

  withScenario<T>(fn: (scenario: Scenario) => Promise<T>): Promise<T> {
    return this.chain(() => fn(this.requireScenario()))
  }

  /** Open a fresh verification scenario; per design, each open = new context+page. */
  async startScenario(reset: { url: string; waitSelector?: string; timeoutMs?: number }): Promise<OpenResult> {
    return this.chain(() => this.openScenario(reset))
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
      return await this.scenario.navigate(reset)
    } catch (error) {
      await this.scenario.close()
      this.scenario = null
      throw error
    }
  }

  private resetIdleTimer(): void {
    if (this.idleTimer !== null) clearTimeout(this.idleTimer)
    this.idleTimer = setTimeout(() => { void this.dispose() }, this.opts.idleMs ?? 600000)
  }

  async ensureBrowser(): Promise<Browser> {
    if (this.browser !== null) return this.browser
    const found = (this.opts.discover ?? discoverBrowser)()
    this.browser = await chromium.launch({
      executablePath: found.executablePath,
      args: buildLaunchArgs(this.userDataDir, found.executablePath, found.kind === 'headless-shell'),
    })
    this.resetIdleTimer()
    return this.browser
  }

  private requireScenario(): Scenario {
    if (this.scenario === null) {
      throw new Error('browser-verify: 尚未打开验证会话。请先调用 browser_open 打开页面。')
    }
    return this.scenario
  }

  /** Reset on dispose: close everything, delete profile dir. */
  async dispose(): Promise<void> {
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
