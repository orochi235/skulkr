import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveConfig } from './config.mjs';
import { ledgerOf } from './ledger.mjs';
import { saturateCommand } from './saturate.mjs';
import { chao2 } from './saturation.mjs';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const scratch = () => {
  const d = mkdtempSync(join(tmpdir(), 'skulkr-sat-'));
  dirs.push(d);
  return d;
};

/** A project repository on `main` with one area, `src`, and a config whose state is a scratch directory. */
const project = () => {
  const root = scratch();
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  git('init', '-q', '-b', 'main');
  mkdirSync(join(root, 'src'));
  writeFileSync(join(root, 'src/x.ts'), 'export const x = 1;\n');
  git('add', '.');
  git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'init');
  const cfg = resolveConfig({ name: 'proj', state: scratch(), root }, { root });
  return { root, cfg, git };
};

const SEEN = [['A', 'B', 'C', 'D'], ['D', 'B', 'E', 'F', 'G', 'H', 'I'], ['J', 'A', 'K', 'H'], ['A', 'D'], ['H', 'L', 'A', 'C', 'M']];
const reportOf = (claims: string[]) => `${claims.map((c) => `## ${c}\n- where: src/x.ts:1\n`).join('\n')}\n## Files read\n- src/x.ts\n\n<!-- done: ${claims.length} findings -->\n`;
const envelope = (result: string, cost: number) => JSON.stringify({ type: 'result', is_error: false, result, total_cost_usd: cost });

/**
 * A runner that answers each review with the next occasion's claims from `seen`, and each ledger match by reading its
 * prompt and pairing equal claims, as a model would; `matchReply` overrides the matcher's answer.
 */
const fakeRunner = (seen: string[][], { matchReply }: { matchReply?: () => string } = {}) => {
  let review = 0;
  const tasks: string[] = [];
  const run = async (job: { to: string; task: string }, { cwd }: { cwd: string }) => {
    tasks.push(job.task);
    mkdirSync(job.to, { recursive: true });
    writeFileSync(join(job.to, 'exit'), '0');
    if (/-match\d$/.test(job.task)) {
      const prompt = readFileSync(join(cwd, '.skulkr/in/src/ledger-match.md'), 'utf8');
      const ledger = new Map([...prompt.matchAll(/^(D\d+)\. (.+)$/gm)].map((m) => [m[2], m[1]]));
      const whole = /# The new report, whole/.test(prompt);
      const claims = whole ? [...prompt.matchAll(/^## (.+)$/gm)].map((m) => m[1]).filter((c) => c !== 'Files read') : [...prompt.matchAll(/^(\d+)\. (.+)$/gm)].map((m) => m[2]);
      const reply = {
        ...(whole ? { findings: claims.map((claim) => ({ claim, where: 'src/x.ts:1' })) } : {}),
        sightings: claims.flatMap((c, i) => (ledger.has(c) ? [{ finding: i, defect: ledger.get(c) }] : [])),
        new: claims.flatMap((c, i) => (ledger.has(c) ? [] : [{ finding: i, claim: c, where: 'src/x.ts:1', severity: 'low' }])),
      };
      writeFileSync(join(job.to, 'claude.json'), envelope(matchReply?.() ?? JSON.stringify(reply), 0.1));
    } else {
      const text = reportOf(seen[review++] ?? []);
      writeFileSync(join(job.to, 'findings.md'), text);
      writeFileSync(join(job.to, 'claude.json'), envelope(text, 0.5));
    }
    return { status: 0 };
  };
  return { run, unavailableNodes: () => new Set(), jobs: () => [], tasks };
};

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
    expect(lines).toContain('5/5 claude: 5 findings, 2 new; distinct 13; unseen ≈ 12.8; next-new 32%; $0.60');
    expect(lines.some((l) => /stopped, reached the limit of 5/.test(l))).toBe(true);
    expect(readdirSync(join(cfg.state, 'saturation/src/reviews'))).toEqual(['01-claude.md', '02-claude.md', '03-claude.md', '04-claude.md', '05-claude.md']);
    expect(existsSync(join(cfg.state, 'saturation/src/jobs/05-claude'))).toBe(false);
    const report = readFileSync(join(root, 'src-saturation.md'), 'utf8');
    expect(report).toContain('Stopped: reached the limit of 5 occasions.');
    expect(report).toMatch(/\|\s+5 \| claude\s+\|\s+5 \|\s+2 \|\s+13 \|\s+8 \|\s+2 \|\s+25\.8 \|\s+12\.8 \|\s+32\.3% \|/);
    expect(existsSync(join(root, '.worktrees/audit-saturate-src'))).toBe(false);
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
    expect(readFileSync(join(root, 'src-saturation.md'), 'utf8')).toContain('claude × codex');
  });

  it('refuses a ledger at another commit unless --fresh', async () => {
    const { root, cfg, git } = project();
    await saturateCommand(cfg, fakeRunner([['A']]), root, ['src', '--max', '1'], () => {});
    writeFileSync(join(root, 'src/y.ts'), 'export const y = 2;\n');
    git('add', '.');
    git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'more');
    await expect(saturateCommand(cfg, fakeRunner([['B']]), root, ['src', '--max', '2'], () => {})).rejects.toThrow(/--fresh/);
    await saturateCommand(cfg, fakeRunner([['B']]), root, ['src', '--max', '1', '--fresh'], () => {});
    const ledger = ledgerOf(cfg, 'src');
    expect(ledger.commit).toBe(git('rev-parse', 'main'));
    expect(ledger.files).toEqual(['src/x.ts', 'src/y.ts']);
    expect(ledger.defects.map((d: { claim: string }) => d.claim)).toEqual(['B']);
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

  it('tries an unusable matcher reply once more, then fails the occasion and records nothing', async () => {
    const { root, cfg } = project();
    await saturateCommand(cfg, fakeRunner([['A']]), root, ['src', '--max', '1'], () => {});
    const runner = fakeRunner([['B']], { matchReply: () => 'I could not decide.' });
    const lines: string[] = [];
    await expect(saturateCommand(cfg, runner, root, ['src', '--max', '3'], (l) => lines.push(l))).rejects.toThrow(/no usable answer/);
    expect(runner.tasks.filter((t) => /match/.test(t))).toEqual(['proj-saturate-src-02-claude-match1', 'proj-saturate-src-02-claude-match2']);
    expect(ledgerOf(cfg, 'src').occasions).toHaveLength(1);
    expect(readdirSync(join(cfg.state, 'saturation/src/reviews')).some((f) => f.startsWith('unmatched-02-claude'))).toBe(true);
    expect(existsSync(join(root, '.worktrees/audit-saturate-src'))).toBe(false);
  });

  it('rewrites the report from the ledger, and removes the ledger', async () => {
    const { root, cfg } = project();
    await saturateCommand(cfg, fakeRunner([['A']]), root, ['src', '--max', '1'], () => {});
    rmSync(join(root, 'src-saturation.md'));
    await saturateCommand(cfg, fakeRunner([]), root, ['report', 'src'], () => {});
    expect(existsSync(join(root, 'src-saturation.md'))).toBe(true);
    const lines: string[] = [];
    await saturateCommand(cfg, fakeRunner([]), root, ['rm', 'src'], (l) => lines.push(l));
    await saturateCommand(cfg, fakeRunner([]), root, ['rm', 'src'], (l) => lines.push(l));
    expect(lines).toEqual(["removed src's saturation ledger", 'src has no saturation ledger']);
    await expect(saturateCommand(cfg, fakeRunner([]), root, ['report', 'src'], () => {})).rejects.toThrow(/no saturation ledger/);
  });
});
