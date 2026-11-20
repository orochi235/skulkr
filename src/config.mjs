/**
 * A project's settings: the defaults below, overlaid by the project's `skulkr.config.mjs`, and the values
 * derived from them (regular expressions, names, paths) that the rest of the pipeline reads. Nothing else
 * in `src/` holds a project-specific value. README.md "The config file" says what each setting does.
 */
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const CONFIG_FILE = 'skulkr.config.mjs';

/** Inside the frozen tree and every node tree: what a job reads, and what it hands back. */
export const JOB_IN = '.skulkr/in';
export const JOB_OUT = '.skulkr/out';

const DEFAULT_BRIEFS = new URL('../briefs/', import.meta.url);

export const DEFAULTS = {
  /** The project's short name: node tree names, the default state directory, the service's description. */
  name: undefined,
  /** The main checkout. Unset: the main worktree of the repository holding the config file. */
  root: undefined,
  /** Where runs keep their logs, claims and leases. Unset: `~/.local/state/skulkr/<name>`. */
  state: undefined,
  keepNights: 30,

  partition: {
    /** Directories areas are cut from, as globs whose `*` matches one path segment. */
    roots: ['src'],
    extensions: ['ts', 'tsx', 'mts', 'mjs', 'js', 'jsx', 'css'],
    /** Regular expressions (or strings of one) a path must not match. */
    exclude: [/\.test\.[^/]+$/, /\.d\.ts$/, /(^|\/)(fixtures|vendor|__tests__)\//],
    maxFiles: 50,
    minFiles: 10,
    /** An area's id from its directory; the default joins the path with dots. */
    areaId: (dir) => dir.replace(/\//g, '.'),
  },

  git: { main: 'main', remote: 'origin' },

  naming: {
    /** `audit` makes `audit<N>-<area>` branches and `audit<N>-<area>-<step>` job names. */
    prefix: 'audit',
    /** `batch` makes `batch/<date>-audit<N>`. */
    batchPrefix: 'batch',
  },

  record: {
    /** Where `round-<N>/` and `partition.json` are written, in the repository. */
    dir: 'docs/audits',
    /** Lines of the round README above its table; `{{commit}}` and `{{date}}` are filled in. */
    intro: [
      'Blind pairs at `{{commit}}` ({{date}}). Each area\'s directory holds its file list (`files.txt`), both',
      'reviewers\' findings (`A.md`, `B.md`), the matching (`match.json`), the fixer\'s report (`fix.md`) and the',
      'numbers below (`area.json`).',
      '',
      '"Read" is how many listed files each reviewer says it read. "Est." is Chapman\'s estimate of what the area held,',
      '"left" that less the distinct findings, and "last left" the previous pass\'s figure, which this pass tests.',
      '"New code" counts findings citing a file changed since that pass. "Commits" is what the fixer committed.',
      '"Weighted tokens" counts each kind of token at its price against an input token; "cost" is list price.',
      'One record per job is in `usage.jsonl`. The shas in `fix.md` are the fixer\'s, on its node; the same commits',
      'as applied here are `fixCommits` in `area.json`.',
    ],
    /**
     * A Markdown file with a `## <section>` table each round gets a row in, or null for none. Its text is also
     * read for round numbers already used ("round 12", "rounds 3–5").
     */
    ledger: null,
    /** Trailer lines ending the record commit's message. */
    trailer: '',
  },

  /** The commands a fixer is told to run before reporting; the default fixer brief lists them. */
  checks: {
    test: 'npm test -- <file>',
    typecheck: 'npm run typecheck --if-present',
    lint: 'npm run lint --if-present',
    /**
     * How a fixer's checks are told apart in its stream, for the progress it reports (regex sources): `test` a command
     * running one test file (group 1), `lint` a lint run (group 1, if any, the part it lints), `final` the last
     * whole check, always expected. A commit expects a test for each committed path matching `testPath`, and a lint
     * for each matching `lintOf` (group 1 its part).
     */
    tally: {
      test: String.raw`(?:\bvitest run|\bnpm (?:run )?test\s+--).*?\s([\w./@-]+\.test\.[cm]?[jt]sx?)\b`,
      testPath: String.raw`\.test\.[cm]?[jt]sx?$`,
      lint: String.raw`\bnpm run(?: -s)? lint\b`,
      lintOf: null,
      final: String.raw`\bnpm run(?: -s)? typecheck\b`,
    },
  },
  /** Project rules added to the default briefs (a string of Markdown), per brief. */
  rules: { reviewer: '', fixer: '' },
  /** Brief templates, paths relative to the config file; unset uses the shipped default. */
  briefs: { reviewer: undefined, matcher: undefined, fixer: undefined },

  /**
   * How a batch is tested. `{ref}` in the command is the batch branch; `cwd` is `root` or `batch` (its worktree).
   * `progress` names the gate's parallel runs by the prefix their `onto: progress N/M` lines carry in its log
   * (a regex source; '' for unprefixed lines), for the dashboard. `outcome` names, per run, the word its closing
   * `<word> passed|failed` line in the gate's log starts with; a run without one takes the whole gate's result.
   * `jobs` picks, per run, its runner jobs by a regex on their task names; a run without one takes the rest.
   */
  gate: { name: 'gate', command: ['npm', 'test'], cwd: 'batch', progress: { tests: '' }, outcome: {}, jobs: {} },

  /** How the fixer readies a node tree: a shell line before every job, and an install when the lockfile changes. */
  setup: {
    prelude: '',
    /** `marker` is where the installed lockfile's hash is kept; it must survive between jobs and stay out of git. */
    install: { lockfile: 'package-lock.json', command: 'npm ci --no-audit --no-fund', marker: 'node_modules/.skulkr-lock' },
  },

  /** The job runner: `'onto'`, a module path exporting `createRunner(cfg)`, or a runner object. */
  runner: 'onto',
  nodes: {
    list: [],
    /** A node that takes model jobs only inside a daily window, e.g. `{ name, from: '00:00', until: '09:00' }`. */
    local: null,
    /** Nodes fixers never run on (they run with permissions bypassed). */
    noFixers: [],
    refusedCooldownMin: 30,
    reviewSlots: 6,
    fixSlots: 6,
  },

  claude: {
    /** `CLAUDE_CONFIG_DIR` for every job, or unset for the node's default. */
    configDir: undefined,
    /** Unset: the model and effort the job's settings give, or the account's default. */
    models: { review: undefined, fix: undefined, match: 'haiku' },
    effort: { review: undefined, fix: undefined, match: undefined },
    /**
     * `--setting-sources` for every job: without `user`, the job reads none of the node account's own settings
     * (its hooks, plugins, and instructions), only the project's. Null leaves the flag off.
     */
    settingSources: 'project,local',
    timeoutMin: 45,
    /**
     * A reviewer's `--expect`, drawn only when it prints no progress of its own: weasel's rounds 38–40 ran 6.9 min
     * at p90 of `durationMs` in their `usage.jsonl`, plus the sync either side.
     */
    reviewExpect: '8m',
    reviewTools: [
      'Read', 'Grep', 'Glob',
      'Bash(git log:*)', 'Bash(git show:*)', 'Bash(git diff:*)', 'Bash(git blame:*)',
      `Write(./${JOB_OUT}/**)`, `Edit(./${JOB_OUT}/**)`,
    ],
    reviewDenied: ['Task', 'Agent'],
  },

  areasPerRound: 16,
  /**
   * List-price dollars: each job's `--max-budget-usd` by role, a run's `capUsd`, the guess at an area's cost, and
   * `nightUsd`, what continuous mode may spend from one `stopAt` to the next (unset: no continuous mode).
   */
  budget: { review: 8, match: 1, fix: 15, capUsd: 160, areaGuessUsd: 10, nightUsd: undefined },
  /**
   * Local clock times: the service starts a run at `startAt`; a run stops dispatching at the first `stopAt`.
   * `continuous` keeps rounds coming between them, under `budget.nightUsd` (README "Continuous rounds").
   */
  schedule: { startAt: '23:00', stopAt: '07:00', continuous: false },

  /** An extra check run beside the reviews whose findings go to one fixer; see README "A sweep". */
  sweep: null,
};

const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof RegExp) && Object.getPrototypeOf(v) === Object.prototype;

/** `over` laid on `base`: plain objects merge key by key; anything else, arrays included, replaces. */
export const merge = (base, over) => {
  if (!isPlain(base) || !isPlain(over)) return over === undefined ? base : over;
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) out[k] = merge(base[k], v);
  return out;
};

const escape = (s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
const globToRe = (glob) => glob.split('/').map((seg) => escape(seg).replace(/\*/g, '[^/]+')).join('/');
const toRe = (v) => (v instanceof RegExp ? v : new RegExp(v));

/** The first literal path segment of each root, for `git ls-tree` and for spotting cited paths; empty when a root has none. */
const topDirs = (roots) => {
  const tops = roots.map((r) => r.split('/')[0]);
  return tops.some((t) => t === '' || t === '.' || t.includes('*')) ? [] : [...new Set(tops)];
};

const expandHome = (p) => (p?.startsWith('~/') ? join(homedir(), p.slice(2)) : p);

/**
 * The settings a run reads: `user` (a project's config object) over the defaults, with derived values. `file` is the
 * config's path, which relative paths in it are read against; `root` overrides the config's root.
 */
export const resolveConfig = (user = {}, { file, root } = {}) => {
  const c = merge(DEFAULTS, user);
  const base = file ? dirname(file) : process.cwd();
  const name = c.name ?? 'project';
  const p = c.partition;
  const rootRe = new RegExp(`^(${p.roots.map(globToRe).join('|')})/`);
  const sourceRe = new RegExp(`\\.(${p.extensions.map(escape).join('|')})$`);
  const exclude = p.exclude.map(toRe);
  const tops = topDirs(p.roots);
  const { prefix, batchPrefix } = c.naming;
  const pre = escape(prefix);
  const briefPath = (role) => (c.briefs[role] ? resolve(base, c.briefs[role]) : new URL(`${role}.md`, DEFAULT_BRIEFS).pathname);
  return {
    ...c,
    name,
    file,
    root: root ?? (c.root ? resolve(base, expandHome(c.root)) : undefined),
    state: c.state ? resolve(base, expandHome(c.state)) : join(homedir(), '.local', 'state', 'skulkr', name),
    partition: {
      ...p,
      rootRe,
      pathspec: tops,
      path: `${c.record.dir}/partition.json`,
      isSource: (path) => rootRe.test(path) && sourceRe.test(path) && !exclude.some((re) => re.test(path)),
    },
    /** The repository paths a finding's `where` line cites. */
    citedRe: tops.length ? new RegExp(`((?:${tops.map(escape).join('|')})\\/[\\w./@-]+\\.\\w+)`, 'g') : /([\w@-][\w.@-]*\/[\w./@-]+\.\w+)/g,
    briefPath,
    gate: { ...c.gate, logSuffix: `.${c.gate.name.replace(/[^\w.-]+/g, '-')}.log` },
    names: {
      area: (round, area) => `${prefix}${round}-${area}`,
      batch: (date, round) => `${batchPrefix}/${date}-${prefix}${round}`,
      task: (round, area, step) => `${prefix}${round}-${area}-${step}`,
      frozen: (round) => `${prefix}${round}-frozen-night`,
      am: (round, area) => `${prefix}${round}-am-${area}`,
      batchTree: (date, round) => `${batchPrefix}-${date}-${prefix}${round}`,
      /** `<prefix><N>-<area>` → the area. */
      areaOf: new RegExp(`^${pre}\\d+-(.+)$`),
      /** A round number in any branch named for one: `audit30-ui`, `batch/…-audit31`. */
      roundIn: new RegExp(`(?:^|[/-])${pre}(\\d+)(?:-|$)`),
      /** A job of round `round` (any round when omitted), by its task name. */
      jobOf: (round = '\\d+') => new RegExp(`^(?:${pre}|skulkr)${round}-`),
      /** A runner job of round `round`'s batch gate, by its task name. */
      batchJobOf: (round) => new RegExp(`${escape(batchPrefix)}-\\d{4}-\\d\\d-\\d\\d-(?:${pre}|skulkr)${round}(?:-|$)`),
      /** A step's task name → `[area, step]`. */
      step: new RegExp(`^(?:${pre}|skulkr)\\d+-(.+)-(A|B|match|fix)$`),
      /** A night log's conflict line → the area. */
      conflict: new RegExp(`^batch: ${pre}\\d+-(\\S+) conflicts`),
      trees: { review: `${name}-skulkr-r`, fix: `${name}-skulkr-f` },
    },
  };
};

const minutes = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

/** Whether local time `date` falls in [from, until), a window that may wrap midnight. */
export const inWindow = (date, from, until) => {
  const now = date.getHours() * 60 + date.getMinutes();
  const [a, b] = [minutes(from), minutes(until)];
  return a <= b ? now >= a && now < b : now >= a || now < b;
};

/** The first `hh:mm` local after `from`. */
export const nextClock = (from, hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  const at = new Date(from);
  at.setHours(h, m, 0, 0);
  if (at <= from) at.setDate(at.getDate() + 1);
  return at;
};

/** The nodes a job may be offered to at `date`, before the runner's own quiet hours and availability. */
export const nodesAt = (cfg, date) => {
  const { list, local } = cfg.nodes;
  return local && inWindow(date, local.from, local.until) ? [...list, local.name] : list;
};

/** Nodes fixers never run on: the configured ones and a windowed local node unless it says otherwise. */
export const noFixers = (cfg) => [...cfg.nodes.noFixers, ...(cfg.nodes.local && !cfg.nodes.local.fixers ? [cfg.nodes.local.name] : [])];

/**
 * The config file for these options: `config`, else `SKULKR_CONFIG`, else `skulkr.config.mjs` in `root`,
 * `SKULKR_ROOT` or the working directory.
 */
export const configPath = ({ config, root } = {}, env = process.env) => {
  const at = config ?? env.SKULKR_CONFIG;
  if (at) return resolve(expandHome(at));
  return join(resolve(expandHome(root ?? env.SKULKR_ROOT ?? process.cwd())), CONFIG_FILE);
};

/** Reads and resolves a project's config; `root` (or `SKULKR_ROOT`) overrides the root it names. */
export const loadConfig = async ({ config, root } = {}, env = process.env) => {
  const file = configPath({ config, root }, env);
  if (!existsSync(file)) throw new Error(`no config at ${file}; write a ${CONFIG_FILE} (README.md says how) or pass --config`);
  const mod = await import(pathToFileURL(file).href);
  const user = typeof mod.default === 'function' ? await mod.default() : mod.default;
  const rootAt = root ?? env.SKULKR_ROOT;
  return resolveConfig(user ?? {}, { file, root: rootAt ? resolve(expandHome(rootAt)) : undefined });
};

/** A path in the project as given in the config: absolute as is, else from the config's directory. */
export const fromConfig = (cfg, path) => (isAbsolute(path) ? path : resolve(cfg.file ? dirname(cfg.file) : process.cwd(), path));
