import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

// The dev server needs inline scripts and a websocket for hot reload.
// Production builds keep the strict policy written in index.html.
const relaxCspInDev = {
  name: 'relax-csp-in-dev',
  apply: 'serve' as const,
  transformIndexHtml: (html: string) =>
    html
      .replace("script-src 'self'", "script-src 'self' 'unsafe-inline'")
      .replace("connect-src 'self' blob:", "connect-src 'self' blob: ws:")
}

export default defineConfig({
  main: {},
  preload: {},
  renderer: {
    plugins: [react(), relaxCspInDev]
  }
})
