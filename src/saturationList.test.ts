import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveConfig } from './config.mjs';
import { loggingSay } from './delveLive.mjs';
import { takeLease } from './lease.mjs';
import { allNew, emptyLedger, ledgerDirOf, withOccasion, writeLedger } from './ledger.mjs';
import { ledgerListLines, ledgerListOf } from './saturationList.mjs';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('skulkr saturate ls', () => {
  it('sums up each ledger with its defects, an unsighted one marked as found only by its source', () => {
    const state = mkdtempSync(join(tmpdir(), 'skulkr-satls-'));
    dirs.push(state);
    const cfg = resolveConfig({ name: 'proj', state });
    const occ = (n: number, source: string) => ({ n, source, kind: 'review', file: '', costUsd: 0.5, minutes: 1, at: `2026-11-25T0${n}:00:00Z` });
    let ledger = withOccasion(emptyLedger('src', 'c0ffee', ['src/x.ts', 'src/y.ts']), occ(1, 'claude'), allNew([{ claim: 'A', where: 'src/x.ts:1', body: '' }]));
    ledger = withOccasion(ledger, occ(2, 'codex'), { findings: [{}], sightings: [{ finding: 0, defect: 'D1' }], new: [] });
    ledger.defects.push({ id: 'D2', claim: 'B', where: 'src/y.ts:2', severity: 'low', firstOccasion: null, sightings: [], sources: {}, source: 'codex' });
    writeLedger(cfg, ledger);
    const [only] = ledgerListOf(cfg);
    expect(only).toMatchObject({ id: 'src', area: 'src', files: 2, occasions: 2, sources: { claude: 1, codex: 1 }, costUsd: 1, distinct: 2, updated: '2026-11-25T02:00:00Z' });
    expect(only.defects).toEqual([
      { id: 'D1', claim: 'A', where: 'src/x.ts:1', severity: '', sightings: 2, recurrent: false, seenAt: [1, 2], firstOccasion: 1, sources: ['claude', 'codex'], onlyBy: null, registry: null },
      { id: 'D2', claim: 'B', where: 'src/y.ts:2', severity: 'low', sightings: 0, recurrent: false, seenAt: [], firstOccasion: null, sources: [], onlyBy: 'codex', registry: null },
    ]);
    expect(ledgerListLines([only])[1]).toMatch(/^src\s+–\s+2\s+2\s+/);
    expect(only.running).toBeNull();
  });

  it('says what a live process holding a ledger is doing: its lease, its jobs out, and its own log', () => {
    const state = mkdtempSync(join(tmpdir(), 'skulkr-satls-'));
    dirs.push(state);
    const cfg = resolveConfig({ name: 'proj', state });
    writeLedger(cfg, emptyLedger('src', 'c0ffee', ['src/x.ts']));
    const dir = ledgerDirOf(cfg, 'src');
    const release = takeLease(join(dir, 'lock'), { saturate: 'src', does: 'delve', max: 12 })!;
    try {
      const say = loggingSay(cfg, 'src', () => {});
      say('saturate src at c0ffee: 1 files');
      say('1/12 claude: 2 findings, 2 new');
      mkdirSync(join(dir, 'jobs', '02-claude'), { recursive: true });
      writeFileSync(join(dir, 'jobs', '02-claude', 'review.log'), 'onto: progress 3/14\nskulkr: finding {"claim":"x"}\n\x1b[31monto: progress 5/14\x1b[0m\n');
      mkdirSync(join(dir, 'jobs', '03-codex'), { recursive: true });
      const [only] = ledgerListOf(cfg);
      expect(only.running).toMatchObject({
        pid: process.pid, does: 'delve', max: 12,
        jobs: [
          { key: '02-claude', step: 'review', line: 'skulkr: finding {"claim":"x"}', progress: { done: 5, of: 14 } },
          { key: '03-codex', step: null, line: null, progress: null },
        ],
      });
      expect(only.running!.log.map((l: string) => l.replace(/^\S+ /, ''))).toEqual(['saturate src at c0ffee: 1 files', '1/12 claude: 2 findings, 2 new']);
    } finally {
      release();
    }
    expect(ledgerListOf(cfg)[0].running).toBeNull();
  });
});

describe('a live fix run', () => {
  it("shows its batches' jobs, read from its run directory and keyed by batch", () => {
    const state = mkdtempSync(join(tmpdir(), 'skulkr-fixlive-'));
    dirs.push(state);
    const cfg = resolveConfig({ name: 'proj', state });
    writeLedger(cfg, emptyLedger('core', 'c0ffee', ['src/x.ts']));
    const jobs = join(state, 'scour', 'fix-3', 'jobs', 'core~b2');
    mkdirSync(jobs, { recursive: true });
    writeFileSync(join(jobs, 'fix.log'), 'skulkr: says: reading useKeyDrag\n');
    const release = takeLease(join(ledgerDirOf(cfg, 'core'), 'lock'), { saturate: 'core', does: 'fix', max: 5, jobs: 'fix-3' })!;
    try {
      const [ledger] = ledgerListOf(cfg, undefined);
      expect(ledger!.running).toMatchObject({ does: 'fix', max: 5, jobs: [{ key: 'b2', step: 'fix', line: 'skulkr: says: reading useKeyDrag' }] });
    } finally {
      release();
    }
  });
});
