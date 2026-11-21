/**
 * What earlier rounds left on disk, and what that says about tonight. Nothing here keeps its own
 * ledger: an area's history is the `<record.dir>/round-<N>/<area>/area.json` files that name it.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { calibrationOf, correctedLeftOf } from './calibration.mjs';
import { churnCacheOf, churnSince } from './churn.mjs';

/** A pass that found at most this many distinct defects counts toward settling its area. */
export const QUIET_PASS = 1;

/** Chapman's estimate of how many defects the area held, from two lists of `a` and `b` sharing `m`. */
export const chapman = (a, b, m) => (a + 1) * (b + 1) / (m + 1) - 1;

/** Every pass on disk under `recordDir` (the config's `record.dir`), by area id, oldest first. */
export const readPasses = (root, recordDir) => {
  const dir = join(root, recordDir);
  const passes = new Map();
  if (!existsSync(dir)) return passes;
  const rounds = readdirSync(dir).flatMap((name) => /^round-(\d+)$/.exec(name)?.[1] ?? []).map(Number);
  for (const round of rounds.sort((x, y) => x - y)) {
    const roundDir = join(dir, `round-${round}`);
    for (const area of readdirSync(roundDir, { withFileTypes: true })) {
      const at = join(roundDir, area.name, 'area.json');
      if (!area.isDirectory() || !existsSync(at)) continue;
      const pass = { round, ...JSON.parse(readFileSync(at, 'utf8')) };
      const listed = join(roundDir, area.name, 'files.txt');
      if (!Array.isArray(pass.files) && existsSync(listed)) pass.files = readFileSync(listed, 'utf8').split('\n').filter(Boolean);
      // A pass a reviewer never ran or never finished is no pass: the area comes back as if it had not been audited.
      if (pass.incomplete?.length || pass.fixOnly) continue;
      if (!passes.has(pass.id)) passes.set(pass.id, []);
      passes.get(pass.id).push(pass);
    }
  }
  return passes;
};

/**
 * `passes` (`readPasses`') with the passes recorded on each of `refs` for rounds not on disk: a batch that has not
 * landed holds its round's record, and its areas were audited all the same. Keeps each round from the first ref
 * holding it; a pass marked incomplete is skipped, as on disk.
 */
export const withBatchPasses = (passes, git, recordDir, refs) => {
  const known = new Set([...passes.values()].flat().map((p) => p.round));
  const area = new RegExp(`^${recordDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/round-(\\d+)/([^/]+)/area\\.json$`);
  const added = new Set();
  for (const ref of refs) {
    const found = new Set();
    for (const path of git('ls-tree', '-r', '--name-only', ref, '--', recordDir).split('\n')) {
      const m = area.exec(path);
      if (!m || known.has(Number(m[1])) || added.has(Number(m[1]))) continue;
      const round = Number(m[1]);
      found.add(round);
      const pass = { round, ...JSON.parse(git('show', `${ref}:${path}`)) };
      if (!Array.isArray(pass.files)) {
        try {
          pass.files = git('show', `${ref}:${path.replace(/area\.json$/, 'files.txt')}`).split('\n').filter(Boolean);
        } catch {}
      }
      if (pass.incomplete?.length || pass.fixOnly) continue;
      if (!passes.has(pass.id)) passes.set(pass.id, []);
      passes.get(pass.id).push(pass);
    }
    for (const r of found) added.add(r);
  }
  for (const list of passes.values()) list.sort((x, y) => x.round - y.round);
  return passes;
};

/** The batch branches not yet merged into `main`, newest name first. */
export const unlandedBatches = (git, batchPrefix, main) =>
  git('for-each-ref', `--no-merged=${main}`, '--sort=-refname', '--format=%(refname:short)', `refs/heads/${batchPrefix}/`)
    .split('\n').filter(Boolean);

/** Every pass the project holds: on disk under `recordDir`, and on the batches `main` has not merged. */
export const passesIn = (cfg, git, root) =>
  withBatchPasses(readPasses(root, cfg.record.dir), git, cfg.record.dir, unlandedBatches(git, cfg.naming.batchPrefix, cfg.git.main));

/** How many areas each round under `recordDir` recorded incomplete, by round: passes `readPasses` leaves out. */
export const incompleteByRound = (root, recordDir) => {
  const dir = join(root, recordDir);
  const counts = new Map();
  if (!existsSync(dir)) return counts;
  for (const name of readdirSync(dir)) {
    const round = Number(/^round-(\d+)$/.exec(name)?.[1]);
    if (!round) continue;
    for (const area of readdirSync(join(dir, name), { withFileTypes: true })) {
      const at = join(dir, name, area.name, 'area.json');
      if (area.isDirectory() && existsSync(at) && JSON.parse(readFileSync(at, 'utf8')).incomplete?.length) {
        counts.set(round, (counts.get(round) ?? 0) + 1);
      }
    }
  }
  return counts;
};

/** An area counts as audited once at least this share of its files were read by some pass. */
export const COVERED = 0.5;

/**
 * Each area's history from the passes whose files overlap its own, so a history follows its files across a recut of
 * the partition: a pass is inherited by every area holding any of its files, with `share`, the part of the pass's
 * files that area holds, by which its estimates are scaled (`scaledOf`). A renamed area keeps its whole history; a
 * split one passes each part its share. A pass with no file list goes to the area of its own id, whole. Each pass also
 * carries `covers`, the part of the area's files its round's passes read together. `raw` is `readPasses`'. Answers `{ history, covered }`: Maps by area id of its passes oldest first, and the share of its files
 * any of them read.
 */
/** @param {{ id: string, files: string[] }[]} areas @param {Map<string, any[]>} raw @returns {{ history: Map<string, any[]>, covered: Map<string, number> }} */
export const inheritPasses = (areas, raw) => {
  const byFile = new Map();
  const unlisted = new Map();
  for (const pass of [...raw.values()].flat()) {
    if (!pass.files?.length) {
      unlisted.set(pass.id, [...(unlisted.get(pass.id) ?? []), pass]);
      continue;
    }
    for (const f of pass.files) byFile.set(f, [...(byFile.get(f) ?? []), pass]);
  }
  const history = new Map();
  const covered = new Map();
  for (const area of areas) {
    const overlap = new Map();
    const roundRead = new Map();
    let read = 0;
    for (const f of area.files) {
      const passes = byFile.get(f);
      if (!passes) continue;
      read += 1;
      for (const p of passes) overlap.set(p, (overlap.get(p) ?? 0) + 1);
      for (const round of new Set(passes.map((p) => p.round))) roundRead.set(round, (roundRead.get(round) ?? 0) + 1);
    }
    const coversOf = (round) => (area.files.length ? (roundRead.get(round) ?? 0) / area.files.length : 0);
    const own = (unlisted.get(area.id) ?? []).map((p) => ({ ...p, share: 1, covers: 1 }));
    const inherited = [...overlap].map(([p, n]) => ({ ...p, share: n / p.files.length, covers: coversOf(p.round) }));
    const list = [...own, ...inherited].sort((x, y) => x.round - y.round || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
    history.set(area.id, list);
    covered.set(area.id, own.length ? 1 : area.files.length ? read / area.files.length : 0);
  }
  return { history, covered };
};

/**
 * A pass as the map draws it: the reviews' counts, Chapman's estimate of what the area held, and what is left, the
 * last two scaled by `share`, the part of the pass's files the area holds (marked when under 1).
 */
export const passOf = (round, date, a, b, shared, distinct, share = 1) => {
  const est = chapman(a, b, shared);
  const r = (n) => Math.round(n * 10) / 10;
  return {
    round, date, a, b, shared, distinct, est: r(est * share), left: Math.max(0, r((est - distinct) * share)),
    ...(share < 1 ? { share: Math.round(share * 1000) / 1000 } : {}),
  };
};

/** A recorded pass (an `area.json` with its `round` and `share`) as the map draws it. */
export const drawnPassOf = (p) => passOf(p.round, p.date, p.a ?? 0, p.b ?? 0, p.m ?? 0, p.distinct ?? 0, p.share);

/** An area's history (`inheritPasses`') by round, oldest first: `{ round, passes, covers }`, `covers` 1 where unknown. */
export const roundsIn = (list = []) => {
  const rounds = [];
  for (const p of list) {
    if (rounds.at(-1)?.round === p.round) rounds.at(-1).passes.push(p);
    else rounds.push({ round: p.round, passes: [p], covers: p.covers ?? 1 });
  }
  return rounds;
};

/**
 * The rounds an area's estimate and calibration go by: those whose passes read at least COVERED of its files, so a
 * later pass that held one boundary file of it neither stands for it nor tests it.
 */
export const coveringRounds = (list) => roundsIn(list).filter((r) => r.covers >= COVERED);

/** The round an area's estimate goes by: its last covering round, else the last of those that read the most of it. */
export const lastRoundIn = (list) => {
  const covering = coveringRounds(list);
  if (covering.length) return covering.at(-1);
  return roundsIn(list).reduce((best, r) => (!best || r.covers >= best.covers ? r : best), null);
};

const r1 = (n) => Math.round(n * 10) / 10;

/**
 * A round's passes of one area as one recorded pass: the pass itself when alone; else counts summed, Chapman's estimate
 * and what it left summed by share (so `share` is 1), and fix commits and files joined.
 */
export const combinedOf = (passes) => {
  if (passes.length <= 1) return passes[0];
  const sum = (f) => passes.reduce((n, p) => n + f(p), 0);
  return {
    ...passes[0], a: sum((p) => p.a ?? 0), b: sum((p) => p.b ?? 0), m: sum((p) => p.m ?? 0), distinct: sum((p) => p.distinct ?? 0),
    chapman: sum((p) => (p.chapman ?? 0) * (p.share ?? 1)), unfound: sum((p) => (p.unfound ?? 0) * (p.share ?? 1)), share: 1,
    fixCommits: [...new Set(passes.flatMap((p) => p.fixCommits ?? []))], files: [...new Set(passes.flatMap((p) => p.files ?? []))].sort(),
  };
};

/** A round's passes of one area as the map draws one pass: counts summed, `distinct`, `est` and `left` by share. */
export const drawnRoundOf = (passes) => {
  if (passes.length <= 1) return drawnPassOf(passes[0]);
  const drawn = passes.map(drawnPassOf);
  const sum = (f) => drawn.reduce((n, p) => n + f(p), 0);
  return {
    round: drawn[0].round, date: drawn[0].date, a: sum((p) => p.a), b: sum((p) => p.b), shared: sum((p) => p.shared),
    distinct: r1(sum((p) => p.distinct * (p.share ?? 1))), est: r1(sum((p) => p.est)), left: r1(sum((p) => p.left)),
  };
};

/** The pass an area's estimate goes by (`lastRoundIn`'s, `combinedOf`), or undefined for an area with no history. */
export const lastPassIn = (list) => {
  const r = lastRoundIn(list);
  return r && combinedOf(r.passes);
};

/** Each area's history (`inheritPasses`') as calibration reads it: its covering rounds, each drawn as one pass. */
export const drawnHistories = (history) => new Map([...history].map(([id, list]) => [id, coveringRounds(list).map((r) => drawnRoundOf(r.passes))]));

/** `calibrationOf` over each area's history (`inheritPasses`'), with `pairLines` (`areaStats`') where known. */
export const calibrationFor = (history, pairLines) => calibrationOf(drawnHistories(history), pairLines);

/** A pass's estimate and what it left, scaled by the share of its files the area holds. */
export const scaledOf = (pass) => ({ chapman: pass.chapman * (pass.share ?? 1), unfound: pass.unfound * (pass.share ?? 1) });

/**
 * The round after every number already used: round directories, the ledger's text ("round 12",
 * "rounds 28–30"), branches named for a round (`roundIn`, the config's `names.roundIn`: `audit30-ui`,
 * `batch/…-audit31`), and the rounds runs have claimed (`claimed`, numbers as strings or numbers).
 */
/** @param {{ roundDirs?: string[], hardening?: string, branches?: string[], claimed?: (string | number)[], roundIn?: RegExp }} used */
export const nextRound = ({ roundDirs = [], hardening = '', branches = [], claimed = [], roundIn = /(?:^|[/-])audit(\d+)(?:-|$)/ }) => {
  const used = [0, ...claimed.map(Number)];
  for (const name of roundDirs) {
    const m = /^round-(\d+)$/.exec(name);
    if (m) used.push(Number(m[1]));
  }
  for (const m of hardening.matchAll(/\brounds? (\d+)(?:\s*[–-]\s*(\d+))?/g)) used.push(Number(m[1]), Number(m[2] ?? 0));
  for (const name of branches) {
    const m = roundIn.exec(name);
    if (m) used.push(Number(m[1]));
  }
  return Math.max(...used) + 1;
};

const sameFiles = (a, b) => {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  const set = new Set(b);
  return a.every((f) => set.has(f));
};

/**
 * Whether an area's two latest covering rounds (`coveringRounds`, each `combinedOf` its passes) settle it: each found at
 * most QUIET_PASS distinct defects, both read the same file list as the area has now, and nothing but the passes' own
 * fixes changed those files since the first of them. `touched(files, from, exclude)` answers whether a commit after
 * `from` and not in `exclude` changed any of `files`.
 */
export const isSettled = (area, passes, touched) => {
  const rounds = coveringRounds(passes);
  if (rounds.length < 2) return false;
  const [first, last] = rounds.slice(-2).map((r) => combinedOf(r.passes));
  if (first.distinct > QUIET_PASS || last.distinct > QUIET_PASS) return false;
  if (!sameFiles(first.files, area.files) || !sameFiles(last.files, area.files)) return false;
  return !touched(area.files, first.commit, [...(first.fixCommits ?? []), ...(last.fixCommits ?? [])]);
};

/**
 * The areas an earlier round is still holding: each `audit<N>-<area>` branch not yet merged into `main`
 * (`areaOf`, the config's `names.areaOf`). Their passes are recorded only on that round's batch branch, so
 * `readPasses` cannot see them.
 */
export const areasInFlight = (unmergedBranches, areaOf = /^audit\d+-(.+)$/) =>
  new Set(unmergedBranches.flatMap((b) => areaOf.exec(b)?.[1] ?? []));

/** `areasInFlight` over the branches `cfg`'s `main` has not merged, asked of `git`: the one answer night and the map use. */
export const areasInFlightFor = (cfg, git) =>
  areasInFlight(git('for-each-ref', `--no-merged=${cfg.git.main}`, '--format=%(refname:short)', 'refs/heads').split('\n'), cfg.names.areaOf);

/**
 * Where a due area ranks: what its last pass left, corrected (`correctedLeftOf`), in whole defects, and at least 1
 * once any of its lines changed since, so a changed area with nothing left competes with one holding about one.
 */
export const rankOf = (left, stale) => Math.max(Math.round(left), stale > 0 ? 1 : 0);

/**
 * Tonight's areas: never audited first, in partition order, then the due ones by `rankOf`, then most lines changed
 * since their last pass (`staleLines`, by id), then the longest since their last pass; settled areas, and areas an
 * unlanded round still holds (`inFlight`), are skipped. An area counts as never audited when its `covered` share is
 * under COVERED. `passes` is each area's history (`inheritPasses`'); `calibration` is `calibrationFor`'s over it,
 * computed when not given. Answers `{ picked, settled }`, each a list of ids.
 */
export const pickAreas = ({ areas, passes, touched, count, inFlight = new Set(), covered = new Map(), staleLines = new Map(), calibration = calibrationFor(passes) }) => {
  const settled = [];
  const fresh = [];
  const seen = [];
  for (const area of areas) {
    if (inFlight.has(area.id)) continue;
    const history = passes.get(area.id) ?? [];
    if (history.length === 0 || (covered.get(area.id) ?? 1) < COVERED) {
      fresh.push(area.id);
      continue;
    }
    if (isSettled(area, history, touched)) {
      settled.push(area.id);
      continue;
    }
    const last = lastRoundIn(history);
    const stale = staleLines.get(area.id) ?? 0;
    const left = correctedLeftOf(drawnRoundOf(last.passes), calibration);
    seen.push({ id: area.id, last: last.round, stale, rank: rankOf(left, stale) });
  }
  seen.sort((x, y) => y.rank - x.rank || y.stale - x.stale || x.last - y.last || (x.id < y.id ? -1 : 1));
  return { picked: [...fresh, ...seen.map((s) => s.id)].slice(0, count), settled };
};

/** A `touched` for `isSettled` that asks git. */
export const gitTouched = (git) => (files, from, exclude) => {
  if (files.length === 0) return false;
  let out;
  try {
    out = git('log', '--no-merges', '--format=%H', `${from}..HEAD`, '--', ...files);
  } catch {
    return true;
  }
  const skip = new Set(exclude);
  return out.split('\n').some((sha) => sha && !skip.has(sha));
};

/**
 * What the plan and the map read of each area's past for `cfg`'s project: its inherited `history` and `covered`
 * share (`inheritPasses`), `staleLines`, the lines of its files changed since its last pass (`lastPassIn`), its fixes
 * aside, and `pairLines`, keyed `<area>\n<round>`, the lines of its files changed from each covering round to the next,
 * that round's fixes aside: what changed since the first less what changed since the second.
 */
export const areaStats = (cfg, git, areas, raw, root) => {
  const { history, covered } = inheritPasses(areas, raw);
  const entries = [];
  const pairs = [];
  for (const area of areas) {
    const list = history.get(area.id) ?? [];
    const last = lastPassIn(list);
    if (last?.commit) entries.push({ id: area.id, files: area.files, commit: last.commit, exclude: last.fixCommits ?? [] });
    const rounds = coveringRounds(list).map((r) => combinedOf(r.passes));
    rounds.forEach((k, i) => {
      const next = rounds[i + 1];
      if (!next || !k.commit || !next.commit) return;
      const key = `${area.id}\n${k.round}`;
      pairs.push(key);
      entries.push({ id: `${key}\nfrom`, files: area.files, commit: k.commit, exclude: k.fixCommits ?? [] });
      entries.push({ id: `${key}\nto`, files: area.files, commit: next.commit, exclude: [] });
    });
  }
  const lines = churnSince(git, entries, { keep: cfg.partition.isSource, cacheKey: cfg.partition.sourceKey, cacheFile: churnCacheOf(cfg.name), root });
  const staleLines = new Map(areas.flatMap((a) => (lines.has(a.id) ? [[a.id, lines.get(a.id)]] : [])));
  const pairLines = new Map(pairs.map((key) => [key, Math.max(0, lines.get(`${key}\nfrom`) - lines.get(`${key}\nto`))]));
  return { history, covered, staleLines, pairLines };
};
