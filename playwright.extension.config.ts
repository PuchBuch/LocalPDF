import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: 'e2e-extension',
  workers: 1,
  timeout: 60_000,
  reporter: 'list',
  // Edge is the one installed with Windows; it is never downloaded.
  projects: [
    { name: 'chromium', use: { channel: 'chromium' } },
    { name: 'edge', use: { channel: 'msedge' } }
  ]
})
