import { useState, type FormEvent } from 'react';
import { DURATIONS, settingsProblem, type DurationS, type Settings } from '../../data/settings';
import { getOperation, operations } from '../../domain/operations/registry';
import type { Range } from '../../domain/types';

interface Props {
  initial: Settings;
  canStart: boolean;
  onChange: (settings: Settings) => void;
  onStart: (settings: Settings) => void;
}

const shown = (n: number) => (Number.isNaN(n) ? '' : n);

/** Built from the operation registry, so a new operation shows up here with no changes. */
export function SettingsScreen({ initial, canStart, onChange, onStart }: Props) {
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
      </button>
    </form>
  );
}
