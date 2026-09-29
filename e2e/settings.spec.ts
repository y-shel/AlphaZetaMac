import { expect, test } from '@playwright/test';

test('settings persist across a reload', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('checkbox', { name: 'Division', exact: true }).uncheck();
  await page.getByLabel('Duration').selectOption('60');
  await page.getByLabel('Multiplication first factor maximum').fill('9');
  await page.reload();
  await expect(page.getByRole('checkbox', { name: 'Division', exact: true })).not.toBeChecked();
  await expect(page.getByLabel('Duration')).toHaveValue('60');
  await expect(page.getByLabel('Multiplication first factor maximum')).toHaveValue('9');
});

test('the settings screen offers every operation with Zetamac defaults', async ({ page }) => {
  await page.goto('/');
  for (const label of ['Addition', 'Subtraction', 'Multiplication', 'Division']) {
    await expect(page.getByRole('checkbox', { name: label, exact: true })).toBeChecked();
  }
  await expect(page.getByLabel('Duration')).toHaveValue('120');
  await expect(page.getByLabel('Multiplication first factor minimum')).toHaveValue('2');
  await expect(page.getByLabel('Multiplication first factor maximum')).toHaveValue('12');
  await expect(page.getByText('Addition problems in reverse.')).toBeVisible();
});

test('an unusable range blocks Start and says why', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Multiplication first factor minimum').fill('50');
  await expect(page.getByRole('alert')).toHaveText('Multiplication: the first factor range ends before it starts.');
  await expect(page.getByRole('button', { name: 'Start' })).toBeDisabled();
});

test('unticking every operation blocks Start', async ({ page }) => {
  await page.goto('/');
  for (const label of ['Addition', 'Subtraction', 'Multiplication', 'Division']) {
    await page.getByRole('checkbox', { name: label, exact: true }).uncheck();
  }
  await expect(page.getByRole('alert')).toHaveText('Pick at least one operation.');
  await expect(page.getByRole('button', { name: 'Start' })).toBeDisabled();
});
