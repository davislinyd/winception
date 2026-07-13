import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './apps/docs/e2e',
  timeout: 30_000,
  expect: { timeout: 8_000 },
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:19090/winception/',
    browserName: 'chromium',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run docs:build:pages && docusaurus serve apps/docs --dir ../../dist/docs-pages --host 127.0.0.1 --port 19090 --no-open',
    url: 'http://127.0.0.1:19090/winception/',
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
