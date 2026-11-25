/**
 * A saturation ledger: one area's occasions at one frozen commit and the distinct defects they found, on disk at
 * `<state>/saturation/<area>/ledger.json`, each occasion's raw report beside it under `reviews/`. The ledger is the
 * only state; every statistic is recomputed from it (`saturation.mjs`).
 */
import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gitIn } from './batch.mjs';
import { firstJson } from './findings.mjs';
import { partitionAt } from './partition.mjs';
import { readJson, writeJson } from './json.mjs';
import { takeLease } from './lease.mjs';

/** The directory holding `area`'s ledger. */
export const ledgerDirOf = (cfg, area) => join(cfg.state, 'saturation', area);

/** `area`'s ledger, or undefined when it has none. */
export const ledgerOf = (cfg, area) => readJson(join(ledgerDirOf(cfg, area), 'ledger.json'));

/** An empty ledger for `area` at `commit` over `files`. */
export const emptyLedger = (area, commit, files) => ({ area, commit, files, occasions: [], defects: [] });

/** The full sha a new ledger freezes at: `at`, else `main`'s tip, in the checkout at `root`. */
export const freezeCommitOf = (cfg, root, at) => {
  const ref = at ?? cfg.git.main;
  try {
    return gitIn(root)('rev-parse', '--verify', '--quiet', `${ref}^{commit}`);
  } catch {
    throw new Error(`no commit ${ref} in ${root}`);
  }
};

/** `area`'s files in the partition at `commit`; throws when no area has that id there. */
export const requireAreaFilesAt = (cfg, root, area, commit) => {
  const found = partitionAt(cfg, root, commit).find((a) => a.id === area);
  if (!found) throw new Error(`no area named ${area} at ${commit.slice(0, 10)}; see ${cfg.partition.path}`);
  return found.files;
};

/**
 * Throws when an existing `ledger` is at another commit than `--at` asks for: its occasions and the new ones would
 * review different code. Starting over takes `--fresh`.
 */
export const requireSameCommit = (ledger, at, commit) => {
  if (ledger && at !== undefined && ledger.commit !== commit) {
    throw new Error(`${ledger.area}'s ledger is at ${ledger.commit.slice(0, 10)}, not ${at}; --fresh sets it aside and starts a new one there`);
  }
};

/** Writes `ledger` atomically. */
export const writeLedger = (cfg, ledger) => writeJson(join(ledgerDirOf(cfg, ledger.area), 'ledger.json'), ledger, 1);

/** Deletes `area`'s ledger directory, reviews and job outputs included. Answers whether there was one. */
export const removeLedger = (cfg, area) => {
  const dir = ledgerDirOf(cfg, area);
  const had = existsSync(dir);
  rmSync(dir, { recursive: true, force: true });
  return had;
};

/**
 * Runs `work(ledger)` with `area`'s ledger (undefined when it has none) held by this process alone, letting it go
 * however `work` ends. With `fresh`, an existing ledger is first moved aside to `<area>.<its commit>`, so `work` starts
 * a new one.
 */
export const withLedgerHeld = async (cfg, area, { fresh = false } = {}, work) => {
  const lock = () => {
    const unlock = takeLease(join(ledgerDirOf(cfg, area), 'lock'), { saturate: area });
    if (!unlock) throw new Error(`another skulkr saturate is working on ${area}`);
    return unlock;
  };
  let release = lock();
  try {
    let ledger = ledgerOf(cfg, area);
    if (ledger && fresh) {
      const aside = ledgerDirOf(cfg, `${area}.${ledger.commit.slice(0, 10)}`);
      release();
      renameSync(ledgerDirOf(cfg, area), existsSync(aside) ? `${aside}-${Date.now()}` : aside);
      release = lock();
      ledger = undefined;
    }
    return await work(ledger);
  } finally {
    release();
  }
};

/** The file an occasion's raw report is kept in, relative to the ledger's directory. */
export const reviewFileOf = (n, source) => `reviews/${String(n).padStart(2, '0')}-${source.replace(/[^\w.-]+/g, '-')}.md`;

/** Keeps `text` as occasion `n`'s raw report. Answers its path relative to the ledger's directory. */
export const keepReview = (cfg, area, n, source, text) => {
  const file = reviewFileOf(n, source);
  const path = join(ledgerDirOf(cfg, area), file);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, text);
  return file;
};

/** A finding's severity from its `severity:` line, or ''. */
export const severityOf = (finding) => /^[-*]\s*(?:\*\*)?severity(?::\*\*|\*\*:|:)\s*(\w+)/im.exec(finding.body ?? '')?.[1].toLowerCase() ?? '';

/**
 * The ledger matcher's prompt: its brief, the ledger's defects, then the new report, either as its parsed `findings`
 * numbered from 0 or, for an ingested report, as `raw` text for the matcher to enumerate.
 * @param {{ findings?: { claim: string, where: string }[], raw?: string }} report
 */
export const ledgerMatchPrompt = (brief, ledger, report) => {
  const { findings, raw } = report;
  const defects = ledger.defects.map((d) => `${d.id}. ${d.claim}\n   where: ${d.where}`).join('\n') || '(empty)';
  const body = raw !== undefined
    ? `# The new report, whole\n\nEnumerate its findings yourself and reply with \`findings\` as well.\n\n${raw}`
    : `# The new report's findings\n\n${(findings ?? []).map((f, i) => `${i}. ${f.claim}\n   where: ${f.where}`).join('\n') || '(empty)'}`;
  return `${brief}\n\n# The ledger\n\n${defects}\n\n${body}\n`;
};

/**
 * The matcher's reply, checked: `{ findings, sightings, new }`, `findings` the report's (`given`, or for an ingest, the
 * reply's own list). Each finding is accounted for once: sighting one or more ledger defects, new, or the `same` as a
 * new one before it in the report (`same`, which folds nothing further in); every defect id exists. Throws on anything
 * else.
 */
export const matchOf = (reply, ledger, given) => {
  const json = firstJson(reply);
  const findings = given ?? json.findings;
  if (!Array.isArray(findings)) throw new Error('the reply lists no `findings`');
  const n = findings.length;
  const ids = new Set(ledger.defects.map((d) => d.id));
  const sightings = Array.isArray(json.sightings) ? json.sightings : [];
  const fresh = Array.isArray(json.new) ? json.new : [];
  const index = (i, what) => {
    if (!Number.isInteger(i) || i < 0 || i >= n) throw new Error(`${what} names finding ${i}, not one of 0–${n - 1}`);
    return i;
  };
  const sighted = new Set();
  for (const s of sightings) {
    index(s.finding, 'a sighting');
    if (!ids.has(s.defect)) throw new Error(`a sighting names ${s.defect}, which the ledger does not hold`);
    sighted.add(s.finding);
  }
  const isNew = new Set();
  for (const f of fresh) {
    index(f.finding, 'a new defect');
    if (sighted.has(f.finding) || isNew.has(f.finding)) throw new Error(`finding ${f.finding} is accounted for twice`);
    if (typeof f.claim !== 'string' || !f.claim.trim()) throw new Error(`new finding ${f.finding} has no claim`);
    isNew.add(f.finding);
  }
  const same = Array.isArray(json.same) ? json.same : [];
  const repeated = new Set();
  for (const d of same) {
    index(d.finding, 'a repeat');
    if (sighted.has(d.finding) || isNew.has(d.finding) || repeated.has(d.finding)) throw new Error(`finding ${d.finding} is accounted for twice`);
    if (!isNew.has(d.as)) throw new Error(`finding ${d.finding} repeats ${d.as}, which is not a new defect`);
    repeated.add(d.finding);
  }
  const missing = findings.map((_, i) => i).filter((i) => !sighted.has(i) && !isNew.has(i) && !repeated.has(i));
  if (missing.length) throw new Error(`findings ${missing.join(', ')} are not accounted for`);
  return {
    findings: findings.map((f) => ({ claim: String(f.claim ?? ''), where: String(f.where ?? '') })),
    sightings: sightings.map((s) => ({ finding: s.finding, defect: s.defect })),
    new: fresh.map((f) => ({ finding: f.finding, claim: f.claim.trim(), where: String(f.where ?? '').trim(), severity: String(f.severity ?? '').toLowerCase() })),
  };
};

/** Every finding of a report new, for the first occasion of an empty ledger, which needs no matcher. */
export const allNew = (findings) => ({
  findings: findings.map((f) => ({ claim: f.claim, where: f.where })),
  sightings: [],
  new: findings.map((f, i) => ({ finding: i, claim: f.claim, where: f.where, severity: severityOf(f) })),
});

const nextId = (defects) => `D${defects.reduce((max, d) => Math.max(max, Number(d.id.slice(1)) || 0), 0) + 1}`;
const add = (list = [], n) => (list.includes(n) ? list : [...list, n]);

/** `ledger` with `occasion` (its `n` the next number) and what `match` says it saw folded in. */
export const withOccasion = (ledger, occasion, match) => {
  const { n, source } = occasion;
  const sighted = new Set(match.sightings.map((s) => s.defect));
  const defects = ledger.defects.map((d) => (sighted.has(d.id)
    ? { ...d, sightings: add(d.sightings, n), sources: { ...d.sources, [source]: add(d.sources?.[source], n) } }
    : d));
  for (const f of match.new) {
    defects.push({ id: nextId(defects), claim: f.claim, where: f.where, severity: f.severity, firstOccasion: n, sightings: [n], sources: { [source]: [n] } });
  }
  return { ...ledger, occasions: [...ledger.occasions, { ...occasion, findings: match.findings.length }], defects };
};
