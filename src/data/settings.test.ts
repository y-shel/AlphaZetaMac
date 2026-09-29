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
  it('is Zetamac: all four operations, the default ranges, 120 seconds', () => {
    expect(defaultSettings()).toEqual({ params: defaultParams(), durationS: 120 });
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
