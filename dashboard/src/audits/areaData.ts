/** What the audit page says about areas: their tone on the map, the headline stats, and the queue. */
import { lerp } from '@weasel-js/geom';
import { warpScale } from '@weasel-js/scale';
import { getOwn } from '@weasel-js/registry';
import type { AreaEstimate, AreaStatus, AuditArea, AuditPass, AuditRun, SkulkrMap } from './skulkrMap.types';

/** How an area is shaded: never read, settled, or by how many defects are estimated to be left in it. */
export type AreaTone = 'unaudited' | 'settled' | { readonly left: number };

export const STATUS_LABEL: Readonly<Record<AreaStatus, string>> = {
  unaudited: 'never audited',
  due: 'due again',
  settled: 'settled',
  tonight: 'in a live run',
};

const STAGE_LABEL: Readonly<Record<string, string>> = {
  queued: 'queued',
  reviewing: 'one review in',
  reviewed: 'both reviews in',
  matched: 'matched',
  fixed: 'fixed',
  patched: 'patched',
  conflict: 'conflict',
};

/** What a live run's stage reads as: its label, or the stage's own name when it has none. */
export const stageLabelOf = (stage: string): string => getOwn(STAGE_LABEL, stage) ?? stage;

const r1 = (n: number) => Math.round(n * 10) / 10;

/** An area's passes with each round's as one, as the map's `drawnRoundOf` joins them for calibration: counts summed,
 *  `distinct` by share, `est` and `left` (already scaled by share) summed. An area whose files came from two areas of
 *  one round inherits a pass from each. */
export function passRoundsOf(passes: readonly AuditPass[]): AuditPass[] {
  const byRound = new Map<number, AuditPass[]>();
  for (const p of passes) byRound.set(p.round, [...(byRound.get(p.round) ?? []), p]);
  return [...byRound.values()].map((group) => {
    if (group.length === 1) return group[0]!;
    const sum = (f: (p: AuditPass) => number) => group.reduce((n, p) => n + f(p), 0);
    const corrected = group.some((p) => p.leftCorrected !== undefined);
    return {
      round: group[0]!.round, date: group[0]!.date, a: sum((p) => p.a), b: sum((p) => p.b), shared: sum((p) => p.shared),
      distinct: r1(sum((p) => p.distinct * (p.share ?? 1))), est: r1(sum((p) => p.est)), left: r1(sum((p) => p.left)),
      ...(corrected ? { leftCorrected: r1(sum((p) => p.leftCorrected ?? p.left)) } : {}),
      ...(group.some((p) => p.provisional) ? { provisional: true } : {}),
    };
  });
}

/** The pass an area's estimate goes by: the map's `last`, or on a map without it, its last round's passes joined
 *  (`passRoundsOf`). Given a past `round`, the estimate `lastByRound` held after it, or null where none did yet. */
export function lastPassOf(area: AuditArea, round?: number | null): AreaEstimate | null {
  if (round === undefined || round === null) return area.last !== undefined ? area.last : passRoundsOf(area.passes).at(-1) ?? null;
  const at = area.lastByRound?.findLast((e) => e.round <= round);
  return at ? { round: at.pass ?? at.round, left: at.left, leftCorrected: at.leftCorrected ?? at.left } : null;
}

/** A pass's left, calibrated, or its own where the map has no calibration. */
export const correctedLeftOf = (p: AreaEstimate): number => p.leftCorrected ?? p.left;

/** A pass's estimate with its left calibrated: what it found plus the corrected left. */
export const correctedEstOf = (p: AuditPass): number => p.est + correctedLeftOf(p) - p.left;

/** Whether a corrected figure says anything its raw one does not: it differs by a whole defect and by a tenth. */
export const correctionShows = (raw: number, corrected: number | undefined): corrected is number =>
  corrected !== undefined && Math.abs(corrected - raw) >= Math.max(1, 0.1 * Math.abs(raw));

/** The corrected figure as it reads beside a raw one: whole defects, approximate. */
export const correctedText = (n: number): string => `≈${formatCount(Math.round(n))}`;

export function toneOf(area: AuditArea): AreaTone {
  if (area.status === 'settled') return 'settled';
  if (area.status === 'unaudited') return 'unaudited';
  const pass = lastPassOf(area);
  return pass ? { left: pass.left } : 'unaudited';
}

/** Whether an area's files changed since its last pass. */
export const changedSincePass = (area: { readonly staleLines?: number }): boolean => (area.staleLines ?? 0) > 0;

/** How near the top, as a share of the bar, a round tick gives way to the top's own. */
const TOP_ROOM = 0.12;

/** The least the heat scale's top may be, so a quiet map does not paint its few defects hot. */
const HEAT_FLOOR = 8;

/** `sorted`'s value at fraction `p` of the way through it, read between neighbors. */
function quantile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const at = p * (sorted.length - 1);
  const lo = Math.floor(at);
  return lerp(sorted[lo]!, sorted[Math.min(lo + 1, sorted.length - 1)]!, at - lo);
}

/** Where estimated defects left sit on the heat ramp, and the values the legend marks. */
export interface HeatScale {
  /** The value that reaches the hot end: the 98th percentile of the audited areas, at least `HEAT_FLOOR`. */
  readonly top: number;
  /** `left`'s place along the ramp, 0 to 1, through log1p so the middle has room and only outliers reach the top. */
  readonly at: (left: number) => number;
  /** Round values spaced evenly along the bar, then the top. */
  readonly ticks: readonly { readonly label: string; readonly value: number }[];
}

/** What the areas still being audited have left now. */
const leftNowIn = (areas: readonly AuditArea[]): number[] =>
  areas.flatMap((a) => (a.status === 'settled' ? [] : [lastPassOf(a)?.left ?? NaN]));

/** The heat scale for `areas`, set by what the areas still being audited have left. */
export const heatScaleOf = (areas: readonly AuditArea[]): HeatScale => heatScaleFor(leftNowIn(areas));

/** One heat scale for the map now and as of every past round (`lastByRound`), so a color means the same estimate
 *  whichever round the slider shows. */
export const heatScaleOverRounds = (areas: readonly AuditArea[]): HeatScale =>
  heatScaleFor([...leftNowIn(areas), ...areas.flatMap((a) => (a.lastByRound ?? []).map((e) => e.left))]);

/** The heat scale for estimates `values`, its top their 98th percentile. */
function heatScaleFor(values: readonly number[]): HeatScale {
  const left = values.filter(Number.isFinite).sort((x, y) => x - y);
  const top = Math.max(HEAT_FLOOR, quantile(left, 0.98));
  const scale = warpScale({ domain: [0, top], range: [0, 1], to: Math.log1p, from: Math.expm1 });
  const at = (v: number) => Math.min(1, Math.max(0, scale.position(Math.max(0, v))));
  // The top keeps its own tick, so a round one crowding it gives way.
  const ticks = [
    ...scale.ticks(4).filter((v) => at(v) < 1 - TOP_ROOM).map((value) => ({ label: String(value), value })),
    { label: 'top', value: top },
  ];
  return { top, at, ticks };
}

export const formatCount = (n: number): string => n.toLocaleString('en-US');

export interface Stat {
  readonly value: string;
  readonly label: string;
}

/** The defects every pass over the area found; a pass several areas inherited counts by this one's share, so it counts
 *  once over them. */
export const foundIn = (area: AuditArea): number => area.passes.reduce((n, p) => n + p.distinct * (p.share ?? 1), 0);

/** The defects its passes' fixers fixed, by share as `foundIn` counts, and how many passes reported it; null where no
 *  pass has a fix report with verdicts. */
export function fixedIn(area: AuditArea): { readonly fixed: number; readonly reported: number } | null {
  const reported = area.passes.filter((p) => p.fixed !== undefined);
  if (reported.length === 0) return null;
  return { fixed: reported.reduce((n, p) => n + p.fixed! * (p.share ?? 1), 0), reported: reported.length };
}

/** The headline numbers over every area, or over the areas as of a past round (`areasAsOf`). Settling is not known
 *  of a past round, so it is counted over `now`, every area as it stands. */
export function statsFor(areas: readonly AuditArea[], asOf: number | null = null, now: readonly AuditArea[] = areas): Stat[] {
  const files = areas.reduce((n, a) => n + a.files, 0);
  const audited = areas.filter((a) => a.passes.length > 0 && a.status !== 'unaudited');
  const auditedFiles = audited.reduce((n, a) => n + a.files, 0);
  const left = audited.reduce((n, a) => n + (lastPassOf(a)?.left ?? 0), 0);
  const staleLeft = audited.reduce((n, a) => n + (a.staleLines ? lastPassOf(a)?.left ?? 0 : 0), 0);
  const leftCorrected = audited.reduce((n, a) => { const p = lastPassOf(a); return n + (p ? correctedLeftOf(p) : 0); }, 0);
  const calibrated = correctionShows(left, audited.some((a) => lastPassOf(a)?.leftCorrected !== undefined) ? leftCorrected : undefined);
  const found = Math.round(areas.reduce((n, a) => n + foundIn(a), 0));
  const settled = now.filter((a) => a.status === 'settled').length;
  return [
    { value: `${formatCount(audited.length)} / ${formatCount(areas.length)}`, label: asOf === null ? 'areas audited at least once' : `areas audited by round ${asOf}` },
    { value: `${files ? Math.round((100 * auditedFiles) / files) : 0}%`, label: `of ${formatCount(files)} source files charted` },
    { value: formatCount(found), label: asOf === null ? 'defects found and fixed, all rounds' : `defects found and fixed through round ${asOf}` },
    {
      value: `≈${formatCount(Math.round(left))}`,
      label: `estimated still in audited areas${calibrated ? ` (${correctedText(leftCorrected)} corrected)` : ''}${staleLeft >= 0.5 ? `, ≈${formatCount(Math.round(staleLeft))} of it in areas changed since` : ''}`,
    },
    { value: formatCount(settled), label: asOf === null ? 'areas settled' : 'areas settled now' },
  ];
}

/** The next `count` areas a run would pick, leaving out those a live run already holds. */
/** How many rounds' worth of the queue the next-up list shows. */
export const NEXT_UP_ROUNDS = 3;

export function nextUpOf(areas: readonly AuditArea[], count = 8): AuditArea[] {
  return areas
    .filter((a) => a.queue !== null && a.status !== 'tonight')
    .sort((x, y) => (x.queue ?? 0) - (y.queue ?? 0))
    .slice(0, count);
}

/** The live run holding `id`, if one does. */
export const runHolding = (runs: readonly AuditRun[], id: string): AuditRun | undefined =>
  runs.find((r) => r.running && r.areas.includes(id));

/**
 * What `skulkr defects <id>` reads, as far as the map shows it, as one string that changes when its answer could: the
 * area's recorded passes, and each run's lane for it, step by step, with the commits a fixer has made.
 */
export function defectsVersionOf(map: Pick<SkulkrMap, 'areas' | 'runs'>, id: string): string {
  const passes = map.areas.find((a) => a.id === id)?.passes.map((p) => p.round) ?? [];
  const lanes = map.runs.flatMap((r) => r.lanes.filter((l) => l.id === id).map((l) => [
    r.round, Object.entries(l.steps).map(([k, s]) => `${k}:${s.state}:${s.commits ?? ''}:${s.done ?? ''}`),
  ]));
  return JSON.stringify([passes, lanes]);
}

/** What a name shows inside the frame `parent`: the rest of it past the frame's path, or its last segment where it is
 *  the frame's own name; all of it at the top. */
export function labelIn(name: string, parent: string | null): string {
  if (parent === null) return name;
  if (name.startsWith(`${parent}.`)) return name.slice(parent.length + 1);
  return name.split('.').at(-1) ?? name;
}

/** `text` cut to `max` characters, an ellipsis standing in for the rest. */
export function clip(text: string, max: number): string {
  if (max <= 0) return '';
  return text.length > max ? `${text.slice(0, Math.max(1, max - 1))}…` : text;
}

/**
 * `text` in lines of at most `maxChars`, broken after its dots (`core.` / `domains.` / `paths`), at most `maxLines` of
 * them: the last holds the rest, cut short with an ellipsis where it does not fit, and so does any one piece too long
 * for a line of its own.
 */
export function wrapAtDots(text: string, maxChars: number, maxLines: number): string[] {
  if (maxChars <= 0 || maxLines <= 0) return [];
  const lines: string[] = [];
  for (const piece of text.split(/(?<=\.)/)) {
    const last = lines.at(-1);
    if (last !== undefined && (last + piece).length <= maxChars) lines[lines.length - 1] = last + piece;
    else lines.push(piece);
  }
  const kept = lines.slice(0, maxLines - 1);
  if (lines.length >= maxLines) kept.push(lines.slice(maxLines - 1).join(''));
  return kept.map((line) => clip(line, maxChars));
}
