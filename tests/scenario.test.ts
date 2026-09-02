import { describe, expect, it } from 'vitest'
import { assertNoMockConflict, capConsoleErrors, isNoiseText, normalizeCountSpec, sha256Hex, summarizeVisibleText, textDiff } from '../src/browser/scenario.ts'

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
    expect(out[1]).toHaveLength(40)
  })

  it('filters loading-state noise only; business states survive', () => {
    expect(isNoiseText('加载中...')).toBe(true)
    expect(isNoiseText('加载中')).toBe(true)
    expect(isNoiseText('正在加载…')).toBe(true)
    expect(isNoiseText('请稍候')).toBe(true)
    expect(isNoiseText('Loading...')).toBe(true)
    expect(isNoiseText('加载失败')).toBe(false)
    expect(isNoiseText('加载更多')).toBe(false)
    expect(isNoiseText('我的缴费')).toBe(false)
  })

  it('summarize drops noise and lets business text fill the 8-item cap', () => {
    const out = summarizeVisibleText(['加载中...', '加载中...', '我的缴费', '便捷生活 从缴费开始', '水费', '查看详情', '128.00'])
    expect(out.filter(isNoiseText)).toHaveLength(0)
    expect(out).toEqual(['我的缴费', '便捷生活 从缴费开始', '水费', '查看详情', '128.00'])
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
