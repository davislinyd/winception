import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const setupCode = 'winception-e2e-management-token-0000000000000000';

test('login, keyboard focus, operation mutation and refresh recovery', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('link', { name: 'AGPL-3.0-only' })).toHaveAttribute('href', 'https://www.gnu.org/licenses/agpl-3.0.html');
  await expect(page.getByRole('link', { name: 'Documentation' })).toHaveAttribute('href', '/manual/');
  await expect(page.getByRole('link', { name: 'Release source' })).toHaveAttribute('href', 'https://github.com/davislinyd/winception/tree/v2.0.0-alpha.1');
  const input = page.getByLabel('Setup code');
  await input.fill(setupCode);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Deployment control plane' })).toBeVisible();
  await expect(page.getByText('connected', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'AGPL-3.0-only' })).toHaveAttribute('href', 'https://www.gnu.org/licenses/agpl-3.0.html');
  await expect(page.getByRole('link', { name: 'Documentation' })).toHaveAttribute('href', '/manual/');
  await expect(page.getByRole('link', { name: 'Release source' })).toHaveAttribute('href', 'https://github.com/davislinyd/winception/tree/v2.0.0-alpha.1');

  const imageInput = page.getByLabel('Image or catalog ID');
  await imageInput.fill('windows-11');
  await page.getByRole('button', { name: 'Download', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('e2e-1');
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Deployment control plane' })).toBeVisible();

  await page.keyboard.press('Tab');
  await expect(page.locator(':focus')).toBeVisible();
  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(accessibility.violations).toEqual([]);
});

test('typed product controls cover network, profiles, OS catalog and staged payloads', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Setup code').fill(setupCode);
  await page.getByRole('button', { name: 'Sign in' }).click();

  await page.getByRole('button', { name: 'Refresh monitor' }).click();
  const monitor = page.getByRole('region', { name: 'Deploy / Monitor' });
  await expect(monitor.getByText('run-1', { exact: true })).toBeVisible();
  await expect(monitor.getByText(/PASS Runtime/u)).toBeVisible();

  const runtime = page.locator('article').filter({ has: page.getByRole('heading', { name: 'Runtime and services' }) });
  await runtime.getByRole('button', { name: 'Start selected' }).click();
  await expect(page.getByRole('status')).toContainText('Start http accepted');

  const endpoint = page.locator('article').filter({ has: page.getByRole('heading', { name: 'Endpoint and network' }) });
  await endpoint.getByRole('button', { name: 'Inspect gateway' }).click();
  await expect(endpoint.getByText(/dual-nic-nat · ready/u)).toBeVisible();
  await endpoint.getByRole('button', { name: 'Load live interfaces' }).click();
  await expect(endpoint.getByLabel('Deployment interface')).toContainText('Ethernet');
  await endpoint.getByRole('button', { name: 'Sync selected endpoint' }).click();
  await expect(page.getByRole('status')).toContainText('Endpoint update accepted');
  await endpoint.getByRole('button', { name: 'Prepare NAT' }).click();
  await expect(page.getByRole('status')).toContainText('Prepare NAT gateway accepted');

  const profiles = page.locator('article').filter({ has: page.getByRole('heading', { name: 'Deployment profiles' }) });
  await profiles.getByRole('button', { name: 'Load catalog' }).click();
  await expect(profiles.getByLabel('Name')).toHaveValue('Windows 11');
  await profiles.getByLabel('Description').fill('Updated from Playwright');
  await profiles.getByRole('button', { name: 'Update' }).click();
  await expect(page.getByRole('status')).toContainText('Update profile accepted');

  const osImages = page.locator('article').filter({ has: page.getByRole('heading', { name: 'OS image catalog' }) });
  await osImages.getByRole('button', { name: 'Load cache' }).click();
  await expect(osImages.getByLabel('Cached image')).toContainText('Windows 11 Pro');
  await osImages.getByRole('button', { name: 'Query catalog' }).click();
  await expect(osImages.locator('pre')).toContainText('windows-11');

  const payloads = page.locator('article').filter({ has: page.getByRole('heading', { name: 'Software and custom scripts' }) });
  await payloads.getByLabel('Installer', { exact: true }).setInputFiles({ name: 'demo.exe', mimeType: 'application/octet-stream', buffer: Buffer.from('MZ') });
  await payloads.getByLabel('Software ID', { exact: true }).fill('demo-app');
  await payloads.getByLabel('Display name').first().fill('Demo application');
  await payloads.getByRole('button', { name: 'Create software' }).click();
  await expect(page.getByRole('status')).toContainText('Create software package accepted');

  await payloads.getByLabel('PowerShell script').setInputFiles({ name: 'demo.ps1', mimeType: 'text/plain', buffer: Buffer.from("Write-Output 'ok'") });
  await payloads.getByLabel('Script ID', { exact: true }).fill('demo-script');
  await payloads.getByLabel('Display name').last().fill('Demo script');
  await payloads.getByRole('button', { name: 'Create script' }).click();
  await expect(page.getByRole('status')).toContainText('Create custom script accepted');
  await payloads.getByLabel('Inspect software ID').fill('demo-app');
  await payloads.getByRole('button', { name: 'Read install script' }).click();
  await expect(payloads.locator('pre')).toContainText("Write-Output 'software'");
  await payloads.getByLabel('Inspect script ID').fill('demo-script');
  await payloads.getByRole('button', { name: 'Read custom script' }).click();
  await expect(payloads.locator('pre')).toContainText("Write-Output 'script'");
});

test('offline bilingual manual is public and enforced by hash-based CSP', async ({ page }) => {
  const response = await page.goto('/manual/');
  expect(response?.status()).toBe(200);
  const csp = response?.headers()['content-security-policy'] ?? '';
  expect(csp).toContain("script-src 'self' 'sha256-");
  expect(csp).not.toContain("'unsafe-inline'");
  await expect(page.getByRole('heading', { name: /把全新 Windows 11 VM/u })).toBeVisible();
  await page.goto('/manual/en/docs/install/');
  await expect(page.getByRole('heading', { name: 'Fresh Install' })).toBeVisible();
});
