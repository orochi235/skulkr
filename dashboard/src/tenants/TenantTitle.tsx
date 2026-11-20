import s from './TenantTitle.module.css';

/** The page's title with the project as a menu of every tenant the dashboard reads, there with only one too. */
export function TenantTitle({ names, current, onChoose }: { names: readonly string[]; current: string; onChoose: (name: string) => void }) {
  return (
    <span className={s.title}>
      <span className={s.pick}>
        <select className={s.menu} aria-label="Project" value={current} onChange={(e) => onChoose(e.target.value)}>
          {names.map((name) => <option key={name} value={name}>{name}</option>)}
        </select>
      </span>
      {' audits'}
    </span>
  );
}
