import { useMemo } from 'react';
import { getOperation, operations } from '../domain/operations/registry';
import type { GeneratorParams } from '../domain/types';
import type { Obs } from '../engine/features';
import type { TestProgress } from '../engine/select/stopping';
import { describeTermId } from './describe';
import { levelSentence, summariseTest } from './modes/testSummary';

interface Props {
  obs: readonly Obs[];
  progress: TestProgress;
  current: GeneratorParams;
  /** Median gap between the user's keystrokes in this test, ms. */
  typingGapMs: number;
  onUse: (params: GeneratorParams) => void;
  onBack: () => void;
}

/** The Test tab's output (spec 22.2). Says plainly what 100 items can and cannot tell. */
export function TestResults({ obs, progress, current, typingGapMs, onUse, onBack }: Props) {
  const summary = useMemo(() => summariseTest(obs, current, typingGapMs), [obs, current, typingGapMs]);

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

  const { typicalMs, suggested, standing, diagnosis } = summary;
  return (
    <div className="test-results">
      <h2>Test finished</h2>
      <p>
        {levelSentence(progress === 'converged' ? 'converged' : 'limit')}{' '}
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
      {standing !== null && (
        <>
          {standing.overall !== null && (
            <p>
              At default settings you would score about {Math.round(standing.overall.score)}: {standing.overall.band.label}.
            </p>
          )}
          <ul>
            {standing.operations.map((o) => (
              <li key={o.opId} data-testid={`standing-${o.opId}`}>
                {getOperation(o.opId).label} alone: about {Math.round(o.score)}, {o.band.label}.
              </li>
            ))}
          </ul>
          <p className="dashboard-note">
            Approximate. The bands are community rules of thumb for default Zetamac scores, not measured percentiles.
          </p>
        </>
      )}
      {diagnosis.length > 0 && (
        <>
          <p>Early signs from this test. There is not enough data to call these weaknesses yet:</p>
          <ul>
            {diagnosis.map((o) => (
              <li key={o.termId} data-testid="test-diagnosis">
                {describeTermId(o.termId)}: about {Math.round((Math.exp(o.effectLogT) - 1) * 100)}% slower.
              </li>
            ))}
          </ul>
        </>
      )}
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
