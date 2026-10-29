import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: {
    port: 5173,
    proxy: Object.fromEntries(['/api', '/sanctum', '/storage'].map(prefix => [prefix, {
      target: process.env.DEV_API_TARGET || 'http://127.0.0.1:8000', changeOrigin: true,
    }])),
  },
  build: {
    outDir: 'dist', emptyOutDir: true,
    // ExcelJS (~940 kB) is one library loaded only when a spreadsheet is imported or exported; it cannot be split further.
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        // Charts are a large vendor dependency of the dashboard; keep them in their own long-cached chunk.
        manualChunks: id => /node_modules[\\/](recharts|d3-|victory-vendor)/.test(id) ? 'charts' : undefined,
      },
    },
  },
  test: { environment: 'jsdom', setupFiles: ['./src/test/setup.ts'], include: ['src/**/*.test.{ts,tsx}'], restoreMocks: true },
})
