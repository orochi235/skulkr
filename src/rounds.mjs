/**
 * What earlier rounds left on disk, and what that says about tonight. Nothing here keeps its own
 * ledger: an area's history is the `<record.dir>/round-<N>/<area>/area.json` files that name it.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
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
      if (pass.incomplete?.length) continue;
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
      if (pass.incomplete?.length) continue;
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
 * split one passes each part its share. A pass with no file list goes to the area of its own id, whole. `raw` is
 * `readPasses`'. Answers `{ history, covered }`: Maps by area id of its passes oldest first, and the share of its files
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
    let read = 0;
    for (const f of area.files) {
      const passes = byFile.get(f);
      if (!passes) continue;
      read += 1;
      for (const p of passes) overlap.set(p, (overlap.get(p) ?? 0) + 1);
    }
    const own = (unlisted.get(area.id) ?? []).map((p) => ({ ...p, share: 1 }));
    const inherited = [...overlap].map(([p, n]) => ({ ...p, share: n / p.files.length }));
    const list = [...own, ...inherited].sort((x, y) => x.round - y.round || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
    history.set(area.id, list);
    covered.set(area.id, own.length ? 1 : area.files.length ? read / area.files.length : 0);
  }
  return { history, covered };
};

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

const sameFiles = (a, b) => a.length === b.length && a.every((f, i) => f === b[i]);

/**
 * Whether an area's two latest passes settle it: each found at most QUIET_PASS distinct defects, both
 * read the same file list as the area has now, and nothing but the passes' own fixes changed those
 * files since the first of them. `touched(files, from, exclude)` answers whether a commit after
 * `from` and not in `exclude` changed any of `files`.
 */
export const isSettled = (area, passes, touched) => {
  if (passes.length < 2) return false;
  const [first, last] = passes.slice(-2);
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

/**
 * Tonight's areas: never audited first, in partition order, then the due ones, most lines changed since their last
 * pass first (`staleLines`, by id), then the longest since their last pass; settled areas, and areas an unlanded
 * round still holds (`inFlight`), are skipped. An area counts as never audited when its `covered` share is under
 * COVERED. `passes` is each area's history (`inheritPasses`'). Answers `{ picked, settled }`, each a list of ids.
 */
export const pickAreas = ({ areas, passes, touched, count, inFlight = new Set(), covered = new Map(), staleLines = new Map() }) => {
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
    if (isSettled(area, history, touched)) settled.push(area.id);
    else seen.push({ id: area.id, last: history.at(-1).round, stale: staleLines.get(area.id) ?? 0 });
  }
  seen.sort((x, y) => y.stale - x.stale || x.last - y.last || (x.id < y.id ? -1 : 1));
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
 * share (`inheritPasses`), and `staleLines`, the lines of its files changed since its last pass, its fixes aside.
 */
export const areaStats = (cfg, git, areas, raw, root) => {
  const { history, covered } = inheritPasses(areas, raw);
  const entries = areas.flatMap((area) => {
    const last = history.get(area.id)?.at(-1);
    return last?.commit ? [{ id: area.id, files: area.files, commit: last.commit, exclude: last.fixCommits ?? [] }] : [];
  });
  const staleLines = churnSince(git, entries, { keep: cfg.partition.isSource, cacheFile: churnCacheOf(cfg.name), root });
  return { history, covered, staleLines };
};
