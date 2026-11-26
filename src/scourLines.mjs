/** How many lines a scour ledger's area holds at its frozen commit: README "Scour", "Per thousand lines". */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ledgerDirOf } from './ledger.mjs';

/** The lines of `files` at `commit` in the repository at `root`, read in one `git cat-file --batch`. */
export const linesAt = (root, commit, files) => {
  if (!files.length) return 0;
  const out = execFileSync('git', ['cat-file', '--batch'], {
    cwd: root, input: files.map((f) => `${commit}:${f}\n`).join(''), maxBuffer: 1 << 30,
  });
  let lines = 0;
  let at = 0;
  while (at < out.length) {
    const eol = out.indexOf(10, at);
    const header = out.subarray(at, eol).toString();
    at = eol + 1;
    if (header.endsWith(' missing')) continue;
    const [, type, sizeText] = header.split(' ');
    const size = Number(sizeText);
    const body = out.subarray(at, at + size);
    at += size + 1;
    if (type !== 'blob') continue;
    for (let i = 0; i < body.length; i++) if (body[i] === 10) lines += 1;
    if (size > 0 && body[size - 1] !== 10) lines += 1;
  }
  return lines;
};

/**
 * The lines `ledger`'s area holds at its commit: the ledger's own `lines`, else the count kept beside it in
 * `lines.json`, else counted under `root` and kept there; undefined with no `root` to count in.
 */
export const ledgerLinesOf = (cfg, root, ledger, id = ledger.area) => {
  if (ledger.lines !== undefined) return ledger.lines;
  const path = join(ledgerDirOf(cfg, id), 'lines.json');
  if (existsSync(path)) {
    try {
      const kept = JSON.parse(readFileSync(path, 'utf8'));
      if (kept.commit === ledger.commit && kept.files === ledger.files.length) return kept.lines;
    } catch { /* counted again below */ }
  }
  if (!root) return undefined;
  let lines;
  try {
    lines = linesAt(root, ledger.commit, ledger.files);
  } catch {
    return undefined;
  }
  writeFileSync(path, `${JSON.stringify({ commit: ledger.commit, files: ledger.files.length, lines })}\n`);
  return lines;
};

/** `n` per thousand of `lines`; null where either is missing. */
export const perKloc = (n, lines) => (n === null || n === undefined || !lines ? null : (n * 1000) / lines);
