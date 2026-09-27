import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The dev server proxies /api to the local FastAPI backend; in production the
// portal nginx does the same (see nginx.conf), so the app always talks
// same-origin and never hardcodes a backend host.
export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: true,
    proxy: {
      '/api': { target: process.env.API_URL || 'http://127.0.0.1:8001', changeOrigin: true },
    },
  },
})
