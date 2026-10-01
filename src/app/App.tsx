import { lazy, Suspense, useEffect, useState } from 'react';
import type { GeneratorParams } from '../domain/types';
import type { Obs } from '../engine/features';
import type { TestProgress } from '../engine/select/stopping';
import { openDb, type AzmDb } from '../data/db';
import { isQuotaError, saveRound } from '../data/log';
import { loadSettings, saveSettings, type Settings } from '../data/settings';
import { clearDerived } from '../data/analysisStore';
import { useAnalysis } from './analysis/useAnalysis';
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
  | { kind: 'testResults'; obs: Obs[]; progress: TestProgress; typingGapMs: number }
  | { kind: 'dashboard' };
type DbState =
  | { kind: 'opening' }
  | { kind: 'ready'; db: AzmDb }
  | { kind: 'full'; db: AzmDb }
  | { kind: 'unavailable' }
  | { kind: 'blocked' };

// The dashboard is its own chunk, so it never weighs on the drill (spec 17.5).
const Dashboard = lazy(() => import('./dashboard/Dashboard').then((m) => ({ default: m.Dashboard })));

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
      .then(() =>
        openDb(undefined, {
          onBlocking: () => {
            if (live) setDbState({ kind: 'blocked' });
          },
        }),
      )
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
    analysis.runner?.roundStarted();
    setSaveError(null);
    setRoundNo((n) => n + 1);
    setScreen({ kind });
  }

  function applyParams(params: GeneratorParams) {
    changeSettings({ ...settings, params });
    setScreen({ kind: 'settings' });
  }

  function watchSave(saved: Promise<void>) {
    // Analysis runs after the round is written, never during it (spec 18).
    saved.finally(() => analysis.runner?.roundEnded()).catch(() => undefined);
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
  const analysis = useAnalysis(db, dbState.kind === 'ready');

  function refreshAnalysis() {
    analysis.runner?.request();
  }

  async function rebuildAnalysis() {
    if (db !== null && dbState.kind === 'ready') await clearDerived(db);
    refreshAnalysis();
  }
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
          {db !== null && (
            <p>
              <button
                type="button"
                onClick={() => {
                  setScreen({ kind: 'dashboard' });
                  refreshAnalysis();
                }}
              >
                Dashboard
              </button>
            </p>
          )}
          <DataPanel
            db={db}
            settings={settings}
            onImported={() => void rebuildAnalysis()}
            onRebuild={() => void rebuildAnalysis()}
          />
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
          quitLabel="Stop the test"
          onEnd={({ controller, saved }) => {
            // A stopped test keeps its trials but shows no results: it is incomplete.
            setScreen(
              controller.stopped()
                ? { kind: 'settings' }
                : {
                    kind: 'testResults',
                    obs: controller.observations(),
                    progress: controller.selector.progress,
                    typingGapMs: controller.typingGapMs(),
                  },
            );
            watchSave(saved);
          }}
        />
      )}
      {screen.kind === 'testResults' && (
        <TestResults
          obs={screen.obs}
          progress={screen.progress}
          current={settings.params}
          typingGapMs={screen.typingGapMs}
          onUse={applyParams}
          onBack={() => setScreen({ kind: 'settings' })}
        />
      )}
      {screen.kind === 'dashboard' && (
        <Suspense fallback={<p>Loading.</p>}>
          <Dashboard state={analysis.state} onRefresh={refreshAnalysis} onBack={() => setScreen({ kind: 'settings' })} />
        </Suspense>
      )}
    </main>
  );
}
