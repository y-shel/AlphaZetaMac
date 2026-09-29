import { expect, test } from '@playwright/test';
import { solve, startRound } from './helpers';

test('the app requests nothing but its own files, before and during a round', async ({ page, baseURL }) => {
  const origin = new URL(baseURL ?? 'http://localhost:4173').origin;
  const allowed = new Set(['document', 'script', 'stylesheet', 'image', 'font']);
  const unexpected: string[] = [];
  page.on('request', (req) => {
    if (new URL(req.url()).origin !== origin || !allowed.has(req.resourceType())) {
      unexpected.push(`${req.resourceType()} ${req.url()}`);
    }
  });
  await startRound(page, 30);
  const problem = page.getByTestId('problem');
  for (let i = 0; i < 5; i++) {
    await page.keyboard.type(String(solve((await problem.textContent()) ?? '')));
  }
  expect(unexpected).toEqual([]);
});
