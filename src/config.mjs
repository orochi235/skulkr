/**
 * A project's settings: the defaults below, overlaid by the project's `skulkr.config.mjs`, and the values
 * derived from them (regular expressions, names, paths) that the rest of the pipeline reads. Nothing else
 * in `src/` holds a project-specific value. README.md "The config file" says what each setting does.
 */
import { existsSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const CONFIG_FILE = 'skulkr.config.mjs';
/** Where a project keeps its config inside its `.skulkr/`, looked for before {@link CONFIG_FILE} at its root. */
export const DIR_CONFIG_FILE = '.skulkr/config.mjs';

/** What a config's relative paths are from: its directory, or the project's root for one in `.skulkr/`. */
export const configBaseOf = (file) => {
  if (!file) return process.cwd();
  const dir = dirname(file);
  return basename(dir) === '.skulkr' ? dirname(dir) : dir;
};

/** Inside the frozen tree and every node tree: what a job reads, and what it hands back. */
export const JOB_IN = '.skulkr/in';
export const JOB_OUT = '.skulkr/out';
/** Where in `JOB_OUT` a fixer's progress filter records the commit its final check last passed at. */
export const CHECKS_PROOF = 'checks.passed';

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

  /** `push` sends `main` to `remote` once a green round has fast-forwarded it. */
  git: { main: 'main', remote: 'origin', push: true },

  naming: {
    /** `audit` makes `audit<N>-<area>` branches and `audit<N>-<area>-<step>` job names. */
    prefix: 'audit',
    /** `batch` makes `batch/<date>-audit<N>`. */
    batchPrefix: 'batch',
    /** A batch branch's whole name, from `{date}` (YYYY-MM-DD) and `{round}`, which it must hold; unset, it is
     *  `<batchPrefix>/{date}-<prefix>{round}`. */
    batch: undefined,
  },

  record: {
    /** Where `round-<N>/`, `partition.json` and landed saturation ledgers are written, in the repository. */
    dir: '.skulkr',
    /** Directories the record was moved from, newest first, so readers of its git history find earlier rounds. */
    formerDirs: [],
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
    /**
     * The check skulkr runs itself over the files a fixer's commits changed, never trusting the fixer's report, or
     * null for none (README "Verify and repair"). `command` runs at the end of the fixer's own job; `{files}` in it
     * is the changed files, `{related}` the same as `--related=<file>` each. `gui`, where some tests need a GUI
     * node, is `{ command, probe }`: `probe` runs beside `command` and lists the test files the GUI part would
     * run, one a line; `command` then runs in a job of its own on a GUI node. `timeoutMin` bounds each run.
     */
    verify: null,
    /**
     * A command that fixes what it can in the files a fixer's or repair's commits changed (`{files}`), run before
     * they are handed back; what it changes is committed as one commit with `message`. Null for none.
     */
    fixup: null,
    /**
     * The checks a batch must pass before its gate joins the fleet queue, or null to leave them to the gate (README
     * "Preflight"). `command` runs on the batch's tip, and on `main`'s tip over a red result's failures, each in a job
     * of the round's gate lane; `{tests}` is the test files to run beside the checks (the last red gate's failures),
     * empty when none. Its output marks each failure with a `gate.failPrefix` line, as the gate's does. `gateArgs` go
     * after the gate's command when it passed; `timeoutMin` bounds it (default 20). `gui`, `{ command, project }`, runs at
     * once on a GUI node over the test files whose failure line's project (its first word) `project` matches.
     */
    preflight: null,
  },
  /** Project rules added to the default briefs (a string of Markdown), per brief. */
  rules: { reviewer: '', fixer: '' },
  /**
   * `preload`: each reviewer's prompt carries its area's files, so it need not open them, and each pair's B starts 30
   * seconds after its A to read A's cached prompt. Adopted 2026-11-22 from round 72's trial (6.5% cheaper, a third of
   * the turns, overlap not up). Only where the review agent takes its prompt on stdin (`stdin` in `agent/index.mjs`).
   */
  review: { preload: true },
  /** Brief templates, paths relative to the config file; unset uses the shipped default. */
  briefs: { reviewer: undefined, matcher: undefined, fixer: undefined, repair: undefined, conflict: undefined, ledgerMatch: undefined, scourTriage: undefined, scourSubagent: undefined },

  /**
   * `skulkr scour` (README "Scour"): `max` occasions at most, one review per source in `sources` (agent names)
   * each iteration, stopping once the chance of a new finding falls under `stopNextNew`, or as ready to fix once it
   * holds `fixAtKnownPerKloc` known defects per thousand lines after `minPasses` (null: never). A defect seen in
   * `recurrent.share` of a ledger's passes or more, and at least `recurrent.min` times, is flagged recurrent.
   */
  saturate: { max: 40, minPasses: 5, fixAtKnownPerKloc: 5, recurrent: { share: 0.25, min: 5 }, sources: ['claude'], stopNextNew: 0.15, stopUnseenPerKloc: 1, stopUsdPerDefect: { times: 3 }, openingUsdPerDefect: 0.4 },

  /**
   * How a batch is tested. `{ref}` in the command is the batch branch; `cwd` is `root` or `batch` (its worktree).
   * `progress` names the gate's parallel runs by the prefix their `onto: progress N/M` lines carry in its log
   * (a regex source; '' for unprefixed lines), for the dashboard. `outcome` names, per run, the word its closing
   * `<word> passed|failed` line in the gate's log starts with; a run without one takes the whole gate's result.
   * `jobs` picks, per run, its runner jobs by a regex on their task names; a run without one takes the rest.
   * `labels` names each run on the dashboard; a run without one shows its key.
   */
  gate: { name: 'gate', command: ['npm', 'test'], cwd: 'batch', progress: { tests: '' }, outcome: {}, jobs: {}, labels: {} },

  /** How the fixer readies a node tree: a shell line before every job, and an install when the lockfile changes. */
  setup: {
    prelude: '',
    /** `marker` is where the installed lockfile's hash is kept; it must survive between jobs and stay out of git. */
    install: { lockfile: 'package-lock.json', command: 'npm ci --no-audit --no-fund', marker: 'node_modules/.skulkr-lock' },
  },

  /**
   * The job runner: `'local'` (every job on this machine, README "Runners"), `'onto'`, a module path exporting
   * `createRunner(cfg)`, or a runner object.
   */
  runner: 'local',
  /**
   * Fixers and repairs on this machine, under the account that starts the run (its `CLAUDE_CONFIG_DIR`, else
   * `claude.configDir`), while every other job stays with the runner; each one's verify goes to the runner in a job of
   * its own. `enabled` turns it on for every run, as `skulkr night --local-fix` does for one; `slots`, how many run at
   * once (README "Local fixers").
   */
  localFix: { enabled: false, slots: 2 },
  /**
   * Local mode (README "Local mode"): every job on this machine, on Claude Code as the account that starts the run,
   * with nothing pushed, no web tools, and npm offline. `enabled` turns it on for every run, as `--local` does for one.
   * `override` replaces, key by key at the top level, the config's settings that reach off the machine (a gate that
   * runs on a fleet); it is read only in local mode.
   */
  /**
   * `agents`: model jobs (reviews, matches, fixers, repairs) at once under the local runner, across every role.
   * `fleetChecks`: under the local runner, each verify on the onto fleet where onto can take it, else here.
   * `fleetOnly`: commands a local fixer must run through its brief's `{{onFleet}}` while `fleetChecks` holds; run bare,
   * Claude refuses them, since a project's whole gate run here by several fixers at once pegs the machine.
   */
  local: { enabled: false, agents: 6, fleetChecks: true, fleetOnly: [], override: {} },
  /**
   * Jobs at once across every node, by role, under a runner that places jobs itself (onto). Unset: the per-node
   * slots times the nodes listed, or one node's slots when none are.
   */
  concurrency: { review: undefined, fix: undefined },
  nodes: {
    /** Unset under the local runner: its one node, `local`. */
    list: [],
    /** A node that takes model jobs only inside a daily window, e.g. `{ name, from: '00:00', until: '09:00' }`. */
    local: null,
    /** Nodes fixers never run on (they run with permissions bypassed). */
    noFixers: [],
    refusedCooldownMin: 30,
    /** Unset: 6 each, or under the local runner, which shares one machine, `LOCAL_SLOTS`. */
    reviewSlots: undefined,
    fixSlots: undefined,
  },

  /**
   * The agent each model job runs (`src/agent/`): one name for every role, or `{ review, match, fix }` (a repair runs
   * as `fix`). Each agent's settings are the block named for it.
   */
  agent: 'claude',

  claude: {
    /** `CLAUDE_CONFIG_DIR` for every job, or unset for the node's default. */
    configDir: undefined,
    /** Tools every job is refused, beside each role's own; local mode adds the web tools. */
    denied: [],
    /** Unset: the model and effort the job's settings give, or the account's default. */
    /** `ledgerMatch`: the saturation ledger's matcher, which has to tell one defect from another across many reports. */
    models: { review: undefined, fix: undefined, match: 'haiku', ledgerMatch: 'opus' },
    effort: { review: undefined, fix: undefined, match: undefined },
    /**
     * `--setting-sources` for every job: without `user`, the job reads none of the node account's own settings
     * (its hooks, plugins, and instructions), only the project's. Null leaves the flag off.
     */
    settingSources: 'project,local',
    /**
     * The prompt cache's lifetime per role (`CLAUDE_CODE_PROMPT_CACHE_TTL`: `5m` or `1h`); unset takes Claude Code's
     * default (null, or unset), an hour on a subscription's plan usage. A five-minute write costs 1.25× input against 2× for
     * an hour's; a fixer (and a repair, which shares its role) loses on it only when a turn waits more than five minutes.
     */
    cacheTtl: { review: '5m', match: '5m', fix: '5m' },
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
    /**
     * List-price dollars per million tokens by model, `{ input, cacheRead, output }`, for a scour subagent's cost, which
     * its transcript gives only as tokens; a cache write is priced from `input`. Haiku's `cacheRead` is taken as 0.1×
     * its input, the usual ratio, not a published figure (2026-11-26).
     */
    prices: {
      'claude-fable-5-2': { input: 8, cacheRead: 0.2, output: 40 },
      'claude-opus-5-5': { input: 4, cacheRead: 0.2, output: 20 },
      'claude-sonnet-5-5': { input: 2, cacheRead: 0.1, output: 10 },
      'claude-haiku-5-5': { input: 0.1, cacheRead: 0.01, output: 0.5 },
    },
  },

  codex: {
    /** `CODEX_HOME` for every job, or unset for the node's default. */
    home: undefined,
    /** Without the node account's `config.toml` (its MCP servers, profiles and instructions); auth still comes from it. */
    ignoreUserConfig: true,
    /** The model each role runs; a role run on Codex must name one, and price it in `prices`. */
    models: { review: undefined },
    /** `model_reasoning_effort` by role; unset takes the model's default. */
    effort: { review: undefined },
    /**
     * Dollars per million tokens by model, `{ input, cachedInput, output }`: Codex reports tokens but no cost, so
     * a job's `costUsd`, and the night's cap, come from these. A cache write is priced as input.
     */
    prices: {},
    /** Each role's brief template in place of the config's `briefs`; unset: the shipped `briefs/codex/` one. */
    briefs: {},
    timeoutMin: 45,
    reviewExpect: '8m',
  },

  areasPerRound: 16,
  /** How many rounds may sit with their batch unmerged (`stranded.mjs`) before a new round waits; `--anyway` starts one regardless. */
  maxUnmergedRounds: 0,
  /**
   * List-price dollars: each job's `--max-budget-usd` by role, a run's `capUsd`, or `areaCapUsd` for each area it takes
   * in its place, the guess at an area's cost, and `nightUsd`, what continuous mode may spend from one `stopAt` to the
   * next (unset: no continuous mode).
   */
  budget: { review: 8, match: 1, ledgerMatch: 3, fix: 15, capUsd: 160, areaCapUsd: undefined, areaGuessUsd: 10, nightUsd: undefined },
  /**
   * Local clock times: the service starts a run at `startAt`; a run the schedule or continuous mode started
   * (`--scheduled`) stops dispatching at the first `stopAt`; one started by hand has no deadline.
   * `continuous` keeps rounds coming between them, under `budget.nightUsd` (README "Continuous rounds").
   */
  schedule: { startAt: '23:00', stopAt: '07:00', continuous: false },

  /**
   * An early landing (README "Early landings"): once per round, while areas are still fixing, the ready half is batched,
   * gated and landed. It starts when `share` of the picked areas have branches ready, at least `left` of them have yet to
   * finish, and the runner reports `coresFree` of the fleet's cores free with nobody else waiting for the gate. `null`
   * turns it off; so does a runner that cannot say how busy it is.
   */
  early: { share: 0.5, left: 0.25, coresFree: 0.5 },

  /**
   * A branch whose merge into the batch conflicts gets a conflict repair (README "batch" step): a repair job, under the
   * dollar cap, that resolves the merge keeping both sides, verified as a repair is. `repair: false` leaves such a
   * branch out, as before; so does a config with no `checks.verify`.
   */
  conflicts: { repair: true },

  /** An extra check run beside the reviews whose findings go to one fixer; see README "A sweep". */
  sweep: null,

  /**
   * The map's area icons, or a function of `{ root }` answering them; see README "Area icons". `areas` maps an area id
   * or a group's id prefix to an icon name; `packageOf(file)` names a file's package and `packages` (a table or a
   * function) that package's icon; `glyph(name)` answers an icon's SVG body on a 20×20 viewBox.
   */
  icons: null,
};

/**
 * The local runner's slots when the config names none: one machine runs every job and every fixer's checks. A reviewer
 * waits on the model, not the machine, so its slots are the config's `local.agents`; fixers run checks, so two at once.
 */
export const LOCAL_SLOTS = { reviewSlots: 6, fixSlots: 2 };
const FLEET_SLOTS = { reviewSlots: 6, fixSlots: 6 };

/** The node list and slots, filled in for the runner when the config leaves them unset. */
const nodesFor = (nodes, runner, agents) => {
  const local = runner === 'local';
  const slots = local ? { ...LOCAL_SLOTS, reviewSlots: agents ?? LOCAL_SLOTS.reviewSlots } : FLEET_SLOTS;
  return {
    ...nodes,
    list: nodes.list.length || !local ? nodes.list : ['local'],
    reviewSlots: nodes.reviewSlots ?? slots.reviewSlots,
    fixSlots: nodes.fixSlots ?? slots.fixSlots,
  };
};

/** Jobs at once by role under a runner that places them: the config's, else slots per node times the nodes. */
const concurrencyFor = (given, nodes) => {
  const n = Math.max(1, nodes.list.length);
  return { review: given?.review ?? nodes.reviewSlots * n, fix: given?.fix ?? nodes.fixSlots * n };
};

/** The account a run's own jobs start as: the `CLAUDE_CONFIG_DIR` it was started under, else `claude.configDir`. */
export const startingAccountOf = (user, env = process.env) => env.CLAUDE_CONFIG_DIR || user.claude?.configDir || undefined;

/** What local mode sets in a run's own environment, so every job and command it starts inherits it. */
export const LOCAL_ENV = { CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', npm_config_offline: 'true' };
const WEB_TOOLS = ['WebFetch', 'WebSearch'];

/** `user` as local mode runs it: its `local.override` over it, and every job on this machine as the starting account. */
const localOf = (user, env) => {
  const u = { ...user, ...user.local?.override };
  const agents = typeof u.agent === 'object' && u.agent ? Object.values(u.agent) : [u.agent ?? 'claude'];
  const other = agents.find((a) => a !== 'claude');
  if (other) throw new Error(`local mode runs every job on claude; the config's agent names ${other}`);
  return {
    ...u,
    runner: 'local',
    nodes: { reviewSlots: undefined, fixSlots: undefined, ...u.local?.override?.nodes, list: [], local: null },
    concurrency: {},
    git: { ...u.git, push: false },
    claude: {
      ...u.claude, configDir: startingAccountOf(user, env), denied: [...new Set([...(u.claude?.denied ?? []), ...WEB_TOOLS])],
      fixDenied: u.local?.fleetChecks === false ? [] : (u.local?.fleetOnly ?? []).flatMap((cmd) => [`Bash(${cmd})`, `Bash(${cmd}:*)`]),
    },
  };
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
 * @param {Record<string, any>} [user]
 * @param {{ file?: string, root?: string, local?: boolean, env?: Record<string, string | undefined> }} [opts]
 */
export const resolveConfig = (user = {}, { file, root, local = false, env = process.env } = {}) => {
  const on = Boolean(local || user.local?.enabled);
  const c = merge(DEFAULTS, on ? localOf(user, env) : user);
  const base = configBaseOf(file);
  const name = c.name ?? 'project';
  const p = c.partition;
  const rootRe = new RegExp(`^(${p.roots.map(globToRe).join('|')})/`);
  const sourceRe = new RegExp(`\\.(${p.extensions.map(escape).join('|')})$`);
  const exclude = p.exclude.map(toRe);
  const tops = topDirs(p.roots);
  const { prefix, batchPrefix } = c.naming;
  const pre = escape(prefix);
  const batchPattern = c.naming.batch ?? `${batchPrefix}/{date}-${prefix}{round}`;
  if (!batchPattern.includes('{round}')) throw new Error(`naming.batch must hold {round}: ${batchPattern}`);
  const fillBatch = (pattern, date, round) => pattern.replaceAll('{date}', date).replaceAll('{round}', String(round));
  /** `pattern` as a regex source, `{date}` a date, `{round}` as `round`, and a `<prefix>` just before it also as `skulkr`. */
  const batchSource = (pattern, round) => pattern.split(/(\{date\}|\{round\})/).map((part, i, parts) => {
    if (part === '{date}') return '\\d{4}-\\d\\d-\\d\\d';
    if (part === '{round}') return round;
    return parts[i + 1] === '{round}' && part.endsWith(prefix) ? `${escape(part.slice(0, -prefix.length))}(?:${pre}|skulkr)` : escape(part);
  }).join('');
  const batchRe = new RegExp(`^${batchSource(batchPattern, '(\\d+)')}$`);
  const leftOutRe = new RegExp(`^batch: ${pre}\\d+-(\\S+?)(?: \\(round (\\d+)\\))? left out: (.+)$`);
  const oldConflictRe = new RegExp(`^batch: ${pre}\\d+-(\\S+) conflicts`);
  const resolvedRe = new RegExp(`^batch: ${pre}(\\d+)-(\\S+) merged (?:after a conflict repair|with the resolution of its conflict)`);
  const areaBranch = new RegExp(`^${pre}(\\d+)-(.+)$`);
  const briefPath = (role) => (c.briefs[role] ? resolve(base, c.briefs[role]) : new URL(`${role}.md`, DEFAULT_BRIEFS).pathname);
  return {
    ...c,
    name,
    file,
    local: { ...c.local, on },
    nodes: nodesFor(c.nodes, c.runner, c.local?.agents),
    concurrency: concurrencyFor(c.concurrency, nodesFor(c.nodes, c.runner, c.local?.agents)),
    root: root ?? (c.root ? resolve(base, expandHome(c.root)) : undefined),
    state: c.state ? resolve(base, expandHome(c.state)) : join(homedir(), '.local', 'state', 'skulkr', name),
    record: { ...c.record, dirs: [c.record.dir, ...(c.record.formerDirs ?? [])] },
    partition: {
      ...p,
      rootRe,
      pathspec: tops,
      path: `${c.record.dir}/partition.json`,
      isSource: (path) => rootRe.test(path) && sourceRe.test(path) && !exclude.some((re) => re.test(path)),
      /** Names what `isSource` accepts, so counts cached under another filter are not read back. */
      sourceKey: JSON.stringify([p.roots, p.extensions, p.exclude.map(String)]),
    },
    /** The repository paths a finding's `where` line cites. */
    citedRe: tops.length ? new RegExp(`((?:${tops.map(escape).join('|')})\\/[\\w./@-]+\\.\\w+)`, 'g') : /([\w@-][\w.@-]*\/[\w./@-]+\.\w+)/g,
    briefPath,
    gate: { ...c.gate, logSuffix: `.${c.gate.name.replace(/[^\w.-]+/g, '-')}.log` },
    names: {
      area: (round, area) => `${prefix}${round}-${area}`,
      batch: (date, round) => fillBatch(batchPattern, date, round),
      /** A runner job's task name, led by the project's name so a fleet listing says whose job it is. */
      task: (round, area, step) => `${name}-${prefix}${round}-${area}-${step}`,
      frozen: (round) => `${prefix}${round}-frozen-night`,
      am: (round, area) => `${prefix}${round}-am-${area}`,
      batchTree: (date, round) => fillBatch(batchPattern, date, round).replaceAll('/', '-'),
      /** A batch branch → its round, or undefined for any other branch. */
      batchRoundOf: (branch) => {
        const m = batchRe.exec(branch);
        return m ? Number(m[1]) : undefined;
      },
      /** An area branch `<prefix><N>-<area>` → `{ round, id }`, or undefined for any other branch. */
      branchOf: (branch) => {
        const m = areaBranch.exec(branch);
        return m ? { round: Number(m[1]), id: m[2] } : undefined;
      },
      /** An area branch → its area, of whichever round; any other branch as it is. */
      idOf: (branch) => areaBranch.exec(branch)?.[2] ?? branch,
      /** A round number in any branch named for one: `audit30-ui`, `batch/…-audit31`. */
      roundIn: new RegExp(`(?:^|[/-])${pre}(\\d+)(?:-|$)`),
      /** A job of round `round` (any round when omitted), by its task name. */
      jobOf: (round = '\\d+') => new RegExp(`^(?:${escape(name)}-)?(?:${pre}|skulkr)${round}-`),
      /** A runner job of round `round`'s batch gate, by its task name. */
      batchJobOf: (round) => new RegExp(`${batchSource(batchPattern.replaceAll('/', '-'), round)}(?:-|$)`),
      /** A step's task name → `[area, step]`. */
      step: new RegExp(`^(?:${escape(name)}-)?(?:${pre}|skulkr)\\d+-(.+)-(A|B|match|fix|repair|verify)$`),
      /**
       * A night log's line for a branch the batch left out → `{ area, why, earlier }`, `earlier` the round of a branch an
       * earlier round left out, retried here; null for any other line. Reads the old `… conflicts; left out` form too.
       */
      leftOut: (line) => {
        const m = leftOutRe.exec(line) ?? oldConflictRe.exec(line);
        if (!m) return null;
        return { area: m[1], why: m[3] ?? 'merge conflict', ...(m[2] ? { earlier: Number(m[2]) } : {}) };
      },
      /** A night log's line for a branch a conflict repair merged into the batch (`conflict.mjs`) → `{ area, round }`, the
       *  branch's own round; null for any other line. */
      resolved: (line) => {
        const m = resolvedRe.exec(line);
        return m ? { area: m[2], round: Number(m[1]) } : null;
      },
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
  const top = resolve(expandHome(root ?? env.SKULKR_ROOT ?? process.cwd()));
  return existsSync(join(top, DIR_CONFIG_FILE)) ? join(top, DIR_CONFIG_FILE) : join(top, CONFIG_FILE);
};

/**
 * Reads and resolves a project's config; `root` (or `SKULKR_ROOT`) overrides the root it names. `fresh` reads the file
 * as it is now rather than as this process first imported it (the modules it imports stay as first imported).
 */
export const loadConfig = async ({ config, root, fresh = false, local = false } = {}, env = process.env) => {
  const file = configPath({ config, root }, env);
  if (!existsSync(file)) throw new Error(`no config at ${file}; write a ${DIR_CONFIG_FILE} (README.md says how) or pass --config`);
  const mod = await import(`${pathToFileURL(file).href}${fresh ? `?mtime=${statSync(file).mtimeMs}` : ''}`);
  const user = typeof mod.default === 'function' ? await mod.default() : mod.default;
  const rootAt = root ?? env.SKULKR_ROOT;
  return resolveConfig(user ?? {}, { file, root: rootAt ? resolve(expandHome(rootAt)) : undefined, local, env });
};

/** A path in the project as given in the config: absolute as is, else from the config's directory. */
export const fromConfig = (cfg, path) => (isAbsolute(path) ? path : resolve(configBaseOf(cfg.file), path));
