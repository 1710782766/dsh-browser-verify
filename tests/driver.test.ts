import { describe, expect, it } from 'vitest'
import { buildLaunchArgs } from '../src/browser/driver.ts'

// Deviation D8-3: the brief (Task 6) had buildLaunchArgs emit
// `--user-data-dir=<dir>`; playwright-core 1.41+ rejects that flag in launch
// args (misuse error) for both launch() and launchPersistentContext(). The
// user data dir is now passed as launchPersistentContext's first parameter,
// and driver.ts keeps only the headless-mode flag here.
describe('buildLaunchArgs', () => {
  it('sets headless per kind', () => {
    expect(buildLaunchArgs(true)).toContain('--headless')
    expect(buildLaunchArgs(false)).toContain('--headless=new')
  })

  it('never passes user-data-dir / no-sandbox / remote-debugging flags', () => {
    const args = [...buildLaunchArgs(true), ...buildLaunchArgs(false)]
    expect(args.join(' ')).not.toMatch(/--user-data-dir|--no-sandbox|--remote-debugging/)
  })
})
