/** The round's written record: `<record.dir>/round-<N>/README.md` and its row in the config's ledger, if it has one. */

const num = (n, width = 5) => (n === undefined ? '-' : n.toFixed(1)).padStart(width);
const mtok = (n) => `${(n / 1e6).toFixed(2)}M`;
const usd = (n) => `$${n.toFixed(2)}`;
const ceiling = (s) => (s.budgetHit?.length ? `; ${s.budgetHit.join(', ')} stopped at its dollar ceiling` : '');
const unrun = (s) => (s.incomplete?.length ? `; reviewer ${s.incomplete.join(' and ')} never ran or never finished its report, so no estimate` : '');

/** The README of round `round`, from each area's summary (`area.json`) and what became of its branch. */
export const roundReadme = (cfg, { round, commit, date, areas, sweep, outcomes }) => {
  const rows = areas.map((s) => {
    const fate = outcomes[s.id] ?? '';
    const prev = s.previous ? `${num(s.previous.unfound)} (r${s.previous.round})` : '-';
    const fresh = s.newCode ? `${s.newCode.findings} in ${s.newCode.changedFiles} changed` : '-';
    return `| \`${s.id}\` | ${s.files.length} | ${s.read.A}/${s.read.B} | ${s.a} | ${s.b} | ${s.m} | ${s.distinct} | ${num(s.chapman)} | ${num(s.unfound)} | ${prev} | ${fresh} | ${s.patches} | ${s.questions} | ${mtok(s.jobs.weightedTokens)} | ${usd(s.jobs.costUsd)} | ${fate}${ceiling(s)}${unrun(s)} |`;
  });
  const total = (k) => areas.reduce((sum, s) => sum + s[k], 0);
  return [
    `# Audit round ${round}`,
    '',
    ...cfg.record.intro.map((line) => line.replaceAll('{{commit}}', commit).replaceAll('{{date}}', date)),
    '',
    '| Area | Files | Read A/B | A | B | Shared | Distinct | Est. | Left | Last left | New code | Commits | Questions | Weighted tokens | Cost | Branch |',
    '|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|---|',
    ...rows,
    '',
    `Totals: ${total('distinct')} distinct findings, ${total('patches')} fix commits, ${total('questions')} questions, `
      + `${mtok(areas.reduce((s, a) => s + a.jobs.weightedTokens, 0))} weighted tokens, ${usd(areas.reduce((s, a) => s + a.jobs.costUsd, 0))}.`,
    '',
    ...(sweep && cfg.sweep ? sweepSection(cfg.sweep, sweep, outcomes[cfg.sweep.id]) : []),
  ].join('\n');
};

/** The README's section for the sweep: why it did not run, or what the config's sweep says of its run. */
export const sweepSection = (plugin, sweep, outcome) => {
  const title = `## ${plugin.title ?? plugin.id}`;
  if (!sweep.ran) return [title, '', `The ${plugin.title?.toLowerCase() ?? plugin.id} ${sweep.skipped ?? `did not run: ${sweep.why}`}.`, ''];
  return [title, '', ...plugin.section(sweep, outcome), ''];
};

/** `ledger` (a Markdown file's text) with `row` appended to the end of the table under its `## <section>` heading. */
export const appendRecordRow = (ledger, row, { path = 'the ledger', section = 'Record' } = {}) => {
  const lines = ledger.split('\n');
  const head = lines.findIndex((l) => new RegExp(`^## ${section.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(l));
  if (head < 0) throw new Error(`${path} has no "## ${section}" section`);
  let last = -1;
  for (let i = head + 1; i < lines.length && !/^## /.test(lines[i]); i++) if (lines[i].startsWith('|')) last = i;
  if (last < 0) throw new Error(`${path}'s ${section} section has no table`);
  lines.splice(last + 1, 0, row);
  return lines.join('\n');
};
