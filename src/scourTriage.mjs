/**
 * `skulkr scour fix`'s triage: which of a ledger's defects go to a fixer, and in which batches. No model reads the code
 * here (docs/scour.md "Decided"); batches only group what a fixer can do in one sitting.
 */
import { isRecurrent } from './triageFields.mjs';

/** The most defects one fixer is handed. */
export const BATCH_MAX = 8;

/** A `where` or `fix` entry's file: `src/a.ts:120 (fn)` and `` `src/a.ts` (`fn`) `` are `src/a.ts`. */
export const fileOf = (where) => String(where ?? '').replace(/`/g, '').trim().split(/[\s:(]/)[0] ?? '';

/** The line a `where` names, for ordering within a file; 0 when it names none. */
const lineOf = (where) => Number(/:(\d+)/.exec(String(where ?? ''))?.[1] ?? 0);

const PATHLIKE = /\/.*\.[a-z0-9]+$/i;

/**
 * An entry a reviewer wrote as a file, made the repository path it names: itself when the ledger lists it, the one
 * ledger file it is the tail of (`CurveEditor/x.ts`), itself when it at least looks like a path, else nothing (prose
 * such as `[track.min`).
 */
export const resolvedFile = (entry, known = []) => {
  const f = fileOf(entry);
  if (!f) return null;
  const tails = known.filter((k) => k !== f && k.endsWith(`/${f}`));
  if (known.includes(f) && tails.length === 0) return f;
  if (tails.length === 1) return tails[0];
  return PATHLIKE.test(f) ? f : null;
};

/** The files a fix for `d` would touch: its `fix` list, else the file its `where` names, each resolved (`resolvedFile`). */
export const filesOf = (d, known = []) => {
  const listed = (d.fix ?? []).map((f) => resolvedFile(f, known)).filter(Boolean);
  return listed.length ? [...new Set(listed)] : [resolvedFile(d.where, known)].filter(Boolean);
};

/**
 * The fix plan for a ledger's open defects: `design`-sized ones set aside to ask, the rest in batches of defects
 * that share a file a fix would touch or a stated cause, so one fixer reads each file once. A group larger than
 * `BATCH_MAX` is split in file and line order, keeping neighbors together. Each defect carries `recurrent`.
 */
export const fixPlanFor = (ledger, { open = () => true, recurrent } = {}) => {
  const occasions = ledger.occasions.length;
  // The ledger's files, and the full paths reviewers named outside them, which a shorter mention may be the tail of.
  const named = ledger.defects.flatMap((d) => (d.fix ?? []).map(fileOf)).filter((f) => (f.match(/\//g) ?? []).length >= 2);
  const known = [...new Set([...(ledger.files ?? []), ...named])];
  const defects = ledger.defects.filter(open).map((d) => ({ ...d, files: filesOf(d, known), recurrent: isRecurrent(d.sightings.length, occasions, recurrent) }));
  const ask = defects.filter((d) => d.size === 'design');
  const toFix = defects.filter((d) => d.size !== 'design');
  // Union-find over the defects, joined by shared files and shared causes.
  const parent = toFix.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const join = (a, b) => { parent[find(a)] = find(b); };
  const firstBy = new Map();
  toFix.forEach((d, i) => {
    const keys = [...d.files.map((f) => `file:${f}`), ...(d.cause ? [`cause:${d.cause.trim().toLowerCase()}`] : [])];
    for (const k of keys) {
      if (firstBy.has(k)) join(i, firstBy.get(k));
      else firstBy.set(k, i);
    }
  });
  const groups = new Map();
  toFix.forEach((d, i) => groups.set(find(i), [...(groups.get(find(i)) ?? []), d]));
  const inOrder = (a, b) => fileOf(a.where).localeCompare(fileOf(b.where)) || lineOf(a.where) - lineOf(b.where);
  const batches = [...groups.values()]
    .flatMap((g) => {
      const sorted = [...g].sort(inOrder);
      const parts = Math.ceil(sorted.length / BATCH_MAX);
      const size = Math.ceil(sorted.length / parts);
      return Array.from({ length: parts }, (_, k) => sorted.slice(k * size, (k + 1) * size));
    })
    // Small batches that share nothing fill up together, in file order, so no fixer is started for one line.
    .sort((a, b) => b.length - a.length || inOrder(a[0], b[0]));
  const packed = [];
  for (const b of batches) {
    const room = packed.find((p) => p.length + b.length <= BATCH_MAX && b.length <= 2 && p.length < BATCH_MAX);
    if (room) room.push(...b);
    else packed.push([...b]);
  }
  return {
    batches: packed.map((ds, k) => ({ n: k + 1, defects: ds, files: [...new Set(ds.flatMap((d) => d.files))].sort() })),
    ask,
  };
};

/** The plan as terminal lines: each batch's files and defects, recurrent ones marked, then what goes to ask. */
export const fixPlanLines = (area, plan) => [
  `${area}: ${plan.batches.reduce((n, b) => n + b.defects.length, 0)} defects in ${plan.batches.length} batches${plan.ask.length ? `, ${plan.ask.length} to ask` : ''}`,
  ...plan.batches.flatMap((b) => [
    `batch ${b.n} · ${b.defects.length} · ${b.files.join(', ')}`,
    ...b.defects.map((d) => `  ${d.id.padEnd(4)} ${d.recurrent ? '↻' : ' '} ${(d.size ?? '?').padEnd(8)} ${d.claim.slice(0, 96)}`),
  ]),
  ...(plan.ask.length ? ['ask (design-sized)', ...plan.ask.map((d) => `  ${d.id.padEnd(4)}   ${d.claim.slice(0, 96)}`)] : []),
];
