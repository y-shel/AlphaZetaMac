import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import type { GeneratorParams } from '../domain/types';
import { findingId, type Finding } from '../engine/findings/finding';
import type { Obs } from '../engine/features';
import type { ExperimentState } from '../engine/confirm/eprocess';
import type { TestProgress } from '../engine/select/stopping';
import { openDb, type AzmDb } from '../data/db';
import { getAllExperiments, getAllTrials, isQuotaError, saveExperiment, saveRound } from '../data/log';
import { loadSettings, saveSettings, type Settings } from '../data/settings';
import { clearDerived } from '../data/analysisStore';
import { useAnalysis } from './analysis/useAnalysis';
import { browserStorage } from './browserStorage';
import { DrillRound } from './drill/DrillRound';
import { uuidv7 } from '../domain/uuidv7';
import { ExperimentResult } from './ExperimentResult';
import { experimentController, prepareExperiment, type ExperimentPlan } from './modes/experimentMode';
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
  | { kind: 'experiment'; plan: ExperimentPlan }
  | { kind: 'experimentResult'; state: ExperimentState }
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
  // True from the press of "Test this" until the round has started or the start failed.
  const starting = useRef(false);
  const [testNote, setTestNote] = useState<{ findingId: string; reason: string } | null>(null);

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
    if (db !== null && dbState.kind === 'ready') {
      try {
        await clearDerived(db);
      } catch (e) {
        setSaveError(`The stored analysis could not be cleared: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    // A run still goes ahead: a good run replaces both derived stores together.
    refreshAnalysis();
  }

  /** "Test this" (spec 14). Reads the log once, before the round, never during it. */
  async function testFinding(finding: Finding) {
    const level = analysis.state.snapshot?.level ?? null;
    if (starting.current || db === null || dbState.kind !== 'ready' || level === null) return;
    starting.current = true;
    setTestNote(null);
    try {
      const [experiments, trials] = await Promise.all([getAllExperiments(db), getAllTrials(db)]);
      // Only an open experiment is added to. A ruled-out one that became testable again starts fresh.
      const existing =
        finding.experiment?.outcome === 'open' ? (experiments.find((e) => e.id === finding.experiment?.id && findingId(e.terms) === finding.id) ?? null) : null;
      const prepared = prepareExperiment({
        finding,
        level,
        params: settings.params,
        existing,
        priorTrials: existing === null ? [] : trials.filter((t) => t.mode === 'experiment' && t.experimentId === existing.id),
        seed: crypto.getRandomValues(new Uint32Array(1))[0] ?? 0,
        now: Date.now(),
        newId: (ms) => uuidv7(ms, crypto.getRandomValues(new Uint8Array(10))),
      });
      if (prepared.kind === 'cannot-test') {
        setTestNote({ findingId: finding.id, reason: prepared.reason });
        return;
      }
      // The definition goes in before any trial that points at it.
      if (prepared.isNew) await saveExperiment(db, prepared.experiment);
      analysis.runner?.roundStarted();
      setSaveError(null);
      setRoundNo((n) => n + 1);
      setScreen({ kind: 'experiment', plan: { experiment: prepared.experiment, pairs: prepared.pairs, prior: prepared.prior, level } });
    } catch (e) {
      setSaveError(`The test could not start: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      starting.current = false;
    }
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
      {screen.kind === 'experiment' && (
        <DrillRound
          key={roundNo}
          start={(s) => experimentController(settings, save, s, screen.plan)}
          quitLabel="Stop the test"
          onEnd={({ controller, saved }) => {
            setScreen({ kind: 'experimentResult', state: controller.state() });
            watchSave(saved);
          }}
        />
      )}
      {screen.kind === 'experimentResult' && (
        <ExperimentResult
          state={screen.state}
          onBack={() => {
            setScreen({ kind: 'dashboard' });
            refreshAnalysis();
          }}
        />
      )}
      {screen.kind === 'dashboard' && (
        <Suspense fallback={<p>Loading.</p>}>
          <Dashboard
            state={analysis.state}
            onRefresh={refreshAnalysis}
            onBack={() => setScreen({ kind: 'settings' })}
            onTest={(f) => void testFinding(f)}
            canTest={dbState.kind === 'ready' && analysis.state.snapshot?.level != null}
            testNote={testNote}
          />
        </Suspense>
      )}
    </main>
  );
}
