import { expect, test } from '@playwright/test';
import { solve, startRound } from './helpers';

// Interpretation 11 in the plan: from event.timeStamp to the end of keydown handling, which
// is input delay plus handler time, measured with the CPU slowed 4x.
test('keydown handling stays under 16ms at p99 on a 4x slowed CPU @perf', async ({ page }) => {
  test.setTimeout(90_000);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await page.addInitScript(() => {
    const samples: number[] = [];
    (window as unknown as { __keyLatency: number[] }).__keyLatency = samples;
    // Bubble phase on window runs after the drill's own listener on the input.
    window.addEventListener('keydown', (e) => samples.push(performance.now() - e.timeStamp));
  });
  await startRound(page, 30);
  const problem = page.getByTestId('problem');
  const stopAt = Date.now() + 25_000;
  let n = 0;
  while (Date.now() < stopAt) {
    const answer = String(solve((await problem.textContent()) ?? ''));
    if (n % 4 === 0) {
      await page.keyboard.press(answer === '1' ? '2' : '1');
      await page.keyboard.press('Backspace');
    }
    await page.keyboard.type(answer);
    n += 1;
  }
  const samples = await page.evaluate(() => (window as unknown as { __keyLatency: number[] }).__keyLatency);
  const sorted = [...samples].sort((a, b) => a - b);
  const p99 = sorted[Math.ceil(sorted.length * 0.99) - 1] ?? Number.POSITIVE_INFINITY;
  const p50 = sorted[Math.floor(sorted.length / 2)] ?? Number.NaN;
  console.log(`keydown samples ${sorted.length}, p50 ${p50.toFixed(2)}ms, p99 ${p99.toFixed(2)}ms`);
  expect(sorted.length).toBeGreaterThan(200);
  expect(p99).toBeLessThan(16);
});
