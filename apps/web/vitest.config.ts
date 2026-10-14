import path from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  // tsconfig keeps jsx as "preserve" for Next; tests that import a component need it compiled.
  oxc: { jsx: { runtime: 'automatic' } },
  resolve: {
    // Mirrors the "@/*" path in tsconfig.json.
    alias: { '@': path.resolve(__dirname, '.') },
  },
  test: {
    environment: 'node',
    passWithNoTests: true,
  },
})
