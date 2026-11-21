/**
 * One run of blind-pair audit rounds: one round with its parameters. Several may run at once.
 * README.md at the repository root is its documentation.
 *
 *   skulkr night [--areas K] [--only <id>,…] [--nodes <a>,…] [--dry] [--no-merge]
 *     [--cap-usd N] [--budget-review USD] [--budget-match USD] [--budget-fix USD] [--sweep] [--fix-only [a,…]]
 */
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { runArea } from './area.mjs';
import { capstoneRepairer } from './capstone.mjs';
import { gateBaseline } from './repair.mjs';
import { gateAhead } from './fleet.mjs';
import { openFindingsIn } from './carryRecords.mjs';
import { addWorktree, gitIn, mainCheckout, removeWorktree } from './batch.mjs';
import { JOB_IN, nextClock, nodesAt } from './config.mjs';
import { fixOnlyAreas, fixOnlyArg, planFixOnly } from './fixOnly.mjs';
import { createSlots, runUntilFree } from './jobs.mjs';
import { batchAndTest, patchAreas, patchSweep } from './land.mjs';
import { waitForLease } from './lease.mjs';
import { partitionAt } from './partition.mjs';
import { areaStats, areasInFlightFor, gitTouched, inheritPasses, lastPassIn, nextRound, passesIn, pickAreas, scaledOf } from './rounds.mjs';
import { claimRound, claimedRounds, clearStatus, clearStop, liveRuns, nightsAt, planLock, pruneRuns, readJson, runDir, stopRequested, writeStatus, writeSummary } from './runs.mjs';
import { fixSweep, runSweep, sweepLine } from './sweep.mjs';
import { mayStartArea } from './usage.mjs';
import { verifyLine, verifyOf } from './verify.mjs';

const POLL_MS = 15_000;
const UNAVAILABLE_TTL_MS = 5 * 60_000;

const usd = (n) => `$${n.toFixed(2)}`;
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const localDate = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export const parseArgs = (cfg, argv) => {
  const value = (flag) => {
    const i = argv.indexOf(flag);
    return i < 0 ? undefined : argv[i + 1];
  };
  const number = (flag, fallback) => {
    const v = value(flag);
    if (v === undefined) return fallback;
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) throw new Error(`${flag} wants a non-negative number, not ${v}`);
    return n;
  };
  const fixOnly = argv.indexOf('--fix-only');
  return {
    fixOnly: fixOnly < 0 ? undefined : fixOnlyArg(argv[fixOnly + 1]?.startsWith('--') ? '' : argv[fixOnly + 1] ?? ''),
    areas: number('--areas', cfg.areasPerRound),
    only: value('--only')?.split(',').filter(Boolean),
    nodes: value('--nodes')?.split(',').filter(Boolean),
    dry: argv.includes('--dry'),
    resume: value('--resume') === undefined ? undefined : number('--resume', 0),
    merge: !argv.includes('--no-merge'),
    sweep: argv.includes('--sweep'),
    capUsd: number('--cap-usd', cfg.budget.capUsd),
    budget: {
      review: number('--budget-review', cfg.budget.review),
      match: number('--budget-match', cfg.budget.match),
      fix: number('--budget-fix', cfg.budget.fix),
    },
  };
};

const pruneNights = (cfg) => {
  const dir = join(cfg.state, 'nights');
  if (!existsSync(dir)) return;
  const nights = readdirSync(dir).sort();
  for (const old of nights.slice(0, Math.max(0, nights.length - cfg.keepNights))) rmSync(join(dir, old), { recursive: true, force: true });
};

/** The files of `files` some commit after `from`, other than `exclude`, changed. */
const changedSince = (git, files, from, exclude) => {
  if (!from || files.length === 0) return [];
  const skip = new Set(exclude);
  const out = git('log', '--no-merges', '--format=@%H', '--name-only', `${from}..HEAD`, '--', ...files);
  const changed = new Set();
  let keep = false;
  for (const line of out.split('\n')) {
    if (line.startsWith('@')) keep = !skip.has(line.slice(1));
    else if (line && keep) changed.add(line);
  }
  return [...changed];
};

/** What a run started now would do. Its round is the next unclaimed one; areas a live run holds are left out. */
const plan = (cfg, root, args) => {
  const git = gitIn(root);
  const main = cfg.git.main;
  const commit = git('rev-parse', main);
  const branches = git('for-each-ref', '--format=%(refname:short)', 'refs/heads').split('\n');
  const recordDir = join(root, cfg.record.dir);
  const roundDirs = existsSync(recordDir) ? readdirSync(recordDir) : [];
  const ledger = cfg.record.ledger && join(root, cfg.record.ledger.path);
  const hardening = ledger && existsSync(ledger) ? readFileSync(ledger, 'utf8') : '';
  const round = nextRound({ roundDirs, hardening, branches, claimed: claimedRounds(cfg.state), roundIn: cfg.names.roundIn });
  const areas = partitionAt(cfg, root, commit);
  const { history: passes, covered, staleLines } = areaStats(cfg, git, areas, passesIn(cfg, git, root), root);
  const running = liveRuns(cfg.state);
  const held = new Set(running.flatMap((r) => r.areas ?? []));
  const byId = new Map(areas.map((a) => [a.id, a]));
  const unknown = (args.only ?? []).filter((id) => !byId.has(id));
  if (unknown.length > 0) throw new Error(`no area named ${unknown.join(', ')}; see ${cfg.partition.path}`);
  const taken = (args.only ?? []).filter((id) => held.has(id));
  if (taken.length > 0) throw new Error(`${taken.join(', ')} ${taken.length === 1 ? 'is' : 'are'} held by a live run; see its status`);
  const inFlight = areasInFlightFor(cfg, git);
  const open = openFindingsIn(cfg, git, root);
  if (args.fixOnly) {
    const { picked, skipped } = planFixOnly({ areas, open, want: args.fixOnly, held, inFlight });
    const missing = skipped.filter((s) => s.why === 'no such area').map((s) => s.id);
    if (missing.length > 0) throw new Error(`no area named ${missing.join(', ')}; see ${cfg.partition.path}`);
    return { commit, round, picked: picked.map((id) => byId.get(id)), passes, staleLines, running, open, skipped };
  }
  const picked = args.only
    ? args.only.slice(0, args.areas)
    : pickAreas({
      areas, passes, covered, staleLines, touched: gitTouched(git), count: args.areas,
      inFlight: new Set([...inFlight, ...held]),
    }).picked;
  return { commit, round, picked: picked.map((id) => byId.get(id)), passes, staleLines, running, open };
};

/** Where a run's jobs go, for its first line. */
const nodesLine = (cfg, args) => (args.places && !args.nodes
  ? `placed by the runner, ${cfg.concurrency.review} reviews and ${cfg.concurrency.fix} fixes at once`
  : `${(args.nodes ?? nodesAt(cfg, new Date())).join(', ')}${args.nodes ? ' (pinned)' : ''}`);

const printPlan = (cfg, p, args, say) => {
  say(`round ${p.round} at ${p.commit.slice(0, 10)}; nodes: ${nodesLine(cfg, args)}; stops dispatching at ${cfg.schedule.stopAt}`);
  say(`budget: ${usd(args.capUsd)} tonight; per job $${args.budget.review} review, $${args.budget.match} match, $${args.budget.fix} fix`);
  if (args.fixOnly) {
    for (const area of p.picked) say(`  ${area.id}: ${plural(p.open.get(area.id).length, 'open finding')}, from rounds ${[...new Set(p.open.get(area.id).map((o) => o.round))].join(', ')}`);
    for (const s of p.skipped ?? []) say(`  ${s.id}: skipped, ${s.why}`);
    say(`jobs: ${p.picked.length} fixes, no reviews; then ${cfg.names.batch(localDate(), p.round)}`);
    return;
  }
  for (const area of p.picked) {
    const last = lastPassIn(p.passes.get(area.id));
    const stale = p.staleLines?.get(area.id) ?? 0;
    const left = last && Math.round(scaledOf(last).unfound * 10) / 10;
    say(`  ${area.id}: ${area.files.length} files${last ? `, last pass round ${last.round} (${last.distinct} distinct, ~${left} left${stale ? `; ${stale} lines changed since` : ''})` : ', never audited'}`);
    const open = p.open?.get(area.id)?.length;
    if (open) say(`    carries ${plural(open, 'open finding')} from earlier rounds`);
    say(`    ${area.files.slice(0, 4).join(' ')}${area.files.length > 4 ? ' …' : ''}`);
  }
  if (cfg.sweep) say(args.sweep ? `${sweepName(cfg)}: one job at the frozen commit beside the reviews, and a fixer for what it finds` : `${sweepName(cfg)}: off (it runs only with --sweep)`);
  say(`jobs: ${p.picked.length * 2} reviews, up to ${p.picked.length} matches and ${p.picked.length} fixes; then ${cfg.names.batch(localDate(), p.round)}`);
  for (const r of p.running) say(`round ${r.round} is running (pid ${r.pid}, step ${r.step}); its areas are left out above`);
};

/**
 * Plans, claims the round and writes the run's first status, all under the plan lock, so two runs
 * starting at once never pick the same area. Answers the plan and the run's status, or the plan alone
 * when it picked nothing.
 */
const begin = async (cfg, root, args, say) => {
  const release = await waitForLease(planLock(cfg.state), {}, { pollMs: 1_000 });
  try {
    const p = plan(cfg, root, args);
    if (p.picked.length === 0) {
      printPlan(cfg, p, args, say);
      return { p };
    }
    p.round = claimRound(p.round, cfg.state);
    printPlan(cfg, p, args, say);
    const started = new Date();
    const nightDir = join(cfg.state, 'nights', `${started.toISOString().replace(/[:.]/g, '-')}-round${p.round}`);
    mkdirSync(nightDir, { recursive: true });
    const status = { round: p.round, commit: p.commit, started: started.toISOString(), step: 'freeze', areas: p.picked.map((a) => a.id), nightDir, weightedTokens: 0, costUsd: 0, capUsd: args.capUsd, args };
    writeStatus(p.round, status, cfg.state);
    return { p, status, started };
  } finally {
    release();
  }
};

/** Starts each picked area while the night has time, budget and no stop request; resolves when all finish. */
const reviewAreas = async ({ ctx, git, picked, passes, open, args, status, deadline, results }) => {
  const inFlight = new Set();
  const cfg = ctx.cfg;
  const reviews = args.places && !args.nodes ? cfg.concurrency.review : (args.nodes ?? nodesAt(cfg, new Date())).length * cfg.nodes.reviewSlots;
  const maxAreas = Math.max(1, Math.floor(reviews / 2));
  for (const area of picked) {
    while (inFlight.size >= maxAreas) await Promise.race(inFlight);
    const affordable = mayStartArea({ used: status.costUsd, finished: results.map((r) => r.jobs.costUsd), inFlight: inFlight.size, cap: args.capUsd, guess: cfg.budget.areaGuessUsd });
    const why = ctx.stopped() ? 'stop requested'
      : new Date() >= deadline ? `past ${cfg.schedule.stopAt}`
        : !affordable ? `the next area would cross the ${usd(args.capUsd)} cap (${usd(status.costUsd)} used)` : '';
    if (why) {
      ctx.say(`not starting ${area.id}: ${why}`);
      continue;
    }
    const last = lastPassIn(passes.get(area.id));
    const previous = last && { ...last, ...scaledOf(last) };
    const carried = open?.get(area.id) ?? [];
    const job = runArea(ctx, area, { previous, carried, changedSince: changedSince(git, area.files, previous?.commit, previous?.fixCommits ?? []) })
      .then((summary) => results.push(summary))
      .catch((error) => ctx.say(`area ${area.id} failed: ${error.stack ?? error}`))
      .finally(() => inFlight.delete(job));
    inFlight.add(job);
  }
  await Promise.all(inFlight);
};

const sweepName = (cfg) => cfg.sweep?.title?.toLowerCase() ?? cfg.sweep?.id ?? 'sweep';

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
    /** One runner job from the frozen tree outside the slots (a sweep's), tried again while its tree is busy. */
    runFree: (job, logPath) => runUntilFree(runner, job, { cwd: frozen, logPath }),
    say,
    progress: (kind, msg, total) => say(`${kind} ${(counts[kind] = (counts[kind] ?? 0) + 1)}/${total} ${msg}`),
    refuse: (node) => slots.refuse(node),
    usage: (record) => {
      appendFileSync(join(status.nightDir, 'usage.jsonl'), `${JSON.stringify({ round: p.round, ...record })}\n`);
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
    return fixSweep(ctx, ran.dead).catch((error) => {
      ctx.say(`fix ${ctx.cfg.sweep.id} failed: ${error.stack ?? error}`);
      return undefined;
    });
  },
  (error) => {
    const failed = { ran: false, why: String(error.message ?? error) };
    onSweep(failed);
    ctx.say(sweepLine(ctx.cfg.sweep, failed));
    return undefined;
  },
);

/**
 * Picks a stopped or crashed round back up: its round, commit, areas and night directory, under the code and
 * settings on disk now. Jobs whose results came home are reused, not run again (`dispatch` in area.mjs).
 */
const resume = (cfg, root, args, say) => {
  const round = args.resume;
  const state = cfg.state;
  const prior = readJson(join(runDir(round, state), 'status.json')) ?? readJson(join(runDir(round, state), 'summary.json'));
  if (!prior?.nightDir) throw new Error(`round ${round} left no status or summary to resume from`);
  if (liveRuns(state).some((r) => r.round === round)) throw new Error(`round ${round} is still running; stop it first`);
  const frozen = join(root, '.worktrees', cfg.names.frozen(round));
  const commit = prior.commit ?? (existsSync(frozen) ? gitIn(frozen)('rev-parse', 'HEAD') : undefined);
  if (!commit) throw new Error(`round ${round}'s commit is unknown: its status predates recording it and its frozen tree is gone`);
  const byId = new Map(partitionAt(cfg, root, commit).map((a) => [a.id, a]));
  // An area the stopped run already merged is done; the rest run again, reusing what came home.
  const git = gitIn(root);
  const inMain = (id) => {
    try {
      git('merge-base', '--is-ancestor', cfg.names.area(round, id), cfg.git.main);
      return true;
    } catch {
      return false;
    }
  };
  const landed = new Set((prior.areas ?? []).flatMap((a) => (typeof a === 'object' && (a.patches ?? 0) > 0 && inMain(a.id) ? [a.id] : [])));
  const ids = (prior.planned ?? prior.areas ?? []).map((a) => (typeof a === 'string' ? a : a.id)).filter((id) => !landed.has(id));
  clearStop(round, state);
  if (prior.args?.fixOnly) args.fixOnly = prior.args.fixOnly;
  const p = {
    commit, round, picked: ids.flatMap((id) => (byId.has(id) ? [byId.get(id)] : [])), passes: inheritPasses([...byId.values()], passesIn(cfg, git, root)).history,
    running: liveRuns(state), open: openFindingsIn(cfg, git, root),
  };
  const started = new Date(prior.started);
  const status = { round, commit, started: prior.started, resumed: new Date().toISOString(), step: 'freeze', areas: ids, nightDir: prior.nightDir, weightedTokens: prior.weightedTokens ?? 0, costUsd: prior.costUsd ?? 0, capUsd: args.capUsd, args };
  writeStatus(round, status, state);
  say(`resuming round ${round} at ${commit.slice(0, 10)}: ${p.picked.length} areas, reusing every job whose result came home`);
  return { p, status, started };
};

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
  const { p, status, started } = args.resume === undefined ? await begin(cfg, root, args, say) : resume(cfg, root, args, say);
  if (!status) return { round: p.round, dry: true };
  pruneNights(cfg);
  pruneRuns(cfg.keepNights, cfg.state);
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
    const deadline = nextClock(started, cfg.schedule.stopAt);
    if (args.fixOnly) await fixOnlyAreas({ ctx, picked: p.picked, open: p.open, deadline, results });
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
    report = await batchAndTest({ ...landing, git, date: ctx.date, nightDir: status.nightDir, branches, results, sweep, merge: args.merge, setStep, repair, baseline });
    const checked = verifyLine(results);
    if (checked) report += `; ${checked}`;
    const unrun = results.filter((s) => s.incomplete?.length).map((s) => `${s.id} (${s.incomplete.join(', ')})`);
    if (unrun.length) report += `; ${unrun.length} of ${results.length} areas incomplete, reviewer never ran or never finished: ${unrun.join(', ')}`;
    say(`night: ${report}`);
  } finally {
    if (frozen) removeWorktree(root, frozen);
    writeSummary(p.round, {
      round: p.round, commit: p.commit, started: status.started, ended: new Date().toISOString(), nightDir: status.nightDir, report, planned: status.areas,
      weightedTokens: status.weightedTokens, costUsd: status.costUsd, capUsd: args.capUsd, sweep: sweepSummary(cfg, sweep, outcomes),
      areas: results.map((s) => ({ id: s.id, ...(s.fixOnly ? { fixOnly: true } : {}), ...(s.carried ? { carried: s.carried } : {}), a: s.a, b: s.b, m: s.m, distinct: s.distinct, chapman: s.chapman, patches: s.patches, outcome: outcomes[s.id], ...(s.incomplete?.length ? { incomplete: s.incomplete } : {}), ...(s.verify ? { verify: s.verify } : {}), minutes: s.jobs.minutes, weightedTokens: s.jobs.weightedTokens, costUsd: s.jobs.costUsd, budgetHit: s.budgetHit })),
    }, cfg.state);
    clearStatus(p.round, cfg.state);
  }
  return { round: p.round, report, results };
};
