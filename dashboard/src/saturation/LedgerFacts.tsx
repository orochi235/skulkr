import type { ReactNode } from 'react';
import { estimate, linesText, percent, sourcesText, usd, usdOrDash } from './format';
import type { SaturationLedger } from './saturation.types';
import s from './LedgerFacts.module.css';

/** A label, its value, and whether the value is an estimate (set in italic, as the hero's are). */
type Fact = readonly [label: string, value: ReactNode, estimated?: boolean];

/** A ledger's single-valued facts: what the area is and what has run on it, and what a next pass looks like. */
export const factListsOf = (ledger: SaturationLedger): readonly { title: string; facts: readonly Fact[] }[] => [
  {
    title: 'Scope & effort',
    facts: [
      ['files', ledger.files],
      ['lines', linesText(ledger.lines)],
      ['commit', <code key="c">{ledger.commit.slice(0, 10)}</code>],
      ['passes', ledger.occasions],
      ['by', sourcesText(ledger.sources)],
    ],
  },
  {
    title: 'Outlook',
    facts: [
      ['held', estimate(ledger.total), true],
      ['next new', percent(ledger.nextNew), true],
      ['next defect', usdOrDash(ledger.nextUsd), true],
      ['limit', ledger.limit.times === null ? usd(ledger.limit.usd) : `${usd(ledger.limit.usd)} (${ledger.limit.times}×)`],
    ],
  },
];

/** The yield grid: found, left and spent, each for the whole area, per thousand lines (where lines are known), and per
 *  pass. Left has no per-pass figure. */
export const yieldGridOf = (ledger: SaturationLedger) => {
  const passes = ledger.occasions;
  const kloc = ledger.lines !== null;
  const per = (n: number | null) => (n === null || passes === 0 ? null : n / passes);
  const cols = ['area', ...(kloc ? ['/ kloc'] : []), '/ pass'];
  const row = (label: string, area: string, perKloc: string, perPass: string, estimated = false) =>
    ({ label, estimated, cells: [area, ...(kloc ? [perKloc] : []), perPass] });
  return {
    cols,
    rows: [
      row('found', String(ledger.distinct), estimate(ledger.defectsPerKloc), estimate(per(ledger.distinct))),
      row('left', ledger.unseen === null ? '–' : String(Math.round(ledger.unseen)), estimate(ledger.unseenPerKloc), '–', true),
      row('spent', usd(ledger.costUsd), usdOrDash(ledger.usdPerKloc), usdOrDash(per(ledger.costUsd))),
    ],
  };
};

function FactList({ title, facts, area }: { title: string; facts: readonly Fact[]; area: string }) {
  return (
    <section className={area} aria-label={title}>
      <h3 className={s.title}>{title}</h3>
      <dl className={s.list}>
        {facts.map(([label, value, estimated]) => (
          <div key={label} className={s.row}><dt>{label}</dt><dd className={estimated ? s.estimate : undefined}>{value}</dd></div>
        ))}
      </dl>
    </section>
  );
}

function YieldGrid({ ledger }: { ledger: SaturationLedger }) {
  const { cols, rows } = yieldGridOf(ledger);
  return (
    <section className={s.yield} aria-label="Yield">
      <table className={s.grid}>
        <thead>
          <tr><th scope="col" className={s.title}>Yield</th>{cols.map((c) => <th key={c} scope="col">{c}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label} className={r.estimated ? s.estimate : undefined}>
              <th scope="row">{r.label}</th>
              {r.cells.map((v, i) => <td key={cols[i]}>{v}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

/** The facts under a ledger's name: its single-valued facts in two columns with the yield grid between them, and its
 *  stop rule's state. */
export function LedgerFacts({ ledger }: { ledger: SaturationLedger }) {
  const [scope, outlook] = factListsOf(ledger);
  return (
    <div className={s.facts}>
      <div className={s.groups}>
        <FactList {...scope!} area={s.scope!} />
        <YieldGrid ledger={ledger} />
        <FactList {...outlook!} area={s.outlook!} />
      </div>
      <p className={ledger.stopped ? `${s.stop} ${s.stopped}` : s.stop}>
        {ledger.stopped ? <>Stopped: {ledger.stopped}.</> : 'Not saturated yet: the stop rule does not hold.'}
      </p>
    </div>
  );
}
