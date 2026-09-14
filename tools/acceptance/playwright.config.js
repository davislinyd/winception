import { defineConfig } from '@playwright/test';
import { randomUUID } from 'node:crypto';
process.env.WINCEPTION_UI_RUN_ID = randomUUID();
export default defineConfig({
  globalTeardown: './teardown.mjs',
  testDir: './ui', workers: 1, retries: 0, timeout: 30_000,
  outputDir: '../../test-results/acceptance-ui',
  reporter: [['list'], ['./reporter.mjs'], ['json', { outputFile: '../../test-results/acceptance-ui.json' }], ['html', { outputFolder: '../../playwright-report', open: 'never' }]],
  use: { browserName: 'chromium', ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}), baseURL: 'http://127.0.0.1:4173', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  webServer: { command: 'node tools/acceptance/preview.mjs', cwd: '../..', url: 'http://127.0.0.1:4173', reuseExistingServer: false },
});
