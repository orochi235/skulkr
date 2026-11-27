import { isDefectClosed, isFixSettled } from './FixShelf';
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

/** The headline counts beside a ledger's facts, each a big figure over its word. */
export function LedgerHero({ ledger }: { ledger: SaturationLedger }) {
  const c = heroCountsOf(ledger);
  // An estimate is set apart by its type (`.estimate`), not a sign before it.
  const stats: [label: string, value: string, tone?: string][] = [
    ['found', String(c.found)],
    ['fixed', String(c.fixed), s.fixed],
    ...(c.fixing ? [['fixing', String(c.fixing), s.fixing] as [string, string, string]] : []),
    ['open', String(c.open), s.open],
    ...(c.dismissed ? [['dismissed', String(c.dismissed)] as [string, string]] : []),
    ['unseen', c.unseen === null ? '–' : String(Math.round(c.unseen)), s.estimate],
  ];
  return (
    <dl className={s.hero} aria-label="Defects at a glance">
      {stats.map(([label, value, tone]) => (
        <div key={label} className={tone ? `${s.stat} ${tone}` : s.stat}>
          <dt className={s.label}>{label}{tone === s.estimate && <span className={s.hidden}> (estimated)</span>}</dt>
          <dd className={s.value} title={tone === s.estimate ? 'an estimate' : undefined}>{value}</dd>
        </div>
      ))}
    </dl>
  );
}
