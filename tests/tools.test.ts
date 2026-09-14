import { describe, expect, it } from 'vitest'
import { registerBrowserTools } from '../src/tools/index.ts'

describe('registerBrowserTools', () => {
  it('registers exactly the four tools with names and schemas', () => {
    // rc.8 defineTool compiles parameters to raw JSON Schema: { type: 'object', properties, required }.
    const registered: Array<{ name: string; parameters: any }> = []
    const ctx = {
      tools: { register: (tool: any) => registered.push(tool) },
      get: () => undefined,
      effect: () => () => {},
      emit: () => {},
    }
    registerBrowserTools(ctx as any)
    expect(registered.map(t => t.name)).toEqual(['browser_open', 'browser_mock', 'browser_assert', 'browser_screenshot'])
    expect(registered[0].parameters.required).toContain('url')
    expect(registered[0].parameters.properties.mocks).toBeDefined()
    expect(registered[1].parameters.properties.urlPattern).toBeDefined()
    expect(registered[2].parameters.required).toContain('selector')
    expect(registered[3].parameters.properties.fullPage).toBeDefined()
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
    expect(registered[3].output.schema.properties.image.properties.mediaType.enum)
      .toEqual(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
  })
})
