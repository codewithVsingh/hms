import { test, expect } from '@playwright/test';
const portal = 'http://localhost:3001';
const pwaPages = ['/login', '/doctor', '/staff/appointments', '/admin'];
const plainPages = [
  '/book',
  '/my-bookings',
  '/manage-booking',
  '/patient',
  '/forgot-password',
  '/reset-password',
  '/no-such-page',
];
for (const path of pwaPages)
  test(`portal ${path} is part of the PWA`, async ({ page }) => {
    await page.goto(portal + path);
    await expect(page.locator('.pwa-strip')).toBeVisible();
    await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', '/manifest.webmanifest');
  });
for (const path of plainPages)
  test(`portal ${path} is a plain web page without PWA`, async ({ page }) => {
    await page.goto(portal + path);
    await expect(page.locator('.pwa-strip')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Install app' })).toHaveCount(0);
    await expect(page.locator('link[rel="manifest"]')).toHaveCount(0);
    await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveCount(0);
  });
test('public website has no PWA', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.pwa-strip')).toHaveCount(0);
  await expect(page.locator('link[rel="manifest"]')).toHaveCount(0);
});
test('manifest is served with start_url /login', async ({ request }) => {
  const res = await request.get(portal + '/manifest.webmanifest');
  expect(res.ok()).toBeTruthy();
  expect(res.headers()['content-type']).toContain('application/manifest+json');
  expect((await res.json()).start_url).toBe('/login');
});
