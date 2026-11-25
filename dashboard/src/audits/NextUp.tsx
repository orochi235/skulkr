import { Icon } from '@weasel-js/ui/components/Icon';
import { icon } from '@dash/icons.gen';
import type { AuditArea } from './skulkrMap.types';
import s from './NextUp.module.css';
import { ordinal } from './ordinal';
import { roundCountOf } from './areaData';

/** A list of areas, by default the ones a run would pick next, numbered by their queue places; each picks its cell on
 *  the map, and lights it while hovered. */
export function NextUp({ areas, onPick, onLight, note, numbered = true }: {
  areas: readonly AuditArea[]; onPick: (id: string) => void; onLight: (id: string | null) => void;
  /** A line above the list, as when the map beside it shows a past round and the queue is today's. */
  note?: string | undefined;
  /** Whether each carries its queue place; false for a list in another order, as the filter's matches. */
  numbered?: boolean;
}) {
  const List = numbered ? 'ol' : 'ul';
  return (
    <>
      {note && <p className={s.note}>{note}</p>}
      <List className={numbered ? s.list : `${s.list} ${s.plain}`}>
        {areas.map((a) => (
          <li key={a.id} value={numbered ? a.queue ?? undefined : undefined}>
            <button
              type="button" className={s.pick} onClick={() => onPick(a.id)}
              onPointerEnter={() => onLight(a.id)} onPointerLeave={() => onLight(null)} onFocus={() => onLight(a.id)} onBlur={() => onLight(null)}
            >
              <span className={s.id}>{a.id}</span>
              <span className={s.files} title={`${a.files} source files`}>
                {a.files}<Icon name={icon('ui:page')} size={11} className={s.page} />
                <span className={s.fresh} title={a.passes.length === 0 ? 'never audited' : `its ${ordinal(roundCountOf(a) + 1)} pass`}>
                  {a.passes.length === 0 ? 'new' : ordinal(roundCountOf(a) + 1)}
                </span>
              </span>
            </button>
          </li>
        ))}
      </List>
    </>
  );
}
