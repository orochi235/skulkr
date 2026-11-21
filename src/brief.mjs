/** The briefs a job's prompt is made from: the config's template for a role, or the shipped default, filled in. */
import { readFileSync } from 'node:fs';

/** The brief for `role` (`reviewer`, `matcher`, `fixer`, or `repair`): the config's template, or the shipped default. */
export const brief = (cfg, role) => readFileSync(cfg.briefPath(role), 'utf8');
export const fill = (text, vars) => text.replace(/\{\{(\w+)\}\}/g, (_, k) => String(vars[k] ?? ''));
/** What every brief may name besides its own variables: the project and its rules and checks. A repair takes the
 *  fixer's rules unless the config gives it its own. */
export const projectVars = (cfg, role) => ({
  project: cfg.name, rules: cfg.rules[role] ?? (role === 'repair' ? cfg.rules.fixer : undefined) ?? '',
  test: cfg.checks.test, typecheck: cfg.checks.typecheck, lint: cfg.checks.lint,
});
