import { documentNumber, summaryOf } from '../summary';

describe('summaryOf', () => {
  it('reads number, counterparty, amount and currency from a purchase order', () => {
    const s = summaryOf('purchase_order', {
      po_number: 'PO-2026-103',
      vendor: { name: 'Nordlicht Computing GmbH' },
      total: 25200,
      currency: 'EUR',
      policy_check: { approver_level: 'director', vendor_approved: true },
    });
    expect(s).toMatchObject({
      document: 'PO-2026-103',
      counterparty: 'Nordlicht Computing GmbH',
      amount: 25200,
      currency: 'EUR',
      flags: ['level_director'],
    });
  });

  it('flags an unapproved vendor, a mismatch and a short delivery', () => {
    expect(summaryOf('purchase_order', { policy_check: { vendor_approved: false } }).flags).toEqual(['vendor_not_approved']);
    expect(summaryOf('invoice_match', { status: 'mismatched', amount_payable: 0 }).flags).toEqual(['mismatched']);
    expect(summaryOf('goods_receipt', { complete: false }).flags).toEqual(['short_delivery']);
  });

  it('leaves unknown values empty rather than guessing', () => {
    expect(summaryOf('review', null)).toMatchObject({ document: null, counterparty: null, amount: null, currency: null, flags: [] });
    expect(summaryOf('invoice', { total: 'n/a' }).amount).toBeNull();
  });
});

describe('documentNumber', () => {
  const all = {
    po_number: 'PO-2026-103',
    invoice_number: 'INV-2026-103',
    grn_number: 'GRN-2026-103',
    delivery_note_number: 'DN-2026-103',
    payment_ref: 'PAY-2026-103',
  };
  it("gives each document its own number, not the purchase order's", () => {
    expect(documentNumber('purchase_order', all)).toBe('PO-2026-103');
    expect(documentNumber('invoice', all)).toBe('INV-2026-103');
    expect(documentNumber('goods_receipt', all)).toBe('GRN-2026-103');
    expect(documentNumber('delivery_note', all)).toBe('DN-2026-103');
    expect(documentNumber('payment', all)).toBe('PAY-2026-103');
    expect(documentNumber('invoice_match', all)).toBe('INV-2026-103');
  });
  it('falls back to any number the content carries, then to nothing', () => {
    expect(documentNumber('handoff', { po_number: 'PO-1' })).toBe('PO-1');
    expect(documentNumber('review', {})).toBe('');
    expect(documentNumber('review', null)).toBe('');
  });
});
