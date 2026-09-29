import { defaultParams, operations } from '../domain/operations/registry';
import type { Operation } from '../domain/operations/types';
import type { GeneratorParams } from '../domain/types';
import { isRecord } from './validate';

export const DURATIONS = [30, 60, 120, 300] as const;
export type DurationS = (typeof DURATIONS)[number];
export const RANGE_CEILING = 10_000;
export const SETTINGS_KEY = 'alphazetamac.settings';

export interface Settings {
  params: GeneratorParams;
  durationS: DurationS;
}

export function defaultSettings(): Settings {
  return { params: defaultParams(), durationS: 120 };
}

/** null when the settings are usable, otherwise one sentence saying what is wrong. */
export function settingsProblem(x: unknown, registry: readonly Operation[] = operations): string | null {
  if (!isRecord(x) || !isRecord(x.params)) return 'Settings are missing.';
  if (!(DURATIONS as readonly unknown[]).includes(x.durationS)) return 'Pick a duration.';
  const { enabled, ranges } = x.params;
  if (!isRecord(enabled) || !isRecord(ranges)) return 'Settings are missing.';
  let anyEnabled = false;
  for (const op of registry) {
    const on = enabled[op.id];
    if (typeof on !== 'boolean') return `${op.label} is missing an on or off setting.`;
    anyEnabled ||= on;
    for (const spec of op.paramShape.ranges) {
      const r = ranges[spec.key];
      const name = `${op.label}: the ${spec.label} range`;
      if (!Array.isArray(r) || r.length !== 2 || !Number.isSafeInteger(r[0]) || !Number.isSafeInteger(r[1])) {
        return `${name} needs two whole numbers.`;
      }
      const [min, max] = r as [number, number];
      if (min < spec.floor) return `${name} cannot start below ${spec.floor}.`;
      if (max < min) return `${name} ends before it starts.`;
      if (max > RANGE_CEILING) return `${name} cannot go above ${RANGE_CEILING}.`;
    }
  }
  if (!anyEnabled) return 'Pick at least one operation.';
  return null;
}

export function loadSettings(storage: Pick<Storage, 'getItem'> | null): Settings {
  if (storage === null) return defaultSettings();
  try {
    const raw = storage.getItem(SETTINGS_KEY);
    if (raw === null) return defaultSettings();
    const parsed: unknown = JSON.parse(raw);
    return settingsProblem(parsed) === null ? (parsed as Settings) : defaultSettings();
  } catch {
    return defaultSettings();
  }
}

export function saveSettings(storage: Pick<Storage, 'setItem'> | null, settings: Settings): void {
  if (storage === null) return;
  try {
    storage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Settings are a convenience. If storage refuses them, the drill still runs on what is in memory.
  }
}
