import { describe, expect, it } from 'vitest';
import { blameStep } from './weasel.config.mjs';

const step = 'the checks ci.yml runs as steps > npm run lint -w @weasel-js/labkit';
const summary = (diagnostics: string) => [
  `fleet-fail: gate scripts/ci-checks.gate.ts :: ${step}`,
  ' ✓  labkit  packages/labkit/src/a.test.ts (1 test) 3ms',
  ` FAIL   gate  scripts/ci-checks.gate.ts > ${step}`,
  'AssertionError: /work/weasel-wt3/packages/labkit/biome.jsonc:2:14 deserialize ━━━━━━',
  '',
  '  i The configuration schema version does not match the CLI version 2.6.8',
  'src/canvas/Stack.test.tsx:28:11 lint/style/noNonNullAssertion ━━━━━━',
  '',
  '  ! Forbidden non-null assertion.',
  diagnostics,
  'Found 1 error.',
  '⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯',
  ' FAIL   gate  scripts/other.gate.ts > src/elsewhere.ts format ━━━',
].join('\n');

describe('blameStep', () => {
  it("lays a failed package lint at the files biome's report marks as errors", () => {
    const text = summary(['src/lab/LabZoom.tsx format ━━━━━━', '', '  × Formatter would have printed the following content:'].join('\n'));
    expect(blameStep(text, step)).toEqual(['packages/labkit/src/lab/LabZoom.tsx']);
  });

  it('lays it at the whole package when the report hides its error behind the diagnostic limit', () => {
    expect(blameStep(summary('Diagnostics not shown: 167.'), step)).toEqual(['packages/labkit']);
  });

  it("still reads check:unnameable's packages for its own step", () => {
    const text = ['fleet-fail: post npm run check:unnameable', '  @weasel-js/geom: names a type it does not export'].join('\n');
    expect(blameStep(text, 'npm run check:unnameable')).toEqual(['packages/geom']);
  });
});
