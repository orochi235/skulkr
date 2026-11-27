import type { ReactNode } from 'react';
import { estimate, linesText, percent, sourcesText, usd, usdOrDash } from './format';
import type { SaturationLedger } from './saturation.types';
import s from './LedgerFacts.module.css';

/** A label, its value, and whether the value is an estimate (set in italic, as the hero's are). */
type Fact = readonly [label: string, value: ReactNode, estimated?: boolean];

/** A ledger's facts in three groups: what the area is, what its passes cost, and what a next pass looks like. */
export const factGroupsOf = (ledger: SaturationLedger): readonly { title: string; facts: readonly Fact[] }[] => {
  const kloc = ledger.lines !== null;
  return [
    {
      title: 'Scope',
      facts: [
        ['files', ledger.files],
        ['lines', linesText(ledger.lines)],
        ['commit', <code key="c">{ledger.commit.slice(0, 10)}</code>],
        ...(kloc ? [['found / kloc', estimate(ledger.defectsPerKloc)] as Fact, ['left / kloc', estimate(ledger.unseenPerKloc), true] as Fact] : []),
      ],
    },
    {
      title: 'Effort',
      facts: [
        ['passes', ledger.occasions],
        ['by', sourcesText(ledger.sources)],
        ['spent', usd(ledger.costUsd)],
        ...(kloc ? [['spent / kloc', usdOrDash(ledger.usdPerKloc)] as Fact] : []),
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
};

/** The facts under a ledger's name as a compact table of three label-and-value columns, and its stop rule's state. */
export function LedgerFacts({ ledger }: { ledger: SaturationLedger }) {
  return (
    <div className={s.facts}>
      <div className={s.groups}>
        {factGroupsOf(ledger).map((g) => (
          <section key={g.title} className={s.group} aria-label={g.title}>
            <h3 className={s.title}>{g.title}</h3>
            <dl className={s.list}>
              {g.facts.map(([label, value, estimated]) => (
                <div key={label} className={s.row}><dt>{label}</dt><dd className={estimated ? s.estimate : undefined}>{value}</dd></div>
              ))}
            </dl>
          </section>
        ))}
      </div>
      <p className={ledger.stopped ? `${s.stop} ${s.stopped}` : s.stop}>
        {ledger.stopped ? <>Stopped: {ledger.stopped}.</> : 'Not saturated yet: the stop rule does not hold.'}
      </p>
    </div>
  );
}
