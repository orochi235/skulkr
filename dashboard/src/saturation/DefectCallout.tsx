import { useState, type PointerEvent } from 'react';
import { InlineMarkdown } from '@weasel-js/ui/components/InlineMarkdown';
import { Tooltip } from '@weasel-js/ui/components/Tooltip';
import { FixStatusChip, shelfStatusOf } from './FixShelf';
import type { SaturationLedger } from './saturation.types';
import s from './DefectCallout.module.css';

/** A traced defect and the pointer, in client coordinates, for a `DefectCallout`: `hostEvents` go on the element whose
 *  tiles trace it. */
export function useDefectCallout<T extends HTMLElement>() {
  const [traced, setTraced] = useState<string | null>(null);
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  const hostEvents = {
    onPointerMove: (e: PointerEvent<T>) => setAt({ x: e.clientX, y: e.clientY }),
    onPointerLeave: () => setAt(null),
  };
  return { hostEvents, traced, setTraced, at };
}

/** How far the card sits from the pointer, so the pointer never covers it. */
const OFFSET = 14;

/** The traced defect's row in brief, above the pointer at `at` (client coordinates), or below it where there is no
 *  room above, so a tile hovered on either chart reads without a click and a scroll. */
export function DefectCallout({ ledger, id, at }: {
  ledger: SaturationLedger; id: string | null; at: { x: number; y: number } | null;
}) {
  const d = id ? ledger.defects.find((x) => x.id === id) : undefined;
  if (!d || !at) return null;
  const entry = ledger.fix?.statuses[d.id];
  return (
    <Tooltip open anchorRect={{ x: at.x, y: at.y, width: 0, height: 0 }} placement="top" offset={OFFSET} className={s.callout}>
      <div className={s.head}>
        <span className={s.id}>{d.id}</span>
        {d.severity && <span>{d.severity}</span>}
        {ledger.fix && <FixStatusChip status={shelfStatusOf(entry)} />}
      </div>
      <p className={s.claim}><InlineMarkdown text={d.claim} /></p>
      <p className={s.where}><InlineMarkdown text={d.where} /></p>
      {entry?.why && <p className={s.why}><InlineMarkdown text={entry.why} /></p>}
      <p className={s.seen}>seen in {d.sightings} of {ledger.occasions} passes{d.recurrent ? ' · recurrent' : ''}</p>
    </Tooltip>
  );
}
