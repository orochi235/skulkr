/**
 * What earlier rounds left on disk, and what that says about tonight. Nothing here keeps its own
 * ledger: an area's history is the `<record.dir>/round-<N>/<area>/area.json` files that name it.
 */
import { calibrationOf, correctedLeftOf } from './calibration.mjs';
import { churnCacheOf, churnSince } from './churn.mjs';
import { fixTallyOf } from './findings.mjs';
import { ROUND_DIR, diskRecords, recordsFor } from './recordFiles.mjs';

/** A pass that found at most this many distinct defects counts toward settling its area. */
export const QUIET_PASS = 1;

/** Chapman's estimate of how many defects the area held, from two lists of `a` and `b` sharing `m`. */
export const chapman = (a, b, m) => (a + 1) * (b + 1) / (m + 1) - 1;

/**
 * A record's pass (`recordFiles.mjs`): its `area.json` with its `round`, and its `files.txt` where that lists no files;
 * `unmerged` when it is read from a batch `main` has not merged; `fixed`, the defects its fixer's `fix.md` says it
 * fixed, listed or extra (`fixTallyOf`), where it has one that gives a verdict.
 */
const passOfRecord = (rec) => {
  const pass = { round: rec.round, ...JSON.parse(rec.read('area.json')), ...(rec.ref ? { unmerged: true } : {}) };
  const listed = Array.isArray(pass.files) ? null : rec.read('files.txt');
  if (listed !== null) pass.files = listed.split('\n').filter(Boolean);
  const report = rec.read('fix.md');
  const tally = report === null ? null : fixTallyOf(report);
  if (tally) pass.fixed = tally.fixed + (tally.extra ?? 0);
  return pass;
};

/**
 * Each record's pass (`recordFiles.mjs`' records) by area id, oldest first. A pass a reviewer never ran or never
 * finished is no pass, nor is a fix-only round's: the area comes back as if it had not been audited.
 */
export const passesFrom = (records) => {
  const passes = new Map();
  for (const rec of records) {
    const pass = passOfRecord(rec);
    if (pass.incomplete?.length || pass.fixOnly) continue;
    if (!passes.has(pass.id)) passes.set(pass.id, []);
    passes.get(pass.id).push(pass);
  }
  for (const list of passes.values()) list.sort((x, y) => x.round - y.round);
  return passes;
};

/** Every pass on disk under `recordDir` (the config's `record.dir`), by area id, oldest first. */
export const readPasses = (root, recordDir) => passesFrom(diskRecords(root, recordDir));

/** Every pass the project holds: on disk, and on the batches `main` has not merged (`recordsFor`). */
export const passesIn = (cfg, git, root, records = recordsFor(cfg, git, root)) => passesFrom(records);

/** How many areas each round of `records` recorded incomplete, by round: passes `passesFrom` leaves out. */
export const incompleteByRound = (records) => {
  const counts = new Map();
  for (const rec of records) {
    if (JSON.parse(rec.read('area.json')).incomplete?.length) counts.set(rec.round, (counts.get(rec.round) ?? 0) + 1);
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
 * carries `covers`, the part of the area's files its round's passes read together. `raw` is `passesFrom`'. Answers `{ history, covered }`: Maps by area id of its passes oldest first, and the share of its files
 * any of them read.
 */
/** @param {{ id: string, files: string[] }[]} areas @param {Map<string, any[]>} raw @returns {{ history: Map<string, any[]>, covered: Map<string, number> }} */
export const inheritPasses = (areas, raw) => {
  const byFile = new Map();
  const unlisted = new Map();
  for (const pass of [...raw.values()].flat()) {
    if (!pass.files?.length) {
      if (!unlisted.has(pass.id)) unlisted.set(pass.id, []);
      unlisted.get(pass.id).push(pass);
      continue;
    }
    for (const f of pass.files) {
      if (!byFile.has(f)) byFile.set(f, []);
      byFile.get(f).push(pass);
    }
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

/** A recorded pass (an `area.json` with its `round` and `share`) as the map draws it, with its `fixed` where known. */
export const drawnPassOf = (p) => ({
  ...passOf(p.round, p.date, p.a ?? 0, p.b ?? 0, p.m ?? 0, p.distinct ?? 0, p.share),
  ...(p.fixed !== undefined ? { fixed: p.fixed } : {}),
});

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
    ...(drawn.some((p) => p.fixed !== undefined) ? { fixed: r1(sum((p) => (p.fixed ?? 0) * (p.share ?? 1))) } : {}),
  };
};

/** The pass an area's estimate goes by (`lastRoundIn`'s, `combinedOf`), or undefined for an area with no history. */
export const lastPassIn = (list) => {
  const r = lastRoundIn(list);
  return r && combinedOf(r.passes);
};

/**
 * The pass an area's estimate goes by as the queue and the map read it: `lastRoundIn`'s round drawn as one pass
 * (`drawnRoundOf`), its left corrected by `calibration` (`leftCorrected`); undefined for an area with no history.
 */
export const lastDrawnPassIn = (list, calibration) => {
  const r = lastRoundIn(list ?? []);
  if (!r) return undefined;
  const pass = drawnRoundOf(r.passes);
  return { ...pass, leftCorrected: correctedLeftOf(pass, calibration) };
};

/**
 * What `lastDrawnPassIn` said of an area after each past round, for the dashboard's view of an earlier round: one
 * `{ round, left, leftCorrected }` per round the answer changed, oldest first, `leftCorrected` left out where it equals
 * `left`, and `pass` naming the round the answer comes from where that is an earlier one. Rounds before passes had
 * read COVERED of `files` (the area's files now) give none, the area counting as never audited then. Every entry uses
 * today's `calibration`.
 */
export const lastByRoundIn = (list, files, calibration) => {
  const mine = new Set(files);
  const read = new Set();
  let whole = false;
  let shown = null;
  const entries = [];
  for (const r of roundsIn(list ?? [])) {
    for (const p of r.passes) {
      if (!p.files?.length) whole = true;
      else for (const f of p.files) if (mine.has(f)) read.add(f);
    }
    if (!whole && (files.length ? read.size / files.length : 0) < COVERED) continue;
    const pass = lastDrawnPassIn(list.filter((p) => p.round <= r.round), calibration);
    if (pass.round === shown) continue;
    shown = pass.round;
    entries.push({ round: r.round, ...(pass.round !== r.round ? { pass: pass.round } : {}), left: pass.left, ...(pass.leftCorrected !== pass.left ? { leftCorrected: pass.leftCorrected } : {}) });
  }
  return entries;
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
export const nextRound = ({ roundDirs = [], hardening = '', branches = [], claimed = [], roundIn }) => {
  const used = [0, ...claimed.map(Number)];
  for (const name of roundDirs) {
    const m = ROUND_DIR.exec(name);
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
  const quiet = settlingOf(passes);
  if (!quiet) return false;
  const { first, last, from, exclude } = quiet;
  if (first.distinct > QUIET_PASS || last.distinct > QUIET_PASS) return false;
  if (!sameFiles(first.files, area.files) || !sameFiles(last.files, area.files)) return false;
  return !touched(area.files, from, exclude);
};

/**
 * The two latest covering rounds `isSettled` weighs, each `combinedOf` its passes, with the range it asks `touched`
 * about: from the first's commit, both rounds' fixes aside. Undefined for an area with fewer than two.
 */
export const settlingOf = (passes) => {
  const rounds = coveringRounds(passes);
  if (rounds.length < 2) return undefined;
  const [first, last] = rounds.slice(-2).map((r) => combinedOf(r.passes));
  return { first, last, from: first.commit, exclude: [...(first.fixCommits ?? []), ...(last.fixCommits ?? [])] };
};

/**
 * The areas an earlier round is still holding: each `audit<N>-<area>` branch not yet merged into `main`
 * (`branchOf`, the config's `names.branchOf`). Their passes are recorded only on that round's batch branch, so
 * `readPasses` cannot see them.
 */
export const areasInFlight = (unmergedBranches, branchOf) =>
  new Set(unmergedBranches.flatMap((b) => branchOf(b)?.id ?? []));

/** `areasInFlight` over the branches `cfg`'s `main` has not merged, asked of `git`: the one answer night and the map use. */
export const areasInFlightFor = (cfg, git) =>
  areasInFlight(git('for-each-ref', `--no-merged=${cfg.git.main}`, '--format=%(refname:short)', 'refs/heads').split('\n'), cfg.names.branchOf);

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
    const last = lastDrawnPassIn(history, calibration);
    const stale = staleLines.get(area.id) ?? 0;
    seen.push({ id: area.id, last: last.round, stale, rank: rankOf(last.leftCorrected, stale) });
  }
  seen.sort((x, y) => y.rank - x.rank || y.stale - x.stale || x.last - y.last || (x.id < y.id ? -1 : 1));
  return { picked: [...fresh, ...seen.map((s) => s.id)].slice(0, count), settled };
};

/** What `churnSince` takes for `cfg`'s project at `root`: its source filter, and the cache kept under it. */
export const churnOptionsFor = (cfg, root) => ({ keep: cfg.partition.isSource, cacheKey: cfg.partition.sourceKey, cacheFile: churnCacheOf(cfg.name), root });

/**
 * The files of `files` some commit after `from`, other than `exclude`, changed (`churnSince`'s `touched`), asked of
 * `cfg`'s project at `root` now. Leaves the churn cache's older commits in place. Throws when git does not know `from`.
 */
export const changedSince = (cfg, git, root, files, from, exclude) => {
  if (!from || files.length === 0) return [];
  const { touched } = churnSince(git, [{ id: 'asked', files, commit: from, exclude }], { ...churnOptionsFor(cfg, root), prune: false });
  const changed = touched.get('asked');
  if (!changed) throw new Error(`git does not know ${from}, the commit of the last pass of ${files[0]}'s area`);
  return changed;
};

const touchedKey = (files, from, exclude) => JSON.stringify([from ?? null, exclude, files]);

/**
 * What the plan and the map read of each area's past for `cfg`'s project: its inherited `history` and `covered`
 * share (`inheritPasses`), `staleLines`, the lines of its files changed since its last pass (`lastPassIn`), its fixes
 * aside, `pairLines`, keyed `<area>\n<round>`, the lines of its files changed from each covering round to the next,
 * that round's fixes aside: what changed since the first less what changed since the second, and `touched`, the
 * answer `isSettled` asks of each area (`settlingOf`), true where git does not know the commit.
 */
export const areaStats = (cfg, git, areas, raw, root) => {
  const { history, covered } = inheritPasses(areas, raw);
  const entries = [];
  const pairs = [];
  const settling = new Map();
  for (const area of areas) {
    const list = history.get(area.id) ?? [];
    const last = lastPassIn(list);
    if (last?.commit) entries.push({ id: area.id, files: area.files, commit: last.commit, exclude: last.fixCommits ?? [] });
    const quiet = settlingOf(list);
    if (quiet) {
      const id = `${area.id}\nsettle`;
      settling.set(touchedKey(area.files, quiet.from, quiet.exclude), id);
      entries.push({ id, files: area.files, commit: quiet.from, exclude: quiet.exclude });
    }
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
  const { lines, touched: changed } = churnSince(git, entries, churnOptionsFor(cfg, root));
  const staleLines = new Map(areas.flatMap((a) => (lines.has(a.id) ? [[a.id, lines.get(a.id)]] : [])));
  const pairLines = new Map(pairs.map((key) => [key, Math.max(0, lines.get(`${key}\nfrom`) - lines.get(`${key}\nto`))]));
  /** @type {(files: string[], from: string, exclude: string[]) => boolean} */
  const touched = (files, from, exclude) => {
    if (files.length === 0) return false;
    const id = settling.get(touchedKey(files, from, exclude));
    if (id === undefined) throw new Error(`areaStats: touched asked of a range it did not walk (from ${from})`);
    const paths = changed.get(id);
    return !paths || paths.length > 0;
  };
  return { history, covered, staleLines, pairLines, touched };
};
