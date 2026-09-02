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
  waitSelector?: string
  assertSelector?: string
  screenshot?: boolean
  persistDir?: string
  viewport: { width: number; height: number }
}

export function parseCliArgs(argv: string[]): CliOptions {
  const opts: CliOptions = { url: '', viewport: { width: 390, height: 844 } }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    const next = (): string => { const v = argv[++i]; if (v === undefined) throw new Error(`browser-verify: 参数 --${arg} 缺少值。请按 --url <url> 的用法补充。`); return v }
    if (arg === '--url') opts.url = next()
    else if (arg === '--mock') opts.mockFile = next()
    else if (arg === '--wait-selector') opts.waitSelector = next()
    else if (arg === '--assert') opts.assertSelector = next()
    else if (arg === '--screenshot') opts.screenshot = true
    else if (arg === '--persist') opts.persistDir = next()
    else if (arg === '--viewport') {
      const [w, h] = next().split('x').map(Number)
      opts.viewport = { width: w, height: h }
    } else throw new Error(`browser-verify: 未知参数 --${arg}。请检查命令行用法（--url/--mock/--assert/--screenshot/--persist/--viewport）。`)
  }
  if (opts.url === '') throw new Error('browser-verify: 缺少 --url。请提供页面地址，如 --url http://localhost:5173/hweb/#/pages/lyp/livingPayment。')
  return opts
}

async function main(): Promise<void> {
  const opts = parseCliArgs(process.argv.slice(2))
  // Deviation D8-4: read the fixture before opening, then pass it as
  // startScenario `mocks` so it is registered before the first navigation
  // (the app boot may bounce to a fallback route if unmocked APIs answer).
  let rule: { urlPattern: string; json: unknown; status?: number } | null = null
  if (opts.mockFile !== undefined) {
    try {
      rule = JSON.parse(await readFile(opts.mockFile, 'utf8')) as { urlPattern: string; json: unknown; status?: number }
    } catch (error) {
      const raw = error instanceof Error ? error.message : String(error)
      throw new Error(`browser-verify: 读取 --mock 文件失败: ${raw}。请检查文件路径与 JSON 格式。`)
    }
  }
  const driver = new BrowserDriver({ viewport: opts.viewport })
  try {
    const opened = await driver.startScenario({
      url: opts.url,
      timeoutMs: 15000,
      waitSelector: opts.waitSelector,
      mocks: rule === null ? undefined : [{ urlPattern: rule.urlPattern, json: rule.json, status: rule.status }],
    })
    console.log(JSON.stringify({ step: 'open', ...opened }))
    if (rule !== null) {
      console.log(JSON.stringify({ step: 'mock', patterns: [rule.urlPattern] }))
    }
    if (opts.assertSelector !== undefined) {
      // Deviation D8-2: TS does not narrow property accesses inside closures.
      const assertSelector = opts.assertSelector
      const result = await driver.withScenario(s => s.assert({ selector: assertSelector, timeoutMs: 5000 }))
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

// Deviation D8-1 (brief omitted the guard): only auto-run when this module is
// the CLI entry, so importing parseCliArgs (vitest) has no side effects.
if (process.argv[1] !== undefined && /(^|[\\/])cli\.(js|ts)$/.test(process.argv[1])) {
  void main().catch(error => { console.error(String(error)); process.exitCode = 1 })
}
