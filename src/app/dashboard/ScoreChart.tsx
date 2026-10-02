import type { ScoreSeries } from '../../engine/analyse';

const W = 640;
const H = 200;
const PAD = 28;

/** Score per round, its trend, and the day-to-day noise band (spec 13 panel 1). Plain SVG. */
export function ScoreChart({ series }: { series: ScoreSeries }) {
  const pts = series.points;
  const values = pts.flatMap((p) => [p.score, p.trend, p.low ?? p.trend, p.high ?? p.trend]);
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi - lo || 1;
  const x = (i: number) => PAD + (pts.length === 1 ? (W - 2 * PAD) / 2 : (i * (W - 2 * PAD)) / (pts.length - 1));
  const y = (v: number) => H - PAD - ((v - lo) * (H - 2 * PAD)) / span;
  const line = (f: (i: number) => number) => pts.map((_, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(f(i)).toFixed(1)}`).join(' ');
  const withBand = pts.every((p) => p.low !== null && p.high !== null);
  const band = withBand
    ? `${pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.high!).toFixed(1)}`).join(' ')} ${pts
        .map((p, i) => ({ p, i }))
        .reverse()
        .map(({ p, i }) => `L${x(i).toFixed(1)},${y(p.low!).toFixed(1)}`)
        .join(' ')} Z`
    : null;
  return (
    <svg className="score-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Score per round with its trend">
      {band !== null && <path d={band} className="score-band" />}
      <path d={line((i) => pts[i]!.trend)} className="score-trend" />
      {pts.map((p, i) => (
        <circle key={p.sessionId} cx={x(i)} cy={y(p.score)} r={3} className="score-point" />
      ))}
      <text x={4} y={y(hi) + 4} className="score-axis">
        {Math.round(hi)}
      </text>
      <text x={4} y={y(lo) + 4} className="score-axis">
        {Math.round(lo)}
      </text>
    </svg>
  );
}
