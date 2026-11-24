import { test, expect } from '@playwright/test';
const portal = 'http://localhost:3001';

test('doctor can open amend and withdraw forms with required reason and attestation', async ({ page }) => {
  await page.goto(`${portal}/doctor/care`);
  await expect(page.getByRole('heading', { name: 'Electronic prescription' })).toBeVisible();
  await expect(page.getByText(/You can amend this prescription until/)).toBeVisible();
  await page.getByRole('button', { name: 'Amend', exact: true }).click();
  const amend = page.getByRole('group', { name: 'Amend prescription version 1' });
  await expect(amend.getByText('Amending creates version 2.')).toBeVisible();
  const issue = amend.getByRole('button', { name: 'Attest & issue amendment' });
  await expect(issue).toBeDisabled();
  await amend.getByLabel('Reason for amendment').selectOption('other');
  await amend.getByRole('checkbox').check();
  // "Other" needs an explanation before the amendment can be issued.
  await expect(issue).toBeDisabled();
  await amend.getByLabel('Explanation (required)').fill('Corrected duration');
  await expect(issue).toBeEnabled();
  await issue.click();
  await expect(page.getByText('Demo only: no prescription changed.')).toBeVisible();

  await page.getByRole('button', { name: 'Withdraw', exact: true }).click();
  const withdraw = page.getByRole('group', { name: 'Withdraw prescription version 1' });
  await expect(
    withdraw.getByText('Withdrawal needs confirmation by another doctor or an administrator.'),
  ).toBeVisible();
  await expect(withdraw.getByRole('button', { name: 'Request withdrawal' })).toBeDisabled();
  await withdraw.getByLabel('Reason for withdrawal').selectOption('wrong_patient');
  await withdraw.getByRole('button', { name: 'Request withdrawal' }).click();
  await expect(page.getByText('Demo only: nothing requested.')).toBeVisible();
});

test('withdrawal requests: rejecting needs a reason, confirming removes the request', async ({ page }) => {
  await page.goto(`${portal}/admin/rx-withdrawals`);
  await expect(page.getByRole('heading', { name: 'Prescription withdrawal requests' })).toBeVisible();
  await expect(page.getByText('Issued to the wrong patient', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Reject request' }).click();
  const decision = page.getByRole('group', { name: 'Withdrawal decision' });
  await expect(decision.getByRole('button', { name: 'Reject request' })).toBeDisabled();
  await decision.getByRole('button', { name: 'Back' }).click();
  await page.getByRole('button', { name: 'Confirm withdrawal' }).click();
  await page
    .getByRole('group', { name: 'Withdrawal decision' })
    .getByRole('button', { name: 'Confirm withdrawal' })
    .click();
  await expect(page.getByText('No pending requests.')).toBeVisible();
});

test('reception sees replaced paper copies to recall', async ({ page }) => {
  await page.goto(`${portal}/staff/prescription-register`);
  await page
    .getByRole('button', { name: /search/i })
    .first()
    .click();
  await expect(page.getByRole('heading', { name: 'Paper copies to recall' })).toBeVisible();
  await expect(page.getByText('Amended (version 2)')).toBeVisible();
  await page.getByRole('button', { name: 'Mark paper copy recalled' }).click();
  await expect(page.getByRole('heading', { name: 'Paper copies to recall' })).toHaveCount(0);
});
