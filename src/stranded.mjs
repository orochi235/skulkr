/**
 * Rounds whose batch never landed: an unmerged `batch/<date>-audit<N>` branch no live run owns, of a round not
 * abandoned. A new round planned past one starts from a `main` without its fixes and builds a batch that drifts
 * further from it, so `maxUnmergedRounds` holds new rounds back while more than that many are stranded.
 */
import { gitIn, mainCheckout } from './batch.mjs';
import { abandonedRounds, unlandedBatches } from './recordFiles.mjs';
import { liveRuns } from './runs.mjs';

/** `{ round, branch }` for each stranded round under `cfg`, rounds ascending. */
export const strandedRoundsFor = (cfg, git = gitIn(mainCheckout(cfg))) => {
  const live = new Set(liveRuns(cfg.state).map((r) => r.round));
  const abandoned = abandonedRounds(cfg.state);
  return unlandedBatches(git, cfg.naming.batchPrefix, cfg.git.main)
    .flatMap((branch) => {
      const round = Number(cfg.names.roundIn.exec(branch)?.[1]);
      return round && !live.has(round) && !abandoned.has(round) ? [{ round, branch }] : [];
    })
    .sort((a, b) => a.round - b.round);
};

/** Why a new round waits on `stranded` (`strandedRoundsFor`'), or null while it holds no more than `max`. */
export const strandedHoldFor = (stranded, max) => {
  if (stranded.length <= max) return null;
  const names = stranded.map((s) => s.round);
  const which = names.length === 1 ? `round ${names[0]}'s batch is` : `rounds ${names.slice(0, -1).join(', ')} and ${names.at(-1)}'s batches are`;
  return `${which} unmerged (${stranded.map((s) => s.branch).join(', ')}); land, delete, or abandon ${names.length === 1 ? 'it' : 'them'} first`;
};
