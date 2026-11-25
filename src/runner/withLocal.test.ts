import { describe, expect, it } from 'vitest';
import { withLocal } from './withLocal.mjs';

const runner = (name: string, extra = {}) => {
  const ran: unknown[] = [];
  return {
    ran,
    places: name === 'fleet',
    run: async (job: Record<string, unknown>) => {
      ran.push(job);
      return { status: 0, busy: false, refused: false };
    },
    unavailableNodes: () => new Set<string>(),
    jobs: () => [{ task: `${name}-job` }],
    progress: () => new Map([[`${name}-job`, { done: 1, total: 2 }]]),
    ...extra,
  };
};

describe('withLocal', () => {
  it("sends a job naming node local to this machine, naming no node there, and the rest to the fleet", async () => {
    const fleet = runner('fleet');
    const local = runner('local');
    const both = withLocal(fleet, local);
    await both.run({ task: 'a-fix', node: 'local' }, {});
    await both.run({ task: 'a-verify' }, {});
    expect(local.ran).toEqual([{ task: 'a-fix', node: undefined }]);
    expect(fleet.ran).toEqual([{ task: 'a-verify' }]);
    expect(both).toMatchObject({ places: true, routesLocal: true });
  });

  it("lists both runners' jobs and progress", () => {
    const both = withLocal(runner('fleet'), runner('local', { progress: undefined }));
    expect(both.jobs('2026-11-23T00:00:00Z').map((j: { task: string }) => j.task)).toEqual(['fleet-job', 'local-job']);
    expect([...both.progress().keys()]).toEqual(['fleet-job']);
  });

  it('asks the fleet for progress only while a running job is on it', () => {
    let asked = 0;
    const fleet = runner('fleet', { progress: () => (asked++, new Map([['fleet-job', { done: 1, total: 2 }]])) });
    const both = withLocal(fleet, runner('local'));
    expect([...both.progress([{ task: 'local-job', node: 'local' }]).keys()]).toEqual(['local-job']);
    expect(asked).toBe(0);
    expect([...both.progress([{ task: 'local-job', node: 'local' }, { task: 'fleet-job', node: 'studio' }]).keys()]).toEqual(['fleet-job', 'local-job']);
    expect(asked).toBe(1);
  });
});
