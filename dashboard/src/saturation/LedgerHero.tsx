import type { ReactNode } from 'react';
import { Focusable, Tooltip, TooltipTrigger } from '@weasel-js/ui/components/Tooltip';
import { isDefectClosed, isFixSettled, tileClassOf } from './FixShelf';
import { percent, usd, usdOrDash } from './format';
import type { SaturationLedger } from './saturation.types';
import s from './LedgerHero.module.css';

/** A ledger's headline counts: defects found, fixed (settled), out in a fix batch now, still open, closed without a
 *  fix (no defect, a duplicate), and the estimate of those no pass has found. */
export const heroCountsOf = (ledger: SaturationLedger) => {
  const statuses = ledger.fix?.statuses ?? {};
  let fixed = 0, fixing = 0, ignored = 0;
  for (const d of ledger.defects) {
    const at = statuses[d.id];
    if (isFixSettled(at, d.registry)) fixed++;
    else if (isDefectClosed(at, d.registry)) ignored++;
    else if (at?.status === 'fixing') fixing++;
  }
  return { found: ledger.distinct, fixed, fixing, open: ledger.defects.length - fixed - ignored - fixing, ignored, unseen: ledger.unseen };
};

/** A figure: its word, its value, a tone class, and a note shown in a tooltip over its word. */
export type Stat = readonly [label: string, value: ReactNode, tone?: string, tip?: string];

/** The tones a figure can take beyond plain: an estimate (a lighter weight), a light one, or a clock (light; a
 *  `LiveQuantity` keeps its width, so its changing digits never move what follows). */
export const STAT_TONE = { estimate: s.estimate!, light: s.light!, clock: s.clock! } as const;

/** The tone of a count the fix shelf colors too: its tile's color as a bar over it. */
export const shelfToneOf = (status: Parameters<typeof tileClassOf>[0]): string => `${s.tiled} ${tileClassOf(status)}`;

/** A ledger's next defect's price in tone `tone`, amber once it passes the limit a delve stops at. */
export const nextDefectStatOf = (ledger: SaturationLedger, tone: string): Stat => {
  const over = ledger.nextUsd !== null && ledger.nextUsd > ledger.limit.usd;
  return ['next defect', usdOrDash(ledger.nextUsd), over ? `${tone} ${s.over}` : tone];
};

/** A row of headline figures, each big over its word. An estimate is set apart by its type (`.estimate`), not a sign
 *  before it. */
export function StatRow({ label, stats }: { label: string; stats: readonly Stat[] }) {
  return (
    <dl className={s.row} aria-label={label}>
      {stats.map(([word, value, tone, tip]) => (
        <div key={word} className={tone ? `${s.stat} ${tone}` : s.stat}>
          <dt className={s.label}>
            {tip ? (
              <TooltipTrigger>
                <Focusable><span className={s.tipped} role="button" tabIndex={0}>{word}</span></Focusable>
                <Tooltip placement="top">{tip}</Tooltip>
              </TooltipTrigger>
            ) : word}
          </dt>
          <dd className={s.value} title={tone?.split(' ').includes(s.estimate!) ? 'an estimate' : undefined}>{value}</dd>
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
    ['fixed', String(c.fixed), shelfToneOf('fixed')],
    ...(c.fixing ? [['fixing', String(c.fixing), shelfToneOf('fixing')] as Stat] : []),
    ['open', String(c.open), shelfToneOf('waiting')],
    ...(c.ignored ? [['ignored', String(c.ignored)] as Stat] : []),
    ['left (est.)', c.unseen === null ? '–' : String(Math.round(c.unseen)), s.estimate],
  ];
  const outlook: Stat[] = [
    ['next new', percent(ledger.nextNew), s.estimate],
    nextDefectStatOf(ledger, s.estimate!),
    ['limit', usd(ledger.limit.usd)],
  ];
  return (
    <div className={s.hero}>
      <StatRow label="Defects at a glance" stats={counts} />
      <StatRow label="Outlook" stats={outlook} />
    </div>
  );
}
