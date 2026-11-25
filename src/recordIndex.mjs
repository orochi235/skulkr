/**
 * The query index: `<record.dir>/cache/skulkr.db`, a SQLite database built from the committed record (the partition,
 * every round's area records and job usage, the landed saturation ledgers, and the defect registry), never edited, and
 * built again whenever the record differs from what it was built from. `skulkr q` queries it. README.md, "The index",
 * is its documentation, with its tables.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { diskRecords } from './recordFiles.mjs';
import { readRegistry } from './registry.mjs';
import { landedLedgersUnder } from './scourPaths.mjs';

/** Bumped when the tables change, so an index built by an older skulkr is built again. */
const SCHEMA = 1;

const TABLES = `
create table meta (key text primary key, value text);
create table areas (id text primary key, files integer);
create table files (path text primary key, area text);
create table defects (id text primary key, area text, claim text, "where" text, severity text, status text,
  verdict text, resolved_round integer, resolved_area text, resolved_sha text,
  first_round integer, first_ledger text, first_commit text, first_date text);
create table defect_files (defect text, path text);
create table sightings (defect text, round integer, area text, reviewer text, ledger text, ledger_defect text,
  occasions integer, sources text);
create table passes (round integer, area text, files integer, a integer, b integer, shared integer, "distinct" integer,
  chapman real, unfound real, patches integer, questions integer, cost_usd real, "commit" text, date text);
create table jobs (round integer, area text, role text, node text, model text, cost_usd real, weighted_tokens integer,
  duration_ms integer, turns integer);
create table ledgers (key text primary key, area text, "commit" text, files integer, occasions integer, "distinct" integer);
create table occasions (ledger text, n integer, source text, kind text, findings integer, cost_usd real, minutes real, at text);
create index sightings_defect on sightings (defect);
create index sightings_ledger on sightings (ledger, ledger_defect);
create index defects_area on defects (area, status);
`;

/** Where the index lives under `root`. */
export const indexPathOf = (cfg, root) => join(root, cfg.record.dir, 'cache', 'skulkr.db');

/** What the index is built from, as one string: the committed record's tree, any change to it not yet committed, and the schema. */
export const stampOf = (cfg, git) => {
  let tree = '';
  try {
    tree = git('rev-parse', `HEAD:${cfg.record.dir}`);
  } catch { /* no record committed yet */ }
  // The index's own directory is left out where no `.gitignore` keeps it out of the status.
  const changes = git('status', '--porcelain', '--untracked-files=all', '--', cfg.record.dir, `:(exclude)${cfg.record.dir}/cache`);
  return `${SCHEMA} ${tree} ${createHash('sha1').update(changes).digest('hex')}`;
};

const readJsonl = (text) => (text ?? '').split('\n').filter(Boolean).flatMap((line) => {
  try {
    return [JSON.parse(line)];
  } catch {
    return [];
  }
});

/** Fills `db`'s tables from the record under `root`. */
const fill = (cfg, root, db) => {
  const insert = (table, row) => {
    const keys = Object.keys(row);
    db.prepare(`insert into ${table} (${keys.map((k) => `"${k}"`).join(', ')}) values (${keys.map(() => '?').join(', ')})`)
      .run(...keys.map((k) => (row[k] === undefined ? null : row[k])));
  };
  const partition = join(root, cfg.partition.path);
  for (const area of existsSync(partition) ? JSON.parse(readFileSync(partition, 'utf8')) : []) {
    insert('areas', { id: area.id, files: area.files.length });
    for (const path of area.files) insert('files', { path, area: area.id });
  }
  const rounds = new Set();
  for (const rec of diskRecords(root, cfg.record.dir)) {
    const a = JSON.parse(rec.read('area.json'));
    insert('passes', {
      round: rec.round, area: rec.id, files: a.files?.length, a: a.a, b: a.b, shared: a.m, distinct: a.distinct, chapman: a.chapman,
      unfound: a.unfound, patches: a.patches, questions: a.questions, cost_usd: a.jobs?.costUsd, commit: a.commit, date: a.date,
    });
    rounds.add(rec.round);
  }
  for (const round of rounds) {
    const usage = join(root, cfg.record.dir, `round-${round}`, 'usage.jsonl');
    for (const j of readJsonl(existsSync(usage) ? readFileSync(usage, 'utf8') : '')) {
      insert('jobs', {
        round, area: j.area, role: j.role, node: j.node, model: j.models?.join(','), cost_usd: j.costUsd,
        weighted_tokens: j.weightedTokens, duration_ms: j.durationMs, turns: j.turns,
      });
    }
  }
  for (const { short, ledger: l } of landedLedgersUnder(cfg, root)) {
    const key = `${l.area}@${short}`;
    insert('ledgers', { key, area: l.area, commit: l.commit, files: l.files.length, occasions: l.occasions.length, distinct: l.defects.length });
    for (const o of l.occasions) {
      insert('occasions', { ledger: key, n: o.n, source: o.source, kind: o.kind, findings: o.findings, cost_usd: o.costUsd, minutes: o.minutes, at: o.at });
    }
  }
  for (const d of readRegistry(cfg, root)) {
    insert('defects', {
      id: d.id, area: d.area, claim: d.claim, where: d.where, severity: d.severity, status: d.status, verdict: d.resolved?.verdict,
      resolved_round: d.resolved?.round, resolved_area: d.resolved?.area, resolved_sha: d.resolved?.sha,
      first_round: d.first?.round, first_ledger: d.first?.ledger, first_commit: d.first?.commit, first_date: d.first?.date,
    });
    for (const path of d.files ?? []) insert('defect_files', { defect: d.id, path });
    for (const s of d.sightings ?? []) {
      insert('sightings', {
        defect: d.id, round: s.round, area: s.area, reviewer: s.from, ledger: s.ledger, ledger_defect: s.defect,
        occasions: s.occasions?.length, sources: s.sources?.join(','),
      });
    }
  }
};

/**
 * The index for the record under `root`, open, built first when missing or built from anything else. The caller
 * closes it.
 */
export const openIndex = (cfg, git, root) => {
  const path = indexPathOf(cfg, root);
  const stamp = stampOf(cfg, git);
  if (existsSync(path)) {
    const db = new DatabaseSync(path);
    try {
      if (db.prepare('select value from meta where key = ?').get('stamp')?.value === stamp) return db;
    } catch { /* not an index this skulkr built */ }
    db.close();
  }
  mkdirSync(join(root, cfg.record.dir, 'cache'), { recursive: true });
  const building = `${path}.${process.pid}.tmp`;
  rmSync(building, { force: true });
  const db = new DatabaseSync(building);
  db.exec(TABLES);
  db.exec('begin');
  fill(cfg, root, db);
  db.prepare('insert into meta (key, value) values (?, ?)').run('stamp', stamp);
  db.exec('commit');
  db.close();
  renameSync(building, path);
  return new DatabaseSync(path);
};

/** Runs `sql` on the index of the record under `root`; answers its rows. */
export const queryIndex = (cfg, git, root, sql, params = []) => {
  const db = openIndex(cfg, git, root);
  try {
    return db.prepare(sql).all(...params).map((row) => ({ ...row }));
  } finally {
    db.close();
  }
};

/** `rows` as terminal lines: a header, then a line per row, each column padded to its widest, numbers right-aligned. */
export const rowsText = (rows) => {
  if (rows.length === 0) return ['(no rows)'];
  const keys = Object.keys(rows[0]);
  const cell = (v) => (v === null || v === undefined ? '' : String(v));
  const numeric = keys.map((k) => rows.every((r) => r[k] === null || typeof r[k] === 'number'));
  const width = keys.map((k) => Math.max(k.length, ...rows.map((r) => cell(r[k]).length)));
  const line = (vals) => vals.map((v, i) => (numeric[i] ? v.padStart(width[i]) : v.padEnd(width[i]))).join('  ').trimEnd();
  return [line(keys), ...rows.map((r) => line(keys.map((k) => cell(r[k]))))];
};
