import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ledgerDirOf } from './ledger.mjs';
import { ledgerLinesOf, linesAt, perKloc } from './scourLines.mjs';
import { project } from './scourTestKit.ts';

describe('linesAt', () => {
  it('counts each file\'s lines at the commit, a last line without a newline included, and skips missing files', () => {
    const { root, git } = project();
    writeFileSync(join(root, 'src/y.ts'), 'a\nb\nc');
    writeFileSync(join(root, 'src/empty.ts'), '');
    git('add', '.');
    git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'more');
    expect(linesAt(root, git('rev-parse', 'HEAD'), ['src/x.ts', 'src/y.ts', 'src/empty.ts', 'src/gone.ts'])).toBe(4);
  });
});

describe('ledgerLinesOf', () => {
  it("takes the ledger's own count, else counts once and keeps it beside the ledger for its commit", () => {
    const { root, cfg, git } = project();
    const commit = git('rev-parse', 'HEAD');
    const ledger = { area: 'src', commit, files: ['src/x.ts'], occasions: [], defects: [] };
    expect(ledgerLinesOf(cfg, root, { ...ledger, lines: 7 })).toBe(7);
    mkdirSync(ledgerDirOf(cfg, 'src'), { recursive: true });
    expect(ledgerLinesOf(cfg, root, ledger)).toBe(1);
    expect(JSON.parse(readFileSync(join(ledgerDirOf(cfg, 'src'), 'lines.json'), 'utf8'))).toEqual({ commit, files: 1, lines: 1 });
    expect(ledgerLinesOf(cfg, undefined, ledger)).toBe(1);
    expect(ledgerLinesOf(cfg, undefined, { ...ledger, commit: 'other' })).toBeUndefined();
  });
});

describe('perKloc', () => {
  it('scales to a thousand lines, and has no value without lines', () => {
    expect(perKloc(3, 1500)).toBe(2);
    expect(perKloc(3, undefined)).toBeNull();
    expect(perKloc(undefined, 1500)).toBeNull();
  });
});
