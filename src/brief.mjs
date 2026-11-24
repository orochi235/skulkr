/** The briefs a job's prompt is made from: the config's template for a role, or the shipped default, filled in. */
import { readFileSync } from 'node:fs';
import { briefPathFor } from './agent/index.mjs';
import { onFleetPrefix } from './verify.mjs';

/** The brief for `role` (`reviewer`, `matcher`, `fixer`, `repair`, or `conflict`): the config's template, or the shipped default. */
export const brief = (cfg, role) => readFileSync(briefPathFor(cfg, role), 'utf8');
export const fill = (text, vars) => text.replace(/\{\{(\w+)\}\}/g, (_, k) => String(vars[k] ?? ''));
/** What every brief may name besides its own variables: the project and its rules and checks. A repair or conflict
 *  repair takes the fixer's rules unless the config gives it its own. */
export const projectVars = (cfg, role) => ({
  project: cfg.name, rules: cfg.rules[role] ?? (role === 'repair' || role === 'conflict' ? cfg.rules.fixer : undefined) ?? '',
  test: cfg.checks.test, typecheck: cfg.checks.typecheck, lint: cfg.checks.lint,
  // Before a whole-repo check's command in a brief: runs it on the fleet under the local runner, else nothing.
  onFleet: onFleetPrefix(cfg, 'typecheck', 15, 'checks'),
});
