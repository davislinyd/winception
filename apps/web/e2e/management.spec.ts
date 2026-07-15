import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const setupCode = 'winception-e2e-management-token-0000000000000000';

async function signIn(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByLabel('Setup code').fill(setupCode);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Deploy', exact: true })).toBeVisible();
}

test('v1-style navigation, configuration drawer and keyboard focus remain usable', async ({ page }) => {
  await signIn(page);
  await expect(page.getByText('Live', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Monitor' }).click();
  await expect(page.getByRole('heading', { name: 'Monitor', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Deploy' }).click();
  await page.locator('.deploy-summary').getByRole('button', { name: /Profile.*Windows 11/u }).click();
  await expect(page.getByRole('dialog', { name: 'Deployment profiles' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.keyboard.press('Tab');
  await expect(page.locator(':focus')).toBeVisible();
  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(accessibility.violations).toEqual([]);
});

test('Guided Setup exposes the next v2 action and keeps ingress controls behind preflight', async ({ page }) => {
  await page.route('**/api/v2/deployment/snapshot', async (route) => {
    const response = await route.fetch();
    const payload = await response.json() as { result: { preflight: unknown[] } };
    payload.result.preflight = [];
    await route.fulfill({ response, json: payload });
  });
  await signIn(page);
  const guided = page.locator('.guided-rail');
  await expect(guided.getByRole('button', { name: 'Run preflight' })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Start all' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Start TFTP' })).toBeDisabled();
  await guided.getByRole('button', { name: 'Run preflight' }).click();
  await expect(page.locator('.notice')).toContainText('Run preflight accepted as e2e-');
});

test('service cards, Fleet rows and tracker actions surface accepted, conflict and safe error states', async ({ page }) => {
  await signIn(page);
  await page.getByRole('button', { name: 'Start TFTP' }).click();
  await expect(page.locator('.notice')).toContainText('Start TFTP accepted as e2e-');
  await page.getByRole('button', { name: 'Extend' }).click();
  await expect(page.locator('.notice')).toContainText('Extend torrent client accepted');
  await expect(page.getByLabel(/Additional seed minutes for run-1/u)).toHaveValue('15');

  await page.getByRole('button', { name: 'Save default' }).click();
  await page.getByRole('button', { name: 'Start TFTP' }).click();
  await expect(page.getByRole('alert')).toContainText('OPERATION_CONFLICT');
  await expect(page.getByRole('alert')).toContainText('torrent.settings.update');

  await page.getByRole('button', { name: 'Monitor' }).click();
  await page.getByRole('button', { name: /client-failed/u }).click();
  await page.getByRole('button', { name: 'Generate diagnostics' }).click();
  await expect(page.getByRole('alert')).toContainText('VALIDATION_FAILED');
  await page.getByRole('button', { name: 'View evidence' }).click();
  await expect(page.getByRole('dialog', { name: 'Evidence for run-failed' })).toBeVisible();
});

test('SSE reconnect triggers REST recovery; narrow and reduced-motion layouts remain available', async ({ page }) => {
  let stateRequests = 0;
  await page.route('**/api/v2/events', async (route) => { await route.abort('connectionfailed'); });
  page.on('request', (request) => { if (request.url().endsWith('/api/v2/state')) stateRequests += 1; });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await signIn(page);
  await expect(page.getByText('Reconnecting', { exact: true })).toBeVisible();
  await expect.poll(() => stateRequests).toBeGreaterThan(1);
  await page.getByRole('button', { name: 'Refresh control plane' }).click();
  await expect(page.getByRole('heading', { name: 'Deploy', exact: true })).toBeVisible();
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
