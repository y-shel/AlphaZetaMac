import { describe, expect, it } from 'vitest';
import { defaultParams } from '../domain/operations/registry';
import type { Experiment } from '../domain/types';
import { simulateExperimentTrials } from './__sim__/simExperiment';
import { simulateTrials, typicalUser, type SimUser } from './__sim__/simUser';
import { simSessions } from './__sim__/simSessions';
import { analyse } from './analyse';

function run(user: SimUser, seed: number) {
  const params = defaultParams();
  const { trials } = simulateTrials(user, { params, sessions: 10, trialsPerSession: 100, seed });
  return analyse({ trials, sessions: simSessions(trials, params) });
}

describe('discovery end to end: recovery (spec 24 item 5, without experiments)', () => {
  it('finds an injected weakness, and nothing else', () => {
    let found = 0;
    let wrong = 0;
    for (let seed = 0; seed < 100; seed++) {
      const snap = run(typicalUser({ weakness: { atomIds: ['contains_8'], effect: 0.15 } }), 20000 + seed);
      if (snap.findings.some((f) => f.terms.includes('contains_8'))) found++;
      wrong += snap.findings.filter((f) => !f.terms.includes('contains_8')).length;
    }
    expect(found).toBeGreaterThanOrEqual(85);
    expect(wrong).toBe(0);
  });

  it('confirms a large weakness by replication on interleaved halves', () => {
    let confirmed = 0;
    for (let seed = 0; seed < 50; seed++) {
      const snap = run(typicalUser({ weakness: { atomIds: ['contains_8'], effect: 0.3 } }), 21000 + seed);
      if (snap.findings.some((f) => f.tier === 'confirmed' && f.terms.includes('contains_8'))) confirmed++;
    }
    expect(confirmed).toBeGreaterThanOrEqual(45);
  });
});

describe('discovery end to end: calibration (spec 24 item 6)', () => {
  it('a user with no weakness gets no findings, suspected or confirmed', () => {
    let withFinding = 0;
    let confirmed = 0;
    for (let seed = 0; seed < 200; seed++) {
      const snap = run(typicalUser(), 22000 + seed);
      if (snap.findings.length > 0) withFinding++;
      if (snap.findings.some((f) => f.tier === 'confirmed')) confirmed++;
    }
    // Target: at most 5% of null users see any suspected finding, and none a confirmed one.
    expect(withFinding).toBeLessThanOrEqual(10);
    expect(confirmed).toBe(0);
  });
});

const START = 1_727_600_000_000;
const DAY = 86_400_000;

describe('discovery and experiment end to end: recovery (spec 24 item 5)', () => {
  it('discovers a +0.15 weakness as suspected, confirms it by experiment and states it in score points', () => {
    const params = defaultParams();
    const user = typicalUser({ weakness: { atomIds: ['contains_8'], effect: 0.15 } });
    let suspected = 0;
    let confirmed = 0;
    for (let seed = 0; seed < 60; seed++) {
      const { trials } = simulateTrials(user, { params, sessions: 10, trialsPerSession: 100, seed: 23000 + seed });
      const sessions = simSessions(trials, params);
      const before = analyse({ trials, sessions });
      const f = before.findings.find((x) => x.terms.includes('contains_8'));
      if (f === undefined || f.tier !== 'suspected') continue;
      suspected++;
      const experiment: Experiment = { id: `x-${seed}`, terms: f.terms, createdAt: START + 15 * DAY };
      const played = simulateExperimentTrials(user, before.level!, experiment, { params, rounds: 5, seed: 24000 + seed, startMs: START + 20 * DAY });
      const after = analyse({ trials: [...trials, ...played], sessions, experiments: [experiment] });
      const g = after.findings.find((x) => x.id === f.id);
      if (g !== undefined && g.tier === 'confirmed' && g.experimentId === experiment.id) {
        confirmed++;
        expect(g.scorePoints).toBeGreaterThan(0);
        expect(g.confirmedAt).toBeGreaterThan(experiment.createdAt);
      }
    }
    console.log(`item 5: suspected ${suspected} of 60, confirmed by experiment ${confirmed} (${(confirmed / suspected).toFixed(3)})`);
    // Enough users reach the experiment for the share to mean something.
    expect(suspected).toBeGreaterThanOrEqual(30);
    expect(confirmed / suspected).toBeGreaterThanOrEqual(0.9);
  });
});

describe('discovery and experiment end to end: calibration (spec 24 item 6)', () => {
  it('a user with no weakness and a fabricated experiment has no confirmed finding', () => {
    const params = defaultParams();
    const user = typicalUser();
    const experiment: Experiment = { id: 'x', terms: ['contains_8'], createdAt: START + 15 * DAY };
    let withConfirmed = 0;
    let withFinding = 0;
    let withPairs = 0;
    for (let seed = 0; seed < 100; seed++) {
      const { trials } = simulateTrials(user, { params, sessions: 10, trialsPerSession: 100, seed: 25000 + seed });
      const sessions = simSessions(trials, params);
      const level = analyse({ trials, sessions }).level!;
      const played = simulateExperimentTrials(user, level, experiment, { params, rounds: 5, seed: 26000 + seed, startMs: START + 20 * DAY });
      if (played.length > 0) withPairs++;
      const snap = analyse({ trials: [...trials, ...played], sessions, experiments: [experiment] });
      if (snap.findings.length > 0) withFinding++;
      if (snap.findings.some((f) => f.tier === 'confirmed')) withConfirmed++;
    }
    console.log(`item 6: with a finding ${withFinding} of 100, with a confirmed finding ${withConfirmed}`);
    expect(withPairs).toBe(100);
    expect(withConfirmed).toBe(0);
  });
});
