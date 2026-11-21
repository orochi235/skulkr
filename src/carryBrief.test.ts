import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { carriedMarkdown, carriedSource, toCarry, writeCarried } from './carryBrief.mjs';
import { givenIn } from './carry.mjs';

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'skulkr-carry-')); dirs.push(d); return d; };

const OPEN = [
  { id: 'r56-1', claim: '`clamp` rounds a negative step toward zero', where: 'src/clamp.ts:12', from: 'A', round: 56, rounds: [56] },
  { id: 'r56-4', claim: '`useTicker` keeps its interval after unmount', where: 'src/ticker.ts:40', from: 'A+B', round: 56, rounds: [56, 57] },
];

describe('carried findings in the fixer brief', () => {
  it('leaves out what this round\'s reviewers reported again', () => {
    expect(toCarry(OPEN, [{ claim: '`useTicker` keeps its interval running after unmount' }]).map((o: any) => o.id)).toEqual(['r56-1']);
    expect(toCarry(OPEN)).toHaveLength(2);
  });

  it('lists each under its id and round, in the reviewers\' format', () => {
    const md = carriedMarkdown(OPEN);
    expect(md).toContain('## [r56-1] `clamp` rounds a negative step toward zero\n- carried from round 56, from A\n- where: src/clamp.ts:12');
    expect(md).toContain('- carried from round 56 (reported in rounds 56, 57), from A+B');
    expect(carriedSource('x', OPEN)).toContain('2 findings from earlier rounds');
    expect(carriedSource('x', OPEN)).toContain('`.skulkr/in/x/carried.md`');
    expect(carriedSource('x', [])).toBe('');
  });

  it('writes the list for the fixer and for the record, which the ledger reads back as handed over', () => {
    const frozen = tmp(), record = tmp();
    mkdirSync(join(frozen, '.skulkr/in/x'), { recursive: true });
    const text = writeCarried({ frozen }, 'x', OPEN, record);
    expect(text).toBe(carriedSource('x', OPEN));
    expect(readFileSync(join(frozen, '.skulkr/in/x/carried.md'), 'utf8')).toBe(carriedMarkdown(OPEN));
    const { findings } = JSON.parse(readFileSync(join(record, 'carried.json'), 'utf8'));
    expect(givenIn({ round: 58, carried: findings }).carried.map((c: any) => c.id)).toEqual(['r56-1', 'r56-4']);
    expect(writeCarried({ frozen }, 'x', [], record)).toBe('');
  });
});
