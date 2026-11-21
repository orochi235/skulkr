/**
 * The Claude Code agent: each model job runs `claude -p` on its prompt file, and its result envelope
 * (`--output-format json`, or the progress filter's copy of the stream's result event) is the job's reply and usage.
 * Its settings are the config's `claude` block. The interface every agent answers is documented in `index.mjs`.
 */
import { fileURLToPath } from 'node:url';
import { JOB_IN, JOB_OUT } from '../config.mjs';
import { q } from '../text.mjs';
import { weightedTokens } from '../usage.mjs';

const RESULT = 'claude.json';
/** The progress filter, copied into each frozen tree's `.skulkr/in` so a node runs the one this run ships. */
const PROGRESS_IN = `${JOB_IN}/progress.mjs`;

const model = (name) => (name ? ['--model', name] : []);
const effort = (level) => (level ? ['--effort', level] : []);

/** The flags that set what each role may do. */
const roleFlags = (c, role) => {
  if (role === 'review') return ['--allowedTools', q(c.reviewTools.join(',')), '--disallowedTools', q(c.reviewDenied.join(',')), ...model(c.models.review), ...effort(c.effort?.review)];
  if (role === 'match') return ['--disallowedTools', q('Bash,Edit,Write,Task,Agent'), ...model(c.models.match), ...effort(c.effort?.match)];
  return ['--dangerously-skip-permissions', ...model(c.models.fix), ...effort(c.effort?.fix)];
};

/**
 * Runs `claude -p` on `promptFile` as `role`, stopped by an alarm before the runner's timeout so what it wrote still
 * comes home. With `progress` (the progress filter's arguments before the result path), it streams through the
 * filter, which prints onto progress lines and writes the same result envelope.
 */
const line = (cfg, role, { promptFile, budgetUsd, progress }) => {
  const c = cfg.claude;
  return [
    ...(c.configDir ? [`CLAUDE_CONFIG_DIR=${c.configDir}`] : []),
    ...(c.cacheTtl?.[role] ? [`CLAUDE_CODE_PROMPT_CACHE_TTL=${c.cacheTtl[role]}`] : []),
    // A reviewer's write rule is relative to the working directory, which a `cd` would otherwise move.
    ...(role === 'review' ? ['CLAUDE_BASH_MAINTAIN_PROJECT_WORKING_DIR=1'] : []),
    `perl -e 'alarm shift; exec @ARGV' ${c.timeoutMin * 60}`,
    'claude -p "$(cat', `${q(promptFile)})"`,
    `--output-format ${progress ? 'stream-json --verbose' : 'json'} --strict-mcp-config`,
    ...(c.settingSources ? [`--setting-sources ${c.settingSources}`] : []),
    `--max-budget-usd ${budgetUsd}`, ...roleFlags(c, role),
    progress
      ? `2> ${JOB_OUT}/claude.err | node ${PROGRESS_IN} ${progress} ${JOB_OUT}/${RESULT}; echo "\${PIPESTATUS[0]}" > ${JOB_OUT}/exit`
      : `> ${JOB_OUT}/${RESULT} 2> ${JOB_OUT}/claude.err; echo $? > ${JOB_OUT}/exit`,
  ].join(' ');
};

/** The envelope's fields as `{ reply, record, error }`; `record` lacks the job's own area, role and node. The envelope
 *  carries its own cost, so the job's config and role go unused. */
const resultOf = (raw) => {
  let env = {};
  try {
    env = raw ? JSON.parse(raw) : {};
  } catch {
    env = { result: raw };
  }
  const u = env.usage ?? {};
  const cacheCreation = u.cache_creation_input_tokens ?? 0;
  const cacheWrite1h = u.cache_creation?.ephemeral_1h_input_tokens ?? 0;
  const tokens = {
    input: u.input_tokens ?? 0,
    output: u.output_tokens ?? 0,
    cacheWrite5m: cacheCreation - cacheWrite1h,
    cacheWrite1h,
    cacheRead: u.cache_read_input_tokens ?? 0,
  };
  const reason = env.terminal_reason ?? env.subtype ?? (raw ? 'unknown' : 'no envelope');
  return {
    reply: String(env.report ?? env.result ?? ''),
    // A usage-limit refusal is an error reply: the job came home but did no work.
    error: env.is_error === true,
    record: {
      models: Object.keys(env.modelUsage ?? {}),
      tokens,
      weightedTokens: weightedTokens(tokens),
      costUsd: env.total_cost_usd ?? Object.values(env.modelUsage ?? {}).reduce((s, m) => s + (m.costUSD ?? 0), 0),
      durationMs: env.duration_ms ?? 0,
      turns: env.num_turns ?? 0,
      terminalReason: reason,
      subtype: env.subtype,
      budgetHit: /budget/i.test(`${env.subtype ?? ''} ${env.terminal_reason ?? ''}`),
    },
  };
};

export const claude = {
  name: 'claude',
  resultFile: RESULT,
  progress: { source: () => fileURLToPath(new URL('../progress.mjs', import.meta.url)), at: PROGRESS_IN },
  line,
  resultOf,
  timeoutMin: (cfg) => cfg.claude.timeoutMin,
  reviewExpect: (cfg) => cfg.claude.reviewExpect,
};
