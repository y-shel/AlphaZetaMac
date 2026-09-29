import { useState } from 'react';
import { loadSettings, saveSettings, type Settings } from '../data/settings';
import { browserStorage } from './browserStorage';
import { SettingsScreen } from './settings/SettingsScreen';

export function App() {
  const [settings, setSettings] = useState<Settings>(() => loadSettings(browserStorage()));

  function changeSettings(next: Settings) {
    setSettings(next);
    saveSettings(browserStorage(), next);
  }

  return (
    <main className="app">
      <SettingsScreen initial={settings} canStart={true} onChange={changeSettings} onStart={changeSettings} />
    </main>
  );
}
