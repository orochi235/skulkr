import { mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { fixStagesIn, stagesFromFixLog } from './scourFixStage.mjs';

const ids = ['D1', 'D2', 'D3'];
const log = (...lines: string[]) => lines.join('\n');

describe("a fix batch's stages", () => {
  it('reads each defect as analyzing until the fixer names it, writing until its commit, written after', () => {
    expect(stagesFromFixLog(log(
      'skulkr: says: Working through the three findings.',
      'skulkr: says: Starting with D2 (the docs).',
      'skulkr: commit 1/3: say what the key does',
      'skulkr: says: D1 next: the clamp, unlike D2.',
      'skulkr: running: npx vitest run …',
    ), ids)).toEqual({ D1: 'writing', D2: 'written', D3: 'analyzing' });
  });

  it('moves a defect the fixer leaves without a commit to written when it names the next, and all to checking once each is written', () => {
    expect(stagesFromFixLog(log('skulkr: says: D1 does not reproduce.', 'skulkr: says: D2: the drag.'), ids))
      .toEqual({ D1: 'written', D2: 'writing', D3: 'analyzing' });
    expect(stagesFromFixLog(log('skulkr: says: D1', 'skulkr: commit 1/3: a', 'skulkr: says: D2', 'skulkr: commit 2/3: b', 'skulkr: says: D3', 'skulkr: commit 3/3: c'), ids))
      .toEqual({ D1: 'checking', D2: 'checking', D3: 'checking' });
    expect(stagesFromFixLog(log('skulkr: says: D1', "skulkr: verifying the fixer's commits"), ids).D3).toBe('checking');
  });

  describe('from a job directory', () => {
    let dir = '';
    afterEach(() => rmSync(dir, { recursive: true, force: true }));
    const write = (name: string, text: string, at: number) => {
      writeFileSync(join(dir, name), text);
      utimesSync(join(dir, name), at, at);
    };

    it('reads the newest log: a verify checking, a repair repairing until it verifies its own commits', () => {
      dir = mkdtempSync(join(tmpdir(), 'skulkr-stage-'));
      expect(fixStagesIn(dir, ids).D1).toBe('analyzing');
      write('fix.log', 'skulkr: says: D1 first.', 1000);
      expect(fixStagesIn(dir, ids)).toEqual({ D1: 'writing', D2: 'analyzing', D3: 'analyzing' });
      write('verify-fix-gui.log', '', 2000);
      expect(fixStagesIn(dir, ids).D2).toBe('checking');
      write('repair-1.log', 'skulkr: running: npm test', 3000);
      expect(fixStagesIn(dir, ids).D2).toBe('repairing');
      write('repair-1.log', "skulkr: running: npm test\nskulkr: verifying the fixer's commits\n", 3000);
      expect(fixStagesIn(dir, ids).D2).toBe('checking');
    });
  });
});
