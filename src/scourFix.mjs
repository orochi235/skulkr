/**
 * `skulkr scour fix <area>`: a fix run over one ledger's defects (docs/scour.md "Building the fix stage"). Triage
 * batches them (`scourTriage.mjs`); each batch goes to a round's fixer job on `main`'s tip, verified and repaired as a
 * round's is, and its commits land on a branch of their own, `scour<N>-<area>-b<k>`. `main` is never touched: landing
 * and closing the registry's lines are not built yet.
 */
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fixInto, stageIn } from './area.mjs';
import { addWorktree, gitIn, removeWorktree } from './batch.mjs';
import { JOB_IN } from './config.mjs';
import { freezeCommitOf, ledgerOf, withLedgerHeld } from './ledger.mjs';
import { loggingSay } from './delveLive.mjs';
import { localFixOf } from './args.mjs';
import { createSaturateContext } from './saturateJobs.mjs';
import { scourStateDirOf } from './scourPaths.mjs';
import { fixPlanFor, fixPlanLines, filesOf } from './scourTriage.mjs';

const VERDICTS = ['not a defect', 'not fixed', 'duplicate', 'question', 'fixed'];

/** The next fix run's number: one past the highest `fix-<N>` in the scour state directory. */
const nextRunOf = (cfg) => {
  const dir = scourStateDirOf(cfg);
  const taken = existsSync(dir) ? readdirSync(dir).map((n) => Number(/^fix-(\d+)$/.exec(n)?.[1] ?? 0)) : [];
  return Math.max(0, ...taken) + 1;
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
const scourSource = (id, commit, ledgerCommit, n) => [
  `No round's reviewers ran here. These ${n} defects come from this area's saturation ledger: many blind`,
  `reviews of it at ${ledgerCommit.slice(0, 10)}, folded into distinct defects. They are in \`${JOB_IN}/${id}/scour.md\`,`,
  `each headed by its id in brackets. You are at ${commit.slice(0, 10)}, \`main\`'s tip, and the code may have`,
  'changed since the ledger: check each still applies first (`not a defect (no longer applies)` when it is gone).',
  'Lead each verdict line with its id in brackets, `[D7]`, and give `scour` as where it came from. They count in N.',
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
 * `skulkr scour fix <area> [--dry] [--batch k,…]`: the plan with `--dry`, else every batch (or those listed) through a
 * fixer, one at a time. Answers the run's record.
 */
export const scourFix = async (cfg, runner, root, id, args, say) => {
  const ledger = ledgerOf(cfg, id);
  if (!ledger) throw new Error(`${id} has no scour ledger`);
  const plan = fixPlanFor(ledger, { recurrent: cfg.saturate.recurrent });
  if (args.dry) {
    for (const line of fixPlanLines(id, plan)) say(line);
    return { plan };
  }
  const wanted = args.batch === undefined ? null : new Set(String(args.batch).split(',').map(Number));
  const batches = wanted ? plan.batches.filter((b) => wanted.has(b.n)) : plan.batches;
  if (batches.length === 0) throw new Error(`${id} has no batch ${args.batch}`);
  const n = nextRunOf(cfg);
  const runDir = join(scourStateDirOf(cfg), `fix-${n}`);
  mkdirSync(runDir, { recursive: true });
  // Held as a delve holds it, so the Scour page shows the run live and no delve starts on the ledger meanwhile.
  return withLedgerHeld(cfg, id, { about: { does: 'fix', max: batches.length, jobs: `fix-${n}` } }, () => fixBatches(cfg, root, id, ledger, batches, n, runDir, args, loggingSay(cfg, id, say)));
};

/** Fix run `n`'s `batches` of ledger `id`, one at a time, recorded in `runDir`. Answers the run's record. */
const fixBatches = async (cfg, root, id, ledger, batches, n, runDir, args, say) => {
  const commit = freezeCommitOf(cfg, root);
  const git = gitIn(root);
  const frozen = addWorktree(root, `${cfg.naming.prefix}-scour-fix${n}`, commit);
  const record = { run: n, area: id, commit, ledgerCommit: ledger.commit, started: new Date().toISOString(), batches: [] };
  const keep = () => writeFileSync(join(runDir, 'record.json'), `${JSON.stringify(record, null, 1)}\n`);
  try {
    let base = commit;
    try { base = git('merge-base', commit, `${cfg.git.remote}/${cfg.git.main}`); } catch { /* no remote */ }
    const ctx = {
      ...createSaturateContext({ cfg, runner, frozen, base, commit, area: id, say }),
      round: `scour fix ${n}`, nightDir: runDir, date: record.started.slice(0, 10),
      frozenTree: git('rev-parse', `${commit}^{tree}`),
      identity: Object.fromEntries(['NAME', 'EMAIL'].flatMap((k) => {
        const v = git('config', `user.${k.toLowerCase()}`);
        return [[`GIT_AUTHOR_${k}`, v], [`GIT_COMMITTER_${k}`, v]];
      })),
      localFix: localFixOf(cfg, { localFix: Boolean(args.localFix) }),
      total: { fix: batches.length },
      progress: (kind, msg, total) => say(`${kind} ${msg}${total ? ` (of ${total})` : ''}`),
    };
    say(`scour fix ${n} on ${id} at ${commit.slice(0, 10)} (ledger at ${ledger.commit.slice(0, 10)}): ${batches.length} batches`);
    for (const b of batches) {
      const area = { id: `${id}~b${b.n}`, files: [...new Set([...ledger.files, ...b.files])] };
      const inDir = stageIn(ctx, area);
      writeFileSync(join(inDir, 'scour.md'), scourFindingsMarkdown(b.defects));
      const dir = join(runDir, 'batches', `b${b.n}`);
      mkdirSync(dir, { recursive: true });
      say(`batch ${b.n}: ${b.defects.length} defects (${b.defects.map((d) => d.id).join(' ')}) over ${b.files.length} files`);
      const fixed = await fixInto(ctx, area, dir, b.defects.length, scourSource(area.id, commit, ledger.commit, b.defects.length));
      const verdicts = scourVerdictsOf(fixed.report, b.defects.map((d) => d.id));
      const branch = `scour${n}-${id}-b${b.n}`;
      const applied = fixed.mbox ? branchWith(root, branch, commit, fixed.mbox) : false;
      const costUsd = [fixed.usage, ...(fixed.repairUsage ?? [])].reduce((sum, u) => sum + (u?.costUsd ?? 0), 0);
      const result = {
        n: b.n, defects: b.defects.map((d) => ({ id: d.id, recurrent: d.recurrent, files: filesOf(d, ledger.files) })), verdicts,
        commits: fixed.patches ?? 0, branch: applied ? branch : null, verify: fixed.verify ?? null, repairs: fixed.repairs?.length ?? 0,
        costUsd, minutes: fixed.minutes ?? 0,
      };
      record.batches.push(result);
      keep();
      const tally = VERDICTS.map((v) => [v, verdicts.filter((x) => x.verdict === v).length]).filter(([, k]) => k > 0).map(([v, k]) => `${k} ${v}`).join(', ');
      say(`batch ${b.n}: ${tally || 'no verdicts read'}; ${result.commits} commits${applied ? ` on ${branch}` : ''}; verify ${result.verify?.ok === false ? 'failed' : result.verify ? 'passed' : 'not run'}; $${costUsd.toFixed(2)}`);
    }
  } finally {
    removeWorktree(root, frozen);
    record.finished = new Date().toISOString();
    keep();
  }
  return record;
};
