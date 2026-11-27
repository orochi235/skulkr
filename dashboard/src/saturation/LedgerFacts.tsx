import type { ReactNode } from 'react';
import { estimate, linesText, sourcesText, usd, usdOrDash } from './format';
import { heroCountsOf } from './LedgerHero';
import type { SaturationLedger } from './saturation.types';
import s from './LedgerFacts.module.css';

/** A label, its value, and whether the value is an estimate (set in italic, as the hero's are). */
type Fact = readonly [label: string, value: ReactNode, estimated?: boolean];

/** A ledger's single-valued facts: what the area is and what has run on it. What a next pass looks like is the hero's. */
export const scopeFactsOf = (ledger: SaturationLedger): readonly Fact[] => [
  ['files', ledger.files],
  ['lines', linesText(ledger.lines)],
  ['commit', <code key="c">{ledger.commit.slice(0, 10)}</code>],
  ['passes', ledger.occasions],
  ['by', sourcesText(ledger.sources)],
];

/** The yield grid: found, fixed (the hero's count), left and spent, each for the whole area, per thousand lines (where
 *  lines are known), and per pass. Fixed and left have no per-pass figure. */
export const yieldGridOf = (ledger: SaturationLedger) => {
  const passes = ledger.occasions;
  const kloc = ledger.lines !== null;
  const per = (n: number | null) => (n === null || passes === 0 ? null : n / passes);
  const { fixed } = heroCountsOf(ledger);
  const cols = ['area', ...(kloc ? ['/ kloc'] : []), '/ pass'];
  const row = (label: string, area: string, perKloc: string, perPass: string, estimated = false) =>
    ({ label, estimated, cells: [area, ...(kloc ? [perKloc] : []), perPass] });
  return {
    cols,
    rows: [
      row('found', String(ledger.distinct), estimate(ledger.defectsPerKloc), estimate(per(ledger.distinct))),
      row('fixed', String(fixed), kloc ? estimate(fixed / (ledger.lines! / 1000)) : '–', '–'),
      row('left', ledger.unseen === null ? '–' : String(Math.round(ledger.unseen)), estimate(ledger.unseenPerKloc), '–', true),
      row('spent', usd(ledger.costUsd), usdOrDash(ledger.usdPerKloc), usdOrDash(per(ledger.costUsd))),
    ],
  };
};

function FactList({ title, facts }: { title: string; facts: readonly Fact[] }) {
  return (
    <section className={s.box} aria-label={title}>
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
    <section className={s.box} aria-label="Yield">
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

/** The facts under a ledger's name: the yield grid beside its single-valued facts, and its stop rule's state. */
export function LedgerFacts({ ledger }: { ledger: SaturationLedger }) {
  return (
    <div className={s.facts}>
      <div className={s.groups}>
        <YieldGrid ledger={ledger} />
        <FactList title="Scope & effort" facts={scopeFactsOf(ledger)} />
      </div>
      <p className={ledger.stopped ? `${s.stop} ${s.stopped}` : s.stop}>
        {ledger.stopped ? <>Stopped: {ledger.stopped}.</> : 'Not saturated yet: the stop rule does not hold.'}
      </p>
    </div>
  );
}
