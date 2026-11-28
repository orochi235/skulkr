import { useEffect, type ReactNode } from 'react';
import { ColorModeControl } from '@weasel-js/ui/components/ColorModeControl';
import { PrefsButton } from './audits/PrefsButton';
import { useColorModeChoice } from './colorMode';
import s from './Shell.module.css';

/** The page's frame: a header with its title, `nav` beside it, `header`'s controls, then the prefs button and the
 *  viewer's color mode at its far right on every page, over a body that fills the rest. `title` also names the document while the shell is mounted; `heading`, when
 *  given, is drawn in its place. */
export function Shell({ title, heading, nav, header, children }: { title: string; heading?: ReactNode; nav?: ReactNode; header?: ReactNode; children: ReactNode }) {
  useEffect(() => {
    const previous = document.title;
    document.title = title;
    return () => {
      document.title = previous;
    };
  }, [title]);
  const colorMode = useColorModeChoice();
  return (
    <div className={s.shell}>
      <header className={s.header}>
        <h1 className={s.title}>{heading ?? title}</h1>
        {nav && <nav className={s.nav}>{nav}</nav>}
        <div className={s.actions}>
          {header}
          <PrefsButton />
          {colorMode && <ColorModeControl size="sm" value={colorMode.preference} onChange={colorMode.setPreference} />}
        </div>
      </header>
      <main className={s.body}>{children}</main>
    </div>
  );
}
