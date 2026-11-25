/**
 * Which findings, over every round's record and the landed saturation ledgers, are one defect, and what became of
 * each: the one rule carry, the registry and the dashboard all go by. A finding is the same defect as an earlier one
 * when they cite a common file and their claims are alike (`SAME_LIKENESS`); a fixer acted on a defect when its report
 * names the finding's id or answers its claim. README.md, "Carried findings" and "The defect registry", is its
 * documentation.
 */
import { SAME_LIKENESS, VERDICT_LIKENESS, fixOf, givenIn, likeness, pathsOf } from './carry.mjs';
import { parseSections, severityOf } from './findings.mjs';
import { triageFieldsOf } from './triageFields.mjs';

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Whether `text` names `id`: a bare `r56-2` only where no area qualifies it, as `x/r56-2` does. */
const names = (text, id) => new RegExp(`(?<![\\w./-])${escape(id)}(?![\\w-])`).test(text);

/** Whether `fix` gives a verdict line like `finding`'s claim, or commits a subject like it. */
const answers = (fix, finding) => [...fix.items.map((i) => i.claim), ...fix.subjects]
  .some((c) => likeness(c, finding.claim) >= VERDICT_LIKENESS);

/** Whether `fix` acted on `finding`, which it was handed: names its id, or answers its claim. */
const actsOn = (fix, finding) => (finding.id && names(fix.text, finding.id)) || answers(fix, finding);

/** The verdict line of `fix` most like `finding`'s claim, when one is like enough: `{ verdict, sha }`, else nulls. */
const verdictFor = (fix, finding) => {
  let best = null;
  let score = VERDICT_LIKENESS;
  for (const item of fix.items) {
    const s = likeness(item.claim, finding.claim);
    if (s >= score) [best, score] = [item, s];
  }
  return { verdict: best?.verdict ?? null, sha: best?.shas?.[0] ?? null };
};

/**
 * The id finding `o` goes by when listed under area `to`: qualified by the area that reported it when that is not
 * `to`, since every area audited in a round has its own `r<round>-1`.
 */
export const idUnder = (o, to) => (to === o.area ? o.id : `${o.area}/${o.id}`);
const QUALIFIED = /^(.+)\/(r\d+-\d+)$/;

const sameDefect = (open, finding, cited) => {
  const paths = pathsOf(finding.where, cited);
  const shared = paths.length === 0 || open.paths.length === 0 || paths.some((p) => open.paths.includes(p));
  return shared && likeness(open.claim, finding.claim) >= SAME_LIKENESS;
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

/** Each finding's severity in `rec`'s reports, by claim. */
const severitiesIn = (rec) => new Map(['A', 'B'].flatMap((side) => parseSections(rec[side] ?? '').map((f) => [f.claim, severityOf(f)])));

/**
 * Every defect `records` (`{ round, id, match, A, B, fix, area, carried, subjects }`, any order) and `ledgers` report.
 * Each is `{ id, area, to, claim, where, from, severity, round, rounds, paths, acted, resolved, first, saturation }`:
 * `round` the first round that reported it (null for one only a saturation ledger did), `rounds` every round that did,
 * `to` the area of `areas` (the partition now) holding its cited paths, `acted` whether a fixer acted on it since it was
 * last reported, `resolved` `{ round, area, verdict, sha }` for the fixer that did, and `saturation` the ledger
 * defects that are this one (`{ ledger, defect, occasions, sources }`).
 *
 * A ledger (`{ key, area, commit, before, defects }`, `before` the first round reviewed at or after its commit) is read
 * ahead of that round. A round finding like one of its defects takes the defect over, and a fixer's words close one,
 * but a defect only a ledger reported is never handed to a fixer nor counted among a fixer's findings, so with or
 * without ledgers the round defects come out the same.
 */
export const defectGraphOf = (records, { cited, areas, ledgers = /** @type {any[]} */ ([]) } = {}) => {
  const holder = areas && createHolderLookup(areas);
  const filesOf = (rec) => rec.files ?? rec.area?.files;
  const roundAreas = new Map();
  for (const rec of records) {
    if (!filesOf(rec)) continue;
    if (!roundAreas.has(rec.round)) roundAreas.set(rec.round, []);
    roundAreas.get(rec.round).push({ id: rec.id, files: filesOf(rec) });
  }
  const roundHolders = new Map([...roundAreas].map(([round, list]) => [round, createHolderLookup(list)]));
  const byArea = new Map();
  const all = [];
  // Defects only a ledger reported, kept apart so no round's matching or count sees them.
  const unclaimed = [];
  const heldIn = (rec) => (filesOf(rec) ? roundHolders.get(rec.round) : (paths, o) => o.to);
  /** An area's findings in `rec`'s round: those it reported, then those reported elsewhere that its files held. */
  const viewOf = (rec) => {
    const held = heldIn(rec);
    return [...byArea.get(rec.id), ...all.filter((o) => o.area !== rec.id && held(o.paths, o) === rec.id)];
  };
  const pending = [...ledgers].sort((x, y) => x.before - y.before);
  const readLedgers = (upTo) => {
    while (pending.length && pending[0].before <= upTo) {
      const ledger = pending.shift();
      for (const d of ledger.defects) {
        const sighting = { ledger: ledger.key, defect: d.id, occasions: d.sightings, sources: Object.keys(d.sources ?? {}).filter((s) => d.sources[s].length) };
        // Within its own area only: a ledger's `where` may name a bare file, which shares a path with anything.
        const known = all.find((o) => !o.acted && (o.area === ledger.area || o.to === ledger.area) && sameDefect(o, d, cited));
        if (known) {
          known.saturation.push(sighting);
          known.triage ??= triageFieldsOf(d);
          continue;
        }
        const paths = pathsOf(d.where, cited);
        unclaimed.push({
          id: `${ledger.key}/${d.id}`, area: ledger.area, to: holder?.(paths) ?? ledger.area, claim: d.claim, where: d.where, from: 'saturation',
          severity: d.severity ?? '', round: null, rounds: [], paths, acted: false, resolved: null,
          first: { ledger: ledger.key, commit: ledger.commit }, saturation: [sighting], triage: triageFieldsOf(d),
        });
      }
    }
  };
  const resolve = (o, rec, fix) => {
    o.acted = true;
    o.resolved = { round: rec.round, area: rec.id, ...verdictFor(fix, o) };
  };
  for (const rec of [...records].sort((x, y) => x.round - y.round)) {
    readLedgers(rec.round);
    const list = byArea.get(rec.id) ?? [];
    byArea.set(rec.id, list);
    const view = viewOf(rec);
    const held = heldIn(rec);
    const severity = severitiesIn(rec);
    const { fresh, carried } = givenIn(rec);
    const given = [];
    for (const f of fresh) {
      let known = view.find((o) => sameDefect(o, f, cited));
      if (known) {
        known.rounds.push(rec.round);
        known.acted = false;
        known.resolved = null;
        given.push({ ...known, claim: f.claim, id: f.id, known });
      } else {
        const paths = pathsOf(f.where, cited);
        known = {
          id: f.id, area: rec.id, to: holder?.(paths) ?? rec.id, claim: f.claim, where: f.where, from: f.from,
          severity: severity.get(f.claim) ?? '', round: rec.round, rounds: [rec.round], paths, acted: false, resolved: null,
          first: { round: rec.round, commit: rec.area?.commit ?? null, date: rec.area?.date ?? null }, saturation: [],
        };
        list.push(known);
        view.push(known);
        all.push(known);
        given.push({ ...known, known });
      }
      const ledgered = unclaimed.findIndex((o) => (o.area === rec.id || held(o.paths, o) === rec.id) && sameDefect(o, f, cited));
      if (ledgered !== -1) known.saturation.push(...unclaimed.splice(ledgered, 1)[0].saturation);
    }
    for (const c of carried) {
      // A carried id names its first area when that is not this one; a record from before that names none, so its
      // id and claim together are looked for under every area before the bare id is trusted.
      const [, area, id] = c.id.match(QUALIFIED) ?? [, rec.id, c.id];
      const known = all.find((o) => o.area === area && o.id === id && (area !== rec.id || o.claim === c.claim))
        ?? all.find((o) => o.id === id && o.claim === c.claim)
        ?? list.find((o) => o.id === id) ?? view.find((o) => sameDefect(o, c, cited));
      if (known) given.push({ ...known, id: c.id, known });
    }
    const fix = fixOf(rec);
    if (!fix.worked) continue;
    const every = fix.listed >= given.length && given.length > 0;
    for (const g of given) if (every || actsOn(fix, g)) resolve(g.known, rec, fix);
    // A finding this fixer was not handed is closed only by its words: its bare id may be another area's.
    for (const o of view) if (!o.acted && answers(fix, o)) resolve(o, rec, fix);
    for (const o of unclaimed) if (!o.acted && held(o.paths, o) === rec.id && answers(fix, o)) resolve(o, rec, fix);
  }
  readLedgers(Infinity);
  return [...all, ...unclaimed];
};

/**
 * Every area's open findings from its records, as a Map of area id to `{ id, claim, where, from, round, rounds }`,
 * oldest first: the round defects of {@link defectGraphOf} no fixer has acted on since they were last reported, each
 * listed under the area holding its cited paths. A fixer whose report gives as many verdicts as it was handed findings
 * acted on all of them; otherwise each finding is matched to its verdicts one by one. A defect only a saturation ledger
 * reported is never one: no fixer is handed those yet (2026-11-25).
 */
export const openFindings = (records, { cited, areas } = {}) => {
  const open = new Map();
  for (const { acted, paths, to, severity, resolved, first, saturation, triage, ...o } of defectGraphOf(records, { cited, areas })) {
    if (acted) continue;
    if (!open.has(to)) open.set(to, []);
    open.get(to).push({ ...o, id: idUnder(o, to) });
  }
  for (const list of open.values()) list.sort((x, y) => x.round - y.round);
  return open;
};
