import { useEffect, useState } from 'react';
import { after } from '@weasel-js/registry';
import { useViewerPref } from '@dash/audits/viewerPref';
import { hashFor, readHash } from '@dash/hash';

export type TenantsState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly names: readonly string[] }
  | { readonly status: 'failed'; readonly error: string }
  /** No dev server answers the route: a build, or a server without the plugin. */
  | { readonly status: 'no-server' };

/** How often the list is asked for again, so a tenant registered meanwhile shows up. */
export const TENANTS_POLL_MS = 60_000;

const KEPT = 'skulkr-tenants:';

/** The tenant names this viewer last read from `url`, so a reload names its tenant, and draws its kept map, at once. */
function keptNamesOf(url: string): readonly string[] | null {
  try {
    const names: unknown = JSON.parse(localStorage.getItem(KEPT + url) ?? 'null');
    return Array.isArray(names) && names.length && names.every((n) => typeof n === 'string') ? names : null;
  } catch {
    return null;
  }
}

function keepNames(url: string, names: readonly string[]): void {
  try {
    localStorage.setItem(KEPT + url, JSON.stringify(names));
  } catch {
    // Full or refused storage costs only the instant first draw on the next load.
  }
}

/** The tenants the dashboard's dev server reads, from `url`, asked for again every `everyMs`. It starts from the list
 *  this viewer last read, kept in local storage, and the first answer replaces it. */
export function useTenants({ url, dev, everyMs = TENANTS_POLL_MS }: { url: string; dev: boolean; everyMs?: number }): TenantsState {
  const [state, setState] = useState<TenantsState>(() => {
    if (!dev) return { status: 'no-server' };
    const kept = keptNamesOf(url);
    return kept ? { status: 'ready', names: kept } : { status: 'loading' };
  });
  useEffect(() => {
    if (!dev) return;
    let live = true;
    let stop = () => {};
    const ask = async () => {
      try {
        const res = await fetch(url, { cache: 'no-store' });
        if (!live) return;
        // Vite answers a route no plugin serves with its index.html fallback, not a 404.
        if (res.status === 404 || res.headers.get('content-type')?.includes('text/html')) {
          setState((was) => (was.status === 'ready' ? was : { status: 'no-server' }));
          return;
        }
        if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`);
        const list = (await res.json()) as { name: string }[];
        const names = list.map((t) => t.name);
        keepNames(url, names);
        if (live) setState((was) => (was.status === 'ready' && was.names.join('\n') === names.join('\n') ? was : { status: 'ready', names }));
      } catch (e) {
        if (live) setState((was) => (was.status === 'ready' ? was : { status: 'failed', error: (e as Error).message }));
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
  }, [url, dev, everyMs]);
  return state;
}

/**
 * Which of `names` the page shows, and how to change it: the one the URL hash names, else the one this viewer chose
 * last, else the first. Choosing one puts it in the hash, in place of any round the map was shown after, and remembers it.
 */
export function useTenantChoice(names: readonly string[]): [string | null, (name: string) => void] {
  const [stored, , keep] = useViewerPref('tenant', '', (s) => s);
  const [hash, setHash] = useState(() => readHash().tenant);
  useEffect(() => {
    const onHash = () => setHash(readHash().tenant);
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const [picked, setPicked] = useState<string | null>(null);
  const choice = [hash, picked, stored].find((n) => n && names.includes(n)) ?? names[0] ?? null;
  const choose = (name: string) => {
    setPicked(name);
    setHash(name);
    keep(name);
    window.location.hash = hashFor({ tenant: name, round: null });
  };
  return [choice, choose];
}
