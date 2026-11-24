import { test, expect } from '@playwright/test';
const portal = 'http://localhost:3001';

test('health endpoint exposes status only without the operator secret', async ({ request }) => {
  const r = await request.get(`${portal}/api/health`);
  expect(r.status()).toBe(200);
  expect(r.headers()['cache-control']).toContain('no-store');
  expect(await r.json()).toEqual({ status: 'ok' });
  const wrong = await request.get(`${portal}/api/health`, { headers: { authorization: 'Bearer nope' } });
  expect(Object.keys(await wrong.json())).toEqual(['status']);
});

for (const [name, url] of [
  ['website', '/'],
  ['portal', `${portal}/login`],
] as const) {
  test(`${name} sends anti-clickjacking, nosniff and CSP headers`, async ({ request }) => {
    const h = (await request.get(url)).headers();
    expect(h['x-frame-options']).toBe('DENY');
    expect(h['x-content-type-options']).toBe('nosniff');
    expect(h['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(h['x-powered-by']).toBeUndefined();
  });
}

test('portal is noindex and API responses are not cacheable', async ({ request }) => {
  const page = await request.get(`${portal}/login`);
  expect(page.headers()['x-robots-tag']).toContain('noindex');
  const api = await request.get(`${portal}/api/v1/catalog`);
  expect(api.headers()['cache-control']).toContain('no-store');
});

test('unknown website page shows the custom 404', async ({ page }) => {
  const r = await page.goto('/this-page-does-not-exist-xyz');
  expect(r?.status()).toBe(404);
  await expect(page.getByText('Page not found')).toBeVisible();
});
