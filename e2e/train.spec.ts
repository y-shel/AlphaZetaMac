import { expect, test } from '@playwright/test';
import { readStore, solve } from './helpers';
import { simulatedExport } from './simExport';

const NEEDS_LEVEL = 'Take the test or play 100 problems first, so training can be set to your level.';

test('without any data Train is off and says what to do first', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Start', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Train', exact: true })).toBeDisabled();
  await expect(page.getByText(NEEDS_LEVEL)).toBeVisible();
  await expect(page.getByLabel('Difficulty')).toHaveValue('80');
  await expect(page.getByLabel('Focus')).toHaveValue('50');
  await expect(page.getByLabel('Focus')).toBeDisabled();
  await expect(page.getByText('Nothing to focus on yet.')).toBeVisible();
});

test('a 30 second Train round writes train and calibration trials in a train session', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/');
  // A simulated user who is 15% slower on problems showing an 8: a level model and one finding.
  const data = simulatedExport({ weakness: { atomIds: ['contains_8'], effect: 0.15 } }, 10, 1);
  await page.getByLabel('Import data').setInputFiles({ name: 'export.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data)) });
  await expect(page.getByText('Imported 1000 trials, 10 sessions.')).toBeVisible();

  const train = page.getByRole('button', { name: 'Train', exact: true });
  await expect(train).toBeEnabled({ timeout: 20_000 });
  await expect(page.getByText(NEEDS_LEVEL)).toHaveCount(0);
  await expect(page.getByLabel('Focus')).toBeEnabled();
  await expect(page.getByText('Nothing to focus on yet.')).toHaveCount(0);

  await page.getByLabel('Difficulty').fill('70');
  await page.getByLabel('Focus').fill('75');
  await page.getByLabel('Duration').selectOption('30');
  await train.click();
  await expect(page.getByTestId('answer')).toBeFocused();
  await expect(page.getByTestId('timer')).toHaveText('Seconds left: 30');

  // Plays until five seconds are left, then lets the round run out.
  const problem = page.getByTestId('problem');
  const started = Date.now();
  let answered = 0;
  while (Date.now() - started < 25_000) {
    await page.keyboard.type(String(solve((await problem.textContent()) ?? '')));
    answered++;
    await page.waitForTimeout(100);
  }
  await expect(page.getByTestId('final-score')).toHaveText(`Score: ${answered}`, { timeout: 20_000 });

  interface Stored {
    id: string;
    mode: string;
    sessionId: string;
    durationS: number | null;
    endedAt: number | null;
    score: number;
  }
  await expect.poll(async () => ((await readStore(page, 'sessions')) as Stored[]).some((s) => s.mode === 'train' && s.endedAt !== null)).toBe(true);
  const sessions = ((await readStore(page, 'sessions')) as Stored[]).filter((s) => s.mode === 'train');
  expect(sessions).toHaveLength(1);
  expect(sessions[0]).toMatchObject({ mode: 'train', durationS: 30, score: answered });
  const played = ((await readStore(page, 'trials')) as Stored[]).filter((t) => t.sessionId === sessions[0]!.id);
  expect(played).toHaveLength(answered);
  expect(new Set(played.map((t) => t.mode))).toEqual(new Set(['train', 'calibration']));

  // The two controls are settings: they are still there after a reload.
  await page.getByRole('button', { name: 'Change settings' }).click();
  await page.reload();
  await expect(page.getByLabel('Difficulty')).toHaveValue('70');
  await expect(page.getByLabel('Focus')).toHaveValue('75');
});
