import type { Experiment, ParamSnapshot, Session, Trial } from '../domain/types';
import { LOG_STORES, type AzmDb } from './db';
import { upgradeTrial } from './migrations';
import { isExperiment, isParamSnapshot, isRecord, isSession } from './validate';

export const EXPORT_FORMAT = 'alphazetamac-export';
export const EXPORT_FORMAT_VERSION = 2;

export interface ExportFile {
  format: typeof EXPORT_FORMAT;
  formatVersion: number;
  exportedAt: number;
  /** Carried for the user's reference. Import does not apply it. */
  settings: unknown;
  trials: Trial[];
  sessions: Session[];
  paramSnapshots: ParamSnapshot[];
  experiments: Experiment[];
}

export type ParseResult = { ok: true; file: ExportFile } | { ok: false; reason: string };

export interface ImportCounts {
  trials: number;
  sessions: number;
  paramSnapshots: number;
  experiments: number;
}

export async function exportAll(db: AzmDb, settings: unknown, exportedAt: number): Promise<ExportFile> {
  // One readonly transaction, so an export cannot catch a half-flushed round.
  const tx = db.transaction(LOG_STORES, 'readonly');
  const [trials, sessions, paramSnapshots, experiments] = await Promise.all([
    tx.objectStore('trials').getAll() as Promise<unknown[]>,
    tx.objectStore('sessions').getAll(),
    tx.objectStore('paramSnapshots').getAll(),
    tx.objectStore('experiments').getAll(),
    tx.done,
  ]);
  return {
    format: EXPORT_FORMAT,
    formatVersion: EXPORT_FORMAT_VERSION,
    exportedAt,
    settings,
    trials: trials.map((t) => upgradeTrial(t)),
    sessions,
    paramSnapshots,
    experiments,
  };
}

/** Validates the whole file before anything is written. One bad record rejects the file. */
export function parseExport(text: string): ParseResult {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'The file is not valid JSON.' };
  }
  if (!isRecord(data) || data.format !== EXPORT_FORMAT) {
    return { ok: false, reason: 'The file is not an AlphaZetaMac export.' };
  }
  // Version 1 predates experiments and reads as a file with none.
  if (data.formatVersion !== 1 && data.formatVersion !== EXPORT_FORMAT_VERSION) {
    return { ok: false, reason: `Export format version ${String(data.formatVersion)} is not supported.` };
  }
  const { trials, sessions, paramSnapshots } = data;
  if (!Array.isArray(trials) || !Array.isArray(sessions) || !Array.isArray(paramSnapshots)) {
    return { ok: false, reason: 'The file is missing trials, sessions or parameter snapshots.' };
  }
  const experiments: unknown = data.formatVersion === 1 ? [] : data.experiments;
  if (!Array.isArray(experiments)) return { ok: false, reason: 'The file is missing experiments.' };
  const upgraded: Trial[] = [];
  for (const [i, raw] of trials.entries()) {
    try {
      upgraded.push(upgradeTrial(raw));
    } catch (e) {
      return { ok: false, reason: `Trial ${i} is invalid: ${(e as Error).message}.` };
    }
  }
  const badSession = sessions.findIndex((s) => !isSession(s));
  if (badSession !== -1) return { ok: false, reason: `Session ${badSession} is invalid.` };
  const badSnapshot = paramSnapshots.findIndex((p) => !isParamSnapshot(p));
  if (badSnapshot !== -1) return { ok: false, reason: `Parameter snapshot ${badSnapshot} is invalid.` };
  const badExperiment = experiments.findIndex((e) => !isExperiment(e));
  if (badExperiment !== -1) return { ok: false, reason: `Experiment ${badExperiment} is invalid.` };
  return {
    ok: true,
    file: {
      format: EXPORT_FORMAT,
      formatVersion: EXPORT_FORMAT_VERSION,
      exportedAt: typeof data.exportedAt === 'number' ? data.exportedAt : 0,
      settings: data.settings,
      trials: upgraded,
      sessions: sessions as Session[],
      paramSnapshots: paramSnapshots as ParamSnapshot[],
      experiments: experiments as Experiment[],
    },
  };
}

/**
 * Merges by id in one transaction. A record whose id already exists is left alone, so
 * importing the same file twice changes nothing.
 */
export async function importExport(db: AzmDb, file: ExportFile): Promise<ImportCounts> {
  const tx = db.transaction(LOG_STORES, 'readwrite');
  const counts: ImportCounts = { trials: 0, sessions: 0, paramSnapshots: 0, experiments: 0 };
  const trials = tx.objectStore('trials');
  for (const t of file.trials) {
    if ((await trials.getKey(t.id)) === undefined) {
      await trials.add(t);
      counts.trials += 1;
    }
  }
  const sessions = tx.objectStore('sessions');
  for (const s of file.sessions) {
    if ((await sessions.getKey(s.id)) === undefined) {
      await sessions.add(s);
      counts.sessions += 1;
    }
  }
  const snapshots = tx.objectStore('paramSnapshots');
  for (const p of file.paramSnapshots) {
    if ((await snapshots.getKey(p.id)) === undefined) {
      await snapshots.add(p);
      counts.paramSnapshots += 1;
    }
  }
  const experiments = tx.objectStore('experiments');
  for (const e of file.experiments) {
    if ((await experiments.getKey(e.id)) === undefined) {
      await experiments.add(e);
      counts.experiments += 1;
    }
  }
  await tx.done;
  return counts;
}
