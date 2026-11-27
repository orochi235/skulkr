import { describe, expect, it } from 'vitest';
import { timedLines } from './ScourNow';
import { passKeyParts } from './PassPill';

describe('timedLines', () => {
  it('leads each of the last lines, newest first, with the time since the line before, right-aligned', () => {
    const log = [
      '2026-11-26T10:00:00.000Z saturate a at c: 3 files',
      '2026-11-26T10:04:30.000Z 1/40 claude: 2 findings',
      '2026-11-26T10:09:00.000Z 2/40 claude: 3 findings',
      '2026-11-26T11:19:05.000Z 3/40 claude: 1 findings',
    ];
    expect(timedLines(log, '2026-11-26T09:59:00.000Z')).toEqual([
      '1:10:05  3/40 claude: 1 findings',
      '   4:30  2/40 claude: 3 findings',
      '   4:30  1/40 claude: 2 findings',
    ]);
  });

  it('times the first line from when the process took the ledger', () => {
    expect(timedLines(['2026-11-26T10:01:00.000Z started'], '2026-11-26T10:00:00.000Z')).toEqual(['1:00  started']);
  });
});

describe('passKeyParts', () => {
  it("splits a delve job's key into its pass number and source, and keeps any other key whole", () => {
    expect(passKeyParts('07-claude')).toEqual({ index: '07', name: 'claude' });
    expect(passKeyParts('12-codex')).toEqual({ index: '12', name: 'codex' });
    expect(passKeyParts('match')).toEqual({ index: null, name: 'match' });
  });
});
