/** One distinct defect in a saturation ledger, as `skulkr saturate ls --json` prints it. */
export interface SaturationDefect {
  readonly id: string;
  readonly claim: string;
  readonly where: string;
  readonly severity: string;
  /** How many occasions reported it. */
  readonly sightings: number;
  readonly firstOccasion: number | null;
  /** The sources whose occasions reported it. */
  readonly sources: readonly string[];
  /** The source that found it outside any occasion, for a defect no occasion reported; else null. */
  readonly onlyBy: string | null;
}

/** One area's saturation ledger, summed up: its repeated blind reviews at one frozen commit and what they found. */
export interface SaturationLedger {
  /** The ledger's directory: its area, or `<area>.<commit>` for one set aside. */
  readonly id: string;
  readonly area: string;
  readonly commit: string;
  readonly files: number;
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
  /** Why the stop rule holds, null while it does not. */
  readonly stopped: string | null;
  /** When its last occasion was recorded. */
  readonly updated: string | null;
  readonly defects: readonly SaturationDefect[];
}
