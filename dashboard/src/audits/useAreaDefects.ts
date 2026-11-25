import { useEffect, useState } from 'react';
import { listenToMap } from './mapEvents';
import type { AuditAreaRound } from './skulkrMap.types';

export type AreaDefectsState =
  | { readonly status: 'loading' }
  /** `error`: why the last ask failed, the list the one before it read still shown. */
  | { readonly status: 'ready'; readonly rounds: readonly AuditAreaRound[]; readonly error?: string }
  | { readonly status: 'failed'; readonly error: string };

/** Every round's defects in area `id`, read from `urlOf(id)`, asked for again whenever `version` changes or `eventsUrl`
 *  says a running round wrote the area's files. A failed ask keeps the area's last list and says why, as the map's does. */
export function useAreaDefects(urlOf: (id: string) => string, id: string, version: string, eventsUrl: string | null = null): AreaDefectsState {
  const url = urlOf(id);
  const [state, setState] = useState<{ key: string; value: AreaDefectsState }>({ key: '', value: { status: 'loading' } });
  const [touched, setTouched] = useState(0);
  useEffect(() => {
    if (!eventsUrl) return undefined;
    const pushed = listenToMap(eventsUrl, { areas: (ids) => { if (ids.includes(id)) setTouched((n) => n + 1); } });
    return () => pushed?.stop();
  }, [eventsUrl, id]);
  const key = `${url}\n${id}\n${version}\n${touched}`;
  const sameArea = (k: string) => k.startsWith(`${url}\n${id}\n`);
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
        (e: Error) => live && setState((was) => ({
          key,
          value: was.value.status === 'ready' && sameArea(was.key)
            ? { status: 'ready', rounds: was.value.rounds, error: e.message }
            : { status: 'failed', error: e.message },
        })));
    return () => { live = false; };
  }, [url, id, key]);
  // A new area shows as loading rather than the last one's list.
  return state.key === key || state.value.status === 'ready' && sameArea(state.key) ? state.value : { status: 'loading' };
}
