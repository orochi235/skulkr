import { Icon } from '@weasel-js/ui/components/Icon';
import { icon } from '@dash/icons.gen';
import type { AuditArea } from './skulkrMap.types';
import s from './NextUp.module.css';
import { ordinal } from './ordinal';

/** The areas a run would pick next, in queue order; each picks its cell on the map, and lights it while hovered. */

export function NextUp({ areas, onPick, onLight }: {
  areas: readonly AuditArea[]; onPick: (id: string) => void; onLight: (id: string | null) => void;
}) {
  return (
    <ol className={s.list}>
        {areas.map((a) => (
          <li key={a.id} value={a.queue ?? undefined}>
            <button
              type="button" className={s.pick} onClick={() => onPick(a.id)}
              onPointerEnter={() => onLight(a.id)} onPointerLeave={() => onLight(null)} onFocus={() => onLight(a.id)} onBlur={() => onLight(null)}
            >
              <span className={s.id}>{a.id}</span>
              <span className={s.files} title={`${a.files} source files`}>
                {a.files}<Icon name={icon('ui:page')} size={11} className={s.page} />
                <span className={s.fresh} title={a.passes.length === 0 ? 'never audited' : `its ${ordinal(a.passes.length + 1)} pass`}>
                  {a.passes.length === 0 ? 'new' : ordinal(a.passes.length + 1)}
                </span>
              </span>
            </button>
          </li>
        ))}
    </ol>
  );
}
