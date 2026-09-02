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
