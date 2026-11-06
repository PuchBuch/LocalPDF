import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: 'e2e-extension',
  workers: 1,
  timeout: 60_000,
  reporter: 'list'
})
