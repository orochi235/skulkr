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
  /** The part of the pass's files this area holds, when it holds only some: `est` and `left` are scaled by it. */
  readonly share?: number;
  /** A live run's pass, its area's pass done and its round's record not yet landed. */
  readonly provisional?: boolean;
}

export interface AuditArea {
  readonly id: string;
  readonly group: string;
  readonly files: number;
  readonly status: AreaStatus;
  readonly queue: number | null;
  readonly passes: readonly AuditPass[];
  readonly stage: string | null;
  /** Lines of its files changed since its last pass, that pass's own fixes aside; absent when none. */
  readonly staleLines?: number;
  /** Its icon's name, a key of the map's `icons`; absent when the config gives it none. */
  readonly icon?: string;
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

export interface LaneStep {
  readonly state: 'waiting' | 'running' | 'done' | 'failed';
  readonly node?: string;
  readonly since?: string;
  /** A running step's own count of its work, as onto reports it: a reviewer's files read, a fixer's commits of its
   *  findings. */
  readonly done?: number;
  readonly total?: number;
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
  /** A repair step's repair jobs so far, and how its last verify ended. */
  readonly attempts?: number;
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

/** One fleet run's state after its round finished. */
export type GateState = 'running' | 'passed' | 'failed' | null;

/** How far one fleet run has got: `done` of `total`, in whatever unit it counts. */
export interface FleetProgress {
  readonly done: number;
  readonly total: number;
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
  readonly capUsd: number | null;
  readonly report: string | null;
  readonly areas: readonly string[];
  readonly stages: Readonly<Record<string, string>>;
  readonly lanes: readonly AuditLane[];
  readonly nightDir?: string | null;
  readonly sweepRunning: boolean;
  readonly lastLine: string | null;
  readonly lines: readonly string[];
  /** How far the batch's two fleet runs have got while they run: its tests, and its postbuild checks. */
  readonly fleet?: { readonly tests: FleetProgress | null; readonly build: FleetProgress | null } | null;
  /** Each fleet run's state once the run has finished: how it ended, or 'running' while the batch runs again. */
  readonly gates?: { readonly tests: GateState; readonly build: GateState } | null;
  /** Whether the finished round's batch is running again. */
  readonly rerun?: boolean;
  /** The nodes running each fleet run now, joined where it runs on more than one. */
  readonly gateNodes?: { readonly tests: string | null; readonly build: string | null } | null;
  /** What each gate run has failed so far: how many tests or steps, in how many files or steps, the first few named. */
  readonly failures?: { readonly tests: GateFailures | null; readonly build: GateFailures | null } | null;
}

export interface AuditRound {
  readonly round: number;
  readonly date: string;
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
}

/** One defect as a round tells it: what was broken, who listed it, what became of it, and what the fix changed. */
export interface AuditDefect {
  readonly claim: string;
  /** `A`, `B`, `A+B`, `sweep`, or `extra` for one the fixer found itself. */
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
