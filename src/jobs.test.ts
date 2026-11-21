import { describe, expect, it } from 'vitest';
import { ontoArgs } from './runner/onto.mjs';
import { resolveConfig } from './config.mjs';
import { fixShell, matchShell, repairShell, reviewShell, timeoutOf, verifyShell } from './jobs.mjs';
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

  it("ask for a five-minute cache for reviews and matches, and leave a fixer's to Claude Code", () => {
    const cfg = resolveConfig({});
    expect(claudeOf(reviewShell(cfg, 'core', 8))).toContain('CLAUDE_CODE_PROMPT_CACHE_TTL=5m');
    expect(claudeOf(matchShell(cfg, 'core', 1))).toContain('CLAUDE_CODE_PROMPT_CACHE_TTL=5m');
    expect(claudeOf(fixShell(cfg, 'core', 15, 3))).not.toContain('CLAUDE_CODE_PROMPT_CACHE_TTL');
    expect(claudeOf(reviewShell(resolveConfig({ claude: { cacheTtl: { review: null } } }), 'core', 8))).not.toContain('CACHE_TTL');
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
