import { Button, DialogTrigger } from 'react-aria-components';
import { Popover, PopoverDialog } from '@weasel-js/ui/components/Popover';
import type { ReactNode } from 'react';
import type { GateFailures as Failures } from './skulkrMap.types';
import s from './GateFailures.module.css';

/** `items` each keyed by `keyOf` and which copy of that key it is: a parameterized test repeats its name. */
export function keyedByCopy<T>(items: readonly T[], keyOf: (item: T) => string): { key: string; item: T }[] {
  const seen = new Map<string, number>();
  return items.map((item) => {
    const k = keyOf(item);
    const copy = seen.get(k) ?? 0;
    seen.set(k, copy + 1);
    return { key: `${k}\n${copy}`, item };
  });
}

/** A button opening what a failed capstone run failed, by file, each test with the first line of its error. */
export function GateFailures({ label, run, failures }: { label: ReactNode; run: string; failures: Failures }) {
  const shown = failures.list.reduce((n, f) => n + f.count, 0);
  return (
    <DialogTrigger>
      <Button className={s.trigger} aria-label={`What ${run} failed`}>{label}</Button>
      <Popover placement="bottom start" offset={6}>
        <PopoverDialog aria-label={`What ${run} failed`} className={s.dialog}>
          <p className={s.sum}>
            {failures.count.toLocaleString()} failed in {failures.files.toLocaleString()} {failures.files === 1 ? 'file' : 'files'}
            {failures.files > failures.list.length ? `; the first ${failures.list.length} files` : ''}
          </p>
          <ul className={s.files}>
            {failures.list.map((f) => (
              <li key={f.file}>
                <code className={s.file}>{f.file}</code>
                {f.count > 1 && <span className={s.count}> {f.count} failed</span>}
                {f.tests.length > 0 && (
                  <ul className={s.tests}>
                    {keyedByCopy(f.tests, (t) => `${t.test}\n${t.error}`).map(({ key, item: t }) => (
                      <li key={key}>
                        <span className={s.test}>{t.test}</span>
                        {t.error && <code className={s.error}>{t.error}</code>}
                      </li>
                    ))}
                    {f.count > f.tests.length && <li className={s.more}>and {f.count - f.tests.length} more</li>}
                  </ul>
                )}
              </li>
            ))}
          </ul>
          {shown < failures.count && failures.files <= failures.list.length && <p className={s.more}>Some failures named no test.</p>}
        </PopoverDialog>
      </Popover>
    </DialogTrigger>
  );
}
