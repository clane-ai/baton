import { render, screen } from '@testing-library/react';

import { RunGraph } from '../RunGraph';
import type { WorkflowRun } from '../../data/types';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const fixture = require('../../data/__fixtures__/workflow-run.json') as { run: WorkflowRun };

describe('RunGraph', () => {
  it('draws every step of the run in its role lane', () => {
    const { container } = render(<RunGraph run={fixture.run} />);
    for (const step of fixture.run.steps ?? []) {
      expect(screen.getAllByText(step.key).length).toBeGreaterThan(0);
    }
    const lanes = new Set((fixture.run.steps ?? []).map((s) => s.role));
    expect(container.querySelectorAll('[data-lane]')).toHaveLength(lanes.size);
  });

  it('labels itself for assistive technology', () => {
    render(<RunGraph run={fixture.run} />);
    expect(screen.getByRole('img', { name: new RegExp(fixture.run.key) })).toBeInTheDocument();
  });

  it('draws a branch that was not taken as a dashed flow', () => {
    const { container } = render(<RunGraph run={fixture.run} />);
    const skipped = (fixture.run.steps ?? []).filter((s) => s.state === 'cancelled' && s.condition);
    if (skipped.length) {
      expect(container.querySelectorAll('[data-flow="not-taken"]').length).toBeGreaterThan(0);
    }
  });
});
