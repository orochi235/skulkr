import { useEffect, useState } from 'react';
import { usePrefsState } from '@weasel-js/prefs/react';
import { Button } from '@weasel-js/ui/components/Button';
import { PrefsDialog } from '@weasel-js/ui/components/Prefs';
import { useDashPrefs } from './dashPrefs';

/** Whether `e` is the prefs shortcut: Cmd+comma, or Ctrl+comma off a Mac. */
export const isPrefsShortcut = (e: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>): boolean =>
  e.key === ',' && (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey;

/** The header's button that opens the dashboard's prefs, which apply as they change; Cmd+comma opens them too. */
export function PrefsButton() {
  const [open, setOpen] = useState(false);
  const { form, reset } = usePrefsState(useDashPrefs());
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!isPrefsShortcut(e)) return;
      e.preventDefault();
      setOpen(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)} title="Prefs (⌘,)" aria-keyshortcuts="Meta+Comma">Prefs</Button>
      <PrefsDialog
        {...form} open={open} onOpenChange={setOpen} title="Dashboard prefs" layout="list"
        footer={<Button size="sm" onClick={() => reset()}>Reset all</Button>}
      />
    </>
  );
}
