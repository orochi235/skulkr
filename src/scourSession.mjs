/**
 * Session mode, `skulkr scour next <area> [--agent <id>]`: the Claude Code session running it does each pass with a
 * subagent of its own, and this command keeps the books between them. Each call takes in the last task's answer, folds
 * what it can, and hands back the next task (a review, or a ledger match) or says the area has stopped. README "Scour",
 * "Session mode"; the skill that drives it is `skills/skulkr-scour`.
 */
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { addWorktree, removeWorktree } from './batch.mjs';
import { brief, fill, projectVars } from './brief.mjs';
import { loggingSay } from './delveLive.mjs';
import { isFinished, parseFindings } from './findings.mjs';
import { readJson, writeJson } from './json.mjs';
import { heldAlive, leaseAt, takeLease } from './lease.mjs';
import {
  emptyLedger, freezeCommitOf, keepReview, ledgerDirOf, ledgerMatchPrompt, ledgerOf, matchOf, requireAreaFilesAt, requireSameCommit, writeLedger,
} from './ledger.mjs';
import { cacheTierOf, sessionTranscriptAt, transcriptAt, transcriptCostOf } from './agentCost.mjs';
import { recentlyChanged, reviewFileList } from './reviewFiles.mjs';
import { chao2, stopReason } from './saturation.mjs';
import { occasionJobsOf, sourceConfigOf } from './saturateJobs.mjs';
import { foldsUnmatched, foldWith, stageReport, tellOccasion, unfoldedTextOf, unmatched } from './scourFold.mjs';
import { ledgerLinesOf } from './scourLines.mjs';
import { nextPriceOf, scourRuleOf } from './scourPrice.mjs';
import { writeReport } from './saturationReport.mjs';
import { readIf } from './text.mjs';

const MATCH_ATTEMPTS = 2;
const SOURCE = 'claude';

const pad = (n) => String(n).padStart(2, '0');
const taskPathOf = (cfg, id) => join(ledgerDirOf(cfg, id), 'task.json');
const treeOf = (cfg, root, id) => join(root, '.worktrees', `${cfg.naming.prefix}-saturate-${id}`);

/**
 * Holds `id`'s ledger for the session whose Claude Code process is `pid`, across calls: the lease names that process,
 * so it lasts until the area stops or the session dies. Runs `work(first, release)`, `first` when this call took it.
 */
const withSessionHold = async (cfg, id, pid, about, work) => {
  const path = join(ledgerDirOf(cfg, id), 'lock');
  const held = leaseAt(path);
  if (held?.pid === pid && heldAlive(held)) return work(false, () => rmSync(path, { force: true }));
  if (!takeLease(path, { saturate: id, does: 'delve', ...about, pid })) throw new Error(`another skulkr scour is working on ${id}`);
  return work(true, () => rmSync(path, { force: true }));
};

/** What subagent `agent` cost and its final reply, from its transcript. */
const agentAnswerOf = (cfg, agent, env) => {
  const path = transcriptAt(agent, { session: env.CLAUDE_CODE_SESSION_ID, env });
  if (!path) throw new Error(`no transcript for subagent ${agent}; --agent wants the id the Agent tool gave back`);
  return transcriptCostOf(path, cfg.claude.prices);
};

/**
 * Why no subagent may be started now, or null: only a session whose newest cache write is on the hour's tier is on its
 * plan's usage (`cacheTierOf`), and anything that cannot be shown to be is taken as metered (README "Session mode").
 */
const meteredWhy = (env) => {
  const path = env.CLAUDE_CODE_SESSION_ID && sessionTranscriptAt(env.CLAUDE_CODE_SESSION_ID, env);
  if (!path) return "this session's transcript can't be found, so plan usage can't be told from metered; --metered starts passes anyway";
  const tier = cacheTierOf(path);
  if (tier === '1h') return null;
  return tier === '5m'
    ? "this session's cache writes dropped to five minutes, the sign of usage overage, which is metered; --metered starts passes anyway"
    : 'this session has made no cache write yet, so plan usage cannot be told from metered; --metered starts passes anyway';
};

/**
 * The prompt a subagent is handed: session mode's preface over `body`. Claude Code refuses a subagent's write of a
 * report file, so its answer is its final reply, read back from its transcript.
 */
const subagentPrompt = (cfg, tree, reply, instructions, body) =>
  `${fill(readIf(cfg.briefPath('scourSubagent')), { tree, reply, instructions })}${body}`;

/** Writes task `task`'s prompt and a log line for the live view, records the task, and tells the session what to run. */
const handOut = (cfg, id, task, prompt, model, say) => {
  const dir = occasionJobsOf(cfg, id, task.key);
  mkdirSync(dir, { recursive: true });
  writeFileSync(task.prompt, prompt);
  writeFileSync(join(dir, `${task.step}.log`), `${new Date().toISOString()} subagent ${task.step} handed out\n`);
  writeJson(taskPathOf(cfg, id), { ...task, model: model ?? null }, 1);
  say(`next ${id}: ${task.kind} ${task.key}${task.attempt ? ` (attempt ${task.attempt})` : ''}`);
  return { task: task.kind, key: task.key, model: model ?? null, prompt: task.prompt };
};

const reviewTask = (cfg, root, ledger, say) => {
  const id = ledger.area;
  const key = `${pad(ledger.occasions.length + 1)}-${SOURCE}`;
  const dir = occasionJobsOf(cfg, id, key);
  const tree = treeOf(cfg, root, id);
  const vars = {
    ...projectVars(cfg, 'reviewer'), round: 'saturation', area: id, commit: ledger.commit, out: 'your final reply',
    files: reviewFileList(tree, ledger.files, recentlyChanged(tree, ledger.files)),
  };
  const body = `${fill(brief(sourceConfigOf(cfg, SOURCE), 'reviewer'), vars)}\n\n${readIf(cfg.briefPath('scourTriage'))}`;
  const instructions = `- **The brief says the tree's \`CLAUDE.md\` is already in your context; it is not.** Read \`${tree}/CLAUDE.md\` once, first.`;
  const prompt = subagentPrompt(cfg, tree, 'the whole findings document, ending with its `<!-- done: … -->` line', instructions, body);
  return handOut(cfg, id, { kind: 'review', step: 'review', key, prompt: join(dir, 'prompt.md') }, prompt, cfg.claude.models.review, say);
};

const matchTask = (cfg, root, ledger, attempt, spent, say) => {
  const id = ledger.area;
  const entry = ledger.unfolded[0];
  const dir = occasionJobsOf(cfg, id, entry.key);
  const report = entry.kind === 'ingest' ? { raw: unfoldedTextOf(cfg, ledger) } : { findings: entry.findings };
  const body = ledgerMatchPrompt(fill(readIf(cfg.briefPath('ledgerMatch')), projectVars(cfg, 'matcher')), ledger, report);
  const instructions = '- **Read no files.**';
  const prompt = subagentPrompt(cfg, treeOf(cfg, root, id), 'the JSON the brief asks for', instructions, body);
  const task = { kind: 'match', step: `match${attempt}`, key: entry.key, attempt, spent, prompt: join(dir, `match${attempt}.md`) };
  return handOut(cfg, id, task, prompt, cfg.claude.models.ledgerMatch, say);
};

/** Tells the session the task it was handed and has not answered, again. */
const again = (task, say) => {
  say(`next: ${task.kind} ${task.key} is still out; run it again`);
  return { task: task.kind, key: task.key, model: task.model, prompt: task.prompt, again: true };
};

/** Takes in subagent `args.agent`'s answer to `task`. Answers the ledger, or a task to hand out again. */
const takeAnswer = (cfg, root, ledger, task, args, env, rule, say) => {
  if (!args.agent) return { handOut: again(task, say) };
  const { costUsd, minutes, reply: out } = agentAnswerOf(cfg, args.agent, env);
  const answered = task.kind === 'review' ? isFinished(out) : out.trim().length > 0;
  rmSync(taskPathOf(cfg, ledger.area), { force: true });
  if (task.kind === 'review') {
    if (!answered) {
      keepReview(cfg, ledger.area, `unfinished-${task.key}-${Date.now()}`, SOURCE, out);
      rmSync(occasionJobsOf(cfg, ledger.area, task.key), { recursive: true, force: true });
      say(`next ${ledger.area}: the review ${task.key} never finished ($${costUsd.toFixed(2)}); not counted`);
      return { ledger };
    }
    return { ledger: stageReport(cfg, ledger, { key: task.key, source: SOURCE, kind: 'review', text: out, findings: parseFindings(out), costUsd, minutes }) };
  }
  const spent = { costUsd: task.spent.costUsd + costUsd, minutes: task.spent.minutes + minutes };
  try {
    const entry = ledger.unfolded[0];
    const match = matchOf(out, ledger, entry.kind === 'ingest' ? undefined : entry.findings);
    const next = foldWith(cfg, ledger, { match, ...spent });
    tellOccasion(cfg, say, next, rule);
    return { ledger: next };
  } catch (error) {
    say(`ledger match ${task.key}: attempt ${task.attempt} unusable (${error.message})`);
    if (task.attempt >= MATCH_ATTEMPTS) {
      throw new Error(`the ledger matcher gave no usable answer for ${task.key}; it waits unfolded, for \`skulkr scour fold ${ledger.area}\``);
    }
    return { handOut: matchTask(cfg, root, ledger, task.attempt + 1, spent, say) };
  }
};

/**
 * `skulkr scour next <area> [--agent <id>] [--at <sha>] [--max N] [--per-defect $]`: answers the task to hand a
 * subagent (`{ task, key, model, prompt, out }`), or `{ stop }` once the area's stop rule holds. `env` is the
 * environment Claude Code gives the commands it runs.
 */
export const scourNext = async (cfg, root, id, args, tell, env = process.env) => {
  const pid = Number(env.CLAUDE_PID);
  if (!(pid > 0)) {
    throw new Error('scour next hands its passes to the Claude Code session that runs it, and none is running this; use the skulkr-scour skill from a session, or delve with --fleet');
  }
  return withSessionHold(cfg, id, pid, { max: args.max, session: env.CLAUDE_CODE_SESSION_ID ?? null }, async (first, release) => {
    const say = loggingSay(cfg, id, tell, { keep: !first });
    const wanted = args.at === undefined ? undefined : freezeCommitOf(cfg, root, args.at);
    let ledger = ledgerOf(cfg, id);
    requireSameCommit(ledger, args.at, wanted);
    if (!ledger) {
      const commit = wanted ?? freezeCommitOf(cfg, root);
      ledger = emptyLedger(id, commit, requireAreaFilesAt(cfg, root, id, commit));
    }
    if (ledger.lines === undefined) ledger = { ...ledger, lines: ledgerLinesOf(cfg, root, ledger, id) };
    writeLedger(cfg, ledger);
    if (first) say(`saturate ${id} at ${ledger.commit.slice(0, 10)}: ${ledger.files.length} files, ${ledger.occasions.length} occasions so far, by this session's subagents`);
    if (!existsSync(treeOf(cfg, root, id))) addWorktree(root, `${cfg.naming.prefix}-saturate-${id}`, ledger.commit);
    const ruleNow = () => scourRuleOf(cfg, root, args);
    const paused = args.metered ? null : meteredWhy(env);
    // A task handed out while paused stays recorded, so the next call after the pause hands it out again.
    const give = (step) => {
      if (!paused) return step;
      say(`next ${id}: paused, ${paused}`);
      return { pause: paused };
    };
    const task = readJson(taskPathOf(cfg, id));
    if (task) {
      const taken = takeAnswer(cfg, root, ledger, task, args, env, ruleNow(), say);
      if (taken.handOut) return give(taken.handOut);
      ledger = taken.ledger;
    }
    for (;;) {
      if (ledger.unfolded?.length) {
        if (!foldsUnmatched(ledger)) return give(matchTask(cfg, root, ledger, 1, { costUsd: 0, minutes: 0 }, say));
        ledger = foldWith(cfg, ledger, unmatched(ledger));
        tellOccasion(cfg, say, ledger, ruleNow());
        continue;
      }
      const rule = ruleNow();
      const stop = stopReason(chao2(ledger.occasions, ledger.defects), rule, { price: nextPriceOf(ledger, rule.factor), lines: ledger.lines });
      if (!stop) return give(reviewTask(cfg, root, ledger, say));
      say(`saturate ${id}: stopped, ${stop}`);
      say(`saturate ${id}: report at ${writeReport(cfg, id, ledger, rule)}`);
      removeWorktree(root, treeOf(cfg, root, id));
      release();
      return { stop };
    }
  });
};

/** The lines `scour next` prints for the session: what to hand which subagent, or that the area stopped or paused. */
export const nextLines = (id, step) => {
  if (step.stop) return [`stop ${id}: ${step.stop}`];
  if (step.pause) return [`pause ${id}: ${step.pause}`];
  return [`task: ${step.task} ${step.key}`, `model: ${step.model ?? 'the session default'}`, `prompt: ${step.prompt}`];
};
