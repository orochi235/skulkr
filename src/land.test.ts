import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { gitIn } from './batch.mjs';
import { resolveConfig } from './config.mjs';
import { batchAndTest } from './land.mjs';
import { leftOutIn } from './leftOut.mjs';

const dirs: string[] = [];
const temp = (prefix: string) => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
};
let fleetWas: string | undefined;
beforeEach(() => {
  fleetWas = process.env.SKULKR_FLEET;
  process.env.SKULKR_FLEET = temp('skulkr-fleet-');
});
afterEach(() => {
  if (fleetWas === undefined) delete process.env.SKULKR_FLEET;
  else process.env.SKULKR_FLEET = fleetWas;
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const area = (id: string) => ({
  id, files: [`${id}.txt`], a: 1, b: 1, m: 1, distinct: 1, chapman: 1, unfound: 0, read: { A: 1, B: 1 }, patches: 1, questions: 0,
  jobs: { weightedTokens: 1e6, costUsd: 1 }, fixCommits: [],
});

/** A project on `main` whose `shared.txt` main has changed since `frozen`, with a state dir and a green gate. */
const project = () => {
  const root = temp('skulkr-land-');
  const git = gitIn(root);
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'skulkr@example.invalid');
  git('config', 'user.name', 'skulkr');
  const put = (file: string, text: string) => {
    writeFileSync(join(root, file), text);
    git('add', file);
    git('commit', '-q', '-m', `${file}: ${text}`);
  };
  put('shared.txt', 'base');
  put('.gitignore', '.worktrees/\n');
  const frozen = git('rev-parse', 'HEAD');
  put('shared.txt', 'main');
  const cfg = resolveConfig({ state: temp('skulkr-state-'), record: { dir: 'audit-log' }, gate: { command: ['true'] } });
  /** `audit<round>-<id>` from `from`, writing `file`. */
  const branch = (round: number, id: string, file: string, from = frozen) => {
    const name = cfg.names.area(round, id);
    git('checkout', '-q', '-b', name, from);
    put(file, name);
    git('checkout', '-q', 'main');
    return name;
  };
  const night = async (round: number, branches: string[]) => {
    const said: string[] = [];
    const outcomes: Record<string, string> = {};
    const results = branches.map((b) => area(b.replace(cfg.names.area(round, ''), '')));
    const report = await batchAndTest({
      cfg, root, git, round, commit: frozen, date: '2026-11-21', nightDir: temp('skulkr-night-'), branches, results,
      sweep: undefined, outcomes, merge: true, say: (l: string) => said.push(l), setStep: () => {}, repair: undefined, baseline: undefined,
    });
    return { report, outcomes, said };
  };
  return { cfg, root, git, frozen, branch, night };
};

describe('batchAndTest', () => {
  it('names a conflict\'s paths, records the branch, and merges it in a later round once it merges cleanly', async () => {
    const { cfg, git, branch, night } = project();
    const clean = branch(3, 'a', 'a.txt');
    const clash = branch(3, 'b', 'shared.txt');
    const three = await night(3, [clean, clash]);
    expect(three.outcomes.b).toBe(`\`${clash}\`, left out: merge conflict in shared.txt`);
    expect(three.said).toContain(`batch: ${clash} left out: merge conflict in shared.txt`);
    expect(three.report).toMatch(/^main fast-forwarded/);
    expect(leftOutIn(cfg.state)).toEqual([{ branch: clash, round: 3, why: 'merge conflict in shared.txt' }]);

    // Round 4 tries it again; it still conflicts, so it stays recorded and the round's own area is unaffected.
    const c = branch(4, 'c', 'c.txt', git('rev-parse', 'main'));
    const four = await night(4, [c]);
    expect(four.outcomes).toEqual({ c: `\`${c}\`` });
    expect(four.report).toContain('retried 1 branches left out of earlier rounds, 0 merged and 1 still left out');
    expect(leftOutIn(cfg.state).map((e: { branch: string }) => e.branch)).toEqual([clash]);

    // Someone rebases it onto main; round 5 merges it and the record lets it go.
    git('checkout', '-q', clash);
    git('reset', '-q', '--hard', 'main');
    writeFileSync(join(git('rev-parse', '--show-toplevel'), 'shared.txt'), 'rebased');
    git('commit', '-q', '-am', 'rebased');
    git('checkout', '-q', 'main');
    const d = branch(5, 'd', 'd.txt', git('rev-parse', 'main'));
    const five = await night(5, [d]);
    expect(five.said).toContain(`batch: ${clash}, left out of round 3, merged`);
    expect(five.report).toContain('1 merged and 0 still left out');
    expect(readFileSync(join(git('rev-parse', '--show-toplevel'), 'shared.txt'), 'utf8')).toBe('rebased');
    expect(leftOutIn(cfg.state)).toEqual([]);
  });

  it('reports a merge that failed without conflicting as failed, with git\'s message', async () => {
    const { cfg, night } = project();
    const gone = cfg.names.area(3, 'gone');
    const three = await night(3, [gone]);
    expect(three.outcomes.gone).toMatch(new RegExp(`^\`${gone}\`, left out: merge failed: .*${gone}`));
    expect(three.outcomes.gone).not.toMatch(/conflict/);
  });
});
