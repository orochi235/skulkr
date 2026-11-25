import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveConfig } from './config.mjs';
import { allNew, emptyLedger, withOccasion, writeLedger } from './ledger.mjs';
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
      { id: 'D1', claim: 'A', where: 'src/x.ts:1', severity: '', sightings: 2, firstOccasion: 1, sources: ['claude', 'codex'], onlyBy: null },
      { id: 'D2', claim: 'B', where: 'src/y.ts:2', severity: 'low', sightings: 0, firstOccasion: null, sources: [], onlyBy: 'codex' },
    ]);
    expect(ledgerListLines([only])[1]).toMatch(/^src\s+2\s+2\s+/);
  });
});
