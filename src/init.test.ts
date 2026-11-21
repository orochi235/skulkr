import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { resolveConfig } from './config.mjs';
import { NO_GATE, configText, guessConfig } from './init.mjs';

const load = async (text: string) => {
  const dir = mkdtempSync(join(tmpdir(), 'skulkr-init-'));
  try {
    const file = join(dir, 'skulkr.config.mjs');
    writeFileSync(file, text);
    return resolveConfig((await import(pathToFileURL(file).href)).default, { file });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

describe('skulkr init', () => {
  it('guesses roots, extensions, checks, and the install from the tracked files and package.json', async () => {
    const files = ['package.json', 'package-lock.json', 'src/a.ts', 'src/b.tsx', 'packages/core/src/c.ts', 'docs/x.md', 'scripts/s.mjs'];
    const pkg = { scripts: { test: 'vitest run', typecheck: 'tsc' }, devDependencies: { vitest: '^5' } };
    const g = guessConfig(files, pkg, 'demo');
    expect(g).toMatchObject({ roots: ['src', 'packages/*/src'], extensions: ['ts', 'tsx'], gate: ['npm', 'test'], typecheck: 'npm run typecheck', lint: null });
    const cfg = await load(configText(g));
    expect(cfg.name).toBe('demo');
    expect(cfg.partition.isSource('packages/core/src/c.ts')).toBe(true);
    expect(cfg.partition.isSource('scripts/s.mjs')).toBe(false);
    expect(cfg.checks.verify.command).toBe('npx vitest related --run {files}');
    expect(cfg.setup.install).toEqual({ lockfile: 'package-lock.json', command: 'npm ci --no-audit --no-fund', marker: 'node_modules/.skulkr-lock' });
    expect(cfg.runner).toBe('local');
  });

  it('writes a config that loads for a repository with no package.json or known source root', async () => {
    const g = guessConfig(['main.go', 'util/x.go', 'net/y.go', 'test/z.go', 'docs/a.md'], null, 'gotool');
    expect(g).toMatchObject({ roots: ['net', 'util'], extensions: ['go'], gate: null, install: null });
    const cfg = await load(configText(g));
    expect(cfg.partition.isSource('util/x.go')).toBe(true);
    expect(cfg.gate.command).toEqual(NO_GATE);
    expect(spawnSync(cfg.gate.command[0], cfg.gate.command.slice(1), { encoding: 'utf8' })).toMatchObject({ status: 1, stderr: expect.stringContaining('no gate command set') });
    expect(cfg.checks.verify).toBeNull();
  });
});
