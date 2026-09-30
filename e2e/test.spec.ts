import { expect, test } from '@playwright/test';
import { readStore, solve } from './helpers';

interface StoredTrial {
  mode: string;
  sessionId: string;
}
interface StoredSession {
  id: string;
  mode: string;
  durationS: number | null;
  endedAt: number | null;
}

test('the Test tab runs to its end, saves test trials and suggests settings', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/');
  await page.getByRole('button', { name: 'Take the test' }).click();
  await expect(page.getByTestId('timer')).toHaveText('1 / 100');
  const problem = page.getByTestId('problem');
  const results = page.getByRole('heading', { name: 'Test finished' });
  let answered = 0;
  while (answered < 100 && !(await results.isVisible())) {
    // The Test can end between the check above and this read. A short timeout lets the loop notice.
    const text = await problem.textContent({ timeout: 2000 }).catch(() => null);
    if (text === null) break;
    await page.keyboard.type(String(solve(text)));
    answered++;
  }
  await expect(results).toBeVisible();
  await expect(page.getByText(/^Your level is (measured|roughly measured from this test)\. /)).toBeVisible();
  await expect(page.getByText(/keep playing/)).toBeVisible();

  const sessions = (await readStore(page, 'sessions')) as StoredSession[];
  expect(sessions).toHaveLength(1);
  expect(sessions[0]).toMatchObject({ mode: 'test', durationS: null });
  expect(sessions[0]!.endedAt).not.toBeNull();
  const trials = (await readStore(page, 'trials')) as StoredTrial[];
  expect(trials.length).toBeGreaterThanOrEqual(60);
  expect(trials.length).toBeLessThanOrEqual(100);
  expect(trials.every((t) => t.mode === 'test' && t.sessionId === sessions[0]!.id)).toBe(true);

  const addText = (await page.getByTestId('suggested-add').textContent()) ?? '';
  const addMax = /to (\d+) \+/.exec(addText)?.[1];
  expect(addMax).toBeDefined();
  await page.getByRole('button', { name: 'Use these settings' }).click();
  await expect(page.getByLabel('Addition first addend maximum')).toHaveValue(addMax!);
});
