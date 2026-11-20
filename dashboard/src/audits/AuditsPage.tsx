import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { asNodeId } from '@weasel-js/core';
import { useSelection } from '@weasel-js/editing';
import { ResizeHandle } from '@weasel-js/ui/components/ResizeHandle';
import { Shell } from '@dash/Shell';
import { AreaDefects } from './AreaDefects';
import { AreaDetail } from './AreaDetail';
import { JobsFeed } from './JobsFeed';
import { LaneViewControls, LiveRuns, useLaneView, type LaneSettings } from './LiveRuns';
import { Stats } from './Stats';
import { TopTabs } from './TopTabs';
import { Treemap } from './Treemap';
import { NEXT_UP_ROUNDS, nextUpOf, runHolding, statsFor } from './areaData';
import { createAuditScene } from './auditScene';
import { liveEstimatesOf, phasesOf, withLivePasses } from './phases';
import { continuousText } from './runData';
import { useAuditPalette } from './useAuditPalette';
import { useSkulkMap } from './useSkulkMap';
import { TENANTS_PATH, tenantAreaPath, tenantMapPath } from '@shared/routes';
import { TenantTitle } from '@dash/tenants/TenantTitle';
import { useTenantChoice, useTenants } from '@dash/tenants/useTenants';
import { readSize, useViewerPref } from './viewerPref';
import type { SkulkMap } from './skulkMap.types';
import palette from './palette.module.css';
import s from './AuditsPage.module.css';

const ASIDE = { key: 'aside', min: 240, max: 560, initial: 300 } as const;
const TOP = { key: 'top', min: 80, max: 900, initial: 260 } as const;
const TABS = { key: 'tabs', min: 200, max: 720, initial: 300 } as const;
const JOBS = { key: 'jobs', min: 80, max: 900, initial: 220 } as const;

/** A pane's size the viewer dragged it to, kept between visits. */
const usePaneSize = ({ key, initial }: { key: string; initial: number }) => useViewerPref(key, initial, readSize);

function stampOf(map: SkulkMap): string {
  const when = new Date(map.generated).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  return `${map.branch ? `${map.branch} ` : ''}${map.head} · updated ${when}`;
}

/** The page's title: the project's name where the map gives one. */
const titleOf = (map: SkulkMap | null): string => (map?.project ? `${map.project} audits` : 'Audits');

/** What an area is, from the map's partition where it says. */
function AreaNote({ map }: { map: SkulkMap | null }) {
  const partition = map?.partition;
  if (!partition) return <>Each area is a directory of source files.</>;
  return <>Each area is a directory of at most {partition.maxFiles} source files (<code>{partition.path}</code>).</>;
}

function Chart({ map, areaUrl, view }: { map: SkulkMap; areaUrl: string; view: LaneSettings }) {
  const [scene] = useState(createAuditScene);
  const selection = useSelection({ scene, mode: 'single' });
  const [hovered, setHovered] = useState<string | null>(null);
  const [lit, setLit] = useState<string | null>(null);
  const { probes, palette: colors } = useAuditPalette();
  const [asideWidth, setAsideWidth, keepAside] = usePaneSize(ASIDE);
  const [topHeight, setTopHeight, keepTop] = usePaneSize(TOP);
  const [tabsWidth, setTabsWidth, keepTabs] = usePaneSize(TABS);
  const [jobsHeight, setJobsHeight, keepJobs] = usePaneSize(JOBS);
  const mainRef = useRef<HTMLDivElement>(null);
  // The sizes are read by the page's root, which holds every pane.
  useLayoutEffect(() => {
    const root = mainRef.current?.parentElement;
    root?.style.setProperty('--audit-aside-width', `${asideWidth}px`);
    root?.style.setProperty('--audit-top-height', `${topHeight}px`);
    root?.style.setProperty('--audit-jobs-height', `${jobsHeight}px`);
    root?.style.setProperty('--audit-tabs-width', `${tabsWidth}px`);
  }, [asideWidth, topHeight, jobsHeight, tabsWidth]);

  const picked = selection.current[0] ?? null;
  const shownId = hovered ?? picked;
  const areas = useMemo(() => withLivePasses(map.areas, map.runs), [map.areas, map.runs]);
  const area = areas.find((a) => a.id === shownId);
  const pickedArea = picked ? areas.find((a) => a.id === picked) ?? null : null;
  const stats = useMemo(() => statsFor(areas), [areas]);
  const unmerged = useMemo(() => new Set(map.rounds.filter((r) => r.pending === 'unmerged').map((r) => r.round)), [map.rounds]);
  const next = useMemo(() => nextUpOf(areas, NEXT_UP_ROUNDS * (map.areasPerRound ?? 16)), [areas, map.areasPerRound]);
  const phases = useMemo(() => phasesOf(map.runs), [map.runs]);
  const estimates = useMemo(() => liveEstimatesOf(map.runs), [map.runs]);
  const pick = (id: string) => selection.set([asNodeId(id)]);
  const on = { onPick: pick, onLight: setLit };

  return (
    <>
      {probes}
      <div className={s.top}>
        <div className={s.runs}><LiveRuns runs={map.runs} unmerged={unmerged} now={Date.parse(map.generated)} on={on} view={view} focus={picked} /></div>
        <ResizeHandle className={s.vseam} value={tabsWidth} min={TABS.min} max={TABS.max} invert onInput={setTabsWidth} onChange={keepTabs} aria-label="Resize the rounds and queue tabs" />
        <TopTabs rounds={map.rounds} area={pickedArea} areas={areas} next={next} onPick={pick} onLight={setLit} />
      </div>
      <ResizeHandle
        className={s.seam} orientation="horizontal" value={topHeight} min={TOP.min} max={TOP.max}
        onInput={setTopHeight} onChange={keepTop} aria-label="Resize the runs strip"
      />
      <Stats stats={stats} />
      <div ref={mainRef} className={s.main}>
        <Treemap scene={scene} selection={selection} areas={areas} palette={colors} phases={phases} estimates={estimates} onHover={setHovered} lit={lit} areasPerRound={map.areasPerRound} />
        <ResizeHandle value={asideWidth} min={ASIDE.min} max={ASIDE.max} invert onInput={setAsideWidth} onChange={keepAside} aria-label="Resize the side panel" />
        <aside className={s.aside} aria-label="Area">
          <AreaDetail area={area} holder={area && runHolding(map.runs, area.id)} />
          {picked && <AreaDefects url={areaUrl} id={picked} version={map.generated} />}
        </aside>
      </div>
      <ResizeHandle
        className={s.seam} orientation="horizontal" invert value={jobsHeight} min={JOBS.min} max={JOBS.max}
        onInput={setJobsHeight} onChange={keepJobs} aria-label="Resize the jobs feed"
      />
      <div className={s.jobs}><JobsFeed runs={map.runs} onLight={setLit} /></div>
    </>
  );
}

/** Where the page reads its data: the dev server's routes under `base`, asked again every `everyMs`. */
export interface AuditsSource {
  readonly base?: string;
  readonly everyMs?: number;
  /** Whether a dev server can be there at all; a build has none. */
  readonly dev?: boolean;
}

/** The audit chart: every live skulk run, the partition as a treemap shaded by what audits estimate is left, the
 *  queue, the rounds, and the jobs coming back, for the tenant the title's menu picks. Reads the dashboard's dev
 *  server: `api/tenants`, then `api/t/<tenant>/map`. */
export function AuditsPage({ source = {} }: { source?: AuditsSource } = {}) {
  const { base = import.meta.env.BASE_URL, everyMs, dev = true } = source;
  const tenants = useTenants({ url: `${base}${TENANTS_PATH}`, dev });
  const names = tenants.status === 'ready' ? tenants.names : [];
  const [tenant, choose] = useTenantChoice(names);
  const state = useSkulkMap({ url: tenant === null ? null : `${base}${tenantMapPath(tenant)}`, everyMs, dev });
  const map = state.status === 'ready' ? state.map : null;
  const view = useLaneView();
  const continuous = continuousText(map?.continuous);
  const header = map ? (
    <>
      <LaneViewControls view={view} />
      {continuous && <span className={s.continuous} title={map.continuous?.next}>{continuous}</span>}
      <span className={s.stamp}>{stampOf(map)}</span>
    </>
  ) : null;
  const heading = tenant !== null ? <TenantTitle names={names} current={tenant} onChoose={choose} /> : undefined;
  const noServer = tenants.status === 'no-server' || state.status === 'no-server';
  const failed = tenants.status === 'failed' ? `Couldn't read the tenants: ${tenants.error}`
    : tenants.status === 'ready' && !names.length ? 'The dev server reads no tenant: register one with skulk tenants add.'
    : state.status === 'failed' ? `Couldn't read the audit map: ${state.error}` : null;
  return (
    <Shell title={tenant !== null ? `${tenant} audits` : titleOf(map)} heading={heading} header={header}>
      <div className={`${palette.palette} ${s.root}`}>
        {!noServer && !failed && state.status === 'loading' && <p className={s.note}>Reading the audit map…</p>}
        {noServer && (
          <p className={s.note}>
            This page reads the audit map from the dashboard&apos;s dev server, which serves <code>/api/tenants</code>.
            Start it with <code>npm run dev</code> in <code>dashboard/</code>, with a tenant registered or the project in <code>SKULK_CONFIG</code>, and open this page there.
          </p>
        )}
        {!noServer && failed && <p className={s.note}>{failed}</p>}
        {state.status === 'ready' && tenant !== null && (
          <>
            {state.error && <p className={s.note}>The last refresh failed ({state.error}); showing the map before it.</p>}
            <Chart key={tenant} map={state.map} areaUrl={`${base}${tenantAreaPath(tenant)}`} view={view} />
          </>
        )}
        <p className={s.foot}>
          <AreaNote map={map} /> Two reviewers read it
          blind; the overlap of their lists gives Chapman&apos;s estimate of what it held, and &ldquo;left&rdquo; is that estimate
          less what they found. An area settles after two quiet passes on unchanged files. Data from <code>skulk map</code>.
        </p>
      </div>
    </Shell>
  );
}
