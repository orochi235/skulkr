import s from './PassPill.module.css';

/** A delve job's key, `07-claude`, split into its pass number and its source; a key of any other shape is all name. */
export const passKeyParts = (key: string): { readonly index: string | null; readonly name: string } => {
  const m = /^(\d+)-(.+)$/.exec(key);
  return m ? { index: m[1]!, name: m[2]! } : { index: null, name: key };
};

/** A delve job's key as a pill: the pass number on the border's color, then the source. */
export function PassPill({ jobKey }: { jobKey: string }) {
  const { index, name } = passKeyParts(jobKey);
  return (
    <span className={s.pill}>
      {index !== null && <span className={s.index}>{index}</span>}
      <span className={s.name}>{name}</span>
    </span>
  );
}
