import { render, screen } from '@testing-library/react';

import { ArtefactDocument } from '../ArtefactDocument';

const po = {
  po_number: 'PO-2026-101',
  requisition: 'PR-2026-101',
  vendor: { id: 'V-1001', name: 'Nordlicht Computing GmbH', email: 'orders@nordlicht.example' },
  cost_center: 'CC-430',
  currency: 'EUR',
  total: 5520,
  lines: [
    { line: 1, sku: 'NL-LT14', item: 'Laptop 14"', quantity: 2, unit_price: 1200, line_total: 2400 },
    { line: 2, sku: 'NL-DCK', item: 'Docking station', quantity: 10, unit_price: 312, line_total: 3120 },
  ],
  policy_check: { approval_required: true, approver_level: 'manager', vendor_approved: true, notes: 'Manager band.' },
  _provenance: { vendor: { source: 'email', confidence: 0.96 } },
};

describe('ArtefactDocument', () => {
  it('renders a purchase order as the business document', () => {
    render(<ArtefactDocument kind="purchase_order" content={po} />);
    expect(screen.getByText('PO-2026-101')).toBeInTheDocument();
    expect(screen.getByText('Laptop 14"')).toBeInTheDocument();
    expect(screen.getByText('Docking station')).toBeInTheDocument();
    expect(screen.getByText('5,520.00 EUR')).toBeInTheDocument();
    expect(screen.getByText('Nordlicht Computing GmbH (V-1001)')).toBeInTheDocument();
  });

  it('marks where a field came from and how sure the extraction was', () => {
    render(<ArtefactDocument kind="purchase_order" content={po} />);
    expect(screen.getByText('email · 96%')).toBeInTheDocument();
  });

  it('shows the policy check as chips and its note', () => {
    render(<ArtefactDocument kind="purchase_order" content={po} />);
    expect(screen.getByText('Approval required')).toBeInTheDocument();
    expect(screen.getByText('Manager level')).toBeInTheDocument();
    expect(screen.getByText('Vendor approved')).toBeInTheDocument();
    expect(screen.getByText('Manager band.')).toBeInTheDocument();
  });

  it('falls back to labelled fields for an unknown kind', () => {
    render(<ArtefactDocument kind="test_report" content={{ passed: 12, failed_count: 1 }} />);
    expect(screen.getByText('failed count')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
  });

  it('says so when there is nothing to show', () => {
    render(<ArtefactDocument kind="purchase_order" content={null} />);
    expect(screen.getByText('No document to show.')).toBeInTheDocument();
  });
});
