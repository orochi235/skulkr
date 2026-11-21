import type { AreaHandlers } from './LiveRuns';
import type { AuditRun } from './skulkrMap.types';
import s from './LeftOut.module.css';

/** Every branch the run's batch left out, as the map lists them: its area, the round whose branch it is, and why. */
export function LeftOut({ run, on }: { run: AuditRun; on: AreaHandlers }) {
  if (!run.leftOut?.length) return null;
  return (
    <table className={s.table} aria-label={`Round ${run.round}, left out of the batch`}>
      <thead>
        <tr><th className={s.l}>left out</th><th>round</th><th className={s.l}>why</th></tr>
      </thead>
      <tbody>
        {run.leftOut.map((e) => (
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
