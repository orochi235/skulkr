import { describe, expect, it } from 'vitest';
import { resolveConfig } from './config.mjs';
import { fixShell, matchShell, reviewShell } from './jobs.mjs';
import { weaselConfig } from '../test/weaselConfig.ts';

const claudeOf = (shell: string) => shell.split(/ && |\n/).find((part) => part.includes('claude -p'))!;

describe('job command lines', () => {
  it("start every job without the account's settings, naming weasel's model and effort", () => {
    const cfg = weaselConfig();
    const review = claudeOf(reviewShell(cfg, 'core', 8));
    const fix = claudeOf(fixShell(cfg, 'core', 15, 3));
    const match = claudeOf(matchShell(cfg, 'core', 1));
    for (const line of [review, fix, match]) expect(line).toContain('--strict-mcp-config --setting-sources project,local');
    expect(review).toContain('--model opus --effort medium');
    expect(fix).toContain('--model opus --effort medium');
    expect(match).toContain('--model haiku');
    expect(match).not.toContain('--effort');
  });

  it('leave the model, effort, and setting sources to the node where the config leaves them unset', () => {
    const cfg = resolveConfig({ claude: { settingSources: null } });
    const review = claudeOf(reviewShell(cfg, 'core', 8));
    expect(review).not.toMatch(/--model|--effort|--setting-sources/);
  });
});
