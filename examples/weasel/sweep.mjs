/**
 * weasel's control sweep as a skulk sweep: `scripts/control-sweep.mjs` on one fleet node with a browser, at the
 * frozen commit, beside the reviews. Each dead control becomes a finding for one fixer. The sweep's own code stays
 * in weasel (`scripts/control-sweep/`); this reads its fleet helper from the project root at run time.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/** A dead control as a reviewer-format finding. */
export const findingOf = (d) => [
  `## Dead control: ${d.kind} "${d.label}" in demo \`${d.demo}\``,
  `- where: ${d.path} (demo \`${d.demo}\`)`,
  `- scenario: operating it${d.precondition ? ` with "${d.precondition}" operated first` : ''} changes no canvas pixel and no text or attribute in the demo outside the control's own field, on two fresh loads`,
  `- evidence: control sweep${d.shots?.length ? `; screenshots ${d.shots.map((s) => `\`${s}\``).join(', ')} in the night's sweep record` : ''}`,
  '- severity: medium',
  '',
].join('\n');

export const findingsOf = (dead) => `${dead.map(findingOf).join('\n')}`;

/** What the fixer is told its findings are. */
export const sweepSource = (commit, report) => [
  `The control sweep (\`scripts/control-sweep.mjs\`) operated every control of every demo at the frozen commit ${commit}`,
  `in headless Chromium. Each finding in \`${report}\` is a control whose operation changed nothing the sweep could`,
  'see. Either it is dead, and the fix wires it or hides it where it has no effect (as labkit\'s `showIf` does),',
  'or the sweep cannot see what it does (it acts only once something is selected, or on the next gesture): report',
  'that as `not a defect (why)`, and name the `scripts/control-sweep.allow.json` entry a person should add. Never add',
  'one yourself.',
].join('\n');

/** The README section's body for a run that ran: its counts and its dead controls. */
export const sweepSection = (sweep, outcome) => {
  const s = sweep.summary;
  const rows = s.deadControls.map((d) => `| \`${d.demo}\` | ${d.label} | ${d.kind} | ${d.precondition ?? ''} |`);
  return [
    `\`scripts/control-sweep.mjs\` at the same commit operated ${s.controls} controls in ${s.demos} demos in ${sweep.minutes.toFixed(1)} min: `
      + `${s.dead} dead, ${s.unsure} unsure, ${s.skipped} skipped, ${s.waived} waived, ${s.error} errors; ${s.loadFailures} demos did not load. `
      + `The dead controls went to one fixer${outcome ? ` (${outcome})` : ''}; its report and the run's summary are in \`control-sweep/\`.`,
    ...(rows.length ? ['', '| Demo | Dead control | Kind | Under |', '|---|---|---|---|', ...rows] : []),
  ];
};

/** The dead records of a finished run, in full, from its `controls.jsonl`. */
const deadIn = (dir) => {
  const file = join(dir, 'controls.jsonl');
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((r) => r.verdict === 'dead');
};

export const sweep = {
  id: 'control-sweep',
  title: 'Control sweep',
  /** Copied from `<night>/control-sweep/` into the round's record beside `findings.md` and `fix.md`. */
  recordFiles: [['run/summary.json', 'summary.json']],
  findings: findingsOf,
  source: sweepSource,
  section: sweepSection,
  line: (s) => `${s.summary.dead} dead, ${s.summary.unsure} unsure, ${s.summary.skipped} skipped of ${s.summary.controls} controls in ${s.summary.demos} demos, ${s.minutes.toFixed(1)} min`,
  /** One browser job through the runner; its run lands in `<dir>/run`. */
  run: async (ctx, dir) => {
    const fleet = await import(pathToFileURL(join(ctx.root, 'scripts/control-sweep/fleet.mjs')).href);
    const to = join(dir, 'run');
    const run = `night-round${ctx.round}`;
    await ctx.runFree({
      gui: true, kind: 'test', icon: 'slider.horizontal.3', tree: fleet.SWEEP_TREE, ref: ctx.base,
      task: `skulk${ctx.round}-control-sweep`,
      about: `Control sweep for audit round ${ctx.round}: operates every demo control at ${ctx.commit.slice(0, 10)} and lists each that changes nothing.`,
      expect: fleet.EXPECT, timeout: fleet.TIMEOUT, out: `${fleet.NODE_OUT}/${run}`, to, shell: fleet.sweepShell(run),
    }, join(dir, 'onto.log'));
    const { exit, summary } = fleet.readRun(to);
    if (exit === undefined || !summary) return { ran: false, why: `no record came back; see ${join(dir, 'onto.log')}` };
    return { ran: true, exit, summary, dead: deadIn(to) };
  },
};
