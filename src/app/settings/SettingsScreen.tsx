import { useState, type FormEvent } from 'react';
import { DURATIONS, settingsProblem, TRAIN_DIFFICULTY_MAX, TRAIN_DIFFICULTY_MIN, type DurationS, type Settings } from '../../data/settings';
import { getOperation, operations } from '../../domain/operations/registry';
import type { Range } from '../../domain/types';
import { TRAIN_NEEDS_LEVEL, TRAIN_NO_FOCUS } from '../modes/trainMode';

interface Props {
  initial: Settings;
  canStart: boolean;
  onChange: (settings: Settings) => void;
  onStart: (settings: Settings) => void;
  /** Starts the Test tab with these settings' operations and lower bounds. */
  onStartTest: (settings: Settings) => void;
  /** False without a level model for these settings: the Train button is off. */
  trainReady: boolean;
  /** False with no finding to focus on: the Focus slider is off. */
  canFocus: boolean;
  onStartTrain: (settings: Settings) => void;
}

const shown = (n: number) => (Number.isNaN(n) ? '' : n);

/** Built from the operation registry, so a new operation shows up here with no changes. */
export function SettingsScreen({ initial, canStart, onChange, onStart, onStartTest, trainReady, canFocus, onStartTrain }: Props) {
  const [draft, setDraft] = useState<Settings>(initial);
  const problem = settingsProblem(draft);

  function update(next: Settings) {
    setDraft(next);
    if (settingsProblem(next) === null) onChange(next);
  }

  function setEnabled(opId: string, on: boolean) {
    update({ ...draft, params: { ...draft.params, enabled: { ...draft.params.enabled, [opId]: on } } });
  }

  function setBound(key: string, end: 0 | 1, value: number) {
    const [min, max] = draft.params.ranges[key] ?? [Number.NaN, Number.NaN];
    const next: Range = end === 0 ? [value, max] : [min, value];
    update({ ...draft, params: { ...draft.params, ranges: { ...draft.params.ranges, [key]: next } } });
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (problem === null && canStart) onStart(draft);
  }

  return (
    <form className="settings" onSubmit={submit}>
      {operations.map((op) => (
        <div className="settings-op" key={op.id}>
          <label>
            <input
              type="checkbox"
              checked={draft.params.enabled[op.id] === true}
              onChange={(e) => setEnabled(op.id, e.target.checked)}
            />{' '}
            {op.label}
          </label>
          {op.derivesFrom !== undefined ? (
            <span className="settings-note">{getOperation(op.derivesFrom).label} problems in reverse.</span>
          ) : (
            <span className="settings-ranges">
              Range:{' '}
              {op.paramShape.ranges.map((spec, i) => {
                const [min, max] = draft.params.ranges[spec.key] ?? [Number.NaN, Number.NaN];
                return (
                  <span key={spec.key}>
                    {i > 0 && ` ${op.symbol} `}(
                    <input
                      type="number"
                      aria-label={`${op.label} ${spec.label} minimum`}
                      value={shown(min)}
                      onChange={(e) => setBound(spec.key, 0, e.target.valueAsNumber)}
                    />{' '}
                    to{' '}
                    <input
                      type="number"
                      aria-label={`${op.label} ${spec.label} maximum`}
                      value={shown(max)}
                      onChange={(e) => setBound(spec.key, 1, e.target.valueAsNumber)}
                    />
                    )
                  </span>
                );
              })}
            </span>
          )}
        </div>
      ))}
      <div className="settings-duration">
        <label htmlFor="duration">Duration</label>{' '}
        <select
          id="duration"
          value={draft.durationS}
          onChange={(e) => update({ ...draft, durationS: Number(e.target.value) as DurationS })}
        >
          {DURATIONS.map((d) => (
            <option key={d} value={d}>
              {d} seconds
            </option>
          ))}
        </select>
      </div>
      {problem !== null && <p role="alert">{problem}</p>}
      <button type="submit" disabled={problem !== null || !canStart}>
        Start
      </button>{' '}
      <button type="button" disabled={problem !== null || !canStart} onClick={() => onStartTest(draft)}>
        Take the test
      </button>
      <fieldset className="settings-train">
        <legend>Train</legend>
        <div className="settings-slider">
          <label htmlFor="train-difficulty">Difficulty</label>{' '}
          <input
            id="train-difficulty"
            type="range"
            min={TRAIN_DIFFICULTY_MIN}
            max={TRAIN_DIFFICULTY_MAX}
            step={5}
            value={draft.train.difficultyPct}
            onChange={(e) => update({ ...draft, train: { ...draft.train, difficultyPct: e.target.valueAsNumber } })}
          />{' '}
          <output htmlFor="train-difficulty">{draft.train.difficultyPct}</output>
        </div>
        <div className="settings-slider">
          <label htmlFor="train-focus">Focus</label>{' '}
          <input
            id="train-focus"
            type="range"
            min={0}
            max={100}
            step={5}
            disabled={!canFocus}
            value={Math.round(draft.train.focus * 100)}
            onChange={(e) => update({ ...draft, train: { ...draft.train, focus: e.target.valueAsNumber / 100 } })}
          />{' '}
          <output htmlFor="train-focus">{Math.round(draft.train.focus * 100)}%</output>
          {!canFocus && <span className="settings-note">{TRAIN_NO_FOCUS}</span>}
        </div>
        {!trainReady && <p className="settings-train-note">{TRAIN_NEEDS_LEVEL}</p>}
        <button type="button" disabled={problem !== null || !canStart || !trainReady} onClick={() => onStartTrain(draft)}>
          Train
        </button>
      </fieldset>
    </form>
  );
}
