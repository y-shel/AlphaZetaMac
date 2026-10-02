import type { Term } from './terms';

/** A per-term weighted mean residual, reported without any claim of significance (spec 10.3). */
export interface Observation {
  termId: string;
  atomIds: readonly string[];
  /** Weighted mean residual on rows where the term holds minus where it does not, log-time units. */
  effectLogT: number;
  se: number;
  nPositive: number;
}

/**
 * The small-sample fallback (spec 10.3): for each single-atom term, the weighted mean
 * residual where it holds minus where it does not, with its standard error, largest first.
 * Only slow-side differences are kept.
 */
export function fallbackRanking(terms: readonly Term[], y: ArrayLike<number>, w: ArrayLike<number>, rows: readonly number[]): Observation[] {
  const out: Observation[] = [];
  for (const t of terms) {
    if (t.atomIds.length !== 1) continue;
    const g = [0, 1].map((v) => {
      let sw = 0;
      let sy = 0;
      let syy = 0;
      let sw2 = 0;
      for (const i of rows) {
        if (t.values[i] !== v) continue;
        const wi = w[i]!;
        sw += wi;
        sw2 += wi * wi;
        sy += wi * y[i]!;
        syy += wi * y[i]! * y[i]!;
      }
      const mean = sw > 0 ? sy / sw : 0;
      const variance = sw > 0 ? Math.max(syy / sw - mean * mean, 0) : 0;
      // Variance of a weighted mean: σ² Σw² / (Σw)².
      return { mean, v: sw > 0 ? (variance * sw2) / (sw * sw) : Infinity };
    });
    const effect = g[1]!.mean - g[0]!.mean;
    if (!(effect > 0)) continue;
    out.push({ termId: t.id, atomIds: t.atomIds, effectLogT: effect, se: Math.sqrt(g[0]!.v + g[1]!.v), nPositive: t.nPositive });
  }
  return out.sort((a, b) => b.effectLogT - a.effectLogT);
}
