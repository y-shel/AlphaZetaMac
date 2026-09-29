import { useEffect, useState } from 'react';
import { openDb, type AzmDb } from '../data/db';
import { isQuotaError, saveRound } from '../data/log';
import { loadSettings, saveSettings, type Settings } from '../data/settings';
import { browserStorage } from './browserStorage';
import { DrillRound } from './drill/DrillRound';
import { normalController } from './modes/normalMode';
import type { SaveRound } from './modes/sessionWriter';
import { ScoreScreen } from './ScoreScreen';
import { DataPanel } from './settings/DataPanel';
import { SettingsScreen } from './settings/SettingsScreen';
import { StorageBanner } from './StorageBanner';

type Screen = { kind: 'settings' } | { kind: 'drill' } | { kind: 'score'; score: number };
type DbState =
  | { kind: 'opening' }
  | { kind: 'ready'; db: AzmDb }
  | { kind: 'full'; db: AzmDb }
  | { kind: 'unavailable' };

export function App() {
  const [settings, setSettings] = useState<Settings>(() => loadSettings(browserStorage()));
  const [dbState, setDbState] = useState<DbState>({ kind: 'opening' });
  const [screen, setScreen] = useState<Screen>({ kind: 'settings' });
  const [roundNo, setRoundNo] = useState(0);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    // Promise.resolve first, so a synchronous throw from indexedDB counts as unavailable too.
    Promise.resolve()
      .then(() => openDb())
      .then(
        (db) => {
          if (live) setDbState({ kind: 'ready', db });
          else db.close();
        },
        () => {
          if (live) setDbState({ kind: 'unavailable' });
        },
      )
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  function changeSettings(next: Settings) {
    setSettings(next);
    saveSettings(browserStorage(), next);
  }

  function start() {
    setSaveError(null);
    setRoundNo((n) => n + 1);
    setScreen({ kind: 'drill' });
  }

  function watchSave(saved: Promise<void>) {
    saved.catch((e: unknown) => {
      if (isQuotaError(e)) {
        // Stop writing (spec 19). Export still reads from the database.
        setDbState((s) => (s.kind === 'ready' ? { kind: 'full', db: s.db } : s));
      } else {
        setSaveError(`This round could not be saved: ${e instanceof Error ? e.message : String(e)}`);
      }
    });
  }

  const db = dbState.kind === 'ready' || dbState.kind === 'full' ? dbState.db : null;
  const save: SaveRound | null =
    dbState.kind === 'ready' ? (snapshot, session, trials) => saveRound(dbState.db, snapshot, session, trials) : null;

  return (
    <main className="app">
      <StorageBanner state={dbState.kind} />
      {saveError !== null && (
        <p role="alert" className="storage-banner">
          {saveError}
        </p>
      )}
      {screen.kind === 'settings' && (
        <>
          <SettingsScreen
            initial={settings}
            canStart={dbState.kind !== 'opening'}
            onChange={changeSettings}
            onStart={(next) => {
              changeSettings(next);
              start();
            }}
          />
          <DataPanel db={db} settings={settings} />
        </>
      )}
      {screen.kind === 'drill' && (
        <DrillRound
          key={roundNo}
          start={(s) => normalController(settings, save, s)}
          onEnd={({ score, saved }) => {
            setScreen({ kind: 'score', score });
            watchSave(saved);
          }}
        />
      )}
      {screen.kind === 'score' && (
        <ScoreScreen score={screen.score} onAgain={start} onSettings={() => setScreen({ kind: 'settings' })} />
      )}
    </main>
  );
}
