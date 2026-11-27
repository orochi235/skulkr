import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { SceneCanvas, asNodeId, registerCanvasFont, type SceneCanvasApi, type SelectionApi } from '@weasel-js/core';
import { useHud, useHudContribution, useLoupe } from '@weasel-js/hud/react';
import type { Hud } from '@weasel-js/hud';
import { useAnimator } from '@weasel-js/animator/react';
import { usePrefersReducedMotion, watchResize } from '@weasel-js/react';
import * as presets from '@weasel-js/editing/presets';
import { auditNodeSpecs, breathe, flashRecut, syncAuditScene, type AuditPalette, type AuditScene } from './auditScene';
import { layoutMap } from './mapLayout';
import { heatScaleOf, type HeatScale } from './areaData';
import { HeatLegend } from './HeatLegend';
import { LockMark } from './Marks';
import { HEAT_METRICS, HEAT_METRIC_SPECS, metricScaleOf, type HeatMetric } from './heatMetrics';
import { heatStopsOf, type HeatScheme } from './heatSchemes';
import { OFF_PIPELINE, PHASE_LABEL, SCOUR_PHASES, SWEEP, phaseClass, type AuditPhase } from './phases';
import { Checkbox } from '@weasel-js/ui/components/Checkbox';
import { Slider } from '@weasel-js/ui/components/Slider';
import { MAX_COUNTED, MAX_HALVES, useDashPref } from './dashPrefs';
import type { AuditArea } from './skulkrMap.types';
import s from './Treemap.module.css';

const FEATURES = [presets.pick];
const SELECTION_OPTIONS = { mode: 'single' } as const;
// The selection traces each cell's silhouette, so a raised one is outlined as the block it is drawn as.
const LAYERS = { selectionOverlay: { outline: { follow: 'shape' as const, width: 2 } } };

export interface TreemapProps {
  readonly scene: AuditScene;
  readonly selection: SelectionApi;
  readonly areas: readonly AuditArea[];
  readonly palette: AuditPalette;
  /** Each area a live run holds, and its phase. */
  readonly phases: ReadonlyMap<string, AuditPhase>;
  /** What a live run already estimates its areas hold. */
  readonly estimates?: ReadonlyMap<string, number>;
  readonly onHover: (id: string | null) => void;
  /** The area to glow: one something else on the page names and is hovered. */
  readonly lit?: string | null;
  /** How many areas a round takes, whose halves the queue numbers are counted in. */
  readonly areasPerRound?: number;
  /** Each icon's glyph, by the name an area's `icon` gives. */
  readonly glyphs?: Readonly<Record<string, string>>;
  /** The past round `areas` stand as of (`areasAsOf`), whose settling, changes and live runs are not known; null for now. */
  readonly asOf?: number | null;
  /** The areas to keep in color, the rest drawn gray; null keeps every area in color. */
  readonly inColor?: ReadonlySet<string> | null;
  /** The heat scale to shade on, held across past rounds; by default the one `areas` set. */
  readonly heat?: HeatScale;
  /** The areas the round shown recut, flashed as it is reached; null where it recut none. */
  readonly recut?: readonly string[] | null;
  /** What sits above the map: the round picker. */
  readonly header?: ReactNode;
  /** The theme's own ramp, for a metric whose scheme is `thermal`; by default `palette`'s. */
  readonly thermal?: AuditPalette['depth'];
  /** The pref holding what the map shades by, and the metrics its menu offers: each page keeps its own choice. */
  readonly colorByPref?: 'map.colorBy' | 'saturation.colorBy';
  readonly metrics?: readonly HeatMetric[];
  /** Leave out the audit history's marks (pass pips, changes since a pass, settling, unmerged locks) and their keys,
   *  and the conflict and done keys. */
  readonly bare?: boolean;
  /** Number the head of whatever queue `areas` carry (by default all but a bare map), with the legend's slider. */
  readonly numbered?: boolean;
  /** Count the numbered places one area at a time (`saturation.upcoming`), not in half rounds (`map.upcoming`). */
  readonly byOnes?: boolean;
  /** How high each area stands off the map, in pixels; null draws it flat. */
  readonly rises?: ReadonlyMap<string, number> | null;
  /** A control the page adds to the legend, after the heat scale. */
  readonly legendExtra?: ReactNode;
}

/** Every audit area as a cell of a treemap drawn on the scene graph: hover and click pick through the canvas's
 *  own hit testing and selection. */
const NO_GLYPHS: Readonly<Record<string, string>> = {};
/** How long a recut area's outline takes to fade, from the moment it shows. */
const RECUT_FADE_MS = 1800;
const HALF_STOPS = Array.from({ length: MAX_HALVES + 1 }, (_, i) => i);

export function Treemap({ scene, selection, areas, palette, phases, estimates, onHover, lit = null, areasPerRound = 16, glyphs = NO_GLYPHS, asOf = null, inColor = null, heat: heatGiven, recut = null, header, thermal, colorByPref = 'map.colorBy', metrics = HEAT_METRICS, bare = false, numbered = !bare, byOnes = false, rises = null, legendExtra = null }: TreemapProps) {
  // How much of the queue's head to number on the map, each in its area's corner: half rounds of it, or areas one by one.
  const [halves, setHalves] = useDashPref('map.upcoming');
  const [counted, setCounted] = useDashPref('saturation.upcoming');
  const [gray] = useDashPref('map.gray');
  const upcoming: Upcoming = byOnes
    ? { value: counted, set: setCounted, max: MAX_COUNTED, label: 'Upcoming areas to number on the map', text: `${counted} areas` }
    : { value: halves, set: setHalves, max: MAX_HALVES, stops: HALF_STOPS, label: 'Upcoming areas to number on the map, in half rounds', text: `${halves * (areasPerRound / 2)} areas, ${halves / 2} rounds` };
  const places = !numbered ? 0 : byOnes ? counted : halves * (areasPerRound / 2);
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<SceneCanvasApi>(null);
  const hud = useHud();
  const hudEntry = useHudContribution(hud);
  const ambient = useMemo(() => [hudEntry], [hudEntry]);
  const [loupe, setLoupe] = useDashPref('map.loupe');
  const closeLoupe = useCallback(() => setLoupe(false), [setLoupe]);
  // useLoupe reads the canvas once, on mount, so the lens mounts only after the canvas has.
  const [canvasReady, setCanvasReady] = useState(false);
  useEffect(() => setCanvasReady(true), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'F2' || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      e.preventDefault();
      setLoupe(!loupe);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [loupe, setLoupe]);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const measure = () => setSize((was) => {
      const width = Math.floor(host.clientWidth), height = Math.floor(host.clientHeight);
      return was.width === width && was.height === height ? was : { width, height };
    });
    measure();
    return watchResize(host, measure);
  }, []);

  // A click that leaves the one picked area picked was a click on it, and unpicks it; the canvas only ever replaces.
  const pickedAtPress = useRef<string | null>(null);
  const notePress = () => { pickedAtPress.current = selection.get().length === 1 ? selection.get()[0]! : null; };
  const unpickRepeat = () => {
    const was = pickedAtPress.current;
    const now = selection.get();
    if (was !== null && now.length === 1 && now[0] === was) selection.clear();
  };
  const heatOwn = useMemo(() => heatScaleOf(areas), [areas]);
  const leftHeat = heatGiven ?? heatOwn;
  // Shaded by another metric, the map takes that metric's values, its scale, and the ramp its pref names.
  const [chosen, setColorBy] = useDashPref(colorByPref);
  // A choice saved before this page's menu narrowed shows as its first metric.
  const colorBy = metrics.includes(chosen) ? chosen : metrics[0]!;
  const [scheme] = useDashPref(colorBy === 'left' ? 'map.scheme' : `map.schemes.${colorBy}`) as [HeatScheme, unknown];
  const values = useMemo(() => (colorBy === 'left' ? null : HEAT_METRIC_SPECS[colorBy].valuesIn(areas)), [colorBy, areas]);
  const heat = useMemo(() => (values ? metricScaleOf(colorBy, values) : leftHeat), [values, colorBy, leftHeat]);
  const [invert, setInvert] = useDashPref('map.invert');
  const shades = useMemo(() => {
    const depth = colorBy === 'left' ? palette.depth : heatStopsOf(scheme) ?? thermal ?? palette.depth;
    return { ...palette, depth: invert ? ([...depth].reverse() as unknown as typeof depth) : depth };
  }, [colorBy, palette, scheme, thermal, invert]);
  const metric = HEAT_METRIC_SPECS[colorBy];
  const layout = useMemo(() => layoutMap(areas, size.width, size.height), [areas, size]);
  useLayoutEffect(() => {
    syncAuditScene(scene, auditNodeSpecs(areas, layout, shades, phases, lit, places, estimates, glyphs, inColor, gray / 100, heat, values, bare, rises));
  }, [scene, areas, layout, shades, phases, lit, places, estimates, glyphs, inColor, gray, heat, values, bare, rises]);

  // The map's text is set in the theme's faces, which the canvas draws from the document's fonts once each loads.
  useEffect(() => {
    const families = [palette.font.ui, palette.font.numeric];
    const releases = families.map((family) => registerCanvasFont(family));
    for (const family of families) void document.fonts?.load(`10px "${family}"`, '0123456789 abc').catch(() => {});
    return () => releases.forEach((release) => release());
  }, [palette.font.ui, palette.font.numeric]);

  const liveIds = useMemo(() => areas.filter((a) => a.status === 'tonight').map((a) => asNodeId(a.id)), [areas]);
  const animator = useAnimator();
  const still = usePrefersReducedMotion();
  useEffect(() => {
    if (still || liveIds.length === 0) return;
    const pulse = animator.tweenLoop({
      from: 1, to: 0.35, ms: 1100, direction: 'alternate', easing: 'easeInOutCubic',
      onTick: (v: number) => breathe(scene, liveIds, v),
    });
    return () => {
      pulse.cancel();
      breathe(scene, liveIds, 1);
    };
  }, [animator, still, scene, liveIds]);

  const [flashes] = useDashPref('map.recut');
  useEffect(() => {
    if (!flashes || !recut?.length) return;
    const ids = recut.map(asNodeId);
    const fade = animator.tween({
      from: 1, to: 0, ms: RECUT_FADE_MS, easing: 'easeInCubic',
      onTick: (v: number) => flashRecut(scene, ids, palette.recut, v),
    });
    return () => {
      fade.cancel();
      flashRecut(scene, ids, palette.recut, 0);
    };
  }, [animator, scene, recut, flashes, palette.recut]);

  return (
    <div className={s.chart}>
      {header}
      <div
        ref={hostRef} className={s.host} role="img" aria-label="Treemap of every audit area, sized by source files"
        onPointerDownCapture={notePress} onClick={unpickRepeat}
      >
        <SceneCanvas
          ref={canvasRef}
          ambient={ambient}
          className={s.canvas}
          scene={scene}
          features={FEATURES}
          selection={selection}
          selectionOptions={SELECTION_OPTIONS}
          layers={LAYERS}
          backgroundFill={{ color: palette.panel }}
          animator={animator}
          onHover={onHover}
        />
        {canvasReady && <MapLoupe canvasRef={canvasRef} hud={hud} visible={loupe} onClose={closeLoupe} />}
      </div>
      <div className={s.legend}>
        <select className={s.colorBy} aria-label="Color the map by" value={colorBy} onChange={(e) => setColorBy(e.currentTarget.value as HeatMetric)}>
          {metrics.map((m) => <option key={m} value={m}>{HEAT_METRIC_SPECS[m].name}</option>)}
        </select>
        <HeatLegend heat={heat} stops={colorBy === 'left' && !invert ? null : shades.depth} />
        <Checkbox className={s.invert} isSelected={invert} onChange={setInvert}>invert ramp</Checkbox>
        {legendExtra}
        {!bare && <span>· passes: ● five, ○ one</span>}
        {/* Kept in place, faded and out of reach, for a past round, so the legend and the map above it never move. */}
        <span className={asOf === null ? s.nowKeys : `${s.nowKeys} ${s.nowOff}`} inert={asOf !== null} aria-hidden={asOf !== null || undefined}>
          <NowLegend upcoming={upcoming} places={places} none={metric.none} bare={bare} numbered={numbered} />
        </span>
      </div>
    </div>
  );
}

const LOUPE_EVENTS_NONE = { onColorChange: () => {} };

/** The magnifier over the map's canvas, re-rendering the map's own layers at eight times. */
function MapLoupe({ canvasRef, hud, visible, onClose }: {
  canvasRef: { current: SceneCanvasApi | null }; hud: Hud; visible: boolean; onClose: () => void;
}) {
  const settings = useMemo(() => ({ visible, mode: 'vector' as const, factor: 8 }), [visible]);
  const events = useMemo(() => ({ ...LOUPE_EVENTS_NONE, onClose }), [onClose]);
  useLoupe(canvasRef, hud, null, settings, events);
  return null;
}

/** The legend's keys for what is known only of now: changes since a pass, settling, live runs, the queue numbers. */
/** The legend's slider over how much of the queue to number: the setting it moves, its range and stops, and its words. */
type Upcoming = { value: number; set: (value: number) => void; max: number; stops?: readonly number[]; label: string; text: string };

function NowLegend({ upcoming, places, none, bare, numbered }: {
  upcoming: Upcoming; places: number; bare: boolean; numbered: boolean;
  /** What a hatched cell means under the metric the map is shaded by: never audited, or no value of it. */
  none: string;
}) {
  return (
    <>
      {!bare && (
        <>
          <span><i className={`${s.key} ${s.worn}`} />changed since its pass</span>
          <span><i className={`${s.key} ${s.settled}`} />settled</span>
          <span>
            <LockMark className={s.lock} size={10} />
            held by an unmerged round
          </span>
        </>
      )}
      {bare ? (
        <span className={s.phases}>
          in a live scour:
          {SCOUR_PHASES.map((p) => <span key={p} className={phaseClass(p)}><i className={`${s.key} ${s.live}`} />{PHASE_LABEL[p]}</span>)}
        </span>
      ) : (
        <span className={s.phases}>
          in a live run:
          <span className={s.phaseRamp}>
            <i className={s.phaseBar} />
            {/* Every step keeps its place under the ramp; the one between review and match goes uncaptioned. */}
            <span className={s.phaseNames}>{SWEEP.map((p) => <span key={p}>{p === 'reviewed' ? '' : PHASE_LABEL[p]}</span>)}</span>
          </span>
          {OFF_PIPELINE.map((p) => <span key={p} className={phaseClass(p)}><i className={`${s.key} ${s.live}`} />{PHASE_LABEL[p]}</span>)}
        </span>
      )}
      <span><i className={`${s.key} ${s.uncharted}`} />{none}</span>
      {numbered && <span className={s.upcoming}>
        numbered upcoming:
        <Slider
          className={s.upcomingSlider} aria-label={upcoming.label}
          min={0} max={upcoming.max} step={1} {...(upcoming.stops ? { stops: upcoming.stops, showStops: true, snap: 'strict' as const } : {})} thumbShape="dot"
          trackHeight="var(--wzl-slider-track-h)" thumbSize="var(--wzl-slider-thumb-size)"
          thumbs={[{ value: upcoming.value, valueText: upcoming.text }]}
          onInput={([t]) => upcoming.set(t!.value)} onChange={([t]) => upcoming.set(t!.value)}
          readoutPlacement="none"
        />
        <span className={s.upcomingCount}>{places}</span>
      </span>}
    </>
  );
}
