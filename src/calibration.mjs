/**
 * How Chapman's "defects left" compares with what an area's next pass finds, and the estimate corrected by it.
 * Chapman assumes the two reviewers find defects independently; two runs of one model do not, so the estimate runs
 * low. Every figure here is recomputed from the recorded passes; no factor is kept by hand.
 *
 * What a next pass finds is a lower bound on what the pass before it left, since the fixer fixed that pass's
 * findings in between, and it also counts defects added since; each pair's `lines` says how much code changed.
 */

/** A bucket's own factor is used once it has at least this many pairs; below it, the overall factor. */
export const MIN_BUCKET_PAIRS = 5;

/** The buckets of pass k's shared count, in order. */
export const SHARED_BUCKETS = ['0', '1–2', '3+'];

/** The bucket of a pass that shared `shared` findings between its reviewers. */
export const bucketOf = (shared) => (shared <= 0 ? '0' : shared <= 2 ? '1–2' : '3+');

const r1 = (n) => Math.round(n * 10) / 10;
const r2 = (n) => Math.round(n * 100) / 100;

/**
 * One row per pair of consecutive passes of different rounds on one area, provisional ones skipped: pass k's counts and what it left,
 * and what pass k+1 found (its `distinct`, scaled by its `share` as `left` is). `histories` iterates
 * `[areaId, passes]` with passes as the map draws them, oldest first; `lines`, keyed `<area>\n<round k>`, gives the
 * lines of the area's files changed between the two passes, pass k's fixes aside, where known.
 */
export const calibrationPairs = (histories, lines = new Map()) => {
  const pairs = [];
  for (const [area, passes] of histories) {
    const done = passes.filter((p) => !p.provisional);
    for (let i = 0; i + 1 < done.length; i++) {
      const [k, next] = [done[i], done[i + 1]];
      if (k.round === next.round) continue;
      const changed = lines.get(`${area}\n${k.round}`);
      pairs.push({
        area, round: k.round, next: next.round, a: k.a, b: k.b, shared: k.shared, est: k.est, left: k.left,
        found: r1(next.distinct * (next.share ?? 1)),
        ...(changed === undefined ? {} : { lines: changed }),
      });
    }
  }
  return pairs;
};

/** Pooled `found / predicted` over `pairs`, null while nothing was predicted. */
const pooled = (pairs) => {
  const predicted = pairs.reduce((n, p) => n + p.left, 0);
  const found = pairs.reduce((n, p) => n + p.found, 0);
  return { pairs: pairs.length, predicted: r1(predicted), found: r1(found), factor: predicted > 0 ? r2(found / predicted) : null };
};

/** The pooled factor over every pair, and by pass k's shared bucket. */
export const calibrationFactors = (pairs) => ({
  overall: pooled(pairs),
  byShared: Object.fromEntries(SHARED_BUCKETS.map((b) => [b, pooled(pairs.filter((p) => bucketOf(p.shared) === b))])),
});

/**
 * Per round k, the left its areas' passes predicted and what their next passes found, and the pooled factor over
 * every pair from that round or earlier.
 */
export const calibrationSeries = (pairs) => {
  const rounds = [...new Set(pairs.map((p) => p.round))].sort((x, y) => x - y);
  let predicted = 0;
  let found = 0;
  return rounds.map((round) => {
    const own = pairs.filter((p) => p.round === round);
    const here = pooled(own);
    predicted += here.predicted;
    found += here.found;
    return { round, pairs: own.length, predicted: here.predicted, found: here.found, factor: predicted > 0 ? r2(found / predicted) : null };
  });
};

/** Everything the map carries: the pairs, the factors, and the series. */
export const calibrationOf = (histories, lines) => {
  const pairs = calibrationPairs(histories, lines);
  return { minPairs: MIN_BUCKET_PAIRS, pairs, factors: calibrationFactors(pairs), series: calibrationSeries(pairs) };
};

/**
 * The factor for a pass that shared `shared`: its bucket's, once that has MIN_BUCKET_PAIRS pairs and a factor, else
 * the overall one; never under 1, and 1 with no pairs at all.
 */
export const factorFor = (calibration, shared) => {
  const { overall, byShared } = calibration.factors;
  const own = byShared[bucketOf(shared)];
  const f = own && own.pairs >= MIN_BUCKET_PAIRS && own.factor !== null ? own.factor : overall.factor;
  return Math.max(1, f ?? 1);
};

/** A pass's `left` times its bucket's factor. */
export const correctedLeftOf = (pass, calibration) => r1(pass.left * factorFor(calibration, pass.shared));
