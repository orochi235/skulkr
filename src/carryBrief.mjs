/** What a fixer is handed of its area's open findings from earlier rounds (`carry.mjs`). */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { JOB_IN } from './config.mjs';
import { SAME_LIKENESS, likeness } from './carry.mjs';

/** The open findings worth carrying into a round whose reviewers reported `fresh`: those they did not report again. */
export const toCarry = (open, fresh = []) =>
  open.filter((o) => !fresh.some((f) => likeness(f.claim, o.claim) >= SAME_LIKENESS));

/** The carried findings as a reviewer-format findings file, each heading led by its id and its round. */
export const carriedMarkdown = (carried) => carried.map((o) => [
  `## [${o.id}] ${o.claim}`,
  `- carried from round ${o.round}${o.rounds?.length > 1 ? ` (reported in rounds ${o.rounds.join(', ')})` : ''}, from ${o.from}`,
  `- where: ${o.where}`,
  '',
].join('\n')).join('\n');

/** The sentences added to the fixer's source when it is handed carried findings. */
export const carriedSource = (id, carried) => (carried.length === 0 ? '' : [
  `${carried.length === 1 ? 'One finding' : `${carried.length} findings`} from earlier rounds that no fixer acted on`,
  `${carried.length === 1 ? 'is' : 'are'} carried into this one, in \`${JOB_IN}/${id}/carried.md\`. The code may have`,
  'changed since: check each still applies. Lead its verdict line with its id in brackets as it is given there,',
  '`[r56-3]` or `[other.area/r56-3]`.',
].join('\n'));

/**
 * Writes the carried findings where the fixer reads them (`carried.md` in the frozen tree's `.skulkr/in/<area>/`) and
 * where the record copies them from (`carried.json` in the night's area directory). Answers what to add to the source.
 */
export const writeCarried = (ctx, id, carried, recordDir) => {
  if (carried.length === 0) return '';
  writeFileSync(join(ctx.frozen, JOB_IN, id, 'carried.md'), carriedMarkdown(carried));
  const findings = carried.map(({ id: cid, claim, where, from, round, rounds }) => ({ id: cid, claim, where, from, round, rounds }));
  writeFileSync(join(recordDir, 'carried.json'), `${JSON.stringify({ findings }, null, 1)}\n`);
  return carriedSource(id, carried);
};
