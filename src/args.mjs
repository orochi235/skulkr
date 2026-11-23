/** `skulkr night`'s flags, read against the config's defaults. README.md, "A run", lists them. */
import { fixOnlyArg } from './fixOnly.mjs';

/** A run's dollar cap when none is given: `budget.areaCapUsd` for each of its `areas`, or else `budget.capUsd`. */
export const capFor = (budget, areas) => (budget.areaCapUsd == null ? budget.capUsd : budget.areaCapUsd * areas);

export const parseArgs = (cfg, argv) => {
  const value = (flag) => {
    const i = argv.indexOf(flag);
    return i < 0 ? undefined : argv[i + 1];
  };
  const number = (flag, fallback) => {
    const v = value(flag);
    if (v === undefined) return fallback;
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) throw new Error(`${flag} wants a non-negative number, not ${v}`);
    return n;
  };
  const fixOnly = argv.indexOf('--fix-only');
  const areas = number('--areas', cfg.areasPerRound);
  return {
    fixOnly: fixOnly < 0 ? undefined : fixOnlyArg(argv[fixOnly + 1]?.startsWith('--') ? '' : argv[fixOnly + 1] ?? ''),
    areas,
    only: value('--only')?.split(',').filter(Boolean),
    nodes: value('--nodes')?.split(',').filter(Boolean),
    dry: argv.includes('--dry'),
    resume: value('--resume') === undefined ? undefined : number('--resume', 0),
    merge: !argv.includes('--no-merge'),
    sweep: argv.includes('--sweep'),
    anyway: argv.includes('--anyway'),
    trial: value('--trial'),
    capUsd: number('--cap-usd', capFor(cfg.budget, areas)),
    budget: {
      review: number('--budget-review', cfg.budget.review),
      match: number('--budget-match', cfg.budget.match),
      fix: number('--budget-fix', cfg.budget.fix),
    },
  };
};
