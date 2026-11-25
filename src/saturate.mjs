/**
 * `skulkr saturate` (alias `sat`): repeated blind reviews of one area at one frozen commit, folded into a ledger of
 * distinct defects until capture–recapture says the area is saturated. README "Saturation" is its documentation.
 *
 *   skulkr saturate <area> [--sources claude,codex] [--max N] [--at <sha>] [--fresh]
 *   skulkr saturate ingest <area> <report.md> --source <name> [--at <sha>]
 *   skulkr saturate import <area> <dir> --at <sha> [--fresh]
 *   skulkr saturate report <area>
 *   skulkr saturate rm <area>
 */
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { addWorktree, gitIn, removeWorktree } from './batch.mjs';
import {
  allNew, emptyLedger, freezeCommitOf, keepReview, ledgerDirOf, ledgerOf, removeLedger, requireAreaFilesAt, requireSameCommit, withLedgerHeld,
  withOccasion, writeLedger,
} from './ledger.mjs';
import { takeLease } from './lease.mjs';
import { importLedger } from './saturateImport.mjs';
import { chao2, stopReason, stopRuleOf, yieldRows } from './saturation.mjs';
import { writeReport } from './saturationReport.mjs';
import { createSaturateContext, matchReport, occasionJobsOf, requireSources, runReview } from './saturateJobs.mjs';

export const SATURATE_USAGE = 'usage: skulkr saturate <area> [--sources claude,codex] [--max N] [--at <sha>] [--fresh] | ingest <area> <report.md> --source <name> [--at <sha>] | import <area> <dir> --at <sha> [--fresh] | report <area> | rm <area>';

/** `argv`'s positional words and flags. */
export const saturateArgsOf = (cfg, argv) => {
  const flags = {};
  const words = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--fresh') flags.fresh = true;
    else if (a.startsWith('--')) flags[a.slice(2)] = argv[++i];
    else words.push(a);
  }
  const max = flags.max === undefined ? cfg.saturate.max : Number(flags.max);
  if (!Number.isInteger(max) || max < 1) throw new Error(`--max wants a whole number of occasions, not ${flags.max}`);
  const sources = flags.sources ? flags.sources.split(',').map((s) => s.trim()).filter(Boolean) : cfg.saturate.sources;
  return { words, max, sources, fresh: Boolean(flags.fresh), source: flags.source, at: flags.at };
};

const pad = (n) => String(n).padStart(2, '0');

/**
 * The area's ledger and a frozen worktree of its commit, held by this process alone, then `work` run with them; the
 * worktree and the hold are let go however it ends. An existing ledger resumes at its own commit, wherever `main` has
 * gone since, unless `at` names another commit, which is refused; with `fresh`, it is moved aside to `<area>.<commit>`.
 * A new ledger freezes at `at`, else `main`'s tip.
 */
const withFrozen = async (cfg, root, id, { fresh, at }, work) => withLedgerHeld(cfg, id, { fresh }, async (held) => {
  const git = gitIn(root);
  const wanted = at === undefined ? undefined : freezeCommitOf(cfg, root, at);
  requireSameCommit(held, at, wanted);
  let ledger = held;
  if (!ledger) {
    const commit = wanted ?? freezeCommitOf(cfg, root);
    ledger = emptyLedger(id, commit, requireAreaFilesAt(cfg, root, id, commit));
  }
  const { commit } = ledger;
  const frozen = addWorktree(root, `${cfg.naming.prefix}-saturate-${id}`, commit);
  try {
    let base = commit;
    try {
      base = git('merge-base', commit, `${cfg.git.remote}/${cfg.git.main}`);
    } catch { /* no remote: the commit is its own base */ }
    return await work({ ledger, frozen, base, commit });
  } finally {
    removeWorktree(root, frozen);
  }
});

/** The progress line for occasion `o` just folded into `ledger`. */
export const occasionLine = (ledger, o, max) => {
  const r = yieldRows(ledger).find((row) => row.n === o.n);
  const s = r.stats;
  const unseen = s.f0 === undefined ? '–' : s.f0.toFixed(1);
  const next = s.nextNew === undefined ? '–' : `${Math.round(s.nextNew * 100)}%`;
  const perDefect = r.usdPerDefect === undefined ? '–' : `$${r.usdPerDefect.toFixed(2)}`;
  return `${o.n}/${max} ${o.source}: ${o.findings} findings, ${r.new} new; distinct ${s.S}; unseen ≈ ${unseen}; next-new ${next}; $${o.costUsd.toFixed(2)}; ${perDefect}/defect`;
};

/**
 * Folds one report into the ledger as its next occasion, matched by the ledger matcher (or taken whole as new when
 * the ledger is empty), writes the ledger, and clears the occasion's job outputs. Answers the new ledger; throws, with
 * the raw report kept beside the ledger and nothing recorded, when the matcher fails.
 */
const foldIn = async (ctx, ledger, { key, source, kind, text, findings, costUsd, minutes }) => {
  const area = { id: ledger.area, files: ledger.files };
  const report = kind === 'ingest' ? { raw: text } : { findings };
  let matched;
  try {
    matched = kind === 'review' && (ledger.defects.length === 0 || findings.length === 0)
      ? { match: allNew(findings), costUsd: 0, minutes: 0 }
      : await matchReport(ctx, area, key, ledger, report);
  } catch (error) {
    keepReview(ctx.cfg, ledger.area, `unmatched-${key}-${Date.now()}`, source, text);
    throw error;
  }
  const n = ledger.occasions.length + 1;
  const file = keepReview(ctx.cfg, ledger.area, n, source, text);
  const next = withOccasion(ledger, {
    n, source, kind, file, costUsd: costUsd + matched.costUsd, minutes: minutes + matched.minutes, at: new Date().toISOString(),
  }, matched.match);
  writeLedger(ctx.cfg, next);
  rmSync(occasionJobsOf(ctx.cfg, ledger.area, key), { recursive: true, force: true });
  return next;
};

/** Reviews `id` until the stop rule holds, one review per source an iteration. Answers the ledger. */
export const saturateArea = async (cfg, runner, root, id, args, say) => {
  requireSources(cfg, args.sources);
  const rule = stopRuleOf(cfg, args.max);
  return withFrozen(cfg, root, id, args, async ({ ledger: start, frozen, base, commit }) => {
    let ledger = start;
    writeLedger(cfg, ledger);
    say(`saturate ${id} at ${commit.slice(0, 10)}: ${ledger.files.length} files, ${ledger.occasions.length} occasions so far, sources ${args.sources.join(', ')}`);
    const ctx = createSaturateContext({ cfg, runner, frozen, base, commit, area: id, say });
    const area = { id, files: ledger.files };
    for (;;) {
      const stop = stopReason(chao2(ledger.occasions, ledger.defects), rule);
      if (stop) {
        say(`saturate ${id}: stopped, ${stop}`);
        break;
      }
      const batch = args.sources.slice(0, rule.max - ledger.occasions.length);
      const at = ledger.occasions.length;
      const keys = batch.map((source, i) => `${pad(at + 1 + i)}-${source}`);
      const reviews = await Promise.all(batch.map((source, i) => runReview(ctx, area, keys[i], source)));
      let counted = 0;
      for (const [i, r] of reviews.entries()) {
        if (!r.finished) {
          keepReview(cfg, id, `unfinished-${keys[i]}-${Date.now()}`, batch[i], r.text);
          rmSync(occasionJobsOf(cfg, id, keys[i]), { recursive: true, force: true });
          say(`saturate ${id}: the ${batch[i]} review ${keys[i]} never finished; not counted`);
          continue;
        }
        ledger = await foldIn(ctx, ledger, { key: keys[i], source: batch[i], kind: 'review', text: r.text, findings: r.findings, costUsd: r.costUsd, minutes: r.minutes });
        counted += 1;
        say(occasionLine(ledger, ledger.occasions.at(-1), rule.max));
        writeReport(root, ledger, rule);
      }
      if (counted === 0) throw new Error(`saturate ${id}: no review of this iteration finished; stopping`);
    }
    say(`saturate ${id}: report at ${writeReport(root, ledger, rule)}`);
    return ledger;
  });
};

/** Folds an externally written report into `id`'s ledger as one occasion. Answers the ledger. */
export const ingestReport = async (cfg, runner, root, id, path, source, args, say) => {
  if (!source) throw new Error('ingest wants --source <name>: who wrote the report');
  if (!existsSync(path)) throw new Error(`no report at ${path}`);
  const text = readFileSync(path, 'utf8');
  const rule = stopRuleOf(cfg, args.max);
  return withFrozen(cfg, root, id, { fresh: false, at: args.at }, async ({ ledger, frozen, base, commit }) => {
    const ctx = createSaturateContext({ cfg, runner, frozen, base, commit, area: id, say });
    const key = `${pad(ledger.occasions.length + 1)}-${source}`;
    const next = await foldIn(ctx, ledger, { key, source, kind: 'ingest', text, findings: [], costUsd: 0, minutes: 0 });
    say(occasionLine(next, next.occasions.at(-1), rule.max));
    say(`saturate ${id}: report at ${writeReport(root, next, rule)}`);
    return next;
  });
};

/** `skulkr saturate …`; each line it prints goes to `say`. */
export const saturateCommand = async (cfg, runner, root, argv, say = (line) => console.log(line)) => {
  const args = saturateArgsOf(cfg, argv);
  const [first, ...rest] = args.words;
  if (!first) throw new Error(SATURATE_USAGE);
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
  if (first === 'report') {
    const ledger = rest[0] && ledgerOf(cfg, rest[0]);
    if (!ledger) throw new Error(rest[0] ? `${rest[0]} has no saturation ledger` : SATURATE_USAGE);
    say(`wrote ${writeReport(root, ledger, stopRuleOf(cfg, args.max))}`);
    return ledger;
  }
  if (first === 'rm') {
    if (!rest[0]) throw new Error(SATURATE_USAGE);
    if (!existsSync(ledgerDirOf(cfg, rest[0]))) {
      say(`${rest[0]} has no saturation ledger`);
      return undefined;
    }
    if (!takeLease(join(ledgerDirOf(cfg, rest[0]), 'lock'), {})) throw new Error(`another skulkr saturate is working on ${rest[0]}`);
    removeLedger(cfg, rest[0]);
    say(`removed ${rest[0]}'s saturation ledger`);
    return undefined;
  }
  return saturateArea(cfg, runner, root, first, args, say);
};
