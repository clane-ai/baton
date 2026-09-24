// Bank payment, as a Clane code node.
//
// The original claims a task, writes a remittance advice into the workspace and registers a payment
// artefact, and it is idempotent by invoice number so a retry cannot pay twice. That last property has
// no equivalent here, which is recorded as a finding rather than pretended away: a Clane code node has
// no idempotency key, and the runtime re-runs a pending node at least once after a resume.

function main() {
  // Both locals are declared as inputs on the node, so a worker receives them by name.
  const match = typeof invoice_match === 'string' ? JSON.parse(invoice_match) : invoice_match ?? {};
  const supplier_ = typeof supplier === 'string' ? JSON.parse(supplier) : supplier ?? {};
  const invoice = supplier_.invoice ?? {};

  const scheduled = new Date(Date.now() + 2 * 864e5).toISOString().slice(0, 10);
  const payment = {
    payment_ref: `PAY-${String(invoice.invoice_number ?? 'UNKNOWN').replace(/^INV-/, '')}`,
    invoice_number: invoice.invoice_number,
    beneficiary: { name: invoice.vendor },
    amount: Number(match.amount_payable ?? invoice.total ?? 0),
    currency: invoice.currency ?? 'EUR',
    scheduled_for: scheduled,
    status: 'scheduled',
  };

  return {
    ...payment,
    output: `Scheduled ${payment.payment_ref}: ${payment.amount} ${payment.currency} to ${payment.beneficiary.name} on ${payment.scheduled_for}.`,
  };
}
