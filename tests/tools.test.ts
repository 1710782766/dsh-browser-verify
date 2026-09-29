import { describe, expect, it } from 'vitest'
import { registerBrowserTools } from '../src/tools/index.ts'

describe('registerBrowserTools', () => {
  it('registers exactly the five tools with names and schemas', () => {
    // rc.8 defineTool compiles parameters to raw JSON Schema: { type: 'object', properties, required }.
    const registered: Array<{ name: string; parameters: any }> = []
    const ctx = {
      tools: { register: (tool: any) => registered.push(tool) },
      get: () => undefined,
      effect: () => () => {},
      emit: () => {},
    }
    registerBrowserTools(ctx as any)
    expect(registered.map(t => t.name)).toEqual(['browser_open', 'browser_reload', 'browser_mock', 'browser_assert', 'browser_screenshot'])
    expect(registered[0].parameters.required).toContain('url')
    expect(registered[0].parameters.properties.mocks).toBeDefined()
    // browser_reload takes no url: re-verifying after an edit must not re-send it.
    expect(registered[1].parameters.required).toBeUndefined()
    expect(registered[1].parameters.properties.waitSelector).toBeDefined()
    expect(registered[2].parameters.properties.urlPattern).toBeDefined()
    expect(registered[3].parameters.required).toContain('selector')
    expect(registered[4].parameters.properties.fullPage).toBeDefined()
  })

  it('publishes mock-hit feedback in the mock and reload return schemas', () => {
    const registered: Array<{ name: string; output: any }> = []
    const ctx = {
      tools: { register: (tool: any) => registered.push(tool) },
      get: () => undefined,
      effect: () => () => {},
      emit: () => {},
    }
    registerBrowserTools(ctx as any)
    const mock = registered.find(t => t.name === 'browser_mock')!.output.schema.properties
    expect(Object.keys(mock).sort()).toEqual(['hits', 'patterns', 'updated'])
    expect(registered.find(t => t.name === 'browser_reload')!.output.schema.properties.mockHits).toBeDefined()
  })

  it('accepts every media type the store can publish for a screenshot', () => {
    // The store re-encodes above its normalization budget, and defineTool
    // validates the returned value against this schema: a PNG-only enum would
    // reject a normalized JPEG/WebP capture at the return-value boundary.
    const registered: Array<{ output: any }> = []
    const ctx = {
      tools: { register: (tool: any) => registered.push(tool) },
      get: () => undefined,
      effect: () => () => {},
      emit: () => {},
    }
    registerBrowserTools(ctx as any)
    expect(registered[4].output.schema.properties.image.properties.mediaType.enum)
      .toEqual(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
  })
})
