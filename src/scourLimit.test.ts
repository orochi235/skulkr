import { describe, expect, it } from 'vitest';
import { writeLedger } from './ledger.mjs';
import { limitText } from './saturation.mjs';
import { goingRateOf, limitSpecOf, nextPriceOf, priceByOf, scourRuleOf } from './scourPrice.mjs';
import { saturateArgsOf } from './saturate.mjs';
import { occasionLine } from './scourFold.mjs';
import { project } from './scourTestKit.ts';

/** A ledger of `area` whose occasions saw the defects in `seen`, each pass costing $1. */
const ledgerOf = (area: string, seen: string[][]) => {
  const occasions = seen.map((_, i) => ({ n: i + 1, source: 'claude', costUsd: 1 }));
  const defects = [...new Set(seen.flat())].map((id) => {
    const sightings = seen.flatMap((s, i) => (s.includes(id) ? [i + 1] : []));
    return { id, claim: id, where: '', firstOccasion: sightings[0], sightings, sources: { claude: sightings } };
  });
  return { area, commit: 'c', files: [`${area}/x.ts`], occasions, defects };
};
const SEEN = [['A', 'B', 'C', 'D'], ['D', 'B', 'E', 'F', 'G', 'H', 'I'], ['J', 'A', 'K', 'H'], ['A', 'D'], ['H', 'L', 'A', 'C', 'M']];

describe('limitSpecOf', () => {
  it('reads dollars or a multiple of the going rate, and refuses anything else', () => {
    expect(limitSpecOf(2.5)).toEqual({ usd: 2.5 });
    expect(limitSpecOf('$2.5')).toEqual({ usd: 2.5 });
    expect(limitSpecOf('4x')).toEqual({ times: 4 });
    expect(limitSpecOf('1.5×')).toEqual({ times: 1.5 });
    expect(limitSpecOf({ times: 3 })).toEqual({ times: 3 });
    expect(() => limitSpecOf('cheap')).toThrow(/dollars \(2\.5\) or a multiple/);
    expect(() => limitSpecOf({ times: 0 })).toThrow(/over 0/);
  });
});

describe('goingRateOf', () => {
  it('is the opening price while an area of the partition has fewer than two passes, then the cheapest next defect', () => {
    const { root, cfg } = project(['lib', 'src']);
    const pricing = { factor: 1, openingUsd: 0.25 };
    writeLedger(cfg, ledgerOf('src', SEEN));
    expect(goingRateOf(cfg, root, pricing)).toBe(0.25);
    // Three passes are too few for a price: lib still counts as fresh.
    writeLedger(cfg, ledgerOf('lib', SEEN.slice(0, 3)));
    expect(goingRateOf(cfg, root, pricing)).toBe(0.25);
    const four = [...SEEN.slice(0, 4), ['A', 'N', 'O']];
    writeLedger(cfg, ledgerOf('lib', four));
    const cheapest = Math.min(nextPriceOf(ledgerOf('src', SEEN)).usd!, nextPriceOf(ledgerOf('lib', four)).usd!);
    expect(goingRateOf(cfg, root, pricing)).toBeCloseTo(cheapest, 10);
  });
});

describe('scourRuleOf', () => {
  it('sets the per-defect limit to a multiple of the going rate, or to the dollars given', () => {
    const { root, cfg } = project(['lib', 'src']);
    const going = scourRuleOf(cfg, root, { perDefect: '4x' });
    expect(going.limit).toEqual({ usd: 4 * cfg.saturate.openingUsdPerDefect, times: 4, goingUsd: cfg.saturate.openingUsdPerDefect });
    expect(going.stopUsdPerDefect).toBeCloseTo(1.6, 10);
    expect(limitText(going)).toBe('$1.60 (4× the $0.40 going rate)');
    const fixed = scourRuleOf(cfg, root, { perDefect: '2.5' });
    expect(fixed.stopUsdPerDefect).toBe(2.5);
    expect(limitText(fixed)).toBe('$2.50');
  });

  it('defaults to four times the going rate', () => {
    const { root, cfg } = project();
    expect(scourRuleOf(cfg, root).limit.times).toBe(4);
    expect(scourRuleOf(cfg, root).openingUsd).toBe(cfg.saturate.openingUsdPerDefect);
  });

  it('prices per defect unless told kloc, by the config or the flag, and names the unit', () => {
    const { root, cfg } = project(['lib', 'src']);
    expect(scourRuleOf(cfg, root).priceBy).toBe('defect');
    const kloc = { ...cfg, saturate: { ...cfg.saturate, priceBy: 'kloc' } };
    // Deep ledgers of 4,000 and 1,000 lines with the same yield: the small one is the cheaper per defect/kloc.
    writeLedger(cfg, { ...ledgerOf('src', SEEN), lines: 4000 });
    writeLedger(cfg, { ...ledgerOf('lib', SEEN), lines: 1000 });
    const perDefect = nextPriceOf(ledgerOf('src', SEEN)).usd!;
    const rule = scourRuleOf(kloc, root, { perDefect: '3x' });
    expect(rule.priceBy).toBe('kloc');
    expect(rule.limit).toMatchObject({ times: 3 });
    expect((rule.limit as { goingUsd: number }).goingUsd).toBeCloseTo(perDefect, 10);
    expect(limitText(rule)).toBe(`$${(3 * perDefect).toFixed(2)} per defect/kloc (3× the $${perDefect.toFixed(2)} going rate)`);
    expect(scourRuleOf(cfg, root, { priceBy: 'kloc' }).priceBy).toBe('kloc');
    expect(limitText(scourRuleOf(kloc, root, { perDefect: '2.5', priceBy: 'defect' }))).toBe('$2.50');
    expect(limitText(scourRuleOf(kloc, root, { perDefect: '2.5' }))).toBe('$2.50 per defect/kloc');
  });

  it('refuses a unit other than defect or kloc', () => {
    expect(priceByOf('kloc')).toBe('kloc');
    expect(() => priceByOf('line')).toThrow(/--price-by wants one of defect, kloc, not line/);
    const { root, cfg } = project();
    expect(() => scourRuleOf(cfg, root, { priceBy: 'loc' })).toThrow(/--price-by/);
    expect(saturateArgsOf(cfg, ['src', '--price-by', 'kloc']).priceBy).toBe('kloc');
    expect(saturateArgsOf(cfg, ['src']).priceBy).toBeUndefined();
    expect(() => saturateArgsOf(cfg, ['src', '--price-by', 'lines'])).toThrow(/--price-by wants one of/);
  });
});

describe('occasionLine', () => {
  it('names the unit of the next price and the limit under kloc, and says when the lines are unknown', () => {
    const rule = { max: 40, factor: 1, priceBy: 'kloc', stopUsdPerDefect: 2.5 };
    const l = { ...ledgerOf('src', SEEN), occasions: ledgerOf('src', SEEN).occasions.map((o) => ({ ...o, findings: 1 })) };
    const next = (nextPriceOf(l).usd! * 2).toFixed(2);
    expect(occasionLine({ ...l, lines: 2000 }, l.occasions.at(-1), rule)).toMatch(new RegExp(`next ≈ \\$${next} per defect/kloc \\(limit \\$2\\.50 per defect/kloc\\)$`));
    expect(occasionLine(l, l.occasions.at(-1), rule)).toMatch(/next ≈ unpriced, lines unknown \(limit \$2\.50 per defect\/kloc\)$/);
  });
});
