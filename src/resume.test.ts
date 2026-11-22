import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { gitIn } from './batch.mjs';
import { resolveConfig } from './config.mjs';
import { resumable, resume } from './resume.mjs';

const dirs: string[] = [];
const temp = (prefix: string) => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('resumable', () => {
  const summary = { planned: ['a', 'b', 'c', 'd'], areas: [{ id: 'a', patches: 2 }, { id: 'b', patches: 1 }], landed: { tip: 'abc', areas: ['a', 'b'] } };

  it('resumes nothing once main holds the tip the round landed, though some areas did not land', () => {
    expect(resumable({ prior: summary, held: new Set(), inMain: (tip: string) => tip === 'abc' })).toEqual({ ids: [], held: [], landed: 'abc' });
  });

  it('runs every planned area again when main no longer holds the landed tip, or nothing landed', () => {
    expect(resumable({ prior: summary, held: new Set(), inMain: () => false }).ids).toEqual(['a', 'b', 'c', 'd']);
    expect(resumable({ prior: { areas: ['a', 'b'] }, held: new Set(), inMain: () => true }).ids).toEqual(['a', 'b']);
  });

  it('resumes every area after an early landing, naming the areas it landed', () => {
    const early = { ...summary, landed: { ...summary.landed, early: true } };
    expect(resumable({ prior: early, held: new Set(), inMain: (tip: string) => tip === 'abc' })).toEqual({ ids: ['a', 'b', 'c', 'd'], held: [], landedEarly: ['a', 'b'] });
    expect(resumable({ prior: early, held: new Set(), inMain: () => false })).toEqual({ ids: ['a', 'b', 'c', 'd'], held: [] });
  });

  it('leaves out the areas a live run holds, as a new plan does', () => {
    expect(resumable({ prior: summary, held: new Set(['c']), inMain: () => false })).toEqual({ ids: ['a', 'b', 'd'], held: ['c'] });
  });
});

describe('resume', () => {
  it('reports a round that died after main fast-forwarded as landed, and plans nothing to run again', async () => {
    const root = temp('skulkr-resume-');
    const git = gitIn(root);
    git('init', '-q', '-b', 'main');
    git('config', 'user.email', 'skulkr@example.invalid');
    git('config', 'user.name', 'skulkr');
    writeFileSync(join(root, 'a.txt'), 'a');
    git('add', 'a.txt');
    git('commit', '-q', '-m', 'a');
    const tip = git('rev-parse', 'HEAD');
    const cfg = resolveConfig({ state: temp('skulkr-state-') });
    const dir = join(cfg.state, 'runs', '7');
    mkdirSync(dir, { recursive: true });
    const status = { round: 7, commit: tip, started: '2026-11-21T00:00:00Z', nightDir: temp('skulkr-night-'), areas: ['a', 'b'], pid: 999_999_999, landed: { tip, areas: ['a'] } };
    writeFileSync(join(dir, 'status.json'), JSON.stringify(status));
    const said: string[] = [];
    const resumed = await resume(cfg, root, { resume: 7 }, (l: string) => said.push(l));
    expect(resumed).toEqual({ p: { round: 7 } });
    expect(said).toEqual([`resume: round 7 already landed on main at ${tip.slice(0, 10)}; nothing to resume`]);
  });
});
