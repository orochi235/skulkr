/**
 * A tenant's map pushed to every page watching it, at `<base>api/t/<name>/events` as server-sent events: `map`, the
 * map's JSON, sent on connecting and after each build that changed it, and `areas`, the ids of the areas whose files a
 * running round wrote in the last {@link GAP_MS}, so a page showing one of their defects asks for them again. While anyone watches, the
 * running rounds' night directories and the state's `runs/` are watched (`statWatch`): a change there builds the map again, one
 * build at a time and no sooner than {@link GAP_MS} after the last, and a build runs every {@link EVERY_MS} regardless,
 * for what lives off disk (the fleet's jobs).
 */
import { readdirSync, statSync } from 'node:fs';
import type { ServerResponse } from 'node:http';
import { dirname, join, sep } from 'node:path';

/** How long after a change the build waits for more, so a burst of writes costs one build. */
export const DEBOUNCE_MS = 300;
/** The least time between the end of one build and the start of the next: each takes a core for a second or more. */
export const GAP_MS = 2_000;
/** How often the map is built while watched, changed or not. */
export const EVERY_MS = 15_000;
/** How often an idle stream gets a comment, so no proxy or browser drops it. */
const KEEPALIVE_MS = 25_000;

export interface FeedOptions {
  /** The map as kept now, with no build. */
  readonly current: () => Promise<string>;
  /** Builds the map again and answers it. */
  readonly rebuild: () => Promise<string>;
  readonly watch?: (dir: string, onChange: (file: string) => void) => { close(): void };
  /** Told `true` when the first page starts watching, `false` when the last leaves. */
  readonly onWatched?: (on: boolean) => void;
  readonly debounceMs?: number;
  readonly gapMs?: number;
  readonly everyMs?: number;
}

/** What to watch for map `text`: each running round's night directory, and its state's `runs/`. */
export function watchedOf(text: string): string[] {
  let runs: { running?: boolean; nightDir?: string | null }[] = [];
  try {
    runs = (JSON.parse(text) as { runs?: typeof runs }).runs ?? [];
  } catch {
    return [];
  }
  const nights = runs.flatMap((r) => (r.nightDir ? [r.nightDir] : []));
  const running = runs.flatMap((r) => (r.running && r.nightDir ? [r.nightDir] : []));
  const state = nights[0] ? dirname(dirname(nights[0])) : null;
  return [...new Set([...running, ...(state ? [join(state, 'runs')] : [])])];
}

/** The area a changed file in a night directory belongs to: `jobs/<id>/…` or `areas/<id>/…`; null for any other. */
export function areaOfChange(file: string): string | null {
  const [top, id, ...rest] = file.split(sep);
  return (top === 'jobs' || top === 'areas') && id && rest.length ? id : null;
}

/** How often {@link statWatch} looks. */
export const STAT_MS = 1_000;
/** How deep it looks: `jobs/<area>/<side>/findings.md` is the deepest file a page cares about. */
const DEPTH = 4;

/** Each file under `dir`, through {@link DEPTH} levels of directory, by its path relative to `dir`: its size and when it changed. */
export function filesUnder(dir: string, depth = DEPTH, prefix = ''): Map<string, string> {
  const found = new Map<string, string>();
  let entries;
  try {
    entries = readdirSync(join(dir, prefix), { withFileTypes: true });
  } catch {
    return found;
  }
  for (const e of entries) {
    const rel = prefix ? join(prefix, e.name) : e.name;
    if (e.isDirectory()) {
      if (depth > 1) for (const [k, v] of filesUnder(dir, depth - 1, rel)) found.set(k, v);
    } else {
      try {
        const st = statSync(join(dir, rel));
        found.set(rel, `${st.size}:${st.mtimeMs}`);
      } catch {
        // Gone between the listing and the stat.
      }
    }
  }
  return found;
}

/**
 * Calls `onChange` with each file under `dir` that appeared, grew or changed since the last look, every {@link STAT_MS}.
 * Not `fs.watch`: FSEvents reports nothing of a log appended through a descriptor its writer keeps open, which is how
 * every job log is written.
 */
const statWatch: NonNullable<FeedOptions['watch']> = (dir, onChange) => {
  let was = filesUnder(dir);
  const timer = setInterval(() => {
    const now = filesUnder(dir);
    for (const [file, sig] of now) if (was.get(file) !== sig) onChange(file);
    was = now;
  }, STAT_MS);
  return { close: () => clearInterval(timer) };
};

/** One tenant's feed: `subscribe(res)` streams to `res` until it closes. */
export function createFeed({ current, rebuild, onWatched = () => {}, watch = statWatch, debounceMs = DEBOUNCE_MS, gapMs = GAP_MS, everyMs = EVERY_MS }: FeedOptions) {
  const clients = new Set<ServerResponse>();
  const watchers = new Map<string, { close(): void }>();
  let last = '';
  let timer: ReturnType<typeof setTimeout> | null = null;
  let every: ReturnType<typeof setInterval> | null = null;
  let keepalive: ReturnType<typeof setInterval> | null = null;
  let building = false;
  let again = false;
  let lastBuilt = 0;
  let touched = new Set<string>();
  let touchTimer: ReturnType<typeof setTimeout> | null = null;

  const send = (event: string, data: string) => {
    const frame = `event: ${event}\ndata: ${data.replace(/\n/g, '\ndata: ')}\n\n`;
    for (const res of clients) res.write(frame);
  };
  const sendMap = (text: string) => {
    if (text === last) return;
    last = text;
    send('map', text);
  };
  const follow = (text: string) => {
    const want = new Set(watchedOf(text));
    for (const [dir, w] of watchers) if (!want.has(dir)) (w.close(), watchers.delete(dir));
    for (const dir of want) {
      if (watchers.has(dir)) continue;
      const night = !dir.endsWith(`${sep}runs`);
      watchers.set(dir, watch(dir, (file) => {
        const id = night ? areaOfChange(file) : null;
        if (id) touch(id);
        schedule();
      }));
    }
  };
  const touch = (id: string) => {
    touched.add(id);
    touchTimer ??= setTimeout(() => {
      touchTimer = null;
      const ids = [...touched];
      touched = new Set();
      send('areas', JSON.stringify(ids));
    }, gapMs);
  };
  const build = () => {
    timer = null;
    if (!clients.size) return;
    if (building) {
      again = true;
      return;
    }
    building = true;
    rebuild().then(built, () => {}).finally(() => {
      building = false;
      lastBuilt = Date.now();
      if (again) {
        again = false;
        schedule();
      }
    });
  };
  function schedule() {
    if (timer || !clients.size) return;
    if (building) {
      again = true;
      return;
    }
    timer = setTimeout(build, Math.max(debounceMs, lastBuilt + gapMs - Date.now()));
  }
  const start = () => {
    onWatched(true);
    every = setInterval(schedule, everyMs);
    keepalive = setInterval(() => { for (const res of clients) res.write(': keepalive\n\n'); }, KEEPALIVE_MS);
    schedule();
  };
  const stop = () => {
    onWatched(false);
    for (const w of watchers.values()) w.close();
    watchers.clear();
    for (const t of [every, keepalive]) if (t) clearInterval(t);
    for (const t of [timer, touchTimer]) if (t) clearTimeout(t);
    every = keepalive = timer = touchTimer = null;
    touched = new Set();
    last = '';
  };

  const subscribe = (res: ServerResponse, onClose: (fn: () => void) => void) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
    res.write(': connected\n\n');
    const first = clients.size === 0;
    clients.add(res);
    current().then((text) => {
      if (!clients.has(res)) return;
      res.write(`event: map\ndata: ${text.replace(/\n/g, '\ndata: ')}\n\n`);
      if (first) {
        last = text;
        follow(text);
      }
    }, () => {});
    if (first) start();
    onClose(() => {
      clients.delete(res);
      if (!clients.size) stop();
    });
  };
  /** A map any build made, sent to the watchers when it changed. */
  const built = (text: string) => {
    if (!clients.size) return;
    sendMap(text);
    follow(text);
  };
  return { subscribe, built, watchers: () => [...watchers.keys()] };
}
