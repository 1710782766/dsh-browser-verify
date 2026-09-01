# dsh-browser-verify 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付 `dsh-browser-verify` 宿主插件 MVP——`browser_open` / `browser_mock` / `browser_assert` / `browser_screenshot` 四个只读验证工具 + 精简调试 CLI，用 ≤4 次工具调用完成一次页面验证。

**Architecture:** 单 bundle（`dsh.bundle.patch → cordis.patch.yml`）挂在 web profile；宿主半用 `ctx.tools.register(defineTool(...))` 注册四件套。纯逻辑（探测/场景/断言/清理/附件渲染）与 harness 解耦，被工具、CLI、vitest 三方共用；浏览器为进程内惰性单例 + 单一验证会话 + FIFO 锁；截图走 `ctx.attachments.saveImage` → `output.render` 输出 image block（与 `read_image` 同款）。

**Tech Stack:** TypeScript ~5.7.2 / tsdown 0.22.2（ESM，src→lib）/ vitest ^3.0.0 / playwright-core **1.62.0（精确 pin）** / @deepseek-ai/dsh-tools、dsh-attachment、dsh-llm（类型与工具注册，devDeps）+ @deepseek-ai/cordis ^4.0.1。

**Spec:** `docs/specs/2026-09-01-dsh-browser-verify-design.md`（本计划从该设计文档论证；执行者需同时阅读 DESIGN.md §2 环境事实与 §4 垃圾来源）。

## Global Constraints

- `engines`: `"node": "^22.19.0 || >=24.0.0"`, `"dsh": ">=0.1.2-alpha.1"`；`"type": "module"`；包名 `dsh-browser-verify`，版本 `0.1.0`。
- `dependencies`: `"playwright-core": "1.62.0"`（**精确版本，禁止 `^`**——chromium rev 1234 与本机缓存匹配的实证版本）。
- **`browser_mock` 注册拦截后默认自动 reload 当前页**（`reload: true` 默认，可 `false` 跳过）：拦截必须在页面请求发出前生效，否则「open→mock→assert」测不到 mock 场景，直接违背 ≤4 次调用判据。
- 工具描述 ≤ ~300 字符（提效判据）；所有 throw 的 message 以 `browser-verify: ` 前缀开头并以可操作建议结尾；禁止静默 hang。
- 落盘点仅三处：`os.tmpdir()/dsh-browser-verify-<pid>/`（生命周期=会话）、DSH 附件存储（文档化生命周期）、CLI `--persist` 显式路径。**报告/日志一律不落盘**。
- 环境变量：`DSH_BROWSER_VERIFY_CHROMIUM`（二进制覆盖）、`DSH_BROWSER_VERIFY_TIMEOUT`（默认 `10000` ms）、`DSH_BROWSER_VERIFY_IDLE_MS`（默认 `600000` ms）。
- 插件不读凭据、不访问外网（浏览器只访问工具参数 URL）、不触发浏览器下载。
- 目录约定：源码 `src/`，产物 `lib/`（gitignore），测试 `tests/`，`*.tgz`、`coverage/` gitignore。
- 所有命令在工作目录 `/Users/dongshuai/Desktop/AIWorks/dsh-browser-verify` 执行，除特别注明在 `/Users/dongshuai/Desktop/AIWorks/deepseek-harness`（用 `pnpm dsh ...` 取代 `dsh ...`）。

---

### Task 1: 仓库脚手架（可构建、可测试、可装载）

**Files:**
- Create: `package.json`、`tsconfig.json`、`tsconfig.host.json`、`tsconfig.vitest.json`、`tsdown.config.ts`、`vitest.config.ts`、`cordis.patch.yml`、`.gitignore`、`src/index.ts`（占位）、`tests/smoke.test.ts`（占位）
- Test: `tests/smoke.test.ts`

**Interfaces:**
- Produces: 插件入口 `src/index.ts` 导出 `export const name = 'browser-verify'`、`export const inject = ['tools']`、`export function apply(ctx: Context)`（占位版：只 `console.log`）；`lib/index.js` 构建产物；`cordis.patch.yml` 插入行。

- [ ] **Step 1: 写 `package.json`**

```json
{
  "name": "dsh-browser-verify",
  "description": "Read-only browser verification tools for the DeepSeek Harness web GUI: browser_open / browser_mock / browser_assert / browser_screenshot — verify a page (H5/desktop) in ≤4 tool calls with mock interception, DOM assertions, and screenshots that auto-project into the model context.",
  "version": "0.1.0",
  "type": "module",
  "packageManager": "pnpm@11.7.0",
  "engines": {
    "node": "^22.19.0 || >=24.0.0",
    "dsh": ">=0.1.2-alpha.1"
  },
  "main": "lib/index.js",
  "types": "lib/types/index.d.ts",
  "exports": {
    ".": {
      "types": "./lib/types/index.d.ts",
      "default": "./lib/index.js"
    },
    "./package.json": "./package.json"
  },
  "dsh": {
    "bundle": {
      "patch": "./cordis.patch.yml"
    }
  },
  "scripts": {
    "build": "tsc -b && tsdown",
    "typecheck": "tsc -b --pretty false && tsc -p tsconfig.vitest.json --pretty false",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "playwright-core": "1.62.0"
  },
  "devDependencies": {
    "@deepseek-ai/cordis": "^4.0.1",
    "@deepseek-ai/dsh-attachment": "^0.1.0-rc.6",
    "@deepseek-ai/dsh-llm": "^0.1.0-rc.6",
    "@deepseek-ai/dsh-tools": "^0.1.0-rc.6",
    "@types/node": "^22.20.0",
    "tsdown": "0.22.2",
    "typescript": "~5.7.2",
    "vitest": "^3.0.0"
  },
  "files": [
    "lib/**/*.js",
    "lib/**/*.d.ts",
    "src",
    "cordis.patch.yml",
    "README.md",
    "README.zh.md",
    "LICENSE"
  ],
  "license": "Apache-2.0"
}
```

- [ ] **Step 2: 写 TypeScript 配置**

`tsconfig.json`（项目引用根）：

```json
{
  "extends": "./tsconfig.host.json",
  "files": [],
  "references": [
    { "path": "./tsconfig.host.json" },
    { "path": "./tsconfig.vitest.json" }
  ]
}
```

`tsconfig.host.json`（照 vision 简化——仅宿主半，无 client）：

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2023"],
    "strict": true,
    "noEmit": true,
    "composite": true,
    "allowImportingTsExtensions": true,
    "verbatimModuleSyntax": true,
    "skipLibCheck": true,
    "types": ["node"]
  },
  "include": ["src/**/*.ts"]
}
```

`tsconfig.vitest.json`：

```json
{
  "extends": "./tsconfig.host.json",
  "compilerOptions": {
    "composite": true,
    "types": ["node", "vitest/globals"]
  },
  "include": ["src/**/*.ts", "tests/**/*.ts"]
}
```

- [ ] **Step 3: 写 `tsdown.config.ts`（仅宿主 half；cli 作为第二入口产出 lib/cli.js）**

```ts
/**
 * Host-only build config for dsh-browser-verify. Emits ESM to lib/.
 * Cordis + harness contract modules resolve at runtime from the dsh profile
 * tree; playwright-core resolves from the plugin's own install.
 * @module dsh-browser-verify/build
 */
import type { UserConfig } from 'tsdown'

const configs: UserConfig[] = [{
  name: 'dsh-browser-verify',
  entry: ['src/index.ts', 'src/cli.ts'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
  external: [
    '@deepseek-ai/cordis',
    '@deepseek-ai/dsh-attachment',
    '@deepseek-ai/dsh-llm',
    '@deepseek-ai/dsh-tools',
    'playwright-core',
  ],
}]

export default configs
```

- [ ] **Step 4: 写 `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
})
```

- [ ] **Step 5: 写 `cordis.patch.yml`（照 vision 注释模板）**

```yaml
# dsh-browser-verify bundle patch: inserts the four browser verification
# tools into the web profile roster. Applied as a profile bundle layer (the
# dsh.bundle.patch manifest field).
#
# Install (from a source checkout; tarball name follows the current version):
#   pnpm install && pnpm build && pnpm pack
#   dsh plugin --profile web add ./dsh-browser-verify-<version>.tgz
#   # or, during development, add the checkout directory directly (pnpm link):
#   dsh plugin --profile web add <path-to-this-directory>
#
# Host half only: the node half (exports ".") registers browser_open /
# browser_mock / browser_assert / browser_screenshot. No client half, no
# settings card. Configuration is env-var only (DSH_BROWSER_VERIFY_*); do NOT
# add a `config:` block here.
- insert:
    - id: browser-verify
      name: 'dsh-browser-verify'
```

- [ ] **Step 6: 写 `.gitignore`**

```gitignore
lib/
node_modules/
*.tgz
coverage/
*.tsbuildinfo
.DS_Store
```

- [ ] **Step 7: 写占位入口与占位测试**

`src/index.ts`：

```ts
import type { Context } from '@deepseek-ai/cordis'

export const name = 'browser-verify'
export const inject = ['tools']

export function apply(ctx: Context): void {
  // Tools are registered in Task 7.
  void ctx
}
```

`tests/smoke.test.ts`：

```ts
import { describe, expect, it } from 'vitest'

describe('smoke', () => {
  it('runs the vitest pipeline', () => {
    expect(1 + 1).toBe(2)
  })
})
```

- [ ] **Step 8: 安装、构建、测试**

Run: `pnpm install && pnpm typecheck && pnpm build && pnpm test`
Expected: typecheck 0 error；`lib/index.js` 与 `lib/cli.js` 存在；测试 1 passed。

- [ ] **Step 9: git 初始化并提交**

```bash
git init && git add -A && git commit -m "chore: scaffold dsh-browser-verify repo"
```

---

### Task 2: `browser/discover.ts` + 单测（纯函数）

**Files:**
- Create: `src/browser/discover.ts`
- Test: `tests/discover.test.ts`

**Interfaces:**
- Produces: `type BrowserKind = 'headless-shell' | 'chromium' | 'custom'`；`interface DiscoveredBrowser { executablePath: string; kind: BrowserKind; revision: number; known: boolean; versionHint: string | null }`；`function discoverBrowser(opts: { cacheDir?: string; overridePath?: string; exists?: (p: string) => boolean }): DiscoveredBrowser`（找不到时 throw，message 前缀 `browser-verify: `）。`KNOWN_REVISIONS: Readonly<Record<number, string>> = { 1234: '1.62.x' }`。
- Consumes: 无。Task 6（driver）与 Task 8（cli）调用 `discoverBrowser`，Task 7 经 driver 间接使用。

- [ ] **Step 1: 写失败测试**

`tests/discover.test.ts`：

```ts
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
    expect(found.executablePath).toContain('headless-shell-1234')
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
  })

  it('prefers the env override path verbatim', () => {
    const found = discoverBrowser({ cacheDir: CACHE, overridePath: '/opt/custom/chrome', exists: () => true })
    expect(found.executablePath).toBe('/opt/custom/chrome')
    expect(found.kind).toBe('custom')
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
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm vitest run tests/discover.test.ts`
Expected: FAIL（找不到模块）。

- [ ] **Step 3: 写实现**

`src/browser/discover.ts`：

```ts
/**
 * Locate a Browser-for-Testing binary in the machine playwright cache. Pure:
 * filesystem probing is injected so every branch is unit-testable.
 * @module dsh-browser-verify/browser/discover
 */

import { existsSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export type BrowserKind = 'headless-shell' | 'chromium' | 'custom'

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
}

const SUBDIRS: Readonly<Record<BrowserKind, string>> = {
  'headless-shell': 'chrome-headless-shell-mac-arm64/chrome-headless-shell',
  chromium: 'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
}

const LIST_PREFIXES: Readonly<Array<{ kind: BrowserKind; prefix: string }>> = [
  { kind: 'headless-shell', prefix: 'chromium_headless_shell-' },
  { kind: 'chromium', prefix: 'chromium-' },
]

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
  const list = opts.entries ?? (exists(cacheDir) ? readdirSync(cacheDir) : null)
  if (list === null) {
    throw new Error(`browser-verify: 未找到浏览器缓存目录 ${cacheDir}。请先安装：npx playwright install chromium（需 playwright-core@1.62.0），或设置 DSH_BROWSER_VERIFY_CHROMIUM=<完整路径>。`)
  }
  for (const { kind, prefix } of LIST_PREFIXES) {
    const revision = maxRevision(list, prefix)
    if (revision === null) continue
    const executablePath = join(cacheDir, `${kind === 'headless-shell' ? `chromium_headless_shell-${revision}` : `chromium-${revision}`}`, SUBDIRS[kind])
    if (!exists(executablePath)) {
      throw new Error(`browser-verify: 缓存目录存在 ${prefix}${revision} 但可执行文件缺失（${cacheDir}）。请删除该目录后重新执行 npx playwright install chromium。`)
    }
    const known = kind === 'headless-shell' && KNOWN_REVISIONS[revision] !== undefined
    return {
      executablePath,
      kind,
      revision,
      known,
      versionHint: known ? null : `浏览器 revision ${revision} 不在已认证表（playwright-core 1.62.0 认证 ${Object.keys(KNOWN_REVISIONS).join('/')}）；若协议异常，请安装匹配版本`,
    }
  }
  throw new Error(`browser-verify: 未找到浏览器二进制。请先安装：npx playwright install chromium（需 playwright-core@1.62.0），或设置 DSH_BROWSER_VERIFY_CHROMIUM=<完整路径>。`)
}
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm vitest run tests/discover.test.ts`
Expected: 6 passed（测试的 `exists` 假实现在构造的路径上返回 true，绕过硬编码的 home 路径）。

- [ ] **Step 5: 提交**

```bash
git add src/browser/discover.ts tests/discover.test.ts && git commit -m "feat: browser cache discovery (pure)"
```

---

### Task 3: `cleanup.ts` + 单测（孤儿目录 / 残留进程）

**Files:**
- Create: `src/cleanup.ts`
- Test: `tests/cleanup.test.ts`

**Interfaces:**
- Produces: `interface OrphanDir { path: string; mtimeMs: number }`；`function parseZombiePids(psText: string, prefix: string, selfPid: number): number[]`（纯，解析 `ps -Ao pid=,ppid=,command=` 输出）；`function selectOrphanDirs(entries: Array<{ path: string; mtimeMs: number }>, nowMs: number, ageMs: number, prefix: string): OrphanDir[]`（纯）；`function tmpRoot(): string`（`join(os.tmpdir(), 'dsh-browser-verify')` 父目录——实际目录名为 `dsh-browser-verify-<pid>`）。
- Consumes: 无。Task 7（`index.ts` 启动时调用）使用。

- [ ] **Step 1: 写失败测试**

`tests/cleanup.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { parseZombiePids, selectOrphanDirs } from '../src/cleanup.ts'

describe('parseZombiePids', () => {
  it('returns pids whose command carries the tmp prefix, excluding self', () => {
    const ps = [
      '12345 1 /path/to/chrome --user-data-dir=/tmp/dsh-browser-verify-999/chrome',
      '54321 1 /usr/bin/something --user-data-dir=/tmp/other',
      '999 1 /bin/sh',
    ].join('\n')
    expect(parseZombiePids(ps, 'dsh-browser-verify-', 999)).toEqual([12345])
  })

  it('ignores malformed lines', () => {
    expect(parseZombiePids('not-a-listing', 'dsh-browser-verify-', 1)).toEqual([])
  })
})

describe('selectOrphanDirs', () => {
  it('selects only prefixed dirs older than the threshold', () => {
    const now = 1_000_000
    const entries = [
      { path: '/tmp/dsh-browser-verify-111', mtimeMs: now - 5 * 3_600_000 },   // old -> remove
      { path: '/tmp/dsh-browser-verify-222', mtimeMs: now - 1_000 },           // fresh -> keep
      { path: '/tmp/other', mtimeMs: now - 5 * 3_600_000 },                    // other prefix -> keep
    ]
    const picked = selectOrphanDirs(entries, now, 3_600_000, 'dsh-browser-verify-')
    expect(picked.map(d => d.path)).toEqual(['/tmp/dsh-browser-verify-111'])
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm vitest run tests/cleanup.test.ts`

- [ ] **Step 3: 写实现**

`src/cleanup.ts`：

```ts
/**
 * Orphan cleanup for dsh-browser-verify: temp dirs and zombie Chromium
 * processes left by crashes. Parsers are pure; callers do the I/O.
 * @module dsh-browser-verify/cleanup
 */

import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** One line from `ps -Ao pid=,ppid=,command=` (macOS). */
export function parseZombiePids(psText: string, prefix: string, selfPid: number): number[] {
  const pids: number[] = []
  for (const line of psText.split('\n')) {
    const match = /^\s*(\d+)\s+\d+\s+(.+)$/.exec(line)
    if (match === null) continue
    const pid = Number(match[1])
    if (pid === selfPid) continue
    if (match[2].includes(`--user-data-dir=${join(tmpdir(), prefix)}`)) pids.push(pid)
  }
  return pids
}

export interface OrphanDir {
  path: string
  mtimeMs: number
}

/** Pick degraded-run temp dirs: name prefixed, old enough, not the current pid dir. */
export function selectOrphanDirs(entries: Array<{ path: string; mtimeMs: number }>, nowMs: number, ageMs: number, prefix: string): OrphanDir[] {
  return entries
    .filter(e => e.path.includes(`/${prefix}`) && nowMs - e.mtimeMs > ageMs)
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
}
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm vitest run tests/cleanup.test.ts`
Expected: 3 passed。

- [ ] **Step 5: 提交**

```bash
git add src/cleanup.ts tests/cleanup.test.ts && git commit -m "feat: orphan cleanup parsers (pure)"
```

---

### Task 4: `browser/scenario.ts` 核心（纯函数 + Scenario 类）+ 单测

**Files:**
- Create: `src/browser/scenario.ts`
- Test: `tests/scenario.test.ts`

**Interfaces:**
- Consumes: `playwright-core`（`BrowserContext`、`Page` 类型仅在类成员与 IO 方法上；纯函数不 import playwright）。
- Produces:
  - `interface MockRule { json: unknown; status: number }`
  - `function assertNoMockConflict(patterns: string[], next: string): void`（重复则 throw `browser-verify: 拦截 pattern 已存在: <next>（已有: <patterns>）。请先 browser_open 重开场景或用不同的 urlPattern。`）
  - `function normalizeCountSpec(count: number | { min: number; max: number }): { min: number; max: number } | null`
  - `function summarizeVisibleText(texts: string[]): string[]`（过滤空白、去重、≤8 项、每项 ≤40 字符）
  - `function capConsoleErrors(errors: string[]): string[]`（≤5 条、每条 ≤120 字符）
  - `function sha256Hex(data: Buffer): string`（node:crypto，hex）
  - `function textDiff(actual: string | null, expected: string): string`（差异摘要，截 120 字符）
  - `class Scenario { page; context; mocks: Map<string, MockRule>; lastScreenshotHash: string | null; constructor(page, context); async navigate(opts: { url; waitSelector?; timeoutMs }): Promise<OpenResult>; async addMock(rule: { urlPattern; json; status? }): Promise<string[]>; async assert(opts: { selector; count?; text?; timeoutMs? }): Promise<AssertResult>; async screenshot(opts: { fullPage?; name? }): Promise<{ data: Buffer; sha256: string; identicalToPrevious: boolean }>; async close(): Promise<void> }`
  - `interface OpenResult { title; url; status; visible: string[]; consoleErrors: string[]; elapsedMs }`；`interface AssertResult { pass: boolean; count: number; actualText: string | null; elapsedMs: number }`
- Task 6（driver 创建场景）、Task 7（tools）、Task 8（cli）均消费。

- [ ] **Step 1: 写失败测试（纯函数部分）**

`tests/scenario.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { assertNoMockConflict, capConsoleErrors, normalizeCountSpec, sha256Hex, summarizeVisibleText, textDiff } from '../src/browser/scenario.ts'

describe('scenario pure helpers', () => {
  it('rejects duplicate mock patterns with actionable message', () => {
    expect(() => assertNoMockConflict(['**/api/a*'], '**/api/a*')).toThrow(/已存在/)
    expect(() => assertNoMockConflict(['**/api/a*'], '**/api/b*')).not.toThrow()
  })

  it('normalizes count specs', () => {
    expect(normalizeCountSpec(3)).toEqual({ min: 3, max: 3 })
    expect(normalizeCountSpec({ min: 1, max: 3 })).toEqual({ min: 1, max: 3 })
    expect(normalizeCountSpec(undefined as never)).toBeNull()
  })

  it('summarizes visible text: dedupe, cap 8 items, trim 40 chars', () => {
    const out = summarizeVisibleText([' 空 ' , '空', 'x'.repeat(100), 'a', 'b', 'c', 'd', 'e', 'f', 'g'])
    expect(out).toHaveLength(8)
    expect(out[0]).toBe('空')
    expect(out[2]).toHaveLength(40)
  })

  it('caps console errors at 5 entries of 120 chars', () => {
    const out = capConsoleErrors(Array.from({ length: 10 }, (_, i) => `err${i} ${'z'.repeat(200)}`))
    expect(out).toHaveLength(5)
    expect(out[0]).toHaveLength(120)
  })

  it('hashes deterministically', () => {
    expect(sha256Hex(Buffer.from('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })

  it('formats text diff compactly', () => {
    expect(textDiff('实际文本', '实际')).toContain('实际')
    expect(textDiff(null, '空态')).toMatch(/未找到/)
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm vitest run tests/scenario.test.ts`

- [ ] **Step 3: 写实现（纯函数 + Scenario 类）**

`src/browser/scenario.ts`：

```ts
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
    if (seen.has(reduced)) continue
    seen.add(reduced)
    out.push(reduced)
    if (out.length >= MAX_VISIBLE) break
  }
  return out
}

export function capConsoleErrors(errors: string[]): string[] {
  return errors.slice(0, MAX_ERRORS).map(e => e.length > MAX_ERROR_LEN ? `${e.slice(0, MAX_ERROR_LEN)}…` : e)
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

  async navigate(opts: { url: string; waitSelector?: string; timeoutMs: number }): Promise<OpenResult> {
    const started = Date.now()
    const errors: string[] = []
    const onError = (message: string): void => { errors.push(message) }
    this.page.on('console', msg => { if (msg.type() === 'error') onError(msg.text()) })
    this.page.on('pageerror', err => onError(String(err)))
    const response = await this.page.goto(opts.url, { waitUntil: 'domcontentloaded', timeout: opts.timeoutMs })
    if (opts.waitSelector !== undefined) {
      await this.page.waitForSelector(opts.waitSelector, { timeout: opts.timeoutMs })
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
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm vitest run tests/scenario.test.ts`
Expected: 6 passed（仅纯函数测试；类方法待 Task 8 冒烟验证）。

- [ ] **Step 5: 提交**

```bash
git add src/browser/scenario.ts tests/scenario.test.ts && git commit -m "feat: scenario core (mocks, asserts, screenshot dedup)"
```

---

### Task 5: `attachments.ts` + 单测（截图持久化与 image block 渲染）

**Files:**
- Create: `src/attachments.ts`
- Test: `tests/attachments.test.ts`

**Interfaces:**
- Consumes: `@deepseek-ai/dsh-attachment`（`ImageAttachmentRef`、`ImageMediaType`）与 `@deepseek-ai/dsh-llm`（`ContentBlock`）仅类型；执行期 `ctx.get('attachments')`（`saveImage`）+ `ctx.get('llm')`（`resolveModelInfo`）+ `exec`。
- Produces:
  - `function imageRefFromValue(image: { attachmentId; mediaType; bytes; width; height; name? }): ImageAttachmentRef`
  - `function renderScreenshotBlocks(value: { image: ...; sha256: string; identicalToPrevious: boolean }): ContentBlock[]`（text + `{ type: 'image', attachment }`）
  - `async function saveScreenshot(ctx: Context, data: Buffer, name: string | undefined): Promise<ImageAttachmentRef>`（byte cap 预检 + `saveImage` + `AttachmentError` 错误翻译——`IMAGE_TOO_LARGE`/`IMAGE_DIMENSION_TOO_LARGE`/`IMAGE_TOO_MANY_PIXELS` → 可操作中文错误）
  - `async function assertImageCapable(ctx: Context, exec: { agent?: { session?: { requestHeader?: () => { config?: { provider?: string; model?: string } } }; options?: { provider?: string; model?: string } } }): Promise<void>`（镜像 `read-image.ts` 的 gate；不满足 throw 引导改用 browser_assert）
- Task 7 的 `browser_screenshot` 执行器消费。

- [ ] **Step 1: 写失败测试**

`tests/attachments.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { imageRefFromValue, renderScreenshotBlocks } from '../src/attachments.ts'

describe('attachments', () => {
  it('brands a value into a durable attachment ref', () => {
    const ref = imageRefFromValue({
      attachmentId: 'sha256:abc', mediaType: 'image/png' as const,
      bytes: 10, width: 390, height: 844, name: 'empty.png',
    })
    expect(ref.attachmentId).toBe('sha256:abc')
    expect(ref.name).toBe('empty.png')
  })

  it('renders text envelope plus an image block', () => {
    const blocks = renderScreenshotBlocks({
      image: { attachmentId: 'sha256:abc', mediaType: 'image/png' as const, bytes: 10, width: 390, height: 844 },
      sha256: 'sha256:abc', identicalToPrevious: false,
    })
    expect(blocks[0]).toMatchObject({ type: 'text' })
    expect(blocks[1]).toMatchObject({ type: 'image' })
  })

  it('flags duplicate screenshots in the text envelope', () => {
    const blocks = renderScreenshotBlocks({
      image: { attachmentId: 'sha256:abc', mediaType: 'image/png' as const, bytes: 10, width: 390, height: 844 },
      sha256: 'sha256:abc', identicalToPrevious: true,
    })
    expect(blocks[0].text).toMatch(/疑似未刷新/)
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm vitest run tests/attachments.test.ts`

- [ ] **Step 3: 写实现**

`src/attachments.ts`：

```ts
/**
 * Screenshot persistence + model projection, mirroring the read_image output
 * direction: save into the durable attachment store, render a text envelope
 * beside the image block the harness projects into the next model request.
 * @module dsh-browser-verify/attachments
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ImageAttachmentRef, ImageMediaType } from '@deepseek-ai/dsh-attachment'
import { AttachmentError, AttachmentId } from '@deepseek-ai/dsh-attachment'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'

export interface ScreenshotImage {
  attachmentId: string
  mediaType: ImageMediaType
  bytes: number
  width: number
  height: number
  name?: string
}

export interface ScreenshotValue {
  image: ScreenshotImage
  sha256: string
  identicalToPrevious: boolean
}

export function imageRefFromValue(image: ScreenshotImage): ImageAttachmentRef {
  return {
    attachmentId: AttachmentId(image.attachmentId),
    mediaType: image.mediaType,
    bytes: image.bytes,
    width: image.width,
    height: image.height,
    ...image.name === undefined ? {} : { name: image.name },
  }
}

export function renderScreenshotBlocks(value: ScreenshotValue): ContentBlock[] {
  const dup = value.identicalToPrevious
    ? '（与上一张截图哈希相同，疑似页面未刷新；请 browser_open 重开场景后重试）'
    : ''
  return [
    {
      type: 'text',
      text: `<type>screenshot</type>\n<content>\n${value.image.mediaType}, ${value.image.width}x${value.image.height} px, ${value.image.bytes} bytes, sha256 ${value.sha256.slice(0, 12)}${dup}\n</content>`,
    },
    { type: 'image', attachment: imageRefFromValue(value.image) },
  ]
}

/** Persist screenshot bytes, mapping store refusals to actionable errors. */
export async function saveScreenshot(ctx: Context, data: Buffer, name: string | undefined): Promise<ImageAttachmentRef> {
  const attachments = ctx.get('attachments')
  if (attachments === undefined) {
    throw new Error('browser-verify: 附件存储未挂载，无法持久化截图。请检查当前 DSH 组合是否包含 attachment 插件。')
  }
  try {
    return await attachments.saveImage({ data, mediaType: 'image/png', ...name === undefined ? {} : { name } })
  } catch (error: unknown) {
    if (!(error instanceof AttachmentError)) throw error
    if (error.code === 'IMAGE_TOO_LARGE') {
      throw new Error('browser-verify: 截图超过 attachment 存储字节上限。请改用 fullPage:false 或调低 deviceScaleFactor 后重试。')
    }
    if (error.code === 'IMAGE_DIMENSION_TOO_LARGE' || error.code === 'IMAGE_TOO_MANY_PIXELS') {
      throw new Error('browser-verify: 截图尺寸超过 attachment 存储限制。请改用 fullPage:false 或调低 deviceScaleFactor 后重试。')
    }
    if (error.code === 'IMAGE_TYPE_MISMATCH') {
      throw new Error(`browser-verify: 截图格式校验失败: ${error.message}`)
    }
    throw error
  }
}

/** Gate: the calling route must be able to see image input (mirror of read-image). */
export async function assertImageCapable(
  ctx: Context,
  exec: { agent?: { session?: { requestHeader?: () => { config?: { provider?: string; model?: string } } }; options?: { provider?: string; model?: string } } },
): Promise<void> {
  const routed = exec.agent?.session?.requestHeader?.()?.config
  const provider = routed?.provider ?? exec.agent?.options?.provider
  const model = routed?.model ?? exec.agent?.options?.model
  const llm = ctx.get('llm')
  if (provider === undefined || model === undefined || llm === undefined) {
    throw new Error('browser-verify: 无法解析当前模型路由，无法判断图片输入能力。')
  }
  const active = await llm.resolveModelInfo(provider, model)
  if (active.inputModalities === undefined || !active.inputModalities.includes('image')) {
    throw new Error('browser-verify: 当前模型不支持看图：请改用 browser_assert 做文本断言（更省 token），或切换到图片模型后重试。')
  }
}
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm vitest run tests/attachments.test.ts`
Expected: 3 passed。

- [ ] **Step 5: 提交**

```bash
git add src/attachments.ts tests/attachments.test.ts && git commit -m "feat: screenshot attachment + image block projection"
```

---

### Task 6: `browser/driver.ts`（惰性单例 + 会话生命周期）+ 单测

**Files:**
- Create: `src/browser/driver.ts`
- Test: `tests/driver.test.ts`

**Interfaces:**
- Consumes: `discoverBrowser`（Task 2）、`Scenario`（Task 4）。playwright-core `chromium`。
- Produces:
  - `function buildLaunchArgs(userDataDir: string, executablePath: string, headlessShell: boolean): string[]`（纯）
  - `class BrowserDriver { constructor(opts: { discover?; viewport?; deviceScaleFactor?; timeoutMs?; idleMs? }); async startScenario(reset: { url; waitSelector?; timeoutMs? }): Promise<OpenResult>; async withScenario<T>(fn: (scenario: Scenario) => Promise<T>): Promise<T>; async ensureBrowser(): Promise<Browser>; async dispose(): Promise<void> }`
  - `async function killProcessTree(pid: number): Promise<void>`（`ps -Ao pid,ppid,command` 收集后代 → SIGKILL；出口错误静默）
- Task 7（tools）、Task 8（cli）消费。

- [ ] **Step 1: 写失败测试（纯函数部分）**

`tests/driver.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { buildLaunchArgs } from '../src/browser/driver.ts'

describe('buildLaunchArgs', () => {
  it('always sets a temp user-data-dir and headless', () => {
    const args = buildLaunchArgs('/tmp/dsh-browser-verify-9/profile', '/bin/chrome', true)
    expect(args).toContain('--headless')
    expect(args).toContain('--user-data-dir=/tmp/dsh-browser-verify-9/profile')
  })

  it('never adds sandbox or remote-debugging flags', () => {
    const args = buildLaunchArgs('/tmp/x', '/bin/chrome', false).join(' ')
    expect(args).not.toContain('--no-sandbox')
    expect(args).not.toContain('--remote-debugging')
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm vitest run tests/driver.test.ts`

- [ ] **Step 3: 写实现**

`src/browser/driver.ts`：

```ts
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
```

**说明**：类方法是完整实现（非骨架）；真实启动/导航/截图行为由 Task 8 冒烟做最终验证（`chromium.launch` 依赖本机缓存；单测只覆盖纯函数）。若冒烟发现生命周期缺口，回到本文件修正。

- [ ] **Step 4: 运行确认通过**

Run: `pnpm vitest run tests/driver.test.ts`
Expected: 2 passed。

- [ ] **Step 5: 提交**

```bash
git add src/browser/driver.ts tests/driver.test.ts && git commit -m "feat: browser driver (lazy singleton, scenario lifecycle, idle reclaim)"
```

---

### Task 7: 工具注册（`tools/index.ts` + `src/index.ts` 组装）

**Files:**
- Create: `src/tools/index.ts`、`src/tools/timeout.ts`
- Modify: `src/index.ts`（替换占位）
- Test: `tests/tools.test.ts`

**Interfaces:**
- Consumes: `defineTool`（@deepseek-ai/dsh-tools）、`BrowserDriver`（Task 6）、`Scenario`（Task 4）、`saveScreenshot`/`assertImageCapable`（Task 5）、`cleanup` 解析函数（Task 3）。
- Produces:
  - `function registerBrowserTools(ctx: Context): void`（注册四件套 + 启动时孤儿清理 + `ctx.effect` 注册 dispose）
  - `function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T>`
  - 工具名与完整参数 schema 见 Step 3（copy-paste 真源）。

- [ ] **Step 1: 写注册冒烟测试（fake ctx 捕获注册，不启动浏览器）**

`tests/tools.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { registerBrowserTools } from '../src/tools/index.ts'

describe('registerBrowserTools', () => {
  it('registers exactly the four tools with names and schemas', () => {
    const registered: Array<{ name: string; parameters: Record<string, unknown> }> = []
    const ctx = {
      tools: { register: (tool: any) => registered.push(tool) },
      get: () => undefined,
      effect: () => () => {},
      emit: () => {},
    }
    registerBrowserTools(ctx as any)
    expect(registered.map(t => t.name)).toEqual(['browser_open', 'browser_mock', 'browser_assert', 'browser_screenshot'])
    expect(registered[0].parameters.url.required).toBe(true)
    expect(registered[1].parameters.urlPattern).toBeDefined()
    expect(registered[2].parameters.selector.required).toBe(true)
    expect(registered[3].parameters.fullPage).toBeDefined()
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm vitest run tests/tools.test.ts`

- [ ] **Step 3: 写实现**

`src/tools/timeout.ts`：

```ts
/** Race a promise against a deadline; the loser's work is abandoned, not awaited. */
export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`browser-verify: ${label} 超时（${ms}ms）。请检查页面或调大 DSH_BROWSER_VERIFY_TIMEOUT 后重试。`)), ms)
    promise.then(
      value => { clearTimeout(timer); resolve(value) },
      error => { clearTimeout(timer); reject(error) },
    )
  })
}
```

`src/tools/index.ts`（四个工具完整定义；**描述文案即最终交付文案**）：

```ts
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
    description: '在无头浏览器中打开一个页面并返回页面状态（标题/状态码/可见文本摘要/console 错误）用于验证前端页面；可选 waitSelector 等待关键元素出现，默认视口 390×844 @2x（移动端形态）。验证顺序：先 browser_assert 做 DOM 断言，确需看版式再 browser_screenshot。',
    parameters: {
      url: { type: 'string', required: true, description: '页面地址，如 http://localhost:5173/hweb/pages/...' },
      viewport: { type: 'object', description: `视口尺寸，默认 ${defaultViewport.width}x${defaultViewport.height}` },
      deviceScaleFactor: { type: 'number', description: '缩放比，默认 2' },
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
    },
    async execute(args) {
      return withTimeout(
        driver.startScenario({ url: args.url, waitSelector: args.waitSelector, timeoutMs: args.timeoutMs ?? envTimeoutMs() }),
        envTimeoutMs(), 'browser_open',
      )
    },
  }))

  ctx.tools.register(defineTool({
    name: 'browser_mock',
    description: '为当前验证场景注册接口拦截并自动重新加载页面：urlPattern 用 playwright glob（如 **/api/lifeIndex.do*），拦截后返回指定 json，用于 mock 空态/异常态。与已注册 pattern 完全相同时报错；请先 browser_open。',
    parameters: {
      urlPattern: { type: 'string', required: true, description: 'glob 模式，如 **/api/lifeIndex.do*' },
      json: { description: '拦截响应体（任意 JSON）', required: true },
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
    },
    async execute(args) {
      return driver.withScenario(scenario => scenario.addMock({
        urlPattern: args.urlPattern, json: args.json, status: args.status, reload: args.reload, timeoutMs: envTimeoutMs(),
      }))
    },
  }))

  ctx.tools.register(defineTool({
    name: 'browser_assert',
    description: '对当前页面 DOM 断言：selector 必须存在，可校验匹配数量（count，数字或 {min,max}）与文本包含（text）。不满足时返回 pass:false 并附差异、不抛错。这是最省 token 的验证手段，优先于截图。',
    parameters: {
      selector: { type: 'string', required: true, description: 'CSS 选择器' },
      count: { oneOf: [{ type: 'number' }, { type: 'object', properties: { min: { type: 'number', required: true }, max: { type: 'number', required: true } } }], description: '期望匹配数量：数字=精确，或 {min,max}=范围' },
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
```

- [ ] **Step 4: 运行注册测试 + 全量测试，确认通过**

Run: `pnpm vitest run && pnpm typecheck`
Expected: 全部通过（schemas 合法、四工具注册正确；execute 的真实行为由 Task 8 冒烟验证）。

- [ ] **Step 5: 写插件组装入口 `src/index.ts`（替换 Task 1 占位）**

`src/index.ts` 持有启动清理（孤儿目录/进程，best-effort）与工具注册：

```ts
import type { Context } from '@deepseek-ai/cordis'
import { exec as execCb } from 'node:child_process'
import { readdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseZombiePids, selectOrphanDirs } from './cleanup.ts'
import { registerBrowserTools } from './tools/index.ts'

export const name = 'browser-verify'
export const inject = ['tools']

const prefix = 'dsh-browser-verify-'

/** One-shot startup sweep: old temp dirs + stray Chromium, limited to our prefix. */
async function sweepOrphans(): Promise<void> {
  const root = tmpdir()
  const entries: Array<{ path: string; mtimeMs: number }> = []
  const dirents = await readdir(root, { withFileTypes: true }).catch(() => [])
  for (const dirent of dirents) {
    if (!dirent.name.startsWith(prefix) || !dirent.isDirectory()) continue
    const full = join(root, dirent.name)
    const info = await stat(full).catch(() => null)
    if (info !== null) entries.push({ path: full, mtimeMs: info.mtimeMs })
  }
  for (const orphan of selectOrphanDirs(entries, Date.now(), 3_600_000, prefix)) {
    await rm(orphan.path, { recursive: true, force: true }).catch(() => undefined)
  }
  execCb('ps -Ao pid=,ppid=,command=', (error, stdout) => {
    if (error !== null) return
    for (const pid of parseZombiePids(String(stdout), prefix, process.pid)) {
      try { process.kill(pid, 'SIGKILL') } catch { /* already gone */ }
    }
  })
}

export function apply(ctx: Context): void {
  void sweepOrphans()
  registerBrowserTools(ctx)
}
```

- [ ] **Step 6: 运行确认通过 + 提交**

Run: `pnpm vitest run && pnpm typecheck && pnpm build`
Expected: 全绿；`lib/index.js` 含四工具注册。

```bash
git add -A && git commit -m "feat: register the four browser verification tools"
```

---

### Task 8: `cli.ts` + 两态冒烟脚本（真实浏览器闭环 + 垃圾验收）

**Files:**
- Create: `src/cli.ts`、`tests/fixtures/mock-empty.json`、`tests/fixtures/mock-normal.json`、`scripts/smoke.sh`
- Test: `tests/cli.test.ts`（仅参数解析纯函数）

**Interfaces:**
- Consumes: `discoverBrowser`、`BrowserDriver`（含 `startScenario`）、`Scenario`、`withTimeout`；不 import harness 模块。
- Produces: `function parseCliArgs(argv: string[]): CliOptions`（纯，供测试）；`lib/cli.js` 可执行入口。

- [ ] **Step 1: 写参数解析测试**

`tests/cli.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { parseCliArgs } from '../src/cli.ts'

describe('parseCliArgs', () => {
  it('parses url, mock, assert, screenshot, persist, viewport', () => {
    const opts = parseCliArgs(['--url', 'http://x', '--mock', 'fixtures/mock-empty.json', '--assert', '.empty', '--screenshot', '--persist', './out', '--viewport', '390x844'])
    expect(opts.url).toBe('http://x')
    expect(opts.mockFile).toBe('fixtures/mock-empty.json')
    expect(opts.assertSelector).toBe('.empty')
    expect(opts.screenshot).toBe(true)
    expect(opts.persistDir).toBe('./out')
    expect(opts.viewport).toEqual({ width: 390, height: 844 })
  })

  it('requires --url', () => {
    expect(() => parseCliArgs(['--assert', '.x'])).toThrow(/--url/)
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm vitest run tests/cli.test.ts`

- [ ] **Step 3: 写 `src/cli.ts`**

```ts
/**
 * Debug CLI for dsh-browser-verify: exercises the same core the tools use,
 * without the harness. Prints structured JSON results.
 * @module dsh-browser-verify/cli
 */

import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { BrowserDriver } from './browser/driver.ts'

export interface CliOptions {
  url: string
  mockFile?: string
  assertSelector?: string
  screenshot?: boolean
  persistDir?: string
  viewport: { width: number; height: number }
}

export function parseCliArgs(argv: string[]): CliOptions {
  const opts: CliOptions = { url: '', viewport: { width: 390, height: 844 } }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    const next = (): string => { const v = argv[++i]; if (v === undefined) throw new Error(`--${arg} 需要参数`); return v }
    if (arg === '--url') opts.url = next()
    else if (arg === '--mock') opts.mockFile = next()
    else if (arg === '--assert') opts.assertSelector = next()
    else if (arg === '--screenshot') opts.screenshot = true
    else if (arg === '--persist') opts.persistDir = next()
    else if (arg === '--viewport') {
      const [w, h] = next().split('x').map(Number)
      opts.viewport = { width: w, height: h }
    } else throw new Error(`未知参数: ${arg}`)
  }
  if (opts.url === '') throw new Error('browser-verify cli: 缺少 --url')
  return opts
}

async function main(): Promise<void> {
  const opts = parseCliArgs(process.argv.slice(2))
  const driver = new BrowserDriver({ viewport: opts.viewport })
  try {
    const opened = await driver.startScenario({ url: opts.url, timeoutMs: 15000 })
    console.log(JSON.stringify({ step: 'open', ...opened }))
    if (opts.mockFile !== undefined) {
      const rule = JSON.parse(await readFile(opts.mockFile, 'utf8')) as { urlPattern: string; json: unknown; status?: number }
      const patterns = await driver.withScenario(s => s.addMock({ ...rule, timeoutMs: 15000 }))
      console.log(JSON.stringify({ step: 'mock', patterns }))
    }
    if (opts.assertSelector !== undefined) {
      const result = await driver.withScenario(s => s.assert({ selector: opts.assertSelector, timeoutMs: 5000 }))
      console.log(JSON.stringify({ step: 'assert', ...result }))
    }
    if (opts.screenshot === true) {
      const shot = await driver.withScenario(s => s.screenshot({ fullPage: false }))
      // Default: inside the pid temp dir (deleted by driver.dispose). --persist keeps it.
      const path = opts.persistDir === undefined
        ? join(tmpdir(), `dsh-browser-verify-${process.pid}`, 'cli-last.png')
        : join(resolve(opts.persistDir), `browser-verify-${Date.now()}.png`)
      await import('node:fs/promises').then(fs => fs.writeFile(path, shot.data))
      console.log(JSON.stringify({ step: 'screenshot', path, keep: opts.persistDir !== undefined, sha256: shot.sha256, identicalToPrevious: shot.identicalToPrevious }))
    }
  } finally {
    await driver.dispose()
  }
}

void main().catch(error => { console.error(String(error)); process.exitCode = 1 })
```

- [ ] **Step 4: 写两态 fixtures**

`tests/fixtures/mock-empty.json`：

```json
{ "urlPattern": "**/api/lifeIndex.do*", "json": { "code": 0, "data": { "list": [] } }, "status": 200 }
```

`tests/fixtures/mock-normal.json`：

```json
{ "urlPattern": "**/api/lifeIndex.do*", "json": { "code": 0, "data": { "list": [ { "title": "水费", "amount": 128.00 } ] } }, "status": 200 }
```

- [ ] **Step 5: 写冒烟脚本 `scripts/smoke.sh`（含垃圾对比）**

```bash
#!/usr/bin/env bash
# Two-state smoke for the core: MUST be run with hhhweb dev server on :5173.
set -euo pipefail
cd "$(dirname "$0")/.."
pnpm build
TMP_BEFORE=$(mktemp -d); TMP_AFTER=$(mktemp -d)
cp -R /tmp/dsh-browser-verify-* "$TMP_BEFORE/" 2>/dev/null || true
node lib/cli.js --url 'http://localhost:5173/hweb/pages/lyp/livingPayment' \
  --mock tests/fixtures/mock-empty.json --assert '.empty-tip' --screenshot
node lib/cli.js --url 'http://localhost:5173/hweb/pages/lyp/livingPayment' \
  --mock tests/fixtures/mock-normal.json --assert '.pay-item' --screenshot
sleep 1
cp -R /tmp/dsh-browser-verify-* "$TMP_AFTER/" 2>/dev/null || true
echo "--- garbage diff ---"
diff -r "$TMP_BEFORE" "$TMP_AFTER" || echo "残留差异见上（预期：无——CLI 默认截图在 pid 临时目录内，dispose 时删除）"
rm -rf "$TMP_BEFORE" "$TMP_AFTER"
echo "--- zombie chromium ---"
ps -Ao pid=,command= | grep -c 'user-data-dir=/tmp/dsh-browser-verify-' || true
```

- [ ] **Step 6: 运行冒烟**

Run: `pnpm build && bash scripts/smoke.sh`（先确认 `curl -s http://localhost:5173/hweb/ | head -1` 有响应）
Expected: open 返回 `visible` 含页面文案；assert 分别命中空态/正常态元素；screenshot step 输出 sha256；`/tmp` 无残留（或仅截图文件）；zombie 计数为 0。

- [ ] **Step 7: 提交**

```bash
git add -A && git commit -m "feat: debug CLI + two-state smoke script"
```

---

### Task 9: 实装集成（装载进 web profile + 模型侧闭环）

**Files:**
- Create: `scripts/integration-notes.md`（验证记录）
- Modify: 无（只在 harness profile 侧操作与记录）

**Interfaces:**
- Consumes: Task 1–8 产物。

- [ ] **Step 1: 构建并装载（pnpm link，免 pack）**

```bash
cd /Users/dongshuai/Desktop/AIWorks/dsh-browser-verify && pnpm build
cd /Users/dongshuai/Desktop/AIWorks/deepseek-harness && pnpm dsh plugin --profile web add /Users/dongshuai/Desktop/AIWorks/dsh-browser-verify
```
Expected: 输出确认 profile `dependencies` 出现 `"dsh-browser-verify": "link:..."` 且 bundle 列表追加。

- [ ] **Step 2: 验证层生效**

```bash
cd /Users/dongshuai/Desktop/AIWorks/deepseek-harness && pnpm dsh --profile web --dump-config 2>&1 | grep -A3 'browser-verify'
```
Expected: 出现 `# == dsh-browser-verify` 层与插入行。

- [ ] **Step 3: 重启 Web GUI 并新开会话验证工具入目录**

重启 dev server 后（用户操作），新会话中确认 `browser_open` / `browser_mock` / `browser_assert` / `browser_screenshot` 出现在工具目录；调用一次 `browser_open`（指向 hhhweb 缴费页）验证返回结构。

- [ ] **Step 4: 模型侧两态闭环（≤8 次调用）**

在会话中依次：`browser_open`（正常态）→ `browser_mock`（空态 json）→（重开）`browser_open` → `browser_assert('.empty-tip')` → `browser_assert('.pay-item')` → `browser_screenshot`。验证：断言精确命中、截图块自动进上下文、`identicalToPrevious` 语义正确。**调用次数记录在 `scripts/integration-notes.md` —— 两态 ≤8 次是验收线。**

- [ ] **Step 5: 垃圾验收**

对比 `/tmp`（无 `dsh-browser-verify-*` 残留）、`ps`（无 `--user-data-dir=/tmp/dsh-browser-verify-` 进程）、附件库增量（= 截图张数，同图幂等不重复）。结果记录进 `scripts/integration-notes.md`。

- [ ] **Step 6: 提交**

```bash
git add scripts/integration-notes.md && git commit -m "docs: integration verification notes"
```

---

### Task 10: 文档与收尾（README + 清理指引 + 覆盖率）

**Files:**
- Create: `README.md`、`README.zh.md`
- Modify: 无

- [ ] **Step 1: 写 `README.md`（核心内容，中文版全文对应）**

包含：一句话定位（提效判据）；安装（tgz / 目录 link / git+https 需 prepare+allowBuilds）；四工具两句话示例；环境变量表（`DSH_BROWSER_VERIFY_CHROMIUM` / `DSH_BROWSER_VERIFY_TIMEOUT` / `DSH_BROWSER_VERIFY_IDLE_MS`）；垃圾清理指引（`rm -rf /tmp/dsh-browser-verify-*`、附件库位置与说明、`npx playwright install chromium` 下载目录整删说明）；开发迭代命令（build/test/cli/smoke）；多机迁移（安装命令、浏览器缓存不随仓）。

- [ ] **Step 2: 覆盖率与全量验证**

Run: `pnpm vitest run --coverage && pnpm typecheck && pnpm build`
Expected: `src/browser/discover.ts`、`src/browser/scenario.ts`（纯函数）、`src/cleanup.ts`、`src/attachments.ts` 语句覆盖 ≥ 90%；全绿。

- [ ] **Step 3: 提交并收尾**

```bash
git add -A && git commit -m "docs: README (zh/en) with install, env, cleanup and migration guide"
```

---

## 自查记录（执行者不需要重复）

- **Spec 覆盖**：§1 四件套+CLI → Task 7/8；§4 discover → Task 2；§4.2 生命周期 → Task 6/7；§5 契约 → Task 7/8；§6 垃圾 → Task 3/8/9；§8 环境变量 → Task 7/9/10；§9 测试 → Task 2–8；§10 安装 → Task 9；§11 工程 → Task 1/10；§13 裁决全部落入 Global Constraints 与前列任务。
- **占位符**：无 TBD/TODO；所有"骨架/修正"性文字已替换为完整目标代码（Task 6/7 的最终实现段落即交付代码）。
- **类型一致性**：`discoverBrowser`/`DiscoveredBrowser`、`Scenario`（navigate/addMock/assert/screenshot/close）、`BrowserDriver`（ensureBrowser/startScenario/withScenario/dispose，opts 含 viewport/deviceScaleFactor）、`saveScreenshot`/`assertImageCapable`/`renderScreenshotBlocks`、`parseZombiePids`/`selectOrphanDirs` 在引用处签名一致。
- **语义一致性**：`browser_mock` 默认自动 reload（Global Constraints → scenario.addMock → browser_mock execute → CLI 冒烟同序）；`browser_open` 的 `status` 取 `page.goto` response；输出 schema 用 `oneOf` 表达可空字段。
