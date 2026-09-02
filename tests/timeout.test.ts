import { describe, expect, it } from 'vitest'
import { withTimeout } from '../src/tools/timeout.ts'

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))

describe('withTimeout', () => {
  it('resolves with the inner value before the deadline', async () => {
    await expect(withTimeout(sleep(20).then(() => 'ok'), 200, 'browser_open')).resolves.toBe('ok')
  })

  it('rejects with the inner error when it fails first', async () => {
    const boom = new Error('inner boom')
    await expect(withTimeout(sleep(20).then(() => { throw boom }), 200, 'browser_open')).rejects.toBe(boom)
  })

  it('rejects with an actionable timeout message when the deadline passes', async () => {
    let message = ''
    try {
      await withTimeout(sleep(200).then(() => 'late'), 50, 'browser_open')
    } catch (error) {
      message = (error as Error).message
    }
    expect(message.startsWith('browser-verify: ')).toBe(true)
    expect(message).toMatch(/调大 DSH_BROWSER_VERIFY_TIMEOUT/)
  })
})
