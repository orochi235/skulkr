/** Where a run has an area: the phase it is in, the color that phase wears, and the stretches its lane runs through. */
import { getOwn } from '@weasel-js/registry';
import type { AuditArea, AuditLane, AuditRun, LaneStep, LaneStepKey } from './skulkrMap.types';
import palette from './palette.module.css';

/** Where every area goes, in order, `reviewed` once one of its two reviews is in: their colors run along one sweep,
 *  indigo to yellow, which the legend draws. The patch is off it, black outlined white, as a fixed area is. */
export const PIPELINE = ['review', 'reviewed', 'match', 'fix', 'patch'] as const;
export const SWEEP = ['review', 'reviewed', 'match', 'fix'] as const satisfies readonly AuditPhase[];

/** How the legend names each phase. */
export const PHASE_LABEL: Readonly<Record<AuditPhase, string>> = {
  review: 'review', reviewed: 'one review in', match: 'match', fix: 'fix', patch: 'patch', conflict: 'conflict', done: 'done',
};
/** Where an area can end up, off the sweep. */
export const OFF_PIPELINE = ['conflict', 'done'] as const;
export const AUDIT_PHASES = [...PIPELINE, ...OFF_PIPELINE] as const;
export type AuditPhase = typeof AUDIT_PHASES[number];

/** A lane's stretches, in order: the two reviewers run side by side, so they share one. A lane has a repair stretch
 *  only once skulkr has checked its fix. */
export const PARTS = ['review', 'match', 'fix', 'repair', 'patch'] as const;
export type Part = typeof PARTS[number];
export const STEPS_OF: Readonly<Record<Part, readonly LaneStepKey[]>> = { review: ['A', 'B'], match: ['match'], fix: ['fix'], repair: ['repair'], patch: ['patch'] };

/** How long each stretch usually takes, in minutes: its width until it has a measured one. */
export const TYPICAL_MINUTES: Readonly<Record<Part, number>> = { review: 5, match: 0.5, fix: 18, repair: 10, patch: 0.5 };

const WAITING: LaneStep = { state: 'waiting' };
/** A lane's step by key; a lane not yet checked has no repair step, which reads as waiting. */
export const stepOf = (lane: AuditLane, key: LaneStepKey): LaneStep => lane.steps[key] ?? WAITING;

/** Where a round's title counts an area: its phase, with a running fix split by the column the steps view lights for
 *  it, its fixer's own checks past its last commit, or the controller's verify or repair after them. */
export type Stage = AuditPhase | 'checks' | 'repair';
const STAGES: readonly Stage[] = ['review', 'reviewed', 'match', 'fix', 'checks', 'repair', 'patch', 'conflict'];
export const STAGE_LABEL: Readonly<Record<Stage, string>> = { ...PHASE_LABEL, checks: 'checks', repair: 'verify' };

/** Whether a fixer has made every commit it set out to and is still running: its checks. */
export const checkingOf = (fix: LaneStep): boolean => fix.state === 'running' && !!fix.total && (fix.done ?? 0) >= fix.total;

/** The phase's color, as the stylesheet defines it. */
export const phaseColor = (phase: AuditPhase): string => `var(--audit-phase-${phase})`;

/** The span fills light enough that a label's pulse rests dark on them: lightness 0.65 and up in `palette.module.css`. */
export const BRIGHT_FILLS: ReadonlySet<string> = new Set([phaseColor('match'), phaseColor('fix'), 'var(--audit-checks)']);

/** A lane label's ink where its span is filled in `phase`'s color: white on the patch's black, else the lanes' own. */
export const phaseInkOf = (phase: AuditPhase, fill: number | undefined): string | undefined =>
  (phase === 'patch' && (fill === undefined || fill > 0) ? 'var(--audit-phase-patch-ink)' : undefined);

/** The class that sets `--audit-phase` to the phase's color, for an element that wears it. */
export const phaseClass = (phase: Stage): string => getOwn(palette, `phase-${phase}`) ?? '';

export interface PartState {
  readonly part: Part;
  readonly state: LaneStep['state'];
  readonly steps: readonly LaneStep[];
}

function partState(lane: AuditLane, part: Part): PartState {
  const steps = STEPS_OF[part].map((name) => stepOf(lane, name));
  const state = steps.some((s) => s.state === 'failed') ? 'failed'
    : steps.every((s) => s.state === 'done') ? 'done'
    : steps.some((s) => s.state !== 'waiting') ? 'running'
    : 'waiting';
  return { part, state, steps };
}

export const partsOf = (lane: AuditLane): PartState[] => PARTS.filter((part) => part !== 'repair' || lane.steps.repair).map((part) => partState(lane, part));

/** Whether an area is through: patched, fixed with no commits to patch, or reviewed or matched with nothing to fix. */
export function isFinished(lane: AuditLane): boolean {
  const { A, B, match, fix, patch } = lane.steps;
  if (patch.state === 'done') return true;
  // Two reviews that found nothing leave nothing to match.
  if (A.state === 'done' && B.state === 'done' && (A.findings ?? 0) + (B.findings ?? 0) === 0) return true;
  // A fix that made no commits leaves no patch to apply.
  if (fix.state === 'done' && fix.commits === 0) return true;
  return match.state === 'done' && (match.a ?? 0) + (match.b ?? 0) - (match.shared ?? 0) === 0;
}

/** The phase an area is in: a conflict once any step fails, done once it is through, else the step running or next. */
export function phaseOf(lane: AuditLane): AuditPhase {
  const parts = partsOf(lane);
  if (parts.some((p) => p.state === 'failed')) return 'conflict';
  if (isFinished(lane)) return 'done';
  const part = parts.find((p) => p.state === 'running') ?? parts.find((p) => p.state === 'waiting');
  return part ? partPhase(part) : 'done';
}

/** The color of a span of `part` drawn in `phase`: the controller's verify and repair in magenta of their own, unless failed. */
export const partColor = (part: Part, phase: AuditPhase): string => (part === 'repair' && phase !== 'conflict' ? 'var(--audit-repair)' : phaseColor(phase));

/** The phase a part's color stands for: a review with one of its two reports in has gone a step further. */
export function partPhase(p: PartState): AuditPhase {
  if (p.state === 'failed') return 'conflict';
  if (p.part === 'review' && p.steps.some((s) => s.state === 'done')) return 'reviewed';
  return p.part === 'repair' ? 'fix' : p.part;
}

/** A round's areas counted by phase: how many are done of all of them, then how many sit in each phase that has any,
 *  in pipeline order, a conflict last. */
export function stageCountsOf(lanes: readonly AuditLane[]): { done: number; total: number; stages: { phase: Stage; n: number }[] } {
  const by = new Map<Stage, number>();
  for (const lane of lanes) {
    const phase = stageOf(lane);
    by.set(phase, (by.get(phase) ?? 0) + 1);
  }
  const stages = STAGES.flatMap((phase) => (by.get(phase) ? [{ phase, n: by.get(phase)! }] : []));
  return { done: by.get('done') ?? 0, total: lanes.length, stages };
}

/** An area's stage for the round's title: its live phase, a running fix told apart by `Stage`. */
function stageOf(lane: AuditLane): Stage {
  const phase = livePhaseOf(lane);
  if (phase !== 'fix') return phase;
  if (lane.steps.repair && lane.steps.repair.state === 'running') return 'repair';
  return checkingOf(lane.steps.fix) ? 'checks' : 'fix';
}

/** Whether the round's pass over an area is done: it is through, or its fixer has finished, no repair is under way, and
 *  only its patch, which lands with the round's batch, is left. */
export const passDone = (lane: AuditLane): boolean =>
  isFinished(lane) || (lane.steps.fix.state === 'done' && lane.steps.repair?.state !== 'running');

/** A live area's phase as the map, the stage counts and "Hide complete" all read it: a conflict once a step fails, as
 *  its lane says, else `done` once its pass is (`passDone`). */
export function livePhaseOf(lane: AuditLane): AuditPhase {
  const phase = phaseOf(lane);
  return phase !== 'conflict' && passDone(lane) ? 'done' : phase;
}

/** Every area a live run holds, by id, and its phase on the map (`livePhaseOf`). */
export function phasesOf(runs: readonly AuditRun[]): ReadonlyMap<string, AuditPhase> {
  return new Map(runs.filter((r) => r.running).flatMap((r) => r.lanes.map((lane) => [lane.id, livePhaseOf(lane)] as const)));
}

/** What a live run estimates each of its areas still holds once both reviews are matched, before the pass is done. */
export const liveEstimatesOf = (runs: readonly AuditRun[]): ReadonlyMap<string, number> =>
  new Map(runs.filter((r) => r.running).flatMap((r) => r.lanes.flatMap((l) => (l.pass ? [[l.id, l.pass.left] as const] : []))));

/** `areas`, each whose pass a live run has done carrying that pass, provisional until the round's record lands, as its
 *  `last`: the run read the whole area. */
export function withLivePasses(areas: readonly AuditArea[], runs: readonly AuditRun[]): readonly AuditArea[] {
  const live = new Map(runs.filter((r) => r.running).flatMap((r) => r.lanes.filter((l) => l.pass && passDone(l)).map((l) => [l.id, l.pass!] as const)));
  if (live.size === 0) return areas;
  return areas.map((a) => {
    const pass = live.get(a.id);
    if (!pass || a.passes.some((p) => p.round === pass.round)) return a;
    const provisional = { ...pass, provisional: true };
    return { ...a, passes: [...a.passes, provisional], last: provisional };
  });
}

