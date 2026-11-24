import { describe, expect, it } from 'vitest';
import { configPath, merge, resolveConfig } from '../src/config.mjs';
import { loadRunner } from '../src/runner/index.mjs';
import { nodeOfLaunch, ontoArgs } from '../src/runner/onto.mjs';
import weasel from '../examples/weasel.config.mjs';
import { weaselConfig } from './weaselConfig.ts';

describe('resolveConfig', () => {
  it('lays a project config over the defaults, objects key by key and arrays whole', () => {
    expect(merge({ a: { b: 1, c: 2 }, l: [1, 2] }, { a: { c: 3 }, l: [9] })).toEqual({ a: { b: 1, c: 3 }, l: [9] });
    const cfg = resolveConfig({ name: 'demo', budget: { capUsd: 20 } });
    expect(cfg.budget).toMatchObject({ capUsd: 20, review: 8, fix: 15 });
    expect(cfg.state).toMatch(/\.local\/state\/skulkr\/demo$/);
    expect(cfg.names.trees).toEqual({ review: 'demo-skulkr-r', fix: 'demo-skulkr-f' });
  });

  it('names branches, jobs and worktrees from the naming prefixes, and reads them back', () => {
    const cfg = resolveConfig({ naming: { prefix: 'sweep', batchPrefix: 'land' } });
    expect(cfg.names.area(7, 'ui')).toBe('sweep7-ui');
    expect(cfg.names.batch('2026-11-20', 7)).toBe('land/2026-11-20-sweep7');
    expect(cfg.names.branchOf('sweep7-core.x')).toEqual({ round: 7, id: 'core.x' });
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
    expect(cfg.names.trees).toEqual({ review: 'weasel-skulkr-r', fix: 'weasel-skulkr-f' });
    expect(cfg.state).toMatch(/\.local\/state\/weasel-skulkr$/);
  });
});

describe('configPath', () => {
  it('takes --config, then SKULKR_CONFIG, then skulkr.config.mjs in --root, SKULKR_ROOT or the working directory', () => {
    expect(configPath({ config: '/a/c.mjs', root: '/r' }, { SKULKR_CONFIG: '/e.mjs' })).toBe('/a/c.mjs');
    expect(configPath({ root: '/r' }, { SKULKR_CONFIG: '/e.mjs' })).toBe('/e.mjs');
    expect(configPath({ root: '/r' }, {})).toBe('/r/skulkr.config.mjs');
    expect(configPath({}, { SKULKR_ROOT: '/s' })).toBe('/s/skulkr.config.mjs');
  });
});

describe('runners', () => {
  it('builds onto do as weasel\'s jobs always did', () => {
    const args = ontoArgs({ kind: 'fix', node: 'studio', tree: 'weasel-skulkr-f1', ref: 'abc', timeout: '55m', expect: 'none', task: 't', about: 'a', out: '.skulkr/out', to: '/to', env: { K: 'v' }, shell: 'true' });
    expect(args).toEqual(['do', '--kind', 'fix', '--node', 'studio', '--in', 'weasel-skulkr-f1', '--ref', 'abc', '--force', '--timeout', '55m', '--expect', 'none',
      '--task', 't', '--about', 'a', '--icon', 'wrench.and.screwdriver', '--out', '.skulkr/out', '--to', '/to', '--env', 'K=v', '--', 'bash', '-lc', 'true']);
  });

  it('defaults to the local runner, its one node, and slots for one machine; a fleet runner keeps 6 each', () => {
    expect(resolveConfig({}).runner).toBe('local');
    expect(resolveConfig({}).nodes).toMatchObject({ list: ['local'], reviewSlots: 3, fixSlots: 2 });
    expect(resolveConfig({ nodes: { fixSlots: 1 } }).nodes).toMatchObject({ reviewSlots: 3, fixSlots: 1 });
    expect(resolveConfig({ runner: 'onto' }).nodes).toMatchObject({ list: [], reviewSlots: 6, fixSlots: 6 });
    expect(resolveConfig({ runner: 'onto', nodes: { list: ['a', 'b'] } }).concurrency).toEqual({ review: 12, fix: 12 });
    expect(weaselConfig().concurrency).toEqual({ review: 18, fix: 18 });
  });

  it('reads the node onto started a job on, and names none when skulkr leaves the choice to it', () => {
    expect(nodeOfLaunch('  delta  18 file(s)\n  job    a121b063 on teitou\n')).toBe('teitou');
    expect(nodeOfLaunch('waiting: studio ~4m')).toBeUndefined();
    expect(ontoArgs({ kind: 'review', ref: 'abc', timeout: '1m', expect: '8m', task: 't', about: 'a', out: 'o', to: '/to', shell: 'true' })).not.toContain('--node');
  });

  it('takes a runner object from the config, and refuses one missing part of the interface', async () => {
    const runner = { run: async () => ({ status: 0 }), unavailableNodes: () => new Set(), jobs: () => [] };
    expect(await loadRunner(resolveConfig({ runner }))).toBe(runner);
    await expect(loadRunner(resolveConfig({ runner: { run: () => 0 } }))).rejects.toThrow('lacks unavailableNodes, jobs');
  });
});

describe('local mode', () => {
  const env = { CLAUDE_CONFIG_DIR: '/acct/starting' };

  it('runs every job on this machine as the starting account, pushes nothing, and refuses the web tools', () => {
    const cfg = resolveConfig({ runner: 'onto', concurrency: { review: 18 }, nodes: { list: ['studio'], fixSlots: 6 }, claude: { configDir: '~/.other' } }, { local: true, env });
    expect(cfg.local.on).toBe(true);
    expect(cfg.runner).toBe('local');
    expect(cfg.nodes).toMatchObject({ list: ['local'], local: null, reviewSlots: 3, fixSlots: 2 });
    expect(cfg.concurrency).toEqual({ review: 3, fix: 2 });
    expect(cfg.git).toMatchObject({ remote: 'origin', push: false });
    expect(cfg.claude.configDir).toBe('/acct/starting');
    expect(cfg.claude.denied).toEqual(['WebFetch', 'WebSearch']);
  });

  it('falls back to the config\'s account, and is off unless asked for or enabled', () => {
    expect(resolveConfig({ claude: { configDir: '~/.other' } }, { local: true, env: {} }).claude.configDir).toBe('~/.other');
    expect(resolveConfig({ local: { enabled: true } }, { env: {} }).local.on).toBe(true);
    const off = resolveConfig({ runner: 'onto' }, { env });
    expect([off.local.on, off.runner, off.git.push, off.claude.denied]).toEqual([false, 'onto', true, []]);
  });

  it('replaces whole the settings its override names, and refuses an agent other than claude', () => {
    const cfg = resolveConfig({ gate: { name: 'fleet', jobs: { build: 'x' } }, local: { override: { gate: { name: 'here' } } } }, { local: true, env });
    expect(cfg.gate).toMatchObject({ name: 'here', jobs: {} });
    expect(() => resolveConfig({ agent: { review: 'codex' } }, { local: true, env })).toThrow('local mode runs every job on claude; the config\'s agent names codex');
  });

  it('runs weasel\'s gate as its own suite on this machine', () => {
    const cfg = resolveConfig({ ...weasel }, { file: new URL('../examples/weasel.config.mjs', import.meta.url).pathname, local: true, env });
    expect(cfg.gate.command[2]).toMatch(/export PATH="\$NVM_BIN:\$PATH"; npm ci --no-audit --no-fund && npm test /);
    expect(Object.keys(cfg.gate.progress)).toEqual(['tests']);
    expect(cfg.checks.preflight.gateArgs).toEqual([]);
    expect(weaselConfig().gate.name).toBe('test:batch');
  });
});
