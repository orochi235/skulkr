import type { AreaHandlers } from './LiveRuns';
import type { AuditLeftOut } from './skulkrMap.types';
import s from './LeftOut.module.css';

/** Branches a batch left out: each one's area, the round whose branch it is, and why. */
export function LeftOut({ entries, label, name, on }: { entries: readonly AuditLeftOut[]; label: string; name: string; on: AreaHandlers }) {
  if (!entries.length) return null;
  return (
    <table className={s.table} aria-label={name}>
      <thead>
        <tr><th className={s.l}>{label}</th><th>round</th><th className={s.l}>why</th></tr>
      </thead>
      <tbody>
        {entries.map((e) => (
          <tr key={`${e.round}\n${e.area}`}>
            <td className={s.l}>
              <button
                type="button" className={s.area} onClick={() => on.onPick(e.area)}
                onPointerEnter={() => on.onLight(e.area)} onPointerLeave={() => on.onLight(null)} onFocus={() => on.onLight(e.area)} onBlur={() => on.onLight(null)}
              >
                {e.area}
              </button>
            </td>
            <td>{e.round}</td>
            <td className={`${s.l} ${s.why}`}>{e.why}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
