import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e', timeout: 30_000, fullyParallel: false, retries: 0,
  use: { baseURL: 'http://127.0.0.1:4173', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  webServer: { command: 'node node_modules/vite/bin/vite.js preview --host 127.0.0.1', url: 'http://127.0.0.1:4173', reuseExistingServer: true, timeout: 120_000 },
  projects: [
    { name: 'iphone-14', use: { ...devices['iPhone 14'], browserName: 'chromium', viewport: { width: 390, height: 844 } } },
    { name: 'small-mobile', use: { browserName: 'chromium', viewport: { width: 360, height: 800 } } },
    { name: 'desktop', use: { browserName: 'chromium', viewport: { width: 1280, height: 900 } } },
  ],
})
