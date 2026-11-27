/**
 * `skulkr scour fix <area>`: a fix run over one ledger's defects (docs/scour.md "Building the fix stage"). Triage
 * batches them (`scourTriage.mjs`); each batch goes to a round's fixer job, verified and repaired as a round's is, and
 * its commits land on a branch of their own, `scour<N>-<area>-b<k>`. Batches stack (`scourFixBase.mjs`): each is fixed
 * on the tip of the last one that applied and verified, so the area's newest branch holds all its fixes. The run then
 * lands that branch on `main` (`scourLand.mjs`), or with `--ready` leaves it for the repository's own batching.
 * Closing the registry's lines from the fixers' verdicts is not built yet.
 */
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fixInto, stageIn } from './area.mjs';
import { addWorktree, gitIn, removeWorktree } from './batch.mjs';
import { JOB_IN } from './config.mjs';
import { freezeCommitOf, ledgerOf, withLedgerHeld } from './ledger.mjs';
import { loggingSay } from './delveLive.mjs';
import { localFixOf } from './args.mjs';
import { createSaturateContext } from './saturateJobs.mjs';
import { scourStateDirOf } from './scourPaths.mjs';
import { stackBranchFor } from './scourFixBase.mjs';
import { createRepairLayer } from './scourFixLay.mjs';
import { fixRunsIn } from './scourFixStatus.mjs';
import { landFixBranch } from './scourLand.mjs';
import { fixPlanFor, fixPlanLines, filesOf } from './scourTriage.mjs';

const VERDICTS = ['not a defect', 'not fixed', 'duplicate', 'question', 'fixed'];

/** Claims the next fix run: one past the highest `fix-<N>` in the scour state directory, its directory made here.
 *  Answers its number and directory. Two runs started at once each take their own (fix runs may share a queue's lanes). */
export const claimFixRunIn = (cfg) => {
  const dir = scourStateDirOf(cfg);
  mkdirSync(dir, { recursive: true });
  for (;;) {
    const taken = readdirSync(dir).map((n) => Number(/^fix-(\d+)$/.exec(n)?.[1] ?? 0));
    const n = Math.max(0, ...taken) + 1;
    try {
      mkdirSync(join(dir, `fix-${n}`));
      return { n, runDir: join(dir, `fix-${n}`) };
    } catch (e) {
      if (/** @type {any} */ (e).code !== 'EEXIST') throw e;
    }
  }
};

/** The defects a batch's fixer is handed, as a findings file, each headed by its ledger id. */
export const scourFindingsMarkdown = (defects) => defects.map((d) => [
  `## [${d.id}] ${d.claim}`,
  `- where: ${d.where}`,
  ...(d.severity ? [`- severity: ${d.severity}`] : []),
  ...(d.scenario ? [`- scenario: ${d.scenario}`] : []),
  ...(d.cause ? [`- cause: ${d.cause}`] : []),
  ...(d.fix?.length ? [`- a fix would touch: ${d.fix.join(', ')}`] : []),
  ...(d.size ? [`- size: ${d.size}`] : []),
  ...(d.confidence ? [`- confidence: ${d.confidence}`] : []),
  `- seen in ${d.sightings.length} review${d.sightings.length === 1 ? '' : 's'}${d.recurrent ? ' (recurrent: most reviews find it)' : ''}`,
  '',
].join('\n')).join('\n');

/** What the fixer's brief says its findings are. */
const scourSource = (id, commit, at, ledgerCommit, n) => [
  `No round's reviewers ran here. These ${n} defects come from this area's saturation ledger: many blind`,
  `reviews of it at ${ledgerCommit.slice(0, 10)}, folded into distinct defects. They are in \`${JOB_IN}/${id}/scour.md\`,`,
  `each headed by its id in brackets. You are at ${commit.slice(0, 10)}, ${at}, and the code may have`,
  'changed since the ledger: check each still applies first (`not a defect (no longer applies)` when it is gone).',
  'Lead each verdict line with its id in brackets, `[D7]`, and give `scour` as where it came from. They count in N.',
  'After any verdict but `fixed`, say why in a sentence or two on the same line: it is kept as the reason.',
  'End each commit message with a trailer naming the defects it fixes, `Defect: D7`, or `Defect: D3, D7` for one',
  'commit covering several; a commit fixing none, such as a lint fix, takes no trailer.',
].join('\n');

/** Each defect's verdict from a fixer's report: the line led by its `[D<n>]`, its first verdict word, and the rest. */
export const scourVerdictsOf = (report, ids) => {
  const out = new Map();
  for (const line of String(report ?? '').split('\n')) {
    const m = /\[(D\d+)\]/.exec(line);
    if (!m || !ids.includes(m[1]) || out.has(m[1])) continue;
    const lower = line.toLowerCase();
    const verdict = VERDICTS.map((v) => [v, lower.indexOf(v)]).filter(([, i]) => i >= 0).sort((a, b) => a[1] - b[1])[0]?.[0] ?? null;
    out.set(m[1], { verdict, line: line.trim(), sha: /\bfixed\s+([0-9a-f]{7,40})\b/i.exec(line)?.[1] ?? null });
  }
  return ids.map((id) => ({ id, ...(out.get(id) ?? { verdict: null, line: null, sha: null }) }));
};

/**
 * One batch of exactly the defects `ids` names, taken from `plan`'s batches with their files, numbered as the first
 * one's batch: to send again the defects a batch left unfixed. Throws for an id no batch holds.
 */
export const defectsBatchOf = (plan, ids) => {
  const all = plan.batches.flatMap((b) => b.defects.map((d) => ({ d, n: b.n })));
  const picked = ids.map((id) => all.find((x) => x.d.id === id) ?? (() => { throw new Error(`no batch holds ${id}`); })());
  return { n: picked[0].n, defects: picked.map((x) => x.d), files: [...new Set(picked.flatMap((x) => x.d.files ?? []))] };
};

/** `branch` made at `commit` in `root` with `mbox` applied by `git am`; answers whether it applied. */
const branchWith = (root, branch, commit, mbox) => {
  const tree = addWorktree(root, `${branch}-am`, commit, branch);
  try {
    gitIn(tree)('am', '--3way', mbox);
    return true;
  } catch {
    try { gitIn(tree)('am', '--abort'); } catch { /* nothing to abort */ }
    return false;
  } finally {
    removeWorktree(root, tree);
  }
};

/**
 * `skulkr scour fix <area> [--dry] [--batch k,…] [--defects D1,…] [--on <ref>]`: the plan with `--dry`, else every batch
 * (those listed, or one of exactly the defects named) through a fixer, one at a time, from `--on`'s tip, else the
 * area's newest fix branch (`stackBranchFor`), else `main`'s.
 * Answers the run's record.
 */
export const scourFix = async (cfg, runner, root, id, args, say) => {
  const ledger = ledgerOf(cfg, id);
  if (!ledger) throw new Error(`${id} has no scour ledger`);
  const plan = fixPlanFor(ledger, { recurrent: cfg.saturate.recurrent });
  if (args.dry) {
    for (const line of fixPlanLines(id, plan)) say(line);
    return { plan };
  }
  if (args.batch !== undefined && args.defects !== undefined) throw new Error('give --batch or --defects, not both');
  const wanted = args.batch === undefined ? null : new Set(String(args.batch).split(',').map(Number));
  const batches = args.defects !== undefined ? [defectsBatchOf(plan, String(args.defects).split(',').map((x) => x.trim()).filter(Boolean))]
    : wanted ? plan.batches.filter((b) => wanted.has(b.n)) : plan.batches;
  if (batches.length === 0) throw new Error(`${id} has no batch ${args.batch}`);
  const { n, runDir } = claimFixRunIn(cfg);
  // Held as a delve holds it, so the Scour page shows the run live and no delve starts on the ledger meanwhile.
  return withLedgerHeld(cfg, id, { about: { does: 'fix', max: batches.length, jobs: `fix-${n}` } }, () => fixBatches(cfg, runner, root, id, ledger, batches, n, runDir, args, loggingSay(cfg, id, say)));
};

/** Moves the run's frozen tree to `tip`, and its jobs with it: what they sync from, check against, and are told. */
const moveTo = (ctx, tip, base) => {
  gitIn(ctx.frozen)('checkout', '--quiet', '--detach', tip);
  Object.assign(ctx, { commit: tip, base, frozenTree: gitIn(ctx.frozen)('rev-parse', 'HEAD^{tree}') });
};

/** Fix run `n`'s `batches` of ledger `id`, one at a time, recorded in `runDir`. Answers the run's record. */
const fixBatches = async (cfg, runner, root, id, ledger, batches, n, runDir, args, say) => {
  const stacked = args.on === undefined ? stackBranchFor(cfg, root, id) : null;
  const on = args.on ?? stacked ?? cfg.git.main;
  const commit = freezeCommitOf(cfg, root, on);
  const git = gitIn(root);
  const frozen = addWorktree(root, `${cfg.naming.prefix}-scour-fix${n}`, commit);
  const record = { run: n, area: id, commit, on, ledgerCommit: ledger.commit, started: new Date().toISOString(), batches: [] };
  const keep = () => writeFileSync(join(runDir, 'record.json'), `${JSON.stringify(record, null, 1)}\n`);
  const baseOf = (tip) => {
    try { return git('merge-base', tip, `${cfg.git.remote}/${cfg.git.main}`); } catch { return tip; /* no remote */ }
  };
  const tipOf = (ref) => (ref === cfg.git.main ? `\`${ref}\`'s tip` : `the tip of \`${ref}\``);
  try {
    const ctx = {
      ...createSaturateContext({ cfg, runner, frozen, base: baseOf(commit), commit, area: id, say }),
      round: `scour fix ${n}`, nightDir: runDir, date: record.started.slice(0, 10),
      frozenTree: git('rev-parse', `${commit}^{tree}`),
      identity: Object.fromEntries(['NAME', 'EMAIL'].flatMap((k) => {
        const v = git('config', `user.${k.toLowerCase()}`);
        return [[`GIT_AUTHOR_${k}`, v], [`GIT_COMMITTER_${k}`, v]];
      })),
      localFix: localFixOf(cfg, { localFix: Boolean(args.localFix) }),
      total: { fix: batches.length },
      progress: (kind, msg, total) => say(`${kind} ${msg}${total ? ` (of ${total})` : ''}`),
      layRepair: createRepairLayer(cfg, frozen),
    };
    const why = stacked ? ', the area\'s newest fix branch' : '';
    say(`scour fix ${n} on ${id} at ${commit.slice(0, 10)}, ${tipOf(on)}${why} (ledger at ${ledger.commit.slice(0, 10)}): ${batches.length} batches`);
    let at = on;
    for (const b of batches) {
      const tip = git('rev-parse', `${at}^{commit}`);
      if (tip !== ctx.commit) moveTo(ctx, tip, baseOf(tip));
      const area = { id: `${id}~b${b.n}`, files: [...new Set([...ledger.files, ...b.files])] };
      const inDir = stageIn(ctx, area);
      writeFileSync(join(inDir, 'scour.md'), scourFindingsMarkdown(b.defects));
      const dir = join(runDir, 'batches', `b${b.n}`);
      mkdirSync(dir, { recursive: true });
      say(`batch ${b.n}: ${b.defects.length} defects (${b.defects.map((d) => d.id).join(' ')}) over ${b.files.length} files, on ${tipOf(at)}`);
      const fixed = await fixInto(ctx, area, dir, b.defects.length, scourSource(area.id, ctx.commit, tipOf(at), ledger.commit, b.defects.length));
      const verdicts = scourVerdictsOf(fixed.report, b.defects.map((d) => d.id));
      const branch = `scour${n}-${id}-b${b.n}`;
      const applied = fixed.mbox ? branchWith(root, branch, ctx.commit, fixed.mbox) : false;
      // The next batch stacks on this one only if it is sound: a failed verify is kept on its branch for a look, not built on.
      if (applied && fixed.verify?.ok !== false) at = branch;
      const costUsd = [fixed.usage, ...(fixed.repairUsage ?? [])].reduce((sum, u) => sum + (u?.costUsd ?? 0), 0);
      const result = {
        n: b.n, on: ctx.commit, defects: b.defects.map((d) => ({ id: d.id, recurrent: d.recurrent, files: filesOf(d, ledger.files) })), verdicts,
        commits: fixed.patches ?? 0, branch: applied ? branch : null, verify: fixed.verify ?? null, repairs: fixed.repairs?.length ?? 0,
        costUsd, minutes: fixed.minutes ?? 0,
      };
      record.batches.push(result);
      keep();
      const tally = VERDICTS.map((v) => [v, verdicts.filter((x) => x.verdict === v).length]).filter(([, k]) => k > 0).map(([v, k]) => `${k} ${v}`).join(', ');
      say(`batch ${b.n}: ${tally || 'no verdicts read'}; ${result.commits} commits${applied ? ` on ${branch}` : ''}; verify ${result.verify?.ok === false ? 'failed' : result.verify ? 'passed' : 'not run'}; $${costUsd.toFixed(2)}`);
    }
    // The area's newest branch holds every unlanded fix, this run's and any it stacked on.
    const newest = stackBranchFor(cfg, root, id);
    if (!newest) say('land: no verified fix branch to land');
    else if (args.ready) {
      record.ready = newest;
      say(`ready: ${newest} holds the area's fixes; --ready, so ${cfg.git.main} is untouched`);
    } else {
      keep();
      record.landing = await landFixBranch({ ctx, cfg, root, area: id, branch: newest, runs: fixRunsIn(cfg), say });
    }
  } finally {
    removeWorktree(root, frozen);
    record.finished = new Date().toISOString();
    keep();
  }
  return record;
};
