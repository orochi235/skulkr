/** Usage records, one per model job, as its agent's `resultOf` reads them (`src/agent/`), and what they add up to. */
import { join } from 'node:path';
import { readIf } from './text.mjs';

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
 * What each area's jobs cost in the night at `nightDir` so far, by area id, from its `usage.jsonl`: a resumed round's
 * spend before the resume. A reused job's record repeats a cost already counted, so it adds nothing.
 */
export const spendIn = (nightDir) => {
  const spent = new Map();
  for (const line of readIf(join(nightDir, 'usage.jsonl')).split('\n')) {
    if (!line.trim()) continue;
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }
    if (!record.reused && record.area) spent.set(record.area, (spent.get(record.area) ?? 0) + (record.costUsd ?? 0));
  }
  return spent;
};

/**
 * Whether a night that has spent `used` dollars may start another area, expecting each to cost the mean of `finished`
 * (dollar costs of its finished areas) or `guess`. `running` holds what each area still running has spent so far, which
 * `used` already counts, so each is expected to cost only the rest of its share; `before` is what the next area spent
 * before a resume, which `used` counts too.
 */
export const mayStartArea = ({ used, finished, running, cap, guess, before = 0 }) => {
  const expected = finished.length > 0 ? finished.reduce((s, n) => s + n, 0) / finished.length : guess;
  const rest = running.reduce((s, spent) => s + Math.max(0, expected - spent), 0);
  return used + rest + Math.max(0, expected - before) <= cap;
};
