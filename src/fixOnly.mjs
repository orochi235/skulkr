/**
 * A fix-only round: fixers, with no reviewers, for areas holding open findings (`carry.mjs`), then verify, repair,
 * batch, and capstone as any round does after matching. README.md, "Carried findings", is its documentation.
 */
import { areasAtOnce, startAreas } from './admit.mjs';
import { fixInto, fixedPart, jobsPart, makeRecordDir, stageIn } from './area.mjs';
import { writeCarried } from './carryBrief.mjs';

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
  stageIn(ctx, area);
  const dir = makeRecordDir(ctx, area);
  const source = [carriedOnlySource(ctx), writeCarried(ctx, area.id, carried, dir)].join('\n\n');
  const fixed = await fixInto(ctx, area, dir, carried.length, source);
  const records = [fixed.usage, ...(fixed.repairUsage ?? [])].filter(Boolean);
  return {
    id: area.id, commit: ctx.commit, date: ctx.date, files: area.files, fixOnly: true, carried: carried.length,
    a: 0, b: 0, m: 0, distinct: 0, read: { A: 0, B: 0 },
    ...fixedPart(fixed, records),
    jobs: jobsPart({}, { fix: fixed.node }, fixed, records),
    fixCommits: [],
  };
};

/** Every picked area's fixer, started as `startAreas` admits them; resolves when all finish. */
export const fixOnlyAreas = ({ ctx, picked, open, args, status, deadline, results }) => startAreas({
  ctx, picked, args, status, deadline, results, maxAreas: () => areasAtOnce(ctx.cfg, args, 'fix', 1),
  start: (area) => fixCarried(ctx, area, open.get(area.id) ?? []),
});
