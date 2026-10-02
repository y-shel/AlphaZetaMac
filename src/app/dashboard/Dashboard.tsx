import { getOperation } from '../../domain/operations/registry';
import type { AnalysisState } from '../analysis/runner';
import { describeFinding, describeTermId } from '../describe';
import { ScoreChart } from './ScoreChart';

interface Props {
  state: AnalysisState;
  onRefresh: () => void;
  onBack: () => void;
}

const when = (ms: number) => new Date(ms).toLocaleString();

/** The dashboard (spec 13). Renders the last snapshot; never computes anything itself. */
export function Dashboard({ state, onRefresh, onBack }: Props) {
  const { snapshot, running, error } = state;
  return (
    <div className="dashboard">
      <p>
        <button type="button" onClick={onBack}>
          Back to settings
        </button>{' '}
        <button type="button" onClick={onRefresh} disabled={running}>
          {running ? 'Updating' : 'Update now'}
        </button>
      </p>
      {error !== null && (
        <p role="alert" className="storage-banner">
          The last update failed: {error}. {snapshot !== null && 'This shows the last good analysis.'}
        </p>
      )}
      {snapshot === null ? (
        <p>{running ? 'Working out your results.' : 'Play a few rounds, then come back.'}</p>
      ) : (
        <>
          <p className="dashboard-meta">
            Based on {snapshot.nTrials} problems, up to {snapshot.computedAt > 0 ? when(snapshot.computedAt) : 'now'}.
          </p>

          <section>
            <h2>Score over time</h2>
            {snapshot.score === null ? (
              <p>No normal rounds yet.</p>
            ) : (
              <>
                <ScoreChart series={snapshot.score} />
                {snapshot.score.points[snapshot.score.points.length - 1]?.low != null ? (
                  <p>
                    {snapshot.score.points.length} rounds of {snapshot.score.durationS} seconds with the same settings. The shaded
                    band is the day-to-day variation of your level. Single rounds vary more than that.
                  </p>
                ) : (
                  <p>
                    {snapshot.score.points.length} rounds of {snapshot.score.durationS} seconds with the same settings. There is not
                    enough play yet to show normal day-to-day variation.
                  </p>
                )}
              </>
            )}
          </section>

          <section>
            <h2>Confirmed weaknesses</h2>
            {snapshot.findings.filter((f) => f.tier === 'confirmed').length === 0 ? (
              <p>None confirmed yet.</p>
            ) : (
              <ul>
                {snapshot.findings
                  .filter((f) => f.tier === 'confirmed')
                  .map((f) => {
                    const d = describeFinding(f);
                    return (
                      <li key={f.id} data-testid="confirmed-finding">
                        <strong>{d.title}.</strong> {d.body} Found separately in two halves of your rounds.
                      </li>
                    );
                  })}
              </ul>
            )}
          </section>

          <section>
            <h2>Suspected weaknesses</h2>
            {snapshot.stage2 === 'fallback' ? (
              <>
                <p>Not enough play yet to call anything a weakness. Early observations, with no claim that they are real:</p>
                <ul>
                  {snapshot.observations.slice(0, 3).map((o) => (
                    <li key={o.termId} data-testid="observation">
                      {describeTermId(o.termId)}: about {Math.round((Math.exp(o.effectLogT) - 1) * 100)}% slower so far.
                    </li>
                  ))}
                </ul>
              </>
            ) : snapshot.findings.filter((f) => f.tier === 'suspected').length === 0 ? (
              <p>{snapshot.stage2 === 'none' ? 'Play at least 100 problems to start looking.' : 'Nothing stands out.'}</p>
            ) : (
              <ul>
                {snapshot.findings
                  .filter((f) => f.tier === 'suspected')
                  .map((f) => {
                    const d = describeFinding(f);
                    return (
                      <li key={f.id} data-testid="suspected-finding">
                        <strong>{d.title}.</strong> {d.body} Not yet confirmed.
                      </li>
                    );
                  })}
              </ul>
            )}
          </section>

          <section>
            <h2>Where you stand</h2>
            {snapshot.standing === null ? (
              <p>Not enough play yet.</p>
            ) : (
              <>
                {snapshot.standing.overall !== null && (
                  <p>
                    At default settings you would score about {Math.round(snapshot.standing.overall.score)}:{' '}
                    {snapshot.standing.overall.band.label}.
                  </p>
                )}
                <ul>
                  {snapshot.standing.operations.map((o) => (
                    <li key={o.opId}>
                      {getOperation(o.opId).label} alone: about {Math.round(o.score)}, {o.band.label}.
                    </li>
                  ))}
                </ul>
                <p className="dashboard-note">
                  Approximate. The bands are community rules of thumb for default Zetamac scores, not measured percentiles.
                </p>
              </>
            )}
          </section>

          <section>
            <h2>Strategy shifts</h2>
            <p>Shift detection is not built yet.</p>
          </section>

          <section>
            <h2>What the engine cannot see yet</h2>
            {snapshot.blindSpots.length === 0 ? (
              <p>Nothing is waiting on more data.</p>
            ) : (
              <ul>
                {snapshot.blindSpots.slice(0, 5).map((b) => (
                  <li key={b.id}>
                    {describeTermId(b.id)}: about {b.moreTrialsNeeded} more problems.
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
