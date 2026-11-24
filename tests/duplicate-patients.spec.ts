import { test, expect } from '@playwright/test';
const portal = 'http://localhost:3001';

test('duplicate review: propose merge, then admin approves with an ID check', async ({ page }) => {
  await page.goto(`${portal}/admin/duplicates`);
  await expect(page.getByRole('heading', { name: 'Duplicate patients', level: 2 })).toBeVisible();
  await expect(page.getByText('Likely the same person')).toBeVisible();
  await expect(page.getByText('A shared mobile number alone is not treated as a match')).toBeVisible();
  // Dismissing needs a reason.
  await page.getByRole('button', { name: 'Not the same person' }).click();
  const dismiss = page.getByRole('group', { name: 'Dismiss match' });
  await expect(dismiss.getByRole('button', { name: 'Confirm: different people' })).toBeDisabled();
  await dismiss.getByRole('button', { name: 'Back' }).click();
  await page.getByRole('button', { name: 'Propose merge' }).click();
  await expect(page.getByText('The record registered first keeps its UHID.')).toBeVisible();
  await page.getByRole('button', { name: 'Send for approval' }).click();
  await expect(page.getByText('No possible duplicates to review.')).toBeVisible();
  await expect(page.getByText('Keeps UHID')).toBeVisible();
  await page.getByRole('button', { name: 'Review and approve' }).click();
  const decision = page.getByRole('group', { name: 'Merge decision' });
  await expect(decision.getByText('Record the document type only, never its number.')).toBeVisible();
  await expect(decision.getByRole('button', { name: 'Approve merge' })).toBeDisabled();
  await decision.getByLabel('Identity document checked').selectOption('aadhaar');
  await expect(decision.getByLabel('Name to keep')).toBeVisible();
  await decision.getByRole('button', { name: 'Approve merge' }).click();
  await expect(page.getByText('Demo only: nothing changed.')).toBeVisible();
  await expect(page.getByText('Merges can currently be undone at any time.')).toBeVisible();
});

test('reception sees the review screen but cannot approve', async ({ page }) => {
  await page.goto(`${portal}/staff/duplicates`);
  await page.getByRole('button', { name: 'Propose merge' }).click();
  await page.getByRole('button', { name: 'Send for approval' }).click();
  await expect(page.getByText('Waiting for an administrator to approve.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Review and approve' })).toHaveCount(0);
});

test('doctor timeline warns about a possible duplicate without showing it', async ({ page }) => {
  await page.goto(`${portal}/doctor/history`);
  await page
    .getByRole('button', { name: /search/i })
    .first()
    .click();
  await expect(page.getByText('This patient may have another record.')).toBeVisible();
  await expect(page.getByText('PT-000391', { exact: false })).toBeVisible();
});
