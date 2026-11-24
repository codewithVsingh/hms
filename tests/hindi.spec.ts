import { test, expect } from '@playwright/test';
// Hindi mode (?lang=hi) on new and older screens. Names, identifiers, medicines and clinical text stay as recorded.
const portal = 'http://localhost:3001';
const site = 'http://localhost:3000';

test('newer screens render in Hindi and keep working', async ({ page }) => {
  await page.goto(`${portal}/admin/duplicates?lang=hi`);
  await expect(page.locator('html')).toHaveAttribute('lang', 'hi-IN');
  await expect(page.getByRole('heading', { name: 'दोहरे रोगी', level: 2 })).toBeVisible();
  await expect(page.getByText('प्रबल संभावना').or(page.getByText('संभवतः वही व्यक्ति')).first()).toBeVisible();
  await page.getByRole('button', { name: 'विलय का प्रस्ताव दें' }).click();
  await page.getByRole('button', { name: 'स्वीकृति के लिए भेजें' }).click();
  await page.getByRole('button', { name: 'समीक्षा करें और स्वीकृत करें' }).click();
  // Option values stay in English so the API receives the same codes in either language.
  await page.getByLabel('जाँचा गया पहचान दस्तावेज़').selectOption('aadhaar');
  await page.getByRole('button', { name: 'विलय स्वीकृत करें' }).click();
  await expect(page.getByText('केवल डेमो: कुछ नहीं बदला।')).toBeVisible();

  await page.goto(`${portal}/doctor/rx-withdrawals?lang=hi`);
  await expect(page.getByText('प्रिस्क्रिप्शन वापसी अनुरोध').first()).toBeVisible();
  await page.goto(`${portal}/admin/affected-bookings?lang=hi`);
  await expect(page.getByText('डॉक्टर की अनुपलब्धता से प्रभावित बुकिंग').first()).toBeVisible();
  await page.goto(`${portal}/doctor/leave?lang=hi`);
  await expect(page.getByText('डॉक्टर अवकाश कैलेंडर').first()).toBeVisible();
});

test('older workspace, booking and website screens render in Hindi', async ({ page }) => {
  await page.goto(`${portal}/staff?lang=hi`);
  await expect(page.getByText('स्वागत है, रिसेप्शन टीम।')).toBeVisible();
  await expect(page.getByRole('link', { name: 'ओपीडी टोकन' }).first()).toBeAttached();
  await expect(
    page.getByRole('button', { name: 'नेविगेशन खोलें' }).or(page.getByLabel('नेविगेशन खोलें')).first(),
  ).toBeAttached();

  await page.goto(`${portal}/book?lang=hi`);
  await expect(page.getByRole('list', { name: 'बुकिंग की प्रगति' })).toBeVisible();
  // Weekday on the date chips comes from Intl in hi-IN (Devanagari), not a fixed English label.
  await expect(page.locator('.date-btn span').first()).toHaveText(/[ऀ-ॿ]/);

  await page.goto(`${site}/this-page-does-not-exist?lang=hi`);
  await expect(page.getByText('पेज नहीं मिला')).toBeVisible();
  await page.goto(`${site}/policies/refund?lang=hi`);
  await expect(page.getByText('कोई वास्तविक भुगतान नहीं')).toBeVisible();
});

test('portal root keeps the language choice on redirect', async ({ page }) => {
  await page.goto(`${portal}/?lang=hi`);
  await expect(page).toHaveURL(/\/login\?lang=hi/);
  await expect(page.locator('html')).toHaveAttribute('lang', 'hi-IN');
});
