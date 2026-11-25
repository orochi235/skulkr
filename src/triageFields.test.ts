import { describe, expect, it } from 'vitest';
import { parseFindings } from './findings.mjs';
import { allNew, emptyLedger, matchOf, withOccasion } from './ledger.mjs';
import { mergedTriage, triageFieldsOf, triageOf } from './triageFields.mjs';

const REPORT = `## Wheel zoom jumps to the floor
- where: src/zoom.ts:16 (zoomAt)
- scenario: a huge delta with no max → zoom collapses to 1e-9
- evidence: read
- severity: low
- fix: src/zoom.ts, src/clamp.ts:4
- size: function
- cause: unclamped multiplier
- confidence: likely
`;

describe('triage fields', () => {
  it('reads the fields a finding gives, and only those', () => {
    const [f] = parseFindings(REPORT);
    expect(triageOf(f!)).toEqual({
      scenario: 'a huge delta with no max → zoom collapses to 1e-9', fix: ['src/zoom.ts', 'src/clamp.ts'], size: 'function',
      cause: 'unclamped multiplier', confidence: 'likely',
    });
    expect(triageOf({ body: '- where: x.ts:1\n- size: enormous' })).toEqual({});
  });

  it('merges a further sighting: highest severity, union of fix files, largest size, strongest confidence, first scenario', () => {
    const d = { severity: 'low', scenario: 'first', fix: ['a.ts'], size: 'line', confidence: 'likely' };
    expect(mergedTriage(d, { severity: 'medium', scenario: 'second', fix: ['b.ts', 'a.ts'], size: 'function', cause: 'c', confidence: 'sure' }))
      .toEqual({ severity: 'medium', scenario: 'first', fix: ['a.ts', 'b.ts'], size: 'function', cause: 'c', confidence: 'sure' });
    expect(mergedTriage(d, { severity: 'low', size: 'line' })).toEqual(d);
    expect(triageFieldsOf({ claim: 'x' })).toBeUndefined();
  });

  it('keeps them on a ledger defect from its first report, and merges the next one that sights it', () => {
    const first = withOccasion(emptyLedger('a', 'c0ffee', ['src/zoom.ts']), { n: 1, source: 'claude' }, allNew(parseFindings(REPORT)));
    expect(first.defects[0]).toMatchObject({ id: 'D1', severity: 'low', size: 'function', confidence: 'likely', fix: ['src/zoom.ts', 'src/clamp.ts'] });
    const again = parseFindings(REPORT.replace('severity: low', 'severity: high').replace('size: function', 'size: design').replace('confidence: likely', 'confidence: sure'));
    const match = matchOf('{"sightings": [{"finding": 0, "defect": "D1"}], "new": [], "same": []}', first, again);
    const second = withOccasion(first, { n: 2, source: 'codex' }, match);
    expect(second.defects[0]).toMatchObject({ severity: 'high', size: 'design', confidence: 'sure', scenario: 'a huge delta with no max → zoom collapses to 1e-9', sightings: [1, 2] });
  });

  it('takes them from a matcher’s enumeration of an ingested report', () => {
    const ledger = emptyLedger('a', 'c0ffee', ['src/zoom.ts']);
    const reply = JSON.stringify({ findings: [{ claim: 'x', where: 'src/zoom.ts:3', severity: 'Medium', size: 'line', cause: 'off by one' }], sightings: [], new: [{ finding: 0, claim: 'x', where: 'src/zoom.ts:3', severity: 'medium' }], same: [] });
    const next = withOccasion(ledger, { n: 1, source: 'codex' }, matchOf(reply, ledger, undefined));
    expect(next.defects[0]).toMatchObject({ severity: 'medium', size: 'line', cause: 'off by one' });
  });
});
