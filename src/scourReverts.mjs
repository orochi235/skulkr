/**
 * A repair can take back a fixer's fix with `git revert` (the repair brief allows it when the only way to pass is to
 * drop a fix). The fixer's report still says `fixed`, so a batch's verdicts are read again against its final mbox: a
 * defect whose every fixing commit a `Revert "<subject>"` commit takes back is not fixed.
 */
import { trailerDefectsOf } from './progress.mjs';
import { verdictIn } from './scourFixStatus.mjs';

/** Each patch of an mbox's text: its subject (headers unfolded, `[PATCH n/m]` gone) and its message body. */
const patchesOf = (mbox) => String(mbox).split(/^(?=From [0-9a-f]{40} )/m).filter((p) => p.startsWith('From ')).map((patch) => {
  const sha = patch.slice(5, 15);
  const [head, ...rest] = patch.split(/\n\n/);
  const subject = /^Subject: (.*(?:\n[ \t].*)*)/m.exec(head)?.[1].replace(/\n[ \t]+/g, ' ').replace(/^\[PATCH[^\]]*\]\s*/, '').trim() ?? '';
  const body = rest.join('\n\n').split(/^---$/m)[0];
  return { sha, subject, body };
});

/** The defects whose fixes the mbox's revert commits all take back: each fix commit matched by its subject, its
 *  defects read from its `Defect:` trailer. A defect another unreverted commit also fixes stays fixed. */
export const revertedDefectsOf = (mbox) => {
  const patches = patchesOf(mbox);
  const reverted = new Set(patches.flatMap((p) => /^Revert "(.+)"$/.exec(p.subject)?.[1] ?? []));
  const kept = new Set();
  const gone = new Set();
  for (const p of patches) {
    if (/^Revert "/.test(p.subject)) continue;
    for (const id of trailerDefectsOf(p.body)) (reverted.has(p.subject) ? gone : kept).add(id);
  }
  return new Set([...gone].filter((id) => !kept.has(id)));
};

/** Each defect an unreverted commit's `Defect:` trailer names, with the first such commit's short sha. */
export const trailerFixesOf = (mbox) => {
  const patches = patchesOf(mbox);
  const reverted = new Set(patches.flatMap((p) => /^Revert "(.+)"$/.exec(p.subject)?.[1] ?? []));
  const out = new Map();
  for (const p of patches) {
    if (/^Revert "/.test(p.subject) || reverted.has(p.subject)) continue;
    for (const id of trailerDefectsOf(p.body)) if (!out.has(id)) out.set(id, p.sha);
  }
  return out;
};

/** `verdicts` with each one the report gave no line for read as fixed where a commit's trailer names it (`trailerFixesOf`):
 *  the commit is the evidence, as the brief has every fix commit name its defects. */
export const withTrailersRead = (verdicts, fixes) => verdicts.map((v) => (v.verdict || !fixes.has(v.id) ? v
  : { ...v, verdict: 'fixed', sha: fixes.get(v.id), line: `[${v.id}] (scour): fixed ${fixes.get(v.id)} (read from its commit's Defect trailer; the report gave no line)` }));

/** `verdicts` with each `fixed` one whose id is in `reverted` read as `not fixed`, its line saying a repair reverted it. */
export const withRevertsRead = (verdicts, reverted) => verdicts.map((v) => {
  if (v.verdict !== 'fixed' || !reverted.has(v.id) || !v.line) return v;
  const { at } = verdictIn(v.line);
  return { ...v, verdict: 'not fixed', line: `${v.line.slice(0, at)}not fixed (a repair reverted its fix${v.sha ? ` ${v.sha}` : ''} to pass verify)`, sha: null };
});
