/**
 * The population difficulty prior (spec 9).
 *
 * Each entry is how much a structural feature changes a typical adult's log response time.
 * These are rough, literature-derived approximations. They vary with education and language
 * background, and only their direction and rough size are meant. The level model scales the
 * whole table by one fitted coefficient, gamma, so a user's own data can shrink it to nothing
 * (spec 8.2).
 *
 * Sources:
 * - carry_required, +0.13: Bieck, Artemenko, Moeller and Klein (2018), Frontiers in
 *   Neuroscience 12:176. Adults took 2537 ms without a carry and 2880 ms with one.
 * - carry_multiple, +0.07: assumed to be half the first carry.
 * - borrow_required, +0.18: Imbo, Vandierendonck and Vergauwe (2007), Psychological
 *   Research 71:467-483, found borrowing costs more than carrying. The size is assumed.
 * - tie, -0.15: LeFevre, Bisanz, Daley, Buffone, Greenham and Sadesky (1996), Journal of
 *   Experimental Psychology: General 125:284-306, Table 1. Ties took 1068 ms against 1453 ms
 *   for other problems, about -0.31. Halved, because ties are also smaller problems on
 *   average and the level model already fits size.
 * - two_digit_multiplier, +0.30: assumed. Two two-digit factors need decomposition.
 * - operand_round, -0.10: assumed. A multiple of 10 allows a shortcut.
 *
 * Problem size is not in this table on purpose. The level model fits a size slope per
 * operation, so a size entry here would only compete with it.
 */
import { getAtom } from '../../domain/atoms/registry';
import type { AtomContext } from '../../domain/atoms/types';
import type { Problem } from '../../domain/types';

/** Keyed by atom id. Offsets are in log response time. */
export const POPULATION_PRIOR: Readonly<Record<string, number>> = {
  carry_required: 0.13,
  carry_multiple: 0.07,
  borrow_required: 0.18,
  tie: -0.15,
  two_digit_multiplier: 0.3,
  operand_round: -0.1,
};

const entries = Object.entries(POPULATION_PRIOR).map(([id, offset]) => ({ atom: getAtom(id), offset }));

/** The sum of the offsets of every prior atom that is true for this problem. */
export function priorOffset(problem: Problem): number {
  const ctx: AtomContext = { problem, prev: null, indexInSession: 0, roundLength: 0 };
  let sum = 0;
  for (const { atom, offset } of entries) if (atom.applies(ctx) === true) sum += offset;
  return sum;
}
