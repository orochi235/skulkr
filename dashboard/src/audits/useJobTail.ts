import { useEffect, useState } from 'react';

/** How often a shown tail is asked for again: a job's log moves by the command, much faster than the map's poll. */
export const TAIL_POLL_MS = 3_000;

/** An area's newest job log, its last lines, as the tail route answers it. */
export interface JobTailAnswer {
  readonly file: string;
  readonly at: string;
  readonly lines: readonly string[];
}

/** Whether `answer` reads as a log's end: anything else, as a page that answers every route with its index, is none. */
const isTail = (answer: unknown): answer is JobTailAnswer =>
  typeof answer === 'object' && answer !== null && Array.isArray((answer as JobTailAnswer).lines);

/** Area `id`'s newest job log from `url`, asked for every `everyMs` while shown; null until one arrives, or with none
 *  written. A failed ask keeps the last answer. */
export function useJobTail(url: string | null, everyMs = TAIL_POLL_MS): JobTailAnswer | null {
  const [tail, setTail] = useState<{ url: string; answer: JobTailAnswer | null } | null>(null);
  useEffect(() => {
    if (!url) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const ask = () => {
      fetch(url, { cache: 'no-store' })
        .then((res) => (res.ok ? (res.json() as Promise<unknown>) : Promise.reject(new Error(String(res.status)))))
        .then((answer) => live && setTail({ url, answer: isTail(answer) ? answer : null }), () => {})
        .finally(() => { if (live) timer = setTimeout(ask, everyMs); });
    };
    ask();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [url, everyMs]);
  return tail?.url === url ? tail.answer : null;
}
