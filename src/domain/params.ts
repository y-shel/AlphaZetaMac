import { cyrb53 } from './hash';
import type { GeneratorParams } from './types';

/** JSON with object keys sorted at every depth, so equal values give equal strings. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const entries = Object.keys(record)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(record[k])}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value);
}

/** Content-addressed: the same parameters always give the same snapshot id. */
export function paramsSnapshotId(params: GeneratorParams): string {
  return `ps-${cyrb53(canonicalJson(params)).toString(16).padStart(14, '0')}`;
}
