import { defineConfig } from 'tsdown'

export default defineConfig([
  {
    entry: { index: 'src/host/index.ts' },
    outDir: 'lib',
    format: 'esm',
    dts: false,
    clean: false,
    platform: 'node',
    outExtensions: () => ({ js: '.js' }),
    deps: { neverBundle: [/^node:/, /^@deepseek-ai\//] },
  },
  {
    entry: { 'client.raw': 'src/client/index.tsx' },
    outDir: 'build',
    format: 'cjs',
    dts: false,
    clean: false,
    platform: 'browser',
    outExtensions: () => ({ js: '.js' }),
    deps: { neverBundle: [/^react/, /^@deepseek-ai\//] },
  },
])
