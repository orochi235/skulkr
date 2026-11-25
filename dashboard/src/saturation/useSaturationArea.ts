import { useEffect, useState } from 'react';
import { hashFor, readHash } from '@dash/hash';

/** The area picked on the saturation page, and how to pick one (null to clear): kept in the URL hash, replacing the
 *  entry rather than adding one, so it survives a reload and can be shared. */
export function useSaturationArea(tenant: string | null): [string | null, (area: string | null) => void] {
  const [area, setArea] = useState(() => readHash().area);
  useEffect(() => {
    const onHash = () => setArea(readHash().area);
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const pick = (next: string | null) => {
    setArea(next);
    if (tenant !== null) window.history.replaceState(window.history.state, '', hashFor({ tenant, round: null, view: 'saturation', area: next }));
  };
  return [area, pick];
}
