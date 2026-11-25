import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
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
  const d = mkdtempSync(join(tmpdir(), 'skulkr-satimport-'));
  dirs.push(d);
  return d;
};

const project = () => {
  const root = scratch();
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  git('init', '-q', '-b', 'main');
  mkdirSync(join(root, 'src'));
  writeFileSync(join(root, 'src/x.ts'), 'export const x = 1;\n');
  git('add', '.');
  git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'init');
  return { root, git, cfg: resolveConfig({ name: 'proj', state: scratch(), root }, { root }) };
};

/** A hand-run experiment: three occasions, V1–V10 and V2 among them, V4 found only by Codex. */
const experiment = (over: Record<string, unknown> = {}) => {
  const dir = scratch();
  mkdirSync(join(dir, 'reviews'));
  for (const n of ['01', '02', '03']) writeFileSync(join(dir, 'reviews', `${n}.md`), `review ${n}\n`);
  const files: Record<string, unknown> = {
    'occasions.json': { 1: [2, 0.5, 6], 2: [2, 0.75, 7], 3: [1, 0.25, 5] },
    'sightings.json': { 1: ['V10', 'V2'], 2: ['V2', 'V1'], 3: ['V2'] },
    'defects.json': [
      { id: 'V10', claim: 'ten', where: 'src/x.ts:1', severity: 'High' },
      { id: 'V1', claim: 'one', where: 'src/x.ts:2', severity: 'low' },
      { id: 'V2', claim: 'two', where: 'src/x.ts:3' },
      { id: 'V4', claim: 'four', where: 'src/x.ts:4', source: 'codex' },
    ],
    ...over,
  };
  for (const [name, value] of Object.entries(files)) writeFileSync(join(dir, name), JSON.stringify(value));
  return dir;
};

describe('skulkr saturate import', () => {
  it('builds the ledger at --at, renumbering defects in their ids\' order and copying the reports', async () => {
    const { root, cfg, git } = project();
    const lines: string[] = [];
    await saturateCommand(cfg, { run: async () => ({ status: 0 }), unavailableNodes: () => new Set(), jobs: () => [] }, root, ['import', 'src', experiment(), '--at', 'main'], (l) => lines.push(l));
    const ledger = ledgerOf(cfg, 'src');
    expect(ledger).toMatchObject({ area: 'src', commit: git('rev-parse', 'main'), files: ['src/x.ts'] });
    expect(ledger.occasions).toMatchObject([
      { n: 1, source: 'claude', kind: 'review', file: 'reviews/01-claude.md', findings: 2, costUsd: 0.5, minutes: 6 },
      { n: 2, findings: 2, costUsd: 0.75 },
      { n: 3, findings: 1, costUsd: 0.25 },
    ]);
    expect(ledger.defects.map((d: { id: string; imported: string; sightings: number[] }) => [d.id, d.imported, d.sightings])).toEqual([
      ['D1', 'V1', [2]], ['D2', 'V2', [1, 2, 3]], ['D3', 'V4', []], ['D4', 'V10', [1]],
    ]);
    expect(ledger.defects[2]).toMatchObject({ firstOccasion: null, sources: {}, source: 'codex' });
    expect(ledger.defects[3]).toMatchObject({ severity: 'high', firstOccasion: 1, sources: { claude: [1] } });
    expect(chao2(ledger.occasions, ledger.defects)).toMatchObject({ m: 3, S: 3, Q1: 2, Q2: 0 });
    expect(readdirSync(join(cfg.state, 'scour/src/reviews'))).toEqual(['01-claude.md', '02-claude.md', '03-claude.md']);
    expect(readFileSync(join(cfg.state, 'scour/src/reviews/02-claude.md'), 'utf8')).toBe('review 02\n');
    expect(readFileSync(join(cfg.state, 'scour/src/report.md'), 'utf8')).toContain('four (found only by codex)');
    expect(lines[0]).toMatch(/^imported 3 occasions and 4 defects into src's ledger at /);
  });

  it('refuses without --at, over an existing ledger unless --fresh, and on files that disagree', async () => {
    const { root, cfg } = project();
    const runner = { run: async () => ({ status: 0 }), unavailableNodes: () => new Set(), jobs: () => [] };
    const run = (dir: string, ...flags: string[]) => saturateCommand(cfg, runner, root, ['import', 'src', dir, ...flags], () => {});
    await expect(run(experiment())).rejects.toThrow(/--at/);
    await expect(run(experiment({ 'sightings.json': { 1: ['V9'] } }), '--at', 'main')).rejects.toThrow(/V9/);
    await expect(run(experiment({ 'occasions.json': { 1: [1, 0, 0], 3: [1, 0, 0] } }), '--at', 'main')).rejects.toThrow(/no gap/);
    expect(ledgerOf(cfg, 'src')).toBeUndefined();
    await run(experiment(), '--at', 'main');
    await expect(run(experiment(), '--at', 'main')).rejects.toThrow(/already has a ledger/);
    await run(experiment({ 'sightings.json': { 1: ['V1'] } }), '--at', 'main', '--fresh');
    expect(ledgerOf(cfg, 'src').defects[0].sightings).toEqual([1]);
  });
});
