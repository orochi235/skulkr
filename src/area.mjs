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
import { CHECKS_IN, PROGRESS_IN, fixShell, jobDir, matchShell, progressSource, reviewShell, stoppedBeforeModel, timeoutOf } from './jobs.mjs';
import { verifyAndRepair } from './repair.mjs';
import { chapman } from './rounds.mjs';
import { readIf } from './text.mjs';
import { totals } from './usage.mjs';
import { verifyOf } from './verify.mjs';

const round1 = (n) => Number(n.toFixed(1));
const cents = (n) => Number(n.toFixed(2));
const patchesIn = (mbox) => (existsSync(mbox) ? (readFileSync(mbox, 'utf8').match(/^From [0-9a-f]{40} /gm) ?? []).length : 0);

const review = async (ctx, area, side) => {
  const to = jobDir(ctx.nightDir, area.id, side);
  const run = await dispatch(ctx, area, `review-${side}`, {
    kind: 'review', expect: ctx.cfg.claude.reviewExpect, shell: reviewShell(ctx.cfg, area.id, ctx.budget.review), to,
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

const match = async (ctx, area, a, b) => {
  if (!a.launched || !b.launched || a.findings.length === 0 || b.findings.length === 0) return { pairs: [], minutes: 0 };
  writeFileSync(join(ctx.frozen, JOB_IN, area.id, 'match.md'), matchPrompt(fill(brief(ctx.cfg, 'matcher'), projectVars(ctx.cfg, 'matcher')), a.findings, b.findings));
  const to = jobDir(ctx.nightDir, area.id, 'match');
  const run = await dispatch(ctx, area, 'match', {
    kind: 'review', expect: 'none', shell: matchShell(ctx.cfg, area.id, ctx.budget.match), to,
    task: ctx.cfg.names.task(ctx.round, area.id, 'match'), logPath: join(to, '..', 'match.log'),
    about: `Pairs the two blind reviewers' findings for audit round ${ctx.round}, area ${area.id}.`,
  });
  let pairs = [];
  try {
    pairs = validPairs(firstJson(run.reply).pairs, a.findings.length, b.findings.length);
  } catch (error) {
    ctx.say(`match ${area.id}: unreadable reply (${error.message}); counting no shared findings`);
  }
  ctx.progress('match', `${area.id}: ${pairs.length} shared of ${a.findings.length} + ${b.findings.length}`, ctx.total.match);
  return { pairs, ...run };
};

/** What the fixer is told its findings are: two blind reviews of an area, unless `source` says otherwise. */
export const reviewedSource = (ctx, id) => fill(
  'Two blind reviewers read this area at the frozen commit {{commit}} and reported without fixing. Their\n'
  + 'reports are `{{reportA}}` and `{{reportB}}`. Some findings appear in both under different words; treat\n'
  + 'those as one.',
  { commit: ctx.commit, reportA: `${JOB_IN}/${id}/A.md`, reportB: `${JOB_IN}/${id}/B.md` },
);

/** One fixer job on `area`'s findings, which are already in `.skulkr/in/<area>/` in the frozen tree. */
export const fix = async (ctx, area, findings, source = reviewedSource(ctx, area.id)) => {
  const to = jobDir(ctx.nightDir, area.id, 'fix');
  const vars = { ...projectVars(ctx.cfg, 'fixer'), round: ctx.round, area: area.id, commit: ctx.commit, source };
  writeFileSync(join(ctx.frozen, JOB_IN, area.id, 'fix.md'), fill(brief(ctx.cfg, 'fixer'), vars));
  const run = await dispatch(ctx, area, 'fix', {
    kind: 'fix', expect: 'none', shell: fixShell(ctx.cfg, area.id, ctx.budget.fix, findings), to, timeoutMin: timeoutOf(ctx.cfg),
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
  if (!fixed.mbox || !verifyOf(ctx.cfg)) return fixed;
  const checked = await verifyAndRepair(ctx, area, fixed, to);
  return {
    ...fixed, mbox: checked.mbox, patches: patchesIn(checked.mbox), verify: { ...checked.verify, repairs: checked.repairs.length },
    repairs: checked.repairs, repairUsage: checked.usage,
  };
};

/** Readies the frozen tree's `.skulkr/in` for `area`'s jobs: its directory, the progress filter, and the tally checks. Answers the directory. */
export const stageIn = (ctx, area) => {
  const inDir = join(ctx.frozen, JOB_IN, area.id);
  mkdirSync(inDir, { recursive: true });
  copyFileSync(progressSource(), join(ctx.frozen, PROGRESS_IN));
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

/** {@link fix}, its report and commits then copied into the area's record directory `dir`. */
export const fixInto = async (ctx, area, dir, findings, source) => {
  const fixed = await fix(ctx, area, findings, source);
  if (fixed.report) writeFileSync(join(dir, 'fix.md'), fixed.report);
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
  const vars = { ...projectVars(ctx.cfg, 'reviewer'), round: ctx.round, area: area.id, commit: ctx.commit, out: `${JOB_OUT}/findings.md`, files: area.files.map((f) => `- ${f}`).join('\n') };
  writeFileSync(join(inDir, 'review.md'), fill(brief(ctx.cfg, 'reviewer'), vars));
  writeFileSync(join(inDir, 'files.txt'), `${area.files.join('\n')}\n`);
  const [a, b] = await Promise.all([review(ctx, area, 'A'), review(ctx, area, 'B')]);
  const dir = makeRecordDir(ctx, area);
  for (const [name, text] of [['A.md', a.text], ['B.md', b.text]]) {
    writeFileSync(join(dir, name), text);
    writeFileSync(join(inDir, name), text);
  }
  const matched = await match(ctx, area, a, b);
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
