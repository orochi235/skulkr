/**
 * `skulkr init`: a starter `skulkr.config.mjs` for the repository in the working directory, guessed from its tracked
 * files and its package.json scripts. Every guess is a line to check, not a decision.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { CONFIG_FILE } from './config.mjs';

/** Source extensions worth auditing, in the order a config lists them. */
const SOURCE = ['ts', 'tsx', 'mts', 'js', 'jsx', 'mjs', 'py', 'go', 'rs', 'rb', 'java', 'kt', 'swift', 'c', 'cc', 'cpp', 'h', 'cs', 'php', 'css'];
/** Directories that usually hold a project's source, tried in this order. */
const ROOTS = ['src', 'lib', 'app', 'packages/*/src', 'apps/*/src', 'crates/*/src', 'cmd', 'internal', 'pkg'];

/** Top-level directories that hold source but are rarely what an audit is for. */
const NOT_ROOTS = new Set(['test', 'tests', 'spec', 'docs', 'examples', 'scripts', 'vendor', 'node_modules', 'dist', 'build', 'fixtures', 'e2e']);

const globRe = (glob) => new RegExp(`^${glob.replace(/\*/g, '[^/]+')}/`);

/** The guesses for a repository whose tracked files are `files` and whose package.json is `pkg` (or null). */
export const guessConfig = (files, pkg, name) => {
  const ext = (f) => /\.([^./]+)$/.exec(f)?.[1];
  const known = ROOTS.filter((r) => files.some((f) => globRe(r).test(f) && SOURCE.includes(ext(f))));
  // Areas are cut from directories, so with no usual root found, every top-level directory holding source is one.
  const tops = [...new Set(files.filter((f) => f.includes('/') && SOURCE.includes(ext(f))).map((f) => f.split('/')[0]))]
    .filter((d) => !NOT_ROOTS.has(d) && !d.startsWith('.')).sort();
  const roots = known.length ? known : tops;
  const under = roots.length ? files.filter((f) => roots.some((r) => globRe(r).test(f))) : files;
  const counts = new Map();
  for (const f of under) if (SOURCE.includes(ext(f))) counts.set(ext(f), (counts.get(ext(f)) ?? 0) + 1);
  const extensions = SOURCE.filter((e) => (counts.get(e) ?? 0) > 0);
  const scripts = pkg?.scripts ?? {};
  const lock = ['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock'].find((l) => files.includes(l));
  const install = { 'package-lock.json': 'npm ci --no-audit --no-fund', 'pnpm-lock.yaml': 'pnpm install --frozen-lockfile', 'yarn.lock': 'yarn install --frozen-lockfile' }[lock];
  return {
    name,
    roots: roots.length ? roots : ['src'],
    extensions: extensions.length ? extensions : ['ts', 'js'],
    gate: scripts.test ? ['npm', 'test'] : null,
    typecheck: scripts.typecheck ? 'npm run typecheck' : null,
    lint: scripts.lint ? 'npm run lint' : null,
    vitest: Boolean(pkg?.devDependencies?.vitest ?? pkg?.dependencies?.vitest),
    install: lock ? { lockfile: lock, command: install } : null,
  };
};

/** The gate written when no test script was found: it fails, so no batch merges untested until it is replaced. */
export const NO_GATE = ['sh', '-c', 'echo "skulkr: no gate command set; name your test command in skulkr.config.mjs gate.command" >&2; exit 1'];

/** `v` as config source: single-quoted strings, spaced arrays and objects, bare keys. */
const js = (v) => {
  if (Array.isArray(v)) return `[${v.map(js).join(', ')}]`;
  if (v && typeof v === 'object') return `{ ${Object.entries(v).map(([k, x]) => `${k}: ${js(x)}`).join(', ')} }`;
  return typeof v === 'string' ? `'${v.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'` : String(v);
};

/** The config file's text for `g`, the guesses. */
export const configText = (g) => `// skulkr's config for ${g.name}: README.md in the skulkr checkout says what each setting does.
// Every value here was guessed by \`skulkr init\`; check each one, then run \`skulkr partition\` and \`skulkr night --dry\`.
export default {
  name: ${js(g.name)},

  partition: {
    roots: ${js(g.roots)},
    extensions: ${js(g.extensions)},
  },

  // How a batch of fixes is tested before main moves; it runs in the batch's worktree.
  gate: { name: 'test', command: ${g.gate ? js(g.gate) : `${js(NO_GATE)} /* no test script found: name your test command */`} },

  checks: {
    test: ${js(g.vitest ? 'npx vitest run <file>' : 'npm test -- <file>')},
    typecheck: ${js(g.typecheck ?? 'npm run typecheck --if-present')},
    lint: ${js(g.lint ?? 'npm run lint --if-present')},${g.vitest ? `
    // skulkr runs this itself over each fixer's changed files, rather than taking the fixer's word for it.
    verify: { command: 'npx vitest related --run {files}' },` : ''}
  },

  setup: {
    install: ${g.install ? js(g.install) : 'null'},
  },

  // Whether a green round's main is pushed to origin once it lands; false leaves pushing to you.
  git: { push: true },

  // Every job runs on this machine. Fixers run with permissions bypassed, in clones under skulkr's state directory.
  runner: 'local',

  // List-price dollars: each job's ceiling, and one run's cap.
  areasPerRound: 4,
  budget: { review: 8, match: 1, fix: 15, capUsd: 40 },
};
`;

/** Writes the starter config in `cwd`; refuses to overwrite one. Answers its path. */
export const initCommand = (cwd = process.cwd()) => {
  const top = execFileSync('git', ['-C', cwd, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
  const path = join(top, CONFIG_FILE);
  if (existsSync(path)) throw new Error(`${path} already exists`);
  const files = execFileSync('git', ['-C', top, 'ls-files'], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }).split('\n').filter(Boolean);
  const pkgPath = join(top, 'package.json');
  const pkg = existsSync(pkgPath) ? JSON.parse(readFileSync(pkgPath, 'utf8')) : null;
  writeFileSync(path, configText(guessConfig(files, pkg, basename(top).toLowerCase().replace(/[^a-z0-9-]+/g, '-'))));
  return path;
};
