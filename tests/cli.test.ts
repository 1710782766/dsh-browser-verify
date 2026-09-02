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
