import { useLayoutEffect, useRef } from 'react';
import { minutesSince } from './runData';
import { useJobTail } from './useJobTail';
import s from './JobTail.module.css';

/** A job's own line, as its log writes it, with the filter's `skulkr: ` prefix taken off. */
const lineText = (line: string) => line.replace(/^skulkr: /, '');

/** The end of area `id`'s newest job log, kept current, in a callout beside the pointer at `at`, which it never takes
 *  from the lanes under it. */
export function JobTail({ id, url, now, at }: { id: string; url: string; now: number; at: { x: number; y: number } }) {
  const tail = useJobTail(url);
  const body = useRef<HTMLPreElement>(null);
  const box = useRef<HTMLElement>(null);
  // Where the pointer rested is the one thing about the callout no class can name.
  useLayoutEffect(() => {
    box.current?.style.setProperty('--x', `${at.x}px`);
    box.current?.style.setProperty('--y', `${at.y}px`);
  }, [at.x, at.y]);
  // Held at its newest line, as a terminal is.
  useLayoutEffect(() => {
    const el = body.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [tail]);
  return (
    <section ref={box} className={s.tail} role="status" aria-label={`${id}, its job's log`}>
      <header className={s.head}>
        <span className={s.area}>{id}</span>
        {tail && <span className={s.file}>{tail.file}</span>}
        {tail && <span className={s.age}>written {minutesSince(tail.at, Math.max(now, Date.now()))} ago</span>}
      </header>
      <pre ref={body} className={s.body}>
        {tail ? tail.lines.map(lineText).join('\n') || '(nothing written yet)' : 'reading its log…'}
      </pre>
    </section>
  );
}
