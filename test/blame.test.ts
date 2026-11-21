import { describe, expect, it } from 'vitest';
import { blameStep } from '../examples/weasel.config.mjs';

/** Round 64's gate log around its failed `check:unnameable`, as the gate printed it. */
const LOG = [
  'postbuild| ci-run: 11/17 FAIL     9.6s  (plan    0.9s, 10.07×)  npm run check:unnameable',
  'fleet-fail: postbuild npm run check:unnameable',
  'postbuild|     [unnameable]  1/65 @weasel-js/animator 0',
  'postbuild|     [unnameable] 61/65 @weasel-js/theme 1',
  'postbuild|     [unnameable] public declarations name 1 type(s) their package does not export:',
  'postbuild|       @weasel-js/theme: StepScope',
  'postbuild| ci-run:  5/17 ok      11.7s  (plan    5.0s,  2.33×)  npx vitest run --project=forge-node a.test.ts',
  'postbuild|       @weasel-js/geom: NotThisStep',
].join('\n');

describe("weasel's step blame", () => {
  it('names the packages a failed step reports, and not those its progress lines list or a later step names', () => {
    expect(blameStep(LOG, 'npm run check:unnameable')).toEqual(['packages/theme']);
    expect(blameStep(LOG, 'npm run build')).toEqual([]);
  });

  it("names the package a failed build stopped at, from round 60's log", () => {
    const build = [
      'fleet-fail: postbuild npm run build',
      'postbuild|     [build]  1/65 ok     1.1s  @weasel-js/bidi',
      'postbuild|     [build] 31/65 FAIL   0.5s  @weasel-js/theme',
      "postbuild|     SyntaxError: Identifier 'isAlpha' has already been declared",
      'postbuild|     [build] @weasel-js/theme failed (exit 1); started nothing after it.',
    ].join('\n');
    expect(blameStep(build, 'npm run build')).toEqual(['packages/theme']);
  });
});
