/**
 * Locate a Browser-for-Testing binary in the machine playwright cache. Pure:
 * filesystem probing is injected so every branch is unit-testable.
 * @module dsh-browser-verify/browser/discover
 */

import { existsSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export type BrowserKind = 'headless-shell' | 'chromium' | 'custom' | 'system'

/** Revision numbers verified against the matching playwright-core browsers.json. */
export const KNOWN_REVISIONS: Readonly<Record<number, string>> = {
  1234: '1.62.x',
}

export interface DiscoveredBrowser {
  executablePath: string
  kind: BrowserKind
  revision: number
  known: boolean
  versionHint: string | null
}

export interface DiscoverOptions {
  cacheDir?: string
  overridePath?: string
  exists?: (path: string) => boolean
  /** Directory listing of cacheDir; defaults to readdirSync(cacheDir) (throws → treated as missing). */
  entries?: string[]
  /** System-browser candidate paths; defaults to common install locations + PATH commands. */
  systemCandidates?: string[]
  pathEnv?: string
}

const SUBDIRS: Readonly<Record<'headless-shell' | 'chromium', string>> = {
  'headless-shell': 'chrome-headless-shell-mac-arm64/chrome-headless-shell',
  chromium: 'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
}

const LIST_PREFIXES: Readonly<Array<{ kind: 'headless-shell' | 'chromium'; prefix: string }>> = [
  { kind: 'headless-shell', prefix: 'chromium_headless_shell-' },
  { kind: 'chromium', prefix: 'chromium-' },
]

/** PATH command names probed as a last-resort system-browser fallback. */
const SYSTEM_COMMANDS = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'chrome', 'chrome.exe']

/** Common install locations for system Chromium-based browsers, per platform. */
export function systemBrowserCandidates(platform: string = process.platform, home: string = homedir()): string[] {
  if (platform === 'win32') {
    return [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    ]
  }
  if (platform === 'linux') {
    return [
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
      '/usr/bin/chrome',
      '/snap/bin/chromium',
      '/snap/bin/google-chrome',
    ]
  }
  // darwin (and anything else unix-like): app bundles in system + user Applications.
  const apps = [
    'Google Chrome.app/Contents/MacOS/Google Chrome',
    'Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    'Chromium.app/Contents/MacOS/Chromium',
  ]
  return apps.flatMap(app => [`/Applications/${app}`, join(home, 'Applications', app)])
}

/** Resolve a command name on $PATH using the injected exists probe (no exec). */
export function resolveCommandOnPath(
  command: string,
  pathEnv: string | undefined,
  exists: (path: string) => boolean,
  sep: string = process.platform === 'win32' ? ';' : ':',
): string | null {
  if (pathEnv === undefined || pathEnv === '') return null
  for (const dir of pathEnv.split(sep)) {
    if (dir === '') continue
    const candidate = join(dir, command)
    if (exists(candidate)) return candidate
  }
  return null
}

/** Default cache location on macOS. */
export function defaultCacheDir(): string {
  return join(homedir(), 'Library', 'Caches', 'ms-playwright')
}

function maxRevision(list: string[], prefix: string): number | null {
  let max: number | null = null
  for (const entry of list) {
    if (!entry.startsWith(prefix)) continue
    const suffix = entry.slice(prefix.length)
    if (!/^\d+$/.test(suffix)) continue
    const value = Number(suffix)
    if (max === null || value > max) max = value
  }
  return max
}

/**
 * Find the browser binary: env override wins, then headless shell (highest
 * revision), then full chromium. Throws with an install hint when absent.
 */
export function discoverBrowser(opts: DiscoverOptions = {}): DiscoveredBrowser {
  const exists = opts.exists ?? existsSync
  if (opts.overridePath !== undefined) {
    if (!exists(opts.overridePath)) {
      throw new Error(`browser-verify: DSH_BROWSER_VERIFY_CHROMIUM 指向的二进制不存在: ${opts.overridePath}。请检查路径或取消该环境变量。`)
    }
    return { executablePath: opts.overridePath, kind: 'custom', revision: 0, known: true, versionHint: null }
  }
  const cacheDir = opts.cacheDir ?? defaultCacheDir()
  let list: string[] | null = null
  if (opts.entries !== undefined) {
    list = opts.entries
  } else {
    try {
      list = readdirSync(cacheDir)
    } catch {
      list = null
    }
  }
  if (list !== null) {
    for (const { kind, prefix } of LIST_PREFIXES) {
      const revision = maxRevision(list, prefix)
      if (revision === null) continue
      const executablePath = join(cacheDir, `${kind === 'headless-shell' ? `chromium_headless_shell-${revision}` : `chromium-${revision}`}`, SUBDIRS[kind])
      if (!exists(executablePath)) {
        throw new Error(`browser-verify: 缓存目录存在 ${prefix}${revision} 但可执行文件缺失（${cacheDir}）。请删除该目录后重新执行 npx playwright install chromium。`)
      }
      const known = KNOWN_REVISIONS[revision] !== undefined
      return {
        executablePath,
        kind,
        revision,
        known,
        versionHint: known ? null : `浏览器 revision ${revision} 不在已认证表（playwright-core 1.62.0 认证 ${Object.keys(KNOWN_REVISIONS).join('/')}）；若协议异常，请安装匹配版本`,
      }
    }
  }
  // Cache had nothing usable → last-resort system browser (zero download).
  const system = findSystemBrowser(opts, exists)
  if (system !== null) return system
  throw new Error(`browser-verify: 未找到可用的浏览器（已探测：playwright 缓存 ${cacheDir} 与系统 Chrome/Chromium/Edge 常见路径）。请执行一次 npx playwright install chromium 后重试，或用 DSH_BROWSER_VERIFY_CHROMIUM 指定已有二进制。`)
}

/** First existing system-browser candidate, or null. */
function findSystemBrowser(opts: DiscoverOptions, exists: (path: string) => boolean): DiscoveredBrowser | null {
  const candidates = opts.systemCandidates ?? [
    ...systemBrowserCandidates(),
    ...SYSTEM_COMMANDS.map(cmd => resolveCommandOnPath(cmd, opts.pathEnv ?? process.env.PATH, exists)).filter((p): p is string => p !== null),
  ]
  for (const candidate of candidates) {
    if (!exists(candidate)) continue
    return {
      executablePath: candidate,
      kind: 'system',
      revision: 0,
      known: false,
      versionHint: `系统浏览器（未与插件认证版本 ${Object.keys(KNOWN_REVISIONS).join('/')} 对齐）；若渲染异常，请执行 npx playwright install chromium 安装匹配版本`,
    }
  }
  return null
}
