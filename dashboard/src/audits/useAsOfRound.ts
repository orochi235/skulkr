import { useEffect, useState } from 'react';
import { hashFor, readHash } from '@dash/hash';

/** The past round the map is shown after, null for now, and how to change it: kept in the URL hash beside `tenant`,
 *  replacing the entry rather than adding one, so it survives a reload and can be shared. */
export function useAsOfRound(tenant: string | null): [number | null, (round: number | null) => void] {
  const [round, setRound] = useState(() => readHash().round);
  useEffect(() => {
    const onHash = () => setRound(readHash().round);
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const choose = (next: number | null) => {
    setRound(next);
    if (tenant !== null) window.history.replaceState(window.history.state, '', hashFor({ tenant, round: next }));
  };
  return [round, choose];
}
