import { describe, expect, it } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseZombiePids, selectOrphanDirs } from '../src/cleanup.ts'

describe('parseZombiePids', () => {
  it('returns pids whose command carries the tmp prefix, excluding self', () => {
    const ps = [
      `12345 1 /path/to/chrome --user-data-dir=${join(tmpdir(), 'dsh-browser-verify-999')}/chrome`,
      '54321 1 /usr/bin/something --user-data-dir=/tmp/other',
      `999 1 /path/to/chrome --user-data-dir=${join(tmpdir(), 'dsh-browser-verify-999')}`,
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
