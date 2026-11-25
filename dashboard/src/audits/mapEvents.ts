/**
 * The dev server's pushed map and area changes (`server/feed.ts`), one `EventSource` per URL however many hooks listen.
 * `open()` says whether the stream is connected now, so a listener knows when to fall back to asking.
 */

export interface MapEventHandlers {
  readonly map?: (text: string) => void;
  readonly areas?: (ids: readonly string[]) => void;
}

interface Stream {
  readonly source: EventSource;
  readonly handlers: Set<MapEventHandlers>;
}

const streams = new Map<string, Stream>();

/** Listens to `url`'s pushes with `handlers`; answers how to stop, and `open()`. None where the browser has no EventSource. */
export function listenToMap(url: string, handlers: MapEventHandlers): { stop: () => void; open: () => boolean } | null {
  if (typeof EventSource === 'undefined') return null;
  let stream = streams.get(url);
  if (!stream) {
    const source = new EventSource(url);
    const made: Stream = { source, handlers: new Set() };
    source.addEventListener('map', (e) => { for (const h of made.handlers) h.map?.((e as MessageEvent<string>).data); });
    source.addEventListener('areas', (e) => {
      let ids: string[];
      try {
        ids = JSON.parse((e as MessageEvent<string>).data) as string[];
      } catch {
        return;
      }
      for (const h of made.handlers) h.areas?.(ids);
    });
    streams.set(url, made);
    stream = made;
  }
  const held = stream;
  held.handlers.add(handlers);
  return {
    open: () => held.source.readyState === EventSource.OPEN,
    stop: () => {
      held.handlers.delete(handlers);
      if (held.handlers.size) return;
      held.source.close();
      streams.delete(url);
    },
  };
}
