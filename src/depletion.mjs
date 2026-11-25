/**
 * How many defects an area still holds, from its run of covering rounds: a removal (depletion) model. Each round's
 * pass finds some fraction `p` of what the area holds then, and its fixer removes what it fixed, so a pass finds
 * fewer as the area empties. Fitted by maximum likelihood over the whole run (Zippin's method): the area held `n0`
 * before the run, and round k found `found_k ~ Binomial(n0 − removed before k, p)`.
 *
 * Code changed outside the audits adds defects the model does not expect, so a run starts after the last round
 * whose files changed before the next (`depletionRunOf`).
 */

/** Whether two file lists hold the same files. */
const sameFiles = (a, b) => {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  const set = new Set(b);
  return a.every((f) => set.has(f));
};

/** Past this many more than the least `n0` the finds allow, the fit is unbounded: the finds are not falling. */
export const MAX_EXTRA = 400;

/** An area settles once its fit leaves under this many defects… */
export const SETTLED_LEFT = 1;
/** …and the chance its next pass finds any is under this. */
export const SETTLED_NEXT = 0.05;

const logChoose = (n, k) => {
  let s = 0;
  for (let i = 1; i <= k; i++) s += Math.log((n - k + i) / i);
  return s;
};

const r2 = (n) => Math.round(n * 100) / 100;

/**
 * The fit for `rounds`, oldest first, each `{ found, removed }`: `{ rounds, n0, p, left, next }`, `next` the chance a
 * further pass finds at least one; `unbounded: true` (and `left` and `next` null) where the finds do not fall enough to
 * bound `n0`. Undefined for fewer than two rounds.
 */
export const depletionOf = (rounds, pooledP) => {
  if (rounds.length < (pooledP ? 1 : 2)) return undefined;
  let removed = 0;
  let least = 0;
  const before = [];
  for (const r of rounds) {
    before.push(removed);
    least = Math.max(least, removed + r.found);
    removed += r.removed;
  }
  least = Math.max(least, removed);
  const caught = rounds.reduce((n, r) => n + r.found, 0);
  const fitAt = (n0) => {
    const exposed = before.reduce((n, b) => n + (n0 - b), 0);
    const p = pooledP ?? (exposed > 0 ? caught / exposed : 0);
    let ll = 0;
    rounds.forEach((r, i) => {
      const n = n0 - before[i];
      ll += logChoose(n, r.found) + (r.found ? r.found * Math.log(p) : 0) + (n - r.found ? (n - r.found) * Math.log(1 - p) : 0);
    });
    return { n0, p, ll };
  };
  const fits = [];
  for (let n0 = least; n0 <= least + MAX_EXTRA; n0++) fits.push(fitAt(n0));
  const best = fits.reduce((b, f) => (f.ll > b.ll + 1e-9 ? f : b));
  // The 95% profile-likelihood bound: the largest n0 whose likelihood is within χ²₁(0.95)/2 of the best.
  const upper = fits.filter((f) => f.ll >= best.ll - CHI2_95 / 2).at(-1);
  if (upper.n0 >= least + MAX_EXTRA) return { rounds: rounds.length, n0: best.n0 >= least + MAX_EXTRA ? null : best.n0, p: null, left: null, leftUpper: null, next: null, unbounded: true };
  const left = Math.max(0, best.n0 - removed);
  const leftUpper = Math.max(0, upper.n0 - removed);
  return { rounds: rounds.length, n0: best.n0, p: r2(best.p), left, leftUpper, next: r2(1 - (1 - upper.p) ** leftUpper) };
};

/**
 * The detection rate every area shares, fitted over `runs` (each area's `depletionRunOf`) together: the `p` that best
 * explains all of them, each area's `n0` at its own best for that `p`. Null with no run of two or more rounds, which
 * alone can say anything about `p`.
 */
export const pooledPOf = (runs) => {
  const usable = runs.filter((r) => r.length >= 2);
  if (!usable.length) return null;
  let best = null;
  for (let i = 1; i < 100; i++) {
    const p = i / 100;
    const ll = usable.reduce((n, run) => n + bestLl(run, p), 0);
    if (!best || ll > best.ll) best = { p, ll };
  }
  return best.p;
};

/** The best log-likelihood of `run` over `n0` with `p` fixed. */
const bestLl = (run, p) => {
  let removed = 0;
  let least = 0;
  const before = run.map((r) => {
    const b = removed;
    least = Math.max(least, removed + r.found);
    removed += r.removed;
    return b;
  });
  least = Math.max(least, removed);
  let best = -Infinity;
  for (let n0 = least; n0 <= least + MAX_EXTRA; n0++) {
    let ll = 0;
    run.forEach((r, i) => {
      const n = n0 - before[i];
      ll += logChoose(n, r.found) + r.found * Math.log(p) + (n - r.found) * Math.log(1 - p);
    });
    if (ll < best) break;
    best = ll;
  }
  return best;
};

/** χ²'s 95th percentile at one degree of freedom. */
const CHI2_95 = 3.841;

/**
 * Whether a fit settles its area: at its 95% upper bound it leaves under SETTLED_LEFT, and the chance a next pass finds
 * any of those is under SETTLED_NEXT.
 */
export const settlesBy = (fit) => Boolean(fit && !fit.unbounded && fit.leftUpper < SETTLED_LEFT && fit.next < SETTLED_NEXT);

/**
 * The rounds a fit goes by, from `rounds` (an area's covering rounds, each `combinedOf` its passes, oldest first):
 * the latest run in which no round's files differ from the area's now, and no lines changed between one round and the
 * next but those rounds' fixes (`linesAfter(round)`, the lines changed from that round to the next, undefined where
 * unknown). Each as `{ round, commit, fixCommits, found, removed }`: `found` the defects its fixer fixed, listed or extra,
 * where its `fix.md` says, else its distinct findings, by the round's share of the area; `removed` the same.
 */
export const depletionRunOf = (rounds, files, linesAfter) => {
  const run = [];
  for (let i = rounds.length - 1; i >= 0; i--) {
    const r = rounds[i];
    if (!sameFiles(r.files, files)) break;
    if (i < rounds.length - 1 && linesAfter(r.round) !== 0) break;
    const n = Math.round((r.fixed ?? r.distinct ?? 0) * (r.share ?? 1));
    run.unshift({ round: r.round, commit: r.commit, fixCommits: r.fixCommits ?? [], found: n, removed: n });
  }
  return run;
};
