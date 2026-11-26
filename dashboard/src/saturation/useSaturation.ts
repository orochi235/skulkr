import { useEffect, useState } from 'react';
import { after } from '@weasel-js/registry';
import type { SaturationLedger } from './saturation.types';

export type SaturationState =
  | { readonly status: 'loading' }
  /** `queue`: the areas `scour run` would delve, in its order. `error`: why the last ask failed, the list the one before
   *  it read still shown. */
  | { readonly status: 'ready'; readonly ledgers: readonly SaturationLedger[]; readonly queue: readonly string[]; readonly error?: string }
  | { readonly status: 'failed'; readonly error: string };

/** How often the ledgers are asked for again, so a saturation running meanwhile shows its occasions. */
export const SATURATION_POLL_MS = 30_000;

/** How often while a scour process holds a ledger, so its jobs' lines keep up. */
export const SATURATION_LIVE_POLL_MS = 5_000;

/** Every saturation ledger of a tenant, read from `url` (null for none) and asked for again every `everyMs`. */
export function useSaturation(url: string | null, everyMs: number = SATURATION_POLL_MS): SaturationState {
  const [state, setState] = useState<{ url: string | null; value: SaturationState }>({ url, value: { status: 'loading' } });
  useEffect(() => {
    if (!url) return undefined;
    let live = true;
    let stop = () => {};
    const ask = async () => {
      try {
        const res = await fetch(url, { cache: 'no-store' });
        if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`);
        const body = await res.json() as { ledgers?: unknown; queue?: unknown } | null;
        if (!Array.isArray(body?.ledgers) || !Array.isArray(body.queue)) throw new Error('the server answered something other than ledgers and a queue');
        if (live) setState({ url, value: { status: 'ready', ledgers: body.ledgers as SaturationLedger[], queue: body.queue as string[] } });
      } catch (e) {
        const error = (e as Error).message;
        if (live) setState((was) => ({ url, value: was.url === url && was.value.status === 'ready' ? { ...was.value, error } : { status: 'failed', error } }));
      }
    };
    const loop = () => {
      void ask().finally(() => {
        if (live) stop = after(everyMs, loop);
      });
    };
    loop();
    return () => {
      live = false;
      stop();
    };
  }, [url, everyMs]);
  return state.url === url ? state.value : { status: 'loading' };
}
