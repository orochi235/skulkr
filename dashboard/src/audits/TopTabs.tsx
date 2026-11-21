import { useElementSize } from '@weasel-js/routing/react';
import { Tab, TabList, TabPanel, Tabs } from '@weasel-js/ui/components/Tabs';
import { useRef } from 'react';
import { CalibrationChart } from './CalibrationChart';
import { NextUp } from './NextUp';
import { RoundsChart } from './RoundsChart';
import { useViewerPref } from './viewerPref';
import type { AuditArea, AuditCalibration, AuditRound } from './skulkrMap.types';
import s from './TopTabs.module.css';

type TopTab = 'rounds' | 'calibration' | 'next';
type ChartTab = Exclude<TopTab, 'next'>;

const CHART_TABS: readonly { id: ChartTab; label: string }[] = [{ id: 'rounds', label: 'Rounds' }, { id: 'calibration', label: 'Calibration' }];
const TABS: readonly { id: TopTab; label: string }[] = [...CHART_TABS, { id: 'next', label: 'Next up' }];
const readTab = (v: string): TopTab | undefined => TABS.find((t) => t.id === v)?.id;

/** The pane width at which the chart and the queue both fit, side by side, rather than a tab each. */
export const BOTH_FIT_PX = 560;

/** The rounds and calibration charts and the queue beside the run lanes: the charts a tab each beside the queue where
 *  the pane has room for both, else a tab each of all three, with the viewer's choice kept. */
export function TopTabs({ rounds, calibration, area, areas, heatOf, next, nextNote, onPick, onLight }: {
  rounds: readonly AuditRound[]; calibration?: AuditCalibration | undefined; area?: AuditArea | null; areas: readonly AuditArea[];
  heatOf?: (left: number) => string;
  next: readonly AuditArea[]; nextNote?: string | undefined; onPick: (id: string) => void; onLight: (id: string | null) => void;
}) {
  const [tab, setTab, keep] = useViewerPref<TopTab>('topTab', 'rounds', readTab);
  const choose = (key: TopTab) => { setTab(key); keep(key); };
  const box = useRef<HTMLDivElement>(null);
  const both = useElementSize(box).width >= BOTH_FIT_PX;
  const chart = <RoundsChart rounds={rounds} area={area} areas={areas} heatOf={heatOf} />;
  const calib = <CalibrationChart calibration={calibration} />;
  const queue = <NextUp areas={next} onPick={onPick} onLight={onLight} note={nextNote} />;
  return (
    <div ref={box} className={s.box}>
      {both ? (
        <div className={s.both}>
          <section className={s.column} aria-label="Rounds and calibration">
            <Tabs className={s.tabs} selectedKey={tab === 'next' ? 'rounds' : tab} onSelectionChange={(key) => choose(key as ChartTab)}>
              <TabList aria-label="Rounds and calibration" items={CHART_TABS}>
                {(t) => <Tab id={t.id}>{t.label}</Tab>}
              </TabList>
              <TabPanel id="rounds" className={s.panel}>{chart}</TabPanel>
              <TabPanel id="calibration" className={s.panel}>{calib}</TabPanel>
            </Tabs>
          </section>
          <section className={s.column} aria-labelledby="top-next"><h2 id="top-next" className={s.heading}>Next up</h2><div className={s.panel}>{queue}</div></section>
        </div>
      ) : (
        <Tabs className={s.tabs} selectedKey={tab} onSelectionChange={(key) => choose(key as TopTab)}>
          <TabList aria-label="Rounds, calibration, and queue" items={TABS}>
            {(t) => <Tab id={t.id}>{t.label}</Tab>}
          </TabList>
          <TabPanel id="rounds" className={s.panel}>{chart}</TabPanel>
          <TabPanel id="calibration" className={s.panel}>{calib}</TabPanel>
          <TabPanel id="next" className={s.panel}>{queue}</TabPanel>
        </Tabs>
      )}
    </div>
  );
}
