/**
 * What a Claude Code subagent cost, read from the transcript Claude Code keeps for it:
 * `<config dir>/projects/<project>/<session>/subagents/agent-<id>.jsonl`, one record per message part, each carrying its
 * message's `id`, `model` and `usage`.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** The config directories a transcript may sit under: `$CLAUDE_CONFIG_DIR` first, then the default. */
const configDirsOf = (env = process.env) => [...new Set([env.CLAUDE_CONFIG_DIR, join(homedir(), '.claude')].filter(Boolean))];

/** The session directories under `dirs`' projects: `session`'s alone when it is given. */
const sessionDirsIn = (dirs, session) => dirs.flatMap((dir) => {
  const projects = join(dir, 'projects');
  if (!existsSync(projects)) return [];
  return readdirSync(projects, { withFileTypes: true }).filter((p) => p.isDirectory()).flatMap((p) => (session
    ? [join(projects, p.name, session)]
    : readdirSync(join(projects, p.name), { withFileTypes: true }).filter((s) => s.isDirectory()).map((s) => join(projects, p.name, s.name))));
});

/**
 * Subagent `id`'s transcript, or undefined when no session holds one: looked for under `session` first, the session
 * that started it, then under every session.
 */
export const transcriptAt = (id, { session, env = process.env } = {}) => {
  const name = `agent-${id.replace(/^agent-/, '')}.jsonl`;
  const dirs = configDirsOf(env);
  for (const scope of session ? [session, undefined] : [undefined]) {
    const found = sessionDirsIn(dirs, scope).map((d) => join(d, 'subagents', name)).find((p) => existsSync(p));
    if (found) return found;
  }
  return undefined;
};

/**
 * What `usage` cost at `price` (`{ input, cacheRead, output }`, dollars per million tokens): a five-minute cache write
 * at 1.25× input, an hour's at 2×.
 */
export const usageCostOf = (usage, price) => {
  const writes = usage.cache_creation ?? { ephemeral_5m_input_tokens: usage.cache_creation_input_tokens ?? 0, ephemeral_1h_input_tokens: 0 };
  const inputs = (usage.input_tokens ?? 0) + 1.25 * (writes.ephemeral_5m_input_tokens ?? 0) + 2 * (writes.ephemeral_1h_input_tokens ?? 0);
  return (inputs * price.input + (usage.cache_read_input_tokens ?? 0) * price.cacheRead + (usage.output_tokens ?? 0) * price.output) / 1e6;
};

/**
 * The transcript at `path` summed: `{ costUsd, minutes, models }`, each message counted once under its last record,
 * priced from `prices` by model. Throws for a model `prices` does not hold.
 */
export const transcriptCostOf = (path, prices) => {
  const messages = new Map();
  const times = [];
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }
    if (record.timestamp) times.push(Date.parse(record.timestamp));
    if (record.type === 'assistant' && record.message?.usage) messages.set(record.message.id ?? record.uuid, record.message);
  }
  let costUsd = 0;
  const models = new Set();
  for (const m of messages.values()) {
    if (m.model === '<synthetic>') continue;
    const price = prices[m.model];
    if (!price) throw new Error(`no price for ${m.model}: add it to the config's claude.prices`);
    models.add(m.model);
    costUsd += usageCostOf(m.usage, price);
  }
  const minutes = times.length ? (Math.max(...times) - Math.min(...times)) / 60_000 : 0;
  return { costUsd, minutes, models: [...models] };
};
