import { test, expect } from '@playwright/test';
async function open(page, request, name = 'ready') {
  await request.post(`/preview-case?name=${name}`);
  await page.goto('/');
  await expect(page.locator('#beginner-home')).toBeVisible();
}
async function wizard(page, step = '2') {
  if (!await page.locator('#initialization-dialog').isVisible()) await page.getByRole('button', { name: '重新確認場地與接線', exact: true }).click();
  await page.locator('.onboarding-stages button').filter({ hasText: new RegExp(`^${step}`) }).click();
}
test('empty install derives the unfinished step after refresh', async ({ page, request }) => {
  await open(page, request, 'empty');
  await expect(page.locator('#beginner-primary-action')).toHaveText('完成基本設定');
  await expect(page.locator('.onboarding-stages')).toContainText('主機與帳號');
  await page.reload();
  await expect(page.locator('#beginner-primary-action')).toHaveText('完成基本設定');
});
test('three scenarios and a disconnected no-IPv4 client NIC', async ({ page, request }) => {
  await open(page, request);
  await wizard(page);
  for (const scenario of ['proxy', 'server', 'nat']) {
    const button = page.locator(`[data-scenario="${scenario}"]`);
    await button.click();
    await expect(button).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.onboarding-wiring')).toHaveAttribute('src', `/manual/manual-assets/network-${scenario}.svg`);
  }
  await page.locator('.onboarding-stages button').filter({ hasText: /^3/ }).click();
  await page.getByRole('button', { name: '下一步', exact: true }).click();
  await expect(page.locator('#onboarding-pxe option[value="USB Ethernet"]')).toHaveText(/USB Ethernet/);
  await page.locator('#onboarding-wan').selectOption('Wi-Fi');
  await page.locator('#onboarding-pxe').selectOption('USB Ethernet');
  await page.locator('#onboarding-subnet').fill('10.20.30.0/24');
  await page.locator('[data-onboarding-action="apply-network"]').click();
  await page.getByRole('button', { name: '確認並準備 NAT', exact: true }).click();
  await expect(page.getByText(/overlap|重疊/i).last()).toBeVisible();
});
test('pairing approves and rejects only with Chinese confirmation', async ({ page, request }) => {
  for (const decision of ['approve', 'reject']) {
    await open(page, request, 'pairing');
    await expect(page.locator('[data-onboarding-action="approve"]')).toBeVisible();
    await page.locator(`[data-onboarding-action="${decision}"]`).click();
    await page.locator('#confirm-submit').click();
    await expect(page.locator('[data-onboarding-action="approve"]')).toHaveCount(0);
  }
});
test('failure, site drift, warnings and partial starts remain distinguishable', async ({ page, request }) => {
  await open(page, request, 'failure');
  await expect(page.locator('#beginner-primary-action')).toHaveText('檢視問題');
  await open(page, request, 'drift');
  await expect(page.locator('#beginner-primary-action')).toHaveText(/重新|確認/);
  for (const name of ['warning', 'partial']) {
    await open(page, request, name);
    await expect(page.locator('#beginner-primary-action')).toHaveText('啟動網路開機服務');
  }
});
test('Windows login and finalization cannot stop services', async ({ page, request }) => {
  for (const name of ['awaiting-windows', 'windows-running']) {
    await open(page, request, name);
    await expect(page.locator('#beginner-stop-services')).toBeDisabled();
    await expect(page.locator('#beginner-summary-items')).toContainText('1');
  }
});
for (const width of [390, 1024, 1366, 1920]) {
  test(`wizard and manual work at ${width}px`, async ({ page, request }) => {
    await page.setViewportSize({ width, height: 900 });
    await open(page, request);
    await wizard(page);
    await expect(page.locator('.onboarding-wiring')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.goto('/manual/#first-setup');
    await expect(page.locator('#first-setup')).toBeVisible();
    await expect.poll(() => page.locator('#first-setup img').evaluateAll((images) => images.every((image) => image.complete && image.naturalWidth > 0))).toBe(true);
  });
}
