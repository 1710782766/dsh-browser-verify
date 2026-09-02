import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['src/browser/discover.ts', 'src/cleanup.ts', 'src/attachments.ts'],
      thresholds: { perFile: true, statements: 90 },
    },
  },
})
