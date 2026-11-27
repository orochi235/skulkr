/**
 * Which defects of a scour fix batch a failing verify is laid at, so the Scour page's shelf shows only those
 * `repairing`. A commit names its defects in a `Defect: D12` trailer; each failing file is laid at the fixer's commits
 * by the narrowest evidence that names any (`commitsLaidAt`).
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { reachOf, workspacesIn } from './attribute.mjs';
import { failureTextFor } from './capstone.mjs';
import { trailerDefectsOf } from './progress.mjs';
import { failedTestsIn } from './verify.mjs';

/** Each commit of a `git format-patch` mbox's `text`, in order: its sha, the defects its message's trailers name, the
 *  files its diff changes, and the lines it adds to each (`added`, `path → lines`). */
export const mboxCommitsOf = (text) => String(text).split(/^(?=From [0-9a-f]{40} )/m).flatMap((patch) => {
  const sha = /^From ([0-9a-f]{40}) /.exec(patch)?.[1];
  if (!sha) return [];
  const cut = patch.search(/^---$/m);
  const added = new Map();
  let file = null;
  for (const line of patch.split('\n')) {
    const head = /^diff --git a\/\S+ b\/(\S+)$/.exec(line);
    if (head) added.set((file = head[1]), []);
    else if (file && line.startsWith('+') && !line.startsWith('+++')) added.get(file).push(line.slice(1));
  }
  return [{ sha, defects: trailerDefectsOf(cut < 0 ? patch : patch.slice(0, cut)), files: [...added.keys()], added }];
});

/** `path: token` references in a failure's text, the way a test names what it flags in a file: a stray number, a
 *  name, a line. */
const REF = /((?:[\w@.+-]+\/)+[\w@.+-]+\.\w+):\s?([\w.$-]+)/g;

const escaped = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The commits of `commits` failing file `file` is laid at, by the narrowest evidence that names any: those that changed
 * it; those that added a line holding what its failure's text flags in a file (`sweep.ts: 64`, a line with `64` that
 * commit added to `sweep.ts`); those that changed a file its failure names; those changing what `blame` (the config's
 * `gate.blame`) reads its failing tests' names as blaming; those that changed a file it reaches by import; those in a
 * package it imports.
 */
export const commitsLaidAt = (file, { commits, text, tests, blame, log, reach }) => {
  const touching = (test) => commits.filter((c) => c.files.some(test)).map((c) => c.sha);
  const under = (paths) => (f) => paths.some((p) => f === p || f.startsWith(p.endsWith('/') ? p : `${p}/`));
  const refs = [...text.matchAll(REF)].filter((m) => m[1] !== file);
  const wrote = (path, token) => {
    const word = new RegExp(`(?<![\\w.$])${escaped(token)}(?![\\w$])`);
    return (c) => (c.added.get(path) ?? []).some((l) => word.test(l));
  };
  const steps = [
    () => touching((f) => f === file),
    () => commits.filter((c) => refs.some((m) => wrote(m[1], m[2])(c))).map((c) => c.sha),
    () => touching((f) => text.includes(f)),
    () => touching(under([...tests].flatMap((name) => blame?.(log, name) ?? []))),
    () => touching((f) => reach().files.has(f)),
    () => touching(under([...reach().packages])),
  ];
  for (const step of steps) {
    const found = step();
    if (found.length) return found;
  }
  return [];
};

/**
 * The defects `failing` (files a verify's `log` reports failing) are laid at among `commits` (`mboxCommitsOf`),
 * reading imports in `tree`: `{ defects, commits }`. Null when no commit is
 * laid at, or one laid at names no defect: the whole batch is then repairing.
 */
export const laidDefectsFor = ({ tree, failing, log, commits, blame }) => {
  const listDir = (dir) => {
    try {
      return readdirSync(join(tree, dir));
    } catch {
      return [];
    }
  };
  let workspaces = null;
  const tests = failedTestsIn(log);
  const laid = new Set(failing.flatMap((file) => {
    let reached = null;
    return commitsLaidAt(file, {
      commits, text: failureTextFor(log, file), tests: tests.get(file) ?? new Set(), blame, log,
      reach: () => (reached ??= reachOf(tree, file, (workspaces ??= workspacesIn(tree, listDir)))),
    });
  }));
  const at = commits.filter((c) => laid.has(c.sha));
  if (!at.length || at.some((c) => !c.defects.length)) return null;
  return { defects: [...new Set(at.flatMap((c) => c.defects))], commits: at.map((c) => c.sha) };
};

/** Where a repair's laid defects are kept, beside its log in the batch's job directory. */
export const layPathFor = (jobsDir, label) => join(jobsDir, `repair-${label}.defects.json`);

/**
 * A scour fix's `layRepair` hook for `verifyAndRepair`: before repair `label` starts, writes the defects its failing
 * verdict is laid at beside its log, `{ defects, commits }`, or `{ defects: null }` where none can be said. `tree` is
 * a checkout of the commit the fixer started from.
 */
export const createRepairLayer = (cfg, tree) => ({ jobsDir, verdict, mbox, label }) => {
  let laid = null;
  try {
    laid = laidDefectsFor({
      tree, failing: verdict.failedFiles ?? [], log: verdict.log ?? '', commits: mboxCommitsOf(readFileSync(mbox, 'utf8')), blame: cfg.gate?.blame,
    });
  } catch { /* an unreadable mbox lays nothing */ }
  writeFileSync(layPathFor(jobsDir, label), `${JSON.stringify(laid ?? { defects: null })}\n`);
};
