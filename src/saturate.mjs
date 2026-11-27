/**
 * `skulkr scour` (alias `sat`): repeated blind reviews of one area at one frozen commit, folded into a ledger of
 * distinct defects until capture–recapture says the area is saturated. README "Scour" is its documentation.
 *
 *   skulkr scour next <area> [--agent <id>] [--metered] [--release] [--max N] [--per-defect $] [--at <sha>]
 *   skulkr scour [delve] <area> [--fleet] [--account <dir>] [--metered] [--sources claude,codex] [--max N] [--per-defect $] [--usd $] [--at <sha>] [--fresh]
 *   skulkr scour run [areas…] [--fleet] [--account <dir>] [--metered] [--by finish|cheapest|spread] [--usd $] [--passes N] [--per-defect $]
 *   skulkr scour fold <area>
 *   skulkr scour ingest <area> <report.md> --source <name> [--at <sha>]
 *   skulkr scour import <area> <dir> --at <sha> [--fresh]
 *   skulkr scour fix <area> [--dry] [--batch k,…] [--defects D1,…] [--on <ref>] [--ready] | --queue [--lanes N] [--ready]
 *   skulkr scour queue add|drop <area>… | ls
 *   skulkr scour land <area>… | --all
 *   skulkr scour ls [--json]
 *   skulkr scour report <area>
 *   skulkr scour rm <area>
 */
import { flagDefects } from './scourFlags.mjs';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { addWorktree, gitIn, removeWorktree } from './batch.mjs';
import {
  emptyLedger, freezeCommitOf, keepReview, ledgerDirOf, ledgerOf, removeLedger, requireAreaFilesAt, requireSameCommit, withLedgerHeld, writeLedger,
} from './ledger.mjs';
import { loggingSay, withJobProgress } from './delveLive.mjs';
import { takeLease } from './lease.mjs';
import { importLedger } from './saturateImport.mjs';
import { landableIdsOf, landLedgers } from './saturateLand.mjs';
import { ledgerListLines, ledgerListOf, scourQueueIn, scouredAreasOf } from './saturationList.mjs';
import { moveFormerScourState } from './scourPaths.mjs';
import { chao2, stopReason } from './saturation.mjs';
import { limitSpecOf, nextPriceOf, scourRuleOf } from './scourPrice.mjs';
import { ledgerLinesOf } from './scourLines.mjs';
import { scourRun } from './scourRun.mjs';
import { scourFix } from './scourFix.mjs';
import { drainFixQueue, fixQueueIn, fixQueueLines, fixQueueOf, withDropped, withQueued, writeFixQueue } from './scourFixQueue.mjs';
import { writeReport } from './saturationReport.mjs';
import { createSaturateContext, occasionJobsOf, requireSources, runReview } from './saturateJobs.mjs';
import { foldPending, stageReport } from './scourFold.mjs';
import { nextLines, scourNext } from './scourSession.mjs';

export const SATURATE_USAGE = 'usage: skulkr scour next <area> [--agent <id>] [--metered] [--release] [--max N] [--per-defect $] [--at <sha>] | [delve] <area> [--fleet] [--account <config dir>] [--metered] [--sources claude,codex] [--max N] [--per-defect $] [--usd $] [--at <sha>] [--fresh] | run [areas…] [--fleet] [--account <config dir>] [--metered] [--by finish|cheapest|spread] [--usd $] [--passes N] [--per-defect $] | fold <area> | ingest <area> <report.md> --source <name> [--at <sha>] | import <area> <dir> --at <sha> [--fresh] | fix <area> [--dry] [--batch k,…] [--defects D1,…] [--on <ref>] [--ready] | fix --queue [--lanes N] [--ready] | queue add|drop <area>… | queue ls | flag <area> <ids…> [--clear] | land <area>… | land --all | ls [--json] | ls --source <name> --ids | report <area> | rm <area>';

/** `argv`'s positional words and flags. */
export const saturateArgsOf = (cfg, argv) => {
  const flags = {};
  const words = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--fresh' || a === '--all' || a === '--json' || a === '--ids' || a === '--metered' || a === '--release' || a === '--dry' || a === '--clear' || a === '--queue' || a === '--ready') flags[a.slice(2)] = true;
    else if (a.startsWith('--')) flags[a.slice(2)] = argv[++i];
    else words.push(a);
  }
  const max = flags.max === undefined ? cfg.saturate.max : Number(flags.max);
  if (!Number.isInteger(max) || max < 1) throw new Error(`--max wants a whole number of occasions, not ${flags.max}`);
  const sources = flags.sources ? flags.sources.split(',').map((s) => s.trim()).filter(Boolean) : cfg.saturate.sources;
  const dollars = (name) => {
    if (flags[name] === undefined) return undefined;
    const n = Number(flags[name].replace(/^\$/, ''));
    if (!(n > 0)) throw new Error(`--${name} wants an amount in dollars, not ${flags[name]}`);
    return n;
  };
  const passes = flags.passes === undefined ? undefined : Number(flags.passes);
  if (passes !== undefined && (!Number.isInteger(passes) || passes < 1)) throw new Error(`--passes wants a whole number, not ${flags.passes}`);
  return {
    words, max, sources, fresh: Boolean(flags.fresh), all: Boolean(flags.all), json: Boolean(flags.json), ids: Boolean(flags.ids), source: flags.source, at: flags.at, agent: flags.agent, metered: Boolean(flags.metered), release: Boolean(flags.release), account: flags.account, dry: Boolean(flags.dry), clear: Boolean(flags.clear), batch: flags.batch, defects: flags.defects, on: flags.on, queue: Boolean(flags.queue), ready: Boolean(flags.ready), lanes: flags.lanes,
    usd: dollars('usd'), perDefect: flags['per-defect'] === undefined ? undefined : (limitSpecOf(flags['per-defect']), flags['per-defect']), passes, by: flags.by,
  };
};

const pad = (n) => String(n).padStart(2, '0');

/**
 * The area's ledger and a frozen worktree of its commit, held by this process alone, then `work` run with them; the
 * worktree and the hold are let go however it ends. An existing ledger resumes at its own commit, wherever `main` has
 * gone since, unless `at` names another commit, which is refused; with `fresh`, it is moved aside to `<area>.<commit>`.
 * A new ledger freezes at `at`, else `main`'s tip. `about` goes on the hold's lease, and `work`'s `say` also writes the
 * ledger's `scour.log`.
 */
const withFrozen = async (cfg, root, id, { fresh, at, about, say }, work) => withLedgerHeld(cfg, id, { fresh, about }, async (held) => {
  const logged = loggingSay(cfg, id, say);
  const git = gitIn(root);
  const wanted = at === undefined ? undefined : freezeCommitOf(cfg, root, at);
  requireSameCommit(held, at, wanted);
  let ledger = held;
  if (!ledger) {
    const commit = wanted ?? freezeCommitOf(cfg, root);
    ledger = emptyLedger(id, commit, requireAreaFilesAt(cfg, root, id, commit));
  }
  if (ledger.lines === undefined) ledger = { ...ledger, lines: ledgerLinesOf(cfg, root, ledger, id) };
  const { commit } = ledger;
  const frozen = addWorktree(root, `${cfg.naming.prefix}-saturate-${id}`, commit);
  try {
    let base = commit;
    try {
      base = git('merge-base', commit, `${cfg.git.remote}/${cfg.git.main}`);
    } catch { /* no remote: the commit is its own base */ }
    return await work({ ledger, frozen, base, commit, say: logged });
  } finally {
    removeWorktree(root, frozen);
  }
});

const spentOn = (ledger) => ledger.occasions.reduce((sum, o) => sum + (o.costUsd ?? 0), 0);

/**
 * Reviews `id` until the stop rule holds, one review per source an iteration, or for `args.passes` iterations at most.
 * `args.usd` caps what this call spends. Answers the ledger.
 */
export const saturateArea = async (cfg, runner, root, id, args, tell) => {
  requireSources(cfg, args.sources);
  // The going rate moves as passes land, so the rule is priced again before each use.
  const ruleNow = () => scourRuleOf(cfg, root, args);
  return withFrozen(cfg, root, id, { ...args, about: { does: 'delve', max: args.max }, say: tell }, async ({ ledger: start, frozen, base, commit, say }) => {
    let ledger = start;
    writeLedger(cfg, ledger);
    say(`saturate ${id} at ${commit.slice(0, 10)}: ${ledger.files.length} files, ${ledger.occasions.length} occasions so far, sources ${args.sources.join(', ')}`);
    const ctx = createSaturateContext({ cfg, runner, frozen, base, commit, area: id, say });
    const area = { id, files: ledger.files };
    ledger = await foldPending(ctx, ledger, ruleNow);
    const startUsd = spentOn(ledger);
    for (let pass = 0; ; pass++) {
      const rule = ruleNow();
      const price = nextPriceOf(ledger, rule.factor);
      const stop = stopReason(chao2(ledger.occasions, ledger.defects), rule, { price, spentUsd: spentOn(ledger) - startUsd, lines: ledger.lines });
      if (stop) {
        say(`saturate ${id}: stopped, ${stop}`);
        break;
      }
      if (args.passes !== undefined && pass >= args.passes) break;
      const batch = args.sources.slice(0, rule.max - ledger.occasions.length);
      const at = ledger.occasions.length;
      const keys = batch.map((source, i) => `${pad(at + 1 + i)}-${source}`);
      const reviews = await Promise.all(batch.map((source, i) => runReview(ctx, area, keys[i], source)));
      let finished = 0;
      for (const [i, r] of reviews.entries()) {
        if (!r.finished) {
          keepReview(cfg, id, `unfinished-${keys[i]}-${Date.now()}`, batch[i], r.text);
          rmSync(occasionJobsOf(cfg, id, keys[i]), { recursive: true, force: true });
          say(`saturate ${id}: the ${batch[i]} review ${keys[i]} never finished; not counted`);
          continue;
        }
        ledger = stageReport(cfg, ledger, { key: keys[i], source: batch[i], kind: 'review', text: r.text, findings: r.findings, costUsd: r.costUsd, minutes: r.minutes });
        finished += 1;
      }
      ledger = await foldPending(ctx, ledger, ruleNow);
      if (ctx.metered) {
        throw new Error(`saturate ${id}: a job wrote only five-minute cache, the sign of usage overage, which is metered; stopping (--metered runs anyway)`);
      }
      if (finished === 0) throw new Error(`saturate ${id}: no review of this iteration finished; stopping`);
    }
    say(`saturate ${id}: report at ${writeReport(cfg, id, ledger, ruleNow())}`);
    return ledger;
  });
};

/** Folds an externally written report into `id`'s ledger as one occasion. Answers the ledger. */
export const ingestReport = async (cfg, runner, root, id, path, source, args, tell) => {
  if (!source) throw new Error('ingest wants --source <name>: who wrote the report');
  if (!existsSync(path)) throw new Error(`no report at ${path}`);
  const text = readFileSync(path, 'utf8');
  return withFrozen(cfg, root, id, { fresh: false, at: args.at, about: { does: 'ingest' }, say: tell }, async ({ ledger, frozen, base, commit, say }) => {
    const ctx = createSaturateContext({ cfg, runner, frozen, base, commit, area: id, say });
    const key = `${pad(ledger.occasions.length + (ledger.unfolded?.length ?? 0) + 1)}-${source}`;
    const next = await foldPending(ctx, stageReport(cfg, ledger, { key, source, kind: 'ingest', text, findings: [], costUsd: 0, minutes: 0 }), () => scourRuleOf(cfg, root, args));
    say(`saturate ${id}: report at ${writeReport(cfg, id, next, scourRuleOf(cfg, root, args))}`);
    return next;
  });
};

/** Folds `id`'s unfolded reports into its ledger, as after a matcher failure. Answers the ledger. */
export const foldReports = async (cfg, runner, root, id, args, tell) => {
  if (!ledgerOf(cfg, id)) throw new Error(`${id} has no scour ledger`);
  return withFrozen(cfg, root, id, { fresh: false, about: { does: 'fold' }, say: tell }, async ({ ledger, frozen, base, commit, say }) => {
    if (!ledger.unfolded?.length) {
      say(`fold ${id}: nothing to fold`);
      return ledger;
    }
    const ctx = createSaturateContext({ cfg, runner, frozen, base, commit, area: id, say });
    return foldPending(ctx, ledger, () => scourRuleOf(cfg, root, args));
  });
};

/**
 * Throws unless Claude's reviews may run as `claude -p` jobs: only in fleet mode, since session mode gives them to the
 * running session's subagents (README "Scour", 2026-11-26).
 */
/**
 * `cfg` as scour runs its jobs on this machine: each `claude -p` as `account`, else as whichever account started the
 * run (its `CLAUDE_CONFIG_DIR`, else Claude Code's default), never the config's own `claude.configDir`; on Claude Code's
 * own cache lifetime, so a job's cache writes show whether it ran on plan usage; and watched for metered usage
 * unless `metered` allows it (README "Local mode", 2026-11-26).
 * @param {any} cfg @param {{ account?: string, metered?: boolean }} [opts] @param {Record<string, string | undefined>} [env]
 */
export const localScourConfigOf = (cfg, { account, metered = false } = {}, env = process.env) => ({
  ...cfg,
  claude: { ...cfg.claude, configDir: account ?? env.CLAUDE_CONFIG_DIR, cacheTtl: { ...cfg.claude.cacheTtl, review: undefined, match: undefined } },
  saturate: { ...cfg.saturate, guardMetered: !metered },
});

/** Each running task's progress as `runner` answers it; none where it cannot. */
const progressNow = (runner) => {
  try { return runner.progress?.() ?? new Map(); } catch { return new Map(); }
};

/**
 * `skulkr scour …`; each line it prints goes to `say`. With `fleet`, its jobs go through `runner` as the config
 * says; without, they run on this machine as `localScourConfigOf` says.
 */
export const saturateCommand = async (cfg0, runner, root, argv, say = (line) => console.log(line), { fleet = true, env = process.env } = {}) => {
  const args = saturateArgsOf(cfg0, argv);
  const cfg = fleet ? cfg0 : localScourConfigOf(cfg0, args, env);
  const [first, ...rest] = args.words;
  if (!first) throw new Error(SATURATE_USAGE);
  moveFormerScourState(cfg);
  if (first === 'next') {
    if (!rest[0]) throw new Error(SATURATE_USAGE);
    const step = await scourNext(cfg, root, rest[0], args, say);
    for (const line of nextLines(rest[0], step)) say(line);
    return step;
  }
  if (first === 'ingest') {
    const [id, path] = rest;
    if (!id || !path) throw new Error(SATURATE_USAGE);
    return ingestReport(cfg, runner, root, id, path, args.source, args, say);
  }
  if (first === 'import') {
    const [id, dir] = rest;
    if (!id || !dir) throw new Error(SATURATE_USAGE);
    return importLedger(cfg, root, id, dir, args, say);
  }
  if (first === 'fix' && args.queue) {
    const lanes = args.lanes === undefined ? 1 : Number(args.lanes);
    if (!Number.isInteger(lanes) || lanes < 1) throw new Error(`--lanes wants a whole number of fix runs, not ${args.lanes}`);
    return drainFixQueue(cfg, { lanes, ready: args.ready, root, say });
  }
  if (first === 'queue') {
    const [verb, ...ids] = rest;
    if (verb === 'add' || verb === 'drop') {
      if (ids.length === 0) throw new Error(SATURATE_USAGE);
      const missing = verb === 'add' ? ids.filter((id) => !ledgerOf(cfg, id)) : [];
      if (missing.length) throw new Error(`no scour ledger for ${missing.join(', ')}`);
      writeFixQueue(cfg, verb === 'add' ? withQueued(fixQueueOf(cfg), ids) : withDropped(fixQueueOf(cfg), ids));
    } else if (verb !== 'ls' && verb !== undefined) throw new Error(SATURATE_USAGE);
    const rows = fixQueueIn(cfg, withJobProgress(ledgerListOf(cfg, root), progressNow(runner)));
    for (const line of fixQueueLines(rows)) say(line);
    return rows;
  }
  if (first === 'fix') {
    if (!rest[0]) throw new Error(SATURATE_USAGE);
    // A local fix run is the local runner's: its verify and its fixers' checks go to the fleet (`checksOnFleet`).
    return scourFix(fleet ? cfg : { ...cfg, runner: 'local' }, runner, root, rest[0], args, say);
  }
  if (first === 'flag') {
    const [id, ...ids] = rest;
    const ledger = id ? ledgerOf(cfg, id) : null;
    if (!id || !ids.length) throw new Error(SATURATE_USAGE);
    if (!ledger) throw new Error(`${id} has no scour ledger`);
    return flagDefects(cfg, ledger, ids, args.clear, say);
  }
  if (first === 'land') {
    const ids = args.all ? landableIdsOf(cfg) : rest;
    if (ids.length === 0 && !args.all) throw new Error(SATURATE_USAGE);
    say(await landLedgers(cfg, root, ids, say));
    return ids.map((id) => ledgerOf(cfg, id));
  }
  if (first === 'ls' && args.ids) {
    const ids = scouredAreasOf(cfg, root, args.source);
    for (const id of ids) say(id);
    return ids;
  }
  if (first === 'ls') {
    const read = ledgerListOf(cfg, root);
    const list = args.json ? withJobProgress(read, read.some((l) => l.running?.jobs.length) ? progressNow(runner) : new Map()) : read;
    if (args.json) say(JSON.stringify({ ledgers: list, queue: scourQueueIn(cfg, root, list), fixQueue: fixQueueIn(cfg, list), asOf: new Date().toISOString() }));
    else for (const line of ledgerListLines(list)) say(line);
    return list;
  }
  if (first === 'report') {
    const ledger = rest[0] && ledgerOf(cfg, rest[0]);
    if (!ledger) throw new Error(rest[0] ? `${rest[0]} has no saturation ledger` : SATURATE_USAGE);
    say(`wrote ${writeReport(cfg, rest[0], ledger, scourRuleOf(cfg, root, args))}`);
    return ledger;
  }
  if (first === 'rm') {
    if (!rest[0]) throw new Error(SATURATE_USAGE);
    if (!existsSync(ledgerDirOf(cfg, rest[0]))) {
      say(`${rest[0]} has no saturation ledger`);
      return undefined;
    }
    if (!takeLease(join(ledgerDirOf(cfg, rest[0]), 'lock'), {})) throw new Error(`another skulkr scour is working on ${rest[0]}`);
    removeLedger(cfg, rest[0]);
    say(`removed ${rest[0]}'s saturation ledger`);
    return undefined;
  }
  if (first === 'run') return scourRun(cfg, runner, root, { ...args, words: rest }, say);
  if (first === 'fold') {
    if (!rest[0]) throw new Error(SATURATE_USAGE);
    return foldReports(cfg, runner, root, rest[0], args, say);
  }
  if (first === 'delve' && !rest[0]) throw new Error(SATURATE_USAGE);
  return saturateArea(cfg, runner, root, first === 'delve' ? rest[0] : first, args, say);
};
