import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const setupCode = 'winception-e2e-management-token-0000000000000000';

test('login, keyboard focus, operation mutation and refresh recovery', async ({ page }) => {
  await page.goto('/');
  const input = page.getByLabel('Setup code');
  await input.fill(setupCode);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Deployment control plane' })).toBeVisible();
  await expect(page.getByText('connected', { exact: true })).toBeVisible();

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
