import { InlineMarkdown } from '@weasel-js/ui/components/InlineMarkdown';
import { FixStatusChip, shelfStatusOf } from './FixShelf';
import type { SaturationLedger } from './saturation.types';
import s from './DefectCallout.module.css';

/** How far the card sits from the pointer, so the pointer never covers it. */
const OFFSET = 14;

/** The traced defect's row in brief, floated above the pointer at `at` (relative to the positioned parent), so a tile
 *  hovered on either chart reads without a click and a scroll. Flips left of the pointer past `flipX`. */
export function DefectCallout({ ledger, id, at, flipX }: {
  ledger: SaturationLedger; id: string | null; at: { x: number; y: number } | null; flipX: number;
}) {
  const d = id ? ledger.defects.find((x) => x.id === id) : undefined;
  if (!d || !at) return null;
  const entry = ledger.fix?.statuses[d.id];
  const flip = at.x > flipX;
  return (
    <div
      className={flip ? `${s.callout} ${s.flip}` : s.callout} role="tooltip"
      style={{ '--x': `${at.x + (flip ? -OFFSET : OFFSET)}px`, '--y': `${at.y - OFFSET}px` } as React.CSSProperties}
    >
      <div className={s.head}>
        <span className={s.id}>{d.id}</span>
        {d.severity && <span>{d.severity}</span>}
        {ledger.fix && <FixStatusChip status={shelfStatusOf(entry)} />}
      </div>
      <p className={s.claim}><InlineMarkdown text={d.claim} /></p>
      <p className={s.where}><InlineMarkdown text={d.where} /></p>
      {entry?.why && <p className={s.why}><InlineMarkdown text={entry.why} /></p>}
      <p className={s.seen}>seen in {d.sightings} of {ledger.occasions} passes{d.recurrent ? ' · recurrent' : ''}</p>
    </div>
  );
}
