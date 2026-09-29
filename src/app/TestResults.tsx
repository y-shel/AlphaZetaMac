import { useMemo } from 'react';
import { getOperation, operations } from '../domain/operations/registry';
import type { GeneratorParams } from '../domain/types';
import type { Obs } from '../engine/features';
import type { TestProgress } from '../engine/select/stopping';
import { summariseTest } from './modes/testSummary';

interface Props {
  obs: readonly Obs[];
  progress: TestProgress;
  current: GeneratorParams;
  onUse: (params: GeneratorParams) => void;
  onBack: () => void;
}

/** The Test tab's output (spec 22.2). Says plainly what 100 items can and cannot tell. */
export function TestResults({ obs, progress, current, onUse, onBack }: Props) {
  const summary = useMemo(() => summariseTest(obs, current), [obs, current]);

  if (summary.kind !== 'ok') {
    return (
      <div className="test-results">
        <h2>Test finished</h2>
        <p>There was not enough to measure your level. Try the test again.</p>
        <button type="button" onClick={onBack}>
          Back to settings
        </button>
      </div>
    );
  }

  const { typicalMs, suggested } = summary;
  return (
    <div className="test-results">
      <h2>Test finished</h2>
      <p>
        {progress === 'converged' ? 'Your level is measured.' : 'Your level is roughly measured. Another test will sharpen it.'}{' '}
        Finding the kinds of problems that slow you down takes a few hundred more problems over several rounds, so keep
        playing.
      </p>
      <table>
        <tbody>
          {typicalMs.map(({ opId, ms }) => (
            <tr key={opId}>
              <td>{getOperation(opId).label}</td>
              <td data-testid={`typical-${opId}`}>{(ms / 1000).toFixed(1)} s to the first key</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p>Suggested settings, so every operation is about as hard for you as the others:</p>
      <ul>
        {operations
          .filter((op) => op.paramShape.ranges.length > 0 && suggested.enabled[op.id] === true)
          .map((op) => (
            <li key={op.id} data-testid={`suggested-${op.id}`}>
              {op.label}:{' '}
              {op.paramShape.ranges
                .map((spec) => {
                  const [lo, hi] = suggested.ranges[spec.key] ?? spec.default;
                  return `${lo} to ${hi}`;
                })
                .join(` ${op.symbol} `)}
            </li>
          ))}
      </ul>
      <button type="button" autoFocus onClick={() => onUse(suggested)}>
        Use these settings
      </button>{' '}
      <button type="button" onClick={onBack}>
        Back to settings
      </button>
    </div>
  );
}
