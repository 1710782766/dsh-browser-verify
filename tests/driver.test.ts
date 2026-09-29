import { describe, expect, it, vi } from 'vitest'
import { BrowserDriver, buildLaunchArgs } from '../src/browser/driver.ts'

/** Private surface the lifecycle tests drive directly (no browser, all offline). */
interface DriverInternals {
  ensureNotDisposed(): void
  resetIdleTimer(): void
  reclaimIfIdle(): Promise<void>
  lastActivityAt: number
  idleTimer: unknown
  browser: { close(): Promise<void> } | null
  scenario: { close(): Promise<void> } | null
}
const internals = (driver: BrowserDriver): DriverInternals => driver as unknown as DriverInternals
const fakeBrowser = () => ({ close: vi.fn(async () => undefined) })
const fakeScenario = () => ({ close: vi.fn(async () => undefined) })

// Deviation D8-3: the brief (Task 6) had buildLaunchArgs emit
// `--user-data-dir=<dir>`; playwright-core 1.41+ rejects that flag in launch
// args (misuse error) for both launch() and launchPersistentContext(). The
// user data dir is now passed as launchPersistentContext's first parameter,
// and driver.ts keeps only the headless-mode flag here.
describe('buildLaunchArgs', () => {
  it('sets headless per kind', () => {
    expect(buildLaunchArgs(true)).toContain('--headless')
    expect(buildLaunchArgs(false)).toContain('--headless=new')
  })

  it('never passes user-data-dir / no-sandbox / remote-debugging flags', () => {
    const args = [...buildLaunchArgs(true), ...buildLaunchArgs(false)]
    expect(args.join(' ')).not.toMatch(/--user-data-dir|--no-sandbox|--remote-debugging/)
  })
})

// Regression: the idle clock used to call dispose(), a one-way door — after a
// 10-minute silence every later tool call (browser_open included) failed with
// "验证引擎已停止" until the host process restarted. Idle reclamation must
// release the browser without stopping the engine.
describe('idle reclamation vs. disposal', () => {
  it('reclaim() releases the browser and scenario but keeps the engine usable', async () => {
    const driver = new BrowserDriver({})
    const browser = fakeBrowser()
    const scenario = fakeScenario()
    Object.assign(internals(driver), { browser, scenario })

    await driver.reclaim()

    expect(browser.close).toHaveBeenCalledTimes(1)
    expect(scenario.close).toHaveBeenCalledTimes(1)
    expect(internals(driver).browser).toBeNull()
    expect(internals(driver).scenario).toBeNull()
    expect(() => internals(driver).ensureNotDisposed()).not.toThrow()
    await driver.dispose()
  })

  it('reclaimIfIdle() skips an engine that saw activity while the reclaim was queued', async () => {
    const driver = new BrowserDriver({ idleMs: 600000 })
    const browser = fakeBrowser()
    Object.assign(internals(driver), { browser })
    internals(driver).resetIdleTimer() // last activity = now

    await internals(driver).reclaimIfIdle()

    expect(browser.close).not.toHaveBeenCalled()
    expect(internals(driver).idleTimer).not.toBeNull() // clock re-armed, not dropped
    expect(() => internals(driver).ensureNotDisposed()).not.toThrow()
    await driver.dispose()
  })

  it('reclaimIfIdle() does reclaim a genuinely idle engine', async () => {
    const driver = new BrowserDriver({ idleMs: 1000 })
    const browser = fakeBrowser()
    Object.assign(internals(driver), { browser })
    internals(driver).lastActivityAt = Date.now() - 60_000

    await internals(driver).reclaimIfIdle()

    expect(browser.close).toHaveBeenCalledTimes(1)
    expect(() => internals(driver).ensureNotDisposed()).not.toThrow()
    await driver.dispose()
  })

  it('the idle clock expires into reclamation, never into disposal', async () => {
    vi.useFakeTimers()
    try {
      const driver = new BrowserDriver({ idleMs: 50 })
      const browser = fakeBrowser()
      Object.assign(internals(driver), { browser })
      internals(driver).resetIdleTimer()

      await vi.advanceTimersByTimeAsync(60)

      expect(browser.close).toHaveBeenCalledTimes(1)
      expect(() => internals(driver).ensureNotDisposed()).not.toThrow()
      await driver.dispose()
    } finally {
      vi.useRealTimers()
    }
  })

  it('reloadScenario() without arguments fails with the actionable no-scenario error', async () => {
    // The optional-arg default is load-bearing: an undefined opts used to throw
    // "Cannot read properties of undefined (reading 'waitSelector')".
    const driver = new BrowserDriver({})
    await expect(driver.reloadScenario()).rejects.toThrowError(/^browser-verify: 尚未打开验证会话/)
    await driver.dispose()
  })

  it('disposal is terminal and names a recoverable action', async () => {
    const driver = new BrowserDriver({})
    await driver.dispose()

    expect(() => internals(driver).ensureNotDisposed()).toThrowError(/^browser-verify: /)
    expect(() => internals(driver).ensureNotDisposed()).toThrowError(/插件已卸载/)
    expect(() => internals(driver).ensureNotDisposed()).toThrowError(/重启 dsh|重新加载/)

    await expect(driver.reclaim()).resolves.toBeUndefined()
  })
})
