import type { ExperimentState } from '../engine/confirm/eprocess';

interface Props {
  state: ExperimentState;
  onBack: () => void;
}

/** What a round of matched pairs found (spec 13 panel 3). Says no more than the test decided. */
export function ExperimentResult({ state, onBack }: Props) {
  const n = state.decidedAtPair ?? state.pairs;
  return (
    <div className="experiment-result">
      <h2>Test finished</h2>
      <p data-testid="experiment-outcome">
        {state.outcome === 'confirmed' && `Confirmed after ${n} pairs. These problems are slower for you than matched ones.`}
        {state.outcome === 'ruled-out' && `Ruled out after ${n} pairs. If there is an effect, it is under 10%.`}
        {state.outcome === 'open' && `Not settled after ${n} pairs. Run it again to add to what is there.`}
      </p>
      <button type="button" onClick={onBack}>
        Back to the dashboard
      </button>
    </div>
  );
}
