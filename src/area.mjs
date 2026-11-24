/**
 * One area through a night: two blind reviews, the matcher, the estimate, and the fixer. Every raw file
 * lands in the area's directory under the night's state; `night.mjs` copies it into the round's record.
 * An area whose reviewers ran always gets its matcher and fixer, whatever the night's budget says.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { JOB_IN, JOB_OUT } from './config.mjs';
import { citedPaths, firstJson, isFinished, matchPrompt, parseFilesRead, parseFindings, questionsIn, reviewText, validPairs } from './findings.mjs';
import { brief, fill, projectVars } from './brief.mjs';
import { toCarry, writeCarried } from './carryBrief.mjs';
import { dispatch } from './dispatch.mjs';
import { CHECKS_IN, fixShell, jobDir, matchShell, reviewShell, stoppedBeforeModel, timeoutOf } from './jobs.mjs';
import { agentFor, requireAgents } from './agent/index.mjs';
import { patchesIn, verifyAndRepair } from './repair.mjs';
import { recentlyChanged, reviewFileList } from './reviewFiles.mjs';
import { chapman } from './rounds.mjs';
import { readIf } from './text.mjs';
import { totals } from './usage.mjs';
import { verifyOf } from './verify.mjs';

const round1 = (n) => Number(n.toFixed(1));

/** How long a pair's second reviewer waits after its first in a trial, so it reads the first's cached prompt. */
const TRIAL_STAGGER_MS = 30_000;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Every one of `files` at the frozen tree `frozen`, each under its path, for a preload trial's prompt. */
const preloadedFiles = (frozen, files) => [
  "## The listed files' contents",
  '',
  'Every listed file follows as it stands at the frozen commit, so you need not open them to read them.',
  ...files.map((f) => `\n### \`${f}\`\n\n\`\`\`\n${readIf(join(frozen, f))}\n\`\`\``),
].join('\n');

/** A preload trial's two pairs for one area, each side's counts and usage, at `<nightDir>/trial/<area>.json`. */
const writeTrial = (ctx, area, arms) => {
  const side = (r) => ({ findings: r.findings.length, read: r.read, minutes: round1(r.minutes ?? 0), node: r.node, usage: r.usage });
  const arm = ([x, y, m]) => ({ A: side(x), B: side(y), m: m.pairs.length, match: m.usage });
  const dir = join(ctx.nightDir, 'trial');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${area.id}.json`), `${JSON.stringify({ round: ctx.round, area: area.id, files: area.files.length, base: arm(arms.base), preload: arm(arms.preload) }, null, 1)}\n`);
};
const cents = (n) => Number(n.toFixed(2));

const review = async (ctx, area, side, { prompt = 'review.md', stdin = false } = {}) => {
  const to = jobDir(ctx.nightDir, area.id, side);
  const run = await dispatch(ctx, area, `review-${side}`, {
    kind: 'review', expect: agentFor(ctx.cfg, 'review').reviewExpect(ctx.cfg), shell: reviewShell(ctx.cfg, area.id, ctx.budget.review, prompt, stdin), to,
    task: ctx.cfg.names.task(ctx.round, area.id, side), logPath: join(to, '..', `${side}.log`),
    about: `Blind reviewer ${side} for audit round ${ctx.round}, area ${area.id}: reads its files and lists defects without fixing.`,
  });
  const text = reviewText(readIf(join(to, 'findings.md')), run.reply);
  const findings = parseFindings(text);
  const read = parseFilesRead(text).filter((f) => area.files.includes(f)).length;
  if (!run.launched) ctx.say(`review ${area.id} ${side}: never launched; the area is recorded incomplete`);
  ctx.progress('review', `${area.id} ${side} on ${run.node}: ${findings.length} findings, ${read}/${area.files.length} files read, ${run.minutes.toFixed(1)} min, ${(run.usage.weightedTokens / 1e6).toFixed(2)}M weighted tokens${run.usage.budgetHit ? ', hit its ceiling' : ''}${run.launched && !isFinished(text) ? ', unfinished: not counted as a pass' : ''}`, ctx.total.review);
  return { text, findings, read, ...run };
};

const match = async (ctx, area, a, b, tag = '') => {
  if (!a.launched || !b.launched || a.findings.length === 0 || b.findings.length === 0) return { pairs: [], minutes: 0 };
  const step = `match${tag}`;
  writeFileSync(join(ctx.frozen, JOB_IN, area.id, `${step}.md`), matchPrompt(fill(brief(ctx.cfg, 'matcher'), projectVars(ctx.cfg, 'matcher')), a.findings, b.findings));
  const to = jobDir(ctx.nightDir, area.id, step);
  const run = await dispatch(ctx, area, step, {
    kind: 'review', expect: 'none', shell: matchShell(ctx.cfg, area.id, ctx.budget.match, `${step}.md`), to,
    task: ctx.cfg.names.task(ctx.round, area.id, step), logPath: join(to, '..', `${step}.log`),
    about: `Pairs the two blind reviewers' findings for audit round ${ctx.round}, area ${area.id}.`,
  });
  let pairs = [];
  try {
    pairs = validPairs(firstJson(run.reply).pairs, a.findings.length, b.findings.length);
  } catch (error) {
    ctx.say(`match ${area.id}: unreadable reply (${error.message}); counting no shared findings`);
  }
  ctx.progress('match', `${area.id}${tag}: ${pairs.length} shared of ${a.findings.length} + ${b.findings.length}`, ctx.total.match);
  return { pairs, ...run };
};

/** What the fixer is told its findings are: two blind reviews of an area, unless `source` says otherwise. */
export const reviewedSource = (ctx, id) => fill(
  'Two blind reviewers read this area at the frozen commit {{commit}} and reported without fixing. Their\n'
  + 'reports are `{{reportA}}` and `{{reportB}}`. Some findings appear in both under different words; treat\n'
  + 'those as one.',
  { commit: ctx.commit, reportA: `${JOB_IN}/${id}/A.md`, reportB: `${JOB_IN}/${id}/B.md` },
);

/** One fixer job on `area`'s findings, which are already in `.skulkr/in/<area>/` in the frozen tree. `onReport` hears
 *  the fixer's report as soon as its job comes home, before verify and any repair. */
export const fix = async (ctx, area, findings, source = reviewedSource(ctx, area.id), { onReport } = {}) => {
  const to = jobDir(ctx.nightDir, area.id, 'fix');
  const vars = { ...projectVars(ctx.cfg, 'fixer'), round: ctx.round, area: area.id, commit: ctx.commit, source };
  writeFileSync(join(ctx.frozen, JOB_IN, area.id, 'fix.md'), fill(brief(ctx.cfg, 'fixer'), vars));
  const run = await dispatch(ctx, area, 'fix', {
    kind: 'fix', expect: 'none', shell: fixShell(ctx.cfg, area.id, ctx.budget.fix, findings, ctx.localFix), to, timeoutMin: timeoutOf(ctx.cfg),
    env: { FROZEN_TREE: ctx.frozenTree, ...ctx.identity },
    task: ctx.cfg.names.task(ctx.round, area.id, 'fix'), logPath: join(to, '..', 'fix.log'),
    about: `Fixer for audit round ${ctx.round}, area ${area.id}: verifies, tests and fixes its findings.`,
  });
  const mbox = join(to, 'fix.mbox');
  const patches = patchesIn(mbox);
  const stopped = stoppedBeforeModel(to);
  if (stopped) ctx.say(`fix ${area.id}: ${stopped}`);
  ctx.progress('fix', `${area.id} on ${run.node}: ${patches} commits, ${run.minutes.toFixed(1)} min, ${(run.usage.weightedTokens / 1e6).toFixed(2)}M weighted tokens${run.usage.budgetHit ? ', hit its ceiling' : ''}`, ctx.total.fix);
  const fixed = { mbox: patches > 0 ? mbox : undefined, patches, report: run.reply, ...run };
  if (fixed.report) onReport?.(fixed.report);
  if (!fixed.mbox || !verifyOf(ctx.cfg)) return fixed;
  const checked = await verifyAndRepair(ctx, area, fixed, to);
  return {
    ...fixed, mbox: checked.mbox, patches: patchesIn(checked.mbox), verify: { ...checked.verify, repairs: checked.repairs.length },
    repairs: checked.repairs, repairUsage: checked.usage,
  };
};

/** Readies the frozen tree's `.skulkr/in` for `area`'s jobs: its directory, each role's agent's progress filter, and the tally checks. Answers the directory. */
export const stageIn = (ctx, area) => {
  const inDir = join(ctx.frozen, JOB_IN, area.id);
  mkdirSync(inDir, { recursive: true });
  for (const { progress } of new Set(requireAgents(ctx.cfg))) copyFileSync(progress.source(), join(ctx.frozen, progress.at));
  writeFileSync(join(ctx.frozen, CHECKS_IN), `${JSON.stringify(ctx.cfg.checks.tally ?? {})}\n`);
  return inDir;
};

/** Makes the night's record directory of `area`, with its file list. Answers it. */
export const makeRecordDir = (ctx, area) => {
  const dir = join(ctx.nightDir, 'areas', area.id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'files.txt'), `${area.files.join('\n')}\n`);
  return dir;
};

/** {@link fix}, its report copied into the area's record directory `dir` as it comes home, its commits once verified. */
export const fixInto = async (ctx, area, dir, findings, source) => {
  // The report is the fixer's alone, so it goes in as soon as it comes home: what the fixer says of each finding shows
  // while its commits are still being verified.
  const fixed = await fix(ctx, area, findings, source, { onReport: (report) => writeFileSync(join(dir, 'fix.md'), report) });
  if (fixed.mbox) copyFileSync(fixed.mbox, join(dir, 'fix.mbox'));
  return fixed;
};

/** The fixer's part of an area's summary, `fixed` its result if it ran and `records` every usage record of the area. */
export const fixedPart = (fixed, records, carried = 0) => ({
  patches: fixed?.patches ?? 0,
  ...(carried ? { carried } : {}),
  ...(fixed?.verify ? { verify: fixed.verify } : {}),
  questions: questionsIn(fixed?.report),
  budgetHit: records.filter((r) => r.budgetHit).map((r) => r.role),
});

/** An area's `jobs`: `minutes` of the jobs before the fixer, then the fixer's and its repairs', `nodes`, and what `records` spent. */
export const jobsPart = (minutes, nodes, fixed, records) => {
  const spent = totals(records);
  return {
    minutes: { ...minutes, fix: round1(fixed?.minutes ?? 0), ...(fixed?.repairs?.length ? { repair: round1(fixed.repairs.reduce((t, r) => t + r.minutes, 0)) } : {}) },
    nodes,
    weightedTokens: spent.weightedTokens,
    costUsd: cents(spent.costUsd),
  };
};

/**
 * The whole area. `previous` is its last pass, if any, `changedSince` the files of the area that changed after it,
 * and `carried` its open findings from earlier rounds. Answers the area's summary, which becomes its `area.json`.
 */
export const runArea = async (ctx, area, { previous, changedSince, carried = [] }) => {
  const inDir = stageIn(ctx, area);
  const vars = { ...projectVars(ctx.cfg, 'reviewer'), round: ctx.round, area: area.id, commit: ctx.commit, out: `${JOB_OUT}/findings.md`, files: reviewFileList(ctx.frozen, area.files, recentlyChanged(ctx.frozen, area.files)) };
  writeFileSync(join(inDir, 'review.md'), fill(brief(ctx.cfg, 'reviewer'), vars));
  writeFileSync(join(inDir, 'files.txt'), `${area.files.join('\n')}\n`);
  // A pair preloads its files where the config says and the agent can; a preload trial runs a second pair of the other
  // kind beside it, recorded only for comparison.
  const preloading = Boolean(ctx.cfg.review?.preload && agentFor(ctx.cfg, 'review').stdin);
  const trial = ctx.trial === 'preload';
  if (preloading || trial) writeFileSync(join(inDir, 'review-preload.md'), `${fill(brief(ctx.cfg, 'reviewer'), vars)}\n\n${preloadedFiles(ctx.frozen, area.files)}`);
  const later = (run) => (preloading || trial ? sleep(ctx.trialStaggerMs ?? TRIAL_STAGGER_MS).then(run) : run());
  const loaded = { prompt: 'review-preload.md', stdin: true };
  const [own, other] = preloading ? [loaded, {}] : [{}, loaded];
  // Each pair is matched as soon as its own two reviews are in; the fix waits only for the pair that feeds it.
  const pairOf = (x, y, tag) => Promise.all([x, y]).then(async ([rx, ry]) => [rx, ry, await match(ctx, area, rx, ry, tag)]);
  const base = pairOf(review(ctx, area, 'A', own), later(() => review(ctx, area, 'B', own)), '');
  const compare = trial ? pairOf(review(ctx, area, 'TA', other), later(() => review(ctx, area, 'TB', other)), '-T') : null;
  const [a, b, matched] = await base;
  const dir = makeRecordDir(ctx, area);
  for (const [name, text] of [['A.md', a.text], ['B.md', b.text]]) {
    writeFileSync(join(dir, name), text);
    writeFileSync(join(inDir, name), text);
  }
  // The trial pair is only compared, so its failure is said and the area goes on.
  const compared = compare?.then((pair) => writeTrial(ctx, area, preloading ? { base: pair, preload: [a, b, matched] } : { base: [a, b, matched], preload: pair }),
    (error) => ctx.say(`trial ${area.id}: ${error.message ?? error}`));
  const [summary] = await Promise.all([finishArea(ctx, area, { dir, previous, changedSince, carried, a, b, matched }), compared]);
  return summary;
};

/** The rest of an area once its pair has reviewed and matched: its record, the fix, and its summary. */
const finishArea = async (ctx, area, { dir, previous, changedSince, carried, a, b, matched }) => {
  const claims = (fs) => fs.map((f) => f.claim);
  writeFileSync(join(dir, 'match.json'), `${JSON.stringify({ pairs: matched.pairs, a: claims(a.findings), b: claims(b.findings) }, null, 1)}\n`);
  const [na, nb, m] = [a.findings.length, b.findings.length, matched.pairs.length];
  const distinct = na + nb - m;
  // A side that never ran, or stopped before its report's done line, looked at too little for an estimate.
  const incomplete = [a, b].flatMap((r, i) => (r.launched && isFinished(r.text) ? [] : [i === 0 ? 'A' : 'B']));
  const estimate = incomplete.length ? undefined : chapman(na, nb, m);
  const carry = toCarry(carried, [...a.findings, ...b.findings]);
  const carriedText = writeCarried(ctx, area.id, carry, dir);
  const fixed = distinct + carry.length > 0
    ? await fixInto(ctx, area, dir, distinct + carry.length, [reviewedSource(ctx, area.id), carriedText].filter(Boolean).join('\n\n'))
    : undefined;
  const changed = new Set(changedSince);
  const records = [a.usage, b.usage, matched.usage, fixed?.usage, ...(fixed?.repairUsage ?? [])].filter(Boolean);
  return {
    id: area.id, commit: ctx.commit, date: ctx.date, files: area.files,
    a: na, b: nb, m, distinct,
    ...(estimate === undefined ? { incomplete } : { chapman: round1(estimate), unfound: round1(estimate - distinct) }),
    read: { A: a.read, B: b.read },
    newCode: previous ? { since: previous.round, changedFiles: changed.size, findings: [...a.findings, ...b.findings].filter((f) => citedPaths(f, ctx.cfg.citedRe).some((p) => changed.has(p))).length } : undefined,
    previous: previous ? { round: previous.round, chapman: previous.chapman, unfound: previous.unfound } : undefined,
    ...fixedPart(fixed, records, carry.length),
    jobs: jobsPart({ A: round1(a.minutes), B: round1(b.minutes), match: round1(matched.minutes) }, { A: a.node, B: b.node, fix: fixed?.node }, fixed, records),
    fixCommits: [],
  };
};
