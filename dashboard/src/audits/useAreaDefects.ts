import { useEffect, useState } from 'react';
import type { AuditAreaRound } from './skulkMap.types';

export type AreaDefectsState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly rounds: readonly AuditAreaRound[] }
  | { readonly status: 'failed'; readonly error: string };

/** Every round's defects in area `id` from the dashboard's dev server at `url` (a tenant's area route), asked for
 *  again whenever `version` changes. */
export function useAreaDefects(url: string, id: string, version: string): AreaDefectsState {
  const [state, setState] = useState<{ key: string; value: AreaDefectsState }>({ key: '', value: { status: 'loading' } });
  const key = `${url}\n${id}\n${version}`;
  useEffect(() => {
    let live = true;
    fetch(`${url}?id=${encodeURIComponent(id)}`, { cache: 'no-store' })
      .then(async (res) => {
        if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`);
        const rounds: unknown = await res.json();
        if (!Array.isArray(rounds)) throw new Error('the dev server answered something other than a list of rounds');
        return rounds as AuditAreaRound[];
      })
      .then((rounds) => live && setState({ key, value: { status: 'ready', rounds } }),
        (e: Error) => live && setState({ key, value: { status: 'failed', error: e.message } }));
    return () => { live = false; };
  }, [url, id, key]);
  // A new area shows as loading rather than the last one's list.
  return state.key === key || state.value.status === 'ready' && state.key.startsWith(`${url}\n${id}\n`) ? state.value : { status: 'loading' };
}
