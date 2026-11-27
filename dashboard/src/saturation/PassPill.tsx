import s from './PassPill.module.css';

/** A live job's key split into its number and its name: a delve's `07-claude` (pass and source), a fix run's `b2`
 *  (batch); a key of any other shape is all name. */
export const passKeyParts = (key: string): { readonly index: string | null; readonly name: string } => {
  const batch = /^b(\d+)$/.exec(key);
  if (batch) return { index: batch[1]!, name: 'batch' };
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
