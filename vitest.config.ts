import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: { alias: { '@domain':resolve('src/domain'), '@application':resolve('src/application'), '@shared':resolve('src/shared') } },
  test: { include:['tests/**/*.test.ts'] }
})
