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
    const next = (): string => { const v = argv[++i]; if (v === undefined) throw new Error(`--${arg} 需要参数`); return v }
    if (arg === '--url') opts.url = next()
    else if (arg === '--mock') opts.mockFile = next()
    else if (arg === '--wait-selector') opts.waitSelector = next()
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
  // Deviation D8-4: read the fixture before opening, then pass it as
  // startScenario `mocks` so it is registered before the first navigation
  // (the app boot may bounce to a fallback route if unmocked APIs answer).
  const rule = opts.mockFile === undefined
    ? null
    : JSON.parse(await readFile(opts.mockFile, 'utf8')) as { urlPattern: string; json: unknown; status?: number }
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
