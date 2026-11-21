import { InlineMarkdown } from '@weasel-js/ui/components/InlineMarkdown';
import { useEffect, useLayoutEffect, useRef } from 'react';
import { Checkbox } from '@weasel-js/ui/components/Checkbox';
import { SegmentedBar } from '@weasel-js/ui/components/Segmented';
import { SpanStrips, type SpanStripSpan, type SpanStripsRow } from '@weasel-js/ui/components/SpanStrip';
import { clockRuler } from './clock';
import { GateFailures } from './GateFailures';
import { laneViewOf, runClockOf, type LaneView } from './clockLane';
import { passDone, PHASE_LABEL, phaseClass, stageCountsOf, BRIGHT_FILLS } from './phases';
import { STEP_COLUMN_COUNT, laneStepsOf } from './stepsLane';
import { gateRunsOf, inSharedSteps, leadsWithNode, sharedSpansOf } from './sharedLane';
import { NODE_SEP, headlineOf, lastLineOf, spendOf, startedText } from './runData';
import { useViewerPref } from './viewerPref';
import type { AuditLane, AuditRun } from './skulkrMap.types';
import s from './LiveRuns.module.css';

const cx = (...names: (string | false | undefined)[]) => names.filter(Boolean).join(' ');

/** What naming an area does: a click picks it on the map, and hovering or focusing lights it there. */
export interface AreaHandlers {
  readonly onPick: (id: string) => void;
  readonly onLight: (id: string | null) => void;
}

/** A running span with its node's name marked, so the name alone pulses: the label up to its separator, or all of it
 *  where it has none. */
function withNode(span: SpanStripSpan): SpanStripSpan {
  if (span.state !== 'active' || span.label === '') return span;
  const at = span.label.indexOf(NODE_SEP);
  if (at === 0) return span;
  const end = at === -1 ? span.label.length : at;
  const node = span.color && BRIGHT_FILLS.has(span.color) ? `${s.node} ${s.onBright}` : s.node;
  return { ...span, content: <><span className={node}>{span.label.slice(0, end)}</span>{span.label.slice(end)}</> };
}

/** The capstone's runs that have failed, each with what it failed, in the shared lane's order. */
const failedGateRuns = (run: AuditRun) => gateRunsOf(run).flatMap((g) => {
  const failures = run.failures?.[g.id] ?? null;
  return failures ? [{ id: g.id, label: g.label, failures }] : [];
});

/** An area's lane as a stack row: its name, and `spans`, its steps in the view chosen. */
function laneRow(lane: AuditLane, view: LaneView, on: AreaHandlers, spans: SpanStripSpan[]): SpanStripsRow {
  return {
    id: lane.id,
    spans: spans.map(withNode),
    'aria-label': lane.id,
    valueText: view.elapsed ? `${view.phase}, ${view.elapsed} in` : view.phase,
    lead: (
      <button
        type="button" className={s.name} data-lane={lane.id} onClick={() => on.onPick(lane.id)}
        onPointerEnter={() => on.onLight(lane.id)} onPointerLeave={() => on.onLight(null)} onFocus={() => on.onLight(lane.id)} onBlur={() => on.onLight(null)}
      >
        {lane.id}
      </button>
    ),
  };
}

export type LaneMode = 'clock' | 'steps';
const MODES = [{ value: 'clock', label: 'Clock' }, { value: 'steps', label: 'Steps' }] as const;

/** The viewer's lane view, kept between visits: on the run's clock (the default), or as a grid of steps. */
function useLaneMode(): [LaneMode, (mode: LaneMode) => void] {
  const [mode, setMode, keep] = useViewerPref<LaneMode>('lanes', 'clock', (s) => (s === 'steps' ? 'steps' : undefined));
  return [mode, (next) => { setMode(next); keep(next); }];
}

/** Whether the viewer hides finished lanes, kept between visits. */
function useHideComplete(): [boolean, (hide: boolean) => void] {
  const [hide, setHide, keep] = useViewerPref('hideComplete', false, (s) => s === 'true');
  return [hide, (next) => { setHide(next); keep(next); }];
}

/** How every round's lanes are drawn: on the clock or as steps, and whether finished lanes hide. */
export interface LaneSettings {
  readonly mode: LaneMode;
  readonly hideComplete: boolean;
  readonly setMode: (mode: LaneMode) => void;
  readonly setHideComplete: (hide: boolean) => void;
}

/** The viewer's lane view, kept between visits, for the page to hand every round and its controls. */
export function useLaneView(): LaneSettings {
  const [mode, setMode] = useLaneMode();
  const [hideComplete, setHideComplete] = useHideComplete();
  return { mode, hideComplete, setMode, setHideComplete };
}

/** The lane view's controls, which apply to every round's lanes. */
export function LaneViewControls({ view }: { view: LaneSettings }) {
  return (
    <div className={s.view}>
      <Checkbox isSelected={view.hideComplete} onChange={view.setHideComplete}>Hide complete</Checkbox>
      <SegmentedBar aria-label="Lane view" size="sm" items={MODES} value={view.mode} onChange={(v) => v && view.setMode(v)} />
    </div>
  );
}

const SHARED_WINDOW = { from: 0, to: 2 };

/** The run's areas, on the run's clock or as a grid of steps; a finished one stays, filled, until the run ends, unless
 *  the viewer hides those whose pass is done, as the map shows them. */
function Lanes({ run, now, mode, hideComplete, on }: { run: AuditRun; now: number; mode: LaneMode; hideComplete: boolean; on: AreaHandlers }) {
  const ref = useRef<HTMLDivElement>(null);
  const clock = runClockOf(run, now);
  const lanes = run.lanes.map((lane) => ({ lane, view: laneViewOf(lane, now, clock.from) })).filter(({ lane }) => !hideComplete || !passDone(lane));
  const widest = Math.max(0, ...run.lanes.map((l) => l.id.length));
  useLayoutEffect(() => { ref.current?.style.setProperty('--audit-lead-ch', String(widest)); }, [widest]);
  // A label's element is remade whenever its text changes, restarting its pulse; one shared start keeps every pulse in step.
  useLayoutEffect(() => {
    for (const a of ref.current?.getAnimations?.({ subtree: true }) ?? []) {
      if (a instanceof CSSAnimation && a.animationName.includes('node-pulse')) a.startTime = 0;
    }
  });
  if (lanes.length === 0) return null;
  const rows = lanes.map(({ lane, view }) => laneRow(lane, view, on, mode === 'steps' ? laneStepsOf(lane, now) : view.spans));
  // Anywhere on a lane picks and lights its area, as its name does; the name stays the keyboard's way in.
  const areaAt = (target: EventTarget) => {
    const row = target instanceof Element ? target.closest('[role="listitem"]') : null;
    const index = row?.parentElement ? [...row.parentElement.children].filter((c) => c.getAttribute('role') === 'listitem').indexOf(row) : -1;
    return index >= 0 ? rows[index]?.id ?? null : null;
  };
  return (
    <div
      ref={ref} className={s.lanesHit}
      onClick={(e) => { const id = areaAt(e.target); if (id) on.onPick(id); }}
      onPointerOver={(e) => on.onLight(areaAt(e.target))} onPointerLeave={() => on.onLight(null)}
    >
      {mode === 'clock'
        ? <SpanStrips aria-label={`Round ${run.round} lanes`} window={clock} at={now} ruler={clockRuler(clock.from)} rows={rows} />
        : <SpanStrips aria-label={`Round ${run.round} lanes`} window={{ from: 0, to: STEP_COLUMN_COUNT }} rows={rows} />}
    </div>
  );
}

/** How many of a round's areas are done, and how many sit in each stage, in the legend's colors. */
function StageCounts({ run }: { run: AuditRun }) {
  const { done, total, stages } = stageCountsOf(run.lanes);
  return (
    <div className={s.counts} aria-label={`Round ${run.round} areas by stage`}>
      <span className={s.count}>{done} of {total} done</span>
      {stages.map(({ phase, n }) => (
        <span key={phase} className={cx(s.count, phaseClass(phase))}><i className={s.dot} aria-hidden="true" />{n} {PHASE_LABEL[phase]}</span>
      ))}
    </div>
  );
}

/** One run's strip: what it is doing and what it has spent, its last line, and a lane per area in flight. */
function RunStrip({ run, now, mode, hideComplete, on }: {
  run: AuditRun; now: number; mode: LaneMode; hideComplete: boolean; on: AreaHandlers;
}) {
  return (
    <section className={cx(s.run, !run.running && s.idle)} aria-label={`Round ${run.round}`}>
      <div className={s.pulse} aria-hidden="true" />
      <div className={s.what}>
        <span>{headlineOf(run)}</span>
        {run.started && <span className={s.started}>{startedText(run.started, now)}</span>}
      </div>
      <div className={s.line} title={lastLineOf(run)}><InlineMarkdown text={lastLineOf(run)} /></div>
      <div className={s.spend}>{spendOf(run)}</div>
      {run.lanes.length > 0 && <StageCounts run={run} />}
      {run.lanes.length > 0 && (
        <div className={s.lanes} data-mode={mode}>
          <Lanes run={run} now={now} mode={mode} hideComplete={hideComplete} on={on} />
          {(inSharedSteps(run) || run.lanes.every(passDone)) && (
            <SpanStrips
              aria-label={`Round ${run.round}, every area`} window={SHARED_WINDOW}
              className={s.shared}
              rows={[{
                id: 'all', spans: sharedSpansOf(run).map((span) => (leadsWithNode(span, run) ? withNode(span) : span)), 'aria-label': 'all areas',
                // The span itself can't hold the button: SpanStrips draws each span twice, the played copy over it.
                lead: (
                  <span className={s.nameCell}>
                    all areas
                    {failedGateRuns(run).map((g) => (
                      <GateFailures key={g.id} label={failedGateRuns(run).length > 1 ? `${g.label}?` : 'what failed?'} run={g.label} failures={g.failures} />
                    ))}
                  </span>
                ),
              }]}
            />
          )}
        </div>
      )}
    </section>
  );
}

/** A strip for every run still running, and for every finished one whose batch has not merged; a merged round lives on
 *  in the rounds chart and the map. */
export function LiveRuns({ runs, unmerged, now, on, view, focus = null }: {
  runs: readonly AuditRun[]; unmerged: ReadonlySet<number>; now: number; on: AreaHandlers;
  /** How every round's lanes are drawn; the page holds it, and its controls, so one setting covers them all. */
  view: LaneSettings;
  /** The area picked elsewhere on the page: its lane, where one shows, is brought into view. */
  focus?: string | null;
}) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!focus) return;
    root.current?.querySelector(`[data-lane="${CSS.escape(focus)}"]`)?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [focus]);
  const live = runs.filter((r) => r.running || unmerged.has(r.round));
  if (live.length === 0) return <section className={cx(s.run, s.idle)}><div className={s.what}>No round running</div></section>;
  return (
    <div ref={root} className={s.runs} aria-live="polite">
      {live.map((run) => <RunStrip key={run.round} run={run} now={now} mode={view.mode} hideComplete={view.hideComplete} on={on} />)}
    </div>
  );
}
