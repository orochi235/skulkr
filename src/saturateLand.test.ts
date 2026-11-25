import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveConfig } from './config.mjs';
import { emptyLedger, keepReview, withOccasion, writeLedger } from './ledger.mjs';
import { saturateCommand } from './saturate.mjs';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const scratch = () => {
  const d = mkdtempSync(join(tmpdir(), 'skulkr-satland-'));
  dirs.push(d);
  return d;
};

const project = () => {
  const root = scratch();
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  git('init', '-q', '-b', 'main');
  git('config', 'user.name', 't');
  git('config', 'user.email', 't@t');
  mkdirSync(join(root, 'src'));
  writeFileSync(join(root, 'src/x.ts'), 'export const x = 1;\n');
  git('add', '.');
  git('commit', '-qm', 'init');
  const cfg = resolveConfig({ name: 'proj', state: scratch(), root, git: { push: false } }, { root });
  return { root, cfg, git };
};

/** A ledger for `src` at `main`'s tip with one occasion per list of claims, each claim a defect the first time it is seen. */
const seed = (cfg: any, commit: string, occasions: string[][], area = 'src') => {
  let ledger = emptyLedger(area, commit, ['src/x.ts']);
  for (const [i, claims] of occasions.entries()) {
    const n = i + 1;
    const file = keepReview(cfg, area, n, 'claude', `review ${n}\n`);
    const known = new Map(ledger.defects.map((d: any) => [d.claim, d.id]));
    ledger = withOccasion(ledger, { n, source: 'claude', kind: 'review', file, costUsd: 1, minutes: 1 }, {
      findings: claims.map((claim) => ({ claim, where: 'src/x.ts:1' })),
      sightings: claims.flatMap((c, f) => (known.has(c) ? [{ finding: f, defect: known.get(c) }] : [])),
      new: claims.flatMap((c, f) => (known.has(c) ? [] : [{ finding: f, claim: c, where: 'src/x.ts:1', severity: 'low' }])),
    });
  }
  writeLedger(cfg, ledger);
  return ledger;
};

const land = async (cfg: any, root: string, id = 'src') => {
  const said: string[] = [];
  await saturateCommand(cfg, null, root, ['land', id], (line: string) => said.push(line));
  return said;
};

describe('skulkr saturate land', () => {
  it('commits the ledger and its reviews to main and deletes its branch', async () => {
    const { root, cfg, git } = project();
    const commit = git('rev-parse', 'HEAD');
    const ledger = seed(cfg, commit, [['A', 'B'], ['B', 'C']]);
    const said = await land(cfg, root);
    const dir = `.skulkr/saturation/src/${commit.slice(0, 10)}`;
    expect(said.at(-1)).toMatch(new RegExp(`^landed ${dir}; main fast-forwarded to`));
    expect(git('log', '-1', '--format=%s')).toBe(`record src's saturation ledger: 3 defects from 2 occasions at ${commit.slice(0, 10)}`);
    expect(JSON.parse(readFileSync(join(root, dir, 'ledger.json'), 'utf8'))).toEqual(ledger);
    expect(readFileSync(join(root, dir, 'reviews/02-claude.md'), 'utf8')).toBe('review 2\n');
    expect(readFileSync(join(root, dir, 'report.md'), 'utf8')).toContain('saturation');
    expect(git('branch', '--list', 'audit-saturation-*')).toBe('');
    expect(git('worktree', 'list')).not.toMatch(/saturation/);
  });

  it('replaces an earlier landing of the same ledger, and lands nothing when it has not changed', async () => {
    const { root, cfg, git } = project();
    const commit = git('rev-parse', 'HEAD');
    seed(cfg, commit, [['A']]);
    await land(cfg, root);
    seed(cfg, commit, [['A'], ['A', 'B']]);
    await land(cfg, root);
    expect(git('log', '-1', '--format=%s')).toMatch(/2 defects from 2 occasions/);
    const before = git('rev-parse', 'HEAD');
    expect((await land(cfg, root)).at(-1)).toMatch(/already holds this ledger; nothing to land$/);
    expect(git('rev-parse', 'HEAD')).toBe(before);
  });

  it('keeps the branch when main cannot fast-forward', async () => {
    const { root, cfg, git } = project();
    seed(cfg, git('rev-parse', 'HEAD'), [['A']]);
    writeFileSync(join(root, 'src/x.ts'), 'export const x = 2;\n');
    const said = await land(cfg, root);
    expect(said.at(-1)).toMatch(/on audit-saturation-src, not fast-forwarded: the main checkout has uncommitted changes$/);
    expect(git('log', '-1', '--format=%s', 'audit-saturation-src')).toMatch(/^record src's saturation ledger/);
  });

  it('lands every ledger in one commit with --all', async () => {
    const { root, cfg, git } = project();
    const commit = git('rev-parse', 'HEAD');
    seed(cfg, commit, [['A', 'B']]);
    seed(cfg, commit, [['C']], 'lib');
    const said: string[] = [];
    await saturateCommand(cfg, null, root, ['land', '--all'], (line: string) => said.push(line));
    expect(said.at(-1)).toMatch(/^landed 2 ledgers under \.skulkr\/saturation; main fast-forwarded to/);
    expect(git('log', '-1', '--format=%B')).toMatch(/^record 2 areas' saturation ledgers: 3 defects\n\n- lib's saturation ledger: 1 defects/);
    expect(git('rev-list', '--count', 'HEAD')).toBe('2');
    for (const area of ['src', 'lib']) {
      expect(readFileSync(join(root, '.skulkr/saturation', area, commit.slice(0, 10), 'report.md'), 'utf8')).toContain(area);
    }
    expect(git('branch', '--list', 'audit-saturation*')).toBe('');
  });

  it('refuses an area with no ledger', async () => {
    const { root, cfg } = project();
    await expect(land(cfg, root)).rejects.toThrow('src has no saturation ledger');
    expect(existsSync(join(cfg.state, 'saturation/src'))).toBe(false);
  });
});
