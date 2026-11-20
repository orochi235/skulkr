import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { resolveConfig } from '../src/config.mjs';

/** The variables `area.mjs` fills in each brief, beside the project's (`project`, `rules`, `test`, `typecheck`, `lint`). */
const FILLED: Record<string, string[]> = {
  reviewer: ['round', 'area', 'commit', 'out', 'files'],
  matcher: [],
  fixer: ['round', 'area', 'commit', 'source'],
};
const PROJECT = ['project', 'rules', 'test', 'typecheck', 'lint'];
const used = (path: string) => [...readFileSync(path, 'utf8').matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]);

describe('briefs', () => {
  it('ship a default for every role, naming only variables that get filled', () => {
    const cfg = resolveConfig({});
    for (const role of Object.keys(FILLED)) {
      for (const name of used(cfg.briefPath(role))) expect([...FILLED[role], ...PROJECT]).toContain(name);
    }
  });

  it('as weasel overrides them, name only variables that get filled', () => {
    for (const file of readdirSync(new URL('../examples/weasel/briefs/', import.meta.url))) {
      const role = file.replace(/\.md$/, '');
      for (const name of used(new URL(`../examples/weasel/briefs/${file}`, import.meta.url).pathname)) expect([...FILLED[role], ...PROJECT]).toContain(name);
    }
  });

  it('resolve a project brief against the config file\'s directory', () => {
    const cfg = resolveConfig({ briefs: { fixer: './rules/fix.md' } }, { file: '/p/skulk.config.mjs' });
    expect(cfg.briefPath('fixer')).toBe('/p/rules/fix.md');
  });
});
