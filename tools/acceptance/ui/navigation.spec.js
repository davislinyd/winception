import { test, expect } from '@playwright/test';
import { uiRoutes } from '../../osdcloud-console/web/js/routes.js';

test.beforeEach(async ({ request }) => {
  await request.post('/preview-case?name=ready');
});

for (const route of uiRoutes) {
  test(`direct entry and reload: ${route.path}`, async ({ page }) => {
    const mutations = [];
    page.on('request', (request) => {
      if (request.url().includes('/api/') && request.method() !== 'GET') mutations.push(request.url());
    });
    for (const reload of [false, true]) {
      if (reload) await page.reload();
      else await page.goto(route.path);
      await expect(page).toHaveURL(new RegExp(`${route.path === '/' ? '/' : route.path}\\?mode=${route.console ? 'console' : 'guided'}$`));
      await expect(page.locator('body')).toHaveAttribute('data-operator-mode', route.console ? 'console' : 'guided');
      await expect(page.locator(route.view === 'fleet' ? '#view-fleet' : '#view-dashboard')).toHaveClass(/active/);
      if (route.panel) {
        const id = { initializationDialog: 'initialization-dialog', deploymentProfilesDialog: 'deployment-profiles-dialog', osImagesDialog: 'os-images-dialog', endpointSettingsDialog: 'endpoint-settings-dialog' }[route.panel];
        await expect(page.locator(`#${id}`)).toBeVisible();
      }
      if (route.target) await expect(page.locator(`#${route.target}`)).toBeVisible();
      await expect.poll(() => page.locator('.brand-mark').evaluate((image) => image.complete && image.naturalWidth > 0)).toBe(true);
      await expect(page.locator('#tab-dashboard')).toHaveCSS('text-decoration-line', 'none');
    }
    expect(mutations).toEqual([]);
  });
}

test('history restores views and panel sections without intermediate home entries', async ({ page }) => {
  await page.goto('/');
  await page.locator('#tab-fleet').click();
  await expect(page).toHaveURL(/\/fleet\?mode=guided$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/\?mode=guided$/);
  await page.goForward();
  await expect(page).toHaveURL(/\/fleet\?mode=guided$/);
  await page.locator('#tab-dashboard').click();
  await page.locator('.beginner-config-item[data-action="profiles"]').click();
  await expect(page).toHaveURL(/\/profiles\?mode=guided$/);
  await page.locator('[data-route="/profiles/software"]').click();
  await expect(page).toHaveURL(/\/profiles\/software\?mode=guided$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/profiles\?mode=guided$/);
  await page.goForward();
  await expect(page).toHaveURL(/\/profiles\/software\?mode=guided$/);
  await page.keyboard.press('Escape');
  await expect(page).toHaveURL(/\/\?mode=guided$/);
  await expect(page.locator('#deployment-profiles-dialog')).toBeHidden();
  await page.goForward();
  await expect(page.locator('#deployment-profiles-dialog')).toBeVisible();
});

test('canonical modes, legacy preferences, storage denial and polling', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('winception-view', 'fleet');
    localStorage.setItem('winception-operator-mode', 'console');
  });
  await page.goto('/');
  await expect(page).toHaveURL(/\/\?mode=guided$/);
  await page.goto('/services/?mode=guided');
  await expect(page).toHaveURL(/\/services\?mode=console$/);
  await page.locator('#operator-mode-guided').click();
  await expect(page).toHaveURL(/\/\?mode=guided$/);
  await page.goto('/fleet?mode=invalid');
  await expect(page).toHaveURL(/\/fleet\?mode=guided$/);
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', { get() { throw new Error('storage disabled'); } });
  });
  await page.goto('/profiles/software?mode=console');
  await expect(page.locator('#deployment-profiles-dialog')).toBeVisible();
  await page.waitForResponse((response) => response.url().includes('/api/state') && response.ok());
  await expect(page).toHaveURL(/\/profiles\/software\?mode=console$/);
  await page.keyboard.press('Escape');
  await expect(page).toHaveURL(/\/\?mode=console$/);
  await page.waitForResponse((response) => response.url().includes('/api/state') && response.ok());
  await expect(page.locator('#deployment-profiles-dialog')).toBeHidden();
});

test('route links support new tabs and narrow displays', async ({ page, context }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto('/');
  const href = await page.locator('#tab-fleet').getAttribute('href');
  expect(href).toBe('/fleet?mode=guided');
  const popup = context.waitForEvent('page');
  await page.locator('#tab-fleet').click({ modifiers: ['Control'] });
  const other = await popup;
  await expect(other).toHaveURL(/\/fleet\?mode=guided$/);
  await expect(page).toHaveURL(/\/\?mode=guided$/);
  await other.close();
  await page.goto('/profiles/software');
  await expect(page.locator('#software-catalog-section')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test('cross-panel switching, repeated toggles and mode history retain the origin', async ({ page }) => {
  await page.goto('/');
  const profiles = page.locator('.beginner-config-item[data-action="profiles"]');
  await profiles.click();
  await page.locator('#operator-mode-console').click();
  await expect(page).toHaveURL(/\/profiles\?mode=console$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/profiles\?mode=guided$/);
  await expect(page.locator('#deployment-profiles-dialog')).toBeVisible();
  await page.locator('.beginner-config-item[data-action="os-images"]').click();
  await expect(page).toHaveURL(/\/os-images\?mode=guided$/);
  await page.locator('.beginner-config-item[data-action="interfaces"]').click();
  await expect(page).toHaveURL(/\/endpoint\?mode=guided$/);
  await page.keyboard.press('Escape');
  await expect(page).toHaveURL(/\/\?mode=guided$/);
  await profiles.click();
  await expect(page).toHaveURL(/\/profiles\?mode=guided$/);
  await profiles.click();
  await expect(page).toHaveURL(/\/\?mode=guided$/);
  await page.goForward();
  await expect(page).toHaveURL(/\/profiles\?mode=guided$/);
  await expect(page.locator('#deployment-profiles-dialog')).toBeVisible();
});

test('authentication retains the requested route until data is available', async ({ page }) => {
  await page.route('**/api/auth/status', (route) => route.fulfill({ json: { ok: true, required: true, hostMode: 'non-loopback' } }));
  await page.goto('/profiles/scripts?mode=console');
  await expect(page.locator('#auth-gate')).toBeVisible();
  await expect(page.locator('#deployment-profiles-dialog')).toBeHidden();
  await expect(page).toHaveURL(/\/profiles\/scripts\?mode=console$/);
  await page.locator('#web-token-input').fill('preview-token');
  await page.locator('#auth-form').evaluate((form) => form.requestSubmit());
  await expect(page.locator('#auth-gate')).toBeHidden();
  await expect(page.locator('#script-catalog-section')).toBeVisible();
  await expect(page).toHaveURL(/\/profiles\/scripts\?mode=console$/);
});

test('failed initial reads retain the URL and retry opens the requested panel', async ({ page }) => {
  await page.route('**/api/state', (route) => route.fulfill({ status: 503, json: { ok: false, error: 'Preview read failure' } }));
  await page.goto('/os-images?mode=console');
  await expect(page.locator('#operation-error-dialog')).toBeVisible();
  await expect(page).toHaveURL(/\/os-images\?mode=console$/);
  await expect(page.locator('#os-images-dialog')).toBeHidden();
  await page.unroute('**/api/state');
  await page.waitForResponse((response) => response.url().includes('/api/state') && response.ok());
  await expect(page.locator('#os-images-dialog')).toBeVisible();
  await expect(page).toHaveURL(/\/os-images\?mode=console$/);
});

test('polling respects manual scroll and logs stay visible while idle', async ({ page }) => {
  await page.goto('/profiles/software');
  await expect(page.locator('#software-catalog-section')).toBeVisible();
  const host = page.locator('html');
  const position = await host.evaluate(() => { document.scrollingElement.scrollTop = 0; return document.scrollingElement.scrollTop; });
  await page.waitForResponse((response) => response.url().includes('/api/state') && response.ok());
  expect(await host.evaluate(() => document.scrollingElement.scrollTop)).toBe(position);
  await page.goto('/logs');
  await expect(page.locator('#logs')).toBeVisible();
  await page.waitForResponse((response) => response.url().includes('/api/state') && response.ok());
  await expect(page.locator('#logs')).toBeVisible();
});

test('explicit close buttons and child cancellation follow the route history', async ({ page }) => {
  await page.goto('/setup?mode=console');
  await expect(page.locator('#initialization-dialog')).toBeVisible();
  await page.getByRole('button', { name: '關閉部署設定', exact: true }).click();
  await expect(page).toHaveURL(/\/\?mode=console$/);
  await page.goto('/profiles?mode=guided');
  await expect(page.locator('#deployment-profiles-dialog')).toBeVisible();
  await page.locator('#deployment-profiles-dialog button[value="cancel"]').click();
  await expect(page).toHaveURL(/\/\?mode=guided$/);
  await page.locator('.beginner-config-item[data-action="profiles"]').click();
  await page.locator('#deployment-profiles-dialog [data-action="software-add"]').click();
  await expect(page.locator('#software-add-dialog')).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/\/\?mode=guided$/);
  await expect(page.locator('#software-add-dialog')).toBeHidden();
  await page.goForward();
  await expect(page.locator('#deployment-profiles-dialog')).toBeVisible();
  await expect(page.locator('#software-add-dialog')).toBeHidden();
});
