/**
 * A fix-only round: fixers, with no reviewers, for areas holding open findings (`carry.mjs`), then verify, repair,
 * batch, and capstone as any round does after matching. README.md, "Carried findings", is its documentation.
 */
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { areasAtOnce, startAreas } from './admit.mjs';
import { fix } from './area.mjs';
import { writeCarried } from './carryBrief.mjs';
import { JOB_IN } from './config.mjs';
import { CHECKS_IN, PROGRESS_IN, progressSource } from './jobs.mjs';
import { totals } from './usage.mjs';

const round1 = (n) => Number(n.toFixed(1));
const cents = (n) => Number(n.toFixed(2));

/** `--fix-only`'s value: `true` for every area with open findings, else the list of areas it names. */
export const fixOnlyArg = (value) => (value === undefined ? undefined : value === '' || value === 'all' ? true : value.split(',').filter(Boolean));

/**
 * The areas a fix-only round takes, in partition order: those with open findings in `open` (a Map of area id to its
 * findings), limited to `want` when it is a list, less those `held` by a live run or `inFlight` on an unlanded branch.
 * Answers `{ picked, skipped }`: the picked area ids, and why each wanted one was not picked.
 */
/** @param {{ areas: { id: string }[], open: Map<string, any[]>, want?: true | string[], held?: Set<string>, inFlight?: Set<string> }} p */
export const planFixOnly = ({ areas, open, want = true, held = new Set(), inFlight = new Set() }) => {
  const known = new Set(areas.map((a) => a.id));
  const wanted = want === true ? null : new Set(want);
  const skipped = [];
  for (const id of wanted ?? []) if (!known.has(id)) skipped.push({ id, why: 'no such area' });
  const picked = [];
  for (const { id } of areas) {
    if (wanted && !wanted.has(id)) continue;
    const why = !open.get(id)?.length ? 'no open findings' : held.has(id) ? 'held by a live run' : inFlight.has(id) ? 'on an unlanded branch' : '';
    if (why) {
      if (wanted || why !== 'no open findings') skipped.push({ id, why });
    } else picked.push(id);
  }
  return { picked, skipped };
};

/** What a fix-only fixer is told its findings are. */
const carriedOnlySource = (ctx) => `No reviewer ran in this round. Every finding below was reported in an earlier round and no fixer\nacted on it; the frozen commit is ${ctx.commit}.`;

/** One area's fixer on its carried findings alone. Answers its summary, the shape `runArea`'s takes. */
export const fixCarried = async (ctx, area, carried) => {
  const inDir = join(ctx.frozen, JOB_IN, area.id);
  mkdirSync(inDir, { recursive: true });
  copyFileSync(progressSource(), join(ctx.frozen, PROGRESS_IN));
  writeFileSync(join(ctx.frozen, CHECKS_IN), `${JSON.stringify(ctx.cfg.checks.tally ?? {})}\n`);
  const dir = join(ctx.nightDir, 'areas', area.id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'files.txt'), `${area.files.join('\n')}\n`);
  const source = [carriedOnlySource(ctx), writeCarried(ctx, area.id, carried, dir)].join('\n\n');
  const fixed = await fix(ctx, area, carried.length, source);
  if (fixed.report) writeFileSync(join(dir, 'fix.md'), fixed.report);
  if (fixed.mbox) copyFileSync(fixed.mbox, join(dir, 'fix.mbox'));
  const records = [fixed.usage, ...(fixed.repairUsage ?? [])].filter(Boolean);
  const spent = totals(records);
  return {
    id: area.id, commit: ctx.commit, date: ctx.date, files: area.files, fixOnly: true, carried: carried.length,
    a: 0, b: 0, m: 0, distinct: 0, read: { A: 0, B: 0 },
    patches: fixed.patches ?? 0,
    ...(fixed.verify ? { verify: fixed.verify } : {}),
    questions: (fixed.report?.match(/\bquestion\b/gi) ?? []).length,
    budgetHit: records.filter((r) => r.budgetHit).map((r) => r.role),
    jobs: {
      minutes: { fix: round1(fixed.minutes ?? 0), ...(fixed.repairs?.length ? { repair: round1(fixed.repairs.reduce((t, r) => t + r.minutes, 0)) } : {}) },
      nodes: { fix: fixed.node },
      weightedTokens: spent.weightedTokens,
      costUsd: cents(spent.costUsd),
    },
    fixCommits: [],
  };
};

/** Every picked area's fixer, started as `startAreas` admits them; resolves when all finish. */
export const fixOnlyAreas = ({ ctx, picked, open, args, status, deadline, results }) => startAreas({
  ctx, picked, args, status, deadline, results, maxAreas: areasAtOnce(ctx.cfg, args, 'fix', 1),
  start: (area) => fixCarried(ctx, area, open.get(area.id) ?? []),
});
