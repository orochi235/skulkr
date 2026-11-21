/** Usage records, one per model job, as its agent's `resultOf` reads them (`src/agent/`), and what they add up to. */

/**
 * What each kind of token costs against an input token, the same ratios for every Claude model: a cache read is
 * a tenth of one, so a long session's rereads count for what they cost, not for their bulk.
 */
export const TOKEN_WEIGHTS = { input: 1, output: 5, cacheWrite5m: 1.25, cacheWrite1h: 2, cacheRead: 0.1 };

/** `n` dollars as the log prints them: `$1.50`. */
export const usd = (n) => `$${n.toFixed(2)}`;

/** `tokens` counted as input tokens of equal cost. */
export const weightedTokens = (tokens) =>
  Math.round(Object.entries(TOKEN_WEIGHTS).reduce((s, [kind, w]) => s + (tokens[kind] ?? 0) * w, 0));

/** Sums of a list of usage records. */
export const totals = (records) => ({
  weightedTokens: records.reduce((s, r) => s + r.weightedTokens, 0),
  costUsd: records.reduce((s, r) => s + r.costUsd, 0),
});

/**
 * Whether a night that has spent `used` dollars may start another area, expecting each to cost the mean of `finished`
 * (dollar costs of its finished areas) or `guess`. `running` holds what each area still running has spent so far, which
 * `used` already counts, so each is expected to cost only the rest of its share.
 */
export const mayStartArea = ({ used, finished, running, cap, guess }) => {
  const expected = finished.length > 0 ? finished.reduce((s, n) => s + n, 0) / finished.length : guess;
  const rest = running.reduce((s, spent) => s + Math.max(0, expected - spent), 0);
  return used + rest + expected <= cap;
};
