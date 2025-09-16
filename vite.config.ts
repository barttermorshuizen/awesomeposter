import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    vue(),
    vueDevTools(),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    },
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        // Surface proxy errors in the Vite console to aid debugging when the API is down
        configure: (proxy: any) => {
          proxy.on('error', (err: any, req: any) => {
            try {
              console.error('[vite-proxy] /api error:', err?.message || err)
            } catch {}
          })
        },
      },
    },
  },
})
