import { expect, test } from '@playwright/test';
import { solve, startRound } from './helpers';
import { simulatedExport } from './simExport';

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

// In a Test, each completed problem schedules item selection and a model fit. They run off
// the keydown handler, and this checks that keys arriving meanwhile still stay in budget.
test('keydown handling in a Test stays under 16ms at p99 on a 4x slowed CPU @perf', async ({ page }) => {
  test.setTimeout(90_000);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await page.addInitScript(() => {
    const samples: number[] = [];
    (window as unknown as { __keyLatency: number[] }).__keyLatency = samples;
    window.addEventListener('keydown', (e) => samples.push(performance.now() - e.timeStamp));
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Take the test' }).click();
  const problem = page.getByTestId('problem');
  const results = page.getByRole('heading', { name: 'Test finished' });
  for (let n = 0; n < 100 && !(await results.isVisible()); n++) {
    const text = await problem.textContent({ timeout: 2000 }).catch(() => null);
    if (text === null) break;
    const answer = String(solve(text));
    await page.keyboard.press(answer === '1' ? '2' : '1');
    await page.keyboard.press('Backspace');
    await page.keyboard.type(answer);
  }
  const samples = await page.evaluate(() => (window as unknown as { __keyLatency: number[] }).__keyLatency);
  const sorted = [...samples].sort((a, b) => a - b);
  const p99 = sorted[Math.ceil(sorted.length * 0.99) - 1] ?? Number.POSITIVE_INFINITY;
  console.log(`test keydown samples ${sorted.length}, p99 ${p99.toFixed(2)}ms`);
  expect(sorted.length).toBeGreaterThan(200);
  expect(p99).toBeLessThan(16);
});

// The worker reads the log itself, so a year of play (300 rounds of 100 problems) must not
// cost the main thread anything when a round starts while the analysis is running.
test('keydown handling stays under 16ms at p99 with a 30000-trial log being analysed @perf', async ({ page }) => {
  test.setTimeout(180_000);
  const data = Buffer.from(JSON.stringify(simulatedExport({}, 300, 11)));
  await page.goto('/');
  const importStart = Date.now();
  await page.getByLabel('Import data').setInputFiles({ name: 'export.json', mimeType: 'application/json', buffer: data });
  await expect(page.getByText('Imported 30000 trials, 300 sessions.')).toBeVisible({ timeout: 120_000 });
  console.log(`import of 30000 trials took ${((Date.now() - importStart) / 1000).toFixed(1)}s`);

  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await page.evaluate(() => {
    const samples: number[] = [];
    (window as unknown as { __keyLatency: number[] }).__keyLatency = samples;
    window.addEventListener('keydown', (e) => samples.push(performance.now() - e.timeStamp));
  });
  // The import has just asked for an analysis, and the round starts while it runs.
  await page.getByLabel('Duration').selectOption('30');
  await page.getByRole('button', { name: 'Start' }).click();
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
  console.log(`big-log keydown samples ${sorted.length}, p99 ${p99.toFixed(2)}ms`);
  expect(sorted.length).toBeGreaterThan(200);
  expect(p99).toBeLessThan(16);
});
