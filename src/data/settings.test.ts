import { describe, expect, it } from 'vitest';
import { defaultParams } from '../domain/operations/registry';
import { defaultSettings, loadSettings, saveSettings, SETTINGS_KEY, settingsProblem, type Settings } from './settings';

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    data,
  };
}

const withRange = (key: string, range: unknown): unknown => ({
  ...defaultSettings(),
  params: { ...defaultParams(), ranges: { ...defaultParams().ranges, [key]: range } },
});

describe('defaultSettings', () => {
  it('is Zetamac: all four operations, the default ranges, 120 seconds, and Train at difficulty 80 and focus one half', () => {
    expect(defaultSettings()).toEqual({ params: defaultParams(), durationS: 120, train: { difficultyPct: 80, focus: 0.5 } });
    expect(settingsProblem(defaultSettings())).toBeNull();
  });
});

describe('settingsProblem', () => {
  it.each([
    ['a duration Zetamac does not offer', { ...defaultSettings(), durationS: 45 }, 'Pick a duration.'],
    [
      'no operation enabled',
      { ...defaultSettings(), params: { ...defaultParams(), enabled: { add: false, sub: false, mul: false, div: false } } },
      'Pick at least one operation.',
    ],
    ['a range that ends before it starts', withRange('mulA', [12, 2]), 'Multiplication: the first factor range ends before it starts.'],
    ['a range below its floor', withRange('mulA', [0, 12]), 'Multiplication: the first factor range cannot start below 1.'],
    ['a range above the ceiling', withRange('addB', [2, 10_001]), 'Addition: the second addend range cannot go above 10000.'],
    ['a range that is not whole numbers', withRange('addA', [2, Number.NaN]), 'Addition: the first addend range needs two whole numbers.'],
    ['nothing at all', null, 'Settings are missing.'],
    ['no Train settings', { params: defaultParams(), durationS: 120 }, 'Settings are missing.'],
    ['a Train difficulty below 50', { ...defaultSettings(), train: { difficultyPct: 49, focus: 0.5 } }, 'Train difficulty must be from 50 to 95.'],
    ['a Train difficulty above 95', { ...defaultSettings(), train: { difficultyPct: 96, focus: 0.5 } }, 'Train difficulty must be from 50 to 95.'],
    ['a Train difficulty that is not a number', { ...defaultSettings(), train: { difficultyPct: '80', focus: 0.5 } }, 'Train difficulty must be from 50 to 95.'],
    ['a Train focus below 0', { ...defaultSettings(), train: { difficultyPct: 80, focus: -0.1 } }, 'Train focus must be from 0 to 100%.'],
    ['a Train focus above 1', { ...defaultSettings(), train: { difficultyPct: 80, focus: 1.1 } }, 'Train focus must be from 0 to 100%.'],
    ['a Train focus that is not a number', { ...defaultSettings(), train: { difficultyPct: 80, focus: Number.NaN } }, 'Train focus must be from 0 to 100%.'],
  ])('rejects %s', (_, input, expected) => {
    expect(settingsProblem(input)).toBe(expected);
  });
});

describe('loadSettings and saveSettings', () => {
  it('round-trip through storage', () => {
    const storage = memoryStorage();
    const custom: Settings = { ...defaultSettings(), durationS: 30 };
    saveSettings(storage, custom);
    expect(loadSettings(storage)).toEqual(custom);
  });

  it('accept the ends of the Train ranges', () => {
    for (const train of [
      { difficultyPct: 50, focus: 0 },
      { difficultyPct: 95, focus: 1 },
    ]) {
      const storage = memoryStorage();
      saveSettings(storage, { ...defaultSettings(), train });
      expect(loadSettings(storage).train).toEqual(train);
    }
  });

  it('give stored settings from before Train the Train defaults, and keep the rest', () => {
    const old = { params: { ...defaultParams(), enabled: { ...defaultParams().enabled, div: false } }, durationS: 60 };
    expect(loadSettings(memoryStorage({ [SETTINGS_KEY]: JSON.stringify(old) }))).toEqual({ ...old, train: { difficultyPct: 80, focus: 0.5 } });
  });

  it('fall back to defaults when the stored Train settings are invalid', () => {
    const bad = { ...defaultSettings(), durationS: 60, train: { difficultyPct: 10, focus: 0.5 } };
    expect(loadSettings(memoryStorage({ [SETTINGS_KEY]: JSON.stringify(bad) }))).toEqual(defaultSettings());
  });

  it('fall back to defaults for missing, corrupt or invalid data', () => {
    expect(loadSettings(memoryStorage())).toEqual(defaultSettings());
    expect(loadSettings(memoryStorage({ [SETTINGS_KEY]: '{not json' }))).toEqual(defaultSettings());
    expect(loadSettings(memoryStorage({ [SETTINGS_KEY]: JSON.stringify({ durationS: 45 }) }))).toEqual(defaultSettings());
    expect(loadSettings(null)).toEqual(defaultSettings());
  });

  it('do not throw when storage throws', () => {
    const broken = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('full');
      },
    };
    expect(loadSettings(broken)).toEqual(defaultSettings());
    expect(() => saveSettings(broken, defaultSettings())).not.toThrow();
  });
});
