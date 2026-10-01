import { CS_MIN_PURITY, PIP_MASS_THRESHOLD, SUSIE_L, SUSIE_MAX_ITER, SUSIE_TOL } from '../constants';
import type { TermValues } from './terms';

/**
 * Weighted sufficient statistics of centred term columns against a response. Column j is
 * centred on its applicable rows and is 0 where it does not apply, so rows where a term is
 * not applicable take no part in that term's fit (spec 10.1).
 */
export interface SuffStats {
  p: number;
  /** Σ w over the rows used: the weighted count the residual variance divides by. */
  n: number;
  /** XᵀWX, row-major p × p. */
  xtx: Float64Array;
  /** XᵀWy. */
  xty: Float64Array;
  /** Σ w (y − ȳ)². */
  yty: number;
}

export function suffStats(columns: readonly TermValues[], y: ArrayLike<number>, w: ArrayLike<number>, rows: readonly number[]): SuffStats {
  const p = columns.length;
  const means = new Float64Array(p);
  for (let j = 0; j < p; j++) {
    const col = columns[j]!;
    let s = 0;
    let sw = 0;
    for (const i of rows) {
      const v = col[i]!;
      if (v < 0) continue;
      s += w[i]! * v;
      sw += w[i]!;
    }
    means[j] = sw > 0 ? s / sw : 0;
  }
  let sy = 0;
  let sw = 0;
  for (const i of rows) {
    sy += w[i]! * y[i]!;
    sw += w[i]!;
  }
  const ybar = sw > 0 ? sy / sw : 0;
  const xtx = new Float64Array(p * p);
  const xty = new Float64Array(p);
  let yty = 0;
  const x = new Float64Array(p);
  for (const i of rows) {
    const wi = w[i]!;
    const yi = y[i]! - ybar;
    yty += wi * yi * yi;
    for (let j = 0; j < p; j++) {
      const v = columns[j]![i]!;
      x[j] = v < 0 ? 0 : v - means[j]!;
    }
    for (let a = 0; a < p; a++) {
      const xa = x[a]!;
      if (xa === 0) continue;
      xty[a] = xty[a]! + wi * xa * yi;
      for (let b = 0; b <= a; b++) xtx[a * p + b] = xtx[a * p + b]! + wi * xa * x[b]!;
    }
  }
  for (let a = 0; a < p; a++) for (let b = 0; b < a; b++) xtx[b * p + a] = xtx[a * p + b]!;
  return { p, n: sw, xtx, xty, yty };
}

export interface CredibleSet {
  /** Which single effect this is, 0..L−1. */
  effect: number;
  /** Column indices, highest posterior probability first. */
  columns: number[];
  /** Posterior probability each column is the effect, parallel to columns. */
  alpha: number[];
  /** Posterior mean effect given the effect is in this set, log-time units. */
  mean: number;
  /** Posterior sd of the effect given the effect is in this set. */
  sd: number;
  /** Smallest absolute correlation between members. */
  purity: number;
}

export interface SusieFit {
  /** Posterior inclusion probability per column. */
  pip: Float64Array;
  sets: CredibleSet[];
  sigma2: number;
  /** Evidence lower bound at the last sweep. */
  elbo: number;
  iterations: number;
  converged: boolean;
}

/**
 * An effect whose prior variance is at or below this is null: nothing was found for it and
 * its alpha is uniform. It takes no part in the inclusion probabilities or the credible sets
 * (susieR's susie_get_pip uses the same threshold).
 */
const NULL_EFFECT_PRIOR_VARIANCE = 1e-9;

/**
 * Sum of Single Effects regression by IBSS on sufficient statistics (spec 10.2, Wang et al.
 * 2020, Zou et al. 2022). L single effects with a uniform prior over columns, each prior
 * effect variance by the EM update, residual variance estimated.
 */
export function susie(stats: SuffStats, L: number = SUSIE_L): SusieFit {
  const { p, n, xtx, xty, yty } = stats;
  const d = Float64Array.from({ length: p }, (_, j) => xtx[j * p + j]!);
  const logPrior = -Math.log(p);
  const alpha = Array.from({ length: L }, () => new Float64Array(p).fill(1 / p));
  const mu = Array.from({ length: L }, () => new Float64Array(p));
  const mu2 = Array.from({ length: L }, () => new Float64Array(p));
  const V = new Float64Array(L).fill(Math.max(yty / Math.max(n, 1), 1e-6) * 0.2);
  const kl = new Float64Array(L);
  let sigma2 = Math.max(yty / Math.max(n, 1), 1e-12);
  // XᵀX b̄ kept up to date.
  const xtxb = new Float64Array(p);
  const bbar = new Float64Array(p);
  const effectB = (l: number) => Float64Array.from({ length: p }, (_, j) => alpha[l]![j]! * mu[l]![j]!);
  const addTo = (target: Float64Array, b: Float64Array, sign: number) => {
    for (let a = 0; a < p; a++) {
      const ba = b[a]!;
      if (ba === 0) continue;
      for (let c = 0; c < p; c++) target[c] = target[c]! + sign * xtx[c * p + a]! * ba;
    }
  };

  let elbo = -Infinity;
  let iterations = 0;
  let converged = false;
  for (let iter = 0; iter < SUSIE_MAX_ITER; iter++) {
    iterations = iter + 1;
    for (let l = 0; l < L; l++) {
      const bl = effectB(l);
      addTo(xtxb, bl, -1);
      for (let j = 0; j < p; j++) bbar[j] = bbar[j]! - bl[j]!;
      const r = Float64Array.from({ length: p }, (_, j) => xty[j]! - xtxb[j]!);
      // Prior variance: maximise the single effect's log Bayes factor over log V, and take
      // V = 0 when no V beats the null.
      const lbfAt = (v: number, out: Float64Array | null): number => {
        let maxw = -Infinity;
        const tmp = out ?? new Float64Array(p);
        for (let j = 0; j < p; j++) {
          if (!(d[j]! > 0)) { tmp[j] = -Infinity; continue; }
          const s2 = sigma2 / d[j]!;
          const z2 = (r[j]! * r[j]!) / (d[j]! * d[j]!) / s2;
          tmp[j] = v > 0 ? 0.5 * Math.log(s2 / (s2 + v)) + (0.5 * z2 * v) / (s2 + v) : 0;
          maxw = Math.max(maxw, tmp[j]! + logPrior);
        }
        let sum = 0;
        for (let j = 0; j < p; j++) sum += Math.exp(tmp[j]! + logPrior - maxw);
        return maxw + Math.log(sum);
      };
      let lo = Math.log(1e-8);
      let hi = Math.log(10);
      const gr = (Math.sqrt(5) - 1) / 2;
      let c1 = hi - gr * (hi - lo);
      let c2 = lo + gr * (hi - lo);
      let f1 = lbfAt(Math.exp(c1), null);
      let f2 = lbfAt(Math.exp(c2), null);
      for (let step = 0; step < 60; step++) {
        if (f1 > f2) { hi = c2; c2 = c1; f2 = f1; c1 = hi - gr * (hi - lo); f1 = lbfAt(Math.exp(c1), null); }
        else { lo = c1; c1 = c2; f1 = f2; c2 = lo + gr * (hi - lo); f2 = lbfAt(Math.exp(c2), null); }
      }
      let v = Math.exp((lo + hi) / 2);
      if (lbfAt(v, null) <= 0) v = 0;
      const lbf = new Float64Array(p);
      const lbfModel = lbfAt(v, lbf);
      for (let j = 0; j < p; j++) {
        alpha[l]![j] = Math.exp(lbf[j]! + logPrior - lbfModel);
        const post = v > 0 && d[j]! > 0 ? 1 / (1 / v + d[j]! / sigma2) : 0;
        mu[l]![j] = (post * r[j]!) / sigma2;
        mu2[l]![j] = post + mu[l]![j]! * mu[l]![j]!;
      }
      V[l] = v;
      // KL of this effect: −lbf_model − (1/2σ²)(−2 Σ α μ r + Σ α μ2 d).
      let s1 = 0;
      let s2 = 0;
      for (let j = 0; j < p; j++) {
        s1 += alpha[l]![j]! * mu[l]![j]! * r[j]!;
        s2 += alpha[l]![j]! * mu2[l]![j]! * d[j]!;
      }
      kl[l] = -lbfModel - (-2 * s1 + s2) / (2 * sigma2);
      const nb = effectB(l);
      addTo(xtxb, nb, 1);
      for (let j = 0; j < p; j++) bbar[j] = bbar[j]! + nb[j]!;
    }
    // Expected residual sum of squares.
    let erss = yty;
    for (let j = 0; j < p; j++) erss += -2 * bbar[j]! * xty[j]! + bbar[j]! * xtxb[j]!;
    for (let l = 0; l < L; l++) {
      const bl = effectB(l);
      const tmp = new Float64Array(p);
      addTo(tmp, bl, 1);
      for (let j = 0; j < p; j++) erss += -bl[j]! * tmp[j]! + alpha[l]![j]! * mu2[l]![j]! * d[j]!;
    }
    sigma2 = Math.max(erss / n, 1e-12);
    let klSum = 0;
    for (let l = 0; l < L; l++) klSum += kl[l]!;
    const next = -0.5 * n * Math.log(2 * Math.PI * sigma2) - erss / (2 * sigma2) - klSum;
    if (Math.abs(next - elbo) < SUSIE_TOL) {
      elbo = next;
      converged = true;
      break;
    }
    elbo = next;
  }

  const pip = new Float64Array(p).fill(1);
  for (let l = 0; l < L; l++) {
    if (!(V[l]! > NULL_EFFECT_PRIOR_VARIANCE)) continue;
    for (let j = 0; j < p; j++) pip[j] = pip[j]! * (1 - alpha[l]![j]!);
  }
  for (let j = 0; j < p; j++) pip[j] = 1 - pip[j]!;

  const sets: CredibleSet[] = [];
  for (let l = 0; l < L; l++) {
    if (!(V[l]! > NULL_EFFECT_PRIOR_VARIANCE)) continue;
    const order = Array.from({ length: p }, (_, j) => j).sort((a, b) => alpha[l]![b]! - alpha[l]![a]!);
    const columns: number[] = [];
    let mass = 0;
    for (const j of order) {
      columns.push(j);
      mass += alpha[l]![j]!;
      if (mass >= PIP_MASS_THRESHOLD) break;
    }
    if (mass < PIP_MASS_THRESHOLD) continue;
    let purity = 1;
    for (let a = 0; a < columns.length; a++)
      for (let b = a + 1; b < columns.length; b++) {
        const ja = columns[a]!;
        const jb = columns[b]!;
        const c = xtx[ja * p + jb]! / Math.sqrt(d[ja]! * d[jb]!);
        purity = Math.min(purity, Math.abs(c));
      }
    if (purity < CS_MIN_PURITY) continue;
    let m1 = 0;
    let m2 = 0;
    for (const j of columns) {
      m1 += alpha[l]![j]! * mu[l]![j]!;
      m2 += alpha[l]![j]! * mu2[l]![j]!;
    }
    m1 /= mass;
    m2 /= mass;
    sets.push({
      effect: l,
      columns,
      alpha: columns.map((j) => alpha[l]![j]!),
      mean: m1,
      sd: Math.sqrt(Math.max(m2 - m1 * m1, 0)),
      purity,
    });
  }
  return { pip, sets, sigma2, elbo, iterations, converged };
}
