import { useEffect, type ReactNode } from 'react';
import s from './Shell.module.css';

/** The page's frame: a header with its title and `header`'s controls, over a body that fills the rest. `title`
 *  also names the document while the shell is mounted; `heading`, when given, is drawn in its place. */
export function Shell({ title, heading, header, children }: { title: string; heading?: ReactNode; header?: ReactNode; children: ReactNode }) {
  useEffect(() => {
    const previous = document.title;
    document.title = title;
    return () => {
      document.title = previous;
    };
  }, [title]);
  return (
    <div className={s.shell}>
      <header className={s.header}>
        <h1 className={s.title}>{heading ?? title}</h1>
        {header && <div className={s.actions}>{header}</div>}
      </header>
      <main className={s.body}>{children}</main>
    </div>
  );
}
