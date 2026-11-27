import { useLayoutEffect, useRef } from 'react';
import { relative } from '@weasel-js/quantity';
import { LiveQuantity } from '@weasel-js/ui/components/LiveQuantity';
import { Tooltip } from '@weasel-js/ui/components/Tooltip';
import { agoReading, type Stamp } from './liveTime';
import { useJobTail } from './useJobTail';
import s from './JobTail.module.css';

const AGO = relative();

/** A job's own line, as its log writes it, with the filter's `skulkr: ` prefix taken off. */
const lineText = (line: string) => line.replace(/^skulkr: /, '');

/** The end of area `id`'s newest job log, kept current, in a callout below the pointer at `at` (client coordinates), or
 *  above it where there is no room below, which it never takes from the lanes under it. */
export function JobTail({ id, url, stamp, at }: { id: string; url: string; stamp: Stamp; at: { x: number; y: number } }) {
  const tail = useJobTail(url);
  const written = tail ? agoReading(tail.at, stamp) : null;
  const body = useRef<HTMLPreElement>(null);
  // Held at its newest line, as a terminal is.
  useLayoutEffect(() => {
    const el = body.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [tail]);
  return (
    <Tooltip open anchorRect={{ x: at.x, y: at.y, width: 0, height: 0 }} placement="bottom start" offset={18} className={s.tail}>
      <section role="status" aria-label={`${id}, its job's log`}>
        <header className={s.head}>
          <span className={s.area}>{id}</span>
          {tail && <span className={s.file}>{tail.file}</span>}
          {written && <span className={s.age}>written <LiveQuantity reading={written} display={AGO} /></span>}
        </header>
        <pre ref={body} className={s.body}>
          {tail ? tail.lines.map(lineText).join('\n') || '(nothing written yet)' : 'reading its log…'}
        </pre>
      </section>
    </Tooltip>
  );
}
