import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ledgerOf } from './ledger.mjs';
import { saturateCommand } from './saturate.mjs';
import { chao2 } from './saturation.mjs';
import { fakeRunner, project, scratch } from './scourTestKit.ts';

const SEEN = [['A', 'B', 'C', 'D'], ['D', 'B', 'E', 'F', 'G', 'H', 'I'], ['J', 'A', 'K', 'H'], ['A', 'D'], ['H', 'L', 'A', 'C', 'M']];

describe('skulkr saturate', () => {
  it('reviews, folds each report into the ledger, and stops at --max with the worked example\'s estimate', async () => {
    const { root, cfg } = project();
    const runner = fakeRunner(SEEN);
    const lines: string[] = [];
    await saturateCommand(cfg, runner, root, ['src', '--max', '5'], (l) => lines.push(l));
    const ledger = ledgerOf(cfg, 'src');
    expect(ledger.occasions.map((o: { n: number }) => o.n)).toEqual([1, 2, 3, 4, 5]);
    expect(chao2(ledger.occasions, ledger.defects)).toMatchObject({ S: 13, Q1: 8, Q2: 2, U: 22 });
    expect(ledger.defects.find((d: { claim: string }) => d.claim === 'A')).toMatchObject({ id: 'D1', sightings: [1, 3, 4, 5], sources: { claude: [1, 3, 4, 5] } });
    // The first occasion needs no matcher; each later one runs one.
    expect(runner.tasks.filter((t) => t.endsWith('match1'))).toHaveLength(4);
    expect(runner.tasks[0]).toBe('proj-saturate-src-01-claude-claude');
    expect(lines).toContain('5/5 claude: 5 findings, 2 new; distinct 13; unseen ≈ 12.8; next-new 32%; $0.60; $0.22/defect, next ≈ $0.41');
    expect(lines.some((l) => /stopped, reached the limit of 5/.test(l))).toBe(true);
    expect(readFileSync(join(cfg.state, 'scour', 'src', 'scour.log'), 'utf8').trim().split('\n').map((l) => l.replace(/^\S+ /, ''))).toEqual(lines);
    expect(readdirSync(join(cfg.state, 'scour/src/reviews'))).toEqual(['01-claude.md', '02-claude.md', '03-claude.md', '04-claude.md', '05-claude.md']);
    expect(existsSync(join(cfg.state, 'scour/src/jobs/05-claude'))).toBe(false);
    const report = readFileSync(join(cfg.state, 'scour/src/report.md'), 'utf8');
    expect(report).toContain('Stopped: reached the limit of 5 occasions.');
    expect(report).toMatch(/\|\s+5 \| claude\s+\|\s+5 \|\s+2 \|\s+13 \|\s+8 \|\s+2 \|\s+25\.8 \|\s+12\.8 \|\s+32\.3% \|/);
    expect(existsSync(join(root, '.worktrees/audit-saturate-src'))).toBe(false);
  });

  it("takes this machine's slots under a runner that keeps jobs local, though the config lists no nodes", async () => {
    const { root, cfg } = project();
    const placing = { ...cfg, nodes: { ...cfg.nodes, list: [] } };
    const runner = { ...fakeRunner([['A'], ['B']]), routesLocal: true };
    await saturateCommand(placing, runner, root, ['src', '--max', '2'], () => {});
    expect(ledgerOf(cfg, 'src').occasions).toHaveLength(2);
  });

  it('runs one review per source each iteration and resumes a ledger at the same commit', async () => {
    const { root, cfg } = project();
    const sourcesCfg = { ...cfg, codex: { ...cfg.codex, models: { review: 'gpt' }, prices: { gpt: { input: 1, cachedInput: 0.1, output: 4 } } } };
    const first = fakeRunner([['A', 'B'], ['B', 'C']]);
    await saturateCommand(sourcesCfg, first, root, ['src', '--sources', 'claude,codex', '--max', '2'], () => {});
    expect(first.tasks.filter((t) => !/match/.test(t)).sort()).toEqual(['proj-saturate-src-01-claude-claude', 'proj-saturate-src-02-codex-codex']);
    const second = fakeRunner([['C', 'D']]);
    await saturateCommand(sourcesCfg, second, root, ['src', '--max', '3'], () => {});
    const ledger = ledgerOf(cfg, 'src');
    expect(ledger.occasions.map((o: { source: string }) => o.source)).toEqual(['claude', 'codex', 'claude']);
    expect(ledger.defects.map((d: { claim: string }) => d.claim)).toEqual(['A', 'B', 'C', 'D']);
    expect(readFileSync(join(cfg.state, 'scour/src/report.md'), 'utf8')).toContain('claude × codex');
  });

  it("resumes at the ledger's own commit after main moves, and --fresh sets it aside for a new one at the tip", async () => {
    const { root, cfg, git } = project();
    await saturateCommand(cfg, fakeRunner([['A']]), root, ['src', '--max', '1'], () => {});
    const first = git('rev-parse', 'main');
    writeFileSync(join(root, 'src/y.ts'), 'export const y = 2;\n');
    git('add', '.');
    git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'more');
    const trees: string[] = [];
    const resumed = fakeRunner([['B']]);
    const run = resumed.run;
    resumed.run = async (job, opts) => {
      trees.push(git('-C', opts.cwd, 'rev-parse', 'HEAD'));
      return run(job, opts);
    };
    await saturateCommand(cfg, resumed, root, ['src', '--max', '2'], () => {});
    // The review and its ledger match, both in the tree at the ledger's commit.
    expect(trees).toEqual([first, first]);
    expect(ledgerOf(cfg, 'src')).toMatchObject({ commit: first, files: ['src/x.ts'] });
    await saturateCommand(cfg, fakeRunner([['C']]), root, ['src', '--max', '1', '--fresh'], () => {});
    const ledger = ledgerOf(cfg, 'src');
    expect(ledger.commit).toBe(git('rev-parse', 'main'));
    expect(ledger.files).toEqual(['src/x.ts', 'src/y.ts']);
    expect(ledger.defects.map((d: { claim: string }) => d.claim)).toEqual(['C']);
    const aside = ledgerOf(cfg, `src.${first.slice(0, 10)}`);
    expect(aside.defects.map((d: { claim: string }) => d.claim)).toEqual(['A', 'B']);
    expect(existsSync(join(cfg.state, 'scour', `src.${first.slice(0, 10)}`, 'lock'))).toBe(false);
  });

  it('freezes a new ledger at --at, and refuses an existing one at another commit unless --fresh', async () => {
    const { root, cfg, git } = project();
    const first = git('rev-parse', 'main');
    writeFileSync(join(root, 'src/y.ts'), 'export const y = 2;\n');
    git('add', '.');
    git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'more');
    await saturateCommand(cfg, fakeRunner([['A']]), root, ['src', '--max', '1', '--at', first.slice(0, 7)], () => {});
    expect(ledgerOf(cfg, 'src')).toMatchObject({ commit: first, files: ['src/x.ts'] });
    // Resuming at its own commit, named or not, is fine.
    await saturateCommand(cfg, fakeRunner([['B']]), root, ['src', '--max', '2', '--at', first], () => {});
    await expect(saturateCommand(cfg, fakeRunner([['C']]), root, ['src', '--max', '3', '--at', 'main'], () => {})).rejects.toThrow(/not main; --fresh/);
    await expect(saturateCommand(cfg, fakeRunner([]), root, ['src', '--at', 'nope'], () => {})).rejects.toThrow(/no commit nope/);
    await saturateCommand(cfg, fakeRunner([['C']]), root, ['src', '--max', '1', '--at', 'main', '--fresh'], () => {});
    expect(ledgerOf(cfg, 'src')).toMatchObject({ commit: git('rev-parse', 'main'), files: ['src/x.ts', 'src/y.ts'] });
  });

  it('stops the ledger matcher at budget.ledgerMatch', async () => {
    const { root, cfg } = project();
    const runner = fakeRunner([['A'], ['B']]);
    const shells: string[] = [];
    const run = runner.run;
    runner.run = async (job, opts) => {
      shells.push(job.shell);
      return run(job, opts);
    };
    await saturateCommand({ ...cfg, budget: { ...cfg.budget, ledgerMatch: 2.5 } }, runner, root, ['src', '--max', '2'], () => {});
    expect(shells.filter((s) => /ledger-match\.md/.test(s)).map((s) => /--max-budget-usd (\S+)/.exec(s)?.[1])).toEqual(['2.5']);
  });

  it('ingests a whole report as one occasion through the matcher', async () => {
    const { root, cfg } = project();
    await saturateCommand(cfg, fakeRunner([['A', 'B']]), root, ['src', '--max', '1'], () => {});
    const path = join(scratch(), 'gpt.md');
    writeFileSync(path, '# Audit\n\n## B\nsomething\n\n## Z\nelse\n');
    const runner = fakeRunner([]);
    await saturateCommand(cfg, runner, root, ['ingest', 'src', path, '--source', 'gpt-pro'], () => {});
    const ledger = ledgerOf(cfg, 'src');
    expect(ledger.occasions.at(-1)).toMatchObject({ n: 2, source: 'gpt-pro', kind: 'ingest', findings: 2, file: 'reviews/02-gpt-pro.md' });
    expect(ledger.defects.map((d: { claim: string; sightings: number[] }) => [d.claim, d.sightings])).toEqual([['A', [1]], ['B', [1, 2]], ['Z', [2]]]);
    expect(runner.tasks).toEqual(['proj-saturate-src-02-gpt-pro-match1']);
  });

  it('tries an unusable matcher reply once more, then leaves the report unfolded for `fold` to take in', async () => {
    const { root, cfg } = project();
    await saturateCommand(cfg, fakeRunner([['A']]), root, ['src', '--max', '1'], () => {});
    const runner = fakeRunner([['B']], { matchReply: () => 'I could not decide.' });
    const lines: string[] = [];
    await expect(saturateCommand(cfg, runner, root, ['src', '--max', '3'], (l) => lines.push(l))).rejects.toThrow(/no usable answer/);
    expect(runner.tasks.filter((t) => /match/.test(t))).toEqual(['proj-saturate-src-02-claude-match1', 'proj-saturate-src-02-claude-match2']);
    expect(ledgerOf(cfg, 'src').occasions).toHaveLength(1);
    expect(ledgerOf(cfg, 'src').unfolded).toMatchObject([{ key: '02-claude', source: 'claude', file: 'reviews/unfolded-02-claude.md' }]);
    expect(existsSync(join(root, '.worktrees/audit-saturate-src'))).toBe(false);

    const folded: string[] = [];
    await saturateCommand(cfg, fakeRunner([]), root, ['fold', 'src'], (l) => folded.push(l));
    const ledger = ledgerOf(cfg, 'src');
    expect(ledger.unfolded).toBeUndefined();
    expect(ledger.occasions.map((o: { file: string }) => o.file)).toEqual(['reviews/01-claude.md', 'reviews/02-claude.md']);
    expect(ledger.defects.map((d: { claim: string }) => d.claim)).toEqual(['A', 'B']);
    expect(readdirSync(join(cfg.state, 'scour/src/reviews'))).toEqual(['01-claude.md', '02-claude.md']);
    expect(folded[0]).toMatch(/^2\/40 claude: 1 findings, 1 new/);
    await saturateCommand(cfg, fakeRunner([]), root, ['fold', 'src'], (l) => folded.push(l));
    expect(folded.at(-1)).toBe('fold src: nothing to fold');
  });

  it('rewrites the report from the ledger, and removes the ledger', async () => {
    const { root, cfg } = project();
    await saturateCommand(cfg, fakeRunner([['A']]), root, ['src', '--max', '1'], () => {});
    rmSync(join(cfg.state, 'scour/src/report.md'));
    await saturateCommand(cfg, fakeRunner([]), root, ['report', 'src'], () => {});
    expect(existsSync(join(cfg.state, 'scour/src/report.md'))).toBe(true);
    const lines: string[] = [];
    await saturateCommand(cfg, fakeRunner([]), root, ['rm', 'src'], (l) => lines.push(l));
    await saturateCommand(cfg, fakeRunner([]), root, ['rm', 'src'], (l) => lines.push(l));
    expect(lines).toEqual(["removed src's saturation ledger", 'src has no saturation ledger']);
    await expect(saturateCommand(cfg, fakeRunner([]), root, ['report', 'src'], () => {})).rejects.toThrow(/no saturation ledger/);
  });
});
