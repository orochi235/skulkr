import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { writeLedger } from './ledger.mjs';
import { scourFix } from './scourFix.mjs';
import { fixBranchesOf, stackBranchFor } from './scourFixBase.mjs';
import { fixRunsIn } from './scourFixStatus.mjs';
import { project, scratch } from './scourTestKit.ts';

const run = (n: number, area: string, batches: { n: number; branch: string | null; ok?: boolean }[]) => ({
  n, dir: '', jobs: [] as string[], record: { area, batches: batches.map((b) => ({ n: b.n, branch: b.branch, verify: b.ok === undefined ? null : { ok: b.ok } })) },
});

/** A runner whose fixer commits one file per batch on top of the tree it was handed, and notes the commit it saw. */
const fixingRunner = () => {
  const seen: string[] = [];
  const runner = {
    unavailableNodes: () => new Set(), jobs: () => [],
    run: async (job: { to: string; task: string }, { cwd }: { cwd: string }) => {
      mkdirSync(job.to, { recursive: true });
      writeFileSync(join(job.to, 'exit'), '0');
      const git = (dir: string, ...a: string[]) => execFileSync('git', a, { cwd: dir, encoding: 'utf8' }).trim();
      const head = git(cwd, 'rev-parse', 'HEAD');
      seen.push(head);
      const k = /~b(\d+)-fix$/.exec(job.task)?.[1] ?? '0';
      const tree = join(scratch(), 'w');
      git(cwd, 'worktree', 'add', '-q', '--detach', tree, head);
      writeFileSync(join(tree, 'src', `b${k}.ts`), `export const b${k} = ${Math.random()};\n`);
      git(tree, 'add', '.');
      git(tree, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', `fix b${k}\n\nDefect: D${k}`);
      writeFileSync(join(job.to, 'fix.mbox'), git(tree, 'format-patch', '-1', '--stdout') + '\n');
      git(cwd, 'worktree', 'remove', '--force', tree);
      writeFileSync(join(job.to, 'claude.json'), JSON.stringify({ type: 'result', is_error: false, result: `[D${k}] fixed\ntally: 1 of 1 fixed, 0 extra fixed`, total_cost_usd: 0.1 }));
      return { status: 0 };
    },
  };
  return { runner, seen };
};

describe('stacking scour fix batches', () => {
  it('lists an area\'s fix branches newest first, by run and then batch', () => {
    const runs = [run(1, 'a', [{ n: 6, branch: 'scour1-a-b6' }]), run(2, 'a', [{ n: 1, branch: 'scour2-a-b1' }, { n: 2, branch: null }, { n: 3, branch: 'scour2-a-b3', ok: false }]), run(3, 'b', [{ n: 1, branch: 'scour3-b-b1' }])];
    expect(fixBranchesOf('a', runs).map((b: { branch: string }) => b.branch)).toEqual(['scour2-a-b3', 'scour2-a-b1', 'scour1-a-b6']);
  });

  it('stacks on the newest branch that verified, unless it is gone or main holds it', () => {
    const { root, cfg, git } = project();
    git('branch', 'scour1-src-b1');
    git('checkout', '-q', '-b', 'scour2-src-b1');
    writeFileSync(join(root, 'src', 'y.ts'), 'export const y = 1;\n');
    git('add', '.');
    git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'y');
    git('checkout', '-q', 'main');
    const runs = [run(1, 'src', [{ n: 1, branch: 'scour1-src-b1' }]), run(2, 'src', [{ n: 1, branch: 'scour2-src-b1' }, { n: 2, branch: 'scour2-src-b2', ok: false }])];
    expect(stackBranchFor(cfg, root, 'src', runs)).toBe('scour2-src-b1');
    expect(stackBranchFor(cfg, root, 'src', [runs[0]])).toBeNull();
    expect(stackBranchFor(cfg, root, 'src', [run(3, 'src', [{ n: 1, branch: 'scour3-src-b1' }])])).toBeNull();
  });

  it('fixes each batch on the last one\'s branch, and a later run on the area\'s newest branch', async () => {
    const { root, cfg, git } = project();
    const main = git('rev-parse', 'main');
    const defect = (k: number) => ({ id: `D${k}`, claim: `claim ${k}`, where: `src/f.ts:${k}`, sightings: [1] });
    writeLedger(cfg, { area: 'src', commit: main, files: ['src/f.ts'], occasions: Array.from({ length: 10 }, () => ({})), defects: Array.from({ length: 9 }, (_, k) => defect(k + 1)) });
    const said: string[] = [];
    const first = fixingRunner();
    const record = await scourFix(cfg, first.runner, root, 'src', {}, (l: string) => said.push(l));
    expect(record.batches.map((b: { branch: string }) => b.branch)).toEqual(['scour1-src-b1', 'scour1-src-b2']);
    expect(first.seen).toEqual([main, git('rev-parse', 'scour1-src-b1')]);
    expect(git('rev-parse', 'scour1-src-b2^')).toBe(git('rev-parse', 'scour1-src-b1'));
    expect(said[0]).toContain("`main`'s tip");

    const second = fixingRunner();
    said.length = 0;
    await scourFix(cfg, second.runner, root, 'src', { defects: 'D1' }, (l: string) => said.push(l));
    expect(fixRunsIn(cfg).length).toBe(2);
    expect(second.seen).toEqual([git('rev-parse', 'scour1-src-b2')]);
    expect(said[0]).toContain("the tip of `scour1-src-b2`, the area's newest fix branch");
  });
});
