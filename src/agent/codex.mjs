/**
 * The Codex CLI agent, for reviewers only so far: each job runs `codex exec --json` on its prompt file in the
 * `workspace-write` sandbox (a job's tree is thrown away, and only `.skulkr/out` comes home), its events filtered to
 * `codex.jsonl`. Codex reports tokens but no dollars and takes no budget, so a job is priced from the `codex` block's
 * `prices` and bounded only by its timeout. The interface every agent answers is documented in `index.mjs`.
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JOB_IN, JOB_OUT } from '../config.mjs';
import { q } from '../text.mjs';
import { weightedTokens } from '../usage.mjs';

const RESULT = 'codex.jsonl';
const PROGRESS_IN = `${JOB_IN}/codexProgress.mjs`;
const ROLES = new Set(['review']);

/** Why the config cannot run `role` on Codex, or '' when it can. */
const problemFor = (cfg, role) => {
  if (!ROLES.has(role)) return `codex runs only review jobs so far, not ${role}`;
  const model = cfg.codex.models?.[role];
  if (!model) return `codex needs \`codex.models.${role}\`, the model its jobs are priced as`;
  if (!cfg.codex.prices?.[model]) return `codex needs \`codex.prices['${model}']\`, { input, cachedInput, output } in dollars per million tokens`;
  return '';
};

/** Runs `codex exec` on `promptFile` as `role`, stopped by an alarm before the runner's timeout, through the progress filter. */
const line = (cfg, role, { promptFile, progress }) => {
  const c = cfg.codex;
  const effort = c.effort?.[role];
  return [
    ...(c.home ? [`CODEX_HOME=${c.home}`] : []),
    `perl -e 'alarm shift; exec @ARGV' ${c.timeoutMin * 60}`,
    'codex exec --json --ephemeral --sandbox workspace-write --skip-git-repo-check',
    ...(c.ignoreUserConfig ? ['--ignore-user-config'] : []),
    '--model', q(c.models[role]), ...(effort ? ['-c', q(`model_reasoning_effort="${effort}"`)] : []),
    '"$(cat', `${q(promptFile)})"`, '< /dev/null',
    `2> ${JOB_OUT}/codex.err | node ${PROGRESS_IN} ${progress} ${JOB_OUT}/${RESULT}; echo "\${PIPESTATUS[0]}" > ${JOB_OUT}/exit`,
  ].join(' ');
};

/** `{ reply, record, error }` from the kept events: the last message, and the turn's usage priced from `cfg`. */
/** @param {string} raw @param {{ cfg?: any, role?: string }} [job] */
const resultOf = (raw, { cfg, role = 'review' } = {}) => {
  const events = String(raw ?? '').split('\n').flatMap((l) => {
    try {
      return [JSON.parse(l)];
    } catch {
      return [];
    }
  });
  const messages = events.filter((e) => e.type === 'item.completed' && e.item?.type === 'agent_message');
  const done = events.findLast((e) => e.type === 'turn.completed');
  const failed = events.find((e) => e.type === 'turn.failed' || e.type === 'error');
  const u = done?.usage ?? {};
  const cached = u.cached_input_tokens ?? 0;
  const tokens = {
    input: Math.max(0, (u.input_tokens ?? 0) - cached),
    output: u.output_tokens ?? 0,
    cacheWrite5m: u.cache_write_input_tokens ?? 0,
    cacheWrite1h: 0,
    cacheRead: cached,
  };
  const model = cfg?.codex.models?.[role.startsWith('review') ? 'review' : role];
  const price = model && cfg.codex.prices?.[model];
  const costUsd = price ? ((tokens.input + tokens.cacheWrite5m) * price.input + tokens.cacheRead * price.cachedInput + tokens.output * price.output) / 1e6 : 0;
  return {
    reply: String(messages.at(-1)?.item.text ?? ''),
    error: Boolean(failed),
    record: {
      models: model ? [model] : [],
      tokens,
      weightedTokens: weightedTokens(tokens),
      costUsd,
      durationMs: 0,
      turns: messages.length,
      terminalReason: failed ? 'failed' : done ? 'completed' : raw ? 'unknown' : 'no envelope',
      subtype: undefined,
      budgetHit: false,
    },
  };
};

export const codex = {
  name: 'codex',
  resultFile: RESULT,
  progress: { source: () => fileURLToPath(new URL('./codexProgress.mjs', import.meta.url)), at: PROGRESS_IN },
  problemFor,
  line,
  resultOf,
  /** The `codex` block's brief for `role` (`reviewer`, …), else the shipped one for Codex. */
  briefPath: (cfg, role) => (cfg.codex.briefs?.[role]
    ? resolve(cfg.file ? dirname(cfg.file) : process.cwd(), cfg.codex.briefs[role])
    : fileURLToPath(new URL(`../../briefs/codex/${role}.md`, import.meta.url))),
  timeoutMin: (cfg) => cfg.codex.timeoutMin,
  reviewExpect: (cfg) => cfg.codex.reviewExpect,
};
