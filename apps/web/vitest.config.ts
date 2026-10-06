import path from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    // Mirrors the "@/*" path in tsconfig.json.
    alias: { '@': path.resolve(__dirname, '.') },
  },
  test: {
    environment: 'node',
    passWithNoTests: true,
  },
})
