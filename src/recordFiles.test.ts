import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { gitIn } from './batch.mjs';
import { diskRecords, recordsFor } from './recordFiles.mjs';
import { passesIn } from './rounds.mjs';
import { recordsIn } from './carryRecords.mjs';
import { weaselConfig } from '../test/weaselConfig.ts';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** A repository on `main` holding `files` (path → text), with `run` for git. */
const repo = (files: Record<string, string>) => {
  const root = mkdtempSync(join(tmpdir(), 'skulkr-records-'));
  dirs.push(root);
  const run = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  const write = (more: Record<string, string>, message: string) => {
    for (const [path, text] of Object.entries(more)) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), text);
    }
    run('add', '-A');
    run('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', message);
  };
  run('init', '-q', '-b', 'main');
  write(files, 'main');
  return { root, run, write };
};

const cfg = {
  record: { dir: 'docs/audits' }, naming: { batchPrefix: 'batch' }, git: { main: 'main' }, citedRe: /([\w/.-]+\.ts)/g,
  names: weaselConfig().names, state: join(tmpdir(), 'skulkr-records-no-state'),
};
const area = (id: string, extra: Record<string, unknown> = {}) => JSON.stringify({ id, a: 2, b: 1, m: 1, distinct: 2, ...extra });

describe('recordsFor', () => {
  it('reads the records on disk, then those an unlanded batch holds for rounds not on disk, in one walk each', () => {
    const { root, run, write } = repo({
      'docs/audits/round-4/ui/area.json': area('ui', { distinct: 3, files: ['x.ts'] }),
      'docs/audits/round-0/ui/area.json': area('ui'),
      'docs/audits/round-4/notes/README.md': 'no area.json here',
    });
    run('checkout', '-qb', 'batch/2026-11-20-audit5');
    write({
      'docs/audits/round-4/ui/area.json': area('ui', { distinct: 9 }),
      'docs/audits/round-5/ui/area.json': area('ui'),
      'docs/audits/round-5/ui/files.txt': 'x.ts\ny.ts\n',
      'docs/audits/round-5/ui/A.md': '## A leak\n- where: x.ts:1\n',
      'docs/audits/round-5/gone/area.json': area('gone', { incomplete: ['B'] }),
    }, 'batch');
    run('checkout', '-q', 'main');
    const git = gitIn(root);
    expect(diskRecords(root, 'docs/audits').map((r: any) => [r.round, r.id])).toEqual([[4, 'ui']]);
    const records = recordsFor(cfg, git, root);
    expect(records.map((r: any) => [r.round, r.id, r.ref ?? null])).toEqual([
      [4, 'ui', null], [5, 'gone', 'batch/2026-11-20-audit5'], [5, 'ui', 'batch/2026-11-20-audit5'],
    ]);
    const passes = passesIn(cfg, git, root, records);
    expect(passes.get('ui')!.map((p: any) => [p.round, p.distinct, p.files])).toEqual([[4, 3, ['x.ts']], [5, 2, ['x.ts', 'y.ts']]]);
    expect(passes.has('gone')).toBe(false);
    expect(passes.get('ui')!.map((p: any) => p.unmerged ?? false)).toEqual([false, true]);
    expect(recordsIn(cfg, git, root, records).find((r: any) => r.round === 5 && r.id === 'ui')!.A).toContain('A leak');
  });

  it("leaves out an abandoned round's batch, but not one whose later night resumed it", () => {
    const { root, run, write } = repo({ 'README.md': 'x' });
    for (const round of [6, 7]) {
      run('checkout', '-qb', `batch/2026-11-20-audit${round}`, 'main');
      write({ [`docs/audits/round-${round}/ui/area.json`]: area('ui') }, `batch ${round}`);
    }
    run('checkout', '-q', 'main');
    const state = mkdtempSync(join(tmpdir(), 'skulkr-records-state-'));
    dirs.push(state);
    for (const [name, abandoned] of [['2026-11-20T01-00-00-000Z-round6', true], ['2026-11-20T01-00-00-000Z-round7', true], ['2026-11-20T02-00-00-000Z-round7', false]] as const) {
      mkdirSync(join(state, 'nights', name), { recursive: true });
      if (abandoned) writeFileSync(join(state, 'nights', name, 'abandoned'), 'given up');
    }
    expect(recordsFor({ ...cfg, state }, gitIn(root), root).map((r: any) => r.round)).toEqual([7]);
  });
});
