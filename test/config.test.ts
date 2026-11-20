import { describe, expect, it } from 'vitest';
import { configPath, merge, resolveConfig } from '../src/config.mjs';
import { loadRunner } from '../src/runner/index.mjs';
import { ontoArgs } from '../src/runner/onto.mjs';
import { weaselConfig } from './weaselConfig.ts';

describe('resolveConfig', () => {
  it('lays a project config over the defaults, objects key by key and arrays whole', () => {
    expect(merge({ a: { b: 1, c: 2 }, l: [1, 2] }, { a: { c: 3 }, l: [9] })).toEqual({ a: { b: 1, c: 3 }, l: [9] });
    const cfg = resolveConfig({ name: 'demo', budget: { capUsd: 20 } });
    expect(cfg.budget).toMatchObject({ capUsd: 20, review: 8, fix: 15 });
    expect(cfg.state).toMatch(/\.local\/state\/skulk\/demo$/);
    expect(cfg.names.trees).toEqual({ review: 'demo-skulk-r', fix: 'demo-skulk-f' });
  });

  it('names branches, jobs and worktrees from the naming prefixes, and reads them back', () => {
    const cfg = resolveConfig({ naming: { prefix: 'sweep', batchPrefix: 'land' } });
    expect(cfg.names.area(7, 'ui')).toBe('sweep7-ui');
    expect(cfg.names.batch('2026-11-20', 7)).toBe('land/2026-11-20-sweep7');
    expect(cfg.names.areaOf.exec('sweep7-core.x')?.[1]).toBe('core.x');
    expect(cfg.names.roundIn.exec('land/2026-11-20-sweep12')?.[1]).toBe('12');
    expect(cfg.names.step.exec('sweep7-ui-match')?.slice(1)).toEqual(['ui', 'match']);
  });

  it('spots cited paths under the partition\'s top directories, or any path when a root has none', () => {
    const where = 'packages/core/src/a.ts:3 and lib/b.py:9';
    expect([...where.matchAll(weaselConfig().citedRe)].map((m) => m[1])).toEqual(['packages/core/src/a.ts']);
    expect([...where.matchAll(resolveConfig({ partition: { roots: ['*'] } }).citedRe)].map((m) => m[1])).toEqual(['packages/core/src/a.ts', 'lib/b.py']);
  });

  it('reproduces weasel\'s own constants', () => {
    const cfg = weaselConfig();
    expect(String(cfg.partition.rootRe)).toBe(String(/^(packages\/[^/]+\/src|apps\/[^/]+)\//));
    expect(cfg.partition.path).toBe('docs/audits/partition.json');
    expect(cfg.names.trees).toEqual({ review: 'weasel-skulk-r', fix: 'weasel-skulk-f' });
    expect(cfg.state).toMatch(/\.local\/state\/weasel-skulk$/);
  });
});

describe('configPath', () => {
  it('takes --config, then SKULK_CONFIG, then skulk.config.mjs in --root, SKULK_ROOT or the working directory', () => {
    expect(configPath({ config: '/a/c.mjs', root: '/r' }, { SKULK_CONFIG: '/e.mjs' })).toBe('/a/c.mjs');
    expect(configPath({ root: '/r' }, { SKULK_CONFIG: '/e.mjs' })).toBe('/e.mjs');
    expect(configPath({ root: '/r' }, {})).toBe('/r/skulk.config.mjs');
    expect(configPath({}, { SKULK_ROOT: '/s' })).toBe('/s/skulk.config.mjs');
  });
});

describe('runners', () => {
  it('builds onto do as weasel\'s jobs always did', () => {
    const args = ontoArgs({ kind: 'fix', node: 'studio', tree: 'weasel-skulk-f1', ref: 'abc', timeout: '55m', expect: 'none', task: 't', about: 'a', out: '.skulk/out', to: '/to', env: { K: 'v' }, shell: 'true' });
    expect(args).toEqual(['do', '--kind', 'fix', '--node', 'studio', '--in', 'weasel-skulk-f1', '--ref', 'abc', '--force', '--timeout', '55m', '--expect', 'none',
      '--task', 't', '--about', 'a', '--icon', 'wrench.and.screwdriver', '--out', '.skulk/out', '--to', '/to', '--env', 'K=v', '--', 'bash', '-lc', 'true']);
  });

  it('takes a runner object from the config, and refuses one missing part of the interface', async () => {
    const runner = { run: async () => ({ status: 0 }), unavailableNodes: () => new Set(), jobs: () => [] };
    expect(await loadRunner(resolveConfig({ runner }))).toBe(runner);
    await expect(loadRunner(resolveConfig({ runner: { run: () => 0 } }))).rejects.toThrow('lacks unavailableNodes, jobs');
  });
});
