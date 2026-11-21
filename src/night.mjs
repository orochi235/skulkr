/**
 * One run of blind-pair audit rounds: one round with its parameters. Several may run at once.
 * README.md at the repository root is its documentation.
 *
 *   skulkr night [--areas K] [--only <id>,…] [--nodes <a>,…] [--dry] [--no-merge]
 *     [--cap-usd N] [--budget-review USD] [--budget-match USD] [--budget-fix USD] [--sweep] [--fix-only [a,…]]
 */
import { appendFileSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { basename, join } from 'node:path';
import { runArea } from './area.mjs';
import { parseArgs } from './args.mjs';
import { capstoneRepairer, repairRefusal } from './capstone.mjs';
import { gateBaseline } from './repair.mjs';
import { gateAhead } from './fleet.mjs';
import { areasAtOnce, startAreas } from './admit.mjs';
import { addWorktree, gitIn, mainCheckout, removeWorktree } from './batch.mjs';
import { JOB_IN, nextClock } from './config.mjs';
import { fixOnlyAreas } from './fixOnly.mjs';
import { runUntilFree } from './jobs.mjs';
import { createSlots } from './slots.mjs';
import { batchAndTest, patchAreas, patchSweep } from './land.mjs';
import { begin, localDate, plan, printPlan } from './plan.mjs';
import { resume } from './resume.mjs';
import { changedSince, lastPassIn, scaledOf } from './rounds.mjs';
import { sleep } from './after.mjs';
import { readJson } from './json.mjs';
import { claimedRounds, clearStatus, nightsAt, pruneRuns, runDir, stopRequested, writeStatus, writeSummary } from './runs.mjs';
import { fixSweep, runSweep, sweepLine } from './sweep.mjs';
import { verifyLine, verifyOf } from './verify.mjs';

const POLL_MS = 15_000;
const UNAVAILABLE_TTL_MS = 5 * 60_000;

/** When a run stops starting areas: the first `schedule.stopAt` after it started, or after it was resumed. */
export const deadlineOf = (cfg, status) => nextClock(new Date(status.resumed ?? status.started), cfg.schedule.stopAt);

/**
 * Deletes the oldest night directories past the newest `keepNights`, never one a run's status or summary still names:
 * a live run writes there, and `--resume` picks a stopped one back up from it.
 */
export const pruneNights = (cfg) => {
  const dir = join(cfg.state, 'nights');
  if (!existsSync(dir)) return;
  const named = new Set(claimedRounds(cfg.state).flatMap((round) => ['status.json', 'summary.json']
    .flatMap((file) => readJson(join(runDir(round, cfg.state), file))?.nightDir ?? []).map((night) => basename(night))));
  const nights = readdirSync(dir).sort();
  for (const old of nights.slice(0, Math.max(0, nights.length - cfg.keepNights))) {
    if (!named.has(old)) rmSync(join(dir, old), { recursive: true, force: true });
  }
};

/** Each picked area's reviews, matcher and fixer, started as `startAreas` admits them; resolves when all finish. */
const reviewAreas = ({ ctx, git, picked, passes, open, args, status, deadline, results }) => startAreas({
  ctx, picked, args, status, deadline, results, maxAreas: () => areasAtOnce(ctx.cfg, args, 'review', 2),
  start: (area) => {
    const last = lastPassIn(passes.get(area.id));
    const previous = last && { ...last, ...scaledOf(last) };
    const carried = open?.get(area.id) ?? [];
    return runArea(ctx, area, { previous, carried, changedSince: changedSince(ctx.cfg, git, ctx.root, area.files, previous?.commit, previous?.fixCommits ?? []) });
  },
});

/** The sweep's part of the night's summary. */
const sweepSummary = (cfg, sweep, outcomes) => (sweep.ran
  ? { ...sweep.summary, minutes: Number(sweep.minutes.toFixed(1)), exit: sweep.exit, fixCommits: sweep.fix?.commits.length ?? 0, outcome: outcomes[cfg.sweep.id], ...(sweep.fix?.verify ? { verify: sweep.fix.verify } : {}) }
  : { skipped: sweep.skipped ?? `did not run: ${sweep.why}` });

/** What every job of the run reads: its round, trees, budget, logging, and the slots it takes jobs in. */
const runContext = ({ cfg, runner, root, p, args, status, frozen, say, setStep }) => {
  const git = gitIn(root);
  const slots = createSlots(cfg, args.nodes, { about: { round: p.round }, places: args.places });
  let unavailable = { at: 0, nodes: new Set() };
  const counts = {};
  const spent = new Map();
  const fixingOutsideAreas = new Set();
  return {
    cfg, runner, root,
    earlierNights: nightsAt(p.commit, cfg.state, p.round),
    round: p.round, commit: p.commit, date: localDate(new Date(status.started)), frozen, nightDir: status.nightDir, budget: args.budget,
    base: git('merge-base', p.commit, `${cfg.git.remote}/${cfg.git.main}`),
    frozenTree: git('rev-parse', `${p.commit}^{tree}`),
    identity: Object.fromEntries(['NAME', 'EMAIL'].flatMap((k) => {
      const v = git('config', `user.${k.toLowerCase()}`);
      return [[`GIT_AUTHOR_${k}`, v], [`GIT_COMMITTER_${k}`, v]];
    })),
    total: args.fixOnly ? { review: 0, match: 0, fix: p.picked.length } : { review: p.picked.length * 2, match: p.picked.length, fix: p.picked.length },
    stopped: () => stopRequested(p.round, cfg.state),
    /** What area `id`'s jobs have cost so far, a reused job's included as its area's mean counts it. */
    spentOn: (id) => spent.get(id) ?? 0,
    /** Marks job `id`'s fixer, run outside any area (the sweep's), as running or finished, for {@link reservedUsd}. */
    fixingOutside: (id, running) => (running ? fixingOutsideAreas.add(id) : fixingOutsideAreas.delete(id)),
    /** What fixers running outside any area may still spend: each one's ceiling less what it has spent. */
    reservedUsd: () => [...fixingOutsideAreas].reduce((sum, id) => sum + Math.max(0, args.budget.fix - (spent.get(id) ?? 0)), 0),
    /** One runner job from the frozen tree outside the slots (a sweep's), tried again while its tree is busy. */
    runFree: (job, logPath) => runUntilFree(runner, job, { cwd: frozen, logPath }),
    say,
    progress: (kind, msg, total) => say(`${kind} ${(counts[kind] = (counts[kind] ?? 0) + 1)}/${total} ${msg}`),
    refuse: (node) => slots.refuse(node),
    usage: (record) => {
      appendFileSync(join(status.nightDir, 'usage.jsonl'), `${JSON.stringify({ round: p.round, ...record })}\n`);
      spent.set(record.area, (spent.get(record.area) ?? 0) + record.costUsd);
      // A reused job's spend was counted where it ran: before a resume, or in the earlier run it came from.
      if (!record.reused) {
        status.weightedTokens += record.weightedTokens;
        status.costUsd += record.costUsd;
      }
      setStep(status.step, { behind: status.behind });
    },
    acquire: async (role) => {
      for (let told = false; ;) {
        const gate = gateAhead(role);
        if (gate) {
          if (!told) say(`review: holding new reviews while ${gate.tenant} round ${gate.round}'s gate runs`);
          told = true;
          await sleep(POLL_MS);
          continue;
        }
        if (Date.now() - unavailable.at > UNAVAILABLE_TTL_MS) unavailable = { at: Date.now(), nodes: runner.unavailableNodes() };
        const slot = slots.take(role, { exclude: unavailable.nodes });
        if (slot) return slot;
        await sleep(POLL_MS);
      }
    },
  };
};

/** The sweep, when asked for, beside the reviews. Answers a promise of its fixer's result; `onSweep` hears how it went. */
const startSweep = (ctx, onSweep) => runSweep(ctx).then(
  (ran) => {
    onSweep(ran);
    ctx.say(sweepLine(ctx.cfg.sweep, ran));
    if (!ran.dead?.length) return undefined;
    ctx.total.fix += 1;
    ctx.fixingOutside(ctx.cfg.sweep.id, true);
    return fixSweep(ctx, ran.dead).catch((error) => {
      ctx.say(`fix ${ctx.cfg.sweep.id} failed: ${error.stack ?? error}`);
      return undefined;
    }).finally(() => ctx.fixingOutside(ctx.cfg.sweep.id, false));
  },
  (error) => {
    const failed = { ran: false, why: String(error.message ?? error) };
    onSweep(failed);
    ctx.say(sweepLine(ctx.cfg.sweep, failed));
    return undefined;
  },
);

/** One run under `cfg`, its jobs through `runner`, each line it prints to `say`. */
export const runNight = async (cfg, runner, argv = [], say = (line) => console.log(line)) => {
  const args = { ...parseArgs(cfg, argv), places: Boolean(runner.places) };
  if (args.sweep && !cfg.sweep) throw new Error('--sweep: the config names no sweep');
  if (args.sweep && args.fixOnly) throw new Error('--sweep and --fix-only: a fix-only round runs no checks to fix');
  if (!args.dry && !args.places && !args.nodes?.length && !cfg.nodes.list.length && !cfg.nodes.local) {
    throw new Error(`the config names no nodes for the ${typeof cfg.runner === 'string' ? cfg.runner : 'configured'} runner; set nodes.list or pass --nodes`);
  }
  const root = mainCheckout(cfg);
  const git = gitIn(root);
  if (args.dry) {
    const p = plan(cfg, root, args);
    printPlan(cfg, p, args, say);
    return { round: p.round, dry: true };
  }
  mkdirSync(cfg.state, { recursive: true });
  const { p, status } = args.resume === undefined ? await begin(cfg, root, args, say) : await resume(cfg, root, args, say);
  if (!status) return { round: p.round, dry: true };
  pruneRuns(cfg.keepNights, cfg.state);
  pruneNights(cfg);
  const echo = say;
  say = (line) => {
    echo(line);
    appendFileSync(join(status.nightDir, 'night.log'), `${line}\n`);
  };
  /** The run's step, and what it waits behind (`{ behind }`) while it waits for a lock or the fleet. */
  const setStep = (step, { behind } = {}) => {
    status.step = step;
    if (behind) status.behind = behind;
    else delete status.behind;
    writeStatus(p.round, status, cfg.state);
  };

  const results = [];
  const outcomes = {};
  let report = '';
  let sweep = { skipped: 'off (it runs only with --sweep)' };
  let frozen;
  try {
    frozen = addWorktree(root, cfg.names.frozen(p.round), p.commit);
    const ctx = runContext({ cfg, runner, root, p, args, status, frozen, say, setStep });
    mkdirSync(join(frozen, JOB_IN), { recursive: true });
    // The sweep is one job on one node; the reviews fill every other slot while it runs.
    const sweepFix = args.sweep ? startSweep(ctx, (s) => (sweep = s)) : Promise.resolve(undefined);
    setStep('review');
    const deadline = deadlineOf(cfg, status);
    if (args.fixOnly) await fixOnlyAreas({ ctx, picked: p.picked, open: p.open, args, status, deadline, results });
    else await reviewAreas({ ctx, git, picked: p.picked, passes: p.passes, open: p.open, args, status, deadline, results });
    const sweepFixed = await sweepFix;
    if (results.length === 0 && !sweepFixed?.mbox) throw new Error('no area finished');
    results.sort((a, b) => (a.id < b.id ? -1 : 1));
    setStep('patch');
    const landing = { cfg, root, round: p.round, commit: p.commit, outcomes, say };
    const branches = patchAreas({ ...landing, nightDir: status.nightDir, results });
    if (sweepFixed) sweep.fix = { ...patchSweep({ ...landing, fixed: sweepFixed, branches }), ...(sweepFixed.verify ? { verify: sweepFixed.verify } : {}) };
    setStep('batch');
    const mboxOf = (id) => (id === cfg.sweep?.id ? sweepFixed?.mbox : undefined);
    const repair = verifyOf(cfg) ? capstoneRepairer(ctx, { root, results, mboxOf }) : undefined;
    const baseline = verifyOf(cfg) ? gateBaseline(ctx) : undefined;
    const mayRepair = (started) => repairRefusal({ stopped: ctx.stopped(), used: status.costUsd, started, fix: args.budget.fix, cap: args.capUsd });
    report = await batchAndTest({ ...landing, git, date: ctx.date, nightDir: status.nightDir, branches, results, sweep, merge: args.merge, setStep, repair, mayRepair, baseline,
      onLanded: (landed) => {
        status.landed = { tip: landed.tip, areas: [...new Set([...(status.landed?.areas ?? []), ...landed.areas])] };
        writeStatus(p.round, status, cfg.state);
      },
    });
    const checked = verifyLine(results);
    if (checked) report += `; ${checked}`;
    const unrun = results.filter((s) => s.incomplete?.length).map((s) => `${s.id} (${s.incomplete.join(', ')})`);
    if (unrun.length) report += `; ${unrun.length} of ${results.length} areas incomplete, reviewer never ran or never finished: ${unrun.join(', ')}`;
    say(`night: ${report}`);
  } finally {
    if (frozen) removeWorktree(root, frozen);
    writeSummary(p.round, {
      round: p.round, commit: p.commit, started: status.started, ended: new Date().toISOString(), nightDir: status.nightDir, report, planned: status.areas,
      weightedTokens: status.weightedTokens, costUsd: status.costUsd, capUsd: args.capUsd, sweep: sweepSummary(cfg, sweep, outcomes), ...(status.landed ? { landed: status.landed } : {}),
      areas: results.map((s) => ({ id: s.id, ...(s.fixOnly ? { fixOnly: true } : {}), ...(s.carried ? { carried: s.carried } : {}), a: s.a, b: s.b, m: s.m, distinct: s.distinct, chapman: s.chapman, patches: s.patches, outcome: outcomes[s.id], ...(s.incomplete?.length ? { incomplete: s.incomplete } : {}), ...(s.verify ? { verify: s.verify } : {}), minutes: s.jobs.minutes, weightedTokens: s.jobs.weightedTokens, costUsd: s.jobs.costUsd, budgetHit: s.budgetHit })),
    }, cfg.state);
    clearStatus(p.round, cfg.state);
  }
  return { round: p.round, report, results };
};
