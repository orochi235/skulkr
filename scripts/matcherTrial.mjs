#!/usr/bin/env node
/**
 * Replays past scour ledger matches on other models and scores them against the ledger's own answer.
 *
 *   node scripts/matcherTrial.mjs --tenant <name> [--models haiku,sonnet,opus] [--n 15] [--at-once 3] [--out <file>] [--dry]
 *
 * For a sample of past occasions, each rebuilds the ledger as it stood before that occasion (the defects first seen
 * earlier), hands each model the matcher's brief with that ledger and the occasion's findings, and compares its reply
 * with what the ledger recorded: which earlier defects the occasion sighted, and how many it added. Each call is a
 * local `claude -p` as the account that started the script, from an empty directory so every model reads the same
 * context. Every raw reply and its usage go to `--out`, one JSON line per call, as they finish; the summary is
 * computed from those. Stops at the first call that wrote only five-minute cache, the sign of metered usage.
 */
import { spawn } from 'node:child_process';
import { appendFileSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../src/config.mjs';
import { requireTenant } from '../src/tenants.mjs';
import { fill, projectVars } from '../src/brief.mjs';
import { parseFindings } from '../src/findings.mjs';
import { ledgerDirOf, ledgerMatchPrompt, ledgerOf, matchOf } from '../src/ledger.mjs';
import { scourStateDirOf } from '../src/scourPaths.mjs';
import { readIf } from '../src/text.mjs';

const flag = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i < 0 ? fallback : process.argv[i + 1];
};
const tenant = flag('tenant');
if (!tenant) throw new Error('--tenant <name> names the project whose ledgers to replay');
const models = flag('models', 'haiku,sonnet,opus').split(',');
const n = Number(flag('n', 15));
const atOnce = Number(flag('at-once', 3));
const out = flag('out', join('.playwright-mcp', `matcher-trial-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`));

const cfg = await loadConfig({ config: requireTenant(tenant).config });
const brief = fill(readIf(cfg.briefPath('ledgerMatch')), projectVars(cfg, 'matcher'));

/** Every occasion an Opus `claude -p` matcher folded (no `matcher` recorded), with a ledger before it and findings to match. */
const dir = scourStateDirOf(cfg);
const candidates = readdirSync(dir).flatMap((id) => {
  const ledger = ledgerOf(cfg, id);
  return ledger ? [{ id, ledger }] : [];
}).flatMap(({ id, ledger }) => ledger.occasions
  .filter((o) => o.n > 1 && o.kind === 'review' && !o.matcher && o.findings > 0)
  .flatMap((o) => {
    const before = ledger.defects.filter((d) => (d.firstOccasion ?? d.sightings[0]) < o.n);
    if (before.length === 0) return [];
    const findings = parseFindings(readIf(join(ledgerDirOf(cfg, id), o.file)));
    if (findings.length !== o.findings) return [];
    const sighted = ledger.defects.filter((d) => (d.firstOccasion ?? d.sightings[0]) < o.n && d.sightings.includes(o.n)).map((d) => d.id);
    const added = ledger.defects.filter((d) => (d.firstOccasion ?? d.sightings[0]) === o.n).length;
    return [{ area: ledger.area, n: o.n, findings, before, sighted, added }];
  }));

/** `count` of `list`, spread evenly through it so no one area fills the sample. */
const spread = (list, count) => (list.length <= count ? list : Array.from({ length: count }, (_, i) => list[Math.floor((i * list.length) / count)]));
const sample = spread(candidates, n);
if (process.argv.includes('--dry')) {
  for (const s of sample) console.log(`${s.area} #${s.n}: ${s.findings.length} findings against ${s.before.length} defects; sighted ${s.sighted.length}, added ${s.added}`);
  process.exit(0);
}

const cwd = mkdtempSync(join(tmpdir(), 'skulkr-matcher-trial-'));
const claude = (model, prompt) => new Promise((resolve) => {
  const child = spawn('claude', ['-p', '--model', model, '--output-format', 'json', '--strict-mcp-config', '--setting-sources', 'project,local',
    '--disallowedTools', 'Bash,Edit,Write,Read,Grep,Glob,Task,Agent,WebFetch,WebSearch', '--max-budget-usd', '2'], { cwd, env: process.env });
  let stdout = '';
  child.stdout.on('data', (d) => { stdout += d; });
  child.stdin.end(prompt);
  child.on('close', () => {
    try {
      resolve(JSON.parse(stdout));
    } catch {
      resolve({ is_error: true, result: stdout });
    }
  });
});

/** The reply scored against the ledger: sightings' precision and recall, and the new count against the ledger's. */
const scoreOf = (item, reply) => {
  const ledger = { defects: item.before };
  try {
    const match = matchOf(reply, ledger, item.findings);
    const got = new Set(match.sightings.map((s) => s.defect));
    const want = new Set(item.sighted);
    const hit = [...got].filter((d) => want.has(d)).length;
    return { ok: true, sightedGot: got.size, sightedWant: want.size, hit, newGot: match.new.length, newWant: item.added };
  } catch (error) {
    return { ok: false, error: error.message };
  }
};

const jobs = sample.flatMap((item) => models.map((model) => ({ item, model })));
console.log(`matcher trial: ${sample.length} occasions of ${candidates.length} × ${models.join(', ')} = ${jobs.length} calls, ${atOnce} at once; raw to ${out}`);
let done = 0;
let stopped = false;
const run = async ({ item, model }) => {
  if (stopped) return;
  const t0 = Date.now();
  const env = await claude(model, ledgerMatchPrompt(brief, { defects: item.before }, { findings: item.findings }));
  const u = env.usage ?? {};
  const w1h = u.cache_creation?.ephemeral_1h_input_tokens ?? 0;
  const w5m = u.cache_creation?.ephemeral_5m_input_tokens ?? 0;
  const score = scoreOf(item, String(env.result ?? ''));
  const record = {
    area: item.area, n: item.n, model, models: Object.keys(env.modelUsage ?? {}), costUsd: env.total_cost_usd ?? null, seconds: (Date.now() - t0) / 1000,
    usage: u, isError: env.is_error === true, findings: item.findings.length, ledgerDefects: item.before.length, sighted: item.sighted, added: item.added,
    score, reply: env.result ?? null,
  };
  appendFileSync(out, `${JSON.stringify(record)}\n`);
  done += 1;
  const s = score.ok ? `sighted ${score.hit}/${score.sightedWant} (gave ${score.sightedGot}), new ${score.newGot}/${score.newWant}` : `unusable: ${score.error}`;
  console.log(`${String(done).padStart(2)}/${jobs.length} ${model.padEnd(6)} ${item.area} #${item.n}: $${(record.costUsd ?? 0).toFixed(3)} ${record.seconds.toFixed(0)}s; ${s}`);
  if (w5m > 0 && w1h === 0) {
    stopped = true;
    console.log('stopping: that call wrote only five-minute cache, the sign of metered usage');
  }
};
const queue = [...jobs];
await Promise.all(Array.from({ length: atOnce }, async () => {
  while (queue.length && !stopped) await run(queue.shift());
}));
rmSync(cwd, { recursive: true, force: true });

const rows = readFileSync(out, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
console.log('\nmodel   calls  usable  sighting recall  sighting precision  new count exact  mean $/call');
for (const model of models) {
  const mine = rows.filter((r) => r.model === model);
  const ok = mine.filter((r) => r.score.ok);
  const sum = (f) => ok.reduce((s, r) => s + f(r), 0);
  const recall = sum((r) => r.score.hit) / Math.max(1, sum((r) => r.score.sightedWant));
  const precision = sum((r) => r.score.hit) / Math.max(1, sum((r) => r.score.sightedGot));
  const exact = ok.filter((r) => r.score.newGot === r.score.newWant).length / Math.max(1, ok.length);
  const cost = mine.reduce((s, r) => s + (r.costUsd ?? 0), 0) / Math.max(1, mine.length);
  console.log(`${model.padEnd(6)} ${String(mine.length).padStart(6)} ${String(ok.length).padStart(7)} ${(recall * 100).toFixed(1).padStart(15)}% ${(precision * 100).toFixed(1).padStart(18)}% ${(exact * 100).toFixed(1).padStart(15)}% ${cost.toFixed(4).padStart(12)}`);
}
