import { describe, expect, it } from 'vitest';
import { resolveConfig } from './config.mjs';
import { localFixLine, localFixOf, parseArgs } from './args.mjs';

describe('parseArgs cap', () => {
  it('caps a run at areaCapUsd for each area it takes, in place of capUsd', () => {
    const cfg = resolveConfig({ name: 'p', areasPerRound: 8, budget: { capUsd: 160, areaCapUsd: 10 } });
    expect(parseArgs(cfg, []).capUsd).toBe(80);
    expect(parseArgs(cfg, ['--areas', '3']).capUsd).toBe(30);
    expect(parseArgs(cfg, ['--cap-usd', '50']).capUsd).toBe(50);
  });

  it('keeps capUsd when no areaCapUsd is set', () => {
    expect(parseArgs(resolveConfig({ name: 'p', areasPerRound: 8, budget: { capUsd: 160 } }), []).capUsd).toBe(160);
  });
});

describe('local fixers', () => {
  it('turns on with --local-fix, or for every run with localFix.enabled', () => {
    expect(parseArgs(resolveConfig({ name: 'p' }), []).localFix).toBe(false);
    expect(parseArgs(resolveConfig({ name: 'p' }), ['--local-fix']).localFix).toBe(true);
    expect(parseArgs(resolveConfig({ name: 'p', localFix: { enabled: true } }), []).localFix).toBe(true);
  });

  it("runs them as the account that started the run, else the config's, and is off without the flag", () => {
    const cfg = resolveConfig({ name: 'p', claude: { configDir: '~/.claude-msb' } });
    expect(localFixOf(cfg, { localFix: true }, { CLAUDE_CONFIG_DIR: '/Users/x/.claude-pw' })).toEqual({ account: '/Users/x/.claude-pw' });
    expect(localFixOf(cfg, { localFix: true }, {})).toEqual({ account: '~/.claude-msb' });
    expect(localFixOf(resolveConfig({ name: 'p' }), { localFix: true }, {})).toEqual({ account: undefined });
    expect(localFixOf(cfg, { localFix: false }, { CLAUDE_CONFIG_DIR: '/x' })).toBeNull();
    expect(localFixLine(cfg, { account: undefined })).toBe("fixers: on this machine, 2 at once, as the CLI's default account; their verify on the runner");
  });
});
