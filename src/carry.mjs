/**
 * The findings no fixer acted on, derived from each round's per-area record and never kept by hand. A finding is
 * open when a round reported it and no fixer of that area acted on it in that round or after. README.md, "Carried
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

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Whether `text` names `id`: a bare `r56-2` only where no area qualifies it, as `x/r56-2` does. */
const names = (text, id) => new RegExp(`(?<![\\w./-])${escape(id)}(?![\\w-])`).test(text);

/** Whether `fix` gives a verdict line like `finding`'s claim, or commits a subject like it. */
const answers = (fix, finding) => [...fix.items.map((i) => i.claim), ...fix.subjects]
  .some((c) => likeness(c, finding.claim) >= VERDICT_LIKENESS);

/** Whether `fix` acted on `finding`, which it was handed: names its id, or answers its claim. */
const actsOn = (fix, finding) => (finding.id && names(fix.text, finding.id)) || answers(fix, finding);

/**
 * The id finding `o` goes by when listed under area `to`: qualified by the area that reported it when that is not
 * `to`, since every area audited in a round has its own `r<round>-1`.
 */
const idUnder = (o, to) => (to === o.area ? o.id : `${o.area}/${o.id}`);
const QUALIFIED = /^(.+)\/(r\d+-\d+)$/;

const sameDefect = (open, finding, cited) => {
  const paths = pathsOf(finding.where, cited);
  const shared = paths.length === 0 || open.paths.length === 0 || paths.some((p) => open.paths.includes(p));
  return shared && likeness(open.claim, finding.claim) >= SAME_LIKENESS;
};

/**
 * Every area's open findings from its records (`{ round, id, match, A, B, fix, area, carried, subjects }`, any order),
 * as a Map of area id to `{ id, claim, where, from, round, rounds }`, oldest first: `round` is the first round that
 * reported it and `rounds` every round that did. A fixer whose report gives as many verdicts as it was handed findings
 * acted on all of them; otherwise each finding is matched to its verdicts one by one (`actsOn`). Records keep the
 * area ids of their round; with `areas`, the partition now, each finding is listed under the area holding its cited
 * paths (`createHolderLookup`), so a recut hands it to the area that holds its code.
 */
export const openFindings = (records, { cited, areas } = {}) => {
  const byArea = new Map();
  const all = [];
  for (const rec of [...records].sort((x, y) => x.round - y.round)) {
    const list = byArea.get(rec.id) ?? [];
    byArea.set(rec.id, list);
    const { fresh, carried } = givenIn(rec);
    const given = [];
    for (const f of fresh) {
      const known = list.find((o) => sameDefect(o, f, cited));
      if (known) {
        known.rounds.push(rec.round);
        known.acted = false;
        given.push({ ...known, claim: f.claim, id: f.id, known });
      } else {
        const o = { id: f.id, area: rec.id, claim: f.claim, where: f.where, from: f.from, round: rec.round, rounds: [rec.round], paths: pathsOf(f.where, cited), acted: false };
        list.push(o);
        all.push(o);
        given.push({ ...o, known: o });
      }
    }
    for (const c of carried) {
      // A carried id names its first area when that is not this one; a record from before that names none, so its
      // id and claim together are looked for under every area before the bare id is trusted.
      const [, area, id] = c.id.match(QUALIFIED) ?? [, rec.id, c.id];
      const known = all.find((o) => o.area === area && o.id === id && (area !== rec.id || o.claim === c.claim))
        ?? all.find((o) => o.id === id && o.claim === c.claim)
        ?? list.find((o) => o.id === id) ?? list.find((o) => sameDefect(o, c, cited));
      if (known) given.push({ ...known, id: c.id, known });
    }
    const fix = fixOf(rec);
    if (!fix.worked) continue;
    const every = fix.listed >= given.length && given.length > 0;
    for (const g of given) if (every || actsOn(fix, g)) g.known.acted = true;
    // A finding this fixer was not handed is closed only by its words: its bare id may be another area's.
    for (const o of list) if (!o.acted && answers(fix, o)) o.acted = true;
  }
  const holder = areas && createHolderLookup(areas);
  const open = new Map();
  for (const { acted, paths, ...o } of all) {
    if (acted) continue;
    const to = holder?.(paths) ?? o.area;
    if (!open.has(to)) open.set(to, []);
    open.get(to).push({ ...o, id: idUnder(o, to) });
  }
  for (const list of open.values()) list.sort((x, y) => x.round - y.round);
  return open;
};

/**
 * For `areas` (`{ id, files }`), the id of the area holding the most of `paths`, the first such path's on a tie, or
 * undefined when none holds any.
 */
export const createHolderLookup = (areas) => {
  const byFile = new Map(areas.flatMap((a) => a.files.map((f) => [f, a.id])));
  return (paths) => {
    const counts = new Map();
    for (const p of paths) if (byFile.has(p)) counts.set(byFile.get(p), (counts.get(byFile.get(p)) ?? 0) + 1);
    let best;
    for (const [id, n] of counts) if (best === undefined || n > counts.get(best)) best = id;
    return best;
  };
};
