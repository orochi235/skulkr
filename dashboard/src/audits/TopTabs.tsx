import { Tab, TabList, TabPanel, Tabs } from '@weasel-js/ui/components/Tabs';
import { CalibrationChart } from './CalibrationChart';
import { RoundsChart } from './RoundsChart';
import { useViewerPref } from './viewerPref';
import type { AuditArea, AuditCalibration, AuditRound } from './skulkrMap.types';
import s from './TopTabs.module.css';

type TopTab = 'rounds' | 'calibration';

const TABS: readonly { id: TopTab; label: string }[] = [{ id: 'rounds', label: 'Rounds' }, { id: 'calibration', label: 'Calibration' }];
const readTab = (v: string): TopTab | undefined => TABS.find((t) => t.id === v)?.id;

/** The rounds and calibration charts beside the run lanes, a tab each, with the viewer's choice kept. */
export function TopTabs({ rounds, calibration, area, areas, heatOf }: {
  rounds: readonly AuditRound[]; calibration?: AuditCalibration | undefined; area?: AuditArea | null; areas: readonly AuditArea[];
  heatOf?: (left: number) => string;
}) {
  const [tab, setTab, keep] = useViewerPref<TopTab>('topTab', 'rounds', readTab);
  const choose = (key: TopTab) => { setTab(key); keep(key); };
  return (
    <div className={s.box}>
      <Tabs className={s.tabs} selectedKey={tab} onSelectionChange={(key) => choose(key as TopTab)}>
        <TabList aria-label="Rounds and calibration" items={TABS}>
          {(t) => <Tab id={t.id}>{t.label}</Tab>}
        </TabList>
        <TabPanel id="rounds" className={s.panel}><RoundsChart rounds={rounds} area={area} areas={areas} heatOf={heatOf} /></TabPanel>
        <TabPanel id="calibration" className={s.panel}><CalibrationChart calibration={calibration} /></TabPanel>
      </Tabs>
    </div>
  );
}
