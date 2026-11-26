/** Scratch projects and a fake runner for scour's tests. */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach } from 'vitest';
import { resolveConfig } from './config.mjs';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
export const scratch = () => {
  const d = mkdtempSync(join(tmpdir(), 'skulkr-sat-'));
  dirs.push(d);
  return d;
};

/**
 * A project repository on `main` with an area per name in `areas` (`src` alone by default), each a directory holding
 * one file, and a config whose state is a scratch directory.
 */
export const project = (areas: string[] = ['src']) => {
  const root = scratch();
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  git('init', '-q', '-b', 'main');
  for (const a of areas) {
    mkdirSync(join(root, a));
    writeFileSync(join(root, a, 'x.ts'), 'export const x = 1;\n');
  }
  git('add', '.');
  git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'init');
  const partition = areas.length > 1 ? { partition: { roots: areas, minFiles: 1 } } : {};
  // Each area is one line, so the fix trigger (known defects per thousand lines) would stop every ledger at its fifth pass.
  const cfg = resolveConfig({ name: 'proj', state: scratch(), root, ...partition, saturate: { fixAtKnownPerKloc: null } }, { root });
  return { root, cfg, git };
};

const reportOf = (claims: string[]) => `${claims.map((c) => `## ${c}\n- where: src/x.ts:1\n`).join('\n')}\n## Files read\n- src/x.ts\n\n<!-- done: ${claims.length} findings -->\n`;
const envelope = (result: string, cost: number, usage?: object) => JSON.stringify({ type: 'result', is_error: false, result, total_cost_usd: cost, ...(usage ? { usage, modelUsage: { 'claude-opus-5-5': {} } } : {}) });

/**
 * A runner that answers each review, $0.50 each, with the next occasion's claims from `seen`, and each ledger match,
 * $0.10, by reading its prompt and pairing equal claims, as a model would; `matchReply` overrides the matcher's answer.
 */
export const fakeRunner = (seen: string[][], { matchReply, usage }: { matchReply?: () => string; usage?: object } = {}) => {
  let review = 0;
  const tasks: string[] = [];
  const run = async (job: { to: string; task: string; shell: string }, { cwd }: { cwd: string }) => {
    tasks.push(job.task);
    mkdirSync(job.to, { recursive: true });
    writeFileSync(join(job.to, 'exit'), '0');
    if (/-match\d$/.test(job.task)) {
      const area = /^proj-saturate-(.+?)-\d+-/.exec(job.task)![1];
      const prompt = readFileSync(join(cwd, `.skulkr/in/${area}/ledger-match.md`), 'utf8');
      const ledger = new Map([...prompt.matchAll(/^(D\d+)\. (.+)$/gm)].map((m) => [m[2], m[1]]));
      const whole = /# The new report, whole/.test(prompt);
      const claims = whole ? [...prompt.matchAll(/^## (.+)$/gm)].map((m) => m[1]).filter((c) => c !== 'Files read') : [...prompt.matchAll(/^(\d+)\. (.+)$/gm)].map((m) => m[2]);
      const reply = {
        ...(whole ? { findings: claims.map((claim) => ({ claim, where: 'src/x.ts:1' })) } : {}),
        sightings: claims.flatMap((c, i) => (ledger.has(c) ? [{ finding: i, defect: ledger.get(c) }] : [])),
        new: claims.flatMap((c, i) => (ledger.has(c) ? [] : [{ finding: i, claim: c, where: 'src/x.ts:1', severity: 'low' }])),
      };
      writeFileSync(join(job.to, 'claude.json'), JSON.stringify({ type: 'result', is_error: false, result: matchReply?.() ?? JSON.stringify(reply), total_cost_usd: 0.1, modelUsage: { 'claude-opus-5-5': {} } }));
    } else {
      const text = reportOf(seen[review++] ?? []);
      writeFileSync(join(job.to, 'findings.md'), text);
      writeFileSync(join(job.to, 'claude.json'), envelope(text, 0.5, usage));
    }
    return { status: 0 };
  };
  return { run, unavailableNodes: () => new Set(), jobs: () => [], tasks };
};
