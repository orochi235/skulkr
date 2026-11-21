/**
 * The agents a model job can run, one per role, named by the config's `agent` (`'claude'`, or `{ review, match, fix }`
 * by role). An agent answers:
 *
 * - `name`, and `resultFile`, what its job leaves under `.skulkr/out` for skulkr to read its reply and usage from;
 * - `line(cfg, role, { promptFile, budgetUsd, progress })`: the shell that runs it on `promptFile` as `role`
 *   (`review`, `match` or `fix`) within `budgetUsd`, writes `resultFile`, and writes its exit status to `exit`;
 *   `progress`, when given, is the progress filter's arguments, and the line streams through `progress.at`;
 * - `progress`: `{ source(), at }`, the filter's local path and where a job's tree holds it;
 * - `resultOf(raw, { cfg, role })`: `{ reply, record, error }` from `resultFile`'s text, `record` the job's usage
 *   record (tokens, `weightedTokens`, `costUsd`, `turns`, `terminalReason`, `budgetHit`, …) and `error` a reply that
 *   did no work;
 * - `timeoutMin(cfg)` and `reviewExpect(cfg)`: how long a job may run, and a reviewer's expected duration;
 * - optionally `problemFor(cfg, role)`, why the config cannot run `role` on it ('' when it can), and
 *   `briefPath(cfg, brief)`, its own brief for `reviewer`, `matcher`, `fixer` or `repair` in place of the config's.
 */
import { claude } from './claude.mjs';
import { codex } from './codex.mjs';

const AGENTS = { claude, codex };
export const ROLES = ['review', 'match', 'fix'];

/** The agent role a job's role runs as: both reviewers review, and a repair fixes. */
export const agentRoleOf = (role) => (role.startsWith('review') ? 'review' : role === 'repair' ? 'fix' : role);

/** The agent the config names for `role`; throws on a name no agent answers to. */
export const agentFor = (cfg, role) => {
  const r = agentRoleOf(role);
  const name = typeof cfg?.agent === 'string' ? cfg.agent : cfg?.agent?.[r] ?? 'claude';
  const agent = AGENTS[name];
  if (!agent) throw new Error(`no agent named ${name} for ${r} jobs (config \`agent\`); known: ${Object.keys(AGENTS).join(', ')}`);
  return agent;
};

/** Every role's agent, so a config naming an unknown one, or one it cannot run, fails before a run spends anything. */
export const requireAgents = (cfg) => ROLES.map((role) => {
  const agent = agentFor(cfg, role);
  const problem = agent.problemFor?.(cfg, role);
  if (problem) throw new Error(`${problem} (config \`agent\`)`);
  return agent;
});

const BRIEF_ROLE = { reviewer: 'review', matcher: 'match', fixer: 'fix', repair: 'fix' };

/** The brief template's path for `brief` (`reviewer`, `matcher`, `fixer`, `repair`): its agent's own, else the config's. */
export const briefPathFor = (cfg, brief) => agentFor(cfg, BRIEF_ROLE[brief]).briefPath?.(cfg, brief) ?? cfg.briefPath(brief);
