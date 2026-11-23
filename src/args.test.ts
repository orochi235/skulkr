import { describe, expect, it } from 'vitest';
import { resolveConfig } from './config.mjs';
import { parseArgs } from './args.mjs';

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
