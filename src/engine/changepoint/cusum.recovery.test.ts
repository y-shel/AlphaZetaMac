import { describe, expect, it } from 'vitest';
import { defaultParams } from '../../domain/operations/registry';
import type { Trial } from '../../domain/types';
import { simulateTrials, typicalUser, type SimUser } from '../__sim__/simUser';
import { levelTrials } from '../features';
import { fitLevelModel } from '../stage1/levelModel';
import { stage2Matrix, termRows } from '../stage2/matrix';
import { detectShifts, type Shift } from './cusum';

const USERS = 150;
const TERM = 'contains_8';
const EFFECT = 0.3;
const TRIALS_PER_SESSION = 100;
const START_MS = 1_727_600_000_000;
const DAY_MS = 86_400_000;
/** The second half of a joined log. Its ids never collide with the default prefix. */
const AFTER_PREFIX = 'after';

const params = defaultParams();

function user(effect: number): SimUser {
  return effect === 0 ? typicalUser() : typicalUser({ weakness: { atomIds: [TERM], effect } });
}

interface Stream {
  /** Cross-fitted residuals of the rows where the term holds, oldest first. */
  x: number[];
  /** The session of each of those rows. */
  sessionIds: string[];
  sigma: number;
}

/** One finding's stream, built the way the analysis builds it. */
function findingStream(trials: readonly Trial[]): Stream {
  const all = [...trials].sort((a, b) => a.completedAt - b.completedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const level = levelTrials(all);
  const fit = fitLevelModel(level.obs);
  const stage2 = stage2Matrix(level, all);
  if (fit.kind !== 'ok' || stage2.kind !== 'ok') throw new Error('the simulated log did not fit');
  const { rows } = stage2.matrix;
  const at = termRows(stage2.matrix, TERM);
  return { x: at.map((r) => rows.residual[r]!), sessionIds: at.map((r) => rows.trials[r]!.sessionId), sigma: fit.model.sigma };
}

interface ChangeTally {
  /** Users with a shift at or after the true change in the wanted direction. */
  detected: number;
  /** Users whose first shift at or after the change points the other way. */
  wrongDirection: number;
  /** Median rows from the true change to the alarm, among the detected. */
  medianDelay: number;
  /** Median rows from the true change to where the shift is placed, among the detected. */
  medianPlacement: number;
}

/** 15 sessions with one weakness, then 15 with another, as one log. */
function changeTally(before: number, after: number, firstSeed: number): ChangeTally {
  const wanted = after > before ? 1 : -1;
  const delays: number[] = [];
  const placements: number[] = [];
  let wrongDirection = 0;
  for (let u = 0; u < USERS; u++) {
    const first = simulateTrials(user(before), { params, sessions: 15, trialsPerSession: TRIALS_PER_SESSION, seed: firstSeed + u }).trials;
    const second = simulateTrials(user(after), {
      params,
      sessions: 15,
      trialsPerSession: TRIALS_PER_SESSION,
      seed: firstSeed + 1000 + u,
      startMs: START_MS + 20 * DAY_MS,
      idPrefix: AFTER_PREFIX,
    }).trials;
    const s = findingStream([...first, ...second]);
    const change = s.sessionIds.findIndex((id) => id.startsWith(`${AFTER_PREFIX}-`));
    expect(change).toBeGreaterThan(0);
    const hit: Shift | undefined = detectShifts(s.x, s.sigma).find((shift) => shift.at >= change);
    if (hit === undefined) continue;
    if (hit.direction !== wanted) {
      wrongDirection++;
      continue;
    }
    delays.push(hit.at - change);
    placements.push(hit.changeAt - change);
  }
  delays.sort((a, b) => a - b);
  placements.sort((a, b) => a - b);
  return {
    detected: delays.length,
    wrongDirection,
    medianDelay: delays[Math.floor(delays.length / 2)] ?? Number.POSITIVE_INFINITY,
    medianPlacement: placements[Math.floor(placements.length / 2)] ?? Number.NaN,
  };
}

describe('shift detection on a finding stream from the real pipeline', () => {
  it('calibration: a steady weakness shows a shift to at most 6% of users', () => {
    let usersWithShift = 0;
    let shifts = 0;
    let rows = 0;
    for (let u = 0; u < USERS; u++) {
      const { trials } = simulateTrials(user(EFFECT), { params, sessions: 30, trialsPerSession: TRIALS_PER_SESSION, seed: 90000 + u });
      const s = findingStream(trials);
      const found = detectShifts(s.x, s.sigma);
      rows += s.x.length;
      shifts += found.length;
      if (found.length > 0) usersWithShift++;
    }
    console.log(`cusum calibration: ${usersWithShift}/${USERS} users with a shift, ${shifts} shifts in ${rows} rows`);
    expect(rows / USERS).toBeGreaterThan(200);
    expect(usersWithShift / USERS).toBeLessThanOrEqual(0.06);
  });

  it('recovery: a weakness that disappears is detected as a fall, soon after', () => {
    const t = changeTally(EFFECT, 0, 91000);
    console.log(`cusum recovery ${EFFECT} -> 0: detected ${t.detected}/${USERS}, wrong direction ${t.wrongDirection}, median delay ${t.medianDelay} rows, placed median ${t.medianPlacement} rows from the change`);
    expect(t.detected / USERS).toBeGreaterThanOrEqual(0.96);
    expect(t.medianDelay).toBeLessThanOrEqual(30);
    expect(t.wrongDirection).toBe(0);
  });

  it('recovery: a weakness that appears is detected as a rise', () => {
    const t = changeTally(0, EFFECT, 94000);
    console.log(`cusum recovery 0 -> ${EFFECT}: detected ${t.detected}/${USERS}, wrong direction ${t.wrongDirection}, median delay ${t.medianDelay} rows, placed median ${t.medianPlacement} rows from the change`);
    expect(t.detected / USERS).toBeGreaterThanOrEqual(0.96);
  });
});
