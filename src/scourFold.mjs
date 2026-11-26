/**
 * Folding: a finished report waits beside the ledger in its `unfolded` list until it is matched against the ledger's
 * defects and becomes the ledger's next occasion. Fleet mode's jobs (`saturate.mjs`) and session mode's subagents
 * (`scourSession.mjs`) both fold through here.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { allNew, keepReview, ledgerDirOf, withOccasion, writeLedger } from './ledger.mjs';
import { yieldRows } from './saturation.mjs';
import { nextPriceOf } from './scourPrice.mjs';
import { writeReport } from './saturationReport.mjs';
import { matchReport, occasionJobsOf } from './saturateJobs.mjs';

/** The progress line for occasion `o`, the last folded into `ledger`, under the stop rule `rule` (`scourRuleOf`). */
export const occasionLine = (ledger, o, { max, factor, stopUsdPerDefect }) => {
  const r = yieldRows(ledger).find((row) => row.n === o.n);
  const s = r.stats;
  const unseen = s.f0 === undefined ? '–' : s.f0.toFixed(1);
  const next = s.nextNew === undefined ? '–' : `${Math.round(s.nextNew * 100)}%`;
  const perDefect = r.usdPerDefect === undefined ? '–' : `$${r.usdPerDefect.toFixed(2)}`;
  const price = nextPriceOf(ledger, factor).usd;
  const nextUsd = price === undefined ? '–' : Number.isFinite(price) ? `$${price.toFixed(2)}` : 'none expected';
  return `${o.n}/${max} ${o.source}: ${o.findings} findings, ${r.new} new; distinct ${s.S}; unseen ≈ ${unseen}; next-new ${next}; $${o.costUsd.toFixed(2)}; ${perDefect}/defect, next ≈ ${nextUsd} (limit $${stopUsdPerDefect.toFixed(2)})`;
};

/** The file a report waits in until it is folded, relative to the ledger's directory. */
const unfoldedFileOf = (key) => `reviews/unfolded-${key.replace(/[^\w.-]+/g, '-')}.md`;

/**
 * Keeps a finished report beside the ledger and lists it in the ledger's `unfolded`, where it waits to be folded;
 * clears the job outputs it came from. Answers the new ledger.
 */
export const stageReport = (cfg, ledger, { key, source, kind, text, findings, costUsd, minutes }) => {
  const file = unfoldedFileOf(key);
  const path = join(ledgerDirOf(cfg, ledger.area), file);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, text);
  const next = { ...ledger, unfolded: [...(ledger.unfolded ?? []), { key, source, kind, file, findings, costUsd, minutes }] };
  writeLedger(cfg, next);
  rmSync(occasionJobsOf(cfg, ledger.area, key), { recursive: true, force: true });
  return next;
};

/** Whether the ledger's first unfolded report folds without a matcher: a review into an empty ledger, or one with no findings. */
export const foldsUnmatched = (ledger) => {
  const [entry] = ledger.unfolded;
  return entry.kind === 'review' && (ledger.defects.length === 0 || entry.findings.length === 0);
};

/** The text of the ledger's first unfolded report. */
export const unfoldedTextOf = (cfg, ledger) => readFileSync(join(ledgerDirOf(cfg, ledger.area), ledger.unfolded[0].file), 'utf8');

/**
 * Folds the ledger's first unfolded report in as its next occasion under `matched` (`{ match, costUsd, minutes }`, the
 * matcher's answer and what it cost), and writes the ledger. Answers the new ledger.
 */
export const foldWith = (cfg, ledger, matched) => {
  const [entry, ...rest] = ledger.unfolded;
  const { key, source, kind, file, costUsd, minutes } = entry;
  const dir = ledgerDirOf(cfg, ledger.area);
  const n = ledger.occasions.length + 1;
  const kept = keepReview(cfg, ledger.area, n, source, readFileSync(join(dir, file), 'utf8'));
  const { unfolded: _, ...folded } = ledger;
  const next = withOccasion(rest.length ? { ...folded, unfolded: rest } : folded, {
    n, source, kind, file: kept, costUsd: costUsd + matched.costUsd, minutes: minutes + matched.minutes, at: new Date().toISOString(),
    ...(matched.matcher ? { matcher: matched.matcher } : {}),
  }, matched.match);
  writeLedger(cfg, next);
  rmSync(join(dir, file), { force: true });
  rmSync(occasionJobsOf(cfg, ledger.area, key), { recursive: true, force: true });
  return next;
};

/** The answer for a report that folds without a matcher. */
export const unmatched = (ledger) => ({ match: allNew(ledger.unfolded[0].findings), costUsd: 0, minutes: 0 });

/**
 * Folds the ledger's first unfolded report through the ledger matcher's job (or whole as new when it needs none).
 * Answers the new ledger; throws, leaving the report unfolded, when the matcher fails.
 */
const foldNext = async (ctx, ledger) => {
  const { key, kind, findings } = ledger.unfolded[0];
  const area = { id: ledger.area, files: ledger.files };
  const matched = foldsUnmatched(ledger)
    ? unmatched(ledger)
    : await matchReport(ctx, area, key, ledger, kind === 'ingest' ? { raw: unfoldedTextOf(ctx.cfg, ledger) } : { findings });
  return foldWith(ctx.cfg, ledger, matched);
};

/** Says occasion `o`'s line and rewrites the area's report. */
export const tellOccasion = (cfg, say, ledger, rule) => {
  say(occasionLine(ledger, ledger.occasions.at(-1), rule));
  writeReport(cfg, ledger.area, ledger, rule);
};

/** Folds every unfolded report into the ledger, in the order they finished, printing a line for each. Answers the ledger. */
export const foldPending = async (ctx, ledger, ruleNow) => {
  let at = ledger;
  while (at.unfolded?.length) {
    at = await foldNext(ctx, at);
    tellOccasion(ctx.cfg, ctx.say, at, ruleNow());
  }
  return at;
};
