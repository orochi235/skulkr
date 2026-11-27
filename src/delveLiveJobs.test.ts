import { describe, expect, it } from 'vitest';
import { verifyingOf, withJobProgress } from './delveLive.mjs';

const job = (step: string, line: string, progress: { done: number; of: number } | null = null) => ({ key: 'b1', step, at: null, line, progress });

describe('verifyingOf', () => {
  it('reads a fixer handing its commits to the fleet as verifying there, dropping its commit count', () => {
    expect(verifyingOf(job('fix', 'skulkr: on the fleet as weasel-verify-d5', { done: 8, of: 8 })))
      .toMatchObject({ step: 'verify', of: 'fix', fleet: 'weasel-verify-d5', progress: null });
  });
  it('reads a local verify the same way, with no fleet task', () => {
    expect(verifyingOf(job('repair-1', "skulkr: verifying the fixer's commits"))).toMatchObject({ step: 'verify', of: 'repair-1', fleet: null });
  });
  it('names the fleet task of a verify step with its own log, and leaves a working fixer alone', () => {
    expect(verifyingOf(job('verify-fix-gui', 'skulkr: on the fleet as weasel-verify-gui-9a'))).toMatchObject({ step: 'verify-fix-gui', fleet: 'weasel-verify-gui-9a' });
    expect(verifyingOf(job('fix', 'skulkr: says: adding the test'))).toEqual(job('fix', 'skulkr: says: adding the test'));
  });
});

describe('withJobProgress', () => {
  const ledger = (jobs: object[]) => ({ area: 'routing.tools', running: { jobs } });
  it("gives a fleet job its fleet task's count", () => {
    const [l] = withJobProgress([ledger([{ ...job('verify-fix-gui', ''), fleet: 'weasel-verify-gui-9a' }])], new Map([['weasel-verify-gui-9a', { done: 208, total: 1812 }]]));
    expect(l.running.jobs[0].progress).toEqual({ done: 208, of: 1812 });
  });
  it("gives a local job the runner's tests and checks for its batch and step", () => {
    const progress = new Map([['weasel-auditscour fix 10-routing.tools~b1-fix', { done: 1, total: 8, tests: { done: 24, total: 24, failed: 1 }, checks: { done: 1, total: 2 } }]]);
    const [l] = withJobProgress([ledger([job('fix', 'skulkr: says: x', { done: 1, of: 8 })])], progress);
    expect(l.running.jobs[0]).toMatchObject({ progress: { done: 1, of: 8 }, tests: { done: 24, total: 24, failed: 1 }, checks: { done: 1, total: 2 } });
  });
});
