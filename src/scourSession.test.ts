import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { transcriptCostOf, usageCostOf } from './agentCost.mjs';
import { ledgerOf } from './ledger.mjs';
import { saturateArgsOf, saturateCommand } from './saturate.mjs';
import { scourNext } from './scourSession.mjs';
import { project, scratch } from './scourTestKit.ts';

const OPUS = { input: 4, cacheRead: 0.2, output: 20 };
const reportOf = (claims: string[]) => `${claims.map((c) => `## ${c}\n- where: src/x.ts:1\n- severity: low\n`).join('\n')}\n## Files read\nsrc/x.ts\n\n<!-- done: ${claims.length} findings, files read: 1 -->\n`;

/** A session's environment, with a config directory holding the transcripts its subagents leave. */
const session = (tier: '1h' | '5m' = '1h') => {
  const config = scratch();
  const env = { CLAUDE_PID: String(process.pid), CLAUDE_CODE_SESSION_ID: 'sess', CLAUDE_CONFIG_DIR: config };
  mkdirSync(join(config, 'projects', '-proj'), { recursive: true });
  const write = { ephemeral_1h_input_tokens: tier === '1h' ? 900 : 0, ephemeral_5m_input_tokens: tier === '5m' ? 900 : 0 };
  writeFileSync(join(config, 'projects', '-proj', 'sess.jsonl'), `${JSON.stringify({ type: 'assistant', message: { id: 's1', model: 'claude-opus-5-5', usage: { cache_creation: write } } })}\n`);
  /** Leaves subagent `id`'s transcript: one Opus message of `output` tokens over `minutes`. */
  const transcript = (id: string, output: number, minutes = 2) => {
    const dir = join(config, 'projects', '-proj', 'sess', 'subagents');
    mkdirSync(dir, { recursive: true });
    const message = (at: number) => JSON.stringify({
      type: 'assistant', timestamp: new Date(Date.UTC(2026, 10, 26, 0, at)).toISOString(),
      message: { id: `m-${id}`, model: 'claude-opus-5-5', usage: { input_tokens: 0, cache_read_input_tokens: 0, output_tokens: output } },
    });
    writeFileSync(join(dir, `agent-${id}.jsonl`), `${message(0)}\n${message(minutes)}\n`);
  };
  return { env, transcript };
};

describe('agent cost', () => {
  it('prices cache writes by their lifetime and reads at their own rate', () => {
    const usage = { input_tokens: 1_000_000, cache_creation: { ephemeral_5m_input_tokens: 1_000_000, ephemeral_1h_input_tokens: 1_000_000 }, cache_read_input_tokens: 1_000_000, output_tokens: 1_000_000 };
    expect(usageCostOf(usage, OPUS)).toBeCloseTo(4 + 5 + 8 + 0.2 + 20);
  });

  it('counts a message once however many records carry it, and refuses a model it has no price for', () => {
    const dir = scratch();
    const record = (model: string) => JSON.stringify({ type: 'assistant', timestamp: '2026-11-26T00:00:00Z', message: { id: 'm1', model, usage: { output_tokens: 1_000_000 } } });
    writeFileSync(join(dir, 'a.jsonl'), `${record('claude-opus-5-5')}\n${record('claude-opus-5-5')}\n`);
    expect(transcriptCostOf(join(dir, 'a.jsonl'), { 'claude-opus-5-5': OPUS }).costUsd).toBeCloseTo(20);
    expect(() => transcriptCostOf(join(dir, 'a.jsonl'), {})).toThrow(/no price for claude-opus-5-5/);
  });
});

describe('skulkr scour next', () => {
  it('hands out reviews and matches, folds their answers at what the subagents cost, and stops at --max', async () => {
    const { root, cfg } = project();
    const { env, transcript } = session();
    const next = (...argv: string[]) => scourNext(cfg, root, 'src', saturateArgsOf(cfg, ['--max', '2', ...argv]), () => {}, env);

    const first = await next();
    expect(first).toMatchObject({ task: 'review', key: '01-claude' });
    const prompt = readFileSync(first.prompt, 'utf8');
    expect(prompt).toContain(`The frozen tree is \`${join(root, '.worktrees/audit-saturate-src')}\``);
    expect(prompt).toContain(`Write your answer to \`${first.out}\``);
    expect(prompt).toContain('src/x.ts');
    expect(existsSync(join(root, '.worktrees/audit-saturate-src/src/x.ts'))).toBe(true);
    expect(await next()).toMatchObject({ task: 'review', key: '01-claude', again: true });

    writeFileSync(first.out, reportOf(['A', 'B']));
    transcript('r1', 50_000);
    const match = await next('--agent', 'r1');
    expect(match).toMatchObject({ task: 'review', key: '02-claude' });
    expect(ledgerOf(cfg, 'src').occasions[0]).toMatchObject({ n: 1, source: 'claude', costUsd: 1, minutes: 2 });

    writeFileSync(match.out, reportOf(['B', 'C']));
    transcript('r2', 25_000);
    const matching = await next('--agent', 'r2');
    expect(matching).toMatchObject({ task: 'match', key: '02-claude', model: 'opus' });
    expect(readFileSync(matching.prompt, 'utf8')).toContain('Read no files');

    writeFileSync(matching.out, 'not json');
    transcript('m1', 5_000);
    const retry = await next('--agent', 'm1');
    expect(retry).toMatchObject({ task: 'match', key: '02-claude' });
    expect(retry.out).toMatch(/match2\.json$/);

    const ledger = ledgerOf(cfg, 'src');
    writeFileSync(retry.out, JSON.stringify({ sightings: [{ finding: 0, defect: ledger.defects.find((d: { claim: string }) => d.claim === 'B').id }], new: [{ finding: 1, claim: 'C', where: 'src/x.ts:1', severity: 'low' }], same: [] }));
    transcript('m2', 5_000);
    expect(await next('--agent', 'm2')).toEqual({ stop: 'reached the limit of 2 occasions' });
    const done = ledgerOf(cfg, 'src');
    expect(done.defects.map((d: { claim: string }) => d.claim)).toEqual(['A', 'B', 'C']);
    expect(done.occasions[1].costUsd).toBeCloseTo(0.5 + 0.1 + 0.1);
    expect(existsSync(join(root, '.worktrees/audit-saturate-src'))).toBe(false);
    expect(existsSync(join(cfg.state, 'scour/src/lock'))).toBe(false);
    expect(existsSync(join(cfg.state, 'scour/src/task.json'))).toBe(false);
  });

  it('refuses an answer it cannot price, and refuses to run outside a Claude Code session', async () => {
    const { root, cfg } = project();
    const { env } = session();
    const next = (...argv: string[]) => scourNext(cfg, root, 'src', saturateArgsOf(cfg, argv), () => {}, env);
    const first = await next();
    writeFileSync(first.out, reportOf(['A']));
    await expect(next()).rejects.toThrow(/--agent/);
    await expect(next('--agent', 'nobody')).rejects.toThrow(/no transcript for subagent nobody/);
    await expect(scourNext(cfg, root, 'src', saturateArgsOf(cfg, []), () => {}, {})).rejects.toThrow(/Claude Code session/);
  });

  it('hands out nothing once the session looks metered, unless told --metered', async () => {
    const { root, cfg } = project();
    const { env } = session('5m');
    const next = (...argv: string[]) => scourNext(cfg, root, 'src', saturateArgsOf(cfg, argv), () => {}, env);
    expect(await next()).toEqual({ pause: expect.stringMatching(/dropped to five minutes/) });
    expect(await next('--metered')).toMatchObject({ task: 'review', key: '01-claude' });
    const unknown = { ...env, CLAUDE_CODE_SESSION_ID: 'gone' };
    expect(await scourNext(cfg, root, 'src', saturateArgsOf(cfg, []), () => {}, unknown)).toEqual({ pause: expect.stringMatching(/can't be found/) });
  });

  it("keeps Claude's claude -p reviews to fleet mode", async () => {
    const { root, cfg } = project();
    await expect(saturateCommand(cfg, {}, root, ['src'], () => {}, { fleet: false })).rejects.toThrow(/--fleet/);
    await expect(saturateCommand(cfg, {}, root, ['run', 'src'], () => {}, { fleet: false })).rejects.toThrow(/--fleet/);
  });
});
