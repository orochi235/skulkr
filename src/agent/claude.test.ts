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

  it('refuses a fixer nothing when nothing is denied', () => {
    expect(lineFor(resolveConfig({}), 'fix')).not.toContain('--disallowedTools');
  });
});
