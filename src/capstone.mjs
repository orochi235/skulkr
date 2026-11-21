/**
 * A red capstone's one repair cycle: each failing file of the gate's log is laid at the area branches that changed it
 * or code it imports (`attribute.mjs`), each such branch gets a repair job given its failures, and the branches whose
 * repair passes its verify step are patched again for the batch to be rebuilt; the rest are left out of it.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { attribute, changedBy, reachOf, workspacesIn } from './attribute.mjs';
import { applyFix, gitIn } from './batch.mjs';
import { failedWhereIn } from './gate.mjs';
import { checkedIn, repairJob, summaryOf } from './repair.mjs';
import { isTestPath, verdictText } from './verify.mjs';
import { stripAnsi } from './ansi.mjs';

/** How many lines of the log a failing file's excerpt keeps after each line naming it; a failed step, whose output
 *  is all there is to go on, keeps more. */
const AFTER = 25;
const STEP_AFTER = 150;

/** The gate log's lines about `files`, verbatim: each line naming one, and the lines after it up to the next. */
export const excerptFor = (text, files, after = files.some((f) => !isTestPath(f)) ? STEP_AFTER : AFTER) => {
  const lines = stripAnsi(text).split('\n');
  const keep = new Set();
  lines.forEach((line, i) => {
    if (!files.some((f) => line.includes(f))) return;
    for (let j = i; j < Math.min(lines.length, i + 1 + after); j++) {
      if (j > i && /\bFAIL\b|^fleet-fail:/.test(lines[j]) && !files.some((f) => lines[j].includes(f))) break;
      keep.add(j);
    }
  });
  return [...keep].sort((a, b) => a - b).map((i) => lines[i]).join('\n');
};

/**
 * A repair of one area's branch for a red capstone, through `ctx`'s jobs: given the failing files and the log's
 * lines about them, it checks those files beside the area's own, and on a pass patches the branch again. `mboxOf`
 * answers the commits of a branch that is not an area's, the sweep's. Answers `{ ok, commits?, verify }`.
 */
export const capstoneRepairer = (ctx, { root, results, mboxOf = () => undefined }) => async (id, files, log) => {
  const { cfg, nightDir, round, commit } = ctx;
  const own = join(nightDir, 'areas', id, 'fix.mbox');
  const mbox = existsSync(own) ? own : mboxOf(id);
  if (!mbox) return { ok: false };
  const area = { id };
  const run = await repairJob(ctx, area, { mbox, log, label: 'capstone', attempt: 'capstone', extra: files });
  const verdict = await checkedIn(ctx, area, run.to, run.mbox, 'repair-capstone', files);
  ctx.say(`repair ${id} capstone on ${run.node}: ${run.added} commits, ${run.minutes.toFixed(1)} min; verify ${verdict.ok ? 'passed' : verdictText(verdict)}`);
  const verify = { ...summaryOf(verdict), capstone: true };
  const summary = results.find((r) => r.id === id);
  if (summary) summary.verify = { ...summary.verify, ...verify, repairs: (summary.verify?.repairs ?? 0) + 1 };
  if (!verdict.ok) return { ok: false, verify };
  mkdirSync(join(nightDir, 'areas', id), { recursive: true });
  if (run.mbox !== own) copyFileSync(run.mbox, own);
  const applied = applyFix(cfg, root, { round, area: id, commit, mbox: own });
  if (applied.error) {
    ctx.say(`patch ${id}: the capstone repair did not apply: ${applied.error}`);
    return { ok: false, verify };
  }
  if (summary) Object.assign(summary, { fixCommits: applied.commits, patches: applied.commits.length });
  ctx.say(`patch ${id}: ${applied.commits.length} commits on ${applied.branch}`);
  return { ok: true, commits: applied.commits, verify };
};

/**
 * One repair cycle for a red capstone whose log is at `logPath`, on the batch `batch` built from the frozen commit
 * `commit`. `repair(id, files, log)` repairs one of this round's area branches. Answers what was tried: `repaired`
 * and `dropped` branches, `unrepairable`, earlier rounds' branches failures were laid at, `byBranch`, the failing
 * files laid at each, and `unattributed`, the failures no branch reaches.
 */
export const repairCapstone = async ({ cfg, root, round, commit, batch, logPath, repair, say }) => {
  const text = readFileSync(logPath, 'utf8');
  const where = failedWhereIn(text, cfg.gate);
  const failing = where.filter(isTestPath);
  const steps = where.filter((w) => !isTestPath(w));
  const changed = changedBy(gitIn(root), commit, batch.merged);
  const workspaces = workspacesIn(batch.tree, (dir) => {
    try {
      return readdirSync(join(batch.tree, dir));
    } catch {
      return [];
    }
  });
  const { byBranch, unattributed } = attribute(failing, changed, (file) => reachOf(batch.tree, file, workspaces));
  // A failed step names no file of its own; the config's `gate.blame` reads which paths its output points at.
  const unblamed = [];
  for (const step of steps) {
    const paths = cfg.gate.blame?.(text, step) ?? [];
    const owners = [...changed].filter(([, files]) => [...files].some((f) => paths.some((p) => f === p || f.startsWith(p.endsWith('/') ? p : `${p}/`)))).map(([b]) => b);
    if (!owners.length) unblamed.push(step);
    for (const b of owners) byBranch.set(b, [...(byBranch.get(b) ?? []), step]);
  }
  const idOf = cfg.names.idOf;
  const laid = [...byBranch].map(([b, files]) => `${idOf(b)} ${files.length}`).join(', ');
  say(`capstone: ${where.length} failures; ${laid || 'none laid at a branch'}${unattributed.length + unblamed.length ? `; ${unattributed.length + unblamed.length} unattributed` : ''}`);
  // A branch an earlier round left out has its commits in that round's night, not this one's: none to repair here.
  const earlier = (branch) => cfg.names.branchOf(branch)?.round !== round;
  const tried = await Promise.all([...byBranch].map(async ([branch, files]) => {
    if (earlier(branch)) {
      say(`repair ${branch} capstone: left out, not repairable this round`);
      return { branch, ok: false, earlier: true };
    }
    try {
      return { branch, ...(await repair(idOf(branch), files, excerptFor(text, files))) };
    } catch (error) {
      say(`repair ${idOf(branch)} capstone failed: ${error.stack ?? error}`);
      return { branch, ok: false };
    }
  }));
  return {
    repaired: tried.filter((t) => t.ok).map((t) => t.branch),
    dropped: tried.filter((t) => !t.ok && !t.earlier).map((t) => t.branch),
    unrepairable: tried.filter((t) => t.earlier).map((t) => t.branch),
    byBranch: Object.fromEntries([...byBranch].map(([b, files]) => [earlier(b) ? b : idOf(b), files])),
    unattributed: [...unattributed, ...unblamed],
  };
};

/** What a capstone repair cycle did, for the round's report. */
export const capstoneText = (cycle, idOf, again) => {
  const ids = (bs) => bs.map(idOf).join(', ');
  return [
    'capstone repair:',
    cycle.repaired.length ? ` repaired ${ids(cycle.repaired)};` : '',
    cycle.dropped.length ? ` left out ${ids(cycle.dropped)}, whose repair still failed;` : '',
    cycle.unrepairable?.length ? ` left out ${cycle.unrepairable.join(', ')}, not repairable this round;` : '',
    cycle.unattributed.length ? ` unattributed: ${cycle.unattributed.slice(0, 5).join(', ')}${cycle.unattributed.length > 5 ? ', …' : ''};` : '',
    again === undefined ? ' nothing to retest' : ` the capstone ran again ${again ? 'green' : 'red'}`,
  ].join('');
};
