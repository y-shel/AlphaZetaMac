import { useEffect, useState } from 'react';
import { openDb, type AzmDb } from '../data/db';
import { saveRound } from '../data/log';
import { loadSettings, saveSettings, type Settings } from '../data/settings';
import { browserStorage } from './browserStorage';
import { NormalRound, type RoundResult } from './modes/NormalRound';
import type { SaveRound } from './modes/normalSession';
import { ScoreScreen } from './ScoreScreen';
import { SettingsScreen } from './settings/SettingsScreen';

type Screen = { kind: 'settings' } | { kind: 'drill' } | { kind: 'score'; score: number };
type DbState = { kind: 'opening' } | { kind: 'ready'; db: AzmDb } | { kind: 'unavailable' };

export function App() {
  const [settings, setSettings] = useState<Settings>(() => loadSettings(browserStorage()));
  const [dbState, setDbState] = useState<DbState>({ kind: 'opening' });
  const [screen, setScreen] = useState<Screen>({ kind: 'settings' });
  const [roundNo, setRoundNo] = useState(0);

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

  function startRound() {
    setRoundNo((n) => n + 1);
    setScreen({ kind: 'drill' });
  }

  function endRound({ score, saved }: RoundResult) {
    setScreen({ kind: 'score', score });
    // Task 10 shows save failures to the user.
    saved.catch((e: unknown) => console.error('The round was not saved.', e));
  }

  const save: SaveRound | null =
    dbState.kind === 'ready' ? (snapshot, session, trials) => saveRound(dbState.db, snapshot, session, trials) : null;

  return (
    <main className="app">
      {screen.kind === 'settings' && (
        <SettingsScreen
          initial={settings}
          canStart={dbState.kind !== 'opening'}
          onChange={changeSettings}
          onStart={(next) => {
            changeSettings(next);
            startRound();
          }}
        />
      )}
      {screen.kind === 'drill' && <NormalRound key={roundNo} settings={settings} save={save} onEnd={endRound} />}
      {screen.kind === 'score' && (
        <ScoreScreen score={screen.score} onAgain={startRound} onSettings={() => setScreen({ kind: 'settings' })} />
      )}
    </main>
  );
}
