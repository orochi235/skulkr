import { Tab, TabList, TabPanel, Tabs } from '@weasel-js/ui/components/Tabs';
import { Button } from '@weasel-js/ui/components/Button';
import { useState } from 'react';
import { NextUp } from './NextUp';
import { useViewerPref } from './viewerPref';
import type { AuditArea } from './skulkrMap.types';
import s from './BottomTabs.module.css';

type BottomTab = 'next' | 'pinned';

const TABS: readonly { id: BottomTab; label: string }[] = [{ id: 'next', label: 'Next up' }, { id: 'pinned', label: 'Pinned' }];
const readTab = (v: string): BottomTab | undefined => TABS.find((t) => t.id === v)?.id;

/** The pinned areas, each picking its cell and unpinning with a click; one unpinned here stays listed, to pin again,
 *  until the page reloads. */
function Pinned({ areas, onPick, onLight, onPin }: {
  areas: readonly AuditArea[]; onPick: (id: string) => void; onLight: (id: string | null) => void;
  onPin?: ((id: string, on: boolean) => Promise<void>) | undefined;
}) {
  const [seen, setSeen] = useState<readonly string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pinned = areas.filter((a) => a.pinned);
  const ids = [...new Set([...pinned.map((a) => a.id), ...seen])].filter((id) => areas.some((a) => a.id === id)).sort();
  if (ids.length === 0) return <p className={s.empty}>No area is pinned. An area's panel pins it into every round until it settles.</p>;
  const toggle = (id: string, on: boolean) => {
    if (!onPin) return;
    setSeen((was) => (was.includes(id) ? was : [...was, id]));
    setBusy(id);
    setError(null);
    onPin(id, on).catch((e: Error) => setError(e.message)).finally(() => setBusy(null));
  };
  return (
    <>
      {error && <p className={s.error} role="alert">{error}</p>}
      <ul className={s.list}>
        {ids.map((id) => {
          const on = pinned.some((a) => a.id === id);
          return (
            <li key={id} className={s.row}>
              <button
                type="button" className={s.pick} onClick={() => onPick(id)}
                onPointerEnter={() => onLight(id)} onPointerLeave={() => onLight(null)} onFocus={() => onLight(id)} onBlur={() => onLight(null)}
              >
                {id}
              </button>
              {onPin && (
                <Button size="sm" variant="ghost" pressed={on} loading={busy === id} disabled={busy !== null} onClick={() => toggle(id, !on)}
                  title={on ? 'Stop forcing it into every round' : 'Pick it in every round until it settles'}>
                  {on ? 'Pinned' : 'Pin'}
                </Button>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}

/** The tabs beside the jobs feed: the queue's head, and the pinned areas. */
export function BottomTabs({ areas, next, nextNote, onPick, onLight, onPin }: {
  areas: readonly AuditArea[]; next: readonly AuditArea[]; nextNote?: string | undefined;
  onPick: (id: string) => void; onLight: (id: string | null) => void; onPin?: ((id: string, on: boolean) => Promise<void>) | undefined;
}) {
  const [tab, setTab, keep] = useViewerPref<BottomTab>('bottomTab', 'next', readTab);
  return (
    <Tabs className={s.tabs} selectedKey={tab} onSelectionChange={(key) => { setTab(key as BottomTab); keep(key as BottomTab); }}>
      <TabList aria-label="Queue and pins" items={TABS}>
        {(t) => <Tab id={t.id}>{t.label}</Tab>}
      </TabList>
      <TabPanel id="next" className={s.panel}><NextUp areas={next} onPick={onPick} onLight={onLight} note={nextNote} /></TabPanel>
      <TabPanel id="pinned" className={s.panel}><Pinned areas={areas} onPick={onPick} onLight={onLight} onPin={onPin} /></TabPanel>
    </Tabs>
  );
}

