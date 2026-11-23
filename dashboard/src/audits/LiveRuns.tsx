import { InlineMarkdown } from '@weasel-js/ui/components/InlineMarkdown';
import { useEffect, useLayoutEffect, useRef } from 'react';
import { Checkbox } from '@weasel-js/ui/components/Checkbox';
import { SegmentedBar } from '@weasel-js/ui/components/Segmented';
import { SpanStrips, type SpanStripSpan, type SpanStripsRow } from '@weasel-js/ui/components/SpanStrip';
import { clockRuler } from './clock';
import { GateFailures } from './GateFailures';
import { LeftOut } from './LeftOut';
import { laneViewOf, runClockOf, type LaneView } from './clockLane';
import { passDone, STAGE_LABEL, phaseClass, stageCountsOf, BRIGHT_FILLS } from './phases';
import { STEP_COLUMN_COUNT, laneStepsOf } from './stepsLane';
import { gateRunsOf, inSharedSteps, leadsWithNode, sharedSpansOf } from './sharedLane';
import { NODE_SEP, elapsedText, headlineOf, lastLineOf, spendOf, startedText } from './runData';
import { useDashPref } from './dashPrefs';
import type { AuditLane, AuditLeftOut, AuditRun } from './skulkrMap.types';
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

/** Dots per group in a lane's pass count, set apart like tally marks so a count reads at a glance. */
const DOT_GROUP = 5;
/** Groups stacked in a column before the next column starts: two rows of dots fit the lane's line. */
const GROUP_ROWS = 2;

/** How many dots each group holds, column by column: `total` dots in groups of DOT_GROUP, GROUP_ROWS to a column. */
const dotColumnsFor = (total: number): number[][] => {
  const groups = Array.from({ length: Math.ceil(total / DOT_GROUP) }, (_, g) => Math.min(DOT_GROUP, total - g * DOT_GROUP));
  return Array.from({ length: Math.ceil(groups.length / GROUP_ROWS) }, (_, c) => groups.slice(c * GROUP_ROWS, (c + 1) * GROUP_ROWS));
};

/** An area's passes as dots, one each, in groups of DOT_GROUP stacked GROUP_ROWS high, at the end of its lane's name;
 *  while this round's pass is under way, an open circle stands in for its dot. */
function PassDots({ passes, pending }: { passes: number; pending: boolean }) {
  const total = passes + (pending ? 1 : 0);
  if (total <= 0) return null;
  const title = `${passes} ${passes === 1 ? 'pass' : 'passes'}${pending ? ', one under way' : ''}`;
  let at = 0;
  return (
    <span className={s.passDots} title={title}>
      {dotColumnsFor(total).map((column, c) => (
        <span key={c} className={s.dotColumn}>
          {column.map((count, g) => (
            <span key={g} className={s.dotGroup}>
              {Array.from({ length: count }, (_, i) => <i key={i} className={at++ >= passes ? s.open : undefined} />)}
            </span>
          ))}
        </span>
      ))}
    </span>
  );
}

/** The room `passes` dots take in their columns, with the gap before them; the widths are PassDots' CSS. */
export const dotsWidthFor = (passes: number): number => {
  if (passes <= 0) return 0;
  const columns = dotColumnsFor(passes).map((column) => column[0]!);
  return columns.reduce((w, n) => w + n * 4 + (n - 1) * 2, 0) + (columns.length - 1) * 5 + 4 + 8;
};

/** An area's lane as a stack row: its name, and `spans`, its steps in the view chosen. */
function laneRow(lane: AuditLane, view: LaneView, on: AreaHandlers, spans: SpanStripSpan[], passes: number): SpanStripsRow {
  return {
    id: lane.id,
    spans: spans.map(withNode),
    'aria-label': lane.id,
    valueText: view.elapsed ? `${view.phase}, ${view.elapsed} in` : view.phase,
    lead: (
      <button
        type="button" className={s.name} data-lane={lane.id} onClick={(e) => { e.stopPropagation(); on.onPick(lane.id); }}
        onPointerEnter={() => on.onLight(lane.id)} onPointerLeave={() => on.onLight(null)} onFocus={() => on.onLight(lane.id)} onBlur={() => on.onLight(null)}
      >
        <span className={s.nameText}>{lane.id}</span>
        <PassDots passes={passes} pending={!passDone(lane)} />
      </button>
    ),
  };
}

export type LaneMode = 'clock' | 'steps';
const MODES = [{ value: 'steps', label: 'Steps' }, { value: 'clock', label: 'Clock' }] as const;


/** How every round's lanes are drawn: on the clock or as steps, and whether finished lanes hide. */
export interface LaneSettings {
  readonly mode: LaneMode;
  readonly hideComplete: boolean;
  readonly setMode: (mode: LaneMode) => void;
  readonly setHideComplete: (hide: boolean) => void;
}

/** The viewer's lane view, kept between visits, for the page to hand every round and its controls. */
export function useLaneView(): LaneSettings {
  const [mode, setMode] = useDashPref('lanes.mode');
  const [hideComplete, setHideComplete] = useDashPref('lanes.hideComplete');
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
function Lanes({ run, now, mode, hideComplete, on, passes }: {
  run: AuditRun; now: number; mode: LaneMode; hideComplete: boolean; on: AreaHandlers; passes: ReadonlyMap<string, number>;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const clock = runClockOf(run, now);
  const lanes = run.lanes.map((lane) => ({ lane, view: laneViewOf(lane, now, clock.from) })).filter(({ lane }) => !hideComplete || !passDone(lane));
  const widest = Math.max(0, ...run.lanes.map((l) => l.id.length));
  useLayoutEffect(() => { ref.current?.style.setProperty('--audit-lead-ch', String(widest)); }, [widest]);
  const dotsPx = dotsWidthFor(Math.max(0, ...run.lanes.map((l) => (passes.get(l.id) ?? 0) + (passDone(l) ? 0 : 1))));
  useLayoutEffect(() => { ref.current?.style.setProperty('--audit-dots-px', `${dotsPx}px`); }, [dotsPx]);
  // A label's element is remade whenever its text changes, restarting its pulse; one shared start keeps every pulse in step.
  useLayoutEffect(() => {
    for (const a of ref.current?.getAnimations?.({ subtree: true }) ?? []) {
      if (a instanceof CSSAnimation && a.animationName.includes('node-pulse')) a.startTime = 0;
    }
  });
  if (lanes.length === 0) return null;
  const rows = lanes.map(({ lane, view }) => laneRow(lane, view, on, mode === 'steps' ? laneStepsOf(lane, now) : view.spans, passes.get(lane.id) ?? 0));
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
      <span className={cx(s.count, s.doneCount)}>{done} of {total} done</span>
      {stages.map(({ phase, n }) => (
        <span key={phase} className={cx(s.count, phaseClass(phase))}><i className={s.dot} aria-hidden="true" />{n} {STAGE_LABEL[phase]}</span>
      ))}
    </div>
  );
}

/** One run's strip: what it is doing and what it has spent, its last line, what its batch left out, and a lane per
 *  area in flight. */
function RunStrip({ run, now, mode, hideComplete, on, passes }: {
  run: AuditRun; now: number; mode: LaneMode; hideComplete: boolean; on: AreaHandlers; passes: ReadonlyMap<string, number>;
}) {
  return (
    <section className={cx(s.run, !run.running && s.idle)} aria-label={`Round ${run.round}`}>
      <div className={s.head}>
        <div className={s.pulse} aria-hidden="true" />
        <div className={s.what}>
          <span>{headlineOf(run)}</span>
          {run.started && <span className={s.started}>{[startedText(run.started, now), elapsedText(run, now)].filter(Boolean).join(' • ')}</span>}
        </div>
        {run.lanes.length > 0 ? <StageCounts run={run} /> : <span />}
        <div className={s.line} title={lastLineOf(run)}><InlineMarkdown text={lastLineOf(run)} /></div>
        <div className={s.spend}>{spendOf(run)}</div>
      </div>
      {/* Only its own round's: a branch an earlier round left out, retried here, is listed once, below every run. */}
      <LeftOut entries={(run.leftOut ?? []).filter((e) => e.round === run.round)} label="left out" name={`Round ${run.round}, left out of the batch`} on={on} />
      {run.lanes.length > 0 && (
        <div className={s.lanes} data-mode={mode}>
          <Lanes run={run} now={now} mode={mode} hideComplete={hideComplete} on={on} passes={passes} />
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
const NO_PASSES: ReadonlyMap<string, number> = new Map();

export function LiveRuns({ runs, unmerged, now, on, view, focus = null, passes = NO_PASSES, leftOut = [] }: {
  runs: readonly AuditRun[]; unmerged: ReadonlySet<number>; now: number; on: AreaHandlers;
  /** Branches earlier batches left out that later ones still try (the map's `leftOut`). */
  leftOut?: readonly AuditLeftOut[];
  /** How many passes each area has had, by id, for the dots on its lane as on its map cell. */
  passes?: ReadonlyMap<string, number>;
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
  const shown = new Set(live.map((r) => r.round));
  const earlier = <LeftOut entries={leftOut.filter((e) => !shown.has(e.round))} label="still left out" name="Left out of earlier batches, still retried" on={on} />;
  if (live.length === 0) return <section className={cx(s.run, s.idle)}><div className={s.what}>No round running</div>{earlier}</section>;
  return (
    <div ref={root} className={s.runs} aria-live="polite">
      {live.map((run) => <RunStrip key={run.round} run={run} now={now} mode={view.mode} hideComplete={view.hideComplete} on={on} passes={passes} />)}
      {earlier}
    </div>
  );
}
