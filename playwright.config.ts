import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './apps/web/e2e',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:18080',
    browserName: 'chromium',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run v2:build && tsx apps/server/test/e2eServer.ts',
    url: 'http://127.0.0.1:18080/api/v2/health',
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
