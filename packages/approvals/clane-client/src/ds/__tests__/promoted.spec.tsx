import { render, screen } from '@testing-library/react';
import { Timeline } from '../Timeline.jsx';
import { Banner } from '../Banner.jsx';
import { FilterBar } from '../FilterBar.jsx';
import { SortableTable } from '../SortableTable.jsx';

it('renders a timeline item title and meta', () => {
  render(
    <Timeline items={[{ status: 'done', title: 'Passed its gate', meta: '09:19:04 · buyer' }]} />,
  );
  expect(screen.getByText('Passed its gate')).toBeInTheDocument();
  expect(screen.getByText('09:19:04 · buyer')).toBeInTheDocument();
});

it('renders a danger banner with its text', () => {
  render(
    <Banner tone="danger" title="Baton is unreachable">
      Try again.
    </Banner>,
  );
  expect(screen.getByText('Baton is unreachable')).toBeInTheDocument();
});

it('filter bar toggles an id', () => {
  const seen: string[][] = [];
  render(
    <FilterBar
      filters={[{ id: 'a', label: 'Approvals' }]}
      active={[]}
      onChange={(x: string[]) => seen.push(x)}
    />,
  );
  screen.getByText('Approvals').click();
  expect(seen[0]).toEqual(['a']);
});

it('sortable table shows rows', () => {
  render(<SortableTable columns={[{ key: 'k', label: 'Key' }]} rows={[{ k: 'TSK-1' }]} />);
  expect(screen.getByText('TSK-1')).toBeInTheDocument();
});
