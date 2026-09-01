import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@domain': resolve('src/domain'),
      '@application': resolve('src/application'),
      '@shared': resolve('src/shared'),
      '@renderer': resolve('src/renderer/src')
    }
  },
  build: {
    outDir: 'dist-web',
    rollupOptions: {
      output: {
        // AN-013：公共依赖独立分包，避免单一入口 chunk 超 500KB 告警线。
        manualChunks(id) {
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
})
