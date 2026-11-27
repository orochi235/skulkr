import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ResizeHandle } from '@weasel-js/ui/components/ResizeHandle';
import { Shell } from '@dash/Shell';
import { AppTitle } from '@dash/AppTitle';
import { SNAPSHOT, mapUrl, saturationUrl, tenantsUrl } from '@dash/dataSource';
import { useSkulkrMap } from '@dash/audits/useSkulkrMap';
import { PageSwitch } from '@dash/pageView';
import { TenantTitle } from '@dash/tenants/TenantTitle';
import { useTenantChoice, useTenants } from '@dash/tenants/useTenants';
import { titleFor } from '@dash/title';
import { readSize, useViewerPref } from '@dash/audits/viewerPref';
import { usd } from './format';
import { LedgerDetail, type DefectPick } from './LedgerDetail';
import { LedgerList } from './LedgerList';
import { SaturationMap } from './SaturationMap';
import { heroCountsOf } from './LedgerHero';
import { ScourNow } from './ScourNow';
import type { FixQueueRow } from './saturation.types';
import { queueIdsFor, readQueueMode, ScourQueue, type QueueMode } from './ScourQueue';
import { SATURATION_LIVE_POLL_MS, SATURATION_POLL_MS, useSaturation } from './useSaturation';
import { useSaturationArea } from './useSaturationArea';
import s from './SaturationPage.module.css';

const LIST = { min: 280, max: 900, initial: 460 } as const;
const MAP = { min: 160, max: 1200, initial: 360 } as const;
const QUEUE = { min: 80, max: 600, initial: 160 } as const;

const NO_QUEUE: readonly string[] = [];
const NO_FIX_QUEUE: readonly FixQueueRow[] = [];

/** Each saturation ledger of a tenant beside the picked one's distinct defects. */
export function SaturationPage({ base = import.meta.env.BASE_URL, dev = true }: { base?: string; dev?: boolean } = {}) {
  const tenants = useTenants({ url: tenantsUrl(base), dev });
  const names = tenants.status === 'ready' ? tenants.names : [];
  const [tenant, choose] = useTenantChoice(names);
  const [everyMs, setEveryMs] = useState(SATURATION_POLL_MS);
  const state = useSaturation(tenant === null ? null : saturationUrl(base, tenant), everyMs);
  const anyRunning = state.status === 'ready' && state.ledgers.some((l) => l.running);
  useEffect(() => setEveryMs(anyRunning ? SATURATION_LIVE_POLL_MS : SATURATION_POLL_MS), [anyRunning]);
  const [picked, pick] = useSaturationArea(tenant);
  // A tile clicked on a live run's chart or the ledger's own: its area picked, its row scrolled to and marked.
  const [defectPick, setDefectPick] = useState<DefectPick | null>(null);
  const pickDefect = useCallback((area: string, id: string) => {
    pick(area);
    setDefectPick((was) => ({ area, id, n: (was?.n ?? 0) + 1 }));
  }, [pick]);
  const map = useSkulkrMap({ url: tenant === null ? null : mapUrl(base, tenant), dev });
  const [listWidth, setListWidth, keepListWidth] = useViewerPref('saturation.list', LIST.initial, readSize);
  const [mapHeight, setMapHeight, keepMapHeight] = useViewerPref('saturation.map', MAP.initial, readSize);
  const [queueHeight, setQueueHeight, keepQueueHeight] = useViewerPref('saturation.queue', QUEUE.initial, readSize);
  const [queueMode, setQueueMode, keepQueueMode] = useViewerPref<QueueMode>('saturation.queueMode', 'delve', readQueueMode);
  const root = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    root.current?.style.setProperty('--saturation-list-width', `${listWidth}px`);
    root.current?.style.setProperty('--saturation-map-height', `${mapHeight}px`);
    root.current?.style.setProperty('--saturation-queue-height', `${queueHeight}px`);
  }, [listWidth, mapHeight, queueHeight]);

  const ledgers = state.status === 'ready' ? state.ledgers : [];
  const queue = state.status === 'ready' ? state.queue : NO_QUEUE;
  const fixQueue = state.status === 'ready' ? state.fixQueue : NO_FIX_QUEUE;
  const mapQueue = useMemo(() => queueIdsFor(queueMode, queue, fixQueue), [queueMode, queue, fixQueue]);
  const ledger = ledgers.find((l) => l.id === picked) ?? null;
  const areaIds = useMemo(() => (map.status === 'ready' ? map.map.areas.map((a) => a.id) : []), [map]);
  const totals = useMemo(() => ({
    open: ledgers.reduce((n, l) => n + heroCountsOf(l).open, 0),
    fixed: ledgers.reduce((n, l) => n + heroCountsOf(l).fixed, 0),
    costUsd: ledgers.reduce((n, l) => n + l.costUsd, 0),
  }), [ledgers]);

  const heading = tenant !== null ? <TenantTitle names={names} current={tenant} onChoose={choose} /> : <AppTitle />;
  const header = state.status === 'ready' ? (
    <span className={s.stamp}>
      {ledgers.length.toLocaleString()} ledgers · {totals.open.toLocaleString()} {totals.open === 1 ? 'defect' : 'defects'} open · {totals.fixed.toLocaleString()} fixed · {usd(totals.costUsd)}
    </span>
  ) : null;
  return (
    <Shell title={titleFor(tenant)} heading={heading} nav={dev && !SNAPSHOT ? <PageSwitch tenant={tenant} current="saturation" /> : null} header={header}>
      <div ref={root} className={s.root}>
        {state.status === 'loading' && <p className={s.note}>Reading the saturation ledgers…</p>}
        {state.status === 'failed' && <p className={s.note}>Couldn&apos;t read the saturation ledgers: {state.error}</p>}
        {state.status === 'ready' && state.error && <p className={`${s.note} ${s.stale}`}>The last refresh failed ({state.error}); showing the ledgers before it.</p>}
        {state.status === 'ready' && !ledgers.length && (
          <p className={s.note}>No saturation ledger yet. <code>skulkr saturate &lt;area&gt;</code> starts one.</p>
        )}
        {state.status === 'ready' && <ScourNow ledgers={ledgers} stamp={state.stamp} onPick={pick} onPickDefect={pickDefect} />}
        {state.status === 'ready' && ledgers.length > 0 && (
          <div className={s.main}>
            <div className={s.left}>
              <ScourQueue
                mode={queueMode} onMode={(m) => { setQueueMode(m); keepQueueMode(m); }}
                queue={queue} fixQueue={fixQueue} ledgers={ledgers} picked={picked} onPick={pick}
              />
              <ResizeHandle
                orientation="horizontal" value={queueHeight} min={QUEUE.min} max={QUEUE.max}
                onInput={setQueueHeight} onChange={keepQueueHeight} aria-label="Resize the queue"
              />
              <LedgerList ledgers={ledgers} areas={areaIds} picked={picked} onPick={(id) => pick(id === picked ? null : id)} />
            </div>
            <ResizeHandle value={listWidth} min={LIST.min} max={LIST.max} onInput={setListWidth} onChange={keepListWidth} aria-label="Resize the ledger list" />
            <div className={s.right}>
              {map.status === 'ready' && <SaturationMap areas={map.map.areas} icons={map.map.icons} ledgers={ledgers} queue={mapQueue} picked={picked} onPick={pick} />}
              {map.status === 'ready' && (
                <ResizeHandle
                  orientation="horizontal" value={mapHeight} min={MAP.min} max={MAP.max}
                  onInput={setMapHeight} onChange={keepMapHeight} aria-label="Resize the map"
                />
              )}
              {ledger ? <LedgerDetail ledger={ledger} picked={defectPick} onPickDefect={pickDefect} />
                : <p className={s.note}>{picked ? `${picked} has no saturation ledger.` : 'Pick an area for its defects.'}</p>}
            </div>
          </div>
        )}
      </div>
    </Shell>
  );
}
