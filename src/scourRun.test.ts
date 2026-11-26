import { describe, expect, it } from 'vitest';
import { ledgerOf } from './ledger.mjs';
import { saturateCommand } from './saturate.mjs';
import { fakeRunner, project } from './scourTestKit.ts';

const reviews = (tasks: string[]) => tasks.filter((t) => t.endsWith('-claude-claude')).map((t) => t.replace(/^proj-saturate-|-claude-claude$/g, ''));
const occasionsOf = (cfg: unknown, id: string) => ledgerOf(cfg, id)?.occasions.length ?? 0;

describe('a delve\'s cost cutoffs', () => {
  it('stops before a pass would spend past --usd', async () => {
    const { root, cfg } = project();
    const lines: string[] = [];
    // Passes cost $0.50, then $0.60 with their matcher: after two, $1.10 spent and a $0.55 pass would pass $1.50.
    await saturateCommand(cfg, fakeRunner([['A', 'B'], ['C', 'D'], ['E']]), root, ['src', '--usd', '1.5'], (l) => lines.push(l));
    expect(occasionsOf(cfg, 'src')).toBe(2);
    expect(lines).toContain('saturate src: stopped, another pass would take spending past the $1.50 limit ($1.10 spent)');
  });

  it('stops once the next defect would cost over --per-defect', async () => {
    const { root, cfg } = project();
    const lines: string[] = [];
    const seen = [['A', 'B', 'C', 'D'], ['D', 'B', 'E', 'F', 'G', 'H', 'I'], ['J', 'A', 'K', 'H'], ['A', 'D']];
    await saturateCommand(cfg, fakeRunner(seen), root, ['src', '--per-defect', '0.3'], (l) => lines.push(l));
    expect(occasionsOf(cfg, 'src')).toBe(3);
    expect(lines.at(-2)).toMatch(/^saturate src: stopped, the next defect would cost about \$0\.38, over the limit of \$0\.30$/);
  });
});

describe('skulkr scour run', () => {
  it('finishes each named area in turn by default', async () => {
    const { root, cfg } = project(['lib', 'src']);
    const runner = fakeRunner([['A'], ['B'], ['C'], ['D']]);
    await saturateCommand(cfg, runner, root, ['run', 'lib', 'src', '--max', '2'], () => {});
    expect(reviews(runner.tasks)).toEqual(['lib-01', 'lib-02', 'src-01', 'src-02']);
  });

  it('sends each pass to the cheapest next defect, skipping stopped areas, within --usd', async () => {
    const { root, cfg } = project(['lib', 'src']);
    // lib's second pass repeats its first, so nothing is unseen there and its stop rule holds; src goes next.
    const runner = fakeRunner([['A', 'B'], ['A', 'B'], ['C', 'D'], ['E']]);
    const lines: string[] = [];
    await saturateCommand(cfg, runner, root, ['run', 'lib', 'src', '--by', 'cheapest', '--usd', '2'], (l) => lines.push(l));
    expect(reviews(runner.tasks)).toEqual(['lib-01', 'lib-02', 'src-01']);
    expect(lines.at(-1)).toBe('scour run: spent $1.60 of $2.00');
  });

  it('spreads --passes over every area before any gets more', async () => {
    const { root, cfg } = project(['lib', 'src']);
    const runner = fakeRunner([['A'], ['B'], ['C'], ['D']]);
    await saturateCommand(cfg, runner, root, ['run', 'lib', 'src', '--by', 'spread', '--passes', '1'], () => {});
    expect(reviews(runner.tasks)).toEqual(['lib-01', 'src-01']);
  });

  it('wants a budget to run over every area, and a strategy it knows', async () => {
    const { root, cfg } = project();
    await expect(saturateCommand(cfg, fakeRunner([]), root, ['run'], () => {})).rejects.toThrow(/wants --usd/);
    await expect(saturateCommand(cfg, fakeRunner([]), root, ['run', 'src', '--by', 'random'], () => {})).rejects.toThrow(/--by wants one of finish, cheapest, spread/);
  });
});
