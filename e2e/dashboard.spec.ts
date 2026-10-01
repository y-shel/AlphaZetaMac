import { expect, test } from '@playwright/test';
import { simulatedExport } from './simExport';

const upload = (data: unknown) => ({ name: 'export.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data)) });

test('an imported log with a real weakness shows it on the dashboard, and a rebuild gives the same', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/');
  // A simulated user who is slow on problems showing an 8: 10 rounds of 100 problems.
  await page.getByLabel('Import data').setInputFiles(upload(simulatedExport({ weakness: { atomIds: ['contains_8'], effect: 0.3 } }, 10, 7)));
  await expect(page.getByText('Imported 1000 trials, 10 sessions.')).toBeVisible();
  await page.getByRole('button', { name: 'Dashboard' }).click();

  const finding = page.getByTestId('confirmed-finding');
  await expect(finding).toHaveCount(1, { timeout: 20_000 });
  await expect(finding).toContainText('A problem that shows an 8');
  await expect(finding).toContainText('problems off your score');
  await expect(page.getByRole('img', { name: 'Score per round with its trend' })).toBeVisible();
  await expect(page.getByText(/At default settings you would score about \d+/)).toBeVisible();
  await expect(page.getByText('Shift detection is not built yet.')).toBeVisible();
  const before = await finding.textContent();

  await page.getByRole('button', { name: 'Back to settings' }).click();
  await page.getByRole('button', { name: 'Rebuild analysis' }).click();
  await page.getByRole('button', { name: 'Dashboard' }).click();
  await expect(page.getByRole('button', { name: 'Update now' })).toBeEnabled({ timeout: 20_000 });
  await expect(page.getByTestId('confirmed-finding')).toHaveText(before ?? '');
});

test('a log with no weakness shows no findings', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/');
  await page.getByLabel('Import data').setInputFiles(upload(simulatedExport({}, 10, 8)));
  await expect(page.getByText('Imported 1000 trials, 10 sessions.')).toBeVisible();
  await page.getByRole('button', { name: 'Dashboard' }).click();
  await expect(page.getByText('Nothing stands out.')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('None confirmed yet.')).toBeVisible();
});

test('a failed clear of the stored analysis is shown, and no error escapes', async ({ page }) => {
  const errors: Error[] = [];
  page.on('pageerror', (e) => errors.push(e));
  await page.addInitScript(() => {
    IDBObjectStore.prototype.clear = function () {
      throw new DOMException('clear failed', 'InvalidStateError');
    };
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Rebuild analysis' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'The stored analysis could not be cleared' })).toBeVisible();
  expect(errors).toEqual([]);
});
