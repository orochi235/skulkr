/** The JSON `skulkr map` prints, which `api/t/<tenant>/map` serves. */

/** `tonight` is an area a live run holds. */
export type AreaStatus = 'unaudited' | 'due' | 'settled' | 'tonight';

export interface AuditPass {
  readonly round: number;
  readonly date: string;
  readonly a: number;
  readonly b: number;
  readonly shared: number;
  readonly distinct: number;
  readonly est: number;
  readonly left: number;
  /** The defects its fixer's report says it fixed, listed or extra; absent where there is no report with verdicts. */
  readonly fixed?: number;
  /** `left` times the calibration factor for the pass's shared bucket (the map's `calibration`). */
  readonly leftCorrected?: number;
  /** The part of the pass's files this area holds, when it holds only some: `est` and `left` are scaled by it. */
  readonly share?: number;
  /** A live run's pass, its area's pass done and its round's record not yet landed. Never in the map's JSON: the page
   *  sets it (`withLivePasses`) on the lane's pass it adds to the area. */
  readonly provisional?: boolean;
}

/** What an area's estimate goes by: the round of the pass it comes from, and what that pass left. */
export interface AreaEstimate {
  readonly round: number;
  readonly left: number;
  readonly leftCorrected?: number;
}

/** An area's estimate from round `round` on: from the pass of round `pass` where that is earlier, `leftCorrected`
 *  absent where it equals `left`. */
export interface AreaEstimateAt {
  readonly round: number;
  readonly pass?: number;
  readonly left: number;
  readonly leftCorrected?: number;
}

export interface AuditArea {
  readonly id: string;
  readonly group: string;
  readonly files: number;
  readonly status: AreaStatus;
  readonly queue: number | null;
  readonly passes: readonly AuditPass[];
  /** The pass its estimate goes by, as the queue ranks it: its last round that read at least half its files, drawn as
   *  one pass and corrected. Null with no passes; absent from maps built before 2026-11-21. */
  readonly last?: AreaEstimate | null;
  /** What `last` was after each round that changed it, oldest first; absent before passes had read half its files,
   *  and from maps built before 2026-11-21. */
  readonly lastByRound?: readonly AreaEstimateAt[];
  readonly stage: string | null;
  /** Lines of its files changed since its last pass, that pass's own fixes aside; absent when none. */
  readonly staleLines?: number;
  /** Its icon's name, a key of the map's `icons`; absent when the config gives it none. */
  readonly icon?: string;
  /** The round whose unmerged branch holds it, which keeps it out of the queue; absent when none does, or a live run does. */
  readonly locked?: number;
  /** How many findings a round reported that no fixer has acted on since; absent when none. */
  readonly openFindings?: number;
  /** Those findings, oldest first, each with the round that first reported it. */
  readonly open?: readonly OpenFinding[];
}

export interface OpenFinding {
  readonly round: number;
  readonly claim: string;
  readonly where: string;
}

export type LaneStepName = 'A' | 'B' | 'match' | 'fix' | 'patch';
/** A lane's steps, the repair among them once skulkr has checked the fix: it verifies what the fixer committed and
 *  repairs it while that fails. */
export type LaneStepKey = LaneStepName | 'repair';

/** One counter of a running job's: `done` of `total`, `failed` of them failing. */
export interface JobCounter {
  readonly done: number;
  readonly total: number;
  readonly failed: number;
}

export interface LaneStep {
  readonly state: 'waiting' | 'running' | 'done' | 'failed';
  readonly node?: string;
  readonly since?: string;
  /** A running step's own count of its work, as onto reports it: a reviewer's files read, a fixer's commits of its
   *  findings. */
  readonly done?: number;
  readonly total?: number;
  /** A running fixer's checks and their tests, where the local runner counts them, and its latest note. */
  readonly checks?: JobCounter;
  readonly tests?: JobCounter;
  readonly now?: { readonly text: string; readonly at: string };
  readonly findings?: number;
  readonly read?: number;
  readonly files?: number;
  readonly minutes?: number;
  readonly shared?: number;
  readonly a?: number;
  readonly b?: number;
  readonly commits?: number;
  /** A done fix's tally, where its report gives one: of the `of` findings it was given, how many it fixed, and the
   *  defects nobody had listed it fixed besides. */
  readonly fixed?: number;
  readonly of?: number;
  readonly extra?: number;
  /** Of `of`, how many the fixer left for later, filed or waiting on a question, rather than fixed or found sound. */
  readonly deferred?: number;
  /** Of `of`, how many the fixer found were no defect. */
  readonly dismissed?: number;
  readonly why?: string;
  /** A done patch step whose branch conflicted with the batch and was merged anyway: how (`merged after a conflict
   *  repair`, `merged outside skulkr`). */
  readonly resolved?: string;
  /** A repair step's repair jobs so far, and how its last verify ended. */
  readonly attempts?: number;
  /** A running repair step's job: the controller's verify of the fixer's commits, or a repair. */
  readonly job?: 'verify' | 'repair';
  readonly outcome?: 'passed' | 'failed' | 'timed out';
  /** When a done step began and ended, from onto's record of the job that ran it. */
  readonly started?: string;
  readonly ended?: string;
}

export interface AuditLane {
  readonly id: string;
  readonly steps: Readonly<Record<LaneStepName, LaneStep>> & { readonly repair?: LaneStep };
  /** The pass this round has made of the area, once matched, as its record will hold it. */
  readonly pass?: AuditPass;
}

/** One of the batch gate's parallel runs: its id in `fleet`, `gates`, `gateNodes` and `failures`, and its label. */
export interface GateRunName {
  readonly id: string;
  readonly label: string;
}

/** One fleet run's state after its round finished. */
export type GateState = 'running' | 'passed' | 'failed' | null;

/** How far one fleet run has got: `done` of `total`, in whatever unit it counts. */
export interface FleetProgress {
  readonly done: number;
  readonly total: number;
}

/** A branch a batch left out: its area, the round whose branch it is, and why. */
export interface AuditLeftOut {
  readonly area: string;
  readonly round: number;
  readonly why: string;
}

export interface AuditRun {
  readonly running: boolean;
  readonly round: number;
  readonly started?: string;
  readonly ended: string | null;
  readonly step: string;
  /** What a run waiting for the merge lock or the fleet waits behind: `round 51`, `weasel round 51`. */
  readonly behind?: string;
  readonly costUsd: number;
  /** The round's spend over the areas that spent, and over their files; null until one has. */
  readonly usdPerArea: number | null;
  readonly usdPerFile: number | null;
  readonly capUsd: number | null;
  readonly report: string | null;
  readonly areas: readonly string[];
  readonly stages: Readonly<Record<string, string>>;
  /** Every branch the run's batch left out, a branch an earlier round left out and this one retried among them. Absent
   *  from maps built before 2026-11-21. */
  readonly leftOut?: readonly AuditLeftOut[];
  readonly lanes: readonly AuditLane[];
  readonly nightDir?: string | null;
  readonly sweepRunning: boolean;
  readonly lastLine: string | null;
  readonly lines: readonly string[];
  /** The batch gate's parallel runs, in drawing order, as the project's config names them. */
  readonly gateRuns?: readonly GateRunName[];
  /** How far each of the batch's gate runs has got while it runs, by its id. */
  readonly fleet?: Readonly<Record<string, FleetProgress | null>> | null;
  /** Each gate run's state once the run has finished: how it ended, or 'running' while the batch runs again. */
  readonly gates?: Readonly<Record<string, GateState>> | null;
  /** Whether the finished round's batch is running again. */
  readonly rerun?: boolean;
  /** The nodes running each fleet run now, joined where it runs on more than one. */
  readonly gateNodes?: Readonly<Record<string, string | null>> | null;
  /** What each gate run has failed so far: how many tests or steps, in how many files or steps, the first few named. */
  readonly failures?: Readonly<Record<string, GateFailures | null>> | null;
}

export interface AuditRound {
  readonly round: number;
  /** Null for a round known only from areas it recorded incomplete. */
  readonly date: string | null;
  readonly areas: number;
  readonly files: number;
  readonly distinct: number;
  readonly est: number;
  /** A round with no committed record, read from its run's night directory: still running, or not merged. */
  readonly pending?: 'live' | 'unmerged';
  /** Areas the round recorded incomplete, a reviewer never run or never finished: left out of every count above. */
  readonly incomplete?: number;
}

/** Where a project's areas come from: its partition file, and the most source files one area holds. */
export interface AuditPartition {
  readonly path: string;
  readonly maxFiles: number;
}

export interface AuditContinuous {
  readonly until: string;
  /** `starts now`, or why the next round has not started. */
  readonly next: string;
  readonly nightUsd: number;
  readonly spentUsd: number;
  readonly leftUsd: number;
}

export interface SkulkrMap {
  readonly generated: string;
  readonly head: string;
  /** The audited project's name, for the page's title. */
  readonly project?: string;
  /** The branch `head` is on. */
  readonly branch?: string;
  readonly partition?: AuditPartition;
  /** How many areas a round takes unless told otherwise. */
  readonly areasPerRound?: number;
  /** Continuous mode, while it is on: until when, what the next round waits on, and the night's spend. */
  readonly continuous?: AuditContinuous;
  readonly runs: readonly AuditRun[];
  readonly areas: readonly AuditArea[];
  /** Each icon an area names, as its glyph: an SVG body on a 20×20 viewBox. */
  readonly icons?: Readonly<Record<string, string>>;
  readonly rounds: readonly AuditRound[];
  /** Each recorded round whose partition added areas: those it added and those it took their files from, named as the
   *  partition now holds their files. Absent from maps built before 2026-11-22. */
  readonly recuts?: readonly AuditRecut[];
  /** Every branch a batch left out that later batches still try, as `left-out.json` keeps them. Absent from maps built
   *  before 2026-11-22. */
  readonly leftOut?: readonly AuditLeftOut[];
  readonly calibration?: AuditCalibration;
}

export interface AuditRecut {
  readonly round: number;
  readonly areas: readonly string[];
}

/** One pass checked against the area's next: what it left, and what the next pass found. */
export interface CalibrationPair {
  readonly area: string;
  readonly round: number;
  readonly next: number;
  readonly a: number;
  readonly b: number;
  readonly shared: number;
  readonly est: number;
  readonly left: number;
  readonly found: number;
  /** Lines of the area's files changed between the two passes, the first's fixes aside. */
  readonly lines?: number;
}

/** Found over predicted, pooled over `pairs`; null while nothing was predicted. */
export interface CalibrationFactor {
  readonly pairs: number;
  readonly predicted: number;
  readonly found: number;
  readonly factor: number | null;
}

/** One round's passes against their areas' next passes, and the factor pooled over it and every earlier round. */
export interface CalibrationPoint {
  readonly round: number;
  readonly pairs: number;
  readonly predicted: number;
  readonly found: number;
  readonly factor: number | null;
}

/** How Chapman's "left" compared with what later passes found, recomputed on each map build. */
export interface AuditCalibration {
  /** The pairs a shared bucket needs before its own factor is used. */
  readonly minPairs: number;
  readonly pairs: readonly CalibrationPair[];
  readonly factors: { readonly overall: CalibrationFactor; readonly byShared: Readonly<Record<string, CalibrationFactor>> };
  readonly series: readonly CalibrationPoint[];
}

/** One defect as a round tells it: what was broken, who listed it, what became of it, and what the fix changed. */
export interface AuditDefect {
  readonly claim: string;
  /** `A`, `B`, `A+B`, `sweep`, `carried` for an earlier round's open finding handed to this round's fixer (README
   *  "Carried findings"), or `extra` for one the fixer found itself. */
  readonly from: string;
  readonly verdict: 'fixed' | 'not a defect' | 'duplicate' | 'question' | 'not fixed' | 'open';
  readonly note: string;
}

/** One round's defects in an area: from its record once landed, and from its fixer's report once it has one. */
export interface AuditAreaRound {
  readonly round: number;
  readonly recorded: boolean;
  readonly fixed: boolean;
  readonly items: readonly AuditDefect[];
  /** The subjects of a fixer's commits where it left commits but no report, as one stopped partway does. */
  readonly commits?: readonly string[];
}

/** A gate run's failures. */
export interface GateFailures {
  readonly count: number;
  readonly files: number;
  readonly names: readonly string[];
  /** Each failed file, its count and its first failed tests with the first line of each error; a step alone for a run of steps. */
  readonly list: readonly { readonly file: string; readonly count: number; readonly tests: readonly { readonly test: string; readonly error: string }[] }[];
}
