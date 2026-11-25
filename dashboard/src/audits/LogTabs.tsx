import { Tab, TabList, TabPanel, Tabs } from '@weasel-js/ui/components/Tabs';
import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { useJobTail } from './useJobTail';
import { useViewerPref } from './viewerPref';
import s from './LogTabs.module.css';

type LogTab = 'log' | 'issues';

const TABS: readonly { id: LogTab; label: string }[] = [{ id: 'log', label: 'Log' }, { id: 'issues', label: 'Issues' }];
const readTab = (v: string): LogTab | undefined => TABS.find((t) => t.id === v)?.id;

/** The end of the running round's `night.log` from `url`, as it is written, held at its newest line unless the viewer
 *  has scrolled up to read. */
function RoundLog({ url }: { url: string | null }) {
  const log = useJobTail(url);
  const body = useRef<HTMLPreElement>(null);
  const atEnd = useRef(true);
  useLayoutEffect(() => {
    const el = body.current;
    if (el && atEnd.current) el.scrollTop = el.scrollHeight;
  }, [log]);
  return (
    <pre
      ref={body} className={s.log} tabIndex={0} aria-label="The round's log"
      onScroll={(e) => { const el = e.currentTarget; atEnd.current = el.scrollHeight - el.scrollTop - el.clientHeight < 4; }}
    >
      {url === null ? 'No log here: a snapshot has none.' : log ? log.lines.join('\n') : 'reading the log…'}
    </pre>
  );
}

/** The bottom pane's last panel: the round's log, raw, and the issues, a tab each, with the viewer's choice kept. */
export function LogTabs({ logUrl, issues }: { logUrl: string | null; issues: ReactNode }) {
  const [tab, setTab, keep] = useViewerPref<LogTab>('logTab', 'log', readTab);
  return (
    <Tabs className={s.tabs} selectedKey={tab} onSelectionChange={(key) => { setTab(key as LogTab); keep(key as LogTab); }}>
      <TabList aria-label="Log and issues" items={TABS}>
        {(t) => <Tab id={t.id}>{t.label}</Tab>}
      </TabList>
      <TabPanel id="log" className={s.panel}><RoundLog url={tab === 'log' ? logUrl : null} /></TabPanel>
      <TabPanel id="issues" className={s.panel}>{issues}</TabPanel>
    </Tabs>
  );
}
