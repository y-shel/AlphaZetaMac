// Spec 21, verbatim. Later plans use the ones Plan 2 does not.
export const MAX_CONJUNCTION_DEPTH = 2;
export const HALF_LIFE_TRIALS = 400;
export const CROSS_FIT_FOLDS = 5;
export const LAPSE_MAX_MS = 15000;
export const LAPSE_PRIOR_WEIGHT = 0.02;
export const SESSION_SHRINKAGE_TAU = 20;
export const TERM_MIN_PREVALENCE = 0.15;
export const TERM_MAX_PREVALENCE = 0.85;
export const TERM_MIN_POSITIVE_TRIALS = 30;
export const STAGE1_MIN_TRIALS = 100;
export const SUSIE_MIN_TRIALS = 200;
export const SUSIE_L = 5;
export const PIP_MASS_THRESHOLD = 0.95;
export const MIN_EFFECT_LOG_T = 0.05;
export const MATCH_TOLERANCE_LOG_T = 0.05;
export const EPROCESS_ALPHA = 0.05;
export const EPROCESS_MAX_PAIRS = 60;
export const EPROCESS_FUTILITY = 0.2;
export const TRAIN_CALIBRATION_FRACTION = 0.25;
export const TEST_TAB_ITEMS = 100;
export const TEST_TAB_MIN_ITEMS = 60;
export const DEFAULT_DIFFICULTY_PCTILE = 0.6;

// Plan 2 choices. The spec is silent on these.
/** EM passes of fit, session offsets and lapse responsibilities before the final fit (spec 8.4). */
export const LAPSE_EM_ITERATIONS = 3;
/** The highest lapse share the EM may reach. Above this the data is not Zetamac play. */
export const LAPSE_MAX_RATE = 0.2;
/** Ridge penalty on every coefficient. Small: it guards the solve, it is not a prior. */
export const RIDGE_LAMBDA = 1e-3;
/** A singular solve retries once with the penalty multiplied by this (spec 19). */
export const RIDGE_RETRY_FACTOR = 1000;
/** A Cholesky pivot below this share of the largest diagonal entry counts as singular. */
export const MIN_PIVOT_RATIO = 1e-10;
/** An operation needs this many eligible trials to get its own intercept and slope. */
export const STAGE1_MIN_OP_TRIALS = 10;
/** First-key times below this are clamped before the log, so a 0 ms key is not -Infinity. */
export const MIN_FIRST_KEY_MS = 1;
/** Residual sd floor, so identical times cannot give a zero-width normal. */
export const MIN_SIGMA = 0.01;
/** Candidate problems scored per Test item (spec 22.2). */
export const TEST_CANDIDATES = 40;
/** Added to the diagonal of the Test design matrix so the first items can be scored. */
export const TEST_DESIGN_RIDGE = 1;
/** Test stops early once every operation's predicted log time, at its smallest and largest tested size, has a standard error below this. */
export const TEST_PRED_SE_THRESHOLD = 0.1;
/** ...and gamma's standard error is below this. */
export const TEST_GAMMA_SE_THRESHOLD = 0.4;
/** Problems sampled to estimate a predicted log-time distribution in parameter derivation. */
export const DERIVE_SAMPLES = 2000;
