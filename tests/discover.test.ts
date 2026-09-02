import { describe, expect, it } from 'vitest'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { defaultCacheDir, discoverBrowser, KNOWN_REVISIONS, resolveCommandOnPath, systemBrowserCandidates } from '../src/browser/discover.ts'

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

  it('defaults the cache dir to the macOS playwright cache', () => {
    expect(defaultCacheDir()).toBe(join(homedir(), 'Library', 'Caches', 'ms-playwright'))
  })

  it('throws with an install hint when the cache dir cannot be read and no system browser exists', () => {
    const missing = join(tmpdir(), 'dsh-browser-verify-t10-no-such-dir')
    expect(() => discoverBrowser({ cacheDir: missing, systemCandidates: [], exists: () => true }))
      .toThrow(/未找到可用的浏览器/)
  })

  it('falls back to a system browser when the cache has nothing usable', () => {
    const found = discoverBrowser({
      cacheDir: CACHE,
      entries: [],
      systemCandidates: ['/usr/local/bin/system-chrome'],
      exists: (p) => p === CACHE || p === '/usr/local/bin/system-chrome',
    })
    expect(found.kind).toBe('system')
    expect(found.executablePath).toBe('/usr/local/bin/system-chrome')
    expect(found.known).toBe(false)
    expect(found.versionHint).toMatch(/系统浏览器/)
  })

  it('prefers the playwright cache over a system browser', () => {
    const found = discoverBrowser({
      cacheDir: CACHE,
      entries: ['chromium_headless_shell-1234'],
      systemCandidates: ['/usr/local/bin/system-chrome'],
      exists: (p) => p === CACHE || p.includes('chrome-headless-shell-mac-arm64') || p === '/usr/local/bin/system-chrome',
    })
    expect(found.kind).toBe('headless-shell')
    expect(found.known).toBe(true)
  })

  it('lists system browser candidates per platform', () => {
    expect(systemBrowserCandidates('darwin', '/Users/me')).toContain('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
    expect(systemBrowserCandidates('darwin', '/Users/me')).toContain('/Users/me/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
    expect(systemBrowserCandidates('linux')).toContain('/usr/bin/chromium')
    expect(systemBrowserCandidates('win32')).toContain('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe')
  })

  it('resolves a command name on PATH with the injected probe', () => {
    const exists = (p: string) => p === '/b/chromium'
    expect(resolveCommandOnPath('chromium', '/a:/b:/c', exists)).toBe('/b/chromium')
    expect(resolveCommandOnPath('chromium', '/a:/b:/c', () => false)).toBeNull()
    expect(resolveCommandOnPath('chromium', undefined, exists)).toBeNull()
    expect(resolveCommandOnPath('chrome.exe', 'C:\\a;C:\\b', exists, ';')).toBeNull()
  })

  it('exposes the known revision table', () => {
    expect(KNOWN_REVISIONS[1234]).toBe('1.62.x')
  })
})
