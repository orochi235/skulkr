import { useElementSize } from '@weasel-js/routing/react';
import { Tab, TabList, TabPanel, Tabs } from '@weasel-js/ui/components/Tabs';
import { useRef } from 'react';
import { NextUp } from './NextUp';
import { RoundsChart } from './RoundsChart';
import { useViewerPref } from './viewerPref';
import type { AuditArea, AuditRound } from './skulkrMap.types';
import s from './TopTabs.module.css';

type TopTab = 'rounds' | 'next';

const TABS: readonly { id: TopTab; label: string }[] = [{ id: 'rounds', label: 'Rounds' }, { id: 'next', label: 'Next up' }];

/** The pane width at which the chart and the queue both fit, side by side, rather than a tab each. */
export const BOTH_FIT_PX = 560;

/** The rounds chart and the queue beside the run lanes: side by side where the pane has room for both, else a tab
 *  each, with the viewer's choice kept. */
export function TopTabs({ rounds, area, areas, next, onPick, onLight }: {
  rounds: readonly AuditRound[]; area?: AuditArea | null; areas: readonly AuditArea[]; next: readonly AuditArea[]; onPick: (id: string) => void;
  onLight: (id: string | null) => void;
}) {
  const [tab, setTab, keep] = useViewerPref<TopTab>('topTab', 'rounds', (v) => (v === 'next' ? 'next' : v === 'rounds' ? 'rounds' : undefined));
  const box = useRef<HTMLDivElement>(null);
  const both = useElementSize(box).width >= BOTH_FIT_PX;
  const chart = <RoundsChart rounds={rounds} area={area} areas={areas} />;
  const queue = <NextUp areas={next} onPick={onPick} onLight={onLight} />;
  return (
    <div ref={box} className={s.box}>
      {both ? (
        <div className={s.both}>
          <section className={s.column} aria-labelledby="top-rounds"><h2 id="top-rounds" className={s.heading}>Rounds</h2><div className={s.panel}>{chart}</div></section>
          <section className={s.column} aria-labelledby="top-next"><h2 id="top-next" className={s.heading}>Next up</h2><div className={s.panel}>{queue}</div></section>
        </div>
      ) : (
        <Tabs className={s.tabs} selectedKey={tab} onSelectionChange={(key) => { setTab(key as TopTab); keep(key as TopTab); }}>
          <TabList aria-label="Rounds and queue" items={TABS}>
            {(t) => <Tab id={t.id}>{t.label}</Tab>}
          </TabList>
          <TabPanel id="rounds" className={s.panel}>{chart}</TabPanel>
          <TabPanel id="next" className={s.panel}>{queue}</TabPanel>
        </Tabs>
      )}
    </div>
  );
}
