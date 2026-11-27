/**
 * Each `skulkr` command's usage, printed by `skulkr <command> --help` (or `-h`) before anything else runs. README.md
 * says what each flag does.
 */
import { SATURATE_USAGE } from './saturate.mjs';

const CONFIG = '[--config <file> | --tenant <name>] [--root <dir>]';

export const USAGE = `usage: skulkr <init|night|partition|map|fetch|defects|registry|q|pin|unpin|scour|trial|service|config|tenants|menu> ${CONFIG} [--local] …
       skulkr <command> --help`;

const COMMANDS = {
  init: 'usage: skulkr init — write .skulkr/config.mjs, guessed from the repository',
  night: `usage: skulkr night ${CONFIG} [--areas K] [--only a,b] [--nodes a,b] [--dry] [--no-merge] [--trial preload] [--anyway] [--sweep] [--scheduled] [--fix-only [a,b]] [--local] [--local-fix] [--resume N] [--cap-usd N] [--budget-review N] [--budget-match N] [--budget-fix N]`,
  partition: `usage: skulkr partition ${CONFIG} — write .skulkr/partition.json`,
  map: `usage: skulkr map ${CONFIG} [--cached-jobs] — print the dashboard's map as JSON`,
  fetch: `usage: skulkr fetch ${CONFIG} — bring back what the round's fleet jobs wrote`,
  defects: `usage: skulkr defects <area> ${CONFIG} — an area's defects as JSON`,
  registry: `usage: skulkr registry ${CONFIG} — write .skulkr/defects/ from the rounds and landed ledgers`,
  q: `usage: skulkr q <sql> [--json] ${CONFIG} — query the record's SQLite index`,
  pin: `usage: skulkr pin <area> ${CONFIG} — pick the area first until it settles`,
  unpin: `usage: skulkr unpin <area> ${CONFIG}`,
  scour: SATURATE_USAGE,
  trial: `usage: skulkr trial ${CONFIG}`,
  service: `usage: skulkr service ${CONFIG} — run the schedule, the dashboard's server, and every registered tenant's rounds`,
  config: `usage: skulkr config ${CONFIG} — print the resolved config as JSON`,
  tenants: 'usage: skulkr tenants ls [--json] | add <config> [--name n] [--read-only] | rm <name>',
  menu: 'usage: skulkr menu — the menu bar app\'s status, as JSON',
};
COMMANDS.saturate = COMMANDS.scour;
COMMANDS.sat = COMMANDS.scour;

/** Whether `args` ask for help rather than a run. */
export const asksHelp = (args) => args.includes('--help') || args.includes('-h');

/** The usage `skulkr <command> --help` prints: the command's own, or the whole CLI's for one it doesn't know. */
export const helpFor = (command) => COMMANDS[command] ?? USAGE;
