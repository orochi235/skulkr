/**
 * Conflict repair (README "batch" step): a branch whose merge into the batch conflicts is merged in a scratch worktree
 * of the batch's tip with git's markers left in, and that state, as one commit, goes to a repair job told to resolve
 * the markers keeping both sides' intent. Its commits are verified as a repair's are; a passing resolution is kept as
 * a patch from the marked state, which merges the branch into the batch, and into a rebuilt batch while it still applies.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { addWorktree, gitIn, mergeIn, removeWorktree } from './batch.mjs';
import { brief, fill, projectVars } from './brief.mjs';
import { JOB_IN } from './config.mjs';
import { checkedIn, repairJob, summaryOf } from './repair.mjs';
import { verdictText, verifyOf } from './verify.mjs';

const BOT = ['-c', 'user.name=skulkr', '-c', 'user.email=skulkr@localhost'];
const tryGit = (git, ...args) => {
  try {
    return { ok: true, out: git(...args) };
  } catch (error) {
    return { ok: false, out: String(error.stderr || error.message) };
  }
};

/** The merge commit message a batch gives `branch`. */
export const mergeMessage = (branch, batchName) => `Merge branch '${branch}' into ${batchName}`;

const MARKER = /^(?:<{7}|>{7})(?: |$)/m;
/** Which of `paths` in the checkout at `tree` still hold a conflict marker. */
export const markedIn = (tree, paths) => paths.filter((p) => {
  try {
    return MARKER.test(readFileSync(join(tree, p), 'utf8'));
  } catch {
    return false;
  }
});

/**
 * `branch` merged onto the tip of the batch checked out at `batchTree`, in a scratch worktree beside it, its conflicts
 * staged with their markers and committed on the tip as one plain commit, `snapshot`. Answers `{ tree, tip, snapshot,
 * paths, mbox }`, `mbox` that commit as a patch at `mboxPath`, with the scratch worktree back at the tip; `{ clean }`
 * when the merge no longer conflicts; or `{ error }`. The caller removes `tree`.
 */
export const markConflicts = (root, { batchTree, branch, name, mboxPath }) => {
  const tip = gitIn(batchTree)('rev-parse', 'HEAD');
  const tree = addWorktree(root, `${name}-conflict`, tip);
  const git = gitIn(tree);
  const run = mergeIn(git, ['--no-ff', '--no-commit', branch]);
  if (!run.conflict) {
    tryGit(git, 'merge', '--abort');
    return run.ok ? { tree, clean: true } : { tree, error: run.error };
  }
  git('add', '-A', '--', ...run.conflict);
  const snapshot = git(...BOT, 'commit-tree', git('write-tree'), '-p', tip, '-m', `${mergeMessage(branch, 'the batch')}, its conflicts marked`);
  tryGit(git, 'merge', '--abort');
  git('reset', '-q', '--hard', tip);
  mkdirSync(join(mboxPath, '..'), { recursive: true });
  writeFileSync(mboxPath, git('format-patch', '--binary', '--stdout', `${tip}..${snapshot}`));
  return { tree, tip, snapshot, paths: run.conflict, mbox: mboxPath };
};

/**
 * The resolution in `mbox`, the marked commit and the commits a repair made on it, as a patch from the marked state:
 * applied in the scratch worktree `tree` at the tip it was marked on. Answers `{ patch }`, or `{ error }` where it does
 * not apply or leaves a marker in one of `paths`.
 */
export const resolutionIn = (tree, mbox, paths) => {
  const git = gitIn(tree);
  const tip = git('rev-parse', 'HEAD');
  const am = tryGit(git, ...BOT, 'am', '-q', '--3way', '--keep-cr', mbox);
  if (!am.ok) {
    tryGit(git, 'am', '--abort');
    return { error: `the repair's commits did not apply: ${am.out.split('\n').find(Boolean) ?? ''}` };
  }
  const commits = git('rev-list', '--reverse', `${tip}..HEAD`).split('\n').filter(Boolean);
  if (commits.length < 2) return { error: 'the repair committed nothing' };
  const marked = markedIn(tree, paths);
  if (marked.length) return { error: `conflict markers left in ${marked.join(', ')}` };
  return { patch: git('diff', '--binary', commits[0], 'HEAD') };
};

/** `patch` applied to the index and working tree of `git`'s checkout; an empty one changes nothing. */
const applyPatch = (git, patch) => {
  if (!patch.trim()) return { ok: true };
  const dir = mkdtempSync(join(tmpdir(), 'skulkr-resolution-'));
  try {
    const file = join(dir, 'resolution.patch');
    writeFileSync(file, patch.endsWith('\n') ? patch : `${patch}\n`);
    return tryGit(git, 'apply', '--index', '--binary', '--whitespace=nowarn', file);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

/**
 * Merges `branch` into the batch checked out at `tree` with `patch` (`resolutionIn`'s) laid over its conflicts, and
 * commits the merge with `message`. Answers `{ ok: true }`, or `{ ok: false, why }` with the batch left as it was.
 */
export const mergeResolved = (tree, { branch, message, patch }) => {
  const git = gitIn(tree);
  const run = mergeIn(git, ['--no-ff', '--no-commit', '-m', message, branch]);
  if (run.error) return { ok: false, why: run.error };
  const fail = (why) => {
    tryGit(git, 'merge', '--abort');
    return { ok: false, why };
  };
  if (run.conflict) {
    git('add', '-A', '--', ...run.conflict);
    const applied = applyPatch(git, patch);
    if (!applied.ok) return fail(`its resolution no longer applies: ${applied.out.split('\n').find(Boolean) ?? ''}`);
    const marked = markedIn(tree, run.conflict);
    if (marked.length) return fail(`conflict markers left in ${marked.join(', ')}`);
  }
  const done = tryGit(git, 'commit', '-q', '--no-verify', '--no-edit');
  return done.ok ? { ok: true } : fail(done.out.split('\n').find(Boolean) ?? 'the merge did not commit');
};

/**
 * Conflict repairs through `ctx`'s jobs: `(branch, { batch, paths, label })` marks `branch`'s merge into `batch`, runs
 * a repair job on it from a scratch worktree at the batch's tip (that tip its frozen tree, and its baseline), and
 * verifies what it committed. Answers `{ ok, patch?, why?, verify? }`.
 */
export const conflictRepairer = (ctx, { root }) => async (branch, { batch, label }) => {
  const { cfg, nightDir } = ctx;
  const id = cfg.names.idOf(branch);
  const area = { id };
  const mboxPath = join(nightDir, 'areas', id, `${label}.mbox`);
  const marked = markConflicts(root, { batchTree: batch.tree, branch, name: batch.name.replace(/\//g, '-'), mboxPath });
  try {
    if (marked.error) return { ok: false, why: marked.error };
    if (marked.clean) return { ok: false, why: 'it merges cleanly now' };
    const git = gitIn(marked.tree);
    const sub = { ...ctx, frozen: marked.tree, frozenTree: git('rev-parse', `${marked.tip}^{tree}`), baseline: new Map() };
    const inDir = join(marked.tree, JOB_IN, id);
    mkdirSync(inDir, { recursive: true });
    const commit = ctx.commit;
    writeFileSync(join(inDir, 'ours.patch'), gitIn(root)('diff', commit, marked.tip, '--', ...marked.paths));
    writeFileSync(join(inDir, 'theirs.patch'), gitIn(root)('diff', `${gitIn(root)('merge-base', commit, branch)}`, branch, '--', ...marked.paths));
    const paths = marked.paths.map((p) => `\`${p}\``).join(', ');
    const prompt = fill(brief(cfg, 'conflict'), {
      ...projectVars(cfg, 'conflict'), round: ctx.round, area: id, branch, batch: batch.name, paths,
      command: verifyOf(cfg)?.command ?? '', ours: `${JOB_IN}/${id}/ours.patch`, theirs: `${JOB_IN}/${id}/theirs.patch`,
    });
    const run = await repairJob(sub, area, {
      mbox: marked.mbox, log: `merging ${branch} into ${batch.name} conflicts in ${marked.paths.join(', ')}\n`, label, attempt: label,
      extra: marked.paths, prompt, about: `Resolves the merge conflict between audit round ${ctx.round}'s ${branch} and ${batch.name}.`,
    });
    const verdict = await checkedIn(sub, area, run.to, run.mbox, `repair-${label}`, marked.paths);
    ctx.say(`repair ${id} conflict on ${run.node}: ${run.added} commits, ${run.minutes.toFixed(1)} min; verify ${verdict.ok ? 'passed' : verdictText(verdict)}`);
    const verify = { ...summaryOf(verdict), conflict: true };
    if (!verdict.ok) return { ok: false, why: `its resolution failed verify (${verdictText(verdict)})`, verify };
    if (!existsSync(run.mbox)) return { ok: false, why: 'the repair handed back no commits', verify };
    const resolved = resolutionIn(marked.tree, run.mbox, marked.paths);
    return resolved.error ? { ok: false, why: resolved.error, verify } : { ok: true, patch: resolved.patch, verify };
  } finally {
    if (marked.tree) removeWorktree(root, marked.tree);
  }
};

/**
 * Tries to merge each of `made`'s `conflicted` branches into its batch: with the resolution an earlier build kept in
 * `kept` (branch → patch) while it still applies, else with a conflict repair, `resolve`, each started only while
 * `mayRepair()` answers ''. A branch merged this way moves to `made.merged` and is answered; the rest stay in
 * `made.conflicted`, each given `repair`, why its repair did not merge it.
 */
export const resolveConflicts = async ({ made, kept, resolve, mayRepair = () => '', say }) => {
  const merged = [];
  for (const out of [...made.conflicted]) {
    const { branch } = out;
    const message = mergeMessage(branch, made.name);
    const earlier = kept.get(branch);
    if (earlier && mergeResolved(made.tree, { branch, message, patch: earlier }).ok) {
      say(`batch: ${branch} merged with the resolution of its conflict kept from an earlier build`);
    } else {
      const why = mayRepair();
      if (why) {
        say(`batch: conflict repair of ${branch} not started, ${why}`);
        out.repair = 'not started';
        continue;
      }
      const tip = gitIn(made.tree)('rev-parse', 'HEAD');
      let got;
      try {
        got = await resolve(branch, { batch: made, paths: out.paths, label: `conflict-${tip.slice(0, 10)}` });
      } catch (error) {
        got = { ok: false, why: `crashed: ${error.message ?? error}` };
      }
      const into = got.ok ? mergeResolved(made.tree, { branch, message, patch: got.patch }) : { ok: false, why: got.why };
      if (!into.ok) {
        say(`batch: conflict repair of ${branch} failed: ${into.why}`);
        out.repair = 'failed';
        continue;
      }
      kept.set(branch, got.patch);
      say(`batch: ${branch} merged after a conflict repair of ${out.paths.join(', ')}`);
    }
    made.conflicted = made.conflicted.filter((c) => c !== out);
    made.merged.push(branch);
    merged.push(branch);
  }
  return merged;
};
