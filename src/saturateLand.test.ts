import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveConfig } from './config.mjs';
import { emptyLedger, keepReview, withOccasion, writeLedger } from './ledger.mjs';
import { saturateCommand } from './saturate.mjs';
import { scouredAreasOf } from './saturationList.mjs';
import { moveFormerScourState } from './scourPaths.mjs';

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
    const dir = `.skulkr/scour/src/${commit.slice(0, 10)}`;
    expect(said.at(-1)).toMatch(new RegExp(`^landed ${dir}; main fast-forwarded to`));
    expect(git('log', '-1', '--format=%s')).toBe(`record src's scour ledger: 3 defects from 2 occasions at ${commit.slice(0, 10)}`);
    expect(JSON.parse(readFileSync(join(root, dir, 'ledger.json'), 'utf8'))).toEqual(ledger);
    expect(readFileSync(join(root, dir, 'reviews/02-claude.md'), 'utf8')).toBe('review 2\n');
    expect(readFileSync(join(root, dir, 'report.md'), 'utf8')).toContain('saturation');
    expect(git('branch', '--list', 'audit-scour-*')).toBe('');
    expect(git('worktree', 'list')).not.toMatch(/scour/);
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
    expect(said.at(-1)).toMatch(/on audit-scour-src, not fast-forwarded: the main checkout has uncommitted changes$/);
    expect(git('log', '-1', '--format=%s', 'audit-scour-src')).toMatch(/^record src's scour ledger/);
  });

  it('lands every ledger in one commit with --all', async () => {
    const { root, cfg, git } = project();
    const commit = git('rev-parse', 'HEAD');
    seed(cfg, commit, [['A', 'B']]);
    seed(cfg, commit, [['C']], 'lib');
    const said: string[] = [];
    await saturateCommand(cfg, null, root, ['land', '--all'], (line: string) => said.push(line));
    expect(said.at(-1)).toMatch(/^landed 2 ledgers under \.skulkr\/scour; main fast-forwarded to/);
    expect(git('log', '-1', '--format=%B')).toMatch(/^record 2 areas' scour ledgers: 3 defects\n\n- lib's scour ledger: 1 defects/);
    expect(git('rev-list', '--count', 'HEAD')).toBe('2');
    for (const area of ['src', 'lib']) {
      expect(readFileSync(join(root, '.skulkr/scour', area, commit.slice(0, 10), 'report.md'), 'utf8')).toContain(area);
    }
    expect(git('branch', '--list', 'audit-scour*')).toBe('');
    const registry = git('show', '--name-only', '--format=', 'HEAD').split('\n').filter((p: string) => p.startsWith('.skulkr/defects/'));
    expect(registry.sort()).toEqual(['.skulkr/defects/lib.jsonl', '.skulkr/defects/src.jsonl']);
  });

  it('refuses an area with no ledger', async () => {
    const { root, cfg } = project();
    await expect(land(cfg, root)).rejects.toThrow('src has no saturation ledger');
    expect(existsSync(join(cfg.state, 'scour/src'))).toBe(false);
  });

  it('moves a ledger landed under the former saturation/ to scour/ when it lands again', async () => {
    const { root, cfg, git } = project();
    const commit = git('rev-parse', 'HEAD');
    seed(cfg, commit, [['A']]);
    await land(cfg, root);
    const short = commit.slice(0, 10);
    git('mv', '.skulkr/scour', '.skulkr/saturation');
    git('commit', '-qm', 'as landed before the rename');
    expect(scouredAreasOf(cfg, root, 'claude')).toEqual(['src']);
    seed(cfg, commit, [['A'], ['B']]);
    await land(cfg, root);
    expect(git('ls-files', '.skulkr/saturation')).toBe('');
    expect(existsSync(join(root, `.skulkr/scour/src/${short}/ledger.json`))).toBe(true);
  });
});

describe('the scour directories', () => {
  it('moves the state directory\'s saturation/ to scour/ once', () => {
    const { cfg } = project();
    mkdirSync(join(cfg.state, 'saturation/src'), { recursive: true });
    moveFormerScourState(cfg);
    expect(existsSync(join(cfg.state, 'scour/src'))).toBe(true);
    expect(existsSync(join(cfg.state, 'saturation'))).toBe(false);
  });

  it('names the areas holding an occasion from a source, landed or not', async () => {
    const { root, cfg, git } = project();
    const commit = git('rev-parse', 'HEAD');
    seed(cfg, commit, [['A']]);
    await land(cfg, root);
    rmSync(join(cfg.state, 'scour'), { recursive: true });
    seed(cfg, commit, [['B']], 'lib');
    expect(scouredAreasOf(cfg, root, 'claude')).toEqual(['lib', 'src']);
    expect(scouredAreasOf(cfg, root, 'codex')).toEqual([]);
  });
});
