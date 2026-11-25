import { describe, expect, it } from 'vitest';
import { issueGroupsOf } from './Issues';
import type { AuditArea, AuditRun } from './skulkrMap.types';

const area = (id: string, more: Partial<AuditArea> = {}): AuditArea =>
  ({ id, group: 'core', files: 3, status: 'audited', queue: null, passes: [], stage: null, ...more } as AuditArea);

describe('issueGroupsOf', () => {
  it('groups what the gate fails, failed steps, left-out branches and open findings, leaving out empty groups', () => {
    const run = {
      round: 84, running: true, gateRuns: [{ id: 'test', label: 'test:batch' }],
      failures: { test: { count: 2, files: 1, names: [], list: [{ file: 'a.test.ts', count: 2, tests: [{ test: 'adds', error: 'expected 2' }] }] } },
      lanes: [{ id: 'core.ops', steps: { A: { state: 'done' }, B: { state: 'done' }, match: { state: 'done' }, fix: { state: 'failed', why: 'crashed' }, patch: { state: 'waiting' } } }],
    } as unknown as AuditRun;
    const groups = issueGroupsOf([area('core.ops', { openFindings: 2 }), area('core.ui')], [run], [{ area: 'core.ui', round: 83, why: 'merge conflict in a.ts' }]);
    expect(groups.map((g) => [g.id, g.items.map((i) => [i.text, i.area, i.count])])).toEqual([
      ['gate', [['a.test.ts', undefined, 2]]],
      ['steps', [['core.ops: fix failed, crashed', 'core.ops', undefined]]],
      ['left', [['core.ui: left out of round 83', 'core.ui', undefined]]],
      ['open', [['core.ops', 'core.ops', 2]]],
    ]);
    expect(issueGroupsOf([area('x')], [], [])).toEqual([]);
  });
});
