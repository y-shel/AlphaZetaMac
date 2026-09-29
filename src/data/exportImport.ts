import type { ParamSnapshot, Session, Trial } from '../domain/types';
import type { AzmDb } from './db';
import { getAllParamSnapshots, getAllSessions, getAllTrials } from './log';
import { upgradeTrial } from './migrations';
import { isParamSnapshot, isRecord, isSession } from './validate';

export const EXPORT_FORMAT = 'alphazetamac-export';
export const EXPORT_FORMAT_VERSION = 1;

export interface ExportFile {
  format: typeof EXPORT_FORMAT;
  formatVersion: number;
  exportedAt: number;
  /** Carried for the user's reference. Import does not apply it. */
  settings: unknown;
  trials: Trial[];
  sessions: Session[];
  paramSnapshots: ParamSnapshot[];
}

export type ParseResult = { ok: true; file: ExportFile } | { ok: false; reason: string };

export interface ImportCounts {
  trials: number;
  sessions: number;
  paramSnapshots: number;
}

export async function exportAll(db: AzmDb, settings: unknown, exportedAt: number): Promise<ExportFile> {
  return {
    format: EXPORT_FORMAT,
    formatVersion: EXPORT_FORMAT_VERSION,
    exportedAt,
    settings,
    trials: await getAllTrials(db),
    sessions: await getAllSessions(db),
    paramSnapshots: await getAllParamSnapshots(db),
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
  if (data.formatVersion !== EXPORT_FORMAT_VERSION) {
    return { ok: false, reason: `Export format version ${String(data.formatVersion)} is not supported.` };
  }
  const { trials, sessions, paramSnapshots } = data;
  if (!Array.isArray(trials) || !Array.isArray(sessions) || !Array.isArray(paramSnapshots)) {
    return { ok: false, reason: 'The file is missing trials, sessions or parameter snapshots.' };
  }
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
    },
  };
}

/**
 * Merges by id in one transaction. A record whose id already exists is left alone, so
 * importing the same file twice changes nothing.
 */
export async function importExport(db: AzmDb, file: ExportFile): Promise<ImportCounts> {
  const tx = db.transaction(['trials', 'sessions', 'paramSnapshots'], 'readwrite');
  const counts: ImportCounts = { trials: 0, sessions: 0, paramSnapshots: 0 };
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
  await tx.done;
  return counts;
}
