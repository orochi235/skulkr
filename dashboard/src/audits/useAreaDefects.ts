import { useEffect, useState } from 'react';
import type { AuditAreaRound } from './skulkrMap.types';

export type AreaDefectsState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly rounds: readonly AuditAreaRound[] }
  | { readonly status: 'failed'; readonly error: string };

/** Every round's defects in area `id`, read from `urlOf(id)`, asked for again whenever `version` changes. */
export function useAreaDefects(urlOf: (id: string) => string, id: string, version: string): AreaDefectsState {
  const url = urlOf(id);
  const [state, setState] = useState<{ key: string; value: AreaDefectsState }>({ key: '', value: { status: 'loading' } });
  const key = `${url}\n${id}\n${version}`;
  useEffect(() => {
    let live = true;
    fetch(url, { cache: 'no-store' })
      .then(async (res) => {
        if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`);
        const rounds: unknown = await res.json();
        if (!Array.isArray(rounds)) throw new Error('the server answered something other than a list of rounds');
        return rounds as AuditAreaRound[];
      })
      .then((rounds) => live && setState({ key, value: { status: 'ready', rounds } }),
        (e: Error) => live && setState({ key, value: { status: 'failed', error: e.message } }));
    return () => { live = false; };
  }, [url, id, key]);
  // A new area shows as loading rather than the last one's list.
  return state.key === key || state.value.status === 'ready' && state.key.startsWith(`${url}\n${id}\n`) ? state.value : { status: 'loading' };
}
