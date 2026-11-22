import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
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
import { RoundPicker } from './RoundPicker';
import { areasAsOf, bothIn, matchingIn, pastRoundsOf, roundScopeIn } from './asOf';
import { Input } from '@weasel-js/ui/components/Input';
import { SidebarPanel } from '@weasel-js/ui/components/SidebarPanel';
import { NextUp } from './NextUp';
import { useAsOfRound } from './useAsOfRound';
import { NEXT_UP_ROUNDS, defectsVersionOf, heatScaleOverRounds, nextUpOf, runHolding, statsFor } from './areaData';
import { heatColorOf } from './heat';
import { createAuditScene } from './auditScene';
import { liveEstimatesOf, phasesOf, withLivePasses, type AuditPhase } from './phases';
import { continuousText } from './runData';
import { useAuditPalette } from './useAuditPalette';
import { useSkulkrMap } from './useSkulkrMap';
import { SNAPSHOT, areaUrlFor, mapUrl, tenantsUrl } from '@dash/dataSource';
import { AppTitle } from '@dash/AppTitle';
import { TenantTitle } from '@dash/tenants/TenantTitle';
import { titleFor } from '@dash/title';
import { useTenantChoice, useTenants } from '@dash/tenants/useTenants';
import { readSize, useViewerPref } from './viewerPref';
import { useDashPref } from './dashPrefs';
import { heatStopsOf } from './heatSchemes';
import { PrefsButton } from './PrefsButton';
import type { SkulkrMap } from './skulkrMap.types';
import palette from './palette.module.css';
import s from './AuditsPage.module.css';
import { useReleaseOnEscape } from './useReleaseOnEscape';

const ASIDE = { key: 'aside', min: 240, max: 560, initial: 300 } as const;
const TOP = { key: 'top', min: 80, max: 900, initial: 260 } as const;
const TABS = { key: 'tabs', min: 200, max: 720, initial: 300 } as const;
const JOBS = { key: 'jobs', min: 80, max: 900, initial: 220 } as const;

/** A pane's size the viewer dragged it to, kept between visits. */
const usePaneSize = ({ key, initial }: { key: string; initial: number }) => useViewerPref(key, initial, readSize);

function stampOf(map: SkulkrMap): string {
  const when = new Date(map.generated).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  return `${map.branch ? `${map.branch} ` : ''}${map.head} · updated ${when}`;
}


/** What an area is, from the map's partition where it says. */
function AreaNote({ map }: { map: SkulkrMap | null }) {
  const partition = map?.partition;
  if (!partition) return <>Each area is a directory of source files.</>;
  return <>Each area is a directory of at most {partition.maxFiles} source files (<code>{partition.path}</code>).</>;
}

const NO_PHASES: ReadonlyMap<string, AuditPhase> = new Map<string, AuditPhase>();

/** The round the map is shown after, and how to change it. */
interface AsOf {
  readonly round: number | null;
  readonly choose: (round: number | null) => void;
}

function Chart({ map, areaUrl, view, asOf }: { map: SkulkrMap; areaUrl: (id: string) => string; view: LaneSettings; asOf: AsOf }) {
  const [scene] = useState(createAuditScene);
  const selection = useSelection({ scene, mode: 'single' });
  const [hovered, setHovered] = useState<string | null>(null);
  const [lit, setLit] = useState<string | null>(null);
  const { probes, palette: themed } = useAuditPalette();
  const [scheme] = useDashPref('map.scheme');
  const colors = useMemo(() => {
    const depth = heatStopsOf(scheme);
    return depth ? { ...themed, depth } : themed;
  }, [themed, scheme]);
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
  const passCounts = useMemo(() => new Map(areas.map((a) => [a.id, a.passes.length])), [areas]);
  const pastRounds = useMemo(() => pastRoundsOf(map), [map]);
  const past = asOf.round !== null && pastRounds.includes(asOf.round) ? asOf.round : null;
  const shown = useMemo(() => (past === null ? areas : areasAsOf(map.areas, past)), [areas, map.areas, past]);
  // One scale for now and every past round, so the slider changes what is shaded, never what a shade means.
  const heat = useMemo(() => heatScaleOverRounds(areas), [areas]);
  const recut = useMemo(() => (past === null ? null : map.recuts?.find((r) => r.round === past)?.areas ?? null), [map.recuts, past]);
  const heatOf = useMemo(() => (left: number) => heatColorOf(colors.depth, heat.at, left), [heat, colors.depth]);
  const area = shown.find((a) => a.id === shownId);
  const pickedArea = picked ? areas.find((a) => a.id === picked) ?? null : null;
  const stats = useMemo(() => statsFor(shown, past, areas, map.runs), [shown, past, areas, map.runs]);
  const [onlyRound, setOnlyRound] = useDashPref('map.grayOut');
  const [query, setQuery] = useState('');
  const matches = useMemo(() => {
    const ids = matchingIn(shown, query);
    return ids && shown.filter((a) => ids.has(a.id));
  }, [shown, query]);
  const inColor = useMemo(
    () => bothIn(onlyRound ? roundScopeIn(shown, past, pastRounds.at(-1) ?? null) : null, matchingIn(shown, query)),
    [onlyRound, shown, past, pastRounds, query],
  );

  const unmerged = useMemo(() => new Set(map.rounds.filter((r) => r.pending === 'unmerged').map((r) => r.round)), [map.rounds]);
  const next = useMemo(() => nextUpOf(areas, NEXT_UP_ROUNDS * (map.areasPerRound ?? 16)), [areas, map.areasPerRound]);
  const phases = useMemo(() => phasesOf(map.runs), [map.runs]);
  const estimates = useMemo(() => liveEstimatesOf(map.runs), [map.runs]);
  // Naming the area already picked unpicks it, as a second click on the map does (Treemap's togglingSelection).
  const pick = (id: string) => (selection.get()[0] === id ? selection.clear() : selection.set([asNodeId(id)]));
  const on = { onPick: pick, onLight: setLit };
  useReleaseOnEscape(useCallback(() => selection.clear(), [selection]));

  return (
    <>
      {probes}
      <div className={s.top}>
        <div className={s.runs}><LiveRuns runs={map.runs} leftOut={map.leftOut} unmerged={unmerged} now={Date.parse(map.generated)} on={on} view={view} focus={picked} passes={passCounts} /></div>
        <ResizeHandle className={s.vseam} value={tabsWidth} min={TABS.min} max={TABS.max} invert onInput={setTabsWidth} onChange={keepTabs} aria-label="Resize the rounds and queue tabs" />
        <TopTabs
          rounds={map.rounds} calibration={map.calibration} area={pickedArea} areas={areas} heatOf={heatOf} next={next}
          nextNote={past === null ? undefined : `The queue now, not after round ${past}.`} onPick={pick} onLight={setLit}
        />
      </div>
      <ResizeHandle
        className={s.seam} orientation="horizontal" value={topHeight} min={TOP.min} max={TOP.max}
        onInput={setTopHeight} onChange={keepTop} aria-label="Resize the runs strip"
      />
      <Stats stats={stats} />
      <div ref={mainRef} className={s.main}>
        <Treemap
          scene={scene} selection={selection} areas={shown} palette={colors} phases={past === null ? phases : NO_PHASES}
          {...(past === null ? { estimates } : {})} onHover={setHovered} lit={lit} areasPerRound={map.areasPerRound} glyphs={map.icons}
          asOf={past} inColor={inColor} heat={heat} recut={recut} header={pastRounds.length ? <RoundPicker rounds={pastRounds} value={past} onChange={asOf.choose} onlyRound={onlyRound} onOnlyRound={setOnlyRound} /> : null}
        />
        <ResizeHandle value={asideWidth} min={ASIDE.min} max={ASIDE.max} invert onInput={setAsideWidth} onChange={keepAside} aria-label="Resize the side panel" />
        <aside className={s.aside} aria-label="Area">
          <Input
            type="search" size="sm" aria-label="Filter areas by name" placeholder="filter areas"
            value={query} onChange={setQuery} spellCheck={false} autoCapitalize="off"
          />
          {matches && !picked ? (
            <SidebarPanel title="Matches">
              <NextUp
                areas={matches} onPick={pick} onLight={setLit} numbered={false}
                note={`${matches.length.toLocaleString()} of ${shown.length.toLocaleString()} areas`}
              />
            </SidebarPanel>
          ) : <AreaDetail area={area} holder={area && past === null ? runHolding(map.runs, area.id) : undefined} asOf={past} />}
          {picked && <AreaDefects urlOf={areaUrl} id={picked} version={defectsVersionOf(map, picked)} />}
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

/** The audit chart: every live skulkr run, the partition as a treemap shaded by what audits estimate is left, the
 *  queue, the rounds, and the jobs coming back, for the tenant the title's menu picks. Reads the dashboard's dev
 *  server: `api/tenants`, then `api/t/<tenant>/map`. */
export function AuditsPage({ source = {} }: { source?: AuditsSource } = {}) {
  // A heat scheme other than the theme's sets the ramp's stops where the CSS reads them: the legend's bar and the charts.
  const paletteRoot = useRef<HTMLDivElement>(null);
  const [scheme] = useDashPref('map.scheme');
  useLayoutEffect(() => {
    const root = paletteRoot.current;
    if (!root) return;
    const stops = heatStopsOf(scheme);
    for (let i = 0; i < 5; i++) {
      if (stops) root.style.setProperty(`--audit-depth-${i}`, stops[i]!);
      else root.style.removeProperty(`--audit-depth-${i}`);
    }
  }, [scheme]);
  const { base = import.meta.env.BASE_URL, everyMs, dev = true } = source;
  const tenants = useTenants({ url: tenantsUrl(base), dev });
  const names = tenants.status === 'ready' ? tenants.names : [];
  const [tenant, choose] = useTenantChoice(names);
  const [asOfRound, chooseAsOf] = useAsOfRound(tenant);
  const state = useSkulkrMap({ url: tenant === null ? null : mapUrl(base, tenant), everyMs: SNAPSHOT ? Infinity : everyMs, dev });
  const map = state.status === 'ready' ? state.map : null;
  const view = useLaneView();
  const continuous = continuousText(map?.continuous);
  const header = map ? (
    <>
      <LaneViewControls view={view} />
      <PrefsButton />
      {continuous && <span className={s.continuous} title={map.continuous?.next}>{continuous}</span>}
      <span className={s.stamp}>{stampOf(map)}</span>
    </>
  ) : null;
  const heading = tenant !== null ? <TenantTitle names={names} current={tenant} onChoose={choose} /> : undefined;
  const noServer = tenants.status === 'no-server' || state.status === 'no-server';
  const failed = tenants.status === 'failed' ? `Couldn't read the tenants: ${tenants.error}`
    : tenants.status === 'ready' && !names.length ? 'The dev server reads no tenant: register one with skulkr tenants add.'
    : state.status === 'failed' ? `Couldn't read the audit map: ${state.error}` : null;
  return (
    <Shell title={titleFor(tenant ?? map?.project ?? null)} heading={heading ?? <AppTitle />} header={header}>
      <div ref={paletteRoot} className={`${palette.palette} ${s.root}`}>
        {!noServer && !failed && state.status === 'loading' && <p className={s.note}>Reading the audit map…</p>}
        {noServer && (
          <p className={s.note}>
            This page reads the audit map from the dashboard&apos;s dev server, which serves <code>/api/tenants</code>.
            Start it with <code>npm run dev</code> in <code>dashboard/</code>, with a tenant registered or the project in <code>SKULKR_CONFIG</code>, and open this page there.
          </p>
        )}
        {!noServer && failed && <p className={s.note}>{failed}</p>}
        {SNAPSHOT && map && (
          <p className={s.note}>
            A snapshot of <a href="https://github.com/orochi235/skulkr">skulkr</a> auditing {tenant ?? 'a project'}, frozen
            at {new Date(map.generated).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}{map.runs.length ? ', mid-round' : ''}. Hover or click an
            area for its passes and the defects they found.
          </p>
        )}
        {state.status === 'ready' && tenant !== null && (
          <>
            {state.error && <p className={s.note}>The last refresh failed ({state.error}); showing the map before it.</p>}
            <Chart key={tenant} map={state.map} areaUrl={areaUrlFor(base, tenant)} view={view} asOf={{ round: asOfRound, choose: chooseAsOf }} />
          </>
        )}
        <p className={s.foot}>
          <AreaNote map={map} /> Two reviewers read it
          blind; the overlap of their lists gives Chapman&apos;s estimate of what it held, and &ldquo;left&rdquo; is that estimate
          less what they found. An area settles after two quiet passes on unchanged files. Data from <code>skulkr map</code>.
        </p>
      </div>
    </Shell>
  );
}
