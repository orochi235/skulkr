/**
 * Saturation's model jobs: one blind review of an area by one source, exactly as a round's reviewer runs, and the
 * ledger matcher. Both launch through the configured runner by `dispatch`, from the frozen tree.
 */
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { JOB_OUT } from './config.mjs';
import { preloadedFiles, stageIn } from './area.mjs';
import { fill, brief, projectVars } from './brief.mjs';
import { dispatch } from './dispatch.mjs';
import { isFinished, parseFindings, reviewText } from './findings.mjs';
import { matchShell, reviewShell } from './jobs.mjs';
import { agentFor, requireAgents } from './agent/index.mjs';
import { ledgerDirOf, ledgerMatchPrompt, matchOf } from './ledger.mjs';
import { recentlyChanged, reviewFileList } from './reviewFiles.mjs';
import { createSlots } from './slots.mjs';
import { sleep } from './after.mjs';
import { readIf } from './text.mjs';

const POLL_MS = 15_000;
const UNAVAILABLE_TTL_MS = 5 * 60_000;

/** `cfg.agent` as one agent per role, with `over` laid on it. */
const agentsWith = (cfg, over) => {
  const a = cfg.agent ?? 'claude';
  const base = typeof a === 'string' ? { review: a, match: a, fix: a } : { review: 'claude', match: 'claude', fix: 'claude', ...a };
  return { ...base, ...over };
};

/** `cfg` with its reviews run by the agent named `source`. */
export const sourceConfigOf = (cfg, source) => ({ ...cfg, agent: agentsWith(cfg, { review: source }) });

/** `cfg` with its match jobs run as the ledger matcher: Claude, on `claude.models.ledgerMatch`. */
export const ledgerMatchConfigOf = (cfg) => ({
  ...cfg,
  agent: agentsWith(cfg, { match: 'claude' }),
  claude: { ...cfg.claude, models: { ...cfg.claude.models, match: cfg.claude.models.ledgerMatch } },
});

/** Throws, before anything is spent, when a source names no agent or one the config cannot run reviews on. */
export const requireSources = (cfg, sources) => {
  for (const s of sources) requireAgents(sourceConfigOf(cfg, s));
};

/** What every saturation job reads: the config, runner, frozen tree, and the slots it takes jobs in. */
export const createSaturateContext = ({ cfg, runner, frozen, base, commit, area, say }) => {
  const slots = createSlots(cfg, undefined, { about: { saturate: area }, places: Boolean(runner.places) });
  let unavailable = { at: 0, nodes: new Set() };
  return {
    cfg, runner, frozen, base, commit, say,
    budget: cfg.budget, earlierNights: [], nightDir: ledgerDirOf(cfg, area),
    stopped: () => false,
    usage: () => {},
    refuse: (node) => slots.refuse(node),
    acquire: async (role) => {
      for (;;) {
        if (Date.now() - unavailable.at > UNAVAILABLE_TTL_MS) unavailable = { at: Date.now(), nodes: runner.unavailableNodes() };
        const slot = slots.take(role, { exclude: unavailable.nodes });
        if (slot) return slot;
        await sleep(POLL_MS);
      }
    },
  };
};

/** The directory occasion `key`'s jobs write to. */
export const occasionJobsOf = (cfg, area, key) => join(ledgerDirOf(cfg, area), 'jobs', key);

const taskOf = (cfg, area, key, step) => `${cfg.name}-saturate-${area}-${key}-${step}`;

/**
 * One blind review of `area` (`{ id, files }`) by `source`, a round's reviewer job exactly: the config's reviewer brief,
 * its files preloaded where `review.preload` and the agent allow. Answers `{ text, findings, finished, costUsd, minutes }`.
 */
export const runReview = async (ctx, area, key, source) => {
  const cfg = sourceConfigOf(ctx.cfg, source);
  const inDir = stageIn({ ...ctx, cfg }, area);
  const vars = { ...projectVars(cfg, 'reviewer'), round: 'saturation', area: area.id, commit: ctx.commit, out: `${JOB_OUT}/findings.md`, files: reviewFileList(ctx.frozen, area.files, recentlyChanged(ctx.frozen, area.files)) };
  const agent = agentFor(cfg, 'review');
  const preloading = Boolean(cfg.review?.preload && agent.stdin);
  const prompt = `saturate-review-${source}.md`;
  writeFileSync(join(inDir, prompt), `${fill(brief(cfg, 'reviewer'), vars)}${preloading ? `\n\n${preloadedFiles(ctx.frozen, area.files)}` : ''}`);
  writeFileSync(join(inDir, 'files.txt'), `${area.files.join('\n')}\n`);
  const to = join(occasionJobsOf(cfg, area.id, key), 'review');
  const run = await dispatch({ ...ctx, cfg }, area, `review-${source}`, {
    kind: 'review', expect: agent.reviewExpect(cfg), shell: reviewShell(cfg, area.id, ctx.budget.review, prompt, preloading), to,
    task: taskOf(cfg, area.id, key, source), logPath: join(to, '..', 'review.log'),
    about: `Blind ${source} review ${key} of area ${area.id} for saturation: lists defects without fixing.`,
  });
  const text = reviewText(readIf(join(to, 'findings.md')), run.reply);
  return { text, findings: parseFindings(text), finished: run.launched && isFinished(text), costUsd: run.usage?.costUsd ?? 0, minutes: run.minutes ?? 0 };
};

/** One ledger matcher job, its reply unchecked. */
const runLedgerMatch = async (ctx, area, key, attempt, prompt) => {
  const cfg = ledgerMatchConfigOf(ctx.cfg);
  writeFileSync(join(stageIn({ ...ctx, cfg }, area), 'ledger-match.md'), prompt);
  const to = join(occasionJobsOf(cfg, area.id, key), `match${attempt}`);
  // A match answers the ledger as it stood, so an earlier attempt's reply is never reused.
  rmSync(to, { recursive: true, force: true });
  const run = await dispatch({ ...ctx, cfg }, area, 'match', {
    kind: 'review', expect: 'none', shell: matchShell(cfg, area.id, ctx.budget.match, 'ledger-match.md'), to,
    task: taskOf(cfg, area.id, key, `match${attempt}`), logPath: join(to, '..', `match${attempt}.log`),
    about: `Matches saturation occasion ${key} of area ${area.id} against its ledger of defects.`,
  });
  return { reply: run.reply ?? '', costUsd: run.usage?.costUsd ?? 0, minutes: run.minutes ?? 0 };
};

/**
 * The ledger matcher's checked answer for a report (`{ findings }` parsed, or `{ raw }` to enumerate), tried once
 * more on a reply that does not check out. Answers `{ match, costUsd, minutes }`; throws after the second bad reply.
 */
export const matchReport = async (ctx, area, key, ledger, report) => {
  const prompt = ledgerMatchPrompt(fill(readFileSync(ctx.cfg.briefPath('ledgerMatch'), 'utf8'), projectVars(ctx.cfg, 'matcher')), ledger, report);
  let costUsd = 0;
  let minutes = 0;
  const errors = [];
  for (let attempt = 1; attempt <= 2; attempt++) {
    const run = await runLedgerMatch(ctx, area, key, attempt, prompt);
    costUsd += run.costUsd;
    minutes += run.minutes;
    try {
      return { match: matchOf(run.reply, ledger, report.findings), costUsd, minutes };
    } catch (error) {
      errors.push(error.message);
      ctx.say(`ledger match ${key}: attempt ${attempt} unusable (${error.message})`);
    }
  }
  throw new Error(`the ledger matcher gave no usable answer for occasion ${key}: ${errors.join('; ')}`);
};
