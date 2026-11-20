import { Button, DialogTrigger } from 'react-aria-components';
import { Popover, PopoverDialog } from '@weasel-js/ui/components/Popover';
import type { ReactNode } from 'react';
import type { GateFailures as Failures } from './skulkMap.types';
import s from './GateFailures.module.css';

/** A failed capstone run's span content: its label as a button opening what failed, by file, each test with the first
 *  line of its error. */
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
                    {f.tests.map((t) => (
                      <li key={t.test}>
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
