import { expect, test } from '@playwright/test';
import { readStore, solve, startRound } from './helpers';

interface StoredTrial {
  id: string;
  mode: string;
  indexInSession: number;
  prevTrialId: string | null;
  keystrokes: { k: string; t: number }[];
}
interface StoredSession {
  mode: string;
  score: number;
  endedAt: number | null;
  paramsSnapshotId: string;
}

test('a 30 second normal round advances, records backspaces, ends and saves every trial', async ({ page }) => {
  test.setTimeout(90_000);
  await startRound(page, 30);
  const problem = page.getByTestId('problem');
  await expect(page.getByTestId('answer')).toBeFocused();
  await expect(page.getByTestId('timer')).toHaveText('Seconds left: 30');

  const firstAnswer = String(solve((await problem.textContent()) ?? ''));
  const wrong = firstAnswer === '1' ? '2' : '1';
  await page.keyboard.press(wrong);
  await expect(page.getByTestId('answer')).toHaveValue(wrong);
  await page.keyboard.press('Backspace');
  await page.keyboard.type(firstAnswer);
  for (let i = 1; i < 5; i++) {
    await page.keyboard.type(String(solve((await problem.textContent()) ?? '')));
  }
  await expect(page.getByTestId('score')).toHaveText('Score: 5');

  await expect(page.getByTestId('final-score')).toHaveText('Score: 5', { timeout: 40_000 });

  await expect.poll(async () => (await readStore(page, 'trials')).length).toBe(5);
  const trials = (await readStore(page, 'trials')) as StoredTrial[];
  expect(trials.map((t) => t.mode)).toEqual(['normal', 'normal', 'normal', 'normal', 'normal']);
  expect(trials.map((t) => t.indexInSession)).toEqual([0, 1, 2, 3, 4]);
  expect(trials[0]!.keystrokes.map((k) => k.k)).toEqual([wrong, 'Backspace', ...firstAnswer]);
  expect(trials.slice(1).map((t) => t.prevTrialId)).toEqual(trials.slice(0, 4).map((t) => t.id));
  for (const t of trials) {
    const times = t.keystrokes.map((k) => k.t);
    expect(times[0]).toBeGreaterThanOrEqual(0);
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  }

  const sessions = (await readStore(page, 'sessions')) as StoredSession[];
  expect(sessions).toHaveLength(1);
  expect(sessions[0]).toMatchObject({ mode: 'normal', score: 5 });
  expect(sessions[0]!.endedAt).not.toBeNull();
  const snapshots = (await readStore(page, 'paramSnapshots')) as { id: string }[];
  expect(snapshots.map((s) => s.id)).toEqual([sessions[0]!.paramsSnapshotId]);
});

test('letters cannot be typed into the answer', async ({ page }) => {
  await startRound(page, 30);
  await page.keyboard.type('abc');
  await expect(page.getByTestId('answer')).toHaveValue('');
});

test('try again starts a fresh round from the score screen', async ({ page }) => {
  test.setTimeout(90_000);
  await startRound(page, 30);
  await expect(page.getByTestId('final-score')).toHaveText('Score: 0', { timeout: 40_000 });
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByTestId('timer')).toHaveText('Seconds left: 30');
  await expect(page.getByTestId('score')).toHaveText('Score: 0');
});
