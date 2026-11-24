/**
 * Planning a run: which round and areas it takes, the lines that say so, and claiming them under the plan lock.
 * README.md, "A run" and "Which areas", is its documentation.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { requireAgents } from './agent/index.mjs';
import { localFixLine, localFixOf, localLine } from './args.mjs';
import { gitIn } from './batch.mjs';
import { openFindingsIn } from './carryRecords.mjs';
import { nodesAt } from './config.mjs';
import { planFixOnly } from './fixOnly.mjs';
import { waitForLease } from './lease.mjs';
import { partitionAt } from './partition.mjs';
import { recordsFor } from './recordFiles.mjs';
import { areaStats, areasInFlightFor, lastPassIn, nextRound, passesIn, pickAreas, scaledOf } from './rounds.mjs';
import { claimRound, claimedRounds, liveRuns, planLock, writeStatus } from './runs.mjs';
import { usd } from './usage.mjs';

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
export const localDate = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const sweepName = (cfg) => cfg.sweep?.title?.toLowerCase() ?? cfg.sweep?.id ?? 'sweep';

/** What a run started now would do. Its round is the next unclaimed one; areas a live run holds are left out. */
export const plan = (cfg, root, args) => {
  requireAgents(cfg);
  const git = gitIn(root);
  const main = cfg.git.main;
  const commit = git('rev-parse', main);
  const branches = git('for-each-ref', '--format=%(refname:short)', 'refs/heads').split('\n');
  const recordDir = join(root, cfg.record.dir);
  const roundDirs = existsSync(recordDir) ? readdirSync(recordDir) : [];
  const ledger = cfg.record.ledger && join(root, cfg.record.ledger.path);
  const hardening = ledger && existsSync(ledger) ? readFileSync(ledger, 'utf8') : '';
  const round = nextRound({ roundDirs, hardening, branches, claimed: claimedRounds(cfg.state), roundIn: cfg.names.roundIn, batchRoundOf: cfg.names.batchRoundOf });
  const areas = partitionAt(cfg, root, commit);
  const records = recordsFor(cfg, git, root);
  const { history: passes, covered, staleLines, touched } = areaStats(cfg, git, areas, passesIn(cfg, git, root, records), root);
  const running = liveRuns(cfg.state);
  const held = new Set(running.flatMap((r) => r.areas ?? []));
  const byId = new Map(areas.map((a) => [a.id, a]));
  const unknown = (args.only ?? []).filter((id) => !byId.has(id));
  if (unknown.length > 0) throw new Error(`no area named ${unknown.join(', ')}; see ${cfg.partition.path}`);
  const taken = (args.only ?? []).filter((id) => held.has(id));
  if (taken.length > 0) throw new Error(`${taken.join(', ')} ${taken.length === 1 ? 'is' : 'are'} held by a live run; see its status`);
  const inFlight = areasInFlightFor(cfg, git);
  const open = openFindingsIn(cfg, git, root, records, areas);
  if (args.fixOnly) {
    const { picked, skipped } = planFixOnly({ areas, open, want: args.fixOnly, held, inFlight });
    const missing = skipped.filter((s) => s.why === 'no such area').map((s) => s.id);
    if (missing.length > 0) throw new Error(`no area named ${missing.join(', ')}; see ${cfg.partition.path}`);
    return { commit, round, picked: picked.map((id) => byId.get(id)), passes, staleLines, running, open, skipped };
  }
  const picked = args.only
    ? args.only.slice(0, args.areas)
    : pickAreas({
      areas, passes, covered, staleLines, touched, count: args.areas,
      inFlight: new Set([...inFlight, ...held]),
    }).picked;
  return { commit, round, picked: picked.map((id) => byId.get(id)), passes, staleLines, running, open };
};

/** Where a run's jobs go, for its first line. */
export const nodesLine = (cfg, args) => (args.places && !args.nodes
  ? `placed by the runner, ${cfg.concurrency.review} reviews and ${cfg.concurrency.fix} fixes at once`
  : `${(args.nodes ?? nodesAt(cfg, new Date())).join(', ')}${args.nodes ? ' (pinned)' : ''}`);

export const printPlan = (cfg, p, args, say) => {
  say(`round ${p.round} at ${p.commit.slice(0, 10)}; nodes: ${nodesLine(cfg, args)}; stops dispatching at ${cfg.schedule.stopAt}`);
  say(`budget: ${usd(args.capUsd)} tonight; per job $${args.budget.review} review, $${args.budget.match} match, $${args.budget.fix} fix`);
  if (cfg.local.on) say(localLine(cfg));
  const local = localFixOf(cfg, args);
  if (local) say(localFixLine(cfg, local));
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
  say(`jobs: ${p.picked.length * (args.trial ? 4 : 2)} reviews, up to ${p.picked.length * (args.trial ? 2 : 1)} matches and ${p.picked.length} fixes; then ${cfg.names.batch(localDate(), p.round)}`);
  for (const r of p.running) say(`round ${r.round} is running (pid ${r.pid}, step ${r.step}); its areas are left out above`);
};

/**
 * Plans, claims the round and writes the run's first status, all under the plan lock, so two runs
 * starting at once never pick the same area. Answers the plan and the run's status, or the plan alone
 * when it picked nothing.
 */
export const begin = async (cfg, root, args, say) => {
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
    const status = { round: p.round, commit: p.commit, started: started.toISOString(), step: 'freeze', areas: p.picked.map((a) => a.id), files: Object.fromEntries(p.picked.map((a) => [a.id, a.files.length])), nightDir, weightedTokens: 0, costUsd: 0, capUsd: args.capUsd, args };
    writeStatus(p.round, status, cfg.state);
    return { p, status };
  } finally {
    release();
  }
};
