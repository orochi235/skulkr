import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveConfig } from '../config.mjs';
import { reviewShell } from '../jobs.mjs';
import { codex } from './codex.mjs';
import { briefPathFor, requireAgents } from './index.mjs';

/** A real `codex exec --json` run (codex-cli 0.169.0, 2026-11-21) that read one file with `sed` and replied. */
const EVENTS = readFileSync(fileURLToPath(new URL('./fixtures/codex-events.jsonl', import.meta.url)), 'utf8');
const FILTER = fileURLToPath(new URL('./codexProgress.mjs', import.meta.url));
const priced = { agent: { review: 'codex' }, codex: { models: { review: 'gpt-x' }, prices: { 'gpt-x': { input: 2, cachedInput: 0.5, output: 10 } } } };

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('the codex agent', () => {
  it('runs a reviewer in the workspace sandbox on its model, through its progress filter, never waiting on stdin', () => {
    const shell = reviewShell(resolveConfig(priced), 'core', 8);
    expect(shell).toContain("codex exec --json --ephemeral --sandbox workspace-write --skip-git-repo-check --ignore-user-config --model 'gpt-x'");
    expect(shell).toContain("< /dev/null 2> .skulkr/out/codex.err | node .skulkr/in/codexProgress.mjs '.skulkr/in/core/files.txt' .skulkr/out/codex.jsonl");
    expect(shell).not.toContain('claude -p');
  });

  it('reads the last message and prices the turn from the config, input counted without its cached part', () => {
    const { reply, record, error } = codex.resultOf(EVENTS, { cfg: resolveConfig(priced), role: 'review-A' });
    expect(reply).toBe('beta');
    expect(error).toBe(false);
    expect(record).toMatchObject({ models: ['gpt-x'], tokens: { input: 3780, cacheRead: 30720, output: 58 }, terminalReason: 'completed', budgetHit: false });
    expect(record.costUsd).toBeCloseTo((3780 * 2 + 30720 * 0.5 + 58 * 10) / 1e6, 10);
    expect(codex.resultOf('', {}).record.terminalReason).toBe('no envelope');
    expect(codex.resultOf('{"type":"turn.failed","error":{"message":"x"}}\n', {}).error).toBe(true);
  });

  it('refuses a config that names codex for a role it cannot run, or leaves its model unpriced', () => {
    expect(() => requireAgents(resolveConfig(priced))).not.toThrow();
    expect(() => requireAgents(resolveConfig({ ...priced, agent: { review: 'codex', fix: 'codex' } }))).toThrow('codex runs only review jobs so far, not fix');
    expect(() => requireAgents(resolveConfig({ agent: { review: 'codex' } }))).toThrow('codex needs `codex.models.review`');
    expect(() => requireAgents(resolveConfig({ agent: { review: 'codex' }, codex: { models: { review: 'gpt-y' } } }))).toThrow("codex.prices['gpt-y']");
  });

  it("gives a codex reviewer the shipped codex brief, and every other role the config's", () => {
    const cfg = resolveConfig(priced);
    expect(briefPathFor(cfg, 'reviewer')).toMatch(/briefs\/codex\/reviewer\.md$/);
    expect(briefPathFor(cfg, 'fixer')).toBe(cfg.briefPath('fixer'));
  });

  it('counts each listed file a command first names, and keeps only the events skulkr reads back', () => {
    const dir = mkdtempSync(join(tmpdir(), 'skulkr-codex-'));
    dirs.push(dir);
    writeFileSync(join(dir, 'files.txt'), 'a.txt\nb.txt\n');
    const run = spawnSync(process.execPath, [FILTER, 'files.txt', 'codex.jsonl'], { cwd: dir, input: EVENTS, encoding: 'utf8' });
    expect(run.status).toBe(0);
    expect(run.stdout).toBe('onto: progress 0/2\nonto: progress 1/2\n');
    const kept = readFileSync(join(dir, 'codex.jsonl'), 'utf8');
    expect(kept).not.toContain('command_execution');
    expect(codex.resultOf(kept, {}).reply).toBe('beta');
  });
});
