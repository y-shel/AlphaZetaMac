import { atomContexts } from '../../domain/atoms/contexts';
import { operations } from '../../domain/operations/registry';
import type { Operation } from '../../domain/operations/types';
import type { Trial } from '../../domain/types';
import type { LevelRows } from '../features';
import { fallbackRanking, type Observation } from './fallback';
import { stage2Rows, type Stage2Rows } from './rows';
import { suffStats, susie, type SusieFit } from './susie';
import { buildTerms, type BlindSpot, type Term } from './terms';

/**
 * The Stage 2 regression as one value (spec 10.1): the rows and the term columns built
 * from those same rows. terms[j].values[r] describes rows.trials[r]. Build it with
 * stage2Matrix only, so rows are never paired with another set of trials' columns.
 */
export interface Stage2Matrix {
  rows: Stage2Rows;
  terms: Term[];
  blindSpots: BlindSpot[];
}

export type Stage2MatrixResult = { kind: 'ok'; matrix: Stage2Matrix } | { kind: 'insufficient-data'; reason: string };

/**
 * The Stage 2 rows of the level trials and the term columns of those rows. all is the
 * whole log, which the sequence atoms need to find a row's previous trial and its round
 * length. A cross-fit failure is passed through.
 */
export function stage2Matrix(level: LevelRows, all: readonly Trial[], registry: readonly Operation[] = operations): Stage2MatrixResult {
  const result = stage2Rows(level, registry);
  if (result.kind !== 'ok') return result;
  const { rows } = result;
  const { terms, blindSpots } = buildTerms(atomContexts(rows.trials, all));
  return { kind: 'ok', matrix: { rows, terms, blindSpots } };
}

/** SuSiE on the given row positions, or on every row when none are given (spec 10.2, 10.5). */
export function fitRows(matrix: Stage2Matrix, subset?: readonly number[]): SusieFit {
  const { rows } = matrix;
  const columns = matrix.terms.map((t) => t.values);
  return susie(suffStats(columns, rows.residual, rows.weight, subset ?? rows.all));
}

/** The small-sample fallback ranking on every row (spec 10.3). */
export function rankFallback(matrix: Stage2Matrix): Observation[] {
  const { rows } = matrix;
  return fallbackRanking(matrix.terms, rows.residual, rows.weight, rows.all);
}
