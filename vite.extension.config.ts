import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// The same interface as the desktop app, with the extension's bridge in place of Electron.
export default defineConfig({
  root: resolve(__dirname, 'src/extension'),
  base: './',
  publicDir: resolve(__dirname, 'src/renderer/public'),
  plugins: [react()],
  build: {
    outDir: resolve(__dirname, 'out-extension'),
    emptyOutDir: true,
    chunkSizeWarningLimit: 8000
  }
})
