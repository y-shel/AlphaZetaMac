import { useState, type ChangeEvent } from 'react';
import type { AzmDb } from '../../data/db';
import { exportAll, importExport, parseExport } from '../../data/exportImport';
import { isQuotaError } from '../../data/log';
import type { Settings } from '../../data/settings';
import { downloadJson } from '../download';

const count = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

interface Props {
  db: AzmDb | null;
  settings: Settings;
}

export function DataPanel({ db, settings }: Props) {
  const [message, setMessage] = useState<string | null>(null);
  if (db === null) return null;

  function report(e: unknown, context: 'export' | 'import') {
    const text = e instanceof Error ? e.message : String(e);
    if (isQuotaError(e)) {
      setMessage(context === 'export' ? `Storage is full. ${text}` : 'Storage is full, so nothing was imported.');
    } else {
      setMessage(`That did not work: ${text}`);
    }
  }

  async function doExport(database: AzmDb) {
    const file = await exportAll(database, settings, Date.now());
    downloadJson(`alphazetamac-${new Date().toISOString().slice(0, 10)}.json`, file);
  }

  async function doImport(database: AzmDb, input: HTMLInputElement) {
    const file = input.files?.[0];
    input.value = '';
    if (file === undefined) return;
    const parsed = parseExport(await file.text());
    if (!parsed.ok) {
      setMessage(parsed.reason);
      return;
    }
    const added = await importExport(database, parsed.file);
    setMessage(`Imported ${count(added.trials, 'trial')}, ${count(added.sessions, 'session')}.`);
  }

  return (
    <section className="data-panel">
      <button
        type="button"
        onClick={() => {
          doExport(db).catch((e: unknown) => {
            report(e, 'export');
          });
        }}
      >
        Export data
      </button>{' '}
      <label>
        Import data{' '}
        <input
          type="file"
          accept="application/json,.json"
          onChange={(e: ChangeEvent<HTMLInputElement>) => {
            doImport(db, e.currentTarget).catch((err: unknown) => {
              report(err, 'import');
            });
          }}
        />
      </label>
      {message !== null && <p role="status">{message}</p>}
    </section>
  );
}
