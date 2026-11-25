import { cleanup, screen } from '@testing-library/react';
import { renderWithIcons } from '@dash/test/icons';
import { afterEach, describe, expect, it } from 'vitest';
import { CalibrationChart, captionOf } from './CalibrationChart';
import type { AuditCalibration } from './skulkrMap.types';

const factor = (pairs: number, predicted: number, found: number) => ({ pairs, predicted, found, factor: predicted > 0 ? found / predicted : null });
const calibration: AuditCalibration = {
  minPairs: 5,
  pairs: [],
  factors: { overall: factor(3, 4, 14), byShared: { '0': factor(0, 0, 0), '1–2': factor(2, 3, 12), '3+': factor(1, 1, 2) } },
  series: [
    { round: 35, pairs: 2, predicted: 3, found: 12, factor: 4 },
    { round: 37, pairs: 1, predicted: 1, found: 2, factor: 3.5 },
  ],
};

afterEach(cleanup);

describe('CalibrationChart', () => {
  it('draws, per round, what was predicted left beside what the next passes found, and the running factor', () => {
    renderWithIcons(<CalibrationChart calibration={calibration} />);
    const chart = screen.getByRole('img');
    expect(chart.getAttribute('aria-label')).toBe('Defects per area predicted left against found by the next pass, by round');
    expect(chart.querySelectorAll('rect')).toHaveLength(4);
    expect(chart.querySelectorAll('circle')).toHaveLength(2);
    expect([...chart.querySelectorAll('title')].map((t) => t.textContent)).toEqual([
      'round 35, over 2 areas: 1.5 predicted left per area, 6.0 found by their next pass; 4.00× pooled to here',
      'round 37, over 1 area: 1.0 predicted left per area, 2.0 found by their next pass; 3.50× pooled to here',
    ]);
  });

  it('states the overall factor and pair count under the chart', () => {
    renderWithIcons(<CalibrationChart calibration={calibration} />);
    expect(screen.getByText(captionOf(calibration))).toBeTruthy();
    expect(captionOf(calibration)).toBe('later passes found 3.50× the left predicted, over 3 pairs');
  });

  it('says so when no area has two passes, or the map carries no calibration', () => {
    renderWithIcons(<CalibrationChart calibration={{ ...calibration, series: [], factors: { ...calibration.factors, overall: factor(0, 0, 0) } }} />);
    expect(screen.getByText('No area has had two passes yet.')).toBeTruthy();
    expect(screen.getByText('no factor yet, over 0 pairs')).toBeTruthy();
    cleanup();
    renderWithIcons(<CalibrationChart calibration={undefined} />);
    expect(screen.getByText('no calibration in this map')).toBeTruthy();
  });
});
