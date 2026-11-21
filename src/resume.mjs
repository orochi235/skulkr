/** `skulkr night --resume N`: a stopped or crashed round picked back up. README.md, "A run", is its documentation. */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { gitIn } from './batch.mjs';
import { openFindingsIn } from './carryRecords.mjs';
import { partitionAt } from './partition.mjs';
import { inheritPasses, passesIn } from './rounds.mjs';
import { clearStop, liveRuns, readJson, runDir, writeStatus } from './runs.mjs';

/**
 * Picks a stopped or crashed round back up: its round, commit, areas and night directory, under the code and
 * settings on disk now. Jobs whose results came home are reused, not run again (`dispatch` in area.mjs).
 */
export const resume = (cfg, root, args, say) => {
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
  const status = { round, commit, started: prior.started, resumed: new Date().toISOString(), step: 'freeze', areas: ids, nightDir: prior.nightDir, weightedTokens: prior.weightedTokens ?? 0, costUsd: prior.costUsd ?? 0, capUsd: args.capUsd, args };
  writeStatus(round, status, state);
  say(`resuming round ${round} at ${commit.slice(0, 10)}: ${p.picked.length} areas, reusing every job whose result came home`);
  return { p, status };
};
