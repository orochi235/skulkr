/** `skulkr night --resume N`: a stopped or crashed round picked back up. README.md, "A run", is its documentation. */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { gitIn } from './batch.mjs';
import { openFindingsIn } from './carryRecords.mjs';
import { waitForLease } from './lease.mjs';
import { partitionAt } from './partition.mjs';
import { inheritPasses, passesIn } from './rounds.mjs';
import { clearStop, liveRuns, planLock, readJson, runDir, writeStatus } from './runs.mjs';

/**
 * The areas a resume of `prior` (the round's status or summary) runs again: every one it planned, less those its
 * `landed` record says reached `main` while `main` still holds that tip (`inMain(tip)`), and those `held` by a live
 * run. Answers `{ ids, landed, held }`, the last two the ids each reason left out.
 */
export const resumable = ({ prior, held, inMain }) => {
  const planned = (prior.planned ?? prior.areas ?? []).map((a) => (typeof a === 'string' ? a : a.id));
  const done = new Set(prior.landed?.tip && inMain(prior.landed.tip) ? prior.landed.areas : []);
  const landed = planned.filter((id) => done.has(id));
  const taken = planned.filter((id) => !done.has(id) && held.has(id));
  return { ids: planned.filter((id) => !done.has(id) && !held.has(id)), landed, held: taken };
};

/**
 * Picks a stopped or crashed round back up: its round, commit, areas and night directory, under the code and
 * settings on disk now. Jobs whose results came home are reused, not run again (`dispatch` in area.mjs). Like a new
 * run's plan, it holds the plan lock from reading what live runs hold through writing its status.
 */
export const resume = async (cfg, root, args, say) => {
  const round = args.resume;
  const state = cfg.state;
  const release = await waitForLease(planLock(state), {}, { pollMs: 1_000 });
  try {
    const prior = readJson(join(runDir(round, state), 'status.json')) ?? readJson(join(runDir(round, state), 'summary.json'));
    if (!prior?.nightDir) throw new Error(`round ${round} left no status or summary to resume from`);
    const running = liveRuns(state);
    if (running.some((r) => r.round === round)) throw new Error(`round ${round} is still running; stop it first`);
    const frozen = join(root, '.worktrees', cfg.names.frozen(round));
    const commit = prior.commit ?? (existsSync(frozen) ? gitIn(frozen)('rev-parse', 'HEAD') : undefined);
    if (!commit) throw new Error(`round ${round}'s commit is unknown: its status predates recording it and its frozen tree is gone`);
    const byId = new Map(partitionAt(cfg, root, commit).map((a) => [a.id, a]));
    const git = gitIn(root);
    const inMain = (tip) => {
      try {
        git('merge-base', '--is-ancestor', tip, cfg.git.main);
        return true;
      } catch {
        return false;
      }
    };
    const { ids, landed, held } = resumable({ prior, held: new Set(running.flatMap((r) => r.areas ?? [])), inMain });
    if (landed.length) say(`resume: ${landed.join(', ')} already landed on ${cfg.git.main}; not run again`);
    if (held.length) say(`resume: ${held.join(', ')} ${held.length === 1 ? 'is' : 'are'} held by a live run; left out`);
    clearStop(round, state);
    if (prior.args?.fixOnly) args.fixOnly = prior.args.fixOnly;
    const p = {
      commit, round, picked: ids.flatMap((id) => (byId.has(id) ? [byId.get(id)] : [])), passes: inheritPasses([...byId.values()], passesIn(cfg, git, root)).history,
      running, open: openFindingsIn(cfg, git, root),
    };
    const status = {
      round, commit, started: prior.started, resumed: new Date().toISOString(), step: 'freeze', areas: ids, nightDir: prior.nightDir,
      weightedTokens: prior.weightedTokens ?? 0, costUsd: prior.costUsd ?? 0, capUsd: args.capUsd, args, ...(prior.landed ? { landed: prior.landed } : {}),
    };
    writeStatus(round, status, state);
    say(`resuming round ${round} at ${commit.slice(0, 10)}: ${p.picked.length} areas, reusing every job whose result came home`);
    return { p, status };
  } finally {
    release();
  }
};
