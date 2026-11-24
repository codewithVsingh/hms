import { test, expect } from '@playwright/test';
const portal = 'http://localhost:3001';

test('affected bookings: confirm step shows refund details, then removes the booking', async ({ page }) => {
  await page.goto(`${portal}/admin/affected-bookings`);
  await expect(
    page.getByRole('heading', { name: 'Bookings affected by doctor unavailability' }),
  ).toBeVisible();
  await expect(page.getByText('BK-7K2M9QX')).toBeVisible();
  await expect(page.getByRole('link', { name: '+910000000000' }).first()).toHaveAttribute(
    'href',
    'tel:+910000000000',
  );
  await page.getByRole('button', { name: 'Cancel with full refund' }).first().click();
  const confirm = page.getByRole('group', { name: 'Confirm cancellation of BK-7K2M9QX' });
  await expect(confirm.getByText(/Full refund of ₹500(\.00)? to the original online payment/)).toBeVisible();
  await expect(confirm.getByText('No cancellation fee applies')).toBeVisible();
  // Back keeps the booking.
  await confirm.getByRole('button', { name: 'Back' }).click();
  await expect(page.getByText('BK-7K2M9QX')).toBeVisible();
  await page.getByRole('button', { name: 'Cancel with full refund' }).first().click();
  await page.getByRole('button', { name: 'Confirm cancellation' }).click();
  await expect(page.getByText('BK-7K2M9QX')).toHaveCount(0);
  // Unpaid booking explains there is nothing to refund.
  await page.getByRole('button', { name: 'Cancel with full refund' }).first().click();
  await expect(page.getByText('Not paid yet: nothing to refund.')).toBeVisible();
});

test('desk refunds: billing records a refund given at the desk', async ({ page }) => {
  await page.goto(`${portal}/staff/desk-refunds`);
  await expect(page.getByRole('heading', { name: 'Refunds due at the desk' })).toBeVisible();
  await expect(page.getByText('Sample Patient E (PT-000105)', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Record refund given' }).click();
  await expect(page.getByText('No desk refunds pending.')).toBeVisible();
});

test('leave form records a reason and explains the new behaviour', async ({ page }) => {
  await page.goto(`${portal}/admin/leave`);
  await expect(page.getByText('Saving blocks new bookings in this period straight away.')).toBeVisible();
  await expect(page.getByLabel('Reason (internal)')).toBeVisible();
});
