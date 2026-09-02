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
    if (dirent.name === `${prefix}${process.pid}`) continue
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
