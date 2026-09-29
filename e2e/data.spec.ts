import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

const trial = {
  id: '01923cfb-fc00-7000-8000-000000000001',
  schemaVersion: 1,
  sessionId: 'session-1',
  mode: 'normal',
  opId: 'add',
  operands: [2, 3],
  answer: 5,
  displayedAt: 1727600000000,
  keystrokes: [{ k: '5', t: 812 }],
  completedAt: 1727600000812,
  indexInSession: 0,
  prevTrialId: null,
  paramsSnapshotId: 'ps-00000000000000',
};
const exportFile = {
  format: 'alphazetamac-export',
  formatVersion: 1,
  exportedAt: 0,
  settings: null,
  trials: [trial],
  sessions: [
    {
      id: 'session-1',
      mode: 'normal',
      paramsSnapshotId: 'ps-00000000000000',
      durationS: 120,
      startedAt: 1727600000000,
      endedAt: 1727600120000,
      score: 1,
    },
  ],
  paramSnapshots: [
    { id: 'ps-00000000000000', params: { enabled: { add: true }, ranges: { addA: [2, 100], addB: [2, 100] } } },
  ],
};
const asUpload = (data: unknown) => ({
  name: 'export.json',
  mimeType: 'application/json',
  buffer: Buffer.from(typeof data === 'string' ? data : JSON.stringify(data)),
});

test('import merges by id, and export gives back what was imported', async ({ page }) => {
  await page.goto('/');
  const input = page.getByLabel('Import data');
  await input.setInputFiles(asUpload(exportFile));
  await expect(page.getByText('Imported 1 trial, 1 session.')).toBeVisible();
  await input.setInputFiles(asUpload(exportFile));
  await expect(page.getByText('Imported 0 trials, 0 sessions.')).toBeVisible();

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export data' }).click();
  const path = await (await download).path();
  const exported = JSON.parse(await readFile(path, 'utf8')) as { trials: unknown[]; format: string };
  expect(exported.format).toBe('alphazetamac-export');
  expect(exported.trials).toEqual([trial]);
});

test('a file that is not an export is rejected with the reason', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Import data').setInputFiles(asUpload({ hello: 'world' }));
  await expect(page.getByText('The file is not an AlphaZetaMac export.')).toBeVisible();
});

test('without IndexedDB the drill still runs and a banner says nothing is saved', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'indexedDB', {
      get() {
        throw new Error('blocked for this test');
      },
    });
  });
  await page.goto('/');
  await expect(page.getByText('nothing is being saved')).toBeVisible();
  await page.getByRole('button', { name: 'Start' }).click();
  await expect(page.getByTestId('problem')).not.toBeEmpty();
});
