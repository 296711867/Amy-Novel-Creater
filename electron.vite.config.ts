import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

const aliases = {
  '@domain': resolve('src/domain'),
  '@application': resolve('src/application'),
  '@shared': resolve('src/shared'),
  '@renderer': resolve('src/renderer/src')
}

export default defineConfig({
  main: { resolve: { alias: aliases } },
  preload: {
    resolve: { alias: aliases },
    build: { rollupOptions: { output: { format: 'cjs', entryFileNames: '[name].cjs' } } }
  },
  renderer: { resolve: { alias: aliases }, plugins: [react()] }
})
