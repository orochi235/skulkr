/** One distinct defect in a saturation ledger, as `skulkr saturate ls --json` prints it. */
export interface SaturationDefect {
  readonly id: string;
  readonly claim: string;
  readonly where: string;
  readonly severity: string;
  /** How many occasions reported it. */
  readonly sightings: number;
  /** Seen in so many of its ledger's passes (`saturate.recurrent`) that it may one day go straight to fix. */
  readonly recurrent?: boolean;
  /** The occasions that reported it, by number. */
  readonly seenAt: readonly number[];
  readonly firstOccasion: number | null;
  /** The sources whose occasions reported it. */
  readonly sources: readonly string[];
  /** The source that found it outside any occasion, for a defect no occasion reported; else null. */
  readonly onlyBy: string | null;
  /** Its line in the project's defect registry, once its ledger has landed: the registry's id, its status (`open`,
   *  `fixed`, …) and the commit that resolved it; null before. */
  readonly registry: { readonly id: string; readonly status: string; readonly sha: string | null } | null;
}

/** One pass of a ledger: what it found and cost, and the estimates and spend as they stood after it. */
export interface SaturationPass {
  readonly n: number;
  readonly source: string;
  readonly findings: number;
  readonly new: number;
  readonly distinct: number;
  readonly unseen: number | null;
  readonly nextNew: number | null;
  readonly costUsd: number;
  readonly spentUsd: number;
  readonly usdPerDefect: number | null;
  readonly nextUsd: number | null;
  readonly defectsPerKloc: number | null;
  readonly unseenPerKloc: number | null;
  readonly costPerKloc: number | null;
  readonly at: string | null;
}

/** One area's saturation ledger, summed up: its repeated blind reviews at one frozen commit and what they found. */
export interface SaturationLedger {
  /** The ledger's directory: its area, or `<area>.<commit>` for one set aside. */
  readonly id: string;
  readonly area: string;
  readonly commit: string;
  readonly files: number;
  /** Its lines at the frozen commit; null where they could not be counted. */
  readonly lines: number | null;
  readonly occasions: number;
  /** Occasions by source. */
  readonly sources: Readonly<Record<string, number>>;
  readonly costUsd: number;
  readonly distinct: number;
  /** Chao2's estimate of the defects the area holds, null under two occasions; `unseen` is it less `distinct`. */
  readonly total: number | null;
  readonly unseen: number | null;
  /** The chance the next occasion's finding is new. */
  readonly nextNew: number | null;
  /** What the next defect should cost (README "The price of the next defect"); null under two occasions or with none expected. */
  readonly nextUsd: number | null;
  /** The per-defect limit a delve stops at: dollars, and where it is a multiple of the going rate, the multiple and rate. */
  readonly limit: { readonly usd: number; readonly times: number | null; readonly goingUsd: number | null; readonly text: string };
  /** Defects found, estimated unseen, and dollars spent, each per thousand lines; null without `lines`. */
  readonly defectsPerKloc: number | null;
  readonly unseenPerKloc: number | null;
  readonly usdPerKloc: number | null;
  /** Its passes in order. */
  readonly passes: readonly SaturationPass[];
  /** Why the stop rule holds, null while it does not. */
  readonly stopped: string | null;
  /** When its last occasion was recorded. */
  readonly updated: string | null;
  readonly defects: readonly SaturationDefect[];
  /** What a live scour process holding the ledger is doing, null while none does. */
  readonly running: ScourLive | null;
}

/** One job a scour process has out: its occasion's key, its newest log's step, and that log's last line. */
export interface ScourJob {
  readonly key: string;
  readonly step: string | null;
  readonly at: string | null;
  readonly line: string | null;
  readonly progress: { readonly done: number; readonly of: number } | null;
}

/** A live scour process on a ledger, as `skulkr scour ls --json` reads it from the ledger's directory. */
export interface ScourLive {
  readonly pid: number;
  readonly since: string;
  /** `delve`, `fold` or `ingest`; null for a process that did not say. */
  readonly does: string | null;
  /** The occasion cap a delve runs to. */
  readonly max: number | null;
  readonly jobs: readonly ScourJob[];
  /** The last lines of its `scour.log`, each led by its ISO time. */
  readonly log: readonly string[];
}
