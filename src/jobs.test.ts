import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ontoArgs } from './runner/onto.mjs';
import { resolveConfig } from './config.mjs';
import { STARTED, fixShell, fixupLines, installLines, matchShell, repairShell, reviewShell, stoppedBeforeModel, timeoutOf, verifyShell } from './jobs.mjs';
import { weaselConfig } from '../test/weaselConfig.ts';

const claudeOf = (shell: string) => shell.split(/ && |\n/).find((part) => part.includes('claude -p'))!;

describe('job command lines', () => {
  it("start every job without the account's settings, naming weasel's model and effort", () => {
    const cfg = weaselConfig();
    const review = claudeOf(reviewShell(cfg, 'core', 8));
    const fix = claudeOf(fixShell(cfg, 'core', 15, 3));
    const match = claudeOf(matchShell(cfg, 'core', 1));
    for (const line of [review, fix, match]) expect(line).toContain('--strict-mcp-config --setting-sources project,local');
    expect(review).toContain('--model opus --effort medium');
    expect(fix).toContain('--model opus --effort medium');
    expect(match).toContain('--model haiku');
    expect(match).not.toContain('--effort');
  });

  it("give a trial's preloaded prompt on stdin, too large for one argument", () => {
    const cfg = weaselConfig();
    const line = claudeOf(reviewShell(cfg, 'core', 8, 'review-preload.md', true));
    expect(line).toContain("claude -p < '.skulkr/in/core/review-preload.md'");
    expect(line).not.toContain('$(cat');
    expect(claudeOf(reviewShell(cfg, 'core', 8))).toContain('claude -p "$(cat');
  });

  it('ask for a five-minute cache for every role, and none where the config unsets it', () => {
    const cfg = resolveConfig({});
    expect(claudeOf(reviewShell(cfg, 'core', 8))).toContain('CLAUDE_CODE_PROMPT_CACHE_TTL=5m');
    expect(claudeOf(matchShell(cfg, 'core', 1))).toContain('CLAUDE_CODE_PROMPT_CACHE_TTL=5m');
    expect(claudeOf(fixShell(cfg, 'core', 15, 3))).toContain('CLAUDE_CODE_PROMPT_CACHE_TTL=5m');
    expect(claudeOf(repairShell(cfg, 'core', 15))).toContain('CLAUDE_CODE_PROMPT_CACHE_TTL=5m');
    expect(claudeOf(reviewShell(resolveConfig({ claude: { cacheTtl: { review: null } } }), 'core', 8))).not.toContain('CACHE_TTL');
  });

  it('mark every model job started just before claude runs, and no job that runs no model', () => {
    const cfg = weaselConfig();
    for (const shell of [reviewShell(cfg, 'core', 8), matchShell(cfg, 'core', 1), fixShell(cfg, 'core', 15, 3), repairShell(cfg, 'core', 15)]) {
      const at = shell.indexOf(`> .skulkr/out/${STARTED} &&`);
      expect(at).toBeGreaterThan(-1);
      expect(shell.indexOf('claude -p')).toBeGreaterThan(at);
      expect(shell.slice(at, shell.indexOf('claude -p'))).not.toMatch(/\n/);
    }
    expect(verifyShell(cfg, 'core')).not.toContain(STARTED);
  });

  it("keep a reviewer's shell in the tree's root, where its write rule is anchored", () => {
    const cfg = resolveConfig({});
    expect(claudeOf(reviewShell(cfg, 'core', 8))).toContain('CLAUDE_BASH_MAINTAIN_PROJECT_WORKING_DIR=1');
    expect(claudeOf(fixShell(cfg, 'core', 15, 3))).not.toContain('MAINTAIN_PROJECT_WORKING_DIR');
  });

  it('leave the model, effort, and setting sources to the node where the config leaves them unset', () => {
    const cfg = resolveConfig({ claude: { settingSources: null } });
    const review = claudeOf(reviewShell(cfg, 'core', 8));
    expect(review).not.toMatch(/--model|--effort|--setting-sources/);
  });
});

describe('ontoArgs', () => {
  const job = { kind: 'review', node: 'teitou', ref: 'abc', timeout: '40m', expect: 'none', task: 't', about: 'a', out: 'o', to: 'd', shell: 'true' };

  it('asks for a GUI session only for a job that needs one', () => {
    expect(ontoArgs(job)).not.toContain('--gui');
    expect(ontoArgs({ ...job, kind: 'test', gui: true }).slice(0, 4)).toEqual(['do', '--gui', '--kind', 'test']);
  });

  it("names no tree, so onto runs the job in one of the repository's pooled trees", () => {
    expect(ontoArgs(job)).not.toContain('--in');
    expect(ontoArgs({ ...job, tree: 'weasel-dev' })).toEqual(expect.arrayContaining(['--in', 'weasel-dev']));
  });
});

describe('verify and repair job lines', () => {
  const cfg = weaselConfig();
  const lines = (shell: string) => shell.split('\n');
  const at = (shell: string, part: string) => lines(shell).findIndex((l) => l.includes(part));

  it("run weasel's verify step in the fixer's own job, after the model and its mbox", () => {
    const shell = fixShell(cfg, 'core', 15, 3);
    expect(at(shell, 'claude -p')).toBeLessThan(at(shell, 'git format-patch'));
    expect(at(shell, 'git format-patch')).toBeLessThan(at(shell, 'vitest related --run --maxWorkers=4'));
    expect(shell).toContain("--project='\\''!browser*'\\''");
    expect(shell).toContain('vitest list --filesOnly');
    expect(fixShell(resolveConfig({}), 'core', 15, 3)).not.toContain('VERIFY_FILES');
  });

  it("give a repair the area's commits before the model, and verify every commit since the frozen tree", () => {
    const shell = repairShell(cfg, 'core', 15);
    expect(at(shell, 'BASE=$(git rev-parse HEAD)')).toBeLessThan(at(shell, 'git am'));
    expect(at(shell, "git am -q --3way --keep-cr '.skulkr/in/core/area.mbox'")).toBeLessThan(at(shell, 'claude -p'));
    expect(shell).toContain('.skulkr/in/core/repair.md');
    expect(shell).toContain('git format-patch --stdout "$BASE..HEAD"');
  });

  it("run the GUI part's own command with no probe in a GUI verify job", () => {
    const shell = verifyShell(cfg, 'core', { gui: true });
    expect(shell).not.toContain('claude -p');
    expect(shell).toContain("vitest related --run --maxWorkers=2 --project='\\''browser*'\\''");
    expect(shell).not.toContain('vitest list');
  });

  it("time a job by its model's minutes and the verify step's", () => {
    expect(timeoutOf(cfg)).toBe(45 + 30 + 5 + 10);
    expect(timeoutOf(cfg, { model: false })).toBe(30 + 5 + 10);
    expect(timeoutOf(resolveConfig({}))).toBe(45 + 10);
  });
});

describe('installLines', () => {
  const runIn = (install: object) => {
    const dir = mkdtempSync(join(tmpdir(), 'skulkr-install-'));
    try {
      execFileSync('bash', ['-c', ['set -e', 'mkdir -p .skulkr/out', 'echo lock > package-lock.json', ...installLines(resolveConfig({ setup: { install } })), 'echo ran > .skulkr/out/model'].join('\n')], { cwd: dir });
      const out = join(dir, '.skulkr/out');
      return { model: existsSync(join(out, 'model')), stopped: stoppedBeforeModel(out), log: existsSync(join(out, 'install.log')), marker: existsSync(join(dir, 'node_modules/.skulkr-lock')) };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };

  it('stop the job before the model when the install fails, saying so in a file beside its log', () => {
    for (const lockfile of ['package-lock.json', null]) {
      const got = runIn({ lockfile, command: 'false', marker: 'node_modules/.skulkr-lock' });
      expect(got).toMatchObject({ model: false, log: true, marker: false });
      expect(got.stopped).toBe('install failed: false; see install.log');
    }
  });

  it('go on to the model after an install that passes, and mark the lockfile installed', () => {
    expect(runIn({ lockfile: 'package-lock.json', command: 'mkdir -p node_modules', marker: 'node_modules/.skulkr-lock' }))
      .toEqual({ model: true, stopped: '', log: true, marker: true });
  });
});

describe('fixupLines', () => {
  it("commit what the fixup changes in the commits' files, and nothing the model left uncommitted", () => {
    const dir = mkdtempSync(join(tmpdir(), 'skulkr-fixup-'));
    const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
    try {
      git('init', '-q', '-b', 'main');
      git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'base');
      const base = git('rev-parse', 'HEAD');
      writeFileSync(join(dir, 'a.ts'), 'x\n');
      writeFileSync(join(dir, 'b.ts'), 'x\n');
      git('add', 'a.ts');
      git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'fix');
      const lines = fixupLines({ command: "perl -pi -e 's/x/y/' {files}", message: 'apply fixes' });
      execFileSync('bash', ['-c', ['mkdir -p .skulkr/out', `BASE=${base}`, ...lines].join('\n')], { cwd: dir });
      expect(git('log', '--format=%s', `${base}..HEAD`)).toBe('apply fixes\nfix');
      expect(git('show', 'HEAD:a.ts')).toBe('y');
      expect(existsSync(join(dir, 'b.ts'))).toBe(false);
      expect(fixupLines(null)).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
