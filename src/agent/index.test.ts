import { describe, expect, it } from 'vitest';
import { resolveConfig } from '../config.mjs';
import { agentFor, agentRoleOf, requireAgents } from './index.mjs';

describe('agentFor', () => {
  it('runs every role on claude by default, and a repair and both reviewers as their agent roles', () => {
    const cfg = resolveConfig({});
    for (const role of ['review-A', 'review-B', 'match', 'fix', 'repair']) expect(agentFor(cfg, role).name).toBe('claude');
    expect(['review-A', 'repair', 'match'].map(agentRoleOf)).toEqual(['review', 'fix', 'match']);
  });

  it('takes a name per role, and refuses one no agent answers to before anything runs', () => {
    expect(agentFor(resolveConfig({ agent: { review: 'claude' } }), 'fix').name).toBe('claude');
    expect(() => requireAgents(resolveConfig({ agent: { review: 'nobody' } }))).toThrow('no agent named nobody for review jobs');
    expect(() => agentFor(resolveConfig({ agent: 'nobody' }), 'repair')).toThrow('no agent named nobody for fix jobs');
  });
});
