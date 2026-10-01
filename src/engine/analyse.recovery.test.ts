import { describe, expect, it } from 'vitest';
import { defaultParams } from '../domain/operations/registry';
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
