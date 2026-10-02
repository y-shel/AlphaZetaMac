import { describe, expect, it } from 'vitest';
import { defaultParams } from '../../domain/operations/registry';
import type { Trial } from '../../domain/types';
import { simulateTrials, typicalUser, type SimUser } from '../__sim__/simUser';
import { levelTrials } from '../features';
import { fitLevelModel } from '../stage1/levelModel';
import { stage2Matrix } from '../stage2/matrix';
import { detectShifts, sessionContrasts, type SessionContrast, type Shift } from './cusum';

const USERS = 150;
const FIRST_SEED = 700;
const SESSIONS = 30;
const TRIALS_PER_SESSION = 100;
const CHANGE_SESSION = 15;
const TERM = 'contains_8';
const START_MS = 1_727_600_000_000;
const DAY_MS = 86_400_000;

const params = defaultParams();

/** A typical user with a weakness of the given size on the term, and other changes. */
function weak(effect: number, over: Partial<SimUser> = {}): SimUser {
  return typicalUser({ ...(effect === 0 ? {} : { weakness: { atomIds: [TERM], effect } }), ...over });
}

/** The user with every operation's alpha moved by delta. */
function shiftAlpha(user: SimUser, delta: number): SimUser {
  return { ...user, alpha: Object.fromEntries(Object.entries(user.alpha).map(([op, a]) => [op, a + delta])) };
}

interface Stream {
  contrasts: SessionContrast[];
  /** The session number, 0 to SESSIONS - 1, of each contrast. */
  session: number[];
}

/**
 * One finding's contrasts for one simulated user. The log is SESSIONS one-session logs
 * joined, a day apart, so the user can differ by session. It goes through the pipeline the
 * way the analysis runs it.
 */
function stream(userAt: (session: number) => SimUser, seed: number): Stream {
  const trials: Trial[] = [];
  const sessionOf = new Map<string, number>();
  for (let s = 0; s < SESSIONS; s++) {
    const one = simulateTrials(userAt(s), {
      params,
      sessions: 1,
      trialsPerSession: TRIALS_PER_SESSION,
      seed: seed * 100 + s,
      idPrefix: `u${String(s).padStart(2, '0')}`,
      startMs: START_MS + s * DAY_MS,
    }).trials;
    sessionOf.set(one[0]!.sessionId, s);
    trials.push(...one);
  }
  const all = [...trials].sort((a, b) => a.completedAt - b.completedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const level = levelTrials(all);
  const fit = fitLevelModel(level.obs);
  const stage2 = stage2Matrix(level, all);
  if (fit.kind !== 'ok' || stage2.kind !== 'ok') throw new Error('the simulated log did not fit');
  const contrasts = sessionContrasts(stage2.matrix, TERM, fit.model.sigma);
  return { contrasts, session: contrasts.map((c) => sessionOf.get(c.sessionId)!) };
}

/** How many of the users are shown any shift. */
function usersWithShift(name: string, userAt: (session: number) => SimUser): number {
  let users = 0;
  let shifts = 0;
  let contrasts = 0;
  for (let u = 0; u < USERS; u++) {
    const s = stream(userAt, FIRST_SEED + u);
    const found = detectShifts(s.contrasts);
    contrasts += s.contrasts.length;
    shifts += found.length;
    if (found.length > 0) users++;
  }
  console.log(`cusum ${name}: ${users}/${USERS} users with a shift, ${shifts} shifts in ${contrasts} session contrasts`);
  // Nearly every session must count, or the case tests nothing.
  expect(contrasts / USERS).toBeGreaterThan(SESSIONS - 1);
  return users;
}

interface ChangeTally {
  /** Users whose first shift at or after the change has the wanted direction. */
  detected: number;
  /** Users whose first shift at or after the change points the other way. */
  wrongDirection: number;
  /** Users shown a shift before the change. */
  early: number;
  /** Sessions from the change to the alarm, among the detected, sorted. */
  delays: number[];
  /** Of the detected, how many place the change in the true session. */
  placedExact: number;
  /** Of the detected, how many place it within one session of the true one. */
  placedWithinOne: number;
}

/** The user changes at CHANGE_SESSION. Tallies each user's first shift at or after it. */
function changeTally(name: string, userAt: (session: number) => SimUser, wanted: 1 | -1): ChangeTally {
  const t: ChangeTally = { detected: 0, wrongDirection: 0, early: 0, delays: [], placedExact: 0, placedWithinOne: 0 };
  for (let u = 0; u < USERS; u++) {
    const s = stream(userAt, FIRST_SEED + u);
    const change = s.session.findIndex((n) => n >= CHANGE_SESSION);
    expect(change).toBeGreaterThan(0);
    const shifts = detectShifts(s.contrasts);
    if (shifts.some((shift) => shift.at < change)) t.early++;
    const hit: Shift | undefined = shifts.find((shift) => shift.at >= change);
    if (hit === undefined) continue;
    if (hit.direction !== wanted) {
      t.wrongDirection++;
      continue;
    }
    t.detected++;
    t.delays.push(hit.at - change);
    const off = Math.abs(s.session[hit.changeAt]! - CHANGE_SESSION);
    if (off === 0) t.placedExact++;
    if (off <= 1) t.placedWithinOne++;
  }
  t.delays.sort((a, b) => a - b);
  console.log(
    `cusum ${name}: detected ${t.detected}/${USERS}, wrong direction ${t.wrongDirection}, a shift before the change ${t.early}, ` +
      `delay in sessions median ${median(t.delays)} p90 ${t.delays[Math.floor(t.delays.length * 0.9)]}, ` +
      `within one session ${withinOne(t)}/${t.detected}, placed in the true session ${t.placedExact}, within one ${t.placedWithinOne}`,
  );
  return t;
}

function median(sorted: readonly number[]): number {
  return sorted[Math.floor(sorted.length / 2)] ?? Number.POSITIVE_INFINITY;
}

/** Alarms that fire in the session of the change or the next one. */
function withinOne(t: ChangeTally): number {
  return t.delays.filter((d) => d <= 1).length;
}

describe('shift detection calibration: a steady +0.30 weakness, 30 sessions of 100', () => {
  const MAX_SHARE = 0.05;

  it('a typical user', () => {
    expect(usersWithShift('steady, typical', () => weak(0.3)) / USERS).toBeLessThanOrEqual(MAX_SHARE);
  });

  it('session shifts of sd 0.2', () => {
    expect(usersWithShift('steady, sessionSd 0.2', () => weak(0.3, { sessionSd: 0.2 })) / USERS).toBeLessThanOrEqual(MAX_SHARE);
  });

  it('session shifts of sd 0.3', () => {
    expect(usersWithShift('steady, sessionSd 0.3', () => weak(0.3, { sessionSd: 0.3 })) / USERS).toBeLessThanOrEqual(MAX_SHARE);
  });

  it('a lapse rate of 0.08', () => {
    expect(usersWithShift('steady, lapse rate 0.08', () => weak(0.3, { lapseRate: 0.08 })) / USERS).toBeLessThanOrEqual(MAX_SHARE);
  });

  it('a user who gets faster at everything: every alpha falls by 0.6 in a straight line', () => {
    const users = usersWithShift('steady, all alphas fall by 0.6', (s) => shiftAlpha(weak(0.3), (-0.6 * s) / (SESSIONS - 1)));
    expect(users / USERS).toBeLessThanOrEqual(MAX_SHARE);
  });
});

describe('shift detection recovery: the weakness changes at session 15', () => {
  it('+0.30 that disappears is a fall, noticed in that session or the next', () => {
    const t = changeTally('0.30 then none', (s) => weak(s < CHANGE_SESSION ? 0.3 : 0), -1);
    expect(t.detected / USERS).toBeGreaterThanOrEqual(0.96);
    expect(withinOne(t) / t.detected).toBeGreaterThanOrEqual(0.9);
  });

  it('+0.30 that appears is a rise, noticed in that session or the next', () => {
    const t = changeTally('none then 0.30', (s) => weak(s < CHANGE_SESSION ? 0 : 0.3), 1);
    expect(t.detected / USERS).toBeGreaterThanOrEqual(0.96);
    expect(withinOne(t) / t.detected).toBeGreaterThanOrEqual(0.9);
  });

  it('+0.15 that disappears is detected within a few sessions', () => {
    const t = changeTally('0.15 then none', (s) => weak(s < CHANGE_SESSION ? 0.15 : 0), -1);
    expect(t.detected / USERS).toBeGreaterThanOrEqual(0.9);
    expect(median(t.delays)).toBeLessThanOrEqual(3);
  });
});

describe('shift detection, pinned behaviour', () => {
  // Not a goal. The detector cannot tell a step from a ramp: a weakness that fades slowly
  // ends up far from where it started, and that is reported as a shift. The app's wording
  // allows for it. It says the times are different from before a date, not that they
  // changed overnight.
  it('a weakness that fades in a straight line from +0.30 to 0 is reported as a shift', () => {
    const users = usersWithShift('fade 0.30 to 0', (s) => weak(0.3 * (1 - s / (SESSIONS - 1))));
    expect(users / USERS).toBeGreaterThanOrEqual(0.9);
  });
});
