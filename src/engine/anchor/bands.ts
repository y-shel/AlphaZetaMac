/**
 * The global rank anchor (spec 15, amended 2026-09-30).
 *
 * No public Zetamac score distribution exists: no survey, leaderboard or dataset. These are
 * the community bands for default settings (120 seconds), gathered from r/quant and Wall
 * Street Oasis threads and collected by QuantVault, "Zetamac: What a Good Score Is"
 * (quantvault.org/zetamac-practice.html), which calls them candidate folklore, not official
 * cutoffs. They are approximate, and the app says so wherever it shows one.
 *
 * The source gives "below 40" and "45 to 55". The gap between 40 and 45 is put in the lower
 * band here.
 */

export type Band = 'building' | 'baseline' | 'competitive' | 'strong';

export interface BandInfo {
  band: Band;
  /** Plain words for the band. */
  label: string;
  approximate: true;
}

/** Lowest default-settings score in each band, highest band first. */
const BANDS: readonly { band: Band; from: number; label: string }[] = [
  { band: 'strong', from: 70, label: 'strong, even for top trading firms' },
  { band: 'competitive', from: 55, label: 'competitive for most trading firm screens' },
  { band: 'baseline', from: 45, label: 'a workable baseline' },
  { band: 'building', from: -Infinity, label: 'still building speed' },
];

/** The community band for a score at default settings. */
export function bandFor(defaultScore: number): BandInfo {
  const b = BANDS.find((x) => defaultScore >= x.from)!;
  return { band: b.band, label: b.label, approximate: true };
}
