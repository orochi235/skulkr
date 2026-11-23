import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { gitIn } from './batch.mjs';
import { resolveConfig } from './config.mjs';
import { failureKeysIn, mainRedText, preflightShell, runPreflight, testChecked, testsToRerun, withoutKeys } from './preflight.mjs';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const temp = () => {
  const d = mkdtempSync(join(tmpdir(), 'skulkr-preflight-'));
  dirs.push(d);
  return d;
};
const cfg = resolveConfig({ gate: { failPrefix: 'fleet-fail:' }, checks: { preflight: { command: 'npm run checks {tests}' } } });
const LOG = [
  'fleet-fail: gate scripts/ci-checks.gate.ts :: the checks > npm run lint -w @x/labkit',
  'fleet-fail: core a/x.test.ts :: adds',
  ' FAIL  core  a/x.test.ts > adds',
  'fleet-fail: core a/x.test.ts :: adds',
].join('\n');

describe('failureKeysIn and withoutKeys', () => {
  it("name each failure line once, and drop only the shared ones from the log a repair reads", () => {
    expect(failureKeysIn(LOG, cfg.gate)).toEqual(['gate scripts/ci-checks.gate.ts :: the checks > npm run lint -w @x/labkit', 'core a/x.test.ts :: adds']);
    const path = join(temp(), 'red.log');
    writeFileSync(path, LOG);
    const own = withoutKeys(path, ['gate scripts/ci-checks.gate.ts :: the checks > npm run lint -w @x/labkit'], cfg.gate);
    expect(failureKeysIn(readFileSync(own, 'utf8'), cfg.gate)).toEqual(['core a/x.test.ts :: adds']);
    expect(readFileSync(own, 'utf8')).toContain(' FAIL  core  a/x.test.ts > adds');
  });
});

describe('testChecked', () => {
  const red = (dir: string, text: string) => {
    const log = join(dir, 'pre.log');
    writeFileSync(log, text);
    return log;
  };
  const run = async (pre: object, onMain: object | null, gateReport?: string) => {
    const said: string[] = [];
    const extras: string[][] = [];
    const got = await testChecked({
      cfg, batch: { name: 'batch/x', tree: '/t' }, tip: 'a'.repeat(40), tag: '', say: (l: string) => said.push(l),
      checks: { preflight: async () => pre, onMain: async () => onMain, gateArgs: ['--no-checks'] },
      gate: async (extra: string[]) => (extras.push(extra), gateReport ? { report: gateReport, log: (pre as { log: string }).log } : { tip: 'b' }),
    });
    return { got, said, extras };
  };

  it('goes on to the gate, told the checks ran, when every preflight failure is one main has', async () => {
    const log = red(temp(), 'fleet-fail: gate s.gate.ts :: lint\n');
    const shared = { tip: 'm', keys: ['gate s.gate.ts :: lint'], where: ['s.gate.ts'] };
    const { got, extras, said } = await run({ ok: false, unrun: false, log }, shared);
    expect(extras).toEqual([['--no-checks']]);
    expect(got).toMatchObject({ tip: 'b', onMain: shared });
    expect(said).toContain("preflight: every failure fails on main's tip too; the gate runs the tests");
  });

  it("answers a red preflight with the batch's own failures, and runs no gate", async () => {
    const log = red(temp(), 'fleet-fail: gate s.gate.ts :: lint\nfleet-fail: gate s.gate.ts :: typecheck\n');
    const { got, extras } = await run({ ok: false, unrun: false, log }, { tip: 'm', keys: ['gate s.gate.ts :: lint'], where: ['s.gate.ts'] });
    expect(extras).toEqual([]);
    expect(got.report).toMatch(/^red: the preflight failed on batch\/x/);
    expect(failureKeysIn(readFileSync(got.own, 'utf8'), cfg.gate)).toEqual(['gate s.gate.ts :: typecheck']);
  });

  it("checks a red gate's failures on main, and leaves the checks to a gate whose preflight gave no verdict", async () => {
    const log = red(temp(), 'fleet-fail: core a.test.ts :: t\n');
    const { got, extras } = await run({ ok: false, unrun: true, log }, { tip: 'm', keys: ['core a.test.ts :: t'], where: ['a.test.ts'] }, 'red: x');
    expect(extras).toEqual([[]]);
    expect(failureKeysIn(readFileSync(got.own, 'utf8'), cfg.gate)).toEqual([]);
  });
});

describe('mainRedText', () => {
  it('names each failure with the commit that last touched it', () => {
    const root = temp();
    const git = gitIn(root);
    git('init', '-q', '-b', 'main');
    writeFileSync(join(root, 'a.test.ts'), 'x');
    git('add', '.');
    git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'break a');
    const tip = git('rev-parse', 'HEAD');
    const text = mainRedText(cfg, root, { tip, keys: ['core a.test.ts :: t'], where: ['a.test.ts'] }, '');
    expect(text).toBe(`main red at ${tip.slice(0, 10)}: 1 failures it has too (a.test.ts, last touched by ${tip.slice(0, 7)} break a)`);
  });
});

describe('preflightShell', () => {
  it('readies the tree as a fixer does and runs the command over $PREFLIGHT_TESTS, writing a verdict', () => {
    const shell = preflightShell(cfg);
    expect(shell).toContain('$FROZEN_TREE');
    expect(shell).toContain("bash -c 'npm run checks $PREFLIGHT_TESTS' > .skulkr/out/verify.log 2>&1; echo $? > .skulkr/out/verify.exit");
  });
});

describe('testsToRerun', () => {
  it("splits a red log's failing test files by the project on their line", () => {
    const gui = resolveConfig({ gate: { failPrefix: 'fleet-fail:' }, checks: { preflight: { command: 'c', gui: { command: 'g', project: '^browser' } } } });
    const log = [
      'fleet-fail: browser:chromium a/L.browser.test.tsx :: closes',
      'fleet-fail: core a/x.test.ts :: adds',
      'fleet-fail: gate scripts/ci-checks.gate.ts :: npm run lint',
      'fleet-fail: postbuild check:unnameable',
    ].join('\n');
    expect(testsToRerun(log, gui)).toEqual({ plain: ['a/x.test.ts'], gui: ['a/L.browser.test.tsx'] });
    expect(testsToRerun(log, cfg)).toEqual({ plain: ['a/L.browser.test.tsx', 'a/x.test.ts'], gui: [] });
  });
});

describe('runPreflight', () => {
  it('runs its GUI part beside the checks, not after them, and reads both', async () => {
    const root = temp();
    const git = gitIn(root);
    git('init', '-q', '-b', 'main');
    git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'base');
    git('update-ref', 'refs/remotes/origin/main', 'HEAD');
    const gui = resolveConfig({ gate: { failPrefix: 'fleet-fail:' }, checks: { preflight: { command: 'c {tests}', gui: { command: 'g {tests}', project: '^browser' } } } });
    const running: string[] = [];
    let together = 0;
    const ctx = {
      cfg: gui, root, round: 7, nightDir: temp(), say: () => {}, refuse: () => {}, usage: () => {},
      acquire: async () => ({ node: 'n', release: () => {} }),
      runner: {
        run: async (job: { to: string; gui?: boolean }) => {
          running.push(job.to);
          together = Math.max(together, running.length);
          await new Promise((r) => setTimeout(r, 20));
          running.splice(running.indexOf(job.to), 1);
          mkdirSync(job.to, { recursive: true });
          writeFileSync(join(job.to, 'verify.exit'), job.gui ? '1' : '0');
          writeFileSync(join(job.to, 'verify.log'), job.gui ? 'fleet-fail: browser:chromium a/L.browser.test.tsx :: closes\n' : 'ok\n');
          return { status: 0 };
        },
      },
    };
    const got = await runPreflight(ctx, { tree: root, commit: git('rev-parse', 'HEAD'), tests: { plain: [], gui: ['a/L.browser.test.tsx'] }, label: 'pre' });
    expect(together).toBe(2);
    expect(got).toMatchObject({ ok: false, unrun: false });
    expect(readFileSync(got.log, 'utf8')).toContain('a/L.browser.test.tsx :: closes');
  });
});
