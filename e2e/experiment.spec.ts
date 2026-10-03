import { expect, test, type Page } from '@playwright/test';
import { readStore, solve } from './helpers';
import { simulatedExport } from './simExport';

const upload = (data: unknown) => ({ name: 'export.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data)) });

/** A simulated user who is 15% slower on problems showing an 8. Seed 1 leaves it suspected, not confirmed. */
async function openDashboardWithSuspectedFinding(page: Page) {
  await page.goto('/');
  await page.getByLabel('Import data').setInputFiles(upload(simulatedExport({ weakness: { atomIds: ['contains_8'], effect: 0.15 } }, 10, 1)));
  await expect(page.getByText('Imported 1000 trials, 10 sessions.')).toBeVisible();
  await page.getByRole('button', { name: 'Dashboard' }).click();
  const finding = page.getByTestId('suspected-finding');
  await expect(finding).toHaveCount(1, { timeout: 20_000 });
  await expect(finding).toContainText('A problem that shows an 8');
  await expect(finding.getByText('A round takes up to about four minutes.')).toBeVisible();
  return finding;
}

test('a test with slow 8s confirms the weakness and the dashboard says so', async ({ page }) => {
  test.setTimeout(120_000);
  const finding = await openDashboardWithSuspectedFinding(page);
  await finding.getByRole('button', { name: 'Test this' }).click();
  await expect(page.getByTestId('timer')).toHaveText('Pair 1 / 60');

  const problem = page.getByTestId('problem');
  const outcome = page.getByTestId('experiment-outcome');
  for (let i = 0; i < 120 && (await outcome.count()) === 0; i++) {
    const text = (await problem.textContent()) ?? '';
    // The pause goes before the first key, which is the time the test measures.
    if (text.includes('8')) await page.waitForTimeout(150);
    await page.keyboard.type(String(solve(text)));
  }
  await expect(outcome).toContainText('Confirmed after');
  await expect(outcome).toContainText('These problems are slower for you than matched ones.');

  await expect.poll(async () => (await readStore(page, 'sessions')).some((s) => (s as { mode: string }).mode === 'experiment' && (s as { endedAt: number | null }).endedAt !== null)).toBe(true);
  expect(await readStore(page, 'experiments')).toHaveLength(1);
  const trials = (await readStore(page, 'trials')) as { mode: string; arm?: string; experimentId?: string }[];
  const played = trials.filter((t) => t.mode === 'experiment');
  expect(played.length).toBeGreaterThanOrEqual(2);
  expect(new Set(played.map((t) => t.arm))).toEqual(new Set(['treatment', 'control']));
  expect(new Set(played.map((t) => t.experimentId)).size).toBe(1);

  await page.getByRole('button', { name: 'Back to the dashboard' }).click();
  const confirmed = page.getByTestId('confirmed-finding');
  await expect(confirmed).toHaveCount(1, { timeout: 20_000 });
  await expect(confirmed).toContainText('A problem that shows an 8');
  await expect(confirmed).toContainText('Confirmed by a test of');
});

test('stopping a test early leaves it open and the dashboard counts its pairs', async ({ page }) => {
  test.setTimeout(120_000);
  const finding = await openDashboardWithSuspectedFinding(page);
  await finding.getByRole('button', { name: 'Test this' }).click();
  const problem = page.getByTestId('problem');
  for (let i = 0; i < 10; i++) await page.keyboard.type(String(solve((await problem.textContent()) ?? '')));
  await expect(page.getByTestId('timer')).toHaveText('Pair 6 / 60');
  await page.getByRole('button', { name: 'Stop the test' }).click();
  await expect(page.getByTestId('experiment-outcome')).toHaveText('Not settled after 5 pairs. Run it again to add to what is there.');

  await page.getByRole('button', { name: 'Back to the dashboard' }).click();
  await expect(page.getByTestId('suspected-finding')).toContainText('5 pairs run so far', { timeout: 20_000 });
});
