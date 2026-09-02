import { describe, expect, it } from 'vitest'
import { discoverBrowser, KNOWN_REVISIONS } from '../src/browser/discover.ts'

const CACHE = '/cache'
const LIST = ['chromium_headless_shell-1234', 'chromium-1234', 'chromium-1200']
const existsAll = (p: string) => p === CACHE
  || p.includes('chrome-headless-shell-mac-arm64/chrome-headless-shell')
  || p.includes('Google Chrome for Testing.app')

describe('discoverBrowser', () => {
  it('prefers headless shell over full chromium and picks the highest revision', () => {
    const found = discoverBrowser({ cacheDir: CACHE, entries: LIST, exists: existsAll })
    expect(found.kind).toBe('headless-shell')
    expect(found.revision).toBe(1234)
    expect(found.executablePath).toContain('chromium_headless_shell-1234')
    expect(found.known).toBe(true)
    expect(found.versionHint).toBeNull()
  })

  it('falls back to full chromium when no headless shell exists', () => {
    const found = discoverBrowser({
      cacheDir: CACHE,
      entries: ['chromium-1234', 'chromium-1200'],
      exists: (p) => p === CACHE || p.includes('Google Chrome for Testing.app'),
    })
    expect(found.kind).toBe('chromium')
    expect(found.revision).toBe(1234)
    expect(found.known).toBe(true)
  })

  it('prefers the env override path verbatim', () => {
    const found = discoverBrowser({ cacheDir: CACHE, overridePath: '/opt/custom/chrome', exists: () => true })
    expect(found.executablePath).toBe('/opt/custom/chrome')
    expect(found.kind).toBe('custom')
  })

  it('throws when the override path does not exist', () => {
    expect(() => discoverBrowser({ cacheDir: CACHE, overridePath: '/opt/custom/chrome', exists: () => false }))
      .toThrow(/不存在/)
  })

  it('throws when a cached revision lacks its executable', () => {
    expect(() => discoverBrowser({
      cacheDir: CACHE,
      entries: [LIST[0]],
      exists: (p) => p === CACHE,
    })).toThrow(/可执行文件缺失/)
  })

  it('marks unknown revisions with a hint instead of failing', () => {
    const found = discoverBrowser({
      cacheDir: CACHE,
      entries: ['chromium_headless_shell-9999'],
      exists: (p) => p === CACHE || p.includes('chrome-headless-shell-mac-arm64'),
    })
    expect(found.known).toBe(false)
    expect(found.versionHint).toMatch(/9999/)
  })

  it('throws an actionable message when nothing is found', () => {
    expect(() => discoverBrowser({ cacheDir: CACHE, entries: [], exists: existsAll }))
      .toThrow(/npx playwright install chromium/)
  })

  it('exposes the known revision table', () => {
    expect(KNOWN_REVISIONS[1234]).toBe('1.62.x')
  })
})
