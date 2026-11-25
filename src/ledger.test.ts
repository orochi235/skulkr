import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveConfig } from './config.mjs';
import { allNew, emptyLedger, keepReview, ledgerMatchPrompt, ledgerOf, matchOf, removeLedger, severityOf, withOccasion, writeLedger } from './ledger.mjs';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const occ = (n: number, source = 'claude') => ({ n, source, kind: 'review', file: '', costUsd: 0, minutes: 0, at: '' });
const two = () => withOccasion(emptyLedger('a', 'c0ffee', ['a/x.ts']), occ(1), allNew([
  { claim: 'drops the last row', where: 'a/x.ts:3', body: '- where: a/x.ts:3\n- severity: High' },
  { claim: 'leaks a timer', where: 'a/x.ts:9', body: '' },
]));

describe('withOccasion', () => {
  it('numbers new defects and records who saw them', () => {
    const l = two();
    expect(l.defects).toMatchObject([
      { id: 'D1', claim: 'drops the last row', severity: 'high', firstOccasion: 1, sightings: [1], sources: { claude: [1] } },
      { id: 'D2', firstOccasion: 1, severity: '' },
    ]);
    expect(l.occasions).toMatchObject([{ n: 1, findings: 2 }]);
  });

  it('adds a sighting once per occasion, by source, and appends new defects after the highest id', () => {
    const match = matchOf(JSON.stringify({ sightings: [{ finding: 0, defect: 'D2' }, { finding: 1, defect: 'D2' }], new: [{ finding: 2, claim: 'x', where: 'y' }] }), two(), [{}, {}, {}]);
    const l = withOccasion(two(), occ(2, 'codex'), match);
    expect(l.defects.find((d: { id: string }) => d.id === 'D2')).toMatchObject({ sightings: [1, 2], sources: { claude: [1], codex: [2] } });
    expect(l.defects.at(-1)).toMatchObject({ id: 'D3', firstOccasion: 2, sources: { codex: [2] } });
    expect(l.occasions.at(-1)).toMatchObject({ n: 2, source: 'codex', findings: 3 });
  });
});

describe('matchOf', () => {
  const ledger = two();
  it('accepts a reply in prose or a fence, a finding sighting two defects, and a repeat within the report', () => {
    const reply = 'Here:\n```json\n{"sightings": [{"finding": 0, "defect": "D1"}, {"finding": 0, "defect": "D2"}], "new": [{"finding": 1, "claim": "c", "where": "w", "severity": "Low"}], "same": [{"finding": 2, "as": 1}]}\n```';
    expect(matchOf(reply, ledger, [{ claim: 'a', where: '' }, { claim: 'b', where: '' }, { claim: 'b2', where: '' }])).toMatchObject({
      sightings: [{ finding: 0, defect: 'D1' }, { finding: 0, defect: 'D2' }], new: [{ finding: 1, severity: 'low' }],
    });
  });

  it('takes an ingest reply\'s own findings', () => {
    const got = matchOf('{"findings": [{"claim": "k", "where": "w"}], "new": [{"finding": 0, "claim": "k", "where": "w"}]}', ledger, undefined);
    expect(got.findings).toEqual([{ claim: 'k', where: 'w' }]);
  });

  it('throws on a finding left out, counted twice, an unknown id, an index out of range, or no JSON', () => {
    const f = [{}, {}];
    expect(() => matchOf('{"new": [{"finding": 0, "claim": "c"}]}', ledger, f)).toThrow(/1 are not accounted/);
    expect(() => matchOf('{"sightings": [{"finding": 0, "defect": "D1"}], "new": [{"finding": 0, "claim": "c"}, {"finding": 1, "claim": "c"}]}', ledger, f)).toThrow(/twice/);
    expect(() => matchOf('{"sightings": [{"finding": 0, "defect": "D9"}, {"finding": 1, "defect": "D1"}]}', ledger, f)).toThrow(/D9/);
    expect(() => matchOf('{"sightings": [{"finding": 2, "defect": "D1"}]}', ledger, f)).toThrow(/finding 2/);
    expect(() => matchOf('{"new": [{"finding": 0, "claim": "c"}], "same": [{"finding": 1, "as": 5}]}', ledger, f)).toThrow(/not a new defect/);
    expect(() => matchOf('no idea', ledger, f)).toThrow();
    expect(() => matchOf('{"new": []}', ledger, undefined)).toThrow(/no `findings`/);
  });
});

describe('ledgerMatchPrompt', () => {
  it('lists the ledger, then the findings numbered from 0 or the whole report', () => {
    const p = ledgerMatchPrompt('BRIEF', two(), { findings: [{ claim: 'k', where: 'w' }] });
    expect(p).toContain('D1. drops the last row\n   where: a/x.ts:3');
    expect(p).toContain('0. k\n   where: w');
    expect(ledgerMatchPrompt('BRIEF', emptyLedger('a', 'c', []), { raw: 'WHOLE' })).toMatch(/\(empty\)[\s\S]*whole[\s\S]*WHOLE/);
  });
});

describe('on disk', () => {
  it('writes, reads back, keeps reviews, and removes the lot', () => {
    const cfg = resolveConfig({ state: mkdtempSync(join(tmpdir(), 'skulkr-ledger-')) });
    dirs.push(cfg.state);
    expect(ledgerOf(cfg, 'a')).toBeUndefined();
    writeLedger(cfg, two());
    expect(ledgerOf(cfg, 'a')).toEqual(two());
    const file = keepReview(cfg, 'a', 3, 'gpt 5', 'raw');
    expect(file).toBe('reviews/03-gpt-5.md');
    expect(readFileSync(join(cfg.state, 'saturation/a', file), 'utf8')).toBe('raw');
    expect(removeLedger(cfg, 'a')).toBe(true);
    expect(existsSync(join(cfg.state, 'saturation/a'))).toBe(false);
    expect(removeLedger(cfg, 'a')).toBe(false);
  });

  it('reads a severity line in either bold form', () => {
    expect(severityOf({ body: '- **severity:** Medium' })).toBe('medium');
    expect(severityOf({ body: 'nothing' })).toBe('');
  });
});
