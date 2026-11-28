#!/usr/bin/env node
/**
 * Rereads a landed fix run's unread verdicts (null: the fixer's report gave no line) from its batches' commits'
 * `Defect:` trailers, in the state record and the project's committed copy, then rewrites the project's defect
 * registry and commits both on its `main`. For runs recorded before 5c9b55d, whose woken fixers lost their reports.
 * Usage: node scripts/fixUnreadVerdicts.mjs <run>… [--dry]
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig } from '../src/config.mjs';
import { gitIn } from '../src/batch.mjs';
import { writeRegistry } from '../src/registry.mjs';
import { scourStateDirOf } from '../src/scourPaths.mjs';
import { trailerFixesOf, withTrailersRead } from '../src/scourReverts.mjs';

const args = process.argv.slice(2);
if (args.includes('-h') || args.includes('--help')) { console.log('usage: node scripts/fixUnreadVerdicts.mjs <run>… [--dry]'); process.exit(0); }
const dry = args.includes('--dry');
const runs = args.filter((a) => a !== '--dry').map(Number);
if (!runs.length || runs.some((n) => !Number.isInteger(n) || n < 1)) throw new Error('give fix run numbers');
const cfg = await loadConfig({ config: join(import.meta.dirname, '../examples/weasel.config.mjs') });
const root = cfg.root;
const git = gitIn(root);
const changed = [];
for (const n of runs) {
  const dir = join(scourStateDirOf(cfg), `fix-${n}`);
  const record = JSON.parse(readFileSync(join(dir, 'record.json'), 'utf8'));
  if (!record.finished) throw new Error(`fix ${n} has not finished`);
  for (const b of record.batches) {
    const mbox = join(dir, 'jobs', `${record.area}~b${b.n}`, 'fix', 'fix.mbox');
    const fixes = existsSync(mbox) ? trailerFixesOf(readFileSync(mbox, 'utf8')) : new Map();
    const before = b.verdicts.filter((v) => !v.verdict).map((v) => v.id);
    b.verdicts = withTrailersRead(b.verdicts, fixes);
    const read = before.filter((id) => b.verdicts.find((v) => v.id === id)?.verdict);
    if (before.length) console.log(`fix ${n} b${b.n}: ${read.length} of ${before.length} unread now fixed (${read.join(' ')})`);
  }
  if (dry) continue;
  const text = `${JSON.stringify(record, null, 1)}\n`;
  writeFileSync(join(dir, 'record.json'), text);
  const landed = join(root, cfg.record.dir, 'scour', `fix-${n}`, 'record.json');
  if (existsSync(landed)) { writeFileSync(landed, text); changed.push(landed); }
}
if (!dry && changed.length) {
  if (git('rev-parse', '--abbrev-ref', 'HEAD') !== 'main') throw new Error(`${root} is not on main`);
  git('add', '--', ...changed, writeRegistry(cfg, git, root));
  git('commit', '-m', `read scour fix ${runs.join(', ')}'s unread verdicts from their commits' trailers`);
  console.log(`committed ${git('rev-parse', '--short=10', 'HEAD')} in ${root}`);
}
