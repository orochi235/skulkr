/**
 * The run's sweep, when the config names one (`sweep` in the config; README.md "A sweep"): one check at the
 * frozen commit beside the reviews, whose findings, in the reviewers' format, go to one fixer job of their own.
 * The config's sweep runs the check; this file times it, files what it found and hands it to the fixer.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fix } from './area.mjs';
import { JOB_IN } from './config.mjs';

/** Runs the config's sweep and answers `{ ran, exit, summary, dead, minutes, why }`; its files land in `<night>/<id>/`. */
export const runSweep = async (ctx) => {
  const plugin = ctx.cfg.sweep;
  const dir = join(ctx.nightDir, plugin.id);
  mkdirSync(dir, { recursive: true });
  const t0 = Date.now();
  const got = await plugin.run(ctx, dir);
  const minutes = (Date.now() - t0) / 60_000;
  return got.ran ? { ...got, dead: got.dead ?? [], minutes } : { ran: false, minutes, why: got.why ?? 'it gave no reason' };
};

/** One fixer job on the sweep's findings. Answers its result, as `area.mjs`'s `fix` does. */
export const fixSweep = async (ctx, dead) => {
  const plugin = ctx.cfg.sweep;
  const inDir = join(ctx.frozen, JOB_IN, plugin.id);
  mkdirSync(inDir, { recursive: true });
  const report = `${JOB_IN}/${plugin.id}/A.md`;
  const findings = plugin.findings(dead);
  writeFileSync(join(ctx.frozen, report), findings);
  const out = join(ctx.nightDir, plugin.id);
  writeFileSync(join(out, 'findings.md'), findings);
  const fixed = await fix(ctx, { id: plugin.id }, dead.length, plugin.source(ctx.commit, report));
  if (fixed.report) writeFileSync(join(out, 'fix.md'), fixed.report);
  return fixed;
};

/** The run's sweep line, for the log and the report. */
export const sweepLine = (plugin, s) => {
  const name = plugin?.title?.toLowerCase() ?? plugin?.id ?? 'sweep';
  return s.skipped ? `${name}: ${s.skipped}`
    : !s.ran ? `${name}: did not run (${s.why})`
      : `${name}: ${plugin.line(s)}`;
};
