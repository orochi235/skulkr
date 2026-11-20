import { useEffect, useState } from 'react';
import { after } from '@weasel-js/registry';
import type { SkulkrMap } from './skulkrMap.types';

export type SkulkrMapState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly map: SkulkrMap; readonly error?: string }
  | { readonly status: 'failed'; readonly error: string }
  /** No dev server answers the route: a build, or a server without the plugin. */
  | { readonly status: 'no-server' };

/** How often the page asks again. Each ask runs `map.mjs`, which asks onto for its running jobs. */
export const POLL_MS = 15_000;

const KEPT = 'skulkr-map:';

/** The map this viewer last drew from `url`, so a reload draws at once; none where storage is empty or refused. */
export function keptMapOf(url: string): SkulkrMap | null {
  try {
    const text = localStorage.getItem(KEPT + url);
    return text ? (JSON.parse(text) as SkulkrMap) : null;
  } catch {
    return null;
  }
}

function keepMap(url: string, map: SkulkrMap): void {
  try {
    localStorage.setItem(KEPT + url, JSON.stringify(map));
  } catch {
    // Full or refused storage costs only the instant first draw on the next load.
  }
}

/** Where a tenant's map starts: the copy this viewer kept, or loading. */
const startOf = (url: string | null): SkulkrMapState => {
  const kept = url ? keptMapOf(url) : null;
  return kept ? { status: 'ready', map: kept } : { status: 'loading' };
};

export interface UseSkulkrMapOptions {
  /** A tenant's map route; none yet asks for nothing. */
  readonly url: string | null;
  readonly everyMs?: number;
  /** Whether a server with the data routes can be there at all: the dev server or the preview of a build. A page
   *  hosted with neither finds out from the route's answer and says so. */
  readonly dev?: boolean;
}

/**
 * The audit map's data from the dev server, asked for again every `everyMs` while the page is visible, and at
 * once when it becomes visible again. A failed ask keeps the last map it had and says why. It starts from the map this
 * viewer last drew from `url`, kept in local storage, so a reload draws at once and the first answer replaces it.
 */
export function useSkulkrMap(options: UseSkulkrMapOptions): SkulkrMapState {
  const { url, everyMs = POLL_MS, dev = true } = options;
  const [state, setState] = useState<SkulkrMapState>(() => (dev ? startOf(url) : { status: 'no-server' }));
  useEffect(() => {
    if (!dev || url === null) return;
    // Another tenant's map is not this one's: start from the copy kept for this one, or from loading.
    setState(startOf(url));
    let live = true;
    let stop = () => {};
    let asking = false;
    const noServer = () =>
      setState((was) => (was.status === 'ready' ? { ...was, error: 'the dev server no longer answers the route' } : { status: 'no-server' }));
    const ask = async () => {
      try {
        const res = await fetch(url, { cache: 'no-store' });
        if (!live) return;
        // Vite answers a route no plugin serves with its index.html fallback, not a 404.
        if (res.status === 404 || res.headers.get('content-type')?.includes('text/html')) return noServer();
        if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`);
        const map = (await res.json()) as SkulkrMap;
        if (!live) return;
        keepMap(url, map);
        setState({ status: 'ready', map });
      } catch (e) {
        if (!live) return;
        const error = (e as Error).message;
        setState((was) => (was.status === 'ready' ? { ...was, error } : { status: 'failed', error }));
      }
    };
    const loop = () => {
      if (!live || document.hidden) return;
      asking = true;
      void ask().finally(() => {
        asking = false;
        if (live) stop = after(everyMs, loop);
      });
    };
    const onVisible = () => {
      if (document.hidden || asking) return;
      stop();
      loop();
    };
    document.addEventListener('visibilitychange', onVisible);
    loop();
    return () => {
      live = false;
      stop();
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [url, everyMs, dev]);
  return state;
}
