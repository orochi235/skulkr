import { isDefectClosed, isFixSettled } from './FixShelf';
import { percent, usd, usdOrDash } from './format';
import type { SaturationLedger } from './saturation.types';
import s from './LedgerHero.module.css';

/** A ledger's headline counts: defects found, fixed (settled), out in a fix batch now, still open, closed without a
 *  fix (no defect, a duplicate), and the estimate of those no pass has found. */
export const heroCountsOf = (ledger: SaturationLedger) => {
  const statuses = ledger.fix?.statuses ?? {};
  let fixed = 0, fixing = 0, dismissed = 0;
  for (const d of ledger.defects) {
    const at = statuses[d.id];
    if (isFixSettled(at, d.registry)) fixed++;
    else if (isDefectClosed(at, d.registry)) dismissed++;
    else if (at?.status === 'fixing') fixing++;
  }
  return { found: ledger.distinct, fixed, fixing, open: ledger.defects.length - fixed - dismissed - fixing, dismissed, unseen: ledger.unseen };
};

type Stat = readonly [label: string, value: string, tone?: string];

/** A row of headline figures, each big over its word. An estimate is set apart by its type (`.estimate`), not a sign
 *  before it. */
function StatRow({ label, stats }: { label: string; stats: readonly Stat[] }) {
  return (
    <dl className={s.row} aria-label={label}>
      {stats.map(([word, value, tone]) => (
        <div key={word} className={tone ? `${s.stat} ${tone}` : s.stat}>
          <dt className={s.label}>{word}</dt>
          <dd className={s.value} title={tone === s.estimate ? 'an estimate' : undefined}>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** A ledger's headline figures: its defect counts, and under them what a next pass looks like. */
export function LedgerHero({ ledger }: { ledger: SaturationLedger }) {
  const c = heroCountsOf(ledger);
  const counts: Stat[] = [
    ['found', String(c.found)],
    ['fixed', String(c.fixed), s.fixed],
    ...(c.fixing ? [['fixing', String(c.fixing), s.fixing] as Stat] : []),
    ['open', String(c.open), s.open],
    ...(c.dismissed ? [['dismissed', String(c.dismissed)] as Stat] : []),
    ['left (est.)', c.unseen === null ? '–' : String(Math.round(c.unseen)), s.estimate],
  ];
  const outlook: Stat[] = [
    ['next new', percent(ledger.nextNew), s.estimate],
    ['next defect', usdOrDash(ledger.nextUsd), s.estimate],
    ['limit', usd(ledger.limit.usd)],
  ];
  return (
    <div className={s.hero}>
      <StatRow label="Defects at a glance" stats={counts} />
      <StatRow label="Outlook" stats={outlook} />
    </div>
  );
}
