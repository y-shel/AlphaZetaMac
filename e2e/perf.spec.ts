import { expect, test } from '@playwright/test';
import { readStore, solve, startRound } from './helpers';
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

// A round stops the analysis (a round in progress always wins), so while the round is played
// there is a big log stored and no worker. The worker reads the log itself, so after the round
// it runs beside the user: the main thread must keep painting while it does.
test('a round with a 30000-trial log stored keeps keydown under 16ms, and the analysis after it keeps frames flowing @perf', async ({ page }) => {
  test.setTimeout(240_000);
  const data = Buffer.from(JSON.stringify(simulatedExport({}, 300, 11)));
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await page.addInitScript(() => {
    const samples: number[] = [];
    (window as unknown as { __keyLatency: number[] }).__keyLatency = samples;
    window.addEventListener('keydown', (e) => samples.push(performance.now() - e.timeStamp));
  });
  let workersCreated = 0;
  page.on('worker', () => {
    workersCreated += 1;
  });
  await page.goto('/');
  await page.getByLabel('Duration').selectOption('30');
  const start = page.getByRole('button', { name: 'Start' });
  const importStart = Date.now();
  await page.getByLabel('Import data').setInputFiles({ name: 'export.json', mimeType: 'application/json', buffer: data });
  await page.getByText('Imported 30000 trials, 300 sessions.').waitFor({ timeout: 120_000 });
  console.log(`import of 30000 trials took ${((Date.now() - importStart) / 1000).toFixed(1)}s`);
  // The import asks for an analysis, and the round starts at once and stops it.
  await start.click();
  const createdBeforeRound = workersCreated;
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
  // Checked from outside the app, before the round ends.
  expect(page.workers()).toHaveLength(0);
  expect(workersCreated).toBe(createdBeforeRound);
  const sorted = [...samples].sort((a, b) => a - b);
  const p99 = sorted[Math.ceil(sorted.length * 0.99) - 1] ?? Number.POSITIVE_INFINITY;
  console.log(`big-log keydown samples ${sorted.length}, p99 ${p99.toFixed(2)}ms`);
  expect(sorted.length).toBeGreaterThan(200);
  expect(p99).toBeLessThan(16);

  // After the round: the analysis runs in a worker. The frame loop starts before the round
  // ends. Its gaps count from the first frame after the score screen first shows, which paints
  // the screen itself and is not counted, until the snapshot is stored.
  await page.evaluate(() => {
    const w = window as unknown as { __frames: number[]; __shownAt: number; __stop: boolean };
    w.__frames = [];
    w.__shownAt = -1;
    w.__stop = false;
    const tick = (t: number) => {
      if (w.__shownAt < 0 && [...document.querySelectorAll('button')].some((b) => b.textContent === 'Try again')) w.__shownAt = t;
      w.__frames.push(t);
      if (!w.__stop) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await page.getByRole('button', { name: 'Try again' }).waitFor({ timeout: 30_000 });
  const shown = Date.now();
  let sawWorker = workersCreated > createdBeforeRound || page.workers().length > 0;
  const deadline = Date.now() + 60_000;
  let stored = 0;
  while (stored === 0 && Date.now() < deadline) {
    sawWorker = sawWorker || workersCreated > createdBeforeRound || page.workers().length > 0;
    stored = (await readStore(page, 'modelSnapshots')).length;
    if (stored === 0) await page.waitForTimeout(100);
  }
  const toSnapshot = (Date.now() - shown) / 1000;
  const { gap, frames } = await page.evaluate(() => {
    const w = window as unknown as { __frames: number[]; __shownAt: number; __stop: boolean };
    w.__stop = true;
    // Skip the frame that first showed the screen.
    const after = w.__frames.filter((t) => t > w.__shownAt);
    let max = 0;
    for (let i = 1; i < after.length; i++) max = Math.max(max, after[i]! - after[i - 1]!);
    return { gap: max, frames: after.length };
  });
  console.log(`after the round: snapshot stored ${toSnapshot.toFixed(1)}s after the score screen, ${frames} frames, longest frame gap ${gap.toFixed(1)}ms`);
  expect(stored).toBeGreaterThan(0);
  expect(sawWorker).toBe(true);
  // An empty window has no gaps, so it would pass the gap check on its own.
  expect(frames).toBeGreaterThan(10);
  expect(gap).toBeLessThan(100);
});
