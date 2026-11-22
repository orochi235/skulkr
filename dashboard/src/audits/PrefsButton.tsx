import { useState } from 'react';
import { usePrefsState } from '@weasel-js/prefs/react';
import { Button } from '@weasel-js/ui/components/Button';
import { PrefsDialog } from '@weasel-js/ui/components/Prefs';
import { useDashPrefs } from './dashPrefs';

/** The header's button that opens the dashboard's prefs, which apply as they change. */
export function PrefsButton() {
  const [open, setOpen] = useState(false);
  const { form, reset } = usePrefsState(useDashPrefs());
  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>Prefs</Button>
      <PrefsDialog
        {...form} open={open} onOpenChange={setOpen} title="Dashboard prefs" layout="list"
        footer={<Button size="sm" onClick={() => reset()}>Reset all</Button>}
      />
    </>
  );
}
