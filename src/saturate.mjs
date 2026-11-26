/**
 * `skulkr scour` (alias `sat`): repeated blind reviews of one area at one frozen commit, folded into a ledger of
 * distinct defects until capture–recapture says the area is saturated. README "Scour" is its documentation.
 *
 *   skulkr scour [delve] <area> [--sources claude,codex] [--max N] [--per-defect $] [--usd $] [--at <sha>] [--fresh]
 *   skulkr scour run [areas…] [--by finish|cheapest|spread] [--usd $] [--passes N] [--per-defect $]
 *   skulkr scour fold <area>
 *   skulkr scour ingest <area> <report.md> --source <name> [--at <sha>]
 *   skulkr scour import <area> <dir> --at <sha> [--fresh]
 *   skulkr scour land <area>… | --all
 *   skulkr scour ls [--json]
 *   skulkr scour report <area>
 *   skulkr scour rm <area>
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { addWorktree, gitIn, removeWorktree } from './batch.mjs';
import {
  allNew, emptyLedger, freezeCommitOf, keepReview, ledgerDirOf, ledgerOf, removeLedger, requireAreaFilesAt, requireSameCommit, withLedgerHeld,
  withOccasion, writeLedger,
} from './ledger.mjs';
import { loggingSay } from './delveLive.mjs';
import { takeLease } from './lease.mjs';
import { importLedger } from './saturateImport.mjs';
import { landableIdsOf, landLedgers } from './saturateLand.mjs';
import { ledgerListLines, ledgerListOf, scouredAreasOf } from './saturationList.mjs';
import { moveFormerScourState } from './scourPaths.mjs';
import { chao2, stopReason, yieldRows } from './saturation.mjs';
import { nextPriceOf, scourRuleOf } from './scourPrice.mjs';
import { ledgerLinesOf } from './scourLines.mjs';
import { scourRun } from './scourRun.mjs';
import { writeReport } from './saturationReport.mjs';
import { createSaturateContext, matchReport, occasionJobsOf, requireSources, runReview } from './saturateJobs.mjs';

export const SATURATE_USAGE = 'usage: skulkr scour [delve] <area> [--sources claude,codex] [--max N] [--per-defect $] [--usd $] [--at <sha>] [--fresh] [--fleet] | run [areas…] [--by finish|cheapest|spread] [--usd $] [--passes N] [--per-defect $] | fold <area> | ingest <area> <report.md> --source <name> [--at <sha>] | import <area> <dir> --at <sha> [--fresh] | land <area>… | land --all | ls [--json] | ls --source <name> --ids | report <area> | rm <area>';

/** `argv`'s positional words and flags. */
export const saturateArgsOf = (cfg, argv) => {
  const flags = {};
  const words = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--fresh' || a === '--all' || a === '--json' || a === '--ids') flags[a.slice(2)] = true;
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
    words, max, sources, fresh: Boolean(flags.fresh), all: Boolean(flags.all), json: Boolean(flags.json), ids: Boolean(flags.ids), source: flags.source, at: flags.at,
    usd: dollars('usd'), perDefect: dollars('per-defect'), passes, by: flags.by,
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

/** The progress line for occasion `o`, the last folded into `ledger`, priced with the calibration `factor`. */
export const occasionLine = (ledger, o, max, factor = 1) => {
  const r = yieldRows(ledger).find((row) => row.n === o.n);
  const s = r.stats;
  const unseen = s.f0 === undefined ? '–' : s.f0.toFixed(1);
  const next = s.nextNew === undefined ? '–' : `${Math.round(s.nextNew * 100)}%`;
  const perDefect = r.usdPerDefect === undefined ? '–' : `$${r.usdPerDefect.toFixed(2)}`;
  const price = nextPriceOf(ledger, factor).usd;
  const nextUsd = price === undefined ? '–' : Number.isFinite(price) ? `$${price.toFixed(2)}` : 'none expected';
  return `${o.n}/${max} ${o.source}: ${o.findings} findings, ${r.new} new; distinct ${s.S}; unseen ≈ ${unseen}; next-new ${next}; $${o.costUsd.toFixed(2)}; ${perDefect}/defect, next ≈ ${nextUsd}`;
};

/** The file a report waits in until it is folded, relative to the ledger's directory. */
const unfoldedFileOf = (key) => `reviews/unfolded-${key.replace(/[^\w.-]+/g, '-')}.md`;

/**
 * Keeps a finished report beside the ledger and lists it in the ledger's `unfolded`, where it waits for `foldPending`;
 * clears the job outputs it came from. Answers the new ledger.
 */
const stageReport = (cfg, ledger, { key, source, kind, text, findings, costUsd, minutes }) => {
  const file = unfoldedFileOf(key);
  const path = join(ledgerDirOf(cfg, ledger.area), file);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, text);
  const next = { ...ledger, unfolded: [...(ledger.unfolded ?? []), { key, source, kind, file, findings, costUsd, minutes }] };
  writeLedger(cfg, next);
  rmSync(occasionJobsOf(cfg, ledger.area, key), { recursive: true, force: true });
  return next;
};

/**
 * Folds the ledger's first unfolded report in as its next occasion, matched by the ledger matcher (or taken whole as
 * new when the ledger is empty), and writes the ledger. Answers the new ledger; throws, leaving the report unfolded,
 * when the matcher fails.
 */
const foldNext = async (ctx, ledger) => {
  const [entry, ...rest] = ledger.unfolded;
  const { key, source, kind, file, findings, costUsd, minutes } = entry;
  const dir = ledgerDirOf(ctx.cfg, ledger.area);
  const text = readFileSync(join(dir, file), 'utf8');
  const area = { id: ledger.area, files: ledger.files };
  const matched = kind === 'review' && (ledger.defects.length === 0 || findings.length === 0)
    ? { match: allNew(findings), costUsd: 0, minutes: 0 }
    : await matchReport(ctx, area, key, ledger, kind === 'ingest' ? { raw: text } : { findings });
  const n = ledger.occasions.length + 1;
  const kept = keepReview(ctx.cfg, ledger.area, n, source, text);
  const { unfolded: _, ...folded } = ledger;
  const next = withOccasion(rest.length ? { ...folded, unfolded: rest } : folded, {
    n, source, kind, file: kept, costUsd: costUsd + matched.costUsd, minutes: minutes + matched.minutes, at: new Date().toISOString(),
  }, matched.match);
  writeLedger(ctx.cfg, next);
  rmSync(join(dir, file), { force: true });
  rmSync(occasionJobsOf(ctx.cfg, ledger.area, key), { recursive: true, force: true });
  return next;
};

/** Folds every unfolded report into the ledger, in the order they finished, printing a line for each. Answers the ledger. */
const foldPending = async (ctx, ledger, rule) => {
  let at = ledger;
  while (at.unfolded?.length) {
    at = await foldNext(ctx, at);
    ctx.say(occasionLine(at, at.occasions.at(-1), rule.max, rule.factor));
    writeReport(ctx.cfg, at.area, at, rule);
  }
  return at;
};

const spentOn = (ledger) => ledger.occasions.reduce((sum, o) => sum + (o.costUsd ?? 0), 0);

/**
 * Reviews `id` until the stop rule holds, one review per source an iteration, or for `args.passes` iterations at most.
 * `args.usd` caps what this call spends. Answers the ledger.
 */
export const saturateArea = async (cfg, runner, root, id, args, tell) => {
  requireSources(cfg, args.sources);
  const rule = scourRuleOf(cfg, args);
  return withFrozen(cfg, root, id, { ...args, about: { does: 'delve', max: rule.max }, say: tell }, async ({ ledger: start, frozen, base, commit, say }) => {
    let ledger = start;
    writeLedger(cfg, ledger);
    say(`saturate ${id} at ${commit.slice(0, 10)}: ${ledger.files.length} files, ${ledger.occasions.length} occasions so far, sources ${args.sources.join(', ')}`);
    const ctx = createSaturateContext({ cfg, runner, frozen, base, commit, area: id, say });
    const area = { id, files: ledger.files };
    ledger = await foldPending(ctx, ledger, rule);
    const startUsd = spentOn(ledger);
    for (let pass = 0; ; pass++) {
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
      ledger = await foldPending(ctx, ledger, rule);
      if (finished === 0) throw new Error(`saturate ${id}: no review of this iteration finished; stopping`);
    }
    say(`saturate ${id}: report at ${writeReport(cfg, id, ledger, rule)}`);
    return ledger;
  });
};

/** Folds an externally written report into `id`'s ledger as one occasion. Answers the ledger. */
export const ingestReport = async (cfg, runner, root, id, path, source, args, tell) => {
  if (!source) throw new Error('ingest wants --source <name>: who wrote the report');
  if (!existsSync(path)) throw new Error(`no report at ${path}`);
  const text = readFileSync(path, 'utf8');
  const rule = scourRuleOf(cfg, args);
  return withFrozen(cfg, root, id, { fresh: false, at: args.at, about: { does: 'ingest' }, say: tell }, async ({ ledger, frozen, base, commit, say }) => {
    const ctx = createSaturateContext({ cfg, runner, frozen, base, commit, area: id, say });
    const key = `${pad(ledger.occasions.length + (ledger.unfolded?.length ?? 0) + 1)}-${source}`;
    const next = await foldPending(ctx, stageReport(cfg, ledger, { key, source, kind: 'ingest', text, findings: [], costUsd: 0, minutes: 0 }), rule);
    say(`saturate ${id}: report at ${writeReport(cfg, id, next, rule)}`);
    return next;
  });
};

/** Folds `id`'s unfolded reports into its ledger, as after a matcher failure. Answers the ledger. */
export const foldReports = async (cfg, runner, root, id, args, tell) => {
  if (!ledgerOf(cfg, id)) throw new Error(`${id} has no scour ledger`);
  const rule = scourRuleOf(cfg, args);
  return withFrozen(cfg, root, id, { fresh: false, about: { does: 'fold' }, say: tell }, async ({ ledger, frozen, base, commit, say }) => {
    if (!ledger.unfolded?.length) {
      say(`fold ${id}: nothing to fold`);
      return ledger;
    }
    const ctx = createSaturateContext({ cfg, runner, frozen, base, commit, area: id, say });
    return foldPending(ctx, ledger, rule);
  });
};

/** `skulkr scour …`; each line it prints goes to `say`. */
export const saturateCommand = async (cfg, runner, root, argv, say = (line) => console.log(line)) => {
  const args = saturateArgsOf(cfg, argv);
  const [first, ...rest] = args.words;
  if (!first) throw new Error(SATURATE_USAGE);
  moveFormerScourState(cfg);
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
    const list = ledgerListOf(cfg, root);
    if (args.json) say(JSON.stringify(list));
    else for (const line of ledgerListLines(list)) say(line);
    return list;
  }
  if (first === 'report') {
    const ledger = rest[0] && ledgerOf(cfg, rest[0]);
    if (!ledger) throw new Error(rest[0] ? `${rest[0]} has no saturation ledger` : SATURATE_USAGE);
    say(`wrote ${writeReport(cfg, rest[0], ledger, scourRuleOf(cfg, args))}`);
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
  if (first === 'delve') {
    if (!rest[0]) throw new Error(SATURATE_USAGE);
    return saturateArea(cfg, runner, root, rest[0], args, say);
  }
  return saturateArea(cfg, runner, root, first, args, say);
};
