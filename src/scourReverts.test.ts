import { describe, expect, it } from 'vitest';
import { revertedDefectsOf, withRevertsRead } from './scourReverts.mjs';
import { verdictIn } from './scourFixStatus.mjs';

const patch = (n: number, subject: string, body: string) =>
  `From ${String(n).repeat(40).slice(0, 40)} Mon Sep 17 00:00:00 2001\nFrom: skulkr <s@l>\nSubject: [PATCH ${n}/3] ${subject}\n\n${body}\n---\n a.ts | 1 +\n\ndiff --git a/a.ts b/a.ts\n`;

const MBOX = [
  patch(1, 'refuse a loop count that is not a\n whole number', 'Why.\n\nDefect: D4\n'),
  patch(2, 'hold a paused timeline at the end of its last lap', 'Why.\n\nDefect: D11, D12\n'),
  patch(3, 'Revert "hold a paused timeline at the end of its last lap"', 'This reverts commit 2222.\n'),
  patch(4, 'also fix D12 another way', 'Defect: D12\n'),
].join('');

describe('revertedDefectsOf', () => {
  it("names the defects whose only fix a revert takes back, matching folded subjects", () => {
    expect([...revertedDefectsOf(MBOX)]).toEqual(['D11']);
    expect(revertedDefectsOf(MBOX.split('From 3333')[0]).size).toBe(0);
  });
});

describe('withRevertsRead', () => {
  it('reads a reverted fixed verdict as not fixed, its line saying why', () => {
    const line = '[D11] paused timeline at the end of its last lap finishes while paused (scour): fixed a3c61e4c92';
    const [v, kept] = withRevertsRead([{ id: 'D11', verdict: 'fixed', line, sha: 'a3c61e4c92' }, { id: 'D4', verdict: 'fixed', line: '[D4] x (scour): fixed bbbbbbb', sha: 'bbbbbbb' }], new Set(['D11']));
    expect(v).toMatchObject({ verdict: 'not fixed', sha: null });
    expect(v!.line).toMatch(/\(scour\): not fixed \(a repair reverted its fix a3c61e4c92/);
    expect(verdictIn(v!.line).verdict).toBe('not fixed');
    expect(kept!.verdict).toBe('fixed');
  });
});
