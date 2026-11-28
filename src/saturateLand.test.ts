import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveConfig } from './config.mjs';
import { emptyLedger, withLedgerHeld, writeLedger } from './ledger.mjs';
import { heldLedgerIdsOf } from './saturateLand.mjs';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('heldLedgerIdsOf', () => {
  it('names the ledgers a live scour holds, and none once it lets go', async () => {
    const state = mkdtempSync(join(tmpdir(), 'skulkr-land-'));
    dirs.push(state);
    const cfg = resolveConfig({ state });
    for (const area of ['a', 'b']) writeLedger(cfg, emptyLedger(area, 'c0ffee', [`${area}/x.ts`]));
    await withLedgerHeld(cfg, 'a', {}, async () => {
      expect(heldLedgerIdsOf(cfg, ['a', 'b'])).toEqual(['a']);
    });
    expect(heldLedgerIdsOf(cfg, ['a', 'b'])).toEqual([]);
  });
});
