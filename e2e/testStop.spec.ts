import { expect, test } from '@playwright/test';
import { readStore, solve } from './helpers';

test('stopping a Test returns to settings and keeps the answered problems', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Take the test' }).click();
  const problem = page.getByTestId('problem');
  for (let i = 0; i < 3; i++) await page.keyboard.type(String(solve((await problem.textContent()) ?? '')));
  await expect(page.getByTestId('timer')).toHaveText('4 / 100');
  await page.getByRole('button', { name: 'Stop the test' }).click();
  await expect(page.getByRole('button', { name: 'Take the test' })).toBeVisible();
  await expect.poll(async () => (await readStore(page, 'trials')).length).toBe(3);
  const sessions = (await readStore(page, 'sessions')) as { mode: string; endedAt: number | null }[];
  expect(sessions).toHaveLength(1);
  expect(sessions[0]!.mode).toBe('test');
  expect(sessions[0]!.endedAt).not.toBeNull();
});
