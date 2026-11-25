import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { gitIn } from './batch.mjs';
import { resolveConfig } from './config.mjs';
import { indexPathOf, queryIndex, rowsText } from './recordIndex.mjs';
import { writeRegistry } from './registry.mjs';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** A project whose record holds round 3 of area `x`, with one finding its fixer fixed and one it left. */
const project = () => {
  const root = mkdtempSync(join(tmpdir(), 'skulkr-index-'));
  dirs.push(root);
  const git = gitIn(root);
  git('init', '-q', '-b', 'main');
  git('config', 'user.name', 't');
  git('config', 'user.email', 't@t');
  const cfg = resolveConfig({ name: 'p', root }, { root });
  const at = join(root, '.skulkr/round-3/x');
  mkdirSync(at, { recursive: true });
  writeFileSync(join(root, '.skulkr/.gitignore'), 'cache/\n');
  writeFileSync(join(root, '.skulkr/partition.json'), JSON.stringify([{ id: 'x', files: ['src/x.ts', 'src/y.ts'] }]));
  writeFileSync(join(at, 'A.md'), '## A leak in x\n- where: src/x.ts:1\n- severity: high\n\n## A race in y\n- where: src/y.ts:2\n');
  writeFileSync(join(at, 'match.json'), JSON.stringify({ pairs: [], a: ['A leak in x', 'A race in y'], b: [] }));
  writeFileSync(join(at, 'fix.md'), '- A leak in x (A): fixed 1a2b3c4d\n');
  writeFileSync(join(at, 'area.json'), JSON.stringify({ id: 'x', files: ['src/x.ts', 'src/y.ts'], a: 2, b: 0, m: 0, distinct: 2, commit: 'c0ffee', date: '2026-11-25', jobs: { costUsd: 3.5 } }));
  writeFileSync(join(root, '.skulkr/round-3/usage.jsonl'), `${JSON.stringify({ area: 'x', role: 'review-A', costUsd: 1.25, models: ['opus'] })}\n`);
  writeRegistry(cfg, git, root);
  git('add', '-A');
  git('commit', '-qm', 'record');
  return { root, cfg, git };
};

describe('the index', () => {
  it('answers queries over the registry, the passes and the jobs, built once and again only when the record changes', () => {
    const { root, cfg, git } = project();
    expect(queryIndex(cfg, git, root, 'select claim, status, severity, resolved_sha from defects order by claim')).toEqual([
      { claim: 'A leak in x', status: 'fixed', severity: 'high', resolved_sha: '1a2b3c4d' },
      { claim: 'A race in y', status: 'open', severity: '', resolved_sha: null },
    ]);
    expect(queryIndex(cfg, git, root, 'select round, area, "distinct", cost_usd from passes')).toEqual([{ round: 3, area: 'x', distinct: 2, cost_usd: 3.5 }]);
    expect(queryIndex(cfg, git, root, 'select role, cost_usd from jobs')).toEqual([{ role: 'review-A', cost_usd: 1.25 }]);
    const built = statSync(indexPathOf(cfg, root)).mtimeMs;
    expect(git('status', '--porcelain')).toBe('');
    queryIndex(cfg, git, root, 'select 1');
    expect(statSync(indexPathOf(cfg, root)).mtimeMs).toBe(built);
    writeFileSync(join(root, '.skulkr/round-3/x/fix.md'), '- A leak in x (A): fixed 1a2b3c4d\n- A race in y (A): not a defect\n');
    writeRegistry(cfg, git, root);
    expect(queryIndex(cfg, git, root, "select status from defects where claim = 'A race in y'")).toEqual([{ status: 'dismissed' }]);
  });

  it('prints rows as columns, numbers to the right', () => {
    expect(rowsText([{ area: 'x', n: 5 }, { area: 'longer', n: 12 }])).toEqual(['area     n', 'x        5', 'longer  12']);
    expect(rowsText([])).toEqual(['(no rows)']);
  });
});
