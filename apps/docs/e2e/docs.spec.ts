import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test('wizard persists, validates, imports and exports a secret-free plan', async ({ page }) => {
  await page.goto('/winception/docs/install/');
  await expect(page.getByRole('heading', { name: 'Fresh install', exact: true })).toBeVisible();
  await page.getByLabel('管理 NIC alias').fill('Management Adapter');
  await page.reload();
  await expect(page.getByLabel('管理 NIC alias')).toHaveValue('Management Adapter');
  await page.getByLabel('PXE NIC alias').fill('Management Adapter');
  await expect(page.getByRole('alert')).toContainText('不可相同');
  await page.getByLabel('PXE NIC alias').fill('PXE Adapter');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '匯出 JSON' }).click();
  expect((await download).suggestedFilename()).toBe('winception-install-plan.json');
  await page.locator('input[type=file]').setInputFiles({
    name: 'plan.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ schemaVersion: 1, vmRole: 'deployment-host', source: 'release', releaseTag: 'v2.0.0-alpha.11', managementNic: 'WAN', pxeNic: 'PXE', managementSubnet: '192.168.50.0/24', pxeSubnet: '10.77.0.0/24', bootMode: 'secureboot', stepStatus: { 'host-checked': true, 'signature-verified': false, installed: false, 'runtime-prepared': false, 'acceptance-recorded': false } })),
  });
  await expect(page.getByLabel('管理 NIC alias')).toHaveValue('WAN');
  await expect(page.getByRole('status')).toContainText('schema');
  const stored = await page.evaluate(() => window.localStorage.getItem('winception-docs.install-plan.v1'));
  expect(stored).not.toMatch(/password|token|secret/iu);
});

test('local search, keyboard flow controls, reduced motion and accessibility work offline', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/winception/');
  await page.getByLabel('搜尋技術文件').fill('named pipe');
  await expect(page.getByRole('link', { name: '架構與安全邊界' })).toBeVisible();
  await expect(page.getByRole('button', { name: '播放' })).toBeDisabled();
  const first = page.locator('.flow-steps li[aria-current=step]');
  await expect(first).toContainText('1');
  await page.getByRole('button', { name: '下一步' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.flow-steps li[aria-current=step]')).toContainText('2');
  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(accessibility.violations).toEqual([]);
});
