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
