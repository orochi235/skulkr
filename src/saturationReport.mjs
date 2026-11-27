/** `report.md` beside the ledger, the saturation report: written from the ledger alone, so it can always be written again. */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ledgerDirOf } from './ledger.mjs';
import { estimatesOf, priceUnitFor, stopReason, yieldRows } from './saturation.mjs';
import { nextPriceOf } from './scourPrice.mjs';

/** A Markdown table whose columns line up in the raw text too; `right` marks the right-aligned (numeric) columns. */
const table = (head, rows, right) => {
  const cells = [head, ...rows].map((r) => r.map((c) => String(c).replace(/\|/g, '\\|')));
  const width = head.map((_, i) => Math.max(3, ...cells.map((r) => r[i].length)));
  const pad = (c, i) => (right[i] ? c.padStart(width[i]) : c.padEnd(width[i]));
  const line = (r) => `| ${r.map(pad).join(' | ')} |`;
  const rule = `|${width.map((w, i) => (right[i] ? `${'-'.repeat(w + 1)}:` : `${'-'.repeat(w + 2)}`)).join('|')}|`;
  return [line(cells[0]), rule, ...cells.slice(1).map(line)].join('\n');
};

const fixed = (n, places) => (n === undefined || Number.isNaN(n) ? '–' : n.toFixed(places));
const pct = (n) => (n === undefined ? '–' : `${(n * 100).toFixed(1)}%`);

const yieldTable = (ledger) => table(
  ['#', 'source', 'findings', 'new', 'distinct', 'Q1', 'Q2', 'est. total', 'unseen', 'next-new', 'cost', '$/defect', 'minutes'],
  yieldRows(ledger).map((r) => [
    r.n, r.source, r.findings, r.new, r.stats.S, r.stats.Q1, r.stats.Q2,
    fixed(r.stats.total, 1), fixed(r.stats.f0, 1), pct(r.stats.nextNew), `$${fixed(r.costUsd ?? 0, 2)}`,
    r.usdPerDefect === undefined ? '–' : `$${fixed(r.usdPerDefect, 2)}`, fixed(r.minutes ?? 0, 1),
  ]),
  [true, false, true, true, true, true, true, true, true, true, true, true, true],
);

const estimatesTable = (ledger) => {
  const e = estimatesOf(ledger);
  const chao = (label, s) => [label, 'Chao2', s.m, s.S, fixed(s.total, 1), fixed(s.f0, 1), pct(s.nextNew), '–'];
  return table(
    ['over', 'estimator', 'occasions', 'distinct', 'est. total', 'unseen', 'next-new', 'overlap'],
    [
      ...Object.entries(e.perSource).map(([source, s]) => chao(source, s)),
      chao('all sources', e.combined),
      ...e.chapman.map((p) => [`${p.a} × ${p.b}`, 'Chapman', '–', p.n1 + p.n2 - p.overlap, fixed(p.total, 1), fixed(p.total - (p.n1 + p.n2 - p.overlap), 1), '–', p.overlap]),
    ],
    [false, false, true, true, true, true, true, true],
  );
};

const defectTable = (ledger) => {
  const sources = [...new Set(ledger.occasions.map((o) => o.source))];
  return table(
    ['id', 'defect', 'where', 'first', ...sources, 'severity'],
    ledger.defects.map((d) => [d.id, d.source ? `${d.claim} (found only by ${d.source})` : d.claim, d.where, d.firstOccasion ?? '–', ...sources.map((s) => d.sources?.[s]?.length ?? 0), d.severity || '–']),
    [false, false, false, true, ...sources.map(() => true), false],
  );
};

/** The report's Markdown for `ledger`, under the stop rule `rule` (`stopRuleOf`). */
export const reportText = (ledger, rule) => {
  const sources = [...new Set(ledger.occasions.map((o) => o.source))];
  const price = nextPriceOf(ledger, rule.factor, rule.priceBy);
  const stop = stopReason(estimatesOf(ledger).combined, rule, { price, lines: ledger.lines });
  const unit = priceUnitFor(rule.priceBy);
  const unpriced = rule.priceBy === 'kloc' && !ledger.lines && ledger.occasions.length >= 2 ? " The next defect has no price: the area's lines are not known, so no price limit stops it." : '';
  const priced = price.usd === undefined ? unpriced : Number.isFinite(price.usd) ? ` The next defect should cost about $${price.usd.toFixed(2)}${unit}.` : ' No new defect is expected.';
  return [
    `# ${ledger.area}: saturation`,
    '',
    `Repeated blind reviews of the area \`${ledger.area}\` (${ledger.files.length} ${ledger.files.length === 1 ? 'file' : 'files'}${ledger.lines ? `, ${ledger.lines} lines` : ''}) at the frozen commit`,
    `\`${ledger.commit.slice(0, 10)}\`, with no fixes between them, from ${sources.length ? sources.map((s) => `\`${s}\``).join(', ') : 'no source yet'}.`,
    'Each occasion is one review, or one ingested report; its findings are matched against the ledger of distinct',
    `defects so far. Reviews stop once fewer than ${ledger.lines ? `${rule.stopUnseenPerKloc} ${rule.stopUnseenPerKloc === 1 ? 'defect' : 'defects'} per thousand lines` : 'one defect'} is estimated unseen, the chance that the next occasion`,
    `finds something new falls under ${Math.round(rule.stopNextNew * 100)}%, the next defect would cost over $${rule.stopUsdPerDefect.toFixed(2)}${unit}, or ${rule.max} occasions have run.`,
    `${stop ? `Stopped: ${stop}.` : 'Not stopped yet.'}${priced} \`skulkr scour report ${ledger.area}\` rewrites this file from the ledger.`,
    '',
    '## Yield by occasion',
    '',
    'The estimates on each row are Chao2 over every occasion up to it. "Unseen" is the estimated number of defects no',
    'occasion has found; "next-new" is the chance the next occasion\'s finding is one of them. "$/defect" is what every',
    'occasion up to the row has cost, divided by the distinct defects found so far.',
    '',
    yieldTable(ledger),
    '',
    '## Estimates',
    '',
    'Chao2 over one source is a floor for what that reviewer can find: its reviews resemble each other, so it misses',
    "the same things every time. Chapman between two sources is better while they find different kinds of defect.",
    '',
    estimatesTable(ledger),
    '',
    '## Defects',
    '',
    'Each source\'s column counts the occasions that found the defect.',
    '',
    defectTable(ledger),
    '',
  ].join('\n');
};

/** Writes `ledger`'s report to `report.md` in `id`'s ledger directory. Answers its path. */
export const writeReport = (cfg, id, ledger, rule) => {
  const path = join(ledgerDirOf(cfg, id), 'report.md');
  writeFileSync(path, reportText(ledger, rule));
  return path;
};
