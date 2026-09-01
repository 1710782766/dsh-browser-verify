/**
 * Host-only build config for dsh-browser-verify. Emits ESM to lib/.
 * Cordis + harness contract modules resolve at runtime from the dsh profile
 * tree; playwright-core resolves from the plugin's own install.
 * @module dsh-browser-verify/build
 */
import type { UserConfig } from 'tsdown'

const configs: UserConfig[] = [{
  name: 'dsh-browser-verify',
  entry: ['src/index.ts', 'src/cli.ts'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
  external: [
    '@deepseek-ai/cordis',
    '@deepseek-ai/dsh-attachment',
    '@deepseek-ai/dsh-llm',
    '@deepseek-ai/dsh-tools',
    'playwright-core',
  ],
}]

export default configs
