import { TRIAL_SCHEMA_VERSION, type Trial } from '../domain/types';
import { isRecord, isTrial } from './validate';

export type Migration = (trial: Record<string, unknown>) => Record<string, unknown>;

/**
 * trialMigrations[i] turns a version i + 1 trial into version i + 2. Forward only.
 * A migration that discards information needs a note in the design record (spec 6.3).
 */
export const trialMigrations: readonly Migration[] = [];

export function upgradeTrial(
  raw: unknown,
  migrations: readonly Migration[] = trialMigrations,
  current: number = TRIAL_SCHEMA_VERSION,
): Trial {
  if (!isRecord(raw) || !Number.isSafeInteger(raw.schemaVersion)) {
    throw new Error('trial has no schemaVersion');
  }
  let version = raw.schemaVersion as number;
  if (version < 1 || version > current) throw new Error(`unsupported trial schemaVersion ${version}`);
  let trial = raw;
  while (version < current) {
    const migrate = migrations[version - 1];
    if (migrate === undefined) throw new Error(`no migration from trial schemaVersion ${version}`);
    version += 1;
    trial = { ...migrate(trial), schemaVersion: version };
  }
  if (!isTrial(trial)) throw new Error('trial does not match the current schema');
  return trial;
}
