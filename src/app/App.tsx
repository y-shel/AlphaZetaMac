import { useEffect, useState } from 'react';
import type { GeneratorParams } from '../domain/types';
import type { Obs } from '../engine/features';
import type { TestProgress } from '../engine/select/stopping';
import { openDb, type AzmDb } from '../data/db';
import { isQuotaError, saveRound } from '../data/log';
import { loadSettings, saveSettings, type Settings } from '../data/settings';
import { browserStorage } from './browserStorage';
import { DrillRound } from './drill/DrillRound';
import { normalController } from './modes/normalMode';
import type { SaveRound } from './modes/sessionWriter';
import { testController } from './modes/testMode';
import { ScoreScreen } from './ScoreScreen';
import { DataPanel } from './settings/DataPanel';
import { SettingsScreen } from './settings/SettingsScreen';
import { StorageBanner } from './StorageBanner';
import { TestResults } from './TestResults';

type Screen =
  | { kind: 'settings' }
  | { kind: 'drill' }
  | { kind: 'score'; score: number }
  | { kind: 'test' }
  | { kind: 'testResults'; obs: Obs[]; progress: TestProgress };
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

  function start(kind: 'drill' | 'test') {
    setSaveError(null);
    setRoundNo((n) => n + 1);
    setScreen({ kind });
  }

  function applyParams(params: GeneratorParams) {
    changeSettings({ ...settings, params });
    setScreen({ kind: 'settings' });
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
              start('drill');
            }}
            onStartTest={(next) => {
              changeSettings(next);
              start('test');
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
        <ScoreScreen score={screen.score} onAgain={() => start('drill')} onSettings={() => setScreen({ kind: 'settings' })} />
      )}
      {screen.kind === 'test' && (
        <DrillRound
          key={roundNo}
          start={(s) => testController(settings, save, s)}
          onEnd={({ controller, saved }) => {
            setScreen({ kind: 'testResults', obs: controller.observations(), progress: controller.selector.progress });
            watchSave(saved);
          }}
        />
      )}
      {screen.kind === 'testResults' && (
        <TestResults
          obs={screen.obs}
          progress={screen.progress}
          current={settings.params}
          onUse={applyParams}
          onBack={() => setScreen({ kind: 'settings' })}
        />
      )}
    </main>
  );
}
