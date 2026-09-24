// Supplier ERP, as a Clane code node.
//
// The original is a Baton agent: it claims a task, writes files into the workspace and registers a
// delivery note and an invoice as artefacts. None of that has a meaning inside a walk, so this is a
// faithful re-implementation of what the step DOES rather than a copy of the file: it takes the
// purchase order from the previous channel and returns the two documents the supplier would send back.
//
// Deterministic on purpose. The numbers come from the order, not from a model, which is the whole
// reason this step is code rather than a role.

function main() {
  // `purchase_order` is injected as a local by both executors: the platform injects every channel
  // as a variable named after it, and a worker injects what the node declares. There is no `channels`
  // object in either, which the converter now refuses.
  const order = typeof purchase_order === 'string' ? JSON.parse(purchase_order) : purchase_order ?? {};
  const poNumber = order.po_number ?? 'PO-UNKNOWN';
  const lines = Array.isArray(order.lines) ? order.lines : [];
  const today = new Date().toISOString().slice(0, 10);
  const due = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);

  const delivery_note = {
    delivery_note_number: `DN-${poNumber.replace(/^PO-/, '')}`,
    po_number: poNumber,
    vendor: order.vendor?.name ?? order.vendor ?? 'unknown',
    shipped_at: today,
    lines: lines.map((l) => ({ sku: l.sku, description: l.description, quantity: l.quantity })),
  };

  const subtotal = lines.reduce((s, l) => s + Number(l.quantity ?? 0) * Number(l.unit_price ?? 0), 0);
  const invoice = {
    invoice_number: `INV-${poNumber.replace(/^PO-/, '')}`,
    po_number: poNumber,
    vendor: order.vendor?.name ?? order.vendor ?? 'unknown',
    issued_at: today,
    due_at: due,
    currency: order.currency ?? 'EUR',
    lines: lines.map((l) => ({ sku: l.sku, quantity: l.quantity, unit_price: l.unit_price })),
    subtotal: Number(subtotal.toFixed(2)),
    total: Number(subtotal.toFixed(2)),
  };

  return {
    acknowledged: true,
    po_number: poNumber,
    delivery_note,
    invoice,
    output: `Acknowledged ${poNumber}, shipped ${delivery_note.delivery_note_number}, invoiced ${invoice.invoice_number} for ${invoice.total} ${invoice.currency}.`,
  };
}
