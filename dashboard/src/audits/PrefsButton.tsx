import { useEffect, useState } from 'react';
import { usePrefsState } from '@weasel-js/prefs/react';
import { Button } from '@weasel-js/ui/components/Button';
import { Icon } from '@weasel-js/ui/components/Icon';
import { icon } from '@dash/icons.gen';
import { PrefsDialog } from '@weasel-js/ui/components/Prefs';
import { useDashPref, useDashPrefs } from './dashPrefs';

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
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)} title="Prefs (⌘,)" aria-label="Prefs" aria-keyshortcuts="Meta+Comma">
        <Icon name={icon('ui:settings')} size={16} />
      </Button>
      <PrefsDialog
        {...form} open={open} onOpenChange={setOpen} title="Dashboard prefs" layout="rail"
        footer={<Button size="sm" onClick={() => reset()}>Reset all</Button>}
      />
    </>
  );
}

/** The header's loupe toggle: the magnifier over the map, which F2 toggles too. */
export function LoupeButton() {
  const [loupe, setLoupe] = useDashPref('map.loupe');
  return (
    <Button size="sm" variant="ghost" pressed={loupe} onClick={() => setLoupe(!loupe)} title="Loupe (F2)" aria-label="Loupe" aria-keyshortcuts="F2">
      <Icon name={icon('ui:loupe')} size={16} />
    </Button>
  );
}
