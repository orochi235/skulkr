/**
 * A round's findings and its fixer's verdicts, read from its per-area record, and how alike two claims are: what
 * `defectGraph.mjs` decides which findings are one defect, and which are still open, from. README.md, "Carried
 * findings", is its documentation.
 */
import { openItems } from './defects.mjs';
import { parseSections, reportItems } from './findings.mjs';

const STOP = new Set(['the', 'and', 'for', 'but', 'not', 'its', 'it\'s', 'with', 'that', 'this', 'from', 'into', 'when',
  'then', 'than', 'are', 'was', 'were', 'has', 'have', 'had', 'one', 'every', 'any', 'all', 'only', 'even', 'though',
  'which', 'while', 'where', 'what', 'their', 'there', 'they', 'them', 'also', 'still', 'never', 'can', 'does', 'doesn\'t']);
const stem = (w) => w.replace(/(?:ing|ed|es|s)$/, '');

/** The content words of a claim, lowercased and crudely stemmed. */
export const wordsOf = (text) => new Set((text.toLowerCase().match(/[a-z0-9_$@.-]+/g) ?? [])
  .map((w) => w.replace(/^[.-]+|[.-]+$/g, '')).filter((w) => w.length > 2 && !STOP.has(w)).map(stem));

/** How alike two claims are: the Dice coefficient of their content words, 0 to 1. */
export const likeness = (x, y) => {
  const a = wordsOf(x), b = wordsOf(y);
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const w of a) if (b.has(w)) shared += 1;
  return (2 * shared) / (a.size + b.size);
};

/** A fixer's verdict line answers a finding at or above this likeness; it paraphrases, so the bar is low. */
export const VERDICT_LIKENESS = 0.4;
/** Two rounds' findings citing a common file are one defect at or above this likeness. */
export const SAME_LIKENESS = 0.45;

const GENERIC_PATH = /([\w@-][\w.@-]*\/[\w./@-]+\.\w+)/g;
/** The repo paths a `where` line cites. */
export const pathsOf = (where, cited = GENERIC_PATH) => [...new Set([...(where ?? '').matchAll(new RegExp(cited.source, 'g'))].map((m) => m[1]))];

/**
 * The findings a round handed its fixer: the matched ones once, then each reviewer's own, as `defects.mjs`' `openItems`
 * orders them, each with the `where` its reviewer gave, then the ones carried into it from earlier rounds. A finding
 * with no `where` is a heading a reviewer wrote, not a defect, and is left out. Each has an `id`, `r<round>-<n>`.
 */
export const givenIn = (rec) => {
  const match = rec.match ?? { a: [], b: [], pairs: [] };
  // By claim, not index: a record from before parseFindings dropped where-less sections lists them in its match.
  const whereOf = (text) => new Map(parseSections(text ?? '').reverse().map((f) => [f.claim, f.where]));
  const where = { A: whereOf(rec.A), B: whereOf(rec.B) };
  const fresh = openItems(match, (claim, side) => where[side].get(claim))
    .flatMap(({ claim, where: at, from }) => (claim && at ? [{ claim, where: at, from }] : []))
    .map((f, n) => ({ ...f, id: `r${rec.round}-${n + 1}`, round: rec.round }));
  return { fresh, carried: rec.carried ?? [] };
};

/**
 * What a round's fixer of the area did. `worked` is false for a job that did no work: no report holding a verdict or
 * a `tally:` line, and no commits. `items` are its report's verdicts, `subjects` its commits' subjects.
 */
export const fixOf = (rec) => {
  const report = rec.fix ?? '';
  const items = report ? reportItems(report) : [];
  const commits = (rec.area?.patches ?? 0) + (rec.area?.fixCommits?.length ?? 0);
  const listed = items.filter((i) => i.from !== 'extra').length;
  return { worked: items.length > 0 || /^tally: /im.test(report) || commits > 0, items, listed, subjects: rec.subjects ?? [], text: report };
};
