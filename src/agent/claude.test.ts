import { describe, expect, it } from 'vitest';
import { resolveConfig } from '../config.mjs';
import { claude } from './claude.mjs';

const lineFor = (cfg: ReturnType<typeof resolveConfig>, role: string) => claude.line(cfg, role, { promptFile: 'p.md', budgetUsd: 1, progress: undefined });

describe('claude.line', () => {
  it('refuses `claude.denied` to every role, beside each role\'s own refusals', () => {
    const cfg = resolveConfig({}, { local: true, env: {} });
    expect(lineFor(cfg, 'review')).toContain("--disallowedTools 'Task,Agent,WebFetch,WebSearch'");
    expect(lineFor(cfg, 'match')).toContain("--disallowedTools 'Bash,Edit,Write,Task,Agent,WebFetch,WebSearch'");
    expect(lineFor(cfg, 'fix')).toContain("--dangerously-skip-permissions --disallowedTools 'WebFetch,WebSearch'");
  });

  it("refuses a local fixer the config's fleet-only commands run bare, unless checks stay on this machine", () => {
    const local = (over: Record<string, unknown> = {}) => resolveConfig({ local: { fleetOnly: ['npm run checks:gate'], ...over } }, { local: true, env: {} });
    expect(lineFor(local(), 'fix')).toContain("--disallowedTools 'Bash(npm run checks:gate),Bash(npm run checks:gate:*),WebFetch,WebSearch'");
    expect(lineFor(local(), 'review')).not.toContain('checks:gate');
    expect(lineFor(local({ fleetChecks: false }), 'fix')).toContain("--disallowedTools 'WebFetch,WebSearch'");
    expect(lineFor(resolveConfig({ local: { fleetOnly: ['npm run checks:gate'] } }), 'fix')).not.toContain('--disallowedTools');
  });

  it('refuses a fixer nothing when nothing is denied', () => {
    expect(lineFor(resolveConfig({}), 'fix')).not.toContain('--disallowedTools');
  });
});
