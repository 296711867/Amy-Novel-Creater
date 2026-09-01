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
  renderer: {
    resolve: { alias: aliases },
    plugins: [react()],
    build: {
      minify: 'esbuild',
      rollupOptions: {
        output: {
          // AN-013：公共依赖独立分包，避免单一入口 chunk 超 500KB 告警线。
          manualChunks(id: string) {
            if (!id.includes('node_modules')) return undefined
            if (/[\\/](react|react-dom|scheduler|zustand)[\\/]/.test(id) || id.includes('react-router'))
              return 'vendor-react'
            if (id.includes('zod')) return 'vendor-zod'
            if (id.includes('lucide-react')) return 'vendor-icons'
            return 'vendor-misc'
          }
        }
      }
    }
  }
})
