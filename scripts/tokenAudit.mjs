#!/usr/bin/env node
/**
 * Where Claude's tokens went: every Claude Code transcript in the given project directories, priced at list rates.
 *
 *   node scripts/tokenAudit.mjs --out <file.jsonl> [--since <ISO date>] <transcript dir>...
 *
 * Each directory is one of an account's `projects/<slug>/` folders (the job trees' `…weasel-skulkr-trees-t1`, a
 * repository's own). One JSON line per transcript goes to `--out` as it is read: its kind (from the first prompt's
 * heading), models, turns, every token count, the largest single turn's context, its minutes, its tool calls by name,
 * and its Bash commands that ran tests, typechecks or sleeps. The digest printed after is computed from those lines.
 * A message is counted once, under its last record, as `src/agentCost.mjs` counts it.
 */
import { appendFileSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { DEFAULTS } from '../src/config.mjs';
import { usageCostOf } from '../src/agentCost.mjs';

const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  console.log('usage: node scripts/tokenAudit.mjs --out <file.jsonl> [--since <ISO date>] <transcript dir>...');
  process.exit(0);
}
const take = (name) => {
  const i = args.indexOf(`--${name}`);
  if (i < 0) return undefined;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
};
const out = take('out');
const since = take('since');
const unknown = args.find((a) => a.startsWith('-'));
if (unknown || !out || args.length === 0) {
  console.error(unknown ? `unknown flag ${unknown}` : 'usage: node scripts/tokenAudit.mjs --out <file.jsonl> [--since <ISO date>] <transcript dir>...');
  process.exit(2);
}
const sinceMs = since ? Date.parse(since) : 0;
const PRICES = DEFAULTS.claude.prices;

/** What a transcript was, from the first line of its first prompt. */
const kindOf = (prompt) => {
  const head = prompt.split('\n').find((l) => l.trim()) ?? '';
  const m = /(fixer|repair|reviewer|review|matcher|match|conflict|triage)\b[^,]*brief/i.exec(head);
  if (m) return m[1].toLowerCase().replace(/^review$/, 'reviewer').replace(/^match$/, 'matcher');
  if (/^Read .*prompt\.md and do exactly/i.test(head)) return 'scour subagent';
  if (/^(Several blind reviews|Two reviewers independently)/.test(head)) return 'matcher';
  if (/<command-name>|<local-command/.test(head)) return 'session';
  return head.length ? 'session' : 'empty';
};

const TEST = /\b(vitest|npm (run )?test|playwright test)\b/;
const CHECK = /\b(tsc|typecheck|checks:gate|lint|biome)\b/;
const SLEEP = /\bsleep \d/;

const readTranscript = (path) => {
  const messages = new Map();
  const times = [];
  let prompt = '';
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    let r;
    try { r = JSON.parse(line); } catch { continue; }
    if (r.timestamp) times.push(Date.parse(r.timestamp));
    if (!prompt && r.type === 'user' && r.message) {
      const c = r.message.content;
      prompt = typeof c === 'string' ? c : (c ?? []).filter((x) => x.type === 'text').map((x) => x.text).join('\n');
    }
    if (r.type === 'assistant' && r.message?.usage) messages.set(r.message.id ?? r.uuid, r.message);
  }
  const t = { input: 0, write5m: 0, write1h: 0, read: 0, output: 0 };
  let costUsd = 0, maxContext = 0;
  // Each turn's cost by the context it reread: what long contexts cost over short ones.
  const byContext = { under100k: 0, to200k: 0, to400k: 0, over400k: 0 };
  const models = new Set(), tools = {}, bash = { test: 0, check: 0, sleep: 0, other: 0 };
  for (const m of messages.values()) {
    if (m.model === '<synthetic>') continue;
    const u = m.usage;
    const w = u.cache_creation ?? { ephemeral_5m_input_tokens: u.cache_creation_input_tokens ?? 0, ephemeral_1h_input_tokens: 0 };
    t.input += u.input_tokens ?? 0;
    t.write5m += w.ephemeral_5m_input_tokens ?? 0;
    t.write1h += w.ephemeral_1h_input_tokens ?? 0;
    t.read += u.cache_read_input_tokens ?? 0;
    t.output += u.output_tokens ?? 0;
    const context = (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
    maxContext = Math.max(maxContext, context);
    models.add(m.model);
    const turnUsd = PRICES[m.model] ? usageCostOf(u, PRICES[m.model]) : 0;
    costUsd += turnUsd;
    byContext[context < 1e5 ? 'under100k' : context < 2e5 ? 'to200k' : context < 4e5 ? 'to400k' : 'over400k'] += turnUsd;
    for (const c of m.content ?? []) {
      if (c.type !== 'tool_use') continue;
      tools[c.name] = (tools[c.name] ?? 0) + 1;
      if (c.name === 'Bash') {
        const cmd = String(c.input?.command ?? '');
        bash[TEST.test(cmd) ? 'test' : CHECK.test(cmd) ? 'check' : SLEEP.test(cmd) ? 'sleep' : 'other']++;
      }
    }
  }
  const start = Math.min(...times), end = Math.max(...times);
  return {
    path, kind: kindOf(prompt), head: (prompt.split('\n').find((l) => l.trim()) ?? '').slice(0, 120),
    started: Number.isFinite(start) ? new Date(start).toISOString() : null,
    minutes: Number.isFinite(start) ? +((end - start) / 60_000).toFixed(1) : 0,
    models: [...models], turns: messages.size, ...t, maxContext, costUsd: +costUsd.toFixed(4),
    byContext: Object.fromEntries(Object.entries(byContext).map(([k, v]) => [k, +v.toFixed(4)])),
    unpriced: [...models].filter((m) => !PRICES[m]), tools, bash,
  };
};

writeFileSync(out, '');
const files = args.flatMap((dir) => readdirSync(dir).filter((f) => f.endsWith('.jsonl')).map((f) => join(dir, f)))
  .filter((f) => statSync(f).mtimeMs >= sinceMs);
const rows = [];
files.forEach((f, i) => {
  const row = { dir: basename(join(f, '..')), ...readTranscript(f) };
  rows.push(row);
  appendFileSync(out, `${JSON.stringify(row)}\n`);
  if ((i + 1) % 25 === 0 || i + 1 === files.length) console.error(`${i + 1}/${files.length}`);
});

const usd = (n) => `$${n.toFixed(2).padStart(8)}`;
const mtok = (n) => `${(n / 1e6).toFixed(1).padStart(7)}M`;
const groups = new Map();
for (const r of rows) {
  const g = groups.get(r.kind) ?? { n: 0, costUsd: 0, read: 0, writes: 0, output: 0, turns: 0, minutes: 0, test: 0 };
  g.n++; g.costUsd += r.costUsd; g.read += r.read; g.writes += r.write5m + r.write1h; g.output += r.output;
  g.turns += r.turns; g.minutes += r.minutes; g.test += r.bash.test;
  groups.set(r.kind, g);
}
console.log(`\n${'kind'.padEnd(16)} ${'n'.padStart(5)} ${'cost'.padStart(9)} ${'cache read'.padStart(10)} ${'writes'.padStart(8)} ${'output'.padStart(8)} ${'turns/n'.padStart(8)} ${'min/n'.padStart(6)} ${'tests/n'.padStart(8)}`);
for (const [k, g] of [...groups].sort((a, b) => b[1].costUsd - a[1].costUsd)) {
  console.log(`${k.padEnd(16)} ${String(g.n).padStart(5)} ${usd(g.costUsd)} ${mtok(g.read).padStart(10)} ${mtok(g.writes)} ${mtok(g.output)} ${(g.turns / g.n).toFixed(1).padStart(8)} ${(g.minutes / g.n).toFixed(1).padStart(6)} ${(g.test / g.n).toFixed(1).padStart(8)}`);
}
const total = rows.reduce((s, r) => s + r.costUsd, 0);
const ctx = rows.reduce((acc, r) => { for (const [k, v] of Object.entries(r.byContext)) acc[k] = (acc[k] ?? 0) + v; return acc; }, {});
console.log(`\ncost by the context each turn reread: ${Object.entries(ctx).map(([k, v]) => `${k} ${usd(v).trim()} (${(100 * v / total).toFixed(0)}%)`).join(', ')}`);
console.log(`${'total'.padEnd(16)} ${String(rows.length).padStart(5)} ${usd(total)}`);
console.log('\nmost expensive transcripts:');
for (const r of [...rows].sort((a, b) => b.costUsd - a.costUsd).slice(0, 12)) {
  console.log(`${usd(r.costUsd)} ${String(r.turns).padStart(4)} turns ${r.minutes.toFixed(0).padStart(4)} min  max ctx ${(r.maxContext / 1000).toFixed(0).padStart(4)}k  ${r.kind.padEnd(14)} ${r.dir.slice(-24)} ${r.head.slice(0, 60)}`);
}
